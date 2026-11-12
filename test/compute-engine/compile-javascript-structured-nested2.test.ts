import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  lowerStructuredFragment,
  matrixResultCanBeAbsent,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import { verifyJavaScriptProgram } from '../../src/compute-engine/compilation/javascript-structured-policy';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
import { hostArrays } from '../../src/compute-engine/compilation/structured-execution';
import type {
  IROperation,
  IRProgram,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slices 2 and 3 of docs/plans/2026-11-11-structured-nested-lists-and-matrices.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): the matrix functions (`Determinant`, `Trace`, `Inverse`,
// `MatrixPower`, `MatrixMultiply`, `Dot` and `Norm` of a list of lists,
// `Transpose`, `RowReduce`, `Diagonal`, `Flatten`), each the runtime helper
// of the existing emitter; a matrix result that can have no value (a
// singular inverse, a product whose dimensions the types do not prove to
// agree), admitted only as the value of the program, an operand of a matrix
// function or the list of `At`; element-wise arithmetic of lists of lists;
// and the functions over rows.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) with the same shape at every depth (`NaN` in place of a
// matrix on both, `undefined` for an absent row); the inputs must be the
// same after the call as a deep copy taken before it, at every depth; a
// second call gives the same value; after the host writes into the result
// (at every depth), a third call with fresh inputs gives the value again. The
// value agrees with the interpreter within 1e-9 relative, or by the caveats
// of compiled code (`NaN` or `undefined` where the interpreter has no
// number).

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

const A: [string, string] = ['A', 'matrix'];
const B: [string, string] = ['B', 'matrix'];
const A22: [string, string] = ['A', 'matrix<2x2>'];
const B22: [string, string] = ['B', 'matrix<2x2>'];
const A23: [string, string] = ['A', 'matrix<2x3>'];
const B32: [string, string] = ['B', 'matrix<3x2>'];
const M: [string, string] = ['M', 'list<list<real>>'];
const MI: [string, string] = ['MI', 'list<list<integer>>'];
const R3: [string, string] = ['R3', 'list<list<list<real>>>'];
const L: [string, string] = ['L', 'list<real>'];
const V2: [string, string] = ['v', 'vector<2>'];
const V: [string, string] = ['v', 'list<real>'];
const X: [string, string] = ['x', 'real'];
const P: [string, string] = ['p', 'real'];
const I: [string, string] = ['i', 'integer'];
const J: [string, string] = ['j', 'integer'];
const N: [string, string] = ['n', 'integer'];

type Arg = number | Arg[] | undefined;

/** The value of a call, or `THROWS` when the call throws (a matrix that is
 *  not square throws in `_SYS.inv` and `_SYS.matpow` on both compilers). */
const THROWS = Symbol('throws');
function run(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  try {
    return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
  } catch {
    return THROWS;
  }
}

/** The same doubles and the same shape, at every depth. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

/** Write into every array of `value`, at every depth (the host owns the
 *  result). */
function scribble(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (let k = 0; k < value.length; k++) {
    scribble(value[k]);
    if (!Array.isArray(value[k])) value[k] = 12345;
  }
  value.push(54321);
}

/** Within 1e-9 relative of the interpreter, element by element at every
 *  depth; `NaN` or `undefined` where the interpreter gives no number. */
function close(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((v, i) => close(v, expected[i]))
    );
  if (value === undefined) return expected === undefined;
  if (typeof value !== 'number') return false;
  if (typeof expected !== 'number' || !Number.isFinite(expected))
    return Number.isNaN(value) || value === expected;
  return (
    value === expected ||
    Math.abs(value - expected) <= 1e-9 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

/** The MathJSON of an argument: nested arrays are lists. */
function boxArg(a: Arg): MathJsonExpression {
  if (!Array.isArray(a)) return a ?? 'Nothing';
  return ['List', ...a.map(boxArg)] as MathJsonExpression;
}

/** The numbers, or nested arrays of numbers, of a value of the interpreter;
 *  `undefined` where it is not a number. */
function valueOf(value: Expression): unknown {
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return value.ops.map(valueOf);
  return isNumber(value) && value.im === 0 ? value.re : undefined;
}

function interpret(ce: ComputeEngine, json: MathJsonExpression, args: readonly Arg[]): unknown {
  const evaluated = ce.expr(['Apply', json, ...args.map(boxArg)] as MathJsonExpression).evaluate();
  return valueOf(
    (evaluated.isCollection && !isFunction(evaluated, 'List') && !isFunction(evaluated, 'Tuple')
      ? ce.function('List', [...evaluated.each()])
      : evaluated
    ).N()
  );
}

type Program = {
  readonly name: string;
  /** The program, or the name of a function of `epsil`. */
  readonly json?: MathJsonExpression;
  readonly epsil?: string;
  readonly entry?: string;
  readonly args: readonly (readonly Arg[])[];
  /** No comparison with the interpreter (the caveats of compiled code, or
   *  a defect of the existing compiler), for every list of arguments or for
   *  those that the function selects. */
  readonly existingOnly?: boolean | ((args: readonly Arg[]) => boolean);
  /** The `complex` mode compiles the program too, with the values of the
   *  existing compiler in that mode (a program of flat lists). */
  readonly complex?: boolean;
};

function programOf(program: Program): { ce: ComputeEngine; expr: Expression; json: MathJsonExpression } {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  if (program.epsil !== undefined) {
    expect(executeEpsil(ce, program.epsil).diagnostics).toEqual([]);
    const literal = (ce.lookupDefinition(program.entry!) as { operator: { _lambdaLiteral: Expression } }).operator._lambdaLiteral;
    return { ce, expr: literal, json: literal.json as MathJsonExpression };
  }
  return { ce, expr: ce.expr(program.json!), json: program.json! };
}

/** The program, compiled with the profile and with the existing compiler,
 *  and run on each list of arguments; in the `complex` mode the profile
 *  declines it. */
function check(program: Program): void {
  const { ce, expr, json } = programOf(program);
  const result = compile(expr, { ...PROFILE, mode: 'strict' } as never) as CompilationResult<'javascript'>;
  const existing = compile(expr, { ...EXISTING, mode: 'strict' }) as CompilationResult<'javascript'>;
  for (const args of program.args) {
    const inputs = structuredClone(args) as Arg[];
    const value = run(result, inputs);
    const reference = run(existing, structuredClone(args) as Arg[]);
    expect([args, value, same(value, reference)]).toEqual([args, value, true]);
    // The inputs are not written, at any depth, and a second call gives the
    // same value.
    expect([args, same(inputs, args)]).toEqual([args, true]);
    expect([args, same(run(result, inputs), value)]).toEqual([args, true]);
    // The host writes into the result (which can hold the rows of an
    // input, as on the existing compiler: a result is read-only): a third
    // call with fresh inputs is not changed.
    scribble(value);
    expect([args, same(run(result, structuredClone(args) as Arg[]), reference)]).toEqual([args, true]);
    const existingOnly =
      typeof program.existingOnly === 'function'
        ? program.existingOnly(args)
        : program.existingOnly === true;
    if (existingOnly || reference === THROWS) continue;
    const expected = interpret(ce, json, args);
    expect([args, reference, expected, close(reference, expected)]).toEqual([args, reference, expected, true]);
  }
  if (program.complex !== true) {
    expect(declineCode(() => compile(expr, { ...PROFILE, mode: 'complex' } as never))).toBe('outside-profile');
    return;
  }
  const complex = compile(expr, { ...PROFILE, mode: 'complex' } as never) as CompilationResult<'javascript'>;
  const existingComplex = compile(expr, { ...EXISTING, mode: 'complex' }) as CompilationResult<'javascript'>;
  for (const args of program.args) {
    const value = run(complex, structuredClone(args) as Arg[]);
    expect([args, value, same(value, run(existingComplex, structuredClone(args) as Arg[]))]).toEqual([args, value, true]);
  }
}

/** The diagnostic code of a compilation that throws, or `undefined`. */
function declineCode(f: () => unknown): string | undefined {
  try {
    f();
  } catch (error) {
    return (error as { diagnostic?: { code?: string } }).diagnostic?.code ?? 'no diagnostic';
  }
  return undefined;
}

// Square matrices (a singular one, signed zeros, extreme doubles), a
// rectangular one (which throws in `Inverse` and `MatrixPower` on both), and
// rows of different lengths, an empty list and an empty row for the inputs
// typed `list<list<real>>`.
const SQUARE: Arg[] = [[[1, 2], [3, 4]], [[-0, 0.5], [7, -2]], [[1, 2], [2, 4]], [[2]], [[1e300, 1], [1, 1e-300]], [[0, 0], [0, -0]]];
const MATRICES: Arg[] = [...SQUARE, [[1, 2, 3], [4, 5, 6]], [[-0, 0.5, 1e300], [7, -2, 5e-324]]];
const RAGGED: Arg[] = [[], [[]], [[1, 2], [3]], [[1, 2], [3, 4]], [[-0, 1e300], [5e-324, 2]]];
const INTEGER_ROWS: Arg[] = [[], [[1, 2], [3, 4]], [[4, -5], [7]]];
const SQUARE22: Arg[] = [[[1, 2], [3, 4]], [[-0, 0.5], [7, -2]], [[1, 2], [2, 4]]];
const RANK3: Arg[] = [[], [[[1, 2], [3]], [[4]]], [[[]], [[-0, 5], [6, 7, 8]]]];
const LISTS: Arg[] = [[], [1], [3, -4], [-0, 0.5, 2]];

const one = (values: readonly Arg[]) => values.map((v) => [v]);
/** Whether a matrix argument is not square, or has an element beyond 1e100
 *  in magnitude: the interpreter gives an error for a matrix that is not
 *  square (`_SYS.trace` and `_SYS.matpow(M, 1)` give a number there, a
 *  defect of the existing compiler), and computes the large products
 *  exactly. */
const notSquareOrHuge = (args: readonly Arg[]): boolean =>
  args.some(
    (a) =>
      Array.isArray(a) &&
      a.some((row) => Array.isArray(row) && (row.length !== a.length || row.some((x) => typeof x === 'number' && Math.abs(x) > 1e100)))
  );
const pairs = (a: readonly Arg[], b: readonly Arg[]) => a.flatMap((x) => b.map((y) => [x, y]));

//
// Part (a): the matrix functions.
//

const MATRIX_FUNCTIONS: Program[] = [
  { name: 'Determinant of a matrix', json: fn(['Determinant', 'A'], A), args: one(MATRICES), existingOnly: true },
  { name: 'Determinant of a square matrix', json: fn(['Determinant', 'A'], A), args: one(SQUARE) },
  { name: 'Determinant of rows of different lengths', json: fn(['Determinant', 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Determinant of rows of integers', json: fn(['Determinant', 'MI'], MI), args: one(INTEGER_ROWS), existingOnly: true },
  { name: 'Determinant of a literal of rows', json: fn(['Determinant', ['List', ['List', 1, 2], ['List', 3, 'x']]], X), args: [[0.5], [-0], [6]] },
  { name: 'Determinant in arithmetic', json: fn(['Add', ['Multiply', 2, ['Determinant', 'A']], 'x'], A, X), args: SQUARE.map((m) => [m, 0.25]) },
  { name: 'Trace of a matrix', json: fn(['Trace', 'A'], A), args: one(MATRICES), existingOnly: notSquareOrHuge },
  { name: 'Trace of a matrix<2x2> plus one', json: fn(['Add', ['Trace', 'A'], 1], A22), args: one(SQUARE22) },
  { name: 'Inverse', json: fn(['Inverse', 'A'], A), args: one(MATRICES) , existingOnly: notSquareOrHuge },
  { name: 'Inverse of rows of different lengths', json: fn(['Inverse', 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Power -1 (Inverse)', json: fn(['Power', 'A', -1], A), args: one(SQUARE) , existingOnly: notSquareOrHuge },
  { name: 'MatrixPower 0', json: fn(['MatrixPower', 'A', 0], A), args: one(MATRICES) , existingOnly: notSquareOrHuge },
  { name: 'MatrixPower 1', json: fn(['MatrixPower', 'A', 1], A), args: one(MATRICES), existingOnly: notSquareOrHuge },
  { name: 'MatrixPower 3', json: fn(['MatrixPower', 'A', 3], A), args: one(MATRICES) , existingOnly: notSquareOrHuge },
  { name: 'MatrixPower -2', json: fn(['MatrixPower', 'A', -2], A), args: one(SQUARE) , existingOnly: notSquareOrHuge },
  { name: 'MatrixPower n', json: fn(['MatrixPower', 'A', 'n'], A, N), args: SQUARE.flatMap((m) => [-1, 0, 1, 2, 5].map((n) => [m, n])) , existingOnly: notSquareOrHuge },
  { name: 'Power 2 of a matrix (MatrixPower)', json: fn(['Power', 'A', 2], A), args: one(SQUARE) , existingOnly: notSquareOrHuge },
  { name: 'MatrixPower of rows of different lengths', json: fn(['MatrixPower', 'M', 2], M), args: one(RAGGED), existingOnly: true },
  { name: 'MatrixMultiply of two matrices', json: fn(['MatrixMultiply', 'A', 'B'], A, B), args: pairs(MATRICES, MATRICES), existingOnly: true },
  { name: 'MatrixMultiply of two square matrices', json: fn(['MatrixMultiply', 'A', 'B'], A, B), args: pairs(SQUARE, SQUARE) },
  { name: 'MatrixMultiply of matrix<2x3> and matrix<3x2>', json: fn(['MatrixMultiply', 'A', 'B'], A23, B32), args: [[[[1, 2, 3], [4, 5, 6]], [[1, -0], [0.5, 2], [-3, 1]]]] },
  { name: 'MatrixMultiply of a matrix and a list', json: fn(['MatrixMultiply', 'A', 'v'], A, V), args: pairs(MATRICES, LISTS), existingOnly: true },
  { name: 'MatrixMultiply of a list and a matrix', json: fn(['MatrixMultiply', 'v', 'A'], V, A), args: pairs(LISTS, MATRICES), existingOnly: true },
  { name: 'MatrixMultiply of two lists', json: fn(['MatrixMultiply', 'v', 'L'], V, L), args: pairs(LISTS, LISTS), existingOnly: true, complex: true },
  { name: 'MatrixMultiply of rows of different lengths', json: fn(['MatrixMultiply', 'M', 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Dot of a matrix<2x2> and a vector<2>', json: fn(['Dot', 'A', 'v'], A22, V2), args: SQUARE22.map((m) => [m, [0.5, -0]]) },
  { name: 'Dot of a list and a matrix', json: fn(['Dot', 'v', 'A'], V, A), args: pairs(LISTS, SQUARE), existingOnly: true },
  { name: 'Transpose', json: fn(['Transpose', 'A'], A), args: one(MATRICES) },
  { name: 'Transpose of a literal of rows', json: fn(['Transpose', ['List', ['List', 1, 'x', 2], ['List', 3, 4, 'x']]], X), args: [[0.5], [-0]] },
  { name: 'RowReduce', json: fn(['RowReduce', 'A'], A), args: one(MATRICES), existingOnly: true },
  { name: 'RowReduce of rows of different lengths', json: fn(['RowReduce', 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Diagonal of a matrix', json: fn(['Diagonal', 'A'], A), args: one(MATRICES) },
  // The interpreter keeps `Diagonal([])` unevaluated, where the existing
  // compiler gives `[]` (a known limitation).
  { name: 'Diagonal of a list', json: fn(['Diagonal', 'v'], V), args: one(LISTS), existingOnly: (args) => (args[0] as Arg[]).length === 0 },
  { name: 'Flatten of a matrix', json: fn(['Flatten', 'A'], A), args: one(MATRICES) },
  { name: 'Flatten of rank 3', json: fn(['Flatten', 'R3'], R3), args: one(RANK3) },
  { name: 'Flatten of a list', json: fn(['Flatten', 'v'], V), args: one(LISTS), complex: true },
  { name: 'Norm of a matrix', json: fn(['Norm', 'A'], A), args: one(MATRICES) },
  { name: 'Norm of rank 3', json: fn(['Norm', 'R3'], R3), args: one(RANK3), existingOnly: true },
  { name: 'Norm of a matrix with the order 1', json: fn(['Norm', 'A', 1], A), args: one(MATRICES) },
  { name: 'Norm of a matrix with the order Infinity', json: fn(['Norm', 'A', 'PositiveInfinity'], A), args: one(MATRICES) },
  { name: 'Norm of a matrix with an order', json: fn(['Norm', 'A', 'p'], A, P), args: MATRICES.flatMap((m) => [1, 2, 3, 0.5].map((p) => [m, p])), existingOnly: true },
  { name: 'Norm of a list with an order', json: fn(['Norm', 'v', 'p'], V, P), args: LISTS.flatMap((l) => [1, 2, 3, 0.5].map((p) => [l, p])), complex: true },
  // A matrix that can have no value as the operand of a matrix function and
  // the list of `At`: `NaN` or `undefined` on both compilers.
  { name: 'Trace of an Inverse', json: fn(['Trace', ['Inverse', 'A']], A), args: one(SQUARE) },
  { name: 'Determinant of an Inverse, in arithmetic', json: fn(['Add', ['Determinant', ['Inverse', 'A']], 1], A), args: one(SQUARE) },
  { name: 'Transpose of an Inverse', json: fn(['Transpose', ['Inverse', 'A']], A), args: one(SQUARE) },
  { name: 'Inverse of an Inverse', json: fn(['Inverse', ['Inverse', 'A']], A), args: one(SQUARE) },
  { name: 'Norm of a product', json: fn(['Norm', ['MatrixMultiply', 'A', 'B']], A, B), args: pairs(MATRICES, MATRICES), existingOnly: true },
  { name: 'an element of an Inverse', json: fn(['At', ['Inverse', 'A'], 'i', 'j'], A, I, J), args: SQUARE.flatMap((m) => [[m, 1, 2], [m, 2, 1], [m, 3, 1]]) },
  { name: 'a row of an Inverse', json: fn(['At', ['Inverse', 'A'], 'i'], A, I), args: SQUARE.flatMap((m) => [[m, 1], [m, -1], [m, 3]]), existingOnly: true },
  { name: 'Length of a row of an Inverse', json: fn(['Length', ['At', ['Inverse', 'A'], 'i']], A, I), args: SQUARE.flatMap((m) => [[m, 1], [m, 3]]), existingOnly: true },
  { name: 'an Inverse as the value of a Block', json: fn(['Block', ['Declare', 'y', "'real'", ['Determinant', 'A']], ['Inverse', 'A']], A), args: one(SQUARE) },
  { name: 'a product of a matrix<2x2> and a vector<2>, then its norm', json: fn(['Add', ['Norm', ['MatrixMultiply', 'A', 'v']], 'x'], A22, V2, X), args: SQUARE22.map((m) => [m, [0.5, -2], 0.5]) },
];

//
// Part (b): element-wise arithmetic of lists of lists, with scalars, and of
// two lists of lists whose lengths are equal by construction at every depth.
//

const K: [string, string] = ['k', 'integer'];
const ELEMENTWISE: Program[] = [
  { name: 'a matrix plus a number', json: fn(['Add', 'A', 1], A), args: one(MATRICES) },
  { name: 'a matrix plus itself', json: fn(['Add', 'A', 'A'], A), args: one(MATRICES) },
  { name: 'two matrix<2x2>', json: fn(['Add', 'A', 'B'], A22, B22), args: pairs(SQUARE22, SQUARE22) },
  { name: 'the negation of a matrix', json: fn(['Negate', 'A'], A), args: one(MATRICES) },
  { name: 'a number times a matrix', json: fn(['Multiply', 'x', 'A'], X, A), args: MATRICES.flatMap((m) => [[-2, m], [-0, m], [0.1, m]]) },
  { name: 'a matrix over a number', json: fn(['Divide', 'A', 2], A), args: one(MATRICES) },
  { name: 'a number over a matrix', json: fn(['Divide', 2, 'A'], A), args: one(MATRICES), existingOnly: true },
  { name: 'a matrix minus itself', json: fn(['Subtract', 'A', 'A'], A), args: one(MATRICES) },
  { name: 'rows of different lengths plus a number', json: fn(['Add', 'M', 1], M), args: one(RAGGED) },
  { name: 'rows of different lengths minus themselves', json: fn(['Add', 'M', ['Negate', 'M']], M), args: one(RAGGED) },
  { name: 'a literal of rows plus a number', json: fn(['Add', ['List', ['List', 1, 2], ['List', 3, 'x']], 1], X), args: [[0.5], [-0]] },
  { name: 'rows of integers plus an integer', json: fn(['Add', 'MI', 'k'], MI, K), args: INTEGER_ROWS.map((m) => [m, 3]) },
  { name: 'rank 3 plus a number', json: fn(['Add', 'R3', 'x'], R3, X), args: RANK3.map((m) => [m, -0]) },
  { name: 'a transpose plus a number', json: fn(['Add', ['Transpose', 'A'], 1], A), args: one(MATRICES) },
  { name: 'a matrix<2x2> plus its transpose', json: fn(['Add', 'A', ['Transpose', 'A']], A22), args: one(SQUARE22) },
  { name: 'a third times rows', json: fn(['Multiply', ['Rational', 1, 3], 'M'], M), args: one(RAGGED) },
  { name: 'a matrix plus two numbers', json: fn(['Add', 'A', 'x', 'p'], A, X, P), args: MATRICES.map((m) => [m, 0.1, 0.2]) },
  { name: 'twice a matrix plus a number', json: fn(['Add', ['Multiply', 2, 'A'], 'x'], A, X), args: MATRICES.map((m) => [m, 0.1]) },
  { name: 'an element of a sum', json: fn(['At', ['Add', 'A', 1], 'i', 'j'], A, I, J), args: SQUARE.flatMap((m) => [[m, 1, 1], [m, 2, -1], [m, 3, 1]]), existingOnly: true },
  { name: 'the number of rows of a sum', json: fn(['Length', ['Add', 'A', 1]], A), args: one(MATRICES) },
  { name: 'a sum written in place', json: fn(['ReplaceAt', ['Add', 'A', 1], 1, 1, 'x'], A, X), args: MATRICES.map((m) => [m, 9]) },
  { name: 'a sum of a product', json: fn(['Add', ['MatrixMultiply', 'A', 'B'], 1], A23, B32), args: [[[[1, 2, 3], [4, 5, 6]], [[1, -0], [0.5, 2], [-3, 1]]]] },
];

//
// Part (c): functions over rows: the sum and the product of the rows of a
// matrix, and `Map` of a function literal over the rows.
//

const lambda = (body: MathJsonExpression, ...names: string[]): MathJsonExpression =>
  ['Function', body, ...names] as MathJsonExpression;
const ROWS: Program[] = [
  { name: 'the sum of the rows of a matrix', json: fn(['Sum', 'A'], A), args: one(MATRICES) },
  { name: 'the product of the rows of a matrix', json: fn(['Product', 'A'], A), args: one(MATRICES), existingOnly: notSquareOrHuge },
  { name: 'the sum of the rows of a matrix of integers', json: fn(['Sum', 'A'], ['A', 'matrix<integer>']), args: [[[[1, 2], [3, 4]]], [[[5, -6, 7]]]] },
  { name: 'the sum of the rows of a literal of rows', json: fn(['Sum', ['List', ['List', 1, 2], ['List', 3, 'x']]], X), args: [[-0], [0.5]] },
  { name: 'the sum of the rows of a matrix<2x3>, plus a number', json: fn(['Add', ['Sum', 'A'], 1], A23), args: [[[[1, 2, 3], [4, 5, 6]]], [[[-0, 1e300, 1], [-0, 1e300, 2]]]] },
  { name: 'the sum of the rows of a sum', json: fn(['Sum', ['Add', 'A', 'x']], A, X), args: MATRICES.map((m) => [m, 0.5]) },
  { name: 'Map of the sum of each row', json: fn(['Map', lambda(['Sum', 'r'], 'r'), 'A'], A), args: one(MATRICES) },
  { name: 'Map of the length of each row', json: fn(['Map', lambda(['Length', 'r'], 'r'), 'M'], M), args: one(RAGGED) },
  { name: 'Map of the first element of each row', json: fn(['Map', lambda(['At', 'r', 1], 'r'), 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Map of the norm of each row', json: fn(['Map', lambda(['Norm', 'r'], 'r'), 'A'], A), args: one(MATRICES) },
  { name: 'Map of the maximum of each row', json: fn(['Map', lambda(['Max', 'r'], 'r'), 'M'], M), args: one(RAGGED), existingOnly: true },
  { name: 'Map of twice each row', json: fn(['Map', lambda(['Multiply', 2, 'r'], 'r'), 'A'], A), args: one(MATRICES) },
  { name: 'Map of each row plus a number', json: fn(['Map', lambda(['Add', 'r', 'x'], 'r'), 'M'], M, X), args: RAGGED.map((m) => [m, 0.5]) },
  { name: 'Map of each row itself', json: fn(['Map', lambda('r', 'r'), 'M'], M), args: one(RAGGED) },
  { name: 'Map of rows of integers', json: fn(['Map', lambda(['Add', 'r', 1], 'r'), 'MI'], MI), args: one(INTEGER_ROWS) },
  { name: 'Map of the rows of a transpose', json: fn(['Map', lambda(['Sum', 'r'], 'r'), ['Transpose', 'A']], A), args: one(MATRICES) },
  { name: 'an element of a Map of rows', json: fn(['At', ['Map', lambda(['Multiply', 2, 'r'], 'r'), 'A'], 'i', 'j'], A, I, J), args: SQUARE.flatMap((m) => [[m, 1, 2], [m, 2, 1], [m, 3, 1]]), existingOnly: true },
];

//
// Part (d): products decided by the types (`matrix`, `matrix<m×n>` factors):
// `_SYS.mul(A, B)`, `NaN` for dimensions that do not agree.
//

const W2: [string, string] = ['w', 'vector<2>'];
const PRODUCTS: Program[] = [
  { name: 'a product of two matrices', json: fn(['Multiply', 'A', 'B'], A, B), args: pairs(MATRICES, MATRICES), existingOnly: true },
  { name: 'a product of two square matrices', json: fn(['Multiply', 'A', 'B'], A, B), args: pairs(SQUARE22, SQUARE22) },
  { name: 'a product of two matrix<2x2>', json: fn(['Multiply', 'A', 'B'], A22, B22), args: pairs(SQUARE22, SQUARE22) },
  { name: 'a product of a matrix<2x3> and a matrix<3x2>', json: fn(['Multiply', 'A', 'B'], A23, B32), args: [[[[1, 2, 3], [4, 5, 6]], [[1, -0], [0.5, 2], [-3, 1]]]] },
  { name: 'a product of a matrix<2x2> and a vector<2>', json: fn(['Multiply', 'A', 'v'], A22, V2), args: SQUARE22.map((m) => [m, [0.5, -0]]) },
  { name: 'a product of a vector<2> and a matrix<2x2>', json: fn(['Multiply', 'v', 'A'], V2, A22), args: SQUARE22.map((m) => [[0.5, -0], m]) },
  { name: 'a product of a matrix and a list', json: fn(['Multiply', 'A', 'v'], A, V), args: pairs(MATRICES, LISTS), existingOnly: true },
  { name: 'M·v + w', json: fn(['Add', ['Multiply', 'A', 'v'], 'w'], A22, V2, W2), args: SQUARE22.map((m) => [m, [0.5, -0], [1, 2]]) },
  { name: 'the trace of a product', json: fn(['Trace', ['Multiply', 'A', 'B']], A, B), args: pairs(SQUARE, SQUARE), existingOnly: true },
  { name: 'an element of a product', json: fn(['At', ['Multiply', 'A', 'B'], 'i', 'j'], A, B, I, J), args: [[SQUARE[0], SQUARE[1], 1, 2], [SQUARE[0], MATRICES[6], 2, 3], [[[1, 2, 3]], SQUARE[0], 1, 1]], existingOnly: true },
  { name: 'a product plus a number, element-wise', json: fn(['Add', ['Multiply', 'A', 'B'], 'x'], A22, B22, X), args: SQUARE22.map((m) => [m, m, 0.5]) },
];

describe.each([
  ['matrix functions', MATRIX_FUNCTIONS],
  ['element-wise arithmetic', ELEMENTWISE],
  ['functions over rows', ROWS],
  ['products by type', PRODUCTS],
] as const)('%s', (_label, programs) => {
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, program) => check(program));
});

//
// Declines that stay, each with its message.
//

describe('the declines of slices 2 and 3', () => {
  const ce = new ComputeEngine();
  ce.declare('M', 'list<list<real>>');
  ce.declare('MI', 'list<list<integer>>');
  ce.declare('A', 'matrix');
  ce.declare('R3', 'list<list<list<real>>>');
  ce.declare('i', 'integer');
  ce.declare('x', 'real');
  ce.declare('c', 'boolean');
  ce.declare('v', 'list<real>');
  ce.declare('N', 'list<list<real>>');
  ce.declare('B', 'matrix');
  const rows: [string, MathJsonExpression, RegExp][] = [
    // A matrix that can have no value, used where the existing emitter gives
    // another value or throws.
    ['Length of an Inverse', ['Length', ['Inverse', 'A']], /the value of Inverse\(A\) can be a number in place of a list .* as an operand of Length/],
    ['Flatten of an Inverse', ['Flatten', ['Inverse', 'A']], /the value of Inverse\(A\) can be a number in place of a list .* as an operand of Flatten/],
    ['an If of an Inverse', ['If', 'c', ['Inverse', 'A'], 'A'], /the value of Inverse\(A\) can be a number in place of a list .* as an operand of If/],
    ['a Map over an Inverse', ['Map', ['Function', ['Length', 'r'], 'r'], ['Inverse', 'A']], /Inverse\(A\) can be a number in place of a list|Map/],
    ['an Inverse as a local', ['Block', ['Declare', 'S', "'matrix'", ['Inverse', 'A']], ['Determinant', 'S']], /Inverse\(A\) can be a number in place of a list .* as an operand of Declare|local/],
    ['a product of rows of different lengths as a list', ['Length', ['MatrixMultiply', 'M', 'M']], /can be a number in place of a list .* as an operand of Length/],
    // The existing compiler reads the operand of a matrix function with
    // `collArg()`, which declines a value whose type is not a list.
    ['a matrix function of a product', ['Determinant', ['MatrixMultiply', 'A', 'A']], /Determinant of MatrixMultiply\(A, A\) of the type matrix \| number \| vector is not in the profile, which reads an operand that is a list by its type/],
    ['RowReduce of rows that can be empty', ['Length', ['RowReduce', 'M']], /the value of RowReduce\(M\) can be a number in place of a list/],
    // Element-wise arithmetic whose shapes the types do not settle.
    ['two matrices of no stated dimensions', ['Add', 'A', 'B'], /Add of the lists A and B, whose lengths are not equal by construction at every depth, is not in the profile/],
    ['two lists of lists of two names', ['Add', 'M', 'N'], /Add of the lists M and N, whose lengths are not equal by construction at every depth, is not in the profile/],
    ['a list of lists and a list', ['Add', 'M', 'v'], /Add of the lists M and v of the ranks 2 and 1 is not in the profile, which reads lists of one rank/],
    // Part (d): a product decided by the types. A `list<list<…>>` factor
    // declines (a user decision of 2026-11-11: declare a matrix), and a
    // product that can have no value is used only where an Inverse is.
    ['a product of two lists of lists', ['Multiply', 'M', 'N'], /Multiply with the list operand M of the type `list<list<real>>` is not in the profile, which reads a product of lists whose types state their ranks: declare M a matrix/],
    ['a product of a matrix and a list of lists', ['Multiply', 'A', 'M'], /declare M a matrix/],
    ['a product of three factors', ['Multiply', 'x', 'A', 'B'], /which reads a product of two matrices, or of a matrix and a list, with no other factor/],
    ['a product that can have no value, plus a number', ['Add', ['Multiply', 'A', 'B'], 1], /the value of A \* B can be a number in place of a list .* as an operand of Add/],
    ['a power of a list of lists', ['Power', 'M', 2], /Power with the list operand M is not in the profile/],
    ['an Inverse plus a number', ['Add', ['Inverse', 'A'], 1], /the value of Inverse\(A\) can be a number in place of a list .* as an operand of Add/],
    ['a row read plus a number', ['Add', ['At', 'M', 'i'], 1], /the row read .* is not in the profile as an operand of Add/],
    // Functions over rows that stay declined.
    ['the sum of rows of different lengths', ['Sum', 'M'], /Sum of the rows of M of the type list<list<real>> is not in the profile, which folds the rows of a matrix of one row or more by its type/],
    ['the product of rows of different lengths', ['Product', 'M'], /Product of the rows of M of the type list<list<real>> is not in the profile/],
    ['the sum of the rows of a transpose (it can have no row)', ['Sum', ['Transpose', 'A']], /Sum of the rows of Transpose\(A\) of the type matrix is not in the profile/],
    ['Map of the rows of rank 3', ['Map', ['Function', ['Length', 'r'], 'r'], 'R3'], /Map of "R3" of the type `list<list<list<real>>>` is not in the profile, which maps the rows of a list of lists of reals or of integers of rank 2/],
    ['Map of an operator over rows', ['Map', 'Sin', 'M'], /Map of M of the type `list<list<real>>` is not in the profile, which reads a list or a tuple of reals or of integers/],
    ['Filter of rows', ['Filter', 'M', ['Function', ['Less', ['Length', 'r'], 2], 'r']], /Filter .* is not in the profile/],
    ['Reduce of rows', ['Reduce', 'M', 'Add'], /Reduce .* is not in the profile/],
    ['the maximum of a list of lists', ['Max', 'M'], /Max of one operand of the type `list<list<real>>` is not in the profile/],
    // The types do not settle the value: rows of different lengths, a rank
    // other than 2, an exponent that is not an integer.
    ['Transpose of rows of different lengths', ['Transpose', 'M'], /Transpose of M of the type list<list<real>> is not in the profile, which reads a matrix by its type/],
    ['Transpose of rank 3', ['Transpose', 'R3'], /Transpose of "R3" of the type `list<list<list<real>>>` is not in the profile, which reads a matrix/],
    ['Diagonal of rows of different lengths', ['Diagonal', 'M'], /Diagonal of M of the type list<list<real>> is not in the profile, which reads a matrix by its type/],
    ['Trace of rows of different lengths', ['Trace', 'M'], /Trace of the type number \| tensor is not in the profile/],
    ['MatrixPower with a real exponent', ['MatrixPower', 'A', 'x'], /MatrixPower with x of the type `real` is not in the profile, which reads an integer exponent/],
    ['Norm with a named order', ['Norm', 'A', "'Frobenius'"], /unsupported head String/],
    ['a matrix function of a row read', ['Determinant', ['At', 'R3', 'i']], /the row read .*, which is undefined for an index out of range, is not in the profile as an operand of Determinant/],
    ['IdentityMatrix (the existing compiler declines)', ['IdentityMatrix', 3], /IdentityMatrix/],
    ['Shape (a measure at run time)', ['Shape', 'A'], /Shape/],
    // A list that can hold an absent row (a row read placed in a list): the
    // existing emitter gives `NaN` for that row, the route an empty row.
    ['Map over a list that holds a row read', ['Map', ['Function', ['Negate', 'r'], 'r'], ['ReplaceAt', 'M', -1, ['At', 'M', 'i']]], /Map of a list of lists is not in the profile in a program that places the row read At\(M, i\) in a list/],
    ['a quotient of a literal that holds a row read', ['Divide', ['List', ['At', 'M', 'i'], ['List', 1, -1]], 3], /Multiply of a list of lists is not in the profile in a program that places the row read/],
    ['the sum of the rows of a literal that holds a row read (not a matrix by its type)', ['Sum', ['List', ['At', 'A', 'i'], ['List', 1, 2]]], /Sum of the rows of .* of the type list<vector> is not in the profile/],
    // `Flatten([])` has the type `list` (any elements).
    ['an element of Flatten of the empty list', ['At', ['Flatten', ['List']], 2], /Flatten of the type list is not in the profile, which makes a list of numbers by its type/],
    ['Reshape (a measure at run time)', ['Reshape', 'v', ['Tuple', 2, 2]], /Reshape/],
  ];
  test.each(rows)('%s declines', (_name, json, message) => {
    const attempt = () => compile(ce.box(json), PROFILE as never);
    expect(declineCode(attempt)).toBe('outside-profile');
    expect(attempt).toThrow(message);
  });

  test('an Inverse as the value of a helper declines', () => {
    const engine = new ComputeEngine();
    expect(
      executeEpsil(
        engine,
        `function inv(m: matrix) -> matrix { inverse(m) }
function caller(m: matrix) -> real { det(inv(m)) }`
      ).diagnostics
    ).toEqual([]);
    const literal = (engine.lookupDefinition('caller') as { operator: { _lambdaLiteral: Expression } }).operator._lambdaLiteral;
    const attempt = () => compile(literal, PROFILE as never);
    expect(declineCode(attempt)).toBe('outside-profile');
  });
});

//
// The representation: the fact `absent`, its verifier rules, and the
// updates in place.
//

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

describe('the representation of the matrix functions', () => {
  const prepare = (json: MathJsonExpression): IRProgram =>
    lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(json),
        { cse: false, constantFold: false }
      )
    );
  const collections = (program: IRProgram) =>
    allOperations(program.root).filter((op) => op.kind === 'collection') as Extract<IROperation, { kind: 'collection' }>[];
  const nodes = (program: IRProgram) =>
    new Set(allOperations(program.root).map((op) => op.origin));

  test('the fact absent, decided from the types', () => {
    const facts = (json: MathJsonExpression) =>
      collections(prepare(json)).map((op) => `${op.fn}${op.absent ? ' absent' : ''}`);
    expect(facts(fn(['Inverse', 'A'], A))).toEqual(['inverse absent']);
    expect(facts(fn(['MatrixPower', 'A', 2], A))).toEqual(['matrix-power']);
    expect(facts(fn(['MatrixPower', 'A', -1], A))).toEqual(['matrix-power absent']);
    expect(facts(fn(['MatrixPower', 'A', 'n'], A, N))).toEqual(['matrix-power absent']);
    expect(facts(fn(['MatrixPower', 'M', 2], M))).toEqual(['matrix-power absent']);
    expect(facts(fn(['RowReduce', 'A'], A))).toEqual(['row-reduce']);
    expect(facts(fn(['RowReduce', 'M'], M))).toEqual(['row-reduce absent']);
    expect(facts(fn(['MatrixMultiply', 'A', 'B'], A, B))).toEqual(['matrix-multiply absent']);
    expect(facts(fn(['MatrixMultiply', 'A', 'B'], A23, B32))).toEqual(['matrix-multiply']);
    expect(facts(fn(['MatrixMultiply', 'A', 'v'], A, V))).toEqual(['matrix-multiply']);
    expect(facts(fn(['MatrixMultiply', 'M', 'v'], M, V))).toEqual(['matrix-multiply absent']);
    expect(facts(fn(['MatrixMultiply', 'v', 'A'], V2, A22))).toEqual(['matrix-multiply']);
    expect(facts(fn(['MatrixMultiply', 'v', 'A'], V, A))).toEqual(['matrix-multiply absent']);
    expect(facts(fn(['Transpose', ['Inverse', 'A']], A))).toEqual(['inverse absent', 'transpose absent']);
    expect(facts(fn(['Trace', ['Inverse', 'A']], A))).toEqual(['inverse absent', 'trace']);
  });

  test('the verifier refuses a value that can have no value outside its readers', () => {
    const program = prepare(fn(['Trace', ['Inverse', 'A']], A));
    verifyJavaScriptProgram(program, nodes(program));
    // The same program, with the fact removed from the inverse: the trace
    // reads a value that has the fact by its operand (none), and the
    // program verifies; with the fact on the trace, it does not.
    const [inverse, trace] = collections(program);
    const withFact = (op: IROperation, absent: boolean) => {
      const copy = { ...op } as { absent?: true };
      if (absent) copy.absent = true;
      else delete copy.absent;
      return copy as unknown as IROperation;
    };
    const replace = (from: IROperation, to: IROperation): IRProgram => ({
      ...program,
      root: { ...program.root, operations: program.root.operations.map((op) => (op === from ? to : op)) },
    });
    expect(() => verifyJavaScriptProgram(replace(trace, withFact(trace, true)), nodes(program))).toThrow(
      /the function of lists trace carries the fact absent/
    );
    const transposed = prepare(fn(['Transpose', ['Inverse', 'A']], A));
    const [, transpose] = collections(transposed);
    expect(() =>
      verifyJavaScriptProgram(
        { ...transposed, root: { ...transposed.root, operations: transposed.root.operations.map((op) => (op === transpose ? withFact(transpose, false) : op)) } },
        nodes(transposed)
      )
    ).toThrow(/reads a value that can have no value, and does not carry the fact absent/);
    void inverse;
  });

  test('the verifier refuses a value that can have no value as an operand of length', () => {
    const program = prepare(fn(['Add', ['Length', ['At', ['Inverse', 'A'], 1]], 1], A));
    verifyJavaScriptProgram(program, nodes(program));
    // Replace the operand of the `at` with the inverse by a `length` of it.
    const ops = program.root.operations;
    const inverse = ops.find((op) => op.kind === 'collection')!;
    const at = ops.find((op) => op.kind === 'at')!;
    const length = { ...ops.find((op) => op.kind === 'length')!, operands: [inverse.result!] } as IROperation;
    void at;
    expect(() =>
      verifyJavaScriptProgram(
        { ...program, root: { ...program.root, operations: ops.map((op) => (op.kind === 'length' ? length : op)) } },
        nodes(program)
      )
    ).toThrow(/which can have no value, is an operand of length/);
  });

  test('a transpose is not written in place (the transpose of [] is its operand)', () => {
    const program = prepare(fn(['ReplaceAt', ['Transpose', 'A'], 1, ['List', 'x']], A, X));
    expect(inPlaceUpdates(program).size).toBe(0);
    const inverse = prepare(fn(['ReplaceAt', ['RowReduce', 'A'], 1, ['List', 'x', 'x']], A, X));
    expect(inPlaceUpdates(inverse).size).toBe(1);
  });
});

//
// Each program compiles with the values of the existing compiler at every
// depth, or declines with `outside-profile`; never an internal error. The
// inputs are not written, and a second call gives the same value.
//

/** `json` compiled with the profile: false when it declines with
 *  `outside-profile`; otherwise the values equal those of the existing
 *  compiler on each list of arguments, and true. */
function admittedMatches(
  json: MathJsonExpression,
  args: readonly (readonly Arg[])[]
): boolean {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const expr = ce.expr(json);
  let result: CompilationResult<'javascript'>;
  try {
    result = compile(expr, { ...PROFILE, mode: 'strict' } as never) as CompilationResult<'javascript'>;
  } catch (error) {
    expect([json, (error as { diagnostic?: { code?: string } }).diagnostic?.code ?? String(error)]).toEqual([json, 'outside-profile']);
    return false;
  }
  const existing = compile(expr, { ...EXISTING, mode: 'strict' }) as CompilationResult<'javascript'>;
  for (const a of args) {
    const inputs = structuredClone(a) as Arg[];
    const value = run(result, inputs);
    const reference = run(existing, structuredClone(a) as Arg[]);
    expect([json, a, value, same(value, reference)]).toEqual([json, a, value, true]);
    expect([json, a, same(inputs, a)]).toEqual([json, a, true]);
    expect([json, a, same(run(result, inputs), value)]).toEqual([json, a, true]);
  }
  return true;
}

describe('the shapes of the operands of an element-wise operation (review)', () => {
  const A2: [string, string] = ['A', 'matrix<2x2>'];
  const B2: [string, string] = ['B', 'matrix<2x3>'];
  const C2: [string, string] = ['C', 'matrix<3x2>'];
  const c: [string, string] = ['c', 'boolean'];
  // A matrix product has the dimensions of its engine type, not those of an
  // operand.
  test.each([
    ['A·B + A of matrix<2x3> and matrix<3x2>', fn(['Add', ['Multiply', 'A', 'B'], 'A'], A23, B32)],
    ['B·A + B of matrix<2x3> and matrix<3x2>', fn(['Add', ['Multiply', 'B', 'A'], 'B'], A23, B32)],
    ['A + A·B of matrix<2x2> and matrix<2x3>', fn(['Add', 'A', ['Multiply', 'A', 'B']], A2, B2)],
  ] as const)('%s declines', (_name, json) => {
    expect(() => compile(new ComputeEngine().expr(json), PROFILE as never)).toThrow(
      /whose lengths are not equal by construction at every depth/
    );
  });
  const OPERANDS: [string, MathJsonExpression][] = [
    ['A', 'A'],
    ['B', 'B'],
    ['C', 'C'],
    ['A·B', ['Multiply', 'A', 'B']],
    ['C·B', ['Multiply', 'C', 'B']],
    ['B·C', ['Multiply', 'B', 'C']],
    ['Transpose(C)', ['Transpose', 'C']],
    ['Transpose(B)', ['Transpose', 'B']],
    ['-B', ['Negate', 'B']],
    ['B + 1', ['Add', 'B', 1]],
    ['B / 2', ['Divide', 'B', 2]],
    ['2B', ['Multiply', 2, 'B']],
    ['A^2', ['MatrixPower', 'A', 2]],
    ['Inverse(A)', ['Inverse', 'A']],
    ['RowReduce(B)', ['RowReduce', 'B']],
    ['Map(2r, B)', ['Map', ['Function', ['Multiply', 2, 'r'], 'r'], 'B']],
    ['Map(Take(r, 2), B)', ['Map', ['Function', ['Take', 'r', 2], 'r'], 'B']],
    ['If(c, A, A)', ['If', 'c', 'A', 'A']],
    ['Reverse(B)', ['Reverse', 'B']],
  ];
  const ARGS = [
    [[[1, 2], [3, 4]], [[1, -0, 2], [0.5, 3, -1]], [[1, 2], [-0, 0.5], [3, -1]], true],
    [[[1, 2], [2, 4]], [[5e-324, 1e300, 2], [1, 1, 1]], [[0, 0], [1, 1], [2, 2]], false],
  ] as unknown as Arg[][];
  const table = (head: string) =>
    OPERANDS.flatMap(([x, ex]) =>
      OPERANDS.map(
        ([y, ey]) => [`${head}(${x}, ${y})`, fn([head, ex, ey] as MathJsonExpression, A2, B2, C2, c)] as const
      )
    );
  test.each([...table('Add'), ...table('Divide')])(
    '%s: admitted only with the values of the existing compiler',
    (_name, json) => {
      admittedMatches(json, ARGS);
    }
  );
});

describe('a matrix that can have no value, in each carrier (review)', () => {
  const A2: [string, string] = ['A', 'matrix<2x2>'];
  const c: [string, string] = ['c', 'boolean'];
  type Wrap = (m: MathJsonExpression) => MathJsonExpression;
  const CARRIERS: [string, (wrap: Wrap) => MathJsonExpression][] = [
    ['the inverse', (w) => w(['Inverse', 'A'])],
    ['a Block whose value is the inverse', (w) => w(['Block', ['Declare', 'S', "'matrix<2x2>'", ['Add', 'A', 1]], ['Inverse', 'S']])],
    ['a Block of a Block', (w) => w(['Block', ['Block', ['Declare', 'S', "'matrix<2x2>'", 'A'], ['Inverse', 'S']]])],
    ['a Typed', (w) => w(['Typed', ['Inverse', 'A'], "'matrix<2x2>'"])],
    ['an If', (w) => w(['If', 'c', ['Inverse', 'A'], 'A'])],
    ['a local', (w) => ['Block', ['Declare', 'S', "'matrix<2x2>'", ['Inverse', 'A']], w('S')]],
    ['a local function', (w) => ['Block', ['DefineFunction', 'h', ['Function', ['Inverse', 'm'], ['Typed', 'm', "'matrix<2x2>'"]]], w(['h', 'A'])]],
    ['a product with an inverse', (w) => w(['MatrixMultiply', 'A', ['Inverse', 'A']])],
  ];
  const CONSUMERS: [string, Wrap][] = [
    ['Transpose', (m) => ['Transpose', m]],
    ['Determinant', (m) => ['Determinant', m]],
    ['MatrixMultiply', (m) => ['MatrixMultiply', m, 'A']],
    ['At', (m) => ['At', m, 1, 2]],
    ['a row', (m) => ['At', m, 2]],
    ['the program value', (m) => m],
  ];
  const ARGS = [
    [[[1, 2], [2, 4]], true],
    [[[1, 2], [3, 4]], true],
    [[[1, 2], [2, 4]], false],
    [[[2, -0], [0.5, 1]], false],
  ] as unknown as Arg[][];
  test.each(
    CARRIERS.flatMap(([carrier, make]) =>
      CONSUMERS.map(([consumer, wrap]) => [`${consumer} of ${carrier}`, fn(make(wrap), A2, c)] as const)
    )
  )('%s: compiles with the values of the existing compiler, or declines', (_name, json) => {
    admittedMatches(json, ARGS);
  });
  // A `Block` operand of a list type declines at the admission ("used as an
  // operand has the type matrix<2x2>"); the lowering reads the absence
  // through the value of a `Block` too (`matrixResultCanBeAbsent()`).
  test('the fact absent follows the value of a Block', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<2x2>');
    const block = ce.expr(['Transpose', ['Block', ['Declare', 'y', "'real'", ['Determinant', 'A']], ['Inverse', 'A']]]);
    expect(isFunction(block) && matrixResultCanBeAbsent(block, [2])).toBe(true);
  });
});

describe('the rows of a matrix of a stated count of no row (review)', () => {
  test('Sum of a matrix<0x3> declines', () => {
    expect(() => compile(new ComputeEngine().expr(fn(['Sum', 'A'], ['A', 'matrix<0x3>'])), PROFILE as never)).toThrow(
      /Sum of the rows of A of the type matrix<0x3> is not in the profile/
    );
  });
});

describe('a write into the result of a matrix function (review)', () => {
  // The input `[]` makes `_SYS.transpose` give its operand; `[[2]]` and a
  // rectangular matrix make the other helpers copy (`M^1`; a matrix that is
  // not square throws for the exponent 2 on both compilers).
  const RESULTS: [string, MathJsonExpression][] = [
    ['Transpose', ['Transpose', 'A']],
    ['RowReduce', ['RowReduce', 'A']],
    ['MatrixPower 0', ['MatrixPower', 'A', 0]],
    ['MatrixPower 1', ['MatrixPower', 'A', 1]],
    ['MatrixPower 2', ['MatrixPower', 'A', 2]],
    ['Inverse', ['Inverse', 'A']],
    ['MatrixMultiply', ['MatrixMultiply', 'A', 'A']],
    ['a product', ['Multiply', 'A', 'A']],
    ['Diagonal of a list', ['Diagonal', 'v']],
  ];
  const ARGS: Arg[][] = [
    [[[1, 2], [3, 4]], [1, 2], 9],
    [[[2]], [5], 9],
    [[], [], 9],
    [[[1, 2, 3], [4, 5, 6]], [-0], 9],
  ];
  const params: [string, string][] = [['A', 'matrix'], ['v', 'list<real>'], ['x', 'real']];
  const type = "'list<list<real>>'";
  const forms = (expr: MathJsonExpression): [string, MathJsonExpression][] => [
    ['an element, in a straight line', ['ReplaceAt', expr, 1, 1, 'x']],
    ['a row, in a straight line', ['ReplaceAt', expr, 1, ['List', 'x', 'x']]],
    ['a row swap', ['Block', ['Declare', 'S', type, expr], ['ReplaceAt', 'S', 1, ['At', 'S', 1]]]],
    [
      'an element, in a loop',
      ['Block', ['Declare', 'S', type, expr], ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 1, 1, ['Add', ['At', 'S', 1, 1], 'k']]], ['Element', 'k', ['Range', 1, 2]]], 'S'],
    ],
    [
      'a row, in a loop',
      ['Block', ['Declare', 'S', type, expr], ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 1, ['List', 'k', 'x']]], ['Element', 'k', ['Range', 1, 2]]], 'S'],
    ],
  ];
  test.each(
    RESULTS.flatMap(([name, expr]) => forms(expr).map(([form, json]) => [`${name}: ${form}`, fn(json, ...params)] as const))
  )('%s: the inputs are not written, the values of the existing compiler', (_name, json) => {
    admittedMatches(json, ARGS);
  });
  test('Flatten: an element, in a straight line and in a loop', () => {
    for (const json of [
      fn(['ReplaceAt', ['Flatten', 'v'], 1, 'x'], ...params),
      fn(['Block', ['Declare', 'S', "'list<real>'", ['Flatten', 'A']], ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 1, 'k']], ['Element', 'k', ['Range', 1, 2]]], 'S'], ...params),
    ])
      admittedMatches(json, [[[[1, 2], [3, 4]], [1, 2], 9], [[[2]], [5], 9]]);
  });
  test('the result array of each function of lists comes from the policy', () => {
    const collect = (json: MathJsonExpression) =>
      allOperations(
        lowerStructuredFragment(
          new ScalarFragmentJavaScriptTarget('structured').prepareStructured(new ComputeEngine().expr(json), {
            cse: false,
            constantFold: false,
          })
        ).root
      )
        .filter((op) => op.kind === 'collection')
        .map((op) => `${(op as { fn: string }).fn} ${(op as { resultArray?: string }).resultArray ?? 'none'}`);
    expect(collect(fn(['Transpose', 'A'], A))).toEqual(['transpose operand']);
    expect(collect(fn(['RowReduce', 'A'], A))).toEqual(['row-reduce new']);
    expect(collect(fn(['Multiply', 'A', 'B'], A22, B22))).toEqual(['matrix-product new']);
    expect(collect(fn(['Take', 'A', 1], A))).toEqual(['take copy']);
  });
});

describe('a local function called in the argument of a helper (review)', () => {
  test('Block(DefineFunction(lf, …), fr(lf(1))) compiles with the value of the existing compiler', () => {
    const ce = new ComputeEngine();
    ce.declare('fr', '(real) -> number');
    ce.assign('fr', ce.expr(['Function', ['Divide', 'v', ['Add', ['Multiply', 'v', 'v'], 1]], ['Typed', 'v', "'real'"]]));
    const expr = ce.expr(['Block', ['DefineFunction', 'lf', ['Function', 1, 'v']], ['fr', ['lf', 1]]]);
    const result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    expect(result.run({} as never)).toBe(0.5);
    expect(existing.run({} as never)).toBe(0.5);
  });
});

describe('a matrix function in a term of a Sum and in an integrand', () => {
  const A2: [string, string] = ['A', 'matrix<2x2>'];
  const AM: [string, string] = ['A', 'matrix'];
  const sum = (term: MathJsonExpression): MathJsonExpression => ['Sum', term, ['Limits', 'k', 1, 4]];
  // `_SYS.inv` and `_SYS.matpow` throw for a matrix that is not square; the
  // existing compiler stops at its first `NaN` term.
  test.each([
    ['an inverse in every term', fn(sum(['Multiply', 'k', ['Determinant', ['Inverse', 'A']]]), AM)],
    ['an inverse in a branch of a term', fn(sum(['If', ['Equal', 'k', 1], ['Divide', 0, 0], ['Determinant', ['Inverse', 'A']]]), AM)],
    ['a power by the index', fn(sum(['Determinant', ['MatrixPower', 'A', 'k']]), AM)],
    ['a determinant by the index', fn(sum(['Multiply', 'k', ['Determinant', 'A']]), AM)],
  ] as const)('%s: the values of the existing compiler, or a decline', (_name, json) => {
    admittedMatches(json, [[[[1, 2], [3, 4]]], [[[1, 2], [2, 4]]], [[[1, 2, 3], [4, 5, 6]]], [[[NaN, 1], [1, 1]]]]);
  });
  test('the inverse in a branch of a term declines', () => {
    expect(() =>
      compile(new ComputeEngine().expr(fn(sum(['If', ['Equal', 'k', 1], ['Divide', 0, 0], ['Determinant', ['Inverse', 'A']]]), AM)), PROFILE as never)
    ).toThrow(/outside|not in the profile|can throw/);
  });
  test('an integrand that reads a determinant', () => {
    admittedMatches(
      fn(['Integrate', ['Multiply', ['Exp', ['Sin', 'x']], ['Determinant', 'A']], ['Limits', 'x', 0, 1]], A2),
      [[[[1, 2], [3, 4]]], [[[-0, 0.5], [7, -2]]], [[[1, 2], [2, 4]]]]
    );
  });
});

describe('the result of a matrix function carried through a loop', () => {
  // The inputs that make a helper give its operand or share rows: `[]`
  // (`_SYS.transpose([])` is `[]`), `[[2]]`, a rectangular matrix (`M^1`
  // and `Inverse` throw or copy), and the exponent 1.
  const ARGS: Arg[][] = [
    [[[1, 2], [3, 4]], [1, 2], 9, [[1, 2], [3, 4]]],
    [[[2]], [5], 9, [[1, 2], [2, 4]]],
    [[], [], 9, [[-0, 0.5], [7, -2]]],
    [[[1, 2, 3], [4, 5, 6]], [-0], 9, [[1, 2], [3, 4]]],
  ];
  const params: [string, string][] = [['A', 'matrix'], ['v', 'list<real>'], ['x', 'real'], ['B', 'matrix<2x2>']];
  const type = "'list<list<real>>'";
  const RESULTS: [string, MathJsonExpression][] = [
    ['Transpose', ['Transpose', 'A']],
    ['RowReduce', ['RowReduce', 'A']],
    ['MatrixPower 0', ['MatrixPower', 'A', 0]],
    ['MatrixPower 1', ['MatrixPower', 'A', 1]],
    ['MatrixPower 2', ['MatrixPower', 'A', 2]],
    ['Inverse', ['Inverse', 'A']],
    ['MatrixMultiply', ['MatrixMultiply', 'A', 'A']],
    ['a product', ['Multiply', 'A', 'A']],
    ['MatrixMultiply of matrix<2x2>', ['MatrixMultiply', 'B', 'B']],
    ['a product of matrix<2x2>', ['Multiply', 'B', 'B']],
    ['Diagonal of a list', ['Diagonal', 'v']],
    ['the matrix itself', 'A'],
  ];
  const loop = (expr: MathJsonExpression, update: MathJsonExpression): MathJsonExpression => [
    'Block',
    ['Declare', 'S', type, expr],
    ['Loop', ['Assign', 'S', update], ['Element', 'k', ['Range', 1, 3]]],
    'S',
  ];
  const FORMS: [string, MathJsonExpression][] = [
    ['one element of one row per pass', ['ReplaceAt', 'S', 1, 1, ['Add', ['At', 'S', 1, 1], 'k']]],
    ['a whole row per pass', ['ReplaceAt', 'S', 1, ['List', 'k', 'x']]],
  ];
  /** The program, as `check()` runs it (values, inputs at every depth, a
   *  second call, the host writes into the result, then a third call), and
   *  the code of the profile; `undefined` when it declines. */
  const runAll = (json: MathJsonExpression): string | undefined => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const expr = ce.expr(json);
    let result: CompilationResult<'javascript'>;
    try {
      result = compile(expr, { ...PROFILE, mode: 'strict' } as never) as CompilationResult<'javascript'>;
    } catch (error) {
      expect((error as { diagnostic?: { code?: string } }).diagnostic?.code).toBe('outside-profile');
      return undefined;
    }
    const existing = compile(expr, { ...EXISTING, mode: 'strict' }) as CompilationResult<'javascript'>;
    for (const a of ARGS) {
      const inputs = structuredClone(a) as Arg[];
      const value = run(result, inputs);
      const reference = run(existing, structuredClone(a) as Arg[]);
      expect([a, value, same(value, reference)]).toEqual([a, value, true]);
      expect([a, same(inputs, a)]).toEqual([a, true]);
      expect([a, same(run(result, inputs), value)]).toEqual([a, true]);
      expect([a, same(inputs, a)]).toEqual([a, true]);
      scribble(value);
      expect([a, same(run(result, structuredClone(a) as Arg[]), reference)]).toEqual([a, true]);
    }
    return result.code;
  };
  const codes = new Map<string, string | undefined>();
  test.each(
    RESULTS.flatMap(([name, expr]) =>
      FORMS.map(([form, update]) => [`${name}: ${form}`, fn(loop(expr, update), ...params)] as const)
    )
  )('%s', (name, json) => {
    codes.set(name, runAll(json));
  });
  test('where the code writes in place', () => {
    // The loop writes in place after one copy before it (`_SYS.ownedCopyLevels`
    // or a slice of the rows, `withOwnedCopies()`) for every carried value
    // that is not its own: a transpose (its operand for `[]`), the input
    // itself. A result that is new writes in place with no copy.
    const inPlace = (name: string) => /replaceAtInPlace/.test(codes.get(name) ?? '');
    for (const [name] of RESULTS) {
      if (name === 'Inverse' || name === 'MatrixMultiply' || name === 'a product') {
        // The value of a local cannot be a matrix that can have no value
        // (a singular inverse, a product of no stated dimensions).
        expect(codes.get(`${name}: one element of one row per pass`)).toBeUndefined();
        continue;
      }
      expect([name, inPlace(`${name}: a whole row per pass`)]).toEqual([name, true]);
    }
  });

  test('the guard reports a wrong update in place of a transpose', () => {
    const program = lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(fn(['Block', ['Declare', 'S', type, ['Transpose', 'A']], ['Assign', 'S', ['ReplaceAt', 'S', 1, ['List', 'x']]], 'S'], ...params)),
        { cse: false, constantFold: false }
      )
    );
    const update = allOperations(program.root).find((op) => op.kind === 'replace-at')!;
    const transpose = allOperations(program.root).find((op) => op.kind === 'collection')!;
    // The transpose of `[]` is the input itself: no update in place, and
    // the guard reports the update in place that a wrong set holds.
    expect(inPlaceUpdates(program).has(update)).toBe(false);
    expect(hostArrays(program, new Set([update])).has(transpose.result!.id)).toBe(true);
    // A result that is new at every depth holds no array of the host.
    const reduced = lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(fn(['RowReduce', 'A'], ...params)),
        { cse: false, constantFold: false }
      )
    );
    const rref = allOperations(reduced.root).find((op) => op.kind === 'collection')!;
    expect(hostArrays(reduced, new Set()).has(rref.result!.id)).toBe(false);
  });
});

describe('lists of lists with the scalar heads and the decided selections', () => {
  const AM: [string, string] = ['A', 'matrix'];
  const BM: [string, string] = ['B', 'matrix'];
  const AI: [string, string] = ['A', 'matrix<integer>'];
  const Z: [string, string] = ['Z', 'list<list<integer>>'];
  const k: [string, string] = ['k', 'integer'];
  // A selection decided by a constant condition: the profile writes it as the
  // selected branch only at the root, as a body, or for a symbol branch; a
  // branch that can have no value keeps the rule of the absent result.
  test.each([
    ['If(2 < 3, A, B) at the root', fn(['If', ['Less', 2, 3], 'A', 'B'], AM, BM)],
    ['Which(True, Transpose(A)) at the root', fn(['Which', 'True', ['Transpose', 'A']], AM, BM)],
    ['Determinant(If(2 < 3, A, B))', fn(['Determinant', ['If', ['Less', 2, 3], 'A', 'B']], AM, BM)],
    ['Transpose(Which(True, Transpose(A)))', fn(['Transpose', ['Which', 'True', ['Transpose', 'A']]], AM, BM)],
    ['If(2 < 3, Inverse(A), A) at the root', fn(['If', ['Less', 2, 3], ['Inverse', 'A'], 'A'], AM, BM)],
    ['Transpose(If(2 < 3, Inverse(A), A))', fn(['Transpose', ['If', ['Less', 2, 3], ['Inverse', 'A'], 'A']], AM, BM)],
    ['If(2 < 3, Inverse(A), A) + 1', fn(['Add', ['If', ['Less', 2, 3], ['Inverse', 'A'], 'A'], 1], AM, BM)],
    ['Which(True, Transpose(A)) + 1', fn(['Add', ['Which', 'True', ['Transpose', 'A']], 1], AM, BM)],
  ] as const)('%s: the values of the existing compiler, or a decline', (_name, json) => {
    admittedMatches(json, [[[[1, 2], [3, 4]], [[5]]], [[[1, 2], [2, 4]], [[1, 2, 3]]], [[], [[2]]]]);
  });
  test.each([
    ['Heaviside(M)', fn(['Heaviside', 'M'], M), /Heaviside with the list operand M is not in the profile/],
    ['GCD(At(Z, 1), 2)', fn(['GCD', ['At', 'Z', 1], 2], Z), /GCD with the list operand At\(Z, 1\) is not in the profile/],
    ['Remainder(A, 2)', fn(['Remainder', 'A', 2], AM), /Remainder with the list operand A is not in the profile/],
  ] as const)('%s declines with the refusal of a list operand', (_name, json, message) => {
    expect(() => compile(new ComputeEngine().expr(json), PROFILE as never)).toThrow(message);
  });
  test.each([
    ['a Sum whose term reads an element by the index', fn(['Sum', ['GCD', ['At', 'Z', 'k', 1], 2], ['Limits', 'k', 1, 2]], Z), [[[[4, 6], [3]]], [[[4]]], [[[9007199254740993], [2]]]]],
    ['a Map over the rows with GCD', fn(['Map', ['Function', ['GCD', ['At', 'r', 1], 6], 'r'], 'Z'], Z), [[[[4, 6], [3]]], [[]]]],
    ['the Sum of a Map over the rows with Remainder', fn(['Sum', ['Map', ['Function', ['Remainder', ['Sum', 'r'], 3], 'r'], 'A']], AM), [[[[1, 2], [3, 4]]], [[[1e300, 2]]]]],
    ['the Sum of the rows of a product by a GCD', fn(['Sum', ['Multiply', ['GCD', ['At', 'A', 1, 1], 4], 'A']], AI), [[[[2, 3], [4, 5]]], [[[6]]]]],
    ['a Sum by the index of the rows times a Remainder', fn(['Sum', ['Multiply', ['Remainder', 'k', 2], ['At', 'A', 'k', 1]], ['Limits', 'k', 1, 2]], AM), [[[[1, 2], [3, 4]]], [[[1]]]]],
  ] as const)('%s: the values of the existing compiler, or a decline', (_name, json, args) => {
    admittedMatches(json, args as unknown as Arg[][]);
  });
  void k;
});

describe('a matrix function of a list that can hold an absent row (review)', () => {
  const MR: [string, string] = ['M', 'list<list<real>>'];
  const AM: [string, string] = ['A', 'matrix'];
  const c: [string, string] = ['c', 'boolean'];
  const placed: MathJsonExpression = ['List', ['List', 1, 0], ['At', 'M', 'i']];
  // `_SYS.rref` reads `r.slice()` of each row: an absent row throws there.
  test('the witness: an unused conditional that holds RowReduce of a placed row read declines', () => {
    const json = fn(
      ['Block', ['Declare', 's', "'real'", 0], ['If', 'c', ['Assign', 's', ['Determinant', ['RowReduce', placed]]]], 7],
      MR, I, c
    );
    expect(() => compile(new ComputeEngine().expr(json), PROFILE as never)).toThrow(
      /(Determinant|RowReduce) of a list of lists is not in the profile in a program that places the row read At\(M, i\) in a list/
    );
  });
  test.each([
    ['Determinant', ['Determinant', placed]],
    ['Trace', ['Trace', placed]],
    ['Transpose', ['Transpose', placed]],
    ['Inverse', ['Inverse', placed]],
    ['MatrixPower', ['MatrixPower', placed, 2]],
    ['MatrixMultiply', ['MatrixMultiply', placed, 'v']],
    ['Dot', ['Dot', placed, 'v']],
    ['Diagonal', ['Diagonal', placed]],
    ['Flatten', ['Flatten', placed]],
    ['Norm', ['Norm', placed]],
    ['a product', ['Multiply', placed, 'v']],
  ] as const)('%s of a list that holds a row read declines', (_name, body) => {
    const json = fn(body as MathJsonExpression, MR, I, V);
    expect(() => compile(new ComputeEngine().expr(json), PROFILE as never)).toThrow(/outside|not in the profile/);
    expect(admittedMatches(json, [[[[1, 2], [3, 4]], 1, [1, 2]], [[[1, 2]], 5, [1, 2]]])).toBe(false);
  });
  // `_SYS.inv` and `_SYS.matpow` throw for a matrix that is not square
  // (`canThrow()`): an unused conditional that holds one is kept.
  test.each([
    ['Inverse of a literal that is not square', ['Determinant', ['Inverse', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]]]],
    ['MatrixPower 2 of a matrix input', ['Determinant', ['MatrixPower', 'A', 2]]],
    ['Inverse of a matrix input', ['Trace', ['Inverse', 'A']]],
  ] as const)('an unused conditional that holds %s is kept', (_name, value) => {
    const json = fn(['Block', ['Declare', 's', "'real'", 0], ['If', 'c', ['Assign', 's', value]], 7], AM, c);
    const args = [
      [[[1, 2, 3], [4, 5, 6]], true],
      [[[1, 2, 3], [4, 5, 6]], false],
      [[[1, 2], [3, 4]], true],
    ] as unknown as Arg[][];
    if (admittedMatches(json, args)) {
      const result = compile(new ComputeEngine().expr(json), PROFILE as never) as CompilationResult<'javascript'>;
      expect(result.code).toMatch(/_SYS\.(inv|matpow)/);
    }
  });
});
