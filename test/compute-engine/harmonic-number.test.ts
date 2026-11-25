import { ComputeEngine } from '../../src/compute-engine';

//
// `HarmonicNumber(n)` and `HarmonicNumber(n, r)` in the interpreter: the
// exact sum of a large integer n (CE-1555) and the series near n = 0
// (CE-1559). Reference values are mpmath's, `psi(0, n + 1) + euler` and
// `zeta(r) - zeta(r, n + 1)` at 400 digits. The times are checked only
// under `CE_PERF=1`; the work of the series is checked by its steps.
//

const perf = process.env.CE_PERF === '1';

const H = (ce: ComputeEngine, ...ops: (number | string)[]) =>
  ce.function(
    'HarmonicNumber',
    ops.map((x) => ce.number(x))
  );

/** The relative difference of `value` and the decimal string `expected`. */
function relativeError(value: string, expected: string): number {
  const e = Number(expected);
  return Math.abs(Number(value) - e) / Math.abs(e);
}

/** The relative difference of `value` and `expected`, at `ce.precision`. */
function bigRelativeError(
  ce: ComputeEngine,
  value: ReturnType<ComputeEngine['number']>,
  expected: string
): number {
  const e = ce.number(expected);
  return Math.abs(value.sub(e).div(e).N().re);
}

describe('HarmonicNumber OF A LARGE INTEGER (CE-1555)', () => {
  const ce = new ComputeEngine();

  test('an order of 0 is n, exact and immediate', () => {
    const start = Date.now();
    const v = H(ce, 1e6, 0).N();
    if (perf) expect(Date.now() - start).toBeLessThan(500);
    expect(v.json).toBe(1000000);
    expect(H(ce, 1e6, 0).evaluate().isExact).toBe(true);
  });

  test('a large n with a small order is exact within the budget, or numeric', () => {
    for (const [n, r, value] of [
      [30000, 1, 10.886184992119898],
      [20000, 2, 1.6448840680982056],
      [5000, 10, 1.000994575127818],
      [1000, 50, 1],
      [1e6, 1, 14.392726722865723],
    ]) {
      const start = Date.now();
      const v = H(ce, n, r).N();
      if (perf) expect(Date.now() - start).toBeLessThan(3000);
      expect(v.re).toBeCloseTo(value, 12);
    }
  });

  test('past the budget the exact form stays symbolic', () => {
    for (const [n, r] of [
      [20000, 2],
      [5000, 10],
      [1000, 50],
    ]) {
      const start = Date.now();
      expect(H(ce, n, r).evaluate().operator).toBe('HarmonicNumber');
      if (perf) expect(Date.now() - start).toBeLessThan(500);
    }
    // Within the budget, the exact rational.
    expect(H(ce, 2000, 10).evaluate().operator).toBe('Rational');
  });

  test('a small n with a large order is exact', () => {
    expect(H(ce, 1, 100000).evaluate().json).toBe(1);
    const v = H(ce, 2, 30000).evaluate();
    expect(v.operator).toBe('Rational');
    expect(v.N().re).toBe(1);
  });
});

describe('HarmonicNumber NEAR 0 (CE-1559)', () => {
  // [n, r, value]; r = '' is the one-operand form.
  const cases: [string, string, string][] = [
    ['1e-30', '', '1.6449340668482264364724151666448231323157903069213987e-30'],
    [
      '1e-30',
      '2',
      '2.404113806319188570799476323019653011828839170106449752e-30',
    ],
    ['1e-30', '-1', '5.000000000000000000000000000005e-31'],
    [
      '1e-30',
      '0.5',
      '1.306187674342744171674283783961532757563931232257622915e-30',
    ],
    [
      '1e-10',
      '',
      '1.644934066728020746167278970442125827227923303475568483e-10',
    ],
    ['0.05', '', '0.0793706736016624895436328372156106627759425578580506155'],
    [
      '-0.05',
      '',
      '-0.08539395130379247555551694447246176886169644485559823244',
    ],
    ['0.05', '3', '0.1479778921868776924780228782643550950233962509792009949'],
    ['0.09', '50', '0.9865514611167736410625898541173227527471742841611841928'],
    [
      '-0.09',
      '2.5',
      '-0.2964735361582417071301285160323265471311994389863723573',
    ],
    ['0.05', '-4.5', '-0.0011426881472433749627225373742517249918158273331919'],
    // An order r ≤ −5 (the series ends at j = 1 − r for an integer r).
    [
      '1e-30',
      '-5',
      '-8.333333333333333333333333333333333333333333333333333333e-62',
    ],
    [
      '1e-30',
      '-5.5',
      '1.700418085968708614653341209816050543877817533256606807e-32',
    ],
    [
      '1e-30',
      '-6',
      '2.380952380952380952380952380952380952380952380952380952e-32',
    ],
    [
      '1e-30',
      '-10',
      '7.575757575757575757575757575757575757575757575757575758e-32',
    ],
    ['0.07', '-30', '40766055.07609740926575370850433241247357140740200140864'],
    [
      '0.0999',
      '-5.5',
      '0.001056482110256415847561720559343129155836208358316020173',
    ],
    [
      '-0.07',
      '-2.5',
      '-0.002704010174456282945305882890042212447906866426366683916',
    ],
    // Near the pole of ζ(1 + r), which the coefficient r cancels.
    ['0.05', '1e-100', '0.05'],
    // Near |n| = 0.1, the continuation at a raised precision.
    [
      '-0.0999',
      '0.3',
      '-0.120814112784026913283261877314173847985333353963297393',
    ],
    ['0.0999', '', '0.1533173852673376866690421769679922961009790140607422591'],
  ];
  const operands = (n: string, r: string) => (r === '' ? [n] : [n, r]);

  test('at machine precision', () => {
    const ce = new ComputeEngine();
    for (const [n, r, expected] of cases) {
      const v = H(ce, ...operands(n, r)).N();
      expect([n, r, relativeError(v.toString(), expected) < 1e-14]).toEqual([
        n,
        r,
        true,
      ]);
    }
  });

  test('at 50 digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    for (const [n, r, expected] of cases) {
      const v = H(ce, ...operands(n, r)).N();
      expect([n, r, bigRelativeError(ce, v, expected) < 1e-48]).toEqual([
        n,
        r,
        true,
      ]);
    }
  });

  test('the series is short at a high precision', () => {
    // One step per term of the series: the series of a |n| near 0.1 at 300
    // digits would take about 300 terms, each a ζ at 300 digits.
    const ce = new ComputeEngine();
    ce.precision = 300;
    for (const ops of [
      ['-0.0999', '0.3'],
      ['0.0999', '1'],
      ['0.0999', '-5.5'],
      ['1e-30', '2'],
    ]) {
      const steps = ce.withStepBudget({ steps: 1_000_000 }, () => {
        expect(H(ce, ...ops).N().isFinite).toBe(true);
        return 1_000_000 - ce.stepsLeft!;
      });
      expect([ops, steps <= 60]).toEqual([ops, true]);
    }
  });

  test('an order of 0 is n', () => {
    const ce = new ComputeEngine();
    expect(H(ce, '0.05', '0').N().re).toBe(0.05);
  });
});

describe('HarmonicNumber NEAR 0 OF A COMPLEX n (CE-1572)', () => {
  // [re(n), im(n), r, re(value), im(value)]; r = '' is the one-operand form.
  // Reference values are mpmath's at 400 digits, `psi(0, n + 1) + euler` and
  // `zeta(r) - zeta(r, n + 1)`, which agree with the series
  // `Σ (−1)^(k+1) C(r + k − 1, k) ζ(r + k) n^k` to 340 digits.
  const cases: [number, number, string, string, string][] = [
    [
      1e-30,
      1e-30,
      '',
      '1.644934066848226436472415e-30',
      '1.644934066848226436472415e-30',
    ],
    [
      0,
      1e-30,
      '',
      '1.202056903159594285399738e-60',
      '1.644934066848226436472415e-30',
    ],
    [
      1e-30,
      1e-30,
      '2',
      '2.404113806319188570799476e-30',
      '2.404113806319188570799476e-30',
    ],
    [
      0,
      1e-30,
      '2',
      '3.246969701133414574548011e-60',
      '2.404113806319188570799476e-30',
    ],
    // An integer r ≤ 0: the polynomial n⁴/4 + n³/2 + n²/4.
    [1e-30, 1e-30, '-3', '-1e-90', '5e-61'],
    [-0.05, 0.0866, '-3', '-0.0007624229999516', '-0.0021433328532'],
    // |n| = 0.0999, in the series, and |n| = 0.1001, past it.
    [
      0.07,
      0.0713,
      '',
      '0.1146784340600116144555783',
      '0.1060242064609686822753704',
    ],
    [
      0.0708,
      0.0708,
      '',
      '0.1157901505889978350388322',
      '0.1051723026765588861563387',
    ],
    [
      0,
      0.0999,
      '',
      '0.01189425376010605505672744',
      '0.1632598577085796161461687',
    ],
    [
      0,
      0.1001,
      '',
      '0.01194151843508526524691951',
      '0.1635824509269772716228322',
    ],
    [
      0.07,
      0.0713,
      '2',
      '0.1663452731873912504302354',
      '0.1418265022318602763240803',
    ],
    [
      0.0708,
      0.0708,
      '2',
      '0.1677359374442305396451055',
      '0.1405669448886427081758387',
    ],
    [-0.0708, 0.0708, '-3', '0.0003297683522304', '-0.002151425088'],
  ];

  for (const precision of [undefined, 50]) {
    test(`at precision ${precision ?? 'default'}`, () => {
      const ce = new ComputeEngine();
      if (precision !== undefined) ce.precision = precision;
      for (const [a, b, r, re, im] of cases) {
        const ops = [ce.number(ce.complex(a, b))];
        if (r !== '') ops.push(ce.number(r));
        const v = ce.function('HarmonicNumber', ops).N();
        const [eRe, eIm] = [Number(re), Number(im)];
        const error = Math.hypot(v.re - eRe, v.im - eIm) / Math.hypot(eRe, eIm);
        // Inside the series each part has its own relative precision. Past
        // it, the machine continuation `ψ(1 + n) + γ` loses about one digit.
        const inside = Math.hypot(a, b) < 0.1;
        const parts = inside
          ? Math.max(
              Math.abs(v.re - eRe) / Math.abs(eRe),
              Math.abs(v.im - eIm) / Math.abs(eIm)
            )
          : 0;
        const tolerance = inside ? 1e-14 : 1e-13;
        expect([a, b, r, error < tolerance, parts < 1e-14]).toEqual([
          a,
          b,
          r,
          true,
          true,
        ]);
      }
    });
  }

  test('the parsed form of the issue', () => {
    const ce = new ComputeEngine();
    const v = ce.function('HarmonicNumber', [ce.parse('10^{-30}(1+i)')]).N();
    expect(v.re).toBeCloseTo(1.6449340668482264e-30, 44);
    expect(v.im).toBeCloseTo(1.6449340668482264e-30, 44);
  });

  type Big = ReturnType<ComputeEngine['bignum']>;
  /** The relative difference of each big-decimal part and its decimal. */
  const partErrors = (
    ce: ComputeEngine,
    v: ReturnType<ComputeEngine['number']>,
    re: string,
    im: string
  ) => {
    const parts = v as unknown as { bignumRe?: Big; bignumIm?: Big };
    return [
      [parts.bignumRe, re],
      [parts.bignumIm, im],
    ].map(([x, e]) => {
      const expected = ce.bignum(e as string);
      return (x as Big).sub(expected).div(expected).abs().toNumber();
    });
  };

  test('above machine precision the series keeps the working digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const n = ce.number({ re: ce.bignum('1e-30'), im: ce.bignum('1e-30') });
    for (const [r, re, im] of [
      [
        '',
        '1.644934066848226436472415166646025189218949901206798438e-30',
        '1.644934066848226436472415166643621075412630712635998961e-30',
      ],
      [
        '2',
        '2.404113806319188570799476323022899981529972584680997764e-30',
        '2.404113806319188570799476323016406042127705755531901741e-30',
      ],
    ]) {
      const ops = r === '' ? [n] : [n, ce.number(r)];
      const v = ce.function('HarmonicNumber', ops).N();
      const errors = partErrors(ce, v, re, im);
      expect([r, errors.every((e) => e < 1e-48)]).toEqual([r, true]);
    }
  });

  test('an integer order r ≤ 0 is the exact polynomial, rounded once', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    const n = ce.number({ re: ce.bignum('0.05'), im: ce.bignum('1e-400') });
    // H(n, 0) = n.
    const zero = ce.function('HarmonicNumber', [n, ce.number(0)]).N();
    expect(partErrors(ce, zero, '0.05', '1e-400')).toEqual([0, 0]);
    // H(n, −3) = n⁴/4 + n³/2 + n²/4.
    const three = ce.function('HarmonicNumber', [n, ce.number(-3)]).N();
    expect(partErrors(ce, three, '0.0006890625', '2.8875e-402')).toEqual([
      0, 0,
    ]);
  });

  test('a part too small for a double ends the series as early as a real n', () => {
    // mpmath, `psi(0, n + 1) + euler` at 900 digits.
    const re = '0.0793706736016624895436328372156106627759425578580506155';
    const im = '1.532357342115119308491478588246367940749614429061652032e-400';
    for (const precision of [undefined, 50, 100]) {
      const ce = new ComputeEngine();
      if (precision !== undefined) ce.precision = precision;
      const n = ce.number({ re: ce.bignum('0.05'), im: ce.bignum('1e-400') });
      const v = ce.function('HarmonicNumber', [n]).N();
      // At precision 100 the series at the working precision is too long:
      // the value is the series at about 17 digits, in big decimals.
      const tolerance = precision === 100 ? 1e-15 : 10 ** (1 - ce.precision);
      const errors = partErrors(ce, v, re, im);
      expect([precision, errors.every((e) => e < tolerance)]).toEqual([
        precision,
        true,
      ]);
    }
  });

  test('a part much smaller than its terms keeps its digits', () => {
    // The terms of the real part are about 2.5e-3; the real part is about
    // 7.8e-24 (mpmath, `psi(0, n + 1) + euler` at 80 digits).
    const re = '-7.81885370830619498294758965431e-24';
    const im = '0.0823312479521255584082427859221';
    for (const precision of [21, 50]) {
      const ce = new ComputeEngine();
      ce.precision = precision;
      const n = ce.number({
        re: ce.bignum('-0.00182955182601939081797'),
        im: ce.bignum('0.05'),
      });
      const v = ce.function('HarmonicNumber', [n]).N();
      // At precision 50 the series at the working precision is too long:
      // the value is the series at machine precision.
      const errors =
        precision === 21
          ? partErrors(ce, v, re, im)
          : [Math.abs(v.re / Number(re) - 1), Math.abs(v.im / Number(im) - 1)];
      const tolerance = precision === 21 ? 1e-20 : 1e-15;
      expect([precision, errors.every((e) => e < tolerance)]).toEqual([
        precision,
        true,
      ]);
    }
  });
});

describe('HarmonicNumber NEAR 0 OF A COMPLEX ORDER (CE-1584)', () => {
  // [Re n, Im n, Re r, Im r, Re H, Im H], with mpmath's
  // `zeta(r) - zeta(r, n + 1)` at 60 digits. The series answers the first
  // ones; the continuation answers a large |r|·|n|, where the series is too
  // long, and a part 300 times smaller than the other, where the error
  // estimate of the series is too large.
  const cases: [number, number, number, number, number, number][] = [
    [1e-30, 1e-30, 2, 1, 1.5520870099659354e-30, 3.1733523581160526e-30],
    [1e-30, 0, 2, 1, 2.362719684040994e-30, 8.106326740750586e-31],
    [0.05, 0.03, 2, 1, 0.0960436242771228, 0.0995943959175323],
    [-0.06, 0.02, 0.5, 3, -0.08046400397649313, -0.1302213355460278],
    [0.09, 0, 1.5, -2, 0.1597490165061994, -0.11173335816194091],
    [0.01, -0.07, 3, 10, 0.5480836517812276, -0.06093664727745727],
    [1e-20, 0, 2, 0.01, 2.4041096442539664e-20, 8.058048981654098e-23],
    [0.05, 0, 2, 0.01, 0.11257661646392919, 0.0003455210998128868],
    [0.05, 0, 2, 120, 0.3408411779984618, -0.7752897853693601],
    [0.03, 0, -100, 1, 2.0369750610719384e77, 5.91945825426179e76],
  ];

  for (const precision of [undefined, 50]) {
    test(`each part keeps its digits at precision ${precision ?? 'default'}`, () => {
      const ce = new ComputeEngine();
      if (precision !== undefined) ce.precision = precision;
      for (const [a, b, c, d, re, im] of cases) {
        const v = ce
          .function('HarmonicNumber', [
            ce.number(ce.complex(a, b)),
            ce.number(ce.complex(c, d)),
          ])
          .N();
        const errors = [
          Math.abs(v.re - re) / Math.abs(re),
          Math.abs(v.im - im) / Math.abs(im),
        ];
        expect([a, b, c, d, errors.every((e) => e < 1e-12)]).toEqual([
          a,
          b,
          c,
          d,
          true,
        ]);
      }
    });
  }

  test('a part much smaller than its terms stays unevaluated', () => {
    const ce = new ComputeEngine();
    // The imaginary part, about 5e-12, is 8 digits below the real part.
    const v = ce
      .function('HarmonicNumber', [
        ce.number(0.05),
        ce.number(ce.complex(-3, 1e-9)),
      ])
      .N();
    expect(v.operator).toBe('HarmonicNumber');
  });
});

describe('HarmonicNumber OF A COMPLEX n OR r ABOVE MACHINE PRECISION (CE-1585)', () => {
  // The kernels of the continuation are machine kernels: at precision 50 the
  // value is the machine value, not a sum that shows the digits of `γ` or
  // `ζ(r)` past the 16th.
  const cases: [
    string,
    (ce: ComputeEngine) => ReturnType<ComputeEngine['function']>,
  ][] = [
    [
      'H(-2 + 1e-20i)',
      (ce) => ce.function('HarmonicNumber', [ce.number(ce.complex(-2, 1e-20))]),
    ],
    [
      'H(1 + i)',
      (ce) => ce.function('HarmonicNumber', [ce.number(ce.complex(1, 1))]),
    ],
    [
      'H(1 + i, 2)',
      (ce) =>
        ce.function('HarmonicNumber', [
          ce.number(ce.complex(1, 1)),
          ce.number(2),
        ]),
    ],
    [
      'H(2.5, 1 + i)',
      (ce) =>
        ce.function('HarmonicNumber', [
          ce.number(2.5),
          ce.number(ce.complex(1, 1)),
        ]),
    ],
  ];
  for (const [name, make] of cases) {
    test(name, () => {
      const machine = make(new ComputeEngine()).N();
      const ce = new ComputeEngine();
      ce.precision = 50;
      const v = make(ce).N();
      expect(v.json).toEqual(machine.json);
      expect(v.json).toMatchObject([
        'Complex',
        expect.any(Number),
        expect.any(Number),
      ]);
    });
  }

  test('a real n and r keep the working digits', () => {
    const ce = new ComputeEngine();
    ce.precision = 50;
    // mpmath: psi(0, 3.5) + euler.
    const v = H(ce, 2.5).N();
    expect(
      bigRelativeError(
        ce,
        v,
        '1.6803723055467760478322024237503135305156663979462'
      )
    ).toBeLessThan(1e-48);
  });
});
