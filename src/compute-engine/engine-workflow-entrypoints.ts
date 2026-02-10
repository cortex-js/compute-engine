import type { BoxedExpression } from './global-types';
import type { LatexString } from './latex-syntax/types';
import type { ParseEntrypointOptions } from './engine-parse-entrypoint';
import type {
  WorkflowParseMode,
  WorkflowEvaluateMode,
  WorkflowSimplifyMode,
  WorkflowParseOptions,
  WorkflowSimplifyOptions,
  WorkflowEvaluateOptions,
  WorkflowNumericOptions,
} from './types-engine';

type WorkflowHost = {
  parse(
    latex: LatexString | null,
    options?: ParseEntrypointOptions
  ): BoxedExpression | null;
};

/**
 * Translate workflow parse-mode preset into low-level parse options.
 *
 * **Precedence rule:** explicit `parse.strict` overrides `parseMode`.
 * For example `{ parseMode: 'permissive', parse: { strict: true } }` results
 * in `{ strict: true }` because object-spread puts `parse.*` last.
 */
function getParseOptions(
  options?: WorkflowParseOptions
): ParseEntrypointOptions | undefined {
  if (options?.parseMode === undefined) return options?.parse;

  const strict = options.parseMode === 'strict';
  return { strict, ...options.parse };
}

/**
 * Translate workflow evaluate-mode preset into low-level evaluate options.
 *
 * **Precedence rule:** explicit `evaluate.numericApproximation` overrides
 * `evaluateMode`.
 */
function getEvaluateOptions(
  options?: WorkflowEvaluateOptions
): Parameters<BoxedExpression['evaluate']>[0] | undefined {
  if (options?.evaluateMode === undefined) return options?.evaluate;

  const numericApproximation = options.evaluateMode === 'numeric';
  return { numericApproximation, ...options.evaluate };
}

/**
 * Translate workflow simplify-mode preset into low-level simplify options.
 *
 * **Precedence rule:** explicit `simplify.strategy` overrides `simplifyMode`.
 *
 * The `'trigonometric'` mode maps to the `'fu'` strategy, which is the
 * Fu algorithm for trigonometric simplification (named after the paper by
 * Fu, Zhong, and Zeng).
 */
function getSimplifyOptions(
  options?: WorkflowSimplifyOptions
): Parameters<BoxedExpression['simplify']>[0] | undefined {
  if (options?.simplifyMode === undefined) return options?.simplify;

  const strategy = options.simplifyMode === 'trigonometric' ? 'fu' : 'default';
  return { strategy, ...options.simplify };
}

export function parseAndSimplify(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: WorkflowSimplifyOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.simplify(getSimplifyOptions(options));
}

export function parseAndEvaluate(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: WorkflowEvaluateOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.evaluate(getEvaluateOptions(options));
}

export function parseAndNumeric(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: WorkflowNumericOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.N();
}
