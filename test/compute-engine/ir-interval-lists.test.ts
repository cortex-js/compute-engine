/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batch 3: lists and tuples.
 *
 * Containment, as in `ir-interval-containment.test.ts`: at seeded random
 * boxes (a list input is an array of boxes, one per element), the
 * interpreter's value at points of the box is inside the result, element by
 * element for a list; a list result whose length is not one number is
 * `entire`. An end may miss by at most 2 ulps; the checks that need that
 * slack are counted.
 *
 * Then the result contract with list inputs and results, the declines of
 * the batch, and robustness. The `Loop` statement (over a `Range` or a list,
 * with carried locals) is in the cases too, and its contract (a bound that
 * is not a point, the `iterationBudget`) in its own section.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { sliceProgram } from '../../src/compute-engine/compilation/ir/index';
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

// Functions of scalar parameters, which a call maps over a list argument
// as the interpreter does: Tycho's `f(t) = Mod(t, 1)`.
ce.assign('md', ce.box(['Function', ['Mod', 't', 1], 't'] as never));
ce.assign(
  'g1',
  ce.box(['Function', ['Multiply', 't', ['Sin', 't']], 't'] as never)
);
ce.assign(
  'h2',
  ce.box([
    'Function',
    ['Add', ['Multiply', 'a', 'b'], ['Sin', 'b']],
    'a',
    'b',
  ] as never)
);

// Functions of untyped parameters whose result the engine infers as a list
// of `unknown` elements: the result is the shape of the lowered body.
// Tycho's `v(x, y) = [x, y]`, `H(t) = C(t + [3, 2, 1]/3)` (a mapped call)
// and `R(p, φ)`, whose parameter p the body reads as a list.
ce.assign('vv', ce.box(['Function', ['List', 'a', 'b'], 'a', 'b'] as never));
// prettier-ignore
ce.assign('CC', ce.box(['Function', ['Which', ['Less', 't', 0], 0, ['Less', 1, 't'], 1, 'True', 't'], 't'] as never));
// prettier-ignore
ce.assign('HH', ce.box(['Function', ['CC', ['Add', ['Abs', ['Add', ['Multiply', 6, ['Mod', ['Add', 't', ['Multiply', ['Rational', 1, 3], ['List', 3, 2, 1]]], 1]], -3]], -1]], 't'] as never));
// prettier-ignore
ce.assign('RR', ce.box(['Function', ['List', ['Sum', ['Multiply', 'p', ['List', ['Cos', 'r'], ['Negate', ['Sin', 'r']]]]], ['Sum', ['Multiply', 'p', ['List', ['Sin', 'r'], ['Cos', 'r']]]]], 'p', 'r'] as never));

/** The length of each list input of the containment cases. */
const LENGTHS: Record<string, number> = { L: 4, V: 3, B: 200, P: 2, U2: 2, W2: 2, U16: 16, U17: 17 };

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
  // A `Comprehension` of two clauses over constant ranges (Tycho's
  // `min([T(x, y, i, j) for j = [0...1], i = [0...1]]) - 0.3`), and one
  // constant range with one of a run-time length.
  C(['Comprehension', ['Multiply', 'j', 'k', x], ['Element', 'j', ['Range', 1, 3]], ['Element', 'k', ['Range', 1, 3]]]),
  C(['Add', ['Min', ['Comprehension', ['Add', ['Multiply', 'i', x], ['Multiply', 'j', y]], ['Element', 'j', ['Range', 0, 1]], ['Element', 'i', ['Range', 0, 1]]]], -0.3]),
  C(['Sum', ['Comprehension', ['Multiply', 'j', 'k', x], ['Element', 'j', ['Range', 1, 'n']], ['Element', 'k', ['Range', 1, 3]]]]),
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
  // CE-1344 with its `Map` control.
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
  // A list argument of a function of scalar parameters: the function
  // mapped over the list, a scalar passed to each call, lists of one
  // length zipped; read by a reduction and by `At`.
  C(['md', ['List', ['Negate', x], ['Negate', y]]], [0, 1]), C(['g1', 'L']), C(['Sum', ['g1', 'V']]),
  C(['h2', x, 'V']), C(['h2', 'V', 'V']), C(['h2', list3, y]), C(['w', 'V']),
  C(['At', ['g1', list3], ['Add', ['Floor', y], 1]], [0, 1, 2, 3]),
  // A result of the shape of the body (untyped parameters): read by `At`
  // and `Sum`, a mapped call as the body, a list bound whole.
  C(['At', ['vv', x, y], 2]), C(['Sum', ['Multiply', ['vv', x, y], ['List', 0.64, 0.768]]]),
  C(['At', ['HH', x], 1]), C(['Sum', ['HH', x]]),
  C(['Sum', ['Power', ['RR', ['Add', ['vv', x, y], ['List', -0.57, 2.8]], y], 2]]),
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
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    for (const b of boxes(expr, c.centres ?? [], rnd)) {
      const got = r.run(b);
      for (const point of pointsOf(b, rnd))
        failures.push(
          ...contains(got, interpret(expr, point), label, JSON.stringify(point))
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

  test('the undecided If of a pass: the hull of both arms', () => {
    const box = { x: { lo: -1, hi: 0.5 } };
    // At x = -1 the value is -3, at x = 0.5 it is 3.
    expect(budgeted(LOOP_IF).run(box)).toEqual({ kind: 'interval', value: { lo: -3, hi: 3 } });
  });

  test('a pass of a Loop counts one pass of the iterationBudget', () => {
    const json = upTo('n');
    const r = budgeted(json, 5);
    expect(r.code).toContain('_IA.countLoopPass(5);');
    expect(r.preamblePerCall).toBe('_IA.resetLoopPasses();');
    for (const n of [5, 6, 5]) {
      const got = outcome(() => r.run({ x: 1, n }));
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
  });

  test('a call computed once counts its passes apart from the calls', () => {
    // `w(2)` is computed at the first call (8 passes), `w(x)` at each (8).
    const json = ['Add', ['w', x], ['w', 2]];
    const r = budgeted(json, 12);
    expect(r.preamblePerCall).toContain('_IA.resetLoopPasses();');
    for (let k = 0; k < 2; k++) expect((r.run({ x: 1 }) as Kinded).kind).toBe('interval');
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
    [['Linspace', 0, 1, 5], /the operator Linspace is not supported by the compiler/],
    [['RandomChoice', 'L', 2], /RandomChoice of another domain than Interval\(0, 1\)/],
    // Two clauses whose counts are both run-time values: the length of the
    // list has no bound below 2^53.
    [['Comprehension', ['Multiply', 'j', 'k'], ['Element', 'j', ['Range', 1, 'n']], ['Element', 'k', ['Range', 1, 'n']]], /a list whose length is not one number/],
    // `Apply` over a list still declines where the interpreter does not map
    // a flat list: a nested list, a tuple.
    [['Apply', K(['Multiply', 'k', x]), ['List', ['List', 1, 2], ['List', 3, 4]]], /a list or a tuple argument of Apply/],
    [['Apply', K(['Multiply', 'k', x]), 'P'], /a list or a tuple argument of Apply/],
    [['Apply', K(['Multiply', 'k', x]), ['Tuple', x, y]], /a list or a tuple argument of Apply/],
    // A `Break` that is not a statement of a `Loop` body, and a `Return`,
    // decline in the pipeline.
    [loopOf(['Loop', addTo(['If', ['Greater', 't', 3], ['Break'], x]), ['Element', 'k', ['Range', 1, 9]]]), /a Break that is not a statement of a Loop body/],
    [['If', ['Greater', x, 3], ['Continue'], x], /a Continue that is not a statement of a Loop body/],
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
    // The text does not grow with the length of the list, past the short
    // lists (of at most 16 elements, which are written out).
    const small = new ComputeEngine();
    small.declare('x', 'real');
    small.declare('L', 'list<real^17>');
    expect(r.code.replace('10000', '17')).toBe(mode(json, small).code);
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

describe('the interval mode, lists: the short lists', () => {
  // A list of a constant length of at most 16 elements is written out
  // (README, "Lists", the short lists).
  ce.declare('U2', 'list<real^2>');
  ce.declare('W2', 'list<real^2>');
  ce.declare('U16', 'list<real^16>');
  ce.declare('U17', 'list<real^17>');
  const ones = (n: number) => Array.from({ length: n }, (_, k) => k + 1);
  const fn = (name: string, body: Json, ...params: string[]) =>
    ce.assign(name, ce.box(['Function', body, ...params] as never));
  // `ccoc40kfhj`'s shape: an element-wise operation of 3 elements.
  fn('tri', ['Cos', ['Add', 't', ['List', 0, 1, 2]]], 't');
  fn('pair', ['List', 't', ['Multiply', 2, 't']], 't');
  // A loop in the body (a sum of more passes than `unrollSums`).
  fn('looped', ['List', ['Sum', ['Multiply', 'k', 't'], ['Limits', 'k', 1, 200]], 't'], 't');
  fn('long', ['Add', 't', ['List', ...ones(17)]], 't');
  fn('hulled', ['List', ['If', ['Greater', 't', 0], 't', ['Negate', 't']], 't'], 't');
  ce.declare('cyc', '(real, integer) -> real');
  fn('cyc', ['If', ['LessEqual', 'm', 0], ['At', ['pair', 't'], 2], ['cyc', ['Add', 't', 1], ['Subtract', 'm', 1]]], 't', 'm');

  /** The compiled `json`, and the failures of containment at the first
   *  `n` boxes. */
  const check = (
    json: Json,
    n = 24
  ): [Compiled & { preamble?: string }, string[]] => {
    const expr = ce.box(json as never);
    const r = mode(json);
    const label = JSON.stringify(json);
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    for (const b of boxes(expr, [], rnd).slice(0, n))
      for (const point of pointsOf(b, rnd))
        failures.push(
          ...contains(r.run(b), interpret(expr, point), label, JSON.stringify(point))
        );
    return [r, failures.slice(0, 5)];
  };
  const text = (r: Compiled & { preamble?: string }) =>
    `${r.code}\n${r.preamble ?? ''}`;
  const loop = /for \(let (v\d+) = \1_lo; \1 <= \1_hi; \1\+\+\) \{/;

  test('a sum of a list of 2 or of 16 is written out from its first element; of 17 it is a loop', () => {
    const [r2, f2] = check(['Sum', 'U2']);
    expect(r2.code).toBe('_IA.add(_.U2[0], _.U2[1])');
    const [r16, f16] = check(['Sum', 'U16']);
    expect(r16.code).not.toMatch(loop);
    expect(r16.code.match(/_IA\.add\(/g)).toHaveLength(15);
    const [r17, f17] = check(['Sum', 'U17']);
    expect(r17.code).toMatch(loop);
    expect([...f2, ...f16, ...f17]).toEqual([]);
  });

  test('an element-wise product of two short lists, then a Sum', () => {
    const [r, failures] = check(['Sum', ['Multiply', 'U2', 'W2']]);
    expect(r.code).toBe(
      '_IA.add(_IA.mul(_.U2[0], _.W2[0]), _IA.mul(_.U2[1], _.W2[1]))'
    );
    expect(failures).toEqual([]);
  });

  test('At of a constant index of a short list result computes that element only', () => {
    const [r, failures] = check(['At', ['tri', x], 2]);
    // The call is copied, and the two other cosines are not computed.
    expect(r.code).toMatch(/^_IA\.cos\(_IA\.add\(_\.x, v\d+\)\)$/);
    expect(text(r).match(/_IA\.cos\(/g)).toHaveLength(1);
    expect(failures).toEqual([]);
  });

  test('a call whose result is a short list is copied; with a loop in its body or 17 elements, it stays a call', () => {
    const [pair, f1] = check(['At', ['pair', x], 2]);
    expect(text(pair)).not.toMatch(/u\d+_pair/);
    const [looped, f2] = check(['At', ['looped', x], 2]);
    expect(looped.code).toMatch(/u\d+_looped\(_\.x\)/);
    const [long, f3] = check(['At', ['long', x], 2]);
    expect(long.code).toMatch(/u\d+_long\(_\.x\)/);
    expect([...f1, ...f2, ...f3]).toEqual([]);
  });

  test('nothing is copied into a function on a cycle of calls', () => {
    const [r, failures] = check(['cyc', x, 2]);
    expect(r.code).toMatch(/u\d+_cyc\(_\.x, /);
    expect(r.preamble).toMatch(/u\d+_pair\(v\d+\)/);
    expect(failures).toEqual([]);
  });

  test('a Reduce with an initial value starts from it, written out or in a loop', () => {
    const failures = [
      ['Reduce', 'V', 'Add', 10],
      ['Reduce', 'V', 'Max', 10],
      ['Reduce', 'V', 'Multiply', 10],
      ['Reduce', 'V', 'Add', x],
      ['Reduce', 'U17', 'Add', 10],
    ].flatMap((json) => check(json)[1]);
    expect(failures).toEqual([]);
    expect(mode(['Reduce', 'V', 'Add', 10]).run({ V: [1, 2, 3] })).toEqual({
      kind: 'interval',
      value: { lo: 16, hi: 16 },
    });
    expect(mode(['Reduce', 'U17', 'Add', 10]).code).toMatch(loop);
  });

  test('three levels of builds of 16 elements: the inner ones past the cap keep their loop', () => {
    const level = (body: Json, v: string) => ['Sum', ['Map', ['Function', body, v], 'U16']];
    const json = level(level(level(['Multiply', 's', 't', 'u'], 'u'), 't'), 's');
    const [r, failures] = check(json, 4);
    expect(r.code).toMatch(/for \(let /);
    expect(failures).toEqual([]);
  });

  test('with passes: false, the mode runs no pass', () => {
    const lists = (options: object) => {
      const p = sliceProgram(ce.box(['Multiply', 'U2', 'W2'] as never), {
        target: 'javascript',
        mode: 'interval',
        ...options,
      } as never);
      const entry = p.functions.find((f) => f.name === p.entry)!;
      return entry.body.body.filter((i) => i.k === 'list').length;
    };
    // `scalarize` writes the product one element at a time; with no pass it
    // stays one element-wise operation.
    expect(lists({})).toBe(1);
    expect(lists({ passes: false })).toBe(0);
  });

  test('a list of a run-time length is not written out', () => {
    const [r, failures] = check(['Sum', 'L']);
    expect(r.code).toMatch(loop);
    expect(r.code).toContain('_.L.length');
    expect(failures).toEqual([]);
  });

  test('an undecided If in a copied body keeps its hull', () => {
    const [r, failures] = check(['At', ['hulled', x], 1]);
    expect(text(r)).not.toMatch(/u\d+_hulled/);
    expect(r.code).toContain('_IA.hull(');
    // The hull of x on [0, 2] and of -x on [-0, 1].
    const { kind, value } = r.run({ x: { lo: -1, hi: 2 } }) as Kinded;
    expect(kind).toBe('interval');
    expect(value!.lo === 0 && value!.hi === 2).toBe(true);
    expect(failures).toEqual([]);
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
