import { engine, evaluate, N } from '../utils';

describe('Factorial2 (double factorial) with symbolic arguments', () => {
  test('(2n)!! parses and evaluates symbolically, no Error node', () => {
    const expr = engine.parse('(2n)!!');
    expect(expr.toString()).not.toContain('Error');
    const result = expr.evaluate();
    expect(result.toString()).not.toContain('Error');
    expect(result.toString()).toBe('Factorial2(2n)');
  });

  test('n!! parses and evaluates symbolically, no Error node', () => {
    const expr = engine.parse('n!!');
    expect(expr.toString()).not.toContain('Error');
    const result = expr.evaluate();
    expect(result.toString()).not.toContain('Error');
    expect(result.toString()).toBe('Factorial2(n)');
  });

  test('numeric double factorials remain exact', () => {
    expect(evaluate('8!!')).toBe('384');
    expect(evaluate('9!!')).toBe('945');
    expect(evaluate('0!!')).toBe('1');
  });

  test('.N() of a numeric case is unchanged', () => {
    expect(N('8!!')).toBe('384');
  });

  test('(2n)!! round-trips through LaTeX with !!', () => {
    const expr = engine.parse('(2n)!!');
    expect(expr.latex).toBe('(2n)!!');
  });
});
