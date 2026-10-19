// Symbolic residue calculus (ROADMAP item 7, part c).
//
// `residue(f, x, a)` computes the residue of `f` (a function of `x`) at the
// point `x = a` — the coefficient of `(x − a)⁻¹` in the Laurent expansion of
// `f` about `a`. It is the engine behind the `Residue` operator.
//
// Method: for a pole of order `m`,
//
//     Res_{x=a} f = lim_{x→a} 1/(m−1)! · dᵐ⁻¹/dxᵐ⁻¹ [ (x − a)ᵐ · f(x) ]
//
// The order is found by probing `lim (x−a)ⁿ f` for increasing `n` (the smallest
// `n` with a finite limit is the order; an analytic `f` falls out as order 1
// with residue 0). The computation reuses the symbolic limit engine
// (`symbolicLimit`) and `differentiate`, so it stays exact whenever they do.
//
// When the generic limit method cannot expand a special function at its pole
// (e.g. `Gamma` near a non-positive integer), it falls back to a small table of
// closed-form residues, gated by the analytic-property metadata store
// confirming the point is a recorded pole of that function.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isEntireIn, symbolicLimit } from './limit.js';
import { laurentData, freshSymbol } from './series.js';
import { differentiate } from './derivative.js';
import { expandAll } from '../boxed-expression/expand.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getFunctionProperties } from '../function-properties/index.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  exponentialArgument,
  nonzeroResidueConstant,
  polynomialExponentialSingularity,
} from './essential-residue.js';
import { exactComplexParts, exactlyEqual, exactSign } from './contour.js';

// The base `Expression` type only exposes operands after a type guard; the
// boxed objects always have an `ops` getter (see limit.ts for the same idiom).
const oo = (e: Expression): ReadonlyArray<Expression> =>
  (e as unknown as { ops: ReadonlyArray<Expression> | null }).ops ?? [];

const MAX_ORDER = 8;

function factorialBig(n: number): bigint {
  let r = 1n;
  for (let i = 2; i <= n; i++) r *= BigInt(i);
  return r;
}

/**
 * Residue of `body` (a function of `varName`) at `varName = point`, or
 * `undefined` when it cannot be determined (the operator then stays symbolic).
 *
 * An infinite `point` (`∞`, `−∞`, `~∞`) is the Riemann-sphere point at
 * infinity: `Res_∞ f = −Res_{s=0} f(1/s)/s²`.
 */
export function residue(
  body: Expression,
  varName: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (point.isInfinity === true) {
    // Res_∞ f = −Res_{s=0} [f(1/s)/s²] (7c follow-up rung). All infinite
    // point spellings name the same Riemann-sphere point, and the
    // substitution reuses this function at 0, where the Laurent kernel and
    // the probing paths apply unchanged.
    const s = freshSymbol(body, varName);
    const sSym = ce.symbol(s);
    const g = body.subs({
      [varName]: ce.function('Divide', [ce.One, sSym]),
    });
    const integrand = ce.function('Divide', [
      ce.function('Negate', [g]),
      ce.function('Power', [sSym, 2]),
    ]);
    return residue(integrand, s, ce.Zero, ce);
  }
  if (point.isFinite === false) return undefined;

  // P(z)·exp(c/(z − a)) with a polynomial P has its only finite
  // singularity at a. At another point it is analytic, so the residue is 0.
  // Equality of the point and a must be proved with exact arithmetic. The
  // `.sub()` method folds two exact literals to a float, and a float
  // difference of 0 does not prove equality: the rational
  // 14142135623730951/10^16 and √2 are distinct, but their float difference
  // can be 0. When exact arithmetic cannot decide (a point that is not an
  // exact constant, for example), the general methods below decide.
  const essential = polynomialExponentialSingularity(body, varName);
  if (essential) {
    const same = exactlyEqual(point, essential.point);
    if (same === true) return essential.residue;
    if (same === false) return ce.Zero;
    if (
      nonzeroResidueConstant(ce.function('Subtract', [point, essential.point]))
    )
      return ce.Zero;
  }

  // For meromorphic inputs, use the Laurent kernel first: the residue is
  // the coefficient of `(x − a)⁻¹` in the exact Laurent expansion, and the
  // kernel models the special-function poles (Gamma/Digamma/Zeta) and their
  // meromorphic combinations — including the shapes the paths below cannot
  // reach (a special-function cofactor like `Γ(s)·ζ(s)` at 1, higher-order
  // special poles like `Γ(x)²` at 0). A `null` (kernel declined or window
  // exhausted) falls through to the closed-form table and the limit-based
  // order probing; those remain authoritative for what the kernel can't
  // expand.
  // W = 4 is ample: the residue is the single coefficient at power −1, and
  // the kernel deepens internally where a denominator's pole order demands
  // it (`reciprocalOfExpr` re-expands to `W + 2m`). Larger windows only
  // inflate the exact symbolic γ/ζ(k) coefficient arithmetic (the Γ
  // coefficients grow quickly with order).
  // A branch point or a point on a branch cut has no Laurent expansion, so
  // no residue. The probing of `lim (x − a)ⁿ·f` below cannot see a branch
  // point: it reads `lim x·(√x/x) = 0` as a simple pole with residue 0. The
  // Laurent kernel cannot see a cut: it expands `1/√(x² − 2)` at 1, where
  // `x² − 2 = −1` is on the cut of `√`, as an analytic function.
  if (hasBranchPointAt(body, varName, point)) return undefined;

  // At a point with a radical (`√2`) or a point that is not real, the
  // coefficients of the Laurent kernel are not expanded: the residue of
  // 1/((x + 1)² − 3 − 2√2) at √2 holds the factor `(√2 + 1)² − 3 − 2√2`,
  // which is 0 although it does not fold. At such a point, the exact Taylor
  // method for a quotient of functions analytic at the point runs first: it
  // expands each coefficient, so its value is more readable. At a rational
  // point or a float, the values of a polynomial fold, and the kernel is
  // used first.
  if (!(isNumber(point) && (point.isRational === true || !point.isExact))) {
    const quotient = quotientPoleResidue(body, varName, point, ce);
    if (quotient !== undefined) return quotient;
  }

  const lau = laurentData(body, varName, point, ce, 4);
  if (lau) {
    if (lau.v >= 0) return ce.Zero; // analytic or removable — residue 0
    const c = lau.coeff(-1).evaluate();
    if (c.isValid && c.isNaN !== true) return c;
  }

  // A real-direction limit cannot establish a removable complex singularity:
  // exp(-1/z²), for example, decays on the real axis but is essential at 0.
  // Unsupported exponential principal parts must not reach pole-order probing.
  // The scan below looks for exponentials only; without one, it has nothing
  // to find.
  let scanBudget = 512;
  const polarExponential = (e: Expression): boolean => {
    checkDeadline(ce._deadlineFrame);
    if (--scanBudget < 0) return true;
    const arg = exponentialArgument(e);
    if (arg) {
      const local = laurentData(arg, varName, point, ce, 4);
      if (local && local.v < 0) return true;
      // At a symbolic centre the Laurent kernel may itself decline. A zero
      // divisor there still prevents us from assuming an analytic argument.
      if (
        !local &&
        arg.denominator.has(varName) &&
        arg.denominator
          .subs({ [varName]: point })
          .simplify()
          .isSame(0)
      )
        return true;
    }
    return oo(e).some(polarExponential);
  };
  if ((body.has('Exp') || body.has('ExponentialE')) && polarExponential(body))
    return undefined;

  // Authoritative closed-form residues for recognized special functions. This
  // runs before the generic limit method, which can't see a special
  // function's poles (it would treat e.g. Digamma(-1) as finite and return a
  // wrong 0).
  const special = specialFunctionResidue(body, varName, point, ce);
  if (special !== undefined) return special;

  const quotient = quotientPoleResidue(body, varName, point, ce);
  if (quotient !== undefined) return quotient;

  const x = ce.symbol(varName);
  const xMinusA = ce.function('Subtract', [x, point]);

  // Combine an expression into a single cancelled fraction. The limit engine
  // can resolve a 0/0 quotient (cancellation / L'Hôpital) but not the 0·∞ form
  // left by an un-cancelled product like `(x−a)ⁿ · f` — and `.simplify()` only
  // cancels polynomial numerators, missing `eˣ·(x−a)ⁿ/(x−a)ⁿ`. The
  // `numeratorDenominator` getter cancels common factors across the quotient.
  const frac = (e: Expression): Expression =>
    ce.function('Divide', e.numeratorDenominator);

  const shifted = (n: number): Expression =>
    frac(
      ce.function('Multiply', [
        ce.function('Power', [xMinusA, ce.number(n)]),
        body,
      ])
    );

  // Pole order m = smallest n ≥ 1 with a finite lim (x−a)ⁿ·f. An analytic f
  // gives a finite (zero) limit at n = 1, so its residue comes out 0.
  let order: number | undefined;
  let simpleLimit: Expression | undefined;
  for (let n = 1; n <= MAX_ORDER; n++) {
    checkDeadline(ce._deadlineFrame);
    const raw = symbolicLimit(shifted(n), varName, point, undefined, ce);
    const L = finiteLimit(raw);
    if (L !== undefined) {
      order = n;
      simpleLimit = L;
      break;
    }
    // A constant limit that is not known to be infinite, but that cannot be
    // proved finite (`tan(a)/(3a²)` at a point that is not real): the order
    // of the pole cannot be decided. The limits at the next orders do not
    // help, and their expressions grow at each order, so stop.
    if (
      raw !== undefined &&
      raw.isFinite !== false &&
      raw.isNaN !== true &&
      !raw.has(varName) &&
      raw.unknowns.length === 0
    )
      return undefined;
  }

  if (order === undefined) return undefined;

  // Simple pole: residue = lim (x−a)·f (already computed above).
  if (order === 1) return simpleLimit;

  // Order m ≥ 2: residue = lim dᵐ⁻¹[(x−a)ᵐ·f] / (m−1)!, keeping a single
  // cancelled fraction across each differentiation.
  let g: Expression = shifted(order);
  for (let k = 0; k < order - 1; k++) {
    checkDeadline(ce._deadlineFrame);
    const d = differentiate(g, varName);
    if (d === undefined) return undefined;
    g = frac(d);
  }
  const L = finiteLimit(symbolicLimit(g, varName, point, undefined, ce));
  if (L === undefined) return undefined;
  return ce.function('Divide', [L, ce.number(factorialBig(order - 1))]);
}

/**
 * Whether `e` has a branch point or a branch cut at `varName = point`, so
 * that it is not analytic there:
 *
 * - a root, a logarithm or a power with an exponent that is not an integer,
 *   of an argument that is 0 at the point: `√x`, `ln x` and `x^(1/3)` at 0,
 *   `√(x² − 2)` at √2. The value of the argument must be the number 0 or be
 *   proved exactly 0 (`exactlyEqual()`).
 * - a square root (or a root of even index), a logarithm or a power with an
 *   exponent that is not an integer, of an argument that is a negative real
 *   number at the point. The principal branch of each has its cut on the
 *   negative real axis, and a nonconstant argument crosses the cut near
 *   such a point: `√(x² − 2)` at 1, where `x² − 2 = −1`. The value of the
 *   argument must be proved negative (`isNegative`, or exact parts with an
 *   imaginary part 0 and a negative real part).
 */
function hasBranchPointAt(
  e: Expression,
  varName: string,
  point: Expression
): boolean {
  if (!e.has(varName)) return false;
  const args = oo(e);
  const op = e.operator;
  let arg: Expression | undefined;
  let cut = false;
  if (op === 'Sqrt' || op === 'Ln' || op === 'Log') {
    arg = args[0];
    cut = true;
  } else if (op === 'Root') {
    arg = args[0];
    const n = args[1];
    cut = !(isNumber(n) && n.isOdd === true);
  } else if (op === 'Power') {
    const k = args[1];
    if (!(isNumber(k) && k.isInteger === true)) {
      arg = args[0];
      cut = true;
    }
  }
  if (arg !== undefined && arg.has(varName)) {
    const v = arg.subs({ [varName]: point }).evaluate();
    const ce = e.engine;
    if (v.isSame(0) || exactlyEqual(v, ce.Zero) === true) return true;
    if (cut && isNegativeReal(v)) return true;
  }
  return args.some((a) => hasBranchPointAt(a, varName, point));
}

/** Whether the constant `v` is proved to be a negative real number. */
function isNegativeReal(v: Expression): boolean {
  if (v.isNegative === true) return true;
  if (v.unknowns.length > 0) return false;
  const parts = exactComplexParts(v);
  if (parts === undefined) return false;
  return (
    exactlyEqual(parts.y, v.engine.Zero) === true && exactSign(parts.x) === -1
  );
}

/**
 * Whether the constant `v` is proved to be off the principal branch cut
 * (−∞, 0] of `ln` and `√`: its imaginary part is proved not 0, or it is
 * proved real and positive (`exactComplexParts()`, `exactSign()`).
 */
function isOffPrincipalCut(v: Expression): boolean {
  if (v.unknowns.length > 0) return false;
  const parts = exactComplexParts(v);
  if (parts === undefined) return false;
  const y = exactSign(parts.y);
  if (y === 1 || y === -1) return true;
  return y === 0 && exactSign(parts.x) === 1;
}

/**
 * Whether `e` is proved analytic in `varName` at the exact constant
 * `point`, so that its Taylor coefficients there are the values of its
 * derivatives divided by the factorials. An entire function (`isEntireIn`)
 * is analytic at each point. Otherwise `e` must be built from
 * - sums, products and powers with an integer exponent of analytic
 *   functions, where a quotient or a negative power needs a value that is
 *   proved not 0 at the point (`exactlyEqual()`);
 * - `ln`, `log` with a constant base, `√`, a root and a power with a
 *   constant exponent that is not an integer, of an analytic argument whose
 *   value at the point is proved off the principal branch cut (−∞, 0]
 *   (`isOffPrincipalCut()`);
 * - `exp`, `sin`, `cos`, `sinh`, `cosh` of an analytic argument;
 * - `tan` and `sec` of an analytic argument whose value is not real (the
 *   zeros of `cos` are the real numbers π/2 + kπ only), or is real with a
 *   cosine that is proved not 0;
 * - `arctan` of an analytic argument whose value is off the cuts of
 *   `arctan`, the half-lines iy with |y| ≥ 1: its real part is proved not 0,
 *   or its real part is 0 and |y| < 1 is proved.
 * Any other function is not proved analytic.
 */
function isAnalyticAt(
  e: Expression,
  varName: string,
  point: Expression
): boolean {
  if (isEntireIn(e, varName)) return true;
  if (!isFunction(e)) return false;
  const ce = e.engine;
  const valueAt = (g: Expression): Expression =>
    g.subs({ [varName]: point }).evaluate();
  const analytic = (g: Expression): boolean => isAnalyticAt(g, varName, point);
  const nonzeroAt = (g: Expression): boolean =>
    exactlyEqual(valueAt(g), ce.Zero) === false;
  const offCutAt = (g: Expression): boolean =>
    analytic(g) && isOffPrincipalCut(valueAt(g));
  const ops = e.ops;
  switch (e.operator) {
    case 'Add':
    case 'Subtract':
    case 'Negate':
    case 'Multiply':
      return ops.every(analytic);
    case 'Divide':
      return analytic(ops[0]) && analytic(ops[1]) && nonzeroAt(ops[1]);
    case 'Power': {
      const [base, exponent] = ops;
      if (exponent.has(varName)) {
        // b^g = exp(g·ln b): analytic when g is, and b is off the cut of ln.
        if (sym(base) === 'ExponentialE') return analytic(exponent);
        return analytic(exponent) && offCutAt(base);
      }
      if (isNumber(exponent) && exponent.isInteger === true)
        return exponent.isNegative === true
          ? analytic(base) && nonzeroAt(base)
          : analytic(base);
      return offCutAt(base);
    }
    case 'Sqrt':
    case 'Root':
    case 'Ln':
      return offCutAt(ops[0]);
    case 'Log':
      return (ops.length === 1 || !ops[1].has(varName)) && offCutAt(ops[0]);
    case 'Exp':
    case 'Sin':
    case 'Cos':
    case 'Sinh':
    case 'Cosh':
      return analytic(ops[0]);
    case 'Tan':
    case 'Sec': {
      if (!analytic(ops[0])) return false;
      const v = valueAt(ops[0]);
      if (v.unknowns.length > 0) return false;
      const parts = exactComplexParts(v);
      if (parts === undefined) return false;
      const y = exactSign(parts.y);
      if (y === 1 || y === -1) return true;
      if (y !== 0) return false;
      const c = exactSign(ce.function('Cos', [parts.x]));
      return c === 1 || c === -1;
    }
    case 'Arctan': {
      if (!analytic(ops[0])) return false;
      const v = valueAt(ops[0]);
      if (v.unknowns.length > 0) return false;
      const parts = exactComplexParts(v);
      if (parts === undefined) return false;
      const x = exactSign(parts.x);
      if (x === 1 || x === -1) return true;
      if (x !== 0) return false;
      // 1 − y² > 0, that is |y| < 1.
      const gap = ce.function('Subtract', [
        ce.One,
        ce.function('Multiply', [parts.y, parts.y]),
      ]);
      return exactSign(gap) === 1;
    }
  }
  return false;
}

/**
 * Residue of `body` at a pole that comes from a zero of its denominator,
 * when its numerator and its denominator are analytic at the point
 * (`isAnalyticAt()`), from the Taylor coefficients of the numerator and of
 * the denominator at the point. At a point that is a sum (`1 + √2`,
 * `1/2 + (√3/2)i`), this method gives a more readable value than the
 * Laurent kernel, because each coefficient is expanded (`expandAll()`), and
 * the probing of `lim (x − a)ⁿ·f` there is slow, because each L'Hôpital
 * step differentiates a larger expression.
 *
 * Write `body` as `N/D` (`numeratorDenominator`), and let `nⱼ = N⁽ʲ⁾(a)/j!`
 * and `dⱼ = D⁽ʲ⁾(a)/j!` be the Taylor coefficients at the point `a`. When
 * `d₀ = … = dₘ₋₁ = 0` and `dₘ ≠ 0`, `D` has a zero of order `m`, and with
 * `t = x − a`
 *
 *     N/D = t⁻ᵐ · (n₀ + n₁t + …) / (dₘ + dₘ₊₁t + …)
 *
 * The residue is the coefficient `cₘ₋₁` of the power series of the
 * quotient on the right, with `c_k = (n_k − Σᵢ₌₁ᵏ dₘ₊ᵢ·c_{k−i}) / dₘ`. A zero
 * of `N` at the point needs no special case: the formula then gives the
 * residue of the reduced pole, or 0 for a removable point.
 *
 * The point must be a finite exact constant: then each coefficient is
 * finite, because `N` and `D` are analytic at the point. Each `dⱼ` must be decided exactly
 * to be 0 or not 0 (`exactlyEqual()`). The coefficients of `N` need no such
 * test, so `sin(a)` is a valid coefficient although `exactComplexParts()`
 * cannot compute its parts at a point that is not real. Returns `undefined`
 * otherwise, when `D` is not 0 at the point, and when the order is greater
 * than `MAX_ORDER`.
 */
function quotientPoleResidue(
  body: Expression,
  varName: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  // The point must be a finite exact constant. A derivative of a function
  // that is analytic at the point is analytic there too, so its value at
  // the point is finite.
  if (point.unknowns.length > 0 || exactComplexParts(point) === undefined)
    return undefined;
  const [num, den] = body.numeratorDenominator;
  if (!den.has(varName)) return undefined;
  // Both parts must be analytic at the point, so that their Taylor
  // coefficients are the values of their derivatives there. A numerator
  // with a branch point (`√x` at 0) has no such coefficients.
  if (!isAnalyticAt(num, varName, point) || !isAnalyticAt(den, varName, point))
    return undefined;

  // The Taylor coefficients of `g` at the point, in order. Each call of
  // `next()` returns the next coefficient, or `undefined` when it is not an
  // exact finite constant.
  const taylor = (g: Expression) => {
    let h: Expression | undefined = undefined;
    let j = 0;
    let factorial = 1n;
    return (): Expression | undefined => {
      checkDeadline(ce._deadlineFrame);
      if (h === undefined) h = g;
      else {
        const d = differentiate(h, varName);
        if (d === undefined) return undefined;
        h = d;
        j += 1;
        factorial *= BigInt(j);
      }
      // `evaluate()` does not expand a power of a sum, so the value is
      // expanded: `(1 + √2)³` becomes `7 + 5√2`. The coefficients then stay
      // small in the arithmetic below.
      const v = expandAll(h.subs({ [varName]: point }).evaluate()).evaluate();
      if (!v.isValid || v.isNaN === true || v.isFinite === false)
        return undefined;
      return factorial === 1n
        ? v
        : ce.function('Divide', [v, ce.number(factorial)]).evaluate();
    };
  };

  // The order `m` of the zero of `D`, then the coefficients dₘ … d₂ₘ₋₁.
  const nextD = taylor(den);
  let order = 0;
  const dCoeffs: Expression[] = [];
  for (; order <= MAX_ORDER; order++) {
    const d = nextD();
    if (d === undefined) return undefined;
    const zero = exactlyEqual(d, ce.Zero);
    if (zero === undefined) return undefined;
    if (zero === false) {
      dCoeffs.push(d);
      break;
    }
  }
  if (order === 0 || order > MAX_ORDER) return undefined;
  while (dCoeffs.length < order) {
    const d = nextD();
    if (d === undefined) return undefined;
    dCoeffs.push(d);
  }

  const nextN = taylor(num);
  const nCoeffs: Expression[] = [];
  for (let j = 0; j < order; j++) {
    const n = nextN();
    if (n === undefined) return undefined;
    nCoeffs.push(n);
  }

  const c: Expression[] = [];
  for (let k = 0; k < order; k++) {
    const terms: Expression[] = [nCoeffs[k]];
    for (let i = 1; i <= k; i++)
      terms.push(
        ce.function('Negate', [ce.function('Multiply', [dCoeffs[i], c[k - i]])])
      );
    c.push(
      ce.function('Divide', [ce.function('Add', terms), dCoeffs[0]]).evaluate()
    );
  }
  return readableValue(c[order - 1]);
}

/**
 * The limit `L` when it is known to be finite, or `undefined`.
 *
 * At a point that is a sum, the limit can be an exact constant whose
 * `isFinite` is `undefined`: the residue of 1/(x³ + 1) at
 * x = 1/2 + (√3/2)i is the limit `1/(3(1/2 + (√3/2)i)²)`, and `evaluate()`
 * does not expand the power of the sum. Such a constant is accepted when
 * `isFiniteConstant()` proves it finite.
 */
function finiteLimit(L: Expression | undefined): Expression | undefined {
  if (L === undefined || L.isFinite === true) return L;
  if (L.isFinite === false || L.isNaN === true) return undefined;
  if (L.unknowns.length > 0 || !isFiniteConstant(L)) return undefined;
  return readableValue(L);
}

/**
 * Whether the constant `c` is proved finite: a finite number literal or
 * constant symbol, or a sum, a product, a power with a nonnegative integer
 * exponent, `exp`, `sin`, `cos`, `sinh`, `cosh` or a root of finite
 * constants, or a quotient whose denominator is proved not 0
 * (`exactlyEqual()`). Any other constant is finite when its exact real and
 * imaginary parts can be computed (`exactComplexParts()` computes a quotient
 * only when it proves that the denominator is not 0). `sin(a)` for a point
 * `a` that is not real is finite by the first rule, although
 * `exactComplexParts()` cannot compute its parts.
 */
function isFiniteConstant(c: Expression): boolean {
  if (c.isFinite === true) return true;
  if (c.isFinite === false || c.isNaN === true) return false;
  const ops = oo(c);
  const ce = c.engine;
  switch (c.operator) {
    case 'Add':
    case 'Subtract':
    case 'Negate':
    case 'Multiply':
    case 'Exp':
    case 'Sin':
    case 'Cos':
    case 'Sinh':
    case 'Cosh':
    case 'Sqrt':
    case 'Root':
      if (ops.length > 0 && ops.every(isFiniteConstant)) return true;
      break;
    case 'Power': {
      const [base, k] = ops;
      if (sym(base) === 'ExponentialE' && isFiniteConstant(k)) return true;
      if (isNumber(k) && k.isInteger === true && isFiniteConstant(base)) {
        if (k.isNonNegative === true) return true;
        if (exactlyEqual(base, ce.Zero) === false) return true;
      }
      break;
    }
    case 'Divide':
      if (
        isFiniteConstant(ops[0]) &&
        isFiniteConstant(ops[1]) &&
        exactlyEqual(ops[1], ce.Zero) === false
      )
        return true;
      break;
  }
  return exactComplexParts(c) !== undefined;
}

/**
 * The finite constant `c` in a form in which its value can be read. When
 * the exact real and imaginary parts of `c` can be computed
 * (`exactComplexParts()`), a value that is not real is returned as
 * `re + im·i`: `1/(3(1/2 + (√3/2)i)²)` becomes `−1/6 − (√3/6)i`, and a value
 * whose two parts are 0 is returned as 0. Any other value is returned
 * unchanged: the real part that `exactComplexParts()` builds is not
 * reduced.
 */
function readableValue(c: Expression): Expression {
  if (c.unknowns.length > 0) return c;
  const parts = exactComplexParts(c);
  if (parts === undefined) return c;
  const ce = c.engine;
  if (exactlyEqual(parts.y, ce.Zero) === true)
    return exactlyEqual(parts.x, ce.Zero) === true ? ce.Zero : c;
  return ce
    .function('Add', [parts.x, ce.function('Multiply', [parts.y, ce.I])])
    .evaluate();
}

// Special functions with simple poles whose closed-form residues the generic
// limit method can't reach (it can't see the pole and would return a wrong 0).
const SPECIAL_POLE_FNS = ['Gamma', 'Digamma', 'Zeta'] as const;

// Residue ρ of the special function `op` at its simple pole `point`, gated by
// the analytic-property store; `undefined` if `point` is not a recorded simple
// pole of `op`.
function simplePoleResidue(
  op: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (point.im !== 0) return undefined;
  const re = point.re;

  // Synergy with the analytic-property store: require a recorded pole here.
  const poles = getFunctionProperties(ce, op)?.poles;
  if (!poles) return undefined;
  if (ce.function('Element', [point, poles]).evaluate().valueOf() !== true)
    return undefined;

  switch (op) {
    case 'Gamma': {
      // Simple pole at z = −n (n ≥ 0): residue = (−1)ⁿ / n!.
      if (!Number.isInteger(re) || re > 0) return undefined;
      const n = -re;
      return ce.function('Divide', [
        ce.number(n % 2 === 0 ? 1n : -1n),
        ce.number(factorialBig(n)),
      ]);
    }
    case 'Digamma':
      // Simple poles at z = −n: residue = −1.
      if (!Number.isInteger(re) || re > 0) return undefined;
      return ce.number(-1);
    case 'Zeta':
      // Simple pole at s = 1: residue = 1.
      if (re !== 1) return undefined;
      return ce.number(1);
  }
  return undefined;
}

// Residue of an expression whose only singularity at `point` is a simple pole
// of a recognized special function `s = Op(varName)`. Factor `f = h · s` with
// `h` analytic, so `Res[h·s] = h(point)·ρ` (ρ the residue of `s`). This handles
// bare `Op(x)` (`h = 1`) and composite forms (`c·Gamma(x)`, `Gamma(x)/(x−5)`,
// `x²·Digamma(x)`, …). It is gated on the body actually containing `Op(varName)`
// — otherwise a point that happens to be a recorded pole of some special
// function (e.g. `Zeta` at 1) would spuriously divide an unrelated body by it.
function specialFunctionResidue(
  body: Expression,
  varName: string,
  point: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const x = ce.symbol(varName);
  for (const op of SPECIAL_POLE_FNS) {
    if (!body.getSubexpressions(op).some((e) => sym(oo(e)[0]) === varName))
      continue;
    const rho = simplePoleResidue(op, point, ce);
    if (rho === undefined) continue;

    // Cofactor h = f / Op(x), which must be analytic at the point. If the body
    // had another singularity there (e.g. Op(x)² or Op(x)/(x−a)), h stays
    // singular → h(point) is not finite → skip (deferred), keeping the result
    // sound rather than wrong. (A cofactor that is itself an unreduced special
    // function — e.g. the Gamma·Zeta product at 1 — also defers.)
    const h = ce.function('Divide', [body, ce.function(op, [x])]).simplify();
    const hAtPoint = symbolicLimit(h, varName, point, undefined, ce);
    if (hAtPoint !== undefined && hAtPoint.isFinite === true)
      return ce.function('Multiply', [hAtPoint, rho]);
  }
  return undefined;
}
