import { parseTypePrefix, parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// `parseTypePrefix` parses a type from the START of a string and reports how
// far it consumed, without requiring EOF and without its "did you mean" error
// heuristics reading past the consumed range. It is the entry point used by the
// Epsil parser for type annotations (`x: real = 5`).
//

describe('parseTypePrefix', () => {
  test('a bare type consumes the whole string', () => {
    const { type, end } = parseTypePrefix('real');
    expect(typeToString(type)).toBe('real');
    expect(end).toBe(4);
  });

  test('a type followed by ` = 5` stops just past the type', () => {
    const source = 'real = 5';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('real');
    // The space and `=` are NOT consumed.
    expect(end).toBe(4);
    expect(source.slice(0, end)).toBe('real');
  });

  test('a generic type followed by trailing text', () => {
    const source = 'list<integer>, y';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('list<integer>');
    expect(end).toBe('list<integer>'.length);
    expect(source.slice(0, end)).toBe('list<integer>');
  });

  test('a bounded numeric type followed by trailing source', () => {
    const source = 'integer<0..10> rest';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('integer<0..10>');
    expect(source.slice(0, end)).toBe('integer<0..10>');
  });

  test('a parenthesized function signature followed by ` = 3`', () => {
    const source = '(real) -> real = 3';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('(real) -> real');
    expect(source.slice(0, end)).toBe('(real) -> real');
  });

  test('an invalid type throws, carrying an offset position', () => {
    expect(() => parseTypePrefix('notatype = 5')).toThrow();
    try {
      parseTypePrefix('notatype = 5');
      throw new Error('should have thrown');
    } catch (e) {
      // The offending token is at offset 0; the trailing ` = 5` did not leak
      // into the message.
      expect((e as { position?: number }).position).toBe(0);
      expect((e as { rawMessage?: string }).rawMessage).toContain('notatype');
      expect((e as Error).message).not.toContain('= 5');
    }
  });

  test('the "did you mean" heuristic does not read trailing source', () => {
    // Trailing `set(` in the surrounding source must not surface as a type
    // suggestion: `set` parses as a bare primitive type and parsing stops.
    const { type, end } = parseTypePrefix('set, xs = set(1)');
    expect(typeToString(type)).toBe('set');
    expect(end).toBe(3);
  });

  test('parseType is unchanged (still requires the whole string)', () => {
    expect(typeToString(parseType('real'))).toBe('real');
    expect(() => parseType('real = 5')).toThrow();
  });
});

//
// Braces are part of the type syntax (`record{…}` / `object{…}`), and they are
// also what opens an Epsil block body right after a return-type annotation
// (`function f() -> string { … }`). A `{` the parser does not consume must
// therefore still END a prefix parse: `end` never includes it.
//
describe('parseTypePrefix — the `{` boundary', () => {
  test('a brace after a type ends the prefix', () => {
    const source = 'string { body }';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('string');
    expect(source.slice(0, end)).toBe('string');
  });

  test('a closing brace after a type ends the prefix', () => {
    const source = 'integer }';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('integer');
    expect(source.slice(0, end)).toBe('integer');
  });

  test('a block body after a bare `record` is not a field list', () => {
    // The `{` is followed by `let`, not by `<name> :`, so `record` is the
    // bare primitive type and the brace belongs to the caller's grammar.
    const source = 'record { let y = 1 }';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('record');
    expect(source.slice(0, end)).toBe('record');
  });

  test('a field list IS consumed, with or without a space', () => {
    for (const source of [
      'record{x: integer} = {x -> 1}',
      'record {x: integer} = {x -> 1}',
    ]) {
      const { type, end } = parseTypePrefix(source);
      expect(typeToString(type)).toBe('record{x: integer}');
      expect(source.slice(0, end)).toBe(
        source.slice(0, source.indexOf('}') + 1)
      );
    }
  });

  test('`{}` is the EMPTY field list, not an empty block', () => {
    // The ruling: `record{}` (equivalently `record { }`) states a record with
    // no fields — which is the bare `record` type. Where a block is required
    // after the type the reading flips; that is the `blockFollows` group
    // below.
    const source = 'record { }';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('record');
    expect(source.slice(0, end)).toBe('record { }');
  });

  test('a `where` clause past a field list is still found', () => {
    // The clause's variable names are PRE-SCANNED lexically before the type is
    // parsed, so `T` reads as a variable rather than an unknown type name. The
    // scan nests braces like the other brackets to get here.
    const source = '(record{a: T}) -> T where T';
    const { type, end } = parseTypePrefix(source, undefined, undefined, {
      allowWhere: true,
    });
    expect(typeToString(type)).toBe('(record{a: T}) -> T where T');
    expect(source.slice(0, end)).toBe(source);
  });

  test('an object layout is consumed where the layout form is admitted', () => {
    const source = 'object{id: string}\n1';
    const { type, end } = parseTypePrefix(source, undefined, undefined, {
      allowObjectType: true,
    });
    expect(typeToString(type)).toBe('object{id: string}');
    expect(source.slice(0, end)).toBe('object{id: string}');
  });
});

//
// `blockFollows` says the caller will parse a `{ … }` block right after the
// type (with at most a `where` clause in between) — the return type of an
// Epsil `function` declaration. A candidate field list then also has to be
// FOLLOWED by that block, which is what tells a field list apart from a body.
//
describe('parseTypePrefix — `blockFollows`', () => {
  const prefix = (source: string) =>
    parseTypePrefix(source, undefined, undefined, { blockFollows: true });

  test('an empty body is a body, not an empty field list', () => {
    const source = 'record { }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record');
    expect(source.slice(0, end)).toBe('record');
  });

  test('a body whose first statement is an annotation is a body', () => {
    const source = 'record { x: integer }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record');
    expect(source.slice(0, end)).toBe('record');
  });

  test('a field list followed by the block IS a field list', () => {
    const source = 'record{a: integer} { {a -> 1} }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record{a: integer}');
    expect(source.slice(0, end)).toBe('record{a: integer}');
  });

  test('a spaced field list followed by the block IS a field list', () => {
    const source = 'record { a: integer } { {a -> 1} }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record{a: integer}');
    expect(source.slice(0, end)).toBe('record { a: integer }');
  });

  test('a `where` clause may sit between the field list and the block', () => {
    const source = 'record{a: integer} where T { {a -> 1} }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record{a: integer}');
    expect(source.slice(0, end)).toBe('record{a: integer}');
  });

  test('a brace inside a string does not throw the brace count off', () => {
    const source = 'record{a: integer} { "}" }';
    const { type, end } = prefix(source);
    expect(typeToString(type)).toBe('record{a: integer}');
    expect(source.slice(0, end)).toBe('record{a: integer}');
  });
});

//
// An `object{…}` layout is legal only as the definition of a named type, but
// an EMPTY list declares no layout — it builds the bare `object` primitive —
// so it carries no such restriction.
//
describe('the empty `object{}` layout', () => {
  test('`object{}` is the bare `object` type on any route', () => {
    expect(typeToString(parseType('object{}'))).toBe('object');
    expect(typeToString(parseType('object{ }'))).toBe('object');
    const source = 'object{} = 1';
    const { type, end } = parseTypePrefix(source);
    expect(typeToString(type)).toBe('object');
    expect(source.slice(0, end)).toBe('object{}');
  });

  test('a NON-empty layout is still refused off the declaring route', () => {
    expect(() => parseType('object{id: string}')).toThrow(
      'An `object{…}` type may only be the definition of a named type'
    );
    let code: string | undefined;
    try {
      parseType('object{id: string}');
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('object-type-not-inline');
  });
});
