/**
 * `Nothing` (erasure) vs `Missing` (absent-but-positioned) — the ratified
 * semantics (2026-07-22, BREAKING).
 *
 *  1. `Nothing` is an ERASURE marker (an empty-sequence splice). It is elided
 *     from operator argument lists AND from collections.
 *  2. Out-of-band access is POSITION-PRESERVING and yields a marker chosen by
 *     the collection's element type: `NaN` when numeric, `Missing` otherwise.
 *  3. `Missing` means "a position exists, its value is absent" (Julia
 *     `missing`, R `NA`). It is never erased, and it propagates.
 *  4. Statistics SKIP `Nothing` and PROPAGATE `Missing`/`NaN`.
 *  5. Boolean-mask indexing still DROPS — a mask is a filter, so compaction is
 *     correct there.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

const ev = (x: any): Expression => ce.box(x).evaluate();

describe('Nothing ERASES in collections', () => {
  test('a Nothing element is spliced out of a list literal', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    expect(l.toString()).toBe('[12,34]');
    expect(ev(['Length', l]).re).toBe(2);
    expect(l.type.toString()).toBe('vector<finite_integer^2>');
  });

  test('At sees the compacted positions', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    expect(ev(['At', l, 2]).re).toBe(34);
  });

  test('Map over a list with an erased element maps the survivors only', () => {
    const l = ce.box(['List', 12, 'Nothing', 34]);
    const mapped = ev(['Map', l, ['Function', ['Add', 'x', 1], 'x']]);
    expect(mapped.toString()).toBe('[13,35]');
  });

  test('a mapping function returning Nothing erases its element (mapMaybe)', () => {
    const m = ce.box(['Map', ['List', 1, 2, 3], ['Function', 'Nothing', 'x']]);
    // Iteration splices the erased elements out...
    expect(Array.from(m.each())).toEqual([]);
    // ...and materializing the lazy `Map` yields the empty list.
    const mapped = m.evaluate({ materialization: true });
    expect(mapped.operator).toBe('List');
    expect(mapped.nops).toBe(0);
  });

  test('a mapping function returning Nothing for SOME elements erases only those', () => {
    const m = ce.box([
      'Map',
      ['List', 1, 2, 3],
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
    ]);
    expect(m.evaluate({ materialization: true }).toString()).toBe('[1,3]');
  });

  test('Nothing is still elided from an operand list (unchanged)', () => {
    expect(ce.box(['Add', 'Nothing', 1]).toString()).toBe('1');
    expect(ev(['Add', 'Nothing', 1]).re).toBe(1);
  });
});

describe('Missing is NOT erased and propagates', () => {
  test('a Missing element keeps its position in a list', () => {
    const l = ce.box(['List', 1, 'Missing', 3]);
    expect(ev(['Length', l]).re).toBe(3);
    expect(l.type.toString()).toBe('list<finite_integer | missing>');
    expect(ev(['At', l, 2]).symbol).toBe('Missing');
  });

  test('Missing has the `missing` unit type', () => {
    expect(ce.Missing.symbol).toBe('Missing');
    expect(ce.Missing.type.toString()).toBe('missing');
  });

  test('Missing propagates through arithmetic', () => {
    expect(ce.box(['Add', 'Missing', 1]).symbol).toBe('Missing');
    expect(ev(['Add', 'Missing', 1]).symbol).toBe('Missing');
    expect(ev(['Multiply', 'Missing', 3]).symbol).toBe('Missing');
    expect(ev(['Divide', 1, 'Missing']).symbol).toBe('Missing');
    expect(ev(['Sqrt', 'Missing']).symbol).toBe('Missing');
  });

  test('Missing propagates through a numeric function', () => {
    expect(ev(['Sin', 'Missing']).symbol).toBe('Missing');
  });
});

describe('out-of-band access is position-preserving', () => {
  const nums = ['List', 10, 20, 30];
  const strs = ['List', { str: 'a' }, { str: 'b' }];

  test('a scalar out-of-range index on a numeric list yields NaN', () => {
    expect(ev(['At', nums, 9]).isNaN).toBe(true);
    expect(ev(['At', nums, 0]).isNaN).toBe(true);
  });

  test('a gather keeps the index list length, marking out-of-range slots', () => {
    const g = ev(['At', nums, ['List', 0, 1, 2]]);
    expect(g.operator).toBe('List');
    expect(g.nops).toBe(3);
    expect(g.op1.isNaN).toBe(true);
    expect(g.op2.re).toBe(10);
    expect(g.op3.re).toBe(20);
  });

  test('a non-numeric collection yields Missing instead of NaN', () => {
    expect(ev(['At', strs, 5]).symbol).toBe('Missing');
    const g = ev(['At', strs, ['List', 1, 5]]);
    expect(g.nops).toBe(2);
    expect(g.op1.string).toBe('a');
    expect(g.op2.symbol).toBe('Missing');
  });

  test('a boolean mask still DROPS (a mask is a filter)', () => {
    const m = ev(['At', nums, ['List', 'True', 'False', 'True', 'True']]);
    expect(m.operator).toBe('List');
    expect(m.nops).toBe(2);
    expect(m.op1.re).toBe(10);
    expect(m.op2.re).toBe(30);
  });

  test('a missing dictionary key yields the marker', () => {
    const numeric = { dict: { a: 1, b: 2 } };
    expect(ce.box(['At', numeric, { str: 'z' }] as any).evaluate().isNaN).toBe(
      true
    );
    const strings = { dict: { a: { str: 'x' } } };
    expect(ce.box(['At', strings, { str: 'z' }] as any).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('the marker is never Nothing (it would erase the position)', () => {
    expect(ev(['At', nums, 9]).symbol).not.toBe('Nothing');
    expect(ev(['At', strs, 9]).symbol).not.toBe('Nothing');
  });
});

describe('statistics: Nothing skips, Missing and NaN propagate', () => {
  test('Nothing is skipped', () => {
    // (The list literal already splices it out; the statistic is over [1, 3].)
    expect(ev(['Mean', ['List', 1, 'Nothing', 3]]).re).toBe(2);
    expect(ev(['Median', ['List', 1, 'Nothing', 3]]).re).toBe(2);
  });

  test('Missing propagates', () => {
    expect(ev(['Mean', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ev(['Median', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ev(['Variance', ['List', 1, 'Missing', 3]]).symbol).toBe('Missing');
    expect(ce.box(['Mean', ['List', 1, 'Missing', 3]]).N().symbol).toBe(
      'Missing'
    );
  });

  test('NaN propagates', () => {
    expect(ev(['Mean', ['List', 1, 'NaN', 3]]).isNaN).toBe(true);
    expect(ce.box(['Mean', ['List', 1, 'NaN', 3]]).N().isNaN).toBe(true);
  });
});
