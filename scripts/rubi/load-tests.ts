// Loader for the Rubi integration test suite
// (https://github.com/RuleBasedIntegration/MathematicaSyntaxTestSuite, MIT).
//
// Each problem is a one-line WL list:
//   {integrand, variable, step-count, optimal-antiderivative}
// Some entries carry extra trailing elements (alternate acceptable
// antiderivatives in older suites); element 4+ are kept as `alternates`.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseWL, Json } from './wl-parser';

export type Problem = {
  /** test-suite file, relative to the suite root */
  file: string;
  /** 1-based index of the problem within the file */
  index: number;
  /** original WL source line */
  source: string;
  integrand: Json;
  variable: string;
  /** Rubi's optimal step count (informational) */
  steps: number;
  antiderivative: Json;
  alternates: Json[];
};

export type LoadResult = {
  problems: Problem[];
  /** lines that failed to parse, with reasons */
  errors: { file: string; line: number; error: string }[];
};

export function loadTestFile(root: string, relFile: string): LoadResult {
  const problems: Problem[] = [];
  const errors: LoadResult['errors'] = [];
  const lines = fs
    .readFileSync(path.join(root, relFile), 'utf8')
    .split('\n');
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    index++;
    try {
      const parsed = parseWL(line);
      if (!Array.isArray(parsed) || parsed[0] !== 'List' || parsed.length < 5)
        throw new Error('not a 4-element problem list');
      const [, integrand, variable, steps, antiderivative, ...alternates] =
        parsed as Json[];
      if (typeof variable !== 'string')
        throw new Error('non-symbol integration variable');
      problems.push({
        file: relFile,
        index,
        source: line,
        integrand,
        variable,
        steps: typeof steps === 'number' ? steps : NaN,
        antiderivative,
        alternates,
      });
    } catch (e) {
      errors.push({ file: relFile, line: i + 1, error: String(e) });
    }
  }
  return { problems, errors };
}

/** Recursively list test-suite `.m` files under `root/subdir`. */
export function listTestFiles(root: string, subdir = ''): string[] {
  const result: string[] = [];
  const dir = path.join(root, subdir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(subdir, entry.name);
    if (entry.isDirectory()) result.push(...listTestFiles(root, rel));
    else if (entry.name.endsWith('.m')) result.push(rel);
  }
  return result.sort();
}

export function loadTests(root: string, subdir = ''): LoadResult {
  // allow a single .m file as the subdir
  if (subdir.endsWith('.m') && fs.statSync(path.join(root, subdir)).isFile())
    return loadTestFile(root, subdir);
  const problems: Problem[] = [];
  const errors: LoadResult['errors'] = [];
  for (const file of listTestFiles(root, subdir)) {
    const r = loadTestFile(root, file);
    problems.push(...r.problems);
    errors.push(...r.errors);
  }
  return { problems, errors };
}
