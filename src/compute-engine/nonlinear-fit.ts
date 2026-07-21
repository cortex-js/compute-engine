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

import { checkDeadline } from '../common/interruptible.js';

import type { Expression, IComputeEngine } from './global-types.js';
import { isFunction, isSymbol } from './boxed-expression/type-guards.js';
import { differentiate } from './symbolic/derivative.js';
import { implicitCompile } from './implicit-compile.js';
import {
  levenbergMarquardt,
  type LMResult,
} from './numerics/levenberg-marquardt.js';

type NumFn = (vars: Record<string, number>) => number;

interface ParamSpec {
  name: string;
  start: number;
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
  const v = expr.N();
  return v.im === 0 ? v.re : NaN;
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
  const compiled = implicitCompile(ce, expr, { realOnly: true });
  if (compiled?.success) return compiled.run as NumFn;
  return (vars: Record<string, number>) => {
    const sub: Record<string, Expression> = {};
    for (const name of freeNames) sub[name] = ce.number(vars[name] ?? NaN);
    // Match the compiled path (`wrapRealOnly` in the JS target): a nonzero
    // imaginary part is a domain escape and coerces to NaN, rather than being
    // silently truncated to its real part.
    const v = expr.subs(sub).N();
    return v.im === 0 ? v.re : NaN;
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

  const deriv: (NumFn | null)[] = paramFresh.map((pf) => {
    const d = differentiate(renamed, pf);
    // Fall back to finite differences when the column cannot be differentiated
    // symbolically, or when the derivative is left as an un-evaluable
    // `Derivative(…)` placeholder (e.g. `∂Zeta(b·x)/∂b`).
    if (d === undefined || d.has('Derivative')) return null;
    return makeNumericFn(ce, d, freeNames);
  });

  return { fn, deriv, rows, varFresh };
}

//
// Solve + report
//

const FALSE_ = (ce: IComputeEngine) => ce.symbol('False');
const TRUE_ = (ce: IComputeEngine) => ce.symbol('True');

/** Build the `Dictionary` result record. */
function buildRecord(
  ce: IComputeEngine,
  paramNames: string[],
  result: LMResult
): Expression {
  const paramEntries = paramNames.map((name, j) =>
    ce.tuple(ce.string(name), ce.number(result.theta[j]))
  );
  const paramsDict = ce.function('Dictionary', paramEntries);
  return ce.function('Dictionary', [
    ce.tuple(ce.string('parameters'), paramsDict),
    ce.tuple(ce.string('converged'), result.converged ? TRUE_(ce) : FALSE_(ce)),
    ce.tuple(ce.string('residualNorm'), ce.number(result.residualNorm)),
    ce.tuple(ce.string('iterations'), ce.number(result.iterations)),
  ]);
}

/** Assemble the global residual/Jacobian callbacks over all units and run LM. */
function solve(
  ce: IComputeEngine,
  units: FitUnit[],
  specs: ParamSpec[]
): Expression | undefined {
  // Defensive: an empty model/equation list yields zero units; `units[0]`
  // below would otherwise throw (see the guards in `findFit`/`findRoot`).
  if (units.length === 0)
    return ce.error('unexpected-argument', 'no residual units');

  const p = specs.length;
  const theta0 = specs.map((s) => s.start);
  const lo = specs.map((s) => s.lo);
  const hi = specs.map((s) => s.hi);

  // Fresh parameter names are shared across all units by construction.
  const pFresh = (units[0] as FitUnitWithParams).paramFresh;

  const record: Record<string, number> = {};

  const residual = (theta: number[]): number[] => {
    for (let j = 0; j < p; j++) record[pFresh[j]] = theta[j];
    const out: number[] = [];
    for (const unit of units) {
      for (const row of unit.rows) {
        for (let k = 0; k < unit.varFresh.length; k++)
          record[unit.varFresh[k]] = row.x[k];
        out.push(unit.fn(record) - row.y);
      }
    }
    return out;
  };

  const jacobian = (theta: number[]): number[][] => {
    for (let j = 0; j < p; j++) record[pFresh[j]] = theta[j];
    const rowsJ: number[][] = [];
    for (const unit of units) {
      for (const row of unit.rows) {
        for (let k = 0; k < unit.varFresh.length; k++)
          record[unit.varFresh[k]] = row.x[k];
        const base = unit.fn(record);
        const jr = new Array(p).fill(0);
        for (let j = 0; j < p; j++) {
          const d = unit.deriv[j];
          if (d) {
            jr[j] = d(record);
          } else {
            // Finite difference for this column only. The step is scaled to
            // the parameter magnitude (no underflow near θⱼ = 0), and the
            // probe stays inside `[lo, hi]`: forward unless that overshoots
            // `hi[j]`, and if the first probe is non-finite (a box-guarded
            // model can NaN at an infeasible point) retry the other direction.
            const t = theta[j];
            const h = Math.sqrt(Number.EPSILON) * Math.max(1, Math.abs(t));
            let step = t + h <= hi[j] ? h : -h;
            record[pFresh[j]] = t + step;
            let probe = unit.fn(record);
            if (!Number.isFinite(probe)) {
              const alt = -step;
              if (t + alt <= hi[j] && t + alt >= lo[j]) {
                step = alt;
                record[pFresh[j]] = t + step;
                probe = unit.fn(record);
              }
            }
            record[pFresh[j]] = t;
            jr[j] = (probe - base) / step;
          }
        }
        rowsJ.push(jr);
      }
    }
    return rowsJ;
  };

  // NaN at the starting point is a hard failure (§ 3.3).
  const r0 = residual(theta0.map((v, j) => clamp(v, lo[j], hi[j])));
  if (r0.some((v) => !Number.isFinite(v)))
    return ce.error('unexpected-argument', 'starting point is not finite');

  const result = levenbergMarquardt(residual, jacobian, theta0, {
    lo,
    hi,
    onIteration: () => checkDeadline(ce._deadlineFrame),
  });

  return buildRecord(
    ce,
    specs.map((s) => s.name),
    result
  );
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

/** `FindFit(data, model, params, vars)`. */
export function findFit(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
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

  return solve(ce, units, specs);
}

/** `FindRoot(equations, params)`. */
export function findRoot(
  ce: IComputeEngine,
  ops: ReadonlyArray<Expression>
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

  return solve(ce, units, specs);
}
