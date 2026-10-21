import { parseType } from '../../../src/common/type/parse';
import { isSubtype, couldMatch } from '../../../src/common/type/subtype';
import { reduceType } from '../../../src/common/type/reduce';
import { typeToString } from '../../../src/common/type/serialize';
import { collectionElementType } from '../../../src/common/type/utils';
import { ComputeEngine } from '../../../src/compute-engine';

const families = [
  'list',
  'set',
  'dictionary',
  'collection',
  'indexed_collection',
];

describe('bare collection families constrain kind, not contents', () => {
  test.each(families)(
    '%s is equivalent to its explicit any contract',
    (kind) => {
      const bare = parseType(kind);
      const explicit = parseType(`${kind}<any>`);
      expect(bare).toBe(kind);
      expect(isSubtype(bare, explicit)).toBe(true);
      expect(isSubtype(explicit, bare)).toBe(true);
      expect(collectionElementType(bare)).toEqual(
        collectionElementType(explicit)
      );
      expect(
        isSubtype(parseType(`${kind}<missing | nothing | integer>`), bare)
      ).toBe(true);
      expect(isSubtype('missing', bare)).toBe(false);
    }
  );

  test.each(families)('%s preserves an explicit unknown argument', (kind) => {
    // The explicit `<unknown>` is kept as written (it is a request to infer
    // the contents, which the bare name also is) and denotes the same set
    // of values as the bare name: mutual subtypes (user decision D1,
    // 2026-10-21).
    const spelling = `${kind}<unknown>`;
    const type = parseType(spelling);
    expect(typeToString(type)).toBe(spelling);
    expect(typeToString(reduceType(type))).toBe(spelling);
    expect(isSubtype(parseType(kind), type)).toBe(true);
    expect(isSubtype(type, parseType(kind))).toBe(true);
    expect(isSubtype(type, parseType(`${kind}<expression>`))).toBe(false);
  });

  test('bare tuple accepts arbitrary arity and absent positions', () => {
    for (const spelling of [
      'tuple<integer, missing>',
      'tuple<nothing, error, any>',
      'tuple<string>',
    ]) {
      expect(isSubtype(parseType(spelling), 'tuple')).toBe(true);
      expect(couldMatch('tuple', parseType(spelling))).toBe(true);
    }
    expect(
      isSubtype(parseType('tuple<integer, string>'), parseType('tuple<any>'))
    ).toBe(false);
    expect(isSubtype('tuple', parseType('tuple<any>'))).toBe(false);
    expect(isSubtype('tuple', parseType('indexed_collection<any>'))).toBe(true);
    expect(isSubtype('tuple', parseType('indexed_collection<integer>'))).toBe(
      false
    );
  });

  test('bare record accepts absent fields without losing kind', () => {
    expect(
      isSubtype(parseType('record{a: missing, b: nothing}'), 'record')
    ).toBe(true);
    expect(isSubtype('record', parseType('dictionary<any>'))).toBe(true);
    expect(isSubtype('record', parseType('dictionary<integer>'))).toBe(false);
    expect(isSubtype('dictionary', 'record')).toBe(false);
  });

  test('explicit numeric and expression contracts retain their restrictions', () => {
    expect(
      isSubtype(parseType('list<missing>'), parseType('list<integer>'))
    ).toBe(false);
    expect(
      isSubtype(parseType('list<missing>'), parseType('list<expression>'))
    ).toBe(false);
    expect(
      isSubtype(parseType('list<list<missing>>'), parseType('list<value>'))
    ).toBe(true);
    expect(collectionElementType(parseType('vector'))).toBe('number');
    expect(parseType('matrix')).toMatchObject({
      elements: 'number',
      dimensions: [-1, -1],
    });
  });

  test('TupleFrom reports a type that contains absent coordinates', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | missing>');
    ce.assign('xs', ce.box(['List', 1, 'Missing']));
    const expr = ce.box(['TupleFrom', 'xs']);
    const value = expr.evaluate();
    expect(value.json).toEqual(['Tuple', 1, 'Missing']);
    expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  });
});
