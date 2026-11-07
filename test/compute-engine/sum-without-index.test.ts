import { ComputeEngine } from '../../src/compute-engine';

/**
 * A `Sum` or a `Product` with no indexing set and an operand that is not a
 * collection. When the operand has a free variable (`\sum x^k`), no rule
 * tells which variable is the index, so the operator stays unevaluated. An
 * operand with no free variable is one term and is its own sum or product.
 * (User decision 2026-11-06, CE-961.)
 */
describe('a sum or a product with no index', () => {
  test.each([
    ['\\sum x^k', '["Sum",["Power","x","k"]]'],
    ['\\prod x^k', '["Product",["Power","x","k"]]'],
    ['\\sum \\sin(x)', '["Sum",["Sin","x"]]'],
    ['\\sum (x+1)', '["Sum",["Add","x",1]]'],
  ])('%s with a free variable stays unevaluated', (latex, json) => {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    expect(JSON.stringify(expr.evaluate().json)).toBe(json);
    expect(JSON.stringify(expr.N().json)).toBe(json);
  });

  test('the asynchronous evaluation gives the same result', async () => {
    const ce = new ComputeEngine();
    const sum = await ce.parse('\\sum x^k').evaluateAsync();
    expect(JSON.stringify(sum.json)).toBe('["Sum",["Power","x","k"]]');
    const product = await ce.parse('\\prod x^k').evaluateAsync();
    expect(JSON.stringify(product.json)).toBe('["Product",["Power","x","k"]]');
  });

  test('an operand with no free variable is its own value', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum 5').evaluate().toString()).toBe('5');
    expect(ce.parse('\\prod 5').evaluate().toString()).toBe('5');
    expect(ce.parse('\\sum \\pi').evaluate().toString()).toBe('pi');
    // Variables that have a value are not free.
    ce.assign('x', 2);
    ce.assign('k', 3);
    expect(ce.parse('\\sum x^k').evaluate().toString()).toBe('8');
    expect(ce.parse('\\prod x^k').evaluate().toString()).toBe('8');
  });

  test('an inner sum with no index reads the index of an outer sum, and stays unevaluated when a variable is still free', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{k=1}^{3} \\sum k').evaluate().toString()).toBe('6');
    expect(
      ce.parse('\\sum_{k=1}^{3} \\sum (kx)').evaluate().toString()
    ).toBe('sum(x) + sum(2x) + sum(3x)');
  });

  test('the operator stays unevaluated over the evaluated operand', async () => {
    const ce = new ComputeEngine();
    ce.assign('a', 2);
    ce.declare('x', 'real');
    const sum = ce.box(['Sum', ['Add', 'a', 'x']]);
    const product = ce.box(['Product', ['Add', 'a', 'x']]);
    expect(JSON.stringify(sum.evaluate().json)).toBe('["Sum",["Add","x",2]]');
    expect(JSON.stringify(product.evaluate().json)).toBe(
      '["Product",["Add","x",2]]'
    );
    expect(JSON.stringify((await sum.evaluateAsync()).json)).toBe(
      '["Sum",["Add","x",2]]'
    );
    expect(JSON.stringify((await product.evaluateAsync()).json)).toBe(
      '["Product",["Add","x",2]]'
    );
  });

  test('a sum with an index or over a collection is not changed', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{k=1}^{3} x^k').evaluate().toString()).toBe(
      ce.parse('x + x^2 + x^3').evaluate().toString()
    );
    expect(ce.parse('\\sum [1, 2, 3]').evaluate().toString()).toBe('6');
  });
});
