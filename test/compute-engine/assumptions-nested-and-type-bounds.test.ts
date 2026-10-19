import { ComputeEngine } from '../../src/compute-engine';

// Two families of facts must combine when a symbol is compared with a number
// or asked for its sign:
//
// 1. Assumptions made in nested scopes. The facts of every scope in force are
//    combined, and the strongest one wins: `b ≥ 0` in a scope and `b > 0` in
//    a nested scope give `b > 0`, in whichever order the two facts are read.
//    Popping the nested scope removes its fact.
// 2. The range of a declared type (`integer<0..>`, `real<-1..2>`). The four
//    comparison methods (`isGreater`, `isGreaterEqual`, `isLess`,
//    `isLessEqual`) and the comparison operators read the same facts as the
//    sign getters (`isPositive`, `isNonNegative`…).

describe('NESTED ASSUMPTIONS', () => {
  test('an inner strict fact is not hidden by an outer weak fact', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'integer');
    const b = ce.symbol('b');
    ce.pushScope();
    expect(ce.assume(ce.parse('b \\ge 0'))).toBe('ok');
    expect(b.isGreater(0)).toBeUndefined();
    expect(b.isPositive).toBeUndefined();
    expect(b.isGreaterEqual(0)).toBe(true);

    ce.pushScope();
    expect(ce.assume(ce.parse('b > 0'))).toBe('ok');
    expect(b.isGreater(0)).toBe(true);
    expect(b.isPositive).toBe(true);
    expect(b.isLessEqual(0)).toBe(false);
    expect(ce.box(['Greater', 'b', 0]).evaluate().symbol).toBe('True');

    // Popping the inner scope removes the inner fact
    ce.popScope();
    expect(b.isGreater(0)).toBeUndefined();
    expect(b.isPositive).toBeUndefined();
    expect(b.isGreaterEqual(0)).toBe(true);

    ce.popScope();
    expect(b.isGreaterEqual(0)).toBeUndefined();
    expect(b.isNonNegative).toBeUndefined();
  });

  test('the order of a weak and a strict fact in one scope does not matter', () => {
    for (const facts of [
      ['b \\ge 0', 'b > 0'],
      ['b > 0', 'b \\ge 0'],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('b', 'integer');
      for (const f of facts) ce.assume(ce.parse(f));
      const b = ce.symbol('b');
      expect(b.isGreater(0)).toBe(true);
      expect(b.isPositive).toBe(true);
    }
    for (const facts of [
      ['b \\le 2', 'b < 2'],
      ['b < 2', 'b \\le 2'],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('b', 'real');
      for (const f of facts) ce.assume(ce.parse(f));
      expect(ce.symbol('b').isLess(2)).toBe(true);
    }
  });

  test('a ranged type and an inner assumption combine', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'integer<0..>');
    const c = ce.symbol('c');
    ce.pushScope();
    ce.assume(ce.parse('c > 0'));
    expect(c.isGreater(0)).toBe(true);
    expect(c.isPositive).toBe(true);
    ce.popScope();
    expect(c.isGreater(0)).toBeUndefined();
    expect(c.isPositive).toBeUndefined();
    expect(c.isGreaterEqual(0)).toBe(true);
  });

  test('a weak assumption does not hide the sign of a ranged type', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'integer<1..>');
    ce.assume(ce.parse('p \\ge 0'));
    const p = ce.symbol('p');
    expect(p.sgn).toBe('positive');
    expect(p.isPositive).toBe(true);
    expect(p.isGreater(0)).toBe(true);
    expect(p.isGreaterEqual(1)).toBe(true);
  });

  test('two weak facts in nested scopes give zero', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'integer');
    const b = ce.symbol('b');
    ce.pushScope();
    ce.assume(ce.parse('b \\ge 0'));
    ce.pushScope();
    ce.assume(ce.parse('b \\le 0'));
    expect(b.sgn).toBe('zero');
    expect(b.isGreater(0)).toBe(false);
    expect(b.isLess(0)).toBe(false);
    expect(b.isGreaterEqual(0)).toBe(true);
    expect(b.isLessEqual(0)).toBe(true);
    ce.popScope();
    expect(b.sgn).toBe('non-negative');
    expect(b.isLessEqual(0)).toBeUndefined();
  });

  test('a contradiction with an outer fact is detected', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'integer');
    ce.pushScope();
    ce.assume(ce.parse('b \\ge 0'));
    ce.pushScope();
    expect(ce.assume(ce.parse('b < 0'))).toBe('contradiction');
    expect(ce.symbol('b').isGreaterEqual(0)).toBe(true);
    expect(ce.symbol('b').isLess(0)).toBe(false);
  });
});

describe('COMPARISONS READ THE TYPE BOUNDS', () => {
  // For each declared type, the verdicts of `p > k`, `p ≥ k`, `p < k` and
  // `p ≤ k` for each `k`. `undefined` means "not decided".
  const T = true;
  const F = false;
  const U = undefined;
  const cases: [
    string,
    [
      number,
      boolean | undefined,
      boolean | undefined,
      boolean | undefined,
      boolean | undefined,
    ][],
  ][] = [
    [
      'integer<0..>',
      [
        [-1, T, T, F, F],
        [0, U, T, F, U],
        [1, U, U, U, U],
      ],
    ],
    [
      'integer<1..>',
      [
        [0, T, T, F, F],
        [1, U, T, F, U],
        [2, U, U, U, U],
      ],
    ],
    [
      'real<-1..2>',
      [
        [-2, T, T, F, F],
        [-1, U, T, F, U],
        [0, U, U, U, U],
        [2, F, U, U, T],
        [3, F, F, T, T],
      ],
    ],
    [
      'integer<..-1>',
      [
        [-2, U, U, U, U],
        [-1, F, U, U, T],
        [0, F, F, T, T],
      ],
    ],
  ];

  for (const [type, rows] of cases) {
    for (const [k, gt, ge, lt, le] of rows) {
      test(`p: ${type}, compared with ${k}`, () => {
        const ce = new ComputeEngine();
        ce.declare('p', type);
        const p = ce.symbol('p');
        expect([
          p.isGreater(k),
          p.isGreaterEqual(k),
          p.isLess(k),
          p.isLessEqual(k),
        ]).toEqual([gt, ge, lt, le]);

        // The same verdicts with a boxed number
        const kx = ce.number(k);
        expect([
          p.isGreater(kx),
          p.isGreaterEqual(kx),
          p.isLess(kx),
          p.isLessEqual(kx),
        ]).toEqual([gt, ge, lt, le]);

        // The comparison operators agree, on the box route and the parse route
        const verdict = (e: ReturnType<typeof ce.box>) => {
          const v = e.evaluate();
          return v.symbol === 'True' ? T : v.symbol === 'False' ? F : U;
        };
        expect([
          verdict(ce.box(['Greater', 'p', k])),
          verdict(ce.box(['GreaterEqual', 'p', k])),
          verdict(ce.box(['Less', 'p', k])),
          verdict(ce.box(['LessEqual', 'p', k])),
        ]).toEqual([gt, ge, lt, le]);
        expect([
          verdict(ce.parse(`p > ${k}`)),
          verdict(ce.parse(`p \\ge ${k}`)),
          verdict(ce.parse(`p < ${k}`)),
          verdict(ce.parse(`p \\le ${k}`)),
        ]).toEqual([gt, ge, lt, le]);
      });
    }
  }

  test('the comparison methods agree with the sign getters', () => {
    const ce = new ComputeEngine();
    const types = [
      'integer<0..>',
      'integer<1..>',
      'real<-1..2>',
      'integer<..-1>',
      'real<0..> & !0',
    ];
    for (const [i, type] of types.entries()) {
      ce.declare(`s_${i}`, type);
      const s = ce.symbol(`s_${i}`);
      expect([type, s.isGreater(0)]).toEqual([type, s.isPositive]);
      expect([type, s.isGreaterEqual(0)]).toEqual([type, s.isNonNegative]);
      expect([type, s.isLess(0)]).toEqual([type, s.isNegative]);
      expect([type, s.isLessEqual(0)]).toEqual([type, s.isNonPositive]);
    }
  });

  test('a decimal type bound is the decimal it spells', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real<0.1..>');
    const t = ce.symbol('t');
    expect(t.isGreaterEqual(ce.parse('\\frac{1}{10}'))).toBe(true);
    expect(t.isGreater(ce.parse('\\frac{1}{10}'))).toBeUndefined();
    expect(t.isGreater(ce.parse('\\frac{1}{11}'))).toBe(true);
  });

  test('two symbols are ordered by their type bounds', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'integer<1..>');
    ce.declare('v', 'integer<..0>');
    expect(ce.symbol('u').isGreater(ce.symbol('v'))).toBe(true);
    expect(ce.box(['Less', 'v', 'u']).evaluate().symbol).toBe('True');
  });

  test('the value of a symbol still gives a strict order', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'real<0..>', value: 5 });
    ce.declare('z', { type: 'real<0..>', value: 0 });
    ce.declare('w', { type: 'real<0..>', value: 0 });
    const x = ce.symbol('x');
    const z = ce.symbol('z');
    expect(x.isGreater(0)).toBe(true);
    expect(x.isLess(6)).toBe(true);
    expect(z.isGreater(0)).toBe(false);
    expect(z.isGreaterEqual(0)).toBe(true);
    expect(ce.box(['Less', 'z', 'w']).evaluate().symbol).toBe('False');
    expect(ce.box(['LessEqual', 'z', 'w']).evaluate().symbol).toBe('True');
  });

  test('bounds that contradict each other do not invent a verdict', () => {
    // The assumption `q < -1` is about the outer `q`. The nested scope
    // declares a new `q` of type `integer<0..>`. The assumptions are read
    // by name, so the inner `q` sees both `q < -1` and `q ≥ 0`. No value
    // satisfies both: the inner `q` must not be called negative.
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('q < -1'))).toBe('ok');
    ce.pushScope();
    ce.declare('q', 'integer<0..>');
    const q = ce.symbol('q');
    expect(q.isNegative).not.toBe(true);
    expect(q.isLess(0)).not.toBe(true);
    expect(q.isLess(-1)).not.toBe(true);
    expect(q.isGreaterEqual(0)).not.toBe(false);
    ce.popScope();
  });

  test('an assumption that contradicts the type bound is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'integer<0..>');
    expect(ce.assume(ce.parse('q < -1'))).toBe('contradiction');
    expect(ce.symbol('q').isGreaterEqual(0)).toBe(true);
  });
});

describe('A VALUE WITHIN THE TOLERANCE IS NOT ORDERED STRICTLY', () => {
  // Two values that differ by less than the engine tolerance are equal for
  // `isEqual`, so `isGreater`/`isLess` must not order them strictly. The
  // sign of such a value (`positive` for `1e-12`) must not override the
  // tolerance test. An exact value is compared exactly, with no tolerance.
  const verdicts = (ce: ComputeEngine, v: ReturnType<ComputeEngine['box']>) => {
    const z = ce.Zero;
    return {
      gt: v.isGreater(0),
      ge: v.isGreaterEqual(0),
      lt: v.isLess(0),
      le: v.isLessEqual(0),
      eq: v.isEqual(0),
      zeroLess: z.isLess(v),
      zeroGreater: z.isGreater(v),
      zeroEq: z.isEqual(v),
    };
  };
  const tie = {
    gt: false,
    ge: true,
    lt: false,
    le: true,
    eq: true,
    zeroLess: false,
    zeroGreater: false,
    zeroEq: true,
  };

  test('a symbol with a tiny float value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1e-12);
    ce.assign('y', -1e-12);
    expect(verdicts(ce, ce.symbol('x'))).toEqual(tie);
    expect(verdicts(ce, ce.symbol('y'))).toEqual(tie);
    expect(ce.box(['Less', 0, 'x']).evaluate().symbol).toBe('False');
    expect(ce.box(['Greater', 'x', 0]).evaluate().symbol).toBe('False');
    expect(ce.box(['Equal', 'x', 0]).evaluate().symbol).toBe('True');
  });

  test('a symbol with a tiny float value and a positive type', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'real<0<..>', value: 1e-12 });
    expect(verdicts(ce, ce.symbol('x'))).toEqual(tie);
  });

  test('a tiny float literal answers as a symbol with that value', () => {
    const ce = new ComputeEngine();
    expect(verdicts(ce, ce.number(1e-12))).toEqual(tie);
    expect(verdicts(ce, ce.number(-1e-12))).toEqual(tie);
    expect(ce.box(['Less', 0, 1e-12]).evaluate().symbol).toBe('False');
  });

  test('an exact tiny value is ordered exactly', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Power', 10, -30]);
    expect(r.isGreater(0)).toBe(true);
    expect(r.isEqual(0)).toBe(false);
    ce.assign('x', r);
    expect(ce.symbol('x').isEqual(0)).toBe(false);
    expect(ce.symbol('x').isGreater(0)).toBe(true);
    expect(ce.Zero.isLess(ce.symbol('x'))).toBe(true);
  });

  test('a symbol without a value and a strict type bound', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'real<0<..>');
    expect(ce.symbol('w').isGreater(0)).toBe(true);
    expect(ce.symbol('w').isEqual(0)).toBeUndefined();
  });
});
