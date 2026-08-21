import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

import { isSubtype, narrow } from '../../src/common/type/subtype';
import {
  isNonRealNumber,
  couldBeNonRealNumber,
  functionResult,
  functionArity,
  hasFunctionSignature,
  collectionElementType,
} from '../../src/common/type/utils';
import type { Type } from '../../src/common/type/types';
import { reduceType } from '../../src/common/type/reduce';
import { isValidType } from '../../src/common/type/primitive';
import { TypeReference } from '../../src/common/type/types';

describe('Primitive Type Parser', () => {
  // Positive Test Cases

  it('should parse primitive type', () => {
    expect(parseType('integer')).toMatchInlineSnapshot(`"integer"`);
  });
});

describe('Constructed Type Parser', () => {
  it('should parse union type', () => {
    expect(parseType('integer | boolean')).toMatchInlineSnapshot(`
      {
        "kind": "union",
        "types": [
          "integer",
          "boolean",
        ],
      }
    `);
  });

  it('should parse intersection type', () => {
    expect(parseType('(integer & real)')).toMatchInlineSnapshot(`
      {
        "kind": "intersection",
        "types": [
          "integer",
          "real",
        ],
      }
    `);
  });

  it('should parse nested union and intersection type', () => {
    expect(parseType('(integer | string) & boolean')).toMatchInlineSnapshot(`
      {
        "kind": "intersection",
        "types": [
          {
            "kind": "union",
            "types": [
              "integer",
              "string",
            ],
          },
          "boolean",
        ],
      }
    `);
  });

  it('should parse constructed nested type', () => {
    expect(
      parseType(
        '((x: integer) -> string) & list<boolean> | (number, value) -> collection'
      )
    ).toMatchInlineSnapshot(`
      {
        "kind": "union",
        "types": [
          {
            "kind": "intersection",
            "types": [
              {
                "args": [
                  {
                    "name": "x",
                    "type": "integer",
                  },
                ],
                "kind": "signature",
                "result": "string",
              },
              {
                "dimensions": undefined,
                "elements": "boolean",
                "kind": "list",
              },
            ],
          },
          {
            "args": [
              {
                "type": "number",
              },
              {
                "type": "value",
              },
            ],
            "kind": "signature",
            "result": "collection",
          },
        ],
      }
    `);
  });
});

describe('Collection Type Parser', () => {
  it('should parse lists with dimensions', () => {
    expect(parseType('list<integer^2x3>')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "integer",
        "kind": "list",
      }
    `);
  });

  it('should parse tuples', () => {
    expect(parseType('tuple<integer, boolean, string>')).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "type": "integer",
          },
          {
            "type": "boolean",
          },
          {
            "type": "string",
          },
        ],
        "kind": "tuple",
      }
    `);
  });

  it('should parse a type in parentheses (not a tuple)', () => {
    expect(parseType('(integer)')).toMatchInlineSnapshot(`"integer"`);
  });

  it('should parse an empty tuple', () => {
    expect(parseType('tuple<>')).toMatchInlineSnapshot(`
      {
        "elements": [],
        "kind": "tuple",
      }
    `);
  });

  it('should parse a tuple expression with one element', () => {
    expect(parseType('tuple<integer>')).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "type": "integer",
          },
        ],
        "kind": "tuple",
      }
    `);
  });

  it('should parse a tuple with multiple unnamed elements', () => {
    expect(parseType('tuple<integer, boolean>')).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "type": "integer",
          },
          {
            "type": "boolean",
          },
        ],
        "kind": "tuple",
      }
    `);
  });

  it('should parse named tuple type', () => {
    expect(parseType('tuple<x: integer, y: boolean, z: string>'))
      .toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "name": "x",
            "type": "integer",
          },
          {
            "name": "y",
            "type": "boolean",
          },
          {
            "name": "z",
            "type": "string",
          },
        ],
        "kind": "tuple",
      }
    `);
  });

  it('should parse a list expression with another constructed type', () => {
    expect(parseType('list<tuple<x:number, y: boolean>>'))
      .toMatchInlineSnapshot(`
      {
        "dimensions": undefined,
        "elements": {
          "elements": [
            {
              "name": "x",
              "type": "number",
            },
            {
              "name": "y",
              "type": "boolean",
            },
          ],
          "kind": "tuple",
        },
        "kind": "list",
      }
    `);
  });

  it('should parse a list expression with dimensions and type', () => {
    expect(parseType('list<number^2x3>')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "number",
        "kind": "list",
      }
    `);
  });

  it('should parse a list expression with dimensions and no type', () => {
    // The omitted element type is `unknown`, the bare-`list` synonym reading
    // (user ruling 2026-08-17) — not the wider, absence-admitting `any`.
    expect(parseType('list<2x3>')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "unknown",
        "kind": "list",
      }
    `);
  });

  // REVIEW.md F5–F7: the documented dimension syntaxes (`?`, spaces, and the
  // parenthesized `^(…)` form the serializer emits) all failed, and a single
  // `^N` dimension was silently dropped. The dimension parser now handles the
  // various `x`-separator tokenizations and the `^(…)` form.
  it('parses dimensions with ? and spaces (F5)', () => {
    // `?` is the unknown-size marker (stored as -1).
    expect(parseType('matrix<?x3>')).toMatchObject({ dimensions: [-1, 3] });
    expect(parseType('matrix<2x?>')).toMatchObject({ dimensions: [2, -1] });
    expect(parseType('matrix<2 x 3>')).toMatchObject({ dimensions: [2, 3] });
  });

  it('parses the parenthesized ^(…) dimension form (F5/F6)', () => {
    expect(parseType('matrix<integer^(2x3)>')).toMatchObject({
      dimensions: [2, 3],
      elements: 'integer',
    });
  });

  it('does not drop a single ^N dimension (F7)', () => {
    expect(parseType('list<number^2>')).toMatchObject({
      dimensions: [2],
      elements: 'number',
    });
    expect(parseType('list<integer^3>')).toMatchObject({
      dimensions: [3],
      elements: 'integer',
    });
  });

  it('round-trips dimensioned types through typeToString → parseType (F6)', () => {
    for (const s of [
      'matrix<2x3>',
      'matrix<integer^(2x3)>',
      'matrix<?x3>',
      'list<number^2>',
      'list<integer^(2x3)>',
    ]) {
      const once = typeToString(parseType(s));
      const twice = typeToString(parseType(once));
      expect(twice).toEqual(once);
    }
  });

  it('should parse a set expression', () => {
    expect(parseType('set<integer>')).toMatchInlineSnapshot(`
      {
        "elements": "integer",
        "kind": "set",
      }
    `);
  });

  it('should parse a dictionary<V> expression', () => {
    expect(parseType('dictionary<integer>')).toMatchInlineSnapshot(`
      {
        "kind": "dictionary",
        "values": "integer",
      }
    `);
  });

  it('should parse a record{} expression', () => {
    expect(parseType('record{red: integer, green: integer, blue: integer}'))
      .toMatchInlineSnapshot(`
      {
        "elements": {
          "blue": "integer",
          "green": "integer",
          "red": "integer",
        },
        "kind": "record",
      }
    `);
  });

  // A record's field list is written with BRACES — the delimiter of the value
  // literal it describes, and the mark of an unordered, keyed field set. Angle
  // brackets stay reserved for type arguments and ordered element lists, so
  // `tuple<…>` and every generic application are unaffected.
  describe('the record/object brace syntax', () => {
    it('round-trips through the serializer', () => {
      for (const s of [
        'record',
        'record{x: integer}',
        'record{a: list<integer>, b: record{c: string}}',
        'record{p: tuple<x: integer, y: integer>}',
        'record{f: (integer) -> integer}',
        'record{a: integer | string}',
        'list<record{a: integer}>',
      ])
        expect(typeToString(parseType(s))).toEqual(s);
    });

    it('accepts a space before the field list', () => {
      expect(typeToString(parseType('record {x: integer}'))).toEqual(
        'record{x: integer}'
      );
    });

    it('reads an EMPTY field list as the bare record type', () => {
      expect(typeToString(parseType('record{}'))).toEqual('record');
    });

    it('rejects the former angle-bracket spelling, naming the brace form', () => {
      expect(() => parseType('record<x: integer>')).toThrow(
        /A record type is written with braces: `record\{key: type, …\}`/
      );
      // The `object` layout is refused for its own reason unless the parse
      // declares a named type, so check the angle-bracket message there.
      expect(() =>
        parseType('object<id: string>', undefined, undefined, {
          allowObjectType: true,
        })
      ).toThrow(/An object type is written with braces/);
    });
  });

  // A `record` is a `dictionary` whose keys are statically known. Pin both the
  // parameterized and bare directions. This is required for dictionary
  // literals, which synthesize a
  // `record{…}` and must still satisfy a `dictionary<T>` annotation.
  it('makes a record a subtype of a dictionary', () => {
    expect(
      isSubtype(
        parseType('record{red: integer, green: integer, blue: integer}'),
        parseType('dictionary<integer>')
      )
    ).toBe(true);
    // ...but only when every field type fits the dictionary's value type.
    expect(
      isSubtype(
        parseType('record{user: string, age: integer}'),
        parseType('dictionary<integer>')
      )
    ).toBe(false);
    // The bare primitives, per the same tree.
    expect(
      isSubtype(parseType('record{red: integer}'), parseType('dictionary'))
    ).toBe(true);
    // The converse does NOT hold: a dictionary states no keys, so it cannot
    // stand in for a record that requires them.
    expect(
      isSubtype(
        parseType('dictionary<integer>'),
        parseType('record{x: integer}')
      )
    ).toBe(false);
    expect(isSubtype(parseType('dictionary'), parseType('record'))).toBe(false);
  });

  it('should parse a record with exotic keys', () => {
    expect(
      parseType('record{`直径`: string, `نصف القطر`: integer, `durée`: number}')
    ).toMatchInlineSnapshot(`
      {
        "elements": {
          "durée": "number",
          "نصف القطر": "integer",
          "直径": "string",
        },
        "kind": "record",
      }
    `);
  });

  it('serializes an exotic key back in backticks', () => {
    // The type lexer reads only `[a-zA-Z_][a-zA-Z0-9_]*` as a bare key, so a
    // key (or a tuple/argument label) outside that set has to be quoted for
    // the serialization to parse back. It used to be emitted bare, which broke
    // the round trip.
    for (const s of [
      'record{`直径`: string, x: integer}',
      'object{`my field`: integer}',
      'tuple<`my x`: integer>',
    ]) {
      const once = typeToString(
        parseType(s, undefined, undefined, { allowObjectType: true })
      );
      expect(once).toEqual(s);
      expect(
        typeToString(
          parseType(once, undefined, undefined, { allowObjectType: true })
        )
      ).toEqual(s);
    }
  });

  it('escapes a backtick or a backslash inside a backticked key', () => {
    // Inside a verbatim (backticked) name, the type lexer unescapes `\\` to a
    // backslash and `` \` `` to a backtick. A name containing either character
    // has to be emitted with those escapes, otherwise the serialization
    // re-lexes as a different (or unterminated) verbatim string.
    for (const s of [
      'record{`a\\`b`: string}',
      'record{`a\\\\b`: string}',
      'record{`a\\`b\\\\c`: string}',
      'tuple<`my\\`x`: integer>',
    ]) {
      const once = typeToString(
        parseType(s, undefined, undefined, { allowObjectType: true })
      );
      expect(once).toEqual(s);
      expect(
        parseType(once, undefined, undefined, { allowObjectType: true })
      ).toEqual(parseType(s, undefined, undefined, { allowObjectType: true }));
    }
  });

  it('escapes a quote or a backslash inside a string-literal type', () => {
    // A string-literal (value) type is double-quoted on the way out, and the
    // lexer unescapes `\\` and `\"` inside it, so a value containing either
    // character has to be emitted escaped: `"a"b"` would not re-lex, and an
    // unescaped backslash would be lost on the round trip.
    for (const [s, value] of [
      ['"a\\"b"', 'a"b'],
      ['"a\\\\b"', 'a\\b'],
      ['"a\\\\\\\\b"', 'a\\\\b'],
      ['"it\'s"', "it's"],
    ] as const) {
      const t = parseType(s);
      expect(t).toEqual({ kind: 'value', value });
      const once = typeToString(t);
      expect(once).toEqual(s);
      expect(parseType(once)).toEqual(t);
    }
  });

  it('should parse a collection expression', () => {
    expect(parseType('collection<boolean|number>')).toMatchInlineSnapshot(`
      {
        "elements": {
          "kind": "union",
          "types": [
            "boolean",
            "number",
          ],
        },
        "kind": "collection",
      }
    `);
  });

  it('should parse an indexed_collection expression', () => {
    expect(parseType('indexed_collection<number>')).toMatchInlineSnapshot(`
      {
        "elements": "number",
        "kind": "indexed_collection",
      }
    `);
  });
});

describe('Signature arity is checked in BOTH directions', () => {
  // A function requiring MORE arguments than a FIXED-ARITY signature ever
  // supplies cannot stand in for it. Only the too-FEW direction used to be
  // refused, which made an inline binary callback a strict subtype of a unary
  // arrow slot and hid it from the arity check at that slot.
  it('too many required parameters refuses a fixed-arity signature', () => {
    expect(
      isSubtype(
        parseType('(number, number) -> number'),
        parseType('(number) -> number')
      )
    ).toBe(false);
    expect(
      isSubtype(
        parseType('(unknown, unknown) -> number'),
        parseType('(number) -> number')
      )
    ).toBe(false);
  });

  it('a NULLARY signature is a fixed arity of zero', () => {
    // `() -> T` carries no `args` field at all, so an arity read that treats
    // "absent" as "unconstrained" let a unary function pass as its subtype.
    expect(
      isSubtype(parseType('(number) -> number'), parseType('() -> number'))
    ).toBe(false);
    expect(
      isSubtype(parseType('() -> number'), parseType('() -> number'))
    ).toBe(true);
  });

  it('the matching and too-few cases are unchanged', () => {
    expect(
      isSubtype(parseType('(number) -> number'), parseType('(number) -> number'))
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number) -> number'),
        parseType('(number, number) -> number')
      )
    ).toBe(false);
  });

  it('an optional or variadic tail keeps its leniency', () => {
    // The tail branches walk an lhs's surplus arguments against the tail, so
    // the extra parameter is checked against `number?`, not refused outright.
    expect(
      isSubtype(
        parseType('(number, number) -> number'),
        parseType('(number, number?) -> number')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number, number) -> number'),
        parseType('(number*) -> number')
      )
    ).toBe(true);
  });
});

describe('Nullary signature vs variadic bound', () => {
  // Regression: a nullary signature has no `args` field, and the
  // signature-subtype rule used to crash on `lhs.args!.length` when the
  // bound carried a variadic parameter.
  it('a nullary signature fails a `+`-variadic bound (min 1)', () => {
    expect(
      isSubtype(parseType('() -> number'), parseType('(unknown+) -> unknown'))
    ).toBe(false);
  });
  it('a nullary signature satisfies a `*`-variadic bound (min 0)', () => {
    expect(
      isSubtype(parseType('() -> number'), parseType('(unknown*) -> unknown'))
    ).toBe(true);
  });
});

describe('Signature Type Parser Tests', () => {
  it('should parse a function signature with named arguments', () => {
    expect(parseType('(x: integer, y: boolean) -> string'))
      .toMatchInlineSnapshot(`
      {
        "args": [
          {
            "name": "x",
            "type": "integer",
          },
          {
            "name": "y",
            "type": "boolean",
          },
        ],
        "kind": "signature",
        "result": "string",
      }
    `);
  });

  it('should parse a function signature with no arguments', () => {
    expect(parseType('() -> string')).toMatchInlineSnapshot(`
      {
        "args": undefined,
        "kind": "signature",
        "result": "string",
      }
    `);
  });

  it('should throw parsing a function signature with variadic arguments and no parens', () => {
    expect(() => parseType('string+ -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "string+ -> boolean": 
      Invalid type
      |   string+ -> boolean
      |         ^
      |
      |   Function signatures must be enclosed in parentheses
      |   For example \`(x: number) -> number\`
      "
    `);
  });
  it('should throw function signature with single argument and no parens', () => {
    expect(() => parseType('string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "string -> boolean": 
      Invalid type
      |   string -> boolean
      |          ^
      |
      |   Function signatures must be enclosed in parentheses
      |   For example \`(x: number) -> number\`
      "
    `);
  });
});

describe('Negative Type Parser Tests', () => {
  it('should throw an error for tuple expression with some named elements, but not all named elements', () => {
    expect(() => parseType('tuple<integer, second: boolean>'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "tuple<integer, second: boolean>": 
      Invalid type
      |   tuple<integer, second: boolean>
      |                                 ^
      |
      |   All tuple elements should be named, or none. Previous elements were not named, but this one is.
      "
    `);

    expect(() => parseType('tuple<first: integer, boolean>'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "tuple<first: integer, boolean>": 
      Invalid type
      |   tuple<first: integer, boolean>
      |                                ^
      |
      |   All tuple elements should be named, or none. Previous elements were named, but this one isn't.
      "
    `);
  });

  it('should throw an error for function signature with optional and variadic arguments', () => {
    expect(() => parseType('(x: integer, y: boolean?, z: string*) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(x: integer, y: boolean?, z: string*) -> boolean": 
      Invalid type
      |   (x: integer, y: boolean?, z: string*) -> boolean
      |                                                   ^
      |
      |   Variadic arguments cannot be used with optional arguments
      "
    `);
  });

  it('should throw an error for unknown or misspelled primitive types', () => {
    expect(() => parseType('foo')).toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "foo": 
      Invalid type
      |   foo
      |   ^
      |
      |   Unknown type "foo"
      |   Syntax error. The type was not recognized.
      "
    `);
  });

  it('should throw an error for unknown or misspelled primitive types in a function signature', () => {
    expect(() => parseType('(x: integer, foo) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(x: integer, foo) -> boolean": 
      Invalid type
      |   (x: integer, foo) -> boolean
      |                ^
      |
      |   Unknown type "foo"
      |   Syntax error. The type was not recognized.
      "
    `);
  });

  it('should throw an error for invalid set syntax', () => {
    expect(() => parseType('set(integer)')).toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "set(integer)": 
      Invalid type
      |   set(integer)
      |      ^
      |
      |   Use \`set<integer>\` instead of \`set(integer)\`.
      "
    `);
  });

  it('should throw an error for invalid collection syntax', () => {
    expect(() => parseType('collection(integer)'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "collection(integer)": 
      Invalid type
      |   collection(integer)
      |             ^
      |
      |   Use \`collection<type>\` instead of \`collection(type)\`.
      |   For example \`collection<number>\`
      "
    `);
  });

  it('should throw an error for invalid type syntax', () => {
    expect(() => parseType('integer | ')).toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "integer | ": 
      Invalid type
      |   integer | 
      |             ^
      |
      |   Expected type after |
      "
    `);
  });

  it('should throw an error for mismatched parentheses', () => {
    expect(() => parseType('(integer | boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(integer | boolean": 
      Invalid type
      |   (integer | boolean
      |                     ^
      |
      |   Expected ), got EOF
      "
    `);
  });

  it('should throw an error for invalid union and intersection combination', () => {
    expect(() => parseType('integer & | boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "integer & | boolean": 
      Invalid type
      |   integer & | boolean
      |             ^
      |
      |   Expected type after &
      "
    `);
  });

  it('should throw an error for invalid collection dimension syntax', () => {
    expect(() => parseType('list<integer^2x>'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "list<integer^2x>": 
      Invalid type
      |   list<integer^2x>
      |                 ^
      |
      |   Expected a positive integer literal or \`?\` after x. For example: \`2x3\` or \`2x?\`
      "
    `);
  });

  it('should throw an error for function signature with named variadic arguments and no parens', () => {
    expect(() => parseType('z: string* -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "z: string* -> boolean": 
      Invalid type
      |   z: string* -> boolean
      |   ^
      |
      |   Function signatures must be enclosed in parentheses
      |   For example \`(z: string*) -> boolean\`
      "
    `);
  });

  it('should throw an error for function signature with named argument and no parens', () => {
    expect(() => parseType('z: string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "z: string -> boolean": 
      Invalid type
      |   z: string -> boolean
      |   ^
      |
      |   Function signatures must be enclosed in parentheses
      |   For example \`(z: string*) -> boolean\`
      "
    `);
  });

  it('should throw an error for missing function return type', () => {
    expect(() => parseType('(x: integer) -> '))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(x: integer) -> ": 
      Invalid type
      |   (x: integer) -> 
      |                   ^
      |
      |   Expected return type after ->
      "
    `);
  });

  it('should throw an error for invalid tuple syntax', () => {
    expect(() => parseType('tuple<integer, boolean, >'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "tuple<integer, boolean, >": 
      Invalid type
      |   tuple<integer, boolean, >
      |                           ^
      |
      |   Expected tuple element
      "
    `);
  });

  it('should throw an error for invalid function signature with multiple variadic arguments', () => {
    expect(() => parseType('(x: integer, y: string*, z: string*) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(x: integer, y: string*, z: string*) -> boolean": 
      Invalid type
      |   (x: integer, y: string*, z: string*) -> boolean
      |                                                  ^
      |
      |   There can be only one variadic argument
      "
    `);
  });
});

describe('Argument order in a function signature', () => {
  // The consumption model bins arguments by MODIFIER, independently of source
  // order: required, then optional, then the variadic. A signature written in
  // any other order used to be SILENTLY re-ordered into that model — the
  // misrepresentation that hid the `Map` signature/behavior mismatch.

  it('rejects a required argument after a variadic one (the `Map` shape)', () => {
    expect(() => parseType('(collection+, mapping: function) -> any'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(collection+, mapping: function) -> any": 
      Invalid type
      |   (collection+, mapping: function) -> any
      |                 ^
      |
      |   A variadic argument must be the last argument
      "
    `);
  });

  it('rejects a required argument after a variadic one (minimal spelling)', () => {
    expect(() => parseType('(integer+, string) -> any'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(integer+, string) -> any": 
      Invalid type
      |   (integer+, string) -> any
      |              ^
      |
      |   A variadic argument must be the last argument
      "
    `);
    expect(() => parseType('(integer*, string) -> any')).toThrow(
      'A variadic argument must be the last argument'
    );
  });

  it('rejects a required argument after an optional one', () => {
    expect(() => parseType('(string?, number) -> any'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Failed to parse type "(string?, number) -> any": 
      Invalid type
      |   (string?, number) -> any
      |             ^
      |
      |   A required argument cannot follow an optional argument
      "
    `);
  });

  it('rejects an optional argument after a variadic one', () => {
    // Already covered by the optional/variadic exclusion, which reports first.
    expect(() => parseType('(number*, string?) -> any')).toThrow(
      'Variadic arguments cannot be used with optional arguments'
    );
  });

  it('accepts required → optional and required → variadic', () => {
    expect(typeToString(parseType('(number, string, boolean?) -> any'))).toBe(
      '(number, string, boolean?) -> any'
    );
    expect(typeToString(parseType('(number, string*) -> any'))).toBe(
      '(number, string*) -> any'
    );
    expect(typeToString(parseType('(collection+) -> set'))).toBe(
      '(collection+) -> set'
    );
  });
});

describe('optional parameters and a variadic tail are exclusive on BOTH routes', () => {
  // The type-string grammar has always refused the combination: argument
  // validation fills every optional slot before the variadic parameter takes
  // anything, so in `(number, number?, number+)` the optional slot is not
  // optional at all. A hand-built `Type` OBJECT is refused by the same rule
  // when it is boxed (`BoxedType`'s constructor). Until that check existed,
  // such an object could be declared and would serialize to
  // `(number, number?, number+) -> number` — a string `parseType()` cannot
  // read back, i.e. a type with no spelling.
  const RULE = 'Variadic arguments cannot be used with optional arguments';

  const OPT_PLUS_VARIADIC: Type = {
    kind: 'signature',
    args: [{ type: 'number' }],
    optArgs: [{ type: 'number' }],
    variadicArg: { type: 'number' },
    variadicMin: 1,
    result: 'number',
  };

  /** A fresh engine. Required lazily: this file is otherwise free of engine
   * dependencies. */
  function engine(): any {
    const { ComputeEngine } = require('../../src/compute-engine');
    return new ComputeEngine();
  }

  it('rejects the type OBJECT on `ce.declare`', () => {
    expect(() => engine().declare('h', OPT_PLUS_VARIADIC)).toThrow(RULE);
  });

  it('rejects the same signature NESTED inside another type', () => {
    // A signature reached through a collection element is just as unspellable
    // as a top-level one, so the check is a full walk of the type.
    const nested: Type = { kind: 'list', elements: OPT_PLUS_VARIADIC };
    expect(() => engine().declare('hs', nested)).toThrow(RULE);
  });

  it('rejects the same signature as a polytype `where`-clause BOUND', () => {
    // A type parameter's bound is a full type. Left unchecked, the declared
    // polytype would print as `(T) -> T where T: (number, number?, number+)
    // -> number` — a spelling `parseType` refuses — which is exactly the
    // "type with no spelling" the object-route check exists to prevent.
    const poly: Type = {
      kind: 'signature',
      args: [{ type: { kind: 'variable', name: 'T' } }],
      result: { kind: 'variable', name: 'T' },
      typeParams: [{ name: 'T', bound: OPT_PLUS_VARIADIC }],
    };
    expect(() => engine().declare('hp', poly)).toThrow(RULE);
  });

  it('still rejects the STRING form in the parser', () => {
    expect(() => parseType('(number, number?, number+) -> number')).toThrow(
      RULE
    );
    // The `*` tail is refused on the same rule.
    expect(() => parseType('(number, number?, number*) -> number')).toThrow(
      RULE
    );
  });

  it('rejects a required parameter after an optional one (string route only)', () => {
    // The object route cannot express the ORDER of the parameter list — the
    // required, optional and variadic parameters live in separate fields — so
    // this ordering rule has nothing to enforce there.
    expect(() => parseType('(number?, number) -> number')).toThrow(
      'A required argument cannot follow an optional argument'
    );
  });

  /** A legal shape is accepted by BOTH routes: the string parses and
   * round-trips, and the hand-built object declares and serializes to the same
   * spelling (which parses back). */
  function acceptsOnBothRoutes(spelling: string, built: Type): void {
    expect(typeToString(parseType(spelling))).toBe(spelling);
    expect(() => engine().declare('ok', built)).not.toThrow();
    expect(typeToString(built)).toBe(spelling);
    expect(typeToString(parseType(typeToString(built)))).toBe(spelling);
  }

  it('accepts a `*` tail after a required parameter', () => {
    acceptsOnBothRoutes('(number, number*) -> number', {
      kind: 'signature',
      args: [{ type: 'number' }],
      variadicArg: { type: 'number' },
      variadicMin: 0,
      result: 'number',
    });
  });

  it('accepts a bare `+` tail', () => {
    acceptsOnBothRoutes('(number+) -> number', {
      kind: 'signature',
      variadicArg: { type: 'number' },
      variadicMin: 1,
      result: 'number',
    });
  });

  it('accepts an optional parameter with NO variadic tail', () => {
    acceptsOnBothRoutes('(number, number?) -> number', {
      kind: 'signature',
      args: [{ type: 'number' }],
      optArgs: [{ type: 'number' }],
      result: 'number',
    });
  });
});

describe('isSubtype POSITIVE', () => {
  // Positive Test Cases

  it('should match equal primitive types', () => {
    expect(isSubtype('number', 'number')).toBe(true);
  });

  it('should match primitive types that are a subtype', () => {
    expect(isSubtype('integer', 'number')).toBe(true);
    expect(isSubtype('integer', 'real')).toBe(true);
    // A `character` is the TEXT scalar; `string` left `scalar` when strings
    // became indexed collections of characters
    // (`docs/STRING_ROADMAP.md`, decision D1).
    expect(isSubtype('character', 'scalar')).toBe(true);
  });

  it('should match refined numeric types', () => {
    expect(isSubtype('integer<1..10>', 'integer')).toBe(true);
    expect(isSubtype('real<1..10>', 'integer')).toBe(false);
    expect(isSubtype('integer<1..10>', 'integer<1..10>')).toBe(true);
    expect(isSubtype('integer<0..20>', 'integer<1..10>')).toBe(false);
    expect(isSubtype('integer<2..6>', 'integer<1..10>')).toBe(true);
    expect(isSubtype('integer<2..>', 'integer<1..>')).toBe(true);
    expect(isSubtype('integer<..10>', 'integer<..100>')).toBe(true);
    expect(isSubtype('integer<..10>', 'integer< -100..100>')).toBe(false);
  });

  it('should match refined symbol types', () => {
    expect(isSubtype('symbol<True>', 'symbol')).toBe(true);
    expect(isSubtype('symbol', 'symbol<True>')).toBe(false);
    expect(isSubtype('symbol<True>', 'expression')).toBe(true);
    expect(isSubtype('symbol<True>', 'expression<Symbol>')).toBe(true);
  });

  it('should treat a non-integer number literal as real (REVIEW.md F8)', () => {
    // `value 3.5` is a real number: a subtype of `real` (and `number`), but
    // not of `integer`. The buggy path mapped it to `number`, which is not a
    // subtype of `real`, so `value 3.5 <: real` wrongly failed.
    expect(isSubtype('3.5', 'real')).toBe(true);
    expect(isSubtype('3.5', 'number')).toBe(true);
    expect(isSubtype('3.5', 'integer')).toBe(false);
    expect(isSubtype('3', 'integer')).toBe(true);
    expect(isSubtype('3', 'real')).toBe(true);
  });

  it('should match refined expression types', () => {
    expect(isSubtype('expression<Add>', 'expression')).toBe(true);
    expect(isSubtype('expression', 'expression<Add>')).toBe(false);
  });

  it('should match primitive type as part of union', () => {
    expect(isSubtype('number', parseType('number | boolean'))).toBe(true);
  });

  it('should match union type as subtype of another union', () => {
    expect(
      isSubtype(parseType('integer | boolean'), parseType('number | boolean'))
    ).toBe(true);
  });

  it('should match a complex function signature subtype', () => {
    expect(
      isSubtype(
        parseType('(x:number) -> boolean'),
        parseType('(x:integer) -> boolean')
      )
    ).toBe(true);
  });

  it('should match function signature with matching types but different names', () => {
    expect(
      isSubtype(
        parseType('(y:number) -> boolean'),
        parseType('(x:integer) -> boolean')
      )
    ).toBe(true);
  });

  it('should match function signature with optional argument', () => {
    expect(
      isSubtype(
        parseType('(number, boolean) -> boolean'),
        parseType('(x:integer, z: boolean?) -> boolean')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number) -> boolean'),
        parseType('(x:integer, z: boolean?) -> boolean')
      )
    ).toBe(true);
  });

  it('should match function signature with variadic argument', () => {
    expect(
      isSubtype(
        parseType('(number) -> boolean'),
        parseType('(x:integer, z: boolean*) -> boolean')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number) -> boolean'),
        parseType('(x:integer, z: boolean+) -> boolean')
      )
    ).toBe(false);
    expect(
      isSubtype(
        parseType('(number, boolean) -> boolean'),
        parseType('(x:integer, z: boolean*) -> boolean')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number, boolean) -> boolean'),
        parseType('(x:integer, z: boolean+) -> boolean')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(number, boolean, boolean) -> boolean'),
        parseType('(x:integer, z: boolean+) -> boolean')
      )
    ).toBe(true);
  });

  it('should match function signature with optional arguments', () => {
    expect(
      isSubtype(
        parseType('(x:number, y: number?) -> string'),
        parseType('(x:integer, y: integer?) -> string')
      )
    ).toBe(true);
  });

  // A union of signatures is assignable only to a target EVERY arm satisfies:
  // a value of the union type might be the `(y: number) -> boolean` arm, which
  // is not a `(x: integer) -> string`. (This asserted `true` from 2025-02-06,
  // when the type string — then `(x: integer) -> string | (y: number) ->
  // boolean`, a SINGLE signature returning a union, since `->` binds loosest —
  // was parenthesized into a real union without revisiting the expectation.)
  it('should not match a union of signatures against one of its arms', () => {
    expect(
      isSubtype(
        parseType('((x: integer) -> string) | ((y: number) -> boolean)'),
        parseType('(x: integer) -> string')
      )
    ).toBe(false);
    // …but it does match a target that covers both arms.
    expect(
      isSubtype(
        parseType('((x: integer) -> string) | ((y: number) -> boolean)'),
        parseType('((x: integer) -> string) | ((y: number) -> boolean)')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('((x: integer) -> string) | ((y: number) -> boolean)'),
        parseType('function')
      )
    ).toBe(true);
  });

  it('should match a signature with variadic arguments and a single argument', () => {
    expect(
      isSubtype(
        parseType('(integer, string) -> string'),
        parseType('(integer, string+) -> string')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(integer, string) -> string'),
        parseType('(integer, string*) -> string')
      )
    ).toBe(true);
  });

  it('should match a signature with variadic arguments and two parameters', () => {
    expect(
      isSubtype(
        parseType('(integer, string, string) -> string'),
        parseType('(integer, string+) -> string')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('(integer, string, string) -> string'),
        parseType('(integer, string*) -> string')
      )
    ).toBe(true);
  });

  it('should match an union of values', () => {});

  it('should match a negation type', () => {
    expect(isSubtype('!number', 'any')).toBe(true);
  });

  it('should match a matching negation type', () => {
    expect(isSubtype(parseType('1'), 'integer & !0')).toBe(true);
  });
});

describe('isSubtype of collections', () => {
  it('should match collection type with matching dimensions', () => {
    expect(isSubtype('list<integer^2x3>', 'list<integer^2x3>')).toBe(true);
    expect(isSubtype('list<integer^2x3>', 'list<number^2x3>')).toBe(true);
  });

  it('should match tuple type subtype', () => {
    expect(
      isSubtype('tuple<x:integer, y: boolean>', 'tuple<x:number, y:boolean>')
    ).toBe(true);
  });

  it('should erase names: a named tuple is a subtype of a same-shape unnamed tuple', () => {
    // P3-6: name-erasure subtyping
    expect(
      isSubtype('tuple<x: integer, y: integer>', 'tuple<integer, integer>')
    ).toBe(true);
    // ...covariantly in the element types as well
    expect(
      isSubtype('tuple<x: integer, y: integer>', 'tuple<number, number>')
    ).toBe(true);
  });

  it('should match an indexed collection', () => {
    expect(isSubtype('list<integer>', 'indexed_collection<number>')).toBe(true);
    expect(isSubtype('list<integer>', 'collection<number>')).toBe(true);
    expect(isSubtype('list<integer>', 'indexed_collection')).toBe(true);
  });

  it('should match a non-indexed collection', () => {
    expect(
      isSubtype('dictionary< integer>', 'collection<tuple<string, integer>>')
    ).toBe(true);
  });
});

describe('isSubtype Tests NEGATIVE', () => {
  // Negative Test Cases

  it('should not match a non-matching negation type', () => {
    expect(isSubtype(parseType('0'), 'integer & !0')).toBe(false);
  });

  it('should not match a non-matching intersection type', () => {
    expect(isSubtype(parseType('3.1'), 'integer & !0')).toBe(false);
  });

  it('should not match intersection type as subtype', () => {
    // expect(isSubtype('integer & string', 'number')).toBe(false);
  });

  it('should not match a union as a subtype of an intersection', () => {
    expect(
      isSubtype('integer | boolean', '(number | boolean) & (number | string)')
    ).toBe(false);
  });

  it('should not match different primitive types', () => {
    expect(isSubtype('number', 'boolean')).toBe(false);
    // A string IS a collection now — an indexed collection of its grapheme
    // clusters — but a character is not (it has no elements).
    expect(isSubtype('string', 'collection')).toBe(true);
    expect(isSubtype('character', 'collection')).toBe(false);
    expect(isSubtype('string', 'scalar')).toBe(false);
  });

  it('should return false if lhs is a primitive and rhs is a complex type', () => {
    expect(isSubtype('number', '(number & boolean)')).toBe(false);
  });

  it('should not match function signature with incompatible result types', () => {
    expect(isSubtype('(integer) -> boolean', '(integer) -> string')).toBe(
      false
    );
  });

  it('should match a signature with variadic parameters and no parameters', () => {
    expect(
      isSubtype('(integer) -> string', '(integer, string*) -> string')
    ).toBe(true);
    expect(
      isSubtype('(integer) -> string', '(integer, string+) -> string')
    ).toBe(false);
  });

  it('should not match incompatible collection types', () => {
    expect(isSubtype('list<integer^2x3>', 'list<string^2x3>')).toBe(false);
  });

  it('should not match collections with mismatched dimensions', () => {
    expect(isSubtype('list<integer^2x3>', 'list<integer^3x3>')).toBe(false);
  });

  it('should not match collections with mismatched shape', () => {
    expect(isSubtype('list<integer^2x3x4>', 'list<integer^3x3>')).toBe(false);
  });

  it('should not match tuples with different lengths', () => {
    expect(
      isSubtype('tuple<integer, boolean>', 'tuple<integer, boolean, integer>')
    ).toBe(false);
  });

  it('should not match function signature with different argument types', () => {
    expect(isSubtype('(integer)->boolean', '(boolean)->boolean')).toBe(false);
  });

  it('should not match incompatible tuple element types', () => {
    expect(isSubtype('tuple<integer, boolean>', 'tuple<string, boolean>')).toBe(
      false
    );
  });

  it('should not match tuples with matching types but different names', () => {
    expect(
      isSubtype('tuple<x:integer, y:boolean>', 'tuple<y:integer, x:boolean>')
    ).toBe(false);
  });

  it('should not erase names in the wrong direction: an unnamed tuple is not a subtype of a named one', () => {
    // P3-6: name erasure is one-directional
    expect(
      isSubtype('tuple<integer, integer>', 'tuple<x: integer, y: integer>')
    ).toBe(false);
  });

  it('should *not* match a non-indexed collection', () => {
    expect(isSubtype('set<integer>', 'indexed_collection<number>')).toBe(false);
    expect(isSubtype('dictionary< integer>', 'indexed_collection')).toBe(false);
  });
});

describe('reduceType Tests', () => {
  // Helper function to parse and reduce a type string
  function reduce(typeStr: string) {
    return reduceType(parseType(typeStr)).toString();
  }

  // Test Cases for Union Types

  it('should reduce redundant union types', () => {
    expect(reduce('boolean | boolean')).toMatch('boolean');
  });

  it('should reduce a union type to its supertype (REVIEW.md F10)', () => {
    // A union keeps the supertype: integer ⊆ number, so the union is number.
    expect(reduce('integer | number')).toMatch('number');
    expect(reduce('number | integer')).toMatch('number');
  });

  it('should reduce a union type with complex nested structures', () => {
    // (integer & real) → integer; integer | number → number.
    expect(reduce('(integer & real) | number')).toMatchInlineSnapshot(
      `"number"`
    );
  });

  // Test Cases for Intersection Types

  it('should reduce redundant intersection types', () => {
    expect(reduce('boolean & boolean')).toMatch('boolean');
  });

  it('should reduce an intersection type with a subtype', () => {
    expect(reduce('integer & number')).toMatch('integer');
  });

  it('returns the EMPTY type for incompatible intersection types', () => {
    // `never`, not `nothing`: no value is both a number and a boolean, whereas
    // `nothing` is the UNIT type, whose one member is the symbol `Nothing`.
    // Spelling the refutation with the unit type left a value in the result —
    // see the two tests below for what that leaked into.
    expect(reduce('number & boolean')).toBe('never');
  });

  it('a refuted intersection does not admit `Nothing` through a union', () => {
    // With the empty meet spelled as the unit type, the refuted arm survived
    // union reduction as a `nothing` member and the union then admitted the
    // value `Nothing`.
    expect(reduce('(number & boolean) | integer')).toBe('integer');
    expect(
      isSubtype(
        'nothing',
        reduceType(parseType('(number & boolean) | integer'))
      )
    ).toBe(false);
  });

  it('a refuted intersection empties its tuple, and never deletes the slot', () => {
    // A `nothing` slot collapses, mirroring the value-level rule that writing
    // `Nothing` into a positional slot removes it — so a refuted slot used to
    // silently change the tuple's ARITY, reducing this to `tuple<integer>`.
    // An uninhabited slot is a different thing: every slot must hold a value,
    // so one that can hold none leaves no tuple at all.
    expect(reduce('tuple<number & boolean, integer>')).toBe('never');
    expect(reduce('record{a: never}')).toBe('never');
  });

  it('an element meet that refutes yields the EMPTY collection', () => {
    // `list<never>` is the empty list, and it is a subtype of every list — the
    // right answer for a list whose element type is uninhabited.
    // `list<nothing>` would instead be "a list of `Nothing` values", which is
    // not a subtype of `list<integer>` at all.
    expect(reduce('list<integer & string>')).toBe('list<never>');
    expect(
      isSubtype(
        reduceType(parseType('list<integer & string>')),
        parseType('list<integer>')
      )
    ).toBe(true);
  });

  // An intersection of signatures is how this type system SPELLS an overload
  // set, and `isSubtype` reports one as a subtype of each of its arms. The
  // meet used to have no rule for a pair of signatures and fell through to
  // "disjoint", so every overload set written as a type reduced away — to
  // `nothing` on its own, and, because a `nothing` tuple slot collapses, to a
  // tuple of the WRONG ARITY when one sat in a tuple. Reduction runs on the
  // `TypeFrom` construction path, so this was reachable from a type value.
  describe('an intersection of signatures (an overload set) survives', () => {
    it('keeps both arms', () => {
      expect(reduce('((number) -> number) & ((string) -> string)')).toBe(
        '((number) -> number) & ((string) -> string)'
      );
    });

    it('keeps the arms in written order, which dispatch ranking ties break on', () => {
      expect(reduce('((string) -> string) & ((number) -> number)')).toBe(
        '((string) -> string) & ((number) -> number)'
      );
    });

    it('flattens nested arms, so the reduced form is associative', () => {
      const flat =
        '((number) -> number) & ((string) -> string) & ((boolean) -> boolean)';
      expect(
        reduce(
          '(((number) -> number) & ((string) -> string)) & ((boolean) -> boolean)'
        )
      ).toBe(flat);
      expect(
        reduce(
          '((number) -> number) & (((string) -> string) & ((boolean) -> boolean))'
        )
      ).toBe(flat);
    });

    it('still merges arms one of which subsumes the other', () => {
      // `(number) -> number <: (integer) -> number` (contravariant parameter),
      // so the pair is not an overload set but a single narrower signature.
      expect(reduce('((number) -> number) & ((integer) -> number)')).toBe(
        '(number) -> number'
      );
      expect(reduce('((number) -> number) & ((number) -> number)')).toBe(
        '(number) -> number'
      );
    });

    it("survives nested inside a collection and keeps a tuple's arity", () => {
      expect(reduce('list<((number) -> number) & ((string) -> string)>')).toBe(
        'list<((number) -> number) & ((string) -> string)>'
      );
      expect(
        reduce('tuple<((number) -> number) & ((string) -> string), integer>')
      ).toBe('tuple<((number) -> number) & ((string) -> string), integer>');
    });
  });

  it('collapses a pair with no shared inhabitant', () => {
    // Sharing a KIND is not a witness of sharing a value, which is why each
    // composite kind has its own rule rather than a blanket "same kind is
    // kept": tuples of different arity share no value, nor do records whose
    // common key has disjoint types.
    expect(reduce('((number) -> number) & integer')).toBe('never');
    expect(reduce('list<integer> & integer')).toBe('never');
    expect(reduce('nothing & integer')).toBe('never');
    expect(
      reduce('tuple<integer, integer> & tuple<string, string, string>')
    ).toBe('never');
    expect(reduce('record{a: integer} & record{a: boolean}')).toBe('never');
  });

  describe('tuples and records meet structurally', () => {
    it('merges the key sets of two records, because records are width-subtyped', () => {
      // The value inhabiting both is the record carrying BOTH keys, and it is
      // a subtype of each side — so refuting the pair, as this used to, was
      // unsound.
      expect(reduce('record{a: integer} & record{b: string}')).toBe(
        'record{a: integer, b: string}'
      );
      expect(
        reduce('record{a: integer, b: string} & record{b: string, c: boolean}')
      ).toBe('record{a: integer, b: string, c: boolean}');
      const merged = reduceType(
        parseType('record{a: integer} & record{b: string}')
      );
      expect(isSubtype(merged, parseType('record{a: integer}'))).toBe(true);
      expect(isSubtype(merged, parseType('record{b: string}'))).toBe(true);
    });

    it('treats an `Object.prototype` member name as an ordinary record key', () => {
      // `toString`, `constructor` and friends are valid record keys, so key
      // presence must be an own-property test. A plain `elements[key]` lookup
      // found the INHERITED function and handed it to `reduceType` as a type,
      // throwing "Unknown type kind" — and only when the name arrived from the
      // right-hand operand, so the meet was order-dependent too.
      expect(reduce('record{a: integer} & record{toString: string}')).toBe(
        'record{a: integer, toString: string}'
      );
      expect(reduce('record{toString: string} & record{a: integer}')).toBe(
        'record{toString: string, a: integer}'
      );
      expect(reduce('record{a: integer} & record{constructor: string}')).toBe(
        'record{a: integer, constructor: string}'
      );
      // Still meets normally when both sides declare the prototype name.
      expect(
        reduce('record{toString: integer} & record{toString: string}')
      ).toBe('never');
    });

    it('does not let a record satisfy a key it never declared', () => {
      // Width subtyping asks whether the lhs HAS each rhs key. `key in
      // lhs.elements` answered yes for a prototype member name, so a record
      // with no `toString` key satisfied a contract requiring one.
      expect(
        isSubtype(
          parseType('record{a: integer}'),
          parseType('record{toString: any}')
        )
      ).toBe(false);
      expect(
        isSubtype(
          parseType('record{a: integer, toString: string}'),
          parseType('record{toString: string}')
        )
      ).toBe(true);
    });

    it('meets a key that both records declare', () => {
      expect(reduce('record{a: integer} & record{a: number}')).toBe(
        'record{a: integer}'
      );
    });

    it('empties the record when a shared key has no common value', () => {
      // `record{a: never}` is a subtype of both sides, so the type order has
      // an answer — but no value inhabits it, since a declared key must hold
      // one. The ruling takes the value reading, which is the question every
      // consumer of this meet is actually asking.
      expect(reduce('record{a: integer} & record{a: string}')).toBe('never');
    });

    it('meets tuples slot-wise', () => {
      expect(reduce('tuple<integer, string> & tuple<number, string>')).toBe(
        'tuple<integer, string>'
      );
      // An unnamed slot takes the other side's name, as `isSubtype` allows.
      expect(reduce('tuple<x: integer> & tuple<number>')).toBe(
        'tuple<x: integer>'
      );
    });

    it('empties the tuple on differing arity, an unfillable slot, or clashing names', () => {
      expect(reduce('tuple<integer, integer> & tuple<integer>')).toBe('never');
      expect(reduce('tuple<integer> & tuple<string>')).toBe('never');
      // A slot cannot be called both `x` and `y`.
      expect(reduce('tuple<x: integer> & tuple<y: integer>')).toBe('never');
    });

    it('leaves OBJECT layouts refuted, since their fields are invariant', () => {
      // Unlike a record, an object layout is exact and its fields invariant,
      // so two that are not already subtype-related share no value. The
      // parser only accepts an object literal in a type declaration, so the
      // pair is built directly.
      expect(
        typeToString(
          reduceType({
            kind: 'intersection',
            types: [
              { kind: 'object', elements: { a: 'integer' } },
              { kind: 'object', elements: { b: 'string' } },
            ],
          } as Type)
        )
      ).toBe('never');
    });
  });

  it('meets two applications of the same collection constructor elementwise', () => {
    // Never empty: the EMPTY collection inhabits both sides whatever their
    // element types say, since `[]` is `list<never>` and `never <: X` makes
    // `list<never>` a subtype of every list. Refuting the pair outright, as
    // this used to, was unsound.
    expect(reduce('list<integer> & list<string>')).toBe('list<never>');
    expect(reduce('set<integer> & set<string>')).toBe('set<never>');
    expect(reduce('dictionary<integer> & dictionary<string>')).toBe(
      'dictionary<never>'
    );
    expect(reduce('list<integer> & list<number>')).toBe('list<integer>');

    // A meet must be a subtype of both operands.
    for (const [x, y] of [
      ['list<integer>', 'list<string>'],
      ['set<integer>', 'set<string>'],
    ]) {
      const meet = reduceType({
        kind: 'intersection',
        types: [parseType(x), parseType(y)],
      } as Type);
      expect(isSubtype(meet, parseType(x))).toBe(true);
      expect(isSubtype(meet, parseType(y))).toBe(true);
    }
  });

  describe('two negations meet by De Morgan', () => {
    it('excludes the union rather than refuting the pair', () => {
      // Excluding `integer` and excluding `string` is excluding
      // `integer | string`. The pair used to fall through to the refutation at
      // the end of the meet and reduce to `never`, losing every value that is
      // neither.
      expect(reduce('!integer & !string')).toBe('!(integer | string)');
      const meet = reduceType(parseType('!integer & !string'));
      // A `boolean` is in both operands, so it must survive.
      expect(isSubtype(parseType('boolean'), parseType('!integer'))).toBe(true);
      expect(isSubtype(parseType('boolean'), parseType('!string'))).toBe(true);
      expect(isSubtype(parseType('boolean'), meet)).toBe(true);
      // And the meet is a lower bound of both, as any meet must be.
      expect(isSubtype(meet, parseType('!integer'))).toBe(true);
      expect(isSubtype(meet, parseType('!string'))).toBe(true);
    });

    it('folds an n-ary chain of negations', () => {
      // Grouping-independence comes from `flattenIntersectionMembers`, which
      // is pinned separately; this verifies the fold cooperates with it.
      expect(reduce('!integer & !string & !boolean')).toBe(
        '!(boolean | integer | string)'
      );
    });

    it('refutes a negation against a type that lies wholly inside it', () => {
      // Empty exactly when the other side admits nothing outside the excluded
      // type: every `integer` is a `number`, so nothing is left.
      expect(reduce('!number & integer')).toBe('never');
      expect(reduce('!integer & integer')).toBe('never');
    });

    it('keeps a negation against a type it only partly overlaps', () => {
      // Not empty, so it must not be refuted: `imaginary` is a `number` and is
      // provably disjoint from `integer`, so it inhabits `!integer & number`.
      // The pair is kept as the intersection it was written as.
      expect(reduce('!integer & number')).toBe('!integer & number');
      const meet = reduceType(parseType('!integer & number'));
      expect(isSubtype(parseType('imaginary'), parseType('!integer'))).toBe(
        true
      );
      expect(isSubtype(parseType('imaginary'), parseType('number'))).toBe(true);
      expect(isSubtype(parseType('imaginary'), meet)).toBe(true);
    });

    it('returns the other side when it lies wholly outside the negation', () => {
      // Settled by the subtype tests before the negation rules run: a
      // `boolean` is provably disjoint from `integer`, so it is already a
      // subtype of `!integer`.
      expect(reduce('!integer & boolean')).toBe('boolean');
      expect(reduce('!nothing & integer')).toBe('integer');
    });
  });

  describe('`broadcastable` meets by expanding to the union it denotes', () => {
    // `broadcastable<T>` is exactly `T | indexed_collection<T>`, so its meet
    // distributes over those two arms. Meeting two broadcastables elementwise
    // instead silently drops the cross terms, and the loss is not hypothetical
    // — see the witness test below, which is what an "is the meet a subtype of
    // both operands?" check cannot catch, since an under-approximation passes
    // that test too.
    const meetOf = (x: string, y: string): Type =>
      reduceType({
        kind: 'intersection',
        types: [parseType(x), parseType(y)],
      } as Type);

    it('keeps every type that inhabits both operands', () => {
      // A collection-shaped element type is real usage, not a curiosity:
      // `broadcastable<vector<n>>` is what a vector-valued call produces, and
      // is declared in `library/arithmetic.ts` and `collection-utils.ts`.
      //
      // A `vector<3>` inhabits `broadcastable<vector<3>>` through its scalar
      // arm and `broadcastable<number>` through its collection arm — a vector
      // of numbers is itself a collection of numbers — so it must survive the
      // meet.
      // Meeting the two element types instead gave `broadcastable<never>`,
      // silently dropping it.
      const x = 'broadcastable<vector<3>>';
      const y = 'broadcastable<number>';
      const witness = parseType('vector<3>');
      expect(isSubtype(witness, parseType(x))).toBe(true);
      expect(isSubtype(witness, parseType(y))).toBe(true);
      expect(isSubtype(witness, meetOf(x, y))).toBe(true);
    });

    it('does not widen to the other operand', () => {
      // `broadcastable<number>` is not the meet above, even though it looks
      // like the "simpler" answer: a bare `number` does not inhabit
      // `broadcastable<vector<3>>`, whose scalar arm is `vector<3>`.
      expect(
        isSubtype(
          parseType('broadcastable<number>'),
          parseType('broadcastable<vector<3>>')
        )
      ).toBe(false);
    });

    it('reduces two disjoint element types to the empty collection', () => {
      // Both scalar arms and both cross terms are empty, leaving only
      // `indexed_collection<never>` — the empty collection, which does inhabit
      // both, so the pair must not refute.
      const m = meetOf('broadcastable<integer>', 'broadcastable<string>');
      expect(typeToString(m)).toBe('indexed_collection<never>');
      expect(isSubtype(parseType('list<never>'), m)).toBe(true);
    });

    it('keeps the `broadcastable` spelling when one side subsumes the other', () => {
      // Subtype-related pairs are settled before the expansion runs, so the
      // narrower operand is returned as written rather than as a union.
      expect(reduce('broadcastable<integer> & broadcastable<number>')).toBe(
        'broadcastable<integer>'
      );
    });
  });

  it('refutes two lists whose SHAPES differ, which is not an elementwise question', () => {
    // No value is both a 2-vector and a 3-vector, so the elementwise meet does
    // not apply and the pair stays refuted.
    expect(reduce('list<integer^2> & list<integer^3>')).toBe('never');
  });

  it('reduces an overload set to a fixed point, so settling is idempotent', () => {
    // A member that merges keeps being offered to the remaining members: the
    // merged arm is narrower than either side and may absorb arms neither side
    // did. `(any) -> integer` is a subtype of both other arms here (parameters
    // are contravariant), but it is written last, so a fold that stopped at the
    // first merge left a second arm behind — and reducing THAT output again
    // dropped it, which `settleTypeText` cannot afford.
    const t =
      '((number) -> number) & ((integer) -> integer) & ((any) -> integer)';
    expect(reduce(t)).toBe('(any) -> integer');
    expect(reduce(reduce(t))).toBe('(any) -> integer');
  });

  it('distributes a union over an overload-set meet', () => {
    // `meet2` reports "no rule for this pair" out of band rather than by
    // returning the pair, because `meetUnion` legitimately RETURNS an
    // intersection — its single surviving member — and a caller that read that
    // by kind mistook the computed answer for a give-up marker and kept the
    // undistributed union instead.
    expect(
      reduce('(((number) -> number) | integer) & ((string) -> string)')
    ).toBe('((number) -> number) & ((string) -> string)');
  });

  // Test Cases for Tuple Types

  it('should reduce tuple types by reducing each element', () => {
    expect(
      reduce('tuple<x: integer, y: boolean | boolean>')
    ).toMatchInlineSnapshot(`"tuple<x: integer, y: boolean>"`);
  });

  it('should reduce complex nested tuple types', () => {
    expect(
      reduce('tuple<x: integer & number, y: boolean | boolean>')
    ).toMatchInlineSnapshot(`"tuple<x: integer, y: boolean>"`);
  });

  // Test Cases for Collection Types

  it('should reduce collection types by reducing the element type', () => {
    expect(reduce('list<(integer | integer)^2x3>')).toMatchInlineSnapshot(
      `"matrix<integer^(2x3)>"`
    );
  });

  it('should handle collections with complex nested types', () => {
    expect(reduce('list<(integer & number)^2x3>')).toMatchInlineSnapshot(
      `"matrix<integer^(2x3)>"`
    );
  });

  it('should handle lists of anything', () => {
    expect(reduce('list<any>')).toMatchInlineSnapshot(`"list<any>"`);
  });

  it('should handle lists of nothing', () => {
    expect(reduce('list<nothing>')).toMatchInlineSnapshot(`"list<nothing>"`);
  });

  it('should handle sets of anything', () => {
    expect(reduce('set<any>')).toMatchInlineSnapshot(`"set<any>"`);
  });

  it('should handle sets of nothing', () => {
    expect(reduce('set<nothing>')).toMatchInlineSnapshot(`"set<nothing>"`);
  });

  it('should handle dictionaries of nothing', () => {
    // A `Nothing`-valued entry collapses (slot rule), so the only inhabitant
    // is the empty dictionary — preserved like `list<nothing>`/`set<nothing>`
    // (this reduced to `error` until 2026-08-18).
    expect(reduce('dictionary<nothing>')).toMatchInlineSnapshot(
      `"dictionary<nothing>"`
    );
  });

  it('should handle collections of anything', () => {
    // `collection<any>` is the absence-admitting contract and survives; it
    // is the `<unknown>` spelling that is the synonym of the bare name and
    // collapses (user ruling 2026-08-17).
    expect(reduce('collection<any>')).toMatchInlineSnapshot(
      `"collection<any>"`
    );
    expect(reduce('collection<unknown>')).toMatchInlineSnapshot(`"collection"`);
  });

  // Test Cases for Function Signatures

  it('should reduce function signatures by reducing each argument', () => {
    expect(
      reduce('(x: integer | integer) -> boolean & boolean')
    ).toMatchInlineSnapshot(`"(x: integer) -> boolean"`);
  });
});

describe('Type References', () => {
  const typeResolver = {
    get names() {
      return [];
    },
    forward: (name: string) => {
      return {
        kind: 'reference',
        name,
        alias: false,
        def: undefined,
      } as TypeReference;
    },
    resolve: (name: string) => {
      if (name === 'Point') {
        return {
          kind: 'reference',
          name,
          alias: false, // nominal
          def: {
            kind: 'tuple',
            elements: [
              { name: 'x', type: 'number' },
              { name: 'y', type: 'number' },
            ],
          },
        } as TypeReference;
      }
      if (name === 'PointAlias') {
        return {
          kind: 'reference',
          name,
          alias: true, // structural
          def: {
            kind: 'tuple',
            elements: [
              { name: 'x', type: 'number' },
              { name: 'y', type: 'number' },
            ],
          },
        } as TypeReference;
      }
      return undefined;
    },
  };

  const pointType = parseType('Point', typeResolver);
  const pointAliasType = parseType('PointAlias', typeResolver);

  it('should parse a simple type reference', () => {
    expect(pointType).toMatchInlineSnapshot(`
      {
        "alias": false,
        "def": {
          "elements": [
            {
              "name": "x",
              "type": "number",
            },
            {
              "name": "y",
              "type": "number",
            },
          ],
          "kind": "tuple",
        },
        "kind": "reference",
        "name": "Point",
      }
    `);
  });

  it('should not match a tuple with a nominal type', () => {
    expect(
      isSubtype(parseType('tuple<x:number, y:number>', typeResolver), pointType)
    ).toBe(false);
  });

  it('should match a tuple with a structural type', () => {
    expect(
      isSubtype(
        parseType('tuple<x:number, y:number>', typeResolver),
        pointAliasType
      )
    ).toBe(true);
  });

  it('should parse a forward type reference in an expression type inside a function signature', () => {
    const forwardResolver = {
      get names() {
        return [];
      },
      forward: (name: string) => {
        return {
          kind: 'reference',
          name,
          alias: false,
          def: undefined,
        } as TypeReference;
      },
      resolve: (name: string) => {
        if (name === 'ErrorCode') {
          return {
            kind: 'reference',
            name,
            alias: false,
            def: undefined,
          } as TypeReference;
        }
        return undefined;
      },
    };

    // The original motivating case: should parse without throwing an exception
    expect(
      parseType(
        '((string|expression<ErrorCode>), expression?) -> nothing',
        forwardResolver
      )
    ).toMatchInlineSnapshot(`
      {
        "args": [
          {
            "type": {
              "kind": "union",
              "types": [
                "string",
                {
                  "kind": "expression",
                  "operator": "ErrorCode",
                },
              ],
            },
          },
        ],
        "kind": "signature",
        "optArgs": [
          {
            "type": "expression",
          },
        ],
        "result": "nothing",
      }
    `);
  });

  it('should parse a recursive type reference', () => {
    const nodeType = {
      kind: 'reference',
      name: 'node',
      alias: false,
      def: undefined,
    } as TypeReference;

    const recursiveTypeResolver = {
      get names() {
        return [];
      },
      forward: (name: string) => {
        return {
          kind: 'reference',
          name,
          alias: false,
          def: undefined,
        } as TypeReference;
      },
      resolve: (name: string) => {
        if (name === 'node') return nodeType;

        return undefined;
      },
    };

    expect(
      parseType(
        'record{parent:node | nothing, left: node | nothing, right: node | nothing}',
        recursiveTypeResolver
      )
    ).toMatchInlineSnapshot(`
      {
        "elements": {
          "left": {
            "kind": "union",
            "types": [
              {
                "alias": false,
                "def": undefined,
                "kind": "reference",
                "name": "node",
              },
              "nothing",
            ],
          },
          "parent": {
            "kind": "union",
            "types": [
              {
                "alias": false,
                "def": undefined,
                "kind": "reference",
                "name": "node",
              },
              "nothing",
            ],
          },
          "right": {
            "kind": "union",
            "types": [
              {
                "alias": false,
                "def": undefined,
                "kind": "reference",
                "name": "node",
              },
              "nothing",
            ],
          },
        },
        "kind": "record",
      }
    `);
    expect(nodeType).toMatchInlineSnapshot(`
      {
        "alias": false,
        "def": undefined,
        "kind": "reference",
        "name": "node",
      }
    `);
  });
});

describe('Paren disambiguation (grouped type vs function signature)', () => {
  it('should parse grouped union type', () => {
    expect(parseType('(string | number)')).toMatchInlineSnapshot(`
      {
        "kind": "union",
        "types": [
          "string",
          "number",
        ],
      }
    `);
  });

  it('should parse nested group', () => {
    expect(parseType('((integer))')).toMatchInlineSnapshot(`"integer"`);
  });

  it('should parse parenthesized tuple arg in function signature', () => {
    expect(parseType('((string, number)) -> boolean')).toMatchInlineSnapshot(`
      {
        "args": [
          {
            "type": {
              "elements": [
                {
                  "type": "string",
                },
                {
                  "type": "number",
                },
              ],
              "kind": "tuple",
            },
          },
        ],
        "kind": "signature",
        "result": "boolean",
      }
    `);
  });

  it('should parse higher-order function signature (function type as argument)', () => {
    expect(parseType('((number) -> boolean, string) -> nothing'))
      .toMatchInlineSnapshot(`
      {
        "args": [
          {
            "type": {
              "args": [
                {
                  "type": "number",
                },
              ],
              "kind": "signature",
              "result": "boolean",
            },
          },
          {
            "type": "string",
          },
        ],
        "kind": "signature",
        "result": "nothing",
      }
    `);
  });

  it('should parse named function-typed argument', () => {
    expect(parseType('(f: (x: number) -> number) -> string'))
      .toMatchInlineSnapshot(`
      {
        "args": [
          {
            "name": "f",
            "type": {
              "args": [
                {
                  "name": "x",
                  "type": "number",
                },
              ],
              "kind": "signature",
              "result": "number",
            },
          },
        ],
        "kind": "signature",
        "result": "string",
      }
    `);
  });
});

// Type-system correctness fixes from REVIEW.md (F11–F17).
describe('Type-system correctness (REVIEW.md F11–F17)', () => {
  const ts = (t: any) => typeToString(t);

  // F11: reduceListType dropped `-1` ("any size") dimensions and returned
  // `nothing`, so a bare `matrix` annihilated any intersection.
  it('F11: a bare `matrix` reduces to `matrix`, not `nothing`', () => {
    expect(ts(reduceType(parseType('matrix')!))).toBe('matrix');
    expect(ts(reduceType(parseType('matrix<integer>')!))).toBe(
      'matrix<integer>'
    );
  });

  // F12: isValidType was missing the value/symbol/expression/numeric object
  // kinds and listed a non-existent `function` kind.
  it('F12: isValidType accepts value/symbol/expression/numeric kinds', () => {
    expect(isValidType({ kind: 'value', value: 3 } as any)).toBe(true);
    expect(isValidType({ kind: 'symbol' } as any)).toBe(true);
    expect(isValidType({ kind: 'expression' } as any)).toBe(true);
    expect(isValidType({ kind: 'numeric', baseType: 'integer' } as any)).toBe(
      true
    );
  });

  // F13: `never` is the bottom type — a subtype of every type, including
  // itself (reflexivity) and structured types.
  it('F13: `never` is a subtype of every type', () => {
    expect(isSubtype('never', 'never')).toBe(true);
    expect(isSubtype('never', 'integer')).toBe(true);
    expect(isSubtype('never', parseType('list<integer>')!)).toBe(true);
  });

  // F14: `narrow` of two disjoint types is `never` (it must not *widen* to a
  // common supertype).
  it('F14: narrow of disjoint types is `never`', () => {
    expect(ts(narrow('integer', 'string'))).toBe('never');
    expect(ts(narrow('integer', 'boolean'))).toBe('never');
    // A genuine subtype relation is preserved (narrowest of the two).
    expect(ts(narrow('integer', 'real'))).toBe('integer');
  });

  // F17: the parser must reject invalid numeric ranges (inverted or NaN
  // bounds), like the previous parser did.
  it('F17: invalid numeric ranges are rejected', () => {
    expect(() => parseType('integer<10..0>')).toThrow();
    expect(() => parseType('integer<nan..10>')).toThrow();
    // Valid ranges still parse.
    expect(ts(parseType('integer<0..10>')!)).toBe('integer<0..10>');
  });
});

describe('NON-REAL NUMBER PREDICATES', () => {
  // `isNonRealNumber`: provably non-real (subtype of `complex`, not of
  // `real`). `couldBeNonRealNumber`: not provably real (also true for
  // supertypes of `complex` such as `number`/`any`/`unknown`). Note the
  // argument order in the latter's first check — `isSubtype('complex', t)`
  // tests that `t` is a SUPERTYPE of complex, so `real` (⊂ complex under
  // D10) does NOT satisfy it.
  it('real types are neither non-real nor possibly non-real', () => {
    for (const t of ['real', 'finite_real', 'integer', 'rational'] as const) {
      expect(isNonRealNumber(t)).toBe(false);
      expect(couldBeNonRealNumber(t)).toBe(false);
    }
  });

  it('wide numeric types could be non-real but are not provably so', () => {
    for (const t of ['number', 'finite_number', 'any', 'unknown'] as const) {
      expect(isNonRealNumber(t)).toBe(false);
      expect(couldBeNonRealNumber(t)).toBe(true);
    }
  });

  it('complex types are provably non-real', () => {
    for (const t of ['complex', 'finite_complex', 'imaginary'] as const) {
      expect(isNonRealNumber(t)).toBe(true);
      expect(couldBeNonRealNumber(t)).toBe(true);
    }
  });

  it('non-numeric types are neither', () => {
    for (const t of ['string', 'boolean', 'list<number>'] as const) {
      expect(isNonRealNumber(parseType(t))).toBe(false);
      expect(couldBeNonRealNumber(parseType(t))).toBe(false);
    }
  });
});

describe('functionResult / functionArity / hasFunctionSignature', () => {
  const t = (s: string) => parseType(s);
  const show = (x: Type | undefined) =>
    x === undefined ? 'undefined' : typeToString(x);

  it('reads a plain signature', () => {
    expect(show(functionResult(t('(integer) -> integer')))).toBe('integer');
    expect(functionArity(t('(integer, string) -> real'))).toBe(2);
    expect(hasFunctionSignature(t('(integer) -> integer'))).toBe(true);
  });

  it('JOINS the arms of an intersection — never the meet', () => {
    // `f(3)` is an `integer` and `f("a")` is a `string`, so an application
    // whose argument is unknown yields `integer | string`. The meet would be
    // the empty `integer & string`.
    const overloads = t('((integer) -> integer) & ((string) -> string)');
    expect(show(functionResult(overloads))).toBe('integer | string');
    expect(hasFunctionSignature(overloads)).toBe(true);
  });

  it('joins the arms of a union of signatures', () => {
    // The value is one of the two functions without saying which, so a call
    // returns something in the union of their results.
    const either = t('((integer) -> integer) | ((string) -> string)');
    expect(show(functionResult(either))).toBe('integer | string');
    expect(hasFunctionSignature(either)).toBe(true);
  });

  it('declines a mixed algebraic type', () => {
    // Not reliably callable — no partial arm list.
    const mixed = t('((integer) -> integer) & list<boolean>');
    expect(functionResult(mixed)).toBeUndefined();
    expect(functionArity(mixed)).toBeUndefined();
    expect(hasFunctionSignature(mixed)).toBe(false);
  });

  it('the bare `function` type: callable, unknown arity, UNKNOWN result', () => {
    // `unknown`, not `any`: it carries no information about the result, and
    // matches the `(any*) -> unknown` shape the old `functionSignature`
    // synthesized for it — which `functionResult` used to contradict.
    expect(hasFunctionSignature('function')).toBe(true);
    expect(functionArity('function')).toBeUndefined();
    expect(show(functionResult('function'))).toBe('unknown');
  });

  it('arity is fixed only when every arm agrees', () => {
    expect(functionArity(t('((integer) -> real) & ((string) -> real)'))).toBe(
      1
    );
    expect(
      functionArity(t('((integer) -> real) & ((integer, string) -> real)'))
    ).toBeUndefined();
    // Variadic or optional arguments make the arity ambiguous.
    expect(functionArity(t('(integer*) -> real'))).toBeUndefined();
    expect(functionArity(t('(integer, string?) -> real'))).toBeUndefined();
  });

  it('is not callable for a non-function type', () => {
    expect(hasFunctionSignature('string')).toBe(false);
    expect(functionResult('string')).toBeUndefined();
    expect(functionArity('string')).toBeUndefined();
    expect(functionResult(undefined)).toBeUndefined();
  });
});

describe('Signature serialization round-trip', () => {
  // `->` binds LOOSEST in the grammar: a signature's result type is read with
  // `parseUnionType()`, so it absorbs any following `&`/`|`. A signature that
  // is a MEMBER of a union/intersection/negation must therefore be
  // parenthesized by the serializer. Without that, an overload set such as
  // `((number) -> real) & ((string) -> boolean)` re-parsed as the single
  // signature `(number) -> (real & ((string) -> boolean))` — a structurally
  // different type with a byte-identical serialization.
  const roundTrips = (s: string) => {
    const t = parseType(s);
    const once = typeToString(t);
    // Serialization is a fixed point (the union serializer canonicalizes
    // member order, so compare strings rather than the parsed objects).
    expect(typeToString(parseType(once))).toBe(once);
    return once;
  };

  it('parenthesizes a signature inside an intersection', () => {
    expect(roundTrips('((number) -> real) & ((string) -> boolean)')).toBe(
      '((number) -> real) & ((string) -> boolean)'
    );
  });

  it('parenthesizes a signature inside a union', () => {
    expect(roundTrips('((number) -> real) | string')).toBe(
      '((number) -> real) | string'
    );
  });

  it('parenthesizes a signature inside a negation', () => {
    expect(roundTrips('!((number) -> real)')).toBe('!((number) -> real)');
  });

  it('round-trips a three-arm overload set', () => {
    const sig =
      '((number?) -> finite_real) & ((set<real>, number?) -> real) & ((collection, number?) -> any)';
    expect(roundTrips(sig)).toBe(sig);
    // The arms survive as arms, rather than collapsing into one signature
    // whose result swallowed the rest.
    const t = parseType(sig) as { kind: string; types: unknown[] };
    expect(t.kind).toBe('intersection');
    expect(t.types).toHaveLength(3);
  });

  it('does NOT parenthesize a union/intersection in RESULT position', () => {
    // The result absorbs `&`/`|` unambiguously — parens would be noise.
    expect(roundTrips('(number) -> real | string')).toBe(
      '(number) -> real | string'
    );
    expect(roundTrips('(number) -> real & string')).toBe(
      '(number) -> real & string'
    );
  });

  it('does not parenthesize a signature inside a bracketed constructor', () => {
    // `list<…>`/`set<…>`/`tuple<…>` already delimit their arguments.
    expect(roundTrips('list<(number) -> real>')).toBe('list<(number) -> real>');
    expect(roundTrips('tuple<(number) -> real, string>')).toBe(
      'tuple<(number) -> real, string>'
    );
  });
});

describe('isSubtype with an intersection on the left', () => {
  // `A & B` is a member of BOTH arms, so it is a subtype of `R` as soon as ANY
  // arm is. Requiring EVERY arm was sound but so incomplete that an overload
  // set was not a subtype of its own members.
  it('an overload set is a subtype of each of its arms', () => {
    const overloads = parseType('((number) -> real) & ((string) -> boolean)');
    expect(isSubtype(overloads, parseType('(number) -> real'))).toBe(true);
    expect(isSubtype(overloads, parseType('(string) -> boolean'))).toBe(true);
  });

  it('an overload set is not a subtype of an arm it does not have', () => {
    const overloads = parseType('((number) -> real) & ((string) -> boolean)');
    expect(isSubtype(overloads, parseType('(boolean) -> string'))).toBe(false);
  });

  it('agrees with the primitive-rhs branch', () => {
    // This branch already used `some`; the composite-rhs branch now matches.
    expect(isSubtype(parseType('integer & real'), 'integer')).toBe(true);
    expect(
      isSubtype(parseType('integer & real'), parseType('list<number>'))
    ).toBe(false);
  });

  it('an overload set is a subtype of `function`', () => {
    expect(
      isSubtype(
        parseType(
          '((number) -> finite_real) & ((set<real>, number?) -> real) & ((collection, number?) -> any)'
        ),
        'function'
      )
    ).toBe(true);
  });
});

describe('the `callback<…>` constructor is RETIRED (Design E §7)', () => {
  // Design E (`docs/TYPE-SYSTEM.md`)
  // deleted the constructor: callback slots are ordinary arrows admitted by
  // compatibility, and the spelling fails to parse with a migration hint.
  // (The union tie-break this block used to pin died with the constructor —
  // ordinary subtype absorption is all that remains.)
  it('fails to parse, with the migration hint and the parser caret', () => {
    const messageOf = (source: string): string => {
      try {
        parseType(source);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error(`Expected \`${source}\` to be rejected`);
    };
    const message = messageOf('callback<(integer) -> boolean>');
    expect(message).toContain('retired: write the arrow directly');
    expect(message).toContain('Invalid type');
  });

  it('ordinary subtype absorption is undisturbed', () => {
    const union = (...types: Type[]): string =>
      typeToString(reduceType({ kind: 'union', types }));
    expect(union('integer', 'number')).toBe('number');
    expect(union('number', 'integer')).toBe('number');
    const sig = parseType('(integer) -> boolean');
    expect(union(sig, 'function')).toBe('function');
    expect(union('function', sig)).toBe('function');
  });
});

describe('the retired `callback<…>` spelling on the Epsil annotation route', () => {
  // The annotation route reports the retirement like any other type
  // rejection: a positioned diagnostic carrying the migration hint
  // (Design E §7), anchored on the `callback` keyword itself.
  it('reports a positioned diagnostic with the migration hint', () => {
    // Imported lazily: this suite is otherwise free of engine dependencies.
    const { parseEpsil } = require('../../src/epsil/parse-epsil');
    const [, diagnostics] = parseEpsil('let x: callback<integer> = 1');
    expect(diagnostics).toHaveLength(1);
    const [diagnostic] = diagnostics;
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.message[1]).toContain(
      'retired: write the arrow directly'
    );
    // The keyword `callback` spans offsets 7–15.
    expect(diagnostic.range).toEqual([7, 15]);
  });
});

describe('the element type of an UNPARAMETERIZED collection type', () => {
  // `collection` is not `collection<any>`. Someone who writes the bare form has
  // said nothing about the members, so their type is the PLACEHOLDER `unknown`
  // — open to refinement — rather than the CONTRACT `any`, which is a promise
  // the author would have had to make (ruling of 2026-08-15, `unknown` as
  // placeholder; `(any) -> any` is the identity function's signature).
  //
  // This used to disagree with itself: the helper answered `any` while the
  // operators that actually extract an element answered `unknown`, so the same
  // question had two answers and a caller's behavior turned on which it asked.
  // BOTH SPELLINGS ARE PINNED HERE TOGETHER, which is the point of this
  // block — a fix to one side that forgets the other fails here.
  const BARE = [
    'collection',
    'indexed_collection',
    'list',
    'set',
    'tuple',
    'dictionary',
    'record',
  ] as const;

  test.each(BARE)('collectionElementType(%s) is `unknown`', (type) => {
    expect(collectionElementType(parseType(type))).toBe('unknown');
  });

  // `range` is the one unparameterized case whose elements ARE known — finite
  // positive integers — so it is concrete by fact, not by contract, and must
  // not be swept into the rule above.
  test('collectionElementType(range) stays `integer`', () => {
    expect(collectionElementType(parseType('range'))).toBe('integer');
  });

  // A parameterized type still reports exactly what it was given: the change
  // is about the ABSENCE of an argument, never about losing one.
  test.each([
    ['collection<integer>', 'integer'],
    ['indexed_collection<string>', 'string'],
    ['list<boolean>', 'boolean'],
  ])('collectionElementType(%s) is %s', (type, expected) => {
    expect(collectionElementType(parseType(type))).toBe(expected);
  });

  // The other spelling of the same question — what the engine reports for an
  // element actually pulled out of a bare-typed collection. Imported lazily,
  // matching the `callback<…>` block above: this suite is otherwise free of
  // engine dependencies.
  test('the extraction operators agree with the helper', () => {
    const { ComputeEngine } =
      require('../../src/compute-engine') as typeof import('../../src/compute-engine');
    const ce = new ComputeEngine();
    ce.declare('anIndexed', 'indexed_collection');
    ce.declare('aCollection', 'collection');
    expect(ce.box(['At', 'anIndexed', 1]).type.toString()).toBe('unknown');
    expect(ce.box(['First', 'aCollection']).type.toString()).toBe('unknown');
    expect(ce.box(['Last', 'anIndexed']).type.toString()).toBe('unknown');
  });
});

describe('a `string` actual at a BROADCASTABLE pattern is atomic', () => {
  // `string` carries a hidden element type (its grapheme clusters), so
  // type-variable binding expands it to `indexed_collection<character>` at a
  // COLLECTION-kind pattern: `(indexed_collection<T>) -> T` applied to a
  // string binds `T = character`, not `T = any`.
  //
  // `broadcastable<T>` is the deliberate exception. Strings are
  // broadcast-atomic — a scalar-parameter operator applied to a string
  // receives the WHOLE string — so `isSubtype('string', broadcastable<S>)`
  // holds only when the string itself inhabits `S`, never when `S` is the
  // element type. Binding `T = character` there named a slot the string
  // cannot inhabit: `broadcastable<character>` refuses `string`.
  //
  // The atomic actual therefore binds AS ITSELF, exactly as a `tuple` (the
  // other broadcast-atomic composite) does.

  // Imported lazily, like the blocks above: `inferTypeArguments` needs the
  // type algebra the engine installs at construction.
  const infer = (signature: string, actual: string): string | null => {
    const { ComputeEngine } =
      require('../../src/compute-engine') as typeof import('../../src/compute-engine');
    new ComputeEngine();
    const { inferTypeArguments } =
      require('../../src/common/type/instantiate') as typeof import('../../src/common/type/instantiate');
    const r = inferTypeArguments(parseType(signature) as any, [actual]);
    return r ? typeToString(r.T) : null;
  };

  test('`broadcastable<T>` vs `string` binds `T = string`, not `character`', () => {
    expect(infer('(broadcastable<T>) -> T where T', 'string')).toBe('string');
    // And the binding is coherent — the actual inhabits the slot it produced.
    expect(isSubtype('string', parseType('broadcastable<string>'))).toBe(true);
    expect(isSubtype('string', parseType('broadcastable<character>'))).toBe(
      false
    );
  });

  test('a `tuple` actual — the analogous atomic kind — binds the same way', () => {
    expect(
      infer('(broadcastable<T>) -> T where T', 'tuple<integer, integer>')
    ).toBe('tuple<integer, integer>');
  });

  test('a COLLECTION-kind pattern still expands the string', () => {
    expect(infer('(indexed_collection<T>) -> T where T', 'string')).toBe(
      'character'
    );
  });
});
