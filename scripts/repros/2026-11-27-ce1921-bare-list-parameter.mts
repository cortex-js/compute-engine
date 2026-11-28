/**
 * CE-1921: compiled JavaScript declines a parameter or a result declared
 * `list` (no element type) that holds a list literal of numbers and a
 * string, as Tycho's prelude `label` passes `[x, y, text]` to
 * `figureOf(kind: string, geom: list)`.
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1921-bare-list-parameter.mts
 *
 * Each line prints the compiled value at t = 3 and the interpreter's, or the
 * decline. The last line is READY when every case marked `compile` compiles
 * and gives the interpreter's value.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';

const PRELUDE = `
type T = tuple<k: string, geom: list>
function g(geom: list) { geom }
function wrap(geom: list) { T("x", geom) }
function wrapAny(geom: any) { T("x", geom) }
`;

const cases: Array<{ label: string; call: string; expect: 'compile' | 'control' }> = [
  { label: 'control: the literal alone', call: '[t, 2, "a"]', expect: 'control' },
  { label: 'control: a list of numbers in a field', call: 'wrap([t, 2])', expect: 'control' },
  { label: 'the parameter declared any, the field list', call: 'wrapAny([t, 2, "a"])', expect: 'compile' },
  { label: 'a mixed list literal in the field list', call: 'T("x", [t, 2, "a"])', expect: 'compile' },
  { label: 'a mixed list at a parameter list, in a field', call: 'wrap([t, 2, "a"])', expect: 'compile' },
  { label: 'a mixed list at a parameter list, returned', call: 'g([t, 2, "a"])', expect: 'compile' },
  { label: 'a list of numbers returned as list', call: 'g([t, 2])', expect: 'compile' },
];

let ready = true;
for (const c of cases) {
  const ce = new ComputeEngine();
  executeEpsil(ce, PRELUDE);
  const fn = executeEpsil(ce, `(t: integer) => ${c.call}`).value;
  const expected = ce.expr(['Apply', fn, 3]).evaluate().json;
  let out: string;
  let ok = false;
  try {
    const r = compile(fn, { to: 'javascript', fallback: false } as any) as any;
    const value = r.run(3);
    out = `compiles, ${JSON.stringify(value)} (interpreter ${JSON.stringify(expected)})`;
    ok = true;
  } catch (e) {
    out = `DECLINE ${(e as Error).message.split('\n')[0]}`;
  }
  if (!ok) ready = false;
  console.log(`${c.label}: ${out}`);
}
console.log(ready ? 'READY' : 'NOT READY');
