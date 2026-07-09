import { ComputeEngine } from '../../src/compute-engine';

/**
 * Prose-style fallback for un-applied builtin operators (MathNet corpus,
 * `builtin-symbol-collision` category): a single uppercase-letter symbol
 * bound to a standard-library operator (`N`, `D`) used as a bare operand of
 * a numeric function devolves to an unknown symbol — `N + 1` means a
 * variable, not the numeric-evaluation operator.
 *
 * The devolution shadows the builtin in the current scope, so it is
 * use-order dependent (same convention as type inference). Tests use a
 * fresh engine each to avoid cross-contamination.
 */

function isClean(ce: ComputeEngine, s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

describe('un-applied builtin operator devolves to a symbol', () => {
  test('N in arithmetic contexts', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + M').json).toEqual(['Add', 'M', 'N']);
    expect(ce.parse('N^2').json).toEqual(['Power', 'N', 2]);
    expect(ce.parse('N-2').json).toEqual(['Add', 'N', -2]);
    expect(ce.parse('M=N+1').json).toEqual(['Equal', 'M', ['Add', 'N', 1]]);
  });

  test('repeated occurrences in one expression (re-encounter path)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + N').json).toEqual(['Add', 'N', 'N']);
    expect(ce.parse('N, N+1, N+2, N+3').json).toEqual([
      'Tuple',
      'N',
      ['Add', 'N', 1],
      ['Add', 'N', 2],
      ['Add', 'N', 3],
    ]);
  });

  test('D in arithmetic contexts', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\frac{S}{D}').json).toEqual(['Divide', 'S', 'D']);
  });

  test('devolved symbol gets an inferred numeric type', () => {
    const ce = new ComputeEngine();
    ce.parse('N + 1');
    expect(ce.box('N').type.matches('number')).toBe(true);
  });

  test('geometry labels containing D no longer poison the expression', () => {
    const ce = new ComputeEngine();
    expect(isClean(ce, '(DB+BC)^2=AD^2+AC^2.')).toBe(true);
  });

  test('builtins still work when used applied (fresh engine)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N(3.14159, 2)').evaluate().json).toBe(3.1);
  });

  test('use-order dependence: N(...) after N+1 is a symbolic application', () => {
    // Documented trade-off: once devolved, `N` refers to the variable for
    // the rest of the scope. The application stays symbolic — no crash, no
    // wrong numeric result.
    const ce = new ComputeEngine();
    ce.parse('N + 1');
    const later = ce.parse('N(3.14159, 2)').evaluate();
    expect(later.isValid).toBe(true);
    expect(later.json).not.toBe(3.1);
  });

  test('user-declared functions are NOT devolved', () => {
    const ce = new ComputeEngine();
    ce.declare('F', '(real) -> real');
    const expr = ce.box(['Add', 'F', 1]);
    expect(JSON.stringify(expr.json)).toContain('Error');
  });

  test('multi-letter builtin operators are NOT devolved', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', 'Sin', 1]);
    expect(JSON.stringify(expr.json)).toContain('Error');
  });
});
