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
    // String preservation (`docs/STRING_ROADMAP.md`): what is left after
    // removing one of a string's own
    // characters is a string.
    ['DeleteAt', ['DeleteAt', str('abcd'), 2], 'acd'],
    ['DeleteAt (negative index)', ['DeleteAt', str('abcd'), -1], 'abc'],
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

  test('the RANDOM promotions answer a string that is a permutation/subset of the source', () => {
    // `RandomShuffle` and `RandomSample` were promoted in Phase 2 alongside
    // `DeleteAt`: each result is a permutation (shuffle) or a subset (sample)
    // of the source's OWN characters, so each is string-preserving. Both are
    // impure, so the assertion is on the character MULTISET, never on a
    // particular ordering.
    const sorted = (s: string) => [...s].sort().join('');

    const shuffled = ce.box(['RandomShuffle', str('abcdef')]);
    expect(shuffled.type.toString()).toBe('string');
    const sv = shuffled.evaluate();
    expect(sv.type.toString()).toBe('string');
    expect(sorted(sv.string!)).toBe('abcdef');

    const sampled = ce.box(['RandomSample', str('abcdef'), 3]);
    expect(sampled.type.toString()).toBe('string');
    const pv = sampled.evaluate();
    expect(pv.type.toString()).toBe('string');
    expect(pv.string!).toHaveLength(3);
    // Drawn WITHOUT replacement, so the three characters are distinct and each
    // comes from the source.
    expect(new Set(pv.string!).size).toBe(3);
    for (const c of pv.string!) expect('abcdef').toContain(c);

    // An empty sample of a string is the empty STRING, not an empty list.
    const empty = ce.box(['RandomSample', str('abc'), 0]).evaluate();
    expect(empty.type.toString()).toBe('string');
    expect(empty.string).toBe('');
  });

  test('the promotions leave their LIST arms alone', () => {
    expect(ce.box(['DeleteAt', ['List', 1, 2, 3], 1]).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(
      ce
        .box(['DeleteAt', ['List', 1, 2, 3], 1])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
    expect(ce.box(['RandomShuffle', ['List', 1, 2, 3]]).type.toString()).toBe(
      'list<finite_integer>'
    );
    expect(ce.box(['RandomSample', ['List', 1, 2, 3], 2]).type.toString()).toBe(
      'list'
    );
  });

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

  test('`Tally` keeps CHARACTER values, and the non-preserving operators stay lists', () => {
    // `Tally` is the one operator of the Phase-1 candidate set that was NOT
    // promoted to string results (ruling D9(b), 2026-08-16): its first
    // component holds the source's distinct ELEMENTS, each paired with a
    // count, so a character is exactly the right value there — collapsing
    // them into one string would destroy the pairing.
    expect(
      ce
        .box(['Tally', str('banana')])
        .evaluate()
        .toString()
    ).toBe('(["b","a","n"], [1,3,2])');
    expect(ce.box(['Tally', str('banana')]).type.toString()).toBe(
      'tuple<list<character>, list<integer>>'
    );
    // `RandomChoice` draws WITH replacement, so its result is not a subset of
    // the source's own characters (`RandomChoice("ab", 3)` can repeat one) —
    // it is not an element-preserving operator and was not promoted.
    expect(ce.box(['RandomChoice', str('abc'), 2]).evaluate().count).toBe(2);
    // `Cycle` declares a `list` parameter, so a string is a clean type error.
    expect(
      ce
        .box(['Cycle', str('abc')])
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });
});

describe('chunking and combinatorics over a string yield INNER STRINGS', () => {
  // Ruling D9(b), 2026-08-16 (`docs/STRING_ROADMAP.md`,
  // D9): every one of these operators cuts its result elements out of the
  // SOURCE'S OWN characters, so over a string source each inner element is
  // itself a string — `Partition("abcdef", 2)` is `["ab","cd","ef"]`, not
  // `[["a","b"],…]`. Each operator declares a leading string arm returning
  // `list<string>`, and its handler emits inner runs through `innerRun`
  // (`src/compute-engine/library/collections.ts`).
  //
  // `Tally` was deliberately NOT promoted — see the test above.
  //
  // Every non-ASCII pin uses ZWJ_FAMILY (MAN + ZWJ + WOMAN + ZWJ + GIRL): five
  // code points, ONE grapheme cluster. The assumption under test is that the
  // cluster is never split across a chunk/window boundary, and that rejoining
  // clusters into an inner string leaves it intact.

  test('`Chunk` splits a string into `k` string groups', () => {
    const e = ce.box(['Chunk', str('abcdef'), 3]);
    expect(e.type.toString()).toBe('list<string>');
    expect(e.evaluate().toString()).toBe('["ab","cd","ef"]');
    // A list source is untouched by the new arm.
    expect(ce.box(['Chunk', ['List', 1, 2, 3, 4], 2]).type.toString()).toBe(
      'list<list>'
    );
    expect(
      ce
        .box(['Chunk', ['List', 1, 2, 3, 4], 2])
        .evaluate()
        .toString()
    ).toBe('[[1,2],[3,4]]');
    // The family emoji is one character, so it lands whole in the first group.
    expect(
      ce
        .box(['Chunk', str(`a${ZWJ_FAMILY}bc`), 2])
        .evaluate()
        .toString()
    ).toBe(`["a${ZWJ_FAMILY}","bc"]`);
  });

  test('`Partition` returns string chunks, string windows and string groups', () => {
    const chunks = ce.box(['Partition', str('abcd'), 2]);
    expect(chunks.type.toString()).toBe('list<string>');
    expect(chunks.evaluate().toString()).toBe('["ab","cd"]');
    // Sliding-window form (explicit step): complete windows only.
    expect(
      ce
        .box(['Partition', str('abcde'), 2, 2])
        .evaluate()
        .toString()
    ).toBe('["ab","cd"]');
    // Predicate form: the two groups are subsequences of the source's
    // characters, so each is a string too. The result keeps the generic arm's
    // list-of-two shape, now `list<string>`.
    const groups = ce.box([
      'Partition',
      str('abab'),
      ['Function', ['Equal', 'x', str('a')], 'x'],
    ]);
    expect(groups.type.toString()).toBe('list<string>');
    expect(groups.evaluate().toString()).toBe('["aa","bb"]');
    // A list source keeps its element type through the generic arm.
    expect(
      ce.box(['Partition', ['List', 1, 2, 3, 4], 2]).type.toString()
    ).toBe('list<list<finite_integer>>');
    // The family emoji is one character: it fills a chunk on its own.
    expect(
      ce
        .box(['Partition', str(`${ZWJ_FAMILY}ab`), 2])
        .evaluate()
        .toString()
    ).toBe(`["${ZWJ_FAMILY}a","b"]`);
  });

  test('`ChunkBy` returns the maximal runs as strings', () => {
    const e = ce.box(['ChunkBy', str('aabbc'), ['Function', 'x', 'x']]);
    expect(e.type.toString()).toBe('list<string>');
    expect(e.evaluate().toString()).toBe('["aa","bb","c"]');
    // A list source keeps `list<list<T>>`.
    expect(
      ce
        .box(['ChunkBy', ['List', 1, 1, 2], ['Function', 'x', 'x']])
        .type.toString()
    ).toBe('list<list<finite_integer>>');
    // Two consecutive family emoji are ONE run of two equal characters, and
    // the run rejoins to exactly those two clusters.
    expect(
      ce
        .box([
          'ChunkBy',
          str(`${ZWJ_FAMILY}${ZWJ_FAMILY}a`),
          ['Function', 'x', 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe(`["${ZWJ_FAMILY}${ZWJ_FAMILY}","a"]`);
  });

  test('`SlidingWindow` returns string windows', () => {
    const e = ce.box(['SlidingWindow', str('abcd'), 2]);
    expect(e.type.toString()).toBe('list<string>');
    expect(e.evaluate().toString()).toBe('["ab","bc","cd"]');
    expect(
      ce.box(['SlidingWindow', ['List', 1, 2, 3], 2]).type.toString()
    ).toBe('list<list>');
    // The family emoji is one character, so it appears whole in every window
    // that covers it.
    expect(
      ce
        .box(['SlidingWindow', str(`${ZWJ_FAMILY}ab`), 2])
        .evaluate()
        .toString()
    ).toBe(`["${ZWJ_FAMILY}a","ab"]`);
  });

  test('`Permutations` returns string arrangements', () => {
    const e = ce.box(['Permutations', str('ab')]);
    expect(e.type.toString()).toBe('list<string>');
    expect(e.evaluate().toString()).toBe('["ab","ba"]');
    // `Permutations(s, 0)` is the single EMPTY arrangement — the empty string
    // over a string source, `[]` over a list.
    expect(
      ce
        .box(['Permutations', str('abc'), 0])
        .evaluate()
        .toString()
    ).toBe('[""]');
    expect(ce.box(['Permutations', ['List', 1, 2]]).type.toString()).toBe(
      'list<list>'
    );
    // The family emoji is one character: it moves as a unit, never split.
    expect(
      ce
        .box(['Permutations', str(`${ZWJ_FAMILY}a`)])
        .evaluate()
        .toString()
    ).toBe(`["${ZWJ_FAMILY}a","a${ZWJ_FAMILY}"]`);
  });

  test('`Combinations` returns string subsets', () => {
    const e = ce.box(['Combinations', str('abc'), 2]);
    expect(e.type.toString()).toBe('list<string>');
    expect(e.evaluate().toString()).toBe('["ab","ac","bc"]');
    expect(ce.box(['Combinations', ['List', 1, 2, 3], 2]).type.toString()).toBe(
      'list<list>'
    );
    // The family emoji is one character, so it is one member of a combination.
    expect(
      ce
        .box(['Combinations', str(`${ZWJ_FAMILY}ab`), 2])
        .evaluate()
        .toString()
    ).toBe(`["${ZWJ_FAMILY}a","${ZWJ_FAMILY}b","ab"]`);
  });

  test('the LAZY view of a long string source also yields inner strings', () => {
    // Past `MAX_SIZE_EAGER_COLLECTION` (100 elements) the windowing operators
    // decline to materialize and serve their elements from the lazy
    // `collection` handlers instead. Those handlers must obey the same string
    // rule as the eager path, or the declared `list<string>` would be a lie
    // for exactly the long sources nobody tests by eye.
    const long = 'ab'.repeat(80); // 160 characters
    const chunks = ce.box(['Partition', str(long), 2]);
    expect(chunks.type.toString()).toBe('list<string>');
    expect(chunks.count).toBe(80);
    expect(chunks.at(1)?.type.toString()).toBe('string');
    expect(chunks.at(1)?.string).toBe('ab');
    expect([...chunks.each()].slice(0, 2).map((x) => x.string)).toEqual([
      'ab',
      'ab',
    ]);
    const windows = ce.box(['SlidingWindow', str(long), 3]);
    expect(windows.at(2)?.string).toBe('bab');
    const runs = ce.box(['ChunkBy', str(long), ['Function', 'x', 'x']]);
    expect(runs.at(1)?.string).toBe('a');
  });

  test('a NON-LITERAL string source yields inner strings on the LAZY route', () => {
    // The lazy `collection` handlers see the RAW operand, which for a
    // `string`-declared symbol or a string-valued application is not a
    // `BoxedString` node. A value-level `isString` test therefore failed there
    // and the very same operator emitted inner LISTS lazily where it emitted
    // inner STRINGS eagerly — and since the eager/lazy split is decided by the
    // source's LENGTH, the element kind depended on how long the string was.
    // `Permutations`/`Combinations` are lazy-ONLY, so for them there was no
    // eager route to fall back on at any length.
    ce.declare('s', 'string');
    ce.assign('s', ce.string('abcd'));

    expect(ce.box(['SlidingWindow', 's', 2]).at(1)?.string).toBe('ab');
    expect(
      [...ce.box(['SlidingWindow', 's', 2]).each()].map((x) => x.string)
    ).toEqual(['ab', 'bc', 'cd']);
    expect(ce.box(['Permutations', 's']).at(1)?.string).toBe('abcd');
    expect(ce.box(['Combinations', 's', 2]).at(1)?.string).toBe('ab');
    expect(ce.box(['ChunkBy', 's', ['Function', 'x', 'x']]).at(1)?.string).toBe(
      'a'
    );

    // A string-valued APPLICATION is the same case without a symbol involved.
    const joined = ['Join', str('ab'), str('cd')];
    expect(ce.box(['SlidingWindow', joined, 2]).at(1)?.string).toBe('ab');
    expect(
      ce.box(['Permutations', ['Join', str('a'), str('b')]]).at(1)?.string
    ).toBe('ab');

    // The declared TYPE must agree with what the handlers emit. `Partition`
    // reaches `list<string>` through a `type` handler rather than a leading
    // signature arm, so it needs its own pins for both non-literal sources.
    expect(ce.box(['Partition', 's', 2]).type.toString()).toBe('list<string>');
    expect(ce.box(['Partition', joined, 2]).type.toString()).toBe(
      'list<string>'
    );
    expect(ce.box(['Partition', 's', 2]).evaluate().toString()).toBe(
      '["ab","cd"]'
    );
  });

  test('degenerate sizes and empty sources keep the string shape', () => {
    // `k = 0`: the single EMPTY combination, which over a string source is the
    // empty STRING (matching `Permutations(s, 0)` above).
    expect(
      ce
        .box(['Combinations', str('abc'), 0])
        .evaluate()
        .toString()
    ).toBe('[""]');

    // A window/combination LARGER than the source produces nothing at all.
    // `SlidingWindow` has an eager path and returns the empty list; the
    // lazy-only `Combinations` stays symbolic under `evaluate()` and answers
    // with an empty WALK instead.
    expect(
      ce
        .box(['SlidingWindow', str('ab'), 5])
        .evaluate()
        .toString()
    ).toBe('[]');
    expect([...ce.box(['Combinations', str('ab'), 3]).each()]).toEqual([]);

    // An EMPTY string source: `Partition` has no chunks to cut, while `Chunk`
    // RESHAPES to exactly `k` groups whatever the length, so it answers `k`
    // empty strings rather than an empty list.
    expect(
      ce
        .box(['Partition', str(''), 2])
        .evaluate()
        .toString()
    ).toBe('[]');
    expect(
      ce
        .box(['Chunk', str(''), 3])
        .evaluate()
        .toString()
    ).toBe('["","",""]');
    // Same reshaping rule with a non-empty source too short for `k` groups:
    // the surplus groups are empty STRINGS, not empty lists.
    expect(
      ce
        .box(['Chunk', str('abc'), 5])
        .evaluate()
        .toString()
    ).toBe('["a","b","c","",""]');

    // `Chunk(xs, k)` is `k` GROUPS, not chunks of size `k` — the distinction
    // that `Partition` inverts.
    expect(
      ce
        .box(['Chunk', str('abcdef'), 2])
        .evaluate()
        .toString()
    ).toBe('["abc","def"]');

    // An explicit step skips characters between windows.
    expect(
      ce
        .box(['SlidingWindow', str('abcde'), 2, 2])
        .evaluate()
        .toString()
    ).toBe('["ab","cd"]');
  });
});

describe('`Join` is the variadic string concatenation', () => {
  // Strings Phase 2 (`docs/STRING_ROADMAP.md`, "`Join` vs. `StringJoin`"):
  // `Join` gained a string-preserving arm whose trigger is EVERY operand being
  // a string. There is no `evaluate` handler behind it — the declared result
  // type `string` is what makes the framework walk the lazy `Join` view once
  // and join its characters (`evaluateStringPreservingCollection` in
  // `boxed-expression/boxed-function.ts`).

  test('all-string operands concatenate to a `string`', () => {
    const e = ce.box(['Join', str('ab'), str('cd')]);
    expect(e.type.toString()).toBe('string');
    const v = e.evaluate();
    expect(v.type.toString()).toBe('string');
    expect(v.string).toBe('abcd');
  });

  test('the variadic and unary forms', () => {
    expect(
      ce.box(['Join', str('a'), str('b'), str('c'), str('d')]).evaluate().string
    ).toBe('abcd');
    // `Join(xs)` is the concatenation of ONE collection — i.e. `xs` itself.
    expect(ce.box(['Join', str('ab')]).evaluate().string).toBe('ab');
    expect(ce.box(['Join', str('')]).evaluate().string).toBe('');
    expect(ce.box(['Join', str('ab'), str('')]).evaluate().string).toBe('ab');
  });

  test('a MIXED call falls back to the generic arm and yields a list', () => {
    // A string and a `list<character>` are SIBLINGS under
    // `indexed_collection<character>`, so the call is well-typed — but the
    // result kind must stay readable from the operand kinds, with no
    // "majority wins" subtlety, so anything but all-strings is a list.
    const e = ce.box(['Join', str('ab'), ['Characters', str('cd')]]);
    expect(e.type.toString()).toBe('list<character>');
    expect(e.evaluate().toString()).toBe('["a","b","c","d"]');
    // A literal list of one-cluster strings types `list<string^2>` (a string
    // literal narrows to `character` only where a `character` is expected), so
    // this is a mixed call too.
    const f = ce.box(['Join', str('ab'), ['List', str('c'), str('d')]]);
    expect(f.type.matches('string')).toBe(false);
    expect(f.evaluate().toString()).toBe('["a","b","c","d"]');
  });

  test('a CHARACTER operand makes the call mixed', () => {
    // `character` is a SIBLING of `string` in the lattice, not a subtype, so
    // it does not satisfy the all-strings trigger.
    const c = ce.box(['At', ['Characters', str('cd')], 1]);
    expect(c.type.matches('string')).toBe(false);
    expect(
      ce.function('Join', [ce.string('ab'), c]).type.matches('string')
    ).toBe(false);
  });

  test('a non-string collection call is untouched', () => {
    expect(
      ce
        .box(['Join', ['List', 1, 2], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4]');
    // An `unknown`-typed operand refutes no arm; the bounded `T: string`
    // variable must not win most-specific-wins on it.
    ce.declare('joinSrc', 'unknown');
    expect(ce.box(['Join', 'joinSrc', 'joinSrc']).type.matches('string')).toBe(
      false
    );
  });

  test('RE-SEGMENTATION: joined characters can merge into one cluster', () => {
    // `Length(Join(a, b))` is not in general `Length(a) + Length(b)`: joining
    // "x" and a lone COMBINING ACUTE ACCENT (U+0301) makes ONE cluster,
    // because the mark attaches to the `x` that now precedes it. Inherent to
    // Unicode grapheme segmentation (design constraint 3), not a defect.
    const joined = ce.box(['Join', str('x'), str('́')]).evaluate();
    expect(joined.type.toString()).toBe('string');
    expect(joined.count).toBe(1);
    expect(ce.box(['Length', str('x')]).evaluate().re).toBe(1);
    expect(ce.box(['Length', str('́')]).evaluate().re).toBe(1);
  });

  test('an UNEVALUATED string-producing operand still materializes to a string', () => {
    // Regression: the result was a `Join` EXPRESSION that printed as `"ab"`
    // but was not a string value at all (`.string` was `undefined`). Two
    // defects stacked up, both now fixed in
    // `boxed-expression/boxed-function.ts`:
    //
    // 1. An eager producer that materializes to a `BoxedString` — which has no
    //    operator definition, so no `iterator` handler to read — enumerated
    //    NOTHING from `BoxedFunction.each()`, while still reporting a non-zero
    //    `count` from its `elementCount` handler. `Join("a", Sort("cb"))`
    //    therefore answered `"a"` instead of `"abc"`.
    // 2. The join step required a finite element COUNT, and an unevaluated
    //    eager producer cannot state one (its `elementCount` handler must be
    //    evaluation-free), so the enclosing `Join` had no count and the step
    //    declined. It now also accepts the proof that every operand is
    //    `string`-typed, since every string is finite.
    const cases: Array<[label: string, operand: any, expected: string]> = [
      [
        'StringJoin (eager, no count)',
        ['StringJoin', ['List', str('b')]],
        'ab',
      ],
      ['Sort (eager, count known)', ['Sort', str('cb')], 'abc'],
      ['Reverse (lazy)', ['Reverse', str('cb')], 'abc'],
      ['a literal string', str('b'), 'ab'],
    ];
    for (const [label, operand, expected] of cases) {
      const e = ce.box(['Join', str('a'), operand]);
      expect([label, e.type.toString()]).toEqual([label, 'string']);
      const v = e.evaluate();
      // A `BoxedString` VALUE, not an expression that merely prints like one.
      expect([label, v.string]).toEqual([label, expected]);
      expect([label, v.type.toString()]).toEqual([label, 'string']);
    }
    // The operand in leading position too.
    expect(
      ce.box(['Join', ['StringJoin', ['List', str('b')]], str('a')]).evaluate()
        .string
    ).toBe('ba');
  });

  test('an operand that will NEVER yield characters keeps the call unevaluated', () => {
    // The `string`-typed-operands proof requires POSITIVE evidence that each
    // operand can be walked. These two producers state nothing either way —
    // their enumerability is `undefined`, not `false` — yet both stay
    // unevaluated and yield nothing from `each()`. Admitting them on the
    // absence of a refusal silently DROPPED the operand: `Join("a",
    // StringJoin(xs))` answered `"a"`.
    ce.declare('unassignedStr', 'string');
    const overUnassigned = ce
      .box(['Join', str('a'), ['StringJoin', 'unassignedStr']])
      .evaluate();
    expect(overUnassigned.operator).toBe('Join');
    expect(overUnassigned.string).toBeUndefined();

    // Same for a `StringJoin` over an INFINITE source: its `evaluate` handler
    // refuses a non-finite collection, so the call never becomes a string.
    const overInfinite = ce
      .box([
        'Join',
        str('x'),
        [
          'StringJoin',
          [
            'Map',
            ['Function', str('y'), 'c'],
            ['Range', 1, { num: '+Infinity' }],
          ],
        ],
      ])
      .evaluate();
    expect(overInfinite.operator).toBe('Join');
    expect(overInfinite.string).toBeUndefined();

    // The walkable neighbours are unaffected.
    expect(
      ce.box(['Join', str('a'), ['StringJoin', ['List', str('b')]]]).evaluate()
        .string
    ).toBe('ab');
    expect(
      ce.box(['Join', str('a'), ['Sort', str('cb')]]).evaluate().string
    ).toBe('abc');
  });

  test('every route agrees', () => {
    expect(ce.box(['Join', str('ab'), str('cd')]).evaluate().string).toBe(
      'abcd'
    );
    expect(
      ce.function('Join', [ce.string('ab'), ce.string('cd')]).evaluate().string
    ).toBe('abcd');
    // `\text{xy}`, not `\text{cd}`: `cd` is the candela unit symbol, so
    // `\text{cd}` parses as that symbol rather than as a string literal — a
    // property of the LaTeX text handler, unrelated to `Join`.
    expect(
      ce.parse('\\operatorname{Join}(\\text{ab}, \\text{xy})').evaluate().string
    ).toBe('abxy');
    expect(executeEpsil(ce, 'Join("ab", "cd")').value.string).toBe('abcd');
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
