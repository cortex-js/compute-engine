/**
 * The `--bigint` run of the random differential tester of the
 * `numeric-kernel` profile (`scripts/js-profile-fuzz.ts`): random integer
 * programs in the compile mode `bigint`.
 *
 * Each program is made of the operators that the profile admits in the
 * mode (docs/plans/2026-11-11-structured-bigint-mode.md, slices 1 and 2):
 * `Add`, `Subtract`, `Negate`, `Multiply`, `Power` with an exponent that is
 * a small literal, the input `k0` (declared `integer<0..>`) or a power of
 * `-1`, `Abs`, `Sign`, `Min`, `Max`, `Mod`, `Remainder`, `GCD`, `LCM`,
 * `Factorial`, `Factorial2` of `k0`, `Binomial`, `Fibonacci`, `Floor`,
 * `Ceil`, `Round`, `Truncate` and `Typed(…, integer)` of an integer, a
 * quotient, a square root, a product with a rational factor or a power with
 * an integer exponent, `Boole`, `If`, `Which`, the comparisons (also with a
 * rational constant), `And`, `Or`, `Not` and `IsPrime`; and, of slices 3
 * to 5, `Sum` and `Product` (nested, with bounds that are small integers or
 * remainders of the inputs, and the index of an enclosing sum), the calls of
 * the user functions of the engine (`hsq`, whose signature is inferred,
 * `hhalf` and `hquo`, declared `-> integer`, `hfac`, which has a pole, and
 * `hcall`, which calls two of them), the lists of integers (`L`, `List`,
 * `Range` with small bounds, `Take`, `Drop`, `ReplaceAt`) and their reads
 * (`At`, `First`, `Last`, `Length`, `Count`), a list as the result, and a
 * `Function` literal at the root, of one parameter `x`. The inputs are `n`
 * and `m` (declared `integer`), `k0` and `L` (declared `list<integer>`); the
 * literals are small integers, powers of 2 past `2^53` and `2^64` (folded
 * exactly), and constants whose value is a pole (`Factorial(-1)`,
 * `Mod(5, 0)`).
 *
 * Each program is compiled with `profile: 'numeric-kernel', mode: 'bigint'`
 * and with the existing compiler (`mode: 'bigint', cse: false,
 * constantFold: false`), and run on a grid of inputs: each integer given as
 * a `bigint` (past `2^53` and past `2^64`, negative, zero) and, for some
 * points, as a `number` (the entry converts it), and `L` as an array of
 * `bigint` values, or of `number` values at the same points. A program with
 * a loop or a range runs at small integers only. The outcome of a run is a
 * `bigint`, a `boolean`, a list of `bigint` values, a `number` (a pole:
 * `NaN` or `Infinity`) or the class of a thrown error. A difference is:
 *
 * - a `bigint` or a `boolean` that is not the same (`===`) on both, or on
 *   one side only; a list whose length or one of whose elements is not the
 *   same;
 * - a thrown error of another class, or on one side only;
 * - a call that changes the array of `L`.
 *
 * Two `number` results that are not the same number (`NaN` and `Infinity`)
 * are counted apart: the contract of the mode does not fix the number of a
 * pole (AGENTS.md, "Compiled code gives the interpreter's value…"). On a
 * few points a `bigint` or a `boolean` result of the profile is compared
 * with the exact value of `evaluate()`.
 *
 * Each difference is shrunk (a subtree replaced by one of its operands or a
 * leaf while the difference stays) and the minimal programs are
 * deduplicated by their shape (`shapeOf()`).
 */
import { ComputeEngine } from '../src/compute-engine';
import { compile } from '../src/compile';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../src/compute-engine/global-types';
import type { MathJsonExpression } from '../src/math-json/types';
import { exactRational } from '../src/compute-engine/compilation/compile-bigint-lane';

export type BigintJson = number | string | BigintJson[];

/** The mulberry32 generator, as `makeRng()` of the tester. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function choose<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1][0];
}

const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)];

/** The declarations of the engine of the run. */
export const BIGINT_DECLARATIONS =
  'n: integer, m: integer, k0: integer<0..>, x: integer, L: list<integer>; ' +
  'hsq(p) := p·p + 1, hhalf: (integer) -> integer := p/2, ' +
  'hquo: (integer, integer) -> integer := p/q, hfac(p) := (p - 2)!, ' +
  'hcall(p) := hsq(p) + hfac(p)';

function makeBigintEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  ce.declare('k0', 'integer<0..>');
  ce.declare('x', 'integer');
  ce.declare('L', 'list<integer>');
  // The user functions: a signature that is inferred (`hsq`, `hfac`,
  // `hcall`), and declared `-> integer` (`hhalf`, `hquo`: an exact
  // quotient, which throws for a remainder).
  ce.assign('hsq', ce.box(['Function', ['Add', ['Multiply', 'p', 'p'], 1], 'p']));
  ce.declare('hhalf', '(integer) -> integer');
  ce.assign('hhalf', ce.box(['Function', ['Divide', 'p', 2], 'p']));
  ce.declare('hquo', '(integer, integer) -> integer');
  ce.assign('hquo', ce.box(['Function', ['Divide', 'p', 'q'], 'p', 'q']));
  ce.assign('hfac', ce.box(['Function', ['Factorial', ['Subtract', 'p', 2]], 'p']));
  ce.assign(
    'hcall',
    ce.box(['Function', ['Add', ['hsq', 'p'], ['hfac', 'p']], 'p'])
  );
  return ce;
}

const LITERALS: readonly (readonly [BigintJson, number])[] = [
  [0, 3],
  [1, 3],
  [-1, 2],
  [2, 3],
  [3, 2],
  [-3, 1],
  [7, 2],
  [10, 1],
  // Folded exactly past 2^53 and 2^64.
  [['Power', 2, 70], 1],
  [['Add', ['Power', 2, 64], 7], 1],
  // Constants whose value is a pole.
  [['Factorial', -1], 0.3],
  [['Mod', 5, 0], 0.3],
];

const RATIONALS: readonly BigintJson[] = [
  ['Rational', 7, 2],
  ['Rational', -5, 3],
  ['Rational', 1, 2],
];

/** The indices of the sums around the expression being generated, the
 *  innermost last. */
let BOUND: string[] = [];

function genLeaf(rng: Rng): BigintJson {
  const kind = choose<'input' | 'literal' | 'index'>(rng, [
    ['input', 9],
    ['literal', 3],
    ['index', BOUND.length > 0 ? 6 : 0],
  ]);
  if (kind === 'literal') return choose(rng, LITERALS);
  if (kind === 'index') return pick(rng, BOUND);
  return pick(rng, ['n', 'n', 'm', 'k0']) as string;
}

/** A bound of a sum or of a range: a small integer, a remainder of an
 *  input, or an index of an enclosing sum. */
function genBound(rng: Rng): BigintJson {
  return choose<() => BigintJson>(rng, [
    [() => pick<BigintJson>(rng, [0, 1, 2, 3, 5, -2]), 4],
    [() => ['Mod', pick(rng, ['n', 'm', 'k0']), pick(rng, [3, 5, 7])], 3],
    [() => ['Subtract', ['Mod', pick(rng, ['n', 'm']), 6], 2], 1],
    [() => (BOUND.length > 0 ? pick(rng, BOUND) : 4), 2],
  ])();
}

/** A list of integers of depth at most `depth`. */
function genList(rng: Rng, depth: number): BigintJson {
  const sub = () => genInteger(rng, depth - 1);
  const list = () => genList(rng, depth - 1);
  if (depth <= 0) return 'L';
  return choose<() => BigintJson>(rng, [
    [() => 'L', 4],
    [() => (rng() < 0.5 ? ['List', sub(), sub()] : ['List', sub(), sub(), sub()]), 2],
    [() => ['Range', genBound(rng), genBound(rng)], 2],
    [() => ['Range', genBound(rng), genBound(rng), pick<BigintJson>(rng, [2, -1, 3])], 1],
    [() => ['Range', genBound(rng)], 1],
    [() => ['Take', list(), sub()], 2],
    [() => ['Drop', list(), sub()], 2],
    [() => ['ReplaceAt', list(), pick<BigintJson>(rng, [1, -1, 2, ['Mod', 'n', 3]]), sub()], 2],
  ])();
}

/** A read of a list: an integer. */
function genListRead(rng: Rng, depth: number): BigintJson {
  const list = genList(rng, depth - 1);
  return choose<() => BigintJson>(rng, [
    [() => ['At', list, pick<BigintJson>(rng, [1, 2, -1, 0, 'n', ['Mod', 'm', 4]])], 4],
    [() => ['First', list], 1],
    [() => ['Last', list], 1],
    [() => ['Length', list], 2],
    [() => ['Count', list], 1],
  ])();
}

type IntegerHead =
  | 'Add'
  | 'Subtract'
  | 'Negate'
  | 'Multiply'
  | 'Power'
  | 'NegOnePower'
  | 'Abs'
  | 'Sign'
  | 'Min'
  | 'Max'
  | 'Mod'
  | 'Remainder'
  | 'GCD'
  | 'LCM'
  | 'Factorial'
  | 'Factorial2'
  | 'Binomial'
  | 'Fibonacci'
  | 'Rounding'
  | 'Typed'
  | 'Boole'
  | 'If'
  | 'Which'
  | 'Sum'
  | 'Call'
  | 'ListRead';

const INTEGER_HEADS: readonly (readonly [IntegerHead, number])[] = [
  ['Add', 6],
  ['Subtract', 2],
  ['Negate', 2],
  ['Multiply', 5],
  ['Power', 2],
  ['NegOnePower', 1],
  ['Abs', 1],
  ['Sign', 1],
  ['Min', 1],
  ['Max', 1],
  ['Mod', 3],
  ['Remainder', 2],
  ['GCD', 1],
  ['LCM', 1],
  ['Factorial', 2],
  ['Factorial2', 1],
  ['Binomial', 1],
  ['Fibonacci', 1],
  ['Rounding', 6],
  ['Typed', 2],
  ['Boole', 1],
  ['If', 3],
  ['Which', 1],
  ['Sum', 2],
  ['Call', 2],
  ['ListRead', 3],
];

/** An integer expression of depth at most `depth`. */
function genInteger(rng: Rng, depth: number): BigintJson {
  if (depth <= 0 || rng() < 0.25) return genLeaf(rng);
  const sub = () => genInteger(rng, depth - 1);
  switch (choose(rng, INTEGER_HEADS)) {
    case 'Add':
      return rng() < 0.3 ? ['Add', sub(), sub(), sub()] : ['Add', sub(), sub()];
    case 'Subtract':
      return ['Subtract', sub(), sub()];
    case 'Negate':
      return ['Negate', sub()];
    case 'Multiply':
      return ['Multiply', sub(), sub()];
    case 'Power':
      return [
        'Power',
        sub(),
        choose<BigintJson>(rng, [
          [0, 1],
          [2, 2],
          [3, 2],
          [5, 1],
          ['k0', 2],
        ]),
      ];
    case 'NegOnePower':
      return ['Power', -1, sub()];
    case 'Abs':
      return ['Abs', sub()];
    case 'Sign':
      return ['Sign', sub()];
    case 'Min':
      return ['Min', sub(), sub()];
    case 'Max':
      return rng() < 0.5 ? ['Max', sub(), sub()] : ['Max', sub(), sub(), sub()];
    case 'Mod':
      return ['Mod', sub(), sub()];
    case 'Remainder':
      return ['Remainder', sub(), sub()];
    case 'GCD':
      return ['GCD', sub(), sub()];
    case 'LCM':
      return ['LCM', sub(), sub()];
    case 'Factorial':
      return ['Factorial', sub()];
    case 'Factorial2':
      return ['Factorial2', 'k0'];
    case 'Binomial':
      return ['Binomial', sub(), sub()];
    case 'Fibonacci':
      return ['Fibonacci', sub()];
    case 'Rounding':
      return [
        pick(rng, ['Floor', 'Ceil', 'Round', 'Truncate']),
        genForced(rng, depth - 1, false),
      ];
    case 'Typed':
      return ['Typed', genForced(rng, depth - 1, true), "'integer'"];
    case 'Boole':
      return ['Boole', genCondition(rng, depth - 1)];
    case 'If':
      return ['If', genCondition(rng, depth - 1), sub(), sub()];
    case 'Which':
      return [
        'Which',
        genCondition(rng, depth - 1),
        sub(),
        genCondition(rng, depth - 1),
        sub(),
        'True',
        sub(),
      ];
    case 'Sum': {
      // One or two indices; the body sees every index, the bounds of the
      // second one the first one.
      const indices = BOUND.length === 0 ? ['k', 'j'] : ['j2', 'k2'];
      const head = rng() < 0.75 ? 'Sum' : 'Product';
      const outer = indices[0];
      const limits: BigintJson[] = [['Limits', outer, genBound(rng), genBound(rng)]];
      const saved = BOUND;
      BOUND = [...BOUND, outer];
      try {
        if (rng() < 0.3) {
          limits.push(['Limits', indices[1], genBound(rng), genBound(rng)]);
          BOUND = [...BOUND, indices[1]];
        }
        // A body of depth at most 2: each pass runs it.
        return [head, genInteger(rng, Math.min(depth - 1, 2)), ...limits];
      } finally {
        BOUND = saved;
      }
    }
    case 'Call':
      return choose<() => BigintJson>(rng, [
        [() => ['hsq', sub()], 2],
        [() => ['hhalf', sub()], 1],
        [() => ['hquo', sub(), sub()], 1],
        [() => ['hfac', sub()], 1],
        [() => ['hcall', sub()], 1],
      ])();
    case 'ListRead':
      return genListRead(rng, depth);
  }
}

/** The operand of an integer-forcing parent: an integer, or a shape that
 *  the parent lowers. A square root only under a rounding (`promise`
 *  false). */
function genForced(rng: Rng, depth: number, promise: boolean): BigintJson {
  const sub = () => genInteger(rng, depth - 1);
  return choose<() => BigintJson>(rng, [
    [() => ['Divide', sub(), sub()], 5],
    [() => ['Multiply', pick(rng, RATIONALS), sub()], 2],
    [() => ['Power', sub(), pick<BigintJson>(rng, ['m', 'n', -1, -2])], 2],
    [() => (promise ? ['Divide', sub(), 2] : ['Sqrt', sub()]), 2],
    [() => sub(), 1],
  ])();
}

const COMPARISONS = [
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
];

/** A boolean expression of depth at most `depth`. */
function genCondition(rng: Rng, depth: number): BigintJson {
  const sub = () => genInteger(rng, depth - 1);
  if (depth <= 0) return [pick(rng, COMPARISONS), genLeaf(rng), genLeaf(rng)];
  return choose<() => BigintJson>(rng, [
    [() => [pick(rng, COMPARISONS), sub(), sub()], 6],
    [
      () =>
        rng() < 0.5
          ? [pick(rng, COMPARISONS), sub(), pick(rng, RATIONALS)]
          : [pick(rng, COMPARISONS), pick(rng, RATIONALS), sub()],
      2,
    ],
    [
      () => [
        pick(rng, ['And', 'Or']),
        genCondition(rng, depth - 1),
        genCondition(rng, depth - 1),
      ],
      2,
    ],
    [() => ['Not', genCondition(rng, depth - 1)], 1],
    [() => ['IsPrime', sub()], 1],
  ])();
}

/** A program: an integer, a boolean one time in six, a list one time in
 *  ten, and a `Function` literal of one integer parameter `x` one time in
 *  twelve, whose body reads `x` in place of the inputs. */
export function generateBigintProgram(rng: Rng, depth: number): BigintJson {
  BOUND = [];
  const r = rng();
  if (r < 1 / 6) return genCondition(rng, depth);
  if (r < 1 / 6 + 1 / 10) return genList(rng, depth);
  if (r < 1 / 6 + 1 / 10 + 1 / 12)
    return [
      'Function',
      parameterBody(genInteger(rng, depth)),
      ['Typed', 'x', "'integer'"],
    ];
  return genInteger(rng, depth);
}

/** `json` with each input read as the parameter `x` (`k0` as `Abs(x)`, `L`
 *  as a list literal): the body of a `Function` literal at the root. */
function parameterBody(json: BigintJson): BigintJson {
  if (json === 'n' || json === 'm') return 'x';
  if (json === 'k0') return ['Abs', 'x'];
  if (json === 'L') return ['List', 'x', 2, -3];
  if (!Array.isArray(json)) return json;
  return json.map((x, i) => (i === 0 ? x : parameterBody(x)));
}

function nodeCount(json: BigintJson): number {
  return Array.isArray(json)
    ? 1 + json.slice(1).reduce<number>((s, x) => s + nodeCount(x), 0)
    : 1;
}

//
// Runs
//

type Inputs = Record<string, bigint | number | readonly (bigint | number)[]>;

/** The integers of the grid, as `bigint` values. */
const INTEGERS: readonly bigint[] = [
  0n,
  1n,
  -1n,
  2n,
  3n,
  -3n,
  7n,
  -7n,
  16n,
  17n,
  20n,
  2n ** 53n + 1n,
  -(2n ** 53n) - 1n,
  3n * 2n ** 52n,
  2n ** 64n + 7n,
  -(2n ** 64n) - 7n,
];

/** The integers of the grid of a program with a loop or a range: a bound
 *  past `2^53` would run for ever. */
const SMALL_INTEGERS: readonly bigint[] = [0n, 1n, -1n, 2n, 3n, -3n, 7n, -7n];

/** The lists of the grid. */
const LISTS: readonly (readonly bigint[])[] = [
  [],
  [5n],
  [1n, -2n, 3n],
  [2n ** 64n + 1n, 0n, -5n, 2n ** 53n + 1n],
];

/** The inputs of the grid: every pair of `INTEGERS` (or `SMALL_INTEGERS`
 *  with `small`) for `n` and `m`, with `k0` from its non-negative values,
 *  `x` the value of `n`, and `L` from `LISTS`; one point in four gives its
 *  integers as `number` values where they are safe integers. */
function gridOf(rng: Rng, points: number, small = false): Inputs[] {
  const integers = small ? SMALL_INTEGERS : INTEGERS;
  const nonNegative = integers.filter((v) => v >= 0n);
  const all: Inputs[] = [];
  for (const n of integers)
    for (const m of integers) {
      const k0 = nonNegative[(all.length * 7) % nonNegative.length];
      const L = LISTS[(all.length * 3) % LISTS.length];
      all.push({ n, m, k0, x: n, L });
    }
  // Sample `points` of them, then give some as numbers.
  const sampled =
    all.length <= points
      ? all
      : Array.from({ length: points }, () => pick(rng, all));
  // The entry check of the mode admits a `number` that is a safe integer.
  const asNumber = (
    v: bigint | number | readonly (bigint | number)[]
  ): bigint | number | readonly (bigint | number)[] =>
    Array.isArray(v)
      ? v.map((c) => asNumber(c) as bigint | number)
      : typeof v === 'bigint' && Number.isSafeInteger(Number(v))
        ? Number(v)
        : (v as bigint | number);
  return sampled.map((p, i) =>
    i % 4 === 3
      ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, asNumber(v)]))
      : p
  );
}

type Outcome =
  | { readonly kind: 'bigint' | 'boolean' | 'number'; readonly value: unknown }
  | { readonly kind: 'list'; readonly value: readonly unknown[] }
  | { readonly kind: 'throw'; readonly error: string };

/** The outcome of `run` at `inputs`; a call that changes the array of an
 *  input is an outcome of its own. */
function runOutcome(run: (inputs: Inputs) => unknown, inputs: Inputs): Outcome {
  const arrays = Object.values(inputs).filter((v) => Array.isArray(v));
  const before = arrays.map((a) => [...(a as unknown[])]);
  const changed = () =>
    arrays.some(
      (a, i) =>
        a.length !== before[i].length ||
        (a as unknown[]).some((c, j) => c !== before[i][j])
    );
  let outcome: Outcome;
  try {
    const value = run(inputs);
    const kind = typeof value;
    outcome = Array.isArray(value)
      ? { kind: 'list', value: [...value] }
      : kind === 'bigint' || kind === 'boolean' || kind === 'number'
        ? { kind, value }
        : { kind: 'throw', error: `a value of the type ${kind}` };
  } catch (e) {
    outcome = {
      kind: 'throw',
      error: (e as { constructor?: { name?: string } })?.constructor?.name ?? 'Error',
    };
  }
  return changed() ? { kind: 'throw', error: 'a change of an input array' } : outcome;
}

/** `different` for a difference of the contract, `number` for two numbers
 *  that are not the same, `same` otherwise. Two lists are the same when
 *  they have the same length and each element is the same (`===`). */
function compareOutcomes(a: Outcome, b: Outcome): 'same' | 'number' | 'different' {
  if (a.kind === 'throw' || b.kind === 'throw')
    return a.kind === b.kind && a.error === b.error ? 'same' : 'different';
  if (a.kind !== b.kind) return 'different';
  if (a.kind === 'number')
    return Object.is(a.value, b.value) ? 'same' : 'number';
  if (a.kind === 'list') {
    const x = b.value as readonly unknown[];
    return a.value.length === x.length && a.value.every((c, i) => c === x[i])
      ? 'same'
      : 'different';
  }
  return a.value === b.value ? 'same' : 'different';
}

type Compiled =
  | { readonly ok: true; readonly code: string; readonly run: (i: Inputs) => unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

function compileBigint(expr: Expression, profile: boolean): Compiled {
  try {
    const result = compile(
      expr,
      profile
        ? ({ profile: 'numeric-kernel', mode: 'bigint', fallback: false } as const)
        : ({
            mode: 'bigint',
            cse: false,
            constantFold: false,
            fallback: false,
          } as const)
    );
    const runner = result.run as unknown as (...args: unknown[]) => unknown;
    // A `Function` literal at the root is called with `x`.
    const run =
      result.calling === 'lambda'
        ? (i: Inputs) => runner(i.x)
        : (runner as (i: Inputs) => unknown);
    if (!result.success || typeof runner !== 'function')
      return {
        ok: false,
        code: result.diagnostic?.code ?? 'no-run',
        message: result.diagnostic?.message ?? 'no run function',
      };
    return { ok: true, code: result.code, run };
  } catch (e) {
    const error = e as { diagnostic?: { code?: string }; name?: string; message?: string };
    return {
      ok: false,
      code: error.diagnostic?.code ?? error.name ?? 'Error',
      message: String(error.message ?? e),
    };
  }
}

/** The substitution of `inputs` in the program `expr`: the body of a
 *  `Function` literal at the root, with the value of `x`. */
function substituted(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): Expression {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function('List', v.map((c) => ce.number(BigInt(c))))
        : ce.number(BigInt(v as bigint)),
    ])
  );
  return (isFunction(expr, 'Function') ? expr.op1 : expr).subs(subs);
}

/** The exact value of `value`: a `bigint`, a `boolean`, a list of `bigint`
 *  values, or `undefined` when it has no such value. */
function exactValue(value: Expression): bigint | boolean | bigint[] | undefined {
  if (isSymbol(value, 'True')) return true;
  if (isSymbol(value, 'False')) return false;
  if (!isNumber(value) && value.isFiniteCollection === true) {
    const cells = [...value.each()].map(exactValue);
    return cells.every((c) => typeof c === 'bigint') ? (cells as bigint[]) : undefined;
  }
  if (!isNumber(value)) return undefined;
  const r = exactRational(value);
  return r !== undefined && r.q === 1n ? r.p : undefined;
}

/** The exact value of `expr` at `inputs` by the interpreter: a `bigint`, a
 *  `boolean`, a list of `bigint` values, or `undefined` when it has no such
 *  value. */
function interpret(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): bigint | boolean | bigint[] | undefined {
  try {
    return exactValue(substituted(ce, expr, inputs).evaluate());
  } catch {
    return undefined;
  }
}

/** The text of the value of `evaluate()` of `expr` at `inputs`. */
function interpretedText(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): string {
  try {
    return substituted(ce, expr, inputs).evaluate().toString().slice(0, 200);
  } catch (e) {
    return `throws ${(e as Error).constructor.name}`;
  }
}

export interface BigintFuzzOptions {
  readonly seeds: readonly number[];
  readonly count: number;
  readonly depth: number;
  readonly size: number;
  readonly points: number;
  readonly interp: number;
  readonly shrink: number;
}

export interface BigintFinding {
  readonly class: 'difference' | 'number' | 'profile-failure' | 'interpreter';
  readonly shape: string;
  count: number;
  readonly id: string;
  readonly original: BigintJson;
  readonly minimal: BigintJson;
  readonly canonical: unknown;
  readonly input?: Inputs;
  readonly profileCode?: string;
  readonly existingCode?: string;
  readonly profile?: Outcome;
  readonly existing?: Outcome;
  readonly interpreter?: bigint | boolean | bigint[];
  readonly message?: string;
}

export interface BigintFuzzResult {
  readonly options: BigintFuzzOptions;
  readonly programs: number;
  readonly invalid: number;
  readonly classes: Record<string, number>;
  readonly points: number;
  readonly interpreterPoints: { compared: number; skipped: number };
  /** The first points where the interpreter has no exact value and the
   *  profile has a `bigint` or a `boolean`, with the value that
   *  `evaluate()` gives. */
  readonly skippedExamples: {
    readonly program: BigintJson;
    readonly input: Inputs;
    readonly profile: string;
    readonly interpreter: string;
  }[];
  readonly declines: { message: string; count: number; example: string }[];
  readonly findings: BigintFinding[];
}

/** The shape of a program: each leaf replaced by `_`. */
function shapeOf(json: unknown): string {
  if (!Array.isArray(json)) return json === 'True' ? 'True' : '_';
  const [head, ...rest] = json;
  if (head === 'Rational') return '_';
  return `${String(head)}(${rest.map(shapeOf).join(', ')})`;
}

function normalizeMessage(message: string): string {
  return message
    .replace(/`[^`]*`/g, '`…`')
    .replace(/\b-?\d+\b/g, 'N')
    .slice(0, 160);
}

/** What a program shows at the inputs of `grid`, or `undefined`. */
type Witness = {
  readonly class: BigintFinding['class'];
  readonly input?: Inputs;
  readonly profileCode?: string;
  readonly existingCode?: string;
  readonly profile?: Outcome;
  readonly existing?: Outcome;
  readonly interpreter?: bigint | boolean | bigint[];
  readonly message?: string;
};

function differenceAt(
  expr: Expression,
  grid: readonly Inputs[],
  wanted: 'difference' | 'number'
): Witness | undefined {
  const profiled = compileBigint(expr, true);
  const existing = compileBigint(expr, false);
  if (!profiled.ok || !existing.ok) return undefined;
  for (const input of grid) {
    const a = runOutcome(profiled.run, input);
    const b = runOutcome(existing.run, input);
    if (compareOutcomes(a, b) === (wanted === 'difference' ? 'different' : 'number'))
      return {
        class: wanted,
        input,
        profileCode: profiled.code,
        existingCode: existing.code,
        profile: a,
        existing: b,
      };
  }
  return undefined;
}

/** The candidates of a shrink of `json`: each operand, and each leaf. */
function shrinkCandidates(json: BigintJson): BigintJson[] {
  if (!Array.isArray(json)) return [];
  return [...json.slice(1).filter((x) => x !== "'integer'"), 'n', 1, 0];
}

function shrinkPaths(json: BigintJson, path: number[] = [], out: number[][] = []) {
  out.push(path);
  if (Array.isArray(json))
    json.forEach((x, i) => {
      if (i > 0) shrinkPaths(x, [...path, i], out);
    });
  return out;
}

function atPath(json: BigintJson, path: readonly number[]): BigintJson {
  return path.reduce<BigintJson>((j, i) => (j as BigintJson[])[i], json);
}

function replaceAtPath(
  json: BigintJson,
  path: readonly number[],
  value: BigintJson
): BigintJson {
  if (path.length === 0) return value;
  const copy = [...(json as BigintJson[])];
  copy[path[0]] = replaceAtPath(copy[path[0]], path.slice(1), value);
  return copy;
}

/** Shrink `json` while `holds` gives a witness, within `budget` checks. */
function shrink(
  ce: ComputeEngine,
  json: BigintJson,
  holds: (expr: Expression) => Witness | undefined,
  budget: number
): { json: BigintJson; witness: Witness | undefined } {
  let current = json;
  let witness = holds(ce.box(current as MathJsonExpression));
  let checks = 0;
  let changed = true;
  while (changed && checks < budget) {
    changed = false;
    for (const path of shrinkPaths(current)) {
      for (const candidate of shrinkCandidates(atPath(current, path))) {
        if (checks++ >= budget) break;
        const next = replaceAtPath(current, path, candidate);
        let expr: Expression;
        try {
          expr = ce.box(next as MathJsonExpression);
          if (!expr.isValid) continue;
        } catch {
          continue;
        }
        const w = holds(expr);
        if (w !== undefined) {
          current = next;
          witness = w;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return { json: current, witness };
}

/** The run of `--bigint`. */
export async function runBigintFuzz(
  options: BigintFuzzOptions,
  log: (line: string) => void = () => {}
): Promise<BigintFuzzResult> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await runQuietly(options, log);
  } finally {
    console.warn = warn;
  }
}

async function runQuietly(
  options: BigintFuzzOptions,
  log: (line: string) => void
): Promise<BigintFuzzResult> {
  const classes: Record<string, number> = {
    'both compile': 0,
    'both decline': 0,
    'profile declines only': 0,
    'existing declines only': 0,
    'profile failure': 0,
  };
  const declines = new Map<string, { count: number; example: string }>();
  const findings = new Map<string, BigintFinding>();
  let programs = 0;
  let invalid = 0;
  let points = 0;
  const interpreterPoints = { compared: 0, skipped: 0 };
  const skippedExamples: BigintFuzzResult['skippedExamples'] = [];
  let ce = makeBigintEngine();
  const record = (
    cls: BigintFinding['class'],
    id: string,
    original: BigintJson,
    holds: (expr: Expression) => Witness | undefined
  ) => {
    const canonicalShape = shapeOf(ce.box(original as MathJsonExpression).json);
    for (const f of findings.values())
      if (f.class === cls && f.shape === canonicalShape) {
        f.count += 1;
        return;
      }
    const { json, witness } = shrink(ce, original, holds, options.shrink);
    const canonical = ce.box(json as MathJsonExpression).json;
    const key = `${cls}:${shapeOf(canonical)}`;
    const known = findings.get(key);
    if (known !== undefined) {
      known.count += 1;
      return;
    }
    findings.set(key, {
      class: cls,
      shape: shapeOf(canonical),
      count: 1,
      id,
      original,
      minimal: json,
      canonical,
      ...witness,
    });
  };
  for (const seed of options.seeds) {
    const rng = makeRng(seed);
    for (let index = 0; index < options.count; index++) {
      if (index % 200 === 0) {
        ce = makeBigintEngine();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (index > 0) log(`seed ${seed}: ${index} programs`);
      }
      let json = generateBigintProgram(rng, options.depth);
      while (nodeCount(json) > options.size)
        json = generateBigintProgram(rng, options.depth);
      const grid = gridOf(
        rng,
        options.points,
        /"(Sum|Product|Range)"/.test(JSON.stringify(json))
      );
      programs += 1;
      const id = `${seed}:${index}`;
      let expr: Expression;
      try {
        expr = ce.box(json as MathJsonExpression);
      } catch {
        invalid += 1;
        continue;
      }
      if (!expr.isValid) {
        invalid += 1;
        continue;
      }
      const profiled = compileBigint(expr, true);
      const existing = compileBigint(expr, false);
      if (!profiled.ok && profiled.code !== 'outside-profile') {
        classes['profile failure'] += 1;
        record('profile-failure', id, json, (e) => {
          const p = compileBigint(e, true);
          return !p.ok && p.code !== 'outside-profile'
            ? { class: 'profile-failure', message: `${p.code}: ${p.message}` }
            : undefined;
        });
        continue;
      }
      if (!profiled.ok) {
        const message = normalizeMessage(profiled.message);
        const d = declines.get(message);
        if (d === undefined) declines.set(message, { count: 1, example: JSON.stringify(json) });
        else d.count += 1;
        classes[existing.ok ? 'profile declines only' : 'both decline'] += 1;
        continue;
      }
      if (!existing.ok) {
        classes['existing declines only'] += 1;
        continue;
      }
      classes['both compile'] += 1;
      let difference = false;
      let numbers = false;
      let interpreted = 0;
      for (const input of grid) {
        points += 1;
        const a = runOutcome(profiled.run, input);
        const b = runOutcome(existing.run, input);
        const c = compareOutcomes(a, b);
        if (c === 'different') difference = true;
        if (c === 'number') numbers = true;
        if (
          c === 'same' &&
          interpreted < options.interp &&
          (a.kind === 'bigint' || a.kind === 'boolean' || a.kind === 'list') &&
          String(a.value).length < 2000
        ) {
          interpreted += 1;
          const exact = interpret(ce, expr, input);
          if (exact === undefined) {
            interpreterPoints.skipped += 1;
            if (skippedExamples.length < 10)
              skippedExamples.push({
                program: json,
                input,
                profile: formatOutcome(a),
                interpreter: interpretedText(ce, expr, input),
              });
          }
          else {
            interpreterPoints.compared += 1;
            const expected: Outcome = Array.isArray(exact)
              ? { kind: 'list', value: exact }
              : { kind: a.kind as 'bigint' | 'boolean', value: exact };
            if (compareOutcomes(a, expected) !== 'same')
              record('interpreter', id, json, () => ({
                class: 'interpreter',
                input,
                profileCode: profiled.code,
                profile: a,
                interpreter: exact,
              }));
          }
        }
      }
      if (difference)
        record('difference', id, json, (e) => differenceAt(e, grid, 'difference'));
      if (numbers)
        record('number', id, json, (e) => differenceAt(e, grid, 'number'));
    }
  }
  return {
    options,
    programs,
    invalid,
    classes,
    points,
    interpreterPoints,
    skippedExamples,
    declines: [...declines]
      .map(([message, d]) => ({ message, ...d }))
      .sort((a, b) => b.count - a.count),
    findings: [...findings.values()],
  };
}

function formatOutcome(o: Outcome | undefined): string {
  if (o === undefined) return '';
  if (o.kind === 'throw') return `throws ${o.error}`;
  if (o.kind === 'list')
    return `[${o.value.map((c) => `${String(c)}n`).join(', ')}]`;
  return o.kind === 'bigint' ? `${String(o.value)}n` : String(o.value);
}

const formatInputs = (inputs: Inputs | undefined): string =>
  inputs === undefined
    ? ''
    : Object.entries(inputs)
        .map(
          ([k, v]) =>
            `${k} = ${Array.isArray(v) ? `[${v.map(String).join(', ')}]` : typeof v === 'bigint' ? `${v}n` : String(v)}`
        )
        .join(', ');

const TITLES: Readonly<Record<BigintFinding['class'], string>> = {
  'difference':
    'Differences between the profile and the existing compiler (a bigint, a boolean or an error)',
  'number':
    'Two numbers that are not the same (a pole: allowed by the contract of the mode)',
  'profile-failure': 'Failures of the profile that are not declines',
  'interpreter': 'Disagreements of the profile with the interpreter',
};

export function printBigintResult(result: BigintFuzzResult, quiet: boolean): string {
  const lines: string[] = [];
  const o = result.options;
  lines.push(
    `bigint: seeds ${o.seeds.join(',')}; ${result.programs} programs (${result.invalid} not valid after boxing); depth ${o.depth}, size ${o.size}, points ${o.points}`
  );
  lines.push(`declarations: ${BIGINT_DECLARATIONS}`);
  lines.push('');
  lines.push('Classes (program):');
  for (const [name, n] of Object.entries(result.classes))
    lines.push(`  ${name}: ${n}`);
  lines.push(`Points compared: ${result.points}`);
  lines.push(
    `Interpreter: ${result.interpreterPoints.compared} points compared, ${result.interpreterPoints.skipped} with no exact value of the interpreter`
  );
  for (const c of Object.keys(TITLES) as BigintFinding['class'][]) {
    const list = result.findings.filter((f) => f.class === c);
    lines.push(
      `  ${TITLES[c]}: ${list.length} shapes, ${list.reduce((s, f) => s + f.count, 0)} programs`
    );
  }
  lines.push('');
  lines.push('Declines of the profile, most frequent first:');
  for (const d of result.declines.slice(0, 30))
    lines.push(`  ${String(d.count).padStart(6)}  ${d.message}    e.g. ${d.example}`);
  if (quiet) return lines.join('\n');
  if (result.skippedExamples.length > 0) {
    lines.push('');
    lines.push('## Points where the interpreter has no exact value (the first ones)');
    for (const x of result.skippedExamples)
      lines.push(
        `- ${JSON.stringify(x.program)} at ${formatInputs(x.input)}: profile ${x.profile}, interpreter ${x.interpreter}`
      );
  }
  for (const c of Object.keys(TITLES) as BigintFinding['class'][]) {
    const list = result.findings.filter((f) => f.class === c);
    if (list.length === 0) continue;
    lines.push('');
    lines.push(`## ${TITLES[c]}`);
    for (const f of list) {
      lines.push('');
      lines.push(`- shape ${f.shape}  (${f.count} programs; first ${f.id})`);
      lines.push(`  minimal:   ${JSON.stringify(f.minimal)}`);
      lines.push(`  canonical: ${JSON.stringify(f.canonical)}`);
      if (f.input !== undefined) lines.push(`  input:     ${formatInputs(f.input)}`);
      if (f.profileCode !== undefined) lines.push(`  profile:   ${f.profileCode}`);
      if (f.existingCode !== undefined) lines.push(`  existing:  ${f.existingCode}`);
      if (f.profile !== undefined) lines.push(`  profile value:  ${formatOutcome(f.profile)}`);
      if (f.existing !== undefined) lines.push(`  existing value: ${formatOutcome(f.existing)}`);
      if (f.interpreter !== undefined)
        lines.push(
          `  interpreter:    ${typeof f.interpreter === 'bigint' ? `${f.interpreter}n` : Array.isArray(f.interpreter) ? `[${f.interpreter.join(', ')}]` : String(f.interpreter)}`
        );
      if (f.message !== undefined) lines.push(`  message:   ${f.message.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}
