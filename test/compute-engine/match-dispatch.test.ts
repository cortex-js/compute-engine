import { engine as ce } from '../utils';

import { _forTesting } from '../../src/compute-engine/boxed-expression/match-dispatch';

import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 2 of the Cortex `match` design
 * (docs/plans/2026-07-12-cortex-match-design.md §4): the classification ladder.
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
