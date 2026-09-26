import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * An absent POINT stays absent through arithmetic.
 *
 * An operator that propagates an absent scalar operand answers the quiet
 * marker of its own codomain (`docs/ERROR-MODEL.md` §2 rule 4, §3): `NaN`
 * when the application's own type — with its `missing` arm stripped — is a
 * subtype of `number`, and the position-preserving `Missing` otherwise. The
 * APPLICATION's type is what decides, not the operator's declared result:
 * `Negate` is declared `-> number`, yet `Negate(P[0])` for a list of points
 * `P` is typed `missing | tuple<number, number, number>` through the tuple
 * broadcast exemption.
 *
 * In 0.128.0 the gate answered `NaN` unconditionally. An out-of-range point
 * access then scaled to the scalar `NaN`, and adding a point to that `NaN`
 * failed with an `incompatible-type` error, so a plot expression that reads
 * one point out of a point list broke on the empty or short list.
 *
 * A second rule covers the mixed pair: an absent addend or factor beside a
 * tuple makes the whole point absent. A tuple is atomic, so there is no cell
 * for the absence to land in, and a tuple of absent coordinates is not a value
 * any consumer reads.
 *
 * All-numeric absences are untouched: they still absorb into `NaN`. So is the
 * scalar-vs-LIST application, which broadcasts the absence per cell.
 */

/** An engine where `P` is a list of two 3-coordinate points, so `P[0]` is out
 * of range (the index is one-based) and `P[1]` is the first point. */
function engineWithPointList(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', 'list<tuple<number, number, number>>');
  ce.assign('P', ce.parse('[(1,2,3),(4,5,6)]'));
  return ce;
}

describe('an absent point access', () => {
  test('is `Missing`, typed `missing | tuple<…>`', () => {
    const ce = engineWithPointList();
    expect(ce.parse('P[0]').type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    expect(ce.parse('P[0]').evaluate().symbol).toBe('Missing');
  });

  test('scaled, it stays an absent point', () => {
    const ce = engineWithPointList();
    const expr = ce.parse('2\\cdot P[0]');
    // The application is typed a point that can be absent, so the codomain
    // marker is `Missing`, and the type keeps the operand's `missing` arm.
    expect(expr.type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    expect(expr.evaluate().symbol).toBe('Missing');
  });

  test('scaled and added to a point, it stays an absent point', () => {
    // The defect report's expression: `NaN + tuple` used to be an
    // `incompatible-type` error here.
    const ce = engineWithPointList();
    expect(ce.parse('2\\cdot P[0]+(1,1,1)').evaluate().symbol).toBe('Missing');
  });

  test('negated, it stays an absent point', () => {
    const ce = engineWithPointList();
    const expr = ce.box(['Negate', ['At', 'P', 0]]);
    // `Negate` is declared `-> number`; the tuple broadcast exemption is what
    // makes the APPLICATION a point (one that can be absent).
    expect(expr.type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    expect(expr.evaluate().symbol).toBe('Missing');
  });

  test('subtracted from, it stays an absent point', () => {
    const ce = engineWithPointList();
    expect(
      ce.box(['Subtract', ['At', 'P', 0], ['Tuple', 1, 1, 1]]).evaluate().symbol
    ).toBe('Missing');
  });

  test('divided by a number, it stays an absent point', () => {
    const ce = engineWithPointList();
    expect(ce.box(['Divide', ['At', 'P', 0], 2]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('a point that IS in range is unaffected', () => {
    const ce = engineWithPointList();
    expect(ce.parse('2\\cdot P[1]+(1,1,1)').evaluate().toString()).toBe(
      '(3, 5, 7)'
    );
  });

  test('the numeric-approximation route answers the same', () => {
    const ce = engineWithPointList();
    expect(ce.parse('2\\cdot P[0]').N().symbol).toBe('Missing');
    expect(ce.parse('2\\cdot P[0]+(1,1,1)').N().symbol).toBe('Missing');
    expect(ce.box(['Negate', ['At', 'P', 0]]).N().symbol).toBe('Missing');
    expect(ce.box(['Multiply', 2, 'Missing']).N().toString()).toBe('NaN');
    // A symbol ASSIGNED `Missing` types `never`; a numeric operator over it
    // keeps the numeric marker.
    ce.assign('w', ce.Missing);
    expect(ce.parse('\\sin(w)').N().isNaN).toBe(true);
  });

  test('the asynchronous route answers the same', async () => {
    // The async driver has its own copy of the missing-value gate; the two
    // must decide alike.
    const ce = engineWithPointList();
    expect((await ce.parse('2\\cdot P[0]').evaluateAsync()).symbol).toBe(
      'Missing'
    );
    expect(
      (await ce.box(['Negate', ['At', 'P', 0]]).evaluateAsync()).symbol
    ).toBe('Missing');
    expect((await ce.box(['Sin', 'Missing']).evaluateAsync()).toString()).toBe(
      'NaN'
    );
  });
});

describe('an absent operand beside a point', () => {
  test('`Add(Missing, (1,1,1))` is `Missing`', () => {
    // Before the rule the sum stayed as symbolic residue,
    // `"Missing" + (1, 1, 1)`.
    const ce = new ComputeEngine();
    expect(
      ce.box(['Add', 'Missing', ['Tuple', 1, 1, 1]]).evaluate().symbol
    ).toBe('Missing');
  });

  test('`Multiply(Missing, (1,1,1))` is `Missing`', () => {
    // Before the rule the product distributed into
    // `("Missing", "Missing", "Missing")`.
    const ce = new ComputeEngine();
    expect(
      ce.box(['Multiply', 'Missing', ['Tuple', 1, 1, 1]]).evaluate().symbol
    ).toBe('Missing');
  });
});

describe('an absence in a codomain that is not provably numeric', () => {
  test('a function declared `-> unknown` keeps `Missing` through a product', () => {
    const ce = new ComputeEngine();
    ce.declare('u', {
      signature: '(number) -> unknown',
      evaluate: () => ce.Missing,
    });
    expect(ce.box(['u', 3]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Multiply', 2, ['u', 3]]).evaluate().symbol).toBe('Missing');
  });
});

describe('all-numeric absences still absorb into `NaN`', () => {
  test('a product, a negation and a transcendental of `Missing`', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Multiply', 2, 'Missing']).evaluate().toString()).toBe(
      'NaN'
    );
    expect(ce.box(['Negate', 'Missing']).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Sin', 'Missing']).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Add', 'Missing', 1]).evaluate().toString()).toBe('NaN');
  });

  test('a numeric piecewise with no default arm', () => {
    // `g(t) = 0.5` when `t < 1`, absent otherwise: `g(3)` is `Missing` and the
    // sum is typed `number`, so the numeric marker is the answer.
    const ce = new ComputeEngine();
    ce.parse('g(t) := \\begin{cases} 0.5 & t < 1 \\end{cases}').evaluate();
    expect(ce.box(['Add', ['g', 3], 1]).type.toString()).toBe('number');
    expect(
      ce
        .box(['Add', ['g', 3], 1])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(ce.parse('2\\cdot g(3)').evaluate().toString()).toBe('NaN');
    expect(ce.parse('-g(3)').evaluate().toString()).toBe('NaN');
  });

  test('a scalar-vs-LIST application still broadcasts per cell', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Add', 'Missing', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN]');
  });
});

describe('the whole-point absence arm stands aside', () => {
  test('when a LIST is also an operand, the list shape is kept', () => {
    // The sum is a broadcast over the list; the absent point lands in each
    // cell through the collection kernel, not as one `Missing` for the whole.
    const ce = new ComputeEngine();
    // The list holds points: a point plus a list of NUMBERS is rejected when
    // the expression is created (`incompatible-type`).
    const sum = ce
      .box([
        'Add',
        'Missing',
        ['Tuple', 1, 2],
        ['List', ['Tuple', 1, 1], ['Tuple', 2, 2]],
      ])
      .evaluate();
    expect(sum.symbol).not.toBe('Missing');
    expect(sum.isCollection).toBe(true);
    const product = ce
      .box(['Multiply', 'Missing', ['Tuple', 1, 2], ['List', 1, 2]])
      .evaluate();
    expect(product.symbol).not.toBe('Missing');
    expect(product.isCollection).toBe(true);
  });

  test('when two points are multiplied, the error outranks the absence', () => {
    // There is no product between points; `f(3)` only becomes a point when
    // evaluated, so canonicalization cannot see the second point.
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(number) -> unknown',
      evaluate: () => ce.box(['Tuple', 3, 4]),
    });
    const product = ce
      .box(['Multiply', 'Missing', ['Tuple', 1, 2], ['f', 3]])
      .evaluate();
    expect(product.symbol).not.toBe('Missing');
    expect(JSON.stringify(product.json)).toContain('Error');
  });
});

/**
 * A point with an ABSENT COORDINATE, such as `(1, Missing)` (the value of a
 * restricted coordinate whose condition is false), follows the `Norm`
 * precedent: `Norm((1, Missing))` is `NaN`, typed `number`. The operators
 * that compute a number from the point (`Distance`, `Dot`) answer `NaN`; the
 * operators that read a coordinate (`PointX`/`PointY`/`PointZ`,
 * `First`/`Second`/`Third`/`Last`) answer the coordinate as it is, and their
 * static type is read off the type of that coordinate.
 */
describe('a point with an absent coordinate', () => {
  const ce = new ComputeEngine();
  ce.assign('pAbsent', ce.box(['Tuple', 1, 'Missing']));

  const value = (json: any, n = false): string => {
    const e = ce.box(json);
    return (n ? e.N() : e.evaluate()).toString();
  };
  const type = (json: any): string => ce.box(json).type.toString();

  test.each([
    [['Distance', ['Tuple', 1, 'Missing'], ['Tuple', 0, 0]]],
    [['Distance', ['Tuple', 1, 'Undefined'], ['Tuple', 0, 0]]],
    [['Distance', ['Tuple', 0, 0], ['Tuple', 'Missing', 1]]],
    [['Distance', ['Tuple', 'PositiveInfinity', 'Missing'], ['Tuple', 0, 0]]],
    [['Distance', ['List', 1, 'Missing'], ['Tuple', 0, 0]]],
    [['Distance', 'pAbsent', ['Tuple', 0, 0]]],
    [['Dot', ['Tuple', 1, 'Missing'], ['Tuple', 1, 1]]],
    [['Dot', ['Tuple', 1, 'Undefined'], ['Tuple', 1, 1]]],
    [['Dot', ['Tuple', 1, 1], ['Tuple', 'Missing', 1]]],
    [['Dot', ['Tuple', 1, 'Missing'], ['List', 1, 1]]],
    [['Dot', 'pAbsent', ['Tuple', 1, 1]]],
  ])('%j is NaN, typed number', (json) => {
    // `Distance` answered an `expected-value` error; `Dot` stayed
    // unevaluated.
    expect(value(json)).toBe('NaN');
    expect(value(json, true)).toBe('NaN');
    expect(type(json)).toBe('number');
  });

  test('a point of the wrong width is still a dimension error', () => {
    expect(value(['Dot', ['Tuple', 1, 'Missing'], ['Tuple', 1, 1, 1]])).toBe(
      'Error("incompatible-dimensions", "2 vs 3")'
    );
  });

  test.each([
    [
      [
        'Distance',
        ['List', ['Tuple', 1, 'Missing'], ['Tuple', 3, 4]],
        ['Tuple', 0, 0],
      ],
      '[NaN,5]',
    ],
    [
      [
        'Distance',
        ['Tuple', 0, 0],
        ['List', ['Tuple', 3, 4], ['Tuple', 'Undefined', 1]],
      ],
      '[5,NaN]',
    ],
    [
      [
        'Dot',
        ['List', ['Tuple', 1, 'Missing'], ['Tuple', 2, 3]],
        ['Tuple', 1, 1],
      ],
      '[NaN,5]',
    ],
    [
      [
        'Dot',
        ['Tuple', 1, 'Missing'],
        ['List', ['Tuple', 2, 3], ['Tuple', 4, 5]],
      ],
      '[NaN,NaN]',
    ],
    // The scalar route and the list route agree with `Norm`.
    [['Norm', ['List', ['Tuple', 1, 'Missing'], ['Tuple', 3, 4]]], '[NaN,5]'],
  ])('inside a list of points, %j is NaN for that point', (json, expected) => {
    expect(value(json)).toBe(expected);
    expect(value(json, true)).toBe(expected);
  });

  test('a symbol holding the point is typed as the point is', () => {
    // A tuple component that is only absent was stripped to the bottom type
    // `never` before the type handler read it: `Dot(pAbsent, (1, 1))` was
    // typed `infinity` and `Norm(pAbsent)` `list<number>`.
    expect(type(['Norm', 'pAbsent'])).toBe('number');
    expect(value(['Norm', 'pAbsent'])).toBe('NaN');
  });

  test.each([
    [['PointX', ['Tuple', 1, 'Missing']], 'integer | nan', '1'],
    [['PointY', ['Tuple', 1, 'Missing']], 'missing', '"Missing"'],
    [['PointY', ['Tuple', 1, 'Undefined']], 'missing', '"Undefined"'],
    [['PointX', 'pAbsent'], 'integer | nan', '1'],
    [['PointY', 'pAbsent'], 'missing', '"Missing"'],
    [['First', ['Tuple', 1, 'Missing']], 'integer', '1'],
    [['Second', ['Tuple', 1, 'Missing']], 'missing', '"Missing"'],
    [['Last', ['Tuple', 1, 'Missing']], 'missing', '"Missing"'],
    [['Third', ['Tuple', 1, 2, 'Missing']], 'missing', '"Missing"'],
    [['PointZ', ['Tuple', 1, 2, 'Missing']], 'missing', '"Missing"'],
    [['PointY', ['List', 1, 'Missing']], 'missing | number', '"Missing"'],
    [
      ['PointY', ['List', ['Tuple', 1, 'Missing'], ['Tuple', 2, 3]]],
      'list<missing | number>',
      '["Missing",3]',
    ],
    [
      ['PointX', ['List', ['Tuple', 1, 'Missing'], ['Tuple', 2, 3]]],
      'list<number>',
      '[1,2]',
    ],
  ])(
    'the accessor %j reads the type of its coordinate',
    (json, expectedType, expectedValue) => {
      // The coordinate accessors were typed `number` (and `First`/`Second`/
      // `Last` `never`) while their value was `Missing`.
      expect(type(json)).toBe(expectedType);
      expect(value(json)).toBe(expectedValue);
    }
  );

  test.each([
    [['Distance', ['Tuple', 1, 'Missing'], ['Tuple', 0, 0]], 'NaN'],
    [
      [
        'Distance',
        ['List', ['Tuple', 1, 'Missing'], ['Tuple', 3, 4]],
        ['Tuple', 0, 0],
      ],
      'NaN,5',
    ],
    [['Dot', ['Tuple', 1, 'Missing'], ['Tuple', 1, 1]], 'NaN'],
  ])('compiled to JavaScript, %j agrees', (json, expected) => {
    // The compiled `Distance` threw "expected points (flat numeric arrays)"
    // at run time on the `undefined` coordinate.
    const compiled = compile(ce.box(json));
    expect(compiled.success).toBe(true);
    expect(String((compiled.run as () => unknown)())).toBe(expected);
  });
});

describe('a point of absent coordinates only, and a product against a matrix', () => {
  const ce = new ComputeEngine();
  const val = (json: any) => ce.box(json).evaluate().toString();

  test('the flat list of absent values is a point: its distance is NaN', () => {
    // Found by review 2026-09-25: `[Missing, Missing]` was routed to the
    // list-of-points broadcast and answered `incompatible-type`, while the
    // tuple spelling `(Missing, Missing)` answered `NaN`.
    for (const json of [
      ['Distance', ['List', 'Missing', 'Missing'], ['List', 0, 0]],
      ['Distance', ['List', 'Missing', 'Missing'], ['Tuple', 0, 0]],
      ['Distance', ['List', 'Undefined'], ['List', 0]],
      ['Distance', ['Tuple', 'Missing', 'Missing'], ['Tuple', 0, 0]],
    ]) {
      const e = ce.box(json);
      expect([json, e.evaluate().toString()]).toEqual([json, 'NaN']);
      expect([json, e.N().toString()]).toEqual([json, 'NaN']);
      // The static type admits the value: an all-absent list could as well
      // be a list of absent points, so it is the undecided union.
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
    expect(
      val(['Distance', ['List', 'Missing', 'Missing'], ['List', 0, 0, 0]])
    ).toBe('Error("incompatible-dimensions")');
  });

  test('a point with an absent coordinate against a matrix is a vector of NaN', () => {
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(val(['Dot', ['Tuple', 1, 'Missing'], M])).toBe('[NaN,NaN]');
    expect(val(['Dot', M, ['Tuple', 1, 'Missing']])).toBe('[NaN,NaN]');
    expect(
      ce
        .box(['Dot', ['Tuple', 1, 'Missing'], M])
        .N()
        .toString()
    ).toBe('[NaN,NaN]');
    // A width mismatch is still the dimension error.
    expect(val(['Dot', ['Tuple', 1, 'Missing', 2], M])).toMatch(
      /incompatible-dimensions/
    );
  });
});
