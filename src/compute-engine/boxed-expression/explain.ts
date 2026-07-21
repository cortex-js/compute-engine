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
import { isFunction, isSymbol } from './type-guards.js';
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

  if (operation === 'Integrate') return explainIntegrate(expr, options);

  if (operation !== 'simplify') {
    throw new Error(
      `explain("${operation}") is not supported: use "simplify", "solve", "D" or "Integrate"`
    );
  }

  const {
    verbosity,
    variable: _variable,
    order: _order,
    ...simplifyOptions
  } = options ?? {};

  const raw = simplify(expr, {
    ...simplifyOptions,
    collectSubsteps: true,
  } as Partial<SimplifyOptions>);

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
 * System of (in)equalities (a `List`/`And` of `Equal` / `Less` / `LessEqual`
 * / `Greater` / `GreaterEqual`): the same `solveSystem` dispatch the plain
 * `solve()` runs, with the trace attached.
 *
 * - Pure-equality systems: the Gaussian-elimination / back-substitution
 *   phases, ending with the solution(s) as `List(Equal(x, …), Equal(y, …))`.
 * - Pure-inequality systems (2-var linear): the normalized constraints, the
 *   candidate boundary intersections, and the feasible hull vertices.
 * - Mixed systems: the elimination phases, then each candidate checked
 *   against the inequality constraints (accepted or rejected).
 *
 * Returns `null` when the system path declines. For pure-equality systems the
 * caller then falls through to the univariate path; for systems that contain
 * an inequality, this throws a precise error instead (so the caller never
 * reaches the confusing "requires exactly one unknown" univariate error).
 * `Congruent` systems are not traced: they decline via `return null`.
 */
function explainSolveSystem(
  ce: ComputeEngine,
  canonical: Expression,
  varNames: string[],
  verbosity: 'default' | 'all'
): Explanation | null {
  const equations = isFunction(canonical) ? canonical.ops : [];
  const relationalOps = [
    'Equal',
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
  ];
  const inequalityOps = ['Less', 'LessEqual', 'Greater', 'GreaterEqual'];

  // Only systems whose operands are all (in)equalities are traced; anything
  // else (e.g. `Congruent`) declines and falls through untraced.
  if (
    equations.length === 0 ||
    !equations.every((eq) => relationalOps.includes(eq.operator ?? ''))
  )
    return null;

  const hasInequality = equations.some((eq) =>
    inequalityOps.includes(eq.operator ?? '')
  );

  const trace: RuleSteps = [];
  const solution = solveSystem(ce, equations, varNames, trace);
  if (solution === null) {
    if (hasInequality) {
      const allInequality = equations.every((eq) =>
        inequalityOps.includes(eq.operator ?? '')
      );
      throw new Error(
        allInequality
          ? 'explain("solve") could not solve this system of inequalities'
          : 'explain("solve") could not solve this mixed equality/inequality system'
      );
    }
    // Pure-equality system that declined: fall through to the univariate path.
    return null;
  }

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
    if (v in record) eqs.push(ce.function('Equal', [ce.symbol(v), record[v]]));
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
 * Explanation of `Integrate`: a step-by-step trace of the opt-in Rubi
 * integration rule driver, which must be loaded via
 * `loadIntegrationRules()`. Each step's `value` is the whole evolving
 * antiderivative (with inert `∫…` placeholders for the not-yet-integrated
 * pieces), so the chain reads as a textbook derivation ending in the closed
 * form. A definite integral is presented via the Fundamental Theorem of
 * Calculus: find the antiderivative F, then the bracket F |_a^b, the bounds
 * substituted, and the evaluated value. The result is exactly what
 * `.evaluate()` returns (a deterministic second run of the same provider).
 */
function explainIntegrate(
  expr: Expression,
  options?: ExplainOptions
): Explanation {
  const ce = expr.engine;
  const verbosity = options?.verbosity ?? 'default';

  let canonical = expr.canonical;

  // If the receiver isn't already an `Integrate`, wrap it with the integration
  // variable (from `options.variable`, else the sole unknown).
  if (canonical.operator !== 'Integrate') {
    let x: string;
    const v = options?.variable;
    if (v !== undefined) {
      if (Array.isArray(v)) {
        if (v.length !== 1)
          throw new Error(
            'explain("Integrate") supports a single integration variable: pass options.variable as a string'
          );
        x = v[0];
      } else x = v;
    } else {
      const unknowns = canonical.unknowns;
      if (unknowns.length !== 1)
        throw new Error(
          'explain("Integrate") requires the integration variable: specify it with options.variable'
        );
      x = unknowns[0];
    }
    canonical = ce.function('Integrate', [canonical, ce.symbol(x)]);
  }

  // Extract the integration variable and bounds; reject multivariate forms.
  const limits = isFunction(canonical) ? canonical.ops.slice(1) : [];
  if (limits.length !== 1)
    throw new Error(
      'explain("Integrate") supports a single integration variable'
    );
  const limit = limits[0];
  const loOp = isFunction(limit) ? limit.op2 : undefined;
  const hiOp = isFunction(limit) ? limit.op3 : undefined;
  const lo = loOp === undefined || isSymbol(loOp, 'Nothing') ? undefined : loOp;
  const hi = hiOp === undefined || isSymbol(hiOp, 'Nothing') ? undefined : hiOp;
  const isIndefinite = lo === undefined && hi === undefined;
  if (!isIndefinite && (lo === undefined || hi === undefined))
    throw new Error('explain("Integrate") requires both integration bounds');

  const varExpr = isFunction(limit) ? limit.op1 : undefined;
  const variable = isSymbol(varExpr) ? varExpr.symbol : undefined;
  if (!variable || variable === 'Nothing')
    throw new Error(
      'explain("Integrate") requires the integration variable: specify it with options.variable'
    );

  if (!ce._integrationProvider)
    throw new Error(
      'explain("Integrate") requires the integration rules: load them with loadIntegrationRules() from "@cortex-js/compute-engine/integration-rules"'
    );

  // Pass the same wrapped integrand form `library/calculus.ts` passes, so the
  // provider's unwrap loop and the trace it records line up with the real run.
  const integrand = isFunction(canonical) ? canonical.ops[0] : canonical;

  const trace: RuleSteps = [];
  const anti = ce._integrationProvider!(integrand, variable, trace);
  if (anti === null || anti === undefined)
    throw new Error(
      'explain("Integrate"): the integration rules could not integrate this expression'
    );

  // Result parity by construction: evaluate the real `Integrate` operator (a
  // deterministic second run of the same provider plus the calculus.ts
  // shaping — for a definite integral this includes applying the bounds), so
  // the explanation's result equals what `.evaluate()` returns.
  const result = canonical.evaluate();
  if (result.operator === 'Integrate')
    throw new Error(
      'explain("Integrate"): the integration rules could not integrate this expression'
    );

  const initial = canonical;

  // Definite integral: the textbook presentation via the Fundamental Theorem
  // of Calculus — find the antiderivative F first (the provider trace), then
  // the bracket F |_a^b, then the bounds substituted (displayed unevaluated),
  // closing with the evaluated result.
  if (!isIndefinite) {
    const xSym = ce.symbol(variable);
    const ftcTrace: RuleSteps = [
      // Reframe: the chain switches from the definite integral to finding
      // the antiderivative of the integrand.
      {
        value: ce.function('Integrate', [integrand, xSym]),
        because: 'integrate.antiderivative',
      },
      ...trace,
      // The FTC bracket, the same `EvaluateAt` form the evaluator produces.
      {
        value: ce.function('EvaluateAt', [
          ce.function('Function', [anti, xSym]),
          lo!,
          hi!,
        ]),
        because: 'integrate.fundamental-theorem',
      },
    ];
    // The bounds substituted into F, built non-canonically so numeric powers
    // (`1³/3`) don't fold before the user sees them. Skipped for improper
    // integrals (an infinite bound is a limit, not a substitution).
    if (lo!.isFinite !== false && hi!.isFinite !== false)
      ftcTrace.push({
        value: ce.function(
          'Subtract',
          [
            anti.subs({ [variable]: hi! }, { canonical: false }),
            anti.subs({ [variable]: lo! }, { canonical: false }),
          ],
          { form: 'raw' }
        ),
        because: 'integrate.evaluate-bounds',
      });

    const steps = curateChain(initial, ftcTrace, verbosity);
    // Close with the evaluated result (the arithmetic of the substituted
    // bounds, or the limit value for an improper integral).
    const last = steps.at(-1);
    if (last === undefined || !last.value.isSame(result)) {
      const { id, description } = labelFor('integrate.simplify');
      steps.push({ value: result, id, description });
    }

    return { operation: 'Integrate', initial, result, steps };
  }

  const steps = curateChain(initial, trace, verbosity);

  // Tail repair: ensure the last displayed state matches the returned result
  // (the provider's raw antiderivative may differ from the evaluate()-shaped
  // one by a final simplification). Replay states are built structurally
  // (`_fn`), so the last state can differ from the result in representation
  // only — operand order, `Negate(2/3·u)` vs `-2/3·u` — and appending a
  // step would then display two identical lines. Re-box the state from
  // MathJSON and evaluate it (it contains no residual integrals — a closed
  // chain is a precondition of reaching here): landing on the result means
  // the difference is representational, so rewrite the last step's value to
  // the result; anything else is a genuine final simplification step.
  const last = steps.at(-1);
  if (
    last === undefined ||
    !ce.box(last.value.json).evaluate().isSame(result)
  ) {
    const { id, description } = labelFor('integrate.simplify');
    steps.push({ value: result, id, description });
  } else if (!last.value.isSame(result)) {
    last.value = result;
  }

  return { operation: 'Integrate', initial, result, steps };
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

  // 'all': raw fidelity. For an aggregate `'simplified operands'` step, emit
  // its lifted substeps (labeled) first, then the raw aggregate step itself,
  // so nothing the raw chain records is hidden.
  if (verbosity === 'all') {
    const steps: ExplainStep[] = [];
    for (const s of raw.slice(1)) {
      if (s.because === 'simplified operands' && s.substeps)
        for (const sub of s.substeps) steps.push(toExplainStep(sub));
      steps.push(toExplainStep(s));
    }
    return { operation, initial, result, steps };
  }

  // 'default': curate. Bookkeeping and no-op steps are dropped; an aggregate
  // `'simplified operands'` step with captured substeps is replaced by those
  // substeps (surfacing the real operand-level rule work), then closed with a
  // generic `simplify-terms` step for any numeric-fold residue.
  const steps: ExplainStep[] = [];
  let prev = initial;

  const emit = (s: RuleStep): void => {
    if (BOOKKEEPING_IDS.has(s.because)) return;
    if (s.value.isSame(prev)) return;
    steps.push(toExplainStep(s));
    prev = s.value;
  };

  for (const s of raw.slice(1)) {
    if (
      s.because === 'simplified operands' &&
      s.substeps &&
      s.substeps.length > 0
    ) {
      for (const sub of s.substeps) emit(sub);
      // Residue not captured in substeps (e.g. a numeric fold via
      // `evaluateNumericSubexpressions`): close the gap to the aggregate value
      // with a generic step so no work is silently dropped.
      if (!s.value.isSame(prev)) {
        const { id, description } = labelFor('simplify-terms');
        steps.push({ value: s.value, id, description });
        prev = s.value;
      }
      continue;
    }
    // A bare `'simplified operands'` step (no substeps) stays filtered; the
    // tail repair below is the safety net for any real work it did.
    emit(s);
  }

  // Coalesce noisy runs: merge each maximal run of >= 2 consecutive steps that
  // share the same `id` into one step, keeping the last value (and the first
  // step's purpose, if any).
  const coalesced: ExplainStep[] = [];
  for (const s of steps) {
    const last = coalesced.at(-1);
    if (last !== undefined && last.id === s.id) {
      const merged: ExplainStep = {
        value: s.value,
        id: last.id,
        description: last.description,
      };
      if (last.purpose !== undefined) merged.purpose = last.purpose;
      coalesced[coalesced.length - 1] = merged;
    } else coalesced.push(s);
  }

  // Tail repair: if the chain ended on a filtered bookkeeping step that did
  // real work (e.g. a final operand simplification), the curated chain would
  // stop short of the result. Close it with a generic step so the last step
  // value always matches `result`.
  if (!prev.isSame(result)) {
    const { id, description } = labelFor('simplify-terms');
    coalesced.push({ value: result, id, description });
  }

  return { operation, initial, result, steps: coalesced };
}

/** Map an internal `RuleStep` to a public, labeled `ExplainStep`. */
function toExplainStep(s: RuleStep): ExplainStep {
  const { id, description } = labelFor(s.because);
  return s.purpose !== undefined
    ? { value: s.value, id, description, purpose: s.purpose }
    : { value: s.value, id, description };
}
