import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { incompleteGammaUpper } from '../../src/compute-engine/numerics/special-functions';

// Γ(s, z) for non-integer s < −1 and small z, against mpmath `gammainc` (50
// digits). The Legendre fraction did not converge there and the result was
// off by 4e-5 at (−1.5, 10⁻⁶). The worst relative error over this table is
// 3.0e-15; the bound below leaves room for platform `Math.pow` differences.
const TOLERANCE = 1e-13;

const cases: [number, number, number][] = [
  [-1.5, 1e-6, 666664669.02893851324],
  [-1.5, 0.001, 21020.937167123547847],
  [-1.5, 0.01, 648.93004941255623216],
  [-1.5, 0.1, 16.8078014631359345],
  [-1.5, 1, 0.12648781959325442094],
  [-2.5, 1e-6, 399999333334332.43361],
  [-2.5, 0.001, 12628059.477613655905],
  [-2.5, 0.01, 39342.421330201697581],
  [-2.5, 0.1, 107.73076554032768788],
  [-2.5, 1, 0.096556648631275160264],
  [-3.5, 1e-6, 2.8571388571461909254e20],
  [-3.5, 0.001, 9022440449.063899713],
  [-3.5, 0.01, 2817473.1189032794614],
  [-3.5, 0.1, 786.74753931406391292],
  [-3.5, 1, 0.077520797868619188952],
  [-0.5, 1e-6, 1996.4570922978556799],
  [-0.5, 0.001, 59.763880515942196324],
  [-0.5, 0.01, 16.654759630333674212],
  [-0.5, 0.1, 3.4017693366916152574],
  [-0.5, 1, 0.17814771178156069019],
  // Within 0.05 of a pole of Γ(a) after the shift
  [-1.999, 0.001, 495816.22173622802606],
  [-2.001, 0.001, 502212.22802780242898],
];

const rel = (x: number, ref: number) => Math.abs((x - ref) / ref);

describe('GAMMA(s, z) for non-integer s < -1 and small z', () => {
  for (const [s, z, ref] of cases) {
    const name = `Gamma(${s}, ${z}) = ${ref}`;
    test(`${name} (.N())`, () => {
      const v = ce.expr(['Gamma', s, z]).N() as any;
      expect(rel(v.re, ref)).toBeLessThan(TOLERANCE);
    });
    test(`${name} (kernel)`, () => {
      expect(rel(incompleteGammaUpper(s, z), ref)).toBeLessThan(TOLERANCE);
    });
    test(`${name} (evaluate with a float operand)`, () => {
      const v = ce
        .expr(['Gamma', s, z])
        .evaluate({ numericApproximation: true }) as any;
      expect(rel(v.re, ref)).toBeLessThan(TOLERANCE);
    });
    test(`${name} (compiled)`, () => {
      const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
      expect(r.success).toBe(true);
      expect(rel(r.run!({ s, z }) as number, ref)).toBeLessThan(TOLERANCE);
    });
  }

  // −1 < s < −½ with s + 1 ≤ z ≲ 0.01: the Legendre fraction needed more
  // than its iteration cap (NaN at (−0.9999, 0.001)) or lost digits (1.8e-12
  // at (−0.9999, 0.01)). |s| ≤ ½ with z < s + 1: Γ(s) − γ(s, z) cancelled as
  // s → 0 (6 correct digits at s = ±10⁻⁹). References: mpmath `gammainc`
  // (40 digits) at the exact double operands.
  for (const [s, z, ref] of [
    [-0.9999, 0.001, 992.08060892319359656],
    [-0.9999, 0.003, 326.94118900932730884],
    [-0.9999, 0.01, 94.931930919533909047],
    [-0.9999999999, 1e-6, 999985.76042306522382],
    [-0.75, 0.3, 1.3313206439213457207],
    [-0.6, 0.9, 0.21358486612207420543],
    [-1e-9, 0.9, 0.26018393923034158549],
    [-1e-6, 0.1, 1.8229259437100318248],
    [1e-9, 0.6, 0.4543795032232775604],
    [1e-6, 0.3, 0.90567629091561726317],
    [0.3, 1.2, 0.18964967704654715886],
    // A tiny |s|: Γ(s, z) = E₁(z). Γ(s)·Q(s, z) was Infinity at s = 1e-309,
    // where Γ(s) ≈ 1/s overflows.
    [1e-309, 0.5, 0.55977359477616081175],
    [-1e-309, 0.99, 0.22309982579017724023],
    [1e-300, 1e-300, 690.19831223331217232],
    [-1e-300, 0.5, 0.55977359477616081175],
    [1e-20, 0.99, 0.22309982579017724024],
    [-1e-20, 1e-300, 690.19831223331217471],
    // Within 0.05 of a pole of Γ after the shift to −1 < s + n < 0. The
    // complex kernel answered there and was NaN for these orders.
    [
      -86.00000000000747, 0.00025828026131082796,
      4.222244578830108113888993e306,
    ],
    [-35.00000000406394, 4.845221821381921e-7, 2.950893309817006972619293e219],
    [-157.99999832559416, 0.01995847873524276, 2.357665435070730467583563e266],
    [-8.999999276617382, 0.34338853700989597, 1138.68406525965139780709],
    [-1.0005077417878792, 0.003694186837323924, 265.2958312889191747453224],
  ]) {
    test(`Gamma(${s}, ${z}) = ${ref} (kernel and compiled)`, () => {
      expect(rel(incompleteGammaUpper(s, z), ref)).toBeLessThan(TOLERANCE);
      const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
      expect(rel(r.run!({ s, z }) as number, ref)).toBeLessThan(TOLERANCE);
    });
  }

  test('an overflow within 0.05 of a pole after the shift is +Infinity', () => {
    // mpmath: 1.73e323 and 4.6e1201 (the complex kernel answered NaN)
    const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
    for (const [s, z] of [
      [-57.00707326638518, 1.9909707833817464e-6],
      [-212.9944237232914, 2.2248478364088193e-6],
    ]) {
      expect(incompleteGammaUpper(s, z)).toBe(Infinity);
      expect(r.run!({ s, z })).toBe(Infinity);
    }
  });

  test('Gamma(s, +Infinity) is 0 (kernel, compiled and .N())', () => {
    // The continued fraction formed 0·∞: NaN for every order.
    const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
    for (const s of [-1.5, -2, 0, 1e-9, 2.5]) {
      expect(incompleteGammaUpper(s, Infinity)).toBe(0);
      expect(r.run!({ s, z: Infinity })).toBe(0);
      expect(ce.expr(['Gamma', s, 'PositiveInfinity']).N().re).toBe(0);
    }
    expect(incompleteGammaUpper(Infinity, Infinity)).toBeNaN();
  });

  test('a tiny order at the default precision (.N() and evaluate())', () => {
    // The bignum kernel lost about −log₁₀|s| digits and declined, and the
    // machine kernel answered −1.949e289 and 0.8666 (Γ(s) − γ(s, z) at a
    // tiny s). Γ(s, z) = E₁(z) to the working precision there. mpmath at
    // 60 digits for the decimal operands. The shared test engine runs at
    // precision 100, where the subtraction route has enough guard digits.
    const ce = new ComputeEngine();
    for (const [s, z, ref] of [
      [1e-305, 0.01, '4.03792957653811383178668'],
      [-5e-324, 0.5, '0.559773594776160811746795'],
    ] as const) {
      for (const v of [
        ce.expr(['Gamma', s, z]).N(),
        ce.expr(['Gamma', s, z]).evaluate(),
      ]) {
        const big = (v as any).bignumRe;
        expect(big).toBeDefined();
        expect(big.div(ce.bignum(ref)).sub(1).abs().lt(1e-20)).toBe(true);
      }
    }
  });

  test('Gamma(-1.5, 0.001) is 21020.93716712355, not 21020.6917...', () => {
    const v = ce.expr(['Gamma', -1.5, 0.001]).N() as any;
    expect(v.re).toBeCloseTo(21020.937167123548, 6);
  });

  test('compiled Gamma(s, z) keeps its second operand', () => {
    const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
    // Γ(2.5) is 1.329…; Γ(2.5, 1) is 1.1288…
    expect(r.run!({ s: 2.5, z: 1 }) as number).toBeCloseTo(
      1.1288027918891033,
      12
    );
  });

  test('compiled Gamma(s, z) takes the complex kernel for a complex operand', () => {
    const r = compile(ce.expr(['Gamma', 's', ['Complex', -0.5, 0.25]]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    const v = r.run!({ s: -1.5 }) as any;
    expect(v.re).toBeCloseTo(0.521238022262048, 10);
    expect(v.im).toBeCloseTo(3.0631394125454936, 10);
  });

  test('compiled Gamma(s, z) promotes a real z < 0 to the complex kernel', () => {
    const r = compile(ce.expr(['Gamma', 's', 'z']), { fallback: false });
    expect(r.success).toBe(true);
    // Γ(1, z) = e^{−z} is real on the whole real line
    const real = r.run!({ s: 1, z: -1 });
    expect(typeof real).toBe('number');
    expect(real as number).toBeCloseTo(Math.E, 12);
    const v = r.run!({ s: -1.5, z: -0.5 }) as any;
    expect(v.re).toBeCloseTo(2.363271801207355, 10);
    expect(v.im).toBeCloseTo(3.964483508345547, 10);
    const n = ce.expr(['Gamma', -1.5, -0.5]).N();
    expect(n.re).toBeCloseTo(2.363271801207355, 10);
    expect(n.im).toBeCloseTo(3.964483508345547, 10);
  });

  test('the interval target refuses the two-operand Gamma', () => {
    const r = compile(ce.expr(['Gamma', 's', 'z']), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(r.success).toBe(false);
    const one = compile(ce.expr(['Gamma', 's']), {
      to: 'interval-js',
      fallback: false,
    } as never);
    expect(one.success).toBe(true);
  });

  test('the shift is bounded and an overflow is +Infinity', () => {
    // The shift loop overflowed to Infinity − Infinity = NaN
    expect(incompleteGammaUpper(-120.5, 0.001)).toBe(Infinity);
    // A non-finite order and an order past the shift cap return (the shift
    // loop ran forever, or 1e7 times)
    expect(typeof incompleteGammaUpper(-Infinity, 0.5)).toBe('number');
    expect(typeof incompleteGammaUpper(-1e7 - 0.5, 0.5)).toBe('number');
  });

  test('integer and positive orders are unchanged', () => {
    expect(
      rel((ce.expr(['Gamma', -2, 0.001]).N() as any).re, 499003.91543645285562)
    ).toBeLessThan(1e-12);
    expect(
      rel((ce.expr(['Gamma', 2.5, 1]).N() as any).re, 1.1288027918891033)
    ).toBeLessThan(1e-13);
  });
});
