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
      |   pi + a
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
            |   The replace expression contains wildcards not present in the match
            |   Skipping rule "\\\\pi + a -> b"


        `);
  });

  it('should handle redundant rules with simplify', () => {
    const expr = ce.parse('\\pi + 3');
    const rule = '0 + a -> a';
    expect(() =>
      expr.simplify({ rules: rule })
    ).toThrowErrorMatchingInlineSnapshot();
  });
});
