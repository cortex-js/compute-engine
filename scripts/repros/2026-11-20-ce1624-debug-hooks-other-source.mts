// CE-1624: the debug hooks of `executeEpsilAsync()` are called for the
// statements of a function that an EARLIER run defined, with `range` offsets
// in the source of that earlier run. `EpsilDebugStatement.range` is
// documented as offsets in the source of the run that has the hooks, and
// the statement carries nothing that names its source.
//
// Run: npx tsx scripts/repros/2026-11-20-ce1624-debug-hooks-other-source.mts
//
// Part 1 prints each `beforeStatement` call of a run whose source is
// `f(1000)`, with the text that `range` selects in the source of the run
// and in the source of the earlier run.
// Part 2 (the answer to a question of Tycho, not a defect) pauses a run in
// the body of `cb`, starts from a timer a second application of the same
// function value with `evaluateAsync()`, and prints the order of the events:
// the second application ends after the pause (`asyncInFlight`,
// `src/compute-engine/function-utils.ts`).
//
// Output at af8263034fb9f22add3c3621ab48458acac2dec6 (2026-11-20):
//   Part 1: debug run of "f(1000)"
//     range [0,7] callDepth 0 | in the run's source: "f(1000)" | in the earlier source: "let a ="
//     range [44,53] callDepth 1 | in the run's source: "" | in the earlier source: "a = a + t"
//   Part 2: a second application of `cb` during a pause
//     pause starts
//     Add(1, 2) ends
//     pause ends
//     second application of cb ends
// (The last statement of `f`, `b = b + 1`, calls no hook: CE-1625.)
import { ComputeEngine } from '../../src/compute-engine';
import {
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

const earlier = `let a = 0
let b = 0
function f(t) scope {
  a = a + t
  b = b + 1
}
let cb = t => do { a = a + t; b = b + 1 }`;
const first = executeEpsil(ce, earlier);
for (const d of first.diagnostics) console.log('  ', JSON.stringify(d));

// Part 1
const wrapper = 'f(1000)';
console.log(`Part 1: debug run of "${wrapper}"`);
await executeEpsilAsync(ce, wrapper, {
  debug: {
    beforeStatement: (at) => {
      const [s, e] = at.range;
      console.log(
        `  range [${s},${e}] callDepth ${at.callDepth}`,
        `| in the run's source: ${JSON.stringify(wrapper.slice(s, e))}`,
        `| in the earlier source: ${JSON.stringify(earlier.slice(s, e))}`
      );
    },
  },
});

// Part 2
console.log('Part 2: a second application of `cb` during a pause');
const cb = ce.expr('cb').evaluate();
const events: string[] = [];
let second: Promise<unknown> | undefined;
let other: Promise<unknown> | undefined;
let paused = false;
await executeEpsilAsync(ce, 'cb(1)', {
  debug: {
    beforeStatement: async (at) => {
      if (at.callDepth !== 1 || paused) return;
      paused = true;
      events.push('pause starts');
      // The host starts the other evaluations from a timer, as a notebook
      // does: not inside the hook, where the evaluation contexts are those
      // of the paused statement.
      await new Promise<void>((done) =>
        setTimeout(() => {
          second = ce
            .function('Apply', [cb, ce.number(9)])
            .evaluateAsync()
            .then(() => events.push('second application of cb ends'));
          other = ce
            .function('Add', [ce.number(1), ce.number(2)])
            .evaluateAsync()
            .then(() => events.push('Add(1, 2) ends'));
          done();
        }, 20)
      );
      await new Promise((resume) => setTimeout(resume, 200));
      events.push('pause ends');
    },
  },
});
await second;
await other;
for (const e of events) console.log('  ' + e);
