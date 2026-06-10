import { ComputeEngine, Rule } from '../../src/compute-engine';

/**
 * Tests for rule purpose tags (`RulePurpose`) and the simplification
 * cost policy (M3 of the rule-mechanics plan):
 *
 * - `'simplify'` (default): results must pass the cost gate (today's
 *   behavior — results that grow the expression > 1.3× are discarded).
 * - `'transform'`: mathematically-preferred rewrites, exempt from the
 *   cost gate.
 * - `'expand'`: growth-by-design, skipped by `simplify()` but reachable
 *   via `expr.replace()`.
 */

// A rule that grows the expression beyond the 1.3× cost-gate threshold:
// tan(x) costs 11, sin(x)/cos(x) costs 30.
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

  it('ln rule: ln(x^6) -> 6 ln(x)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\ln(x^6)').simplify().latex).toBe('6\\ln(x)');
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
