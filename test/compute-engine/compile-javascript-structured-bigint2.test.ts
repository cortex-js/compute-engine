import { ComputeEngine } from '../../src/compute-engine';
import { compile, canCompile } from '../../src/compile';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import {
  exactRational,
  requireBigintLane,
} from '../../src/compute-engine/compilation/compile-bigint-lane';
import { lowerBigintProgram } from '../../src/compute-engine/compilation/javascript-structured-bigint';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The compile mode `bigint` on the structured route (the `numeric-kernel`
// profile), slices 3, 4 and 5 of
// docs/plans/2026-11-11-structured-bigint-mode.md: `Sum` and `Product`, the
// user functions, the lists of integers and a `Function` literal at the
// root. Slices 1 and 2 are in compile-javascript-structured-bigint.test.ts.
//
// The contract (a user decision): for each admitted program, a `bigint` or
// a `boolean` result, and each element of a list result, is the result of
// the existing compiler in the mode with `cse: false, constantFold: false`
// (`===`), and the exact value of `evaluate()`; a `number` result (a pole,
// `NaN` or `Infinity`) is a `number` on both; a thrown error is an error of
// the same class on both.

type Json = MathJsonExpression;
type Value = bigint | number | readonly (bigint | number)[];
type Inputs = Record<string, Value>;

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

/** The user functions of a program: the literal of each, and whether its
 *  signature is declared (each declared one is `(integer, …) -> integer`). */
type Functions = Record<string, readonly [unknown, boolean]>;

function engine(
  types: Record<string, string> = {},
  functions: Functions = {}
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  ce.declare('k0', 'integer<0..>');
  ce.declare('L', 'list<integer>');
  ce.declare('M', 'list<integer>');
  for (const [name, type] of Object.entries(types))
    if (ce.lookupDefinition(name) === undefined) ce.declare(name, type);
  for (const [name, [literal, declared]] of Object.entries(functions)) {
    if (declared)
      ce.declare(
        name,
        `(${(literal as unknown[]).slice(2).map(() => 'integer').join(', ')}) -> integer`
      );
    ce.assign(name, ce.box(literal as Json));
  }
  return ce;
}

type Outcome =
  | { kind: 'bigint' | 'boolean' | 'number'; value: unknown }
  | { kind: 'list'; value: unknown[] }
  | { kind: 'throw'; error: string };

/** The outcome of `run`, and a throw of `changed` when the call changed an
 *  array of its inputs. */
function outcome(run: () => unknown, inputs: readonly unknown[] = []): Outcome {
  const before = inputs.map((v) => (Array.isArray(v) ? [...v] : v));
  let result: Outcome;
  try {
    const value = run();
    result = Array.isArray(value)
      ? { kind: 'list', value: [...value] }
      : { kind: typeof value as 'bigint' | 'boolean' | 'number', value };
  } catch (e) {
    result = { kind: 'throw', error: (e as Error).constructor.name };
  }
  inputs.forEach((v, i) => {
    const b = before[i];
    if (
      Array.isArray(v) &&
      (v.length !== (b as unknown[]).length ||
        v.some((x, j) => x !== (b as unknown[])[j]))
    )
      result = { kind: 'throw', error: 'changed an input array' };
  });
  return result;
}

/** The exact value of `value`: a `bigint`, a `boolean`, a list of
 *  `bigint`, or `undefined` when it has none. */
function exactValue(value: Expression): bigint | boolean | bigint[] | undefined {
  if (isSymbol(value, 'True')) return true;
  if (isSymbol(value, 'False')) return false;
  if (isFunction(value, 'List')) {
    const cells = value.ops.map(exactValue);
    return cells.every((c) => typeof c === 'bigint')
      ? (cells as bigint[])
      : undefined;
  }
  if (value.isFiniteCollection === true && !isNumber(value)) {
    const cells = [...value.each()].map(exactValue);
    return cells.every((c) => typeof c === 'bigint')
      ? (cells as bigint[])
      : undefined;
  }
  if (!isNumber(value)) return undefined;
  const r = exactRational(value);
  return r !== undefined && r.q === 1n ? r.p : undefined;
}

/** The exact value of `expr` with the values `inputs` of its free symbols,
 *  by the interpreter. */
function interpreted(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Record<string, Value>
): bigint | boolean | bigint[] | undefined {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function('List', v.map((c) => ce.number(BigInt(c))))
        : ce.number(BigInt(v as bigint)),
    ])
  );
  return exactValue(expr.subs(subs).evaluate());
}

const TWO_53 = 2n ** 53n;
const TWO_64 = 2n ** 64n;

/** The values of each input of a grid. A program with a loop or a range
 *  reads small integers only: a bound past 2^53 runs for ever. */
const BIG: readonly bigint[] = [0n, 1n, -1n, 3n, -7n, TWO_53 + 1n, -TWO_64 - 7n];
const SMALL: readonly bigint[] = [0n, 1n, -1n, 2n, 5n, -3n];
const LISTS: readonly (readonly bigint[])[] = [
  [],
  [5n],
  [1n, -2n, 3n],
  [TWO_64 + 1n, 0n, -5n, TWO_53 + 1n],
];

function gridOf(types: readonly string[], small: boolean): Value[][] {
  let grid: Value[][] = [[]];
  for (const t of types) {
    const values: readonly Value[] = t.startsWith('list')
      ? LISTS
      : (small ? SMALL : BIG).filter((v) => !t.includes('0..') || v >= 0n);
    grid = grid.flatMap((g) => values.map((v) => [...g, v]));
  }
  return grid;
}

const LOOPS = /"(Sum|Product|Range)"/;

/**
 * Compile `json` with the profile and with the existing compiler, compare
 * their outcomes at each point of the grid of its inputs (or of `inputs`)
 * by the contract, and compare a `bigint`, a `boolean` or a list result
 * with the interpreter at its first `interp` points. A `Function` literal
 * at the root is called with its arguments. Returns the outcomes of the
 * profile.
 */
function differential(
  json: Json,
  options: {
    types?: Record<string, string>;
    functions?: Functions;
    inputs?: readonly Inputs[];
    interp?: number;
  } = {}
): Outcome[] {
  const ce = engine(options.types, options.functions);
  const expr = ce.box(json);
  const profiled = compile(expr, PROFILE);
  const existing = compile(expr, EXISTING);
  expect(profiled.success).toBe(true);
  expect(profiled.mode).toBe('bigint');
  expect(profiled.profile).toBe('numeric-kernel');
  const lambda = isFunction(expr, 'Function');
  // The inputs: the free symbols, or the parameters of the root literal.
  const params = lambda
    ? expr.ops.slice(1).map((p) => {
        const typed = isFunction(p, 'Optional') ? p.op1 : p;
        const name = isFunction(typed, 'Typed') ? typed.op1 : typed;
        return {
          name: isSymbol(name) ? name.symbol : '_',
          type: isFunction(typed, 'Typed') ? String(typed.op2).replace(/'/g, '') : 'integer',
        };
      })
    : expr.unknowns.map((name) => ({ name, type: String(ce.symbol(name).type) }));
  const small = LOOPS.test(JSON.stringify(json)) || options.functions !== undefined;
  const grid =
    options.inputs ??
    gridOf(
      params.map((p) => p.type),
      small
    ).map((g) => Object.fromEntries(params.map((p, i) => [p.name, g[i]])));
  let compared = 0;
  const interp = options.interp ?? 4;
  return grid.map((input) => {
    const args = params.map((p) => input[p.name]);
    const call = (r: typeof profiled) => () =>
      lambda ? (r.run as (...a: unknown[]) => unknown)(...args) : r.run!(input as never);
    const a = outcome(call(profiled), args);
    const b = outcome(call(existing), args);
    const where = `${JSON.stringify(json)} at ${Object.entries(input)
      .map(([k, v]) => `${k} = ${String(v)}`)
      .join(', ')}`;
    if (a.kind === 'number' || b.kind === 'number')
      expect([where, a.kind]).toEqual([where, b.kind]);
    else expect([where, a]).toEqual([where, b]);
    if (
      a.kind !== 'number' &&
      a.kind !== 'throw' &&
      compared < interp &&
      String(a.value).length < 5000
    ) {
      compared += 1;
      const exact = lambda
        ? interpreted(ce, expr.op1, input)
        : interpreted(ce, expr, input);
      expect([where, exact]).toEqual([where, a.value]);
    }
    return a;
  });
}

/** The outcome of the profile at `inputs`, or with `args` for a root
 *  `Function` literal. */
function profileAt(
  json: Json,
  inputs: Inputs | readonly Value[],
  types: Record<string, string> = {},
  functions: Functions = {}
): Outcome {
  const ce = engine(types, functions);
  const r = compile(ce.box(json), PROFILE);
  return Array.isArray(inputs)
    ? outcome(() => (r.run as (...a: unknown[]) => unknown)(...inputs), inputs)
    : outcome(() => r.run!(inputs as never), Object.values(inputs));
}

/** The decline of the profile for `json`, as `canCompile()` reports it. */
function decline(json: Json, types = {}, functions: Functions = {}) {
  const ce = engine(types, functions);
  const expr = ce.box(json);
  let error: unknown;
  try {
    compile(expr, PROFILE);
  } catch (e) {
    error = e;
  }
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic as {
    code: string;
    message: string;
  };
  expect(canCompile(expr, PROFILE as never)).toEqual({ ok: false, diagnostic });
  // The existing compiler compiles it.
  expect(compile(expr, EXISTING).success).toBe(true);
  return [diagnostic.code, diagnostic.message];
}

/** The distinct programs of the tests of the mode that slices 3 to 5
 *  admit (a Jest setup file logged each compilation with `mode: 'bigint'`
 *  of the test files that name the mode), with the declared types of their
 *  free symbols and their user functions. */
const WITNESSES: readonly (readonly [unknown, Record<string, string>, Functions])[] = [
  [["List",["Factorial","n"],["Abs",["Factorial","n"]]], {"n":"integer"}, {}],
  [["Add",["f","n"],1], {"n":"integer"}, {"f":[["Function",["Block",["Factorial","x"]],"x"],false]}],
  [["Sum",["Factorial","k"],["Limits","k",0,"n"]], {"n":"integer"}, {}],
  [["Function",["Block",["Factorial","k"]],["Typed","k","'integer'"]], {}, {}],
  [["Sum",["Power","i",2],["Limits","i",1,"n"]], {"n":"integer"}, {}],
  [["Product","i",["Limits","i",1,"n"]], {"n":"integer"}, {}],
  [["At","L","n"], {"L":"list<integer>","n":"integer"}, {}],
  [["First","L"], {"L":"list<integer>"}, {}],
  [["Last","L"], {"L":"list<integer>"}, {}],
  [["Take","L","n"], {"L":"list<integer>","n":"integer"}, {}],
  [["Drop","L","n"], {"L":"list<integer>","n":"integer"}, {}],
  [["Add","n",["Length","L"]], {"n":"integer","L":"list<integer>"}, {}],
  [["Count","L"], {"L":"list<integer>"}, {}],
  [["ReplaceAt","L","n","m"], {"L":"list<integer>","n":"integer","m":"integer"}, {}],
  [["Range","n","m"], {"n":"integer","m":"integer"}, {}],
  [["Range",1,"n"], {"n":"integer"}, {}],
  [["Range","n","m",3], {"n":"integer","m":"integer"}, {}],
  [["Range","n","m",1], {"n":"integer","m":"integer"}, {}],
  [["List","n",["Factorial","n"],["Negate","n"]], {"n":"integer"}, {}],
  [["Add",["Multiply","n",["quo",["Add",["Factorial","m"],["Factorial","n"]],"m"]],["quo",["Add",["Factorial","m"],["Factorial","n"]],"m"]], {"n":"integer","m":"integer"}, {"quo":[["Function",["Block",["Typed",["Divide","x","y"],"'integer'"]],"x","y"],true]}],
  [["If",["NotEqual","m",0],["Add",["Multiply","n",["quo",["Add",["Factorial","m"],["Factorial","n"]],"m"]],["quo",["Add",["Factorial","m"],["Factorial","n"]],"m"]],0], {"m":"integer","n":"integer"}, {"quo":[["Function",["Block",["Typed",["Divide","x","y"],"'integer'"]],"x","y"],true]}],
  [["Add",["Sum",["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]],["Limits","m",1,3]],["Binomial",["Add","m",["Multiply",2,"n"]],["Add","m","n"]]], {"m":"integer","n":"integer"}, {}],
  [["Sum",["Mod","k",7],["Limits","k",1,"n"]], {"n":"integer"}, {}],
  [["Sum",["Floor",["Divide","n","k"]],["Limits","k",1,"n"]], {"n":"integer"}, {}],
  [["Sum",["Multiply",["Factorial",["Add",["Negate","k"],"n"]],["Binomial","n","k"],["Power",-1,"k"]],["Limits","k",0,"n"]], {"n":"integer"}, {}],
  [["Sum","k",["Limits","k",5,"n"]], {"n":"integer"}, {}],
  [["Product","k",["Limits","k",5,"n"]], {"n":"integer"}, {}],
  [["Sum",["Multiply","j","p"],["Limits","p",1,"n"],["Limits","j",1,"p"]], {"n":"integer"}, {}],
  [["half","n"], {"n":"integer"}, {"half":[["Function",["Block",["Typed",["Multiply",["Rational",1,2],"x",["Add","x",1]],"'integer'"]],"x"],true]}],
  [["quo","n","m"], {"n":"integer","m":"integer"}, {"quo":[["Function",["Block",["Typed",["Divide","x","y"],"'integer'"]],"x","y"],true]}],
  [["h","n"], {"n":"integer"}, {"h":[["Function",["Block",["inc","x"]],"x"],false],"inc":[["Function",["Block",["Add","x",1]],"x"],false]}],
  [["Block",["inc","n"]], {"n":"integer"}, {"inc":[["Function",["Block",["Add","x",1]],"x"],false]}],
  [["Sum",["Block",["inc","k"]],["Limits","k",1,"n"]], {"n":"integer"}, {"inc":[["Function",["Block",["Add","x",1]],"x"],false]}],
  [["ReplaceAt","B2",["Multiply",["Rational",1,2],"n"],9], {"B2":"list<integer>","n":"integer"}, {}],
  [["Function",["Block",["Factorial","_SYS"]],["Typed","_SYS","'integer'"]], {}, {}],
  [["Sum",["Factorial","k"],["Limits","k",-1,"n"]], {"n":"integer"}, {}],
  [["half","n"], {"n":"integer"}, {"half":[["Function",["Block",["Typed",["Multiply",["Rational",1,2],"x"],"'integer'"]],"x"],true]}],
  [["Add","n",["At","L",2]], {"n":"integer","L":"list<integer>"}, {}],
  [["Function",["Block",["At","xs",1]],["Typed","xs","'list<integer>'"]], {}, {}],
  [["Function",["Block",["Add","k","x"]],["Typed","x","'integer'"],["Optional",["Typed","k","'integer'"],2]], {}, {}],
  [["Function",["Block",["Add","BigInt",1]],["Typed","BigInt","'integer'"]], {}, {}],
  [["Min","n",["f","n"]], {"n":"integer"}, {"f":[["Function",["Block",["Factorial","x"]],"x"],false]}],
  [["Sum",["Mod","n","k"],["Limits","k",1,"n"]], {"n":"integer"}, {}],
];

describe('the witnesses of slices 3 to 5', () => {
  test.each(WITNESSES)('%j', (json, types, functions) => {
    differential(json as Json, { types, functions });
  });
});

describe('Sum and Product (slice 3)', () => {
  test.each<[string, Json]>([
    ['Sum(k!, k = 0..n)', ['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']]],
    ['Product(k, k = 1..n)', ['Product', 'k', ['Limits', 'k', 1, 'n']]],
    ['Sum(k·m, k = n..m)', ['Sum', ['Multiply', 'k', 'm'], ['Limits', 'k', 'n', 'm']]],
    [
      'Sum(Mod(n, k), k = 1..m) with a zero divisor in no pass',
      ['Sum', ['Mod', 'n', 'k'], ['Limits', 'k', 1, 'm']],
    ],
    [
      'Sum(i·j, i = 1..n, j = i..m)',
      ['Sum', ['Multiply', 'i', 'j'], ['Limits', 'i', 1, 'n'], ['Limits', 'j', 'i', 'm']],
    ],
    [
      'Product(Sum(j, j = 1..i), i = 1..n)',
      ['Product', ['Sum', 'j', ['Limits', 'j', 1, 'i']], ['Limits', 'i', 1, 'n']],
    ],
    [
      'Sum(k, k = 1..n) + Sum(k², k = 1..m)',
      [
        'Add',
        ['Sum', 'k', ['Limits', 'k', 1, 'n']],
        ['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 'm']],
      ],
    ],
    ['If(n < 0, 0, Sum(k!, k = −1..n))', ['If', ['Less', 'n', 0], 0, ['Sum', ['Factorial', 'k'], ['Limits', 'k', -1, 'n']]]],
    ['Sum(Floor(n/k), k = 1..m)', ['Sum', ['Floor', ['Divide', 'n', 'k']], ['Limits', 'k', 1, 'm']]],
  ])('%s', (_, json) => {
    differential(json);
  });

  test('a sum of no term, of one term, and a lower bound above the upper one', () => {
    const sum: Json = ['Sum', ['Factorial', 'k'], ['Limits', 'k', 'n', 'm']];
    const product: Json = ['Product', ['Add', 'k', 1], ['Limits', 'k', 'n', 'm']];
    expect(profileAt(sum, { n: 4n, m: 3n })).toEqual({ kind: 'bigint', value: 0n });
    expect(profileAt(sum, { n: 4n, m: 4n })).toEqual({ kind: 'bigint', value: 24n });
    expect(profileAt(sum, { n: 4n, m: -10n })).toEqual({ kind: 'bigint', value: 0n });
    expect(profileAt(product, { n: 4n, m: 3n })).toEqual({ kind: 'bigint', value: 1n });
    differential(sum, { inputs: [{ n: 4n, m: 3n }, { n: 4n, m: 4n }, { n: 4n, m: -10n }] });
  });

  test('a pole inside the loop ends the call; a pole in a pass that does not run does not', () => {
    const sum: Json = ['Sum', ['Factorial', 'k'], ['Limits', 'k', -1, 'n']];
    expect(profileAt(sum, { n: 5n })).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(sum, { n: -2n })).toEqual({ kind: 'bigint', value: 0n });
    // A pole in the term at the last pass only.
    const late: Json = ['Sum', ['Factorial', ['Subtract', 3, 'k']], ['Limits', 'k', 0, 'n']];
    expect(profileAt(late, { n: 3n })).toEqual({ kind: 'bigint', value: 10n });
    expect(profileAt(late, { n: 4n })).toEqual({ kind: 'number', value: Infinity });
    differential(late, { inputs: [{ n: 3n }, { n: 4n }] });
  });

  test('bounds past 2^53 and 2^64, and a product past 2^64', () => {
    const sum: Json = ['Sum', 'k', ['Limits', 'k', 'n', ['Add', 'n', 3]]];
    for (const n of [TWO_53 - 1n, TWO_64 + 5n, -TWO_64])
      expect(profileAt(sum, { n })).toEqual({ kind: 'bigint', value: 4n * n + 6n });
    // The interpreter refuses a bound past 2^53 - 1 (an `out-of-range`
    // error): no exact value to compare with.
    differential(sum, { inputs: [{ n: TWO_53 - 1n }, { n: TWO_64 + 5n }], interp: 0 });
    const product: Json = ['Product', ['Add', 'k', 'm'], ['Limits', 'k', 1, 'n']];
    differential(product, { inputs: [{ n: 30n, m: TWO_64 }, { n: 3n, m: -TWO_53 }] });
  });

  test('the upper bound is evaluated before the lower one, as by the existing compiler', () => {
    // The lower bound is a pole and the upper one an exact quotient that
    // throws at an odd m: the error of the upper bound comes first.
    const json: Json = [
      'Sum',
      'k',
      ['Limits', 'k', ['Factorial', ['Subtract', 'n', 10]], ['Typed', ['Divide', 'm', 2], "'integer'"]],
    ];
    differential(json, { inputs: [{ n: 3n, m: 3n }, { n: 3n, m: 4n }, { n: 12n, m: 4n }] });
    expect(profileAt(json, { n: 3n, m: 3n })).toEqual({ kind: 'throw', error: 'RangeError' });
    expect(profileAt(json, { n: 3n, m: 4n })).toEqual({ kind: 'number', value: Infinity });
  });

  test('10^4 and 10^5 terms', () => {
    const json: Json = ['Sum', ['Mod', ['Multiply', 'k', 'k'], 7], ['Limits', 'k', 1, 'n']];
    for (const n of [10_000n, 100_000n]) differential(json, { inputs: [{ n }], interp: 0 });
    const ce = engine();
    const r = compile(ce.box(json), PROFILE);
    expect(r.run!({ n: 100_000n } as never)).toBe(
      (() => {
        let s = 0n;
        for (let k = 1n; k <= 100_000n; k++) s += (k * k) % 7n;
        return s;
      })()
    );
    // The loop has a `bigint` counter and no iteration budget: its body is
    // the one statement that adds the term.
    expect(r.code).toMatch(
      /for \(let (_tv\d+) = 1n; \1 <= _tv\d+; \1\+\+\) \{ (_tv\d+) = \2 \+ _SYS\.bfloorMod\(\1 \* \1, 7n\); \}/
    );
  });

  test('the code: a `for` statement with a `bigint` counter, and the facts', () => {
    const ce = engine();
    const expr = ce.box(['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']]);
    const result = compile(expr, PROFILE);
    expect(result.code).toBe(
      "(() => { const _tv1 = typeof _.n === 'number' ? _SYS.toBigint(_.n) : _.n; try { const _tv2 = _tv1; let _tv3 = 0n; for (let _tv4 = 0n; _tv4 <= _tv2; _tv4++) { _tv3 = _tv3 + _SYS.bfactorial(_tv4); } return _tv3; } catch (_tv5) { if (_tv5 instanceof _SYS.NonFiniteValue) return _tv5.value; throw _tv5; } })()"
    );
    expect(canCompile(expr, PROFILE)).toEqual({ ok: true, pure: true, shippable: true });
  });

  test('a node of an inner loop body is not the value of the same node in the loop around it', () => {
    // The node object `k!` in the body of the outer sum (its index k) and in
    // the body of the inner sum (another k): each is its own value.
    const ce = engine();
    const boxed = ce.box([
      'Sum',
      ['Add', ['Factorial', 'k'], ['Sum', ['Factorial', 'k'], ['Limits', 'k', 1, 2]]],
      ['Limits', 'k', 1, 'n'],
    ]);
    const [body, limits] = boxed.ops;
    const f = body.ops[0];
    const inner = ce._fn('Sum', [f, body.ops[1].ops[1]]);
    const expr = ce._fn('Sum', [ce._fn('Add', [f, inner]), limits]);
    const profiled = compile(expr, PROFILE);
    const existing = compile(expr, EXISTING);
    for (const n of [0n, 1n, 4n])
      expect(profiled.run!({ n } as never)).toBe(existing.run!({ n } as never));
    // 1! + 2! + 3! + 4! + 4·(1! + 2!)
    expect(profiled.run!({ n: 4n } as never)).toBe(33n + 12n);
  });

  test('a node outside the loop is computed again in its body, as by the existing compiler', () => {
    const ce = engine();
    const f = ce.box(['Factorial', 'n']);
    const expr = ce._fn('Add', [f, ce._fn('Sum', [f, ce.box(['Limits', 'k', 1, 'm'])])]);
    const profiled = compile(expr, PROFILE);
    expect(profiled.code.split('_SYS.bfactorial(').length - 1).toBe(2);
    for (const inputs of [{ n: 3n, m: 2n }, { n: -1n, m: 0n }])
      expect(outcome(() => profiled.run!(inputs as never))).toEqual(
        outcome(() => compile(expr, EXISTING).run!(inputs as never))
      );
  });
});

describe('the facts of a program with a loop, a function and a list', () => {
  test('a sum carries a scalar: it is not a candidate for any order; the calls are independent', () => {
    const ce = engine({}, { f: [['Function', ['Factorial', 'x'], 'x'], false] });
    const root = ce.box([
      'Sum',
      ['Add', ['f', 'k'], ['At', ['ReplaceAt', 'L', 1, 'k'], 1]],
      ['Limits', 'k', 1, 'n'],
    ]);
    const { program, preparedNodes } = lowerBigintProgram(root, requireBigintLane(root));
    verifyJavaScriptProgram(program, preparedNodes);
    expect(program.functions.map((fn) => fn.name)).toEqual(['f']);
    expect(program.noValueResult).toBe('number');
    const analysis = analyzeExecution(program);
    expect([analysis.independentCalls.holds, analysis.workerPortable.holds]).toEqual([true, true]);
    expect(analysis.parallelLoops.map((j) => j.candidate)).toEqual([false]);
    const judgment = analysis.parallelLoops[0];
    expect(judgment.candidate === false && judgment.reason.reason).toMatch(/^carried scalar/);
  });
});

describe('the names whose definitions the code holds (symbolDeps)', () => {
  // As on the other routes: each user function that the code calls, and
  // each symbol whose value a constant folds, also in the body of a user
  // function, so a host that recompiles when one of them changes gets
  // current code.
  const depsOf = (json: Json, ce: ComputeEngine) => {
    const symbolDeps = new Set<string>();
    compile(ce.box(json), { ...PROFILE, symbolDeps });
    return [...symbolDeps].sort();
  };

  test('a folded symbol at the top level and in the body of a user function', () => {
    const ce = engine({ c: 'integer' }, { g: [['Function', ['Add', 'x', 'c'], 'x'], false] });
    ce.assign('c', 5);
    expect(depsOf(['Add', 'n', 'c'], ce)).toEqual(['c']);
    expect(depsOf(['g', 'n'], ce)).toEqual(['c', 'g']);
    // A constant subtree that reads the symbol.
    expect(depsOf(['Add', 'n', ['Factorial', 'c']], ce)).toEqual(['c']);
    expect(compile(ce.box(['Add', 'n', ['Factorial', 'c']]), PROFILE).run!({ n: 2n } as never)).toBe(122n);
  });

  test('a program with no such name records none', () => {
    const ce = engine();
    expect(depsOf(['Add', 'n', ['Factorial', 3]], ce)).toEqual([]);
    expect(depsOf(['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']], ce)).toEqual([]);
    expect(depsOf(['At', 'L', 'n'], ce)).toEqual([]);
  });
});

describe('user functions (slice 4)', () => {
  const HALF: Functions = { half: [['Function', ['Divide', 'x', 2], 'x'], true] };
  const QUO: Functions = { quo: [['Function', ['Divide', 'x', 'y'], 'x', 'y'], true] };
  const F: Functions = { f: [['Function', ['Factorial', 'x'], 'x'], false] };

  test('half(n) at an odd n throws a RangeError, as the existing compiler', () => {
    differential(['half', 'n'], { functions: HALF });
    expect(profileAt(['half', 'n'], { n: 7n }, {}, HALF)).toEqual({ kind: 'throw', error: 'RangeError' });
    expect(profileAt(['half', 'n'], { n: -TWO_64 }, {}, HALF)).toEqual({ kind: 'bigint', value: -(2n ** 63n) });
  });

  test('quo(m! + n!, m) at m = 0 is a pole; f(n) + 1 at n = −1 is a pole', () => {
    const q: Json = ['quo', ['Add', ['Factorial', 'm'], ['Factorial', 'n']], 'm'];
    differential(q, { functions: QUO });
    expect(profileAt(q, { n: 3n, m: 0n }, {}, QUO)).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['Add', ['f', 'n'], 1], { n: -1n }, {}, F)).toEqual({ kind: 'number', value: Infinity });
  });

  test('a helper that calls a helper, and a helper called in a sum', () => {
    const functions: Functions = {
      inc: [['Function', ['Add', 'x', 1], 'x'], false],
      h: [['Function', ['Multiply', 2, ['inc', 'x']], 'x'], false],
    };
    differential(['Add', ['h', 'n'], ['inc', 'm']], { functions });
    differential(['Sum', ['h', 'k'], ['Limits', 'k', 1, 'n']], { functions });
    expect(profileAt(['h', 'n'], { n: TWO_64 }, {}, functions)).toEqual({ kind: 'bigint', value: 2n * TWO_64 + 2n });
  });

  test('a pole in a helper, in a branch that runs and in one that does not', () => {
    const functions: Functions = {
      g: [['Function', ['If', ['Less', 'x', 0], ['Factorial', ['Subtract', 'x', 1]], ['Add', 'x', 1]], 'x'], false],
      p: [['Function', ['Mod', 'x', 'y'], 'x', 'y'], false],
    };
    differential(['Add', ['g', 'n'], ['p', 'n', 'm']], { functions });
    expect(profileAt(['g', 'n'], { n: -1n }, {}, functions)).toEqual({ kind: 'number', value: Infinity });
    expect(profileAt(['g', 'n'], { n: 3n }, {}, functions)).toEqual({ kind: 'bigint', value: 4n });
    expect(profileAt(['p', 'n', 'm'], { n: 3n, m: 0n }, {}, functions)).toEqual({ kind: 'number', value: NaN });
  });

  test('an inferred signature specialized to the types of the arguments', () => {
    // `sq` has no declared signature: its parameter takes the type of the
    // argument, integer here; each specialization is one function.
    const functions: Functions = { sq: [['Function', ['Multiply', 'x', 'x'], 'x'], false] };
    differential(['Add', ['sq', 'n'], ['sq', ['Add', 'm', 1]], ['sq', 'k0']], { functions });
  });

  test('a helper called twice is one function of the program', () => {
    const ce = engine({}, F);
    const result = compile(ce.box(['Add', ['f', 'n'], ['f', 'm']]), PROFILE);
    expect(result.preamble?.match(/function /g)?.length).toBe(1);
    expect(result.run!({ n: 3n, m: 4n } as never)).toBe(30n);
  });

  test('a recursive function and a helper that reads an input decline', () => {
    const fact: Functions = {
      fact: [['Function', ['If', ['LessEqual', 'x', 1], 1, ['Multiply', 'x', ['fact', ['Subtract', 'x', 1]]]], 'x'], true],
    };
    expect(decline(['fact', 'n'], {}, fact)).toEqual([
      'outside-profile',
      "Could not compile with the profile 'numeric-kernel': the recursive function fact is not in the profile",
    ]);
    const reads: Functions = { r: [['Function', ['Add', 'x', 'm'], 'x'], false] };
    expect(decline(['r', 'n'], {}, reads)).toEqual([
      'outside-profile',
      "Could not compile with the profile 'numeric-kernel': the body of a user function reads the input m, which a function of the profile does not read in the mode bigint",
    ]);
  });
});

describe('lists and the root Function literal (slice 5)', () => {
  test.each<[string, Json]>([
    ['At(L, n)', ['At', 'L', 'n']],
    ['First(L) + Last(L)', ['Add', ['First', 'L'], ['Last', 'L']]],
    ['Length(L) + n', ['Add', ['Length', 'L'], 'n']],
    ['Count(Take(L, n))', ['Count', ['Take', 'L', 'n']]],
    ['Drop(L, n)', ['Drop', 'L', 'n']],
    ['Take(Drop(L, 1), −2)', ['Take', ['Drop', 'L', 1], -2]],
    ['ReplaceAt(L, n, m)', ['ReplaceAt', 'L', 'n', 'm']],
    ['ReplaceAt(L, −1, n + 1)', ['ReplaceAt', 'L', -1, ['Add', 'n', 1]]],
    ['At(ReplaceAt(L, 1, m), 1) + At(L, 1)', ['Add', ['At', ['ReplaceAt', 'L', 1, 'm'], 1], ['At', 'L', 1]]],
    ['[n, n!, −n]', ['List', 'n', ['Factorial', 'n'], ['Negate', 'n']]],
    ['[]', ['List']],
    ['At([n, m], 2)', ['At', ['List', 'n', 'm'], 2]],
    ['Range(n, m)', ['Range', 'n', 'm']],
    ['Range(n)', ['Range', 'n']],
    ['Range(n, m, 2)', ['Range', 'n', 'm', 2]],
    ['Range(n, m, −1)', ['Range', 'n', 'm', -1]],
    ['At(Range(1, 10), n)', ['At', ['Range', 1, 10], 'n']],
    ['Sum(At(L, k), k = 1..Length(L))', ['Sum', ['At', 'L', 'k'], ['Limits', 'k', 1, ['Length', 'L']]]],
    ['Length(L) + Length(M)', ['Add', ['Length', 'L'], ['Length', 'M']]],
    ['a constant list [1, 2^70]', ['At', ['List', 1, ['Power', 2, 70]], 'n']],
  ])('%s', (_, json) => {
    differential(json);
  });

  test('an index out of range is a pole carrying NaN; a position out of range throws', () => {
    expect(profileAt(['At', 'L', 0], { L: [1n, 2n] })).toEqual({ kind: 'number', value: NaN });
    expect(profileAt(['At', 'L', 3], { L: [1n, 2n] })).toEqual({ kind: 'number', value: NaN });
    expect(profileAt(['At', 'L', -2], { L: [1n, 2n] })).toEqual({ kind: 'bigint', value: 1n });
    expect(profileAt(['First', 'L'], { L: [] })).toEqual({ kind: 'number', value: NaN });
    expect(profileAt(['ReplaceAt', 'L', 3, 'n'], { L: [1n, 2n], n: 5n })).toEqual({ kind: 'throw', error: 'RangeError' });
    expect(profileAt(['Take', 'L', 0], { L: [1n, 2n] })).toEqual({ kind: 'list', value: [] });
    expect(profileAt(['Take', 'L', 'n'], { L: [1n, 2n], n: TWO_64 })).toEqual({ kind: 'list', value: [1n, 2n] });
  });

  test('a range of more than 2^32 − 1 elements throws a RangeError, as the existing compiler', () => {
    differential(['Range', 'n'], { inputs: [{ n: 2n ** 33n }], interp: 0 });
    expect(profileAt(['Range', 'n'], { n: 2n ** 33n })).toEqual({ kind: 'throw', error: 'RangeError' });
  });

  test('an input array is not changed by the call', () => {
    const L = [1n, 2n, 3n];
    const r = compile(engine().box(['ReplaceAt', 'L', 2, 'n']), PROFILE);
    expect(r.run!({ L, n: 9n } as never)).toEqual([1n, 9n, 3n]);
    expect(L).toEqual([1n, 2n, 3n]);
  });

  test('number cells and number inputs with the entry check on', () => {
    const json: Json = ['Add', ['At', 'L', 'n'], ['Length', 'L']];
    const ce = engine();
    const profiled = compile(ce.box(json), PROFILE);
    const existing = compile(ce.box(json), EXISTING);
    for (const inputs of [
      { L: [1, 2, 3], n: 2 },
      { L: [1, TWO_64, 3], n: -2 },
      { L: [1.5, 2], n: 1 },
    ])
      expect(outcome(() => profiled.run!(inputs as never))).toEqual(
        outcome(() => existing.run!(inputs as never))
      );
    expect(profiled.run!({ L: [1, 2, 3], n: 2 } as never)).toBe(5n);
  });

  test('a Function literal at the root: one parameter, a list parameter, a list result, an optional parameter', () => {
    differential(['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]]);
    differential([
      'Function',
      ['Add', ['At', 'xs', 'i'], ['Length', 'xs']],
      ['Typed', 'xs', "'list<integer>'"],
      ['Typed', 'i', "'integer'"],
    ]);
    differential([
      'Function',
      ['Range', 1, ['Sum', 'j', ['Limits', 'j', 1, 'k']]],
      ['Typed', 'k', "'integer'"],
    ]);
    const optional: Json = [
      'Function',
      ['Add', 'k', 'x'],
      ['Typed', 'x', "'integer'"],
      ['Optional', ['Typed', 'k', "'integer'"], 2],
    ];
    expect(profileAt(optional, [5n])).toEqual({ kind: 'bigint', value: 7n });
    expect(profileAt(optional, [5n, TWO_64])).toEqual({ kind: 'bigint', value: TWO_64 + 5n });
    // Each call converts its arguments, and a pole gives the number.
    const ce = engine();
    const r = compile(ce.box(['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]]), PROFILE);
    expect(r.code).toBe(
      "(k) => { return (() => { const _tv1 = typeof k === 'number' ? _SYS.toBigint(k) : k; try { return _SYS.bfactorial(_tv1); } catch (_tv2) { if (_tv2 instanceof _SYS.NonFiniteValue) return _tv2.value; throw _tv2; } })(); }"
    );
    const run = r.run as unknown as (k: unknown) => unknown;
    expect([run(5), run(5n), run(-1n)]).toEqual([120n, 120n, Infinity]);
  });

  test('what stays declined: a function operand and a nested list', () => {
    expect(decline(['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', -1, 'n']])).toEqual([
      'outside-profile',
      "Could not compile with the profile 'numeric-kernel': Map with a function operand is not in the profile in the mode bigint",
    ]);
    expect(decline(['Reduce', 'L', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0])).toEqual([
      'outside-profile',
      "Could not compile with the profile 'numeric-kernel': Reduce with a function operand is not in the profile in the mode bigint",
    ]);
    expect(decline(['Length', 'xs'], { xs: 'list<list<integer>>' })).toEqual([
      'outside-profile',
      "Could not compile with the profile 'numeric-kernel': the input xs has the type list<list<integer>>, and the profile holds only a list of integers in the mode bigint",
    ]);
  });
});
