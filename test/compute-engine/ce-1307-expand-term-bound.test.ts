import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * The multinomial expansion of a power of a sum leaves a power with more
 * than 4096 terms as it is (`MAX_MULTINOMIAL_EXPANSION_TERMS` in
 * `boxed-expression/expand.ts`). `(x^65536 + 1)^65536` has 65537 terms with
 * coefficients of about 20,000 digits: its expansion did not return, from
 * `Expand`, from `simplify()`, or from the antiderivative search (CE-1307).
 */

const ce = new ComputeEngine();

describe('CE-1307: the expansion of a power of a sum has a bound on its terms', () => {
  test('the integral of a polynomial of degree 2^32 times e^x stays unevaluated', () => {
    const result = ce
      .parse('\\int (x^{65536}+1)^{65536} e^{x}\\,dx')
      .evaluate();
    expect(result.operator).toBe('Integrate');
  });

  test('the integral of a polynomial of low degree times e^x still has a closed form', () => {
    const result = ce.parse('\\int (x^{2}+1)^{3} e^{x}\\,dx').evaluate();
    expect(result.has('Integrate')).toBe(false);
    // d/dx of the result is the integrand
    const check = ce
      .expr(['Subtract', ['D', result, 'x'], ce.parse('(x^2+1)^3 e^x')])
      .evaluate()
      .simplify();
    expect(check.isSame(0)).toBe(true);
  });

  test('simplify() returns a product with a power of 65537 terms', () => {
    const expr = ce.parse('x(x^{65536}+1)^{65536}');
    expect(expr.simplify().isSame(expr)).toBe(true);
  });

  test('Expand leaves a power of more than 4096 terms as it is', () => {
    // (x + 1)^4096 has 4097 terms, (x + y + 1)^90 has C(92, 2) = 4186
    for (const latex of ['(x+1)^{4096}', '(x+y+1)^{90}']) {
      const expr = ce.parse(latex);
      expect(ce.expr(['Expand', expr]).evaluate().isSame(expr)).toBe(true);
    }
  });

  test('Expand still expands a power below the bound', () => {
    // (x + y + 1)^10 has C(12, 2) = 66 terms
    const result = ce.expr(['Expand', ce.parse('(x+y+1)^{10}')]).evaluate();
    expect(isFunction(result, 'Add') && result.ops.length).toBe(66);
  });
});
