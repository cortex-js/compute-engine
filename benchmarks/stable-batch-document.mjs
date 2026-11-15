/** Full preparation of a real Tycho document, with explicit value transfer.
 * Uses a private Tycho source snapshot and its alternate-CE loader.
 * Arguments: <snapshot root> <state.json> <output.json>. Requires box lock.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir, loadavg } from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const [rootArg, stateArg, outputArg] = process.argv.slice(2);
assert(rootArg && stateArg && outputArg);
function canonicalPath(path, depth = 0) {
  assert(depth < 128, 'Cyclic or excessively deep output path');
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink())
    return canonicalPath(resolve(dirname(path), readlinkSync(path)), depth + 1);
  return stat ? realpathSync(path) : join(canonicalPath(dirname(path), depth + 1), basename(path));
}
const root = realpathSync(resolve(rootArg));
const output = canonicalPath(resolve(outputArg));
assert(output !== root && !output.startsWith(root + '/'), 'Output must be outside the Tycho checkout');
const state = readFileSync(resolve(stateArg));
const hash = (s) => createHash('sha256').update(s).digest('hex');
assert.equal(hash(state), '40fbf0fd3084c7a20f74e07e6847216f9f1dd5e4fda3107f818c28abe622cb8e',
  'Use the pinned art/2ki2hjsouf state');
const auditPath = join(root, 'scripts/audit-ce-codegen.mts');
const original = readFileSync(auditPath, 'utf8');
const boundary = 'const args = process.argv.slice(2);';
assert.equal(original.split(boundary).length, 2);
// Reuse the audit's real registration path without running the corpus or
// writing its default outputs. No source in the snapshot is edited.
let source = original.slice(0, original.indexOf(boundary));
source = source.replace(/from\s+"(\.[^"]+)"/g,
  (_, specifier) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(auditPath), specifier)).href)}`);
source += '\nexport { setupState, convertDesmosState };\n';
const temporary = mkdtempSync(join(tmpdir(), 'ce-batch-document-'));
const records = [];
const metadata = {
  fixtureSha256: hash(state), auditSourceSha256: hash(original), adaptedSourceSha256: hash(source),
  adapterSha256: hash(readFileSync(new URL(import.meta.url))),
  node: process.version, v8: process.versions.v8, ceRoot: process.env.CE_ALT_PKG,
  loadBefore: loadavg(), jit: 'host default; compilation recorder retained',
  scope: 'fresh setup includes variable pass, computed collections and colors; in-place measures prelude registration plus scalar restoration only; both exclude plotting and row compilation',
  edits: 'append control prelude and scalar variable to the real document; replace prelude body each revision',
};
let failure;
try {
  const relocated = join(temporary, 'document.mts');
  writeFileSync(relocated, source);
  process.chdir(root);
  const { setupState, convertDesmosState } = await import(pathToFileURL(relocated).href);
  const converted = convertDesmosState(JSON.parse(state));
  assert(converted.ok, converted.reason);
  const doc = converted.document;
  assert(!doc.prelude, 'Do not overwrite a real prelude');
  metadata.documentCells = doc.cells.length;
  metadata.convertedDocumentSha256 = hash(JSON.stringify(doc));
  const rounds = Number(process.env.ROUNDS ?? 5);
  assert(Number.isInteger(rounds) && rounds >= 3);
  // These distinctive names are checked for collisions before introducing them.
  assert(!JSON.stringify(doc).includes('batchprobe'));
  const samples = [];
  for (let i = 0; i <= rounds; i++) {
    const coefficient = 2 + i % 2;
    const revision = {
      ...doc,
      prelude: `function batchprobe(t: real) -> real { ${coefficient} * t }`,
      cells: [...doc.cells, { id: 'batchprobe-input', type: 'variable', name: 'q_batchprobe', value: '3' }],
    };
    const started = performance.now();
    const current = await setupState(revision);
    // Transfer is an explicit operation and belongs inside full-edit timing.
    current.ce.assign('q_batchprobe', 4);
    const elapsed = performance.now() - started;
    try {
      const registration = {
        definitions: [...current.mgr._definitions.keys()].sort(),
        failures: [...current.mgr._lastPassBindFailures].sort(),
        skipped: [...current.mgr._structurallySkipped].sort(),
      };
      assert.equal(registration.definitions.length, 21, 'Pinned document registration count');
      assert.deepEqual(registration.failures, [], 'Document binding failures');
      assert.deepEqual(registration.skipped, [], 'Skipped document definitions');
      assert(registration.definitions.includes('c_t'), 'Original document function is missing');
      const originalResult = current.ce.box(['c_t', 0]).evaluate();
      assert.deepEqual([...originalResult.each()].map((x) => x.re), [0, 1], 'Original circular-path control');
      if (i === 0) metadata.registration = registration;
      else assert.deepEqual(registration, metadata.registration, 'Registration coverage changed between revisions');
      const actual = current.ce.box(['batchprobe', 'q_batchprobe']).evaluate();
      assert.equal(actual.re, coefficient * 4);
      const expression = current.ce.box(['batchprobe', 'q_batchprobe']);
      const updates = [];
      for (let j = 0; j < 20; j++) {
        const t = performance.now();
        current.ce.assign('q_batchprobe', j / 2 - 5);
        const value = expression.evaluate();
        updates.push(performance.now() - t);
        assert.equal(value.re, coefficient * (j / 2 - 5));
      }
      const editStarted = performance.now();
      current.mgr.setCells([
        { latex: '', visible: false, prelude: {
          id: 0, appliedSource: `function batchprobe(t: real) -> real { ${coefficient + 1} * t }`,
        } },
        ...doc.cells.filter((cell) => typeof cell.latex === 'string' && cell.latex.trim())
          .map((cell) => ({ latex: cell.latex, visible: cell.visible !== false })),
      ]);
      current.mgr.evaluate();
      await current.mgr.preludeSettled;
      const editedEngine = current.mgr.ce;
      editedEngine.assign('q_batchprobe', 4);
      const inPlacePreludeEditMs = performance.now() - editStarted;
      assert(current.mgr.appliedPrelude?.valid, 'Edited prelude was not applied');
      assert.equal(editedEngine.box(['batchprobe', 'q_batchprobe']).evaluate().re, (coefficient + 1) * 4);
      assert.deepEqual([...editedEngine.box(['c_t', 0]).evaluate().each()].map((x) => x.re), [0, 1]);
      assert.deepEqual([...current.mgr._definitions.keys()].sort(), registration.definitions);
      assert.deepEqual([...current.mgr._lastPassBindFailures], []);
      assert.deepEqual([...current.mgr._structurallySkipped], []);
      if (i > 0) samples.push({ fullEditMs: elapsed, inPlacePreludeEditMs,
        inPlaceReusesEngine: editedEngine === current.ce,
        valueEditMs: updates, registrationSha256: hash(JSON.stringify(registration)) });
    } finally { current.mgr.dispose(); }
  }
  records.push({ rounds, samples });
} catch (error) {
  failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  metadata.loadAfter = loadavg();
  writeFileSync(output, JSON.stringify({ metadata, records, failure }, null, 2) + '\n');
  rmSync(temporary, { recursive: true });
}
