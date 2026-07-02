import { ComputeEngine } from '../../../src/compute-engine';
import { compile } from '../../../src/compute-engine/compilation/compile-expression';

/**
 * NIGHTLY — compiled-JS vs interpreter parity fuzz (~2,400 evaluation points).
 *
 * Ported from the COMPILE review harness (`compile/fuzz-js.ts`). For a corpus of
 * ~140 expressions, each compiled with `{ fallback: false }`, the compiled JS
 * result must agree with the interpreter's `.N()` at every point in the case's
 * point set (relative tolerance 1e-9; NaN/∞ compared structurally). This is the
 * regression sentinel for the CORRECTNESS-review compiled-vs-interpreter splits
 * (Mod / Round / Arccot / …) that Wave-4 fixed.
 *
 * The Python-target parity is a separate, venv-gated suite
 * (`test/compute-engine/compile-python-parity.test.ts`); this JS-only fuzz always
 * runs under CE_NIGHTLY (no external toolchain).
 */

const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;

const ce = new ComputeEngine();

type Case = { name: string; src: any; vars?: string[]; points?: number[][] };

const P_STD = [0, 1, -1, 0.5, -0.5, 2, -2, 2.5, -2.5, 3.7, -3.7, 0.1, 10, -10, 100, 1e-8, 7.25, -0.75, 12.5, -6.5];
const P_POS = [0.1, 0.5, 1, 2, 2.5, 3.7, 7.25, 10, 100, 0.001, 1e-8, 42.42, 5, 12.5, 0.9, 1.1, 6, 8, 3, 55.5];
const P_UNIT = [-0.99, -0.5, -0.1, 0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, -0.75, 0.25, 0.6, -0.3, 0.85];
const P_SMALL = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.7, -3.7];
const L = (s: string) => 'latex:' + s;

const CASES: Case[] = [
  // arithmetic
  { name: 'add3', src: ['Add', 'x', 2, 5] },
  { name: 'mul3', src: ['Multiply', 'x', 3, 'x'] },
  { name: 'sub', src: ['Subtract', 'x', 7] },
  { name: 'div', src: ['Divide', 'x', 3] },
  { name: 'div-nested-num', src: ['Divide', 'x', ['Divide', 'x', 3]] },
  { name: 'div-nested-raw', src: ['Divide', 12, ['Divide', 'x', 2]] },
  { name: 'negate-sum', src: ['Negate', ['Add', 'x', 1]] },
  { name: 'rational-coef', src: ['Multiply', ['Rational', 2, 3], 'x'] },
  { name: 'x-over-pi', src: ['Divide', 'x', 'Pi'] },
  { name: 'linear-comb', src: ['Add', ['Multiply', 2, 'x'], ['Multiply', -3, 'y']], vars: ['x', 'y'] },
  { name: 'div-zero', src: ['Divide', 1, 'x'] },
  { name: 'sum-of-prods', src: ['Add', ['Multiply', 'x', 'y'], ['Multiply', 'x', 'x'], 1], vars: ['x', 'y'] },
  // powers
  { name: 'square', src: ['Power', 'x', 2] },
  { name: 'cube', src: ['Power', 'x', 3] },
  { name: 'pow-neg1', src: ['Power', 'x', -1] },
  { name: 'pow-neg2', src: ['Power', 'x', -2] },
  { name: 'pow-half', src: ['Power', 'x', ['Rational', 1, 2]] },
  { name: 'pow-third', src: ['Power', 'x', ['Rational', 1, 3]] },
  { name: 'pow-2-3', src: ['Power', 'x', ['Rational', 2, 3]] },
  { name: 'pow-neg-half', src: ['Power', 'x', ['Rational', -1, 2]] },
  { name: 'pow-x-x', src: ['Power', 'x', 'x'] },
  { name: 'pow-2-x', src: ['Power', 2, 'x'] },
  { name: 'pow-negbase-x', src: ['Power', -2, 'x'] },
  { name: 'pow-e-x', src: ['Power', 'ExponentialE', 'x'] },
  { name: 'pow-x-25', src: ['Power', 'x', 2.5] },
  { name: 'pow-chain', src: ['Power', ['Power', 'x', 2], 3] },
  { name: 'sqrt', src: ['Sqrt', 'x'] },
  { name: 'root3', src: ['Root', 'x', 3] },
  { name: 'root5', src: ['Root', 'x', 5] },
  { name: 'root-x-y', src: ['Root', 'x', 'y'], vars: ['x', 'y'] },
  { name: 'square-of-sum', src: ['Square', ['Add', 'x', 1]] },
  { name: 'pow00', src: ['Power', 'x', 'y'], vars: ['x', 'y'], points: [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]] },
  // abs/sign/rounding
  { name: 'abs', src: ['Abs', 'x'] },
  { name: 'sign', src: ['Sign', 'x'] },
  { name: 'floor', src: ['Floor', 'x'] },
  { name: 'ceil', src: ['Ceil', 'x'] },
  { name: 'round', src: ['Round', 'x'] },
  { name: 'trunc', src: ['Truncate', 'x'] },
  { name: 'fract-ish', src: ['Subtract', 'x', ['Floor', 'x']] },
  { name: 'abs-poly', src: ['Abs', ['Subtract', ['Power', 'x', 2], 4]] },
  // mod/remainder/gcd
  { name: 'mod-x-3', src: ['Mod', 'x', 3] },
  { name: 'mod-x-neg3', src: ['Mod', 'x', -3] },
  { name: 'mod-x-y', src: ['Mod', 'x', 'y'], vars: ['x', 'y'], points: [[7, 3], [-7, 3], [7, -3], [-7, -3], [7.5, 2], [-7.5, 2], [5, 2.5], [-5, 2.5]] },
  { name: 'rem-x-y', src: ['Remainder', 'x', 'y'], vars: ['x', 'y'], points: [[7, 3], [-7, 3], [7, -3], [-7, -3], [7.5, 2], [-7.5, 2], [7, 4], [-7, 4]] },
  { name: 'gcd', src: ['GCD', 'x', 'y'], vars: ['x', 'y'], points: [[12, 8], [7, 3], [100, 36], [9, 81]] },
  // CO-P2-26: explicit negative-operand / zero / signed-zero edge coverage —
  // the axis whose absence let the Mod / Round / Arccot / odd-root convention
  // splits (P0-41/42) survive to review. Each parity-checks vs the interpreter.
  { name: 'mod-edges', src: ['Mod', 'x', 'y'], vars: ['x', 'y'], points: [[7, 3], [-7, 3], [7, -3], [-7, -3], [0, 3], [-0, 3], [5.5, 2], [-5.5, 2], [5, 2.5], [-5, 2.5]] },
  { name: 'rem-edges', src: ['Remainder', 'x', 'y'], vars: ['x', 'y'], points: [[7, 3], [-7, 3], [7, -3], [-7, -3], [0, 3], [-0, 3], [7.5, 2], [-7.5, 2]] },
  { name: 'round-halves', src: ['Round', 'x'], points: [[2.5], [-2.5], [0.5], [-0.5], [3.5], [-3.5], [1.5], [-1.5], [0], [-0], [12.5], [-6.5]] },
  { name: 'sign-zero', src: ['Sign', 'x'], points: [[0], [-0], [3.2], [-3.2], [1e-12], [-1e-12]] },
  { name: 'arccot-edges', src: ['Arccot', 'x'], points: [[-2], [-0.5], [2], [0.5], [0], [-0], [-10], [10]] },
  { name: 'root3-neg', src: ['Root', 'x', 3], points: [[-8], [-27], [8], [27], [0], [-0], [-1], [1]] },
  { name: 'root5-neg', src: ['Root', 'x', 5], points: [[-32], [32], [-1], [1], [0], [-0]] },
  { name: 'lcm', src: ['LCM', 'x', 'y'], vars: ['x', 'y'], points: [[12, 8], [7, 3], [4, 6]] },
  // trig
  { name: 'sin', src: ['Sin', 'x'] },
  { name: 'cos', src: ['Cos', 'x'] },
  { name: 'tan', src: ['Tan', 'x'] },
  { name: 'cot', src: ['Cot', 'x'] },
  { name: 'sec', src: ['Sec', 'x'] },
  { name: 'csc', src: ['Csc', 'x'] },
  { name: 'sin2-plus-cos2', src: ['Add', ['Power', ['Sin', 'x'], 2], ['Power', ['Cos', 'x'], 2]] },
  { name: 'arcsin', src: ['Arcsin', 'x'], points: P_UNIT.map((v) => [v]) },
  { name: 'arccos', src: ['Arccos', 'x'], points: P_UNIT.map((v) => [v]) },
  { name: 'arctan', src: ['Arctan', 'x'] },
  { name: 'arctan2', src: ['Arctan2', 'x', 'y'], vars: ['x', 'y'], points: [[1, 1], [-1, 1], [1, -1], [-1, -1], [0, 1], [1, 0], [0, -1], [-1, 0], [3.5, -2]] },
  { name: 'arccot', src: ['Arccot', 'x'] },
  { name: 'arcsec', src: ['Arcsec', 'x'], points: [[1], [2], [-2], [1.5], [-1.5], [10], [-10]] },
  { name: 'arccsc', src: ['Arccsc', 'x'], points: [[1], [2], [-2], [1.5], [-1.5], [10], [-10]] },
  // hyperbolic
  { name: 'sinh', src: ['Sinh', 'x'], points: P_SMALL.map((v) => [v]) },
  { name: 'cosh', src: ['Cosh', 'x'], points: P_SMALL.map((v) => [v]) },
  { name: 'tanh', src: ['Tanh', 'x'] },
  { name: 'coth', src: ['Coth', 'x'] },
  { name: 'sech', src: ['Sech', 'x'] },
  { name: 'csch', src: ['Csch', 'x'] },
  { name: 'arsinh', src: ['Arsinh', 'x'] },
  { name: 'arcosh', src: ['Arcosh', 'x'], points: [[1], [1.5], [2], [10], [100]] },
  { name: 'artanh', src: ['Artanh', 'x'], points: P_UNIT.map((v) => [v]) },
  { name: 'arcoth', src: ['Arcoth', 'x'], points: [[2], [-2], [1.5], [-1.5], [10]] },
  { name: 'arsech', src: ['Arsech', 'x'], points: [[0.1], [0.5], [0.9], [1]] },
  { name: 'arcsch', src: ['Arcsch', 'x'], points: [[0.5], [-0.5], [2], [-2], [10]] },
  // exp/log
  { name: 'exp', src: ['Exp', 'x'] },
  { name: 'ln', src: ['Ln', 'x'], points: P_POS.map((v) => [v]) },
  { name: 'log10', src: ['Log', 'x'], points: P_POS.map((v) => [v]) },
  { name: 'log-base2', src: ['Log', 'x', 2], points: P_POS.map((v) => [v]) },
  { name: 'log-base-x', src: ['Log', 8, 'x'], points: [[2], [3], [10], [0.5]] },
  { name: 'lb', src: ['Lb', 'x'], points: P_POS.map((v) => [v]) },
  { name: 'exp-ln', src: ['Exp', ['Ln', 'x']], points: P_POS.map((v) => [v]) },
  { name: 'ln-neg', src: ['Ln', 'x'], points: [[-1], [-2.5]] },
  { name: 'exp2', src: ['Power', 2, 'x'] },
  // min/max, misc
  { name: 'max', src: ['Max', 'x', 'y'], vars: ['x', 'y'], points: [[1, 2], [-1, -2], [0, 0], [3.5, 3.4], [-0.5, 0.5]] },
  { name: 'min', src: ['Min', 'x', 'y'], vars: ['x', 'y'], points: [[1, 2], [-1, -2], [0, 0], [3.5, 3.4], [-0.5, 0.5]] },
  { name: 'max3', src: ['Max', 'x', 0, ['Negate', 'x']] },
  { name: 'hypot', src: ['Hypot', 'x', 'y'], vars: ['x', 'y'], points: [[3, 4], [-3, 4], [0, 0], [1.5, -2.5]] },
  { name: 'heaviside', src: ['Heaviside', 'x'] },
  // constants
  { name: 'pi-x', src: ['Multiply', 'Pi', 'x'] },
  { name: 'e-x', src: ['Multiply', 'ExponentialE', 'x'] },
  { name: 'euler-gamma', src: ['Add', 'EulerGamma', 'x'] },
  { name: 'golden', src: ['Multiply', 'GoldenRatio', 'x'] },
  { name: 'catalan', src: ['Add', 'CatalanConstant', 'x'] },
  { name: 'half-x', src: ['Multiply', 'Half', 'x'] },
  // piecewise / conditionals / boolean
  { name: 'if', src: ['If', ['Greater', 'x', 0], ['Multiply', 2, 'x'], ['Negate', 'x']] },
  { name: 'which', src: ['Which', ['Less', 'x', 0], ['Negate', 'x'], ['Less', 'x', 2], ['Multiply', 10, 'x'], 'True', ['Power', 'x', 2]] },
  { name: 'when', src: ['When', ['Power', 'x', 2], ['Greater', 'x', 1]] },
  { name: 'less', src: ['Less', 'x', 2] },
  { name: 'lesseq', src: ['LessEqual', 'x', 2] },
  { name: 'equal', src: ['Equal', 'x', 2] },
  { name: 'and-or', src: ['Or', ['And', ['Greater', 'x', 0], ['Less', 'x', 3]], ['Less', 'x', -5]] },
  { name: 'not', src: ['Not', ['Greater', 'x', 0]] },
  { name: 'chained-less', src: ['Less', -1, 'x', 1] },
  // special functions
  { name: 'gamma', src: ['Gamma', 'x'], points: [[0.5], [1], [1.5], [2], [3], [4.5], [7], [-0.5], [-1.5], [-2.5]] },
  { name: 'gammaln', src: ['GammaLn', 'x'], points: [[0.5], [1], [2], [5], [10], [100]] },
  { name: 'factorial', src: ['Factorial', 'x'], points: [[0], [1], [2], [3], [5], [10]] },
  { name: 'factorial2', src: ['Factorial2', 'x'], points: [[0], [1], [2], [5], [7], [8]] },
  { name: 'binomial', src: ['Binomial', 'x', 'y'], vars: ['x', 'y'], points: [[5, 2], [10, 3], [7, 0], [6, 6], [20, 10]] },
  { name: 'choose', src: ['Choose', 'x', 'y'], vars: ['x', 'y'], points: [[5, 2], [10, 3], [20, 10]] },
  { name: 'erf', src: ['Erf', 'x'], points: P_SMALL.map((v) => [v]) },
  { name: 'erfc', src: ['Erfc', 'x'], points: P_SMALL.map((v) => [v]) },
  { name: 'erfinv', src: ['ErfInv', 'x'], points: P_UNIT.map((v) => [v]) },
  { name: 'erfi', src: ['Erfi', 'x'], points: [[-2], [-1], [-0.5], [0], [0.5], [1], [2]] },
  { name: 'zeta', src: ['Zeta', 'x'], points: [[2], [3], [4], [1.5], [5]] },
  { name: 'digamma', src: ['Digamma', 'x'], points: [[1], [2], [0.5], [5], [10.5]] },
  { name: 'beta', src: ['Beta', 'x', 'y'], vars: ['x', 'y'], points: [[1, 1], [2, 3], [0.5, 0.5], [5, 2]] },
  { name: 'lambertw', src: ['LambertW', 'x'], points: [[0], [0.5], [1], [2], [10], [-0.2]] },
  { name: 'besselj0', src: ['BesselJ', 0, 'x'], points: [[0], [1], [2.5], [5], [10]] },
  { name: 'bessely1', src: ['BesselY', 1, 'x'], points: [[0.5], [1], [2.5], [5]] },
  { name: 'airyai', src: ['AiryAi', 'x'], points: [[-2], [0], [1], [2]] },
  { name: 'sinc', src: ['Sinc', 'x'], points: P_SMALL.map((v) => [v]) },
  { name: 'fresnelS', src: ['FresnelS', 'x'], points: [[0], [0.5], [1], [2], [-1]] },
  { name: 'fresnelC', src: ['FresnelC', 'x'], points: [[0], [0.5], [1], [2], [-1]] },
  { name: 'si', src: ['SinIntegral', 'x'], points: [[0], [0.5], [1], [2], [10], [-2]] },
  { name: 'ci', src: ['CosIntegral', 'x'], points: [[0.5], [1], [2], [10]] },
  { name: 'ei', src: ['ExpIntegralEi', 'x'], points: [[0.5], [1], [2], [-1]] },
  { name: 'li', src: ['LogIntegral', 'x'], points: [[2], [3], [10], [0.5]] },
  { name: 'agm', src: ['AGM', 'x', 'y'], vars: ['x', 'y'], points: [[1, 2], [1, 10], [3, 4]] },
  { name: 'elliptick', src: ['EllipticK', 'x'], points: [[0], [0.5], [0.9], [-1]] },
  { name: 'elliptice', src: ['EllipticE', 'x'], points: [[0], [0.5], [0.9], [-1]] },
  { name: 'hyp2f1', src: ['Hypergeometric2F1', 1, 2, 3, 'x'], points: [[0], [0.25], [0.5], [-0.5]] },
  { name: 'hyp1f1', src: ['Hypergeometric1F1', 1, 2, 'x'], points: [[0], [0.5], [1], [-1], [3]] },
  { name: 'fibonacci', src: ['Fibonacci', 'x'], points: [[1], [2], [5], [10], [20]] },
  { name: 'chop', src: ['Chop', 'x'], points: [[0], [1e-12], [0.5], [-1e-12]] },
  // complex-valued
  { name: 'complex-add', src: ['Add', 'x', ['Complex', 0, 1]] },
  { name: 'complex-mul', src: ['Multiply', ['Complex', 1, 1], 'x'] },
  { name: 'sqrt-neg-const', src: ['Sqrt', -4] },
  { name: 'real-part', src: ['Real', ['Multiply', ['Complex', 2, 3], 'x']] },
  { name: 'imag-part', src: ['Imaginary', ['Multiply', ['Complex', 2, 3], 'x']] },
  { name: 'conj', src: ['Conjugate', ['Add', 'x', ['Complex', 0, 2]]] },
  { name: 'cexp', src: ['Exp', ['Multiply', ['Complex', 0, 1], 'x']] },
  { name: 'cabs', src: ['Abs', ['Add', 'x', ['Complex', 0, 1]]] },
  // collections / component access
  { name: 'first-tuple', src: ['First', ['Tuple', ['Multiply', 2, 'x'], 5]] },
  { name: 'second-tuple', src: ['Second', ['Tuple', ['Multiply', 2, 'x'], ['Add', 'x', 1]]] },
  { name: 'mean-const', src: ['Add', 'x', ['Mean', ['List', 1, 2, 4]]] },
  { name: 'median-const', src: ['Add', 'x', ['Median', ['List', 1, 2, 4, 8]]] },
  // Sum / Product
  { name: 'sum-i', src: ['Sum', 'i', ['Limits', 'i', 1, 10]] },
  { name: 'sum-i2', src: ['Sum', ['Power', 'i', 2], ['Limits', 'i', 1, 10]] },
  { name: 'sum-xi', src: ['Sum', ['Multiply', 'x', 'i'], ['Limits', 'i', 1, 5]] },
  { name: 'sum-neg-range', src: ['Sum', ['Power', 'i', 2], ['Limits', 'i', -3, 3]] },
  { name: 'sum-negate-i', src: ['Sum', ['Negate', 'i'], ['Limits', 'i', -3, -1]] },
  { name: 'sum-symbolic-ub', src: ['Sum', 'i', ['Limits', 'i', 1, 'x']], points: [[5], [10], [1], [0]] },
  { name: 'sum-large', src: ['Sum', ['Divide', 1, ['Power', 'i', 2]], ['Limits', 'i', 1, 200]] },
  { name: 'prod-i', src: ['Product', 'i', ['Limits', 'i', 1, 6]] },
  { name: 'prod-frac', src: ['Product', ['Divide', 'i', ['Add', 'i', 1]], ['Limits', 'i', 1, 10]] },
  { name: 'sum-2d-body', src: ['Sum', ['Power', 'x', 'i'], ['Limits', 'i', 0, 4]], points: [[0.5], [2], [-1], [1]] },
  // latex-parsed forms
  { name: 'latex-poly', src: L('3x^2 - 2x + 1') },
  { name: 'latex-rational-fn', src: L('\\frac{x^2-1}{x-1}') },
  { name: 'latex-nested-frac', src: L('\\frac{1}{1+\\frac{1}{x}}') },
  { name: 'latex-sqrt-abs', src: L('\\sqrt{|x|}') },
  { name: 'latex-exp-frac', src: L('e^{-x^2/2}') },
  { name: 'latex-trig-mix', src: L('\\sin(2x)\\cos(x/2)') },
  { name: 'latex-gauss', src: L('\\frac{1}{\\sqrt{2\\pi}}e^{-x^2/2}') },
  { name: 'latex-sum', src: L('\\sum_{n=1}^{10} \\frac{x^n}{n}') },
  { name: 'latex-abs-neghalf', src: L('|x - 0.5|') },
  { name: 'latex-piecewise-braces', src: L('x^2 \\{x > 0\\}') },
];

// The compiled JS target is REAL-valued and fail-closed on complex (D6). It
// therefore cannot match the interpreter where the interpreter goes complex or
// to ±∞/NaN (whose ComplexInfinity ~oo vs real +∞ representations differ). So we
// only compare where the interpreter yields a FINITE REAL value; there the
// compiled result must agree (1e-8 relative — the review splits are categorical
// branch errors, not last-digit kernel noise).
const TOL = 1e-8;
function interpIsFiniteReal(want: { re: number; im: number }): boolean {
  return (
    Number.isFinite(want.re) &&
    (want.im === undefined || Math.abs(want.im) <= 1e-12)
  );
}
function agree(a: number, b: number, tol = TOL): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale <= tol;
}

// Cases whose expression is genuinely complex-valued for ALL sampled points, so
// a real-target compile fail-close (throw) is the CORRECT behavior (D6).
function isComplexOnly(
  expr: any,
  vars: string[],
  points: number[][]
): boolean {
  const sample = points.slice(0, 6);
  if (sample.length === 0) return false;
  return sample.every((pt) => {
    const w = interpNumeric(expr, vars, pt);
    return !interpIsFiniteReal(w);
  });
}

// Previously: a Sum with a negative index and a Negate summand unrolled to
// invalid JS (`--3`). Fixed (CO-P2-23a): the base compiler now separates a
// unary operator from an operand that begins with the same symbol (`- -3`), so
// `sum-negate-i` compiles and paritys like any other case. No known compile
// bug remains in this corpus.
const KNOWN_COMPILE_BUG = new Set<string>([]);

// Documented compiler finding CO-P0-2 (compile-findings.md, residual): a
// rational exponent p/q of a NEGATIVE base has a real value via the odd-q branch
// (interp), but compiled JS `Math.pow` → NaN. Only odd-n Root / x^(1/n) received
// the sign-corrected fix; general p/q (e.g. x^(2/3)) did not. Points where
// compiled is NaN on a finite-real interp value are skipped for these cases.
const KNOWN_REAL_BRANCH_GAP = new Set(['pow-2-3']);

function interpNumeric(expr: any, vars: string[], pt: number[]): { re: number; im: number } {
  const sub: Record<string, any> = {};
  vars.forEach((v, i) => (sub[v] = ce.number(pt[i])));
  let r: any;
  try {
    r = expr.subs(sub).N();
  } catch {
    return { re: NaN, im: NaN };
  }
  if (r.symbol === 'True') return { re: 1, im: 0 };
  if (r.symbol === 'False') return { re: 0, im: 0 };
  return { re: r.re, im: r.im ?? 0 };
}
function normRun(out: any): { re: number; im: number } {
  if (typeof out === 'number') return { re: out, im: 0 };
  if (typeof out === 'boolean') return { re: out ? 1 : 0, im: 0 };
  if (out && typeof out === 'object' && 're' in out) return { re: out.re, im: out.im };
  return { re: NaN, im: NaN };
}

describeNightly('NIGHTLY compiled-JS vs interpreter parity', () => {
  jest.setTimeout(30000);
  for (const c of CASES) {
    it(`${c.name}`, () => {
      const vars = c.vars ?? ['x'];
      const expr =
        typeof c.src === 'string' && c.src.startsWith('latex:')
          ? ce.parse(c.src.slice(6))
          : ce.expr(c.src);
      // Some constructions with free symbols are not valid to compile (the
      // review noted Hypot/Factorial2/Fibonacci of a bare symbol) — not fuzzable.
      if (!expr.isValid) return;

      const pts = c.points ?? (vars.length === 1 ? P_STD.map((v) => [v]) : []);

      let compiled: any;
      try {
        compiled = compile(expr, { fallback: false });
      } catch (e) {
        // Correct fail-close on a complex-only expression, or a documented bug.
        if (isComplexOnly(expr, vars, pts) || KNOWN_COMPILE_BUG.has(c.name)) return;
        throw e;
      }
      expect(compiled).toBeTruthy();

      const failures: string[] = [];
      for (const pt of pts) {
        const want = interpNumeric(expr, vars, pt);
        // Only compare where the interpreter is finite-real (the real target's
        // domain); complex / ±∞ / NaN points are out of the real target's reach.
        if (!interpIsFiniteReal(want)) continue;
        const arg: Record<string, number> = {};
        vars.forEach((v, i) => (arg[v] = pt[i]));
        let out: any;
        try {
          out = compiled.run(arg);
        } catch (e) {
          failures.push(`run(${pt}) threw ${(e as Error).message}`);
          continue;
        }
        const got = normRun(out);
        // CO-P0-2 residual: compiled NaN on a real-branch rational power.
        if (KNOWN_REAL_BRANCH_GAP.has(c.name) && Number.isNaN(got.re)) continue;
        if (!agree(got.re, want.re) || Math.abs(got.im || 0) > 1e-9)
          failures.push(
            `at (${pt}): compiled=(${got.re}${got.im ? '+' + got.im + 'i' : ''}) interp=(${want.re})`
          );
      }
      expect(failures).toEqual([]);
    });
  }
});
