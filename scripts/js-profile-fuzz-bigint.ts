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
 * rational constant), `And`, `Or`, `Not` and `IsPrime`. The inputs are `n`
 * and `m` (declared `integer`) and `k0`; the literals are small integers,
 * powers of 2 past `2^53` and `2^64` (folded exactly), and constants whose
 * value is a pole (`Factorial(-1)`, `Mod(5, 0)`).
 *
 * Each program is compiled with `profile: 'numeric-kernel', mode: 'bigint'`
 * and with the existing compiler (`mode: 'bigint', cse: false,
 * constantFold: false`), and run on a grid of inputs: each integer given as
 * a `bigint` (past `2^53` and past `2^64`, negative, zero) and, for some
 * points, as a `number` (the entry converts it). The outcome of a run is a
 * `bigint`, a `boolean`, a `number` (a pole: `NaN` or `Infinity`) or the
 * class of a thrown error. A difference is:
 *
 * - a `bigint` or a `boolean` that is not the same (`===`) on both, or on
 *   one side only;
 * - a thrown error of another class, or on one side only.
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
export const BIGINT_DECLARATIONS = 'n: integer, m: integer, k0: integer<0..>';

function makeBigintEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  ce.declare('k0', 'integer<0..>');
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

function genLeaf(rng: Rng): BigintJson {
  return choose<BigintJson | 'literal'>(rng, [
    ['n', 4],
    ['m', 3],
    ['k0', 2],
    ['literal', 3],
  ]) === 'literal'
    ? choose(rng, LITERALS)
    : (pick(rng, ['n', 'n', 'm', 'k0']) as string);
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
  | 'Which';

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

/** A program: an integer, or a boolean one time in six. */
export function generateBigintProgram(rng: Rng, depth: number): BigintJson {
  return rng() < 1 / 6 ? genCondition(rng, depth) : genInteger(rng, depth);
}

function nodeCount(json: BigintJson): number {
  return Array.isArray(json)
    ? 1 + json.slice(1).reduce<number>((s, x) => s + nodeCount(x), 0)
    : 1;
}

//
// Runs
//

type Inputs = Record<string, bigint | number>;

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

/** The inputs of the grid: every pair of `INTEGERS` for `n` and `m`, with
 *  `k0` from its non-negative values; one point in four gives its integers
 *  as `number` values where they are safe integers. */
function gridOf(rng: Rng, points: number): Inputs[] {
  const nonNegative = INTEGERS.filter((v) => v >= 0n);
  const all: Inputs[] = [];
  for (const n of INTEGERS)
    for (const m of INTEGERS) {
      const k0 = nonNegative[(all.length * 7) % nonNegative.length];
      all.push({ n, m, k0 });
    }
  // Sample `points` of them, then give some as numbers.
  const sampled =
    all.length <= points
      ? all
      : Array.from({ length: points }, () => pick(rng, all));
  // The entry check of the mode admits a `number` that is a safe integer.
  const asNumber = (v: bigint | number): bigint | number =>
    typeof v === 'bigint' && Number.isSafeInteger(Number(v)) ? Number(v) : v;
  return sampled.map((p, i) =>
    i % 4 === 3
      ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, asNumber(v)]))
      : p
  );
}

type Outcome =
  | { readonly kind: 'bigint' | 'boolean' | 'number'; readonly value: unknown }
  | { readonly kind: 'throw'; readonly error: string };

function runOutcome(run: (inputs: Inputs) => unknown, inputs: Inputs): Outcome {
  try {
    const value = run(inputs);
    const kind = typeof value;
    if (kind === 'bigint' || kind === 'boolean' || kind === 'number')
      return { kind, value };
    return { kind: 'throw', error: `a value of the type ${kind}` };
  } catch (e) {
    return {
      kind: 'throw',
      error: (e as { constructor?: { name?: string } })?.constructor?.name ?? 'Error',
    };
  }
}

/** `different` for a difference of the contract, `number` for two numbers
 *  that are not the same, `same` otherwise. */
function compareOutcomes(a: Outcome, b: Outcome): 'same' | 'number' | 'different' {
  if (a.kind === 'throw' || b.kind === 'throw')
    return a.kind === b.kind && a.error === b.error ? 'same' : 'different';
  if (a.kind !== b.kind) return 'different';
  if (a.kind === 'number')
    return Object.is(a.value, b.value) ? 'same' : 'number';
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
    const run = result.run as unknown as (i: Inputs) => unknown;
    if (!result.success || typeof run !== 'function')
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

/** The exact value of `expr` at `inputs` by the interpreter: a `bigint`, a
 *  `boolean`, or `undefined` when it has no such value. */
function interpret(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): bigint | boolean | undefined {
  try {
    const subs = Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, ce.number(BigInt(v))])
    );
    const value = expr.subs(subs).evaluate();
    if (isSymbol(value, 'True')) return true;
    if (isSymbol(value, 'False')) return false;
    if (!isNumber(value)) return undefined;
    const r = exactRational(value);
    return r !== undefined && r.q === 1n ? r.p : undefined;
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
    const subs = Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, ce.number(BigInt(v))])
    );
    return expr.subs(subs).evaluate().toString().slice(0, 200);
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
  readonly interpreter?: bigint | boolean;
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
  readonly interpreter?: bigint | boolean;
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
      const grid = gridOf(rng, options.points);
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
          (a.kind === 'bigint' || a.kind === 'boolean') &&
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
            if (exact !== a.value)
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
  return o.kind === 'bigint' ? `${String(o.value)}n` : String(o.value);
}

const formatInputs = (inputs: Inputs | undefined): string =>
  inputs === undefined
    ? ''
    : Object.entries(inputs)
        .map(([k, v]) => `${k} = ${typeof v === 'bigint' ? `${v}n` : String(v)}`)
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
        lines.push(`  interpreter:    ${typeof f.interpreter === 'bigint' ? `${f.interpreter}n` : String(f.interpreter)}`);
      if (f.message !== undefined) lines.push(`  message:   ${f.message.slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}
