import { engine as ce } from '../utils';

describe('RULES', () => {
  it('should handle rule with match and replace as expressions', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match and replace as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a; a > 0';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:>0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX that dont match', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:<0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`null`);
  });

  it('should handle rule with match, replace and inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:positive -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should handle rule with match, replace and inline sub condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a_{positive} -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });

  it('should return the correct shorthand rule for the given expression', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`6`);
  });
});

// Test for issue #23: replace() with object rules should NOT auto-wildcard
// single-character symbols. Only string rules should auto-wildcard.
describe('OBJECT RULES LITERAL MATCHING', () => {
  it('should match literal symbol in object rule, not wildcard', () => {
    // {match: 'a', replace: 2} should replace literal 'a' with 2
    // NOT treat 'a' as a wildcard matching any expression
    const expr = ce.expr(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    // Expected: 2x + b (only 'a' replaced, not the whole expression)
    expect(result?.toString()).toBe('b + 2x');
  });

  it('should match literal symbol not present in expression', () => {
    const expr = ce.expr(['Add', ['Multiply', 'x', 'y'], 'z']);
    // 'a' is not in the expression, so no match
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    expect(result).toBeNull();
  });

  it('should still allow explicit wildcards in object rules', () => {
    const expr = ce.expr(['Add', ['Multiply', 3, 'x'], 5]);
    const result = expr.replace(
      { match: ['Multiply', '_a', 'x'], replace: ['Multiply', 10, 'x'] },
      { recursive: true }
    );
    expect(result?.toString()).toBe('10x + 5');
  });

  it('string rules should still auto-wildcard', () => {
    const expr = ce.expr(['Add', ['Multiply', 2, 'x'], 3]);
    const result = expr.replace('a*x -> 5*x', { recursive: true });
    expect(result?.toString()).toBe('5x + 3');
  });

  it('subs() should work the same as literal replace', () => {
    const expr = ce.expr(['Add', ['Multiply', 'a', 'x'], 'b']);
    const subsResult = expr.subs({ a: 2 });
    const replaceResult = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    expect(subsResult.toString()).toBe(replaceResult?.toString());
  });
});

describe('INVALID RULES', () => {
  it('should handle shorthand rule with no replace', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a';
    expect(() => expr.replace(rule)).toThrowErrorMatchingInlineSnapshot(`

            Invalid rule "\\pi + a"
            |   a + pi
            |   A rule should be of the form:
            |   <match> -> <replace>; <condition>
            |   Skipping rule "\\\\pi + a"


        `);
  });

  it('should handle shorthand rule with incorrect wildcards replace', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> b';
    expect(() => expr.replace(rule)).toThrowErrorMatchingInlineSnapshot(`

      Invalid rule "\\pi + a -> b"
      |   The replace expression contains wildcards not present in the match expression
      |   Skipping rule "\\\\pi + a -> b"


    `);
  });

  it('should handle redundant rules with simplify', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '0 + a -> a';
    expect(() => expr.simplify({ rules: rule }))
      .toThrowErrorMatchingInlineSnapshot(`

      Invalid rule "0 + a -> a"
      |   The match and replace expressions are the same.
      |   This may be because the rule is not necessary due to canonical simplification
      |   Skipping rule "0 + a -> a"


    `);
  });
});

describe('matchPermutations option', () => {
  it('default behavior tries permutations for commutative operators', () => {
    // Use non-canonical expression to test permutation matching
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Should match via permutation: pattern [1, _a] matches expr [x, 1]
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: true explicitly allows permutation matching', () => {
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    expect(
      expr.replace(rule, { matchPermutations: true })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: false disables permutation matching', () => {
    const expr = ce.expr(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Without permutations, [1, _a] won't match [x, 1] since positions differ
    expect(expr.replace(rule, { matchPermutations: false })).toBeNull();
  });

  it('matchPermutations: false still matches exact order', () => {
    const expr = ce.expr(['Add', 1, 'x'], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Exact order matches even without permutations
    expect(
      expr.replace(rule, { matchPermutations: false })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });
});

// Regression tests for fixes cherry-picked from PR #301.
describe('PR #301 cherry-picked fixes', () => {
  it('applyRule preserves operand rewrites when function-replace returns undefined at top', () => {
    // Pattern matches at both inner and outer Add. Function-replace rewrites the
    // inner Add(y, z) but returns undefined for the outer (where _a is symbol x).
    // Before the fix: result is null (operand rewrites silently discarded).
    // After the fix: result is the operand-rewritten expression.
    const expr = ce.expr(['Add', 'x', ['Add', 'y', 'z']], { form: 'raw' });

    const rule = {
      match: ['Add', '_a', '_b'],
      replace: (_e, { _a, _b }) => {
        if (_a.symbol === 'x') return undefined;
        return ce.expr(['Multiply', _a, _b]);
      },
    };

    const result = expr.replace(rule, {
      recursive: true,
      matchPermutations: false,
    });
    expect(result).not.toBeNull();
    expect(result?.toString()).toBe('x + y * z');
  });

  it('object-rule condition string without $ delimiters is honored', () => {
    // Before the '$'-delimiter fix: the condition string was silently dropped,
    // so the rule applied unconditionally.
    const expr = ce.expr(['Add', 3, 'x']);

    const ruleAccept = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a > 0',
    };
    expect(expr.replace(ruleAccept)?.toString()).toBe('6');

    const ruleReject = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a < 0',
    };
    // 3 < 0 is false, so the rule should not apply.
    expect(expr.replace(ruleReject)).toBeNull();
  });

  it('object-rule condition string is canonicalized so it can evaluate', () => {
    // Before the canonicalization fix: a non-trivial condition (e.g. 'a^2 > 0')
    // was parsed as 'raw' and could not evaluate, so the rule never applied.
    const expr = ce.expr(['Add', 4, 'x']);

    const rule = {
      match: ['Add', '_a', 'x'],
      replace: ['Multiply', '_a', 2],
      condition: 'a^2 > 0',
    };
    // 4^2 = 16 > 0 → condition evaluates to True → rule applies.
    expect(expr.replace(rule)?.toString()).toBe('8');
  });
});

// Regression tests for PR #305: ReplaceOptions 'form' and 'direction'
describe('ReplaceOptions form', () => {
  const rule = { match: 'x', replace: ['Add', 1, 1] };

  it("form: 'canonical' canonicalizes replacements (and result)", () => {
    const expr = ce.parse('x + 1');
    const result = expr.replace(rule, { recursive: true, form: 'canonical' });
    expect(result?.isCanonical).toBe(true);
    // Replacement (1 + 1) is canonicalized to 2, then folded: 2 + 1 → 3
    expect(result?.toString()).toBe('3');
  });

  it("form: 'raw' preserves the replacement structure", () => {
    const expr = ce.expr(['Add', 'x', 5], { form: 'raw' });
    const result = expr.replace(rule, { recursive: true, form: 'raw' });
    expect(result?.isCanonical).toBe(false);
    expect(result?.json).toEqual(['Add', ['Add', 1, 1], 5]);
  });

  it('deprecated canonical: true behaves like form: canonical', () => {
    const expr = ce.parse('x + 1');
    const result = expr.replace(rule, { recursive: true, canonical: true });
    expect(result?.toString()).toBe('3');
  });

  it('deprecated canonical: false behaves like form: raw', () => {
    const expr = ce.expr(['Add', 'x', 5], { form: 'raw' });
    const result = expr.replace(rule, { recursive: true, canonical: false });
    expect(result?.json).toEqual(['Add', ['Add', 1, 1], 5]);
  });

  it('specifying both form and canonical throws', () => {
    const expr = ce.parse('x + 1');
    expect(() =>
      expr.replace(rule, { form: 'canonical', canonical: true })
    ).toThrow(/mutually exclusive/);
  });

  it('a replacement that only changes the form counts as a change', () => {
    // The rule returns the canonical variant of a raw expression: the value
    // is structurally the same, but the form differs. Before PR #305 this
    // was treated as "no change" and replace() returned null.
    const expr = ce.expr(['Multiply', 2, 'x'], { form: 'raw' });
    const rule = {
      match: ['Multiply', '_a', '_b'],
      replace: (e) => e.canonical,
    };
    const result = expr.replace(rule);
    expect(result).not.toBeNull();
    expect(result?.isCanonical).toBe(true);
  });
});

describe('ReplaceOptions direction', () => {
  // An order-sensitive rule: each matched symbol is replaced with an
  // incrementing counter, so the traversal order is observable.
  const makeRule = () => {
    let counter = 0;
    return (e) => {
      if (!e.symbol) return undefined;
      counter += 1;
      return { value: ce.number(counter), because: 'counter' };
    };
  };

  it('left-right (default) visits operands in order', () => {
    const expr = ce.expr(['List', 'a', 'b', 'c'], { form: 'raw' });
    const result = expr.replace(makeRule(), { recursive: true });
    expect(result?.json).toEqual(['List', 1, 2, 3]);
  });

  it('right-left visits operands in reverse order', () => {
    const expr = ce.expr(['List', 'a', 'b', 'c'], { form: 'raw' });
    const result = expr.replace(makeRule(), {
      recursive: true,
      direction: 'right-left',
    });
    expect(result?.json).toEqual(['List', 3, 2, 1]);
  });
});
