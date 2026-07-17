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

  // Defect 3 (reported by Tycho against 0.69.1): serializing the CANONICAL,
  // unevaluated form of `scalar × tuple` overflowed the stack. The pretty-JSON
  // Multiply serializer round-trips through Product.asRationalExpression →
  // canonicalDivide, whose tuple branch returned an inert Divide(expr, 1)
  // instead of stripping the trivial divisor, so the numerator (the same
  // Multiply) re-entered the serializer forever.
  test('canonical scalar × tuple serializes without stack overflow', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('3(1,2)').latex).toBe('3(1,2)');
    expect(ce.box(['Multiply', 2, ['Tuple', 1, 2]]).latex).toBe('2(1,2)');
    expect(ce.box(['Multiply', 2, ['Tuple', 1, 2]]).toString()).toBe(
      '2(1, 2)'
    );
  });

  test('tuple-typed expression / ±1 strips the trivial divisor', () => {
    const ce = new ComputeEngine();
    const m: any = ['Multiply', 2, ['Tuple', 1, 2]];
    expect(ce.box(['Divide', m, 1]).json).toEqual(m);
    expect(ce.box(['Divide', m, -1]).json).toEqual([
      'Multiply',
      -2,
      ['Tuple', 1, 2],
    ]);
  });

  // Defect 4: juxtaposition with a tuple-TYPED symbol (`3z` with
  // `z: tuple<number, number>`) collapsed to a spurious `Tuple(3, z)` instead
  // of `Multiply` (scaling). Literal tuples were already handled; the
  // value-like test in canonicalInvisibleOperator missed numeric-tuple types.
  test('scalar · tuple-typed symbol juxtaposition is scaling, not Tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('z', ce.type('tuple<number, number>'));
    const r = ce.parse('3z');
    expect(r.json).toEqual(['Multiply', 3, 'z']);
    expect(r.latex).toBe('3z');
    ce.assign('z', ce.box(['Tuple', 1, 2]));
    expect(ce.parse('3z').evaluate().json).toEqual(['Tuple', 3, 6]);
  });

  test('scalar · heterogeneous-tuple-typed symbol still groups as Tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('w', ce.type('tuple<string, number>'));
    expect(ce.parse('3w').json).toEqual(['Tuple', 3, 'w']);
  });

  // Defect 5 (Tycho item 10): a symbol *declared* with an abstract
  // `indexed_collection` / `collection` type but not yet assigned a value
  // juxtaposed with a function call collapsed to a spurious `Tuple` instead of
  // `Multiply`. Its concrete subtypes (`list`, `vector`, …) already scaled, so
  // the abstract supertype was the inconsistent case. `set` (no scaling
  // semantics) and heterogeneous `tuple` must still group as `Tuple`.
  test('collection-typed symbol (no value) juxtaposition is Multiply', () => {
    const scaling = ['Multiply', 'y_r', ['Sin', 'a']];
    for (const type of [
      'indexed_collection',
      'indexed_collection<number>',
      'collection',
      'list',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('y_r', ce.type(type)); // declared, NO value
      ce.pushScope();
      ce.declare('x', { type: 'unknown' });
      expect(ce.parse('y_r\\sin\\left(a\\right)').json).toEqual(scaling);
    }
    // A non-indexed `set` has no scaling semantics: still a Tuple.
    const ce = new ComputeEngine();
    ce.declare('y_r', ce.type('set<number>'));
    ce.pushScope();
    ce.declare('x', { type: 'unknown' });
    expect(ce.parse('y_r\\sin\\left(a\\right)').json).toEqual([
      'Tuple',
      'y_r',
      ['Sin', 'a'],
    ]);
  });

  // Defect 6 (Tycho item 13): a symbol KNOWN to be a non-function value (a
  // number by declaration or assignment) juxtaposed against a parenthesized
  // expression whose body references a collection (`k(\cos(S))` with `S` a
  // list) parsed as `k` APPLIED to the body — an illegal application of a
  // number — instead of `k·\cos(S)`. The single-arg branch only treated a
  // scalar-numeric argument as multiplication; a collection-typed argument fell
  // through to the function-call heuristic even when the leading symbol could
  // not possibly be a function. An undeclared / unknown-typed symbol stays
  // genuinely ambiguous and keeps the `f(x)` function-application default.
  test('number-valued symbol · (collection arg) juxtaposition is Multiply', () => {
    const mul = ['Multiply', 'k', ['Cos', 'S']];

    // Declared with a concrete numeric type.
    {
      const ce = new ComputeEngine();
      ce.assign('S', ce.parse('\\left[1,2,3\\right]').evaluate());
      ce.declare('k', 'number');
      expect(ce.parse('k\\left(\\cos(S)\\right)').json).toEqual(mul);
    }

    // Assigned a numeric value (Desmos slider shape).
    {
      const ce = new ComputeEngine();
      ce.assign('S', ce.parse('\\left[1,2,3\\right]').evaluate());
      ce.assign('k', ce.parse('5').evaluate());
      expect(ce.parse('k\\left(\\cos(S)\\right)').json).toEqual(mul);
    }

    // A genuinely undeclared symbol is ambiguous: it keeps the function-call
    // default (unchanged behavior — the user may be applying a function).
    {
      const ce = new ComputeEngine();
      ce.assign('S', ce.parse('\\left[1,2,3\\right]').evaluate());
      expect(ce.parse('k\\left(\\cos(S)\\right)').operator).toBe('k');
    }

    // An explicitly declared function still applies.
    {
      const ce = new ComputeEngine();
      ce.declare('f', 'function');
      expect(ce.parse('f\\left(\\left[1,2,3\\right]\\right)').operator).toBe('f');
    }
  });

  // E3: the number×collection→Multiply branch is restricted to NUMERIC-valued
  // symbols. A non-numeric non-function value (a string) must NOT become a
  // `Multiply` (whose type error would blame multiplication); it falls back to
  // the application-of-non-function route, whose error correctly blames the
  // illegal application of `t` (`function` expected, `string` given).
  test('a string-valued symbol applied to a collection is an application error, not Multiply', () => {
    const ce = new ComputeEngine();
    ce.assign('t', ce.parse('"hello"'));
    const e = ce.parse('t(\\{1,2\\})');
    expect(e.operator).toBe('t'); // application, NOT Multiply
    expect(e.evaluate().operator).toBe('Error');
    expect(errorCode(e.evaluate())).toBe('incompatible-type');
  });
});

// A list-broadcast such as `Multiply([...], x)` reports a dishonest
// scalar-`number` result type though its value is actually a List. The
// `scalar + tuple` guard (canonicalAdd) and the `At` value-operand check must
// NOT treat such an expression as a provable scalar and reject a valid Desmos
// shape. STOPGAP regression — see
// docs/plans/2026-07-07-honest-list-broadcast-typing.md.
describe('POINT/TUPLE ARITHMETIC — dishonest collection-broadcast types', () => {
  test('Tuple + list-broadcast Multiply stays a valid symbolic Add', () => {
    const ce = new ComputeEngine();
    const r = ce.box([
      'Add',
      ['Tuple', 1, 2],
      ['Multiply', ['List', 1, 2], 'x'],
    ]);
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Add');
    expect(errorCode(r)).toBeUndefined();
  });

  test('At on a list-broadcast Multiply value stays valid (symbolic)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['At', ['Multiply', ['List', 1, 2], 'x'], 1]);
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('At');
  });

  test('At on a tuple with list-broadcast components stays valid', () => {
    const ce = new ComputeEngine();
    const r = ce.box([
      'At',
      ['Tuple', ['Multiply', ['List', 1, 2], 'x'], 2],
      1,
    ]);
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('At');
  });

  // The dishonest-broadcast tolerance must not open a hole in the genuine
  // rejections: a provable scalar / string value is still not an indexed
  // collection.
  test('At still rejects a provable scalar-number value', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['At', 5, 1]);
    expect(r.isValid).toBe(false);
    expect(errorCode(r.op1)).toBe('incompatible-type');
  });

  test('At still rejects a string value', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['At', ce.string('hello'), 1]);
    expect(r.isValid).toBe(false);
    expect(errorCode(r.op1)).toBe('incompatible-type');
  });

  // Genuine collection access is unaffected by the custom canonical handler.
  test('At on a genuine List still evaluates', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['At', ['List', 10, 20, 30], 2]).evaluate().toString()).toBe(
      '20'
    );
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

/**
 * Elementwise-broadcast regressions from the Tycho Desmos-import corpus.
 *
 * (a) A lazy indexed collection (a finite `Range`) multiplied by a numeric
 *     tuple must broadcast the collection over its elements — a `List` of
 *     `Tuple`s — matching the eager-`List` behavior, NOT transpose into a
 *     `Tuple` of `Multiply`s (which `mulTuples` did when the range fell through
 *     the tuple branch as a phantom scalar).
 *
 * (b) `Add`/`Multiply`/`Divide` must broadcast over a collection produced BY
 *     evaluating an operand (e.g. `L^2` → `List(1,4,9)`), not just over a
 *     collection that was already a collection before evaluation. `Add`/
 *     `Multiply` are lazy, so the collection shape only surfaces inside their
 *     `evaluate` handler; missing it left an inert `Add(-2, List(...))` and
 *     broke evaluate-idempotence.
 */
describe('ELEMENTWISE BROADCAST — Tycho corpus regressions', () => {
  test('(a) finite Range · tuple → List of Tuples (broadcast, not transpose)', () => {
    const ce = new ComputeEngine();
    ce.assign('R', ce.box(['Range', -2, 2]).evaluate());
    const r = ce.parse('R\\cdot\\left(2,3\\right)', { strict: false }).evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual([
      'List',
      ['Tuple', -4, -6],
      ['Tuple', -2, -3],
      ['Tuple', 0, 0],
      ['Tuple', 2, 3],
      ['Tuple', 4, 6],
    ]);
    // The result is a real collection: materialization/each works on it.
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(5);
    expect([...r.each()].map((x) => x.json)).toEqual([
      ['Tuple', -4, -6],
      ['Tuple', -2, -3],
      ['Tuple', 0, 0],
      ['Tuple', 2, 3],
      ['Tuple', 4, 6],
    ]);
  });

  test('(a) eager List · tuple still broadcasts (no regression)', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]').evaluate());
    const r = ce.parse('L\\cdot\\left(2,3\\right)', { strict: false }).evaluate();
    expect(r.json).toEqual([
      'List',
      ['Tuple', 2, 3],
      ['Tuple', 4, 6],
      ['Tuple', 6, 9],
    ]);
  });

  test('(a) Range · (cos a, sin a) with a declared-real symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('R', ce.box(['Range', -2, 2]).evaluate());
    ce.declare('a', 'real');
    const r = ce
      .parse('R\\cdot\\left(\\cos a, \\sin a\\right)', { strict: false })
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(5);
    // Middle element (range value 0) collapses to (0, 0); the others scale the
    // (cos a, sin a) tuple by the range value.
    const els = [...r.each()];
    expect(els.every((x) => x.operator === 'Tuple')).toBe(true);
    expect(els[2].json).toEqual(['Tuple', 0, 0]);
    expect(els[3].json).toEqual(['Tuple', ['Cos', 'a'], ['Sin', 'a']]);
  });

  test('(b) L^2 - 2 broadcasts over the evaluated Power result', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]').evaluate());
    const r = ce.parse('L^2-2').evaluate();
    expect(r.json).toEqual(['List', -1, 2, 7]);
  });

  test('(b) 1 - L broadcasts', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]').evaluate());
    const r = ce.parse('1-L').evaluate();
    expect(r.json).toEqual(['List', 0, -1, -2]);
  });

  test('(b) R^2 - 2 broadcasts over a lazy Range', () => {
    const ce = new ComputeEngine();
    ce.assign('R', ce.box(['Range', -2, 2]).evaluate());
    const r = ce.parse('R^2-2').evaluate();
    expect(r.json).toEqual(['List', 2, -1, -2, -1, 2]);
  });

  test('(b) Multiply and Divide broadcast over an evaluated collection', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]').evaluate());
    // (L^2)/2 = Multiply(1/2, List(1,4,9))
    expect(ce.box(['Divide', ['Power', 'L', 2], 2]).evaluate().json).toEqual([
      'List',
      ['Rational', 1, 2],
      2,
      ['Rational', 9, 2],
    ]);
    // 2·(L+1) = Multiply(2, List(2,3,4))
    expect(ce.box(['Multiply', 2, ['Add', 'L', 1]]).evaluate().json).toEqual([
      'List',
      4,
      6,
      8,
    ]);
  });

  test('(b) evaluate is idempotent on the broadcast results', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.parse('[1,2,3]').evaluate());
    ce.assign('R', ce.box(['Range', -2, 2]).evaluate());
    for (const tex of ['L^2-2', '1-L', 'R^2-2']) {
      const once = ce.parse(tex).evaluate();
      const twice = once.evaluate();
      expect(twice.isSame(once)).toBe(true);
    }
    const rc = ce
      .parse('R\\cdot\\left(2,3\\right)', { strict: false })
      .evaluate();
    expect(rc.evaluate().isSame(rc)).toBe(true);
  });

  test('scalar · tuple and tuple · tuple are unchanged', () => {
    const ce = new ComputeEngine();
    // scalar · tuple scales component-wise (stays a Tuple)
    expect(ce.box(['Multiply', 2, ['Tuple', 1, 2]]).evaluate().json).toEqual([
      'Tuple',
      2,
      4,
    ]);
    // tuple · tuple stays an error (no implicit dot/cross product)
    const tt = ce.box(['Multiply', ['Tuple', 1, 2], ['Tuple', 3, 4]]).evaluate();
    expect(errorCode(tt.op1) ?? errorCode(tt)).toBe('incompatible-type');
  });
});

describe('POINT/TUPLE ARITHMETIC — component accessors on non-indexed collections', () => {
  // C4: a non-indexed finite collection (a `Set`) has no `at()`, so the
  // point-component accessor used to read its first element as `undefined` and
  // misclassify a non-empty Set of points as empty (→ a silently-wrong `[]`).
  test('PointX/PointY broadcast over a Set of points (C4)', () => {
    const ce = new ComputeEngine();
    const s = ce.box(['Set', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(ce.box(['PointX', s]).evaluate().json).toEqual(['List', 1, 3]);
    expect(ce.box(['PointY', s]).evaluate().json).toEqual(['List', 2, 4]);
  });

  test('PointX/PointY still broadcast over a List of points', () => {
    const ce = new ComputeEngine();
    const l = ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(ce.box(['PointX', l]).evaluate().json).toEqual(['List', 1, 3]);
    expect(ce.box(['PointY', l]).evaluate().json).toEqual(['List', 2, 4]);
  });

  test('PointZ over 2D points broadcasts a list of Nothing (unchanged)', () => {
    const ce = new ComputeEngine();
    const s = ce.box(['Set', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(ce.box(['PointZ', s]).evaluate().json).toEqual([
      'List',
      'Nothing',
      'Nothing',
    ]);
  });
});

/**
 * The Desmos point-list idiom now lives in an explicit `PointList` operator,
 * NOT in the `Tuple` evaluate handler. A plain `Tuple` is inert data: `(-6, n)`
 * with `n` a list stays a `Tuple` with a list component — it never transposes
 * into a `List` of points. The zip-to-shortest / scalars-broadcast / fail-closed
 * transpose is what `PointList(-6, n)` produces. Importers emit `PointList`;
 * default parsing of `(a, b)` never produces it.
 *
 * Two contracts are locked here:
 *   1. Plain tuples are data: they evaluate their operands but do not zip, and
 *      arithmetic over a tuple-with-collection component neither zips nor bakes
 *      an incompatible-type error (component-wise scaling is the arithmetic
 *      `isTuple` path — see `arithmetic-mul-div.ts`).
 *   2. `PointList` performs the zip: PointList(1,2)→a point, PointList with a
 *      collection component→the List of point-tuples (zip-to-shortest, scalars
 *      broadcast, empty→[], infinite/lazy→inert).
 */
describe('POINT/TUPLE ARITHMETIC — plain Tuple is data (no zip)', () => {
  // n := 2/20·[0…20] − 1 : 21 exact rationals from −1 to 1 in steps of 1/10.
  const declN = (ce: ComputeEngine) =>
    ce.assign(
      'n',
      ce.parse('\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1').evaluate()
    );

  test('(a) (-6, n) evaluates to an INERT Tuple (list component intact)', () => {
    const ce = new ComputeEngine();
    declN(ce);
    const r = ce.parse('(-6, n)').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.op1.json).toEqual(-6);
    // The list component is preserved, not transposed away.
    expect(r.op2.operator).toBe('List');
    expect(r.op2.count).toBe(21);
  });

  test('(a) explicit Tuple(-6, [1,2,3]) stays an inert Tuple', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Tuple', -6, ['List', 1, 2, 3]]).evaluate();
    expect(r.json).toEqual(['Tuple', -6, ['List', 1, 2, 3]]);
  });

  test('(b) 2·(1, 0.3n) scales component-wise (numeric tuple), no error', () => {
    // With `n` symbolic, `(1, 0.3n)` is a numeric tuple (a point), so scalar
    // multiplication scales each component: `(2, 0.6n)`. No zip, no error.
    const ce = new ComputeEngine();
    const r = ce
      .box(['Multiply', 2, ['Tuple', 1, ['Multiply', 0.3, 'n']]])
      .evaluate();
    expect(r.json).toEqual(['Tuple', 2, ['Multiply', 0.6, 'n']]);
    expect(JSON.stringify(r.json).includes('Error')).toBe(false);
  });

  test('(b) 2·(1, 0.3n) with n a list scales component-wise, no zip, no error', () => {
    const ce = new ComputeEngine();
    declN(ce);
    const r = ce
      .box(['Multiply', 2, ['Tuple', 1, ['Multiply', 0.3, 'n']]])
      .evaluate();
    // Component-wise: the tuple stays a tuple, the scalar distributes into the
    // list component (`(2, 0.6n)`) — never transposes into a List of points.
    expect(r.operator).toBe('Tuple');
    expect(r.op1.isSame(2)).toBe(true);
    expect(r.op2.operator).toBe('List');
    expect(r.op2.count).toBe(21);
    expect(r.op2.at(1)!.re).toBeCloseTo(-0.6, 12); // 0.6·(-1)
    expect(r.op2.at(21)!.re).toBeCloseTo(0.6, 12); // 0.6·1
    // No baked Error anywhere.
    expect(JSON.stringify(r.json).includes('Error')).toBe(false);
  });

  test('(b′) point-list + point broadcasts the point over the list', () => {
    const ce = new ComputeEngine();
    const pts = ce.box(['PointList', -6, ['List', 1, 2, 3]]).evaluate();
    const r = ce.box(['Add', pts, ['Tuple', 1, 2]]).evaluate();
    expect(r.json).toEqual([
      'List',
      ['Tuple', -5, 3],
      ['Tuple', -5, 4],
      ['Tuple', -5, 5],
    ]);
  });

  test('(c) m(P) := P + s(P)·(1, 0.3n) is a valid definition (no baked Error)', () => {
    const ce = new ComputeEngine();
    declN(ce);
    ce.declare('s', '(number) -> number');
    const m = ce.parse('m(P) \\coloneq P + s(P)\\cdot(1, 0.3n)');
    expect(m.isValid).toBe(true);
    expect(JSON.stringify(m.json).includes('Error')).toBe(false);
  });
});

/**
 * The explicit `PointList` operator (the Desmos point-list surface form) carries
 * the zip that used to live in the `Tuple` evaluate handler.
 */
describe('POINT/TUPLE ARITHMETIC — PointList zips', () => {
  // n := 2/20·[0…20] − 1 : 21 exact rationals from −1 to 1 in steps of 1/10.
  const declN = (ce: ComputeEngine) =>
    ce.assign(
      'n',
      ce.parse('\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1').evaluate()
    );

  test('PointList(1, 2) → a plain point (Tuple)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', 1, 2]).evaluate();
    expect(r.json).toEqual(['Tuple', 1, 2]);
  });

  test('PointList(-6, n) → 21-element List of Tuples', () => {
    const ce = new ComputeEngine();
    declN(ce);
    const r = ce.box(['PointList', -6, 'n']).evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(21);
    expect(r.at(1)!.json).toEqual(['Tuple', -6, -1]);
    expect(r.at(21)!.json).toEqual(['Tuple', -6, 1]);
    expect([...r.each()].every((x) => x.operator === 'Tuple')).toBe(true);
  });

  test('PointList(-6, [1,2,3]) transposes to the List of point-tuples', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', -6, ['List', 1, 2, 3]]).evaluate();
    expect(r.json).toEqual([
      'List',
      ['Tuple', -6, 1],
      ['Tuple', -6, 2],
      ['Tuple', -6, 3],
    ]);
  });

  test('two list components of different lengths zip to the shorter', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['PointList', ['List', 1, 2, 3], ['List', 10, 20]])
      .evaluate();
    expect(r.json).toEqual(['List', ['Tuple', 1, 10], ['Tuple', 2, 20]]);
  });

  test('empty list component yields an empty List', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', 1, ['List']]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual(['List']);
  });

  test('infinite Range component fails closed (stays inert, no hang)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .parse('\\operatorname{PointList}(1, \\mathrm{Range}(1, \\infty))')
      .evaluate();
    // A collection component that cannot be safely zipped (infinite or
    // unknown-length) keeps the expression INERT — the point-list reading is
    // preserved, never silently degraded to a plain point, and never a hang.
    expect(r.operator).toBe('PointList');
    expect(r.op1.json).toEqual(1);
  });

  test('a non-indexed collection component (Set) also stays inert', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['PointList', 1, ['Set', 1, 2]]).evaluate();
    expect(r.operator).toBe('PointList');
  });

  test('PointList(1,2) compares equal to the Tuple it evaluates to', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Equal', ['PointList', 1, 2], ['Tuple', 1, 2]]).evaluate().symbol
    ).toBe('True');
  });

  test('LaTeX round-trip identity (canonical and non-canonical parse)', () => {
    const ce = new ComputeEngine();
    const box = ce.box(['PointList', 1, ['List', 1, 2, 3]]);
    expect(ce.parse(box.latex).json).toEqual(['PointList', 1, ['List', 1, 2, 3]]);
    // The dedicated dictionary entry parses `PointList` at the non-canonical
    // stage too (not just after canonicalization collapses InvisibleOperator).
    expect(ce.parse('\\operatorname{PointList}(1, 2)', { canonical: false }).json).toEqual([
      'PointList',
      1,
      2,
    ]);
  });

  test('PointX / PointY over the PointList result', () => {
    const ce = new ComputeEngine();
    declN(ce);
    const pts = ce.box(['PointList', -6, 'n']).evaluate();
    const xs = ce.box(['PointX', pts]).evaluate();
    const ys = ce.box(['PointY', pts]).evaluate();
    expect(xs.count).toBe(21);
    // Every x-coordinate is the broadcast scalar −6.
    expect([...xs.each()].every((x) => x.is(-6))).toBe(true);
    expect(ys.count).toBe(21);
    expect(ys.at(1)!.json).toEqual(-1);
    expect(ys.at(11)!.json).toEqual(0);
    expect(ys.at(21)!.json).toEqual(1);
  });
});

/**
 * A `Tuple` operand is ATOMIC for broadcasting: applying a user function to a
 * tuple binds the whole point to the parameter (never maps over its
 * components), while a genuine List still broadcasts element-wise. See the
 * `!isTuple` guards in `boxed-function.ts` (broadcast steps) and the
 * value-following `isTuple` in `collection-utils.ts`.
 */
describe('POINT/TUPLE ARITHMETIC — Tuple is atomic for broadcast', () => {
  test('f(x):=2x applied to a tuple scales it component-wise (stays a Tuple)', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) \\coloneq 2x').evaluate();
    const r = ce.parse('f((1,2))').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.json).toEqual(['Tuple', 2, 4]);
  });

  test('f(x):=2x applied to a List still broadcasts element-wise', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) \\coloneq 2x').evaluate();
    const r = ce.parse('f([1,2])').evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual(['List', 2, 4]);
  });

  test('f(x):=2x broadcasts over a List of tuples, binding each tuple whole', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) \\coloneq 2x').evaluate();
    const r = ce
      .box(['f', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]])
      .evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual([
      'List',
      ['Tuple', 2, 4],
      ['Tuple', 6, 8],
    ]);
  });

  test('a body using Add keeps the tuple atomic too', () => {
    const ce = new ComputeEngine();
    ce.parse('h(x) \\coloneq x+x').evaluate();
    const r = ce.parse('h((1,2))').evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.json).toEqual(['Tuple', 2, 4]);
  });

  test('a broadcastable builtin (Sin) does not broadcast into a Tuple', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Sin', ['Tuple', 1, 2]]).evaluate();
    // Stays inert/symbolic rather than mapping into a List (Desmos also errors
    // on sin of a point).
    expect(r.operator).not.toBe('List');
  });
});

/**
 * The `gy1wdjvm2a` SDF-ray-marching chain — the item-25 retest triggers, via
 * the TEXTUAL-EXPANSION route (each step's body inlined with the previous
 * point-list substituted, as Tycho's `expandFunctionRefs` produces):
 * `p_k = p_{k-1} + s(p_{k-1})·PointList(1, 0.3n)` for 5 steps, all lists of
 * 21 points, `Join(p_0…p_5)` = 126 points.
 *
 * Load-bearing engine behavior locked here:
 * - `Add`/`Multiply` never pre-evaluation-broadcast (boxed-function step 2):
 *   their broadcast runs in `add()`/`mul()` on EVALUATED operands, so
 *   `s(p_0)·PointList(…)` zips 21↔21 elementwise instead of repeating the raw
 *   operand per element (a 21×21 cartesian blow-up, then timeout at p_2).
 * - Equal-length list arithmetic zips positionally (the Desmos evaluation
 *   model for a shared carrier `n`).
 *
 * The TRUE-APPLICATION route (`p_1 = m(p_0)` with `m` a registered function)
 * additionally requires the parameter to bind the whole list: register with a
 * DECLARED collection-accepting signature (`(tuple | list<tuple>) -> any`),
 * which `:=` registration preserves (item 19.1) and which the application
 * broadcast gate consults (a non-scalar declared param binds whole). An
 * inferred/`any` signature counts as scalar (`paramsAreScalar` permissive
 * default) and maps per element — correct for scalar functions, a cartesian
 * blow-up for this body.
 */
describe('POINT/TUPLE ARITHMETIC — gy1wdjvm2a ray-marching chain (expansion route)', () => {
  test('five expansion steps stay 21 points each; Join is 126 points', () => {
    const ce = new ComputeEngine();
    // n := 2/20·[0…20] − 1 : 21 exact rationals from −1 to 1
    ce.assign(
      'n',
      ce.parse('\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1').evaluate()
    );
    // An SDF-ish scalar function of a point.
    ce.parse('s(P) \\coloneq \\mathrm{PointY}(P) + 2').evaluate();
    ce.assign('p_0', ce.parse('\\operatorname{PointList}(-6, n)').evaluate());

    for (let k = 1; k <= 5; k++) {
      const stepped = ce
        .parse(
          `p_${k - 1} + s(p_${k - 1})\\cdot\\operatorname{PointList}(1, 0.3n)`
        )
        .evaluate();
      ce.assign(`p_${k}`, stepped);
    }

    for (let k = 0; k <= 5; k++) {
      const p = ce.box(`p_${k}`).evaluate();
      expect(p.count).toBe(21);
      expect([...p.each()].every((x) => x.operator === 'Tuple')).toBe(true);
    }

    // First marched point: (-6,-1) + s((-6,-1))·(1, 0.3·(-1)) = (-5, -1.3)
    const p1 = ce.box('p_1').evaluate();
    expect(p1.at(1)!.json).toEqual(['Tuple', -5, -1.3]);

    const joined = ce
      .box(['Join', 'p_0', 'p_1', 'p_2', 'p_3', 'p_4', 'p_5'])
      .evaluate();
    expect(joined.count).toBe(126);
  });

  test('true application: declared union signature binds the point-list whole', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'n',
      ce.parse('\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1').evaluate()
    );
    ce.parse('s(P) \\coloneq \\mathrm{PointY}(P) + 2').evaluate();
    // The Tycho registration recipe: declare the collection-accepting
    // signature, then register the body via `:=` (signature preserved).
    ce.declare('m', '(tuple<number, number> | list<tuple<number, number>>) -> any');
    ce.parse(
      'm(P) \\coloneq P + s(P)\\cdot\\operatorname{PointList}(1, 0.3n)'
    ).evaluate();

    let p = ce.parse('\\operatorname{PointList}(-6, n)').evaluate();
    const chain = [p];
    for (let k = 1; k <= 5; k++) {
      p = ce.box(['m', p]).evaluate();
      chain.push(p);
    }
    for (const step of chain) {
      expect(step.count).toBe(21);
      expect([...step.each()].every((x) => x.operator === 'Tuple')).toBe(true);
    }
    expect(chain[1].at(1)!.json).toEqual(['Tuple', -5, -1.3]);
    expect(ce.box(['Join', ...chain]).evaluate().count).toBe(126);
  });

  test('a single point through the registered step function marches once', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'n',
      ce.parse('\\frac{2}{20}\\cdot\\lbrack0\\ldots20\\rbrack - 1').evaluate()
    );
    ce.parse('s(P) \\coloneq \\mathrm{PointY}(P) + 2').evaluate();
    ce.parse(
      'm(P) \\coloneq P + s(P)\\cdot\\operatorname{PointList}(1, 0.3n)'
    ).evaluate();
    // The Tuple argument binds ATOMICALLY (never mapped over its components);
    // the body's 21-point list then broadcasts the point over it — the Desmos
    // reading of point + point-list.
    const r = ce.box(['m', ['Tuple', -6, -1]]).evaluate();
    expect(r.count).toBe(21);
    expect(r.at(1)!.json).toEqual(['Tuple', -5, -1.3]);
  });
});
