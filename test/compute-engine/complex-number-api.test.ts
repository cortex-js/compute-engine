import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

// The public constructors of a complex number and the boundaries that create
// one. `ce.complex()` is the double constructor: it returns a `Complex`
// object whose parts are doubles. `ce.number({ re, im })` keeps a
// `BigDecimal` part without rounding it to a double.
//
// Design note: `docs/plans/2026-09-27-big-decimal-imaginary-part.md`,
// decision D1 and §2.5.

const ce = new ComputeEngine();

describe('ce.number({ re, im })', () => {
  test('big-decimal parts are kept', () => {
    const z = ce.number({ re: ce.bignum('1e-800'), im: ce.bignum('2') });
    expect(isNumber(z) && z.isComplex).toBe(true);
    expect(z.bignumIm?.toString()).toBe('2');
    expect(z.bignumRe?.toString()).toBe('1e-800');
    expect(z.N().toString()).toBe('(1e-800 + 2i)');
  });

  test('a big-decimal imaginary part outside the double range is kept', () => {
    const tiny = ce.number({ re: 1, im: ce.bignum('1e-800') });
    expect(isNumber(tiny) && tiny.isComplex).toBe(true);
    expect(tiny.bignumIm?.toString()).toBe('1e-800');
    const huge = ce.number({ re: 0, im: ce.bignum('1e800') });
    expect(isNumber(huge) && huge.isComplex).toBe(true);
    expect(huge.N().toString()).toBe('1e+800i');
  });

  test('double parts give the same value as ce.complex()', () => {
    const a = ce.number({ re: 1, im: 2 });
    const b = ce.number(ce.complex(1, 2));
    expect(a.isSame(b)).toBe(true);
    expect(a.json).toEqual(b.json);
  });

  test('a zero imaginary part gives a real number', () => {
    expect(ce.number({ re: 1, im: 0 })).toBe(ce.One);
    const z = ce.number({ re: 1.5, im: ce.bignum(0) });
    expect(isNumber(z) && z.isComplex).toBe(false);
    expect(z.re).toBe(1.5);
  });

  test('ce.complex() rounds a big-decimal part to a double', () => {
    expect(ce.complex(0, ce.bignum('1e-800')).im).toBe(0);
  });
});

describe('Boundaries that build a complex value keep its big decimals', () => {
  test('the MathJSON Complex expression with an inexact part', () => {
    const z = ce.box(['Complex', 1.5, { num: '2.5e-800' }]);
    expect(isNumber(z) && z.isComplex).toBe(true);
    expect(z.bignumIm?.toString()).toBe('2.5e-800');
  });

  test('a float coefficient beside i', () => {
    const z = ce.parse('2.5\\cdot10^{-800}i');
    expect(isNumber(z) && z.isComplex).toBe(true);
    expect(z.bignumIm?.toString()).toBe('2.5e-800');
  });

  test('a float coefficient beside i keeps its digits at precision 50', () => {
    const ce50 = new ComputeEngine();
    ce50.precision = 50;
    const z = ce50.parse('1.2345678901234567890123456789\\cdot i');
    expect(z.bignumIm?.toString()).toBe('1.2345678901234567890123456789');
  });

  // The parity of the number of half-turns of a float angle above 2^53 was
  // lost when the coefficient beside `i` was rounded to a double:
  // 1152921504606846977 is odd, so the angle is 3π/2 modulo 2π.
  test('e^{1152921504606846977.5 iπ} at precision 50', () => {
    const ce50 = new ComputeEngine();
    ce50.precision = 50;
    expect(
      ce50.parse('e^{1152921504606846977.5 i\\pi}').evaluate().toString()
    ).toBe('-i');
    expect(
      ce50.parse('e^{1152921504606846976.5 i\\pi}').evaluate().toString()
    ).toBe('i');
  });

  test('.is() reads the imaginary part beyond the double range', () => {
    const huge = ce.parse('10^{800}i').N();
    expect(huge.is(ce.parse('10^{800}i').N())).toBe(true);
    // An inexact value compared with a primitive uses the tolerance only
    // when one is given (see `.is()`).
    const tiny = ce.parse('10^{-800}i').N();
    expect(tiny.is(0, 1e-10)).toBe(true);
    expect(tiny.is(ce.Zero)).toBe(true);
    expect(huge.is(0, 1e-10)).toBe(false);
    expect(huge.is(ce.Zero)).toBe(false);
  });
});

describe('Elementary functions of a complex argument above machine precision', () => {
  // The big-decimal methods compute both parts at the working precision; a
  // `complex-esm` kernel would give 16 digits. The reference values are
  // computed with the real big-decimal kernels of the same engine.
  const ce50 = new ComputeEngine();
  ce50.precision = 50;
  const digits = (x: string | undefined) =>
    (x ?? '').replace(/^-/, '').replace('.', '').replace(/^0+/, '').length;

  test('ln(1.5 + 2i)', () => {
    const z = ce50.parse('\\ln(1.5+2i)').N();
    // ln|z| = ln(2.5), arg z = arctan(2/1.5). The two computations can round
    // the last digit differently.
    const lnModulus = ce50.parse('\\ln(2.5)').N().bignumRe!;
    const argument = ce50.parse('\\arctan(4/3)').N().bignumRe!;
    expect(z.bignumRe!.sub(lnModulus).abs().lt(1e-48)).toBe(true);
    expect(z.bignumIm!.sub(argument).abs().lt(1e-48)).toBe(true);
  });

  test('(1.5 + 2i)^3 is exact to the working precision', () => {
    expect(ce50.parse('(1.5+2i)^3').N().toString()).toBe('(-14.625 + 5.5i)');
  });

  test('(1.5 + 2i)^{0.3} and the cube root have both parts at 50 digits', () => {
    for (const latex of ['(1.5+2i)^{0.3}', '\\sqrt[3]{1.5+2i}']) {
      const z = ce50.parse(latex).N();
      expect(digits(z.bignumRe?.toString())).toBeGreaterThan(45);
      expect(digits(z.bignumIm?.toString())).toBeGreaterThan(45);
      // The double value agrees with the machine kernel
      const machine = ce.parse(latex).N();
      expect(z.re).toBeCloseTo(machine.re, 14);
      expect(z.im).toBeCloseTo(machine.im, 14);
    }
  });
});

describe('Compile-time boundary (decision D2)', () => {
  // Compiled code computes in doubles: a folded imaginary part below the
  // double range is folded as the double 0.
  test('10^{-800}i folds to {re: 0, im: 0}', () => {
    const result = compile(ce.parse('10^{-800}i'), { to: 'javascript' });
    expect(result.success).toBe(true);
    const value = result.run!({}) as unknown;
    const re = typeof value === 'number' ? value : (value as any).re;
    const im = typeof value === 'number' ? 0 : (value as any).im;
    expect(re).toBe(0);
    expect(im).toBe(0);
  });
});
