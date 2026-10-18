import { ComputeEngine } from '../../src/compute-engine';
import { hurwitzZetaComplexWithError } from '../../src/compute-engine/numerics/numeric-complex';
import { Complex } from 'complex.js';

// ζ(s, a) at a real a < 0: the terms (a + k)^(−s) left of the origin are
// large next to the value and cancel against the rest. At an odd integer
// order and a half-integer a they are the negatives of the first terms of
// ζ(s, a + m), so ζ(s, a) = ζ(s, 1 − a) exactly (both kernels answer that
// sum of positive terms). Elsewhere the double kernel estimates the
// cancellation and declines a value it cannot reach to 1e−12
// (`hurwitzZetaRealNegativeBase`, `numerics/numeric-complex.ts`), and the
// bignum kernel raises its guard digits until the sum keeps its digits
// (`bigZetaFront`, `numerics/special-functions.ts`).
//
// The reference values come from the pairing identity and from direct
// summation at 300 digits; mpmath's own `zeta(s, a)` answers wrong digits at
// a negative a when its working precision is below the cancellation.

const relative = (got: number, want: number) => Math.abs(got / want - 1);

describe('HurwitzZeta at a half-integer a < 0 with an odd order', () => {
  test('at the default precision: ζ(s, a) = ζ(s, 1 − a)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['HurwitzZeta', 101, -20.5]).N().toString()).toBe(
      '2.6800936841659847962e-135'
    );
    expect(ce.box(['HurwitzZeta', 101, 21.5]).N().toString()).toBe(
      '2.6800936841659847962e-135'
    );
    expect(ce.box(['HurwitzZeta', 21, -20.5]).N().toString()).toBe(
      '1.72813801246246960604e-28'
    );
    expect(ce.box(['HurwitzZeta', 11, -20.5]).N().toString()).toBe(
      '5.93357266672016451707e-15'
    );
    expect(ce.box(['HurwitzZeta', 7, -3.5]).N().toString()).toBe(
      '0.0000367380313644801934251'
    );
  });

  test('at 40 digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 40;
    expect(ce.box(['HurwitzZeta', 101, -20.5]).N().toString()).toBe(
      '2.680093684165984796203619955169605778966e-135'
    );
    expect(ce.box(['HurwitzZeta', 21, -20.5]).N().toString()).toBe(
      '1.728138012462469606041452325068117984281e-28'
    );
  });

  test('at machine precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const cases: [number, number, number][] = [
      [101, -20.5, 2.6800936841659847962e-135],
      [21, -20.5, 1.72813801246246960604e-28],
      [11, -20.5, 5.93357266672016451707e-15],
      [7, -3.5, 3.67380313644801934251e-5],
      [3, -0.5, 0.414398322117159997798],
    ];
    for (const [s, a, want] of cases)
      expect(relative(ce.box(['HurwitzZeta', s, a]).N().re, want)).toBeLessThan(
        1e-13
      );
  });

  test('a far-left a: answered at the engine precision, declined in doubles', () => {
    const ce = new ComputeEngine();
    // ζ(101, 2000001.5) ≈ 7.9e−633, past the range of a double. The value
    // is confirmed by direct summation at 320 digits.
    expect(ce.box(['HurwitzZeta', 101, -2000000.5]).N().toString()).toBe(
      '7.88821463088680208513e-633'
    );
    expect(
      hurwitzZetaComplexWithError(
        new Complex(101, 0),
        new Complex(-2000000.5, 0)
      )
    ).toBeUndefined();
    ce.precision = 'machine';
    const machine = ce.box(['HurwitzZeta', 101, -2000000.5]).N();
    expect(machine.operator).toBe('HurwitzZeta');
  });
});

describe('HurwitzZeta next to a half-integer a < 0 with an odd order', () => {
  test('the double kernel declines what it cannot reach, the bignum kernel answers', () => {
    const ce = new ComputeEngine();
    // The exact decimal −20.5000001 (the literal is read as a decimal).
    expect(ce.box(['HurwitzZeta', 21, -20.5000001]).N().toString()).toBe(
      '17.6160768006207924573'
    );
    // At the double −20.5000001 the sum in doubles is 17.61607700 for a
    // value of 17.61607680, so the kernel declines and the expression stays
    // symbolic at machine precision.
    expect(
      hurwitzZetaComplexWithError(
        new Complex(21, 0),
        new Complex(-20.5000001, 0)
      )
    ).toBeUndefined();
    ce.precision = 'machine';
    expect(ce.box(['HurwitzZeta', 21, -20.5000001]).N().operator).toBe(
      'HurwitzZeta'
    );
  });

  test('the bignum kernel answers next to a half-integer', () => {
    // The exact decimal −20.5000001 at s = 101: the two parts are about
    // 2¹⁰¹ and cancel to 1.0e26, 4 digits, within the guard digits.
    const ce = new ComputeEngine();
    expect(ce.box(['HurwitzZeta', 101, -20.5000001]).N().toString()).toContain(
      '1.0242616850561486448'
    );
  });

  test('a value the cancellation does not reach is answered in doubles', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    // At the double −20.4 (a + 20 = −0.39999999999999858): the reference at
    // that double is −227328090.2569211925734.
    expect(
      relative(
        ce.box(['HurwitzZeta', 21, -20.4]).N().re,
        -227328090.2569211925734
      )
    ).toBeLessThan(1e-13);
    expect(
      relative(
        ce.box(['HurwitzZeta', 7, -3.25]).N().re,
        -16376.7010038721974118
      )
    ).toBeLessThan(1e-13);
    // An even order: every term is positive, nothing cancels.
    expect(
      relative(ce.box(['HurwitzZeta', 2, -20.5]).N().re, 9.82199434464987948207)
    ).toBeLessThan(1e-13);
    // A non-integer order: the terms left of the origin are complex.
    const z = ce.box(['HurwitzZeta', 2.5, -20.5]).N();
    expect(relative(z.re, 6.24711063456881148529)).toBeLessThan(1e-13);
    expect(relative(z.im, -6.24018553443633196761)).toBeLessThan(1e-13);
  });
});

describe('HurwitzZeta at a half-integer a < 0 with another order', () => {
  test('an order next to an odd integer: the paired form does not cancel', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const z = ce.box(['HurwitzZeta', 3.001, -20.5]).N();
    expect(relative(z.re, 0.001170679065010831535)).toBeLessThan(1e-12);
    expect(relative(z.im, 0.02644761124443172542)).toBeLessThan(1e-12);
  });

  test('an even order: the value 2^1019 is answered, the estimate does not overflow', () => {
    expect(
      hurwitzZetaComplexWithError(new Complex(1018, 0), new Complex(-0.5, 0))
        ?.value.re
    ).toBe(5.617791046444737e306);
  });

  test('a half-integer order: the rotation has an exact zero', () => {
    // At s = 1.5 the real part is exactly ζ(s, a + m); a rounded cos(πs)
    // added −1.8e−16 times the front sum (about 1e6) to it.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const z = ce.box(['HurwitzZeta', 1.5, -20.0001]).N();
    expect(relative(z.re, 2.612576592902642949)).toBeLessThan(1e-12);
    expect(relative(z.im, 1000002.170485442326)).toBeLessThan(1e-12);
  });

  test('a − ⌊a⌋ rounds to 1/2 at −0.49999999999999994: not paired', () => {
    // The double kernel declines (the value −25.5 is the difference of two
    // parts of 2⁵¹); the bignum kernel answers the exact decimal.
    expect(
      hurwitzZetaComplexWithError(
        new Complex(51, 0),
        new Complex(-0.49999999999999994, 0)
      )
    ).toBeUndefined();
    const ce = new ComputeEngine();
    expect(
      ce.box(['HurwitzZeta', 51, -0.49999999999999994]).N().toString()
    ).toBe('-27.5620297184618831563');
  });
});

describe('HurwitzZeta at a complex far-left a', () => {
  test('the imaginary part is the Lipschitz sum, the same at every integer shift', () => {
    // Σ_{k∈ℤ} (k + a)^(−s) depends on a only modulo 1 (the Lipschitz
    // formula), and ζ(s, 1 − a) is negligible at both points, so
    // ζ(101, −20.5 + i) and ζ(101, −2000000.5 + i) share the imaginary part
    // 2.44249063727376467e−5. (mpmath answers 7.9e−633 + 3.9e−637i at the
    // second point, which is not the value.)
    const ce = new ComputeEngine();
    for (const re of [-20.5, -2000000.5]) {
      const z = ce.box(['HurwitzZeta', 101, ['Complex', re, 1]]).N();
      expect(relative(z.im, 2.44249063727376467e-5)).toBeLessThan(1e-12);
    }
  });
});
