/**
 * The assumption STORE: what `assume()` records and how the record survives a
 * scope, a `forget()` and a checkpoint restore.
 *
 * An assumption is a FACT about the current scope's state, so the store maps
 * a normalized fact expression to a list of frozen assertion records, each
 * naming the value DEFINITIONS the fact is about. These tests pin the store's
 * mechanics — the map's `size`/`version` counters, the subject a record
 * carries, the copy-on-push lifetime of a record list and of the assumed-value
 * overlay, and the fact index's cache key. What a fact PROVES about a type is
 * pinned by `assumptions.test.ts`; nothing here asserts on types.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { ExpressionMap } from '../../src/compute-engine/boxed-expression/expression-map';
import { getFactIndex } from '../../src/compute-engine/boxed-expression/constraint-subject';
import type { FactRecord } from '../../src/compute-engine/global-types';

import '../utils'; // For snapshot serializers

describe('ExpressionMap size and version', () => {
  const ce = new ComputeEngine();

  test('an empty map has size 0 and version 0', () => {
    const map = new ExpressionMap<boolean>();
    expect(map.size).toBe(0);
    expect(map.version).toBe(0);
  });

  test('set and delete advance the version and track the size', () => {
    const map = new ExpressionMap<boolean>();
    map.set(ce.box('a'), true);
    expect(map.size).toBe(1);
    expect(map.version).toBeGreaterThan(0);

    const afterSet = map.version;
    map.delete(ce.box('a'));
    expect(map.size).toBe(0);
    expect(map.version).toBeGreaterThan(afterSet);
  });

  test('a copy carries the source entries but starts its own version at 0', () => {
    const source = new ExpressionMap<boolean>();
    source.set(ce.box('a'), true);
    source.set(ce.box('b'), true);

    const copy = new ExpressionMap(source);
    expect(copy.size).toBe(2);
    expect(copy.version).toBe(0);
  });

  test('clear empties the map but leaves the version above zero', () => {
    const map = new ExpressionMap<boolean>();
    map.set(ce.box('a'), true);
    const afterSet = map.version;

    map.clear();
    expect(map.size).toBe(0);
    // The version counts MUTATIONS, so an emptied map is distinguishable
    // from one that was never written to.
    expect(map.version).toBeGreaterThan(afterSet);
  });
});

describe('assume() records a fact against its subject definition', () => {
  test('a record names the value definition of the symbol the fact is about', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.assume(ce.parse('x > 3'))).toBe('ok');

    const store = ce.context.assumptions;
    expect(store.size).toBe(1);

    const [[, records]] = [...store.entries()];
    expect(records).toHaveLength(1);
    expect(records[0].truth).toBe(true);
    expect(records[0].subjects).toHaveLength(1);
    expect(records[0].subjects[0].part).toBe('self');

    const def = ce.lookupDefinition('x');
    expect(
      def && 'value' in def ? records[0].subjects[0].def === def.value : false
    ).toBe(true);
  });

  test('forget(name) drops the record and the key with it', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));
    expect(ce.context.assumptions.size).toBe(1);

    ce.forget('x');
    expect(ce.context.assumptions.size).toBe(0);
  });
});

describe('a record list is replaced, never mutated in place', () => {
  test('an inner-scope set on an inherited key leaves the enclosing list alone', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assume(ce.parse('x > 3'));

    const [[key, outerRecords]] = [...ce.context.assumptions.entries()];
    expect(outerRecords).toHaveLength(1);

    ce.pushScope();
    // A scope push shallow-copies the map, so the inner map starts out
    // holding the very same array object. Adding an assertion must install a
    // REPLACEMENT array rather than push onto the shared one.
    const inherited = ce.context.assumptions.get(key)!;
    expect(inherited).toBe(outerRecords);

    const extra: FactRecord = Object.freeze({
      id: ce._nextFactId(),
      truth: true,
      subjects: [],
    });
    ce.context.assumptions.set(key, [...inherited, extra]);
    expect(ce.context.assumptions.get(key)).toHaveLength(2);
    expect(outerRecords).toHaveLength(1);

    ce.popScope();
    expect(ce.context.assumptions.get(key)).toBe(outerRecords);
    expect(outerRecords).toHaveLength(1);
  });
});

describe('the assumed-value overlay', () => {
  test('assume(x = v) records the value against the definition it landed on', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('z = 5'))).toBe('ok');

    expect(ce.context.assumedValues.size).toBe(1);
    const [[def, value]] = [...ce.context.assumedValues.entries()];
    expect(value.is(5)).toBe(true);

    const lookedUp = ce.lookupDefinition('z');
    expect(
      lookedUp && 'value' in lookedUp ? def === lookedUp.value : false
    ).toBe(true);
  });

  test('an inner-scope entry is dropped by the pop, the inherited one survives', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('z = 5'));

    ce.pushScope();
    // The push copies the overlay, so the enclosing entry is in force here.
    expect(ce.context.assumedValues.size).toBe(1);
    ce.assume(ce.parse('w = 7'));
    expect(ce.context.assumedValues.size).toBe(2);

    ce.popScope();
    expect(ce.context.assumedValues.size).toBe(1);
  });

  test('a no-argument forget() empties the overlay', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('z = 5'));
    expect(ce.context.assumedValues.size).toBe(1);

    ce.forget();
    expect(ce.context.assumedValues.size).toBe(0);
  });
});

describe('checkpoint restore round-trips the store', () => {
  test('records and overlay entries come back after a forget', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.assume(ce.parse('p > 3'));
    ce.assume(ce.parse('q = 5'));

    const cp = ce.checkpoint();
    expect(ce.context.assumptions.size).toBe(1);
    expect(ce.context.assumedValues.size).toBe(1);

    ce.forget();
    expect(ce.context.assumptions.size).toBe(0);
    expect(ce.context.assumedValues.size).toBe(0);

    ce.restore(cp);
    expect(ce.context.assumptions.size).toBe(1);
    expect(ce.context.assumedValues.size).toBe(1);

    // The restored record is the record — its subject reference survives,
    // because the journal restores definition records in place rather than
    // replacing them.
    const [[, records]] = [...ce.context.assumptions.entries()];
    expect(records[0].truth).toBe(true);
    const def = ce.lookupDefinition('p');
    expect(
      def && 'value' in def ? records[0].subjects[0].def === def.value : false
    ).toBe(true);
  });
});

describe('the fact index rides with the assumptions map', () => {
  test('two consecutive reads share one index; a new assumption builds another', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'real');
    ce.assume(ce.parse('g > 3'));

    const first = getFactIndex(ce);
    expect(getFactIndex(ce)).toBe(first);

    ce.assume(ce.parse('g < 10'));
    expect(getFactIndex(ce)).not.toBe(first);
  });
});
