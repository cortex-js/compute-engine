import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for three LaTeX parse recoveries surfaced by the
 * Hendrycks-MATH genre sweep (docs/mathnet/math-genre-sweep.md,
 * docs/mathnet/math-genre-failures.json):
 *
 *   1. Ordinal superscripts (`13^{\text{th}}`, `21^{\text{st}}`, `k^\text{th}`):
 *      the superscript is typographic decoration (an ordinal number written in
 *      LaTeX), not a power, so it devolves to the base.
 *   2. Empty scripts (`x^{}`, `x_{}`, `0^{}_{}`): the empty script is dropped
 *      and the base returned.
 *   3. `{,}` thousands separator (`1{,}000`): the LaTeX thin thousands
 *      separator between digits combines into a single number.
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

describe('Genre recovery: ordinal superscripts', () => {
  test('numeric base with braced ordinal suffix devolves to the base', () => {
    const ce = freshEngine();
    expect(ce.parse('13^{\\text{th}}').json).toEqual(13);
    expect(ce.parse('21^{\\text{st}}').json).toEqual(21);
    expect(ce.parse('2^{\\text{nd}}').json).toEqual(2);
    expect(ce.parse('3^{\\text{rd}}').json).toEqual(3);
    expect(ce.parse('50^{\\text{th}}').json).toEqual(50);
    expect(ce.parse('799^{\\text{th}}').json).toEqual(799);
  });

  test('unbraced ordinal suffix (`^\\text{th}`) devolves to the base', () => {
    const ce = freshEngine();
    expect(ce.parse('100^\\text{th}').json).toEqual(100);
    expect(ce.parse('24^\\text{th}').json).toEqual(24);
  });

  test('`\\mbox` ordinal suffix devolves to the base', () => {
    const ce = freshEngine();
    expect(ce.parse('30^{\\mbox{th}}').json).toEqual(30);
  });

  test('symbol base with ordinal suffix devolves to the base symbol', () => {
    const ce = freshEngine();
    expect(ce.parse('k^\\text{th}').json).toEqual('k');
    expect(ce.parse('n^{\\text{th}}').json).toEqual('n');
  });

  test('ordinal suffix is case-insensitive', () => {
    const ce = freshEngine();
    expect(ce.parse('1^{\\text{St}}').json).toEqual(1);
    expect(ce.parse('2^{\\text{Nd}}').json).toEqual(2);
  });

  test('NEGATIVE: a real numeric superscript is unchanged', () => {
    const ce = freshEngine();
    expect(ce.parse('13^{2}').json).toEqual(169);
  });

  test('NEGATIVE: non-ordinal text superscript is unchanged', () => {
    const ce = freshEngine();
    // `\text{m}` parses as the symbol `m`, so this stays a Power.
    expect(ce.parse('x^{\\text{m}}').json).toEqual(['Power', 'x', 'm']);
    // A non-suffix multi-letter text run is not an ordinal.
    const j = JSON.stringify(ce.parse('x^{\\text{abc}}').json);
    expect(j).toContain('Power');
  });
});

describe('Genre recovery: empty scripts', () => {
  test('empty superscript is dropped', () => {
    const ce = freshEngine();
    expect(ce.parse('x^{}').json).toEqual('x');
    expect(ce.parse('300^{}').json).toEqual(300);
  });

  test('empty subscript is dropped (numeric and single-letter bases)', () => {
    const ce = freshEngine();
    expect(ce.parse('x_{}').json).toEqual('x');
    expect(ce.parse('A_{}').json).toEqual('A');
    expect(ce.parse('z_{}').json).toEqual('z');
  });

  test('both empty scripts are dropped (`base^{}_{}`)', () => {
    const ce = freshEngine();
    expect(ce.parse('0^{}_{}').json).toEqual(0);
    expect(ce.parse('36^{}_{}').json).toEqual(36);
    expect(ce.parse('596^{}_{}').json).toEqual(596);
    expect(ce.parse('A^{}_{}').json).toEqual('A');
    expect(ce.parse('z^{}_{}').json).toEqual('z');
    expect(ce.parse('k^{}_{}').json).toEqual('k');
  });

  test('empty scripts drop inside a fraction (from corpus)', () => {
    const ce = freshEngine();
    expect(isClean(ce, '\\frac{z^{}_{}}{40}')).toBe(true);
    expect(isClean(ce, '\\frac{40^{}_{}}{\\overline{z}}')).toBe(true);
  });

  test('NEGATIVE: a non-empty subscript is unchanged', () => {
    const ce = freshEngine();
    expect(ce.parse('x_{max}').json).toEqual('x_max');
    expect(ce.parse('x_{12}').json).toEqual('x_12');
  });
});

describe('Genre recovery: `{,}` thousands separator', () => {
  test('`{,}` between digits combines into one number', () => {
    const ce = freshEngine();
    expect(ce.parse('1{,}000').json).toEqual(1000);
    expect(ce.parse('18{,}360').json).toEqual(18360);
    expect(ce.parse('1{,}008{,}016').json).toEqual(1008016);
    expect(ce.parse('130{,}000').json).toEqual(130000);
  });

  test('NEGATIVE: plain `1,000` is unchanged (comma not a group separator)', () => {
    const ce = freshEngine();
    expect(ce.parse('1,000').json).toEqual(['Tuple', 1, 0]);
  });

  test('NEGATIVE: `{,}` not between digits keeps its existing behavior', () => {
    const ce = freshEngine();
    // A trailing `{,}` (no following digit) does not combine — the number is
    // just `1`, and the stray `{,}` still errors as before.
    expect(isClean(ce, '1{,}x')).toBe(false);
    expect(isClean(ce, '3{,}')).toBe(false);
  });
});

describe('Genre recovery: prime after a juxtaposed function argument', () => {
  // `a'` denotes a primed variable; the implicit trig argument must accept
  // it. Previously `\sin a'` produced Sin(Error) because Prime's result
  // type (`expression`) failed Sin's `number` parameter check — Prime now
  // mirrors the type of its base.
  test("\\sin a' parses to Sin(Prime(a))", () => {
    const ce = freshEngine();
    expect(ce.parse("\\sin a'").json).toEqual(['Sin', ['Prime', 'a']]);
    expect(ce.parse("2 \\sin a'").json).toEqual([
      'Multiply',
      2,
      ['Sin', ['Prime', 'a']],
    ]);
  });

  test("prime does not swallow a following function: \\sin a' \\cos a'", () => {
    const ce = freshEngine();
    expect(ce.parse("2 \\sin a' \\cos a'").json).toEqual([
      'Multiply',
      2,
      ['Sin', ['Prime', 'a']],
      ['Cos', ['Prime', 'a']],
    ]);
  });

  test('corpus equation shape with trailing period', () => {
    const ce = freshEngine();
    expect(ce.parse("\\cos a = \\cos a'.").json).toEqual([
      'Equal',
      ['Cos', 'a'],
      ['Cos', ['Prime', 'a']],
    ]);
  });

  test("NEGATIVE: derivative notation f'(x) is unchanged", () => {
    const ce = freshEngine();
    expect(ce.parse("f'(x)").json).toEqual(['D', ['f', 'x'], 'x']);
    expect(ce.parse("a''").json).toEqual(['Prime', 'a', 2]);
  });
});

describe('Genre recovery: empty subscript on multi-letter symbols', () => {
  test('\\alpha_{} drops the empty subscript', () => {
    const ce = freshEngine();
    expect(ce.parse('\\alpha_{}').json).toEqual('alpha');
  });

  test('NEGATIVE: real subscripts on multi-letter symbols unchanged', () => {
    const ce = freshEngine();
    expect(ce.parse('\\alpha_{3}').json).toEqual('alpha_3');
    // strict-mode missing-subscript shape is preserved
    expect(ce.parse('a_(k+m)').json).toEqual([
      'Tuple',
      ['Subscript', 'a', ['Error', "'missing'"]],
      ['Add', 'k', 'm'],
    ]);
  });
});
