import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { expectTypeBetween } from '../utils';

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
    expectTypeBetween(r, { atMost: 'tuple<finite_rational, finite_rational>' });

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

  test('(1,2) · (3,4) → Error(no-product-between-points)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)\\cdot(3,4)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('no-product-between-points');
  });

  test('1 / (2,3) → Error(no-division-by-point)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('1/(2,3)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('no-division-by-point');
  });

  test('(1,2) / (3,4) → Error(no-division-by-point)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('(1,2)/(3,4)');
    expect(r.operator).toBe('Error');
    expect(errorCode(r)).toBe('no-division-by-point');
  });

  // Tycho item 158: the rejection must not depend on how precisely the
  // element types are known. A `tuple<broadcastable<number>, …>` operand used
  // to escape the canonicalization guard (its elements are not provable
  // subtypes of `number`), so the SAME product was accepted before a type
  // refinement and rejected after it — with the identical error merely
  // deferred to evaluation. Counted by tuple-ness now, like `mulTuples`.
  test('tuple · tuple rejects identically across element-type refinement', () => {
    for (const type of ['broadcastable<number>', 'number', 'finite_number']) {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('u', { type });
      ce.declare('v', { type });
      const left = ce.box(['Add', ['PointList', 1, 2], ['Tuple', 0, 0]]);
      const right = ce.box(['PointList', 'u', 'v']);
      const product = ce.function('Multiply', [left, right]);
      expect(product.isValid).toBe(false);
      expect(errorCode(product)).toBe('no-product-between-points');
      ce.popScope();
    }
  });

  // The LaTeX rendering of the no-implicit-product rejection points the user
  // at the operator that DOES accept points. `Cross` is named alongside `Dot`
  // unless an operand is provably NOT 3-component: it is declared for
  // 3-vectors and answers `incompatible-dimensions` for a pair of plane
  // points, so naming it there would bounce the user into a second rejection.
  test('a product between points suggests Dot, and Cross only in 3-D', () => {
    const ce = new ComputeEngine();
    const plane = ce.parse('(1,2)\\cdot(3,4)').latex;
    expect(plane).toContain('\\mathrm{Dot}');
    expect(plane).not.toContain('\\mathrm{Cross}');

    const space = ce.parse('(1,2,3)\\cdot(4,5,6)').latex;
    expect(space).toContain('\\mathrm{Dot}');
    expect(space).toContain('\\mathrm{Cross}');
  });

  // A point DIVISOR used to render the same "use Dot" tooltip, because both
  // rejections carried the same `incompatible-type "number" "tuple"` payload
  // and the serializer could not tell them apart. That conflation recommended
  // an inner product to someone who wrote a division, which is not a remedy —
  // a point has no reciprocal, and there is no operator to reach for.
  test('a point divisor says a point cannot be a divisor, not "use Dot"', () => {
    const ce = new ComputeEngine();
    const divided = ce.parse('1/(2,3)').latex;
    expect(divided).toContain('divisor');
    expect(divided).not.toContain('\\mathrm{Dot}');
  });

  test('the scalar+tuple ADD rejection renders unchanged', () => {
    // A different mistake: points DO add, so there is no operator to suggest.
    const ce = new ComputeEngine();
    expect(ce.parse('1+(2,3)').latex).not.toContain('\\mathrm{Dot}');
  });

  // Same class as the Multiply guard: a tuple divisor never divides, whatever
  // its elements refine to, so the rejection must not wait for provable
  // element numericity.
  test('scalar / tuple rejects identically across element-type refinement', () => {
    for (const type of ['broadcastable<number>', 'number', 'finite_number']) {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('u', { type });
      ce.declare('v', { type });
      const div = ce.function('Divide', [
        ce.box(1),
        ce.box(['PointList', 'u', 'v']),
      ]);
      expect(div.isValid).toBe(false);
      expect(errorCode(div)).toBe('no-division-by-point');
      ce.popScope();
    }
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

  // E3: the value×collection→Multiply branch is restricted to MULTIPLICATIVE
  // values (numbers and linear-algebra values, see item 173 below). A value
  // with no scaling semantics (a string) must NOT become a `Multiply` (whose
  // type error would blame multiplication); it falls back to the
  // application-of-non-function route, whose error correctly blames the
  // illegal application of `t` (`function` expected, `string` given).
  test('a string-valued symbol applied to a collection is an application error, not Multiply', () => {
    const ce = new ComputeEngine();
    ce.assign('t', ce.parse('"hello"'));
    const e = ce.parse('t(\\{1,2\\})');
    expect(e.operator).toBe('t'); // application, NOT Multiply
    expect(e.evaluate().operator).toBe('Error');
    expect(errorCode(e.evaluate())).toBe('incompatible-type');
  });

  // Tycho item 173: the same single-argument branch read `A(arg)` — with `A`
  // a declared/bound COLLECTION (so `A.isFunction === false`) — as a product
  // when `arg` was scalar-typed but as an APPLICATION when `arg` was
  // collection-typed, yielding `Error(incompatible-type, function,
  // list<number>)`. The raw parse is a uniform `InvisibleOperator(A,
  // Delimiter(…))` in every case: the reading must depend on the HEAD, never
  // on the argument's type. (USER RULING: a declared/bound non-function head
  // juxtaposed with parens multiplies.)
  describe('collection-typed head · parenthesized arg is Multiply (item 173)', () => {
    const setups: [string, (ce: ComputeEngine) => void][] = [
      [
        'declared indexed_collection',
        (ce) => {
          ce.declare('A', 'indexed_collection');
          ce.declare('B', 'indexed_collection');
        },
      ],
      [
        'declared list<number>',
        (ce) => {
          ce.declare('A', ce.type('list<number>'));
          ce.declare('B', ce.type('list<number>'));
        },
      ],
      [
        'assigned a concrete list',
        (ce) => {
          ce.assign('A', ce.box(['List', 1, 2, 3]));
          ce.assign('B', ce.box(['List', 4, 5, 6]));
        },
      ],
      [
        // A `broadcastable<…>`-typed head is a number OR an indexed
        // collection of numbers — never a function. The multi-operand gate
        // always read it as value-like; the single-argument branch omitted
        // it, so the reading depended on the argument's shape again.
        'declared broadcastable<number>',
        (ce) => {
          ce.declare('A', ce.type('broadcastable<number>'));
          ce.declare('B', ce.type('list<number>'));
        },
      ],
    ];

    for (const [label, setup] of setups) {
      test(`${label}: the argument's type does not change the reading`, () => {
        const ce = new ComputeEngine();
        setup(ce);
        ce.declare('m', 'number');
        expect(ce.box('A').isFunction).toBe(false);

        // Scalar-typed argument (already worked)
        expect(ce.parse('A(m)').json).toEqual(['Multiply', 'A', 'm']);
        expect(ce.parse('A(t-m)').json).toEqual([
          'Multiply',
          'A',
          ['Add', ['Negate', 'm'], 't'],
        ]);
        // Collection-typed argument (was an illegal application)
        expect(ce.parse('A(B)').json).toEqual(['Multiply', 'A', 'B']);
        expect(ce.parse('A(t-B)').json).toEqual([
          'Multiply',
          'A',
          ['Add', ['Negate', 'B'], 't'],
        ]);
        expect(ce.parse('A(t-B+m)').json).toEqual([
          'Multiply',
          'A',
          ['Add', ['Negate', 'B'], 'm', 't'],
        ]);
      });

      test(`${label}: same on the box route (raw MathJSON)`, () => {
        const ce = new ComputeEngine();
        setup(ce);
        expect(
          ce.box(['InvisibleOperator', 'A', ['Delimiter', 'B']]).json
        ).toEqual(['Multiply', 'A', 'B']);
      });
    }

    test('the product of two bound lists evaluates element-wise', () => {
      const ce = new ComputeEngine();
      ce.assign('A', ce.box(['List', 1, 2, 3]));
      ce.assign('B', ce.box(['List', 4, 5, 6]));
      expect(ce.parse('A(B)').evaluate().json).toEqual(['List', 4, 10, 18]);
    });

    // The head decides, so heads that ARE (or could become) functions keep
    // applying: an undeclared head binds vacuously as a function (item 152),
    // and a declared function obviously applies.
    test('an undeclared or function-typed head still applies', () => {
      const ce = new ComputeEngine();
      ce.declare('B', 'indexed_collection');
      ce.declare('g', 'function');
      expect(ce.parse('f(B)').operator).toBe('f');
      expect(ce.parse('g(B)').operator).toBe('g');
    });

    // A `set` has no scaling semantics (same carve-out as the juxtaposition
    // path and as the string case in E3 above): it stays an application, whose
    // error blames the illegal application rather than a `Multiply`.
    test('a set-typed head stays an application', () => {
      const ce = new ComputeEngine();
      ce.declare('S', ce.type('set<number>'));
      ce.declare('B', 'indexed_collection');
      expect(ce.parse('S(B)').operator).toBe('S');
    });

    test('a matrix head juxtaposed with a matrix is a product', () => {
      const ce = new ComputeEngine();
      ce.declare('M', 'matrix');
      ce.declare('P', 'matrix');
      expect(ce.parse('M(P)').json).toEqual(['Multiply', 'M', 'P']);
    });

    // Item 173 residue: the SCALAR-argument branch (just above the
    // collection-argument one) still decided on the argument's numeric-ness
    // alone, so a non-multiplicative head became a `Multiply` whose type error
    // blamed multiplication — the outcome the E3 pin's rationale objects to.
    // The head decides here too: a string/set head falls through to the
    // application route, whose error blames the illegal application.
    describe('a non-multiplicative head with a SCALAR arg is an application', () => {
      test('string head (parse route)', () => {
        const ce = new ComputeEngine();
        ce.assign('t', ce.parse('"hello"'));
        const e = ce.parse('t(2)');
        expect(e.operator).toBe('t'); // application, NOT Multiply
        expect(e.evaluate().operator).toBe('Error');
        expect(errorCode(e.evaluate())).toBe('incompatible-type');
        // The error blames the application of a non-function, not the product.
        expect(e.evaluate().json).toEqual([
          'Error',
          ['ErrorCode', "'incompatible-type'", "'function'", "'string'"],
          '\'"hello"\'',
        ]);
      });

      test('string head (box route)', () => {
        const ce = new ComputeEngine();
        ce.assign('t', ce.parse('"hello"'));
        const e = ce.box(['InvisibleOperator', 't', ['Delimiter', 2]] as any);
        expect(e.operator).toBe('t');
        expect(errorCode(e.evaluate())).toBe('incompatible-type');
      });

      test('set head (parse and box routes)', () => {
        const ce = new ComputeEngine();
        ce.declare('S', ce.type('set<number>'));
        expect(ce.parse('S(2)').operator).toBe('S');
        expect(
          ce.box(['InvisibleOperator', 'S', ['Delimiter', 2]] as any).operator
        ).toBe('S');
      });

      test('an ambiguous head keeps the product reading', () => {
        // Undeclared, and unknown-typed, heads stay genuinely ambiguous: the
        // scalar-argument branch's charitable product reading is unchanged.
        {
          const ce = new ComputeEngine();
          expect(ce.parse('f(2)').json).toEqual(['Multiply', 2, 'f']);
          expect(ce.parse('x(x+1)').json).toEqual([
            'Multiply',
            'x',
            ['Add', 'x', 1],
          ]);
        }
        {
          const ce = new ComputeEngine();
          ce.declare('u', 'unknown');
          expect(ce.parse('u(2)').json).toEqual(['Multiply', 2, 'u']);
        }
        // …and a numeric head still multiplies, a function head still applies.
        {
          const ce = new ComputeEngine();
          ce.assign('k', ce.box(3));
          expect(ce.parse('k(2)').json).toEqual(['Multiply', 2, 'k']);
          ce.declare('g', ce.type('(number) -> number'));
          expect(ce.parse('g(2)').json).toEqual(['g', 2]);
        }
      });

      test('a `value`-typed head keeps the product reading, even when the arg mentions the head', () => {
        // A symbol declared `value` COULD be a number, so juxtaposition
        // reads as a product (the wide-type arms in invisible-operator.ts).
        // Two admissions make this hold end to end: `checkNumericArgs`
        // accepts a could-be-a-number operand (so `1-a` boxes cleanly
        // instead of erroring `incompatible-type`), and the numeric-arg
        // gate tests overlap rather than subtype (the arg types as
        // `broadcastable<number>`, not bare `number`). A non-number bound
        // to `a` surfaces at evaluation time, not at boxing.
        const ce = new ComputeEngine();
        ce.declare('a', 'value');
        expect(ce.parse('1-a').isValid).toBe(true);
        expect(ce.parse('a(1-a)').json).toEqual([
          'Multiply',
          'a',
          ['Add', ['Negate', 'a'], 1],
        ]);
        expect(ce.parse('a(2)').json).toEqual(['Multiply', 2, 'a']);
        expect(ce.parse('2a').json).toEqual(['Multiply', 2, 'a']);
        // The declared `value` contract is not narrowed by the numeric use…
        expect(ce.box('a').type.toString()).toBe('value');
        // …and a numeric binding evaluates through it.
        ce.assign('a', 3);
        expect(ce.parse('1-a').evaluate().json).toEqual(-2);
        // A NON-numeric binding (legal under `value`) errors at evaluation
        // time — permissive boxing must not become silent absorption. In
        // particular the `0 · x → 0` collapse must not swallow a provably
        // non-numeric term: `0 * "hello"` is a type error, not `0`.
        ce.assign('a', ce.string('hello'));
        const zeroFold = ce.parse('0a').evaluate();
        expect(zeroFold.json).not.toEqual(0);
        expect(zeroFold.toString()).toContain('incompatible-type');
      });
    });
  });
});

// A list-broadcast such as `Multiply([...], x)` reports a dishonest
// scalar-`number` result type though its value is actually a List. The
// `scalar + tuple` guard (canonicalAdd) and the `At` value-operand check must
// NOT treat such an expression as a provable scalar and reject a valid Desmos
// shape. STOPGAP regression — see
// docs/COLLECTIONS-MODEL.md.
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

  test('At now ACCEPTS a string value (strings are collections of characters)', () => {
    const ce = new ComputeEngine();
    // Strings became indexed collections of characters, so `At` accepts one:
    // the former `incompatible-type` refusal is gone and the call selects the
    // first character.
    const r = ce.box(['At', ce.string('hello'), 1]);
    expect(r.isValid).toBe(true);
    expect(r.evaluate().string).toBe('h');
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

  // Regression: canonicalizing a numeric function over a large *lazy* indexed
  // collection must not materialize its elements. `checkNumericArgs` used to
  // walk `op.each()` to type-check every element, which enumerated the whole
  // collection at canonicalization time (item 16: `\frac{[1...1e8]}{2}` hung
  // `ce.parse`). A concrete lazy collection with no free variables is now
  // accepted without walking; element validation is deferred to evaluate time.
  // Every source below is sized at 10⁸ elements deliberately: a walk of that
  // many elements does not finish, so "canonicalization returned at all" is
  // the assertion, and the jest per-test timeout is the backstop. That is a
  // termination property, identical on every machine — unlike the elapsed-
  // millisecond budgets this replaced, which reported machine load and went
  // red under a parallel full-suite run.
  test('numeric op over a huge lazy Range canonicalizes without materializing', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Add', ['Range', 1, 1e8], 1]);
    expect(a.operator).toBe('Add');

    // item-16 shape via LaTeX.
    const f = ce.parse('\\frac{[1...100000000]}{2}');
    expect(f.isValid).toBe(true);

    // A lazy collection with a FREE VARIABLE (`k`) in its mapping function must
    // still canonicalize without walking. The walk cost does not depend on
    // free variables, so the lazy fast path must skip it REGARDLESS of
    // `unknowns` (previously the `unknowns.length === 0` guard forced a
    // materializing walk here). Element type is numeric, so it stays valid.
    const m = ce.box([
      'Add',
      ['Map', ['Function', ['Add', 'x', 'k'], 'x'], ['Range', 1, 1e8]],
      1,
    ]);
    expect(m.isValid).toBe(true);

    // A lazy collection whose static element type is genuinely indeterminate
    // (`indexed_collection<unknown>`) — with a free variable in the body — also
    // reaches the fail-open lazy path: element validation is deferred to
    // evaluate time, so canonicalization stays fast and valid.
    ce.declare('col', ce.type('indexed_collection<unknown>'));
    const u = ce.box([
      'Add',
      ['Map', ['Function', ['Add', 'x', 'k'], 'x'], 'col'],
      1,
    ]);
    expect(u.isValid).toBe(true);
  });

  // Regression (companion to the fast-path test above): a lazy collection whose
  // static element type is concrete and PROVABLY NON-NUMERIC
  // (`indexed_collection<string>`) is rejected by `checkNumericArgs` WITHOUT
  // walking its elements — the element type already disproves numericity. Under
  // the old fail-open lazy guard such an operand was silently ACCEPTED (its
  // runtime elements were never checked at canonicalization time).
  test('a lazy string-typed collection is rejected by a numeric op without walking', () => {
    const ce = new ComputeEngine();
    ce.declare('sfn', ce.type('(integer) -> string'));
    // Sized at 10⁸ elements so that "rejected on the static type alone" is a
    // termination property rather than a stopwatch reading: a walk of the
    // elements would not finish, and the jest per-test timeout is the backstop.
    const r = ce.box([
      'Add',
      ['Map', ['Function', ['sfn', 'x'], 'x'], ['Range', 1, 1e8]],
      1,
    ]);
    expect(r.isValid).toBe(false);
    expect(errorCode(r.op1) ?? errorCode(r)).toBe('incompatible-type');
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
    expect(errorCode(tt.op1) ?? errorCode(tt)).toBe('no-product-between-points');
  });
});

describe('ELEMENTWISE BROADCAST — hybrid laziness (huge collections)', () => {
  // Below/at the eager threshold, broadcast is materialized to a `List`,
  // byte-identical to the historical behavior. Above the threshold, a lazy
  // `Map` form is returned instead of enumerating every element.
  test('small Add stays an eager List (byte-identical)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['List', 1, 2, 3], 1]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.isLazyCollection).toBe(false);
    expect(r.json).toEqual(['List', 2, 3, 4]);
  });

  test('threshold boundary: 100 eager, 101 lazy', () => {
    const ce = new ComputeEngine();
    const at100 = ce.box(['Add', ['Range', 1, 100], 1]).evaluate();
    expect(at100.operator).toBe('List');
    expect(at100.isLazyCollection).toBe(false);
    expect(at100.count).toBe(100);

    const at101 = ce.box(['Add', ['Range', 1, 101], 1]).evaluate();
    expect(at101.operator).toBe('Map');
    expect(at101.isLazyCollection).toBe(true);
    expect(at101.count).toBe(101);
  });

  // Laziness is pinned structurally — the result is a `Map` with
  // `isLazyCollection`, which an eager evaluation could not produce — and by
  // the fact that evaluation returns at all over a 10⁸-element source.
  test('Add(Range(1,1e8), 1) evaluates to a lazy Map without enumerating', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['Range', 1, 1e8], 1]).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.count).toBe(1e8);
    expect(r.at(5)?.json).toEqual(6);
    // `Take` over a lazy Map stays lazy; materialize via `each()`.
    expect(
      [...ce.box(['Take', r, 3]).evaluate().each()].map((x) => x.json)
    ).toEqual([2, 3, 4]);
  });

  test('Multiply(Range(1,1e8), 2) is lazy', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Multiply', ['Range', 1, 1e8], 2]).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.count).toBe(1e8);
    expect(r.at(5)?.json).toEqual(10);
    expect(
      [...ce.box(['Take', r, 3]).evaluate().each()].map((x) => x.json)
    ).toEqual([2, 4, 6]);
  });

  test('a broadcastable unary op over a huge Range is lazy', () => {
    const ce = new ComputeEngine();
    // As above: the lazy `Map` result and the fact that evaluation terminates
    // over 10⁸ elements are together the whole assertion.
    const r = ce.box(['Sin', ['Range', 1, 1e8]]).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.count).toBe(1e8);
    expect(r.at(1)?.json).toEqual(['Sin', 1]);
  });

  test('two huge collections broadcast to a lazy variadic Map', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Add', ['Range', 1, 1e8], ['Range', 1, 1e8]])
      .evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.at(3)?.json).toEqual(6);
  });

  test('small two-collection Add stays an eager List', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['List', 1, 2], ['List', 3, 4]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.json).toEqual(['List', 4, 6]);
  });

  test('a user lambda over a huge Range maps lazily', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2 + 1'));
    const r = ce.box(['f', ['Range', 1, 1e8]]).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.count).toBe(1e8);
    expect(r.at(3)?.json).toEqual(10);
    // Small case unchanged (eager List).
    expect(ce.box(['f', ['Range', 1, 3]]).evaluate().json).toEqual([
      'List',
      2,
      5,
      10,
    ]);
  });

  test('a spliced scalar cannot be captured by the map parameter', () => {
    const ce = new ComputeEngine();
    ce.assign('_1', ce.box(7));
    const r = ce.box(['Add', ['Range', 1, 1e8], '_1']).evaluate();
    expect(r.operator).toBe('Map');
    // 5 + 7 = 12: the free `_1` resolves to 7, not to the map parameter.
    expect(r.at(5)?.json).toEqual(12);
  });

  test('an infinite collection broadcasts to a lazy Map', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Add', ['Cycle', ['List', 1, 2]], 1]).evaluate();
    // A `Cycle` is an infinite indexed collection: it can't be materialized or
    // eagerly zipped, so the broadcast returns the lazy `Map` form rather than
    // staying inert (or hanging).
    expect(r.operator).toBe('Map');
    expect(r.isFiniteCollection).toBe(false);
    expect(ce.box(['First', r]).evaluate().json).toEqual(2);
    // `Multiply` over an infinite source is lazy too; `Take` yields the cycle.
    const m = ce.box(['Multiply', ['Cycle', ['List', 1, 2]], 3]).evaluate();
    expect(m.operator).toBe('Map');
    expect(
      [...ce.box(['Take', m, 4]).evaluate().each()].map((x) => x.json)
    ).toEqual([3, 6, 3, 6]);
  });

  test('an unknown-length collection (Filter) broadcasts to a lazy Map, not a truncated List', () => {
    const ce = new ComputeEngine();
    // `Filter`'s count is `undefined` (it reports `isFiniteCollection === true`
    // yet an unknown size). The eager zip path treats an unknown count as 1 and
    // used to truncate this to the single-element `["List", 4]`. It must instead
    // produce the lazy `Map` form.
    const F = [
      'Filter',
      ['Range', 1, 100000],
      ['Function', ['Greater', 'x', 2], 'x'],
    ];
    const r = ce.box(['Add', F, 1]).evaluate();
    expect(r.operator).toBe('Map');
    expect(ce.box(['First', ['Add', F, 1]]).evaluate().json).toEqual(4);
    expect(
      [...ce.box(['Take', ['Add', F, 1], 3]).evaluate().each()].map((x) => x.json)
    ).toEqual([4, 5, 6]);
  });

  test('a symbolic-length Range broadcasts to a lazy Map that is reactive', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    // `Range(1, n)` with `n` undeclared-valued has `isFiniteCollection` and
    // `count` both `undefined`: the broadcast is lazy and picks up `n`'s binding
    // when the resulting `Map` is later evaluated.
    const r = ce.box(['Add', ['Range', 1, 'n'], 1]).evaluate();
    expect(r.operator).toBe('Map');
    // Serialization must not throw (round-trippable surface form).
    expect(typeof r.toString()).toBe('string');
    expect(typeof r.latex).toBe('string');
    // Reactivity: bind `n`, then re-evaluate the Map handle (still a lazy Map;
    // materialize via `each()`).
    ce.assign('n', 5);
    expect([...r.evaluate().each()].map((x) => x.json)).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  test('a generic op broadcasts symbolic-length Range to a lazy Map (finding 3)', () => {
    // A NON-lazy threadable operator (`Sin`) over a symbolic-length `Range`
    // (`isFiniteCollection === undefined`) must lazify into a `Map`, just like
    // the arithmetic `Add(Range(1,n),1)` path — its post-eval broadcast gate
    // admits the unresolved-finiteness source. (A LAZY operator keeps the strict
    // whole-collection fold: `Equal(Characters(s), Reverse(Characters(s)))` in
    // test/epsil/programs.test.ts "anagram and palindrome checks".)
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const r = ce.box(['Sin', ['Range', 1, 'n']]).evaluate();
    expect(r.operator).toBe('Map');
    expect(typeof r.toString()).toBe('string');
    ce.assign('n', 3);
    expect([...r.evaluate().each()].map((x) => x.N().re)).toEqual([
      Math.sin(1),
      Math.sin(2),
      Math.sin(3),
    ]);
    // The async gate composes identically (findings 3 + 4).
    const ce2 = new ComputeEngine();
    ce2.declare('m', 'integer');
    return ce2
      .box(['Sin', ['Range', 1, 'm']])
      .evaluateAsync()
      .then((a) => expect(a.operator).toBe('Map'));
  });

  test('a mixed finite + unknown-length sum maps all collections as Map sources', () => {
    const ce = new ComputeEngine();
    // When any broadcast operand is of unknown length, the whole result is a
    // single variadic `Map` — NOT the finite operand broadcast with the other
    // one spliced whole (which would cartesian). A symbolic-length `Range`
    // reports `count === undefined`, so it is not length-compared (nothing to
    // compare until it resolves) and the sum lazifies.
    ce.declare('n', 'integer');
    const r = ce
      .box(['Add', ['List', 10, 20, 30], ['Range', 1, 'n']])
      .evaluate();
    expect(r.operator).toBe('Map');
    ce.assign('n', 3);
    expect([...r.evaluate().each()].map((x) => x.json)).toEqual([11, 22, 33]);
  });

  test('a mixed finite + INFINITE sum is a length mismatch, not a truncated zip', () => {
    const ce = new ComputeEngine();
    // Audit finding (2026-07-27): this shape used to lazify into a
    // shortest-input `Map` ([11, 22, 31]) because the lazify branch ran with
    // no mismatch check — while `Less` on the same operands errored. An
    // infinite `count` is KNOWN (`Infinity`) and agrees with no finite
    // length (`docs/BROADCAST-MODEL.md`).
    const r = ce
      .box(['Add', ['List', 10, 20, 30], ['Cycle', ['List', 1, 2]]])
      .evaluate();
    expect(r.toString()).toMatch(/incompatible-dimensions/);
  });

  test('.N() over an infinite source threads the numeric wrap', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Sin', ['Cycle', ['List', 1, 2]]]).N();
    expect(r.operator).toBe('Map');
    // First element floats on access rather than staying symbolic `sin(1)`.
    expect(ce.box(['First', r]).evaluate().re).toBeCloseTo(
      Math.sin(1),
      10
    );
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

  test('PointZ over 2D points is an `incompatible-dimensions` error', () => {
    // REVERSED (item 138 clarified ask, 2026-08-02): a statically-absent
    // component is a TYPE-level fact → a typed error. This replaces the
    // 2026-07-22 NaN-over-Nothing ruling for `PointZ` (that ruling weighed the
    // position-preserving marker against `Nothing`, and never weighed a typed
    // error). `set<tuple<integer, integer>>` PROVES the points are 2-D, so the
    // mismatch is reported at type-check time and the WHOLE application errors
    // — not one marker per point.
    const ce = new ComputeEngine();
    const s = ce.box(['Set', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    const z = ce.box(['PointZ', s]);
    expect(z.isValid).toBe(false);
    expect(z.evaluate().toString()).toMatch(/incompatible-dimensions/);
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

  // Shape pin (revised for Tycho item 52): `PointList` is HYBRID-lazy like
  // every other broadcast form. At or below `MAX_SIZE_EAGER_COLLECTION` (100)
  // the transpose materializes the eager `List` of point-`Tuple`s
  // (byte-identical to the original consumer contract — see the ≤100 pins
  // above); PAST the threshold it is the lazy `Map` form, consumable via
  // `at`/`each`/`count`, so a large point list is no longer materialized —
  // and re-materialized per coordinate projection — eagerly (a 4001-point
  // transpose cost ~300 ms per consumer).
  test('PointList with >100 components is the lazy Map transpose', () => {
    const ce = new ComputeEngine();
    const ys = Array.from({ length: 200 }, (_, i) => i);
    const r = ce.box(['PointList', -6, ['List', ...ys]]).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.count).toBe(200);
    expect(r.at(1)?.json).toEqual(['Tuple', -6, 0]);
    expect(r.at(200)?.json).toEqual(['Tuple', -6, 199]);
  });

  test('PointList(...).N() with >100 components projects numeric point-tuples', () => {
    const ce = new ComputeEngine();
    const ys = Array.from({ length: 200 }, (_, i) => i);
    const r = ce.box(['PointList', -6, ['List', ...ys]]).N();
    expect(r.operator).toBe('Map');
    expect(r.isLazyCollection).toBe(true);
    expect(r.count).toBe(200);
    expect(r.at(1)?.json).toEqual(['Tuple', -6, 0]);
    expect(r.at(200)?.json).toEqual(['Tuple', -6, 199]);
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

describe('POINT/TUPLE ARITHMETIC — unknown-component tuples (Tycho item 30)', () => {
  // A tuple whose components type `unknown` (calls of a `-> unknown` function,
  // the shape a document engine's evidence-derived signatures produce) is
  // still statically a tuple: arithmetic must keep its honest tuple type
  // instead of collapsing to `number` and letting the `Add` scalar-plus-tuple
  // guard bake `incompatible-type`.
  const PAIR = String.raw`\frac{1}{n}(\lfloor nx\rfloor,\lfloor ny\rfloor)+\frac{1}{n}(S(x,y,0),S(x,y,0.5))`;

  function engineWith(sig: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('S', sig);
    ce.assign('n', 4);
    return ce;
  }

  test('minimal pair parses valid with S: -> unknown (raw tuple spelling)', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const expr = ce.parse(PAIR);
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Add');
    expect(expr.type.toString()).toBe('tuple<unknown, unknown>');
  });

  test('minimal pair parses valid with S: -> unknown (PointList spelling)', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const expr = ce.parse(
      String.raw`\frac{1}{n}(\lfloor nx\rfloor,\lfloor ny\rfloor)+\frac{1}{n}\operatorname{PointList}(S(x,y,0),S(x,y,0.5))`
    );
    expect(expr.isValid).toBe(true);
    expect(expr.operator).toBe('Add');
  });

  test('scalar · unknown-component tuple keeps the tuple type', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const p = ce.parse(String.raw`\frac{1}{n}(S(x,y,0),S(x,y,0.5))`);
    expect(p.operator).toBe('Multiply');
    expect(p.type.toString()).toBe('tuple<unknown, unknown>');
  });

  test('scalar · PointList of unknown components multiplies (not a nested Tuple)', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const p = ce.parse(
      String.raw`\frac{1}{n}\operatorname{PointList}(S(x,y,0),S(x,y,0.5))`
    );
    expect(p.operator).toBe('Multiply');
    expect(p.isValid).toBe(true);
  });

  test('sum of two unknown-component tuples keeps the tuple type', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const s = ce.parse(String.raw`(S(x,y,0),S(x,y,0.5))+(S(x,y,1),S(x,y,2))`);
    expect(s.isValid).toBe(true);
    expect(s.type.toString()).toBe('tuple<unknown, unknown>');
  });

  test('unknown-component tuple + scalar stays symbolic (retractable evidence, no baked error)', () => {
    const ce = engineWith('(number, number, number) -> unknown');
    const s = ce.parse(String.raw`(S(x,y,0),S(x,y,0.5))+2`);
    expect(s.isValid).toBe(true);
    expect(s.operator).toBe('Add');
  });

  test('once S resolves to a scalar body, the pair computes component-wise', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 4);
    ce.parse(String.raw`S(a,b,c)\coloneq a+b+c`).evaluate();
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce.parse(PAIR).evaluate();
    expect(r.operator).toBe('Tuple');
    expect(r.toString()).toBe('(7/4, 2.875)');
  });

  test('non-interference: declared heterogeneous tuple symbol still groups as Tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'tuple<string, number>');
    expect(ce.box(['InvisibleOperator', 2, 'h']).operator).toBe('Tuple');
  });
});

describe('POINT/TUPLE ARITHMETIC — could-be-numeric elements match the validation gate (item 30 review)', () => {
  // `couldBeNumericTuple` and `checkNumericArgs` share ONE predicate: any
  // tuple shape the validation layer admits must keep its tuple type through
  // the Add/Multiply type handlers (a divergence collapses the product to
  // `number` and re-bakes the item-30 error for that shape).
  test('tuple with a broadcastable<number> component keeps its tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    ce.assign('n', 4);
    const p = ce.parse(String.raw`\frac{1}{n}(2h(x)-1, 1)`);
    expect(p.operator).toBe('Multiply');
    // The scalar `1/n` (with `n := 4`, a rational) scales BOTH components, so
    // the literal `1` contributes a rational coordinate (`1/4`), not an
    // integer one — the component tier follows the declared scalar factor.
    expect(p.type.toString()).toBe('tuple<broadcastable<number>, finite_rational>');
    const sum = ce.parse(
      String.raw`\frac{1}{n}(\lfloor nx\rfloor,\lfloor ny\rfloor)+\frac{1}{n}(2h(x)-1, 1)`
    );
    expect(sum.isValid).toBe(true);
    expect(sum.operator).toBe('Add');
  });

  test('tuple with a collection<number> component multiplies (not a nested Tuple)', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'collection<number>');
    const p = ce.parse('2(c, 1)');
    expect(p.operator).toBe('Multiply');
    expect(p.isValid).toBe(true);
  });

  // §D6.1 shape-aware lift: shape-known operands now yield dimensioned static types.
  test('point-list component (scaled list) still admitted: 2·(1, 0.3m)', () => {
    const ce = new ComputeEngine();
    ce.assign('m', ce.parse('[1,2,3]').evaluate());
    const p = ce.parse('2(1, 0.3m)');
    expect(p.operator).toBe('Multiply');
    // Phase C representation unification: literal lists type honestly
    // (list<finite_…^dims>). The float factor folds INTO the cells, so the
    // component is a vector of REALS — the value is `[0.6, 1.2, 1.8]`, which
    // the previous `finite_integer` cell claim did not admit (Tycho item 194).
    expect(p.type.toString()).toBe('tuple<finite_integer, vector<finite_real^3>>');
  });

  test('provably non-numeric component: tuple<number, list<string>> symbol still groups as Tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'tuple<number, list<string>>');
    expect(ce.box(['InvisibleOperator', 2, 'w']).operator).toBe('Tuple');
  });

  test('point + declared list<tuple<…>> (point-list) stays a valid symbolic Add', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<number, number>>');
    const r = ce.parse('(1,2)+P');
    expect(r.isValid).toBe(true);
    expect(r.operator).toBe('Add');
  });

  // Pins the deliberate element-aware tightening of
  // `typeCouldBeNumericCollection`: a bare `list<string>` DIRECT operand
  // (not nested inside a tuple) of a threadable numeric op is rejected,
  // since its element type could not be numeric.
  test('list<string> direct operand of a threadable numeric op → Error(incompatible-type)', () => {
    const ce = new ComputeEngine();
    ce.declare('lstr', 'list<string>');
    const sum = ce.box(['Add', 'lstr', 1]);
    expect(errorCode(sum.op1)).toBe('incompatible-type');
    const sinExpr = ce.box(['Sin', 'lstr']);
    expect(errorCode(sinExpr.op1)).toBe('incompatible-type');
  });
});

describe('POINT/TUPLE ARITHMETIC — fixed-shape tuple components (deliberate widening)', () => {
  // A dimensioned collection component (`matrix`, `vector<n>`) counts as
  // could-be-numeric — matching what `checkNumericArgs` has always admitted —
  // so a tuple carrying one participates in tuple arithmetic and keeps its
  // honest tuple type instead of collapsing (see `couldBeNumericElement`).
  test('tuple<matrix, integer> symbol scales and adds with the tuple type kept', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'tuple<matrix, integer>');
    const p = ce.box(['InvisibleOperator', 2, 'w']);
    expect(p.operator).toBe('Multiply');
    expect(p.type.toString()).toBe('tuple<matrix, integer>');
    const s = ce.parse('w+w');
    expect(s.operator).toBe('Add');
    expect(s.type.toString()).toBe('tuple<matrix, integer>');
  });
});

describe('POINT/TUPLE ARITHMETIC — point-valued `\\mapsto` body', () => {
  // A delimited lambda body keeps the meaning its separator gives it, matching
  // the `f(t) := …` form: `(a, b)` is a Tuple, `(a; b)` is a statement Block.
  // Treating every delimited Sequence as a Block silently dropped all but the
  // LAST component, so a parametric curve returned only its y-component on
  // every compilation target (found alongside Tycho item 62).
  test('a comma-delimited body is a Tuple, not a Block', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('t \\mapsto (\\cos t, \\sin t)', {
      strict: false,
      canonical: false,
    });
    expect(f.json).toEqual(['Function', ['Tuple', ['Cos', 't'], ['Sin', 't']], 't']);
  });

  test('the point-valued lambda applies to both components', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('t \\mapsto (\\cos t, \\sin t)', { strict: false });
    const v = ce.box(['Apply', f, 0.5]).N();
    expectTypeBetween(v, { atMost: 'tuple<finite_real, finite_real>' });
    expect(v.op1.re).toBeCloseTo(Math.cos(0.5), 12);
    expect(v.op2.re).toBeCloseTo(Math.sin(0.5), 12);
  });

  test('it agrees with the equivalent `g(t) := …` assignment form', () => {
    const ce = new ComputeEngine();
    ce.parse('g(t) := (\\cos t, \\sin t)', { strict: false }).evaluate();
    const viaAssign = ce.parse('g(0.5)', { strict: false }).N();
    const f = ce.parse('t \\mapsto (\\cos t, \\sin t)', { strict: false });
    const viaLambda = ce.box(['Apply', f, 0.5]).N();
    expect(viaLambda.toString()).toBe(viaAssign.toString());
  });

  // A delimited sequence is DATA whatever its separator: the `;` infix builds a
  // `Block` only when the sequence contains an `Assign`, so a genuine statement
  // block arrives already built and a plain `(a; b)` must not lose `a`.
  test('a semicolon-delimited data body is a Tuple, not a Block', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('t \\mapsto (a; b)', {
      strict: false,
      canonical: false,
    });
    expect(f.json).toEqual(['Function', ['Tuple', 'a', 'b'], 't']);
  });

  test('semicolon-separated rows agree with the bare literal', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('t \\mapsto (1, 2; 3, 4)', { strict: false });
    const bare = ce.parse('(1, 2; 3, 4)', { strict: false });
    expect(ce.box(['Apply', f, 0]).evaluate().json).toEqual(bare.json);
  });

  test('a body that really is a statement block stays a Block', () => {
    const ce = new ComputeEngine();
    const f = ce.parse('t \\mapsto (x := 1; x+1)', {
      strict: false,
      canonical: false,
    });
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Declare', 'x'], ['Assign', 'x', 1], ['Add', 'x', 1]],
      't',
    ]);
    expect(ce.box(['Apply', f, 7]).N().re).toBe(2);
  });

  test('single-expression and undelimited bodies are unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('t \\mapsto (t+1)', { strict: false, canonical: false }).json).toEqual([
      'Function',
      ['Add', 't', 1],
      't',
    ]);
    expect(ce.parse('x \\mapsto x^2', { strict: false, canonical: false }).json).toEqual([
      'Function',
      ['Power', 'x', 2],
      'x',
    ]);
  });

  test('a lambda in an argument list does not swallow the following argument', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\mathrm{Map}(x \\mapsto x^2, [1,2,3])', {
        strict: false,
        canonical: false,
      }).json
    ).toEqual(['Map', ['Function', ['Power', 'x', 2], 'x'], ['List', 1, 2, 3]]);
  });
});

describe('POINT/TUPLE ARITHMETIC — point LIST scaled or divided elementwise', () => {
  // A collection whose elements are numeric tuples is a point list. Dividing
  // it by a scalar scales each point component-wise, so the quotient's
  // ELEMENTS stay tuples. The type used to collapse to `list<number>` while
  // the VALUE was a correct list of points, and `PointX`/`PointY` over that
  // type take the element-INDEX reading instead of the elementwise one.
  const pointListEngine = (denominatorType: string) => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<number, number>>');
    ce.declare('q', denominatorType as any);
    return ce;
  };

  test.each([
    'number',
    'finite_number',
    'list<number>',
    'indexed_collection<number>',
    'broadcastable<number>',
    'any',
    'unknown',
  ])('list<tuple<number, number>> / %s keeps tuple elements', (den) => {
    const ce = pointListEngine(den);
    expect(ce.box(['Divide', 'p', 'q']).type.toString()).toBe(
      'list<tuple<finite_number, finite_number>>'
    );
  });

  test('a 3-component point list keeps its arity through Divide', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<number, number, number>>');
    ce.declare('q', 'number');
    expect(ce.box(['Divide', 'p', 'q']).type.toString()).toBe(
      'list<tuple<finite_number, finite_number, finite_number>>'
    );
  });

  test('`p / q` and `p · (1/q)` agree on the element shape', () => {
    const ce = pointListEngine('number');
    const quotient = ce.box(['Divide', 'p', 'q']).type;
    const scaled = ce.box(['Multiply', 'p', ['Divide', 1, 'q']]).type;
    expect(quotient.matches('list<tuple<number, number>>')).toBe(true);
    expect(scaled.matches('list<tuple<number, number>>')).toBe(true);
  });

  test('a tuple-shaped denominator still has no defined quotient', () => {
    const ce = pointListEngine('tuple<number, number>');
    expect(ce.box(['Divide', 'p', 'q']).type.toString()).toBe('error');
  });

  // A divisor that can PRESENT a tuple divides point by point, and a point has
  // no reciprocal — the value is a list of `no-division-by-point` errors, so
  // the quotient must not claim the numerator's tuple shape. A matrix divisor
  // is excluded for a different reason: the value path leaves `p / M` inert.
  test.each([
    'list<tuple<number, number>>',
    'indexed_collection<tuple<number, number>>',
    'broadcastable<tuple<number, number>>',
    'matrix<2x2>',
  ])('a %s denominator does NOT keep the tuple shape', (den) => {
    const ce = pointListEngine(den);
    expect(ce.box(['Divide', 'p', 'q']).type.matches('list<tuple<number, number>>'))
      .toBe(false);
  });

  test('dividing two point lists errors per element', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Divide',
        ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]],
        ['List', ['Tuple', 1, 2], ['Tuple', 2, 2]],
      ])
      .evaluate();
    expect(value.toString()).toContain('no-division-by-point');
  });

  test('a `vector<n>` of scalars is a scalar divisor, not a shape', () => {
    // The type a LITERAL list of numbers carries (`[5, 10]` is
    // `vector<finite_integer^2>`), so excluding it would defeat the repair.
    const ce = pointListEngine('vector<3>');
    expect(
      ce.box(['Divide', 'p', 'q']).type.matches('list<tuple<number, number>>')
    ).toBe(true);
  });

  test('a matrix factor is a matrix product, not a per-point scale', () => {
    const ce = pointListEngine('matrix<2x2>');
    expect(
      ce.box(['Multiply', 'p', 'q']).type.matches('list<tuple<number, number>>')
    ).toBe(false);
  });

  test('scalar factors widen the point COMPONENTS', () => {
    // `[(3,4)] · 0.5 = [(1.5, 2)]` — echoing the integer components would
    // claim a type the value contradicts.
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<integer, integer>>');
    ce.declare('q', 'list<real>');
    ce.declare('r', 'real');
    expect(ce.box(['Multiply', 'p', 'q']).type.toString()).toBe(
      'list<tuple<real, real>>'
    );
    expect(ce.box(['Multiply', 'p', 'r']).type.toString()).toBe(
      'list<tuple<real, real>>'
    );
  });

  test('a point list times a sibling list of scalars keeps tuple elements', () => {
    const ce = pointListEngine('list<number>');
    expect(ce.box(['Multiply', 'p', 'q']).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
  });

  test('a collection of scalars is unaffected by either repair', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<number>');
    ce.declare('q', 'number');
    expect(ce.box(['Divide', 'p', 'q']).type.toString()).toBe(
      'list<finite_number>'
    );
    expect(ce.box(['Multiply', 'p', 'q']).type.toString()).toBe('list<number>');
  });

  test('a fixed-shape numerator keeps its dimensions', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector<3>');
    ce.declare('m', 'matrix<2x2>');
    ce.declare('q', 'number');
    expect(ce.box(['Divide', 'v', 'q']).type.toString()).toBe(
      'vector<finite_number^3>'
    );
    expect(ce.box(['Divide', 'm', 'q']).type.toString()).toBe(
      'matrix<finite_number^(2x2)>'
    );
  });

  test('the elementwise VALUE matches the repaired type', () => {
    const ce = new ComputeEngine();
    const points = ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]];
    const quotient = ce.box(['Divide', points, ['List', 5, 10]]);
    expect(quotient.type.matches('list<tuple<number, number>>')).toBe(true);
    expect(quotient.evaluate().toString()).toBe('[(3/5, 4/5),(3/5, 4/5)]');
    // The elementwise reading of `PointX`, not the element-INDEX one.
    expect(ce.box(['PointX', quotient]).evaluate().toString()).toBe(
      '[3/5,3/5]'
    );
  });
});

describe('POINT/TUPLE ARITHMETIC — zipped point-list quotient folds its elements', () => {
  // A `Divide(list<tuple>, list<number>)` is zipped element-wise, and each
  // element is built with `ce._fn('Divide', [tuple, scalar])` — which skips
  // `canonicalDivide`, where the single-tuple form does its component-wise
  // scaling. So the fold has to happen at the VALUE level, in `div()`; without
  // its numeric-tuple arm the element came back as an inert
  // `Multiply(1/d, tuple)` (or a tuple of unevaluated component quotients),
  // and only a divisor that folded to exactly 1 looked correct.

  /** `Sqrt(PointX(P)^2 + PointY(P)^2)`, over a point or a point list. */
  const norm = (P: any): any => [
    'Sqrt',
    ['Add', ['Power', ['PointX', P], 2], ['Power', ['PointY', P], 2]],
  ];

  // Two unit vectors: the first has a norm of 1.000000000000000165 (not
  // exactly 1), the second a norm of exactly 1.
  const T: any = ['Tuple', 0.9434411087063643, -0.3315401550384305];
  const U: any = ['Tuple', 0.6, 0.8];

  test('each element of a normalized point list is a folded Tuple', () => {
    const ce = new ComputeEngine();
    const points = ['List', T, U];
    const r = ce.box(['Divide', points, norm(points)]).evaluate();

    expect(r.operator).toBe('List');
    expect(r.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);
    // The divisor of the first element is 1.000000000000000165, not exactly 1
    // — the case that used to stay unfolded, while the second element (whose
    // divisor is exactly 1) folded either way.
    expect(r.op1.op1.re).toBeCloseTo(0.9434411087063643, 12);
    expect(r.op1.op2.re).toBeCloseTo(-0.3315401550384305, 12);
    expect(r.op2.toString()).toBe('(0.6, 0.8)');
    expect(r.type.matches('list<tuple<number, number>>')).toBe(true);
  });

  test('the zipped element agrees with the single-tuple quotient', () => {
    const ce = new ComputeEngine();
    const single = ce.box(['Divide', T, norm(T)]).evaluate();
    expect(single.operator).toBe('Tuple');

    const zipped = ce
      .box(['Divide', ['List', T, U], norm(['List', T, U])])
      .evaluate().op1;
    expect(zipped.operator).toBe('Tuple');
    expect(zipped.op1.re).toBeCloseTo(single.op1.re!, 15);
    expect(zipped.op2.re).toBeCloseTo(single.op2.re!, 15);
  });

  // Control: the `.N()` route already folded (the `Divide` handler floats the
  // quotient, and `mulN` scales a tuple through `mulTuples`), so only the
  // exact route was showing the inert product.
  test('.N() of the zipped quotient folds too', () => {
    const ce = new ComputeEngine();
    const points = ['List', T, U];
    const n = ce.box(['Divide', points, norm(points)]).N();
    expect(n.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);
  });

  test('an inexact divisor list folds each element (box route)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Divide',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['List', 1.25, 2.5],
      ])
      .evaluate();
    expect(r.toString()).toBe('[(0.8, 1.6),(1.2, 1.6)]');
    expect(r.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);
  });

  test('an inexact divisor list folds each element (parse route)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('\\frac{[(1,2),(3,4)]}{[1.25,2.5]}').evaluate();
    expect(r.toString()).toBe('[(0.8, 1.6),(1.2, 1.6)]');
    expect(r.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);
  });

  test('an exact divisor list keeps the components exact', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Divide', ['List', ['Tuple', 3, 4]], ['List', 5]])
      .evaluate();
    expect(r.toString()).toBe('[(3/5, 4/5)]');
    expect(r.op1.operator).toBe('Tuple');
    expect(r.type.matches('list<tuple<rational, rational>>')).toBe(true);
  });

  test('the single-tuple quotient is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Divide', ['Tuple', 3, 4], 5])
        .evaluate()
        .toString()
    ).toBe('(3/5, 4/5)');
    expect(ce.parse('\\frac{(3,4)}{1.25}').evaluate().toString()).toBe(
      '(2.4, 3.2)'
    );
    // A tuple divisor has no reciprocal, on both routes.
    expect(ce.box(['Divide', 5, ['Tuple', 3, 4]]).operator).toBe('Error');
  });

  // The degenerate divisors now answer the same on both routes. A zero
  // divisor divides each COMPONENT (`canonicalDivide` maps the components
  // before its own `a/0` rule), where the zipped element used to
  // short-circuit to a bare scalar `~oo`; a NaN divisor stays a scalar NaN on
  // both.
  test('a zero or NaN divisor answers as the single-tuple form does', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Divide', ['Tuple', 3, 4], 0]).evaluate().toString()).toBe(
      '(~oo, ~oo)'
    );
    expect(ce.box(['Divide', ['Tuple', 3, 4], NaN]).evaluate().toString()).toBe(
      'NaN'
    );

    const points = ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]];
    expect(
      ce
        .box(['Divide', points, ['List', 0, 2]])
        .evaluate()
        .toString()
    ).toBe('[(~oo, ~oo),(3, 4)]');
    expect(
      ce
        .box(['Divide', points, ['List', NaN, 2]])
        .evaluate()
        .toString()
    ).toBe('[NaN,(3, 4)]');
  });

  // Control: the product route folds through `mulTuples`, which `mulImpl`
  // dispatches to before assembling a `Product` — the arm `div()` was missing.
  test('the zipped PRODUCT folds its elements, in either operand order', () => {
    const ce = new ComputeEngine();
    const points = ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]];
    const scalars = ['List', 5, 0.5];

    const r1 = ce.box(['Multiply', points, scalars]).evaluate();
    expect(r1.toString()).toBe('[(15, 20),(3, 4)]');
    expect(r1.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);

    const r2 = ce.box(['Multiply', scalars, points]).evaluate();
    expect(r2.toString()).toBe('[(15, 20),(3, 4)]');
    expect(r2.ops!.map((op) => op.operator)).toEqual(['Tuple', 'Tuple']);
  });
});
