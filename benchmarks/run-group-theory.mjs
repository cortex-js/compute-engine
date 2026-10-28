/**
 * Build the group benchmarks with production-like ES2022 semantics and execute
 * them sequentially. Temporary bundles are removed even when a case fails.
 * Run with Node 26; this script does not change the project's supported runtime.
 */
// Build tooling stays in this development-only benchmark runner.
// oxlint-disable-next-line no-restricted-imports
import { build, version as esbuildVersion } from 'esbuild';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'ce-group-bench-'));
const results = join(root, 'benchmarks/results');
mkdirSync(results, { recursive: true });
const families = process.argv.slice(2);
const selected = families.length
  ? families
  : ['finite', 'matrix', 'polycyclic', 'presentation', 'api'];
try {
  for (const family of selected) {
    if (
      !['finite', 'matrix', 'polycyclic', 'api', 'presentation'].includes(
        family
      )
    )
      throw new Error('Unknown benchmark family: ' + family);
    const entry = join(root, 'benchmarks/group-theory-' + family + '.ts');
    const outfile = join(temporary, family + '.mjs');
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      logLevel: 'warning',
    });
    const output = execFileSync(process.execPath, [outfile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 20 * 1024 * 1024,
    });
    let data;
    try {
      data = JSON.parse(output);
    } catch {
      data = {
        measurements: output
          .trim()
          .split(/\r?\n/)
          .map((line) => JSON.parse(line)),
      };
    }
    const record = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      v8: process.versions.v8,
      target: 'ES2022',
      esbuildVersion,
      baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
      sourceState: 'working tree',
      ...data,
    };
    writeFileSync(
      join(results, 'group-theory-' + family + '.json'),
      JSON.stringify(record, null, 2) + '\n'
    );
    process.stdout.write('Measured ' + family + '\n');
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
