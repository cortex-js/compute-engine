import {
  ComputeEngine,
  parse,
  simplify,
  evaluate,
  N,
  assign,
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
});
