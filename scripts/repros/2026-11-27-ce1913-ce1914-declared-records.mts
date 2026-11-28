/**
 * CE-1913 and CE-1914: values of a declared record type.
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1913-ce1914-declared-records.mts
 *
 * CE-1913: the interpreted spread copy of a value of a declared record type,
 * with the spread of an undeclared dictionary literal as the control.
 * CE-1914: compiles to JavaScript a call of a declared record type's
 * constructor function and a dictionary literal with a `Nothing` field, with
 * the same dictionary literal without a declared type as the control.
 * Each line prints the value or the decline reason. The last line is READY
 * when every case gives a value.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();
ce.declare('t', 'real');
executeEpsil(
  ce,
  `
type Fig = record{__tag: string, kind: string, geom: tuple<real, real>}
function Fig(kind: string, x: real, y: real) { {__tag -> "Figure", kind -> kind, geom -> (x, y)} }
function sp(t: real) { let f = Fig("dot", t, 0); {...f, kind -> "x"} }
function spPlain(t: real) { let f = {__tag -> "Figure", kind -> "dot", geom -> (t, 0)}; {...f, kind -> "x"} }
function useFig(t: real) { Fig("dot", t, 0) }
function fx(t: real) { {__tag -> "Figure", kind -> "dot", geom -> [t, 0]} }
function fn(t: real) { {__tag -> "Figure", kind -> "dot", geom -> [t, 0], alpha -> nothing} }
`
);

let ready = true;
const interp = (label: string, name: string) => {
  const v = ce.expr([name, 2]).evaluate();
  if (v.operator === 'Error') ready = false;
  console.log(`CE-1913 ${label}: ${JSON.stringify(v.json)}`);
};
const compiled = (label: string, name: string) => {
  try {
    const r: any = compile(ce.expr([name, 't']), { fallback: false });
    console.log(`CE-1914 ${label}: ${JSON.stringify(r.run({ t: 2 }))}`);
  } catch (e) {
    ready = false;
    console.log(`CE-1914 ${label}: DECLINE ${(e as Error).message}`);
  }
};

interp('spread of a Fig', 'sp');
interp('control, spread of a dictionary literal', 'spPlain');
compiled('constructor function of Fig', 'useFig');
compiled('dictionary literal with a Nothing field', 'fn');
compiled('control, dictionary literal', 'fx');
console.log(ready ? 'READY' : 'NOT READY');
