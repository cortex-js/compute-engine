import { ComputeEngine } from '../../src/compute-engine';

// A branch condition that is `And`, `Or`, `Implies` or `Not` with an absent
// operand. The logic is two-valued: a connective reads an absent operand as
// `False`, so the condition is `True` or `False` and the branch takes its
// arm (user decision of 2026-11-02, two-valued comparisons,
// `docs/ERROR-MODEL.md`). From 2026-07-24 to 2026-11-02 such a condition was
// absent, and `If` and `Which` reported the absent-condition error.

const ce = new ComputeEngine();

function evaluate(json: unknown): string {
  return ce.box(json as never).evaluate().toString();
}

describe('A connective condition with an absent operand', () => {
  test.each([
    ['And(True, Missing)', ['If', ['And', 'True', 'Missing'], 1, 2], '2'],
    ['Or(False, Missing)', ['If', ['Or', 'False', 'Missing'], 1, 2], '2'],
    [
      'Implies(True, Missing)',
      ['If', ['Implies', 'True', 'Missing'], 1, 2],
      '2',
    ],
    ['Not(Missing)', ['If', ['Not', 'Missing'], 1, 2], '1'],
  ])('If over %s takes its arm', (_, json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('Which over And(True, Missing) takes the next clause', () => {
    expect(evaluate(['Which', ['And', 'True', 'Missing'], 1, 'True', 3])).toBe(
      '3'
    );
  });

  test('a deciding operand still decides', () => {
    expect(evaluate(['If', ['And', 'False', 'Missing'], 1, 2])).toBe('2');
    expect(evaluate(['If', ['Or', 'True', 'Missing'], 1, 2])).toBe('1');
  });

  test('an absent operand decides an And beside a symbolic operand', () => {
    // `And(X, Missing)` is `And(X, False)`, which is `False` for every `X`.
    expect(evaluate(['If', ['And', 'X', 'Missing'], 1, 2])).toBe('2');
  });

  test('a symbolic operand keeps an Or unevaluated', () => {
    // `Or(Y, Missing)` is `Y`.
    const result = ce
      .box(['If', ['Or', 'Y', 'Missing'], 1, 2] as never)
      .evaluate();
    expect(result.operator).toBe('If');
  });

  test('the parse route gives the same answer', () => {
    expect(
      ce
        .parse(
          '\\text{if } \\mathrm{True} \\land \\mathrm{Missing} \\text{ then } 1 \\text{ else } 2'
        )
        .evaluate()
        .toString()
    ).toBe('2');
  });
});
