/**
 * CE-1621: compiled JavaScript calls a function that the host declared with
 * `ce.declare()` and an `evaluate` function (a notebook's `draw`).
 *
 * The call is an effectful operation of the IR: the code calls
 * `_SYS.hosts[k]`, which evaluates the call in the engine at each
 * evaluation, in the order of the program (`hostCall()` of `lower.ts`).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { Expression } from '../../src/compute-engine/global-types';

type Run = (...args: unknown[]) => unknown;

/** An engine with the host functions, each of which records its call in
 *  `calls`, and the definitions of `source`. */
function engine(source: string) {
  const ce = new ComputeEngine();
  const calls: unknown[] = [];
  ce.declare('hostDraw', {
    signature: '(any) -> nothing',
    evaluate: (ops) => {
      calls.push(['draw', ...ops.map((x) => x.json)]);
      return ce.symbol('Nothing');
    },
  });
  ce.declare('hostLabel', {
    signature: '(real, string, boolean) -> nothing',
    evaluate: (ops) => {
      calls.push(['label', ...ops.map((x) => x.json)]);
      return ce.symbol('Nothing');
    },
  });
  ce.declare('hostSq', {
    signature: '(real) -> real',
    evaluate: (ops) => {
      calls.push(['sq', ops[0].json]);
      return ce.number(ops[0].re * ops[0].re);
    },
  });
  ce.declare('hostCount', {
    signature: '(real) -> integer',
    evaluate: (ops) => ce.number(Math.floor(ops[0].re)),
  });
  ce.declare('hostPositive', {
    signature: '(real) -> boolean',
    evaluate: (ops) => (ops[0].re > 0 ? ce.True : ce.False),
  });
  ce.declare('hostAny', {
    signature: '(real) -> any',
    evaluate: (ops) => ops[0],
  });
  ce.declare('hostFive', {
    signature: '(real, real, real, real, real) -> nothing',
    evaluate: () => ce.symbol('Nothing'),
  });
  const program = executeEpsil(ce, source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, calls };
}

const fn = (ce: ComputeEngine, name: string): Expression =>
  ce.box(name).evaluate();

function compiled(e: Expression) {
  const result = compile(e, { to: 'javascript', fallback: false });
  expect(result.success).toBe(true);
  return { result, run: result.run as Run };
}

function declined(e: Expression, options: object = {}): string {
  const result = compile(e, { to: 'javascript', ...options });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

describe('a call of a function of the host', () => {
  test('the witness: the call is made at each run, with its argument', () => {
    const { ce, calls } = engine('let callsHost = (t: real) => hostDraw(t)');
    const { result, run } = compiled(fn(ce, 'callsHost'));
    expect(result.hostCalls).toEqual(['hostDraw']);
    expect(result.shippable).toBe(false);
    expect(calls).toEqual([]);
    // The value Nothing of the root is NaN.
    expect(run(1)).toBeNaN();
    run(2.5);
    expect(calls).toEqual([
      ['draw', 1],
      ['draw', 2.5],
    ]);
  });

  test('the calls of a block, in order, with each lane of argument', () => {
    const { ce, calls } = engine(
      'let f = (t: real) => do { hostLabel(t, "a", t > 1); hostDraw(2 * t); t + 1 }'
    );
    const { run } = compiled(fn(ce, 'f'));
    expect(run(1.5)).toBe(2.5);
    expect(calls).toEqual([
      ['label', 1.5, "'a'", 'True'],
      ['draw', 3],
    ]);
  });

  test('two equal calls are two calls', () => {
    const { ce, calls } = engine('let f = (t: real) => hostSq(t) + hostSq(t)');
    const { run } = compiled(fn(ce, 'f'));
    expect(run(3)).toBe(18);
    expect(calls).toEqual([
      ['sq', 3],
      ['sq', 3],
    ]);
  });

  test('a call in a sum is made at each pass', () => {
    const { ce, calls } = engine('');
    const { run } = compiled(
      ce.box([
        'Function',
        ['Sum', ['hostSq', 'k'], ['Limits', 'k', 1, 'n']],
        ['Typed', 'n', "'integer'"],
      ])
    );
    expect(run(3)).toBe(14);
    expect(calls).toEqual([
      ['sq', 1],
      ['sq', 2],
      ['sq', 3],
    ]);
  });

  test('a call in a user function', () => {
    const { ce, calls } = engine(`let g = (x: real) => hostSq(x) + 1
let f = (t: real) => 2 * g(t)`);
    const { run } = compiled(fn(ce, 'f'));
    expect(run(2)).toBe(10);
    expect(calls).toEqual([['sq', 2]]);
  });

  test('a closed call is made at run time, not when compiling', () => {
    const { ce, calls } = engine('let f = () => hostSq(3) + 1');
    const { run } = compiled(fn(ce, 'f'));
    expect(calls).toEqual([]);
    expect(run()).toBe(10);
    expect(calls).toEqual([['sq', 3]]);
  });

  test('an integer and a boolean value', () => {
    const { ce } = engine(`let f = (t: real) => hostCount(t) + 1
let g = (t: real) => if hostPositive(t) { 1 } else { 2 }`);
    expect(compiled(fn(ce, 'f')).run(2.7)).toBe(3);
    const { run } = compiled(fn(ce, 'g'));
    expect(run(1)).toBe(1);
    expect(run(-1)).toBe(2);
  });

  test('a call that evaluate leaves unevaluated is NaN, and one call', () => {
    const { ce } = engine('');
    let count = 0;
    ce.declare('hostMaybe', {
      signature: '(real) -> real',
      evaluate: (ops) => {
        count++;
        return ops[0].re > 0 ? ce.number(1) : undefined;
      },
    });
    ce.declare('u', 'real');
    const result = compile(ce.box(['Add', ['hostMaybe', 'u'], 1]), {
      fallback: false,
    });
    expect((result.run as (a: object) => number)({ u: -1 })).toBeNaN();
    expect(count).toBe(1);
  });

  test('a call in a Map callback is made for each element (known limitation)', () => {
    const { ce, calls } = engine('');
    ce.declare('u', 'real');
    const e = ce.box([
      'First',
      [
        'Map',
        ['Function', ['hostSq', ['Multiply', 'x', 'u']], 'x'],
        ['List', 1, 2, 3],
      ],
    ]);
    const result = compile(e, { fallback: false });
    expect((result.run as (a: object) => number)({ u: 2 })).toBe(4);
    expect(calls.length).toBe(3);
  });

  test('an exact value is read as its number', () => {
    const { ce } = engine('');
    ce.declare('hostRoot', {
      signature: '(real) -> real',
      evaluate: (ops) => ops[0].sqrt(),
    });
    ce.declare('u', 'real');
    const result = compile(ce.box(['hostRoot', 'u']), { fallback: false });
    expect((result.run as (a: object) => number)({ u: 3 })).toBeCloseTo(
      Math.sqrt(3),
      15
    );
  });

  test('load() and the batch loaders refuse the code', async () => {
    const { ce } = engine('let f = (t: real) => hostSq(t)');
    const { result } = compiled(fn(ce, 'f'));
    const runtime = createJavaScriptRuntime();
    const refused = /calls the function "hostSq" of the host/;
    expect(() => runtime.load(result as never)).toThrow(refused);
    ce.declare('u', 'real');
    const e = compile(ce.box(['Add', ['hostSq', 'u'], 1]), { fallback: false });
    expect(e.hostCalls).toEqual(['hostSq']);
    expect(() => runtime.loadBroadcast(e as never)).toThrow(refused);
    expect(() => runtime.loadBroadcastAsync(e as never)).toThrow(refused);
  });

  test('the engine interprets the function for its own compilations', () => {
    const { ce, calls } = engine('let f = (t: real) => hostSq(t)');
    expect(implicitCompile(ce, fn(ce, 'f'), 'map')).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test('the code calls the definition that the call was bound to', () => {
    const { ce } = engine('let f = (t: real) => hostSq(t)');
    const { run } = compiled(fn(ce, 'f'));
    ce.pushScope();
    try {
      ce.declare('hostSq', {
        signature: '(real) -> real',
        evaluate: () => ce.number(0),
      });
      expect(run(2)).toBe(4);
    } finally {
      ce.popScope();
    }
    // A definition of a scope that is popped before the compilation.
    ce.declare('y', 'real');
    ce.pushScope();
    ce.declare('Sqrt', {
      signature: '(real) -> real',
      evaluate: ([x], { engine }) => engine.number(x.re + 100),
    });
    const u = ce.box(['Sqrt', 'y']);
    ce.popScope();
    const result = compile(u, { fallback: false });
    expect(result.hostCalls).toEqual(['Sqrt']);
    expect((result.run as (a: object) => number)({ y: 4 })).toBe(104);
  });
});

describe('a call of a function of the host that declines', () => {
  test('a value Nothing read as an element', () => {
    const { ce } = engine('let f = (t: real) => [hostDraw(t)]');
    expect(declined(fn(ce, 'f'))).toMatch(/whose value Nothing is read/);
  });

  test('a list argument that the interpreter holds as a Range (CE-1807)', () => {
    // The interpreter passes the `List` of the elements of the `Range` to a
    // function of the host, and so does the code
    // (`host-lazy-arguments-ce1807.test.ts`).
    const { ce, calls } = engine('let f = (t: real) => hostDraw(1..3)');
    const { run } = compiled(fn(ce, 'f'));
    run(0);
    expect(calls).toEqual([['draw', ['List', 1, 2, 3]]]);
  });

  test('a value of type any', () => {
    const { ce } = engine('let f = (t: real) => hostAny(t) + 1');
    expect(declined(fn(ce, 'f'))).toMatch(/of type any/);
  });

  test('more than four arguments', () => {
    const { ce } = engine('let f = (t: real) => hostFive(t, t, t, t, t)');
    expect(declined(fn(ce, 'f'))).toMatch(/more than 4 arguments/);
  });

  test('a function that assigns a list variable of the engine', () => {
    const { ce, calls } = engine(`let L = [0.5]
let f = (t: real) => do { L = L + [t]; hostDraw(t) }`);
    expect(declined(fn(ce, 'f'))).toMatch(
      /in a function that assigns the list variable L of the engine/
    );
    expect(calls).toEqual([]);
  });

  test('the GLSL and interval targets', () => {
    const { ce } = engine('let f = (t: real) => hostSq(t) + 1');
    const body = fn(ce, 'f');
    const glsl = compile(body, { to: 'glsl' });
    expect(glsl.success).toBe(false);
    expect(glsl.diagnostic?.message ?? '').toMatch(
      /of the host, on this target/
    );
    expect(compile(body, { to: 'interval-javascript' }).success).toBe(false);
  });
});
