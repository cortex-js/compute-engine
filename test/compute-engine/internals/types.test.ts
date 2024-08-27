import { parseType } from '../../../src/common/type/parse';

import { isSubtype } from '../../../src/common/type/subtype';
import { reduceType } from '../../../src/common/type/reduce';

describe('Type Parser Tests', () => {
  // Positive Test Cases

  it('should parse primitive type', () => {
    expect(parseType('integer')).toMatchInlineSnapshot(`"integer"`);
  });

  it('should parse union type', () => {
    expect(parseType('integer | boolean')).toMatchInlineSnapshot(`
      {
        "kind": "union",
        "toString": [Function],
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
        "toString": [Function],
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
        "toString": [Function],
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

  it('should parse collection type with dimensions', () => {
    expect(parseType('[integer^2x3]')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "integer",
        "kind": "list",
        "toString": [Function],
      }
    `);
  });

  it('should parse tuple type', () => {
    expect(parseType('(integer, boolean, string)')).toMatchInlineSnapshot(`
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
        "toString": [Function],
      }
    `);
  });

  it('should parse a type in parentheses (not a tuple)', () => {
    expect(parseType('(integer)')).toMatchInlineSnapshot(`"integer"`);
  });

  it('should parse an empty tuple', () => {
    expect(parseType('tuple()')).toMatchInlineSnapshot(`
      {
        "elements": [],
        "kind": "tuple",
        "toString": [Function],
      }
    `);
  });

  it('should parse a tuple function with one element', () => {
    expect(parseType('tuple(integer)')).toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "type": "integer",
          },
        ],
        "kind": "tuple",
        "toString": [Function],
      }
    `);
  });

  it('should parse a tuple function with multiples element', () => {
    expect(parseType('tuple(first: integer, second: boolean)'))
      .toMatchInlineSnapshot(`
      {
        "elements": [
          {
            "name": "first",
            "type": "integer",
          },
          {
            "name": "second",
            "type": "boolean",
          },
        ],
        "kind": "tuple",
        "toString": [Function],
      }
    `);
  });

  it('should parse named tuple type', () => {
    expect(parseType('(x: integer, y: boolean, z: string)'))
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
        "toString": [Function],
      }
    `);
  });

  it('should parse a list function', () => {
    expect(parseType('list<{x:number, y: boolean}>')).toMatchInlineSnapshot(`
      {
        "dimensions": undefined,
        "elements": {
          "elements": {
            "x": "number",
            "y": "boolean",
          },
          "kind": "map",
        },
        "kind": "list",
        "toString": [Function],
      }
    `);
  });

  it('should parse a list function with dimensions', () => {
    expect(parseType('list<number^2x3>')).toMatchInlineSnapshot(`
      {
        "dimensions": [
          2,
          3,
        ],
        "elements": "number",
        "kind": "list",
        "toString": [Function],
      }
    `);
  });

  it('should parse a set function', () => {
    expect(parseType('set<integer>')).toMatchInlineSnapshot(`
      {
        "elements": "integer",
        "kind": "set",
        "toString": [Function],
      }
    `);
  });

  it('should parse a collection function', () => {
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
        "toString": [Function],
      }
    `);
  });

  it('should parse function signature with named arguments', () => {
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
        "hold": undefined,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": undefined,
        "result": "string",
        "toString": [Function],
      }
    `);
  });

  it('should parse function signature with no arguments', () => {
    expect(parseType('() -> string')).toMatchInlineSnapshot(`
      {
        "args": undefined,
        "hold": undefined,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": undefined,
        "result": "string",
        "toString": [Function],
      }
    `);
  });

  it('should parse function signature with rest arguments and no parens', () => {
    expect(parseType('...string -> boolean')).toMatchInlineSnapshot(`
      {
        "args": undefined,
        "hold": undefined,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": {
          "type": "string",
        },
        "result": "boolean",
        "toString": [Function],
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
        "toString": [Function],
      }
    `);
  });

  it('should parse function signature with deferred evaluation', () => {
    expect(parseType('???(x: integer, y: boolean) -> string'))
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
        "hold": true,
        "kind": "signature",
        "optArgs": undefined,
        "restArg": undefined,
        "result": "string",
        "toString": [Function],
      }
    `);
  });

  it('should parse complex nested type', () => {
    expect(
      parseType(
        '((x: integer) -> string) & [boolean] | (number, value) -> collection'
      ).toString()
    ).toMatchInlineSnapshot(
      `"((x: integer) -> string & [boolean]) | (number, value) -> collection"`
    );
  });

  // Negative Test Cases

  it('should throw an error for function signature with optional and rest arguments', () => {
    expect(() =>
      parseType('(x: integer, y: boolean?, z: ...string) -> boolean')
    ).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   (x: integer, y: boolean?, z: ...string) -> boolean
      |                            ^
      |   
      |   Optional arguments cannot be followed by a rest argument
      "
    `);
  });

  it('should throw an error for invalid set syntax', () => {
    expect(() => parseType('set(integer)')).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   set(integer)
      |       ^
      |   
      |   Use "set<type>" instead of "set(type)".
      |   For example "set<number>"
      "
    `);
  });

  it('should throw an error for invalid collection syntax', () => {
    expect(() => parseType('collection(integer)'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   collection(integer)
      |              ^
      |   
      |   Use "collection<type>" instead of "collection(type)".
      |   For example "collection<number>"
      "
    `);
  });

  it('should throw an error for invalid map syntax', () => {
    expect(() => parseType('map<integer>')).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   map<integer>
      |       ^
      |   
      |   Use "map(key: type)" instead of "map<key: type>".
      |   For example "map<key: string>"
      "
    `);
  });

  it('should throw an error for invalid type syntax', () => {
    expect(() => parseType('integer | ')).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
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
      "Invalid type
      |   (integer | boolean
      |                     ^
      |   
      |   Expected ")".
      |   For example "(number, boolean)" or "(x: integer, y: integer)"
      "
    `);
  });

  it('should throw an error for invalid union and intersection combination', () => {
    expect(() => parseType('integer & | boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   integer & | boolean
      |             ^
      |   
      |   Expected type
      "
    `);
  });

  it('should throw an error for invalid collection dimension syntax', () => {
    expect(() => parseType('[integer^2x]')).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   [integer^2x]
      |              ^
      |   
      |   Expected a positive integer literal.
      |   For example : "[number^2x3]"
      "
    `);
  });

  it('should throw an error for function signature with named rest arguments and no parens', () => {
    expect(() => parseType('z: ...string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   z: ...string -> boolean
      |   ^
      |   
      |   Named arguments must be in parentheses
      "
    `);
  });

  it('should throw an error for function signature with named argument and no parens', () => {
    expect(() => parseType('z: string -> boolean'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
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
      "Invalid type
      |   (x: integer) -> 
      |                   ^
      |   
      |   Expected return type.
      |   Use "any" for any type or "nothing" for no return value
      "
    `);
  });

  it('should throw an error for invalid tuple syntax', () => {
    expect(() => parseType('(integer, boolean, )'))
      .toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   (integer, boolean, )
      |                     ^
      |   
      |   Expected a type or unexpected comma
      "
    `);
  });

  it('should throw an error for invalid function signature with multiple rest arguments', () => {
    expect(() =>
      parseType('(x: integer, y: ...boolean, z: ...string) -> boolean')
    ).toThrowErrorMatchingInlineSnapshot(`
      "Invalid type
      |   (x: integer, y: ...boolean, z: ...string) -> boolean
      |                             ^
      |   
      |   The rest argument must be the last argument
      "
    `);
  });
});

describe('isSubtype Tests POSITIVE', () => {
  // Positive Test Cases

  it('should return true for equal primitive types', () => {
    expect(isSubtype('number', 'number')).toBe(true);
  });

  it('should return true for primitive types that are a subtype', () => {
    expect(isSubtype('integer', 'number')).toBe(true);
  });

  it('should return true for primitive type as part of union', () => {
    expect(isSubtype('number', parseType('number | boolean'))).toBe(true);
  });

  it('should return true for union type as subtype of another union', () => {
    expect(
      isSubtype(parseType('integer | boolean'), parseType('number | boolean'))
    ).toBe(true);
  });

  it('should return true for a complex function signature subtype', () => {
    expect(
      isSubtype(
        parseType('(x:number) -> boolean'),
        parseType('(x:integer) -> boolean')
      )
    ).toBe(true);
  });

  it('should return true for function signature with optional arguments', () => {
    expect(
      isSubtype(
        parseType('(x:number, y: number?) -> string'),
        parseType('(x:integer, y: integer?) -> string')
      )
    ).toBe(true);
  });

  it('should return true for collection type with matching dimensions', () => {
    expect(
      isSubtype(parseType('[integer^2x3]'), parseType('[integer^2x3]'))
    ).toBe(true);
  });

  it('should return true for tuple type subtype', () => {
    expect(
      isSubtype(
        parseType('(x:integer, y: boolean)'),
        parseType('(x:number, y:boolean)')
      )
    ).toBe(true);
  });
});

describe('isSubtype Tests NEGATIVE', () => {
  // Negative Test Cases

  it('should return false for intersection type as subtype', () => {
    expect(isSubtype(parseType('integer & real'), 'number')).toBe(false);
  });

  it('should return false for a union as a subtype of an intersection', () => {
    expect(
      isSubtype(
        parseType('integer | boolean'),
        parseType('(number | boolean) & (number | string)')
      )
    ).toBe(false);
  });

  it('should return false for different primitive types', () => {
    expect(isSubtype('number', 'boolean')).toBe(false);
  });

  it('should return false if lhs is a primitive and rhs is a complex type', () => {
    expect(isSubtype('number', parseType('(number & boolean)'))).toBe(false);
  });

  it('should return false for function signature with incompatible result types', () => {
    expect(
      isSubtype(parseType('integer->boolean'), parseType('integer->string'))
    ).toBe(false);
  });

  it('should return false for incompatible collection types', () => {
    expect(
      isSubtype(parseType('[integer^2x3]'), parseType('[string^2x3]'))
    ).toBe(false);
  });

  it('should return false for collections with mismatched dimensions', () => {
    expect(
      isSubtype(parseType('[integer^2x3]'), parseType('[integer^3x3]'))
    ).toBe(false);
  });

  it('should return false for collections with mismatched shape', () => {
    expect(
      isSubtype(parseType('[integer^2x3x4]'), parseType('[integer^3x3]'))
    ).toBe(false);
  });

  it('should return false for tuples with different lengths', () => {
    expect(
      isSubtype(
        parseType('(integer, boolean)'),
        parseType('(integer, boolean, integer)')
      )
    ).toBe(false);
  });

  it('should return false for function signature with different argument types', () => {
    expect(
      isSubtype(parseType('integer->boolean'), parseType('boolean->boolean'))
    ).toBe(false);
  });

  it('should return false for incompatible tuple element types', () => {
    expect(
      isSubtype(parseType('(integer, boolean)'), parseType('(string, boolean)'))
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
    expect(reduce('(x: integer, y: boolean | boolean)')).toMatchInlineSnapshot(
      `"(x: integer, y: boolean)"`
    );
  });

  it('should reduce complex nested tuple types', () => {
    expect(
      reduce('(x: integer & number, y: boolean | boolean)')
    ).toMatchInlineSnapshot(`"(x: integer, y: boolean)"`);
  });

  // Test Cases for Collection Types

  it('should reduce collection types by reducing the element type', () => {
    expect(reduce('[(integer | integer)^2x3]')).toMatchInlineSnapshot(
      `"matrix<integer^(2x3)>"`
    );
  });

  it('should handle collections with complex nested types', () => {
    expect(reduce('[(integer & number)^2x3]')).toMatchInlineSnapshot(
      `"matrix<integer^(2x3)>"`
    );
  });

  it('should handle lists of anything', () => {
    expect(reduce('list<any>')).toMatchInlineSnapshot(`"list"`);
  });

  it('should handle lists of nothing', () => {
    expect(reduce('list<nothing>')).toMatchInlineSnapshot(`"[nothing]"`);
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

  it('should reduce function signature types', () => {
    expect(
      reduce('(x: integer | integer) -> boolean & boolean')
    ).toMatchInlineSnapshot(`"(x: integer) -> boolean"`);
  });

  it('should handle complex function signature reduction', () => {
    expect(
      reduce(
        '???(x: integer & number, y: boolean | boolean) -> number & integer'
      )
    ).toMatchInlineSnapshot(`"???(x: integer, y: boolean) -> integer"`);
  });
});
