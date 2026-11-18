/**
 * A compiled JavaScript runner evaluates the preamble definitions that read
 * no per-call binding ONCE, when the runner is built, instead of on every
 * call (`BaseCompiler.splitPreambleDefs`, `twoStageRunner` in
 * `javascript-target.ts`). A folded symbol value is pure by construction, so
 * only a free symbol read from the vars object (`_.x`) can make it differ
 * between calls; every other definition is the same on every call, and
 * rebuilding it per call repeated its whole construction (a 22 500-element
 * board rebuilt per sampled pixel).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

describe('COMPILE — preamble definitions evaluated once per artifact', () => {
  beforeEach(() => ce.pushScope());
  afterEach(() => ce.popScope());

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

  test('lambda route: every value it can hold is closed, so it hoists', () => {
    // On the lambda route a folded value cannot read a per-call binding at
    // all. A free symbol has no channel there (a compiled lambda takes only
    // its declared parameters), and a value that SPELLS one of those
    // parameters fails closed: the value keeps the binding it was written
    // against (ruled 2026-09-21), which is the global name, and the lambda
    // cannot supply it. So the definitions here are closed and hoistable.
    //
    // A list with a symbolic element is emitted as a definition (a closed
    // scalar value would fold to a literal and leave nothing to hoist).
    ce.assign('lst', ce.box(['List', ['Sqrt', 2], 3]));
    // A run-time index keeps the read in the emitted code (a literal index
    // is answered at canonicalization).
    const index = ['Floor', ['Divide', ['Add', 'x', 3], 2]];
    const r = compile(
      ce.box(['Function', ['Add', ['At', 'lst', index], 'x'], 'x']),
      { to: 'javascript', fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    const f = r.run as (x: number) => number;
    expect(f(1)).toBe(4);
    expect(f(2)).toBe(5);
  });

  test('a value that reads the vars object stays per call beside a hoisted one', () => {
    ce.assign('dbl', ce.box(['Multiply', 'x', 2]));
    ce.assign('lst', ce.box(['List', ['Sqrt', 2], 3]));
    const index = ['Floor', ['Divide', ['Add', 'x', 3], 2]];
    const r = compile(ce.box(['Add', 'dbl', ['At', 'lst', index], 'x']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const f = r.run as (v: any) => number;
    expect(f({ x: 1 })).toBe(6);
    expect(f({ x: 2 })).toBe(9);
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
});
