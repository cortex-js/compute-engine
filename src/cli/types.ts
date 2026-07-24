import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';
import type { ParsingDiagnostic } from '../cortex/diagnostics.js';

export type OutputMode = 'value' | 'json' | 'cortex';

export type DiagnosticsFormat = 'text' | 'json';

export interface CliOptions {
  eval?: string;
  file?: string;
  help: boolean;
  version: boolean;
  outputMode: OutputMode;
  diagnosticsFormat: DiagnosticsFormat;
  color: boolean;
  timeLimit: number;
}

export interface CheckOptions {
  eval?: string;
  file?: string;
  json: boolean;
  color: boolean;
}

export interface DocOptions {
  query: string;
  json: boolean;
  limit: number;
}

export interface McpOptions {
  /** Default evaluation deadline for the `evaluate` tool, in ms. */
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
