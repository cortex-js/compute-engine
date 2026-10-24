/**
 * `Sum` and `Product` accept the iterator specifications that `Table`
 * accepts (user decision of 2026-10-18):
 *
 * - the Mathematica iterator `{i, n}`, `i` from 1 to `n`, in each spelling:
 *   a `Set` (`\{i, n\}` in LaTeX), a `Tuple` or a `Pair`;
 * - the parenthesized tuple `(i, 1, 10)` that the LaTeX parser gives as
 *   `Delimiter(Sequence(i, 1, 10), "(,)")` in a held operand.
 *
 * Before:
 * - `Sum(k^2, {k, 3})` was `Error("missing")` and `Sum(k^2, (k, 3))` was a
 *   sum with one bound, `Limits(k, Nothing, 3)`, which stays unevaluated.
 * - `\mathrm{Sum}(i, (i,1,10))` was `Sum(Complex(0, 1), Error("missing"))`:
 *   the binder did not declare `i`, so it was the imaginary unit.
 * - `\mathrm{Integrate}(x, (x,0,1))` dropped the bounds without a
 *   diagnostic and gave the indefinite integral.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('THE ITERATOR {i, n}', () => {
  test('Sum(k^2, {k, 3}) is 14', () => {
    const e = ce.box(['Sum', ['Power', 'k', 2], ['Set', 'k', 3]]);
    expect(e.json).toEqual(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]]);
    expect(e.evaluate().json).toBe(14);
  });

  test('Product(k, {k, 4}) is 24', () => {
    expect(ce.box(['Product', 'k', ['Set', 'k', 4]]).evaluate().json).toBe(24);
  });

  test('the Tuple and Pair spellings', () => {
    expect(
      ce.box(['Sum', ['Power', 'k', 2], ['Tuple', 'k', 3]]).evaluate().json
    ).toBe(14);
    expect(ce.box(['Product', 'k', ['Pair', 'k', 4]]).evaluate().json).toBe(24);
  });

  test('the ce.function route', () => {
    const spec = ce.function('Set', [ce.symbol('k'), ce.number(3)], {
      form: 'raw',
    });
    expect(ce.function('Sum', [ce.parse('k^2'), spec]).evaluate().json).toBe(
      14
    );
  });

  test('the LaTeX spellings', () => {
    expect(ce.parse('\\mathrm{Sum}(k^2, \\{k, 3\\})').evaluate().json).toBe(14);
    expect(ce.parse('\\mathrm{Sum}(k^2, (k, 3))').evaluate().json).toBe(14);
    expect(ce.parse('\\mathrm{Product}(k, (k, 4))').evaluate().json).toBe(24);
  });

  test('a symbolic upper bound', () => {
    expect(ce.parse('\\mathrm{Sum}(i, \\{i, n\\})').json).toEqual([
      'Sum',
      'i',
      ['Limits', 'i', 1, 'n'],
    ]);
  });

  test('the index has the ranged type integer<1..n>', () => {
    const e = ce.parse('\\mathrm{Sum}(i, (i, 10))');
    expect(e.json).toEqual(['Sum', 'i', ['Limits', 'i', 1, 10]]);
    expect(e.ops![1].ops![0].type.toString()).toBe('integer<1..10>');
    // The body types from the ranged index, as for `Limits(k, 1, 40)`.
    const body = [
      'Sqrt',
      ['Subtract', 1, ['Power', ['Divide', ['Subtract', 'k', 0.5], 40], 2]],
    ];
    expect(ce.box(['Sum', body, ['Set', 'k', 40]]).type.toString()).toBe(
      'real'
    );
  });

  test('two iterators', () => {
    expect(
      ce.parse('\\mathrm{Sum}(i j, (i, 1, 3), (j, 2))').evaluate().json
    ).toBe(18);
  });
});

describe('THE PARENTHESIZED SPECIFICATION (i, 1, 10)', () => {
  test('\\mathrm{Sum}(i, (i,1,10)) is 55', () => {
    const e = ce.parse('\\mathrm{Sum}(i, (i,1,10))');
    expect(e.json).toEqual(['Sum', 'i', ['Limits', 'i', 1, 10]]);
    expect(e.ops![1].ops![0].type.toString()).toBe('integer<1..10>');
    expect(e.evaluate().json).toBe(55);
  });

  test('\\mathrm{Product}(i, (i,1,5)) is 120', () => {
    expect(ce.parse('\\mathrm{Product}(i, (i,1,5))').evaluate().json).toBe(120);
  });

  test('with a step', () => {
    expect(ce.parse('\\mathrm{Sum}(i, (i,1,10,2))').evaluate().json).toBe(25);
  });

  test('the box route', () => {
    expect(
      ce
        .box(['Sum', 'i', ['Delimiter', ['Sequence', 'i', 1, 10], "'(,)'"]])
        .evaluate().json
    ).toBe(55);
    expect(
      ce.box(['Sum', 'i', ['Delimiter', ['Sequence', 'i', 10]]]).evaluate().json
    ).toBe(55);
  });

  test('\\mathrm{Integrate}(x, (x,0,1)) keeps its bounds', () => {
    const e = ce.parse('\\mathrm{Integrate}(x, (x,0,1))');
    expect(e.json).toEqual(['Integrate', 'x', ['Limits', 'x', 0, 1]]);
    expect(e.evaluate().json).toEqual(['Rational', 1, 2]);
  });
});

describe('THE OTHER SPECIFICATIONS ARE UNCHANGED', () => {
  test('a bounds tuple, Limits, Element and \\sum', () => {
    expect(
      ce.box(['Sum', ['Power', 'k', 2], ['Tuple', 'k', 1, 3]]).evaluate().json
    ).toBe(14);
    expect(
      ce.box(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]]).evaluate().json
    ).toBe(14);
    expect(
      ce
        .box(['Sum', ['Power', 'k', 2], ['Element', 'k', ['Range', 1, 3]]])
        .evaluate().json
    ).toBe(14);
    expect(ce.parse('\\sum_{i=1}^{10} i').evaluate().json).toBe(55);
    expect(ce.parse('\\prod_{k=1}^{4} k').evaluate().json).toBe(24);
  });

  test('a big operator with one bound stays unevaluated', () => {
    // The flat spelling and `\sum_{k}^{10}` give `Limits(k, Nothing, 10)`:
    // the iterator rule `{i, n}` does not apply to them.
    const flat = ce.box(['Sum', 'k', 'k', 10]);
    expect(flat.json).toEqual(['Sum', 'k', ['Limits', 'k', 'Nothing', 10]]);
    expect(flat.evaluate().json).toEqual(flat.json);
    expect(ce.parse('\\sum_{k}^{10} k').json).toEqual([
      'Sum',
      'k',
      ['Limits', 'k', 'Nothing', 10],
    ]);
  });

  test('a Nothing in a two-element tuple keeps its reading', () => {
    expect(ce.box(['Sum', 'k', ['Tuple', 'Nothing', 10]]).json).toEqual([
      'Sum',
      'k',
      ['Limits', 'Nothing', 'Nothing', 10],
    ]);
  });

  test('Table accepts the same iterator', () => {
    expect(ce.parse('\\mathrm{Table}(k^2, (k, 3))').evaluate().toString()).toBe(
      '[1,4,9]'
    );
  });
});

describe('A Range bound in an Element clause', () => {
  test('a symbol with an assigned value is read, as in a Limits clause', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('k', 2);
    expect(
      ce2.box(['Sum', 'j', ['Element', 'j', ['Range', 1, 'k']]]).evaluate().json
    ).toBe(3);
    expect(
      ce2.box(['Product', 'j', ['Element', 'j', ['Range', 1, 'k']]]).evaluate()
        .json
    ).toBe(2);
  });

  test('a symbol with no value keeps the sum symbolic', () => {
    const ce2 = new ComputeEngine();
    expect(
      ce2.box(['Sum', 'j', ['Element', 'j', ['Range', 1, 'q']]]).evaluate()
        .operator
    ).toBe('Sum');
  });
});
