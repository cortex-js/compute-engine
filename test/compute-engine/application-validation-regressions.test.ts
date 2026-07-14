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

describe('complex-family parameters are enforced (D10 shim retired)', () => {
  // Before, `signatureHasComplexParam` (box.ts) skipped declared-signature
  // enforcement entirely for complex-family parameters, because Multiply
  // widened a pure-imaginary product such as `√2·i` to `finite_number`,
  // which is ⊄ `complex`. Now the arithmetic type handlers are
  // complex-aware (`√2·i` types as `imaginary` ⊂ `complex`), so the skip is
  // gone and `(complex) -> complex` signatures are enforced like any other.

  it('f(√2·i) is valid under (complex) -> complex (the original shim motivation)', () => {
    const ce = strictEngine();
    ce.declare('f', '(complex) -> complex');
    expect(
      ce.box(['f', ['Multiply', 'ImaginaryUnit', ['Sqrt', 2]]]).isValid
    ).toBe(true);
  });

  it('real/integer arguments satisfy a complex parameter (D10: real ⊂ complex)', () => {
    const ce = strictEngine();
    ce.declare('f', '(complex) -> complex');
    expect(ce.box(['f', 3]).isValid).toBe(true);
    expect(ce.box(['f', 0.5]).isValid).toBe(true);
  });

  it('other closed complex constants are accepted (i/2, e^i, i^3, ln(−1))', () => {
    const ce = strictEngine();
    ce.declare('f', '(complex) -> complex');
    expect(ce.box(['f', ['Divide', 'ImaginaryUnit', 2]]).isValid).toBe(true);
    expect(ce.box(['f', ['Exp', 'ImaginaryUnit']]).isValid).toBe(true);
    expect(ce.box(['f', ['Power', 'ImaginaryUnit', 3]]).isValid).toBe(true);
    expect(ce.box(['f', ['Ln', -1]]).isValid).toBe(true);
  });

  it('enforcement is actually active: f("a") is invalid under (complex) -> complex', () => {
    // With the old skip, ANY argument — even a string — was accepted.
    const ce = strictEngine();
    ce.declare('f', '(complex) -> complex');
    expect(ce.box(['f', "'a'"]).isValid).toBe(false);
  });

  it('a free-variable argument still defers', () => {
    const ce = strictEngine();
    ce.declare('f', '(complex) -> complex');
    expect(ce.box(['f', 'someUnknown']).isValid).toBe(true);
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
    // The Derivative type handler preserves the derived function's signature
    // (a derivative of Sin is itself `(number) -> number`), so the type is a
    // concrete signature, not the bare `function` it reported before.
    const ce = strictEngine();
    const t = ce.box(['Derivative', 'Sin']).type;
    expect(t.matches('function')).toBe(true);
    expect(t.toString()).toBe('(number) -> number');
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

describe('non-strict mode degrades missing arguments gracefully (not a raw JS undefined)', () => {
  // Regression: the non-strict "fastpath" branches of `checkArity`,
  // `checkNumericArgs`, and `validateArguments` (boxed-expression/validate.ts)
  // used to return the operand array unpadded when an argument was missing.
  // A fixed-arity `canonical`/`evaluate` handler that destructures `ops[0]`
  // (or `ops[1]`) then got a raw JS `undefined` instead of a boxed
  // `Error("missing")` expression. For `Sin()` this didn't even throw: the
  // handler silently built a new `Sin` expression around that `undefined`,
  // and printing it surfaced the operand as the literal text "[undefined]"
  // (`ce.expr(['Sin']).evaluate().toString()` -> `"sin([undefined])"`)
  // instead of an `Error` MathJSON node. Other operators (`Negate`, `Power`,
  // `Arctan`, ...) crashed outright with "Cannot read properties of
  // undefined".
  function nonStrictEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.strict = false;
    return ce;
  }

  it('Sin() does not surface a raw "undefined" operand', () => {
    const ce = nonStrictEngine();
    const e = ce.expr(['Sin']);
    expect(() => e.evaluate().toString()).not.toThrow();
    expect(e.evaluate().toString()).not.toContain('undefined');
    expect(e.json).toEqual(['Sin', ['Error', "'missing'"]]);
  });

  it('Negate() does not throw and pads the missing operand', () => {
    const ce = nonStrictEngine();
    const e = ce.expr(['Negate']);
    expect(() => e.evaluate()).not.toThrow();
    expect(e.json).toEqual(['Negate', ['Error', "'missing'"]]);
  });

  it('Power(2) (missing exponent) does not throw and pads the missing operand', () => {
    const ce = nonStrictEngine();
    const e = ce.expr(['Power', 2]);
    expect(() => e.evaluate()).not.toThrow();
    expect(e.json).toEqual(['Power', 2, ['Error', "'missing'"]]);
  });

  it('Arctan() (generic signature-validated operator) does not throw', () => {
    const ce = nonStrictEngine();
    const e = ce.expr(['Arctan']);
    expect(() => e.evaluate()).not.toThrow();
    expect(e.json).toEqual(['Arctan', ['Error', "'missing'"]]);
  });

  it('Add() (variadic, no missing-arg case) still evaluates to the identity', () => {
    // Sanity check: operators with no fixed minimum arity (Add, Multiply)
    // are unaffected by the padding fix.
    const ce = nonStrictEngine();
    expect(ce.expr(['Add']).evaluate().isSame(0)).toBe(true);
    expect(ce.expr(['Multiply']).evaluate().isSame(1)).toBe(true);
  });

  it('matches strict mode structurally (Error/Missing shape) for the same input', () => {
    const strict = strictEngine();
    const nonStrict = nonStrictEngine();
    expect(nonStrict.expr(['Sin']).json).toEqual(strict.expr(['Sin']).json);
    expect(nonStrict.expr(['Negate']).json).toEqual(
      strict.expr(['Negate']).json
    );
  });
});
