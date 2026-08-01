import { ComputeEngine } from '../../src/compute-engine';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';

/**
 * The Random family: `Random`, `RandomChoice`, `RandomSample`,
 * `RandomShuffle` — domain-only, seedless, and bounded.
 * See `docs/plans/2026-07-25-random-signature-redesign.md` §§3–5, §8.
 *
 * `WithRandomSeed` itself (frames, nesting, seed folding, the stability
 * vectors) is covered by `with-random-seed.test.ts` and
 * `random-vectors.test.ts`; this suite uses frames only as the determinism
 * harness the redesign provides.
 *
 * Every group probes the BOX route and, where the spelling is expressible,
 * the PARSE route — `ce.function(...)`-only coverage misses the held-operand
 * failure class of a `lazy: true` operator like `WithRandomSeed`.
 */

const ce = new ComputeEngine();

const evaluate = (mathjson: any): string =>
  ce.box(mathjson).evaluate().toString();

const values = (mathjson: any): (number | undefined)[] =>
  [...ce.box(mathjson).evaluate().each()].map((x) => x.re);

/** The `n`-th draw of a frame seeded `seed`, computed independently of the
 * engine — the reference the draw-consumption probes compare against. */
function expectedDraw(seed: number | string, n: number): number {
  const [lo, hi] = foldSeed(seed);
  return frameDraw(lo, hi, n);
}

/**
 * How many draws `body` consumed inside a frame: evaluate
 * `WithRandomSeed(seed, Block(body, Random()))` and identify the trailing
 * draw's index in the frame's stream.
 *
 * This is what result-only assertions cannot see — an implementation can
 * return correct output while leaving the counter in the wrong place, which
 * silently shifts every later value in the frame (§4 draw-consumption
 * contract). Uses `evaluate()`, never `.N()`: `.N()` re-evaluates `Add`
 * operands and double-consumes draws (a known issue, `@fixme` in
 * `with-random-seed.test.ts`).
 */
function drawsConsumed(body: any, seed = 42): number {
  const trailing = ce
    .box(['WithRandomSeed', seed, ['Block', body, ['Random']]])
    .evaluate().re;
  for (let n = 0; n < 64; n++)
    if (Math.abs(expectedDraw(seed, n) - trailing) < 1e-15) return n;
  return -1;
}

describe('Random — no operand', () => {
  it('draws a real in [0, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const v = ce.box(['Random']).evaluate().re;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('types finite_real', () => {
    expect(ce.box(['Random']).type.toString()).toBe('finite_real');
    expect(ce.parse('\\operatorname{Random}()').type.toString()).toBe(
      'finite_real'
    );
  });

  it('is sgn non-negative', () => {
    expect(ce.box(['Random']).sgn).toBe('non-negative');
  });
});

describe('Random — Range domains', () => {
  it('Range(1, 6) is inclusive at BOTH ends', () => {
    const seen = new Set<number | undefined>();
    for (let i = 0; i < 400; i++)
      seen.add(ce.box(['Random', ['Range', 1, 6]]).evaluate().re);
    expect([...seen].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('Range(7, 2) descends (no "swap the bounds" step)', () => {
    const seen = new Set<number | undefined>();
    for (let i = 0; i < 400; i++)
      seen.add(ce.box(['Random', ['Range', 7, 2]]).evaluate().re);
    expect([...seen].sort((a, b) => a! - b!)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('Range(1, 10, 2) draws odd values only', () => {
    const seen = new Set<number | undefined>();
    for (let i = 0; i < 400; i++)
      seen.add(ce.box(['Random', ['Range', 1, 10, 2]]).evaluate().re);
    expect([...seen].sort((a, b) => a! - b!)).toEqual([1, 3, 5, 7, 9]);
  });

  // A DRAW is finite by construction (an infinite `Range` is an evaluation
  // error, never an infinite result), so the element type is narrowed to its
  // finite counterpart — `Range`'s own `integer`/`number` admit ±∞.
  it('a Range domain types as its element type, narrowed to FINITE', () => {
    expect(ce.box(['Random', ['Range', 1, 6]]).type.toString()).toBe(
      'finite_integer'
    );
    // Range(0.5, 2.5) iterates 0.5, 1.5, 2.5 — `number`, not `integer`.
    expect(ce.box(['Random', ['Range', 0.5, 2.5]]).type.toString()).toBe(
      'finite_number'
    );
  });

  it('Range(0.5, 2.5) draws a NON-integer', () => {
    const seen = new Set<number | undefined>();
    for (let i = 0; i < 200; i++)
      seen.add(ce.box(['Random', ['Range', 0.5, 2.5]]).evaluate().re);
    expect([...seen].sort((a, b) => a! - b!)).toEqual([0.5, 1.5, 2.5]);
  });

  it('parses and draws through the parse route', () => {
    const v = ce
      .parse('\\operatorname{Random}(\\operatorname{Range}(1, 6))')
      .evaluate().re!;
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(6);
  });
});

describe('Random — Interval domains', () => {
  // `finite_real`, not `Interval`'s own `real`: a set of reals may contain
  // ±∞, but a draw from a BOUNDED interval cannot (an unbounded one errors).
  it('draws in [lo, hi), typed finite_real', () => {
    expect(ce.box(['Random', ['Interval', 0, 1]]).type.toString()).toBe(
      'finite_real'
    );
    for (let i = 0; i < 200; i++) {
      const v = ce.box(['Random', ['Interval', -5, -1]]).evaluate().re!;
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(-1);
    }
  });

  it('ignores endpoint open/closed markers (a float draw cannot respect them)', () => {
    for (let i = 0; i < 50; i++) {
      const v = ce
        .box(['Random', ['Interval', ['Open', 0], ['Open', 1]]])
        .evaluate().re!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Random — collection domains', () => {
  it('a list of strings draws a string and types `string`', () => {
    const xs = ['List', { str: 'a' }, { str: 'b' }, { str: 'c' }];
    expect(ce.box(['Random', xs]).type.toString()).toBe('string');
    for (let i = 0; i < 30; i++)
      expect(['a', 'b', 'c']).toContain(
        ce.box(['Random', xs]).evaluate().string
      );
  });

  it('a matrix draws a ROW (the first axis)', () => {
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    for (let i = 0; i < 30; i++)
      expect(['[1,2]', '[3,4]']).toContain(evaluate(['Random', m]));
  });

  it('a Tuple draws an ELEMENT — deliberately unlike `Join`, where a tuple operand is atomic', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++)
      seen.add(evaluate(['Random', ['Tuple', 1, 2, 3]]));
    expect([...seen].sort()).toEqual(['1', '2', '3']);
  });

  it('a non-indexed collection (Set) draws via count-then-select', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++)
      seen.add(evaluate(['Random', ['Set', 1, 2, 3]]));
    expect([...seen].sort()).toEqual(['1', '2', '3']);
  });
});

describe('Random — rejected and invalid domains', () => {
  it('Random(5) and Random(5, 7) are signature-invalid', () => {
    expect(ce.box(['Random', 5]).isValid).toBe(false);
    expect(ce.box(['Random', 5, 7]).isValid).toBe(false);
    expect(ce.parse('\\operatorname{Random}(5)').isValid).toBe(false);
  });

  // These report `count: Infinity`, so a `count === 0` test would silently
  // draw from a reversed or degenerate interval.
  it('an empty or reversed Interval errors (the count === Infinity trap)', () => {
    expect(ce.box(['Interval', 1, 0]).count).toBe(Infinity);
    expect(ce.box(['Interval', 1, 1]).count).toBe(Infinity);
    expect(evaluate(['Random', ['Interval', 1, 0]])).toContain('out-of-range');
    expect(evaluate(['Random', ['Interval', 1, 1]])).toContain('out-of-range');
  });

  it('an unbounded Interval errors — no uniform distribution exists', () => {
    expect(
      evaluate(['Random', ['Interval', ['Open', { num: '-Infinity' }], 0]])
    ).toContain('out-of-range');
  });

  it('an unbounded Range and an infinite collection error', () => {
    expect(evaluate(['Random', ['Range', 1, { num: '+Infinity' }]])).toContain(
      'out-of-range'
    );
    expect(evaluate(['Random', ['Cycle', ['List', 1, 2]]])).toContain(
      'out-of-range'
    );
  });

  it('an empty collection errors', () => {
    expect(evaluate(['Random', ['List']])).toContain('out-of-range');
    expect(evaluate(['Random', ['Range', 5, 1, 1]])).toContain('out-of-range');
  });

  it('an unresolved domain stays symbolic rather than claiming an error', () => {
    const local = new ComputeEngine();
    local.declare('xs', 'list<number>');
    expect(local.box(['Random', 'xs']).evaluate().operator).toBe('Random');
  });
});

describe('RandomChoice / RandomSample — the §4 k table', () => {
  const DOMAIN = ['Range', 1, 5];
  const LIST = ['List', 10, 20, 30, 40, 50];

  it('a non-literal k stays symbolic (both operators)', () => {
    expect(ce.box(['RandomChoice', DOMAIN, 'm']).evaluate().operator).toBe(
      'RandomChoice'
    );
    expect(ce.box(['RandomSample', LIST, 'm']).evaluate().operator).toBe(
      'RandomSample'
    );
  });

  it('a non-finite or unsafe-range k errors (both operators)', () => {
    for (const k of [{ num: '+Infinity' }, { num: 'NaN' }, 1e20]) {
      expect(evaluate(['RandomChoice', DOMAIN, k])).toContain('out-of-range');
      expect(evaluate(['RandomSample', LIST, k])).toContain('out-of-range');
    }
  });

  it('k < 0 errors (both operators) — RandomSample used to return undefined', () => {
    expect(evaluate(['RandomChoice', DOMAIN, -1])).toContain('out-of-range');
    expect(evaluate(['RandomSample', LIST, -1])).toContain('out-of-range');
  });

  it('k = 0 is the empty list (both operators)', () => {
    expect(ce.box(['RandomChoice', DOMAIN, 0]).evaluate().json).toEqual([
      'List',
    ]);
    expect(ce.box(['RandomSample', LIST, 0]).evaluate().json).toEqual(['List']);
  });

  it('0 < k <= n gives k elements (both operators)', () => {
    expect(values(['RandomChoice', DOMAIN, 3])).toHaveLength(3);
    expect(values(['RandomSample', LIST, 3])).toHaveLength(3);
  });

  it('k = n: RandomSample is a permutation', () => {
    const v = values(['RandomSample', LIST, 5]);
    expect([...v].sort((a, b) => a! - b!)).toEqual([10, 20, 30, 40, 50]);
  });

  // The observable difference between the twins.
  it('k > n is LEGAL for RandomChoice (replacement) and an ERROR for RandomSample', () => {
    expect(values(['RandomChoice', DOMAIN, 12])).toHaveLength(12);
    expect(evaluate(['RandomSample', LIST, 12])).toContain('out-of-range');
  });

  it('k past the size cap errors (both operators)', () => {
    expect(evaluate(['RandomChoice', DOMAIN, 10_000_000])).toContain(
      'out-of-range'
    );
    expect(evaluate(['RandomSample', LIST, 10_000_000])).toContain(
      'out-of-range'
    );
  });

  // `toInteger` rounds half toward +∞. The half-way case is what a
  // reimplementation gets wrong.
  it('a non-integer k is rounded: 2.7→3, 2.4→2, 2.5→3, -0.4→empty', () => {
    expect(values(['RandomChoice', DOMAIN, 2.7])).toHaveLength(3);
    expect(values(['RandomChoice', DOMAIN, 2.4])).toHaveLength(2);
    expect(values(['RandomChoice', DOMAIN, 2.5])).toHaveLength(3);
    expect(ce.box(['RandomChoice', DOMAIN, -0.4]).evaluate().json).toEqual([
      'List',
    ]);
    expect(values(['RandomSample', LIST, 2.7])).toHaveLength(3);
    expect(values(['RandomSample', LIST, 2.4])).toHaveLength(2);
    expect(values(['RandomSample', LIST, 2.5])).toHaveLength(3);
    expect(ce.box(['RandomSample', LIST, -0.4]).evaluate().json).toEqual([
      'List',
    ]);
  });

  it('domain validity is checked FIRST, before any k test', () => {
    // An invalid domain errors regardless of `k` — including `k = 0`, which
    // would otherwise short-circuit to the empty list.
    expect(evaluate(['RandomChoice', ['List'], 0])).toContain('out-of-range');
    expect(evaluate(['RandomChoice', ['Interval', 1, 1], 3])).toContain(
      'out-of-range'
    );
  });

  it('a bounded Interval is a VALID RandomChoice domain (the RandomList migration)', () => {
    // `Interval` reports `count: Infinity`, so a count-based domain check
    // would reject the prescribed `RandomList(n)` replacement.
    const v = values(['RandomChoice', ['Interval', 0, 1], 4]);
    expect(v).toHaveLength(4);
    for (const u of v) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('the result is an eagerly materialized list, shaped by the type handler', () => {
    const t = ce.box(['RandomChoice', ['Range', 1, 6], 3]).type;
    expect(t.matches('list<integer>')).toBe(true);
    expect(t.toString()).toContain('3');
    // A zero count stays unshaped: `^0` reduces to the unit type.
    const t0 = ce.box(['RandomChoice', ['Range', 1, 6], 0]).type;
    expect(t0.toString()).not.toContain('^0');
  });

  it('a RandomChoice cell has the same type as the Random draw it is', () => {
    // The closed-form domains narrow to their finite counterpart: a DRAW from
    // a bounded `Interval`/finite `Range` cannot be ±∞ even though the SET
    // element type admits them. `RandomChoice` cells are `Random` draws, so
    // they carry the same narrowing (was the wider `list<real^k>`).
    expect(ce.box(['Random', ['Interval', 0, 1]]).type.toString()).toBe(
      'finite_real'
    );
    expect(
      ce
        .box(['RandomChoice', ['Interval', 0, 1], 3])
        .type.matches('list<finite_real^3>')
    ).toBe(true);

    expect(ce.box(['Random', ['Range', 1, 6]]).type.toString()).toBe(
      'finite_integer'
    );
    expect(
      ce
        .box(['RandomChoice', ['Range', 1, 6], 3])
        .type.matches('list<finite_integer^3>')
    ).toBe(true);

    // An unshaped (symbolic-`k`) result narrows too.
    expect(
      ce
        .box(['RandomChoice', ['Interval', 0, 1], 'm'])
        .type.matches('list<finite_real>')
    ).toBe(true);

    // A non-closed-form domain keeps its collection element type unchanged.
    expect(
      ce
        .box(['RandomChoice', ['List', 1, 2, 3], 2])
        .type.matches('list<integer^2>')
    ).toBe(true);
  });
});

describe('The isIndexedCollection gate', () => {
  const SET = ['Set', 1, 2, 3];
  // A lazy indexed view.
  const FILTERED = [
    'Filter',
    ['Range', 1, 10],
    ['Function', ['Greater', 'x', 3], 'x'],
  ];

  it('RandomSample and RandomShuffle reject a Set; RandomChoice accepts it', () => {
    expect(ce.box(['RandomSample', SET, 2]).isValid).toBe(false);
    expect(ce.box(['RandomShuffle', SET]).isValid).toBe(false);
    expect(values(['RandomChoice', SET, 2])).toHaveLength(2);
  });

  it('an Interval is not an indexed collection either', () => {
    expect(ce.box(['RandomSample', ['Interval', 0, 1], 2]).isValid).toBe(false);
    expect(ce.box(['RandomShuffle', ['Interval', 0, 1]]).isValid).toBe(false);
  });

  it('a Filter over a Range is legal for all three', () => {
    expect(ce.box(FILTERED).isIndexedCollection).toBe(true);
    expect(values(['RandomChoice', FILTERED, 3])).toHaveLength(3);
    expect(values(['RandomSample', FILTERED, 3])).toHaveLength(3);
    expect(values(['RandomShuffle', FILTERED]).sort((a, b) => a! - b!)).toEqual(
      [4, 5, 6, 7, 8, 9, 10]
    );
  });
});

describe('RandomSample — without replacement is over POSITIONS, not values', () => {
  it('every position is drawn at most once', () => {
    // Distinct values ⇒ distinct positions ⇒ no repeats.
    for (let i = 0; i < 50; i++) {
      const v = values(['RandomSample', ['Range', 1, 20], 8]);
      expect(new Set(v).size).toBe(8);
    }
  });

  it('on a multiset, repeats ARE expected: [1,1,2] can sample [1,1]', () => {
    // Pinned seed, so this is deterministic rather than a 1-in-4 flake.
    expect(
      values(['WithRandomSeed', 3, ['RandomSample', ['List', 1, 1, 2], 2]])
    ).toEqual([1, 1]);
  });
});

describe('RandomChoice — independence (pigeonhole, not "no repeats")', () => {
  it('N > |domain| draws must repeat a value', () => {
    // A correct WITH-replacement draw may repeat, so "all distinct" would be
    // the wrong assertion. Over 7 draws from a 3-element domain, some value
    // must appear twice — that is the pigeonhole, and it holds under any
    // seed.
    const v = values([
      'WithRandomSeed',
      42,
      ['RandomChoice', ['Range', 1, 3], 7],
    ]);
    expect(v).toHaveLength(7);
    expect(new Set(v).size).toBeLessThan(7);
    for (const x of v) expect([1, 2, 3]).toContain(x);
  });
});

describe('RandomShuffle', () => {
  it('permutes the source without mutating it', () => {
    const v = values(['RandomShuffle', ['Range', 1, 5]]);
    expect([...v].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rebuilds as a List and types list<elt>', () => {
    expect(ce.box(['RandomShuffle', ['Range', 1, 5]]).evaluate().operator).toBe(
      'List'
    );
    expect(ce.box(['RandomShuffle', ['Range', 1, 5]]).type.toString()).toBe(
      'list<integer>'
    );
  });

  it('past the size cap errors with out-of-range, not an OOM', () => {
    expect(evaluate(['RandomShuffle', ['Range', 1, 1_000_000_000]])).toContain(
      'out-of-range'
    );
  });

  // A permutation of an infinite collection cannot exist, so it is an ERROR,
  // not a silent `undefined` — matching `Random`/`RandomSample`, which already
  // report `out-of-range`/"a finite collection" on the same input.
  it('an INFINITE collection errors, like Random and RandomSample', () => {
    const infinite = ['Cycle', ['List', 1, 2]];
    expect(evaluate(['RandomShuffle', infinite])).toContain('out-of-range');
    expect(evaluate(['RandomShuffle', infinite])).toContain(
      'a finite collection'
    );
    // The sibling shape it now matches.
    expect(evaluate(['Random', infinite])).toContain('a finite collection');
    expect(evaluate(['RandomShuffle', ['Repeat', 1]])).toContain(
      'out-of-range'
    );
  });

  it('an INDETERMINATE finiteness stays symbolic, not an error', () => {
    // `undefined` finiteness is "not known yet", not "cannot": the expression
    // must survive unevaluated so a later assignment can resolve it.
    const local = new ComputeEngine();
    local.declare('xs', 'list<number>');
    expect(local.box('xs').isFiniteCollection).toBe(undefined);
    expect(local.box(['RandomShuffle', 'xs']).evaluate().operator).toBe(
      'RandomShuffle'
    );
  });
});

describe('Non-materialization — a spy that fails if each() is touched', () => {
  /** Wrap `each` on a boxed collection and count the calls. */
  function eachSpy(xs: any): () => number {
    let calls = 0;
    const original = xs.each.bind(xs);
    xs.each = (...args: any[]) => {
      calls += 1;
      return original(...args);
    };
    return () => calls;
  }

  it('Random(Range(1, 1000000)) indexes, never iterates', () => {
    const xs: any = ce.box(['Range', 1, 1_000_000]);
    const calls = eachSpy(xs);
    const v = ce.function('Random', [xs]).evaluate().re!;
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(1_000_000);
    expect(calls()).toBe(0);
  });

  it('RandomChoice(Range(1, 1000000), 1000) indexes, never iterates', () => {
    const xs: any = ce.box(['Range', 1, 1_000_000]);
    const calls = eachSpy(xs);
    const r = ce.function('RandomChoice', [xs, ce.number(1000)]).evaluate();
    expect(r.nops).toBe(1000);
    expect(calls()).toBe(0);
  });

  it('RandomSample(Range(1, 1000000), 3) indexes, never iterates', () => {
    const xs: any = ce.box(['Range', 1, 1_000_000]);
    const calls = eachSpy(xs);
    const r = ce.function('RandomSample', [xs, ce.number(3)]).evaluate();
    expect(r.nops).toBe(3);
    expect(calls()).toBe(0);
  });
});

describe('Distribution — objective thresholds under a pinned seed', () => {
  // ONE enclosing frame, ONE continuous stream (never re-seeded per trial —
  // that would replay a single value). 10,000 draws over a 5-element domain;
  // each element's count within ±150 of 2,000 (≈3.7σ for a fair draw). Under
  // the pinned seed the sequence is fixed, so the tolerance is a correctness
  // band, not a flake margin.
  const tally = (vs: (number | undefined)[]): number[] => {
    const counts = [0, 0, 0, 0, 0];
    for (const v of vs) counts[v! - 1] += 1;
    return counts;
  };

  it('RandomChoice over Range(1, 5) is uniform', () => {
    const counts = tally(
      values(['WithRandomSeed', 42, ['RandomChoice', ['Range', 1, 5], 10_000]])
    );
    expect(counts.reduce((a, b) => a + b)).toBe(10_000);
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThanOrEqual(150);
  });

  it('the sparse Fisher-Yates of RandomSample is uniform', () => {
    // An off-by-one in the partial Fisher-Yates yields output that looks
    // random but is biased, so the rewrite gets its own distribution test.
    const counts = tally(
      values([
        'WithRandomSeed',
        42,
        [
          'Map',
          ['Range', 1, 10_000],
          ['Function', ['First', ['RandomSample', ['Range', 1, 5], 1]], 'i'],
        ],
      ])
    );
    expect(counts.reduce((a, b) => a + b)).toBe(10_000);
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThanOrEqual(150);
  });
});

describe('Draw-consumption contract (§4)', () => {
  it('every Random domain branch consumes exactly 1', () => {
    expect(drawsConsumed(['Random'])).toBe(1);
    expect(drawsConsumed(['Random', ['Interval', 0, 1]])).toBe(1);
    expect(drawsConsumed(['Random', ['Range', 1, 6]])).toBe(1);
    expect(drawsConsumed(['Random', ['List', 1, 2, 3]])).toBe(1);
    expect(drawsConsumed(['Random', ['Set', 1, 2, 3]])).toBe(1);
  });

  it('RandomChoice consumes exactly k, on every domain kind', () => {
    expect(drawsConsumed(['RandomChoice', ['Range', 1, 6], 4])).toBe(4);
    expect(drawsConsumed(['RandomChoice', ['Interval', 0, 1], 4])).toBe(4);
    expect(drawsConsumed(['RandomChoice', ['List', 1, 2, 3], 4])).toBe(4);
    expect(drawsConsumed(['RandomChoice', ['Set', 1, 2, 3], 4])).toBe(4);
  });

  it('RandomSample consumes exactly k', () => {
    expect(drawsConsumed(['RandomSample', ['Range', 1, 20], 3])).toBe(3);
    expect(drawsConsumed(['RandomSample', ['Range', 1, 20], 20])).toBe(20);
  });

  it('RandomShuffle consumes exactly n − 1 (one per Fisher-Yates swap)', () => {
    expect(drawsConsumed(['RandomShuffle', ['Range', 1, 5]])).toBe(4);
    expect(drawsConsumed(['RandomShuffle', ['Range', 1, 1]])).toBe(0);
    expect(drawsConsumed(['RandomShuffle', ['List']])).toBe(0);
  });

  it('k = 0 and validation errors consume 0 — validation completes before the first draw', () => {
    expect(drawsConsumed(['RandomChoice', ['Range', 1, 6], 0])).toBe(0);
    expect(drawsConsumed(['RandomSample', ['Range', 1, 6], 0])).toBe(0);
    expect(drawsConsumed(['Random', ['List']])).toBe(0);
    expect(drawsConsumed(['Random', ['Interval', 1, 0]])).toBe(0);
    expect(drawsConsumed(['RandomChoice', ['Range', 1, 6], -1])).toBe(0);
    expect(drawsConsumed(['RandomSample', ['List', 1, 2], 5])).toBe(0);
    expect(drawsConsumed(['RandomShuffle', ['Range', 1, 1_000_000_000]])).toBe(
      0
    );
  });

  // RULED 2026-07-25 (`docs/RANDOMNESS-MODEL.md` §5, "Only evaluation
  // consumes"): draw indices are consumed by EVALUATION and only by
  // evaluation, so anything the engine can prove it does not need — an untaken
  // branch, an unmaterialized lazy view, or a count-preserving wrapper erased
  // at CANONICALIZATION — advances the counter by nothing.
  //
  // `Count`/`Length`/`IsEmpty` canonicalize `Count(RandomShuffle(xs))` to
  // `Count(xs)` (a shuffle cannot change a count), and `Contains` additionally
  // erases `Unique`. The shuffle therefore never runs and draws nothing —
  // which is also what keeps `Count` off the materialize-to-count perf cliff.
  it('a wrapper erased at canonicalization consumes 0 (Count(RandomShuffle(xs)))', () => {
    const xs = ['Range', 1, 5];
    // The strip is what makes this 0, so pin the strip itself too.
    expect(ce.box(['Count', ['RandomShuffle', xs]]).toString()).not.toContain(
      'RandomShuffle'
    );
    expect(drawsConsumed(['Count', ['RandomShuffle', xs]])).toBe(0);
    expect(drawsConsumed(['Length', ['RandomShuffle', xs]])).toBe(0);
    expect(drawsConsumed(['IsEmpty', ['RandomShuffle', xs]])).toBe(0);
    expect(drawsConsumed(['Contains', ['RandomShuffle', xs], 3])).toBe(0);
    // …while an UNERASED shuffle of the same collection consumes n − 1.
    expect(drawsConsumed(['RandomShuffle', xs])).toBe(4);
  });
});

describe('Deadline — every O(k)/O(n) loop honors an enclosing withTimeLimit', () => {
  it('RandomChoice materialization', () => {
    const local = new ComputeEngine();
    expect(() =>
      local.withTimeLimit(1, () =>
        local.box(['RandomChoice', ['Interval', 0, 1], 1_000_000]).evaluate()
      )
    ).toThrow();
  });

  it('RandomSample sparse Fisher-Yates', () => {
    const local = new ComputeEngine();
    expect(() =>
      local.withTimeLimit(1, () =>
        local
          .box(['RandomSample', ['Range', 1, 1_000_000], 1_000_000])
          .evaluate()
      )
    ).toThrow();
  });

  it('RandomShuffle', () => {
    const local = new ComputeEngine();
    expect(() =>
      local.withTimeLimit(1, () =>
        local.box(['RandomShuffle', ['Range', 1, 1_000_000]]).evaluate()
      )
    ).toThrow();
  });
});

describe('Declaration flags — every nondeterministic head is impure', () => {
  // `pure: true` on a head whose evaluate handler is nondeterministic is a
  // correctness bug, not a cosmetic one: it makes `isConstant` true, admits
  // the head to common-subexpression elimination (which would collapse two
  // independent draws into one) and to the `Map` lowering gate, and makes
  // `Add`/`Multiply` keep the RAW operand under `.N()` — re-evaluating it and
  // drawing twice.
  //
  // `drawsRandom` is the STRICTER claim: "this head consumes indices from the
  // ambient `WithRandomSeed` frame", used by `WithRandomSeed` to decide
  // whether a partially-evaluated body still owes draws. A head that samples
  // `Math.random()` directly (`RandomExpression`) is impure but owes the
  // frame nothing.
  const FLAGS: [head: string, pure: boolean, drawsRandom: boolean][] = [
    ['Random', false, true],
    ['RandomChoice', false, true],
    ['RandomSample', false, true],
    ['RandomShuffle', false, true],
    ['RandomPrime', false, true],
    // `WithRandomSeed` is the exception that proves the rule: it draws
    // nothing, it DELIMITS the frame (`frameProtocol: 'seed'`, which is what
    // `drawsRandom` reads) and DISCHARGES `random` on its held body. Its own
    // effects are therefore empty — and an application of it genuinely IS
    // referentially transparent: `WithRandomSeed(42, Random())` replays. The
    // expression-level answer comes from the projection, not from this flag
    // (`effects-of.test.ts`); the Stage 1 `pure: false` placeholder stood in
    // only until that channel existed.
    ['WithRandomSeed', true, true],
    ['RandomExpression', false, false],
  ];

  for (const [head, pure, drawsRandom] of FLAGS) {
    it(`${head} declares pure=${pure}, drawsRandom=${drawsRandom}`, () => {
      const def = ce.box([head]).operatorDefinition;
      expect(def).toBeDefined();
      expect(def!.pure).toBe(pure);
      expect(def!.drawsRandom).toBe(drawsRandom);
    });
  }

  it('RandomExpression is neither pure nor constant', () => {
    const expr = ce.box(['RandomExpression']);
    expect(expr.isPure).toBe(false);
    expect(expr.isConstant).toBe(false);
  });
});

describe('RandomPrime draws from the frame', () => {
  // `drawsRandom: true` is a promise that the head reads `ce._random()`, so a
  // frame replays it. Sampling `Math.random()` directly would pass every
  // distributional test and fail only this one.
  it('replays under WithRandomSeed', () => {
    const body = ['List', ['RandomPrime', 1000], ['RandomPrime', 1000]];
    const a = evaluate(['WithRandomSeed', 42, body]);
    const b = evaluate(['WithRandomSeed', 42, body]);
    expect(a).toEqual(b);
  });

  it('replays on the rejection-sampling path (n > MAX_SAFE_INTEGER)', () => {
    const big = 100_000_000_000_000_000_000_000n;
    const a = evaluate(['WithRandomSeed', 5, ['RandomPrime', big]]);
    const b = evaluate(['WithRandomSeed', 5, ['RandomPrime', big]]);
    expect(a).toEqual(b);
    expect(a).not.toMatch(/RandomPrime/); // it actually evaluated
  });

  it('is live outside any frame', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(evaluate(['RandomPrime', 100_000]));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Removed heads — the one-release tombstones are gone (0.96.0)', () => {
  // The Random-redesign tombstones threw `operator-removed` for exactly one
  // release (0.95.0), per the redesign's §9. They are now deleted: the
  // removed heads behave like any other unrecognized operator — a VALID,
  // INERT expression that evaluates to itself. This test pins the deletion
  // (a resurrected definition, tombstone or otherwise, would fail it).
  const REMOVED: [head: string, args: any[]][] = [
    ['RandomInteger', [1, 10]],
    ['RandomList', [3]],
    ['RandomSeed', [7]],
    ['Sample', [['List', 1, 2, 3], 2]],
    ['Shuffle', [['List', 1, 2, 3]]],
  ];

  for (const [head, args] of REMOVED) {
    it(`${head} is an ordinary unknown head — valid and inert`, () => {
      const expr = ce.box([head, ...args]);
      expect(expr.isValid).toBe(true);
      const result = expr.evaluate();
      expect(result.operator).toBe(head); // inert: evaluates to itself
    });
  }
});

//
// `RandomExpression` — an unrelated operator that generates random
// expressions, used as a fuzzer. Left skipped (it was skipped before this
// redesign too); kept here so the harness is not lost.
//

function checkLatexRoundtrip(): string | undefined {
  ce.forget('x');
  const expr = ce.expr(['RandomExpression']).evaluate();
  if (!expr.isValid) return expr.toString();
  const expr2 = ce.parse(expr.latex);
  if (!expr2.isSame(expr)) return expr.toString();
  return undefined;
}

function checkSimplification(): string | undefined {
  ce.forget('x');
  const expr = ce.expr(['RandomExpression']).evaluate();
  const simp = expr.simplify();

  for (let i = 0; i <= 100; i++) {
    ce.assign({ x: Math.random() * 2000 - 1000 });
    if (!expr.evaluate().isEqual(simp.evaluate())) return expr.toString();
  }
  ce.forget('x');
  return undefined;
}

describe.skip('RANDOM EXPRESSION', () => {
  for (let i = 50; i > 0; i--)
    test(`Checking expressions for LaTeX round-tripping`, () =>
      expect(checkLatexRoundtrip()).toBeUndefined());

  for (let i = 50; i > 0; i--)
    test(`Checking expressions for simplification`, () =>
      expect(checkSimplification()).toBeUndefined());
});
