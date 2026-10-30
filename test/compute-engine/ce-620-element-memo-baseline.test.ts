import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { validElementMemo } from '../../src/compute-engine/boxed-expression/collection-element-memo';

/**
 * CE-620: the element memo of a lazy collection must compare the state at
 * the start of a walk (when `each()` is called) with the state when the walk
 * is committed. The iterators of `Join` and `Filter` read their operands when
 * `each()` builds them, before the first pull. A change of state between
 * `each()` and the first pull must therefore prevent the commit: if the walk
 * was committed, the elements computed from the old value would be served to
 * later walks and to `at()`.
 *
 * The walk that was started before the change can give the old elements: an
 * iterator reads the state when it computes an element, and the iterator of
 * `Join` computes them when it is built (the same contract as a write made
 * between two pulls, in `collection-element-memo.test.ts`).
 */

function values(it: Iterable<Expression>): number[] {
  return [...it].map((x) => x.re);
}

describe('CE-620: a change between each() and the first pull', () => {
  it('Join: later walks and at() follow the reassignment', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3]));
    const j = ce.box(['Join', 'a', ['List', 9]]);
    const it = j.each();
    ce.assign('a', ce.box(['List', 7, 8]));
    // The walk started before the assignment. Its iterator was built from
    // the old value of `a`.
    expect(values(it)).toEqual([1, 2, 3, 9]);
    expect(values(j.each())).toEqual([7, 8, 9]);
    expect(j.at(1)?.re).toBe(7);
    expect(j.evaluate().toString()).toBe('[7,8,9]');
  });

  it('Join: at() alone follows the reassignment', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3]));
    const j = ce.box(['Join', 'a', ['List', 9]]);
    const it = j.each();
    ce.assign('a', ce.box(['List', 7, 8]));
    values(it);
    expect(j.at(1)?.re).toBe(7);
    expect(j.at(3)?.re).toBe(9);
  });

  it('Filter: later walks and at() follow the reassignment', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3, 4]));
    const f = ce.box(['Filter', 'a', ['Function', ['Greater', 'x', 1], 'x']]);
    const it = f.each();
    ce.assign('a', ce.box(['List', 7, 8]));
    values(it);
    expect(values(f.each())).toEqual([7, 8]);
    expect(f.at(1)?.re).toBe(7);
  });

  it('Map over Join: the walk of the inner Join started by the outer each()', () => {
    // The iterator of `Map` starts the walk of its source when it is built,
    // so the walk of the inner `Join` starts in the outer `each()`.
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3]));
    const j = ce.box(['Join', 'a', ['List', 9]]);
    const m = ce.box(['Map', ['Function', ['Add', 'x', 0], 'x'], j]);
    const it = m.each();
    ce.assign('a', ce.box(['List', 7, 8]));
    values(it);
    expect(values(m.each())).toEqual([7, 8, 9]);
    expect(values(j.each())).toEqual([7, 8, 9]);
    expect(m.at(1)?.re).toBe(7);
  });

  it('a scope pushed between each() and the first pull prevents the commit', () => {
    // A shadowing declaration in a pushed scope changes what a free symbol
    // of the instance reads. The iterator was built outside the scope, from
    // the outer `a`. Its elements must not be committed under the
    // dependencies read inside the scope, where `a` is the inner one.
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3]));
    const j = ce.box(['Join', 'a', ['List', 9]]);
    const it = j.each();
    ce.pushScope();
    try {
      ce.declare('a', 'list<integer>');
      ce.assign('a', ce.box(['List', 5]));
      expect(values(it)).toEqual([1, 2, 3, 9]);
      expect(values(j.each())).toEqual([5, 9]);
      expect(j.at(1)?.re).toBe(5);
    } finally {
      ce.popScope();
    }
    expect(values(j.each())).toEqual([1, 2, 3, 9]);
  });
});

describe('CE-620: what the gap between each() and the first pull keeps', () => {
  let ce: ComputeEngine;
  let calls = 0;
  beforeEach(() => {
    ce = new ComputeEngine();
    calls = 0;
    ce.declare('tick', {
      signature: '(number) -> number',
      // A host operator is cached only when it states `pure: true`.
      pure: true,
      evaluate: (ops) => {
        calls++;
        return ops[0].evaluate();
      },
    });
  });

  function counting(f: () => unknown): number {
    const before = calls;
    f();
    return calls - before;
  }

  it('a write to an unrelated symbol keeps the commit', () => {
    // The dependency snapshot taken when the walk starts does not include
    // `other`, so the write does not move a dependency and the walk is
    // committed. The re-walk calls `tick` again only if neither the element
    // memo nor the pure-application memo has the elements, so the test reads
    // the element memo itself before the re-walk.
    ce.assign('k', 2);
    ce.assign('other', 0);
    const m = ce.box([
      'Map',
      ['Function', ['tick', ['Multiply', 'k', 'n']], 'n'],
      ['Range', 1, 4],
    ]);
    const it = m.each();
    ce.assign('other', 1);
    expect(counting(() => expect(values(it)).toEqual([2, 4, 6, 8]))).toBe(4);
    // The walk that was started before the write is committed.
    expect(validElementMemo(m)?.complete).toBe(true);
    expect(counting(() => expect(values(m.each())).toEqual([2, 4, 6, 8]))).toBe(
      0
    );
  });

  it('a change of the world version prevents the commit', () => {
    // A change of a global setting has no dependency to compare, so it
    // prevents the commit, the same as a change between two pulls.
    const m = ce.box([
      'Map',
      ['Function', ['tick', 'n'], 'n'],
      ['Range', 1, 5],
    ]);
    const it = m.each();
    ce.tolerance = ce.tolerance * 10;
    expect(counting(() => values(it))).toBe(5);
    // The walk was not stored: the count alone would not show it if another
    // memo answered the calls of `tick`.
    expect(validElementMemo(m)).toBeUndefined();
    expect(
      counting(() => expect(values(m.each())).toEqual([1, 2, 3, 4, 5]))
    ).toBe(5);
  });
});
