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
} from '../global-types';
import { simplify } from './simplify';
import { findUnivariateRoots, rootsAsEquations } from './solve';
import { filterRootsByAssumptions } from './solve-domain';
import { normalizedUnknownsForSolve } from './utils';
import { isFunction } from './type-guards';
import { labelFor } from './explain-labels';

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
export function explainExpression(
  expr: Expression,
  operation: ExplainOperation = 'simplify',
  options?: ExplainOptions
): Explanation {
  if (operation === 'solve') return explainSolve(expr, options);

  if (operation !== 'simplify') {
    throw new Error(
      `explain("${operation}") is not supported yet: only "simplify" and "solve" explanations are available`
    );
  }

  const { verbosity, variable: _variable, ...simplifyOptions } = options ?? {};

  const raw = withDeadline(expr.engine, () =>
    simplify(expr, simplifyOptions as Partial<SimplifyOptions>)
  )();

  return explanationFromRuleSteps('simplify', raw, verbosity ?? 'default');
}

/**
 * Explanation of `solve()` for a univariate equation: the same
 * `findUnivariateRoots` + assumptions-filter pipeline the plain `solve()`
 * runs, with the trace accumulator attached. Step values are *equations* —
 * the state of the equation after each phase — ending with the candidate
 * roots, rejected candidates (if any), and the solution set.
 */
function explainSolve(expr: Expression, options?: ExplainOptions): Explanation {
  const ce = expr.engine;
  const canonical = expr.canonical;
  const operator = canonical.operator;

  if (operator === 'List' || operator === 'And' || operator === 'Or') {
    throw new Error(
      'explain("solve") does not support systems of equations yet: explain one equation at a time'
    );
  }

  const varNames = normalizedUnknownsForSolve(
    options?.variable ?? canonical.unknowns
  );
  if (varNames.length !== 1) {
    throw new Error(
      'explain("solve") requires exactly one unknown: specify it with options.variable'
    );
  }
  const x = varNames[0];

  // Step 0: the equation being solved (an expression `f` reads as `f = 0`)
  const initial = isFunction(canonical, 'Equal')
    ? canonical
    : ce.function('Equal', [canonical, ce.Zero]);

  // Same pipeline as the plain `solve()` (boxed-function.ts), with the
  // trace attached — the trace is pure observation, so the roots are
  // identical to what `solve()` returns.
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

  const verbosity = options?.verbosity ?? 'default';
  let steps: ExplainStep[];
  if (verbosity === 'all') steps = trace.map(toExplainStep);
  else {
    steps = [];
    let prev: Expression = initial;
    for (const s of trace) {
      if (s.value.isSame(prev)) continue;
      steps.push(toExplainStep(s));
      prev = s.value;
    }
  }

  return { operation: 'solve', initial, result, steps };
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
