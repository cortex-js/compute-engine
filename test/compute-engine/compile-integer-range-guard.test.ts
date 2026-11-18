import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// Compiled arithmetic is machine arithmetic: a float where the interpreter
// gives an exact number is expected. An operation that reads every digit of
// its operand is different. The remainders (`Mod`, `Remainder`) and the
// common divisor and multiple (`GCD`, `LCM`) of a double beyond 2^53 - 1 are
// computed on the rounding of the value, not on the value, so they give a
// different number: compiled `Mod(2^60 + 1, 10)` answered `6`, the
// interpreter `7`. Compiled code gives no fidelity at an integer beyond
// 2^53 (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code"), so the
// tests check safe integers and constant folds of exact values.

const ce = new ComputeEngine();
ce.declare('k', 'real');
// `GCD` and `LCM` do not type their operands, so the inputs are declared.
ce.declare('x', 'real');
ce.declare('m', 'real');

function compiled(json: unknown) {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return r;
}

function runWith(json: unknown, vars: Record<string, number>): unknown {
  return compiled(json).run!(vars as never);
}

describe('an operand beyond the safe integer range', () => {
  it('Mod by 1 is not checked: its value does not depend on the lost digits', () => {
    // The remainder by 1 of every double beyond 2^53 is 0, which is also the
    // exact answer for the integer the double rounds.
    expect(runWith(['Mod', 'x', 1], { x: 2 ** 60 })).toBe(0);
  });
});

describe('safe integers agree with the interpreter', () => {
  const values = [-1000003, -17, -7, -1, 0, 1, 7, 17, 360, 1000003, 2 ** 52];
  const divisors = [-7, -3, 3, 7, 10, 97];

  it('Mod', () => {
    const r = compiled(['Mod', 'x', 'm']);
    // `+ 0` reads a signed zero as `0`: compiled code gives no fidelity at
    // signed zeros.
    for (const x of values)
      for (const m of divisors)
        expect((r.run!({ x, m } as never) as number) + 0).toBe(
          ce.box(['Mod', x, m]).evaluate().re
        );
  });
});

describe('constant fold of an operand beyond the safe integer range', () => {
  const folded = (json: unknown) => {
    const r = compiled(json);
    return { code: r.code, value: r.run!({} as never) };
  };

  it.each([
    [['Mod', ['Power', 2, 100], 7], 2],
    [['Mod', ['Add', ['Power', 2, 60], 1], 10], 7],
    [['GCD', ['Power', 2, 100], 6], 2],
  ])('%j folds to %p', (json, expected) => {
    expect(ce.box(json as never).evaluate().re).toBe(expected);
    expect(folded(json).value).toBe(expected);
  });

  it('a digit operator with no JavaScript lowering declines', () => {
    expect(() =>
      compile(ce.box(['DigitSum', ['Power', 'x', 1000]]), { fallback: false })
    ).toThrow(/DigitSum/);
  });
});
