import { ComputeEngine } from '../../src/compute-engine';

// A two-operand set-builder (`Set(body, Element(k, S))`) has a body and an
// indexing set in fixed positions. The matcher tries the operands of a `Set`
// in any order only when BOTH the pattern and the subject are sets of
// elements; a pattern with no `Element` operand must not match a set-builder
// subject with its body and indexing set swapped.

const ce = new ComputeEngine();
const box = (json: unknown) => ce.box(json as any);
const raw = (json: unknown) => ce.box(json as any, { form: 'raw' });

describe('a set-builder subject matches by position', () => {
  const builder = box(['Set', ['Multiply', 2, 'k'], ['Element', 'k', 'S']]);

  test('a pattern with the body in second position does not match', () => {
    expect(
      builder.match(raw(['Set', '_spec', ['Multiply', 2, 'k']]))
    ).toBeNull();
    expect(
      builder.replace({
        match: ['Set', '_spec', ['Multiply', 2, 'k']],
        replace: 'x',
      })
    ).toBeNull();
  });

  test('a pattern in the written order matches', () => {
    const m = builder.match(raw(['Set', '_body', '_spec']));
    expect(m).not.toBeNull();
    expect(m!['_body'].json).toEqual(['Multiply', 2, 'k']);
    expect(m!['_spec'].json).toEqual(['Element', 'k', 'S']);
  });

  test('a Condition set-builder subject matches by position too', () => {
    const cond = box(['Set', 'x', ['Condition', ['Greater', 'x', 0]]]);
    expect(cond.match(raw(['Set', '_c', 'x']))).toBeNull();
    expect(cond.match(raw(['Set', 'x', '_c']))).not.toBeNull();
  });

  test('a set of elements still matches in any order', () => {
    const m = box(['Set', 1, 2]).match(raw(['Set', 2, '_a']));
    expect(m).not.toBeNull();
    expect(m!['_a'].json).toBe(1);
  });
});
