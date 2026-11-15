import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { hash } from './stable-batch/manifest.mjs';
import { snapshotArm, phase1HarnessManifest } from './stable-batch-phase1.mjs';
import { entriesFor, phase1Workloads, selectPhase1Workloads, setupPhase1Workload } from './stable-batch-phase1-adapter.mjs';

test('bounded selectors exclude unsupported phase2 and match preparation/runtime matrix', () => {
  assert.equal(phase1Workloads.length, 16);
  assert.equal(selectPhase1Workloads(['scalar/N/relevant'])[0].method, 'N');
  assert.throws(() => selectPhase1Workloads(['closure/prepare']));
  assert.throws(() => selectPhase1Workloads(['scalar/prepare', 'scalar/prepare']));
  assert.throws(() => selectPhase1Workloads([]));
  assert.equal(entriesFor('document', 64).filter((e) => e.kind === 'definition').length, 4);
  assert.equal(entriesFor('document', 64).filter((e) => e.kind === 'expression').length, 64);
  assert(!JSON.stringify(entriesFor('document')).includes('Power'));
});

test('prepared adapter includes instantiation only at first execution and routes typed writes and N', () => {
  // Protocol spy only: no replacement mathematical evaluator is used in measurements.
  const observed = [];
  const prepare = (_ce, entries) => {
    observed.push(['prepare', entries]);
    return { status: 'ready', diagnostics: [], unit: { instantiate: () => {
      observed.push(['instantiate']);
      return { status: 'ready', instance: {
        write: (name, value) => { observed.push(['write', name, value]); return { status: 'ready' }; },
        evaluate: (name, options) => { observed.push(['evaluate', name, options]); return { status: 'ready', value: 'spy-result' }; },
      } };
    } } };
  };
  const workload = selectPhase1Workloads(['scalar/N/relevant'])[0];
  const work = setupPhase1Workload(() => ({}), workload, {}, { adapter: 'prepared' }, prepare);
  work.initialize();
  assert.deepEqual(observed.map((entry) => entry[0]), ['prepare']);
  assert.equal(work.operation(), 'spy-result');
  work.write(); work.operation();
  assert.deepEqual(observed.map((entry) => entry[0]), ['prepare', 'instantiate', 'evaluate', 'write', 'evaluate']);
  assert.deepEqual(observed.at(-1), ['evaluate', 'result', { numericApproximation: true }]);
  assert.deepEqual(observed.at(-2), ['write', 'a', 4]);
  work.release();
});

test('missing candidate export is unsupported and never uses native fallback', () => {
  const result = setupPhase1Workload(() => ({}), phase1Workloads[0], {}, { adapter: 'prepared' });
  assert.equal(result.status, 'unsupported');
});

test('archived manifests enforce exact production bundle bytes, file set and provenance', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'phase1-manifest-test-'));
  try {
    const bundle = resolve(directory, 'bundle'); mkdirSync(bundle);
    const entry = resolve(bundle, 'engine.js'); writeFileSync(entry, 'export const test = 1;\n');
    const chunks = resolve(bundle, 'chunks'); mkdirSync(chunks);
    writeFileSync(resolve(chunks, 'shared.js'), 'export const shared = 2;\n');
    const chunkBytes = readFileSync(resolve(chunks, 'shared.js'));
    const bytes = readFileSync(entry);
    const original = { name: 'current', commit: 'b'.repeat(40), entrySha256: hash(bytes), build: { kind: 'production-split' }, bundleFiles: [{ path: 'engine.js', bytes: bytes.length, sha256: hash(bytes) }, { path: 'chunks/shared.js', bytes: chunkBytes.length, sha256: hash(chunkBytes) }] };
    const manifest = resolve(directory, 'manifest.json'); writeFileSync(manifest, JSON.stringify(original));
    const arm = { name: 'archived', commit: original.commit, adapter: 'native', entry, archivedManifest: manifest, archivedArm: 'current', build: original.build };
    assert.equal(snapshotArm(arm).entrySha256, hash(bytes));
    assert.throws(() => snapshotArm({ ...arm, build: { kind: 'different' } }));
    writeFileSync(resolve(bundle, 'extra.js'), ''); assert.throws(() => snapshotArm(arm));
    rmSync(resolve(bundle, 'extra.js')); writeFileSync(entry, 'changed'); assert.throws(() => snapshotArm(arm));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('phase1 provenance covers adapter, driver, child and inherited instrument', () => {
  const manifest = phase1HarnessManifest();
  for (const name of ['stable-batch-phase1-adapter.mjs', 'stable-batch-phase1-child.mjs', 'stable-batch-phase1.mjs'])
    assert(manifest.files.some((entry) => entry.path.endsWith(name)));
  assert(manifest.inherited.files.some((entry) => entry.path.endsWith('child.mjs')));
});

test('validation reads tagged statuses without serializing revision graphs', () => {
  const unit = { instantiate: () => ({ status: 'ready', instance: {
    evaluate: () => ({ status: 'ready', value: { isValid: true, isCollection: false, im: 0, re: 11, isExact: true } }),
  } }) };
  unit.circular = unit;
  const work = setupPhase1Workload(() => ({}), phase1Workloads[0], {}, { adapter: 'prepared' }, () => ({ status: 'ready', unit }));
  work.validate(work.prepare());
  work.release();
});
