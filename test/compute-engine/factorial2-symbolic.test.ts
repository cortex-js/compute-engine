import { ComputeEngine } from '../../src/compute-engine';
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

describe('Factorial2 symbolic reductions (integer-typed argument)', () => {
  // Use a dedicated engine: declaring `n` an integer retypes it for the
  // engine's lifetime, so we isolate it from the shared test engine.
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.assume(['GreaterEqual', 'n', 0]);

  // (2n)!! -> 2^n * n!   (n a nonnegative integer)
  test('reduces (2n)!! to 2^n * n! via simplify', () => {
    const result = ce.parse('(2n)!!').simplify();
    expect(result.toString()).toMatchInlineSnapshot(`n! * 2^n`);
  });

  // (2n+1)!! -> (2n+1)! / (2^n * n!)   (n a nonnegative integer)
  test('reduces (2n+1)!! to (2n+1)! / (2^n * n!) via simplify', () => {
    const result = ce.parse('(2n+1)!!').simplify();
    expect(result.toString()).toMatchInlineSnapshot(`(2n + 1)! / (2^n * n!)`);
  });

  // Numeric verification of the symbolic even reduction by substitution.
  test('(2n)!! reduction matches the literal double factorial', () => {
    const reduced = ce.parse('(2n)!!').simplify();
    for (const k of [1, 2, 3, 4, 5]) {
      const sub = reduced.subs({ n: k }).evaluate();
      const ref = ce.box(['Factorial2', 2 * k]).evaluate();
      expect(sub.isSame(ref)).toBe(true);
    }
  });

  // Numeric verification of the symbolic odd reduction by substitution.
  test('(2n+1)!! reduction matches the literal double factorial', () => {
    const reduced = ce.parse('(2n+1)!!').simplify();
    for (const k of [1, 2, 3, 4, 5]) {
      const sub = reduced.subs({ n: k }).evaluate();
      const ref = ce.box(['Factorial2', 2 * k + 1]).evaluate();
      expect(sub.isSame(ref)).toBe(true);
    }
  });

  // Soundness gate: an undeclared symbol (not known to be an integer) must
  // NOT reduce — the double factorial stays inert.
  test('does NOT reduce (2m)!! for an undeclared symbol m', () => {
    const result = ce.parse('(2m)!!').simplify();
    expect(result.toString()).toMatchInlineSnapshot(`Factorial2(2m)`);
  });

  // Literal regressions: exact evaluation of numeric double factorials.
  test('evaluates 7!! to 105', () => {
    expect(ce.box(['Factorial2', 7]).evaluate().toString()).toBe('105');
  });

  test('evaluates 8!! to 384 (8*6*4*2)', () => {
    expect(ce.box(['Factorial2', 8]).evaluate().toString()).toBe('384');
  });
});
