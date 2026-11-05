import { ComputeEngine } from '../../src/compute-engine';
import { Terms } from '../../src/compute-engine/boxed-expression/arithmetic-add';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

it('keeps the canonical product when addition does not combine its coefficient', () => {
  const ce = new ComputeEngine();
  const term = ce.parse('\\frac{1}{8}\\operatorname{abs}(\\sin(8x))').evaluate();
  const result = new Terms(ce, [term, ce.One]).asExpression();
  expect(isFunction(result, 'Add')).toBe(true);
  expect(result.ops?.some((x) => x === term)).toBe(true);
});

it('combines, cancels and changes signs of like terms', () => {
  const ce = new ComputeEngine();
  const term = ce.parse('\\frac{1}{8}\\operatorname{abs}(\\sin(8x))').evaluate();
  expect(new Terms(ce, [term, term]).asExpression().isSame(term.mul(2))).toBe(true);
  expect(new Terms(ce, [term, term.neg()]).asExpression().isSame(0)).toBe(true);
  expect(new Terms(ce, [term, term.mul(-3)]).asExpression().isSame(term.mul(-2))).toBe(true);
});

it('preserves inexact coefficients and special numeric sums', () => {
  const ce = new ComputeEngine();
  expect(ce.parse('0.5x + 0.5x').evaluate().json).toEqual(['Multiply', { num: '1.0' }, 'x']);
  expect(ce.parse('0.5x - 0.5x').evaluate().json).toEqual({ num: '0.0' });
  expect(new Terms(ce, [ce.PositiveInfinity, ce.NegativeInfinity]).asExpression().isNaN).toBe(true);
  expect(new Terms(ce, [ce.NaN, ce.symbol('x')]).asExpression().isNaN).toBe(true);
});
