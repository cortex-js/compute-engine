/**
 * Tycho document open, part 2: the cost of canonical `ce.rebind()` on rows,
 * and how much of it repeats work on a structurally equal tree.
 *
 * When Tycho opens the Desmos art document `2ki2hjsouf`, its row
 * classification calls `ce.rebind(expr, { scope })` 2,145 times
 * (`ClassificationSession.rebindCanonical` in Tycho's
 * `src/plot-core/classification-session.ts`), on 881 distinct trees. Each
 * call passes the scope of one row classification: a new child scope of the
 * document scope, usually with no bindings of its own. Every row is
 * classified twice (registration, then series inference), so most trees are
 * rebound once per classification, each time in a different scope object.
 *
 * The fixture `2ki2hjsouf.fixture.json.gz` holds (written by a capture run
 * of the Tycho pipeline in Node with CE 0.170.0):
 * - `docDefs`: the document scope after registration (name, declared type,
 *   value as MathJSON). This script declares them in a scope of a fresh
 *   engine, so that `S_orry(u)`, `R_3(...)` and the other document functions
 *   resolve as they do in Tycho.
 * - `rebind`: the calls in order: the input tree (`j`, an index into
 *   `trees`), its form, the requested form and the Tycho scope id. Calls with
 *   the same scope id share one scope here too; scope id -1 means no scope
 *   option. A scope that held parameter names when the capture first saw it
 *   declares them `real` here.
 *
 * Only the canonical calls are timed (the raw and structural ones cost
 * 4 ms in total). Each run replays them in order, boxing the input
 * structurally first (not timed). The script then reports:
 * - the replay time (median and range of RUNS runs, after one warm-up),
 * - the time of the calls that repeat a (tree, scope) pair seen before in the
 *   run, and of the calls that repeat a tree seen before in ANY scope: the
 *   upper limits of a cache keyed on the tree and the scope object, and of a
 *   cache keyed on the tree and the bindings visible from the scope,
 * - the ten trees with the largest total time.
 *
 *   npx tsx benchmarks/tycho-document-open/rebind.ts            # RUNS=5
 *   COLD=1 RUNS=1 npx tsx benchmarks/tycho-document-open/rebind.ts  # first run only
 */

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadavg } from 'node:os';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const RUNS = Number(process.env.RUNS ?? 5);

type Fixture = {
  engine: { angularUnit: 'deg' | 'rad' };
  docDefs: {
    name: string;
    type?: string;
    value?: MathJsonExpression | null;
    operator?: string;
  }[];
  rebind: {
    phase: string;
    form: 'canonical' | 'structural' | 'raw';
    inputForm: 'canonical' | 'structural' | 'raw';
    scope: number;
    tychoMs: number;
    j: number;
  }[];
  trees: MathJsonExpression[];
  scopes: { id: number; names: string[] }[];
};
const fixture: Fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      process.env.FIXTURE ??
        new URL('./2ki2hjsouf.fixture.json.gz', import.meta.url)
    )
  ).toString()
);
type Scope = NonNullable<Parameters<ComputeEngine['rebind']>[1]>['scope'];

const ce = new ComputeEngine();
ce.precision = 'machine';
ce.angularUnit = fixture.engine.angularUnit;

// The document scope. The values come first: a function body reads them
// (`S_orry` reads `P_1` to `P_11`), and a body that reads an undeclared name
// is refused. A function literal is assigned without a declaration, because
// the declared type `function` refuses some of them.
ce.pushScope();
let declineCount = 0;
const isFunctionLiteral = (def: Fixture['docDefs'][number]) =>
  Array.isArray(def.value) && def.value[0] === 'Function';
for (const def of [
  ...fixture.docDefs.filter((d) => !isFunctionLiteral(d)),
  ...fixture.docDefs.filter(isFunctionLiteral),
]) {
  try {
    if (def.operator !== undefined) {
      ce.declare(def.name, { signature: def.operator });
      continue;
    }
    if (isFunctionLiteral(def)) {
      ce.assign(def.name, ce.box(def.value!));
      continue;
    }
    ce.declare(def.name, def.type ?? 'unknown');
    if (def.value !== null && def.value !== undefined)
      ce.assign(def.name, ce.box(def.value));
  } catch {
    declineCount++;
    try {
      ce.declare(def.name, 'unknown');
    } catch {}
  }
}
const docScope = ce.context.lexicalScope as Scope;

// One child scope per Tycho scope id, created on first use.
const scopeNames = new Map<number, string[]>();
for (const s of fixture.scopes) scopeNames.set(s.id, s.names);
function makeScope(id: number): Scope {
  if (id < 0) return undefined;
  ce.pushScope();
  for (const name of scopeNames.get(id) ?? []) ce.declare(name, 'real');
  const scope = ce.context.lexicalScope as Scope;
  ce.popScope();
  return scope;
}

const calls = fixture.rebind.filter((r) => r.form === 'canonical');

function runOnce() {
  const scopes = new Map<number, Scope>();
  const times: number[] = [];
  for (const r of calls) {
    let scope = scopes.get(r.scope);
    if (!scopes.has(r.scope)) {
      scope = makeScope(r.scope);
      scopes.set(r.scope, scope);
    }
    const input: Expression = ce.expr(fixture.trees[r.j], {
      form: r.inputForm,
      scope: scope ?? docScope,
    });
    const t = performance.now();
    ce.rebind(input, { scope });
    times.push(performance.now() - t);
  }
  return times;
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

console.log(
  `load average before: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`
);
console.log(
  `document scope: ${fixture.docDefs.length} names (${declineCount} declared as unknown after a failure)`
);
// COLD=1 skips the warm-up, so a single run (RUNS=1) is the first replay in
// a fresh engine, as in Tycho, where no memo survives from an earlier run.
if (process.env.COLD !== '1') runOnce(); // warm-up
const runs: number[][] = [];
for (let r = 0; r < RUNS; r++) runs.push(runOnce());

// Per-call median over the runs.
const perCall = calls.map((_, k) => median(runs.map((r) => r[k])));
const totals = runs.map(sum);
const seenPair = new Set<string>();
const seenTree = new Set<number>();
let repeatPair = 0;
let repeatPairMs = 0;
let repeatTree = 0;
let repeatTreeMs = 0;
calls.forEach((r, k) => {
  const pair = `${r.j}|${r.scope}`;
  if (seenPair.has(pair)) {
    repeatPair++;
    repeatPairMs += perCall[k];
  }
  if (seenTree.has(r.j)) {
    repeatTree++;
    repeatTreeMs += perCall[k];
  }
  seenPair.add(pair);
  seenTree.add(r.j);
});

console.log(
  `canonical rebind calls: ${calls.length}, distinct trees ${seenTree.size}, distinct (tree, scope) pairs ${seenPair.size}`
);
console.log(
  `replay: median ${median(totals).toFixed(0)} ms (${Math.min(...totals).toFixed(0)}-${Math.max(...totals).toFixed(0)}) over ${RUNS} runs; Tycho capture ${sum(calls.map((c) => c.tychoMs)).toFixed(0)} ms`
);
console.log(
  `calls that repeat a (tree, scope) pair: ${repeatPair}, ${repeatPairMs.toFixed(0)} ms`
);
console.log(
  `calls that repeat a tree in any scope:  ${repeatTree}, ${repeatTreeMs.toFixed(0)} ms`
);

const byTree = new Map<number, { n: number; ms: number }>();
calls.forEach((r, k) => {
  const e = byTree.get(r.j) ?? { n: 0, ms: 0 };
  e.n++;
  e.ms += perCall[k];
  byTree.set(r.j, e);
});
console.log('largest trees by total time (calls, ms, ms per call, bytes):');
for (const [j, e] of [...byTree].sort((a, b) => b[1].ms - a[1].ms).slice(0, 10)) {
  const text = JSON.stringify(fixture.trees[j]);
  console.log(
    `  ${String(e.n).padStart(3)} ${e.ms.toFixed(1).padStart(7)} ${(e.ms / e.n).toFixed(1).padStart(6)} ${String(text.length).padStart(6)}  ${text.slice(0, 90)}`
  );
}
console.log(
  `load average after: ${loadavg().map((x) => x.toFixed(2)).join(' ')}`
);
