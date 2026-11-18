// Run under the coordinator's final validation lock, never during timing.
// node --import /path/to/node_modules/tsx/dist/loader.mjs this-file.mjs ENGINE_ROOT LEGACY_FIXTURE_ROOT OUTPUT_JSON
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]);
const fixtures = resolve(process.argv[3]);
const output = resolve(process.argv[4]);
const ts = createRequire(resolve(root, 'package.json'))('typescript');
const load = (name) => import(pathToFileURL(resolve(root, name)));
const { ComputeEngine } = await load('src/compute-engine.ts');
const { compile } = await load('src/compile.ts');
const { parseEpsil, resolveLibraryNames, executeEpsil } = await load('src/epsil.ts');
function template(path, name) {
  const ast = ts.createSourceFile(path, readFileSync(resolve(fixtures, path), 'utf8'), ts.ScriptTarget.Latest, true);
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer &&
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) found = node.initializer.text;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (found === undefined) throw new Error(`No ${name} in ${path}`);
  return found;
}
const recursive = template('test/compute-engine/recursive-list-builder-compile.test.ts', 'PROGRAM');
const annotatedRecursive = recursive.replace('function fill(p, q, r, depth, acc) {',
  'function fill(p, q, r, depth, acc: list<tuple<number, number, number, number>>) {')
  .replace('function seen(acc, c)', 'function seen(acc: list<tuple<number, number, number, number>>, c)');
const witnesses = [];
for (const fixture of ['a-user-functions', 'b-inlined-tuples', 'c-inlined-flat-lists']) {
  const source = readFileSync(resolve(fixtures, `test/compute-engine/fixtures/epsil-gasket/${fixture}.epsil`), 'utf8');
  witnesses.push({ name: `gasket-${fixture}-original`, source, large: true });
  if (fixture === 'a-user-functions') witnesses.push({ name: 'gasket-a-existing-seen-annotation', large: true,
    source: source.replace('function seen(acc, c)', 'function seen(acc: list<tuple<number, number, number, number>>, c)') });
}
witnesses.push({name:'recursive-PROGRAM-original', source:recursive, large:true},
  {name:'recursive-PROGRAM-existing-two-annotations', source:annotatedRecursive, large:true},
  {name:'recursive-small-original', source:'function f(acc) {let out=acc; out=[...out,1]; out}; f([0])'},
  {name:'recursive-small-annotated', source:'function f(acc:list) {let out=acc; out=[...out,1]; out}; f([0])'},
  {name:'empty-carrier-original', source:'let xs=[]; let i=1; while i<=3 {xs=[...xs,i*i]; i=i+1}; length(xs)'},
  {name:'empty-carrier-annotated', source:'let xs: list<real> = []; let i:integer=1; while i<=3 {xs=[...xs,i*i]; i=i+1}; length(xs)'},
  {name:'growing-rows-original', source:'let xs=[[1,2]]; let i=1; while i<=length(xs)&&i<=3 {xs=[...xs,[3,4]];i=i+1};length(xs)'},
  {name:'growing-rows-annotated', source:'let xs: list<list<real>> = [[1,2]]; let i:integer=1; while i<=length(xs)&&i<=3 {xs=[...xs,[3,4]];i=i+1};length(xs)'},
  {name:'rank-change-original', source:'let L=[1,2];L=[[1,2]];L'},
  {name:'rank-change-annotated', source:'let L: list<integer|list<integer>> = [1,2];L=[[1,2]];L'});
const results = [];
for (const {name,source,large=false} of witnesses) {
  const entry = {name,source,large};
  try {
    const ce = new ComputeEngine();
    const [ast, parseDiagnostics] = parseEpsil(source);
    entry.parseDiagnostics = parseDiagnostics;
    const expr = ce.box(resolveLibraryNames(ast, source, ce));
    entry.valid = expr.isValid;
    entry.typeBefore = expr.type.toString();
    try {
      const compiled = compile(expr, {to:'javascript'});
      entry.compilation = {success:compiled.success, diagnostic:compiled.diagnostic, error:String(compiled.error ?? '')};
      // Failed large witnesses must not silently launch an expensive fallback.
      if (compiled.success || !large) {
        entry.compilation.runRoute = compiled.success ? 'compiled' : 'interpreter-fallback';
        try { entry.compilation.runValue = compiled.run({}); }
        catch (error) { entry.compilation.runError = String(error); }
      }
    } catch (error) { entry.compilation = {success:false, thrown:String(error)}; }
    if (!large) {
      const evaluated = executeEpsil(new ComputeEngine(), source);
      entry.interpreter = {value:evaluated.value.json, diagnostics:evaluated.diagnostics};
      entry.typeAfter = expr.type.toString();
    } else entry.interpreter = {executed:false, reason:'Large interpreter run omitted; compile success and native run recorded separately.'};
  } catch (error) {entry.error=String(error);}
  results.push(entry);
}
writeFileSync(output, JSON.stringify({root,fixtures,results},null,2)+'\n');
