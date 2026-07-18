import { ComputeEngine } from '../../src/compute-engine';

// Sign of powers of non-real bases (see the `Power`/`Square` sgn handlers in
// library/arithmetic.ts). A pure-imaginary base cycles with period 4:
// (βi)^p is real with sign (-1)^(p/2) for even integer p — z² = -β² < 0 but
// z⁴ = β⁴ > 0 (a previous, unreachable branch claimed `negative` for ALL
// non-real bases, which would have been wrong: i⁴ = 1, (1+i)² = 2i). A
// general non-real base is nonzero, so integer powers are only `not-zero`:
// `unsigned` would wrongly claim a definite imaginary part (w = 2i gives
// w² = -4, real).

describe('SGN OF POWERS OF NON-REAL BASES', () => {
  const ce = new ComputeEngine();
  ce.declare('z', 'imaginary');
  ce.declare('w', 'finite_complex');
  ce.declare('c', 'complex');
  ce.declare('n', 'integer');

  it('imaginary base, even integer exponent: sign is (-1)^(p/2)', () => {
    expect(ce.box(['Power', 'z', 2]).sgn).toBe('negative');
    expect(ce.box(['Power', 'z', 4]).sgn).toBe('positive');
    expect(ce.box(['Power', 'z', 6]).sgn).toBe('negative');
    // Negative even exponents follow the same parity: (2i)^-2 = -1/4.
    expect(ce.box(['Power', 'z', -2]).sgn).toBe('negative');
  });

  it('imaginary base, odd integer exponent: pure imaginary, unsigned', () => {
    expect(ce.box(['Power', 'z', 3]).sgn).toBe('unsigned');
    expect(ce.box(['Power', 'z', 5]).sgn).toBe('unsigned');
  });

  it('imaginary base, symbolic integer exponent: indeterminate', () => {
    // `integer` admits ±∞ and the half-parity is unknown.
    expect(ce.box(['Power', 'z', 'n']).sgn).toBeUndefined();
  });

  it('finite non-real base: integer powers are only not-zero', () => {
    // w may be pure imaginary at runtime (w = 2i → w² = -4, real negative),
    // so neither `negative` nor `unsigned` is sound.
    expect(ce.box(['Power', 'w', 2]).sgn).toBe('not-zero');
    expect(ce.box(['Power', 'w', 3]).sgn).toBe('not-zero');
  });

  it('possibly-infinite non-real base: indeterminate', () => {
    // `complex` admits ComplexInfinity; ∞^-2 = 0, so not even `not-zero`.
    expect(ce.box(['Power', 'c', 2]).sgn).toBeUndefined();
  });

  it('matches numeric ground truth for literal bases', () => {
    expect(ce.box(['Power', 'ImaginaryUnit', 2]).evaluate().toString()).toBe(
      '-1'
    );
    expect(ce.box(['Power', 'ImaginaryUnit', 4]).evaluate().toString()).toBe(
      '1'
    );
    expect(
      ce.box(['Power', ['Complex', 1, 1], 2]).evaluate().re
    ).toBeCloseTo(0);
  });
});
