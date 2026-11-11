import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { core } from '../../src/compute-engine/compilation/compiler-core-hooks';
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

// The scalar functions of the structured route of the internal JavaScript
// fragment target that the engine's own compilations need
// (docs/plans/2026-11-09-js-compiler-status-and-plan.md, "Next work, in
// order", item 1): `Tan`, `Cot`, `Sec`, `Csc`, `Sinh`, `Cosh`, `Arctan`,
// `Arsinh`, `Gamma`, `Erf`, `Erfc`, `Digamma`, `Haversine`, `Sign`,
// `Ceil`, `Round`, `Conjugate`, `Arcsin`, `Arccos`, `Arcosh`, `Artanh`,
// `Log`, and `Sin`, `Cos`, `Tan` of `Multiply(Pi, u)`.
//
// Each program is compiled on the structured route and compared with the
// interpreter (within 1e-12 relative, or by the caveats of compiled code,
// docs/COMPILATION-MODEL.md, "Caveats of compiled code"), and with the
// ordinary JavaScript compiler with `cse: false, constantFold: false`, the
// same doubles (`Object.is`), in the `strict` and `complex` modes. A name
// that the engine does not declare (`t`, `a`) has no declared type: the
// structured route reads it as a real number in the `strict` mode and a
// complex number in the `complex` mode.

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
    ['q', 'real<0..>'],
    ['n', 'real<..-1>'],
    ['s', 'real<-1..1>'],
  ])
    ce.declare(name, type);
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('third', 'real');
  ce.assign('third', ce.expr(['Rational', 1, 3]));
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

/** The value of `expr` on `inputs` by the interpreter: a number, or a
 *  complex `{re, im}`. */
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

const pair = (v: unknown) =>
  typeof v === 'number' ? { re: v, im: 0 } : (v as { re: number; im: number });

/** `a` and `b` are the same value within 1e-12 relative; a complex value
 *  with an imaginary part of 0 equals the number of its real part. An
 *  infinite part equals only the same infinity, and `NaN` only `NaN`. */
function close(a: unknown, b: unknown): boolean {
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

/** `a` and `b` are the same value, exactly: `Object.is` per number and per
 *  component of a complex value. */
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

const nonReal = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as { im: number }).im !== 0;

/** `v` is not a number: `NaN`, or a complex value with a `NaN` part. */
const notANumber = (v: unknown) =>
  typeof v === 'number'
    ? Number.isNaN(v)
    : typeof v === 'object' &&
      v !== null &&
      (Number.isNaN((v as { re: number }).re) ||
        Number.isNaN((v as { im: number }).im));

/** `v` is the value of `ComplexInfinity` (two infinite parts), which
 *  compiled code gives as `±Infinity` or `NaN` (the caveats of compiled
 *  code: a pole). */
const complexInfinity = (v: unknown) =>
  typeof v === 'object' &&
  v !== null &&
  Math.abs((v as { re: number }).re) === Infinity &&
  Math.abs((v as { im: number }).im) === Infinity;

test('control: the comparators', () => {
  expect(exact(0, -0)).toBe(false);
  expect(exact(NaN, NaN)).toBe(true);
  expect(exact({ re: 1, im: -0 }, { re: 1, im: 0 })).toBe(false);
  expect(close(1, 1 + 1e-14)).toBe(true);
  expect(close(1, 1.001)).toBe(false);
  expect(close({ re: 2, im: 0 }, 2)).toBe(true);
  expect(close({ re: 0, im: 2 }, 0)).toBe(false);
});

type Program = { name: string; json: MathJsonExpression; inputs: Inputs[] };

const SPECIAL = [
  -Infinity,
  -1e6,
  -2.5,
  -0.5,
  -0,
  0,
  1e-300,
  0.5,
  1,
  3,
  1e6,
  Infinity,
  NaN,
];
const over = (name: string, values: readonly Value[], extra: Inputs = {}) =>
  values.map((v) => ({ [name]: v, ...extra }));

/** The halves of integers and other multiples where `sinpi`, `cospi` and
 *  `tanpi` are exact. */
const HALF_TURNS = [-1, -0.5, -0, 0, 0.25, 0.5, 1, 1.5, 2, 3.7, 1000.5];

/** The programs of a real operand, every value of the domain. */
const REAL_PROGRAMS: Program[] = [
  {
    name: 'Tan(x)',
    json: ['Tan', 'x'],
    inputs: over('x', [...SPECIAL, 1.5]),
  },
  { name: 'Cot(x)', json: ['Cot', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Sec(x)', json: ['Sec', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Csc(x)', json: ['Csc', 'x'], inputs: over('x', SPECIAL) },
  {
    name: 'Sinh(x)',
    json: ['Sinh', 'x'],
    inputs: over('x', [...SPECIAL, 710, -710]),
  },
  {
    name: 'Cosh(x)',
    json: ['Cosh', 'x'],
    inputs: over('x', [...SPECIAL, 710, -710]),
  },
  { name: 'Arctan(x)', json: ['Arctan', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Arsinh(x)', json: ['Arsinh', 'x'], inputs: over('x', SPECIAL) },
  {
    name: 'Gamma(x)',
    json: ['Gamma', 'x'],
    inputs: over('x', [
      -Infinity,
      -2.5,
      -1,
      -0.5,
      -0,
      0,
      0.5,
      1,
      3,
      10.5,
      171.7,
      172,
      Infinity,
      NaN,
    ]),
  },
  { name: 'Gamma(k)', json: ['Gamma', 'k'], inputs: over('k', [-3, 0, 1, 5]) },
  {
    name: 'Erf(x)',
    json: ['Erf', 'x'],
    inputs: over('x', [...SPECIAL, 6, -6, 1e-10]),
  },
  {
    name: 'Erfc(x)',
    json: ['Erfc', 'x'],
    inputs: over('x', [...SPECIAL, 6, -6, 27]),
  },
  {
    name: 'Digamma(x)',
    json: ['Digamma', 'x'],
    inputs: over('x', [-2.5, -1, -0, 0, 0.5, 1, 3, 1e6, Infinity, NaN]),
  },
  {
    name: 'Haversine(x)',
    json: ['Haversine', 'x'],
    inputs: over('x', [...SPECIAL, Math.PI]),
  },
  {
    name: 'Haversine(x + 1)',
    json: ['Haversine', ['Add', 'x', 1]],
    inputs: over('x', [-1, 0, 2]),
  },
  // The parent needs parentheses around the code of `Haversine`, and the
  // operand is an input: the existing emitter binds it, so both routes
  // give `(x - 1) · ((1 - cos x) / 2)`.
  {
    name: '(x - 1) Haversine(x)',
    json: ['Multiply', ['Add', 'x', -1], ['Haversine', 'x']],
    inputs: over('x', [-2, 0, 1, 3, 1e6]),
  },
  { name: 'Sign(x)', json: ['Sign', 'x'], inputs: over('x', SPECIAL) },
  { name: 'Sign(k)', json: ['Sign', 'k'], inputs: over('k', [-4, 0, 9]) },
  {
    name: 'Sign(Cos(x))',
    json: ['Sign', ['Cos', 'x']],
    inputs: over('x', [0, 2, 4]),
  },
  {
    name: 'Ceil(x)',
    json: ['Ceil', 'x'],
    inputs: over('x', [...SPECIAL, -0.25, 2 ** 52 + 0.5, 2 ** 53]),
  },
  {
    name: 'Round(x)',
    json: ['Round', 'x'],
    inputs: over('x', [
      ...SPECIAL,
      -2.5,
      -1.5,
      1.5,
      2.5,
      -0.25,
      0.49999999999999994,
      4503599627370497,
    ]),
  },
  {
    name: 'Round(x / 2) + Ceil(y)',
    json: ['Add', ['Round', ['Divide', 'x', 2]], ['Ceil', 'y']],
    inputs: over('x', [-5, 3, 7], { y: -0.5 }),
  },
  {
    name: 'Conjugate(x)',
    json: ['Conjugate', 'x'],
    inputs: over('x', [-0, 0, -2.5, Infinity, NaN]),
  },
  {
    name: '1 / Conjugate(x)',
    json: ['Divide', 1, ['Conjugate', 'x']],
    inputs: over('x', [-0, 0, 4]),
  },
  {
    name: 'Conjugate(k) + 1',
    json: ['Add', ['Conjugate', 'k'], 1],
    inputs: over('k', [-3, 0]),
  },
  // `Arcsin(x)` with `x: real` has the type `complex`: the complex helper
  // of the converted operand, in both modes.
  {
    name: 'Arcsin(x)',
    json: ['Arcsin', 'x'],
    inputs: over('x', [-2, -1, -0.5, -0, 0, 0.5, 1, 2, 1e6]),
  },
  {
    name: 'Arccos(x)',
    json: ['Arccos', 'x'],
    inputs: over('x', [-2, -1, -0.5, 0, 0.5, 1, 2, 1e6]),
  },
  {
    name: 'Arcosh(x)',
    json: ['Arcosh', 'x'],
    inputs: over('x', [-2, -1, 0, 0.5, 1, 2, 1e6]),
  },
  {
    name: 'Artanh(x)',
    json: ['Artanh', 'x'],
    inputs: over('x', [-2, -0.5, -0, 0, 0.5, 2, 1e6]),
  },
  // `s: real<-1..1>`: the type of `Arcsin(s)` is real, `Math.asin`.
  {
    name: 'Arcsin(s)',
    json: ['Arcsin', 's'],
    inputs: over('s', [-1, -0.5, -0, 0, 0.5, 1]),
  },
  {
    name: 'Arccos(s)',
    json: ['Arccos', 's'],
    inputs: over('s', [-1, -0.5, 0, 0.5, 1]),
  },
  // `Multiply(Pi, u)`: `_SYS.sinpi(u)`, `_SYS.cospi(u)`, `_SYS.tanpi(u)`.
  {
    name: 'Sin(Pi x)',
    json: ['Sin', ['Multiply', 'Pi', 'x']],
    inputs: over('x', HALF_TURNS),
  },
  {
    name: 'Cos(Pi x)',
    json: ['Cos', ['Multiply', 'Pi', 'x']],
    inputs: over('x', HALF_TURNS),
  },
  {
    name: 'Tan(Pi x)',
    json: ['Tan', ['Multiply', 'Pi', 'x']],
    inputs: over('x', HALF_TURNS),
  },
  {
    name: 'Sin(Pi k)',
    json: ['Sin', ['Multiply', 'Pi', 'k']],
    inputs: over('k', [-3, 0, 4]),
  },
  // `piMultiple()` does not read past a sum: `Math.cos(_.x + Math.PI)`.
  {
    name: 'Cos(x + Pi)',
    json: ['Cos', ['Add', 'x', 'Pi']],
    inputs: over('x', [-1, 0, 2]),
  },
  {
    name: 'Sin(Pi Sin(x))',
    json: ['Sin', ['Multiply', 'Pi', ['Sin', 'x']]],
    inputs: over('x', [0, Math.PI / 2, -Math.PI / 2, 1]),
  },
  // `Log(x)` is the logarithm in base 10, `Log(x, 2)` in base 2: the rule
  // of `Ln` (`Math.log10` in the `strict` mode, `_SYS.clog10` of the
  // converted operand in the `complex` mode).
  {
    name: 'Log(x)',
    json: ['Log', 'x'],
    inputs: over('x', [-4, 0, 0.5, 1, 10, 1000, 1e300, Infinity, NaN]),
  },
  {
    name: 'Log(x, 2)',
    json: ['Log', 'x', 2],
    inputs: over('x', [-4, 0, 0.5, 1, 8, 1024, Infinity]),
  },
  {
    name: 'Log(p)',
    json: ['Log', 'p'],
    inputs: over('p', [0, 0.5, 1, 1000]),
  },
  { name: 'Log(n)', json: ['Log', 'n'], inputs: over('n', [-1, -100]) },
  {
    name: 'Log(x, y)',
    json: ['Log', 'x', 'y'],
    inputs: [
      { x: 8, y: 2 },
      { x: 0.5, y: 4 },
      { x: 1, y: 1 },
      { x: 3, y: 0.5 },
    ],
  },
  {
    name: 'Log(p, q)',
    json: ['Log', 'p', 'q'],
    inputs: [
      { p: 8, q: 2 },
      { p: 0, q: 3 },
      { p: 1, q: 1 },
    ],
  },
  // Literal operands are not folded: the same call of the same double.
  {
    name: 'Erf(2.5) + Gamma(2.5) + Tan(2.5) + x',
    json: ['Add', ['Erf', 2.5], ['Gamma', 2.5], ['Tan', 2.5], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'x + Log(2.5)',
    json: ['Add', 'x', ['Log', 2.5]],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Arcsin(2) + x',
    json: ['Add', ['Arcsin', 2], 'x'],
    inputs: over('x', [0, 1]),
  },
  // Complex operands that are names, in the `strict` mode.
  {
    name: 'Tan(z)',
    json: ['Tan', 'z'],
    inputs: over('z', [{ re: 1, im: 2 }]),
  },
  {
    name: 'Sinh(z)',
    json: ['Sinh', 'z'],
    inputs: over('z', [{ re: 1, im: 2 }]),
  },
  {
    name: 'Gamma(z)',
    json: ['Gamma', 'z'],
    inputs: over('z', [
      { re: 0.5, im: 1 },
      { re: -2.5, im: 0.5 },
    ]),
  },
  {
    name: 'Sign(z)',
    json: ['Sign', 'z'],
    inputs: over('z', [
      { re: 3, im: -4 },
      { re: -2, im: 0 },
    ]),
  },
  {
    name: 'Arcsin(z)',
    json: ['Arcsin', 'z'],
    inputs: over('z', [{ re: 0.5, im: 1 }]),
  },
  {
    name: 'Arctan(z)',
    json: ['Arctan', 'z'],
    inputs: over('z', [{ re: 0.5, im: 1 }]),
  },
];

/** The programs of names with no declared type (`t`, `a`), and the forms
 *  that the engine's own compilations pass (limit probes, stochastic
 *  equality, the scan of periodic roots, fits). */
const UNDECLARED_PROGRAMS: Program[] = [
  { name: 'Erf(t)', json: ['Erf', 't'], inputs: over('t', [-1, 0, 2]) },
  { name: 'Gamma(t)', json: ['Gamma', 't'], inputs: over('t', [-1.5, 3]) },
  { name: 'Tan(t)', json: ['Tan', 't'], inputs: over('t', [-1, 0.5]) },
  { name: 'Sign(t)', json: ['Sign', 't'], inputs: over('t', [-1, 0, 2]) },
  { name: 'Cot(t)', json: ['Cot', 't'], inputs: over('t', [-1, 0.5]) },
  // With no declared type, the type of `Arcsin(t)` is `number`, not
  // `complex`: `Math.asin(t)`, `NaN` off [-1, 1] in the `strict` mode.
  {
    name: 'Arcsin(t)',
    json: ['Arcsin', 't'],
    inputs: over('t', [-2, -0.5, 0, 1, 2]),
  },
  {
    name: 'Arccos(t)',
    json: ['Arccos', 't'],
    inputs: over('t', [-2, -0.5, 0, 1, 2]),
  },
  { name: 'Log(t)', json: ['Log', 't'], inputs: over('t', [-1, 0, 100]) },
  {
    name: '-a + Cos(Arccos(a))',
    json: ['Add', ['Negate', 'a'], ['Cos', ['Arccos', 'a']]],
    inputs: over('a', [-0.7, 0, 0.3, 1]),
  },
  {
    name: 'a + Sin(-Arcsin(a))',
    json: ['Add', 'a', ['Sin', ['Negate', ['Arcsin', 'a']]]],
    inputs: over('a', [-0.7, 0, 0.3, 1]),
  },
  {
    name: 'a + Sin(Arcsin(a) + Pi)',
    json: ['Add', 'a', ['Sin', ['Add', ['Arcsin', 'a'], 'Pi']]],
    inputs: over('a', [-0.7, 0, 0.3, 1]),
  },
  {
    name: '-a + Tan(Arctan(a))',
    json: ['Add', ['Negate', 'a'], ['Tan', ['Arctan', 'a']]],
    inputs: over('a', [-3, 0, 0.3, 2]),
  },
  {
    name: '3 Log(a, a) - 3',
    json: ['Add', ['Multiply', 3, ['Log', 'a', 'a']], -3],
    inputs: over('a', [0.5, 2, 10]),
  },
  {
    name: 'Tan(4 Sin(x)) - 1',
    json: ['Add', ['Tan', ['Multiply', 4, ['Sin', 'x']]], -1],
    inputs: over('x', [0, 0.3, 2]),
  },
  {
    name: 'Cot(4 Sin(x)) - 1',
    json: ['Add', ['Cot', ['Multiply', 4, ['Sin', 'x']]], -1],
    inputs: over('x', [0.3, 2]),
  },
  {
    name: 'x Gamma(x) Digamma(x) + Gamma(x)',
    json: [
      'Add',
      ['Multiply', 'x', ['Gamma', 'x'], ['Digamma', 'x']],
      ['Gamma', 'x'],
    ],
    inputs: over('x', [0.5, 3, 10]),
  },
  {
    name: 'Ln(Abs(Gamma(x)))',
    json: ['Ln', ['Abs', ['Gamma', 'x']]],
    inputs: over('x', [-2.5, 0.5, 30]),
  },
  {
    name: '3 Erf(Sqrt(p))',
    json: ['Multiply', 3, ['Erf', ['Sqrt', 'p']]],
    inputs: over('p', [0, 0.25, 4, 100]),
  },
];

/** The programs that the structured route declines, with the mode, and
 *  the reason. */
const DECLINED = new Map<string, RegExp>([
  // A wide type in the `complex` mode: the existing compiler wraps the
  // real call in `_SYS.cplx`.
  ['Cot(x) (complex)', /cot\(x\) has the type number, which is not real, in the complex mode/],
  ['Csc(x) (complex)', /csc\(x\) has the type number, which is not real, in the complex mode/],
  // `Log(x, y)` of operands not proved non-negative is complex in the
  // `complex` mode, a quotient of complex logarithms.
  ['Log(x, y) (complex)', /Log of x in the base y is complex/],
  // A name with no declared type is complex in the `complex` mode.
  ['Erf(t) (complex)', /Erf with a complex operand is not in the structured route/],
  ['Log(t) (complex)', /Log with a complex operand/],
  ['3 Log(a, a) - 3 (complex)', /Log with a complex operand/],
  ['Cot(4 Sin(x)) - 1 (complex)', /has the type number, which is not real, in the complex mode/],
]);

/**
 * The inputs where the interpreter and compiled code give different values,
 * with the value of compiled code; the structured route and the existing
 * emitter give it (the second comparison of `checkProgram()`).
 *
 * - `Digamma(+∞)`: the interpreter gives `+∞`, `_SYS.digamma` gives `NaN`.
 *   This is a difference of the existing compiler, which the caveats of
 *   compiled code do not list (a `NaN` for a value that is a number); the
 *   structured route writes the same call.
 */
const NOT_A_NUMBER: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['Digamma(x) (strict) x=Infinity', NaN],
  ['Digamma(x) (complex) x=Infinity', NaN],
]);

const inputsKey = (inputs: Inputs) =>
  Object.entries(inputs)
    .map(
      ([k, v]) =>
        `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
    )
    .join(',');

function checkProgram(program: Program, mode: Mode) {
  const ce = engine();
  const expr = ce.expr(program.json);
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
      (mode === 'strict' && notANumber(value) && nonReal(expected)) ||
      (complexInfinity(expected) &&
        (Math.abs(pair(value).re) === Infinity || notANumber(value))) ||
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

describe('functions of a real or a complex operand, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of REAL_PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

describe('names with no declared type, and the forms of the engine compilations, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of UNDECLARED_PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

//
// The facts of the rules and isComplexValued()
//

const FACT_HEADS = new Set([
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Sinh',
  'Cosh',
  'Arctan',
  'Arsinh',
  'Gamma',
  'Erf',
  'Erfc',
  'Digamma',
  'Haversine',
  'Sign',
  'Ceil',
  'Round',
  'Conjugate',
  'Arcsin',
  'Arccos',
  'Arcosh',
  'Artanh',
  'Log',
  'Sin',
  'Cos',
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
    for (const program of [...REAL_PROGRAMS, ...UNDECLARED_PROGRAMS]) {
      const ce = engine();
      const expr = ce.expr(program.json);
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
        // The existing compiler does not ask about a node that it writes
        // as its operand (`Conjugate` of a real operand) or as a call of
        // another operand (`Sin(π·u)`).
        if (answer === undefined) {
          if (
            !(isFunction(node, 'Conjugate') || node.symbols.includes('Pi'))
          )
            differences.push(
              `${program.name} (${mode}): ${node.toString()}: not asked`
            );
          continue;
        }
        compared += 1;
        if (answer.size !== 1 || !answer.has(complex))
          differences.push(
            `${program.name} (${mode}): ${node.toString()}: fact ${complex}, isComplexValued ${[...answer].join('/')}`
          );
      }
    }
  expect(differences).toEqual([]);
  expect(declines.sort()).toEqual([...DECLINED.keys()].sort());
  expect(compared).toBeGreaterThan(100);
});

//
// Refusals
//

describe('refusals', () => {
  const REFUSALS: [string, MathJsonExpression, Mode, RegExp][] = [
    // `piMultiple()` reads these, and builds a new node for each.
    [
      'Sin of a product of Pi and two factors',
      ['Sin', ['Multiply', 2, 'Pi', 'x']],
      'strict',
      /Sin of an operand that reads Pi is in the structured route only as Multiply\(Pi, u\)/,
    ],
    [
      'Tan of Pi/x',
      ['Tan', ['Divide', 'Pi', 'x']],
      'strict',
      /Tan of an operand that reads Pi is in the structured route only as Multiply\(Pi, u\)/,
    ],
    // The second operand of `Gamma` is the upper incomplete gamma, a
    // complex continuation; `Ceil` and `Round` with a step.
    [
      'Gamma of two operands',
      ['Gamma', 'x', 'y'],
      'strict',
      /Gamma with other than one operand is not in the structured route/,
    ],
    [
      'Round with a step',
      ['Round', 'x', 0.5],
      'strict',
      /Round with other than one operand is not in the structured route/,
    ],
    // A jump function that reads no input, parameter or local: the existing
    // compiler folds it with the exact value of its operand.
    [
      'Sign of a capture',
      ['Add', ['Sign', 'offset'], 'x'],
      'strict',
      /Sign reads no input, parameter or local: the existing compiler folds it/,
    ],
    [
      'Ceil of a capture',
      ['Add', ['Ceil', 'third'], 'x'],
      'strict',
      /Ceil reads no input, parameter or local/,
    ],
    // `jumpShiftRewrite()`: an integer variable and an exact constant that no
    // double holds.
    [
      'Round of k + 1/3',
      ['Round', ['Add', 'k', ['Rational', 1, 3]]],
      'strict',
      /Round of an operand with the exact constant 1\/3, which no double holds exactly/,
    ],
    // A complex operand of a function with a real lowering only, or with no
    // complex function of the representation.
    [
      'Erf of a complex operand',
      ['Erf', 'z'],
      'strict',
      /Erf with a complex operand is not in the structured route/,
    ],
    [
      'Erfc of a complex operand',
      ['Erfc', 'z'],
      'strict',
      /Erfc with a complex operand is not in the structured route/,
    ],
    [
      'Artanh of a complex sum',
      ['Artanh', ['Add', 'z', 1]],
      'strict',
      /Artanh of the complex operand .* is in the structured route only when the operand is a name/,
    ],
    [
      'Log of a complex operand',
      ['Log', 'z'],
      'strict',
      /Log with a complex operand is not in the structured route/,
    ],
    // `Log(n, y)` with `n` negative: complex, a quotient of complex
    // logarithms.
    // The existing compiler reads the sign of `n` and the type of the node:
    // `number`, which is not a type of numbers that are not real.
    [
      'Log of a negative operand in another base',
      ['Log', 'n', 'y'],
      'strict',
      /the operand n of Log is negative and the type of log\(n, y\) is number/,
    ],
    [
      'Log of a positive operand in a base of unknown sign, complex mode',
      ['Log', 'p', 'y'],
      'complex',
      /Log of p in the base y is complex/,
    ],
    [
      'LogGamma, which the existing compiler does not lower',
      ['LogGamma', 'x'],
      'strict',
      /unsupported head LogGamma/,
    ],
  ];
  test.each(REFUSALS)('%s', (_name, json, mode, message) => {
    const ce = engine();
    expect(() =>
      structured().compile(ce.expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });

  test('Round with another rule for ties declines', () => {
    const ce = engine();
    ce.roundingTies = 'to-even';
    expect(() =>
      structured().compile(ce.expr(['Round', 'x']), OPTIONS)
    ).toThrow(
      /Round with the rounding of ties to-even is not in the structured route/
    );
  });

  test('a list operand declines', () => {
    const ce = engine();
    for (const head of ['Erf', 'Tan', 'Sign', 'Round', 'Arcsin', 'Log']) {
      const fn = ce.expr([
        'Function',
        ['Block', [head, 'L']],
        typed('L', 'list<real>'),
      ]);
      expect(() => structured().compile(fn, OPTIONS)).toThrow(
        new RegExp(
          `${head} with the list operand L is not in the structured route`
        )
      );
    }
  });

  test('a shadowed function name (a user function of that name) declines', () => {
    for (const name of ['Tan', 'Erf', 'Sign']) {
      const ce = new ComputeEngine();
      ce.precision = 'machine';
      const { diagnostics } = executeEpsil(
        ce,
        `function ${name}(a: real) -> real { a + 1 }
function f(x: real) -> real { ${name}(x) }`
      );
      expect(diagnostics).toEqual([]);
      const fn = literal(ce, 'f');
      expect(() => structured().compile(fn, OPTIONS)).toThrow(
        new RegExp(`unsupported (bound )?head ${name}`)
      );
    }
  });
});

//
// Haversine in a function literal: the existing emitter writes its code in
// the parent with no parentheses when the operand is a parameter
//

describe('Haversine of a parameter', () => {
  const fn = (body: MathJsonExpression) =>
    engine().expr(['Function', ['Block', body], 'u']);

  test('alone, or where the parent needs no parentheses: the same code', () => {
    for (const body of [
      ['Haversine', 'u'],
      ['Add', ['Haversine', 'u'], 1],
      ['Less', ['Haversine', 'u'], 0.5],
    ] as MathJsonExpression[]) {
      const expr = fn(body);
      const result = structured().compile(expr, OPTIONS);
      const existing = compile(expr, { ...OPTIONS, fallback: false });
      for (const u of [-1, 0, 2, Infinity])
        expect(exact(runArgs(result, [u]), runArgs(existing, [u]))).toBe(true);
    }
  });

  // `2 / Haversine(u)` is `2 / (1 - Math.cos(u)) / 2` there, a quarter of
  // the value (CE-1196): the structured route declines it at admission.
  test('where the parent needs parentheses: declined', () => {
    for (const [body, parent] of [
      [['Divide', 2, ['Haversine', 'u']], 'Divide'],
      [['Multiply', ['Add', 'u', -1], ['Haversine', 'u']], 'Multiply'],
      [['Negate', ['Haversine', 'u']], 'Negate'],
    ] as [MathJsonExpression, string][])
      expect(() => structured().compile(fn(body), OPTIONS)).toThrow(
        new RegExp(
          `Haversine of u as an operand of ${parent} is not in the structured route`
        )
      );
    // Under the profile, a decline of the admission, not a failure.
    let code: string | undefined;
    try {
      compile(fn(['Divide', 2, ['Haversine', 'u']]), {
        profile: 'numeric-kernel',
        fallback: false,
      } as never);
    } catch (e) {
      code = (e as { diagnostic?: { code: string } }).diagnostic?.code;
    }
    expect(code).toBe('outside-profile');
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
  test('each function is a unary operation named by an identifier', () => {
    const ce = engine();
    const expr = ce.expr([
      'Add',
      ['Tan', 'x'],
      ['Erf', 'x'],
      ['Gamma', 'x'],
      ['Sign', 'x'],
      ['Round', 'x'],
      ['Haversine', 'x'],
      ['Sin', ['Multiply', 'Pi', 'x']],
      ['Log', 'p'],
      ['Log', 'p', 'q'],
      ['Conjugate', 'y'],
    ]);
    const program = lowerStructuredFragment(
      structured().prepareStructured(expr, { ...OPTIONS, mode: 'strict' })
    );
    const functions = allOperations(program.root)
      .filter((op) => op.kind === 'unary' || op.kind === 'binary')
      .map((op) => `${op.kind} ${(op as { fn: string }).fn} ${op.effect}`)
      .sort();
    expect(functions).toEqual([
      'unary erf pure',
      'unary gamma pure',
      'unary haversine pure',
      'unary ln pure',
      'unary ln pure',
      'unary log10 pure',
      'unary round-ties-away pure',
      'unary sign pure',
      'unary sinpi pure',
      'unary tan pure',
    ]);
    // `Log(p, q)` is the quotient of two logarithms; `Conjugate(y)` is `y`.
    expect(
      allOperations(program.root).filter((op) => op.kind === 'divide')
    ).toHaveLength(1);
  });

  test('Round reads its operand once', () => {
    const ce = engine();
    const result = structured().compile(
      ce.expr(['Round', ['Add', 'x', 'y']]),
      OPTIONS
    );
    expect(result.code.match(/_\.x/g)).toHaveLength(1);
  });

  test('the runtime helpers of the real calls are listed', () => {
    const ce = engine();
    const result = structured().compile(
      ce.expr(['Add', ['Erf', 'x'], ['Tan', ['Multiply', 'Pi', 'y']]]),
      OPTIONS
    );
    expect(result.code).toContain('_SYS.erf(');
    expect(result.code).toContain('_SYS.tanpi(');
    expect(result.run!({ x: 0.5, y: 1 } as never)).toBe(
      compile(ce.expr(['Add', ['Erf', 'x'], ['Tan', ['Multiply', 'Pi', 'y']]]), {
        ...OPTIONS,
        fallback: false,
      }).run!({ x: 0.5, y: 1 } as never)
    );
  });
});

//
// The function literals of the limit probes
//

/** The `Function` literal that `executeEpsil()` made for `name`. */
function literal(ce: ComputeEngine, name: string): Expression {
  const definition = ce.lookupDefinition(name) as
    | { operator?: { _lambdaLiteral?: Expression } }
    | undefined;
  const fn = definition?.operator?._lambdaLiteral;
  if (fn === undefined) throw new Error(`no function literal for ${name}`);
  return fn;
}

function runArgs(
  result: CompilationResult<'javascript'>,
  args: readonly unknown[]
): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

describe('function literals with a parameter of no declared type', () => {
  const PROBES: [string, MathJsonExpression, number[]][] = [
    ['(x) => 3 Erf(Sqrt(x))', ['Multiply', 3, ['Erf', ['Sqrt', 'x']]], [0, 0.25, 4, 1e6]],
    [
      '(x) => Ln(Abs(Gamma(x)))',
      ['Ln', ['Abs', ['Gamma', 'x']]],
      [0.5, 3, 100],
    ],
    [
      '(x) => x Gamma(x) Digamma(x)',
      ['Multiply', 'x', ['Gamma', 'x'], ['Digamma', 'x']],
      [0.5, 3, 10],
    ],
    ['(x) => Arctan(x)', ['Arctan', 'x'], [-1e6, 0, 1]],
  ];
  test.each(PROBES)('%s', (_name, body, points) => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Function', ['Block', body], 'x']);
    const result = structured().compile(expr, OPTIONS);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of points) {
      const value = runArgs(result, [x]);
      expect(exact(value, runArgs(existing, [x]))).toBe(true);
      const expected = ce
        .expr(['Apply', expr.json as MathJsonExpression, x])
        .evaluate()
        .N().re;
      expect([x, close(value, expected)]).toEqual([x, true]);
    }
  });
});
