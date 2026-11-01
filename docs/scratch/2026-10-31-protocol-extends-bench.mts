// Benchmark of protocol extension (CE-713), the cost target of
// `docs/plans/2026-10-31-protocol-refinement.md` §5.
//
// Usage, from the repository root:
//   npx tsx docs/scratch/2026-10-31-protocol-extends-bench.mts
//
// Each case runs 7 times, each time on a new engine, and prints the median
// time of the timed step in microseconds. The protocols and the type are
// declared before the timer starts; only the implementation calls are timed.
//
//   (A) a chain of 9 protocols of depth 8 (P0, P1 extends P0, …, P8 extends
//       P7), one function member each, then ONE
//       declareProtocolImplementation("Money", "P8", { all 9 members });
//   (B) 9 independent protocols with the same members, and 9 separate
//       declareProtocolImplementation calls (the hand-written form);
//   (C) ONE independent protocol with 9 members, and one call.
//
// The target is A <= 2 x C. After (A), it also times
// ce.conformsTo("Money", "P0") and ce.conformsTo("Money", "P8"), which must
// both stay a direct lookup of the edges of one protocol.
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { executeEpsil } from '../../src/epsil/execute-epsil.ts';

const N = 9;
const RUNS = 7;
const SIG = '(self: Self) -> integer';
const impl = () => 0;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function freshEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  executeEpsil(ce, 'type Money = tuple<cents: integer>');
  return ce;
}

function allMembers(): Record<string, () => number> {
  const functions: Record<string, () => number> = {};
  for (let k = 0; k < N; k++) functions[`m${k}`] = impl;
  return functions;
}

function caseA(): { declare: number; conformsP0: number; conformsP8: number } {
  const ce = freshEngine();
  for (let k = 0; k < N; k++)
    ce.declareProtocol(
      `P${k}`,
      { functions: { [`m${k}`]: SIG } },
      k === 0 ? undefined : { extends: [`P${k - 1}`] }
    );
  const t0 = performance.now();
  ce.declareProtocolImplementation('Money', `P${N - 1}`, {
    functions: allMembers(),
  });
  const declare = (performance.now() - t0) * 1000;
  if (!ce.conformsTo('Money', 'P0')) throw new Error('A: Money is not P0');

  // `conformsTo` is too fast to time one call: time a loop and divide.
  const LOOP = 10_000;
  const time = (p: string) => {
    const t = performance.now();
    for (let i = 0; i < LOOP; i++) ce.conformsTo('Money', p);
    return ((performance.now() - t) * 1000) / LOOP;
  };
  time('P0');
  time('P8');
  return { declare, conformsP0: time('P0'), conformsP8: time('P8') };
}

function caseB(): number {
  const ce = freshEngine();
  for (let k = 0; k < N; k++)
    ce.declareProtocol(`Q${k}`, { functions: { [`m${k}`]: SIG } });
  const t0 = performance.now();
  for (let k = 0; k < N; k++)
    ce.declareProtocolImplementation('Money', `Q${k}`, {
      functions: { [`m${k}`]: impl },
    });
  return (performance.now() - t0) * 1000;
}

function caseC(): number {
  const ce = freshEngine();
  const functions: Record<string, string> = {};
  for (let k = 0; k < N; k++) functions[`m${k}`] = SIG;
  ce.declareProtocol('R', { functions });
  const t0 = performance.now();
  ce.declareProtocolImplementation('Money', 'R', { functions: allMembers() });
  return (performance.now() - t0) * 1000;
}

// One run of each case first, untimed, so that the first timed run does not
// pay for module loading and JIT compilation.
caseA();
caseB();
caseC();

const a: number[] = [];
const p0: number[] = [];
const p8: number[] = [];
const b: number[] = [];
const c: number[] = [];
for (let i = 0; i < RUNS; i++) {
  const r = caseA();
  a.push(r.declare);
  p0.push(r.conformsP0);
  p8.push(r.conformsP8);
  b.push(caseB());
  c.push(caseC());
}

const fmt = (x: number) => x.toFixed(1);
console.log(`(A) chain of depth 8, one call:      ${fmt(median(a))} µs`);
console.log(`(B) 9 protocols, 9 calls:            ${fmt(median(b))} µs`);
console.log(`(C) one protocol of 9 members:       ${fmt(median(c))} µs`);
console.log(`A / C = ${(median(a) / median(c)).toFixed(2)} (target <= 2)`);
console.log(
  `conformsTo after (A): P0 ${median(p0).toFixed(3)} µs, P8 ${median(p8).toFixed(3)} µs`
);
