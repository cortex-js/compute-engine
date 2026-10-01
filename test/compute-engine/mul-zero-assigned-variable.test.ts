/**
 * A zero factor beside a variable with an assigned value is not folded to
 * `0` by any spelling of the product: the product keeps the value the
 * variable holds when it is evaluated. Before 2026-09-30 `w.mul(0)` and a
 * canonical `Multiply(0, w)` kept `0w`, but `w.mul(ce.Zero)`,
 * `ce.Zero.mul(w)` and the `mul()` function folded it to `0`, which hid a
 * `NaN` held by `w`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { mul } from '../../src/compute-engine/boxed-expression/arithmetic-mul-div';

describe('ZERO TIMES A VARIABLE WITH AN ASSIGNED VALUE', () => {
  const ce = new ComputeEngine();
  ce.assign('w', ce.NaN);
  const w = ce.symbol('w');

  test.each([
    ['w.mul(0)', () => w.mul(0)],
    ['w.mul(ce.Zero)', () => w.mul(ce.Zero)],
    ['ce.Zero.mul(w)', () => ce.Zero.mul(w)],
    ['mul(0, w)', () => mul(ce.Zero, w)],
    ['box', () => ce.box(['Multiply', 0, 'w'])],
  ])('%s keeps the product and evaluates to NaN', (_, make) => {
    const e = make();
    expect(e.toString()).toBe('0w');
    expect(e.evaluate().isNaN).toBe(true);
  });

  test('the product follows a later assignment', () => {
    const local = new ComputeEngine();
    local.assign('u', local.NaN);
    const e = local.symbol('u').mul(local.Zero);
    expect(e.evaluate().isNaN).toBe(true);
    local.assign('u', 4);
    expect(e.evaluate().toString()).toBe('0');
  });

  test('a free symbol still folds', () => {
    expect(ce.symbol('x').mul(ce.Zero).toString()).toBe('0');
    expect(mul(ce.Zero, ce.symbol('x'), w).toString()).toBe('0w');
  });

  test('an expression that reads the variable keeps the product', () => {
    expect(mul(ce.Zero, ce.box(['Sin', 'w'])).toString()).toBe('0sin(w)');
  });

  test('an infinite factor is still the indeterminate form', () => {
    expect(mul(ce.Zero, ce.PositiveInfinity, w).isNaN).toBe(true);
  });

  test('a factor that cannot be a number is not absorbed', () => {
    const err = mul(ce.Zero, ce.error('foo'), w);
    expect(err.toString()).toBe(mul(ce.Zero, ce.error('foo')).toString());
    expect(mul(ce.Zero, ce.string('abc'), w).toString()).not.toBe('0w');
  });
});
