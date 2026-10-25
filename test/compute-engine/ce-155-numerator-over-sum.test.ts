import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// `t − t + 1`, built so that the like terms are not collected (canonical
// forms do not collect like terms).
function numerator() {
  return ce.function('Subtract', [
    ce.function('Add', [ce.symbol('t'), ce.One], { form: 'raw' }),
    ce.symbol('t'),
  ]);
}

// CE-155.2: the like terms of a numerator are collected by `simplify()` when
// the denominator is a sum, as they are when it is a symbol.
describe('CE-155.2 like terms of a numerator over a sum', () => {
  test('(t − t + 1)/(y + z)', () => {
    const e = ce.function('Divide', [numerator(), ce.parse('y+z')]);
    expect(e.toString()).toBe('(t - t + 1) / (y + z)');
    expect(e.simplify().toString()).toBe('1 / (y + z)');
  });

  test('(t − t + 1)/y, for comparison', () => {
    const e = ce.function('Divide', [numerator(), ce.symbol('y')]);
    expect(e.simplify().toString()).toBe('1 / y');
  });

  test('a cancelled rational function is not expanded again', () => {
    expect(ce.parse('\\frac{x^2-4}{x^2+4x+4}').simplify().toString()).toBe(
      '(x - 2) / (x + 2)'
    );
  });
});
