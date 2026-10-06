/**
 * The string operators accept a `character` wherever they accept a string,
 * and a dictionary lookup accepts a character key.
 *
 * Indexing a string gives a `character`, and `character` is a disjoint sibling
 * of `string` in the type lattice (`docs/STRING_ROADMAP.md`, "The character
 * value model"). A character and the one-character string with the same
 * content are the same value (`isSame`), so each string operator reads a
 * character operand as that string: `ToUpperCase("abc"[1])` is the STRING
 * `"A"`, and `{a -> 1}["a"[1]]` is `1`.
 *
 * Each operator is checked on two routes: a MathJSON expression boxed with
 * `ce.box(...)`, and an Epsil program, which also runs the static pre-pass
 * (the type errors this change removes were reported there first).
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  isCharacter,
  isString,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

/** The MathJSON wire form of the character `s`. */
const ch = (s: string) => ['CharacterFrom', `'${s}'`];
/** The MathJSON string literal `s`. */
const str = (s: string) => `'${s}'`;

/**
 * Each case is an operator application with at least one character operand.
 * `asString` is the same application with every character replaced by the
 * one-character string with the same content: the expected result.
 */
type Case = [label: string, withCharacter: any, asString: any];

const CASES: Case[] = [
  ['ToUpperCase', ['ToUpperCase', ch('a')], ['ToUpperCase', str('a')]],
  ['ToLowerCase', ['ToLowerCase', ch('A')], ['ToLowerCase', str('A')]],
  ['CaseFold', ['CaseFold', ch('ß')], ['CaseFold', str('ß')]],
  ['StringRepeat', ['StringRepeat', ch('a'), 3], ['StringRepeat', str('a'), 3]],
  ['NumberFrom', ['NumberFrom', ch('7')], ['NumberFrom', str('7')]],
  [
    'NumberFrom with a base',
    ['NumberFrom', ch('f'), 16],
    ['NumberFrom', str('f'), 16],
  ],
  [
    'NumberFrom with a character base',
    ['NumberFrom', str('101'), ch('2')],
    ['NumberFrom', str('101'), str('2')],
  ],
  ['DigitsFrom', ['DigitsFrom', ch('7')], ['DigitsFrom', str('7')]],
  [
    'DigitsFrom with a character base',
    ['DigitsFrom', str('101'), ch('2')],
    ['DigitsFrom', str('101'), str('2')],
  ],
  [
    'PadStart (subject and padding)',
    ['PadStart', ch('a'), 3, ch('-')],
    ['PadStart', str('a'), 3, str('-')],
  ],
  [
    'PadEnd (subject and padding)',
    ['PadEnd', ch('a'), 3, ch('.')],
    ['PadEnd', str('a'), 3, str('.')],
  ],
  ['Trim', ['Trim', ch(' ')], ['Trim', str(' ')]],
  [
    'TrimStart',
    ['TrimStart', ch('x'), ch('x')],
    ['TrimStart', str('x'), str('x')],
  ],
  ['TrimEnd', ['TrimEnd', ch('a')], ['TrimEnd', str('a')]],
  [
    'StringReplace (every text operand)',
    ['StringReplace', ch('a'), ch('a'), ch('b')],
    ['StringReplace', str('a'), str('a'), str('b')],
  ],
  [
    'StringReplace (a character replacement in a string)',
    ['StringReplace', str('banana'), str('a'), ch('o')],
    ['StringReplace', str('banana'), str('a'), str('o')],
  ],
  [
    'StringReplace with a pattern',
    ['StringReplace', ch('a'), ['RegExp', str('[a-z]')], ch('Z')],
    ['StringReplace', str('a'), ['RegExp', str('[a-z]')], str('Z')],
  ],
  [
    'StringSplit (subject)',
    ['StringSplit', ch('a')],
    ['StringSplit', str('a')],
  ],
  [
    'StringSplit (separator)',
    ['StringSplit', str('a,b'), ch(',')],
    ['StringSplit', str('a,b'), str(',')],
  ],
  [
    'StringCompare',
    ['StringCompare', ch('a'), ch('b')],
    ['StringCompare', str('a'), str('b')],
  ],
  ['Characters', ['Characters', ch('a')], ['Characters', str('a')]],
  [
    'GraphemeClusters',
    ['GraphemeClusters', ch('a')],
    ['GraphemeClusters', str('a')],
  ],
  ['UnicodeScalars', ['UnicodeScalars', ch('é')], ['UnicodeScalars', str('é')]],
  ['Utf8', ['Utf8', ch('é')], ['Utf8', str('é')]],
  ['Utf16', ['Utf16', ch('\u{1F600}')], ['Utf16', str('\u{1F600}')]],
  ['CharacterFrom', ['CharacterFrom', ch('a')], ['CharacterFrom', str('a')]],
  [
    'StringJoin (separator)',
    ['StringJoin', ['List', str('x'), str('y')], ch('-')],
    ['StringJoin', ['List', str('x'), str('y')], str('-')],
  ],
  [
    'IsMatch',
    ['IsMatch', ch('7'), ['RegExp', str('[0-9]')]],
    ['IsMatch', str('7'), ['RegExp', str('[0-9]')]],
  ],
  [
    'StringMatch',
    ['StringMatch', ch('7'), ['RegExp', str('[0-9]')]],
    ['StringMatch', str('7'), ['RegExp', str('[0-9]')]],
  ],
  [
    'StringMatchAll',
    ['StringMatchAll', ch('7'), ['RegExp', str('[0-9]')]],
    ['StringMatchAll', str('7'), ['RegExp', str('[0-9]')]],
  ],
  [
    'a dictionary lookup with a character key',
    ['At', ['Dictionary', ['Tuple', str('a'), 1]], ch('a')],
    ['At', ['Dictionary', ['Tuple', str('a'), 1]], str('a')],
  ],
  [
    'a dictionary lookup with a character key that is not present',
    ['At', ['Dictionary', ['Tuple', str('a'), str('x')]], ch('b')],
    ['At', ['Dictionary', ['Tuple', str('a'), str('x')]], str('b')],
  ],
];

describe('the box route: a character operand gives the result of the one-character string', () => {
  test.each(CASES)('%s', (_label, withCharacter, asString) => {
    const expr = ce.box(withCharacter);
    // No operand was refused by argument validation.
    expect(expr.isValid).toBe(true);
    const expected = ce.box(asString).evaluate();
    expect(expected.operator).not.toBe('Error');
    expect(expr.evaluate().isSame(expected)).toBe(true);
  });

  test('a case mapping of a character is a STRING, not a character', () => {
    const r = ce.box(['ToUpperCase', ch('a')]).evaluate();
    expect(isString(r)).toBe(true);
    expect(isCharacter(r)).toBe(false);
    expect(r.string).toBe('A');
  });

  test('a character read from a string by index is accepted', () => {
    const r = ce.box(['ToUpperCase', ['At', str('abc'), 2]]).evaluate();
    expect(r.string).toBe('B');
    const n = ce.box(['NumberFrom', ['At', str('472'), 3]]).evaluate();
    expect(n.re).toBe(2);
  });

  test('an invalid numeral in a character is the same error value', () => {
    expect(
      ce
        .box(['NumberFrom', ch('x')])
        .evaluate()
        .isSame(ce.box(['NumberFrom', str('x')]).evaluate())
    ).toBe(true);
  });

  test('a character key is not a key of a string', () => {
    // A string has no keys, so a string key leaves `At` unevaluated, and a
    // character key does the same.
    const r = ce.box(['At', str('abc'), ch('b')]).evaluate();
    expect(r.operator).toBe('At');
  });

  test('a free symbol at a string parameter is typed `string | character`', () => {
    const local = new ComputeEngine();
    local.box(['ToUpperCase', 'w']);
    expect(local.box('w').type.toString()).toBe('character | string');
  });

  test('a later collection use narrows the inferred union to `string`', () => {
    // `Sort` admits `string` but not `character`: the two uses together
    // allow only `string`. The order of the uses does not matter.
    const local = new ComputeEngine();
    local.box(['ToUpperCase', 'w']);
    const sorted = local.box(['Sort', 'w']);
    expect(sorted.isValid).toBe(true);
    expect(local.box('w').type.toString()).toBe('string');

    const tuple = local.box([
      'Tuple',
      ['ToUpperCase', 'v'],
      ['IndexOf', 'v', str('l')],
    ]);
    expect(tuple.isValid).toBe(true);
    expect(local.box('v').type.toString()).toBe('string');
  });

  test('a DECLARED `character | string` is not narrowed by a collection use', () => {
    const local = new ComputeEngine();
    local.declare('w', 'character | string');
    expect(local.box(['Sort', 'w']).isValid).toBe(false);
    expect(local.box('w').type.toString()).toBe('character | string');
  });

  test('a text use is not retyped as a matrix by a later matrix use', () => {
    // The fresh-matrix repair retypes a symbol that `Add` or `Multiply`
    // guessed to be a number. A text type is not such a guess.
    const local = new ComputeEngine();
    const expr = local.box([
      'Tuple',
      ['ToUpperCase', 'w'],
      ['Determinant', 'w'],
    ]);
    expect(expr.isValid).toBe(false);
    expect(local.box('w').type.toString()).toBe('character | string');
  });
});

describe('the Epsil route: the static pre-pass and the evaluation accept a character', () => {
  function run(source: string): string {
    const engine = new ComputeEngine();
    const result = executeEpsil(engine, source, {
      parseLatex: (latex) => engine.parse(latex).json,
    });
    const errors = result.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => d.message);
    expect(errors).toEqual([]);
    return result.value.toString();
  }

  test.each([
    ['toUpperCase(c)', 'let c = "abc"[1]\ntoUpperCase(c)', '"A"'],
    ['toLowerCase(c)', 'let c = "ABC"[1]\ntoLowerCase(c)', '"a"'],
    ['caseFold(c)', 'let c = "ß"[1]\ncaseFold(c)', '"ss"'],
    ['stringRepeat(c, 2)', 'let c = "abc"[1]\nstringRepeat(c, 2)', '"aa"'],
    ['numberFrom("7"[1])', 'numberFrom("7"[1])', '7'],
    ['digitsFrom("7"[1])', 'digitsFrom("7"[1])', '7'],
    [
      'numberFrom(s, base) with a character base',
      'numberFrom("101", "2"[1])',
      '5',
    ],
    [
      'digitsFrom(s, base) with a character base',
      'digitsFrom("101", "2"[1])',
      '5',
    ],
    ['padStart(c, 3, c)', 'let c = "-"[1]\npadStart(c, 3, c)', '"---"'],
    ['padEnd(c, 2)', 'let c = "a"[1]\npadEnd(c, 2)', '"a "'],
    ['trim(c)', 'let c = " "[1]\ntrim(c)', '""'],
    ['trimStart(c)', 'let c = " "[1]\ntrimStart(c)', '""'],
    ['trimEnd(c)', 'let c = " "[1]\ntrimEnd(c)', '""'],
    [
      'stringReplace(s, c, c)',
      'let s = "banana"\nstringReplace(s, s[2], s[3])',
      '"bnnnnn"',
    ],
    ['stringSplit(s, c)', 'stringSplit("a,b", ",abc"[1])', '["a","b"]'],
    ['stringCompare(c, c)', 'stringCompare("ab"[1], "ab"[2])', '-1'],
    ['characters(c)', 'characters("ab"[1])', '["a"]'],
    ['unicodeScalars(c)', 'unicodeScalars("A"[1])', '[65]'],
    ['utf8(c)', 'utf8("é"[1])', '[195,169]'],
    ['utf16(c)', 'utf16("a"[1])', '[97]'],
    ['stringJoin(xs, c)', 'stringJoin(["x", "y"], "-"[1])', '"x-y"'],
    // `True` prints with quotes.
    ['isMatch(c, pattern)', 'isMatch("a7"[2], RegExp("[0-9]"))', '"True"'],
    ['{a -> 1}[c]', 'let c = "abc"[1]\n{a -> 1}[c]', '1'],
  ])('%s', (_label, source, expected) => {
    expect(run(source)).toBe(expected);
  });

  test('`toUpperCase(w[1])` accepts the `character | missing` element', () => {
    expect(
      run(
        'acronym(s) = stringJoin(map(w => toUpperCase(w[1]), stringSplit(s)), "")\n' +
          'acronym("portable network graphics")'
      )
    ).toBe('"PNG"');
  });

  test('a string operator passed by name maps over characters', () => {
    expect(run('map(numberFrom, characters("123"))')).toBe('[1,2,3]');
    expect(run('map(toUpperCase, characters("ab"))')).toBe('["A","B"]');
  });

  test('a dictionary lookup with each character of a string', () => {
    expect(
      run(
        'let complement = {G -> "C", C -> "G", T -> "A", A -> "U"}\n' +
          'stringJoin(map(c => complement[c] ?? "?", characters("GATC")), "")'
      )
    ).toBe('"CUAG"');
  });
});

describe('compilation to JavaScript', () => {
  test('a `character` operand of a string operator compiles', () => {
    const engine = new ComputeEngine();
    engine.declare('chq', 'character');
    const r = compile(engine.box(['ToUpperCase', 'chq']), { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as any)({ chq: 'a' })).toBe('A');
  });

  test('a free symbol typed `string | character` by inference compiles', () => {
    const engine = new ComputeEngine();
    const r = compile(engine.box(['StringRepeat', 'fq', 2]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect((r.run as any)({ fq: 'ab' })).toBe('abab');
  });
});
