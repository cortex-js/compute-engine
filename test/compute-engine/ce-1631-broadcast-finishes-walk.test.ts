import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';

/**
 * An element-wise broadcast that reads every element of a collection
 * finishes its walk, so the element memo keeps the walk, and a later read of
 * the same collection gives the same draws (`docs/RANDOMNESS-MODEL.md` §6,
 * "One instance, one draw set"). The broadcast routes are `zip()` and
 * `broadcastOverIndexedCollections()` in `collection-utils.ts` (CE-1631).
 */

function randomList(ce: ComputeEngine, n: number): Expression {
  return ce.expr([
    'Comprehension',
    ['Random'],
    ['Element', 'k', ['Range', 1, n]],
  ]);
}

function drawsUsed(ce: ComputeEngine): number | undefined {
  return (ce as unknown as { _randomFrame?: { next: number } })._randomFrame
    ?.next;
}

function reals(x: Expression): number[] {
  return [...x.each()].map((e) => e.re);
}

describe('CE-1631: a broadcast that reads a whole random list keeps its draws', () => {
  test('Add of an evaluated comprehension and 10, then a read of the list', () => {
    const ce = new ComputeEngine();
    const h = randomList(ce, 6).evaluate();
    withRandomSeedFrame(ce, 42, () => {
      const q = ce.expr(['Add', h, 10]).evaluate();
      const later = reals(h);
      expect(reals(q)).toEqual(later.map((x) => x + 10));
      expect(drawsUsed(ce)).toBe(6);
    });
  });

  test('Add of a symbol that holds a comprehension and 10', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'list<real>');
    ce.assign('h', randomList(ce, 6));
    withRandomSeedFrame(ce, 42, () => {
      const q = ce.parse('h + 10').evaluate();
      const later = reals(ce.expr('h').evaluate());
      expect(reals(q)).toEqual(later.map((x) => x + 10));
      expect(drawsUsed(ce)).toBe(6);
    });
  });

  test('the zip() route: Mod with a list operand and Power with a scalar', () => {
    const ce = new ComputeEngine();
    const h = randomList(ce, 6).evaluate();
    withRandomSeedFrame(ce, 42, () => {
      const m = ce.expr(['Mod', h, ['List', 1, 1, 1, 1, 1, 1]]).evaluate();
      const later = reals(h);
      expect(reals(m)).toEqual(later);
      expect(drawsUsed(ce)).toBe(6);
    });
    const g = randomList(ce, 6).evaluate();
    withRandomSeedFrame(ce, 42, () => {
      const p = ce.expr(['Power', g, 2]).evaluate();
      const later = reals(g);
      reals(p).forEach((x, i) => expect(x).toBeCloseTo(later[i] ** 2, 12));
      expect(drawsUsed(ce)).toBe(6);
    });
  });

  test('a shortest-zip consumer draws no element of a longer list that it does not use', () => {
    const ce = new ComputeEngine();
    const h = randomList(ce, 6).evaluate();
    withRandomSeedFrame(ce, 42, () => {
      const p = ce.expr(['PointList', h, ['List', 1, 2]]).evaluate();
      expect(p.count).toBe(2);
      expect(drawsUsed(ce)).toBe(2);
    });
  });
});
