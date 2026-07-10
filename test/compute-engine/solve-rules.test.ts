import { ComputeEngine, Rule } from '../../src/compute-engine';

//
// Tests for the public solve-rules API: `ce.solveRules` and
// `ce.harmonizationRules`, mirroring the `ce.simplificationRules` pattern
// (getter/setter, push() through the getter, cache invalidation,
// per-engine isolation).
//

// A root template for `coth(_x) + b = 0 → x = arcoth(-b)`.
// `coth(x) + b = 0` is not solvable by the built-in rules, so this rule
// makes a previously-unsolvable equation solvable. (sinh/cosh/tanh are all
// solvable natively, so `coth` is used here as the unsolvable-by-default
// stand-in for exercising the custom-rule API.)
const COTH_ROOT_RULE: Rule = {
  match: ['Add', ['Coth', '_x'], '__b'],
  replace: ['Arcoth', ['Negate', '__b']],
  condition: (sub) => !sub.__b.has('_x'),
};

const ARCOTH_3 = 0.34657359027997264; // arcoth(3), root of coth(x) - 3 = 0

function firstRootValue(result: any): number | undefined {
  if (!Array.isArray(result) || result.length === 0) return undefined;
  return result[0].N().re;
}

describe('solveRules', () => {
  //
  // Default behavior
  //
  it('has built-in rules by default', () => {
    const ce = new ComputeEngine();
    expect(ce.solveRules).toBeDefined();
    expect(ce.solveRules.length).toBeGreaterThan(0);
  });

  it('default solve() is unaffected', () => {
    const ce = new ComputeEngine();
    // Linear: 5x - 10 = 0 → x = 2
    const linear = ce
      .expr(['Add', ['Multiply', 5, 'x'], -10])
      .solve('x') as any[];
    expect(linear?.map((x) => x.json)).toEqual([2]);

    // Quadratic: 2x² - 16 = 0 → x = ±2√2
    const quadratic = ce
      .expr(['Add', ['Multiply', 2, ['Square', 'x']], -16])
      .solve('x') as any[];
    expect(quadratic?.length).toBe(2);
  });

  //
  // Push custom root template
  //
  it('pushed root template makes a previously-unsolvable equation solvable', () => {
    const ce = new ComputeEngine();
    // Not solvable by default
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);

    ce.solveRules.push(COTH_ROOT_RULE);

    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(firstRootValue(result)).toBeCloseTo(ARCOTH_3, 10);
  });

  it('pushed rule does not break built-in root finding', () => {
    const ce = new ComputeEngine();
    ce.solveRules.push(COTH_ROOT_RULE);
    const result = ce
      .expr(['Add', ['Multiply', 5, 'x'], -10])
      .solve('x') as any[];
    expect(result?.map((x) => x.json)).toEqual([2]);
  });

  //
  // Full replacement via setter
  //
  it('full replacement via setter works', () => {
    const ce = new ComputeEngine();
    ce.solveRules = [COTH_ROOT_RULE];

    // The custom rule is used...
    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(firstRootValue(result)).toBeCloseTo(ARCOTH_3, 10);

    // ...and the built-in rules are gone: linear equations are no
    // longer solvable
    const linear = ce
      .expr(['Add', ['Multiply', 5, 'x'], -10])
      .solve('x') as any[];
    expect(linear).toEqual([]);
  });

  //
  // Cache invalidation
  //
  it('cache invalidation when pushing after a prior solve()', () => {
    const ce = new ComputeEngine();
    // Trigger caching of the boxed 'solve-univariate' rule set
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);

    // Now push a new rule: it must be picked up despite the cached set
    ce.solveRules.push(COTH_ROOT_RULE);

    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(firstRootValue(result)).toBeCloseTo(ARCOTH_3, 10);
  });

  it('cache invalidation after setter replacement', () => {
    const ce = new ComputeEngine();
    // Trigger caching
    ce.expr(['Add', ['Multiply', 5, 'x'], -10]).solve('x');

    ce.solveRules = [COTH_ROOT_RULE];

    // The replaced set is used: built-in linear solving is gone
    const linear = ce
      .expr(['Add', ['Multiply', 5, 'x'], -10])
      .solve('x') as any[];
    expect(linear).toEqual([]);
  });

  //
  // Per-engine isolation
  //
  it('different engines have independent rules', () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();

    ce1.solveRules.push(COTH_ROOT_RULE);

    expect(ce1.solveRules.length).toBe(ce2.solveRules.length + 1);

    // ce1 can solve, ce2 cannot
    const r1 = ce1.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(r1?.length).toBe(1);
    expect(ce2.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);
  });

  //
  // Wrong templates are filtered by root validation
  //
  it('bogus roots from a wrong template are filtered by validation', () => {
    const ce = new ComputeEngine();
    // A deliberately wrong template: claims coth(x) + b = 0 has root 42.
    // coth(42) - 3 ≠ 0, so the candidate root must be rejected and solve()
    // degrades to a no-op instead of returning a wrong answer.
    ce.solveRules.push({
      match: ['Add', ['Coth', '_x'], '__b'],
      replace: 42,
      condition: (sub) => !sub.__b.has('_x'),
    });
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);
  });

  //
  // Rule with condition
  //
  it('rule condition is honored', () => {
    const ce = new ComputeEngine();
    // Same template, but the condition rejects every match
    ce.solveRules.push({
      match: ['Add', ['Coth', '_x'], '__b'],
      replace: ['Arcoth', ['Negate', '__b']],
      condition: () => false,
    });
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);
  });
});

describe('harmonizationRules', () => {
  //
  // Default behavior
  //
  it('has built-in rules by default', () => {
    const ce = new ComputeEngine();
    expect(ce.harmonizationRules).toBeDefined();
    expect(ce.harmonizationRules.length).toBeGreaterThan(0);
  });

  it('default solve() is unaffected', () => {
    const ce = new ComputeEngine();
    const result = ce
      .expr(['Add', ['Multiply', 5, 'x'], -10])
      .solve('x') as any[];
    expect(result?.map((x) => x.json)).toEqual([2]);
  });

  //
  // Pushed harmonization rule feeding root finding
  //
  // The harmonization pass rewrites the normalized equation (in terms of
  // the `_x` wildcard symbol) into an equivalent, easier-to-solve form,
  // which is then run through the root-finding rules. In the
  // post-harmonization root-finding pass the `_x` wildcard is bound to the
  // literal `_x` symbol (same as in the first pass), so both pattern root
  // rules and functional root rules can match the harmonized form.
  //
  function pushHarmonizationScenario(ce: ComputeEngine): void {
    // coth(_x) + b = 0 → _x - arcoth(-b) = 0
    ce.harmonizationRules.push({
      match: ['Add', ['Coth', '_x'], '__b'],
      replace: ['Subtract', '_x', ['Arcoth', ['Negate', '__b']]],
      condition: (sub) => !sub.__b.has('_x'),
    });
    // Functional root rule: _x - c = 0 → x = c
    ce.solveRules.push((expr) => {
      if (expr.operator !== 'Subtract') return undefined;
      if (expr.op1.symbol !== '_x' || expr.op2.has('_x')) return undefined;
      return expr.op2;
    });
  }

  it('pushed harmonization rule feeds root finding', () => {
    const ce = new ComputeEngine();
    // Not solvable by default
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);

    pushHarmonizationScenario(ce);

    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(result[0].N().re).toBeCloseTo(ARCOTH_3, 10);
  });

  //
  // Natural path: a pushed harmonization rule whose output is solved by the
  // BUILT-IN pattern root rules (no functional rule needed). The harmonized
  // form `_x - arcoth(3) = 0` is matched by the built-in linear template.
  //
  it('pushed harmonization rule feeds built-in pattern root rules', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);

    ce.harmonizationRules.push({
      match: ['Add', ['Coth', '_x'], '__b'],
      replace: ['Subtract', '_x', ['Arcoth', ['Negate', '__b']]],
      condition: (sub) => !sub.__b.has('_x'),
    });

    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(result[0].N().re).toBeCloseTo(ARCOTH_3, 10);
  });

  //
  // Natural path: BUILT-IN harmonization rules firing.
  //
  // `ln(x² + 1) = 0` is not matched by any root template (the `Ln` templates
  // require the unknown as the direct argument), but the built-in
  // harmonization rule `ln(f(x)) → f(x) - 1` rewrites it to `x² = 0`.
  //
  it('built-in harmonization rules solve ln(f(x)) = 0', () => {
    const ce = new ComputeEngine();
    const result = ce.parse('\\ln(x^2 + 1) = 0').solve('x') as any[];
    expect(result?.map((x) => x.json)).toEqual([0]);
  });

  it('emptying harmonizationRules changes solve outcomes', () => {
    const ce = new ComputeEngine();
    // Solvable with the built-in harmonization rules...
    expect(
      (ce.parse('\\ln(x^2 + 1) = 0').solve('x') as any[])?.map((x) => x.json)
    ).toEqual([0]);

    // ...but not without them
    ce.harmonizationRules = [];
    expect(ce.parse('\\ln(x^2 + 1) = 0').solve('x')).toEqual([]);
  });

  //
  // Built-in harmonization rules can CHAIN: `ln(a) + ln(b) → ln(ab)`, then
  // `ln(f(x)) → f(x) - 1`, then the expansion pass finds the roots of
  // `(x+1)(x-1) - 1 = x² - 2`. The extraneous candidate `-√2` (which makes
  // both logarithm arguments negative) is rejected by root validation
  // against the original equation.
  //
  it('built-in harmonization rules chain', () => {
    const ce = new ComputeEngine();
    const result = ce.parse('\\ln(x+1) + \\ln(x-1) = 0').solve('x') as any[];
    expect(result?.map((x) => x.json)).toEqual([['Sqrt', 2]]);
  });

  //
  // Cache invalidation
  //
  it('cache invalidation when pushing after a prior solve()', () => {
    const ce = new ComputeEngine();
    // Trigger caching of the boxed 'harmonization' rule set (the
    // harmonization pass runs when pattern root-finding fails)
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);

    pushHarmonizationScenario(ce);

    const result = ce.parse('\\coth(x) - 3 = 0').solve('x') as any[];
    expect(result?.length).toBe(1);
    expect(result[0].N().re).toBeCloseTo(ARCOTH_3, 10);
  });

  //
  // Full replacement via setter
  //
  it('full replacement via setter works (with cache invalidation)', () => {
    const ce = new ComputeEngine();
    pushHarmonizationScenario(ce);

    // Works, and caches the boxed harmonization rule set
    expect((ce.parse('\\coth(x) - 3 = 0').solve('x') as any[])?.length).toBe(
      1
    );

    // Remove all harmonization rules: the equation becomes unsolvable
    // again (the functional root rule alone can't match the raw equation)
    ce.harmonizationRules = [];
    expect(ce.parse('\\coth(x) - 3 = 0').solve('x')).toEqual([]);
  });

  //
  // Per-engine isolation
  //
  it('different engines have independent rules', () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();

    ce1.harmonizationRules.push({
      match: ['Add', ['Coth', '_x'], '__b'],
      replace: ['Subtract', '_x', ['Arcoth', ['Negate', '__b']]],
      condition: (sub) => !sub.__b.has('_x'),
    });

    expect(ce1.harmonizationRules.length).toBe(
      ce2.harmonizationRules.length + 1
    );
  });
});
