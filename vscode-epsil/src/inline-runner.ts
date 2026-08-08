// Inline-results runner (Tier 0 of VSCODE_EPSIL_ROADMAP.md).
//
// Executes an Epsil file statement-by-statement (the `executeEpsil`
// contract: sequential, in one session scope, errors are values) and emits
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

import { ComputeEngine, parseEpsil, serializeEpsil } from '../../src/epsil.js';
import { isSymbol, type BoxedExpression } from '../../src/compute-engine.js';
import type { MathJsonExpression } from '../../src/math-json/types.js';
import { operands, operator } from '../../src/math-json/utils.js';
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

let ast: MathJsonExpression;
try {
  const [parsed, diagnostics] = parseEpsil(sourceText, path, {
    parseLatex,
    typeNames: engine._typeResolver.names,
  });
  ast = parsed;
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

const statements = operator(ast) === 'Block' ? [...operands(ast)] : [ast];

function lineOfOffset(offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sourceText.length; i++)
    if (sourceText.charCodeAt(i) === 10) line++;
  return line;
}

function render(expr: BoxedExpression): string {
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

for (const stmt of statements) {
  const offsets =
    (typeof stmt === 'object' && stmt !== null && !Array.isArray(stmt)
      ? (stmt as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined) ?? [0, sourceText.length];

  let value: BoxedExpression;
  const run = () => engine.box(stmt).evaluate();
  try {
    value =
      timeLimit > 0
        ? engine.withTimeLimit({ ms: timeLimit, label: 'epsil:inline' }, run)
        : run();
  } catch (error) {
    value = engine.box([
      'Error',
      { str: error instanceof Error ? error.message : String(error) },
    ]);
  }

  const record: InlineRecord = {
    type: 'result',
    line: lineOfOffset(offsets[0]),
    endLine: lineOfOffset(Math.max(offsets[0], offsets[1] - 1)),
  };
  if (!(isSymbol(value) && value.symbol === 'Nothing')) {
    record.value = render(value);
    if (value.errors.length > 0) record.isError = true;
  }
  process.stdout.write(JSON.stringify(record) + '\n');
}
