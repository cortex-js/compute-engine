import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the application-boundary validation / typing cluster
 * (SYMBOLIC_FINDINGS SYM P1-14, P1-15, P1-19, P1-20).
 *
 * These cover the gap where a function application was accepted as `isValid`
 * (and sometimes produced a wrong value) despite ill-typed arguments, because
 * custom canonical handlers only checked arity, user-declared function
 * signatures were never enforced, and higher-order / big-op operators lifted
 * or coerced arguments that should have been rejected.
 */

function strictEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.strict = true;
  return ce;
}

describe('SYM P1-14 — numeric operators validate their arguments', () => {
  it('Sin("hello") is invalid in strict mode', () => {
    const ce = strictEngine();
    expect(ce.box(['Sin', "'hello'"]).isValid).toBe(false);
  });

  it('Sin(x) for an untyped symbol stays valid', () => {
    const ce = strictEngine();
    expect(ce.box(['Sin', 'x']).isValid).toBe(true);
  });

  it('Sin of a list (threadable) stays valid', () => {
    const ce = strictEngine();
    expect(ce.box(['Sin', ['List', 1, 2, 3]]).isValid).toBe(true);
  });

  it('a numeric bound that is a union with a collection is not rejected', () => {
    // `Max(_q, 2)` types as `number | list`; `Range` must still accept it —
    // this is the leniency that keeps the fungrim DirichletGroup rule valid.
    const ce = strictEngine();
    const e = ce.box(['Range', 1, ['Add', ['Max', 'q', 2], -1]]);
    expect(e.isValid).toBe(true);
  });

  it('Factorial(1/2) is valid and computes Γ(3/2), typed as a real (not integer)', () => {
    const ce = strictEngine();
    const f = ce.box(['Factorial', ['Rational', 1, 2]]);
    expect(f.isValid).toBe(true);
    expect(f.type.toString()).toBe('finite_real');
    expect(f.N().re).toBeCloseTo(0.8862269254527586, 10);
  });

  it('Factorial(5) stays a finite integer and evaluates to 120', () => {
    const ce = strictEngine();
    const f = ce.box(['Factorial', 5]);
    expect(f.type.toString()).toBe('finite_integer');
    expect(f.evaluate().re).toBe(120);
  });

  it('Factorial(i) is valid and complex', () => {
    const ce = strictEngine();
    const f = ce.box(['Factorial', 'ImaginaryUnit']);
    expect(f.isValid).toBe(true);
    expect(f.type.matches('number')).toBe(true);
    // Γ(1+i)
    expect(f.N().im).toBeCloseTo(-0.15494982830181053, 8);
  });

  it('Factorial("x") is invalid in strict mode', () => {
    const ce = strictEngine();
    expect(ce.box(['Factorial', "'x'"]).isValid).toBe(false);
  });

  it('the strict-mode check does not fire in non-strict mode', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    expect(ce.box(['Sin', "'hello'"]).isValid).toBe(true);
  });
});

describe('SYM P1-15 — user-declared function signatures are enforced', () => {
  it('f(0.5) is invalid under (integer) -> integer', () => {
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    expect(ce.box(['f', 0.5]).isValid).toBe(false);
  });

  it('f("a") is invalid under (integer) -> integer', () => {
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    expect(ce.box(['f', "'a'"]).isValid).toBe(false);
  });

  it('f(3) is valid and keeps the declared result type', () => {
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    const app = ce.box(['f', 3]);
    expect(app.isValid).toBe(true);
    expect(app.type.toString()).toBe('integer');
  });

  it('f(unknown-symbol) is accepted (inferred later)', () => {
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    expect(ce.box(['f', 'someUnknown']).isValid).toBe(true);
  });

  it('a real number *literal* is rejected against an integer parameter', () => {
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    expect(ce.box(['f', 2.5]).isValid).toBe(false);
  });

  it('a symbolic (free-variable) argument defers rather than being rejected', () => {
    // Only *closed* operands (literals / constants) are eagerly checked; a
    // symbol with a broad declared type may satisfy the parameter at runtime,
    // and eagerly rejecting it would also break rule pattern variables (this
    // is what keeps the fungrim/rubi rule corpora boxing under enforcement).
    const ce = strictEngine();
    ce.declare('f', '(integer) -> integer');
    ce.declare('r', 'real');
    expect(ce.box(['f', 'r']).isValid).toBe(true);
  });

  it('does not enforce in non-strict mode', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    ce.declare('f', '(integer) -> integer');
    expect(ce.box(['f', 0.5]).isValid).toBe(true);
  });
});

describe('SYM P1-19 — higher-order result types are sound', () => {
  it('(a) a lambda over an unknown parameter does not claim a finite result', () => {
    // (x ↦ x²)(∞) = +∞, so the result type must widen to `number`.
    const ce = strictEngine();
    const lam = ce.box(['Function', ['Square', 'x'], 'x']);
    expect(lam.type.toString()).toBe('(unknown) -> number');
    expect(lam.type.matches('(any) -> finite_number')).toBe(false);
  });

  it('(b) Sum does not lift a function-literal integrand into a mistyped lambda', () => {
    const ce = strictEngine();
    const s = ce.box(['Sum', ['Function', '_1', '_1'], ['Tuple', 'n', 1, 3]]);
    // Previously evaluated to `3·((_) ↦ _)` typed `number`.
    expect(s.isValid).toBe(false);
    expect(s.evaluate().isSame(3)).toBe(false);
  });

  it('(c) an unevaluated Derivative is function-typed', () => {
    // NOTE: the *evaluated* closed form (`cos(_)`) still under-reports as
    // `finite_number` — see the residual documented in `Derivative.evaluate`.
    const ce = strictEngine();
    expect(ce.box(['Derivative', 'Sin']).type.toString()).toBe('function');
  });
});

describe('SYM P1-20 — big-op / map validation gaps', () => {
  it('Sum with a non-numeric bound does not silently evaluate (no 55)', () => {
    const ce = strictEngine();
    const s = ce.box(['Sum', 'x', ['Tuple', 'x', "'lo'", 10]]);
    expect(s.isValid).toBe(false);
    expect(s.evaluate().isSame(55)).toBe(false);
  });

  it('a non-numeric Sum bound is rejected in non-strict mode too', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    const s = ce.box(['Sum', 'x', ['Tuple', 'x', "'lo'", 10]]);
    expect(s.isValid).toBe(false);
    expect(s.evaluate().isSame(55)).toBe(false);
  });

  it('a symbolic (unknown) Sum bound is still accepted', () => {
    const ce = strictEngine();
    const s = ce.box(['Sum', 'x', ['Tuple', 'x', 'lo', 10]]);
    expect(s.isValid).toBe(true);
  });

  it('Map with a string "function" does not broadcast the string', () => {
    const ce = strictEngine();
    const m = ce.box(['Map', ['List', 1, 2, 3], "'nf'"]);
    const ev = m.evaluate();
    // Previously produced ["nf","nf","nf"]; now stays a symbolic Map.
    expect(ev.operator).toBe('Map');
  });

  it('Map with a real function still works', () => {
    const ce = strictEngine();
    const m = ce
      .box(['Map', ['List', 1, 2, 3], ['Function', ['Multiply', 2, 'x'], 'x']])
      .evaluate();
    expect(m.toString()).toBe('[2,4,6]');
  });
});
