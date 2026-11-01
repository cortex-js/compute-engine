import { ComputeEngine } from '../../src/compute-engine';

// A closed form of a `Sum` or a `Product` substitutes its bounds for the
// index, and the enumeration of the same operator rounds a numeric bound
// down. So a bound proved not to be an integer (a number such as 2.5, or a
// symbol declared `real`) is not put into a closed form: the operator stays
// symbolic, and both orders (closed form then substitution, substitution
// then evaluation) give the value of the enumeration. A symbol declared
// `integer`, or an undeclared symbol (a generic value), keeps the closed
// form.

const TELESCOPING = (b: string) =>
  `\\sum_{k=1}^{${b}} \\left(\\frac{1}{k}-\\frac{1}{k+1}\\right)`;
const FACTORIAL = (b: string) => `\\prod_{k=1}^{${b}} k`;

describe('a bound declared real is not put into a closed form', () => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');

  test.each([
    [TELESCOPING('y'), '2/3'],
    [FACTORIAL('y'), '2'],
    [`\\sum_{k=1}^{y} k`, '3'],
    [`\\prod_{k=1}^{y} \\frac{k+1}{k}`, '3'],
  ])('%s at y = 2.5 is %s in each order', (latex, expected) => {
    const e = ce.parse(latex);
    // Substitution, then evaluation: the enumeration over k = 1, 2.
    expect(e.subs({ y: 2.5 }).evaluate().toString()).toBe(expected);
    // evaluate(), then substitution.
    const viaEvaluate = e.evaluate().subs({ y: 2.5 }).evaluate();
    expect(viaEvaluate.toString()).toBe(expected);
    // simplify(), then substitution.
    const viaSimplify = e.simplify().subs({ y: 2.5 }).evaluate();
    expect(viaSimplify.toString()).toBe(expected);
  });

  test('the operator stays symbolic', () => {
    expect(ce.parse(TELESCOPING('y')).evaluate().operator).toBe('Sum');
    expect(ce.parse(FACTORIAL('y')).evaluate().operator).toBe('Product');
    expect(ce.parse(FACTORIAL('y')).simplify().operator).toBe('Product');
    expect(ce.parse(FACTORIAL('y+1')).evaluate().operator).toBe('Product');
  });
});

describe('an integer or undeclared bound keeps the closed form', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');

  test('a bound declared integer', () => {
    expect(ce.parse(TELESCOPING('n')).evaluate().toString()).toBe(
      '1 - 1 / (n + 1)'
    );
    expect(ce.parse(FACTORIAL('n')).evaluate().toString()).toBe('n!');
    expect(ce.parse(FACTORIAL('n+1')).evaluate().toString()).toBe('(n + 1)!');
    expect(ce.parse(FACTORIAL('n')).simplify().toString()).toBe('n!');
    expect(ce.parse('\\sum_{k=1}^{2n} k').simplify().toString()).toBe(
      '2n^2 + n'
    );
  });

  test('a bound whose type is an integer or an infinity', () => {
    // `n!` has the type `infinity | integer`, and `Length(L)` the type
    // `integer | signed_infinity`: each finite value is an integer.
    expect(ce.parse('\\sum_{k=1}^{n!} k').simplify().operator).not.toBe('Sum');
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<integer>');
    expect(
      ce2.box(['Sum', 'k', ['Limits', 'k', 1, ['Length', 'L']]]).simplify()
        .operator
    ).not.toBe('Sum');
  });

  test('a fractional bound built from a symbol declared integer', () => {
    // `n/2` and `n + 1/2` have the type `rational`: at n = 5, the closed
    // forms gave 4.375 for Σ k and Γ(3.5) for Π k, where the enumeration up
    // to 2 gives 3 and 2.
    for (const b of ['n/2', 'n+\\frac12']) {
      expect(ce.parse(`\\sum_{k=1}^{${b}} k`).simplify().operator).toBe('Sum');
      expect(ce.parse(`\\sum_{k=1}^{${b}} k`).evaluate().operator).toBe('Sum');
      expect(ce.parse(FACTORIAL(b)).evaluate().operator).toBe('Product');
      expect(ce.parse(FACTORIAL(b)).simplify().operator).toBe('Product');
    }
    expect(
      ce.parse('\\sum_{k=1}^{n/2} k').subs({ n: 5 }).evaluate().toString()
    ).toBe('3');
  });

  test('an undeclared bound', () => {
    expect(ce.parse(TELESCOPING('u')).evaluate().toString()).toBe(
      '1 - 1 / (u + 1)'
    );
    expect(ce.parse(FACTORIAL('u')).evaluate().toString()).toBe('u!');
    expect(ce.parse(FACTORIAL('u')).simplify().toString()).toBe('u!');
    // `u − 1` has the type `number`, but `u` is not declared.
    expect(
      ce
        .parse('\\prod_{k=1}^{u-1} \\left(1+\\frac{1}{k}\\right)')
        .evaluate()
        .toString()
    ).toBe('u');
  });
});

describe('a numeric bound that is not an integer', () => {
  const ce = new ComputeEngine();

  test('evaluate() enumerates up to the integer below the bound', () => {
    expect(ce.parse(TELESCOPING('2.5')).evaluate().toString()).toBe('2/3');
    expect(ce.parse(FACTORIAL('2.5')).evaluate().toString()).toBe('2');
  });

  test('simplify() gives no closed form', () => {
    // The closed forms gave 1 − 1/3.5 and Γ(3.5).
    expect(ce.parse(TELESCOPING('2.5')).simplify().operator).toBe('Sum');
    expect(ce.parse(FACTORIAL('2.5')).simplify().operator).toBe('Product');
  });
});
