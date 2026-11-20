/**
 * The derivative of a number that an operator computes from a whole list
 * (`Mean`, `Norm`, `Variance` of a list) stays a `D`: the chain rule
 * `F′(g)·g′` has no correct form when `g` is a list, because the partial
 * derivative is a gradient and the product a dot product. The `Multiply` of
 * the chain rule multiplies each element, and would give a list for the
 * derivative of a number.
 *
 * `Min` and `Max` of one list have a rule of their own, the derivative of
 * the selected element (`derivative-min-max-of-list.test.ts`). It declines
 * for a list written with a function, as in the corpus form below.
 *
 * Corpus: the Desmos document `neyret/lwuwgb9ic5` (Tycho) draws
 * `|m_2 - m| / sqrt((d/dx (m_2 - m))^2 + (d/dy (m_2 - m))^2)`, where `m` and
 * `m_2` are the smallest and the second smallest of the squared distances
 * to N points. With a list for each derivative, the value of the quotient
 * had more than 12 million nodes for 64 points.
 */

import { ComputeEngine } from '../../src/compute-engine';

const x2 = ['Power', 'x', 2];
const shifted = ['Power', ['Add', 'x', -1], 2];
const list = ['List', x2, shifted];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

describe('CE-1602: the derivative of a number computed from a list', () => {
  test.each(['Mean', 'Median', 'Norm', 'Variance', 'StandardDeviation'])(
    '%s of a list stays a D, and a number',
    (op) => {
      const ce = engine();
      const result = ce.expr(['D', [op, list], 'x'] as never).evaluate();
      expect(result.json).toEqual(['D', [op, list], 'x']);
      expect(result.type.matches('number')).toBe(true);
    }
  );

  test('a list among several arguments declines the whole call', () => {
    const ce = engine();
    const result = ce.expr(['D', ['Min', x2, list], 'x'] as never).evaluate();
    expect(result.operator).toBe('D');
    expect(result.type.matches('number')).toBe(true);
  });

  test('a function declared with a list parameter and a number result', () => {
    const ce = engine();
    ce.declare('g', '(list<number>) -> number');
    const result = ce.expr(['D', ['g', list], 'x'] as never).evaluate();
    expect(result.json).toEqual(['D', ['g', list], 'x']);
  });

  test('the rules around the call still apply', () => {
    const ce = engine();
    // `d/dx Mean(L)^2` is `2·Mean(L)·d/dx Mean(L)`: the power rule applies,
    // and only the derivative of `Mean(L)` stays a `D`.
    const result = ce
      .expr(['D', ['Power', ['Mean', list], 2], 'x'] as never)
      .evaluate();
    expect(result.operator).toBe('Multiply');
    expect(result.type.matches('number')).toBe(true);
    expect(JSON.stringify(result.json)).toContain(
      JSON.stringify(['D', ['Mean', list], 'x'])
    );
  });

  test('a second derivative stays a number', () => {
    const ce = engine();
    const result = ce
      .expr(['D', ['D', ['Mean', list], 'x'], 'x'] as never)
      .evaluate();
    expect(result.type.matches('number')).toBe(true);
    expect(JSON.stringify(result.json)).not.toContain('"List",["List"');
  });

  test('the explanation shows no chain-rule step for the declined call', () => {
    const ce = engine();
    const explanation = ce
      .expr(['Mean', list] as never)
      .explain('D', { variable: 'x', verbosity: 'verbose' });
    expect(explanation.result.json).toEqual(['D', ['Mean', list], 'x']);
    // A chain-rule step would show `Apply(Derivative(Mean, 1), …)`.
    expect(
      JSON.stringify(explanation.steps.map((step) => step.value.json))
    ).not.toContain('Derivative');
  });

  test('an operator applied to each element keeps the chain rule', () => {
    const ce = engine();
    // `Sin` of a list is a list: the chain rule applies to each element.
    expect(ce.expr(['D', ['Sin', list], 'x'] as never).evaluate().json).toEqual(
      ce
        .expr([
          'List',
          ['Multiply', 2, 'x', ['Cos', x2]],
          ['Multiply', 2, ['Add', 'x', -1], ['Cos', shifted]],
        ] as never)
        .evaluate().json
    );
    // A function with a number parameter is applied to each element too.
    ce.declare('f', '(number) -> number');
    const mapped = ce.expr(['D', ['f', list], 'x'] as never).evaluate();
    expect(mapped.operator).toBe('Multiply');
    expect(mapped.type.matches('list')).toBe(true);
  });

  test('number arguments keep the chain rule', () => {
    const ce = engine();
    // `Min` of two numbers has a partial derivative for each argument.
    const result = ce
      .expr(['D', ['Min', x2, shifted], 'x'] as never)
      .evaluate();
    expect(result.operator).toBe('Add');
    expect(JSON.stringify(result.json)).toContain('["Derivative","Min",1,0]');
  });

  test('an element selected by its position keeps its derivative', () => {
    const ce = engine();
    expect(
      ce.expr(['D', ['First', list], 'x'] as never).evaluate().json
    ).toEqual(['Multiply', 2, 'x']);
  });

  test('the corpus form: the second smallest squared distance', () => {
    const ce = engine();
    const points = [
      'List',
      ...Array.from({ length: 12 }, (_, k) => ['Tuple', k / 12, (k * k) / 144]),
    ];
    const distances = [
      'Add',
      ['Power', ['Add', 'x', ['Negate', ['PointX', points]]], 2],
      ['Power', ['Add', 'y', ['Negate', ['PointY', points]]], 2],
    ];
    const smallest = ['Min', distances];
    const withoutSmallest = [
      'Apply',
      [
        'Function',
        ['Block', ['Which', ['Equal', 'k', smallest], 1e9, 'True', 'k']],
        'k',
      ],
      distances,
    ];
    const gap = ['Add', ['Negate', smallest], ['Min', withoutSmallest]];
    const slope = [
      'Sqrt',
      ['Add', ['Power', ['D', gap, 'x'], 2], ['Power', ['D', gap, 'y'], 2]],
    ];
    const result = ce.expr(['Divide', ['Abs', gap], slope] as never).evaluate();
    // The quotient is one number: with a list for each derivative, it was a
    // `Which` of a list of 12 conditions and two lists of 12 quotients.
    expect(result.operator).toBe('Divide');
    expect(result.type.matches('number')).toBe(true);
  });
});
