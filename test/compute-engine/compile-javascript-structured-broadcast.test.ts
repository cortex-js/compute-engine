import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import {
  COLLECTION_THROWS,
  FUNCTION_THROWS,
  lowerStructuredFragment,
  OPERATION_THROWS,
  preparedNodesOf,
} from '../../src/compute-engine/compilation/javascript-structured-lower';
import {
  JAVASCRIPT_BIGINT_POLICY,
  JAVASCRIPT_POLICY,
  representationOfKind,
  verifyJavaScriptProgram,
} from '../../src/compute-engine/compilation/javascript-structured-policy';
import {
  listType,
  type IROperation,
  type IRProgram,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import { withRandomSeedFrame } from '../../src/compute-engine/boxed-expression/utils';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Slices 1 and 2 of docs/plans/2026-11-12-structured-broadcast-over-lists.md
// on the structured route of the JavaScript compiler (the `numeric-kernel`
// profile): a scalar head applied to each element of its list operands
// (one list and scalars; several lists whose lengths are equal by
// construction or whose widths their types state), lists of booleans and
// comparisons of lists as values, and the element-wise selection (`If`,
// `Which` with a list condition).
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`). The values must be the same doubles
// (`Object.is`) at every position, and the same shape; the inputs must be
// the same after the call as a deep copy taken before it, and a second call
// with the same inputs gives the same value. For the elementary heads the
// value also agrees with the interpreter within 1e-12 relative, or by the
// caveats of compiled code (`NaN` where the interpreter has no real
// number), for the arguments that the interpreter admits (finite numbers).
// In the `complex` mode the profile gives the same value or declines.

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
const V2: [string, string] = ['U', 'vector<2>'];
const LR3: [string, string] = ['R', 'list<real^3>'];
const LR3b: [string, string] = ['S', 'list<real^3>'];
const X: [string, string] = ['x', 'real'];
const N: [string, string] = ['n', 'integer'];
const B: [string, string] = ['B', 'list<boolean>'];

type Arg = number | boolean | (number | boolean)[] | number[][];

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

/** The outcome of a call that threw (`outcome()`). */
function isThrown(a: unknown): a is { thrown: string } {
  return typeof a === 'object' && a !== null && 'thrown' in a;
}

/** Within 1e-12 relative of the interpreter, element by element at every
 *  depth; `NaN` where the interpreter gives no real number. */
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
  Array.isArray(a)
    ? a.every((e) => finite(e as Arg))
    : typeof a === 'boolean' || Number.isFinite(a);

/** The MathJSON of an argument. */
function boxArg(a: Arg): MathJsonExpression {
  if (typeof a === 'boolean') return a ? 'True' : 'False';
  if (!Array.isArray(a)) return Object.is(a, -0) ? { num: '-0' } : a;
  return ['List', ...a.map((e) => boxArg(e as Arg))] as MathJsonExpression;
}

/** The number, boolean, or nested arrays of numbers of a value of the
 *  interpreter, `undefined` where it is not a real number. */
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
  /** No comparison with the interpreter (a special function, whose kernel
   *  the scalar tests compare, or the caveats of compiled code). */
  readonly existingOnly?: boolean;
  /** Compare with the interpreter only for arguments whose numbers are
   *  positive (`ordinary()`): a negative base or argument of `Power`,
   *  `Root`, `Log`, `Mod` and `Arctan2` reads the branch cuts and the signed
   *  zeros of the scalar code, which its own tests compare. */
  readonly positiveOnly?: boolean;
  /** The same head with scalar operands: when the profile declines the
   *  program in the `strict` mode, it declines this one too (an operand
   *  that the scalar rule of the head refuses, `ClausenCl(0.5, x)`). */
  readonly scalarJson?: MathJsonExpression;
};

/** Whether the interpreter is compared on `args`: every number finite, not
 *  `-0` (the interpreter has no signed zero), at most 1e3 in magnitude (the
 *  scalar code overflows before the interpreter does: `Coth(1e300)` is
 *  `cosh/sinh`, `NaN`), and positive when `positive` is set. */
function ordinary(args: readonly Arg[], positive: boolean): boolean {
  const ok = (a: Arg): boolean =>
    Array.isArray(a)
      ? a.every((e) => ok(e as Arg))
      : typeof a === 'boolean' ||
        (Number.isFinite(a) &&
          !Object.is(a, -0) &&
          Math.abs(a) <= 1e3 &&
          (!positive || a > 0));
  return args.every(ok);
}

/** The value of a call, or the message of what it throws: the profile throws
 *  where the existing code throws (`_SYS.floorMod` beyond ±(2^53 − 1)). */
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
    expect([
      String((error as Error).message).slice(0, 300),
      (error as { diagnostic?: { code?: string } }).diagnostic?.code,
    ]).toEqual([expect.anything(), 'outside-profile']);
    return 'declined';
  }
}

/** One engine per mode for the programs of `check()`: a program is a
 *  function literal whose names are its parameters, so boxing and
 *  evaluating it declare and assign nothing in the engine. */
const ENGINES = new Map<Mode, ComputeEngine>();
function engineFor(mode: Mode): ComputeEngine {
  let ce = ENGINES.get(mode);
  if (ce === undefined) {
    ce = new ComputeEngine();
    ce.precision = 'machine';
    ENGINES.set(mode, ce);
  }
  return ce;
}

/** Each program, compiled with the profile and with the existing compiler,
 *  and run on each list of arguments. In the `strict` mode the profile
 *  admits the program; in the `complex` mode it gives the same value or
 *  declines. */
function check(program: Program): void {
  for (const mode of MODES) {
    const ce = engineFor(mode);
    const expr = ce.expr(program.json);
    const result = profileOf(expr, mode);
    if (result === 'declined') {
      if (mode === 'strict' && program.scalarJson !== undefined) {
        expect(profileOf(ce.expr(program.scalarJson), mode)).toBe('declined');
        return;
      }
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
      // The inputs are not written, and a second call gives the same value.
      expect([mode, args, same(inputs, args)]).toEqual([mode, args, true]);
      expect([mode, args, same(outcome(result, inputs), value)]).toEqual([
        mode,
        args,
        true,
      ]);
      const reference = outcome(
        existing,
        args.map((a) => structuredClone(a))
      );
      if (typeof value === 'object' && value !== null && 'thrown' in value) {
        expect([mode, args, value]).toEqual([mode, args, reference]);
        continue;
      }
      expect([mode, args, value, same(value, reference)]).toEqual([
        mode,
        args,
        value,
        true,
      ]);
      if (
        program.existingOnly ||
        !args.every(finite) ||
        !ordinary(args, program.positiveOnly === true)
      )
        continue;
      const expected = interpret(ce, program.json, args);
      // No value of the interpreter (an error, an unevaluated form, an
      // element out of range): the caveats of compiled code.
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

/** The program `json` declines with a message that matches `message`. */
function declines(json: MathJsonExpression, message: RegExp): void {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const expr = ce.expr(json);
  // The existing compiler compiles it.
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

/** Lists of reals: empty, one element, signed zeros, `NaN`, the
 *  infinities, negatives under roots and logarithms, large and tiny. */
const LISTS: number[][] = [
  [],
  [3],
  [-0, 0, NaN, Infinity, -Infinity],
  [-2.5, -1, 0.5, 1, 2, 3, -8, 10.5],
  [1e300, 5e-324, 1 / 3, -1e-300, 0.1, 7],
];
/** Lists of moderate reals for the special functions, whose kernels are
 *  slow or iterate far out (`PolyLog` of 1e300). */
const SMALL_LISTS: number[][] = [
  [],
  [0.5],
  [-0, 0, NaN, Infinity, -Infinity],
  [-2.5, -1, 0.25, 1, 2, 3.5],
];
const INTEGER_LISTS: number[][] = [[], [5], [3, -1, 0, -0, 7, 12]];
const VECTORS: number[][] = [
  [1, -2, 0.5],
  [-0, NaN, Infinity],
  [3, 1e300, -8],
];
/** Vectors of moderate reals for the special functions: the time of the
 *  kernel of `BesselJ` and `BesselI` grows with an integer order (about 2 s
 *  for the order 1e9; the order 1e300 does not end). */
const SMALL_VECTORS: number[][] = [
  [1, -2, 0.5],
  [-0, NaN, Infinity],
  [3, 2.5, -8],
];
const SCALARS = [2, -0, 0.5, -3, NaN];

const one = (lists: readonly number[][]) => lists.map((l) => [l] as const);

/** The heads of one operand that the existing emitter broadcasts with the
 *  scalar code of the head (section 1.3 of the design note), and the
 *  forms of one operand that canonicalize to another head (`Exp`, `Lb`,
 *  `Lg`, `Square`). */
const ELEMENTARY_UNARY = [
  'Sqrt',
  'Ln',
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Sinh',
  'Cosh',
  'Tanh',
  'Coth',
  'Arctan',
  'Arsinh',
  'Arccot',
  'Arcsch',
  'Abs',
  'Sign',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Exp',
  'Square',
  'Lb',
  'Lg',
  'Log',
  'Heaviside',
];
const SPECIAL_UNARY = [
  'Gamma',
  'GammaLn',
  'Erf',
  'Erfc',
  'ErfInv',
  'Digamma',
  'Trigamma',
  'Haversine',
  'Factorial',
  'Factorial2',
  'Sinc',
  'Zeta',
  'LambertW',
  'FresnelS',
  'FresnelC',
  'Erfi',
  'SinIntegral',
  'ExpIntegralEi',
  'LogIntegral',
  'DirichletEta',
  'DirichletBeta',
  'EllipticK',
  'EllipticE',
  'Chop',
];
const ELEMENTARY_BINARY = [
  'Power',
  'Root',
  'Log',
  'Mod',
  'Arctan2',
  'Hypot',
  'Remainder',
];
const SPECIAL_BINARY = [
  'Binomial',
  'Choose',
  'Zeta',
  'ClausenCl',
  'EllipticF',
  'EllipticPi',
  'BesselJ',
  'BesselY',
  'BesselI',
  'BesselK',
  'PolyGamma',
  'HurwitzZeta',
  'PolyLog',
  'EllipticE',
  'LambertW',
];

const unaryPrograms = (head: string, special: boolean): Program[] => [
  {
    name: `${head}(L)`,
    json: fn([head, 'L'], L),
    args: one(special ? SMALL_LISTS : LISTS),
    existingOnly: special,
  },
  {
    name: `${head}(I)`,
    json: fn([head, 'I'], I),
    args: one(INTEGER_LISTS),
    existingOnly: special,
  },
  {
    name: `${head}(V), V: vector<3>`,
    json: fn([head, 'V'], V),
    args: one(special ? SMALL_VECTORS : VECTORS),
    existingOnly: special,
  },
  // A nested head: one build per head, the inner list complete first.
  {
    name: `${head}(L + 1)`,
    json: fn([head, ['Add', 'L', 1]], L),
    args: one(special ? SMALL_LISTS : LISTS),
    existingOnly: special,
  },
];

/** The comprehension `[k·t for k in 1..n]`. */
const comprehension = (t: MathJsonExpression): MathJsonExpression => [
  'Comprehension',
  ['Multiply', 'k', t],
  ['Element', 'k', ['Range', 1, 'n']],
];

const binaryPrograms = (head: string, special: boolean): Program[] => {
  const lists = special ? SMALL_LISTS : LISTS;
  const vectors = special ? SMALL_VECTORS : VECTORS;
  const existingOnly = special;
  const positiveOnly = true;
  return [
    {
      name: `${head}(L, x)`,
      json: fn([head, 'L', 'x'], L, X),
      args: lists.flatMap((l) => SCALARS.map((x) => [l, x])),
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head}(x, L)`,
      json: fn([head, 'x', 'L'], L, X),
      args: lists.flatMap((l) => SCALARS.map((x) => [l, x])),
      existingOnly,
      positiveOnly,
    },
    // Exact literals as the scalar operand: the element code reads each
    // operand as a value (`_SYS.pow(e, 3)`, the double of 1/3).
    ...([3, ['Rational', 1, 3], 0.5, -2] as MathJsonExpression[]).flatMap(
      (c): Program[] => [
        {
          name: `${head}(L, ${JSON.stringify(c)})`,
          json: fn([head, 'L', c], L),
          args: one(lists),
          existingOnly: existingOnly || c === -2,
          positiveOnly,
          scalarJson: fn([head, 'x', c], X),
        },
        {
          name: `${head}(${JSON.stringify(c)}, L)`,
          json: fn([head, c, 'L'], L),
          args: one(lists),
          existingOnly: existingOnly || c === -2,
          positiveOnly,
          scalarJson: fn([head, c, 'x'], X),
        },
      ]
    ),
    {
      name: `${head}(I, 2)`,
      json: fn([head, 'I', 2], I),
      args: one(INTEGER_LISTS),
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head}(L, L), one name`,
      json: fn([head, 'L', 'L'], L),
      args: one(lists),
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head}(L, L + 1), one name and an element-wise result`,
      json: fn([head, 'L', ['Add', 'L', 1]], L),
      args: one(lists),
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head}(V, W), vector<3>`,
      json: fn([head, 'V', 'W'], V, W),
      args: [
        [vectors[0], vectors[1]],
        [vectors[2], vectors[0]],
        [vectors[1], vectors[2]],
      ],
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head}(R, S), list<real^3>`,
      json: fn([head, 'R', 'S'], LR3, LR3b),
      args: [
        [vectors[0], vectors[2]],
        [vectors[1], vectors[0]],
      ],
      existingOnly,
      positiveOnly,
    },
    {
      name: `${head} of two comprehensions over one range`,
      json: fn([head, comprehension('x'), comprehension(2)], X, N),
      args: [
        [0.5, 0],
        [0.5, 3],
        [-1.5, 4],
      ],
      existingOnly,
      positiveOnly,
    },
  ];
};

describe('slice 1a: a scalar head of one operand over a list', () => {
  test.each(
    ELEMENTARY_UNARY.flatMap((h) => unaryPrograms(h, false)).map(
      (p) => [p.name, p] as const
    )
  )('%s', (_name, program) => check(program));
  test.each(
    SPECIAL_UNARY.flatMap((h) => unaryPrograms(h, true)).map(
      (p) => [p.name, p] as const
    )
  )('%s', (_name, program) => check(program));
});

describe('slice 1a and 1b: a scalar head of two operands over lists', () => {
  test.each(
    ELEMENTARY_BINARY.flatMap((h) => binaryPrograms(h, false)).map(
      (p) => [p.name, p] as const
    )
  )('%s', (_name, program) => check(program));
  test.each(
    SPECIAL_BINARY.flatMap((h) => binaryPrograms(h, true)).map(
      (p) => [p.name, p] as const
    )
  )('%s', (_name, program) => check(program));
});

describe('slice 1: other forms', () => {
  const programs: Program[] = [
    {
      name: 'Clamp(L, 0, x)',
      json: fn(['Clamp', 'L', 0, 'x'], L, X),
      args: LISTS.flatMap((l) => SCALARS.map((x) => [l, x])),
    },
    {
      name: 'Clamp(x, L, 2)',
      json: fn(['Clamp', 'x', 'L', 2], L, X),
      args: LISTS.flatMap((l) => SCALARS.map((x) => [l, x])),
    },
    {
      name: 'Exp(L) + Sqrt(L)',
      json: fn(['Add', ['Exp', 'L'], ['Sqrt', 'L']], L),
      args: one(LISTS),
    },
    {
      name: 'Sqrt(L^2 + M^2) with L, M of one name',
      json: fn(['Sqrt', ['Add', ['Power', 'L', 2], ['Power', 'L', 3]]], L),
      args: one(LISTS),
    },
    {
      name: '2^L - Ln(L) / 3',
      json: fn(
        ['Subtract', ['Power', 2, 'L'], ['Divide', ['Ln', 'L'], 3]],
        L
      ),
      args: one(LISTS),
    },
    {
      name: 'Power(L, x) of a Range',
      json: fn(['Power', ['Range', 1, 'n'], 'x'], N, X),
      args: [
        [0, 2],
        [4, 0.5],
        [3, -1],
      ],
    },
    {
      name: 'Mod(L, 3) + x',
      json: fn(['Add', ['Mod', 'L', 3], 'x'], L, X),
      args: LISTS.flatMap((l) => [2, -0].map((x) => [l, x])),
    },
    {
      name: 'Sum of a broadcast of a real type',
      json: fn(['Sum', ['Add', ['Floor', 'L'], 1]], L),
      args: one(LISTS),
    },
    {
      name: 'At of a broadcast of a real type',
      json: fn(['At', ['Floor', 'L'], 1], L),
      args: one(LISTS.slice(1)),
    },
    {
      name: 'Length of a broadcast',
      json: fn(['Length', ['Sqrt', 'L']], L),
      args: one(LISTS),
    },
    {
      name: 'a broadcast of a list of lists',
      json: fn(['Sqrt', 'A'], ['A', 'list<list<real>>']),
      args: [[[]], [[[1, 4], [9]]], [[[-0, 2], [NaN, -1, 16]]]],
    },
    {
      name: 'a broadcast of two lists of lists of one name',
      json: fn(['Hypot', 'A', 'A'], ['A', 'list<list<real>>']),
      args: [[[]], [[[1, 4], [9]]]],
    },
    {
      name: 'a broadcast of a matrix and a scalar',
      json: fn(['Hypot', 'A', 'x'], ['A', 'matrix<2x2>'], X),
      args: [
        [
          [
            [1, 2],
            [3, -4],
          ],
          0.5,
        ],
      ],
    },
  ];
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, p) =>
    check(p)
  );

  test('a draw in a scalar operand happens once, before the elements', () => {
    // The existing compiler and the profile draw from the same sequence:
    // with one seed the two give the same doubles.
    // In a frame of one seed, the existing compiler and the profile draw
    // the same numbers: equal doubles mean the same draws in the same order,
    // and the next number of the frame after the call is the same.
    const ce = new ComputeEngine();
    for (const body of [
      ['Add', ['Sqrt', 'L'], ['Random']],
      ['Sqrt', ['Multiply', 'L', ['Random']]],
    ] as MathJsonExpression[]) {
      const expr = ce.expr(fn(body, L));
      const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
      const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
      for (const l of [[], [1, 4, 9]]) {
        const inFrame = (result: CompilationResult<'javascript'>) =>
          withRandomSeedFrame(ce, 7, () => {
            const value = run(result, [l]);
            return [value, ce._random()];
          });
        const [value, next] = inFrame(profile);
        expect(same([value, next], inFrame(existing))).toBe(true);
      }
    }
  });

  test('a list result is a new array', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.expr(fn(['Sqrt', 'L'], L)),
      PROFILE as never
    ) as CompilationResult<'javascript'>;
    const input = [1, 4, 9];
    const first = run(result, [input]) as number[];
    first[0] = 42;
    expect(input).toEqual([1, 4, 9]);
    expect(run(result, [input])).toEqual([1, 2, 3]);
  });
});

describe('slice 1: the declines that stay', () => {
  const cases: [string, MathJsonExpression, RegExp][] = [
    [
      'two lists of unstated lengths',
      fn(['Hypot', 'L', 'M'], L, M),
      /Hypot of the lists L and M, whose lengths are not equal by construction.*declare one width/,
    ],
    [
      'two lists of different stated widths',
      fn(['Power', 'U', 'V'], V2, V),
      /Power of the lists U and V, whose lengths are not equal by construction/,
    ],
    [
      'a list and a list of unstated length',
      fn(['Arctan2', 'V', 'L'], V, L),
      /whose lengths are not equal by construction/,
    ],
    [
      'Arcsin of a list (open choice 6)',
      fn(['Arcsin', 'L'], L),
      /Arcsin with the list operand L is not in the profile: the scalar code of Arcsin of a real operand is complex/,
    ],
    [
      'Arcsec of a list',
      fn(['Arcsec', 'L'], L),
      /the scalar code of Arcsec of a real operand is complex/,
    ],
    [
      'Beta of a list (a domain of the operands)',
      fn(['Beta', 'L', 2], L),
      /Beta with the list operand L is not in the profile: the profile proves the domain/,
    ],
    [
      'Sin of a multiple of Pi',
      fn(['Sin', ['Multiply', 'Pi', 'L']], L),
      /the operand is a multiple of Pi/,
    ],
    [
      'Floor of an inexact constant',
      fn(['Floor', ['Add', 'L', ['Rational', 1, 3]]], L),
      /the operand holds the exact constant 1\/3/,
    ],
    [
      'Sech of a list',
      fn(['Sech', 'L'], L),
      /Sech is not a head that the profile applies to each element of a list/,
    ],
    [
      'KroneckerDelta of a list',
      fn(['Hypot', ['KroneckerDelta', 'L'], 'x'], L, X),
      /KroneckerDelta/,
    ],
    [
      'a tuple operand',
      fn(['Sqrt', 'P'], ['P', 'tuple<real, real>']),
      /Sqrt with the tuple operand P/,
    ],
    [
      'a list of lists beside a list',
      fn(['Hypot', 'A', 'L'], ['A', 'list<list<real>>'], L),
      /of the ranks 2 and 1/,
    ],
    [
      'two comprehensions over different ranges',
      fn(
        [
          'Hypot',
          comprehension('x'),
          ['Comprehension', 'k', ['Element', 'k', ['Range', 2, 'n']]],
        ],
        X,
        N
      ),
      /whose lengths are not equal by construction/,
    ],
    [
      'a comprehension with a guard',
      fn(
        [
          'Hypot',
          comprehension('x'),
          [
            'Comprehension',
            'k',
            ['Element', 'k', ['Range', 1, 'n'], ['Less', 'k', 2]],
          ],
        ],
        X,
        N
      ),
      /not/,
    ],
    [
      'Max of a list of lists and a list (slice 5 admits a list and a scalar)',
      fn(['Max', 'A', 'L'], L, ['A', 'list<list<real>>']),
      /a list of lists beside another list declines/,
    ],
  ];
  test.each(cases)('%s', (_name, json, message) => declines(json, message));

  test('the complex mode declines a new element-wise head', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(fn(['Sqrt', 'L'], L));
    expect(() =>
      compile(expr, { ...PROFILE, mode: 'complex' } as never)
    ).toThrow(/Sqrt with the list operand L is not in the profile in the complex mode/);
  });
});

const LX = LISTS.flatMap((l) => SCALARS.map((x) => [l, x] as const));
const BELOW = ['Less', 'L', 0] as MathJsonExpression;
const BELOW_X = ['Less', 'L', 'x'] as MathJsonExpression;

describe('slice 2a: comparisons and connectives of lists as values', () => {
  const programs: Program[] = (
    [
      ['L < 0', BELOW],
      ['L < x', BELOW_X],
      ['x < L', ['Less', 'x', 'L']],
      ['L <= x', ['LessEqual', 'L', 'x']],
      ['L > x', ['Greater', 'L', 'x']],
      ['L >= x', ['GreaterEqual', 'L', 'x']],
      ['L == x', ['Equal', 'L', 'x']],
      ['L == 3', ['Equal', 'L', 3]],
      ['L != x', ['NotEqual', 'L', 'x']],
      ['L < L + 1, one name', ['Less', 'L', ['Add', 'L', 1]]],
      ['Not(L < 0)', ['Not', BELOW]],
      ['And(L < 0, L > x)', ['And', BELOW, ['Greater', 'L', 'x']]],
      ['Or of three', ['Or', BELOW, BELOW_X, ['Equal', 'L', 3]]],
      ['And of a list and a boolean', ['And', BELOW, ['Less', 'x', 1]]],
      ['At of a comparison', ['At', BELOW, 2]],
      ['Length of a comparison', ['Length', BELOW]],
      ['If of an element of a comparison', ['If', ['At', BELOW_X, 1], 1, 2]],
    ] as [string, MathJsonExpression][]
  ).map(([name, body]) => ({ name, json: fn(body, L, X), args: LX }));
  programs.push({
    name: 'V < W, vector<3>',
    json: fn(['Less', 'V', 'W'], V, W),
    args: [
      [VECTORS[0], VECTORS[1]],
      [VECTORS[2], VECTORS[0]],
    ],
  });
  programs.push({
    name: 'I < 2 of integers',
    json: fn(['Less', 'I', 2], I),
    args: one(INTEGER_LISTS),
  });
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, p) =>
    check(p)
  );

  test('a list of booleans is a new array of JavaScript booleans', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.expr(fn(BELOW, L)),
      PROFILE as never
    ) as CompilationResult<'javascript'>;
    const value = run(result, [[-1, 0, NaN, 2]]);
    expect(value).toEqual([true, false, false, false]);
  });
});

describe('slice 2b: element-wise selection', () => {
  const programs: Program[] = (
    [
      ['If(L < 0, L, 0)', ['If', BELOW, 'L', 0]],
      ['If(L > 0, L, 0)', ['If', ['Greater', 'L', 0], 'L', 0]],
      ['If(L < x, x, L)', ['If', BELOW_X, 'x', 'L']],
      ['If(L < x, Sqrt(L), -L): list arms', ['If', BELOW_X, ['Sqrt', 'L'], ['Negate', 'L']]],
      ['If(L < x, 1, 2): scalar arms', ['If', BELOW_X, 1, 2]],
      ['the restriction If(L < 0, 1)', ['If', BELOW, 1]],
      ['the restriction If(L < 0, L)', ['If', BELOW, 'L']],
      ['Which with a default', ['Which', BELOW, -1, ['Less', 'L', 1], 0, 'True', 1]],
      ['Which with no default', ['Which', BELOW, 'L', ['Less', 'L', 1], 'x']],
      ['If of Not', ['If', ['Not', BELOW], 1, 2]],
      ['If of And', ['If', ['And', BELOW, ['Greater', 'L', -2]], 'L', 'x']],
      ['If of Or', ['If', ['Or', BELOW, ['Equal', 'L', 'x']], 'L', 'x']],
      ['Sum of a selection', ['Sum', ['If', BELOW, 0, 'L']]],
      ['a selection in an arithmetic', ['Add', ['If', BELOW, 0, 'L'], 1]],
    ] as [string, MathJsonExpression][]
  ).map(([name, body]) => ({ name, json: fn(body, L, X), args: LX }));
  programs.push({
    name: 'If(V < W, V, W), vector<3>',
    json: fn(['If', ['Less', 'V', 'W'], 'V', 'W'], V, W),
    args: [
      [VECTORS[0], VECTORS[1]],
      [VECTORS[2], VECTORS[0]],
    ],
  });
  programs.push({
    name: 'a condition that draws (evaluated once, as the existing code does)',
    json: fn(['If', ['Less', 'L', ['Random']], 1, 2], L),
    args: [[[]]],
    existingOnly: true,
  });
  test.each(programs.map((p) => [p.name, p] as const))('%s', (_name, p) =>
    check(p)
  );
});

describe('slice 2: the declines that stay', () => {
  const cases: [string, MathJsonExpression, RegExp][] = [
    [
      'an arm that draws',
      fn(['If', BELOW, ['Random'], 0], L),
      /an arm has an operation that can draw, throw, abort or reach the host \(Random\(\)\)/,
    ],
    [
      'an arm that can throw',
      fn(['If', BELOW, ['Mod', 'L', 3], 0], L),
      /an arm has an operation that can draw, throw, abort or reach the host \(mod\(L, 3\)\)/,
    ],
    [
      'two lists of unstated lengths (the mismatch defect)',
      fn(['If', ['Greater', 'L', 'M'], 'L', 'M'], L, M),
      /whose lengths are not equal by construction/,
    ],
    [
      'an arm of another length',
      fn(['If', BELOW, 'M', 0], L, M),
      /have lengths that are not equal by construction.*declare one width/,
    ],
    [
      'a Which with a scalar condition among list conditions',
      fn(['Which', BELOW, 1, ['Less', 'x', 0], 2], L, X),
      /the condition x < 0 is not a list of booleans/,
    ],
    [
      'a tuple arm',
      fn(['If', BELOW, ['Tuple', 1, 2], ['Tuple', 3, 4]], L),
      /the arm \(1, 2\) has the type `point<2>`/,
    ],
    [
      'a list of booleans as an input',
      fn(['Not', 'B'], B),
      /list<boolean>/,
    ],
    [
      'a list of booleans as a local',
      fn(['Block', ['Declare', 'C', "'list<boolean>'", BELOW], ['At', 'C', 1]], L),
      /the local C declared list<boolean> is not in the profile/,
    ],
    [
      'a list of booleans as an arm of a scalar If',
      fn(['If', ['Less', 'x', 0], BELOW, BELOW_X], L, X),
      /list of booleans/,
    ],
    [
      'a count of a list of booleans',
      fn(['Count', BELOW], L),
      /Count of L < 0 of the type `list<boolean>` is not in the profile/,
    ],
    [
      'a list of booleans in a function of lists',
      fn(['Reverse', BELOW], L),
      /Reverse of L < 0 of the type `list<boolean>` is not in the profile/,
    ],
    [
      'Equal of two lists of lists (slice 5 admits two lists of numbers)',
      fn(['Equal', 'A', 'A'], ['A', 'list<list<real>>']),
      /compares two lists of reals or of integers whole/,
    ],
    [
      'a chain of comparisons',
      fn(['Less', 'L', 1, 2], L),
      /Less with 3 operands is not element-wise/,
    ],
  ];
  test.each(cases)('%s', (_name, json, message) => declines(json, message));

  test('the complex mode declines an element-wise selection', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(fn(['If', BELOW, 'L', 0], L));
    expect(() => compile(expr, { ...PROFILE, mode: 'complex' } as never)).toThrow(
      /in the complex mode/
    );
  });
});


describe('the verifier and the policy: a list of booleans', () => {
  test('a list of booleans is an array; a list of lists of booleans is not held', () => {
    expect(representationOfKind(listType('boolean'))).toBe('array');
    expect(representationOfKind(listType(listType('boolean')))).toBeUndefined();
  });

  function lowered() {
    const ce = new ComputeEngine();
    const preparation = new ScalarFragmentJavaScriptTarget(
      'structured',
      new Map(),
      {}
    ).prepareStructured(ce.expr(fn(BELOW, L)), {
      cse: false,
      constantFold: false,
    });
    const program = lowerStructuredFragment(preparation);
    const ops = program.root.operations as IROperation[];
    const build = ops.findIndex((op) => op.kind === 'build');
    const change = (changed: IROperation): IRProgram => {
      const rootOps = [...ops];
      rootOps[build] = changed;
      return { ...program, root: { ...program.root, operations: rootOps } };
    };
    return { program, ops, build, change, nodes: preparedNodesOf(preparation) };
  }

  test('the build of a comparison is accepted', () => {
    const m = lowered();
    expect(m.build).toBeGreaterThanOrEqual(0);
    expect(String(m.ops[m.build].result!.type)).toBe('list<boolean>');
    expect(() => verifyJavaScriptProgram(m.program, m.nodes)).not.toThrow();
  });

  test('a build of booleans whose result is a list of reals', () => {
    const m = lowered();
    const op = m.ops[m.build];
    const changed = {
      ...op,
      result: { ...op.result!, type: listType('real') },
    } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(changed), m.nodes)).toThrow(
      /the body of a build yields a value of the type boolean/
    );
  });

  test('a build of booleans whose result is a list of lists of booleans', () => {
    const m = lowered();
    const op = m.ops[m.build];
    const changed = {
      ...op,
      result: { ...op.result!, type: listType(listType('boolean')) },
    } as IROperation;
    expect(() => verifyJavaScriptProgram(m.change(changed), m.nodes)).toThrow();
  });
});

describe('program constants and stored values', () => {
  // A captured list is a program constant, and a name whose value is a pure
  // application of the inputs is computed once at the start
  // (docs/plans/2026-11-11-structured-options-and-bindings.md).
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('x', 'real');
    ce.assign('CL', ce.box(['List', 2, -0.5, 3]));
    ce.assign('CM', ce.box(['List', 1, 4, -2]));
    ce.assign('CB', ce.box(['List', 'True', 'False']));
    ce.assign('SV', ce.box(['Add', 'L', 1]));
    return ce;
  }
  const VARS = { L: [1, 4, -9, -0], x: 0.5 };
  test.each([
    ['CL < 0', ['Less', 'CL', 0]],
    ['CL + 1', ['Add', 'CL', 1]],
    ['Sqrt(CL)', ['Sqrt', 'CL']],
    ['If(CL > 0, CL, 0)', ['If', ['Greater', 'CL', 0], 'CL', 0]],
    ['CL + CL', ['Add', 'CL', 'CL']],
    ['Hypot(CL, CL)', ['Hypot', 'CL', 'CL']],
    // Two constants whose types state one width.
    ['Hypot(CL, CM)', ['Hypot', 'CL', 'CM']],
    ['If(CL > 0, CM, 0)', ['If', ['Greater', 'CL', 0], 'CM', 0]],
    ['Sqrt(SV)', ['Sqrt', 'SV']],
    ['If(SV > 2, SV, 0)', ['If', ['Greater', 'SV', 2], 'SV', 0]],
    ['SV^2 + x', ['Add', ['Power', 'SV', 2], 'x']],
  ] as [string, MathJsonExpression][])('%s', (_name, json) => {
    const ce = engine();
    const expr = ce.box(json);
    const profile = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    const value = profile.run!({ ...VARS } as never) as unknown[];
    expect(same(value, existing.run!({ ...VARS } as never))).toBe(true);
    // The result is a new array: a write of the host leaves the constant
    // and the next value unchanged.
    value[0] = 42;
    expect(
      same(profile.run!({ ...VARS } as never), existing.run!({ ...VARS } as never))
    ).toBe(true);
  });

  test.each([
    [
      'a captured list of booleans',
      ['Not', 'CB'],
      /a list literal with an element of the type `boolean` is not in the profile/,
    ],
    [
      'a stored value beside its input (no length key in common)',
      ['Hypot', 'SV', 'L'],
      /Hypot of the lists "SV" and L, whose lengths are not equal by construction/,
    ],
  ] as [string, MathJsonExpression, RegExp][])('%s declines', (_name, json, message) => {
    const ce = engine();
    expect(() => compile(ce.box(json), PROFILE as never)).toThrow(message);
  });
});

describe('the review of slices 1 and 2', () => {
  const comp = (body: MathJsonExpression): MathJsonExpression => [
    'Comprehension',
    body,
    ['Element', 'k', ['Range', 1, 'n']],
  ];
  // The engine types `[√k for k in 1..n]` `list<complex>`, and the existing
  // compiler applies the complex code of each head to its elements
  // (`operandElementLane()`): the profile declines.
  const C = comp(['Sqrt', 'k']);
  // `[k^2 for k in 1..n]` is a `list<integer>`: admitted.
  const K = comp(['Power', 'k', 2]);
  const D = comp(['Negate', 2]);
  const fnN = (body: MathJsonExpression) => fn(body, N);

  test.each([
    ['Arctan(C)', ['Arctan', C]],
    ['Gamma(C)', ['Gamma', C]],
    ['Log(C)', ['Log', C]],
    ['Power(D, C)', ['Power', D, C]],
    ['1 / C', ['Divide', 1, C]],
  ] as [string, MathJsonExpression][])(
    '%s: a list on the complex lane of the existing compiler declines',
    (_name, body) =>
      declines(
        fnN(body),
        /of the list Comprehension\(sqrt\(k\), .*\) is not in the profile: its type list<complex> is not real/
      )
  );

  test.each([
    ['Floor(C)', ['Floor', C]],
    ['Mod(C, 2)', ['Mod', C, 2]],
    ['Hypot(C, 1)', ['Hypot', C, 1]],
    ['C < 2', ['Less', C, 2]],
  ] as [string, MathJsonExpression][])(
    '%s: declined by both compilers',
    (_name, body) => {
      const ce = new ComputeEngine();
      const expr = ce.expr(fnN(body));
      expect(() => compile(expr, EXISTING)).toThrow();
      expect(() => compile(expr, PROFILE as never)).toThrow(
        /its type list<complex> is not real/
      );
    }
  );

  const integers: Program[] = (
    [
      ['Arctan(K)', ['Arctan', K]],
      ['Gamma(K)', ['Gamma', K]],
      ['Power(D, K)', ['Power', D, K]],
      ['Floor(K)', ['Floor', K]],
      ['K < 5', ['Less', K, 5]],
      ['1 / K', ['Divide', 1, K]],
    ] as [string, MathJsonExpression][]
  ).map(([name, body]) => ({
    name,
    json: fnN(body),
    args: [[0], [1], [3]],
  }));
  test.each(integers.map((p) => [p.name, p] as const))(
    '%s: a list of integers is admitted',
    (_name, p) => check(p)
  );
  // The arm `K` is a comprehension of a count that the program computes,
  // which can throw (`canThrow()`): the selection declines, also though
  // the condition computes the same list first.
  test('If(K < 5, K, 0) declines', () =>
    declines(
      fnN(['If', ['Less', K, 5], K, 0]),
      /an arm has an operation that can draw, throw, abort or reach the host/
    )
  );
  test('If(I < 5, I, 0): a list of integers is admitted', () =>
    check({
      name: '',
      json: fn(['If', ['Less', 'I', 5], 'I', 0], I),
      args: one(INTEGER_LISTS),
    })
  );

  // A length key is a proof of equal lengths only for names that read one
  // value: a name that a `vars` entry maps reads the host at each read.
  test.each([
    [
      'two comprehensions over a bound read from the host',
      ['Hypot', comp('k'), comp(['Multiply', 2, 'k'])],
      { n: 'next()' },
    ],
    ['one list name read twice from the host', ['Hypot', 'L', 'L'], { L: 'nextL()' }],
    ['a list name and its element-wise result', ['Add', 'L', ['Multiply', 2, 'L']], { L: 'nextL()' }],
  ] as [string, MathJsonExpression, Record<string, string>][])(
    '%s declines',
    (_name, json, vars) => {
      const ce = new ComputeEngine();
      ce.declare('n', 'integer');
      ce.declare('L', 'list<real>');
      const options = {
        vars,
        preamble:
          'let c = 1; const next = () => ++c; let d = 0; const nextL = () => (++d % 2 ? [1, 2] : [1, 2, 3]);',
      };
      const expr = ce.box(json);
      // The existing compiler reads the host twice: the lengths differ.
      const existing = compile(expr, { ...EXISTING, ...options } as never) as CompilationResult<'javascript'>;
      expect(existing.run!({} as never)).toBeNaN();
      // A list that a `vars` entry maps declines before (the profile reads
      // a number from the host).
      expect(() => compile(expr, { ...PROFILE, ...options } as never)).toThrow(
        /reads a value of the host, which can change between two reads|the option `vars` maps L, which has the type list<real>/
      );
    }
  );

  test('a local whose value changes between two comprehensions has no common key', () => {
    declines(
      fn(
        [
          'Block',
          ['Declare', 'm', "'integer'", 'n'],
          ['Declare', 'A', "'list<real>'", comp('k')],
          ['Assign', 'm', ['Add', 'm', 1]],
          ['Hypot', 'A', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 'm']]]],
        ],
        N
      ),
      /Hypot of the lists A and .*, whose lengths are not equal by construction/
    );
  });

  // A name of a library constant that the program binds is not the
  // constant: the element code does not read it as one.
  const constants = ['ExponentialE', 'Pi', 'ImaginaryUnit', 'NaN'];
  test.each(constants)('%s as a parameter of the root function', (name) => {
    for (const body of [
      ['Root', name, 'L'],
      ['Power', name, 'L'],
      ['If', BELOW, name, 1],
    ] as MathJsonExpression[])
      declines(
        fn(body, [name, 'real'], L),
        new RegExp(`the program binds the name ${name}`)
      );
  });
  // `ImaginaryUnit` as a parameter of a lambda is a limitation of the
  // scalar route (docs/COMPILATION-MODEL.md, known limitations).
  test.each(constants.filter((c) => c !== 'ImaginaryUnit'))('%s as a parameter of a lambda', (name) => {
    // `Map` of a lambda is the rule of the function operand: the lambda's
    // body is scalar code, which reads its parameter.
    const ce = new ComputeEngine();
    const expr = ce.expr(
      fn(['Map', ['Function', ['Power', 'ExponentialE', name], name], 'L'], L)
    );
    let result: CompilationResult<'javascript'> | undefined;
    try {
      result = compile(expr, PROFILE as never) as CompilationResult<'javascript'>;
    } catch {
      return;
    }
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    expect(same(run(result, [[3]]), run(existing, [[3]]))).toBe(true);
  });
  test('ExponentialE as a parameter of a helper', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(real, list<real>) -> list<real>');
    ce.assign(
      'h',
      ce.box(['Function', ['Root', 'ExponentialE', 'V'], 'ExponentialE', 'V'])
    );
    ce.declare('x', 'real');
    ce.declare('L', 'list<real>');
    expect(() => compile(ce.box(['h', 'x', 'L']), PROFILE as never)).toThrow();
  });

  // One throw analysis: the lowering's (`canThrow()`), after the arms are
  // lowered.
  test.each([
    ['Inverse', ['Trace', ['Inverse', 'A']]],
    ['MatrixPower', ['Trace', ['MatrixPower', 'A', 'n']]],
    ['Remainder', ['Remainder', 'L', 3]],
    ['GCD', ['GCD', 'n', 6]],
    ['Repeat', ['Length', ['Repeat', 1, 'n']]],
    ['Linspace', ['Sum', ['Linspace', 0, 1, 'n']]],
  ] as [string, MathJsonExpression][])('an arm with %s declines', (_name, arm) =>
    declines(
      fn(['If', BELOW, arm, 0], L, ['A', 'matrix'], N),
      /an arm has an operation that can draw, throw, abort or reach the host/
    )
  );
  test('the witness: Trace(Inverse(A)) of a rectangular A in an arm', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(
      fn(['If', BELOW, ['Trace', ['Inverse', 'A']], 0], L, ['A', 'matrix'])
    );
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    expect(run(existing, [[1], [[1, 2, 3], [4, 5, 6]]])).toEqual([0]);
    expect(() => compile(expr, PROFILE as never)).toThrow(/an arm has an operation/);
  });
  test('an arm that calls a helper whose body can throw declines', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.box(['Function', ['Mod', 't', 3], ['Typed', 't', "'real'"]]));
    ce.declare('L', 'list<real>');
    ce.declare('x', 'real');
    expect(() =>
      compile(ce.box(['If', ['Less', 'L', 0], ['g', 'x'], 0]), PROFILE as never)
    ).toThrow(/an arm has an operation/);
  });

  test('a condition read inside the build of the selection is a direct read', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.expr(fn(['If', ['Greater', 'L', 0], 'L'], L)),
      PROFILE as never
    ) as CompilationResult<'javascript'>;
    expect(result.code).not.toMatch(/Number\.isNaN\(_v\)/);
    expect(run(result, [[1, -1]])).toEqual([1, NaN]);
    // A user `At` with an index of the run time keeps the read of the
    // existing emitter (`undefined` out of range).
    const at = compile(
      ce.expr(fn(['If', ['At', BELOW, 'n'], 1, 2], L, N)),
      PROFILE as never
    ) as CompilationResult<'javascript'>;
    expect(at.code).toMatch(/Number\.isNaN\(_v\)/);
  });
});

describe('the second review of slices 1 and 2', () => {
  // A literal operand that the existing compiler keeps in the closure of
  // `_SYS.bcast` (`closureFrames()` in `compile-broadcast.ts`): the element
  // code is the scalar code of the head with that operand. Each program
  // gives the doubles of the existing compiler (`Object.is`), or declines.
  const GRID: Arg[][] = [
    [[8, 27, 0, -8, 0.3, 1e15, NaN]],
    [[-0, -27, 1, 2, Infinity, -Infinity, 0.5]],
    [[]],
  ];
  const R = (p: number, q: number): MathJsonExpression => ['Rational', p, q];
  const forms: [string, MathJsonExpression][] = [
    ...(
      [2, 3, -1, R(1, 2), R(2, 3), R(1, 3), R(3, 2), R(8, 5), 0.5, 2.5, R(-2, 3)] as MathJsonExpression[]
    ).map(
      (k) =>
        [`Power(L, ${JSON.stringify(k)})`, ['Power', 'L', k]] as [
          string,
          MathJsonExpression,
        ]
    ),
    ...[2, 3, 4].map(
      (k) => [`Root(L, ${k})`, ['Root', 'L', k]] as [string, MathJsonExpression]
    ),
    ...([2, R(1, 3), 'ExponentialE'] as MathJsonExpression[]).map(
      (c) =>
        [`Power(${JSON.stringify(c)}, L)`, ['Power', c, 'L']] as [
          string,
          MathJsonExpression,
        ]
    ),
    ['Log(L, 2)', ['Log', 'L', 2]],
    ['Power(L, 2/3) == 4', ['Equal', ['Power', 'L', R(2, 3)], 4]],
    ['Power(L + 1, 2/3)', ['Power', ['Add', 'L', 1], R(2, 3)]],
  ];
  test.each(forms)('%s', (_name, body) => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const expr = ce.expr(fn(body, L));
    const result = profileOf(expr, 'strict');
    if (result === 'declined') return;
    const existing = compile(expr, EXISTING) as CompilationResult<'javascript'>;
    for (const args of GRID) {
      const value = outcome(result, args);
      const reference = outcome(existing, args);
      expect([args, value, same(value, reference)]).toEqual([
        args,
        value,
        true,
      ]);
    }
  });
  // The existing compiler applies an exact fraction of odd denominator to
  // each element as a real root (`_SYS.pow2(Math.cbrt(e))`), where
  // `_SYS.pow(e, 2/3)` gives `3.9999999999999996` for 8.
  test.each([
    ['Power(L, 2/3)', ['Power', 'L', R(2, 3)]],
    ['Power(L, 8/5)', ['Power', 'L', R(8, 5)]],
    ['Power(L, -2/3)', ['Power', 'L', R(-2, 3)]],
    ['Power(L, 2/3) == 4', ['Equal', ['Power', 'L', R(2, 3)], 4]],
  ] as [string, MathJsonExpression][])('%s declines', (_name, body) =>
    declines(fn(body, L), /exact fraction of odd denominator/)
  );
  test('the witness: Power(L, 2/3) of [8]', () => {
    const ce = new ComputeEngine();
    const existing = compile(
      ce.expr(fn(['Power', 'L', R(2, 3)], L)),
      EXISTING
    ) as CompilationResult<'javascript'>;
    expect(run(existing, [[8]])).toEqual([4]);
  });

  // A count that the program computes, in an arm: more than 2^32 - 1
  // elements throw a `RangeError`, where the existing compiler evaluates
  // the arm only where a position selects it.
  test.each([
    ['Range(1, n)', ['Length', ['Range', 1, 'n']]],
    ['Range(1, n, 2)', ['Length', ['Range', 1, 'n', 2]]],
    [
      'Comprehension(k, k in 1..n)',
      ['Length', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 'n']]]],
    ],
  ] as [string, MathJsonExpression][])('an arm with %s declines', (_name, arm) =>
    declines(
      fn(['If', BELOW, arm, 0], L, N),
      /an arm has an operation that can draw, throw, abort or reach the host/
    )
  );
  test('the witness: Length(Range(1, n)) in an arm', () => {
    const ce = new ComputeEngine();
    const existing = compile(
      ce.expr(fn(['If', BELOW, ['Length', ['Range', 1, 'n']], 0], L, N)),
      EXISTING
    ) as CompilationResult<'javascript'>;
    expect(run(existing, [[1], 4294967296])).toEqual([0]);
  });
  // A count of literal bounds cannot throw.
  test.each([
    ['Range(1, 10)', ['Length', ['Range', 1, 10]]],
    ['Range(10)', ['Length', ['Range', 10]]],
    [
      'Comprehension(k, k in 1..5)',
      ['Length', ['Comprehension', 'k', ['Element', 'k', ['Range', 1, 5]]]],
    ],
  ] as [string, MathJsonExpression][])('an arm with %s', (_name, arm) =>
    check({ name: '', json: fn(['If', BELOW, arm, 0], L), args: one(LISTS) })
  );

  // The throw table of `canThrow()` has an entry for every operation, every
  // function of lists and every function of the JavaScript policies. A
  // routine but `derivative` throws (`throwsItself()`).
  test('the throw table covers the policies', () => {
    for (const policy of [JAVASCRIPT_POLICY, JAVASCRIPT_BIGINT_POLICY]) {
      for (const kind of Object.keys(policy.operations))
        expect([kind, Object.hasOwn(OPERATION_THROWS, kind)]).toEqual([
          kind,
          true,
        ]);
      for (const name of Object.keys(policy.collections ?? {}))
        expect([name, Object.hasOwn(COLLECTION_THROWS, name)]).toEqual([
          name,
          true,
        ]);
      for (const name of Object.keys(policy.functions))
        expect([name, Object.hasOwn(FUNCTION_THROWS, name)]).toEqual([
          name,
          true,
        ]);
    }
  });
});
