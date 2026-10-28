import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * `Factor`, `Together` and `Cancel` are lazy, and the canonical form of `Add`
 * does not collect like terms (only `evaluate()` does). Before this fix, each
 * of them returned its operand with like terms uncombined when it found
 * nothing else to rewrite: `Together(a + a)` was `a + a`, and
 * `Factor(sin(t) + sin(t))` was `sin(t) + sin(t)`.
 *
 * Now each of them collects like terms, as `evaluate()` of `Add` does.
 * `Factor` with no variable also treats each non-polynomial subexpression
 * (`sin(t)`, `e^x`) as a variable, and takes out a common factor of a sum in
 * several unknowns: `ax + ay` is `a(x + y)`.
 *
 * ROADMAP CE-577, user decision 2026-10-27 (option a).
 */

const ce = new ComputeEngine();

function run(op: string, latex: string): Expression {
  return ce.parse(`\\operatorname{${op}}(${latex})`).evaluate();
}

/**
 * Is `result` equal to `input` at a few sample points of its unknowns? Each
 * expected answer below is checked this way too, not only by its form.
 */
function sameValues(input: Expression, result: Expression): boolean {
  const names = [...new Set([...input.unknowns, ...result.unknowns])];
  const points = [0.37, 1.41, 2.9, -0.83];
  for (let k = 0; k < points.length; k++) {
    const values: Record<string, number> = {};
    names.forEach((n, i) => (values[n] = points[(k + i) % points.length]));
    const a = input.subs(values).N().re;
    const b = result.subs(values).N().re;
    if (
      !Number.isFinite(a) ||
      !Number.isFinite(b) ||
      Math.abs(a - b) > 1e-9 * (1 + Math.abs(a))
    )
      return false;
  }
  return true;
}

describe('CE-577: like terms are collected', () => {
  test.each([
    // [operator, input, expected]
    ['Factor', 'a+a', '2a'],
    ['Together', 'a+a', '2a'],
    ['Cancel', 'a+a', '2a'],
    ['Factor', '\\sin t+\\sin t', '2\\sin(t)'],
    ['Together', '\\sin t+\\sin t', '2\\sin(t)'],
    ['Cancel', '\\sin t+\\sin t', '2\\sin(t)'],
    ['Factor', '\\frac1a+\\frac1a', '\\frac{2}{a}'],
    ['Together', '\\frac1a+\\frac1a', '\\frac{2}{a}'],
    ['Cancel', '\\frac1a+\\frac1a', '\\frac{2}{a}'],
    ['Factor', 'e^x+e^x', '2\\exponentialE^{x}'],
  ])('%s(%s) = %s', (op, input, expected) => {
    const result = run(op, input);
    expect(result.latex).toBe(expected);
    expect(sameValues(ce.parse(input), result)).toBe(true);
  });

  test('a term that is not pure is not collected', () => {
    // Random() + Random() is the sum of two values, not 2·Random().
    for (const op of ['Factor', 'Together', 'Cancel']) {
      const result = run(
        op,
        '\\operatorname{Random}()+\\operatorname{Random}()'
      );
      expect(result.json).toEqual(['Add', ['Random'], ['Random']]);
      // The pure terms of the same sum are still collected.
      expect(run(op, 'a+a+\\operatorname{Random}()').json).toEqual([
        'Add',
        ['Multiply', 2, 'a'],
        ['Random'],
      ]);
    }
  });

  test('a product of sums is not expanded', () => {
    for (const op of ['Factor', 'Together']) {
      expect(run(op, '(a+b)(c+d)').latex).toBe('(a+b)(c+d)');
      expect(run(op, '(a+b)(c+d)+(a+b)(c+d)').latex).toBe('2(a+b)(c+d)');
    }
    expect(run('Together', '(a+b)(c+d)+ac').latex).toBe('ac+(a+b)(c+d)');
    expect(run('Cancel', '(x+1)(x+2)+x').latex).toBe('(x+1)(x+2)+x');
  });

  test('a function with a value is applied, then like terms are collected', () => {
    const ce2 = new ComputeEngine();
    ce2.parse('g(t) \\coloneq \\sin(t)').evaluate();
    // The sum itself evaluates to the same answer.
    expect(ce2.parse('g(t)+g(t)').evaluate().latex).toBe('2\\sin(t)');
    for (const op of ['Factor', 'Together', 'Cancel'])
      expect(
        ce2.parse(`\\operatorname{${op}}(g(t)+g(t))`).evaluate().latex
      ).toBe('2\\sin(t)');
  });
});

describe('CE-577: Factor treats a non-polynomial subexpression as a variable', () => {
  test.each([
    ['x\\sin t+y\\sin t', '(x+y)\\sin(t)'],
    ['x e^x+e^x', '(x+1)\\exponentialE^{x}'],
    ['x^2e^x-e^x', '(x-1)(x+1)\\exponentialE^{x}'],
    ['\\sin(t)^2+5\\sin t+6', '(\\sin(t)+2)(\\sin(t)+3)'],
    // The common factor is taken out first, then the quadratic in sin(t)
    // left in the cofactor is factored.
    ['2\\sin(t)^2+10\\sin t+12', '2(\\sin(t)+2)(\\sin(t)+3)'],
    ['a\\sin(t)^2+5a\\sin t+6a', 'a\\times(\\sin(t)+2)(\\sin(t)+3)'],
    ['x\\sin(t)^2+5x\\sin t+6x', 'x\\times(\\sin(t)+2)(\\sin(t)+3)'],
  ])('Factor(%s) = %s', (input, expected) => {
    const result = run('Factor', input);
    expect(result.latex).toBe(expected);
    expect(sameValues(ce.parse(input), result)).toBe(true);
  });
});

describe('CE-577: Factor takes out a common factor of a multivariate sum', () => {
  test.each([
    ['ax+ay', 'a\\times(x+y)'],
    ['a^2b+ab^2', 'ab\\times(a+b)'],
    ['6x^2y+9xy^2', '3xy\\times(2x+3y)'],
    ['x^2y-y', 'y\\times(x-1)(x+1)'],
    ['a^3-ab^2', 'a\\times(a+b)(a-b)'],
    ['a^2x+2abx+b^2x', 'x\\times(a+b)^2'],
    // A base with a negative exponent in every term is taken out with the
    // smallest exponent, so the cofactor has no denominator.
    ['\\frac{a}{b}+\\frac{a^2}{b}', '\\frac{a\\times(a+1)}{b}'],
    ['a^{-2}b+a^{-1}b', '\\frac{b\\times(a+1)}{a^2}'],
  ])('Factor(%s) = %s', (input, expected) => {
    const result = run('Factor', input);
    expect(result.latex).toBe(expected);
    expect(sameValues(ce.parse(input), result)).toBe(true);
  });

  test('-1 is taken out when every term is negative', () => {
    const input = '-ax-ay';
    const result = run('Factor', input);
    expect(result.json).toEqual([
      'Negate',
      ['Multiply', 'a', ['Add', 'x', 'y']],
    ]);
    expect(sameValues(ce.parse(input), result)).toBe(true);
    // One positive term: -1 stays in the cofactor.
    expect(run('Factor', '-ax+ay').latex).toBe('a\\times(y-x)');
  });

  test('a quotient by the number 0 is not split', () => {
    // a/(b/0) is 0/0 or a pole depending on a and b: splitting it read 0 as
    // a factor of the term, and Factor returned ac.
    expect(run('Factor', '\\frac{a}{b/0}+ac').json).toEqual([
      'Add',
      ['Multiply', 'a', 'c'],
      ['Divide', 'a', ['Divide', 'b', 0]],
    ]);
  });

  test('a sum with no common factor is kept', () => {
    expect(run('Factor', 'a+b').latex).toBe('a+b');
    expect(run('Factor', '\\frac1x+\\frac1y').latex).toBe(
      '\\frac{1}{x}+\\frac{1}{y}'
    );
  });
});

describe('CE-577: what Factor did before still works', () => {
  test.each([
    ['\\sin(t)^2-1', '(\\sin(t)-1)(\\sin(t)+1)'],
    ['2\\sin t+2\\cos t', '2(\\sin(t)+\\cos(t))'],
    ['x^2+5x+6', '(x+2)(x+3)'],
    ['x^2-1', '(x-1)(x+1)'],
    ['2x+4', '2(x+2)'],
    ['x^3+x^2', '(x+1)x^2'],
    ['a^2-b^2', '(a+b)(a-b)'],
    ['a^2+2ab+b^2', '(a+b)^2'],
  ])('Factor(%s) = %s', (input, expected) => {
    expect(run('Factor', input).latex).toBe(expected);
  });

  test('with a variable', () => {
    expect(run('Factor', 'x^2-1, x').latex).toBe('(x-1)(x+1)');
    // The like terms are collected before factoring in the variable.
    expect(run('Factor', 'x+x+2, x').latex).toBe('2(x+1)');
  });

  test('in a number field', () => {
    const result = ce
      .expr([
        'Factor',
        ['Add', ['Power', 'x', 2], -2],
        'x',
        ['AlgebraicGenerator', ['List', -2, 0, 1]],
      ])
      .evaluate();
    expect(result.operator).toBe('Multiply');
    expect(result.nops).toBe(2);
  });

  test('Together and Cancel still combine and cancel', () => {
    expect(run('Together', '\\frac1x+\\frac1y').latex).toBe('\\frac{x+y}{xy}');
    expect(run('Cancel', '\\frac{x^2-1}{x-1}').latex).toBe('x+1');
  });
});

describe('CE-577: box route', () => {
  // The operators are lazy: a held operand reaches the handler unbound on
  // the box route, so the route is tested on its own.
  test('Factor, Together and Cancel of a boxed sum', () => {
    expect(ce.expr(['Factor', ['Add', 'a', 'a']]).evaluate().latex).toBe('2a');
    expect(ce.expr(['Together', ['Add', 'a', 'a']]).evaluate().latex).toBe(
      '2a'
    );
    expect(
      ce
        .expr(['Cancel', ['Add', ['Divide', 1, 'a'], ['Divide', 1, 'a']]])
        .evaluate().latex
    ).toBe('\\frac{2}{a}');
    expect(
      ce
        .expr([
          'Factor',
          [
            'Add',
            ['Multiply', 'x', ['Sin', 't']],
            ['Multiply', 'y', ['Sin', 't']],
          ],
        ])
        .evaluate().latex
    ).toBe('(x+y)\\sin(t)');
    expect(
      ce
        .expr([
          'Factor',
          ['Add', ['Multiply', 'a', 'x'], ['Multiply', 'a', 'y']],
        ])
        .evaluate().latex
    ).toBe('a\\times(x+y)');
  });
});

describe('CE-577: Cancel with no single unknown, and an absent term', () => {
  test('Cancel collects like terms when it has no variable to cancel in', () => {
    expect(run('Cancel', '(a+b)(c+d)+(a+b)(c+d)').latex).toBe('2(a+b)(c+d)');
    expect(run('Cancel', 'a+b').latex).toBe('a+b');
  });

  test('an absent term gives NaN, as evaluating the sum does', () => {
    expect(ce.expr(['Add', 'Missing', 1]).evaluate().isNaN).toBe(true);
    expect(ce.expr(['Factor', ['Add', 'Missing', 1]]).evaluate().isNaN).toBe(
      true
    );
    expect(
      ce.expr(['Together', ['Add', 'Missing', 'a', 'a']]).evaluate().isNaN
    ).toBe(true);
  });
});
