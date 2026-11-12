import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Row 3 of section 4 of docs/plans/2026-11-11-js-profile-decline-census.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): the library functions of flat lists that the existing compiler
// compiles (`Ordering`, `IndexOf`, `Contains`, `Unique`, `Second`, `Third`,
// `Most`, `IsEmpty`, `Append`, `Repeat`, `Linspace`, `Slice`, the
// statistics), the heads with a predicate (`CountIf`, `Any`, `All`, `Find`,
// `IndexWhere`, `Position`, `TakeWhile`, `DropWhile`) and `Tabulate`, and the
// index operands that are not one integer: `At` with a real index, with a
// list index (a gather) or a `Range` index, `Take` and `Drop` with a real
// count.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`), and the same shape at every depth; the inputs must be the
// same after the call as a deep copy taken before it, and a second call with
// the same inputs gives the same value. The value agrees with the
// interpreter within 1e-12 relative, or by the caveats of compiled code
// (`NaN` where the interpreter has no number), for the arguments that the
// interpreter admits (finite numbers: a `NaN` or an infinity is not a
// `real`). In the `complex` mode the profile gives the same value or
// declines.

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
const lambda = (
  body: MathJsonExpression,
  ...names: string[]
): MathJsonExpression => ['Function', body, ...names] as MathJsonExpression;

const L: [string, string] = ['L', 'list<real>'];
const M: [string, string] = ['M', 'list<real>'];
const I: [string, string] = ['I', 'list<integer>'];
const X: [string, string] = ['x', 'real'];
const Y: [string, string] = ['y', 'real'];
const N: [string, string] = ['n', 'integer'];
const K: [string, string] = ['k', 'integer'];
const P: [string, string] = ['P', 'tuple<real, real>'];
const LP: [string, string] = ['LP', 'list<tuple<real, real>>'];

type Arg = number | number[] | number[][];

function run(
  result: CompilationResult<'javascript'>,
  args: readonly Arg[]
): unknown {
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

/** Whether every number of an argument is finite: the interpreter admits
 *  it as a `real`. */
const finite = (a: Arg): boolean =>
  Array.isArray(a) ? a.every((e) => finite(e as Arg)) : Number.isFinite(a);

/** The MathJSON of an argument; `tuple` makes a flat array a tuple. */
function boxArg(a: Arg, tuple: boolean): MathJsonExpression {
  if (!Array.isArray(a)) return Object.is(a, -0) ? { num: '-0' } : a;
  return [
    tuple ? 'Tuple' : 'List',
    ...a.map((e) =>
      Array.isArray(e) ? (['Tuple', ...e] as MathJsonExpression) : boxArg(e, false)
    ),
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
    .expr([
      'Apply',
      json,
      ...args.map((a, i) => boxArg(a, tuples.includes(i))),
    ] as MathJsonExpression)
    .evaluate();
  // A lazy collection (a `Range`, a `Map`) is read here.
  return valueOf(
    (evaluated.isCollection &&
    !isFunction(evaluated, 'List') &&
    !isFunction(evaluated, 'Tuple')
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
  /** No comparison with the interpreter (the caveats of compiled code). */
  readonly existingOnly?: boolean;
};

/** The outcome of the profile on `program` in `mode`: the compiled result,
 *  or `declined` for a decline (`outside-profile`). */
function profileOf(
  expr: Expression,
  mode: Mode
): CompilationResult<'javascript'> | 'declined' {
  try {
    return compile(expr, {
      ...PROFILE,
      mode,
    } as never) as CompilationResult<'javascript'>;
  } catch (error) {
    // A decline, never an internal error.
    expect((error as { diagnostic?: { code?: string } }).diagnostic?.code).toBe(
      'outside-profile'
    );
    return 'declined';
  }
}

/** Each program, compiled with the profile and with the existing compiler,
 *  and run on each list of arguments. In the `strict` mode the profile
 *  admits the program; in the `complex` mode it gives the same value or
 *  declines. */
function check(program: Program): void {
  for (const mode of MODES) {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const expr = ce.expr(program.json);
    const result = profileOf(expr, mode);
    if (result === 'declined') {
      expect([mode, 'declined']).toEqual(['complex', 'declined']);
      continue;
    }
    const existing = compile(expr, {
      ...EXISTING,
      mode,
    }) as CompilationResult<'javascript'>;
    for (const args of program.args) {
      const inputs = args.map((a) => structuredClone(a));
      const value = run(result, inputs);
      // The inputs are not written, and a second call gives the same value.
      expect([mode, args, same(inputs, args)]).toEqual([mode, args, true]);
      expect([mode, args, same(run(result, inputs), value)]).toEqual([
        mode,
        args,
        true,
      ]);
      const reference = run(
        existing,
        args.map((a) => structuredClone(a))
      );
      expect([mode, args, value, same(value, reference)]).toEqual([
        mode,
        args,
        value,
        true,
      ]);
      if (program.existingOnly || !args.every(finite)) continue;
      const expected = interpret(ce, program.json, args, program.tuples);
      expect([mode, args, value, close(value, expected)]).toEqual([
        mode,
        args,
        value,
        true,
      ]);
    }
  }
}

/** Lists of reals: empty, one element, ties, signed zeros, `NaN` and the
 *  infinities. */
const LISTS: number[][] = [
  [],
  [3],
  [1, -2.5, 7, -2.5],
  [-0, 0, 1e300, 5e-324, 1 / 3],
  [NaN, 2, NaN],
  [Infinity, -Infinity, 1, 1],
  [2, 1, 2, 1],
];
const INTEGER_LISTS: number[][] = [[], [5], [3, 1, 2, 1], [0, 7, -4, 7]];
const POINTS: number[][][] = [[], [[1, 2]], [[1, 2], [3, -4], [-0, 0.5]]];
const ONE = LISTS.map((l) => [l] as const);
const REALS = [0, -0, 1, 2, 2.5, -1, -1.5, 1e300, NaN, Infinity];

const FUNCTIONS_OF_LISTS: Program[] = [
  { name: 'Ordering', json: fn(['Ordering', 'L'], L), args: ONE },
  { name: 'Ordering of integers', json: fn(['Ordering', 'I'], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'IndexOf', json: fn(['IndexOf', 'L', 'x'], L, X), args: LISTS.flatMap((l) => [0, -0, 2, -2.5, NaN, Infinity, 1].map((x) => [l, x])) },
  { name: 'IndexOf in integers', json: fn(['IndexOf', 'I', 'k'], I, K), args: INTEGER_LISTS.flatMap((l) => [7, 1, 9].map((k) => [l, k])) },
  { name: 'Contains', json: fn(['Contains', 'L', 'x'], L, X), args: LISTS.flatMap((l) => [0, -0, 2, -2.5, NaN, -Infinity].map((x) => [l, x])) },
  { name: 'Contains as a condition', json: fn(['If', ['Contains', 'L', 'x'], 1, 0], L, X), args: LISTS.flatMap((l) => [0, 2].map((x) => [l, x])) },
  { name: 'Unique', json: fn(['Unique', 'L'], L), args: ONE },
  { name: 'Unique of integers', json: fn(['Unique', 'I'], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'Second and Third', json: fn(['List', ['Second', 'L'], ['Third', 'L']], L), args: ONE },
  { name: 'Second of a tuple', json: fn(['Second', 'P'], P), args: [[[1, 2]], [[-0, NaN]]], tuples: [0] },
  { name: 'Second of a list of tuples', json: fn(['At', ['Second', 'LP'], 2], LP), args: POINTS.map((p) => [p]), existingOnly: true },
  { name: 'Most', json: fn(['Most', 'L'], L), args: ONE },
  { name: 'IsEmpty', json: fn(['If', ['IsEmpty', 'L'], 1, 2], L), args: ONE },
  { name: 'IsEmpty of a filter', json: fn(['IsEmpty', ['Filter', 'L', lambda(['Less', 't', 2], 't')]], L), args: ONE },
  { name: 'Append', json: fn(['Append', 'L', 'x'], L, X), args: LISTS.map((l) => [l, -0]) },
  { name: 'Append to a list of integers', json: fn(['Append', 'I', 'k'], I, K), args: INTEGER_LISTS.map((l) => [l, 3]) },
  { name: 'Append in a loop', json: fn(['Block', ['Declare', 'A', "'list<real>'", 'L'], ['Loop', ['Assign', 'A', ['Append', 'A', 'k']], ['Element', 'k', ['Range', 1, 'n']]], 'A'], L, N), args: LISTS.slice(0, 4).flatMap((l) => [0, 3].map((n) => [l, n])) },
  { name: 'Repeat', json: fn(['Repeat', 'x', 'n'], X, N), args: REALS.flatMap((x) => [0, 1, 3, -2].map((n) => [x, n])) },
  { name: 'Repeat of an integer', json: fn(['Repeat', 'k', 'n'], K, N), args: [[2, 3], [-0, 2], [5, 0]] },
  { name: 'Linspace of literal bounds', json: fn(['Linspace', 0, 1, 'n'], N), args: [0, 1, 2, 5, -3].map((n) => [n]) },
  { name: 'Linspace of three literals', json: fn(['Add', ['Linspace', -2, 3, 6], 'x'], X), args: [[0], [0.5]] },
  { name: 'Linspace with the default count', json: fn(['Sum', ['Linspace', 0, 1]]), args: [[]] },
  { name: 'Slice', json: fn(['Slice', 'L', 'n', 'k'], L, N, K), args: LISTS.flatMap((l) => [[1, 2], [2, 9], [0, 2], [-2, -1], [-9, 2], [3, 1], [5, 6]].map(([n, k]) => [l, n, k])) },
  { name: 'Slice with real bounds', json: fn(['Slice', 'L', 'x', 'y'], L, X, Y), args: [[[1, 2, 3, 4], 1.5, 2.5], [[1, 2, 3, 4], -1.5, 9], [[1, 2, 3, 4], NaN, 2]] },
  { name: 'PopulationVariance', json: fn(['PopulationVariance', 'L'], L), args: ONE },
  { name: 'StandardDeviation', json: fn(['StandardDeviation', 'L'], L), args: ONE },
  { name: 'PopulationStandardDeviation', json: fn(['PopulationStandardDeviation', 'L'], L), args: ONE },
  { name: 'Skewness', json: fn(['Skewness', 'L'], L), args: ONE },
  { name: 'Kurtosis', json: fn(['Kurtosis', 'L'], L), args: ONE },
  { name: 'Mode', json: fn(['Mode', 'L'], L), args: ONE },
  { name: 'InterquartileRange', json: fn(['InterquartileRange', 'L'], L), args: ONE },
  { name: 'the statistics of a tuple', json: fn(['Add', ['StandardDeviation', 'P'], ['Skewness', 'P']], P), args: [[[1, 2]], [[-0, 4]]], tuples: [0] },
  { name: 'Covariance', json: fn(['Covariance', 'L', 'M'], L, M), args: [[[1, 2, 4], [1, 0, 2]], [[], []], [[1], [2]], [[1, 2], [3]]] },
  { name: 'Correlation', json: fn(['Correlation', 'L', 'M'], L, M), args: [[[1, 2, 4], [1, 0, 2]], [[1, 1], [1, 2]], [[1, 2], [3]]] },
  { name: 'a statistic in an expression', json: fn(['Multiply', 'x', ['Add', ['PopulationVariance', 'L'], 1]], L, X), args: LISTS.map((l) => [l, 2]) },
];

const PREDICATE = lambda(['Less', 't', 2], 't');
const FUNCTION_OPERANDS: Program[] = [
  { name: 'CountIf', json: fn(['CountIf', 'L', PREDICATE], L), args: ONE },
  { name: 'Any', json: fn(['Any', 'L', PREDICATE], L), args: ONE },
  { name: 'All', json: fn(['All', 'L', PREDICATE], L), args: ONE },
  { name: 'Any with a parameter of the root', json: fn(['Any', 'L', lambda(['Less', 'x', 't'], 't')], L, X), args: LISTS.map((l) => [l, 1.5]) },
  { name: 'All of integers', json: fn(['All', 'I', lambda(['Less', 0, 't'], 't')], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'Any and All as conditions', json: fn(['If', ['And', ['Any', 'L', PREDICATE], ['Not', ['All', 'L', PREDICATE]]], 1, 0], L), args: ONE },
  { name: 'Find', json: fn(['Find', 'L', PREDICATE], L), args: ONE },
  { name: 'Find of integers', json: fn(['Find', 'I', lambda(['Less', 1, 't'], 't')], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'IndexWhere', json: fn(['IndexWhere', 'L', PREDICATE], L), args: ONE },
  { name: 'Position', json: fn(['Position', 'L', PREDICATE], L), args: ONE },
  { name: 'TakeWhile', json: fn(['TakeWhile', 'L', PREDICATE], L), args: ONE },
  { name: 'DropWhile', json: fn(['DropWhile', 'L', PREDICATE], L), args: ONE },
  { name: 'TakeWhile of integers', json: fn(['TakeWhile', 'I', lambda(['Less', 't', 3], 't')], I), args: INTEGER_LISTS.map((l) => [l]) },
  { name: 'Find in a Range', json: fn(['Find', ['Range', 1, 'n'], lambda(['Less', 5, ['Multiply', 't', 't']], 't')], N), args: [[0], [1], [3], [-2]] },
  { name: 'Sum of a TakeWhile', json: fn(['Sum', ['TakeWhile', 'L', lambda(['Less', 0, 't'], 't')]], L), args: ONE },
  { name: 'Tabulate', json: fn(['Tabulate', lambda(['Multiply', 'i', 'x'], 'i'), 'n'], X, N), args: [[0.5, 3], [1, 0], [-0, 2], [1, -2]] },
  { name: 'Tabulate of a literal count', json: fn(['Tabulate', lambda(['Multiply', 'i', 2], 'i'), 4]), args: [[]] },
];

const INDEXES: Program[] = [
  { name: 'At with a real index', json: fn(['At', 'L', 'x'], L, X), args: LISTS.flatMap((l) => [1, 2, -1, 1.5, -1.5, 0.4, 0, -0, NaN, Infinity, 9].map((x) => [l, x])) },
  { name: 'At of integers with a real index', json: fn(['At', 'I', 'x'], I, X), args: INTEGER_LISTS.flatMap((l) => [1, 2.5].map((x) => [l, x])) },
  { name: 'At with a list index', json: fn(['At', 'L', 'I'], L, I), args: LISTS.flatMap((l) => [[], [1], [1, 3, -1], [0, 9, 2]].map((i) => [l, i])) },
  { name: 'At with a list literal index', json: fn(['At', 'L', ['List', 1, 'n']], L, N), args: LISTS.flatMap((l) => [2, -1, 7].map((n) => [l, n])) },
  { name: 'At with a Range index', json: fn(['At', 'L', ['Range', 'n', 'k']], L, N, K), args: LISTS.flatMap((l) => [[2, 3], [3, 2], [-2, -1], [0, 2], [3, 9]].map(([n, k]) => [l, n, k])) },
  { name: 'At with a Range of a step', json: fn(['At', 'L', ['Range', 1, 'n', 2]], L, N), args: LISTS.flatMap((l) => [0, 4].map((n) => [l, n])) },
  { name: 'Sum of a gather', json: fn(['Sum', ['At', 'L', ['Range', 'n', 'k']]], L, N, K), args: LISTS.flatMap((l) => [[2, 3], [3, 9], [1, 1]].map(([n, k]) => [l, n, k])) },
  { name: 'Product of a gather', json: fn(['Product', ['At', 'L', ['List', 'n', 'k']]], L, N, K), args: LISTS.flatMap((l) => [[2, 3], [3, 9]].map(([n, k]) => [l, n, k])) },
  { name: 'Max and Min of a gather', json: fn(['List', ['Max', ['At', 'L', ['Range', 'n', 'k']]], ['Min', ['At', 'L', ['Range', 'n', 'k']]]], L, N, K), args: LISTS.flatMap((l) => [[2, 3], [3, 9]].map(([n, k]) => [l, n, k])) },
  { name: 'Mean and Length of a gather', json: fn(['List', ['Mean', ['At', 'L', ['Range', 'n', 'k']]], ['Length', ['At', 'L', ['Range', 'n', 'k']]]], L, N, K), args: LISTS.flatMap((l) => [[2, 3], [3, 9]].map(([n, k]) => [l, n, k])) },
  { name: 'Sum of a gather of a vector of numbers', json: fn(['Sum', ['At', 'V', ['Range', 'n', 'k']]], ['V', 'vector<5>'], N, K), args: [[[1, 2, 3, 4, 5], 2, 3], [[1, 2, 3, 4, 5], 4, 9], [[1, -0, 3, NaN, 5], 1, 3]] },
  { name: 'Take with a real count', json: fn(['Take', 'L', 'x'], L, X), args: LISTS.flatMap((l) => [0, 1, 2.5, -1.5, -2.5, 0.4, 9, NaN].map((x) => [l, x])), existingOnly: true },
  { name: 'Drop with a real count', json: fn(['Drop', 'L', 'x'], L, X), args: LISTS.flatMap((l) => [0, 1, 2.5, -1.5, -2.5, 0.4, 9, NaN].map((x) => [l, x])), existingOnly: true },
  { name: 'Take with a real literal count', json: fn(['List', ['Take', 'L', 2.5], ['Drop', 'L', -1.5]], L), args: ONE, existingOnly: true },
  { name: 'Take of a list of tuples with a real count', json: fn(['Take', 'LP', 'x'], LP, X), args: POINTS.flatMap((p) => [1.5, -0.5].map((x) => [p, x])), existingOnly: true },
];

describe.each([
  ['functions of lists', FUNCTIONS_OF_LISTS],
  ['heads with a function operand', FUNCTION_OPERANDS],
  ['index operands that are not one integer', INDEXES],
] as const)('%s', (_label, programs) => {
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, program) =>
    check(program)
  );
});

describe('the declines that stay', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('hf', '(real) -> real');
  const cases: [string, MathJsonExpression, RegExp, Record<string, unknown>][] = [
    ['Repeat with a real count (the existing code throws for a fraction)', fn(['Repeat', 'x', 'y'], X, Y), /Repeat with y of the type `real`/, {}],
    ['Linspace with a bound that is not a finite literal', fn(['Linspace', 0, 'x', 'n'], X, N), /Linspace with a bound that is not a finite number literal/, {}],
    ['Tabulate with a real count', fn(['Tabulate', lambda(['Multiply', 'i', 2], 'i'), 'x'], X), /Tabulate with x of the type `real`/, {}],
    ['Tabulate of two dimensions', fn(['Tabulate', lambda(['Add', 'i', 'j'], 'i', 'j'), 2, 3]), /Tabulate/, {}],
    ['Find of a list of tuples', fn(['Find', 'LP', lambda(['Less', ['At', 't', 1], 2], 't')], LP), /Find of "LP"/, {}],
    ['Contains of a list of tuples', fn(['Contains', 'LP', 'P'], LP, P), /Contains of "LP"/, {}],
    ['At of a list of tuples with a list index', fn(['At', 'LP', ['List', 1, 2]], LP), /At with an index of the type `list<integer>`/, {}],
    ['At with a complex index', fn(['At', 'L', ['Complex', 1, 1]], L), /At with an index of the type `complex`/, {}],
    ['a predicate that calls the host', fn(['Any', 'L', lambda(['Less', ['hf', 't'], 2], 't')], L), /Any/, { functions: { hf: (t: number) => t } }],
  ];
  test.each(cases.map((c) => [c[0], c] as const))('%s', (_name, [, json, message, options]) => {
    const expr = ce.box(json);
    expect(() => compile(expr, { ...PROFILE, ...options } as never)).toThrow(
      message
    );
  });
});

describe('a list result is a new array', () => {
  // The host writes into the result of each head with a list result: the
  // input is unchanged, and a second call gives the value again.
  const programs: [string, MathJsonExpression][] = [
    ['Ordering', fn(['Ordering', 'L'], L)],
    ['Unique', fn(['Unique', 'L'], L)],
    ['Repeat', fn(['Repeat', 'x', 'n'], X, N)],
    ['Linspace', fn(['Linspace', 0, 1, 'n'], N)],
    ['Slice', fn(['Slice', 'L', 1, -1], L)],
    ['a gather', fn(['At', 'L', ['Range', 1, -1]], L)],
    ['Most', fn(['Most', 'L'], L)],
    ['Append', fn(['Append', 'L', 'x'], L, X)],
    ['Position', fn(['Position', 'L', PREDICATE], L)],
    ['TakeWhile', fn(['TakeWhile', 'L', lambda(['Less', 't', 100], 't')], L)],
    ['DropWhile', fn(['DropWhile', 'L', lambda(['Less', 't', -100], 't')], L)],
    ['Tabulate', fn(['Tabulate', lambda(['Multiply', 'i', 'x'], 'i'), 'n'], X, N)],
    ['Take with a real count', fn(['Take', 'L', 'x'], L, X)],
  ];
  test.each(programs)('%s', (_name, json) => {
    const ce = new ComputeEngine();
    const result = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>;
    const parameters = (json as MathJsonExpression[]).slice(2) as MathJsonExpression[];
    const args = () =>
      parameters.map((p) => {
        const type = (p as string[])[2];
        return type.includes('list') ? [1, 2, 3] : type.includes('integer') ? 3 : 9;
      });
    const inputs = args();
    const first = run(result, inputs) as number[];
    const value = structuredClone(first);
    expect(Array.isArray(first)).toBe(true);
    first.push(42);
    if (first.length > 1) first[0] = -42;
    expect(inputs).toEqual(args());
    expect(same(run(result, inputs), value)).toBe(true);
  });

  // `ReplaceAt` on the result in a loop writes in place, with no copy, for
  // a result that is a new array; for an input it copies once first.
  const loopOver = (list: MathJsonExpression): MathJsonExpression =>
    fn(
      ['Block',
        ['Declare', 'A', "'list<real>'", list],
        ['Loop', ['Assign', 'A', ['ReplaceAt', 'A', 'k', ['Multiply', 2, ['At', 'A', 'k']]]], ['Element', 'k', ['Range', 1, ['Length', 'A']]]],
        'A'],
      L
    );
  test.each([
    ['Unique', ['Unique', 'L'], true],
    ['Ordering', ['Ordering', 'L'], true],
    ['Slice', ['Slice', 'L', 1, -1], true],
    ['a gather', ['At', 'L', ['Range', 1, -1]], true],
    ['the input', 'L', false],
  ] as [string, MathJsonExpression, boolean][])('ReplaceAt in a loop over %s', (_name, list, fresh) => {
    const ce = new ComputeEngine();
    const json = loopOver(list);
    const result = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(ce.expr(json), EXISTING) as CompilationResult<'javascript'>;
    expect(result.code.includes('replaceAtInPlace')).toBe(true);
    // The copy before the loop: `.slice()` of the input.
    expect(result.code.includes('.slice()')).toBe(!fresh);
    // A list of one element or more: `Range(1, 0)` has two elements.
    for (const l of LISTS.filter((l) => l.length > 0)) {
      const input = structuredClone(l);
      expect(same(run(result, [input]), run(existing, [structuredClone(l)]))).toBe(true);
      expect(same(input, l)).toBe(true);
    }
  });
});

describe('Second and Third of a list of lists are row reads', () => {
  // As `At(M, 2)` and `At(M, 3)`: `undefined` out of range, read with the
  // guards of the existing emitter by `Length` and `At`, and placed as it is
  // in a list; another use declines.
  const MATS: number[][][] = [[], [[1, 2]], [[1], [2, 3]], [[1], [2, -0], [4, 5, 6]]];
  const RM: [string, string] = ['M', 'list<list<real>>'];
  test.each([
    ['Length', (r: MathJsonExpression) => ['Length', r]],
    ['At', (r: MathJsonExpression) => ['At', r, 1]],
    ['a list literal', (r: MathJsonExpression) => ['List', r]],
  ] as [string, (r: MathJsonExpression) => MathJsonExpression][])('%s of a row read', (_name, form) => {
    const ce = new ComputeEngine();
    for (const [head, i] of [['Second', 2], ['Third', 3]] as const) {
      const json = fn(form([head, 'M']), RM);
      const reference = fn(form(['At', 'M', i]), RM);
      const result = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>;
      const existing = compile(ce.expr(json), EXISTING) as CompilationResult<'javascript'>;
      const at = compile(ce.expr(reference), PROFILE as never) as CompilationResult<'javascript'>;
      for (const m of MATS) {
        const value = run(result, [structuredClone(m)]);
        expect(same(value, run(existing, [structuredClone(m)]))).toBe(true);
        expect(same(value, run(at, [structuredClone(m)]))).toBe(true);
      }
    }
  });
  test.each(['Second', 'Third'])('Reverse of %s of a list of lists declines', (head) => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(ce.expr(fn(['Reverse', [head, 'M']], RM)), PROFILE as never)
    ).toThrow(new RegExp(`the row read ${head}\\(M\\), which is undefined for an index out of range`));
  });
});

describe('a list of a count of 2^32 elements or more throws before any element', () => {
  // `Array.from({ length: n })` of the existing code throws a `RangeError`
  // for n of 2^32 or more, before it calls the function of `Tabulate`; the
  // route tests the count before its loop.
  const HUGE = 2 ** 32;
  test.each([
    ['Tabulate', fn(['Tabulate', lambda(['Multiply', 'i', 2], 'i'), 'n'], N)],
    ['Repeat', fn(['Repeat', 1.5, 'n'], N)],
    ['Linspace', fn(['Linspace', 0, 1, 'n'], N)],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => {
    const ce = new ComputeEngine();
    const result = compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(ce.expr(json), EXISTING) as CompilationResult<'javascript'>;
    expect(() => run(existing, [HUGE])).toThrow(RangeError);
    expect(() => run(result, [HUGE])).toThrow(RangeError);
    expect(same(run(result, [3]), run(existing, [3]))).toBe(true);
  });
  test('the test of the count of Tabulate precedes its loop', () => {
    const ce = new ComputeEngine();
    const json = fn(['Tabulate', lambda(['Multiply', 'i', 2], 'i'), 'n'], N);
    const code = (compile(ce.expr(json), PROFILE as never) as CompilationResult<'javascript'>).code;
    const check = code.indexOf('> 4294967294) throw new RangeError');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(code.indexOf('for ('));
  });
});

describe('First, Second and Third of an empty list literal', () => {
  // The existing emitter writes `_SYS.nth([], i)`, `undefined`, where a
  // numeric read of the route gives `NaN`; `Last([])` is `NaN` on both.
  test.each(['First', 'Second', 'Third'])('%s([]) declines', (head) => {
    const ce = new ComputeEngine();
    const expr = ce.box([head, ['List']] as MathJsonExpression);
    expect(() =>
      compile(expr, { profile: 'numeric-kernel', fallback: false })
    ).toThrow(/whose elements have the type never/);
    const existing = compile(expr, { cse: false, constantFold: false });
    expect(existing.run!({})).toBeUndefined();
  });

  test('Last([]) is NaN on both compilers', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Last', ['List']] as MathJsonExpression);
    const profile = compile(expr, { profile: 'numeric-kernel', fallback: false });
    const existing = compile(expr, { cse: false, constantFold: false });
    expect(profile.run!({})).toBeNaN();
    expect(existing.run!({})).toBeNaN();
  });
});
