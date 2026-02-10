import type { BoxedExpression } from './global-types';
import type { LatexString } from './latex-syntax/types';
import type { ParseEntrypointOptions } from './engine-parse-entrypoint';

type WorkflowHost = {
  parse(
    latex: LatexString | null,
    options?: ParseEntrypointOptions
  ): BoxedExpression | null;
};

export type ParseMode = 'strict' | 'permissive';
export type EvaluateMode = 'exact' | 'numeric';
export type SimplifyMode = 'default' | 'trigonometric';

type WorkflowParseOptions = {
  parseMode?: ParseMode;
  parse?: ParseEntrypointOptions;
};

export type ParseSimplifyOptions = {
  parseMode?: ParseMode;
  simplifyMode?: SimplifyMode;
  parse?: ParseEntrypointOptions;
  simplify?: Parameters<BoxedExpression['simplify']>[0];
};

export type ParseEvaluateOptions = {
  parseMode?: ParseMode;
  evaluateMode?: EvaluateMode;
  parse?: ParseEntrypointOptions;
  evaluate?: Parameters<BoxedExpression['evaluate']>[0];
};

export type ParseNumericOptions = {
  parseMode?: ParseMode;
  parse?: ParseEntrypointOptions;
};

function getParseOptions(
  options?: WorkflowParseOptions
): ParseEntrypointOptions | undefined {
  if (options?.parseMode === undefined) return options?.parse;

  const strict = options.parseMode === 'strict';
  return { strict, ...options.parse };
}

function getEvaluateOptions(
  options?: ParseEvaluateOptions
): Parameters<BoxedExpression['evaluate']>[0] | undefined {
  if (options?.evaluateMode === undefined) return options?.evaluate;

  const numericApproximation = options.evaluateMode === 'numeric';
  return { numericApproximation, ...options.evaluate };
}

function getSimplifyOptions(
  options?: ParseSimplifyOptions
): Parameters<BoxedExpression['simplify']>[0] | undefined {
  if (options?.simplifyMode === undefined) return options?.simplify;

  const strategy = options.simplifyMode === 'trigonometric' ? 'fu' : 'default';
  return { strategy, ...options.simplify };
}

export function parseAndSimplify(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseSimplifyOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.simplify(getSimplifyOptions(options));
}

export function parseAndEvaluate(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseEvaluateOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.evaluate(getEvaluateOptions(options));
}

export function parseAndNumeric(
  engine: WorkflowHost,
  latex: LatexString | null,
  options?: ParseNumericOptions
): BoxedExpression | null {
  const parsed = engine.parse(latex, getParseOptions(options));
  if (parsed === null) return null;
  return parsed.N();
}
