/**
 * The clamps `_IA.atLeast` and `_IA.atMost`, which the pass `narrow` of the
 * interval mode of the IR pipeline calls on an arm whose condition bounds a
 * value: no outward step, the kind and marks of the value kept, the value
 * itself when nothing changes or nothing can be clamped.
 */

import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';

const c = { lo: 0, hi: 0 };

describe('atLeast and atMost', () => {
  test('a bare interval', () => {
    expect(IA.atLeast({ lo: -1, hi: 2 }, c)).toEqual({ lo: 0, hi: 2 });
    expect(IA.atMost({ lo: -1, hi: 2 }, c)).toEqual({ lo: -1, hi: 0 });
    // An enclosure `c` (an inexact constant): its lower end, its upper end.
    expect(IA.atLeast({ lo: 3, hi: 4 }, { lo: 3.1, hi: 3.2 })).toEqual({
      lo: 3.1,
      hi: 4,
    });
    expect(IA.atMost({ lo: 3, hi: 4 }, { lo: 3.1, hi: 3.2 })).toEqual({
      lo: 3,
      hi: 3.2,
    });
  });

  test('nothing to change: the value itself', () => {
    for (const v of [
      { lo: 1, hi: 2 },
      { kind: 'interval' as const, value: { lo: 1, hi: 2 } },
    ])
      expect(IA.atLeast(v, c)).toBe(v);
    for (const v of [
      { lo: -2, hi: -1 },
      { kind: 'interval' as const, value: { lo: -2, hi: 0 } },
    ])
      expect(IA.atMost(v, c)).toBe(v);
  });

  test('an interval and a partial keep their kind and clip', () => {
    expect(
      IA.atLeast({ kind: 'interval', value: { lo: -1, hi: 1 } }, c)
    ).toEqual({ kind: 'interval', value: { lo: 0, hi: 1 } });
    const partial = {
      kind: 'partial' as const,
      value: { lo: -1, hi: 1 },
      domainClipped: 'lo' as const,
    };
    expect(IA.atLeast(partial, c)).toEqual({ ...partial, value: { lo: 0, hi: 1 } });
    expect(IA.atMost(partial, c)).toEqual({ ...partial, value: { lo: -1, hi: 0 } });
    expect(partial.value).toEqual({ lo: -1, hi: 1 });
  });

  test('a jump keeps at and continuity', () => {
    const jump = {
      kind: 'singular' as const,
      at: 0.5,
      continuity: 'right' as const,
      value: { lo: -1, hi: 1 },
    };
    expect(IA.atLeast(jump, c)).toEqual({ ...jump, value: { lo: 0, hi: 1 } });
    expect(IA.atMost(jump, c)).toEqual({ ...jump, value: { lo: -1, hi: 0 } });
  });

  test('nothing to clamp: the value unchanged', () => {
    for (const v of [
      { kind: 'empty' as const },
      { kind: 'entire' as const },
      { kind: 'singular' as const, at: 0 },
      { lo: NaN, hi: NaN },
      { lo: -1, hi: NaN },
    ]) {
      expect(IA.atLeast(v, c)).toBe(v);
      expect(IA.atMost(v, c)).toBe(v);
    }
    const v = { lo: -1, hi: 1 };
    for (const k of [
      { kind: 'empty' as const },
      { kind: 'entire' as const },
      { lo: NaN, hi: NaN },
      { lo: -Infinity, hi: 0 },
    ]) {
      expect(IA.atLeast(v, k)).toBe(v);
      expect(IA.atMost(v, k)).toBe(v);
    }
  });

  test('an infinite end of the value is clamped', () => {
    expect(IA.atLeast({ lo: -Infinity, hi: Infinity }, c)).toEqual({
      lo: 0,
      hi: Infinity,
    });
    expect(
      IA.atMost({ kind: 'partial', value: { lo: -Infinity, hi: 3 }, domainClipped: 'lo' }, c)
    ).toEqual({ kind: 'partial', value: { lo: -Infinity, hi: 0 }, domainClipped: 'lo' });
  });

  test('a clamp that would leave no point: the value unchanged', () => {
    const below = { lo: -2, hi: -1 };
    const above = { lo: 1, hi: 2 };
    expect(IA.atLeast(below, c)).toBe(below);
    expect(IA.atMost(above, c)).toBe(above);
  });
});
