import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
  type KernelPool,
} from '../../src/compute-engine';

// ROADMAP CE-518 (Tycho row 460), user decision 2026-10-26:
// - the code that a caller's operator `compile` handler writes is not
//   shippable (it may call a function of the compiling thread), unless the
//   operator definition sets `compileShippable`; this also holds for a
//   handler attached in place to a built-in definition;
// - a definition can give `compileHelpers`, whose source the engine copies
//   into the compiled code, so that the code runs on a worker;
// - `broadcastAsync()` reports the cells whose evaluation threw (`failed`).
// The workers are Node `worker_threads` running the worker entry from
// source through the tsx loader, as in `kernel-pool.test.ts`.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

const host = globalThis as {
  ce518Twice?: (x: number) => number;
  ce518Throws?: (x: number) => number;
};
host.ce518Twice = (x) => 2 * x;
host.ce518Throws = (x) => {
  if (x < 0) throw new Error('negative');
  return x;
};

function samples(n: number, lo = -5, hi = 5): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + ((hi - lo) * i) / (n - 1);
  return xs;
}

function declareHostTwice(ce: ComputeEngine, shippable?: boolean): void {
  ce.declare('HostTwice', {
    signature: '(number) -> number',
    ...(shippable !== undefined ? { compileShippable: shippable } : {}),
    compile: (args, compile, { language }) =>
      language === 'javascript'
        ? `globalThis.ce518Twice(${compile(args[0])})`
        : undefined,
  });
}

function declareWrap(ce: ComputeEngine): void {
  ce.declare('Wrap', {
    signature: '(number, number) -> number',
    compileShippable: true,
    compileHelpers: {
      ce518WrapIndex: (i: number, n: number) => ((i % n) + n) % n,
    },
    compile: (args, compile, { language }) =>
      language === 'javascript'
        ? `ce518WrapIndex(${compile(args[0])}, ${compile(args[1])})`
        : undefined,
  });
}

describe('the output of a caller compile handler is not shippable by default', () => {
  test('a declared operator', async () => {
    const ce = new ComputeEngine();
    declareHostTwice(ce);
    const r = compile(ce.box(['Add', ['HostTwice', 'x'], 1]));
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(false);
    expect(r.run!({ x: 3 })).toBe(7);
    // This engine has no pool: `no-pool` comes before `not-shippable`. The
    // pool tests below read `not-shippable`.
    const res = await r.broadcastAsync!({ x: Float64Array.from([1, 2]) });
    expect([...res.out]).toEqual([3, 5]);
    expect(res.failed).toBe(0);
  });

  test('a handler attached in place to a built-in definition', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('Floor');
    if (def === undefined || !('operator' in def)) throw new Error('no Floor');
    def.operator.compile = (args, compile, { language }) =>
      language === 'javascript'
        ? `globalThis.ce518Twice(${compile(args[0])})`
        : undefined;
    const r = compile(ce.parse('\\lfloor x \\rfloor'));
    expect(r.shippable).toBe(false);
    expect(r.run!({ x: 3 })).toBe(6);
  });

  test('a handler that declines leaves the result shippable', () => {
    const ce = new ComputeEngine();
    ce.declare('Declines', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      compile: () => undefined,
    });
    const r = compile(ce.parse('x^2 + 1'));
    expect(r.shippable).toBe(true);
  });

  test('the handlers of the standard library stay shippable', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\frac{d}{dx} \\sin(x)'));
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(true);
  });

  test('the constructor of a declared type stays shippable', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<real, real>');
    const r = compile(ce.box(['point', 'x', 1]));
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(true);
  });

  test('`compileShippable: true` makes the result shippable', () => {
    const ce = new ComputeEngine();
    declareHostTwice(ce, true);
    expect(compile(ce.box(['HostTwice', 'x'])).shippable).toBe(true);
  });
});

describe('compile helpers', () => {
  test('the helper source is in the preamble, evaluated once', () => {
    const ce = new ComputeEngine();
    declareWrap(ce);
    const r = compile(ce.box(['Add', ['Wrap', 'x', 5], 1]));
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(true);
    expect(r.run!({ x: -7 })).toBe(4);
    expect(r.preamble).toContain('const ce518WrapIndex = (');
    expect(r.preambleOnce).toContain('const ce518WrapIndex = (');
  });

  test('two calls of the operator define the helper once', () => {
    const ce = new ComputeEngine();
    declareWrap(ce);
    const r = compile(ce.box(['Add', ['Wrap', 'x', 5], ['Wrap', 'x', 3]]));
    expect(r.run!({ x: -7 })).toBe(3 + 2);
    expect(r.preamble!.split('const ce518WrapIndex').length).toBe(2);
  });

  test('a helper of the same name with other source does not compile', () => {
    const ce = new ComputeEngine();
    declareWrap(ce);
    ce.declare('Wrap2', {
      signature: '(number, number) -> number',
      compileShippable: true,
      compileHelpers: { ce518WrapIndex: (i: number, n: number) => i - n },
      compile: (args, compile) =>
        `ce518WrapIndex(${compile(args[0])}, ${compile(args[1])})`,
    });
    expect(() =>
      compile(ce.box(['Add', ['Wrap', 'x', 5], ['Wrap2', 'x', 5]]), {
        fallback: false,
      })
    ).toThrow('different source');
  });

  test('helpers assigned in place are checked when they are compiled', () => {
    const ce = new ComputeEngine();
    declareWrap(ce);
    const def = ce.lookupDefinition('Wrap');
    if (def === undefined || !('operator' in def)) throw new Error('no Wrap');
    def.operator.compileHelpers = { Array: (a: number) => a };
    expect(() =>
      compile(ce.box(['Wrap', 'x', 5]), { fallback: false })
    ).toThrow('invalid name');
  });

  test.each([
    ['a name that starts with "_"', { _f: (a: number) => a }, 'invalid name'],
    ['a reserved word', { class: (a: number) => a }, 'invalid name'],
    ['the name of a global', { Math: (a: number) => a }, 'invalid name'],
    ['a built-in function', { f: Math.sin }, 'no source'],
    [
      'a method',
      {
        f: {
          f(a: number) {
            return a;
          },
        }.f,
      },
      'no source',
    ],
    ['a value that is not a function', { f: 3 }, 'not a function'],
  ])('a definition with %s is refused', (_, helpers, message) => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('BadHelpers', {
        signature: '(number) -> number',
        compileHelpers: helpers as never,
      })
    ).toThrow(message);
  });
});

describe('cells that throw are counted (`failed`)', () => {
  test('on the calling thread', async () => {
    const ce = new ComputeEngine();
    ce.declare('HostThrows', {
      signature: '(number) -> number',
      compile: (args, compile) => `globalThis.ce518Throws(${compile(args[0])})`,
    });
    const r = compile(ce.box(['HostThrows', 'x']));
    const xs = Float64Array.from([-2, -1, 0, 1, 2]);
    const res = await r.broadcastAsync!({ x: xs });
    expect(res.route).toBe('calling-thread');
    expect(res.done).toBe(5);
    expect(res.failed).toBe(2);
    expect([...res.out]).toEqual([NaN, NaN, 0, 1, 2]);
  });

  test('on the `interval-js` target', async () => {
    const ce = new ComputeEngine();
    ce.declare('IvCheck', {
      signature: '(number) -> number',
      evaluate: ([x]) => x,
      compileShippable: true,
      compileHelpers: {
        ivCheck: (x: { lo: number }) => {
          if (x.lo < 0) throw new Error('negative');
          return x;
        },
      },
      compile: (args, compile, { language }) =>
        language === 'interval-javascript'
          ? `ivCheck(${compile(args[0])})`
          : undefined,
    });
    const r = compile(ce.box(['IvCheck', 'x']), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(r.shippable).toBe(true);
    // Three enclosures `[lo, hi]`: the first one throws.
    const res = await r.broadcastAsync!({
      x: Float64Array.from([-2, -1, 0, 1, 2, 3]),
    });
    expect(res.done).toBe(3);
    expect(res.failed).toBe(1);
  });

  test('a batch with no failure reports 0', async () => {
    const ce = new ComputeEngine();
    const res = await compile(ce.parse('x^2')).broadcastAsync!({
      x: samples(10),
    });
    expect(res.failed).toBe(0);
  });
});

describe('on the worker pool', () => {
  let pool: KernelPool;
  let ce: ComputeEngine;

  beforeAll(() => {
    pool = createKernelPool({
      create: () => {
        const w = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] });
        return {
          postMessage: (m: unknown, transfer?: ArrayBuffer[]) =>
            w.postMessage(m, transfer ?? []),
          terminate: () => w.terminate(),
          on: (event, handler) => w.on(event as 'message', handler),
        };
      },
      size: 2,
    });
    ce = new ComputeEngine({ workers: pool });
  });

  afterAll(() => pool.dispose());

  test('code with a helper runs on the workers', async () => {
    declareWrap(ce);
    const r = compile(ce.box(['Wrap', 'x', 7]));
    expect(r.willUsePool!(40_000)).toBe(true);
    const xs = new Float64Array(40_000);
    for (let i = 0; i < xs.length; i++) xs[i] = i - 20_000;
    const res = await r.broadcastAsync!({ x: xs }, { chunk: 10_000 });
    expect(res.route).toBe('pool');
    expect(res.reason).toBeUndefined();
    expect(res.done).toBe(40_000);
    expect(res.failed).toBe(0);
    for (let i = 0; i < xs.length; i += 997)
      expect(res.out[i]).toBe(((xs[i] % 7) + 7) % 7);
  });

  test('a host call declared shippable fails every cell, and `failed` says so', async () => {
    const own = new ComputeEngine({ workers: pool });
    declareHostTwice(own, true);
    const r = compile(own.box(['HostTwice', 'x']));
    expect(r.shippable).toBe(true);
    const res = await r.broadcastAsync!({ x: samples(40_000) });
    expect(res.route).toBe('pool');
    expect(res.done).toBe(40_000);
    expect(res.failed).toBe(40_000);
    expect(Number.isNaN(res.out[0])).toBe(true);
  });

  test('a host call not declared shippable stays on the calling thread', async () => {
    const own = new ComputeEngine({ workers: pool });
    declareHostTwice(own);
    const r = compile(own.box(['HostTwice', 'x']));
    expect(r.willUsePool!(40_000)).toBe(false);
    const xs = samples(40_000);
    const res = await r.broadcastAsync!({ x: xs });
    expect(res.route).toBe('calling-thread');
    expect(res.reason).toBe('not-shippable');
    expect(res.failed).toBe(0);
    expect(res.out[123]).toBe(2 * xs[123]);
  });
});
