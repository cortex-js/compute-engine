/**
 * The oracle of the slice compiler tests: the interpreter's value of a
 * program at an input point, and the comparison of a compiled value with
 * it, within the caveats of compiled code (docs/COMPILATION-MODEL.md,
 * "Caveats of compiled code").
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import {
  compileSlice,
  type Extension,
} from '../../src/compute-engine/compilation/ir';

type Json = unknown;

export type Value = number | boolean | Value[];
export type Point = Record<string, number | boolean | number[] | number[][]>;

/** The interpreter's value: a number, a boolean, a list, or a tag for a
 *  value that is not a real number. */
export type Expected =
  number | boolean | Expected[] | 'complex' | 'complex-infinity' | 'none';

/** An engine with the inputs of the tests declared: `x`, `y` real; `n`,
 *  `m` integer; `L`, `M` lists of three reals; `I` a list of three
 *  integers; `D`, `E` lists of reals and `J` a list of integers, of
 *  run-time lengths; `Q` a list of pairs of reals, of run-time length;
 *  `p` a boolean. `h` has a value (2.5) and `a` the type
 *  `any`: both decline. The user functions: `f(a, b) = ab + 1` declared
 *  `(real, real) -> real`; `g(a) = 2a` not declared; `fact` (declared
 *  `(integer) -> integer`, recursive); `h2(a) = g(a) + f(a, a)`, which
 *  calls the others; and two that decline: `cap(a) = a + x` (a capture)
 *  and `rec2`, recursive with no result type. `rnd(a) = a·Random()`
 *  draws; `ev` and `od` (declared `(integer) -> integer`) call each
 *  other. */
export function makeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  ce.declare('L', 'list<real^3>');
  ce.declare('M', 'vector<real^3>');
  ce.declare('I', 'list<integer^3>');
  ce.declare('D', 'list<real>');
  ce.declare('E', 'list<real>');
  ce.declare('J', 'list<integer>');
  ce.declare('Q', 'list<list<real^2>>');
  ce.declare('p', 'boolean');
  ce.assign('h', 2.5);
  ce.declare('a', 'any');
  const fn = (json: unknown) => ce.box(json as never);
  ce.declare('f', '(real, real) -> real');
  ce.assign(
    'f',
    fn(['Function', ['Add', ['Multiply', 'a', 'b'], 1], 'a', 'b'])
  );
  ce.assign('g', fn(['Function', ['Multiply', 'a', 2], 'a']));
  ce.declare('fact', '(integer) -> integer');
  ce.assign(
    'fact',
    fn([
      'Function',
      [
        'If',
        ['LessEqual', 'k', 0],
        1,
        ['Multiply', 'k', ['fact', ['Subtract', 'k', 1]]],
      ],
      'k',
    ])
  );
  ce.assign('h2', fn(['Function', ['Add', ['g', 'a'], ['f', 'a', 'a']], 'a']));
  ce.declare('rnd', '(real) -> real');
  ce.assign('rnd', fn(['Function', ['Multiply', 'a', ['Random']], 'a']));
  ce.declare('ev', '(integer) -> integer');
  ce.declare('od', '(integer) -> integer');
  ce.assign(
    'ev',
    fn([
      'Function',
      ['If', ['LessEqual', 'k', 0], 1, ['od', ['Subtract', 'k', 1]]],
      'k',
    ])
  );
  ce.assign(
    'od',
    fn([
      'Function',
      ['If', ['LessEqual', 'k', 0], 0, ['ev', ['Subtract', 'k', 1]]],
      'k',
    ])
  );
  ce.assign('cap', fn(['Function', ['Add', 'a', 'x'], 'a']));
  ce.assign(
    'rec2',
    fn([
      'Function',
      [
        'If',
        ['LessEqual', 'k', 0],
        0.5,
        ['Multiply', 'k', ['rec2', ['Subtract', 'k', 1]]],
      ],
      'k',
    ])
  );
  return ce;
}

/** An engine of `makeEngine()` that computes with doubles: its values of a
 *  program with draws are the bits of the compiled code (the default
 *  engine adds a draw to a decimal). */
export function makeMachineEngine(): ComputeEngine {
  const ce = makeEngine();
  ce.precision = 'machine';
  return ce;
}

function boxValue(ce: ComputeEngine, v: Point[string]): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (Array.isArray(v))
    return ce.function(
      'List',
      (v as Point[string][]).map((x) => boxValue(ce, x))
    );
  return ce.number(v);
}

function read(e: Expression): Expected {
  if (isNumber(e)) {
    if (e.im !== 0)
      return Number.isFinite(e.im) ? 'complex' : 'complex-infinity';
    return e.re;
  }
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isSymbol(e, 'ComplexInfinity')) return 'complex-infinity';
  if (isSymbol(e, 'NaN')) return NaN;
  if (isSymbol(e, 'PositiveInfinity')) return Infinity;
  if (isSymbol(e, 'NegativeInfinity')) return -Infinity;
  if (isFunction(e, 'List')) return e.ops.map(read);
  // A lazy list (`Map`, `Filter`, `Range`): its elements.
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  if (isFunction(e, 'Complex')) return 'complex';
  return 'none';
}

/** The interpreter's value at `point`, evaluated as compiled: the
 *  expression itself, with the inputs assigned for the evaluation
 *  (`ce.withValues()`). An exception of the engine (a NaN for a `real`
 *  input is not a value of its type), or an error that it logs, gives
 *  `engine-error`: no value to compare with. */
/** The message of the last `engine-error` of `interpret()`. */
export let lastEngineError = '';

export function interpret(
  ce: ComputeEngine,
  expr: Expression,
  point: Point
): Expected | 'engine-error' {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, boxValue(ce, v)])
  );
  const log = console.error;
  let logged = false;
  console.error = (...args: unknown[]) => {
    logged = true;
    lastEngineError = args.map(String).join(' ').slice(0, 200);
  };
  try {
    const value = ce.withValues(values, () => read(expr.evaluate().N()));
    return logged ? 'engine-error' : value;
  } catch (e) {
    lastEngineError = String(e).slice(0, 200);
    return 'engine-error';
  } finally {
    console.error = log;
  }
}

export const TOLERANCE = 1e-12;

/**
 * Whether the compiled value `v` agrees with the interpreter's `expected`:
 *
 * - no number in the interpreter (an error, `Missing`, an unevaluated
 *   form): a caveat value only, NaN, 0, an infinity or `undefined` (a
 *   throw is handled by the caller);
 * - a complex value: NaN (the real lane of the `strict` mode);
 * - `ComplexInfinity` (a pole): an infinity or NaN;
 * - a number: the same NaN, the same infinity, or within `TOLERANCE`
 *   relative, with an absolute floor of `TOLERANCE` for a value that
 *   cancels to near 0 (the precision of the target);
 * - a boolean: the same boolean;
 * - a list: the same length, and each element by these rules.
 */
export function agrees(
  v: unknown,
  expected: Expected | 'engine-error'
): boolean {
  if (expected === 'engine-error') throw new Error('the interpreter failed');
  if (expected === 'none')
    return (
      v === undefined ||
      (typeof v === 'number' &&
        (Number.isNaN(v) || v === 0 || !Number.isFinite(v)))
    );
  if (expected === 'complex') return Number.isNaN(v);
  if (expected === 'complex-infinity')
    return typeof v === 'number' && !Number.isFinite(v);
  if (Array.isArray(expected))
    return (
      Array.isArray(v) &&
      v.length === expected.length &&
      expected.every((e, i) => agrees(v[i], e))
    );
  if (typeof expected === 'boolean') return v === expected;
  if (typeof v !== 'number') return false;
  if (Number.isNaN(expected) || Number.isNaN(v))
    return Number.isNaN(expected) && Number.isNaN(v);
  if (!Number.isFinite(expected) || !Number.isFinite(v)) return v === expected;
  return (
    Math.abs(v - expected) <=
    TOLERANCE * Math.max(1, Math.abs(v), Math.abs(expected))
  );
}

/** Whether two compiled values have the same bits (`Object.is` on each
 *  number: NaN equals NaN, -0 differs from 0). */
export function sameBits(a: unknown, b: unknown): boolean {
  if (Array.isArray(a))
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameBits(x, b[i]))
    );
  return Object.is(a, b);
}

/** The compiled value of `expr` at `point`, with or without the passes. */
export function runSlice(
  expr: Expression,
  point: Point,
  passes: boolean,
  extend?: Extension
): unknown {
  return compileSlice(expr, {
    target: 'javascript',
    passes: passes ? undefined : false,
    extend,
  }).run(point);
}

/** Program text has a loop. */
export function hasLoop(json: unknown): boolean {
  return /"(Sum|Product|Range|fact|ev)"/.test(JSON.stringify(json));
}

/** The free inputs of a program, by name. */
export function inputsOf(expr: Expression): string[] {
  return [...expr.unknowns].filter((s) =>
    ['x', 'y', 'n', 'm', 'L', 'M', 'I', 'D', 'E', 'J', 'Q', 'p'].includes(s)
  );
}

/** Input points: ordinary values, a zero, a negative, a value past 1. */
export const POINTS: Point[] = [
  {
    x: 0.5,
    y: 2,
    n: 3,
    m: 2,
    L: [1.5, -2, 3],
    M: [0.25, 4, -0.75],
    I: [3, -4, 7],
    D: [1.5, -2, 3, 0.25],
    E: [2, 0.5],
    J: [4, -5, 6],
    p: true,
  },
  {
    x: -1.25,
    y: 0.75,
    n: 0,
    m: -3,
    L: [0, 2.5, -1],
    M: [1, 1, 1],
    I: [0, 1, -1],
    D: [],
    E: [],
    J: [],
    p: false,
  },
  {
    x: 2,
    y: -3.5,
    n: 5,
    m: 4,
    L: [-0.5, 0.125, 10],
    M: [2, -2, 0.5],
    I: [10, 2, -9],
    D: [-0.5],
    E: [3, -1, 0.75],
    J: [7],
    p: true,
  },
  {
    x: 0,
    y: 0,
    n: -2,
    m: 7,
    L: [7, -7, 0],
    M: [-1, 0, 3],
    I: [-5, 5, 0],
    D: [7, -7, 0, 2.5, -3.25, 1],
    E: [0],
    J: [-5, 5, 0, 12, 3],
    p: false,
  },
  {
    x: 3.7,
    y: 1,
    n: 1,
    m: 1,
    L: [0.3, 0.6, 0.9],
    M: [3, 2, 1],
    I: [1, 1, 1],
    D: [0.3, 0.6],
    E: [0.3, 0.6],
    J: [1, 1],
    p: true,
  },
];

/** Edge points: NaN, -0, large magnitudes, 2^53 - 1. The second one has
 *  `n` = 2^53 - 1, so it is for programs with no loop. */
export const EDGE_POINTS: Point[] = [
  {
    x: NaN,
    y: -0,
    n: 3,
    m: -1,
    L: [NaN, -0, 1],
    M: [0, -0, 2],
    I: [0, -1, 9007199254740991],
    D: [NaN, -0, 1],
    E: [-0],
    J: [0, -1, 9007199254740991],
    p: true,
  },
  {
    x: 1e300,
    y: -1e-300,
    n: 9007199254740991,
    m: 2,
    L: [1e300, -1e300, 5e-324],
    M: [3, 2, 1],
    I: [9007199254740991, -9007199254740991, 2],
    D: [1e300, -1e300, 5e-324],
    E: [1e300],
    J: [9007199254740991, -9007199254740991, 2],
    p: false,
  },
];

/** The points restricted to the inputs that `expr` reads. */
// The values of `Q`: pairs, an empty list, and a NaN at the edge.
const Q_VALUES = [
  [
    [1, 2],
    [-3, 0.5],
  ],
  [],
  [[0.25, -1]],
  [
    [2, 2],
    [0, -0],
    [5, -5],
  ],
  [[3, 1]],
  [[NaN, -0]],
  [[1e300, -1e300]],
];
[...POINTS, ...EDGE_POINTS].forEach((p, i) => (p.Q = Q_VALUES[i]));

export function pointsFor(expr: Expression, points = POINTS): Point[] {
  const names = inputsOf(expr);
  return points.map((p) => Object.fromEntries(names.map((k) => [k, p[k]])));
}

/** The hand-chosen programs: each row of the operator table and each
 *  construct. */
// prettier-ignore
export const PROGRAMS: Json[] = [
  // Add, Subtract, Negate, Multiply, Divide
  ['Add', 'x', 'y'], ['Add', 'x', 'y', 1], ['Add', 'n', 'm'], ['Add', 'n', 0.5],
  ['Subtract', 'x', 'y'], ['Subtract', 'n', 5], ['Subtract', 1, 'x'],
  ['Negate', 'x'], ['Negate', 'n'], ['Negate', ['Add', 'x', 'n']],
  ['Multiply', 'x', 'y'], ['Multiply', 'n', 'm', 2], ['Multiply', 'x', 'x'], ['Multiply', 0.1, 'n'],
  ['Divide', 'x', 'y'], ['Divide', 'n', 'm'], ['Divide', 1, 'x'], ['Divide', 'x', 3],
  ['Divide', ['Add', 'x', 1], ['Subtract', 'y', 2]],
  // Power
  ['Power', 'x', 2], ['Power', 'x', 3], ['Power', 'n', 3], ['Power', 'x', 5], ['Power', 'n', 2],
  ['Power', 'x', 'y'], ['Power', 2, 'x'], ['Power', 'x', -2], ['Power', 'x', 0.5], ['Power', 'x', 1.5],
  ['Power', ['Add', 'x', 1], 4], ['Power', 'y', 'n'], ['Power', 'm', 'n'],
  // Sqrt, Abs, Exp, Ln
  ['Sqrt', 'x'], ['Sqrt', ['Add', ['Power', 'x', 2], 1]], ['Sqrt', 'n'],
  ['Abs', 'x'], ['Abs', 'n'], ['Abs', ['Subtract', 'x', 'y']],
  ['Exp', 'x'], ['Exp', ['Negate', 'x']], ['Exp', ['Multiply', 2, 'y']],
  ['Ln', 'x'], ['Ln', ['Add', ['Abs', 'x'], 1]], ['Ln', 'n'],
  // Sin, Cos, Tan, constants
  ['Sin', 'x'], ['Cos', 'x'], ['Tan', 'x'], ['Sin', ['Multiply', 'Pi', 'x']],
  ['Cos', ['Add', 'x', 'y']], ['Tan', ['Divide', 'x', 2]], ['Add', 'ExponentialE', 'x'],
  ['Multiply', 2, 'Pi', 'y'], ['Power', 'ExponentialE', ['Negate', ['Power', 'x', 2]]],
  // Floor, Ceil, Round
  ['Floor', 'x'], ['Ceil', 'x'], ['Round', 'x'], ['Round', ['Multiply', 'x', 2]],
  ['Floor', ['Divide', 'n', 2]], ['Ceil', ['Divide', 'm', 3]], ['Round', ['Divide', 'n', 2]],
  ['Floor', ['Multiply', 'y', 1.5]], ['Round', ['Add', 'y', 0.5]],
  // Mod
  ['Mod', 'n', 3], ['Mod', 'n', -3], ['Mod', 'x', 0.75], ['Mod', 'n', 'm'], ['Mod', ['Negate', 'n'], 4],
  ['Mod', 'y', 2], ['Mod', 'x', 'y'],
  // Max, Min
  ['Max', 'x', 'y'], ['Max', 'x', 'y', 'n'], ['Max', 'n', 'm'], ['Min', 'x', 'y'], ['Min', 'x', 0, 'n'],
  ['Min', 'n', 'm', -1],
  // Comparisons
  ['Less', 'x', 'y'], ['LessEqual', 'x', 'y'], ['Greater', 'x', 'y'], ['GreaterEqual', 'x', 'y'],
  ['Less', 'n', 'm'], ['Equal', 'n', 'm'], ['Equal', 'n', 3], ['NotEqual', 'n', 'm'], ['NotEqual', 'x', 'y'],
  ['Equal', 'x', 'y'], ['LessEqual', 'n', 0], ['GreaterEqual', 'm', 'n'],
  ['Less', 'x', 'y', 3], ['LessEqual', 0, 'x', 1], ['Less', 'n', 'm', 10],
  // And, Or, Not
  ['And', ['Less', 'x', 1], ['Greater', 'y', 0]], ['Or', ['Less', 'x', 0], ['Equal', 'n', 3]],
  ['Not', ['Less', 'x', 'y']], ['And', 'p', ['Less', 'n', 2]], ['Or', 'p', ['Not', 'p']],
  ['And', ['Less', 'x', 1], ['Less', 'y', 1], ['Less', 'n', 1]], ['Not', 'p'],
  // If, Which
  ['If', ['Greater', 'x', 0], ['Ln', 'x'], 0],
  ['If', ['NotEqual', 'x', 0], ['Divide', 1, 'x'], 0],
  ['If', ['GreaterEqual', 'x', 0], ['Sqrt', 'x'], ['Negate', 'x']],
  ['If', ['Less', 'n', 2], 'n', ['Multiply', 'n', 'x']],
  ['If', 'p', 'x', 'y'],
  ['If', ['Less', 'x', 0], 1],
  ['If', ['Less', 'x', 'y'], ['Less', 'n', 'm'], ['Equal', 'n', 'm']],
  ['Which', ['Less', 'x', 0], 1, ['Less', 'x', 1], 2, 'True', 3],
  ['Which', ['Less', 'x', 0], ['Negate', 'x'], ['Less', 'x', 1], ['Power', 'x', 2]],
  ['Which', ['Equal', 'n', 0], 'y', ['Equal', 'n', 1], ['Multiply', 2, 'y'], 'True', ['Sqrt', 'y']],
  ['Add', 1, ['If', ['Greater', 'y', 0], ['Ln', 'y'], ['Ln', ['Negate', 'y']]]],
  ['If', ['Greater', 'x', 0], ['If', ['Greater', 'y', 0], 1, 2], ['If', ['Greater', 'y', 0], 3, 4]],
  // Sum, Product
  ['Sum', 'k', ['Limits', 'k', 1, 10]],
  ['Sum', 'k', ['Limits', 'k', 5, 1]],
  ['Product', 'k', ['Limits', 'k', 5, 1]],
  ['Sum', 'k', ['Limits', 'k', 1, 'n']],
  ['Product', 'k', ['Limits', 'k', 1, 'n']],
  ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']],
  ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 20]],
  ['Sum', ['Power', 'k', 2], ['Limits', 'k', 'm', 'n']],
  ['Product', ['Add', 'k', 'x'], ['Limits', 'k', 1, 4]],
  ['Sum', ['Sum', ['Multiply', 'i', 'j'], ['Limits', 'j', 1, 'i']], ['Limits', 'i', 1, 'n']],
  ['Sum', ['Product', ['Add', 'j', 1], ['Limits', 'j', 1, 'i']], ['Limits', 'i', 0, 4]],
  ['Sum', ['If', ['Equal', ['Mod', 'k', 2], 0], 'k', 0], ['Limits', 'k', 1, 10]],
  ['Sum', ['Sin', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 8]],
  ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 0, 6]],
  ['Sum', 'k', ['Limits', 'k', 'n', 'm']],
  ['Sum', ['Multiply', 'k', 'k', 'k'], ['Limits', 'k', 1, 1000]],
  ['Product', ['Divide', 'k', ['Add', 'k', 1]], ['Limits', 'k', 1, 'n']],
  // Block, Declare, Assign
  ['Block', ['Declare', 't', 'real', 0], ['Assign', 't', ['Add', 't', 'x']], 't'],
  ['Block', ['Declare', 't', 'real', 0], ['If', ['Less', 0, 'x'], ['Assign', 't', 'x'], ['Assign', 't', ['Negate', 'x']]], 't'],
  ['Block', ['Declare', 't', 'real', 1], ['If', ['Less', 0, 'x'], ['Assign', 't', ['Multiply', 2, 'x']]], 't'],
  ['Block', ['Declare', 't', 'real', 0], ['Declare', 'u', 'real', 'y'],
    ['If', ['Less', 'x', 0], ['Assign', 't', 1], ['Assign', 'u', 5]], ['Add', 't', 'u']],
  ['Block', ['Declare', 't', 'integer', 'n'], ['Assign', 't', ['Multiply', 't', 't']], ['Assign', 't', ['Add', 't', 1]], 't'],
  ['Block', ['Declare', 'a', 'real', 'x'], ['Declare', 'b', 'real', ['Multiply', 'a', 2]], ['Add', 'a', 'b']],
  ['Block', ['Declare', 't', 'real', 0],
    ['If', ['Less', 'x', 0], ['Block', ['Assign', 't', 1], ['If', ['Less', 'y', 0], ['Assign', 't', 2]]]], 't'],
  ['Block', ['Declare', 's', 'real', 0], ['Assign', 's', ['Sum', ['Multiply', 'k', 'y'], ['Limits', 'k', 1, 3]]], ['Multiply', 's', 2]],
  ['Sum', ['Block', ['Declare', 'q', 'real', ['Multiply', 'k', 'x']], ['Multiply', 'q', 'q']], ['Limits', 'k', 1, 5]],
  ['Block', ['Declare', 'f', 'boolean', ['Less', 'x', 0]], ['If', 'f', 1, 2]],
  ['Block', ['Declare', 't', 'real', 'x'],
    ['If', ['Less', 'x', 1], ['Assign', 't', ['Add', 't', 1]], ['Assign', 't', ['Subtract', 't', 1]]],
    ['If', ['Less', 't', 1], ['Assign', 't', ['Multiply', 't', 10]]], 't'],
  // A declared type as a string, `unknown` or absent (the lane of the
  // value), a value in the attributes
  ['Block', ['Declare', 't', "'real'", 0], ['Assign', 't', ['Add', 't', 'x']], 't'],
  ['Block', ['Declare', 't', { dict: { value: 0 } }], ['Assign', 't', ['Add', 't', 'n']], ['Mod', 't', 4]],
  ['Block', ['Declare', 't', "'unknown'", ['Multiply', 'x', 2]], ['Add', 't', 1]],
  ['Block', ['Declare', 't', "'real'", { dict: { value: 2 } }], ['Multiply', 't', 'x']],
  ['Block', ['Declare', 't', ['Dictionary', ['KeyValuePair', "'value'", ['Less', 'x', 0]]]], ['If', 't', 1, 2]],
  // Lists
  ['List', 'x', 'y', 1], ['Add', 'L', 1], ['Add', 'L', 'M'], ['Multiply', 2, 'L'], ['Sin', 'L'],
  ['Negate', 'L'], ['Floor', 'L'], ['Mod', 'I', 3], ['Power', 'L', 2], ['Less', 'L', 0],
  ['At', 'L', 1], ['At', 'L', -1], ['At', ['Add', 'L', 'M'], 2], ['If', ['Less', 'x', 0], 'L', 'M'],
  ['Add', 'L', ['List', 1, 2, 3]], ['Divide', 'L', 'x'], ['Sqrt', ['Abs', 'L']], ['Multiply', 'L', 'M'],
  ['Add', 'I', 'n'], ['Subtract', 'L', 'x'], ['Exp', ['Negate', 'L']], ['At', ['Multiply', 'I', 'I'], 3],
  ['Add', ['At', 'L', 1], ['At', 'M', 2], ['At', 'I', 3]], ['Round', ['Multiply', 'L', 2.5]],
  ['List', ['Less', 'x', 0], 'p', ['Equal', 'n', 3]], ['Divide', ['List', 1, 2, 3], 'L'],
  // Lists of run-time length
  ['Add', 'D', 1], ['Multiply', 'D', 'x'], ['Sin', 'D'], ['Add', 'D', 'D'], ['Mod', 'J', 3], ['Add', 'J', 'n'],
  ['Length', 'D'], ['Length', 'J'], ['Length', 'L'], ['At', 'D', 1], ['At', 'D', -1], ['At', 'D', 'n'], ['At', 'J', 'm'],
  ['At', 'L', 'n'], ['At', 'D', 'x'], ['At', 'D', ['Add', 'n', 'm']],
  ['Range', 1, 'n'], ['Range', 'n', 'm'], ['Range', 'm', 10, 'n'], ['Range', 1, 'n', 2], ['Range', 'n', 1, -2],
  ['Map', ['Function', ['Multiply', 'z', 2], 'z'], 'D'], ['Map', ['Function', ['Add', 'z', 'x'], 'z'], 'L'],
  ['Map', ['Function', ['Power', 'z', 2], 'z'], 'J'], ['Map', ['Function', ['Less', 'z', 0], 'z'], 'D'],
  ['Map', ['Function', ['Multiply', 'z', 'z'], 'z'], ['Range', 1, 'n']],
  ['Add', 'D', ['Map', ['Function', ['Sin', 'z'], 'z'], 'D']],
  ['Filter', 'D', ['Function', ['Greater', 'z', 0], 'z']], ['Filter', 'J', ['Function', ['Equal', ['Mod', 'z', 2], 0], 'z']],
  ['Filter', ['Range', 'm', 'n'], ['Function', ['Less', 'z', 2], 'z']], ['Filter', 'L', ['Function', ['Less', 'z', 'x'], 'z']],
  ['Sum', 'D'], ['Sum', 'J'], ['Sum', 'L'], ['Product', 'D'], ['Product', 'J'], ['Max', 'D'], ['Min', 'J'],
  ['Max', 'D', 'x'], ['Min', 'D', 0, 'n'], ['Max', 'L'], ['Max', 'L', 'D'],
  ['Sum', ['Map', ['Function', ['Power', 'z', 2], 'z'], 'D']], ['Product', ['Filter', 'D', ['Function', ['Greater', 'z', 0], 'z']]],
  ['Sum', ['Range', 1, 'n']], ['Max', ['Filter', 'J', ['Function', ['Greater', 'z', 100], 'z']]],
  ['Length', ['Filter', 'D', ['Function', ['Less', 'z', 'x'], 'z']]],
  ['Sum', ['Map', ['Function', ['Sum', ['Multiply', 'k', 'z'], ['Limits', 'k', 1, 3]], 'z'], 'D']],
  ['If', ['Less', 'x', 0], 'D', ['Map', ['Function', ['Negate', 'z'], 'z'], 'D']],
  // The real functions (`REAL_FUNCTIONS` and the rows spelled with `Math`)
  ['Root', 'x', 3], ['Root', 'y', 'm'], ['Root', 'x', 2.5], ['Erf', 'x'], ['Erfc', ['Multiply', 3, 'x']],
  ['Arctan', 'x'], ['Arctan2', 'y', 'x'], ['Arcsin', ['Divide', 'x', 4]], ['Arccos', 'x'], ['Arccot', 'x'],
  ['Arcsec', 'y'], ['Arccsc', 'y'], ['Haversine', 'x'], ['Coth', 'y'], ['Arsinh', 'x'], ['Arcosh', 'y'],
  ['Artanh', ['Divide', 'x', 4]], ['Arcoth', 'y'], ['Arsech', 'x'], ['Arcsch', 'y'], ['Gamma', 'x'],
  ['Gamma', 'n'], ['GammaLn', 'y'], ['Factorial', 'n'], ['Factorial', 'x'], ['Factorial2', 'n'],
  ['Zeta', 'y'], ['Sign', 'x'], ['Truncate', 'x'], ['Fract', 'x'], ['Log', 'x'], ['Hypot', 'x', 'y'],
  ['Add', ['Truncate', ['Multiply', 'x', 7]], 'n'], ['Mod', ['Truncate', ['Multiply', 'x', 7]], 3],
  ['Multiply', ['Sign', 'y'], 'n'], ['Erf', 'L'], ['Gamma', 'D'], ['Arctan2', 'L', 'M'],
  // User functions
  ['f', 'x', 2], ['f', 'n', 'y'], ['g', 'x'], ['g', 'n'], ['h2', 'x'], ['Add', ['g', 'x'], ['g', 'y']],
  ['fact', ['Mod', 'n', 7]], ['fact', 0], ['Sum', ['g', 'k'], ['Limits', 'k', 1, 'n']],
  ['Map', ['Function', ['f', 'z', 'z'], 'z'], 'D'], ['If', ['Less', ['g', 'x'], 1], ['f', 'x', 'y'], 0],
];

/**
 * Programs that must decline, one per decline path of the lowering that the
 * engine of `makeEngine()` can reach, each a number. The generator adds
 * them to random programs (as a statement, a value is not computed when it
 * is closed: `Block(Complex(1, 2), Pi)` is `Pi`).
 */
// prettier-ignore
export const DECLINES: Record<string, Json> = {
  'not in the slice': ['Integrate', 'x', 'x'],
  'complex number': ['Complex', 1, 2],
  'bound that is not an integer': ['Sum', 'k', ['Limits', 'k', 1, 'x']],
  'different lengths': ['Add', 'L', ['List', 1, 2]],
  'one length by construction': ['Add', 'D', 'E'],
  'a capture': ['cap', 1],
  'declared result type': ['rec2', 'n'],
  'list argument': ['g', 'D'],
  'Range of reals': ['Range', 'x', 5],
  'of a list of booleans': ['If', ['At', ['Map', ['Function', ['Less', 'z', 0], 'z'], 'D'], 'n'], 1, 2],
  'not a literal': ['Map', 'g', 'D'],
  'in a loop': ['Block', ['Declare', 't', 'real', 0], ['Sum', ['Block', ['Assign', 't', 'k'], 'k'], ['Limits', 'k', 1, 3]], 't'],
  'symbol with a value': ['Add', 'h', 1],
  'Sinh': ['Sinh', 'x'],
  'Equal of a list': ['If', ['Equal', 'L', 'M'], 1, 2],
  'canonical form': ['Add', 'p', 1],
  'two types': ['If', ['Less', 'x', 0], 'L', 1],
  'not integer': ['Block', ['Declare', 't', 'integer', 0], ['Assign', 't', 'x'], 't'],
  'of type any': ['Add', 'a', 1],
};

/** A seeded generator of random programs, as MathJSON: in-scope programs,
 *  and about one in twenty that embeds a program of `DECLINES` (`decline`
 *  names it). A draw (`Random()`, `rnd`) is only in a `WithRandomSeed`
 *  frame, where the interpreter's values are a function of the seed; a
 *  frame can have several draw sites, in a function body too. */
export function generator(
  seed: number
): () => { json: Json; decline?: string } {
  let s = seed >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];
  let locals = 0;
  // The depth of `WithRandomSeed` frames around the node being made.
  let framed = 0;

  const UNARY = [
    'Negate',
    'Abs',
    'Sin',
    'Cos',
    'Tan',
    'Exp',
    'Ln',
    'Sqrt',
    'Floor',
    'Ceil',
    'Round',
  ];
  const BINARY = [
    'Add',
    'Subtract',
    'Multiply',
    'Divide',
    'Mod',
    'Max',
    'Min',
    'Power',
  ];
  const COMPARE = [
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
    'Equal',
    'NotEqual',
  ];

  const integer = (d: number): Json => {
    const r = random();
    if (d <= 0 || r < 0.35) return pick(['n', 'm', 0, 1, 2, 3, -1, 7]);
    if (r < 0.55)
      return [
        pick(['Add', 'Subtract', 'Multiply', 'Max', 'Min']),
        integer(d - 1),
        integer(d - 1),
      ];
    if (r < 0.65) return ['Mod', integer(d - 1), pick([2, 3, -4, 'm'])];
    if (r < 0.75) return [pick(['Floor', 'Ceil', 'Round']), real(d - 1)];
    if (r < 0.8) return ['Power', integer(d - 1), pick([0, 1, 2, 3])];
    if (r < 0.85) return ['At', 'I', pick([1, 2, 3, -1])];
    if (r < 0.88) return ['Length', dlist(d - 1)];
    if (r < 0.895) return ['fact', ['Mod', integer(d - 1), 7]];
    if (r < 0.91) return ['ev', ['Mod', integer(d - 1), 9]];
    if (r < 0.94)
      return [
        pick(['Sum', 'Max', 'Min']),
        pick(['J', ['Range', bound(), bound()]]),
      ];
    return ['If', boolean(d - 1), integer(d - 1), integer(d - 1)];
  };

  /** A bound of a `Range`: a small integer (an input `n` of 2^53 would
   *  make a list that neither side can hold). */
  const bound = (): Json =>
    pick(['m', 0, 1, 3, -2, ['Mod', 'n', 9], ['Add', 'm', 2]]);

  /** A function literal of one parameter whose body `body` makes from
   *  the names it can read. */
  const fn = (body: (names: string[]) => Json, names: string[]): Json => {
    const z = `z${locals++}`;
    return ['Function', body([...names, z]), z];
  };

  /** A list of run-time length. */
  const dlist = (d: number, names: string[] = []): Json => {
    const r = random();
    if (d <= 0 || r < 0.25) return pick(['D', 'J', 'D']);
    if (r < 0.4)
      return ['Map', fn((ns) => real(d - 1, ns), names), dlist(d - 1, names)];
    if (r < 0.52)
      return [
        'Filter',
        dlist(d - 1, names),
        fn((ns) => boolean(d - 1, ns), names),
      ];
    if (r < 0.62)
      return random() < 0.5
        ? ['Range', bound(), bound()]
        : ['Range', bound(), bound(), pick([1, 2, -1, 3, 'm'])];
    if (r < 0.75)
      return [
        pick(['Add', 'Subtract', 'Multiply', 'Divide']),
        dlist(d - 1, names),
        real(d - 1, names),
      ];
    if (r < 0.85)
      return [
        pick(['Sin', 'Exp', 'Negate', 'Abs', 'Floor']),
        dlist(d - 1, names),
      ];
    // Two lists of one length by construction.
    const base = pick(['D', 'J']);
    return ['Add', base, ['Map', fn((ns) => real(d - 1, ns), names), base]];
  };

  const real = (d: number, names: string[] = []): Json => {
    const r = random();
    if (d <= 0 || r < 0.2)
      return pick([
        'x',
        'y',
        'n',
        0.5,
        -1.25,
        2,
        'Pi',
        'ExponentialE',
        ...names,
        ...(framed > 0 ? [['Random'], ['Random'], ['rnd', 'x']] : []),
      ]);
    if (r < 0.35) return [pick(UNARY), real(d - 1, names)];
    if (r < 0.6) {
      const op = pick(BINARY);
      if (op === 'Power')
        return [
          'Power',
          real(d - 1, names),
          random() < 0.6 ? pick([0, 1, 2, 3, 4]) : real(d - 1, names),
        ];
      return [op, real(d - 1, names), real(d - 1, names)];
    }
    if (r < 0.65)
      return [
        'Add',
        real(d - 1, names),
        real(d - 1, names),
        real(d - 1, names),
      ];
    if (r < 0.72)
      return [
        'If',
        boolean(d - 1, names),
        real(d - 1, names),
        real(d - 1, names),
      ];
    if (r < 0.76)
      return [
        'Which',
        boolean(d - 1, names),
        real(d - 1, names),
        boolean(d - 1, names),
        real(d - 1, names),
        'True',
        real(d - 1, names),
      ];
    if (r < 0.83) {
      const k = `k${locals++}`;
      const hi = pick([3, 5, 'n', 'm', 0]);
      return [
        pick(['Sum', 'Product']),
        real(d - 1, [...names, k]),
        ['Limits', k, pick([1, 0, 'm', 2]), hi],
      ];
    }
    if (r < 0.86) return block(d, names);
    if (r < 0.89) return ['At', list(d - 1, names), pick([1, 2, 3, -1, -2])];
    if (r < 0.91) return integer(d - 1);
    if (r < 0.93)
      return [pick(['Sum', 'Product', 'Max', 'Min']), dlist(d - 1, names)];
    if (r < 0.94) return ['Max', dlist(d - 1, names), real(d - 1, names)];
    if (r < 0.955) return ['At', dlist(d - 1, names), integer(d - 1)];
    if (r < 0.97)
      return random() < 0.5
        ? ['f', real(d - 1, names), real(d - 1, names)]
        : [pick(['g', 'h2']), real(d - 1, names)];
    if (framed > 0 && r < 0.975) return ['rnd', real(d - 1, names)];
    if (framed > 0 && r < 0.98)
      // A list with a draw, reduced at once.
      return [
        'Sum',
        [
          'Map',
          ['Function', ['Multiply', `w${locals}`, ['Random']], `w${locals++}`],
          pick(['D', 'J']),
        ],
      ];
    if (r < 0.985) {
      framed++;
      try {
        return ['WithRandomSeed', pick([1, 42, 'n', 7]), real(d - 1, names)];
      } finally {
        framed--;
      }
    }
    return integer(d - 1);
  };

  const block = (d: number, names: string[]): Json => {
    const t = `t${locals++}`;
    const inner = [...names, t];
    // The initial value is a real input, a literal or a name: never a value
    // outside the declared type (the interpreter rejects one, the README's
    // Limits).
    const statements: Json[] = [
      ['Declare', t, 'real', pick(['x', 'y', 0.5, -1.25, ...names])],
    ];
    const n = 1 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      const r = random();
      if (r < 0.4) statements.push(['Assign', t, real(d - 1, inner)]);
      else if (r < 0.8)
        statements.push([
          'If',
          boolean(d - 1, inner),
          ['Assign', t, real(d - 1, inner)],
          random() < 0.5 ? 'Nothing' : ['Assign', t, real(d - 1, inner)],
        ]);
      else statements.push(real(d - 1, inner));
    }
    statements.push(random() < 0.7 ? t : real(d - 1, inner));
    return ['Block', ...statements];
  };

  const boolean = (d: number, names: string[] = []): Json => {
    const r = random();
    if (d <= 0 || r < 0.1) return pick(['p', ['Not', 'p']]);
    if (r < 0.6) return [pick(COMPARE), real(d - 1, names), real(d - 1, names)];
    if (r < 0.7)
      return [
        pick(['Less', 'LessEqual']),
        real(d - 1, names),
        real(d - 1, names),
        real(d - 1, names),
      ];
    if (r < 0.8)
      return [
        pick(['And', 'Or']),
        boolean(d - 1, names),
        boolean(d - 1, names),
      ];
    if (r < 0.88) return ['Not', boolean(d - 1, names)];
    return ['Equal', integer(d - 1), integer(d - 1)];
  };

  const list = (d: number, names: string[] = []): Json => {
    const r = random();
    if (d <= 0 || r < 0.25) return pick(['L', 'M', 'I']);
    if (r < 0.45)
      return [
        'List',
        real(d - 1, names),
        real(d - 1, names),
        real(d - 1, names),
      ];
    if (r < 0.7)
      return [
        pick(['Add', 'Subtract', 'Multiply', 'Divide']),
        list(d - 1, names),
        random() < 0.5 ? real(d - 1, names) : list(d - 1, names),
      ];
    if (r < 0.85)
      return [
        pick(['Sin', 'Exp', 'Negate', 'Abs', 'Floor', 'Sqrt']),
        list(d - 1, names),
      ];
    return [
      'If',
      boolean(d - 1, names),
      list(d - 1, names),
      list(d - 1, names),
    ];
  };

  /** A list of lists: `Q` through a `Map` or a `Filter`. */
  const nested = (): Json => {
    const z = `r${locals++}`;
    return pick([
      ['Map', ['Function', z, z], 'Q'],
      ['Filter', 'Q', ['Function', 'True', z]],
      ['Filter', 'Q', ['Function', ['Less', ['At', z, 1], 'x'], z]],
      ['Map', ['Function', ['Multiply', z, real(1)], z], 'Q'],
    ]);
  };

  const names = Object.keys(DECLINES);
  return () => {
    const r = random();
    const d = 2 + Math.floor(random() * 3);
    if (r < 0.05) {
      const decline = pick(names);
      return { json: ['Add', real(d - 1), DECLINES[decline]], decline };
    }
    const framedReal = () => {
      framed++;
      try {
        return ['WithRandomSeed', pick([1, 42, 'n', 7]), real(d)];
      } finally {
        framed--;
      }
    };
    const json =
      r < 0.55
        ? real(d)
        : r < 0.62
          ? framedReal()
          : r < 0.7
            ? integer(d)
            : r < 0.8
              ? boolean(d)
              : r < 0.9
                ? list(d)
                : r < 0.97
                  ? dlist(d)
                  : nested();
    return { json };
  };
}
