/**
 * Per-head aggregated rule dispatch (ROADMAP item 5).
 *
 * `aggregateHotHeadDispatch` (rule-index.ts) collapses each hot head's
 * loader-registered functional dispatch rules into a single per-head
 * dispatcher, to amortize the per-rule `applyRule`/candidate scaffolding. This
 * suite is the EQUIVALENCE ORACLE for that fold:
 *
 *  1. SYNTHETIC — precise control over the firing path (no fire / single fire /
 *     multi-fire same head / head change mid-dispatch / attribution), driven
 *     through the real `replace()` primitive, asserting the aggregated rule set
 *     produces the same final value and the same trailing `because` as the
 *     un-aggregated linear scan.
 *
 *  2. REAL CORPUS — the full Fungrim artifact loaded, `simplify()` over a broad
 *     corpus (assumption-free arithmetic + Fungrim-triggering expressions),
 *     comparing the aggregated dispatch against the un-aggregated reference.
 *     Must be byte-identical.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities } from '../../src/identities';
import { aggregateHotHeadDispatch } from '../../src/compute-engine/boxed-expression/rule-index';
import { replace } from '../../src/compute-engine/boxed-expression/rules';
import { SIMPLIFY_CORPUS_FLAT } from './rule-dispatch-corpus';
import type {
  BoxedExpression,
  BoxedRule,
  BoxedRuleSet,
  RuleStep,
} from '../../src/compute-engine/global-types';

// ---------------------------------------------------------------------------
// 1. Synthetic firing-path equivalence
// ---------------------------------------------------------------------------

/** Build a foldable functional rule over `head` (the shape `wrapHotHeadRule`
 *  produces): no match pattern, no top-level condition, a single `operators`
 *  head, and a `replace` function returning a firing `RuleStep` or undefined. */
function foldableRule(
  head: string,
  id: string,
  fire: (expr: BoxedExpression) => BoxedExpression | undefined
): BoxedRule {
  const replaceFn = (expr: BoxedExpression): RuleStep | undefined => {
    const value = fire(expr);
    if (value === undefined) return undefined;
    return { value, because: id, purpose: 'simplify' } as RuleStep;
  };
  return {
    _tag: 'boxed-rule',
    match: undefined,
    replace: replaceFn,
    condition: undefined,
    operators: [head],
    id,
  } as unknown as BoxedRule;
}

const REPLACE_OPTS = {
  recursive: false,
  form: 'canonical',
  useVariations: false,
} as const;

describe('aggregateHotHeadDispatch — synthetic firing path', () => {
  const ce = new ComputeEngine();
  // Synthetic heads, so no built-in or Fungrim rule interferes.
  ce.declare('TestF', '(number) -> number');
  ce.declare('TestG', '(number) -> number');

  const F = (n: number) => ce.box(['TestF', n]);
  const G = (n: number) => ce.box(['TestG', n]);

  // A chain over head TestF: F(0)→F(1)→F(2)→G(99) (head change on the last),
  // plus a never-firing rule and a rule that would only fire on G (so it is a
  // no-op when the chain has already left head TestF).
  const rules: BoxedRule[] = [
    foldableRule('TestF', 'f0', (e) =>
      e.op1?.isSame(0) ? F(1) : undefined
    ),
    foldableRule('TestF', 'f1', (e) =>
      e.op1?.isSame(1) ? F(2) : undefined
    ),
    foldableRule('TestF', 'f2', (e) =>
      e.operator === 'TestF' && e.op1?.isSame(2) ? G(99) : undefined
    ),
    foldableRule('TestF', 'f-never', () => undefined),
    foldableRule('TestF', 'f-on-g', (e) =>
      e.operator === 'TestF' && e.op1?.isSame(99) ? F(1000) : undefined
    ),
  ];

  const refSet: BoxedRuleSet = { rules };
  const aggSet: BoxedRuleSet = { rules: aggregateHotHeadDispatch(rules) };

  it('folds the five same-head functional rules into one dispatcher', () => {
    expect(rules.length).toBe(5);
    expect(aggSet.rules.length).toBe(1);
    expect(aggSet.rules[0].operators).toEqual(['TestF']);
    expect(typeof aggSet.rules[0].replace).toBe('function');
  });

  const finalValue = (set: BoxedRuleSet, expr: BoxedExpression) => {
    const steps = replace(expr, set, REPLACE_OPTS);
    return steps.length ? steps[steps.length - 1].value : expr;
  };
  const trailingBecause = (set: BoxedRuleSet, expr: BoxedExpression) => {
    const steps = replace(expr, set, REPLACE_OPTS);
    return steps.length ? steps[steps.length - 1].because : null;
  };

  it('multi-fire + head change: same final value as the linear scan', () => {
    // F(0) → F(1) → F(2) → G(99)
    expect(finalValue(refSet, F(0)).toString()).toBe('TestG(99)');
    expect(finalValue(aggSet, F(0)).toString()).toBe('TestG(99)');
  });

  it('preserves the trailing `because` (cost-gate attribution)', () => {
    // The last firing rule in the chain is f2 (F(2)→G(99)); `simplify()`
    // consumes `result.at(-1)`, so the dispatcher must surface f2.
    expect(trailingBecause(refSet, F(0))).toBe('f2');
    expect(trailingBecause(aggSet, F(0))).toBe('f2');
  });

  it('single fire: identical value and attribution', () => {
    // F(2) fires f2 once → G(99); G(99) leaves head TestF, so nothing chains.
    expect(finalValue(refSet, F(2)).toString()).toBe('TestG(99)');
    expect(finalValue(aggSet, F(2)).toString()).toBe('TestG(99)');
    expect(trailingBecause(refSet, F(2))).toBe('f2');
    expect(trailingBecause(aggSet, F(2))).toBe('f2');
  });

  it('no fire: returns the input unchanged on both paths', () => {
    expect(finalValue(refSet, F(7)).toString()).toBe('TestF(7)');
    expect(finalValue(aggSet, F(7)).toString()).toBe('TestF(7)');
    expect(replace(F(7), aggSet, REPLACE_OPTS).length).toBe(0);
  });

  it('a single-rule head is left unfolded (no scaffolding to amortize)', () => {
    const one = [foldableRule('Solo', 's0', (e) => (e.op1?.isSame(0) ? G(1) : undefined))];
    const agg = aggregateHotHeadDispatch(one);
    expect(agg.length).toBe(1);
    expect(agg[0].id).toBe('s0'); // unchanged, not a dispatcher
  });

  it('returns the input array unchanged when nothing is foldable', () => {
    const patternRule = {
      _tag: 'boxed-rule',
      match: ce.box(['TestF', '_x']),
      replace: ce.box('_x'),
      condition: undefined,
    } as unknown as BoxedRule;
    const input = [patternRule];
    expect(aggregateHotHeadDispatch(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 2. Real-corpus differential — aggregated vs un-aggregated, full artifact
// ---------------------------------------------------------------------------

describe('aggregateHotHeadDispatch — real-corpus differential', () => {
  const ce = new ComputeEngine();
  loadIdentities(ce, { solve: true });

  // Un-aggregated reference: box the public rule array and drop `expand`
  // (mirrors getRuleSet('standard-simplification') WITHOUT the fold).
  const refRules: BoxedRuleSet = {
    rules: ce
      .rules(ce.simplificationRules, { canonical: true })
      .rules.filter((r) => r.purpose !== 'expand'),
  };
  // Aggregated: the production fold over the same boxed rules.
  const aggRules: BoxedRuleSet = {
    rules: aggregateHotHeadDispatch(refRules.rules),
  };

  it('the fold actually collapses the hot buckets', () => {
    // Sanity: the aggregated set must be materially smaller, else the
    // differential below proves nothing.
    expect(aggRules.rules.length).toBeLessThan(refRules.rules.length - 100);
  });

  // Corpus: assumption-free arithmetic (Fungrim rules consulted but rarely
  // fire) + expressions that DO drive Fungrim rules (specific values and
  // hot-head arithmetic over them).
  const FUNGRIM_TRIGGERS: string[] = [
    'Gamma(1/2)',
    'Gamma(3/2)',
    'Gamma(2)',
    'Gamma(5/2)',
    'Digamma(1)',
    'Digamma(2)',
    'Digamma(3)',
    '2\\Gamma(1/2)',
    '\\Gamma(1/2)+\\Gamma(3/2)',
    '\\Gamma(1/2)^2',
    '\\sqrt{\\Gamma(1/2)}',
    '|\\Gamma(1/2)|',
    '-\\Gamma(1/2)',
    '\\Gamma(1/2)/\\Gamma(3/2)',
    '\\Gamma(1/2)\\cdot\\Gamma(3/2)\\cdot\\Gamma(2)',
    '\\Gamma(1/2)+\\Digamma(1)',
    '\\frac{\\Gamma(3/2)}{\\Gamma(1/2)}+\\Gamma(2)',
    // Hot-head dispatcher fires (head-faithful Fungrim rules, no guards):
    '\\ln(-1)', // Ln: → iπ
    '\\arctan(\\frac{\\sqrt{3}}{3})', // Arctan: → π/6
    '2\\ln(-1)', // Ln fires inside a Multiply
    '\\ln(-1)+\\arctan(\\frac{\\sqrt{3}}{3})', // two hot-head fires under Add
    '\\ln(-1)\\cdot\\Gamma(1/2)', // hot-head fire × non-hot fire
  ];

  const corpus: BoxedExpression[] = [
    ...SIMPLIFY_CORPUS_FLAT.map((src) => ce.parse(src)),
    ...FUNGRIM_TRIGGERS.map((src) => ce.parse(src)),
  ].filter((e) => e.isValid);

  it('aggregated simplify() is byte-identical to the un-aggregated reference', () => {
    const divergences: string[] = [];
    let changedCount = 0;
    for (const expr of corpus) {
      const ref = expr.simplify({ rules: refRules }).toString();
      const agg = expr.simplify({ rules: aggRules }).toString();
      if (agg !== ref)
        divergences.push(`${expr.toString()}\n  ref: ${ref}\n  agg: ${agg}`);
      if (ref !== expr.toString()) changedCount++;
    }
    expect(divergences).toEqual([]);
    // The corpus must exercise real simplification, not just no-ops.
    expect(changedCount).toBeGreaterThan(20);
  });

  it('the default simplify() path uses the aggregated set (and agrees)', () => {
    // The engine's cached standard-simplification set is aggregated; confirm
    // the public `.simplify()` matches the explicit aggregated rule set.
    for (const src of FUNGRIM_TRIGGERS) {
      const expr = ce.parse(src);
      if (!expr.isValid) continue;
      expect(expr.simplify().toString()).toBe(
        expr.simplify({ rules: aggRules }).toString()
      );
    }
  });
});
