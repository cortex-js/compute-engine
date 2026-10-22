/**
 * Shared lowering for the `FindFit` and `FindRoot` operators onto the
 * pure-number Levenberg–Marquardt core (`numerics/levenberg-marquardt.ts`).
 *
 * Both operators are numeric (`evaluate()` computes floats; no symbolic
 * residue) and both are `lazy` so a document value seeded onto a parameter
 * symbol is NOT substituted before we get here: model/params/vars stay held,
 * and numeric values are threaded in through compiled functions (or `subs`),
 * never by reading engine symbol values.
 *
 * The residual and each Jacobian column are prepared once per call: the model
 * is renamed to fresh, guaranteed-unbound symbols (so the JIT treats them as
 * inputs rather than inlining a seeded value), compiled through the implicit
 * JIT path where possible (interpreted `subs` fallback otherwise), and
 * differentiated analytically via `differentiate()` — a column that fails to
 * differentiate symbolically falls back to a forward finite difference.
 */

import {
  CancellationError,
  checkDeadline,
  isTimeoutCancellation,
  type DeadlineFrame,
} from '../common/interruptible.js';

import type {
  EvaluateOptions,
  Expression,
  IComputeEngine,
} from './global-types.js';
import { runWithEvaluationEffects } from './effects-registry.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isSymbol,
} from './boxed-expression/type-guards.js';
import { numberLiteralOf } from './boxed-expression/numerics.js';
import { differentiate } from './symbolic/derivative.js';
import { angularChainFactor } from './symbolic/angular-unit.js';
import { implicitCompileNumericResult } from './implicit-compile.js';
import {
  levenbergMarquardt,
  type LMOptions,
  type LMResult,
} from './numerics/levenberg-marquardt.js';
import {
  InlineFitExecutor,
  PoolFitExecutor,
  runFitPlanAsync,
  runFitPlanSync,
  type FitBatchResult,
  type FitKernel,
  type FitTask,
  type StartTask,
} from './fit-executor.js';
import {
  linearScanSolve,
  sumOfSquares,
  wrapPhase,
  type FitScanProblem,
  type FitScanRows,
} from './fit-scan.js';
import { fitSlicePool, isShippableCode } from './kernel-pool.js';
import type { StoredKernel, WireFitProblem } from './kernel-protocol.js';

type NumFn = (vars: Record<string, number>) => number;

interface ParamSpec {
  name: string;
  start: number;
  lo: number;
  hi: number;
}

/**
 * A parameter that the `global` option of `FindFit` searches over a closed
 * range instead of from a single start (Tycho row 404). `lo`/`hi` are the
 * range already intersected with the parameter's own box constraint.
 */
interface GlobalScan {
  /** Index of the parameter in the spec list. */
  index: number;
  lo: number;
  hi: number;
  /** The grid step the caller gave as the third element of the range,
   * `b: [lo, hi, step]`. It wins over the automatic spacing. */
  step?: number;
}

/**
 * A parameter that scales the phase of a periodic function across the data:
 * the argument of a `Sin`, `Cos`, `Tan`, `Cot`, `Sec` or `Csc` node changes
 * by `rate · b_j` per unit of the variable `x_k` (`rate` is the mixed
 * derivative of the argument with respect to `x_k` and `b_j`, a nonzero
 * constant, converted to radians). Two values of `b_j` that differ by more
 * than about `(period / 2) / (|rate| · span of x_k)` are half a period apart
 * at the far end of the data, so that is the width of a basin of the
 * residual in `b_j`.
 */
interface PeriodicRate {
  /** Index of the parameter. */
  param: number;
  /** Index of the fit variable, or −1 for a constant rate: the unit is an
   * equation of a `FindRoot` system, which has no variable, and `rate` is
   * the derivative of the argument with respect to the parameter itself
   * (`3.22` for `cos(3.22 b + c)`). The equations of a system play the
   * part of the rows of a fit, so `basinWidth` reads the span of these
   * constants over the units as it reads the span of a variable over the
   * rows. */
  variable: number;
  /** In radians per unit of the parameter and of the variable: the
   * derivative of the argument multiplied by the factor that converts the
   * engine's angular unit to radians. */
  rate: number;
  /** The period in radians, in the argument, of the expression that the
   * function node is part of (`composedPeriod()`): π for `Tan` and `Cot`,
   * 2π for the others, and less for a node in a product or a power of
   * periodic functions of the same argument or in an absolute value
   * (π for `cos(θ)²`, `|cos(θ)|` and `sin(θ) cos(θ)`). */
  period: number;
}

/**
 * A parameter `c` that is only an additive term of the argument of one `Sin`
 * or `Cos` node, `g(B + rate · c)`, where the node is a factor of a product
 * that also has the parameter `a` as a factor, and neither `a` nor `c`
 * appears anywhere else in the model. Then
 * `a · g(B + rate · c) = p · g(B) + q · g(B + π/2)` with `p = a cos(rate · c)`
 * and `q = a sin(rate · c)`, so when the model is linear in `a` the pair
 * `(a, c)` is linear in `(p, q)` and the global scan can solve `c` by least
 * squares instead of sampling it on a grid.
 */
interface PhaseShape {
  /** Index of the amplitude parameter `a`. */
  amplitude: number;
  /** Index of the phase parameter `c`. */
  phase: number;
  /** The constant derivative of the node's argument with respect to `c`,
   * in radians per unit of `c` (converted from the engine's angular unit,
   * as for `PeriodicRate`). */
  rate: number;
}

interface DataRow {
  x: number[];
  y: number;
}

/** One model expression paired with its dataset (FindFit) or one equation
 * residual with a single zero-target row (FindRoot). */
interface FitUnit {
  fn: NumFn;
  /** Analytic derivative per parameter, or `null` to use finite differences. */
  deriv: (NumFn | null)[];
  /** The stored compiled code of `fn`, when it compiled to code that can
   * run on a kernel worker (`storedKernel`); `undefined` otherwise (an
   * interpreted fallback, or code that reads the engine's random stream). */
  stored: StoredKernel | undefined;
  /** The same, per analytic derivative of `deriv`. */
  derivStored: (StoredKernel | undefined)[];
  /**
   * The free symbols (fresh names) of each analytic derivative, or `null`
   * when the column uses finite differences. The global fit reads them to
   * decide whether the model is linear in a parameter: it is when the
   * derivative with respect to that parameter mentions none of the parameters
   * that must be solved linearly.
   */
  derivUnknowns: (ReadonlySet<string> | null)[];
  /**
   * Per parameter: the model mentions the parameter but its analytic
   * derivative is the literal zero. That is the signature of a step function
   * of the parameter (`Floor(a)`, `Sign(a)`, a parameter that appears only in
   * the condition of a piecewise): the derivative test alone would call the
   * model linear in it. The global fit never treats such a parameter as
   * linear.
   */
  stepLike: boolean[];
  rows: DataRow[];
  varFresh: string[];
  /** Per parameter: the model mentions it. Computed only for a global fit
   * (empty otherwise). */
  mentions: boolean[];
  /** The phase rates of the parameters in periodic functions of the fit
   * variables. Computed only for a global fit (empty otherwise). */
  periodicRates: PeriodicRate[];
  /** The amplitude–phase pairs of the model. Computed only for a global fit
   * (empty otherwise). */
  phaseShapes: PhaseShape[];
}

//
// Argument parsing
//

/** Elements of a list/set/delimiter container, or a single-element list for a
 * bare item. Returns `null` if the shape is unusable. */
function containerElements(expr: Expression): Expression[] | null {
  if (isSymbol(expr)) return [expr];
  if (isFunction(expr)) {
    const op = expr.operator;
    if (op === 'List' || op === 'Set') return [...expr.ops];
    if (op === 'Delimiter') {
      const inner = expr.op1;
      if (isFunction(inner) && inner.operator === 'Sequence')
        return [...inner.ops];
      return [inner];
    }
  }
  return null;
}

/** Flatten one parameter-spec expression into its ordered parts (name, then
 * optional start/lo/hi). */
function specParts(spec: Expression): Expression[] | null {
  if (isSymbol(spec)) return [spec];
  if (isFunction(spec)) {
    const op = spec.operator;
    if (op === 'Tuple' || op === 'List' || op === 'Sequence')
      return [...spec.ops];
    if (op === 'Delimiter') {
      const inner = spec.op1;
      if (isFunction(inner) && inner.operator === 'Sequence')
        return [...inner.ops];
      return [inner];
    }
  }
  return null;
}

/** Real part of `expr.N()` when the value is real (zero imaginary part),
 * otherwise `NaN`. A nonzero imaginary component is a domain escape for every
 * solver input (starts, bounds, data), so it is surfaced as `NaN` rather than
 * silently truncated to its real part. */
function realValue(expr: Expression): number {
  const v = numberLiteralOf(expr);
  return v?.im === 0 ? v.re : NaN;
}

/** Parse the parameter-spec list. Returns the specs, `'error'` for a malformed
 * spec (e.g. the deliberately-rejected 3-tuple), or `null` if the container is
 * not a spec list at all. */
function parseParamSpecs(paramsExpr: Expression): ParamSpec[] | 'error' | null {
  const specs = containerElements(paramsExpr);
  if (!specs || specs.length === 0) return null;

  const result: ParamSpec[] = [];
  for (const spec of specs) {
    const parts = specParts(spec);
    if (!parts || parts.length === 0) return 'error';
    const nameExpr = parts[0];
    if (!isSymbol(nameExpr)) return 'error';
    const name = nameExpr.symbol;

    let start = 1;
    let lo = -Infinity;
    let hi = Infinity;
    if (parts.length === 1) {
      // bare symbol: start 1, unbounded
    } else if (parts.length === 2) {
      start = realValue(parts[1]);
    } else if (parts.length === 4) {
      start = realValue(parts[1]);
      lo = realValue(parts[2]);
      hi = realValue(parts[3]);
    } else {
      // 3-tuple (and anything longer) is deliberately not accepted (§ 8.4).
      return 'error';
    }
    // A non-real input surfaces as `NaN` from `realValue`. The start must be
    // finite; infinities are permitted only as one-sided bounds.
    if (Number.isNaN(start) || Number.isNaN(lo) || Number.isNaN(hi))
      return 'error';
    if (!Number.isFinite(start)) return 'error';
    if (lo > hi) return 'error';
    result.push({ name, start, lo, hi });
  }
  return result;
}

/** Variable symbol names from a symbol or list of symbols. */
function parseVars(varsExpr: Expression): string[] | null {
  if (isSymbol(varsExpr)) return [varsExpr.symbol];
  if (isFunction(varsExpr, 'List')) {
    const names: string[] = [];
    for (const v of varsExpr.ops) {
      if (!isSymbol(v)) return null;
      names.push(v.symbol);
    }
    return names.length > 0 ? names : null;
  }
  return null;
}

/** The limit on the number of globally searched parameters: a grid over three
 * or more dimensions is too costly for the scan this file runs. */
const MAX_GLOBAL_SCANS = 2;

/** The operator a lowering runs for, which names it in its error messages. */
type FitOperator = 'FindFit' | 'FindRoot';

/**
 * Parse the options dictionary: the optional fifth argument of `FindFit`,
 * the optional third of `FindRoot` (`operator` names the one the message of
 * an error reports).
 *
 * The only option today is `global`: a dictionary that maps a parameter name
 * to a closed range `(lo, hi)`, or `(lo, hi, step)` with a finite positive
 * grid step. Each named parameter is searched over that range for the lowest
 * sum of squared residuals, instead of from its single start (see
 * `solveGlobal`). At most two parameters can be named. The range is
 * intersected with the parameter's own box constraint when the spec has one.
 *
 * A step on a phase that the scan could otherwise solve by least squares
 * (`c` in `a cos(b x + c)`, see `linearPhases`) keeps that phase on the grid:
 * the caller asked for a grid over it. Two caller-given steps on the grid of
 * the separable scan must not ask for more than `SEPARABLE_BUDGET` points
 * together; `solveGlobal` checks that on the grid it builds (a multi-start
 * keeps its coarse grid whatever the steps, so it is never over the budget).
 *
 * Returns the scans (an empty list when nothing is searched globally), or an
 * `unexpected-argument` error for a malformed option. The options argument is
 * strict: an unknown key or a name that is not a parameter is an error, not
 * silently ignored, so that a typo cannot turn a global fit into a local one.
 */
function parseFitOptions(
  ce: IComputeEngine,
  optionsExpr: Expression | undefined,
  specs: ParamSpec[],
  operator: FitOperator
): GlobalScan[] | Expression {
  if (optionsExpr === undefined) return [];
  const fail = (msg: string) =>
    ce.error('unexpected-argument', `${operator}: ${msg}`);

  const options = optionsExpr.canonical;
  if (!isDictionary(options))
    return fail('the options argument must be a dictionary');

  const scans: GlobalScan[] = [];
  for (const [key, value] of options.entries) {
    if (key !== 'global') return fail(`unknown option "${key}"`);
    if (!isDictionary(value))
      return fail('the "global" option must map parameter names to ranges');
    for (const [name, rangeExpr] of value.entries) {
      const index = specs.findIndex((s) => s.name === name);
      if (index < 0)
        return fail(`"${name}" in the "global" option is not a parameter`);
      if (scans.some((s) => s.index === index))
        return fail(`"${name}" is named twice in the "global" option`);
      // In the MathJSON `dict` spelling a value is JSON data, so the range is
      // written as a two-element array, `b: [0.1, 6]`, which boxes to a
      // `List`; a `Tuple`/`Pair` built with `ce.tuple()` is accepted too. A
      // third element is the grid step, `b: [0.1, 6, 0.05]`.
      const parts = specParts(rangeExpr.canonical);
      if (!parts || (parts.length !== 2 && parts.length !== 3))
        return fail(
          `the global range of "${name}" must be [lo, hi] or [lo, hi, step]`
        );
      const lo = realValue(parts[0]);
      const hi = realValue(parts[1]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi))
        return fail(
          `the global range of "${name}" must be two finite numbers with lo < hi`
        );
      let step: number | undefined;
      if (parts.length === 3) {
        step = realValue(parts[2]);
        if (!Number.isFinite(step) || !(step > 0))
          return fail(
            `the grid step of "${name}" in the "global" option must be a finite positive number`
          );
      }
      const spec = specs[index];
      const scanLo = Math.max(lo, spec.lo);
      const scanHi = Math.min(hi, spec.hi);
      if (!(scanLo < scanHi))
        return fail(
          `the global range of "${name}" does not overlap its bounds`
        );
      scans.push({
        index,
        lo: scanLo,
        hi: scanHi,
        ...(step === undefined ? {} : { step }),
      });
    }
  }
  if (scans.length > MAX_GLOBAL_SCANS)
    return fail(
      `at most ${MAX_GLOBAL_SCANS} parameters can be searched globally`
    );
  return scans;
}

//
// Data extraction
//

/** Extract a single dataset of `(x…, y)` rows. `nvars` is the arity of the
 * independent variables. A plain list of `y` values (only when `nvars === 1`)
 * binds `x = 1, 2, …`. Returns `null` (→ inert) on any non-numeric datum. */
function extractDataset(dataExpr: Expression, nvars: number): DataRow[] | null {
  if (!dataExpr.isFiniteCollection) return null;
  const elements = [...dataExpr.each()] as Expression[];
  if (elements.length === 0) return null;

  const rows: DataRow[] = [];
  const tupleForm = elements[0].isFiniteCollection;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (tupleForm) {
      if (!el.isFiniteCollection) return null;
      const pts = [...el.each()] as Expression[];
      if (pts.length !== nvars + 1) return null;
      const x = pts.slice(0, nvars).map((p) => realValue(p));
      const y = realValue(pts[nvars]);
      if (x.some((v) => !Number.isFinite(v)) || !Number.isFinite(y))
        return null;
      rows.push({ x, y });
    } else {
      if (nvars !== 1) return null;
      const y = realValue(el);
      if (!Number.isFinite(y)) return null;
      rows.push({ x: [i + 1], y });
    }
  }
  return rows;
}

/** Detect the joint form where `dataExpr` is a list of `k` datasets (one per
 * model). Returns the per-model datasets, or `null` to broadcast a single
 * shared dataset. */
function extractDatasetList(
  dataExpr: Expression,
  k: number,
  nvars: number
): DataRow[][] | null {
  if (!isFunction(dataExpr, 'List') || dataExpr.nops !== k) return null;
  // Per-model when every element is itself a dataset: either a collection of
  // point rows (its first element is a tuple/collection), or — for a single
  // independent variable — an all-scalar plain-`y` list (analogous to the
  // plain-`y` branch of `extractDataset`). Without the plain-`y` acceptance a
  // joint fit over per-model y-lists falls through and, at two elements per
  // list, is silently misread as (x, y) rows of a shared dataset.
  for (const el of dataExpr.ops) {
    if (!el.isFiniteCollection) return null;
    const items = [...el.each()] as Expression[];
    if (items.length === 0) return null;
    if (!items[0].isFiniteCollection) {
      // Plain-`y` per-model dataset: only for `nvars === 1`, and only when
      // every element is a scalar (never a mix of scalars and point rows).
      if (nvars !== 1) return null;
      if (items.some((it) => it.isFiniteCollection)) return null;
    }
  }
  const result: DataRow[][] = [];
  for (const el of dataExpr.ops) {
    const ds = extractDataset(el, nvars);
    if (!ds) return null;
    result.push(ds);
  }
  return result;
}

//
// Numeric-function preparation
//

/** Fresh, guaranteed-unbound symbol names avoiding every name in `avoid`. */
function freshNames(
  prefix: string,
  count: number,
  avoid: Set<string>
): string[] {
  let realPrefix = prefix;
  while (
    Array.from({ length: count }, (_, i) => `${realPrefix}${i}`).some((n) =>
      avoid.has(n)
    )
  )
    realPrefix += '_';
  return Array.from({ length: count }, (_, i) => `${realPrefix}${i}`);
}

/** Compile `expr` (whose only free symbols are in `freeNames`) to a numeric
 * function, or fall back to interpreted `subs` + `.N()`. `stored` is the
 * compiled code in the form a kernel worker loads, when there is code a
 * worker can run (`storedKernel`). */
function makeNumericFn(
  ce: IComputeEngine,
  expr: Expression,
  freeNames: string[]
): { fn: NumFn; stored: StoredKernel | undefined } {
  const compiled = implicitCompileNumericResult(ce, expr);
  if (compiled)
    return { fn: compiled.fn, stored: storedKernel(compiled.result) };
  const fn = (vars: Record<string, number>) => {
    const sub: Record<string, Expression> = {};
    for (const name of freeNames) sub[name] = ce.number(vars[name] ?? NaN);
    // Match the compiled path (`implicitCompileNumeric`'s projection): a
    // nonzero imaginary part is a domain escape and coerces to NaN, rather
    // than being silently truncated to its real part.
    return realValue(expr.subs(sub));
  };
  return { fn, stored: undefined };
}

/**
 * The stored form of a compilation result that a kernel worker can load and
 * run, or `undefined` when it cannot: a result of another target than
 * `javascript`, a lambda, a result with no `runtimeVersion`, or code that
 * names a helper reading the engine's random stream or entropy handler
 * (`isShippableCode`). The implicit compile of the fit passes no `functions`,
 * `vars` or `preamble` option, so the code names no identifier of the host
 * (the condition `CompileTarget.hostNames` records for `broadcastAsync`).
 */
function storedKernel(
  result: ReturnType<IComputeEngine['_compile']>
): StoredKernel | undefined {
  if (
    result.target !== 'javascript' ||
    result.calling !== 'expression' ||
    result.runtimeVersion === undefined
  )
    return undefined;
  const text = [
    result.preamble,
    result.preambleOnce,
    result.preamblePerCall,
    result.code,
  ].join('\n');
  if (!isShippableCode(text)) return undefined;
  return {
    kind: 'javascript',
    runtimeVersion: result.runtimeVersion,
    code: result.code,
    calling: result.calling,
    preamble: result.preamble,
    preambleOnce: result.preambleOnce,
    preamblePerCall: result.preamblePerCall,
    entryPlan: result.entryPlan,
    reconstructionDigits: result.reconstructionDigits,
  };
}

/**
 * Prepare a single unit: rename var/param symbols to fresh names, verify the
 * renamed model has no unresolved free symbol, then build the model function
 * and its per-parameter derivatives.
 *
 * With `analyzeGlobal` (a `FindFit` with the `global` option), the renamed
 * model is also read for the shapes the global search uses: which
 * parameters it mentions, the phase rates of its periodic functions, and its
 * amplitude–phase pairs (`analyzeGlobalShape`).
 *
 * Returns `undefined` when the model carries an unresolved symbol beyond
 * `vars`/`params` (→ inert per § 3.4).
 */
function prepareUnit(
  ce: IComputeEngine,
  modelExpr: Expression,
  rows: DataRow[],
  varNames: string[],
  varFresh: string[],
  paramNames: string[],
  paramFresh: string[],
  analyzeGlobal = false
): FitUnit | undefined {
  const rename: Record<string, Expression> = {};
  varNames.forEach((n, k) => (rename[n] = ce.symbol(varFresh[k])));
  paramNames.forEach((n, j) => (rename[n] = ce.symbol(paramFresh[j])));

  const renamed = modelExpr.canonical.subs(rename).canonical;

  const allowed = new Set([...varFresh, ...paramFresh]);
  for (const u of renamed.unknowns) if (!allowed.has(u)) return undefined;

  const freeNames = [...varFresh, ...paramFresh];
  const { fn, stored } = makeNumericFn(ce, renamed, freeNames);

  const deriv: (NumFn | null)[] = [];
  const derivStored: (StoredKernel | undefined)[] = [];
  const derivUnknowns: (ReadonlySet<string> | null)[] = [];
  const stepLike: boolean[] = [];
  for (const pf of paramFresh) {
    const d = differentiate(renamed, pf);
    // Fall back to finite differences when the column cannot be differentiated
    // symbolically, or when the derivative is left as an un-evaluable
    // `Derivative(…)` placeholder (e.g. `∂Zeta(b·x)/∂b`).
    // An invalid derivative is a rule that produced a type error (the
    // generic chain rule over an accessor of a point gave a product of a
    // tuple and a number, Tycho row 415): it would compile to a column of
    // NaN that stops the solver at its start, so it takes the finite
    // difference too.
    if (d === undefined || !d.isValid || d.has('Derivative')) {
      deriv.push(null);
      derivStored.push(undefined);
      derivUnknowns.push(null);
      stepLike.push(false);
    } else {
      const column = makeNumericFn(ce, d, freeNames);
      deriv.push(column.fn);
      derivStored.push(column.stored);
      derivUnknowns.push(new Set(d.unknowns));
      // A zero derivative of a parameter the expression mentions is the
      // signature of a step function of it, unless every occurrence is
      // dead: a factor of a product with a literal zero, which
      // canonicalization keeps (`0 · b` is not folded, since a symbol can
      // be infinite). An equation of a `FindRoot` system built from a data
      // row at `x = 0` reads `a cos(0 · b + c) + 0 · d`, and the step-like
      // reading of `b` and `d` turned the separable scan of a global search
      // into the coarse multi-start (Tycho row 408).
      stepLike.push(
        d.isSame(0) && renamed.has(pf) && !occursOnlyUnderZero(renamed, pf)
      );
    }
  }

  const shape = analyzeGlobal
    ? analyzeGlobalShape(renamed, varFresh, paramFresh)
    : { mentions: [], periodicRates: [], phaseShapes: [] };

  return {
    fn,
    deriv,
    stored,
    derivStored,
    derivUnknowns,
    stepLike,
    rows,
    varFresh,
    ...shape,
  };
}

/** The periodic functions whose argument can carry a phase rate. The
 * hyperbolic functions are not periodic over the reals. */
const PERIODIC_FUNCTIONS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

/**
 * True when every occurrence of the symbol `name` in `expr` is dead: inside
 * a product that has a literal zero among its factors (`0 · b`, which
 * canonicalization keeps for a symbol). The expression then does not depend
 * on the symbol, although it mentions it. Vacuously true when the symbol
 * does not occur at all, so a caller tests `expr.has(name)` first.
 */
function occursOnlyUnderZero(expr: Expression, name: string): boolean {
  if (isSymbol(expr)) return expr.symbol !== name;
  if (!isFunction(expr)) return true;
  if (
    expr.operator === 'Multiply' &&
    expr.ops.some((op) => isNumber(op) && op.isSame(0))
  )
    return true;
  return expr.ops.every((op) => occursOnlyUnderZero(op, name));
}

/** Call `visit` on `expr` and on each of its subexpressions, with the
 * ancestors of the subexpression (the outermost first, its parent last). */
function walkExpression(
  expr: Expression,
  visit: (e: Expression, ancestors: readonly Expression[]) => void,
  ancestors: Expression[] = []
): void {
  visit(expr, ancestors);
  if (!isFunction(expr)) return;
  ancestors.push(expr);
  for (const op of expr.ops) walkExpression(op, visit, ancestors);
  ancestors.pop();
}

/** Each periodic function written as `sin(θ)^p · cos(θ)^q`: the pair
 * `[p, q]`. */
const SIN_COS_EXPONENTS = new Map<string, [number, number]>([
  ['Sin', [1, 0]],
  ['Cos', [0, 1]],
  ['Tan', [1, -1]],
  ['Cot', [-1, 1]],
  ['Sec', [0, -1]],
  ['Csc', [-1, 0]],
]);

/** Whether `expr` has a periodic function node whose argument is `arg`. */
function hasPeriodicOf(expr: Expression, arg: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (
    PERIODIC_FUNCTIONS.has(expr.operator) &&
    expr.nops === 1 &&
    expr.op1.isSame(arg)
  )
    return true;
  return expr.ops.some((op) => hasPeriodicOf(op, arg));
}

/**
 * When `expr` is `k · sin(θ)^p · cos(θ)^q` with `θ = arg`, integers `p` and
 * `q`, and a factor `k` that has no periodic function of `θ`: the pair
 * `[p, q]`. `[0, 0]` when `expr` has no periodic function of `θ`, and
 * `undefined` when it has one but is not of that form (`cos(θ) + 1`,
 * `e^{cos(θ)}`, `√cos(θ)`). The six periodic functions, `Negate`, products,
 * quotients, integer powers and `Square` keep the form.
 */
function sinCosExponents(
  expr: Expression,
  arg: Expression
): [number, number] | undefined {
  if (!hasPeriodicOf(expr, arg)) return [0, 0];
  if (!isFunction(expr)) return undefined;
  const own = SIN_COS_EXPONENTS.get(expr.operator);
  if (own !== undefined && expr.nops === 1 && expr.op1.isSame(arg)) return own;
  switch (expr.operator) {
    case 'Negate':
      return expr.nops === 1 ? sinCosExponents(expr.op1, arg) : undefined;
    case 'Multiply':
    case 'Divide': {
      // The operands of a quotient after the first are divisors.
      let p = 0;
      let q = 0;
      for (const [i, op] of expr.ops.entries()) {
        const e = sinCosExponents(op, arg);
        if (e === undefined) return undefined;
        const sign = expr.operator === 'Divide' && i > 0 ? -1 : 1;
        p += sign * e[0];
        q += sign * e[1];
      }
      return [p, q];
    }
    case 'Power':
    case 'Square': {
      const n = expr.operator === 'Square' ? 2 : realValue(expr.op2);
      if (!Number.isInteger(n)) return undefined;
      const e = sinCosExponents(expr.op1, arg);
      return e === undefined ? undefined : [n * e[0], n * e[1]];
    }
  }
  return undefined;
}

/**
 * The smallest period in `θ` of `M = k · sin(θ)^p · cos(θ)^q` (of `|M|` when
 * `absolute`), or `undefined` when `M` does not depend on `θ` (`p = q = 0`).
 * Moving `θ` by π gives `(−1)^(p+q) · M`, and moving it by π/2 gives
 * `(−1)^q · k · sin(θ)^q · cos(θ)^p`, which is `±M` only when `p = q`. So:
 *
 * - `p = q`: π/2 when `q` is even or for `|M|` (`(sin θ cos θ)²`), π
 *   otherwise (`sin θ cos θ`);
 * - `p ≠ q`: π when `p + q` is even or for `|M|` (`cos θ²`, `tan θ`,
 *   `|cos θ|`), 2π otherwise (`cos θ`, `cos θ³`).
 */
function sinCosPeriod(
  [p, q]: [number, number],
  absolute: boolean
): number | undefined {
  if (p === 0 && q === 0) return undefined;
  if (p === q) return absolute || q % 2 === 0 ? Math.PI / 2 : Math.PI;
  return absolute || (p + q) % 2 === 0 ? Math.PI : 2 * Math.PI;
}

/**
 * The period, in its argument `θ`, of the expression that a periodic function
 * node `node` is part of: the smallest period over the node and those of its
 * ancestors, read from the node up, that have the form
 * `k · sin(θ)^p · cos(θ)^q` (`sinCosExponents()`, `sinCosPeriod()`), and
 * over an `Abs` of such an ancestor. The reading stops at the first ancestor
 * that does not have that form (a sum, an exponential, a non-integer power).
 *
 * The node alone gives the period of its function: π for `Tan` and `Cot`, 2π
 * for the others. An ancestor can have a shorter period: `cos(θ)²`,
 * `|cos(θ)|`, `sin(θ) cos(θ)`, `sin(θ) / cos(θ)` have the period π and
 * `(sin(θ) cos(θ))²` has π/2, while `tan(θ)²` keeps π and `cos(θ)³` keeps
 * 2π. The residual of a fit of `a cos(b x + c)²` has basins in `b` half as
 * wide as those of `a cos(b x + c)`, and the grid must be twice as fine.
 */
function composedPeriod(
  node: Expression,
  ancestors: readonly Expression[]
): number {
  if (!isFunction(node)) return 2 * Math.PI;
  const arg = node.op1;
  let period = Infinity;
  let expr: Expression = node;
  for (let i = ancestors.length; ; i--) {
    const e = sinCosExponents(expr, arg);
    if (e === undefined) break;
    period = Math.min(period, sinCosPeriod(e, false) ?? Infinity);
    if (i === 0) break;
    const parent = ancestors[i - 1];
    if (isFunction(parent) && parent.operator === 'Abs') {
      period = Math.min(period, sinCosPeriod(e, true) ?? Infinity);
      break;
    }
    expr = parent;
  }
  return Number.isFinite(period) ? period : 2 * Math.PI;
}

/** The number of occurrences of the symbol `name` in `expr`. */
function countSymbol(expr: Expression, name: string): number {
  if (isSymbol(expr)) return expr.symbol === name ? 1 : 0;
  if (!isFunction(expr)) return 0;
  let count = 0;
  for (const op of expr.ops) count += countSymbol(op, name);
  return count;
}

/** The value of `expr` when it is a nonzero finite real constant, otherwise
 * `undefined`. */
function nonzeroConstant(expr: Expression | undefined): number | undefined {
  if (expr === undefined) return undefined;
  const v = realValue(expr);
  return Number.isFinite(v) && v !== 0 ? v : undefined;
}

/**
 * Read a renamed model (variables and parameters already replaced by their
 * fresh names) for the shapes that the global search of `FindFit` uses:
 *
 * - `mentions`: per parameter, whether the model mentions it.
 * - `periodicRates`: for each `Sin`, `Cos`, `Tan`, `Cot`, `Sec` or `Csc`
 *   node with argument `arg`, each fit variable `x_k` and each parameter
 *   `b_j`, the mixed derivative `∂(∂arg/∂x_k)/∂b_j` when it is a nonzero
 *   constant (`cos(b x + c)` gives 1 for `b`; `cos(b² x)` and `cos(b x y)`
 *   give no constant and record nothing), with the period of the expression
 *   that the node is part of (`composedPeriod()`: π for `cos(θ)²`).
 * - `phaseShapes`: the pairs `(a, c)` of a product that has the parameter `a`
 *   and a `Sin` or `Cos` node as factors, where `c` appears only in the
 *   node's argument, with a constant nonzero derivative, and neither `a` nor
 *   `c` appears anywhere else in the model (see `PhaseShape`).
 *
 * The trigonometric functions read their argument in the engine's angular
 * unit (`ce.angularUnit`), so every rate is multiplied by the factor that
 * converts that unit to radians (`angularChainFactor()`, 1 in radian mode,
 * π/180 in degree mode): the basin widths, the quarter turn and the period
 * of a phase computed from the rates are then correct in every unit.
 *
 * Exported for the tests.
 */
export function analyzeGlobalShape(
  renamed: Expression,
  varFresh: string[],
  paramFresh: string[]
): {
  mentions: boolean[];
  periodicRates: PeriodicRate[];
  phaseShapes: PhaseShape[];
} {
  const counts = paramFresh.map((pf) => countSymbol(renamed, pf));
  const mentions = counts.map((n) => n > 0);
  const periodicRates: PeriodicRate[] = [];
  const phaseShapes: PhaseShape[] = [];
  const toRadians = realValue(angularChainFactor(renamed.engine));
  walkExpression(renamed, (e, ancestors) => {
    if (!isFunction(e)) return;
    if (PERIODIC_FUNCTIONS.has(e.operator) && e.nops === 1) {
      const arg = e.op1;
      const period = composedPeriod(e, ancestors);
      // An equation of a `FindRoot` system has no variable: the argument's
      // derivative with respect to a parameter is itself the constant rate
      // (`PeriodicRate.variable` is −1), `3.22` for `cos(3.22 b + c)`. A
      // zero rate is recorded too (`cos(0 · b + c)`, the equation of a row
      // at `x = 0`): the span of the rates over the equations stands for
      // the span of the variable over the rows, and the row at zero is part
      // of it.
      if (varFresh.length === 0)
        paramFresh.forEach((pf, j) => {
          if (countSymbol(arg, pf) === 0) return;
          const d = differentiate(arg, pf);
          const rate = d === undefined ? NaN : realValue(d);
          if (Number.isFinite(rate))
            periodicRates.push({
              param: j,
              variable: -1,
              rate: rate * toRadians,
              period,
            });
        });
      varFresh.forEach((vf, k) => {
        if (countSymbol(arg, vf) === 0) return;
        const dx = differentiate(arg, vf);
        if (dx === undefined) return;
        paramFresh.forEach((pf, j) => {
          if (countSymbol(dx, pf) === 0) return;
          const rate = nonzeroConstant(differentiate(dx, pf));
          if (rate !== undefined)
            periodicRates.push({
              param: j,
              variable: k,
              rate: rate * toRadians,
              period,
            });
        });
      });
    }
    if (e.operator !== 'Multiply') return;
    for (const node of e.ops) {
      if (!isFunction(node) || node.nops !== 1) continue;
      if (node.operator !== 'Sin' && node.operator !== 'Cos') continue;
      const arg = node.op1;
      paramFresh.forEach((af, a) => {
        // The amplitude is a factor of this product and appears nowhere else.
        if (counts[a] !== 1) return;
        if (!e.ops.some((f) => isSymbol(f) && f.symbol === af)) return;
        paramFresh.forEach((cf, c) => {
          if (c === a || counts[c] === 0) return;
          // The phase appears only in the argument of this node.
          if (countSymbol(arg, cf) !== counts[c]) return;
          const rate = nonzeroConstant(differentiate(arg, cf));
          if (rate === undefined) return;
          // The argument must be affine in the phase: its derivative is a
          // constant, so it is.
          phaseShapes.push({ amplitude: a, phase: c, rate: rate * toRadians });
        });
      });
    }
  });
  return { mentions, periodicRates, phaseShapes };
}

//
// Solve + report
//

const FALSE_ = (ce: IComputeEngine) => ce.symbol('False');
const TRUE_ = (ce: IComputeEngine) => ce.symbol('True');

/**
 * Which phase of the lowering a deadline expired in, reported in band as the
 * `phase` entry of a timed-out record.
 *
 *  - `'setup'`: operand/data evaluation, differentiation, model compilation —
 *    no solve was ever attempted, so there are no fitted values.
 *  - `'solve'`: the starting-point evaluation or the LM iteration, so the
 *    record carries genuine best-so-far parameters.
 */
type FitPhase = 'setup' | 'solve';

/** Build the `Dictionary` result record. */
function buildRecord(
  ce: IComputeEngine,
  paramNames: string[],
  result: LMResult,
  operator: FitOperator,
  phase: FitPhase = 'solve'
): Expression {
  const paramEntries = paramNames.map((name, j) =>
    // A fitted value is a float, even when it is an integer
    ce.tuple(
      ce.string(name),
      ce.number(ce._inexactNumericValue(result.theta[j] + 0))
    )
  );
  const paramsDict = ce.function('Dictionary', paramEntries);
  const entries = [
    ce.tuple(ce.string('parameters'), paramsDict),
    ce.tuple(ce.string('converged'), result.converged ? TRUE_(ce) : FALSE_(ce)),
    ce.tuple(
      ce.string('residualNorm'),
      ce.number(ce._inexactNumericValue(result.residualNorm + 0))
    ),
    ce.tuple(ce.string('iterations'), ce.number(result.iterations)),
  ];
  // `FindRoot` only: `converged` is true only at a root (the residual is
  // within the solver's tolerance, `solverToleranceOf`), while `stationary`
  // is the solver's own stop test, a minimum of the sum of squared residuals
  // that may not be a root (`a² + 1 = 0`, or a stacked system of data rows
  // whose misfit is not zero). The `FindFit` record has no `stationary`
  // key: there `converged` is the stationarity test, or an exact fit (every
  // residual within the same tolerance).
  if (operator === 'FindRoot')
    entries.push(
      ce.tuple(
        ce.string('stationary'),
        result.stationary ? TRUE_(ce) : FALSE_(ce)
      )
    );
  // Present ONLY when the call was cut short by an evaluation deadline
  // (Tycho item 118 + addendum) — the normal-path record is unchanged, so
  // existing consumers see no new key. `phase` says whether anything was
  // fitted at all: `"solve"` carries best-so-far parameters, `"setup"` means
  // the budget expired before the solver ran (empty/starting parameters,
  // `iterations: 0`, NaN residual norm).
  if (result.timedOut) {
    entries.push(ce.tuple(ce.string('timedOut'), TRUE_(ce)));
    entries.push(ce.tuple(ce.string('phase'), ce.string(phase)));
  }
  return ce.function('Dictionary', entries);
}

/**
 * Mutable capture shared with the setup-phase deadline net in `findFit`/
 * `findRoot`: whatever the setup managed to compute before the budget expired,
 * so the in-band timeout record can carry it honestly.
 */
interface SetupContext {
  /** The operator the lowering runs for: it names the record's keys
   * (`buildRecord`) and the error messages. */
  operator: FitOperator;
  /** Parameter specs, once parsed — their starts are the only values we can
   * honestly report when no solve ran. Absent if the deadline fired first. */
  specs?: ParamSpec[];
  /** Set once control passes to `solve`, so a timeout escaping from there is
   * not mislabelled `"setup"`. */
  phase: FitPhase;
}

/**
 * The residual tolerance of the solver for an operator, as the option that
 * carries it: `FindRoot` passes `LMOptions.rootTolerance` and reports
 * `converged` only at a point whose every residual is within the engine's
 * tolerance, scaled by its own equation (Tycho row 414: a minimum of the
 * sum of squares that is not a root, `a² + 1 = 0`, was reported converged).
 * `FindFit` passes `LMOptions.fitTolerance`: its convergence is the solver's
 * stationarity test, since the misfit of the data is not zero at a good
 * fit, or an exact fit, every residual within the same tolerance (Tycho row
 * 418: a degree-10 polynomial through 11 points, exact to rounding, was
 * reported `converged: false` because the stationarity tests cannot pass on
 * a problem scaled that badly).
 */
function solverToleranceOf(
  ce: IComputeEngine,
  operator: FitOperator
): Pick<LMOptions, 'rootTolerance' | 'fitTolerance'> {
  // The solver runs in doubles: the residual at a root carries the rounding
  // of its terms, so a tolerance below what doubles resolve could never be
  // met (an engine tolerance of 1e-30 is allowed), and every root solve
  // would report `converged: false`.
  const tolerance = Math.max(ce.tolerance, ROOT_TOLERANCE_FLOOR);
  return operator === 'FindRoot'
    ? { rootTolerance: tolerance }
    : { fitTolerance: tolerance };
}

/** The smallest solver tolerance (see `solverToleranceOf`): 64 machine
 * epsilons, about 1.4e-14. */
const ROOT_TOLERANCE_FLOOR = 64 * Number.EPSILON;

/** In-band record for a deadline that expired during the SETUP phase (Tycho
 * item 118 addendum): a consumer whose whole budget goes to data evaluation,
 * differentiation and compilation gets the same record shape as a solve-phase
 * timeout — `timedOut: True`, `phase: "setup"`, `iterations: 0` — rather than
 * a bare `CancellationError` it would have to duck-type. */
function timeoutRecord(ce: IComputeEngine, ctx: SetupContext): Expression {
  const specs = ctx.specs ?? [];
  return buildRecord(
    ce,
    specs.map((s) => s.name),
    {
      // The starting point is all that is known: no residual was ever formed.
      theta: specs.map((s) => clamp(s.start, s.lo, s.hi)),
      converged: false,
      stationary: false,
      residualNorm: NaN,
      iterations: 0,
      timedOut: true,
    },
    ctx.operator,
    ctx.phase
  );
}

/**
 * The numeric callbacks over all units that both solvers (`solve` and
 * `solveGlobal`) share: the residual vector and the Jacobian as the
 * Levenberg–Marquardt core wants them, and the row walk they are built on.
 */
interface FitCallbacks {
  /** Fresh parameter names, shared across all units by construction. */
  pFresh: string[];
  /** Lower/upper box constraint per parameter, from the specs. */
  lo: number[];
  hi: number[];
  /**
   * Walk every data row of every unit with the parameter values `theta` and
   * the row's variable values written into the shared symbol-value record,
   * checking the evaluation deadline once per row, and call `visit` on each.
   */
  eachRow: (
    theta: number[],
    visit: (unit: FitUnit, row: DataRow, record: Record<string, number>) => void
  ) => void;
  residual: (theta: number[]) => number[];
  jacobian: (theta: number[]) => number[][];
}

/**
 * Throw when `signal` was aborted: the `CancellationError` whose `cause` is
 * the signal's reason, as the other asynchronous evaluations reject with
 * (`runAsync` in `common/interruptible.ts`).
 */
function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancellationError({ cause: signal.reason });
}

/**
 * Assemble the residual/Jacobian callbacks over all units. `deadlineFrame`
 * gives the deadline frame the row walk checks: by default the engine's
 * frame at the time of each check; the asynchronous route
 * (`findFitAsync`) gives the frame it captured when it started, since the
 * engine's frame after an `await` is another evaluation's. The row walk also
 * checks `signal`, the abort signal of the asynchronous route, so that an
 * abort stops the fit within a row.
 */
function makeCallbacks(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[],
  deadlineFrame: () => DeadlineFrame | undefined = () => ce._deadlineFrame,
  signal?: AbortSignal
): FitCallbacks {
  const p = specs.length;
  const lo = specs.map((s) => s.lo);
  const hi = specs.map((s) => s.hi);

  // Fresh parameter names are shared across all units by construction.
  const pFresh = (units[0] as FitUnitWithParams).paramFresh;

  const record: Record<string, number> = {};

  // Per-ROW deadline checks (Tycho item 118): a COMPILED model function is
  // deadline-blind (unlike the interpreted `subs`+`.N()` fallback, whose
  // evaluation loop self-checks), so for an expensive model the per-ITERATION
  // `onIteration` checkpoint alone leaves rows×(params+1) model calls as the
  // indivisible unit — measured seconds of overrun against a 250 ms ambient
  // budget. Checking per row shrinks that unit to one row's calls. The check
  // is a Date.now() compare — noise next to any real model call. The
  // resulting timeout throw is caught by `levenbergMarquardt`, which returns
  // best-so-far (`converged: false`, `timedOut: true`).
  const eachRow: FitCallbacks['eachRow'] = (theta, visit) => {
    for (let j = 0; j < p; j++) record[pFresh[j]] = theta[j];
    for (const unit of units) {
      for (const row of unit.rows) {
        checkDeadline(deadlineFrame());
        checkAborted(signal);
        for (let k = 0; k < unit.varFresh.length; k++)
          record[unit.varFresh[k]] = row.x[k];
        visit(unit, row, record);
      }
    }
  };

  const residual = (theta: number[]): number[] => {
    const out: number[] = [];
    eachRow(theta, (unit, row, rec) => out.push(unit.fn(rec) - row.y));
    return out;
  };

  const jacobian = (theta: number[]): number[][] => {
    const rowsJ: number[][] = [];
    eachRow(theta, (unit, _row, rec) => {
      const base = unit.fn(rec);
      const jr = new Array(p).fill(0);
      for (let j = 0; j < p; j++) {
        const d = unit.deriv[j];
        if (d) {
          jr[j] = d(rec);
        } else {
          // Finite difference for this column only. The step is scaled to
          // the parameter magnitude (no underflow near θⱼ = 0), and the
          // probe stays inside `[lo, hi]`: forward unless that overshoots
          // `hi[j]`, and if the first probe is non-finite (a box-guarded
          // model can NaN at an infeasible point) retry the other direction.
          const t = theta[j];
          const h = Math.sqrt(Number.EPSILON) * Math.max(1, Math.abs(t));
          let step = t + h <= hi[j] ? h : -h;
          rec[pFresh[j]] = t + step;
          let probe = unit.fn(rec);
          if (!Number.isFinite(probe)) {
            const alt = -step;
            if (t + alt <= hi[j] && t + alt >= lo[j]) {
              step = alt;
              rec[pFresh[j]] = t + step;
              probe = unit.fn(rec);
            }
          }
          rec[pFresh[j]] = t;
          jr[j] = (probe - base) / step;
        }
      }
      rowsJ.push(jr);
    });
    return rowsJ;
  };

  return { pFresh, lo, hi, eachRow, residual, jacobian };
}

/** Run LM from the single start of the specs and report the record.
 * `deadlineFrame` and `signal` are as for `makeCallbacks`. */
function solve(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[],
  operator: FitOperator,
  deadlineFrame: () => DeadlineFrame | undefined = () => ce._deadlineFrame,
  signal?: AbortSignal
): Expression | undefined {
  // Defensive: an empty model/equation list yields zero units; `units[0]`
  // in `makeCallbacks` would otherwise throw (see the guards in
  // `findFit`/`findRoot`).
  if (units.length === 0)
    return ce.error('unexpected-argument', 'no residual units');

  const theta0 = specs.map((s) => s.start);
  const { lo, hi, residual, jacobian } = makeCallbacks(
    ce,
    units,
    specs,
    deadlineFrame,
    signal
  );
  const solverTolerance = solverToleranceOf(ce, operator);

  // A deadline expiring during the starting-point evaluation or the solver's
  // own initial residual/Jacobian — before any iteration completed — still
  // answers a record: the (clamped) start point, `converged: false`,
  // `timedOut: true`, with a NaN residual norm (it was never computed).
  // Later-phase timeouts are caught INSIDE `levenbergMarquardt`, which
  // returns genuine best-so-far. Non-timeout throws propagate unchanged.
  let result: LMResult;
  try {
    // NaN at the starting point is a hard failure (§ 3.3).
    const r0 = residual(theta0.map((v, j) => clamp(v, lo[j], hi[j])));
    if (r0.some((v) => !Number.isFinite(v)))
      return ce.error('unexpected-argument', 'starting point is not finite');

    result = levenbergMarquardt(residual, jacobian, theta0, {
      lo,
      hi,
      ...solverTolerance,
      onIteration: () => {
        checkDeadline(deadlineFrame());
        checkAborted(signal);
      },
    });
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    result = {
      theta: theta0.map((v, j) => clamp(v, lo[j], hi[j])),
      converged: false,
      stationary: false,
      residualNorm: NaN,
      iterations: 0,
      timedOut: true,
    };
  }

  return buildRecord(
    ce,
    specs.map((s) => s.name),
    result,
    operator
  );
}

//
// Global fit (the `global` option, Tycho row 404)
//

/** Default grid resolution per scanned parameter, for one or two scanned
 * parameters. The separable scan is cheap (one linear solve per grid point),
 * so it can afford a fine grid; a multi-start runs a full LM solve per grid
 * point, so its grid is coarse. */
const SEPARABLE_GRID = [400, 40];
const MULTISTART_GRID = [24, 6];
/** How many grid-point local minima the separable scan refines by LM. */
const SEPARABLE_REFINEMENTS = 6;
/** The largest number of grid points of one scanned parameter, whether the
 * count comes from the basin width or from a step the caller gave. */
const MAX_SCAN_POINTS_PER_PARAM = 4000;
/** The largest number of points of a two-parameter grid. */
const SEPARABLE_BUDGET = 8000;
/** The fewest points a parameter is reduced to when a two-parameter grid is
 * over the budget. A phase inside a periodic function has a basin about a
 * quarter turn wide, so 8 points over one period are enough for the
 * refinement to reach it from the nearest point. */
const MIN_REDUCED_POINTS = 8;
/** Above this many rows in total, the separable scan runs on a sample of
 * this many rows (`sampleRowIndices`); the refinements use every row. */
const SCAN_SAMPLE_ROWS = 300;
/** How many of the best grid-point local minima of a scan on a sample of the
 * rows are solved again on every row before the `SEPARABLE_REFINEMENTS` best
 * of them are refined. The sample can rank a wrong minimum first (an alias
 * of the true frequency that fits the sample rows but not the others), so
 * the ranking that picks the refinements uses every row. */
const SAMPLE_RESCORES = 24;

/** One axis of a search grid, the input of `gridCounts`. */
export interface GridAxis {
  lo: number;
  hi: number;
  /** The step the caller gave: it sets the count and is never reduced. */
  step?: number;
  /** The width of the narrowest basin of the residual in this parameter,
   * when the model shows one (a phase rate): the count is then at least
   * the number of basins over the range. */
  basin?: number;
}

/**
 * The number of grid points of each axis of a search grid.
 *
 * - A caller-given step gives `ceil((hi − lo) / step) + 1` points, between 2
 *   and `MAX_SCAN_POINTS_PER_PARAM`.
 * - Otherwise a basin width gives `ceil((hi − lo) / basin) + 1` points, not
 *   less than `defaultCount` and not more than `MAX_SCAN_POINTS_PER_PARAM`,
 *   so that a point falls in each basin.
 * - Otherwise the axis has `defaultCount` points.
 *
 * With two axes whose product is over `budget`, the axes without a
 * caller-given step are reduced until the product is within the budget:
 * first the one without a basin width (the second when both or neither have
 * one) to `max(MIN_REDUCED_POINTS, floor(budget / other count))`, then, if
 * the product is still over the budget, the other one the same way, and then
 * the same two steps with a floor of 2 points instead of
 * `MIN_REDUCED_POINTS`. An axis is never increased by a reduction. When both
 * axes have a caller-given step and the product is over the budget, the
 * answer is `'over-budget'`. A caller-given step gives at most
 * `MAX_SCAN_POINTS_PER_PARAM` points, which is at most half the budget, so
 * one automatic axis of 2 points always fits.
 *
 * Exported for the tests.
 */
export function gridCounts(
  axes: GridAxis[],
  defaultCount: number,
  budget = SEPARABLE_BUDGET
): number[] | 'over-budget' {
  const pointsFor = (range: number, step: number): number =>
    Math.ceil(range / step - 1e-9) + 1;
  const counts = axes.map((axis) => {
    const range = axis.hi - axis.lo;
    if (axis.step !== undefined)
      return Math.min(
        MAX_SCAN_POINTS_PER_PARAM,
        Math.max(2, pointsFor(range, axis.step))
      );
    if (axis.basin !== undefined && axis.basin > 0)
      return Math.min(
        MAX_SCAN_POINTS_PER_PARAM,
        Math.max(defaultCount, pointsFor(range, axis.basin))
      );
    return defaultCount;
  });
  if (axes.length !== 2 || counts[0] * counts[1] <= budget) return counts;
  const reducible = [0, 1].filter((i) => axes[i].step === undefined);
  if (reducible.length === 0) return 'over-budget';
  const withoutBasin = reducible.filter((i) => axes[i].basin === undefined);
  const target =
    reducible.length === 1
      ? reducible[0]
      : withoutBasin.length === 1
        ? withoutBasin[0]
        : 1;
  const order = reducible.length === 1 ? [target] : [target, 1 - target];
  for (const least of [MIN_REDUCED_POINTS, 2])
    for (const i of order) {
      if (counts[0] * counts[1] <= budget) return counts;
      counts[i] = Math.min(
        counts[i],
        Math.max(least, Math.floor(budget / counts[1 - i]))
      );
    }
  return counts[0] * counts[1] <= budget ? counts : 'over-budget';
}

/** The fractional part of the golden ratio, `(√5 − 1) / 2`: the step of the
 * low-discrepancy sequence `frac(i · φ)` that places each sampled row inside
 * its stratum. */
const GOLDEN_FRACTION = 0.6180339887498949;

/**
 * The indices of a stratified sample of `count` of `n` rows, in increasing
 * order. The rows are cut into `count` consecutive strata of
 * `floor(n / count)` or `ceil(n / count)` rows, and one row is taken from
 * each: the first row of the first stratum, the last row of the last one,
 * and in stratum `i` the row at the fraction `frac(i · φ)` of the stratum
 * (`φ` the golden ratio), a low-discrepancy sequence. The offsets do not
 * depend on the data, so the same `n` and `count` always give the same rows.
 *
 * The sample is not a regular sub-grid on purpose. For rows evenly spaced
 * along a variable, rows taken every `k`-th row are evenly spaced `k` times
 * farther apart, and a sinusoid at any alias of the true frequency (the
 * true one plus a multiple of `2π / (k · spacing)`) fits those rows exactly:
 * the scan cannot tell the aliases from the true frequency. Uneven offsets
 * break that.
 *
 * With `count >= n`, every row; with `count <= 0`, none.
 *
 * Exported for the tests.
 */
export function sampleRowIndices(n: number, count: number): number[] {
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  if (count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return 0;
    if (i === count - 1) return n - 1;
    const start = Math.floor((i * n) / count);
    const end = Math.floor(((i + 1) * n) / count);
    const offset = (i * GOLDEN_FRACTION) % 1;
    return start + Math.floor(offset * (end - start));
  });
}

/**
 * The number of rows of each unit in the sample of the separable scan:
 * `total` rows shared among the units in proportion to their sizes `sizes`,
 * by the largest-remainder method. Each unit gets the integer part of its
 * share `total · size / Σ sizes`, and the rows left go one each to the units
 * with the largest fractional parts (the first unit on a tie). The counts
 * add up to `total` exactly when `total` is at most the number of rows, and
 * a small unit can get 0 or 1 row. With `total` at least the number of
 * rows, every row.
 *
 * Exported for the tests.
 */
export function sampleRowCounts(sizes: number[], total: number): number[] {
  const all = sizes.reduce((n, s) => n + s, 0);
  if (total >= all) return sizes.slice();
  const shares = sizes.map((s) => (total * s) / all);
  const counts = shares.map((s) => Math.floor(s));
  let left = total - counts.reduce((n, c) => n + c, 0);
  const byRemainder = shares
    .map((s, u) => [s - Math.floor(s), u])
    .sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (const [, u] of byRemainder) {
    if (left <= 0) break;
    if (counts[u] < sizes[u]) {
      counts[u] += 1;
      left -= 1;
    }
  }
  return counts;
}

/**
 * The grid of scanned-parameter values: `counts[k]` points for the scanned
 * parameter `scans[k]`, endpoints included (a minimizer pressed against a
 * bound of the range is a legitimate answer), as the Cartesian product over
 * zero, one or two parameters, row-major (the last parameter varies fastest).
 * Each point is the list of values in the order of `scans`. With no
 * parameter the grid is the one empty point.
 */
function scanGrid(scans: GlobalScan[], counts: number[]): number[][] {
  const axis = (s: GlobalScan, n: number): number[] =>
    Array.from({ length: n }, (_, i) => s.lo + ((s.hi - s.lo) * i) / (n - 1));
  if (scans.length === 0) return [[]];
  if (scans.length === 1) return axis(scans[0], counts[0]).map((v) => [v]);
  const grid: number[][] = [];
  const second = axis(scans[1], counts[1]);
  for (const u of axis(scans[0], counts[0]))
    for (const v of second) grid.push([u, v]);
  return grid;
}

/**
 * Indices of the grid points that are local minima of `rss` over the grid: no
 * finite neighbour is lower (one dimension: the two neighbours; two: the eight
 * surrounding cells of the `counts[0] × counts[1]` grid laid out row-major by
 * `scanGrid`). Non-finite points are never minima. With no dimension, the one
 * point is a minimum when it is finite.
 */
function gridLocalMinima(rss: number[], counts: number[]): number[] {
  const minima: number[] = [];
  const lowerNeighbour = (i: number, offsets: number[]): boolean =>
    offsets.some((o) => rss[o] < rss[i]);
  for (let i = 0; i < rss.length; i++) {
    if (!Number.isFinite(rss[i])) continue;
    const neighbours: number[] = [];
    if (counts.length === 1) {
      if (i > 0) neighbours.push(i - 1);
      if (i < counts[0] - 1) neighbours.push(i + 1);
    } else if (counts.length === 2) {
      const [rows, cols] = counts;
      const row = Math.floor(i / cols);
      const col = i % cols;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r >= 0 && r < rows && c >= 0 && c < cols)
            neighbours.push(r * cols + c);
        }
    }
    if (!lowerNeighbour(i, neighbours)) minima.push(i);
  }
  return minima;
}

/** What the global search found, for `solveGlobal` to turn into a record. */
interface GlobalSearchOutcome {
  /** The lowest-residual finished solver run, if any. */
  best: LMResult | undefined;
  /** Best point seen before any LM run finished (the fallback of a timeout
   * during the scan): the vector and its sum of squared residuals over
   * EVERY row. */
  bestScanned: [number[], number] | undefined;
  /** The best point of a scan on a sample of the rows, whose residual over
   * every row was not computed: the answer, with no residual, when the
   * deadline left nothing better. */
  bestUnscored: number[] | undefined;
  /** Total over every solver run. */
  iterations: number;
  timedOut: boolean;
}

/** The shape of the grids of a global search, decided by `solveGlobal`. */
interface SearchLayout {
  /** The parameters on the separable grid, in the order of a linear task's
   * `point`: the scans less the phases that the scan solves linearly. */
  gridScans: GlobalScan[];
  /** The number of points of each of `gridScans`. */
  gridCounts: number[];
  /** The number of points of each scan (in the order of the scans) for the
   * multi-start grid. */
  startCounts: number[];
  /** The separable scan runs on a sample of the rows: the residuals of its
   * points then only rank the points; they are not comparable with those of
   * the refinements, which run on every row. */
  sampled: boolean;
}

/**
 * The plan of the global search (see `solveGlobal` for the two strategies):
 * yields each batch of tasks and receives the batch's results, and returns
 * the outcome, or `'no-finite-value'` when no grid point had a finite
 * residual. The plan reads results by task index, so the order they arrive
 * in does not matter, and it ignores every point at or after the first
 * nonlinear one, so which of those ran does not matter either. Under a
 * deadline it uses every result that came back: an executor that ran a
 * different set of tasks before the deadline (a pool) can then report a
 * different best point, which the design accepts
 * (`docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.5).
 *
 * When the separable scan runs on a sample of the rows, its residuals only
 * rank the grid points: the `SAMPLE_RESCORES` best local minima are solved
 * again on every row, and the `SEPARABLE_REFINEMENTS` best of those are
 * refined. Only a residual over every row is ever compared with a solver
 * run's.
 */
function* globalSearchPlan(
  separable: boolean,
  scans: GlobalScan[],
  thetaAt: (point: number[]) => number[],
  layout: SearchLayout
): Generator<
  FitTask[],
  GlobalSearchOutcome | 'no-finite-value',
  FitBatchResult
> {
  let iterations = 0;
  let timedOut = false;
  let best: LMResult | undefined;
  let bestScanned: [number[], number] | undefined;
  let bestUnscored: number[] | undefined;
  const outcome = (): GlobalSearchOutcome => ({
    best,
    bestScanned,
    bestUnscored,
    iterations,
    timedOut,
  });

  const consider = (r: LMResult): void => {
    iterations += r.iterations;
    if (r.timedOut) timedOut = true;
    if (
      Number.isFinite(r.residualNorm) &&
      (best === undefined || r.residualNorm < best.residualNorm)
    )
      best = r;
  };
  const considerScanned = (theta: number[], rss: number): void => {
    if (bestScanned === undefined || rss < bestScanned[1])
      bestScanned = [theta, rss];
  };

  /** Record the results of a batch of start tasks in task order: the finite
   * start points as scanned points, the solver runs as candidates. Ties on
   * the residual go to the lowest index, as the serial loop's first-seen
   * rule did. */
  const takeStarts = (tasks: StartTask[], batch: FitBatchResult): void => {
    const byIndex = [...batch.results].sort((a, b) => a.index - b.index);
    for (const r of byIndex) {
      if (r.kind !== 'start') continue;
      const task = tasks[r.index];
      if (task.checkStart && Number.isFinite(r.startRss))
        considerScanned(task.theta0, r.startRss);
      if (r.lm) consider(r.lm);
    }
    if (batch.timedOut) timedOut = true;
  };

  /**
   * Read a batch of `count` linear tasks by task index. A point that turned
   * out nonlinear means the structural test was wrong about this model: the
   * multi-start takes over. The points before it are genuine evaluated
   * points; the points after it are not read, which is what the serial loop
   * gave when it stopped there. Returns the solution of each point (`null`
   * for a point that has none, did not run, or comes at or after the first
   * nonlinear one) and whether a point was nonlinear.
   */
  const readLinear = (
    batch: FitBatchResult,
    count: number
  ): { solved: ([number[], number] | null)[]; nonlinear: boolean } => {
    let firstNonlinear = Infinity;
    for (const r of batch.results)
      if (r.kind === 'linear' && r.solved === 'nonlinear')
        firstNonlinear = Math.min(firstNonlinear, r.index);
    const solved: ([number[], number] | null)[] = new Array(count).fill(null);
    for (const r of batch.results)
      if (
        r.kind === 'linear' &&
        r.index < firstNonlinear &&
        r.solved !== 'nonlinear'
      )
        solved[r.index] = r.solved;
    return { solved, nonlinear: firstNonlinear !== Infinity };
  };

  if (separable) {
    const grid = scanGrid(layout.gridScans, layout.gridCounts);
    const tasks: FitTask[] = grid.map((point, index) => ({
      kind: 'linear',
      index,
      point,
    }));
    const batch = yield tasks;
    const scan = readLinear(batch, grid.length);
    // In task order, so that a tie on the residual goes to the lowest index
    // whatever order the results arrived in. On every row a solved point is
    // a scanned point; on a sample of the rows its residual only ranks it,
    // and the best one is kept as a point with no residual.
    let bestSampleRss = Infinity;
    for (const s of scan.solved) {
      if (s === null) continue;
      if (!layout.sampled) considerScanned(s[0], s[1]);
      else if (s[1] < bestSampleRss) {
        bestSampleRss = s[1];
        bestUnscored = s[0];
      }
    }
    if (batch.timedOut) {
      // A deadline expiring inside the scan: whatever was found so far is
      // reported, with no refinement. This comes before the nonlinear check
      // on purpose: once the deadline has passed, a multi-start would time
      // out in its first start, so the scanned points are the answer. The
      // deadline has passed, so a sampled point cannot be solved again on
      // every row: it is reported with no residual.
      timedOut = true;
      return outcome();
    }
    if (!scan.nonlinear) {
      if (scan.solved.every((s) => s === null)) return 'no-finite-value';
      const rss = scan.solved.map((s) => (s !== null ? s[1] : Infinity));
      const candidates = gridLocalMinima(rss, layout.gridCounts).sort(
        (i, k) => rss[i] - rss[k]
      );
      // The starts of the refinements, each with its residual over every
      // row, best first. `undefined` sends the search to the multi-start.
      let refineFrom: [number[], number][] | undefined;
      if (!layout.sampled)
        refineFrom = candidates
          .slice(0, SEPARABLE_REFINEMENTS)
          .map((i) => scan.solved[i] as [number[], number]);
      else {
        const top = candidates.slice(0, SAMPLE_RESCORES);
        const rescores: FitTask[] = top.map((i, index) => ({
          kind: 'linear',
          index,
          point: grid[i],
          allRows: true,
        }));
        const rescored = yield rescores;
        const again = readLinear(rescored, top.length);
        for (const s of again.solved)
          if (s !== null) considerScanned(s[0], s[1]);
        if (rescored.timedOut) {
          timedOut = true;
          return outcome();
        }
        // A point that is nonlinear on every row, or no point with a finite
        // residual on every row (a row outside the sample is not finite):
        // the multi-start takes over.
        const finite = again.solved.filter(
          (s): s is [number[], number] => s !== null
        );
        if (!again.nonlinear && finite.length > 0)
          refineFrom = finite
            .sort((x, y) => x[1] - y[1])
            .slice(0, SEPARABLE_REFINEMENTS);
      }
      if (refineFrom !== undefined) {
        const refinements: StartTask[] = refineFrom.map(([theta0], index) => ({
          kind: 'start',
          index,
          theta0,
          checkStart: false,
        }));
        takeStarts(refinements, yield refinements);
        return outcome();
      }
    }
  }
  const starts: StartTask[] = scanGrid(scans, layout.startCounts).map(
    (point, index) => ({
      kind: 'start',
      index,
      theta0: thetaAt(point),
      checkStart: true,
    })
  );
  const batch = yield starts;
  takeStarts(starts, batch);
  // No start had a finite residual, and the deadline did not cut the batch
  // short (a cut batch is reported with what it has, as the serial loop did
  // when the deadline expired inside a start's evaluation).
  if (bestScanned === undefined && !batch.timedOut) return 'no-finite-value';
  return outcome();
}

/**
 * The width of the narrowest basin of the residual in the parameter `param`:
 * the smallest `(period / 2) / (|rate| · span)` over the phase rates of the
 * parameter in every unit (`π / (|rate| · span)` for `Sin` and `Cos`, half
 * that for `Tan` and `Cot`, whose period is π, and for `cos(θ)²` or
 * `|cos(θ)|`, whose period is π too), where `span` is the extent
 * of the rate's variable over the rows
 * of the unit (the maximum minus the minimum of its finite values). A zero or
 * non-finite span gives no width. `undefined` when the parameter has no
 * phase rate.
 */
function basinWidth(units: FitUnit[], param: number): number | undefined {
  let width: number | undefined;
  // The constant rates of a system of equations (`PeriodicRate.variable`
  // is −1), per period: the equations stand for the rows, so the span is
  // taken over every unit, below.
  const constants = new Map<number, number[]>();
  for (const unit of units) {
    for (const r of unit.periodicRates) {
      if (r.param !== param) continue;
      if (r.variable < 0) {
        const list = constants.get(r.period) ?? [];
        list.push(r.rate);
        constants.set(r.period, list);
        continue;
      }
      let min = Infinity;
      let max = -Infinity;
      for (const row of unit.rows) {
        const v = row.x[r.variable];
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = max - min;
      if (!Number.isFinite(span) || span <= 0) continue;
      const w = r.period / 2 / (Math.abs(r.rate) * span);
      if (width === undefined || w < width) width = w;
    }
  }
  for (const [period, rates] of constants) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of rates) {
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) continue;
    const w = period / 2 / span;
    if (width === undefined || w < width) width = w;
  }
  return width;
}

/** An amplitude–phase pair that the separable scan solves by least squares
 * (see `PhaseShape`). `positive`: the amplitude is reported non-negative;
 * otherwise non-positive. */
interface LinearPhase extends PhaseShape {
  positive: boolean;
}

/**
 * The scanned phases that the separable scan can solve by least squares
 * instead of sampling them: for each scanned parameter `c`, an amplitude
 * `a` that is solved linearly (one of `linearIdx`) such that every unit
 * either mentions neither `a` nor `c`, or has the pair `(a, c)` with the same
 * rate as a `PhaseShape`. Two more conditions keep the answer of the linear
 * solve inside the box constraints: the range of `c` covers a full period
 * `2π / |rate|` (so some value in it gives every phase), and the bounds of
 * `a` admit every non-negative value (or every non-positive one), since the
 * solve gives the amplitude only up to its sign. A scanned parameter with a
 * caller-given step stays on the grid: the caller asked for a grid over it.
 */
function linearPhases(
  units: FitUnit[],
  scans: GlobalScan[],
  linearIdx: number[],
  lo: number[],
  hi: number[]
): LinearPhase[] {
  const result: LinearPhase[] = [];
  const linear = new Set(linearIdx);
  for (const scan of scans) {
    if (scan.step !== undefined) continue;
    const c = scan.index;
    for (const unit of units) {
      const shape = unit.phaseShapes.find(
        (s) =>
          s.phase === c &&
          linear.has(s.amplitude) &&
          !result.some((r) => r.amplitude === s.amplitude)
      );
      if (shape === undefined) continue;
      const { amplitude: a, rate } = shape;
      const consistent = units.every(
        (u) =>
          (!u.mentions[a] && !u.mentions[c]) ||
          u.phaseShapes.some(
            (s) => s.amplitude === a && s.phase === c && s.rate === rate
          )
      );
      if (!consistent) break;
      const period = (2 * Math.PI) / Math.abs(rate);
      if (scan.hi - scan.lo < period * (1 - 1e-12)) break;
      let positive: boolean;
      if (hi[a] === Infinity && lo[a] <= 0) positive = true;
      else if (lo[a] === -Infinity && hi[a] >= 0) positive = false;
      else break;
      result.push({ ...shape, positive });
      break;
    }
  }
  return result;
}

/**
 * `FindFit` with the `global` option: the lowest sum of squared residuals over
 * a closed range of one or two parameters, not the local minimum nearest the
 * start. For a periodic model on a few points the residual has many local
 * minima and a single Levenberg–Marquardt run returns whichever one its start
 * falls into (Tycho row 404).
 *
 * Two strategies, chosen by the shape of the model:
 *
 * 1. **Separable scan** (variable projection), when the model is linear in
 *    every parameter that is NOT scanned: each such parameter has an analytic
 *    derivative that mentions none of those parameters. The scanned parameters
 *    are sampled on a grid over their range; at each grid point the linear
 *    parameters are solved exactly by linear least squares (the normal
 *    equations of the derivative columns), which gives the residual of the
 *    best fit at that grid point. The grid points that are local minima of
 *    that residual are then refined by the bounded LM solver over ALL
 *    parameters, and the lowest residual wins. `a·cos(b·x + c) + d·x` with
 *    `b` scanned is this case: `a` and `d` are linear, `c` is not, so it must
 *    be scanned too or the fit falls to the multi-start.
 *
 * 2. **Multi-start**, otherwise: the scanned parameters are sampled on a
 *    coarser grid, the other parameters take their starts, LM runs from every
 *    grid point, and the lowest residual wins.
 *
 * In both, a scanned parameter is bounded to its range during the LM
 * refinement, so the answer lies inside the range. The exception is a phase
 * that the scan solves by least squares (below): the model is periodic in it,
 * so its refinement runs unbounded and the refined value is brought back
 * into the range modulo the period. The record is the usual one; its
 * `iterations` is the total over every LM run. A deadline that expires
 * during the scan or a refinement returns the best point found so far with
 * `timedOut: True`. When that point comes from a scan on a sample of the
 * rows (below), its residual over every row was never computed, and the
 * record has `residualNorm: NaN`.
 *
 * The grid of the separable scan (`gridCounts`):
 *
 * - A parameter that scales the phase of a periodic function of a fit
 *   variable (`b` in `cos(b x + c)`, see `PeriodicRate`) gets at least one
 *   point per basin of the residual, `π / (|rate| · span of the variable)`
 *   apart (half that for `Tan` and `Cot`, and for `cos(θ)²`, `|cos(θ)|`,
 *   `sin(θ) cos(θ)` and the other expressions of period π, see
 *   `composedPeriod()`), so that the scan cannot step over the basin of the
 *   best fit.
 * - A step the caller gave (`b: [lo, hi, step]`) sets the count instead.
 * - Two scanned parameters share a budget of `SEPARABLE_BUDGET` points. Two
 *   caller-given steps over the budget are an `unexpected-argument` error.
 * - A scanned phase of an amplitude–phase pair (`c` in `a cos(b x + c)`
 *   with `a` linear, see `PhaseShape`) with no caller-given step leaves the
 *   grid: the scan solves it by least squares with the linear parameters,
 *   which turns the two-parameter search of `b` and `c` into a one-parameter
 *   search of `b`.
 *
 * With more than `SCAN_SAMPLE_ROWS` rows the separable scan runs on a
 * stratified sample of the rows (`sampleRowIndices`), which bounds its cost.
 * Its residuals then only rank the grid points: the best local minima are
 * solved again on every row before the best of them are refined (see
 * `globalSearchPlan`). The refinements and the multi-start run on every row.
 *
 * The synchronous `evaluate()` runs the plan on the calling thread
 * (`InlineFitExecutor`); `findFitAsync` can run its separable scan on a
 * kernel pool (`PoolFitExecutor`), from the same `prepareGlobalSearch`.
 */
function solveGlobal(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[],
  scans: GlobalScan[],
  operator: FitOperator
): Expression | undefined {
  const search = prepareGlobalSearch(ce, units, specs, scans, operator);
  if ('done' in search) return search.done;
  return search.finish(
    runFitPlanSync(search.plan(), new InlineFitExecutor(search.kernel))
  );
}

/** A global search ready to run: the plan, the operations of its tasks,
 * and the step that turns the plan's outcome into the record. */
interface GlobalSearch {
  /** A new run of the plan (`globalSearchPlan`). */
  plan: () => Generator<
    FitTask[],
    GlobalSearchOutcome | 'no-finite-value',
    FitBatchResult
  >;
  kernel: FitKernel;
  /** The plan uses the separable scan. */
  separable: boolean;
  /** The separable scan in the form a kernel worker loads, when every
   * function it evaluates compiled to code a worker can run; `undefined`
   * otherwise (and when the search is not separable). */
  wire: WireFitProblem | undefined;
  finish: (outcome: GlobalSearchOutcome | 'no-finite-value') => Expression;
}

/**
 * Prepare the global search of `solveGlobal`: the plan, its kernel and the
 * step that builds the record. Returns `{ done }` with the answer when there
 * is nothing to search (no unit, or two caller-given steps over the grid
 * budget). `deadlineFrame` gives the deadline frame the kernel checks, and
 * `signal` the abort signal it checks with it (see `makeCallbacks`).
 */
function prepareGlobalSearch(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[],
  scans: GlobalScan[],
  operator: FitOperator,
  deadlineFrame: () => DeadlineFrame | undefined = () => ce._deadlineFrame,
  signal?: AbortSignal
): GlobalSearch | { done: Expression | undefined } {
  if (units.length === 0)
    return { done: ce.error('unexpected-argument', 'no residual units') };

  const p = specs.length;
  const cb = makeCallbacks(ce, units, specs, deadlineFrame, signal);
  const solverTolerance = solverToleranceOf(ce, operator);
  const lo = cb.lo.slice();
  const hi = cb.hi.slice();
  for (const s of scans) {
    lo[s.index] = s.lo;
    hi[s.index] = s.hi;
  }
  const names = specs.map((s) => s.name);

  // The parameters that are not scanned, and whether the model is linear in
  // all of them (jointly: no derivative mentions any of them, itself included,
  // and none is a step function of its parameter, whose derivative is zero
  // without the model being constant in it). The scan below also checks each
  // grid point numerically and abandons this strategy on a disagreement.
  const scanned = new Set(scans.map((s) => s.index));
  const linearIdx: number[] = [];
  for (let j = 0; j < p; j++) if (!scanned.has(j)) linearIdx.push(j);
  const linearFresh = new Set(linearIdx.map((j) => cb.pFresh[j]));
  const separable = linearIdx.every((j) =>
    units.every((u) => {
      const unknowns = u.derivUnknowns[j];
      if (unknowns === null || u.stepLike[j]) return false;
      for (const name of unknowns) if (linearFresh.has(name)) return false;
      return true;
    })
  );

  /** The full parameter vector at a grid point: scanned values set, the
   * others at their (clamped) starts. */
  const thetaAt = (point: number[]): number[] => {
    const theta = specs.map((s, j) => clamp(s.start, lo[j], hi[j]));
    scans.forEach((s, k) => (theta[s.index] = point[k]));
    return theta;
  };

  // The scanned phases that the separable scan solves by least squares, and
  // the parameters that stay on its grid.
  const phases = separable ? linearPhases(units, scans, linearIdx, lo, hi) : [];
  const phaseIndices = new Set(phases.map((ph) => ph.phase));
  const gridScans = scans.filter((s) => !phaseIndices.has(s.index));
  const gridAxes = gridScans.map((s) => ({
    lo: s.lo,
    hi: s.hi,
    step: s.step,
    basin: basinWidth(units, s.index),
  }));
  const gridCountList = gridCounts(
    gridAxes,
    SEPARABLE_GRID[gridScans.length - 1] ?? 1
  );
  // The multi-start keeps its coarse grid whatever the step: each of its
  // points is a full solver run, which a fine grid cannot afford.
  const startCountList = scans.map(() => MULTISTART_GRID[scans.length - 1]);
  // A caller-given step is never reduced to fit the budget of a
  // two-parameter grid, so two of them over the budget are an error. Only
  // the separable scan builds this grid.
  if (gridCountList === 'over-budget' && separable) {
    const [b, c] = gridScans.map((s) => names[s.index]);
    return {
      done: ce.error(
        'unexpected-argument',
        `${operator}: the grid steps of "${b}" and "${c}" in the "global" option ask for more than ${SEPARABLE_BUDGET} grid points`
      ),
    };
  }

  // The separable scan on a sample of the rows when there are many: each
  // unit carries a sample of its rows, shared among the units in proportion
  // to their sizes. The re-scoring of the best sampled points uses every
  // row, and so do the refinements and the multi-start (`cb`).
  const totalRows = units.reduce((n, u) => n + u.rows.length, 0);
  const sampled = separable && totalRows > SCAN_SAMPLE_ROWS;
  const sampleCounts = sampleRowCounts(
    units.map((u) => u.rows.length),
    SCAN_SAMPLE_ROWS
  );

  // The problem of the separable scan, over plain numbers (`fit-scan.ts`):
  // `linearScanSolve()` solves one grid point of it, on this thread or on a
  // kernel worker. A column is read only when the search is separable,
  // which requires an analytic derivative for every linear parameter.
  const noColumn = (): number => NaN;
  const scanProblem: FitScanProblem = {
    units: units.map((u, k) => ({
      varFresh: u.varFresh,
      rows: scanRows(u.rows, u.varFresh.length),
      ...(sampled
        ? {
            sample: scanRows(
              sampleRowIndices(u.rows.length, sampleCounts[k]).map(
                (i) => u.rows[i]
              ),
              u.varFresh.length
            ),
          }
        : {}),
      model: u.fn,
      columns: linearIdx.map((j) => u.deriv[j] ?? noColumn),
    })),
    paramFresh: cb.pFresh,
    linearIdx,
    gridIdx: gridScans.map((s) => s.index),
    lo,
    hi,
    start: specs.map((s, j) => clamp(s.start, lo[j], hi[j])),
    phases: phases.map(({ amplitude, phase, rate, positive }) => ({
      amplitude,
      phase,
      rate,
      positive,
    })),
  };
  // The same problem with the stored code of each function, for a kernel
  // worker, when every function the scan evaluates has one.
  let wire: WireFitProblem | undefined;
  if (separable) {
    const wireUnits: WireFitProblem['units'] = [];
    for (let k = 0; k < units.length; k++) {
      const model = units[k].stored;
      const columns = linearIdx.map((j) => units[k].derivStored[j]);
      if (model === undefined || columns.some((c) => c === undefined)) {
        wireUnits.length = 0;
        break;
      }
      wireUnits.push({
        ...scanProblem.units[k],
        model,
        columns: columns as StoredKernel[],
      });
    }
    if (wireUnits.length === units.length)
      wire = { ...scanProblem, units: wireUnits };
  }
  const scanDeadline = (): void => {
    checkDeadline(deadlineFrame());
    checkAborted(signal);
  };

  /** Separable step: with the scanned parameters fixed at `point` (the
   * values of `gridScans`), solve the linear parameters, and the phases of
   * `phases`, by least squares (`linearScanSolve()` in `fit-scan.ts`). With
   * many rows the scan uses a sample of the rows; with `allRows` (the
   * re-scoring of the best sampled points) every row. */
  const linearSolveAt = (point: number[], allRows: boolean) =>
    linearScanSolve(scanProblem, point, allRows, scanDeadline);

  // The pure-number operations of a task (`fit-executor.ts`): the plan below
  // decides which tasks to run, the executor runs them, on this thread
  // (`InlineFitExecutor`) or, for the scan, on a kernel pool
  // (`PoolFitExecutor`; design: `docs/plans/2026-10-20-worker-kernel-pool.md`,
  // section 5.5). The scan of `linearSolveAt` may run on a sample of the
  // rows; the solver runs always use every row.
  const onIteration = scanDeadline;
  const boundedLM = (theta0: number[]): LMResult =>
    levenbergMarquardt(cb.residual, cb.jacobian, theta0, {
      lo,
      hi,
      ...solverTolerance,
      onIteration,
    });
  // A phase that the scan solves by least squares is refined UNBOUNDED. The
  // scan's frequency is off by up to half a basin, so its phase is off by
  // about that error times the mean of the variable; when the best phase is
  // across an end of the range from the scan's (one near `lo`, the other
  // near `hi`), a solver bounded to the range stops at the bound with a
  // large residual. The model is periodic in the phase (`linearPhases`: it
  // appears only in `g(B + rate · c)` with `g` a sine or a cosine), so the
  // refined phase is then brought back into its range modulo the period,
  // and the amplitude to its sign convention, by `−A · g(t) = A · g(t + π)`.
  // The residual at the moved point is computed again; if it differs from
  // the solver's (the model is not periodic in the phase after all), a
  // bounded run starts from the moved point.
  const phaseLo = lo.slice();
  const phaseHi = hi.slice();
  for (const ph of phases) {
    phaseLo[ph.phase] = -Infinity;
    phaseHi[ph.phase] = Infinity;
  }
  const lm = (theta0: number[]): LMResult => {
    if (phases.length === 0) return boundedLM(theta0);
    const r = levenbergMarquardt(cb.residual, cb.jacobian, theta0, {
      lo: phaseLo,
      hi: phaseHi,
      ...solverTolerance,
      onIteration,
    });
    const theta = r.theta.slice();
    for (const ph of phases) {
      let amplitude = theta[ph.amplitude];
      let phase = theta[ph.phase];
      if (ph.positive ? amplitude < 0 : amplitude > 0) {
        amplitude = -amplitude;
        phase += Math.PI / ph.rate;
      }
      theta[ph.amplitude] = amplitude;
      theta[ph.phase] = wrapPhase(phase, ph, lo, hi);
    }
    if (theta.every((v, j) => v === r.theta[j])) return r;
    let norm: number;
    try {
      norm = Math.sqrt(sumOfSquares(cb.residual(theta)));
    } catch (e) {
      if (!isTimeoutCancellation(e)) throw e;
      // The deadline left no time to check the moved point: it is reported
      // with the solver's residual, which the periodicity of the model in
      // the phase gives up to rounding.
      return { ...r, theta, converged: false, timedOut: true };
    }
    if (Math.abs(norm - r.residualNorm) <= 1e-8 * (1 + r.residualNorm))
      return { ...r, theta, residualNorm: norm };
    try {
      const again = boundedLM(theta);
      return { ...again, iterations: r.iterations + again.iterations };
    } catch (e) {
      if (!isTimeoutCancellation(e)) throw e;
      return {
        ...r,
        theta,
        residualNorm: norm,
        converged: false,
        timedOut: true,
      };
    }
  };
  const kernel: FitKernel = {
    linearSolveAt,
    startRss: (theta0) => sumOfSquares(cb.residual(theta0)),
    lm,
  };
  const plan = () =>
    globalSearchPlan(separable, scans, thetaAt, {
      gridScans,
      // Not read by the multi-start, the only strategy left when the
      // separable grid is over the budget.
      gridCounts: gridCountList === 'over-budget' ? [] : gridCountList,
      startCounts: startCountList,
      sampled,
    });
  return {
    plan,
    kernel,
    separable,
    wire,
    finish: (outcome) =>
      globalRecord(ce, names, thetaAt, scans, outcome, operator),
  };
}

/** The record of a global search from the outcome of its plan. */
function globalRecord(
  ce: IComputeEngine,
  names: string[],
  thetaAt: (point: number[]) => number[],
  scans: GlobalScan[],
  outcome: GlobalSearchOutcome | 'no-finite-value',
  operator: FitOperator
): Expression {
  if (outcome === 'no-finite-value')
    return ce.error(
      'unexpected-argument',
      `${operator}: the ${operator === 'FindFit' ? 'model' : 'system'} has no finite value in the global range`
    );
  const { best, bestScanned, bestUnscored, iterations, timedOut } = outcome;

  // The best evaluated grid point can beat every finished solver run: in the
  // multi-start a later start is recorded in `bestScanned` before its run,
  // and the deadline can expire in that run's first residual evaluation,
  // which leaves no solver result for it. When the budget expired before any
  // run finished, it is the only answer there is.
  if (
    bestScanned !== undefined &&
    (best === undefined || Math.sqrt(bestScanned[1]) < best.residualNorm)
  ) {
    const [theta, rss] = bestScanned;
    return buildRecord(
      ce,
      names,
      {
        theta,
        converged: false,
        stationary: false,
        residualNorm: Math.sqrt(rss),
        iterations,
        ...(timedOut ? { timedOut: true } : {}),
      },
      operator
    );
  }
  if (best === undefined) {
    // Nothing was evaluated on every row before the budget expired: the best
    // point of a scan on a sample of the rows, or else the lower corner of
    // the range, with no residual (`NaN`: it was not computed over every
    // row).
    return buildRecord(
      ce,
      names,
      {
        theta: bestUnscored ?? thetaAt(scans.map((s) => s.lo)),
        converged: false,
        stationary: false,
        residualNorm: NaN,
        iterations,
        ...(timedOut ? { timedOut: true } : {}),
      },
      operator
    );
  }
  // A search cut short by the deadline did not examine every candidate, so
  // it never reports convergence, even when the winning run converged.
  return buildRecord(
    ce,
    names,
    {
      ...best,
      converged: best.converged && !timedOut,
      iterations,
      ...(timedOut ? { timedOut: true } : {}),
    },
    operator
  );
}

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** The rows of a unit as the separable scan reads them (`FitScanRows`): one
 * `Float64Array` per fit variable, and the targets. */
function scanRows(rows: DataRow[], nvars: number): FitScanRows {
  const x = Array.from({ length: nvars }, () => new Float64Array(rows.length));
  const y = new Float64Array(rows.length);
  rows.forEach((row, i) => {
    for (let k = 0; k < nvars; k++) x[k][i] = row.x[k];
    y[i] = row.y;
  });
  return { x, y };
}

// The parameter fresh-name array is attached to every unit so `solve` can read
// it back without re-threading it through the signature.
interface FitUnitWithParams extends FitUnit {
  paramFresh: string[];
}

//
// Public entry points
//

/**
 * Run `body` under the deadline net that keeps a timeout IN BAND.
 *
 * A timeout raised while the setup is still running — evaluating the data
 * operand, differentiating the model, compiling it — is converted to the same
 * record shape a solve-phase timeout produces, tagged `phase: "setup"`. An
 * interpreted model over a few hundred rows can consume an entire ambient
 * budget before the solver ever starts, and a caller that only ever sees a
 * bare `CancellationError` cannot tell that apart from an engine fault.
 * Solve-phase timeouts are caught deeper (inside `solve`/`levenbergMarquardt`)
 * and never reach here. Every other throw propagates unchanged.
 */
function withSetupDeadline(
  ce: IComputeEngine,
  operator: FitOperator,
  body: (ctx: SetupContext) => Expression | undefined
): Expression | undefined {
  const ctx: SetupContext = { operator, phase: 'setup' };
  try {
    return body(ctx);
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    return timeoutRecord(ce, ctx);
  }
}

/** The prepared problem of a lowering (`findFitSetup`, `findRootSetup`):
 * the answer when there is nothing to solve (an inert call, an error), or
 * the units, the parameter specs and the global scans. */
type FitSetup =
  | { done: Expression | undefined }
  | { units: FitUnitWithParams[]; specs: ParamSpec[]; scans: GlobalScan[] };

/** The solve of a prepared problem on the calling thread: the global
 * search when the options name a scan, the single solver run otherwise. */
function solveSetup(
  ce: IComputeEngine,
  setup: FitSetup,
  operator: FitOperator
): Expression | undefined {
  if ('done' in setup) return setup.done;
  const { units, specs, scans } = setup;
  return scans.length > 0
    ? solveGlobal(ce, units, specs, scans, operator)
    : solve(ce, units, specs, operator);
}

/** `FindFit(data, model, params, vars)`. */
export function findFit(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return withSetupDeadline(ce, 'FindFit', (ctx) =>
    solveSetup(ce, findFitSetup(ce, ops, ctx), 'FindFit')
  );
}

/**
 * `FindFit(data, model, params, vars)` on the asynchronous route (the
 * `evaluateAsync` handler of `FindFit`): with a kernel pool on the engine
 * (`ce.workers`), the separable scan of a global search runs on the pool's
 * workers; the solver runs (the refinements, the multi-start, a fit with no
 * `global` option) stay on the calling thread. The record is the one
 * `findFit` gives: the workers solve each grid point with the same code
 * (`linearScanSolve()` in `fit-scan.ts`) on the same numbers, and the plan
 * reads the results by index. Only a search cut short by the deadline can
 * differ, since the pool solves points in another order
 * (`docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.5).
 *
 * The pool is used when the search is separable and every function its
 * scan evaluates compiled to code a worker can run (`storedKernel`).
 * Otherwise, and with no pool, this is `findFit`.
 *
 * The data operand is evaluated with `evaluateAsync(options)`, so data from
 * an operator that has only an asynchronous handler is read, and a long data
 * operand yields to the event loop. `options` are the handler's options in
 * the form an operand evaluation takes (`awaitedOperandOptions()`): the
 * setup and the work on this thread after the `await` run with the
 * evaluation's registry, context stack and precision window
 * (`runWithEvaluationEffects`), as the synchronous handler would.
 *
 * The deadline is the engine's deadline frame at the call: the kernel checks
 * that frame on this thread, and the workers get its time. The engine's
 * iteration limit at the call is sent to the workers.
 *
 * An abort of `options.signal` rejects with a `CancellationError` whose
 * `cause` is the signal's reason, whatever that reason is (a reason of
 * `'timeout'` does not turn into a timeout record). The fit on this thread
 * checks the signal at each row and at each solver iteration, so it stops
 * within a row; a slice that a worker runs finishes on the worker, and its
 * result is dropped.
 */
export async function findFitAsync(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> = {}
): Promise<Expression | undefined> {
  const route = asyncRoute(ce, 'FindFit', options);
  let data: Expression | undefined;
  try {
    checkAborted(options.signal);
    if (ops.length >= 4) data = await ops[0].canonical.evaluateAsync(options);
  } catch (e) {
    return route.timeoutOrThrow(e);
  }
  return solveSetupAsync(ce, route, (ctx) =>
    findFitSetup(ce, ops, ctx, { data, deadlineFrame: route.deadlineFrame })
  );
}

/**
 * `FindRoot(equations, params, options?)` on the asynchronous route (the
 * `evaluateAsync` handler of `FindRoot`): as `findFitAsync`, the separable
 * scan of a global search runs on the engine's kernel pool when it has one;
 * otherwise, and without the `global` option, this is `findRoot`. There is
 * no data operand to evaluate.
 */
export async function findRootAsync(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> = {}
): Promise<Expression | undefined> {
  const route = asyncRoute(ce, 'FindRoot', options);
  try {
    checkAborted(options.signal);
  } catch (e) {
    return route.timeoutOrThrow(e);
  }
  return solveSetupAsync(ce, route, (ctx) =>
    findRootSetup(ce, ops, ctx, route.deadlineFrame)
  );
}

/** What the asynchronous route of a lowering captures at the call: the
 * deadline frame, the setup context, and the helpers that run a step with
 * the evaluation's effects and report a cancellation. */
interface AsyncRoute {
  options: Partial<EvaluateOptions>;
  signal: AbortSignal | undefined;
  frame: DeadlineFrame | undefined;
  deadlineFrame: () => DeadlineFrame | undefined;
  ctx: SetupContext;
  /** Run `f` with the evaluation's registry, context stack and precision
   * window (`runWithEvaluationEffects`), as the synchronous handler would. */
  inContext: <T>(f: () => T) => T;
  /** A cancellation of the signal rejects, whatever its cause; a timeout of
   * the deadline is reported in band, as on the synchronous route. */
  timeoutOrThrow: (e: unknown) => Expression;
  /** A cancellation that the solver read as a timeout (the signal's reason
   * was `'timeout'`) ended the fit early: the signal still rejects. */
  answer: (value: Expression | undefined) => Expression | undefined;
}

function asyncRoute(
  ce: IComputeEngine,
  operator: FitOperator,
  options: Partial<EvaluateOptions>
): AsyncRoute {
  const signal = options.signal;
  const frame = ce._deadlineFrame;
  const ctx: SetupContext = { operator, phase: 'setup' };
  const effects = options._effects;
  return {
    options,
    signal,
    frame,
    deadlineFrame: () => frame,
    ctx,
    inContext: (f) =>
      effects === undefined
        ? f()
        : runWithEvaluationEffects(
            ce,
            effects,
            f,
            options._contextStack,
            options._precisionWindow
          ),
    timeoutOrThrow: (e) => {
      if (!isTimeoutCancellation(e)) throw e;
      checkAborted(signal);
      return timeoutRecord(ce, ctx);
    },
    answer: (value) => {
      checkAborted(signal);
      return value;
    },
  };
}

/**
 * The solve of the asynchronous route, shared by `findFitAsync` and
 * `findRootAsync`: `setup` prepares the problem with the evaluation's
 * effects; a global search whose separable scan compiled to code a worker
 * can run goes to the engine's kernel pool, everything else runs on this
 * thread.
 */
async function solveSetupAsync(
  ce: IComputeEngine,
  route: AsyncRoute,
  setup: (ctx: SetupContext) => FitSetup
): Promise<Expression | undefined> {
  const { signal, frame, deadlineFrame, ctx, inContext, timeoutOrThrow } =
    route;
  const { answer } = route;
  const operator = ctx.operator;
  const pool = fitSlicePool(ce.workers);
  type Pooled = {
    search: GlobalSearch;
    pool: NonNullable<typeof pool>;
    wire: WireFitProblem;
  };
  let pooled: Pooled;
  try {
    const inline = inContext((): { value: Expression | undefined } | Pooled => {
      const prepared0 = setup(ctx);
      if ('done' in prepared0) return { value: prepared0.done };
      const { units, specs, scans } = prepared0;
      if (scans.length === 0)
        return {
          value: solve(ce, units, specs, operator, deadlineFrame, signal),
        };
      const prepared = prepareGlobalSearch(
        ce,
        units,
        specs,
        scans,
        operator,
        deadlineFrame,
        signal
      );
      if ('done' in prepared) return { value: prepared.done };
      if (
        pool === undefined ||
        !prepared.separable ||
        prepared.wire === undefined
      )
        return {
          value: prepared.finish(
            runFitPlanSync(
              prepared.plan(),
              new InlineFitExecutor(prepared.kernel)
            )
          ),
        };
      return { search: prepared, pool, wire: prepared.wire };
    });
    if ('value' in inline) return answer(inline.value);
    pooled = inline;
  } catch (e) {
    return timeoutOrThrow(e);
  }
  const { search, pool: fitPool, wire } = pooled;
  // The kernel's work on this thread (the refinements, the multi-start, a
  // slice that the pool could not take) runs after an `await`: with the
  // evaluation's registry and context stack, for a model that is
  // interpreted.
  const kernel: FitKernel = {
    linearSolveAt: (point, allRows) =>
      inContext(() => search.kernel.linearSolveAt(point, allRows)),
    startRss: (theta0) => inContext(() => search.kernel.startRss(theta0)),
    lm: (theta0) => inContext(() => search.kernel.lm(theta0)),
  };
  try {
    const outcome = await runFitPlanAsync(
      search.plan(),
      new PoolFitExecutor(kernel, fitPool, wire, {
        deadline: frame?.at,
        iterationLimit: ce.iterationLimit,
        signal,
      })
    );
    return answer(inContext(() => search.finish(outcome)));
  } catch (e) {
    // The executors catch the deadline in the tasks; this is the net for
    // one that escapes between them, reported as the synchronous route
    // reports a timeout in the solve.
    return timeoutOrThrow(e);
  } finally {
    fitPool.releaseFit(wire);
  }
}

/**
 * The setup of `FindFit`: parse the operands and the options, evaluate the
 * data, and prepare one unit per model. Returns `{ done }` with the answer
 * when there is nothing to fit (an inert call, an error), or the units, the
 * parameter specs and the global scans.
 *
 * The asynchronous route (`findFitAsync`) gives `evaluated`: the value of the
 * data operand, which it evaluated with `evaluateAsync()`, and the deadline
 * frame it captured at the call, which the final deadline check reads.
 */
function findFitSetup(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  ctx: SetupContext,
  evaluated?: {
    data: Expression | undefined;
    deadlineFrame: () => DeadlineFrame | undefined;
  }
): FitSetup {
  const done = (value: Expression | undefined) => ({ done: value });
  if (ops.length < 4) return done(undefined);
  // The operator is `lazy`, so the operands arrive held and UNBOUND (raw box
  // or parse output). Canonicalize each here to resolve parse sugar
  // (`InvisibleOperator` juxtaposition → `Multiply`) and bind collections —
  // canonicalization does NOT substitute seeded parameter/variable values, so
  // the lazy protection is preserved.
  const dataOp = ops[0].canonical;
  const modelOp = ops[1].canonical;
  const paramsOp = ops[2].canonical;
  const varsOp = ops[3].canonical;

  const specs = parseParamSpecs(paramsOp);
  if (specs === 'error')
    return done(
      ce.error('unexpected-argument', 'FindFit: malformed parameter spec')
    );
  if (!specs) return done(undefined);
  ctx.specs = specs;

  // The optional fifth argument: the options dictionary (`global`).
  const scans = parseFitOptions(ce, ops[4], specs, 'FindFit');
  if (!Array.isArray(scans)) return done(scans);

  const varNames = parseVars(varsOp);
  if (!varNames) return done(undefined);
  const nvars = varNames.length;

  // Model list (joint form) vs single model.
  const models = isFunction(modelOp, 'List') ? [...modelOp.ops] : [modelOp];
  const k = models.length;
  if (k === 0)
    return done(ce.error('unexpected-argument', 'FindFit: empty model list'));

  const data = evaluated?.data ?? dataOp.evaluate();

  // Datasets: one per model (joint), or a single shared/broadcast dataset.
  let datasets: DataRow[][];
  if (k > 1) {
    const perModel = extractDatasetList(data, k, nvars);
    if (perModel) datasets = perModel;
    else {
      const shared = extractDataset(data, nvars);
      if (!shared) return done(undefined);
      datasets = models.map(() => shared);
    }
  } else {
    const ds = extractDataset(data, nvars);
    if (!ds) return done(undefined);
    datasets = [ds];
  }

  const paramNames = specs.map((s) => s.name);
  const avoid = new Set<string>([...varNames, ...paramNames]);
  for (const m of models) for (const u of m.unknowns) avoid.add(u);
  const varFresh = freshNames('_ff_v', nvars, avoid);
  const paramFresh = freshNames('_ff_p', specs.length, avoid);

  const units: FitUnitWithParams[] = [];
  for (let i = 0; i < models.length; i++) {
    const unit = prepareUnit(
      ce,
      models[i],
      datasets[i],
      varNames,
      varFresh,
      paramNames,
      paramFresh,
      scans.length > 0
    );
    if (!unit) return done(undefined); // unresolved symbol → inert
    units.push({ ...unit, paramFresh });
  }

  // A budget that ran out during setup is reported as such. Setup has no
  // other deadline check of its own: the ones it used to reach were inside
  // the evaluation of the data, and written-out data evaluates to itself
  // without a walk.
  checkDeadline(evaluated?.deadlineFrame() ?? ce._deadlineFrame);
  ctx.phase = 'solve';
  return { units, specs, scans };
}

/** `FindRoot(equations, params, options?)`. */
export function findRoot(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return withSetupDeadline(ce, 'FindRoot', (ctx) =>
    solveSetup(ce, findRootSetup(ce, ops, ctx), 'FindRoot')
  );
}

/**
 * The setup of `FindRoot`: parse the equations, the parameter specs and
 * the options, and prepare one unit per equation, each with the single
 * zero-target row. The optional third argument is the options dictionary
 * of `FindFit` (`global`, Tycho row 408): a stacked system of equations
 * (the rows of a fit next to a plain equation) is searched over the range
 * of a parameter as a fit is. The constant phase coefficients of the
 * equations (`3.22` in `cos(3.22 b + c)`) give the basin width of the
 * grid, as the span of a variable does for a fit (`basinWidth`).
 */
function findRootSetup(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  ctx: SetupContext,
  deadlineFrame: () => DeadlineFrame | undefined = () => ce._deadlineFrame
): FitSetup {
  const done = (value: Expression | undefined) => ({ done: value });
  if (ops.length < 2) return done(undefined);
  // See `findFit`: the operands arrive held and unbound, so canonicalize them
  // to resolve parse sugar and bind structure without substituting seeded
  // parameter values.
  const equationsOp = ops[0].canonical;
  const paramsOp = ops[1].canonical;

  const specs = parseParamSpecs(paramsOp);
  if (specs === 'error')
    return done(
      ce.error('unexpected-argument', 'FindRoot: malformed parameter spec')
    );
  if (!specs) return done(undefined);
  ctx.specs = specs;

  // The optional third argument: the options dictionary (`global`).
  const scans = parseFitOptions(ce, ops[2], specs, 'FindRoot');
  if (!Array.isArray(scans)) return done(scans);

  // Equation(s): a list of them, or a single equation/residual.
  const equations = isFunction(equationsOp, 'List')
    ? [...equationsOp.ops]
    : [equationsOp];

  // Residual expression per equation: `lhs − rhs` for an `Equal`, else the
  // expression itself (implicitly `= 0`).
  const residuals = equations.map((eq) =>
    isFunction(eq, 'Equal') && eq.nops === 2
      ? ce.function('Subtract', [eq.op1, eq.op2])
      : eq
  );
  if (residuals.length === 0)
    return done(
      ce.error('unexpected-argument', 'FindRoot: empty equation list')
    );

  const paramNames = specs.map((s) => s.name);
  const avoid = new Set<string>(paramNames);
  for (const r of residuals) for (const u of r.unknowns) avoid.add(u);
  const paramFresh = freshNames('_ff_p', specs.length, avoid);

  const units: FitUnitWithParams[] = [];
  for (const r of residuals) {
    const unit = prepareUnit(
      ce,
      r,
      [{ x: [], y: 0 }],
      [],
      [],
      paramNames,
      paramFresh,
      scans.length > 0
    );
    if (!unit) return done(undefined);
    units.push({ ...unit, paramFresh });
  }

  // A budget that ran out during setup is reported as such. Setup has no
  // other deadline check of its own: the ones it used to reach were inside
  // the evaluation of the data, and written-out data evaluates to itself
  // without a walk.
  checkDeadline(deadlineFrame());
  ctx.phase = 'solve';
  return { units, specs, scans };
}
