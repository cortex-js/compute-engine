import { engine as ce } from '../utils';

import { _forTesting } from '../../src/compute-engine/boxed-expression/match-dispatch';

import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 2 of the Epsil `match` design
 * (docs/LANGUAGE-MODEL.md §4): the classification ladder.
 *
 * Each case is classified once into a tier (0 constant dispatch / 1 literal
 * chain / 2 fixed-shape destructuring / 3 general matcher) and the dispatch
 * plan is cached. Tiers 0–2 must be *observationally identical* to the tier-3
 * reference (`evaluateMatchReference`).
 */

const { getMatchPlan, evaluateMatchReference } = _forTesting;

/** The cached classification plan for a `Match` MathJSON expression. */
function planOf(expr: MathJsonExpression) {
  const M = ce.box(expr).canonical;
  return getMatchPlan(ce, M.ops!);
}

/** Laddered result string. */
function ladder(expr: MathJsonExpression): string {
  return ce.box(expr).evaluate().toString();
}

/** Pure tier-3 (reference) result string. */
function reference(expr: MathJsonExpression): string {
  const M = ce.box(expr).canonical;
  return evaluateMatchReference(M.ops!, { engine: ce }).toString();
}

// ─── Fast-path classification evidence ──────────────────────────────────────

describe('MATCH ladder — tier-0 constant dispatch', () => {
  it('classifies 20 integer-constant cases as one tier-0 dispatch of 20 keys', () => {
    const cases: MathJsonExpression = ['Match', 'x'];
    for (let i = 0; i < 20; i++)
      (cases as unknown[]).push(['MatchCase', i, { str: `k${i}` }]);
    const plan = planOf(cases);

    expect(plan.segments).toHaveLength(1);
    const seg = plan.segments[0];
    expect(seg.kind).toBe('dispatch');
    if (seg.kind === 'dispatch') {
      expect(seg.table.size).toBe(20);
      expect(seg.cases.every((c) => c.tier === 0)).toBe(true);
    }
  });

  it('`1 | 2 | == Pi` adds three keys pointing at one case index', () => {
    // `== Pi` lowers to a bare constant symbol `Pi` (the matcher treats a
    // non-wildcard symbol verbatim). All three alternatives are tier-0.
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['Alternatives', 1, 2, 'Pi'], { str: 'small-or-pi' }],
      ['MatchCase', '_', { str: 'other' }],
    ]);
    const seg = plan.segments[0];
    expect(seg.kind).toBe('dispatch');
    if (seg.kind === 'dispatch') {
      expect([...seg.table.entries()].sort()).toEqual([
        ['n:1', 0],
        ['n:2', 0],
        ['sym:Pi', 0],
      ]);
    }
  });

  it('`0 | 0.5` classifies the whole case at the weakest tier (tier 1)', () => {
    // A float alternative is not dispatch-safe (exactness contract), so the
    // mixed alternative falls to tier 1 — no per-alternative splitting in v1.
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['Alternatives', 0, 0.5], { str: 'zeroish' }],
    ]);
    expect(plan.segments[0].kind).toBe('chain');
    expect(plan.segments[0].cases[0].tier).toBe(1);
  });

  it('a guard demotes a constant case out of tier 0 (into tier 1)', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', 2, ['Greater', 'unused', 0], { str: 'two' }],
    ]);
    expect(plan.segments[0].kind).toBe('chain');
    expect(plan.segments[0].cases[0].tier).toBe(1);
  });

  it('a float/rational literal is tier 1, not tier 0', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', 0.5, { str: 'half' }],
      ['MatchCase', ['Rational', 1, 2], { str: 'exact-half' }],
    ]);
    // 0.5 → tier 1; Rational(1,2) held raw is an operator pattern → tier 3.
    expect(plan.segments[0].cases[0].tier).toBe(1);
  });
});

describe('MATCH ladder — tier-2 fixed-shape classification', () => {
  it('classifies a list-destructuring case as tier 2', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['List', '_a', '_b'], ['Add', 'a', 'b']],
    ]);
    expect(plan.segments[0].cases[0].tier).toBe(2);
  });

  it('a non-linear repeated name in a shape falls to tier 3', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['List', '_a', '_a'], { str: 'eq' }],
    ]);
    expect(plan.segments[0].cases[0].tier).toBe(3);
  });

  it('a simple Dictionary pattern (binding/literal values) classifies tier 2', () => {
    const plan = planOf([
      'Match',
      'x',
      [
        'MatchCase',
        ['Dictionary', ['KeyValuePair', { str: 'k' }, '_v']],
        'v',
      ],
    ]);
    expect(plan.segments[0].cases[0].tier).toBe(2);
  });

  it('a Dictionary pattern with a sequence value falls to tier 3', () => {
    const plan = planOf([
      'Match',
      'x',
      [
        'MatchCase',
        ['Dictionary', ['KeyValuePair', { str: 'k' }, '__seq']],
        { str: 'no' },
      ],
    ]);
    expect(plan.segments[0].cases[0].tier).toBe(3);
  });
});

describe('MATCH ladder — segmentation preserves first-match-wins', () => {
  it('a tier-3 case in the middle does not degrade the tier-0 prefix', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', 1, { str: 'one' }],
      ['MatchCase', ['Add', '_a', '_b'], 'a'],
      ['MatchCase', '_', { str: 'other' }],
    ]);
    expect(plan.segments.map((s) => s.kind)).toEqual(['dispatch', 'chain']);
    const dispatch = plan.segments[0];
    if (dispatch.kind === 'dispatch') expect(dispatch.table.size).toBe(2);
    // The tier-3 `Add` and the trailing `_` share the tail chain.
    expect(plan.segments[1].cases.map((c) => c.tier)).toEqual([3, 3]);
  });

  it('selects the correct case across mixed tiers', () => {
    const mixed = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', 0, { str: 'zero' }],
      ['MatchCase', ['List', '_a', '_b'], { str: 'pair' }],
      ['MatchCase', ['Add', '__t'], { str: 'sum' }],
      ['MatchCase', '_', { str: 'other' }],
    ];
    expect(ladder(mixed(0))).toBe('"zero"');
    expect(ladder(mixed(['List', 1, 2]))).toBe('"pair"');
    expect(ladder(mixed(['Add', ['Multiply', 2, 'x'], 1]))).toBe('"sum"');
    expect(ladder(mixed(5))).toBe('"other"');
  });
});

// ─── Faithfulness of the fast tiers vs the tier-3 reference ──────────────────

describe('MATCH ladder — number equality follows the matcher (isEqual)', () => {
  it('an exact 1/3 matches a float pattern within tolerance (as tier 3 does)', () => {
    const expr: MathJsonExpression = [
      'Match',
      ['Rational', 1, 3],
      ['MatchCase', 0.3333333333333333, { str: 'hit' }],
      ['MatchCase', '_', { str: 'miss' }],
    ];
    expect(ladder(expr)).toBe('"hit"');
    expect(ladder(expr)).toBe(reference(expr));
  });

  it('a near-integer float subject dispatches to an integer constant via the fallback scan', () => {
    const expr: MathJsonExpression = [
      'Match',
      2.0000000001,
      ['MatchCase', 1, { str: 'a' }],
      ['MatchCase', 2, { str: 'b' }],
      ['MatchCase', '_', { str: 'no' }],
    ];
    expect(ladder(expr)).toBe('"b"');
    expect(ladder(expr)).toBe(reference(expr));
  });
});

describe('MATCH ladder — closures are cached but keep lexical late binding', () => {
  it('a Match inside a function body evaluates correctly on repeated calls with a changing free variable', () => {
    ce.assign('matchLadderBase', 1000);
    const f = ce.box([
      'Function',
      [
        'Match',
        'x',
        ['MatchCase', 0, { str: 'zero' }],
        ['MatchCase', '_n', ['Add', 'n', 'matchLadderBase']],
      ],
      'x',
    ]);
    ce.assign('matchLadderF', f);

    expect(ce.box(['matchLadderF', 0]).evaluate().toString()).toBe('"zero"');
    expect(ce.box(['matchLadderF', 5]).evaluate().toString()).toBe('1005');
    ce.assign('matchLadderBase', 2000);
    expect(ce.box(['matchLadderF', 5]).evaluate().toString()).toBe('2005');
    expect(ce.box(['matchLadderF', 7]).evaluate().toString()).toBe('2007');
  });

  it('constant-name shadowing (`e`) still works through the ladder', () => {
    expect(ladder(['Match', 5, ['MatchCase', '_e', ['Multiply', 2, 'e']]])).toBe(
      '10'
    );
  });
});

describe('MATCH ladder — range patterns classify tier 1', () => {
  it('classifies a range case as a binding-free tier-1 predicate', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['Range', 1, 10], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ]);
    const cases = plan.segments.flatMap((s) => s.cases);
    expect(cases[0].tier).toBe(1);
    expect(cases[0].captureKeys).toEqual([]);
    expect(cases[0].tests).toEqual([
      { kind: 'range', lo: expect.anything(), hi: expect.anything() },
    ]);
  });

  it('does not degrade a preceding tier-0 dispatch prefix', () => {
    // The three integer constants stay one tier-0 dispatch segment; the range
    // case opens a following tier-1 chain segment.
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', 1, { str: 'a' }],
      ['MatchCase', 2, { str: 'b' }],
      ['MatchCase', 3, { str: 'c' }],
      ['MatchCase', ['Range', 10, 20], { str: 'r' }],
      ['MatchCase', '_', { str: 'z' }],
    ]);
    expect(plan.segments.map((s) => s.kind)).toEqual(['dispatch', 'chain']);
    const dispatch = plan.segments[0];
    expect(dispatch.kind).toBe('dispatch');
    if (dispatch.kind === 'dispatch') expect(dispatch.table.size).toBe(3);
    expect(plan.segments[1].cases.map((c) => c.tier)).toEqual([1, 3]);
  });

  it('an or-alternative of ranges is one tier-1 case with two tests', () => {
    const plan = planOf([
      'Match',
      'x',
      [
        'MatchCase',
        ['Alternatives', ['Range', 0, 9], ['Range', 100, 109]],
        { str: 'in' },
      ],
    ]);
    const cases = plan.segments.flatMap((s) => s.cases);
    expect(cases[0].tier).toBe(1);
    expect(cases[0].tests).toHaveLength(2);
    expect(cases[0].tests!.every((t) => t.kind === 'range')).toBe(true);
  });

  it('a `Range` with non-literal bounds stays a tier-3 structural pattern', () => {
    const plan = planOf([
      'Match',
      'x',
      ['MatchCase', ['Range', '_a', 10], 'a'],
    ]);
    expect(plan.segments.flatMap((s) => s.cases)[0].tier).toBe(3);
  });

  it('the laddered result equals the tier-3 reference on range cases', () => {
    const expr = (subj: MathJsonExpression): MathJsonExpression => [
      'Match',
      subj,
      ['MatchCase', ['Range', 1, 10], { str: 'in' }],
      ['MatchCase', '_', { str: 'out' }],
    ];
    for (const s of [
      0,
      1,
      5,
      10,
      11,
      0.5,
      ['Rational', 3, 2],
      ['Sqrt', 2],
      'x',
      'Pi',
      ['List', 1, 2],
      ['Range', 1, 10],
      NaN,
      { num: '+Infinity' },
    ] as MathJsonExpression[])
      expect(ladder(expr(s))).toBe(reference(expr(s)));
  });
});

// ─── Property test: laddered ≡ tier-3 reference ──────────────────────────────

describe('MATCH ladder — property: laddered result ≡ tier-3 reference', () => {
  /** Deterministic seeded PRNG (mulberry32). */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  beforeAll(() => {
    ce.assign('matchPinA', 6);
    ce.assign('matchPinB', 'foo');
  });

  it('agrees on several hundred randomized (subject, cases) combinations', () => {
    const rng = mulberry32(0x5eed1234);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];

    const subjects: MathJsonExpression[] = [
      0,
      1,
      2,
      3,
      5,
      -2,
      0.5,
      1.5,
      2.0,
      6,
      'Pi',
      'ExponentialE',
      'x',
      { str: 'foo' },
      { str: 'bar' },
      ['Rational', 3, 2],
      ['Sqrt', 2],
      { num: '+Infinity' },
      ['Range', 1, 10],
      ['List', 0, 9],
      ['List', 1, 2, 3],
      ['List'],
      ['Tuple', 3, 4],
      ['Add', 'x', 1],
      ['Add', ['Multiply', 2, 'x'], 1],
      ['Dictionary', ['KeyValuePair', { str: 'x' }, 1]],
      ['Dictionary', ['KeyValuePair', { str: 'x' }, 1], ['KeyValuePair', { str: 'y' }, 2]],
    ];

    // Each generator returns [pattern, wantsGuard, bindsN, isCatchAll].
    type Gen = () => {
      pattern: MathJsonExpression;
      body: MathJsonExpression;
      guard?: MathJsonExpression;
    };

    const gens: Gen[] = [
      // tier 0: integer / string / constant symbol
      () => ({ pattern: pick([0, 1, 2, 3, 5, -2]), body: { str: 'lit' } }),
      () => ({ pattern: pick([{ str: 'foo' }, { str: 'bar' }]), body: { str: 's' } }),
      () => ({ pattern: pick(['Pi', 'ExponentialE']), body: { str: 'const' } }),
      // tier 0/1: alternatives
      () => ({ pattern: ['Alternatives', 1, 2, 3], body: { str: 'alt' } }),
      () => ({ pattern: ['Alternatives', 0, 0.5], body: { str: 'altf' } }),
      // tier 1: float, pins
      () => ({ pattern: pick([0.5, 1.5, 2.0]), body: { str: 'flt' } }),
      // tier 1: range patterns (membership), incl. negative and infinite bounds
      () => ({
        pattern: pick([
          ['Range', 0, 3],
          ['Range', 1, 10],
          ['Range', -2, 0],
          ['Range', 0, { num: '+Infinity' }],
          ['Range', { num: '-Infinity' }, 2],
          ['Range', 2, 2],
        ] as MathJsonExpression[]),
        body: { str: 'rng' },
      }),
      () => ({
        pattern: ['Alternatives', ['Range', 0, 1], ['Range', 5, 6]],
        body: { str: 'rngalt' },
      }),
      // a `Range` with non-literal bounds is NOT a range pattern: it stays a
      // structural (tier-3) operator pattern on both paths
      () => ({ pattern: ['Range', '_a', 10], body: 'a' }),
      () => ({ pattern: ['Pin', 'matchPinA'], body: { str: 'pinA' } }),
      () => ({ pattern: ['Pin', 'matchPinB'], body: { str: 'pinB' } }),
      () => ({ pattern: ['Pin', ['Add', 2, 4]], body: { str: 'pin6' } }),
      // tier 2: shapes
      () => ({ pattern: ['List', '_a', '_b'], body: ['List', 'a', 'b'] }),
      () => ({ pattern: ['List', '_a', '___rest'], body: 'rest' }),
      () => ({ pattern: ['List', 0, '_x'], body: 'x' }),
      () => ({ pattern: ['Tuple', '_a', '_b'], body: ['Add', 'a', 'b'] }),
      () => ({
        pattern: ['List', ['List', '_a', '_b'], '_c'],
        body: ['List', 'a', 'b', 'c'],
      }),
      // tier 2: dictionary shapes (matched by the dedicated dict matcher on both
      // the tier-2 and tier-3 paths — this is the tier-2≡tier-3 dict check)
      () => ({
        pattern: ['Dictionary', ['KeyValuePair', { str: 'x' }, '_a']],
        body: 'a',
      }),
      () => ({
        pattern: [
          'Dictionary',
          ['KeyValuePair', { str: 'x' }, '_a'],
          ['KeyValuePair', { str: 'y' }, '_b'],
        ],
        body: ['Add', 'a', 'b'],
      }),
      () => ({
        pattern: ['Dictionary', ['KeyValuePair', { str: 'x' }, 1]],
        body: { str: 'x1' },
      }),
      // tier 3: a dictionary with a sequence value routes through the dict-aware
      // reference matcher
      () => ({
        pattern: ['Dictionary', ['KeyValuePair', { str: 'x' }, '__s']],
        body: 's',
      }),
      // tier 3: algebraic / sequence / non-linear
      () => ({ pattern: ['Add', '_a', '_b'], body: 'a' }),
      () => ({ pattern: ['Add', '__t'], body: { str: 'sum' } }),
      () => ({ pattern: ['List', '_a', '_a'], body: { str: 'eqpair' } }),
      // binding + guard (tier 1 via bare wildcard is tier 3, guard exercised)
      () => ({
        pattern: '_n',
        guard: ['Greater', 'n', 0],
        body: { str: 'pos' },
      }),
      // catch-all
      () => ({ pattern: '_', body: { str: 'other' } }),
    ];

    let runs = 0;
    for (let iter = 0; iter < 400; iter++) {
      const subject = pick(subjects);
      const nCases = 1 + Math.floor(rng() * 4);
      const cases: MathJsonExpression[] = [];
      for (let c = 0; c < nCases; c++) {
        const g = pick(gens)();
        const mc: MathJsonExpression[] = ['MatchCase', g.pattern];
        if (g.guard) mc.push(g.guard);
        mc.push(g.body);
        cases.push(mc as MathJsonExpression);
      }
      const expr: MathJsonExpression = ['Match', subject, ...cases];

      const M = ce.box(expr).canonical;
      const l = M.evaluate();
      const r = evaluateMatchReference(M.ops!, { engine: ce });

      runs++;
      if (l.operator === 'Error' || r.operator === 'Error') {
        // Both must be the same kind of error (same first-operand code).
        expect(l.operator).toBe(r.operator);
        expect(l.op1?.string).toBe(r.op1?.string);
      } else if (!l.isSame(r)) {
        // Surface the divergent case with its inputs for debugging.
        expect(`iter ${iter} ${JSON.stringify(expr)}: ${l.toString()}`).toBe(
          `iter ${iter} ${JSON.stringify(expr)}: ${r.toString()}`
        );
      }
    }
    expect(runs).toBe(400);
  });
});

/**
 * Rung 1 of the error-propagation design
 * (`docs/LANGUAGE-MODEL.md`): an error subject
 * must DECIDE, but it must not be destructured by a shape it does not really
 * have. The gate lives in `match-dispatch.ts` and is enforced on BOTH the
 * laddered path (tiers 0–2 reject outright; tier 3 goes through
 * `matchPattern`) and the tier-3 reference path — the two must stay
 * observationally identical.
 */
describe('MATCH ladder — error subjects reject shape patterns (both tiers)', () => {
  /** An expression whose canonical form is an invalid `Add` embedding an
   * `incompatible-type` error. */
  const BAD: MathJsonExpression = ['Add', { str: 'a' }, 1];
  const ERR: MathJsonExpression = ['Error', { str: 'oops' }];

  const bothTiers = (expr: MathJsonExpression, expected: string): void => {
    expect(ladder(expr)).toBe(expected);
    expect(reference(expr)).toBe(expected);
  };

  it('an operator pattern (`_a + _b`) does not match an error subject', () => {
    bothTiers(
      [
        'Match',
        BAD,
        ['MatchCase', ['Add', '_a', '_b'], { str: 'shape-matched' }],
        ['MatchCase', '_', { str: 'wildcard' }],
      ],
      '"wildcard"'
    );
  });

  it('a VALID `Add` subject still matches `_a + _b`', () => {
    bothTiers(
      [
        'Match',
        ['Add', 'x', 'y'],
        ['MatchCase', ['Add', '_a', '_b'], { str: 'shape-matched' }],
        ['MatchCase', '_', { str: 'wildcard' }],
      ],
      '"shape-matched"'
    );
  });

  it('literal (tier 0/1) and collection-shape (tier 2) cases reject it', () => {
    bothTiers(
      [
        'Match',
        BAD,
        ['MatchCase', 0, { str: 'zero' }],
        ['MatchCase', 0.5, { str: 'half' }],
        ['MatchCase', ['List', '_a', '_b'], { str: 'list' }],
        ['MatchCase', '_', { str: 'wildcard' }],
      ],
      '"wildcard"'
    );
    // A list subject that merely CONTAINS an error is an error subject too
    // (`isValid` is false), so it does not destructure either.
    bothTiers(
      [
        'Match',
        ['List', 1, BAD],
        ['MatchCase', ['List', '_a', '_b'], { str: 'list' }],
        ['MatchCase', '_', { str: 'wildcard' }],
      ],
      '"wildcard"'
    );
  });

  it('an explicitly `Error`-headed pattern destructures the payload', () => {
    bothTiers(
      [
        'Match',
        ERR,
        ['MatchCase', ['Error', '_c'], ['Type', 'c']],
        ['MatchCase', '_', { str: 'wildcard' }],
      ],
      'TypeFrom("string")'
    );
  });

  it('wildcards and sequence wildcards still catch it', () => {
    bothTiers(
      ['Match', BAD, ['MatchCase', '_v', ['Type', 'v']]],
      'TypeFrom("error")'
    );
    bothTiers(['Match', ERR, ['MatchCase', '___r', { str: 'rest' }]], '"rest"');
  });
});

// ─── Per-evaluation closures (regression, 2026-08-01) ───────────────────────
//
// The dispatch plan is cached per Match, but guard/body closures must be built
// PER EVALUATION: a closure canonicalized inside a live invocation frame
// captures that frame's bindings (frame-is-scope), so a plan-cached closure
// replayed the FIRST call's frame on every later call. Symptoms locked in
// below: stale results on repeated calls with different arguments, and — when
// the first call only hit the base case — unbounded recursion past it.

describe('MATCH in a function body — closures are per evaluation', () => {
  it('a wildcard arm referencing the enclosing parameter sees each frame', () => {
    ce.box([
      'Assign',
      'clfr_h',
      [
        'Function',
        [
          'Block',
          [
            'Match',
            'n',
            ['MatchCase', 0, 1],
            ['MatchCase', '_', ['Add', 'n', 100]],
          ],
        ],
        'n',
      ],
    ]).evaluate();
    // Was: 105, 105, 105 — the first frame (n = 5) baked into the plan.
    expect(ce.box(['clfr_h', 5]).evaluate().toString()).toBe('105');
    expect(ce.box(['clfr_h', 7]).evaluate().toString()).toBe('107');
    expect(ce.box(['clfr_h', 9]).evaluate().toString()).toBe('109');
    expect(ce.box(['clfr_h', 0]).evaluate().toString()).toBe('1');
  });

  it('recursion terminates after a base-case-only first call', () => {
    ce.box([
      'Assign',
      'clfr_t',
      [
        'Function',
        [
          'Block',
          [
            'Match',
            'n',
            ['MatchCase', 0, 999],
            ['MatchCase', '_', ['clfr_t', ['Subtract', 'n', 1]]],
          ],
        ],
        'n',
      ],
    ]).evaluate();
    // The base-case-first order poisoned the plan: the arm's stale `n = 0`
    // made t(1) descend past 0 forever (recursion-depth-exceeded).
    expect(ce.box(['clfr_t', 0]).evaluate().toString()).toBe('999');
    expect(ce.box(['clfr_t', 1]).evaluate().toString()).toBe('999');
    expect(ce.box(['clfr_t', 3]).evaluate().toString()).toBe('999');
  });

  it('recursive results are not stale after a recursive first call', () => {
    ce.box([
      'Assign',
      'clfr_fac',
      [
        'Function',
        [
          'Block',
          [
            'Match',
            'n',
            ['MatchCase', 0, 1],
            [
              'MatchCase',
              '_',
              ['Multiply', 'n', ['clfr_fac', ['Subtract', 'n', 1]]],
            ],
          ],
        ],
        'n',
      ],
    ]).evaluate();
    // Was: 1, 1, 1 — every call computed 1 · fac(0) with the stale n = 1.
    expect(ce.box(['clfr_fac', 1]).evaluate().toString()).toBe('1');
    expect(ce.box(['clfr_fac', 3]).evaluate().toString()).toBe('6');
    expect(ce.box(['clfr_fac', 5]).evaluate().toString()).toBe('120');
  });

  it('a guard referencing the enclosing parameter sees each frame', () => {
    // The guard closure was cached alongside the body closure — a guard
    // reading the enclosing `n` froze at the first call's value.
    ce.box([
      'Assign',
      'clfr_g',
      [
        'Function',
        [
          'Block',
          [
            'Match',
            0,
            ['MatchCase', '_', ['Greater', 'n', 10], 1],
            ['MatchCase', '_', 0],
          ],
        ],
        'n',
      ],
    ]).evaluate();
    expect(ce.box(['clfr_g', 20]).evaluate().toString()).toBe('1');
    expect(ce.box(['clfr_g', 5]).evaluate().toString()).toBe('0');
  });
});
