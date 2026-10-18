import { ComputeEngine } from '../../src/compute-engine';

// A branch condition that is `And`, `Or` or `Implies` with an absent operand
// and no deciding operand is absent: `If` and `Which` report the absent
// condition, as they do for `Not(Missing)` and for a comparison with an
// absent operand. They used to stay unevaluated, because the connective
// counted the `Missing` value as a symbolic operand.

const ce = new ComputeEngine();

const ABSENT = /The condition is absent/;

function evaluate(json: unknown): string {
  return ce.box(json as never).evaluate().toString();
}

describe('A connective condition with an absent operand', () => {
  test.each([
    ['And(True, Missing)', ['If', ['And', 'True', 'Missing'], 1, 2]],
    ['Or(False, Missing)', ['If', ['Or', 'False', 'Missing'], 1, 2]],
    ['Implies(True, Missing)', ['If', ['Implies', 'True', 'Missing'], 1, 2]],
    ['Not(Missing)', ['If', ['Not', 'Missing'], 1, 2]],
  ])('If over %s reports the absent condition', (_, json) => {
    expect(evaluate(json)).toMatch(ABSENT);
  });

  test('Which over And(True, Missing) reports the absent condition', () => {
    expect(
      evaluate(['Which', ['And', 'True', 'Missing'], 1, 'True', 3])
    ).toMatch(ABSENT);
  });

  test('a deciding operand still decides', () => {
    expect(evaluate(['If', ['And', 'False', 'Missing'], 1, 2])).toBe('2');
    expect(evaluate(['If', ['Or', 'True', 'Missing'], 1, 2])).toBe('1');
  });

  test('a symbolic operand keeps the conditional unevaluated', () => {
    const result = ce
      .box(['If', ['And', 'X', 'Missing'], 1, 2] as never)
      .evaluate();
    expect(result.operator).toBe('If');
  });

  test('the parse route gives the same answer', () => {
    expect(
      ce
        .parse('\\text{if } \\mathrm{True} \\land \\mathrm{Missing} \\text{ then } 1 \\text{ else } 2')
        .evaluate()
        .toString()
    ).toMatch(ABSENT);
  });
});
