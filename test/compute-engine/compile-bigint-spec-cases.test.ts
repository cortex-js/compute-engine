import { ComputeEngine, compile } from '../../src/compute-engine';
import { isFunction, isNumber, isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';
import { exactRational } from '../../src/compute-engine/compilation/compile-bigint-lane';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * CE-715, step 6 of `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`:
 * the cases of the test list of §5 item 6 that the other test files of the
 * mode (`compile-bigint-lane.test.ts`, `compile-bigint-emission.test.ts`,
 * `compile-bigint-boundary.test.ts`, `compile-bigint-mode.test.ts`) do not
 * cover with a compiled value.
 *
 * - A `bigint` or `boolean` result is compared with the value of
 *   `evaluate()` for the same inputs.
 * - At a pole (a sub-expression with no finite value) the compiled result
 *   is a `number` (`NaN` or `Infinity`) with no defined relation to the
 *   value of `evaluate()` (§3.4): the test checks only that it is a
 *   `number`, and which one the helper of §3.6 carries.
 * - A decline is a compilation with `success: false` and the diagnostic
 *   code `bigint-lane`.
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('k0', 'integer<0..>');
ce.declare('L', 'list<integer>');
ce.parse('f(x) := x!').evaluate();

type Json = Parameters<typeof ce.box>[0];
type Value = bigint | boolean | Value[];
type Inputs = Record<string, bigint | bigint[]>;

/** The value of an interpreter result, as the compiled code gives it. */
function interpreterValue(e: Expression): Value {
  if (isNumber(e)) {
    const r = exactRational(e);
    if (r === undefined || r.q !== 1n)
      throw new Error(`not an exact integer: ${e.toString()}`);
    return r.p;
  }
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'List')) return e.ops.map(interpreterValue);
  throw new Error(`not a value of the mode: ${e.toString()}`);
}

function boxInput(v: bigint | bigint[]): Expression {
  return Array.isArray(v)
    ? ce.function('List', v.map((x) => ce.number(x)))
    : ce.number(v);
}

function run(json: Json, inputs: Inputs = {}): unknown {
  const r = compile(ce.box(json), { mode: 'bigint', fallback: false });
  expect(r.success).toBe(true);
  expect(r.mode).toBe('bigint');
  return r.run!(inputs as never);
}

/** The compiled value equals the value of `evaluate()`. */
function agrees(json: Json, inputs: Inputs = {}): Value {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, boxInput(v)])
  );
  const expected = interpreterValue(ce.box(json).subs(subs).evaluate());
  expect(run(json, inputs)).toEqual(expected);
  return expected;
}

/** The compiled value is the `number` `value` (§3.4). */
function noValue(json: Json, inputs: Inputs, value: number): void {
  const result = run(json, inputs);
  expect(typeof result).toBe('number');
  expect(result).toBe(value);
}

function declines(json: Json): void {
  const r = compile(ce.box(json), { mode: 'bigint' });
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('bigint-lane');
  expect(r.diagnostic?.kind).toBe('capability');
}

const TWO_53 = 2n ** 53n;

describe('the rows of §3.1 that no other test compares with evaluate()', () => {
  it('n(n+1)/2 under Floor, past 2^53', () => {
    const json: Json = [
      'Floor',
      ['Divide', ['Multiply', 'n', ['Add', 'n', 1]], 2],
    ];
    expect(agrees(json, { n: 2n ** 60n })).toBe(
      (2n ** 60n * (2n ** 60n + 1n)) / 2n
    );
  });

  it('2^n under Floor and under Typed', () => {
    expect(agrees(['Floor', ['Power', 2, 'n']], { n: 70n })).toBe(2n ** 70n);
    expect(agrees(['Floor', ['Power', 2, 'n']], { n: -3n })).toBe(0n);
    expect(agrees(['Typed', ['Power', 2, 'n'], "'integer'"], { n: 70n })).toBe(
      2n ** 70n
    );
  });

  it.each([
    ['n(n+1)/2', ['Divide', ['Multiply', 'n', ['Add', 'n', 1]], 2]],
    ['2^n', ['Power', 2, 'n']],
    [
      'Binom(2n, n) / (n + 1)',
      [
        'Divide',
        ['Binomial', ['Multiply', 2, 'n'], 'n'],
        ['Add', 'n', 1],
      ],
    ],
    ['Sqrt(n)', ['Sqrt', 'n']],
    ['String(n)', ['String', 'n']],
  ] as const)('%s declines in a compilation', (_, json) => {
    declines(json as Json);
  });
});

describe('the refined types of §3.1.3, compared with evaluate()', () => {
  it('Abs(n − m), a finite operand', () => {
    for (const [n, m] of [
      [3n, 10n],
      [-TWO_53, TWO_53],
    ])
      agrees(['Abs', ['Subtract', 'n', 'm']], { n, m });
  });

  it('Power(n, k0) with k0 typed integer<0..>', () => {
    expect(agrees(['Power', 'n', 'k0'], { n: -2n, k0: 3n })).toBe(-8n);
    expect(agrees(['Power', 'n', 'k0'], { n: 0n, k0: 5n })).toBe(0n);
  });

  it('Factorial2(k0) with k0 typed integer<0..>', () => {
    for (const k0 of [0n, 7n, 8n, 41n]) agrees(['Factorial2', 'k0'], { k0 });
  });

  it('Max(n, n!) and Min(n, f(n))', () => {
    for (const n of [0n, 3n, 25n]) {
      agrees(['Max', 'n', ['Factorial', 'n']], { n });
      agrees(['Min', 'n', ['f', 'n']], { n });
    }
  });

  it('Sum(Mod(n, k), k = 1..n)', () => {
    for (const n of [1n, 10n, 50n])
      agrees(['Sum', ['Mod', 'n', 'k'], ['Limits', 'k', 1, 'n']], { n });
  });
});

describe('the rows of §3.6 in compiled code', () => {
  it('a zero divisor under Floor, Ceil, Round and Truncate', () => {
    for (const head of ['Floor', 'Ceil', 'Round', 'Truncate']) {
      noValue([head, ['Divide', 'n', 'm']], { n: 5n, m: 0n }, Infinity);
      noValue([head, ['Divide', 'n', 'm']], { n: 0n, m: 0n }, NaN);
    }
  });

  it('Round(n/m) at 5/2, −5/2 and 7/2: half away from zero', () => {
    expect(agrees(['Round', ['Divide', 'n', 'm']], { n: 5n, m: 2n })).toBe(3n);
    expect(agrees(['Round', ['Divide', 'n', 'm']], { n: -5n, m: 2n })).toBe(
      -3n
    );
    expect(agrees(['Round', ['Divide', 'n', 'm']], { n: 7n, m: 2n })).toBe(4n);
  });

  it('Remainder(n, m) at 7, 2 and at m = 0', () => {
    expect(agrees(['Remainder', 'n', 'm'], { n: 7n, m: 2n })).toBe(-1n);
    noValue(['Remainder', 'n', 'm'], { n: 5n, m: 0n }, NaN);
  });

  it('n^k0 at 1 and 0 with k0 = 10^7: no size limit', () => {
    expect(agrees(['Power', 'n', 'k0'], { n: 1n, k0: 10n ** 7n })).toBe(1n);
    expect(agrees(['Power', 'n', 'k0'], { n: 0n, k0: 10n ** 7n })).toBe(0n);
  });

  it('n^k0 at −1 with k0 = 10^7 and 10^7 + 1: no size limit', () => {
    expect(agrees(['Power', 'n', 'k0'], { n: -1n, k0: 10n ** 7n })).toBe(1n);
    expect(agrees(['Power', 'n', 'k0'], { n: -1n, k0: 10n ** 7n + 1n })).toBe(
      -1n
    );
  });

  it('Floor(n^(−k0)) at n = 0 is a pole carrying Infinity', () => {
    noValue(['Floor', ['Power', 'n', ['Negate', 'k0']]], { n: 0n, k0: 2n }, Infinity);
    expect(
      agrees(['Ceil', ['Power', 'n', ['Negate', 'k0']]], { n: 2n, k0: 3n })
    ).toBe(1n);
  });

  it('GCD and LCM with a zero operand', () => {
    expect(agrees(['GCD', 'n', 'm'], { n: 0n, m: 0n })).toBe(0n);
    expect(agrees(['GCD', 'n', 'm'], { n: 0n, m: 5n })).toBe(5n);
    expect(agrees(['GCD', 'n', 'm'], { n: -4n, m: 6n })).toBe(2n);
    expect(agrees(['LCM', 'n', 'm'], { n: 0n, m: 5n })).toBe(0n);
  });

  it('n! at 0', () => {
    expect(agrees(['Factorial', 'n'], { n: 0n })).toBe(1n);
  });

  it('Binomial(n, m) at −1, 2 / 5, −1 / 5, 7', () => {
    expect(agrees(['Binomial', 'n', 'm'], { n: -1n, m: 2n })).toBe(1n);
    expect(agrees(['Binomial', 'n', 'm'], { n: 5n, m: -1n })).toBe(0n);
    expect(agrees(['Binomial', 'n', 'm'], { n: 5n, m: 7n })).toBe(0n);
  });

  it('Fibonacci(n) at −3 and 0', () => {
    expect(agrees(['Fibonacci', 'n'], { n: -3n })).toBe(2n);
    expect(agrees(['Fibonacci', 'n'], { n: 0n })).toBe(0n);
  });

  it('Sign(n) at −5 and 0', () => {
    expect(agrees(['Sign', 'n'], { n: -5n })).toBe(-1n);
    expect(agrees(['Sign', 'n'], { n: 0n })).toBe(0n);
  });
});
