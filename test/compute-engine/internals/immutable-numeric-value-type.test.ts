import { ComputeEngine } from '../../../src/compute-engine';
import { BoxedNumber } from '../../../src/compute-engine/boxed-expression/boxed-number';
import { computeBroadcastCell } from '../../../src/compute-engine/boxed-expression/broadcast-cell-widening';
import { MachineNumericValue } from '../../../src/compute-engine/numeric-value/machine-numeric-value';
import { factsOf, isStableType } from '../../../src/common/type/facts';
import {
  immutableNumericValueType,
  immutableNumericType,
  isKnownImmutableType,
} from '../../../src/common/type/immutable';
import { typeToString } from '../../../src/common/type/serialize';
import { widenValueTypes } from '../../../src/common/type/widen-value';

const ce = new ComputeEngine();

describe('Shared immutable numeric literal types', () => {
  test.each([0, 21, -3, 0.5, NaN, Infinity, -Infinity])(
    'shares type identity and facts for %s',
    (value) => {
      const a = new BoxedNumber(ce, value);
      const b = new BoxedNumber(ce, value);
      expect(a).not.toBe(b);
      expect(a._literalType).toBe(b._literalType);
      const t = a._literalType!;
      expect(t).toBe(immutableNumericValueType(value));
      expect(Object.isFrozen(t)).toBe(true);
      expect(isKnownImmutableType(t as object)).toBe(true);
      expect(isStableType(t)).toBe(true);
      expect(a.type).toBe(b.type);
      expect(a.type.facts).toBe(b.type.facts);
      expect(factsOf(t)).toBe(a.type.facts);
      expect(Reflect.set(t as object, 'value', 77)).toBe(false);
      expect(typeToString(t)).toBe(typeToString(b.type.type));
    }
  );

  test('shares public boxes only within one engine resolver', () => {
    const other = new ComputeEngine();
    const a = new BoxedNumber(ce, 217);
    const b = new BoxedNumber(other, 217);
    expect(a._literalType).toBe(b._literalType);
    expect(a.type).not.toBe(b.type);
    expect(a.type.typeResolver).toBe(ce._typeResolver);
    expect(b.type.typeResolver).toBe(other._typeResolver);
    expect(a.type.facts).toBe(b.type.facts);
  });

  test('normalizes negative zero without conflating other values', () => {
    const zero = immutableNumericValueType(-0);
    expect(zero).toBe(immutableNumericValueType(0));
    expect(Object.is(zero.value, 0)).toBe(true);
    expect(immutableNumericValueType(1)).not.toBe(zero);
    expect(immutableNumericValueType(NaN)).not.toBe(zero);
    expect(immutableNumericValueType(Infinity)).not.toBe(
      immutableNumericValueType(-Infinity)
    );
  });

  test('kernel infinities share the public singleton during broadcast too', () => {
    for (const value of [Infinity, -Infinity]) {
      const n = new BoxedNumber(ce, new MachineNumericValue(value));
      const t = immutableNumericValueType(value);
      expect(n._literalType).toBe(t);
      expect(n.type.type).toBe(t);
      expect(computeBroadcastCell(ce, () => n.type.type)).toBe(t);
    }
    expect(factsOf(immutableNumericValueType(NaN)).nan).toBe(true);
    expect(factsOf(immutableNumericValueType(NaN)).infinity).toBe(false);
    expect(factsOf(immutableNumericValueType(Infinity)).infinity).toBe(true);
    expect(factsOf(immutableNumericValueType(Infinity)).finite).toBe(false);
    const complexInfinity = ce.ComplexInfinity._literalType!;
    expect(Object.isFrozen(complexInfinity)).toBe(true);
    expect(isStableType(complexInfinity)).toBe(true);
    expect(typeToString(complexInfinity)).toBe('~oo');
    expect(factsOf(complexInfinity).infinity).toBe(true);
  });

  test('preserves exact rational singleton ranges and inexact enclosures', () => {
    const rational = ce.parse('\\frac12')._literalType!;
    const machine = immutableNumericValueType(0.5);
    expect(typeToString(rational)).toBe('rational<0.5..0.5>');
    expect(factsOf(rational).rational).toBe(true);
    expect(factsOf(machine).rational).toBe(false);
    expect(typeToString(widenValueTypes(rational))).toBe('rational');
    expect(typeToString(widenValueTypes(machine))).toBe('real');
    expect(typeToString(ce.parse('\\frac13')._literalType!)).toBe(
      'rational<0.33..0.34>'
    );
    expect(typeToString(ce.parse('\\sqrt2').evaluate()._literalType!)).toBe(
      'real<1.4..1.5>'
    );
  });

  test('bounded-table eviction changes only identity, never existing facts', () => {
    const old = immutableNumericValueType(-123.125);
    const oldFacts = factsOf(old);
    expect(oldFacts.real).toBe(true);
    for (let i = 0; i <= 4096; i++) immutableNumericValueType(100000 + i);
    const fresh = immutableNumericValueType(-123.125);
    expect(fresh).not.toBe(old);
    expect(fresh).toEqual(old);
    expect(factsOf(old)).toBe(oldFacts);
    expect(oldFacts.real).toBe(true);
    expect(factsOf(fresh).real).toBe(true);
    expect(immutableNumericValueType(-123.125)).toBe(fresh);
  });
});

describe('Shared immutable numeric ranges', () => {
  test('identical range and sign leaves share facts without losing precision', () => {
    const a = immutableNumericType('real', 1.4, 1.5);
    const b = immutableNumericType('real', 1.4, 1.5);
    expect(a).toBe(b);
    expect(factsOf(a)).toBe(factsOf(b));
    expect(Object.isFrozen(a)).toBe(true);
    expect(Reflect.set(a, 'upper', 2)).toBe(false);
    expect(typeToString(a)).toBe('real<1.4..1.5>');
    expect(immutableNumericType('real', 0, undefined, true)).toBe(
      immutableNumericType('real', 0, undefined, true)
    );
    expect(ce.parse('\\sqrt2').evaluate()._literalType).toBe(a);
    const rational = immutableNumericType('rational', 0.5, 0.5);
    expect(ce.parse('\\frac12')._literalType).toBe(rational);
  });

  test('keys preserve tiers, absent endpoints, signed zero, NaN and openness', () => {
    const variants = [
      immutableNumericType('real'),
      immutableNumericType('real', -Infinity, Infinity),
      immutableNumericType('real', undefined, Infinity),
      immutableNumericType('real', -Infinity),
      immutableNumericType('real', 0),
      immutableNumericType('real', -0),
      immutableNumericType('real', undefined, 0),
      immutableNumericType('real', undefined, -0),
      immutableNumericType('real', NaN),
      immutableNumericType('real', undefined, NaN),
      immutableNumericType('real', 1, 2),
      immutableNumericType('rational', 1, 2),
      immutableNumericType('real', 1, 2, true),
      immutableNumericType('real', 1, 2, false, true),
      immutableNumericType('real', 1, 2, true, true),
    ];
    expect(new Set(variants).size).toBe(variants.length);
    expect(Object.is(immutableNumericType('real', -0).lower, -0)).toBe(true);
    expect(immutableNumericType('real', NaN)).toBe(
      immutableNumericType('real', NaN)
    );
    expect(immutableNumericType('real', 1, 2, false, false)).toBe(
      immutableNumericType('real', 1, 2)
    );
  });

  test('range-table eviction preserves live type objects and their facts', () => {
    const old = immutableNumericType('real', -123.125, 17.75, true);
    const oldFacts = factsOf(old);
    expect(oldFacts.finite).toBe(true);
    for (let i = 0; i <= 4096; i++) immutableNumericType('integer', 100000 + i);
    const fresh = immutableNumericType('real', -123.125, 17.75, true);
    expect(fresh).not.toBe(old);
    expect(fresh).toEqual(old);
    expect(factsOf(old)).toBe(oldFacts);
    expect(oldFacts.finite).toBe(true);
    expect(factsOf(fresh).finite).toBe(true);
  });
});
