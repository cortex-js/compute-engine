import type { BoxedExpression } from './global-types';
import type { LatexString } from './latex-syntax/types';
import type { ParseEntrypointOptions } from './engine-parse-entrypoint';

type WorkflowHost = {
  parse(
    latex: LatexString | null,
    options?: ParseEntrypointOptions
  ): BoxedExpression | null;
};

export type ParseSimplifyOptions = {
  parse?: ParseEntrypointOptions;
  simplify?: Parameters<BoxedExpression['simplify']>[0];
};

export type ParseEvaluateOptions = {
  parse?: ParseEntrypointOptions;
  evaluate?: Parameters<BoxedExpression['evaluate']>[0];
};

export type ParseNumericOptions = {
  parse?: ParseEntrypointOptions;
};

export function parseAndSimplify(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseSimplifyOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, options?.parse);
  if (parsed === null) return null;
  return parsed.simplify(options?.simplify);
}

export function parseAndEvaluate(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseEvaluateOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, options?.parse);
  if (parsed === null) return null;
  return parsed.evaluate(options?.evaluate);
}

export function parseAndNumeric(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseNumericOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, options?.parse);
  if (parsed === null) return null;
  return parsed.N();
}
