import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { Type } from '../../src/common/type/types';
import {
  indexReadTupleAtCollectionSlot,
  indexReadTupleExtension,
  isIndexReadTuple,
  markIndexReadTuple,
} from '../../src/compute-engine/boxed-expression/index-read-tuple';
import { ComputeEngine } from '../../src/compute-engine';

// `indexReadTupleAtCollectionSlot` (`boxed-expression/index-read-tuple.ts`)
// gives the type a bare parameter typed only by its index reads (`p[2] + 1`
// gives `tuple<unknown, number>`) takes at a slot that requires a collection
// that is not a tuple. With a union requirement, it kept only the filled
// tuples when any arm gave one, so `indexed_collection<integer> |
// list<real>` became `tuple<integer, integer>` and the `list<real>`
// alternative was lost; the union it built was not reduced (duplicate arms
// stayed), and a filled tuple was checked against the whole requirement, not
// against its own arm.

function reads(...components: Type[]): Type {
  return markIndexReadTuple({
    kind: 'tuple',
    elements: components.map((type) => ({ type })),
  });
}

function show(t: Type | undefined): string {
  return t === undefined ? 'undefined' : typeToString(t);
}

describe('an index-read tuple at a collection slot', () => {
  const current = reads('unknown', 'number');

  test('a single constructor arm the filled tuple satisfies', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer>')
    );
    expect(show(r)).toBe('tuple<integer, integer>');
    expect(isIndexReadTuple(r!)).toBe(true);
  });

  test('a single constructor arm a tuple is not: the arm itself', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('list<number>')
    );
    expect(show(r)).toBe('list<number>');
  });

  test('two arms: the filled tuple of one and the other arm, both kept', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer> | list<real>')
    );
    expect(show(r)).toBe('list<real> | tuple<integer, integer>');
    const tuple = (r as { types: Type[] }).types.find(
      (t) => typeof t === 'object' && t.kind === 'tuple'
    );
    // The mark survives the reduction of the union.
    expect(isIndexReadTuple(tuple!)).toBe(true);
  });

  test('the order of the arms does not change the answer', () => {
    const a = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer> | list<real>')
    );
    const b = indexReadTupleAtCollectionSlot(
      current,
      parseType('list<real> | indexed_collection<integer>')
    );
    expect(show(a)).toBe(show(b));
  });

  test('duplicate arms are reduced', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('list<integer> | list<integer>')
    );
    expect(show(r)).toBe('list<integer>');
  });

  test('a subsumed filled tuple is reduced into the wider one', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer> | indexed_collection<real>')
    );
    expect(show(r)).toBe('tuple<real, real>');
    expect(isIndexReadTuple(r!)).toBe(true);
  });

  test('an arm whose element type conflicts with a read contributes nothing', () => {
    const r = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer> | indexed_collection<string>')
    );
    expect(show(r)).toBe('tuple<integer, integer>');
  });

  test('a union current: the tuple member is filled, admitted members kept', () => {
    const union = indexReadTupleAtCollectionSlot(
      current,
      parseType('indexed_collection<integer> | list<real>')
    )!;
    // A later slot that admits the list member keeps it.
    const r = indexReadTupleAtCollectionSlot(
      union,
      parseType('indexed_collection<number> | string')
    );
    expect(show(r)).toBe('list<real> | tuple<integer, integer>');
    // A later slot that does not admit the list member drops it.
    const s = indexReadTupleAtCollectionSlot(
      union,
      parseType('indexed_collection<integer>')
    );
    expect(show(s)).toBe('tuple<integer, integer>');
    expect(isIndexReadTuple(s!)).toBe(true);
  });

  test('a union without an index-read tuple member: the rule does not apply', () => {
    expect(
      indexReadTupleAtCollectionSlot(
        parseType('list<real> | tuple<integer, integer>'),
        parseType('indexed_collection<number>')
      )
    ).toBeUndefined();
  });

  test('no admitting arm: the rule does not apply', () => {
    expect(
      indexReadTupleAtCollectionSlot(
        current,
        parseType('string | tuple<number>')
      )
    ).toBeUndefined();
    expect(
      indexReadTupleAtCollectionSlot(current, parseType('list<string>'))
    ).toBeUndefined();
  });
});

describe('an index-read tuple at a longer tuple slot after a union slot', () => {
  test('the tuple member is extended and the other members are dropped', () => {
    const union = indexReadTupleAtCollectionSlot(
      reads('unknown', 'number'),
      parseType('indexed_collection<integer> | list<real>')
    )!;
    const r = indexReadTupleExtension(
      union,
      parseType('tuple<integer, integer, integer>')
    );
    expect(show(r)).toBe('tuple<integer, integer, integer>');
    // A contract: no index-read mark.
    expect(isIndexReadTuple(r!)).toBe(false);
  });

  test('a longer tuple whose components conflict: the rule does not apply', () => {
    const union = indexReadTupleAtCollectionSlot(
      reads('unknown', 'number'),
      parseType('indexed_collection<integer> | list<real>')
    )!;
    expect(
      indexReadTupleExtension(union, parseType('tuple<string, string, string>'))
    ).toBeUndefined();
  });

  test('a function literal with a union slot then a three-tuple slot is valid', () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      type: '(indexed_collection<integer> | list<real>) -> number',
    });
    ce.declare('h', { type: '(tuple<integer, integer, integer>) -> number' });
    const fn = ce.box([
      'Function',
      ['Block', ['Add', ['At', 'p', 2], 1], ['g', 'p'], ['h', 'p']],
      'p',
    ]);
    expect(fn.isValid).toBe(true);
    expect(fn.type.toString()).toBe(
      '(p: tuple<integer, integer, integer>) -> number'
    );
  });
});
