import { ComputeEngine, Expression, Rule } from '../../src/compute-engine';

/**
 * Tests for rule purpose tags (`RulePurpose`) and the simplification
 * cost policy (M3 of the rule-mechanics plan):
 *
 * - `'simplify'` (default): results must pass the cost gate — a result may
 *   grow the expression by at most `min(30%, 10 cost units)`; beyond that it
 *   is discarded.
 * - `'transform'`: mathematically-preferred rewrites, exempt from the
 *   cost gate.
 * - `'expand'`: growth-by-design, skipped by `simplify()` but reachable
 *   via `expr.replace()`.
 */

// A rule that grows the expression beyond the cost-gate budget:
// tan(x) costs 11, sin(x)/cos(x) costs 30 (over both the 30% ratio and the
// 10-unit absolute ceiling).
const GROWTH_RULE: Rule = {
  match: ['Tan', '_x'],
  replace: ['Divide', ['Sin', '_x'], ['Cos', '_x']],
  id: 'tan-to-sin-cos',
};

// A growth-by-design rule: sin(x) -> 2 sin(x/2) cos(x/2)
const EXPAND_RULE: Rule = {
  match: ['Sin', '_x'],
  replace: [
    'Multiply',
    2,
    ['Sin', ['Divide', '_x', 2]],
    ['Cos', ['Divide', '_x', 2]],
  ],
  id: 'sin-half-angle-expansion',
  purpose: 'expand',
};

describe('rule purpose: cost gate (default/simplify)', () => {
  it('an untagged rule whose result grows > 1.3× is discarded by simplify()', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan(x)');
    const result = expr.simplify({ rules: [GROWTH_RULE] });
    // The rewrite fired but was rejected by the cost gate
    expect(result.latex).toBe('\\tan(x)');
  });

  it("a rule explicitly tagged 'simplify' behaves like an untagged rule", () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan(x)');
    const result = expr.simplify({
      rules: [{ ...GROWTH_RULE, purpose: 'simplify' }],
    });
    expect(result.latex).toBe('\\tan(x)');
  });
});

describe('cost gate: the growth budget is capped in absolute terms', () => {
  // The gate tolerates growth of `min(30% of cost, 10 cost units)`. The
  // absolute ceiling matters because a bare ratio grants ever more slack as
  // the expression gets bigger — the regime where runaway growth actually
  // hurts.

  it('a small expression still gets its 30% of slack (2·2^x → 2^(x+1))', () => {
    const ce = new ComputeEngine();
    // cost 4 → 5: over-budget by ratio alone would reject it, the 30% (+1.2)
    // allowance is what lets this land.
    expect(ce.parse('2\\cdot2^x').simplify().toString()).toBe('2^(x + 1)');
  });

  it('a large expression does not get proportionally more slack', () => {
    const ce = new ComputeEngine();
    // cost 40 → 52 if split. 52 is exactly 1.3 × 40, so the ratio alone
    // accepted this and simplify() used to return the split form
    // `-b/(2a) + sqrt(b^2-4ac)/(2a)`. +12 is over the 10-unit ceiling, so the
    // closed quadratic-formula form now survives.
    expect(
      ce.parse('\\frac{-b+\\sqrt{b^2-4ac}}{2a}').simplify().toString()
    ).toBe('(-b + sqrt(b^2 - 4a * c)) / (2a)');
  });

  it('power combination survives a cost function that penalises Power', () => {
    const ce = new ComputeEngine();
    // The three power-combination rules in `simplify-power.ts` are tagged
    // `purpose: 'transform'`, matching their sibling in `simplify-rules.ts`.
    // Under the default cost function the rewrite is within budget anyway
    // (4 → 5), so the tag only shows itself against a cost function that
    // ranks Power expensive — which the public `costFunction` option lets a
    // caller supply. Untagged, the gate discards the rewrite here.
    const powerAverse = (e: Expression): number =>
      (e.operator === 'Power' ? 100 : 0) + ce.costFunction(e);
    expect(
      ce.parse('2\\cdot2^x').simplify({ costFunction: powerAverse }).toString()
    ).toBe('2^(x + 1)');
  });

  it("'transform' still bypasses the ceiling, not just the ratio", () => {
    const ce = new ComputeEngine();
    // tan(x) → sin(x)/cos(x) is +19, over both budgets; the tag exempts it.
    const result = ce
      .parse('\\tan(x)')
      .simplify({ rules: [{ ...GROWTH_RULE, purpose: 'transform' }] });
    expect(result.latex).toBe('\\frac{\\sin(x)}{\\cos(x)}');
  });
});

describe("rule purpose: 'transform' is exempt from the cost gate", () => {
  it("the same growth rule tagged 'transform' is accepted by simplify()", () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan(x)');
    const result = expr.simplify({
      rules: [{ ...GROWTH_RULE, purpose: 'transform' }],
    });
    expect(result.latex).toBe('\\frac{\\sin(x)}{\\cos(x)}');
  });
});

describe("rule purpose: 'expand' is skipped by simplify(), fires via replace()", () => {
  it("an 'expand' rule pushed to ce.simplificationRules is ignored by simplify()", () => {
    const ce = new ComputeEngine();
    ce.simplificationRules.push(EXPAND_RULE);
    const result = ce.parse('\\sin(x)').simplify();
    expect(result.latex).toBe('\\sin(x)');
  });

  it("the same 'expand' rule fires via expr.replace()", () => {
    const ce = new ComputeEngine();
    ce.simplificationRules.push(EXPAND_RULE);
    const result = ce.parse('\\sin(x)').replace([EXPAND_RULE]);
    expect(result).not.toBeNull();
    expect(result!.json).toEqual([
      'Multiply',
      2,
      ['Sin', ['Multiply', ['Rational', 1, 2], 'x']],
      ['Cos', ['Multiply', ['Rational', 1, 2], 'x']],
    ]);
  });

  it("an 'expand' rule passed via simplify options is also filtered out", () => {
    const ce = new ComputeEngine();
    const result = ce
      .parse('\\sin(x)')
      .simplify({ rules: [EXPAND_RULE] });
    expect(result.latex).toBe('\\sin(x)');
  });
});

describe('rule purpose: per-ruleset default and per-rule override', () => {
  it('ce.rules(rules, { purpose }) tags untagged members', () => {
    const ce = new ComputeEngine();
    const set = ce.rules(
      [
        { match: ['Cos', '_x'], replace: ['Sin', '_x'], id: 'untagged' },
        {
          match: ['Tan', '_x'],
          replace: ['Sin', '_x'],
          id: 'tagged',
          purpose: 'simplify',
        },
      ],
      { purpose: 'transform' }
    );
    const untagged = set.rules.find((r) => r.id === 'untagged')!;
    const tagged = set.rules.find((r) => r.id === 'tagged')!;
    // Untagged rule receives the per-ruleset default...
    expect(untagged.purpose).toBe('transform');
    // ...but a per-rule tag takes precedence over the set default
    expect(tagged.purpose).toBe('simplify');
  });

  it('rules boxed without a purpose option remain untagged', () => {
    const ce = new ComputeEngine();
    const set = ce.rules([
      { match: ['Cos', '_x'], replace: ['Sin', '_x'], id: 'untagged' },
    ]);
    expect(set.rules[0].purpose).toBeUndefined();
  });

  it('the per-ruleset default applies to string rules too', () => {
    const ce = new ComputeEngine();
    const set = ce.rules(['\\tan(x) -> \\sin(x)'], { purpose: 'expand' });
    expect(set.rules[0].purpose).toBe('expand');
  });

  it('the per-ruleset default makes a growth rule pass the cost gate', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\tan(x)');
    const result = expr.simplify({
      rules: ce.rules([GROWTH_RULE], { purpose: 'transform' }),
    });
    expect(result.latex).toBe('\\frac{\\sin(x)}{\\cos(x)}');
  });
});

describe('rule purpose: existing whitelist behaviors are unchanged', () => {
  // These rules are accepted via the hard-coded `because`-string whitelist
  // in simplify.ts (its migration to purpose tags is deferred to M6).

  it('combined powers: 2·2^x -> 2^(x+1)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('2\\cdot 2^x').simplify().latex).toBe('2^{x+1}');
  });

  it('ln rule: ln(x^6) -> 6 ln(|x|)', () => {
    // Even exponent: the sound form is 6·ln|x| (6·ln(x) is wrong for x < 0).
    // SYM P0-2 / D4.
    const ce = new ComputeEngine();
    expect(ce.parse('\\ln(x^6)').simplify().latex).toBe('6\\ln(\\vert x\\vert)');
  });

  it('abs rule: |xy| - |x||y| -> 0', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'Subtract',
      ['Abs', ['Multiply', 'x', 'y']],
      ['Multiply', ['Abs', 'x'], ['Abs', 'y']],
    ]);
    expect(expr.simplify().latex).toBe('0');
  });
});
