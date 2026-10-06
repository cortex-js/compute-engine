import { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
  PureEngineView,
  SymbolDefinitions,
  TypeHandlerContext,
} from '../global-types.js';

import type { Type } from '../../common/type/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { functionResult, isPointElementType } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { checkType } from '../boxed-expression/validate.js';
import {
  rebindEscaping,
  rebindEscapingCurrentScope,
  liftIntegrand,
  defaultUnknown,
  hasSymbolicTranscendental,
  resolveToList,
  collectBinderNames,
  withValueShield,
  isOperatorDef,
  isValueDef,
} from '../boxed-expression/utils.js';
import {
  isFunction,
  isNumber,
  indeterminateFormAnswer,
  isSymbol,
  nanOperandAnswer,
  sym,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import {
  operandSites,
  operandsFrom,
  indexingSetSites,
  limitsIndexSites,
} from '../boxed-expression/binding-sites.js';
import { conditionalValue } from '../boxed-expression/conditional-value.js';
import { boundVariableNamesInOperand } from '../boxed-expression/binders.js';

import {
  applicable,
  applicableN1,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
  lookupApplicable,
} from '../function-utils.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { mixTags } from '../numerics/random.js';
import {
  adaptiveQuadrature,
  initialPanelsForDimensions,
  quadratureBeatsMonteCarlo,
} from '../numerics/gauss-kronrod.js';
import { integrateSemiInfiniteOscillatory } from '../numerics/oscillatory-quadrature.js';
import {
  centeredDiffHigherOrder,
  centeredDiffHigherOrderVector,
  limit,
  LIMIT_PROBE_ITERATION_BUDGET,
} from '../numerics/numeric.js';
import {
  derivative,
  differentiate,
  memoizedDerivativeResult,
  memoizedPartialDerivative,
} from '../symbolic/derivative.js';
import {
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
  isTupleShapedType,
} from '../collection-utils.js';
// Self-registers the `expr.explain('D')` driver (see explain.ts)
import '../symbolic/explain-derivative.js';
import { antiderivative } from '../symbolic/antiderivative.js';
import { integratePiecewise } from '../symbolic/piecewise-integrate.js';
import {
  definiteIntegralByResidues,
  divergentIntegralValue,
  singularPathValue,
} from '../symbolic/contour-definite-integrate.js';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials.js';
import {
  endpointPoleVerdict,
  isRealOnInterval,
  interiorPoleVerdict,
  symbolicPoleMayBeInside,
  type PoleVerdict,
} from '../symbolic/interior-pole.js';
import { dSolve } from '../symbolic/differential-equations.js';
import { rSolve } from '../symbolic/recurrences.js';
import {
  nDSolve,
  nDSolveFunction,
  interpolatingFunctionRows,
  symbolArg,
  symbolOrListArg,
} from '../differential-equation-utils.js';
import { evalDenseRows } from '../numerics/differential-equations.js';
import { rewriteAngularUnit } from '../symbolic/angular-unit.js';
import { hasNonRealConstant, symbolicLimit } from '../symbolic/limit.js';
import { residue } from '../symbolic/residue.js';
import { computeSeries, normalStrip } from '../symbolic/series.js';
import { canonicalLimits, canonicalLimitsSequence } from './utils.js';
import { implicitCompile } from '../implicit-compile.js';
import { containsResidueClass } from '../boxed-expression/residue-class.js';
import {
  libraryNamesShadowedIn,
  shadowedLibraryNames,
} from '../library-shadowing.js';

/**
 * The highest order the `D(f, {x, n})` spelling expands into `n` repeated
 * variables. Each order is one differentiation pass, so the work scales
 * with the VALUE of `n`; a larger order stays inert. A dedicated per-file
 * constant, as for the other value-scaled caps.
 */
const MAX_DERIVATIVE_ORDER = 1000;

/**
 * The highest total order for which the multi-index `Derivative` of an
 * operator (`Derivative(Power, k₁, k₂)`) builds its nested `D` expression,
 * one `D` for each unit of order. The evaluation of that expression recurses
 * once for each `D`, and near 500 levels it overflows the call stack (a
 * `RangeError` escaped the handler). A larger total order stays inert. The
 * cap loses few closed forms: measured, `Power` closes at order 32 but
 * stays inert at 64 after about 2 s of work, and `Arctan2` stays inert at
 * 64. `Multiply`, whose high partials are 0, is the exception.
 */
const MAX_NESTED_PARTIAL_ORDER = 64;

//
// ── Improper-integral endpoint limits (conditional-values Phase 3a) ──────
//
// FTC substitutes each bound into the antiderivative. At a *limit-point* bound
// (0, ±∞) the substitution can leave a parameter-dependent indeterminate — a
// Power with a base of 0/±∞ and a symbolic exponent (`0^{n+1}`, `∞^{1−s}`), or
// `e^{c·(±∞)}` with a symbolic rate `c`. Each such term has a limit of 0 on a
// convergence condition (`n+1 > 0`, `1−s < 0`, `c > 0`); we resolve it to 0 and
// carry the condition, so the definite integral becomes a `When`-guarded value.
// Anything outside this small table fails closed (caller stays inert) rather
// than leaking an indeterminate form.
//

/**
 * Classify a single node as a limit-point endpoint leak. Returns:
 *   - `{ value, guard }`  — a resolvable leak: its limit `value` under `guard`;
 *   - `'unresolvable'`    — a leak-family shape not covered (fail closed);
 *   - `null`             — not a leak (recurse into children).
 * A decidable (numeric) exponent is not a leak: it would already have folded.
 */
function classifyEndpointLeak(
  node: Expression,
  ce: ComputeEngine
): { value: Expression; guard: Expression } | 'unresolvable' | null {
  if (!isFunction(node, 'Power')) return null;
  const base = node.op1;
  const exp = node.op2;

  // x^p as x → 0⁺ : residual `0^p` → 0 when Re(p) > 0.
  if (base.isSame(0)) {
    if (isNumber(exp)) return null;
    return { value: ce.Zero, guard: ce.function('Greater', [exp, ce.Zero]) };
  }

  // x^p as x → +∞ : residual `(+∞)^p` → 0 when Re(p) < 0.
  if (base.isInfinity === true && base.isPositive === true) {
    if (isNumber(exp)) return null;
    return { value: ce.Zero, guard: ce.function('Less', [exp, ce.Zero]) };
  }

  // (−∞)^p : sign oscillation — not in the table.
  if (base.isInfinity === true && base.isNegative === true) {
    if (isNumber(exp)) return null;
    return 'unresolvable';
  }

  // e^{c·(±∞)} as x → ±∞ : → 0 when the exponent → −∞.
  if (isSymbol(base, 'ExponentialE')) return classifyExpEndpointLeak(exp, ce);

  return null;
}

/**
 * Classify an exponential endpoint leak `e^{q}` by its exponent `q`. Resolves
 * only `q = (±∞)·c` with a single infinite factor and a finite, non-numeric
 * cofactor `c`: the limit is 0 when `q → −∞`, i.e. `c > 0` for a `−∞` factor,
 * `c < 0` for a `+∞` factor.
 */
function classifyExpEndpointLeak(
  q: Expression,
  ce: ComputeEngine
): { value: Expression; guard: Expression } | 'unresolvable' | null {
  if (!isFunction(q, 'Multiply')) return null;
  let infSign = 0;
  const rest: Expression[] = [];
  for (const f of q.ops) {
    if (f.isInfinity === true) {
      if (infSign !== 0) return 'unresolvable';
      infSign = f.isPositive === true ? 1 : -1;
    } else rest.push(f);
  }
  if (infSign === 0 || rest.length === 0) return null;
  const cofactor = rest.length === 1 ? rest[0] : ce.function('Multiply', rest);
  if (isNumber(cofactor)) return null; // decidable → would have folded
  const guard =
    infSign < 0
      ? ce.function('Greater', [cofactor, ce.Zero])
      : ce.function('Less', [cofactor, ce.Zero]);
  return { value: ce.Zero, guard };
}

/**
 * Walk an FTC result, replacing endpoint-limit leaks (`classifyEndpointLeak`)
 * by their resolved values and conjoining their convergence guards. Returns
 * `{ value, guard }` (guard `True` when leak-free — the value is then the
 * untouched input), or `null` when a leak cannot be resolved (fail closed).
 */
function resolveEndpointLeaks(
  expr: Expression,
  ce: ComputeEngine
): { value: Expression; guard: Expression } | null {
  const leak = classifyEndpointLeak(expr, ce);
  if (leak === 'unresolvable') return null;
  if (leak) return leak;
  if (!isFunction(expr)) return { value: expr, guard: ce.True };

  const guards: Expression[] = [];
  const newOps: Expression[] = [];
  let changed = false;
  for (const op of expr.ops) {
    const r = resolveEndpointLeaks(op, ce);
    if (r === null) return null;
    newOps.push(r.value);
    if (r.value !== op) changed = true;
    if (!isSymbol(r.guard, 'True')) guards.push(r.guard);
  }
  const value = changed ? ce.function(expr.operator, newOps) : expr;
  const guard =
    guards.length === 0
      ? ce.True
      : guards.length === 1
        ? guards[0]
        : ce.function('And', guards);
  return { value, guard };
}

/**
 * Evaluate the definite value `F(upper) − F(lower)` of an antiderivative when a
 * bound is improper (±∞). At an infinite bound, naive substitution can leave an
 * `∞·0` product — an antiderivative term such as `poly(var)·e^{−c·var}` — which
 * `evaluate()` collapses to `NaN`; the mathematically correct endpoint value is
 * the limit `lim_{var→±∞} F(var)`. A finite bound is still a direct
 * substitution. Returns `undefined` (caller falls back to an inert integral)
 * when an endpoint cannot be resolved to a definite value.
 */
function improperEndpointValue(
  antideriv: Expression,
  variable: string,
  lower: Expression,
  upper: Expression,
  ce: ComputeEngine,
  numericApproximation: boolean
): Expression | undefined {
  const endpoint = (bound: Expression): Expression | undefined => {
    if (bound.isInfinity === true) {
      const lim = symbolicLimit(antideriv, variable, bound, undefined, ce);
      if (lim === undefined || lim.operator === 'Limit' || lim.isNaN === true)
        return undefined;
      return lim;
    }
    const v = antideriv
      .subs({ [variable]: bound })
      .evaluate({ numericApproximation });
    return v.isNaN === true ? undefined : v;
  };
  const fUpper = endpoint(upper);
  if (fUpper === undefined) return undefined;
  const fLower = endpoint(lower);
  if (fLower === undefined) return undefined;
  const result = fUpper.sub(fLower).evaluate({ numericApproximation });
  return result.isNaN === true ? undefined : result;
}

/** An `Abs(u)` or `Sign(u)` subexpression of an integrand whose argument is
 * linear in the integration variable, `u = k·x + m` with `k` and `m` free of
 * the variable. The integrand has a kink (or a jump) at `root = −m/k`. */
type IntegrandKink = {
  arg: Expression;
  k: Expression;
  m: Expression;
  root: Expression;
};

/** Whether operand `index` of `expr` is inside a nested binder of the name
 * `variable`: an inner `Integrate`, `Sum`, function literal, etc. that binds
 * its own variable with that name. There, an occurrence of the name is the
 * inner variable, not the integration variable of the outer integral, and
 * it must be neither collected as a kink nor replaced. In
 * `∫_0^1 (∫_{−a}^{a} |x| cos x dx) dx`, the `|x|` belongs to the inner
 * integral, and replacing it by `x` changed the inner value. */
function bindsVariableInOperand(
  expr: Expression,
  index: number,
  variable: string
): boolean {
  return boundVariableNamesInOperand(expr, index).includes(variable);
}

/** Collect the kinks of `expr` in `variable` (see `IntegrandKink`). An `Abs`
 * or `Sign` whose argument is not linear in the variable is not collected;
 * its own argument is still searched. The operands of a nested binder of
 * the same name are not searched (see `bindsVariableInOperand`). */
function collectIntegrandKinks(
  expr: Expression,
  variable: string,
  out: IntegrandKink[]
): void {
  if (!isFunction(expr)) return;
  if (
    (expr.operator === 'Abs' || expr.operator === 'Sign') &&
    expr.nops === 1 &&
    expr.op1.has(variable) &&
    polynomialDegree(expr.op1, variable) === 1 &&
    !out.some((kink) => kink.arg.isSame(expr.op1))
  ) {
    const coefs = getPolynomialCoefficients(expr.op1, variable);
    if (coefs && coefs.length === 2) {
      const ce = expr.engine;
      const [m, k] = coefs.map((c) => c.evaluate());
      if (!k.isSame(0)) {
        const root = ce.function('Divide', [ce.function('Negate', [m]), k]);
        out.push({ arg: expr.op1, k, m, root: root.evaluate() });
        return;
      }
    }
  }
  expr.ops.forEach((op, i) => {
    if (!bindsVariableInOperand(expr, i, variable))
      collectIntegrandKinks(op, variable, out);
  });
}

/** The sign of `value` (`−1`, `0` or `1`), or `undefined` when it cannot be
 * decided: the value has free symbols, is not real, or is so close to zero
 * that a machine-precision comparison cannot be trusted. */
function decidedSign(value: Expression): -1 | 0 | 1 | undefined {
  const v = value.evaluate();
  if (v.isSame(0)) return 0;
  if (v.isPositive === true) return 1;
  if (v.isNegative === true) return -1;
  const n = v.N();
  if (!isNumber(n) || n.isComplex) return undefined;
  const r = n.re;
  if (Number.isNaN(r) || Math.abs(r) < 1e-10) return undefined;
  return r > 0 ? 1 : -1;
}

/**
 * Evaluate a definite integral whose integrand has kinks (`Abs(u)` or
 * `Sign(u)` with `u` linear in the integration variable) by splitting the
 * interval at the kinks.
 *
 * The fundamental theorem of calculus needs an antiderivative that is
 * continuous on the whole interval. The antiderivative of such an integrand
 * often has a `Sign(u)` term (`∫ |x| cos x dx = sin(x)|x| + cos(x)·sgn(x)`),
 * which jumps where `u` changes sign. When that point is inside the bounds,
 * `F(b) − F(a)` adds the jump to the result (`∫_{−π}^{π} |x| cos x dx` gave
 * `−2`, the correct value is `−4`). When the point is at a bound, `Sign(0) = 0`
 * is neither one-sided value and `F(b) − F(a)` is wrong too.
 *
 * On each piece between consecutive kinks, each `u` keeps one sign, so
 * `Abs(u)` is replaced by `u` or `−u` and `Sign(u)` by `1` or `−1`. Each
 * piece is then integrated separately and the results are added.
 *
 * Returns:
 * - the value of the integral when every piece has a closed form;
 * - `'inert'` when a piece has no closed form: the caller keeps the whole
 *   definite integral unevaluated rather than returning a partial sum;
 * - `undefined` when the integrand has no kink or the position of a kink
 *   relative to the bounds cannot be decided (symbolic bounds). The caller
 *   then continues with the whole-interval antiderivative.
 */
function integrateAcrossKinks(
  ce: ComputeEngine,
  integrand: Expression,
  variable: string,
  lower: Expression,
  upper: Expression,
  numericApproximation: boolean
): Expression | 'inert' | undefined {
  const kinks: IntegrandKink[] = [];
  collectIntegrandKinks(integrand, variable, kinks);
  if (kinks.length === 0) return undefined;

  // A kink whose coefficient is not real, as in `|x + i|`, is not a kink:
  // `|x + i| = √(x² + 1)` is smooth, and `u` has no real point where it
  // changes sign. The built-in antiderivative of `|u|` and `sgn(u)` is valid
  // only for a real `u`, so keep the integral unevaluated.
  const notReal = (e: Expression) => {
    const n = e.N();
    return isNumber(n) && n.isComplex;
  };
  if (kinks.some(({ k, m }) => notReal(k) || notReal(m))) return 'inert';

  const diff = (a: Expression, b: Expression) =>
    decidedSign(ce.function('Subtract', [a, b]));

  // `dir` is the direction of integration: 1 when `lower < upper`, −1 when
  // the bounds are reversed. The cuts are ordered in that direction, which
  // keeps `∫_a^b = Σ ∫_{p_i}^{p_{i+1}}` valid in both cases.
  const dir = diff(upper, lower);
  if (dir === undefined || dir === 0) return undefined;

  // The kinks STRICTLY inside the bounds, deduplicated and sorted in the
  // direction of integration. A kink at a bound or outside the bounds does
  // not cut the interval, but its `Abs`/`Sign` is still resolved below.
  const cuts: Expression[] = [];
  for (const { root } of kinks) {
    const afterLower = diff(root, lower);
    const beforeUpper = diff(upper, root);
    if (afterLower === undefined || beforeUpper === undefined) return undefined;
    if (afterLower * dir <= 0 || beforeUpper * dir <= 0) continue;
    let at = cuts.length;
    for (let i = 0; i < cuts.length; i++) {
      const order = diff(root, cuts[i]);
      if (order === undefined) return undefined;
      if (order === 0) {
        at = -1;
        break;
      }
      if (order * dir < 0) {
        at = i;
        break;
      }
    }
    if (at >= 0) cuts.splice(at, 0, root);
  }

  const points = [lower, ...cuts, upper];
  const pieces: Expression[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]];
    // A point strictly inside the piece, where the sign of each `u` is read.
    // No kink is strictly inside the piece, so any such point gives the sign
    // `u` has on the whole piece.
    const sample =
      p.isInfinity === true && q.isInfinity === true
        ? ce.Zero
        : p.isInfinity === true
          ? ce.function('Subtract', [q, ce.number(dir)])
          : q.isInfinity === true
            ? ce.function('Add', [p, ce.number(dir)])
            : ce.function('Divide', [ce.function('Add', [p, q]), ce.number(2)]);
    const signs: number[] = [];
    for (const { k, m } of kinks) {
      const s = decidedSign(
        ce.function('Add', [ce.function('Multiply', [k, sample]), m])
      );
      if (s === undefined || s === 0) return undefined;
      signs.push(s);
    }
    const resolve = (e: Expression): Expression => {
      if (!isFunction(e)) return e;
      if ((e.operator === 'Abs' || e.operator === 'Sign') && e.nops === 1) {
        const j = kinks.findIndex((kink) => kink.arg.isSame(e.op1));
        if (j >= 0) {
          if (e.operator === 'Sign') return ce.number(signs[j]);
          return signs[j] > 0 ? e.op1 : ce.function('Negate', [e.op1]);
        }
      }
      const ops = e.ops.map((op, n) =>
        bindsVariableInOperand(e, n, variable) ? op : resolve(op)
      );
      if (ops.every((op, n) => op === e.ops[n])) return e;
      return ce.function(e.operator, ops);
    };
    const piece = ce
      .function('Integrate', [
        resolve(integrand),
        ce.function('Limits', [ce.symbol(variable), p, q]),
      ])
      .evaluate({ numericApproximation });
    if (piece.has('Integrate')) return 'inert';
    pieces.push(piece);
  }
  return ce.function('Add', pieces).evaluate({ numericApproximation });
}

/** `expr` with each inner `Integrate` subexpression replaced by its value,
 * when that value has no `Integrate` left. Otherwise the inner integral is
 * kept as it is. An inner integral binds its own variable, so its value can
 * be computed before the outer integral: `∫_0^1 x·(∫_{−1}^{1} x² dx) dx` is
 * `∫_0^1 (2/3)·x dx`. The operands of other binders (a `Sum`, a function
 * literal) are not searched. */
function evaluateInnerIntegrals(expr: Expression): Expression {
  if (!isFunction(expr)) return expr;
  if (expr.operator === 'Integrate') {
    const value = expr.evaluate();
    return value.has('Integrate') ? expr : value;
  }
  let changed = false;
  const ops = expr.ops.map((op, i) => {
    if (boundVariableNamesInOperand(expr, i).length > 0) return op;
    const value = evaluateInnerIntegrals(op);
    if (value !== op) changed = true;
    return value;
  });
  return changed ? expr.engine.function(expr.operator, ops) : expr;
}

/** Whether `expr` has a `Sign(u)` subexpression whose argument depends on
 * `variable`. Such a term of an antiderivative jumps where `u` changes sign,
 * so the antiderivative may not be continuous between the bounds. */
function hasVariableSign(expr: Expression, variable: string): boolean {
  if (!isFunction(expr)) return false;
  if (expr.operator === 'Sign' && expr.has(variable)) return true;
  return expr.ops.some((op) => hasVariableSign(op, variable));
}

/** A numeric integrand split into its real and imaginary parts.
 *
 * The compiled runner and the interpreted `applicable` both answer a complex
 * value as an object with numeric `re`/`im` fields (a real value as a plain
 * number, or an object with `im` = 0). The quadrature kernels integrate REAL
 * functions, so the caller integrates `re` first and, when `sawImaginary()`
 * reports that some sample carried a non-zero imaginary part, integrates
 * `im` as well and combines the two into one complex result. Reading only
 * `.re` — the previous behavior — silently dropped the imaginary part:
 * `∫₀^π e^{ix} dx` numericized to `0` instead of `2i`. */
type IntegrandParts = {
  re: (...args: number[]) => number;
  im: (...args: number[]) => number;
  sawImaginary: () => boolean;
  /** True once any sample produced a number at all. An integrand that never
   * does — one holding a free symbol the caller could not detect, such as an
   * operator name (`D`) used as a variable — has no numeric value, and the
   * integral must stay symbolic rather than answer `NaN`. */
  sawNumeric: () => boolean;
  /** The same part (`re` or `im`) without the sample cache. Monte Carlo must
   * use it: its points are random and do not repeat, so each lookup misses,
   * and with 10⁷ samples the string keys and lookups cost much more than a
   * cheap compiled integrand. */
  uncached: (
    part: (...args: number[]) => number
  ) => (...args: number[]) => number;
};

/** The panel budget of the adaptive Gauss–Kronrod quadrature of a ONE-limit
 * integral whose integrand did not compile. One interpreted evaluation costs
 * microseconds, not nanoseconds, so the default budget (1500 panels, up to
 * about 45 000 evaluations) is too large. The 16 starting panels cost 240
 * evaluations and each bisection costs 30 more, so 330 panels cost at most
 * 240 + 314 × 30 = 9 660 evaluations: no more than the 1e4 samples of the
 * Monte-Carlo fallback for an interpreted integrand. A smooth integrand
 * converges far inside this budget. When the quadrature neither converges nor
 * beats Monte Carlo, the 1e4 samples are drawn AFTER it, so the worst case is
 * about 2 × 1e4 evaluations for each part (real, imaginary) of the
 * integrand, against 1e4 when the quadrature was skipped. The budget still leaves room for the
 * endpoint-divergence test, which needs two blocks of 20 bisections toward
 * one endpoint. Next to a singular endpoint, the tanh-sinh rule of
 * `resolveSingularEndpoints` (`numerics/endpoint-quadrature.ts`) can add up to
 * 2 × 330 = 660 evaluations. */
const INTERPRETED_QUADRATURE_PANELS = 330;

function numericIntegrandParts(
  raw: (...args: number[]) => unknown
): IntegrandParts {
  let imaginary = false;
  let numeric = false;
  const parts = (v: unknown): [re: number, im: number] => {
    if (typeof v === 'number') {
      if (!Number.isNaN(v)) numeric = true;
      return [v, 0];
    }
    if (v !== null && typeof v === 'object') {
      const re = (v as { re?: unknown }).re;
      const im = (v as { im?: unknown }).im;
      if (typeof re !== 'number') return [NaN, NaN];
      const imN = typeof im === 'number' ? im : 0;
      if (!Number.isNaN(re)) numeric = true;
      // Any non-zero imaginary component — a non-finite one included, so
      // that `re: 1, im: Infinity` is not mistaken for a real sample and the
      // non-finite part reaches the estimate — makes the integrand complex.
      if (imN !== 0) imaginary = true;
      return [re, imN];
    }
    return [NaN, NaN];
  };
  // One evaluation of `raw` yields BOTH parts, but the real part is integrated
  // first and the imaginary part in a second pass over (mostly) the same
  // sample points. Keep the computed pairs so the second pass does not
  // re-evaluate an expensive integrand (a nested integral, a special
  // function) at a point the first pass already visited. A Monte-Carlo pass
  // of a single integral reads the integrand through `uncached` instead. The
  // cache is bounded: an iterated integral can evaluate the integrand at very
  // many points, which must not all be retained — past the cap, points are
  // evaluated without caching.
  const MAX_CACHED_SAMPLES = 1 << 16;
  const cache = new Map<string, [re: number, im: number]>();
  const at = (args: number[]): [re: number, im: number] => {
    const key = args.length === 1 ? String(args[0]) : args.join(',');
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const pair = parts(raw(...args));
    if (cache.size < MAX_CACHED_SAMPLES) cache.set(key, pair);
    return pair;
  };
  // The real part is read in the first pass, which does not revisit a point,
  // so once the cache is full a lookup there can only miss: skip the key and
  // the lookup. The imaginary pass still looks up, because the first
  // `MAX_CACHED_SAMPLES` points of the first pass are in the cache.
  const re = (...args: number[]) =>
    cache.size >= MAX_CACHED_SAMPLES ? parts(raw(...args))[0] : at(args)[0];
  const im = (...args: number[]) => at(args)[1];
  const reUncached = (...args: number[]) => parts(raw(...args))[0];
  const imUncached = (...args: number[]) => parts(raw(...args))[1];
  return {
    re,
    im,
    sawImaginary: () => imaginary,
    sawNumeric: () => numeric,
    uncached: (part) =>
      part === re ? reUncached : part === im ? imUncached : part,
  };
}

/** Assemble the numeric result of an integral from its real part and, when
 * present, its imaginary part. A NaN estimate (a divergent level, a NaN
 * bound) has no value to report an uncertainty ABOUT — `Measurement(NaN,
 * NaN)` would dress that up as a measured quantity — so it answers `NaN`.
 * The two error bars combine in quadrature. */
function measurementFromParts(
  ce: ComputeEngine,
  re: { estimate: number; error: number },
  im?: { estimate: number; error: number }
): Expression {
  if (Number.isNaN(re.estimate)) return ce.NaN;
  if (im === undefined)
    // A numeric estimate is a float, even when its value is an integer
    return ce.expr([
      'Measurement',
      ce.number(ce._inexactNumericValue(re.estimate + 0)),
      ce.number(re.error),
    ]);
  if (Number.isNaN(im.estimate)) return ce.NaN;
  return ce.expr([
    'Measurement',
    // A numeric estimate is a float, even when both its parts are integers
    ce.number(ce._inexactNumericValue({ re: re.estimate, im: im.estimate })),
    ce.number(Math.hypot(re.error, im.error)),
  ]);
}

/** The value of a definite integral with a proven pole strictly inside its
 * bounds: `+∞`/`−∞` when the integrand keeps one sign across every pole,
 * `NaN` when it changes sign (no value, not even an infinite one). */
function poleVerdictValue(
  ce: ComputeEngine,
  pole: { sign: string }
): Expression {
  return pole.sign === 'positive'
    ? ce.PositiveInfinity
    : pole.sign === 'negative'
      ? ce.NegativeInfinity
      : ce.NaN;
}

/**
 * The exact-route value of a definite integral that has no value, not even
 * an infinite one: the integrand changes sign across a pole inside the
 * bounds (`∫₋₁¹ dt/t`), or has poles at both bounds that diverge with
 * different signs (`∫₀¹ (1/t − 1/(1 − t)) dt`). It is `Indeterminate` when
 * the bounds and every number literal of the integrand are exact, and `NaN`
 * when one of them is a float (`∫₋₁¹ 1.5/t dt`), as for any exact form with
 * no value (see `indeterminateFormAnswer`).
 *
 * `integrand` must be the integrand with the values of the assigned symbols
 * substituted (`withAssignedValues`), so that a float held by a symbol
 * counts as a float operand.
 */
function noValueIntegral(
  ce: ComputeEngine,
  integrand: Expression,
  lower: Expression,
  upper: Expression
): Expression {
  const operands: Expression[] = [lower, upper];
  const collect = (e: Expression): void => {
    if (isNumber(e)) operands.push(e);
    else if (isFunction(e)) for (const op of e.ops) collect(op);
  };
  collect(integrand);
  return indeterminateFormAnswer(ce, operands);
}

/**
 * The value of a contour integral (`ContourIntegrate`, `CircularIntegrate`)
 * that has no value: `Indeterminate` when the contour and every number
 * literal of the integrand are exact, and `NaN` when one of them is a float,
 * as for `noValueIntegral()`.
 */
function noValueContourIntegral(
  ce: ComputeEngine,
  integrand: Expression,
  contour: Expression
): Expression {
  const operands: Expression[] = [];
  const collect = (e: Expression): void => {
    if (isNumber(e)) operands.push(e);
    else if (isFunction(e)) for (const op of e.ops) collect(op);
  };
  collect(integrand);
  collect(contour);
  return indeterminateFormAnswer(ce, operands);
}

/**
 * The integration variables and bounds of the `Limits` of `limits` that have
 * both bounds: the enclosing integrals of an inner integral of an iterated
 * integral, for `symbolicPoleMayBeInside`.
 */
function outerRanges(
  limits: ReadonlyArray<Expression>
): { name: string; lower: Expression; upper: Expression }[] {
  const ranges: { name: string; lower: Expression; upper: Expression }[] = [];
  for (const l of limits) {
    if (!isFunction(l, 'Limits')) continue;
    const name = sym(l.op1);
    if (!name || name === 'Nothing') continue;
    if (sym(l.op2) === 'Nothing' || sym(l.op3) === 'Nothing') continue;
    ranges.push({ name, lower: l.op2, upper: l.op3 });
  }
  return ranges;
}

/** An integration variable and its bounds. */
type IntegrationRange = { name: string; lower: Expression; upper: Expression };

/**
 * The ranges of the integrals whose evaluation is running and encloses the
 * one being evaluated. An iterated integral written as nested integrals
 * (`\int_5^{10}\int_3^4 (y-x)^{-2}\,dx\,dy` on the parse route) is an
 * `Integrate` whose integrand holds another `Integrate`. The outer integral
 * evaluates the inner one first (see `evaluateInnerIntegrals`), and the
 * inner one must know the range of `y` to prove that its pole `x = y` is
 * outside `[3, 4]` (see `symbolicPoleMayBeInside`). Set by
 * `withEnclosingRanges` for the duration of the inner evaluation.
 *
 * The ranges belong to the evaluation of one engine: they are kept per
 * engine, so that an integral evaluated by another engine while an integral
 * runs (a host callback, for example) does not read them.
 */
const enclosingRangesOf = new WeakMap<
  ComputeEngine,
  ReadonlyArray<IntegrationRange>
>();

/** The ranges of the integrals that enclose the one that `ce` evaluates
 * (see `enclosingRangesOf`). */
function enclosingRanges(ce: ComputeEngine): ReadonlyArray<IntegrationRange> {
  return enclosingRangesOf.get(ce) ?? [];
}

/** `fn()`, with the enclosing ranges of `ce` set to `ranges` while it runs. */
function withEnclosingRanges<T>(
  ce: ComputeEngine,
  ranges: ReadonlyArray<IntegrationRange>,
  fn: () => T
): T {
  const saved = enclosingRangesOf.get(ce);
  enclosingRangesOf.set(ce, ranges);
  try {
    return fn();
  } finally {
    if (saved === undefined) enclosingRangesOf.delete(ce);
    else enclosingRangesOf.set(ce, saved);
  }
}

/**
 * The value of `∫ body d(variable)` over a numeric interval with orientation
 * `orientation` (the sign of `upper − lower`) when `body` does not depend on
 * `variable` and its numeric value is an infinity: that infinity for `+1`,
 * its negation for `−1`. `undefined` in every other case — a body that
 * depends on the variable, a finite or non-numeric value, an impure body
 * (evaluating it here would run its effects once more than the quadrature
 * does), or a zero-length interval (decided by the caller).
 */
function infiniteConstantIntegral(
  ce: ComputeEngine,
  body: Expression,
  variable: string,
  orientation: number
): Expression | undefined {
  if (orientation !== 1 && orientation !== -1) return undefined;
  if (body.has(variable) || !body.isPure) return undefined;
  const value = body.N();
  if (!isNumber(value) || value.isInfinity !== true) return undefined;
  return orientation === 1 ? value : value.neg();
}

/**
 * `body` with each symbol that has an assigned value replaced by that value,
 * except the symbols named in `variables` (the integration variables).
 *
 * The interior-pole check (`interiorPoleVerdict`) only locates the poles of a
 * denominator whose single free symbol is the integration variable, so with
 * `q := 1` it could not see the pole of `(y − q)⁻²` at `y = 1`. The compiled
 * integrand reads the value of `q`, so the quadrature integrates the function
 * with the pole: the check must examine the same function. This is a numeric
 * evaluation, so reading the assigned values is correct here. A symbol with
 * no value, and a constant (`Pi`, `ExponentialE`), are left as they are.
 */
function withAssignedValues(
  ce: ComputeEngine,
  body: Expression,
  variables: readonly string[]
): Expression {
  const values: Record<string, Expression> = {};
  let found = false;
  for (const name of body.symbols) {
    if (variables.includes(name)) continue;
    const def = ce.lookupDefinition(name);
    if (!isValueDef(def) || def.value.isConstant === true) continue;
    const value = def.value.value;
    if (value === undefined || value === null) continue;
    values[name] = value;
    found = true;
  }
  return found ? body.subs(values) : body;
}

/**
 * `e` written as `factor · rest`, where `factor` does not depend on
 * `variable` and `rest` has no free symbol other than `variable`:
 * `1/(a·t)` is `(1/a) · (1/t)`. `undefined` when `e` cannot be written so
 * by splitting products, quotients, negations and integer powers
 * (`1/(t + a)` cannot).
 */
function splitConstantFactor(
  ce: ComputeEngine,
  e: Expression,
  variable: string
): { factor: Expression; rest: Expression } | undefined {
  if (!e.has(variable)) return { factor: e, rest: ce.One };
  if (e.unknowns.every((name) => name === variable))
    return { factor: ce.One, rest: e };
  if (!isFunction(e)) return undefined;
  if (e.operator === 'Multiply') {
    const factors: Expression[] = [];
    const rests: Expression[] = [];
    for (const op of e.ops) {
      const s = splitConstantFactor(ce, op, variable);
      if (s === undefined) return undefined;
      factors.push(s.factor);
      rests.push(s.rest);
    }
    return {
      factor: ce.function('Multiply', factors),
      rest: ce.function('Multiply', rests),
    };
  }
  if (e.operator === 'Divide') {
    const n = splitConstantFactor(ce, e.op1, variable);
    const d = splitConstantFactor(ce, e.op2, variable);
    if (n === undefined || d === undefined) return undefined;
    return {
      factor: ce.function('Divide', [n.factor, d.factor]),
      rest: ce.function('Divide', [n.rest, d.rest]),
    };
  }
  if (e.operator === 'Negate') {
    const s = splitConstantFactor(ce, e.op1, variable);
    if (s === undefined) return undefined;
    return { factor: ce.function('Negate', [s.factor]), rest: s.rest };
  }
  if (e.operator === 'Power') {
    // Only an integer exponent distributes over a product for every value
    // of the factors: `(a·t)^(1/2)` is not `a^(1/2)·t^(1/2)` for `a, t < 0`.
    const k = e.op2;
    if (!isNumber(k) || !k.isNumberLiteral || !Number.isInteger(k.re))
      return undefined;
    const s = splitConstantFactor(ce, e.op1, variable);
    if (s === undefined) return undefined;
    return {
      factor: ce.function('Power', [s.factor, k]),
      rest: ce.function('Power', [s.rest, k]),
    };
  }
  return undefined;
}

/**
 * Whether `factor` is not zero for any value of its free symbols at which it
 * is defined: a nonzero number, a quotient whose numerator is never zero, a
 * product of such factors, a negative power (`1/a` is never zero), or a
 * value whose sign is decided.
 */
function neverZero(factor: Expression): boolean {
  if (isNumber(factor)) return factor.isNaN !== true && !factor.isSame(0);
  if (isFunction(factor)) {
    if (factor.operator === 'Divide' || factor.operator === 'Negate')
      return neverZero(factor.op1);
    if (factor.operator === 'Multiply') return factor.ops.every(neverZero);
    // `eᶻ` is never zero for a finite `z`. An exponent that is not proven
    // infinite (a symbol with no value) counts as finite.
    if (factor.operator === 'Exp')
      return factor.op1.isFinite !== false && factor.op1.isNaN !== true;
    if (factor.operator === 'Power') {
      const k = factor.op2;
      if (isSymbol(factor.op1, 'ExponentialE'))
        return k.isFinite !== false && k.isNaN !== true;
      if (isNumber(k) && k.isNumberLiteral && k.re < 0) return true;
      if (isNumber(k) && k.isNumberLiteral && k.re > 0)
        return neverZero(factor.op1);
    }
  }
  const s = decidedSign(factor);
  return s === 1 || s === -1;
}

/**
 * The interior-pole verdict (see `interiorPoleVerdict`) of an integrand that
 * has a free symbol other than `variable` only in a constant factor:
 * `1/(a·t)` over `[−1, 1]`. `interiorPoleVerdict` locates the pole of such
 * an integrand at `t = 0`, but cannot confirm it, because its samples of the
 * integrand are not numbers while `a` is free. Here the integrand is split
 * into `factor · rest` (`(1/a) · (1/t)`) and the check runs on `rest`.
 *
 * - When `rest` changes sign across a pole (`mixed`), the integral has no
 *   value for every value of the free symbols at which `factor` is not zero.
 *   Where `factor` is undefined (`1/a` at `a = 0`), the integrand is
 *   undefined everywhere and the integral has no value either. So the
 *   verdict is `mixed` when `factor` is never zero (see `neverZero`), and
 *   `unknown` otherwise: `∫₋₁¹ a/t dt` is `0` for `a = 0`.
 * - When `rest` keeps one sign (`1/(a·t²)`), the sign of the integral is
 *   that sign times the sign of `factor`: the verdict is `positive` or
 *   `negative` when the sign of `factor` is decided (`a` declared positive),
 *   and `unknown` otherwise.
 *
 * An `unknown` verdict keeps the integral unevaluated. `undefined` when the
 * integrand cannot be split, has no free symbol other than `variable`, or
 * `rest` has no proven pole.
 */
function constantFactorPoleVerdict(
  ce: ComputeEngine,
  integrand: Expression,
  variable: string,
  lower: Expression,
  upper: Expression
): PoleVerdict | undefined {
  if (integrand.unknowns.every((name) => name === variable)) return undefined;
  const split = splitConstantFactor(ce, integrand, variable);
  if (split === undefined) return undefined;
  const verdict = interiorPoleVerdict(split.rest, variable, lower, upper, ce);
  if (verdict === undefined) return undefined;
  if (verdict.sign === 'mixed')
    return neverZero(split.factor) ? verdict : { sign: 'unknown' };
  if (verdict.sign === 'positive' || verdict.sign === 'negative') {
    const s = decidedSign(split.factor);
    if (s === 1) return verdict;
    if (s === -1)
      return { sign: verdict.sign === 'positive' ? 'negative' : 'positive' };
  }
  return { sign: 'unknown' };
}

/**
 * The name of the variable of the integrand `f(t)` that `NIntegrate` builds
 * for a function given by its name (`NIntegrate(Tan, 0, 3)`). The name is
 * unlikely to occur in the body of a user function: the interior-pole check
 * finds the integration variable by its name, so a body symbol with the same
 * name would be taken for it.
 */
const NINTEGRATE_VARIABLE = 'NIntegrateVariable';

/**
 * The function literal `(p_1, …, p_n) ↦ body`, where the parameter named
 * `params[i]` replaces each occurrence of the symbol named `holes[i]` in
 * `body`. Returns `undefined` when a parameter cannot be made.
 *
 * The parameter symbols are declared in a scope that is discarded before the
 * literal is made. The literal then binds its parameters in the scope of its
 * own body (`bindParameterOperands`, `function-utils.ts`). A parameter made
 * with `ce.symbol()` is declared in the caller's scope instead, with the type
 * that the body infers for it, and that type then applies to every later use
 * of the same name in the caller's scope.
 */
function functionLiteralOverHoles(
  ce: ComputeEngine,
  body: Expression,
  holes: ReadonlyArray<string>,
  params: ReadonlyArray<string>
): Expression | undefined {
  const symbols: Expression[] = [];
  let lifted: Expression;
  ce.pushScope();
  try {
    for (const name of params) {
      ce.declare(name, 'unknown');
      const param = ce._bindingSymbol(name, ce.context.lexicalScope);
      if (param === undefined) return undefined;
      symbols.push(param);
    }
    const subs: Record<string, Expression> = {};
    holes.forEach((hole, i) => {
      subs[hole] = symbols[i];
    });
    lifted = body.subs(subs);
  } finally {
    ce.popScope();
  }
  // `ce.function()` (not `_fn`): the canonical handler wraps the body in the
  // scoped Block that `makeLambda` requires.
  return ce.function('Function', [lifted, ...symbols]);
}

/**
 * The interior-pole verdict of `NIntegrate(f, lower, upper)` (see
 * `interiorPoleVerdict`), or `undefined` when no pole was proven. With
 * `check` set to `endpointPoleVerdict`, the verdict for a pole AT a bound.
 *
 * - For a one-parameter `Function` literal, the check examines its body. The
 *   parameter is shielded, so that a global value of a symbol with the same
 *   name is not read.
 * - For a function given by its name (`Tan`, or a user function `g`), the
 *   check examines the call `f(t)`, where `t` is a real variable declared in a
 *   scope of its own. The variable is made with `_bindingSymbol()`, never
 *   `ce.symbol()`, which can return a library constant. When the call itself
 *   gives no verdict, its evaluated form is examined: evaluating the call of
 *   a user function `g := x ↦ 1/x²` gives `t⁻²`, whose denominator the check
 *   can read.
 *
 * In both cases the values of the other assigned symbols are substituted
 * first (see `withAssignedValues`).
 */
function nIntegratePoleVerdict(
  ce: ComputeEngine,
  f: Expression,
  lower: number,
  upper: number,
  check: typeof interiorPoleVerdict = interiorPoleVerdict
): PoleVerdict | undefined {
  if (isFunction(f, 'Function')) {
    if (f.nops !== 2) return undefined;
    const variable = sym(f.op2);
    if (!variable) return undefined;
    return withValueShield(ce, [variable], () =>
      check(
        withAssignedValues(ce, f.op1, [variable]),
        variable,
        lower,
        upper,
        ce
      )
    );
  }

  const name = sym(f);
  if (!name) return undefined;
  const variable = NINTEGRATE_VARIABLE;
  ce.pushScope();
  try {
    ce.declare(variable, 'real');
    const t = ce._bindingSymbol(variable, ce.context.lexicalScope);
    if (!t) return undefined;
    const call = ce.function(name, [t]);
    const verdict = check(
      withAssignedValues(ce, call, [variable]),
      variable,
      lower,
      upper,
      ce
    );
    if (verdict !== undefined) return verdict;
    let evaluated: Expression;
    try {
      evaluated = call.evaluate();
    } catch {
      return undefined;
    }
    if (evaluated.isSame(call)) return undefined;
    return check(
      withAssignedValues(ce, evaluated, [variable]),
      variable,
      lower,
      upper,
      ce
    );
  } finally {
    ce.popScope();
  }
}

/**
 * Integrate ONE real-valued part (`re` or `im`) of a one-limit integrand over
 * `[lower, upper]`. `Integrate(…).N()` and `NIntegrate` both call this
 * function, so the two operators use the same methods in the same order:
 *
 * 1. on a semi-infinite interval, the oscillatory quadrature;
 * 2. the adaptive Gauss–Kronrod quadrature, corrected next to a singular
 *    endpoint by the extrapolation of the shells of the corner panel and
 *    checked against the tanh-sinh rule (`singularEndpoints`,
 *    `numerics/endpoint-quadrature.ts`);
 * 3. `NaN` when the quadrature finds that the integral diverges;
 * 4. Monte Carlo, only when the quadrature does not converge, did not find
 *    a singular corner it could not resolve (`singularCorner`), and sampling
 *    could give a better result. A quadrature result that did not converge
 *    and is kept reports an error of at least `|estimate|/√mcSamples`.
 *
 * `options.compiled` tells whether the integrand compiled: it selects the
 * quadrature panel budget and the Monte-Carlo sample count. `options.uncached`
 * maps `jsf` to the same function without the sample cache of
 * `numericIntegrandParts()`. `options.draw` is the random stream of the
 * Monte-Carlo fallback.
 *
 * `divergent` is `true` when the estimate is `NaN` because the quadrature
 * found that the integral diverges (step 3). The caller can then look for a
 * pole at a bound to give the sign of the divergence (see
 * `endpointPoleVerdict`).
 */
function integrateRealPart(
  ce: ComputeEngine,
  jsf: (x: number) => number,
  lower: number,
  upper: number,
  options: {
    compiled: boolean;
    uncached: (part: (x: number) => number) => (x: number) => number;
    draw: () => number;
    /** The integrand holds an integral: each evaluation runs a quadrature. */
    nested?: boolean;
  }
): { estimate: number; error: number; divergent?: true } {
  // Semi-infinite interval: a conditionally-convergent oscillatory
  // integrand (∫₀^∞ sin x/x, ∫₀^∞ sin(x²)) defeats Monte-Carlo
  // importance sampling. Try the dedicated lobe-integration +
  // ε-acceleration quadrature first; it returns null (→ Monte Carlo)
  // for non-oscillatory or divergent integrands.
  const aInf = !isFinite(lower);
  const bInf = !isFinite(upper);
  if (aInf !== bInf) {
    // Reversed bounds (`∫_{+∞}^0`) integrate over the ordered interval and
    // negate. Without this, `∫_{+∞}^0 sin x/x dx` gave `+π/2`: the infinite
    // LOWER bound was read as `−∞`.
    const sign = lower > upper ? -1 : 1;
    const lo = Math.min(lower, upper);
    const hi = Math.max(lower, upper);
    // An integrand that did not compile is slower to evaluate, so the
    // adaptive quadrature that the routine tries last over the whole
    // interval gets the smaller panel budget `INTERPRETED_QUADRATURE_PANELS`.
    const oscOptions = options.compiled
      ? undefined
      : { maxIntervals: INTERPRETED_QUADRATURE_PANELS };
    const osc = !isFinite(hi)
      ? integrateSemiInfiniteOscillatory(jsf, lo, ce._deadlineFrame, oscOptions)
      : integrateSemiInfiniteOscillatory(
          (t) => jsf(-t),
          -hi,
          ce._deadlineFrame,
          oscOptions
        );
    if (osc) return { estimate: sign * osc.estimate, error: osc.error };
  }

  // (2) Deterministic adaptive Gauss–Kronrod (GK15) for finite or
  // transformable (semi-infinite / doubly-infinite) bounds — near
  // machine precision on smooth integrands, and matches the compiled
  // integration path. Falls through to Monte Carlo only when it fails
  // to converge (endpoint singularities, oscillatory tails) AND the
  // sampler could actually do better — a stalled panel budget still
  // routinely carries a tighter bound than 1e7 samples can reach, and
  // for an expensive integrand (an inner quadrature, a compiled model)
  // those samples cost minutes.
  //
  // An integrand that did not compile (an operator with only a
  // JavaScript `evaluate` handler, for example) runs the quadrature
  // too, with a smaller panel budget (`INTERPRETED_QUADRATURE_PANELS`)
  // because each evaluation is slower. Its Monte-Carlo fallback
  // draws only 1e4 samples, about 1e-2 relative error, so skipping
  // the quadrature gave `∫₀¹ x² dx` as `0.33 ± 0.003`.
  const mcSamples = options.compiled ? 1e7 : 1e4;
  // `deadline`: bounds the adaptive loop (a per-panel check that
  // throws the timeout) AND is re-published as the ambient deadline so an
  // integrand that is itself an integral — interpreted, or compiled
  // to `_SYS.integrate`, which has no engine access — inherits it
  // (Tycho item 183).
  const gk = adaptiveQuadrature(jsf, lower, upper, {
    deadline: ce._deadlineFrame,
    singularEndpoints: true,
    ...(options.compiled
      ? {}
      : { maxIntervals: INTERPRETED_QUADRATURE_PANELS }),
  });
  // A diagnosed divergence has no finite value. Monte Carlo would
  // still return one — a mean of samples that never saw the
  // singularity — so the fallback is skipped, not just the report. An
  // integrand that oscillates without a value at a bound
  // (`∫₀¹ sin(ln(1 − x))/(1 − x) dx`) is `NaN` with no sign: it is not
  // reported as `divergent`, so the caller does not look for the sign of a
  // pole at the bound (which gave `−∞` for that integral).
  if (gk.divergent)
    return gk.oscillates === true
      ? { estimate: NaN, error: NaN }
      : { estimate: NaN, error: NaN, divergent: true };
  if (
    (gk.converged || gk.extrapolated === true) &&
    Number.isFinite(gk.estimate)
  )
    return { estimate: gk.estimate, error: gk.error };
  // A result that did not converge: its error estimate can be far too small
  // (the adaptive quadrature gave `508.24896298688 ± 0.00000000053` for
  // `∫₀¹ x^(−0.999) dx = 1000` before the extrapolation of the endpoint
  // shells). The error that is reported is at least the standard error of
  // the Monte-Carlo estimate it replaces, `|estimate|/√mcSamples`. The
  // result is kept when its own error is not larger than that.
  //
  // A result next to a singular corner that the quadrature could not resolve
  // (`singularCorner`) is kept too, whatever its error: Monte Carlo
  // under-weights the neighborhood of the singularity and gave
  // `0.3220 ± 0.0063` for `∫₀^0.01 dx/(x·(−ln x)·ln²(−ln x)) = 0.6548…`,
  // where the quadrature gave `0.5028 ± 0.0176`.
  if (
    (gk.singularCorner === true || quadratureBeatsMonteCarlo(gk, mcSamples)) &&
    Number.isFinite(gk.estimate)
  )
    return {
      estimate: gk.estimate,
      error: Math.max(gk.error, Math.abs(gk.estimate) / Math.sqrt(mcSamples)),
    };

  // An integrand that holds an integral has no Monte-Carlo fallback: each
  // of the `mcSamples` samples would run an inner quadrature, and the inner
  // integral can itself have no value at some points (`∫₀^10 ∫₃^4 (y − x)⁻²
  // dx dy`, for `y` in `[3, 4]`). A result with a finite error is kept, with
  // the same floor as above; otherwise the integral has no value.
  if (options.nested === true)
    return Number.isFinite(gk.estimate) && Number.isFinite(gk.error)
      ? {
          estimate: gk.estimate,
          error: Math.max(
            gk.error,
            Math.abs(gk.estimate) / Math.sqrt(mcSamples)
          ),
        }
      : { estimate: NaN, error: NaN };

  const mce = monteCarloEstimate(
    options.uncached(jsf),
    lower,
    upper,
    mcSamples,
    ce._deadlineFrame,
    options.draw
  );
  // KNOWN LIMITATION (CORRECTNESS_FINDINGS #29 / C15): the reported
  // error bar is the Monte-Carlo standard error, which is *optimistic*
  // (~1.3–1.6× too small) for endpoint-singular integrands such as
  // ∫₋₁¹ √(1−x²)/(1+x²) dx or ∫₀¹ x^(−1/2) dx. Uniform sampling
  // under-weights the neighborhood of the singularity, so the sample
  // variance underestimates the true quadrature error and the ± bound
  // can be tighter than the actual deviation from the exact value. A
  // faithful bound needs singularity-aware quadrature (e.g. tanh-sinh
  // with endpoint clustering); until then the estimate is sound but the
  // uncertainty on singular integrands should be treated as a lower
  // bound, not a guarantee.
  return { estimate: mce.estimate, error: mce.error };
}

/**
 * The type of the integral of an integrand of type `t`. An integrand whose
 * value is a list (`∫ [x, 2x] dx`) gives one integral per element, so the
 * integral of a list is a list of the same shape, with number elements. Any
 * other integrand gives a number.
 */
function integralTypeOf(t: Readonly<Type> | undefined): Type {
  if (t === undefined) return 'number';
  if (typeof t === 'object' && t.kind === 'list')
    return { ...t, elements: integralTypeOf(t.elements) };
  // A tuple integrand is integrated coordinate by coordinate: the integral
  // is a tuple with one element per coordinate.
  if (typeof t === 'object' && t.kind === 'tuple')
    return {
      kind: 'tuple',
      elements: t.elements.map((e) => ({ ...e, type: integralTypeOf(e.type) })),
    };
  if (typeof t === 'string' && t !== 'unknown' && isSubtype(t, 'list<any>'))
    return { kind: 'list', elements: 'number' };
  return 'number';
}

/**
 * An integral whose integrand is a LIST (`∫_0^1 [x, 2x] dx`, or the outer
 * integral of `∫_0^1 ∫_0^{G} x·y dx dy` with `G = [1, 2, 3]`, whose integrand
 * is an integral with a list bound) is one integral per element of the list:
 * `Integrate([f1, f2], limits)` is `[Integrate(f1, limits), Integrate(f2,
 * limits)]`. This is the same rule as for a list bound. When a bound is also
 * a list, the element `i` of the integrand is paired with the element `i` of
 * the bound, and the lengths must agree.
 *
 * Return `undefined` when the integrand is not a list: the caller then
 * integrates it as usual. A list bound whose length is not the length of the
 * integrand is the `incompatible-dimensions` error, under `evaluate()` and
 * `N()` alike, as a mismatch of two list bounds is.
 *
 * A TUPLE integrand (`∫_0^1 (x, 2x) dx`) is integrated coordinate by
 * coordinate, as `Sum` sums a tuple summand coordinate by coordinate: the
 * value is the tuple of the integrals of the coordinates, `(1/2, 1)`. A
 * tuple is a point, not a list, so its coordinates are never paired with the
 * elements of a list bound. A list bound instead gives one integral of the
 * whole tuple per element of the bound, and the value is a list of tuples:
 * `∫_0^{[1, 2]} (x, 2x) dx` is `[(1/2, 1), (2, 4)]`. When several bounds are
 * lists, they are paired element by element and their lengths must agree.
 */
function integrateListIntegrand(
  ce: ComputeEngine,
  integrand: Expression,
  limits: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression | undefined {
  // The integrand is a `List` value, or, for a function literal, its body
  // is typed as a list. Checking the type first means that an integrand that
  // is not a list is not evaluated here.
  let value: Expression | undefined;
  if (isFunction(integrand, 'List') || isFunction(integrand, 'Tuple'))
    value = integrand;
  else if (isFunction(integrand, 'Function')) {
    const result = functionResult(integrand.type.type);
    if (
      result === undefined ||
      result === 'unknown' ||
      !(isSubtype(result, 'list<any>') || isTupleShapedType(result))
    )
      return undefined;
  } else return undefined;

  // The integration variables are bound by `Integrate`: a same-named global
  // assignment (`x := 5`) must not substitute into the integrand or into a
  // bound that refers to an outer integration variable.
  const names: string[] = [];
  for (const l of limits)
    if (isFunction(l)) {
      const v = sym(l.op1);
      if (v && v !== 'Nothing') names.push(v);
    }
  if (isFunction(integrand, 'Function'))
    for (const p of integrand.ops.slice(1)) {
      const n = sym(p);
      if (n) names.push(n);
    }

  return withValueShield(ce, names, () => {
    // The integrand is evaluated exactly, also under `N()`: an inner integral
    // with a free outer integration variable has no numeric value, but its
    // exact value can be a list of expressions in that variable.
    value ??= liftIntegrand(integrand).evaluate();
    if (isFunction(value, 'Tuple'))
      return integrateTupleIntegrand(ce, value, limits, numericApproximation);
    if (!isFunction(value, 'List')) return undefined;
    const elements = value.ops;
    const count = elements.length;

    // Evaluate each bound once, and pair a list bound with the integrand.
    const bounds: (Expression[] | undefined)[] = [];
    for (const l of limits) {
      if (!isFunction(l, 'Limits')) {
        bounds.push(undefined);
        continue;
      }
      const values = [l.op2, l.op3].map((b) =>
        sym(b) === 'Nothing' ? b : numericApproximation ? b.N() : b.evaluate()
      );
      for (const b of values) {
        if (!isFunction(b, 'List') || b.nops === count) continue;
        return ce.error('incompatible-dimensions', `${count} vs ${b.nops}`);
      }
      bounds.push(values);
    }

    const results = elements.map((element, i) => {
      const elementLimits = limits.map((l, k) => {
        const b = bounds[k];
        if (!isFunction(l, 'Limits') || b === undefined) return l;
        const [lo, hi] = b.map((x) => (isFunction(x, 'List') ? x.ops[i] : x));
        return ce.function('Limits', [l.op1, lo, hi]);
      });
      const integral = ce.function('Integrate', [element, ...elementLimits]);
      return numericApproximation ? integral.N() : integral.evaluate();
    });
    return ce.function('List', results);
  });
}

/**
 * The integral of a tuple, `value`, which is the evaluated integrand of
 * `integrateListIntegrand`. The caller has shielded the integration
 * variables from their global values.
 *
 * When no bound is a list, the value is the tuple of the integrals of the
 * coordinates. When a bound is a list, the value is a list with one integral
 * of the whole tuple per element of the bound (each a tuple). Two list
 * bounds of different lengths are the `incompatible-dimensions` error, under
 * `evaluate()` and `N()` alike, as for a list integrand.
 */
function integrateTupleIntegrand(
  ce: ComputeEngine,
  value: Expression & import('../global-types.js').FunctionInterface,
  limits: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const integrate = (limits: ReadonlyArray<Expression>) => (x: Expression) => {
    const integral = ce.function('Integrate', [x, ...limits]);
    return numericApproximation ? integral.N() : integral.evaluate();
  };

  // Evaluate each bound once, and find the length of the list bounds.
  let count: number | undefined;
  const bounds: (Expression[] | undefined)[] = [];
  for (const l of limits) {
    if (!isFunction(l, 'Limits')) {
      bounds.push(undefined);
      continue;
    }
    const values = [l.op2, l.op3].map((b) =>
      sym(b) === 'Nothing' ? b : numericApproximation ? b.N() : b.evaluate()
    );
    for (const b of values) {
      if (!isFunction(b, 'List')) continue;
      if (count === undefined) count = b.nops;
      else if (count !== b.nops)
        return ce.error('incompatible-dimensions', `${count} vs ${b.nops}`);
    }
    bounds.push(values);
  }

  // The limits of the integral for element `i` of the list bounds. The
  // bound values computed above are used, so that a bound with side effects
  // (`Random()`) is evaluated once, and all the coordinates see one value.
  const limitsAt = (i: number) =>
    limits.map((l, k) => {
      const b = bounds[k];
      if (!isFunction(l, 'Limits') || b === undefined) return l;
      const [lo, hi] = b.map((x) => (isFunction(x, 'List') ? x.ops[i] : x));
      return ce.function('Limits', [l.op1, lo, hi]);
    });

  if (count === undefined)
    return ce.function('Tuple', value.ops.map(integrate(limitsAt(0))));

  const results: Expression[] = [];
  for (let i = 0; i < count; i++)
    results.push(ce.function('Tuple', value.ops.map(integrate(limitsAt(i)))));
  return ce.function('List', results);
}

/**
 * Iterated numeric quadrature for a multi-limit `Integrate`, e.g.
 * `Integrate(f, Limits(x, 0, 3), Limits(y, 0, 2))`. Limits follow the
 * Mathematica iterator convention (matching the symbolic path): the FIRST
 * limit is the OUTERMOST integral, so the bounds of limit i may reference the
 * variables of limits 0..i−1 (`Integrate(1, Limits(x,0,1), Limits(y,0,x))` is
 * the triangle, ½). A bound that references its own or a LATER (inner)
 * integration variable, or that otherwise fails to numericize, declines
 * (returns `undefined`, keeping the integral symbolic) rather than
 * integrating wrongly.
 *
 * `evaluatedBounds`, when given, holds for each limit the values of its lower
 * and upper bounds that the caller already computed with `.N()`. A bound that
 * does not reference an integration variable uses that value, and is not
 * evaluated again. This is necessary when a bound has side effects: a bound
 * `Random()` must use the same draw that the caller saw, and must not
 * consume a second one.
 */
/**
 * The point at fraction `s` (in `(0, 1)`) of the range between `lo` and
 * `hi`, for the grid of `dependentPoleScan`. A finite range is divided
 * linearly. An infinite bound uses the transform of the quadrature
 * (`adaptiveQuadrature`): `lo + s/(1 − s)` for `[lo, +∞)`,
 * `hi − s/(1 − s)` for `(−∞, hi]`, and `u/(1 − u²)` with `u = 2s − 1` for
 * `(−∞, +∞)`. The bounds may be in either order.
 */
function scanPoint(lo: number, hi: number, s: number): number {
  const loInf = !Number.isFinite(lo);
  const hiInf = !Number.isFinite(hi);
  if (!loInf && !hiInf) return lo + s * (hi - lo);
  if (loInf && hiInf) {
    const u = 2 * s - 1;
    return u / (1 - u * u);
  }
  const finite = loInf ? hi : lo;
  const infinite = loInf ? lo : hi;
  return finite + Math.sign(infinite) * (s / (1 - s));
}

/**
 * A finite range inside the range between `lo` and `hi`, with the same
 * orientation, for the interior-pole check of `dependentPoleScan`, which
 * requires finite bounds. A finite bound is kept. An infinite bound is
 * replaced by a point `1024·max(1, |b|)` past the other bound `b`, or by
 * `±1024` when both bounds are infinite: the points of the grid of a
 * dimension with an infinite range (`scanPoint`) are within `±63` of its
 * finite bound, so a pole that moves with them stays inside the cut range.
 */
function finiteScanRange(lo: number, hi: number): [number, number] {
  const loInf = !Number.isFinite(lo);
  const hiInf = !Number.isFinite(hi);
  if (!loInf && !hiInf) return [lo, hi];
  if (loInf && hiInf) return [Math.sign(lo) * 1024, Math.sign(hi) * 1024];
  const finite = loInf ? hi : lo;
  const cut =
    finite + Math.sign(loInf ? lo : hi) * 1024 * Math.max(1, Math.abs(finite));
  return loInf ? [cut, hi] : [lo, cut];
}

function nIntegrateMultiple(
  ce: ComputeEngine,
  f: Expression,
  limits: ReadonlyArray<Expression>,
  evaluatedBounds?: ReadonlyArray<ReadonlyArray<Expression>>
): Expression | undefined {
  const vars: string[] = [];
  for (const l of limits) {
    if (!isFunction(l)) return undefined;
    const v = sym(l.op1);
    if (!v || v === 'Nothing') return undefined;
    vars.push(v);
  }

  // Each bound becomes a function of the OUTER integration values (in limit
  // order). A constant bound ignores them; a dependent one is wrapped in a
  // `Function` of the outer variables — the literal's parameter binding also
  // shields a same-named global assignment, as for the integrand itself.
  type BoundFn = (outer: ReadonlyArray<number>) => number;
  const mkBound = (
    b: Expression,
    d: number,
    value: Expression | undefined
  ): BoundFn | undefined => {
    const syms = b.symbols;
    if (syms.some((s) => vars.indexOf(s) >= d)) return undefined;
    if (syms.some((s) => vars.includes(s))) {
      const fn = ce.expr(['Function', b, ...vars.slice(0, d)]);
      const compiledB = implicitCompile(ce, fn);
      if (compiledB?.success) {
        const run = compiledB.run as (...args: number[]) => number;
        return (outer) => run(...outer);
      }
      const app = applicable(fn);
      return (outer) => app(outer.map((x) => ce.number(x)))?.re ?? NaN;
    }
    const c = (value ?? b.N()).re;
    if (isNaN(c)) return undefined;
    return () => c;
  };

  const boundFns: [BoundFn, BoundFn][] = [];
  for (let d = 0; d < limits.length; d++) {
    const l = limits[d];
    if (!isFunction(l)) return undefined;
    const values = evaluatedBounds?.[d];
    const lower = mkBound(l.op2, d, values?.[0]);
    const upper = mkBound(l.op3, d, values?.[1]);
    if (!lower || !upper) return undefined;
    boundFns.push([lower, upper]);
  }

  const fnExpr =
    f.operator === 'Function' ? f : ce.expr(['Function', f, ...vars]);

  // Map each integration variable to its parameter slot: a user-supplied
  // `Function` may list its parameters in a different order than the limits.
  // A variable with no parameter slot, a duplicated variable, or a spare
  // parameter (which would be left unbound) all decline.
  const params = isFunction(fnExpr)
    ? fnExpr.ops.slice(1).map((p) => sym(p))
    : [];
  const slots = vars.map((v) => params.indexOf(v));
  if (
    params.length !== vars.length ||
    slots.some((i) => i < 0) ||
    new Set(slots).size !== slots.length
  )
    return undefined;

  // A pole strictly inside a dimension whose bounds are CONSTANT diverges
  // the whole iterated integral, whatever the other variables do — and the
  // nested quadrature below would report a confident finite `Measurement`
  // for it, exactly as the single-limit path used to. `interiorPoleVerdict`
  // substitutes only the dimension's own variable, so with any other
  // integration variable left in the integrand its samples are not numbers
  // and it answers `undefined` (no claim): only a divergence the integrand
  // exhibits in that variable alone is reported. Two dimensions that each
  // diverge in different directions leave the integral without a value.
  // The values of assigned symbols other than the integration variables are
  // substituted, since the compiled integrand reads them (see
  // `withAssignedValues`).
  const body = withAssignedValues(
    ce,
    isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr,
    vars
  );
  //
  // The verdict of one dimension has the orientation of that dimension's
  // bounds only. Each other dimension with reversed bounds negates the
  // integral again: `∫₂⁰ ∫₀² (y − 1)⁻² dy dx` is `−∞`. A dimension whose
  // bounds depend on another integration variable has no single
  // orientation, so the direction of the divergence is then unknown.
  const dependsOnVars = (e: Expression) =>
    e.symbols.some((name) => vars.includes(name));
  const orientations = limits.map((l, d): number | undefined => {
    if (!isFunction(l) || dependsOnVars(l.op2) || dependsOnVars(l.op3))
      return undefined;
    return Math.sign(boundFns[d][1]([]) - boundFns[d][0]([]));
  });
  // The value of the integral from the verdicts of `check` for each
  // dimension, or `undefined` when no dimension has a verdict.
  // `interiorPoleVerdict` is checked before the quadrature;
  // `endpointPoleVerdict` (a pole AT a bound) only after the quadrature found
  // a divergence, since it cannot tell an integrable singularity of order
  // close to 1 from a pole.
  const poleValue = (
    check: typeof interiorPoleVerdict
  ): Expression | undefined => {
    let verdict: PoleVerdict | undefined;
    for (let d = 0; d < vars.length; d++) {
      const l = limits[d];
      if (!isFunction(l)) continue;
      if (orientations[d] === undefined) continue;
      let v = check(body, vars[d], l.op2, l.op3, ce);
      if (v === undefined) continue;
      if (v.sign === 'positive' || v.sign === 'negative') {
        let flip = 1;
        for (let e = 0; e < vars.length; e++) {
          if (e === d) continue;
          const o = orientations[e];
          // A dimension of zero length: the integral is over a set of zero
          // measure, as for structurally equal bounds, which give 0.
          if (o === 0) return ce.Zero;
          if (o === undefined || Number.isNaN(o)) flip = 0;
          else flip *= o;
        }
        if (flip === 0) v = { sign: 'unknown' };
        else if (flip === -1)
          v = { sign: v.sign === 'positive' ? 'negative' : 'positive' };
      }
      verdict =
        verdict === undefined || verdict.sign === v.sign
          ? v
          : { sign: 'mixed' };
    }
    if (verdict === undefined) return undefined;
    return verdict.sign === 'positive'
      ? ce.PositiveInfinity
      : verdict.sign === 'negative'
        ? ce.NegativeInfinity
        : ce.NaN;
  };
  const interior = poleValue(interiorPoleVerdict);
  if (interior !== undefined) return interior;

  // A pole whose location depends on another integration variable:
  // `∫₀¹⁰ ∫₃⁴ (y − x)⁻² dx dy` has, for each `y` in `(3, 4)`, a pole at
  // `x = y`. `poleValue` cannot see it, because the samples of the integrand
  // in one variable are not numbers while the other variables are free. Here
  // the other variables are given the values of a grid of points of their
  // ranges (the centers of 32 equal cells for two dimensions, of 8 × 8 for
  // three), and the interior-pole check runs on the remaining variable at
  // each point. The scan runs only when every bound is constant and there are
  // at most three dimensions, which keeps its cost bounded; it is cheap when
  // the integrand has no denominator, since there is then no candidate site
  // to sample.
  //
  // The result is the number of points with a proven pole, and their sign,
  // with the orientation of the other dimensions: `mixed` when two points
  // disagree, or when the integrand changes sign across the pole at one
  // point (the inner integral then has no value).
  //
  // A dimension with an infinite bound is handled in two ways. As one of the
  // other variables, its grid is placed on `[0, 1)` and mapped onto the
  // range by the transform of the quadrature, `lo + s/(1 − s)` (see
  // `scanPoint`): for `Limits(y, 0, +∞)` the points go from `y = 0.016` to
  // `y = 63`. As the variable checked for a pole, its range is cut to a
  // finite one (see `finiteScanRange`): a pole proven inside the cut range
  // is inside the whole range, with the same orientation.
  const dependentPoleScan = ():
    { proven: number; sign: 'positive' | 'negative' | 'mixed' } | undefined => {
    if (vars.length < 2 || vars.length > 3) return undefined;
    if (orientations.some((o) => o === undefined || o === 0 || Number.isNaN(o)))
      return undefined;
    const perDimension = vars.length === 2 ? 32 : 8;
    let sign: 'positive' | 'negative' | 'mixed' | undefined;
    let proven = 0;
    for (let d = 0; d < vars.length; d++) {
      const l = limits[d];
      if (!isFunction(l)) continue;
      const others = vars.map((_, e) => e).filter((e) => e !== d);
      if (!others.some((e) => body.has(vars[e]))) continue;
      const flip = others.reduce((product, e) => product * orientations[e]!, 1);
      const count = perDimension ** others.length;
      const [lower, upper] = finiteScanRange(
        boundFns[d][0]([]),
        boundFns[d][1]([])
      );
      for (let k = 0; k < count; k++) {
        const values: Record<string, Expression> = {};
        let rest = k;
        for (const e of others) {
          const i = rest % perDimension;
          rest = Math.floor(rest / perDimension);
          values[vars[e]] = ce.number(
            scanPoint(
              boundFns[e][0]([]),
              boundFns[e][1]([]),
              (i + 0.5) / perDimension
            )
          );
        }
        const v = interiorPoleVerdict(
          body.subs(values),
          vars[d],
          lower,
          upper,
          ce
        );
        if (v === undefined) continue;
        proven += 1;
        const oriented =
          v.sign !== 'positive' && v.sign !== 'negative'
            ? 'mixed'
            : flip > 0
              ? v.sign
              : v.sign === 'positive'
                ? 'negative'
                : 'positive';
        sign = sign === undefined || sign === oriented ? oriented : 'mixed';
      }
    }
    if (sign === undefined) return undefined;
    return { proven, sign };
  };
  const dependentPoles = dependentPoleScan();
  // Two or more points with a proven pole are taken as a set of positive
  // measure of the other variables on which the inner integral diverges, so
  // the integral diverges with their common sign, or has no value when the
  // signs differ. A single point may be a coincidence of the grid (a pole
  // only on a line of zero measure): it is used only when the quadrature does
  // not converge (see below).
  if (dependentPoles !== undefined && dependentPoles.proven >= 2)
    return dependentPoles.sign === 'positive'
      ? ce.PositiveInfinity
      : dependentPoles.sign === 'negative'
        ? ce.NegativeInfinity
        : ce.NaN;

  const compiled = implicitCompile(ce, fnExpr);
  let raw: (...args: number[]) => unknown;
  if (compiled?.success) raw = compiled.run as (...args: number[]) => unknown;
  else {
    const app = applicable(fnExpr);
    raw = (...args: number[]) => app(args.map((x) => ce.number(x)));
  }
  const integrand = numericIntegrandParts(raw);
  // The part being integrated: the real part first, then — only when a
  // sample showed a non-zero imaginary part — the imaginary part.
  let jsf: (...args: number[]) => number = integrand.re;

  // Nested adaptive Gauss–Kronrod, one level per limit; a level that fails to
  // converge falls back to 1-D Monte Carlo (as the single-limit path does).
  // `argv` (integrand arguments, by parameter slot) and `outerVals` (current
  // integration values, in limit order, consumed by dependent bounds) are
  // shared across levels — the recursion is strictly sequential.
  const argv = new Array<number>(vars.length).fill(NaN);
  const outerVals = new Array<number>(vars.length).fill(NaN);
  const last = limits.length - 1;

  // ONE sub-stream for the whole iterated integral, allocated here rather than
  // per level: a level allocating its own would make the number of sub-streams
  // depend on the integrand's dimension, and the inner levels re-run once per
  // outer quadrature node — so per-level allocation would also make the tag
  // depend on how many nodes the outer level happened to use.
  const draw = ce._substream(mixTags(f.hash, ...limits.map((l) => l.hash)));
  // The number of Monte Carlo estimates that are running now. While one runs,
  // the integrand is read at points that come from random draws: the points
  // of that level, and the quadrature nodes of the inner levels, which move
  // with each random outer value. The second pass (the imaginary part) does
  // not visit these points again, because it continues the same stream and
  // gets new draws. So a cache lookup of such a point can only miss, and the
  // points would also fill the bounded cache, after which the quadrature
  // nodes of the first pass are no longer kept for the second pass. Read the
  // integrand without the cache while this count is not zero.
  let sampling = 0;
  // Whether a level found that its integral diverges (see `integrateDim`).
  let divergent = false;
  // Whether a level did not converge and kept its quadrature result or fell
  // back to Monte Carlo (see `integrateDim`).
  let unconverged = false;
  const integrateDim = (dim: number): { estimate: number; error: number } => {
    // Inner-level error accumulated over this level-invocation's quadrature
    // nodes (the recursion is strictly sequential, so plain locals suffice).
    let innerErrSum = 0;
    let innerErrN = 0;
    // The sum of the magnitudes of the inner estimates at the same nodes, and
    // whether they took both signs (see `inflate`).
    let innerAbsSum = 0;
    let innerPositive = false;
    let innerNegative = false;
    const g = (t: number): number => {
      argv[slots[dim]] = t;
      outerVals[dim] = t;
      if (dim === last)
        return sampling > 0 ? integrand.uncached(jsf)(...argv) : jsf(...argv);
      const r = integrateDim(dim + 1);
      if (Number.isFinite(r.error) && Number.isFinite(r.estimate)) {
        innerErrSum += r.error;
        innerErrN++;
        innerAbsSum += Math.abs(r.estimate);
        if (r.estimate > 0) innerPositive = true;
        if (r.estimate < 0) innerNegative = true;
      }
      return r.estimate;
    };
    const outer = outerVals.slice(0, dim);
    const lower = boundFns[dim][0](outer);
    const upper = boundFns[dim][1](outer);
    if (isNaN(lower) || isNaN(upper)) return { estimate: NaN, error: NaN };
    // This level's own estimator sees a node-VARYING inner error as integrand
    // noise, but a node-INDEPENDENT one is invisible to it: the same biased
    // inner value returns at every node, the integrand looks perfectly smooth
    // and the reported error collapses to ~0 while the true error is the inner
    // bound times this level's range. Add that systematic component explicitly.
    // Each level inflates before returning to its caller, so it compounds.
    //
    // The added term estimates the integral of the inner error over this
    // level's range. When the inner estimates keep one sign, it is the ratio
    // of the summed inner errors to the summed inner magnitudes, times the
    // magnitude of this level's estimate (which is then the integral of the
    // magnitudes). The ratio does not depend on where the nodes are: the
    // nodes of a level with a singularity at a bound (`∫₀¹ ∫₀² y^(−0.999) dx
    // dy`) are packed next to it, where the inner values and errors are
    // huge, and a plain mean of the errors over the nodes then multiplied by
    // the range gave an error of 10²⁸⁹ for an integral of 2000. When the
    // inner estimates take both signs, their magnitudes are not the
    // integral, and the term is the mean inner error times the range. That
    // range factor is only meaningful on a finite interval: over an infinite
    // one it is vacuous (∞ · any inner bound), and would report ±∞ on an
    // otherwise good answer, so such a level propagates nothing extra.
    const span = Math.abs(upper - lower);
    const inflate = (r: {
      estimate: number;
      error: number;
    }): { estimate: number; error: number } => {
      let extra = 0;
      if (innerErrN > 0) {
        if (!(innerPositive && innerNegative) && innerAbsSum > 0) {
          if (Number.isFinite(r.estimate))
            extra = (innerErrSum / innerAbsSum) * Math.abs(r.estimate);
        } else if (Number.isFinite(span))
          extra = (innerErrSum / innerErrN) * span;
      }
      return { estimate: r.estimate, error: r.error + extra };
    };
    // The starting-panel floor multiplies across levels — one full quadrature
    // runs per outer node — so a per-level 16 would cost 16^dimensions. Reduce
    // it so the floor applies to the whole iterated integral, not each level.
    const gk = adaptiveQuadrature(g, lower, upper, {
      initialPanels: initialPanelsForDimensions(limits.length),
      // Every level of an iterated integral checks the span deadline (per
      // panel) and throws the timeout when it expires: one full inner
      // quadrature runs per outer node, so an unchecked level made the whole
      // nest unboundable by any JS-side budget.
      deadline: ce._deadlineFrame,
      // A level with a slowly integrable singularity at a bound is resolved
      // by extrapolating its endpoint shells, as for a one-limit integral
      // (`integrateRealPart`): an accepted extrapolation is a result.
      singularEndpoints: true,
    });
    if (
      (gk.converged || gk.extrapolated === true) &&
      Number.isFinite(gk.estimate)
    )
      return inflate(gk);
    // A level diagnosed as divergent has no finite value: propagate NaN rather
    // than sample it, which would only launder the divergence into a
    // plausible-looking number (and make every outer node pay for it).
    // A level that oscillates without a value has no sign (see
    // `integrateRealPart`): it is not marked `divergent`, so no pole sign is
    // looked for.
    if (gk.divergent) {
      if (gk.oscillates !== true) divergent = true;
      return { estimate: NaN, error: NaN };
    }
    // A stalled level whose error bound already beats the sampler keeps its
    // quadrature result: sampling it would be both less accurate and, since
    // every inner level re-runs per outer node, far more expensive.
    unconverged = true;
    // Its error estimate can be far too small (see `integrateRealPart`), so
    // the error is at least the standard error of the Monte-Carlo estimate it
    // replaces, `|estimate|/√1e4`.
    // So does a level next to a singular corner that the quadrature could
    // not resolve (`singularCorner`, see `integrateRealPart`).
    if (
      (gk.singularCorner === true && Number.isFinite(gk.estimate)) ||
      quadratureBeatsMonteCarlo(gk, 1e4)
    )
      return inflate({
        estimate: gk.estimate,
        error: Math.max(gk.error, Math.abs(gk.estimate) / Math.sqrt(1e4)),
      });
    sampling++;
    try {
      return inflate(
        monteCarloEstimate(g, lower, upper, 1e4, ce._deadlineFrame, draw)
      );
    } finally {
      sampling--;
    }
  };

  // The reported uncertainty is the outermost level's error estimate, inflated
  // by the propagated inner-level error (see `inflate` above).
  const r = integrateDim(0);
  // A level found a divergence: a pole AT a bound of a dimension gives its
  // sign (`∫₀² ∫₀¹ t⁻² dt dx` is `+∞`).
  if (divergent && Number.isNaN(r.estimate)) {
    const endpoint = poleValue(endpointPoleVerdict);
    if (endpoint !== undefined) return endpoint;
  }
  // A level did not converge or diverged, and one point of the grid of
  // `dependentPoleScan` has a proven pole: the integral may diverge, and the
  // quadrature result is not a value for it.
  if ((divergent || unconverged) && dependentPoles !== undefined) return ce.NaN;
  if (Number.isNaN(r.estimate) && !integrand.sawNumeric()) return undefined;
  if (!integrand.sawImaginary()) return measurementFromParts(ce, r);
  jsf = integrand.im;
  return measurementFromParts(ce, r, integrateDim(0));
}

/**
 * The free symbols of `expr`, INCLUDING those reachable only through the
 * bodies of the user-defined functions it calls.
 *
 * `expr.unknowns` is a SURFACE property: for `n(x)` where `n = x ↦ q + x` it
 * reports nothing, because `q` occurs in `n`'s body, not in the integrand as
 * written. The numeric integration path still needs a value for `q`, so the
 * surface set is the wrong question to ask before numericizing (Tycho item
 * 131: the compiled body emitted a `_.q` vars-object lookup that has no `_`
 * in scope, and the raw `ReferenceError` escaped out of `.N()`).
 *
 * **A name means something different on each side of a definition boundary**,
 * so `bound` is never carried across one. `bound` — the caller's binders, an
 * integration variable — applies to the SURFACE expression only. Crossing into
 * a user function's body re-establishes it from that callee's OWN parameter
 * names; crossing into an assigned value clears it entirely (a value has no
 * parameters, and its free variables answer to the scope it was assigned in).
 *
 * Filtering the flattened result by the caller's binders instead would discard
 * a callee's capture that merely SHARES a binder's spelling: for
 * `n = t ↦ x + t` with `x` unassigned, `∫ n(x) dx` would drop `n`'s free `x`
 * as if it were the integration variable, numericize, and return `NaN` where
 * the honest answer is symbolic.
 *
 * `seen` (shared across the whole walk, keyed on the definition) terminates
 * recursive definitions and self-referential bindings.
 */
function transitiveUnknowns(
  expr: Expression,
  bound: ReadonlySet<string>
): string[] {
  const out = new Set<string>();
  const seen = new Set<object>();
  const collect = (root: Expression, names: ReadonlySet<string>): void => {
    for (const s of root.unknowns) if (!names.has(s)) out.add(s);
    const visit = (node: Expression): void => {
      // An ASSIGNED value can itself hold a free symbol (`c` in `b = c + 1`):
      // `b` is known, so neither `unknowns` nor the compiler's fold reports
      // `c`, yet the folded code still references it.
      if (isSymbol(node)) {
        const valueDef = node.valueDefinition;
        const value = valueDef?.value;
        if (value !== undefined && !seen.has(valueDef as object)) {
          seen.add(valueDef as object);
          collect(value, NO_BOUND_NAMES);
        }
        return;
      }
      if (!isFunction(node)) return;
      const opDef = node.operatorDefinition;
      const lambda = opDef?.lambda;
      if (lambda !== undefined && !seen.has(opDef as object)) {
        seen.add(opDef as object);
        collect(lambda.body, new Set(lambda.parameters.map((p) => p.name)));
      }
      for (const op of node.ops) visit(op);
    };
    visit(root);
  };
  collect(expr, bound);
  return [...out];
}

/** No names are bound: used at a definition boundary that binds none. */
const NO_BOUND_NAMES: ReadonlySet<string> = new Set<string>();

/**
 * Find the calls in `expr` of a user function that has the name of a library
 * function (`Sin`, `Exp`, `Ln`, …). `names` holds the library names that a
 * user definition in the current scope chain shadows
 * (`shadowedLibraryNames()`). Inside a function literal, its parameters with
 * a library name are added, and inside an expression with a local scope (a
 * function body, a block), the library names that the bindings of this
 * scope shadow are added (`libraryNamesShadowedIn()`). These local scopes
 * are not in the current scope chain while the integral is evaluated.
 *
 * Return `'local'` when a call is of a name that a local scope shadows,
 * `'call'` when the calls are all of names in `names`, and `'none'` when
 * there is no such call.
 */
function shadowedCallsIn(
  ce: ComputeEngine,
  expr: Expression,
  names: ReadonlySet<string>
): 'none' | 'call' | 'local' {
  const system = ce.contextStack[0]?.lexicalScope;
  let result: 'none' | 'call' | 'local' = 'none';
  const scan = (x: Expression, local: ReadonlySet<string>): void => {
    if (result === 'local' || !isFunction(x)) return;
    if (isOperatorDef(system?.bindings.get(x.operator))) {
      if (local.has(x.operator)) result = 'local';
      else if (names.has(x.operator)) result = 'call';
    }
    let inner = local;
    const add = (name: string) => {
      if (inner.has(name) || system?.bindings.get(name) === undefined) return;
      inner = new Set([...inner, name]);
    };
    if (x.operator === 'Function')
      for (const p of x.ops.slice(1)) {
        const name = sym(p);
        if (name) add(name);
      }
    if (x.localScope !== undefined)
      for (const name of libraryNamesShadowedIn(ce, x.localScope)) add(name);
    for (const op of x.ops) scan(op, inner);
  };
  scan(expr, NO_BOUND_NAMES);
  return result;
}

/**
 * The integrand `integrand` of an `Integrate` (a lifted integrand, see
 * `liftIntegrand()`), with each call of a user function that has the name
 * of a library function replaced by the body of the user function.
 *
 * The antiderivative, the integration rules and the residue method select
 * a function by its NAME. With a user definition `Sin := t ↦ t + 1`, the
 * library rule `∫ sin x dx = −cos x` is false for a call of `Sin`. When the
 * body of the user function replaces the call, the integral is the integral
 * of the body, and these methods give its closed form, as `D` does when it
 * differentiates the body of a user function.
 *
 * The caller has found such a call (`shadowedCallsIn()` is `'call'`).
 * Return `undefined` when a call cannot be replaced, and the integral must
 * stay unevaluated:
 * - the user function is not a function literal (an `evaluate` handler);
 * - the evaluated body still has a call of a shadowed name (a recursive
 *   function), or is not valid;
 * - the body has a free symbol with the name of an integration variable in
 *   `bound`. The integral binds this name, so the body would read the
 *   integration variable instead of the symbol of the user function.
 */
function inlineShadowedCalls(
  ce: ComputeEngine,
  integrand: Expression,
  names: ReadonlySet<string>,
  bound: ReadonlyArray<string>
): Expression | undefined {
  // A function literal that `liftIntegrand()` did not unwrap would be
  // canonicalized again when its body changes, which wraps the body again.
  if (integrand.operator === 'Function') return undefined;

  const system = ce.contextStack[0]?.lexicalScope;
  const bodyOf = (call: Expression): Expression | undefined => {
    if (!isFunction(call)) return undefined;
    const def = ce.lookupDefinition(call.operator);
    const isLiteral = isOperatorDef(def)
      ? def.operator.lambda !== undefined
      : isValueDef(def) && isFunction(def.value.value, 'Function');
    if (!isLiteral) return undefined;
    // The body of the user function, with wildcard parameters, then with
    // the arguments of the call.
    const wildcards =
      call.nops === 1
        ? [ce.symbol('_')]
        : call.ops.map((_, i) => ce.symbol(`_${i + 1}`));
    let body: Expression;
    try {
      body = ce.function(call.operator, wildcards).evaluate();
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      return undefined;
    }
    if (!body.isValid || shadowedCallsIn(ce, body, names) !== 'none')
      return undefined;
    const parameters = wildcards.map((w) => sym(w)!);
    if (body.symbols.some((s) => !parameters.includes(s) && bound.includes(s)))
      return undefined;
    const substitution: Record<string, Expression> = {};
    parameters.forEach((p, i) => (substitution[p] = call.ops[i]));
    return body.subs(substitution);
  };

  let failed = false;
  const result = integrand.map((x) => {
    if (
      failed ||
      !isFunction(x) ||
      !names.has(x.operator) ||
      !isOperatorDef(system?.bindings.get(x.operator))
    )
      return x;
    const body = bodyOf(x);
    if (body === undefined) failed = true;
    return body ?? x;
  });
  return failed ? undefined : result;
}

/**
 * The shape gate `list<any>` that `JacobianMatrix`'s type handler asks its
 * operand: "does this denote a SYSTEM of functions?". Asked with the
 * absence-admitting top so that a list whose element type carries an
 * absence marker still matches. Built once at module load.
 */
const JACOBIAN_LIST_SHAPE_TYPE: Type = Object.freeze({
  kind: 'list',
  elements: 'any',
}) as Type;

/**
 * The type a SYMBOL operand's held value has, or `undefined` when the
 * operand is not a symbol, holds nothing, or holds another symbol.
 *
 * A held value is a pure source, and it carries what a wide declaration
 * does not: a head declared as a bare `function` and only then assigned a
 * lambda keeps `function` as its contract, while the lambda itself has a
 * signature whose codomain `Derivative` wants. The definition is looked up
 * by name, which is the binding the operand itself resolves through.
 */
function heldValueTypeOf(
  d: OperandDescriptor,
  engine: PureEngineView
): Type | undefined {
  const structure = d.structureOf?.();
  if (structure?.kind !== 'symbol') return undefined;
  const held = engine.lookupDefinition(structure.name)?.value?.value;
  if (held === undefined || isSymbol(held)) return undefined;
  return held.type.type;
}

/**
 * The type of the VALUE an operand denotes, for an operand that a lazy
 * operator receives raw.
 *
 * A held operand is unbound, so its own type is `unknown` — even for
 * `Sin(x)` or for a symbol declared with a signature. Two pure channels
 * recover the answer: an application is typed by `derive`, which runs the
 * head's own `type` handler and otherwise instantiates its declared
 * signature; a symbol is read from its definition, and where that names a
 * function, from what the function RETURNS (its declaration first, then the
 * lambda it holds, which is the only codomain a head declared as a bare
 * `function` has).
 */
function denotedTypeOf(
  d: OperandDescriptor,
  { engine, derive }: TypeHandlerContext
): Type {
  const structure = d.structureOf?.();
  if (structure?.kind === 'application')
    return derive(structure.head, structure.children) ?? d.type;
  if (structure?.kind === 'symbol') {
    // Four places a symbol's codomain can live, in decreasing precision: the
    // operand's own type (a bound symbol carries its signature there, while
    // a RAW held one is still `unknown`), the value declaration, the lambda
    // the symbol holds — the only codomain a head declared as a bare
    // `function` has — and, for a symbol that a lambda assignment made
    // CALLABLE, the operator half's signature, which is where that
    // assignment records the inferred codomain.
    const binding = engine.lookupDefinition(structure.name);
    const def = binding?.value;
    for (const t of [
      d.type,
      def?.type.type,
      def?.value?.type.type,
      binding?.operator?.signature.type,
    ]) {
      if (t === undefined) continue;
      const result = functionResult(t);
      if (result !== undefined && result !== 'any' && result !== 'unknown')
        return result;
    }
    return def?.type.type ?? d.type;
  }
  return d.type;
}

/**
 * Collect the dependent-function symbol name(s) from the second argument of
 * `DSolve`/`NDSolve` (a symbol or a `List` of symbols).
 */
function dependentSymbolNames(dependent: Expression): Set<string> {
  const names = new Set<string>();
  if (isSymbol(dependent)) names.add(dependent.symbol);
  else if (isFunction(dependent, 'List'))
    for (const op of dependent.ops) if (isSymbol(op)) names.add(op.symbol);
  return names;
}

/**
 * Repair a differential equation parsed from LaTeX on a *fresh* engine where
 * the dependent function `y` is not yet declared as a function. In that state,
 * `y(x)` parses as an invisible product `InvisibleOperator(y, Delimiter(x))`
 * instead of the function application `y(x)`, leaving `DSolve` inert. The
 * `DSolve`/`NDSolve` canonical handlers know the dependent name(s) (the second
 * argument), so we can locally rewrite `InvisibleOperator(y, Delimiter(args))`
 * → `y(args)` for those names — including nested occurrences inside `List`
 * conditions — without perturbing global parser inference. A second parse on
 * the same engine parses `y(x)` correctly (once `y` is known to be a function),
 * so this only affects the first-parse form.
 */
function repairDependentApplications(
  expr: Expression,
  names: Set<string>
): Expression {
  if (names.size === 0 || !isFunction(expr)) return expr;
  const ce = expr.engine;

  if (expr.operator === 'InvisibleOperator') {
    const ops = expr.ops;
    const newOps: Expression[] = [];
    for (let i = 0; i < ops.length; i++) {
      const cur = ops[i];
      const next = ops[i + 1];
      if (
        isSymbol(cur) &&
        names.has(cur.symbol) &&
        next &&
        isFunction(next, 'Delimiter')
      ) {
        const inner = next.op1;
        const args =
          inner && isFunction(inner, 'Sequence')
            ? inner.ops
            : inner
              ? [inner]
              : [];
        newOps.push(ce.function(cur.symbol, args));
        i += 1; // consume the delimiter
      } else newOps.push(repairDependentApplications(cur, names));
    }
    if (newOps.length === 1) return newOps[0];
    return ce.function('InvisibleOperator', newOps);
  }

  let changed = false;
  const newOps = expr.ops.map((op) => {
    const repaired = repairDependentApplications(op, names);
    if (repaired !== op) changed = true;
    return repaired;
  });
  if (!changed) return expr;
  return ce.function(expr.operator, newOps);
}

/**
 * If `expr` is a bare reference to a user-defined function (`F`, not `F(…)`),
 * return its parameter names (the natural differentiation variables, in
 * declared order) and its body. `undefined` otherwise.
 *
 * The parameter *order* is why this beats free-variable inference: the map's
 * own signature fixes the column order of the Jacobian, with no lexicographic
 * guess.
 */
function lambdaFromLiteral(
  literal: Expression
): { params: string[]; body: Expression } | undefined {
  if (!isFunction(literal, 'Function')) return undefined;

  const params = literal.ops
    .slice(1)
    .map((p) => functionLiteralParameterName(p));
  if (params.length === 0 || params.some((n) => !n)) return undefined;

  // Canonicalization wraps a lambda body in a `Block`; a single-statement
  // block is just its statement (a multi-statement body is not a plain system
  // and is declined).
  let body = literal.op1;
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    // Lifting the body out of its Block takes it out of the scope that binds
    // the parameters, so occurrences of `x` in the returned body would still
    // point at the lambda's (now unreachable) parameter binding. Re-bind them
    // to the caller's symbols — which is what "the Jacobian is taken with
    // respect to the parameters, in declared order" means, and what makes the
    // bare form agree with the applied form.
    const scope = body.localScope;
    body = body.op1;
    if (scope) body = rebindEscaping(body, scope);
  }
  return { params: params as string[], body };
}

function bareFunctionLambda(
  expr: Expression,
  seen: Set<string> = new Set()
): { params: string[]; body: Expression } | undefined {
  // A `Function` literal directly (e.g. the value a pipe resolves `F` to).
  if (isFunction(expr, 'Function')) return lambdaFromLiteral(expr);

  if (!isSymbol(expr) || seen.has(expr.symbol)) return undefined;
  seen.add(expr.symbol);
  const def = expr.engine.lookupDefinition(expr.symbol);

  // A named function: its operator definition holds the lambda literal.
  const opDef = (def as { operator?: unknown } | undefined)?.operator as
    { _isLambda?: boolean; _lambdaLiteral?: Expression } | undefined;
  if (opDef?._isLambda && opDef._lambdaLiteral)
    return lambdaFromLiteral(opDef._lambdaLiteral);

  // A value binding. `F |> JacobianMatrix` reaches the handler with `F` bound
  // as a VALUE whose content is the `Function` literal (or, one level up, the
  // symbol `F`); a direct call sees the operator definition instead. Follow
  // either so the pipe and direct forms agree.
  const value = (def as { value?: { value?: Expression } } | undefined)?.value
    ?.value;
  if (value !== undefined) return bareFunctionLambda(value, seen);
  return undefined;
}

function bareFunctionSystem(
  list: Expression
): { params: string[]; bodies: Expression[] } | undefined {
  // `[a, b, c] |> JacobianMatrix` — a List whose elements are all bare
  // function references. Resolve only when EVERY element is such a reference
  // and all parameter lists agree exactly, in names and order; the shared
  // parameters are then the default differentiation variables. A mixed list,
  // or lambdas with differing parameters, would need a guessed variable
  // correspondence — decline instead.
  if (!isFunction(list, 'List') || list.nops === 0) return undefined;
  const lambdas: { params: string[]; body: Expression }[] = [];
  for (const op of list.ops) {
    const lambda = bareFunctionLambda(op);
    if (lambda === undefined) return undefined;
    lambdas.push(lambda);
  }
  const params = lambdas[0].params;
  for (const l of lambdas)
    if (
      l.params.length !== params.length ||
      l.params.some((p, i) => p !== params[i])
    )
      return undefined;
  return { params, bodies: lambdas.map((l) => l.body) };
}

/** The heads whose presence in a result means "no closed form was found". */
const DERIVATIVE_HEADS = ['D', 'Derivative', 'ND'] as const;

/**
 * Fold the raw output of the symbolic differentiator into the form the `D`
 * operator answers with.
 *
 * The fold is a plain `evaluate()`, skipped when the result carries a symbolic
 * transcendental (`ln(2)`) so the exactness contract keeps that symbolic.
 *
 * A piecewise result is folded ARM BY ARM instead. `Which` and `If` are
 * selectors: a condition that cannot be decided (the usual case for a
 * derivative, whose variable is free) leaves the node evaluating to itself
 * with its held arms untouched. A single `evaluate()` on the whole node
 * therefore leaves each arm exactly as the differentiation rules wrote it — a
 * `2·ln(e)·e^(-2x)` where the same derivative written without a condition
 * reads `2·e^(-2x)`. The conditions are boolean operands, not values, so they
 * are carried over unchanged.
 */
function foldDerivativeResult(f: Expression): Expression {
  if (isFunction(f)) {
    // `Which` operands are strictly paired `(condition, value)`, so a value
    // arm sits at every odd position; an `If` has one condition followed by
    // its branches. An odd `Which` operand count is a malformed call — leave
    // it to the ordinary fold rather than guessing how to pair it.
    const isWhich = f.operator === 'Which' && f.nops % 2 === 0;
    if (isWhich || f.operator === 'If')
      return f.engine.function(
        f.operator,
        f.ops.map((op, i) =>
          (isWhich ? i % 2 === 1 : i > 0) ? foldDerivativeResult(op) : op
        )
      );
  }
  return hasSymbolicTranscendental(f) ? f : f.evaluate();
}

/**
 * Target-agnostic compile lowering for the derivative heads (`D`,
 * `Derivative`, `ND`): the differentiation itself is a symbolic operation with
 * no runtime counterpart on any target, but its *result* is an ordinary
 * expression the normal compiler already handles. So obtain the closed form
 * and compile that instead.
 *
 * `.evaluate()`, never `.simplify()`: evaluate is what produces the closed
 * form here, and `.simplify()` inside a compile path invites the recursion
 * hazards documented in CLAUDE.md.
 *
 * Only a PURE derivative node is evaluated: evaluating happens at COMPILE
 * time, so an impure body (`ND(Function(Random(), x), 1.5)` runs the numerical
 * stencil during compilation) would consume its random draws once and freeze
 * the sampled result into the emitted code. Decline instead, so the draw
 * timing and the run-time semantics are left intact.
 *
 * Purity is not enough, though: canonicalizing and evaluating can also
 * DECLARE. `devolveUnappliedOperator` (`boxed-expression/validate.ts`) turns a
 * single-uppercase-letter builtin used as a bare operand into a variable by
 * shadowing the builtin — `D` in `D(D·x², x)` is a legitimate free variable —
 * and that shadow persists in whatever scope is current. Left to the caller's
 * scope it would replace the engine's `D` *operator* definition for the
 * engine's lifetime, so every later derivative compilation would report
 * ``Unknown operator `D` ``. Compiling must not mutate the engine, so the
 * whole closed-form computation runs in a throwaway child scope; any
 * declaration it makes dies with the scope.
 *
 * The node is BUILT inside that scope, not merely evaluated there: the scope a
 * binder's `localScope` descends from is fixed when the node is canonicalized,
 * and evaluating a binder re-enters that parent (`rebindEscapingCurrentScope`).
 * A node canonicalized outside would declare outside, whatever scope is
 * current at `.evaluate()`.
 *
 * Declines (returns `undefined`, never throws) when no closed form is
 * available — the result is unchanged, or still carries a derivative head
 * (an opaque user function differentiates to `Apply(Derivative(f,1), x)`;
 * `ND` at a symbolic point stays put). Declining lets the standard
 * `noLoweringMessage` report it, and leaves the door open for a custom target
 * that does map the head — a thrown error here would pre-empt it, since a
 * per-operator handler is consulted BEFORE the target's function table.
 */
function compileDerivative(
  operator: (typeof DERIVATIVE_HEADS)[number],
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  context?: { readonly language: string }
): string | undefined {
  if (args.length === 0) return undefined;

  // The numeric fallback for the no-closed-form declines below (item 177).
  // NOT used for the impure decline: an impure body's stencil would re-draw
  // its random values at every stencil point, and the interpreted route
  // declines it too — the two routes must fail (or fall back) together.
  const fallback = (): string | undefined =>
    compileNumericDerivativeFallback(operator, args, compile, context);

  const ce = args[0].engine;
  let node: Expression;
  let value: Expression;
  // Isolation scope — see the note above. A child of the caller's scope, so
  // every declaration the caller made is still visible; only what this
  // evaluation declares is confined, and discarded on the way out. The closed
  // form outlives the scope: `compile()` below resolves its free symbols by
  // name against the target's bindings, not against this scope.
  ce.pushScope();
  try {
    node = ce.function(operator, args as Expression[]);
    // An impure node (`ND` of a body drawing random values, say) must not be
    // evaluated here: that would happen at compile time and bake one sample
    // into the emitted code.
    if (!node.isPure) return undefined;
    value = node.evaluate();
  } catch (e) {
    // A caller's timeout, an abort or an iteration limit propagates; only
    // an ordinary evaluation error falls back.
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return fallback();
  } finally {
    ce.popScope();
  }
  if (!value.isValid) return fallback();
  // Re-entry guard: an unchanged result would compile straight back into this
  // handler. This is also where the differentiation growth budget surfaces:
  // `differentiate()` declines past `MAX_DERIVATIVE_NODES` (a deeply-nested
  // body whose derivative's term count grows exponentially), the evaluate
  // handler then returns the node unchanged, and the numeric fallback takes
  // over — instead of the compilation failing closed (Tycho item 177).
  if (value.isSame(node)) return fallback();
  // No closed form: a derivative head survived the evaluation. Head-aware:
  // `has()` would also match a plain symbol named `D`, which is a legitimate
  // free variable in a closed form.
  if (DERIVATIVE_HEADS.some((h) => value.getSubexpressions(h).length > 0))
    return fallback();

  try {
    // The closed form is a FRESH expression in the engine's angular
    // convention (`d/dx sin x = (π/180)·cos x` in degree mode) — it never went
    // through the entry-point rewrite, which skips the derivative heads
    // precisely so that differentiation runs in that convention. Rewrite it
    // here, or the radian-based `Math.cos` the target emits would disagree
    // with `evaluate()`. Same reason `prepareUserFunctionBody` rewrites an
    // emitted function-literal body.
    return compile(rewriteAngularUnit(value)) || undefined;
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    // The closed form contains a head this target cannot lower (`Digamma` on
    // glsl, say). Decline rather than let the inner error escape: a
    // per-operator handler runs BEFORE the target's function table, so
    // throwing would pre-empt a custom target that does map that head. The
    // trade-off is deliberate — the inner message names the offending head and
    // is more informative than the generic decline the fallthrough produces,
    // but contract-correctness wins. Do not "restore" the throw.
    return fallback();
  }
}

/**
 * Emit a NUMERIC differentiation when the symbolic closed form is
 * unavailable — the shared-budget fallback of Tycho item 177 (user-ruled
 * 2026-08-14): within the differentiation growth budget both routes use the
 * exact closed form; past it, the compiled target and the interpreter's
 * `N()` both fall back to the SAME stencil (`centeredDiffHigherOrder`,
 * numerics/numeric.ts — injected into emitted code as `_SYS.nd`), so
 * compiled-vs-interpreted parity holds by construction. Plain `evaluate()`
 * keeps its exactness contract: it returns the node symbolically unchanged
 * rather than a stencil float (see `numericDerivativeOfApply`).
 *
 * javascript target only: the other targets keep today's decline (each
 * would need its own `nd` runtime; add per-target when asked). Univariate,
 * single-order, PURE bodies only — mixed partials and impure bodies decline
 * on both routes alike.
 */
function compileNumericDerivativeFallback(
  operator: (typeof DERIVATIVE_HEADS)[number],
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  context?: { readonly language: string }
): string | undefined {
  if (context?.language !== 'javascript') return undefined;
  if (args.length === 0) return undefined;
  const ce = args[0].engine;
  try {
    if (operator === 'D') {
      // `D(body, v)` is EXPRESSION-valued: emit the stencil function applied
      // at the (free) variable. Multi-variable / repeated-variable partials
      // keep the symbolic-only behavior.
      if (args.length !== 2) return undefined;
      const v = args[1];
      if (!isSymbol(v)) return undefined;
      const body = args[0];
      if (!body.isPure) return undefined;
      const fn = ce.function('Function', [body, v]);
      return `_SYS.nd(${compile(rewriteAngularUnit(fn))}, 1${shapeArgument(
        fn
      )})(${compile(v)})`;
    }

    // `Derivative(f, order?)` is FUNCTION-valued; `ND(f, x)` is a value at a
    // point. Both need `f` as a compilable univariate function literal
    // (resolving a symbol callee through its binding). The literal is
    // rewritten for the angular convention explicitly — as an operand of a
    // derivative head it was skipped by the entry-point rewrite (see the
    // closed-form branch above); the interpreted fallback gets the same
    // rewrite implicitly because `implicitCompile` runs the full compile
    // entry on the literal.
    const lit = resolveDerivativeFunctionLiteral(args[0]);
    if (lit === undefined) return undefined;

    if (operator === 'Derivative') {
      if (args.length > 2) return undefined;
      const order = args[1] === undefined ? 1 : Math.floor(args[1].N().re);
      if (!Number.isFinite(order) || order < 1) return undefined;
      return `_SYS.nd(${compile(rewriteAngularUnit(lit))}, ${order}${shapeArgument(
        lit
      )})`;
    }

    // `ND` — previously compilable only when the point was numeric at
    // compile time (the evaluate handler ran the stencil then); a runtime
    // point now lowers to the same stencil evaluated at run time.
    if (args.length !== 2) return undefined;
    return `_SYS.nd(${compile(rewriteAngularUnit(lit))}, 1${shapeArgument(
      lit
    )})(${compile(args[1])})`;
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    // The body contains a head the target cannot lower — same contract as
    // the closed-form branch: decline, never let the inner error escape.
    return undefined;
  }
}

/**
 * Resolve a derivative-head operand to a compilable univariate `Function`
 * literal. A literal passes through; a SYMBOL callee (`Derivative(f)` where
 * `f := x ↦ …`) resolves through its binding — the value-definition's stored
 * `Function` value, or the operator definition's `_lambdaLiteral` (the
 * literal a lambda-backed `f(x) := …` was installed from).
 * `canonicalFunctionLiteral` deliberately returns symbols unchanged (its
 * case 2), so it cannot do this resolution. Builtin operator symbols
 * (`Sin`) return `undefined` — their derivatives have closed forms, so the
 * fallback is never the right tool for them.
 */
function resolveDerivativeFunctionLiteral(
  expr: Expression | undefined
): Expression | undefined {
  if (expr === undefined) return undefined;
  let lit: Expression | undefined;
  if (isFunction(expr, 'Function')) lit = expr;
  else if (isSymbol(expr)) {
    // Prefer the instance's own binding; fall back to a BY-NAME lookup in
    // the current scope — a symbol operand reaching a compile handler is
    // not necessarily bound (the compilation walks operand instances that
    // may predate binding), the same reason `base-compiler.ts` resolves
    // operator heads with `lookupApplicable` rather than through the
    // instance.
    let vdef = expr.valueDefinition;
    let odef = expr.operatorDefinition;
    if (vdef === undefined && odef === undefined) {
      const found = lookupApplicable(
        expr.symbol,
        expr.engine.context.lexicalScope
      );
      if (found !== undefined && isOperatorDef(found)) odef = found.operator;
      else if (found !== undefined && isValueDef(found)) vdef = found.value;
    }
    const v = vdef?.value;
    lit =
      v !== undefined && isFunction(v, 'Function') ? v : odef?._lambdaLiteral;
  }
  if (lit === undefined || !isFunction(lit, 'Function')) return undefined;
  // Univariate only: `Function(body, param)`.
  if (lit.ops.length !== 2) return undefined;
  if (!lit.isPure) return undefined;
  return lit;
}

/**
 * The third argument of the emitted `_SYS.nd(f, order, shape)`: the shape
 * of the function's value read from its result type
 * (`derivativeValueShape`), so the helper runs the scalar or the vector
 * stencil without probing the function; nothing when the type says
 * nothing, and the helper probes once at run time.
 */
function shapeArgument(lit: Expression): string {
  const shape = derivativeValueShape(functionResult(lit.type.type));
  return shape === undefined ? '' : `, '${shape}'`;
}

/**
 * The INTERPRETED half of the item-177 numeric-derivative fallback: given an
 * `Apply(Derivative(f, order?), x)` that stayed symbolic because no closed
 * form was found (the differentiation growth budget, or an unresolvable
 * head), compute the same stencil the compiled target emits
 * (`centeredDiffHigherOrder` — one shared function, so the two routes agree
 * bit-for-bit). Returns `undefined` — leaving the expression symbolic — when
 * the shape is not the univariate pure single-point case, mirroring
 * `compileNumericDerivativeFallback`'s gates.
 *
 * A function whose value is a POINT or a LIST of numbers — a space curve
 * `t ↦ (x(t), y(t), z(t))` — is differentiated component by component, each
 * component through the same stencil, exactly as the compiled `_SYS.nd`
 * does; the result has the kind of the function's value (a point for a
 * point-valued function, a list otherwise).
 *
 * Called ONLY from `Apply`'s evaluate handler under `numericApproximation`
 * (library/core.ts): plain `evaluate()` keeps the exactness contract and
 * returns the symbolic expression untouched.
 */
export function numericDerivativeOfApply(
  expr: Expression
): Expression | undefined {
  if (!isFunction(expr, 'Apply')) return undefined;
  if (expr.ops.length !== 2) return undefined;
  const callee = expr.op1;
  if (!isFunction(callee, 'Derivative')) return undefined;
  if (callee.ops.length > 2) return undefined;
  if (!callee.isPure) return undefined;

  const ce = expr.engine;
  const order = callee.ops.length === 2 ? Math.floor(callee.ops[1].N().re) : 1;
  if (!Number.isFinite(order) || order < 1) return undefined;

  const lit = resolveDerivativeFunctionLiteral(callee.op1);
  if (lit === undefined) return undefined;

  const x = expr.ops[1].N().re;
  if (Number.isNaN(x)) return undefined;

  return stencilDerivativeAt(ce, lit, x, order);
}

/**
 * The numeric `order`-th derivative of the univariate function literal
 * `lit` at `x`, through the stencil `centeredDiffHigherOrder` — the SAME
 * function the compiled JavaScript target's `_SYS.nd` runs, so the two
 * routes agree bit-for-bit. A scalar function answers a machine number; a
 * point- or list-valued function is differentiated component by component
 * through the vector form of the stencil (`centeredDiffHigherOrderVector`,
 * one evaluation per sample) and answers a point (`Tuple`) when the
 * literal's result type is a point, a `List` otherwise, a component that
 * the stencil cannot compute being `NaN` in place — the value the compiled
 * route emits. `undefined` — the expression stays symbolic — when a scalar
 * stencil answers NaN, or when the function does not answer a vector of one
 * length at every sample.
 *
 * Which stencil runs is decided from the literal's result type
 * (`derivativeValueShape`); only a function whose type says nothing is
 * probed at `x` once, so the common typed scalar case costs no extra
 * evaluation. The evaluation vehicle is the compiled literal where JIT is
 * available and the interpreted application otherwise (`numericApplier`).
 * The values are machine arithmetic throughout, so they are boxed as machine
 * numbers rather than wrapped in a `BigDecimal` at a higher engine
 * precision.
 */
function stencilDerivativeAt(
  ce: ComputeEngine,
  lit: Expression,
  x: number,
  order: number
): Expression | undefined {
  const result = functionResult(lit.type.type);
  const shape = derivativeValueShape(result);
  const fn = numericApplier(ce, lit);
  const vector =
    shape === 'vector' || (shape === undefined && Array.isArray(fn(x)));
  if (!vector) {
    const v = centeredDiffHigherOrder(
      (t) => {
        const value = fn(t);
        return typeof value === 'number' ? value : NaN;
      },
      x,
      order
    );
    if (Number.isNaN(v)) return undefined;
    // A numeric derivative is a float, even when its value is an integer
    // (`ND(x^2, 1)` is `2.0`). `+ 0` turns a -0 into 0.
    return ce.number(ce._inexactNumericValue(v + 0));
  }
  const components = centeredDiffHigherOrderVector(
    (t) => {
      const value = fn(t);
      return Array.isArray(value) ? value : undefined;
    },
    x,
    order
  );
  if (components === undefined) return undefined;
  const boxed = components.map((c) =>
    ce.number(ce._inexactNumericValue(c + 0))
  );
  return ce.function(isPointElementType(result) ? 'Tuple' : 'List', boxed);
}

/**
 * The shape of the value of a function whose result type is `result`, for
 * the numeric derivative: `'vector'` for a point or a list of numbers,
 * `'scalar'` for a number, `undefined` when the type says nothing (`any`,
 * `unknown`, or absent) — the stencil then probes the function once.
 */
export function derivativeValueShape(
  result: Type | undefined
): 'vector' | 'scalar' | undefined {
  if (result === undefined || result === 'any' || result === 'unknown')
    return undefined;
  if (isPointElementType(result) || isSubtype(result, 'list<number>'))
    return 'vector';
  if (isSubtype(result, 'number')) return 'scalar';
  return undefined;
}

/**
 * Does `e` hold an application of the `D` operator anywhere below it? The
 * symbolic differentiator leaves a `D(body, v)` where it has no rule
 * (`symbolic/derivative.ts`), so one inside a closed form marks it
 * incomplete. A user function that happens to be NAMED `D` is read the same
 * way; the cost of that misreading is the stencil where a closed form
 * existed, never a wrong value.
 */
function holdsUnresolvedD(e: Expression): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === 'D') return true;
  return e.ops.some(holdsUnresolvedD);
}

/**
 * A machine-number applier for a univariate function literal: the compiled
 * literal where JIT is available, the interpreted application otherwise. A
 * point- or list-valued function answers an array of its components, a
 * scalar one a number.
 */
function numericApplier(
  ce: ComputeEngine,
  lit: Expression
): (x: number) => number | number[] {
  // The application is NUMERICIZED (`N()`), not merely evaluated: an exact
  // constant inside the value — `sin(1)` in `t ↦ [sin(1), t]` — would
  // otherwise stay symbolic at every sample and read as NaN.
  const interpreted = (x: number): number | number[] => {
    const value = ce.function('Apply', [lit, ce.number(x)]).N();
    if (isNumber(value)) return realPart(value);
    // `each` is absent on a collection whose elements cannot be enumerated.
    if (value.isCollection && typeof value.each === 'function')
      return [...value.each()].map((c) => (isNumber(c) ? realPart(c) : NaN));
    return NaN;
  };
  const run = implicitCompile(ce, lit)?.run as
    ((x: number) => unknown) | undefined;
  if (run === undefined) return interpreted;
  return (x) => {
    const value = run(x);
    // A compiled SYMBOL (a function name the caller did not resolve to its
    // literal) answers `undefined` for a positional argument; the
    // interpreted application still answers it.
    if (value === undefined) return interpreted(x);
    return Array.isArray(value) ? value.map(machineReal) : machineReal(value);
  };
}

/**
 * A number literal as a machine real: its real part when its imaginary
 * part is zero, `NaN` otherwise — the same test the compiled route's
 * `realFn` applies, so a complex sample is rejected on both routes rather
 * than silently read as its real part.
 */
function realPart(n: Expression): number {
  return isNumber(n) && !n.isComplex ? n.re : NaN;
}

/**
 * A value the compiled literal answered, as a machine real: a number as it
 * is, a complex result object with a zero imaginary part as its real part,
 * anything else `NaN` (the test of the compiled route's `realFn`).
 */
function machineReal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { re?: unknown }).re === 'number' &&
    (value as { im?: unknown }).im === 0
  )
    return (value as { re: number }).re;
  return NaN;
}

/**
 * The `Function` literal a user-defined function symbol is bound to, or
 * `undefined`. A function defined by a lambda (`g(x, y) := x^2 y`, or
 * `Assign(g, Function(…))`) is installed as an OPERATOR definition that keeps
 * the literal on its `_lambdaLiteral` slot; the declare-then-assign idiom
 * (`ce.declare('g', 'function')` then `ce.assign`) keeps it as the symbol's
 * VALUE. `op.value` answers neither reliably — for the operator route it is
 * the operator wrapper, not the literal.
 */
function functionLiteralOf(
  ce: ComputeEngine,
  id: string
): Expression | undefined {
  const def = ce.lookupDefinition(id);
  if (def !== undefined && isOperatorDef(def)) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    return isFunction(literal, 'Function') ? literal : undefined;
  }
  const value = ce._getSymbolValue(id);
  return isFunction(value, 'Function') ? value : undefined;
}

/**
 * The numeric limit of the function literal `f` at the point `x`, by
 * Richardson extrapolation, as a float. `undefined` when the point has no
 * numeric value; `NaN` when the samples do not converge.
 *
 * A function with no non-real constant is sampled as a real function, with
 * compiled machine arithmetic when the body compiles. A function with a
 * non-real constant (`t ↦ Gamma(i·t)`) can take complex values: the
 * extrapolation works on real samples, so the real part and the imaginary
 * part are extrapolated separately, and the limit exists when both
 * converge. Its samples come from the interpreter, because a compiled
 * function answers `NaN` for some functions of a complex argument (`Gamma`).
 */
function numericLimitValue(
  engine: ComputeEngine,
  f: Expression,
  x: Expression,
  dir: Expression | undefined
): Expression | undefined {
  let target = x.N().re;
  if (Number.isNaN(target)) return undefined;
  const direction = dir ? dir.re : 1;

  // The extrapolation reaches an infinite point through positive arguments
  // only. A limit at `−∞` is the limit of `t ↦ f(−t)` at `+∞`.
  const mirrored = target === -Infinity;
  if (mirrored) target = Infinity;
  const at = (t: number): number => (mirrored ? -t : t);

  if (!hasNonRealConstant(f)) {
    // The iteration budget keeps a single sample on the extrapolation
    // ladder interruptible: an unbudgeted compiled Sum/Product with a
    // variable-dependent bound runs an arbitrarily long loop that no
    // deadline check can reach (see LIMIT_PROBE_ITERATION_BUDGET).
    const compiled = implicitCompile(engine, f, {
      iterationBudget: LIMIT_PROBE_ITERATION_BUDGET,
    });
    const fn = (compiled?.run as (x: number) => number) ?? applicableN1(f);
    // A numeric limit is a float, even when its value is an integer
    return engine.number(
      engine._inexactNumericValue(
        limit((t) => fn(at(t)), target, direction, engine._deadline) + 0
      )
    );
  }

  // Each sample is evaluated once and read twice (real part, imaginary part).
  const apply = applicable(f);
  const samples = new Map<number, [re: number, im: number]>();
  const sample = (t: number): [re: number, im: number] => {
    let v = samples.get(t);
    if (v === undefined) {
      const y = apply([engine.number(at(t))])?.N();
      v = y === undefined || !isNumber(y) ? [NaN, NaN] : [y.re, y.im];
      samples.set(t, v);
    }
    return v;
  };
  const re = limit((t) => sample(t)[0], target, direction, engine._deadline);
  const im = Number.isNaN(re)
    ? NaN
    : limit((t) => sample(t)[1], target, direction, engine._deadline);
  if (Number.isNaN(re) || Number.isNaN(im)) return engine.NaN;
  // A numeric limit is a float, even when both parts are integers.
  return engine.number(
    engine._inexactNumericValue(im === 0 ? re + 0 : { re, im })
  );
}

export const CALCULUS_LIBRARY: SymbolDefinitions[] = [
  {
    /* @todo
    ## Definite Integral
`\int f dx` -> ["Integrate", "f", "x"]

`\int\int f dxdy` -> ["Integrate", "f", "x", "y"]

Note: `["Integrate", ["Integrate", "f" , "x"], "y"]` is equivalent to
`["Integrate", "f" , "x", "y"]`


`\int_{a}^{b} f dx` -> ["Integrate", f, [x, a, b]]
`\int_{c}^{d} \int_{a}^{b} f dxdy` -> ["Integrate", "f", ["Triple", "x", "a",
"b"], ["Triple", "y", "c", "d"]]

`\int_{a}^{b}\frac{dx}{f}` -> ["Integrate", ["Power", "f", -1], ["Triple", "x",
"a", "b"]]

`\int_{a}^{b}dx f` -> ["Integrate", "f", ["Triple", "x", "a", "b"]]

If `[a, b]` are numeric, numeric methods are used to approximate the integral.

## Domain Integral

`\int_{x\in D}` -> ["Integrate", f, ["In", x, D]]

### Contour Integral

`\oint f dx` -> `["ContourIntegral", "f", "x"]`

`\varointclockwise f dx` -> `["ClockwiseContourIntegral", "f", "x"]`

`\ointctrclockwise f dx` -> `["CounterclockwiseContourIntegral", "f", "x"]`

`\oiint f ds` -> `["DoubleCountourIntegral", "f", "s"]` : integral over closed
surfaces

`\oiiint` f dv -> `["TripleCountourIntegral", "f", "v"]` : integral over closed
volumes

`\intclockwise`

`\intctrclockwise`

`\iint`

`\iiint`
*/

    // @todo: review the following
    // - https://index.scala-lang.org/cascala/galileo
    // - https://symbolics.juliasymbolics.org/stable/
    // - https://github.com/symengine/SymEngine.jl

    //
    // Functions
    //

    //
    // **Derivative**
    //
    // Returns a function that represents the derivative of the
    // given function.
    //
    // In contrast to the `D` function, the `Derivative` function
    // returns a function that represents the derivative of the given
    // function, rather than the result of evaluating the derivative
    // at a given point.

    // `['Derivative', f]` < = > `["D", ["Apply", f, "x"], "x"]`
    //
    //
    // ["Derivative", "Sin"]
    //    -> "Cos"
    //
    // ["Derivative", ["Function", ["Square", "x"], "x"], 2]
    //    -> "2"
    //
    // The argument "2" of the `Derivative` function indicates the order
    // of the derivative.
    //
    //
    // @todo: consider Fractional Calculus, i.e. Louiville-Riemann derivative
    // https://en.wikipedia.org/wiki/Fractional_calculus
    // with values of the order that can be either fractional or negative
    //
    Derivative: {
      description: 'Derivative operator that returns a derivative function.',
      keywords: ['differentiate'],
      broadcastable: false,

      lazy: true,
      // The order argument is a multi-index: one differentiation order per
      // argument of the function. A single order is the ordinary (univariate)
      // n-th derivative; `Derivative(f, 1, 0)` is ∂f/∂arg₁ of a bivariate f.
      signature: '(function, order:number*) -> function',
      type: ([fn], { engine }) => {
        // A derivative function has the same signature as the function it
        // derives (same parameters and codomain). Preserving it lets an
        // application — `Apply(Derivative(f, 1), x)`, the parse of `f'(x)` —
        // type as the function's return type instead of `any`.
        const t = fn?.type;
        const result = t !== undefined ? functionResult(t) : undefined;
        if (result !== undefined && result !== 'any' && result !== 'unknown')
          return BoxedType.forResult(engine.type(t!), engine._typeResolver);
        // The DECLARED type is uninformative, but the symbol may nevertheless
        // hold a function literal whose codomain is known: a head declared as
        // a bare `function` and only then assigned `(t) ↦ (cos t, sin 2t, t)`
        // keeps the declared `function` as its contract, so the branch above
        // sees `unknown` while the assigned lambda types
        // `(unknown) -> tuple<…>`. Reading the value's own type here is what
        // stops the fallback below from committing a SCALAR result the
        // evaluation then contradicts — `f'(0.25)` typed `number` while `.N()`
        // returned a 3-tuple, and every type-strict consumer (`Cross`, `Dot`)
        // rejected the call with `incompatible-type` (Tycho item 210).
        const valueType =
          fn !== undefined ? heldValueTypeOf(fn, engine) : undefined;
        if (
          valueType !== undefined &&
          typeof valueType !== 'string' &&
          valueType.kind === 'signature'
        ) {
          const valueResult = functionResult(valueType);
          if (
            valueResult !== undefined &&
            valueResult !== 'any' &&
            valueResult !== 'unknown'
          )
            return BoxedType.forResult(
              engine.type(valueType),
              engine._typeResolver
            );
        }
        // Neither the declaration nor a held value says what the function
        // returns (e.g. a symbol declared plain `function` and never
        // assigned, whose type is `(any*) -> any`). Its derivative is still
        // scalar-valued in the overwhelmingly common case, so report a
        // number-valued function — the same compromise as the `D` type
        // handler below — rather than passing the `any` through, which would
        // type applications as `any`.
        return BoxedType.forResult(
          engine.type('(any*) -> number'),
          engine._typeResolver
        );
      },
      canonical: (ops, { engine }) => {
        // The function operand is required: a missing one is the standard
        // `Error("missing")` operand, as `checkArity` pads it, not a crash.
        if (ops.length === 0)
          return engine._fn('Derivative', [engine.error('missing')]);
        const fn = canonicalFunctionLiteral(ops[0].canonical);
        if (!fn) return null;
        // A bare symbol here is being used as a function (e.g. `y` in
        // `Apply(Derivative(y, 2), x)` from parsing `y''(x)`): infer its type
        // so later uses in the same expression — like the `y(x)` term of an
        // ODE, parsed as an invisible product while `y` was still unknown —
        // canonicalize to a function application, exactly as an
        // operator-position use (`["y", "x"]`) would have inferred it.
        if (isSymbol(fn)) fn._infer(() => 'function');
        const orders = ops.slice(1).map((o) => {
          const order = o.canonical;
          // A symbolic order — `f^{(n)}`, documented as `Derivative(f, n)` —
          // is a free variable used as a number: infer it, as the function
          // symbol above is inferred, instead of rejecting its still-`unknown`
          // type with `incompatible-type`.
          // Fact-blind: the guard reads the order's EFFECTIVE type, and an
          // assumption that gives it a tier must not decide whether this
          // narrowing — a contract that outlives the assumption — is stored.
          engine._withoutFacts(() => {
            if (isSymbol(order) && order.type.isUnknown)
              order._infer(() => 'number');
          });
          return checkType(engine, order, 'number');
        });
        return engine._fn('Derivative', [fn, ...orders]);
      },
      evaluate: (ops, { engine: ce }) => {
        const op = ops[0].evaluate();
        let orders = ops.slice(1).map((o) => o.N().re);
        // An order that is not a number yet (`Derivative(f, n)` with `n`
        // unassigned) has no closed form: stay inert. Reading it as 1 silently
        // made `f^{(n)}` the FIRST derivative.
        // A negative or fractional order is not an order of differentiation
        // (fractional calculus and antiderivatives are not implemented), so
        // the node stays inert too, as `D(f, {x, n})` does for such an `n`.
        // Rounding the order down gave a derivative of the wrong order:
        // `Derivative(Power, -1, 1)` was read as `Derivative(Power, 0, 1)`
        // and `Derivative(g, 1.5)` as `Derivative(g, 1)`.
        if (orders.some((n) => !Number.isInteger(n) || n < 0)) return undefined;
        // Each unit of order is one differentiation pass, and each pass keeps
        // its result (the iterates of `derivative()`, the nested `D` tree of
        // the multi-index arm). The work and the memory thus scale with the
        // VALUE of the orders: `Derivative(Power, 1000000000, 0)` used up the
        // heap before any deadline check ran. Above the cap that
        // `D(f, {x, n})` also uses, the node stays inert.
        if (orders.reduce((sum, n) => sum + n, 0) > MAX_DERIVATIVE_ORDER)
          return undefined;

        // The number of orders must agree with the number of parameters of
        // the function: the parameters of the function literal that `op` is,
        // or that it is bound to, or else the fixed number of arguments of
        // the signature of the operator `op` names (an operator with optional
        // or variadic arguments, such as `Log` or `Add`, has no fixed number
        // and is not checked). More orders than parameters name no partial
        // derivative: the node stays inert. Before, the operator branch below
        // applied the function to one fresh symbol for each order and the
        // application threw ("Too many arguments") for
        // `Derivative(h, 1, 0, 0)` with `h(x, y)`.
        //
        // Fewer orders than parameters are padded with order 0, the same
        // convention that `differentiate()` uses for
        // `Apply(Derivative(f, α), …)`: `g'(x, y)` parses to
        // `Apply(Derivative(g, 1), x, y)`, the partial in the first
        // argument. A bare `Derivative(g)` is order 1 in the first argument.
        // For a symbol bound to a literal of several parameters, the
        // univariate arm applied the symbol to one hole and gave a wrong
        // closed form: `(x) => x^2` for `h(x, y) := x^2 y`. For an operator
        // of several arguments (`Arctan2`, `Power`, an operator with a
        // `derivative` key for each of two parameters), the univariate arm
        // has no derivative and the node stayed inert, while
        // `Derivative(Arctan2, 1, 0)` evaluated. An inline literal with one
        // order already differentiates in its first parameter in the
        // univariate arm, so it is not padded.
        const keyed =
          isSymbol(op) && op.operatorDefinition?.derivative !== undefined;
        const literal = isSymbol(op) ? functionLiteralOf(ce, op.symbol) : op;
        let arity: number | undefined;
        if (isFunction(literal, 'Function')) arity = literal.nops - 1;
        else if (isSymbol(op)) {
          const sig = op.operatorDefinition?.signature.type;
          if (
            sig !== undefined &&
            typeof sig !== 'string' &&
            sig.kind === 'signature' &&
            sig.optArgs === undefined &&
            sig.variadicArg === undefined
          )
            arity = sig.args?.length ?? 0;
        }
        if (arity !== undefined && orders.length > arity) return undefined;
        // Differentiating zero times in every position is the function
        // itself — univariate `Derivative(g, 0)` and multi-index
        // `Derivative(g, 0, 0)` alike. Left to the lifting below, a head that
        // is not already a `Function` literal (a bare symbol, or an
        // operator-defined name such as `Sin`) came back as the constant
        // function returning that head (`Derivative(g, 0)` → `(x) ↦ g`): the
        // order-0 "derivative" is the head itself, which the univariate arm
        // then re-parameterized over its value's parameters. This check
        // comes after the arity check above: `Derivative(Sin, 0, 0)` has
        // more orders than `Sin` has arguments and stays inert, it is not
        // `Sin`.
        if (orders.length >= 1 && orders.every((n) => n === 0)) return op;
        let padded = false;
        if (
          arity !== undefined &&
          arity >= 2 &&
          orders.length < arity &&
          (orders.length >= 2 || isSymbol(op))
        ) {
          const given = orders.length === 0 ? [1] : orders;
          orders = [...given, ...new Array(arity - given.length).fill(0)];
          padded = true;
        }

        // Univariate (bare or single order): ordinary n-th derivative.
        //
        // The closed-form result is lifted into a *named-parameter* `Function`
        // literal (P1-19c): a bare hole-form (`cos(_)`) typed `number`,
        // so a stored `let g = Derivative(f)` was not callable. The historical
        // blockers are addressed by construction:
        // - a result that holds a `Derivative` of the same function stays
        //   inert — as a literal, its body would evaluate this node again at
        //   each application. A result that holds the `Derivative` of
        //   another function is lifted like any other closed form;
        // - the hole is renamed to a real parameter, so no `_` reaches the
        //   serializers (the `()\mapsto…` mis-rendering) or the
        //   `denotesFunction` wildcard gate.
        //
        // The whole arm is memoized: lifting the closed form into a literal
        // declares its parameter, and that declaration makes the cache of
        // `derivative()` miss on the next request (see
        // `memoizedDerivativeResult`).
        //
        // The hole `_` that `derivative()` applies an operator symbol to, and
        // the parameter that replaces it, are declared in a scope that is
        // discarded afterwards. Without that scope, `derivative()` and
        // `ce.symbol()` declared them in the caller's scope, with the type
        // that the operator inferred (`number` for the argument of `Sin`).
        // That type then applied to every later use of `x` and `_`: after
        // `Derivative(Sin)` was evaluated, `x && True` was an error.
        if (orders.length <= 1) {
          const order = orders[0] ?? 1;
          return memoizedDerivativeResult(op, order, () => {
            ce.pushScope();
            let r: Expression | undefined;
            try {
              ce.declare('_', 'unknown');
              r = derivative(op, order);
            } finally {
              ce.popScope();
            }
            if (r === undefined) return undefined;
            // Order 0 (or an already-lifted result) is the function itself.
            if (isFunction(r, 'Function')) return r;
            // An INCOMPLETE closed form — a `D` the symbolic differentiator
            // could not resolve is left inside the body, such as the
            // derivative of the norm of a point-valued function inside the
            // quotient rule for `t ↦ f'(t)/|f'(t)|` — is no closed form: the
            // node stays inert, so an application of it stays an `Apply` and
            // `N()` answers it through the stencil fallback
            // (`numericDerivativeOfApply`), as the compiled JavaScript target
            // already does for the same application. Returned bare or lifted
            // into a function literal instead, the residue reached every
            // consumer as a symbolic `D(…)` that no route could numericize.
            // (Checked before the `Derivative`-carrying case below: such a
            // body may hold a legitimate `Apply(Derivative(f, 2), t)` beside
            // the unresolved `D`.)
            if (holdsUnresolvedD(r)) return undefined;
            if (r.operator === 'Derivative') return r;
            // A closed form that holds a `Derivative` of the function itself
            // (`Apply(Derivative(f, 1), _)` for a recursive `f`) stays
            // inert. As a function literal, its body would evaluate this
            // node again at each application, without end.
            if (
              r
                .getSubexpressions('Derivative')
                .some((d) => isFunction(d) && d.op1.isSame(op))
            )
              return undefined;
            // A closed form that holds the `Derivative` of another function
            // (`x·g′(x) + g(x)` for `h(x) := x·g(x)` with `g` not defined) is
            // made a function literal below, as a complete closed form is.
            // Its body evaluates that other `Derivative` when the literal is
            // applied.

            // A named-parameter function literal: the derivative was taken with
            // respect to its own (first) parameter, so the body is already in
            // terms of the named parameters — preserve the signature.
            if (isFunction(op, 'Function')) {
              const params = op.ops.slice(1);
              if (
                params.length > 0 &&
                params.every((p) => functionLiteralParameterName(p) !== '')
              )
                // `ce.function()` (not `_fn`): the canonical handler wraps the
                // body in the scoped Block that `makeLambda` requires.
                return ce.function('Function', [r, ...params]);
            }

            // Otherwise the body is in terms of the hole `_` (an operator
            // symbol such as `Sin`): rename the hole to a fresh parameter that
            // collides with no free variable or binder name of the body.
            let name = 'x';
            if (r.has(name) || collectBinderNames(r).has(name)) {
              let i = 1;
              while (r.has(`x_${i}`) || collectBinderNames(r).has(`x_${i}`))
                i += 1;
              name = `x_${i}`;
            }
            return functionLiteralOverHoles(ce, r, ['_'], [name]);
          });
        }

        // Multi-index: mixed partial of a multivariate function. For a known
        // function literal, differentiate the body the requested number of
        // times with respect to each parameter; otherwise stay symbolic.
        // A symbol bound to a function literal is differentiated through
        // that literal, as the univariate arm does inside `derivative()`;
        // the literal is what carries the named parameters the multi-index
        // refers to. Without this, `Derivative(g, 1, 0)` stayed inert for an
        // assigned bivariate `g` while `Derivative(g, 1)` evaluated.
        // An operator whose definition has a `derivative` key is handled by
        // the next block: the key has precedence over its function literal.
        // The arm is memoized per function and order vector, as the
        // univariate arm is (see `memoizedPartialDerivative`).
        const partial = memoizedPartialDerivative(
          op,
          keyed ? undefined : literal,
          orders,
          () => {
            if (!keyed && isFunction(literal, 'Function')) {
              const params = literal.ops
                .slice(1)
                .map((p) => functionLiteralParameterName(p));
              if (params.length === orders.length && params.every((p) => !!p)) {
                let body: Expression | undefined = literal.op1;
                for (let i = 0; i < orders.length && body; i++)
                  for (let d = 0; d < orders[i] && body; d++)
                    body = differentiate(body, params[i]!);
                // A body that holds a `D` the symbolic differentiator could
                // not resolve (the partial of `Round(x, y)` in `y`) is no
                // closed form: the node stays inert, as in the univariate arm
                // and the operator branch below. Made a function literal, the
                // `D` kept its variable free: an application substituted the
                // other arguments and lost the one of the differentiation
                // variable (`D(Round(1.5, y), y)` for the arguments 1.5, 2).
                if (body && holdsUnresolvedD(body)) return undefined;
                // `ce.function()` (not `_fn`): the canonical handler wraps the
                // body in the scoped Block that `makeLambda` requires — a bare
                // `_fn` literal throws on application.
                if (body)
                  return ce.function('Function', [
                    body,
                    ...literal.ops.slice(1),
                  ]);
              }
            }

            // Any other operator: a library operator (`Log`, `Power`, `Mod`,
            // `Arctan2`, …), or an operator whose definition has a `derivative`
            // key (see `OperatorDerivative`, types-definitions.ts). Apply the
            // operator to one fresh symbol for each argument, differentiate the
            // application with `D` (which uses the rules of `differentiate()` for
            // the library operators, and the key when there is one) the requested
            // number of times in each symbol, then make the result a function
            // literal of fresh parameters. This is the n-argument form of the
            // univariate arm above, which differentiates the application `f(_)`.
            //
            // When a partial derivative does not close (the result still holds a
            // `Derivative`, such as the derivative of `BesselJ` in its order, or
            // an unresolved `D`), or the operator does not take this number of
            // arguments, the node stays inert. A lazy operator holds its operands
            // (they are conditions, bodies or bound indexes, not arguments), so
            // it has no partial derivatives and stays inert too. `Add` and
            // `Multiply` are the exceptions: they are lazy only so that they
            // canonicalize their own operands, which are ordinary values, and
            // `differentiate()` has the sum and product rules for them.
            //
            // The fresh symbols are declared in scopes that are discarded
            // afterwards: the scope of each `D`, and the scope pushed below.
            // Without these scopes, they were declared in the caller's
            // scope, with the type that the first operator applied to them
            // inferred (`real` for the arguments of `Arctan2`). That type then
            // applied to every later use of these names.
            const opDef = isSymbol(op) ? op.operatorDefinition : undefined;
            if (
              isSymbol(op) &&
              opDef !== undefined &&
              (!opDef.lazy ||
                op.symbol === 'Add' ||
                op.symbol === 'Multiply') &&
              orders.reduce((sum, n) => sum + n, 0) <= MAX_NESTED_PARTIAL_ORDER
            ) {
              const names = orders.map((_, i) => `_${i + 1}`);
              let body: Expression | undefined;
              // The partial derivative is computed as the nested `D` expression
              // `D(…D(D(f(_1, …, _n), _1), _1)…, _n)`, one `D` for each
              // differentiation, the first symbol innermost. It is boxed from
              // MathJSON, so each `D` declares its variable in its own scope, and
              // the free symbols of the inner application refer to those
              // declarations. The result is then the same as for the nested `D`
              // that a user writes, and the cost is the same too. Each `D`
              // evaluates its result before the next `D` differentiates it.
              //
              // A chain of `differentiate()` calls on symbols declared in the
              // scope below gives the same closed form at about 2 to 2.5 times
              // the cost (`Derivative(Arctan2, 3, 3)`): the
              // time went to deriving the types of the new intermediate
              // expressions (union-type reductions and subtype tests), not to the
              // differentiation rules.
              let nested: MathJsonExpression = [op.symbol, ...names];
              for (let i = 0; i < orders.length; i++)
                for (let d = 0; d < orders[i]; d++)
                  nested = ['D', nested, names[i]];
              ce.pushScope();
              try {
                const node = ce.box(nested);
                if (node.isValid) body = node.evaluate();
              } finally {
                ce.popScope();
              }
              if (
                body &&
                body.isValid &&
                !holdsUnresolvedD(body) &&
                !body.has('Derivative')
              ) {
                const binders = collectBinderNames(body);
                const used = (name: string) =>
                  body!.has(name) || binders.has(name);
                const params: string[] = [];
                let k = 1;
                for (let i = 0; i < names.length; i++) {
                  while (used(`x_${k}`)) k += 1;
                  params.push(`x_${k}`);
                  k += 1;
                }
                const literal = functionLiteralOverHoles(
                  ce,
                  body,
                  names,
                  params
                );
                if (literal !== undefined) return literal;
              }
            }
            return undefined;
          }
        );
        if (partial !== undefined) return partial;

        // A padded order vector is not written back: the node stays as given.
        if (padded) return undefined;
        return ce._fn('Derivative', [op, ...orders.map((n) => ce.number(n))]);
      },
      compile: (args, compile, context) =>
        compileDerivative('Derivative', args, compile, context),
    },

    //
    // **D: Partial derivative**
    //
    // Returns the partial derivative of a function with respect to a
    // variable.
    //
    // ["D", "Sin", "x"]
    //    -> ["Cos", "x"]
    //
    // This is equivalent to `["Apply", ["Derivative", "Sin"], "x"]`

    D: {
      description:
        'Symbolic partial derivative with respect to one or more variables.',
      keywords: ['differentiate'],
      broadcastable: false,

      // The differentiation variables are operands 1..n. They used to be bound
      // wherever the CALLER had them — this operator's scope was minted and
      // never populated — so the parse route (raw) and the `ce.function` route
      // (the caller's binding) disagreed about the same derivative. The
      // `withValueShield` at evaluate is unaffected and stays (stage 14).
      scoped: operandsFrom(1),
      lazy: true,
      signature: '(expression, variables:symbol*) -> expression',
      type: ([body], { engine }) => {
        if (!body) return undefined;
        const t = body.type;
        // The derivative of a numeric expression is numeric — preserve the
        // concrete numeric type (e.g. `number` for `D(Sin(x),x)`).
        if (isSubtype(t, 'number'))
          return BoxedType.forResult(t, engine._typeResolver);
        // A numeric TUPLE or COLLECTION body differentiates component-wise and
        // the result keeps that shape: `D((cos t, sin 2t, t), t)` evaluates to
        // `(-sin t, 2cos 2t, 1)`, and `D([cos t, sin t], t)` to a list. The
        // scalar fallback below claimed `number` for both, so the declared
        // type contradicted the value the same handler produced, and a
        // type-strict consumer (`Cross`, `Dot`) rejected the derivative of a
        // parametric curve outright (Tycho item 210). Echoing the body's type
        // follows the same tier convention as the numeric branch above.
        if (typeCouldBeNumericTuple(t) || typeCouldBeNumericCollection(t))
          return BoxedType.forResult(t, engine._typeResolver);
        // A derivative is otherwise scalar-valued: report `number` rather than
        // the signature's `expression`. This covers the derivative of an
        // application of an undeclared function (`y(x)` has type `any`), a
        // nested `D` (`D(D(y(x),x),x)` has type `expression`), and a function
        // literal with an unknown codomain (`\dot{x}` → `D((t)↦x, t)`, type
        // `(unknown) -> unknown`). Without this, such a `D(…)` term inside
        // `Add`/`Multiply` is rejected and rewritten to an `Error` node,
        // corrupting parsed input like `y''(x) + y(x) = 0` before `DSolve`
        // ever runs — and leaving inconsistent trees (a bare application
        // `y(x)` already reports `any` and composes fine there).
        return BoxedType.forResult(engine.type('number'), engine._typeResolver);
      },
      canonical: (ops, { engine: ce, scope }) => {
        // Guard against a malformed `D` with no operand. This can arise when
        // upstream parsing drops the argument (e.g. `D\left[1\right]` from a
        // Desmos list-index expression collapses to `["D"]`). Without an
        // expression to differentiate there is nothing to canonicalize;
        // return null so the caller produces a non-canonical fallback rather
        // than throwing a `Cannot read properties of undefined` error on
        // `ops[0].canonical` below.
        if (!ops[0]) return null;

        // Mathematica-style higher-order spec: `D(f, {x, n})` → the n-th
        // derivative with respect to `x` (`D(f, x, x, …, x)`, n repetitions).
        // POSITIONAL — only a raw held `{symbol, positive-integer}` pair in the
        // variable slot is expanded; any other `Set` shape is left untouched.
        if (ops.length > 1 && ops.slice(1).some((o) => isFunction(o, 'Set'))) {
          const expanded: Expression[] = [ops[0]];
          for (const o of ops.slice(1)) {
            if (isFunction(o, 'Set') && o.nops === 2 && isSymbol(o.op1)) {
              const n = o.op2.canonical.re;
              // The expansion, and the differentiation it asks for, scale
              // with the VALUE of `n`; past the cap the pair is left as it
              // is, so the derivative stays inert rather than unbounded.
              if (
                n !== undefined &&
                Number.isInteger(n) &&
                n >= 1 &&
                n <= MAX_DERIVATIVE_ORDER
              ) {
                for (let k = 0; k < n; k++) expanded.push(o.op1);
                continue;
              }
            }
            expanded.push(o);
          }
          ops = expanded;
        }

        // The differentiation variable may be omitted (`D(expr)`, e.g. from
        // `expr |> D`): default to the expression's single free variable, or
        // to `x` when there are several and one of them is `x`. A function
        // symbol (`D(f)`) is excluded — it is handled by the function-symbol
        // branch below, and must not have the inferred variable fed into its
        // argument list.
        if (
          ops.length === 1 &&
          !(isSymbol(ops[0]) && ops[0].canonical.operatorDefinition)
        ) {
          const v = defaultUnknown(ops[0]);
          if (v !== undefined) ops = [ops[0], ce.symbol(v)];
        }

        // If the first argument is a function symbol (e.g., f where f(x):=2x),
        // apply it to the differentiation variables to produce a function call.
        // e.g., ['D', 'f', 'x'] → ['D', ['f', 'x'], 'x']
        if (isSymbol(ops[0]) && ops[0].canonical.operatorDefinition) {
          const vars = ops.slice(1);
          const fCall = ce.function(ops[0].symbol, vars);
          return ce._fn('D', [fCall, ...vars], { scope });
        }

        // If the first argument is already a function call (e.g., f'(x)
        // parsed as ['D', ['f', 'x'], 'x']), use it directly rather than
        // wrapping in Function(Block(...)).
        const op0 = ops[0].canonical;
        if (isFunction(op0) && op0.operator) {
          return ce._fn('D', [op0, ...ops.slice(1)], { scope });
        }

        const f = canonicalFunctionLiteralArguments(ce, ops);
        if (!f) return null;

        return ce._fn('D', [f, ...ops!.slice(1)], { scope });
      },
      evaluate: (ops, { engine: ce }) => {
        // Guard against a malformed `D` with no operand (see the canonical
        // handler above): there is nothing to differentiate, so leave it
        // unevaluated rather than crashing on `ops[0].canonical`.
        if (!ops[0]) return undefined;

        // A function that holds a residue class is not differentiated: a
        // class is not a real number, and the rules of differentiation do
        // not apply to it. The derivative stays unevaluated.
        if (containsResidueClass(ops[0].canonical)) return undefined;

        // The differentiation variable(s) are bound by `D`: a same-named global
        // assignment (`x := 5`) must not substitute into the result. Shield
        // them across the whole evaluation — the final `.evaluate()` of the
        // symbolic derivative would otherwise resolve the variable's value
        // (`D(x², x)` → `2x`, then `10`). Other free symbols still resolve
        // normally: with `a := 3`, `D(a·x², x)` → `6x`.
        const diffVars: string[] = [];
        for (const p of ops.slice(1)) {
          const n = sym(p);
          if (n) diffVars.push(n);
        }

        const result = withValueShield(ce, diffVars, () => {
          let f: Expression | undefined = ops[0].canonical;

          // Unwrap Function literals to get the body for differentiation.
          // For non-Function expressions (e.g., ['f', 'x']), do NOT call
          // .evaluate() before differentiating — that would prematurely
          // substitute variable values (e.g., x=5) and lose structural info.
          if (isFunction(f, 'Function')) {
            f = f.op1;
          }

          const params = ops.slice(1);
          if (params.length === 0) f = undefined;
          for (const param of params) {
            const paramSym = sym(param);
            if (!paramSym) {
              f = undefined;
              break;
            }
            f = differentiate(f!, paramSym);
            if (f === undefined) break;
          }
          f = f?.canonical;
          // Avoid recursive evaluation
          if (f?.operator === 'D') return f;
          // Avoid evaluating symbolic derivative applications like Digamma'(x)
          // which would incorrectly evaluate to 0
          if (
            f?.operator === 'Apply' &&
            isFunction(f) &&
            f.op1?.operator === 'Derivative'
          )
            return f;
          // Fold the raw rule output: a plain `evaluate()`, except that a
          // result carrying symbolic transcendentals (like `ln(2)`) is
          // returned as it stands to preserve the symbolic form, and a
          // piecewise result is folded arm by arm.
          return f === undefined ? undefined : foldDerivativeResult(f);
        });

        // A derivative is an OPEN expression in the differentiation variable,
        // which this node now binds in its own scope (`scoped: operandsFrom(1)`).
        // Without this, `d/dx sin(x)` leaves the frame still referencing the
        // dying binding and compares unequal to a separately parsed `-sin(x)` —
        // the repair `Series` (stage 1) and `Integrate` (stage 5) both needed.
        return result === undefined
          ? undefined
          : rebindEscapingCurrentScope(ce, result);
      },
      compile: (args, compile, context) =>
        compileDerivative('D', args, compile, context),
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      description: 'Numerical derivative evaluated at a point.',
      broadcastable: false,
      lazy: true,
      signature: '(function, at:number) -> number | tuple | list<number>',
      // The value has the kind of the function's value: a number for a
      // scalar function, a point for a point-valued one (a space curve),
      // a list for a list-valued one. `number` when the literal's result
      // type says nothing, the overwhelmingly common case.
      type: ([fn], { engine }) => {
        const informative = (t: Type | undefined): Type | undefined =>
          t === undefined || t === 'any' || t === 'unknown' ? undefined : t;
        // The declared signature first; then, as the `Derivative` type
        // handler does, the literal a symbol declared plain `function`
        // holds, whose codomain is known where the declaration's is not.
        let result =
          fn !== undefined ? informative(functionResult(fn.type)) : undefined;
        if (result === undefined && fn !== undefined) {
          const held = heldValueTypeOf(fn, engine);
          if (held !== undefined) result = informative(functionResult(held));
        }
        const type =
          result !== undefined && derivativeValueShape(result) === 'vector'
            ? result
            : 'number';
        return BoxedType.forResult(engine.type(type), engine._typeResolver);
      },
      canonical: (ops, { engine }) => {
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        const x = checkType(engine, ops[1]?.canonical, 'number');
        return engine._fn('ND', [fn, x]);
      },
      evaluate: ([body, x], { engine }) => {
        // The same stencil as `Apply(Derivative(f), x).N()` and as the
        // compiled `_SYS.nd`, component by component for a point- or
        // list-valued function (`stencilDerivativeAt`).
        const xValue = x.N().re;
        if (isNaN(xValue)) return undefined;
        // A function NAME is resolved to the literal it is bound to, so the
        // stencil runs the compiled literal — the same code the compiled
        // JavaScript route runs — rather than an interpreted application.
        const lit = resolveDerivativeFunctionLiteral(body) ?? body;
        return stencilDerivativeAt(engine, lit, xValue, 1);
      },
      compile: (args, compile, context) =>
        compileDerivative('ND', args, compile, context),
    },

    JacobianMatrix: {
      description: [
        'JacobianMatrix(fs, vars): the matrix of partial derivatives',
        '∂fᵢ/∂xⱼ, one row per function and one column per variable.',
        '`fs` is a list of expressions. A single (non-list) expression is the',
        'gradient case: the result is the flat vector [∂f/∂x₁, …, ∂f/∂xₙ].',
        '`vars` is a list of symbols and may be omitted, in which case the',
        'free variables of `fs` are used, in lexicographic order.',
        'Example: JacobianMatrix([x^2 y, x + z], [x, y, z]).',
      ],
      keywords: ['jacobian', 'gradient', 'derivative', 'partial derivative'],
      broadcastable: false,

      // Hold the operands. The variable list must NOT be evaluated: a symbol
      // carrying a value (`x := 5`) would be replaced by that value, leaving
      // nothing to differentiate with respect to. Held operands arrive
      // unbound, so each is canonicalized below before use.
      lazy: true,
      signature: '(any, any?) -> value',

      // A system of functions yields a matrix; a single function yields the
      // gradient vector. Reported from the operand's *shape*, which is
      // available before evaluation; the element type is left to the value.
      //
      // "System or gradient?" is a question about what the operand DENOTES,
      // not about its syntax: a user function `F` that returns a list is a
      // system, so `Determinant(JacobianMatrix(F(x, y, z)))` must type-check.
      // The expressions-shape handler answered it by canonicalizing the
      // operand and reducing it to a `List`, which a type derivation may not
      // do — canonicalizing writes engine state. The two channels below
      // answer the same question without it: a literal list, or a function
      // literal whose body is one, is a system by STRUCTURE; otherwise the
      // type of what the operand denotes decides — a list makes it a system,
      // a scalar number the gradient case. What neither decides keeps the
      // declared `value`, where the old handler guessed `vector`.
      type: ([fs], context) => {
        if (!fs) return undefined;
        const structure = fs.structureOf?.();
        if (
          structure?.kind === 'list-literal' ||
          (structure?.kind === 'function-literal' &&
            structure.body.kind === 'list-literal')
        )
          return BoxedType.forResult('matrix', context.engine._typeResolver);
        const denoted = denotedTypeOf(fs, context);
        if (isSubtype(denoted, JACOBIAN_LIST_SHAPE_TYPE))
          return BoxedType.forResult('matrix', context.engine._typeResolver);
        if (isSubtype(denoted, 'number'))
          return BoxedType.forResult('vector', context.engine._typeResolver);
        return BoxedType.forResult('value', context.engine._typeResolver);
      },

      evaluate: (ops, { engine: ce }) => {
        let target = ops[0]?.canonical;
        if (target === undefined || !target.isValid) return undefined;

        // `JacobianMatrix(F)` / `JacobianMatrix(F, vars)` — a bare function
        // reference. Its body is the system and its parameters are the default
        // differentiation variables, in declared order. When explicit `vars`
        // are also given, rename: substitute the parameters by the given
        // symbols (an arity mismatch declines).
        const lambda = bareFunctionLambda(target);
        let paramDefault: string[] | undefined;
        if (lambda) {
          target = lambda.body;
          paramDefault = lambda.params;
        } else {
          // `[a, b, c]` — a list of bare function references (each element a
          // named scalar component). Their common parameters are the default
          // differentiation variables, as for a single bare function.
          const system = bareFunctionSystem(target);
          if (system) {
            target = ce._fn('List', system.bodies);
            paramDefault = system.params;
          }
        }

        // "System or gradient?" must be decided on what the operand *denotes*,
        // not on its syntax. `JacobianMatrix(F(x,y,z), …)` for a user-defined
        // `F` returning a list is a system; a purely syntactic `List` check
        // took the gradient path and produced the TRANSPOSE — invisible to a
        // determinant test, since det A = det Aᵀ. A `let`-bound list went
        // inert for the same reason.
        if (!isFunction(target, 'List')) {
          // Resolve to a `List` WITHOUT substituting scalar values — the
          // differentiation variables must survive (see `resolveToList`). A
          // syntactic `List` check alone typed `JacobianMatrix(F(x,y,z), …)`
          // for a list-returning `F` as the TRANSPOSE — invisible to a
          // determinant test, since det A = det Aᵀ.
          const reduced = resolveToList(target);
          if (isFunction(reduced, 'List')) target = reduced;
        }

        // A `List` operand is a system of functions; anything else is a single
        // scalar function (the gradient case).
        const isSystem = isFunction(target, 'List');
        let fs = isFunction(target, 'List') ? [...target.ops] : [target];
        if (fs.length === 0) return undefined;

        // Runtime gate (the static type cannot refute these): every entry must
        // be a scalar expression, not a nested collection.
        if (fs.some((f) => !f.isValid || f.isCollection === true))
          return undefined;

        // Variables: the explicit list; else a bare function's parameters (in
        // declared order); else the free variables of `fs`, lexicographically.
        let names: string[];
        const varsOp = ops[1]?.canonical;
        if (varsOp !== undefined) {
          const items = isFunction(varsOp, 'List') ? varsOp.ops : [varsOp];
          const syms = items.map((v) => sym(v));
          if (syms.some((n) => n === undefined)) return undefined;
          names = syms as string[];
          // Rename a bare function's parameters to the given variables.
          if (paramDefault) {
            if (paramDefault.length !== names.length) return undefined;
            const rename = Object.fromEntries(
              paramDefault.map((p, i) => [p, ce.symbol(names[i])])
            );
            // `subs` is NOT binder-aware: it rewrites through inner
            // `Sum`/`Function`/… binders blindly. Renaming a parameter that an
            // inner binder rebinds — or renaming to a target name that an inner
            // binder already binds (e.g. `x ↦ Sum(x·k, k, 1, 3)` with vars `[k]`,
            // where the substituted `k` would be captured by the `Sum`) — yields
            // a wrong derivative. Decline in that case (leave `JacobianMatrix`
            // symbolic), value-safe and strictly better than corrupting.
            for (const f of fs) {
              const binders = collectBinderNames(f);
              if (binders.size === 0) continue;
              for (let i = 0; i < paramDefault.length; i++)
                if (binders.has(paramDefault[i]) || binders.has(names[i]))
                  return undefined;
            }
            fs = fs.map((f) => f.subs(rename));
          }
        } else if (paramDefault) {
          names = paramDefault;
        } else {
          const free = new Set<string>();
          for (const f of fs) for (const n of f.unknowns) free.add(n);
          // Lexicographic, so the column order is predictable and stable.
          names = [...free].sort();
        }
        if (names.length === 0) return undefined;

        // A differentiation variable that ALSO carries a global value (`x := 5`
        // then differentiate w.r.t. `x`) is a bound variable: evaluating
        // `D(x²y, x)` must differentiate, not substitute `5`. Shield the
        // differentiation variables' values for the whole computation (the
        // shared binder helper), leaving the result symbolic in them.
        const row = (f: Expression): Expression[] =>
          names.map((n) => ce.function('D', [f, ce.symbol(n)]).evaluate());

        return withValueShield(ce, names, () => {
          // Gradient: a flat vector, directly usable as one. A system: a
          // matrix, which `Determinant` accepts when it is square.
          if (!isSystem) return ce.function('List', row(fs[0]));
          return ce.function(
            'List',
            fs.map((f) => ce.function('List', row(f)))
          );
        });
      },
    },

    CircularIntegrate: {
      description:
        'Closed-path integral. Evaluates supported explicit contours by the residue theorem.',
      keywords: ['contour integral', 'closed integral', 'line integral'],
      broadcastable: false,

      lazy: true,
      // The variable of the limits is bound by the integral, as in
      // `Integrate`: it is declared in the integral's own scope, not in the
      // scope of the caller.
      scoped: indexingSetSites(1),
      signature: '(function, limits+) -> number',

      // The integrand is left as the bare application it was parsed as (not
      // wrapped in a `Function` literal the way `Integrate` does), so it
      // round-trips to the same LaTeX. The canonical handler rewrites the
      // limits that `parseIntegral` builds as `Tuple`s into `Limits`
      // expressions, so a limits-consuming caller sees the same shape as
      // `Integrate` (the `Tuple` uses the symbol `Nothing` as a positional
      // placeholder for an absent index or bound). A single lower limit can
      // name a contour (`\oint_{|z|=2}`): the evaluate handler then applies
      // the residue theorem. Any other limits leave the integral inert.
      canonical: (ops, { engine: ce }) => {
        if (!ops[0]) return null;
        const limits = canonicalLimitsSequence(ops.slice(1), { engine: ce });
        return ce._fn('CircularIntegrate', [ops[0].canonical, ...limits]);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (ops.length !== 2 || !isFunction(ops[1], 'Limits')) return undefined;
        const [variable, contour, upper] = ops[1].ops;
        if (
          !isSymbol(variable) ||
          !contour ||
          (upper && sym(upper) !== 'Nothing')
        )
          return undefined;
        // The box route can deliver the integrand as a `Function` literal,
        // the shape that `Integrate` uses: read its body.
        const integrand = liftIntegrand(ops[0]);
        const r = ce.contourIntegrate(integrand, variable.symbol, contour);
        let value =
          r.status === 'pole-on-contour' ? singularPathValue(ce, r) : r.value;
        if (value?.isIndeterminate === true)
          value = noValueContourIntegral(ce, integrand, contour);
        return numericApproximation ? value?.N() : value;
      },
    },

    CircleContour: {
      description:
        'Closed circle: center, positive radius, optional orientation (+1 or -1).',
      signature:
        '(center:complex, radius:real, orientation:integer?) -> expression',
    },
    RealLineContour: {
      description:
        'The real axis from minus infinity to infinity. Pass True to explicitly request a Cauchy principal value.',
      signature: '(principalValue:boolean?) -> expression',
    },
    PolygonContour: {
      description:
        'Simple closed polygon: a list of complex vertices in traversal order, with optional orientation override (+1 or -1).',
      signature: '(vertices:list<complex>, orientation:integer?) -> expression',
    },
    RectangleContour: {
      description:
        'Closed rectangle: lower-left and upper-right complex corners, optional orientation (+1 or -1).',
      signature:
        '(lowerLeft:complex, upperRight:complex, orientation:integer?) -> expression',
    },
    ContourIntegrate: {
      description:
        'Symbolic integral over an explicit closed contour, using the residue theorem.',
      keywords: ['residue theorem', 'contour integral'],
      broadcastable: false,
      lazy: true,
      scoped: operandSites(1),
      signature: '(expression, variable:symbol, contour:expression) -> number',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 3 || !isSymbol(ops[1])) return null;
        return ce._fn(
          'ContourIntegrate',
          ops.map((op) => op.canonical)
        );
      },
      evaluate: ([f, x, contour], { engine: ce, numericApproximation }) => {
        const variable = sym(x);
        if (!variable) return undefined;
        const integrand = liftIntegrand(f);
        const r = ce.contourIntegrate(integrand, variable, contour);
        let value =
          r.status === 'pole-on-contour' ? singularPathValue(ce, r) : r.value;
        if (value?.isIndeterminate === true)
          value = noValueContourIntegral(ce, integrand, contour);
        return numericApproximation ? value?.N() : value;
      },
    },

    Integrate: {
      description: 'Symbolic integral with optional bounds.',
      keywords: [
        'antiderivative',
        'primitive',
        'integral',
        'definite integral',
      ],
      wikidata: 'Q80091',
      broadcastable: false,
      // Its Monte-Carlo fallback samples through a derived sub-stream, so it
      // READS the ambient `WithRandomSeed` frame while consuming none of its
      // indices. Not `drawsRandom` (that would shift every sibling draw), but
      // the pending gate must still keep the frame around an estimate that
      // could not finish — otherwise deferring it converts a seeded estimate
      // to a live one. See `docs/RANDOMNESS-MODEL.md` §6.
      readsRandomFrame: true,

      lazy: true,
      // The integration variable(s) live in the `Limits` operands, which
      // `canonicalLimits` used to pass through untouched — leaving the index
      // raw on the parse route and carrying the CALLER's binding on the
      // `ce.function` route (the `Series` defect, stage 5 of
      // `docs/SCOPING-MODEL.md`). The integrand's
      // own variable stays owned by its `Function` literal.
      scoped: indexingSetSites(1),
      signature:
        '(function, limits+) -> number | list<number> | tuple | list<tuple>',
      // An integral where a lower or upper bound is a LIST
      // (`∫_{-∞}^{G} f(Z) dZ` with `G = [-1, 0, 1]`) is one integral per
      // element, and its value is the list of those integrals. This applies
      // to a single limit and to several limits alike: with several limits,
      // each element of the list gives one complete multiple integral, and
      // when more than one bound is a list, the lists are paired element by
      // element. Both evaluate paths return a `List` for these shapes (the
      // numeric path in `evaluate` below, the symbolic path through
      // `EvaluateAt`). Type it as a list so the type agrees with the value.
      // The lengths of the lists are not known here: when two list bounds
      // have different lengths, `evaluate()` and `N()` give an
      // `incompatible-dimensions` error, although the type is still
      // `list<number>`.
      // An integrand whose value is a list is also one integral per element
      // (`integrateListIntegrand`), so the integral has the shape of the
      // integrand's list type, with number elements. A tuple integrand is
      // integrated coordinate by coordinate, and gives a tuple, or a list of
      // tuples when a bound is a list (`integrateTupleIntegrand`). The
      // signature's `tuple` and `list<tuple>` admit these results.
      type: (ops, { engine }) => {
        // The integrand is a function literal: its result type is the type
        // of the integrand's value.
        const listType = integralTypeOf(functionResult(ops[0]?.type));
        const hasListBound = ops.slice(1).some((op) => {
          const limit = op.structureOf?.();
          return (
            limit?.kind === 'application' &&
            limit.head === 'Limits' &&
            limit.children
              .slice(1)
              .some((bound) => isSubtype(bound.type, 'list<any>'))
          );
        });
        // A tuple integrand with a list bound is one tuple per element of
        // the bound (`integrateTupleIntegrand`). A list integrand pairs its
        // elements with the elements of the bound and keeps its own type.
        if (typeof listType === 'object' && listType.kind === 'tuple')
          return BoxedType.forResult(
            hasListBound ? { kind: 'list', elements: listType } : listType,
            engine._typeResolver
          );
        if (listType !== 'number')
          return BoxedType.forResult(listType, engine._typeResolver);
        return BoxedType.forResult(
          hasListBound ? 'list<number>' : 'number',
          engine._typeResolver
        );
      },
      canonical: (ops, { engine: ce }) => {
        if (!ops[0]) return null;

        const limits = canonicalLimitsSequence(ops.slice(1), { engine: ce });

        // Bind only the integration variable(s) from the limits, not every
        // free symbol of the integrand: a free coefficient (e.g. `a` in
        // `∫ a·sin(x) dx`, or the wrongly-inferred `F` in `∫ (G−F) dt`) must
        // not become an integrand parameter. The (de-duplicated) integration
        // variables are passed to `canonicalFunctionLiteral` as the intended
        // parameter list, so a shorthand integrand's body canonicalizes with
        // exactly those parameters declared. (Deriving the literal by
        // unknowns-inference and swapping its parameter list afterwards left
        // the body's occurrences bound to the discarded inferred parameters
        // — Tycho item 178(a): the parsed `∫_{-x}^{x} cos(x) dn` compared
        // `isSame` false against `ce.box()` of its own `.json`, because the
        // body's `x` stayed bound to a discarded parameter while the bounds'
        // `x` bound the engine's.) An explicit `Function` integrand keeps its
        // user-supplied parameters; a bare-symbol integrand stays bare.
        const seen = new Set<string>();
        const vars: Expression[] = [];
        for (const l of limits) {
          const v = isFunction(l) ? l.op1 : undefined;
          if (
            v &&
            isSymbol(v) &&
            v.symbol !== 'Nothing' &&
            !seen.has(v.symbol)
          ) {
            seen.add(v.symbol);
            vars.push(v);
          }
        }

        // A parenthesized list of several expressions, `\int_0^1 (x, 2x)\,dx`,
        // is a tuple, as the same `(x, 2x)` is outside an integral (and as
        // the summand of `Sum` is). Canonicalize it as such before it becomes
        // the body of the function literal: `canonicalFunctionLiteral` reads
        // a `Delimiter` of several expressions as a `Block` of statements,
        // whose value is the last expression only.
        let integrand = ops[0];
        if (
          isFunction(integrand, 'Delimiter') &&
          isFunction(integrand.op1, 'Sequence') &&
          integrand.op1.nops > 1
        )
          integrand = integrand.canonical;

        const f = canonicalFunctionLiteral(
          integrand,
          vars.length > 0 ? { params: vars } : undefined
        );
        if (!f) return null;

        return ce._fn('Integrate', [f, ...limits]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        // A limit with only one bound (`\int^2 f\,dy`, `\int_0 f\,dy`,
        // `Limits(y, Nothing, 2)`): the integral is neither indefinite nor
        // definite, and no default is chosen for the missing bound. The
        // integral stays unevaluated, under `evaluate()` and `N()` alike.
        // Without this, the symbolic route read the antiderivative at the
        // missing bound as 1 (`\int^2 y^2\,dy` was 7/3).
        for (const l of ops.slice(1)) {
          if (!isFunction(l, 'Limits')) continue;
          if ((sym(l.op2) === 'Nothing') !== (sym(l.op3) === 'Nothing'))
            return undefined;
        }

        // An integrand that is the `NaN` or `Indeterminate` literal: the
        // integral has no value, on the exact and the numeric route alike,
        // with or without bounds. `Integrate` is lazy, so the NaN-policy
        // step of evaluation does not run for it. The answer follows
        // `nanOperandAnswer()`: `Indeterminate` when the integrand is
        // `Indeterminate` and no bound is a float, `NaN` otherwise, and
        // always `NaN` under `N()`.
        // A held integrand can be the raw symbol `NaN`: `.canonical` makes
        // it the number literal (and does not substitute assigned values).
        // The body of a function literal can be a `Block` of one expression.
        let body = (isFunction(ops[0], 'Function') ? ops[0].op1 : ops[0])
          .canonical;
        while (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
        // An integrand that holds a residue class is not integrated: a class
        // is not a real number, and the bounds are real numbers, not
        // elements of its ring (`1/2` is not the class `2⁻¹`). The integral
        // stays unevaluated, under `evaluate()` and `N()` alike.
        if (containsResidueClass(body)) return undefined;
        if (isNumber(body) && body.isNaN === true) {
          if (numericApproximation) return ce.NaN;
          const bounds = ops
            .slice(1)
            .flatMap((l) => (isFunction(l, 'Limits') ? [l.op2, l.op3] : []));
          return nanOperandAnswer(ce, [body, ...bounds]);
        }

        // A list-valued integrand: one integral per element.
        const perElement = integrateListIntegrand(
          ce,
          ops[0],
          ops.slice(1),
          numericApproximation ?? false
        );
        if (perElement !== undefined) return perElement;

        // The integration variable(s) are bound by `Integrate`: a same-named
        // global assignment (`x := 5`) must not substitute into the
        // antiderivative computation or its result. Shield them for the whole
        // symbolic pass so `∫ x² dx` stays `x³/3` (not `125/3`) and
        // `∫₀¹ x² dx` is `1/3` (not `0`). The names come from the limits and,
        // as a fallback, the integrand function-literal's parameters.
        //
        // The numeric route below needs the same shield. Outside a call, a
        // function literal's parameter reads the value of a same-named
        // assigned symbol, so compiling `x ↦ |x| cos x` with `x := 5` saw a
        // positive `x`, dropped the `Abs`, and `∫_{−π}^{π} |x| cos x dx`
        // numericized to `0` instead of `−4`.
        const intVarNames: string[] = [];
        for (const l of ops.slice(1))
          if (isFunction(l)) {
            const v = sym(l.op1);
            if (v && v !== 'Nothing') intVarNames.push(v);
          }
        if (isFunction(ops[0]))
          for (const p of ops[0].ops.slice(1)) {
            const n = sym(p);
            if (n) intVarNames.push(n);
          }

        // Over structurally equal bounds (`∫_a^a`, `∫_1^1`) the integral is
        // zero. This is decided before the numeric route too, which cannot
        // evaluate a symbolic bound and would keep the integral unevaluated.
        // Only the structural test is used here: deciding the sign of
        // `hi − lo` would evaluate each bound once more, and a bound with an
        // effect (`∫_0^{Random()}`) must be evaluated exactly once, by the
        // route that consumes it. The symbolic route below still decides a
        // zero difference for bounds that are equal in value but not in form.
        for (const l of ops.slice(1)) {
          if (!isFunction(l, 'Limits')) continue;
          const [lo, hi] = [l.op2, l.op3];
          if (sym(lo) === 'Nothing' || sym(hi) === 'Nothing') continue;
          if (lo.isSame(hi)) return ce.Zero;
        }

        // A call of a user function that has the name of a library function
        // (`Sin := t ↦ t + 1`): the residue method and the symbolic route
        // below select a function by its name and would integrate the
        // library function. Under `evaluate()`, the integral of the body of
        // the user function is computed instead. When the body cannot
        // replace the call (a name that a local scope of the integrand
        // shadows, a user function that is not a function literal), the
        // integral stays unevaluated. The numeric route compiles the user
        // function and is correct, so under `N()` only the residue method is
        // not used.
        const names = shadowedLibraryNames(ce);
        const shadowedCalls = shadowedCallsIn(ce, ops[0].canonical, names);
        if (shadowedCalls !== 'none' && !numericApproximation) {
          const inlined =
            shadowedCalls === 'call'
              ? inlineShadowedCalls(
                  ce,
                  liftIntegrand(ops[0].canonical),
                  names,
                  intVarNames
                )
              : undefined;
          if (inlined === undefined) return undefined;
          return ce
            .function('Integrate', [inlined, ...ops.slice(1)])
            .evaluate();
        }

        // Use the exact residue result for both `evaluate()` and `.N()`, after
        // the real-line driver has verified the closing arc and all poles.
        if (
          shadowedCalls === 'none' &&
          ops.length === 2 &&
          isFunction(ops[1], 'Limits')
        ) {
          const [x, lo, hi] = ops[1].ops;
          const variable = sym(x);
          if (
            variable &&
            lo?.isInfinity === true &&
            hi?.isInfinity === true &&
            ((lo.sgn === 'negative' && hi.sgn === 'positive') ||
              (lo.sgn === 'positive' && hi.sgn === 'negative'))
          ) {
            const r = ce.contourIntegrate(liftIntegrand(ops[0]), variable, {
              kind: 'real-line',
            });
            // A pole on the real axis: the integral is +∞ or −∞ when the
            // integrand keeps one sign next to every such pole, and has no
            // value when it changes sign. When neither could be decided, the
            // other methods below are tried.
            let divergent =
              r.status === 'pole-on-contour'
                ? divergentIntegralValue(
                    ce,
                    r.divergence,
                    lo.sgn === 'negative'
                  )
                : undefined;
            if (divergent?.isIndeterminate === true)
              divergent = noValueIntegral(ce, liftIntegrand(ops[0]), lo, hi);
            if (divergent)
              return numericApproximation ? divergent.N() : divergent;
            if (r.value) {
              const value = lo.sgn === 'negative' ? r.value : r.value.neg();
              return numericApproximation ? value.N() : value;
            }
          }
          if (variable && lo && hi) {
            let value = definiteIntegralByResidues(
              liftIntegrand(ops[0]),
              variable,
              lo,
              hi
            );
            if (value?.isIndeterminate === true)
              value = noValueIntegral(ce, liftIntegrand(ops[0]), lo, hi);
            if (value) return numericApproximation ? value.N() : value;
          }
        }

        if (numericApproximation) {
          // If a numeric approximation is requested, equivalent to NIntegrate
          const f = ops[0];

          // A free symbol in the integrand — a parameter with no value, e.g.
          // `a` in `∫₀¹ a·sin(x) dx` or an unassigned slider in `∫ n(x,q) dx`
          // — leaves nothing to integrate numerically, so stay symbolic. Not
          // merely a quality guard: without it the integrand is handed to
          // `implicitCompile`, whose generated body reads the free symbol from
          // a scope slot that the numeric caller never supplies, and the raw
          // `ReferenceError: _ is not defined` escapes out of generated code
          // to the caller of `.N()`.
          const boundVars = new Set<string>();
          for (const l of ops.slice(1)) {
            const v = isFunction(l) ? sym(l.op1) : undefined;
            if (v) boundVars.add(v);
          }
          // `unknowns` is a SURFACE property: for `∫ n(x) dx` where
          // `n = x ↦ q + x`, it reports nothing, because `q` lives in `n`'s
          // body. Look through user-defined operator heads (Tycho item 131 —
          // the shape that actually reached the `ReferenceError` the comment
          // above describes, since the surface guard never fired on it).
          // `boundVars` is passed IN rather than used to filter the result: it
          // binds the surface only, so a callee's capture that happens to share
          // an integration variable's name is not mistaken for it.
          if (transitiveUnknowns(f, boundVars).length > 0) return undefined;

          // A LIST bound (`∫_{-∞}^{G} f(Z) dZ` with `G = [-1, 0, 1]`): one
          // integral per element. This covers a single limit and several
          // limits: with several limits, element `i` gives the complete
          // multiple integral in which each list bound is replaced by its
          // element `i`. When more than one bound is a list, the lists are
          // paired element by element, and they must have the same length;
          // if they do not, the answer is the `incompatible-dimensions` error,
          // as under `evaluate()`. Without this the bound's `.re`
          // read `NaN` and the integral stayed inert under `.N()`, while the
          // symbolic path (through `EvaluateAt`) already answered a list. The
          // `type` handler above reports `list<number>` for the same shapes.
          const limitValues: Expression[][] = [];
          let count: number | undefined;
          for (const l of ops.slice(1)) {
            if (!isFunction(l, 'Limits')) {
              limitValues.push([]);
              continue;
            }
            limitValues.push([l.op2.N(), l.op3.N()]);
          }
          // The lengths are compared in the order the symbolic route reads
          // the bounds (the last limit first, the lower bound before the
          // upper), so that both routes name the lengths in one order in
          // the `incompatible-dimensions` error.
          for (const bounds of [...limitValues].reverse()) {
            for (const b of bounds) {
              if (!isFunction(b, 'List')) continue;
              if (count !== undefined && count !== b.nops)
                return ce.error(
                  'incompatible-dimensions',
                  `${count} vs ${b.nops}`
                );
              count = b.nops;
            }
          }
          if (count !== undefined) {
            const results: Expression[] = [];
            for (let i = 0; i < count; i++) {
              const limits = ops.slice(1).map((l, k) => {
                if (!isFunction(l, 'Limits')) return l;
                const [lo, hi] = limitValues[k].map((b) =>
                  isFunction(b, 'List') ? b.ops[i] : b
                );
                return ce.function('Limits', [l.op1, lo, hi]);
              });
              results.push(ce.function('Integrate', [f, ...limits]).N());
            }
            return ce.function('List', results);
          }

          // Multiple limits (`Integrate(f, Limits(x,…), Limits(y,…))`):
          // iterated quadrature over every limit. The single-limit path below
          // reads only `ops[1]` and would silently drop the other dimensions.
          // The bound values computed above are passed on, so that a bound
          // is not evaluated a second time.
          if (ops.length > 2)
            return withValueShield(ce, intVarNames, () =>
              nIntegrateMultiple(ce, f, ops.slice(1), limitValues)
            );

          const firstLimit = ops[1];
          if (!isFunction(firstLimit) || limitValues[0].length !== 2)
            return undefined;

          const [lowerValue, upperValue] = limitValues[0];
          const [lower, upper] = [lowerValue.re, upperValue.re];
          if (isNaN(lower) || isNaN(upper)) return undefined;

          // Get the integration variable from the limits
          const variable = sym(firstLimit.op1) ?? 'x';

          // Compile the integrand as a function.
          // If it's already a Function expression, compile directly.
          // Otherwise wrap it in a Function to compile correctly for numerical eval.
          // This converts e.g. 'x' to ['Function', 'x', 'x'] -> (x) => x
          const fnExpr =
            f.operator === 'Function' ? f : ce.expr(['Function', f, variable]);

          // A user-supplied `Function` literal may declare parameters the
          // single limit does not supply — `Integrate(Function(x+q, x, q),
          // Limits(x,0,1))`. Those are FORMAL parameters, so `f.unknowns` is
          // empty and the free-symbol guard above passes; the literal then
          // compiles two-arity, is invoked unary, and quadrature reads `NaN`.
          // Mirror the parameter/variable agreement check `nIntegrateMultiple`
          // already performs, and stay symbolic instead.
          if (isFunction(fnExpr, 'Function')) {
            const params = fnExpr.ops.slice(1).map((p) => sym(p));
            if (params.length !== 1 || params[0] !== variable) return undefined;
          }

          // A pole strictly inside the bounds: the integral diverges, and no
          // quadrature can say otherwise — the adaptive Gauss–Kronrod below
          // would report a finite `Measurement` with a confident error bar
          // (`∫₀² sec t dt` → `8.316585 ± 0.000016`), since its error estimate
          // is blind to a singularity it happens to straddle. Answer what the
          // integral actually is: `+∞`/`−∞` when the integrand keeps one sign
          // across every pole, `NaN` when it changes sign (no value, not even
          // an infinite one). Placed AFTER the parameter-agreement guard above,
          // so the body examined binds nothing but the integration variable
          // (a spare formal parameter could otherwise read a same-named
          // global). The iterated form runs the same check per dimension in
          // `nIntegrateMultiple`. The values of the other assigned symbols are
          // substituted first: the compiled integrand reads them, so the check
          // must examine the same function (see `withAssignedValues`).
          const pole = withValueShield(ce, intVarNames, () =>
            interiorPoleVerdict(
              withAssignedValues(
                ce,
                isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr,
                [variable]
              ),
              variable,
              lower,
              upper,
              ce
            )
          );
          if (pole !== undefined) return poleVerdictValue(ce, pole);

          // An integrand that does not depend on the variable and whose value
          // is infinite — typically the inner integral of a nested integral
          // that diverges (`∫₀² ∫₀² (y − 1)⁻² dy dx`, whose inner integral
          // is `+∞`) — gives that infinity, negated for reversed bounds.
          // Quadrature cannot answer it: every sample is infinite and the
          // weighted sum is `NaN`. The integrand is evaluated here only when
          // it is pure, so that an effect (`Random()`) is not run once more.
          const infinite = infiniteConstantIntegral(
            ce,
            isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr,
            variable,
            Math.sign(upper - lower)
          );
          if (infinite !== undefined) return infinite;

          const compiled = withValueShield(ce, intVarNames, () =>
            implicitCompile(ce, fnExpr)
          );
          const raw: (x: number) => unknown = compiled?.success
            ? (compiled.run as (x: number) => unknown)
            : (
                (app) => (x: number) =>
                  app([ce.number(x)])
              )(applicable(fnExpr));
          const integrand = numericIntegrandParts(raw);

          // ONE sub-stream for both passes: the imaginary pass continues where
          // the real pass stopped. Re-deriving the stream per pass would give
          // both passes the same draws, while `measurementFromParts` combines
          // their errors as independent (see `nIntegrateMultiple`, which
          // shares its stream across levels for the same reason).
          const draw = ce._substream(mixTags(f.hash, firstLimit.hash));

          // Integrate ONE real-valued part of the integrand over the interval.
          const integrateReal = (jsf: (x: number) => number) =>
            integrateRealPart(ce, jsf, lower, upper, {
              compiled: compiled?.success === true,
              uncached: integrand.uncached,
              draw,
              nested: fnExpr.has(['Integrate', 'NIntegrate']),
            });

          const re = integrateReal(integrand.re);
          // The quadrature found a divergence, which has no sign. A pole AT
          // a bound (`∫₀¹ t⁻² dt`) gives the sign: the integral diverges with
          // the sign of the integrand next to that bound, inside the
          // interval, as on the exact route (see `endpointPoleVerdict`).
          if (re.divergent) {
            const endpoint = withValueShield(ce, intVarNames, () =>
              endpointPoleVerdict(
                withAssignedValues(
                  ce,
                  isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr,
                  [variable]
                ),
                variable,
                lower,
                upper,
                ce
              )
            );
            if (endpoint !== undefined) return poleVerdictValue(ce, endpoint);
          }
          // No sample was a number: nothing was integrated. Stay symbolic
          // (the closed form, when there is one, is then still reachable).
          if (Number.isNaN(re.estimate) && !integrand.sawNumeric())
            return undefined;
          if (!integrand.sawImaginary()) return measurementFromParts(ce, re);
          return measurementFromParts(ce, re, integrateReal(integrand.im));
        }

        const limitsSequence = ops.slice(1);

        // Indefinite integral?
        if (limitsSequence.length === 0) {
          return undefined;
        }

        const result = withValueShield(ce, intVarNames, () => {
          let expr = ops[0];
          const argNames = isFunction(expr)
            ? expr.ops.slice(1).map((x) => sym(x))
            : [];

          let isIndefinite = true;
          for (let i = limitsSequence.length - 1; i >= 0; i--) {
            // An inner integral with a list bound gives a LIST integrand for
            // the remaining (outer) limits: one integral per element, paired
            // with the elements of an outer list bound.
            if (isFunction(expr, 'List')) {
              const remaining = limitsSequence.slice(0, i + 1);
              return (
                integrateListIntegrand(ce, expr, remaining, false) ??
                ce.function('Integrate', [expr, ...remaining])
              );
            }
            if (!isFunction(limitsSequence[i])) continue;
            const limitFn = limitsSequence[i] as Expression &
              import('../global-types.js').FunctionInterface;
            const [varExpr, lower, upper] = limitFn.ops;
            let variable = sym(varExpr);

            // Default variable name if missing
            if ((!variable || variable === 'Nothing') && i < argNames.length)
              variable = argNames[i];
            if (!variable) variable = 'x';

            // An opt-in integration provider (e.g. the Rubi rule driver loaded
            // via `loadIntegrationRules`) is consulted first; it returns null or
            // an inert `Integrate` when it can't close the integrand, in which
            // case we fall back to the built-in antiderivative. With no provider
            // registered (the default), behavior is unchanged.
            let antideriv: Expression | null = null;
            let pole: ReturnType<typeof interiorPoleVerdict>;
            // Work on the LIFTED integrand: both paths below unwrap the
            // `Function`/`Block` scaffolding anyway, and lifting it here
            // re-binds its symbols to the caller's, so they agree with the
            // occurrences these paths mint themselves (`liftIntegrand`).
            // The integrand of an iterated integral written as nested
            // integrals (`\int\int |x-y|\,dx\,dy` on the parse route) is,
            // or contains, an unevaluated inner `Integrate`
            // (`∫_0^1 x ∫_{−1}^{1} |x| dx dx`). Evaluate each inner integral
            // first, so that the split at the kinks and the antiderivative
            // below see its closed form (see `evaluateInnerIntegrals`).
            // The inner integrals are evaluated knowing the range of this
            // integral and of the enclosing ones (see `enclosingRangesOf`).
            const isDefinite =
              sym(lower) !== 'Nothing' && sym(upper) !== 'Nothing';
            const ranges = [
              ...outerRanges(limitsSequence.slice(0, i)),
              ...enclosingRanges(ce),
            ];
            const integrand = withEnclosingRanges(
              ce,
              isDefinite
                ? [{ name: variable, lower, upper }, ...ranges]
                : ranges,
              () => evaluateInnerIntegrals(liftIntegrand(expr))
            );
            // A definite integral whose integrand has `Abs(u)` or `Sign(u)`
            // with `u` linear in the variable is integrated piece by piece
            // between the points where `u` changes sign. The whole-interval
            // antiderivative can have a jump at those points, and the
            // fundamental theorem of calculus would add the jump to the
            // result (see `integrateAcrossKinks`).
            // Over proven-equal bounds (`∫_1^1`, `∫_a^a`) the integral is
            // zero. This is decided first: the split below declines an empty
            // interval, and the whole-interval antiderivative can have a
            // `Sign(u)` term, which leaves the integral unevaluated.
            if (
              isDefinite &&
              (lower.isSame(upper) ||
                decidedSign(ce.function('Subtract', [upper, lower])) === 0)
            ) {
              isIndefinite = false;
              expr = ce.Zero;
              continue;
            }
            // An infinite constant integrand — typically the value of a
            // divergent inner integral (`∫₀² ∫₀² (y − 1)⁻² dy dx`) — over an
            // interval of nonzero length is that infinity, negated for
            // reversed bounds. The antiderivative `+∞·x` cannot be
            // differenced at the bounds (`+∞·2 − +∞·0` has no value), so
            // this is decided before it. A held integrand can be the raw
            // symbol `PositiveInfinity`: `.canonical` makes it the number.
            const infinite = isDefinite ? integrand.canonical : undefined;
            if (isNumber(infinite) && infinite.isInfinity === true) {
              const orientation = decidedSign(
                ce.function('Subtract', [upper, lower])
              );
              isIndefinite = false;
              expr =
                orientation === 1
                  ? infinite
                  : orientation === -1
                    ? infinite.neg()
                    : ce.function('Integrate', [
                        expr,
                        ce.function('Limits', [
                          ce.symbol(variable),
                          lower,
                          upper,
                        ]),
                      ]);
              continue;
            }
            if (isDefinite) {
              const split =
                integratePiecewise(ce, integrand, variable, lower, upper) ??
                integrateAcrossKinks(
                  ce,
                  integrand,
                  variable,
                  lower,
                  upper,
                  numericApproximation ?? false
                );
              if (split !== undefined) {
                isIndefinite = false;
                expr =
                  split === 'inert'
                    ? ce.function('Integrate', [
                        expr,
                        ce.function('Limits', [
                          ce.symbol(variable),
                          lower,
                          upper,
                        ]),
                      ])
                    : split;
                continue;
              }
            }
            if (ce._integrationProvider) {
              try {
                antideriv = ce._integrationProvider(integrand, variable);
              } catch (e) {
                // A cancellation (deadline/interrupt) thrown inside the provider
                // must propagate — swallowing it would turn a timeout into a
                // silent fall-through to the built-in antiderivative.
                // The name is checked instead of `instanceof`: a provider from
                // a plugin bundle (the Rubi integration rules) throws its own
                // copy of the `CancellationError` class.
                if (e instanceof Error && e.name === 'CancellationError')
                  throw e;
                antideriv = null;
              }
            }
            if (!antideriv || antideriv.operator === 'Integrate')
              antideriv = antiderivative(integrand, variable);

            if (sym(lower) === 'Nothing' && sym(upper) === 'Nothing') {
              // Indefinite integral: keep the antiderivative, whether it was
              // resolved (a closed form) or left inert (an `Integrate` node, or
              // an `Add` such as `5x + Integrate(g, x)` when only some terms
              // integrate).
              expr = antideriv;
            } else if (
              antideriv.has('Integrate') ||
              hasVariableSign(antideriv, variable)
            ) {
              // The antiderivative could NOT be fully found — the result is
              // either an inert `Integrate` (e.g. an unknown integrand, or
              // `√(1−x²)/(1+x²)`) or an `Add` that still contains one (e.g.
              // `∫ (g(x) + 5) dx → 5x + Integrate(g, x)`). Keep the definite
              // integral inert; do NOT wrap it in `EvaluateAt`. Beta-reducing
              // the integrand at the bounds would capture the integration
              // variable and silently collapse the integral to a wrong finite
              // value (∫₋₁¹ √(1−x²)/(1+x²) dx → 0, the `+5` case → 10, etc.).
              // The `.N()` path (NIntegrate quadrature) still gives the value.
              // See CORRECTNESS_FINDINGS P0-1.
              //
              // The same applies when the antiderivative has a `Sign(u)` term
              // with `u` depending on the variable, and the integral could not
              // be split where `u` changes sign (the bounds are symbolic, as
              // in `∫_{−a}^{a} |x| cos x dx`). That term jumps where `u`
              // changes sign, and if that point is between the bounds,
              // `F(b) − F(a)` includes the jump and is wrong.
              isIndefinite = false;
              expr = ce.function('Integrate', [
                expr,
                ce.function('Limits', [ce.symbol(variable), lower, upper]),
              ]);
            } else if (
              (pole =
                interiorPoleVerdict(
                  // The bounds are differenced with the values of the
                  // assigned symbols, so the check must see those values
                  // too: with `q := 1`, `∫₀² (y − q)⁻² dy` has its pole at
                  // `y = 1`.
                  withAssignedValues(ce, integrand, [variable]),
                  variable,
                  lower,
                  upper,
                  ce
                ) ??
                // A free symbol in a constant factor (`1/(a·t)`): see
                // `constantFactorPoleVerdict`.
                constantFactorPoleVerdict(
                  ce,
                  withAssignedValues(ce, integrand, [variable]),
                  variable,
                  lower,
                  upper
                ))
            ) {
              // The integrand is unbounded at a point STRICTLY INSIDE the
              // bounds, so the fundamental theorem of calculus does not apply
              // and the integral diverges. Differencing the antiderivative
              // anyway would report a finite value for a divergent integral
              // (∫₋₁¹ dt/t → 0, ∫₋₁¹ dt/t² → −2). When the integrand keeps one
              // sign on both sides of every pole the integral diverges to that
              // infinity (∫₋₁¹ dt/t² → +∞, as ∫₀¹ dt/t → +∞ already does).
              // When it changes sign (`mixed`) the integral has no value, not
              // even an infinite one: `Indeterminate`, or `NaN` with a float
              // operand (see `noValueIntegral`). When the direction of the
              // divergence is not established (`unknown`) the integral stays
              // inert, as the "antiderivative not fully found" arm above
              // does. `interiorPoleVerdict` only answers for a proven pole,
              // so a correct closed form is never lost this way.
              isIndefinite = false;
              expr =
                pole.sign === 'positive'
                  ? ce.PositiveInfinity
                  : pole.sign === 'negative'
                    ? ce.NegativeInfinity
                    : pole.sign === 'mixed'
                      ? noValueIntegral(
                          ce,
                          withAssignedValues(ce, integrand, [variable]),
                          lower,
                          upper
                        )
                      : ce.function('Integrate', [
                          expr,
                          ce.function('Limits', [
                            ce.symbol(variable),
                            lower,
                            upper,
                          ]),
                        ]);
            } else if (
              symbolicPoleMayBeInside(
                withAssignedValues(ce, integrand, [variable]),
                variable,
                lower,
                upper,
                ce,
                ranges
              )
            ) {
              // The integrand may have a pole between the bounds, at a point
              // whose position depends on a symbol with no value: `(y − a)⁻²`
              // over `[0, 4]` has its pole inside for `0 ≤ a ≤ 4`, where the
              // integral is `+∞`, but the antiderivative difference
              // `−1/a − 1/(4 − a)` is finite. The integral stays
              // unevaluated, unless the declared type of the symbol or an
              // assumption proves the pole outside the bounds (`a > 4`). The
              // integration variable of an enclosing integral is examined
              // over its range: the inner integral of
              // `∫₀¹⁰ ∫₃⁴ (y − x)⁻² dx dy` stays unevaluated (the pole `x = y`
              // is in `[3, 4]` for some `y`), so the outer one does too, while
              // `∫₅¹⁰ ∫₃⁴ (y − x)⁻² dx dy` is evaluated.
              isIndefinite = false;
              expr = ce.function('Integrate', [
                expr,
                ce.function('Limits', [ce.symbol(variable), lower, upper]),
              ]);
            } else {
              // The antiderivative was found in closed form. Apply the bounds
              // via `EvaluateAt`, which also supports symbolic bounds
              // (∫₀^a x dx → a²/2; see commit 9b818ec8).
              isIndefinite = false;
              const F = ce.expr(['Function', antideriv, variable]);
              const at = ce.expr(['EvaluateAt', F, lower, upper]);
              // Resolve any parameter-dependent endpoint indeterminate left by
              // FTC at a limit-point bound (0, ±∞): emit a convergence-guarded
              // `When`, or keep the integral inert (fail closed) rather than leak
              // an indeterminate form (`0^…`, `∞^…`).
              let raw = at.evaluate({ numericApproximation });
              // FTC at an infinite bound can leave a `poly(var)·e^{−c·var}`-type
              // `∞·0` product that naive substitution collapses to NaN. Re-resolve
              // each improper endpoint as a genuine limit of the antiderivative.
              let viaLimit: Expression | undefined;
              if (
                raw.isNaN === true &&
                (lower.isInfinity === true || upper.isInfinity === true)
              ) {
                viaLimit = improperEndpointValue(
                  antideriv,
                  variable,
                  lower,
                  upper,
                  ce,
                  numericApproximation ?? false
                );
                if (viaLimit !== undefined) raw = viaLimit;
              }
              // A pole AT a finite bound: the antiderivative is not finite
              // there (`−1/t` at `0` gives `~∞`), so the difference has no
              // sign. The integral is the one-sided limit from inside the
              // interval, which diverges with the sign of the integrand next
              // to the bound (`∫₀¹ t⁻² dt` is `+∞`). Poles at both bounds with
              // different signs give an integral with no value:
              // `Indeterminate`, or `NaN` with a float operand, as for an
              // interior pole that changes sign (see `noValueIntegral`). The
              // check
              // runs only when the antiderivative difference is not finite:
              // it alone cannot tell an integrable singularity of order
              // close to 1 (`t^(−0.95)`) from a pole (see
              // `endpointPoleVerdict`).
              let noValue: Expression | undefined;
              if (raw.isNaN === true || raw.isInfinity === true) {
                const integrandValue = withAssignedValues(ce, integrand, [
                  variable,
                ]);
                const endpoint = endpointPoleVerdict(
                  integrandValue,
                  variable,
                  lower,
                  upper,
                  ce
                );
                if (endpoint?.sign === 'mixed')
                  noValue = noValueIntegral(ce, integrandValue, lower, upper);
                else if (endpoint !== undefined)
                  raw = poleVerdictValue(ce, endpoint);
                // A complex infinity (`~∞`) is not the value of the integral
                // of a real integrand over a real interval: that integral is
                // a real number, `+∞`, `−∞`, or has no value. Without a
                // verdict, the integral stays unevaluated (`NaN` makes it
                // inert below).
                else if (
                  raw.isSame(ce.ComplexInfinity) &&
                  isRealOnInterval(integrandValue, variable, lower, upper, ce)
                )
                  raw = ce.NaN;
              }
              // A NaN result is an unresolved indeterminate, not a leak-free
              // value — fail closed (inert) rather than leak the NaN.
              const resolved =
                raw.isNaN === true ? null : resolveEndpointLeaks(raw, ce);
              if (noValue !== undefined) expr = noValue;
              else if (resolved !== null && isSymbol(resolved.guard, 'True')) {
                // Leak-free: keep the original evaluation path's RESULT. `raw`
                // IS `at.evaluate({numericApproximation})`, so returning it is
                // value-identical to re-evaluating `at` — but skips a second
                // full FTC endpoint pass (measured ~35–40% of the whole
                // definite-Gaussian evaluation; the tail's `expr.evaluate()`
                // on an already-evaluated value is an idempotent cheap walk).
                // When a limit re-resolved an improper endpoint, `raw` holds
                // that limit value already (and `at` itself would still
                // collapse to NaN), so `raw` covers both cases.
                expr = raw;
              } else {
                const guarded =
                  resolved === null
                    ? null
                    : conditionalValue(ce, resolved.value, resolved.guard);
                expr =
                  guarded ??
                  ce.function('Integrate', [
                    expr,
                    ce.function('Limits', [ce.symbol(variable), lower, upper]),
                  ]);
              }
            }
          }
          if (expr.operator !== 'Integrate') {
            // For indefinite integrals with symbolic transcendental constants
            // (like ln(2)), don't call evaluate/simplify as it would convert
            // them to numeric values. Otherwise, simplify for cleaner output.
            if (isIndefinite) {
              if (hasSymbolicTranscendental(expr)) return expr;
              return expr.simplify();
            }
            return expr.evaluate({ numericApproximation });
          }
          return expr;
        });

        // An INDEFINITE integral's result is an OPEN expression in the
        // integration variable, which this node now binds in its own scope
        // (`scoped: indexingSetSites(1)`). Without this the antiderivative
        // leaves the frame still referencing the dying binding and compares
        // unequal to the same expression written in the ambient scope — the
        // repair `Series` needed for exactly the same reason (stage 1).
        return rebindEscapingCurrentScope(ce, result);
      },
    },

    NIntegrate: {
      description: 'Numerical approximation of a definite integral.',
      broadcastable: false,
      // Its Monte-Carlo fallback samples through a derived sub-stream, so it
      // READS the ambient `WithRandomSeed` frame while consuming none of its
      // indices. Not `drawsRandom` (that would shift every sibling draw), but
      // the pending gate must still keep the frame around an estimate that
      // could not finish — otherwise deferring it converts a seeded estimate
      // to a live one. See `docs/RANDOMNESS-MODEL.md` §6.
      readsRandomFrame: true,
      lazy: true,
      signature: '(function, lower:number, upper:number) -> number',
      canonical: (ops, { engine }) => {
        const [body, lower, upper] = ops;
        const fn = canonicalFunctionLiteral(body);
        if (!fn) return null;
        // The two bounds are numbers. A `Tuple` of bounds
        // (`NIntegrate(f, (0, 2))`) or a missing bound is an error operand,
        // not an expression that stays unevaluated. A multiple integral is
        // written `Integrate(f, Limits(x, …), Limits(y, …)).N()`.
        return engine._fn('NIntegrate', [
          fn,
          checkType(engine, lower, 'number'),
          checkType(engine, upper, 'number'),
        ]);
      },
      evaluate: ([f, a, b], { engine }) => {
        // Uses compiled JS functions (machine arithmetic)
        const [lower, upper] = [a.N().re, b.N().re];
        if (isNaN(lower) || isNaN(upper)) return undefined;

        // A pole strictly inside the bounds: the integral diverges, and the
        // error estimate of the quadrature below cannot see a singularity
        // that falls between its sample points, so the quadrature would
        // report a finite value. `Integrate(…).N()` makes the same check,
        // also before it compiles the integrand.
        const pole = nIntegratePoleVerdict(engine, f, lower, upper);
        if (pole !== undefined) return poleVerdictValue(engine, pole);

        // A function given by its name (`Sin`) is wrapped in a one-parameter
        // `Function` literal: compiled alone, the symbol compiles to a
        // function that RETURNS the function, so every sample read `NaN`.
        const name = isFunction(f, 'Function') ? undefined : sym(f);
        const fn = name
          ? engine.expr([
              'Function',
              [name, NINTEGRATE_VARIABLE],
              NINTEGRATE_VARIABLE,
            ])
          : f;
        const compiled = implicitCompile(engine, fn);
        // The integrand may be complex-valued: integrate its real part, and
        // its imaginary part too when a sample carried one (see
        // `numericIntegrandParts` and the `Integrate` numeric path).
        const raw: (x: number) => unknown = compiled?.success
          ? (compiled.run as (x: number) => unknown)
          : (
              (app) => (x: number) =>
                app([engine.number(x)])
            )(applicable(fn));
        const integrand = numericIntegrandParts(raw);
        // One stream for both passes (see the `Integrate` numeric path).
        const draw = engine._substream(mixTags(f.hash, a.hash, b.hash));

        // The same methods, in the same order, as `Integrate(…).N()`: the
        // oscillatory quadrature on a semi-infinite interval, then adaptive
        // Gauss–Kronrod, `NaN` for a divergent integral, and Monte Carlo only
        // when the quadrature does not converge. The result is a plain number:
        // the error estimate is dropped.
        const integrate = (jsf: (x: number) => number) =>
          integrateRealPart(engine, jsf, lower, upper, {
            compiled: compiled?.success === true,
            uncached: integrand.uncached,
            draw,
            nested: fn.has(['Integrate', 'NIntegrate']),
          });

        const re = integrate(integrand.re);
        // A divergence found by the quadrature, with a pole AT a bound: the
        // sign of the integrand next to that bound gives the sign of the
        // divergence (see the `Integrate` numeric path).
        if (re.divergent) {
          const endpoint = nIntegratePoleVerdict(
            engine,
            f,
            lower,
            upper,
            endpointPoleVerdict
          );
          if (endpoint !== undefined) return poleVerdictValue(engine, endpoint);
        }
        // A numeric estimate is a float, even when its value is an integer
        // (`NIntegrate(1, 0, 2)` is `2.0`). `+ 0` turns a -0 into 0.
        if (!integrand.sawImaginary())
          return engine.number(engine._inexactNumericValue(re.estimate + 0));
        return engine.number(
          engine._inexactNumericValue({
            re: re.estimate + 0,
            im: integrate(integrand.im).estimate + 0,
          })
        );
      },
    },

    DSolve: {
      description: 'Symbolic differential equation solver.',
      broadcastable: false,
      lazy: true,
      signature: '(expression, symbol, symbol) -> expression',
      canonical: (ops, { engine }) => {
        if (ops.length === 0)
          return engine._fn('DSolve', [
            engine.error('missing'),
            engine.error('missing'),
            engine.error('missing'),
          ]);
        if (ops.length === 1)
          return engine._fn('DSolve', [
            ops[0],
            engine.error('missing'),
            engine.error('missing'),
          ]);
        const dependent = symbolOrListArg(engine, ops[1]);
        const equation = repairDependentApplications(
          ops[0],
          dependentSymbolNames(dependent)
        );
        if (ops.length === 2)
          return engine._fn('DSolve', [
            equation,
            dependent,
            engine.error('missing'),
          ]);

        return engine._fn('DSolve', [
          equation,
          dependent,
          symbolArg(engine, ops[2]),
        ]);
      },
      evaluate: ([equation, dependent, independent]) =>
        dSolve(equation, dependent, independent),
    },

    RSolve: {
      description: 'Symbolic recurrence equation solver.',
      broadcastable: false,
      lazy: true,
      signature: '(expression, symbol, symbol) -> expression',
      canonical: (ops, { engine }) => {
        if (ops.length === 0)
          return engine._fn('RSolve', [
            engine.error('missing'),
            engine.error('missing'),
            engine.error('missing'),
          ]);
        if (ops.length === 1)
          return engine._fn('RSolve', [
            ops[0],
            engine.error('missing'),
            engine.error('missing'),
          ]);
        if (ops.length === 2)
          return engine._fn('RSolve', [
            ops[0],
            symbolArg(engine, ops[1]),
            engine.error('missing'),
          ]);

        return engine._fn('RSolve', [
          ops[0],
          symbolArg(engine, ops[1]),
          symbolArg(engine, ops[2]),
        ]);
      },
      evaluate: ([equation, dependent, index]) =>
        rSolve(equation, dependent, index),
    },

    NDSolve: {
      description: 'Numerical differential equation solver.',
      broadcastable: false,
      lazy: true,
      signature:
        '(expression, symbol, limits:(tuple|symbol), number, number?) -> list',
      canonical: (ops, { engine }) => {
        const missing = engine.error('missing');
        const limits =
          ops[2] && isFunction(ops[2])
            ? canonicalLimits(ops[2].ops, { engine })
            : canonicalLimits(ops[2] ? [ops[2]] : [], { engine });

        const dependent = symbolOrListArg(engine, ops[1]);
        const equation = ops[0]
          ? repairDependentApplications(ops[0], dependentSymbolNames(dependent))
          : missing;

        return engine._fn('NDSolve', [
          equation,
          dependent,
          limits ?? missing,
          ops[3]?.canonical ?? missing,
          ...(ops[4] ? [ops[4].canonical] : []),
        ]);
      },
      evaluate: ([equation, dependent, limits, initialValue, steps]) =>
        nDSolve(equation, dependent, limits, initialValue, steps),
    },

    NDSolveFunction: {
      description:
        'Numerically solve an ordinary differential equation and return ' +
        'the solution as an applicable function (a `Function` literal ' +
        'wrapping an `InterpolatingFunction`), usable at any point of the ' +
        'integration interval. Same arguments as `NDSolve`, without the ' +
        'sample count.',
      broadcastable: false,
      lazy: true,
      // The ODE's independent variable is this operator's BOUND variable, and
      // it is carried by the `Limits` operand (operand 2) — a position the
      // evaluate path used to read out by hand, leaving the variable bound
      // wherever the caller happened to have it.
      scoped: limitsIndexSites(2),
      signature:
        '(expression, symbol, limits:(tuple|symbol), number) -> function',
      canonical: (ops, { engine }) => {
        const missing = engine.error('missing');
        const limits =
          ops[2] && isFunction(ops[2])
            ? canonicalLimits(ops[2].ops, { engine })
            : canonicalLimits(ops[2] ? [ops[2]] : [], { engine });

        const dependent = symbolOrListArg(engine, ops[1]);
        const equation = ops[0]
          ? repairDependentApplications(ops[0], dependentSymbolNames(dependent))
          : missing;

        return engine._fn('NDSolveFunction', [
          equation,
          dependent,
          limits ?? missing,
          ops[3]?.canonical ?? missing,
        ]);
      },
      evaluate: ([equation, dependent, limits, initialValue]) =>
        nDSolveFunction(equation, dependent, limits, initialValue),
    },

    InterpolatingFunction: {
      description:
        'Piecewise-quartic dense-output interpolant of a numeric ODE ' +
        'solution (produced by `NDSolveFunction`). The first operand is the ' +
        'per-step coefficient table; applied to a number, it evaluates the ' +
        'solution there (clamping to the covered interval outside it). ' +
        'Stays symbolic for a non-numeric argument.',
      broadcastable: false,
      lazy: true,
      signature: '(list<any>, number?) -> number',
      evaluate: ([data, x], { engine }) => {
        if (x === undefined) return undefined;
        const xv = x.N().re;
        if (!Number.isFinite(xv)) return undefined;
        const rows = interpolatingFunctionRows(data);
        if (!rows) return undefined;
        const value = evalDenseRows(rows, xv);
        // An interpolated value is a float, even when it is an integer
        return Number.isFinite(value)
          ? engine.number(engine._inexactNumericValue(value + 0))
          : undefined;
      },
      compile: (args, compile, { language }) => {
        if (language !== 'javascript') return undefined;
        if (args.length !== 2) return undefined;
        const rows = interpolatingFunctionRows(args[0]);
        if (!rows) return undefined;
        // Embed the dense table and interpolate inline: binary search for
        // the step interval, then the nested (Horner-like) quartic.
        const table = JSON.stringify(rows);
        return (
          `((_x)=>{const _D=${table};` +
          `let _lo=0,_hi=_D.length-1;` +
          `const _dir=_D[_hi][0]+_D[_hi][1]>=_D[0][0]?1:-1;` +
          `while(_lo<_hi){const _m=(_lo+_hi)>>1;` +
          `if(_dir*(_x-_D[_m][0]-_D[_m][1])>0)_lo=_m+1;else _hi=_m;}` +
          `const _s=_D[_lo],_h=_s[1];` +
          `let _t=_h===0?0:(_x-_s[0])/_h;` +
          `_t=Math.min(1,Math.max(0,_t));const _u=1-_t;` +
          `return _s[2]+_t*(_s[3]+_u*(_s[4]+_t*(_s[5]+_u*_s[6])));` +
          `})(${compile(args[1])})`
        );
      },
    },

    // This is used to represent the indexing set/limits (i.e.
    // an index, lower and upper bounds) of a function
    // (not to be confused with Limit, which calculates the limit of a
    // function at a point)
    // It is a convenient function that prevents the first argument (the index)
    // from being canonicalized
    Limits: {
      description: 'Limits of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(index:symbol, lower:value, upper:value) -> tuple',
      canonical: (ops, { engine }) => canonicalLimits(ops, { engine }) ?? null,
    },
  },

  {
    // Limits
    Limit: {
      description: 'Limit of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(function, point:number, direction:number?) -> number',
      canonical: (ops, { engine }) => {
        // Rule-arrow form `Limit(expr, x -> x0)`: the second operand is a held
        // (raw) `To(var, point)`. Rewrite to the Wolfram-style form
        // `Limit(expr, var, point[, direction])` handled below. A `^+`/`^-`
        // direction marker on the point parses as `PseudoInverse(point)` /
        // `Superminus(point)` (generic superscript postfix); in the
        // limit-point position those shapes are direction markers, matching
        // the `\lim_{x \to 0^+}` parser: unwrap them to the direction operand
        // (1 = from above, -1 = from below).
        if (
          ops.length === 2 &&
          isFunction(ops[1], 'To') &&
          isSymbol(ops[1].op1)
        ) {
          let point = ops[1].op2;
          let direction: Expression | undefined = undefined;
          if (isFunction(point, 'PseudoInverse') && point.nops === 1) {
            direction = engine.number(1);
            point = point.op1;
          } else if (isFunction(point, 'Superminus') && point.nops === 1) {
            direction = engine.number(-1);
            point = point.op1;
          }
          ops = direction
            ? [ops[0], ops[1].op1, point, direction]
            : [ops[0], ops[1].op1, point];
        }
        const [f, x, dir] = ops;
        // Wolfram-style form `Limit(expr, var, point[, direction])`: when the
        // middle operand is a symbol that is a free variable of the
        // expression, bind it explicitly as the expansion variable and treat
        // the third operand as the point. This canonicalizes to the same
        // internal representation as the 2-arg form `Limit(expr, point)`
        // (which infers the variable). A first operand that is already a
        // `Function` literal is NOT this form: its variable is bound in the
        // literal, so a symbol in second position is a (symbolic) limit
        // point — e.g. `Limit(Function(1/(x-a), x), a, 1)` from
        // `\lim_{x \to a^+}` — not the expansion variable.
        if (
          (ops.length === 3 || ops.length === 4) &&
          f &&
          isSymbol(x) &&
          !isFunction(f, 'Function')
        ) {
          // Syntactic occurrence (`.has`), not `.unknowns`: the middle operand
          // is the bound expansion variable, so it counts even when it also
          // carries a global value (`x := 5`), which drops it from `.unknowns`.
          if (f.canonical.has(x.symbol)) {
            const fn = canonicalFunctionLiteralArguments(engine, [f, x]);
            if (!fn) return null;
            return engine._fn('Limit', [
              fn,
              ops[2].canonical,
              ...(ops.length === 4 ? [ops[3].canonical] : []),
            ]);
          }
        }
        const fn = canonicalFunctionLiteral(f);
        if (!fn || !x) return null;
        if (dir === undefined) return engine._fn('Limit', [fn, x.canonical]);
        return engine._fn('Limit', [fn, x.canonical, dir.canonical]);
      },
      evaluate: ([f, x, dir], { engine, numericApproximation }) => {
        // Symbolic path first: it produces an exact closed form (`sin x/x → 1`,
        // `(3ˣ+5ˣ)^{1/x} → 5`) and is the only path under a non-numeric
        // `evaluate()`. It returns `undefined` when it can't determine the
        // limit, so the numeric machinery below still covers everything it did.
        if (isFunction(f)) {
          const varName = sym(f.op2);
          if (varName) {
            const direction =
              dir && Number.isFinite(dir.re) ? dir.re : undefined;
            const symbolic = symbolicLimit(
              f.op1,
              varName,
              x,
              direction,
              engine
            );
            if (symbolic !== undefined)
              return numericApproximation ? symbolic.N() : symbolic;
          }
        }

        // Numeric fallback: compiled JS functions (machine arithmetic).
        // The iteration budget keeps a single sample on the extrapolation
        // ladder interruptible: an unbudgeted compiled Sum/Product with a
        // variable-dependent bound runs an arbitrarily long loop that no
        // deadline check can reach (see LIMIT_PROBE_ITERATION_BUDGET).
        if (numericApproximation) {
          return numericLimitValue(engine, f, x, dir);
        }
        return undefined;
      },
    },
    Residue: {
      description:
        'Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion)',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(expression, variable:symbol, point:value) -> number',
      canonical: ([f, x, a], { engine }) => {
        if (!f || !x || !a || !isSymbol(x)) return null;
        return engine._fn('Residue', [f.canonical, x, a.canonical]);
      },
      evaluate: ([f, x, a], { engine, numericApproximation }) => {
        const varName = sym(x);
        if (!varName) return undefined;
        const r = residue(f, varName, a, engine);
        if (r === undefined) return undefined;
        return numericApproximation ? r.N() : r;
      },
    },
    NLimit: {
      description: 'Numerical approximation of the limit of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(function, point:number, direction:number?) -> number',
      canonical: ([f, x, dir], { engine }) => {
        const fn = canonicalFunctionLiteral(f);
        if (!fn || !x) return null;
        if (dir === undefined) return engine._fn('NLimit', [fn, x.canonical]);
        return engine._fn('NLimit', [fn, x.canonical, dir.canonical]);
      },
      evaluate: ([f, x, dir], { engine }) => {
        // Uses compiled JS functions (machine arithmetic). Budgeted for the
        // same reason as Limit's numeric fallback above.
        return numericLimitValue(engine, f, x, dir);
      },
    },
  },

  {
    //
    // **Series**: Taylor (or asymptotic, at ±∞) series expansion.
    //
    // `["Series", f, x]`            → about x0 = 0, order 5
    // `["Series", f, x, x0]`        → order 5
    // `["Series", f, x, x0, n]`     → n is the highest retained power
    //
    // The result is a plain expression: the truncated sum plus an inert
    // `BigO` remainder head (e.g. `Sin(x)` → `x − x³/6 + x⁵/120 + O(x⁷)`).
    // At a pole the result is a Laurent expansion (e.g. `Cot(x)` →
    // `1/x − x/3 − …`), via the Laurent engine in symbolic/series.ts. That
    // engine also produces **Puiseux** expansions with fractional powers
    // (`√(sin x)` → `√x − x^{5/2}/12 + …`) and **log-aware** expansions
    // (`ln(sin x)` → `ln x − x²/6 − …`, `x^x` → `1 + x ln x + …`). Only an
    // essential singularity (`e^{1/x}`), an irrational/symbolic exponent
    // (`x^π`), a nested/reciprocal logarithm (`ln(ln x)`, `1/ln x`), or a
    // non-differentiable operand leaves `Series(...)` unevaluated (never a
    // partial/wrong expansion).
    //
    Series: {
      description:
        'Taylor series expansion of an expression about a point (or an ' +
        'asymptotic expansion at ±∞), including Laurent, Puiseux ' +
        '(fractional-power), and log-aware expansions at poles and branch ' +
        'points. Only essential singularities, irrational exponents, and ' +
        'nested/reciprocal logarithms are left unevaluated. ' +
        'Example: Series(\\sin x, x) → x - x^3/6 + x^5/120 + O(x^7)',
      broadcastable: false,
      lazy: true,
      // The expansion variable is this operator's BOUND variable: operand 1.
      // The framework declares it in this node's own scope before the handler
      // canonicalizes the body against it, and rebinds it afterwards — so the
      // parse route (which leaves a binding-site symbol raw) and the function
      // route (whose caller passes a symbol carrying the CALLER's binding)
      // agree about the same expression.
      scoped: operandSites(1),
      signature:
        '(expression, variable:symbol?, point:value?, order:number?) -> number',
      canonical: (ops, { engine: ce }) => {
        const f = ops[0]?.canonical;
        if (!f) return null;
        let x = ops[1];
        // The expansion variable may be omitted (`Series(expr)`, e.g. from
        // `expr |> Series`): default to the expression's single free
        // variable, or to `x` when there are several and one of them is `x`.
        if (x === undefined) {
          const v = defaultUnknown(f);
          if (v !== undefined) x = ce.symbol(v);
        }
        if (!x || !isSymbol(x)) return null;
        const x0 = ops[2] ? ops[2].canonical : ce.Zero;
        const n = ops[3] ? ops[3].canonical : ce.number(5);
        return ce._fn('Series', [f, x, x0, n]);
      },
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [f, xSym, x0, nExpr] = ops;
        const x = sym(xSym);
        if (!x || !x0) return undefined;
        let n = Math.floor(nExpr?.N().re ?? 5);
        if (!Number.isFinite(n)) n = 5;
        // Inject the limit resolver: series.ts cannot import symbolicLimit
        // (limit.ts imports its laurentData — the 7c pole wiring), so the
        // ±∞ coefficient limits are resolved through this parameter.
        const result = computeSeries(f, x, x0, n, ce, symbolicLimit);
        // No result: leave `Series(...)` unevaluated (deferred singular case).
        if (!result) return undefined;
        // The expansion is an OPEN expression in the expansion variable, which
        // this node binds in its own scope: re-bind it so the result denotes
        // the ambient variable rather than a binding of the frame being popped.
        return rebindEscapingCurrentScope(
          ce,
          numericApproximation ? result.N() : result
        );
      },
    },

    //
    // **BigO**: the inert Landau remainder term.
    //
    // Inert under `evaluate`/`simplify`. `.N()` of any expression containing
    // `BigO` is `NaN` (the remainder is not a concrete value), and `compile()`
    // has no target for it (fails gracefully). Strip it with `Normal`.
    //
    BigO: {
      description:
        'Landau big-O remainder term. Inert; any numeric approximation ' +
        '(.N()) of an expression containing it is NaN.',
      broadcastable: false,
      signature: '(value) -> number',
      evaluate: (_ops, { engine: ce, numericApproximation }) =>
        numericApproximation ? ce.NaN : undefined,
    },

    //
    // **Normal**: strip every `BigO` remainder from a series, yielding the
    // compilable/plottable truncated polynomial (Mathematica-compatible name).
    // Idempotent; a passthrough on `BigO`-free input.
    //
    Normal: {
      description:
        'Strip Big-O remainder terms from a series, yielding the truncated ' +
        'polynomial. Example: Normal(Series(\\sin x, x)) → x - x^3/6 + x^5/120',
      broadcastable: false,
      signature: '(value) -> value',
      // `Normal` is a passthrough that strips `BigO` remainder terms, so the
      // result's honest type is the operand's own type: a truncated series
      // stays numeric, and a non-numeric value (which `normalStrip` returns
      // unchanged) keeps its own type instead of a false `number` claim.
      type: ([x], context) =>
        BoxedType.forResult(x?.type ?? 'value', context.engine._typeResolver),
      evaluate: ([x], { numericApproximation }) => {
        if (!x) return x;
        // Not lazy: the operand (typically a `Series`) is already evaluated.
        const stripped = normalStrip(x);
        return numericApproximation ? stripped.N() : stripped;
      },
    },
  },
];
