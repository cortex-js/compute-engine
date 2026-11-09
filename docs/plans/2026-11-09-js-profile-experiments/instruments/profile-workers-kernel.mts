import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as ceModule from "@cortex-js/compute-engine";
import { registerComputeEngineModule, resolveCECompile } from "../../src/plot-core/ce-module-registry.js";
import { createEngineForProfile } from "../../src/plot-core/engine-profiles.js";
import { runPrelude } from "../../src/plot-core/prelude-runner.js";
import { SHOWCASE } from "../../src/graph-paper/onboarding/template-data.js";
export const LIST_LENGTH = 90001;
const PLANE = 30000;
export function stepReference(H: number[], n: number, bump = 1): number[] {
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

export async function buildKernel() {
  const started = performance.now();
  registerComputeEngineModule(ceModule);
  const entry = SHOWCASE.find((e) => e.id === "buddhabrot")!;
  const statement = "const H_1 = step(H_0, 1200000)";
  assert.ok(entry.prelude!.includes(statement));
  const ce = createEngineForProfile("document")!;
  const prelude = await runPrelude(ce, entry.prelude!.replace(statement, ""), { iterationBudget: 1e8 });
  assert.equal(prelude.valid, true, JSON.stringify(prelude.diagnostics));
  ce.declare("histogramInput", "list<integer>");
  ce.declare("sampleCount", "integer");
  const compiled = resolveCECompile(ce.box(["step", "histogramInput", "sampleCount"]), { to: "javascript", iterationBudget: Infinity });
  assert.equal(compiled.success, true);
  assert.equal(typeof compiled.run, "function");
  const stored = Object.fromEntries(["code","preamble","preambleOnce","preamblePerCall","callCode","calling","reconstructionDigits","entryPlan","mode","broadcastOutputs","batch","runtimeVersion","valueKinds","shippable"].filter(key => (compiled as any)[key] !== undefined).map(key => [key,(compiled as any)[key]]));
  return {
    stored,
    artifactHash: createHash("sha256").update(JSON.stringify(stored)).digest("hex"),
    setupMs: performance.now() - started,
    codeHash: createHash("sha256").update(compiled.code ?? "").digest("hex"),
    preludeHash: createHash("sha256").update(entry.prelude!).digest("hex"),
    run(histogram: number[], count: number): number[] {
      if (count === 0) return histogram.slice();
      return (compiled.run as Function)({ histogramInput: histogram, sampleCount: count }) as number[];
    },
  };
}
