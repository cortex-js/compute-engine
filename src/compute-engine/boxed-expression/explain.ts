import type {
  Expression,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ExplainStep,
  RuleSteps,
  SimplifyOptions,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { simplify } from './simplify';
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
  if (operation !== 'simplify') {
    throw new Error(
      `explain("${operation}") is not supported yet: only "simplify" explanations are available`
    );
  }

  const { verbosity, variable: _variable, ...simplifyOptions } = options ?? {};

  const raw = withDeadline(expr.engine, () =>
    simplify(expr, simplifyOptions as Partial<SimplifyOptions>)
  )();

  return explanationFromRuleSteps('simplify', raw, verbosity ?? 'default');
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

  const toStep = (s: RuleSteps[number]): ExplainStep => {
    const { id, description } = labelFor(s.because);
    return s.purpose !== undefined
      ? { value: s.value, id, description, purpose: s.purpose }
      : { value: s.value, id, description };
  };

  if (verbosity === 'all')
    return { operation, initial, result, steps: raw.slice(1).map(toStep) };

  const steps: ExplainStep[] = [];
  let prev = initial;
  for (const s of raw.slice(1)) {
    if (BOOKKEEPING_IDS.has(s.because)) continue;
    if (s.value.isSame(prev)) continue;
    steps.push(toStep(s));
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
