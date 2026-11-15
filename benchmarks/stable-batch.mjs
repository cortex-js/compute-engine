#!/usr/bin/env node
// Phase-0 instruments only. This driver never builds, locks, or implements batch semantics.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { baselineContract, checkContract } from './stable-batch/adapter.mjs';
import { root, readJson, hash, configuration, armManifest, harnessManifest, environment, assertTimingConfig, boxState, summarize } from './stable-batch/manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'stable-batch/fixtures.json');
const workloadPath = resolve(here, 'stable-batch/workloads.json');
const fixtures = readJson(fixturePath).fixtures;
const workloads = readJson(workloadPath).workloads;
const nativeControls = readJson(resolve(here, 'stable-batch/baseline-controls.json')).controls;
const [command, configPath, outputPath] = process.argv.slice(2);

export function orderForRound(arms, round) { return round % 2 ? [...arms].reverse() : [...arms]; }
export function selectedWorkloads(only) {
  if (only === undefined) return workloads;
  assert(Array.isArray(only) && only.length > 0, 'only must be a nonempty array or omitted for the full matrix');
  assert.equal(new Set(only).size, only.length, 'Duplicate selector');
  const selection = only.map((id) => workloads.find((w) => w.id === id));
  assert(selection.every(Boolean), `Unknown selector: ${only.filter((id) => !workloads.some((w) => w.id === id))}`);
  return selection;
}
export function validateFixtures() {
  assert.equal(fixtures.length, 22);
  assert.deepEqual(fixtures.map((f) => f.id), Array.from({ length: 22 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`));
  const operations = new Set(['prepare','instantiate','write','writeMany','evaluate','N','revise','inspect','mix','hostDeclare','hostOperator','execute','transfer','call','facts','simplify','hostAssume','compile','callCompiled']);
  for (const fixture of fixtures) {
    assert.equal(fixture.requiredPhase, Number(fixture.id.slice(1)) <= 9 ? 1 : 2);
    assert(fixture.steps.length > 0 && Object.keys(fixture.invariants).length > 0);
    assert.equal(new Set(fixture.steps.map((s) => s.id)).size, fixture.steps.length);
    for (const step of fixture.steps) {
      assert(operations.has(step.op), `${fixture.id}: ${step.op}`);
      assert(['ready', 'unsupported'].includes(step.expect.status));
      if (step.op === 'prepare') assert(Array.isArray(step.entries));
    }
    for (const witness of fixture.witnesses) assert(existsSync(resolve(root, witness)), `Missing witness ${witness}`);
    assert.equal(baselineContract(fixture).status, 'unsupported');
  }
  assert.equal(new Set(workloads.map((w) => w.id)).size, workloads.length);
  for (const prefix of ['ce1210/', 'ce1210-box/']) assert.equal(workloads.filter((w) => w.id.startsWith(prefix)).length, 11);
  return { fixtures: fixtures.length, workloads: workloads.length, fixtureSha256: hash(readFileSync(fixturePath)), workloadSha256: hash(readFileSync(workloadPath)) };
}

export function summaryFor(samples, config) {
  const groups = {};
  for (const sample of samples) {
    const key = sample.workload;
    const group = groups[key] ??= { arms: {}, ratios: {}, status: 'ready' };
    const arm = group.arms[sample.arm] ??= { raw: [], status: 'ready' };
    arm.raw.push(sample);
    if (sample.status !== 'ready' || sample.valid === false) {
      arm.status = sample.status === 'unsupported' ? 'unsupported' : 'invalid';
      group.status = arm.status;
    }
  }
  for (const group of Object.values(groups)) {
    for (const arm of Object.values(group.arms)) {
      if (arm.status !== 'ready') continue;
      const timed = arm.raw.filter((r) => r.timing);
      if (timed.length) arm.timing = Object.fromEntries(['firstOperationMs', 'operationMsPerCall', 'assignmentMsPerCall', 'totalMsPerCall'].map((metric) => [metric, summarize(timed.map((r) => r.timing[metric]))]));
      const startup = arm.raw.filter((r) => r.startup);
      if (startup.length) arm.startup = Object.fromEntries(['moduleImportMs', 'engineConstructionAndBuiltinRulesMs', 'firstBoxMs', 'firstExecutionMs', 'boxPlusFirstMs', 'processToFirstResultMs'].map((metric) => [metric, summarize(startup.map((r) => r.startup[metric]))]));
    }
    if (group.status !== 'ready') continue;
    for (const reference of config.arms) {
      const denominator = group.arms[reference.name];
      if (!denominator) continue;
      group.ratios[reference.name] = {};
      for (const arm of config.arms) {
        const numerator = group.arms[arm.name];
        if (!numerator) continue;
        for (const section of ['timing','startup']) for (const metric of Object.keys(denominator[section] ?? {})) {
          const base = denominator[section][metric].median;
          const value = numerator[section]?.[metric]?.median;
          (group.ratios[reference.name][arm.name] ??= {})[metric] = base > 0 && value !== undefined ? value / base : null;
        }
      }
    }
  }
  return { groups, budgets: config.budgets ?? { status: 'pending-coordinator-baseline-review' }, interpretation: 'Per-case medians, min/max spread and raw rounds. No acceptance decision or speedup claim follows from a ratio inside repeatability noise. Invalid groups have no ratios.' };
}

async function main() {
  if (command === 'validate') {
    process.stdout.write(JSON.stringify(validateFixtures(), null, 2) + '\n');
    return;
  }
  if (command === 'summarize') {
    const manifest = readJson(resolve(configPath, 'manifest.json'));
    const samples = readdirSync(configPath).filter((n) => n.endsWith('.result.json')).map((n) => readJson(resolve(configPath, n)));
    const report = summaryFor(samples, manifest.config);
    writeFileSync(resolve(configPath, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`Summary: ${resolve(configPath, 'summary.json')}\n`);
    return;
  }
  assert(['manifest','controls','time','profile','memory'].includes(command), 'Usage: stable-batch.mjs validate | manifest CONFIG | controls|time|profile|memory CONFIG OUTDIR | summarize OUTDIR');
  assert(configPath, 'Configuration required');
  const config = configuration(resolve(configPath));
  validateFixtures();
  const selection = selectedWorkloads(config.only);
  if (command !== 'controls' && command !== 'manifest') assertTimingConfig(config, command);
  if (command === 'profile') assert(['startup','preparation','execution'].includes(config.profilePhase), 'Select profilePhase');
  const manifest = { schemaVersion: 1, created: new Date().toISOString(), mode: command, config, environment: environment(), fixtureSha256: hash(readFileSync(fixturePath)), workloadSha256: hash(readFileSync(workloadPath)), harness: harnessManifest(), arms: config.arms.map(armManifest), schedule: 'Serial, one process per arm/workload/round; round 0 AB, round 1 BA', processCountPerSample: 1 };
  if (command === 'manifest') { process.stdout.write(JSON.stringify(manifest, null, 2) + '\n'); return; }
  assert(outputPath, 'Output directory required');
  const output = resolve(outputPath);
  assert(!existsSync(output), 'Use a fresh output directory; never overwrite evidence');
  mkdirSync(output, { recursive: true });
  const write = (name, data) => writeFileSync(resolve(output, name), JSON.stringify(data, null, 2) + '\n');
  write('manifest.json', manifest);
  const contracts = [];
  for (const fixture of fixtures) contracts.push({ id: fixture.id, ...(await checkContract(baselineContract, fixture)) });
  write('contracts.json', { status: 'unsupported', proposedSemanticsPassed: 0, fixtures: contracts });
  const measurements = command !== 'controls';
  const rounds = measurements ? config.settings.rounds : 1;
  const actualSelection = command === 'controls'
    ? [...selection, ...nativeControls.map((control) => ({ id: `native/${control.id}`, kind: 'baseline-control', control, unavailable: control.unavailable }))]
    : command === 'memory'
    ? selectedWorkloads([config.memoryWorkload ?? 'scalar/box'])
    : command === 'profile' && config.profilePhase === 'startup' ? [{ id: 'startup' }]
    : command === 'time' ? [{ id: 'startup' }, ...selection] : selection;
  const samples = [];
  let failed = false;
  for (let round = 0; round < rounds; round++) for (const workload of actualSelection) {
    for (const arm of orderForRound(config.arms, round)) {
      const name = `${round}-${arm.name}-${workload.id.replaceAll('/', '_')}`;
      if (workload.unavailable) {
        const sample = { arm: arm.name, workload: workload.id, round, status: 'unsupported', reason: workload.unavailable, valid: false };
        samples.push(sample); write(`${name}.result.json`, sample); continue;
      }
      const before = armManifest(arm);
      const boxBefore = measurements ? boxState(config) : null;
      if (boxBefore) { write(`${name}.box-before.json`, boxBefore); assert(boxBefore.valid, 'Contended before sample; no child launched'); }
      const request = { mode: command, arm, settings: config.settings, workload, profilePhase: config.profilePhase };
      write(`${name}.request.json`, request);
      const flags = measurements && command === 'memory' ? [...config.nodeFlags, '--expose-gc', ...config.diagnosticFlags]
        : command === 'profile' ? [...config.nodeFlags, ...config.diagnosticFlags] : config.nodeFlags;
      const start = measurements ? performance.now() : null;
      const child = spawnSync(process.execPath, [...flags, resolve(here, 'stable-batch/child.mjs'), resolve(output, `${name}.request.json`), resolve(output, `${name}.result.json`)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: config.childTimeoutMs ?? 120000 });
      const processWallMs = measurements ? performance.now() - start : null;
      writeFileSync(resolve(output, `${name}.stdout.log`), child.stdout ?? '');
      writeFileSync(resolve(output, `${name}.stderr.log`), child.stderr ?? '');
      const resultFile = resolve(output, `${name}.result.json`);
      const sample = existsSync(resultFile) ? readJson(resultFile) : { status: 'failed', error: child.error?.message ?? `Child exit ${child.status}; signal ${child.signal}` };
      const after = armManifest(arm);
      const boxAfter = measurements ? boxState(config) : null;
      Object.assign(sample, { arm: arm.name, workload: workload.id, round, exitCode: child.status, signal: child.signal, boxBefore, boxAfter, sourceBefore: before.sourceSha256, sourceAfter: after.sourceSha256, bundleBefore: before.bundleSha256, bundleAfter: after.bundleSha256, processWallMs: command === 'controls' ? null : processWallMs, processWallIncludesDriverAndValidation: true });
      sample.valid = sample.status === 'ready' && child.status === 0 && JSON.stringify(before) === JSON.stringify(after) && (!measurements || boxAfter.valid);
      write(`${name}.result.json`, sample);
      samples.push(sample);
      if (!sample.valid && sample.status !== 'unsupported') failed = true;
      process.stdout.write(`${command} ${round} ${arm.name} ${workload.id}: ${sample.status}${sample.valid ? '' : ' (not a valid measurement)'}\n`);
      if (measurements && (!sample.valid && sample.status !== 'unsupported')) throw new Error(`Invalid sample ${name}; retained raw artifacts, stopping`);
    }
  }
  const finalArms = config.arms.map(armManifest);
  const finalHarness = harnessManifest();
  const certified = JSON.stringify(manifest.arms) === JSON.stringify(finalArms) && manifest.harness.sha256 === finalHarness.sha256;
  write('certification.json', { valid: certified, arms: finalArms, harnessSha256: finalHarness.sha256 });
  write('summary.json', summaryFor(certified ? samples : samples.map((s) => ({ ...s, valid: false })), config));
  assert(certified, 'Inputs changed during the run; all samples invalid');
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
