import assert from 'node:assert/strict';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installGroupTheory } from '../../src/compute-engine/library/group-theory';
import type { MathJsonExpression as MJ } from '../../src/math-json/types';

if (!isMainThread) {
  const ce = new ComputeEngine();
  installGroupTheory(ce);
  const result = ce.box(workerData as MJ).evaluate();
  parentPort!.postMessage(result.json);
} else {
  const ce = new ComputeEngine();
  installGroupTheory(ce);
  const result = executeEpsil(
    ce,
    'let G=PermutationGroup([Permutation([2,1]),Permutation([2,3,1])],PermutationAction(3))\n(GroupOrder(G,1,50000000),GroupPcRelativeOrders(GroupPcgs(G,256,50000000),50000000))'
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.value.json, ['Tuple', 6, ['List', 2, 3]]);
  const query: MJ = [
    'GroupOrder',
    [
      'PermutationGroup',
      [
        'List',
        ['Permutation', ['List', 2, 1]],
        [
          'Permutation',
          ['List', ...Array.from({ length: 20 }, (_, i) => ((i + 1) % 20) + 1)],
        ],
      ],
      ['PermutationAction', 20],
    ],
    1,
    50000000,
  ];
  const expected = ce.number(2432902008176640000n).json;
  assert.deepEqual(ce.box(query).evaluate().json, expected);
  const response = await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: structuredClone(query),
    });
    let received = false,
      answer: unknown;
    worker.on('message', (x) => {
      received = true;
      answer = x;
    });
    worker.on('error', reject);
    worker.on('exit', (code) =>
      code === 0 && received
        ? resolve(answer)
        : reject(new Error('Worker exited without a result: ' + code))
    );
  });
  assert.deepEqual(response, expected);
  console.log(
    JSON.stringify({
      node: process.version,
      checks: [
        'minified ESM Epsil evaluation',
        'exact MathJSON result',
        'fresh worker structured-clone transport',
      ],
      passed: true,
    })
  );
}
