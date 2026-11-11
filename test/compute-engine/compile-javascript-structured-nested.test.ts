import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  LIST_OPERAND_HEADS,
  NESTED_OPERAND_HEADS,
  ScalarFragmentJavaScriptTarget,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { inPlaceUpdates } from '../../src/compute-engine/compilation/structured-in-place';
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

// Slice 1 of docs/plans/2026-11-11-structured-nested-lists-and-matrices.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): lists of lists as a value kind (inputs, parameters, locals and
// results typed `list<list<real>>`, `list<list<integer>>`, `matrix`,
// `matrix<m×n>`, `list<list<number>>` in the `strict` mode, rank 3 and
// `list<list<tuple<…>>>`), list literals of rows, comprehensions of rows, row
// reads (`At(M, i)`, `First`, `Last`), `At(M, i, j)` and chained `At`,
// `Length` of each level, `Count`, `Rest`, `Take`, `Drop`, `Reverse`,
// `Join`, `ListJoin` and the rotations of the rows, `ReplaceAt` of a row and
// of an element of a row, an `If` of lists of lists, and a list of lists
// passed to and returned from a helper; and the default refusal: every
// other rule that reads a list declines a list of lists, and a row read
// that can be absent declines where the existing emitter reads it otherwise.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) with the same shape at every depth (`undefined` for an absent
// row on both); the inputs must be the same after the call as a deep copy
// taken before it, at every depth; a second call gives the same value; after
// the host writes into the result (at every depth), a third call with fresh
// inputs gives the value again. The value agrees with the interpreter within
// 1e-12 relative, or by the caveats of compiled code (`NaN` or `undefined`
// where the interpreter has no number).

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

const M: [string, string] = ['M', 'list<list<real>>'];
const MI: [string, string] = ['MI', 'list<list<integer>>'];
const MN: [string, string] = ['MN', 'list<list<number>>'];
const A: [string, string] = ['A', 'matrix'];
const A22: [string, string] = ['A', 'matrix<2x2>'];
const AR: [string, string] = ['A', 'matrix<real^(2x3)>'];
const R3: [string, string] = ['R3', 'list<list<list<real>>>'];
const T: [string, string] = ['T', 'list<list<tuple<real, real>>>'];
const LP: [string, string] = ['LP', 'list<tuple<real, real>>'];
const X: [string, string] = ['x', 'real'];
const I: [string, string] = ['i', 'integer'];
const J: [string, string] = ['j', 'integer'];
const K: [string, string] = ['k', 'integer'];
const N: [string, string] = ['n', 'integer'];

type Arg = number | Arg[] | undefined;

/** The value of a call, or `THROWS` when the call throws (an index out of
 *  range of `ReplaceAt` throws on both compilers). */
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

/** Within 1e-12 relative of the interpreter, element by element at every
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
    Math.abs(value - expected) <= 1e-12 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

/** The MathJSON of an argument: nested arrays are lists; the positions of
 *  `tuples` hold lists of lists of tuples at the depth `tupleDepth`. */
function boxArg(a: Arg, tupleDepth = -1): MathJsonExpression {
  if (!Array.isArray(a)) return a ?? 'Nothing';
  return [
    tupleDepth === 0 ? 'Tuple' : 'List',
    ...a.map((e) => boxArg(e, tupleDepth - 1)),
  ] as MathJsonExpression;
}

/** The numbers, or nested arrays of numbers, of a value of the interpreter;
 *  `undefined` where it is not a number. */
function valueOf(value: Expression): unknown {
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return value.ops.map(valueOf);
  return isNumber(value) && value.im === 0 ? value.re : undefined;
}

function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  args: readonly Arg[],
  tupleDepths: readonly number[]
): unknown {
  const evaluated = ce
    .expr(['Apply', json, ...args.map((a, i) => boxArg(a, tupleDepths[i] ?? -1))] as MathJsonExpression)
    .evaluate();
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
  /** For each argument, the depth of its tuples (a list of lists of tuples
   *  has its tuples at the depth 2). */
  readonly tupleDepths?: readonly number[];
  /** No comparison with the interpreter (the caveats of compiled code). */
  readonly existingOnly?: boolean;
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
    if (program.existingOnly || reference === THROWS) continue;
    const expected = interpret(ce, json, args, program.tupleDepths ?? []);
    expect([args, reference, close(reference, expected)]).toEqual([args, reference, true]);
  }
  expect(declineCode(() => compile(expr, { ...PROFILE, mode: 'complex' } as never))).toBe('outside-profile');
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

// Rows of different lengths, an empty list, an empty row, signed zeros and
// extreme doubles.
const RAGGED: Arg[] = [[], [[]], [[1, 2], [3]], [[-0, 1e300], [5e-324], [1 / 3, 2, -7]]];
const INTEGER_ROWS: Arg[] = [[], [[]], [[1, 2], [3]], [[4, -5, 6], [7]]];
const MATRICES: Arg[] = [[[1, 2], [3, 4]], [[-0, 0.5, 1e300], [7, -2, 5e-324]], [[2]]];
const SQUARE: Arg[] = [[[1, 2], [3, 4]], [[-0, 0.5], [7, -2]]];
const INDEXES = [1, 2, -1, 0, 3, -4];
const RANK3: Arg[] = [[], [[[1, 2], [3]], [[4]]], [[[]], [[-0, 5], [6, 7, 8]]]];
const TUPLE_ROWS: Arg[] = [[], [[[1, 2]], [[3, 4], [-0, 0.5]]]];

const each = (values: readonly Arg[], indexes: readonly number[] = INDEXES) =>
  values.flatMap((v) => indexes.map((i) => [v, i]));
const each2 = (values: readonly Arg[], indexes: readonly number[] = [1, 2, -1, 0, 3]) =>
  values.flatMap((v) => indexes.flatMap((i) => indexes.map((j) => [v, i, j])));

const READS: Program[] = [
  { name: 'a row read', json: fn(['At', 'M', 'i'], M, I), args: each(RAGGED) },
  { name: 'a row read of a matrix', json: fn(['At', 'A', 'i'], A, I), args: each(MATRICES) },
  { name: 'a row read of a matrix<2x2>', json: fn(['At', 'A', 'i'], A22, I), args: each(SQUARE) },
  { name: 'At with two indexes', json: fn(['At', 'M', 'i', 'j'], M, I, J), args: each2(RAGGED) },
  { name: 'At of At', json: fn(['At', ['At', 'M', 'i'], 'j'], M, I, J), args: each2(RAGGED) },
  { name: 'At with two indexes of a matrix<real^(2x3)>', json: fn(['At', 'A', 'i', 'j'], AR, I, J), args: each2([[[1, 2, 3], [4, 5, 6]]]) },
  { name: 'At of rows of integers', json: fn(['Add', ['At', 'MI', 'i', 'j'], 1], MI, I, J), args: each2(INTEGER_ROWS), existingOnly: true },
  { name: 'At of rows of number elements in the strict mode', json: fn(['At', 'MN', 'i', 'j'], MN, I, J), args: each2(RAGGED) },
  { name: 'Length of the rows', json: fn(['Length', 'M'], M), args: RAGGED.map((m) => [m]) },
  { name: 'Length of a row read', json: fn(['Length', ['At', 'M', 'i']], M, I), args: each(RAGGED), existingOnly: true },
  { name: 'Length of First and of Last', json: fn(['List', ['Length', ['First', 'M']], ['Length', ['Last', 'M']]], M), args: RAGGED.map((m) => [m]), existingOnly: true },
  { name: 'First and Last', json: fn(['List', ['First', 'M'], ['Last', 'M']], M), args: RAGGED.map((m) => [m]), existingOnly: true },
  { name: 'Count of the rows', json: fn(['Count', 'A'], A), args: MATRICES.map((m) => [m]) },
  { name: 'Rest', json: fn(['Rest', 'M'], M), args: RAGGED.map((m) => [m]) },
  { name: 'Take', json: fn(['Take', 'M', 'k'], M, K), args: each(RAGGED, [0, 1, 2, -1, 5]) },
  { name: 'Drop', json: fn(['Drop', 'M', 'k'], M, K), args: each(RAGGED, [0, 1, 2, -1, 5]) },
  { name: 'Reverse', json: fn(['Reverse', 'M'], M), args: RAGGED.map((m) => [m]) },
  { name: 'RotateLeft', json: fn(['RotateLeft', 'M', 'k'], M, K), args: each(RAGGED, [0, 1, -1, 3]) },
  { name: 'RotateRight with no shift', json: fn(['RotateRight', 'M'], M), args: RAGGED.map((m) => [m]) },
  { name: 'Join of rows of reals and rows of integers', json: fn(['Join', 'M', 'MI'], M, MI), args: [[[[1.5]], [[2], []]], [[], []]] },
  { name: 'ListJoin of rows and a literal of rows', json: fn(['ListJoin', 'M', ['List', ['List', 'x']]], M, X), args: RAGGED.map((m) => [m, 0.5]) },
  { name: 'an element of a taken row', json: fn(['At', ['Take', 'M', 1], 1, 'k'], M, K), args: each(RAGGED, [1, 2, -1]), existingOnly: true },
  { name: 'an If of lists of lists', json: fn(['If', ['Less', 'x', 0], 'M', ['List', ['List', 1]]], M, X), args: [[[[1, 2]], 1], [[[1, 2]], -1]] },
  { name: 'an If of row reads as the value', json: fn(['If', ['Less', 'x', 0], ['At', 'M', 1], ['At', 'M', -1]], M, X), args: RAGGED.flatMap((m) => [[m, 1], [m, -1]]), existingOnly: true },
];

const MAKES: Program[] = [
  { name: 'a literal of rows', json: fn(['List', ['List', 'x', 1], ['List', 2, 'x']], X), args: [[0.5], [-0]] },
  { name: 'a ragged literal', json: fn(['List', ['List', 'x'], ['List', 2, 'x']], X), args: [[0.5], [-0]] },
  { name: 'a literal of empty rows', json: fn(['List', ['List'], ['List']]), args: [[]] },
  { name: 'a literal of a row of integers and a row of reals', json: fn(['At', ['List', ['List', 1, 2], ['List', 'x']], 'i', 'j'], X, I, J), args: [[0.5, 1, 2], [0.5, 2, 1], [0.5, 2, 2]], existingOnly: true },
  { name: 'a literal of lists of lists (rank 3)', json: fn(['List', 'M', ['List', ['List', 'x']]], M, X), args: RAGGED.map((m) => [m, 0.5]) },
  { name: 'a literal that holds a row read', json: fn(['List', ['At', 'M', 'i'], ['List', 'x']], M, I, X), args: each(RAGGED, [1, -1, 3]).map((a) => [...a, 0.5]), existingOnly: true },
  { name: 'a comprehension of rows', json: fn(['Comprehension', ['List', 'k', ['Multiply', 2, 'k']], ['Element', 'k', ['Range', 1, 'n']]], N), args: [[3], [1], [0], [-2]] },
  { name: 'a comprehension of row reads', json: fn(['Comprehension', ['At', 'M', 'k'], ['Element', 'k', ['Range', 1, 'n']]], M, N), args: each(RAGGED, [0, 1, 3]), existingOnly: true },
  {
    name: 'a nested comprehension',
    json: fn(['Comprehension', ['Comprehension', ['Multiply', 'j', 'k'], ['Element', 'j', ['Range', 1, 'k']]], ['Element', 'k', ['Range', 1, 'n']]], N),
    args: [[3], [1], [0]],
  },
  { name: 'a comprehension of a list of tuples', json: fn(['Comprehension', 'LP', ['Element', 'j', ['Range', 1, 2]]], LP), args: [[[]], [[[1, 2], [3, -0]]]], tupleDepths: [1], existingOnly: true },
  { name: 'Length of a row of a comprehension', json: fn(['Length', ['At', ['Comprehension', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 'k']]], ['Element', 'k', ['Range', 1, 'n']]], 'i']], N, I), args: [[3, 2], [3, 5], [2, -1]], existingOnly: true },
];

const UPDATES: Program[] = [
  { name: 'ReplaceAt of a row', json: fn(['ReplaceAt', 'M', 'i', ['List', 'x', 1]], M, I, X), args: [[[[1, 2], [3]], 1, 0.5], [[[1, 2], [3]], -1, 0.5]] },
  { name: 'ReplaceAt of an element of a row', json: fn(['ReplaceAt', 'M', 'i', 'j', 'x'], M, I, J, X), args: [[[[1, 2], [3]], 1, 2, 7], [[[1, 2], [3]], -1, -1, -0], [[[1, 2], [3]], 2, 1, 0.5]] },
  { name: 'ReplaceAt of a real element of rows of integers', json: fn(['ReplaceAt', 'MI', 'i', 'j', 'x'], MI, I, J, X), args: [[[[1, 2], [3]], 1, 2, 7.5]] },
  { name: 'ReplaceAt of an integer element of rows of integers', json: fn(['ReplaceAt', 'MI', 'i', 'j', 'k'], MI, I, J, K), args: [[[[1, 2], [3]], 2, 1, 9]] },
  { name: 'ReplaceAt of a row of a matrix', json: fn(['ReplaceAt', 'A', 2, 'i', 'x'], A, I, X), args: [[[[1, 2], [3, 4]], 1, 0.5]] },
  // A row read as the row value: a swap shares the rows of the input, and
  // an update of an element of a swapped row copies that row.
  {
    name: 'ReplaceAt: a swap of two rows',
    json: fn(['ReplaceAt', ['ReplaceAt', 'M', 1, ['At', 'M', 2]], 2, ['At', 'M', 1]], M),
    args: [[[[1, 2], [3]]], [[[1, 2], [3], [4, 5]]]],
  },
  {
    name: 'ReplaceAt: a row by a row read out of range',
    json: fn(['ReplaceAt', 'M', 1, ['At', 'M', 'i']], M, I),
    args: [[[[1, 2], [3]], 2], [[[1, 2], [3]], 3], [[[1, 2], [3]], -1]],
  },
  {
    name: 'ReplaceAt: an element of a swapped row',
    json: fn(['ReplaceAt', ['ReplaceAt', ['ReplaceAt', 'M', 1, ['At', 'M', 2]], 2, ['At', 'M', 1]], 1, 1, 'x'], M, X),
    args: [[[[1, 2], [3]], 9]],
  },
  {
    name: 'ReplaceAt: a local swapped, then an element written',
    json: fn(['Block', ['Declare', 'S', "'list<list<real>>'", 'M'], ['Assign', 'S', ['ReplaceAt', 'S', 1, ['At', 'S', 2]]], ['Assign', 'S', ['ReplaceAt', 'S', 1, 1, 'x']], 'S'], M, X),
    args: [[[[1, 2], [3]], 9]],
  },
  { name: 'ReplaceAt of a row by its own updated row', json: fn(['ReplaceAt', 'M', 'i', ['ReplaceAt', ['At', 'M', 'i'], 'j', 'x']], M, I, J, X), args: [[[[1, 2], [3]], 1, 2, 7], [[[1, 2], [3]], 2, 1, -0]] },
  {
    name: 'a local of rows updated in a loop (in place)',
    json: fn(['Block',
      ['Declare', 'S', "'list<list<real>>'", ['List', ['List', 0, 0], ['List', 0, 0], ['List', 0, 0]]],
      ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 'k', 2, ['Multiply', 'x', 'k']]], ['Element', 'k', ['Range', 1, 'n']]],
      'S'], X, N),
    args: [[0.5, 1], [0.5, 3], [-0, 2]],
  },
  {
    name: 'a local of an input of rows updated in a loop (a copy)',
    json: fn(['Block',
      ['Declare', 'S', "'list<list<real>>'", 'M'],
      ['Loop', ['Assign', 'S', ['ReplaceAt', 'S', 'k', 1, 'x']], ['Element', 'k', ['Range', 1, ['Length', 'M']]]],
      'S'], M, X),
    args: [[[[1, 2], [3]], 0.5], [[], 0.5]],
  },
  {
    name: 'a row placed in a list, then updated',
    json: fn(['Block',
      ['Declare', 'r', "'list<real>'", ['List', 1, 2]],
      ['Declare', 'S', "'list<list<real>>'", ['List', 'r', 'r']],
      ['Assign', 'r', ['ReplaceAt', 'r', 1, 'x']],
      ['List', ['At', 'S', 1, 1], ['At', 'S', 2, 1], ['At', 'r', 1]]], X),
    args: [[0.5], [9]],
  },
  {
    name: 'rows of integers written to a local of rows of reals',
    json: fn(['Block', ['Declare', 'S', "'list<list<real>>'", 'MI'], ['Assign', 'S', ['ReplaceAt', 'S', 1, 1, 0.5]], 'S'], MI),
    args: [[[[1, 2], [3]]]],
  },
];

const HELPERS = `function fm(m: list<list<real>>) -> real { length(m) + m[1][1] }
function tw(m: list<list<real>>) -> list<list<real>> { replaceAt(m, 1, [0.5, 1.0]) }
function caller(M: list<list<real>>, x: real) -> real { fm(tw(M)) + x }
function mk(x: real) -> list<list<real>> { [[x, 1.0], [2.0, x]] }
function useMk(x: real) -> real { let B = mk(x); B[2][1] + length(B) }
function ints(m: list<list<real>>) -> real { length(m) }
function passInts(m: list<list<integer>>) -> real { ints(m) }
function idm(m: list<list<real>>) -> list<list<real>> { m }
function setFirst(M: list<list<real>>, x: real) -> list<list<real>> {
  let B = idm(M)
  B = replaceAt(B, 1, 1, x)
  B
}
function mat(A: matrix<2x2>) -> real { A[1][2] + A[2][1] }
function ij(M: list<list<real>>, i: integer, j: integer) -> real { M[i, j] }`;

const CALLS: Program[] = [
  { name: 'a list of lists passed to and returned from helpers', epsil: HELPERS, entry: 'caller', args: [[[[1, 2], [3]], 0.5], [[[-0]], 1]] },
  { name: 'a helper that returns a literal of rows', epsil: HELPERS, entry: 'useMk', args: [[0.5], [-0]] },
  { name: 'rows of integers passed to a parameter of rows of reals', epsil: HELPERS, entry: 'passInts', args: [[[[1, 2], [3]]], [[]]] },
  { name: 'a helper that returns its parameter, then a write (a copy)', epsil: HELPERS, entry: 'setFirst', args: [[[[1, 2], [3]], 0.5]] },
  { name: 'elements of a matrix<2x2> parameter', epsil: HELPERS, entry: 'mat', args: SQUARE.map((m) => [m]) },
  { name: 'M[i, j] in Epsil', epsil: HELPERS, entry: 'ij', args: each2(RAGGED), existingOnly: true },
];

const RANKS: Program[] = [
  { name: 'rank 3: a read of each level', json: fn(['List', ['Length', 'R3'], ['Length', ['At', 'R3', 'i', 'j']], ['At', 'R3', 'i', 'j', 1]], R3, I, J), args: each2(RANK3, [1, -1, 2]), existingOnly: true },
  { name: 'rank 3: a row read of rows', json: fn(['At', 'R3', 'i'], R3, I), args: each(RANK3, [1, -1, 3]), existingOnly: true },
  { name: 'a list of lists of tuples: a tuple and its element', json: fn(['List', ['At', ['At', 'T', 'i', 'j'], 1], ['Length', 'T']], T, I, J), args: each2(TUPLE_ROWS, [1, 2, -1]), tupleDepths: [2], existingOnly: true },
];

describe.each([
  ['reads of lists of lists', READS],
  ['lists of lists that the program makes', MAKES],
  ['updates of lists of lists', UPDATES],
  ['lists of lists across helpers', CALLS],
  ['ranks 3 and lists of lists of tuples', RANKS],
] as const)('%s', (_label, programs) => {
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, program) => check(program));
});

//
// The default refusal: every head of `LIST_OPERAND_HEADS` with an operand
// that is a list of lists, and with an operand that is a row read.
//

describe('every rule that reads a list declines a list of lists it does not read', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('M', 'list<list<real>>');
  ce.declare('L', 'list<real>');
  ce.declare('x', 'real');
  ce.declare('i', 'integer');
  ce.declare('c', 'boolean');
  const lambda = (body: MathJsonExpression, ...names: string[]): MathJsonExpression =>
    ['Function', body, ...names] as MathJsonExpression;
  const R: MathJsonExpression = ['At', 'M', 'i'];
  /** For each head, programs with an operand `m`: a list of lists, and a
   *  row read (`R`). */
  const forms = (m: MathJsonExpression): Record<string, MathJsonExpression[]> => ({
    If: [['If', 'c', m, m]],
    Loop: [['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', 1]], ['Element', 'r', m]], 's']],
    At: [['At', m, 1]],
    Length: [['Length', m]],
    Comprehension: [['Comprehension', m, ['Element', 'j', ['Range', 1, 2]]]],
    ReplaceAt: [['ReplaceAt', m, 1, ['List', 'x']], ['ReplaceAt', m, 1, 'x']],
    Typed: [['Typed', m, "'list<list<real>>'"]],
    List: [['List', m, m]],
    Tuple: [['Tuple', m, 1]],
    Min: [['Min', m], ['Min', m, 'x']],
    Max: [['Max', m]],
    Add: [['Add', m, 1], ['Add', m, m]],
    Multiply: [['Multiply', 'x', m], ['Multiply', m, m]],
    Negate: [['Negate', m]],
    Divide: [['Divide', m, 2]],
    Sum: [['Sum', m], ['Sum', ['Length', m], ['Limits', 'j', 1, 2]]],
    Product: [['Product', m]],
    Norm: [['Norm', m]],
    Mean: [['Mean', m]],
    Median: [['Median', m]],
    Variance: [['Variance', m]],
    Dot: [['Dot', m, m]],
    Take: [['Take', m, 1]],
    Drop: [['Drop', m, 1]],
    Rest: [['Rest', m]],
    Reverse: [['Reverse', m]],
    Sort: [['Sort', m]],
    Join: [['Join', m, m]],
    ListJoin: [['ListJoin', m, m]],
    First: [['First', m]],
    Last: [['Last', m]],
    Count: [['Count', m], ['Count', m, lambda(['Less', ['Length', 'r'], 2], 'r')]],
    Range: [['Range', m]],
    RotateLeft: [['RotateLeft', m, 1]],
    RotateRight: [['RotateRight', m]],
    Map: [['Map', lambda(['Length', 'r'], 'r'), m], ['Map', 'Sin', m]],
    Filter: [['Filter', m, lambda(['Less', ['Length', 'r'], 2], 'r')]],
    Reduce: [['Reduce', m, 'Add'], ['Reduce', m, lambda(['Add', 'a', ['Length', 'b']], 'a', 'b'), 0]],
    Scan: [['Scan', m, 'Add']],
    Apply: [['Apply', lambda(['Length', 'r'], 'r'), m]],
    // A scalar head with a rule of its own (`Mod(a, 1)`, a fractional part).
    Mod: [['Mod', m, 1], ['Mod', m, 2]],
  });
  const cases: [string, string, MathJsonExpression][] = [];
  for (const [operand, m] of [['a list of lists', 'M'], ['a row read', R]] as const)
    for (const [head, programs] of Object.entries(forms(m)))
      for (const json of programs) cases.push([`${head} of ${operand}: ${JSON.stringify(json)}`, head, json]);

  test('the table has every head of LIST_OPERAND_HEADS', () => {
    const heads = new Set(cases.map(([, head]) => head));
    expect(LIST_OPERAND_HEADS.filter((head) => !heads.has(head))).toEqual([]);
  });

  const MATS = [[[1, 2], [3]], [], [[-0, 4, 5]]];
  test.each(cases)('%s', (_name, head, json) => {
    const expr = ce.box(json);
    let result: CompilationResult<'javascript'> | undefined;
    try {
      result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    } catch (error) {
      // A decline, never an internal error.
      expect([head, (error as { diagnostic?: { code?: string } }).diagnostic?.code]).toEqual([head, 'outside-profile']);
      return;
    }
    // An admitted program: a head of `NESTED_OPERAND_HEADS`, with the value
    // and the shape of the existing compiler at every depth.
    expect([head, NESTED_OPERAND_HEADS.has(head) || head === 'Loop' || head === 'Sum']).toEqual([head, true]);
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    for (const m of MATS)
      for (const i of [1, -1, 3]) {
        const vars = { M: structuredClone(m), L: [1, 2], x: 0.5, i, c: i > 0 };
        const call = (r: CompilationResult<'javascript'>, v: object) => {
          try {
            return (r.run as unknown as (v: object) => unknown)(v);
          } catch {
            return THROWS;
          }
        };
        const value = call(result, vars);
        expect(same(vars.M, m)).toBe(true);
        const reference = call(existing, { ...vars, M: structuredClone(m) });
        expect([head, m, i, value, same(value, reference)]).toEqual([head, m, i, value, true]);
      }
  });
});

//
// Declines that stay, each with its message.
//

describe('the declines of slice 1', () => {
  const ce = new ComputeEngine();
  ce.declare('M', 'list<list<real>>');
  ce.declare('A', 'matrix');
  ce.declare('Q', 'tensor');
  ce.declare('U', 'list<matrix<2x2> | vector<2>>');
  ce.declare('Z', 'list<list<complex>>');
  ce.declare('i', 'integer');
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('M2', 'matrix<2x2>');
  ce.declare('R3', 'list<list<list<real>>>');
  ce.declare('I3', 'list<list<list<integer>>>');
  ce.declare('c', 'boolean');
  ce.declare('h3', '(list<list<list<real>>>) -> real');
  ce.assign('h3', ce.box(['Function', ['At', 'a', 1, 1, 1], ['Typed', 'a', "'list<list<list<real>>>'"]]));
  const rows: [string, MathJsonExpression, RegExp, ('strict' | 'complex' | 'bigint')?][] = [
    // R3: a rank that the type does not state; the remedy is a declaration
    // of the rank (`matrix`, `list<list<real>>`).
    ['a tensor of no stated rank', ['At', 'Q', 1], /the input Q has the type tensor, a tensor whose rank the type does not state/],
    ['a list of a union of ranks', ['At', 'U', 1], /the input U has the type list<matrix<2x2> \| vector<2>>/],
    ['a list of lists of complex numbers', ['At', 'Z', 1, 1], /the input Z has the type list<list<complex>>, and the profile admits a list of lists only of rows of reals/],
    // A product or a power of lists of lists (a user decision, 2026-11-11:
    // the remedy is a `matrix` declaration, slice 4).
    ['a product of lists of lists', ['Multiply', 'M', 'M'], /Multiply with the list operand M of the type `list<list<real>>` is not in the profile/],
    ['a power of a list of lists', ['Power', 'M', 2], /Power with the list operand M is not in the profile/],
    ['a product of matrices', ['Multiply', 'A', 'A'], /Multiply with the list operand A of the type `list<list<real>>` is not in the profile/],
    ['element-wise arithmetic of a list of lists (slice 2)', ['Add', 'M', 1], /Add with the list operand M of the type `list<list<real>>` is not in the profile/],
    ['a function of a list of lists (slice 2)', ['Map', ['Function', ['Length', 'r'], 'r'], 'M'], /Map with the function .* is not in the profile/],
    ['a sum of the rows (slice 2)', ['Sum', 'M'], /Sum of one operand of the type `list<list<real>>` is not in the profile/],
    ['a matrix function (slice 3)', ['Determinant', 'A'], /unsupported head Determinant|Determinant/],
    ['a row read in a sum', ['Sum', ['At', 'M', 'i']], /the row read .*, which is undefined for an index out of range, is not in the profile as an operand of Sum/],
    ['a row read as a local', ['Block', ['Declare', 'r', "'list<real>'", ['At', 'M', 'i']], ['Length', 'r']], /the row read .*, which is undefined for an index out of range, is not in the profile as an operand of Declare/],
    // The existing emitter writes `(If(…)).length`, which throws for an
    // absent row, where it writes a guard for a row read.
    ['Length of an If of row reads', ['Length', ['If', ['Less', 'x', 0], ['At', 'M', 1], ['At', 'M', 2]]], /the row read .* is not in the profile as an operand of Length/],
    ['a row read in element-wise arithmetic', ['Add', ['At', 'M', 'i'], 1], /the row read .* is not in the profile as an operand of Add/],
    ['ReplaceAt of a row with a number', ['ReplaceAt', 'M', 1, 'x'], /ReplaceAt of M of the type `list<list<real>>` with a value of the type `real` is not in the profile/],
    ['a list of lists in the complex mode', ['At', 'M', 1, 1], /list of lists, which is not in the profile in the `complex` mode/, 'complex'],
    ['a list of lists in the bigint mode', ['Length', 'M'], /`M` \(type `list<list<real>>`\) is not on the integer lane/, 'bigint'],
    // The engine types these `missing`: the existing compiler reads an
    // element of an absent row of a list of empty rows as `undefined`, and
    // declines a row read whose type is not a list.
    ['an element of a row of empty rows', ['At', ['List', ['List']], 'i', -1], /At of \[\[.*\]\] of the type `matrix<never\^\(1x0\)>`, whose element has the type missing, is not in the profile/],
    ['an element of a row read of the type missing', ['At', ['At', ['List', ['List', 1, 1, -1]], 2], -1], /At of \[\[.*\]\] of the type `matrix<integer\^\(1x3\)>`, whose element has the type missing/],
    ['a row read of the type missing', ['Length', ['At', ['List', ['List']], 3]], /At of \[\[.*\]\] of the type `matrix<never\^\(1x0\)>`, whose element has the type missing/],
    // A list of integers of rank 3 is not read as a list of reals: the
    // lowering converts ranks 1 and 2 only.
    ['a rank-3 list of integers written to a local of reals', ['Block', ['Assign', 'S', 'R3'], ['Assign', 'S', 'I3'], 'S'], /`Assign` writes a value of the type `list<list<list<integer>>>` to the local `S` of the type `list<list<list<real>>>`/],
    ['a rank-3 list of integers as an argument of reals', ['h3', 'I3'], /The argument `.*I3.*` of `h3` has the type `list<list<list<integer>>>`, and the parameter `a` has the type `list<list<list<real>>>`/],
    ['rank-3 branches of integers and reals', ['If', 'c', 'R3', 'I3'], /The branches of `If` have the types `list<list<list<real>>>` and `list<list<list<integer>>>`/],
    ['a local declared with rank 3', ['Block', ['Declare', 'S', "'list<list<list<real>>>'", 'R3'], 'S'], /the local S declared list<list<list<real>>> is not in the profile, which admits a local of a list of lists only of rows of reals or of integers \(rank 2/],
    ['a write of an element of a list of a union of widths', ['ReplaceAt', ['List', ['At', 'M2', 1], ['List', 1]], 3, 1, 1], /ReplaceAt of .* of the type list<vector<2> \| vector<integer\^1>> with two indexes is not in the profile/],
  ];
  test.each(rows)('%s declines', (_name, json, message, mode = 'strict') => {
    const attempt = () => compile(ce.box(json), { ...PROFILE, mode } as never);
    expect(declineCode(attempt)).toBe('outside-profile');
    expect(attempt).toThrow(message);
  });

  // A captured list is a constant of the program, one array for every call:
  // a row of a list of lists is placed as it is, and the copy of a result is
  // shallow, so a program with a captured list and a list of lists
  // declines. A captured list of lists is not a constant.
  test.each([
    ['a captured list as a row', ['List', 'CL', 'CL'], /the captured list CL is read by a program with the list of lists/],
    ['a captured list written as a row', ['ReplaceAt', 'M', 1, 'CL'], /the captured list CL is read by a program with the list of lists/],
    ['a comprehension of a captured list', ['Comprehension', 'CL', ['Element', 'j', ['Range', 1, 2]]], /the captured list CL is read by a program with the list of lists/],
    ['a captured list of lists', ['At', 'CM', 'i', 1], /unsupported binding CM/],
  ] as [string, MathJsonExpression, RegExp][])('%s declines', (_name, json, message) => {
    const engine = new ComputeEngine();
    engine.declare('M', 'list<list<real>>');
    engine.declare('i', 'integer');
    engine.assign('CL', engine.box(['List', 1.5, 2.5]));
    engine.assign('CM', engine.box(['List', ['List', 1.5, 2.5]]));
    const attempt = () => compile(engine.box(json), PROFILE as never);
    expect(declineCode(attempt)).toBe('outside-profile');
    expect(attempt).toThrow(message);
  });
});

//
// The representation and the in-place updates.
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

describe('the representation of lists of lists', () => {
  const prepare = (json: MathJsonExpression) =>
    lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(json),
        { cse: false, constantFold: false }
      )
    );

  test('a row read is an at with a list result; At(M, i, j) is two', () => {
    const program = prepare(fn(['At', 'M', 'i', 'j'], M, I, J));
    const reads = allOperations(program.root).filter((op) => op.kind === 'at');
    expect(reads.map((op) => String(op.result!.type))).toEqual(['list<real>', 'real']);
    expect(String(reads[0].operands[0].type)).toBe('list<list<real>>');
  });

  test('ReplaceAt(M, i, j, x) is a replace-at of the row into the row i', () => {
    const program = prepare(fn(['ReplaceAt', 'M', 'i', 'j', 'x'], M, I, J, X));
    const ops = allOperations(program.root).filter((op) => op.kind !== 'input' && op.kind !== 'yield');
    expect(ops.map((op) => `${op.kind} ${String(op.result?.type)}`)).toEqual([
      'at list<real>',
      'replace-at list<real>',
      'replace-at list<list<real>>',
    ]);
    // An input is not unique: both copy.
    expect(inPlaceUpdates(program).size).toBe(0);
  });

  test('a row read is never written in place; the outer array of a local of the program is', () => {
    const program = prepare(
      fn(['Block',
        ['Declare', 'S', "'list<list<real>>'", ['List', ['List', 0, 0], ['List', 0, 0]]],
        ['Assign', 'S', ['ReplaceAt', 'S', 1, 2, 'x']],
        'S'], X)
    );
    const updates = [...inPlaceUpdates(program)];
    const all = allOperations(program.root).filter((op) => op.kind === 'replace-at');
    expect(all).toHaveLength(2);
    // The update of the row (its operand is a row read) copies; the update
    // of the outer array of the literal is in place.
    expect(updates.map((op) => String(op.result!.type))).toEqual(['list<list<real>>']);
  });

  test('a row placed in a list is not written in place later', () => {
    const program = prepare(
      fn(['Block',
        ['Declare', 'r', "'list<real>'", ['List', 1, 2]],
        ['Declare', 'S', "'list<list<real>>'", ['List', 'r']],
        ['Assign', 'r', ['ReplaceAt', 'r', 1, 'x']],
        ['List', ['At', 'S', 1, 1], ['At', 'r', 1]]], X)
    );
    expect(inPlaceUpdates(program).size).toBe(0);
  });
});
