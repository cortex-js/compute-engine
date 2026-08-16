/**
 * Strings as INDEXED COLLECTIONS of characters
 * (Strings Phase 1, `docs/STRING_ROADMAP.md` — "Decision: strings become
 * indexed collections of characters").
 *
 * A string is iterable, 1-based indexable and countable, with its grapheme
 * clusters as elements. Two properties keep that from leaking everywhere it
 * would be wrong: a string is ATOMIC under broadcast (a scalar-parameter
 * operator applied to a string receives the WHOLE string) and under `Flatten`.
 *
 * Unicode assumptions are called out at each non-ASCII expectation. Grapheme
 * segmentation comes from the host's `Intl.Segmenter`, so counts are pinned
 * against the Unicode version the CI Node ships (design constraint 11).
 */

import { ComputeEngine } from '../../src/compute-engine';

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
/** The flag of France (regional indicators F + R): two code points, ONE
 * grapheme cluster. */
const FLAG_FR = '\u{1F1EB}\u{1F1F7}';

const str = (s: string) => ({ str: s }) as const;

describe('collection facets', () => {
  test('a string reports itself an indexed, finite collection', () => {
    const s = ce.string('abc');
    expect(s.isCollection).toBe(true);
    expect(s.isIndexedCollection).toBe(true);
    expect(s.isFiniteCollection).toBe(true);
    expect(s.isEmptyCollection).toBe(false);
    expect(ce.string('').isEmptyCollection).toBe(true);
  });

  test('`Length` counts GRAPHEME CLUSTERS', () => {
    expect(ce.box(['Length', str('shop')]).evaluate().re).toBe(4);
    // One cluster whichever way the accent is written — the constructor
    // normalizes to NFC.
    expect(ce.box(['Length', str(E_ACUTE_PRECOMPOSED)]).evaluate().re).toBe(1);
    expect(ce.box(['Length', str(E_ACUTE_DECOMPOSED)]).evaluate().re).toBe(1);
    // A ZWJ family sequence is ONE user-perceived character (its `.length` in
    // UTF-16 code units is 8).
    expect(ce.box(['Length', str(ZWJ_FAMILY)]).evaluate().re).toBe(1);
    // A regional-indicator flag is likewise ONE character (4 UTF-16 units).
    expect(ce.box(['Length', str(FLAG_FR)]).evaluate().re).toBe(1);
  });

  test('CR LF is ONE cluster, even though both units are ASCII', () => {
    // UAX #29 rule GB3 keeps a CR LF pair together, the one case where two
    // ASCII code units form a single grapheme cluster. `Length` must agree
    // with `Characters`, which always segments.
    expect(ce.box(['Length', str('a\r\nb')]).evaluate().re).toBe(3);
    expect(
      ce.box(['Length', ['Characters', str('a\r\nb')]]).evaluate().re
    ).toBe(3);
    // Position 2 is the whole CR LF, not a bare CR.
    expect(ce.box(['At', str('a\r\nb'), 2]).evaluate().string).toBe('\r\n');
    // A CR on its own is still one character, and a lone LF is unaffected.
    expect(ce.box(['Length', str('a\rb')]).evaluate().re).toBe(3);
    expect(ce.box(['Length', str('a\nb')]).evaluate().re).toBe(3);
  });

  test('`each()` yields CHARACTERS', () => {
    const elements = [...ce.string('abc').each()];
    expect(elements.map((x) => x.type.toString())).toEqual([
      'character',
      'character',
      'character',
    ]);
    expect(elements.map((x) => x.string)).toEqual(['a', 'b', 'c']);
  });

  test('`at` is 1-based, with a negative index counting from the end', () => {
    const s = ce.string('abc');
    expect(s.at(1)?.string).toBe('a');
    expect(s.at(3)?.string).toBe('c');
    expect(s.at(-1)?.string).toBe('c');
    expect(s.at(-3)?.string).toBe('a');
    // Out of range (and the 0 index, which is not a position) yields nothing.
    expect(s.at(0)).toBeUndefined();
    expect(s.at(4)).toBeUndefined();
    expect(s.at(-4)).toBeUndefined();
  });

  test('`At` over a string', () => {
    expect(ce.box(['At', str('abc'), 2]).evaluate().string).toBe('b');
    expect(ce.box(['At', str('abc'), -1]).evaluate().string).toBe('c');
    // The astral-plane cluster comes out whole, never split into surrogates.
    expect(ce.box(['At', str(`a${ZWJ_FAMILY}b`), 2]).evaluate().string).toBe(
      ZWJ_FAMILY
    );
  });

  test('`At` with a STRING key stays unevaluated', () => {
    // A string is an INDEXED collection: it has no keys, so a string index is
    // not a key that is missing — it is an access a string does not offer.
    // The absence marker would claim the lookup happened and found nothing.
    const expr = ce.box(['At', str('abc'), str('b')]).evaluate();
    expect(expr.operator).toBe('At');
    expect(expr.op2.string).toBe('b');
  });

  test('`contains` is CHARACTER membership, not substring search', () => {
    const s = ce.string('abc');
    expect(s.contains(ce.character('b'))).toBe(true);
    // The character/string equality bridge means a one-cluster STRING answers
    // the same as the equivalent character.
    expect(s.contains(ce.string('b'))).toBe(true);
    expect(s.contains(ce.string('z'))).toBe(false);
    // "ab" is a SUBSTRING, not an element: `in` is element membership.
    expect(s.contains(ce.string('ab'))).toBe(false);
  });

  test('the roadmap motivating example works verbatim', () => {
    // `isDigit(c) = c in "0123456789"`.
    ce.declare('isDigit', '(character) -> boolean');
    ce.assign(
      'isDigit',
      ce.function('Function', [
        ce.function('Element', [ce.symbol('c'), ce.string('0123456789')]),
        ce.symbol('c'),
      ])
    );
    expect(ce.function('isDigit', [ce.string('7')]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.function('isDigit', [ce.string('x')]).evaluate().symbol).toBe(
      'False'
    );
  });

  test('`Contains`, `IndexOf` and `IndexWhere` over a string', () => {
    expect(ce.box(['Contains', str('abc'), str('b')]).evaluate().symbol).toBe(
      'True'
    );
    expect(ce.box(['IndexOf', str('abc'), str('b')]).evaluate().re).toBe(2);
    expect(ce.box(['IndexOf', str('abc'), str('z')]).evaluate().re).toBe(0);
  });

  test('`Tally` and `Unique` see characters', () => {
    // `Unique` is string-PRESERVING (its distinct characters, in
    // first-occurrence order, are a string) — see the
    // "string-preserving operators" describe below. `Tally` is not: it returns
    // a pair of parallel lists, so its values half is a `list<character>`.
    expect(
      ce
        .box(['Unique', str('aabbc')])
        .evaluate()
        .toString()
    ).toBe('"abc"');
    expect(
      ce
        .box(['Tally', str('aab')])
        .evaluate()
        .toString()
    ).toBe('(["a","b"], [2,1])');
  });

  test('`Map` over a string is a LIST, permanently', () => {
    // Element-TRANSFORMING operators are list-out even for a
    // character→character callback: rejoin explicitly with `String(...)`.
    const m = ce.box(['Map', ['Function', 'c', 'c'], str('abc')]);
    // A `list`, never a `string` — even for this identity callback, whose
    // result type the element stamp makes `character`.
    expect(m.type.toString()).toBe('list<character>');
    expect(m.evaluate().toString()).toBe('["a","b","c"]');
  });
});

describe('well-formedness at ingress', () => {
  test('a lone surrogate becomes U+FFFD', () => {
    // A native JS string can hold an unpaired UTF-16 surrogate; segmentation
    // and UTF-8 encoding are undefined on such a value, so the constructor
    // replaces each with the REPLACEMENT CHARACTER.
    const s = ce.string('a\ud800b');
    expect(s.string).toBe('a�b');
    expect(s.count).toBe(3);
  });

  test('a well-formed surrogate PAIR is untouched', () => {
    const s = ce.string('a\u{1F600}b');
    expect(s.string).toBe('a\u{1F600}b');
    expect(s.count).toBe(3);
  });
});

describe('conversion laws', () => {
  test('`Characters` yields a `list<character>`', () => {
    const cs = ce.box(['Characters', str('abc')]);
    expect(cs.type.toString()).toBe('list<character>');
    const elements = [...cs.evaluate().each()];
    expect(elements.every((x) => x.type.toString() === 'character')).toBe(true);
  });

  test('`GraphemeClusters` is the same', () => {
    expect(ce.box(['GraphemeClusters', str('abc')]).type.toString()).toBe(
      'list<character>'
    );
  });

  test('`String(Characters(s)) == s` — always', () => {
    for (const s of ['abc', E_ACUTE_PRECOMPOSED, `a${ZWJ_FAMILY}${FLAG_FR}b`]) {
      const round = ce.box(['String', ['Characters', str(s)]]).evaluate();
      expect(round.string).toBe(s.normalize());
    }
  });

  test('`StringJoin(Characters(s)) == s`', () => {
    for (const s of ['abc', `a${FLAG_FR}b`]) {
      const round = ce.box(['StringJoin', ['Characters', str(s)]]).evaluate();
      expect(round.string).toBe(s.normalize());
    }
  });

  test('`Characters(String(cs))` may have FEWER elements than `cs`', () => {
    // Joining an "e" and a lone COMBINING ACUTE ACCENT — each its own cluster
    // — yields the single precomposed "é". This is inherent to grapheme
    // segmentation, not a defect.
    const cs = ce.function('List', [ce.character('e'), ce.character('́')]);
    const joined = ce.function('String', [cs]).evaluate();
    expect(joined.string).toBe(E_ACUTE_PRECOMPOSED);
    expect(joined.count).toBe(1);
  });
});

describe('broadcast atomicity', () => {
  test('`String("ab", 1)` joins, it does not map', () => {
    // Without atomicity the string operand would zip against the scalar and
    // produce a list of two strings.
    expect(ce.box(['String', str('ab'), 1]).evaluate().string).toBe('ab1');
  });

  test('a multi-argument `String` still broadcasts over a LIST operand', () => {
    // The carve-out governs a STRING operand; a list argument alongside
    // another operand keeps the coercing-join-with-broadcast semantics.
    expect(
      ce
        .box(['String', str('x'), ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('["x1","x2"]');
  });

  test('a scalar-parameter lambda applied to a string receives the WHOLE string', () => {
    ce.declare('lenOf', '(string) -> integer');
    ce.assign(
      'lenOf',
      ce.function('Function', [
        ce.function('Length', [ce.symbol('s')]),
        ce.symbol('s'),
      ])
    );
    const call = ce.function('lenOf', [ce.string('abc')]).evaluate();
    // 3, not `[1, 1, 1]` (which is what mapping over the characters gives).
    expect(call.re).toBe(3);
  });

  test('an ordering over two strings is a scalar boolean', () => {
    expect(ce.box(['Less', str('a'), str('m')]).evaluate().symbol).toBe('True');
  });

  test('an equality of a string LIST against a string still broadcasts', () => {
    // The list is the broadcast source; the string is the scalar lifted into
    // every cell.
    expect(
      ce
        .box(['Equal', ['List', str('a'), str('b')], str('a')])
        .evaluate()
        .toString()
    ).toBe('["True","False"]');
  });
});

describe('Flatten atomicity', () => {
  test('`Flatten` treats a string as a LEAF', () => {
    expect(
      ce
        .box(['Flatten', ['List', str('ab'), str('cd')]])
        .evaluate()
        .toString()
    ).toBe('["ab","cd"]');
  });

  test('a bare string flattens to a one-element list, like a scalar', () => {
    expect(
      ce
        .box(['Flatten', str('ab')])
        .evaluate()
        .toString()
    ).toBe('["ab"]');
  });

  test('an explicit depth does not shred a string either', () => {
    expect(
      ce
        .box(['Flatten', ['List', ['List', str('ab')]], 2])
        .evaluate()
        .toString()
    ).toBe('["ab"]');
  });
});

describe('numeric aggregators over a string stay safe', () => {
  test('`Sum` of a string is a typed error, never a crash', () => {
    const e = ce.box(['Sum', str('abc')]).evaluate();
    expect(e.operator).toBe('Error');
    expect(e.toString()).toContain('incompatible-type');
  });

  test('`Max`/`GCD` over a string terminate', () => {
    // A character has no elements, so the recursive/fixpoint operand walks in
    // `Max` and `GCD` bottom out instead of descending forever.
    expect(() => ce.box(['Max', str('abc')]).evaluate()).not.toThrow();
    expect(() => ce.box(['GCD', str('abc')]).evaluate()).not.toThrow();
  });
});

describe('route parity: box, parse and ce.function agree', () => {
  test('`Length` over each route', () => {
    expect(ce.box(['Length', str('shop')]).evaluate().re).toBe(4);
    expect(ce.function('Length', [ce.string('shop')]).evaluate().re).toBe(4);
    expect(ce.parse('\\mathrm{Length}(\\text{shop})').evaluate().re).toBe(4);
  });

  test('`Characters` over each route', () => {
    const expected = '["a","b","c"]';
    expect(
      ce
        .box(['Characters', str('abc')])
        .evaluate()
        .toString()
    ).toBe(expected);
    expect(
      ce
        .function('Characters', [ce.string('abc')])
        .evaluate()
        .toString()
    ).toBe(expected);
  });
});

/**
 * A leading COMBINING ACUTE ACCENT (U+0301) followed by `a`. The mark has no
 * base character in front of it, so this is TWO grapheme clusters; move the
 * `a` in front of the mark and the pair composes (under NFC) to the single
 * precomposed `á` (U+00E1) — ONE cluster. That collapse is the re-segmentation
 * caveat every string-preserving operator carries: rejoining the characters it
 * selected can merge clusters, so the result may hold a different number of
 * characters than the input.
 */
const LONE_MARK_THEN_A = '́a';

describe('string-preserving operators', () => {
  // Every operator below returns a SUBSET or a REORDERING of the source's own
  // characters, so each declares a `(T, …) -> T where T: string` arm and must
  // deliver a `string` value for a string source (`docs/STRING_ROADMAP.md`,
  // "String preservation rule"). ASCII throughout — the Unicode-sensitive
  // cases are the re-segmentation tests at the end of the describe.
  const isA = ['Function', ['Equal', 'c', str('a')], 'c'];
  const notA = ['Function', ['NotEqual', 'c', str('a')], 'c'];
  const descending = ['Function', ['Greater', 'x', 'y'], 'x', 'y'];

  const cases: Array<[label: string, expr: any, expected: string]> = [
    ['Reverse', ['Reverse', str('abc')], 'cba'],
    ['Rest', ['Rest', str('abc')], 'bc'],
    ['Most', ['Most', str('abc')], 'ab'],
    ['Take', ['Take', str('abcdef'), 3], 'abc'],
    ['Drop', ['Drop', str('abcdef'), 4], 'ef'],
    ['Slice (start, end)', ['Slice', str('abcdef'), 2, 4], 'bcd'],
    ['Slice (range)', ['Slice', str('abcdef'), ['Range', 2, 4]], 'bcd'],
    ['Unique', ['Unique', str('banana')], 'ban'],
    ['Sort', ['Sort', str('banana')], 'aaabnn'],
    ['Sort (with order)', ['Sort', str('banana'), descending], 'nnbaaa'],
    ['RotateLeft', ['RotateLeft', str('abc'), 1], 'bca'],
    ['RotateRight', ['RotateRight', str('abc'), 1], 'cab'],
    ['Filter', ['Filter', str('banana'), notA], 'bnn'],
    ['TakeWhile', ['TakeWhile', str('aabba'), isA], 'aa'],
    ['DropWhile', ['DropWhile', str('aabba'), isA], 'bba'],
    ['Dedup', ['Dedup', str('aabbca')], 'abca'],
  ];

  for (const [label, expr, expected] of cases) {
    test(`\`${label}\` of a string is a string`, () => {
      const e = ce.box(expr);
      expect(e.type.toString()).toBe('string');
      const v = e.evaluate();
      expect(v.string).toBe(expected);
      // The VALUE is a string, not a lazy view over characters.
      expect(v.type.toString()).toBe('string');
    });
  }

  test('a LIST source keeps its Phase-0 list result', () => {
    // The string arm must not swallow the general arm: most-specific-wins
    // picks it only for a `string` operand.
    expect(ce.box(['Take', ['List', 1, 2, 3, 4], 2]).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(
      ce
        .box(['Take', ['List', 1, 2, 3, 4], 2])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(ce.box(['Reverse', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['Sort', ['List', 3, 1, 2]]).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(ce.box(['Unique', ['List', 1, 1, 2]]).type.toString()).toBe(
      'list<finite_integer>'
    );
  });

  test('an UNKNOWN-typed source does not get the string arm', () => {
    // An `unknown` operand refutes no arm, so a GROUND `string` parameter
    // would win most-specific-wins and claim `string` for a call that usually
    // returns a list. The arms are spelled `T where T: string` for exactly
    // that reason: a bounded variable with no call-site binding does not win.
    ce.declare('untypedSrc', 'unknown');
    expect(ce.box(['Reverse', 'untypedSrc']).type.toString()).toBe(
      'list<unknown>'
    );
    expect(ce.box(['Take', 'untypedSrc', 2]).type.toString()).toBe(
      'list<unknown>'
    );
  });

  test('a source typed by a transparent ALIAS of `string` still gets the string arm', () => {
    // `Filter` computes its result type in a handler rather than through a
    // `T where T: string` arm, and that handler used to compare the source's
    // type CONSTRUCTOR to `string`. An alias is a distinct constructor, so a
    // source declared `s` (with `type s = string`) fell through to
    // `list<character>`; `evaluateStringPreservingCollection` keys on the
    // declared result type being a string, so the value stayed a lazy view of
    // characters instead of being joined back into a string.
    ce.declareType('AliasedString', 'string', { alias: true });
    ce.declare('aliasedSrc', { type: 'AliasedString' });
    ce.assign('aliasedSrc', ce.string('banana'));
    const e = ce.box(['Filter', 'aliasedSrc', notA]);
    expect(e.type.matches('string')).toBe(true);
    const v = e.evaluate();
    expect(v.string).toBe('bnn');
    expect(v.type.toString()).toBe('string');
  });

  test('a string-typed SYMBOL gets the string arm on both type and value', () => {
    ce.assign('greeting', ce.string('hello'));
    ce.declare('shout', 'string');
    expect(ce.box(['Reverse', 'greeting']).evaluate().string).toBe('olleh');
    expect(ce.box(['Reverse', 'shout']).type.toString()).toBe('string');
  });

  test('RE-SEGMENTATION: reversing can MERGE two characters into one', () => {
    // `"́a"` is a lone COMBINING ACUTE ACCENT followed by `a`: two
    // clusters, because the mark has nothing in front of it to attach to.
    const src = ce.string(LONE_MARK_THEN_A);
    expect(src.count).toBe(2);
    const reversed = ce.box(['Reverse', str(LONE_MARK_THEN_A)]).evaluate();
    // Reversal puts `a` before the mark; `a` + U+0301 is one cluster, and NFC
    // composes it to the precomposed `á` (U+00E1). Two characters in, ONE out.
    expect(reversed.type.toString()).toBe('string');
    expect(reversed.string).toBe('á');
    expect(reversed.count).toBe(1);
  });

  test('RE-SEGMENTATION: the result is still a string, whatever its length', () => {
    // The contract is "string in, string out" — never "the same number of
    // characters out". `RotateLeft` merges here for the same reason `Reverse`
    // does above.
    const rotated = ce.box(['RotateLeft', str(LONE_MARK_THEN_A), 1]).evaluate();
    expect(rotated.type.toString()).toBe('string');
    expect(rotated.count).toBe(1);
    // Dropping the lone mark leaves a plain `a` — one cluster out of two,
    // without any composition.
    const dropped = ce.box(['Drop', str(LONE_MARK_THEN_A), 1]).evaluate();
    expect(dropped.string).toBe('a');
  });

  test('an EMPTY selection is the empty string, not an empty list', () => {
    expect(ce.box(['Take', str('abc'), 0]).evaluate().string).toBe('');
    expect(ce.box(['Rest', str('a')]).evaluate().string).toBe('');
    expect(
      ce
        .box([
          'Filter',
          str('bbb'),
          ['Function', ['Equal', 'c', str('a')], 'c'],
        ])
        .evaluate().string
    ).toBe('');
  });
});

describe('strings are atomic where the lattice would otherwise shred them', () => {
  test('`Max`/`Min`/`Supremum`/`Infimum` treat a string as one item', () => {
    // A string is an indexed collection of characters, but an extremum over a
    // string is the extremum OF THE STRING — the operand stays symbolic, as it
    // did before strings became collections. It must NOT become
    // `max("a", "b", "c")`.
    for (const op of ['Max', 'Min']) {
      const e = ce.box([op, str('abc')]).evaluate();
      expect(e.toString()).not.toContain('"a"');
      expect(e.toString()).toContain('"abc"');
    }
    expect(
      ce
        .box(['Supremum', str('abc')])
        .evaluate()
        .toString()
    ).toContain('"abc"');
    expect(
      ce
        .box(['Infimum', str('abc')])
        .evaluate()
        .toString()
    ).toContain('"abc"');
    // A genuine collection operand still folds.
    expect(ce.box(['Max', ['List', 1, 5, 3]]).evaluate().re).toBe(5);
  });

  test('`GCD`/`LCM` treat a string as one operand', () => {
    // `gcd(4, "abc")`, never `gcd(4, "a", "b", "c")`.
    for (const op of ['GCD', 'LCM']) {
      const e = ce.box([op, str('abc'), 4]).evaluate();
      expect(e.toString()).toContain('"abc"');
      expect(e.toString()).not.toContain('"a"');
    }
    // A list operand still contributes its elements.
    expect(ce.box(['GCD', ['List', 12, 18]]).evaluate().re).toBe(6);
  });

  test('`Transpose` of a string is the string itself', () => {
    // A string is a RANK-1 sequence, and transposing a rank-1 value is the
    // identity — it must not become a `List` of characters on the way.
    const e = ce.box(['Transpose', str('abc')]).evaluate();
    expect(e.string).toBe('abc');
  });

  test('`Reshape` of a string is inert', () => {
    // Reshaping text is not a defined operation: rebuild from `Characters(s)`
    // explicitly if a nested list of characters is what is wanted.
    const e = ce.box(['Reshape', str('abcdef'), ['Tuple', 2, 3]]).evaluate();
    expect(e.operator).toBe('Reshape');
  });

  test('`ConjugateTranspose` of a string is inert', () => {
    expect(ce.box(['ConjugateTranspose', str('abc')]).evaluate().operator).toBe(
      'ConjugateTranspose'
    );
  });

  test('`Shape`/`Rank`/`Dimension` describe a rank-1 sequence', () => {
    // A string is an indexed collection of `count` characters, so it reports
    // what a flat list of those characters reports — not the `()`/0 of a
    // scalar.
    expect(
      ce
        .box(['Shape', str('abc')])
        .evaluate()
        .toString()
    ).toBe('(3)');
    expect(ce.box(['Rank', str('abc')]).evaluate().re).toBe(1);
    expect(ce.box(['Dimension', str('abc')]).evaluate().re).toBe(3);
    expect(ce.string('abc').shape).toEqual([3]);
    expect(ce.string('abc').rank).toBe(1);
  });

  test('the matrix operators stay inert on a string', () => {
    // `isTensorValue` requires a `List` head, so the rank-1 shape above does
    // not make a string a tensor.
    for (const op of ['Determinant', 'Inverse']) {
      const e = ce.box([op, str('abc')]).evaluate();
      expect(e.operator).toBe('Error');
      expect(e.toString()).toContain('incompatible-type');
    }
  });

  test('`Quantile` of a string is inert, never a character', () => {
    // The handler is declared `-> number`; sorting by `.re` is a no-op on
    // non-numeric elements, and the boundary exits used to hand back the
    // element itself.
    const e = ce.box(['Quantile', str('abc'), 0.5]).evaluate();
    expect(e.operator).toBe('Quantile');
    // A numeric collection still answers.
    expect(ce.box(['Quantile', ['List', 1, 2, 3], 0.5]).evaluate().re).toBe(2);
  });

  test('`StringFrom` of a string is the same type error it always was', () => {
    // A string IS an indexed collection now, but of CHARACTERS, not of the
    // integer code units this format asks for — decoding it produced one
    // U+FFFD replacement character per character.
    const e = ce.box(['StringFrom', str('abc'), str('utf-8')]).evaluate();
    expect(e.operator).toBe('Error');
    expect(e.toString()).toContain('indexed_collection<integer>');
    expect(e.toString()).not.toContain('�');
    // A genuine list of code units still decodes.
    expect(
      ce.box(['StringFrom', ['List', 104, 105], str('utf-8')]).evaluate().string
    ).toBe('hi');
  });

  test('a trailing `SetMinus` string operand excludes ITSELF', () => {
    // Reading the string as a collection removed its CHARACTERS — neither of
    // which is a member — and left `"ab"` in place.
    expect(
      ce
        .box(['SetMinus', ['Set', str('ab'), str('cd')], str('ab')])
        .evaluate()
        .toString()
    ).toBe('Set("cd")');
  });

  test('`Union`/`Intersection` DO read a string as its characters', () => {
    // These take `(collection+)`, so a string operand is a collection of
    // characters there — the honest reading under the new lattice, and a
    // behavior change from Phase 0 (where the string was wrapped whole).
    const u = ce.box(['Union', ['Set', 1], str('ab')]).evaluate();
    expect(u.count).toBe(3);
    expect(u.contains(ce.character('a'))).toBe(true);
    expect(u.contains(ce.character('b'))).toBe(true);
    expect(u.contains(ce.number(1))).toBe(true);
    const i = ce.box(['Intersection', str('ab'), str('ab')]).evaluate();
    expect(i.count).toBe(2);
    expect(i.contains(ce.character('a'))).toBe(true);
  });

  test("`ListFrom`/`SetFrom`/`TupleFrom` list a string's characters", () => {
    // The honest reading under the new lattice, and consistent with the
    // spread spelling `[..."ab"]`. A behavior change from Phase 0, where a
    // string was pushed whole (`ListFrom("abc")` was `["abc"]`).
    expect(
      ce
        .box(['ListFrom', str('abc')])
        .evaluate()
        .toString()
    ).toBe('["a","b","c"]');
    expect(ce.box(['SetFrom', str('abc')]).evaluate().count).toBe(3);
    expect(
      ce
        .box(['TupleFrom', str('abc')])
        .evaluate()
        .toString()
    ).toBe('("a", "b", "c")');
  });

  test('the regression statistics stay inert on a string, never NaN', () => {
    // `extractPairs` had no numeric guard, so every character mapped to `NaN`
    // and the handlers answered with `NaN` coefficients.
    for (const expr of [
      ['Covariance', str('abc'), str('abc')],
      ['Correlation', str('abc'), str('abc')],
      ['LinearRegression', str('ab'), str('cd')],
      ['PolynomialFit', str('ab'), str('cd'), 1],
    ]) {
      const e = ce.box(expr as any).evaluate();
      expect(e.toString()).not.toContain('NaN');
    }
    // Numeric data still computes.
    expect(
      ce
        .box(['Covariance', ['List', 1, 2, 3], ['List', 4, 5, 7]])
        .evaluate()
        .toString()
    ).toBe('3/2');
  });

  test('`Differences` refuses a string source outright', () => {
    // Each element would be a SUBTRACTION of two characters, which is not
    // defined, so the call declines WHOLE with one typed error at the operand
    // instead of building a lazy view that manufactures an error per element.
    const d = ce.box(['Differences', str('abc')]);
    expect(d.isValid).toBe(false);
    expect(d.toString()).toContain('incompatible-type');
    // A source whose element type is merely unknown is left alone.
    ce.declare('xs', 'list<unknown>');
    expect(ce.box(['Differences', 'xs']).isValid).toBe(true);
    // A numeric source still gets the precise element type.
    expect(ce.box(['Differences', ['List', 1, 3, 6]]).type.toString()).toBe(
      'list<finite_integer>'
    );
  });

  test('`Subscript` on a string is a BASE conversion, never element access', () => {
    // The `canonical` handler reads a string base as a numeral in base `op2`;
    // the `type` handler now says the same thing, instead of reporting
    // `character` for a subscript that is not a usable base.
    expect(ce.box(['Subscript', str('101'), 2]).evaluate().re).toBe(5);
    expect(ce.box(['Subscript', str('101'), 2]).type.toString()).toBe(
      'finite_integer'
    );
    const bad = ce.box(['Subscript', str('101'), str('x')]);
    expect(bad.type.toString()).toBe('error');
  });

  test('`FlatMap` does not splice a string-returning callback', () => {
    expect(
      ce
        .box(['FlatMap', ['List', str('ab')], ['Function', 's', 's']])
        .evaluate()
        .toString()
    ).toBe('["ab"]');
  });

  test('a string never equals a collection of another kind', () => {
    expect(ce.string('ab').isEqual(ce.string('ab'))).toBe(true);
    const asList = ce.box(['List', str('a'), str('b')]);
    // `string` and `list<character>` are SIBLINGS in the lattice, so two
    // values of those kinds are different values however their characters
    // line up. Never `true`.
    expect(ce.string('ab').isEqual(asList)).not.toBe(true);
    expect(asList.isEqual(ce.string('ab'))).not.toBe(true);
    expect(ce.string('ab').isSame(asList)).toBe(false);
  });

  test('the Phase-2 candidates are correct AS LISTS on a string source', () => {
    // These keep their `list<…>` signatures for now (a promotion to a string
    // result is Phase 2). What matters here is that none of them crashes or
    // answers a wrong value on a string source.
    const asList = (expr: any) => ce.box(expr).evaluate().toString();
    expect(asList(['DeleteAt', str('abc'), 1])).toBe('["b","c"]');
    expect(asList(['Partition', str('abcd'), 2])).toBe('[["a","b"],["c","d"]]');
    expect(asList(['Chunk', str('abcd'), 2])).toBe('[["a","b"],["c","d"]]');
    expect(asList(['SlidingWindow', str('abcd'), 2])).toBe(
      '[["a","b"],["b","c"],["c","d"]]'
    );
    expect(asList(['Combinations', str('abc'), 2])).toBe(
      '[["a","b"],["a","c"],["b","c"]]'
    );
    expect(ce.box(['Permutations', str('abc')]).evaluate().count).toBe(6);
    expect(ce.box(['RandomShuffle', str('abc')]).evaluate().count).toBe(3);
    expect(ce.box(['RandomSample', str('abc'), 2]).evaluate().count).toBe(2);
    expect(ce.box(['RandomChoice', str('abc'), 2]).evaluate().count).toBe(2);
    expect(asList(['Tally', str('abc')])).toBe('(["a","b","c"], [1,1,1])');
    // `Cycle` declares a `list` parameter, so a string is a clean type error.
    expect(
      ce
        .box(['Cycle', str('abc')])
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });
});

describe('`String` of a single collection types as a string', () => {
  test('`String(Characters(s))` is a `string`, statically and by value', () => {
    // The single-collection JOIN carve-out: `String` is `broadcastable`, and
    // `Characters(s)` is an ordinary list, so without the carve-out the call
    // would map element-wise. The VALUE path already joined; the TYPE path
    // reported `list<character>` because an eager collection operator is not a
    // collection VALUE until it evaluates.
    const e = ce.box(['String', ['Characters', str('abc')]]);
    expect(e.type.toString()).toBe('string');
    expect(e.evaluate().string).toBe('abc');
  });

  test('a literal list argument agrees', () => {
    const e = ce.box(['String', ['List', str('a'), str('b')]]);
    expect(e.type.toString()).toBe('string');
    expect(e.evaluate().string).toBe('ab');
  });

  test('every route agrees on the type', () => {
    const expr = ['String', ['Characters', str('abc')]] as any;
    expect(ce.box(expr).type.toString()).toBe('string');
    expect(
      ce
        .function('String', [ce.function('Characters', [ce.string('abc')])])
        .type.toString()
    ).toBe('string');
    expect(
      ce
        .parse('\\mathrm{String}(\\mathrm{Characters}(\\text{abc}))')
        .type.toString()
    ).toBe('string');
  });

  test('a MULTI-argument `String` still broadcasts, and to `list<string>`', () => {
    const e = ce.box(['String', str('x'), ['List', 1, 2]]);
    expect(e.type.toString()).toBe('list<string^2>');
    expect(e.evaluate().toString()).toBe('["x1","x2"]');
  });
});
