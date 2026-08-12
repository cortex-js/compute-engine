import { ComputeEngine } from '../../src/compute-engine';

// Tycho item-169 ruling (2026-08-12): `isEnumerableCollection` ANSWERS for
// arithmetic broadcasts. Before this, a broadcast node fell through to the
// "unadopted eager operator" tier and answered `undefined` for the whole
// class — including the one case Tycho needed to discriminate: `x + [1, 2]`
// (walks) vs `x + Total([1, 2])` with `Total` undeclared (counts through the
// operands, walks zero elements — item 169's original witness).
//
// The ruling's shape, and what each test group pins:
// - a broadcast answers from its PARTICIPANTS (scalar operands are lifts);
// - `true` is a kept PROMISE: `each()` yields `count` elements and `at()`
//   answers on every index — delivery before predicate;
// - an UNBOUND head is a definite `false` (vacuous binding, item 152: no
//   evaluation rule can ever produce elements);
// - an impure PARTICIPANT caps the answer at `undefined` — its walk works,
//   but per-index reads cannot promise draw coherence, so `at()` declines;
// - impurity confined to a lifted SCALAR does not demote the answer: the
//   distribute is draw-free (the random family is inert under `evaluate()`),
//   and `at()` serves the same unevaluated element the walk yields.

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('isEnumerableCollection answers for broadcasts (item-169 ruling)', () => {
  it.each([
    ['a symbolic broadcast', ['Add', 'x', ['List', 1, 2]], true],
    ['a literal broadcast', ['Add', ['List', 1, 2], 1], true],
    ['a unary lift', ['Sin', ['List', 1, 2]], true],
    [
      'a nested broadcast chain',
      ['Add', ['Multiply', 2, ['Range', 1, 3]], -1],
      true,
    ],
    [
      'an impure LIFTED SCALAR does not demote',
      ['Add', ['List', 1, 2], ['RandomInteger', 1, 100]],
      true,
    ],
    [
      'a nested impure-scalar broadcast',
      ['Add', ['List', 1, 2], ['Add', ['RandomInteger', 1, 9], ['List', 30, 40]]],
      true,
    ],
    [
      'the item-169 witness: an unbound-head participant',
      ['Add', 'x', ['Total', ['List', 1, 2]]],
      false,
    ],
    [
      'an unbound head standalone',
      ['Total', ['List', 1, 2]],
      false,
    ],
    [
      'a count-without-elements participant',
      ['Add', 'x', ['Linspace', 'a', 1, 3]],
      false,
    ],
    [
      'mismatched participant lengths',
      ['Add', ['List', 1, 2], ['List', 1, 2, 3]],
      undefined,
    ],
    [
      'an impure PARTICIPANT caps at undefined',
      ['Add', ['RandomShuffle', ['List', 1, 2, 3]], 1],
      undefined,
    ],
    ['a scalar sum is not a collection', ['Add', 1, 2], false],
  ] as const)('%s reports %s', (_label, expr, expected) => {
    expect(ce.box(expr as any).isEnumerableCollection).toBe(expected);
  });

  it('a valueless list-typed participant is a definite false', () => {
    ce.declare('xs', 'list<number>');
    expect(ce.box(['Add', 'x', 'xs']).isEnumerableCollection).toBe(false);
  });

  it('a valueless broadcastable-declared participant is a definite false', () => {
    ce.declare('B', 'broadcastable<number>');
    expect(ce.box(['Add', 'x', 'B']).isEnumerableCollection).toBe(false);
  });

  it('an infinite-length broadcast is enumerable (and lazy)', () => {
    const e = ce.box(['Sin', ['Range', 1, { num: '+Infinity' }]]);
    expect(e.isEnumerableCollection).toBe(true);
    // Delivery without materializing the infinite source.
    expect(e.at(3)?.toString()).toBe('sin(3)');
  });

  it('evaluate() does not change the verdict on the witness', () => {
    const e = ce.box(['Add', 'x', ['Total', ['List', 1, 2]]]);
    expect(e.evaluate().isEnumerableCollection).toBe(false);
    expect([...e.evaluate().each()]).toHaveLength(0);
  });
});

describe('true is a kept promise: each() and at() deliver', () => {
  it.each([
    ['x + [1,2]', ['Add', 'x', ['List', 1, 2]]],
    ['[1,2] + 1', ['Add', ['List', 1, 2], 1]],
    ['Sin([1,2])', ['Sin', ['List', 1, 2]]],
    ['2·Range(1,3) − 1', ['Add', ['Multiply', 2, ['Range', 1, 3]], -1]],
    ['[1,2] + RandomInteger(1,100)', ['Add', ['List', 1, 2], ['RandomInteger', 1, 100]]],
  ] as const)('%s: walk length = count, every index answers', (_label, expr) => {
    const e = ce.box(expr as any);
    expect(e.isEnumerableCollection).toBe(true);
    const count = e.count!;
    const walk = [...e.each()];
    expect(walk).toHaveLength(count);
    for (let i = 1; i <= count; i++) {
      const el = e.at(i);
      expect(el).toBeDefined();
      expect(el!.isSame(walk[i - 1])).toBe(true);
    }
    expect(e.at(-1)!.isSame(walk[count - 1])).toBe(true);
    expect(e.at(count + 1)).toBeUndefined();
  });
});

describe('at() on draw-free impure broadcasts (relaxed purity gate)', () => {
  it('serves the same unevaluated element the walk yields', () => {
    const e = ce.box(['Add', ['List', 1, 2], ['RandomInteger', 1, 100]]);
    const first = e.at(1);
    expect(first).toBeDefined();
    // Structural, not a draw: the random call rides inside the element.
    expect(first!.has('RandomInteger')).toBe(true);
    expect(first!.isSame([...e.each()][0])).toBe(true);
  });

  it('reaches through a nested impure-scalar distribute', () => {
    const e = ce.box([
      'Add',
      ['List', 1, 2],
      ['Add', ['RandomInteger', 1, 9], ['List', 30, 40]],
    ]);
    const first = e.at(1);
    expect(first).toBeDefined();
    expect(first!.has('RandomInteger')).toBe(true);
  });

  it('an impure PARTICIPANT still declines at() while each() walks', () => {
    const e = ce.box(['Add', ['RandomShuffle', ['List', 1, 2, 3]], 1]);
    // The walk is one evaluation — coherent within itself, so it works…
    expect([...e.each()]).toHaveLength(3);
    // …but per-index reads spanning generations could mix draw sets.
    expect(e.at(1)).toBeUndefined();
  });

  it('a pure non-broadcast application is unaffected', () => {
    ce.assign(
      'f',
      ce.box(['Function', ['List', 't', ['Multiply', 2, 't']], 't'])
    );
    const app = ce.box(['f', 3]);
    expect(app.at(1)?.toString()).toBe('3');
    expect([...app.each()].map((x) => x.toString())).toEqual(['3', '6']);
  });
});
