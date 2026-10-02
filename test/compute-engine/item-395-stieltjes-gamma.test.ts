import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BigDecimal } from '../../src/big-decimal';
import {
  STIELTJES_MAX_ORDER,
  bigStieltjesGamma,
  stieltjesGammaReal,
} from '../../src/compute-engine/numerics/stieltjes';
import { ddLn } from '../../src/compute-engine/numerics/double-double';

const ce = new ComputeEngine();

beforeEach(() => {
  ce.precision = 21;
});
const S = 'StieltjesGamma';

const evaluate = (json: any) => ce.box(json).evaluate();
const numeric = (json: any) => ce.box(json).N();

// Values from mpmath's stieltjes(n, a) and Wolfram's StieltjesGamma[n, a].
const doubles: [number, number, number][] = [
  [1, 1.5, 0.0328346803149491],
  [2, 1.5, 0.007958447383887856],
  [3, 0.5, -0.6674242737113807],
];

describe('StieltjesGamma, exact', () => {
  test('γ₀ = EulerGamma', () => {
    expect(evaluate([S, 0]).symbol).toBe('EulerGamma');
    expect(evaluate([S, 0, 1]).symbol).toBe('EulerGamma');
  });

  test('γₙ(1) reduces to γₙ and γₙ stays symbolic', () => {
    expect(evaluate([S, 2, 1]).toString()).toBe('StieltjesGamma(2)');
    expect(evaluate([S, 1]).toString()).toBe('StieltjesGamma(1)');
  });

  test('γ₀(a) = −ψ(a)', () => {
    expect(evaluate([S, 0, 'a']).toString()).toBe('-PolyGamma(0, a)');
    expect(evaluate([S, 0, ['Rational', 1, 2]]).toString()).toBe(
      evaluate(['Negate', ['PolyGamma', 0, ['Rational', 1, 2]]]).toString()
    );
  });

  test('poles at the nonpositive integers', () => {
    expect(evaluate([S, 2, -1]).toString()).toBe('~oo');
    expect(evaluate([S, 0, 0]).toString()).toBe('~oo');
  });

  test('a symbolic or negative order stays unevaluated', () => {
    expect(numeric([S, ['Multiply', 2, 'n']]).toString()).toBe(
      'StieltjesGamma(2n)'
    );
    expect(numeric([S, -1]).toString()).toBe('StieltjesGamma(-1)');
  });
});

describe('StieltjesGamma, numeric', () => {
  for (const [n, a, expected] of doubles) {
    test(`γ${n}(${a}) = ${expected} (float operand, evaluate)`, () => {
      const r = evaluate([S, n, a]);
      expect(r.re).toBeCloseTo(expected, 14);
    });
    test(`γ${n}(${a}) = ${expected} (.N())`, () => {
      expect(numeric([S, n, a]).re).toBeCloseTo(expected, 14);
    });
  }

  test('a float operand gives a float', () => {
    expect(evaluate([S, 1, 1.5]).isExact).toBe(false);
  });

  const digits: [any, string][] = [
    [[S, 1], '-0.0728158454836767248606'],
    [[S, 10], '0.000205332814909064794684'],
    [[S, 2, ['Rational', 1, 2]], '0.968864475220290711422'],
    [[S, 1, ['Rational', 3, 2]], '0.0328346803149491011258'],
  ];
  for (const [json, expected] of digits) {
    test(`${JSON.stringify(json)} = ${expected} (.N(), default precision)`, () => {
      expect(numeric(json).toString()).toBe(expected);
    });
  }

  const requested: [any, number, string][] = [
    [[S, 1], 50, '-0.072815845483676724860586375874901319137736338334338'],
    [
      [S, 2, ['Rational', 1, 2]],
      50,
      '0.96886447522029071142171106232378065418259804476042',
    ],
    [
      [S, 2, ['Rational', 3, 4]],
      40,
      '0.1193766260185842196972365071220126165487',
    ],
    [[S, 1], 30, '-0.0728158454836767248605863758749'],
  ];
  for (const [json, d, expected] of requested) {
    test(`N(${JSON.stringify(json)}, ${d}) = ${expected}`, () => {
      expect(ce.box(['N', json, d]).evaluate().toString()).toBe(expected);
    });
  }

  test('a compound operand that reduces to the literal agrees', () => {
    expect(
      numeric([S, 1, ['Subtract', 3, ['Rational', 3, 2]]]).toString()
    ).toBe(numeric([S, 1, ['Rational', 3, 2]]).toString());
  });

  test('threads over a list of orders', () => {
    const r = evaluate([S, ['List', 1, 2, 3], 0.5]);
    const expected = [
      -1.3534596808049415, 0.9688644752202907, -0.6674242737113807,
    ];
    r.ops!.forEach((x, i) => expect(x.re).toBeCloseTo(expected[i], 13));
  });
});

describe('StieltjesGamma, complex and negative a', () => {
  test('γ₂(1 + i) = 0.17030420146858 + 0.37317719575750i', () => {
    const r = numeric([S, 2, ['Complex', 1, 1]]);
    expect(r.re).toBeCloseTo(0.1703042014685874, 12);
    expect(r.im).toBeCloseTo(0.3731771957574952, 12);
  });

  test('γ₁(−1/2) = 0.0328346803149 − 2π i', () => {
    const r = numeric([S, 1, -0.5]);
    expect(r.re).toBeCloseTo(0.0328346803149491, 12);
    expect(r.im).toBeCloseTo(-2 * Math.PI, 12);
  });

  test('γ₂(−5/2) = 29.829308492668 + 4.709046302542i', () => {
    const r = numeric([S, 2, -2.5]);
    expect(r.re).toBeCloseTo(29.82930849266842, 10);
    expect(r.im).toBeCloseTo(4.709046302541666, 10);
  });

  test('γ₀(1 + i) = −ψ(1 + i)', () => {
    const r = numeric([S, 0, ['Complex', 1, 1]]);
    expect(r.re).toBeCloseTo(-0.09465032062247689, 12);
    expect(r.im).toBeCloseTo(-1.0766740474685808, 12);
  });
});

describe('StieltjesGamma, limits', () => {
  test(`orders past ${STIELTJES_MAX_ORDER} stay unevaluated, even under .N()`, () => {
    expect(numeric([S, STIELTJES_MAX_ORDER + 1]).toString()).toBe(
      `StieltjesGamma(${STIELTJES_MAX_ORDER + 1})`
    );
  });

  test('the cap order itself is answered', () => {
    expect(numeric([S, STIELTJES_MAX_ORDER]).toString()).toBe(
      '0.00355772885557316094791'
    );
  });

  // The kernel returns digits only while its bound holds; otherwise it declines.
  const kernel: [number, bigint, bigint, number, string][] = [
    [5, 1n, 1n, 40, '0.0007933238173010627017533348774444448307'],
    [20, 1n, 1n, 40, '0.0004663435615115594494005948244335505251'],
    [25, 1n, 1n, 40, '-0.001074591952738488824724291987353173089'],
  ];
  for (const [n, p, q, d, expected] of kernel) {
    test(`γ${n}(${p}/${q}) to ${d} digits (certified kernel)`, () => {
      const r = bigStieltjesGamma(n, [p, q], d)!;
      // The listed digits, less the last (a rounded one), agree.
      const digits = (x: string) => x.replace(/^-?0\.0*/, '');
      expect(
        digits(r.toString()).startsWith(digits(expected).slice(0, -1))
      ).toBe(true);
    });
  }

  test('the kernel declines for a ≤ 0, a negative order and past the cap', () => {
    expect(bigStieltjesGamma(1, new BigDecimal(-1), 20)).toBeUndefined();
    expect(bigStieltjesGamma(-1, new BigDecimal(1), 20)).toBeUndefined();
    expect(
      bigStieltjesGamma(STIELTJES_MAX_ORDER + 1, new BigDecimal(1), 20)
    ).toBeUndefined();
  });
});

describe('StieltjesGamma, compiled', () => {
  test('compiles to JavaScript and agrees with evaluate()', () => {
    const run = compile(ce.box([S, 2, 'sg_a']))?.run as (
      scope: Record<string, number>
    ) => number;
    expect(run({ sg_a: 1.5 })).toBeCloseTo(0.007958447383887856, 13);
    expect(run({ sg_a: 0.5 })).toBeCloseTo(0.9688644752202907, 13);
    expect(run({ sg_a: -0.5 })).toBeNaN(); // complex value
    expect(stieltjesGammaReal(STIELTJES_MAX_ORDER + 1, 1)).toBeNaN();
  });

  // mpmath stieltjes(n, a) at 30 digits. The double sum cancels at a high
  // order and a small a: before the fix the compiled γ₃₀ was
  // 0.003557728327971422 (7 correct digits) and γ₃₀(0.5) was
  // −0.0035240594494571897 (6 correct digits).
  const MPMATH: [n: number, a: number, value: number][] = [
    [10, 1, 0.0002053328149090647946837],
    [20, 1, 0.0004663435615115594494006],
    [25, 1, -0.001074591952738488824724],
    [30, 1, 0.003557728855573160947914],
    [10, 0.5, 0.05099765764051385709056],
    [20, 0.5, 0.0008443870718123552938947],
    [30, 0.5, -0.003524062652271524663168],
    [19, 2.5, -0.0005037639807889105729928],
    [30, 2.5, -0.003557620480133505267414],
    [20, 10, -1158771.696781033806946],
    [30, 10, -2510579572.177699686535],
    [10, 0.001, 247382762074.8453587553],
    [19, 0.001, -8859351337761498072.609],
  ];
  test.each(MPMATH)(
    'compiled γ_%p(%p) is good to a double',
    (n, a, expected) => {
      const run = compile(ce.box([S, 'sg_n', 'sg_a']))?.run as (
        scope: Record<string, number>
      ) => number;
      const run1 = compile(ce.box([S, 'sg_n']))?.run as (
        scope: Record<string, number>
      ) => number;
      const actual = run({ sg_n: n, sg_a: a });
      expect(Math.abs(actual - expected)).toBeLessThan(
        2e-15 * Math.abs(expected)
      );
      if (a === 1) expect(run1({ sg_n: n })).toBe(actual);
    }
  );
});

describe('StieltjesGamma digits', () => {
  // mpmath: stieltjes(30) = 0.0035577288555731609479135377489084026108…
  test('γ₃₀ at machine precision is good to a double', () => {
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      expect(numeric([S, 30]).re).toBeCloseTo(0.0035577288555731609, 17);
    } finally {
      ce.precision = saved;
    }
  });
  test('the certified kernel returns only the digits asked for', () => {
    const v = bigStieltjesGamma(30, [1n, 1n], 30)!;
    expect(v.toString()).toBe('0.00355772885557316094791353774891');
  });
});

test('a float a at a pole is ComplexInfinity', () => {
  expect(
    ce
      .function(S, [ce.box(1), ce.parse('-2.0')])
      .evaluate()
      .toString()
  ).toBe('~oo');
});

describe('ddLn, the double-double logarithm of the compiled kernel', () => {
  // mpmath log(x) at 50 digits, as the double nearest it and the double
  // nearest the rest. Below 2⁻¹⁰²³ the scaling factor overflowed (NaN), and
  // near the largest double it was subnormal (the low part was lost).
  const CASES: [number, number, number][] = [
    [2, 0.6931471805599453, 2.3190468138462996e-17],
    [6.001, 1.7919261220073759, -3.6549017351110937e-17],
    [1e-310, -713.8013788281542, -8.592254740270771e-15],
    [1e-320, -736.8272408909739, 3.356216196017685e-14],
    [1.7e308, 709.7268368932282, 3.0936421257994655e-14],
  ];
  test.each(CASES)('ln(%p)', (x, hi, lo) => {
    const [h, l] = ddLn([x, 0]);
    expect(h).toBe(hi);
    expect(Math.abs(l - lo)).toBeLessThan(1e-30 * Math.abs(hi));
  });
});

describe('StieltjesGamma, compiled, at an extreme a', () => {
  // The double-double kernel overflows for an a near 10¹⁵⁴ (a·a in its
  // products) and for a term near 10³⁰⁰; there the double kernel, which does
  // not cancel, gives the value. For a large a, γₙ(a) is
  // −lnⁿ⁺¹(a)/(n+1) + lnⁿ(a)/(2a) to far below a double (mpmath).
  const LARGE: [number, number, number][] = [
    [0, 1e154, -354.59810432108304],
    [1, 1e154, -62869.907794052844],
    [5, 1e154, -331334918046288.21],
    [0, 1e200, -460.51701859880914],
    [1, 1e200, -106037.96220956796],
    [5, 1e200, -1589728117991947.0],
    [0, 1e308, -709.19620864216607],
    [1, 1e308, -251479.63117621137],
    [5, 1e308, -21205434754962446.0],
    // γ₁(a) = ln(a)/a + γ₁(1 + a): ln(10⁻³⁰⁰)/10⁻³⁰⁰ dominates.
    [1, 1e-300, -6.907755278982137e302],
  ];
  test.each(LARGE)('γ_%p(%p)', (n, a, expected) => {
    const actual = stieltjesGammaReal(n, a);
    expect(Math.abs(actual - expected)).toBeLessThan(
      2e-15 * Math.abs(expected)
    );
  });
});
