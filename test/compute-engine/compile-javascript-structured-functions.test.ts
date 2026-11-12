import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  ScalarFragmentJavaScriptTarget,
  type StructuredPhase,
} from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import type { FragmentScope } from '../../src/compute-engine/compilation/fragment';
import type {
  IROperation,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The scalar numeric functions of the structured route of the internal
// JavaScript fragment target that the preludes of Tycho's showcases need
// (docs/plans/2026-11-09-js-compiler-status-and-plan.md, "Prelude census
// (2026-11-10)"): `Exp` (the canonical `Power(ExponentialE, x)`), `Sin`,
// `Cos`, `Tanh`, `Abs`, `Arctan2`, `Ln`, and `Power` with the exponent 1.5,
// with an exponent that is not a number literal, and with a float literal
// exponent of an odd recovered denominator.
//
// Each program is compiled on the structured route and compared with the
// interpreter, and with the ordinary JavaScript compiler as a second check,
// in the `strict` and `complex` modes. The values agree within 1e-12
// relative, or by the caveats of compiled code (docs/COMPILATION-MODEL.md,
// "Caveats of compiled code"): the `strict` mode gives `NaN` where the
// value is not real; compiled code gives `NaN`, `±Infinity` or `0` where
// the interpreter gives a value that is not a number (`ComplexInfinity`)
// or an unevaluated form (`NOT_A_NUMBER` below lists each such input).

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];

/** An engine with the inputs and the captured bindings of the programs. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['k', 'integer'],
    ['p', 'real<0..>'],
    ['n', 'real<..-1>'],
  ])
    ce.declare(name, type);
  ce.declare('a', 'real');
  ce.assume(ce.parse('a > 0'));
  ce.declare('b', 'real');
  ce.assume(ce.parse('b < 0'));
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('drop', 'real');
  ce.assign('drop', -3);
  // For the cross-check of the branches of the existing emitter: a second
  // complex input, non-negative and bounded integer inputs, and captures
  // with exact values that no double holds.
  for (const [name, type] of [
    ['w', 'complex'],
    ['q', 'real<0..>'],
    ['r', 'real<0..>'],
    ['m', 'integer<0..100>'],
  ])
    ce.declare(name, type);
  for (const [name, value] of [
    ['third', ['Rational', 1, 3]],
    ['nearThird', ['Rational', 3333333333333333, 10 ** 16]],
    ['seven', ['Rational', 7, 10]],
    ['tenth', ['Rational', 1, 10]],
  ] as [string, MathJsonExpression][]) {
    ce.declare(name, 'real');
    ce.assign(name, ce.expr(value));
  }
  return ce;
}

const structured = (hooks = {}) =>
  new ScalarFragmentJavaScriptTarget('structured', new Map(), hooks);

type Value = number | boolean | { re: number; im: number };
type Inputs = Record<string, Value>;

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'boolean') return v ? ce.True : ce.False;
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `expr` on `inputs` by the interpreter: a number, a complex
 *  `{re, im}`, or `NaN` for a value that is not a number. */
function interpret(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): unknown {
  const value = expr
    .subs(
      Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, boxValue(ce, v)])
      )
    )
    .evaluate()
    .N();
  if (value.im === 0) return value.re;
  return { re: value.re, im: value.im };
}

/** `a` and `b` are the same value within 1e-12 relative; a complex value
 *  with an imaginary part of 0 equals the number of its real part. An
 *  infinite part equals only the same infinity, and `NaN` only `NaN`. */
function close(a: unknown, b: unknown): boolean {
  const pair = (v: unknown) =>
    typeof v === 'number'
      ? { re: v, im: 0 }
      : (v as { re: number; im: number });
  const p = pair(a);
  const q = pair(b);
  const near = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    (Number.isFinite(u) &&
      Number.isFinite(v) &&
      Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(v)));
  return near(p.re, q.re) && near(p.im, q.im);
}

const nonReal = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as { im: number }).im !== 0;

/** `a` and `b` are the same value, exactly: `Object.is` per number and per
 *  component of a complex value (`NaN` equals `NaN`, `0` differs from
 *  `-0`). The structured route and the existing emitter are compared so;
 *  `close()` is for the interpreter only. */
function exact(a: unknown, b: unknown): boolean {
  if (
    typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null
  )
    return (
      Object.is((a as { re: number }).re, (b as { re: number }).re) &&
      Object.is((a as { im: number }).im, (b as { im: number }).im)
    );
  return Object.is(a, b);
}

test('control: the exact comparator', () => {
  expect(exact(NaN, NaN)).toBe(true);
  expect(exact(0, -0)).toBe(false);
  expect(exact(1, 1 + 2 ** -52)).toBe(false);
  expect(exact({ re: 1, im: -0 }, { re: 1, im: 0 })).toBe(false);
  expect(exact({ re: 1, im: NaN }, { re: 1, im: NaN })).toBe(true);
});

test('control: the comparator of values', () => {
  expect(close(1, 1 + 1e-14)).toBe(true);
  expect(close(1, 1.001)).toBe(false);
  expect(close(Infinity, 1e308)).toBe(false);
  expect(close(-Infinity, -Infinity)).toBe(true);
  expect(close(NaN, NaN)).toBe(true);
  expect(close({ re: 2, im: 0 }, 2)).toBe(true);
  expect(close({ re: 0, im: 2 }, 0)).toBe(false);
});

type Program = { name: string; json: MathJsonExpression; inputs: Inputs[] };

const SPECIAL = [-Infinity, -1e6, -2.5, -0.5, 0, 0.5, 1, 3, 1e6, Infinity, NaN];
const over = (name: string, values: readonly Value[], extra: Inputs = {}) =>
  values.map((v) => ({ [name]: v, ...extra }));

/** The inputs of `x^y`: a negative base (an odd and an even recovered
 *  denominator of the exponent), `-0`, `0`, a base between 0 and 1, large
 *  values, the exponent 0, negative and fractional exponents. No input is
 *  `NaN`: the type `real` does not admit it, and the value of compiled code
 *  is unspecified there (`NaN^0` is `1` in compiled code). */
const POWER_PAIRS: Inputs[] = [-8, -2, -0, 0, 0.5, 3, 1e6].flatMap((x) =>
  [0, -1, 0.5, 1 / 3, 2.5, -1.6, 1e-3, 300].map((y) => ({ x, y }))
);

/** The bases of a float literal exponent. */
const FLOAT_BASES = [-1e300, -8, -2.5, -0.5, -0, 0, 0.5, 1, 3, 1e300];

/** The programs of the total functions: every operand of the route. */
const TOTAL_PROGRAMS: Program[] = [
  {
    name: 'Exp(x)',
    json: ['Exp', 'x'],
    inputs: over('x', [...SPECIAL, -745.2, 709.7, 710]),
  },
  {
    name: 'Exp(x + 1)',
    json: ['Exp', ['Add', 'x', 1]],
    inputs: over('x', [-2, 0, 3]),
  },
  {
    name: 'Exp(-x^2/32)',
    json: ['Exp', ['Divide', ['Negate', ['Power', 'x', 2]], 32]],
    inputs: over('x', [-4, 0, 9]),
  },
  { name: 'Exp(k)', json: ['Exp', 'k'], inputs: over('k', [-3, 0, 5]) },
  {
    name: 'Exp(z)',
    json: ['Exp', 'z'],
    inputs: over('z', [
      { re: 1, im: 2 },
      { re: 0, im: Math.PI },
    ]),
  },
  { name: 'Sin(x)', json: ['Sin', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Cos(x)', json: ['Cos', 'x'], inputs: over('x', SPECIAL) },
  {
    name: 'Tanh(x)',
    json: ['Tanh', 'x'],
    inputs: over('x', [...SPECIAL, 20, -20]),
  },
  {
    name: 'Tanh(8/3) + x',
    json: ['Add', ['Tanh', ['Rational', 8, 3]], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Sin(k) + Cos(k)',
    json: ['Add', ['Sin', 'k'], ['Cos', 'k']],
    inputs: over('k', [-3, 0, 7]),
  },
  { name: 'Sin(z)', json: ['Sin', 'z'], inputs: over('z', [{ re: 1, im: 2 }]) },
  { name: 'Cos(z)', json: ['Cos', 'z'], inputs: over('z', [{ re: 1, im: 2 }]) },
  {
    name: 'Tanh(z)',
    json: ['Tanh', 'z'],
    inputs: over('z', [{ re: 1, im: 2 }]),
  },
  { name: 'Abs(x)', json: ['Abs', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Abs(k)', json: ['Abs', 'k'], inputs: over('k', [-7, 0, 7]) },
  {
    name: 'Abs(p)',
    json: ['Abs', 'p'],
    inputs: over('p', [-0, 0, 2.5, Infinity]),
  },
  {
    name: 'Abs(2xy)',
    json: ['Abs', ['Multiply', 2, 'x', 'y']],
    inputs: over('x', [-1.5, 0, 2], { y: 3 }),
  },
  {
    name: 'Abs(z)',
    json: ['Abs', 'z'],
    inputs: over('z', [
      { re: 3, im: -4 },
      { re: 0, im: 0 },
    ]),
  },
  {
    name: 'Arctan2(y, x)',
    json: ['Arctan2', 'y', 'x'],
    inputs: [
      [1, 1],
      [1, -1],
      [-1, -1],
      [0, -1],
      [0, 1],
      [2, 0],
      [Infinity, 1],
      [1, NaN],
    ].map(([y, x]) => ({ x, y })),
  },
  {
    name: 'Arctan2(k, x)',
    json: ['Arctan2', 'k', 'x'],
    inputs: over('x', [-2, 3], { k: 4 }),
  },
  {
    name: 'Max(0, x)^1.5',
    json: ['Power', ['Max', 0, 'x'], 1.5],
    inputs: over('x', [-4, 0, 2.25, 9, 1e6, Infinity, NaN]),
  },
  { name: 'p^1.5', json: ['Power', 'p', 1.5], inputs: over('p', [0, 2, 9]) },
  {
    name: 'p^(3/2)',
    json: ['Power', 'p', ['Rational', 3, 2]],
    inputs: over('p', [0, 2, 9]),
  },
  {
    name: '(x^2 + 1)^1.5',
    json: ['Power', ['Add', ['Power', 'x', 2], 1], 1.5],
    inputs: over('x', [-3, 0, 2]),
  },
  {
    name: 'Abs(x)^1.5',
    json: ['Power', ['Abs', 'x'], 1.5],
    inputs: over('x', [-4, 0, 9]),
  },
  // An exponent that is not a number literal: `_SYS.pow(b, e)`, the power
  // of the interpreter for a real base and a real exponent. The node is on
  // the complex lane in the `complex` mode when its type is not real
  // (`DECLINED`).
  { name: 'x^y', json: ['Power', 'x', 'y'], inputs: POWER_PAIRS },
  {
    name: 'x^(y/2)',
    json: ['Power', 'x', ['Divide', 'y', 2]],
    inputs: over('x', [-8, -0, 0, 0.25, 3], { y: 3 }),
  },
  {
    name: 'p^y',
    json: ['Power', 'p', 'y'],
    inputs: POWER_PAIRS.filter(({ x }) => !((x as number) < 0)).map(
      ({ x, y }) => ({ p: x, y })
    ),
  },
  {
    name: 'x^k',
    json: ['Power', 'x', 'k'],
    inputs: [-2.5, -0, 0, 0.5, 3, 1e200].flatMap((x) =>
      over('k', [-3, -1, 0, 2, 3], { x })
    ),
  },
  {
    name: '2^y',
    json: ['Power', 2, 'y'],
    inputs: over('y', [-1074, -1, -0.5, 0, 0.5, 3, 1024]),
  },
  {
    name: '(-2)^y',
    json: ['Power', -2, 'y'],
    inputs: over('y', [-1, 0, 1 / 3, 0.5, 3, 0.2]),
  },
  // A float literal exponent, not an integer, with an odd recovered
  // denominator: the real root of a negative base, `|x|^e` (`abs-pow`, an
  // even numerator: 1.6 is 8/5) or with the sign of the base (`signed-pow`,
  // an odd one: 1.4 is 7/5, 0.2 is 1/5), in both modes.
  { name: 'x^1.6', json: ['Power', 'x', 1.6], inputs: over('x', FLOAT_BASES) },
  { name: 'x^1.4', json: ['Power', 'x', 1.4], inputs: over('x', FLOAT_BASES) },
  {
    name: 'x^-1.6',
    json: ['Power', 'x', -1.6],
    inputs: over('x', FLOAT_BASES),
  },
  { name: 'x^0.2', json: ['Power', 'x', 0.2], inputs: over('x', FLOAT_BASES) },
  // The float `1/3`: the sign rule, not `Math.cbrt` (the handler reaches the
  // real root first).
  {
    name: 'x^(1/3 as a float)',
    json: ['Power', 'x', 1 / 3],
    inputs: over('x', FLOAT_BASES),
  },
  {
    name: 'x^1.6 + 1',
    json: ['Add', ['Power', 'x', 1.6], 1],
    inputs: over('x', [-2, 0, 3]),
  },
  {
    name: 'Ln(x)^1.6',
    json: ['Power', ['Ln', 'x'], 1.6],
    inputs: over('x', [0.25, 1, 3, 1e6]),
  },
];

/** The programs of the functions with a restricted real domain. */
const LN_PROGRAMS: Program[] = [
  {
    name: 'Ln(x)',
    json: ['Ln', 'x'],
    inputs: over('x', [-4, -0.5, 0, 0.5, 1, 9, Infinity, -Infinity, NaN]),
  },
  {
    name: 'Ln(p)',
    json: ['Ln', 'p'],
    inputs: over('p', [0, 0.5, 9, Infinity]),
  },
  { name: 'Ln(n)', json: ['Ln', 'n'], inputs: over('n', [-1, -6.25]) },
  {
    name: 'Ln(z)',
    json: ['Ln', 'z'],
    inputs: over('z', [
      { re: 3, im: 4 },
      { re: -4, im: 0 },
    ]),
  },
  {
    name: 'Ln(2) + x',
    json: ['Add', ['Ln', 2], 'x'],
    inputs: over('x', [0, 1]),
  },
  // Literal operands: the existing emitter writes the same call of the same
  // double (`Math.log(2.5)`), or folds `Sqrt` of a literal to the double of
  // `Math.sqrt`, which is correctly rounded: the same number at run time.
  {
    name: 'Ln(2.5) + x',
    json: ['Add', ['Ln', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Ln(-2.5) + x',
    json: ['Add', ['Ln', -2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Sqrt(2.5) + x',
    json: ['Add', ['Sqrt', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Sqrt(-2.5) + x',
    json: ['Add', ['Sqrt', -2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Sin(2.5) + Cos(2.5) + x',
    json: ['Add', ['Sin', 2.5], ['Cos', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Tanh(2.5) + x',
    json: ['Add', ['Tanh', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Abs(-2.5) + Abs(2.5) + x',
    json: ['Add', ['Abs', -2.5], ['Abs', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Arctan2(1, 2.5) + x',
    json: ['Add', ['Arctan2', 1, 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'x + Ln(-2.5)',
    json: ['Add', 'x', ['Ln', -2.5]],
    inputs: over('x', [0, 1]),
  },
  { name: 'Ln(k)', json: ['Ln', 'k'], inputs: over('k', [-4, 0, 9]) },
  {
    name: 'Ln(p + 1)',
    json: ['Ln', ['Add', 'p', 1]],
    inputs: over('p', [0, 3]),
  },
  {
    name: 'Ln(Max(0, x))',
    json: ['Ln', ['Max', 0, 'x']],
    inputs: over('x', [-4, 0, 9]),
  },
  {
    name: 'Ln(Abs(x))',
    json: ['Ln', ['Abs', 'x']],
    inputs: over('x', [-4, 0, 9]),
  },
  {
    name: 'Ln(x^2 + 1)',
    json: ['Ln', ['Add', ['Power', 'x', 2], 1]],
    inputs: over('x', [-4, 0, 9]),
  },
  {
    name: 'Ln(p / x)',
    json: ['Ln', ['Divide', 'p', 'x']],
    inputs: over('x', [-4, 2], { p: 3 }),
  },
  { name: 'Ln(Ln(x))', json: ['Ln', ['Ln', 'x']], inputs: over('x', [0.5, 3]) },
  {
    name: 'Ln(Max(0, Ln(x)))',
    json: ['Ln', ['Max', 0, ['Ln', 'x']]],
    inputs: over('x', [0.5, 3]),
  },
  {
    name: 'Ln(Exp(x))',
    json: ['Ln', ['Exp', 'x']],
    inputs: over('x', [-1, 2]),
  },
  { name: 'Ln(a), a > 0', json: ['Ln', 'a'], inputs: [{ a: 4 }] },
  { name: 'Ln(b), b < 0', json: ['Ln', 'b'], inputs: [{ b: -4 }] },
  { name: 'Ln(offset), offset = 2', json: ['Ln', 'offset'], inputs: [{}] },
  {
    name: 'x + Ln(drop), drop = -3',
    json: ['Add', 'x', ['Ln', 'drop']],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Ln(Sqrt(p) + 1)',
    json: ['Ln', ['Add', ['Sqrt', 'p'], 1]],
    inputs: over('p', [0, 9]),
  },
  {
    name: 'Sqrt(Abs(x))',
    json: ['Sqrt', ['Abs', 'x']],
    inputs: over('x', [-4, 9]),
  },
  {
    name: 'Sqrt(x^2 + 1)',
    json: ['Sqrt', ['Add', ['Power', 'x', 2], 1]],
    inputs: over('x', [-4, 9]),
  },
  {
    name: 'Sqrt(p / x)',
    json: ['Sqrt', ['Divide', 'p', 'x']],
    inputs: over('x', [-4, 2], { p: 3 }),
  },
  {
    name: 'Sqrt(Exp(x))',
    json: ['Sqrt', ['Exp', 'x']],
    inputs: over('x', [-1, 2]),
  },
  {
    name: 'Ln(x) + Ln(y)',
    json: ['Add', ['Ln', 'x'], ['Ln', 'y']],
    inputs: over('x', [-4, 9], { y: 2 }),
  },
  {
    name: 'Tanh(Ln(x))',
    json: ['Tanh', ['Ln', 'x']],
    inputs: over('x', [-4, 9]),
  },
  {
    name: 'Abs(Ln(x))',
    json: ['Abs', ['Ln', 'x']],
    inputs: over('x', [-4, 0.5]),
  },
];

/** The programs that the structured route declines, with the mode, and
 *  the reason. Each one is checked in the tests of each mode. */
const DECLINED = new Map<string, RegExp>([
  // In the `complex` mode, a power with an exponent that is not a literal
  // and a type that is not real is complex (`_SYS.cpow`).
  [
    'x^y (complex)',
    /the power x\^y has the type number, which is not real, in the complex mode/,
  ],
  ['x^(y/2) (complex)', /the power .* has the type number, which is not real/],
  ['(-2)^y (complex)', /the power .* has the type number, which is not real/],
  // The value of `Ln(x)` is complex in the `complex` mode; `Max` has no
  // complex operand.
  [
    'Ln(Max(0, Ln(x))) (complex)',
    /Max with a complex operand is not in the structured route/,
  ],
  // The engine proves the operand non-negative (`real<0<..>` for `e^x`);
  // the rules of the route do not model `Exp`. In the `strict` mode only a
  // negative operand changes the result, so these compile there.
  [
    'Ln(Exp(x)) (complex)',
    /the engine knows that the operand e\^x of Ln is non-negative/,
  ],
  [
    'Sqrt(Exp(x)) (complex)',
    /the engine knows that the operand e\^x of Sqrt is non-negative/,
  ],
  // `Abs` admits a complex operand only when it is a name.
  [
    'Abs(Ln(x)) (complex)',
    /Abs of the complex operand ln\(x\) is in the structured route only when the operand is a name/,
  ],
]);

/**
 * The inputs where the interpreter and compiled code give different values
 * that the caveats of compiled code admit (docs/COMPILATION-MODEL.md,
 * "Caveats of compiled code"). Each entry is the program, the mode and the
 * input, with the value of compiled code; the structured route and the
 * existing emitter give it.
 *
 * - `Ln(-∞)`: the interpreter gives `+∞`. The exact value is `+∞ + iπ`,
 *   which the `complex` mode gives (`_SYS.cln`); the `strict` mode gives
 *   `NaN` for a value that is not real.
 * - `Abs(Ln(-4))` in the `strict` mode: `Ln(-4)` is not real, so the real
 *   lane gives `NaN` for it, and `Abs` of `NaN` is `NaN`; the interpreter
 *   gives `|ln 4 + iπ|`.
 */
const NOT_A_NUMBER: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['Ln(x) (strict) x=-Infinity', NaN],
  ['Ln(x) (complex) x=-Infinity', { re: Infinity, im: Math.PI }],
  ['Abs(Ln(x)) (strict) x=-4', NaN],
]);

const inputsKey = (inputs: Inputs) =>
  Object.entries(inputs)
    .map(
      ([k, v]) =>
        `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
    )
    .join(',');

/** `v` is not a number: `NaN`, or a complex value with a `NaN` part. The
 *  interpreter gives a complex `NaN` for `sin(∞)` in the `complex` mode,
 *  where compiled code gives the number `NaN`. */
const notANumber = (v: unknown) =>
  typeof v === 'number'
    ? Number.isNaN(v)
    : typeof v === 'object' &&
      v !== null &&
      (Number.isNaN((v as { re: number }).re) ||
        Number.isNaN((v as { im: number }).im));

/** `v` is the value of `ComplexInfinity` (two infinite parts): the
 *  interpreter gives it for `0^e` with `e < 0`, where compiled code gives
 *  `±Infinity` (the caveats of compiled code). */
const complexInfinity = (v: unknown) =>
  typeof v === 'object' &&
  v !== null &&
  Math.abs((v as { re: number }).re) === Infinity &&
  Math.abs((v as { im: number }).im) === Infinity;

function make(ce: ComputeEngine, program: Program): Expression {
  return ce.expr(program.json);
}

function checkProgram(program: Program, mode: Mode) {
  const ce = engine();
  const expr = make(ce, program);
  const key = `${program.name} (${mode})`;
  const declined = DECLINED.get(key);
  if (declined !== undefined) {
    expect(() => structured().compile(expr, { ...OPTIONS, mode })).toThrow(
      declined
    );
    return;
  }
  const result = structured().compile(expr, { ...OPTIONS, mode });
  const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
  for (const inputs of program.inputs) {
    const value = result.run!(inputs as never);
    const expected = interpret(ce, expr, inputs);
    const exception = NOT_A_NUMBER.get(`${key} ${inputsKey(inputs)}`);
    const agrees =
      close(value, expected) ||
      (notANumber(value) && notANumber(expected)) ||
      (mode === 'strict' && Number.isNaN(value) && nonReal(expected)) ||
      (complexInfinity(expected) && Math.abs(value as number) === Infinity) ||
      (exception !== undefined && close(value, exception));
    expect([inputs, value, expected, agrees]).toEqual([
      inputs,
      value,
      expected,
      true,
    ]);
    const other = existing.run!(inputs as never);
    expect([inputs, value, other, exact(value, other)]).toEqual([
      inputs,
      value,
      other,
      true,
    ]);
  }
}

describe('the total functions and Power, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of TOTAL_PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

describe('Ln, and Sqrt of the new heads, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of LN_PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

//
// The facts of the rules and isComplexValued()
//

const FACT_HEADS = new Set([
  'Sqrt',
  'Ln',
  'Power',
  'Sin',
  'Cos',
  'Tanh',
  'Abs',
  'Arctan2',
]);

/** The value facts of every node of `FACT_HEADS` of the annotation of
 *  `expr` on the structured route: true for a complex fact. */
function functionFacts(expr: Expression, mode: Mode): Map<Expression, boolean> {
  const preparation = structured().prepareStructured(expr, {
    ...OPTIONS,
    mode,
  });
  const result = new Map<Expression, boolean>();
  const visit = (scope: FragmentScope<string>) => {
    for (const [node, facts] of scope.facts)
      if (
        isFunction(node) &&
        FACT_HEADS.has(node.operator) &&
        'representation' in facts
      )
        result.set(node, facts.representation === 'complex');
    for (const inner of scope.inner.values()) visit(inner);
  };
  visit(preparation.annotation.scope as FragmentScope<string>);
  for (const fn of preparation.annotation.functions.values())
    visit(fn.scope as FragmentScope<string>);
  return result;
}

/** The answers of `isComplexValued()` for each node that the ordinary
 *  JavaScript compiler asks about while it compiles `expr`. */
function ordinaryAnswers(
  expr: Expression,
  options: Parameters<typeof compile>[1]
) {
  const answers = new Map<Expression, Set<boolean>>();
  const reader = core.isComplexValued;
  const record = (node: Expression, answer: boolean) => {
    if (CompilerState._compileDepth === 0) return;
    const set = answers.get(node) ?? new Set<boolean>();
    set.add(answer);
    answers.set(node, set);
  };
  jest.spyOn(core, 'isComplexValued').mockImplementation((node) => {
    const answer = reader(node);
    record(node, answer);
    return answer;
  });
  const emit = core.compileWithCse;
  jest
    .spyOn(core, 'compileWithCse')
    .mockImplementation((node, target, prec) => {
      record(node, reader(node));
      return emit(node, target, prec);
    });
  try {
    compile(expr, options);
  } finally {
    jest.restoreAllMocks();
  }
  return answers;
}

test('the facts of the rules equal isComplexValued(), or the program declines', () => {
  const differences: string[] = [];
  const declines: string[] = [];
  let compared = 0;
  for (const mode of MODES)
    for (const program of [...TOTAL_PROGRAMS, ...LN_PROGRAMS]) {
      const ce = engine();
      const expr = make(ce, program);
      let facts: Map<Expression, boolean>;
      try {
        facts = functionFacts(expr, mode);
      } catch {
        declines.push(`${program.name} (${mode})`);
        continue;
      }
      const answers = ordinaryAnswers(expr, {
        ...OPTIONS,
        mode,
        fallback: false,
      });
      for (const [node, complex] of facts) {
        const answer = answers.get(node);
        const where = `${program.name} (${mode}): ${node.toString()}`;
        if (answer === undefined) {
          differences.push(`${where}: not asked`);
          continue;
        }
        compared += 1;
        if (answer.size !== 1 || !answer.has(complex))
          differences.push(
            `${where}: fact ${complex}, isComplexValued ${[...answer].join('/')}`
          );
      }
    }
  expect(differences).toEqual([]);
  expect(declines).toEqual([...DECLINED.keys()]);
  expect(compared).toBeGreaterThan(100);
});

//
// Refusals
//

describe('refusals', () => {
  const REFUSALS: [string, MathJsonExpression, Mode, RegExp][] = [
    // `Sin(Multiply(Pi, x))` is admitted (`_SYS.sinpi(x)`,
    // compile-javascript-structured-functions2.test.ts); a product of three
    // factors is not.
    [
      'Sin of a multiple of Pi with three factors',
      ['Sin', ['Multiply', 'Pi', 'x', 'y']],
      'strict',
      /Sin of an operand that reads Pi is in the structured route only as Multiply\(Pi, u\)/,
    ],
    [
      'Cos of Pi/x',
      ['Cos', ['Divide', 'Pi', 'x']],
      'strict',
      /Cos of an operand that reads Pi/,
    ],
    [
      'Exp of a number literal',
      ['Add', 'x', ['Exp', 2]],
      'strict',
      /the exponential of the number literal 2 is not in the structured route/,
    ],
    // `knownExponentPower()` replaces an exponent of constants and assigned
    // symbols by a value that is not an integer.
    [
      'Exp of a captured binding',
      ['Add', ['Exp', 'offset'], 'x'],
      'strict',
      /the exponential of "?offset"?, which reads no input, parameter or local/,
    ],
    // `Pi` is not replaced (no assigned symbol), and the existing emitter
    // writes `Math.exp(Math.PI)`: the rule of the route is wider.
    [
      'Exp of a constant',
      ['Add', ['Exp', 'Pi'], 'x'],
      'strict',
      /the exponential of pi, which reads no input/,
    ],
    // `Sqrt(2)` is a number literal in the canonical form.
    [
      'Exp of Sqrt(2)',
      ['Add', ['Exp', ['Sqrt', 2]], 'x'],
      'strict',
      /the exponential of the number literal sqrt\(2\)/,
    ],
    [
      'Exp of x + i·π·y',
      ['Exp', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'Pi', 'y']]],
      'strict',
      /the exponential of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    // The existing emitter writes `_SYS.cexppi(x)`.
    [
      'Exp of i·π·x',
      ['Exp', ['Multiply', 'ImaginaryUnit', 'Pi', 'x']],
      'strict',
      /the exponential of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    // `realRadicalPower()`: `_SYS.pow5h(b)` for a base proved non-negative.
    [
      'Max(0, x)^2.5',
      ['Power', ['Max', 0, 'x'], 2.5],
      'strict',
      /Power with the exponent 2\.5 of a base that is proved non-negative is not in the structured route/,
    ],
    [
      'x^1.5, complex mode',
      ['Power', 'x', 1.5],
      'complex',
      /only for a base that it proves non-negative, and not for x \(the complex mode\)/,
    ],
    [
      'z^π',
      ['Power', 'z', 'Pi'],
      'strict',
      /Power with a complex operand and the exponent .* which has no unknown/,
    ],
    [
      'x^(1 + 2i)',
      ['Power', 'x', ['Complex', 1, 2]],
      'strict',
      /Power with the exponent \(1 \+ 2i\) is not in the structured route, which has a finite real number literal exponent, an exponent that is not a number literal, and the base ExponentialE/,
    ],
    // The branches of `Power` in the existing emitter that the route
    // declines, one row each.
    // An integer literal exponent: `realRadicalPower()` reads through a
    // square root (`Sqrt(p)^3` is `p * Math.sqrt(p)`), and an integer beyond
    // the safe integers is declined. (`x^0` and `x^-1` do not reach
    // `Power`: their canonical forms are `1` and `1/x`.)
    [
      'Sqrt(p)^3',
      ['Power', ['Sqrt', 'p'], 3],
      'strict',
      /the power sqrt\(p\)\^3 of a square root is not in the structured route/,
    ],
    [
      'x^(2^60)',
      ['Power', 'x', 2 ** 60],
      'strict',
      /an integer beyond the safe integers, is not in the structured route/,
    ],
    // The float `0.5` has the even recovered denominator 2: `Math.sqrt`.
    [
      'x^0.5',
      ['Power', 'x', 0.5],
      'strict',
      /Power with the exponent 0\.5 is not in the structured route: the existing emitter writes Math\.sqrt/,
    ],
    // An exact rational exponent with an odd denominator
    // (`realPowerExponent()` reads its terms).
    [
      'x^(8/5)',
      ['Power', 'x', ['Rational', 8, 5]],
      'strict',
      /Power with the exact exponent 8\/5, whose denominator is odd, is not in the structured route/,
    ],
    // `Math.cbrt` for the float `1/3` and a base that the engine proves
    // non-negative.
    [
      'p^(1/3 as a float)',
      ['Power', 'p', 1 / 3],
      'strict',
      /Power with the exponent 0\.3333333333333333 is not in the structured route: the existing emitter writes Math\.cbrt/,
    ],
    // A float exponent with an even recovered denominator: `_SYS.cpow` in
    // the `complex` mode for a base that the route does not prove
    // non-negative.
    [
      'x^0.3, complex mode',
      ['Power', 'x', 0.3],
      'complex',
      /Power with the exponent 0\.3 is in the structured route only for a base that it proves non-negative, and not for x \(the complex mode\)/,
    ],
    // `realRadicalPower()`: `_SYS.pow2(Math.cbrt(x))`.
    [
      'x^(2/3) as a float',
      ['Power', 'x', 2 / 3],
      'strict',
      /Power with the exponent 2\/3 is not in the structured route/,
    ],
    // `(1 / Math.sqrt(x))`.
    [
      'x^-0.5',
      ['Power', 'x', -0.5],
      'strict',
      /Power with the exponent -0\.5 is not in the structured route: the existing emitter writes the reciprocal of Math\.sqrt/,
    ],
    // Two finite literals fold to `Math.pow(b, e)`, as on the existing
    // emitter: compile-javascript-structured-literals-block.test.ts.
    // A complex base or exponent that is not a number literal:
    // `_SYS.cpow`, compile-javascript-structured-scalar2.test.ts.
    // An exponent with no unknown. The rule declines each one; the existing
    // compiler replaces only an exponent that reads an assigned symbol and
    // has a value that is not an integer (`knownExponentPower()`), so for
    // these two rows it writes `_SYS.pow`.
    [
      'x^offset',
      ['Power', 'x', 'offset'],
      'strict',
      /the exponent "?offset"? of Power has no unknown/,
    ],
    [
      'x^Pi',
      ['Power', 'x', 'Pi'],
      'strict',
      /the exponent pi of Power has no unknown/,
    ],
    // The `complex` mode, a node whose type is not real: `_SYS.cpow`.
    [
      'x^y, complex mode',
      ['Power', 'x', 'y'],
      'complex',
      /the power x\^y has the type number, which is not real, in the complex mode: the existing emitter writes the complex power/,
    ],
    [
      'Abs of a complex sum',
      ['Abs', ['Add', 'z', 1]],
      'strict',
      /Abs of the complex operand .* is in the structured route only when the operand is a name/,
    ],
    [
      'Arctan2 with a complex operand',
      ['Arctan2', 'z', 'x'],
      'strict',
      /Arctan2 with a complex operand is not in the structured route/,
    ],
    [
      'Tanh of i·π·x, complex mode',
      ['Tanh', ['Multiply', 'ImaginaryUnit', 'Pi', 'x']],
      'complex',
      /Tanh of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    // `assume(a > 0)`: the engine knows that `-a` is negative; the rules of
    // the route do not model `Negate`.
    [
      'Ln of a negative operand that the engine finds and the rule does not',
      ['Ln', ['Negate', 'a']],
      'strict',
      /the engine knows that the operand -a of Ln is negative/,
    ],
    [
      'Sech of a real operand, not in the route',
      ['Sech', 'x'],
      'strict',
      /Sech of a real operand is not in the structured route/,
    ],
    // The existing emitter folds the power of two finite number literals to
    // the literal `Math.pow(b, e)`, whatever `constantFold` is, and the
    // route writes the same literal: `x + 10^1.5` is `x + 31.622776601683793`
    // (compile-javascript-structured-literals-block.test.ts).
    // The existing emitter writes the radicand itself for a square of a
    // square root of a non-negative operand; the product of two square roots
    // is another double.
    [
      'the square of a square root',
      ['Power', ['Sqrt', ['Max', 0, 'x']], 2],
      'strict',
      /the square of the square root .* is not in the structured route/,
    ],
  ];
  test.each(REFUSALS)('%s', (_name, json, mode, message) => {
    const ce = engine();
    expect(() =>
      structured().compile(ce.expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });

  // In the `strict` mode a scalar function of a list is admitted since
  // slice 1 of docs/plans/2026-11-12-structured-broadcast-over-lists.md
  // (compile-javascript-structured-broadcast.test.ts); the `complex` mode
  // declines it.
  test('a list operand declines in the complex mode', () => {
    const ce = engine();
    for (const [head, json] of [
      ['Exp', ['Exp', 'L']],
      ['Sin', ['Sin', 'L']],
      ['Ln', ['Ln', 'L']],
      ['Abs', ['Abs', 'L']],
      ['Arctan2', ['Arctan2', 'L', 1]],
      ['Power', ['Power', 'L', 1.5]],
    ] as [string, MathJsonExpression][]) {
      const fn = ce.expr([
        'Function',
        ['Block', json],
        typed('L', 'list<real>'),
      ]);
      const message =
        head === 'Exp'
          ? /Power with the list operand L is not in the structured route/
          : new RegExp(
              `${head} with the list operand L is not in the structured route`
            );
      expect(() =>
        structured().compile(fn, { ...OPTIONS, mode: 'complex' })
      ).toThrow(message);
    }
  });

  test('a shadowed function name (a user function of that name) declines', () => {
    for (const name of ['Abs', 'Tanh', 'Ln', 'Arctan2']) {
      const two = name === 'Arctan2';
      const ce = new ComputeEngine();
      ce.precision = 'machine';
      const { diagnostics } = executeEpsil(
        ce,
        `function ${name}(a: real${two ? ', c: real' : ''}) -> real { a + 1 }
function f(x: real) -> real { ${name}(x${two ? ', x' : ''}) }`
      );
      expect(diagnostics).toEqual([]);
      const fn = literal(ce, 'f');
      expect(JSON.stringify(fn.json)).toContain(`["${name}"`);
      // The head is not the operator of the library: its rule does not
      // apply, and the head is refused.
      expect(() => structured().compile(fn, OPTIONS)).toThrow(
        new RegExp(`unsupported (bound )?head ${name}`)
      );
    }
  });
});

//
// The existing readers are not called from preparation to emission
//

describe('the existing readers are not called from preparation to emission', () => {
  const READERS: [object, string][] = [
    [core, 'isComplexValued'],
    [core, 'staticTypeOf'],
    [core, 'userFunctionParamLanes'],
    [core, 'compile'],
    [BaseCompiler, 'compileCseRoot'],
  ];
  for (const mode of MODES)
    test(`${mode} mode: heatseed and a program of Ln, Tanh, Abs and Arctan2`, () => {
      const heat = engineWithPrelude(HEAT_PRELUDE);
      const ce = engine();
      const programs: [() => Expression, ComputeEngine, unknown[] | Inputs][] =
        [
          [() => literal(heat, 'heatseed'), heat, []],
          [
            () =>
              ce.expr([
                'Add',
                ['Ln', ['Add', ['Abs', 'x'], 1]],
                ['Tanh', 'y'],
                ['Arctan2', 'y', 'x'],
                ['Power', ['Max', 0, 'x'], 1.5],
              ]),
            ce,
            { x: -2, y: 0.5 },
          ],
        ];
      for (const [make, owner, inputs] of programs) {
        const expr = make();
        const phases: StructuredPhase[] = [];
        const onPhase = (phase: StructuredPhase) => {
          phases.push(phase);
          if (phase === 'preparation')
            for (const [object, name] of READERS)
              jest
                .spyOn(object as never, name as never)
                .mockImplementation((() => {
                  throw new Error(
                    `${name} called from preparation to emission`
                  );
                }) as never);
          if (phase === 'emission') jest.restoreAllMocks();
        };
        let result: CompilationResult<'javascript'>;
        try {
          result = structured({ onPhase }).compile(expr, { ...OPTIONS, mode });
        } finally {
          jest.restoreAllMocks();
        }
        expect(phases).toEqual([
          'preparation',
          'annotation',
          'lowering',
          'verification',
          'emission',
          'assembly',
        ]);
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        const value = Array.isArray(inputs)
          ? runArgs(result, inputs)
          : result.run!(inputs as never);
        const expected = Array.isArray(inputs)
          ? runArgs(existing, inputs)
          : existing.run!(inputs as never);
        expect(owner).toBeDefined();
        expect(value).toEqual(expected);
      }
    });
});

//
// The representation
//

/** The operations of `region` and of the regions nested in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

describe('the representation', () => {
  test('one operation kind per arity, with the function named by an identifier', () => {
    const ce = engine();
    const expr = ce.expr([
      'Add',
      ['Exp', 'x'],
      ['Sin', 'x'],
      ['Cos', 'x'],
      ['Tanh', 'x'],
      ['Abs', 'x'],
      ['Ln', 'p'],
      ['Arctan2', 'y', 'x'],
    ]);
    const program = lowerStructuredFragment(
      structured().prepareStructured(expr, { ...OPTIONS, mode: 'strict' })
    );
    const functions = allOperations(program.root)
      .filter((op) => op.kind === 'unary' || op.kind === 'binary')
      .map((op) => `${op.kind} ${(op as { fn: string }).fn} ${op.effect}`)
      .sort();
    expect(functions).toEqual([
      'binary atan2 pure',
      'unary abs pure',
      'unary cos pure',
      'unary exp pure',
      'unary ln pure',
      'unary sin pure',
      'unary tanh pure',
    ]);
  });

  test('Power with an exponent that is not a literal, and with a float literal exponent: the functions pow, abs-pow and signed-pow', () => {
    const ce = engine();
    const expr = ce.expr([
      'Add',
      ['Power', 'x', 'y'],
      ['Power', 'x', 1.6],
      ['Power', 'x', 1.4],
    ]);
    const program = lowerStructuredFragment(
      structured().prepareStructured(expr, { ...OPTIONS, mode: 'strict' })
    );
    const functions = allOperations(program.root)
      .filter((op) => op.kind === 'binary')
      .map((op) => `${(op as { fn: string }).fn} ${op.effect}`)
      .sort();
    expect(functions).toEqual(['abs-pow pure', 'pow pure', 'signed-pow pure']);
    // The base of `signed-pow` is read twice: it is bound once.
    const result = structured().compile(ce.expr(['Power', ['Add', 'x', 1], 1.4]), OPTIONS);
    expect(result.code.match(/_\.x/g)).toHaveLength(1);
  });

  test('Power(b, 1.5) is the product of the base and its square root, the base evaluated once', () => {
    const ce = engine();
    const result = structured().compile(
      ce.expr(['Power', ['Max', 0, 'x'], 1.5]),
      OPTIONS
    );
    expect(result.code).toMatch(/Math\.max\(0, _\.x\)/);
    expect(result.code.match(/Math\.max/g)?.length).toBe(1);
    expect(result.code).toMatch(/Math\.sqrt/);
  });

  test('Abs of an operand proved non-negative is the operand, as on the existing route: -0 stays -0', () => {
    const ce = engine();
    for (const mode of MODES) {
      // `p: real<0..>`: the existing emitter writes `p` itself.
      const proved = ce.expr(['Divide', 1, ['Abs', 'p']]);
      const result = structured().compile(proved, { ...OPTIONS, mode });
      const existing = compile(proved, { ...OPTIONS, mode, fallback: false });
      expect(result.code).not.toContain('Math.abs');
      for (const p of [-0, 0, 4])
        expect(
          exact(result.run!({ p } as never), existing.run!({ p } as never))
        ).toBe(true);
      expect(result.run!({ p: -0 } as never)).toBe(-Infinity);
      // `x: real`: `Math.abs` on both routes, `Infinity` at -0.
      const unknown = ce.expr(['Divide', 1, ['Abs', 'x']]);
      const other = structured().compile(unknown, { ...OPTIONS, mode });
      expect(other.code).toContain('Math.abs');
      expect(
        exact(
          other.run!({ x: -0 } as never),
          compile(unknown, { ...OPTIONS, mode, fallback: false }).run!({
            x: -0,
          } as never)
        )
      ).toBe(true);
      expect(other.run!({ x: -0 } as never)).toBe(Infinity);
    }
  });

  test('Abs of an integer has an integer fact; a loop bound can read it', () => {
    const ce = engine();
    const fn = ce.expr([
      'Function',
      [
        'Block',
        ['Declare', 's', "'integer'", 0],
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'j']],
          ['Element', 'j', ['Range', 1, ['Abs', 'm']]],
        ],
        's',
      ],
      typed('m', 'integer'),
    ]);
    const result = structured().compile(fn, OPTIONS);
    const existing = compile(fn, { ...OPTIONS, fallback: false });
    for (const m of [-4, 3])
      expect(runArgs(result, [m])).toBe(runArgs(existing, [m]));
    expect(runArgs(result, [-4])).toBe(10);
  });
});

//
// The preludes
//

/** An engine that has executed the prelude `source` with `executeEpsil()`,
 *  with machine numbers, so that the interpreter rounds as compiled code
 *  does. */
function engineWithPrelude(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const { diagnostics } = executeEpsil(ce, source);
  expect(diagnostics).toEqual([]);
  return ce;
}

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as
    { operator?: { _lambdaLiteral?: Expression } } | undefined;
  const fn = definition?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

function runArgs(
  result: CompilationResult<'javascript'>,
  args: readonly unknown[]
): unknown {
  const value = (result.run as unknown as (...a: unknown[]) => unknown)(
    ...args
  );
  return Array.isArray(value) ? [...value] : value;
}

type Arg = number | readonly number[];

function boxArg(ce: ComputeEngine, v: Arg): Expression {
  return typeof v === 'number'
    ? ce.number(v)
    : ce.function(
        'List',
        v.map((x) => ce.number(x))
      );
}

/** The value of the call of `name` on `args` by the interpreter: a number,
 *  or the numbers of a list. */
function interpretCall(
  ce: ComputeEngine,
  name: string,
  args: readonly Arg[]
): number | number[] {
  const value = ce
    .function(
      name,
      args.map((v) => boxArg(ce, v))
    )
    .evaluate();
  if (value.type.matches('number')) return value.N().re;
  const list = value as Expression & { each(): Generator<Expression> };
  return [...list.each()].map((x) => x.N().re);
}

/** Compile `name` of the engine `ce` on both routes and compare each with
 *  the interpreter on each list of arguments, element by element within
 *  1e-12 relative. */
function preludeDifferential(
  ce: ComputeEngine,
  name: string,
  cases: readonly (readonly Arg[])[]
) {
  const fn = literal(ce, name);
  const result = structured().compile(fn, OPTIONS);
  const existing = compile(fn, { ...OPTIONS, fallback: false });
  for (const args of cases) {
    const value = runArgs(result, args);
    const expected = interpretCall(ce, name, args);
    const values = Array.isArray(value) ? value : [value];
    const wanted = Array.isArray(expected) ? expected : [expected];
    expect([args.length, values.length]).toEqual([args.length, wanted.length]);
    const far = values.flatMap((v, i) =>
      close(v, wanted[i]) ? [] : [[i, v, wanted[i]]]
    );
    expect(far).toEqual([]);
    const other = runArgs(existing, args);
    const others = Array.isArray(other) ? other : [other];
    expect(
      values.flatMap((v, i) => (exact(v, others[i]) ? [] : [[i, v, others[i]]]))
    ).toEqual([]);
  }
  return result;
}

/** The part of the prelude of Tycho's heat showcase that `heatseed` reads,
 *  copied from `~/dev/tycho/src/graph-paper/onboarding/showcase-heat.js`
 *  (`HEAT_ENTRY.prelude`). */
const HEAT_PRELUDE = `
const N = 32
function heatseed() -> list<real> {
  [exp(-((((k - 1) % N) - 9)^2 + (floor((k - 1)/N) - 15.5)^2)/32) for k in 1..N^2]
}
`;

/** The prelude of Tycho's traffic showcase, copied from
 *  `~/dev/tycho/src/graph-paper/onboarding/showcase-traffic.js`
 *  (`TRAFFIC_ENTRY.prelude`). */
const TRAFFIC_PRELUDE = `// Positions (metres), then speeds (metres/second), on a 240 m ring.
// Each step reads the OLD state for every driver: updates are simultaneous.
const L = 240
const N = 24
const W = 80
function roadseed(p: real) -> list<real> {
  [if k <= N { (k - 1)*L/N + if k == 1 { p } else { 0 } } else { 5 } for k in 1..2*N]
}
const S_0 = roadseed(1)
function roadstart(S: list<real>) -> list<real> {
  [S[1 + Mod(k - 1, N)] for k in 1..N*W]
}
const H_0 = roadstart(S_0)
function roadstep(S: list<real>, a: real, v: real) -> list<real> {
  let R = [0.0 for k in 1..2*N]
  let j = 0
  let gap = 0.0
  let target = 0.0
  let speed = 0.0
  for k in 1..N {
    j = 1 + Mod(k, N)
    gap = max(0, Mod(S[j] - S[k], L) - 4)
    target = v*(tanh((gap - 8)/3) + tanh(8/3))/(1 + tanh(8/3))
    speed = min(gap/0.1, max(0, S[N+k] + 0.1*a*(target - S[N+k])))
    R = replaceAt(R, k, Mod(S[k] + 0.1*speed, L))
    R = replaceAt(R, N+k, speed)
  }
  R
}
// Oldest positions first. The last row receives the new state.
function roadtrail(H: list<real>, S: list<real>) -> list<real> {
  [if k <= N*(W-1) { H[k+N] } else { S[k-N*(W-1)] } for k in 1..N*W]
}
`;

/** The function \`tone\` of the prelude of Tycho's Buddhabrot showcase,
 *  copied from \`~/dev/tycho/src/graph-paper/onboarding/template-data.js\`
 *  (the entry \`buddhabrot\`). The rest of that prelude is left out: its
 *  value statement runs 1.2 million samples when the prelude executes. */
const TONE_PRELUDE = `
// One channel of the colour: a ratio of counts to the power 1.5, between lo
// and 1. The base is max(0, v): see the comment of the entry.
function tone(v: real, lo: real) -> real { min(1, max(lo, max(0, v)^1.5)) }
`;

describe('the prelude functions that compile with these functions', () => {
  test('heatseed: element by element, against the interpreter', () => {
    const ce = engineWithPrelude(HEAT_PRELUDE);
    const result = preludeDifferential(ce, 'heatseed', [[]]);
    expect(result.code).toContain('Math.exp(');
    const seed = runArgs(result, []) as number[];
    expect(seed.length).toBe(1024);
    // The hot spot is at column 9, row 15 (0-based): the cell 1 + 9 + 32·15.
    expect(seed[9 + 32 * 15]).toBeCloseTo(Math.exp(-0.25 / 32), 15);
  });

  test('roadstep: three steps from the seed, at three responses', () => {
    const ce = engineWithPrelude(TRAFFIC_PRELUDE);
    const seed = runArgs(
      compile(literal(ce, 'roadseed'), { ...OPTIONS, fallback: false }),
      [1]
    ) as number[];
    const result = preludeDifferential(ce, 'roadstep', [
      [seed, 0.7, 14],
      [seed, 2, 22],
      [seed.map((s, i) => (i < 24 ? s + (i % 3) : s)), 0.2, 5],
    ]);
    expect(result.code).toContain('Math.tanh(');
    // Three steps: each reads the state of the one before.
    let state: readonly number[] = seed;
    for (let i = 0; i < 3; i++)
      state = runArgs(result, [state, 0.7, 14]) as number[];
    expect(state.length).toBe(48);
  });

  test('tone: ordinary values, 0, negative, large, ±Infinity and NaN', () => {
    const ce = engineWithPrelude(TONE_PRELUDE);
    const result = preludeDifferential(ce, 'tone', [
      [0.25, 0.1],
      [0, 0.16],
      [-3, 0.33],
      [0.5, 0.9],
      [1e6, 0.1],
      [0.04, 0],
    ]);
    // ±Infinity and NaN: the interpreter is not called (it gives `NaN` for
    // `Max(lo, NaN)`, and the routes agree).
    for (const v of [Infinity, -Infinity, NaN])
      expect(runArgs(result, [v, 0.1])).toEqual(
        runArgs(compile(literal(ce, 'tone'), { ...OPTIONS, fallback: false }), [
          v,
          0.1,
        ])
      );
    expect(result.code).toContain('Math.sqrt(');
  });
});

//
// The branches of the existing emitter: each program compiles and gives
// the value of the existing emitter exactly, or declines with its message
//

/** The inputs of a row: every free symbol of the programs, with `-0`
 *  components and the other values at which a branch matters. */
const BRANCH_INPUTS: Inputs[] = [
  {
    x: -0,
    y: 0,
    z: { re: -3, im: -0 },
    w: { re: 1, im: 2 },
    k: 0,
    p: -0,
    q: 0,
    r: 2,
    m: 0,
  },
  {
    x: -2.5,
    y: -0,
    z: { re: -0, im: 1.5 },
    w: { re: -0, im: -0 },
    k: -3,
    p: 0,
    q: 3,
    r: 0.5,
    m: 7,
  },
  {
    x: 3,
    y: 1.25,
    z: { re: 2, im: -0.5 },
    w: { re: -1, im: 0 },
    k: 9,
    p: 2.25,
    q: 1,
    r: 4,
    m: 100,
  },
];

/** A row: the program, and `undefined` when it compiles in both modes or
 *  the message of its refusal (in both modes, or in the mode named). */
type BranchRow = [
  name: string,
  json: MathJsonExpression,
  refusal?: RegExp | Partial<Record<Mode, RegExp>>,
];

const BRANCH_ROWS: BranchRow[] = [
  // Complex Add: a real operand adds to the real part only, a complex
  // literal gives its parts as constants, a `0` part is dropped.
  ['Ln(z + 1)', ['Ln', ['Add', 'z', 1]]],
  ['x + i', ['Add', 'x', ['Complex', 0, 1]]],
  ['z + 1 + x', ['Add', 'z', 1, 'x']],
  ['x + z + y', ['Add', 'x', 'z', 'y']],
  ['z + 2i', ['Add', 'z', ['Complex', 0, 2]]],
  ['z + w', ['Add', 'z', 'w']],
  ['z + (1 + 2i)', ['Add', 'z', ['Complex', 1, 2]]],
  ['z + offset', ['Add', 'z', 'offset']],
  ['z + Sqrt(p)', ['Add', 'z', ['Sqrt', 'p']]],
  ['-x + z', ['Add', ['Negate', 'x'], 'z']],
  // Complex Multiply: a real operand is not converted.
  ['z · w', ['Multiply', 'z', 'w']],
  ['(1 + 2i) · z', ['Multiply', ['Complex', 1, 2], 'z']],
  ['x · z', ['Multiply', 'x', 'z']],
  // Negate of a real operand, converted by its parent.
  ['Ln(-x)', ['Ln', ['Negate', 'x']]],
  ['-z', ['Negate', 'z']],
  // Comparisons: a literal, a capture, a node whose type is a value.
  ['x < 2', ['Less', 'x', 2]],
  ['offset < x', ['Less', 'offset', 'x']],
  // A comparison of closed exact operands is the literal of the fold of the
  // existing compiler (`closedJumpFold()`).
  [
    'If(nearThird < third, x, -x)',
    ['If', ['Less', 'nearThird', 'third'], 'x', ['Negate', 'x']],
  ],
  [
    '0 <= p·q·r',
    ['LessEqual', 0, ['Multiply', 'p', 'q', 'r']],
    /has the type true, and the existing compiler writes the literal true/,
  ],
  // As the condition of an `If`, it selects the branch `x`, which the
  // existing emitter writes alone (`decidedBranch()`).
  [
    'If(0 <= p·q·r, x, y)',
    ['If', ['LessEqual', 0, ['Multiply', 'p', 'q', 'r']], 'x', 'y'],
  ],
  ['Equal(k, 3)', ['Equal', 'k', 3]],
  // NotEqual: `!==`, as the existing emitter writes it, with the refusals
  // of Equal.
  ['NotEqual(k, 3)', ['NotEqual', 'k', 3]],
  ['NotEqual(x, y)', ['NotEqual', 'x', 'y']],
  ['NotEqual(k, x)', ['NotEqual', 'k', 'x']],
  [
    'If(nearThird != third, x, -x)',
    ['If', ['NotEqual', 'nearThird', 'third'], 'x', ['Negate', 'x']],
  ],
  [
    'NotEqual(z, w)',
    ['NotEqual', 'z', 'w'],
    /NotEqual with a complex operand is not in the structured route/,
  ],
  [
    'And(x < 1, 0 <= p)',
    ['And', ['Less', 'x', 1], ['LessEqual', 0, 'p']],
    /has the type true/,
  ],
  // Mod: the three cases of the existing emitter.
  ['Mod(k, 3)', ['Mod', 'k', 3]],
  ['Mod(x, 2.5)', ['Mod', 'x', 2.5]],
  [
    'Mod(k, 1) + x',
    ['Add', ['Mod', 'k', 1], 'x'],
    /Mod of the integer k and the literal divisor 1 is not in the structured route/,
  ],
  // A dividend that is not integer-valued: `_SYS.fract`.
  ['Mod(x, 1) + y', ['Add', ['Mod', 'x', 1], 'y']],
  ['Mod(x·y, 1)', ['Mod', ['Multiply', 'x', 'y'], 1]],
  [
    'Mod(m, 2)',
    ['Mod', 'm', 2],
    /Mod of m and 2, each a literal or of a type in integer<0..2\^53 - 1>, is not in the structured route/,
  ],
  ['x + Mod(seven, tenth)', ['Add', 'x', ['Mod', 'seven', 'tenth']]],
  // Floor.
  ['Floor(x)', ['Floor', 'x']],
  ['Floor(k)', ['Floor', 'k']],
  ['x + Floor(third)', ['Add', 'x', ['Floor', 'third']]],
  // Min, Max, Divide (not jump functions).
  ['Max(0, x) + Min(p, 3)', ['Add', ['Max', 0, 'x'], ['Min', 'p', 3]]],
  ['x / y', ['Divide', 'x', 'y']],
  // Sqrt and Ln: literal, non-negative, integer, bounded integer, capture,
  // nested operands.
  ['Sqrt(2.5) + x', ['Add', ['Sqrt', 2.5], 'x']],
  ['Sqrt(p)', ['Sqrt', 'p']],
  ['Sqrt(k)', ['Sqrt', 'k']],
  ['Sqrt(m)', ['Sqrt', 'm']],
  ['Sqrt(offset) + x', ['Add', ['Sqrt', 'offset'], 'x']],
  ['Sqrt(Abs(x))', ['Sqrt', ['Abs', 'x']]],
  ['Sqrt(Sqrt(p))', ['Sqrt', ['Sqrt', 'p']]],
  ['Sqrt(-p)', ['Sqrt', ['Negate', 'p']]],
  ['Ln(m)', ['Ln', 'm']],
  ['Ln(Abs(x))', ['Ln', ['Abs', 'x']]],
  ['Ln(Sqrt(p))', ['Ln', ['Sqrt', 'p']]],
  // Power.
  ['x^2', ['Power', 'x', 2]],
  ['k^2', ['Power', 'k', 2]],
  ['z^2', ['Power', 'z', 2]],
  ['Sqrt(x)^2', ['Power', ['Sqrt', 'x'], 2], /the square of the square root/],
  // The literal of the folded power, `Math.pow(1.1, 2)`.
  ['1.1^2 + x', ['Add', ['Power', 1.1, 2], 'x']],
  ['p^1.5', ['Power', 'p', 1.5]],
  ['Abs(x)^1.5', ['Power', ['Abs', 'x'], 1.5]],
  ['m^1.5', ['Power', 'm', 1.5]],
  ['x^y', ['Power', 'x', 'y'], { complex: /has the type number, which is not real/ }],
  ['p^y', ['Power', 'p', 'y']],
  ['q^x', ['Power', 'q', 'x']],
  ['x^k', ['Power', 'x', 'k']],
  ['m^k', ['Power', 'm', 'k']],
  ['2.5^x', ['Power', 2.5, 'x']],
  ['x^1.6', ['Power', 'x', 1.6]],
  ['x^1.4', ['Power', 'x', 1.4]],
  ['k^1.4', ['Power', 'k', 1.4]],
  ['Abs(x)^1.4', ['Power', ['Abs', 'x'], 1.4]],
  ['x^1.6 + z', ['Add', ['Power', 'x', 1.6], 'z']],
  ['Exp(x)', ['Exp', 'x']],
  ['Exp(k)', ['Exp', 'k']],
  ['Exp(-p)', ['Exp', ['Negate', 'p']]],
  // The functions.
  ['Sin(x) + Cos(k)', ['Add', ['Sin', 'x'], ['Cos', 'k']]],
  ['Tanh(m)', ['Tanh', 'm']],
  ['Abs(x)', ['Abs', 'x']],
  ['Abs(k)', ['Abs', 'k']],
  ['Abs(m)', ['Abs', 'm']],
  ['Abs(p)', ['Abs', 'p']],
  ['Abs(Sqrt(p))', ['Abs', ['Sqrt', 'p']]],
  ['Abs(-x)', ['Abs', ['Negate', 'x']]],
  ['Abs(z)', ['Abs', 'z']],
  ['Abs(-2.5) + x', ['Add', ['Abs', -2.5], 'x']],
  ['Arctan2(y, x)', ['Arctan2', 'y', 'x']],
  ['Arctan2(m, offset)', ['Arctan2', 'm', 'offset']],
];

describe('the branches of the existing emitter', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      // A rest parameter: with a third named parameter, Jest would read a
      // row of two elements as a test that waits for `done()`.
      test.each(BRANCH_ROWS)('%s', (...row) => {
        const [, json, refusal] = row;
        const ce = engine();
        const expr = ce.expr(json);
        const expected = refusal instanceof RegExp ? refusal : refusal?.[mode];
        if (expected !== undefined) {
          expect(() =>
            structured().compile(expr, { ...OPTIONS, mode })
          ).toThrow(expected);
          return;
        }
        const result = structured().compile(expr, { ...OPTIONS, mode });
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const inputs of BRANCH_INPUTS) {
          const value = outcomeOf(() => result.run!(inputs as never));
          const other = outcomeOf(() => existing.run!(inputs as never));
          expect([inputs, value, other, exact(value, other)]).toEqual([
            inputs,
            value,
            other,
            true,
          ]);
        }
      });
    });
});

/** The value of `f`, or the message of its throw. */
function outcomeOf(f: () => unknown): unknown {
  try {
    return f();
  } catch (e) {
    return `throws ${String(e)}`;
  }
}
