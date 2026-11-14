import { ComputeEngine } from '../../src/compute-engine';

//
// `ContinuedFraction` of a quadratic irrational is its periodic form
// (Lagrange's theorem), of another exact real the terms its working precision
// vouches for; `FromContinuedFraction` reads a period back. Reference values
// are Wolfram's `ContinuedFraction` and `FromContinuedFraction`.
//

const ce = new ComputeEngine();
const sqrt = (n: number) => ['Sqrt', n];
const cf = (x: unknown, n?: number) =>
  ce.box(
    n === undefined ? ['ContinuedFraction', x] : ['ContinuedFraction', x, n]
  );

const periodic: [string, unknown, string][] = [
  ['Sqrt(2)', sqrt(2), '[1,[2]]'],
  ['Sqrt(3)', sqrt(3), '[1,[1,2]]'],
  ['Sqrt(7)', sqrt(7), '[2,[1,1,1,4]]'],
  ['golden ratio', ['Divide', ['Add', 1, sqrt(5)], 2], '[1,[1]]'],
  ['1 + Sqrt(2)', ['Add', 1, sqrt(2)], '[2,[2]]'],
  ['(1 + Sqrt(3))/2', ['Divide', ['Add', 1, sqrt(3)], 2], '[1,[2,1]]'],
  [
    '(3 + Sqrt(7))/5',
    ['Divide', ['Add', 3, sqrt(7)], 5],
    '[1,7,[1,2,1,8,13,8]]',
  ],
  ['Sqrt(2)/3', ['Divide', sqrt(2), 3], '[0,2,[8,4]]'],
  ['Sqrt(2/9)', ['Sqrt', ['Rational', 2, 9]], '[0,2,[8,4]]'],
  ['Sqrt(2) Sqrt(3)', ['Multiply', sqrt(2), sqrt(3)], '[2,[2,4]]'],
];
describe('ContinuedFraction of a quadratic irrational', () => {
  for (const [name, x, expected] of periodic) {
    test(`${name} is ${expected} (evaluate and N)`, () => {
      expect(cf(x).evaluate().toString()).toBe(expected);
      expect(cf(x).N().toString()).toBe(expected);
    });
  }

  test('Sqrt(2), 40 is 40 terms; Sqrt(2)/3, 3 is [0, 2, 8]', () => {
    const r = cf(sqrt(2), 40).evaluate();
    expect(r.nops).toBe(40);
    expect(r.toString()).toBe(`[1${',2'.repeat(39)}]`);
    expect(
      cf(['Divide', sqrt(2), 3], 3)
        .evaluate()
        .toString()
    ).toBe('[0,2,8]');
  });

  test('a rational, a perfect square and a float keep the flat list', () => {
    expect(cf(['Rational', 43, 19]).evaluate().toString()).toBe('[2,3,1,4]');
    expect(cf(sqrt(16)).evaluate().toString()).toBe('[4]');
    expect(cf(1.4142135623730951).evaluate().toString()).toMatch(/^\[1,2,2,/);
  });

  test('a sum of two different radicals is not periodic-form', () => {
    const r = cf(['Add', sqrt(2), sqrt(3)])
      .evaluate()
      .toString();
    expect(r).toBe('[3,6,1,5,7,1,1,4,1,38,43,1,3,2,1,1,1,1,2,4]');
  });
});

describe('ContinuedFraction of another exact real', () => {
  const e40 = [
    2, 1, 2, 1, 1, 4, 1, 1, 6, 1, 1, 8, 1, 1, 10, 1, 1, 12, 1, 1, 14, 1, 1, 16,
    1, 1, 18, 1, 1, 20, 1, 1, 22, 1, 1, 24, 1, 1, 26, 1,
  ];
  test('E, 40 is the 40 terms [2; 1, 2, 1, 1, 4, 1, 1, 6, ...]', () => {
    expect(cf('ExponentialE', 40).evaluate().toString()).toBe(
      `[${e40}]`.replace(/ /g, '')
    );
    expect(cf('ExponentialE', 40).N().toString()).toBe(
      `[${e40}]`.replace(/ /g, '')
    );
  });
  test('Pi, 30 is 30 terms', () => {
    expect(cf('Pi', 30).evaluate().toString()).toBe(
      '[3,7,15,1,292,1,1,1,2,1,3,1,14,2,1,1,2,2,2,2,1,84,2,1,1,15,3,13,1,4]'
    );
  });
  test('E without a count is 20 terms', () => {
    expect(cf('ExponentialE').evaluate().nops).toBe(20);
  });
  test('a count beyond the cap declines', () => {
    expect(cf('ExponentialE', 200000).evaluate().operator).toBe(
      'ContinuedFraction'
    );
  });
});

describe('FromContinuedFraction of a periodic expansion', () => {
  const cases: [string, unknown, string][] = [
    ['[1, [2]]', ['List', 1, ['List', 2]], 'sqrt(2)'],
    ['[[1]]', ['List', ['List', 1]], '1/2 + sqrt(5)/2'],
    ['[1, [1]]', ['List', 1, ['List', 1]], '1/2 + sqrt(5)/2'],
    ['[1, 2, [3, 4]]', ['List', 1, 2, ['List', 3, 4]], '1 + sqrt(3)/4'],
  ];
  for (const [name, x, expected] of cases)
    test(`${name} is ${expected}`, () => {
      expect(ce.box(['FromContinuedFraction', x]).evaluate().toString()).toBe(
        expected
      );
    });

  test('N() is a float', () => {
    const v = ce.box(['FromContinuedFraction', ['List', 1, ['List', 2]]]).N();
    expect(v.re).toBeCloseTo(Math.SQRT2, 14);
  });

  test('an empty period and a non-integer term decline', () => {
    for (const x of [
      ['List', 3, ['List']],
      ['List', 1, ['List', 2.5]],
    ])
      expect(ce.box(['FromContinuedFraction', x]).evaluate().operator).toBe(
        'FromContinuedFraction'
      );
  });

  test('round trip: FromContinuedFraction(ContinuedFraction(x)) is x', () => {
    for (const [, x] of periodic) {
      const back = ce.box(['FromContinuedFraction', cf(x).evaluate().json]).N();
      expect(back.re).toBeCloseTo(ce.box(x as any).N().re, 12);
    }
  });
});
