/**
 * CE-1906: a compiled callback calls a function of the host whose argument
 * is a `List` literal with an element that is a variable holding a list, or
 * `ListFrom` of a rest parameter (Tycho's `draw(...args)`).
 *
 * Run: npx tsx scripts/repros/2026-11-27-ce1906-host-call-rest-list.mts
 *
 * Each case runs a program with `executeEpsil`, compiles the value of
 * `frame` to JavaScript, runs it, and prints whether it compiled, the
 * arguments that the host received from the compiled code and from the
 * interpreter, and a decline reason. The last line is READY when every
 * case compiles and gives the interpreter's arguments.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';

type Case = { label: string; program: string; expect: 'compile' | 'decline' };

const cases: Case[] = [
  {
    label: 'show([v]), v = [1, 2]',
    program: `let v = [1, 2]\nlet frame = (t: real) => do { show([v]); 0 }`,
    expect: 'compile',
  },
  {
    label: 'show(v) (control)',
    program: `let v = [1, 2]\nlet frame = (t: real) => do { show(v); 0 }`,
    expect: 'compile',
  },
  {
    label: 'show([[1, 2]]) (control)',
    program: `let frame = (t: real) => do { show([[1, 2]]); 0 }`,
    expect: 'compile',
  },
  {
    label: 'draw(v) through a rest parameter',
    program: `let v = [1, 2]\nfunction draw(...args) -> nothing { show(listFrom(args)) }\nlet frame = (t: real) => do { draw(v); 0 }`,
    expect: 'compile',
  },
  {
    label: 'draw(5) through a rest parameter (control)',
    program: `function draw(...args) -> nothing { show(listFrom(args)) }\nlet frame = (t: real) => do { draw(5); 0 }`,
    expect: 'compile',
  },
  {
    label: 'show([w]), w = 1..3 (a Range: the interpreter keeps it lazy)',
    program: `let w = 1..3\nlet frame = (t: real) => do { show([w]); 0 }`,
    expect: 'decline',
  },
];

let ready = true;
for (const c of cases) {
  const ce = new ComputeEngine();
  const calls: string[] = [];
  ce.declare('show', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      calls.push(ops.map((x) => JSON.stringify(x.json)).join(', '));
      return ce.Nothing;
    },
  } as any);
  executeEpsil(ce, c.program);
  const frame = ce.box('frame').evaluate();
  const r = compile(frame, { to: 'javascript' } as any) as any;
  let compiled: string[] = [];
  if (r.success) {
    calls.length = 0;
    r.run(0);
    compiled = [...calls];
  }
  calls.length = 0;
  ce.function('Apply', [frame, ce.number(0)]).evaluate();
  const interpreted = [...calls];
  const same = JSON.stringify(compiled) === JSON.stringify(interpreted);
  const ok =
    c.expect === 'compile' ? r.success === true && same : r.success !== true;
  if (!ok) ready = false;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${c.label}: ${r.success ? 'compiles' : 'declines'}` +
      (r.success ? `; compiled ${compiled.join(' | ')}` : '') +
      `; interpreter ${interpreted.join(' | ')}` +
      (r.success ? '' : `\n     ${r.message ?? JSON.stringify(r.unsupported ?? r)}`)
  );
}
console.log(ready ? 'READY' : 'NOT READY');
