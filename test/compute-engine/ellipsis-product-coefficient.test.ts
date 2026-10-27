import { ComputeEngine } from '../../src/compute-engine';
import { expand } from '../../src/compute-engine/boxed-expression/expand';

// A product with an ellipsis (`2 · 4 · … · 2n`) is a notation, not an
// arithmetic value. When it is a factor of a larger product, its operands
// must not be lifted into that product: the last sample `2n` then becomes the
// two factors `2` and `n`, and the factors on each side of the ellipsis are
// folded together. `3(2 · 4 · … · 2n)` evaluated to `3 · 2 · 4 · … · 2 · n`,
// and `expand()`, `simplify()` and `.mul()` gave `48 · … · n`
// (ROADMAP CE-462).

const ce = new ComputeEngine();

const NOTATION = [
  'Multiply',
  2,
  4,
  'ContinuationPlaceholder',
  ['Multiply', 2, 'n'],
];

describe('A coefficient times a product with an ellipsis', () => {
  test('parse route', () => {
    const expr = ce.parse('3(2\\cdot4\\cdot\\dots\\cdot2n)');
    const expected = ['Multiply', 3, NOTATION];
    expect(expr.json).toEqual(expected);
    expect(expr.evaluate().json).toEqual(expected);
    expect(expr.N().json).toEqual(expected);
    expect(expr.simplify().json).toEqual(expected);
    expect(expand(expr).json).toEqual(expected);
    expect(ce.function('Expand', [expr]).evaluate().json).toEqual(expected);
  });

  test('box route', () => {
    const expr = ce.box(['Multiply', 3, NOTATION] as any);
    const expected = ['Multiply', 3, NOTATION];
    expect(expr.json).toEqual(expected);
    expect(expr.evaluate().json).toEqual(expected);
    expect(expr.simplify().json).toEqual(expected);
  });

  test('the other factors are multiplied together', () => {
    const expr = ce.parse('3\\cdot5(2\\cdot4\\cdot\\dots\\cdot2n)');
    expect(expr.evaluate().json).toEqual(['Multiply', 15, NOTATION]);
    expect(
      ce.parse('3(2\\cdot4\\cdot\\dots\\cdot2n)').mul(ce.number(2)).json
    ).toEqual(['Multiply', 6, NOTATION]);
  });

  test('the product alone is unchanged', () => {
    const expr = ce.parse('2\\cdot4\\cdot\\dots\\cdot2n');
    expect(expr.evaluate().json).toEqual(NOTATION);
    expect(expr.simplify().json).toEqual(NOTATION);
  });
});

// In a sum, the coefficient of a term is taken apart from the rest of the
// term to collect like terms. A product with an ellipsis has no coefficient:
// `x + 3(2 · 4 · … · 2n)` became `x + 48 · … · n`.
describe('A product with an ellipsis in a sum', () => {
  const SCALED = ['Multiply', 3, NOTATION];

  test('x + 3(2 · 4 · … · 2n), parse route', () => {
    const expr = ce.parse('x+3(2\\cdot4\\cdot\\dots\\cdot2n)');
    const expected = ['Add', SCALED, 'x'];
    expect(expr.json).toEqual(expected);
    expect(expr.evaluate().json).toEqual(expected);
    expect(expr.N().json).toEqual(expected);
    expect(expr.simplify().json).toEqual(expected);
  });

  test('x + 3(2 · 4 · … · 2n), box route', () => {
    const expr = ce.box(['Add', 'x', SCALED] as any);
    const expected = ['Add', SCALED, 'x'];
    expect(expr.evaluate().json).toEqual(expected);
    expect(expr.N().json).toEqual(expected);
    expect(expr.simplify().json).toEqual(expected);
  });

  test('x(2 · 4 · … · 2n) + (2 · 4 · … · 2n)', () => {
    const expected = ['Add', ['Multiply', 'x', NOTATION], NOTATION];
    for (const expr of [
      ce.parse(
        'x(2\\cdot4\\cdot\\dots\\cdot2n)+(2\\cdot4\\cdot\\dots\\cdot2n)'
      ),
      ce.box(['Add', ['Multiply', 'x', NOTATION], NOTATION] as any),
    ]) {
      expect(expr.evaluate().json).toEqual(expected);
      expect(expr.N().json).toEqual(expected);
      expect(expr.simplify().json).toEqual(expected);
    }
  });

  test('like terms with the same product collect', () => {
    const expected = ['Multiply', 2, NOTATION];
    for (const expr of [
      ce.parse(
        '(2\\cdot4\\cdot\\dots\\cdot2n)+(2\\cdot4\\cdot\\dots\\cdot2n)'
      ),
      ce.box(['Add', NOTATION, NOTATION] as any),
    ]) {
      expect(expr.evaluate().json).toEqual(expected);
      expect(expr.N().json).toEqual(expected);
      expect(expr.simplify().json).toEqual(expected);
    }
    expect(
      ce
        .parse(
          '3(2\\cdot4\\cdot\\dots\\cdot2n)-3(2\\cdot4\\cdot\\dots\\cdot2n)'
        )
        .evaluate().json
    ).toEqual(0);
  });
});

// The factors beside a product with an ellipsis are multiplied together, and
// the product is kept whole. A coefficient `0` or `NaN` must still follow the
// rules of a product: `0 · (2 · 4 · … · 2n)` is `0`, not an unevaluated
// product.
describe('A zero or NaN coefficient times a product with an ellipsis', () => {
  const scaled = () => ce.parse('3(2\\cdot4\\cdot\\dots\\cdot2n)');

  test('mul()', () => {
    expect(scaled().mul(ce.Zero).json).toEqual(0);
    expect(scaled().mul(ce.NaN).isNaN).toBe(true);
    expect(scaled().mul(ce.Indeterminate).isIndeterminate).toBe(true);
  });

  test('evaluate()', () => {
    expect(
      ce.function('Multiply', [ce.Zero, scaled()]).evaluate().json
    ).toEqual(0);
    expect(
      ce.box(['Multiply', 0, ['Multiply', 3, NOTATION]] as any).evaluate().json
    ).toEqual(0);
    expect(
      ce.function('Multiply', [ce.NaN, scaled()]).evaluate().isNaN
    ).toBe(true);
    expect(
      ce.function('Multiply', [ce.Indeterminate, scaled()]).evaluate()
        .isIndeterminate
    ).toBe(true);
  });

  test('N()', () => {
    expect(ce.function('Multiply', [ce.Zero, scaled()]).N().json).toEqual(0);
    expect(ce.function('Multiply', [ce.NaN, scaled()]).N().isNaN).toBe(true);
    const indeterminate = ce
      .function('Multiply', [ce.Indeterminate, scaled()])
      .N();
    expect(indeterminate.isNaN).toBe(true);
  });
});
