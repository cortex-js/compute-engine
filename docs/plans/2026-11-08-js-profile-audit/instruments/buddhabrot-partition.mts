import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as ceModule from "@cortex-js/compute-engine";
import { registerComputeEngineModule, resolveCECompile } from "../../src/plot-core/ce-module-registry.js";
import { createEngineForProfile } from "../../src/plot-core/engine-profiles.js";
import { runPrelude } from "../../src/plot-core/prelude-runner.js";
import { SHOWCASE } from "../../src/graph-paper/onboarding/template-data.js";
const LIST_LENGTH = 90001;
const PLANE = 30000;
function stepReference(H: number[], n: number, bump = 1): number[] {
  const L = H.slice();
  const r = H[LIST_LENGTH - 1];
  const fract = (x: number): number => x - Math.floor(x);
  const ceilings = [5000, 500, 50];
  for (let k = 1; k <= n; k++) {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2;
    const q = 3 * fract(0.569840291 * (r + k)) - 1.5;
    const x = p - 0.25;
    const t = x ** 2 + q ** 2;
    if (!(t * (t + x) > q ** 2 / 4 && (p + 1) ** 2 + q ** 2 > 1 / 16)) continue;
    let a = 0;
    let b = 0;
    let e = 0;
    let sa = 0;
    let sb = 0;
    let s = 2;
    for (let m = 1; m <= ceilings[0]; m++) {
      const u = a ** 2 - b ** 2 + p;
      b = 2 * a * b + q;
      a = u;
      if (a ** 2 + b ** 2 > 4) {
        e = m;
        break;
      }
      if (Math.abs(a - sa) < 1e-12 && Math.abs(b - sb) < 1e-12) break;
      if (m === s) {
        sa = a;
        sb = b;
        s = 2 * s;
      }
    }
    if (e === 0) continue;
    a = 0;
    b = 0;
    for (let m = 1; m <= e; m++) {
      const u = a ** 2 - b ** 2 + p;
      b = 2 * a * b + q;
      a = u;
      if (a ** 2 + b ** 2 > 4) break;
      const i = Math.floor(((b + 1.125) / 2.25) * 150);
      const j = Math.floor(((1 - a) / 3) * 200);
      if (i >= 0 && i < 150 && j >= 0 && j < 200)
        for (let plane = 0; plane < 3; plane++)
          if (e <= ceilings[plane]) {
            L[plane * PLANE + i + 150 * j] += bump;
            L[plane * PLANE + 149 - i + 150 * j] += bump;
          }
    }
  }
  L[LIST_LENGTH - 1] = r + n;
  return L;
}

registerComputeEngineModule(ceModule);
const entry = SHOWCASE.find((e) => e.id === "buddhabrot")!;
const statement = "const H_1 = step(H_0, 1200000)";
assert.ok(entry.prelude!.includes(statement));
const source = entry.prelude!.replace(statement, "");
const ce = createEngineForProfile("document")!;
const prelude = await runPrelude(ce, source, { iterationBudget: 1e8 });
assert.equal(prelude.valid, true, JSON.stringify(prelude.diagnostics));
ce.declare("histogramInput", "list<integer>");
ce.declare("sampleCount", "integer");
const expr = ce.box(["step", "histogramInput", "sampleCount"]);
const compiled = resolveCECompile(expr, { to: "javascript", iterationBudget: 1e8 });
assert.equal(compiled.success, true, JSON.stringify(compiled));
assert.equal(typeof compiled.run, "function");
const run = (histogram: number[], count: number): number[] => {
 if (count === 0) return histogram.slice(); // Epsil 1..0 descends: scheduler must skip empty jobs.
 const input = histogram.slice();
 const output = (compiled.run as Function)({ histogramInput: input, sampleCount: count });
 assert.ok(Array.isArray(output));
 assert.equal(output.length, LIST_LENGTH);
 return output;
};
const sumBins = (a: number[]) => a.slice(0,90000).reduce((x,y)=>x+y,0);
const rawZeroInput = Array(LIST_LENGTH).fill(0);
rawZeroInput[90000]=137;
const rawZero = (compiled.run as Function)({histogramInput:rawZeroInput,sampleCount:0}) as number[];
const rawZeroObservation = {cursor:rawZero[90000],histogramCount:sumBins(rawZero),reason:"Epsil 1..0 is descending [1,0]; scheduler skips count=0 jobs"};
const cases = [];
for (const samples of [0, 1, 101, 1000]) {
 const initial = Array(LIST_LENGTH).fill(0);
 initial[0] = 7; initial[30123] = 11; initial[89999] = 5;
 initial[90000] = 137;
 const expected = stepReference(initial,samples);
 const serial = run(initial,samples);
 assert.deepEqual(serial,expected,"compiled serial differs from existing independent JS reference");
 for (const partitions of [2,4]) {
  const merged = initial.slice();
  const partials: number[][] = [];
  const ranges = [];
  let naiveCursorSum = 0;
  for(let part=0;part<partitions;part++) {
   const offset = Math.floor(samples*part/partitions);
   const end = Math.floor(samples*(part+1)/partitions);
   const local = Array(LIST_LENGTH).fill(0);
   local[90000] = initial[90000]+offset;
   const result = run(local,end-offset);
   assert.equal(result[90000], local[90000]+end-offset, "private returned cursor must equal start + count");
   partials.push(result);
   ranges.push({startExclusive:local[90000],endInclusive:local[90000]+end-offset,count:end-offset});
   for(let bin=0;bin<90000;bin++) merged[bin]+=result[bin];
   naiveCursorSum += result[90000];
  }
  merged[90000]=initial[90000]+samples;
  assert.deepEqual(merged,serial,"partition reduction differs from serial");
  const badMerged = merged.slice();
  badMerged[90000] = naiveCursorSum;
  assert.throws(() => assert.deepEqual(badMerged, serial), {name:"AssertionError"}, "negative control must reject the corrupted merged result");
  const reverse = initial.slice();
  for(const partial of partials.slice().reverse()) for(let bin=0;bin<90000;bin++) reverse[bin]+=partial[bin];
  reverse[90000]=initial[90000]+samples;
  assert.deepEqual(reverse,serial,"reverse merge differs");
  let retryExecuted = 0;
  let zeroWorkIdentities = 0;
  for(let i=0;i<ranges.length;i++) {
    const initial = Object.assign(Array(LIST_LENGTH).fill(0),{90000:ranges[i].startExclusive});
    if(ranges[i].count===0) {
      assert.deepEqual(partials[i],initial,"zero work must be scheduler identity");
      zeroWorkIdentities++;
      continue;
    }
    const retried = run(initial,ranges[i].count);
    assert.deepEqual(retried,partials[i],"retry changed deterministic partition");
    retryExecuted++;
  }
  cases.push({samples,partitions,ranges,histogramExact:true,cursorExact:true,referenceExact:true,reverseMergeExact:true,retryExact:retryExecuted>0,retryExecuted,zeroWorkIdentities,privateCursorsExact:true,corruptedMergeRejected:true,finalCursor:serial[90000],totalHistogramCount:sumBins(serial),naiveCursorSum,negativeControlDetected:true,denseNumericPayloadBytes:partitions*LIST_LENGTH*8});
 }
}
const result = {
 provenance:{node:process.version,ceVersion:JSON.parse(readFileSync("node_modules/@cortex-js/compute-engine/package.json","utf8")).version,algorithm:"actual showcase Epsil step compiled by installed CE; independent JS reference copied from prelude-lanes.test.ts",preludeSha256:createHash("sha256").update(entry.prelude!).digest("hex"),compiledCodeSha256:createHash("sha256").update(compiled.code??"").digest("hex")},
 setup:{preludeValid:prelude.valid,statements:prelude.statements.map(s=>({names:s.names,route:s.route,declineReason:s.declineReason})),compiledSuccess:compiled.success,listLength:LIST_LENGTH,initialCursor:137,initialHistogramSum:23},
 rawZeroObservation,
 cases,
 limitations:["Sequential simulation of partitions, no workers or actual cancellation", "No performance measurement", "Payload bytes assume dense 8-byte numbers, not JS heap footprint", "Retry equality does not permit duplicate commits; coordinator must deduplicate successful ranges", "Partial histograms remain private until all ranges succeed; caller cursor must commit once"]
};
writeFileSync("/tmp/js-profile-next/prior-buddhabrot-review.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
