import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 });
export const defaults = {
  precision: 50, jit: 'off', boxApi: 'box', dagDepth: 20, documentSize: 64,
  retainedUnits: 8, replacements: 12, retentionCheckpoints: 3,
  warmup: 50, iterations: 200, rounds: 4, profileIterations: 1000,
  allocationIterations: 1000, profileMinMs: 1500, samplingInterval: 32768, snapshots: false,
};
export function configuration(path) {
  const config = readJson(path);
  assert.equal(config.schemaVersion, 1);
  config.settings = { ...defaults, ...config.settings };
  for (const [key, value] of Object.entries(config.settings)) {
    if (typeof defaults[key] === 'number') assert(Number.isSafeInteger(value) && value > 0, `Invalid ${key}`);
  }
  assert.equal(config.settings.jit, 'off', 'Only the interpreter control policy is defined in this harness');
  assert(['box', 'expr'].includes(config.settings.boxApi));
  assert(Array.isArray(config.arms) && config.arms.length > 0);
  assert.equal(new Set(config.arms.map((a) => a.name)).size, config.arms.length);
  for (const arm of config.arms) {
    assert(/^[a-zA-Z0-9._-]+$/.test(arm.name));
    assert(/^[a-f0-9]{40}$/.test(arm.commit));
    arm.root = realpathSync(resolve(dirname(path), arm.root));
    arm.entry = resolve(arm.root, arm.entry);
    assert(arm.build, 'Build provenance is required, even for source controls');
  }
  config.nodeFlags ??= [];
  config.diagnosticFlags ??= [];
  assert(Array.isArray(config.nodeFlags) && Array.isArray(config.diagnosticFlags));
  return config;
}
function directoryFiles(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? directoryFiles(path) : [path];
  });
}
function fileManifest(paths, base) {
  return paths.sort().map((path) => ({ path: relative(base, path), bytes: statSync(path).size, sha256: hash(readFileSync(path)) }));
}
export function harnessManifest() {
  const paths = directoryFiles(resolve(root, 'benchmarks/stable-batch'));
  paths.push(resolve(root, 'benchmarks/stable-batch.mjs'));
  const files = fileManifest(paths, root);
  return { sha256: hash(JSON.stringify(files)), files };
}
export function armManifest(arm) {
  const commit = git(arm.root, ['rev-parse', 'HEAD']).toString().trim();
  assert.equal(commit, arm.commit, `Moved source: ${arm.name}`);
  const tracked = git(arm.root, ['ls-files', '-z', '--', 'src', 'scripts/build.mjs', 'scripts/build.sh', 'package.json', 'package-lock.json']).toString().split('\0').filter(Boolean);
  const untracked = git(arm.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'src']).toString().split('\0').filter(Boolean);
  const sourceFiles = fileManifest([...new Set([...tracked, ...untracked])].map((p) => resolve(arm.root, p)), arm.root);
  const sourceDiff = git(arm.root, ['diff', 'HEAD', '--', 'src', 'scripts/build.mjs', 'scripts/build.sh', 'package.json', 'package-lock.json']);
  assert(existsSync(arm.entry), `Missing bundle/source entry: ${arm.entry}`);
  const bundleFiles = arm.sourceOnly ? [] : fileManifest(directoryFiles(dirname(arm.entry)).filter((p) => /\.(js|map|json)$/.test(p)), dirname(arm.entry));
  return {
    name: arm.name, root: arm.root, entry: arm.entry, commit,
    sourceSha256: hash(JSON.stringify(sourceFiles)), sourceFiles,
    sourcePatchSha256: hash(sourceDiff), untrackedSourceFiles: untracked,
    // The coordinator's build record proves which source produced this bundle.
    build: arm.build, packageVersion: readJson(resolve(arm.root, 'package.json')).version,
    entrySha256: hash(readFileSync(arm.entry)), bundleSha256: hash(JSON.stringify(bundleFiles)), bundleFiles,
  };
}
export function environment() {
  const overrides = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(NODE_OPTIONS|UV_THREADPOOL_SIZE|TZ|LANG|LC_ALL|CE_.*|V8_.*|BUILD|GIT_VERSION)$/.test(name)).sort());
  return {
    node: process.version, v8: process.versions.v8, execArgv: process.execArgv,
    arch: arch(), platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(), heapLimitBytes: getHeapStatistics().heap_size_limit,
    overrides, load: loadavg(), processCount: execFileSync('ps', ['-A', '-o', 'pid=']).toString().trim().split('\n').length,
  };
}
export function assertTimingConfig(config, mode = 'time') {
  assert.equal(config.arms.length, 2, 'A comparison has exactly two serial arms');
  const kinds = mode === 'profile' ? ['production-split', 'diagnostic-production-split'] : ['production-split'];
  assert(config.arms.every((a) => !a.sourceOnly && kinds.includes(a.build.kind)), 'Use matched split builds; diagnostic builds are allowed only for profiles');
  assert.equal(config.arms[0].build.kind, config.arms[1].build.kind);
  assert.deepEqual(config.arms[0].build.settings, config.arms[1].build.settings, 'Production settings differ');
  assert(config.arms.every((a) => a.build.toolchain && !JSON.stringify(a.build).includes('COORDINATOR:')), 'Fill in toolchain provenance');
  const flags = [...config.nodeFlags, process.env.NODE_OPTIONS ?? ''].join(' ');
  assert(!/--(?:expose-gc|trace|cpu-prof|heap-prof|prof|log-|jitless|no-opt|inspect)/.test(flags), 'Timing must use ordinary V8 and no diagnostic/GC flags');
  assert(!flags.includes('tsx'), 'Source loaders are not production timing');
  assert(config.lockOwner && config.lockScript && Number.isFinite(config.maxLoad), 'Explicit lock owner/script and load limit required');
}
export function boxState(config) {
  const lock = execFileSync(process.execPath, [config.lockScript, 'check', config.lockOwner], { encoding: 'utf8' });
  const processes = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,%cpu=,command='], { encoding: 'utf8' });
  const contenders = processes.split('\n').filter((line) => /(?:bin\/jest|jest-worker|scripts\/build\.mjs|scripts\/ci-nightly|check-corpus|scalar-arithmetic\.mjs|ce1210-ab-cases\.mjs)/.test(line));
  const load = loadavg();
  return { lockOwner: config.lockOwner, lock, load, contenders, valid: contenders.length === 0 && load[0] <= config.maxLoad };
}
export function summarize(values) {
  assert(values.length > 0 && values.every(Number.isFinite));
  const ordered = [...values].sort((a, b) => a - b);
  const half = ordered.length >> 1;
  const median = ordered.length % 2 ? ordered[half] : (ordered[half - 1] + ordered[half]) / 2;
  return { n: values.length, median, min: ordered[0], max: ordered.at(-1), spread: ordered.at(-1) - ordered[0], relativeSpread: median === 0 ? null : (ordered.at(-1) - ordered[0]) / median, values };
}
