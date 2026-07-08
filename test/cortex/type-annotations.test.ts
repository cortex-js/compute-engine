import { parseCortex } from '../../src/cortex/parse-cortex';
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
