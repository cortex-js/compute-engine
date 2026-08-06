import { ComputeEngine, Expression, Rule } from '../../src/compute-engine';

/**
 * Tests for rule purpose tags (`RulePurpose`) and the simplification
 * cost policy (M3 of the rule-mechanics plan):
 *
 * - `'simplify'` (default): results must pass the cost gate — a result that
 *   makes the expression more expensive is discarded. The gate is strict; it
 *   grants no growth allowance.
 * - `'transform'`: mathematically-preferred rewrites, exempt from the
 *   cost gate.
 * - `'expand'`: growth-by-design, skipped by `simplify()` but reachable
 *   via `expr.replace()`.
 */

// A rule whose result is more expensive than its input, so the cost gate
// rejects it: tan(x) costs 11, sin(x)/cos(x) costs 30.
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

describe('cost gate: no rewrite may make the expression more expensive', () => {
  // The gate grants no growth allowance. A rewrite that is preferred despite
  // scoring larger declares itself with `purpose: 'transform'` rather than
  // relying on a numeric tolerance.

  it('a preferred rewrite that scores larger still fires, via its tag', () => {
    const ce = new ComputeEngine();
    // 2·2^x is cost 4, 2^(x+1) is cost 5. This survives only because the
    // power-combination rules carry `purpose: 'transform'` — under a bare
    // strict gate with no tag it would be discarded.
    expect(ce.parse('2\\cdot2^x').simplify().toString()).toBe('2^(x + 1)');
  });

  it('a closed form is not blown apart into a longer equivalent', () => {
    const ce = new ComputeEngine();
    // cost 40 → 52 if split. Under the old proportional gate 52 was exactly
    // 1.3 × 40, so simplify() returned `-b/(2a) + sqrt(b^2-4ac)/(2a)`.
    expect(
      ce.parse('\\frac{-b+\\sqrt{b^2-4ac}}{2a}').simplify().toString()
    ).toBe('(-b + sqrt(b^2 - 4a * c)) / (2a)');
  });

  it('a factored closed form survives instead of being expanded', () => {
    const ce = new ComputeEngine();
    // The arithmetic-progression closed form. Expanding it to
    // `1/2·d·b^2 + a·b + 1/2·b·d + a` scores better under the cost function,
    // which is precisely why the old growth tolerance let `expand` do it.
    expect(
      ce.parse('\\sum_{n=0}^{b}(a + d n)').simplify().toString()
    ).toBe('(b + 1) * (1/2 * b * d + a)');
  });

  it('power combination survives a cost function that penalises Power', () => {
    const ce = new ComputeEngine();
    // The three power-combination rules in `simplify-power.ts` are tagged
    // `purpose: 'transform'`, matching their sibling in `simplify-rules.ts`.
    // The tag is what carries them past a cost function that ranks Power
    // expensive — which the public `costFunction` option lets a caller supply.
    const powerAverse = (e: Expression): number =>
      (e.operator === 'Power' ? 100 : 0) + ce.costFunction(e);
    expect(
      ce.parse('2\\cdot2^x').simplify({ costFunction: powerAverse }).toString()
    ).toBe('2^(x + 1)');
  });

  it('a negated sum is still distributed, via its tag', () => {
    const ce = new ComputeEngine();
    // -(x+1) is cost 9, -1-x is cost 10: distributing trades one Negate for
    // one per term, so it never passes the gate on cost. It is tagged
    // `purpose: 'transform'` on the `negation` rule instead.
    expect(ce.parse('-(x+1)').simplify().toString()).toBe('-1 - x');
    expect(ce.parse('-(a+b+c)').simplify().toString()).toBe('-a - b - c');
  });

  it('the negated-sum tag is not shadowed by a later untagged rule', () => {
    const ce = new ComputeEngine();
    // Regression guard for a subtle failure mode: the aggregated head
    // dispatcher attributes a pass to the LAST rule that fires, so when the
    // untagged `expand` rule (declared earlier) also produced this rewrite,
    // the `transform` tag was dropped and the gate discarded the result.
    // `expand` now declines a negated sum. A negated *product* must still
    // reach `expand`.
    expect(ce.parse('-(x+1)').simplify().toString()).toBe('-1 - x');
    expect(ce.parse('-(x(y+1))').simplify().toString()).toBe('-x * y - x');
  });

  it("'transform' exempts a rewrite that grows the expression", () => {
    const ce = new ComputeEngine();
    // tan(x) → sin(x)/cos(x) is 11 → 30; the tag exempts it.
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
