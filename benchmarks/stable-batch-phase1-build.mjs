#!/usr/bin/env node
// Isolated production-equivalent split build with a private experimental entry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, readJson, boxState, environment, armManifest } from './stable-batch/manifest.mjs';

export const splitEntries = ['compute-engine', 'core', 'compile', 'epsil', 'integration-rules', 'group-theory', 'identities', 'math-json', 'latex-syntax', 'interval', 'numerics'];
export function productionOptions(version, gitVersion = '') {
  return {
    banner: { js: `/** Compute Engine ${version} ${gitVersion ? ' -- ' + gitVersion : ''}*/` },
    bundle: true,
    define: { ENV: JSON.stringify('production'), SDK_VERSION: JSON.stringify(version), GIT_VERSION: JSON.stringify(gitVersion || '?.?.?') },
    loader: { '.ts': 'ts' }, sourcemap: false, sourceRoot: '../src', sourcesContent: false,
    target: ['es2022'], resolveExtensions: ['.ts', '.js'],
    drop: ['debugger'], pure: ['console.assert', 'console.log'], minify: true,
    format: 'esm', splitting: true, entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]',
  };
}
function sourceIdentity(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
  const paths = [...new Set([
    ...git('ls-files', '-z', '--', 'src', 'scripts/build.mjs', 'package.json', 'package-lock.json').toString().split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z', '--', 'src').toString().split('\0'),
  ].filter(Boolean))].sort();
  const files = paths.map((path) => ({ path, sha256: hash(readFileSync(resolve(root, path))) }));
  return { commit: git('rev-parse', 'HEAD').toString().trim(), files, sha256: hash(JSON.stringify(files)), patchSha256: hash(git('diff', 'HEAD', '--', 'src', 'scripts/build.mjs', 'package.json', 'package-lock.json')) };
}
async function main() {
  const [configPath] = process.argv.slice(2);
  assert(configPath, 'Usage: stable-batch-phase1-build.mjs CONFIG.json');
  const config = readJson(resolve(configPath));
  const root = resolve(config.root); const output = resolve(config.output);
  assert(!existsSync(output), 'Fresh output directory required');
  assert.equal(typeof config.experimental, 'boolean', 'Select experimental entry explicitly');
  const beforeBox = boxState(config); assert(beforeBox.valid, 'Box not clear for build');
  const before = sourceIdentity(root);
  if (config.commit) assert.equal(before.commit, config.commit);
  const require = createRequire(resolve(root, 'package.json'));
  const esbuild = require('esbuild');
  const pkg = readJson(resolve(root, 'package.json'));
  const options = productionOptions(pkg.version, config.gitVersion ?? '');
  if (config.sourcemap !== undefined) {
    assert.equal(config.sourcemap, 'external', 'Diagnostic maps must be external');
    options.sourcemap = 'external';
  }
  const entrySource = `export { ComputeEngine } from ${JSON.stringify(resolve(root, 'src/compute-engine.ts'))};\n` +
    (config.experimental ? `export { prepareBatch } from ${JSON.stringify(resolve(root, 'src/compute-engine/experimental/stable-batch.ts'))};\n` : '');
  mkdirSync(output, { recursive: true });
  const temporaryEntry = resolve(output, 'stable-batch-phase1-entry.ts');
  writeFileSync(temporaryEntry, entrySource);
  const entryPoints = Object.fromEntries(splitEntries.map((name) => [name, resolve(root, `src/${name}.ts`)]));
  entryPoints['stable-batch-phase1'] = temporaryEntry;
  try {
    await esbuild.build({ ...options, absWorkingDir: root, entryPoints, outdir: resolve(output, 'esm-min') });
  } finally { rmSync(temporaryEntry); }
  const after = sourceIdentity(root); const afterBox = boxState(config);
  const valid = JSON.stringify(before) === JSON.stringify(after) && afterBox.valid;
  const build = { kind: options.sourcemap ? 'diagnostic-production-split' : 'production-split', command: 'node benchmarks/stable-batch-phase1-build.mjs CONFIG.json',
    settings: { ENV: 'production', target: 'es2022', minify: true, drop: ['debugger'], pure: ['console.assert', 'console.log'], splitting: true, sourcemap: options.sourcemap },
    toolchain: { node: process.version, esbuild: esbuild.version, installedPackageLockSha256: hash(readFileSync(resolve(root, 'package-lock.json'))) },
    experimental: config.experimental, entryPoints: splitEntries, additionalEntry: { name: 'stable-batch-phase1', source: entrySource, sha256: hash(entrySource) }, options };
  const arm = { name: config.name ?? (config.experimental ? 'candidate' : 'untouched-current'), root, entry: resolve(output, 'esm-min/stable-batch-phase1.js'), commit: before.commit, build };
  const manifest = { valid, created: new Date().toISOString(), environment: environment(), config, sourceBefore: before, sourceAfter: after, boxBefore: beforeBox, boxAfter: afterBox, arm: armManifest(arm),
    interpretation: 'Same production split entry list plus private experimental entry; no public export or source edit. Extra entry changes chunk partitioning; archived ordinary production bundles retain distinct provenance.' };
  writeFileSync(resolve(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  assert(valid, 'Source changed or contender observed; build invalid, retained evidence');
  process.stdout.write(`Build manifest: ${resolve(output, 'build-manifest.json')}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
