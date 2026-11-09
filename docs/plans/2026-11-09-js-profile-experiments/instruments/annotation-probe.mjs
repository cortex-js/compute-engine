import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
const root = resolve(process.env.CE_ROOT ?? '/tmp/wt-js-profile-next');
const output = resolve(process.env.OUTPUT_DIR ?? '/tmp/js-profile-next');
const load = (file) => import(pathToFileURL(resolve(root, file)).href);
const { ComputeEngine, compile } = await load('src/compute-engine.ts');
const { ExperimentalScalarJavaScriptTarget } = await load('src/compute-engine/compilation/javascript-fragment-experiment.ts');
const ce = new ComputeEngine();
ce.declare('x', 'real'); ce.declare('y', 'real'); ce.declare('C', 'boolean');
const target = new ExperimentalScalarJavaScriptTarget();
const fixtures = [
  { name: 'repeated-arithmetic', json: ['Add',['Sin',['Multiply','x','y']],['Cos',['Multiply','x','y']]], oracle: ({x,y}) => Math.sin(x*y)+Math.cos(x*y) },
  { name: 'lazy-radical', json: ['If','C',['Sqrt','x'],['Negate','y']], oracle: ({x,y,C}) => C ? Math.sqrt(x) : -y },
];
const timing = process.argv.includes('--timing');
const rows = [];
for (const fixture of fixtures) for (const cse of [false,true]) for (const constantFold of [false,true]) {
  const expression = ce.expr(fixture.json);
  const options = {fallback:false,cse,constantFold};
  const legacy = () => compile(expression, options);
  const experimental = () => target.compile(expression, options);
  const before = legacy(); const result = experimental();
  assert.equal(result.code, before.code);
  const row = { name:fixture.name, cse, constantFold, nodes:target.lastExperiment.annotation.scope.facts.size, exactNodeReads:target.lastExperiment.queries, emissionVisits:target.lastExperiment.checkedNodes, preparedRootIdentical:target.lastExperiment.annotation.root === expression, codeSha256:createHash('sha256').update(result.code).digest('hex'), values:[] };
  for (const [x,y] of [[4,2],[-4,3],[0,-2]]) for (const C of [false,true]) {
    const input={x,y,C}; const actual=result.run(input);
    assert.deepEqual(actual, fixture.oracle(input)); assert.deepEqual(actual,before.run(input));
    row.values.push({input,value:Number.isNaN(actual)?'NaN':actual});
  }
  assert.equal(legacy().code,before.code);
  if (timing) {
    // Total compile cost over an already boxed expression, both routes; no cached preparation.
    for (let i=0;i<10;i++) {legacy();experimental();}
    row.trials=[];
    for (let trial=0;trial<5;trial++) {
      const times={};
      for (const [name,run] of trial%2 ? [['experimental',experimental],['legacy',legacy]] : [['legacy',legacy],['experimental',experimental]]) {
        const start=performance.now();
        for (let iteration=0;iteration<10;iteration++) run();
        times[name]=(performance.now()-start)/10;
      }
      row.trials.push(times);
    }
  }
  rows.push(row);
}
mkdirSync(output,{recursive:true});
const file=resolve(output,timing?'annotation-timing.json':'annotation-results.json');
writeFileSync(file,JSON.stringify({root,timing,fixtureCount:fixtures.length,rows},null,2)+'\n');
console.log(`${rows.length} paired fixture/options rows, ${rows.reduce((n,r)=>n+r.values.length,0)} value comparisons; ${file}`);
