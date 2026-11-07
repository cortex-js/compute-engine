import { ComputeEngine } from '../../src/compute-engine';
import type { ExpressionInput } from '../../src/compute-engine';

// CE-1028: a product over a finite range of integers whose body is a rational
// function of the index and of a free variable, and telescopes, evaluates to
// its closed form. Before, `evaluate()` multiplied the terms one by one into
// a quotient of two polynomials that was not reduced:
// `Π_{n=1}^{1000} (x + n + 1)/(x + n)` took about four minutes, and its
// integral over [0, 1] timed out, since `Integrate` evaluates a `Product` in
// its integrand first.

const ce = new ComputeEngine();

const product = (
  body: ExpressionInput,
  lower: number,
  upper: number
): ExpressionInput => ['Product', body, ['Limits', 'n', lower, upper]];

// h(n + 1)/h(n) with h(n) = x + n.
const forward: ExpressionInput = [
  'Divide',
  ['Add', 'x', 'n', 1],
  ['Add', 'x', 'n'],
];

describe('CE-1028: a finite telescoping product with a free variable', () => {
  test('the product of 1000 factors is h(1001)/h(1)', () => {
    expect(ce.box(product(forward, 1, 1000)).evaluate().json).toEqual([
      'Divide',
      ['Add', 'x', 1001],
      ['Add', 'x', 1],
    ]);
  });

  test('evaluateAsync() and N() give the same closed form', async () => {
    const expected = ['Divide', ['Add', 'x', 1001], ['Add', 'x', 1]];
    const p = ce.box(product(forward, 1, 1000));
    expect((await p.evaluateAsync()).json).toEqual(expected);
    expect(p.N().json).toEqual(expected);
  });

  test('the mirror orientation h(n)/h(n + 1)', () => {
    const mirror: ExpressionInput = [
      'Divide',
      ['Add', 'x', 'n'],
      ['Add', 'x', 'n', 1],
    ];
    expect(ce.box(product(mirror, 1, 1000)).evaluate().json).toEqual([
      'Divide',
      ['Add', 'x', 1],
      ['Add', 'x', 1001],
    ]);
  });

  test('a range of negative integers', () => {
    expect(ce.box(product(forward, -3, 2)).evaluate().json).toEqual([
      'Divide',
      ['Add', 'x', 3],
      ['Add', 'x', -3],
    ]);
  });

  test('the definite integral of the product is 1 + 1000 ln 2', () => {
    const integral = ce.box([
      'Integrate',
      product(forward, 1, 1000),
      ['Limits', 'x', 0, 1],
    ]);
    expect(integral.evaluate().json).toEqual([
      'Add',
      1,
      ['Multiply', 1000, ['Ln', 2]],
    ]);
  });

  // The term at n = 0 is x/(x·0), which has no value, so the product has
  // none. The closed form h(3)/h(-1) with h(n) = x·n would be -3.
  test('a term with a zero denominator keeps the product without a value', () => {
    const body: ExpressionInput = [
      'Divide',
      ['Multiply', 'x', ['Add', 'n', 1]],
      ['Multiply', 'x', 'n'],
    ];
    expect(ce.box(product(body, -1, 2)).evaluate().json).toEqual('NaN');
  });

  test('an empty range is the empty product 1', () => {
    expect(ce.box(product(forward, 5, 1)).evaluate().json).toEqual(1);
  });

  // The fold evaluates each term, which reads the value of `a`; the closed
  // form must read it too.
  test('an assigned symbol of the body is replaced by its value', () => {
    const engine = new ComputeEngine();
    engine.assign('a', 2);
    const body: ExpressionInput = [
      'Divide',
      ['Add', 'x', 'a', 'n', 1],
      ['Add', 'x', 'a', 'n'],
    ];
    expect(engine.box(product(body, 1, 5)).evaluate().json).toEqual([
      'Divide',
      ['Add', 'x', 8],
      ['Add', 'x', 3],
    ]);
  });

  test('a bound that is an assigned symbol', () => {
    const engine = new ComputeEngine();
    engine.assign('m', 1000);
    expect(
      engine
        .box(['Product', forward, ['Limits', 'n', 1, 'm']])
        .evaluate().json
    ).toEqual(['Divide', ['Add', 'x', 1001], ['Add', 'x', 1]]);
  });

  // With `x` replaced by a number, the body has no free variable and the
  // terms are multiplied one by one: the two values must agree.
  test.each([
    ['forward', forward],
    ['mirror', ['Divide', ['Add', 'x', 'n'], ['Add', 'x', 'n', 1]]],
  ] as [string, ExpressionInput][])(
    'the %s closed form agrees with the product of the terms',
    (_, body) => {
      const closed = ce.box(product(body, -2, 4)).evaluate();
      for (const x of [0.37, 2.5, -7.25]) {
        const terms = ce
          .box(product(body, -2, 4))
          .subs({ x: ce.number(x) })
          .N().re;
        expect(closed.subs({ x: ce.number(x) }).N().re).toBeCloseTo(terms, 12);
      }
    }
  );

  test('a body with no free variable is multiplied term by term', () => {
    expect(
      ce.box(product(['Divide', ['Add', 'n', 1], 'n'], 1, 5)).evaluate().json
    ).toEqual(6);
  });
});
