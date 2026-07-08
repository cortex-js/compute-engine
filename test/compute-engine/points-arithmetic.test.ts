import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Vector-space semantics for numeric tuples (points/vectors in ℝⁿ).
 * See docs/plans/2026-07-07-tuple-point-semantics.md.
 *
 * A numeric tuple — `Tuple`/`Pair`/`Triple` whose elements are all
 * number-typed — is a point/vector, semantically distinct from a List:
 * - `tuple ± tuple` (equal arity) → Tuple, component-wise
 * - `scalar · tuple`, `tuple / scalar`, `−tuple` → Tuple
 * - `scalar + tuple`, `tuple · tuple`, `scalar / tuple` → Error
 * Results stay Tuple (never degrade to List) and report tuple types.
 */

/** The `incompatible-type` (or other) code of an `Error` expression, if any. */
function errorCode(expr: BoxedExpression): string | undefined {
  if (expr.operator !== 'Error') return undefined;
  const code = expr.op1;
  if (code.operator === 'ErrorCode') return code.op1.string ?? undefined;
  return code.string ?? undefined;
}

describe('POINT/TUPLE ARITHMETIC — T1 literal component-wise', () => {
  test('(1,2) + (3,4) → (4, 6)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)+(3,4)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(4, 6)');
    expect(r.type.toString()).toBe('tuple<finite_integer, finite_integer>');

    const n = ce.parse('(1,2)+(3,4)').N();
    expect(n.operator).toBe('Tuple');
    expect(n.toString()).toBe('(4, 6)');
  });

  test('(1,2) − (3,4) → (-2, -2)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)-(3,4)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(-2, -2)');
    expect(r.type.toString()).toBe('tuple<finite_integer, finite_integer>');

    const n = ce.parse('(1,2)-(3,4)').N();
    expect(n.operator).toBe('Tuple');
    expect(n.toString()).toBe('(-2, -2)');
  });

  test('−(3,4) → (-3, -4)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('-(3,4)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(-3, -4)');
    expect(r.type.toString()).toBe('tuple<finite_integer, finite_integer>');

    const n = ce.parse('-(3,4)').N();
    expect(n.operator).toBe('Tuple');
    expect(n.toString()).toBe('(-3, -4)');
  });

  test('2·(1,2) → (2, 4)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('2(1,2)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(2, 4)');
    expect(r.type.toString()).toBe('tuple<finite_integer, finite_integer>');

    const n = ce.parse('2(1,2)').N();
    expect(n.operator).toBe('Tuple');
    expect(n.toString()).toBe('(2, 4)');
  });

  test('(1,2) / 2 → (1/2, 1)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)/2').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(1/2, 1)');
    expect(r.type.toString()).toBe('tuple<finite_rational, finite_integer>');
  });

  test('(1,2) / 3 stays exact under evaluate, numericizes under N()', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)/3').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(1/3, 2/3)');
    expect(r.type.toString()).toBe('tuple<finite_rational, finite_rational>');

    const n = ce.parse('(1,2)/3').N();
    expect(n.operator).toBe('Tuple');
    // Each component is a float
    expect(n.op1.re).toBeCloseTo(1 / 3, 10);
    expect(n.op2.re).toBeCloseTo(2 / 3, 10);
  });

  test('exactness: (1,2)+(√2, 1) keeps radicals symbolic', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['Tuple', 1, 2], ['Tuple', ['Sqrt', 2], 1]]).evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.op1.toString()).toBe('1 + sqrt(2)');
    expect(r.op2.toString()).toBe('3');
  });

  test('unequal arity → Error at evaluation', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)+(1,2,3)').evaluate();
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('Pair/Triple canonicalize to Tuple and add component-wise', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['Pair', 1, 2], ['Pair', 3, 4]]).evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(4, 6)');
  });
});

describe('POINT/TUPLE ARITHMETIC — T2 rejected operations', () => {
  test('1 + (2,3) → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('1+(2,3)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('(2,3) + 1 → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(2,3)+1');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('(1,2) · (3,4) → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)\\cdot(3,4)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('1 / (2,3) → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('1/(2,3)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  test('(1,2) / (3,4) → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)/(3,4)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });
});

describe('POINT/TUPLE ARITHMETIC — T3 symbolic / typed tuples', () => {
  test('z + (1,2) is a valid symbolic Add with tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    const r = ce.parse('z+(1,2)');
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Add');
    expect(r.type.toString()).toBe('tuple<number, number>');
  });

  test('2·z is a valid symbolic Multiply with tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    const r = ce.parse('2\\cdot z');
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Multiply');
    expect(r.type.toString()).toBe('tuple<number, number>');
  });

  test('Negate(z) keeps the tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    const r = ce.box(['Negate', 'z']);
    expect(r.isValid).toBe(true);
    expect(r.type.toString()).toBe('tuple<number, number>');
  });

  test('z + (1,2) survives strict re-validation (still valid)', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    const r = ce.parse('z+(1,2)');
    // Re-boxing / re-validating must not invalidate it.
    const r2 = ce.box(r.json);
    expect(r2.isValid).toBe(true);
    expect(r2.type.toString()).toBe('tuple<number, number>');
  });

  test('symbolic + assigned tuple evaluates component-wise', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    ce.assign('z', ce.tuple(10, 20));
    const r = ce.parse('z+(1,2)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(11, 22)');
  });

  test('statically-known unequal arity (z + w) errors at evaluation', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    ce.declare('w', ce.type('tuple<number, number, number>'));
    const r = ce.parse('z+w');
    // Canonical form stays valid (deferred), errors at evaluation.
    expect(r.isValid).toBe(true);
    const e = r.evaluate();
    expect(e.operator).toBe('Error');
    expect(errorCode(e)).toBe('incompatible-type');
  });
});

describe('POINT/TUPLE ARITHMETIC — follow-up defects', () => {
  // Defect 1: `typeCouldBeNumericTuple` must be could-based, not prove-based.
  // A tuple whose elements are `any` (member access on an undeclared symbol)
  // must stay symbolic instead of erroring in `checkNumericArgs`.
  test('scalar · (undeclared.x, undeclared.y) stays valid & symbolic', () => {
    const ce = new ComputeEngine();
    // `w_0` is UNDECLARED, so `(w_0.x, w_0.y)` types as `tuple<any, any>`.
    const r = ce.parse('t^{2}\\cdot\\left(w_{0}.x,w_{0}.y\\right)');
    expect(r.isValid).toBe(true);
    expect(r.operator).not.toBe('Error');
  });

  test('a numeric tuple with any-typed components is admitted by validation', () => {
    const ce = new ComputeEngine();
    // Add of an unknown-result function and an any-element tuple.
    const r = ce.parse('\\left(a.x, a.y\\right)+\\left(1,2\\right)');
    expect(r.isValid).toBe(true);
    expect(r.operator).not.toBe('Error');
  });

  // Defect 2: mixed unknown + tuple must not claim `number`.
  test('Q(u) + (1,2) is valid and does NOT report type `number`', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('Q(u)+(1,2)');
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Add');
    // Honest widened type — must not collapse to the scalar `number`.
    expect(r.type.toString()).not.toBe('number');
  });

  // Defect 2: an INFERRED numeric return type is retractable evidence, not
  // proof — a `scalar + tuple` guard must NOT fire on it. (A function defined
  // via `:=` with a numeric body gets an inferred signature returning
  // `number`; mixing its call result with a tuple must stay symbolic.)
  test('inferred-return function + tuple stays a valid symbolic Add', () => {
    const ce = new ComputeEngine(); // fresh engine — avoid type pollution
    // `F` gets an INFERRED signature `(number) -> number`.
    ce.parse('F(x)\\coloneq x+1').evaluate();
    expect(ce.parse('F(x)').operatorDefinition?.inferredSignature).toBe(true);

    const r = ce.parse('F(x)+(1,2)');
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Add');
    expect(r.type.toString()).not.toBe('number');
  });

  // Contrast: an EXPLICITLY DECLARED scalar return is provable — the
  // `scalar + tuple` guard SHOULD fire.
  test('declared-scalar-return function + tuple is rejected', () => {
    const ce = new ComputeEngine();
    ce.declare('G', ce.type('(number) -> number'));
    const r = ce.parse('G(x)+(1,2)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('incompatible-type');
  });

  // Literals remain provable scalars — the existing rejections must survive.
  test('literal scalar + tuple still errors', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('1+(2,3)').operator).toBe('Error');
    expect(ce.parse('(2,3)+1').operator).toBe('Error');
  });
});

describe('POINT/TUPLE ARITHMETIC — T3 end-to-end (needs T4)', () => {
  // `t^2·(z.x, z.y)` requires T4 (First/Second typing on tuple-typed symbols)
  // to type `z.x` as `number` so `(z.x, z.y)` is a numeric tuple.
  test('t^2·(z.x, z.y) canonicalizes valid', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    ce.declare('t', 'number');
    const r = ce.parse('t^2\\cdot(z.x, z.y)');
    expect(r.isValid).toBe(true);
    expect(r.type.toString()).toBe('tuple<number, number>');
  });
});
