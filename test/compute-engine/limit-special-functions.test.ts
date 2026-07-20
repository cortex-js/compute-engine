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

describe('SATURATING & RADICAL LIMITS AT INFINITY', () => {
  // Erf/Erfc saturate and √/ⁿ√ carry the radicand's limit. These were missing
  // dispatch cases (`lim Erf(√y)`, `lim √y` stayed inert), which in turn left
  // improper integrals like ∫ₓ^∞ y^{3/2}e^{−y/2} unable to resolve their ∞
  // endpoint (the antiderivative's Erf argument is √y).
  const INF = { sym: 'PositiveInfinity' };
  const NEGINF = { sym: 'NegativeInfinity' };

  test('Erf saturates: Erf(x)→1, Erf(−x)→−1, Erf(√x)→1', () => {
    expect(lim(['Erf', 'x'], INF).evaluate().isSame(ce.One)).toBe(true);
    expect(lim(['Erf', 'x'], NEGINF).evaluate().isSame(ce.number(-1))).toBe(
      true
    );
    expect(lim(['Erf', ['Sqrt', 'x']], INF).evaluate().isSame(ce.One)).toBe(
      true
    );
  });

  test('Erfc saturates: Erfc(x)→0, Erfc(−x)→2', () => {
    expect(lim(['Erfc', 'x'], INF).evaluate().isSame(ce.Zero)).toBe(true);
    expect(lim(['Erfc', 'x'], NEGINF).evaluate().isSame(ce.number(2))).toBe(
      true
    );
  });

  test('Erf/Erfc do NOT saturate at a directionless (complex) infinity', () => {
    // Only a *signed* real infinity saturates. A directionless infinity
    // (ComplexInfinity — neither `isPositive` nor `isNegative` set) must not be
    // treated as +∞: Erf must stay ComplexInfinity/symbolic, never collapse to
    // the wrong 1 (and Erfc never to the wrong 0). `x/0` supplies a
    // ComplexInfinity argument.
    const erf = lim(['Erf', ['Divide', 'x', 0]], INF).evaluate();
    expect(erf.isSame(ce.One)).toBe(false);
    expect(erf.isSame(ce.number(-1))).toBe(false);

    const erfc = lim(['Erfc', ['Divide', 'x', 0]], INF).evaluate();
    expect(erfc.isSame(ce.Zero)).toBe(false);
    expect(erfc.isSame(ce.number(2))).toBe(false);
  });

  test('√x → +∞, ∛x → +∞ (radicals carry the radicand)', () => {
    expect(
      lim(['Sqrt', 'x'], INF).evaluate().isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(
      lim(['Root', 'x', 3], INF).evaluate().isSame(ce.PositiveInfinity)
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
      const start = Date.now();
      let result: any;
      // Must not throw a CancellationError (or anything) at the caller.
      expect(() => {
        result = timedEngine.withTimeLimit(
          { ms: 2000, label: 'test:gruntz-N' },
          () => limT(body).N()
        );
      }).not.toThrow();
      // Bounded by ~2× the time limit (generous wall-clock allowance).
      expect(Date.now() - start).toBeLessThan(10000);
      // Whatever it returns, it must not be a spuriously "confident" wrong
      // finite value: an inert Limit, undefined-ish, or NaN is acceptable.
      const isInert = result?.operator === 'Limit';
      const isNaNish = result?.re === undefined || Number.isNaN(result?.re);
      expect(isInert || isNaNish).toBe(true);
    });

    test(`${name}: evaluate() stays symbolic within the time budget`, () => {
      const start = Date.now();
      let result: any;
      expect(() => {
        result = timedEngine.withTimeLimit(
          { ms: 2000, label: 'test:gruntz-evaluate' },
          () => limT(body).evaluate()
        );
      }).not.toThrow();
      expect(Date.now() - start).toBeLessThan(10000);
      // Symbolic path returns the inert Limit (no wrong closed form).
      expect(result?.operator).toBe('Limit');
    });
  }
});

describe('SIGNED INFINITIES AT POLES (7c follow-up; 2026-07-10 convention)', () => {
  // Convention: a DIRECTIONAL limit at a pole resolves to ±∞ (sign from the
  // leading Laurent coefficient and the valuation's parity); a TWO-SIDED
  // limit resolves only when both sides agree (even valuation). A two-sided
  // odd-valuation limit (lim 1/x at 0) stays inert — the engine does not
  // produce ComplexInfinity limits. Directional signs verified numerically:
  // Γ(0.1) > 0, Γ(−0.1) < 0, ζ(1.1) > 0, ζ(0.9) < 0.
  function limDir(body: any, a: any, dir: number) {
    return ce
      .expr(['Limit', ['Function', ce.expr(body), 'x'], ce.expr(a), dir])
      .evaluate();
  }
  const isPosInf = (e: any) =>
    e.isInfinity === true && e.isPositive === true;
  const isNegInf = (e: any) =>
    e.isInfinity === true && e.isNegative === true;

  test('directional elementary poles: 1/x at 0± → ±∞', () => {
    expect(isPosInf(limDir(['Divide', 1, 'x'], 0, 1))).toBe(true);
    expect(isNegInf(limDir(['Divide', 1, 'x'], 0, -1))).toBe(true);
  });

  test('agreeing two-sided: 1/x² → +∞, −1/x² → −∞, 1/(x−2)² at 2 → +∞', () => {
    expect(isPosInf(lim(['Divide', 1, ['Power', 'x', 2]], 0).evaluate())).toBe(
      true
    );
    expect(isNegInf(lim(['Divide', -1, ['Power', 'x', 2]], 0).evaluate())).toBe(
      true
    );
    expect(
      isPosInf(
        lim(['Divide', 1, ['Power', ['Subtract', 'x', 2], 2]], 2).evaluate()
      )
    ).toBe(true);
  });

  test('disagreeing two-sided stays inert: 1/x, Γ, ln x at their poles', () => {
    expect(lim(['Divide', 1, 'x'], 0).evaluate().operator).toBe('Limit');
    expect(lim(['Gamma', 'x'], 0).evaluate().operator).toBe('Limit');
    expect(lim(['Ln', 'x'], 0).evaluate().operator).toBe('Limit');
  });

  test('directional special-function poles: Γ and ζ', () => {
    expect(isPosInf(limDir(['Gamma', 'x'], 0, 1))).toBe(true);
    expect(isNegInf(limDir(['Gamma', 'x'], 0, -1))).toBe(true);
    expect(isPosInf(limDir(['Zeta', 'x'], 1, 1))).toBe(true);
    expect(isNegInf(limDir(['Zeta', 'x'], 1, -1))).toBe(true);
  });

  test('even special poles resolve two-sided: Γ(x)² at 0 → +∞', () => {
    expect(isPosInf(lim(['Power', ['Gamma', 'x'], 2], 0).evaluate())).toBe(
      true
    );
  });

  test('logarithmic divergence: ln x at 0⁺ → −∞; ln(x²), ln(1/x²) two-sided', () => {
    expect(isNegInf(limDir(['Ln', 'x'], 0, 1))).toBe(true);
    // argument x² → 0⁺ from both sides
    expect(isNegInf(lim(['Ln', ['Power', 'x', 2]], 0).evaluate())).toBe(true);
    // argument 1/x² → +∞ from both sides
    expect(
      isPosInf(lim(['Ln', ['Divide', 1, ['Power', 'x', 2]]], 0).evaluate())
    ).toBe(true);
    // ln x from the left: real logarithm undefined — stays inert
    expect(limDir(['Ln', 'x'], 0, -1).operator).toBe('Limit');
  });
});
