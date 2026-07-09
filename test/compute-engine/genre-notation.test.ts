import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the Hendrycks-MATH genre sweep notation gaps
 * (docs/mathnet/math-genre-sweep.md):
 *   1. `\cancel{…}` / `\cancelto{…}{…}` (cancel.sty) strike-through
 *      decorations: unwrapped (target value for `\cancelto`).
 *   2. `\not`-prefixed relations (`\not=`, `\not\in`, `\not\equiv`, …):
 *      composed into the negated relation.
 *
 * A fresh engine is used per suite so accumulated free-symbol type inference
 * (shared across `parse()` calls on one engine) can't cross-contaminate.
 */

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

function isClean(ce: ComputeEngine, s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

describe('Genre notation: \\cancel / \\cancelto', () => {
  test('\\cancel{72} unwraps to its body', () => {
    const ce = freshEngine();
    expect(ce.parse('\\cancel{72}').json).toEqual(72);
  });

  test('\\cancel unwraps inside a fraction (from corpus)', () => {
    const ce = freshEngine();
    // \frac{4 \cdot \cancel{3}}{\cancel{3} \cdot 2} = \frac{12}{6} = 2
    expect(
      ce.parse('\\frac{4 \\cdot \\cancel{3}}{\\cancel{3} \\cdot 2}').json
    ).toEqual(2);
  });

  test('\\cancel{ab} unwraps a compound body', () => {
    const ce = freshEngine();
    expect(ce.parse('\\cancel{ab}').json).toEqual(['Multiply', 'a', 'b']);
  });

  test('\\bcancel and \\xcancel unwrap like \\cancel', () => {
    const ce = freshEngine();
    expect(ce.parse('\\bcancel{5}').json).toEqual(5);
    expect(ce.parse('\\xcancel{7}').json).toEqual(7);
  });

  test('\\cancelto{4}{72} keeps the target value (4)', () => {
    const ce = freshEngine();
    expect(ce.parse('\\cancelto{4}{72}').json).toEqual(4);
  });

  test('\\cancelto{4}{8}x → 4x (target replaces the cancelled term)', () => {
    const ce = freshEngine();
    // From corpus: \frac{\cancelto{4}{8}...}{\cancelto{3}{6}...}=\frac{4y}{3x}
    expect(ce.parse('\\cancelto{4}{8}x').json).toEqual(['Multiply', 4, 'x']);
  });
});

describe('Genre notation: \\not-prefixed relations', () => {
  test('\\not= composes to NotEqual', () => {
    const ce = freshEngine();
    expect(ce.parse('d \\not= 0').json).toEqual(['NotEqual', 'd', 0]);
    expect(ce.parse('a \\not= b').json).toEqual(['NotEqual', 'a', 'b']);
  });

  test('\\not\\in composes to NotElement', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\not\\in B').json).toEqual(['NotElement', 'a', 'B']);
  });

  test('\\not\\subset / \\not\\supset compose to NotSubset / NotSuperset', () => {
    const ce = freshEngine();
    expect(ce.parse('A \\not\\subset B').json).toEqual([
      'NotSubset',
      'A',
      'B',
    ]);
    expect(ce.parse('A \\not\\supset B').json).toEqual([
      'NotSuperset',
      'A',
      'B',
    ]);
  });

  test('\\not\\equiv negates a congruence (from corpus)', () => {
    const ce = freshEngine();
    expect(ce.parse('2019^8 \\not\\equiv -1 \\pmod{17}').json).toEqual([
      'Not',
      ['Congruent', ['Power', 2019, 8], -1, 17],
    ]);
  });

  test('\\not\\equiv negates an equivalence when no modulus follows', () => {
    const ce = freshEngine();
    expect(ce.parse('p \\not\\equiv q').json).toEqual([
      'Not',
      ['Equivalent', 'p', 'q'],
    ]);
  });

  // Not-wrap fallback: relations with no dedicated negated head are wrapped
  // in an explicit `Not`.
  test('\\not\\le / \\not\\subseteq use the Not-wrap fallback', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\not\\le b').json).toEqual([
      'Not',
      ['LessEqual', 'a', 'b'],
    ]);
    expect(ce.parse('A \\not\\subseteq B').json).toEqual([
      'Not',
      ['SubsetEqual', 'A', 'B'],
    ]);
  });

  test('all \\not compositions parse without Error', () => {
    const ce = freshEngine();
    for (const s of [
      'd \\not= 0',
      'a \\not\\in B',
      'A \\not\\subset B',
      'A \\not\\supset B',
      'a \\not\\le b',
      'a \\not\\ge b',
      'A \\not\\subseteq B',
      '2019^8 \\not\\equiv -1 \\pmod{17}',
    ]) {
      expect(isClean(ce, s)).toBe(true);
    }
  });

  // Negative guard: the pre-existing standalone negated commands still parse
  // to the same heads (the \not compositions must not shadow them).
  test('plain \\neq / \\notin / \\ne still work', () => {
    const ce = freshEngine();
    expect(ce.parse('a \\neq b').json).toEqual(['NotEqual', 'a', 'b']);
    expect(ce.parse('a \\ne b').json).toEqual(['NotEqual', 'a', 'b']);
    expect(ce.parse('a \\notin B').json).toEqual(['NotElement', 'a', 'B']);
  });

  test('congruence without \\not is unaffected', () => {
    const ce = freshEngine();
    expect(ce.parse('n \\equiv b \\pmod{12}').json).toEqual([
      'Congruent',
      'n',
      'b',
      12,
    ]);
    expect(ce.parse('p \\equiv q').json).toEqual(['Equivalent', 'p', 'q']);
  });
});

describe('Genre notation: standalone \\pmod', () => {
  // A standalone `\pmod{7}` has no left operand: the modulus must be the
  // SECOND argument of Mod, with a missing-error placeholder first (it used
  // to parse as Mod(7, missing), flipping the operands).
  test('standalone \\pmod{7} puts the modulus second', () => {
    const ce = freshEngine();
    expect(ce.parse('\\pmod{7}').json).toEqual([
      'Mod',
      ['Error', "'missing'"],
      7,
    ]);
  });

  test('infix and congruence \\pmod forms are unaffected', () => {
    const ce = freshEngine();
    expect(ce.parse('5 \\pmod 3').json).toEqual(['Mod', 5, 3]);
    expect(ce.parse('a \\equiv b \\pmod{7}').json).toEqual([
      'Congruent',
      'a',
      'b',
      7,
    ]);
  });
});
