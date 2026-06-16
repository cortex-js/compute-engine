/**
 * REVIEW.md B23: arbitrary-precision kernels for Erf/Erfc/ErfInv (library/
 * statistics.ts) and Sinc/FresnelS/FresnelC (library/trigonometry.ts), and
 * their `numericApproximation` gating.
 *
 * - In exact mode (`evaluate()`), these functions stay symbolic except for
 *   exact special values (Erf(0)=0, Erf(±∞)=±1, Sinc(0)=1, ...).
 * - `N()` dispatches to a machine kernel (engine at machine precision) or a
 *   BigDecimal kernel (precision > machine), like Gamma/GammaLn/Zeta.
 *
 * Note: `BigDecimal.precision` is a module-global set by the ComputeEngine
 * constructor, so each suite creates its engine in `beforeAll` (creating
 * them all eagerly would leave the global at the last constructor's value).
 *
 * Reference values (60 digits) computed with an independent Python
 * `decimal` implementation (Maclaurin/Taylor series + Newton; Machin π),
 * cross-checked against DLMF/known constants.
 */

import { ComputeEngine } from '../../../src/compute-engine';
import { BigDecimal } from '../../../src/big-decimal';
import {
  erfInv,
  fresnelS,
  fresnelC,
} from '../../../src/compute-engine/numerics/special-functions';

// 60-digit reference values
const REF = {
  'erf(1)': '0.842700792949714869341220635082609259296066997966302908459938',
  'erf(1/2)':
    '0.520499877813046537682746653891964528736451575757963700058806',
  'erf(3)': '0.999977909503001414558627223870417679620152292912600750342761',
  'erfc(2)':
    '0.00467773498104726583793074363274707138910820295993992326164767',
  'erfc(5)': '1.53745979442803485018834348538337889011805031472337993068791e-12',
  'erfc(12)':
    '1.35626116920590421278030615659041757266678223328810492991238e-64',
  'erfc(20)':
    '5.39586561160790092893499916790534560408827267092360528347010e-176',
  'erfinv(1/2)':
    '0.476936276204469873381418353643130559808969749059470644703883',
  'erfinv(9/10)':
    '1.16308715367667408672625426056294759347793255000208165119272',
  'sinc(1)': '0.841470984807896506652502321630298999622563060798371065672752',
  'S(1)': '0.438259147390354766076756696625152637493786572452416567334407',
  'C(1)': '0.779893400376822829474206413652690136630625708136320960103134',
  'S(2)': '0.343415678363698242195300815958068456886541812202524767579269',
  'C(2)': '0.488253406075340754500223503357261037688367154509215382947596',
  // Asymptotic-expansion regime at precision 40 (πx²/2·log10(e) > 60)
  'S(20)': '0.484084535925953892714754244855834716770107372433315064832856',
  'C(20)': '0.499987334972344388187006213697660216425205287110465048581251',
  'S(50)': '0.493633802585938741453268239798802564223684614896114147040667',
  'C(50)': '0.499999189430727967955810163981791906873179670752193354300324',
};

/**
 * Number of correct significant digits of `actual` against the 60-digit
 * reference `ref` (via the relative error, computed in BigDecimal).
 */
function digitsCorrect(actual: string, ref: string): number {
  const saved = BigDecimal.precision;
  BigDecimal.precision = 80;
  try {
    const a = new BigDecimal(actual);
    const r = new BigDecimal(ref);
    if (a.eq(r)) return Infinity;
    const rel = a.sub(r).abs().div(r.abs()).toNumber();
    if (rel === 0) return Infinity;
    return -Math.log10(rel);
  } finally {
    BigDecimal.precision = saved;
  }
}

describe('B23: exact mode (evaluate) stays symbolic', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });

  test('Erf(1/3) stays symbolic', () => {
    const result = ce.expr(['Erf', ['Rational', 1, 3]]).evaluate();
    expect(result.operator).toBe('Erf');
  });

  test('Erfc(1/3), ErfInv(1/3) stay symbolic', () => {
    expect(ce.expr(['Erfc', ['Rational', 1, 3]]).evaluate().operator).toBe(
      'Erfc'
    );
    expect(ce.expr(['ErfInv', ['Rational', 1, 3]]).evaluate().operator).toBe(
      'ErfInv'
    );
  });

  test('Sinc(2), FresnelS(2), FresnelC(2) stay symbolic', () => {
    expect(ce.expr(['Sinc', 2]).evaluate().operator).toBe('Sinc');
    expect(ce.expr(['FresnelS', 2]).evaluate().operator).toBe('FresnelS');
    expect(ce.expr(['FresnelC', 2]).evaluate().operator).toBe('FresnelC');
  });

  test('N() still computes a numeric value', () => {
    expect(ce.expr(['Erf', ['Rational', 1, 3]]).N().re).toBeCloseTo(
      0.3626481117660629,
      14
    );
  });
});

describe('B23: exact special values still fold in evaluate()', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });
  const ev = (expr: any) => ce.expr(expr).evaluate();

  test('Erf: 0 → 0, ±∞ → ±1', () => {
    expect(ev(['Erf', 0]).isSame(0)).toBe(true);
    expect(ev(['Erf', 'PositiveInfinity']).isSame(1)).toBe(true);
    expect(ev(['Erf', 'NegativeInfinity']).isSame(-1)).toBe(true);
  });

  test('Erfc: 0 → 1, +∞ → 0, −∞ → 2', () => {
    expect(ev(['Erfc', 0]).isSame(1)).toBe(true);
    expect(ev(['Erfc', 'PositiveInfinity']).isSame(0)).toBe(true);
    expect(ev(['Erfc', 'NegativeInfinity']).isSame(2)).toBe(true);
  });

  test('ErfInv: 0 → 0, ±1 → ±∞, outside [−1,1] → NaN', () => {
    expect(ev(['ErfInv', 0]).isSame(0)).toBe(true);
    const plus = ev(['ErfInv', 1]);
    expect(plus.isInfinity).toBe(true);
    expect(plus.isPositive).toBe(true);
    const minus = ev(['ErfInv', -1]);
    expect(minus.isInfinity).toBe(true);
    expect(minus.isNegative).toBe(true);
    expect(ev(['ErfInv', 2]).isNaN).toBe(true);
  });

  test('Sinc: 0 → 1, ±∞ → 0', () => {
    expect(ev(['Sinc', 0]).isSame(1)).toBe(true);
    expect(ev(['Sinc', 'PositiveInfinity']).isSame(0)).toBe(true);
  });

  test('FresnelS/FresnelC: 0 → 0, ±∞ → ±1/2', () => {
    expect(ev(['FresnelS', 0]).isSame(0)).toBe(true);
    expect(ev(['FresnelC', 0]).isSame(0)).toBe(true);
    expect(ev(['FresnelS', 'PositiveInfinity']).isSame(ce.Half)).toBe(true);
    expect(ev(['FresnelC', 'NegativeInfinity']).isSame(ce.Half.neg())).toBe(
      true
    );
  });
});

describe('B23: bignum kernels at precision 40 (≥ 35 digits)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 40;
  });

  const cases: [unknown, string][] = [
    [['Erf', 1], REF['erf(1)']],
    [['Erf', ['Rational', 1, 2]], REF['erf(1/2)']],
    [['Erf', 3], REF['erf(3)']],
    [['Erfc', 2], REF['erfc(2)']],
    [['Erfc', 5], REF['erfc(5)']],
    // 1 − erf would lose ~63 digits here: exercises the raised working
    // precision (x² log10 e ≤ p+10) ...
    [['Erfc', 12], REF['erfc(12)']],
    // ... and the asymptotic series (x² log10 e > p+10)
    [['Erfc', 20], REF['erfc(20)']],
    [['ErfInv', ['Rational', 1, 2]], REF['erfinv(1/2)']],
    [['ErfInv', ['Rational', 9, 10]], REF['erfinv(9/10)']],
    [['Sinc', 1], REF['sinc(1)']],
    [['FresnelS', 1], REF['S(1)']],
    [['FresnelC', 1], REF['C(1)']],
    [['FresnelS', 2], REF['S(2)']],
    [['FresnelC', 2], REF['C(2)']],
    // Asymptotic-expansion regime (Taylor would lose >60 digits)
    [['FresnelS', 20], REF['S(20)']],
    [['FresnelC', 20], REF['C(20)']],
    [['FresnelS', 50], REF['S(50)']],
    [['FresnelC', 50], REF['C(50)']],
  ];

  test.each(cases)('%j matches reference to ≥ 35 digits', (expr, ref) => {
    const result = ce.expr(expr as any).N();
    expect(digitsCorrect(result.toString(), ref)).toBeGreaterThanOrEqual(35);
  });

  test('Erf saturates to ±1 when erfc < 10^−(p+10)', () => {
    // At precision 40, x = 15: erfc(15) ≈ 7.2e-100 < 10^-50
    expect(ce.expr(['Erf', 15]).N().isSame(1)).toBe(true);
    expect(ce.expr(['Erf', -15]).N().isSame(-1)).toBe(true);
  });

  test('odd symmetry at precision 40', () => {
    const erf1 = ce.expr(['Erf', 1]).N();
    const erfm1 = ce.expr(['Erf', -1]).N();
    expect(erf1.add(erfm1).isSame(0)).toBe(true);

    const s2 = ce.expr(['FresnelS', 2]).N();
    const sm2 = ce.expr(['FresnelS', -2]).N();
    expect(s2.add(sm2).isSame(0)).toBe(true);

    const ei = ce.expr(['ErfInv', ['Rational', 1, 2]]).N();
    const eim = ce.expr(['ErfInv', ['Rational', -1, 2]]).N();
    expect(ei.add(eim).isSame(0)).toBe(true);
  });

  test('ErfInv close to 1 round-trips through Erf', () => {
    // 1 − 10^−30: the bignum seed branch (1−x² underflows in double)
    const x = ce.parse('1 - 10^{-30}');
    const y = ce.expr(['ErfInv', x]).N();
    expect(y.re).toBeCloseTo(8.14861622316986, 10);
    const roundtrip = ce.expr(['Erf', y]).N();
    expect(
      digitsCorrect(roundtrip.toString(), '0.999999999999999999999999999999')
    ).toBeGreaterThanOrEqual(28);
  });
});

describe('B23: bignum kernels at precision 100', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 100;
  });

  // Switchover boundaries at p=100: erfc 1−erf ↔ asymptotic at
  // x ≈ √((p+10)/log10 e) ≈ 15.9; Fresnel Taylor ↔ asymptotic at
  // x ≈ √((p+20)/(π/2·log10 e)) ≈ 13.3
  const cases: [unknown, string][] = [
    [
      ['Erf', 1],
      '0.842700792949714869341220635082609259296066997966302908459937897834717254096010841261983325348144888',
    ],
    [
      ['Erfc', 15],
      '7.21299417245120666656506655869292710993409092982538324046734199659997114488046636037232202383065491e-100',
    ],
    [
      ['Erfc', 16],
      '2.32848575157153069336487285457344259753439694809494802151649509557369523737790080619238332625392256e-113',
    ],
    [
      ['FresnelS', 13],
      '0.499953884481912561407265355682706391125112789334750884367854782701866938146423121545075474325268681',
    ],
    [
      ['FresnelS', 14],
      '0.477263759441820295039423802097795229079782943928786559115286400052128719852542416469560126225502307',
    ],
    [
      ['FresnelC', 13],
      '0.524485115304358406398379181702525002050660873481719420268469008366717985208472535008261348558228383',
    ],
    [
      ['FresnelC', 14],
      '0.499963076830966100451953780375776241675116048630721371167529208964947115725519276735096980801778554',
    ],
    [
      ['ErfInv', ['Rational', 1, 2]],
      '0.476936276204469873381418353643130559808969749059470644703882695919383447774646733488695915869989010',
    ],
  ];

  test.each(cases)('%j matches reference to ≥ 95 digits', (expr, ref) => {
    const result = ce.expr(expr as any).N();
    expect(digitsCorrect(result.toString(), ref)).toBeGreaterThanOrEqual(95);
  });
});

describe('B23: machine-precision engine still uses machine kernels', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.precision = 'machine';
  });

  test('~15 digits at machine precision', () => {
    expect(ce.expr(['Erf', 1]).N().re).toBeCloseTo(0.8427007929497149, 15);
    expect(ce.expr(['Erfc', 2]).N().re).toBeCloseTo(0.004677734981047266, 15);
    expect(ce.expr(['ErfInv', 0.5]).N().re).toBeCloseTo(
      0.4769362762044699,
      15
    );
    expect(ce.expr(['Sinc', 1]).N().re).toBeCloseTo(0.8414709848078965, 15);
    expect(ce.expr(['FresnelS', 1]).N().re).toBeCloseTo(
      0.43825914739035477,
      14
    );
    expect(ce.expr(['FresnelC', 1]).N().re).toBeCloseTo(
      0.7798934003768228,
      14
    );
  });
});

describe('B23: complex arguments stay symbolic (no complex kernel)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });

  // Previously Erf(1+i) silently evaluated erf(Re z) = erf(1), which was
  // incorrect. There is no complex kernel, so the expression now stays
  // symbolic.
  test('Erf(1+i), Sinc(i), FresnelS(i) stay symbolic under N()', () => {
    expect(ce.expr(['Erf', ['Complex', 1, 1]]).N().operator).toBe('Erf');
    expect(ce.expr(['Sinc', ['Complex', 0, 1]]).N().operator).toBe('Sinc');
    expect(ce.expr(['FresnelS', ['Complex', 0, 1]]).N().operator).toBe(
      'FresnelS'
    );
  });
});

describe('B23/G1: machine erfInv is full double precision', () => {
  // The previous 6-term Maclaurin series was only ~4-digit accurate at
  // x = 0.5 and diverged for |x| → 1
  test('erfInv at machine precision', () => {
    expect(erfInv(0.5)).toBeCloseTo(0.47693627620446987, 15);
    expect(erfInv(0.9)).toBeCloseTo(1.1630871536766741, 15);
    // erfInv is ill-conditioned near 1 (dy/dx = (√π/2)e^{y²} ≈ 5e4 at
    // x=0.99), so ~13-14 digits is the best a double input can deliver
    expect(erfInv(0.99)).toBeCloseTo(1.8213863677184497, 13);
    expect(erfInv(-0.5)).toBeCloseTo(-0.47693627620446987, 15);
    expect(erfInv(0)).toBe(0);
    expect(erfInv(1)).toBe(Infinity);
    expect(erfInv(-1)).toBe(-Infinity);
    expect(erfInv(1.5)).toBeNaN();
  });
});

describe('B23: machine Fresnel asymptotic cutoff (36 → 36974)', () => {
  // With the previous cutoff of 36, S(50) returned exactly 0.5 — an
  // absolute error of ~6.4e-3 (the dropped oscillating term ~1/(πx))
  test('fresnelS/fresnelC at x=50 keep the oscillating term', () => {
    expect(fresnelS(50)).toBeCloseTo(0.49363380258593874, 12);
    expect(fresnelC(50)).toBeCloseTo(0.49999918943072797, 12);
  });

  test('beyond the cutoff S, C → ±0.5', () => {
    expect(fresnelS(40000)).toBe(0.5);
    expect(fresnelC(-40000)).toBe(-0.5);
  });
});
