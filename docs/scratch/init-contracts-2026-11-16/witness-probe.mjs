// One bounded witness packet, outside measured production execution.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const fixtureRoot = resolve(process.argv[3]);
const ts = createRequire(resolve(root, 'package.json'))('typescript');
const { ComputeEngine } = await import(pathToFileURL(resolve(root, 'src/compute-engine.ts')));
const { compile } = await import(pathToFileURL(resolve(root, 'src/compile.ts')));
const { parseEpsil, resolveLibraryNames, executeEpsil } = await import(pathToFileURL(resolve(root, 'src/epsil.ts')));
function template(path, name) {
  const source = ts.createSourceFile(path, readFileSync(resolve(fixtureRoot, path), 'utf8'), ts.ScriptTarget.Latest, true);
  let text;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer &&
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) text = node.initializer.text;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (text === undefined) throw new Error(`No template ${name}`);
  return text;
}
function compilation(name, source, run) {
  const ce = new ComputeEngine();
  const [ast, diagnostics] = parseEpsil(source);
  if (diagnostics.some(x => x.severity === 'error')) throw new Error(JSON.stringify(diagnostics));
  const expression = ce.box(resolveLibraryNames(ast, source, ce));
  const result = compile(expression, { to: 'javascript' });
  return { name, valid: expression.isValid, success: result.success,
    error: result.error, value: result.success && run ? result.run({}) : undefined };
}
const source = template('test/compute-engine/recursive-list-builder-compile.test.ts', 'PROGRAM');
const annotated = source.replace('function fill(p, q, r, depth, acc) {',
  'function fill(p, q, r, depth, acc: list<tuple<number, number, number, number>>) {')
  .replace('function seen(acc, c)', 'function seen(acc: list<tuple<number, number, number, number>>, c)');
const results = [compilation('recursive-original-unannotated', source, false),
  compilation('recursive-existing-two-annotations', annotated, true)];
for (const name of ['run-length-encoding', 'isbn-verifier']) {
  const migrated = readFileSync(resolve(fixtureRoot, `test/epsil/corpus/exercism/${name}.epsil`), 'utf8');
  const original = migrated.replace('let prev: string | character =', 'let prev =')
    .replace('let cs: list<character> =', 'let cs =');
  for (const [form, program] of [['original', original], ['annotated', migrated]]) {
    const r = executeEpsil(new ComputeEngine(), program);
    results.push({ name: `${name}-${form}`, value: r.value?.toString(), diagnostics: r.diagnostics.map(d => d.message) });
  }
}
console.log(JSON.stringify({root, fixtureRoot, results}, null, 2));
