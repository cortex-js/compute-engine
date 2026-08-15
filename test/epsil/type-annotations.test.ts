import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

//
// Epsil type annotations (Phase 2, Stage C). In annotation position only —
// after a declaration/assignment target symbol followed by an `OPERATOR` token
// whose text is `:` — the Epsil parser calls the engine-side type prefix
// subparser and resumes just past the type.
//
// Phase 4 reconciliation: a type annotation *implies a declaration*, so a bare
// annotation (no `let`/`const` keyword) now lowers to the enhanced engine
// `Declare` primitive — the type is positional; an initializer goes into a
// trailing attributes `Dictionary` (omitted when absent):
//   x: T        →  ["Declare", "x", {str: "T"}]
//   x: T = expr →  ["Declare", "x", {str: "T"}, ["Dictionary",
//                     ["KeyValuePair", value, expr]]]
//

describe('EPSIL TYPE ANNOTATIONS', () => {
  test('standalone annotation', () => {
    expect(validEpsil('x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('annotated assignment', () => {
    expect(validEpsil('x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('annotated assignment with an expression initializer', () => {
    expect(validEpsil('x: real = 2 + 3')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', ['Add', 2, 3]]],
    ]);
  });

  test('generic type annotation', () => {
    expect(validEpsil('xs: list<integer>')).toStrictEqual([
      'Declare',
      'xs',
      { str: 'list<integer>' },
    ]);
  });

  test('function-signature type annotation', () => {
    expect(validEpsil('f: (real) -> real')).toStrictEqual([
      'Declare',
      'f',
      { str: '(real) -> real' },
    ]);
  });

  test('type-syntax tokens do not leak into the expression grammar', () => {
    // `<`, `>`, `|`, `&`, `->` are all consumed by the type subparse; the
    // annotation holds the type verbatim and nothing else is parsed.
    expect(validEpsil('u: integer | boolean')).toStrictEqual([
      'Declare',
      'u',
      { str: 'integer | boolean' },
    ]);
  });

  test('whitespace around the colon does not matter', () => {
    expect(validEpsil('x : real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('an unrelated `:` in the middle of a statement is not an annotation', () => {
    // Only a statement-leading `symbol :` is an annotation. Here the leading
    // token is a number, so nothing special happens (a diagnostic, not a
    // Declare).
    const [, diags] = parseEpsil('2 : real');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).not.toEqual(
      expect.arrayContaining(['type-annotation-error'])
    );
  });

  describe('invalid type annotations', () => {
    test('unknown type produces an offset-correct diagnostic', () => {
      const [, diags] = parseEpsil('x: notatype');
      expect(diags).toHaveLength(1);
      expect(diags[0].message[0]).toBe('type-annotation-error');
      // The diagnostic points at the offending type token (`notatype` at
      // offset 3), NOT at the `:` or the target.
      expect(diags[0].range[0]).toBe(3);
    });

    test('the diagnostic offset is shifted to the absolute position', () => {
      const source = 'foo = 1\ny: badtype';
      const [, diags] = parseEpsil(source);
      expect(diags).toHaveLength(1);
      expect(diags[0].message[0]).toBe('type-annotation-error');
      // `badtype` begins at offset 11 in the whole source.
      expect(diags[0].range[0]).toBe(11);
      expect(source.slice(diags[0].range[0])).toBe('badtype');
    });

    test('an invalid type in an assignment still diagnoses', () => {
      const [, diags] = parseEpsil('x: notatype = 5');
      expect(diags).toHaveLength(1);
      expect(diags[0].message[0]).toBe('type-annotation-error');
      expect(diags[0].range[0]).toBe(3);
    });
  });
});

//
// Recovery after a malformed annotation. The type subparse only DIAGNOSES —
// it leaves the cursor at the offending token and each caller resynchronizes
// at the unit its own grammar uses: a statement boundary for a declaration,
// the next `,`/closer for a parameter or pattern list. (Before this, the
// subparse recovered internally at the STATEMENT level, so a declaration
// recovered twice — swallowing the next statement — and a parameter list
// resynchronized at the wrong unit, losing the rest of the list.)
//
describe('EPSIL TYPE ANNOTATIONS — recovery', () => {
  /** The parsed program, serialized back to Epsil: which statements survived. */
  function recovered(source: string): string {
    const [expr] = parseEpsil(source);
    return expr === null ? '' : serializeEpsil(expr);
  }

  /** The diagnostic messages (code + arguments) of a parse, in order. */
  function diagnosticsOf(source: string) {
    const [, diagnostics] = parseEpsil(source);
    return diagnostics.map((d) => d.message);
  }

  test('a malformed type in a `let` costs only that declaration', () => {
    const source = 'let x: )bad( = 1\nlet a = 0\na + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });

  test('…and so does one in a bare annotation', () => {
    const source = 'x: notatype = 5\nlet a = 0\na + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "notatype"'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });

  test('a malformed parameter annotation leaves the rest of the list intact', () => {
    // The bad parameter survives UNTYPED; `y`'s annotation and the body parse.
    const source = 'function f(x: nosuch, y: integer) { y }';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    expect(recovered(source)).toBe('function f(x, y: integer) {y}');
  });

  test('…including when the malformed annotation is the LAST parameter', () => {
    const source = 'function f(y: integer, x: nosuch) { y }';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    expect(recovered(source)).toBe('function f(y: integer, x) {y}');
  });

  test('an UNCLOSED generic annotation does not mint a bogus parameter', () => {
    // The resync has to honor `<…>` nesting: the first comma here is INSIDE
    // the type arguments, and stopping there made `string` look like the next
    // parameter (`function f(x, string) {x}`).
    const source = 'function f(x: Pair<integer, string) { x }';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected `>` to close the type arguments'],
    ]);
    expect(recovered(source)).toBe('function f(x) {x}');
  });

  test('a malformed annotation in a mapsto parameter list', () => {
    const source = 'let g = (x: nosuch, y: integer) => y';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    // The list stays a two-parameter lambda (the bad parameter untyped).
    expect(recovered(source)).toBe('let g = (x, y: integer) => y');
  });

  test('a brace-delimited type in a failed annotation reports ONCE', () => {
    // The resync has to skip the `}` the annotation's own `{` opened.
    // Stopping at it (the rule that keeps a statement inside a block from
    // eating the block's closing brace) reported a second, bogus
    // `unexpected-symbol }`.
    const source = 'let x: record{id: nosuch} = 1\nlet a = 0\na + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });
});

//
// A `record{…}` / `object{…}` field list and an Epsil statement block are both
// brace-delimited, and a return-type annotation sits immediately before the
// body: in `function f() -> record { … }` the `{` could open either. The type
// parser decides with a bounded lookahead (`Parser.startsFieldList` in
// `src/common/type/parser.ts`): the `{` opens a field list only when it is
// followed by `}` or by `<name> :`; otherwise the type is the bare `record`
// and the brace is left to the Epsil grammar.
//
// In the return type of a `function` declaration — the one position where a
// block MUST follow — a second test applies: the candidate field list also has
// to be followed by the body (another `{`, or a `where` clause and then the
// `{`). That is what keeps `-> record { }` and `-> record { x: integer }` —
// a bare `record` plus a body — from reading as field lists.
//
describe('EPSIL — a record/object field list vs. a block body', () => {
  test('a bare `record` return type leaves the block body to Epsil', () => {
    expect(validEpsil('function f() -> record { let r = 1\nr }')).toStrictEqual(
      [
        'DefineFunction',
        'f',
        [
          'Function',
          [
            'Typed',
            [
              'Block',
              ['Declare', 'r', ['Dictionary', ['KeyValuePair', 'value', 1]]],
              'r',
            ],
            { str: 'record' },
          ],
        ],
      ]
    );
  });

  test('a field list and a block body in the same signature', () => {
    expect(
      validEpsil('function f() -> record{a: integer} { {a -> 1} }')
    ).toStrictEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]]],
          { str: 'record{a: integer}' },
        ],
      ],
    ]);
  });

  test('an EMPTY body after a bare `record` return type is the body', () => {
    expect(validEpsil('function f() -> record { }')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Typed', ['Block'], { str: 'record' }]],
    ]);
  });

  test('an EMPTY body after a bare `object` return type is the body', () => {
    expect(validEpsil('function g() -> object { }')).toStrictEqual([
      'DefineFunction',
      'g',
      ['Function', ['Typed', ['Block'], { str: 'object' }]],
    ]);
  });

  test('a body whose first statement is a bare annotation is the body', () => {
    // The one statement shape that also opens a field list (`name :`). No
    // block follows the braces, so they are the body.
    expect(validEpsil('function f() -> record { x: integer }')).toStrictEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Declare', 'x', { str: 'integer' }]],
          { str: 'record' },
        ],
      ],
    ]);
  });

  test('a field list, a `where` clause, then the body', () => {
    // The clause sits between the return type and the block, so the lookahead
    // accepts a `where` in the body's place.
    const [, diagnostics] = parseEpsil(
      'function id(x: T) -> record{a: T} where T { {a -> x} }'
    );
    expect(diagnostics.map((d) => d.message)).toEqual([]);
  });

  test('a bare `record` annotation with no block following it', () => {
    // Outside a function declaration nothing follows the type, so the head
    // test alone decides: the braces are the (empty) field list.
    expect(validEpsil('let p: record { }')).toStrictEqual([
      'Declare',
      'p',
      { str: 'record { }' },
    ]);
  });

  test('an EMPTY object layout is admitted inline', () => {
    // `object{}` declares no layout — it builds the bare `object` primitive —
    // so the "only as a named type's definition" rule does not apply to it.
    expect(validEpsil('let x: object{} = {}')).toStrictEqual([
      'Declare',
      'x',
      { str: 'object{}' },
      ['Dictionary', ['KeyValuePair', 'value', ['Set']]],
    ]);
  });

  test('a record annotation with a field list', () => {
    expect(
      validEpsil('let p: record{x: integer, y: integer} = {x -> 1, y -> 2}')
    ).toStrictEqual([
      'Declare',
      'p',
      { str: 'record{x: integer, y: integer}' },
      [
        'Dictionary',
        [
          'KeyValuePair',
          'value',
          [
            'Dictionary',
            ['KeyValuePair', { str: 'x' }, 1],
            ['KeyValuePair', { str: 'y' }, 2],
          ],
        ],
      ],
    ]);
  });

  test('a space before the brace is accepted', () => {
    // The lookahead makes it safe, and the held type is the raw source text.
    expect(validEpsil('let r: record {x: integer}')).toStrictEqual([
      'Declare',
      'r',
      { str: 'record {x: integer}' },
    ]);
  });

  test('the empty field list `record{}`', () => {
    expect(validEpsil('let q: record{} = {}')).toStrictEqual([
      'Declare',
      'q',
      { str: 'record{}' },
      ['Dictionary', ['KeyValuePair', 'value', ['Set']]],
    ]);
  });

  test('an object layout is the body of a `type` declaration', () => {
    expect(validEpsil('type P = object{id: string}')).toStrictEqual([
      'DeclareType',
      'P',
      { str: 'object{id: string}' },
    ]);
  });

  test('an inline object layout is still refused', () => {
    const [, diagnostics] = parseEpsil('let x: object{id: string}');
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['object-type-not-inline'],
    ]);
  });

  test('the former angle-bracket spelling names the brace form', () => {
    const [, diagnostics] = parseEpsil('let p: record<x: integer> = 1');
    expect(diagnostics.map((d) => d.message)).toEqual([
      [
        'type-annotation-error',
        'A record type is written with braces: `record{key: type, …}`',
      ],
    ]);
  });
});
