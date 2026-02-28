import { ComputeEngine, Rule } from '../../src/compute-engine';

describe('simplificationRules', () => {
  //
  // Default behavior
  //
  it('has built-in rules by default', () => {
    const ce = new ComputeEngine();
    expect(ce.simplificationRules).toBeDefined();
    expect(ce.simplificationRules.length).toBeGreaterThan(0);
  });

  it('default simplification still works', () => {
    const ce = new ComputeEngine();
    const result = ce.parse('x + 0').simplify();
    expect(result.latex).toBe('x');
  });

  //
  // Push custom rule (pattern match/replace)
  //
  it('custom rule via push() participates in simplify', () => {
    const ce = new ComputeEngine();
    // Floor(Floor(x)) → Floor(x) — not a built-in rule, and result is cheaper
    ce.simplificationRules.push({
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
    });
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Full replacement via setter
  //
  it('full replacement via setter works', () => {
    const ce = new ComputeEngine();
    ce.simplificationRules = [
      {
        match: ['Floor', ['Floor', '_x']],
        replace: ['Floor', '_x'],
      },
    ];
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Per-call override still works
  //
  it('per-call rules override still works', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify({
      rules: [
        {
          match: ['Floor', ['Floor', '_x']],
          replace: ['Floor', '_x'],
        },
      ],
    });
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Rule with condition
  //
  it('rule with condition', () => {
    const ce = new ComputeEngine();
    ce.simplificationRules.push({
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
      condition: ({ _x }) => _x.symbol === 'a',
    });
    // Should NOT match — _x is 'x', not 'a'
    const result1 = ce.expr(['Floor', ['Floor', 'x']]).simplify();
    expect(result1.json).toEqual(['Floor', ['Floor', 'x']]);

    // Should match — _x is 'a'
    const result2 = ce.expr(['Floor', ['Floor', 'a']]).simplify();
    expect(result2.json).toEqual(['Floor', 'a']);
  });

  //
  // Rule with id
  //
  it('rule with custom id', () => {
    const ce = new ComputeEngine();
    const rule: Rule = {
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
      id: 'idempotent-floor',
    };
    ce.simplificationRules.push(rule);
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Function-based rule
  //
  it('function-based rule', () => {
    const ce = new ComputeEngine();
    ce.simplificationRules.push((expr) => {
      if (
        expr.operator === 'Floor' &&
        expr.op1.operator === 'Floor'
      ) {
        return expr.op1;
      }
      return undefined;
    });
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // LaTeX string rule
  //
  it('LaTeX string rule', () => {
    const ce = new ComputeEngine();
    // LaTeX rule: \\lfloor\\lfloor x \\rfloor\\rfloor → \\lfloor x \\rfloor
    // Use a simpler LaTeX rule that the system can parse:
    // sin(pi) -> 0 is already built-in, so let's use a different one
    // Let's add a rule that Ln(Exp(x)) -> x (this may already exist, but it verifies LaTeX string rule format works)
    ce.simplificationRules.push('\\lfloor\\lfloor x \\rfloor\\rfloor -> \\lfloor x \\rfloor');
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Engine instances are independent
  //
  it('different engines have independent rules', () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();
    ce1.simplificationRules.push({
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
    });
    // ce2 should NOT have the custom rule
    const len1 = ce1.simplificationRules.length;
    const len2 = ce2.simplificationRules.length;
    expect(len1).toBe(len2 + 1);

    // Verify ce2 doesn't simplify with the custom rule
    const expr = ce2.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', ['Floor', 'x']]);
  });

  //
  // Cache invalidation after push
  //
  it('cache invalidation after push', () => {
    const ce = new ComputeEngine();
    // Trigger caching by calling simplify once
    ce.parse('x + 0').simplify();

    // Now push a new rule
    ce.simplificationRules.push({
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
    });

    // The new rule should be picked up
    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Cache invalidation after setter replacement
  //
  it('cache invalidation after setter', () => {
    const ce = new ComputeEngine();
    // Trigger caching
    ce.parse('x + 0').simplify();

    // Replace rules entirely
    ce.simplificationRules = [
      { match: ['Floor', ['Floor', '_x']], replace: ['Floor', '_x'] },
    ];

    const expr = ce.expr(['Floor', ['Floor', 'x']]);
    const result = expr.simplify();
    expect(result.json).toEqual(['Floor', 'x']);
  });

  //
  // Custom rule doesn't break existing simplifications
  //
  it('adding a custom rule does not break built-in simplifications', () => {
    const ce = new ComputeEngine();
    ce.simplificationRules.push({
      match: ['Floor', ['Floor', '_x']],
      replace: ['Floor', '_x'],
    });
    // Built-in simplification should still work
    const result = ce.parse('1 \\times x').simplify();
    expect(result.latex).toBe('x');
  });
});
