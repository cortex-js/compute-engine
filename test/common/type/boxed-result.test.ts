import { BoxedType } from '../../../src/common/type/boxed-type';
import { parseType } from '../../../src/common/type/parse';
import type { Type, TypeResolver } from '../../../src/common/type/types';
import { ComputeEngine } from '../../../src/compute-engine';
import * as typeFacts from '../../../src/common/type/facts';
import * as valueWidening from '../../../src/common/type/widen-value';

describe('boxed handler results', () => {
  test('normalizes an invalid error-bearing type without asserting subtype widening', () => {
    // Static diagnostics can temporarily type Coalesce(d.missing, 0)
    // as this unreduced union. `error` poisons the type during reduction;
    // it is an invalid-type sentinel, not a supertype of the literal.
    const input: Type = {
      kind: 'union',
      types: ['error', { kind: 'value', value: 0 }],
    };
    const assertion = jest
      .spyOn(console, 'assert')
      .mockImplementation(() => {});
    try {
      expect(BoxedType.forResult(input).type).toBe('error');
      expect(assertion.mock.calls.every(([condition]) => condition)).toBe(true);
    } finally {
      assertion.mockRestore();
    }
  });

  test('shares normalized immutable results and retains intentional ranges', () => {
    const literalTuple = parseType('tuple<2, 3>');
    const a = BoxedType.forResult(literalTuple);
    expect(a.toString()).toBe('tuple<integer, integer>');
    expect(BoxedType.forResult(literalTuple)).toBe(a);
    const normalized = a.type;
    if (typeof normalized !== 'object' || normalized.kind !== 'tuple')
      throw new Error('Expected the normalized tuple');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.elements)).toBe(true);
    expect(Object.isFrozen(normalized.elements[0])).toBe(true);
    expect(() => {
      normalized.elements[0].type = 'string';
    }).toThrow();
    expect(BoxedType.forResult(literalTuple).toString()).toBe(
      'tuple<integer, integer>'
    );
    expect(BoxedType.forResult(a)).toBe(a);
    const range = BoxedType.forResult('real<2..3>');
    expect(range.toString()).toBe('real<2..3>');
    expect(BoxedType.forResult(range)).toBe(range);
    expect(BoxedType.forResult(undefined)).toBeUndefined();
  });

  test.each(['2', 'real<2..3>', 'tuple<2, 3>'])(
    'rejects a replaced boxed result for immutable input %s',
    (source) => {
      const raw = parseType(source);
      const result = BoxedType.forResult(raw);
      const expected = result.toString();
      (result as { type: Type }).type = 'string';
      const next = BoxedType.forResult(raw);
      expect(next).not.toBe(result);
      expect(next.toString()).toBe(expected);
      expect(BoxedType.forResult(raw)).toBe(next);
    }
  );

  test('renormalizing a replaced box cannot recertify old cache entries', () => {
    const raw = parseType('real<2..3>');
    const boxed = BoxedType.forResult(raw);
    (boxed as { type: Type }).type = parseType('real<4..5>');
    expect(BoxedType.forResult(boxed).toString()).toBe('real<4..5>');
    expect(BoxedType.forResult(raw).toString()).toBe('real<2..3>');
  });

  test('restoring a from-cache key cannot recertify a different result entry', () => {
    const first = parseType('real<2..3>');
    const second = parseType('real<4..5>');
    const boxed = BoxedType.from(first);
    (boxed as { type: Type }).type = second;
    BoxedType.forResult(boxed);
    (boxed as { type: Type }).type = first;
    expect(BoxedType.forResult(first).toString()).toBe('real<2..3>');
    expect(BoxedType.forResult(second).toString()).toBe('real<4..5>');
  });

  test('frozen boxed types support lazy facts and handler normalization', () => {
    const ce = new ComputeEngine();
    const boxed = new BoxedType('real<2..3>', ce._typeResolver);
    Object.freeze(boxed);
    expect(boxed.matches('real')).toBe(true);
    expect(boxed.facts.real).toBe(true);
    expect(BoxedType.forResult(boxed)).toBe(boxed);
    ce.declare('FrozenResult', {
      signature: '() -> real',
      type: () => boxed,
    });
    expect(ce.box(['FrozenResult']).type).toBe(boxed);
  });

  test('does not memoize mutable literal cargo behind a frozen root', () => {
    const value = { kind: 'value' as const, value: 2 };
    const type = Object.freeze({ kind: 'list' as const, elements: value });
    expect(BoxedType.forResult(type).toString()).toBe('list<integer>');
    value.value = 2.5;
    expect(BoxedType.forResult(type).toString()).toBe('list<real>');
  });

  test('keeps resolver caches separate and preserves existing boxed evidence', () => {
    const resolver = (): TypeResolver => ({
      names: [],
      forward: () => undefined,
      resolve: () => undefined,
    });
    const a = resolver();
    const b = resolver();
    expect(BoxedType.from('real', a)).not.toBe(BoxedType.from('real', b));
    expect(BoxedType.forResult(BoxedType.real, a).typeResolver).toBe(a);
    const raw = parseType('real<2..3>');
    BoxedType.forResult(raw, a);
    const supplied = new BoxedType(raw, a);
    expect(BoxedType.forResult(supplied, b)).toBe(supplied);
  });

  test('normalizes an ordinary boxed type at both application boundaries', () => {
    const ce = new ComputeEngine();
    ce.declare('EchoResult', {
      signature: '(number) -> number',
      type: ([operand], { engine }) => engine.type(operand.type),
    });
    ce.declare('RecursiveResult', {
      signature: '(number) -> number',
      type: (operands, { engine, derive }) =>
        engine.type(derive('EchoResult', operands)!),
    });
    expect(ce.box(['EchoResult', 2]).type.toString()).toBe('integer');
    expect(ce.box(['RecursiveResult', 2]).type.toString()).toBe('integer');
  });

  test('reuses an unchanged handler box in the stored application type', () => {
    const ce = new ComputeEngine();
    const result = new BoxedType('real<2..3>', ce._typeResolver);
    ce.declare('PreciseResult', {
      signature: '() -> real',
      type: () => result,
    });
    expect(ce.box(['PreciseResult']).type).toBe(result);
  });

  test('hot pattern matches remain exact for bottom, top and mutable types', () => {
    const raw = { kind: 'value' as const, value: 2 };
    const mutable = new BoxedType(raw);
    expect(mutable.matches('integer')).toBe(true);
    raw.value = 2.5;
    expect(mutable.matches('integer')).toBe(false);
    expect(new BoxedType('never').matches('real')).toBe(true);
    expect(new BoxedType('unknown').matches('number')).toBe(false);
    for (const t of ['real', 'integer', 'nan'] as Type[]) {
      expect(new BoxedType(t).facts).toBe(new BoxedType(t).facts);
    }
  });

  test('retains its facts record while mutable descendants remain live', () => {
    const members: Type[] = ['integer'];
    const raw = Object.freeze({ kind: 'union' as const, types: members });
    const boxed = new BoxedType(raw);
    const lookup = jest.spyOn(typeFacts, 'factsOf');
    try {
      const facts = boxed.facts;
      expect(facts.real).toBe(true);
      members.push('string');
      expect(boxed.facts).toBe(facts);
      expect(boxed.facts.real).toBe(false);
      expect(lookup).toHaveBeenCalledTimes(1);

      // JavaScript callers can still replace a compile-time readonly field.
      // The cached record must follow the actual type identity in that case.
      (boxed as { type: Type }).type = 'string';
      expect(boxed.facts).not.toBe(facts);
      expect(boxed.facts.type).toBe('string');
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      lookup.mockRestore();
    }
  });

  test('an immutable normalized box skips repeated stability and widening work', () => {
    const stable = BoxedType.forResult('real<2..3>');
    const stability = jest.spyOn(typeFacts, 'isStableType');
    const widening = jest.spyOn(valueWidening, 'widenValueTypes');
    try {
      expect(BoxedType.forResult(stable)).toBe(stable);
      expect(BoxedType.forResult(stable)).toBe(stable);
      expect(stability).not.toHaveBeenCalled();
      expect(widening).not.toHaveBeenCalled();
    } finally {
      stability.mockRestore();
      widening.mockRestore();
    }
    const raw = { kind: 'numeric' as const, type: 'real' as const, lower: 2 };
    const mutable = BoxedType.forResult(raw);
    (mutable as { type: Type }).type = { kind: 'value', value: 2.5 };
    expect(BoxedType.forResult(mutable).type).toBe('real');
    const members: Type[] = ['integer'];
    const live = BoxedType.forResult({ kind: 'union', types: members });
    members.push({ kind: 'value', value: 2.5 });
    expect(BoxedType.forResult(live).type).toBe('real');
  });
});
