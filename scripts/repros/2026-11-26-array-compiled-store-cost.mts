/**
 * The cost of a store to a mutable array in compiled JavaScript
 * (`docs/plans/2026-11-25-mutable-arrays-implementation-plan.md`, stage 4,
 * "Measurements"; spec acceptance case 13: less than 2 ms for (1)).
 *
 * Run: npx tsx scripts/repros/2026-11-26-array-compiled-store-cost.mts [frames]
 *
 * Each case compiles one frame function and runs it `frames` times (200 by
 * default) after 20 warm-up runs, and prints the median time of a frame:
 *
 *   (1) `(px: array<Byte>, t: integer) => for i in 1..64000 { px[i] = Mod(i + t, 256) }`,
 *       the code that `compile()` emits;
 *   (2) the same code with the increment of the version removed from each
 *       store (decision C4), by a text replacement that this script makes on
 *       the emitted code: the cost of the increment;
 *   (3) a frame of 320 × 200 pixels of a tuple cell of four bytes (`Pixel`)
 *       through the helper `set(r, x, y, p)` of a raster that is a named
 *       tuple, with the test of `x` and `y`;
 *   (4) the code of (1) with the index selection `i > 0 ? i - 1 : n + i`
 *       replaced by `i - 1`: the cost of the selection.
 *
 * (2) and (4) run the emitted code over the same runtime (`runtimeOf()`) as
 * `run()`, with no entry check; (1) also runs that way, beside `run()`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { runtimeOf } from '../../src/compute-engine/compilation/ir/print-js';
import { twoStageRunner } from '../../src/compute-engine/compilation/javascript-runtime';

const frames = Number(process.argv[2] ?? 200);

const ce = new ComputeEngine();
ce.timeLimit = Infinity;
executeEpsil(
  ce,
  `type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
type Raster = tuple<width: integer, height: integer, pixels: array<Pixel>>
let fill = (px: array<Byte>, t: integer) => do { for i in 1..64000 { px[i] = Mod(i + t, 256) }; 0 }
let scr = Raster(320, 200, arrayFrom(repeat(Pixel(0, 0, 0, 255), 64000), "Pixel"))
function set(r, x, y, p) { if (x >= 1 && x <= r.width && y >= 1 && y <= r.height) { r.pixels[(y - 1) * r.width + x] = p }; 0 }
let frame = (t: Byte) => do { for y in 1..200 { for x in 1..320 { set(scr, x, y, Pixel(t, 128, 0, 255)) } }; 0 }
let buffer = arrayFrom(repeat(0, 64000), "Byte")`
);

const median = (f: (t: number) => unknown): number => {
  for (let t = 0; t < 20; t++) f(t);
  const times: number[] = [];
  for (let t = 0; t < frames; t++) {
    const t0 = performance.now();
    f(t);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
};

/** The emitted code of the function `name`, with `edit` applied to it, as
 *  a function over the runtime of `run()`. */
function emitted(name: string, edit?: (code: string) => string) {
  const s = compileSlice(ce.box(name).evaluate(), { target: 'javascript' });
  const code = edit?.(s.code) ?? s.code;
  if (edit !== undefined && code === s.code)
    throw new Error(`the edit of ${name} changed nothing`);
  const sys = runtimeOf(ce as never, s.program.hosts, s.program.arrays);
  return {
    code,
    run: twoStageRunner(sys, s.preambleOnce, [], `return (${code});`)() as (
      ...args: unknown[]
    ) => unknown,
  };
}

const buffer = ce.box('buffer').evaluate();
const fill = compile(ce.box('fill').evaluate(), { to: 'javascript', fallback: false });
const run = fill.run as (...args: unknown[]) => unknown;
const raw = emitted('fill');
const noVersion = emitted('fill', (c) => c.replace(/a0\._version\+\+, /g, ''));
const noSelection = emitted('fill', (c) =>
  c.replace(/(v\d+) > 0 \? \1 - 1 : a0\._cells\.length \+ \1/g, '$1 - 1')
);
const frame = compile(ce.box('frame').evaluate(), { to: 'javascript', fallback: false });
const frameRun = frame.run as (...args: unknown[]) => unknown;

const line = (label: string, ms: number) =>
  console.log(`${label.padEnd(64)} ${ms.toFixed(3)} ms`);
line('(1) 64,000 stores, run()', median((t) => run(buffer, t)));
line('(1) 64,000 stores, the emitted code', median((t) => raw.run(buffer, t)));
line('(2) the same with no version increment', median((t) => noVersion.run(buffer, t)));
line('(3) 320 x 200 pixels of four bytes through set(r, x, y, p)', median((t) => frameRun(t % 256)));
line('(4) (1) with i - 1 for the index selection', median((t) => noSelection.run(buffer, t)));
console.log(`(the store of (1): ${/const v\d+ = \(a0\._version.*;/.exec(raw.code)?.[0]})`);
const pixels = ce.box(['Field', 'scr', { str: 'pixels' }]).evaluate() as unknown as {
  cells: Uint8Array;
};
console.log(
  `(the last pixel after (3): ${Array.from(pixels.cells.slice(-4)).join(', ')}; the last cell after (1): ${(buffer as unknown as { cells: Uint8Array }).cells[63999]})`
);
