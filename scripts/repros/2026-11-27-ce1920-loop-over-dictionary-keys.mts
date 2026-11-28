/**
 * CE-1920: compiled JavaScript and a loop over the keys of a dictionary
 * parameter, the loop of Tycho's `figureStyled` (drawing prelude).
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1920-loop-over-dictionary-keys.mts
 *
 * Each case compiles the value of `frame` to JavaScript and runs it with
 * `t = 2`. The last line is READY when each case compiles and gives the
 * interpreter's value.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';

const PRELUDE = `
function g(v: any) -> real { if v is string { 1 } else { 2 } }
function constantKey(opts: dictionary = {->}) -> real { g(opts["fill"]) }
function count(n: real, opts: dictionary = {->}) -> real {
  let s = n
  for k in keys(opts) { s = s + g(opts[k]) }
  s
}
`;

const cases: Array<{ label: string; program: string; control?: boolean }> = [
  {
    label: 'control: a read of a dictionary literal by a constant key',
    program: `let frame = (t: real) => constantKey({fill -> "red"}) + t`,
    control: true,
  },
  {
    label: 'a loop over the keys of the default {->}',
    program: `let frame = (t: real) => count(t)`,
  },
  {
    label: 'a loop over the keys of a dictionary literal',
    program: `let frame = (t: real) => count(t, {fill -> "red", opacity -> 0.5})`,
  },
];

let ready = true;
for (const c of cases) {
  const ce = new ComputeEngine();
  executeEpsil(ce, PRELUDE);
  executeEpsil(ce, c.program);
  const expected = JSON.stringify(ce.expr(['frame', 2]).evaluate().json);
  let out: string;
  try {
    const r = compile(ce.expr('frame').evaluate(), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    const value = JSON.stringify(r.run(2));
    if (value !== expected) ready = false;
    out = `compiles, ${value} (interpreter ${expected})${value === expected ? '' : '  MISMATCH'}`;
  } catch (e) {
    ready = false;
    out = `DECLINE ${(e as Error).message.split('\n')[0]} (interpreter ${expected})`;
  }
  console.log(`${c.label}: ${out}`);
}
console.log(ready ? 'READY' : 'NOT READY');
