// The diagnostic builder is a development instrument, never published runtime code.
// eslint-disable-next-line no-restricted-imports
import { build } from 'esbuild';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Diagnostic-only source edits. Timed bundles never contain this plugin.
const probes = [
  ['binding-unit.ts', 'unitReadToken', 'unit-token-creation'],
  ['binding-unit.ts', 'readUnitEntry', 'unit-lookup'],
  ['binding-unit.ts', 'readsUnitVariable', 'unit-variable-read'],
  ['binding-unit.ts', 'get _version', 'unit-token-validation'],
  ['boxed-expression/object-deps.ts', 'beginObjectDeps', 'dependency-collection'],
  ['boxed-expression/object-deps.ts', 'recordObjectRead', 'dependency-recording'],
  ['boxed-expression/object-deps.ts', 'mergeObjectDeps', 'dependency-propagation'],
  ['boxed-expression/object-deps.ts', 'objectDepsValid', 'dependency-validation'],
  ['boxed-expression/boxed-symbol.ts', '_cachedResolution', 'external-symbol-resolution-check'],
  ['boxed-expression/boxed-function.ts', '_reboxedForCallee', 'external-callee-version-check'],
];
function instrument(source, name, label) {
  const pattern = name.startsWith('get ') ? `${name}(` : `${name}(`;
  let start = source.indexOf(pattern);
  // Method calls precede some declarations; select a declaration by line indentation/prefix.
  const expression = new RegExp(`(?:^|\\n)(?:export )?(?:function |  (?:private )?)${name.replace('get ', 'get ')}(?:<[^>]+>)?\\(`, 'g');
  const match = expression.exec(source);
  if (!match) throw new Error(`Probe declaration missing: ${name}`);
  start = source.indexOf('(', match.index);
  let depth = 1;
  let cursor = start + 1;
  while (depth) { if (source[cursor] === '(') depth++; if (source[cursor] === ')') depth--; cursor++; }
  const brace = source.indexOf(' {\n', cursor) + 1;
  if (brace === 0) throw new Error(`Probe body missing: ${name}`);
  return source.slice(0, brace + 1) + `\n globalThis.__stableBatchProbe?.(${JSON.stringify(label)});` + source.slice(brace + 1);
}

const directory = await mkdtemp(join(tmpdir(), 'ce-stable-batch-probes-'));
try {
  const root = new URL('../../', import.meta.url).pathname;
  const entry = `import { Phase1Adapter, observable } from ${JSON.stringify(join(root, 'benchmarks/stable-batch/phase1-adapter.mjs'))}; import { UnitEnvironment, readUnitEntry, readsUnitVariable } from ${JSON.stringify(join(root, 'src/compute-engine/binding-unit.ts'))}; import { BoxedType } from ${JSON.stringify(join(root, 'src/common/type/boxed-type.ts'))}; import { beginObjectDeps, endObjectDeps, objectDepsValid } from ${JSON.stringify(join(root, 'src/compute-engine/boxed-expression/object-deps.ts'))}; export { Phase1Adapter, observable }; export function unitControls() { const key = {}; const env = UnitEnvironment.forOperation(undefined); env.set(key, 'probe', new BoxedType('real')); const context = { trialEnvironment: () => undefined, currentOperation: () => undefined }; beginObjectDeps(); readUnitEntry(context, env, key, 'probe'); readsUnitVariable(context, env, key, 'N'); const deps = endObjectDeps(); objectDepsValid(deps); }`;
  const output = join(directory, 'probe.mjs');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true, platform: 'node', format: 'esm', target: 'es2022', outfile: output, plugins: [{ name: 'throw-probes', setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, async args => {
      const applicable = probes.filter(([file]) => args.path.endsWith(`/compute-engine/${file}`));
      if (!applicable.length) return;
      let contents = await readFile(args.path, 'utf8');
      for (const [, name, label] of applicable) contents = instrument(contents, name, label);
      return { contents, loader: 'ts' };
    });
  } }] });
  const { Phase1Adapter, observable, unitControls } = await import(pathToFileURL(output));
  const fixtures = JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8')).fixtures.filter(x => x.requiredPhase === 1);
  const assert = (await import('node:assert/strict')).default;
  const hits = {};
  let armed = false;
  globalThis.__stableBatchProbe = label => { hits[label] = (hits[label] ?? 0) + 1; if (armed) throw new Error(`FORBIDDEN:${label}`); };
  const failures = [];
  const staticSweeps = { units: 0, bindings: 0 };
  for (const fixture of fixtures) {
    const adapter = new Phase1Adapter();
    for (const step of fixture.steps) {
      armed = !['prepare', 'revise', 'hostDeclare', 'hostOperator'].includes(step.op);
      try {
        const raw = adapter.step(step);
        assert.partialDeepStrictEqual(observable(raw), step.expect);
        if (!armed && raw.unit) {
          armed = true;
          staticSweeps.units++;
          for (const binding of raw.unit.bindings) { staticSweeps.bindings++; void binding.type; void binding.name; void binding.node?.type; }
        }
      } catch (error) { failures.push({ fixture: fixture.id, step: step.id, error: error.message }); }
      armed = false;
    }
  }
  // Positive controls use production boxing/evaluation, not the prototype.
  const adapter = new Phase1Adapter();
  const before = { ...hits };
  adapter.engine.declare('probe', 'real');
  const expression = adapter.engine.box(['Add', 'probe', 1]);
  void expression.type;
  expression.evaluate();
  void expression.type;
  unitControls();
  const positive = Object.fromEntries(probes.map(([, , label]) => [label, (hits[label] ?? 0) - (before[label] ?? 0)]));
  console.log(JSON.stringify({ probes: probes.map(([file, fn, label]) => ({ file, function: fn, label })), failures, staticSweeps, positiveControls: positive }, null, 2));
  process.exitCode = failures.length || !staticSweeps.units || !staticSweeps.bindings || Object.values(positive).some(count => count === 0) ? 1 : 0;
} finally {
  delete globalThis.__stableBatchProbe;
  await rm(directory, { recursive: true, force: true });
}
