import { ComputeEngine } from '../../src/compute-engine';

// The closed forms that `simplify()` gives for a `Sum` or a `Product` over
// `Limits(n, a, b)` with a symbolic upper bound `b`.
//
// For a symbolic bound the closed form is the generic answer, as in
// Mathematica: it fires for an undeclared `b`. It equals the finite sum or
// product for every `b ≥ a − 1`. Below that it is the continuation of the
// closed form, not the empty sum 0 or the empty product 1 (user decision
// 2026-10-19). A NUMERIC empty range (`b < a`) evaluates to 0 or 1.

type Case = [op: 'sum' | 'prod', body: string, lower: number];

const CASES: Case[] = [
  ['prod', '3', 1],
  ['prod', 'n', 1],
  ['prod', 'n+3', 1],
  ['prod', '\\frac{n+1}{n}', 1],
  ['prod', '1-\\frac{1}{n^2}', 2],
  ['prod', '1-\\frac{1}{n^2}', 3],
  ['prod', '2n-1', 1],
  ['prod', '2n', 1],
  ['prod', '3n', 1],
  ['prod', 'xn', 1],
  ['prod', 'x+n', 0],
  ['prod', 'x-n', 0],
  ['sum', '3', 1],
  ['sum', 'n', 1],
  ['sum', 'n', 3],
  ['sum', 'n^2', 1],
  ['sum', 'n^3', 1],
  ['sum', '(-1)^n', 0],
  ['sum', '(-1)^n n', 0],
  ['sum', '2+3n', 0],
  ['sum', '2+3n', 2],
  ['sum', '2^n', 0],
  ['sum', '2^n', 1],
  ['sum', 'n(n+1)', 1],
  ['sum', '\\frac{1}{n(n+1)}', 1],
  ['sum', '\\frac{1}{n(n-1)}', 2],
];

const latex = (op: string, body: string, lower: number, upper: string) =>
  `\\${op}_{n=${lower}}^{${upper}}(${body})`;

const head = (op: string) => (op === 'sum' ? 'Sum' : 'Product');

describe('an empty range with numeric bounds', () => {
  test.each(CASES)(
    '%s %s from %p evaluates to the empty sum or product',
    (op, body, lower) => {
      const ce = new ComputeEngine();
      for (const b of [lower - 3, lower - 2, lower - 1]) {
        const v = ce
          .parse(latex(op, body, lower, String(b)))
          .evaluate()
          .toString();
        expect([b, v]).toEqual([b, op === 'sum' ? '0' : '1']);
      }
    }
  );
});

describe('the generic closed form for an undeclared upper bound', () => {
  // The closed form fires, and it equals the finite value at every
  // b from a − 1 up.
  test.each(CASES)('%s %s from %p', (op, body, lower) => {
    const ce = new ComputeEngine();
    const s = ce.parse(latex(op, body, lower, 'b')).simplify();
    expect(s.has(head(op))).toBe(false);
    for (let b = lower - 1; b <= lower + 3; b++) {
      const closed = s.subs({ b, x: 7 }).evaluate();
      const direct = ce
        .parse(latex(op, body, lower, String(b)))
        .subs({ x: 7 })
        .evaluate();
      expect([b, closed.toString()]).toEqual([b, direct.toString()]);
    }
  });

  test('below a − 1 the closed form is its continuation, not the empty product', () => {
    const ce = new ComputeEngine();
    const s = ce.parse('\\prod_{n=1}^{b}(2n-1)').simplify();
    expect(s.toString()).toBe('Factorial2(2b - 1)');
    // At b = −1 the closed form is (−3)!! = −1, while the empty product
    // with numeric bounds is 1.
    expect(s.subs({ b: -1 }).evaluate().toString()).toBe('-1');
    expect(ce.parse('\\prod_{n=1}^{-1}(2n-1)').evaluate().toString()).toBe('1');
  });

  test('the Wallis-like product from 1 is 0', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\prod_{n=1}^{b}(1-\\frac{1}{n^2})').simplify().toString()
    ).toBe('0');
  });
});

describe('binomial sums', () => {
  // The bound is also the first argument of the binomial. Each closed form
  // equals the finite sum for n ≥ 0.
  const BODIES = [
    '\\binom{N}{k}',
    'k\\binom{N}{k}',
    'k^2\\binom{N}{k}',
    'k^3\\binom{N}{k}',
  ];
  const tex = (body: string, n: string) =>
    `\\sum_{k=0}^{${n}}${body.replace(/N/g, n)}`;

  test.each(BODIES)(
    '%s has a closed form that agrees with the finite sum for n ≥ 0',
    (body) => {
      const ce = new ComputeEngine();
      const s = ce.parse(tex(body, 'n')).simplify();
      expect(s.has('Sum')).toBe(false);
      for (let n = 0; n <= 5; n++) {
        const closed = s.subs({ n }).evaluate().toString();
        const direct = ce
          .parse(tex(body, String(n)))
          .evaluate()
          .toString();
        expect([n, closed]).toEqual([n, direct]);
      }
    }
  );

  test('the sum of squares C(2n, n) is right for every integer n', () => {
    // C(2n, n) is 0 for a negative n, the value of the empty sum.
    const ce = new ComputeEngine();
    const s = ce.parse(tex('\\binom{N}{k}^2', 'n')).simplify();
    expect(s.toString()).toBe('Binomial(2n, n)');
    for (let n = -3; n <= 4; n++) {
      const closed = s.subs({ n }).evaluate().toString();
      const direct = ce
        .parse(tex('\\binom{N}{k}^2', String(n)))
        .evaluate()
        .toString();
      expect([n, closed]).toEqual([n, direct]);
    }
  });
});
