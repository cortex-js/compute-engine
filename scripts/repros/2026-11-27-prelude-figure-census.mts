/**
 * Census of Tycho's drawing prelude on compiled JavaScript: each figure
 * operator, option and transform, called in an animation frame
 * `(t: real) => …`, compiled with no fallback and run at `t = 2`, against
 * the interpreter's value. The declines are grouped by their message, so
 * that one run lists every cause.
 *
 * Reads the prelude from the Tycho tree (`~/dev/tycho`, `DRAWING_PRELUDE`).
 *
 * Run: npx tsx scripts/repros/2026-11-27-prelude-figure-census.mts [--verbose] [filter]
 * Reading: `READY` when every case compiles and agrees.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';
// The Tycho tree is `~/dev/tycho` (or `TYCHO_DIR`), wherever this repo is.
const tycho = process.env.TYCHO_DIR ?? `${process.env.HOME}/dev/tycho`;
const { DRAWING_PRELUDE } = (await import(
  `${tycho}/src/graph-paper/notebook/drawing/prelude.ts`
)) as { DRAWING_PRELUDE: string };

const C = 'circle((cos(t), sin(t)), 0.2)';
const PTS = '[(0, 0), (t, 1), (2, 0)]';
const OPTIONS: [string, string][] = [
  ['fill', '{fill -> "red"}'],
  ['stroke', '{stroke -> "blue"}'],
  ['strokeWidth', '{strokeWidth -> 2}'],
  ['dash', '{dash -> [1, 2]}'],
  ['opacity', '{opacity -> 0.5}'],
  ['fill nothing', '{fill -> nothing}'],
  ['opacity of t', '{opacity -> t / 4}'],
  ['fill and stroke', '{fill -> "red", stroke -> "blue", strokeWidth -> 2}'],
  ['an unknown key', '{foo -> 1}'],
];

const CASES: [string, string][] = [
  ['point', 'point((t, 1))'],
  ['segment', 'segment((0, 0), (t, 1))'],
  ['arrow', 'arrow((0, 0), (t, 1))'],
  ['polyline', `polyline(${PTS})`],
  ['polygon', `polygon(${PTS})`],
  ['rect', 'rect((0, 0), t, 1)'],
  ['rect radius', 'rect((0, 0), t, 1, 0.2)'],
  ['circle', C],
  ['ellipse', 'ellipse((0, 0), t, 1)'],
  ['arc', 'arc((0, 0), 1, 0, t)'],
  ['bezier', 'bezier((0, 0), (1, t), (2, t), (3, 0))'],
  ['label', 'label((t, 0), "hi")'],
  ['curve', 'curve((s) => (cos(s), sin(s)), 0, t)'],
  ['graph', 'graph((x) => x^2, 0, t)'],
  ['group', `group(${C}, segment((0, 0), (t, 1)))`],
  ['group of a list', `group([${C}, segment((0, 0), (t, 1))])`],
  ['group options', `group(${C}, segment((0, 0), (t, 1)), {stroke -> "red"})`],
  ['list of figures', `[${C}, segment((0, 0), (t, 1))]`],
  ['canvas', `canvas([${C}])`],
  ['canvas options', `canvas([${C}], {grid -> true, axes -> true})`],
  [
    'canvas update content',
    `canvas([${C}]).update({content -> [segment((0, 0), (t, 1))]})`,
  ],
  ...OPTIONS.map(([n, o]): [string, string] => [
    `circle ${n}`,
    `circle((cos(t), sin(t)), 0.2, ${o})`,
  ]),
  ['polygon fill', `polygon(${PTS}, {fill -> "red", opacity -> 0.5})`],
  [
    'segment stroke',
    'segment((0, 0), (t, 1), {stroke -> "blue", strokeWidth -> 2})',
  ],
  ['label fill', 'label((t, 0), "hi", {fill -> "red"})'],
  ['translate', `${C}.translate((t, 0))`],
  ['rotate', `${C}.rotate(t)`],
  ['rotateAbout', `${C}.rotateAbout(t, (1, 1))`],
  ['scale', `${C}.scale(2)`],
  ['scale pair', `${C}.scale((2, 3))`],
  ['scaleAbout', `${C}.scaleAbout(2, (1, 1))`],
  ['reflect', `${C}.reflect("x")`],
  ['skew', `${C}.skew(t, 0)`],
  ['update', `${C}.update({fill -> "red"})`],
  ['bounds', `${C}.bounds()`],
  ['center', `${C}.center()`],
  ['polygon rotate', `polygon(${PTS}).rotate(t)`],
  ['polygon center', `polygon(${PTS}).center()`],
  ['segment rotate', 'segment((0, 0), (t, 1)).rotate(t)'],
  ['label rotate', 'label((t, 0), "hi").rotate(t)'],
  ['anchor n', `${C}.anchor("n")`],
  ['chain', `polygon(${PTS}, {fill -> "red"}).rotate(t).translate((1, 0))`],
];

const verbose = process.argv.includes('--verbose');
const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));

const ce = new ComputeEngine();
const loaded = executeEpsil(ce, DRAWING_PRELUDE);
if (loaded.diagnostics.some((d) => d.severity === 'error'))
  throw new Error(
    'the drawing prelude does not load: ' + JSON.stringify(loaded.diagnostics)
  );

const close = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number')
    return (
      a === b ||
      Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ||
      (isNaN(a) && isNaN(b))
    );
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a),
      kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => close((a as any)[k], (b as any)[k]))
    );
  }
  return a === b;
};

/** The leaves of the interpreter's MathJSON, in order: a function's head
 *  dropped, `Nothing` as `null`, a string unquoted. */
const leavesOfJson = (j: any, out: unknown[] = []): unknown[] => {
  if (Array.isArray(j)) for (const x of j.slice(1)) leavesOfJson(x, out);
  else if (j && typeof j === 'object' && 'num' in j) out.push(Number(j.num));
  else if (j && typeof j === 'object' && 'dict' in j)
    for (const x of Object.values(j.dict)) leavesOfJson(x, out);
  else if (typeof j === 'string')
    out.push(
      j === 'Nothing'
        ? null
        : j === 'True'
          ? true
          : j === 'False'
            ? false
            : j.replace(/^'(.*)'$/s, '$1')
    );
  else out.push(j);
  return out;
};
/** The leaves of a value of `run()`: an array's elements, an object's fields. */
const leavesOfRun = (v: any, out: unknown[] = []): unknown[] => {
  if (Array.isArray(v)) for (const x of v) leavesOfRun(x, out);
  else if (v && typeof v === 'object')
    for (const x of Object.values(v)) leavesOfRun(x, out);
  else out.push(v === undefined ? null : v);
  return out;
};

const groups = new Map<string, string[]>();
let ready = 0,
  total = 0;
for (const [name, body] of CASES) {
  if (filter && !name.includes(filter)) continue;
  total++;
  let status: string;
  try {
    const fn = executeEpsil(ce, `(t: real) => ${body}`).value;
    const interp = ce.function('Apply', [fn, ce.number(2)]).evaluate();
    const r = compile(fn, { to: 'javascript', fallback: false } as any) as any;
    if (!r.success) {
      const msg = String(
        r.diagnostic?.message ?? r.message ?? 'no message'
      ).split('\n')[0];
      status = 'DECLINE ' + msg;
    } else {
      const got = r.run(2);
      const agree = close(leavesOfRun(got), leavesOfJson(interp.json));
      status = agree
        ? 'compiles, agrees'
        : `WRONG VALUE: compiled ${JSON.stringify(got)}; interpreted ${JSON.stringify(interp.json)}`;
      if (verbose && agree) status += `: ${JSON.stringify(got)}`;
      if (agree) ready++;
      else
        groups.set('WRONG VALUE', [...(groups.get('WRONG VALUE') ?? []), name]);
    }
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    status = 'DECLINE ' + msg;
  }
  if (status.startsWith('DECLINE')) {
    const key = status.slice(8).replace(/\d+(\.\d+)?/g, '#');
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  console.log(
    `${name}: ${status.length > 400 && !verbose ? status.slice(0, 400) + '…' : status}`
  );
}
console.log(`\n${ready}/${total} compile`);
for (const [k, names] of [...groups].sort((a, b) => b[1].length - a[1].length))
  console.log(
    `\n[${names.length}] ${k.slice(0, 300)}\n    ${names.join(', ')}`
  );
console.log(ready === total ? 'READY' : 'NOT READY');
