/**
 * A random differential tester of the `numeric-kernel` profile of the
 * JavaScript compiler (the structured route).
 *
 * It generates random programs with a seeded generator, compiles each one
 * with `profile: 'numeric-kernel', fallback: false` and with the existing
 * compiler (`cse: false, constantFold: false, fallback: false`), in the
 * `strict` and the `complex` modes, and compares the values on a grid of
 * inputs with `Object.is` (both parts of a complex value), and the shape
 * of the value that each emitted code makes before `run()` turns
 * `{re, im: 0}` into a number (the `rawCall` of an expression runner; for
 * a `Function` literal, its source from `toString()` evaluated again with
 * its `SYS` helpers). The contract of
 * the profile is that the doubles are the same for every program it admits
 * (docs/COMPILATION-MODEL.md, "The `numeric-kernel` profile of the
 * JavaScript target"). On a few ordinary inputs it also compares the
 * profile with the interpreter, within a relative tolerance and the caveats
 * of compiled code.
 *
 * Each program is boxed with `ce.box()`, so it is canonical. The vocabulary
 * is the one of the tables of the profile (docs/COMPILATION-MODEL.md and
 * docs/plans/2026-11-09-js-pilot-emission-rewrites.md): arithmetic, the
 * functions (also `Factorial`, `Arccot`, `Coth`, `Truncate`, `Fract`,
 * `Hypot`, …, and the heads of real calls: `GammaRegularized`, `Heaviside`,
 * `Remainder`, `GCD`, `KroneckerDelta`, `Clamp`, `Argument`, …), comparisons and chains of three or four operands (`Less`,
 * `LessEqual`, `Equal`, `NotEqual`), and `And`, `Or`, `Not`, `If`, `Which`, `Sum` and
 * `Product` (bounds that are literals, captured numbers or clamped inputs),
 * `At` and `Length` of a list, `Comprehension` over a range, `ReplaceAt`,
 * literals (integers, floats, exact rationals, `Pi`, `ExponentialE`,
 * `ImaginaryUnit`, `Complex(1, 2)`, `i·x`), captured numbers with and
 * without a declared type (`cn` declared `number`), an input and a
 * parameter declared `number` (`xn`, `nb`), an input declared
 * `nan | real | signed_infinity` (`ex`), an input whose type `real` was
 * written by `ce.infer()` (`xi`), boolean inputs and parameters, calls of user
 * functions with declared and inferred signatures (`HELPERS`; `fh` and `fo`
 * have a declared signature and a parameter with no annotation), a `Block`
 * at the root and `Function` literals with typed parameters, with a body
 * of locals (a list local made by a `Comprehension`, a local `k0` that
 * holds 0, 1 or -1 in a complex sum or product), writes, `If`
 * statements and a `Loop` over a range with a `Break`; a `Block` in a
 * `Block`, block statements, a block of declarations as an operand
 * (`ValueBlock`), locals declared `unknown` or `number` (`t` is sometimes declared
 * `unknown`), local functions (`lf`, declared `function`,
 * `unknown`, with a `let` or with `DefineFunction`, which read the names of
 * the body or not), and a helper declared `function` (`fq`). Collections
 * (`genCollectionReal()`, `genList()`, `genTuple()`): list literals of
 * numbers and of expressions, tuples, the inputs `I: list<integer>` and
 * `P: tuple<real, real>` and the parameters `W` and `T` of these types, the
 * inputs `LN: list<number>` and `VN: vector<3>` and the parameter
 * `NV: list<number>` (lists of reals in the `strict` mode),
 * `Sum`, `Product`, `Max` and `Min` of a list or a tuple, `At` and `Length`
 * of one, element-wise arithmetic of a list and reals (two lists only as
 * one expression twice), comprehensions with and without a guard, calls of
 * the helpers of `COLLECTION_HELPERS` (a list or a tuple result), of
 * `SLICE_HELPERS` (a fold, an element-wise sum and comprehensions in the
 * body) and of `LIST_PARAMETER_HELPER` (a list parameter), a write of a
 * local after a list local that reads it, and a list or a tuple as the
 * value of a program or a body. A list or a tuple value is compared
 * element by element, with its length and the shape of each element.
 * Lists of lists (`genRows()`, `genRowReal()`): the inputs
 * `R: list<list<real>>`, `MA: matrix` and `M2: matrix<2x2>`, the parameters
 * `RP` and `MP`, nested literals (ragged ones too), comprehensions of rows,
 * row reads and their elements (`At(M, i)`, `At(M, i, j)`, an `At` of an
 * `At`), `Length` of each level, `ReplaceAt` of a row and of an element of
 * a row, a row read as the row of a `ReplaceAt` (a swap of two rows),
 * `Take`, `Drop`, `Rest`, `Reverse`, the rotations, `Join`,
 * `ListJoin`, a block local of rows updated in a loop, and a list of lists
 * as the value of a program. Loops that carry a list or a list of lists
 * (`genCarriedList()`): a local `A` from an input, a parameter, a captured
 * list, a row read, a function of lists, a literal or a literal that
 * repeats a row, updated in each pass, with an alias, a `Break`, an inner
 * loop, a branch that writes the input, a call or a lambda that reads the
 * list, a row swap and a row of an input written into `A`. Slices 2 to 4
 * of the note of the lists of lists (`genMatrixRows()`, `genMatrixReal()`):
 * the input `M3: matrix<2x3>`, the matrix functions (`Determinant`,
 * `Trace`, `Inverse`, `MatrixPower`, `MatrixMultiply`, `Dot`, `Transpose`,
 * `RowReduce`, `Diagonal`, `Flatten`, `Norm` with and without an order),
 * element-wise arithmetic of lists of lists with reals and with themselves,
 * the sum and the product of the rows of a matrix, `Map` of a function
 * literal over rows, and the product of two matrices or of a matrix and a
 * list.
 *
 * Each call that gives a value is made again with the same inputs (the
 * same value), and every input is compared at every depth with its value
 * before the call (no write into an input). On the profile, the host then
 * writes into every array of the value of a call, and the next call, with
 * new inputs, must give the value again.
 *
 * A difference is reported only for inputs in the type of each input; a
 * difference that occurs only for inputs outside their type (`±Infinity`
 * or `NaN` for `real`, a negative value for `real<0..>`) is counted apart,
 * because the value of compiled code is unspecified there (the caveats of
 * compiled code). A difference of the shape that the codes make, with the
 * same value after `run()`, is its own class. Each difference is shrunk (a subtree replaced by one of
 * its operands, a symbol or a literal while the difference stays, at the
 * input that showed it or at another input of the grid) and the minimal
 * programs are deduplicated by their shape: the canonical form with each
 * symbol, number and constant replaced by `_`, and the parameters of a
 * `Function` left out. A program whose canonical form has the shape of a
 * program shrunk before is counted with that finding, not shrunk again.
 *
 * The comparison with the interpreter reports a value of the profile that
 * differs from a finite value of the interpreter. Where the interpreter has
 * no finite number (an error, `Missing`, `ComplexInfinity`) and compiled
 * code has one, the point is counted and not reported: compiled code
 * carries the pole of a quotient on as `±Infinity` (`erf(1/k)` is `1` at
 * `k = 0`).
 *
 * Usage, as run:
 *
 *   timeout -k 30 600 npx tsx scripts/js-profile-fuzz.ts --seed 1 --count 2000
 *   timeout -k 30 1500 npx tsx scripts/js-profile-fuzz.ts \
 *     --seed 11,12,13,14,15 --count 10000 --json <file>
 *   timeout -k 30 1500 npx tsx scripts/js-profile-fuzz.ts \
 *     --seed 21,22,23,24,25 --count 10000 --json <file>
 *   timeout -k 30 1500 npx tsx scripts/js-profile-fuzz.ts \
 *     --seed 81,82,83,84,85 --count 10000 --json <file>
 *
 * Options:
 *   --seed <n[,n…]>      The seeds (default 1). The same seed gives the same
 *                        programs, inputs and report.
 *   --count <n>          Programs per seed (default 500).
 *   --depth <n>          The largest depth of an expression (default 4).
 *   --size <n>           The largest number of nodes of a program
 *                        (default 40); a larger program is drawn again.
 *   --points <n>         The largest number of input points per program and
 *                        mode (default 300); a larger grid is sampled.
 *   --interp <n>         Ordinary inputs per program compared with the
 *                        interpreter (default 3; 0 turns the comparison off).
 *   --shrink <n>         The largest number of compilations of one shrink
 *                        (default 300).
 *   --modes <m[,m]>      `strict`, `complex` or both (default both).
 *   --random             Also generate draws: `Random()`, `Random` of a
 *                        literal `Interval` or `Range`, `WithRandomSeed`
 *                        with a literal or an input seed, and calls of the
 *                        helpers of `RANDOM_HELPERS`, whose body draws.
 *                        Each call of a compiled function runs with
 *                        `Math.random` replaced by the same deterministic
 *                        sequence, started again before the call, so the
 *                        two compilers give the same doubles when they draw
 *                        the same number of times in the same order; the
 *                        number of draws outside a seeded region is part
 *                        of the outcome. A program that draws outside a
 *                        `WithRandomSeed`, or an expression that draws
 *                        (interpreted after `subs()`), is not compared
 *                        with the interpreter (counted as skipped,
 *                        `interpretsDraws()`). Without the
 *                        option, the programs are those of the same seed
 *                        before the option was added.
 *   --host               Also generate the options of the host
 *                        (`HOST_OPTIONS`): reads of names that a `vars`
 *                        entry maps to another entry of the vars object
 *                        (`vu`, `_["vu_"]`, declared `real`; `vz`,
 *                        `_.vz_`, with no declared type), reads of the host
 *                        (`vr`, `__fuzzRead()`, which counts its reads),
 *                        calls of a `functions` entry declared pure (`hp`)
 *                        and of one that is not (`hq`), of one that sets
 *                        `x` of the vars object (`hm`), and of an
 *                        `operators` entry (`ho`); each function of the host
 *                        counts its calls. Both compilers compile with these
 *                        options, and the calls and reads of the host, in
 *                        order, are part of the outcome. A program that
 *                        reads or calls the host is not compared with the
 *                        interpreter (`interpretsDraws()`). Without the
 *                        option, the programs are those of the same seed
 *                        before the option was added.
 *   --calculus           Also generate the calculus heads of an expression
 *                        (`genCalculus()`): `Integrate` of an elementary
 *                        integrand in `t` with bounds that are literals or
 *                        leaves, a definite `Integrate` with no closed form
 *                        (`genQuadrature()`: an expression of the program
 *                        in `t`, infinite and reversed bounds, two clauses,
 *                        an integral in an integrand), `D` of one in a name,
 *                        and `Apply` of the `Derivative` of a literal; a
 *                        derivative with no closed form
 *                        (`genNumericDerivative()`), a `Limit`
 *                        (`genLimit()`) and an integrand in log space
 *                        (`genLogSpaceIntegral()`). The
 *                        profile admits a node with a closed form as that
 *                        closed form, and one with none as a routine
 *                        (`_SYS.integrate`, `_SYS.nd`, `_SYS.limit`, with
 *                        `_SYS.finiteOr`). Without the option,
 *                        the programs are those of the same seed before the
 *                        option was added.
 *   --deg                Each engine has the angular unit `deg`: the
 *                        same programs, compiled and interpreted in
 *                        degrees.
 *   --bigint             Integer programs in the compile mode `bigint`, in
 *                        place of the programs above
 *                        (`scripts/js-profile-fuzz-bigint.ts`): a `bigint`
 *                        or a `boolean` result must be the same (`===`) on
 *                        both compilers, and equal to the exact value of the
 *                        interpreter; the inputs are given as `bigint`
 *                        values and, at some points, as `number` values.
 *                        `--modes`, `--random`, `--host` and `--deg` do not
 *                        apply.
 *
 *   timeout -k 30 1500 npx tsx scripts/js-profile-fuzz.ts \
 *     --seed 131,132,133 --count 10000 --bigint
 *   --json <file>        Also write the whole result as JSON.
 *   --quiet              Print the counts only, not the programs.
 *
 * Synchronous code has no time limit, so each loop and sum of a generated
 * program has a small literal or clamped range; run the script under
 * `timeout`.
 *
 * The output: the counts of each class (both compilers decline, the profile
 * declines only, the existing compiler declines only, a failure of the
 * profile that is not a decline, both compile), the 30 most frequent
 * decline messages of the profile (names and numbers replaced), then each
 * distinct differing shape with its minimal program, declarations, mode,
 * input, both codes and both values; the programs that the existing
 * compiler declines and the profile admits, by shape; the out-of-type
 * differences by shape; the disagreements with the interpreter by shape.
 * Progress goes to stderr, a line per 500 programs.
 *
 * Not generated yet: helpers with random bodies (the helpers of `HELPERS`
 * are fixed), a helper that calls another, `Loop` bounds that are not
 * literals or `m`, `Continue`, a `Break` outside the last statement of a
 * branch, more than two real locals, nested `Function` literals, a
 * boolean result, `RandomChoice`, `RandomSample`, `RandomShuffle`
 * (outside the profile).
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ComputeEngine } from '../src/compute-engine';
import { compile } from '../src/compile';
import {
  isFunction,
  isNumber,
} from '../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../src/compute-engine/global-types';
import type { MathJsonExpression } from '../src/math-json/types';
import { printBigintResult, runBigintFuzz } from './js-profile-fuzz-bigint';

//
// Seeded random numbers
//

export type Rng = () => number;

/** The mulberry32 generator: a number in [0, 1) at each call. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for the program `index` of the run of `seed`. */
function mixSeed(seed: number, index: number, salt: number): number {
  let h = (seed * 0x9e3779b1) ^ (index * 0x85ebca77) ^ (salt * 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

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

const intBetween = (rng: Rng, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

//
// Inputs
//

export type Json = number | string | Json[];
type Complex = { re: number; im: number };
export type Value = number | boolean | Complex | number[] | number[][];
export type Inputs = Record<string, Value>;
type Mode = 'strict' | 'complex';

/** The kind of an input, which gives its grid and its type. */
type InputKind =
  | 'real'
  | 'integer'
  | 'nonneg'
  | 'unit'
  | 'complex'
  | 'undeclared'
  | 'number'
  | 'realnan'
  | 'list'
  | 'intlist'
  | 'numlist'
  | 'numvec'
  | 'tuple'
  | 'tuplelist'
  | 'rows'
  | 'matrix'
  | 'matrix22'
  | 'matrix23'
  | 'boolean'
  | 'inferred';

/** The free inputs of an expression program and their kinds. */
const GLOBAL_INPUTS: Readonly<Record<string, InputKind>> = {
  x: 'real',
  y: 'real',
  k: 'integer',
  p: 'nonneg',
  q: 'unit',
  z: 'complex',
  u: 'undeclared',
  xn: 'number',
  ex: 'realnan',
  // Real, by `ce.infer()` of `Mod(xi, 2)` (`makeEngine()`).
  xi: 'inferred',
  L: 'list',
  I: 'intlist',
  // Lists of `number` elements, real in the `strict` mode.
  LN: 'numlist',
  VN: 'numvec',
  P: 'tuple',
  LQ: 'tuplelist',
  // Lists of lists: rows of any lengths, a matrix, a matrix<2x2>.
  R: 'rows',
  MA: 'matrix',
  M2: 'matrix22',
  M3: 'matrix23',
  B: 'boolean',
  // The names that `HOST_OPTIONS` maps to another entry of the vars object
  // (`--host`).
  vu: 'real',
  vz: 'undeclared',
};

/** The parameters of a `Function` program: name, kind, type string. */
const PARAMETERS: readonly (readonly [string, InputKind, string])[] = [
  ['a', 'real', 'real'],
  ['b', 'real', 'real'],
  ['n', 'integer', 'integer'],
  ['nb', 'number', 'number'],
  ['V', 'list', 'list<real>'],
  ['W', 'intlist', 'list<integer>'],
  ['NV', 'numlist', 'list<number>'],
  ['T', 'tuple', 'tuple<real, real>'],
  ['TL', 'tuplelist', 'list<tuple<real, real>>'],
  ['RP', 'rows', 'list<list<real>>'],
  ['MP', 'matrix22', 'matrix<2x2>'],
  ['c', 'boolean', 'boolean'],
  // Parameters with the names of the captured `cr` and `CL`
  // (`closedNodes()`): the body reads the argument, not the capture.
  ['cr', 'real', 'real'],
  ['CL', 'list', 'list<real>'],
];

/** The kinds of the inputs and parameters that are lists of lists. */
const ROW_KINDS: ReadonlySet<InputKind> = new Set([
  'rows',
  'matrix',
  'matrix22',
  'matrix23',
]);

const TYPE_OF_KIND: Readonly<Record<InputKind, string>> = {
  real: 'real',
  integer: 'integer',
  nonneg: 'real<0..>',
  unit: 'real<-1..1>',
  complex: 'complex',
  undeclared: '(no declared type)',
  number: 'number',
  realnan: 'nan | real | signed_infinity',
  list: 'list<real>',
  intlist: 'list<integer>',
  numlist: 'list<number>',
  numvec: 'vector<3>',
  tuple: 'tuple<real, real>',
  tuplelist: 'list<tuple<real, real>>',
  rows: 'list<list<real>>',
  matrix: 'matrix',
  matrix22: 'matrix<2x2>',
  matrix23: 'matrix<2x3>',
  boolean: 'boolean',
  inferred: 'real, written by ce.infer()',
};

/** The names whose value is an expression (`makeEngine()`): the profile
 *  computes each once per call, as the existing compiler computes
 *  `_val_lv`; the interpreter reads them through `subs()` of their values
 *  (`interpret()`). */
const EXPRESSION_VALUES: Readonly<Record<string, Json>> = {
  lv: ['Add', 'x', 1],
  ev: ['Multiply', 'y', ['Sin', 'x']],
  ec: ['Add', ['Multiply', 2, 'ev'], 'k'],
  cv: ['Add', ['Sqrt', 2], 'cr'],
  lsv: ['List', 'x', ['Multiply', 2, 'y']],
};

/** The declarations of the engine, as the report prints them. */
export const DECLARATIONS =
  'x, y: real; k: integer; p: real<0..>; q: real<-1..1>; z: complex; ' +
  'L: list<real>; I: list<integer>; LN: list<number>; VN: vector<3>; ' +
  'P: tuple<real, real>; ' +
  'LQ: list<tuple<real, real>>; R: list<list<real>>; MA: matrix; ' +
  'M2: matrix<2x2>; M3: matrix<2x3>; B: boolean; ' +
  'u: no declared type; xn: number; ' +
  'ex: nan | real | signed_infinity; xi: real, written by ce.infer() of ' +
  'Mod(xi, 2); h: real, assigned 2.5; ' +
  'm: integer, assigned 3; cn: number, assigned 1.5; w: assigned 3 and ' +
  'g: assigned 0.75, with no declared type; cr: assigned 1/3 and crn: ' +
  'assigned 3333333333333333/10^16, with no declared type; CL: ' +
  'list<real>, assigned [2, -0.5, 3]; lv: assigned x + 1, ev: assigned ' +
  'y·sin(x), ec: assigned 2·ev + k, cv: assigned √2 + cr, lsv: assigned ' +
  '[x, 2y] (values that are expressions); CM2: assigned [[1, 2.5], [-3, ' +
  '4]]; z0: assigned -0.5 + 2i; the helpers of `HELPERS`, assigned in the ' +
  'scope of each program';

/** An engine with the declarations of every program, and the angular unit
 *  `angularUnit` (`--deg`). */
export function makeEngine(angularUnit: 'rad' | 'deg' = 'rad'): ComputeEngine {
  const ce = new ComputeEngine();
  if (angularUnit !== 'rad') ce.angularUnit = angularUnit;
  for (const [name, kind] of Object.entries(GLOBAL_INPUTS))
    if (kind === 'inferred') ce.infer([ce.expr(['Mod', name, 2])]);
    else if (kind !== 'undeclared') ce.declare(name, TYPE_OF_KIND[kind]);
  ce.declare('h', 'real');
  ce.assign('h', 2.5);
  ce.declare('m', 'integer');
  ce.assign('m', 3);
  ce.declare('cn', 'number');
  ce.assign('cn', 1.5);
  ce.assign('w', 3);
  ce.assign('g', 0.75);
  // Captured exact values and a captured list (`closedNodes()`).
  ce.assign('cr', ce.expr(['Rational', 1, 3]));
  ce.assign('crn', ce.expr(['Rational', 3333333333333333, 10 ** 16]));
  ce.declare('CL', {
    type: 'list<real>',
    value: ['List', 2, -0.5, 3],
  } as never);
  // Values that are expressions of the inputs (`EXPRESSION_VALUES`), a
  // captured list of lists and a captured complex number.
  for (const [name, value] of Object.entries(EXPRESSION_VALUES))
    ce.assign(name, ce.expr(value));
  ce.assign('CM2', ce.expr(['List', ['List', 1, 2.5], ['List', -3, 4]]));
  ce.assign('z0', ce.expr(['Complex', -0.5, 2]));
  // The names and the functions of the host of `--host` (`HOST_OPTIONS`).
  ce.declare('vr', 'real');
  ce.declare('hp', '(real) -> real');
  ce.declare('hq', '(real, real) -> real');
  ce.declare('ho', '(real) -> real');
  ce.declare('hm', '(real) -> real');
  // `hd` is also a pure function of the engine: the existing compiler reads
  // a call of it as pure (`isTransitivelyPure()`).
  ce.declare('hd', '(real) -> real');
  ce.assign(
    'hd',
    ce.expr(['Function', ['Multiply', 't', 2], ['Typed', 't', "'real'"]])
  );
  return ce;
}

/**
 * The options of the host of `--host`: `vu` and `vz` read other entries of
 * the vars object (`vu_`, `vz_`, which the runner sets to the values of
 * `vu` and `vz`), `vr` reads the host, `hp` is a function of the host
 * declared pure, `hd` one declared pure whose name the engine also defines
 * as a pure function, `hq` one that is not, `hm` one that sets `x` of the
 * vars object of the call (`HOST_VARS`), and `ho` an `operators` entry;
 * `Tanh` and `Max` map library operators, which a function operand reads.
 * Each read and call is logged in `HOST_LOG` (`hostCalls()`), and so is
 * each draw (`withStubbedRandom()`), so the log gives their order.
 */
const HOST_OPTIONS = {
  vars: {
    vu: '_["vu_"]',
    vz: '_.vz_',
    vr: '__fuzzRead()',
    // Library operators as function operands (`Map(Tanh, L)`,
    // `Reduce(L, Max, x)`): the existing emitter calls these sources.
    Tanh: '((t) => t + 1)',
    Max: '((a, b) => a - b)',
  },
  functions: {
    hp: { source: '__fuzzPure', pure: true },
    hd: { source: '__fuzzDefined', pure: true },
    hq: '__fuzzImpure',
    hm: '__fuzzMutate',
  },
  operators: { ho: ['__fuzzOp', 20] as [string, number] },
};

/** The reads and calls of the host during a run (`--host`). */
const HOST_LOG: string[] = [];
const hostGlobals = globalThis as unknown as Record<string, unknown>;
hostGlobals.__fuzzRead = () => {
  HOST_LOG.push('read');
  return [0.5, -1.25, 3, 0.1][HOST_LOG.length % 4];
};
hostGlobals.__fuzzPure = (t: number) => {
  HOST_LOG.push(`hp(${t})`);
  return t * t - 0.5;
};
hostGlobals.__fuzzDefined = (t: number) => {
  HOST_LOG.push(`hd(${t})`);
  return 2 * t;
};
hostGlobals.__fuzzImpure = (a: number, b: number) => {
  HOST_LOG.push(`hq(${a},${b})`);
  return a - 2 * b + 0.001 * HOST_LOG.length;
};
hostGlobals.__fuzzOp = (t: number) => {
  HOST_LOG.push(`ho(${t})`);
  return Math.sin(t) + 0.01 * HOST_LOG.length;
};
/** The vars object of the current call of an expression (`--host`), which
 *  `hm` changes. */
let HOST_VARS: Record<string, unknown> | undefined;
hostGlobals.__fuzzMutate = (t: number) => {
  HOST_LOG.push(`hm(${t})`);
  if (HOST_VARS !== undefined) HOST_VARS.x = 0.25 + HOST_LOG.length;
  return t / 2 + 1;
};

/** Run `f` with an empty `HOST_LOG`, and give its value and the log. */
function hostCalls<T>(f: () => T): { value: T; host: string } {
  HOST_LOG.length = 0;
  const value = f();
  return { value, host: HOST_LOG.join(' ') };
}

/** Whether `json` reads or calls the host (`HOST_OPTIONS`). */
function usesHost(json: Json): boolean {
  if (typeof json === 'string')
    return json === 'vr' || json === 'vu' || json === 'vz';
  if (!Array.isArray(json)) return false;
  return (
    json[0] === 'hp' ||
    json[0] === 'hd' ||
    json[0] === 'hq' ||
    json[0] === 'ho' ||
    json[0] === 'hm' ||
    json.slice(1).some(usesHost)
  );
}

/**
 * The user functions that a program can call: a name, its declared
 * signature (absent: the engine infers it from the definition), the
 * definition, and the kinds of its arguments. Each is assigned in the scope
 * of the program, so the inference of one program does not reach another.
 */
const HELPERS: readonly {
  readonly name: string;
  readonly signature?: string;
  readonly definition: Json;
  readonly arguments: readonly ('real' | 'integer' | 'boolean')[];
}[] = [
  // A parameter with the name of the captured `cr = 1/3`: the body reads the
  // argument, also in the rounding and the sign.
  {
    name: 'fcr',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['Add', ['Floor', 'cr'], ['Multiply', 2, 'cr'], ['Sign', 'cr']],
      ['Typed', 'cr', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fd',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['Add', ['Multiply', 2, 'v'], ['Divide', 1, ['Add', 'v', 3]]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fi',
    definition: [
      'Function',
      ['Add', ['Multiply', 'v', 'v'], ['Multiply', 0.1, 'v']],
      'v',
    ],
    arguments: ['real'],
  },
  {
    name: 'fs',
    signature: '(real, integer) -> real',
    definition: [
      'Function',
      [
        'Block',
        ['Declare', 's', "'real'", 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', ['Divide', 'v', 'j']]],
          ['Element', 'j', ['Range', 1, 3]],
        ],
        ['If', ['Less', 's', 0], ['Assign', 's', ['Negate', 's']]],
        ['Add', 's', 'e'],
      ],
      ['Typed', 'v', "'real'"],
      ['Typed', 'e', "'integer'"],
    ],
    arguments: ['real', 'integer'],
  },
  {
    name: 'ft',
    definition: [
      'Function',
      [
        'Block',
        ['Declare', 't', "'real'", 'v'],
        ['If', ['Less', 'v', 1], ['Assign', 't', ['Multiply', 't', 0.1]]],
        ['Multiply', 't', ['Divide', 3, 'v']],
      ],
      'v',
    ],
    arguments: ['real'],
  },
  {
    name: 'fb',
    signature: '(real, boolean) -> real',
    definition: [
      'Function',
      ['If', 'd', 'v', ['Negate', 'v']],
      ['Typed', 'v', "'real'"],
      ['Typed', 'd', "'boolean'"],
    ],
    arguments: ['real', 'boolean'],
  },
  {
    name: 'fn',
    signature: '(number) -> number',
    definition: [
      'Function',
      ['Add', ['Sin', 'v'], ['Multiply', 'v', 'v']],
      ['Typed', 'v', "'number'"],
    ],
    arguments: ['real'],
  },
  {
    // A helper declared `function`: the rule of an inferred signature.
    name: 'fq',
    signature: 'function',
    definition: [
      'Function',
      ['Add', ['Multiply', 3, 'v'], ['Divide', 'v', ['Add', ['Multiply', 'v', 'v'], 2]]],
      'v',
    ],
    arguments: ['real'],
  },
  {
    // A declared signature and a parameter with no annotation: the
    // parameter has the type of the signature.
    name: 'fh',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['Add', ['Multiply', 'v', 'v'], ['Sqrt', ['Abs', 'v']]],
      'v',
    ],
    arguments: ['real'],
  },
  {
    name: 'fo',
    signature: '(number) -> number',
    definition: ['Function', ['Add', ['Sin', 'v'], ['Divide', 1, 'v']], 'v'],
    arguments: ['real'],
  },
  {
    name: 'fr',
    signature: '(real) -> number',
    definition: [
      'Function',
      ['Divide', 'v', ['Add', ['Multiply', 'v', 'v'], 1]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  // A parameter with a default value: a call that leaves it out (the
  // engine completes it), and one that gives it.
  {
    name: 'fdf',
    definition: [
      'Function',
      ['Add', ['Multiply', 'v', 'ka'], ['Multiply', 0.5, 'ka', 'ka']],
      ['Typed', 'v', "'real'"],
      ['Optional', ['Typed', 'ka', "'real'"], 2],
    ],
    arguments: ['real'],
  },
  {
    name: 'fdu',
    definition: [
      'Function',
      ['Subtract', 'v', ['Multiply', 'ka', 'ka']],
      'v',
      ['Optional', 'ka', -0.5],
    ],
    arguments: ['real', 'real'],
  },
  // A loop with a `Continue` and a destructuring write in a helper body.
  {
    name: 'fcw',
    definition: [
      'Function',
      [
        'Block',
        ['Declare', 'a', "'real'", 'v'],
        ['Declare', 'b', "'real'", 1],
        [
          'Loop',
          [
            'Block',
            ['If', ['Equal', ['Mod', 'j', 2], 0], ['Continue']],
            ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', ['Add', 'a', ['Multiply', 0.5, 'b']]]],
          ],
          ['Element', 'j', ['Range', 1, 4]],
        ],
        ['Subtract', 'a', 'b'],
      ],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
];

/** The helpers whose body draws, called by a program of `--random`. */
const RANDOM_HELPERS: typeof HELPERS = [
  {
    name: 'fr',
    definition: [
      'Function',
      ['Add', 'v', ['Multiply', 0.5, ['Random']]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fv',
    definition: [
      'Function',
      [
        'Block',
        ['Declare', 't', "'real'", ['Random', ['Interval', -1, 1]]],
        ['If', ['Less', 'v', 't'], ['Assign', 't', ['Add', 't', ['Random']]]],
        ['Multiply', 't', 'v'],
      ],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
];

/** The helpers whose result is a list or a tuple, or whose parameter is a
 *  list: a list or a tuple of the generator (`genList()`, `genTuple()`)
 *  calls the first three, a real calls the last one. */
const COLLECTION_HELPERS: typeof HELPERS = [
  {
    name: 'fl',
    signature: '(real) -> list<real>',
    definition: [
      'Function',
      ['List', 'v', ['Multiply', 2, 'v'], 1],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fg',
    signature: '(integer) -> list<integer>',
    definition: [
      'Function',
      [
        'Comprehension',
        ['Multiply', 'j', 'j'],
        ['Element', 'j', ['Range', 1, 6], ['Less', 'e', 'j']],
      ],
      ['Typed', 'e', "'integer'"],
    ],
    arguments: ['integer'],
  },
  {
    name: 'fp',
    signature: '(real, real) -> tuple<real, real>',
    definition: [
      'Function',
      ['Tuple', ['Add', 'v', 'e'], ['Multiply', 'v', 'e']],
      ['Typed', 'v', "'real'"],
      ['Typed', 'e', "'real'"],
    ],
    arguments: ['real', 'real'],
  },
];

/** The helpers whose body holds a list or a tuple of the slice: a fold of
 *  a list literal (with and without an element of the head of the fold),
 *  `At` of an element-wise sum of a list literal, an element-wise list
 *  result, and guarded comprehensions. A real of the generator calls the
 *  real ones (`genCollectionReal()`), a list the list one (`genList()`). */
const SLICE_HELPERS: typeof HELPERS = [
  {
    name: 'fu',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['Sum', ['List', 2, ['Add', 'v', -0.1], ['Multiply', 3, 'v']]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fw',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['Add', ['Max', ['List', 'v', ['Multiply', 2, 'v'], 1]], ['Product', ['Tuple', 'v', 0.5]]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fx',
    signature: '(real) -> real',
    definition: [
      'Function',
      ['At', ['Add', ['List', 1, 'v'], ['Add', 'v', -0.1]], 2],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fz',
    signature: '(real) -> integer',
    definition: [
      'Function',
      ['Length', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 6], ['Less', 'v', 'j']]]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fk',
    signature: '(real) -> real',
    definition: [
      'Function',
      [
        'Sum',
        [
          'Comprehension',
          ['Multiply', 'j', 'v'],
          ['Element', 'j', ['Range', 1, 4], ['Less', 'j', ['Add', 'v', 3]]],
        ],
      ],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
  {
    name: 'fy',
    signature: '(real) -> list<real>',
    definition: [
      'Function',
      ['Multiply', ['List', 'v', 1], ['Add', 'v', 0.5]],
      ['Typed', 'v', "'real'"],
    ],
    arguments: ['real'],
  },
];

/** A helper with a list parameter and a real result. */
const LIST_PARAMETER_HELPER = {
  name: 'fm',
  signature: '(list<real>) -> real',
  definition: [
    'Function',
    ['Add', ['Sum', 'CL'], ['Max', 'CL'], ['At', 'CL', 1]],
    // The name of the captured list `CL`: the body reads the argument.
    ['Typed', 'CL', "'list<real>'"],
  ] as Json,
};

/** The helpers that a function operand of `Reduce`, `Scan`, `Filter` and
 *  `Count` names (a user function as the function operand): a function of
 *  the accumulator and the element, and a predicate. */
const FUNCTION_OPERAND_HELPERS = [
  {
    name: 'fe',
    signature: '(real, real) -> real',
    definition: [
      'Function',
      ['Subtract', ['Multiply', 'v', 2], ['Divide', 'e', 3]],
      ['Typed', 'v', "'real'"],
      ['Typed', 'e', "'real'"],
    ] as Json,
  },
  {
    name: 'fc',
    signature: '(real) -> boolean',
    definition: ['Function', ['Less', 'v', 0.5], ['Typed', 'v', "'real'"]] as Json,
  },
];

/** Assigns the helpers of `HELPERS`, `RANDOM_HELPERS`,
 *  `COLLECTION_HELPERS`, `SLICE_HELPERS`, `LIST_PARAMETER_HELPER` and
 *  `FUNCTION_OPERAND_HELPERS` in the current scope of `ce`. */
function defineHelpers(ce: ComputeEngine): void {
  for (const helper of [
    ...HELPERS,
    ...RANDOM_HELPERS,
    ...COLLECTION_HELPERS,
    ...SLICE_HELPERS,
    LIST_PARAMETER_HELPER,
    ...FUNCTION_OPERAND_HELPERS,
  ]) {
    if (helper.signature !== undefined)
      ce.declare(helper.name, helper.signature);
    ce.assign(helper.name, ce.expr(helper.definition as MathJsonExpression));
  }
}

const REAL_IN = [
  3,
  0.4641588833612779,
  1 / 3,
  0.1,
  7,
  0,
  -0,
  1,
  -1,
  -2.5,
  0.5,
  1e155,
  -1e155,
  1e300,
  -1e300,
  1e-160,
  5e-324,
  -5e-324,
];
const NON_FINITE = [Infinity, -Infinity, NaN];
const INTEGERS = [0, 1, -1, 2, 3, -3, 7, 10, 2 ** 53, -(2 ** 53)];
const NONNEG_IN = [
  0,
  -0,
  3,
  0.4641588833612779,
  1 / 3,
  0.1,
  7,
  1,
  0.5,
  1e155,
  1e300,
  1e-160,
  5e-324,
];
const UNIT_IN = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1 / 3,
  0.1,
  0.4641588833612779,
  1e-160,
  5e-324,
];
const PARTS = [0, -0, 1, -1, 0.5, 3, 1 / 3, 1e300, 1e-160];
const COMPLEX_IN: Complex[] = PARTS.flatMap((re) =>
  PARTS.map((im) => ({ re, im }))
);
const COMPLEX_EDGE: Complex[] = [
  { re: Infinity, im: 1 },
  { re: 1, im: -Infinity },
  { re: NaN, im: 0 },
  { re: -Infinity, im: -Infinity },
];
const LISTS_IN: number[][] = [
  [],
  [3],
  [0.1, 1 / 3, 7],
  [-0, 1e300, 5e-324, -1],
  [2.5, -2.5, 0.4641588833612779, 1e-160],
];
const LISTS_EDGE: number[][] = [[NaN, Infinity]];
const VECTORS_IN: number[][] = [
  [0.1, 1 / 3, 7],
  [-0, 1e300, -1],
  [2.5, -2.5, 1e-160],
];
const VECTORS_EDGE: number[][] = [[NaN, Infinity, -0]];
const INTLISTS_IN: number[][] = [[], [3], [1, -2, 7], [0, 2 ** 53, -4]];
const TUPLES_IN: number[][] = [
  [1, 2],
  [-0, 0.5],
  [1e300, -3],
  [1 / 3, 0.1],
];
const TUPLES_EDGE: number[][] = [[NaN, 1]];
const TUPLE_LISTS_IN: number[][][] = [
  [],
  [[1, 2]],
  [[0.1, -3], [2.5, 1 / 3], [-0, 7]],
  [[1e300, 5e-324], [-1, 0.5]],
];
const TUPLE_LISTS_EDGE: number[][][] = [[[NaN, 1], [2, Infinity]]];
// Lists of lists: rows of different lengths, an empty list and an empty row
// for `list<list<real>>`; rectangular values of one row or more for a
// `matrix`, of 2×2 for a `matrix<2x2>`. A ragged or an empty value of a
// matrix is outside its type.
const ROWS_IN: number[][][] = [
  [],
  [[]],
  [[1, 2], [3]],
  [[-0, 1e300], [5e-324], [1 / 3, 2, -7]],
  [[0.5, -2.5]],
];
const ROWS_EDGE: number[][][] = [[[NaN]], [[Infinity, 1], []]];
const MATRICES_IN: number[][][] = [
  [[1, 2], [3, 4]],
  [[-0, 0.5, 1e300], [7, -2, 5e-324]],
  [[2]],
];
const MATRICES_EDGE: number[][][] = [[], [[1], [2, 3]], [[NaN, 1]]];
const MATRICES22_IN: number[][][] = [
  [[1, 2], [3, 4]],
  [[-0, 0.5], [7, -2]],
  [[1e300, -1e300], [5e-324, 1 / 3]],
];
const MATRICES22_EDGE: number[][][] = [[[NaN, 1], [2, 3]], [[1, 2]]];
const MATRICES23_IN: number[][][] = [
  [[1, 2, 3], [4, 5, 6]],
  [[-0, 0.5, 1e300], [7, -2, 5e-324]],
];
const MATRICES23_EDGE: number[][][] = [[[1, 2], [3, 4]]];

/** The values of an input of the kind `kind` in the mode `mode`: those in
 *  its type first, then those outside it. */
function gridOf(kind: InputKind, mode: Mode): Value[] {
  switch (kind) {
    case 'real':
    case 'inferred':
      return [...REAL_IN, ...NON_FINITE];
    case 'integer':
      return INTEGERS;
    case 'nonneg':
      return [...NONNEG_IN, Infinity, NaN, -1];
    case 'unit':
      return [...UNIT_IN, 2, NaN];
    case 'complex':
      return [...COMPLEX_IN, ...COMPLEX_EDGE];
    case 'undeclared':
    case 'number':
      return mode === 'strict'
        ? [...REAL_IN, ...NON_FINITE]
        : [...REAL_IN, ...COMPLEX_IN, ...NON_FINITE, ...COMPLEX_EDGE];
    case 'realnan':
      return [...REAL_IN, ...NON_FINITE];
    case 'list':
      return [...LISTS_IN, ...LISTS_EDGE];
    case 'intlist':
      return INTLISTS_IN;
    case 'numlist':
      return [...LISTS_IN, ...LISTS_EDGE];
    case 'numvec':
      return [...VECTORS_IN, ...VECTORS_EDGE];
    case 'tuple':
      return [...TUPLES_IN, ...TUPLES_EDGE];
    case 'tuplelist':
      return [...TUPLE_LISTS_IN, ...TUPLE_LISTS_EDGE];
    case 'rows':
      return [...ROWS_IN, ...ROWS_EDGE];
    case 'matrix':
      return [...MATRICES_IN, ...MATRICES_EDGE];
    case 'matrix22':
      return [...MATRICES22_IN, ...MATRICES22_EDGE];
    case 'matrix23':
      return [...MATRICES23_IN, ...MATRICES23_EDGE];
    case 'boolean':
      return [true, false];
  }
}

const isComplex = (v: unknown): v is Complex =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 're' in v;

/** Whether `v` is a value of the type of an input of the kind `kind`. */
function inType(kind: InputKind, v: Value, mode: Mode): boolean {
  switch (kind) {
    case 'real':
    case 'inferred':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'nonneg':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0;
    case 'unit':
      return typeof v === 'number' && v >= -1 && v <= 1;
    case 'complex':
      return isComplex(v) && Number.isFinite(v.re) && Number.isFinite(v.im);
    case 'realnan':
      return typeof v === 'number';
    case 'undeclared':
    case 'number':
      if (typeof v === 'number') return Number.isFinite(v);
      return (
        mode === 'complex' &&
        isComplex(v) &&
        Number.isFinite(v.re) &&
        Number.isFinite(v.im)
      );
    case 'list':
      return Array.isArray(v) && v.every((x) => Number.isFinite(x));
    case 'intlist':
      return Array.isArray(v) && v.every((x) => Number.isInteger(x));
    // A `number` element is real in the `strict` mode; the `complex` mode
    // declines such a list.
    case 'numlist':
      return Array.isArray(v) && v.every((x) => Number.isFinite(x));
    case 'numvec':
      return (
        Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x))
      );
    case 'tuple':
      return (
        Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x))
      );
    case 'tuplelist':
      return (
        Array.isArray(v) &&
        v.every(
          (t) =>
            Array.isArray(t) &&
            t.length === 2 &&
            t.every((x) => Number.isFinite(x))
        )
      );
    case 'rows':
    case 'matrix':
    case 'matrix22':
    case 'matrix23': {
      if (
        !Array.isArray(v) ||
        !v.every((row) => Array.isArray(row) && row.every((x) => Number.isFinite(x)))
      )
        return false;
      const rows = v as number[][];
      if (kind === 'rows') return true;
      const width = rows[0]?.length ?? 0;
      return (
        rows.length > 0 &&
        width > 0 &&
        rows.every((row) => row.length === width) &&
        (kind === 'matrix' ||
          (rows.length === 2 && width === (kind === 'matrix23' ? 3 : 2)))
      );
    }
    case 'boolean':
      return typeof v === 'boolean';
  }
}

/** A number that the interpreter and compiled code both hold with no
 *  overflow, underflow or sign of zero to tell apart. Zero is left out: it
 *  is the pole of most quotients and logarithms, where the interpreter has
 *  no number. */
const ordinaryNumber = (v: number): boolean =>
  Number.isFinite(v) && Math.abs(v) >= 1e-6 && Math.abs(v) <= 1e6;

function ordinary(v: Value): boolean {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return ordinaryNumber(v);
  if (Array.isArray(v))
    return v.every((x) =>
      Array.isArray(x) ? x.every(ordinaryNumber) : ordinaryNumber(x)
    );
  return ordinaryNumber(v.re) && ordinaryNumber(v.im);
}

//
// Generation
//

/** What the generator reads: the symbols of a leaf and their weights. */
interface GenContext {
  readonly rng: Rng;
  readonly maxDepth: number;
  readonly symbols: readonly (readonly [Json, number])[];
  /** The integer names for a clamped bound and an index. */
  readonly integers: readonly string[];
  /** The real names that a clamped bound can floor. */
  readonly reals: readonly string[];
  /** The boolean names that a condition can read. */
  readonly booleans: readonly string[];
  /** The list names. */
  readonly lists: readonly string[];
  /** The names of tuples of two reals. */
  readonly tuples?: readonly string[];
  /** The names of lists of tuples of two reals. */
  readonly tupleLists?: readonly string[];
  /** The names of lists of lists of reals (rows, matrices). */
  readonly rowLists?: readonly string[];
  /** Whether to generate draws (`--random`). */
  readonly random?: boolean;
  /** Whether to generate reads and calls of the host (`--host`). */
  readonly host?: boolean;
  /** Whether to generate calculus heads in an expression (`--calculus`). */
  readonly calculus?: boolean;
  /** The local functions of the block around the expression, each with
   *  one real parameter, that a call can reach. */
  readonly localFunctions?: readonly string[];
  /** The number of value blocks around the expression: the name of the
   *  local of a new one (`b0`, `b1`, …). */
  readonly valueBlocks?: number;
}

const LITERALS: readonly (readonly [Json, number])[] = [
  [0, 3],
  [1, 6],
  [2, 6],
  [3, 4],
  [-1, 4],
  [-2, 2],
  [4, 2],
  [10, 2],
  [0.1, 4],
  [0.5, 4],
  [1.5, 3],
  [2.5, 2],
  [-0.25, 2],
  [0.3, 2],
  [3.7, 1],
  [1e-3, 1],
  [['Rational', 1, 3], 3],
  [['Rational', 2, 3], 2],
  [['Rational', -5, 7], 2],
  [['Rational', 3, 2], 2],
  [['Rational', 1, 10], 1],
  ['Pi', 3],
  ['ExponentialE', 2],
  ['ImaginaryUnit', 1],
  [['Complex', 1, 2], 1],
  [['Complex', 0.5, -1], 1],
];

function genIndex(ctx: GenContext): Json {
  const { rng } = ctx;
  return ctx.integers.length > 0 && rng() < 0.3
    ? pick(rng, ctx.integers)
    : pick(rng, [1, 2, 3, -1]);
}

/** A draw: `Random()`, or `Random` of a literal `Interval` or `Range`. */
function genDraw(ctx: GenContext): Json {
  return pick<Json>(ctx.rng, [
    ['Random'],
    ['Random'],
    ['Random', ['Interval', -1, 2]],
    ['Random', ['Interval', 0.5, ['Rational', 7, 3]]],
    ['Random', ['Range', 1, 6]],
    ['Random', ['Range', -2, 8, 2]],
  ]);
}

/** The leaves of `genLeaf()` that read no input: jump functions of the
 *  captured exact values `cr` (1/3) and `crn` (3333333333333333/10^16) and
 *  of closed exact constants, and the remainder by 1 of a symbol of
 *  `ctx`. */
function closedNodes(ctx: GenContext): Json[] {
  return [
    ['Floor', 'cr'],
    ['Ceil', ['Negate', 'cr']],
    ['Sign', 'cr'],
    ['Mod', 'cr', ['Rational', 1, 7]],
    ['Boole', ['Less', 'crn', 'cr']],
    ['If', ['Less', 'crn', 'cr'], 1, -1],
    ['Floor', ['Divide', ['Add', ['Factorial', 25], -1], ['Factorial', 24]]],
    ['Fract', ['Multiply', 'Pi', ['Power', 10, 30]]],
    ['Truncate', ['Rational', -7, 2]],
    ['Mod', choose(ctx.rng, ctx.symbols), 1],
    ['At', 'CL', genIndex(ctx)],
  ];
}

function genLeaf(ctx: GenContext): Json {
  const { rng } = ctx;
  if (ctx.random && rng() < 0.12) return genDraw(ctx);
  if (ctx.host && rng() < 0.12) return pick(rng, ['vr', 'vr', 'vu', 'vz']);
  // A node that reads no input (a jump function of captured exact values,
  // which the existing compiler folds), or `Mod(v, 1)`.
  if (rng() < 0.03) return pick(rng, closedNodes(ctx));
  if (rng() < 0.55) {
    if (ctx.lists.length > 0 && rng() < 0.08) {
      const list = pick(rng, ctx.lists);
      if (rng() < 0.25) return ['Length', list];
      return ['At', list, genIndex(ctx)];
    }
    return choose(rng, ctx.symbols);
  }
  return choose(rng, LITERALS);
}

const UNARY = [
  'Sin',
  'Cos',
  'Tan',
  'Exp',
  'Ln',
  'Log',
  'Arctan',
  'Tanh',
  'Sinh',
  'Cosh',
  'Arcsin',
  'Arccos',
  'Arsinh',
  'Arcosh',
  'Artanh',
  'Sign',
  'Erf',
  'Erfc',
  'Gamma',
  'Cot',
  'Sec',
  'Csc',
  'Digamma',
  'Haversine',
  'Conjugate',
  'Abs',
  'Floor',
  'Ceil',
  'Round',
  'Sqrt',
  'Factorial',
  'Factorial2',
  'Arccot',
  'Arccsc',
  'Arcsec',
  'Arcoth',
  'Arsech',
  'Arcsch',
  'Coth',
  'Sech',
  'Csch',
  'Truncate',
  'Fract',
];

const EXPONENTS: readonly (readonly [Json | 'gen', number])[] = [
  [2, 8],
  [3, 5],
  [4, 3],
  [5, 2],
  [6, 1],
  [-1, 4],
  [-2, 4],
  [-3, 2],
  [0.5, 2],
  [1.5, 3],
  [1.1, 2],
  [1.6, 2],
  [-0.95, 1],
  [['Rational', 5, 2], 2],
  [['Rational', 1, 3], 1],
  [['Rational', 8, 5], 1],
  [['Rational', 2, 3], 1],
  [10, 1],
  ['gen', 5],
];

type Head =
  | 'Add'
  | 'Multiply'
  | 'Divide'
  | 'Negate'
  | 'Subtract'
  | 'Power'
  | 'Root'
  | 'Unary'
  | 'MinMax'
  | 'Mod'
  | 'Arctan2'
  | 'Hypot'
  | 'LogBase'
  | 'If'
  | 'Which'
  | 'BigOp'
  | 'Call'
  | 'ImaginaryTimes'
  | 'Comprehension'
  | 'QuotientFactor'
  | 'ValueBlock'
  | 'Collection'
  | 'Special';

const HEADS: readonly (readonly [Head, number])[] = [
  ['Add', 16],
  ['Multiply', 16],
  ['Divide', 12],
  ['Negate', 4],
  ['Subtract', 5],
  ['Power', 10],
  ['Root', 2],
  ['Unary', 14],
  ['MinMax', 3],
  ['Mod', 2],
  ['Arctan2', 1],
  ['Hypot', 1],
  ['LogBase', 1],
  ['If', 3],
  ['Which', 2],
  ['BigOp', 3],
  ['Call', 5],
  ['ImaginaryTimes', 1],
  ['Comprehension', 1],
  ['QuotientFactor', 3],
  ['ValueBlock', 2],
  ['Collection', 6],
  ['Special', 4],
];

/** The heads of real calls (`REAL_CALL_HEADS` in
 *  `javascript-fragment-target.ts`) and their numbers of operands: special
 *  functions, number theory, `Real`, `Imaginary`, `Argument`, `Clamp`,
 *  `KroneckerDelta`, `Boole` (a condition) and `Gamma` of two operands.
 *  `order`: the first operand is a small literal, as the kernels of the
 *  Bessel functions, of `Gamma(s, z)` and of `Zeta(s, a)` do not end for an
 *  order of a magnitude near `2^53` or `1e300` (a known limitation of the
 *  existing compiler, docs/COMPILATION-MODEL.md). */
const SPECIAL: readonly (readonly [string, readonly number[], 'order'?])[] = [
  ['Heaviside', [1]],
  ['GammaLn', [1]],
  ['Sinc', [1]],
  ['Erfi', [1]],
  ['ErfInv', [1]],
  ['Trigamma', [1]],
  ['FresnelS', [1]],
  ['FresnelC', [1]],
  ['SinIntegral', [1]],
  ['CosIntegral', [1]],
  ['ExpIntegralEi', [1]],
  ['LogIntegral', [1]],
  ['DirichletEta', [1]],
  ['DirichletBeta', [1]],
  ['Zeta', [1, 2], 'order'],
  ['StieltjesGamma', [1, 2]],
  ['LambertW', [1]],
  ['EllipticK', [1]],
  ['EllipticE', [1, 2]],
  ['Chop', [1]],
  ['Real', [1]],
  ['Imaginary', [1]],
  ['Argument', [1]],
  ['KroneckerDelta', [1, 2, 3]],
  ['GammaRegularized', [2]],
  ['Gamma', [2], 'order'],
  ['Beta', [2]],
  ['Binomial', [2]],
  ['ClausenCl', [2]],
  ['EllipticF', [2]],
  ['EllipticPi', [2]],
  ['BesselJ', [2], 'order'],
  ['BesselI', [2], 'order'],
  ['AGM', [1, 2]],
  ['PolyGamma', [2]],
  ['HurwitzZeta', [2], 'order'],
  ['PolyLog', [2]],
  ['Remainder', [2]],
  ['GCD', [2, 3]],
  ['LCM', [2]],
  ['Clamp', [3]],
  ['Boole', [1]],
];

/** The exact rationals of a quotient factor (`QuotientFactor`). */
const RATIONALS: readonly Json[] = [
  ['Rational', 1, 3],
  ['Rational', 1, 7],
  ['Rational', 2, 3],
  ['Rational', -1, 3],
  ['Rational', 1, 2],
];

function genReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const leaf = depth === 0 ? 0.05 : 0.2 + (0.6 * depth) / ctx.maxDepth;
  if (depth >= ctx.maxDepth || rng() < leaf) return genLeaf(ctx);
  const d = depth + 1;
  const sub = () => genReal(ctx, d);
  if (ctx.host && rng() < 0.08)
    return pick<() => Json>(rng, [
      () => ['hp', sub()],
      () => ['hd', sub()],
      () => ['hq', sub(), sub()],
      () => ['ho', sub()],
      () => ['hm', sub()],
    ])();
  if (ctx.random && rng() < 0.06)
    return [
      'WithRandomSeed',
      pick<Json>(rng, [3, 42, "'seed'", 'k', 'x', ['Add', 'k', 1]]),
      sub(),
    ];
  if (ctx.calculus && rng() < 0.08) return genCalculus(ctx, d);
  switch (choose(rng, HEADS)) {
    case 'Add':
      return ['Add', ...Array.from({ length: intBetween(rng, 2, 3) }, sub)];
    case 'Multiply':
      return [
        'Multiply',
        ...Array.from({ length: intBetween(rng, 2, 3) }, sub),
      ];
    case 'Divide':
      return ['Divide', sub(), sub()];
    case 'Negate':
      return ['Negate', sub()];
    case 'Subtract':
      return ['Subtract', sub(), sub()];
    case 'Power': {
      const e = choose(rng, EXPONENTS);
      if (e !== 'gen') return ['Power', sub(), e];
      const exponent =
        rng() < 0.5
          ? choose(rng, ctx.symbols)
          : rng() < 0.5 && ctx.integers.length > 0
            ? pick(rng, ctx.integers)
            : sub();
      return ['Power', sub(), exponent];
    }
    case 'Root':
      return [
        'Root',
        sub(),
        pick(rng, [3, 3, 4, 2, ...ctx.integers] as Json[]),
      ];
    case 'Unary':
      return [pick(rng, UNARY), sub()];
    case 'MinMax':
      return [
        pick(rng, ['Min', 'Max']),
        ...Array.from({ length: intBetween(rng, 2, 3) }, sub),
      ];
    case 'Mod':
      return ['Mod', sub(), rng() < 0.6 ? pick(rng, [2, 3, 1, 0.5]) : sub()];
    case 'Arctan2':
      return ['Arctan2', sub(), sub()];
    case 'Hypot':
      return ['Hypot', sub(), sub()];
    case 'LogBase':
      return [
        'Log',
        sub(),
        rng() < 0.6 ? pick(rng, [2, 10, 3]) : choose(rng, ctx.symbols),
      ];
    case 'If':
      return ['If', genCondition(ctx, d), sub(), sub()];
    case 'Which': {
      const clauses: Json[] = [genCondition(ctx, d), sub()];
      if (rng() < 0.5) clauses.push(genCondition(ctx, d), sub());
      if (rng() < 0.6) clauses.push('True', sub());
      return ['Which', ...clauses];
    }
    case 'BigOp':
      return genBigOp(ctx, d);
    case 'Call': {
      if (ctx.localFunctions !== undefined && ctx.localFunctions.length > 0 && rng() < 0.6)
        return [pick(rng, ctx.localFunctions), sub()];
      const helper =
        ctx.random && rng() < 0.4
          ? pick(rng, RANDOM_HELPERS)
          : pick(rng, HELPERS);
      return [
        helper.name,
        ...helper.arguments.map((kind): Json =>
          kind === 'real'
            ? sub()
            : kind === 'boolean'
              ? genCondition(ctx, d)
              : ctx.integers.length > 0 && rng() < 0.6
                ? pick(rng, ctx.integers)
                : pick(rng, [0, 1, 2, -3])
        ),
      ];
    }
    case 'ImaginaryTimes':
      return ['Multiply', 'ImaginaryUnit', sub()];
    case 'Comprehension':
      return ['At', genComprehension(ctx, d), genIndex(ctx)];
    case 'QuotientFactor':
      return genQuotientFactor(ctx, d);
    case 'ValueBlock':
      return genValueBlock(ctx, d);
    case 'Collection':
      return genCollectionReal(ctx, d);
    case 'Special': {
      const [head, arities, order] = pick(rng, SPECIAL);
      const n = pick(rng, arities as number[]);
      if (head === 'Boole') return [head, genCondition(ctx, d)];
      if (order === 'order' && n === 2)
        return [head, pick<Json>(rng, [0, 1, 2, 3, -1, 0.5, 2.5]), sub()];
      // An order or an integer operand: an integer literal or an integer
      // input, at times.
      const operand = (): Json =>
        ctx.integers.length > 0 && rng() < 0.25
          ? pick(rng, ctx.integers)
          : rng() < 0.15
            ? pick<Json>(rng, [0, 1, 2, -1, 3, 0.5])
            : sub();
      return [head, ...Array.from({ length: n }, operand)];
    }
  }
}

/** The elementary integrands of `genCalculus()`, as functions of their
 *  variable: each has a closed form that the engine finds. */
const INTEGRANDS: readonly ((v: Json) => Json)[] = [
  (v) => ['Power', v, 2],
  (v) => ['Sin', v],
  (v) => ['Exp', v],
  (v) => ['Multiply', v, ['Cos', v]],
  (v) => ['Divide', 1, ['Add', 1, ['Power', v, 2]]],
  (v) => ['Exp', ['Negate', ['Power', v, 2]]],
  (v) => ['Add', ['Power', v, 3], ['Multiply', 2, v]],
];

/** Integrands with no closed form that the engine finds, as functions of
 *  their variable (`genQuadrature()`). */
const QUADRATURE_INTEGRANDS: readonly ((v: Json) => Json)[] = [
  (v) => ['Sqrt', ['Add', 1, ['Power', v, 4]]],
  (v) => ['Sin', ['Power', v, 3]],
  (v) => ['Exp', ['Negate', ['Power', v, 4]]],
  (v) => ['Divide', 1, ['Add', 2, ['Cos', ['Power', v, 3]]]],
];

/**
 * A definite `Integrate` that the existing compiler integrates numerically
 * (`--calculus`): an integrand with no closed form in `t`, at times added
 * to or multiplied by an expression of the program that reads `t`
 * (`genReal()`), with bounds that are literals or `2·arctan` of a leaf, in
 * either order; `e^{-t⁴}` alone from or to `±∞`; or two clauses whose inner
 * bound reads the outer variable; or an integral in the integrand of
 * another one.
 *
 * An integral that does not converge makes the runtime sample 10⁷ points
 * at each call (the Monte Carlo fallback), so a bound that reads an input
 * stays in (−π, π) (`sin(t³)` up to a large input does not converge), an
 * infinite bound has the decaying integrand only, and an expression of the
 * program, which can have a pole, is in one integrand in four.
 */
function genQuadrature(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const body = (v: string): Json => {
    const base = pick(rng, QUADRATURE_INTEGRANDS)(v);
    if (rng() < 0.75) return base;
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, [v, 40]] };
    return [rng() < 0.5 ? 'Add' : 'Multiply', base, genReal(inner, d)];
  };
  const bound = (): Json =>
    rng() < 0.4
      ? pick<Json>(rng, [0, 1, -1, 2, 0.5])
      : ['Multiply', 2, ['Arctan', genLeaf(ctx)]];
  const r = rng();
  if (r < 0.1) {
    const decaying = QUADRATURE_INTEGRANDS[2]('t');
    return rng() < 0.5
      ? ['Integrate', decaying, ['Limits', 't', bound(), 'PositiveInfinity']]
      : ['Integrate', decaying, ['Limits', 't', 'NegativeInfinity', bound()]];
  }
  if (r < 0.65)
    return ['Integrate', body('t'), ['Limits', 't', bound(), bound()]];
  if (r < 0.85)
    return [
      'Integrate',
      ['Sin', ['Multiply', 's', ['Power', 't', 3]]],
      ['Limits', 's', pick<Json>(rng, [0, 1]), bound()],
      ['Limits', 't', 0, 's'],
    ];
  return [
    'Integrate',
    ['Integrate', body('s'), ['Limits', 's', 0, 't']],
    ['Limits', 't', pick<Json>(rng, [0, -1]), pick<Json>(rng, [1, 0.5])],
  ];
}

/**
 * A calculus node (`--calculus`): `Integrate` of an elementary integrand in
 * `t`, times a leaf at times, with bounds that are literals or leaves; a
 * definite `Integrate` with no closed form (`genQuadrature()`); `D` of an
 * elementary function of a name of the program in that name; or `Apply` of
 * the derivative, of order 1 or 2, of a literal in `t`.
 */
function genCalculus(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const integrand = (): Json =>
    rng() < 0.3
      ? ['Multiply', genLeaf(ctx), pick(rng, INTEGRANDS)('t')]
      : pick(rng, INTEGRANDS)('t');
  const bound = (): Json =>
    rng() < 0.4 ? pick<Json>(rng, [0, 1, -1, 2]) : genLeaf(ctx);
  const r = rng();
  if (r < 0.2)
    return ['Integrate', integrand(), ['Limits', 't', bound(), bound()]];
  if (r < 0.4) return genQuadrature(ctx, depth);
  if (r < 0.55)
    return [
      'Apply',
      ['Derivative', ['Function', integrand(), 't'], pick(rng, [1, 1, 2])],
      genReal(ctx, depth),
    ];
  if (r < 0.65) {
    const name = choose(rng, ctx.symbols);
    return ['D', pick(rng, INTEGRANDS)(name), name];
  }
  if (r < 0.77) return genNumericDerivative(ctx, depth);
  if (r < 0.89) return genLimit(ctx, depth);
  return genLogSpaceIntegral(ctx, depth);
}

/** Functions with no derivative rule, as functions of their variable
 *  (`genNumericDerivative()`): `ζ` away from its pole at 1. */
const NO_DERIVATIVE: readonly ((v: Json) => Json)[] = [
  (v) => ['Zeta', ['Add', 2, ['Power', v, 2]]],
  (v) => ['Multiply', v, ['Zeta', ['Add', 3, ['Sin', v]]]],
];

/**
 * A derivative with no closed form (`--calculus`), which the existing
 * compiler computes with the stencil `_SYS.nd` and the profile with the
 * routine `derivative`: `D` of a function with no derivative rule of a
 * name of the program, at times times an expression of the program in the
 * name; `ND` of such a literal in `t` at an expression; or `Apply` of its
 * `Derivative` of order 1 or 2. The stencil samples about 20 points.
 */
function genNumericDerivative(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const body = (v: string): Json => {
    const base = pick(rng, NO_DERIVATIVE)(v);
    if (rng() < 0.6) return base;
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, [v, 40]] };
    return [rng() < 0.5 ? 'Add' : 'Multiply', base, genReal(inner, d)];
  };
  const r = rng();
  if (r < 0.35) {
    const name = choose(rng, ctx.symbols);
    return ['D', body(name), name];
  }
  if (r < 0.7)
    return ['ND', ['Function', body('t'), 't'], genReal(ctx, d)];
  return [
    'Apply',
    ['Derivative', ['Function', body('t'), 't'], pick(rng, [1, 2])],
    genReal(ctx, d),
  ];
}

/**
 * A `Limit` (`--calculus`), which the existing compiler with
 * `constantFold: false` computes with `_SYS.limit` and the profile with
 * the routine `limit`: a removable singularity at a point, a ratio at
 * `±∞`, or an expression of the program in `t`, at a literal, an
 * expression or `±∞`, at times from one side or both. The extrapolation
 * samples a bounded number of points, also when it does not converge.
 */
function genLimit(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['t', 40]] };
  const r = rng();
  const body: Json =
    r < 0.3
      ? ['Divide', ['Sin', ['Multiply', genLeaf(ctx), 't']], 't']
      : r < 0.5
        ? ['Divide', ['Add', ['Exp', 't'], -1], 't']
        : r < 0.65
          ? ['Divide', ['Add', genLeaf(ctx), 't'], ['Add', 1, ['Abs', 't']]]
          : genReal(inner, d);
  const point: Json =
    rng() < 0.4
      ? pick<Json>(rng, [0, 1, 'PositiveInfinity', 'NegativeInfinity'])
      : genReal(ctx, d);
  const node: Json[] = ['Limit', ['Function', body, 't'], point];
  if (rng() < 0.3) node.push(pick(rng, [-1, 0, 1]));
  return node;
}

/**
 * An integral whose integrand the existing compiler computes again in log
 * space where its value is not finite (`--calculus`; `logSpaceProduct()`):
 * `t^p · e^{-c t}` with a positive exponent (a literal or `2 + arctan² of
 * a leaf`), from 0 to a positive bound, so that it converges.
 */
function genLogSpaceIntegral(ctx: GenContext, _depth: number): Json {
  const { rng } = ctx;
  const exponent: Json =
    rng() < 0.5
      ? pick<Json>(rng, [3, 2.5, 60, 100])
      : ['Add', 2, ['Power', ['Arctan', genLeaf(ctx)], 2]];
  const rate: Json = pick<Json>(rng, [1, 2, 0.5]);
  const upper: Json =
    rng() < 0.5
      ? pick<Json>(rng, [1, 2, 5])
      : ['Add', 1, ['Power', ['Arctan', genLeaf(ctx)], 2]];
  return [
    'Integrate',
    [
      'Multiply',
      ['Power', 't', exponent],
      ['Exp', ['Negate', ['Multiply', rate, 't']]],
    ],
    ['Limits', 't', 0, upper],
  ];
}

/**
 * A real that reads a list or a tuple: a fold (`Sum`, `Product`, `Max`,
 * `Min`) of a list or a tuple, `At` of one, `Length` of one, or a call of
 * the helper with a list parameter.
 */
function genCollectionReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  if (rng() < 0.15) return genRowReal(ctx, depth);
  if (rng() < 0.45) return genFunctionOfListsReal(ctx, depth);
  // Slice 5 of the broadcast note: `Max` or `Min` of a list and reals,
  // `Equal` or `NotEqual` of two lists as a condition.
  if (rng() < 0.06) {
    const d = Math.min(depth + 1, ctx.maxDepth);
    const l = genList(ctx, d);
    if (rng() < 0.6)
      return [
        pick(rng, ['Max', 'Min']),
        ...(rng() < 0.5 ? [l, genReal(ctx, d)] : [genReal(ctx, d), l]),
        ...(rng() < 0.3 ? [genList(ctx, d)] : []),
      ];
    return [
      'If',
      [pick(rng, ['Equal', 'NotEqual']), l, rng() < 0.5 ? l : genList(ctx, d)],
      genReal(ctx, d),
      genReal(ctx, d),
    ];
  }
  // A list of booleans, a comparison of a list, read by `Length` and by
  // `At` in a condition (slice 2 of the broadcast note).
  if (rng() < 0.06) {
    const d = Math.min(depth + 1, ctx.maxDepth);
    const compare: Json = [
      pick(rng, ['Less', 'GreaterEqual', 'Equal']),
      genList(ctx, d),
      genReal(ctx, d),
    ];
    return rng() < 0.4
      ? ['Length', compare]
      : ['If', ['At', compare, genIndex(ctx)], genReal(ctx, d), genReal(ctx, d)];
  }
  if ((ctx.tupleLists?.length ?? 0) > 0 && rng() < 0.2) {
    const d = Math.min(depth + 1, ctx.maxDepth);
    const r = rng();
    if (r < 0.3) return [pick(rng, ['Length', 'Count']), genTupleList(ctx, d)];
    if (r < 0.6)
      return ['Count', genTupleList(ctx, d), genTupleLambda(ctx, depth, true)];
    return ['At', genTuple(ctx, depth), pick(rng, [1, 2, -1])];
  }
  const r = rng();
  const collection = (): Json =>
    rng() < 0.75 ? genList(ctx, depth) : genTuple(ctx, depth);
  if (r < 0.45)
    return [pick(rng, ['Sum', 'Sum', 'Product', 'Max', 'Min']), collection()];
  if (r < 0.7) return ['At', collection(), genIndex(ctx)];
  if (r < 0.8) return ['Length', collection()];
  if (r < 0.9)
    return [
      pick(rng, SLICE_HELPERS.slice(0, 5)).name,
      genReal(ctx, Math.min(depth + 1, ctx.maxDepth)),
    ];
  return [LIST_PARAMETER_HELPER.name, genList(ctx, depth)];
}

/**
 * A list of reals or of integers: a list name, a list literal (of 0 to 3
 * elements), an operator applied to its elements (a list and reals; two
 * lists only when they are the same expression, whose lengths are equal by
 * construction), a comprehension with or without a guard, or a call of a
 * helper whose result is a list.
 */
function genList(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const sub = () => genReal(ctx, d);
  if (depth >= ctx.maxDepth || rng() < 0.3) {
    if (ctx.lists.length > 0 && rng() < 0.7) return pick(rng, ctx.lists);
    return ['List', ...Array.from({ length: intBetween(rng, 0, 3) }, sub)];
  }
  if (rng() < 0.35) return genFunctionOfListsList(ctx, depth);
  // A row read of a list of lists, which most operators of a list decline
  // (it is `undefined` for an index out of range).
  if (rng() < 0.04) return ['At', genRows(ctx, d), genIndex(ctx)];
  const r = rng();
  const list = () => genList(ctx, d);
  if (r < 0.15)
    return ['List', ...Array.from({ length: intBetween(rng, 1, 3) }, sub)];
  if (r < 0.3) {
    const ops = [list(), sub()];
    if (rng() < 0.3) ops.push(sub());
    if (rng() < 0.5) ops.reverse();
    return ['Add', ...ops];
  }
  if (r < 0.42) {
    const ops = [sub(), list()];
    if (rng() < 0.5) ops.reverse();
    return ['Multiply', ...ops];
  }
  if (r < 0.48) return ['Negate', list()];
  if (r < 0.56)
    return rng() < 0.5 ? ['Divide', list(), sub()] : ['Divide', sub(), list()];
  if (r < 0.64) {
    const l = list();
    return [pick(rng, ['Add', 'Multiply', 'Subtract']), l, l];
  }
  // Slices 1 and 2 of the broadcast note: a scalar head applied to each
  // element of a list (and of a list beside itself), a comparison of a list
  // as the condition of an element-wise `If` or `Which`, whose arms are the
  // same list or reals.
  if (r < 0.7) return genBroadcastList(ctx, depth);
  if (r < 0.84) {
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['j', 30]] };
    const spec: Json[] = ['Element', 'j', ['Range', pick(rng, [1, 1, 0, 3]), intBetween(rng, 0, 5)]];
    if (rng() < 0.7) spec.push(genCondition(inner, d));
    return ['Comprehension', genReal(inner, d), spec];
  }
  if (rng() < 0.3) return [SLICE_HELPERS[5].name, sub()];
  const helper = pick(rng, COLLECTION_HELPERS.slice(0, 2));
  return [
    helper.name,
    helper.arguments[0] === 'real'
      ? sub()
      : ctx.integers.length > 0 && rng() < 0.6
        ? pick(rng, ctx.integers)
        : pick(rng, [0, 1, 3, 5]),
  ];
}

/** The scalar heads of one operand that the structured route applies to each
 *  element of a list (`broadcastRule()`), and some that it declines
 *  (`Arcsin`, `Sech`). */
const BROADCAST_UNARY = [
  'Sqrt', 'Ln', 'Exp', 'Sin', 'Cos', 'Tan', 'Tanh', 'Arctan', 'Abs', 'Sign',
  'Floor', 'Ceil', 'Round', 'Truncate', 'Gamma', 'Erf', 'Factorial', 'Coth',
  'Arccot', 'Haversine', 'Lb', 'Lg', 'Heaviside', 'Arcsin', 'Sech',
];
/** The scalar heads of two operands of `broadcastRule()`. */
const BROADCAST_BINARY = [
  'Power', 'Root', 'Log', 'Mod', 'Arctan2', 'Hypot', 'Remainder', 'Binomial',
];

/**
 * A list made by an element-wise head (slices 1 and 2 of
 * `docs/plans/2026-11-12-structured-broadcast-over-lists.md`): a scalar
 * head of a list, of a list and a real (in either order, a literal
 * exponent such as `3` or `1/3` too), of a list and the same list, or an
 * element-wise `If` or `Which` whose conditions compare one list (with
 * `Not`, `And` and `Or`) and whose arms are that list, an element-wise
 * function of it, or reals.
 */
function genBroadcastList(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const sub = () => genReal(ctx, d);
  const list = () => genList(ctx, d);
  const r = rng();
  // Slices 3 and 4 of the broadcast note: a helper of real or integer
  // parameters applied to each element of a list (one list, the list twice,
  // the list and reals), and a `Sum` or a `Product` of a list body over a
  // literal range (sometimes empty: a decline).
  if (r < 0.12) {
    const helper = pick(
      rng,
      HELPERS.filter((h) => h.arguments.every((k) => k !== 'boolean'))
    );
    const l = list();
    const at = Math.floor(rng() * helper.arguments.length);
    return [
      helper.name,
      ...helper.arguments.map((kind, i): Json =>
        i === at || rng() < 0.2 ? l : kind === 'real' ? sub() : pick(rng, [0, 1, 2, -3])
      ),
    ];
  }
  if (r < 0.2) {
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['k', 30]] };
    const l = genList(ctx, d);
    const term: Json =
      rng() < 0.4
        ? ['Multiply', l, 'k']
        : rng() < 0.6
          ? ['Add', l, 'k']
          : rng() < 0.7
            ? l
            : ['Add', l, genReal(inner, d)];
    const [a, b] = pick(rng, [[1, 3], [0, 2], [1, 1], [-1, 2], [3, 1]] as [number, number][]);
    return [pick(rng, ['Sum', 'Sum', 'Product']), term, ['Limits', 'k', a, b]];
  }
  if (r < 0.35) return [pick(rng, BROADCAST_UNARY), list()];
  if (r < 0.6) {
    const head = pick(rng, BROADCAST_BINARY);
    const l = list();
    const other: Json =
      rng() < 0.2
        ? l
        : rng() < 0.4
          ? pick(rng, [3, 2, -1, 0.5, ['Rational', 1, 3]] as Json[])
          : sub();
    return rng() < 0.5 ? [head, l, other] : [head, other, l];
  }
  // A selection over one list `l`.
  const l = list();
  const compare = (): Json => {
    const c: Json = [
      pick(rng, ['Less', 'LessEqual', 'Greater', 'GreaterEqual', 'Equal', 'NotEqual']),
      l,
      rng() < 0.2 ? l : sub(),
    ];
    const q = rng();
    if (q < 0.15) return ['Not', c];
    if (q < 0.3) return [pick(rng, ['And', 'Or']), c, [pick(rng, ['Less', 'Greater']), l, sub()]];
    return c;
  };
  const arm = (): Json => {
    const q = rng();
    if (q < 0.35) return l;
    if (q < 0.5) return [pick(rng, ['Sqrt', 'Abs', 'Negate', 'Sin']), l];
    if (q < 0.65) return ['Add', l, sub()];
    return sub();
  };
  const q = rng();
  if (q < 0.5) return ['If', compare(), arm(), arm()];
  if (q < 0.65) return ['If', compare(), arm()];
  const clauses: Json[] = [compare(), arm(), compare(), arm()];
  if (rng() < 0.7) clauses.push('True', arm());
  return ['Which', ...clauses];
}

/** The counts of `Take` and `Drop`: in and out of the range of a short
 *  list, negative, zero. */
const COUNTS: readonly Json[] = [0, 1, 2, -1, -2, 5, -5];

/**
 * A function literal of the parameters `names` whose body is a real that
 * reads them (`genReal()` with the parameters as symbols), or a condition
 * with `predicate`. The names are new at each depth (`e0`, `a0`, `e1`, …),
 * so that a nested literal does not reuse the name of an outer one.
 */
function genLambda(
  ctx: GenContext,
  depth: number,
  names: readonly string[],
  predicate = false
): Json {
  const inner: GenContext = {
    ...ctx,
    symbols: [...ctx.symbols, ...names.map((n): [Json, number] => [n, 30])],
  };
  const d = Math.min(depth + 1, ctx.maxDepth);
  return [
    'Function',
    predicate ? genCondition(inner, d) : genReal(inner, d),
    ...names,
  ];
}

/** A function operand of `Map`: a function literal of one parameter, a
 *  library operator, or a helper of one real parameter (`HELPERS`). */
function genMapFunction(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  if (rng() < 0.1) return pick(rng, ['fd', 'fi']);
  if (rng() < 0.35)
    return pick(rng, [
      'Sin', 'Cos', 'Exp', 'Sqrt', 'Abs', 'Negate', 'Floor', 'Ln', 'Tanh',
      'Arctan', 'Sign', 'Erf', 'Gamma', 'Tan', 'Ceil', 'Round',
      'Factorial', 'Truncate', 'Coth', 'Arccot', 'Arcsch', 'Fract',
    ]);
  return genLambda(ctx, depth, [`e${depth}`]);
}

/** The function operand of `Reduce` and `Scan`: an operator, or a function
 *  literal of the accumulator and the element. */
function genFoldFunction(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  if (rng() < 0.5)
    return pick(rng, ['Add', 'Add', 'Multiply', 'Max', 'Min', 'Subtract']);
  if (rng() < 0.15) return FUNCTION_OPERAND_HELPERS[0].name;
  return genLambda(ctx, depth, [`a${depth}`, `e${depth}`]);
}

/**
 * A real computed by a function of lists or with a function operand (slices
 * 2 and 3 of the collections note): `Norm`, `Mean`, `Median`, `Variance`,
 * `Dot`, `First`, `Last`, `Count` of a list or a tuple; `Reduce` by an
 * operator or a function literal, with and without an initial value;
 * `Count` with a predicate; `At` of a `Map`, a `Filter` or a `Scan`;
 * `Apply` of a function literal.
 */
function genFunctionOfListsReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const list = () => genList(ctx, d);
  const collection = (): Json => (rng() < 0.75 ? list() : genTuple(ctx, d));
  const r = rng();
  if (r < 0.2)
    return [
      pick(rng, ['Norm', 'Mean', 'Median', 'Variance', 'First', 'Last', 'Count']),
      collection(),
    ];
  if (r < 0.28) {
    if (rng() < 0.5) {
      const l = list();
      return ['Dot', l, rng() < 0.5 ? l : ['Reverse', l]];
    }
    if (rng() < 0.4) {
      // Tuples of four to six reals: the existing compiler writes the sum
      // of the products below five elements and `_SYS.matmul` from five on.
      const n = intBetween(rng, 4, 6);
      const tuple = (): Json => [
        'Tuple',
        ...Array.from({ length: n }, () =>
          rng() < 0.3 ? pick(rng, [0, -0, -1]) : genReal(ctx, d)
        ),
      ];
      return ['Dot', tuple(), tuple()];
    }
    return ['Dot', genTuple(ctx, d), genTuple(ctx, d)];
  }
  if (r < 0.5) {
    const op: Json[] = ['Reduce', list(), genFoldFunction(ctx, depth)];
    if (rng() < 0.6) op.push(genReal(ctx, d));
    return op;
  }
  if (r < 0.62)
    return [
      'Count',
      list(),
      rng() < 0.15
        ? FUNCTION_OPERAND_HELPERS[1].name
        : genLambda(ctx, depth, [`e${depth}`], true),
    ];
  if (r < 0.8) return ['At', genFunctionOfListsList(ctx, depth), genIndex(ctx)];
  if (r < 0.88) return genFlatListReal(ctx, depth);
  const n = intBetween(rng, 1, 2);
  return [
    'Apply',
    genLambda(
      ctx,
      depth,
      Array.from({ length: n }, (_, i) => `e${depth}${i === 0 ? '' : 'b'}`)
    ),
    ...Array.from({ length: n }, () => genReal(ctx, d)),
  ];
}

/** The real indexes and counts of `At`, `Take` and `Drop` (row 3 of the
 *  decline census): fractions, halves of both signs, `0`, out of range. */
const REAL_INDEXES: readonly Json[] = [1.5, -1.5, 2.5, -2.5, 0.4, 0, 2, 9];

/**
 * A real computed by a function of flat lists of row 3 of the decline
 * census (`docs/plans/2026-11-11-js-profile-decline-census.md`): the
 * statistics, `IndexOf`, `Second`, `Third`, `Find`, `IndexWhere`, `CountIf`
 * with a predicate literal, `At` with a real index, a fold of a gather.
 */
function genFlatListReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const list = () => genList(ctx, d);
  const predicate = () => genLambda(ctx, depth, [`e${depth}`], true);
  const r = rng();
  if (r < 0.25)
    return [
      pick(rng, [
        'PopulationVariance', 'StandardDeviation', 'PopulationStandardDeviation',
        'Skewness', 'Kurtosis', 'Mode', 'InterquartileRange', 'Second', 'Third',
      ]),
      list(),
    ];
  if (r < 0.32) {
    const l = list();
    return [pick(rng, ['Covariance', 'Correlation']), l, rng() < 0.5 ? l : ['Reverse', l]];
  }
  if (r < 0.42) return ['IndexOf', list(), rng() < 0.5 ? pick(rng, [0, -0, 1, 2]) : genReal(ctx, d)];
  if (r < 0.62) return [pick(rng, ['Find', 'IndexWhere', 'CountIf']), list(), predicate()];
  if (r < 0.8)
    return ['At', list(), rng() < 0.5 || ctx.reals.length === 0 ? pick(rng, REAL_INDEXES) : pick(rng, ctx.reals)];
  return [
    pick(rng, ['Sum', 'Product', 'Max', 'Min', 'Mean', 'Length']),
    ['At', list(), rng() < 0.5 ? ['Range', pick(rng, [1, 2, -1]), pick(rng, [1, 3, -2])] : ['List', genIndex(ctx), genIndex(ctx)]],
  ];
}

/**
 * A list computed by a function of flat lists of row 3 of the decline
 * census: `Ordering`, `Unique`, `Most`, `Append`, `Repeat`, `Linspace`,
 * `Slice`, `Position`, `TakeWhile`, `DropWhile`, `Tabulate`, a gather, and
 * `Take` and `Drop` of a real count.
 */
function genFlatListList(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const list = () => genList(ctx, d);
  const count = (): Json =>
    ctx.integers.length > 0 && rng() < 0.3
      ? ['Min', pick(rng, ctx.integers), 4]
      : pick(rng, [0, 1, 3, -1]);
  const r = rng();
  if (r < 0.15) return [pick(rng, ['Ordering', 'Unique', 'Most']), list()];
  if (r < 0.22) return ['Append', list(), genReal(ctx, d)];
  if (r < 0.3) return ['Repeat', genReal(ctx, d), count()];
  if (r < 0.36) return ['Linspace', pick(rng, [0, -1, 0.5]), pick(rng, [1, 3, -2]), count()];
  if (r < 0.46)
    return ['Slice', list(), pick<Json>(rng, [1, 2, -1, 0, 1.5]), pick<Json>(rng, [1, 3, -1, 9, 2.5])];
  if (r < 0.66)
    return [pick(rng, ['Position', 'TakeWhile', 'DropWhile']), list(), genLambda(ctx, depth, [`e${depth}`], true)];
  if (r < 0.74) return ['Tabulate', genLambda(ctx, depth, [`e${depth}`]), count()];
  if (r < 0.86)
    return ['At', list(), rng() < 0.5 ? ['Range', pick(rng, [1, 2, -1]), pick(rng, [1, 3, -2])] : ['List', genIndex(ctx), genIndex(ctx)]];
  return [pick(rng, ['Take', 'Drop']), list(), rng() < 0.5 || ctx.reals.length === 0 ? pick(rng, REAL_INDEXES) : pick(rng, ctx.reals)];
}

/**
 * A list computed by a function of lists or with a function operand:
 * `Take`, `Drop` (counts of `COUNTS` or an integer input), `Rest`,
 * `Reverse`, `Sort`, `Join`, `Range` (small literal or clamped bounds),
 * `Map` of a function literal or an operator, `Filter`, `Scan`.
 */
function genFunctionOfListsList(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const list = () => genList(ctx, d);
  const r = rng();
  if (r < 0.15)
    return [
      pick(rng, ['Take', 'Drop']),
      list(),
      ctx.integers.length > 0 && rng() < 0.3
        ? pick(rng, ctx.integers)
        : pick(rng, COUNTS),
    ];
  if (r < 0.2) return genFlatListList(ctx, depth);
  if (r < 0.25) return [pick(rng, ['Rest', 'Reverse', 'Sort']), list()];
  if (r < 0.32) return ['Join', list(), list()];
  if (r < 0.36) {
    // A rotation by a count of `COUNTS`, an integer input or one.
    const op: Json[] = [pick(rng, ['RotateLeft', 'RotateRight']), list()];
    if (rng() < 0.8)
      op.push(
        ctx.integers.length > 0 && rng() < 0.3
          ? pick(rng, ctx.integers)
          : pick(rng, COUNTS)
      );
    return op;
  }
  if (r < 0.38) {
    // A `Range` with a step: literal or real bounds and a literal step of
    // either sign (a step 0 declines), or an integer input.
    const step: Json =
      ctx.integers.length > 0 && rng() < 0.2
        ? ['Add', ['Min', ['Abs', pick(rng, ctx.integers)], 3], 1]
        : pick(rng, [2, -1, 0.5, -0.25, 0.1, 3, 0]);
    return [
      'Range',
      pick<Json>(rng, [1, 0, -2, 3]),
      rng() < 0.6 || ctx.reals.length === 0
        ? intBetween(rng, -3, 5)
        : ['Min', ['Max', pick(rng, ctx.reals), -4], 4],
      step,
    ];
  }
  if (r < 0.4 && (ctx.tupleLists?.length ?? 0) > 0)
    return ['Map', genTupleLambda(ctx, depth), genTupleList(ctx, d)];
  if (r < 0.4)
    return rng() < 0.3
      ? ['Range', intBetween(rng, -1, 4)]
      : [
          'Range',
          pick(rng, [1, 1, 0, 3, -2]),
          rng() < 0.6 || ctx.integers.length === 0
            ? intBetween(rng, -1, 4)
            : ['Min', pick(rng, ctx.integers), 4],
        ];
  if (r < 0.7)
    return ['Map', genMapFunction(ctx, depth), rng() < 0.85 ? list() : genTuple(ctx, d)];
  if (r < 0.85)
    return [
      'Filter',
      list(),
      rng() < 0.15
        ? FUNCTION_OPERAND_HELPERS[1].name
        : genLambda(ctx, depth, [`e${depth}`], true),
    ];
  const op: Json[] = ['Scan', list(), genFoldFunction(ctx, depth)];
  if (rng() < 0.5) op.push(genReal(ctx, d));
  return op;
}

/** A function literal of one parameter that is a tuple of two reals: its
 *  body reads the elements of the tuple (`At(t, 1)`, `At(t, 2)`); a real,
 *  or a condition with `predicate`. */
function genTupleLambda(ctx: GenContext, depth: number, predicate = false): Json {
  const name = `t${depth}`;
  const inner: GenContext = {
    ...ctx,
    symbols: [
      ...ctx.symbols,
      [['At', name, 1], 25],
      [['At', name, 2], 25],
    ],
  };
  const d = Math.min(depth + 1, ctx.maxDepth);
  return ['Function', predicate ? genCondition(inner, d) : genReal(inner, d), name];
}

/**
 * A list of tuples of two reals: a name, a list literal of tuples, a
 * comprehension of tuples, `Map` of a list of reals to tuples, `Take`,
 * `Drop`, `Reverse`, a rotation, `ListJoin` and `Filter` of a list of
 * tuples.
 */
function genTupleList(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const names = ctx.tupleLists ?? [];
  if (depth >= ctx.maxDepth || rng() < 0.35) {
    if (names.length > 0 && rng() < 0.8) return pick(rng, names);
    return ['List', ...Array.from({ length: intBetween(rng, 0, 3) }, () => ['Tuple', genReal(ctx, d), genReal(ctx, d)] as Json)];
  }
  const list = () => genTupleList(ctx, d);
  const r = rng();
  if (r < 0.15) {
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['j', 30]] };
    return [
      'Comprehension',
      ['Tuple', genReal(inner, d), genReal(inner, d)],
      ['Element', 'j', ['Range', pick(rng, [1, 1, 0]), intBetween(rng, 0, 4)]],
    ];
  }
  if (r < 0.3) {
    const e = `e${depth}`;
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, [e, 30]] };
    return ['Map', ['Function', ['Tuple', genReal(inner, d), e], e], genList(ctx, d)];
  }
  if (r < 0.45)
    return [pick(rng, ['Take', 'Drop']), list(), ctx.integers.length > 0 && rng() < 0.3 ? pick(rng, ctx.integers) : pick(rng, COUNTS)];
  if (r < 0.55) return ['Reverse', list()];
  if (r < 0.65) return [pick(rng, ['RotateLeft', 'RotateRight']), list(), pick(rng, COUNTS)];
  if (r < 0.8) return ['ListJoin', list(), rng() < 0.5 ? list() : ['List', genTuple(ctx, d)]];
  if (r < 0.9) return ['Filter', list(), genTupleLambda(ctx, depth, true)];
  return ['Map', ['Function', ['Tuple', ['At', `t${depth}`, 2], ['At', `t${depth}`, 1]], `t${depth}`], list()];
}

/**
 * A list of lists of reals (slice 1 of
 * `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`): a name
 * of rows (`R`, `MA`, `M2`, `RP`, `MP`), a literal of rows (of different
 * lengths, empty rows), a comprehension of rows, `ReplaceAt` of a row or of
 * an element of a row (an index out of range throws on both compilers),
 * `Take`, `Drop`, `Rest`, `Reverse`, a rotation or a join of rows, an `If`
 * of two, or a literal that holds a row read (`undefined` for an index out
 * of range on both compilers).
 */
function genRows(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const names = ctx.rowLists ?? [];
  const row = (): Json => [
    'List',
    ...Array.from({ length: intBetween(rng, 0, 3) }, () => genReal(ctx, d)),
  ];
  if (depth >= ctx.maxDepth || rng() < 0.35) {
    if (names.length > 0 && rng() < 0.75) return pick(rng, names);
    return ['List', ...Array.from({ length: intBetween(rng, 0, 3) }, row)];
  }
  const rows = () => genRows(ctx, d);
  const r = rng();
  if (r < 0.15) {
    const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['j', 30]] };
    return [
      'Comprehension',
      rng() < 0.3
        ? ['Comprehension', genReal({ ...inner, symbols: [...inner.symbols, ['jj', 30]] }, d), ['Element', 'jj', ['Range', 1, 'j']]]
        : ['List', ...Array.from({ length: intBetween(rng, 1, 3) }, () => genReal(inner, d))],
      ['Element', 'j', ['Range', pick(rng, [1, 1, 0]), intBetween(rng, 0, 4)]],
    ];
  }
  if (r < 0.24) return ['ReplaceAt', rows(), genIndex(ctx), row()];
  // A row read as the row value: a swap of two rows of one list (a name,
  // so that both reads see the same rows).
  if (r < 0.3) {
    const m = names.length > 0 && rng() < 0.8 ? pick(rng, names) : rows();
    const i = genIndex(ctx);
    const j = genIndex(ctx);
    return rng() < 0.6
      ? ['ReplaceAt', ['ReplaceAt', m, i, ['At', m, j]], j, ['At', m, i]]
      : ['ReplaceAt', m, i, ['At', m, j]];
  }
  if (r < 0.45)
    return ['ReplaceAt', rows(), genIndex(ctx), genIndex(ctx), genReal(ctx, d)];
  if (r < 0.55)
    return [
      pick(rng, ['Take', 'Drop']),
      rows(),
      ctx.integers.length > 0 && rng() < 0.3
        ? pick(rng, ctx.integers)
        : pick(rng, COUNTS),
    ];
  if (r < 0.62) return [pick(rng, ['Rest', 'Reverse']), rows()];
  if (r < 0.7)
    return [pick(rng, ['RotateLeft', 'RotateRight']), rows(), pick(rng, COUNTS)];
  if (r < 0.8) return [pick(rng, ['Join', 'ListJoin']), rows(), rows()];
  if (r < 0.9) return ['If', genCondition(ctx, d), rows(), rows()];
  if (r < 0.95) return genMatrixRows(ctx, d);
  return ['List', ['At', rows(), genIndex(ctx)], row()];
}

/** The names of matrices (`MA`, `M2`, `M3`, `MP`) of the context, or a
 *  literal 2×2 matrix when it has none. */
function genMatrix(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const names = (ctx.rowLists ?? []).filter((n) =>
    ['MA', 'M2', 'M3', 'MP'].includes(n)
  );
  if (names.length > 0 && rng() < 0.85) return pick(rng, names);
  const d = Math.min(depth + 1, ctx.maxDepth);
  return [
    'List',
    ['List', genReal(ctx, d), genReal(ctx, d)],
    ['List', genReal(ctx, d), genReal(ctx, d)],
  ];
}

/**
 * A list of lists made by slices 2 to 4 of
 * `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`:
 * element-wise arithmetic with a real or of a name with itself, a matrix
 * function with a matrix result (`Transpose`, `Inverse`, `MatrixPower`,
 * `RowReduce`, `MatrixMultiply`, `Diagonal` of a list), a product of two
 * matrices, and `Map` of a function literal over rows that makes rows.
 * Results that can have no value decline where they are not the value of
 * the program, an operand of a matrix function or the list of `At`.
 */
function genMatrixRows(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const rows = () => genRows(ctx, d);
  const matrix = () => genMatrix(ctx, d);
  const r = rng();
  if (r < 0.12) return ['Add', rows(), genReal(ctx, d)];
  if (r < 0.2) return ['Multiply', genReal(ctx, d), rows()];
  if (r < 0.25) return ['Negate', rows()];
  if (r < 0.3) return ['Divide', rows(), pick(rng, [2, 3, -0.5])];
  if (r < 0.36) {
    const m = matrix();
    return rng() < 0.5 ? ['Add', m, m] : ['Subtract', m, ['Multiply', 2, m]];
  }
  if (r < 0.44) return ['Transpose', matrix()];
  if (r < 0.5) return ['Inverse', matrix()];
  if (r < 0.58)
    return ['MatrixPower', matrix(), pick(rng, [0, 1, 2, 3, -1, ...ctx.integers])];
  if (r < 0.63) return ['RowReduce', matrix()];
  if (r < 0.7) return ['MatrixMultiply', matrix(), matrix()];
  if (r < 0.76) return ['Multiply', matrix(), matrix()];
  if (r < 0.8) return ['Diagonal', genList(ctx, d)];
  const p = `r${depth}`;
  const body: Json[] = [['Multiply', 2, p], ['Add', p, genReal(ctx, d)], ['Negate', p], p];
  return ['Map', ['Function', pick(rng, body), p], rng() < 0.5 ? matrix() : rows()];
}

/** A real that reads a list of lists by slices 2 to 4: the determinant,
 *  the trace or the norm of a matrix (with an order), an element of the
 *  sum of the rows, of a matrix product, of a flattened list, of a
 *  diagonal, of a `Map` over rows, or a matrix function of a matrix that
 *  can have no value. */
function genMatrixReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const matrix = () => genMatrix(ctx, d);
  const r = rng();
  if (r < 0.12) return ['Determinant', matrix()];
  if (r < 0.2) return ['Trace', pick(rng, [matrix(), ['Inverse', matrix()]])];
  if (r < 0.28) return ['Norm', genRows(ctx, d)];
  if (r < 0.34)
    return ['Norm', genRows(ctx, d), pick(rng, [1, 2, 'PositiveInfinity', 0.5])];
  if (r < 0.42) return ['At', ['Sum', matrix()], genIndex(ctx)];
  if (r < 0.48) return ['At', ['Product', matrix()], genIndex(ctx)];
  if (r < 0.56)
    return ['At', ['MatrixMultiply', matrix(), genList(ctx, d)], genIndex(ctx)];
  if (r < 0.62) return ['At', ['Flatten', genRows(ctx, d)], genIndex(ctx)];
  if (r < 0.68) return ['At', ['Diagonal', matrix()], genIndex(ctx)];
  if (r < 0.76) {
    const p = `r${depth}`;
    return [
      'At',
      [
        'Map',
        ['Function', pick(rng, [['Sum', p], ['Length', p], ['Norm', p], ['At', p, 1]]), p],
        genRows(ctx, d),
      ],
      genIndex(ctx),
    ];
  }
  if (r < 0.84) return ['At', genMatrixRows(ctx, d), genIndex(ctx), genIndex(ctx)];
  if (r < 0.92)
    return [
      'Determinant',
      pick<Json>(rng, [
        ['Inverse', matrix()],
        ['Multiply', matrix(), matrix()],
        ['Transpose', matrix()],
      ]),
    ];
  return ['At', ['Dot', matrix(), genList(ctx, d)], genIndex(ctx)];
}

/** A real that reads a list of lists: an element (`At` with two indexes,
 *  or of a row read), the number of rows, or the length of a row read. */
function genRowReal(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const rows = genRows(ctx, Math.min(depth + 1, ctx.maxDepth));
  const r = rng();
  if (r < 0.3) return ['At', rows, genIndex(ctx), genIndex(ctx)];
  if (r < 0.5) return ['At', ['At', rows, genIndex(ctx)], genIndex(ctx)];
  if (r < 0.65) return ['Length', rows];
  if (r < 0.8) return ['Length', ['At', rows, genIndex(ctx)]];
  if (r < 0.88) return ['Count', rows];
  if (r < 0.92) return ['Length', [pick(rng, ['First', 'Last']), rows]];
  return genMatrixReal(ctx, depth);
}

/** A tuple of two reals: a tuple name, a tuple literal, or a call of the
 *  helper whose result is a tuple. */
function genTuple(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = Math.min(depth + 1, ctx.maxDepth);
  const tuples = ctx.tuples ?? [];
  const r = rng();
  if ((ctx.tupleLists?.length ?? 0) > 0 && r < 0.12)
    return rng() < 0.7
      ? ['At', genTupleList(ctx, d), genIndex(ctx)]
      : [pick(rng, ['First', 'Last']), genTupleList(ctx, d)];
  if (tuples.length > 0 && r < 0.5) return pick(rng, tuples);
  if (r < 0.85) return ['Tuple', genReal(ctx, d), genReal(ctx, d)];
  return [COLLECTION_HELPERS[2].name, genReal(ctx, d), genReal(ctx, d)];
}

/** A block used as a value: one or two declarations with a value (a
 *  `where` clause, the only block that the existing compiler admits as an
 *  operand), then a value that reads them. Its locals are named after the
 *  number of value blocks around it, so that no local shadows another. */
function genValueBlock(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const n = ctx.valueBlocks ?? 0;
  const first = `b${2 * n}`;
  const second = `b${2 * n + 1}`;
  const inner = (names: string[]): GenContext => ({
    ...ctx,
    valueBlocks: n + 1,
    symbols: [...ctx.symbols, ...names.map((name): [Json, number] => [name, 30])],
  });
  const d = Math.min(depth + 1, ctx.maxDepth);
  const type = (): Json =>
    pick(rng, ["'real'", "'real'", "'unknown'", "'number'"]);
  const statements: Json[] = [['Declare', first, type(), genReal(ctx, d)]];
  const names = [first];
  if (rng() < 0.3) {
    statements.push(['Declare', second, type(), genReal(inner(names), d)]);
    names.push(second);
  }
  return ['Block', ...statements, genReal(inner(names), d)];
}

/** A product with a quotient factor whose numerator is a product with an
 *  exact rational, a literal or a quotient in turn: the forms that the
 *  existing emitter writes as one chain of `*` and `/`
 *  (`Multiply(q, Divide(Multiply(1/3, 0.1), w))` is `q * 0.1 / 3 / 3`). */
function genQuotientFactor(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const sub = () => genReal(ctx, Math.min(depth + 1, ctx.maxDepth));
  const factor = (): Json =>
    rng() < 0.5 ? choose(rng, LITERALS) : choose(rng, ctx.symbols);
  const product = (): Json => {
    const ops: Json[] = [pick(rng, RATIONALS), factor()];
    if (rng() < 0.3) ops.push(factor());
    return ['Multiply', ...ops];
  };
  let numerator: Json = rng() < 0.7 ? product() : factor();
  if (rng() < 0.3) numerator = ['Divide', numerator, factor()];
  const quotient: Json = ['Divide', numerator, rng() < 0.6 ? factor() : sub()];
  const ops: Json[] = [sub(), quotient];
  if (rng() < 0.3) ops.push(rng() < 0.5 ? sub() : pick(rng, RATIONALS));
  if (rng() < 0.3) ops.reverse();
  return ['Multiply', ...ops];
}

/** A `Comprehension` of a real body over `Range(1, n)`, `n` from 1 to 4. */
function genComprehension(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const inner: GenContext = { ...ctx, symbols: [...ctx.symbols, ['j', 30]] };
  const r = rng();
  // Two generators, the second over a range that can read the first index,
  // with a filter that reads both; or one generator over a list (a literal
  // or a list name), with a filter.
  if (r < 0.2) {
    const both: GenContext = { ...inner, symbols: [...inner.symbols, ['i2', 30]] };
    const second: Json = ['Element', 'i2', ['Range', pick<Json>(rng, [1, 'j']), intBetween(rng, 1, 3)]];
    if (rng() < 0.5) (second as Json[]).push(genCondition(both, ctx.maxDepth));
    return [
      'Comprehension',
      genReal(both, Math.min(depth + 1, ctx.maxDepth)),
      ['Element', 'j', ['Range', 1, intBetween(rng, 1, 3)]],
      second,
    ];
  }
  if (r < 0.3) {
    const source: Json =
      ctx.lists.length > 0 && rng() < 0.6
        ? pick(rng, ctx.lists)
        : ['List', ...Array.from({ length: intBetween(rng, 0, 3) }, () => pick(rng, [0.5, -2, 3, -0]))];
    const clause: Json[] = ['Element', 'j', source];
    if (rng() < 0.4) clause.push(genCondition(inner, ctx.maxDepth));
    return ['Comprehension', genReal(inner, Math.min(depth + 1, ctx.maxDepth)), clause];
  }
  return [
    'Comprehension',
    genReal(inner, Math.min(depth + 1, ctx.maxDepth)),
    ['Element', 'j', ['Range', 1, intBetween(rng, 1, 4)]],
  ];
}

/** A bound of a `Sum` or a `Product`: a literal, a captured number, or an
 *  input clamped so that the range has at most a few terms. */
function genBound(ctx: GenContext, upper: boolean): Json {
  const { rng } = ctx;
  const r = rng();
  if (upper) {
    if (r < 0.45) return intBetween(rng, 0, 5);
    if (r < 0.6) return pick(rng, ['m', 'w', 'h']);
    if (r < 0.8 && ctx.integers.length > 0)
      return ['Min', pick(rng, ctx.integers), 4];
    if (ctx.reals.length > 0)
      return ['Min', ['Floor', pick(rng, ctx.reals)], 4];
    return 'm';
  }
  if (r < 0.75) return pick(rng, [0, 1, 1, 2]);
  if (r < 0.85) return 'g';
  if (ctx.integers.length > 0) return ['Max', pick(rng, ctx.integers), -2];
  return 1;
}

/** A `Sum` or a `Product` over a small range. */
function genBigOp(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const index = 'j';
  const inner: GenContext = {
    ...ctx,
    symbols: [...ctx.symbols, [index, 30]],
  };
  const body = genReal(inner, Math.min(depth + 1, ctx.maxDepth));
  return [
    rng() < 0.7 ? 'Sum' : 'Product',
    body,
    ['Limits', index, genBound(ctx, false), genBound(ctx, true)],
  ];
}

const COMPARISONS = [
  'Less',
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
];

function genCondition(ctx: GenContext, depth: number): Json {
  const { rng } = ctx;
  const d = depth + 1;
  if (ctx.booleans.length > 0 && rng() < 0.15) return pick(rng, ctx.booleans);
  if (depth < ctx.maxDepth && rng() < 0.25) {
    const r = rng();
    if (r < 0.4) return ['And', genCondition(ctx, d), genCondition(ctx, d)];
    if (r < 0.8) return ['Or', genCondition(ctx, d), genCondition(ctx, d)];
    return ['Not', genCondition(ctx, d)];
  }
  // A test of a list (row 3 of the decline census): `Any`, `All` with a
  // predicate literal, `Contains`, `IsEmpty`.
  if (depth < ctx.maxDepth && rng() < 0.06) {
    const list = genList(ctx, d);
    const r = rng();
    if (r < 0.5)
      return [pick(rng, ['Any', 'All']), list, genLambda(ctx, depth, [`e${depth}`], true)];
    if (r < 0.8) return ['Contains', list, rng() < 0.5 ? pick(rng, [0, -0, 1, 2]) : genReal(ctx, d)];
    return ['IsEmpty', list];
  }
  // A comparison with a closed operand: a pole, an infinity, a capture.
  if (rng() < 0.08) {
    const closed = pick(rng, CLOSED_OPERANDS);
    const other = genReal(ctx, d);
    return [
      pick(rng, COMPARISONS),
      ...(rng() < 0.5 ? [closed, other] : [other, closed]),
    ];
  }
  // With `--random` and `--host`, a chain that mixes a draw and a call of
  // a host function declared pure, in any order.
  if (ctx.random && ctx.host && rng() < 0.1) {
    const operands: Json[] = [
      [pick(rng, ['hp', 'hd']), genReal(ctx, d)],
      genDraw(ctx),
      genReal(ctx, d),
    ];
    for (let i = operands.length - 1; i > 0; i--) {
      const j = intBetween(rng, 0, i);
      [operands[i], operands[j]] = [operands[j], operands[i]];
    }
    return [pick(rng, ['Less', 'LessEqual', 'Equal', 'NotEqual']), ...operands];
  }
  // A chain of three or four operands (`a < b <= c` with two heads is an
  // `And` of pairs in the canonical form).
  if (rng() < 0.12)
    return [
      pick(rng, ['Less', 'LessEqual', 'Equal', 'NotEqual']),
      ...Array.from({ length: intBetween(rng, 3, 4) }, () => genReal(ctx, d)),
    ];
  return [pick(rng, COMPARISONS), genReal(ctx, d), genReal(ctx, d)];
}

/** Operands of a comparison that read no input (`genCondition()`). */
const CLOSED_OPERANDS: readonly Json[] = [
  ['Divide', 1, 0],
  ['Multiply', -5, ['Divide', 1, 0]],
  ['Cot', 'Pi'],
  ['Tan', ['Divide', 'Pi', 2]],
  ['Power', 0, -1],
  'PositiveInfinity',
  'NegativeInfinity',
  ['Log', 0],
  ['Multiply', 'w', 'g'],
  ['Sqrt', -2],
];

/** A program: an expression of the free inputs, a `Block` of them, or a
 *  `Function` literal. */
export interface Program {
  readonly id: string;
  readonly json: Json;
  /** For a `Function` literal, the names of its parameters in order. */
  readonly parameters?: readonly string[];
  /** Compiled with the options of the host (`--host`, `HOST_OPTIONS`). */
  readonly host?: boolean;
}

const EXPRESSION_SYMBOLS: readonly (readonly [Json, number])[] = [
  ['x', 25],
  ['y', 15],
  ['k', 10],
  ['p', 8],
  ['q', 4],
  ['u', 10],
  ['xn', 8],
  ['ex', 4],
  ['xi', 4],
  ['z', 4],
  ['h', 4],
  ['m', 2],
  ['cn', 2],
  ['w', 2],
  ['g', 2],
  ['lv', 5],
  ['ec', 3],
  ['cv', 2],
  ['z0', 2],
];

type ContextBase = Omit<GenContext, 'rng' | 'maxDepth'>;

const EXPRESSION_CONTEXT: ContextBase = {
  symbols: EXPRESSION_SYMBOLS,
  integers: ['k'],
  reals: ['x', 'y'],
  booleans: ['B'],
  lists: ['L', 'I', 'LN', 'VN', 'CL', 'lsv'],
  tuples: ['P'],
  tupleLists: ['LQ'],
  rowLists: ['R', 'MA', 'M2', 'M3', 'CM2'],
};

/**
 * The statements of a local list `A` (a list of reals, or of lists of reals)
 * carried by a loop over `kk` that updates it, and a value that reads it,
 * for one block in four: the patterns of `withOwnedCopies()` and of the
 * rules of the rows of `inPlaceUpdates()` (structured-in-place.ts), with the
 * patterns that must copy.
 */
function genCarriedList(
  rng: Rng,
  ctx: GenContext,
  base: ContextBase
): { statements: Json[]; value?: Json } {
  if (rng() >= 0.25) return { statements: [] };
  const rowNames = base.rowLists ?? [];
  const nested = rowNames.length > 0 ? rng() < 0.5 : rng() < 0.25;
  const type = nested ? "'list<list<real>>'" : "'list<real>'";
  const inLoop: GenContext = {
    ...ctx,
    symbols: [...ctx.symbols, ['kk', 20]],
    maxDepth: 1,
  };
  const small = (): Json => (rng() < 0.8 ? genLeaf(inLoop) : genReal(inLoop, 0));
  const condition = (): Json =>
    pick<Json>(rng, [['Less', 'kk', 2], ['Greater', 'kk', 1], ['Less', small(), 0.5]]);
  const statements: Json[] = [];
  // The initial value, which reads no name of the loop.
  const leaf = (): Json => genLeaf({ ...ctx, maxDepth: 1 });
  let initial: Json;
  const r = rng();
  if (nested) {
    const input = rowNames.length > 0 ? pick(rng, rowNames) : undefined;
    if (input !== undefined && r < 0.4) initial = input;
    else if (r < 0.55) initial = ['List', ['List', leaf(), 1], ['List', 2, leaf()]];
    else if (r < 0.7) {
      // A literal or a comprehension that repeats one row.
      statements.push(['Declare', 'r0', "'list<real>'", ['List', 1, leaf()]]);
      initial =
        rng() < 0.5
          ? ['List', 'r0', 'r0']
          : ['Comprehension', 'r0', ['Element', 'j', ['Range', 1, 2]]];
    } else if (input !== undefined && r < 0.85)
      initial = [pick(rng, ['Reverse', 'Rest']), input];
    else if (input !== undefined) initial = ['Take', input, 2];
    else
      initial = [
        'Comprehension',
        ['List', 'j', leaf()],
        ['Element', 'j', ['Range', 1, 3]],
      ];
  } else {
    const lists = base.lists.filter((n) => n !== 'I' && n !== 'W');
    if (lists.length > 0 && r < 0.5) initial = pick(rng, lists);
    else if (rowNames.length > 0 && r < 0.6)
      initial = ['At', pick(rng, rowNames), pick(rng, [1, -1])];
    else if (lists.length > 0 && r < 0.7)
      initial = [pick(rng, ['Reverse', 'Rest']), pick(rng, lists)];
    else if (r < 0.85) initial = ['List', leaf(), 2, leaf()];
    else
      initial = ['Comprehension', ['Multiply', 'j', 0.5], ['Element', 'j', ['Range', 1, 4]]];
  }
  const first = typeof initial === 'string' ? initial : undefined;
  statements.push(['Declare', 'A', type, initial]);
  const alias = rng() < 0.15;
  if (alias) statements.push(['Declare', 'B', type, 'A']);
  // A row of `A` kept in a local before the loop and read after it.
  const keptRow = nested && rng() < 0.15;
  if (keptRow) statements.push(['Declare', 'r1', "'list<real>'", ['At', 'A', 1]]);
  // The update of the body.
  const index = (): Json => pick(rng, ['kk', 'kk', 1, -1]);
  const update = (name: string): Json => {
    if (!nested) {
      const i = index();
      return ['Assign', name, ['ReplaceAt', name, i, ['Add', ['At', name, i], small()]]];
    }
    const i = index();
    const j = pick<Json>(rng, [1, -1]);
    return ['Assign', name, ['ReplaceAt', name, i, j, ['Add', ['At', name, i, j], small()]]];
  };
  const body: Json[] = ['Block'];
  const s = rng();
  if (nested && s < 0.1)
    // A swap of two rows, then an update of an element.
    body.push(['Assign', 'A', ['ReplaceAt', ['ReplaceAt', 'A', 1, ['At', 'A', 2]], 2, ['At', 'A', 1]]]);
  else if (nested && rowNames.length > 0 && s < 0.18)
    // A row of an input written into `A`, then an update of an element.
    body.push(['Assign', 'A', ['ReplaceAt', 'A', 1, ['At', pick(rng, rowNames), 1]]]);
  else if (s < 0.26)
    // A call or a lambda that reads `A` in the pass.
    body.push([
      'Assign',
      't',
      nested
        ? ['Add', 't', ['Reduce', ['At', 'A', 1], 'fe', 0]]
        : pick<Json>(rng, [['fm', 'A'], ['Reduce', 'A', 'fe', 0], ['Sum', ['Map', 'A', ['Function', ['Multiply', 'v', 2], 'v']]]]),
    ]);
  else if (s < 0.34 && first !== undefined)
    // A branch that writes the initial value (an input) to `A`.
    body.push(['If', condition(), ['Assign', 'A', first]]);
  body.push(update('A'));
  if (alias) body.push(update('B'));
  const b = rng();
  if (b < 0.12)
    body.push(['If', condition(), ['Block', update('A'), ['Break']]]);
  else if (b < 0.22)
    body.push(['Loop', update('A'), ['Element', 'k2', ['Range', 1, 2]]]);
  else if (b < 0.3) body.push(['If', condition(), update('A')]);
  statements.push([
    'Loop',
    body,
    ['Element', 'kk', ['Range', 1, pick<Json>(rng, [['Length', 'A'], 2, 3])]],
  ]);
  // The value: the list, an element, or an element with a read of the
  // initial value, of the alias or of the kept row after the loop.
  const element = (name: Json): Json => (nested ? ['At', name, 1, 1] : ['At', name, 1]);
  const v = rng();
  const value: Json =
    keptRow && v < 0.5
      ? ['Add', ['At', 'r1', 1], element('A')]
      : alias && v < 0.6
        ? ['Add', element('B'), element('A')]
        : first !== undefined && v < 0.35
          ? ['Add', element(first), element('A')]
          : v < 0.8
            ? 'A'
            : element('A');
  return { statements, value };
}

/** The statements of a block: one or two real locals, maybe a list local
 *  made by a `Comprehension`, writes (`ReplaceAt` for the list), `If`
 *  statements and a `Loop` with a `Break`, then the value. */
function genStatements(rng: Rng, maxDepth: number, base: ContextBase): Json[] {
  const ctx = (
    extra: [Json, number][],
    depth: number,
    lists: readonly string[] = []
  ): GenContext => ({
    ...base,
    rng,
    maxDepth: Math.max(1, maxDepth - depth),
    symbols: [...base.symbols, ...extra],
    lists: [...base.lists, ...lists],
  });
  const locals: [Json, number][] = [['t', 25]];
  const listLocals: string[] = [];
  const localFunctions: string[] = [];
  // A local list `A` carried by a loop that updates it, from a value that
  // the program does not own (an input, a parameter, a captured list, a row
  // read, a function of lists, a literal that repeats a row) or from a
  // literal (`withOwnedCopies()` in structured-in-place.ts): an alias `B`
  // updated too, a read of the initial value after the loop, a `Break`, a
  // branch that writes an input to `A`, a call or a lambda that reads `A`,
  // a row swap, a row of an input written into `A`, an inner loop. The
  // block has one other statement, the declaration of `t`.
  const carried = genCarriedList(rng, ctx(locals, 2), base);
  if (carried.value !== undefined)
    return [
      ['Declare', 't', "'real'", 0.5],
      ...carried.statements,
      carried.value,
    ];
  // The first local, always declared: with a type from `declareLocal()`, or
  // with the type `unknown` (the form of `t ≔ …`; a first write to a name
  // that no `Declare` declares is an error).
  const statements: Json[] = [
    rng() < 0.12
      ? ['Declare', 't', "'unknown'", genReal(ctx([], 1), 0)]
      : declareLocal(rng, 't', ctx([], 1)),
  ];
  if (rng() < 0.4) {
    // Sometimes a destructuring declaration of `s` and `s2`.
    statements.push(
      rng() < 0.15
        ? [
            'Declare',
            ['Tuple', 's', 's2'],
            ['Dictionary', ['KeyValuePair', "'value'", ['Tuple', genReal(ctx(locals, 1), 0), genReal(ctx(locals, 1), 0)]]],
          ]
        : declareLocal(rng, 's', ctx(locals, 1))
    );
    locals.push(['s', 15]);
  }
  if (rng() < 0.2) {
    // A list local: a comprehension of reals or of integers, or another
    // kind of value, which the profile refuses.
    const r = rng();
    const value: Json =
      r < 0.75
        ? genComprehension(ctx(locals, 2), 0)
        : r < 0.9
          ? [
              'Comprehension',
              pick(rng, [2, 'j', ['Mod', 'j', 2]] as Json[]),
              ['Element', 'j', ['Range', 1, intBetween(rng, 1, 3)]],
            ]
          : genReal(ctx(locals, 2), 0);
    statements.push(['Declare', 'R', "'list<real>'", value]);
    listLocals.push('R');
    // A write of a local that the comprehension can read, after it: the
    // interpreter stores the elements at the declaration
    // (`listedAssignedValue()`), as the compiled code does.
    if (rng() < 0.5)
      statements.push(['Assign', 't', genReal(ctx(locals, 2), 0)]);
  }
  // A local function of one parameter `v`, which can read the locals
  // declared before it and the inputs: a closure of the block, which the
  // profile makes a helper with the captured names as parameters.
  // With `--host`, a local function is more frequent, and half of them read
  // an input, a read of the host, and call a function of the host (`hm`
  // sets `x`).
  if (rng() < (base.host ? 0.4 : 0.15)) {
    const body =
      base.host && rng() < 0.5
        ? pick<Json>(rng, [
            ['Add', ['hm', 'v'], 'x'],
            ['If', ['Less', ['hm', 'v'], 2], 'x', 'vr'],
            ['Multiply', 'vr', ['hq', 'v', 'x']],
            ['Add', ['hp', 'v'], 'x', 't'],
            ['Divide', ['hq', 'v', 't'], 'vr'],
          ])
        : genReal(ctx([...locals, ['v', 30]], 2), 0);
    const literal: Json = ['Function', body, 'v'];
    statements.push(
      pick<Json>(rng, [
        ['Declare', 'lf', "'function'", literal],
        ['DefineFunction', 'lf', literal],
        ['Declare', 'lf', "'unknown'", literal],
        ['Declare', 'lf', ['Dictionary', ['KeyValuePair', "'value'", literal]]],
      ])
    );
    localFunctions.push('lf');
  }
  const target = () => (locals.length > 1 && rng() < 0.3 ? 's' : 't');
  const count = intBetween(rng, 0, 2);
  for (let i = 0; i < count; i++) {
    const r = rng();
    const c = (depth: number, extra = locals): GenContext => ({
      ...ctx(extra, depth, listLocals),
      localFunctions,
    });
    if (listLocals.length > 0 && r < 0.15) {
      statements.push([
        'Assign',
        'R',
        ['ReplaceAt', 'R', pick(rng, [1, 2, -1]), genReal(c(2), 0)],
      ]);
    } else if (r < 0.3) {
      // Sometimes a destructuring write of both locals, which reads them.
      statements.push(
        locals.length > 1 && rng() < 0.3
          ? ['Assign', ['Tuple', 't', 's'], ['Tuple', genReal(c(1), 0), genReal(c(1), 0)]]
          : ['Assign', target(), genReal(c(1), 0)]
      );
    } else if (r < 0.4) {
      // A block statement, with a local of its own.
      statements.push(
        rng() < 0.5
          ? ['Block', ['Assign', target(), genReal(c(2), 0)]]
          : [
              'Block',
              ['Declare', 'e0', "'real'", genReal(c(2), 0)],
              ['Assign', target(), genReal(c(2, [...locals, ['e0', 30]]), 0)],
            ]
      );
    } else if (r < 0.7) {
      const branch: Json[] = [
        'If',
        genCondition(c(2), 0),
        ['Assign', target(), genReal(c(2), 0)],
      ];
      if (rng() < 0.5) branch.push(['Assign', target(), genReal(c(2), 0)]);
      statements.push(branch);
    } else if (
      r < 0.8 &&
      base.lists.length + listLocals.length + (base.tupleLists?.length ?? 0) > 0
    ) {
      // A loop over the elements of a list name: a list of reals or of
      // integers, or a list of tuples, whose element the body reads.
      const over = pick(rng, [...base.lists, ...listLocals, ...(base.tupleLists ?? [])]);
      const element: [Json, number][] = (base.tupleLists ?? []).includes(over)
        ? [[['At', 'cv', 1], 20], [['At', 'cv', 2], 20]]
        : [['cv', 20]];
      statements.push([
        'Loop',
        ['Assign', target(), genReal(c(2, [...locals, ...element]), 0)],
        ['Element', 'cv', over],
      ]);
    } else if (r < 0.88) {
      // A loop over two index sets, the second can read the first index; a
      // loop with no index set, which a counter ends with a `Break`; a
      // `Continue` at the start of the body.
      const shape = rng();
      const inLoop: [Json, number][] = [...locals, ['r', 20], ['r2', 20]];
      const body: Json[] = ['Block'];
      if (rng() < 0.4)
        body.push(['If', genCondition(c(2, inLoop), 0), ['Continue']]);
      body.push(['Assign', target(), genReal(c(2, inLoop), 0)]);
      if (shape < 0.6)
        statements.push([
          'Loop',
          body,
          ['Element', 'r', ['Range', pick(rng, [1, 0]), intBetween(rng, 0, 3)]],
          ['Element', 'r2', ['Range', pick<Json>(rng, [1, 'r']), rng() < 0.8 ? intBetween(rng, 0, 3) : 'm']],
        ]);
      else
        statements.push(
          ['Declare', 'r', "'integer'", 0],
          ['Declare', 'r2', "'integer'", 1],
          [
            'Loop',
            [
              'Block',
              ['Assign', 'r', ['Add', 'r', 1]],
              ['If', ['Less', rng() < 0.8 ? intBetween(rng, 0, 4) : 'm', 'r'], ['Break']],
              ...body.slice(1),
            ],
          ]
        );
    } else {
      const inLoop: [Json, number][] = [...locals, ['r', 20]];
      const body: Json[] = [
        'Block',
        ['Assign', target(), genReal(c(2, inLoop), 0)],
      ];
      if (rng() < 0.6)
        body.push([
          'If',
          genCondition(c(2, inLoop), 0),
          ['Block', ['Assign', target(), genReal(c(2, inLoop), 0)], ['Break']],
        ]);
      const upper: Json = rng() < 0.8 ? intBetween(rng, 0, 4) : 'm';
      statements.push([
        'Loop',
        body,
        ['Element', 'r', ['Range', pick(rng, [1, 1, 0]), upper]],
      ]);
    }
  }
  // A local declared a list of tuples, from the empty list, that a loop
  // over a list appends to (`out = [...out, (…)]`).
  let tupleLocal = false;
  if (rng() < 0.08 && base.lists.length + (base.tupleLists?.length ?? 0) > 0) {
    const over = pick(rng, [...base.lists, ...(base.tupleLists ?? [])]);
    const element: [Json, number][] = (base.tupleLists ?? []).includes(over)
      ? [[['At', 'cv', 1], 20], [['At', 'cv', 2], 20]]
      : [['cv', 20]];
    const c = ctx([...locals, ...element], 2);
    const append: Json = [
      'Assign',
      'Q',
      ['ListJoin', 'Q', ['List', ['Tuple', genReal(c, 0), genReal(c, 0)]]],
    ];
    statements.push(
      ['Declare', 'Q', "'list<tuple<real, real>>'", ['List']],
      [
        'Loop',
        rng() < 0.5 ? append : ['If', genCondition(c, 0), append],
        ['Element', 'cv', over],
      ]
    );
    tupleLocal = true;
  }
  // A local declared a list of lists, from rows, whose elements a loop over
  // its rows writes (`S = replaceAt(S, k, j, v)`, in place when the rows are
  // the program's own).
  let rowsLocal = false;
  if (rng() < 0.08) {
    const c = ctx(locals, 2);
    statements.push(['Declare', 'S', "'list<list<real>>'", genRows(c, 1)]);
    if (rng() < 0.7)
      statements.push([
        'Loop',
        [
          'Assign',
          'S',
          rng() < 0.5
            ? ['ReplaceAt', 'S', 'kk', pick(rng, [1, -1]), genReal(ctx([...locals, ['kk', 20]], 2), 0)]
            : ['ReplaceAt', 'S', 'kk', ['List', genReal(ctx([...locals, ['kk', 20]], 2), 0)]],
        ],
        ['Element', 'kk', ['Range', 1, rng() < 0.5 ? ['Length', 'S'] : intBetween(rng, 1, 2)]],
      ]);
    rowsLocal = true;
  }
  if (rowsLocal && rng() < 0.6)
    statements.push(rng() < 0.5 ? 'S' : ['At', 'S', pick(rng, [1, -1, 2]), 1]);
  else if (tupleLocal && rng() < 0.6) statements.push('Q');
  else if (listLocals.length > 0 && rng() < 0.3) statements.push('R');
  else if (rng() < 0.12)
    statements.push(
      rng() < 0.75
        ? genList(ctx(locals, 1, listLocals), 0)
        : genTuple(ctx(locals, 1, listLocals), 0)
    );
  else
    statements.push(
      genReal({ ...ctx(locals, 1, listLocals), localFunctions }, 0)
    );
  // A local that holds 0, 1 or -1 in a complex sum or product: the existing
  // emitter writes the local as its name, never as a constant term.
  if (rng() < 0.12) {
    const value = statements.pop()!;
    const complex: Json = pick<Json>(rng, [
      ['Multiply', ['Complex', 0.5, -1], value],
      ['Add', value, 'ImaginaryUnit'],
      ['Multiply', 'ImaginaryUnit', value],
    ]);
    statements.push(
      ['Declare', 'k0', pick(rng, ["'integer'", "'real'"]), pick(rng, [0, 1, -1])],
      [pick(rng, ['Add', 'Add', 'Multiply']), 'k0', complex]
    );
  }
  return statements;
}

/**
 * The declaration of the scalar local `name`: mostly `real` with a real
 * value; sometimes an integer value (a literal, `Mod`, a captured integer),
 * a complex value, a boolean or a list value of a `real` local, an
 * `integer` local, or a `let` (`Declare(t, {value: …})`, the form that
 * `parseEpsil()` gives).
 */
function declareLocal(rng: Rng, name: string, ctx: GenContext): Json {
  const r = rng();
  if (r < 0.7) return ['Declare', name, "'real'", genReal(ctx, 0)];
  const integer = (): Json =>
    pick(rng, [
      1,
      0,
      -3,
      'm',
      ['Mod', choose(rng, ctx.symbols), 3],
      ...ctx.integers,
    ] as Json[]);
  if (r < 0.8) return ['Declare', name, "'real'", integer()];
  if (r < 0.85)
    return [
      'Declare',
      name,
      "'real'",
      pick(rng, [
        ['Complex', 1, 2],
        ['Multiply', 'ImaginaryUnit', genReal(ctx, 1)],
        ['Sqrt', genReal(ctx, 1)],
        ['Arccos', genReal(ctx, 1)],
      ] as Json[]),
    ];
  if (r < 0.88) return ['Declare', name, "'real'", genCondition(ctx, 1)];
  if (r < 0.9)
    return ['Declare', name, "'real'", genComprehension(ctx, 1)];
  if (r < 0.95) return ['Declare', name, "'integer'", integer()];
  if (r < 0.97) return ['Declare', name, "'unknown'", genReal(ctx, 0)];
  return [
    'Declare',
    name,
    ['Dictionary', ['KeyValuePair', "'value'", genReal(ctx, 0)]],
  ];
}

function genFunction(
  rng: Rng,
  maxDepth: number,
  random: boolean,
  host: boolean
): Json[] {
  const parameters = PARAMETERS.filter(([name]) => name === 'a' || rng() < 0.4);
  const names = parameters.map(([name]) => name);
  const symbols: [Json, number][] = [
    ['h', 3],
    ['m', 2],
    ['cn', 1],
    ['w', 1],
    ['g', 1],
    ['cv', 1],
    ['z0', 1],
  ];
  for (const [name, kind] of parameters)
    if (
      kind !== 'list' &&
      kind !== 'intlist' &&
      kind !== 'numlist' &&
      kind !== 'tuple' &&
      kind !== 'tuplelist' &&
      !ROW_KINDS.has(kind) &&
      kind !== 'boolean'
    )
      symbols.push([name, 20]);
  const block = (statements: Json[]): Json =>
    rng() < 0.15 ? ['Block', ['Block', ...statements]] : ['Block', ...statements];
  return [
    'Function',
    block(
      genStatements(rng, maxDepth, {
        symbols,
        integers: names.includes('n') ? ['n'] : [],
        reals: ['a'],
        booleans: names.includes('c') ? ['c'] : [],
        lists: names.filter((n) => n === 'V' || n === 'W' || n === 'NV'),
        tuples: names.includes('T') ? ['T'] : [],
        tupleLists: names.includes('TL') ? ['TL'] : [],
        rowLists: names.filter((n) => n === 'RP' || n === 'MP'),
        random,
        host,
      })
    ),
    ...parameters.map(([name, , type]): Json => ['Typed', name, `'${type}'`]),
  ];
}

export function nodeCount(json: Json): number {
  if (!Array.isArray(json)) return 1;
  let n = 1;
  for (let i = 1; i < json.length; i++) n += nodeCount(json[i]);
  return n;
}

/** The program `index` of the run of `seed`: an expression (70%), a
 *  `Function` literal (20%) or a `Block` at the root (10%). */
export function generateProgram(
  seed: number,
  index: number,
  options: {
    depth: number;
    size: number;
    random?: boolean;
    host?: boolean;
    calculus?: boolean;
  }
): Program {
  const rng = makeRng(mixSeed(seed, index, 1));
  const random = options.random === true;
  const host = options.host === true;
  const context: ContextBase = { ...EXPRESSION_CONTEXT, random, host };
  for (;;) {
    let json: Json;
    let parameters: string[] | undefined;
    const r = rng();
    if (r < 0.2) {
      const fn = genFunction(rng, options.depth, random, host);
      json = fn;
      parameters = fn.slice(2).map((p) => (p as Json[])[1] as string);
    } else if (r < 0.3) {
      const statements = genStatements(rng, options.depth, context);
      json =
        rng() < 0.15
          ? ['Block', ['Block', ...statements]]
          : ['Block', ...statements];
    } else {
      const ctx = {
        rng,
        maxDepth: options.depth,
        ...context,
        calculus: options.calculus === true,
      };
      const value = rng();
      json =
        value < 0.06
          ? genList(ctx, 0)
          : value < 0.08
            ? genTuple(ctx, 0)
            : value < 0.1
              ? genTupleList(ctx, 0)
              : value < 0.13
                ? genRows(ctx, 0)
                : value < 0.16
                  ? genMatrixRows(ctx, 0)
                  : value < 0.19
                    ? genMatrixReal(ctx, 0)
                    : genReal(ctx, 0);
      if (rng() < 0.03) json = ['ReplaceAt', 'L', pick(rng, [1, 2, -1]), json];
    }
    if (nodeCount(json) <= options.size)
      return {
        id: `${seed}:${index}`,
        json,
        parameters,
        ...(host ? { host: true } : {}),
      };
  }
}

//
// Compilation and runs
//

type Outcome =
  | {
      readonly kind: 'value';
      readonly value: unknown;
      /** The shape of the value as the emitted code makes it, before
       *  `run()` turns `{re, im: 0}` into a number (`valueShape()`), or
       *  `undefined` when the raw value is not available. */
      readonly raw: string | undefined;
      /** The number of calls of `Math.random` (draws outside a seeded
       *  region) during the run (`withStubbedRandom()`). */
      readonly draws: number;
      /** The reads and calls of the host, in order (`hostCalls()`). */
      readonly host: string;
    }
  | { readonly kind: 'throw'; readonly message: string };

type Compiled =
  | { readonly ok: true; readonly code: string; readonly run: Runner }
  | {
      readonly ok: false;
      readonly decline: boolean;
      readonly code: string;
      readonly message: string;
    };

type Runner = (inputs: Inputs) => Outcome;

const PROFILE_PREFIX = /^Could not compile with the profile 'numeric-kernel': /;

/** The shape of a value: `number`, `boolean`, `complex` (an object with
 *  `re` and `im`, also with `im` 0), `list[…]` with the shape of each
 *  element, or its `typeof`. */
export function valueShape(v: unknown): string {
  if (Array.isArray(v)) return `list[${v.map(valueShape).join(', ')}]`;
  if (isComplex(v)) return 'complex';
  return typeof v;
}

/**
 * The function that gives the value of compiled code as the emitted code
 * makes it, with no normalization of the result. For an expression, the
 * `rawCall` of the runner (the body applied to a vars object, with no entry
 * check). For a `Function` literal, the runner gives its own source
 * (`toString()`, with its definitions) and its helpers (`SYS`): the source
 * is evaluated again with those helpers.
 */
function rawRunner(
  run: unknown,
  parameters: readonly string[] | undefined
): ((args: unknown[]) => unknown) | undefined {
  const r = run as {
    rawCall?: (vars: unknown) => unknown;
    SYS?: unknown;
    toString(): string;
  };
  try {
    if (parameters === undefined)
      return typeof r.rawCall === 'function'
        ? (args) => r.rawCall!(args[0])
        : undefined;
    if (r.SYS === undefined) return undefined;
    const fn = new Function('_SYS', `return (${r.toString()});`)(r.SYS) as (
      ...a: unknown[]
    ) => unknown;
    return (args) => fn(...args);
  } catch {
    return undefined;
  }
}

/** The seed of the sequence that replaces `Math.random` in each run. */
const DRAW_SEED = 0x5eed;

/**
 * Run `f` with `Math.random` replaced by the sequence of `makeRng(DRAW_SEED)`,
 * started at its first number, and count its calls. A draw outside a
 * seeded region of the compiled code calls `Math.random`
 * (`drawNextRandomNumber()`); a draw in a `WithRandomSeed` reads the
 * generator of its seed, and its value shows its order and its number.
 */
function withStubbedRandom<T>(f: () => T): { value: T; draws: number } {
  const random = Math.random;
  const next = makeRng(DRAW_SEED);
  let draws = 0;
  Math.random = () => {
    draws += 1;
    HOST_LOG.push('draw');
    return next();
  };
  try {
    return { value: f(), draws };
  } finally {
    Math.random = random;
  }
}

function compileWith(
  expr: Expression,
  mode: Mode,
  profile: boolean,
  parameters: readonly string[] | undefined,
  host = false
): Compiled {
  try {
    const hostOptions = host ? HOST_OPTIONS : {};
    const result = profile
      ? compile(expr, {
          ...hostOptions,
          profile: 'numeric-kernel',
          fallback: false,
          mode,
        })
      : compile(expr, {
          ...hostOptions,
          cse: false,
          constantFold: false,
          fallback: false,
          mode,
        });
    const run = result.run as unknown as (...args: unknown[]) => unknown;
    if (!result.success || typeof run !== 'function')
      return {
        ok: false,
        decline: true,
        code: result.diagnostic?.code ?? 'no-run',
        message: result.diagnostic?.message ?? 'no run function',
      };
    const raw = rawRunner(run, parameters);
    // A deep copy: a list of tuples holds arrays.
    const copy = (v: Value): unknown =>
      Array.isArray(v) ? structuredClone(v) : v;
    // The entries that `HOST_OPTIONS` reads in place of `vu` and `vz`.
    // A new vars object per call, which `hm` changes (`HOST_VARS`).
    const argumentsOf = (inputs: Inputs): unknown[] => {
      if (parameters !== undefined) {
        HOST_VARS = undefined;
        return parameters.map((name) => copy(inputs[name]));
      }
      const vars: Record<string, unknown> = Object.fromEntries([
        ...Object.entries(inputs).map(([k, v]) => [k, copy(v)]),
        ...(host
          ? [
              ['vu_', inputs.vu],
              ['vz_', inputs.vz],
            ]
          : []),
      ]);
      HOST_VARS = vars;
      return [vars];
    };
    return {
      ok: true,
      code: result.code,
      run: (inputs) => {
        let value: unknown;
        let draws: number;
        let calls: string;
        // The arguments of the call, kept to see whether the call writes an
        // array of its inputs (a list or a tuple of a list of tuples).
        let args: unknown[] = [];
        try {
          ({
            value: { value, draws },
            host: calls,
          } = hostCalls(() =>
            withStubbedRandom(() => run(...(args = argumentsOf(inputs))))
          ));
        } catch (error) {
          return { kind: 'throw', message: String(error) };
        }
        const written = Object.entries(inputs).filter(([name, v]) => {
          if (!Array.isArray(v)) return false;
          const passed =
            parameters === undefined
              ? (args[0] as Record<string, unknown>)[name]
              : args[parameters.indexOf(name)];
          return !sameValue(passed, v);
        });
        if (written.length > 0)
          calls += ` wrote the input ${written.map(([n]) => n).join(', ')}`;
        // A second call with the inputs of the first: the same value.
        if (draws === 0 && calls === '' && host === false) {
          try {
            const again = run(...(args as unknown[]));
            if (!sameValue(again, value)) calls += ' second call differs';
            // On the profile: the host writes into every array of the value
            // of a third call, with new inputs, and a fourth call, with new
            // inputs, gives the value again (no array of the value is an
            // array that a later call reads: a constant, or a list that the
            // code keeps). The existing compiler can give a captured list
            // itself (CE-1222), so the check is not made there.
            if (profile && Array.isArray(value)) {
              const expected = structuredClone(value);
              scribble(run(...argumentsOf(inputs)));
              if (!sameValue(run(...argumentsOf(inputs)), expected))
                calls += ' call after a write into the value differs';
              value = expected;
            }
          } catch {
            calls += ' second call throws';
          }
        }
        let shape: string | undefined;
        try {
          shape =
            raw === undefined
              ? undefined
              : valueShape(
                  withStubbedRandom(() => raw(argumentsOf(inputs))).value
                );
        } catch {
          shape = undefined;
        }
        return { kind: 'value', value, raw: shape, draws, host: calls };
      },
    };
  } catch (error) {
    const e = error as {
      name?: string;
      message?: string;
      diagnostic?: { code?: string };
    };
    const code = e.diagnostic?.code ?? e.name ?? 'Error';
    // A failure of the profile is an error that is not a decline: a
    // `compile-error` (a phase of the structured compiler failed) or an
    // exception of another kind.
    const decline =
      e.name === 'CompileDeclineError' ? code !== 'compile-error' : !profile;
    return {
      ok: false,
      decline,
      code,
      message: String(e.message ?? error).replace(PROFILE_PREFIX, ''),
    };
  }
}

/** Write into every array of `value`, at every depth, as a host that owns
 *  the value can. */
function scribble(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (let k = 0; k < value.length; k++) {
    scribble(value[k]);
    if (!Array.isArray(value[k])) value[k] = 12345;
  }
  value.push(54321);
}

/** The same value: the same shape, and `Object.is` for each number. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (isComplex(a) && isComplex(b))
    return Object.is(a.re, b.re) && Object.is(a.im, b.im);
  return a === b;
}

function sameOutcome(a: Outcome, b: Outcome): boolean {
  if (a.kind === 'throw' || b.kind === 'throw') return a.kind === b.kind;
  return (
    a.draws === b.draws && a.host === b.host && sameValue(a.value, b.value)
  );
}

/** Whether two outcomes differ in the shape that the emitted code makes (a
 *  number on one side, `{re, im: 0}` on the other), which `run()` hides. */
function differentRawShape(a: Outcome, b: Outcome): boolean {
  return (
    a.kind === 'value' &&
    b.kind === 'value' &&
    a.raw !== undefined &&
    b.raw !== undefined &&
    a.raw !== b.raw
  );
}

/** The inputs of `program`: its parameters, or the free inputs that its
 *  canonical form reads. */
function inputsOf(program: Program, expr: Expression): [string, InputKind][] {
  if (program.parameters !== undefined)
    return program.parameters.map((name) => [
      name,
      PARAMETERS.find(([n]) => n === name)![1],
    ]);
  const found = new Set<string>();
  const walk = (j: unknown) => {
    if (typeof j === 'string') {
      if (j in GLOBAL_INPUTS) found.add(j);
    } else if (Array.isArray(j)) for (const x of j) walk(x);
  };
  walk(expr.json);
  return Object.keys(GLOBAL_INPUTS)
    .filter((name) => found.has(name))
    .map((name) => [name, GLOBAL_INPUTS[name]]);
}

/** The points of the grid of `inputs`, sampled to at most `max`. */
function gridPoints(
  inputs: readonly [string, InputKind][],
  mode: Mode,
  max: number,
  rng: Rng
): Inputs[] {
  const axes = inputs.map(
    ([name, kind]) => [name, gridOf(kind, mode)] as const
  );
  let total = 1;
  for (const [, values] of axes) total *= values.length;
  if (total <= max) {
    let result: Inputs[] = [{}];
    for (const [name, values] of axes)
      result = result.flatMap((point) =>
        values.map((v) => ({ ...point, [name]: v }))
      );
    return result;
  }
  return Array.from({ length: max }, () =>
    Object.fromEntries(axes.map(([name, values]) => [name, pick(rng, values)]))
  );
}

function pointInType(
  inputs: readonly [string, InputKind][],
  point: Inputs,
  mode: Mode
): boolean {
  return inputs.every(([name, kind]) => inType(kind, point[name], mode));
}

//
// The interpreter
//

function boxValue(ce: ComputeEngine, v: Value, name?: string): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  // A list of lists holds rows, which are lists; a list of tuples holds
  // tuples.
  const rows =
    name !== undefined && ['R', 'MA', 'M2', 'M3', 'RP', 'MP'].includes(name);
  if (Array.isArray(v))
    return ce.function(
      name === 'P' || name === 'T' ? 'Tuple' : 'List',
      v.map((x) =>
        Array.isArray(x)
          ? ce.function(rows ? 'List' : 'Tuple', x.map((e) => ce.number(e)))
          : ce.number(x)
      )
    );
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `program` by the interpreter: `{re, im}`, the list of the
 *  values of a list or a tuple of numbers, or the MathJSON of the result as
 *  text when it is not a number. */
function interpret(
  ce: ComputeEngine,
  program: Program,
  expr: Expression,
  point: Inputs
): Expected {
  let value: Expression;
  if (program.parameters !== undefined)
    value = ce
      .function('Apply', [
        expr,
        ...program.parameters.map((name) => boxValue(ce, point[name], name)),
      ])
      .evaluate();
  else {
    // The names whose value is an expression of the inputs, replaced by
    // their values, three times for a chain (`ec` reads `ev`): `subs()`
    // does not enter a stored value.
    let inlined = expr;
    const values = Object.fromEntries(
      Object.entries(EXPRESSION_VALUES).map(([k, v]) => [k, ce.expr(v)])
    );
    for (let i = 0; i < 3; i++) inlined = inlined.subs(values);
    value = inlined
      .subs(
        Object.fromEntries(
          Object.entries(point).map(([k, v]) => [k, boxValue(ce, v, k)])
        )
      )
      .evaluate();
  }
  // A comprehension is a lazy view: its elements are read here.
  const n = (
    isFunction(value, 'Comprehension')
      ? ce.function('List', [...value.each()])
      : value
  ).N();
  // A list or a tuple of numbers, or a list of such tuples, at every depth.
  const numbers = (e: Expression): Expected | undefined => {
    if (isNumber(e)) return { re: e.re, im: e.im };
    if (!isFunction(e, 'List') && !isFunction(e, 'Tuple')) return undefined;
    const ops = e.ops.map(numbers);
    return ops.every((op) => op !== undefined) ? (ops as Expected[]) : undefined;
  };
  if (isFunction(n, 'List') || isFunction(n, 'Tuple')) {
    const list = numbers(n);
    if (list !== undefined) return list;
  }
  if (!isNumber(n)) return JSON.stringify(value.json).slice(0, 200);
  return { re: n.re, im: n.im };
}

/** The value of the interpreter: a number, a list of values (at every
 *  depth), or the MathJSON of a value that is not a number, as text. */
type Expected = Complex | Expected[] | string;

function asComplex(v: unknown): Complex | undefined {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (isComplex(v)) return v;
  return undefined;
}

const TOLERANCE = 1e-7;

/**
 * How the compiled value `value` compares with the interpreter's
 * `expected`:
 *
 * - `agree`: within `TOLERANCE` relative; or compiled `NaN`, `±Infinity` or
 *   `undefined` where the interpreter has no finite number; or, in the
 *   `strict` mode, `NaN` where the interpreter's value is not real.
 * - `no-number`: the interpreter has no finite number (an error, `Missing`,
 *   an unevaluated form, `ComplexInfinity`, `NaN`) and compiled code has a
 *   finite value. This is the pole of a quotient that compiled code carries
 *   on as `±Infinity` (`erf(1/k)` at `k = 0` is `1`): counted, not
 *   reported.
 * - `disagree`: any other case.
 */
function compareWithInterpreter(
  value: unknown,
  expected: Expected,
  mode: Mode
): 'agree' | 'no-number' | 'disagree' {
  // A list or a tuple: the same length, and each element by the rule of a
  // number.
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length)
      return 'disagree';
    const verdicts = expected.map((e, i) =>
      compareWithInterpreter(value[i], e, mode)
    );
    return verdicts.includes('disagree')
      ? 'disagree'
      : verdicts.includes('no-number')
        ? 'no-number'
        : 'agree';
  }
  if (Array.isArray(value))
    return typeof expected === 'string' ? 'no-number' : 'disagree';
  const v = asComplex(value);
  const finite = (c: Complex) => Number.isFinite(c.re) && Number.isFinite(c.im);
  if (typeof expected === 'string' || !finite(expected))
    return v === undefined || !finite(v) ? 'agree' : 'no-number';
  if (v === undefined || !finite(v))
    return v === undefined ||
      Number.isNaN(v.re) ||
      Number.isNaN(v.im) ||
      (mode === 'strict' && expected.im !== 0)
      ? 'agree'
      : 'disagree';
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
  return near(v.re, expected.re) && near(v.im, expected.im)
    ? 'agree'
    : 'disagree';
}

//
// Shapes and messages
//

/** The canonical form with each symbol, number and constant replaced by
 *  `_`; `True`, `False` and type strings stay. */
export function shapeOf(json: unknown): string {
  if (typeof json === 'number') return '_';
  if (typeof json === 'string') {
    if (json === 'True' || json === 'False') return json;
    if (json.startsWith("'")) return json;
    return '_';
  }
  if (Array.isArray(json)) {
    const [head, ...rest] = json;
    if (head === 'Rational' || head === 'Complex') return '_';
    // The parameters of a `Function` are left out: a shrink keeps them all.
    if (head === 'Function') return `Function(${shapeOf(rest[0])})`;
    return `${String(head)}(${rest.map(shapeOf).join(', ')})`;
  }
  if (typeof json === 'object' && json !== null) {
    if ('num' in json) return '_';
    if ('sym' in json) return shapeOf((json as { sym: string }).sym);
    if ('fn' in json) return shapeOf((json as { fn: unknown[] }).fn);
  }
  return '?';
}

/** A decline message with its names, quoted text and numbers replaced. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/`[^`]*`/g, '`…`')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/\b-?\d+(\.\d+)?(e[-+]?\d+)?\b/g, 'N')
    .slice(0, 160);
}

//
// The run
//

export interface FuzzOptions {
  readonly seeds: readonly number[];
  readonly count: number;
  readonly depth: number;
  readonly size: number;
  readonly points: number;
  readonly interp: number;
  readonly shrink: number;
  readonly modes: readonly Mode[];
  /** Generate draws (`--random`). */
  readonly random?: boolean;
  /** Generate reads and calls of the host (`--host`). */
  readonly host?: boolean;
  /** Generate calculus heads in an expression (`--calculus`). */
  readonly calculus?: boolean;
  /** The angular unit of each engine (`--deg`); `rad` when absent. */
  readonly angularUnit?: 'rad' | 'deg';
}

export const DEFAULT_OPTIONS: FuzzOptions = {
  seeds: [1],
  count: 500,
  depth: 4,
  size: 40,
  points: 300,
  interp: 3,
  shrink: 300,
  modes: ['strict', 'complex'],
};

/** A minimal program of a class, with what reproduces it. */
export interface Finding {
  readonly class:
    | 'difference'
    | 'shape'
    | 'out-of-type'
    | 'existing-declines'
    | 'profile-failure'
    | 'interpreter';
  readonly shape: string;
  /** How many programs of the run reduce to this shape. */
  count: number;
  readonly id: string;
  readonly mode: Mode;
  /** The original program and the minimal one, as written. */
  readonly original: Json;
  readonly minimal: Json;
  /** The canonical form of the minimal program. */
  readonly canonical: unknown;
  readonly parameters?: readonly string[];
  readonly input?: Inputs;
  readonly profileCode?: string;
  readonly existingCode?: string;
  readonly profileValue?: unknown;
  readonly existingValue?: unknown;
  /** The shapes that the emitted codes make, before `run()` (a shape
   *  difference). */
  readonly profileShape?: string;
  readonly existingShape?: string;
  readonly interpreterValue?: unknown;
  readonly message?: string;
  /** Whether the minimal program shows the same class in a new engine. */
  readonly freshEngine: boolean;
}

export interface FuzzResult {
  readonly options: FuzzOptions;
  readonly programs: number;
  readonly invalid: number;
  /** Per program and mode. */
  readonly classes: Record<string, number>;
  readonly points: { inType: number; outOfType: number };
  readonly interpreterPoints: {
    compared: number;
    skipped: number;
    noNumber: number;
  };
  readonly declines: { message: string; count: number; example: string }[];
  readonly existingDeclineMessages: {
    message: string;
    count: number;
  }[];
  readonly findings: Finding[];
}

/** The predicate of a shrink: whether a program still shows the class. */
type Predicate = (ce: ComputeEngine, program: Program) => Witness | undefined;

/** What a predicate found, for the report. */
interface Witness {
  readonly expr: Expression;
  readonly input?: Inputs;
  readonly profileCode?: string;
  readonly existingCode?: string;
  readonly profileValue?: unknown;
  readonly existingValue?: unknown;
  readonly profileShape?: string;
  readonly existingShape?: string;
  readonly interpreterValue?: unknown;
  readonly message?: string;
}

/** Runs `f` in a new scope of `ce`, so that a name with no declared type
 *  that the program auto-declares does not outlive it. */
function scoped<T>(ce: ComputeEngine, f: () => T): T {
  ce.pushScope();
  try {
    return f();
  } finally {
    ce.popScope();
  }
}

function boxProgram(
  ce: ComputeEngine,
  program: Program
): Expression | undefined {
  try {
    defineHelpers(ce);
    const expr = ce.box(program.json as MathJsonExpression);
    return expr.isValid ? expr : undefined;
  } catch {
    return undefined;
  }
}

/** The point of a shrink: the point of the witness, with a value for each
 *  name that a replacement can introduce. */
const DEFAULT_POINT: Inputs = {
  x: 3,
  y: 0.1,
  k: 2,
  p: 0.5,
  q: 0.5,
  z: { re: 1, im: 0.5 },
  u: 1 / 3,
  L: [0.1, 1 / 3, 7],
  a: 3,
  b: 0.1,
  n: 2,
  V: [0.1, 1 / 3, 7],
  B: true,
  c: true,
};

/** The number of points of the grid that a shrink step tries after the
 *  point of the witness: a smaller program can differ at another point. */
const SHRINK_POINTS = 80;

/** The predicate of a difference of values (`'value'`) or of the shape
 *  that the emitted codes make with the same value (`'shape'`). */
function differencePredicate(
  mode: Mode,
  point: Inputs,
  kind: 'value' | 'shape'
): Predicate {
  return (ce, program) => {
    const expr = boxProgram(ce, program);
    if (expr === undefined) return undefined;
    const inputs = inputsOf(program, expr);
    const p = compileWith(expr, mode, true, program.parameters, program.host);
    if (!p.ok) return undefined;
    const e = compileWith(expr, mode, false, program.parameters, program.host);
    if (!e.ok) return undefined;
    const tried = [
      point,
      ...gridPoints(inputs, mode, SHRINK_POINTS, makeRng(7)).map((q) => ({
        ...DEFAULT_POINT,
        ...q,
      })),
    ];
    for (const q of tried) {
      if (!pointInType(inputs, q, mode)) continue;
      const a = p.run(q);
      const b = e.run(q);
      const same = sameOutcome(a, b);
      if (kind === 'value' ? same : !same || !differentRawShape(a, b)) continue;
      return {
        expr,
        input: Object.fromEntries(inputs.map(([n]) => [n, q[n]])),
        profileCode: p.code,
        existingCode: e.code,
        profileValue: a.kind === 'value' ? a.value : `throws ${a.message}`,
        existingValue: b.kind === 'value' ? b.value : `throws ${b.message}`,
        profileShape: a.kind === 'value' ? a.raw : undefined,
        existingShape: b.kind === 'value' ? b.raw : undefined,
        ...(a.kind === 'value' && b.kind === 'value' && a.draws !== b.draws
          ? { message: `draws: profile ${a.draws}, existing ${b.draws}` }
          : a.kind === 'value' && b.kind === 'value' && a.host !== b.host
            ? { message: `host: profile [${a.host}], existing [${b.host}]` }
            : {}),
      };
    }
    return undefined;
  };
}

function existingDeclinesPredicate(mode: Mode): Predicate {
  return (ce, program) => {
    const expr = boxProgram(ce, program);
    if (expr === undefined) return undefined;
    const p = compileWith(expr, mode, true, program.parameters, program.host);
    if (!p.ok) return undefined;
    const e = compileWith(expr, mode, false, program.parameters, program.host);
    if (e.ok) return undefined;
    return { expr, profileCode: p.code, message: e.message };
  };
}

function profileFailurePredicate(mode: Mode, code: string): Predicate {
  return (ce, program) => {
    const expr = boxProgram(ce, program);
    if (expr === undefined) return undefined;
    const p = compileWith(expr, mode, true, program.parameters, program.host);
    if (p.ok || p.decline || p.code !== code) return undefined;
    return { expr, message: `${p.code}: ${p.message}` };
  };
}

function interpreterPredicate(mode: Mode, point: Inputs): Predicate {
  return (ce, program) => {
    // A shrink can take a draw out of its `WithRandomSeed`: such a program
    // is not compared with the interpreter (`interpretsDraws()`).
    if (!interpretsDraws(program)) return undefined;
    const expr = boxProgram(ce, program);
    if (expr === undefined) return undefined;
    const inputs = inputsOf(program, expr);
    if (!pointInType(inputs, point, mode)) return undefined;
    const p = compileWith(expr, mode, true, program.parameters, program.host);
    if (!p.ok) return undefined;
    const a = p.run(point);
    if (a.kind !== 'value') return undefined;
    let expected: Complex | Complex[] | string;
    try {
      expected = interpret(ce, program, expr, point);
    } catch {
      return undefined;
    }
    if (compareWithInterpreter(a.value, expected, mode) !== 'disagree')
      return undefined;
    return {
      expr,
      input: Object.fromEntries(inputs.map(([n]) => [n, point[n]])),
      profileCode: p.code,
      profileValue: a.value,
      interpreterValue: expected,
    };
  };
}

/** The paths of the nodes that a shrink may replace: not a head, not a
 *  quoted string, not a parameter of a `Function`. */
function shrinkPaths(json: Json, path: number[] = [], out: number[][] = []) {
  out.push(path);
  if (!Array.isArray(json)) return out;
  const head = json[0];
  const end = head === 'Function' ? 2 : json.length;
  for (let i = 1; i < end; i++) {
    const child = json[i];
    if (typeof child === 'string' && child.startsWith("'")) continue;
    if (head === 'Limits' || head === 'Element') {
      if (i === 1) continue;
    }
    shrinkPaths(child, [...path, i], out);
  }
  return out;
}

function atPath(json: Json, path: readonly number[]): Json {
  let node = json;
  for (const i of path) node = (node as Json[])[i];
  return node;
}

function replaceAt(json: Json, path: readonly number[], value: Json): Json {
  if (path.length === 0) return value;
  const copy = [...(json as Json[])];
  copy[path[0]] = replaceAt(copy[path[0]], path.slice(1), value);
  return copy;
}

const VARIADIC = new Set([
  'Add',
  'Multiply',
  'Min',
  'Max',
  'And',
  'Or',
  'Block',
]);

/** The replacements of a node, smaller ones first. */
function candidates(node: Json, symbol: string): Json[] {
  const result: Json[] = [];
  if (Array.isArray(node)) {
    const head = node[0];
    if (
      head !== 'Limits' &&
      head !== 'Element' &&
      head !== 'Range' &&
      head !== 'Typed'
    )
      for (const op of node.slice(1))
        if (!(typeof op === 'string' && op.startsWith("'"))) result.push(op);
    if (typeof head === 'string' && VARIADIC.has(head) && node.length > 3)
      for (let i = 1; i < node.length; i++)
        result.push([...node.slice(0, i), ...node.slice(i + 1)]);
    result.push(symbol, 1, 2, 0.5);
  } else if (typeof node === 'string' && node !== symbol) {
    result.push(symbol, 1);
  } else if (typeof node === 'number' && node !== 1) {
    result.push(1);
  }
  return result;
}

/** The smallest program found from `program` for which `predicate` holds.
 *  Each step replaces one node by a smaller candidate, root first. */
function shrink(
  ce: ComputeEngine,
  program: Program,
  predicate: Predicate,
  budget: number
): { program: Program; witness: Witness } | undefined {
  let calls = 0;
  const test = (p: Program) => {
    calls += 1;
    try {
      return scoped(ce, () => predicate(ce, p));
    } catch {
      return undefined;
    }
  };
  let witness = test(program);
  if (witness === undefined) return undefined;
  let current = program;
  const symbol = program.parameters?.[0] ?? 'x';
  let improved = true;
  while (improved && calls < budget) {
    improved = false;
    const root = current.parameters !== undefined ? [1] : [];
    const base =
      current.parameters !== undefined
        ? atPath(current.json, [1])
        : current.json;
    for (const sub of shrinkPaths(base)) {
      const path = [...root, ...sub];
      const node = atPath(current.json, path);
      const size = nodeCount(current.json);
      for (const candidate of candidates(node, symbol)) {
        const json = replaceAt(current.json, path, candidate);
        if (
          nodeCount(json) >= size &&
          !(
            nodeCount(json) === size &&
            typeof node === 'string' &&
            typeof candidate === 'number'
          )
        )
          continue;
        if (calls >= budget) break;
        const next: Program = { ...current, json };
        const w = test(next);
        if (w !== undefined) {
          current = next;
          witness = w;
          improved = true;
          break;
        }
      }
      if (improved || calls >= budget) break;
    }
  }
  return { program: current, witness };
}

/**
 * Runs the tester and returns its result. `log` receives a line of progress
 * per 500 programs.
 */
export async function runFuzz(
  options: FuzzOptions,
  log: (line: string) => void = () => {}
): Promise<FuzzResult> {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await runFuzzQuietly(options, log);
  } finally {
    console.warn = warn;
  }
}

/**
 * The number of programs compiled on one engine, and between two returns
 * to the event loop. The engine makes `WeakRef`s, and a `WeakRef` keeps its
 * target alive until the end of the synchronous job that made it, so a run
 * that never returns to the event loop keeps every engine and every boxed
 * expression: 50,000 programs in one job exhausted a heap of 4 GB.
 */
const ENGINE_PROGRAMS = 200;

/** Whether `json` draws outside a `WithRandomSeed`: a `Random`, or a call
 *  of a helper of `RANDOM_HELPERS`. The interpreter and compiled code draw
 *  such numbers from `Math.random` in their own order of evaluation. */
function drawsOutsideSeed(json: Json): boolean {
  if (!Array.isArray(json)) return false;
  const head = json[0];
  if (head === 'WithRandomSeed') return drawsOutsideSeed(json[1]);
  if (head === 'Random' || RANDOM_HELPERS.some((h) => h.name === head))
    return true;
  return json.slice(1).some(drawsOutsideSeed);
}

/** Whether `json` draws: a `Random`, or a call of a helper of
 *  `RANDOM_HELPERS`, also in a `WithRandomSeed`. */
function drawsIn(json: Json): boolean {
  if (!Array.isArray(json)) return false;
  const head = json[0];
  if (head === 'Random' || RANDOM_HELPERS.some((h) => h.name === head))
    return true;
  return json.slice(1).some(drawsIn);
}

/**
 * Whether the interpreter gives the value of `program` with the draws of
 * compiled code: no draw outside a `WithRandomSeed`, and, for a program
 * that is not a `Function` literal, no draw at all. Such a program is
 * interpreted after `subs()` (`interpret()`), which makes the canonical
 * form again and can order the operands, and so the draws, otherwise. A
 * program that reads or calls the host (`--host`) is not interpreted: the
 * interpreter has no function of the host.
 */
function interpretsDraws(program: Program): boolean {
  if (program.host === true && usesHost(program.json)) return false;
  if (drawsOutsideSeed(program.json)) return false;
  return program.parameters !== undefined || !drawsIn(program.json);
}

async function runFuzzQuietly(
  options: FuzzOptions,
  log: (line: string) => void
): Promise<FuzzResult> {
  // A new engine every `ENGINE_PROGRAMS` programs, after a return to the
  // event loop (see `ENGINE_PROGRAMS`).
  let ce = makeEngine(options.angularUnit);
  const classes: Record<string, number> = {
    'both compile': 0,
    'both decline': 0,
    'profile declines only': 0,
    'existing declines only': 0,
    'profile failure': 0,
  };
  const points = { inType: 0, outOfType: 0 };
  const interpreterPoints = { compared: 0, skipped: 0, noNumber: 0 };
  const declines = new Map<string, { count: number; example: string }>();
  const existingMessages = new Map<string, number>();
  const findings = new Map<string, Finding>();
  let programs = 0;
  let invalid = 0;

  const record = (
    cls: Finding['class'],
    program: Program,
    mode: Mode,
    predicate: Predicate,
    shapeHint: string
  ) => {
    // A shape seen before is counted with no shrink: its first minimal
    // program stands for it. The hint is the shape of the original program.
    const hintKey = `${cls}|hint|${shapeHint}`;
    const known = findings.get(hintKey);
    if (known !== undefined) {
      known.count += 1;
      return;
    }
    const shrunk = shrink(ce, program, predicate, options.shrink);
    if (shrunk === undefined) return;
    const shape = shapeOf(shrunk.witness.expr.json);
    const key = `${cls}|${shape}`;
    const existing = findings.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      findings.set(hintKey, existing);
      return;
    }
    const fresh = makeEngine(options.angularUnit);
    const freshEngine =
      scoped(fresh, () => predicate(fresh, shrunk.program)) !== undefined;
    const w = shrunk.witness;
    const finding: Finding = {
      class: cls,
      shape,
      count: 1,
      id: program.id,
      mode,
      original: program.json,
      minimal: shrunk.program.json,
      canonical: w.expr.json,
      parameters: program.parameters,
      input: w.input,
      profileCode: w.profileCode,
      existingCode: w.existingCode,
      profileValue: w.profileValue,
      existingValue: w.existingValue,
      profileShape: w.profileShape,
      existingShape: w.existingShape,
      interpreterValue: w.interpreterValue,
      message: w.message,
      freshEngine,
    };
    findings.set(key, finding);
    findings.set(hintKey, finding);
  };

  for (const seed of options.seeds) {
    for (let index = 0; index < options.count; index++) {
      if (programs > 0 && programs % ENGINE_PROGRAMS === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        ce = makeEngine(options.angularUnit);
      }
      const program = generateProgram(seed, index, options);
      programs += 1;
      if (programs % 500 === 0)
        log(
          `${programs} programs, ${new Set(findings.values()).size} findings`
        );
      const deferred: (() => void)[] = [];
      scoped(ce, () => {
        const expr = boxProgram(ce, program);
        if (expr === undefined) {
          invalid += 1;
          return;
        }
        const shapeHint = shapeOf(expr.json);
        const inputs = inputsOf(program, expr);
        let profileAdmits: Mode | undefined;
        for (const mode of options.modes) {
          const p = compileWith(expr, mode, true, program.parameters, program.host);
          const e = compileWith(expr, mode, false, program.parameters, program.host);
          if (!p.ok && !p.decline) {
            classes['profile failure'] += 1;
            const code = p.code;
            deferred.push(() =>
              record(
                'profile-failure',
                program,
                mode,
                profileFailurePredicate(mode, code),
                shapeHint
              )
            );
            continue;
          }
          if (!p.ok) {
            const message = normalizeMessage(p.message);
            const entry = declines.get(message);
            if (entry === undefined)
              declines.set(message, {
                count: 1,
                example: expr.toString().slice(0, 120),
              });
            else entry.count += 1;
            classes[e.ok ? 'profile declines only' : 'both decline'] += 1;
            continue;
          }
          profileAdmits ??= mode;
          if (!e.ok) {
            classes['existing declines only'] += 1;
            const message = normalizeMessage(e.message);
            existingMessages.set(
              message,
              (existingMessages.get(message) ?? 0) + 1
            );
            deferred.push(() =>
              record(
                'existing-declines',
                program,
                mode,
                existingDeclinesPredicate(mode),
                shapeHint
              )
            );
            continue;
          }
          classes['both compile'] += 1;
          const rng = makeRng(mixSeed(seed, index, 2));
          let inTypeDifference: Inputs | undefined;
          let outOfTypeDifference: Inputs | undefined;
          let shapeDifference: Inputs | undefined;
          for (const point of gridPoints(inputs, mode, options.points, rng)) {
            const isIn = pointInType(inputs, point, mode);
            if (isIn) points.inType += 1;
            else points.outOfType += 1;
            if (isIn && inTypeDifference !== undefined) continue;
            if (
              !isIn &&
              (outOfTypeDifference !== undefined ||
                inTypeDifference !== undefined)
            )
              continue;
            const a = p.run(point);
            const b = e.run(point);
            if (sameOutcome(a, b)) {
              if (
                isIn &&
                shapeDifference === undefined &&
                differentRawShape(a, b)
              )
                shapeDifference = point;
              continue;
            }
            if (isIn) inTypeDifference = point;
            else outOfTypeDifference = point;
          }
          if (inTypeDifference !== undefined) {
            const point = { ...DEFAULT_POINT, ...inTypeDifference };
            deferred.push(() =>
              record(
                'difference',
                program,
                mode,
                differencePredicate(mode, point, 'value'),
                shapeHint
              )
            );
          } else if (shapeDifference !== undefined) {
            const point = { ...DEFAULT_POINT, ...shapeDifference };
            deferred.push(() =>
              record(
                'shape',
                program,
                mode,
                differencePredicate(mode, point, 'shape'),
                shapeHint
              )
            );
          } else if (outOfTypeDifference !== undefined) {
            // Not a difference under the caveats: counted by the shape of
            // the program, not shrunk.
            const key = `out-of-type|${shapeHint}`;
            const known = findings.get(key);
            if (known !== undefined) known.count += 1;
            else {
              const a = p.run(outOfTypeDifference);
              const b = e.run(outOfTypeDifference);
              findings.set(key, {
                class: 'out-of-type',
                shape: shapeHint,
                count: 1,
                id: program.id,
                mode,
                original: program.json,
                minimal: program.json,
                canonical: expr.json,
                parameters: program.parameters,
                input: outOfTypeDifference,
                profileCode: p.code,
                existingCode: e.code,
                profileValue:
                  a.kind === 'value' ? a.value : `throws ${a.message}`,
                existingValue:
                  b.kind === 'value' ? b.value : `throws ${b.message}`,
                freshEngine: true,
              });
            }
          }
          if (
            options.interp > 0 &&
            profileAdmits === mode &&
            !interpretsDraws(program)
          )
            interpreterPoints.skipped += 1;
          else if (options.interp > 0 && profileAdmits === mode) {
            const ordinaryPoints = gridPoints(
              inputs,
              mode,
              options.points,
              rng
            ).filter(
              (point) =>
                pointInType(inputs, point, mode) &&
                Object.values(point).every(ordinary)
            );
            const step = Math.max(
              1,
              Math.floor(ordinaryPoints.length / options.interp)
            );
            for (
              let i = 0, n = 0;
              i < ordinaryPoints.length && n < options.interp;
              i += step, n++
            ) {
              const point = ordinaryPoints[i];
              const a = p.run(point);
              if (a.kind !== 'value') continue;
              let expected: Complex | Complex[] | string;
              try {
                expected = interpret(ce, program, expr, point);
              } catch {
                interpreterPoints.skipped += 1;
                continue;
              }
              interpreterPoints.compared += 1;
              const verdict = compareWithInterpreter(a.value, expected, mode);
              if (verdict === 'no-number') interpreterPoints.noNumber += 1;
              if (verdict !== 'disagree') continue;
              const shrinkPoint = { ...DEFAULT_POINT, ...point };
              deferred.push(() =>
                record(
                  'interpreter',
                  program,
                  mode,
                  interpreterPredicate(mode, shrinkPoint),
                  shapeHint
                )
              );
              break;
            }
          }
        }
      });
      for (const f of deferred) f();
    }
  }

  const sorted = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([message, count]) => ({ message, count }));

  return {
    options,
    programs,
    invalid,
    classes,
    points,
    interpreterPoints,
    declines: [...declines.entries()]
      .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
      .map(([message, { count, example }]) => ({ message, count, example })),
    existingDeclineMessages: sorted(existingMessages),
    findings: [...new Set(findings.values())].sort((a, b) =>
      a.class === b.class ? b.count - a.count : a.class < b.class ? -1 : 1
    ),
  };
}

//
// Output
//

/** A value as text: `-0`, `NaN` and the infinities spelled out. */
export function formatValue(v: unknown): string {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  if (isComplex(v))
    return `{re: ${formatValue(v.re)}, im: ${formatValue(v.im)}}`;
  if (typeof v === 'object' && v !== null)
    return `{${Object.entries(v)
      .map(([k, x]) => `${k}: ${formatValue(x)}`)
      .join(', ')}}`;
  return String(v);
}

function jsonReplacer(_key: string, v: unknown): unknown {
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)))
    return formatValue(v);
  return v;
}

export function writeJson(file: string, result: FuzzResult): void {
  writeFileSync(file, JSON.stringify(result, jsonReplacer, 2) + '\n');
}

const TITLES: Readonly<Record<Finding['class'], string>> = {
  'difference':
    'Differences between the profile and the existing compiler (inputs in type)',
  'shape':
    'Differences of the shape the emitted codes make, with the same value after run() (inputs in type)',
  'profile-failure': 'Failures of the profile that are not declines',
  'existing-declines':
    'Programs that the existing compiler declines and the profile admits',
  'interpreter':
    'Disagreements of the profile with the interpreter (ordinary inputs)',
  'out-of-type':
    'Differences at inputs outside their type only (not differences under the caveats)',
};

export function printResult(result: FuzzResult, quiet: boolean): string {
  const lines: string[] = [];
  const o = result.options;
  lines.push(
    `seeds ${o.seeds.join(',')}; ${result.programs} programs (${result.invalid} not valid after boxing); ` +
      `depth ${o.depth}, size ${o.size}, points ${o.points}, modes ${o.modes.join(',')}, ` +
      `angular unit ${o.angularUnit ?? 'rad'}` +
      (o.random ? ', draws' : '') +
      (o.host ? ', host' : '') +
      (o.calculus ? ', calculus' : '')
  );
  lines.push(`declarations: ${DECLARATIONS}`);
  lines.push('');
  lines.push('Classes (program and mode):');
  for (const [name, n] of Object.entries(result.classes))
    lines.push(`  ${name}: ${n}`);
  lines.push(
    `Points compared: ${result.points.inType} in type, ${result.points.outOfType} outside the type`
  );
  lines.push(
    `Interpreter: ${result.interpreterPoints.compared} points compared, ${result.interpreterPoints.skipped} skipped (the interpreter threw), ` +
      `${result.interpreterPoints.noNumber} where the interpreter has no finite number and compiled code has one (a pole: not reported)`
  );
  const byClass = (c: Finding['class']) =>
    result.findings.filter((f) => f.class === c);
  for (const c of Object.keys(TITLES) as Finding['class'][]) {
    const list = byClass(c);
    lines.push(
      `  ${TITLES[c]}: ${list.length} shapes, ${list.reduce((s, f) => s + f.count, 0)} programs`
    );
  }
  lines.push('');
  lines.push('Declines of the profile, most frequent first:');
  for (const d of result.declines.slice(0, 30))
    lines.push(
      `  ${String(d.count).padStart(6)}  ${d.message}    e.g. ${d.example}`
    );
  if (quiet) return lines.join('\n');
  for (const c of Object.keys(TITLES) as Finding['class'][]) {
    const list = byClass(c);
    if (list.length === 0) continue;
    lines.push('');
    lines.push(`## ${TITLES[c]}`);
    for (const f of list) {
      lines.push('');
      lines.push(
        `- shape ${f.shape}  (${f.count} programs; first ${f.id}, mode ${f.mode}${f.freshEngine ? '' : '; NOT reproduced in a new engine'})`
      );
      lines.push(`  minimal:   ${JSON.stringify(f.minimal)}`);
      lines.push(`  canonical: ${JSON.stringify(f.canonical)}`);
      if (f.input !== undefined)
        lines.push(`  input:     ${formatValue(f.input)}`);
      if (f.profileCode !== undefined)
        lines.push(`  profile:   ${f.profileCode.replace(/\s*\n\s*/g, ' ')}`);
      if (f.existingCode !== undefined)
        lines.push(`  existing:  ${f.existingCode.replace(/\s*\n\s*/g, ' ')}`);
      if (f.profileValue !== undefined)
        lines.push(`  profile value:  ${formatValue(f.profileValue)}`);
      if (f.existingValue !== undefined)
        lines.push(`  existing value: ${formatValue(f.existingValue)}`);
      if (f.profileShape !== undefined || f.existingShape !== undefined)
        lines.push(
          `  shape of the code: profile ${f.profileShape}, existing ${f.existingShape}`
        );
      if (f.interpreterValue !== undefined)
        lines.push(`  interpreter:    ${formatValue(f.interpreterValue)}`);
      if (f.message !== undefined)
        lines.push(`  message:   ${f.message.slice(0, 200)}`);
      if (c === 'interpreter' && JUMP_HEADS.test(f.shape))
        lines.push(
          '  note:      reads a discontinuous operator: the precision caveat of compiled code can apply'
        );
    }
  }
  return lines.join('\n');
}

/** The heads whose value jumps: a rounding of a double next to a jump can
 *  differ from the exact value. */
const JUMP_HEADS =
  /\b(Mod|Floor|Ceil|Round|Sign|Less|LessEqual|Greater|GreaterEqual|Equal|NotEqual)\(/;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: '1' },
      count: { type: 'string' },
      depth: { type: 'string' },
      size: { type: 'string' },
      points: { type: 'string' },
      interp: { type: 'string' },
      shrink: { type: 'string' },
      modes: { type: 'string' },
      json: { type: 'string' },
      quiet: { type: 'boolean', default: false },
      random: { type: 'boolean', default: false },
      host: { type: 'boolean', default: false },
      calculus: { type: 'boolean', default: false },
      deg: { type: 'boolean', default: false },
      bigint: { type: 'boolean', default: false },
    },
  });
  const int = (s: string | undefined, d: number) =>
    s === undefined ? d : Number.parseInt(s, 10);
  if (values.bigint!) {
    const result = await runBigintFuzz(
      {
        seeds: values.seed!.split(',').map((s) => Number.parseInt(s, 10)),
        count: int(values.count, DEFAULT_OPTIONS.count),
        depth: int(values.depth, DEFAULT_OPTIONS.depth),
        size: int(values.size, DEFAULT_OPTIONS.size),
        points: int(values.points, 60),
        interp: int(values.interp, DEFAULT_OPTIONS.interp),
        shrink: int(values.shrink, DEFAULT_OPTIONS.shrink),
      },
      (line) => process.stderr.write(line + '\n')
    );
    process.stdout.write(printBigintResult(result, values.quiet!) + '\n');
    if (values.json !== undefined)
      writeFileSync(
        values.json,
        JSON.stringify(
          result,
          (_k, v) =>
            typeof v === 'bigint'
              ? `${String(v)}n`
              : typeof v === 'number' && !Number.isFinite(v)
                ? String(v)
                : v,
          2
        ) + '\n'
      );
    return;
  }
  const options: FuzzOptions = {
    seeds: values.seed!.split(',').map((s) => Number.parseInt(s, 10)),
    count: int(values.count, DEFAULT_OPTIONS.count),
    depth: int(values.depth, DEFAULT_OPTIONS.depth),
    size: int(values.size, DEFAULT_OPTIONS.size),
    points: int(values.points, DEFAULT_OPTIONS.points),
    interp: int(values.interp, DEFAULT_OPTIONS.interp),
    shrink: int(values.shrink, DEFAULT_OPTIONS.shrink),
    modes:
      values.modes === undefined
        ? DEFAULT_OPTIONS.modes
        : (values.modes.split(',') as Mode[]),
    random: values.random!,
    host: values.host!,
    calculus: values.calculus!,
    angularUnit: values.deg! ? 'deg' : 'rad',
  };
  const result = await runFuzz(options, (line) =>
    process.stderr.write(line + '\n')
  );
  process.stdout.write(printResult(result, values.quiet!) + '\n');
  if (values.json !== undefined) writeJson(values.json, result);
}

if (/js-profile-fuzz\.ts$/.test(process.argv[1] ?? '')) void main();
