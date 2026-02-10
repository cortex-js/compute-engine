import {
  ComputeEngine,
  parse,
  simplify,
  evaluate,
  N,
  assign,
  expand,
  expandAll,
  factor,
  solve,
  compile,
  getDefaultEngine,
} from '../../src/compute-engine';

describe('Free Functions', () => {
  test('parse() returns a BoxedExpression', () => {
    const result = parse('x^2');
    expect(result).toBeDefined();
    expect(result.operator).toBe('Power');
  });

  test('simplify() simplifies a LaTeX string', () => {
    const result = simplify('x + x + 1');
    expect(result.toString()).toBe('2x + 1');
  });

  test('simplify() simplifies an existing BoxedExpression', () => {
    const expr = parse('x + x + 1');
    const result = simplify(expr);
    expect(result.toString()).toBe('2x + 1');
  });

  test('evaluate() evaluates a LaTeX string', () => {
    const result = evaluate('2^{11} - 1');
    expect(result.toString()).toBe('2047');
  });

  test('evaluate() evaluates an existing BoxedExpression', () => {
    const expr = parse('2^{11} - 1');
    const result = evaluate(expr);
    expect(result.toString()).toBe('2047');
  });

  test('N() returns numeric approximation from LaTeX', () => {
    const result = N('\\sqrt{2}');
    expect(result).toBeDefined();
    expect(result.isNumber).toBe(true);
    // Should be a decimal, not symbolic
    expect(result.toString()).not.toBe('Sqrt(2)');
  });

  test('N() returns numeric approximation from BoxedExpression', () => {
    const expr = parse('\\sqrt{2}');
    const result = N(expr);
    expect(result).toBeDefined();
    expect(result.isNumber).toBe(true);
  });

  test('assign() + evaluate() uses assigned value', () => {
    const ce = getDefaultEngine();
    ce.assign('t', 3);
    const result = evaluate('t + 2');
    expect(result.toString()).toBe('5');
    // Reset by forgetting the symbol
    ce.forget('t');
  });

  test('assign() bulk assignment works', () => {
    const ce = getDefaultEngine();
    ce.assign({ u: 10, v: 20 });
    const result = evaluate('u + v');
    expect(result.toString()).toBe('30');
    // Reset
    ce.forget(['u', 'v']);
  });

  test('getDefaultEngine() returns a ComputeEngine instance', () => {
    const engine = getDefaultEngine();
    expect(engine).toBeInstanceOf(ComputeEngine);
  });

  test('getDefaultEngine() returns the same instance on repeated calls', () => {
    const a = getDefaultEngine();
    const b = getDefaultEngine();
    expect(a).toBe(b);
  });

  test('free functions share the same engine', () => {
    assign('w', 42);
    // evaluate uses the same engine where w was assigned
    const result = evaluate('w');
    expect(result.toString()).toBe('42');
    // Reset
    getDefaultEngine().forget('w');
  });

  test('expand() expands a LaTeX string', () => {
    const result = expand('(x+1)^2');
    expect(result).not.toBeNull();
    expect(result!.latex).toBe('x^2+2x+1');
  });

  test('expand() expands a BoxedExpression', () => {
    const expr = parse('(x+1)(x+2)');
    const result = expand(expr);
    expect(result).not.toBeNull();
    expect(result!.latex).toBe('x^2+3x+2');
  });

  test('solve() solves from a LaTeX string', () => {
    const result = solve('x^2 - 5x + 6 = 0', 'x');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    const values = (result as any[]).map((r) => r.valueOf());
    expect(values).toContain(2);
    expect(values).toContain(3);
  });

  test('solve() solves from a BoxedExpression', () => {
    const expr = parse('x^2 - 5x + 6 = 0');
    const result = solve(expr, 'x');
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    const values = (result as any[]).map((r) => r.valueOf());
    expect(values).toContain(2);
    expect(values).toContain(3);
  });

  test('expandAll() expands from a LaTeX string', () => {
    const result = expandAll('(x+1)(x+2) + (a+b)^2');
    expect(result).not.toBeNull();
  });

  test('expandAll() expands from a BoxedExpression', () => {
    const expr = parse('(x+1)^2');
    const result = expandAll(expr);
    expect(result).not.toBeNull();
    expect(result!.latex).toBe('x^2+2x+1');
  });

  test('factor() factors from a LaTeX string', () => {
    const result = factor('(2x)(4y)');
    expect(result).toBeDefined();
    expect(result.latex).toBe('8xy');
  });

  test('factor() factors from a BoxedExpression', () => {
    const expr = parse('(2x)(4y)');
    const result = factor(expr);
    expect(result).toBeDefined();
    expect(result.latex).toBe('8xy');
  });

  test('compile() compiles from a LaTeX string', () => {
    const result = compile('x^2 + 1');
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(typeof result.code).toBe('string');
  });

  test('compile() compiles from a BoxedExpression', () => {
    const expr = parse('x^2 + 1');
    const result = compile(expr);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
});
