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

  test('a product that contains the variable keeps the product', () => {
    // The nested product is flattened, then `0·2` is folded: the fold must
    // still keep `w`, as it does for `Multiply(0, w)`.
    const local = new ComputeEngine();
    local.assign('u', 4);
    const twoU = local.box(['Multiply', 2, 'u']);
    const products = [
      local.Zero.mul(twoU),
      mul(local.Zero, twoU),
      local.box(['Multiply', 0, 2, 'u']),
      local.box(['Multiply', 0, ['Multiply', 2, 'u']]),
    ];
    for (const e of products) expect(e.toString()).toBe('0u');
    local.assign('u', local.NaN);
    for (const e of products) expect(e.evaluate().isNaN).toBe(true);
    // The canonical fold does not read the value held when it is boxed.
    expect(local.box(['Multiply', 0, 2, 'u']).toString()).toBe('0u');
  });

  test('a float factor is kept beside the held variable', () => {
    // With `u := ∞`, `0 · 2.5 · u` is `NaN` (a float meets the
    // indeterminate form), not `Indeterminate`.
    const local = new ComputeEngine();
    local.assign('u', local.PositiveInfinity);
    const u = local.symbol('u');
    const e = mul(local.Zero, local.number(2.5), u);
    expect(e.evaluate().isNaN).toBe(true);
    expect(e.evaluate().isIndeterminate).toBe(false);
    expect(
      local.box(['Multiply', 0, 2.5, 'u']).evaluate().isIndeterminate
    ).toBe(false);
    local.assign('u', 4);
    expect(e.evaluate().isSame(0)).toBe(true);
  });

  test('a float zero is kept once', () => {
    // The float zero is the zero factor, and not also a float factor kept
    // beside the held variable: `0.0 · u` was `0 · 0 · u`.
    const local = new ComputeEngine();
    local.assign('u', local.NaN);
    const zero = local.box({ num: '0.0' });
    const u = local.symbol('u');
    for (const e of [zero.mul(u), u.mul(zero), mul(zero, u)])
      expect(e.json).toEqual(['Multiply', { num: '0.0' }, 'u']);
  });

  test('a factor that cannot be a number is not absorbed', () => {
    const err = mul(ce.Zero, ce.error('foo'), w);
    expect(err.toString()).toBe(mul(ce.Zero, ce.error('foo')).toString());
    expect(mul(ce.Zero, ce.string('abc'), w).toString()).not.toBe('0w');
  });
});
