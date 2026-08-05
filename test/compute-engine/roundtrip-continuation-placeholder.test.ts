import { ComputeEngine } from '../../src/compute-engine';

/**
 * Serialize→parse round-trip of a `Multiply` carrying a
 * `ContinuationPlaceholder` (the symbol `\dots`/`\cdots` parses to inside an
 * `Add` or a `Multiply`).
 *
 * Two defects made such a product lossy (recorded in
 * `docs/mathnet/roundtrip-exceptions.json` as the classes
 * `continuation-placeholder-multiply-regroups` and
 * `continuation-placeholder-fraction-aggregation`):
 *
 *  - MIXED separators: the literal factors were juxtaposed while the ellipsis
 *    got an explicit `\times` (`ab\times\dots\times z`). On reparse the
 *    juxtaposed run binds tighter, yielding a NESTED `Multiply`.
 *  - FRACTION AGGREGATION: a product of rationals was merged into a single
 *    `\frac`, moving numerators and denominators ACROSS the ellipsis, so the
 *    reparse folded them together (`3/2·6/5·…·X` → `9/5·…·X`).
 *
 * The property is the one of `docs/mathnet/scripts/check-roundtrip.ts`:
 * `ce.parse(t.latex).isSame(t)` with a canonical parse on the SAME engine.
 */

/** `ce.parse(t.latex).isSame(t)` on a fresh engine. */
function roundTrips(latex: string): boolean {
  const ce = new ComputeEngine();
  const t = ce.parse(latex);
  return ce.parse(t.latex).isSame(t);
}

/** The LaTeX `latex` serializes to, on a fresh engine. */
function serialized(latex: string): string {
  return new ComputeEngine().parse(latex).latex;
}

describe('ROUND-TRIP: Multiply with a ContinuationPlaceholder', () => {
  test('a·b·…·z uses one uniform separator (no juxtaposed run)', () => {
    expect(serialized('a\\cdot b\\cdot\\dots\\cdot z')).toBe(
      'a\\times b\\times\\dots\\times z'
    );
    expect(roundTrips('a\\cdot b\\cdot\\dots\\cdot z')).toBe(true);
  });

  test('the reparse is a FLAT Multiply', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('a\\cdot b\\cdot\\dots\\cdot z');
    expect(ce.parse(e.latex).json).toEqual([
      'Multiply',
      'a',
      'b',
      'ContinuationPlaceholder',
      'z',
    ]);
  });

  test('corpus rows round-trip', () => {
    expect(roundTrips('A_0A_1\\cdots A_5')).toBe(true);
    expect(roundTrips('a_1 \\cdot a_2 \\cdot \\dots \\cdot a_n')).toBe(true);
    expect(
      roundTrips(
        'a_1^2 a_2^2 \\cdots a_n^2 - 4(a_1^2 + a_2^2 + \\cdots + a_n^2)'
      )
    ).toBe(true);
  });

  test('no fraction aggregation across the ellipsis', () => {
    const src =
      '(1+\\frac{1}{2})\\cdot(1+\\frac{1}{2+3})\\cdot\\dots\\cdot(1+\\frac{1}{n})';
    // Each rational factor keeps its own `\frac`; nothing is hoisted into a
    // single numerator/denominator.
    expect(serialized(src)).toBe(
      '\\frac{3}{2}\\times\\frac{6}{5}\\times\\dots\\times(\\frac{1}{n}+1)'
    );
    expect(roundTrips(src)).toBe(true);
  });

  test('Multiply(3/2, 6/5, …, X) does not fold 3·6/(2·5) on reparse', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\frac{3}{2}\\cdot\\frac{6}{5}\\cdot\\dots\\cdot X');
    expect(ce.parse(e.latex).json).toEqual([
      'Multiply',
      ['Rational', 3, 2],
      ['Rational', 6, 5],
      'ContinuationPlaceholder',
      'X',
    ]);
  });

  test('a product of quotient factors keeps one \\frac per factor', () => {
    // Aggregation here happens in the MathJSON pretty rewrite
    // (`serializePrettyJsonFunction`), not in the LaTeX dictionary: without the
    // barrier this serialized to the nonsensical `\frac{\dots}{abz}`.
    const src = '\\frac{1}{a}\\cdot\\frac{1}{b}\\cdot\\dots\\cdot\\frac{1}{z}';
    expect(serialized(src)).toBe(
      '\\frac{1}{a}\\times\\frac{1}{b}\\times\\dots\\times\\frac{1}{z}'
    );
    expect(roundTrips(src)).toBe(true);

    // Same for a negative-power factor.
    expect(serialized('x\\cdot\\dots\\cdot y^{-1}')).toBe(
      'x\\times\\dots\\times\\frac{1}{y}'
    );
    expect(roundTrips('x\\cdot\\dots\\cdot y^{-1}')).toBe(true);
  });

  test('the Add form still round-trips', () => {
    expect(roundTrips('a+b+\\dots+z')).toBe(true);
    expect(serialized('a+b+\\dots+z')).toBe('a+b+\\dots+z');
  });
});

describe('Products WITHOUT a ContinuationPlaceholder are unchanged', () => {
  test('juxtaposition and fraction aggregation are preserved', () => {
    expect(serialized('2xy')).toBe('2xy');
    expect(serialized('\\frac{1}{2}x')).toBe('\\frac{x}{2}');
    expect(serialized('3\\cdot\\frac{1}{2}')).toBe('\\frac{3}{2}');
    expect(serialized('2x^2y')).toBe('2yx^2');
    expect(serialized('\\frac{2x}{3y}')).toBe('\\frac{2x}{3y}');
    // Quotient factors are still aggregated into a single `\frac`.
    expect(serialized('\\frac{1}{a}\\cdot\\frac{1}{b}')).toBe('\\frac{1}{ab}');
    expect(serialized('x\\cdot y^{-1}')).toBe('\\frac{x}{y}');
    expect(serialized('\\frac{a}{b}\\cdot\\frac{c}{d}')).toBe('\\frac{ac}{bd}');
  });
});
