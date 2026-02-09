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
    const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    // Expected: 2x + b (only 'a' replaced, not the whole expression)
    expect(result?.toString()).toBe('b + 2x');
  });

  it('should match literal symbol not present in expression', () => {
    const expr = ce.box(['Add', ['Multiply', 'x', 'y'], 'z']);
    // 'a' is not in the expression, so no match
    const result = expr.replace(
      { match: 'a', replace: 2 },
      { recursive: true }
    );
    expect(result).toBeNull();
  });

  it('should still allow explicit wildcards in object rules', () => {
    const expr = ce.box(['Add', ['Multiply', 3, 'x'], 5]);
    const result = expr.replace(
      { match: ['Multiply', '_a', 'x'], replace: ['Multiply', 10, 'x'] },
      { recursive: true }
    );
    expect(result?.toString()).toBe('10x + 5');
  });

  it('string rules should still auto-wildcard', () => {
    const expr = ce.box(['Add', ['Multiply', 2, 'x'], 3]);
    const result = expr.replace('a*x -> 5*x', { recursive: true });
    expect(result?.toString()).toBe('5x + 3');
  });

  it('subs() should work the same as literal replace', () => {
    const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
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
    const expr = ce.box(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Should match via permutation: pattern [1, _a] matches expr [x, 1]
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: true explicitly allows permutation matching', () => {
    const expr = ce.box(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    expect(
      expr.replace(rule, { matchPermutations: true })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: false disables permutation matching', () => {
    const expr = ce.box(['Add', 'x', 1], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Without permutations, [1, _a] won't match [x, 1] since positions differ
    expect(expr.replace(rule, { matchPermutations: false })).toBeNull();
  });

  it('matchPermutations: false still matches exact order', () => {
    const expr = ce.box(['Add', 1, 'x'], { form: 'raw' });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Exact order matches even without permutations
    expect(
      expr.replace(rule, { matchPermutations: false })
    ).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });
});
