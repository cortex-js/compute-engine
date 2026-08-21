import { ComputeEngine } from '../../src/compute-engine';

/**
 * The engine used to have TWO canonical spellings of the imaginary unit: the
 * complex literal `["Complex", 0, 1]` (what bare `i` parsed to) and the symbol
 * `"ImaginaryUnit"` (what `\imaginaryI` parsed to). Since the serializer emits
 * `\imaginaryI` for both, `ce.parse('i')` did not round-trip.
 *
 * Ruling: `["Complex", 0, 1]` is THE canonical spelling. The `ImaginaryUnit`
 * symbol is declared with `holdUntil: 'never'`, so canonicalizing it must
 * substitute its value. Raw MathJSON `"ImaginaryUnit"` remains reachable
 * non-canonically.
 */
describe('imaginary unit: one canonical spelling', () => {
  const ce = new ComputeEngine();

  test('parse route: `i` and `\\imaginaryI` agree', () => {
    const a = ce.parse('i');
    const b = ce.parse('\\imaginaryI');
    expect(a.json).toEqual(['Complex', 0, 1]);
    expect(b.json).toEqual(['Complex', 0, 1]);
    expect(a.isSame(b)).toBe(true);
  });

  test('parse route: `\\mathrm{i}` and `\\operatorname{i}` agree', () => {
    expect(ce.parse('\\mathrm{i}').json).toEqual(['Complex', 0, 1]);
    expect(ce.parse('\\operatorname{i}').json).toEqual(['Complex', 0, 1]);
  });

  test('box route: `ImaginaryUnit` canonicalizes to Complex(0, 1)', () => {
    expect(ce.box('ImaginaryUnit').canonical.json).toEqual(['Complex', 0, 1]);
    expect(ce.symbol('ImaginaryUnit').json).toEqual(['Complex', 0, 1]);
    expect(ce.expr('ImaginaryUnit').json).toEqual(['Complex', 0, 1]);
  });

  test('all three routes agree structurally', () => {
    const fromLatex = ce.parse('i');
    const fromCommand = ce.parse('\\imaginaryI');
    const fromJson = ce.box('ImaginaryUnit').canonical;
    expect(fromLatex.isSame(fromCommand)).toBe(true);
    expect(fromLatex.isSame(fromJson)).toBe(true);
    expect(fromJson.isSame(ce.I)).toBe(true);
  });

  test('raw MathJSON `ImaginaryUnit` stays a symbol non-canonically', () => {
    expect(ce.box('ImaginaryUnit', { canonical: false }).json).toBe(
      'ImaginaryUnit'
    );
  });

  test('round-trips through LaTeX', () => {
    for (const latex of ['i', '\\imaginaryI']) {
      const expr = ce.parse(latex);
      expect(expr.toLatex()).toBe('\\imaginaryI');
      expect(ce.parse(expr.toLatex()).isSame(expr)).toBe(true);
    }
    // The serializer still emits `\imaginaryI` for the complex literal
    expect(ce.I.toLatex()).toBe('\\imaginaryI');
    expect(ce.box('ImaginaryUnit').canonical.toLatex()).toBe('\\imaginaryI');
  });

  test('arithmetic is unaffected', () => {
    expect(ce.parse('i^2').evaluate().json).toBe(-1);
    expect(ce.parse('\\imaginaryI^2').evaluate().json).toBe(-1);
    expect(ce.parse('\\frac{1}{i}').evaluate().json).toEqual([
      'Complex',
      0,
      -1,
    ]);
    expect(ce.parse('e^{i\\pi}').evaluate().json).toBe(-1);
    expect(ce.parse('(2+3i)(1-i)').evaluate().json).toEqual(['Complex', 5, 1]);
    expect(ce.parse('2i').json).toEqual(['Complex', 0, 2]);
    expect(ce.expr(['Multiply', 3, 'ImaginaryUnit']).json).toEqual([
      'Complex',
      0,
      3,
    ]);
    expect(ce.expr(['Negate', 'ImaginaryUnit']).json).toEqual([
      'Complex',
      0,
      -1,
    ]);
  });

  test('the symbol still has a definition (documentation/type surface)', () => {
    expect(ce.symbolInfo('ImaginaryUnit')).toBeDefined();
  });
});

/**
 * `ce.I` — the interned imaginary unit every spelling resolves to — used to be
 * built from `{ im: 1 }`, which `_numericValue()` turns into an *inexact*
 * Big/Machine value, whereas the `["Complex", 0, 1]` literal boxes to an
 * ExactNumericValue. Exactness-gated folds (`canonicalPower`) then declined on
 * one route and fired on the other: `Power(ImaginaryUnit, 2)` stayed `i^2`
 * while `Power(Complex(0,1), 2)` folded to `-1`, so canonicalization was not
 * idempotent across a `.json` round-trip.
 */
describe('imaginary unit: the interned value is exact', () => {
  const ce = new ComputeEngine();

  test('`ce.I` is exact, like the Complex literal', () => {
    expect(ce.I.isExact).toBe(true);
    expect(ce.box(['Complex', 0, 1]).isExact).toBe(true);
    expect(ce.I.isSame(ce.box(['Complex', 0, 1]))).toBe(true);
  });

  test('powers fold identically on the symbol and literal routes', () => {
    const expected = {
      '-2': -1,
      '-1': ['Complex', 0, -1],
      1: ['Complex', 0, 1],
      2: -1,
      3: ['Complex', 0, -1],
      4: 1,
      5: ['Complex', 0, 1],
    };
    for (const [n, json] of Object.entries(expected)) {
      const exponent = Number(n);
      expect(ce.box(['Power', 'ImaginaryUnit', exponent]).json).toEqual(json);
      expect(ce.box(['Power', ['Complex', 0, 1], exponent]).json).toEqual(json);
      expect(ce.parse(`i^{${exponent}}`).json).toEqual(json);
    }
  });

  test('canonicalization is idempotent across a JSON round-trip', () => {
    for (const expr of [
      ce.box(['Power', 'ImaginaryUnit', 2]),
      ce.box(['Power', 'ImaginaryUnit', 3]),
      ce.parse('i^2'),
      ce.parse('\\imaginaryI^3'),
      ce.parse('(1+i)^2'),
    ]) {
      expect(ce.box(expr.json).json).toEqual(expr.json);
    }
  });

  test('simplify() folds small powers of i', () => {
    expect(ce.parse('i^2').simplify().json).toBe(-1);
    expect(ce.parse('i^3').simplify().json).toEqual(['Complex', 0, -1]);
    expect(ce.parse('i^4').simplify().json).toBe(1);
    expect(ce.box(['Power', 'ImaginaryUnit', 2]).simplify().json).toBe(-1);
  });

  /**
   * The `n·i` promotion in `canonicalMultiply` (an integer/rational/radical
   * followed by the imaginary unit folds to an exact pure-imaginary literal)
   * used to accept a NON-finite left operand and build a value out of an
   * infinite component: `Multiply(+∞, i)` collapsed to `NaN` at
   * canonicalization while `Multiply(i, +∞)` stayed symbolic. Infinities are
   * excluded from folding (see the canonicalization contract), so both
   * operand orders must keep the product symbolic.
   *
   * `evaluate()` answers `~oo`: the product is infinite with no real direction
   * left, and the engine's single point at infinity represents exactly that.
   * It is not the indeterminate form, which is reserved for `0 · ∞`.
   */
  test('a product of an infinity and i stays symbolic in both orders', () => {
    for (const [a, b] of [
      ['PositiveInfinity', 'ImaginaryUnit'],
      ['ImaginaryUnit', 'PositiveInfinity'],
      ['PositiveInfinity', ['Complex', 0, 1]],
      [['Complex', 0, 1], 'PositiveInfinity'],
      ['NegativeInfinity', 'ImaginaryUnit'],
      ['ImaginaryUnit', 'NegativeInfinity'],
    ] as const) {
      const e = ce.box(['Multiply', a, b] as any);
      expect(e.operator).toBe('Multiply');
      expect(e.isNaN).not.toBe(true);
      // `evaluate()` reaches the one point at infinity, on every route
      expect(e.evaluate().json).toBe('ComplexInfinity');
    }
  });

  test('a sum of an infinity and i stays symbolic in both orders', () => {
    for (const [a, b] of [
      ['PositiveInfinity', 'ImaginaryUnit'],
      ['ImaginaryUnit', 'PositiveInfinity'],
      ['PositiveInfinity', ['Complex', 0, 1]],
    ] as const) {
      const e = ce.box(['Add', a, b] as any);
      expect(e.json).toEqual(['Add', 'PositiveInfinity', ['Complex', 0, 1]]);
      expect(e.evaluate().json).toBe('PositiveInfinity');
    }
  });

  test('the finite n·i promotion still folds', () => {
    expect(ce.box(['Multiply', 2, 'ImaginaryUnit']).json).toEqual([
      'Complex',
      0,
      2,
    ]);
    expect(ce.box(['Multiply', ['Rational', 1, 2], 'ImaginaryUnit']).json)
      .toEqual(['Complex', 0, ['Rational', 1, 2]]);
    expect(ce.box(['Multiply', ['Sqrt', 2], 'ImaginaryUnit']).json).toEqual([
      'Complex',
      0,
      ['Sqrt', 2],
    ]);
    expect(ce.box(['Multiply', 0.5, 'ImaginaryUnit']).json).toEqual([
      'Complex',
      0,
      0.5,
    ]);
  });

  test('the exactness contract still holds for i', () => {
    // A transcendental of an exact argument stays symbolic under evaluate()
    // and numericizes only under N().
    expect(ce.parse('\\sqrt{i}').evaluate().operator).toBe('Sqrt');
    expect(ce.parse('\\sqrt{i}').N().im).toBeCloseTo(Math.SQRT1_2, 10);
    expect(ce.parse('\\ln(i)').evaluate().operator).toBe('Ln');
    expect(ce.parse('\\ln(i)').N().im).toBeCloseTo(Math.PI / 2, 10);
    // An inexact operand still numericizes
    expect(ce.parse('1.5i').json).toEqual(['Complex', 0, 1.5]);
  });
});
