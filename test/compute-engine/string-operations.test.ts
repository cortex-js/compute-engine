/**
 * String operations — Strings Phase 2, workstream C
 * (`docs/STRING_ROADMAP.md`: "`Join` vs. `StringJoin`", "Missing operations
 * (proposed)" → String-specific operations / Case operations / Conversions,
 * and "Future: locale-aware collation" → "Shape rules adopted now";
 * `docs/STRING_ROADMAP.md`, decisions D2, D5,
 * D6, D7, D10).
 *
 * Covers the narrowed `StringJoin`, `StringReplace`, `Trim`/`TrimStart`/
 * `TrimEnd`, `StringRepeat`, `PadStart`/`PadEnd`, `ToUpperCase`/
 * `ToLowerCase`/`CaseFold`, `StringCompare` and `NumberFrom`.
 *
 * Unicode assumptions are called out at each non-ASCII expectation. Grapheme
 * segmentation comes from the host's `Intl.Segmenter`, so cluster counts are
 * pinned against the Unicode version the CI Node ships (design constraint 11
 * of the roadmap).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** Precomposed "e with acute", U+00E9: one code point, one cluster. */
const E_ACUTE_PRECOMPOSED = 'é';
/** Decomposed "e" + COMBINING ACUTE ACCENT (U+0065 U+0301). The `BoxedString`
 * constructor NFC-normalizes, so this becomes the precomposed form and also
 * counts as ONE character. */
const E_ACUTE_DECOMPOSED = 'é';
/** MAN + ZWJ + WOMAN + ZWJ + GIRL: five code points, ONE grapheme cluster. */
const ZWJ_FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
/** WOMAN (U+1F469) alone — a code-point-level substring of `ZWJ_FAMILY`, but
 * NOT one of its characters. */
const WOMAN = '\u{1F469}';
/** The flag of France (regional indicators F + R): two code points, ONE
 * grapheme cluster. */
const FLAG_FR = '\u{1F1EB}\u{1F1F7}';

const str = (s: string) => ({ str: s }) as const;

/** Evaluate a MathJSON expression through the `ce.box` route. */
const evalBox = (expr: unknown) => ce.box(expr as never).evaluate();
/** The string content of an evaluated MathJSON expression. */
const text = (expr: unknown): string | undefined => evalBox(expr).string;

describe('StringJoin — narrowed to (collection, separator?)', () => {
  test('joins the elements of a collection with a separator', () => {
    expect(
      text(['StringJoin', ['List', str('a'), str('b'), str('c')], str(', ')])
    ).toBe('a, b, c');
  });

  test('the separator defaults to ""', () => {
    expect(text(['StringJoin', ['List', str('a'), str('b')]])).toBe('ab');
  });

  test('an EMPTY collection joins to "" — with or without a separator', () => {
    expect(text(['StringJoin', ['List']])).toBe('');
    expect(text(['StringJoin', ['List'], str('---')])).toBe('');
  });

  test('a ONE-element collection yields that element, separator unused', () => {
    expect(text(['StringJoin', ['List', str('solo')], str('---')])).toBe(
      'solo'
    );
  });

  test('characters join as their content', () => {
    expect(
      text([
        'StringJoin',
        ['List', ['CharacterFrom', str('a')], ['CharacterFrom', str('b')]],
        str('.'),
      ])
    ).toBe('a.b');
  });

  test('a STRING subject is the collection of its own characters', () => {
    // A string IS an indexed collection of characters, so it is a legal
    // subject: `StringJoin("abc", "-")` interleaves the separator between
    // `"abc"`'s characters — exactly what Python's `"-".join("abc")` does.
    expect(text(['StringJoin', str('abc'), str('-')])).toBe('a-b-c');
    expect(text(['StringJoin', str('abc')])).toBe('abc');
  });

  test('the VARIADIC form is gone: two strings are subject + separator', () => {
    // Before Phase 2 this was `"abcd"`. Variadic concatenation is now `Join`
    // (or `"\(a)\(b)"` interpolation in Epsil); a two-string `StringJoin`
    // call is read as the separator form and interleaves.
    expect(text(['StringJoin', str('ab'), str('cd')])).toBe('acdb');
    expect(text(['Join', str('ab'), str('cd')])).toBe('abcd');
  });

  test('a subject is required', () => {
    expect(evalBox(['StringJoin']).operator).toBe('Error');
  });

  test('a non-finite collection leaves the expression unevaluated', () => {
    const r = evalBox([
      'StringJoin',
      ['Map', ['Function', str('x'), 'c'], ['Range', 1, { num: '+Infinity' }]],
    ]);
    expect(r.operator).toBe('StringJoin');
    expect(r.string).toBeUndefined();
  });

  test('a non-text element is refused, never coerced', () => {
    const r = evalBox(['StringJoin', ['List', str('a'), 3]]);
    expect(r.operator).toBe('Error');
    expect(r.string).toBeUndefined();
  });

  test('`StringJoin(Characters(s)) == s`, clusters included', () => {
    for (const s of [
      'abc',
      E_ACUTE_PRECOMPOSED,
      // The family and the flag are ONE character each, so they survive the
      // split/join round trip whole.
      `a${ZWJ_FAMILY}${FLAG_FR}b`,
    ])
      expect(text(['StringJoin', ['Characters', str(s)]])).toBe(s.normalize());
  });

  test('the inverse law `StringJoin(StringSplit(s, sep), sep) == s`', () => {
    for (const [s, sep] of [
      ['a,b,c', ','],
      // Empty parts are kept by `StringSplit`, so the law survives them.
      ['a,b,,c', ','],
      [',lead and trail,', ','],
      ['one', ','],
      // A multi-character separator, and a subject whose characters are
      // multi-code-point clusters.
      [`${ZWJ_FAMILY}::${FLAG_FR}`, '::'],
      [`${E_ACUTE_PRECOMPOSED}-${E_ACUTE_PRECOMPOSED}`, '-'],
    ] as const)
      expect(
        text(['StringJoin', ['StringSplit', str(s), str(sep)], str(sep)])
      ).toBe(s.normalize());
  });
});

describe('StringReplace', () => {
  test('replaces every occurrence, left to right', () => {
    expect(text(['StringReplace', str('banana'), str('na'), str('X')])).toBe(
      'baXX'
    );
  });

  test('a replacement is never re-matched', () => {
    // The scan walks the ORIGINAL character sequence and skips past each
    // match, so the inserted `"aa"` is not searched again.
    expect(text(['StringReplace', str('aa'), str('a'), str('aa')])).toBe(
      'aaaa'
    );
  });

  test('matches are non-overlapping', () => {
    expect(text(['StringReplace', str('aaaa'), str('aa'), str('X')])).toBe(
      'XX'
    );
    expect(text(['StringReplace', str('aaa'), str('aa'), str('X')])).toBe('Xa');
  });

  test('`count` limits the replacements, from the left', () => {
    expect(text(['StringReplace', str('banana'), str('na'), str('X'), 1])).toBe(
      'baXna'
    );
    expect(text(['StringReplace', str('banana'), str('na'), str('X'), 9])).toBe(
      'baXX'
    );
  });

  test('an EMPTY replacement means deletion', () => {
    expect(text(['StringReplace', str('banana'), str('na'), str('')])).toBe(
      'ba'
    );
  });

  test('an EMPTY target is an error value', () => {
    // The host `replaceAll("", x)` insert-at-every-boundary behavior is
    // deliberately rejected, not inherited.
    const r = evalBox(['StringReplace', str('abc'), str(''), str('X')]);
    expect(r.operator).toBe('Error');
  });

  test('a non-positive or fractional `count` is an error value', () => {
    for (const count of [0, -1, 1.5])
      expect(
        evalBox(['StringReplace', str('abc'), str('b'), str('X'), count])
          .operator
      ).toBe('Error');
  });

  test('a non-string operand leaves the expression unevaluated', () => {
    const r = evalBox(['StringReplace', 'x', str('b'), str('X')]);
    expect(r.string).toBeUndefined();
  });

  test('matching is character-wise: no match starts inside a cluster', () => {
    // `"ée"` NFC-normalizes to [é, e]: the leading `e` belongs to the `é`
    // cluster, so only the FINAL `e` is replaced.
    expect(
      text(['StringReplace', str(`${E_ACUTE_DECOMPOSED}e`), str('e'), str('X')])
    ).toBe(`${E_ACUTE_PRECOMPOSED}X`);

    // WOMAN's code points occur inside the ZWJ family cluster, but the
    // subject's characters are [family, a] — and neither is WOMAN.
    expect(
      text(['StringReplace', str(`${ZWJ_FAMILY}a`), str(WOMAN), str('X')])
    ).toBe(`${ZWJ_FAMILY}a`);

    // The whole cluster does match.
    expect(
      text(['StringReplace', str(`${ZWJ_FAMILY}a`), str(ZWJ_FAMILY), str('X')])
    ).toBe('Xa');
  });
});

describe('Trim / TrimStart / TrimEnd', () => {
  test('the default set is Unicode White_Space', () => {
    // U+00A0 NO-BREAK SPACE and U+3000 IDEOGRAPHIC SPACE are White_Space but
    // are not matched by every host's `\s`; the engine spells the set out.
    expect(text(['Trim', str('  \t hi \n　')])).toBe('hi');
    expect(text(['TrimStart', str('  hi  ')])).toBe('hi  ');
    expect(text(['TrimEnd', str('  hi  ')])).toBe('  hi');
  });

  test('a string `chars` argument is a SET of characters, not a substring', () => {
    expect(text(['Trim', str('abXba'), str('ab')])).toBe('X');
    expect(text(['TrimStart', str('xxhixx'), str('x')])).toBe('hixx');
    expect(text(['TrimEnd', str('xyhiyx'), str('xy')])).toBe('xyhi');
  });

  test('`chars` may be a collection of characters', () => {
    expect(
      text([
        'Trim',
        str('abXba'),
        ['List', ['CharacterFrom', str('a')], ['CharacterFrom', str('b')]],
      ])
    ).toBe('X');
  });

  test('`chars` may be a bare character, or a collection of strings', () => {
    // The declared type of `chars` matches the handler and the JS lowering:
    // a character, a string, or a collection whose elements are either.
    expect(text(['Trim', str('aXa'), ['CharacterFrom', str('a')]])).toBe('X');
    expect(text(['Trim', str('xyaxy'), ['List', str('x'), str('y')]])).toBe(
      'a'
    );
    // A MULTI-CHARACTER element contributes each of its own characters, just
    // as a bare string operand does — so a `StringSplit` result is usable.
    expect(text(['Trim', str('abcXcba'), ['List', str('abc')]])).toBe('X');
    expect(
      text(['Trim', str('xyaxy'), ['StringSplit', str('x,y'), str(',')]])
    ).toBe('a');
  });

  test('trimming walks whole characters', () => {
    // The decomposed é normalizes to the precomposed one, so a precomposed
    // `chars` argument strips it; the combining mark is never seen alone.
    expect(
      text([
        'Trim',
        str(`${E_ACUTE_DECOMPOSED}x${E_ACUTE_DECOMPOSED}`),
        str(E_ACUTE_PRECOMPOSED),
      ])
    ).toBe('x');
    // The flag is ONE character: it is stripped whole, never half a pair.
    expect(text(['Trim', str(`${FLAG_FR}hi${FLAG_FR}`), str(FLAG_FR)])).toBe(
      'hi'
    );
  });

  test('trimming everything yields ""', () => {
    expect(text(['Trim', str('   ')])).toBe('');
    expect(text(['Trim', str('aaa'), str('a')])).toBe('');
  });

  test('a non-string subject leaves the expression unevaluated', () => {
    expect(evalBox(['Trim', 'x']).string).toBeUndefined();
  });
});

describe('StringRepeat', () => {
  test('n copies', () => {
    expect(text(['StringRepeat', str('ab'), 3])).toBe('ababab');
  });

  test('n = 0 is ""', () => {
    expect(text(['StringRepeat', str('ab'), 0])).toBe('');
  });

  test('a negative or non-integer n is an error value', () => {
    expect(evalBox(['StringRepeat', str('ab'), -1]).operator).toBe('Error');
    expect(evalBox(['StringRepeat', str('ab'), 1.5]).operator).toBe('Error');
  });

  test('clusters are repeated whole', () => {
    // Three flags — six code points, three characters. Repeating never
    // splits the regional-indicator pair.
    expect(text(['StringRepeat', str(FLAG_FR), 3])).toBe(FLAG_FR.repeat(3));
    expect(evalBox(['Length', ['StringRepeat', str(FLAG_FR), 3]]).re).toBe(3);
  });
});

describe('PadStart / PadEnd', () => {
  test('pads to `n` characters with the default single space', () => {
    expect(text(['PadStart', str('a'), 3])).toBe('  a');
    expect(text(['PadEnd', str('a'), 3])).toBe('a  ');
  });

  test('a string already `n` characters or longer is unchanged', () => {
    expect(text(['PadStart', str('abc'), 3])).toBe('abc');
    expect(text(['PadStart', str('abc'), 2])).toBe('abc');
    expect(text(['PadEnd', str('abc'), 0])).toBe('abc');
  });

  test('a multi-character pad repeats, truncated to fit', () => {
    expect(text(['PadStart', str('a'), 4, str('xy')])).toBe('xyxa');
    expect(text(['PadEnd', str('a'), 4, str('xy')])).toBe('axyx');
  });

  test('truncation lands on a CHARACTER boundary', () => {
    // The pad is [family, flag] — two multi-code-point clusters. Padding
    // `"a"` to four characters takes family, flag, family: the final copy is
    // cut between clusters, never inside one.
    const padded = text(['PadStart', str('a'), 4, str(ZWJ_FAMILY + FLAG_FR)]);
    expect(padded).toBe(`${ZWJ_FAMILY}${FLAG_FR}${ZWJ_FAMILY}a`);
    expect(
      evalBox(['Length', ['PadStart', str('a'), 4, str(ZWJ_FAMILY + FLAG_FR)]])
        .re
    ).toBe(4);
  });

  test('an EMPTY pad is an error value', () => {
    expect(evalBox(['PadStart', str('a'), 3, str('')]).operator).toBe('Error');
    expect(evalBox(['PadEnd', str('a'), 3, str('')]).operator).toBe('Error');
  });

  test('a negative or non-integer `n` is an error value', () => {
    expect(evalBox(['PadStart', str('a'), -1]).operator).toBe('Error');
    expect(evalBox(['PadEnd', str('a'), 2.5]).operator).toBe('Error');
  });

  test('a non-string pad leaves the expression unevaluated', () => {
    expect(evalBox(['PadStart', str('a'), 3, 'x']).string).toBeUndefined();
  });
});

describe('ToUpperCase / ToLowerCase / CaseFold', () => {
  test('ASCII', () => {
    expect(text(['ToUpperCase', str('hi there')])).toBe('HI THERE');
    expect(text(['ToLowerCase', str('Hi There')])).toBe('hi there');
    expect(text(['CaseFold', str('Hi There')])).toBe('hi there');
  });

  test('case mapping can change the character count', () => {
    // LATIN SMALL LETTER SHARP S uppercases to the two characters "SS".
    expect(text(['ToUpperCase', str('straße')])).toBe('STRASSE');
    expect(text(['CaseFold', str('straße')])).toBe('strasse');
    // …which is what makes the caseless comparison with "strasse" succeed.
    expect(text(['CaseFold', str('straße')])).toBe(
      text(['CaseFold', str('STRASSE')])
    );
  });

  test('case mapping is contextual: the Greek final sigma', () => {
    // Lower-casing "ΟΔΟΣ" gives the FINAL sigma "ς" (U+03C2) in last
    // position, not the medial "σ" (U+03C3) — a whole-string, not a
    // per-character, mapping.
    expect(text(['ToLowerCase', str('ΟΔΟΣ')])).toBe('οδος');
    expect(text(['ToUpperCase', str('οδος')])).toBe('ΟΔΟΣ');
  });

  test('CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")', () => {
    // The reason `CaseFold` exists: comparing `ToLowerCase` results would
    // fail here, since one side ends in the final sigma "ς" (U+03C2) and the
    // other in the medial "σ" (U+03C3). `CaseFold` maps both to the medial
    // form.
    const folded = text(['CaseFold', str('ΟΔΟΣ')]);
    expect(folded).toBe('οδοσ');
    expect(folded).toBe(text(['CaseFold', str('οδοσ')]));
    expect(folded).toBe(text(['CaseFold', str('οδος')]));
    expect(text(['ToLowerCase', str('ΟΔΟΣ')])).not.toBe(
      text(['ToLowerCase', str('οδοσ')])
    );
  });

  test('clusters without a case mapping are untouched', () => {
    expect(text(['ToUpperCase', str(`a${ZWJ_FAMILY}${FLAG_FR}`)])).toBe(
      `A${ZWJ_FAMILY}${FLAG_FR}`
    );
    // The precomposed é uppercases to the precomposed É (one character).
    expect(text(['ToUpperCase', str(E_ACUTE_DECOMPOSED)])).toBe('É');
  });

  test('a non-string operand leaves the expression unevaluated', () => {
    for (const op of ['ToUpperCase', 'ToLowerCase', 'CaseFold'])
      expect(evalBox([op, 'x']).string).toBeUndefined();
  });
});

describe('StringCompare', () => {
  test('-1 / 0 / 1, as exact integers', () => {
    expect(evalBox(['StringCompare', str('a'), str('b')]).re).toBe(-1);
    expect(evalBox(['StringCompare', str('b'), str('a')]).re).toBe(1);
    expect(evalBox(['StringCompare', str('a'), str('a')]).re).toBe(0);
    expect(evalBox(['StringCompare', str('a'), str('b')]).type.toString()).toBe(
      'finite_integer'
    );
  });

  test('a prefix sorts before the longer string', () => {
    expect(evalBox(['StringCompare', str('ab'), str('abc')]).re).toBe(-1);
    expect(evalBox(['StringCompare', str(''), str('a')]).re).toBe(-1);
    expect(evalBox(['StringCompare', str(''), str('')]).re).toBe(0);
  });

  test('the order is on SCALARS, not UTF-16 code units', () => {
    // U+1F600 GRINNING FACE is astral: as UTF-16 it starts with the
    // surrogate U+D83D, which JS `<` sorts BELOW U+E000 (a private-use
    // character). By scalar order the astral character is greater — this is
    // the one case where `StringCompare` and the interpreter's raw `<`
    // disagree, deliberately (roadmap decision D6).
    expect(evalBox(['StringCompare', str('\u{1F600}'), str('')]).re).toBe(1);
    expect('\u{1F600}' < '').toBe(true);
  });

  test('NFC normalization happens before comparing', () => {
    // Both spellings of é normalize to U+00E9, so they compare equal.
    expect(
      evalBox([
        'StringCompare',
        str(E_ACUTE_PRECOMPOSED),
        str(E_ACUTE_DECOMPOSED),
      ]).re
    ).toBe(0);
  });

  test('a non-string operand leaves the expression unevaluated', () => {
    expect(evalBox(['StringCompare', 'x', str('a')]).string).toBeUndefined();
  });
});

describe('NumberFrom — the parse grammar', () => {
  // The accepted grammar (`docs/STRING_ROADMAP.md`, "Conversions"): optional
  // surrounding Unicode White_Space, an optional sign, then either a decimal
  // numeral (ASCII digits, optional "." fraction, optional e/E exponent) or
  // one of `oo`, `+oo`, `-oo`, `NaN`. The two sides of the "." differ (user
  // ruling 2026-08-16): the integer part may be omitted when a fraction
  // follows (".5" is 0.5), but a trailing "." with no fraction digits ("5.")
  // is a reject.
  test.each([
    ['42', '42'],
    ['-42', '-42'],
    ['+42', '42'],
    ['0', '0'],
    ['007', '7'],
    ['  12  ', '12'],
    [' 　12\t\n', '12'], // U+00A0 and U+3000 are White_Space too
    ['1.5', '1.5'],
    ['-0.25', '-0.25'],
    ['1.5e3', '1500'],
    ['-2.5E-3', '-0.0025'],
    ['1e400', '1e+400'],
    // A leading "." with no integer part: the common hand-entered spelling.
    ['.5', '0.5'],
    ['-.5', '-0.5'],
    ['+.5', '0.5'],
    ['.5e2', '50'],
    ['oo', '+oo'],
    ['+oo', '+oo'],
    ['-oo', '-oo'],
  ])('NumberFrom(%p) is %p', (input, expected) => {
    expect(evalBox(['NumberFrom', str(input)]).toString()).toBe(expected);
  });

  test('"NaN" parses to NaN — which is why failure cannot be NaN', () => {
    expect(evalBox(['NumberFrom', str('NaN')]).isNaN).toBe(true);
  });

  test.each([
    [''], // the empty string is a REJECT, not 0 and not NaN
    ['   '],
    ['1/3'], // rationals are not accepted: use DigitsFrom or arithmetic
    ['12abc'], // `parseFloat` would answer 12 — a numeric PREFIX is a reject
    ['abc'],
    ['5.'], // a trailing "." with no fraction digits is a truncation, not a
    // numeral — unlike ".5", which is accepted above
    ['.'],
    ['.e2'],
    ['1 2'], // whitespace is allowed only around the numeral
    ['1,5'],
    ['0x1f'], // no radix prefixes: use the `base` argument
    ['nan'], // the spellings are exact
    ['NAN'],
    ['Infinity'],
    ['١٢'], // ARABIC-INDIC DIGITs ONE TWO: ASCII digits only, to avoid
    // homoglyph confusion
    ['１２'], // FULLWIDTH DIGITs ONE TWO, likewise
    ['+'],
    ['e5'],
    ['1e'],
    ['1e2.5'],
  ])('NumberFrom(%p) is an error value', (input) => {
    const r = evalBox(['NumberFrom', str(input)]);
    expect(r.operator).toBe('Error');
    expect(r.isNaN).not.toBe(true);
  });

  test('the error names the offending text', () => {
    expect(evalBox(['NumberFrom', str('12abc')]).toString()).toContain(
      'invalid-number'
    );
  });

  test('a non-string operand leaves the expression unevaluated', () => {
    expect(evalBox(['NumberFrom', 'x']).string).toBeUndefined();
  });
});

describe('NumberFrom — letter digits are case-insensitive', () => {
  test('uppercase and lowercase hex digits read the same', () => {
    // `fromDigits` (shared with `DigitsFrom`) lowercases each letter digit
    // before the lookup, so the more common uppercase hex spelling works.
    expect(evalBox(['NumberFrom', str('FF'), 16]).toString()).toBe('255');
    expect(evalBox(['NumberFrom', str('ff'), 16]).toString()).toBe('255');
    expect(evalBox(['NumberFrom', str('Ff'), 16]).toString()).toBe('255');
    expect(evalBox(['DigitsFrom', str('FF'), 16]).toString()).toBe('255');
  });
});

describe('NumberFrom — exactness', () => {
  test('an integer numeral is an exact integer of any size', () => {
    const big = evalBox(['NumberFrom', str('123456789012345678901234567890')]);
    // Every digit survives: the numeral goes through the same route as a
    // literal, not through `parseFloat` (which would round to 17 digits).
    expect(big.toString()).toBe('123456789012345678901234567890');
    expect(big.isSame(ce.parse('123456789012345678901234567890'))).toBe(true);
  });

  test('a numeral boxes identically to the same literal', () => {
    for (const t of ['42', '1.5', '0.1', '1.5e3', '-2.5E-3'])
      expect(evalBox(['NumberFrom', str(t)]).isSame(ce.parse(t))).toBe(true);
  });

  test('an integer-part-less numeral is the same value as its 0-prefixed form', () => {
    // `.5` denotes exactly what `0.5` does — an exact decimal, not a float
    // approximation of one.
    expect(evalBox(['NumberFrom', str('.5')]).isSame(ce.parse('0.5'))).toBe(
      true
    );
    expect(evalBox(['NumberFrom', str('-.5')]).isSame(ce.parse('-0.5'))).toBe(
      true
    );
    expect(evalBox(['NumberFrom', str('.5e2')]).type.toString()).toBe(
      'finite_integer'
    );
  });

  test('a decimal keeps its digits, and `.N()` does not change it', () => {
    // The engine's decimal literals are BigDecimal-backed: 22 significant
    // digits survive, where a double would keep about 17.
    const d = evalBox(['NumberFrom', str('0.1234567890123456789012')]);
    expect(d.toString()).toBe(ce.parse('0.1234567890123456789012').toString());
    // `NumberFrom("1.5")` is the value 1.5, not an approximation of it:
    // evaluating and numericizing agree.
    const one = evalBox(['NumberFrom', str('1.5')]);
    expect(one.N().toString()).toBe('1.5');
    expect(one.toString()).toBe('1.5');
  });

  test('an exponent numeral that denotes an integer IS an integer', () => {
    expect(evalBox(['NumberFrom', str('1.5e3')]).type.toString()).toBe(
      'finite_integer'
    );
  });
});

describe('NumberFrom — the `base` argument', () => {
  test('integer numerals in base 2..36', () => {
    expect(evalBox(['NumberFrom', str('101'), 2]).re).toBe(5);
    expect(evalBox(['NumberFrom', str('-101'), 2]).re).toBe(-5);
    expect(evalBox(['NumberFrom', str('zz'), 36]).re).toBe(1295);
    expect(evalBox(['NumberFrom', str('ff'), 16]).re).toBe(255);
    // The base may be written as a numeric string, as `DigitsFrom` allows.
    expect(evalBox(['NumberFrom', str('101'), str('2')]).re).toBe(5);
  });

  test('only INTEGER numerals are accepted with a base', () => {
    expect(evalBox(['NumberFrom', str('1.5'), 2]).operator).toBe('Error');
    expect(evalBox(['NumberFrom', str('1e3'), 2]).operator).toBe('Error');
  });

  test('a digit outside the base is reported', () => {
    expect(evalBox(['NumberFrom', str('123'), 2]).toString()).toContain(
      'unexpected-digit'
    );
  });

  test('a base outside 2..36 is reported', () => {
    for (const base of [1, 0, 37])
      expect(evalBox(['NumberFrom', str('12'), base]).toString()).toContain(
        'unexpected-base'
      );
    // A fractional base never reaches the handler: the declared signature
    // `(string, base: (string|integer)?)` refuses it as a type error.
    expect(evalBox(['NumberFrom', str('12'), 2.5]).toString()).toContain(
      'incompatible-type'
    );
  });

  test('a STRING base is read whole: a numeric PREFIX is not a base', () => {
    // `Number.parseInt("16abc", 10)` is 16 — reading the base that way would
    // silently accept text the user never meant as a number.
    expect(
      evalBox(['NumberFrom', str('ff'), str('16abc')]).toString()
    ).toContain('unexpected-base');
    expect(
      evalBox(['DigitsFrom', str('ff'), str('16abc')]).toString()
    ).toContain('unexpected-base');
    // The well-formed spelling still works.
    expect(evalBox(['NumberFrom', str('ff'), str('16')]).re).toBe(255);
  });

  test('a `0x`/`0b` radix prefix is refused: the base operand is the authority', () => {
    // `fromDigits` reads the prefix as an OVERRIDE, so `("0x10", 10)` would
    // answer 16. The base-less form already rejects `"0x1f"`, so does this.
    expect(evalBox(['NumberFrom', str('0x10'), 10]).toString()).toContain(
      'invalid-number'
    );
    expect(evalBox(['NumberFrom', str('0b11'), 10]).toString()).toContain(
      'invalid-number'
    );
    expect(evalBox(['NumberFrom', str('0X10'), 10]).toString()).toContain(
      'invalid-number'
    );
    // A leading zero that is not a prefix is still fine.
    expect(evalBox(['NumberFrom', str('010'), 16]).re).toBe(16);
  });

  test('a long base-N numeral is read EXACTLY', () => {
    // `fromDigits` accumulates in a float (`value * base + k`), which rounds
    // past 2^53; the operator promises exactness, so the numeral is re-read
    // as a BigInt.
    const digits = 'fedcba9876543210fedcba9876543210';
    const expected = BigInt(`0x${digits}`);
    expect(evalBox(['NumberFrom', str(digits), 16]).toString()).toBe(
      expected.toString()
    );
    expect(evalBox(['NumberFrom', str(`-${digits}`), 16]).toString()).toBe(
      (-expected).toString()
    );
    // …and the exact value is the one `ce.parse` of the decimal spelling has.
    expect(
      evalBox(['NumberFrom', str(digits), 16]).isSame(
        ce.parse(expected.toString())
      )
    ).toBe(true);
  });
});

describe('routes: ce.box, ce.function, Epsil', () => {
  test('ce.function agrees with ce.box', () => {
    expect(
      ce
        .function('StringReplace', [
          ce.string('banana'),
          ce.string('na'),
          ce.string('X'),
        ])
        .evaluate().string
    ).toBe('baXX');
    expect(
      ce
        .function('StringJoin', [
          ce.function('List', [ce.string('a'), ce.string('b')]),
          ce.string('-'),
        ])
        .evaluate().string
    ).toBe('a-b');
    expect(
      ce.function('PadStart', [ce.string('7'), ce.number(3)]).evaluate().string
    ).toBe('  7');
    expect(ce.function('CaseFold', [ce.string('ΟΔΟΣ')]).evaluate().string).toBe(
      'οδοσ'
    );
    expect(
      ce
        .function('NumberFrom', [ce.string('1.5')])
        .evaluate()
        .toString()
    ).toBe('1.5');
  });

  test.each([
    ['StringJoin(["a", "b"], "-")', '"a-b"'],
    ['StringJoin(StringSplit("a b c"), ",")', '"a,b,c"'],
    ['Join("a", "b")', '"ab"'],
    ['StringReplace("banana", "na", "X")', '"baXX"'],
    ['StringReplace("banana", "na", "X", 1)', '"baXna"'],
    ['Trim("  hi  ")', '"hi"'],
    ['TrimStart("...hi", ".")', '"hi"'],
    ['TrimEnd("hi...", ".")', '"hi"'],
    ['StringRepeat("ab", 3)', '"ababab"'],
    ['PadStart("7", 3, "0")', '"007"'],
    ['PadEnd("7", 3, "0")', '"700"'],
    ['ToUpperCase("hi")', '"HI"'],
    ['ToLowerCase("HI")', '"hi"'],
    ['CaseFold("Hi")', '"hi"'],
    ['StringCompare("a", "b")', '-1'],
    ['NumberFrom("1.5")', '1.5'],
    ['NumberFrom("101", 2)', '5'],
  ])('Epsil: %s evaluates to %s', (source, expected) => {
    const engine = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(engine, source);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe(expected);
  });

  test('Epsil: CaseFold is the caseless equality primitive', () => {
    const engine = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      engine,
      'CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")'
    );
    expect(diagnostics).toEqual([]);
    expect(value.symbol).toBe('True');
  });
});
