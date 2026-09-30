import { Complex } from 'complex-esm';
import {
  gamma as gammaComplex,
  incompleteGammaUpperComplex,
  incompleteGammaUpperComplexErrorBound,
  incompleteGammaUpperComplexWithError,
} from '../../src/compute-engine/numerics/numeric-complex';
import { engine } from '../utils';

const ce = engine;

// Upper incomplete gamma Γ(s, x) (`Gamma(s, x)`) at machine precision, with
// the emphasis on Re(x) < 0 (GitHub issue #353). Every expected value is
// mpmath `gammainc(s, x)` at 30 digits, principal branch; a real negative x is
// taken on the upper lip of the cut (x + 0i).

type Pin = [
  sRe: number,
  sIm: number,
  xRe: number,
  xIm: number,
  re: number,
  im: number,
];

/** Relative error of `v` against `re + i·im`, measured on the modulus. */
function relativeError(v: { re: number; im: number }, re: number, im: number) {
  return Math.hypot(v.re - re, v.im - im) / Math.hypot(re, im);
}

function boxComplex(re: number, im: number) {
  return im === 0 ? re : ['Complex', re, im];
}

function gammaN(sRe: number, sIm: number, xRe: number, xIm: number) {
  return ce
    .box(['Gamma', boxComplex(sRe, sIm), boxComplex(xRe, xIm)] as any)
    .N();
}

describe('INCOMPLETE GAMMA Γ(s, x) FOR Re(x) < 0 (issue #353)', () => {
  // The table of the issue: the old kernel dropped the branch term on the
  // negative real axis and lost digits off the axis.
  const issue: Pin[] = [
    [-1, 0, -5, 0, 10.502643535287858, 3.141592653589793],
    [-1, 0, -20, 0, 1357392.893567075, 3.141592653589793],
    [-1, 0, -30, 0, 12757390023.12546, 3.141592653589793],
    [-9, 0, -23.03, 0, 0.00046325492344689373, 8.657387162670286e-6],
    [0.5, 0, -20, 0, 1.772453850905516, -111433109.93704514],
    [0.5, 0, -30, 0, 1.772453850905516, -1985372430262.915],
    [-2, 1, -25, 3, -214382.63342394118, -132791.9830049377],
    [-1.5, 0, -3, 0.5, 1.7271183275165858, -1.435761685551467],
    [-2.2, 0, -4, 1, -1.065080794258787, -0.05995239558054908],
    [-3.1, 0, -5, 2, 0.2497948648180817, 0.028902715399632684],
    [0.5, 0, -8, 3, -372.9492163948243, 1018.632238180814],
    [-0.7, 0, -12, 5, -2342.2890813764316, 411.7979008108673],
  ];
  test.each(issue)('Γ(%p+%pi, %p+%pi)', (sRe, sIm, xRe, xIm, re, im) => {
    const v = gammaN(sRe, sIm, xRe, xIm);
    expect(relativeError(v, re, im)).toBeLessThan(1e-12);
  });

  // Points across the regions of the kernel (see the docstring of
  // `incompleteGammaUpperComplex`).
  const grid: Pin[] = [
    // Direct series near the negative real axis, |x| = 40..80
    [
      -2.2, 0, -39.392310120488325, 6.945927106677214, -785769681070.9597,
      684342135841.0563,
    ],
    [0.5, 2, -60, 0, 2.6507118904531596e22, 8.214528574751632e21],
    [-5, 0, -80, 0, 2.2875342980058958e23, 0.02617993877991501],
    [
      -0.7, 0, -86.60254037844386, 50, -8.427176222425237e33,
      1.4184922095043894e34,
    ],
    [
      1.5, -0.5, -4.924038765061041, -0.8682408883346517, 18.29527572308902,
      -59.97380432152766,
    ],
    // Continued fraction in the left half-plane
    [
      -1.5, 0, -12.5, 21.650635094610966, -7.977729817573693,
      -89.37139096678446,
    ],
    [
      4.7, 0, -5.20944533000791, -29.544232590366242, -18120944.085212912,
      -48871109.376872346,
    ],
    [-9, 0, -10.392304845413264, 6, 8.569494067238378e-7, 1.811850847778756e-7],
    [
      0, 0, -2.617860965592527, -149.9771542734587, 0.06609145298732695,
      0.06310539704788276,
    ],
    [
      2.5, 0, -0.26178609655925267, 14.997715427345868, 74.63730185251511,
      -11.213321185890797,
    ],
    // Kummer form (|x| < |s|)
    [12, 0, -4, 6.928203230275509, -214209006210.9248, 53220721302.56838],
    // Asymptotic series (|x| > 500 near the negative real axis)
    [0.3, 0, -600, 1, -4.283519018105844e258, 2.4164750978023277e257],
    // Negative integer s in the right half-plane (the old recurrence lost
    // every digit here)
    [-9, 0, 13, 7.5, 2.449249040148088e-18, 7.844939006856437e-20],
    // Right half-plane, moderate |x|: the old kernel's recurrence and its
    // asymptotic series lost digits here (real part 1.3133260e-8 and
    // 4.116e-21 respectively)
    [-2, 0, 10, 10, 1.313311503358186e-8, 4.4996673897584942e-9],
    [-11.93, 0, 11.44, 2.304, 5.076153836855542e-21, 8.336746826650347e-20],
  ];
  test.each(grid)('Γ(%p+%pi, %p+%pi)', (sRe, sIm, xRe, xIm, re, im) => {
    const v = gammaN(sRe, sIm, xRe, xIm);
    expect(relativeError(v, re, im)).toBeLessThan(1e-12);
  });

  test('on the cut, integer s: the imaginary part is (−1)^{n+1}π/n!', () => {
    // Γ(−n, x + 0i) for x < 0: the only imaginary part comes from −ln x.
    expect(gammaN(-1, 0, -30, 0).im).toBeCloseTo(Math.PI, 12);
    // Through `.N()` this imaginary part (about 1e-25 of the modulus) is
    // removed as rounding dust, so check the kernel itself.
    expect(
      incompleteGammaUpperComplex(new Complex(-5, 0), new Complex(-80, 0)).im
    ).toBeCloseTo(Math.PI / 120, 14);
    expect(gammaN(0, 0, -20, 0).im).toBeCloseTo(-Math.PI, 12);
  });

  test('on the cut, s = 1/2: the real part is Γ(1/2) = √π', () => {
    const v = gammaN(0.5, 0, -30, 0);
    expect(Math.abs(v.re - Math.sqrt(Math.PI))).toBeLessThan(1e-14);
  });

  test('a −0 imaginary part selects the lower lip of the cut', () => {
    const lower = incompleteGammaUpperComplex(
      new Complex(-1, 0),
      new Complex(-20, -0)
    );
    expect(
      relativeError(lower, 1357392.893567075, -3.141592653589793)
    ).toBeLessThan(1e-12);
    const upper = incompleteGammaUpperComplex(
      new Complex(-1, 0),
      new Complex(-20, 0)
    );
    expect(upper.im).toBeCloseTo(Math.PI, 12);
  });

  test('a zero of Γ(s, ·) is answered: Γ(2, −1) = 0', () => {
    const v = incompleteGammaUpperComplex(
      new Complex(2, 0),
      new Complex(-1, 0)
    );
    expect(Math.hypot(v.re, v.im)).toBeLessThan(1e-14);
  });

  test('s very close to a pole of Γ(s) near the cut: answers', () => {
    // Γ(s) and the k = 1 term of the series are both about 10⁶ and cancel;
    // the kernel sums them as one expression in s + 1 and answers.
    // mpmath gammainc(-0.999999, -3) = 3.2386482740815018 + 3.1416041563343511i
    const v = incompleteGammaUpperComplex(
      new Complex(-1 + 1e-6, 0),
      new Complex(-3, 0)
    );
    expect(
      relativeError(v, 3.2386482740815018, 3.1416041563343511)
    ).toBeLessThan(1e-13);
    expect(
      relativeError(
        gammaN(-0.999999, 0, -3, 0),
        3.2386482740815018,
        3.1416041563343511
      )
    ).toBeLessThan(1e-13);
    // At a distance of 10⁻³ as well.
    expect(
      relativeError(
        gammaN(-0.999, 0, -2, 1),
        1.2273352463984328,
        1.4332059975960756
      )
    ).toBeLessThan(1e-12);
    expect(
      relativeError(
        gammaN(-0.99, 0, -3, 0.5),
        3.1243400729496105,
        2.141377710983447
      )
    ).toBeLessThan(1e-12);
  });
});

/** The kernel's value at (s, x), or NaN when it declines. */
function kernel(sRe: number, sIm: number, xRe: number, xIm: number) {
  return incompleteGammaUpperComplex(
    new Complex(sRe, sIm),
    new Complex(xRe, xIm)
  );
}

/** Either the kernel declines (NaN) or its value is within `tolerance` of
 * `re + i·im`: never a wrong number. */
function expectAccurateOrDeclined(pin: Pin, tolerance = 1e-12) {
  const [sRe, sIm, xRe, xIm, re, im] = pin;
  const v = kernel(sRe, sIm, xRe, xIm);
  if (!v.isNaN()) expect(relativeError(v, re, im)).toBeLessThan(tolerance);
}

describe('INCOMPLETE GAMMA Γ(s, x) FOR A LARGE |Im s|, BOTH HALF-PLANES', () => {
  // For Re s < 0 and a large |Im s|, the continued fraction converges to a
  // wrong value (relative errors from 5e-11 to 2e-8 at these points before
  // the fix); the kernel now uses the series forms with an error check, or
  // declines. mpmath `gammainc` at 50 digits.
  const cases: Pin[] = [
    [
      -0.4068, -23.9375, 0.0881, -4.0085, 6.778457525074382e-18,
      -4.116361767977477e-19,
    ],
    [
      -0.1067, -26.834, 0.5411, -6.3629, -4.018027707897869e-20,
      3.9029518550842775e-20,
    ],
    [
      -1.8529, 24.515, 1.0238, 3.4181, -5.031392470160336e-18,
      3.7654551053936837e-17,
    ],
  ];
  test.each(cases)('Γ(%p+%pi, %p+%pi)', (...pin) => {
    expectAccurateOrDeclined(pin as Pin);
  });
  test('the first and the last are answered', () => {
    for (const [sRe, sIm, xRe, xIm, re, im] of [cases[0], cases[2]])
      expect(relativeError(kernel(sRe, sIm, xRe, xIm), re, im)).toBeLessThan(
        1e-12
      );
  });
});

describe('INCOMPLETE GAMMA Γ(s, x) NEXT TO A POLE OF Γ(s)', () => {
  // Γ(s) and the k = n term of the direct series cancel. Summed separately
  // they gave 1e-11 at these points; then the kernel declined them; now it
  // sums the two together and answers.
  const cases: Pin[] = [
    [
      -7.000000935, 0, -19.936, -1.1417, 0.026448745891215174,
      0.018535946846578225,
    ],
    [-5.999998, 0, -17.875, -0.805, -0.16021078320132406, -0.07229863162954078],
    [-0.999999, 0, -10, 0, 289.5830057473754, 3.1425037336642148],
  ];
  test.each(cases)('Γ(%p+%pi, %p+%pi)', (sRe, sIm, xRe, xIm, re, im) => {
    expect(relativeError(kernel(sRe, sIm, xRe, xIm), re, im)).toBeLessThan(
      1e-13
    );
  });

  // mpmath gammainc(s, x) at 40 digits, principal branch.
  const nearPoles: Pin[] = [
    // n = 3, a complex offset s + 3 = 2e−5 − 3e−5i
    [-2.99998, -3e-5, -1.5, 0.7, -0.4650302826957338, 0.071852395051470437],
    // n = 0, s = 1e−8
    [1e-8, 0, -2, 0.5, -4.7257499394666152, -1.3323419707968966],
    // n = 8, a purely imaginary offset 1e−7i
    [-8, 1e-7, 0.05, -0.02, -1664563412.0948434, 124594200.45198027],
    // n = 2 at a distance 0.3
    [-2.3, 0, -1, 2, 0.028298857224995117, -0.13563345760777367],
    // n = 5 at a distance 1e−9, on the cut
    [-4.999999999, 0, -12, 0, 0.12689144047665213, 0.026179939223222254],
  ];
  test.each(nearPoles)(
    'Γ(%p+%pi, %p+%pi) is answered',
    (sRe, sIm, xRe, xIm, re, im) => {
      expect(relativeError(kernel(sRe, sIm, xRe, xIm), re, im)).toBeLessThan(
        1e-13
      );
    }
  );

  test('the lower lip of the cut next to a pole', () => {
    // A −0 imaginary part selects the lower lip: for a real s the value is
    // the conjugate of the one on the upper lip.
    // mpmath conj(gammainc(-0.999999, -3)) = 3.2386482740815018 − 3.1416041563343511i
    const v = incompleteGammaUpperComplex(
      new Complex(-0.999999, 0),
      new Complex(-3, -0)
    );
    expect(
      relativeError(v, 3.2386482740815018, -3.1416041563343511)
    ).toBeLessThan(1e-13);
  });

  test('a small |x|: the series does not stop before the pole term', () => {
    // At s = −8 + 2.5e−9i the k = 8 term has the factor 1/(s + 8), and it
    // follows terms small enough to stop the sum (error 2e-12 before).
    const v = kernel(
      -7.999999999796636,
      2.513464234243423e-9,
      -0.00038782128013952995,
      -0.008399631010839449
    );
    expect(
      relativeError(v, 4649473678401858.5687, 1850093542678980.8714)
    ).toBeLessThan(1e-13);
  });
});

describe('INCOMPLETE GAMMA Γ(s, x) WHERE A FACTOR IS OUTSIDE THE DOUBLE RANGE', () => {
  test('x^s underflows but the value does not: Γ(−170, −100)', () => {
    // (−100)^(−170) ≈ 1e−340 is below the double range; the value is
    // 3.9e−299. Before the fix the kernel returned about 7e−308.
    expect(
      relativeError(
        kernel(-170, 0, -100, 0),
        3.9253576189576385e-299,
        -4.328803557788893e-307
      )
    ).toBeLessThan(1e-12);
    expect(
      relativeError(
        kernel(-170.5, 0, -100, 0),
        -3.3127395215386074e-308,
        -3.896223090533929e-300
      )
    ).toBeLessThan(1e-12);
  });

  test('a large |s| next to |x|: Γ(100 + 600i, −600) is not 0', () => {
    // The asymptotic series does not apply (its first term is larger than
    // 1); the direct series gives the value, which is mostly Γ(100 + 600i).
    expect(
      relativeError(
        kernel(100, 600, -600, 0),
        4.71418138186532e-133,
        -1.9797410857135354e-133
      )
    ).toBeLessThan(1e-12);
  });

  // e^{−x} overflows for Re x < −709, but x^(s−1) e^{−x} does not.
  const large: Pin[] = [
    [-5, 0, -712, 5, 3.104156505940748e291, 1.2393533528937772e292],
    [-5, 0, -712, 0, 1.2778259067196674e292, 0],
    [-20, 0, -740, 0, -1.369528317177863e261, 0],
    [-30, 0, -720, 2, 4.576298483127062e223, 1.2815922463010707e224],
  ];
  test.each(large)('Γ(%p+%pi, %p+%pi)', (sRe, sIm, xRe, xIm, re, im) => {
    expect(relativeError(kernel(sRe, sIm, xRe, xIm), re, im)).toBeLessThan(
      1e-12
    );
    expect(relativeError(gammaN(sRe, sIm, xRe, xIm), re, im)).toBeLessThan(
      1e-12
    );
  });

  test('a value above the double range stays symbolic, not ~oo', () => {
    // |Γ(−5, −2000)| ≈ 6e848. The kernel declines, and the pole of the
    // one-argument Γ at −5 does not apply to the two-argument Γ.
    expect(kernel(-5, 0, -2000, 0).isNaN()).toBe(true);
    const v = ce.box(['Gamma', -5, -2000]).N();
    expect(v.operator).toBe('Gamma');
    expect(v.nops).toBe(2);
    // The one-argument Γ keeps its pole.
    expect(ce.box(['Gamma', -5]).N().toString()).toBe('~oo');
  });
});

describe('COMPLEX Γ(z) WHERE sin(πz) OR Γ(1 − z) IS OUTSIDE THE DOUBLE RANGE', () => {
  // mpmath `gamma` at 50 digits.
  test('Γ(−2 ± 300i): sin(πz) overflows', () => {
    const v = ce.box(['Gamma', ['Complex', -2, 300]]).N();
    expect(
      relativeError(v, 3.448337914829406e-211, -8.293880091142565e-212)
    ).toBeLessThan(1e-12);
    expect(
      relativeError(
        gammaComplex(new Complex(-2, -300)),
        3.448337914829406e-211,
        8.293880091142565e-212
      )
    ).toBeLessThan(1e-12);
  });

  test('Γ(−2 + 200i) and Γ(−170.5): the reflection does not underflow', () => {
    expect(
      relativeError(
        gammaComplex(new Complex(-2, 200)),
        5.742502184562716e-143,
        1.5121643045334413e-142
      )
    ).toBeLessThan(1e-12);
    expect(
      relativeError(
        gammaComplex(new Complex(-170.5, 0)),
        -3.3127395215386074e-308,
        0
      )
    ).toBeLessThan(1e-12);
  });

  test('Γ(150): the Lanczos power does not overflow', () => {
    expect(
      relativeError(gammaComplex(new Complex(150, 0)), 3.80892263763057e260, 0)
    ).toBeLessThan(1e-12);
  });
});

describe('FUNCTIONS BUILT ON THE COMPLEX INCOMPLETE GAMMA KERNEL', () => {
  // mpmath ei, si, ci, erf at 30 digits.
  const cases: [string, number, number, number, number][] = [
    ['ExpIntegralEi', -20, 5, -4.771137451576535e-11, 3.1415926536726957],
    [
      'SinIntegral',
      4,
      6.928203230275509,
      -15.513195542478762,
      -69.39948176561143,
    ],
    ['CosIntegral', -12, 3, -0.32264592870198605, 2.3882105748576143],
    ['Erf', 2.5, 4.330127018922193, 23602.648415017833, -19420.31756080272],
  ];
  test.each(cases)('%s(%p+%pi)', (f, xRe, xIm, re, im) => {
    const v = ce.box([f, ['Complex', xRe, xIm]]).N();
    expect(relativeError(v, re, im)).toBeLessThan(1e-12);
  });
});

describe('REAL KERNEL: Γ(s, x) FOR A NON-POSITIVE INTEGER s AND x > 0', () => {
  // The downward recurrence from E₁(x) lost digits once x was more than a
  // few units (Γ(−15, 60) had a relative error of 3e-2). Expected values:
  // mpmath at 80 digits, cross-checked with x^s·E_{1−s}(x). (mpmath's
  // `gammainc` at 30 digits is itself off by 6e-10 at s = −30, x = 100.)
  const cases: [number, number, number][] = [
    [-15, 60, 2.457134903106344e-55],
    [-9, 30, 1.1957461517798303e-28],
    [-5, 100, 3.511348142522696e-56],
    [-2, 200, 1.7044289618319136e-94],
    [-30, 20, 3.8086141724982497e-50],
    [-30, 30, 7.512301415822472e-60],
    [-30, 100, 2.8448325478100563e-106],
    [-100, 50, 1.6263651812129003e-194],
    [0, 20, 9.835525290649882e-11],
    [-1, 0.5, 0.653287724649106],
    [-9, 0.5, 32.490649818689135],
  ];
  test.each(cases)('Γ(%p, %p)', (s, x, expected) => {
    const v = ce.box(['Gamma', s, x]).N();
    expect(v.im).toBe(0);
    expect(Math.abs(v.re - expected) / expected).toBeLessThan(1e-13);
  });
});

describe('INCOMPLETE GAMMA Γ(s, x): THE ERROR ESTIMATE AT ONE POINT', () => {
  // mpmath gammainc(4.5, -1.0397207708399179 - 4.71238898038469j)
  //   = 335.34914483174077 − 398.28123530121223i
  // (the incomplete gamma term of LerchPhi(−2, −3.5, 1.5)).
  test('the estimate is above the actual error and below the bound', () => {
    const s = new Complex(4.5, 0);
    const x = new Complex(-1.0397207708399179, -4.71238898038469);
    const { value, error } = incompleteGammaUpperComplexWithError(s, x);
    const actual = relativeError(
      value,
      335.34914483174077,
      -398.28123530121223
    );
    expect(actual).toBeLessThan(error);
    expect(error).toBeLessThan(
      incompleteGammaUpperComplexErrorBound(s, x) / 10
    );
  });

  test('a decline has no estimate', () => {
    // |Im s| > 10 with Re x < 0: the continued fraction is not reliable and
    // neither series passes its check.
    const r = incompleteGammaUpperComplexWithError(
      new Complex(19.427, 13.838),
      new Complex(-8.4445, -49.849)
    );
    expect(r.value.isNaN()).toBe(true);
    expect(r.error).toBeNaN();
  });
});
