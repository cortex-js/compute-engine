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

// Slices 2 and 3 of docs/plans/2026-11-11-structured-collections-and-lambdas.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): the functions of lists (`Norm`, `Mean`, `Median`, `Variance`,
// `Dot`, `Take`, `Drop`, `Rest`, `Reverse`, `Sort`, `Join`, `First`, `Last`,
// `Count`, `Range`), and the heads with a function operand (`Map`,
// `Filter`, `Count`, `Reduce`, `Scan`, `Apply`) with a function literal or
// a library operator, lowered to regions.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`, element by element) and the same shape (a number, or an
// array of the same length), and agree with the interpreter within 1e-12
// relative, or by the caveats of compiled code (`NaN` where the interpreter
// has no number).

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
const M: [string, string] = ['M', 'list<real>'];
const I: [string, string] = ['I', 'list<integer>'];
const P: [string, string] = ['P', 'tuple<real, real>'];
const Q: [string, string] = ['Q', 'tuple<real, real>'];
const X: [string, string] = ['x', 'real'];
const N: [string, string] = ['n', 'integer'];

type Arg = number | number[];

function run(result: CompilationResult<'javascript'>, args: readonly Arg[]): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(
    ...args.map((a) => (Array.isArray(a) ? [...a] : a))
  );
}

/** The same doubles and the same shape. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

/** Within 1e-12 relative of the interpreter, element by element; `NaN`
 *  where the interpreter gives no number. */
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

/** The value of the interpreter for `json` applied to `args`: a number, a
 *  boolean, a list of numbers, or `undefined` when it is not one. */
function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  args: readonly Arg[],
  tuples: readonly number[] = []
): unknown {
  const boxed = args.map((a, i) =>
    Array.isArray(a)
      ? ([tuples.includes(i) ? 'Tuple' : 'List', ...a] as MathJsonExpression)
      : a
  );
  const evaluated = ce
    .expr(['Apply', json, ...boxed] as MathJsonExpression)
    .evaluate();
  // A lazy collection (a comprehension, a `Map`, a `Filter`, a `Range`) is
  // read here.
  const value = (
    evaluated.isCollection && !isFunction(evaluated, 'List') && !isFunction(evaluated, 'Tuple')
      ? ce.function('List', [...evaluated.each()])
      : evaluated
  ).N();
  if (value.symbol === 'True') return true;
  if (value.symbol === 'False') return false;
  if (isFunction(value, 'List') || isFunction(value, 'Tuple'))
    return value.ops.map((op) => (isNumber(op) && op.im === 0 ? op.re : undefined));
  return isNumber(value) && value.im === 0 ? value.re : undefined;
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
};

const LISTS: number[][] = [[], [3], [1, -2.5, 7], [-0, 1e300, 5e-324, 1 / 3], [2, Number.NaN, -1]];
const INTEGER_LISTS: number[][] = [[], [4], [1, -2, 7, 3]];
const COUNTS = [0, 1, 2, -1, -2, 5, -5];

const withLists = (extra: (list: number[]) => Arg[] = () => []) =>
  LISTS.map((list) => [list, ...extra(list)]);

// (a) The functions of lists of slice 2, most frequent first in the shadow
// measure.
const SLICE_2: Program[] = [
  { name: 'Norm of a list', json: fn(['Norm', 'L'], L), args: withLists() },
  {
    name: 'Norm of a list with an infinite and a NaN element: +Infinity',
    json: fn(['Norm', 'L'], L),
    args: [[[Number.NaN, Infinity]], [[-Infinity, 1]]],
    existingOnly: true,
  },
  { name: 'Norm of a list of integers', json: fn(['Norm', 'I'], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'Norm of a tuple', json: fn(['Norm', 'P'], P), args: [[[3, 4]], [[-0, 1e300]]], tuples: [0] },
  { name: 'Norm of a list literal', json: fn(['Norm', ['List', 'x', 1]], X), args: [[3], [-0], [1e200]] },
  {
    name: 'Dot of two lists of one length',
    json: fn(['Dot', 'L', 'M'], L, M),
    args: [[[1, 2, 3], [4, 5, 6]], [[], []], [[-0], [5e-324]], [[1e300, 1], [1e10, -1]]],
  },
  {
    name: 'Dot of two lists of different lengths: NaN, where the interpreter gives an error',
    json: fn(['Dot', 'L', 'M'], L, M),
    args: [[[1, 2], [4, 5, 6]]],
    existingOnly: true,
  },
  {
    name: 'Dot of two tuples: the sum of the products in order',
    json: fn(['Dot', 'P', 'Q'], P, Q),
    args: [[[1, 2], [3, 4]], [[1e300, 1], [1e10, -1]], [[-0, 0], [1, -1]]],
    tuples: [0, 1],
  },
  {
    // Below `MIN_UNROLLED_WIDTH` (5) the existing compiler writes the sum
    // of the products too: `-0` for products that are all `-0`.
    name: 'Dot of two tuples of four reals',
    json: fn(['Dot', 'P', 'Q'], ['P', 'tuple<real, real, real, real>'], ['Q', 'tuple<real, real, real, real>']),
    args: [[[0, 0, 0, 0], [-1, -1, -1, -1]], [[1, 2, 3, 4], [0.5, -1, 2, 1e10]]],
    tuples: [0, 1],
  },
  { name: 'Mean of a list', json: fn(['Mean', 'L'], L), args: withLists() },
  { name: 'Median of a list', json: fn(['Median', 'L'], L), args: [[[]], [[3]], [[3, 1, 2]], [[4, 1]]] },
  { name: 'Variance of a list', json: fn(['Variance', 'L'], L), args: [[[]], [[3]], [[3, 1, 2]], [[1e8, 1e8 + 1]]] },
  {
    name: 'Mean of a tuple and a sum',
    json: fn(['Add', ['Mean', 'P'], 'x'], P, X),
    args: [[[3, 4], 1], [[-0, -0], -0]],
    tuples: [0],
  },
  {
    name: 'Take of a list, every count',
    json: fn(['Take', 'L', 'n'], L, N),
    args: COUNTS.flatMap((n) => [[[1, -2.5, 7], n], [[], n]]),
  },
  {
    name: 'Drop of a list, every count',
    json: fn(['Drop', 'L', 'n'], L, N),
    args: COUNTS.flatMap((n) => [[[1, -2.5, 7], n], [[], n]]),
  },
  { name: 'Take with a literal count', json: fn(['Take', 'L', 2], L), args: withLists() },
  { name: 'Take with a negative literal count', json: fn(['Take', 'L', -2], L), args: withLists() },
  { name: 'Drop with a literal count', json: fn(['Drop', 'L', 2], L), args: withLists() },
  { name: 'Take of a list of integers', json: fn(['Take', 'I', 'n'], I, N), args: [[[1, -2, 7, 3], 2], [[4], -3]] },
  {
    name: 'Sum of Take of a computed count',
    json: fn(['Sum', ['Take', 'L', ['Add', 'n', 1]]], L, N),
    args: [[[1, 2, 3], 0], [[1, 2, 3], -3]],
  },
  { name: 'Rest of a list', json: fn(['Rest', 'L'], L), args: withLists() },
  { name: 'Reverse of a list', json: fn(['Reverse', 'L'], L), args: withLists() },
  { name: 'Sort of a list, NaN last', json: fn(['Sort', 'L'], L), args: withLists(), existingOnly: true },
  { name: 'Sort of a list of numbers', json: fn(['Sort', 'L'], L), args: [[[3, -1, 2]], [[-0, 0]], [[]]] },
  { name: 'Join of two lists', json: fn(['Join', 'L', 'M'], L, M), args: [[[1, 2], [3]], [[], []], [[-0], []]] },
  { name: 'Join of three lists of integers', json: fn(['Join', 'I', ['List', 1, 2], 'I'], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'First of a list', json: fn(['First', 'L'], L), args: withLists() },
  { name: 'Last of a list', json: fn(['Last', 'L'], L), args: withLists() },
  { name: 'First and Last of a tuple', json: fn(['Add', ['First', 'P'], ['Last', 'P']], P), args: [[[1, 2]], [[-0, -0]]], tuples: [0] },
  { name: 'Count of a list', json: fn(['Count', 'L'], L), args: withLists() },
  { name: 'Range from 1 to n', json: fn(['Range', 1, 'n'], N), args: [[3], [1], [0], [-2]] },
  { name: 'Range of one bound', json: fn(['Range', 'n'], N), args: [[3], [0], [-1]] },
  { name: 'Range of literal bounds', json: fn(['Range', 2, 5]), args: [[]] },
  { name: 'Range downwards', json: fn(['Range', 'n', -1], N), args: [[2], [-3]] },
  // Element 0 of a range is its lower bound itself: `-0` for `-0`
  // (`materializeRange()` of the runtime, as the existing compiler).
  {
    name: 'Range from -0',
    json: fn(['Range', 'n', 'm'], N, ['m', 'integer']),
    args: [[-0, 2], [-0, -2]],
    existingOnly: true,
  },
  {
    name: 'the reciprocal of the first element of a range from -n',
    json: fn(['Divide', 1, ['First', ['Range', ['Negate', 'n'], 'm']]], N, ['m', 'integer']),
    args: [[0, 2], [0, -1]],
    existingOnly: true,
  },
  {
    name: 'a comprehension over a range from -0 (slice 1)',
    json: fn(['Comprehension', 'j', ['Element', 'j', ['Range', 'n', 'm']]], N, ['m', 'integer']),
    args: [[-0, 2], [-0, -2]],
    existingOnly: true,
  },
  { name: 'Sum of a Range', json: fn(['Sum', ['Range', 1, 'n']], N), args: [[4], [0], [-3]] },
  {
    name: 'At of Sort and of Reverse',
    json: fn(['Add', ['At', ['Sort', 'L'], 1], ['At', ['Reverse', 'L'], -1]], L),
    args: [[[3, 1, 2]], [[5]]],
  },
  {
    name: 'a fold of an element-wise sum of a Take',
    json: fn(['Sum', ['Add', ['Take', 'L', 2], 'x']], L, X),
    args: [[[1, 2, 3], 0.5], [[], 1]],
  },
];

// (b) to (d): the heads with a function operand of slice 3.
const SLICE_3: Program[] = [
  {
    name: 'Map of a lambda',
    json: fn(['Map', lambda(['Add', ['Multiply', 't', 'x'], 1], 't'), 'L'], L, X),
    args: LISTS.map((l) => [l, 0.5]),
    modes: ['strict'],
  },
  {
    name: 'Map of a lambda over a list of integers, an integer body',
    json: fn(['Map', lambda(['Add', ['Multiply', 't', 't'], 1], 't'), 'I'], I),
    args: INTEGER_LISTS.map((l) => [l]),
    modes: ['strict'],
  },
  {
    name: 'Map of a lambda over a tuple',
    json: fn(['Map', lambda(['Multiply', 't', 'x'], 't'), 'P'], P, X),
    args: [[[1, 2], 3], [[-0, 1e300], -1]],
    tuples: [0],
    modes: ['strict'],
  },
  {
    name: 'Map of a lambda with a condition and a sum in its body',
    json: fn(
      ['Map', lambda(['If', ['Less', 't', 0], ['Sum', ['Multiply', 'k', 't'], ['Limits', 'k', 1, 3]], 't'], 't'), 'L'],
      L
    ),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'Map of a lambda over a Range',
    json: fn(['Map', lambda(['Multiply', 't', 't'], 't'), ['Range', 1, 'n']], N),
    args: [[3], [0], [-2]],
    modes: ['strict'],
  },
  {
    name: 'Sum of Map of a lambda (fused on the existing compiler)',
    json: fn(['Sum', ['Map', lambda(['Multiply', 't', 't'], 't'), 'L']], L),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'At of Map of a lambda',
    json: fn(['At', ['Map', lambda(['Divide', 1, 't'], 't'), 'L'], 1], L),
    args: [[[2, 3]], [[-0]]],
    modes: ['strict'],
  },
  ...['Sin', 'Cos', 'Exp', 'Abs', 'Negate', 'Floor', 'Tanh', 'Arctan', 'Sign', 'Erf', 'Gamma', 'Factorial', 'Truncate', 'Coth', 'Arccot', 'Arcsch'].map(
    (op): Program => ({
      name: `Map of the operator ${op}`,
      json: fn(['Map', op, 'L'], L),
      // The interpreter reads `1e300` and `5e-324` as the decimal numbers
      // of their text, not as the doubles: no comparison there.
      args: [...withLists().slice(0, 3), [[-0, 0.5, 1 / 3, 40]]],
      modes: ['strict'],
    })
  ),
  {
    name: 'Map of Floor in the complex mode',
    json: fn(['Map', 'Floor', 'L'], L),
    args: withLists(),
    modes: ['complex'],
  },
  {
    name: 'Map of Abs over a list of integers',
    json: fn(['Map', 'Abs', 'I'], I),
    args: INTEGER_LISTS.map((l) => [l]),
    modes: ['strict'],
  },
  {
    name: 'Filter of a lambda',
    json: fn(['Filter', 'L', lambda(['Less', 't', 'x'], 't')], L, X),
    args: LISTS.map((l) => [l, 1.5]),
    modes: ['strict'],
  },
  {
    name: 'Map of Factorial2 over a list of integers',
    json: fn(['Map', 'Factorial2', 'I'], I),
    args: [[[5, 4, 0, -1]], [[]]],
    modes: ['strict'],
  },
  // A chained comparison (`0 < t < 2`) in a predicate and in a body.
  {
    name: 'Filter with a chained comparison',
    json: fn(['Filter', 'L', lambda(['Less', 0, 't', 2], 't')], L),
    // The interpreter reads `5e-324` as the decimal of its text: no
    // comparison with it there.
    args: [...withLists().slice(0, 3), [[-0, 0.5, 2, 1 / 3]]],
    modes: ['strict'],
  },
  {
    name: 'Count with a chained comparison that reads an input',
    json: fn(['Count', 'L', lambda(['LessEqual', 0, 't', 'x', 3], 't')], L, X),
    args: LISTS.map((l) => [l, 1.5]),
    modes: ['strict'],
  },
  {
    name: 'Map with a chained comparison in its body',
    json: fn(['Map', lambda(['If', ['Less', 0, 't', 2], 't', 0], 't'), 'L'], L),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'Filter of a lambda over a Range',
    json: fn(['Filter', ['Range', 1, 'n'], lambda(['Equal', ['Mod', 't', 3], 0], 't')], N),
    args: [[10], [0], [-4]],
    modes: ['strict'],
  },
  {
    name: 'Count of a predicate',
    json: fn(['Count', 'L', lambda(['Less', 't', 'x'], 't')], L, X),
    args: LISTS.map((l) => [l, 1.5]),
    modes: ['strict'],
  },
  {
    name: 'Count of Filter of a Range',
    json: fn(['Count', ['Filter', ['Range', 1, 'n'], lambda(['Equal', ['Mod', 'k', 3], 0], 'k')]], N),
    args: [[10], [2]],
    modes: ['strict'],
  },
  ...['Add', 'Multiply', 'Max', 'Min'].map(
    (op): Program => ({
      name: `Reduce by ${op} with no initial value`,
      json: fn(['Reduce', 'L', op], L),
      args: withLists(),
    })
  ),
  ...['Add', 'Multiply', 'Max', 'Min'].map(
    (op): Program => ({
      name: `Reduce by ${op} with an initial value`,
      json: fn(['Reduce', 'L', op, 'x'], L, X),
      args: LISTS.map((l) => [l, -0]),
    })
  ),
  {
    name: 'Reduce of a list of integers by Add from 1',
    json: fn(['Reduce', 'I', 'Add', 1], I),
    args: INTEGER_LISTS.map((l) => [l]),
  },
  {
    name: 'Reduce by a lambda with an initial value',
    json: fn(['Reduce', 'L', lambda(['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b'), 0], L),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'Reduce by a lambda that reads an input',
    json: fn(['Reduce', 'L', lambda(['Max', 'a', ['Multiply', 'b', 'x']], 'a', 'b'), 'x'], L, X),
    args: LISTS.map((l) => [l, -2]),
    modes: ['strict'],
  },
  ...['Add', 'Multiply', 'Max'].map(
    (op): Program => ({
      name: `Scan by ${op}, with and without an initial value`,
      json: fn(['Join', ['Scan', 'L', op], ['Scan', 'L', op, 'x']], L, X),
      args: LISTS.map((l) => [l, 2]),
    })
  ),
  {
    name: 'Scan by a lambda with an initial value',
    json: fn(['Scan', 'L', lambda(['Add', 'a', 'b', 1], 'a', 'b'), 0], L),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'Scan by a lambda with no initial value',
    json: fn(['Scan', 'L', lambda(['Multiply', 'a', 'b'], 'a', 'b')], L),
    args: withLists(),
    modes: ['strict'],
  },
  {
    name: 'Apply of a lambda of one parameter',
    json: fn(['Apply', lambda(['Add', 't', 1], 't'), 'x'], X),
    args: [[0.5], [-0], [-1]],
    modes: ['strict'],
  },
  {
    name: 'Apply of a lambda of two parameters',
    json: fn(['Apply', lambda(['Divide', 's', 't'], 's', 't'), 'x', ['Add', 'x', 1]], X),
    args: [[0.5], [-1], [-0]],
    modes: ['strict'],
  },
  {
    name: 'a lambda nested in a lambda',
    json: fn(
      ['Map', lambda(['Count', 'M', lambda(['Less', 's', 't'], 's')], 't'), 'L'],
      L,
      M
    ),
    args: [[[1, 2, 3], [0, 2.5, 3]], [[], [1]], [[1], []]],
    modes: ['strict'],
  },
];

describe.each([
  ['slice 2: functions of lists', SLICE_2],
  ['slice 3: function operands', SLICE_3],
] as const)('%s', (_label, programs) => {
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, program) => {
    const ce = new ComputeEngine();
    for (const mode of program.modes ?? MODES) {
      const expr = ce.expr(program.json);
      const result = compile(expr, { ...PROFILE, mode } as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, { ...EXISTING, mode }) as CompilationResult<'javascript'>;
      for (const args of program.args) {
        const value = run(result, args);
        expect([mode, args, value]).toEqual([mode, args, value]);
        expect([mode, args, same(value, run(existing, args))]).toEqual([mode, args, true]);
        // The interpreter refuses a `NaN` element of a `list<real>` argument.
        if (program.existingOnly || args.some((a) => Array.isArray(a) && a.some(Number.isNaN))) continue;
        const expected = interpret(ce, program.json, args, program.tuples);
        expect([mode, args, close(value, expected)]).toEqual([mode, args, true]);
      }
    }
  });
});

describe('the declines of slices 2 and 3', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('M', 'list<real>');
  ce.declare('P', 'tuple<real, real>');
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('f', '(real) -> real');
  ce.declare('g', '(real) -> boolean');
  ce.declare('P5', 'tuple<real, real, real, real, real>');
  ce.declare('Q5', 'tuple<real, real, real, real, real>');
  ce.declare('P6', 'tuple<real, real, real, real, real, real>');
  ce.declare('Q6', 'tuple<real, real, real, real, real, real>');
  ce.assign('w', 0.75);
  const declines: [string, MathJsonExpression, RegExp, Mode?][] = [
    // A numeric order is in the profile since slice 3 of the nested lists
    // (compile-javascript-structured-nested2.test.ts); a named one is not.
    ['Norm with a named order', ['Norm', 'L', "'Frobenius'"], /unsupported head String/],
    ['Take with a real count', ['Take', 'L', 'x'], /Take with x of the type `real` is not in the profile, which reads an integer there/],
    ['Take of a tuple', ['Take', 'P', 1], /Take of P of the type `point<2>` is not in the profile, which reads a list of reals/],
    ['Range with a literal step 0', ['Range', 1, 'n', 0], /Range with the literal step 0 is not in the profile/],
    ['Range with a real bound', ['Range', 1, 'x'], /Range with x of the type `real` is not in the profile/],
    // From five elements on, the existing compiler calls `_SYS.matmul`,
    // whose sum starts at `+0` (the next test).
    ['Dot of two tuples of five reals', ['Dot', 'P5', 'Q5'], /Dot of two tuples of 5 elements is not in the profile/],
    ['Dot of two tuples of six reals', ['Dot', 'P6', 'Q6'], /Dot of two tuples of 6 elements is not in the profile/],
    ['Dot of a list and a tuple', ['Dot', 'L', 'P'], /Dot of L of the type `list<real>` and P of the type `point<2>` is not in the profile/],
    ['Sort with an ordering function', ['Sort', 'L', lambda(['Less', 'a', 'b'], 'a', 'b')], /unsupported head Function/],
    ['Map over two lists', ['Map', lambda(['Add', 's', 't'], 's', 't'), 'L', 'M'], /Map with the function \(s, t\) => s \+ t is not in the profile/],
    ['Map of a user function', ['Map', 'f', 'L'], /Map with the function f is not in the profile/],
    [
      'Map of a local function',
      ['Block', ['Declare', 'lg', "'function'", lambda(['Add', 's', 1], 's')], ['Map', 'lg', 'L']],
      /Map with the local function .*lg.* is not in the profile/,
    ],
    ['Map of Fract (the profile declines Fract of a name)', ['Map', 'Fract', 'L'], /Map of the operator Fract is not in the profile, which maps the operators/],
    ['Map of Arcsec (a complex element)', ['Map', 'Arcsec', 'L'], /Map of the type list<complex \| infinity \| nan> is not in the profile/],
    ['First of Map of Ln (a complex element)', ['First', ['Map', 'Ln', 'L']], /First of Map\(ln, L\) is not in the profile: its elements are numbers that are not real/],
    ['Map of an operator of no element function', ['Map', 'Ceil', 'L'], /Map of the operator Ceil is not in the profile, which maps the operators/],
    ['Map of a lambda in the complex mode', ['Map', lambda(['Add', 't', 1], 't'), 'L'], /Map with a function literal is not in the profile in the complex mode/, 'complex'],
    ['Map of Sin in the complex mode', ['Map', 'Sin', 'L'], /Map of the operator Sin is not in the profile in the complex mode/, 'complex'],
    ['Map of a lambda that draws', ['Map', lambda(['Add', 't', ['Random']], 't'), 'L'], /Map whose function has the node Random\(\), which is not pure, draws, runs code of the host or can abort/],
    ['Map of the empty list literal', ['Map', 'Sin', ['List']], /Map of the empty list literal is not in the profile/],
    // `Ln` and `Sqrt` of a real are complex for a negative real: the
    // existing compiler reads the elements on the complex lane.
    ['Map of Ln over a list of reals', ['Map', 'Ln', 'L'], /Map of the type list<complex \| signed_infinity> is not in the profile/],
    ['Map of Sqrt over a list of reals', ['Map', 'Sqrt', 'L'], /Map of the type list<complex> is not in the profile/],
    ['Dot of two list literals (the existing compiler writes the sum of the products)', ['Dot', ['List', 'x', 1], ['List', 2, 'x']], /Dot of \[x,1\] is not in the profile/],
    ['First of a local list in the complex mode', ['Block', ['Declare', 'R', "'list<real>'", ['List', 'x', 2]], ['First', 'R']], /First of R is not in the profile: in the complex mode the existing compiler reads a local list with _SYS.cplx/, 'complex'],
    ['Last of an element-wise product of a name of no declared type in the complex mode', ['Last', ['Multiply', 'L', 'w']], /Last of .* is not in the profile: in the complex mode the existing compiler reads elements of the type/, 'complex'],
    ['Map of a lambda of a boolean value', ['Map', lambda(['Less', 't', 1], 't'), 'L'], /Map whose function has a value of the type `boolean` is not in the profile/],
    ['Filter of a user function', ['Filter', 'L', 'g'], /Filter with the function g is not in the profile/],
    ['Reduce by a lambda with no initial value', ['Reduce', 'L', lambda(['Add', 'a', 'b'], 'a', 'b')], /Reduce with a function literal or a user function and no initial value is not in the profile/],
    ['Reduce by Subtract', ['Reduce', 'L', 'Subtract'], /Reduce by the operator Subtract is not in the profile, which folds with Add, Multiply, Max and Min/],
    ['Reduce of a tuple', ['Reduce', 'P', 'Add'], /Reduce of P of the type `point<2>` is not in the profile/],
    ['Apply in the complex mode', ['Apply', lambda(['Add', 't', 1], 't'), 'x'], /Apply with a function literal is not in the profile in the complex mode/, 'complex'],
    ['Apply of a lambda of a list value', ['Apply', lambda(['List', 't'], 't'), 'x'], /Apply whose function has a value of the type list<unknown> is not in the profile, which admits a number or a boolean/],
  ];
  test.each(declines)('%s declines', (_name, json, message, mode = 'strict') => {
    expect(() => compile(ce.box(json), { ...PROFILE, mode } as never)).toThrow(message);
  });
});

test('the existing compiler gives +0 for Dot of two tuples of five reals that the sum of the products gives as -0', () => {
  const ce = new ComputeEngine();
  ce.declare('P5', 'tuple<real, real, real, real, real>');
  ce.declare('Q5', 'tuple<real, real, real, real, real>');
  const existing = compile(ce.box(['Dot', 'P5', 'Q5']), EXISTING) as CompilationResult<'javascript'>;
  const value = (existing.run as unknown as (v: object) => number)({ P5: [0, 0, 0, 0, 0], Q5: [-1, -1, -1, -1, -1] });
  expect(Object.is(value, 0)).toBe(true);
  expect((existing.run as unknown as (v: object) => number)({ P5: [1, 2, 3, 4, 5], Q5: [1, 1, 1, 1, 2] })).toBe(20);
});

describe('a range of more than 2^32 - 1 elements throws before it is made', () => {
  // The existing compiler tests the count before it allocates
  // (`materializeRange()`, `_SYS.rangeCount()`); so does the route.
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  test.each([
    ['Length of a Range', ['Length', ['Range', 1, 'n']]],
    ['Sum of a Range', ['Sum', ['Range', 1, 'n']]],
    ['Map over a Range', ['Map', lambda(['Multiply', 't', 2], 't'), ['Range', 1, 'n']]],
    ['Filter of a Range', ['Filter', ['Range', 1, 'n'], lambda(['Less', 't', 3], 't')]],
    ['Reduce of a Range', ['Reduce', ['Range', 1, 'n'], 'Add', 0]],
    ['a comprehension over a range (slice 1)', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 'n']]]],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => {
    const result = compile(ce.box(json), PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(ce.box(json), EXISTING) as CompilationResult<'javascript'>;
    const at = { n: 4294967296 };
    expect(() => (result.run as unknown as (v: object) => unknown)(at)).toThrow(RangeError);
    expect(() => (existing.run as unknown as (v: object) => unknown)(at)).toThrow(RangeError);
  });
});

describe('a library operator that an option of the host maps declines', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  test.each([
    ['vars', ['Map', 'Sin', 'L'], { vars: { Sin: '((t) => t + 1)' } }, /Map with the operator Sin, which an option of the host maps, is not in the profile/],
    ['vars of a fold operator', ['Reduce', 'L', 'Add', 0], { vars: { Add: '((a, b) => a - b)' } }, /Reduce with the operator Add, which an option of the host maps/],
    ['functions', ['Map', 'Sin', 'L'], { functions: { Sin: '((t) => t + 1)' } }, /the option `functions` maps Sin, an operator or a constant of the library/],
    ['operators', ['Scan', 'L', 'Max'], { operators: { Max: ['hostMax', 10] } }, /the option `operators` maps Max, an operator or a constant of the library/],
  ] as [string, MathJsonExpression, object, RegExp][])('%s', (_name, json, options, message) => {
    expect(() => compile(ce.box(json), { ...PROFILE, ...options } as never)).toThrow(message);
  });
  test('the existing compiler calls the source of a vars entry', () => {
    const existing = compile(ce.box(['Map', 'Sin', 'L']), { ...EXISTING, vars: { Sin: '((t) => t + 1)' } } as never) as CompilationResult<'javascript'>;
    expect((existing.run as unknown as (v: object) => unknown)({ L: [0] })).toEqual([1]);
  });
});

describe('the host, the effects and the laziness of a function body', () => {
  const host = globalThis as unknown as Record<string, unknown>;
  let calls = 0;
  host.__collections2Impure = (t: number) => {
    calls += 1;
    return t + 1;
  };
  host.__collections2Pure = (t: number) => t * 2;
  host.__collections2Read = () => 7;
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<real>');
  ce.declare('hq', '(real) -> real');
  ce.declare('hp', '(real) -> real');
  ce.declare('vr', 'real');
  const OPTIONS = {
    ...PROFILE,
    functions: { hq: '__collections2Impure', hp: { source: '__collections2Pure', pure: true } },
    vars: { vr: '__collections2Read()' },
  } as never;
  test.each([
    ['a call that is not pure', ['Map', lambda(['hq', 't'], 't'), 'L'], /Map whose function has the node hq\(t\)/],
    ['a call declared pure', ['Filter', 'L', lambda(['Less', ['hp', 't'], 1], 't')], /Filter whose function has the node hp\(t\)/],
    ['a read of the host', ['Reduce', 'L', lambda(['Add', 'a', 'b', 'vr'], 'a', 'b'), 0], /Reduce whose function has the node "vr"/],
    ['a seeded body', ['Scan', 'L', lambda(['WithRandomSeed', 3, ['Add', 'a', 'b']], 'a', 'b'), 0], /Scan whose function has the node WithRandomSeed/],
  ] as [string, MathJsonExpression, RegExp][])('%s in the body declines', (_name, json, message) => {
    expect(() => compile(ce.box(json), OPTIONS)).toThrow(message);
  });

  test('Apply calls the host once, where it is, as the existing compiler does', () => {
    const json: MathJsonExpression = ['Add', ['Apply', lambda(['hq', 't'], 't'), 'x'], 'x'];
    const result = compile(ce.box(json), OPTIONS) as CompilationResult<'javascript'>;
    calls = 0;
    expect((result.run as unknown as (v: object) => number)({ x: 1 })).toBe(3);
    expect(calls).toBe(1);
  });

  test('a call of the host outside the body is evaluated once, before the elements', () => {
    const json: MathJsonExpression = ['Map', lambda(['Multiply', 't', 2], 't'), ['List', ['hq', 'x'], 1]];
    const result = compile(ce.box(json), OPTIONS) as CompilationResult<'javascript'>;
    calls = 0;
    expect((result.run as unknown as (v: object) => unknown)({ x: 1 })).toEqual([4, 2]);
    expect(calls).toBe(1);
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

describe('the representation: in place, execution and shape of the lowering', () => {
  const prepare = (json: MathJsonExpression) =>
    lowerStructuredFragment(
      new ScalarFragmentJavaScriptTarget('structured').prepareStructured(
        new ComputeEngine().expr(json),
        { cse: false, constantFold: false }
      )
    );

  test('a list that a function of lists makes is written in place', () => {
    const program = prepare(fn(['ReplaceAt', ['Take', 'L', 2], 1, 'x'], L, X));
    const replace = allOperations(program.root).find((op) => op.kind === 'replace-at')!;
    expect(inPlaceUpdates(program).has(replace)).toBe(true);
  });

  test('an input read by a function of lists before an update is not written in place', () => {
    // The input itself is never unique; a `take` of it is a copy and holds
    // no array of the input.
    const program = prepare(fn(['Add', ['Sum', ['Take', 'L', 1]], ['At', ['ReplaceAt', 'L', 1, 'x'], 1]], L, X));
    const replace = allOperations(program.root).find((op) => op.kind === 'replace-at')!;
    expect(inPlaceUpdates(program).has(replace)).toBe(false);
  });

  test('a list read by a function of lists before an update of it is written in place', () => {
    const program = prepare(
      fn(['Block', ['Declare', 'R', "'list<real>'", ['List', 'x', 2]], ['Add', ['Norm', 'R'], ['At', ['ReplaceAt', 'R', 1, 3], 1]]], X)
    );
    const replace = allOperations(program.root).find((op) => op.kind === 'replace-at')!;
    expect(inPlaceUpdates(program).has(replace)).toBe(true);
  });

  test('Filter appends in place to the list that it carries', () => {
    const program = prepare(fn(['Filter', 'L', lambda(['Less', 't', 0], 't')], L));
    const append = allOperations(program.root).find((op) => op.kind === 'append')!;
    expect(inPlaceUpdates(program).has(append)).toBe(true);
  });

  test('a program of function operands is pure and shippable, and no loop of a fold is a candidate', () => {
    const program = prepare(
      fn(['Add', ['Reduce', ['Map', lambda(['Multiply', 't', 'x'], 't'), 'L'], 'Add', 0], ['Count', 'L', lambda(['Less', 't', 'x'], 't')]], L, X)
    );
    const analysis = analyzeExecution(program);
    expect(analysis.independentCalls.holds).toBe(true);
    expect(analysis.workerPortable.holds).toBe(true);
    expect(analysis.parallelLoops.every((j) => !j.candidate)).toBe(true);
    // No function value: the program has no function, no call.
    expect(program.functions).toEqual([]);
    expect(allOperations(program.root).some((op) => op.kind === 'call')).toBe(false);
  });
});

describe('a list made by a function operand before a write of a local that it reads', () => {
  // `xs[2]` of a `scan` declines (`refuseStrictWideReads()`: the existing
  // compiler types that read `number`), so `Scan` has no row here.
  // The interpreter's `Map`, `Filter` and `Scan` are lazy views, but an
  // assignment stores the elements of a lazy collection that reads a
  // variable (`listedAssignedValue()` in `library/core.ts`): the list keeps
  // the values that the variables had at the assignment, as the eager list
  // of the route and of the existing compiler. An operand is read where it
  // is.
  const literalOf = (source: string): { ce: ComputeEngine; literal: Expression } => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    return {
      ce,
      literal: (ce.lookupDefinition('f') as { operator: { _lambdaLiteral: Expression } }).operator._lambdaLiteral,
    };
  };
  test.each([
    ['Map', 'let c: real = 1; let xs = map((t) => t + c, [1, 2, 3]); c = 5; xs[1]', 2],
    ['Filter', 'let c: real = 1; let xs = filter([1, 2, 3], (t) => t > c); c = 5; length(xs)', 2],
    ['Take of a Map', 'let c: real = 1; let xs = take(map((t) => t + c, [1, 2, 3]), 2); c = 5; xs[1]', 2],
    ['Reduce', 'let c: real = 1; let r = reduce([1, 2, 3], (s, t) => s + t * c, 0); c = 5; r', 6],
    ['Count', 'let c: real = 1; let n = count([1, 2, 3], (t) => t > c); c = 5; n', 2],
    ['a Map in a loop that writes the local after', 'let c: real = 1; let r = 0; for j in 1..2 { r = r + sum(map((t) => t + c, [1, 2])); c = c + 10 }; r', 30],
    ['a Map made before a loop that writes the local', 'let c: real = 1; let xs = map((t) => t + c, [1, 2, 3]); for j in 1..2 { c = c + 10 }; xs[1] + xs[3]', 6],
    ['Apply', 'let c: real = 2; apply((t) => t * c, a)', 1],
  ])('%s: the interpreter, the route and the existing compiler agree', (_name, body, expected) => {
    const { ce, literal } = literalOf(`function f(a: real) -> real { ${body} }`);
    const result = compile(literal, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(literal, EXISTING) as CompilationResult<'javascript'>;
    expect(run(result, [0.5])).toBe(expected);
    expect(run(existing, [0.5])).toBe(expected);
    expect(ce.expr(['f', 0.5]).evaluate().re).toBe(expected);
  });
});
