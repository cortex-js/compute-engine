import { parseType } from '../../src/common/type/parse';

import { isSubtype } from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';
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
    expect(parseType('list<2x3>')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "any",
        "kind": "list",
      }
    `);
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

  it('should parse a record<> expression', () => {
    expect(parseType('record<red: integer, green: integer, blue: integer>'))
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

  it('should parse a record with exotic keys', () => {
    expect(
      parseType('record<`直径`: string, `نصف القطر`: integer, `durée`: number>')
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
      "
      Invalid type
      |   string+ -> boolean
      |          ^
      |   
      |   Function signatures must be enclosed in parentheses
      |   For example \`(x: number) -> number\`
      "
    `);
  });
  it('should throw function signature with single argument and no parens', () => {
    expect(() => parseType('string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   string -> boolean
      |            ^
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
      "
      Invalid type
      |   tuple<integer, second: boolean>
      |                 ^
      |   
      |   All tuple elements should be named, or none.
      |   Previous elements were not named, but this one is.
      "
    `);

    expect(() => parseType('tuple<first: integer, boolean>'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   tuple<first: integer, boolean>
      |                        ^
      |   
      |   All tuple elements should be named, or none.
      |   Previous elements were named, but this one isn't.
      "
    `);
  });

  it('should throw an error for function signature with optional and variadic arguments', () => {
    expect(() => parseType('(x: integer, y: boolean?, z: string*) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, y: boolean?, z: string*) -> boolean
      |                                       ^
      |   
      |   Variadic arguments cannot be used with optional arguments
      "
    `);
  });

  it('should throw an error for unknown or misspelled primitive types', () => {
    expect(() => parseType('foo')).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   foo
      |      ^
      |   
      |   Syntax error. The type was not recognized.
      "
    `);
  });

  it('should throw an error for unknown or misspelled primitive types in a function signature', () => {
    expect(() => parseType('(x: integer, foo) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, foo) -> boolean
      |               ^
      |   
      |   Expected a valid argument after ","
      "
    `);
  });

  it('should throw an error for invalid set syntax', () => {
    expect(() => parseType('set(integer)')).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   set(integer)
      |              ^
      |   
      |   Use \`set<integer>\` instead of \`set(integer)\`.
      "
    `);
  });

  it('should throw an error for invalid collection syntax', () => {
    expect(() => parseType('collection(integer)'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   collection(integer)
      |              ^
      |   
      |   Use \`collection<type>\` instead of \`collection(type)\`.
      |   For example \`collection<number>\`
      "
    `);
  });

  it('should throw an error for invalid type syntax', () => {
    expect(() => parseType('integer | ')).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   integer | 
      |             ^
      |   
      |   Unexpected end of input
      "
    `);
  });

  it('should throw an error for mismatched parentheses', () => {
    expect(() => parseType('(integer | boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (integer | boolean
      |                     ^
      |   
      |   Expected a closing parenthesis \`)\` after arguments.
      "
    `);
  });

  it('should throw an error for invalid union and intersection combination', () => {
    expect(() => parseType('integer & | boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   integer & | boolean
      |             ^
      |   
      |   Unexpected token"
      "
    `);
  });

  it('should throw an error for invalid collection dimension syntax', () => {
    expect(() => parseType('list<integer^2x>'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   list<integer^2x>
      |                  ^
      |   
      |   Expected a positive integer literal or \`?\`.
      |   For example : \`matrix<integer^2x3>\` or \`matrix<integer^?x?>\`
      "
    `);
  });

  it('should throw an error for function signature with named variadic arguments and no parens', () => {
    expect(() => parseType('z: string* -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   z: string* -> boolean
      |     ^
      |   
      |   Function signatures must be enclosed in parentheses
      |   For example \`(x: number) -> number\`
      "
    `);
  });

  it('should throw an error for function signature with named argument and no parens', () => {
    expect(() => parseType('z: string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   z: string -> boolean
      |     ^
      |   
      |   Function signatures must be enclosed in parentheses
      |   For example \`(x: number) -> number\`
      "
    `);
  });

  it('should throw an error for missing function return type', () => {
    expect(() => parseType('(x: integer) -> '))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer) -> 
      |                   ^
      |   
      |   Expected a return type after \`->\`.
      |   Use \`any\` for any type or \`nothing\` for no return value, or \`never\` for a function that never returns
      "
    `);
  });

  it('should throw an error for invalid tuple syntax', () => {
    expect(() => parseType('tuple<integer, boolean, >'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   tuple<integer, boolean, >
      |                          ^
      |   
      |   Expected a type or unexpected comma
      "
    `);
  });

  it('should throw an error for invalid function signature with multiple variadic arguments', () => {
    expect(() => parseType('(x: integer, y: string*, z: string*) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, y: string*, z: string*) -> boolean
      |                                      ^
      |   
      |   There can be only one variadic argument
      "
    `);
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
    expect(isSubtype('string', 'scalar')).toBe(true);
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

  it('should match an union of signatures', () => {
    expect(
      isSubtype(
        parseType('((x: integer) -> string) | ((y: number) -> boolean)'),
        parseType('(x: integer) -> string')
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
    // strings are not collections
    expect(isSubtype('string', 'collection')).toBe(false);
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

  it('should reduce a union type with a subtype', () => {
    expect(reduce('integer | number')).toMatch('integer');
  });

  it('should reduce a union type with complex nested structures', () => {
    expect(reduce('(integer & real) | number')).toMatchInlineSnapshot(
      `"integer"`
    );
  });

  // Test Cases for Intersection Types

  it('should reduce redundant intersection types', () => {
    expect(reduce('boolean & boolean')).toMatch('boolean');
  });

  it('should reduce an intersection type with a subtype', () => {
    expect(reduce('integer & number')).toMatch('integer');
  });

  it('should return "nothing" for incompatible intersection types', () => {
    expect(reduce('number & boolean')).toMatch('nothing');
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
    expect(reduce('list<any>')).toMatchInlineSnapshot(`"list"`);
  });

  it('should handle lists of nothing', () => {
    expect(reduce('list<nothing>')).toMatchInlineSnapshot(`"list<nothing>"`);
  });

  it('should handle sets of anything', () => {
    expect(reduce('set<any>')).toMatchInlineSnapshot(`"set"`);
  });

  it('should handle sets of nothing', () => {
    expect(reduce('set<nothing>')).toMatchInlineSnapshot(`"set<nothing>"`);
  });

  it('should handle collections of anything', () => {
    expect(reduce('collection<any>')).toMatchInlineSnapshot(`"collection"`);
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
        'record<parent:node | nothing, left: node | nothing, right: node | nothing>',
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
