#!/usr/bin/env -S npx tsx
//
// The Epsil corpus playground: run every program of `test/epsil/corpus/`
// through the interpreter and through the JavaScript compile target, record
// the value and the time of each route, and write one self-contained HTML
// page (plus the JSON behind it) that lists the whole corpus with filters.
//
//   npx tsx scripts/epsil-corpus-report.ts [--out <dir>] [--only <substring>]
//
// The default output directory is `temp-docs/epsil-corpus/` (gitignored).
// Each program runs on a fresh engine, under the time limit given by
// `--time-limit <ms>` (default 60000), so one slow program cannot hold the
// whole report. The interpreted route is `executeEpsil`, the same call the
// jest runner makes; the compiled route is the one the CLI's `--compile`
// mode takes (`src/cli/compile.ts`): parse, canonicalize, `compile()` to
// JavaScript with no interpreter fallback, then run the generated code with
// no inputs.
//
import {
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { ComputeEngine } from '../src/compute-engine';
import { executeEpsil } from '../src/epsil/execute-epsil';
import { resolveLibraryNames } from '../src/epsil/resolve-library-names';
import { staticDiagnostics } from '../src/epsil/static-diagnostics';
import { compile } from '../src/compute-engine/compilation/compile-expression';
import { parseSource } from '../src/cli/check';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = join(ROOT, 'test/epsil/corpus');

type RouteStatus =
  | 'ok' // a value, and (interpreted) it matches the expectation
  | 'mismatch' // a value that does not match the expectation
  | 'diagnostic' // an error diagnostic was reported
  | 'declined' // the compile target declined the program
  | 'unbound' // the compiled program reads a symbol with no value
  | 'error' // an error value, or a thrown exception
  | 'timeout';

interface RouteResult {
  status: RouteStatus;
  value: string;
  /** Interpreted: the whole run. Compiled: parse and canonicalization. */
  ms: number;
  /** Compiled only: the `compile()` call. */
  compileMs?: number;
  /** Compiled only: running the generated code. */
  runMs?: number;
  diagnostics: string[];
  code?: string;
}

interface ProgramReport {
  name: string;
  category: string;
  source: string;
  expected?: string;
  knownFailure?: string;
  interpreted: RouteResult;
  compiled: RouteResult;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function collect(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return collect(path);
      return entry.endsWith('.epsil') ? [path] : [];
    });
}

function normalize(s: string): string {
  return s.replace(/\s+/g, '').replace(/"(True|False)"/g, '$1');
}

/** The text of a value, with a lazy collection enumerated when the
 * expectation is a list, as the jest runner does. */
function valueText(
  value: ReturnType<typeof executeEpsil>['value'],
  expected?: string
): string {
  const text = value.toString();
  if (!value.isCollection || !expected?.trim().startsWith('[')) return text;
  if (text.startsWith('[') && !text.includes('...')) return text;
  try {
    return `[${[...value.each()].map((x) => x.toString()).join(',')}]`;
  } catch (error) {
    return `${text} (${String(error)})`;
  }
}

function matches(actual: string, expected: string | undefined): boolean {
  if (expected === undefined) return false;
  if (expected.trim().startsWith('≈')) {
    const want = Number(expected.trim().slice(1));
    const got = Number(actual);
    const tolerance = want === 0 ? 1e-12 : 1e-10 * Math.abs(want);
    return Number.isFinite(got) && Math.abs(got - want) <= tolerance;
  }
  return normalize(actual) === normalize(expected);
}

function runInterpreted(
  source: string,
  name: string,
  expected: string | undefined,
  timeLimit: number
): RouteResult {
  const ce = new ComputeEngine();
  const t0 = performance.now();
  const run = () =>
    executeEpsil(ce, source, {
      url: name,
      parseLatex: (latex) => ce.parse(latex).json,
    });
  const result =
    timeLimit > 0
      ? ce.withTimeLimit({ ms: timeLimit, label: 'corpus-report' }, run)
      : run();
  const errors = result.diagnostics
    .filter((d) => d.severity === 'error')
    .map((d) => JSON.stringify(d.message));
  const value = valueText(result.value, expected);
  const ms = performance.now() - t0;
  let status: RouteStatus = matches(value, expected) ? 'ok' : 'mismatch';
  if (value.includes('"timeout"')) status = 'timeout';
  else if (errors.length > 0) status = 'diagnostic';
  else if (result.value.operator === 'Error') status = 'error';
  return { status, value, ms, diagnostics: errors };
}

function runCompiled(
  source: string,
  name: string,
  timeLimit: number
): RouteResult {
  const ce = new ComputeEngine();
  const diagnostics: string[] = [];
  const t0 = performance.now();
  let compileMs = 0;
  let runMs = 0;
  let code: string | undefined;
  const body = (): RouteResult => {
    const parsed = parseSource(source, name, ce);
    diagnostics.push(
      ...parsed.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => JSON.stringify(d.message))
    );
    if (parsed.ast === null || diagnostics.length > 0)
      return {
        status: 'diagnostic',
        value: '',
        ms: performance.now() - t0,
        diagnostics,
      };
    resolveLibraryNames(parsed.ast, source, ce);
    staticDiagnostics(ce, parsed.ast, source, parsed.diagnostics);
    const expr = ce.box(parsed.ast);
    const ms = performance.now() - t0;
    const t1 = performance.now();
    let compiled: ReturnType<typeof compile<'javascript'>>;
    try {
      compiled = compile<'javascript'>(expr, {
        to: 'javascript',
        fallback: false,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return {
        status: 'declined',
        value: error instanceof Error ? error.message : String(error),
        ms,
        compileMs: performance.now() - t1,
        diagnostics,
      };
    }
    compileMs = performance.now() - t1;
    code = compiled.code;
    const free = compiled.freeSymbols ?? [];
    if (free.length > 0)
      return {
        status: 'unbound',
        value: `${free.join(', ')}: no value`,
        ms,
        compileMs,
        diagnostics,
        code,
      };
    if (compiled.calling === 'lambda')
      return {
        status: 'error',
        value: 'the program is a function',
        ms,
        compileMs,
        diagnostics,
        code,
      };
    const t2 = performance.now();
    try {
      const raw = compiled.run({});
      runMs = performance.now() - t2;
      return {
        status: 'ok',
        value: stringifyRaw(raw),
        ms,
        compileMs,
        runMs,
        diagnostics,
        code,
      };
    } catch (error) {
      runMs = performance.now() - t2;
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return {
        status: 'error',
        value: error instanceof Error ? error.message : String(error),
        ms,
        compileMs,
        runMs,
        diagnostics,
        code,
      };
    }
  };
  try {
    return timeLimit > 0
      ? ce.withTimeLimit({ ms: timeLimit, label: 'corpus-report' }, body)
      : body();
  } catch (error) {
    return {
      status: 'timeout',
      value: error instanceof Error ? error.message : String(error),
      ms: performance.now() - t0,
      compileMs,
      runMs,
      diagnostics,
      code,
    };
  }
}

function stringifyRaw(raw: unknown): string {
  return (
    JSON.stringify(raw, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) ??
    String(raw)
  );
}

function main(): void {
  const outDir = argValue('--out') ?? join(ROOT, 'temp-docs/epsil-corpus');
  const only = argValue('--only');
  const timeLimit = Number(argValue('--time-limit') ?? 60000);
  const files = collect(CORPUS_DIR).filter((f) => !only || f.includes(only));
  const reports: ProgramReport[] = [];
  for (const file of files) {
    const name = relative(CORPUS_DIR, file);
    const source = readFileSync(file, 'utf8');
    const expected = [...source.matchAll(/^\/\/ ➔ (.+)$/gm)].at(-1)?.[1];
    const knownFailure = source.match(
      /^\/\/ corpus: known-failure (.*)$/m
    )?.[1];
    process.stderr.write(`${name} … `);
    const interpreted = runInterpreted(source, name, expected, timeLimit);
    const compiled = runCompiled(source, name, timeLimit);
    process.stderr.write(
      `${interpreted.status} ${interpreted.ms.toFixed(0)}ms / compiled ${compiled.status}\n`
    );
    reports.push({
      name,
      category: name.split('/')[0],
      source,
      expected,
      knownFailure,
      interpreted,
      compiled,
    });
  }
  mkdirSync(outDir, { recursive: true });
  const data = {
    generatedAt: new Date().toISOString(),
    timeLimit,
    programs: reports,
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(data, null, 2));
  const template = readFileSync(
    join(ROOT, 'scripts/epsil-corpus-report.html'),
    'utf8'
  );
  const page = template.replace(
    '/*__DATA__*/null',
    JSON.stringify(data).replace(/<\//g, '<\\/')
  );
  writeFileSync(join(outDir, 'index.html'), page);
  process.stderr.write(
    `\nWrote ${join(outDir, 'index.html')} (${reports.length} programs)\n`
  );
}

main();
