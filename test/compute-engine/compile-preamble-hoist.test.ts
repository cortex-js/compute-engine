/**
 * A compiled JavaScript runner evaluates the preamble definitions that read
 * no per-call binding ONCE, when the runner is built, instead of on every
 * call (`BaseCompiler.splitPreambleDefs`, `twoStageRunner` in
 * `javascript-target.ts`). A folded symbol value is pure by construction, so
 * only a free symbol read from the vars object (`_.x`) or, on the lambda
 * route, a lambda parameter can make it differ between calls; every other
 * definition is the same on every call, and rebuilding it per call repeated
 * its whole construction (a 22 500-element board rebuilt per sampled pixel).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE — preamble definitions evaluated once per artifact', () => {
  beforeEach(() => ce.pushScope());
  afterEach(() => ce.popScope());

  test('a value built through caller-supplied source stays per call', () => {
    // `tick` is a caller mapping (`functions`), so the value `a := tick() + 2`
    // reaches live source and is NOT hoisted: the caller's function runs on
    // every call, as it did before.
    (globalThis as any).__ceHoistCalls = 0;
    ce.declare('tick', { signature: '() -> integer', pure: true });
    ce.assign('a', ce.box(['Add', ['tick'], 2]));
    const r = compile(ce.box(['Add', 'a', 'x']), {
      to: 'javascript',
      fallback: false,
      preamble: 'function tick() { globalThis.__ceHoistCalls += 1; return 1; }',
      functions: { tick: 'tick' },
    } as any);
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => number;
    expect(f({ x: 1 })).toBe(4);
    expect(f({ x: 2 })).toBe(5);
    expect(f({ x: 3 })).toBe(6);
    expect((globalThis as any).__ceHoistCalls).toBe(3);
    // The consumer-facing text keeps the single-body form.
    expect(r.preamble).toContain('const _val_a = ');
    expect(r.code).toBe('_val_a + _.x');
  });

  test('a value reading a string-valued `vars` mapping stays live', () => {
    (globalThis as any).__ceLiveX = 10;
    ce.assign('lv', ce.box(['Add', 'x', 1]));
    const r = compile(ce.box(['Multiply', 'lv', 2]), {
      to: 'javascript',
      fallback: false,
      vars: { x: 'globalThis.__ceLiveX' },
    } as any);
    expect(r.success).toBe(true);
    const f = r.run as (v?: any) => number;
    expect(f({})).toBe(22);
    (globalThis as any).__ceLiveX = 20;
    expect(f({})).toBe(42);
  });

  test('a value that reads a free symbol is rebuilt on every call', () => {
    ce.assign('b', ce.box(['Multiply', ['Add', 'x', 1], ['Add', 'x', 1]]));
    const r = compile(ce.box(['Add', 'b', 'b', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => number;
    expect(f({ x: 1 })).toBe(9);
    expect(f({ x: 2 })).toBe(19);
  });

  test('a value that reads a free symbol through a user function stays per call', () => {
    ce.assign('g', ce.parse('t \\mapsto t + x'));
    ce.assign('c', ce.box(['Add', ['g', 2], ['g', 3]]));
    const r = compile(ce.box(['Multiply', 'c', 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => number;
    expect(f({ x: 1 })).toBe(7);
    expect(f({ x: 10 })).toBe(25);
  });

  test('a caller preamble that reads the vars object keeps every definition per call', () => {
    (globalThis as any).__ceHoistCalls2 = 0;
    ce.declare('tick2', { signature: '() -> integer', pure: true });
    ce.assign('d', ce.box(['Add', ['tick2'], 2]));
    const r = compile(ce.box(['Add', 'd', 'x']), {
      to: 'javascript',
      fallback: false,
      preamble:
        'function tick2() { globalThis.__ceHoistCalls2 += 1; return _.x; }',
      functions: { tick2: 'tick2' },
    } as any);
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => number;
    expect(f({ x: 1 })).toBe(4);
    expect(f({ x: 5 })).toBe(12);
    expect((globalThis as any).__ceHoistCalls2).toBe(2);
  });

  test('lambda route: a value that reads the parameter stays per call, one that does not is hoisted', () => {
    ce.assign('dbl', ce.box(['Multiply', 'x', 2]));
    // A list with a symbolic element is emitted as a definition (a closed
    // scalar value would fold to a literal and leave nothing to hoist).
    ce.assign('lst', ce.box(['List', ['Sqrt', 2], 3]));
    // A run-time index keeps the read in the emitted code (a literal index
    // is answered at canonicalization).
    const index = ['Floor', ['Divide', ['Add', 'x', 3], 2]];
    const r = compile(
      ce.box(['Function', ['Add', 'dbl', ['At', 'lst', index], 'x'], 'x']),
      { to: 'javascript', fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    const f = r.run as (x: number) => number;
    expect(f(1)).toBe(6);
    expect(f(2)).toBe(9);
    expect(r.code).toContain('const _val_dbl = 2 * x');
    expect(r.code).toContain('const _val_lst = ');
    // The serialized runner is self-contained: the hoisted definition is in
    // the body text too.
    expect(String(r.run)).toContain('const _val_lst = ');
    expect(String(r.run)).toContain('const _val_dbl = 2 * x');
  });

  test('a complex cell of a hoisted list cannot be changed by a caller', () => {
    ce.assign('cl', ce.box(['List', ['Complex', 1, 2], 3]));
    const r = compile(ce.box(['Add', 'cl', 'x']), {
      to: 'javascript',
      fallback: false,
      constantFold: false,
    } as any);
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => any;
    const first = f({ x: 0 });
    expect(first).toEqual([{ re: 1, im: 2 }, 3]);
    first[0].re = 100;
    expect(f({ x: 0 })).toEqual([{ re: 1, im: 2 }, 3]);
  });

  test('a large comprehension value indexed by free symbols is not rebuilt per call', () => {
    // Each element sums 50 terms: rebuilding the list costs about a million
    // iterations, tens of milliseconds per call. Hoisted, 100 calls index
    // into the one list and finish in well under a tenth of that.
    ce.assign(
      'S',
      ce.box([
        'Comprehension',
        ['Sum', ['Multiply', 'k', 'i'], ['Limits', 'i', 1, 50]],
        ['Element', 'k', ['Range', 1, 20000]],
      ])
    );
    const r = compile(ce.box(['At', 'S', ['Add', ['Floor', 'x'], 1]]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.preamble).toContain('let _val_S;');
    expect(r.preamble).not.toContain('(() =>');
    const f = r.run as (v: any) => number;
    expect(f({ x: 2.5 })).toBe(3 * 1275);
    expect(f({ x: 99 })).toBe(100 * 1275);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) f({ x: i });
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
