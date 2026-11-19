import { typeWithFacts } from '../../src/compute-engine/boxed-expression/constraint-subject';
/**
 * Regression tests for compiling expressions that reference a symbol with an
 * **assigned value** in the engine (`ce.assign("a", 1.5)`).
 *
 * Such a symbol is omitted from `expr.unknowns` and folded by `evaluate()`.
 * `compile()` must agree: the compiled function gives the value the
 * interpreter gives with the assigned value in place.
 *
 * The one exception is an explicit `vars` mapping: a mapped symbol stays a
 * live input, read at run time, also when it is reached through another
 * assigned value or a user-function body.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isValueDef } from '../../src/compute-engine/boxed-expression/definition-guards';
import {
  withDeclaredTypeOnly,
  withShieldedValues,
} from '../../src/compute-engine/boxed-expression/constraint-subject';

/** `compile()` to `interval-js`, with the call shape of a target's `compile()`. */
const INTERVAL_JS = {
  compile: (expr: any, options: Record<string, unknown> = {}) =>
    compile(expr, { ...options, to: 'interval-js' } as any) as any,
};

describe('COMPILE: assigned-symbol folding', () => {
  describe('interval-js target', () => {
    it('folds an assigned value into an interval point', () => {
      const ce = new ComputeEngine();
      ce.assign('a', 1.5);
      const t = INTERVAL_JS;
      const { run } = t.compile(ce.parse('a x'));
      // x = 2 → [3, 3]
      const r = run!({ x: 2 }) as { value: { lo: number; hi: number } };
      expect(r.value.lo).toBeCloseTo(3, 12);
      expect(r.value.hi).toBeCloseTo(3, 12);
    });
  });

  it('compile() agrees with evaluate() on an assigned symbolic value', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.parse('\\pi/2'));
    const r = compile(ce.parse('\\sin(a x)'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ x: 1 })).toBeCloseTo(1, 12);
  });

  // A symbol assigned a *symbolic* value whose value itself references a free
  // symbol (`b = c + 1`, then compile `b·x`): the compound value keeps its
  // grouping, and the inner free symbol `c` is an input.
  it('a compound assigned value keeps its grouping and reads its free symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('b', ce.parse('c + 1'));
    const run = (src: string) =>
      compile(ce.parse(src), { fallback: false }).run!({ c: 2, x: 3 });
    expect(run('b x')).toBe(9); // (2+1)*3
    expect(run('2b')).toBe(6); // 2*(2+1)
    expect(run('b^2')).toBe(9); // (2+1)^2
  });
});

describe('COMPILE: non-finite numbers on GPU targets', () => {
  it('the free compile() reports success:true', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('x + \\infty'), { to: 'glsl' });
    expect(r.success).toBe(true);
  });
});

/**
 * A `vars`-mapped input reached THROUGH an assigned value or a user-function
 * body (Tycho item 328, 2026-09-28): the value is compiled as code that reads
 * the input, never folded with the input's current value.
 */
describe('COMPILE: a mapped input reached through an assigned value (item 328)', () => {
  // `y_0` holds a value AND is mapped: the shape that folded.
  function engine() {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('y_0', 'real');
    ce.assign('y_0', ce.box(0.5));
    ce.assign('a', ce.parse('\\sin(y_0)'));
    ce.declare('u', '(real) -> real');
    ce.assign('u', ce.parse('L \\mapsto 2L - a'));
    return ce;
  }
  const vars = { y_0: '_.y_0' };

  it('a call with a constant argument reads the input through the body', () => {
    const ce = engine();
    const r = compile(ce.parse('u(1)'), { vars, fallback: false });
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(2 - Math.sin(0.5), 12);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(2 - Math.sin(1), 12);
  });

  it('a definite integral over such a value reads the input at run time', () => {
    const ce = engine();
    const r = compile(ce.parse('\\int_0^1 a x\\,dx'), {
      vars,
      fallback: false,
    });
    expect(r.run!({ y_0: 0.5 })).toBeCloseTo(Math.sin(0.5) / 2, 8);
    expect(r.run!({ y_0: 1 })).toBeCloseTo(Math.sin(1) / 2, 8);
  });
});

/**
 * A `vars`-mapped symbol with a DECLARED type compiles as the valueless input
 * of that type, even when it holds a value (Tycho row 354, 2026-10-01). The
 * value is restored afterwards.
 */
describe('COMPILE: a declared vars-mapped input compiles as if it had no value (row 354)', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('a', 'real');
    ce.declare('x', 'real');
    ce.assign('a', 4);
    return ce;
  }

  it('√a keeps the complex lane of a real input', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sqrt{a}'), {
      vars: { a: '_.a' },
      mode: 'complex',
      fallback: false,
    } as never);
    expect(r.run!({ a: -4 })).toEqual({ re: 0, im: 2 });
    expect(r.run!({ a: 4 })).toBe(2);
    // The value is back, with the facts it implies.
    expect(ce.symbol('a').value?.re).toBe(4);
    expect(ce.symbol('a').isPositive).toBe(true);
  });

  it('an integral over a mapped input reads the input (row 355)', () => {
    const ce = engine();
    const r = compile(ce.parse('\\int_0^x a t\\,dt'), {
      vars: { a: '_.a' },
      fallback: false,
    });
    expect(r.run!({ a: -2, x: 3 })).toBeCloseTo(-9, 12);
  });

  it('the compile marker hides proof evidence while the value shield preserves it', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('a', 'real');
    ce.assume(ce.parse('a = 4'));
    const def = ce.lookupDefinition('a')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const defs = new Set([def.value]);
    expect(typeWithFacts(ce.symbol('a')).toString()).toBe('integer');
    expect(withShieldedValues(defs, () => typeWithFacts(ce.symbol('a')).toString())).toBe(
      'integer'
    );
    expect(withDeclaredTypeOnly(defs, () => typeWithFacts(ce.symbol('a')).toString())).toBe(
      'real'
    );
    expect(typeWithFacts(ce.symbol('a')).toString()).toBe('integer');
  });
});
