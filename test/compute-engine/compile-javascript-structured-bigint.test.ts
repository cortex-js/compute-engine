import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import {
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { exactRational } from '../../src/compute-engine/compilation/compile-bigint-lane';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The compile mode `bigint` on the structured route (the `numeric-kernel`
// profile), slices 1 and 2 of
// docs/plans/2026-11-11-structured-bigint-mode.md: the policy `JS-bigint`,
// the scalar core and the integer-forcing parents. Slices 3 to 5 (`Sum`,
// `Product`, user functions, lists, a `Function` literal at the root) are
// in compile-javascript-structured-bigint2.test.ts.
//
// The contract (a user decision): for each admitted program, a `bigint` or
// a `boolean` result is the result of the existing compiler in the mode
// with `cse: false, constantFold: false` (`===`), and the exact value of
// `evaluate()`; a `number` result (a pole, `NaN` or `Infinity`) is a
// `number` on both; a thrown error is an error of the same class on both.
// Every test goes through the public `compile()` and `canCompile()`, but
// the test of the phases.

type Json = MathJsonExpression;
type Inputs = Record<string, bigint | number>;

const EXISTING = {
  mode: 'bigint',
  cse: false,
  constantFold: false,
  fallback: false,
} as const;
const PROFILE = {
  mode: 'bigint',
  profile: 'numeric-kernel',
  fallback: false,
} as const;

function engine(types: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  ce.declare('k0', 'integer<0..>');
  for (const [name, type] of Object.entries(types))
    if (!['n', 'm', 'k0'].includes(name)) ce.declare(name, type);
  return ce;
}

type Outcome =
  | { kind: 'bigint' | 'boolean' | 'number'; value: unknown }
  | { kind: 'throw'; error: string };

function outcome(run: (inputs: Inputs) => unknown, inputs: Inputs): Outcome {
  try {
    const value = run(inputs);
    return { kind: typeof value as 'bigint' | 'boolean' | 'number', value };
  } catch (e) {
    return { kind: 'throw', error: (e as Error).constructor.name };
  }
}

/** The exact value of `expr` at `inputs` by the interpreter: a `bigint`, a
 *  `boolean`, or `undefined` when it has none. */
function interpreted(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): bigint | boolean | undefined {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [k, ce.number(BigInt(v))])
  );
  const value = expr.subs(subs).evaluate();
  if (isSymbol(value, 'True')) return true;
  if (isSymbol(value, 'False')) return false;
  if (!isNumber(value)) return undefined;
  const r = exactRational(value);
  return r !== undefined && r.q === 1n ? r.p : undefined;
}

const TWO_53 = 2n ** 53n;
const TWO_64 = 2n ** 64n;

/** The values of each input of a grid: past `2^53` and `2^64`, negative,
 *  zero, and the squares and their neighbors of the square roots. */
const GRID: Readonly<Record<string, readonly bigint[]>> = {
  n: [0n, 1n, -1n, 2n, 3n, -7n, 16n, 17n, 20n, TWO_53 + 1n, 3n * 2n ** 52n, -TWO_64 - 7n],
  m: [3n, -2n, 0n, 2n ** 60n + 3n, -TWO_64 - 1n],
  k0: [0n, 3n, TWO_64],
  c: [0n, -5n, TWO_64 + 1n],
};

/** Every point of the grid of the inputs `names`. */
function points(names: readonly string[]): Inputs[] {
  let result: Inputs[] = [{}];
  for (const name of names)
    result = result.flatMap((p) =>
      (GRID[name] ?? GRID.n).map((v) => ({ ...p, [name]: v }))
    );
  return result;
}

/**
 * Compile `json` with the profile and with the existing compiler, and
 * compare their outcomes at each point of `inputs` (the grid of its free
 * symbols when absent) by the contract; compare a `bigint` or a `boolean`
 * result with the interpreter at its first `interp` points. Returns the
 * outcomes of the profile.
 */
function differential(
  json: Json,
  inputs?: readonly Inputs[],
  types: Record<string, string> = {},
  interp = 4
): Outcome[] {
  const ce = engine(types);
  const expr = ce.box(json);
  const profiled = compile(expr, PROFILE);
  const existing = compile(expr, EXISTING);
  expect(profiled.success).toBe(true);
  expect(profiled.mode).toBe('bigint');
  expect(profiled.profile).toBe('numeric-kernel');
  const grid = inputs ?? points(expr.unknowns);
  const run = (r: typeof profiled) => (i: Inputs) => r.run!(i as never);
  let compared = 0;
  return grid.map((input) => {
    const a = outcome(run(profiled), input);
    const b = outcome(run(existing), input);
    const where = `${JSON.stringify(json)} at ${Object.entries(input)
      .map(([k, v]) => `${k} = ${String(v)}`)
      .join(', ')}`;
    if (a.kind === 'number' || b.kind === 'number') {
      expect([where, a.kind]).toEqual([where, b.kind]);
    } else expect([where, a]).toEqual([where, b]);
    if (
      (a.kind === 'bigint' || a.kind === 'boolean') &&
      compared < interp &&
      String(a.value).length < 5000
    ) {
      compared += 1;
      expect([where, interpreted(ce, expr, input)]).toEqual([where, a.value]);
    }
    return a;
  });
}

/** The outcome of the profile at `inputs`. */
function profileAt(json: Json, inputs: Inputs, types = {}): Outcome {
  const ce = engine(types);
  const r = compile(ce.box(json), PROFILE);
  return outcome((i) => r.run!(i as never), inputs);
}

/** The decline of the profile for `json`, with `options`. */
function decline(json: Json, options: Record<string, unknown> = {}) {
  const ce = engine();
  const expr = ce.box(json);
  let error: unknown;
  try {
    compile(expr, { ...PROFILE, ...options });
  } catch (e) {
    error = e;
  }
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic as {
    code: string;
    message: string;
  };
  expect(canCompile(expr, { ...PROFILE, ...options } as never)).toEqual({
    ok: false,
    diagnostic,
  });
  return diagnostic;
}

/** The distinct programs of the tests of the mode that slices 1 and 2
 *  admit, with the declared types of their free symbols (§2 of the design). */
const WITNESSES: readonly (readonly [unknown, Record<string, string>])[] = [
  [["Add",["Negate",["Binomial",["Multiply",2,"n"],["Add","n",1]]],["Binomial",["Multiply",2,"n"],"n"]], {"n":"integer"}],
  [["Mod","n",10], {"n":"integer"}],
  [["Mod",["Add",1,["Power",2,60]],10], {}],
  [["Abs",["Factorial","n"]], {"n":"integer"}],
  [["Mod","n",7], {"n":"integer"}],
  [["GCD","n","m"], {"m":"integer","n":"integer"}],
  [["LCM","n","m"], {"m":"integer","n":"integer"}],
  [["Negate","n"], {"n":"integer"}],
  [["Floor",["Multiply",["Rational",1,3],"n"]], {"n":"integer"}],
  [["Max","n","m",3], {"m":"integer","n":"integer"}],
  [["Min","n","m"], {"m":"integer","n":"integer"}],
  [["Sign",["Add",["Negate","m"],"n"]], {"m":"integer","n":"integer"}],
  [["Remainder","n","m"], {"m":"integer","n":"integer"}],
  [["Factorial","n"], {"n":"integer"}],
  [["Power","n","k0"], {"k0":"integer<0..>","n":"integer"}],
  [["Power",-1,"n"], {"n":"integer"}],
  [["Add",["Floor",["Multiply",["Rational",1,2],"n"]],["Ceil",["Multiply",["Rational",1,2],"n"]]], {"n":"integer"}],
  [["Floor",["Multiply",["Rational",1,2],"n",["Add","n",1]]], {"n":"integer"}],
  [["Floor",["Divide","n","m"]], {"m":"integer","n":"integer"}],
  [["Ceil",["Multiply",["Rational",1,2],"n",["Add","n",1]]], {"n":"integer"}],
  [["Ceil",["Divide","n","m"]], {"m":"integer","n":"integer"}],
  [["Round",["Multiply",["Rational",1,2],"n",["Add","n",1]]], {"n":"integer"}],
  [["Round",["Divide","n","m"]], {"m":"integer","n":"integer"}],
  [["Truncate",["Multiply",["Rational",1,2],"n",["Add","n",1]]], {"n":"integer"}],
  [["Truncate",["Divide","n","m"]], {"m":"integer","n":"integer"}],
  [["Less",["Rational",1,2],"n"], {"n":"integer"}],
  [["Floor",["Power",2,["Negate","n"]]], {"n":"integer"}],
  [["Ceil",["Power",2,["Negate","n"]]], {"n":"integer"}],
  [["Floor",["Sqrt","n"]], {"n":"integer"}],
  [["Less",5,["Factorial","n"]], {"n":"integer"}],
  [["Ceil",["Sqrt","n"]], {"n":"integer"}],
  [["Round",["Sqrt","n"]], {"n":"integer"}],
  [["Truncate",["Sqrt","n"]], {"n":"integer"}],
  [["Typed",["Multiply",["Rational",1,2],"n"],"'integer'"], {"n":"integer"}],
  [["Fibonacci",["Multiply",["Rational",1,2],"n"]], {"n":"integer"}],
  [["LessEqual",["Multiply",["Rational",1,2],["Add",1,["Multiply",3,["Power",2,53]]]],"n"], {"n":"integer"}],
  [["Equal","n",["Multiply",["Rational",1,{"num":"9007199254740992"}],["Add",1,["Power",2,53]]]], {"n":"integer"}],
  [["NotEqual","n",["Rational",1,3]], {"n":"integer"}],
  [["Less","n","m"], {"m":"integer","n":"integer"}],
  [["Less","m","n"], {"m":"integer","n":"integer"}],
  [["LessEqual","n","m"], {"m":"integer","n":"integer"}],
  [["LessEqual","m","n"], {"m":"integer","n":"integer"}],
  [["Equal","n","m"], {"m":"integer","n":"integer"}],
  [["NotEqual","n","m"], {"m":"integer","n":"integer"}],
  [["IsPrime","n"], {"n":"integer"}],
  [["Add",["Boole",["Or",["Less","m","n"],["Equal","m",0]]],["Boole",["And",["Less","n","m"],["Not",["Equal","n",0]]]]], {"m":"integer","n":"integer"}],
  [["If",["Less","n",0],0,["Factorial","n"]], {"n":"integer"}],
  [["Which",["Less","n",0],-1,["Equal","n",0],0,"True",["Multiply",2,"n"]], {"n":"integer"}],
  [["Add",["Multiply","n",["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]]],["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]]], {"m":"integer","n":"integer"}],
  [["Add",["Floor",["Multiply",["Rational",1,2],["Add","n",["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]]]]],["Ceil",["Multiply",["Rational",1,2],["Add","n",["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]]]]]], {"m":"integer","n":"integer"}],
  [1, {}],
  [5, {}],
  [["Add","n",["Power",2,70]], {"n":"integer"}],
  [["Add",1,["Power",2,60]], {}],
  [["Fibonacci",100], {}],
  [["Fibonacci",80], {}],
  [["Factorial",30], {}],
  [["Add","n",["Power",2,60]], {"n":"integer"}],
  [["IsPrime",17], {}],
  [["Floor",["Rational",7,2]], {}],
  [["Add","n",["Floor",["Rational",7,2]]], {"n":"integer"}],
  [["Floor",["Rational",{"num":"1e+20"},3]], {}],
  [["Add","n",["Floor",["Rational",{"num":"1e+20"},3]]], {"n":"integer"}],
  [["Ceil",["Rational",{"num":"1e+20"},3]], {}],
  [["Add","n",["Ceil",["Rational",{"num":"1e+20"},3]]], {"n":"integer"}],
  [["Less",["Rational",7,2],"n"], {"n":"integer"}],
  [["Add",["Multiply","n",["Binomial",["Fibonacci",80],3]],["Multiply",["Add","n",1],["Binomial",["Fibonacci",80],3]],["Mod",["Binomial",["Fibonacci",80],3],"n"]], {"n":"integer"}],
  [["Factorial",-1], {}],
  [["Add","n",["Factorial",-1]], {"n":"integer"}],
  [["Mod",5,0], {}],
  [["Add","n",["Mod",5,0]], {"n":"integer"}],
  [["Remainder",5,0], {}],
  [["Add","n",["Remainder",5,0]], {"n":"integer"}],
  [["If",["Less",0,"n"],"n",["Factorial",-1]], {"n":"integer"}],
  [["If",["Less",0,"n"],"n",["Mod",5,0]], {"n":"integer"}],
  [["Add","n","ComplexInfinity"], {"n":"integer"}],
  [["Add","n","NaN"], {"n":"integer"}],
  [["Add","n",["Divide",1,["Fibonacci",0]]], {"n":"integer"}],
  [["Add","n",["Floor","ComplexInfinity"]], {"n":"integer"}],
  [["If",["Less",0,"n"],"n","ComplexInfinity"], {"n":"integer"}],
  [["If",["Less",0,"n"],"n",["Add",["Multiply","n",["Divide",1,["Fibonacci",0]]],["Multiply",["Divide",1,["Fibonacci",0]],["Add","n",2]]]], {"n":"integer"}],
  [["Add",["Multiply","n",["Factorial",-1]],["Multiply",["Add","n",1],["Factorial",-1]]], {"n":"integer"}],
  [["Less",["Factorial",-1],"n"], {"n":"integer"}],
  [["Less","n","ComplexInfinity"], {"n":"integer"}],
  [["Equal","n","NaN"], {"n":"integer"}],
  [["Negate",["Abs",["Factorial","n"]]], {"n":"integer"}],
  [["Mod","n","m"], {"m":"integer","n":"integer"}],
  [["Fibonacci","n"], {"n":"integer"}],
  [["Factorial2","k0"], {"k0":"integer<0..>"}],
  [["Binomial","n","m"], {"m":"integer","n":"integer"}],
  [["Add","c",1], {"c":"integer"}],
  ["n", {"n":"integer"}],
  [["Add",["Factorial","n"],["Binomial",["Multiply",2,"n"],"n"]], {"n":"integer"}],
  [["Add","n",1], {"n":"integer"}],
  [["Multiply",0,["Factorial","n"]], {"n":"integer"}],
  [["Add",["Negate",["Factorial","m"]],["Factorial","n"]], {"m":"integer","n":"integer"}],
  [["Floor",["Power",2,"n"]], {"n":"integer"}],
  [["Typed",["Power",2,"n"],"'integer'"], {"n":"integer"}],
  [["Multiply","n","n"], {"n":"integer"}],
  [["Abs",["Add",["Negate","m"],"n"]], {"m":"integer","n":"integer"}],
  [["Max","n",["Factorial","n"]], {"n":"integer"}],
  [["Floor",["Power","n",["Negate","k0"]]], {"k0":"integer<0..>","n":"integer"}],
  [["Ceil",["Power","n",["Negate","k0"]]], {"k0":"integer<0..>","n":"integer"}],
  [["Sign","n"], {"n":"integer"}],
];

describe('the witnesses of slices 1 and 2', () => {
  // The distinct programs that the tests of the mode compile and that the
  // profile admits (the witnesses of §2 of the design: a Jest setup file
  // logged each compilation with `mode: 'bigint'` of the test files that
  // name the mode), with the declared types of their free symbols.
  test.each(WITNESSES)('%j', (json, types) => {
    differential(json as Json, undefined, types);
  });
});

describe('the scalar core', () => {
  test.each<[string, Json]>([
    ['n + 2m − 3', ['Subtract', ['Add', 'n', ['Multiply', 2, 'm']], 3]],
    ['n·m − n', ['Subtract', ['Multiply', 'n', 'm'], 'n']],
    ['2^70 + n', ['Add', ['Power', 2, 70], 'n']],
    ['n^3', ['Power', 'n', 3]],
    ['n^k0', ['Power', 'n', 'k0']],
    ['(−1)^n', ['Power', -1, 'n']],
    ['Abs(n − m)', ['Abs', ['Subtract', 'n', 'm']]],
    ['Sign(n)·m', ['Multiply', ['Sign', 'n'], 'm']],
    ['Min(n, m, 3)', ['Min', 'n', 'm', 3]],
    ['Max(n, −m)', ['Max', 'n', ['Negate', 'm']]],
    ['Mod(n, m)', ['Mod', 'n', 'm']],
    ['Remainder(n, m)', ['Remainder', 'n', 'm']],
    ['GCD(n, m, 6)', ['GCD', 'n', 'm', 6]],
    ['LCM(n, m)', ['LCM', 'n', 'm']],
    ['n!', ['Factorial', 'n']],
    ['k0!!', ['Factorial2', 'k0']],
    ['Binomial(n, m)', ['Binomial', 'n', 'm']],
    ['Fibonacci(n)', ['Fibonacci', 'n']],
    ['IsPrime(n)', ['IsPrime', 'n']],
    ['n < m', ['Less', 'n', 'm']],
    ['n ≥ m', ['GreaterEqual', 'n', 'm']],
    ['n = m', ['Equal', 'n', 'm']],
    ['n ≠ m', ['NotEqual', 'n', 'm']],
    ['n < 7/2', ['Less', 'n', ['Rational', 7, 2]]],
    ['−5/3 ≤ n', ['LessEqual', ['Rational', -5, 3], 'n']],
    ['n = 1/2', ['Equal', 'n', ['Rational', 1, 2]]],
    ['n ≠ 1/3', ['NotEqual', 'n', ['Rational', 1, 3]]],
    ['If(n < 0, 0, n!)', ['If', ['Less', 'n', 0], 0, ['Factorial', 'n']]],
    [
      'Which(n < 0, −1, n = 0, 0, True, 2n)',
      ['Which', ['Less', 'n', 0], -1, ['Equal', 'n', 0], 0, 'True', ['Multiply', 2, 'n']],
    ],
    [
      'Boole(n < m ∧ ¬(n = 0)) + Boole(m < n ∨ m = 0)',
      [
        'Add',
        ['Boole', ['And', ['Less', 'n', 'm'], ['Not', ['Equal', 'n', 0]]]],
        ['Boole', ['Or', ['Less', 'm', 'n'], ['Equal', 'm', 0]]],
      ],
    ],
    ['If(IsPrime(n), n, m)', ['If', ['IsPrime', 'n'], 'n', 'm']],
    ['n! + n!', ['Add', ['Factorial', 'n'], ['Factorial', 'n']]],
    ['(−1)! + n', ['Add', ['Factorial', -1], 'n']],
    ['Mod(5, 0) + n', ['Add', ['Mod', 5, 0], 'n']],
    ['If(n > 0, n, (−1)!)', ['If', ['Greater', 'n', 0], 'n', ['Factorial', -1]]],
  ])('%s', (_, json) => {
    differential(json);
  });

  test('a pole on a path that runs is a number; on a path that does not, no abort', () => {
    expect(profileAt(['Add', ['Factorial', 'n'], ['Factorial', 'n']], { n: -1n })).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['If', ['Less', 'n', 0], 0, ['Factorial', 'n']], { n: -1n })).toEqual({ kind: 'bigint', value: 0n });
    expect(profileAt(['If', ['Greater', 'n', 0], 'n', ['Factorial', -1]], { n: 3n })).toEqual({ kind: 'bigint', value: 3n });
    expect(profileAt(['If', ['Greater', 'n', 0], 'n', ['Factorial', -1]], { n: 0n })).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['Add', ['Mod', 5, 0], 'n'], { n: 1n })).toEqual({ kind: 'number', value: NaN });
  });

  test('Mod and Remainder of negative operands, and a zero divisor', () => {
    const at = (json: Json, n: bigint, m: bigint) => profileAt(json, { n, m });
    const mod: Json = ['Mod', 'n', 'm'];
    const rem: Json = ['Remainder', 'n', 'm'];
    expect(at(mod, -7n, 3n)).toEqual({ kind: 'bigint', value: 2n });
    expect(at(mod, 7n, -3n)).toEqual({ kind: 'bigint', value: -2n });
    expect(at(rem, -7n, 3n)).toEqual({ kind: 'bigint', value: -1n });
    expect(at(rem, 7n, -3n)).toEqual({ kind: 'bigint', value: 1n });
    expect(at(rem, 5n, 2n)).toEqual({ kind: 'bigint', value: -1n });
    expect(at(mod, -TWO_64 - 7n, 10n)).toEqual({ kind: 'bigint', value: 7n });
    expect(at(mod, 5n, 0n)).toEqual({ kind: 'number', value: NaN });
    expect(at(rem, 5n, 0n)).toEqual({ kind: 'number', value: NaN });
  });

  test('0^0, a huge exponent, and the size limit', () => {
    const pow: Json = ['Power', 'n', 'k0'];
    expect(profileAt(pow, { n: 0n, k0: 0n })).toEqual({ kind: 'number', value: NaN });
    expect(profileAt(pow, { n: 1n, k0: TWO_64 })).toEqual({ kind: 'bigint', value: 1n });
    expect(profileAt(pow, { n: -1n, k0: TWO_64 + 1n })).toEqual({ kind: 'bigint', value: -1n });
    // Past the size limit of 10^6 decimal digits, a `RangeError`, as the
    // existing compiler throws it.
    differential(pow, [{ n: 2n, k0: TWO_64 }, { n: 10n, k0: 1_000_001n }]);
    expect(profileAt(pow, { n: 2n, k0: TWO_64 })).toEqual({ kind: 'throw', error: 'RangeError' });
    differential(['Factorial', 'n'], [{ n: TWO_53 + 1n }]);
    expect(profileAt(['Factorial', 'n'], { n: TWO_53 + 1n })).toEqual({ kind: 'throw', error: 'RangeError' });
  });

  test('inputs given as numbers, and a number that is not an integer', () => {
    const json: Json = ['Add', ['Multiply', 'n', 'm'], ['Factorial', 'k0']];
    const ce = engine();
    const expr = ce.box(json);
    const profiled = compile(expr, PROFILE);
    const existing = compile(expr, EXISTING);
    for (const inputs of [
      { n: 5, m: -3, k0: 4 },
      { n: Number.MAX_SAFE_INTEGER, m: 3, k0: 0 },
      { n: -Number.MAX_SAFE_INTEGER, m: 2n ** 70n, k0: 1n },
    ]) {
      const a = profiled.run!(inputs as never);
      expect(typeof a).toBe('bigint');
      expect(a).toBe(existing.run!(inputs as never));
      expect(a).toBe(interpreted(ce, expr, inputs));
    }
    // A `number` input that is not a safe integer is refused by the entry
    // check of both compilers, with the same class of error.
    for (const n of [2.5, 2 ** 60])
      expect(outcome((i) => profiled.run!(i as never), { n, m: 1, k0: 1 })).toEqual(
        outcome((i) => existing.run!(i as never), { n, m: 1, k0: 1 })
      );
    // With the entry checks off, the conversion of the code throws.
    const unchecked = compile(expr, { ...PROFILE, entryChecks: false });
    expect(unchecked.run!({ n: 5, m: 2, k0: 3 } as never)).toBe(16n);
    expect(() => unchecked.run!({ n: 2.5, m: 2, k0: 3 } as never)).toThrow(RangeError);
  });
});

describe('the integer-forcing parents', () => {
  const ROUNDINGS = ['Floor', 'Ceil', 'Round', 'Truncate'] as const;
  test.each(ROUNDINGS)('%s of a quotient, a rational product, a power and a square root', (head) => {
    differential([head, ['Divide', 'n', 'm']]);
    differential([head, ['Divide', 'n', 3]]);
    differential([head, ['Multiply', ['Rational', -5, 3], 'n', 'm']]);
    differential([head, ['Power', 'n', 'm']]);
    differential([head, ['Power', 2, ['Negate', 'k0']]]);
    differential([head, ['Sqrt', 'n']]);
  });

  test('Typed(…, integer) of a quotient and a power', () => {
    differential(['Typed', ['Divide', 'n', 2], "'integer'"]);
    differential(['Typed', ['Divide', 'n', 'm'], "'integer'"]);
    differential(['Typed', ['Power', 'n', 'm'], "'integer'"]);
    expect(profileAt(['Typed', ['Divide', 'n', 2], "'integer'"], { n: 7n })).toEqual({ kind: 'throw', error: 'RangeError' });
    expect(profileAt(['Typed', ['Divide', 'n', 2], "'integer'"], { n: -TWO_64 })).toEqual({ kind: 'bigint', value: -(2n ** 63n) });
    expect(profileAt(['Typed', ['Power', 'n', 'm'], "'integer'"], { n: -1n, m: -7n })).toEqual({ kind: 'bigint', value: -1n });
  });

  test('Floor(n/2) + Ceil(n/2) at an odd n is n: two quotients', () => {
    const json: Json = ['Add', ['Floor', ['Divide', 'n', 2]], ['Ceil', ['Divide', 'n', 2]]];
    for (const n of [7n, -7n, TWO_64 + 1n, -TWO_64 - 1n])
      expect(profileAt(json, { n })).toEqual({ kind: 'bigint', value: n });
  });

  test('Round of a tie rounds away from zero', () => {
    expect(profileAt(['Round', ['Rational', -5, 2]], {})).toEqual({ kind: 'bigint', value: -3n });
    expect(profileAt(['Round', ['Divide', 'n', 2]], { n: -5n })).toEqual({ kind: 'bigint', value: -3n });
    expect(profileAt(['Round', ['Divide', 'n', 2]], { n: 5n })).toEqual({ kind: 'bigint', value: 3n });
  });

  test('n ≥ (3·2^53 + 1)/2 at n = 3·2^52 and 3·2^52 + 1', () => {
    const json: Json = ['GreaterEqual', 'n', ['Divide', ['Add', ['Multiply', 3, ['Power', 2, 53]], 1], 2]];
    differential(json, [{ n: 3n * 2n ** 52n }, { n: 3n * 2n ** 52n + 1n }]);
    expect(profileAt(json, { n: 3n * 2n ** 52n })).toEqual({ kind: 'boolean', value: false });
    expect(profileAt(json, { n: 3n * 2n ** 52n + 1n })).toEqual({ kind: 'boolean', value: true });
  });

  test('the rounded square roots at 16, 17, 20, past 2^53 and below 0', () => {
    const big = (TWO_53 + 1n) ** 2n;
    const grid = [16n, 17n, 20n, big - 1n, big, big + 1n, big + TWO_53 + 1n, big + TWO_53 + 2n, -4n].map((n) => ({ n }));
    for (const head of ROUNDINGS) differential([head, ['Sqrt', 'n']], grid);
    expect(profileAt(['Ceil', ['Sqrt', 'n']], { n: 17n })).toEqual({ kind: 'bigint', value: 5n });
    expect(profileAt(['Round', ['Sqrt', 'n']], { n: 20n })).toEqual({ kind: 'bigint', value: 4n });
    // √(k² + k) < k + 1/2 < √(k² + k + 1), with k = 2^53 + 1.
    expect(profileAt(['Round', ['Sqrt', 'n']], { n: big + TWO_53 + 1n })).toEqual({ kind: 'bigint', value: TWO_53 + 1n });
    expect(profileAt(['Round', ['Sqrt', 'n']], { n: big + TWO_53 + 2n })).toEqual({ kind: 'bigint', value: TWO_53 + 2n });
    expect(profileAt(['Floor', ['Sqrt', 'n']], { n: -4n })).toEqual({ kind: 'number', value: NaN });
  });

  test('a zero divisor and a zero base with a negative exponent', () => {
    expect(profileAt(['Floor', ['Divide', 'n', 'm']], { n: 3n, m: 0n })).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['Floor', ['Divide', 'n', 'm']], { n: 0n, m: 0n })).toEqual({ kind: 'number', value: NaN });
    expect(profileAt(['Floor', ['Power', 'n', 'm']], { n: 0n, m: -2n })).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['Floor', ['Power', 'n', 'm']], { n: 3n, m: -2n })).toEqual({ kind: 'bigint', value: 0n });
    expect(profileAt(['Ceil', ['Power', 'n', 'm']], { n: -3n, m: -3n })).toEqual({ kind: 'bigint', value: 0n });
  });
});

describe('a node reached twice (choice C3 of the design)', () => {
  // A node object at two positions (a DAG) is lowered once where its first
  // lowering dominates the second, also when it can abort.
  const count = (code: string, helper: string) =>
    code.split(`_SYS.${helper}(`).length - 1;

  test('a factorial reached twice is computed once, with the value of the existing compiler', () => {
    const ce = engine();
    const e = ce.box(['Factorial', 'n']);
    const expr = ce._fn('Add', [e, e]);
    const profiled = compile(expr, PROFILE);
    const existing = compile(expr, EXISTING);
    expect(count(profiled.code, 'bfactorial')).toBe(1);
    for (const n of [5n, -1n, TWO_53 + 1n])
      expect(outcome((i) => profiled.run!(i as never), { n })).toEqual(
        outcome((i) => existing.run!(i as never), { n })
      );
  });

  test('a DAG of depth 40 is linear', () => {
    const ce = engine();
    let e: Expression = ce.box('n');
    for (let i = 0; i < 40; i++)
      e = ce._fn('Mod', [ce._fn('Add', [e, e, ce.One]), ce.number(1_000_003)]);
    const profiled = compile(e, PROFILE);
    expect(count(profiled.code, 'bfloorMod')).toBe(40);
    let v = 5n;
    for (let i = 0; i < 40; i++) v = (((v + v + 1n) % 1_000_003n) + 1_000_003n) % 1_000_003n;
    expect(profiled.run!({ n: 5n } as never)).toBe(v);
  });

  test('a quotient under two parents is two quotients; under one parent, one', () => {
    const ce = engine();
    const d = ce.box(['Divide', 'n', 'm']);
    const two = compile(ce._fn('Add', [ce._fn('Floor', [d]), ce._fn('Ceil', [d])]), PROFILE);
    expect([count(two.code, 'bfloorDiv'), count(two.code, 'bceilDiv')]).toEqual([1, 1]);
    expect(two.run!({ n: 7n, m: 2n } as never)).toBe(7n);
    const f = ce._fn('Floor', [d]);
    const one = compile(ce._fn('Add', [f, f]), PROFILE);
    expect(count(one.code, 'bfloorDiv')).toBe(1);
    expect(one.run!({ n: 7n, m: 2n } as never)).toBe(6n);
  });

  test('a node in the two branches of an If is lowered in each; a node before the If is shared into it', () => {
    const ce = engine();
    const e = ce.box(['Factorial', 'n']);
    const test = ce.box(['Less', 'm', 0]);
    const branches = compile(ce._fn('If', [test, e, ce._fn('Add', [e, ce.One])]), PROFILE);
    expect(count(branches.code, 'bfactorial')).toBe(2);
    const before = compile(
      ce._fn('Add', [e, ce._fn('If', [test, e, ce.Zero])]),
      PROFILE
    );
    expect(count(before.code, 'bfactorial')).toBe(1);
    expect(before.run!({ n: 4n, m: -1n } as never)).toBe(48n);
    expect(before.run!({ n: -1n, m: 1n } as never)).toBe(Infinity);
  });
});

describe('the order of two aborts', () => {
  // When two operations abort with different kinds, the first in the order
  // of the existing compiler decides the result: a value that can abort is
  // not moved across another one (`writtenAtUse()` of the emitter).
  test('n! < m! with a pole in one and the size limit in the other', () => {
    for (const json of [
      ['Less', ['Factorial', 'n'], ['Factorial', 'm']],
      ['Greater', ['Factorial', 'n'], ['Factorial', 'm']],
    ] as Json[])
      differential(json, [
        { n: -1n, m: TWO_64 },
        { n: TWO_64, m: -1n },
      ]);
    expect(profileAt(['Less', ['Factorial', 'n'], ['Factorial', 'm']], { n: -1n, m: TWO_64 })).toEqual({ kind: 'number', value: Infinity });
  });

  test('a value used once before a shared value that aborts', () => {
    const ce = engine();
    const shared = ce.box(['Typed', ['Divide', 'm', 2], "'integer'"]);
    const expr = ce._fn('Add', [ce.box(['Factorial', 'n']), shared, shared]);
    const profiled = compile(expr, PROFILE);
    const existing = compile(expr, EXISTING);
    for (const inputs of [
      { n: -1n, m: 3n },
      { n: 3n, m: 3n },
      { n: 3n, m: 4n },
    ])
      expect(outcome((i) => profiled.run!(i as never), inputs)).toEqual(
        outcome((i) => existing.run!(i as never), inputs)
      );
    expect(profiled.run!({ n: -1n, m: 3n } as never)).toBe(Infinity);
  });
});

describe('the result', () => {
  test('the code, the mode and the facts of a program', () => {
    const ce = engine();
    const expr = ce.box(['Floor', ['Divide', 'n', 'm']]);
    const result = compile(expr, PROFILE);
    expect(result.code).toBe(
      "(() => { const _tv1 = typeof _.n === 'number' ? _SYS.toBigint(_.n) : _.n; const _tv2 = typeof _.m === 'number' ? _SYS.toBigint(_.m) : _.m; try { return _SYS.bfloorDiv(_tv1, _tv2); } catch (_tv3) { if (_tv3 instanceof _SYS.NonFiniteValue) return _tv3.value; throw _tv3; } })()"
    );
    expect([result.mode, result.profile, result.pure, result.shippable]).toEqual([
      'bigint',
      'numeric-kernel',
      true,
      true,
    ]);
    expect(canCompile(expr, PROFILE)).toEqual({ ok: true, pure: true, shippable: true });
  });

  test('a program with no input and no pole is its literal', () => {
    const ce = engine();
    const result = compile(ce.box(['Mod', ['Add', ['Power', 2, 60], 1], 10]), PROFILE);
    expect(result.code).toBe('7n');
    expect(result.run!({} as never)).toBe(7n);
    const pole = compile(ce.box(['Factorial', -1]), PROFILE);
    expect(pole.code).toBe(
      '(() => { try { return (() => { throw new _SYS.NonFiniteValue(Infinity); })(); } catch (_tv1) { if (_tv1 instanceof _SYS.NonFiniteValue) return _tv1.value; throw _tv1; } })()'
    );
    expect(pole.run!({} as never)).toBe(Infinity);
  });

  test('broadcast() is refused in the mode, as by the existing compiler', () => {
    const ce = engine();
    const result = compile(ce.box(['Add', 'n', 1]), PROFILE);
    expect(() => result.broadcast!({ n: [1, 2] } as never)).toThrow(/bigint/);
  });

  test('a constant and a pole that are symbols with values', () => {
    const ce = engine();
    ce.assign('hRational', ce.box(['Rational', 7, 2]));
    ce.assign('cPole', ce.box(['Divide', 1, 0]));
    const less = compile(ce.box(['Less', 'hRational', 'n']), PROFILE);
    expect(less.run!({ n: 4n } as never)).toBe(true);
    expect(less.run!({ n: 3n } as never)).toBe(false);
    const pole = compile(ce.box(['Add', 'cPole', 'n']), PROFILE);
    expect(pole.run!({ n: 1n } as never)).toBe(Infinity);
  });
});

describe('what stays declined', () => {
  test.each<[string, Json, Record<string, unknown>, string]>([
    [
      'a constant that the interpreter leaves unevaluated',
      ['Fibonacci', ['Power', 10, 9]],
      {},
      "Could not compile with the profile 'numeric-kernel': the constant Fibonacci(1000000000) has no exact integer or boolean value: the interpreter gives Fibonacci(1000000000)",
    ],
    [
      'a quotient outside an integer-forcing parent',
      ['Divide', 'n', 2],
      {},
      "Could not compile with the profile 'numeric-kernel' in the mode 'bigint': `1/2 * n` (type `rational`) is not on the integer lane: its type is not an integer type, and it is not the operand of an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise) in one of the shapes p/q·t, a/b, a^e or √t.",
    ],
    [
      'a square root under an integer promise',
      ['Typed', ['Sqrt', 'n'], "'integer'"],
      {},
      "Could not compile with the profile 'numeric-kernel' in the mode 'bigint': `sqrt(n)` (type `complex`) is not on the integer lane: its type is not an integer type, and it is not the operand of an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise) in one of the shapes p/q·t, a/b, a^e or √t.",
    ],
    [
      'the option vars',
      ['Add', 'n', 1],
      { vars: { n: '_.n' } },
      "Could not compile with the profile 'numeric-kernel': the option `vars` is not in the profile in the mode bigint",
    ],
    [
      'the option functions',
      ['Add', 'n', 1],
      { functions: { g: (a: number) => a } },
      "Could not compile with the profile 'numeric-kernel': the option `functions` is not in the profile in the mode bigint",
    ],
  ])('%s', (_, json, options, message) => {
    const diagnostic = decline(json, options);
    expect([diagnostic.code, diagnostic.message]).toEqual(['outside-profile', message]);
  });
});

describe('the functions of lists and the function operands (collections, slices 2 and 3)', () => {
  // The mode holds a list of integers (slice 5), but no function value: a
  // head with a function operand declines with a message of the mode, also
  // where the existing compiler compiles it.
  test.each<[string, Json, string]>([
    [
      'Map of a list literal',
      ['Map', ['Function', ['Multiply', 2, 'k'], 'k'], ['List', 'n', 'm']],
      "Could not compile with the profile 'numeric-kernel': Map with a function operand is not in the profile in the mode bigint",
    ],
    [
      'Sort (not on the integer lane)',
      ['At', ['Sort', ['List', 'm', 'n']], 1],
      "Could not compile with the profile 'numeric-kernel' in the mode 'bigint': `Sort([m,n])` (type `list<integer>`) is not on the integer lane: `Sort` is not on the list of heads of the bigint mode (CE-715.3).",
    ],
  ])('%s declines', (_, json, message) => {
    const diagnostic = decline(json);
    expect([diagnostic.code, diagnostic.message]).toEqual(['outside-profile', message]);
  });

  test('Map of a list input declines; the existing compiler compiles it', () => {
    const ce = engine();
    ce.declare('L', 'list<integer>');
    const json: Json = ['Map', ['Function', ['Multiply', 2, 'k'], 'k'], 'L'];
    expect(() => compile(ce.box(json), PROFILE)).toThrow(
      'Map with a function operand is not in the profile in the mode bigint'
    );
    expect(compile(ce.box(json), EXISTING).success).toBe(true);
  });
});

describe('the phases of a compilation in the mode', () => {
  test('the lowering is reported to onPhase', () => {
    const ce = engine();
    const phases: StructuredPhase[] = [];
    new ScalarFragmentJavaScriptTarget('structured', new Map(), {
      onPhase: (phase: StructuredPhase) => phases.push(phase),
    }).compile(ce.box(['Floor', ['Divide', 'n', 'm']]), PROFILE);
    expect(phases).toEqual(['lowering', 'verification', 'emission', 'assembly']);
  });
});

// The rule of the emitter that keeps the order of two aborts reads only the
// abort kinds that a policy states (`OperationBase.aborts`): a helper whose
// loop has an iteration budget is not such an abort, so the code of the
// `strict` mode is the code before the mode (at 3177128ed).
describe('the strict mode with an iteration budget', () => {
  const COUNT =
    'function count(x: real) -> integer { let n = 0; for k in 1..20 { if x * k > 10 { break }; n = n + 1 }; n }';
  test.each<[string, string]>([
    ['count(y) - count(x)', '-_tv1(_.x) + _tv1(_.y)'],
    ['let a = count(x); let b = count(y); b - a', '-_tv1(_.x) + _tv1(_.y)'],
    ['count(x) > count(y) + 1', '_tv1(_.y) + 1 < _tv1(_.x)'],
  ])('%s', (source, code) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    expect(executeEpsil(ce, COUNT).diagnostics).toEqual([]);
    const [json, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const result = compile(ce.box(json), {
      profile: 'numeric-kernel',
      iterationBudget: 1000,
      fallback: false,
    });
    expect(result.code).toBe(code);
  });
});
