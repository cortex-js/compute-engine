import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho items 93 and 94, filed against 0.95.1.
 *
 * **Item 93** — `Interval` did not survive a LaTeX round-trip, and the failure
 * was silent AND destructive. A closed `Interval(a, b)` serialized as
 * `\lbrack a, b\rbrack`, which the parser reads as a 2-element `List`; the
 * fully-open one serialized as `\lparen a, b\rparen`, read back as a
 * parenthesized `Sequence`. Under `RandomChoice` — the documented migration
 * target for the removed `RandomList(n)` — the substituted reading is still a
 * list of in-range numbers, so nothing downstream can detect that a uniform
 * real draw has become a Bernoulli pick of the two VALUES 0 and 1.
 *
 * The fix splits the two positions an interval can appear in:
 *
 * - a *set position* of a set operator (rhs of `\in`, either side of `\cup`, …)
 *   keeps the conventional bracket notation, because the operator forces the
 *   set reading when it is parsed back (`parsedIntervalOperand`);
 * - anywhere else the serialization must stand on its own, so it uses the two
 *   unambiguous bracket spellings where they exist (half-open American, ISO
 *   `]a, b[` for open) and the function form `\mathrm{Interval}(a, b)` for the
 *   closed interval, which has no unambiguous bracket notation — `[a, b]` is
 *   also how a 2-element list is written.
 *
 * **Item 94** — `ListFrom` had no compile handler. It is the only eager
 * materializer that works over an arbitrary collection body, which makes it the
 * documented escape from the lazy-view trap under `WithRandomSeed`: a frame
 * around a lazy comprehension has already exited by the time the view
 * materializes, so the draws escape it. That escape is only usable if the
 * materialized form also compiles.
 */

const OPEN_0_1 = ['Interval', ['Open', 0], ['Open', 1]];
const HALF_OPEN_0_1 = ['Interval', 0, ['Open', 1]];

/** Serialize non-canonically and read the LaTeX back the same way. */
function roundTrip(ce: ComputeEngine, json: any): any {
  const latex = ce.box(json, { canonical: false }).latex;
  return ce.parse(latex, { canonical: false }).json;
}

describe('Tycho item 93 — `Interval` survives a LaTeX round-trip', () => {
  describe('in a neutral position, every bound combination round-trips', () => {
    test.each([
      ['closed', ['Interval', 0, 1], '\\mathrm{Interval}(0, 1)'],
      ['open', OPEN_0_1, '\\rbrack0, 1\\lbrack'],
      ['closed-open', HALF_OPEN_0_1, '\\lbrack0, 1\\rparen'],
      ['open-closed', ['Interval', ['Open', 0], 1], '\\lparen0, 1\\rbrack'],
    ])('%s', (_label, json, expected) => {
      const ce = new ComputeEngine();
      expect(ce.box(json, { canonical: false }).latex).toBe(expected);
      expect(roundTrip(ce, json)).toEqual(json);
    });
  });

  test('an unbounded interval round-trips', () => {
    const ce = new ComputeEngine();
    const json = ['Interval', 0, 'PositiveInfinity'];
    expect(ce.box(json, { canonical: false }).latex).toBe(
      '\\mathrm{Interval}(0, \\infty)'
    );
    expect(roundTrip(ce, json)).toEqual(json);
  });

  test('the round trip is a fixpoint after a second cycle', () => {
    const ce = new ComputeEngine();
    for (const json of [['Interval', 0, 1], OPEN_0_1, HALF_OPEN_0_1]) {
      const once = ce.box(json, { canonical: false }).latex;
      const twice = ce.parse(once, { canonical: false }).latex;
      expect(twice).toBe(once);
    }
  });

  describe('the reported `RandomChoice` corruption', () => {
    // The filed repro: `RandomChoice(Interval(0,1), n)` stored as LaTeX came
    // back as `RandomChoice(List(0,1), n)` — a uniform draw silently demoted to
    // a pick between the values 0 and 1.
    test.each([
      ['closed', ['Interval', 0, 1]],
      ['open', OPEN_0_1],
      ['half-open', HALF_OPEN_0_1],
    ])('%s interval survives as a `RandomChoice` argument', (_label, domain) => {
      const ce = new ComputeEngine();
      const json = ['RandomChoice', domain, 'n'];
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a round-tripped uniform draw is still uniform, not Bernoulli', () => {
      const ce = new ComputeEngine();
      const latex = ce.box(['RandomChoice', ['Interval', 0, 1], 20], {
        canonical: false,
      }).latex;
      const draws = ce
        .parse(latex)
        .evaluate()
        .ops!.map((x) => x.re);

      expect(draws).toHaveLength(20);
      for (const d of draws) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
      }
      // The corrupted `List(0, 1)` reading can only ever yield 0 or 1.
      expect(draws.some((d) => d !== 0 && d !== 1)).toBe(true);
    });

    test('a genuine `List` domain is still a pick between its values', () => {
      // The set-position spelling must not make every bracket pair an
      // interval: a directly-constructed `List` stays a collection.
      const ce = new ComputeEngine();
      const draws = ce
        .box(['RandomChoice', ['List', 0, 1], 12])
        .evaluate()
        .ops!.map((x) => x.re);
      expect(draws.every((d) => d === 0 || d === 1)).toBe(true);
    });
  });

  describe('a set operator keeps the conventional bracket notation', () => {
    // These are the positions where the parse side restores the set reading,
    // so the ambiguous — but readable — spelling is safe.
    test.each([
      ['Element', ['Element', 'x', ['Interval', 0, 1]], 'x\\in\\lbrack0, 1\\rbrack'],
      [
        'Element, open',
        ['Element', 'x', OPEN_0_1],
        'x\\in\\lparen0, 1\\rparen',
      ],
      [
        'NotElement',
        ['NotElement', 'x', ['Interval', 0, 1]],
        'x\\notin\\lbrack0, 1\\rbrack',
      ],
      [
        'Union',
        ['Union', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\cup\\lbrack2, 3\\rbrack',
      ],
      [
        'Intersection',
        ['Intersection', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\cap\\lbrack2, 3\\rbrack',
      ],
      [
        'SetMinus',
        ['SetMinus', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\setminus\\lbrack2, 3\\rbrack',
      ],
      [
        'Subset',
        ['Subset', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\subset\\lbrack2, 3\\rbrack',
      ],
      [
        'SubsetEqual',
        ['SubsetEqual', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\subseteq\\lbrack2, 3\\rbrack',
      ],
      [
        'Superset',
        ['Superset', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\supset\\lbrack2, 3\\rbrack',
      ],
      [
        'SupersetEqual',
        ['SupersetEqual', ['Interval', 0, 1], ['Interval', 2, 3]],
        '\\lbrack0, 1\\rbrack\\supseteq\\lbrack2, 3\\rbrack',
      ],
    ])('%s', (_label, json, expected) => {
      const ce = new ComputeEngine();
      expect(ce.box(json, { canonical: false }).latex).toBe(expected);
      // ...and it still round-trips, because the operator forces the reading.
      expect(roundTrip(ce, json)).toEqual(json);
    });
  });

  describe('the set-aware serializer leaves non-interval operands alone', () => {
    test.each([
      ['Element', ['Element', 'x', 'RealNumbers'], 'x\\in\\R'],
      [
        'Element of a sum',
        ['Element', ['Add', 'x', 1], 'Integers'],
        'x+1\\in\\Z',
      ],
      [
        'Union of sets',
        ['Union', ['Set', 1, 2], ['Set', 3]],
        '\\lbrace1, 2\\rbrace\\cup\\lbrace3\\rbrace',
      ],
      ['Subset of symbols', ['Subset', 'A', 'B'], 'A\\subset B'],
    ])('%s', (_label, json, expected) => {
      const ce = new ComputeEngine();
      expect(ce.box(json, { canonical: false }).latex).toBe(expected);
      expect(roundTrip(ce, json)).toEqual(json);
    });
  });
});

describe('Tycho item 94 — `ListFrom` compiles', () => {
  /** Compile, refusing the interpreter fallback so a missing handler is loud. */
  function compiled(ce: ComputeEngine, json: any) {
    const r = compile(ce.box(json), { fallback: false });
    expect(r?.success).toBe(true);
    return r!;
  }

  test.each([
    ['a single collection', ['ListFrom', ['List', 1, 2, 3]], [1, 2, 3]],
    ['a collection and a scalar', ['ListFrom', ['List', 1, 2], 3], [1, 2, 3]],
    ['two collections', ['ListFrom', ['List', 1, 2], ['List', 3]], [1, 2, 3]],
    ['scalars only', ['ListFrom', 1, 2, 3], [1, 2, 3]],
    ['a lazy range', ['ListFrom', ['Range', 1, 4]], [1, 2, 3, 4]],
  ])('%s', (_label, json, expected) => {
    const ce = new ComputeEngine();
    expect(compiled(ce, json).run!()).toEqual(expected);
  });

  test('compiles from parsed LaTeX (the filed repro)', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\mathrm{ListFrom}(\\lbrack1,2,3\\rbrack)'), {
      fallback: false,
    });
    expect(r?.success).toBe(true);
    expect(r!.run!()).toEqual([1, 2, 3]);
  });

  test('materializes a comprehension inside a `WithRandomSeed` frame, matching the interpreter', () => {
    // The point of the item: a frame around the LAZY comprehension does not
    // replay, because the view materializes after the frame has exited.
    // `ListFrom` makes it eager, and the compiled form must agree with the
    // interpreter draw-for-draw.
    const ce = new ComputeEngine();
    const json = [
      'WithRandomSeed',
      12345,
      [
        'ListFrom',
        ['Comprehension', ['Random'], ['Element', 'k', ['Range', 1, 6]]],
      ],
    ];

    const interpreted = ce
      .box(json)
      .evaluate()
      .N()
      .ops!.map((x) => x.re);
    const r = compiled(ce, json);
    const first = r.run!() as number[];

    expect(first).toHaveLength(6);
    expect(first).toEqual(interpreted);
    // The frame replays: a second call reproduces the same stream.
    expect(r.run!()).toEqual(first);
  });
});
