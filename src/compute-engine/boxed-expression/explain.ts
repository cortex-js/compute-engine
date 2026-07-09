import type {
  Expression,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ExplainStep,
  RuleStep,
  RuleSteps,
  SimplifyOptions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { simplify } from './simplify.js';
import { findUnivariateRoots, rootsAsEquations } from './solve.js';
import { filterRootsByAssumptions } from './solve-domain.js';
import { solveSystem } from './solve-system.js';
import { normalizedUnknownsForSolve } from './utils.js';
import { isFunction } from './type-guards.js';
import { labelFor } from './explain-labels.js';

/**
 * Driver-internal markers in the raw simplify trace that are not
 * mathematical steps: they are filtered out at `'default'` verbosity.
 * (`'initial'` is the seed step — it becomes `Explanation.initial`.)
 */
const BOOKKEEPING_IDS = new Set(['initial', 'simplified operands']);

/**
 * Build a structured, step-by-step `Explanation` for an operation applied
 * to `expr`. See `BoxedExpression.explain()` for the public contract.
 *
 * The explanation runs the same engine code as the plain method — for
 * `'simplify'`, the internal `simplify()` already threads a complete
 * `RuleSteps` chain; this function curates and labels it.
 */
// The `explain('D')` driver lives in symbolic/explain-derivative.ts (it
// needs symbolic/derivative.ts, which this boxed-expression layer must not
// import). It registers itself through this setter when the calculus
// library loads.
type ExplainDDriver = (
  expr: Expression,
  options?: ExplainOptions
) => Explanation;
let _explainDDriver: ExplainDDriver | undefined;
/** @internal */
export function _setExplainDDriver(fn: ExplainDDriver): void {
  _explainDDriver = fn;
}

export function explainExpression(
  expr: Expression,
  operation: ExplainOperation = 'simplify',
  options?: ExplainOptions
): Explanation {
  if (operation === 'solve') return explainSolve(expr, options);

  if (operation === 'D') {
    if (_explainDDriver) return _explainDDriver(expr, options);
    throw new Error(
      'explain("D") requires the calculus library, which is not loaded'
    );
  }

  if (operation !== 'simplify') {
    throw new Error(
      `explain("${operation}") is not supported: use "simplify", "solve" or "D"`
    );
  }

  const {
    verbosity,
    variable: _variable,
    order: _order,
    ...simplifyOptions
  } = options ?? {};

  const raw = withDeadline(expr.engine, () =>
    simplify(expr, simplifyOptions as Partial<SimplifyOptions>)
  )();

  return explanationFromRuleSteps('simplify', raw, verbosity ?? 'default');
}

/**
 * Explanation of `solve()`. Dispatches — mirroring the plain `solve()`
 * (boxed-function.ts) — on the receiver:
 *
 * - a `List`/`And` of `Equal` equations → a traced system solve,
 * - an `Or` of univariate alternatives → per-case sub-chains merged,
 * - otherwise a univariate equation.
 *
 * Every path threads the trace accumulator through the same helpers the
 * plain `solve()` runs (pure observation), so the result is identical to
 * what `solve()` returns.
 */
function explainSolve(expr: Expression, options?: ExplainOptions): Explanation {
  const ce = expr.engine;
  const canonical = expr.canonical;
  const operator = canonical.operator;
  const verbosity = options?.verbosity ?? 'default';

  const varNames = normalizedUnknownsForSolve(
    options?.variable ?? canonical.unknowns
  );
  if (varNames.length < 1)
    throw new Error(
      'explain("solve") requires at least one unknown: specify it with options.variable'
    );

  // Systems of equations. Mirror the plain `solve()` dispatch: try the system
  // path, then fall through to univariate when it declines (`solveSystem`
  // returns null) and there is exactly one unknown.
  if (operator === 'List' || operator === 'And') {
    const systemEx = explainSolveSystem(ce, canonical, varNames, verbosity);
    if (systemEx !== null) return systemEx;
  }

  // Alternatives: solve each operand's univariate pipeline, merge the roots.
  if (operator === 'Or')
    return explainSolveOr(ce, canonical, varNames, verbosity);

  if (varNames.length !== 1)
    throw new Error(
      'explain("solve") requires exactly one unknown: specify it with options.variable'
    );

  return explainSolveUnivariate(ce, canonical, varNames[0], verbosity);
}

/**
 * Univariate solve: the same `findUnivariateRoots` + assumptions-filter
 * pipeline the plain `solve()` runs, with the trace accumulator attached.
 * Step values are *equations* — the state of the equation after each phase —
 * ending with the candidate roots, rejected candidates (if any), and the
 * solution set.
 */
function explainSolveUnivariate(
  ce: ComputeEngine,
  canonical: Expression,
  x: string,
  verbosity: 'default' | 'all'
): Explanation {
  // Step 0: the equation being solved (an expression `f` reads as `f = 0`)
  const initial = isFunction(canonical, 'Equal')
    ? canonical
    : ce.function('Equal', [canonical, ce.Zero]);

  const trace: RuleSteps = [];
  const roots = findUnivariateRoots(canonical, x, 0, trace);
  const filtered = filterRootsByAssumptions(ce, roots, x);

  if (filtered.length < roots.length) {
    const dropped = roots.filter((r) => !filtered.some((f) => f.isSame(r)));
    trace.push({
      value: rootsAsEquations(ce, x, dropped),
      because: 'solve.filter-domain',
    });
  }

  if (filtered.length > 0)
    trace.push({
      value: rootsAsEquations(ce, x, filtered),
      because: 'solve.roots',
    });

  const result = ce.function('List', [...filtered]);

  return {
    operation: 'solve',
    initial,
    result,
    steps: curateChain(initial, trace, verbosity),
  };
}

/**
 * System of equations (a `List`/`And` of `Equal`): the same `solveSystem`
 * dispatch the plain `solve()` runs, with the trace attached. Returns `null`
 * when the system path declines (so the caller can fall through to the
 * univariate path). Throws for inequality or mixed systems (out of scope).
 *
 * Step values are the whole system as a `List` of equations — the state after
 * each Gaussian-elimination / back-substitution phase — ending with the
 * solution(s) as `List(Equal(x, …), Equal(y, …))`.
 */
function explainSolveSystem(
  ce: ComputeEngine,
  canonical: Expression,
  varNames: string[],
  verbosity: 'default' | 'all'
): Explanation | null {
  const equations = isFunction(canonical) ? canonical.ops : [];
  const inequalityOps = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];
  if (equations.some((eq) => inequalityOps.includes(eq.operator ?? ''))) {
    const allInequality = equations.every((eq) =>
      inequalityOps.includes(eq.operator ?? '')
    );
    throw new Error(
      allInequality
        ? 'explain("solve") does not support systems of inequalities'
        : 'explain("solve") does not support mixed equality and inequality systems'
    );
  }

  // Only pure systems of equations are traced; anything else declines.
  if (equations.length === 0 || !equations.every((eq) => eq.operator === 'Equal'))
    return null;

  const trace: RuleSteps = [];
  const solution = solveSystem(ce, equations, varNames, trace);
  if (solution === null) return null;

  const result = systemSolutionToExpression(ce, varNames, solution);
  trace.push({ value: result, because: 'solve.roots' });

  const initial = ce.function('List', [...equations]);

  return {
    operation: 'solve',
    initial,
    result,
    steps: curateChain(initial, trace, verbosity),
  };
}

/** A single solution record as `List(Equal(x, …), Equal(y, …))` in
 * `varNames` order (free/parametric variables absent from the record are
 * omitted). */
function recordToEquationList(
  ce: ComputeEngine,
  varNames: string[],
  record: Record<string, Expression>
): Expression {
  const eqs: Expression[] = [];
  for (const v of varNames)
    if (v in record)
      eqs.push(ce.function('Equal', [ce.symbol(v), record[v]]));
  return ce.function('List', eqs);
}

/** The result representation for a system: a single record becomes a `List`
 * of `Equal`s; multiple records become a `List` of such `List`s. */
function systemSolutionToExpression(
  ce: ComputeEngine,
  varNames: string[],
  solution: Record<string, Expression> | Array<Record<string, Expression>>
): Expression {
  if (Array.isArray(solution))
    return ce.function(
      'List',
      solution.map((rec) => recordToEquationList(ce, varNames, rec))
    );
  return recordToEquationList(ce, varNames, solution);
}

/**
 * Alternatives (`Or`) of univariate equations: solve each operand's
 * univariate pipeline (with its trace), then merge the roots with the same
 * JSON-key dedup as the plain `solveOr()`. A per-operand `'solve.case'` step
 * frames each branch; a final `'solve.roots'` step holds the merged union.
 */
function explainSolveOr(
  ce: ComputeEngine,
  canonical: Expression,
  varNames: string[],
  verbosity: 'default' | 'all'
): Explanation {
  if (varNames.length !== 1)
    throw new Error(
      'explain("solve") does not support multivariate alternatives (Or): explain one case at a time'
    );
  const x = varNames[0];
  const operands = isFunction(canonical) ? canonical.ops : [];

  const trace: RuleSteps = [];
  const seen = new Set<string>();
  const merged: Expression[] = [];

  for (const op of operands) {
    trace.push({
      value: isFunction(op, 'Equal') ? op : ce.function('Equal', [op, ce.Zero]),
      because: 'solve.case',
    });

    // The operand's univariate pipeline, with its trace (pure observation).
    const roots = findUnivariateRoots(op, x, 0, trace);
    const filtered = filterRootsByAssumptions(ce, roots, x);
    if (filtered.length < roots.length) {
      const dropped = roots.filter((r) => !filtered.some((f) => f.isSame(r)));
      trace.push({
        value: rootsAsEquations(ce, x, dropped),
        because: 'solve.filter-domain',
      });
    }

    for (const r of filtered) {
      const key = JSON.stringify(r.json);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }
  }

  const result = ce.function('List', [...merged]);
  trace.push({
    value: rootsAsEquations(ce, x, merged),
    because: 'solve.roots',
  });

  return {
    operation: 'solve',
    initial: canonical,
    result,
    steps: curateChain(canonical, trace, verbosity),
  };
}

/**
 * Curate a state-progression chain (each step's `value` is the whole
 * state after the step): at `'default'` verbosity, steps whose value is
 * unchanged from the previous state are dropped.
 *
 * @internal used by the solve and D explanation builders
 */
export function curateChain(
  initial: Expression,
  trace: RuleSteps,
  verbosity: 'default' | 'all'
): ExplainStep[] {
  if (verbosity === 'all') return trace.map(toExplainStep);

  const steps: ExplainStep[] = [];
  let prev: Expression = initial;
  for (const s of trace) {
    if (s.value.isSame(prev)) continue;
    steps.push(toExplainStep(s));
    prev = s.value;
  }
  return steps;
}

/**
 * Curate and label a raw `RuleSteps` chain into an `Explanation`.
 *
 * The chain's step 0 (the `'initial'` seed) becomes `initial`; the last
 * value is `result` — the same value the plain method returns.
 */
function explanationFromRuleSteps(
  operation: ExplainOperation,
  raw: RuleSteps,
  verbosity: 'default' | 'all'
): Explanation {
  const initial = raw[0].value;
  const result = raw.at(-1)!.value;

  if (verbosity === 'all')
    return {
      operation,
      initial,
      result,
      steps: raw.slice(1).map(toExplainStep),
    };

  const steps: ExplainStep[] = [];
  let prev = initial;
  for (const s of raw.slice(1)) {
    if (BOOKKEEPING_IDS.has(s.because)) continue;
    if (s.value.isSame(prev)) continue;
    steps.push(toExplainStep(s));
    prev = s.value;
  }

  // Tail repair: if the chain ended on a filtered bookkeeping step that did
  // real work (e.g. a final operand simplification), the curated chain would
  // stop short of the result. Close it with a generic step so the last step
  // value always matches `result`.
  if (!prev.isSame(result)) {
    const { id, description } = labelFor('simplify-terms');
    steps.push({ value: result, id, description });
  }

  return { operation, initial, result, steps };
}

/** Map an internal `RuleStep` to a public, labeled `ExplainStep`. */
function toExplainStep(s: RuleStep): ExplainStep {
  const { id, description } = labelFor(s.because);
  return s.purpose !== undefined
    ? { value: s.value, id, description, purpose: s.purpose }
    : { value: s.value, id, description };
}

/** Arm the evaluation deadline (`ce.timeLimit`), like the public
 * `simplify()`/`evaluate()` do. (Mirrors the private helper in
 * boxed-function.ts.) */
function withDeadline<T>(engine: ComputeEngine, fn: () => T): () => T {
  return () => {
    if (engine._deadline === undefined) {
      engine._deadline = Date.now() + engine.timeLimit;

      try {
        return fn();
      } finally {
        engine._deadline = undefined;
      }
    }

    return fn();
  };
}
