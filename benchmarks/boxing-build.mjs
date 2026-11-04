/**
 * Build disposable core bundles for boxing counts and uninstrumented profiles.
 * Usage: node benchmarks/boxing-build.mjs <checkout>. No source file is edited.
 * Counts are constructor/function entries, not a claim about physical V8 allocations.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
// This build driver uses development tools and is never a package runtime import.
// eslint-disable-next-line no-restricted-imports
import { build as buildBundle, version as esbuildVersion } from 'esbuild';
// eslint-disable-next-line no-restricted-imports
import ts from 'typescript';

const root = await realpath(resolve(process.argv[2] ?? '.'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const targets = {
  'src/compute-engine/boxed-expression/boxed-function.ts': { classes: ['BoxedFunction'] },
  'src/compute-engine/boxed-expression/boxed-number.ts': { classes: ['BoxedNumber'], functions: ['canonicalNumber'] },
  'src/compute-engine/boxed-expression/boxed-symbol.ts': { classes: ['BoxedSymbol'] },
  'src/compute-engine/boxed-expression/abstract-boxed-expression.ts': { classes: ['_BoxedExpression'] },
  'src/compute-engine/numeric-value/big-numeric-value.ts': { classes: ['BigNumericValue'] },
  'src/common/type/boxed-type.ts': { classes: ['BoxedType'] },
  'src/compute-engine/numeric-value/exact-numeric-value.ts': { classes: ['ExactNumericValue'] },
  'src/compute-engine/numeric-value/machine-numeric-value.ts': { classes: ['MachineNumericValue'] },
  'src/compute-engine/boxed-expression/box.ts': { functions: ['box', 'boxFunction'] },
  'src/compute-engine/boxed-expression/arithmetic-add.ts': { functions: ['canonicalAdd'] },
  'src/compute-engine/boxed-expression/arithmetic-mul-div.ts': { functions: ['canonicalMultiply', 'canonicalDivide'] },
};
const expected = new Set(Object.values(targets).flatMap((t) => [
  ...(t.classes ?? []).map((n) => `new.${n}`),
  ...(t.functions ?? []).map((n) => `call.${n}`),
]));
const seen = new Map();

function instrument(source, file, target) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const inserts = [];
  const add = (position, key, detail) => {
    seen.set(key, (seen.get(key) ?? 0) + 1);
    inserts.push({ position, text: `;globalThis[Symbol.for('ce.benchmarks.boxing.v1')]?.hit(${JSON.stringify(key)}${detail ? `, ${detail}` : ''});` });
  };
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && target.classes?.includes(node.name?.text)) {
      const ctor = node.members.find((m) => ts.isConstructorDeclaration(m) && m.body);
      assert(ctor?.body, `Missing constructor: ${node.name.text}`);
      const parentCall = ctor.body.statements.find((s) => ts.isExpressionStatement(s) &&
        ts.isCallExpression(s.expression) && s.expression.expression.kind === ts.SyntaxKind.SuperKeyword);
      const position = parentCall?.end ?? ctor.body.getStart(tree) + 1;
      const detail = node.name.text === 'BoxedFunction' ? ctor.parameters[1].name.getText(tree) : undefined;
      if (detail) assert(ts.isIdentifier(ctor.parameters[1].name) && detail === 'operator', 'Unexpected operator parameter');
      add(position, `new.${node.name.text}`, detail);
    }
    if (ts.isFunctionDeclaration(node) && node.body && target.functions?.includes(node.name?.text))
      add(node.body.getStart(tree) + 1, `call.${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  for (const { position, text } of inserts.sort((a, b) => b.position - a.position))
    source = source.slice(0, position) + text + source.slice(position);
  return source;
}

for (const counted of [false, true]) {
  const entry = `dist/${counted ? 'boxing-counts' : 'boxing-profile'}/core.js`;
  const plugin = {
    name: 'boxing-probe',
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
        let contents = (await readFile(path, 'utf8')).replaceAll('{{SDK_VERSION}}', pkg.version);
        const target = targets[relative(root, path).split('\\').join('/')];
        if (counted && target) contents = instrument(contents, path, target);
        return { contents, loader: 'ts' };
      });
    },
  };
  const result = await buildBundle({
    write: false,
    absWorkingDir: root, entryPoints: ['src/core.ts'], outfile: entry,
    bundle: true, format: 'esm', target: ['es2022'], resolveExtensions: ['.ts', '.js'],
    define: { ENV: '"production"', SDK_VERSION: JSON.stringify(pkg.version), GIT_VERSION: '"boxing-profile"' },
    minify: true, drop: ['debugger'], pure: ['console.assert', 'console.log'],
    sourcemap: 'external', sourcesContent: false, plugins: [plugin],
  });
  if (counted) {
    assert.deepEqual([...seen.keys()].sort(), [...expected].sort(), 'Instrumentation targets changed');
    assert([...seen.values()].every((n) => n === 1), 'Duplicate instrumentation target');
    const code = result.outputFiles.find((f) => f.path.endsWith('core.js')).text;
    for (const key of expected) assert(code.includes(JSON.stringify(key)), `Removed probe: ${key}`);
  }
  for (const file of result.outputFiles) {
    await mkdir(resolve(file.path, '..'), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  const manifest = {
    root, entry, counted, coreOnly: true, esbuildVersion, typescriptVersion: ts.version, nodeVersion: process.version,
    builderSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['-C', root, 'diff', 'HEAD', '--', 'src'], { maxBuffer: 64 * 1024 * 1024 })).digest('hex'), packageVersion: pkg.version,
    commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['-C', root, 'diff', 'HEAD'], { maxBuffer: 64 * 1024 * 1024 })).digest('hex'),
    entrySha256: createHash('sha256').update(await readFile(resolve(root, entry))).digest('hex'),
    targets: counted ? [...seen.keys()].sort() : [],
    note: 'Core-only diagnostic bundle, production minifier settings. Do not time the counted build.',
  };
  await mkdir(resolve(root, 'dist'), { recursive: true });
  await writeFile(resolve(root, `${entry}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest));
}
