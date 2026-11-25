import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

/** `Mod(x, m)` through the hooks. */
const hooked = (x: unknown, m: number, d?: number): string =>
  ce
    .box(d === undefined ? ['Mod', x, m] : ['Mod', x, m, d])
    .evaluate()
    .toString();

/** The reference: the operand evaluated fully, then `Mod`. */
const reference = (x: unknown, m: number, d?: number): string => {
  const value: Expression = ce.box(x as never).evaluate();
  return ce
    .function(
      'Mod',
      d === undefined
        ? [value, ce.number(m)]
        : [value, ce.number(m), ce.number(d)]
    )
    .evaluate()
    .toString();
};

describe('evaluateMod: Mod(x, m) agrees with the evaluated operand', () => {
  const cases: [string, unknown, number][] = [
    [
      '2*Fibonacci(200) + 3',
      ['Add', ['Multiply', 2, ['Fibonacci', 200]], 3],
      97,
    ],
    [
      'Factorial(30) - 7^20',
      ['Subtract', ['Factorial', 30], ['Power', 7, 20]],
      1000003,
    ],
    [
      'nested Power',
      ['Power', ['Power', ['Add', ['Fibonacci', 50], 1], 3], 4],
      1009,
    ],
    ['Negate', ['Negate', ['Fibonacci', 60]], 101],
    ['negative value', ['Subtract', 5, ['Factorial', 25]], 13],
    ['negative power base', ['Power', ['Negate', ['Fibonacci', 40]], 5], 11],
    ['zero exponent', ['Power', ['Fibonacci', 40], 0], 7],
    [
      'Multiply of sums',
      [
        'Multiply',
        ['Add', ['Fibonacci', 30], 5],
        ['Subtract', ['Factorial', 12], 3],
      ],
      997,
    ],
  ];
  for (const [name, x, m] of cases)
    test(`${name} mod ${m} = ${reference(x, m)}`, () => {
      expect(hooked(x, m)).toBe(reference(x, m));
    });

  const offsets: [string, unknown, number, number][] = [
    ['Fibonacci(200)', ['Fibonacci', 200], 97, 5],
    [
      '2*Factorial(20) - 9',
      ['Subtract', ['Multiply', 2, ['Factorial', 20]], 9],
      1000,
      -4,
    ],
    ['negative offset', ['Add', ['Power', 3, 40], 1], 50, -20],
  ];
  for (const [name, x, n, d] of offsets)
    test(`Mod(${name}, ${n}, ${d}) = ${reference(x, n, d)}`, () => {
      expect(hooked(x, n, d)).toBe(reference(x, n, d));
    });

  test('the result is an integer in [0, m)', () => {
    const r = ce
      .box(['Mod', ['Subtract', 5, ['Factorial', 25]], 13])
      .evaluate();
    expect(r.isInteger).toBe(true);
    expect(Number(r.re)).toBeGreaterThanOrEqual(0);
    expect(Number(r.re)).toBeLessThan(13);
  });
});

describe('evaluateMod: PowerMod', () => {
  const cases: [unknown, number, number][] = [
    [['Add', ['Fibonacci', 30], 2], 5, 1000],
    [['Subtract', ['Factorial', 15], 1], 0, 7],
    [['Multiply', 3, ['Power', 2, 70]], 12, 10007],
  ];
  for (const [a, e, m] of cases) {
    const full = ce.box(a as never).evaluate();
    const expected = ce.box(['PowerMod', full, e, m]).evaluate().toString();
    test(`PowerMod(${full}, ${e}, ${m}) = ${expected}`, () => {
      expect(ce.box(['PowerMod', a, e, m]).evaluate().toString()).toBe(
        expected
      );
    });
  }
  test('a rational base keeps its handling', () => {
    expect(
      ce
        .box(['PowerMod', ['Rational', 1, 2], 2, 7])
        .evaluate()
        .toString()
    ).toBe('2');
  });
  test('a negative exponent declines the hook and still evaluates', () => {
    const a = ['Add', ['Fibonacci', 10], 2];
    expect(ce.box(['PowerMod', a, -1, 7]).evaluate().toString()).toBe(
      ce.box(['PowerMod', 57, -1, 7]).evaluate().toString()
    );
  });
});

describe('evaluateMod: a test-only operator', () => {
  const ce2 = new ComputeEngine();
  let evaluated = 0;
  let hookCalls = 0;
  ce2.declare('Huge', {
    signature: '(integer) -> integer',
    evaluate: () => {
      evaluated += 1;
      throw new Error('Huge is never evaluated');
    },
    // Huge(n) = n^2
    evaluateMod: ([n], m, { mod }) => {
      hookCalls += 1;
      const r = mod(n);
      return r === undefined ? undefined : (r * r) % m;
    },
  });
  beforeEach(() => {
    evaluated = 0;
    hookCalls = 0;
  });

  test('Mod(Huge(10^9), 7) reaches the hook and never evaluates the operand', () => {
    // 10^18 mod 7
    expect(
      ce2
        .box(['Mod', ['Huge', 1000000000], 7])
        .evaluate()
        .toString()
    ).toBe('1');
    expect(hookCalls).toBe(1);
    expect(evaluated).toBe(0);
  });

  test('the hooks nest through the core operators', () => {
    // (2 * 5^2 + 3) mod 97 = 53
    const r = ce2
      .box(['Mod', ['Add', ['Multiply', 2, ['Huge', 5]], 3], 97])
      .evaluate();
    expect(r.toString()).toBe('53');
    expect(evaluated).toBe(0);
  });

  test('the offset form reaches the hook through Mod(x - d, n)', () => {
    // 25 = 3 + Mod(22, 7) = 3 + 1
    expect(
      ce2
        .box(['Mod', ['Huge', 5], 7, 3])
        .evaluate()
        .toString()
    ).toBe('4');
    expect(evaluated).toBe(0);
  });

  test('PowerMod calls the hook for its base', () => {
    // (5^2)^3 mod 1000 = 625
    expect(
      ce2
        .box(['PowerMod', ['Huge', 5], 3, 1000])
        .evaluate()
        .toString()
    ).toBe('625');
    expect(hookCalls).toBe(1);
    expect(evaluated).toBe(0);
  });

  test('a declining hook falls through to the evaluation', () => {
    // Huge(x) over a symbol: the hook declines, then the evaluation throws
    ce2.declare('x', 'integer');
    expect(() => ce2.box(['Mod', ['Huge', 'x'], 7]).evaluate()).toThrow();
    expect(hookCalls).toBe(1);
  });
});

describe('evaluateMod: calls the hook does not take', () => {
  const ce3 = new ComputeEngine();
  let hookCalls = 0;
  ce3.declare('Square', {
    signature: '(integer) -> integer',
    evaluate: ([n]) => n.mul(n),
    evaluateMod: ([n], m, { mod }) => {
      hookCalls += 1;
      const r = mod(n);
      return r === undefined ? undefined : (r * r) % m;
    },
  });
  beforeEach(() => {
    hookCalls = 0;
  });

  test('.N() does not call the hook', () => {
    expect(
      ce3
        .box(['Mod', ['Square', 9], 7])
        .N()
        .toString()
    ).toBe('4');
    expect(hookCalls).toBe(0);
  });

  const unchanged: [string, unknown][] = [
    ['modulus 1', ['Mod', ['Square', 9], 1]],
    ['modulus 0', ['Mod', ['Square', 9], 0]],
    ['negative modulus', ['Mod', ['Square', 9], -7]],
    ['rational modulus', ['Mod', ['Square', 9], ['Rational', 7, 2]]],
    ['list modulus', ['Mod', ['Square', 9], ['List', 7, 5]]],
    ['float operand', ['Mod', ['Multiply', 2.5, ['Square', 3]], 7]],
  ];
  for (const [name, expr] of unchanged)
    test(`${name} gives today's value`, () => {
      const full = ce3.box(expr as never);
      const [x, ...rest] = full.ops!;
      const expected = ce3
        .function('Mod', [x.evaluate(), ...rest])
        .evaluate()
        .toString();
      expect(full.evaluate().toString()).toBe(expected);
      expect(hookCalls).toBe(0);
    });

  test('a rational stays a rational', () => {
    expect(
      ce3
        .box(['Mod', ['Rational', 1, 3], 7])
        .evaluate()
        .toString()
    ).toBe('1/3');
  });

  test('a list dividend still broadcasts', () => {
    expect(
      ce3
        .box(['Mod', ['List', 10, 11, 12], 7])
        .evaluate()
        .toString()
    ).toBe('[3,4,5]');
  });

  test('Mod keeps its integer type', () => {
    expect(ce3.box(['Mod', ['Square', 9], 7]).type.toString()).toBe('integer');
  });

  test('redefining evaluate drops the stale hook', () => {
    const ce4 = new ComputeEngine();
    ce4.declare('Add', { evaluate: () => undefined }, { extend: true });
    expect(
      ce4.box(['Add', 1, 2]).operatorDefinition?.evaluateMod
    ).toBeUndefined();
  });
});
