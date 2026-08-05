import { ComputeEngine } from '../../src/compute-engine';

/**
 * Serialize→parse round-trip of two lossy forms recorded in
 * `docs/mathnet/roundtrip-exceptions.json`:
 *
 *  - `operator-symbol-serializes-empty`: a symbol whose name is an OPERATOR
 *    (`Add`, `Multiply`, …) used as a VALUE serialized to the empty string,
 *    because the LaTeX definition of the operator was asked to serialize an
 *    application with no operands. The operand was silently deleted:
 *    `(A,+)` → `Tuple(A, Add)` → `(A,)` → `Tuple(A)`.
 *  - `singleton-tuple-dropped`: a one-element `Tuple` (serialized from the
 *    `Single` MathJSON shorthand) came out as `(x)`, which re-parses as the
 *    plain expression `x`.
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

describe('ROUND TRIP: operator name used as a value', () => {
  const ce = new ComputeEngine();

  test('a bare operator symbol does not serialize to the empty string', () => {
    expect(ce.box('Add', { canonical: false }).toLatex()).toBe('\\mathrm{Add}');
    expect(ce.box('Multiply', { canonical: false }).toLatex()).toBe(
      '\\mathrm{Multiply}'
    );
  });

  test('the emission re-parses to the same symbol', () => {
    expect(ce.parse('\\mathrm{Add}').json).toBe('Add');
    expect(ce.parse('\\mathrm{Multiply}').json).toBe('Multiply');
  });

  test('operator symbols survive as tuple operands', () => {
    expect(ce.box(['Tuple', 'A', 'Add']).toLatex()).toBe('(A,\\mathrm{Add})');
    expect(ce.parse('(A,+)').json).toEqual(['Tuple', 'A', 'Add']);
    expect(ce.parse('(A,+)').toLatex()).toBe('(A,\\mathrm{Add})');
  });

  // The three corpus rows of the `operator-symbol-serializes-empty` class
  test.each(['(A,+)', '(A,+, \\cdot)', '(K, +, \\cdot)'])(
    'round trips: %s',
    (latex) => expect(roundTrips(latex)).toBe(true)
  );
});

describe('ROUND TRIP: singleton tuple', () => {
  const ce = new ComputeEngine();

  test('a one-element tuple keeps its trailing comma', () => {
    expect(ce.parse('(x,)').toLatex()).toBe('(x,)');
    expect(ce.parse('x=1,').toLatex()).toBe('(x=1,)');
  });

  test('the emission re-parses to a tuple, not to its element', () => {
    expect(ce.parse('(x,)').json).toEqual(['Tuple', 'x']);
    expect(ce.parse('(x=1,)').json).toEqual(['Tuple', ['Equal', 'x', 1]]);
  });

  test('a parenthesized expression is still not a tuple', () => {
    expect(ce.parse('(x)').json).toBe('x');
    expect(ce.parse('(x)').toLatex()).toBe('x');
  });

  test('tuples of two or more elements are unchanged', () => {
    expect(ce.parse('(a,b)').toLatex()).toBe('(a,b)');
    expect(ce.parse('(a,b,c)').toLatex()).toBe('(a,b,c)');
  });

  test.each(['(x,)', 'x=1,'])('round trips: %s', (latex) =>
    expect(roundTrips(latex)).toBe(true)
  );
});
