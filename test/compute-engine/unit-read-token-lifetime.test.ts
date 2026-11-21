import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// A dependency on a read of a unit environment holds its token strongly
// (`DepRef`, `object-deps.ts`). The token keeps its environment and its key,
// and the key can be a value definition: the values of a scope that is popped
// must still be collected. A `WeakRef` per token kept every expression that a
// synchronous computation boxed until the computation returned.

// `--expose-gc` set at run time gives a real collector to a fresh context,
// so the test needs no flag on the command line.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** Yield to the event loop, then collect, `times` times. */
async function collect(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
  // The callbacks of a `FinalizationRegistry` run in a later task.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

const RUNS = 20;

// Each scenario reads `o`, a value of the popped scope, through a route that
// fills a cache: an expression of the scope, a call of a global function, a
// derivative, an integral, a function literal, and a global expression that
// is read in the scope.
const SCENARIOS: [string, (ce: ComputeEngine) => void][] = [
  [
    'an expression of the scope',
    (ce) => {
      const e = ce.box(['Add', ['Multiply', 'o', 'x'], 1]);
      void e.type;
      e.evaluate();
      e.N();
      e.simplify();
    },
  ],
  [
    'a call of a global function',
    (ce) => {
      ce.box(['Add', ['g', 'o'], ['h', 'o']]).evaluate();
    },
  ],
  [
    'a derivative',
    (ce) => {
      ce.box(['D', ['g', ['Multiply', 'o', 'x']], 'x']).evaluate();
    },
  ],
  [
    'an integral',
    (ce) => {
      ce.box(['Integrate', ['Multiply', 'o', ['Cos', 'x']], 'x']).evaluate();
    },
  ],
  [
    'a function literal',
    (ce) => {
      const f = ce.box(['Function', ['Add', ['Multiply', 'o', 'y'], 1], 'y']);
      void f.type;
      ce.box([f.json, 3] as MathJsonExpression).evaluate();
    },
  ],
];

describe('THE LIFETIME OF A READ OF A UNIT ENVIRONMENT', () => {
  test.each(SCENARIOS)(
    'the value of a popped scope is collected after %s',
    async (_name, scenario) => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.assign('g', ce.box(['Function', ['Add', ['Multiply', 2, 't'], 1], 't']));
      ce.declare('h', '(real) -> real');
      let collected = 0;
      const registry = new FinalizationRegistry(() => {
        collected += 1;
      });
      for (let i = 0; i < RUNS; i++) {
        ce.pushScope();
        ce.assign('o', ce.box(['Rational', 3 + i, 7]));
        registry.register(ce.box('o').value!, i);
        scenario(ce);
        ce.popScope();
      }
      await collect();
      // A cache can keep the last values it read: the values of the earlier
      // runs are collected.
      expect(collected).toBeGreaterThanOrEqual(RUNS - 3);
    }
  );

  test('boxing function literals in one job does not keep them', () => {
    const ce = new ComputeEngine();
    const literal: MathJsonExpression = [
      'Function',
      ['Add', ['Power', 'x', 2], 1],
      'x',
    ];
    for (let i = 0; i < 200; i++) ce.box(literal);
    gc();
    const before = process.memoryUsage().heapUsed;
    // In the same job: a collection here frees only what no `WeakRef` that
    // the job made or dereferenced keeps.
    for (let i = 0; i < 5000; i++) ce.box(literal);
    gc();
    const kept = process.memoryUsage().heapUsed - before;
    // About 7 KB per literal when every token had a `WeakRef`: 35 MB.
    expect(kept).toBeLessThan(10_000_000);
  });
});
