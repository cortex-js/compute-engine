import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkContract, baselineContract, setupWorkload } from './adapter.mjs';
import { summarize, assertTimingConfig } from './manifest.mjs';
import { validateFixtures, selectedWorkloads, orderForRound, summaryFor } from '../stable-batch.mjs';

// These controls exercise the instrument, without loading CE or measuring it.
test('complete fixture matrix remains unsupported on baseline adapters', async () => {
  assert.equal(validateFixtures().fixtures, 22);
  const fixture = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url))).fixtures[0];
  assert.equal((await checkContract(baselineContract, fixture)).status, 'unsupported');
  await assert.rejects(checkContract(async () => ({ status:'ready', steps:{}, invariants:{} }), fixture));
});

test('serial schedule reverses arms and rejects unknown/empty selectors', () => {
  const arms = [{name:'A'},{name:'B'}];
  assert.deepEqual([0,1,2,3].map((round) => orderForRound(arms,round).map((a) => a.name).join('')), ['AB','BA','AB','BA']);
  assert.deepEqual(arms.map((a) => a.name), ['A','B']);
  assert.throws(() => selectedWorkloads([]));
  assert.throws(() => selectedWorkloads(['absent']));
});

test('ratios use medians and both references; invalid samples prevent ratios', () => {
  assert.equal(summarize([9,1,5,3]).median,4);
  const config = {arms:[{name:'A'},{name:'B'}]};
  const sample = (arm,n,valid=true) => ({arm,workload:'w',status:'ready',valid,timing:{firstOperationMs:n,operationMsPerCall:n,assignmentMsPerCall:0,totalMsPerCall:n}});
  const summary = summaryFor([sample('A',1),sample('A',3),sample('B',4),sample('B',8)],config);
  assert.equal(summary.groups.w.ratios.A.B.operationMsPerCall,3);
  assert.equal(summary.groups.w.ratios.B.A.operationMsPerCall,1/3);
  assert.deepEqual(summaryFor([sample('A',1),sample('B',2,false)],config).groups.w.ratios,{});
});

test('diagnostic builds cannot masquerade as production timing', () => {
  const config={arms:[{build:{kind:'diagnostic-production-split'}},{build:{kind:'diagnostic-production-split'}}]};
  assert.throws(() => assertTimingConfig(config,'time'));
});

test('full edit release drops adapter roots before collection', () => {
  const engine = () => {
    const e={declare(){},assign(){},box(value){return {value,evaluate(){return this;}};}};
    return e;
  };
  const work=setupWorkload(engine,{id:'doc',kind:'document',phase:'box'},{boxApi:'box',documentSize:2});
  const unit=work.prepare();
  assert.equal(unit.entries.length,2);
  work.initialize();
  assert(work.execute());
  work.release();
  assert.throws(() => work.execute(), TypeError);
});
