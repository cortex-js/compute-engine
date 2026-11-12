import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The library heads of scalars that the `numeric-kernel` profile (the
// structured route of the JavaScript compiler) writes as calls of the real
// kernels of the existing emitter (`realCallRule()` in
// `javascript-fragment-target.ts`,
// docs/plans/2026-11-09-js-pilot-emission-rewrites.md): the special
// functions (`GammaRegularized`, `StieltjesGamma`, `HurwitzZeta`, `PolyLog`,
// `PolyGamma`, `Gamma` of two operands, …), `Heaviside`, `Remainder`, `GCD`,
// `LCM`, `KroneckerDelta`, `Clamp`, `Boole`, and `Real`, `Imaginary`,
// `Argument` of a real operand; an `If` or a `Which` whose constant
// conditions select a branch; a bound name with the name of a symbol that
// has a value, in the operand of a rounding function.
//
// Each program is compiled with the profile and with the existing compiler
// (`cse: false, constantFold: false`), in the `strict` and `complex` modes:
// the same doubles (`Object.is`, each part of a complex value) and the same
// throws at every point of a grid of inputs (negative, `0`, `-0`, `±∞`,
// `NaN`, large, tiny, integers beyond 2^53), or a decline with its message.
// The value of the interpreter is compared at ordinary points.

const EXISTING = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];
type Value = number | boolean | { re: number; im: number };

const DECLARATIONS: [string, string][] = [
  ['x', 'real'],
  ['y', 'real'],
  ['k', 'integer'],
  ['n', 'integer'],
  ['z', 'complex'],
  ['p', 'real<0..>'],
  ['w', 'number'],
  // An order of a Bessel function, of `Gamma(s, z)` and of `Zeta(s, a)` of a
  // moderate magnitude (below).
  ['j', 'integer<-5..30>'],
  ['s', 'real<-30..30>'],
  // A parameter of `EllipticK(m)`, `EllipticE(m)` and of `PolyLog(s, m)` on
  // their real domain.
  ['m', 'real<..1>'],
  // A positive operand of `Beta`.
  ['q', 'real<1..20>'],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of DECLARATIONS) ce.declare(name, type);
  return ce;
}

// The kernels of the Bessel functions do not end for an order of a
// magnitude of `2^53` or more, nor `Gamma(s, z)` for `s = -1e300`, nor
// `Zeta(s, a)` and `HurwitzZeta(s, a)` for `s = 1e300` (a known limitation
// of the existing compiler, docs/COMPILATION-MODEL.md): the grid has no
// `±1e300`, and the order of these heads is `j` or `s`.
const GRID: Record<string, Value[]> = {
  real: [-2.5, -1, -0.5, -0, 0, 0.3, 1, 2, 7.5, 1e-300, 2 ** 60, Infinity, -Infinity, NaN, -1e6],
  'integer<-5..30>': [-5, -1, 0, 1, 2, 7, 30],
  'real<-30..30>': [-30, -2.5, -0.5, -0, 0, 0.3, 1, 2, 7.5, 30, NaN],
  'real<..1>': [-1e6, -2.5, -0.5, -0, 0, 0.3, 1, -Infinity],
  'real<1..20>': [1, 1.5, 2, 7.5, 20],
  integer: [-3, -1, 0, 1, 2, 5, 25, 2 ** 53 + 2],
  complex: [{ re: 1, im: 2 }, { re: -0.5, im: 0 }],
  'real<0..>': [0, -0, 0.5, 2, 1e300, Infinity],
  number: [0.5, -2],
};

type Outcome = { result: CompilationResult<'javascript'> } | { message: string };

function compileWith(expr: Expression, mode: Mode, profile: boolean): Outcome {
  try {
    return {
      result: compile(expr, {
        fallback: false,
        mode,
        ...(profile ? { profile: 'numeric-kernel' } : EXISTING),
      } as never) as CompilationResult<'javascript'>,
    };
  } catch (e) {
    return { message: (e as Error).message };
  }
}

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
    return (
      Object.is((a as { re: number }).re, (b as { re: number }).re) &&
      Object.is((a as { im: number }).im, (b as { im: number }).im)
    );
  return Object.is(a, b);
};

const inputsOf = (expr: Expression): string[] =>
  [...new Set(expr.symbols)].filter((s) => DECLARATIONS.some(([n]) => n === s));

function pointsOf(names: readonly string[], grid: Record<string, Value[]>, limit = 600) {
  const points: Record<string, Value>[] = [];
  const visit = (i: number, acc: Record<string, Value>) => {
    if (points.length >= limit) return;
    if (i === names.length) return void points.push({ ...acc });
    const type = DECLARATIONS.find(([n]) => n === names[i])![1];
    for (const v of grid[type]) visit(i + 1, { ...acc, [names[i]]: v });
  };
  visit(0, {});
  return points;
}

const run = (result: CompilationResult<'javascript'>, point: Record<string, Value>): unknown => {
  try {
    return (result.run as (vars: unknown) => unknown)({ ...point });
  } catch (e) {
    return `throw: ${(e as Error).message}`;
  }
};

/** The profile admits `json` in `mode`, and gives the doubles and the
 *  throws of the existing compiler at every point of the grid. */
function expectSameDoubles(json: MathJsonExpression, mode: Mode): void {
  const expr = engine().box(json);
  const profile = compileWith(expr, mode, true);
  if (!('result' in profile)) throw new Error(`${mode}: ${profile.message}`);
  const existing = compileWith(expr, mode, false);
  if (!('result' in existing)) throw new Error(`existing, ${mode}: ${existing.message}`);
  const differences: string[] = [];
  for (const point of pointsOf(inputsOf(expr), GRID)) {
    const a = run(profile.result, point);
    const b = run(existing.result, point);
    if (!same(a, b))
      differences.push(`${JSON.stringify(point)}: ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  expect(differences).toEqual([]);
}

function expectDecline(json: MathJsonExpression, mode: Mode, message: RegExp): void {
  const outcome = compileWith(engine().box(json), mode, true);
  expect('message' in outcome && outcome.message).toMatch(message);
}

const boxValue = (ce: ComputeEngine, v: Value): Expression =>
  typeof v === 'boolean'
    ? v
      ? ce.True
      : ce.False
    : typeof v === 'number'
      ? ce.number(v)
      : ce.expr(['Complex', v.re, v.im]);

/** The value of the profile is the value of the interpreter, within 1e-9
 *  relative, at each of `points` where the interpreter has a finite real
 *  value. */
function expectInterpreterValue(json: MathJsonExpression, points: Record<string, number>[]): void {
  const ce = engine();
  const expr = ce.box(json);
  const profile = compileWith(expr, 'strict', true);
  if (!('result' in profile)) throw new Error(profile.message);
  const differences: string[] = [];
  for (const point of points) {
    const value = expr
      .subs(Object.fromEntries(Object.entries(point).map(([k, v]) => [k, boxValue(ce, v)])))
      .evaluate()
      .N();
    if (value.im !== 0 || !Number.isFinite(value.re)) continue;
    const got = run(profile.result, point);
    const expected = value.re;
    if (
      typeof got !== 'number' ||
      !(got === expected || Math.abs(got - expected) <= 1e-9 * Math.max(1, Math.abs(expected)))
    )
      differences.push(`${JSON.stringify(point)}: ${JSON.stringify(got)} and ${expected}`);
  }
  expect(differences).toEqual([]);
}

//
// The heads of real calls
//

/** The programs that both modes admit with the doubles of the existing
 *  compiler. */
const ADMITTED: [string, MathJsonExpression][] = [
  // One operand.
  ['Heaviside(x)', ['Heaviside', 'x']],
  ['Heaviside(k)', ['Heaviside', 'k']],
  ['GammaLn(x)', ['GammaLn', 'x']],
  ['Sinc(x)', ['Sinc', 'x']],
  ['Erfi(x)', ['Erfi', 'x']],
  ['ErfInv(x)', ['ErfInv', 'x']],
  ['Trigamma(x)', ['Trigamma', 'x']],
  ['FresnelS(x)', ['FresnelS', 'x']],
  ['FresnelC(x)', ['FresnelC', 'x']],
  ['SinIntegral(x)', ['SinIntegral', 'x']],
  ['CosIntegral(p)', ['CosIntegral', 'p']],
  ['ExpIntegralEi(x)', ['ExpIntegralEi', 'x']],
  ['LogIntegral(x)', ['LogIntegral', 'x']],
  ['DirichletEta(x)', ['DirichletEta', 'x']],
  ['DirichletBeta(x)', ['DirichletBeta', 'x']],
  ['Zeta(x)', ['Zeta', 'x']],
  ['StieltjesGamma(k)', ['StieltjesGamma', 'k']],
  ['StieltjesGamma(x)', ['StieltjesGamma', 'x']],
  ['AGM(p)', ['AGM', 'p']],
  ['Chop(x)', ['Chop', 'x']],
  ['Real(x)', ['Real', 'x']],
  ['3·Real(x)', ['Multiply', 3, ['Real', 'x']]],
  ['Real(k) + 1', ['Add', ['Real', 'k'], 1]],
  ['Imaginary(x) + 0.5', ['Add', ['Imaginary', 'x'], 0.5]],
  ['Argument(x)', ['Argument', 'x']],
  ['1 / Argument(x)', ['Divide', 1, ['Argument', 'x']]],
  ['Argument(k)', ['Argument', 'k']],
  ['KroneckerDelta(x)', ['KroneckerDelta', 'x']],
  ['KroneckerDelta(k)^2', ['Power', ['KroneckerDelta', 'k'], 2]],
  // Two operands.
  ['GammaRegularized(x, p)', ['GammaRegularized', 'x', 'p']],
  ['GammaRegularized(3, p)', ['GammaRegularized', 3, 'p']],
  ['1 + GammaRegularized(k, p)', ['Add', 1, ['GammaRegularized', 'k', 'p']]],
  ['Beta(q, 2.5)', ['Beta', 'q', 2.5]],
  ['Binomial(x, y)', ['Binomial', 'x', 'y']],
  ['Choose(k, n)', ['Choose', 'k', 'n']],
  ['ClausenCl(k, y)', ['ClausenCl', 'k', 'y']],
  ['EllipticF(x, y)', ['EllipticF', 'x', 'y']],
  ['EllipticPi(x, y)', ['EllipticPi', 'x', 'y']],
  ['EllipticE(x, y)', ['EllipticE', 'x', 'y']],
  ['BesselJ(j, y)', ['BesselJ', 'j', 'y']],
  ['BesselY(s, y)', ['BesselY', 's', 'y']],
  ['BesselI(j, y)', ['BesselI', 'j', 'y']],
  ['BesselK(s, y)', ['BesselK', 's', 'y']],
  ['AGM(p, 2)', ['AGM', 'p', 2]],
  ['PolyGamma(k, y)', ['PolyGamma', 'k', 'y']],
  ['PolyGamma(x, y)', ['PolyGamma', 'x', 'y']],
  ['Zeta(s, y)', ['Zeta', 's', 'y']],
  ['StieltjesGamma(k, y)', ['StieltjesGamma', 'k', 'y']],
  ['Remainder(x, 7)', ['Remainder', 'x', 7]],
  ['Remainder(5, x)', ['Remainder', 5, 'x']],
  ['1 - Remainder(k, n)', ['Subtract', 1, ['Remainder', 'k', 'n']]],
  ['GCD(k, n)', ['GCD', 'k', 'n']],
  ['GCD(x, 6)', ['GCD', 'x', 6]],
  ['GCD(k, n, 6)', ['GCD', 'k', 'n', 6]],
  ['LCM(k, n)', ['LCM', 'k', 'n']],
  ['LCM(x, 4)', ['LCM', 'x', 4]],
  ['LCM(k, n, 4)', ['LCM', 'k', 'n', 4]],
  ['KroneckerDelta(x, y)', ['KroneckerDelta', 'x', 'y']],
  ['KroneckerDelta(k, n, 2)', ['KroneckerDelta', 'k', 'n', 2]],
  // Three operands.
  ['Clamp(x, y, 3)', ['Clamp', 'x', 'y', 3]],
  // The first operand is evaluated first, as the existing compiler does:
  // at `x = 0, y = ∞`, both operands throw, and the throw is that of
  // `Remainder` on both.
  ['KroneckerDelta(Remainder(x, y), GCD(x, y, k))', ['KroneckerDelta', ['Remainder', 'x', 'y'], ['GCD', 'x', 'y', 'k']]],
  // A rounding of a decided `If`: the condition is not a constant of the
  // operand (`inexactJumpConstant()`), and the dead branch is not read.
  ['Floor(If(2 < 3, x, y))', ['Floor', ['If', ['Less', 2, 3], 'x', 'y']]],
  ['Ceil(Which(3 < 2, y + 1/3, True, x))', ['Ceil', ['Which', ['Less', 3, 2], ['Add', 'y', ['Rational', 1, 3]], 'True', 'x']]],
  ['Clamp(k, 0, 5)', ['Clamp', 'k', 0, 5]],
  ['-Clamp(x, -1, 1)', ['Negate', ['Clamp', 'x', -1, 1]]],
  // A condition.
  ['Boole(x < y)', ['Boole', ['Less', 'x', 'y']]],
  ['2·Boole(x < 1) + x', ['Add', ['Multiply', 2, ['Boole', ['Less', 'x', 1]]], 'x']],
  // A continuation head whose value `complexContinuation()` proves real:
  // also the real kernel in the complex mode.
  ['HurwitzZeta(j, y)', ['HurwitzZeta', 'j', 'y']],
  ['HurwitzZeta(-3, y)', ['HurwitzZeta', -3, 'y']],
  ['HurwitzZeta(s, p)', ['HurwitzZeta', 's', 'p']],
  ['PolyLog(x, m)', ['PolyLog', 'x', 'm']],
  ['PolyLog(-2, y)', ['PolyLog', -2, 'y']],
  ['Gamma(s, p)', ['Gamma', 's', 'p']],
  ['Gamma(3, p)', ['Gamma', 3, 'p']],
  ['EllipticK(m)', ['EllipticK', 'm']],
  ['EllipticE(m) + 1', ['Add', ['EllipticE', 'm'], 1]],
  ['LambertW(p)', ['LambertW', 'p']],
  // As an operand of an operation and of a function.
  ['Sqrt(GammaRegularized(x, p))', ['Sqrt', ['GammaRegularized', 'x', 'p']]],
  ['2·Heaviside(x) - Sinc(y)', ['Subtract', ['Multiply', 2, ['Heaviside', 'x']], ['Sinc', 'y']]],
  ['Sin(Zeta(x)) / Clamp(x, 1, 2)', ['Divide', ['Sin', ['Zeta', 'x']], ['Clamp', 'x', 1, 2]]],
  ['GCD(Floor(x), k) + 1', ['Add', ['GCD', ['Floor', 'x'], 'k'], 1]],
];

describe('the heads of real calls: the doubles of the existing compiler', () => {
  for (const mode of MODES)
    test.each(ADMITTED)(`%s (${mode})`, (_name, json) => expectSameDoubles(json, mode));
});

/** The programs that the strict mode admits, with the doubles of the
 *  existing compiler, and that the complex mode declines: a continuation
 *  head whose value can be complex, where the existing emitter writes the
 *  complex kernel of lifted operands. */
const STRICT_ONLY: [string, MathJsonExpression, RegExp][] = [
  ['HurwitzZeta(s, y)', ['HurwitzZeta', 's', 'y'], /HurwitzZeta\(s, y\) can have a complex value/],
  ['PolyLog(x, y)', ['PolyLog', 'x', 'y'], /PolyLog\(x, y\) can have a complex value/],
  ['LambertW(x)', ['LambertW', 'x'], /LambertW\(x\) can have a complex value/],
  ['LambertW(x, k)', ['LambertW', 'x', 'k'], /can have a complex value/],
  ['EllipticK(x)', ['EllipticK', 'x'], /EllipticK\(x\) can have a complex value/],
  ['EllipticE(x) + 1', ['Add', ['EllipticE', 'x'], 1], /EllipticE\(x\) can have a complex value/],
  // `Chop` has the type of its operand, here `number`: the existing compiler
  // reads it as a complex value in the complex mode.
  ['Chop(7 · (1/x)) + 1', ['Add', ['Chop', ['Multiply', 7, ['Divide', 1, 'x']]], 1], /Chop\(7 \* 1 \/ x\) has the type number, which the existing compiler reads as a complex value in the complex mode/],
];

describe('the heads with a complex continuation', () => {
  test.each(STRICT_ONLY)('%s (strict)', (_name, json) => expectSameDoubles(json, 'strict'));
  test.each(STRICT_ONLY)('%s: declined in the complex mode', (_name, json, message) =>
    expectDecline(json, 'complex', message)
  );
});

describe('the heads of real calls: the value of the interpreter', () => {
  const X = [{ x: 0.3 }, { x: 2 }, { x: 7.5 }, { x: -0.5 }];
  const XY = [
    { x: 0.3, y: 2 },
    { x: 2, y: 0.5 },
    { x: 3.5, y: 1.25 },
  ];
  test.each<[string, MathJsonExpression, Record<string, number>[]]>([
    ['Heaviside(x)', ['Heaviside', 'x'], [...X, { x: 0 }]],
    ['Sinc(x)', ['Sinc', 'x'], [...X, { x: 0 }]],
    ['Erfi(x)', ['Erfi', 'x'], X],
    ['ErfInv(x)', ['ErfInv', 'x'], [{ x: 0.3 }, { x: -0.5 }]],
    ['Trigamma(x)', ['Trigamma', 'x'], X],
    ['FresnelS(x)', ['FresnelS', 'x'], X],
    ['SinIntegral(x)', ['SinIntegral', 'x'], X],
    ['ExpIntegralEi(x)', ['ExpIntegralEi', 'x'], X],
    ['Zeta(x)', ['Zeta', 'x'], [{ x: 2 }, { x: 7.5 }, { x: -0.5 }]],
    ['StieltjesGamma(k)', ['StieltjesGamma', 'k'], [{ k: 0 }, { k: 1 }, { k: 2 }]],
    ['GammaRegularized(x, p)', ['GammaRegularized', 'x', 'p'], [{ x: 2, p: 0.5 }, { x: 0.5, p: 2 }, { x: -2.5, p: 1 }]],
    ['GammaRegularized(3, p)', ['GammaRegularized', 3, 'p'], [{ p: 0.3 }, { p: 2 }]],
    ['Beta(q, 2.5)', ['Beta', 'q', 2.5], [{ q: 1 }, { q: 7.5 }]],
    ['PolyGamma(k, y)', ['PolyGamma', 'k', 'y'], [{ k: 1, y: 2 }, { k: 2, y: 0.5 }]],
    ['HurwitzZeta(-3, y)', ['HurwitzZeta', -3, 'y'], [{ y: 0.5 }, { y: 2 }]],
    ['Remainder(x, 7)', ['Remainder', 'x', 7], [...X, { x: 10.5 }, { x: -4 }]],
    ['GCD(k, n)', ['GCD', 'k', 'n'], [{ k: 12, n: 18 }, { k: -4, n: 6 }, { k: 0, n: 5 }]],
    ['GCD(x, 6)', ['GCD', 'x', 6], [{ x: 2.5 }, { x: 9 }]],
    ['LCM(k, n, 4)', ['LCM', 'k', 'n', 4], [{ k: 3, n: 5 }, { k: -6, n: 0 }]],
    ['KroneckerDelta(x, y)', ['KroneckerDelta', 'x', 'y'], [{ x: 1, y: 1 }, { x: 1, y: 2 }]],
    ['Clamp(x, y, 3)', ['Clamp', 'x', 'y', 3], XY],
    ['Boole(x < y)', ['Boole', ['Less', 'x', 'y']], XY],
    ['Argument(x)', ['Argument', 'x'], [...X, { x: 0 }]],
    ['3·Real(x)', ['Multiply', 3, ['Real', 'x']], X],
    ['Imaginary(x) + 0.5', ['Add', ['Imaginary', 'x'], 0.5], X],
  ])('%s', (_name, json, points) => expectInterpreterValue(json, points));
});

describe('the heads of real calls: the declines that stay', () => {
  test.each<[string, MathJsonExpression, RegExp]>([
    // The existing compiler declines a complex operand of a real-only
    // kernel in the strict mode, and guards it at run time in the complex
    // mode; it writes the complex code of `Real`, `Imaginary`, `Argument`
    // and `KroneckerDelta`.
    ['GammaRegularized(z, y)', ['GammaRegularized', 'z', 'y'], /GammaRegularized with a complex operand/],
    // An operand outside the range where the existing kernel has the
    // value: `GammaRegularized(2, -0.5)`, `Gamma(1, -1)`, `AGM(-2.5, -1)`
    // and `Beta(-3, 2)` are `NaN` there, where the interpreter has a finite
    // value.
    ['GammaRegularized(x, y)', ['GammaRegularized', 'x', 'y'], /GammaRegularized\(x, y\) with the operand y, which is not provably non-negative/],
    ['Gamma(s, y)', ['Gamma', 's', 'y'], /Gamma\(s, y\) with the operand y, which is not provably non-negative/],
    ['AGM(x, y)', ['AGM', 'x', 'y'], /AGM\(x, y\) with the operand x, which is not provably non-negative/],
    ['AGM(x)', ['AGM', 'x'], /AGM\(x\) with the operand x, which is not provably non-negative/],
    ['Beta(x, 2)', ['Beta', 'x', 2], /Beta\(x, 2\) with the operand x, which is not provably positive/],
    ['Beta(p, 2)', ['Beta', 'p', 2], /Beta\(p, 2\) with the operand p, which is not provably positive/],
    // `KroneckerDelta` and the fold of `GCD` and `LCM` with an operand that
    // can throw after the second: the existing compiler evaluates every
    // operand before it compares or folds.
    ['GCD(x, y, Remainder(x, y))', ['GCD', 'x', 'y', ['Remainder', 'x', 'y']], /gcd\(x, y, Remainder\(x, y\)\) with the operand Remainder\(x, y\), which can throw, after the second is not in the profile/],
    ['KroneckerDelta(x, y, GCD(x, 2))', ['KroneckerDelta', 'x', 'y', ['GCD', 'x', 2]], /with the operand gcd\(x, 2\), which can throw, after the second is not in the profile|which can throw, after the second/],
    ['Real(z)', ['Real', 'z'], /Real with a complex operand/],
    ['Imaginary(z)', ['Imaginary', 'z'], /Imaginary with a complex operand/],
    ['Argument(z)', ['Argument', 'z'], /Argument with a complex operand/],
    ['KroneckerDelta(z)', ['KroneckerDelta', 'z'], /KroneckerDelta with a complex operand/],
    ['HurwitzZeta(x, z)', ['HurwitzZeta', 'x', 'z'], /HurwitzZeta with a complex operand/],
    // A `number` input is complex in the complex mode.
    ['Clamp(w, 0, 1)', ['Clamp', 'w', 0, 1], /Clamp with a complex operand|Clamp with an operand/],
    // The numbers of operands that the representation does not have (a
    // function of three operands), or that the existing compiler declines.
    ['BetaRegularized(x, 2, 3)', ['BetaRegularized', 'x', 2, 3], /unsupported head BetaRegularized/],
    ['EllipticPi(x, y, 0.5)', ['EllipticPi', 'x', 'y', 0.5], /EllipticPi with 3 operands is not in the profile, which has 2 operands/],
    ['LerchPhi(x, y, 2)', ['LerchPhi', 'x', 'y', 2], /unsupported head LerchPhi/],
    // The kernel of `CosIntegral` gives `Ci(|x|)` for a negative `x`, where
    // the value is `Ci(|x|) + iπ` (a defect of the existing compiler).
    ['CosIntegral(x)', ['CosIntegral', 'x'], /CosIntegral\(x\) with the operand x, which is not provably non-negative, is not in the profile: the existing kernel gives Ci\(\|x\|\) for a negative x/],
    // `Pipe`, `EvaluateAt` and `Cross` are not functions of scalars.
    ['Pipe(y, Sqrt)', ['Pipe', 'y', 'Sqrt'], /unsupported head Pipe/],
  ])('%s', (_name, json, message) => {
    for (const mode of MODES)
      if (!(json as unknown[]).includes('w') || mode === 'complex') expectDecline(json, mode, message);
  });

  test('a list operand: the existing compiler broadcasts the head', () => {
    const ce = engine();
    ce.declare('L', 'list<real>');
    const outcome = compileWith(ce.box(['Heaviside', 'L']), 'strict', true);
    expect('message' in outcome && outcome.message).toMatch(/Heaviside with the list operand L is not in the profile/);
  });
});

//
// If and Which with constant conditions
//

describe('an If or a Which whose constant conditions select a branch', () => {
  const PROGRAMS: [string, MathJsonExpression][] = [
    ['If(2 < 3, 0, y)', ['If', ['Less', 2, 3], 0, 'y']],
    ['If(2 < 1, x, y)', ['If', ['Less', 2, 1], 'x', 'y']],
    // The dead branch has a complex value, or a value that the profile
    // declines: the existing emitter writes no code for it.
    ['x + If(1 < 0, Sqrt(y - 1), y)', ['Add', 'x', ['If', ['Less', 1, 0], ['Sqrt', ['Add', 'y', -1]], 'y']]],
    ['If(2 < 3, x, Sqrt(y))', ['If', ['Less', 2, 3], 'x', ['Sqrt', 'y']]],
    ['If(2 < 3, 0, BetaRegularized(x, 2, 3))', ['If', ['Less', 2, 3], 0, ['BetaRegularized', 'x', 2, 3]]],
    ['Which(2 < 3, x, True, 0)', ['Which', ['Less', 2, 3], 'x', 'True', 0]],
    ['Which(2 < 1, x, k == k, y, True, 0)', ['Which', ['Less', 2, 1], 'x', ['Equal', 'k', 'k'], 'y', 'True', 0]],
    ['Which(3 < 2, Sqrt(y - 1), True, y)', ['Which', ['Less', 3, 2], ['Sqrt', ['Add', 'y', -1]], 'True', 'y']],
    ['If(0 <= p·p, x, y)', ['If', ['LessEqual', 0, ['Multiply', 'p', 'p']], 'x', 'y']],
    ['Function(Which(2 < 3, 2x, True, y), x)', ['Function', ['Which', ['Less', 2, 3], ['Multiply', 2, 'x'], 'True', 'y'], 'x']],
    ['2 · Which(2 < 3, x, True, 0)', ['Multiply', 2, ['Which', ['Less', 2, 3], 'x', 'True', 0]]],
    ['2 · If(2 < 3, x)', ['Multiply', 2, ['If', ['Less', 2, 3], 'x']]],
    ['If(2 < 3, x + 1, 0)', ['If', ['Less', 2, 3], ['Add', 'x', 1], 0]],
  ];
  for (const mode of MODES)
    test.each(PROGRAMS)(`%s (${mode})`, (_name, json) => {
      const expr = engine().box(json);
      const profile = compileWith(expr, mode, true);
      if (!('result' in profile)) throw new Error(profile.message);
      const existing = compileWith(expr, mode, false);
      if (!('result' in existing)) throw new Error(existing.message);
      const isFunction = (json as unknown[])[0] === 'Function';
      for (const point of pointsOf(inputsOf(expr), GRID)) {
        const call = (r: CompilationResult<'javascript'>) =>
          isFunction ? (r.run as unknown as (x: unknown) => unknown)(point.x ?? 1) : run(r, point);
        expect([point, same(call(profile.result), call(existing.result))]).toEqual([point, true]);
      }
    });

  test('the code has no test and no dead branch', () => {
    const profile = compileWith(
      engine().box(['Which', ['Less', 2, 1], ['Sin', 'x'], 'True', ['Sqrt', 'y']]),
      'strict',
      true
    );
    if (!('result' in profile)) throw new Error(profile.message);
    expect(profile.result.code).toBe('Math.sqrt(_.y)');
  });

  test('the declines that stay', () => {
    // A condition that is not constant before the clause that a constant
    // condition selects: the existing compiler drops the clause of the
    // condition `false`.
    for (const mode of MODES)
      expectDecline(
        ['Which', ['Less', 3, 2], 'x', ['Less', 'x', 1], 'y', 'True', 0],
        mode,
        /the condition of Which has the constant type false/
      );
    // An `If` of three operands whose selected branch is not a symbol or a
    // number: the existing compiler writes that branch with no parentheses
    // (`2 * If(2 < 3, x + 1, 0)` is `2 * _.x + 1` there).
    for (const mode of MODES) {
      expectDecline(
        ['Multiply', 2, ['If', ['Less', 2, 3], ['Add', 'x', 1], 0]],
        mode,
        /If\(2 < 3, x \+ 1, 0\) has a condition of a constant type, and the existing compiler writes the branch x \+ 1 that it selects with no parentheses/
      );
      expectDecline(
        ['Function', ['Add', 1, ['If', ['Less', 2, 3], ['Multiply', 2, 'x'], 'y']], 'x'],
        mode,
        /the existing compiler writes the branch 2x that it selects with no parentheses/
      );
    }
    // A dead branch of a name with no declared type: the type of the node is
    // not a number type, and the existing compiler writes the parent from
    // it (a broadcast of the product).
    for (const mode of MODES)
      expectDecline(
        ['Multiply', ['Rational', 2, 3], ['Add', 'x', ['Which', ['LessEqual', 1.5, 1], 'u', 'True', 0.5]]],
        mode,
        /Which\(1\.5 <= 1, u, "True", 0\.5\) has conditions of a constant type and the type unknown, which is not a number type/
      );
    // A selected branch that is a complex constant: the existing compiler
    // reads the node as a computed complex value (`x + Which(2 < 3, i,
    // True, 0)` at `x = -0` is `{re: 0, im: 1}` there).
    for (const mode of MODES)
      expectDecline(
        ['Add', 'x', ['Which', ['Less', 2, 3], ['Complex', 0, 1], 'True', 0]],
        mode,
        /Which\(2 < 3, i, "True", 0\) has conditions of a constant type and selects the complex constant i, which the existing compiler reads as a computed complex value/
      );
    // `If(c, v)` used as a value whose condition is `false`: the value is
    // `Nothing`.
    expectDecline(['Add', 1, ['If', ['Less', 2, 1], 'x']], 'strict', /constant type false|Nothing|If/);
  });
});

//
// A bound name with the name of a symbol that has a value
//

describe('a bound name in the operand of a rounding function', () => {
  const bound = () => {
    const ce = engine();
    ce.assign('t', ce.box(['Rational', 1, 3]));
    ce.assign('N', ce.box(['Rational', 1, 49]));
    return ce;
  };
  test.each<[string, MathJsonExpression, number[][]]>([
    ['Function(Floor(t), t)', ['Function', ['Floor', 't'], 't'], [[0.5], [-1.5], [2], [-0]]],
    ['Function(Ceil(2t), t)', ['Function', ['Ceil', ['Multiply', 2, 't']], 't'], [[0.25], [-1.5]]],
    ['Function(Round(t + x), t, x)', ['Function', ['Round', ['Add', 't', 'x']], 't', 'x'], [[0.25, 2], [-1.5, 0.5]]],
    ['Function(Truncate(t) + Fract(t·x), t, x)', ['Function', ['Add', ['Truncate', 't'], ['Fract', ['Multiply', 't', 'x']]], 't', 'x'], [[2.5, 0.5], [-1.25, 3]]],
  ])('%s: the code of the existing compiler', (_name, json, cases) => {
    const ce = bound();
    const expr = ce.box(json);
    const profile = compile(expr, { profile: 'numeric-kernel', fallback: false } as never) as CompilationResult<'javascript'>;
    const existing = compile(expr, { ...EXISTING, fallback: false } as never) as CompilationResult<'javascript'>;
    for (const args of cases) {
      const a = (profile.run as unknown as (...v: number[]) => unknown)(...args);
      const b = (existing.run as unknown as (...v: number[]) => unknown)(...args);
      expect([args, same(a, b)]).toEqual([args, true]);
    }
  });

  test('Function(Floor(t), t) is Math.floor of the parameter', () => {
    const profile = compile(bound().box(['Function', ['Floor', 't'], 't']), {
      profile: 'numeric-kernel',
      fallback: false,
    } as never) as CompilationResult<'javascript'>;
    expect(profile.code).toBe('(t) => { return Math.floor(t); }');
  });

  test('a captured symbol with an exact value that no double holds is still declined', () => {
    const outcome = compileWith(bound().box(['Floor', ['Multiply', 'N', 'k']]), 'strict', true);
    expect('message' in outcome && outcome.message).toMatch(/Floor of an operand with the exact constant N/);
    const parameter = compileWith(
      bound().box(['Function', ['Floor', ['Add', 't', ['Rational', 1, 3]]], 't']),
      'strict',
      true
    );
    expect('message' in parameter && parameter.message).toMatch(/Floor of an operand with the exact constant 1\/3/);
  });
});

describe('a name that the program binds, with the name of an engine symbol that has a value', () => {
  // The engine answers a predicate of such a name (its sign, its type, the
  // type of a condition that reads it) from the engine symbol: with
  // `t := 5`, `t` of `Function(CosIntegral(t), t)` is non-negative there.
  // Each program declines, or gives the value of the interpreter.
  const BODIES: [string, MathJsonExpression][] = [
    ['CosIntegral(t)', ['CosIntegral', 't']],
    ['GammaRegularized(2, t)', ['GammaRegularized', 2, 't']],
    ['Gamma(2, t)', ['Gamma', 2, 't']],
    ['AGM(t, 1)', ['AGM', 't', 1]],
    ['Beta(t, 2)', ['Beta', 't', 2]],
    ['If(t < 3, 1, 2)', ['If', ['Less', 't', 3], 1, 2]],
    ['Which(t < 3, 1, True, 2)', ['Which', ['Less', 't', 3], 1, 'True', 2]],
    ['HurwitzZeta(t, 2)', ['HurwitzZeta', 't', 2]],
    ['Chop(t)', ['Chop', 't']],
    ['GCD(t, 6)', ['GCD', 't', 6]],
    ['Clamp(t, 0, 1)', ['Clamp', 't', 0, 1]],
    ['Floor(t)', ['Floor', 't']],
    ['Heaviside(t)', ['Heaviside', 't']],
  ];
  const PLACES: [string, (body: MathJsonExpression) => MathJsonExpression][] = [
    ['a parameter of the root function', (body) => ['Function', body, 't']],
    ['a parameter of a helper', () => ['Function', ['fh', 'x'], 'x']],
    ['a parameter of a function literal', (body) => ['Function', ['Apply', ['Function', body, 't'], 'x'], 'x']],
    ['the index of a Sum', (body) => ['Function', ['Add', 'x', ['Sum', body, ['Limits', 't', -3, -1]]], 'x']],
    ['a local of a block', (body) => ['Function', ['Block', ['Declare', 't', "'real'", 'x'], body], 'x']],
  ];
  const parts = (v: unknown): [number, number] | undefined =>
    typeof v === 'number'
      ? [v, 0]
      : typeof v === 'object' && v !== null && 're' in v
        ? [(v as { re: number }).re, (v as { im: number }).im]
        : undefined;
  const close = (a: number, b: number): boolean =>
    Object.is(a, b) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const cases = BODIES.flatMap(([name, body]) =>
    PLACES.flatMap(([place, of]) =>
      MODES.map((mode) => [`${name}, t ${place} (${mode})`, body, of, mode] as const)
    )
  );
  test.each(cases)('%s', (_name, body, of, mode) => {
    const ce = new ComputeEngine();
    ce.assign('t', 5);
    ce.declare('x', 'real');
    ce.assign('fh', ce.box(['Function', body, 't']));
    const json = of(body);
    const outcome = compileWith(ce.box(json), mode, true);
    if (!('result' in outcome)) return;
    for (const v of [-2, -0.5, 1.5]) {
      const value = (outcome.result.run as unknown as (x: number) => unknown)(v);
      const interpreted = ce.box(['Apply', json, v]).evaluate().N();
      if (!Number.isFinite(interpreted.re) || !Number.isFinite(interpreted.im)) continue;
      const got = parts(value);
      expect([v, got !== undefined && close(got[0], interpreted.re) && close(got[1], interpreted.im)]).toEqual([v, true]);
    }
  });

  test('CosIntegral of a root parameter declines', () => {
    const ce = new ComputeEngine();
    ce.assign('t', 5);
    const outcome = compileWith(ce.box(['Function', ['CosIntegral', 't'], 't']), 'strict', true);
    expect('message' in outcome && outcome.message).toMatch(
      /CosIntegral\(t\) with the operand t, which is not provably non-negative \(it names a parameter, a local or an index\)/
    );
  });

  test('the condition of If that reads a parameter is not decided at compile time', () => {
    const ce = new ComputeEngine();
    ce.assign('n', 5);
    const outcome = compileWith(ce.box(['Function', ['If', ['Less', 'n', 3], 1, 2], 'n']), 'strict', true);
    if (!('result' in outcome)) throw new Error(outcome.message);
    expect(outcome.result.code).toBe('(n) => { return n < 3 ? 1 : 2; }');
    const run = outcome.result.run as unknown as (n: number) => number;
    expect([run(1), run(5)]).toEqual([1, 2]);
  });
});

describe('a product of a list literal in degrees', () => {
  // The existing compiler writes an inverse trigonometric function in
  // degrees as a product, `57.29577951308232 * Math.asin(0.5)`, and the
  // elements of the product of a list literal as one chain:
  // `Product([p, Arcsec(-1)])` is `_.p * 57.29577951308232 * Math.acos(…)`
  // there, which is `59.99999999999999` at `p = 1/3`, and `60` on the
  // route.
  test.each<[string, MathJsonExpression]>([
    ['Product([p, Arcsec(-1)])', ['Product', ['List', 'p', ['Arcsec', -1]]]],
    ['At(p · [1, Arcsin(0.5)], 2)', ['At', ['Multiply', 'p', ['List', 1, ['Arcsin', 0.5]]], 2]],
  ])('%s declines', (_name, json) => {
    const ce = engine();
    ce.angularUnit = 'deg';
    const outcome = compileWith(ce.box(json), 'strict', true);
    expect('message' in outcome && outcome.message).toMatch(/with an element of the head Arc(sec|sin)/);
  });

  test('in radians, the product is written as the existing compiler writes it', () => {
    const ce = engine();
    const expr = ce.box(['Product', ['List', 'p', ['Arcsin', 0.5]]]);
    const profile = compileWith(expr, 'strict', true);
    const existing = compileWith(expr, 'strict', false);
    if (!('result' in profile) || !('result' in existing)) throw new Error('declined');
    for (const p of [1 / 3, 2, 7.5])
      expect(same(run(profile.result, { p }), run(existing.result, { p }))).toBe(true);
  });
});

describe('a Sum whose term reads its operands as integers', () => {
  // `_SYS.remainder`, `_SYS.gcd` and `_SYS.lcm` throw for an operand beyond
  // the safe integers, as `_SYS.floorMod` does, and the term is judged as a
  // `mod` (`termThrower()`): harmless when each operand is a safe integer by
  // construction (an index, an integer literal).
  test('Sum(GCD(k, 6), Limits(k, 1, n)) and Sum(LCM(k, n), Limits(k, 1, 9)) compile with the doubles of the existing compiler', () => {
    expectSameDoubles(['Sum', ['GCD', 'k', 6], ['Limits', 'k', 1, 'n']], 'strict');
    expectSameDoubles(['Sum', ['GCD', 'k', 6], ['Limits', 'k', 1, 9]], 'strict');
    expectSameDoubles(['Sum', ['LCM', 'k', 'n'], ['Limits', 'k', 1, 9]], 'strict');
  });

  test('Sum(Remainder(1, j/m), Limits(j, 0, 9)) declines', () => {
    const outcome = compileWith(
      engine().box(['Sum', ['Remainder', 1, ['Divide', 'j', 'n']], ['Limits', 'j', 0, 9]]),
      'strict',
      true
    );
    expect('message' in outcome && outcome.message).toMatch(
      /has a term that can throw or integrates numerically \(Remainder\(1, j \/ n\)\)/
    );
  });
});

describe('a decided selection as an operand', () => {
  // The route writes the selected branch in the parent, which sees through
  // it; the existing compiler writes the selection as a computed operand
  // in parentheses. The selection is admitted at the root, and as an
  // operand only when the selected branch is a symbol with no value
  // (`refuseOperandSelection()`).
  const BRANCHES: [string, MathJsonExpression][] = [
    ['x', 'x'],
    ['0', 0],
    ['-0', { num: '-0' } as unknown as MathJsonExpression],
    ['1', 1],
    ['1/3', ['Rational', 1, 3]],
    ['i', ['Complex', 0, 1]],
    ['x + 1', ['Add', 'x', 1]],
    ['Haversine(x)', ['Haversine', 'x']],
    ['[1, 2]', ['List', 1, 2]],
  ];
  const PARENTS: [string, (s: MathJsonExpression) => MathJsonExpression][] = [
    ['the root', (s) => s],
    ['a sum', (s) => ['Add', 'y', s]],
    ['a product', (s) => ['Multiply', 2, s]],
    ['a quotient', (s) => ['Divide', 2, s]],
    ['a power', (s) => ['Power', s, 2]],
    ['a negation', (s) => ['Negate', s]],
    ['a comparison', (s) => ['If', ['Less', s, 'y'], 1, 2]],
    ['a function argument', (s) => ['Sin', s]],
    ['a complex sum', (s) => ['Add', 'z', s]],
    ['a complex product', (s) => ['Multiply', 'z', s]],
    ['a list element', (s) => ['At', ['List', s, 1], 1]],
    ['Floor', (s) => ['Floor', s]],
  ];
  const POINTS = [
    { x: -0, y: -0, z: { re: -0, im: 1 } },
    { x: 0, y: 1.5, z: { re: 1, im: -0 } },
    { x: -2.5, y: -0, z: { re: -0, im: -0 } },
  ];
  const cases = BRANCHES.flatMap(([b, branch]) =>
    PARENTS.flatMap(([p, parent]) =>
      MODES.map((mode) => [`${b} in ${p} (${mode})`, parent(['Which', ['Less', 2, 3], branch, 'True', 1]), mode] as const)
    )
  );
  test.each(cases)('%s', (_name, json, mode) => {
    const expr = engine().box(json);
    const profile = compileWith(expr, mode, true);
    if (!('result' in profile)) {
      expect(profile.message).not.toMatch(/internal error/);
      return;
    }
    const existing = compileWith(expr, mode, false);
    if (!('result' in existing)) throw new Error(`existing: ${existing.message}`);
    for (const point of POINTS) {
      const vars = Object.fromEntries(inputsOf(expr).map((n) => [n, point[n as 'x']]));
      expect([vars, same(run(profile.result, vars), run(existing.result, vars))]).toEqual([vars, true]);
    }
  });

  test('the two witnesses decline', () => {
    expectDecline(
      ['Add', 'z', ['Which', ['Less', 2, 3], 0, 'True', 1]],
      'complex',
      /selects 0 as an operand, which the existing compiler writes as a computed operand in parentheses/
    );
    expectDecline(
      ['Function', ['Divide', 2, ['Which', ['Less', 2, 3], ['Haversine', 't'], 'True', 0]], 't'],
      'strict',
      /selects hav\(t\) as an operand|selects Haversine\(t\) as an operand/
    );
  });
});

describe('the symbols True and False as a condition', () => {
  // The existing compiler decides an `If` by the type of its condition
  // (`booleanClaim()`): the symbol `True` has the type `boolean`, so
  // `If(True, x, z)` keeps its test and its two arms. A `Which` clause whose
  // condition is the symbol `True` is selected; the symbol `False` is not
  // decided (`liveSelectionArms()`).
  const POINTS = [
    { x: -0, y: 1.5, z: { re: -0, im: 1 } },
    { x: 1.5, y: -0, z: { re: 1, im: -0 } },
  ];
  test.each<[string, MathJsonExpression]>([
    ['If(True, x, z)', ['If', 'True', 'x', 'z']],
    ['If(False, x, z)', ['If', 'False', 'x', 'z']],
    ['1 + If(True, x, z)', ['Add', 1, ['If', 'True', 'x', 'z']]],
    ['1 + If(False, x, z)', ['Add', 1, ['If', 'False', 'x', 'z']]],
    ['If(True, x, y)', ['If', 'True', 'x', 'y']],
    ['Which(True, x)', ['Which', 'True', 'x']],
    ['Which(False, x, True, y)', ['Which', 'False', 'x', 'True', 'y']],
    ['If(2 < 3, x, z)', ['If', ['Less', 2, 3], 'x', 'z']],
  ])('%s: the values of the existing compiler, or a decline', (_name, json) => {
    for (const mode of MODES) {
      const expr = engine().box(json);
      const profile = compileWith(expr, mode, true);
      if (!('result' in profile)) {
        expect(profile.message).not.toMatch(/internal error/);
        continue;
      }
      const existing = compileWith(expr, mode, false);
      if (!('result' in existing)) throw new Error(`existing: ${existing.message}`);
      for (const point of POINTS) {
        const vars = Object.fromEntries(inputsOf(expr).map((n) => [n, point[n as 'x']]));
        expect([mode, vars, same(run(profile.result, vars), run(existing.result, vars))]).toEqual([mode, vars, true]);
      }
    }
  });

  test('If(True, x, y) keeps its test, as before the selection of constant conditions', () => {
    const profile = compileWith(engine().box(['If', 'True', 'x', 'y']), 'strict', true);
    if (!('result' in profile)) throw new Error(profile.message);
    expect(profile.result.code).toBe('true ? _.x : _.y');
  });

  test('If(True, x, z) in the complex mode is the conditional of the existing compiler', () => {
    const profile = compileWith(engine().box(['If', 'True', 'x', 'z']), 'complex', true);
    if (!('result' in profile)) throw new Error(profile.message);
    expect(profile.result.code).toBe('true ? ({ re: _.x, im: 0 }) : _.z');
  });

  test('Which(True, x) and If(2 < 3, x, z) select their branch', () => {
    for (const [json, code] of [
      [['Which', 'True', 'x'], '_.x'],
      [['If', ['Less', 2, 3], 'x', 'z'], '_.x'],
    ] as [MathJsonExpression, string][]) {
      const profile = compileWith(engine().box(json), 'complex', true);
      if (!('result' in profile)) throw new Error(profile.message);
      expect(profile.result.code).toBe(code);
    }
  });
});
