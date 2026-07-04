import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

export const ce = new ComputeEngine();

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
  test('1/sin x at 0 stays unevaluated (pole; Laurent is Phase 2)', () => {
    const s = series('\\frac{1}{\\sin x}');
    expect(s.operator).toBe('Series');
  });

  test('e^{1/x} at 0 stays unevaluated (essential singularity)', () => {
    const s = series('e^{1/x}');
    expect(s.operator).toBe('Series');
  });

  test('deferred result equals its input (pill guard: no expansion)', () => {
    const input = ce.function('Series', [
      ce.parse('\\frac{1}{\\sin x}'),
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
});
