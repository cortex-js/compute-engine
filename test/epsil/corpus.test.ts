import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The Epsil program corpus: one complete program per `.epsil` file under
// `test/epsil/corpus/`, run end to end against a fresh engine and compared
// with the expected result written in the file itself. The programs are
// real files so they also run through the CLI (`npx tsx src/cli/epsil.ts
// <file>`) and open in the VS Code extension. `corpus/README.md` describes
// the file format and how to add a program.
//
// Each file carries its expectation as comments:
//
// - The last `// ➔ <text>` line is the expected value of the program, in
//   the engine's textual form. Whitespace is ignored in the comparison. A
//   `// ➔ ≈ <number>` expectation compares numerically to ten significant
//   digits (a relative tolerance; an expected zero uses a small absolute one). The same convention is used by the executed documentation
//   (`documentation.test.ts`).
// - A `// corpus: expect-diagnostic <text>` header means the program must
//   produce an error diagnostic (parse-time or runtime) whose message
//   contains `<text>`. There is then no `// ➔` line.
// - A `// corpus: known-failure <reason>` header marks a program that finds
//   a bug recorded in ROADMAP.md. The test is registered with
//   `test.failing`, so it passes while the bug stands and FAILS the day the
//   bug is fixed, which forces the header to be removed and the ROADMAP
//   entry to be closed in the same change. The reason names the ROADMAP
//   entry in plain words.
//

const CORPUS_DIR = join(__dirname, 'corpus');

type CorpusProgram = {
  /** Path relative to the corpus directory, used as the test name. */
  name: string;
  source: string;
  expected?: string;
  expectDiagnostic?: string;
  knownFailure?: string;
};

function collectPrograms(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return collectPrograms(path);
      return entry.endsWith('.epsil') ? [path] : [];
    });
}

function readProgram(path: string): CorpusProgram {
  const source = readFileSync(path, 'utf8');
  const program: CorpusProgram = {
    name: relative(CORPUS_DIR, path),
    source,
  };

  for (const match of source.matchAll(/^\/\/ corpus: ([a-z-]+)(?: (.*))?$/gm)) {
    const [, directive, argument = ''] = match;
    if (directive === 'expect-diagnostic')
      program.expectDiagnostic = argument.trim();
    else if (directive === 'known-failure')
      program.knownFailure = argument.trim();
    else throw new Error(`${program.name}: unknown directive "${directive}"`);
  }

  program.expected = [...source.matchAll(/^\/\/ ➔ (.+)$/gm)].at(-1)?.[1];
  return program;
}

function normalizeOutput(output: string): string {
  return output.replace(/\s+/g, '').replace(/"(True|False)"/g, '$1');
}

/** The text of a value, with a lazy collection enumerated so that the
 * expectation can list every element. Only a value whose expectation is a
 * list is enumerated: a string is a collection too, and a string that
 * contains a literal `...` is not an elision. */
function fullText(
  value: ReturnType<typeof executeEpsil>['value'],
  expected: string
): string {
  const text = value.toString();
  if (!value.isCollection || !expected.trim().startsWith('[')) return text;
  // A literal list prints in full. A lazy collection prints as a preview
  // with `...`, or as its recipe (`Filter(Range(…), f)`) when the engine
  // does not turn it into a list by itself; both are enumerated here.
  if (text.startsWith('[') && !text.includes('...')) return text;
  // Enumerating a lazy collection past the engine's iteration limit throws a
  // cancellation; report it as the text so the failure names the cause.
  try {
    return `[${[...value.each()].map((item) => item.toString()).join(',')}]`;
  } catch (error) {
    return `${text} (${String(error)})`;
  }
}

function runProgram(program: CorpusProgram): void {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, program.source, {
    url: program.name,
    parseLatex: (latex) => ce.parse(latex).json,
  });
  const errors = result.diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);

  if (program.expectDiagnostic !== undefined) {
    const needle = program.expectDiagnostic;
    const matched = errors.some((message) => message.includes(needle));
    if (!matched)
      throw new Error(
        `expected a diagnostic containing ${JSON.stringify(
          needle
        )}, received ${JSON.stringify(errors)} and the value ${JSON.stringify(
          result.value.toString()
        )}`
      );
    return;
  }

  if (errors.length > 0)
    throw new Error(`unexpected diagnostics: ${JSON.stringify(errors)}`);

  const expected = program.expected;
  if (expected === undefined)
    throw new Error('the program has no `// ➔` expectation');

  if (expected.trim().startsWith('≈')) {
    const want = Number(expected.trim().slice(1));
    const got = result.value.re;
    // Relative tolerance of ten significant digits; an expected zero gets a
    // small absolute tolerance instead, since a relative one would be zero.
    const tolerance = want === 0 ? 1e-12 : 1e-10 * Math.abs(want);
    const close = Number.isFinite(got) && Math.abs(got - want) <= tolerance;
    if (!close)
      throw new Error(
        `expected ≈ ${want}, received ${JSON.stringify(result.value.toString())}`
      );
    return;
  }

  const actual = fullText(result.value, expected);
  if (normalizeOutput(actual) !== normalizeOutput(expected))
    throw new Error(
      `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
}

describe('EPSIL CORPUS', () => {
  const programs = collectPrograms(CORPUS_DIR).map(readProgram);

  test('the corpus is not empty', () => {
    expect(programs.length).toBeGreaterThan(0);
  });

  for (const program of programs) {
    if (program.knownFailure !== undefined) {
      // A known failure passes while the program still fails. When the bug is
      // fixed, this test fails with "Failing test passed even though it was
      // supposed to fail", which is the signal to remove the header.
      test.failing(
        `${program.name} (known failure: ${program.knownFailure})`,
        () => runProgram(program)
      );
    } else {
      test(program.name, () => runProgram(program));
    }
  }
});
