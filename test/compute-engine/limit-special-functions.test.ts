import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// Build `lim_{x→a} body`.
function lim(body: any, a: any) {
  return ce.expr(['Limit', ['Function', ce.expr(body), 'x'], ce.expr(a)]);
}

describe('LIMITS AT SPECIAL-FUNCTION POLES (soundness)', () => {
  // Regression: the symbolic limit engine used to substitute `Digamma(-1)` as a
  // finite symbol and return a WRONG 0 for `lim (x+1)·Digamma(x)`. Since the
  // 7c pole-asymptotics wiring (the pole guard resolves the limit from the
  // exact Laurent expansion) the answer is the exact −1 — never the wrong 0.
  test('a cancelled Digamma pole evaluates exactly (item 7c)', () => {
    const e = lim(['Multiply', ['Add', 'x', 1], ['Digamma', 'x']], -1).evaluate();
    expect(e.is(0)).not.toBe(true);
    expect(e.is(-1)).toBe(true);
  });

  test('cancelled Gamma/Zeta poles evaluate exactly (item 7c)', () => {
    // lim x·Γ(x) at 0 = 1 (the residue of Γ at 0)
    expect(lim(['Multiply', 'x', ['Gamma', 'x']], 0).evaluate().is(1)).toBe(
      true
    );
    // lim Γ(x) − 1/x at 0 = −γ — the constant term of the Laurent expansion,
    // exactly the quantity a leading-term-only rewrite gets wrong.
    const g = lim(['Subtract', ['Gamma', 'x'], ['Divide', 1, 'x']], 0)
      .evaluate();
    expect(g.is(0)).not.toBe(true);
    expect(g.json).toEqual(['Negate', 'EulerGamma']);
    // lim (x−1)·ζ(x) at 1 = 1 (the residue of ζ at 1)
    expect(
      lim(['Multiply', ['Subtract', 'x', 1], ['Zeta', 'x']], 1).evaluate().is(1)
    ).toBe(true);
  });

  test('the polygamma ladder evaluates at its poles (item 7c)', () => {
    // ψ₁(x) ~ 1/x² near 0, so x²·ψ₁(x) → 1
    expect(
      lim(['Multiply', ['Square', 'x'], ['Trigamma', 'x']], 0).evaluate().is(1)
    ).toBe(true);
    // ψ⁽²⁾(x) ~ −2/x³ near 0, so x³·ψ⁽²⁾(x) → −2
    expect(
      lim(['Multiply', ['Power', 'x', 3], ['PolyGamma', 2, 'x']], 0)
        .evaluate()
        .is(-2)
    ).toBe(true);
  });

  test('a bare pole still defers (two-sided pole limits stay inert)', () => {
    // Matches the engine-wide convention (`lim 1/x²` at 0 is inert too): a
    // negative-valuation expansion is not converted to ±∞ by this path.
    expect(lim(['Gamma', 'x'], 0).evaluate().operator).toBe('Limit');
  });

  // The numeric path still works where its sample ladder avoids the (integer-
  // spaced) poles: lim x·Gamma(x) at 0 = 1 (the residue of Gamma at 0).
  test('numeric evaluation recovers the value when sampling avoids poles', () => {
    expect(lim(['Multiply', 'x', ['Gamma', 'x']], 0).N().re).toBeCloseTo(1, 6);
  });

  describe('no over-deferral — ordinary limits are unaffected', () => {
    test('a special function away from its poles is not deferred', () => {
      // Gamma(2)/Gamma(3) = 1/2; neither argument is a pole.
      const e = lim(
        ['Divide', ['Gamma', 'x'], ['Gamma', ['Add', 'x', 1]]],
        2
      ).N();
      expect(e.re).toBeCloseTo(0.5, 10);
    });
    test('elementary limits keep their exact symbolic results', () => {
      expect(lim(['Divide', ['Sin', 'x'], 'x'], 0).evaluate().re).toBe(1);
      expect(
        lim(
          ['Divide', ['Subtract', ['Power', 'x', 2], 1], ['Subtract', 'x', 1]],
          1
        )
          .evaluate()
          .re
      ).toBe(2);
    });
  });
});

describe('CANCELLING ln/√ DIFFERENCES (CORRECTNESS_FINDINGS P0-3)', () => {
  // The asymptotic pass ranked co-dominant differences like `ln(x+1) − ln x`
  // by their (cancelling) leading terms and returned wrong finite limits.
  // They are now combined (`ln(u/v)`, conjugate quotients) before ranking.
  const INF = { sym: 'PositiveInfinity' };

  test('x·(ln(x+1) − ln x) → 1', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.number(1))).toBe(true);
  });

  test('x·(ln(x+2) − ln x) → 2', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Ln', ['Add', 'x', 2]], ['Ln', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.number(2))).toBe(true);
  });

  test('x·(√(x+1) − √x) → +∞', () => {
    const e = lim(
      ['Multiply', 'x', ['Subtract', ['Sqrt', ['Add', 'x', 1]], ['Sqrt', 'x']]],
      INF
    ).evaluate();
    expect(e.isSame(ce.PositiveInfinity)).toBe(true);
  });

  test('√x·(√(x+1) − √x) → 1/2 (exact)', () => {
    const e = lim(
      [
        'Multiply',
        ['Sqrt', 'x'],
        ['Subtract', ['Sqrt', ['Add', 'x', 1]], ['Sqrt', 'x']],
      ],
      INF
    ).evaluate();
    expect(e.isSame(ce.expr(['Rational', 1, 2]))).toBe(true);
  });

  test('ln(2x) − ln x → ln 2 (exact); ln(x+1) − ln x → 0', () => {
    expect(
      lim(['Subtract', ['Ln', ['Multiply', 2, 'x']], ['Ln', 'x']], INF)
        .evaluate()
        .isSame(ce.expr(['Ln', 2]))
    ).toBe(true);
    expect(
      lim(['Subtract', ['Ln', ['Add', 'x', 1]], ['Ln', 'x']], INF)
        .evaluate()
        .isSame(ce.number(0))
    ).toBe(true);
  });

  test('controls unchanged: x²−x → +∞, ln x − x → −∞, x·e^{−x} → 0', () => {
    expect(
      lim(['Subtract', ['Power', 'x', 2], 'x'], INF)
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(
      lim(['Subtract', ['Ln', 'x'], 'x'], INF)
        .evaluate()
        .isSame(ce.NegativeInfinity)
    ).toBe(true);
    expect(
      lim(['Multiply', 'x', ['Exp', ['Negate', 'x']]], INF)
        .evaluate()
        .isSame(ce.number(0))
    ).toBe(true);
  });
});

describe('HARD GRUNTZ LIMITS RESPECT THE DEADLINE (CORRECTNESS_FINDINGS #28)', () => {
  // These iterated-exponential (Gruntz-class) limits used to burn ~18 min of CPU
  // in `Limit.N()` — the symbolic recursion (L'Hôpital differentiation of
  // exp/log towers) had no deadline check, and its numeric probes evaluated the
  // towers with arbitrary-precision `.N()`, building 10-million-digit
  // intermediates. The engine can't do these limits, but it must give up
  // quickly (bounded by `ce.timeLimit`) rather than hang, and it must never
  // throw a `CancellationError` at the caller.
  const INF = { sym: 'PositiveInfinity' };

  // Isolate the tight time budget from the shared engine.
  const timedEngine = new ComputeEngine();
  const limT = (body: any) =>
    timedEngine.expr(['Limit', ['Function', timedEngine.expr(body), 'x'], INF]);

  // Gruntz #1 (true value 1/3):
  // (exp(x·exp(−x)/(exp(−x)+exp(−2x²/(x+1)))) − exp(x))/x
  const gruntz1 = [
    'Divide',
    [
      'Subtract',
      [
        'Exp',
        [
          'Divide',
          ['Multiply', 'x', ['Exp', ['Negate', 'x']]],
          [
            'Add',
            ['Exp', ['Negate', 'x']],
            ['Exp', ['Divide', ['Multiply', -2, ['Power', 'x', 2]], ['Add', 'x', 1]]],
          ],
        ],
      ],
      ['Exp', 'x'],
    ],
    'x',
  ];

  // Gruntz #2 (true value 1/e):
  // x·ln(x)·ln(x·eˣ − x²)² / ln(ln(x² + 2·exp(exp(3x³·ln x))))
  const gruntz2 = [
    'Divide',
    [
      'Multiply',
      'x',
      ['Ln', 'x'],
      ['Power', ['Ln', ['Subtract', ['Multiply', 'x', ['Exp', 'x']], ['Power', 'x', 2]]], 2],
    ],
    [
      'Ln',
      [
        'Ln',
        [
          'Add',
          ['Power', 'x', 2],
          ['Multiply', 2, ['Exp', ['Exp', ['Multiply', 3, ['Power', 'x', 3], ['Ln', 'x']]]]]],
      ],
    ],
  ];

  for (const [name, body] of [
    ['Gruntz #1 (→1/3)', gruntz1],
    ['Gruntz #2 (→1/e)', gruntz2],
  ] as const) {
    test(`${name}: N() returns within the time budget, no throw`, () => {
      const saved = timedEngine.timeLimit;
      timedEngine.timeLimit = 2000;
      try {
        const start = Date.now();
        let result: any;
        // Must not throw a CancellationError (or anything) at the caller.
        expect(() => {
          result = limT(body).N();
        }).not.toThrow();
        // Bounded by ~2× the time limit (generous wall-clock allowance).
        expect(Date.now() - start).toBeLessThan(10000);
        // Whatever it returns, it must not be a spuriously "confident" wrong
        // finite value: an inert Limit, undefined-ish, or NaN is acceptable.
        const isInert = result?.operator === 'Limit';
        const isNaNish = result?.re === undefined || Number.isNaN(result?.re);
        expect(isInert || isNaNish).toBe(true);
      } finally {
        timedEngine.timeLimit = saved;
      }
    });

    test(`${name}: evaluate() stays symbolic within the time budget`, () => {
      const saved = timedEngine.timeLimit;
      timedEngine.timeLimit = 2000;
      try {
        const start = Date.now();
        let result: any;
        expect(() => {
          result = limT(body).evaluate();
        }).not.toThrow();
        expect(Date.now() - start).toBeLessThan(10000);
        // Symbolic path returns the inert Limit (no wrong closed form).
        expect(result?.operator).toBe('Limit');
      } finally {
        timedEngine.timeLimit = saved;
      }
    });
  }
});
