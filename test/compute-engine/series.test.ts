import { ComputeEngine } from '../../src/compute-engine';
import { toAsciiMath } from '../../src/compute-engine/boxed-expression/ascii-math';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

export const ce = new ComputeEngine();
// Series expansion is compute-heavy; the default 2s internal time limit is
// flaky under jest instrumentation + full-suite worker contention (same
// rationale as the shared engine in test/utils.ts).
ce.timeLimit = 20_000;

//
// Helpers
//

/** Build and evaluate a `Series` expression. */
function seriesArgs(
  fLatex: string,
  x0Latex?: string,
  n?: number
): BoxedExpression[] {
  const args: BoxedExpression[] = [ce.parse(fLatex), ce.symbol('x')];
  // `x0` is positional before `n`; default it to 0 when only `n` is supplied.
  if (x0Latex !== undefined) args.push(ce.parse(x0Latex));
  else if (n !== undefined) args.push(ce.Zero);
  if (n !== undefined) args.push(ce.number(n));
  return args;
}

function series(
  fLatex: string,
  x0Latex?: string,
  n?: number
): BoxedExpression {
  return ce.function('Series', seriesArgs(fLatex, x0Latex, n)).evaluate();
}

/** The truncated polynomial `Normal(Series(f, x, x0, n))`. */
function normal(fLatex: string, x0Latex?: string, n?: number): BoxedExpression {
  return ce
    .function('Normal', [ce.function('Series', seriesArgs(fLatex, x0Latex, n))])
    .evaluate();
}

/** Assert the truncated polynomial matches an expected LaTeX expression
 * exactly (structural/symbolic equality of exact coefficients). */
function expectPoly(
  fLatex: string,
  expectedLatex: string,
  x0Latex?: string,
  n?: number
) {
  const got = normal(fLatex, x0Latex, n);
  const want = ce.parse(expectedLatex);
  if (!got.isSame(want)) expect(got.latex).toBe(want.latex);
}

//
// Exact-coefficient battery (§6)
//

describe('Series — exact expansions at 0', () => {
  test('sin x', () =>
    expectPoly('\\sin x', 'x - \\frac{x^3}{6} + \\frac{x^5}{120}'));

  test('cos x', () =>
    expectPoly('\\cos x', '1 - \\frac{x^2}{2} + \\frac{x^4}{24}'));

  test('e^x', () =>
    expectPoly(
      'e^x',
      '1 + x + \\frac{x^2}{2} + \\frac{x^3}{6} + \\frac{x^4}{24} + \\frac{x^5}{120}'
    ));

  test('ln(1+x)', () =>
    expectPoly(
      '\\ln(1+x)',
      'x - \\frac{x^2}{2} + \\frac{x^3}{3} - \\frac{x^4}{4} + \\frac{x^5}{5}'
    ));

  test('(1+x)^{1/2}', () =>
    expectPoly(
      '\\sqrt{1+x}',
      '1 + \\frac{x}{2} - \\frac{x^2}{8} + \\frac{x^3}{16} - \\frac{5x^4}{128} + \\frac{7x^5}{256}'
    ));

  test('tan x', () =>
    expectPoly('\\tan x', 'x + \\frac{x^3}{3} + \\frac{2x^5}{15}'));

  test('arctan x', () =>
    expectPoly('\\arctan x', 'x - \\frac{x^3}{3} + \\frac{x^5}{5}'));

  test('1/(1-x)', () =>
    expectPoly('\\frac{1}{1-x}', '1 + x + x^2 + x^3 + x^4 + x^5'));

  test('e^{sin x} (composite)', () =>
    expectPoly(
      'e^{\\sin x}',
      '1 + x + \\frac{x^2}{2} - \\frac{x^4}{8} - \\frac{x^5}{15}'
    ));

  test('ln(cos x) (composite)', () =>
    expectPoly('\\ln(\\cos x)', '-\\frac{x^2}{2} - \\frac{x^4}{12}'));
});

describe('Series — BigO remainder', () => {
  test('sin has O(x^7) tail (next nonzero order, not x^6)', () => {
    const s = series('\\sin x');
    expect(s.latex).toContain('O\\left(x^7\\right)');
  });

  test('exp has O(x^6) tail (all orders nonzero)', () => {
    expect(series('e^x').latex).toContain('O\\left(x^6\\right)');
  });

  test('polynomial has no remainder (exact)', () => {
    const s = series('(1+x)^2');
    expect(s.toString()).not.toContain('BigO');
    expect(s.isSame(ce.parse('1 + 2x + x^2'))).toBe(true);
  });
});

//
// Non-zero expansion point
//

describe('Series — non-zero x0', () => {
  test('sin at pi/6 has exact 1/2 and sqrt(3)/2 coefficients', () => {
    // sin(pi/6 + t) = 1/2 + (sqrt3/2) t - (1/2)(1/2) t^2 - ...
    const p = normal('\\sin x', '\\frac{\\pi}{6}', 2);
    // 1/2 + (√3/2)(x−π/6) − (1/4)(x−π/6)². Compare as an exact identity
    // (the constructed reference distributes; the difference must vanish).
    const t = ce.parse('x - \\frac{\\pi}{6}');
    const expected = ce
      .parse('\\frac{1}{2}')
      .add(ce.parse('\\frac{\\sqrt{3}}{2}').mul(t))
      .add(ce.parse('-\\frac{1}{4}').mul(t.pow(2)));
    expect(p.sub(expected).simplify().isSame(0)).toBe(true);
    // And the exact radical coefficient is present (no floats).
    expect(p.latex).toContain('\\sqrt{3}');
  });

  test('coefficients are exact (no floats)', () => {
    const p = normal('\\sin x', '\\frac{\\pi}{6}', 2);
    expect(p.latex).toContain('\\sqrt{3}');
    expect(p.toString()).not.toContain('.'); // no decimal literals
  });
});

//
// Symbolic (undeclared) f
//

describe('Series — undeclared function', () => {
  test('symbolic Taylor form f(0) + f′(0)x + ...', () => {
    // Build an explicit application of the undeclared `f` (parsing `f(x)`
    // would give the product `f·x`).
    const f = ce.function('f', [ce.symbol('x')]);
    const s = ce
      .function('Series', [f, ce.symbol('x'), ce.Zero, ce.number(2)])
      .evaluate();
    // Should be symbolic, not deferred, and mention the derivative applications
    expect(s.operator).not.toBe('Series');
    const str = s.toString();
    expect(str).toContain('f(0)');
    expect(str).toContain('Derivative');
  });
});

//
// Expansion at +/- infinity (Phase 1)
//

describe('Series — expansion at infinity', () => {
  test('(x+1)/x at +∞ is 1 + 1/x (exact)', () => {
    const s = series('\\frac{x+1}{x}', '+\\infty');
    expect(s.isSame(ce.parse('1 + \\frac{1}{x}'))).toBe(true);
  });

  test('arctan at +∞ is pi/2 - 1/x + 1/(3x^3) - ...', () => {
    const p = normal('\\arctan x', '+\\infty', 3);
    const expected = ce.parse(
      '\\frac{\\pi}{2} - x^{-1} + \\frac{1}{3} x^{-3}'
    );
    // Compare as an asymptotic identity (negative-power forms can differ
    // structurally): the difference vanishes.
    expect(p.sub(expected).simplify().isSame(0)).toBe(true);
  });

  test('arctan at -∞ is -pi/2 - 1/x + ...', () => {
    const p = normal('\\arctan x', '-\\infty', 1);
    const expected = ce.parse('-\\frac{\\pi}{2} - x^{-1}');
    expect(p.sub(expected).simplify().isSame(0)).toBe(true);
  });
});

//
// Deferred (unevaluated) cases — never a partial/wrong expansion
//

describe('Series — deferred singular cases', () => {
  test('e^{1/x} at 0 stays unevaluated (essential singularity)', () => {
    const s = series('e^{1/x}');
    expect(s.operator).toBe('Series');
  });

  test('1/ln x at 0 stays unevaluated (reciprocal log)', () => {
    const s = series('\\frac{1}{\\ln x}');
    expect(s.operator).toBe('Series');
  });

  test('ln(ln x) at 0 stays unevaluated (nested log)', () => {
    const s = series('\\ln(\\ln x)');
    expect(s.operator).toBe('Series');
  });

  test('x^π at 0 stays unevaluated (irrational exponent)', () => {
    // Regression: the derivative fallback used to keep unresolved `0^{π−k}`
    // indeterminates as coefficients, emitting a garbage expansion.
    const s = series('x^{\\pi}');
    expect(s.operator).toBe('Series');
    expect(s.toString()).not.toContain('0^');
  });

  test('x^π about a regular point still expands (binomial)', () => {
    const s = ce
      .function('Series', [
        ce.parse('x^{\\pi}'),
        ce.symbol('x'),
        ce.number(2),
        ce.number(2),
      ])
      .evaluate();
    expect(s.operator).not.toBe('Series');
    // Check the order-2 truncation numerically at x = 2.1: the remainder is
    // ≈ f‴(2)/6·(0.1)³ ≈ 1.4e-3.
    const poly = ce.function('Normal', [s]).evaluate();
    const err = Math.abs(
      poly.subs({ x: ce.number(2.1) }).N().re -
        ce.parse('x^{\\pi}').subs({ x: ce.number(2.1) }).N().re
    );
    expect(err).toBeLessThan(5e-3);
  });

  test('deferred result equals its input (pill guard: no expansion)', () => {
    const input = ce.function('Series', [
      ce.parse('e^{1/x}'),
      ce.symbol('x'),
    ]);
    expect(input.evaluate().isSame(input)).toBe(true);
  });
});

//
// Normal
//

describe('Normal', () => {
  test('strips BigO to a plottable polynomial', () => {
    const p = ce
      .function('Normal', [
        ce.function('Series', [ce.parse('\\sin x'), ce.symbol('x')]),
      ])
      .evaluate();
    expect(p.toString()).not.toContain('BigO');
    expect(p.isSame(ce.parse('x - \\frac{x^3}{6} + \\frac{x^5}{120}'))).toBe(
      true
    );
  });

  test('is idempotent', () => {
    const inner = ce.function('Normal', [
      ce.function('Series', [ce.parse('\\sin x'), ce.symbol('x')]),
    ]);
    const once = inner.evaluate();
    const twice = ce.function('Normal', [once]).evaluate();
    expect(twice.isSame(once)).toBe(true);
  });

  test('is a passthrough on BigO-free input', () => {
    const e = ce.parse('x^2 + 1');
    expect(ce.function('Normal', [e]).evaluate().isSame(e)).toBe(true);
  });
});

//
// Numeric equivalence: Normal(Series(f)) approximates f near x0
//

describe('Series — numeric equivalence near the expansion point', () => {
  test('Normal(Series(sin, n=5)) matches sin within C*|x|^6', () => {
    const p = normal('\\sin x'); // order 5
    for (const xv of [0.1, 0.2, 0.3, 0.5]) {
      const approx = p.subs({ x: ce.number(xv) }).N().re;
      const exact = Math.sin(xv);
      expect(Math.abs(approx - exact)).toBeLessThanOrEqual(Math.pow(xv, 6));
    }
  });

  test('Normal(Series(e^x, n=5)) matches exp within C*|x|^6', () => {
    const p = normal('e^x');
    for (const xv of [0.1, 0.3, 0.6]) {
      const approx = p.subs({ x: ce.number(xv) }).N().re;
      const exact = Math.exp(xv);
      expect(Math.abs(approx - exact)).toBeLessThanOrEqual(Math.pow(xv, 6));
    }
  });
});

//
// N() poisoning
//

describe('BigO poisons numeric evaluation', () => {
  test('a series with a BigO term has NaN as its .N()', () => {
    const s = series('\\sin x');
    expect(s.N().isNaN).toBe(true);
  });

  test('a bare BigO term is NaN under .N()', () => {
    expect(ce.function('BigO', [ce.parse('x^7')]).N().isNaN).toBe(true);
  });

  test('BigO is inert under evaluate', () => {
    const b = ce.function('BigO', [ce.parse('x^7')]);
    expect(b.evaluate().isSame(b)).toBe(true);
  });

  test('after Normal, .N() is a real polynomial', () => {
    expect(normal('\\sin x').N().isNaN).not.toBe(true);
  });
});

//
// LaTeX round-trip (both directions)
//

describe('LaTeX — BigO and Series notation', () => {
  test('BigO serializes as O\\left(...\\right)', () => {
    expect(ce.function('BigO', [ce.parse('x^7')]).latex).toBe(
      'O\\left(x^7\\right)'
    );
  });

  test('\\mathcal{O}(...) parses to BigO', () => {
    expect(ce.parse('\\mathcal{O}(x^5)').json).toEqual([
      'BigO',
      ['Power', 'x', 5],
    ]);
  });

  test('\\operatorname{O}(...) parses to BigO', () => {
    expect(ce.parse('\\operatorname{O}(x^5)').json).toEqual([
      'BigO',
      ['Power', 'x', 5],
    ]);
  });

  test('bare O(x) is NOT captured as BigO', () => {
    expect(ce.parse('O(x)').json).not.toEqual(['BigO', 'x']);
  });

  test('unevaluated Series round-trips', () => {
    const s = ce.function('Series', [
      ce.parse('\\frac{1}{\\sin x}'),
      ce.symbol('x'),
    ]);
    const round = ce.parse(s.latex);
    expect(round.isSame(s)).toBe(true);
  });
});

//
// Pill guard
//

describe('Series — pill guard', () => {
  test('an applicable expansion is not the same as its input', () => {
    const input = ce.function('Series', [ce.parse('\\sin x'), ce.symbol('x')]);
    expect(input.evaluate().isSame(input)).toBe(false);
  });
});

//
// Order cap and deadline
//

describe('Series — order cap', () => {
  test('a very large requested order is capped and still terminates', () => {
    const s = series('\\sin x', '0', 500);
    // Capped at MAX_SERIES_ORDER (100): the expansion is produced (not
    // deferred) and terminates. sin is odd, so the remainder is O(x^101).
    expect(s.operator).not.toBe('Series');
    expect(s.toString()).toMatch(/BigO\(x\^\(?101\)?\)/);
  });

  test('respects a zero order (constant term + remainder)', () => {
    const p = normal('\\cos x', undefined, 0);
    expect(p.isSame(ce.One)).toBe(true);
  });
});

//
// Display order (serialization-only; canonical `Add` order is unchanged —
// see `latex-syntax/dictionary/definitions-arithmetic.ts`)
//

describe('series display order', () => {
  test('sin x: ascending degree, O(x^7) last', () => {
    expect(series('\\sin x').latex).toBe(
      'x-\\frac{x^3}{6}+\\frac{x^5}{120}+O\\left(x^7\\right)'
    );
  });

  test('sqrt(1+x) to order 3: ascending degree starting with the constant term, O(x^4) last', () => {
    const latex = series('\\sqrt{1+x}', '0', 3).latex;
    expect(latex.startsWith('1+\\frac{x}{2}')).toBe(true);
    expect(latex).toBe(
      '1+\\frac{x}{2}-\\frac{x^2}{8}+\\frac{x^3}{16}+O\\left(x^4\\right)'
    );
  });

  test('arctan x at +infinity: descending degree, O(x^{-7}) last', () => {
    const latex = series('\\arctan x', '+\\infty').latex;
    expect(latex.startsWith('\\frac{\\pi}{2}-\\frac{1}{x}')).toBe(true);
    expect(latex).toBe(
      '\\frac{\\pi}{2}-\\frac{1}{x}+\\frac{1}{3x^3}-\\frac{1}{5x^5}+O\\left(\\frac{1}{x^7}\\right)'
    );
  });

  test('a BigO-free sum is unaffected (canonical order preserved)', () => {
    // Regression guard: the display-order rule only applies to sums that
    // actually contain a `BigO` term.
    expect(ce.parse('x^5 - x^3 + x').latex).toBe('x^5-x^3+x');
  });

  test('AsciiMath uses ascending degree with BigO last', () => {
    expect(toAsciiMath(series('\\sin x'))).toBe(
      'x - 1/6 * x^3 + 1/120 * x^5 + BigO(x^7)'
    );
  });

  test('AsciiMath uses descending degree for an expansion at infinity', () => {
    expect(toAsciiMath(series('\\arctan x', '+\\infty'))).toBe(
      '1/2 * pi - 1 / x + 1/3 * x^(-3) - 1/5 * x^(-5) + BigO(x^(-7))'
    );
  });
});

//
// §6 Laurent battery — expansions at poles (Phase 2)
//

/** The residue (coefficient of `(x−x0)⁻¹`) extracted from the Series: the
 * constant term of `Series((x−x0)·f, x, x0, 0)`, which is `(x−x0)·f` evaluated
 * at the (removable) pole. */
function seriesResidue(fLatex: string, x0Latex: string): BoxedExpression {
  const p = ce.parse(x0Latex);
  const g = ce.function('Multiply', [ce.symbol('x').sub(p), ce.parse(fLatex)]);
  const s = ce
    .function('Normal', [ce.function('Series', [g, ce.symbol('x'), p, ce.Zero])])
    .evaluate();
  return s.subs({ x: p }).evaluate();
}

/** Assert `Normal(Series(f, x, x0, n))` matches `f` numerically at points near
 * the pole, within a relative tolerance. */
function expectNumericNearPole(
  poly: BoxedExpression,
  f: (x: number) => number,
  x0: number,
  dxs: number[],
  relTol: number
) {
  for (const dx of dxs) {
    const xv = x0 + dx;
    const approx = poly.subs({ x: ce.number(xv) }).N().re;
    const exact = f(xv);
    const rel = Math.abs((approx - exact) / (exact || 1));
    expect(rel).toBeLessThanOrEqual(relTol);
  }
}

describe('Series — Laurent expansions at poles (§6)', () => {
  test('1/sin x = 1/x + x/6 + 7x³/360 + …', () => {
    expect(series('\\frac{1}{\\sin x}').latex).toBe(
      '\\frac{1}{x}+\\frac{x}{6}+\\frac{7x^3}{360}+\\frac{31x^5}{15\\,120}+O\\left(x^7\\right)'
    );
  });

  test('cot x = 1/x − x/3 − x³/45 + O(x⁵)', () => {
    expect(series('\\cot x', '0', 3).latex).toBe(
      '\\frac{1}{x}-\\frac{x}{3}-\\frac{x^3}{45}+O\\left(x^5\\right)'
    );
  });

  test('1/(x²(1−x)) = x⁻² + x⁻¹ + 1 + x + …', () => {
    const p = normal('\\frac{1}{x^2(1-x)}');
    const expected = ce.parse('x^{-2} + x^{-1} + 1 + x + x^2 + x^3 + x^4 + x^5');
    expect(p.sub(expected).simplify().isSame(0)).toBe(true);
  });

  test('tan at π/2 = −1/(x−π/2) + (x−π/2)/3 + …', () => {
    // Simple pole with a −1/(x−π/2) principal part. (The Residue engine does
    // not itself handle tan at π/2, and the (x−x0)·f residue trick leaves an
    // unfolded π/2 constant here — see seriesResidue — so this is validated by
    // the principal-part structure plus numeric equivalence.)
    const s = normal('\\tan x', '\\frac{\\pi}{2}', 1);
    expect(s.latex).toBe(
      '\\frac{1}{3}(x-\\frac{\\pi}{2})-(x-\\frac{\\pi}{2})^{-1}'
    );
    const p = normal('\\tan x', '\\frac{\\pi}{2}', 3);
    expectNumericNearPole(
      p,
      (x) => Math.tan(x),
      Math.PI / 2,
      [0.05, 0.1, 0.2],
      1e-3
    );
  });

  test('Γ(x) at 0 = 1/x − γ + (γ²/2 + π²/12)x + …', () => {
    const p = normal('\\Gamma(x)', '0', 2);
    // Residue 1, constant term −γ.
    expect(seriesResidue('\\Gamma(x)', '0').isSame(1)).toBe(true);
    expect(p.subs({ x: ce.number(0) })).toBeDefined(); // (has a pole term; sanity)
    // Exact identity vs the textbook Laurent expansion.
    const ref = ce.parse(
      '\\frac{1}{x} - \\gamma + \\left(\\frac{\\gamma^2}{2} + \\frac{\\pi^2}{12}\\right)x' +
        ' - \\left(\\frac{\\gamma^3}{6} + \\frac{\\gamma\\pi^2}{12} + \\frac{\\zeta(3)}{3}\\right)x^2'
    );
    expect(p.sub(ref).simplify().isSame(0)).toBe(true);
    // Exact coefficients: EulerGamma/Pi present, no decimal literals.
    expect(p.toString()).toContain('EulerGamma');
    expect(p.toString()).toContain('pi');
    expect(p.toString()).not.toMatch(/\d\.\d/);
    // Numeric equivalence near the pole (n = 2, so a modest tolerance).
    expectNumericNearPole(
      p,
      (x) => ce.function('Gamma', [ce.number(x)]).N().re,
      0,
      [0.05, 0.1, 0.2],
      1e-2
    );
  });

  test('Γ(x) at −1: residue −1, constant γ − 1', () => {
    expect(seriesResidue('\\Gamma(x)', '-1').isSame(-1)).toBe(true);
    const p = normal('\\Gamma(x)', '-1', 2);
    // constant term (x → −1) of (x+1)·Γ − residue part is γ − 1; verify
    // numerically near the pole instead of structurally.
    expectNumericNearPole(
      p,
      (x) => ce.function('Gamma', [ce.number(x)]).N().re,
      -1,
      [0.05, 0.1, 0.2],
      1e-2
    );
  });

  test('ψ(x) (Digamma) at 0 = −1/x − γ + (π²/6)x − ζ(3)x² + …', () => {
    expect(seriesResidue('\\operatorname{Digamma}(x)', '0').isSame(-1)).toBe(
      true
    );
    const p = normal('\\operatorname{Digamma}(x)', '0', 3);
    const ref = ce.parse(
      '-\\frac{1}{x} - \\gamma + \\frac{\\pi^2}{6}x - \\zeta(3)x^2 + \\frac{\\pi^4}{90}x^3'
    );
    expect(p.sub(ref).simplify().isSame(0)).toBe(true);
    expectNumericNearPole(
      p,
      (x) => ce.function('Digamma', [ce.number(x)]).N().re,
      0,
      [0.05, 0.1, 0.2],
      1e-2
    );
  });

  test('ζ(x) at 1 = 1/(x−1) + γ + O(x−1)', () => {
    expect(series('\\zeta(x)', '1').latex).toBe(
      '\\frac{1}{x-1}+\\gamma+O\\left(x-1\\right)'
    );
    expect(seriesResidue('\\zeta(x)', '1').isSame(1)).toBe(true);
  });

  test('pole at +∞: x²/(x−1) = x + 1 + 1/x + 1/x² + …', () => {
    expect(series('\\frac{x^2}{x-1}', '+\\infty').latex).toBe(
      'x+1+\\frac{1}{x}+\\frac{1}{x^2}+\\frac{1}{x^3}+\\frac{1}{x^4}+\\frac{1}{x^5}+O\\left(\\frac{1}{x^6}\\right)'
    );
    const p = normal('\\frac{x^2}{x-1}', '+\\infty');
    expectNumericNearPole(
      p,
      (x) => (x * x) / (x - 1),
      0,
      [8, 10, 20],
      1e-4
    );
  });
});

describe('Series — Residue consistency', () => {
  // The coefficient of (x−x0)⁻¹ from Series equals Residue(f, x0), for the
  // cases where the (independent) Residue engine already returns a value.
  const cases: [string, string][] = [
    ['\\frac{1}{\\sin x}', '0'],
    ['\\Gamma(x)', '0'],
    ['\\Gamma(x)', '-1'],
    ['\\operatorname{Digamma}(x)', '0'],
    ['\\zeta(x)', '1'],
  ];
  for (const [f, x0] of cases) {
    test(`residue of ${f} at ${x0}`, () => {
      const fromSeries = seriesResidue(f, x0);
      const fromResidue = ce
        .function('Residue', [ce.parse(f), ce.symbol('x'), ce.parse(x0)])
        .evaluate();
      expect(fromSeries.simplify().isSame(fromResidue.simplify())).toBe(true);
    });
  }
});

describe('Series — Laurent numeric equivalence and N() poisoning', () => {
  test('Normal(Series(1/sin x)) matches 1/sin near 0', () => {
    expectNumericNearPole(
      normal('\\frac{1}{\\sin x}'),
      (x) => 1 / Math.sin(x),
      0,
      [0.05, 0.1, 0.2],
      1e-6
    );
  });

  test('Normal(Series(cot x)) matches cot near 0', () => {
    expectNumericNearPole(
      normal('\\cot x'),
      (x) => 1 / Math.tan(x),
      0,
      [0.05, 0.1, 0.2],
      1e-6
    );
  });

  test('a Laurent series with a BigO term has NaN as its .N()', () => {
    expect(series('\\frac{1}{\\sin x}').N().isNaN).toBe(true);
    expect(series('\\Gamma(x)').N().isNaN).toBe(true);
  });

  test('after Normal, a Laurent series has a real .N()', () => {
    expect(normal('\\frac{1}{\\sin x}').subs({ x: ce.number(0.3) }).N().isNaN).not.toBe(
      true
    );
  });
});

//
// §7 Puiseux battery — fractional-power expansions (Phase A)
//

describe('Series — Puiseux expansions (§7)', () => {
  test('√x = √x (a bare fractional monomial)', () => {
    expect(series('\\sqrt{x}').latex).toBe('\\sqrt{x}+O\\left(x^7\\right)');
  });

  test('1/√x matches numerically near 0', () => {
    expectNumericNearPole(
      normal('\\frac{1}{\\sqrt{x}}'),
      (x) => 1 / Math.sqrt(x),
      0,
      [0.05, 0.1, 0.2],
      1e-6
    );
  });

  test('√(sin x) = √x − x^{5/2}/12 + x^{9/2}/1440 + …', () => {
    // Cross-checked against SymPy: sqrt(x) - x**(5/2)/12 + x**(9/2)/1440 + …
    expectNumericNearPole(
      normal('\\sqrt{\\sin x}', '0', 6),
      (x) => Math.sqrt(Math.sin(x)),
      0,
      [0.05, 0.1, 0.2],
      1e-6
    );
  });

  test('x^{3/2}·e^x matches numerically near 0', () => {
    expectNumericNearPole(
      normal('x^{3/2}e^x', '0', 5),
      (x) => Math.pow(x, 1.5) * Math.exp(x),
      0,
      [0.05, 0.1, 0.2],
      1e-3
    );
  });

  test('√x + x (mixed denominators)', () => {
    expect(series('\\sqrt{x}+x').latex).toBe('\\sqrt{x}+x+O\\left(x^7\\right)');
  });

  test('√x·√x reduces to plain x (integer power)', () => {
    expect(normal('\\sqrt{x}\\sqrt{x}').isSame(ce.symbol('x'))).toBe(true);
  });

  test('Root(1+x, 3)·√x matches numerically near 0', () => {
    expectNumericNearPole(
      normal('\\sqrt[3]{1+x}\\cdot\\sqrt{x}', '0', 5),
      (x) => Math.cbrt(1 + x) * Math.sqrt(x),
      0,
      [0.05, 0.1, 0.2],
      1e-3
    );
  });

  test('√x at +∞ is √x', () => {
    const s = series('\\sqrt{x}', '+\\infty');
    expect(s.operator).toBe('Add');
    expect(s.latex).toContain('\\sqrt{x}');
  });

  test('cos(√x) = 1 − x/2 + x²/24 − x³/720 (integer powers)', () => {
    // Cross-checked against SymPy: 1 - x/2 + x**2/24 - x**3/720 + O(x**4).
    // A composition with a Puiseux argument that collapses to integer powers.
    expect(series('\\cos(\\sqrt{x})', '0', 3).latex).toBe(
      '1-\\frac{x}{2}+\\frac{x^2}{24}-\\frac{x^3}{720}+O\\left(x^4\\right)'
    );
  });

  test('sin(√x) matches numerically near 0', () => {
    expectNumericNearPole(
      normal('\\sin(\\sqrt{x})', '0', 3),
      (x) => Math.sin(Math.sqrt(x)),
      0,
      [0.05, 0.1, 0.2],
      1e-5
    );
  });

  test('e^{√x} matches numerically near 0', () => {
    expectNumericNearPole(
      normal('e^{\\sqrt{x}}', '0', 3),
      (x) => Math.exp(Math.sqrt(x)),
      0,
      [0.05, 0.1, 0.2],
      1e-5
    );
  });

  test('csc(√x) = 1/√x + √x/6 + 7x^{3/2}/360 + … (Laurent–Puiseux mix)', () => {
    // Cross-checked against SymPy: 1/sqrt(x) + sqrt(x)/6 + 7*x**(3/2)/360 + …
    expectNumericNearPole(
      normal('\\csc(\\sqrt{x})', '0', 3),
      (x) => 1 / Math.sin(Math.sqrt(x)),
      0,
      [0.05, 0.1, 0.2],
      1e-5
    );
  });

  test('tan(√x) matches numerically near 0', () => {
    expectNumericNearPole(
      normal('\\tan(\\sqrt{x})', '0', 3),
      (x) => Math.tan(Math.sqrt(x)),
      0,
      [0.05, 0.1, 0.2],
      1e-3
    );
  });

  test('Γ(√x) = 1/√x − γ + … (special-function pole with Puiseux arg)', () => {
    const p = normal('\\Gamma(\\sqrt{x})', '0', 2);
    // Leading behaviour is the Γ pole: residue 1 at √x = 0, constant −γ.
    expect(p.toString()).toContain('EulerGamma');
    expectNumericNearPole(
      p,
      (x) => ce.function('Gamma', [ce.number(Math.sqrt(x))]).N().re,
      0,
      [0.05, 0.1, 0.2],
      2e-2
    );
  });

  test('x^π at 0 does not produce a Puiseux expansion', () => {
    // Irrational exponent: the Puiseux path declines (there is no finite
    // ramification). (The Taylor engine's own handling of `x^π` is unchanged.)
    const s = normal('x^\\pi', '0', 3);
    expect(s.toString()).not.toContain('Sqrt');
  });

  test('e^{1/x} at 0 stays unevaluated (essential singularity)', () => {
    expect(series('e^{1/x}').operator).toBe('Series');
  });
});

//
// §8 Log-aware battery — logarithmic expansions (Phase B)
//

describe('Series — log-aware expansions (§8)', () => {
  test('ln x = ln x', () => {
    expect(series('\\ln x').latex).toBe('\\ln(x)+O\\left(x^7\\right)');
  });

  test('x·ln x = x ln x', () => {
    expect(series('x\\ln x').latex).toBe('x\\ln(x)+O\\left(x^8\\right)');
  });

  test('ln(sin x) = ln x − x²/6 − x⁴/180 + O(x⁶)', () => {
    // Cross-checked against SymPy: log(x) - x**2/6 - x**4/180 + O(x**6).
    expect(series('\\ln(\\sin x)').latex).toBe(
      '\\ln(x)-\\frac{x^2}{6}-\\frac{x^4}{180}+O\\left(x^6\\right)'
    );
  });

  test('ln(tan x) = ln x + x²/3 + 7x⁴/90 + O(x⁶)', () => {
    // Cross-checked against SymPy: log(x) + x**2/3 + 7*x**4/90 + O(x**6).
    expect(series('\\ln(\\tan x)').latex).toBe(
      '\\ln(x)+\\frac{x^2}{3}+\\frac{7x^4}{90}+O\\left(x^6\\right)'
    );
  });

  test('x^x = 1 + x ln x + x²ln²x/2 + …', () => {
    // Cross-checked against SymPy: 1 + x*log(x) + x**2*log(x)**2/2 + …
    expectNumericNearPole(
      normal('x^x', '0', 3),
      (x) => Math.pow(x, x),
      0,
      [0.05, 0.1, 0.2],
      1e-3
    );
    // The constant term is 1, and log atoms appear in higher coefficients.
    expect(normal('x^x', '0', 3).toString()).toContain('ln(x)');
  });

  test('ln(x)/x = ln x / x', () => {
    expect(series('\\frac{\\ln x}{x}').latex).toBe(
      '\\frac{\\ln(x)}{x}+O\\left(x^7\\right)'
    );
  });

  test('Log(x, 2) = ln x / ln 2', () => {
    expect(series('\\log_2(x)').latex).toBe(
      '\\frac{\\ln(x)}{\\ln(2)}+O\\left(x^7\\right)'
    );
  });

  test('ln(x²(1+x)) = 2 ln x + x − x²/2 + x³/3 − x⁴/4 + O(x⁵)', () => {
    // Cross-checked against SymPy: 2*log(x) + x - x**2/2 + x**3/3 - x**4/4.
    expect(series('\\ln(x^2(1+x))', '0', 4).latex).toBe(
      '2\\ln(x)+x-\\frac{x^2}{2}+\\frac{x^3}{3}-\\frac{x^4}{4}+O\\left(x^5\\right)'
    );
  });

  test('1/ln x at 0 stays unevaluated (reciprocal log)', () => {
    expect(series('\\frac{1}{\\ln x}').operator).toBe('Series');
  });

  test('ln(ln x) at 0 stays unevaluated (nested log)', () => {
    expect(series('\\ln(\\ln x)').operator).toBe('Series');
  });
});

//
// §9 Regression — a Puiseux-shaped Residue must defer, not return a wrong value
//

describe('Series — Puiseux/log Residue regression', () => {
  test('Residue of x^{-3/2} stays unevaluated', () => {
    const r = ce
      .function('Residue', [
        ce.parse('\\frac{1}{x\\sqrt{x}}'),
        ce.symbol('x'),
        ce.Zero,
      ])
      .evaluate();
    expect(r.operator).toBe('Residue');
  });
});
