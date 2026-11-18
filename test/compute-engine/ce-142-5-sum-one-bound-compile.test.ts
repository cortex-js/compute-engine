import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// CE-142.5: a sum or a product with only one bound has no value. The
// interpreter keeps it unevaluated (`sum-product-one-bound.test.ts`), and
// every compile target declines it for that reason. Before the fix, the
// JavaScript and GLSL targets read the `Nothing` marker of the missing bound
// as a variable, and declined with "`Nothing` … cannot be read as a
// variable".

const ce = new ComputeEngine();

const TARGETS = ['javascript', 'glsl', 'interval-js'];

describe('CE-142.5 a sum with one bound on the compile targets', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test.each([
    ['\\sum_{k=1} k', 'sum'],
    ['\\sum_{k}^{10} k', 'sum'],
    ['\\sum^{10} k', 'sum'],
    ['\\prod_{k=1} k', 'product'],
  ])('%s', (latex) => {
    const expr = ce.parse(latex);
    for (const to of TARGETS) {
      const result = compile(expr, { to } as Parameters<typeof compile>[1]);
      expect(result.success).toBe(false);
      // The interval mode of the IR pipeline declines the `Nothing` marker
      // of the missing bound.
      if (to === 'interval-js') {
        expect(result.diagnostic?.code).toBe('possible-nothing');
        continue;
      }
      // The compiler refuses the `Nothing` marker of the missing bound.
      expect(String(result.error)).toContain('Nothing as a value');
    }
  });

  test('the fallback gives the value of the interpreter', () => {
    const expr = ce.parse('\\sum_{k=1} k');
    const result = compile(expr);
    expect(result.run).toBeDefined();
    expect(expr.evaluate().json).toEqual(['Sum', 'k', ['Limits', 'k', 1, 'Nothing']]);
  });

  test('a sum with two bounds still compiles', () => {
    const result = compile(ce.parse('\\sum_{k=1}^{10} k'));
    expect(result.success).toBe(true);
    expect(result.run!()).toBe(55);
  });
});
