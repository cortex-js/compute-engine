/**
 * The SEQUENCE-SEARCH family — `RangeOf`, `ContainsSequence`, `StartsWith`,
 * `EndsWith` (Strings Phase 2, `docs/STRING_ROADMAP.md` — "Missing operations
 * (proposed)" → "Sequence-search operations";
 * `docs/plans/2026-08-16-string-phase2-join-search-ops.md` item 3).
 *
 * Substring search generalized to CONTIGUOUS-SUBSEQUENCE search over any
 * indexed collection. Two properties are what the whole design rests on:
 *
 * - the needle is ALWAYS read as a SEQUENCE of elements, never as one element
 *   (element search is `IndexOf`/`Contains`), so nested-list needles are
 *   unambiguous;
 * - matching is ELEMENT-WISE, which makes grapheme safety on strings
 *   STRUCTURAL rather than an extra rule: a comparison of whole characters
 *   cannot straddle a cluster boundary.
 *
 * Unicode assumptions are called out at each non-ASCII expectation. Grapheme
 * segmentation comes from the host's `Intl.Segmenter`, so the pins below are
 * against the Unicode version the CI Node ships (design constraint 11).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

const str = (s: string) => ({ str: s }) as const;

/** The evaluated `RangeOf` answer, rendered as `"first..last"` — or the
 * literal `'Nothing'` for an absent needle, or `'Error'`/the unevaluated form
 * for the other channels. Reading the span through `at()` rather than
 * `toString()` keeps a one-element span (`Range(2, 2)`, which serializes as
 * `[2]`) readable next to a wider one. */
function span(expr: any): string {
  const v = ce.box(expr).evaluate();
  if (v.symbol === 'Nothing') return 'Nothing';
  if (v.operator === 'Error') return `Error:${v.toString()}`;
  if (v.operator === 'RangeOf') return `symbolic:${v.toString()}`;
  const n = v.count;
  if (n === undefined) return `?${v.toString()}`;
  return `${v.at(1)?.re}..${v.at(n)?.re}`;
}

/** `True` / `False` / `symbolic` for the three boolean members. */
function truth(expr: any): string {
  const v = ce.box(expr).evaluate();
  if (v.symbol === 'True') return 'True';
  if (v.symbol === 'False') return 'False';
  if (v.operator === 'Error') return `Error:${v.toString()}`;
  return `symbolic:${v.toString()}`;
}

const INFINITE_RANGE = ['Range', 1, { num: '+Infinity' }] as any;

describe('RangeOf — the span of the first occurrence', () => {
  test('a LIST subject', () => {
    expect(span(['RangeOf', ['List', 9, 7, 5, 3], ['List', 7, 5]])).toBe(
      '2..3'
    );
    expect(span(['RangeOf', ['List', 9, 7, 5, 3], ['List', 9]])).toBe('1..1');
    expect(span(['RangeOf', ['List', 9, 7, 5, 3], ['List', 3]])).toBe('4..4');
    // Absent → `Nothing`, NOT `IndexOf`'s `0`: zero is an index sentinel and
    // is not a range.
    expect(span(['RangeOf', ['List', 9, 7, 5, 3], ['List', 7, 3]])).toBe(
      'Nothing'
    );
    // A needle longer than the subject can never fit.
    expect(span(['RangeOf', ['List', 1, 2], ['List', 1, 2, 3]])).toBe(
      'Nothing'
    );
  });

  test('the needle is a SEQUENCE, never one element', () => {
    // The ambiguity `IndexOf` cannot resolve for a nested list: here `[3,4]`
    // is unambiguously "3 then 4", because the needle slot is a sequence.
    expect(span(['RangeOf', ['List', 1, 2, 3, 4], ['List', 3, 4]])).toBe(
      '3..4'
    );
    // The elements of this subject are themselves lists, so the SEQUENCE
    // `[[3,4]]` — a one-element sequence whose element is `[3,4]` — matches
    // position 2, while the flat sequence `[3,4]` does not occur at all.
    const nested = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(span(['RangeOf', nested, ['List', ['List', 3, 4]]])).toBe('2..2');
    expect(span(['RangeOf', nested, ['List', 3, 4]])).toBe('Nothing');
    // A SCALAR needle is a type error, not "search for this one element": to
    // search for one element use `IndexOf`, to search for a one-element
    // sequence wrap it.
    expect(ce.box(['RangeOf', ['List', 1, 2, 3], 2]).type.toString()).toBe(
      'error'
    );
    expect(ce.box(['StartsWith', ['List', 1, 2, 3], 1]).type.toString()).toBe(
      'error'
    );
    expect(span(['RangeOf', ['List', 1, 2, 3], ['List', 2]])).toBe('2..2');
  });

  test('a RANGE subject', () => {
    expect(span(['RangeOf', ['Range', 1, 10], ['List', 3, 4]])).toBe('3..4');
    expect(span(['RangeOf', ['Range', 2, 10, 2], ['List', 6, 8]])).toBe('3..4');
    expect(span(['RangeOf', ['Range', 1, 10], ['List', 4, 3]])).toBe('Nothing');
  });

  test('a TUPLE subject', () => {
    expect(span(['RangeOf', ['Tuple', 1, 2, 3], ['Tuple', 2, 3]])).toBe('2..3');
  });

  test('a STRING subject, in CHARACTER indices', () => {
    expect(span(['RangeOf', str('abcab'), str('ab')])).toBe('1..2');
    expect(span(['RangeOf', str('abcab'), str('c')])).toBe('3..3');
    expect(span(['RangeOf', str('abcab'), str('ca')])).toBe('3..4');
    // "ba" never occurs in "abcab" (a-b-c-a-b), even though both characters do.
    expect(span(['RangeOf', str('abcab'), str('ba')])).toBe('Nothing');
    expect(span(['RangeOf', str('abcab'), str('zz')])).toBe('Nothing');
    // A `list<character>` needle against a string subject is well-typed: the
    // two are siblings under `indexed_collection<character>`, and matching is
    // element-wise.
    expect(span(['RangeOf', str('abcab'), ['Characters', str('ca')]])).toBe(
      '3..4'
    );
  });

  test('a LAZY finite view is searched, not declined', () => {
    // The finiteness gate asks for `isFiniteCollection === true`, not for a
    // literal collection, so a lazy view over a finite source qualifies and
    // is walked once. `Filter(1..10, even)` is [2, 4, 6, 8, 10].
    const even = ['Function', ['Equal', ['Mod', 'n', 2], 0], 'n'];
    const evens = ['Filter', ['Range', 1, 10], even];
    expect(span(['RangeOf', evens, ['List', 6, 8]])).toBe('3..4');
    expect(truth(['StartsWith', evens, ['List', 2, 4]])).toBe('True');
    expect(truth(['EndsWith', evens, ['List', 8, 10]])).toBe('True');
    expect(truth(['ContainsSequence', evens, ['List', 4, 8]])).toBe('False');
  });

  test('the result is typed `range`, and the operator `range | nothing`', () => {
    // The span is built as `Range(first, last)` with integer literals, which
    // is what makes it type as `range` (ascending, step 1, bounds ≥ 1).
    const e = ce.box(['RangeOf', str('abcab'), str('ab')]);
    expect(e.type.toString()).toBe('nothing | range');
    expect(e.evaluate().type.toString()).toBe('range');
  });
});

describe('RangeOf — the `from` parameter', () => {
  test('the find-all loop terminates with `Nothing`', () => {
    // The returned span is always in the ORIGINAL subject's indices, so
    // find-next is `RangeOf(xs, needle, Last(r) + 1)` for non-overlapping
    // matches. Run to exhaustion here, exactly as a caller's loop would.
    const subject = str('abcabcab');
    const found: string[] = [];
    let from = 1;
    for (let guard = 0; guard < 10; guard++) {
      const r = ce.box(['RangeOf', subject, str('ab'), from]).evaluate();
      if (r.symbol === 'Nothing') break;
      const first = r.at(1)!.re;
      const last = r.at(r.count!)!.re;
      found.push(`${first}..${last}`);
      from = last + 1;
    }
    expect(found).toEqual(['1..2', '4..5', '7..8']);
    // The loop's last `from` is `Length(xs) + 1`, which must be `Nothing`
    // rather than an error — that is exactly why "past the end" is not a
    // domain violation.
    expect(from).toBe(9);
    expect(span(['RangeOf', subject, str('ab'), from])).toBe('Nothing');
  });

  test('overlapping matches are reachable with `First(r) + 1`', () => {
    expect(span(['RangeOf', str('aaaa'), str('aa')])).toBe('1..2');
    expect(span(['RangeOf', str('aaaa'), str('aa'), 2])).toBe('2..3');
    expect(span(['RangeOf', str('aaaa'), str('aa'), 3])).toBe('3..4');
    expect(span(['RangeOf', str('aaaa'), str('aa'), 4])).toBe('Nothing');
  });

  test('`from` past the end is `Nothing`, never an error', () => {
    expect(span(['RangeOf', str('abc'), str('a'), 4])).toBe('Nothing');
    expect(span(['RangeOf', str('abc'), str('a'), 99])).toBe('Nothing');
    expect(span(['RangeOf', ['List', 1, 2], ['List', 1], 3])).toBe('Nothing');
  });

  test('`from` below 1 is an ERROR value', () => {
    expect(span(['RangeOf', str('abc'), str('a'), 0])).toContain(
      'out-of-range'
    );
    expect(span(['RangeOf', str('abc'), str('a'), -2])).toContain(
      'out-of-range'
    );
  });

  test('a FRACTIONAL `from` is an error value, rejected by the parameter type', () => {
    // The slot is typed `integer`, so canonicalization refuses a fractional
    // literal outright — the handler never sees it.
    const e = ce.box(['RangeOf', str('abc'), str('a'), 1.5]);
    expect(e.type.toString()).toBe('error');
    expect(e.evaluate().toString()).toContain('incompatible-type');
  });

  test('a SYMBOLIC `from` leaves the expression unevaluated', () => {
    // Indeterminate, never the default: substituting 1 would answer a span
    // for a search the caller did not ask for.
    ce.declare('k', 'integer');
    expect(span(['RangeOf', str('abc'), str('a'), 'k'])).toContain('symbolic:');
  });
});

describe('the family: empty needles, per operator', () => {
  test('`RangeOf` REJECTS an empty needle', () => {
    // An empty span is not representable: `Range(1, 0)` is the DESCENDING
    // range [1, 0], not an empty one. So `RangeOf` is the one member whose
    // empty-needle rule is an error rather than an answer.
    expect(span(['RangeOf', str('abc'), str('')])).toContain('out-of-range');
    expect(span(['RangeOf', ['List', 1, 2], ['List']])).toContain(
      'out-of-range'
    );
    // Even over an EMPTY subject: the rejection is about the needle alone.
    expect(span(['RangeOf', str(''), str('')])).toContain('out-of-range');
    // A non-empty needle over an empty subject is simply absent.
    expect(span(['RangeOf', str(''), str('a')])).toBe('Nothing');
    expect(truth(['ContainsSequence', str(''), str('a')])).toBe('False');
  });

  test('the BOOLEAN members answer `True`', () => {
    // The empty sequence is a subsequence — and a prefix, and a suffix — of
    // everything. A boolean needs no span, so the problem that forces
    // `RangeOf` to reject does not arise.
    expect(truth(['ContainsSequence', str('abc'), str('')])).toBe('True');
    expect(truth(['StartsWith', str('abc'), str('')])).toBe('True');
    expect(truth(['EndsWith', str('abc'), str('')])).toBe('True');
    expect(truth(['ContainsSequence', ['List', 1], ['List']])).toBe('True');
    expect(truth(['StartsWith', ['List', 1], ['List']])).toBe('True');
    expect(truth(['EndsWith', ['List', 1], ['List']])).toBe('True');
    // Including on an EMPTY subject.
    expect(truth(['ContainsSequence', str(''), str('')])).toBe('True');
    expect(truth(['StartsWith', str(''), str('')])).toBe('True');
    expect(truth(['EndsWith', str(''), str('')])).toBe('True');
  });
});

describe('ContainsSequence', () => {
  test('list, range and string subjects', () => {
    expect(truth(['ContainsSequence', ['List', 9, 7, 5], ['List', 7, 5]])).toBe(
      'True'
    );
    expect(truth(['ContainsSequence', ['List', 9, 7, 5], ['List', 9, 5]])).toBe(
      'False'
    );
    expect(truth(['ContainsSequence', ['Range', 1, 10], ['List', 4, 5]])).toBe(
      'True'
    );
    expect(truth(['ContainsSequence', str('abcab'), str('bca')])).toBe('True');
    expect(truth(['ContainsSequence', str('abcab'), str('bb')])).toBe('False');
  });

  test('distinct from `Contains`, which is ELEMENT membership', () => {
    // Design constraint 7: `"ab"` is not an element of `"abc"` (no character
    // spans two clusters), but it IS a contiguous subsequence.
    expect(truth(['ContainsSequence', str('abc'), str('ab')])).toBe('True');
    expect(truth(['Contains', str('abc'), str('ab')])).toBe('False');
    // A one-character needle agrees with element membership.
    expect(truth(['ContainsSequence', str('abc'), str('b')])).toBe('True');
    expect(truth(['Contains', str('abc'), str('b')])).toBe('True');
  });

  test('agrees with `RangeOf` for a non-empty needle', () => {
    for (const needle of ['ab', 'bc', 'zz', 'abcd', 'c']) {
      const absent = span(['RangeOf', str('abc'), str(needle)]) === 'Nothing';
      expect(truth(['ContainsSequence', str('abc'), str(needle)])).toBe(
        absent ? 'False' : 'True'
      );
    }
  });
});

describe('StartsWith / EndsWith', () => {
  test('list, range and string subjects', () => {
    expect(truth(['StartsWith', ['List', 9, 7, 5], ['List', 9, 7]])).toBe(
      'True'
    );
    expect(truth(['StartsWith', ['List', 9, 7, 5], ['List', 7]])).toBe('False');
    expect(truth(['EndsWith', ['List', 9, 7, 5], ['List', 7, 5]])).toBe('True');
    expect(truth(['EndsWith', ['List', 9, 7, 5], ['List', 9]])).toBe('False');

    expect(truth(['StartsWith', ['Range', 1, 10], ['List', 1, 2]])).toBe(
      'True'
    );
    expect(truth(['EndsWith', ['Range', 1, 10], ['List', 9, 10]])).toBe('True');
    expect(truth(['EndsWith', ['Range', 1, 10], ['List', 9, 11]])).toBe(
      'False'
    );

    expect(truth(['StartsWith', str('abcab'), str('abc')])).toBe('True');
    expect(truth(['StartsWith', str('abcab'), str('bc')])).toBe('False');
    expect(truth(['EndsWith', str('abcab'), str('cab')])).toBe('True');
    expect(truth(['EndsWith', str('abcab'), str('ca')])).toBe('False');
  });

  test('a needle longer than the subject is `False`', () => {
    expect(truth(['StartsWith', str('ab'), str('abc')])).toBe('False');
    expect(truth(['EndsWith', str('ab'), str('abc')])).toBe('False');
  });

  test('the whole subject is both a prefix and a suffix of itself', () => {
    expect(truth(['StartsWith', str('abc'), str('abc')])).toBe('True');
    expect(truth(['EndsWith', str('abc'), str('abc')])).toBe('True');
  });

  test('`EndsWith` on an UNKNOWN-LENGTH source stays symbolic', () => {
    // `EndsWith` must inspect the tail, so it needs a length. A declared but
    // unassigned collection has no known finiteness at all, so every member of
    // the family declines on it — the house pattern (`Sort`, `StringJoin`)
    // rather than a guess.
    ce.declare('unknownLen', 'list<number>');
    expect(truth(['EndsWith', 'unknownLen', ['List', 1]])).toContain(
      'symbolic:'
    );
    expect(truth(['StartsWith', 'unknownLen', ['List', 1]])).toContain(
      'symbolic:'
    );
    expect(truth(['ContainsSequence', 'unknownLen', ['List', 1]])).toContain(
      'symbolic:'
    );
    expect(span(['RangeOf', 'unknownLen', ['List', 1]])).toContain('symbolic:');
  });
});

describe('finiteness: a non-finite subject or needle stays SYMBOLIC', () => {
  test('an infinite subject `1..oo`', () => {
    // Searching an infinite subject for an absent needle would not terminate,
    // so the expression stays unevaluated rather than searching forever.
    expect(span(['RangeOf', INFINITE_RANGE, ['List', 3, 4]])).toContain(
      'symbolic:'
    );
    expect(
      truth(['ContainsSequence', INFINITE_RANGE, ['List', 3, 4]])
    ).toContain('symbolic:');
    expect(truth(['StartsWith', INFINITE_RANGE, ['List', 1, 2]])).toContain(
      'symbolic:'
    );
    expect(truth(['EndsWith', INFINITE_RANGE, ['List', 1, 2]])).toContain(
      'symbolic:'
    );
  });

  test('an infinite NEEDLE', () => {
    expect(span(['RangeOf', ['List', 1, 2, 3], INFINITE_RANGE])).toContain(
      'symbolic:'
    );
    expect(
      truth(['ContainsSequence', ['List', 1, 2, 3], INFINITE_RANGE])
    ).toContain('symbolic:');
  });

  test('a domain violation does not override the symbolic rule', () => {
    // An out-of-domain `from` over a subject that cannot be searched leaves
    // the expression unevaluated: the finiteness gate runs first, so the
    // error surfaces once the subject is known, not before.
    expect(span(['RangeOf', INFINITE_RANGE, ['List', 1], 0])).toContain(
      'symbolic:'
    );
  });
});

describe('GRAPHEME SAFETY — the three pins from the spec', () => {
  // Written with explicit escapes so the source is unambiguous about which
  // code points are involved. Each expectation states the Unicode behavior it
  // assumes.

  test('`RangeOf("x\\u0301y", "x")` is `Nothing`', () => {
    // NFC has NO precomposed form of `x` + COMBINING ACUTE ACCENT, so the
    // cluster stays decomposed. A code-unit search would find the `x` — but
    // the subject's CHARACTERS are [x́, y], and `x ≠ x́`.
    const subject = str('x́y');
    expect(ce.box(['Length', subject]).evaluate().re).toBe(2);
    expect(span(['RangeOf', subject, str('x')])).toBe('Nothing');
    expect(truth(['ContainsSequence', subject, str('x')])).toBe('False');
    expect(truth(['StartsWith', subject, str('x')])).toBe('False');
    // The whole first cluster does match.
    expect(span(['RangeOf', subject, str('x́')])).toBe('1..1');
    expect(span(['RangeOf', subject, str('y')])).toBe('2..2');
  });

  test('`RangeOf("\\u{1F468}\\u200D\\u{1F469}\\u200D\\u{1F467}", "\\u{1F469}")` is `Nothing`', () => {
    // MAN + ZWJ + WOMAN + ZWJ + GIRL is ONE grapheme cluster. The woman
    // emoji's code units occur inside it, but the subject has exactly one
    // CHARACTER and it is not `\u{1F469}`.
    const family = str('\u{1F468}‍\u{1F469}‍\u{1F467}');
    expect(ce.box(['Length', family]).evaluate().re).toBe(1);
    expect(span(['RangeOf', family, str('\u{1F469}')])).toBe('Nothing');
    expect(truth(['ContainsSequence', family, str('\u{1F469}')])).toBe('False');
    // Nor does the MAN that begins it: a prefix cannot end mid-cluster.
    expect(truth(['StartsWith', family, str('\u{1F468}')])).toBe('False');
    expect(truth(['EndsWith', family, str('\u{1F467}')])).toBe('False');
    // The whole cluster matches itself.
    expect(span(['RangeOf', family, family])).toBe('1..1');
  });

  test('`RangeOf("e\\u0301e", "e")` is `2..2` — the FINAL `e`', () => {
    // `e` + COMBINING ACUTE ACCENT normalizes to the precomposed `é`
    // (U+00E9), so the subject's characters are [é, e]. The LEADING `e` is
    // inside the `é` cluster and is not a character of its own; the match is
    // the final `e`, at index 2.
    const subject = str('ée');
    expect(ce.box(['Length', subject]).evaluate().re).toBe(2);
    expect(span(['RangeOf', subject, str('e')])).toBe('2..2');
    expect(truth(['StartsWith', subject, str('e')])).toBe('False');
    expect(truth(['EndsWith', subject, str('e')])).toBe('True');
    // The precomposed and decomposed spellings of the needle agree, because
    // `ce.string` NFC-normalizes both.
    expect(span(['RangeOf', subject, str('é')])).toBe('1..1');
    expect(span(['RangeOf', subject, str('é')])).toBe('1..1');
  });
});

describe('the defining law: `Slice(xs, RangeOf(xs, needle))`', () => {
  test('SAME KIND — the stronger `==` holds', () => {
    // A string subject searched with a string needle: `Slice` is
    // kind-preserving, so both sides are strings and compare equal.
    const r = ce.box(['RangeOf', str('abcdef'), str('cd')]).evaluate();
    const sliced = ce.function('Slice', [ce.string('abcdef'), r]).evaluate();
    expect(sliced.type.toString()).toBe('string');
    expect(sliced.isEqual(ce.string('cd'))).toBe(true);

    // And for a list subject.
    const rl = ce
      .box(['RangeOf', ['List', 9, 7, 5, 3], ['List', 7, 5]])
      .evaluate();
    const slicedL = ce
      .function('Slice', [ce.box(['List', 9, 7, 5, 3]), rl])
      .evaluate();
    expect(slicedL.isEqual(ce.box(['List', 7, 5]))).toBe(true);
  });

  test('CROSS KIND — the law holds ELEMENT-WISE, never as `==`', () => {
    // The needle is a `list<character>` and the subject a `string`. `Slice` is
    // kind-preserving, so the slice is a STRING: the two sides are siblings in
    // the lattice (design constraint 2) and are never `==`, yet their element
    // sequences are identical. That is exactly why the spec states the law
    // element-wise.
    const needle = ce.box(['Characters', str('cd')]).evaluate();
    // The evaluated value pins its length too (`list<character^2>`), so match
    // against the open kind rather than a literal spelling.
    expect(needle.type.matches('list<character>')).toBe(true);
    const r = ce.box(['RangeOf', str('abcdef'), ['Characters', str('cd')]]);
    expect(span(['RangeOf', str('abcdef'), ['Characters', str('cd')]])).toBe(
      '3..4'
    );
    const sliced = ce
      .function('Slice', [ce.string('abcdef'), r.evaluate()])
      .evaluate();
    expect(sliced.type.toString()).toBe('string');
    // Element-wise: same characters, in the same order.
    const left = [...sliced.each()].map((c) => c.string);
    const right = [...needle.each()].map((c) => c.string);
    expect(left).toEqual(right);
    // But NOT `==`: a string never equals a collection of another kind.
    expect(sliced.isEqual(needle)).not.toBe(true);
  });

  test('the two NEST directly — no narrowing step', () => {
    // `RangeOf` is honestly typed `range | nothing`, and `Slice` gained a
    // matching `span: range | nothing` arm (USER-RULED 2026-08-16), so the
    // law's literal spelling type-checks and evaluates. Both subject kinds.
    const found = ce.box([
      'Slice',
      str('abcd'),
      ['RangeOf', str('abcd'), str('bc')],
    ]);
    // Possibly-absent span ⇒ possibly-absent result, and the type says so
    // (`sliceResultType`). The element sequence is the needle's either way.
    expect(found.type.toString()).toBe('nothing | string');
    expect([...found.each()].map((c) => c.string).join('')).toBe('bc');
    // Evaluating the node yields a string VALUE, not just a lazy `Slice` that
    // prints as one. The string-preservation step
    // (`evaluateStringPreservingCollection` in
    // `boxed-expression/boxed-function.ts`) requires the node's type to MATCH
    // `string`, which `nothing | string` does not — so it declines on the node
    // as authored and is re-run on the RESULT, whose span has resolved to
    // `2..3` and which therefore types exactly `string`
    // (`evaluateStringPreservingResult`, same file).
    const evaluated = found.evaluate();
    expect(evaluated.toString()).toBe('"bc"');
    expect(evaluated.type.toString()).toBe('string');
    expect(evaluated.string).toBe('bc');

    const foundList = ce.box([
      'Slice',
      ['List', 9, 7, 5, 3],
      ['RangeOf', ['List', 9, 7, 5, 3], ['List', 7, 5]],
    ]);
    expect(foundList.evaluate().toString()).toBe('[7,5]');

    // Binding to a variable first still works, and narrows to `range`.
    expect(
      executeEpsil(ce, 'let r = RangeOf("abcd", "bc")\nSlice("abcd", r)').value
        .string
    ).toBe('bc');
    // And nesting them directly in Epsil — where the span keeps its
    // `range | nothing` type — gives the same string value.
    expect(
      executeEpsil(ce, 'Slice("abcd", RangeOf("abcd", "bc"))').value.string
    ).toBe('bc');
    // An absent span still propagates on that route: `Nothing`, never a
    // fabricated empty string.
    expect(
      executeEpsil(ce, 'Slice("abcd", RangeOf("abcd", "zz"))').value.symbol
    ).toBe('Nothing');
  });

  test('ABSENCE PROPAGATES: an unfound needle slices to `Nothing`', () => {
    // `Slice(xs, Nothing)` is `Nothing`, so a failed search flows straight
    // through the composition rather than erroring or — the hazard the
    // `spanBounds` guard exists for — silently answering the WHOLE
    // collection by falling back to the positional `(start, end)` arm.
    expect(
      ce
        .box(['Slice', str('abcd'), ['RangeOf', str('abcd'), str('zz')]])
        .evaluate().symbol
    ).toBe('Nothing');
    expect(
      ce
        .box([
          'Slice',
          ['List', 9, 7, 5, 3],
          ['RangeOf', ['List', 9, 7, 5, 3], ['List', 1, 2]],
        ])
        .evaluate().symbol
    ).toBe('Nothing');
    // A literal `Nothing` span folds at canonicalization — it must not be
    // read as an OMITTED argument, which is what a bare `Nothing` operand
    // means everywhere else in the engine (`flatten` drops it).
    expect(ce.box(['Slice', str('abcd'), 'Nothing']).type.toString()).toBe(
      'nothing'
    );
    expect(
      ce.box(['Slice', ['List', 1, 2, 3], 'Nothing']).evaluate().symbol
    ).toBe('Nothing');
  });

  test('a span that is KNOWN to exist keeps its precise type', () => {
    // The exact `span: range` arms still win for an operand that refutes
    // `nothing`, which is what keeps `Slice` string-preserving: the
    // string-preservation step requires the node's type to MATCH `string`,
    // and a `string | nothing` result would stop it firing.
    expect(
      ce.box(['Slice', str('abcdef'), ['Range', 2, 4]]).type.toString()
    ).toBe('string');
    expect(
      ce.box(['Slice', str('abcdef'), ['Range', 2, 4]]).evaluate().string
    ).toBe('bcd');
    expect(
      ce.box(['Slice', ['List', 1, 2, 3, 4], ['Range', 2, 3]]).type.toString()
    ).toBe('list<finite_integer>');
    expect(ce.box(['Slice', str('abcdef'), 2, 4]).type.toString()).toBe(
      'string'
    );

    // The complement of the pin above: a POSSIBLY-absent span makes the
    // result possibly-`Nothing`, and the type says so. The overload resolver
    // does not produce this on its own — it admits the overlapping
    // `range | nothing` operand on trial and prefers the more specific
    // `span: range` arm, so it reported the bare `string` for a call that
    // evaluates to `Nothing`. `Slice`'s `type` handler (`sliceResultType` in
    // `src/compute-engine/library/collections.ts`) adds the `| nothing` arm
    // exactly when the span operand's static type admits `Nothing`, and
    // declines otherwise — which is what leaves the exact pins above intact.
    const maybe = ce.box([
      'Slice',
      str('abcd'),
      ['RangeOf', str('abcd'), str('zz')],
    ]);
    expect(maybe.type.toString()).toBe('nothing | string');
    expect(maybe.evaluate().symbol).toBe('Nothing');

    // Same for a list subject: the element type is carried through, and the
    // `| nothing` arm is added on top of it.
    expect(
      ce
        .box([
          'Slice',
          ['List', 9, 7, 5, 3],
          ['RangeOf', ['List', 9, 7, 5, 3], ['List', 1, 2]],
        ])
        .type.toString()
    ).toBe('list<finite_integer> | nothing');
  });

  test('the span is resolved ONCE per node, not once per element read', () => {
    // `Slice`'s `at()`/`iterator` resolve the window through `sliceBounds`,
    // which EVALUATES an unevaluated span operand. Without a per-node cache
    // that evaluation re-ran on every element access — for
    // `Slice(xs, RangeOf(xs, needle))` a full subsequence search per element,
    // quadratic in the slice length. A counting stand-in for `RangeOf` (same
    // declared type, so it takes the same path) makes the re-runs visible.
    let calls = 0;
    ce.declare('CountingSpan', {
      signature: '() -> range | nothing',
      evaluate: () => {
        calls += 1;
        return ce.box(['Range', 2, 5]);
      },
    });
    const view = ce.box([
      'Slice',
      ['List', 10, 20, 30, 40, 50, 60, 70, 80],
      ['CountingSpan'],
    ]);
    expect(view.count).toBe(4);
    const before = calls;
    // Four element reads plus a full iteration: none of them may re-resolve
    // the span. (Before the cache this reached 5 after the `at()` loop alone.)
    const read = [1, 2, 3, 4].map((i) => view.at(i)?.re);
    expect(read).toEqual([20, 30, 40, 50]);
    expect([...view.each()].map((x) => x.re)).toEqual([20, 30, 40, 50]);
    expect(calls).toBe(before);

    // And the lazy view agrees with the eager answer for the real operator:
    // iterating `Slice(xs, RangeOf(xs, needle))` yields the needle's
    // characters, in order.
    const sliced = ce.box([
      'Slice',
      str('abcdef'),
      ['RangeOf', str('abcdef'), str('cde')],
    ]);
    expect([...sliced.each()].map((c) => c.string).join('')).toBe('cde');
  });
});

describe('route parity: box, ce.function and Epsil agree', () => {
  test('`RangeOf`', () => {
    const expected = '4..5';
    expect(span(['RangeOf', str('abcab'), str('ab'), 3])).toBe(expected);

    const viaFn = ce
      .function('RangeOf', [ce.string('abcab'), ce.string('ab'), ce.number(3)])
      .evaluate();
    expect(`${viaFn.at(1)?.re}..${viaFn.at(viaFn.count!)?.re}`).toBe(expected);

    const viaEpsil = executeEpsil(ce, 'RangeOf("abcab", "ab", 3)').value;
    expect(`${viaEpsil.at(1)?.re}..${viaEpsil.at(viaEpsil.count!)?.re}`).toBe(
      expected
    );
  });

  test('the boolean members', () => {
    const cases: Array<[op: string, needle: string, expected: string]> = [
      ['ContainsSequence', 'bca', 'True'],
      ['ContainsSequence', 'bb', 'False'],
      ['StartsWith', 'abc', 'True'],
      ['StartsWith', 'bc', 'False'],
      ['EndsWith', 'cab', 'True'],
      ['EndsWith', 'abc', 'False'],
    ];
    for (const [op, needle, expected] of cases) {
      expect(truth([op, str('abcab'), str(needle)])).toBe(expected);
      expect(
        ce.function(op, [ce.string('abcab'), ce.string(needle)]).evaluate()
          .symbol
      ).toBe(expected);
      expect(executeEpsil(ce, `${op}("abcab", "${needle}")`).value.symbol).toBe(
        expected
      );
    }
  });

  test('the LaTeX route reaches them without a dictionary entry', () => {
    // Function-name parsing covers `\operatorname{…}`, as it already does for
    // `Characters`/`StringSplit`; no LaTeX dictionary entry is needed.
    expect(
      ce
        .parse('\\operatorname{StartsWith}(\\text{abcab}, \\text{abc})')
        .evaluate().symbol
    ).toBe('True');
    const r = ce
      .parse('\\operatorname{RangeOf}(\\text{abcab}, \\text{ab})')
      .evaluate();
    expect(`${r.at(1)?.re}..${r.at(r.count!)?.re}`).toBe('1..2');
  });
});
