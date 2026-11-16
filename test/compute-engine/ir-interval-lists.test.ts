/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batch 3: lists and tuples.
 *
 * Containment, as in `ir-interval-containment.test.ts`: at seeded random
 * boxes (a list input is an array of boxes, one per element), the
 * interpreter's value at points of the box is inside the result, element by
 * element for a list; a list result whose length is not one number is
 * `entire`. An end may miss by at most 2 ulps; the checks that need that
 * slack are counted. The comparison with the existing interval target: the
 * same kind and bounds within 4 ulps or tighter, element by element; the
 * programs for which some box differs are pinned in `EXCEPTIONS`.
 *
 * Then the result contract with list inputs and results, the declines of
 * the batch, and robustness. The `Loop` statement (over a `Range` or a list,
 * with carried locals) is in the cases too, and its contract (a bound that
 * is not a point, the `iterationBudget`) in its own section.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { IntervalArithmetic } from '../../src/compute-engine/interval/index';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'integer');
ce.declare('L', 'list<real>');
ce.declare('V', 'list<real^3>');
ce.declare('B', 'list<real^200>');
ce.declare('P', 'tuple<real, real>');
ce.declare('f', '(list<real>) -> list<real>');
ce.assign('f', ce.box(['Function', ['Multiply', 2, 'A'], 'A'] as never));
ce.declare('s', '(list<real>) -> real');
ce.assign('s', ce.box(['Function', ['Sum', 'A'], 'A'] as never));
// A `Loop` in a user function, Tycho's shape: the sum of a/k for k = 1..8.
ce.declare('w', '(real) -> real');
ce.assign(
  'w',
  ce.box([
    'Function',
    ['Block', ['Declare', 'u', "'real'", 0], ['Loop', ['Assign', 'u', ['Add', 'u', ['Divide', 'a', 'k']]], ['Element', 'k', ['Range', 1, 8]]], 'u'],
    'a',
  ] as never)
);

/** The length of each list input of the containment cases. */
const LENGTHS: Record<string, number> = { L: 4, V: 3, B: 200, P: 2 };

type Json = unknown;
type Case = { json: Json; centres?: number[] };
const C = (json: Json, centres?: number[]): Case => ({ json, centres });
const x = 'x';
const y = 'y';
const T = (body: Json) => ['Function', body, 't'];
/** A literal of one untyped parameter, which `Apply` maps over a flat list
 *  as the interpreter does (CE-1344). */
const K = (body: Json) => ['Function', body, 'k'];
const squares = ['List', ['Power', x, 2], ['Power', ['Subtract', x, 1], 2], ['Power', ['Subtract', x, 2], 2]];
const list3 = ['List', x, ['Multiply', 2, x], ['Power', x, 2]];
/** A program that declares `t`, of the value 0, runs `loop` and returns
 *  `t`. */
const loopOf = (loop: Json, last: Json = 't') => ['Block', ['Declare', 't', "'real'", 0], loop, last];
const addTo = (v: Json) => ['Assign', 't', ['Add', 't', v]];
/** A local declared as Tycho declares it, with a value. */
const local = (name: string, v: Json) => ['Declare', name, ['Dictionary', ['KeyValuePair', { str: 'value' }, v]]];
/** The shape of Tycho's `showcase/black-hole` #0, reduced: a `Loop` over
 *  `Range(1, 6)` that declares a local in its pass and updates two locals
 *  declared outside it. */
// prettier-ignore
const BLACK_HOLE = ['Block',
  local('b', ['Sqrt', ['Add', ['Power', x, 2], ['Power', y, 2]]]),
  local('r', ['Max', 'b', 1.5]), local('v', 0),
  ['Loop', ['Block',
    local('ca', ['Subtract', 1, ['Divide', 1, 'r']]),
    ['Assign', 'r', ['Max', ['Divide', ['Multiply', 'b', ['Sqrt', ['Subtract', 1, ['Divide', 1, 'r']]]], ['Sqrt', ['Max', ['Subtract', 1, ['Power', 'ca', 2]], 1e-9]]], 1.01]],
    ['Assign', 'v', ['Add', 'v', ['Divide', 1, 'r']]]],
  ['Element', 'k', ['Range', 1, 6]]],
  ['Add', 'r', 'v']];
/** A local assigned in both arms of an `If` in each pass, and in one arm
 *  of an `If` with no else. */
const LOOP_IF = loopOf(['Loop', ['If', ['Greater', x, 0], addTo(['Multiply', 2, x]), addTo(-1)], ['Element', 'k', ['Range', 1, 3]]]);
const LOOP_IF_NO_ELSE = ['Block', ['Declare', 't', "'real'", 1], ['Loop', ['If', ['Greater', x, 'k'], ['Assign', 't', ['Multiply', 't', x]]], ['Element', 'k', ['Range', 1, 3]]], 't'];

// prettier-ignore
const CASES: Case[] = [
  // `At` of a list literal: a constant index, a computed one (the common
  // Tycho form), across the ends, negative, not an integer.
  C(['At', list3, 2]), C(['At', list3, -1]),
  C(['At', list3, ['Add', ['Floor', y], 1]], [0, 1, 2, 3]),
  C(['At', list3, ['Floor', y]], [0, 1, 3, 4, -3, -4]),
  C(['At', list3, ['Subtract', ['Floor', y], 2]], [0, -1, -3]),
  C(['At', list3, y], [1, 1.5, 2]),
  // `At` of an input list and of a large input vector.
  C(['At', 'L', 2]), C(['At', 'L', ['Add', ['Floor', x], 1]], [0, 3, 4]),
  C(['At', 'B', ['Add', ['Floor', x], 1]], [0, 100, 199, 200]),
  // Points and tuples.
  C(['PointX', 'P']), C(['PointY', 'P']), C(['Add', ['PointX', 'P'], ['PointY', 'P']]),
  C(['At', 'P', 2]), C(['At', ['Tuple', x, y], 2]),
  C(['Multiply', 2, 'P']), C(['Add', 'P', ['Tuple', x, 1]]),
  // Element-wise arithmetic.
  C(['Map', T(['Multiply', 't', x]), 'V']), C(['Filter', 'V', T(['Greater', 't', 0])]),
  C(['Multiply', 2, 'L']), C(['Add', ['Multiply', 2, 'L'], 1]), C(['Add', 'L', x]),
  C(['Add', 'V', ['Multiply', x, 'V']]), C(['Sin', 'V']), C(['Divide', 1, 'V'], [0]),
  // Reductions.
  C(['Sum', 'L']), C(['Product', 'L']), C(['Max', 'L']), C(['Min', 'L']),
  C(['Length', 'L']), C(['Max', 'L', x]), C(['Sum', 'V']), C(['Max', ['List', x, y, ['Multiply', x, y]]]),
  C(['Add', ['Sum', 'B'], x]),
  // `ListJoin`: lists and scalars, read by `At` and `Sum`.
  C(['ListJoin', 'L', 'V']), C(['ListJoin', 'L', x]), C(['ListJoin', x, 'L', y]),
  C(['Sum', ['ListJoin', 'L', ['List', x, y]]]),
  C(['At', ['ListJoin', list3, 'L'], ['Add', ['Floor', y], 1]], [0, 1, 3, 4, 6]),
  // A `Comprehension` of two clauses over lists of inputs.
  C(['Comprehension', ['Multiply', 'j', 'k', x], ['Element', 'j', 'V'], ['Element', 'k', 'V']]),
  C(['Comprehension', ['Add', 'j', ['Multiply', 'k', x]], ['Element', 'j', 'L'], ['Element', 'k', 'V']]),
  C(['Sum', ['Comprehension', ['Multiply', 'j', 'k', x], ['Element', 'j', 'V'], ['Element', 'k', 'L']]]),
  // Builds and filters.
  C(['Map', T(['Multiply', ['Sin', 't'], x]), 'L']),
  C(['Add', 'L', ['Map', T(['Sin', 't']), 'L']]),
  C(['Comprehension', ['Multiply', ['Power', 'k', 2], x], ['Element', 'k', ['Range', 1, 4]]]),
  C(['Comprehension', ['Multiply', 'k', x], ['Element', 'k', ['Range', 1, 'n']]]),
  C(['Sum', ['Comprehension', ['Multiply', 'k', x], ['Element', 'k', ['Range', 'n', 3]]]]),
  C(['Length', ['Range', 1, 'n']]),
  C(['Filter', 'L', T(['Greater', 't', 0])]),
  C(['Filter', ['List', 1, -2, 3], T(['Greater', 't', 0])]),
  C(['Sum', ['Filter', 'L', T(['Greater', 't', x])]]),
  // A list in the arms of an `If`: the hull element by element.
  C(['If', ['Greater', x, 0], ['List', x, 1], ['List', ['Negate', x], 2]], [0]),
  // User functions of a list parameter and of a list result.
  C(['s', 'L']), C(['f', 'L']), C(['At', ['f', 'L'], ['Add', ['Floor', x], 1]], [0, 2]),
  C(['s', ['List', x, 1]]),
  // A root tuple.
  C(['Tuple', ['Cos', x], ['Sin', x]]),
  // A list of points, a list of verdicts, `At` of a loop index, and the
  // clamped index of Tycho's corpus.
  C(['PointList', 'L', ['Multiply', 2, 'L']]), C(['Map', T(['Greater', 't', x]), 'L']),
  C(['Sum', ['Multiply', ['At', 'L', 'k'], x], ['Limits', 'k', 1, 3]]),
  C(['At', 'L', ['Max', 1, ['Min', 4, ['Add', ['Floor', x], 1]]]], [0, 3, 4]),
  // `Apply` of a literal of one untyped parameter over a flat list (the
  // interpreter maps it; the path of `Map`), read by a reduction, by `At`,
  // with a condition that is undecided over the box, and Tycho's witness of
  // CE-1344 with its `Map` control. The existing target declines `Apply`
  // over a list, so only the `Map` control is compared with it.
  C(['Apply', K(['Multiply', 'k', x]), 'L']), C(['Apply', K(['Sin', 'k']), 'V']),
  C(['Apply', K(['Multiply', 'k', x]), ['List', 1, 2, 3]]),
  C(['Sum', ['Apply', K(['Power', 'k', 2]), 'L']]),
  C(['Max', ['Apply', K(['If', ['Greater', 'k', x], 'k', x]), 'V']], [0]),
  C(['At', ['Apply', K(['Multiply', 2, 'k']), 'L'], ['Add', ['Floor', x], 1]], [0, 3, 4]),
  C(['Min', ['Apply', K(['Which', ['Equal', 'k', y], 1e9, 'True', 'k']), squares]], [0, 1, 2]),
  C(['Min', ['Map', K(['Which', ['Equal', 'k', y], 1e9, 'True', 'k']), squares]], [0, 1, 2]),
  // `Min` and `Max` of one scalar operand are the operand.
  C(['Min', x]), C(['Max', ['Add', x, y]]), C(['Min', ['Apply', K(['Abs', 'k']), 'L']]),
  // Element-wise powers by a constant exponent.
  C(['Power', 'L', 3]), C(['Power', ['List', x, 2], 3]), C(['Power', 'L', 2]),
  C(['Power', 'L', -1], [0]),
  // `Loop`: Tycho's black-hole shape; nested loops, the inner bound read
  // from the outer index; over a list literal and over an input list; a
  // run-time bound; an empty range; in a user function; an `If` in a pass.
  C(BLACK_HOLE, [0, 1, 1.5]),
  C(loopOf(['Loop', ['Loop', addTo(['Multiply', 'j', 'k', x]), ['Element', 'j', ['Range', 1, 'k']]], ['Element', 'k', ['Range', 1, 3]]])),
  C(loopOf(['Loop', addTo(['Multiply', 'e', x]), ['Element', 'e', ['List', 1, y, 3]]])),
  C(loopOf(['Loop', ['Assign', 't', ['Max', 't', ['Multiply', 'e', x]]], ['Element', 'e', 'L']])),
  C(loopOf(['Loop', addTo(['Multiply', 'k', x]), ['Element', 'k', ['Range', 1, 'n', 1]]])),
  C(loopOf(['Loop', addTo(x), ['Element', 'k', ['Range', 5, 1, 1]]], ['Add', 't', x])),
  C(['Add', ['w', x], 1]),
  C(LOOP_IF, [0]), C(LOOP_IF_NO_ELSE, [1, 2, 3]),
];

/** The programs whose result differs from the existing target's at some
 *  box: another kind, or a bound wider by more than 4 ulps. */
// prettier-ignore
const EXCEPTIONS: string[] = [
  // An `If` in a pass of a `Loop` whose condition the box does not decide:
  // the mode joins the values of both arms (a hull); the existing target
  // answers `entire`.
  JSON.stringify(LOOP_IF), JSON.stringify(LOOP_IF_NO_ELSE),
];

// A seeded generator (mulberry32).
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Iv = { lo: number; hi: number };
type Box = Record<string, Iv | Iv[]>;
type Point = Record<string, number | number[]>;
const WIDTHS = [0, 1e-6, 0.3, 2, 8];

function realBox(c: number, rnd: () => number): Iv {
  const w = WIDTHS[Math.floor(rnd() * WIDTHS.length)];
  const s = rnd();
  const lo = s < 0.33 ? c : s < 0.66 ? c - w : c - w / 2;
  return { lo, hi: lo + w };
}

function boxes(expr: Expression, centres: number[], rnd: () => number): Box[] {
  const names = expr.unknowns as string[];
  return Array.from({ length: 24 }, () => {
    const b: Box = {};
    for (const v of names) {
      if (v === 'n') {
        const lo = Math.floor(rnd() * 8) - 2;
        b[v] = { lo, hi: rnd() < 0.5 ? lo : lo + Math.floor(rnd() * 4) };
      } else if (v in LENGTHS)
        b[v] = Array.from({ length: LENGTHS[v] }, () =>
          realBox((rnd() - 0.5) * 8, rnd)
        );
      else {
        const c =
          rnd() < 0.6
            ? [...centres, 0, 1, -1][Math.floor(rnd() * (centres.length + 3))]
            : (rnd() - 0.5) * 12;
        b[v] = realBox(c, rnd);
      }
    }
    return b;
  });
}

function pointsOf(b: Box, rnd: () => number): Point[] {
  const pick = (v: string, { lo, hi }: Iv, k: number) =>
    k === 0
      ? lo
      : k === 1
        ? hi
        : v === 'n'
          ? lo + Math.floor(rnd() * (hi - lo + 1))
          : lo + rnd() * (hi - lo);
  return Array.from({ length: 6 }, (_, k) =>
    Object.fromEntries(
      Object.entries(b).map(([v, iv]) => [
        v,
        Array.isArray(iv) ? iv.map((e) => pick(v, e, k)) : pick(v, iv, k),
      ])
    )
  );
}

/** The double `v` as the exact rational the interpreter reads. */
function exact(v: number): Json {
  if (Number.isInteger(v)) return v;
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ['Rational', Number(BigInt(v * 2 ** k)), 2 ** k];
}

type Value = number | boolean | undefined | Value[];

/** The interpreter's value at `point`: a finite real, a boolean, a list of
 *  values, or `undefined` (no real value). */
function interpret(expr: Expression, point: Point): Value {
  const sub = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      ce.box(
        (Array.isArray(v)
          ? [k === 'P' ? 'Tuple' : 'List', ...v.map(exact)]
          : exact(v)) as never
      ),
    ])
  );
  const read = (v: Expression): Value => {
    if (v.symbol === 'True') return true;
    if (v.symbol === 'False') return false;
    if (v.isCollection) return [...v.each()].map((e) => read(e.N()));
    if (!v.isNumberLiteral || v.im !== 0 || !Number.isFinite(v.re))
      return undefined;
    return v.re;
  };
  return read(expr.subs(sub).N());
}

type Kinded = { kind: string; value?: Iv };

const step = (x: number, n: number, f: (x: number) => number) => {
  for (let k = 0; k < n; k++) x = f(x);
  return x;
};

let checks = 0;
let slack = 0;
const SAMPLES: string[] = [];
const differences = new Map<string, string>();

/** The failures of `got` against the interpreter's value `v`. */
function contains(got: unknown, v: Value, label: string, at: string): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) {
    if (!Array.isArray(got))
      return (got as Kinded)?.kind === 'entire'
        ? []
        : [`${at}: ${JSON.stringify(got)}, not a list`];
    if (got.length !== v.length)
      return [`${at}: a list of ${got.length}, interpreter ${v.length}`];
    return v.flatMap((e, k) => contains(got[k], e, label, `${at}[${k}]`));
  }
  checks += 1;
  if (typeof v === 'boolean')
    return got === (v ? 'false' : 'true') ? [`${at}: ${got}, ${v}`] : [];
  const k = got as Kinded;
  if (typeof k?.kind !== 'string') return [`${at}: not kinded ${JSON.stringify(got)}`];
  if (k.kind === 'empty') return [`${at}: empty, interpreter ${v}`];
  if (k.value === undefined) return [];
  const { lo, hi } = k.value;
  if (v >= lo && v <= hi) return [];
  if (v >= step(lo, 2, nextDown) && v <= step(hi, 2, nextUp)) {
    slack += 1;
    if (SAMPLES.length < 10) SAMPLES.push(`${label} ${at}: ${v} in ${JSON.stringify(k)}`);
    return [];
  }
  return [`${at}: ${JSON.stringify(got)}, interpreter ${v}`];
}

/** The same verdict, or the same kind and bounds within 4 ulps of the
 *  existing result or inside it, element by element. */
function sameOrTighter(got: unknown, was: unknown): boolean {
  if (Array.isArray(got) || Array.isArray(was))
    return (
      Array.isArray(got) &&
      Array.isArray(was) &&
      got.length === was.length &&
      got.every((g, k) => sameOrTighter(g, was[k]))
    );
  if (typeof got === 'string' || typeof was === 'string') return got === was;
  const [a, b] = [got as Kinded, was as Kinded];
  if (a.kind !== b.kind) return false;
  if (a.value === undefined || b.value === undefined)
    return a.value === b.value;
  return (
    a.value.lo >= step(b.value.lo, 4, nextDown) &&
    a.value.hi <= step(b.value.hi, 4, nextUp)
  );
}

type Compiled = {
  success: boolean;
  code: string;
  listInputs?: string[];
  run: (b: unknown) => unknown;
  broadcast?: (cells: unknown, o?: unknown) => Float64Array;
};
const mode = (json: Json, c = ce) =>
  compile(c.box(json as never), {
    to: 'interval-js',
    profile: 'ir',
    fallback: false,
  } as never) as unknown as Compiled;

describe('the interval mode, lists: containment', () => {
  test.each(CASES.map((c) => [JSON.stringify(c.json), c]))('%s', (label, c) => {
    const expr = ce.box(c.json as never);
    const r = mode(c.json);
    const old = compile(expr, { to: 'interval-js' }) as unknown as Compiled;
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    for (const b of boxes(expr, c.centres ?? [], rnd)) {
      const got = r.run(b);
      for (const point of pointsOf(b, rnd))
        failures.push(
          ...contains(got, interpret(expr, point), label, JSON.stringify(point))
        );
      if (!old.success || differences.has(label)) continue;
      const was = old.run(b);
      if (!sameOrTighter(got, was))
        differences.set(
          label,
          `${JSON.stringify(b)}: mode ${JSON.stringify(got)}, existing ${JSON.stringify(was)}`
        );
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  test('the count of checks, and of those that used the slack', () => {
    console.log(
      `${checks} containment checks, ${slack} within the 2-ulp slack\n${SAMPLES.join('\n')}`
    );
    expect(checks).toBeGreaterThan(5_000);
  });

  test('the programs that differ from the existing target', () => {
    console.log([...differences].map(([k, v]) => `${k}\n  ${v}`).join('\n'));
    expect([...differences.keys()].sort()).toEqual([...EXCEPTIONS].sort());
  });
});

describe('the interval mode, lists: the result contract', () => {
  const at = ['At', 'L', ['Add', ['Floor', x], 1]];
  const L = [10, { lo: 20, hi: 21 }, 30];

  test('listInputs names the inputs of a list or tuple type', () => {
    expect(mode(at).listInputs).toEqual(['L']);
    expect(mode(['Add', ['PointX', 'P'], x]).listInputs).toEqual(['P']);
    expect(mode(['Sin', x]).listInputs).toBeUndefined();
  });

  test('run() with numbers and with intervals as elements', () => {
    const r = mode(['Sum', 'L']);
    expect(r.run({ L: [1, 2, 3] })).toEqual(
      r.run({ L: [1, 2, 3].map((v) => ({ lo: v, hi: v })) })
    );
    expect(r.run({ L: [1, 2, 3] })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
    expect(mode(at).run({ x: { lo: 1, hi: 1.5 }, L })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 21 },
    });
  });

  test('a list result is an array of kinded results', () => {
    const r = mode(['Add', ['Multiply', 2, 'L'], 1]).run({ L: [1, { lo: 2, hi: 3 }] });
    expect(r).toEqual([
      { kind: 'interval', value: { lo: 3, hi: 3 } },
      { kind: 'interval', value: { lo: 5, hi: 7 } },
    ]);
    expect(mode(['Tuple', x, ['Multiply', 2, x]]).run({ x: 1 })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'interval', value: { lo: 2, hi: 2 } },
    ]);
    // The input list itself, returned: a copy of kinded results.
    expect(mode('L').run({ L: [1] })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
    ]);
  });

  test('broadcast() shares a list input between cells, as run() of each cell', () => {
    const r = mode(at);
    const cells = [0, 0.5, 1, 1.5, 0.5, 1.5, 5, 6];
    const out = r.broadcast!({ x: new Float64Array(cells), L });
    for (let k = 0; k < 4; k++) {
      const one = r.run({ x: { lo: cells[2 * k], hi: cells[2 * k + 1] }, L }) as Kinded;
      if (one.value) expect([out[3 * k], out[3 * k + 1]]).toEqual([one.value.lo, one.value.hi]);
    }
    // The last cell selects nothing.
    expect(Number.isNaN(out[9])).toBe(true);
  });

  test('the stored result, loaded with createIntervalRuntime()', () => {
    for (const json of [at, ['Add', ['Multiply', 2, 'L'], 1]]) {
      const r = mode(json);
      const stored = JSON.parse(JSON.stringify(r));
      const runtime = createIntervalRuntime();
      const box = { x: { lo: 0.5, hi: 1.5 }, L };
      expect(runtime.load(stored)(box)).toEqual(r.run(box));
      if (json === at) {
        const cells = { x: new Float64Array([0, 0.5, 1, 2.5]), L };
        expect(runtime.loadBroadcast(stored)(cells)).toEqual(r.broadcast!(cells));
      }
    }
  });

  test('a list whose length depends on the box is entire', () => {
    const filter = mode(['Filter', 'L', T(['Greater', 't', 0])]);
    expect(filter.run({ L: [1, { lo: -1, hi: 1 }] })).toEqual({ kind: 'entire' });
    expect(filter.run({ L: [1, -2, { lo: 2, hi: 3 }] })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'interval', value: { lo: 2, hi: 3 } },
    ]);
    const range = mode(['Comprehension', ['Multiply', 'k', x], ['Element', 'k', ['Range', 1, 'n']]]);
    expect(range.run({ x: 1, n: { lo: 1, hi: 5 } })).toEqual({ kind: 'entire' });
    expect((range.run({ x: 1, n: 3 }) as unknown[]).length).toBe(3);
    expect(mode(['Length', ['Range', 1, 'n']]).run({ n: { lo: 2, hi: 3 } })).toEqual({
      kind: 'entire',
    });
  });

  test('the budget does not count the elements of a list; 2^32 elements are entire', () => {
    const json = ['Map', T(['Multiply', 't', x]), ['Range', 1, 'n']];
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
      iterationBudget: 5,
    } as never) as unknown as Compiled;
    // As on the JavaScript target, a list longer than the budget is built.
    expect((r.run({ x: 1, n: 8 }) as unknown[]).length).toBe(8);
    // No array holds 2^32 elements: nothing is built.
    const start = Date.now();
    expect(r.run({ x: 1, n: 1e10 })).toEqual({ kind: 'entire' });
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('a root function literal of a list parameter', () => {
    const r = mode(['Function', ['Sum', 'A'], ['Typed', 'A', "'list<real>'"]]) as unknown as {
      run: (...a: unknown[]) => unknown;
      success: boolean;
    };
    if (!r.success) return;
    expect(r.run([1, { lo: 2, hi: 3 }])).toEqual({ kind: 'interval', value: { lo: 3, hi: 4 } });
  });
});

describe('the interval mode, Loop: the contract', () => {
  const budgeted = (json: Json, iterationBudget?: number) =>
    compile(ce.box(json as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
      iterationBudget,
    } as never) as unknown as Compiled & { preamblePerCall?: string };
  const existing = (json: Json, iterationBudget?: number) =>
    compile(ce.box(json as never), {
      to: 'interval-js',
      iterationBudget,
    } as never) as unknown as Compiled;
  /** The result of `f()`, or the name of the error that it throws. */
  const outcome = (f: () => unknown) => {
    try {
      return f();
    } catch (e) {
      return (e as Error).name;
    }
  };
  const upTo = (bound: Json, body: Json = addTo(x)) =>
    loopOf(['Loop', body, ['Element', 'k', ['Range', 1, bound, 1]]]);

  test('a bound that is not a point is entire, an empty range runs no pass', () => {
    const r = budgeted(upTo('n'));
    expect(r.run({ x: 1, n: 4 })).toEqual({ kind: 'interval', value: { lo: 4, hi: 4 } });
    expect(r.run({ x: 1, n: { lo: 2, hi: 4 } })).toEqual({ kind: 'entire' });
    expect(r.run({ x: 1, n: 0 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
  });

  test('the undecided If of a pass: the hull of both arms, the existing target entire', () => {
    const box = { x: { lo: -1, hi: 0.5 } };
    // At x = -1 the value is -3, at x = 0.5 it is 3.
    expect(budgeted(LOOP_IF).run(box)).toEqual({ kind: 'interval', value: { lo: -3, hi: 3 } });
    expect(existing(LOOP_IF).run(box)).toEqual({ kind: 'entire' });
  });

  test('a pass of a Loop counts one pass of the iterationBudget, as on the existing target', () => {
    const json = upTo('n');
    const r = budgeted(json, 5);
    expect(r.code).toContain('_IA.countLoopPass(5);');
    expect(r.preamblePerCall).toBe('_IA.resetLoopPasses();');
    for (const n of [5, 6, 5]) {
      const got = outcome(() => r.run({ x: 1, n }));
      expect(got).toEqual(outcome(() => existing(json, 5).run({ x: 1, n })));
      // The count starts again at each call.
      expect(got).toEqual(n === 5 ? { kind: 'interval', value: { lo: 5, hi: 5 } } : 'CancellationError');
    }
    // The stored result counts the same way.
    const stored = createIntervalRuntime().load(JSON.parse(JSON.stringify(r)));
    expect(outcome(() => stored({ x: 1, n: 6 }))).toBe('CancellationError');
    expect(stored({ x: 1, n: 5 })).toEqual({ kind: 'interval', value: { lo: 5, hi: 5 } });
    // Without a budget nothing is counted.
    expect(budgeted(json).code).not.toContain('countLoopPass');
  });

  test('with no value computed once, preamble holds the reset', () => {
    const json = ['Block', ['Declare', 't', "'real'", x], ['Loop', ['Assign', 't', ['Multiply', 't', x]], ['Element', 'k', ['Range', 1, 'n', 1]]], 't'];
    const r = budgeted(json, 5) as Compiled & { preamble?: string; preambleOnce?: string };
    expect(r.preamble).toBe('_IA.resetLoopPasses();');
    expect(r.preambleOnce).toBe('');
    // A host that evaluates `preamble` and `code` together at each call.
    const call = new Function('_IA', '_', `${r.preamble}\nreturn ${r.code};`);
    for (let k = 0; k < 10; k++)
      expect(call(IntervalArithmetic, { x: { lo: 2, hi: 2 }, n: { lo: 2, hi: 2 } })).toEqual({ kind: 'interval', value: { lo: 8, hi: 8 } });
    // Without a budget nothing is counted, and there is no preamble.
    const free = budgeted(json) as Compiled & { preamble?: string; preamblePerCall?: string };
    expect([free.preamble, free.preamblePerCall]).toEqual([undefined, undefined]);
  });

  test('the passes of nested Loops add up', () => {
    // 3 outer passes and 3 × 2 inner ones.
    const json = loopOf(['Loop', ['Loop', addTo(x), ['Element', 'j', ['Range', 1, 2]]], ['Element', 'k', ['Range', 1, 3]]]);
    expect(budgeted(json, 9).run({ x: 1 })).toEqual({ kind: 'interval', value: { lo: 6, hi: 6 } });
    expect(outcome(() => budgeted(json, 8).run({ x: 1 }))).toBe('CancellationError');
    expect(outcome(() => existing(json, 8).run({ x: 1 }))).toBe('CancellationError');
  });

  test('a call computed once counts its passes apart from the calls', () => {
    // `w(2)` is computed at the first call (8 passes), `w(x)` at each (8).
    const json = ['Add', ['w', x], ['w', 2]];
    const r = budgeted(json, 12);
    expect(r.preamblePerCall).toContain('_IA.resetLoopPasses();');
    for (let k = 0; k < 2; k++) expect((r.run({ x: 1 }) as Kinded).kind).toBe('interval');
    // The existing target counts the 16 passes of each call.
    expect(outcome(() => existing(json, 12).run({ x: 1 }))).toBe('CancellationError');
    // Over the budget alone, the value computed once throws at every call.
    const over = budgeted(json, 7);
    for (let k = 0; k < 2; k++) expect(outcome(() => over.run({ x: 1 }))).toBe('CancellationError');
  });

  test('a Loop whose values are not read is removed', () => {
    expect(budgeted(loopOf(['Loop', addTo(x), ['Element', 'k', ['Range', 1, 3]]], x)).code).toBe('_.x');
  });
});

describe('the interval mode, lists: declines', () => {
  ce.declare('Q', 'list<tuple<real, real>>');
  test.each([
    [['Range', 0.5, x], /a Range of a real operand on interval-js/],
    [['At', 'Q', ['Floor', x]], /an index that can be out of range/],
    [['Linspace', 0, 1, 5], /the operator Linspace is not in the slice/],
    [['RandomChoice', 'L', 2], /RandomChoice of another domain than Interval\(0, 1\)/],
    [['Comprehension', ['Multiply', 'j', 'k'], ['Element', 'j', ['Range', 1, 3]], ['Element', 'k', ['Range', 1, 3]]], /a list whose length is not one number/],
    // `Apply` over a list still declines where the interpreter does not map
    // a flat list: a nested list, a tuple, a literal of several parameters.
    [['Apply', K(['Multiply', 'k', x]), ['List', ['List', 1, 2], ['List', 3, 4]]], /a list or a tuple argument of Apply/],
    [['Apply', K(['Multiply', 'k', x]), 'P'], /a list or a tuple argument of Apply/],
    [['Apply', K(['Multiply', 'k', x]), ['Tuple', x, y]], /a list or a tuple argument of Apply/],
    [['Apply', ['Function', ['Add', 'j', 'k'], 'j', 'k'], 'L', x], /a list or a tuple argument of Apply/],
    // A `Loop` with an early exit declines in the pipeline.
    [loopOf(['Loop', ['If', ['Greater', 't', 3], ['Break'], addTo(x)], ['Element', 'k', ['Range', 1, 9]]]), /the operator Break is not in the slice/],
    [loopOf(['Loop', ['If', ['Greater', 't', 3], ['Continue'], addTo(x)], ['Element', 'k', ['Range', 1, 9]]]), /the operator Continue is not in the slice/],
    [loopOf(['Loop', ['If', ['Greater', 't', 3], ['Return', 't'], addTo(x)], ['Element', 'k', ['Range', 1, 9]]]), /Return/],
  ])('%j', (json, cause) => {
    expect(() => mode(json)).toThrow(cause);
  });
});

describe('the interval mode, lists: robustness', () => {
  test('a list of 10,000 elements read by At and reduced by Sum', () => {
    const big = new ComputeEngine();
    big.declare('x', 'real');
    big.declare('L', 'list<real^10000>');
    const json = ['Add', ['At', 'L', ['Add', ['Floor', x], 1]], ['Sum', 'L']];
    const start = Date.now();
    const r = mode(json, big);
    expect(Date.now() - start).toBeLessThan(1000);
    const L = Array.from({ length: 10_000 }, (_, k) => k);
    expect(r.run({ x: { lo: 2, hi: 2.5 }, L })).toEqual({
      kind: 'interval',
      value: { lo: 2 + 49_995_000, hi: 2 + 49_995_000 },
    });
    // The text does not grow with the length of the list.
    const small = new ComputeEngine();
    small.declare('x', 'real');
    small.declare('L', 'list<real^4>');
    expect(r.code.replace('10000', '4')).toBe(mode(json, small).code);
  });

  test('At of a vector of 90,001 integers', () => {
    const big = new ComputeEngine();
    big.declare('x', 'real');
    big.declare('H', 'vector<integer^90001>');
    const r = mode(['At', 'H', ['Add', ['Floor', x], 1]], big);
    const H = Array.from({ length: 90_001 }, (_, k) => 3 * k);
    expect(r.run({ x: 90_000, H })).toEqual({
      kind: 'interval',
      value: { lo: 270_000, hi: 270_000 },
    });
    expect(r.code.length).toBeLessThan(200);
  });
});

describe('the interval mode: a name whose held value is an expression', () => {
  // Tycho's three shapes (`neyret/lrpzqnemhy`, `neyret/urbddymicb`,
  // `neyret/oonx9mijy7`), reduced: the value is lowered where it is read.
  const e = new ComputeEngine();
  for (const name of ['x', 'x_1', 'x_2']) e.declare(name, 'real');
  e.declare('Rm', {
    type: 'list<real>',
    value: e.box(['Map', ['Function', ['Mod', ['Multiply', 10000, ['Sin', '_1']], 1], '_1'], ['Range', 0, 5]] as never),
  });
  e.declare('Px', { type: 'list<real^2>', value: e.box(['List', 'x_1', ['Multiply', 2, 'x_2']] as never) });
  e.assign('F', e.box(['Function', ['Add', ['At', 'Px', 'j'], 'j'], 'j'] as never));
  const E = (p: number) => ['Power', 'ExponentialE', ['Rational', p, 5]];
  e.declare('kE', { type: 'list<real>', value: e.box(['List', 1, E(2), E(4)] as never) });
  e.declare('ke', { type: 'real', value: e.box(E(2) as never) });
  const point = (v: number) => ({ lo: v, hi: v });

  test.each([
    ['A1', ['Sum', ['Multiply', ['At', 'Rm', 'k'], 'x'], ['Limits', 'k', 1, 6]]],
    ['A2', ['Add', ['F', 1], ['F', 2], 'x']],
    ['A3', ['Sum', ['Multiply', ['At', 'kE', 'j'], 'x'], ['Limits', 'j', 1, 3]]],
  ] as const)('%s: the interpreter value is in the box', (_, json) => {
    const r = mode(json, e);
    for (const p of [{ x: 0.3, x_1: 3, x_2: -1.25 }, { x: -2.5, x_1: -7, x_2: 0.5 }]) {
      // `withValues()`: the inputs that a held value reads take the point too.
      const values = Object.fromEntries(Object.entries(p).map(([k, n]) => [k, e.number(n)]));
      const v = e.withValues(values, () => e.box(json as never).evaluate().N().re);
      const got = r.run(Object.fromEntries(Object.entries(p).map(([k, n]) => [k, point(n)]))) as Kinded;
      expect(got.kind).toBe('interval');
      expect([v >= got.value!.lo, v <= got.value!.hi]).toEqual([true, true]);
    }
  });

  test('an exact constant is an enclosure of its value', () => {
    const got = mode(['Multiply', 'ke', 1], e).run({}) as Kinded;
    const d = Math.exp(0.4);
    expect(got.value!.lo).toBeLessThanOrEqual(nextDown(d));
    expect(got.value!.hi).toBeGreaterThanOrEqual(nextUp(d));
    expect(got.value!.lo).toBeGreaterThanOrEqual(step(d, 4, nextDown));
    expect(got.value!.hi).toBeLessThanOrEqual(step(d, 4, nextUp));
  });
});
