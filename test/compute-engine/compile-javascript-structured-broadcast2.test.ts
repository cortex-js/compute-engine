import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slices 3 to 5 of docs/plans/2026-11-12-structured-broadcast-over-lists.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): a user function with real or integer parameters applied to
// each element of its list arguments (slice 3), `Sum` and `Product` whose
// body is a list (slice 4), `Max` and `Min` of several operands with a
// list among them, and `Equal` and `NotEqual` of two lists (slice 5).
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) at every position, and the same shape; a call that throws
// must throw the same message. The inputs must be the same after the call
// as a deep copy taken before it, and a second call with the same inputs
// gives the same value. The value also agrees with the interpreter within
// 1e-12 relative, for finite arguments of moderate size (the caveats of
// compiled code: `NaN` where the interpreter has no real number). In the
// `complex` mode the profile gives the same value or declines.

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

const L: [string, string] = ['L', 'list<real>'];
const M: [string, string] = ['M', 'list<real>'];
const I: [string, string] = ['I', 'list<integer>'];
const V: [string, string] = ['V', 'vector<3>'];
const W: [string, string] = ['W', 'vector<3>'];
const A: [string, string] = ['A', 'list<list<real>>'];
const X: [string, string] = ['x', 'real'];
const K: [string, string] = ['k', 'integer'];
const N: [string, string] = ['n', 'integer'];
const P: [string, string] = ['p', 'integer<1..>'];

const lim = (
  index: string,
  lower: MathJsonExpression,
  upper: MathJsonExpression
): MathJsonExpression => ['Limits', index, lower, upper];

/** The helpers of the programs, each declared with its signature (none
 *  for `u` and `tp`, whose signature the engine infers) and assigned a
 *  function literal of the raw form. */
const HELPERS: Record<string, [string | undefined, MathJsonExpression]> = {
  f: ['(real) -> real', ['Function', ['Power', 't', 3], 't']],
  ex: ['(real) -> real', ['Function', ['Exp', 't'], 't']],
  q: ['(real) -> real', ['Function', ['Divide', 't', 3], 't']],
  s: ['(real) -> real', ['Function', ['Add', ['Sin', 't'], 1], 't']],
  u: [undefined, ['Function', ['Add', ['Square', 't'], 1], 't']],
  tp: [undefined, ['Function', ['Multiply', 't', 2], typed('t', 'real')]],
  g: ['(real, real) -> real', ['Function', ['Add', 'a', ['Multiply', 2, 'b']], 'a', 'b']],
  h: [
    '(real, real, real) -> real',
    ['Function', ['Subtract', ['Multiply', 'a', 'b'], 'c'], 'a', 'b', 'c'],
  ],
  ki: ['(integer) -> integer', ['Function', ['Multiply', 't', 2], 't']],
  md: ['(real) -> real', ['Function', ['Mod', 't', 3], 't']],
  r: ['(real) -> real', ['Function', ['Add', 't', ['Random']], 't']],
  // A parameter named like an input of the program, and one named like a
  // library constant.
  px: ['(real) -> real', ['Function', ['Add', 'x', 1], 'x']],
  ee: ['(real) -> real', ['Function', ['Add', 'ExponentialE', 1], 'ExponentialE']],
  bo: ['(real) -> boolean', ['Function', ['Less', 't', 0], 't']],
  li: ['(real) -> list<real>', ['Function', ['List', 't', 1], 't']],
  // A helper whose value is a captured list: the rows of the value are one
  // array, as `_SYS.mapFn` gives them.
  lc: ['(real) -> list<real>', ['Function', 'CL', 't']],
  mm: [
    '(real) -> list<list<real>>',
    ['Function', ['List', ['List', 't', 1], ['List', 2, 't']], 't'],
  ],
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('CL', 'list<real>');
  ce.assign('CL', ce.box(['List', 2, -0.5]));
  for (const [name, [signature, literal]] of Object.entries(HELPERS)) {
    if (signature !== undefined) ce.declare(name, signature);
    ce.assign(name, ce.box(literal));
  }
  return ce;
}

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
  if (isThrown(a) && isThrown(b)) return a.thrown === b.thrown;
  return a === b;
}

function isThrown(a: unknown): a is { thrown: string } {
  return typeof a === 'object' && a !== null && 'thrown' in a;
}

/** Within 1e-12 relative of the interpreter, element by element; `NaN`
 *  where the interpreter gives no real number. */
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
    return Number.isNaN(value) || value === expected;
  return (
    value === expected ||
    Math.abs(value - expected) <=
      1e-12 * Math.max(1, Math.abs(value), Math.abs(expected))
  );
}

/** Whether the interpreter is compared on `args`: every number finite, not
 *  `-0`, at most 1e3 in magnitude. */
function ordinary(args: readonly Arg[]): boolean {
  const ok = (a: Arg): boolean =>
    Array.isArray(a)
      ? a.every((e) => ok(e as Arg))
      : Number.isFinite(a) && !Object.is(a, -0) && Math.abs(a) <= 1e3;
  return args.every(ok);
}

function boxArg(a: Arg): MathJsonExpression {
  if (!Array.isArray(a)) return Object.is(a, -0) ? { num: '-0' } : a;
  return ['List', ...a.map((e) => boxArg(e as Arg))] as MathJsonExpression;
}

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
  args: readonly Arg[]
): unknown {
  const evaluated = ce
    .expr(['Apply', json, ...args.map(boxArg)] as MathJsonExpression)
    .evaluate();
  return valueOf(evaluated.N());
}

function outcome(
  result: CompilationResult<'javascript'>,
  args: readonly Arg[]
): unknown {
  try {
    return run(result, args);
  } catch (error) {
    return { thrown: String((error as Error).message) };
  }
}

/** The profile on `expr` in `mode`: the result, or `declined` (never an
 *  internal error). */
function profileOf(
  expr: Expression,
  mode: Mode
): CompilationResult<'javascript'> | 'declined' {
  try {
    return compile(expr, { ...PROFILE, mode } as never) as CompilationResult<'javascript'>;
  } catch (error) {
    expect([
      String((error as Error).message).slice(0, 300),
      (error as { diagnostic?: { code?: string } }).diagnostic?.code,
    ]).toEqual([expect.anything(), 'outside-profile']);
    return 'declined';
  }
}

type Program = {
  readonly name: string;
  readonly json: MathJsonExpression;
  readonly args: readonly (readonly Arg[])[];
  /** No comparison with the interpreter. */
  readonly existingOnly?: boolean;
};

/** Each program with the profile and the existing compiler, on each list of
 *  arguments: admitted in the `strict` mode, equal or declined in the
 *  `complex` mode. */
function check(program: Program): void {
  for (const mode of MODES) {
    const ce = engine();
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
      const value = outcome(result, inputs);
      expect([mode, args, same(inputs, args)]).toEqual([mode, args, true]);
      expect([mode, args, same(outcome(result, inputs), value)]).toEqual([
        mode,
        args,
        true,
      ]);
      const reference = outcome(existing, args.map((a) => structuredClone(a)));
      expect([mode, args, value, same(value, reference)]).toEqual([
        mode,
        args,
        value,
        true,
      ]);
      if (isThrown(value) || program.existingOnly || !ordinary(args)) continue;
      const expected = interpret(ce, program.json, args);
      if (expected === undefined) continue;
      expect([mode, args, value, close(value, expected)]).toEqual([
        mode,
        args,
        value,
        true,
      ]);
    }
  }
}

/** The program `json` declines with a message that matches `message`; the
 *  existing compiler compiles it. */
function declines(json: MathJsonExpression, message: RegExp): void {
  const ce = engine();
  const expr = ce.expr(json);
  expect(() => compile(expr, EXISTING)).not.toThrow();
  let error: unknown;
  try {
    compile(expr, PROFILE as never);
  } catch (e) {
    error = e;
  }
  expect(
    (error as { diagnostic?: { code?: string } } | undefined)?.diagnostic?.code
  ).toBe('outside-profile');
  expect(String((error as Error).message)).toMatch(message);
}

const LISTS: number[][] = [
  [],
  [3],
  [-0, 0, NaN, Infinity, -Infinity],
  [-2.5, -1, 0.5, 1, 2, 3, -8, 10.5],
  [1e300, 5e-324, 1 / 3, -1e-300, 0.1, 7],
];
const INTEGER_LISTS: number[][] = [[], [5], [3, -1, 0, -0, 7, 12]];
const VECTORS: number[][] = [
  [1, -2, 0.5],
  [-0, NaN, Infinity],
  [3, 1e300, -8],
];
const ROWS: number[][][] = [
  [],
  [[]],
  [[1.5]],
  [[1, -0, NaN], [], [Infinity, 2.5]],
  [[-3, 4], [0.25, -1e300]],
];
const SCALARS = [2, -0, 0.5, -3, NaN];

const one = (lists: readonly Arg[]) => lists.map((l) => [l] as const);
const withScalars = (lists: readonly Arg[]) =>
  lists.flatMap((l) => SCALARS.map((x) => [l, x] as const));
/** Two lists of one length: each list with itself and with its reverse. */
const pairs = (lists: readonly number[][]) =>
  lists.flatMap((l) => [
    [l, l],
    [l, [...l].reverse()],
  ]);

describe('slice 3a: a helper with one real parameter applied to each element', () => {
  test.each<[string, MathJsonExpression]>([
    ['f(L), t^3', ['f', 'L']],
    ['ex(L), Exp(t)', ['ex', 'L']],
    ['q(L), t/3', ['q', 'L']],
    ['s(L), Sin(t) + 1', ['s', 'L']],
    ['u(L), an inferred signature', ['u', 'L']],
    ['tp(L), an annotated parameter', ['tp', 'L']],
    ['f(f(L))', ['f', ['f', 'L']]],
    ['Sum(f(L))', ['Sum', ['f', 'L']]],
    ['At(f(L), 1) + f(x): a list site and a scalar site', ['Add', ['At', ['f', 'L'], 1], ['f', 'x']]],
    ['f(x) + At(f(L), 1)', ['Add', ['f', 'x'], ['At', ['f', 'L'], 1]]],
    ['f(Sqrt(L))', ['f', ['Sqrt', 'L']]],
    ['px(L): a parameter named like an input', ['px', 'L']],
    ['ee(L): a parameter named like a library constant', ['ee', 'L']],
  ])('%s', (name, body) =>
    check({ name, json: fn(body, L, X), args: withScalars(LISTS) })
  );
  test('f(I), a list of integers', () =>
    check({ name: 'f(I)', json: fn(['f', 'I'], I), args: one(INTEGER_LISTS) })
  );
  test('ki(I), an integer parameter', () =>
    check({ name: 'ki(I)', json: fn(['ki', 'I'], I), args: one(INTEGER_LISTS) })
  );
  test('f of a list literal and of a range', () => {
    check({ name: 'f([1, x, 3])', json: fn(['f', ['List', 1, 'x', 3]], X), args: SCALARS.map((x) => [x]) });
    check({ name: 'f(Range(1, k))', json: fn(['f', ['Range', 1, 'k']], K), args: [[0], [1], [4]] });
  });
  test('md(L): a helper that throws throws at the same element', () =>
    check({
      name: 'md(L)',
      json: fn(['md', 'L'], L),
      args: [...one(LISTS), [[1, 2, 1e300, Infinity]]],
    })
  );
});

describe('slice 3b: several parameters, local functions, Apply, rank 2', () => {
  test.each<[string, MathJsonExpression, readonly (readonly Arg[])[]]>([
    ['g(L, x)', fn(['g', 'L', 'x'], L, X), withScalars(LISTS)],
    ['g(x, L)', fn(['g', 'x', 'L'], L, X), withScalars(LISTS)],
    ['g(L, L)', fn(['g', 'L', 'L'], L), one(LISTS)],
    ['g(L, Sqrt(L))', fn(['g', 'L', ['Sqrt', 'L']], L), one(LISTS)],
    ['h(L, x, L)', fn(['h', 'L', 'x', 'L'], L, X), withScalars(LISTS)],
    ['f(L) + L', fn(['Add', ['f', 'L'], 'L'], L), one(LISTS)],
    ['g(V, W) of one stated width', fn(['g', 'V', 'W'], V, W), VECTORS.flatMap((v) => VECTORS.map((w) => [v, w]))],
    ['Apply(f, L)', fn(['Apply', 'f', 'L'], L), one(LISTS)],
    [
      'a local function',
      fn(['Block', ['Declare', 'lf', "'function'", ['Function', ['Add', 's', 1], 's']], ['lf', 'L']], L),
      one(LISTS),
    ],
    [
      'a local function of DefineFunction',
      fn(['Block', ['DefineFunction', 'lf', ['Function', ['Multiply', 's', 2], 's']], ['lf', 'L']], L),
      one(LISTS),
    ],
    [
      'a local function that reads a local',
      fn(
        [
          'Block',
          ['Declare', 'a', "'real'", ['Multiply', 2, 'x']],
          ['Declare', 'lf', "'function'", ['Function', ['Add', 's', 'a'], 's']],
          ['lf', 'L'],
        ],
        L,
        X
      ),
      withScalars(LISTS),
    ],
    ['f(A), a list of lists', fn(['f', 'A'], A), one(ROWS)],
    ['g(A, x), a list of lists and a real', fn(['g', 'A', 'x'], A, X), withScalars(ROWS)],
    ['li(L): a helper whose value is a list', fn(['li', 'L'], L), one(LISTS)],
    ['lc(L): a captured list as the value', fn(['lc', 'L'], L), one(LISTS)],
    ['mm(L): a list of lists as the value', fn(['mm', 'L'], L), one(LISTS)],
    ['At(At(mm(L), 1), 2)', fn(['At', ['At', ['mm', 'L'], 1], 2], L), one(LISTS)],
    ['li(L) + 1', fn(['Add', ['li', 'L'], 1], L), one(LISTS)],
    ['li(A)', fn(['li', 'A'], A), one(ROWS)],
  ])('%s', (name, json, args) => check({ name, json, args }));

  test('the declines that stay', () => {
    declines(
      fn(['g', 'L', 'M'], L, M),
      /applies `g` to each element of the lists `L` and `M`, whose lengths are not equal by construction \(declare one width/
    );
    declines(fn(['g', 'A', 'A'], A), /applies `g` to each element of the lists `A` and `A`/);
    declines(fn(['g', 'A', 'L'], A, L), /whose lengths are not equal by construction/);
    declines(fn(['ki', 'L'], L), /applies `ki` to each element of `L`, and the parameter `t` has the type `integer`/);
    declines(fn(['bo', 'L'], L), /the value of `bo` has the type `boolean`, not a real, an integer or a list of them/);
  });

  test('a list bound whole by the interpreter is not mapped', () => {
    // `R(V, t) := [Σ V·[cos t, -sin t], Σ V·[sin t, cos t]]` declared
    // `function`: the engine infers `collection<any> | value` for `V`, so
    // the interpreter binds a list argument whole (the program of
    // ce-564-function-literal-list-and-recursive-call.test.ts), and the
    // existing compiler declines `R([1, 2], phi)`.
    const ce = engine();
    ce.declare('R', 'function');
    ce.assign(
      'R',
      ce.box([
        'Function',
        [
          'Block',
          [
            'List',
            ['Sum', ['Multiply', 'V', ['List', ['Cos', 't'], ['Negate', ['Sin', 't']]]]],
            ['Sum', ['Multiply', 'V', ['List', ['Sin', 't'], ['Cos', 't']]]],
          ],
        ],
        'V',
        't',
      ])
    );
    expect(() =>
      compile(ce.box(['R', ['List', 1, 2], 'phi']), PROFILE as never)
    ).toThrow(/The argument `\[1,2\]` of `R` has the type `list<integer>`, and the parameter `V` has the type `real`/);
  });

  test('a list on the complex lane at a real parameter declines', () => {
    const ce = engine();
    const expr = ce.expr(
      fn(['f', ['Comprehension', ['Sqrt', 'j'], ['Element', 'j', ['Range', 1, 'k']]]], K)
    );
    expect(() => compile(expr, PROFILE as never)).toThrow(
      /its type list<complex> is not real/
    );
  });
});

describe('slice 3: the count and the order of the calls', () => {
  const log: string[] = [];
  const host = globalThis as unknown as Record<string, unknown>;
  host.__bc2Rec = (t: number) => {
    log.push(`R(${t})`);
    return 10 * t;
  };
  const options = { functions: { w: '__bc2Rec' } };
  test.each<[string, MathJsonExpression, string[]]>([
    ['hc(L)', ['hc', 'L'], ['R(1)', 'R(2)', 'R(0)']],
    ['hc(L) + w(x): the list first, then the scalar', ['Add', ['hc', 'L'], ['w', 'x']], ['R(1)', 'R(2)', 'R(0)', 'R(5)']],
    ['hc(hc(L))', ['hc', ['hc', 'L']], ['R(1)', 'R(2)', 'R(0)', 'R(11)', 'R(21)', 'R(1)']],
    ['g2(L, w(x)): the scalar argument once', ['g2', 'L', ['w', 'x']], ['R(5)', 'R(1)', 'R(2)', 'R(0)']],
    ['Sum(hc(L i), i = 1..2)', ['Sum', ['hc', ['Multiply', 'L', 'i']], lim('i', 1, 2)], ['R(1)', 'R(2)', 'R(0)', 'R(2)', 'R(4)', 'R(0)']],
    ['Max(hc(L), w(x))', ['Max', ['hc', 'L'], ['w', 'x']], ['R(1)', 'R(2)', 'R(0)', 'R(5)']],
    ['Equal(hc(L), hc(L))', ['Equal', ['hc', 'L'], ['hc', 'L']], ['R(1)', 'R(2)', 'R(0)', 'R(1)', 'R(2)', 'R(0)']],
  ])('%s', (_name, json, calls) => {
    const ce = engine();
    ce.declare('w', '(real) -> real');
    ce.declare('hc', '(real) -> real');
    ce.assign('hc', ce.box(['Function', ['Add', ['w', 't'], 1], 't']));
    ce.declare('g2', '(real, real) -> real');
    ce.assign('g2', ce.box(['Function', ['Add', ['w', 'a'], 'b'], 'a', 'b']));
    ce.declare('L', 'list<real>');
    ce.declare('x', 'real');
    const expr = ce.box(json);
    const vars = () => ({ L: [1, 2, -0], x: 0.5 });
    log.length = 0;
    const existing = compile(expr, { ...EXISTING, ...options } as never) as any;
    const reference = existing.run(vars());
    const expected = [...log];
    log.length = 0;
    const profile = compile(expr, { ...PROFILE, ...options } as never) as any;
    const value = profile.run(vars());
    expect(same(value, reference)).toBe(true);
    expect(log).toEqual(expected);
    expect(log).toEqual(calls.map((c) => (c === 'R(5)' ? 'R(0.5)' : c)));
  });

  test('a drawing helper draws once per element, in order', () => {
    const ce = engine();
    for (const json of [
      fn(['r', 'L'], L),
      fn(['Add', ['r', 'L'], ['Random']], L),
      fn(['Sum', ['r', ['Multiply', 'L', 'i']], lim('i', 1, 3)], L),
      fn(['Max', ['r', 'L'], ['Random']], L),
    ]) {
      const expr = ce.expr(json);
      const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
      for (const l of [[], [1, 4, 9]]) {
        const inFrame = (result: CompilationResult<'javascript'>) =>
          withRandomSeedFrame(ce, 7, () => {
            const value = run(result, [l]);
            return [value, ce._random()];
          });
        expect(same(inFrame(profile), inFrame(existing))).toBe(true);
      }
    }
  });
});

describe('slice 4: Sum and Product whose body is a list', () => {
  test.each<[string, MathJsonExpression, readonly (readonly Arg[])[]]>([
    ['Sum(L i, i = 1..3)', fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 1, 3)], L), one(LISTS)],
    ['Product(L + i, i = 1..3)', fn(['Product', ['Add', 'L', 'i'], lim('i', 1, 3)], L), one(LISTS)],
    ['Sum(L, i = 1..1): the first term as it is (-0 stays)', fn(['Sum', 'L', lim('i', 1, 1)], L), one(LISTS)],
    ['Sum(L i, i = 1..2)', fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 1, 2)], L), one(LISTS)],
    ['Sum(L i, i = 1..2.5): a bound floored', fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 1, 2.5)], L), one(LISTS)],
    ['Sum(I i, i = 0..3)', fn(['Sum', ['Multiply', 'I', 'i'], lim('i', 0, 3)], I), one(INTEGER_LISTS)],
    ['Sum(L i j, i = 1..2, j = 1..3)', fn(['Sum', ['Multiply', 'L', 'i', 'j'], lim('i', 1, 2), lim('j', 1, 3)], L), one(LISTS)],
    ['Sum(f(L) i, i = 1..2)', fn(['Sum', ['Multiply', ['f', 'L'], 'i'], lim('i', 1, 2)], L), one(LISTS)],
    ['Sum(x L + i, i = -1..2)', fn(['Sum', ['Add', ['Multiply', 'x', 'L'], 'i'], lim('i', -1, 2)], L, X), withScalars(LISTS)],
    ['Sum(V i, i = 1..0): an empty range of a stated width', fn(['Sum', ['Multiply', 'V', 'i'], lim('i', 1, 0)], V), one(VECTORS)],
    ['Product(V + i, i = 3..1)', fn(['Product', ['Add', 'V', 'i'], lim('i', 3, 1)], V), one(VECTORS)],
    ['Sum(V i, i = 1..4)', fn(['Sum', ['Multiply', 'V', 'i'], lim('i', 1, 4)], V), one(VECTORS)],
    ['Sum([i, 2i], i = 1..3)', fn(['Sum', ['List', 'i', ['Multiply', 2, 'i']], lim('i', 1, 3)], X), [[0]]],
    [
      'Sum of a comprehension over a stated range',
      fn(['Sum', ['Comprehension', ['Multiply', 'j', 'i'], ['Element', 'j', ['Range', 1, 3]]], lim('i', 1, 3)], X),
      [[0]],
    ],
    ['Sum(Mod(L, i), i = 1..2): a term that throws', fn(['Sum', ['Mod', 'L', 'i'], lim('i', 1, 2)], L), [...one(LISTS), [[1, 1e300]]]],
    ['Sum(md(L), i = 1..2)', fn(['Sum', ['md', 'L'], lim('i', 1, 2)], L), [...one(LISTS), [[1, 1e300]]]],
  ])('%s', (name, json, args) => check({ name, json, args }));

  test('a body that draws', () => {
    const ce = engine();
    const expr = ce.expr(fn(['Sum', ['Add', 'L', ['Random']], lim('i', 1, 3)], L));
    const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    for (const l of [[], [1, 4, 9]]) {
      const inFrame = (result: CompilationResult<'javascript'>) =>
        withRandomSeedFrame(ce, 3, () => [run(result, [l]), ce._random()]);
      expect(same(inFrame(profile), inFrame(existing))).toBe(true);
    }
  });

  test('the declines that stay', () => {
    const notLiteral = /the bound n is not a number literal, and the existing compiler gives the number NaN where a bound is not a safe integer/;
    declines(fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 1, 'n')], L, N), notLiteral);
    declines(fn(['Sum', ['Multiply', 'V', 'i'], lim('i', 1, 'n')], V, N), notLiteral);
    declines(fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 1, 'p')], L, P), /the bound p is not a number literal/);
    declines(
      fn(['Sum', ['Multiply', 'L', 'i'], lim('i', 3, 1)], L),
      /the range of Limits\(i, 3, 1\) is empty, and the existing compiler gives the number 0 for it \(declare the width of the body/
    );
    declines(
      fn(['Sum', ['Range', 1, 'i'], lim('i', 1, 3)], X),
      /the length of the body is not the same in every term by construction \(declare its width/
    );
    declines(
      fn(['Sum', ['Comprehension', 'j', ['Element', 'j', ['Range', 1, 'i']]], lim('i', 1, 3)], X),
      /the length of the body is not the same in every term/
    );
  });

  test('a list body that reads the host declines: each term reads it again', () => {
    const host = globalThis as unknown as Record<string, unknown>;
    let n = 0;
    host.__bc2Grow = () => ++n;
    const ce = engine();
    ce.declare('n', 'integer');
    // The length key of the comprehension is the text of its bounds, `1..n`,
    // and `n` is read from the host at each term.
    const expr = ce.box([
      'Sum',
      ['Comprehension', ['Multiply', 'j', 'i'], ['Element', 'j', ['Range', 1, 'n']]],
      lim('i', 1, 3),
    ]);
    const options = { vars: { n: '__bc2Grow()' } };
    expect(() => compile(expr, { ...EXISTING, ...options } as never)).not.toThrow();
    expect(() => compile(expr, { ...PROFILE, ...options } as never)).toThrow(
      /the body reads a value of the host, which can change between two terms/
    );
  });
});

describe('slice 5a: Max and Min with a list among several operands', () => {
  test.each<[string, MathJsonExpression, readonly (readonly Arg[])[]]>([
    ['Max(L, x)', fn(['Max', 'L', 'x'], L, X), withScalars(LISTS)],
    ['Max(x, L)', fn(['Max', 'x', 'L'], L, X), withScalars(LISTS)],
    ['Min(L, x)', fn(['Min', 'L', 'x'], L, X), withScalars(LISTS)],
    ['Max(L, M): lists only, NaN when empty', fn(['Max', 'L', 'M'], L, M), LISTS.flatMap((l) => LISTS.map((m) => [l, m]))],
    ['Min(L, M, x)', fn(['Min', 'L', 'M', 'x'], L, M, X), LISTS.flatMap((l) => SCALARS.map((x) => [l, [...l].reverse(), x]))],
    ['Max(I, k)', fn(['Max', 'I', 'k'], I, K), INTEGER_LISTS.map((l) => [l, 4])],
    ['Max(I, x)', fn(['Max', 'I', 'x'], I, X), INTEGER_LISTS.flatMap((l) => SCALARS.map((x) => [l, x]))],
    ['Max(A, x): the rows of a list of lists', fn(['Max', 'A', 'x'], A, X), withScalars(ROWS)],
    ['Min(x, A)', fn(['Min', 'x', 'A'], A, X), withScalars(ROWS)],
    ['Max(f(L), x)', fn(['Max', ['f', 'L'], 'x'], L, X), withScalars(LISTS)],
    ['Max(Sqrt(L), 2)', fn(['Max', ['Sqrt', 'L'], 2], L), one(LISTS)],
    ['Max(V, 1)', fn(['Max', 'V', 1], V), one(VECTORS)],
    ['Max([1, x], L)', fn(['Max', ['List', 1, 'x'], 'L'], L, X), withScalars(LISTS)],
    ['Max(L, Range(1, k))', fn(['Max', 'L', ['Range', 1, 'k']], L, K), LISTS.map((l) => [l, 3])],
    ['Max(L, x) + 1', fn(['Add', ['Max', 'L', 'x'], 1], L, X), withScalars(LISTS)],
  ])('%s', (name, json, args) => check({ name, json, args }));

  test('the declines that stay', () => {
    declines(fn(['Max', 'A', 'L'], A, L), /a list of lists beside another list declines/);
    declines(
      fn(['Max', 'L', ['Tuple', 'x', 1]], L, X),
      /Max with the list operand L and the operand \(x, 1\)|Max with the list operand L/
    );
  });
});

describe('slice 5b: Equal and NotEqual of two lists', () => {
  test.each<[string, MathJsonExpression, readonly (readonly Arg[])[]]>([
    ['Equal(L, M)', fn(['Equal', 'L', 'M'], L, M), [...pairs(LISTS), [[1], [1, 2]], [[], [0]], [[0], [-0]], [[NaN], [NaN]]]],
    ['NotEqual(L, M)', fn(['NotEqual', 'L', 'M'], L, M), [...pairs(LISTS), [[1], [1, 2]], [[0], [-0]], [[NaN], [NaN]]]],
    ['Equal(L, L)', fn(['Equal', 'L', 'L'], L), one(LISTS)],
    ['Equal(L, I)', fn(['Equal', 'L', 'I'], L, I), [[[1, 2], [1, 2]], [[1], [1, 2]], [[], []]]],
    ['Equal(L, [1, 2])', fn(['Equal', 'L', ['List', 1, 2]], L), [...one(LISTS), [[1, 2]]]],
    ['Equal(L, Sqrt(M))', fn(['Equal', 'L', ['Sqrt', 'M']], L, M), [[[1, 2], [1, 4]], [[1, 3], [1, 4]]]],
    ['If(L = M, 1, 2)', fn(['If', ['Equal', 'L', 'M'], 1, 2], L, M), pairs(LISTS)],
    ['Not(L = M)', fn(['Not', ['Equal', 'L', 'M']], L, M), pairs(LISTS)],
    ['Equal(f(L), L)', fn(['Equal', ['f', 'L'], 'L'], L), [...one(LISTS), [[1, -1, 0]]]],
  ])('%s', (name, json, args) => check({ name, json, args }));

  test('the declines that stay', () => {
    declines(fn(['Equal', 'A', 'A'], A), /Equal with the list operand A and another list or tuple is not in the profile/);
  });
});
