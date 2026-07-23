import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

export type OutputMode = 'value' | 'json' | 'cortex';

export interface CliOptions {
  eval?: string;
  file?: string;
  help: boolean;
  version: boolean;
  outputMode: OutputMode;
  color: boolean;
  timeLimit: number;
}

export interface EvaluationResult {
  source: string;
  value: BoxedExpression;
  diagnostics: ParsingDiagnostic[];
  elapsedMs: number;
}

export interface CortexSession {
  readonly engine: ComputeEngine;
  readonly timeLimit: number;
  evaluate(source: string, url?: string): EvaluationResult;
  parse(source: string, url?: string): ParsingDiagnostic[];
  reset(): void;
}
