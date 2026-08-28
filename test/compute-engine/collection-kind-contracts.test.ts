import { ComputeEngine } from '../../src/compute-engine';

/**
 * Two contracts a collection owes the kind it claims to be.
 *
 * 1. A collection LITERAL applies the operand-list rules to its elements: a
 *    `Sequence` operand is spliced ("these operands, inlined here") and a
 *    `Nothing` operand is erased. `Add` did this and `List`/`Set`/`Tuple` did
 *    not.
 *
 * 2. A SET-kind collection holds distinct elements — including when it is
 *    produced lazily. `Join` and `Append` adopt the set kind from a set
 *    operand but wrap their operands instead of materializing, so their
 *    `count`/`each`/`at` must report the same deduplicated elements as
 *    materialization.
 */

const ce = new ComputeEngine();

const elementsOf = (expr: ReturnType<typeof ce.box>): string[] =>
  [...expr.evaluate().each()].map((x) => x.toString());

describe('a collection literal splices `Sequence` and erases `Nothing`', () => {
  // `["List", …]` has a construction fast path in `box.ts` in ADDITION to
  // `canonicalList`, and only one of the two applied the rules. Every literal
  // below therefore also pins which path ran.
  test('`List` splices a `Sequence` operand', () => {
    const xs = ce.box(['List', 1, ['Sequence', 2, 3], 4]);
    expect(elementsOf(xs)).toEqual(['1', '2', '3', '4']);
    expect(xs.evaluate().type.toString()).toBe('vector<integer^4>');
  });

  test('`Set` splices a `Sequence` operand, then deduplicates', () => {
    expect(elementsOf(ce.box(['Set', 1, ['Sequence', 2, 3], 4]))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    // The splice happens BEFORE the dedup, so a spliced repeat is dropped.
    expect(elementsOf(ce.box(['Set', 1, ['Sequence', 2, 1], 3]))).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  test('`Tuple` splices a `Sequence` operand, changing its arity and type', () => {
    const t = ce.box(['Tuple', 1, ['Sequence', 2, 3], 4]).evaluate();
    expect(t.toString()).toBe('(1, 2, 3, 4)');
    expect(t.type.toString()).toBe('tuple<integer, integer, integer, integer>');
  });

  test('a nested `Sequence` has already collapsed, and an empty one vanishes', () => {
    // Deliberately NOT named "the splice is recursive": `Sequence`'s own
    // canonical handler flattens its arguments and unwraps the arity-1 case,
    // so the literal only ever sees ONE level and this witnesses that
    // normalization rather than `flatten`'s recursion. (The same trap as the
    // pre-existing `missing-value.test.ts` case, where `['Sequence',
    // 'Nothing', 2]` collapses to `2` through the arity-1 branch and so
    // exercises no splice at all.)
    expect(
      elementsOf(ce.box(['List', 1, ['Sequence', ['Sequence', 2, 3]], 4]))
    ).toEqual(['1', '2', '3', '4']);
    expect(elementsOf(ce.box(['List', 1, ['Sequence'], 4]))).toEqual([
      '1',
      '4',
    ]);
  });

  test('`Nothing` erasure still holds in every literal', () => {
    expect(elementsOf(ce.box(['List', 1, 'Nothing', 4]))).toEqual(['1', '4']);
    expect(elementsOf(ce.box(['Set', 1, 'Nothing', 3]))).toEqual(['1', '3']);
    expect(ce.box(['Tuple', 1, 'Nothing', 3]).evaluate().toString()).toBe(
      '(1, 3)'
    );
  });

  test('a literal with a spread applies the same rules to its other elements', () => {
    expect(
      elementsOf(
        ce.box(['List', ['Spread', ['Range', 1, 3]], ['Sequence', 7, 8]])
      )
    ).toEqual(['1', '2', '3', '7', '8']);
  });
});

describe('a set-kind lazy collection holds distinct elements', () => {
  test('`Join` of two sets deduplicates across the operands', () => {
    const j = ce.box(['Join', ['Set', 5, 2, 10, 18], ['Set', 1, 2, 3]]);
    // The documented answer: `2` appears once, not twice.
    expect(elementsOf(j)).toEqual(['5', '2', '10', '18', '1', '3']);
    expect(j.evaluate().count).toBe(6);
  });

  test('`Join` adopts the set kind from ANY operand, and dedups then too', () => {
    expect(elementsOf(ce.box(['Join', ['Set', 1, 2], ['List', 2, 3]]))).toEqual(
      ['1', '2', '3']
    );
    expect(elementsOf(ce.box(['Join', ['List', 1, 2], ['Set', 2, 3]]))).toEqual(
      ['1', '2', '3']
    );
  });

  test('`Append` of a value the set already holds adds nothing', () => {
    const a = ce.box(['Append', ['Set', 1, 2], 2]).evaluate();
    expect(elementsOf(a)).toEqual(['1', '2']);
    expect(a.count).toBe(2);
  });

  test('`count`, `each` and `at` agree on a set-kind result', () => {
    // The invariant whose breach is the whole point: indexing must walk the
    // deduplicated enumeration, not the concatenation (which would skip past
    // elements once a repeat had been counted).
    const j = ce
      .box(['Join', ['Set', 5, 2, 10, 18], ['Set', 1, 2, 3]])
      .evaluate();
    const each = elementsOf(j);
    expect(j.count).toBe(each.length);
    for (let i = 1; i <= each.length; i++)
      expect(j.at(i)?.toString()).toBe(each[i - 1]);
    expect(j.at(each.length + 1)).toBeUndefined();
    // A negative index counts from the end of the DEDUPLICATED sequence.
    expect(j.at(-1)?.toString()).toBe(each[each.length - 1]);
  });

  test('the lazy answer agrees with the materialized one', () => {
    // Materialization rebuilds through `ce.function('Set', …)`, which
    // deduplicates in `canonicalSet`. A lazy set that disagreed with its own
    // materialization is the defect; equality of the two is the fix.
    for (const expr of [
      ['Join', ['Set', 1, 2], ['Set', 2, 3]],
      ['Append', ['Set', 1, 2], 2],
      ['Append', ['Set', 1, 2], 3, 1],
    ]) {
      const lazy = ce.box(expr).evaluate();
      const materialized = lazy.evaluate({ materialization: true });
      expect(materialized.count).toBe(lazy.count);
      expect([...materialized.each()].map((x) => x.toString())).toEqual(
        elementsOf(lazy)
      );
    }
  });

  test('`Map` over a set deduplicates results the callback collapsed', () => {
    // Sharper than `Join`'s case: the callback maps three DISTINCT elements
    // onto two values. The image of a set under a function is a set, so the
    // deduplicated answer is the correct one — and it is the one
    // materializing the same node already gave.
    const m = ce
      .box(['Map', ['Function', ['Power', 'x', 2], 'x'], ['Set', -1, 1, 2]])
      .evaluate();
    expect(elementsOf(m)).toEqual(['1', '4']);
    expect(m.count).toBe(2);
    expect(m.at(1)?.toString()).toBe('1');
    expect(m.evaluate({ materialization: true }).toString()).toBe('Set(1, 4)');
  });

  test('`Map` over a NON-set keeps repeated results', () => {
    const m = ce
      .box(['Map', ['Function', ['Multiply', 'x', 2], 'x'], ['List', 1, 1, 2]])
      .evaluate();
    expect(elementsOf(m)).toEqual(['2', '2', '4']);
    expect(m.count).toBe(3);
  });

  test('a non-set `Join`/`Append` still keeps repeated elements', () => {
    expect(
      elementsOf(ce.box(['Join', ['List', 1, 2], ['List', 2, 3]]))
    ).toEqual(['1', '2', '2', '3']);
    expect(elementsOf(ce.box(['Append', ['List', 1, 2], 2]))).toEqual([
      '1',
      '2',
      '2',
    ]);
    // A tuple operand of `Join` stays atomic — one element, never spliced.
    expect(
      elementsOf(ce.box(['Join', ['List', 1, 2], ['Tuple', 3, 4]]))
    ).toEqual(['1', '2', '(3, 4)']);
  });
});

describe('a keyed lazy collection merges its keys, last value winning', () => {
  const kv = (k: string, v: number) => ['KeyValuePair', { str: k }, v];

  test('`Join` of two dictionaries merges a shared key', () => {
    const j = ce
      .box([
        'Join',
        ['Dictionary', kv('a', 1), kv('b', 2)],
        ['Dictionary', kv('b', 3), kv('c', 4)],
      ])
      .evaluate();
    // `b` appeared twice and counted 4 before: a dictionary owes its KEYS the
    // distinctness a set owes its elements.
    expect(elementsOf(j)).toEqual(['("a", 1)', '("b", 3)', '("c", 4)']);
    expect(j.count).toBe(3);
  });

  test('the merge follows the literal constructor: first POSITION, last VALUE', () => {
    // `Dictionary(a: 1, b: 2, a: 3)` is `{a: 3, b: 2}` — `a` keeps its place
    // and takes the later value. The lazy merge must agree exactly.
    const literal = ce
      .box(['Dictionary', kv('a', 1), kv('b', 2), kv('a', 3)])
      .evaluate();
    const joined = ce
      .box([
        'Join',
        ['Dictionary', kv('a', 1), kv('b', 2)],
        ['Dictionary', kv('a', 3)],
      ])
      .evaluate();
    expect(elementsOf(joined)).toEqual(elementsOf(literal));
    expect(joined.evaluate({ materialization: true }).json).toEqual(
      literal.json
    );
  });

  test('a keyed result materializes as a Dictionary, not a Set of entries', () => {
    // Without an `elttype` handler, `materialize()` never reached its
    // key-value branch and rebuilt through `function('Set', …)` — the HEAD
    // changed, not just the element count.
    const m = ce
      .box([
        'Join',
        ['Dictionary', kv('a', 1), kv('b', 2)],
        ['Dictionary', kv('b', 3), kv('c', 4)],
      ])
      .evaluate()
      .evaluate({ materialization: true });
    expect(m.operator).toBe('Dictionary');
    expect(m.json).toEqual({ dict: { a: 1, b: 3, c: 4 } });
  });

  test('`Append` of an entry overwrites a same-key entry of the source', () => {
    const a = ce
      .box([
        'Append',
        ['Dictionary', kv('a', 1), kv('b', 2)],
        ['Tuple', { str: 'b' }, 9],
      ])
      .evaluate();
    expect(elementsOf(a)).toEqual(['("a", 1)', '("b", 9)']);
    expect(a.count).toBe(2);
  });

  test('`contains` answers from the merged entries', () => {
    // An entry whose key was overwritten is no longer a member; asking the
    // operands directly would still report it present.
    const j = ce
      .box([
        'Join',
        ['Dictionary', kv('a', 1), kv('b', 2)],
        ['Dictionary', kv('b', 3)],
      ])
      .evaluate();
    expect(j.contains(ce.box(['Tuple', { str: 'b' }, 2]))).toBe(false);
    expect(j.contains(ce.box(['Tuple', { str: 'b' }, 3]))).toBe(true);
  });
});

describe('deduplication cannot wedge the iterator', () => {
  test('an endless run of duplicates is bounded, not a hang', () => {
    // Deduplicating advances only on a DISTINCT element, so a source that
    // repeats one value forever spins inside a single `next()` — and a
    // wedged `next()` is strictly worse than no deduplication at all, since
    // the consumer's own deadline checks only run BETWEEN yields. Bounded by
    // `ce.iterationLimit`, exactly as `Dedup`'s iterator is.
    const j = ce.box(['Join', ['Set', 1], ['Repeat', 1]]).evaluate();
    expect(j.type.toString()).toBe('set');
    const iter = j.each();
    expect(iter.next().value?.toString()).toBe('1');
    // The second pull is the one that used to never return.
    expect(() => iter.next()).toThrow();
    // The terminal consumers swallow that cancellation to "unknown".
    expect(j.count).toBeUndefined();
    expect(j.at(2)).toBeUndefined();
  });

  test('an operand that cannot be enumerated makes the count unknown', () => {
    // Finiteness is not enumerability: a `Linspace` with symbolic endpoints
    // reports a count while its iterator declines. Counting the walk anyway
    // would report the literal set's elements as an exact distinct count.
    const j = ce
      .box(['Join', ['Set', 1, 2], ['Linspace', 'x', 'y']])
      .evaluate();
    expect(j.type.toString()).toBe('set');
    expect(j.count).toBeUndefined();
  });

  test('a provably finite dedup walk is not capped short', () => {
    // The walk is bounded by `ce.maxCollectionSize`, not `ce.iterationLimit`:
    // `rawTotal` is known and finite, so the walk terminates in at most that
    // many steps whatever the elements are, and capping at 1024 cost this
    // count for no safety gained. 5000, not 5002 — `1` and `2` are already in
    // the range.
    const j = ce.box(['Join', ['Set', 1, 2], ['Range', 1, 5000]]).evaluate();
    expect(j.type.toString()).toBe('set');
    expect(j.count).toBe(5000);
    // `isEmpty`/`isFinite` default to being derived from `count`; declaring
    // them explicitly keeps them (and the preview) alive even when a walk
    // does refuse.
    expect(j.isFiniteCollection).toBe(true);
    expect(j.isEmptyCollection).toBe(false);
    expect(j.evaluate({ materialization: true }).toString()).toBe(
      'Set(1, 2, 3, 4, 5, ...)'
    );
  });

  test('a stalled dedup walk previews as a continuation, never as an error', () => {
    // The iterator gives up on an unbroken run of duplicates by throwing
    // `iteration-limit-exceeded`. `count`/`at` swallow it, but `materialize()`
    // walks `each()` too — and reaches it now that these operators declare
    // `isEmpty`/`isFinite` explicitly, so it no longer bails early. Letting it
    // escape made `evaluate()` throw and `toString()` render an error string
    // for expressions that previewed fine before. A walk that cannot get past
    // a run of duplicates IS a continuation.
    expect(
      ce
        .box(['Join', ['Set', 1], ['Repeat', 1]])
        .evaluate()
        .toString()
    ).toBe('Set(1, ...)');
    expect(
      ce
        .box(['Map', ['Function', 1, 'x'], 'Integers'])
        .evaluate()
        .toString()
    ).toBe('Set(1, ...)');
    // The list-kind analogue never deduplicates and is untouched.
    expect(
      ce
        .box(['Map', ['Function', 1, 'x'], ['Range', 1, { num: '+Infinity' }]])
        .evaluate()
        .toString()
    ).toBe('[1,1,1,1,1,...]');
  });

  test('finiteness is not dedup-invariant, and the answer is UNKNOWN not false', () => {
    // Deduplication can only SHRINK, so it can turn an infinite enumeration
    // into a finite set: `Join(Set(1), Repeat(1))` enumerates forever and
    // holds exactly one element. A definite `false` there is a lie.
    expect(
      ce.box(['Join', ['Set', 1], ['Repeat', 1]]).evaluate().isFiniteCollection
    ).toBeUndefined();
    // A callback can collapse infinitely many distinct elements onto one, so
    // an infinite SET source settles nothing for `Map` either.
    expect(
      ce.box(['Map', ['Function', 1, 'x'], 'Integers']).evaluate()
        .isFiniteCollection
    ).toBeUndefined();
    // But `Join`/`Append` pass their operands' elements through UNCHANGED, so
    // an infinite SET operand keeps infinitely many distinct elements.
    expect(ce.box(['Join', ['Set', 1, 2], 'Integers']).evaluate().count).toBe(
      Infinity
    );
    expect(ce.box(['Append', 'Integers', 5]).evaluate().count).toBe(Infinity);
  });

  test('a non-integer index costs `undefined`, not the process', () => {
    // `NaN < 1` and `NaN > limit` are both false, so a NaN index fell through
    // to an unbounded walk. `at(index: number)` is public API.
    const m = ce
      .box(['Map', ['Function', ['Square', 'x'], 'x'], 'Integers'])
      .evaluate();
    expect(m.at(NaN)).toBeUndefined();
    expect(m.at(1.5)).toBeUndefined();
  });

  test('an EAGER set-producing source is walked, not refused', () => {
    // `SetFrom(…)` has no collection handlers until evaluated and reports its
    // enumerability as unknown; `mapSource()` resolves it, and every other
    // `Map` facet already read through it.
    const m = ce
      .box([
        'Map',
        ['Function', ['Multiply', 'x', 2], 'x'],
        ['SetFrom', ['List', 1, 2]],
      ])
      .evaluate();
    expect(m.count).toBe(2);
    expect(m.at(1)?.toString()).toBe('2');
    expect(elementsOf(m)).toEqual(['2', '4']);
  });

  test('an infinite operand still short-circuits a NON-set count', () => {
    // A concatenation containing an infinite operand is infinite whatever
    // follows it; a later operand of unknown count must not mask that.
    const j = ce
      .box(['Join', ['Range', 1, { num: '+Infinity' }], 'xs'])
      .evaluate();
    expect(j.count).toBe(Infinity);
  });

  test('a positive index works over an enumerable operand of unknown length', () => {
    // The concatenated length is needed only to count back from the END, so
    // computing it eagerly made `at` refuse where `each` answers.
    const j = ce
      .box([
        'Join',
        ['Set', 1, 2],
        ['Filter', ['List', 3, 4], ['Function', ['Greater', '_', 0], '_']],
      ])
      .evaluate();
    expect(elementsOf(j)).toEqual(['1', '2', '3', '4']);
    expect(j.at(1)?.toString()).toBe('1');
    expect(j.at(3)?.toString()).toBe('3');
  });

  test('a non-enumerable operand makes `at` refuse rather than mis-index', () => {
    // A valueless operand yields nothing, which SHIFTS every later element
    // into its place: `Join(xs, Set(1,2))` enumerates as `1, 2`, so walking
    // would answer `1` for index 1 when the real first element is `xs`'s.
    const j = ce.box(['Join', 'xs', ['Set', 1, 2]]).evaluate();
    expect(j.at(1)).toBeUndefined();
  });

  test('an infinite NON-set join is untouched by any of this', () => {
    const j = ce
      .box(['Join', ['List', 1, 2], ['Range', 1, { num: '+Infinity' }]])
      .evaluate();
    expect(j.count).toBe(Infinity);
    const iter = j.each();
    const first: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) first.push(iter.next().value?.toString());
    expect(first).toEqual(['1', '2', '1', '2', '3']);
  });
});

describe('a truncated preview says so', () => {
  test('a collection one longer than the preview head keeps its marker', () => {
    // The head-only walk (taken by non-indexed collections, e.g. any set)
    // tested whether an element existed AFTER the one it was discarding, so a
    // collection of exactly `head + 1` elements dropped its last element and
    // reported no continuation at all. `DEFAULT_MATERIALIZATION` heads at 5.
    const six = ce.box(['Join', ['Set', 1, 2, 3, 4, 5], ['Set', 6]]).evaluate();
    expect(six.count).toBe(6);
    expect(six.evaluate({ materialization: true }).toString()).toBe(
      'Set(1, 2, 3, 4, 5, ...)'
    );
  });

  test('a collection that fits the preview head gets no marker', () => {
    const five = ce.box(['Join', ['Set', 1, 2, 3, 4, 5], ['Set']]).evaluate();
    expect(five.count).toBe(5);
    expect(five.evaluate({ materialization: true }).toString()).toBe(
      'Set(1, 2, 3, 4, 5)'
    );
  });
});
