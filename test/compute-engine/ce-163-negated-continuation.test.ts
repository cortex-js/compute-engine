import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// CE-163: a negated sum or product with an ellipsis is a notational object.
// `simplify()` must not fold its samples across the ellipsis, and the
// negation must keep the order of the pattern.
describe('CE-163 negation of a sum or product with an ellipsis', () => {
  test('simplify() does not fold -(2 · 4 · … · 2n)', () => {
    const e = ce.parse('-(2 \\cdot 4 \\cdot \\dots \\cdot 2n)');
    const json = JSON.stringify(e.simplify().json);
    expect(json).toContain('ContinuationPlaceholder');
    expect(json).not.toContain('16');
    // The sign goes to the first factor, as under evaluate().
    expect(e.simplify().json).toEqual(e.evaluate().json);
    expect(e.simplify().json).toEqual([
      'Multiply',
      -2,
      4,
      'ContinuationPlaceholder',
      ['Multiply', 2, 'n'],
    ]);
  });

  test('-(1 + 2 + … + n) keeps the order of its terms', () => {
    const e = ce.parse('-(1 + 2 + \\dots + n)');
    const expected = [
      'Add',
      -1,
      -2,
      ['Negate', 'ContinuationPlaceholder'],
      ['Negate', 'n'],
    ];
    expect(e.evaluate().json).toEqual(expected);
    expect(e.simplify().json).toEqual(expected);
  });
});
