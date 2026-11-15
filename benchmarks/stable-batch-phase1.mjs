#!/usr/bin/env node
// Phase1 bounded instrument. Never builds, acquires locks, or changes CE sources.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { defaults, root, readJson, hash, armManifest, harnessManifest, environment, assertTimingConfig, boxState } from './stable-batch/manifest.mjs';
import { orderForRound, summaryFor } from './stable-batch.mjs';
import { selectPhase1Workloads } from './stable-batch-phase1-adapter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const referenceCommits = [
  'ed54c0a68949924176b45251b7f4c4f2871ff93b',
  'bbc28d9cad900d050c9ed83eaa02add399ae3b76',
  'c4856e003557e367d4a2272d37d1567e9dd7a9b3',
];

export function phase1HarnessManifest() {
  const inherited = harnessManifest();
  const files = readdirSync(here).filter((name) => /^stable-batch-phase1.*\.mjs$/.test(name)).sort().map((name) => ({
    path: `benchmarks/${name}`, sha256: hash(readFileSync(resolve(here, name))),
  }));
  return { sha256: hash(JSON.stringify({ inherited, files })), inherited, files };
}

export function snapshotArm(arm) {
  if (!arm.archivedManifest) return { ...armManifest(arm), adapter: arm.adapter };
  const original = readJson(arm.archivedManifest);
  const archived = original.arms?.find((entry) => entry.name === arm.archivedArm) ?? (original.name === arm.archivedArm ? original : null);
  assert(archived, 'Archived phase0 manifest must contain selected original arm');
  assert.equal(archived.commit, arm.commit);
  assert.equal(arm.adapter, 'native', 'Archived phase0 bundles cannot supply prototype');
  assert.deepEqual(arm.build, archived.build, 'Archived build provenance must be preserved exactly');
  const bundleRoot = dirname(arm.entry);
  const actualFiles = readdirSync(bundleRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.(js|map|json)$/.test(entry.name)).map((entry) => resolve(entry.parentPath, entry.name).slice(bundleRoot.length + 1)).sort();
  assert.deepEqual(actualFiles, archived.bundleFiles.map((file) => file.path).sort(), 'Archived bundle file set changed');
  for (const file of archived.bundleFiles) {
    const bytes = readFileSync(resolve(bundleRoot, file.path));
    assert.equal(bytes.byteLength, file.bytes);
    assert.equal(hash(bytes), file.sha256, `Archived bundle changed ${file.path}`);
  }
  assert.equal(hash(readFileSync(arm.entry)), archived.entrySha256);
  return { ...archived, name: arm.name, adapter: arm.adapter, entry: arm.entry,
    provenance: 'Exact archived phase0 production bundle; source hashes are historical observations, not a current checkout certification',
    archivedManifest: arm.archivedManifest, archivedManifestSha256: hash(readFileSync(arm.archivedManifest)), archivedArm: arm.archivedArm };
}

export function phase1Configuration(path) {
  const config = readJson(path);
  assert.equal(config.schemaVersion, 1);
  config.settings = { ...defaults, warmup: 1000, iterations: 10000, ...config.settings };
  for (const [name, value] of Object.entries(config.settings))
    if (typeof defaults[name] === 'number') assert(Number.isSafeInteger(value) && value > 0, `Invalid ${name}`);
  for (const flag of ['skipRetention', 'skipAllocation']) if (flag in config.settings) assert.equal(typeof config.settings[flag], 'boolean');
  if (config.settings.retentionSnapshotsAt !== undefined) {
    assert(Array.isArray(config.settings.retentionSnapshotsAt));
    for (const label of config.settings.retentionSnapshotsAt) assert(/^(before-documents|retained-documents|held-obsolete|dropped-obsolete|replacement-[1-9][0-9]*|all-document-roots-dropped)$/.test(label), `Invalid snapshot checkpoint ${label}`);
  }
  assert.equal(config.settings.jit, 'off');
  assert.equal(config.settings.boxApi, 'box');
  assert.equal(config.settings.retainedUnits, 8);
  assert.equal(config.settings.replacements, 12);
  assert(config.settings.retentionCheckpoints >= 3, 'Use 3 checkpoints or an explicitly longer curve');
  assert(Array.isArray(config.arms) && config.arms.length === 2);
  assert.equal(new Set(config.arms.map((arm) => arm.name)).size, 2);
  for (const arm of config.arms) {
    assert(/^[A-Za-z0-9._-]+$/.test(arm.name));
    assert(/^[a-f0-9]{40}$/.test(arm.commit));
    assert(['prepared', 'native'].includes(arm.adapter));
    arm.root = resolve(dirname(path), arm.root);
    arm.entry = resolve(arm.root, arm.entry);
    if (arm.archivedManifest) arm.archivedManifest = resolve(dirname(path), arm.archivedManifest);
  }
  assert.equal(config.arms.filter((arm) => arm.adapter === 'prepared').length, 1);
  const native = config.arms.find((arm) => arm.adapter === 'native');
  assert(referenceCommits.includes(native.commit), 'Use untouched current, phase0 current, or pinned pre-binding reference');
  config.nodeFlags ??= [];
  config.diagnosticFlags ??= [];
  assert(Array.isArray(config.nodeFlags) && Array.isArray(config.diagnosticFlags));
  selectPhase1Workloads(config.only);
  return config;
}

async function main() {
  const [mode, configPath, outputPath] = process.argv.slice(2);
  assert(['manifest', 'controls', 'time', 'profile', 'memory'].includes(mode), 'Usage: stable-batch-phase1.mjs manifest CONFIG | controls|time|profile|memory CONFIG NEW_OUTDIR');
  const config = phase1Configuration(resolve(configPath));
  const measured = mode !== 'controls' && mode !== 'manifest';
  if (measured) assertTimingConfig(config, mode);
  if (mode === 'profile') assert(['preparation', 'execution'].includes(config.profilePhase));
  const manifest = { schemaVersion: 1, phase: 1, mode, created: new Date().toISOString(), config,
    environment: environment(), harness: phase1HarnessManifest(), arms: config.arms.map(snapshotArm),
    schedule: 'Serial separate processes, AB/BA alternating each round',
    unsupported: ['closure', 'DAG', 'phase2', 'real host', 'full phase0 document/closure retention'],
    semanticGate: 'F01-F09 correctness/probes are an independent implementation gate; these arithmetic controls do not certify them' };
  if (mode === 'manifest') { process.stdout.write(JSON.stringify(manifest, null, 2) + '\n'); return; }
  assert(outputPath, 'Fresh output directory required');
  const output = resolve(outputPath);
  assert(!existsSync(output), 'Never overwrite raw evidence');
  mkdirSync(output, { recursive: true });
  const write = (name, value) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2) + '\n');
  write('manifest.json', manifest);
  // Preserve the exact instrument bytes alongside their digests.
  const sources = resolve(output, 'harness'); mkdirSync(sources);
  for (const file of [...manifest.harness.inherited.files, ...manifest.harness.files]) {
    const destination = resolve(sources, file.path); mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(resolve(root, file.path)));
  }
  let selection = selectPhase1Workloads(mode === 'memory' ? [config.memoryWorkload ?? 'scalar/prepare'] : config.only);
  if (mode === 'time' && config.includeStartup !== false) selection = [{ id: 'startup' }, ...selection];
  const samples = [];
  for (let round = 0; round < (mode === 'controls' ? 1 : config.settings.rounds); round++) {
    for (const workload of selection) for (const arm of orderForRound(config.arms, round)) {
      const name = `${round}-${arm.name}-${workload.id.replaceAll('/', '_')}`;
      const before = snapshotArm(arm);
      const boxBefore = measured ? boxState(config) : null;
      write(`${name}.box-before.json`, boxBefore);
      assert(!measured || boxBefore.valid, 'Contended before child; artifacts retained');
      const request = { mode, arm, settings: config.settings, workload, profilePhase: config.profilePhase };
      write(`${name}.request.json`, request);
      const flags = mode === 'memory' ? [...config.nodeFlags, '--expose-gc', ...config.diagnosticFlags]
        : mode === 'profile' ? [...config.nodeFlags, ...config.diagnosticFlags] : config.nodeFlags;
      const start = performance.now();
      const child = spawnSync(process.execPath, [...flags, resolve(here, 'stable-batch-phase1-child.mjs'), resolve(output, `${name}.request.json`), resolve(output, `${name}.result.json`)],
        { cwd: root, encoding: 'utf8', timeout: config.childTimeoutMs ?? 180000, maxBuffer: 64 * 1024 * 1024 });
      const processWallMs = performance.now() - start;
      writeFileSync(resolve(output, `${name}.stdout.log`), child.stdout ?? '');
      writeFileSync(resolve(output, `${name}.stderr.log`), child.stderr ?? '');
      const resultPath = resolve(output, `${name}.result.json`);
      const sample = existsSync(resultPath) ? readJson(resultPath) : { status: 'failed', error: child.error?.message ?? `Exit ${child.status}` };
      const after = snapshotArm(arm);
      const boxAfter = measured ? boxState(config) : null;
      Object.assign(sample, { round, arm: arm.name, workload: workload.id, exitCode: child.status, signal: child.signal, boxBefore, boxAfter,
        sourceBefore: before.sourceSha256, sourceAfter: after.sourceSha256, bundleBefore: before.bundleSha256, bundleAfter: after.bundleSha256,
        processWallMs: measured ? processWallMs : null, processWallIncludesHarnessAndValidation: true });
      sample.valid = sample.status === 'ready' && child.status === 0 && JSON.stringify(before) === JSON.stringify(after) && (!measured || boxAfter.valid);
      write(`${name}.result.json`, sample); samples.push(sample);
      process.stdout.write(`${mode} ${name}: ${sample.status}\n`);
      assert(sample.valid || sample.status === 'unsupported', `Invalid ${name}; raw evidence retained, stopping`);
    }
  }
  const finalArms = config.arms.map(snapshotArm);
  const finalHarness = phase1HarnessManifest();
  const certified = JSON.stringify(manifest.arms) === JSON.stringify(finalArms) && manifest.harness.sha256 === finalHarness.sha256;
  write('certification.json', { valid: certified, arms: finalArms, harnessSha256: finalHarness.sha256 });
  write('summary.json', summaryFor(certified ? samples : samples.map((sample) => ({ ...sample, valid: false })), config));
  assert(certified, 'Input content changed; samples invalid');
  assert(samples.every((sample) => sample.status === 'ready'), 'Unsupported workloads are not passing phase1 measurements');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
