import { ComputeEngine } from '../../src/compute-engine';

/**
 * Ellipsis fold barrier.
 *
 * An `Add`/`Multiply` whose operands include the symbol
 * `ContinuationPlaceholder` (produced by parsing `\dots`/`\ldots`/`\cdots` in a
 * sum or product) is a *notational* object, not an arithmetic one. It must not
 * fold numeric literals across the continuation, must preserve source operand
 * order and nested operand structure (anchors like `2n`), and must stay inert
 * under `evaluate()`/`.N()`/`simplify()`.
 */

// A fresh engine per suite avoids cross-test symbol retyping.
const ce = new ComputeEngine();

describe('Continuation placeholder (ellipsis fold barrier)', () => {
  test('Add: 1 + 2 + … + n does not fold or reorder', () => {
    const e = ce.parse('1 + 2 + \\dots + n');
    expect(e.json).toEqual(['Add', 1, 2, 'ContinuationPlaceholder', 'n']);
  });

  test('Add: evaluate() and N() are inert', () => {
    const e = ce.parse('1 + 2 + \\dots + n');
    expect(e.evaluate().json).toEqual([
      'Add',
      1,
      2,
      'ContinuationPlaceholder',
      'n',
    ]);
    expect(e.N().json).toEqual(['Add', 1, 2, 'ContinuationPlaceholder', 'n']);
  });

  test('Add: simplify() is inert', () => {
    const e = ce.parse('1 + 2 + \\dots + n');
    expect(e.simplify().json).toEqual([
      'Add',
      1,
      2,
      'ContinuationPlaceholder',
      'n',
    ]);
  });

  test('Multiply: 2 · 4 · … · 2n preserves order and the 2n anchor', () => {
    const e = ce.parse('2 \\cdot 4 \\cdot \\dots \\cdot 2n');
    expect(e.json).toEqual([
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });

  test('Multiply: evaluate() and N() are inert (anchor intact)', () => {
    const e = ce.parse('2 \\cdot 4 \\cdot \\dots \\cdot 2n');
    const expected = [
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ];
    expect(e.evaluate().json).toEqual(expected);
    expect(e.N().json).toEqual(expected);
  });

  test('Multiply: simplify() is inert (anchor intact)', () => {
    const e = ce.parse('2 \\cdot 4 \\cdot \\dots \\cdot 2n');
    expect(e.simplify().json).toEqual([
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });

  test('LaTeX round-trip preserves the continuation and structure', () => {
    const e = ce.parse('1 + 2 + \\dots + n');
    expect(e.latex).toContain('\\dots');
    // Serialize, then re-parse to the same structure.
    const reparsed = ce.parse(e.latex);
    expect(reparsed.json).toEqual(['Add', 1, 2, 'ContinuationPlaceholder', 'n']);
  });

  test('Multiply round-trips through LaTeX (numeric 2n anchor)', () => {
    const e = ce.parse('2 \\cdot 4 \\cdot \\dots \\cdot 2n');
    // The serializer must emit an explicit separator around the ellipsis so it
    // does not merge with an adjacent factor (juxtaposition reparses as Range).
    const reparsed = ce.parse(e.latex);
    expect(reparsed.json).toEqual([
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });

  test('Multiply round-trips through LaTeX (bare symbol n anchor)', () => {
    const e = ce.parse('2 \\cdot 4 \\cdot \\dots \\cdot n');
    const reparsed = ce.parse(e.latex);
    expect(reparsed.json).toEqual([
      'Multiply',
      2,
      4,
      'ContinuationPlaceholder',
      'n',
    ]);
  });

  test('AsciiMath prints the ellipsis', () => {
    const e = ce.parse('1 + 2 + \\dots + n');
    expect(e.toString()).toBe('1 + 2 + ... + n');
  });

  test('Nested: x + (1 + 2 + … + n) stays inert (order may differ)', () => {
    const e = ce.parse('x + (1 + 2 + \\dots + n)');
    // The inner continuation-bearing Add is lifted by flatten, but the fold is
    // still skipped: no numeric literals are combined and the placeholder is
    // preserved.
    const json = e.json as unknown[];
    expect(json[0]).toBe('Add');
    expect(json).toContain('ContinuationPlaceholder');
    expect(json).toContain('n');
    expect(json).toContain('x');
    expect(json).toContain(1);
    expect(json).toContain(2);
    // Crucially: 1 and 2 are NOT folded into 3.
    expect(json).not.toContain(3);
  });

  test('Negate: -(2 · 4 · … · 2n) does not fold across the continuation', () => {
    const e = ce.parse('-(2 \\cdot 4 \\cdot \\dots \\cdot 2n)');
    // The parsed form keeps the notational product wrapped in Negate.
    expect(e.json).toEqual([
      'Negate',
      ['Multiply', 2, 4, 'ContinuationPlaceholder', ['Multiply', 2, 'n']],
    ]);
    // Evaluating distributes the sign into the leading coefficient but the
    // placeholder and the elided terms are still not folded together.
    const ev = e.evaluate().json as unknown[];
    expect(ev[0]).toBe('Multiply');
    expect(ev).toContain('ContinuationPlaceholder');
  });

  test('List → Range inference is unaffected', () => {
    // A List with an ellipsis is a separate (Range) path and must keep working.
    expect(ce.parse('[1, 2, \\ldots, 10]').json).toEqual(['Range', 1, 10, 1]);
  });
});
