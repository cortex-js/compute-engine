/**
 * Read-only Tycho baseline adapter. Requires the box lock for execution.
 * Arguments: <tycho root> <CE package root> <othello|preludes|audit> <output.json>
 * Invoke with --import tsx and Tycho's ce-alt-hook.mjs; CE_ALT_PKG must match.
 * No Tycho source, package, git state or default audit output is changed.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync, realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';

const [tychoArg, packageArg, mode, outputArg] = process.argv.slice(2);
assert(tychoArg && packageArg && outputArg, 'Expected root, package, mode, output');
assert(['othello', 'preludes', 'audit'].includes(mode), 'Unknown mode');
function canonicalPath(path, depth = 0) {
  assert(depth < 128, 'Cyclic or excessively deep output path');
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink())
    return canonicalPath(resolve(dirname(path), readlinkSync(path)), depth + 1);
  return stat ? realpathSync(path) : join(canonicalPath(dirname(path), depth + 1), basename(path));
}
const root = realpathSync(resolve(tychoArg));
const ceRoot = resolve(packageArg);
const output = canonicalPath(resolve(outputArg));
for (const path of [output, output + '.full.json', output + '.digest.json']) {
  const canonical = canonicalPath(path);
  assert(canonical !== root && !canonical.startsWith(root + '/'), 'Output must be outside the Tycho checkout');
}
assert.equal(resolve(process.env.CE_ALT_PKG ?? ''), ceRoot, 'Set CE_ALT_PKG to the package root');
const rounds = Number(process.env.ROUNDS ?? 5);
assert(Number.isInteger(rounds) && rounds >= 3, 'ROUNDS must be at least 3');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function sourceFingerprint() {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|mts|js|mjs|json)$/.test(entry.name)) files.push(path);
    }
  }
  for (const dir of ['src', 'scripts']) walk(join(root, dir));
  for (const name of ['package.json', 'package-lock.json']) files.push(join(root, name));
  if (mode === 'audit') {
    const list = join(root, '_TASK/desmos/desmos-corpus/CORE_CORPUS.txt');
    files.push(list);
    const directories = {
      art: '_TASK/desmos/desmos-corpus/states',
      neyret: '_TASK/requirements/neyret-corpus/states',
    };
    for (const line of readFileSync(list, 'utf8').split('\n').map((s) => s.trim())) {
      if (!line || line.startsWith('#')) continue;
      const [corpus, id] = line.split('/');
      assert(directories[corpus], `Unknown corpus ${corpus}`);
      files.push(join(root, directories[corpus], `${id}.json`));
    }
  }
  const digest = createHash('sha256');
  for (const path of files.sort()) {
    digest.update(relative(root, path) + '\0');
    digest.update(existsSync(path) ? readFileSync(path) : '<absent>');
  }
  return digest.digest('hex');
}

const before = sourceFingerprint();
const metadata = {
  mode, root, ceRoot, ceVersion: JSON.parse(readFileSync(join(ceRoot, 'package.json'))).version,
  node: process.version, v8: process.versions.v8, arch: process.arch,
  nodeOptions: process.env.NODE_OPTIONS ?? '', execArgv: process.execArgv,
  adapterSha256: hash(readFileSync(new URL(import.meta.url))),
  tychoSourceSha256: before, loadBefore: loadavg(), rounds: mode === 'audit' ? 1 : rounds,
  jit: mode === 'othello' ? 'off during setup and calls; explicit prelude compilation remains allowed' : 'host default; explicit compilation allowed',
};
process.chdir(root);
mkdirSync(dirname(output), { recursive: true });
const records = [];
let failure;
try {
  if (mode === 'audit') {
    // Relocate only this instrument; its imported modules remain in Tycho.
    // Replace metadata-only git/version reads, with exact occurrence guards.
    const auditPath = join(root, 'scripts/audit-ce-codegen.mts');
    const original = readFileSync(auditPath, 'utf8');
    const gitRead = 'execSync("git rev-parse --short HEAD").toString().trim()';
    const versionRead = '"node_modules/@cortex-js/compute-engine/package.json"';
    assert.equal(original.split(gitRead).length, 2, 'Audit git metadata expression changed');
    assert.equal(original.split(versionRead).length, 2, 'Audit version metadata expression changed');
    let source = original.replace(gitRead, JSON.stringify(`source-${before.slice(0, 12)}`))
      .replace(versionRead, JSON.stringify(join(ceRoot, 'package.json')));
    source = source.replace(/from\s+"(\.[^"]+)"/g,
      (_, specifier) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(auditPath), specifier)).href)}`);
    const temporary = mkdtempSync(join(tmpdir(), 'ce-batch-tycho-audit-'));
    try {
      const relocated = join(temporary, 'audit.mts');
      writeFileSync(relocated, source);
      metadata.auditSourceSha256 = hash(original);
      metadata.auditAdaptedSha256 = hash(source);
      metadata.auditAdaptations = ['absolute relative imports', 'source hash instead of git command', 'alternate package version'];
      process.argv = [process.execPath, relocated, '--full', output + '.full.json', '--digest', output + '.digest.json'];
      const stderrWrite = process.stderr.write;
      let rowFailures = 0;
      const failureExamples = [];
      process.stderr.write = function (chunk, ...args) {
        const text = String(chunk);
        if (text.includes('row failed (')) {
          rowFailures++;
          if (failureExamples.length < 3) failureExamples.push(text.trim());
        }
        return stderrWrite.call(this, chunk, ...args);
      };
      let totalMs;
      try {
        const start = performance.now();
        await import(pathToFileURL(relocated).href);
        totalMs = performance.now() - start;
      } finally { process.stderr.write = stderrWrite; }
      const audit = JSON.parse(readFileSync(output + '.full.json', 'utf8'));
      const documentFailures = audit.documents.filter((doc) => doc.error).length;
      records.push({ status: rowFailures || documentFailures ? 'incomparable' : 'ready',
        totalMs, rowFailures, documentFailures, failureExamples,
        documents: audit.documents.length, rows: audit.documents.reduce((n, d) => n + d.rows, 0),
        series: audit.documents.reduce((n, d) => n + d.series, 0), compileRecords: audit.records.length,
        full: output + '.full.json', digest: output + '.digest.json' });
    } finally {
      rmSync(temporary, { recursive: true });
    }
  } else {
    // oxlint-disable-next-line no-restricted-imports -- The host's alternate loader selects the measured production bundle.
    const ceModule = await import('@cortex-js/compute-engine');
    const importSource = (path) => import(pathToFileURL(join(root, path)).href);
    const { registerComputeEngineModule } = await importSource('src/plot-core/ce-module-registry.ts');
    const { createEngineForProfile } = await importSource('src/plot-core/engine-profiles.ts');
    const { runPrelude } = await importSource('src/plot-core/prelude-runner.ts');
    registerComputeEngineModule(ceModule);
    if (mode === 'othello') {
      const { OTHELLO_ENTRY } = await importSource('src/graph-paper/onboarding/showcase-othello.js');
      metadata.fixtureSha256 = hash(OTHELLO_ENTRY.prelude);
      const ce = createEngineForProfile('document');
      assert(ce);
      ce.jit = 'off';
      const compileBefore = ce._mapAutoCompileStats ? { ...ce._mapAutoCompileStats } : null;
      const prelude = await runPrelude(ce, OTHELLO_ENTRY.prelude);
      assert(prelude.valid, JSON.stringify(prelude.diagnostics));
      ce.declare('B', 'list<integer>');
      ce.assign('B', ce.box('O_0').evaluate());
      const cases = [
        ['legal', ['legal', 'B', ['At', 'B', 65]], [20, 27, 38, 45]],
        ['stones-positive', ['stones', 'B', 1], [29, 36]],
        ['stones-negative', ['stones', 'B', -1], [28, 37]],
      ];
      for (const [id, input, expected] of cases) {
        const run = () => {
          const value = ce.box(input).evaluate();
          return { count: value.count, values: [...value.each()].map((x) => x.re) };
        };
        const control = { count: expected.length, values: expected };
        assert.deepEqual(run(), control, `${id} mathematical control`);
        const samples = [];
        for (let i = 0; i < rounds; i++) {
          const start = performance.now();
          const actual = run();
          samples.push(performance.now() - start);
          assert.deepEqual(actual, control, id);
        }
        records.push({ id, expected, samplesMs: samples, medianMs: median(samples) });
      }
      assert.equal(ce.jit, 'off');
      metadata.implicitCompileStats = ce._mapAutoCompileStats ? { ...ce._mapAutoCompileStats } : null;
      metadata.implicitCompileDelta = compileBefore ? Object.fromEntries(
        Object.entries(compileBefore).map(([key, value]) => [key, ce._mapAutoCompileStats[key] - value])
      ) : null;
      if (metadata.implicitCompileDelta) {
        assert.equal(metadata.implicitCompileDelta.attempts, 0, 'Implicit compilation attempted with jit off');
        assert.equal(metadata.implicitCompileDelta.compiledHits, 0, 'Implicit compilation used with jit off');
      }
    } else {
      const { SHOWCASE } = await importSource('src/graph-paper/onboarding/templates.ts');
      for (const entry of SHOWCASE.filter((x) => typeof x.prelude === 'string' && x.prelude.trim())) {
        const samples = [];
        const phases = [];
        for (let i = 0; i < rounds + 1; i++) {
          const ce = createEngineForProfile('document');
          assert(ce);
          const start = performance.now();
          const result = await runPrelude(ce, entry.prelude);
          const elapsed = performance.now() - start;
          assert(result.valid, `${entry.id}: ${JSON.stringify(result.diagnostics)}`);
          if (i > 0) {
            samples.push(elapsed);
            phases.push({ timings: result.timings, routes: result.statements.map((s) => s.route) });
          }
        }
        records.push({ id: entry.id, fixtureSha256: hash(entry.prelude), samplesMs: samples, medianMs: median(samples), phases });
      }
      assert(records.length > 0, 'No preludes selected');
    }
  }
} catch (error) {
  failure = { message: String(error), stack: error?.stack };
  process.exitCode = 1;
} finally {
  metadata.tychoSourceAfterSha256 = sourceFingerprint();
  metadata.sourceStable = before === metadata.tychoSourceAfterSha256;
  metadata.loadAfter = loadavg();
  if (!metadata.sourceStable) process.exitCode = 1;
  writeFileSync(output, JSON.stringify({ metadata, records, failure }, null, 2) + '\n');
}
