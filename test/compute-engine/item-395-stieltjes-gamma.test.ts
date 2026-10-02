import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BigDecimal } from '../../src/big-decimal';
import {
  STIELTJES_MAX_ORDER,
  bigStieltjesGamma,
  stieltjesGammaReal,
} from '../../src/compute-engine/numerics/stieltjes';

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
