import { ComputeEngine } from '../../src/compute-engine';

// Under `x > 0`, a quotient is real when its denominator is provably nonzero.
// `Gamma(x + 2)` is typed `real`, and positive only through its `sgn` handler.

const gamma = ['Gamma', ['Add', 'x', 2]];
const product = ['Multiply', 'x', gamma];
const reciprocal = ['Divide', 1, product];
const withPower = [
  'Divide',
  ['Add', ['Multiply', 2, 'x'], ['Power', 'x', 'p']],
  product,
];

function engine(...assumptions: string[]) {
  const ce = new ComputeEngine();
  for (const a of assumptions) ce.assume(ce.parse(a));
  return ce;
}

const element = (ce: ComputeEngine, e: any) =>
  ce.box(['Element', e, 'RealNumbers']);

describe('ELEMENT OF A QUOTIENT UNDER ASSUMPTIONS', () => {
  test.each([
    ['1/x', ['Divide', 1, 'x']],
    ['x Gamma(x+2)', product],
    ['1/(x Gamma(x+2))', reciprocal],
    ['Power(x Gamma(x+2), -1)', ['Power', product, -1]],
  ])('x > 0: %s is real', (_, e) => {
    const ce = engine('x > 0');
    expect(element(ce, e).evaluate().json).toBe('True');
    expect(element(ce, e).simplify().evaluate().json).toBe('True');
    expect(ce.verify(element(ce, e))).toBe(true);
    expect(ce.box(e).isExtendedReal).toBe(true);
  });

  test('x > 0, p > 0: (2x + x^p) / (x Gamma(x+2)) is real', () => {
    const ce = engine('x > 0', 'p > 0');
    expect(element(ce, withPower).evaluate().json).toBe('True');
    expect(element(ce, withPower).simplify().evaluate().json).toBe('True');
    expect(ce.verify(element(ce, withPower))).toBe(true);
  });

  test('x > -3: 1/x is not known to be real', () => {
    const ce = engine('x > -3');
    expect(element(ce, ['Divide', 1, 'x']).evaluate().json).not.toBe('True');
    expect(ce.verify(element(ce, ['Divide', 1, 'x']))).not.toBe(true);
  });

  test('x > -3: 1/(x Gamma(x+2)) is not known to be real', () => {
    const ce = engine('x > -3');
    expect(element(ce, reciprocal).evaluate().json).not.toBe('True');
    expect(ce.verify(element(ce, reciprocal))).not.toBe(true);
  });

  test('no assumption: 1/x is not known to be real', () => {
    const ce = new ComputeEngine();
    expect(ce.verify(element(ce, ['Divide', 1, 'x']))).not.toBe(true);
  });
});
