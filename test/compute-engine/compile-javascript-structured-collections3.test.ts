import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import type {
  IROperation,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slices 4 and 5 of docs/plans/2026-11-11-structured-collections-and-lambdas.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): a user function as the function operand of `Map`, `Filter`,
// `Count`, `Reduce`, `Scan` and `Apply`; `Range` with a step;
// `RotateLeft` and `RotateRight`; lists of tuples (literals, `At`, `First`,
// `Last`, comprehensions and `Map` that make tuples, `Count`, `Filter`,
// `Take`, `Drop`, `Reverse`, `Join`, `ListJoin`, a rotation), declared
// tuple-list parameters and locals, and a `Loop` over the elements of a
// list.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`), and the same shape at every depth; the inputs must be the
// same after the call as a deep copy taken before it, and a second call
// with the same inputs gives the same value. The value agrees with the
// interpreter within 1e-12 relative, or by the caveats of compiled code
// (`NaN` where the interpreter has no number).

const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];
const EXISTING = { cse: false, constantFold: false, fallback: false } as const;
const PROFILE = { profile: 'numeric-kernel', fallback: false } as const;

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

/** A `Function` literal of the body `body` and the typed parameters. */
const fn = (
  body: MathJsonExpression,
  ...parameters: [string, string][]
): MathJsonExpression =>
  [
    'Function',
    ['Block', body],
    ...parameters.map(([n, t]) => typed(n, t)),
  ] as MathJsonExpression;

/** A function literal operand of the parameters `names`. */
const lambda = (body: MathJsonExpression, ...names: string[]): MathJsonExpression =>
  ['Function', body, ...names] as MathJsonExpression;

const L: [string, string] = ['L', 'list<real>'];
const I: [string, string] = ['I', 'list<integer>'];
const X: [string, string] = ['x', 'real'];
const N: [string, string] = ['n', 'integer'];
const K: [string, string] = ['k', 'integer'];
const LP: [string, string] = ['LP', 'list<tuple<real, real>>'];
const LN: [string, string] = ['LN', 'list<tuple<number, number>>'];
const LT: [string, string] = ['LT', 'list<tuple<real, real, real, integer>>'];
const P: [string, string] = ['P', 'tuple<real, real>'];

type Arg = number | number[] | number[][];

/** A deep copy of an argument. */
const copy = (a: Arg): Arg => structuredClone(a);

function run(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

/** The same doubles and the same shape, at every depth. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

/** Within 1e-12 relative of the interpreter, element by element at every
 *  depth; `NaN` where the interpreter gives no number. */
function close(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((v, i) => close(v, expected[i]))
    );
  if (typeof value === 'boolean') return value === expected;
  if (typeof value !== 'number') return false;
  if (typeof expected !== 'number' || !Number.isFinite(expected))
    return (
      Number.isNaN(value) ||
      value === expected ||
      (typeof expected !== 'number' && !Number.isFinite(value))
    );
  return (
    value === expected ||
    Math.abs(value - expected) <=
      1e-12 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

/** The MathJSON of an argument: a list of numbers, or a list of tuples
 *  (an array of arrays); `tuple` makes a flat array a tuple. */
function boxArg(a: Arg, tuple: boolean): MathJsonExpression {
  if (!Array.isArray(a)) return a;
  return [
    tuple ? 'Tuple' : 'List',
    ...a.map((e) => (Array.isArray(e) ? (['Tuple', ...e] as MathJsonExpression) : e)),
  ] as MathJsonExpression;
}

/** The number, boolean, or nested arrays of numbers of a value of the
 *  interpreter, `undefined` where it is not a number. */
function valueOf(value: Expression): unknown {
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return value.ops.map(valueOf);
  return isNumber(value) && value.im === 0 ? value.re : undefined;
}

function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  args: readonly Arg[],
  tuples: readonly number[] = []
): unknown {
  const evaluated = ce
    .expr(['Apply', json, ...args.map((a, i) => boxArg(a, tuples.includes(i)))] as MathJsonExpression)
    .evaluate();
  // A lazy collection (a comprehension, a `Map`, a `Filter`, a `Range`) is
  // read here.
  return valueOf(
    (evaluated.isCollection && !isFunction(evaluated, 'List') && !isFunction(evaluated, 'Tuple')
      ? ce.function('List', [...evaluated.each()])
      : evaluated
    ).N()
  );
}

type Program = {
  readonly name: string;
  readonly json: MathJsonExpression;
  readonly args: readonly (readonly Arg[])[];
  /** The positions of the arguments that are tuples. */
  readonly tuples?: readonly number[];
  /** The modes; both by default. */
  readonly modes?: readonly Mode[];
  /** No comparison with the interpreter (the caveats of compiled code). */
  readonly existingOnly?: boolean;
  /** The source of Epsil that defines the user functions of the program. */
  readonly epsil?: string;
};

/** Each program, compiled with the profile and with the existing compiler,
 *  and run on each list of arguments. */
function check(program: Program): void {
  for (const mode of program.modes ?? MODES) {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    if (program.epsil !== undefined)
      expect(executeEpsil(ce, program.epsil).diagnostics).toEqual([]);
    const expr = ce.expr(program.json);
    const result = compile(expr, { ...PROFILE, mode } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, { ...EXISTING, mode }) as CompilationResult<'javascript'>;
    for (const args of program.args) {
      const inputs = args.map(copy);
      const value = run(result, inputs);
      // The inputs are not written, and a second call gives the same value.
      expect([mode, args, same(inputs, args)]).toEqual([mode, args, true]);
      expect([mode, args, same(run(result, inputs), value)]).toEqual([mode, args, true]);
      const reference = run(existing, args.map(copy));
      expect([mode, args, value, same(value, reference)]).toEqual([mode, args, value, true]);
      if (program.existingOnly) continue;
      const expected = interpret(ce, program.json, args, program.tuples);
      expect([mode, args, value, close(value, expected)]).toEqual([mode, args, value, true]);
    }
  }
}

const LISTS: number[][] = [[], [3], [1, -2.5, 7], [-0, 1e300, 5e-324, 1 / 3]];
const POINTS: number[][][] = [[], [[1, 2]], [[1, 2], [3, -4], [-0, 0.5]], [[1e300, -1e300], [5e-324, 2]]];

// (a) A user function as the function operand.
const USER_FUNCTIONS = `function fd(v: real) { 2 * v + v * v - 0.5 }
function fp(v: real) { v > 0.5 }
function fa(a: real, b: real) { a * 2 - b }
function fs(a: real, b: integer) { a * 2 + b }`;

const PART_A: Program[] = [
  { name: 'Map of a user function', json: fn(['Map', 'fd', 'L'], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Map of a user function over a list of integers', json: fn(['Map', 'fd', 'I'], I), args: [[[]], [[1, -2, 4]]], epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Map of a user function over a Range', json: fn(['Map', 'fd', ['Range', 1, 'n']], N), args: [[0], [1], [4], [-2]], epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Filter of a user predicate', json: fn(['Filter', 'L', 'fp'], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Count of a user predicate', json: fn(['Count', 'L', 'fp'], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Reduce by a user function with an initial value', json: fn(['Reduce', 'L', 'fa', 1], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Reduce by a user function of an integer parameter', json: fn(['Reduce', 'I', 'fs', 0.5], I), args: [[[]], [[3, -1]]], epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Scan by a user function with an initial value', json: fn(['Scan', 'L', 'fa', 0], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Scan by a user function with no initial value', json: fn(['Scan', 'L', 'fa'], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Apply of a user function', json: fn(['Apply', 'fa', 'x', 2], X), args: [[0.5], [-0], [1e300]], epsil: USER_FUNCTIONS, modes: ['strict'] },
  { name: 'Sum of a Map of a user function', json: fn(['Sum', ['Map', 'fd', 'L']], L), args: LISTS.map((l) => [l]), epsil: USER_FUNCTIONS, modes: ['strict'] },
  {
    name: 'a Map and a Reduce of user functions in a body with a local',
    json: fn(['Block', ['Declare', 's', "'real'", ['Sum', ['Map', 'fd', 'L']]], ['Add', 's', ['Reduce', 'L', 'fa', 2]]], L),
    args: LISTS.map((l) => [l]),
    epsil: USER_FUNCTIONS,
    modes: ['strict'],
  },
];

// (b) `Range` with a step.
const PART_B: Program[] = [
  { name: 'Range with a real step', json: fn(['Range', 0, 'x', 0.25], X), args: [[1], [-1], [0], [0.6]] },
  { name: 'Range with a step of 0.1 (the tolerance of rangeCount)', json: fn(['Range', 0, 1, 0.1]), args: [[]] },
  { name: 'Range with integer bounds and an integer step', json: fn(['Range', 1, 'n', 'k'], N, K), args: [[7, 2], [7, -1], [0, 3], [-5, -2], [1, 1]] },
  { name: 'Range with real bounds and an integer step', json: fn(['Range', 'x', ['Add', 'x', 3], 'k'], X, K), args: [[0.5, 1], [2.5, 2], [-1, -1]] },
  { name: 'Range descending by -1', json: fn(['Range', 'n', 1, -1], N), args: [[4], [1], [-2]] },
  { name: 'Length of a Range with a step', json: fn(['Length', ['Range', 1, 'n', 'k']], N, K), args: [[7, 2], [7, -2], [0, 1]] },
  { name: 'At of a Range with a step', json: fn(['At', ['Range', 1, 'n', 2], 2], N), args: [[7], [1]] },
  { name: 'Map over a Range with a step', json: fn(['Map', lambda(['Multiply', 't', 2], 't'), ['Range', 1, 'n', 2]], N), args: [[7], [0]], modes: ['strict'] },
];

// (e) `RotateLeft`, `RotateRight`, and the sum of rotations of `life`.
const PART_E: Program[] = [
  { name: 'RotateLeft by each shift', json: fn(['RotateLeft', 'L', 'n'], L, N), args: [0, 1, 2, -1, 5, -7].flatMap((n) => LISTS.map((l) => [l, n])) },
  { name: 'RotateRight by each shift', json: fn(['RotateRight', 'L', 'n'], L, N), args: [0, 1, 2, -1, 5, -7].flatMap((n) => LISTS.map((l) => [l, n])) },
  { name: 'RotateLeft by one', json: fn(['RotateLeft', 'L'], L), args: LISTS.map((l) => [l]) },
  { name: 'RotateLeft of a list of integers', json: fn(['RotateLeft', 'I', 2], I), args: [[[]], [[1, 2, 3]]] },
  {
    name: 'a sum of rotations (the neighbour count of life)',
    json: fn(['Add', ['RotateLeft', 'I', 1], ['RotateLeft', 'I', -1], ['RotateRight', 'I', 2]], I),
    args: [[[1, 0, 1, 1, 0]], [[1]], [[0, 1]]],
  },
];

// (c) Lists of tuples.
const PART_C: Program[] = [
  { name: 'At of a list of tuples', json: fn(['At', 'LP', 'k'], LP, K), args: [1, 2, -1, 0, 5].flatMap((k) => POINTS.map((p) => [p, k])), existingOnly: true , modes: ['strict'] },
  { name: 'At of At of a list of tuples', json: fn(['At', ['At', 'LP', 'k'], 2], LP, K), args: [1, -1, 4].flatMap((k) => POINTS.map((p) => [p, k])), existingOnly: true , modes: ['strict'] },
  { name: 'First and Last of a list of tuples', json: fn(['List', ['At', ['First', 'LP'], 1], ['At', ['Last', 'LP'], 2]], LP), args: POINTS.map((p) => [p]), existingOnly: true },
  { name: 'Length and Count of a list of tuples', json: fn(['Add', ['Length', 'LP'], ['Count', 'LP']], LP), args: POINTS.map((p) => [p]) },
  { name: 'Take of a list of tuples', json: fn(['Take', 'LP', 'k'], LP, K), args: [0, 1, 2, -1, 5].flatMap((k) => POINTS.map((p) => [p, k])) },
  { name: 'Drop of a list of tuples', json: fn(['Drop', 'LP', 'k'], LP, K), args: [0, 1, 2, -1, 5].flatMap((k) => POINTS.map((p) => [p, k])) },
  { name: 'Reverse of a list of tuples', json: fn(['Reverse', 'LP'], LP), args: POINTS.map((p) => [p]) },
  { name: 'RotateLeft of a list of tuples', json: fn(['RotateLeft', 'LP', 'k'], LP, K), args: [1, -1].flatMap((k) => POINTS.map((p) => [p, k])) },
  { name: 'ListJoin of two lists of tuples', json: fn(['ListJoin', 'LP', ['Reverse', 'LP']], LP), args: POINTS.map((p) => [p]) , modes: ['strict'] },
  { name: 'Join of a list of tuples and a list literal of a tuple', json: fn(['Join', 'LP', ['List', 'P']], LP, P), args: POINTS.map((p) => [p, [7, 8]]), tuples: [1] , modes: ['strict'] },
  { name: 'a list literal of tuples', json: fn(['List', ['Tuple', 1, 2], ['Tuple', 'x', 3]], X), args: [[0.5], [-0]] },
  { name: 'At of a list literal of tuples', json: fn(['At', ['List', ['Tuple', 1, 2], ['Tuple', 'x', 3]], 'k'], X, K), args: [[0.5, 2], [0.5, 1], [0.5, 3]], existingOnly: true , modes: ['strict'] },
  { name: 'a comprehension of tuples', json: fn(['Comprehension', ['Tuple', 'j', ['Multiply', 'x', 'j']], ['Element', 'j', ['Range', 1, 'n']]], X, N), args: [[0.5, 3], [2, 0], [-1, -1]] },
  { name: 'Map of a list of tuples to a number', json: fn(['Map', lambda(['Add', ['At', 't', 1], ['At', 't', 2]], 't'), 'LP'], LP), args: POINTS.map((p) => [p]), modes: ['strict'] },
  { name: 'Map of a list of tuples to a tuple', json: fn(['Map', lambda(['Tuple', ['At', 't', 2], ['At', 't', 1]], 't'), 'LP'], LP), args: POINTS.map((p) => [p]), modes: ['strict'] },
  { name: 'Map of a list of numbers to a tuple', json: fn(['Map', lambda(['Tuple', 't', 'x'], 't'), 'L'], L, X), args: LISTS.map((l) => [l, 0.5]), modes: ['strict'] },
  { name: 'Filter of a list of tuples', json: fn(['Filter', 'LP', lambda(['Less', ['At', 'e', 1], 'x'], 'e')], LP, X), args: POINTS.map((p) => [p, 1.5]), modes: ['strict'] },
  { name: 'Count of a list of tuples with a predicate', json: fn(['Count', 'LT', lambda(['Less', ['At', 'e', 4], 'k'], 'e')], LT, K), args: [[[], 2], [[[1, 2, 3, 1], [2, 3, 4, 3]], 2]], modes: ['strict'] },
  { name: 'a list of tuples of number elements in the strict mode', json: fn(['Map', lambda(['Multiply', 'x', ['At', 't', 1]], 't'), 'LN'], LN, X), args: [[[[1, 2], [-5, 6]], 0.5], [[], 1]], modes: ['strict'] },
  {
    name: 'a local declared a list of tuples, from the empty list, in a loop over a list',
    json: fn(
      ['Block',
        ['Declare', 'out', "'list<tuple<real, real>>'", ['List']],
        ['Loop', ['If', ['Less', ['At', 'c', 1], 'x'], ['Assign', 'out', ['ListJoin', 'out', ['List', 'c']]]], ['Element', 'c', 'LP']],
        'out'],
      LP, X
    ),
    args: POINTS.map((p) => [p, 2]),
    modes: ['strict'],
  },
  {
    name: 'a loop over a list of numbers',
    json: fn(
      ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', ['Multiply', 's', 2], 'c']], ['Element', 'c', 'L']], 's'],
      L
    ),
    args: LISTS.map((l) => [l]),
  },
];

describe.each([
  ['part (a): user functions as function operands', PART_A],
  ['part (b): Range with a step', PART_B],
  ['part (c): lists of tuples', PART_C],
  ['part (e): rotations', PART_E],
] as const)('%s', (_label, programs) => {
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, program) => check(program));
});

describe('the witnesses of the Tycho preludes', () => {
  const literalOf = (ce: ComputeEngine, name: string): Expression =>
    (ce.lookupDefinition(name) as { operator: { _lambdaLiteral: Expression } }).operator._lambdaLiteral;

  test('generations of apollonian-gasket: a loop over a list of tuples into a declared local', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const source = `function generations(all: list<tuple<number, number, number, integer>>, lo: integer, hi: integer) {
  let out: list<tuple<number, number, number, integer>> = []
  for c in all {
    if c[4] >= lo && c[4] <= hi {
      let i = count(out, e => e[4] < c[4] || (e[4] == c[4] && e[1] <= c[1]))
      out = [...take(out, i), c, ...drop(out, i)]
    }
  }
  out
}`;
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    const literal = literalOf(ce, 'generations');
    const result = compile(literal, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    const circles = [
      [2, 0.5, 0, 1], [2, -0.5, 0, 1], [3, 0, 2 / 3, 1], [15, 0.2, 0.1, 2],
      [6, 0.1, -0.4, 2], [15, -0.2, 0.1, 2], [6, 0.3, 0.4, 3], [6, -0.1, -0.4, 2],
    ];
    for (const [lo, hi] of [[1, 1], [2, 2], [3, 3], [1, 1000], [3, 1]]) {
      const input = structuredClone(circles);
      const value = run(result, [input, lo, hi]);
      expect(same(value, run(existing, [structuredClone(circles), lo, hi]))).toBe(true);
      expect(same(input, circles)).toBe(true);
      expect(same(run(result, [input, lo, hi]), value)).toBe(true);
    }
    expect(run(result, [circles, 2, 2])).toEqual([[6, 0.1, -0.4, 2], [6, -0.1, -0.4, 2], [15, 0.2, 0.1, 2], [15, -0.2, 0.1, 2]]);
  });

  test('life of game-of-life: a sum of rotations of a list of integers', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const rotations = ['N - 1', 'N', 'N + 1', '-1', '1', '-N - 1', '-N', '-N + 1']
      .map((k) => `rotateLeft(S, ${k})`)
      .join(' + ');
    const source = `const N = 5
function life(S: list<integer>) -> list<integer> {
  let n = ${rotations}
  [if n[k] == 3 { 1 } else if n[k] == 2 { S[k] } else { 0 } for k in 1..N^2]
}`;
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    const literal = literalOf(ce, 'life');
    const result = compile(literal, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    // A blinker, and a board of other cells.
    const boards = [
      [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0],
    ];
    for (const board of boards) {
      const input = [...board];
      const value = run(result, [input]);
      expect(same(value, run(existing, [[...board]]))).toBe(true);
      expect(input).toEqual(board);
    }
    expect(run(result, [boards[0]])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the declines of slices 4 and 5', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('LP', 'list<tuple<real, real>>');
  ce.declare('LC', 'list<tuple<complex, real>>');
  ce.declare('P', 'tuple<real, real>');
  ce.declare('n', 'integer');
  ce.declare('x', 'real');
  ce.declare('g', '(real) -> boolean');
  ce.declare('ex', 'nan | real | signed_infinity');
  expect(
    executeEpsil(ce, 'function fd(v: real) { 2 * v + 1 }\nfunction fr(v: real) { v + random() }\nfunction fa(a: real, b: real) { a * 2 - b }').diagnostics
  ).toEqual([]);
  const declines: [string, MathJsonExpression, RegExp, Mode?][] = [
    ['Range with a literal step 0', ['Range', 1, 'n', 0], /Range with the literal step 0 is not in the profile/],
    ['Reduce by a user function whose annotation the initial value does not prove', ['Reduce', 'L', 'fa', 'ex'], /Reduce with the user function .*fa.*, whose parameter a is annotated real, is not in the profile for an argument of the type nan \| real \| signed_infinity/],
    ['Map of a user function that draws', ['Map', 'fr', 'L'], /Map whose function has the node fr\(.*\), which is not pure, draws/],
    ['Map of a user function in the complex mode', ['Map', 'fd', 'L'], /Map with the user function .*fd.* is not in the profile in the complex mode/, 'complex'],
    ['Map of a user function with no value', ['Filter', 'L', 'g'], /Filter with the function g is not in the profile/],
    ['Map of a local function', ['Block', ['Declare', 'lg', "'function'", lambda(['Add', 's', 1], 's')], ['Map', 'lg', 'L']], /Map with the local function .*lg.* is not in the profile: the engine types a call of a local function unknown/],
    ['RotateLeft with a real shift', ['RotateLeft', 'L', 'x'], /RotateLeft with x of the type `real` is not in the profile, which reads an integer there/],
    ['RotateLeft of a tuple', ['RotateLeft', 'P', 1], /RotateLeft of P of the type `point<2>` is not in the profile/],
    ['Sort of a list of tuples', ['Sort', 'LP'], /Sort of .*LP.* of the type `list<point<2>>` is not in the profile, which reads a list of reals or of integers/],
    ['a list literal of tuples of two sizes', ['List', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]], /a list literal of tuples of different sizes or of tuples and numbers is not in the profile/],
    ['Map of a tuple to tuples', ['Map', lambda(['Tuple', 't', 1], 't'), 'P'], /Map of a tuple with a function whose value is a tuple is not in the profile/],
    ['a list of tuples of complex elements', ['At', 'LC', 1], /LC/],
    ['ReplaceAt of a list of tuples', ['ReplaceAt', 'LP', 1, 'P'], /ReplaceAt in the profile writes into a list of reals or integers, and its first operand has the type `list<point<2>>`/],
    ['a Loop over a list that is not a name', ['Function', ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', 'c'], ['Element', 'c', ['Take', 'L', 2]]], 's'], typed('L', 'list<real>')], /the profile admits a Loop only over Element\(k, Range\(a, b\)\), with no step and no guard, or over a list that a name holds/],
  ];
  test.each(declines)('%s declines', (_name, json, message, mode = 'strict') => {
    expect(() => compile(ce.box(json), { ...PROFILE, mode } as never)).toThrow(message);
  });
});

/** The diagnostic code of a compilation that throws, or `undefined`. */
function declineCode(f: () => unknown): string | undefined {
  try {
    f();
  } catch (error) {
    return (error as { diagnostic?: { code?: string } }).diagnostic?.code ?? 'no diagnostic';
  }
  return undefined;
}

describe('every rule that reads a list declines a list of tuples it does not read', () => {
  // Each rule written when an element of a list was always a number: a
  // decline (`outside-profile`), never an internal error (`compile-error`).
  const ce = new ComputeEngine();
  ce.declare('LP', 'list<tuple<real, real>>');
  ce.declare('L', 'list<real>');
  ce.declare('x', 'real');
  ce.declare('c', 'boolean');
  const rows: [string, MathJsonExpression, RegExp][] = [
    ['ReplaceAt', ['ReplaceAt', 'LP', 1, 0], /ReplaceAt in the profile writes into a list of reals or integers/],
    ['Sum', ['Sum', 'LP'], /Sum of one operand of the type `list<point<2>>` is not in the profile/],
    ['Product', ['Product', 'LP'], /Product of one operand of the type `list<point<2>>` is not in the profile/],
    ['Max', ['Max', 'LP'], /Max of one operand of the type `list<point<2>>` is not in the profile/],
    ['Min', ['Min', 'LP'], /Min of one operand of the type `list<point<2>>` is not in the profile/],
    ['Sort', ['Sort', 'LP'], /Sort of .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['element-wise Multiply', ['Multiply', 'x', 'LP'], /Multiply with the list operand .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['element-wise Negate', ['Negate', 'LP'], /Negate with the list operand .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['element-wise Add of two lists of tuples', ['Add', 'LP', 'LP'], /Add with the list operand .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['Norm', ['Norm', 'LP'], /Norm of the type list<number> is not in the profile/],
    ['Reduce', ['Reduce', 'LP', 'Add', 0], /Reduce of .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['Scan', ['Scan', 'LP', 'Add'], /Scan of .*LP.* of the type `list<point<2>>` is not in the profile/],
    ['Dot', ['Dot', 'LP', 'LP'], /Dot of the type list<real> is not in the profile/],
    ['an If whose branches are a list of tuples and a list of reals', ['If', 'c', 'LP', 'L'], /The branches of `If` have the types `list<point<2>>` and `list<real>`/],
    ['Join of a list of reals and a list of tuples', ['Join', 'L', 'LP'], /Join of .*LP.* of the type `list<point<2>>` and L of the type `list<real>` is not in the profile, which joins lists of one element type/],
    ['Join of the empty list and a list of tuples', ['Join', ['List'], 'LP'], /Join of .*LP.* of the type `list<point<2>>` and \[\] of the type `list<integer>` is not in the profile, which joins lists of one element type/],
    [
      'a local declared list<real> with a list of tuples',
      fn(['Block', ['Declare', 'R', "'list<real>'", 'LP'], 'R'], LP),
      /The value of the local `R` has the type `list<point<2>>`/,
    ],
  ];
  test.each(rows)('%s', (_name, json, message) => {
    for (const mode of MODES) {
      const attempt = () => compile(ce.expr(json), { ...PROFILE, mode } as never);
      expect([mode, declineCode(attempt)]).toEqual([mode, 'outside-profile']);
      if (mode === 'strict') expect(attempt).toThrow(message);
    }
  });
});

describe('the declines of the review of slices 4 and 5', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('LP', 'list<tuple<real, real>>');
  ce.declare('LN', 'list<tuple<number, number>>');
  ce.declare('xi', 'real');
  ce.declare('cn', 'number');
  ce.assign('cn', 1.5);
  expect(
    executeEpsil(
      ce,
      'function f(t: real) { 2 * t }\nfunction gi(p: tuple<integer, integer>) { p[1] + 2 * p[2] }\nfunction gr(p: tuple<real, real>) { p[1] + p[2] }'
    ).diagnostics
  ).toEqual([]);
  const rows: [string, MathJsonExpression, object, RegExp, Mode?][] = [
    ['a user function that a vars entry maps', ['Map', 'f', 'L'], { vars: { f: '((t) => t + 1)' } }, /Map with the user function f, which an option of the host maps, is not in the profile/],
    ['a user function that a functions entry maps', ['Map', 'f', 'L'], { functions: { f: '((t) => t + 1)' } }, /Map with the user function f, which an option of the host maps, is not in the profile/],
    ['a user function that an operators entry maps', ['Map', 'f', 'L'], { operators: { f: ['hostF', 10] } }, /Map with the user function f, which an option of the host maps, is not in the profile/],
    ['a user function of a tuple<integer, integer> parameter over a list of tuples of reals', ['Map', 'gi', 'LP'], {}, /Map with the user function .*gi.*, whose parameter p is annotated tuple<integer, integer>, is not in the profile for an argument of the type tuple<real, real>/],
    ['a function literal of a tuple<integer, integer> parameter', ['Map', ['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], typed('p', 'tuple<integer, integer>')], 'LP'], {}, /Map with a function literal, whose parameter p is annotated tuple<integer, integer>, is not in the profile for an argument of the type tuple<real, real>/],
    ['a predicate of a tuple<integer, integer> parameter', ['Count', 'LP', ['Function', ['Greater', ['At', 'p', 1], 1], typed('p', 'tuple<integer, integer>')]], {}, /Count with a function literal, whose parameter p is annotated tuple<integer, integer>, is not in the profile/],
    ['a user function of a tuple<real, real> parameter over a list of tuples of numbers', ['Map', 'gr', 'LN'], {}, /Map with the user function .*gr.*, whose parameter p is annotated tuple<real, real>, is not in the profile for an argument of the type tuple<number, number>/],
    [
      'a quotient by a comprehension of numbers in the complex mode',
      ['Divide', 1.5, ['Comprehension', 'cn', ['Element', 'j', ['Range', 3, 2], ['Equal', 'xi', 0.1]]]],
      {},
      /the quotient .* of a list of the type list<number> is not in the profile in the complex mode/,
      'complex',
    ],
  ];
  test.each(rows)('%s declines', (_name, json, options, message, mode = 'strict') => {
    expect(() => compile(ce.box(json), { ...PROFILE, ...options, mode } as never)).toThrow(message);
  });

  test('the existing compiler calls the source of a vars entry for a user function, and declines the tuple annotations', () => {
    const existing = compile(ce.box(['Map', 'f', 'L']), { ...EXISTING, vars: { f: '((t) => t + 1)' } } as never) as CompilationResult<'javascript'>;
    expect((existing.run as unknown as (v: object) => unknown)({ L: [2] })).toEqual([3]);
    const route = compile(ce.box(['Map', 'f', 'L']), PROFILE as never) as CompilationResult<'javascript'>;
    expect((route.run as unknown as (v: object) => unknown)({ L: [2] })).toEqual([4]);
    expect(() => compile(ce.box(['Map', 'gi', 'LP']), EXISTING)).toThrow(/annotated 'tuple<integer, integer>'/);
    expect(() => compile(ce.box(['Map', 'gr', 'LN']), EXISTING)).toThrow(/annotated 'tuple<real, real>'/);
  });

  test('a quotient by a list literal and a sum of the comprehension stay admitted in the complex mode, with the shape of the existing compiler', () => {
    for (const json of [
      ['Divide', 1.5, ['List', 'cn', 1]],
      ['Add', ['Comprehension', 'cn', ['Element', 'j', ['Range', 3, 2]]], 1],
    ] as MathJsonExpression[]) {
      const route = compile(ce.box(json), { ...PROFILE, mode: 'complex' } as never) as CompilationResult<'javascript'>;
      const existing = compile(ce.box(json), { ...EXISTING, mode: 'complex' }) as CompilationResult<'javascript'>;
      expect(existing.code).not.toMatch(/_SYS\.cplx/);
      expect(same(run(route, [{} as never]), run(existing, [{} as never]))).toBe(true);
    }
  });
});

/** Every operation of `region`, in the order of the program. */
function allOperations(region: IRRegion): IROperation[] {
  const out: IROperation[] = [];
  for (const op of region.operations) {
    out.push(op);
    for (const inner of op.kind === 'if' ? [op.then, op.else] : 'body' in op ? [op.body as IRRegion] : 'rest' in op ? op.rest : [])
      out.push(...allOperations(inner));
  }
  return out;
}

describe('the representation of lists of tuples', () => {
  const prepare = (json: MathJsonExpression) =>
    lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(json),
        { cse: false, constantFold: false }
      )
    );

  test('a list of tuples is a list of tuple values, and its element is a tuple', () => {
    const program = prepare(fn(['At', ['Take', 'LP', 2], 1], LP));
    const at = allOperations(program.root).find((op) => op.kind === 'at')!;
    expect(String(at.operands[0].type)).toBe('list<tuple<real, real>>');
    expect(String(at.result!.type)).toBe('tuple<real, real>');
  });

  test('a list that holds the tuples of an input is written in place, its tuples are not', () => {
    // `take` makes a new outer array that holds the arrays of the input:
    // the append writes the new outer array only.
    const program = prepare(
      fn(['Block',
        ['Declare', 'out', "'list<tuple<real, real>>'", ['Take', 'LP', 1]],
        ['Loop', ['Assign', 'out', ['ListJoin', 'out', ['List', 'c']]], ['Element', 'c', 'LP']],
        'out'], LP)
    );
    const ops = allOperations(program.root);
    expect(ops.some((op) => op.kind === 'collection')).toBe(true);
    // No operation writes into an element of a list of tuples.
    const updates = inPlaceUpdates(program);
    for (const op of updates)
      expect(op.kind === 'replace-at' && String(op.operands[0].type).startsWith('tuple')).toBe(false);
  });

  test('a loop over a list is pure and shippable', () => {
    const program = prepare(
      fn(['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', ['At', 'c', 1]]], ['Element', 'c', 'LP']], 's'], LP)
    );
    const analysis = analyzeExecution(program);
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.holds).toBe(true);
    const loop = allOperations(program.root).find((op) => op.kind === 'loop')!;
    expect(loop.kind === 'loop' && loop.ascending).toBe(true);
  });
});

test('a loop over a list counts its passes against the iteration budget, as the existing compiler does', () => {
  const ce = new ComputeEngine();
  const json = fn(
    ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', 'c']], ['Element', 'c', 'L']], 's'],
    L
  );
  const options = { iterationBudget: 3 };
  const result = compile(ce.expr(json), { ...PROFILE, ...options } as never) as CompilationResult<'javascript'>;
  const existing = compile(ce.expr(json), { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
  expect(run(result, [[1, 2, 3]])).toBe(6);
  expect(run(existing, [[1, 2, 3]])).toBe(6);
  expect(() => run(result, [[1, 2, 3, 4]])).toThrow();
  expect(() => run(existing, [[1, 2, 3, 4]])).toThrow();
});

describe('the forms of slices 4 and 5 decline in the bigint mode', () => {
  // The bigint policy admits none of them: each declines with a message of
  // the mode (`Range` with a step is a form of the bigint mode itself).
  const ce = new ComputeEngine();
  ce.declare('I', 'list<integer>');
  ce.declare('LP', 'list<tuple<integer, integer>>');
  ce.declare('n', 'integer');
  expect(
    executeEpsil(ce, 'function f(t: integer) { 2 * t }\nfunction fa(a: integer, b: integer) { a + b }').diagnostics
  ).toEqual([]);
  test.each([
    ['At of a list of tuples', ['At', 'LP', 1]],
    ['Take of a list of tuples', ['Take', 'LP', 1]],
    ['a list literal of tuples', ['List', ['Tuple', 1, 2], ['Tuple', 'n', 3]]],
    ['Map of a user function', ['Map', 'f', 'I']],
    ['Reduce by a user function', ['Reduce', 'I', 'fa', 0]],
    ['RotateLeft', ['RotateLeft', 'I', 1]],
    ['RotateRight', ['RotateRight', 'I']],
    ['ListJoin', ['ListJoin', 'I', 'I']],
    [
      'a loop over a list',
      fn(['Block', ['Declare', 's', "'integer'", 0], ['Loop', ['Assign', 's', ['Add', 's', 'c']], ['Element', 'c', 'V']], 's'], ['V', 'list<integer>']),
    ],
    ['a local list of tuples', fn(['Block', ['Declare', 'Q', "'list<tuple<integer, integer>>'", ['List']], 'Q'], N)],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => {
    expect(() => compile(ce.box(json), { ...PROFILE, mode: 'bigint' } as never)).toThrow(/bigint/);
  });
});
