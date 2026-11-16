// Inline-results runner (Tier 0 of VSCODE_EPSIL_ROADMAP.md).
//
// Executes an Epsil Program through `executeEpsil` and emits
// one NDJSON record per top-level statement so the extension can decorate
// each statement's line with its value — a notebook-style read of the whole
// program without starting a debug session.
//
// Invoked as: node inline-runner.js <file> [statementTimeLimitMs]
// stdout: NDJSON records (see InlineRecord in debug-protocol.ts poor-man's
// contract below); stderr: free-form diagnostics.
//
// Like the server and the debug worker, the engine is bundled from repo
// source (build.mjs).

import { readFileSync } from 'node:fs';

import {
  ComputeEngine,
  executeEpsil,
  parseEpsil,
  serializeEpsil,
} from '../../src/epsil.js';
import { isSymbol, type Expression } from '../../src/compute-engine.js';
import type { MathJsonExpression } from '../../src/math-json/types.js';
import { FatalParsingError } from '../../src/epsil/diagnostics.js';
import { formatDiagnostics } from '../../src/cli/format.js';

/** One record per line of stdout. */
export interface InlineRecord {
  type: 'result';
  /** 1-based start/end lines of the statement. */
  line: number;
  endLine: number;
  /** Rendered value; absent for a `Nothing` result (declares, loops). */
  value?: string;
  isError?: boolean;
}

const VALUE_MAX = 120;

const path = process.argv[2];
const timeLimit = Number(process.argv[3] ?? '5000');

if (!path) {
  process.stderr.write('usage: inline-runner <file> [timeLimitMs]\n');
  process.exit(2);
}

const sourceText = readFileSync(path, 'utf8');
const engine = new ComputeEngine();
const parseLatex = (latex: string): MathJsonExpression =>
  engine.parse(latex).json;

try {
  const [, diagnostics] = parseEpsil(sourceText, path, {
    parseLatex,
    typeNames: engine._typeResolver.names,
  });
  if (diagnostics.length > 0)
    process.stderr.write(
      formatDiagnostics(diagnostics, sourceText, path, false) + '\n'
    );
  if (diagnostics.some((x) => x.severity === 'error')) process.exit(1);
} catch (error) {
  if (error instanceof FatalParsingError) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

function lineOfOffset(offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sourceText.length; i++)
    if (sourceText.charCodeAt(i) === 10) line++;
  return line;
}

function render(expr: Expression): string {
  let text: string;
  try {
    text = serializeEpsil(expr.json);
  } catch {
    text = expr.toString();
  }
  text = text.replace(/\s+/g, ' ');
  if (text.length > VALUE_MAX) text = `${text.slice(0, VALUE_MAX - 1)}…`;
  return text;
}

const result = executeEpsil(engine, sourceText, {
  url: path,
  parseLatex,
  statementTimeLimitMs: timeLimit > 0 ? timeLimit : undefined,
  onStatement: ({ value, range }) => {
    const record: InlineRecord = {
      type: 'result',
      line: lineOfOffset(range[0]),
      endLine: lineOfOffset(Math.max(range[0], range[1] - 1)),
    };
    if (!(isSymbol(value) && value.symbol === 'Nothing')) {
      record.value = render(value);
      if (value.errors.length > 0) record.isError = true;
    }
    process.stdout.write(JSON.stringify(record) + '\n');
  },
});
if (result.diagnostics.length > 0)
  process.stderr.write(
    formatDiagnostics(result.diagnostics, sourceText, path, false) + '\n'
  );
