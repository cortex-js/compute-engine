import { ComputeEngine } from '../../src/compute-engine';

/**
 * Under `.N()`, an operand at an `integer`-typed parameter is evaluated
 * exactly, so an integer operation reads the integer it stands for
 * (`exactIntegerOperand()` in `boxed-expression/boxed-function.ts`). The
 * float of a large integer is rounded to the working precision before the
 * handler reads it as an integer (`toBigint` on a rounded big decimal):
 * `DigitSum(2^1000).N()` was 84 where the digit sum is 1366.
 *
 * `Mod`, `GCD` and `LCM` have real or open parameters and read the operand
 * as written instead (`exactModUnderN()`, `exactIntegerOriginals()` in
 * `library/arithmetic.ts`). `GCD` and `LCM` of exact integers are computed
 * with bigint arithmetic at any magnitude: the accumulator was a machine
 * number or a big decimal at the working precision, and `GCD(2^100, 2^50)`
 * gave 2048 where the answer is `2^50`.
 *
 * Reference values (bigint computations):
 *   DigitSum(2^1000)                     = 1366
 *   Σ_{n=1}^{1000} (n^n mod 10^10)       = 4629110846700
 *   999^999 mod 10^10                    = 499998999
 *   2^50                                 = 1125899906842624
 *   2^60 · 3^40                          = 14016833953562607293918185758734155776
 */

const ce = new ComputeEngine();

describe('an integer-typed operand is read exactly under .N()', () => {
  test('DigitSum of a large power', () => {
    const e = ce.box(['DigitSum', ['Power', 2, 1000]]);
    expect(e.evaluate().json).toBe(1366);
    expect(e.N().json).toBe(1366);
  });

  test('DigitSum of a bound index inside a Sum', () => {
    const e = ce.box([
      'Sum',
      ['DigitSum', ['Power', 2, 'n']],
      ['Limits', 'n', 1000, 1000],
    ]);
    expect(e.N().json).toBe(1366);
  });

  test('a float operand keeps its value', () => {
    expect(ce.box(['DigitSum', 1234.0]).N().json).toBe(10);
  });

  test('an unknown operand stays symbolic', () => {
    expect(ce.box(['DigitSum', 'x']).N().json).toEqual(['DigitSum', 'x']);
  });

  test('Binomial and Fibonacci of exact arguments', () => {
    expect(ce.box(['Binomial', 100, 50]).N().json).toEqual(
      ce.box(['Binomial', 100, 50]).evaluate().json
    );
    expect(ce.box(['Fibonacci', 100]).N().json).toEqual(
      ce.box(['Fibonacci', 100]).evaluate().json
    );
  });

  test('the operand is evaluated once', async () => {
    // The exact evaluation of the operand stays symbolic (`x` is unknown).
    // Its numeric value must be computed from that result, not by evaluating
    // the operand again, which would apply the assignment a second time.
    const engine = new ComputeEngine();
    engine.declare('c', 'integer');
    const e = engine.box([
      'DigitSum',
      ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'x'],
    ]);
    engine.assign('c', 0);
    expect(e.N().json).toEqual(['DigitSum', 'x']);
    expect(engine.box('c').evaluate().json).toBe(1);
    engine.assign('c', 0);
    await e.evaluateAsync({ numericApproximation: true });
    expect(engine.box('c').evaluate().json).toBe(1);
  });

  test('the asynchronous route agrees', async () => {
    const e = ce.box(['DigitSum', ['Power', 2, 1000]]);
    expect((await e.evaluateAsync({ numericApproximation: true })).json).toBe(
      1366
    );
  });
});

describe('Mod of a large power under .N()', () => {
  test('a bound index whose power is beyond the double range', () => {
    const e = ce.box([
      'Sum',
      ['Mod', ['Power', 'n', 'n'], ['Power', 10, 10]],
      ['Limits', 'n', 999, 999],
    ]);
    expect(e.evaluate().json).toBe(499998999);
    // Under `.N()` the remainder of a float dividend is boxed as a float.
    expect(e.N().re).toBe(499998999);
  });

  test('the sum of the remainders of n^n (Project Euler 48)', () => {
    const e = ce.box([
      'Sum',
      ['Mod', ['Power', 'n', 'n'], ['Power', 10, 10]],
      ['Limits', 'n', 1, 1000],
    ]);
    expect(e.evaluate().json).toBe(4629110846700);
    expect(e.N().re).toBe(4629110846700);
  });

  test('an assigned symbol', () => {
    const engine = new ComputeEngine();
    engine.assign('n', 999);
    const e = engine.box(['Mod', ['Power', 'n', 'n'], ['Power', 10, 10]]);
    expect(e.N().re).toBe(499998999);
  });
});

describe('GCD and LCM of exact integers at any magnitude', () => {
  test('GCD of powers of 2', () => {
    const e = ce.box(['GCD', ['Power', 2, 100], ['Power', 2, 50]]);
    expect(e.evaluate().json).toBe(1125899906842624);
    expect(e.N().json).toBe(1125899906842624);
  });

  test('GCD(2^100, 6^50) is 2^50', () => {
    const e = ce.box(['GCD', ['Power', 2, 100], ['Power', 6, 50]]);
    expect(e.evaluate().json).toBe(1125899906842624);
    expect(e.N().json).toBe(1125899906842624);
  });

  test('LCM(2^60, 3^40) is their product', () => {
    const e = ce.box(['LCM', ['Power', 2, 60], ['Power', 3, 40]]);
    expect(e.evaluate().json).toEqual({
      num: '14016833953562607293918185758734155776',
    });
    expect(e.N().json).toEqual({
      num: '14016833953562607293918185758734155776',
    });
  });

  test('small integers, a negative, zero and a list are unchanged', () => {
    expect(ce.box(['GCD', 12, 18]).evaluate().json).toBe(6);
    expect(ce.box(['GCD', -12, 18]).evaluate().json).toBe(6);
    expect(ce.box(['GCD', 0, 0]).evaluate().json).toBe(0);
    expect(ce.box(['GCD', ['List', 12, 18], 24]).evaluate().json).toBe(6);
    expect(ce.box(['LCM', 4, 6, 10]).evaluate().json).toBe(60);
    expect(ce.box(['LCM', 0, 5]).evaluate().json).toBe(0);
  });

  test('a float operand keeps the float lane', () => {
    // `4.0` in MathJSON is the integer 4; the float is spelled `{num: '4.0'}`.
    const r = ce.box(['GCD', { num: '4.0' }, 6]).evaluate();
    expect(r.re).toBe(2);
    expect(r.isExact).toBe(false);
  });

  test('a non-integer operand is deferred to the symbolic tail', () => {
    expect(ce.box(['GCD', ['Rational', 1, 2], 3]).evaluate().json).toEqual([
      'GCD',
      3,
      ['Rational', 1, 2],
    ]);
  });
});

describe('Mod, GCD and LCM under .N() with huge or out-of-range operands', () => {
  test('Mod of a huge power reduces without forming the integer', () => {
    // 2 has order 3 modulo 7, and 3^20 is a multiple of 3, so the exact
    // handler answers 1 (and −6 for the modulus −7). Before, `.N()` tried to
    // build the exact value of 2^(3^20) and failed after 45 s.
    const mod = (m: number) =>
      ce.box(['Mod', ['Power', 2, ['Power', 3, 20]], m]);
    const exact = mod(7).evaluate();
    const start = Date.now();
    const r = mod(7).N();
    const elapsed = Date.now() - start;
    expect(exact.re).toBe(1);
    expect(r.re).toBe(exact.re);
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(1000);

    expect(mod(-7).N().re).toBe(mod(-7).evaluate().re);
    expect(mod(-7).evaluate().re).toBe(-6);
  });

  test('GCD of a list of large powers reads the elements exactly', () => {
    // The floats of 2^100 and 6^50 have no unit digit: the tolerant float
    // lane gave 3.02·10²³ where the answer is 2^50.
    const r = ce
      .box(['GCD', ['List', ['Power', 2, 100], ['Power', 6, 50]]])
      .N();
    expect(r.json).toBe(1125899906842624);
    expect(r.isExact).toBe(true);
    const s = ce
      .box(['GCD', ['List', ['Power', 2, 100], ['Power', 2, 50]]])
      .N();
    expect(s.json).toBe(1125899906842624);
    expect(s.isExact).toBe(true);
  });

  test('a float beyond the range of a double is not read as an exact integer', () => {
    // `N(10^400)` is a float whose digits are rounded. It is beyond the
    // range of the float lane, and before it was folded as the exact
    // integer 10^400, which gave the exact result 2.
    const r = ce.box(['GCD', ['N', ['Power', 10, 400]], 6]).evaluate();
    expect(r.isExact).not.toBe(true);
    expect(r.operator).toBe('GCD');
    expect(r.json).toEqual(['GCD', 6, { num: '1.0e+400' }]);
  });
});

describe('integer predicates of a large exact integer under .N()', () => {
  // `IsPrime`, `IsComposite`, `IsOdd` and `IsEven` take a `number`
  // parameter, so the operand is approximated before the handler reads it
  // as an integer: `IsPrime(2^89 - 1).N()` was `False` for that Mersenne
  // prime. The handlers read the written operand (`exactIntegerOriginals()`).
  const m89 = ['Subtract', ['Power', 2, 89], 1];
  test('IsPrime and IsComposite', () => {
    expect(ce.box(['IsPrime', m89]).N().json).toBe('True');
    expect(ce.box(['IsPrime', ['Add', ['Power', 2, 89], 1]]).N().json).toBe(
      'False'
    );
    expect(ce.box(['IsComposite', ['Add', ['Power', 2, 89], 1]]).N().json).toBe(
      'True'
    );
    expect(ce.box(['IsComposite', m89]).N().json).toBe('False');
  });
  test('IsOdd and IsEven', () => {
    expect(ce.box(['IsOdd', m89]).N().json).toBe('True');
    expect(ce.box(['IsEven', m89]).N().json).toBe('False');
    expect(ce.box(['IsEven', ['Power', 2, 89]]).N().json).toBe('True');
  });
  test('a float operand is unchanged', () => {
    expect(ce.box(['IsPrime', { num: '7.0' }]).N().json).toBe('True');
    expect(ce.box(['IsOdd', { num: '2.5' }]).N().json).toBe('False');
  });
});
