/**
 * CE-1709: a recursive function row of a prepared Document
 * whose body is pure gets the effects `any` when the row states none
 * (`(unknown) any -> number`). The engine keeps no result of an application
 * with those effects, so a body that calls itself twice is evaluated once
 * per path: 2^n evaluations at depth n. The same function literal assigned
 * on an engine scope has no effect label, and its applications are
 * memoized.
 *
 * Run: npx tsx scripts/repros/2026-11-22-ce1709-recursive-row-effects-any.mts [depth]
 *
 * The function is `F(n) = Which(n = 0, 1, True, F(n-1) + F(n-1))`, read at
 * depth 14 by default (the value is 2^14 = 16384).
 *
 * Cases, each on a new engine, the median of three runs of the first
 * evaluation of `F(depth)`:
 *  - "assigned" (control): `ce.declare("F", "function")`, then
 *    `ce.assign("F", Function(body, n))`.
 *  - "row": the same function as a function row of a prepared Document, with
 *    no stated effect.
 *  - "row, effects pure" (the host's workaround): the row states
 *    `effects: "pure"`.
 *
 * Why Tycho measures it: Desmos documents define recursions over points and
 * lists that call themselves several times (`P(i) = (P(i-1).x + P(i-1).y,
 * P(i-1).x - P(i-1).y)` of `neyret/zibjmkv9h9`, four calls at each level).
 * Before the Document port the row `polygon(P(0), …, P(7))` evaluated in
 * 7 ms; with the row's effects `any` it takes 677 ms, and
 * `neyret/hchhnxqqqc` passes its 10 s limit. The host now states
 * `effects: "pure"` on a self-recursive row (`pureRows` in
 * `src/graph-paper/graph/document-ce-manager.ts`) and prepares the rows
 * again without it when CE refuses the statement (a body that draws a
 * random number). It does not find a mutual recursion.
 *
 * READY when "row" takes at most twice the time of "assigned", with the
 * same value.
 */
import {
  ComputeEngine,
  createDocumentEnvironment,
  version,
} from '../../src/compute-engine';

const depth = Number(process.argv[2] ?? 14);
const body = [
  'Which',
  ['Equal', 'n', 0],
  1,
  'True',
  ['Add', ['F', ['Subtract', 'n', 1]], ['F', ['Subtract', 'n', 1]]],
];

type Sample = { ms: number; value: string; type: string };

function evaluateF(ce: any, type: string): Sample {
  const expr = ce.box(['F', depth]);
  const start = performance.now();
  const value = expr.evaluate();
  return {
    ms: performance.now() - start,
    value: JSON.stringify(value.json),
    type,
  };
}

function assigned(): Sample {
  const ce = new ComputeEngine() as any;
  ce.declare('F', 'function');
  ce.assign('F', ce.box(['Function', body, 'n']));
  return evaluateF(ce, String(ce.lookupDefinition('F')?.value?.value?.type));
}

function documentRow(effects: 'pure' | undefined): Sample {
  const ce = new ComputeEngine() as any;
  const env = (createDocumentEnvironment as any)(ce, () => {});
  const imports = env.createImports(() => {});
  const rev = imports.prepare(
    [{ id: 'F', latex: 'F', ...(effects === undefined ? {} : { effects }) }],
    {
      split: (source: string) => ({ head: source, body: '' }),
      recognize: () => ({
        role: 'function',
        head: { name: 'F', params: ['n'] },
        bodyJson: body,
      }),
      normalize: (raw: unknown) => raw,
      lowerBody: (raw: unknown) => raw,
      fieldAxes: new Set<string>(),
    }
  );
  if (rev.rowErrors.size > 0)
    throw new Error(
      `the row is an error row: ${JSON.stringify([...rev.rowErrors.values()].map((e: any) => e.json))}`
    );
  ce.pushScope(rev.scope);
  try {
    return evaluateF(ce, String(ce.lookupDefinition('F')?.value?.type));
  } finally {
    ce.popScope();
    rev.dispose();
  }
}

function median(run: () => Sample): Sample {
  const samples = [run(), run(), run()].sort((a, b) => a.ms - b.ms);
  return samples[1];
}

console.log(`CE ${version}, depth ${depth}`);
const control = median(assigned);
const row = median(() => documentRow(undefined));
const pure = median(() => documentRow('pure'));
for (const [name, sample] of [
  ['assigned (control)', control],
  ['row', row],
  ['row, effects pure (workaround)', pure],
] as const)
  console.log(
    `${sample.ms.toFixed(1).padStart(8)} ms  ${name}: value ${sample.value}, type ${sample.type}`
  );
const expected = String(2 ** depth);
const sameValue = [control, row, pure].every((s) => s.value === expected);
if (!sameValue)
  console.log(`a case did not give ${expected}: the instrument is not valid`);
if (row.ms < 20 && control.ms * 2 < row.ms)
  console.log(
    'the times are too small at this depth for the ratio to mean much: raise the depth'
  );
const ratio = row.ms / control.ms;
console.log(`ratio row / assigned: ${ratio.toFixed(1)}`);
console.log(`CE-1709: ${sameValue && ratio <= 2 ? 'READY' : 'NOT READY'}`);
