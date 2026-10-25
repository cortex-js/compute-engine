import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-97.1. With `g(t) = [t, 2t]`, the view `Rest(g(3))` has no count before
 * `g(3)` is evaluated, so it is not known to be a finite collection. `Sum` and
 * `Reduce` hold their collection operand, so they found it not finite and
 * stayed unevaluated, while `Take(g(3), 1)`, whose count is bounded by its
 * literal, was summed. They now evaluate such a view first.
 */

const ce = new ComputeEngine();
ce.declare('g', 'function');
ce.assign('g', ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't']));

const NOT_FOUR = ['Function', ['Greater', 'x', 4], 'x'];

describe('CE-97.1: a reducer over a view of a function call', () => {
  test.each([
    [['Sum', ['Rest', ['g', 3]]], '6'],
    [['Reduce', ['Rest', ['g', 3]], 'Add', 0], '6'],
    [['Product', ['Rest', ['g', 3]]], '6'],
    [['Sum', ['Most', ['g', 3]]], '3'],
    [['Sum', ['Reverse', ['g', 3]]], '9'],
    [['Sum', ['Filter', ['g', 3], NOT_FOUR]], '6'],
    [['Sum', ['Join', ['g', 3], ['List', 1]]], '10'],
    [['Sum', ['Take', ['g', 3], 1]], '3'],
  ])('%j', async (json, expected) => {
    const expr = ce.box(json as any);
    expect(expr.evaluate().toString()).toBe(expected);
    expect((await expr.evaluateAsync()).toString()).toBe(expected);
  });

  test('the parse route', () => {
    expect(
      ce.parse('\\operatorname{Sum}(\\operatorname{Rest}(g(3)))').evaluate()
        .toString()
    ).toBe('6');
  });

  test('a view over a symbolic range stays unevaluated', () => {
    expect(
      ce.box(['Sum', ['Rest', ['Range', 1, 'n']]]).evaluate().toString()
    ).toBe('sum(Rest(Range(1, n)))');
  });
});
