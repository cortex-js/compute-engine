import { ComputeEngine } from '../../src/compute-engine';

/**
 * An absent POINT stays absent through arithmetic.
 *
 * An operator that propagates an absent scalar operand answers the quiet
 * marker of its own codomain (`docs/ERROR-MODEL.md` §2 rule 4, §3): `NaN`
 * when the application's own type — with its `missing` arm stripped — is a
 * subtype of `number`, and the position-preserving `Missing` otherwise. The
 * APPLICATION's type is what decides, not the operator's declared result:
 * `Negate` is declared `-> number`, yet `Negate(P[0])` for a list of points
 * `P` is typed `tuple<number, number, number>` through the tuple broadcast
 * exemption.
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
    // The application is typed a point, so the codomain marker is `Missing`.
    expect(expr.type.toString()).toBe('tuple<number, number, number>');
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
    // makes the APPLICATION a point.
    expect(expr.type.toString()).toBe('tuple<number, number, number>');
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
    const sum = ce
      .box(['Add', 'Missing', ['Tuple', 1, 2], ['List', 1, 2]])
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
