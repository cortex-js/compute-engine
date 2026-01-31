import { engine as ce } from '../utils';

describe('RULES', () => {
  it('should handle rule with match and replace as expressions', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should handle rule with match and replace as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should handle rule with match, replace and condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a; a > 0';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:>0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should handle rule with match, replace and short inline condition as LaTeX that dont match', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:<0 -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`null`);
  });

  it('should handle rule with match, replace and inline condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a:positive -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should handle rule with match, replace and inline sub condition as LaTeX', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a_{positive} -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('should return the correct shorthand rule for the given expression', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
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

// Test for issue #23: Object rules should NOT auto-wildcard single-char symbols
describe('Object rules literal symbol matching', () => {
  it('should match literal symbol a, not wildcard (issue #23)', () => {
    // Previously, {match: 'a', replace: 2} would convert 'a' to wildcard '_a'
    // which would match ANY expression. Now it matches literal symbol 'a'.
    const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.replace({ match: 'a', replace: 2 }, { recursive: true });
    // Expected: 2*x + b (replace only the literal 'a')
    // Bug (before fix): 2 (matched entire expression with wildcard)
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", "b", ["Multiply", 2, "x"]]`);
  });

  it('should replace multiple occurrences of literal symbol', () => {
    const expr = ce.box(['Add', 'a', ['Multiply', 'a', 'x'], 'a']);
    const result = expr.replace({ match: 'a', replace: 3 }, { recursive: true });
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", ["Multiply", 3, "x"], 3, 3]`);
  });

  it('should not affect other single-char symbols when matching literal', () => {
    const expr = ce.box(['Add', 'a', 'b', 'c']);
    const result = expr.replace({ match: 'b', replace: 5 }, { recursive: true });
    // Should only replace 'b', leave 'a' and 'c' unchanged
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", "a", "c", 5]`);
  });

  it('should work with multi-char symbol names as literal match (MathJSON)', () => {
    // When using multi-char symbols, provide match as MathJSON to avoid LaTeX parsing issues
    const expr = ce.box(['Add', ['Multiply', 'foo', 'x'], 'bar']);
    const result = expr.replace({ match: ce.symbol('foo'), replace: 7 }, { recursive: true });
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", "bar", ["Multiply", 7, "x"]]`);
  });

  it('string rule format should still auto-wildcard single-char symbols', () => {
    // The LaTeX rule string format should preserve existing behavior
    const expr = ce.parse('\\pi + 3');
    const rule = '\\pi + a -> 2a';
    // Here 'a' IS a wildcard matching '3'
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, 3]`);
  });

  it('explicit wildcard in object rule should still work', () => {
    // Users can still use explicit wildcards in object rules
    const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.replace(
      { match: ['Multiply', '_a', 'x'], replace: ['Multiply', 10, 'x'] },
      { recursive: true }
    );
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", "b", ["Multiply", 10, "x"]]`);
  });

  it('subs() workaround should also work for simple substitution', () => {
    // Document that .subs() is the simpler approach for variable substitution
    const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);
    const result = expr.subs({ a: 2 });
    // Note: canonical form may reorder operands
    expect(result).toMatchInlineSnapshot(`["Add", "b", ["Multiply", 2, "x"]]`);
  });
});

describe('matchPermutations option', () => {
  it('default behavior tries permutations for commutative operators', () => {
    // Use non-canonical expression to test permutation matching
    const expr = ce.box(['Add', 'x', 1], { canonical: false });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Should match via permutation: pattern [1, _a] matches expr [x, 1]
    expect(expr.replace(rule)).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
  });

  it('matchPermutations: true explicitly allows permutation matching', () => {
    const expr = ce.box(['Add', 'x', 1], { canonical: false });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    expect(expr.replace(rule, { matchPermutations: true })).toMatchInlineSnapshot(
      `["Multiply", 2, "x"]`
    );
  });

  it('matchPermutations: false disables permutation matching', () => {
    const expr = ce.box(['Add', 'x', 1], { canonical: false });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Without permutations, [1, _a] won't match [x, 1] since positions differ
    expect(expr.replace(rule, { matchPermutations: false })).toBeNull();
  });

  it('matchPermutations: false still matches exact order', () => {
    const expr = ce.box(['Add', 1, 'x'], { canonical: false });
    const rule = { match: ['Add', 1, '_a'], replace: ['Multiply', 2, '_a'] };
    // Exact order matches even without permutations
    expect(expr.replace(rule, { matchPermutations: false })).toMatchInlineSnapshot(
      `["Multiply", 2, "x"]`
    );
  });
});
