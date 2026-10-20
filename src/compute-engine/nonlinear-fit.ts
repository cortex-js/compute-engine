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
  checkDeadline,
  isTimeoutCancellation,
} from '../common/interruptible.js';

import type { Expression, IComputeEngine } from './global-types.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from './boxed-expression/type-guards.js';
import { numberLiteralOf } from './boxed-expression/numerics.js';
import { differentiate } from './symbolic/derivative.js';
import { implicitCompileNumeric } from './implicit-compile.js';
import {
  levenbergMarquardt,
  solveWithInflation,
  type LMResult,
} from './numerics/levenberg-marquardt.js';
import {
  InlineFitExecutor,
  runFitPlanSync,
  type FitBatchResult,
  type FitKernel,
  type FitTask,
  type LinearScanSolution,
  type StartTask,
} from './fit-executor.js';

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

/**
 * Parse the optional fifth `FindFit` argument, a dictionary of options.
 *
 * The only option today is `global`: a dictionary that maps a parameter name
 * to a closed range `(lo, hi)`. Each named parameter is searched over that
 * range for the lowest sum of squared residuals, instead of from its single
 * start (see `solveGlobal`). At most two parameters can be named. The range is
 * intersected with the parameter's own box constraint when the spec has one.
 *
 * Returns the scans (an empty list when nothing is searched globally), or an
 * `unexpected-argument` error for a malformed option. The options argument is
 * strict: an unknown key or a name that is not a parameter is an error, not
 * silently ignored, so that a typo cannot turn a global fit into a local one.
 */
function parseFitOptions(
  ce: IComputeEngine,
  optionsExpr: Expression | undefined,
  specs: ParamSpec[]
): GlobalScan[] | Expression {
  if (optionsExpr === undefined) return [];
  const fail = (msg: string) =>
    ce.error('unexpected-argument', `FindFit: ${msg}`);

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
      // `List`; a `Tuple`/`Pair` built with `ce.tuple()` is accepted too.
      const parts = specParts(rangeExpr.canonical);
      if (!parts || parts.length !== 2)
        return fail(`the global range of "${name}" must be a pair [lo, hi]`);
      const lo = realValue(parts[0]);
      const hi = realValue(parts[1]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi))
        return fail(
          `the global range of "${name}" must be two finite numbers with lo < hi`
        );
      const spec = specs[index];
      const scanLo = Math.max(lo, spec.lo);
      const scanHi = Math.min(hi, spec.hi);
      if (!(scanLo < scanHi))
        return fail(
          `the global range of "${name}" does not overlap its bounds`
        );
      scans.push({ index, lo: scanLo, hi: scanHi });
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
 * function, or fall back to interpreted `subs` + `.N()`. */
function makeNumericFn(
  ce: IComputeEngine,
  expr: Expression,
  freeNames: string[]
): NumFn {
  const compiled = implicitCompileNumeric(ce, expr);
  if (compiled) return compiled;
  return (vars: Record<string, number>) => {
    const sub: Record<string, Expression> = {};
    for (const name of freeNames) sub[name] = ce.number(vars[name] ?? NaN);
    // Match the compiled path (`implicitCompileNumeric`'s projection): a
    // nonzero imaginary part is a domain escape and coerces to NaN, rather
    // than being silently truncated to its real part.
    return realValue(expr.subs(sub));
  };
}

/**
 * Prepare a single unit: rename var/param symbols to fresh names, verify the
 * renamed model has no unresolved free symbol, then build the model function
 * and its per-parameter derivatives.
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
  paramFresh: string[]
): FitUnit | undefined {
  const rename: Record<string, Expression> = {};
  varNames.forEach((n, k) => (rename[n] = ce.symbol(varFresh[k])));
  paramNames.forEach((n, j) => (rename[n] = ce.symbol(paramFresh[j])));

  const renamed = modelExpr.canonical.subs(rename).canonical;

  const allowed = new Set([...varFresh, ...paramFresh]);
  for (const u of renamed.unknowns) if (!allowed.has(u)) return undefined;

  const freeNames = [...varFresh, ...paramFresh];
  const fn = makeNumericFn(ce, renamed, freeNames);

  const deriv: (NumFn | null)[] = [];
  const derivUnknowns: (ReadonlySet<string> | null)[] = [];
  const stepLike: boolean[] = [];
  for (const pf of paramFresh) {
    const d = differentiate(renamed, pf);
    // Fall back to finite differences when the column cannot be differentiated
    // symbolically, or when the derivative is left as an un-evaluable
    // `Derivative(…)` placeholder (e.g. `∂Zeta(b·x)/∂b`).
    if (d === undefined || d.has('Derivative')) {
      deriv.push(null);
      derivUnknowns.push(null);
      stepLike.push(false);
    } else {
      deriv.push(makeNumericFn(ce, d, freeNames));
      derivUnknowns.push(new Set(d.unknowns));
      stepLike.push(d.isSame(0) && renamed.has(pf));
    }
  }

  return { fn, deriv, derivUnknowns, stepLike, rows, varFresh };
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
  /** Parameter specs, once parsed — their starts are the only values we can
   * honestly report when no solve ran. Absent if the deadline fired first. */
  specs?: ParamSpec[];
  /** Set once control passes to `solve`, so a timeout escaping from there is
   * not mislabelled `"setup"`. */
  phase: FitPhase;
}

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
      residualNorm: NaN,
      iterations: 0,
      timedOut: true,
    },
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

/** Assemble the residual/Jacobian callbacks over all units. */
function makeCallbacks(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[]
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
        checkDeadline(ce._deadlineFrame);
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

/** Run LM from the single start of the specs and report the record. */
function solve(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[]
): Expression | undefined {
  // Defensive: an empty model/equation list yields zero units; `units[0]`
  // in `makeCallbacks` would otherwise throw (see the guards in
  // `findFit`/`findRoot`).
  if (units.length === 0)
    return ce.error('unexpected-argument', 'no residual units');

  const theta0 = specs.map((s) => s.start);
  const { lo, hi, residual, jacobian } = makeCallbacks(ce, units, specs);

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
      onIteration: () => checkDeadline(ce._deadlineFrame),
    });
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    result = {
      theta: theta0.map((v, j) => clamp(v, lo[j], hi[j])),
      converged: false,
      residualNorm: NaN,
      iterations: 0,
      timedOut: true,
    };
  }

  return buildRecord(
    ce,
    specs.map((s) => s.name),
    result
  );
}

//
// Global fit (the `global` option, Tycho row 404)
//

/** Grid resolution per scanned parameter. The separable scan is cheap (one
 * linear solve per grid point), so it can afford a fine grid; a multi-start
 * runs a full LM solve per grid point, so its grid is coarse. */
const SEPARABLE_GRID = [400, 40];
const MULTISTART_GRID = [24, 6];
/** How many grid-point local minima the separable scan refines by LM. */
const SEPARABLE_REFINEMENTS = 6;

/** Sum of squares of a residual vector, or `Infinity` for a non-finite one. */
function sumOfSquares(r: number[]): number {
  let s = 0;
  for (const v of r) s += v * v;
  return Number.isFinite(s) ? s : Infinity;
}

/**
 * The grid of scanned-parameter values: `n` points per scanned parameter,
 * endpoints included (a minimizer pressed against a bound of the range is a
 * legitimate answer), as the Cartesian product over one or two parameters.
 * Each point is the list of values in the order of `scans`.
 */
function scanGrid(scans: GlobalScan[], n: number): number[][] {
  const axis = (s: GlobalScan): number[] =>
    Array.from({ length: n }, (_, i) => s.lo + ((s.hi - s.lo) * i) / (n - 1));
  if (scans.length === 1) return axis(scans[0]).map((v) => [v]);
  const grid: number[][] = [];
  for (const u of axis(scans[0]))
    for (const v of axis(scans[1])) grid.push([u, v]);
  return grid;
}

/**
 * Indices of the grid points that are local minima of `rss` over the grid: no
 * finite neighbour is lower (one dimension: the two neighbours; two: the eight
 * surrounding cells of the `n × n` grid laid out row-major by `scanGrid`).
 * Non-finite points are never minima.
 */
function gridLocalMinima(rss: number[], dims: number, n: number): number[] {
  const minima: number[] = [];
  const lowerNeighbour = (i: number, offsets: number[]): boolean =>
    offsets.some((o) => rss[o] < rss[i]);
  for (let i = 0; i < rss.length; i++) {
    if (!Number.isFinite(rss[i])) continue;
    const neighbours: number[] = [];
    if (dims === 1) {
      if (i > 0) neighbours.push(i - 1);
      if (i < n - 1) neighbours.push(i + 1);
    } else {
      const row = Math.floor(i / n);
      const col = i % n;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (r >= 0 && r < n && c >= 0 && c < n) neighbours.push(r * n + c);
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
   * during the scan): the vector and its sum of squared residuals. */
  bestScanned: [number[], number] | undefined;
  /** Total over every solver run. */
  iterations: number;
  timedOut: boolean;
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
 */
function* globalSearchPlan(
  separable: boolean,
  scans: GlobalScan[],
  thetaAt: (point: number[]) => number[]
): Generator<
  FitTask[],
  GlobalSearchOutcome | 'no-finite-value',
  FitBatchResult
> {
  let iterations = 0;
  let timedOut = false;
  let best: LMResult | undefined;
  let bestScanned: [number[], number] | undefined;
  const outcome = (): GlobalSearchOutcome => ({
    best,
    bestScanned,
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

  const dims = scans.length;
  if (separable) {
    const n = SEPARABLE_GRID[dims - 1];
    const grid = scanGrid(scans, n);
    const tasks: FitTask[] = grid.map((point, index) => ({
      kind: 'linear',
      index,
      point,
    }));
    const batch = yield tasks;
    // A point that turned out nonlinear means the structural test was wrong
    // about this model: the multi-start below takes over. The points before
    // it are genuine evaluated points, so `bestScanned` keeps the best of
    // them; the points after it are not read, which is what the serial loop
    // gave when it stopped there.
    let firstNonlinear = Infinity;
    for (const r of batch.results)
      if (r.kind === 'linear' && r.solved === 'nonlinear')
        firstNonlinear = Math.min(firstNonlinear, r.index);
    const solved: LinearScanSolution[] = new Array(grid.length).fill(null);
    // In task order, so that a tie on the residual goes to the lowest index
    // whatever order the results arrived in.
    const byIndex = [...batch.results].sort((a, b) => a.index - b.index);
    for (const r of byIndex) {
      if (r.kind !== 'linear' || r.index >= firstNonlinear) continue;
      solved[r.index] = r.solved;
      if (r.solved !== null && r.solved !== 'nonlinear')
        considerScanned(r.solved[0], r.solved[1]);
    }
    if (batch.timedOut) {
      // A deadline expiring inside the scan: whatever was found so far is
      // reported, with no refinement. This comes before the nonlinear check
      // on purpose: once the deadline has passed, a multi-start would time
      // out in its first start, so the scanned points are the answer.
      timedOut = true;
      return outcome();
    }
    if (firstNonlinear !== Infinity) separable = false;
    else {
      if (bestScanned === undefined) return 'no-finite-value';
      const rss = solved.map((s) =>
        s !== null && s !== 'nonlinear' ? s[1] : Infinity
      );
      const candidates = gridLocalMinima(rss, dims, n)
        .sort((i, k) => rss[i] - rss[k])
        .slice(0, SEPARABLE_REFINEMENTS);
      const refinements: StartTask[] = candidates.map((i, index) => ({
        kind: 'start',
        index,
        theta0: (solved[i] as [number[], number])[0],
        checkStart: false,
      }));
      takeStarts(refinements, yield refinements);
      return outcome();
    }
  }
  const n = MULTISTART_GRID[dims - 1];
  const starts: StartTask[] = scanGrid(scans, n).map((point, index) => ({
    kind: 'start',
    index,
    theta0: thetaAt(point),
    checkStart: true,
  }));
  const batch = yield starts;
  takeStarts(starts, batch);
  // No start had a finite residual, and the deadline did not cut the batch
  // short (a cut batch is reported with what it has, as the serial loop did
  // when the deadline expired inside a start's evaluation).
  if (bestScanned === undefined && !batch.timedOut) return 'no-finite-value';
  return outcome();
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
 * refinement, so the answer lies inside the range. The record is the usual
 * one; its `iterations` is the total over every LM run. A deadline that
 * expires during the scan or a refinement returns the best point found so far
 * with `timedOut: True`.
 */
function solveGlobal(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[],
  scans: GlobalScan[]
): Expression | undefined {
  if (units.length === 0)
    return ce.error('unexpected-argument', 'no residual units');

  const p = specs.length;
  const cb = makeCallbacks(ce, units, specs);
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

  /** Separable step: with the scanned parameters fixed at `point`, solve the
   * linear parameters by least squares. The model is linear in them, so with
   * them at zero `unit.fn` is the offset and each analytic derivative is the
   * basis column of its parameter. A linear parameter with a box constraint
   * is solved by an active-set loop: a value outside its bounds is fixed at
   * the bound it crossed, its column moves to the offset, and the free
   * parameters are solved again, until every free value is inside its bounds.
   * The sum of squared residuals the linear system predicts is then compared
   * with the model's actual residual at the solved point: a disagreement means
   * the model is not linear in those parameters after all (a step function the
   * structural test did not see), and the answer is `'nonlinear'` so the
   * caller falls back to the multi-start. Returns the full vector and its sum
   * of squared residuals, or `null` when the normal equations cannot be solved
   * or the point is not finite. */
  const linearSolveAt = (
    point: number[]
  ): [number[], number] | null | 'nonlinear' => {
    const theta = thetaAt(point);
    for (const j of linearIdx) theta[j] = 0;
    const nl = linearIdx.length;
    // Per data row: the offset (the model with the linear parameters at zero)
    // and the basis column values, kept for the active-set loop and the check.
    const offsets: number[] = [];
    const targets: number[] = [];
    const columns: number[][] = [];
    let finite = true;
    cb.eachRow(theta, (unit, row, rec) => {
      const offset = unit.fn(rec);
      const phi = linearIdx.map((j) => unit.deriv[j]!(rec));
      if (!Number.isFinite(offset) || phi.some((v) => !Number.isFinite(v))) {
        finite = false;
        return;
      }
      offsets.push(offset);
      targets.push(row.y);
      columns.push(phi);
    });
    if (!finite) return null;

    // Active-set loop over the linear parameters: `fixed[a]` holds the bound a
    // parameter is pinned at, or NaN while it is free.
    const fixed: number[] = new Array(nl).fill(NaN);
    for (let pass = 0; pass <= nl; pass++) {
      const free: number[] = [];
      for (let a = 0; a < nl; a++) if (Number.isNaN(fixed[a])) free.push(a);
      const nf = free.length;
      const A: number[][] = Array.from({ length: nf }, () =>
        new Array(nf).fill(0)
      );
      const b: number[] = new Array(nf).fill(0);
      for (let r = 0; r < columns.length; r++) {
        const phi = columns[r];
        let target = targets[r] - offsets[r];
        for (let a = 0; a < nl; a++)
          if (!Number.isNaN(fixed[a])) target -= phi[a] * fixed[a];
        for (let u = 0; u < nf; u++) {
          b[u] += phi[free[u]] * target;
          for (let v = 0; v < nf; v++) A[u][v] += phi[free[u]] * phi[free[v]];
        }
      }
      const sol = nf > 0 ? solveWithInflation(A, b) : [];
      if (!sol) return null;
      let crossed = false;
      free.forEach((a, u) => {
        const j = linearIdx[a];
        if (sol[u] < lo[j]) {
          fixed[a] = lo[j];
          crossed = true;
        } else if (sol[u] > hi[j]) {
          fixed[a] = hi[j];
          crossed = true;
        } else theta[j] = sol[u];
      });
      if (!crossed) break;
    }
    for (let a = 0; a < nl; a++)
      if (!Number.isNaN(fixed[a])) theta[linearIdx[a]] = fixed[a];

    // The linear prediction against the model itself at the solved point.
    let predicted = 0;
    for (let r = 0; r < columns.length; r++) {
      let value = offsets[r];
      for (let a = 0; a < nl; a++) value += columns[r][a] * theta[linearIdx[a]];
      predicted += (value - targets[r]) ** 2;
    }
    const rss = sumOfSquares(cb.residual(theta));
    if (!Number.isFinite(rss)) return null;
    if (Math.abs(rss - predicted) > 1e-8 * (1 + rss + predicted))
      return 'nonlinear';
    return [theta, rss];
  };

  // The pure-number operations of a task (`fit-executor.ts`): the plan below
  // decides which tasks to run, the executor runs them. Today the executor
  // runs them here, in order; the plan is written so that a worker pool can
  // run the same tasks (design: `docs/plans/2026-10-20-worker-kernel-pool.md`,
  // section 5.5).
  const kernel: FitKernel = {
    linearSolveAt,
    startRss: (theta0) => sumOfSquares(cb.residual(theta0)),
    lm: (theta0) =>
      levenbergMarquardt(cb.residual, cb.jacobian, theta0, {
        lo,
        hi,
        onIteration: () => checkDeadline(ce._deadlineFrame),
      }),
  };
  const outcome = runFitPlanSync(
    globalSearchPlan(separable, scans, thetaAt),
    new InlineFitExecutor(kernel)
  );
  if (outcome === 'no-finite-value')
    return ce.error(
      'unexpected-argument',
      'FindFit: the model has no finite value in the global range'
    );
  const { best, bestScanned, iterations, timedOut } = outcome;

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
    return buildRecord(ce, names, {
      theta,
      converged: false,
      residualNorm: Math.sqrt(rss),
      iterations,
      ...(timedOut ? { timedOut: true } : {}),
    });
  }
  if (best === undefined) {
    // Nothing was evaluated before the budget expired: the lower corner of
    // the range, with no residual.
    return buildRecord(ce, names, {
      theta: thetaAt(scans.map((s) => s.lo)),
      converged: false,
      residualNorm: NaN,
      iterations,
      ...(timedOut ? { timedOut: true } : {}),
    });
  }
  // A search cut short by the deadline did not examine every candidate, so
  // it never reports convergence, even when the winning run converged.
  return buildRecord(ce, names, {
    ...best,
    converged: best.converged && !timedOut,
    iterations,
    ...(timedOut ? { timedOut: true } : {}),
  });
}

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

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
  body: (ctx: SetupContext) => Expression | undefined
): Expression | undefined {
  const ctx: SetupContext = { phase: 'setup' };
  try {
    return body(ctx);
  } catch (e) {
    if (!isTimeoutCancellation(e)) throw e;
    return timeoutRecord(ce, ctx);
  }
}

/** `FindFit(data, model, params, vars)`. */
export function findFit(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return withSetupDeadline(ce, (ctx) => findFitCore(ce, ops, ctx));
}

function findFitCore(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  ctx: SetupContext
): Expression | undefined {
  if (ops.length < 4) return undefined;
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
    return ce.error('unexpected-argument', 'FindFit: malformed parameter spec');
  if (!specs) return undefined;
  ctx.specs = specs;

  // The optional fifth argument: the options dictionary (`global`).
  const scans = parseFitOptions(ce, ops[4], specs);
  if (!Array.isArray(scans)) return scans;

  const varNames = parseVars(varsOp);
  if (!varNames) return undefined;
  const nvars = varNames.length;

  // Model list (joint form) vs single model.
  const models = isFunction(modelOp, 'List') ? [...modelOp.ops] : [modelOp];
  const k = models.length;
  if (k === 0)
    return ce.error('unexpected-argument', 'FindFit: empty model list');

  const data = dataOp.evaluate();

  // Datasets: one per model (joint), or a single shared/broadcast dataset.
  let datasets: DataRow[][];
  if (k > 1) {
    const perModel = extractDatasetList(data, k, nvars);
    if (perModel) datasets = perModel;
    else {
      const shared = extractDataset(data, nvars);
      if (!shared) return undefined;
      datasets = models.map(() => shared);
    }
  } else {
    const ds = extractDataset(data, nvars);
    if (!ds) return undefined;
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
      paramFresh
    );
    if (!unit) return undefined; // unresolved symbol → inert
    units.push({ ...unit, paramFresh });
  }

  // A budget that ran out during setup is reported as such. Setup has no
  // other deadline check of its own: the ones it used to reach were inside
  // the evaluation of the data, and written-out data evaluates to itself
  // without a walk.
  checkDeadline(ce._deadlineFrame);
  ctx.phase = 'solve';
  return scans.length > 0
    ? solveGlobal(ce, units, specs, scans)
    : solve(ce, units, specs);
}

/** `FindRoot(equations, params)`. */
export function findRoot(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return withSetupDeadline(ce, (ctx) => findRootCore(ce, ops, ctx));
}

function findRootCore(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>,
  ctx: SetupContext
): Expression | undefined {
  if (ops.length < 2) return undefined;
  // See `findFit`: the operands arrive held and unbound, so canonicalize them
  // to resolve parse sugar and bind structure without substituting seeded
  // parameter values.
  const equationsOp = ops[0].canonical;
  const paramsOp = ops[1].canonical;

  const specs = parseParamSpecs(paramsOp);
  if (specs === 'error')
    return ce.error(
      'unexpected-argument',
      'FindRoot: malformed parameter spec'
    );
  if (!specs) return undefined;
  ctx.specs = specs;

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
    return ce.error('unexpected-argument', 'FindRoot: empty equation list');

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
      paramFresh
    );
    if (!unit) return undefined;
    units.push({ ...unit, paramFresh });
  }

  // A budget that ran out during setup is reported as such. Setup has no
  // other deadline check of its own: the ones it used to reach were inside
  // the evaluation of the data, and written-out data evaluates to itself
  // without a walk.
  checkDeadline(ce._deadlineFrame);
  ctx.phase = 'solve';
  return solve(ce, units, specs);
}
