// Origin case of SLICE_BOUNDS_MEMO (library/collections.ts, commit e523dab98,
// test "the span is resolved ONCE per node" in sequence-search.test.ts):
// element reads of the lazy view `Slice(xs, RangeOf(xs, needle))`. Without
// the memo, each element read evaluates `RangeOf` again.
import { ComputeEngine } from '/tmp/wt-compute-engine-aa-cache2/src/compute-engine.ts';
import { measure } from './harness.mts';

const N = Number(process.env.SLICE_N ?? 400); // length of xs
const M = Number(process.env.SLICE_M ?? 100); // length of the needle
const xs = Array.from({ length: N }, (_, k) => (k * 7919) % 1009);
const start = N - M - 10;
const needle = xs.slice(start, start + M);

const ce = new ComputeEngine();
await measure(
  `slice N=${N} M=${M}`,
  () => ce.box(['Slice', ['List', ...xs], ['RangeOf', ['List', ...xs], ['List', ...needle]]]),
  (view) => {
    // A full iteration, then every element by index: the two read patterns
    // of the origin test.
    const it = [...view.each()].map((x) => x.re);
    const at: number[] = [];
    const n = view.count ?? 0;
    for (let k = 1; k <= n; k++) at.push(view.at(k)!.re);
    return `count=${n} each=${it.join(',')} at=${at.join(',')}`;
  }
);

// The evaluate() route: does evaluating the Slice (the usual route of a
// document) read the bounds once or once per element?
await measure(
  `slice-evaluate N=${N} M=${M}`,
  () => ce.box(['Slice', ['List', ...xs], ['RangeOf', ['List', ...xs], ['List', ...needle]]]),
  (view) => {
    const v = view.evaluate();
    return `${v.operator} ${v.count} ${[...v.each()].map((x) => x.re).join(',')}`;
  }
);

// The same two routes with a new engine per run (outside the timer), so
// that no cache of an earlier run in the same engine can serve this one.
await measure(
  `slice-fresh-engine N=${N} M=${M}`,
  () => {
    const e = new ComputeEngine();
    return e.box(['Slice', ['List', ...xs], ['RangeOf', ['List', ...xs], ['List', ...needle]]]);
  },
  (view) => {
    const it = [...view.each()].map((x) => x.re);
    const at: number[] = [];
    const n = view.count ?? 0;
    for (let k = 1; k <= n; k++) at.push(view.at(k)!.re);
    return `count=${n} each=${it.join(',')} at=${at.join(',')}`;
  }
);
await measure(
  `slice-evaluate-fresh-engine N=${N} M=${M}`,
  () => {
    const e = new ComputeEngine();
    return e.box(['Slice', ['List', ...xs], ['RangeOf', ['List', ...xs], ['List', ...needle]]]);
  },
  (view) => {
    const v = view.evaluate();
    return `${v.operator} ${v.count} ${[...v.each()].map((x) => x.re).join(',')}`;
  }
);
