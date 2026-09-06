import { makeNumericRangeType } from '../../src/common/type/numeric-range';
import type {
  NumericType,
  Type,
  TypeReference,
} from '../../src/common/type/types';
import {
  finalizeInterval,
  intervalOfType,
  powInterval,
  powIntervalSigned,
} from '../../src/compute-engine/numerics/interval-arithmetic';

describe('interval bounds memo', () => {
  test('shares protected intervals and preserves open bounds and finiteness', () => {
    const range = makeNumericRangeType('real', -2, 5, true, false);
    const interval = intervalOfType(range)!;
    expect(interval).toEqual({ lo: -2, hi: 5, loOpen: true, finite: true });
    expect(intervalOfType(range)).toBe(interval);
    expect(Object.isFrozen(interval)).toBe(true);
    expect(powInterval(interval, 1)).toBe(interval);
    expect(Reflect.set(interval, 'lo', 100)).toBe(false);
    expect(intervalOfType(range)?.lo).toBe(-2);

    // Computed intervals remain editable: result handlers clamp the fresh
    // finalized result without changing the operand's shared bounds.
    const finalized = finalizeInterval(interval);
    finalized.lo = 0;
    expect(intervalOfType(range)?.lo).toBe(-2);
    expect(intervalOfType('real')).toBe(intervalOfType('real'));
    expect(intervalOfType('real')).toEqual({
      lo: -Infinity,
      hi: Infinity,
      finite: true,
    });
    expect(intervalOfType('number')).toBeUndefined();
    expect(intervalOfType('number')).toBeUndefined();
  });

  test('identity and reciprocal powers accept frozen operand bounds', () => {
    const interval = intervalOfType(makeNumericRangeType('real', 2, 4, true))!;
    expect(powInterval(intervalOfType('real')!, 1)).toBe(
      intervalOfType('real')
    );
    expect(powIntervalSigned(interval, 1)).toBe(interval);
    expect(powIntervalSigned(interval, -1)).toEqual({
      lo: 0.25,
      hi: 0.5,
      hiOpen: true,
      finite: true,
    });
    expect(interval).toEqual({ lo: 2, hi: 4, loOpen: true, finite: true });
  });

  test('does not retain answers for mutable types or shallow-frozen parents', () => {
    const range: NumericType = {
      kind: 'numeric',
      type: 'real',
      lower: 1,
      upper: 2,
    };
    const parent: Type = Object.freeze({
      kind: 'union',
      types: [range],
    });
    Object.freeze(parent.types);
    expect(intervalOfType(range)?.lo).toBe(1);
    expect(intervalOfType(parent)?.lo).toBe(1);
    range.lower = -3;
    expect(intervalOfType(range)?.lo).toBe(-3);
    expect(intervalOfType(parent)?.lo).toBe(-3);

    const value: Type = { kind: 'value', value: 'text' };
    expect(intervalOfType(value)).toBeUndefined();
    value.value = 7;
    expect(intervalOfType(value)).toEqual({ lo: 7, hi: 7, finite: true });
  });

  test('alias changes and cyclic traversal contexts never poison shared bounds', () => {
    const alias: TypeReference = {
      kind: 'reference',
      name: 'Bounds',
      alias: true,
      def: makeNumericRangeType('real', 1, 2),
    };
    const nested: Type = Object.freeze({
      kind: 'union',
      types: [alias],
    });
    Object.freeze(nested.types);
    expect(intervalOfType(nested)?.lo).toBe(1);
    alias.def = makeNumericRangeType('real', 4, 6);
    expect(intervalOfType(nested)?.lo).toBe(4);
    expect(intervalOfType(alias, new Set([alias]))).toBeUndefined();
    expect(intervalOfType(alias)?.lo).toBe(4);
    alias.def = alias;
    expect(intervalOfType(nested)).toBeUndefined();
    alias.def = makeNumericRangeType('real', -4, -1);
    expect(intervalOfType(nested)?.lo).toBe(-4);

    const range = makeNumericRangeType('real', 2, 3);
    const cached = intervalOfType(range);
    const contextual = intervalOfType(range, new Set());
    expect(contextual).toEqual(cached);
    expect(contextual).not.toBe(cached);
  });

  test('memoized union and intersection match uncached endpoint calculations', () => {
    const a = makeNumericRangeType('real', -2, 3, true, false);
    const b = makeNumericRangeType('real', 1, 5, false, true);
    for (const kind of ['union', 'intersection'] as const) {
      const type: Type = Object.freeze({ kind, types: [a, b] });
      Object.freeze(type.types);
      const cached = intervalOfType(type);
      expect(cached).toEqual(intervalOfType(type, new Set()));
      expect(intervalOfType(type)).toBe(cached);
      expect(cached).toEqual(
        kind === 'union'
          ? { lo: -2, hi: 5, loOpen: true, hiOpen: true, finite: true }
          : { lo: 1, hi: 3, finite: true }
      );
    }
  });
});
