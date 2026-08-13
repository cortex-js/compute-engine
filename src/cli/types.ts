import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';
import type {
  DiagnosticNote,
  ParsingDiagnostic,
} from '../epsil/diagnostics.js';

export type OutputMode = 'value' | 'json' | 'epsil';

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
  transport: 'stdio' | 'streamable-http';
  /** Address used by the Streamable HTTP listener. */
  host: string;
  /** Port used by the Streamable HTTP listener. Zero selects a free port. */
  port: number;
  /** URL path of the Streamable HTTP endpoint. */
  path: string;
  /** Browser origins allowed to call the HTTP endpoint. */
  allowedOrigins: string[];
}

export interface EvaluationResult {
  source: string;
  value: BoxedExpression;
  diagnostics: ParsingDiagnostic[];
  /** Source range of the statement that produced `value` (see
   * `ExecuteEpsilResult.valueRange`) — the anchor for rendering an
   * error-valued result. */
  valueRange?: [start: number, end: number];
  /** Explanations for an error-valued result (see
   * `ExecuteEpsilResult.valueNotes`) — rendered under the report the same way
   * a diagnostic's own notes are. */
  valueNotes?: DiagnosticNote[];
  elapsedMs: number;
}

export interface EpsilSession {
  readonly engine: ComputeEngine;
  readonly timeLimit: number;
  evaluate(source: string, url?: string): EvaluationResult;
  parse(source: string, url?: string): ParsingDiagnostic[];
  reset(): void;
}
