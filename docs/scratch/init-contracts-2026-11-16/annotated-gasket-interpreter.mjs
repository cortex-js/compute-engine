// One full interpreted fixture; the coordinator enforces the same wall cap per arm.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]);
const fixture = resolve(process.argv[3]);
const { ComputeEngine } = await import(pathToFileURL(resolve(root, 'src/compute-engine.ts')));
const { executeEpsil } = await import(pathToFileURL(resolve(root, 'src/epsil.ts')));
const original = readFileSync(fixture, 'utf8');
const source = original.replace('function seen(acc, c)',
  'function seen(acc: list<tuple<number, number, number, number>>, c)');
if (source === original) throw new Error('Expected exactly the existing seen annotation migration');
const ce = new ComputeEngine({precision:21});
const began = performance.now();
const result = executeEpsil(ce, source);
const value = result.value.json;
const oracle = ['Tuple',224,['List',4,6,18,54,86,28,8,8,4,4,4,0]];
const matchesOracle = JSON.stringify(value) === JSON.stringify(oracle);
console.log(JSON.stringify({root,fixture,sourceSha256:createHash('sha256').update(source).digest('hex'),
  precision:21,route:'executeEpsil-interpreter',executionMs:performance.now()-began,value,
  diagnostics:result.diagnostics,matchesOracle}));
if (!matchesOracle || result.diagnostics.length !== 0) process.exitCode=1;
