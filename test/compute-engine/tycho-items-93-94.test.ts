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
    ])(
      '%s interval survives as a `RandomChoice` argument',
      (_label, domain) => {
        const ce = new ComputeEngine();
        const json = ['RandomChoice', domain, 'n'];
        expect(roundTrip(ce, json)).toEqual(json);
      }
    );

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
      [
        'Element',
        ['Element', 'x', ['Interval', 0, 1]],
        'x\\in\\lbrack0, 1\\rbrack',
      ],
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

/**
 * The mirror image of item 93, ruled 2026-08-12: with the set positions
 * reading a bracket pair as an interval, a genuine TWO-element `List` domain
 * had no faithful spelling there — `Element(i, List(1, 2))` serialized as
 * `i\in\lbrack1, 2\rbrack` and came back as `Element(i, Interval(1, 2))`, a
 * different value class ("i is one of two points" became "i is anywhere
 * between them"). Only length 2 collides; lists of any other length are
 * unambiguous.
 *
 * The ruling: a membership position spells a two-element list domain
 * `\operatorname{List}(1, 2)`; everything else keeps bracket notation, and
 * `\in\lbrack a, b\rbrack` still READS as an interval.
 */
describe('a two-element `List` domain survives a LaTeX round-trip', () => {
  test.each([
    [
      'Element',
      ['Element', 'n', ['List', 1, 2]],
      'n\\in\\operatorname{List}(1, 2)',
    ],
    [
      'NotElement',
      ['NotElement', 'n', ['List', 1, 2]],
      'n\\notin\\operatorname{List}(1, 2)',
    ],
    [
      'symbolic elements',
      ['Element', 'n', ['List', 'a', 'b']],
      'n\\in\\operatorname{List}(a, b)',
    ],
  ])('%s', (_label, json, expected) => {
    const ce = new ComputeEngine();
    expect(ce.box(json, { canonical: false }).latex).toBe(expected);
    expect(roundTrip(ce, json)).toEqual(json);
  });

  test('the round trip is a fixpoint after a second cycle', () => {
    const ce = new ComputeEngine();
    const once = ce.box(['Element', 'n', ['List', 1, 2]], {
      canonical: false,
    }).latex;
    expect(ce.parse(once, { canonical: false }).latex).toBe(once);
  });

  test('the round-tripped membership keeps the list VALUE class', () => {
    // The point of the fix: 1.5 is between 1 and 2 but is not one of them.
    const ce = new ComputeEngine();
    const json = ['Element', 1.5, ['List', 1, 2]];
    expect(ce.box(json).evaluate().toString()).toBe('"False"');
    const latex = ce.box(json, { canonical: false }).latex;
    expect(ce.parse(latex).evaluate().toString()).toBe('"False"');
  });

  describe('other domains keep their spelling', () => {
    test.each([
      // Only a PAIR collides with interval notation.
      [
        'one element',
        ['Element', 'n', ['List', 1]],
        'n\\in\\bigl\\lbrack1\\bigr\\rbrack',
      ],
      [
        'three elements',
        ['Element', 'n', ['List', 1, 2, 3]],
        'n\\in\\bigl\\lbrack1, 2, 3\\bigr\\rbrack',
      ],
      [
        'a closed interval',
        ['Element', 'n', ['Interval', 1, 2]],
        'n\\in\\lbrack1, 2\\rbrack',
      ],
      ['a range', ['Element', 'n', ['Range', 1, 2]], 'n\\in1..2'],
      ['a set', ['Element', 'n', ['Set', 1, 2]], 'n\\in\\lbrace1, 2\\rbrace'],
      ['a symbol', ['Element', 'n', 'Integers'], 'n\\in\\Z'],
      // The residue of the same collision, fixed 2026-08-12: EVERY set
      // position — not just a membership domain — spells a two-element list
      // operand `\operatorname{List}(a, b)`. (This row previously pinned the
      // unfixed state, `\bigl\lbrack1, 2\bigr\rbrack\cup…`.)
      [
        'a union of two-element lists',
        ['Union', ['List', 1, 2], ['List', 3, 4]],
        '\\operatorname{List}(1, 2)\\cup\\operatorname{List}(3, 4)',
      ],
    ])('%s', (_label, json, expected) => {
      const ce = new ComputeEngine();
      expect(ce.box(json, { canonical: false }).latex).toBe(expected);
    });
  });

  describe('the bracket spelling still READS as an interval', () => {
    test.each([
      ['\\lbrack', 'n\\in\\lbrack1, 2\\rbrack'],
      ['sized brackets', 'n\\in\\bigl\\lbrack1, 2\\bigr\\rbrack'],
      ['\\left[', 'n\\in \\left[1, 2\\right]'],
      // `\mleft`/`\mright` (mleftright package) is an open-delimiter prefix the
      // parser accepts like `\left`, so the probe has to see through it too.
      ['\\mleft[', 'n\\in\\mleft[1, 2\\mright]'],
      ['plain brackets', 'n\\in[1, 2]'],
    ])('%s', (_label, latex) => {
      const ce = new ComputeEngine();
      expect(ce.parse(latex, { canonical: false }).json).toEqual([
        'Element',
        'n',
        ['Interval', 1, 2],
      ]);
    });

    test('a `\\mleft` paren pair is an OPEN interval', () => {
      const ce = new ComputeEngine();
      expect(
        ce.parse('n\\in\\mleft(1, 2\\mright)', { canonical: false }).json
      ).toEqual(['Element', 'n', ['Interval', ['Open', 1], ['Open', 2]]]);
    });

    test('a `\\mleft` bracket of any other length stays a `List`', () => {
      const ce = new ComputeEngine();
      for (const [latex, expected] of [
        ['n\\in\\mleft[1\\mright]', ['List', 1]],
        ['n\\in\\mleft[1, 2, 3\\mright]', ['List', 1, 2, 3]],
      ] as [string, any][])
        expect(ce.parse(latex, { canonical: false }).json).toEqual([
          'Element',
          'n',
          expected,
        ]);
    });
  });

  describe('in a binder position', () => {
    test('a big-op indexing set round-trips', () => {
      const ce = new ComputeEngine();
      const json = ['Sum', ['Power', 'n', 2], ['Element', 'n', ['List', 1, 2]]];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        '\\sum_{n\\in \\operatorname{List}(1, 2)}n^2'
      );
      expect(roundTrip(ce, json)).toEqual(json);
      // …and sums the two VALUES (1 + 4), rather than an interval.
      expect(ce.parse(ce.box(json).latex).evaluate().toString()).toBe('5');
    });

    test('an indexing set of any other length is unchanged', () => {
      const ce = new ComputeEngine();
      const json = [
        'Sum',
        ['Power', 'n', 2],
        ['Element', 'n', ['List', 1, 2, 3]],
      ];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        '\\sum_{n\\in \\bigl\\lbrack1, 2, 3\\bigr\\rbrack}n^2'
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a `Loop` domain round-trips', () => {
      const ce = new ComputeEngine();
      const json = [
        'Loop',
        ['Function', 'n', 'n'],
        ['Element', 'n', ['List', 1, 2]],
      ];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        '\\operatorname{Loop}(n\\mapsto n, n\\in\\operatorname{List}(1, 2))'
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a `Comprehension` domain uses the `for n = …` spelling', () => {
      // Not a membership position: the comprehension binder spells its domain
      // after `=`, which reads back as a list. Unchanged by the ruling.
      const ce = new ComputeEngine();
      const json = [
        'Comprehension',
        ['Power', 'n', 2],
        ['Element', 'n', ['List', 1, 2]],
      ];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        '\\left[n^2 \\operatorname{for} n = \\bigl\\lbrack1, 2\\bigr\\rbrack\\right]'
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a `ForAll` domain round-trips', () => {
      const ce = new ComputeEngine();
      const json = [
        'ForAll',
        ['Element', 'n', ['List', 1, 2]],
        ['Greater', 'n', 0],
      ];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        '\\forall n\\in\\operatorname{List}(1, 2), n\\gt0'
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });
  });
});

/**
 * The residue of the same collision, ruled and fixed 2026-08-12: the
 * NON-membership set operators re-read a two-element list operand as an
 * interval too, on BOTH sides (`Union(List(1, 2), X)` serialized
 * `\bigl\lbrack1, 2\bigr\rbrack\cup X` and came back
 * `Union(Interval(1, 2), X)`).
 *
 * The serialize side is the same ruling widened: every SET position — not only
 * a membership domain — spells a two-element list `\operatorname{List}(a, b)`.
 *
 * The parse side needed a new mechanism. The rhs token-peek gate could not be
 * reused for the lhs, which an infix parselet receives already parsed: the
 * parser now exposes `operandStartIndex`, the token position the innermost
 * `parseExpression` began its left operand at (mirroring the existing
 * `operandDiagnosticCheckpoint` hook), so the lhs can be probed for the same
 * open-bracket token. Authored bracket spellings keep their interval reading
 * on both sides.
 */
describe('a two-element `List` survives a round-trip through a set operator', () => {
  /** Drop `Delimiter` wrappers, recursively — parenthesization is not the
   * subject of these tests (see the notes at the two call sites). */
  const stripDelimiter = (json: any): any => {
    if (!Array.isArray(json)) return json;
    if (json[0] === 'Delimiter' && json.length === 2)
      return stripDelimiter(json[1]);
    return [json[0], ...json.slice(1).map(stripDelimiter)];
  };

  // Every operator sharing the `sides: 'both'` parselet.
  const OPERATORS: [string, string][] = [
    ['Union', '\\cup'],
    ['Intersection', '\\cap'],
    ['SetMinus', '\\setminus'],
    ['Subset', '\\subset'],
    ['SubsetEqual', '\\subseteq'],
    ['Superset', '\\supset'],
    ['SupersetEqual', '\\supseteq'],
    // `\triangle` had a dictionary entry with neither handler, so it neither
    // read its bracket operands as intervals nor spelled a two-element list
    // operand `\operatorname{List}(a, b)`. Completed 2026-08-12 by wiring it to
    // the same pair of handlers as its siblings.
    ['SymmetricDifference', '\\triangle'],
  ];

  describe.each(OPERATORS)('%s', (op, latex) => {
    test('a two-element list on the LEFT', () => {
      const ce = new ComputeEngine();
      const json = [op, ['List', 1, 2], 'X'];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        `\\operatorname{List}(1, 2)${latex} X`
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a two-element list on the RIGHT', () => {
      const ce = new ComputeEngine();
      const json = [op, 'X', ['List', 1, 2]];
      expect(ce.box(json, { canonical: false }).latex).toBe(
        `X${latex}\\operatorname{List}(1, 2)`
      );
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('a two-element list on BOTH sides', () => {
      const ce = new ComputeEngine();
      const json = [op, ['List', 1, 2], ['List', 3, 4]];
      expect(roundTrip(ce, json)).toEqual(json);
    });

    test('nested inside a membership domain', () => {
      const ce = new ComputeEngine();
      const json = ['Element', 'x', [op, ['List', 1, 2], 'Y']];
      // Pre-existing and unrelated to this fix: the `\subset` family binds
      // LOOSER than `\in` (240 vs 241), so its serialization is parenthesized
      // and comes back wrapped in a `Delimiter`. Unwrap it to compare the
      // operand, which is what this fix is about.
      expect(stripDelimiter(roundTrip(ce, json))).toEqual(json);
    });

    test('lists of any other length keep bracket notation', () => {
      const ce = new ComputeEngine();
      for (const list of [
        ['List', 1],
        ['List', 1, 2, 3],
      ]) {
        const json = [op, list, 'X'];
        expect(ce.box(json, { canonical: false }).latex).toContain(
          '\\bigl\\lbrack'
        );
        expect(roundTrip(ce, json)).toEqual(json);
      }
    });

    test('genuine `Interval`/`Set`/`Range` operands are unchanged', () => {
      const ce = new ComputeEngine();
      for (const [domain, expected] of [
        [['Interval', 1, 2], '\\lbrack1, 2\\rbrack'],
        [['Set', 1, 2], '\\lbrace1, 2\\rbrace'],
      ] as [any, string][]) {
        const json = [op, domain, 'X'];
        expect(ce.box(json, { canonical: false }).latex).toBe(
          `${expected}${latex} X`
        );
        expect(roundTrip(ce, json)).toEqual(json);
      }
      // Pre-existing and unrelated to this fix: `\cup` and kin bind tighter
      // than `..`, so a `Range` operand is parenthesized and comes back
      // wrapped in a `Delimiter`. The `Range` itself is preserved.
      expect(stripDelimiter(roundTrip(ce, [op, ['Range', 1, 5], 'X']))).toEqual(
        [op, ['Range', 1, 5], 'X']
      );
    });
  });

  describe('the bracket spelling still READS as an interval on either side', () => {
    test.each([
      ['\\lbrack, lhs', '\\lbrack1, 2\\rbrack\\cup X', 1],
      ['\\lbrack, rhs', 'X\\cup\\lbrack1, 2\\rbrack', 2],
      ['plain brackets, lhs', '[1, 2]\\cap X', 1],
      ['sized brackets, lhs', '\\bigl\\lbrack1, 2\\bigr\\rbrack\\subset X', 1],
      ['\\left[, lhs', '\\left[1, 2\\right]\\setminus X', 1],
      ['grouped, lhs', '{[1, 2]}\\cup X', 1],
      [
        '\\mathopen, lhs',
        '\\mathopen\\lbrack1, 2\\mathclose\\rbrack\\cup X',
        1,
      ],
      ['\\mleft[, lhs', '\\mleft[1, 2\\mright]\\cup X', 1],
      ['\\mleft[, rhs', 'X\\cup\\mleft[1, 2\\mright]', 2],
      ['\\triangle, lhs', '\\lbrack1, 2\\rbrack\\triangle X', 1],
      ['\\triangle, rhs', 'X\\triangle\\lbrack1, 2\\rbrack', 2],
    ])('%s', (_label, latex, position) => {
      const ce = new ComputeEngine();
      const json = ce.parse(latex, { canonical: false }).json as any;
      expect(json[position]).toEqual(['Interval', 1, 2]);
    });

    test('a parenthesized pair is still an OPEN interval', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('(1, 2)\\cup X', { canonical: false }).json).toEqual([
        'Union',
        ['Interval', ['Open', 1], ['Open', 2]],
        'X',
      ]);
    });
  });

  describe('the named spelling stays a `List` in the other parselets', () => {
    test('`\\ni` (the collection is the lhs)', () => {
      const ce = new ComputeEngine();
      expect(
        ce.parse('\\operatorname{List}(1, 2)\\ni x', { canonical: false }).json
      ).toEqual(['Element', 'x', ['List', 1, 2]]);
      expect(
        ce.parse('\\lbrack1, 2\\rbrack\\ni x', { canonical: false }).json
      ).toEqual(['Element', 'x', ['Interval', 1, 2]]);
    });

    test('`\\not\\subseteq`', () => {
      const ce = new ComputeEngine();
      expect(
        ce.parse('\\operatorname{List}(1, 2)\\not\\subseteq X', {
          canonical: false,
        }).json
      ).toEqual(['Not', ['SubsetEqual', ['List', 1, 2], 'X']]);
      expect(
        ce.parse('\\lbrack1, 2\\rbrack\\not\\subseteq X', { canonical: false })
          .json
      ).toEqual(['Not', ['SubsetEqual', ['Interval', 1, 2], 'X']]);
    });

    test('the Unicode glyph aliases (∪, ∩)', () => {
      const ce = new ComputeEngine();
      expect(
        ce.parse('\\operatorname{List}(1, 2)∪X', { canonical: false }).json
      ).toEqual(['Union', ['List', 1, 2], 'X']);
      expect(
        ce.parse('\\lbrack1, 2\\rbrack∩X', { canonical: false }).json
      ).toEqual(['Intersection', ['Interval', 1, 2], 'X']);
    });
  });

  test('the round-tripped union keeps the list VALUE class', () => {
    // The point of the fix: 1.5 is between 1 and 2 but is not one of them.
    const ce = new ComputeEngine();
    const json = ['Element', 1.5, ['Union', ['List', 1, 2], ['List', 3, 4]]];
    expect(ce.box(json).evaluate().toString()).toBe('"False"');
    const latex = ce.box(json, { canonical: false }).latex;
    expect(ce.parse(latex).evaluate().toString()).toBe('"False"');
  });
});
