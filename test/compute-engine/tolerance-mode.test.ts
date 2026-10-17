import { ComputeEngine } from '../../src/compute-engine';

//
// `ce.tolerance` (user decision 2026-10-16, issue #449):
//
// - The default is the fixed 1e-10 at every precision.
// - A number is kept as set, also across a precision change. Setting the
//   precision used to reset the tolerance to the default.
// - `'auto'` makes the tolerance follow the precision: 10^(-precision + 2),
//   recomputed at each precision change. It used to be the same as the
//   default.
// - A checkpoint restore puts the mode back, not only the number.
//
// Each test builds its own engine: constructing an engine or setting its
// precision writes the module-global `BigDecimal.precision`.
//

// π·(1 − 2.7e-12): below N(Pi) by 8.4e-12, inside the default tolerance.
const R = [
  'Multiply',
  'Pi',
  ['Subtract', 1, ['Divide', 256, ['Power', 5, 20]]],
];

describe('tolerance default', () => {
  test('1e-10 at the default precision and at 40 digits', () => {
    expect(new ComputeEngine().tolerance).toBe(1e-10);
    expect(new ComputeEngine({ precision: 40 }).tolerance).toBe(1e-10);
    const ce = new ComputeEngine();
    ce.precision = 40;
    expect(ce.tolerance).toBe(1e-10);
  });

  test('the default compares two 40-digit values 8.4e-12 apart as equal', () => {
    const ce = new ComputeEngine({ precision: 40 });
    expect(ce.box(['Equal', ['N', 'Pi'], R]).evaluate().json).toBe('True');
    expect(ce.box(['LessEqual', ['N', 'Pi'], R]).evaluate().json).toBe('True');
  });
});

describe('an explicit tolerance', () => {
  test('survives a precision change', () => {
    const ce = new ComputeEngine();
    ce.tolerance = 1e-30;
    ce.precision = 40;
    expect(ce.tolerance).toBe(1e-30);
    ce.precision = 21;
    expect(ce.tolerance).toBe(1e-30);
  });

  test('from the constructor', () => {
    expect(new ComputeEngine({ tolerance: 1e-5 }).tolerance).toBe(1e-5);
  });
});

describe("tolerance 'auto'", () => {
  test('is 10^(-precision + 2) and follows the precision', () => {
    const ce = new ComputeEngine();
    ce.tolerance = 'auto';
    expect(ce.tolerance).toBe(1e-19);
    ce.precision = 40;
    expect(ce.tolerance).toBe(1e-38);
    ce.precision = 'machine';
    expect(ce.tolerance).toBe(1e-13);
    expect(
      new ComputeEngine({ tolerance: 'auto', precision: 50 }).tolerance
    ).toBe(1e-48);
  });

  test('decides two 40-digit values 8.4e-12 apart by their value', () => {
    const ce = new ComputeEngine({ precision: 40, tolerance: 'auto' });
    expect(ce.box(['LessEqual', ['N', 'Pi'], R]).evaluate().json).toBe('False');
    expect(ce.box(['GreaterEqual', ['N', 'Pi'], R]).evaluate().json).toBe(
      'True'
    );
    expect(ce.box(['Equal', ['N', 'Pi'], R]).evaluate().json).toBe('False');
  });

  test('does not underflow above 325 digits', () => {
    const ce = new ComputeEngine({ precision: 400, tolerance: 'auto' });
    // The float getter cannot hold 1e-398: it is the smallest positive float.
    expect(ce.tolerance).toBe(Number.MIN_VALUE);
    expect(ce._bignumTolerance.toString()).toBe('1e-398');
    // Two 400-digit values 1e-399 apart are equal; 1e-397 apart they are not.
    const near = ['Add', ['N', 'Pi'], ['Power', 10, -399]];
    const far = ['Add', ['N', 'Pi'], ['Power', 10, -397]];
    expect(ce.box(['Equal', ['N', 'Pi'], near]).evaluate().json).toBe('True');
    expect(ce.box(['Equal', ['N', 'Pi'], far]).evaluate().json).toBe('False');
    expect(ce.box(['Less', ['N', 'Pi'], far]).evaluate().json).toBe('True');
    // `chop()` reads the exact big-decimal tolerance.
    expect(ce.chop(ce.bignum('1e-399'))).toBe(0);
    expect(ce.chop(ce.bignum('1e-397'))).not.toBe(0);
  });

  test('a number set afterwards ends the auto mode', () => {
    const ce = new ComputeEngine({ tolerance: 'auto' });
    ce.tolerance = 1e-8;
    ce.precision = 40;
    expect(ce.tolerance).toBe(1e-8);
  });
});

describe('checkpoint and restore', () => {
  test('restores the auto mode, not only the number', () => {
    const ce = new ComputeEngine({ tolerance: 'auto' });
    const cp = ce.checkpoint();
    ce.tolerance = 1e-5;
    ce.restore(cp);
    expect(ce.tolerance).toBe(1e-19);
    ce.precision = 30;
    expect(ce.tolerance).toBe(1e-28);
  });

  test('restores an explicit tolerance as explicit', () => {
    const ce = new ComputeEngine();
    ce.tolerance = 1e-10;
    const cp = ce.checkpoint();
    ce.tolerance = 'auto';
    ce.restore(cp);
    ce.precision = 40;
    expect(ce.tolerance).toBe(1e-10);
  });
});
