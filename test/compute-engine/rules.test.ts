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
