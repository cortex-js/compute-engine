import { engine as ce } from '../utils';
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
  // Within 0.05 of a pole of Γ(a) after the shift: the complex kernel answers
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

  test('integer and positive orders are unchanged', () => {
    expect(
      rel((ce.expr(['Gamma', -2, 0.001]).N() as any).re, 499003.91543645285562)
    ).toBeLessThan(1e-12);
    expect(
      rel((ce.expr(['Gamma', 2.5, 1]).N() as any).re, 1.1288027918891033)
    ).toBeLessThan(1e-13);
  });
});
