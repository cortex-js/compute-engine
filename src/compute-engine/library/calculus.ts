import type {
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
  PureEngineView,
  SymbolDefinitions,
  TypeHandlerContext,
} from '../global-types.js';

import type { Type } from '../../common/type/types.js';
import { functionResult } from '../../common/type/utils.js';
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
  isSymbol,
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
import { BoxedNumber } from '../boxed-expression/boxed-number.js';

import {
  applicable,
  applicableN1,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
  lookupApplicable,
} from '../function-utils.js';
import { monteCarloEstimate } from '../numerics/monte-carlo.js';
import { mixTags } from '../numerics/random.js';
import {
  adaptiveQuadrature,
  initialPanelsForDimensions,
  quadratureBeatsMonteCarlo,
} from '../numerics/gauss-kronrod.js';
import { integrateSemiInfiniteOscillatory } from '../numerics/oscillatory-quadrature.js';
import {
  centeredDiff8thOrder,
  centeredDiffHigherOrder,
  limit,
  LIMIT_PROBE_ITERATION_BUDGET,
} from '../numerics/numeric.js';
import { derivative, differentiate } from '../symbolic/derivative.js';
import {
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
} from '../collection-utils.js';
// Self-registers the `expr.explain('D')` driver (see explain.ts)
import '../symbolic/explain-derivative.js';
import { antiderivative } from '../symbolic/antiderivative.js';
import {
  interiorPoleVerdict,
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
import { symbolicLimit } from '../symbolic/limit.js';
import { residue } from '../symbolic/residue.js';
import { computeSeries, normalStrip } from '../symbolic/series.js';
import { canonicalLimits, canonicalLimitsSequence } from './utils.js';
import { implicitCompile } from '../implicit-compile.js';
import { CancellationError } from '../../common/interruptible.js';

/**
 * The highest order the `D(f, {x, n})` spelling expands into `n` repeated
 * variables. Each order is one differentiation pass, so the work scales
 * with the VALUE of `n`; a larger order stays inert. A dedicated per-file
 * constant, as for the other value-scaled caps.
 */
const MAX_DERIVATIVE_ORDER = 1000;

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
};

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
  // function) at a point the first pass already visited. The cache is
  // bounded: a Monte-Carlo pass can take 10⁷ samples, which must not be
  // retained — past the cap, points are evaluated without caching.
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
  return {
    re: (...args) => at(args)[0],
    im: (...args) => at(args)[1],
    sawImaginary: () => imaginary,
    sawNumeric: () => numeric,
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
    return ce.expr([
      'Measurement',
      ce.number(re.estimate),
      ce.number(re.error),
    ]);
  if (Number.isNaN(im.estimate)) return ce.NaN;
  return ce.expr([
    'Measurement',
    ce.number(ce.complex(re.estimate, im.estimate)),
    ce.number(Math.hypot(re.error, im.error)),
  ]);
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
 */
function nIntegrateMultiple(
  ce: ComputeEngine,
  f: Expression,
  limits: ReadonlyArray<Expression>
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
  const mkBound = (b: Expression, d: number): BoundFn | undefined => {
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
    const c = b.N().re;
    if (isNaN(c)) return undefined;
    return () => c;
  };

  const boundFns: [BoundFn, BoundFn][] = [];
  for (let d = 0; d < limits.length; d++) {
    const l = limits[d];
    if (!isFunction(l)) return undefined;
    const lower = mkBound(l.op2, d);
    const upper = mkBound(l.op3, d);
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
  const body = isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr;
  let verdict: PoleVerdict | undefined;
  for (let d = 0; d < vars.length; d++) {
    const l = limits[d];
    if (!isFunction(l)) continue;
    const dependsOnVars = (e: Expression) =>
      e.symbols.some((name) => vars.includes(name));
    if (dependsOnVars(l.op2) || dependsOnVars(l.op3)) continue;
    const v = interiorPoleVerdict(body, vars[d], l.op2, l.op3, ce);
    if (v === undefined) continue;
    verdict =
      verdict === undefined || verdict.sign === v.sign ? v : { sign: 'mixed' };
  }
  if (verdict !== undefined)
    return verdict.sign === 'positive'
      ? ce.PositiveInfinity
      : verdict.sign === 'negative'
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
  const integrateDim = (dim: number): { estimate: number; error: number } => {
    // Inner-level error accumulated over this level-invocation's quadrature
    // nodes (the recursion is strictly sequential, so plain locals suffice).
    let innerErrSum = 0;
    let innerErrN = 0;
    const g = (t: number): number => {
      argv[slots[dim]] = t;
      outerVals[dim] = t;
      if (dim === last) return jsf(...argv);
      const r = integrateDim(dim + 1);
      if (Number.isFinite(r.error)) {
        innerErrSum += r.error;
        innerErrN++;
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
    // The range factor is only meaningful on a finite interval: over an
    // infinite one it is vacuous (∞ · any inner bound), and would report ±∞ on
    // an otherwise good answer, so such a level propagates nothing extra.
    const span = Math.abs(upper - lower);
    const inflate = (r: {
      estimate: number;
      error: number;
    }): { estimate: number; error: number } => ({
      estimate: r.estimate,
      error:
        r.error +
        (innerErrN && Number.isFinite(span)
          ? (innerErrSum / innerErrN) * span
          : 0),
    });
    // The starting-panel floor multiplies across levels — one full quadrature
    // runs per outer node — so a per-level 16 would cost 16^dimensions. Reduce
    // it so the floor applies to the whole iterated integral, not each level.
    const gk = adaptiveQuadrature(g, lower, upper, {
      initialPanels: initialPanelsForDimensions(limits.length),
      // Item 183: every level of an iterated integral checks the span
      // deadline (per panel) and salvages its partial result — one full
      // inner quadrature runs per outer node, so an unchecked level made
      // the whole nest unboundable by any JS-side budget.
      deadline: ce._deadline,
    });
    if (gk.converged && Number.isFinite(gk.estimate)) return inflate(gk);
    // A level diagnosed as divergent has no finite value: propagate NaN rather
    // than sample it, which would only launder the divergence into a
    // plausible-looking number (and make every outer node pay for it).
    if (gk.divergent) return { estimate: NaN, error: NaN };
    // A stalled level whose error bound already beats the sampler keeps its
    // quadrature result: sampling it would be both less accurate and, since
    // every inner level re-runs per outer node, far more expensive.
    if (quadratureBeatsMonteCarlo(gk, 1e4)) return inflate(gk);
    return inflate(
      monteCarloEstimate(g, lower, upper, 1e4, ce._deadline, draw)
    );
  };

  // The reported uncertainty is the outermost level's error estimate, inflated
  // by the propagated inner-level error (see `inflate` above).
  const r = integrateDim(0);
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
    | { _isLambda?: boolean; _lambdaLiteral?: Expression }
    | undefined;
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
  } catch {
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
  } catch {
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
      return `_SYS.nd(${compile(rewriteAngularUnit(fn))}, 1)(${compile(v)})`;
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
      return `_SYS.nd(${compile(rewriteAngularUnit(lit))}, ${order})`;
    }

    // `ND` — previously compilable only when the point was numeric at
    // compile time (the evaluate handler ran the stencil then); a runtime
    // point now lowers to the same stencil evaluated at run time.
    if (args.length !== 2) return undefined;
    return `_SYS.nd(${compile(rewriteAngularUnit(lit))}, 1)(${compile(args[1])})`;
  } catch {
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
 * The INTERPRETED half of the item-177 numeric-derivative fallback: given an
 * `Apply(Derivative(f, order?), x)` that stayed symbolic because no closed
 * form was found (the differentiation growth budget, or an unresolvable
 * head), compute the same stencil the compiled target emits
 * (`centeredDiffHigherOrder` — one shared function, so the two routes agree
 * bit-for-bit). Returns `undefined` — leaving the expression symbolic — when
 * the shape is not the univariate pure single-point case, mirroring
 * `compileNumericDerivativeFallback`'s gates.
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

  // Same evaluation vehicle as `ND`'s evaluate handler: the compiled literal
  // where JIT is available, the interpreted applier otherwise.
  const compiled = implicitCompile(ce, lit);
  const fn = (compiled?.run as (x: number) => number) ?? applicableN1(lit);
  const v = centeredDiffHigherOrder(fn, x, order);
  if (Number.isNaN(v)) return undefined;
  // Machine arithmetic throughout (the stencil runs compiled JS), so box a
  // machine number directly — same rationale as `ND`'s evaluate handler.
  return new BoxedNumber(ce, v);
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
          return engine.type(t!);
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
            return engine.type(valueType);
        }
        // Neither the declaration nor a held value says what the function
        // returns (e.g. a symbol declared plain `function` and never
        // assigned, whose type is `(any*) -> any`). Its derivative is still
        // scalar-valued in the overwhelmingly common case, so report a
        // number-valued function — the same compromise as the `D` type
        // handler below — rather than passing the `any` through, which would
        // type applications as `any`.
        return engine.type('(any*) -> number');
      },
      canonical: (ops, { engine }) => {
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
        const orders = ops.slice(1).map((o) => Math.floor(o.N().re));
        // An order that is not a number yet (`Derivative(f, n)` with `n`
        // unassigned) has no closed form: stay inert. Reading it as 1 silently
        // made `f^{(n)}` the FIRST derivative.
        if (orders.some((n) => !Number.isFinite(n))) return undefined;
        // Differentiating zero times in every position is the function
        // itself — univariate `Derivative(g, 0)` and multi-index
        // `Derivative(g, 0, 0)` alike. Left to the lifting below, a head that
        // is not already a `Function` literal (a bare symbol, or an
        // operator-defined name such as `Sin`) came back as the constant
        // function returning that head (`Derivative(g, 0)` → `(x) ↦ g`): the
        // order-0 "derivative" is the head itself, which the univariate arm
        // then re-parameterized over its value's parameters.
        if (orders.length >= 1 && orders.every((n) => n === 0)) return op;

        // Univariate (bare or single order): ordinary n-th derivative.
        //
        // The closed-form result is lifted into a *named-parameter* `Function`
        // literal (P1-19c): a bare hole-form (`cos(_)`) typed `number`,
        // so a stored `let g = Derivative(f)` was not callable. The historical
        // blockers are addressed by construction:
        // - a result still carrying a `Derivative` stays bare — wrapping it
        //   would re-enter this handler when the body evaluates;
        // - the hole is renamed to a real parameter, so no `_` reaches the
        //   serializers (the `()\mapsto…` mis-rendering) or the
        //   `denotesFunction` wildcard gate.
        if (orders.length <= 1) {
          const r = derivative(op, orders[0] ?? 1);
          if (r === undefined) return undefined;
          // Order 0 (or an already-lifted result) is the function itself.
          if (isFunction(r, 'Function')) return r;
          if (r.operator === 'Derivative' || r.has('Derivative')) return r;

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
          const param = ce.symbol(name);
          return ce.function('Function', [r.subs({ _: param }), param]);
        }

        // Multi-index: mixed partial of a multivariate function. For a known
        // function literal, differentiate the body the requested number of
        // times with respect to each parameter; otherwise stay symbolic.
        // A symbol bound to a function literal is differentiated through
        // that literal, as the univariate arm does inside `derivative()`;
        // the literal is what carries the named parameters the multi-index
        // refers to. Without this, `Derivative(g, 1, 0)` stayed inert for an
        // assigned bivariate `g` while `Derivative(g, 1)` evaluated.
        const literal = isSymbol(op) ? functionLiteralOf(ce, op.symbol) : op;
        if (isFunction(literal, 'Function')) {
          const params = literal.ops
            .slice(1)
            .map((p) => functionLiteralParameterName(p));
          if (params.length === orders.length && params.every((p) => !!p)) {
            let body: Expression | undefined = literal.op1;
            for (let i = 0; i < orders.length && body; i++)
              for (let d = 0; d < orders[i] && body; d++)
                body = differentiate(body, params[i]!);
            // `ce.function()` (not `_fn`): the canonical handler wraps the
            // body in the scoped Block that `makeLambda` requires — a bare
            // `_fn` literal throws on application.
            if (body)
              return ce.function('Function', [body, ...literal.ops.slice(1)]);
          }
        }

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
        if (isSubtype(t, 'number')) return t;
        // A numeric TUPLE or COLLECTION body differentiates component-wise and
        // the result keeps that shape: `D((cos t, sin 2t, t), t)` evaluates to
        // `(-sin t, 2cos 2t, 1)`, and `D([cos t, sin t], t)` to a list. The
        // scalar fallback below claimed `number` for both, so the declared
        // type contradicted the value the same handler produced, and a
        // type-strict consumer (`Cross`, `Dot`) rejected the derivative of a
        // parametric curve outright (Tycho item 210). Echoing the body's type
        // follows the same tier convention as the numeric branch above.
        if (typeCouldBeNumericTuple(t) || typeCouldBeNumericCollection(t))
          return t;
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
        return engine.type('number');
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
      signature: '(function, at:number) -> number',
      canonical: (ops, { engine }) => {
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        const x = checkType(engine, ops[1]?.canonical, 'number');
        return engine._fn('ND', [fn, x]);
      },
      evaluate: ([body, x], { engine }) => {
        // ND uses compiled JS functions (machine arithmetic), so box
        // the result directly as a machine number to avoid wrapping
        // in BigDecimal at higher engine precisions.
        const xValue = x.N().re;
        if (isNaN(xValue)) return undefined;

        const compiled = implicitCompile(engine, body);
        const fn =
          (compiled?.run as (x: number) => number) ?? applicableN1(body);
        return new BoxedNumber(engine, centeredDiff8thOrder(fn, xValue));
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
          return 'matrix';
        const denoted = denotedTypeOf(fs, context);
        if (isSubtype(denoted, JACOBIAN_LIST_SHAPE_TYPE)) return 'matrix';
        if (isSubtype(denoted, 'number')) return 'vector';
        return 'value';
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
      description: 'Contour (closed-path) integral. Inert: never evaluated.',
      keywords: ['contour integral', 'closed integral', 'line integral'],
      broadcastable: false,

      lazy: true,
      signature: '(function, limits+) -> number',

      // `CircularIntegrate` carries no contour-integration machinery: the
      // integrand is left as the bare application it was parsed as (not wrapped
      // in a `Function` literal the way `Integrate` does), so it round-trips to
      // the same LaTeX. The canonical handler exists to (a) rewrite the limits
      // that `parseIntegral` builds as `Tuple`s into `Limits` expressions, so a
      // limits-consuming caller sees the same shape as `Integrate` (the `Tuple`
      // uses the symbol `Nothing` as a *positional* placeholder for an absent
      // index/bound), and (b) give the operator a `number` type.
      canonical: (ops, { engine: ce }) => {
        if (!ops[0]) return null;
        const limits = canonicalLimitsSequence(ops.slice(1), { engine: ce });
        return ce._fn('CircularIntegrate', [ops[0].canonical, ...limits]);
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
      signature: '(function, limits+) -> number',
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

        const f = canonicalFunctionLiteral(
          ops[0],
          vars.length > 0 ? { params: vars } : undefined
        );
        if (!f) return null;

        return ce._fn('Integrate', [f, ...limits]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
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

          // Multiple limits (`Integrate(f, Limits(x,…), Limits(y,…))`):
          // iterated quadrature over every limit. The single-limit path below
          // reads only `ops[1]` and would silently drop the other dimensions.
          if (ops.length > 2) return nIntegrateMultiple(ce, f, ops.slice(1));

          const firstLimit = ops[1];
          if (!isFunction(firstLimit)) return undefined;
          const [lower, upper] = [firstLimit.op2.N().re, firstLimit.op3.N().re];
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
          // `nIntegrateMultiple`.
          const pole = interiorPoleVerdict(
            isFunction(fnExpr, 'Function') ? fnExpr.op1 : fnExpr,
            variable,
            lower,
            upper,
            ce
          );
          if (pole !== undefined)
            return pole.sign === 'positive'
              ? ce.PositiveInfinity
              : pole.sign === 'negative'
                ? ce.NegativeInfinity
                : ce.NaN;

          const compiled = implicitCompile(ce, fnExpr);
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
          const integrateReal = (
            jsf: (x: number) => number
          ): { estimate: number; error: number } => {
            // Semi-infinite interval: a conditionally-convergent oscillatory
            // integrand (∫₀^∞ sin x/x, ∫₀^∞ sin(x²)) defeats Monte-Carlo
            // importance sampling. Try the dedicated lobe-integration +
            // ε-acceleration quadrature first; it returns null (→ Monte Carlo)
            // for non-oscillatory or divergent integrands.
            const aInf = !isFinite(lower);
            const bInf = !isFinite(upper);
            if (aInf !== bInf) {
              const osc = bInf
                ? integrateSemiInfiniteOscillatory(jsf, lower, ce._deadline)
                : integrateSemiInfiniteOscillatory(
                    (t) => jsf(-t),
                    -upper,
                    ce._deadline
                  );
              if (osc) return { estimate: osc.estimate, error: osc.error };
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
            if (compiled?.success) {
              // `deadline`: bounds the adaptive loop (per-panel check, partial
              // salvage) AND is re-published as the ambient deadline so an
              // integrand that is itself an integral — interpreted, or compiled
              // to `_SYS.integrate`, which has no engine access — inherits it
              // (Tycho item 183).
              const gk = adaptiveQuadrature(jsf, lower, upper, {
                deadline: ce._deadline,
              });
              // A diagnosed divergence has no finite value. Monte Carlo would
              // still return one — a mean of samples that never saw the
              // singularity — so the fallback is skipped, not just the report.
              if (gk.divergent) return { estimate: NaN, error: NaN };
              if (
                (gk.converged || quadratureBeatsMonteCarlo(gk, 1e7)) &&
                Number.isFinite(gk.estimate)
              )
                return { estimate: gk.estimate, error: gk.error };
            }

            const mce = monteCarloEstimate(
              jsf,
              lower,
              upper,
              compiled?.success ? 1e7 : 1e4,
              ce._deadline,
              draw
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
          };

          const re = integrateReal(integrand.re);
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

        // The integration variable(s) are bound by `Integrate`: a same-named
        // global assignment (`x := 5`) must not substitute into the
        // antiderivative computation or its result. Shield them for the whole
        // symbolic pass so `∫ x² dx` stays `x³/3` (not `125/3`) and
        // `∫₀¹ x² dx` is `1/3` (not `0`). The names come from the limits and,
        // as a fallback, the integrand function-literal's parameters.
        const intVarNames: string[] = [];
        for (const l of limitsSequence)
          if (isFunction(l)) {
            const v = sym(l.op1);
            if (v && v !== 'Nothing') intVarNames.push(v);
          }
        if (isFunction(ops[0]))
          for (const p of ops[0].ops.slice(1)) {
            const n = sym(p);
            if (n) intVarNames.push(n);
          }

        const result = withValueShield(ce, intVarNames, () => {
          let expr = ops[0];
          const argNames = isFunction(expr)
            ? expr.ops.slice(1).map((x) => sym(x))
            : [];

          let isIndefinite = true;
          for (let i = limitsSequence.length - 1; i >= 0; i--) {
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
            const integrand = liftIntegrand(expr);
            if (ce._integrationProvider) {
              try {
                antideriv = ce._integrationProvider(integrand, variable);
              } catch (e) {
                // A cancellation (deadline/interrupt) thrown inside the provider
                // must propagate — swallowing it would turn a timeout into a
                // silent fall-through to the built-in antiderivative.
                if (e instanceof CancellationError) throw e;
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
            } else if (antideriv.has('Integrate')) {
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
              isIndefinite = false;
              expr = ce.function('Integrate', [
                expr,
                ce.function('Limits', [ce.symbol(variable), lower, upper]),
              ]);
            } else if (
              (pole = interiorPoleVerdict(
                integrand,
                variable,
                lower,
                upper,
                ce
              ))
            ) {
              // The integrand is unbounded at a point STRICTLY INSIDE the
              // bounds, so the fundamental theorem of calculus does not apply
              // and the integral diverges. Differencing the antiderivative
              // anyway would report a finite value for a divergent integral
              // (∫₋₁¹ dt/t → 0, ∫₋₁¹ dt/t² → −2). When the integrand keeps one
              // sign on both sides of every pole the integral diverges to that
              // infinity (∫₋₁¹ dt/t² → +∞, as ∫₀¹ dt/t → +∞ already does);
              // when it changes sign the integral has no value, not even an
              // infinite one, and stays inert, as the "antiderivative not
              // fully found" arm above does. `interiorPoleVerdict` only
              // answers for a proven pole, so a correct closed form is never
              // lost this way.
              isIndefinite = false;
              expr =
                pole.sign === 'positive'
                  ? ce.PositiveInfinity
                  : pole.sign === 'negative'
                    ? ce.NegativeInfinity
                    : ce.function('Integrate', [
                        expr,
                        ce.function('Limits', [
                          ce.symbol(variable),
                          lower,
                          upper,
                        ]),
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
              // A NaN result is an unresolved indeterminate, not a leak-free
              // value — fail closed (inert) rather than leak the NaN.
              const resolved =
                raw.isNaN === true ? null : resolveEndpointLeaks(raw, ce);
              if (resolved !== null && isSymbol(resolved.guard, 'True')) {
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
      signature: '(function, limits:(tuple|symbol)?) -> number',
      canonical: (ops, { engine }) => {
        const [body, lower, upper] = ops;
        const fn = canonicalFunctionLiteral(body);
        // @todo: normalizeIndexingSet() ?
        if (!fn) return null;
        if (!lower || !upper) return null;
        return engine._fn('NIntegrate', [fn, lower.canonical, upper.canonical]);
      },
      evaluate: ([f, a, b], { engine }) => {
        // Uses compiled JS functions (machine arithmetic)
        const [lower, upper] = [a.N().re, b.N().re];
        if (isNaN(lower) || isNaN(upper)) return undefined;
        const compiled = implicitCompile(engine, f);
        // The integrand may be complex-valued: integrate its real part, and
        // its imaginary part too when a sample carried one (see
        // `numericIntegrandParts` and the `Integrate` numeric path).
        const raw: (x: number) => unknown = compiled?.success
          ? (compiled.run as (x: number) => unknown)
          : (
              (app) => (x: number) =>
                app([engine.number(x)])
            )(applicable(f));
        const integrand = numericIntegrandParts(raw);
        // One stream for both passes (see the `Integrate` numeric path).
        const draw = engine._substream(mixTags(f.hash, a.hash, b.hash));

        const estimate = (jsf: (x: number) => number): number => {
          // Dedicated oscillatory quadrature for semi-infinite intervals (see
          // the `Integrate` numeric path); null → fall back to Monte Carlo.
          const aInf = !isFinite(lower);
          const bInf = !isFinite(upper);
          if (aInf !== bInf) {
            const osc = bInf
              ? integrateSemiInfiniteOscillatory(jsf, lower, engine._deadline)
              : integrateSemiInfiniteOscillatory(
                  (t) => jsf(-t),
                  -upper,
                  engine._deadline
                );
            if (osc) return osc.estimate;
          }
          return monteCarloEstimate(
            jsf,
            lower,
            upper,
            compiled?.success ? 1e7 : 1e4,
            engine._deadline,
            draw
          ).estimate;
        };

        const re = estimate(integrand.re);
        if (!integrand.sawImaginary()) return new BoxedNumber(engine, re);
        return engine.number(engine.complex(re, estimate(integrand.im)));
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
        return Number.isFinite(value) ? engine.number(value) : undefined;
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
          const target = x.N().re;
          if (Number.isNaN(target)) return undefined;
          const compiled = implicitCompile(engine, f, {
            iterationBudget: LIMIT_PROBE_ITERATION_BUDGET,
          });
          const fn =
            (compiled?.run as (x: number) => number) ?? applicableN1(f);
          return new BoxedNumber(
            engine,
            limit(fn, target, dir ? dir.re : 1, engine._deadline)
          );
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
        const target = x.N().re;
        if (Number.isNaN(target)) return undefined;
        const compiled = implicitCompile(engine, f, {
          iterationBudget: LIMIT_PROBE_ITERATION_BUDGET,
        });
        const fn = (compiled?.run as (x: number) => number) ?? applicableN1(f);
        return new BoxedNumber(
          engine,
          limit(fn, target, dir ? dir.re : 1, engine._deadline)
        );
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
      type: ([x]) => x?.type ?? 'value',
      evaluate: ([x], { numericApproximation }) => {
        if (!x) return x;
        // Not lazy: the operand (typically a `Series`) is already evaluated.
        const stripped = normalStrip(x);
        return numericApproximation ? stripped.N() : stripped;
      },
    },
  },
];
