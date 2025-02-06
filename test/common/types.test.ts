import { parseType } from '../../src/common/type/parse';

import { isSubtype } from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';

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
                "optArgs": undefined,
                "restArg": undefined,
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
            "optArgs": undefined,
            "restArg": undefined,
            "result": "collection",
          },
        ],
      }
    `);
  });
});

describe('Collection Type Parser', () => {
  it('should parse collection type with dimensions', () => {
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

  it('should parse tuple type', () => {
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

  it('should parse a tuple expression with some named elements', () => {
    expect(parseType('tuple<integer, second: boolean>')).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "type": "integer",
          },
          {
            "name": "second",
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
        "optArgs": undefined,
        "restArg": undefined,
        "result": "string",
      }
    `);
  });

  it('should parse a function signature with no arguments', () => {
    expect(parseType('() -> string')).toMatchInlineSnapshot(`
      {
        "args": undefined,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": undefined,
        "result": "string",
      }
    `);
  });

  it('should parse a function signature with rest arguments and no parens', () => {
    expect(parseType('...string -> boolean')).toMatchInlineSnapshot(`
      {
        "args": undefined,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": {
          "type": "string",
        },
        "result": "boolean",
      }
    `);
  });

  it('should parse function signature with single argument and no parens', () => {
    expect(parseType('string -> boolean')).toMatchInlineSnapshot(`
      {
        "args": [
          {
            "type": "string",
          },
        ],
        "kind": "signature",
        "result": "boolean",
      }
    `);
  });
});

describe('Negative Type Parser Tests', () => {
  it('should throw an error for function signature with optional and rest arguments', () => {
    expect(() =>
      parseType('(x: integer, y: boolean?, z: ...string) -> boolean')
    ).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, y: boolean?, z: ...string) -> boolean
      |                            ^
      |   
      |   Optional arguments cannot be followed by a rest argument
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
      |   Unknown keyword "foo"
      |   Did you mean "any"?
      "
    `);
  });

  it('should throw an error for unknown or misspelled primitive types in a function signature', () => {
    expect(() => parseType('(x: integer, foo) -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, foo) -> boolean
      |                   ^
      |   
      |   Unknown keyword "foo"
      |   Did you mean "any"?
      "
    `);
  });

  it('should throw an error for invalid set syntax', () => {
    expect(() => parseType('set(integer)')).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   set(integer)
      |       ^
      |   
      |   Use \`set<type>\` instead of \`set(type)\`.
      |   For example \`set<number>\`
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

  it('should throw an error for invalid map syntax', () => {
    expect(() => parseType('map<integer>')).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   map<integer>
      |               ^
      |   
      |   Expected a type separated by a \`:\` after the key.
      |   For example \`map<integer>: string>\`
      |   Use backticks for special characters.
      |   For example \`map<\`key with space\`: string>\`
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
      |   ^
      |   
      |   Syntax error. The type was not recognized.
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
      |   Expected type
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

  it('should throw an error for function signature with named rest arguments and no parens', () => {
    expect(() => parseType('z: ...string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   z: ...string -> boolean
      |   ^
      |   
      |   Named elements must be enclosed in parentheses
      "
    `);
  });

  it('should throw an error for function signature with named argument and no parens', () => {
    expect(() => parseType('z: string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   z: string -> boolean
      |   ^
      |   
      |   Named elements must be enclosed in parentheses
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
      |   Expected a return type.
      |   Use \`any\` for any type, \`nothing\` for no return value, or \`never\` for a function that never returns
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

  it('should throw an error for invalid function signature with multiple rest arguments', () => {
    expect(() =>
      parseType('(x: integer, y: ...boolean, z: ...string) -> boolean')
    ).toThrowErrorMatchingInlineSnapshot(`
      "
      Invalid type
      |   (x: integer, y: ...boolean, z: ...string) -> boolean
      |                             ^
      |   
      |   The rest argument must have a valid type
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

  it('should match an union of values', () => {});

  it('should match a negation type', () => {
    expect(isSubtype(parseType('!number'), 'any')).toBe(true);
  });

  it('should match a matching negation type', () => {
    expect(isSubtype(parseType('1'), 'integer & !0')).toBe(true);
  });
});

describe('isSubtype of collections', () => {
  it('should match collection type with matching dimensions', () => {
    expect(
      isSubtype(parseType('list<integer^2x3>'), parseType('list<integer^2x3>'))
    ).toBe(true);
  });

  it('should match tuple type subtype', () => {
    expect(
      isSubtype(
        parseType('tuple<x:integer, y: boolean>'),
        parseType('tuple<x:number, y:boolean>')
      )
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
    expect(isSubtype(parseType('integer & real'), 'number')).toBe(false);
  });

  it('should not match a union as a subtype of an intersection', () => {
    expect(
      isSubtype(
        parseType('integer | boolean'),
        parseType('(number | boolean) & (number | string)')
      )
    ).toBe(false);
  });

  it('should not match different primitive types', () => {
    expect(isSubtype('number', 'boolean')).toBe(false);
  });

  it('should return false if lhs is a primitive and rhs is a complex type', () => {
    expect(isSubtype('number', parseType('(number & boolean)'))).toBe(false);
  });

  it('should not match function signature with incompatible result types', () => {
    expect(
      isSubtype(parseType('integer->boolean'), parseType('integer->string'))
    ).toBe(false);
  });

  it('should not match incompatible collection types', () => {
    expect(
      isSubtype(parseType('list<integer^2x3>'), parseType('list<string^2x3>'))
    ).toBe(false);
  });

  it('should not match collections with mismatched dimensions', () => {
    expect(
      isSubtype(parseType('list<integer^2x3>'), parseType('list<integer^3x3>'))
    ).toBe(false);
  });

  it('should not match collections with mismatched shape', () => {
    expect(
      isSubtype(
        parseType('list<integer^2x3x4>'),
        parseType('list<integer^3x3>')
      )
    ).toBe(false);
  });

  it('should not match tuples with different lengths', () => {
    expect(
      isSubtype(
        parseType('tuple<integer, boolean>'),
        parseType('tuple<integer, boolean, integer>')
      )
    ).toBe(false);
  });

  it('should not match function signature with different argument types', () => {
    expect(
      isSubtype(parseType('integer->boolean'), parseType('boolean->boolean'))
    ).toBe(false);
  });

  it('should not match incompatible tuple element types', () => {
    expect(
      isSubtype(
        parseType('tuple<integer, boolean>'),
        parseType('tuple<string, boolean>')
      )
    ).toBe(false);
  });

  it('should not match tuples with matching types but different names', () => {
    expect(
      isSubtype(
        parseType('tuple<x:integer, y:boolean>'),
        parseType('tuple<y:integer, x:boolean>')
      )
    ).toBe(false);
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
