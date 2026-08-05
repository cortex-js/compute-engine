import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { validCortex } from '../utils';

//
// Cortex type annotations (Phase 2, Stage C). In annotation position only —
// after a declaration/assignment target symbol followed by an `OPERATOR` token
// whose text is `:` — the Cortex parser calls the engine-side type prefix
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

describe('CORTEX TYPE ANNOTATIONS', () => {
  test('standalone annotation', () => {
    expect(validCortex('x: real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('annotated assignment', () => {
    expect(validCortex('x: real = 5')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('annotated assignment with an expression initializer', () => {
    expect(validCortex('x: real = 2 + 3')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
      ['Dictionary', ['KeyValuePair', 'value', ['Add', 2, 3]]],
    ]);
  });

  test('generic type annotation', () => {
    expect(validCortex('xs: list<integer>')).toStrictEqual([
      'Declare',
      'xs',
      { str: 'list<integer>' },
    ]);
  });

  test('function-signature type annotation', () => {
    expect(validCortex('f: (real) -> real')).toStrictEqual([
      'Declare',
      'f',
      { str: '(real) -> real' },
    ]);
  });

  test('type-syntax tokens do not leak into the expression grammar', () => {
    // `<`, `>`, `|`, `&`, `->` are all consumed by the type subparse; the
    // annotation holds the type verbatim and nothing else is parsed.
    expect(validCortex('u: integer | boolean')).toStrictEqual([
      'Declare',
      'u',
      { str: 'integer | boolean' },
    ]);
  });

  test('whitespace around the colon does not matter', () => {
    expect(validCortex('x : real')).toStrictEqual([
      'Declare',
      'x',
      { str: 'real' },
    ]);
  });

  test('an unrelated `:` in the middle of a statement is not an annotation', () => {
    // Only a statement-leading `symbol :` is an annotation. Here the leading
    // token is a number, so nothing special happens (a diagnostic, not a
    // Declare).
    const [, diags] = parseCortex('2 : real');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).not.toEqual(
      expect.arrayContaining(['type-annotation-error'])
    );
  });

  describe('invalid type annotations', () => {
    test('unknown type produces an offset-correct diagnostic', () => {
      const [, diags] = parseCortex('x: notatype');
      expect(diags).toHaveLength(1);
      expect(diags[0].message[0]).toBe('type-annotation-error');
      // The diagnostic points at the offending type token (`notatype` at
      // offset 3), NOT at the `:` or the target.
      expect(diags[0].range[0]).toBe(3);
    });

    test('the diagnostic offset is shifted to the absolute position', () => {
      const source = 'foo = 1\ny: badtype';
      const [, diags] = parseCortex(source);
      expect(diags).toHaveLength(1);
      expect(diags[0].message[0]).toBe('type-annotation-error');
      // `badtype` begins at offset 11 in the whole source.
      expect(diags[0].range[0]).toBe(11);
      expect(source.slice(diags[0].range[0])).toBe('badtype');
    });

    test('an invalid type in an assignment still diagnoses', () => {
      const [, diags] = parseCortex('x: notatype = 5');
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
describe('CORTEX TYPE ANNOTATIONS — recovery', () => {
  /** The parsed program, serialized back to Cortex: which statements survived. */
  function recovered(source: string): string {
    const [expr] = parseCortex(source);
    return expr === null ? '' : serializeCortex(expr);
  }

  /** The diagnostic messages (code + arguments) of a parse, in order. */
  function diagnosticsOf(source: string) {
    const [, diagnostics] = parseCortex(source);
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
    const source = 'let g = (x: nosuch, y: integer) |-> y';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    // The list stays a two-parameter lambda (the bad parameter untyped).
    expect(recovered(source)).toBe('let g = (x, y: integer) |-> y');
  });
});
