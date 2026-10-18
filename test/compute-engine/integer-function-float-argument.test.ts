import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

// A function that is defined only on integers accepts a float with an
// integer value (`5.0`), because the type of that value is `integer`. A
// float argument makes the result a float, as for every numeric function of
// the engine: `Fibonacci(5.0)` is the float `5`, not the exact integer `5`
// (user decision 2026-10-17). A non-integer float stays an error.

const ce = new ComputeEngine();

function isExact(x: Expression): boolean | undefined {
  return isNumber(x) ? x.isExact : undefined;
}

const f = (s: string) => ({ num: s });

// [operator, operands with one float, the value of the result]
const CASES: [string, unknown[], number][] = [
  ['Fibonacci', [f('5.0')], 5],
  ['Lucas', [f('5.0')], 11],
  ['LucasL', [f('5.0')], 11],
  ['BellNumber', [f('4.0')], 15],
  ['CatalanNumber', [f('3.0')], 5],
  ['Subfactorial', [f('4.0')], 9],
  ['Multinomial', [2, f('3.0')], 10],
  ['NthPrime', [f('5.0')], 11],
  ['PrimeNumber', [f('5.0')], 11],
  ['NextPrime', [f('10.0')], 11],
  ['PrimePi', [f('10.0')], 4],
  ['Totient', [f('10.0')], 4],
  ['EulerPhi', [f('10.0')], 4],
  ['PrimeNu', [f('12.0')], 2],
  ['PrimeOmega', [f('12.0')], 3],
  ['MoebiusMu', [f('30.0')], -1],
  ['Radical', [f('12.0')], 6],
  ['PowerMod', [3, 4, f('7.0')], 4],
  ['ModularInverse', [f('3.0'), 7], 5],
  ['IntegerSqrt', [f('17.0')], 4],
  ['CarmichaelLambda', [f('15.0')], 4],
  ['DigitSum', [f('123.0')], 6],
  ['DigitCount', [122, 10, f('2.0')], 2],
  ['DivisorSigma', [1, f('12.0')], 28],
  ['Sigma0', [f('12.0')], 6],
  ['Sigma1', [f('12.0')], 28],
  ['SigmaMinus1', [f('12.0')], 7 / 3],
  ['JacobiSymbol', [2, f('15.0')], 1],
  ['LegendreSymbol', [2, f('7.0')], 1],
  ['MultiplicativeOrder', [f('2.0'), 7], 3],
  ['PrimitiveRoot', [f('7.0')], 3],
  ['RationalReconstruction', [6, f('11.0')], 0.5],
  ['Eulerian', [f('4.0'), 1], 11],
  ['Stirling', [f('4.0'), 2], 7],
  ['StirlingS2', [4, f('2.0')], 7],
  ['StirlingS1', [f('4.0'), 2], 11],
  ['NPartition', [f('5.0')], 7],
  ['PartitionsP', [f('5.0')], 7],
  ['BernoulliB', [f('4.0')], -1 / 30],
  ['FromDigits', [['List', 1, 2], f('10.0')], 12],
  ['FromDigits', [['List', f('1.0'), 2]], 12],
  ['FromContinuedFraction', [['List', f('2.0'), 3]], 7 / 3],
  [
    'ChineseRemainder',
    [
      ['List', f('2.0'), 3, 2],
      ['List', 3, 5, 7],
    ],
    23,
  ],
  ['HurwitzZeta', [f('0.0'), 2], -1.5],
  ['HurwitzZeta', [f('-1.0'), 2], -13 / 12],
  ['LerchPhi', [f('0.0'), 1, 1], 1],
];

describe('AN INTEGER FUNCTION OF A FLOAT ARGUMENT IS A FLOAT', () => {
  test.each(CASES)('%s(%j) is a float', (op, args, value) => {
    const r = ce.box([op, ...args] as any).evaluate();
    expect(isExact(r)).toBe(false);
    expect(r.re).toBeCloseTo(value, 15);
  });

  test.each(CASES)('%s of exact operands is exact', (op, args, value) => {
    // The same call with every float replaced by its exact integer
    const exact = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.map(exact)
        : typeof x === 'object' && x !== null && 'num' in x
          ? Number((x as { num: string }).num)
          : x;
    const r = ce.box([op, ...args.map(exact)] as any).evaluate();
    expect(isExact(r)).toBe(true);
    expect(r.re).toBeCloseTo(value, 15);
  });

  test('the DirichletCharacter value of a float argument is a float', () => {
    const r = ce.box(['DirichletCharacter', 5, 2, f('3.0')]).evaluate();
    expect(isExact(r)).toBe(false);
    expect([r.re, r.im]).toEqual([0, -1]);
    expect(isExact(ce.box(['DirichletCharacter', 5, 2, 3]).evaluate())).toBe(
      true
    );
  });

  test('the parse route gives the same float', () => {
    const r = ce.parse('\\operatorname{Fibonacci}(5.0)').evaluate();
    expect(r.json).toEqual({ num: '5.0' });
    expect(ce.parse('\\operatorname{Totient}(10.0)').evaluate().json).toEqual({
      num: '4.0',
    });
  });

  test('a non-integer float is still an error', () => {
    const r = ce.box(['Fibonacci', f('5.5')]).evaluate();
    expect(r.operator).toBe('Error');
  });

  test('a predicate gives a boolean', () => {
    expect(ce.box(['IsPrime', f('7.0')]).evaluate().json).toEqual('True');
  });
});

// A list or a tuple of integers computed from a float argument has float
// elements, at every depth: `Divisors(12.0)` is `[1.0, 2.0, ..., 12.0]` and
// both the prime and the exponent of each `FactorInteger` pair are floats
// (user decision 2026-10-18).
describe('AN INTEGER LIST FUNCTION OF A FLOAT ARGUMENT HAS FLOAT ELEMENTS', () => {
  // The numbers of a result, at every depth, as `[value, isExact]` pairs
  function numbers(x: Expression): [number, boolean | undefined][] {
    if (isNumber(x)) return [[x.re, x.isExact]];
    return (x.ops ?? []).flatMap(numbers);
  }

  // [operator, operands with one float, the values of the result]
  const LIST_CASES: [string, unknown[], string, number[]][] = [
    ['Divisors', [f('12.0')], 'List', [1, 2, 3, 4, 6, 12]],
    ['PrimeFactors', [f('360.0')], 'List', [2, 3, 5]],
    ['FactorInteger', [f('-12.0')], 'List', [-1, 1, 2, 2, 3, 1]],
    ['IntegerDigits', [f('255.0'), 16], 'List', [15, 15]],
    ['IntegerDigits', [255, 10, f('5.0')], 'List', [0, 0, 2, 5, 5]],
    ['DigitCount', [f('122.0')], 'List', [1, 2, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['PowerModList', [f('4.0'), ['Rational', 1, 2], 7], 'List', [2, 5]],
    ['PrimitiveRootList', [f('7.0')], 'List', [3, 5]],
    ['ExtendedGCD', [f('12.0'), 18], 'Tuple', [6, -1, 1]],
    ['ContinuedFraction', [f('7.0')], 'List', [7]],
    ['ContinuedFraction', [['Rational', 43, 19], f('3.0')], 'List', [2, 3, 1]],
  ];

  test.each(LIST_CASES)(
    '%s(%j) has float elements',
    (op, args, head, values) => {
      const r = ce.box([op, ...args] as any).evaluate();
      expect(r.operator).toBe(head);
      expect(numbers(r)).toEqual(values.map((v) => [v, false]));
    }
  );

  test.each(LIST_CASES)(
    '%s of exact operands has exact elements',
    (op, args, head, values) => {
      const exact = (x: unknown): unknown =>
        Array.isArray(x)
          ? x.map(exact)
          : typeof x === 'object' && x !== null && 'num' in x
            ? Number((x as { num: string }).num)
            : x;
      const r = ce.box([op, ...args.map(exact)] as any).evaluate();
      expect(r.operator).toBe(head);
      expect(numbers(r)).toEqual(values.map((v) => [v, true]));
    }
  );

  test('the elements of FactorInteger are pairs of floats', () => {
    expect(ce.box(['FactorInteger', f('12.0')]).evaluate().json).toEqual([
      'List',
      ['Tuple', { num: '2.0' }, { num: '2.0' }],
      ['Tuple', { num: '3.0' }, { num: '1.0' }],
    ]);
  });

  test('an inexact value expands to float terms', () => {
    const r = ce.box(['ContinuedFraction', ce.parse('\\pi').N(), 5]);
    expect(numbers(r.evaluate())).toEqual(
      [3, 7, 15, 1, 292].map((v) => [v, false])
    );
    expect(numbers(ce.box(['ContinuedFraction', f('2.5')]).evaluate())).toEqual(
      [
        [2, false],
        [2, false],
      ]
    );
  });
});

// `PowerMod` and `PowerModList` are lazy: on the synchronous route their
// handler gets the operands as written, so a symbol whose value is a float
// must be evaluated before the float test. Both routes give the same float.
describe('A LAZY INTEGER FUNCTION OF A SYMBOL WHOSE VALUE IS A FLOAT', () => {
  const ce2 = new ComputeEngine();
  ce2.assign('a', ce2.box(f('2.0')));
  ce2.assign('b', ce2.box(2));

  test.each([
    [['PowerMod', 'a', 10, 1000], { num: '24.0' }],
    [['PowerMod', 'a', ['Rational', 1, 2], 7], { num: '3.0' }],
    [
      ['PowerModList', 'a', 10, 1000],
      ['List', { num: '24.0' }],
    ],
    [['PowerMod', 'b', 10, 1000], 24],
    [
      ['PowerModList', 'b', 10, 1000],
      ['List', 24],
    ],
  ])('%j', async (expr, expected) => {
    const e = ce2.box(expr as any);
    expect(e.evaluate().json).toEqual(expected);
    expect((await e.evaluateAsync()).json).toEqual(expected);
    expect(e.N().json).toEqual(expected);
  });
});

describe('A RATIONAL RESULT UNDER N() IS A FLOAT', () => {
  test.each([
    [['BernoulliB', 1], -0.5],
    [['BernoulliB', 4], -1 / 30],
    [['FromContinuedFraction', ['List', 2, 3]], 7 / 3],
    [['RationalReconstruction', 6, 11], 0.5],
  ])('%j', (expr, value) => {
    const e = ce.box(expr as any);
    expect(isExact(e.evaluate())).toBe(true);
    const n = e.N();
    expect(isExact(n)).toBe(false);
    expect(n.re).toBeCloseTo(value, 15);
  });
});
