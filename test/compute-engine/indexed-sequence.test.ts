import { engine } from '../utils';

const ce = engine;

/**
 * Scripted-brace sequence notation `\{a_n\}_{n=1}^{\infty}` parses to the
 * inert `IndexedSequence(term, index, lower, upper?)` head.
 *
 * Design notes:
 *  - The `term` operand keeps the index in operator-call form (`["a_","n"]`)
 *    so the binding survives symbol fusion.
 *  - Only the *scripted* brace form triggers; a bare `\{a_n\}` stays a `Set`,
 *    and the parenthesized form `(a_n)_{n∈ℕ}` is untouched.
 */

describe('IndexedSequence parsing', () => {
  test('corpus shape 1: \\{a_n\\}_{n=1}^{\\infty}', () => {
    expect(ce.parse('\\{a_n\\}_{n=1}^{\\infty}').json).toEqual([
      'IndexedSequence',
      ['a_', 'n'],
      'n',
      1,
      'PositiveInfinity',
    ]);
  });

  test('corpus shape 2: \\{x_{n}\\}_{n=1}^{\\infty}', () => {
    expect(ce.parse('\\{x_{n}\\}_{n=1}^{\\infty}').json).toEqual([
      'IndexedSequence',
      ['x_', 'n'],
      'n',
      1,
      'PositiveInfinity',
    ]);
  });

  test('corpus shape 3: \\{c_i = a_i + b_{i+s}\\}_{i=1}^m (complex term)', () => {
    expect(ce.parse('\\{c_i = a_i + b_{i+s}\\}_{i=1}^m').json).toEqual([
      'IndexedSequence',
      ['Equal', ['c_', 'i'], ['Add', ['a_', 'i'], ['b_', ['Add', 'i', 's']]]],
      'i',
      1,
      'm',
    ]);
  });

  test('subscript-only form omits the upper bound', () => {
    expect(ce.parse('\\{a_n\\}_{n=1}').json).toEqual([
      'IndexedSequence',
      ['a_', 'n'],
      'n',
      1,
    ]);
  });

  test('n ∈ ℕ maps to lower bound 0 (NonNegativeIntegers least element)', () => {
    expect(ce.parse('\\{a_n\\}_{n\\in\\mathbb{N}}').json).toEqual([
      'IndexedSequence',
      ['a_', 'n'],
      'n',
      0,
    ]);
  });

  test('term not mentioning the index still triggers, term unchanged', () => {
    expect(ce.parse('\\{c\\}_{n=1}^{\\infty}').json).toEqual([
      'IndexedSequence',
      'c',
      'n',
      1,
      'PositiveInfinity',
    ]);
  });

  test('call-form term preserves the binding for a_{n+1}-style subscripts', () => {
    // The subscript `n+1` mentions the index, so the base is lifted to call
    // form `["a_", ["Add","n",1]]` (not the fused symbol).
    expect(ce.parse('\\{a_{n+1}\\}_{n=1}^{\\infty}').json).toEqual([
      'IndexedSequence',
      ['a_', ['Add', 'n', 1]],
      'n',
      1,
      'PositiveInfinity',
    ]);
  });

  test('script order ^ then _ produces the same result', () => {
    expect(ce.parse('\\{a_n\\}^{\\infty}_{n=1}').json).toEqual(
      ce.parse('\\{a_n\\}_{n=1}^{\\infty}').json
    );
  });

  test('\\left\\{...\\right\\} form parses identically', () => {
    expect(ce.parse('\\left\\{a_n\\right\\}_{n=1}^{\\infty}').json).toEqual(
      ce.parse('\\{a_n\\}_{n=1}^{\\infty}').json
    );
  });
});

describe('IndexedSequence non-triggers', () => {
  test('bare \\{a_n\\} stays a Set', () => {
    expect(ce.parse('\\{a_n\\}').json).toEqual(['Set', 'a_n']);
  });

  test('parenthesized (a_n)_{n∈ℕ} is untouched', () => {
    expect(ce.parse('(a_n)_{n\\in\\mathbb{N}}').json).toEqual([
      'Subscript',
      'a_n',
      ['Element', 'n', 'NonNegativeIntegers'],
    ]);
  });

  test('multi-element set with scripts does not trigger', () => {
    // A Set with more than one element is not a sequence term.
    expect(ce.parse('\\{1,2,3\\}^2').json).toEqual(['Power', ['Set', 1, 2, 3], 2]);
  });

  test('numeric subscript on a set does not trigger', () => {
    expect(ce.parse('\\{x\\}_2').json).toEqual(['Subscript', ['Set', 'x'], 2]);
  });
});

describe('IndexedSequence serialization', () => {
  test('LaTeX round-trips to the same MathJSON', () => {
    for (const s of [
      '\\{a_n\\}_{n=1}^{\\infty}',
      '\\{x_{n}\\}_{n=1}^{\\infty}',
      '\\{c_i = a_i + b_{i+s}\\}_{i=1}^m',
      '\\{a_n\\}_{n=1}',
    ]) {
      const e = ce.parse(s);
      const roundtrip = ce.parse(e.latex);
      expect(roundtrip.json).toEqual(e.json);
    }
  });

  test('AsciiMath toString is readable', () => {
    expect(ce.parse('\\{a_n\\}_{n=1}^{\\infty}').toString()).toBe(
      '{a_n : n = 1..+oo}'
    );
    expect(ce.parse('\\{a_n\\}_{n=1}').toString()).toBe('{a_n : n = 1..}');
  });
});

describe('IndexedSequence is inert', () => {
  test('evaluate stays symbolic', () => {
    const e = ce.parse('\\{a_n\\}_{n=1}^{\\infty}');
    expect(e.evaluate().json).toEqual(e.json);
  });

  test('simplify stays symbolic', () => {
    const e = ce.parse('\\{a_n\\}_{n=1}^{\\infty}');
    expect(e.simplify().json).toEqual(e.json);
  });
});
