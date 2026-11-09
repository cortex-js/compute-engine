// Serial source benchmark. Setup and mathematical validation are untimed.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(process.argv[2] ?? '.');
const load = (p) => import(pathToFileURL(resolve(root, p)));
const { ComputeEngine } = await load('src/compute-engine.ts');
const { compile } = await load('src/compute-engine/compilation/compile-expression.ts');
const { harvestCse } = await load('src/compute-engine/compilation/cse.ts');
const { callsReach } = await load('src/compute-engine/boxed-expression/declared-parameter-result.ts');
const { appliedLiteralResultType } = await load('src/compute-engine/boxed-expression/call-result-type.ts');
const { describe, describeType } = await load('src/compute-engine/boxed-expression/operand-descriptor.ts');
const mode = process.env.MODE ?? 'timing';
assert(['timing', 'check'].includes(mode), 'MODE must be timing or check');
const runs = Number(process.env.RUNS ?? 7);
const iterations = Number(process.env.ITERATIONS ?? 25);
assert(Number.isInteger(runs) && runs > 0 && Number.isInteger(iterations) && iterations > 0);
const only = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const configs = [
  ...[4, 8, 16, 24].map(depth => ({ depth, width: 1, sharing: 2 })),
  ...[4, 16, 64].map(width => ({ depth: 4, width, sharing: 2 })),
  ...[1, 4].map(sharing => ({ depth: 8, width: 1, sharing })),
];
const fixtures = [];
function substitutedValue(root) {
  const memo = new Map();
  function value(e) {
    if(memo.has(e)) return memo.get(e);
    const n=e.operator==='Add' ? e.ops.reduce((a,b)=>a+value(b),0) : e.operator==='Sin' ? Math.sin(value(e.ops[0])) : e.re;
    assert(Number.isFinite(n));memo.set(e,n);return n;
  }
  return value(root);
}
function graph(ce, {depth, width, sharing}, leaf) {
  const roots = [];
  for (let j = 0; j < width; j++) {
    let e = leaf ?? ce._fn('Sin', [ce.symbol('x')]);
    for (let i = 0; i < depth; i++) e = ce._fn('Add', Array(sharing).fill(e));
    roots.push(e);
  }
  return width === 1 ? roots[0] : ce._fn('Add', roots);
}
for (const config of configs) {
  const suffix = `d${config.depth}/w${config.width}/s${config.sharing}`;
  for (const op of ['subs', 'type-search', 'cse', 'compile']) fixtures.push({
    id: `${op}/${suffix}`, config,
    setup() {
      const ce = new ComputeEngine({precision: 'machine'});
      ce.declare('x', 'real');
      const e = graph(ce, config);
      const expected = config.width * config.sharing ** config.depth * Math.sin(0.25);
      if (op === 'subs') return {
        run: () => e.subs({ x: 0.25 }, {canonical: false}),
        check: r => assert(Math.abs(substitutedValue(r) - expected) < 1e-10 * Math.max(1,Math.abs(expected))),
      };
      if (op === 'type-search') return {run: () => callsReach(e, 'absentCallee'), check: r => assert.equal(r, false)};
      if (op === 'cse') return {run: () => harvestCse(e), check: r => assert(r.diagnostics.edges > config.depth)};
      return {run: () => compile(e, {constantFold: false}), check(r) {
        assert(r.success, JSON.stringify(r.unsupported));
        assert(Math.abs(r.run({x: 0.25}) - expected) < 1e-10 * Math.max(1,Math.abs(expected)));
      }};
    },
  });
}
for (const depth of [4, 8, 12, 16]) fixtures.push({
  id: `type-decline/d${depth}`,
  setup() {
    const ce = new ComputeEngine({precision: 'machine'});
    const x = ce.symbol('x');
    const e = graph(ce, {depth, width: 1, sharing: 2}, ce._fn('h', [x]));
    const body = ce._fn('Add', [ce._fn('Sin', [x]), e]);
    const literal = ce._fn('Function', [body, ce.symbol('h'), x]);
    const fn = {...describe(literal), type: {kind: 'signature', args: [{name:'h',type:'function'},{name:'x',type:'real'}], result:'any'}};
    let derived = 0;
    return {
      run: () => appliedLiteralResultType(fn, [describeType('function'), describeType('real')], 'any', () => { derived++; return 'real'; }),
      check: r => assert.equal(r, undefined),
      checkPath: () => assert(derived > 0, 'the decline must derive its scalar sibling'),
      warmMeaning: 'cached type result lookup',
    };
  },
});
fixtures.push({
  id: 'host/slider-shader',
  setup() {
    const ce = new ComputeEngine({precision: 'machine'});
    ce.declare('x','real'); ce.declare('T','real'); ce.assign('T',2);
    const e=ce.box(['Add',['Sin',['Multiply','T','x']],['Cos',['Multiply','T','x']]]);
    return {run:()=>compile(e,{to:'glsl',vars:{T:'T',x:'x'},hideValues:['T']}),check:r=>{assert(r.success);assert.match(r.code,/sin/);assert.match(r.code,/cos/);}};
  },
}, {
  id: 'host/map-callback',
  setup() {
    const ce = new ComputeEngine({precision: 'machine'});
    const e=ce.box(['Map',['Function',['Add',['Sin','t'],['Cos','t']],'t'],['List',0,1,2,3]]);
    return {run:()=>compile(e, {constantFold: false}),check:r=>{assert(r.success);assert.match((r.preamble ?? '') + r.code, /Math\.sin/);const actual=r.run();for(let i=0;i<4;i++)assert(Math.abs(actual[i]-Math.sin(i)-Math.cos(i))<1e-12);}};
  },
});
for (const id of only) assert(fixtures.some(f=>f.id===id),`unknown ONLY selector ${id}`);
function summary(values){values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length/2)],min:values[0],max:values.at(-1)};}
console.log(JSON.stringify({environment:{root,node:process.version,revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),runs,iterations,precision:'machine',sourceDiffSha256:createHash('sha256').update(execFileSync('git',['-C',root,'diff','HEAD','--','src'],{encoding:'utf8'})).digest('hex'),entry:'source via tsx',first:'fresh engine in a loaded process',warmup:5}}));
for (const f of fixtures) {
  if(only.size&&!only.has(f.id))continue;
  if(mode==='check'){const s=f.setup();s.check(s.run());s.checkPath?.();console.log(JSON.stringify({id:f.id,check:'passed'}));continue;}
  const first=[];
  for(let i=0;i<runs;i++){
    const s=f.setup();const t=performance.now();const r=s.run();first.push(performance.now()-t);s.check(r);
  }
  const s=f.setup();for(let i=0;i<5;i++)s.check(s.run());
  const warm=[];
  for(let i=0;i<runs;i++){
    let r;const t=performance.now();for(let j=0;j<iterations;j++)r=s.run();warm.push((performance.now()-t)/iterations);s.check(r);
  }
  console.log(JSON.stringify({id:f.id,config:f.config,warmMeaning:s.warmMeaning ?? 'repeated question on the same expression',first:summary(first),warm:summary(warm)}));
}
