import type { MathJsonExpression } from '../../../src/math-json/types';
import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

// CE-1728. `\max_{x \in S} f` (and `\min`, `\sup`, `\inf`) is the extremum of
// `f` over the elements of `S`, `["Max", ["Map", ["Function", f, "x"], S]]`.
// The `Function` binds `x`. A subscript that is not one clause `x \in S` is
// an `expected-set-membership` error. The subscript was read as a symbol `_`,
// and `x` was free.

function raw(latex: string): MathJsonExpression {
  return ce.parse(latex, { canonical: false }).json as MathJsonExpression;
}

function value(latex: string): MathJsonExpression {
  return ce.parse(latex).evaluate().json as MathJsonExpression;
}

describe('CE-1728: an extremum over a set written with a subscript', () => {
  test('the witness: the largest square of 1, 2 and 3 is 9', () => {
    const expr = ce.parse('\\max_{x \\in \\{1,2,3\\}} x^2');
    expect(expr.json).toEqual([
      'Max',
      [
        'Map',
        ['Function', ['Block', ['Power', 'x', 2]], 'x'],
        ['Set', 1, 2, 3],
      ],
    ]);
    expect(expr.freeVariables).toEqual([]);
    expect(expr.evaluate().json).toEqual(9);
  });

  test('min, sup and inf', () => {
    expect(value('\\min_{x \\in \\{1,-2,3\\}} x^2')).toEqual(1);
    expect(value('\\sup_{x \\in \\{1,2\\}} x')).toEqual(2);
    expect(value('\\inf_{x \\in \\{1,2\\}} x')).toEqual(1);
    expect(value('\\operatorname{max}_{x \\in \\{1,2\\}} x')).toEqual(2);
    expect(
      value('\\max_{x \\in \\{1,2\\}}\\max_{y \\in \\{3,4\\}} xy')
    ).toEqual(8);
  });

  test('the body stops before a plus, as the body of a sum', () => {
    expect(raw('\\max_{x \\in S} x^2 + 1')).toEqual([
      'Add',
      ['Max', ['Map', ['Function', ['Power', 'x', 2], 'x'], 'S']],
      1,
    ]);
    expect(value('\\max_{x \\in \\{1,2\\}} (x+1)')).toEqual(3);
  });

  test('a set that is not known keeps the extremum unevaluated', () => {
    const expr = ce.parse('\\max_{x \\in S} f(x)');
    expect(expr.freeVariables).toEqual(['S']);
    expect(expr.evaluate().json).toEqual([
      'Max',
      ['Map', ['Function', ['Block', ['f', 'x']], 'x'], 'S'],
    ]);
  });

  test('the index of a subscript in the body is read by value', () => {
    // As in `\sum_{n \in \{1,2\}} a_n`: the terms are `a_1` and `a_2`, not
    // the one name `a_n`.
    expect(value('\\max_{n \\in \\{1,2\\}} a_n')).toEqual([
      'Max',
      'a_1',
      'a_2',
    ]);
    const local = new ComputeEngine();
    local.assign('a', local.box(['List', 5, 7, 3]));
    expect(
      local.parse('\\max_{n \\in \\{1,2,3\\}} a_n').evaluate().json
    ).toEqual(7);
  });

  test('the serialized LaTeX reads back as the same expression', () => {
    for (const latex of [
      '\\max_{x \\in \\{1,2,3\\}} x^2',
      '\\min_{x \\in S} (x+1)',
      '\\sup_{x \\in S} f(x)',
      '\\max_{n \\in \\{1,2\\}} a_n',
    ]) {
      const expr = ce.parse(latex);
      expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
      expect(ce.box(expr.json).isSame(expr)).toBe(true);
    }
    expect(ce.parse('\\max_{x \\in \\{1,2,3\\}} x^2').latex).toBe(
      '\\max_{x\\in\\lbrace1, 2, 3\\rbrace}x^2'
    );
    expect(ce.parse('\\min_{x \\in S} (x+1)').latex).toBe(
      '\\min_{x\\in S}(x+1)'
    );
  });

  test('an extremum before more notation is fenced, as a sum is', () => {
    // The body would read the next factor, the exponent or the `!`: the
    // product of the two maxima is 3, the maximum of `x·y` over the two
    // sets is 8.
    const max = (v: string, set: number[]): MathJsonExpression => [
      'Max',
      ['Map', ['Function', v, v], ['Set', ...set]],
    ];
    for (const [json, latex, result] of [
      [
        ['Multiply', max('x', [-2, -1]), max('y', [-4, -3])],
        '(\\max_{x\\in\\lbrace-2, -1\\rbrace}x)(\\max_{y\\in\\lbrace-4, -3\\rbrace}y)',
        3,
      ],
      [
        ['Power', max('x', [-2, -1]), 2],
        '(\\max_{x\\in\\lbrace-2, -1\\rbrace}x)^2',
        1,
      ],
      [
        ['Factorial', max('x', [2, 3])],
        '(\\max_{x\\in\\lbrace2, 3\\rbrace}x)!',
        6,
      ],
    ] as [MathJsonExpression, string, number][]) {
      const expr = ce.box(json);
      expect(expr.latex).toBe(latex);
      expect(expr.evaluate().json).toEqual(result);
      expect(ce.parse(expr.latex).evaluate().json).toEqual(result);
    }
    // After a plus, no fence is needed.
    expect(ce.box(['Add', max('x', [1, 2]), 1]).latex).toBe(
      '\\max_{x\\in\\lbrace1, 2\\rbrace}x+1'
    );
  });

  test('without a subscript, the arguments are read as before', () => {
    expect(raw('\\max(a,b)')).toEqual(['Max', 'a', 'b']);
    expect(raw('\\max a')).toEqual(['Max', 'a']);
    expect(ce.parse('\\max(a,b)').latex).toBe('\\max(a, b)');
    expect(value('\\max\\{1,5,2\\}')).toEqual(5);
    expect(value('\\inf(1,5,2)')).toEqual(1);
  });

  test('another subscript is an error', () => {
    for (const latex of [
      '\\max_x f(x)',
      '\\max_{1 \\le i \\le 3} i',
      '\\max_{x, y \\in \\{1,2\\}} x',
      '\\max_{x \\in \\{1,2\\}, x > 1} x',
    ]) {
      const expr = raw(latex) as MathJsonExpression[];
      expect(expr[0]).toBe('Max');
      expect((expr[1] as MathJsonExpression[])[0]).toBe('Error');
      expect((expr[1] as MathJsonExpression[])[1]).toBe(
        "'expected-set-membership'"
      );
    }
  });

  test('the bound variable is not an undeclared symbol', () => {
    const names = (latex: string) =>
      (
        new ComputeEngine().parse(latex, { diagnostics: true })
          .parseDiagnostics ?? []
      )
        .filter((d) => d.code === 'undeclared-symbol')
        .map((d) => d.detail?.name);
    expect(names('\\max_{x \\in \\{1,2\\}} x^2')).toEqual([]);
    expect(names('\\max_{x \\in S} x + x')).toEqual(['S', 'x']);
  });
});
