/**
 * The pass `cse` of the profile `ir` merges an instruction with regions (a
 * `build`, a `filter`, a `loop`, an `if`, a region row) with an earlier
 * visible one of the same structure (CE-1373; README of
 * `src/compute-engine/compilation/ir/`, "Effects"): a list or a sum that the
 * program writes several times is computed once. One that is effectful (a
 * draw), that reads other values, that differs in a constant, or that is
 * in another arm of an `If` is not merged.
 *
 * The values: against the interpreter on JavaScript, and by containment in
 * the interval mode.
 */

import { compile } from '../../src/compile';
import { agrees, interpret, makeEngine, type Point } from './ir-slice-oracle';

type Json = unknown;
type Kinded = { kind: string; value?: { lo: number; hi: number } };

const ce = makeEngine();
ce.declare('P', 'list<real>');
ce.declare('S', 'list<real^4>');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json) => ce.box(json as never);
const js = (json: Json) => compile(box(json), IR);

/** The number of matches of `re` in `text`. */
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

const P20 = Array.from({ length: 20 }, (_, k) => Math.sin(k + 1) * (k - 7));
const POINTS: Point[] = [
  { x: 0.7, y: -1.5, P: P20 },
  { x: -2, y: 3, P: [0.5, -2, 3, 1.25] },
  { x: 0, y: 0, P: [] },
];

/** The compiled value agrees with the interpreter's at each point. */
function check(json: Json, r = js(json)) {
  for (const p of POINTS) {
    const want = interpret(ce, box(json), p);
    expect(want).not.toBe('engine-error');
    expect([json, p, agrees(r.run(p), want)]).toEqual([json, p, true]);
  }
  return r;
}

/** `Comprehension(body, i ∈ 1..2·Length(P))` */
const comp = (body: Json): Json => [
  'Comprehension',
  body,
  ['Element', 'i', ['Range', 1, ['Multiply', 2, ['Length', 'P']]]],
];
const half = (c: Json): Json => [
  'Multiply',
  c,
  ['At', 'P', ['Ceil', ['Divide', 'i', 2]]],
];
const X = comp(half(3));
const SUM = [
  'Sum',
  ['Multiply', 'k', ['At', 'P', 'k']],
  ['Limits', 'k', 1, ['Length', 'P']],
];
const MAP = (body: Json): Json => ['Map', ['Function', body, 'u'], 'P'];
const MIN = ['Min', MAP(['Multiply', 'u', ['Sin', 'u']])];
const POSITIVE = ['At', 'P', ['Greater', 'P', 0]];
const NESTED = MAP([
  'Sum',
  ['Multiply', 'u', ['At', 'P', 'k']],
  ['Limits', 'k', 1, ['Length', 'P']],
]);

describe('merged: one loop, the interpreter’s value', () => {
  test('the reduced witness: X + X·X builds X once', () => {
    const r = check(['Add', X, ['Multiply', X, X]]);
    expect(count(r.code, /Math\.ceil/g)).toBe(1);
  });

  test('a Sum written twice', () => {
    const r = check(['Add', SUM, ['Sin', SUM]]);
    expect(count(r.code, /_at\(/g)).toBe(1);
  });

  test('Min(Map(…)) written twice', () => {
    const r = check(['Add', MIN, ['Multiply', 2, MIN]]);
    expect(count(r.code, /Math\.sin/g)).toBe(1);
  });

  test('two reductions share a filter without building the filtered list', () => {
    const r = check(['Add', ['Sum', POSITIVE], ['Max', POSITIVE]]);
    expect(r.code).not.toContain('.push(');
    expect(count(r.code, /0 < _\.P\[/g)).toBe(1);
    expect(count(r.code, /\bif \(\w+\[\w+\]\)/g)).toBe(1);
  });

  test('a build with a loop in its body, written twice', () => {
    const r = check(['Add', ['Sum', NESTED], ['Max', NESTED]]);
    expect(count(r.code, /_at\(/g)).toBe(1);
  });
});

describe('not merged', () => {
  test('a draw in the body: two draws per element, as the interpreter', () => {
    const D = MAP(['Multiply', 'u', ['Random']]);
    const json = ['WithRandomSeed', 3, ['Subtract', D, D]];
    const r = js(json);
    expect(count(r.code, /drawNextRandomNumber/g)).toBe(2);
    const got = r.run({ P: [1, 2, 3] }) as number[];
    const want = interpret(ce, box(json), { P: [1, 2, 3] }) as number[];
    expect(got.some((v) => v !== 0)).toBe(true);
    expect(want.some((v) => v !== 0)).toBe(true);
  });

  test('bodies that read different outer values', () => {
    const r = check(['Add', comp(half('x')), comp(half('y'))]);
    expect(count(r.code, /Math\.ceil/g)).toBe(2);
  });

  test('bodies that differ in one constant', () => {
    const r = check(['Add', X, comp(half(4))]);
    expect(count(r.code, /Math\.ceil/g)).toBe(2);
  });

  test('in the two arms of an If: one build in each arm', () => {
    const r = check(['If', ['Greater', 'x', 0], ['Sum', X], ['Max', X]]);
    expect(count(r.code, /Math\.ceil/g)).toBe(2);
  });

  test('a Loop that assigns a local, written twice: two passes over P', () => {
    const loop = [
      'Loop',
      ['Assign', 's', ['Add', 's', ['At', 'P', 'k']]],
      ['Element', 'k', ['Range', 1, ['Length', 'P']]],
    ];
    const r = check(['Block', ['Declare', 's', "'real'", 0], loop, loop, 's']);
    expect(count(r.code, /_at\(/g)).toBe(2);
  });
});

describe('more merges and their limits', () => {
  const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];

  test('two Maps that differ in the name of their parameter are one loop', () => {
    const over = (u: string) => [
      'Sum',
      ['Map', fn(['Sin', ['Multiply', 3, u, 'x']], u), 'P'],
    ];
    const r = check(['Add', over('u'), ['Cos', over('w')]]);
    expect(count(r.code, /Math\.sin\(/g)).toBe(1);
  });

  test('a copy in an arm of an If and a copy after it: the values', () => {
    const h = [
      'Sum',
      ['Divide', 1, ['Add', 'k', 'x']],
      ['Limits', 'k', 1, ['Length', 'P']],
    ];
    check(['Add', ['If', ['Greater', 'x', 0], h, 0], h]);
    check(['Add', h, ['If', ['Greater', 'x', 0], h, 0]]);
  });

  test('an integral written twice is one quadrature', () => {
    const integral = [
      'Integrate',
      fn(['Exp', ['Negate', ['Multiply', 't', 't', 'y', 'y']]], 't'),
      ['Limits', 't', 0, 'x'],
    ];
    const r = check(['Add', integral, ['Cos', integral]]);
    expect(count(r.code, /_SYS\.irIntegrate\(/g)).toBe(1);
  });
});

describe('the other targets', () => {
  test('the interval mode: the merged witness contains the value', () => {
    const json = ['Sum', ['Add', X, ['Multiply', X, X]]];
    const r = compile(box(json), { ...IR, to: 'interval-js' });
    expect(count(r.code, /_IA\.ceil/g)).toBe(1);
    // Not at the empty list, where `Range(1, 0)` reads out of range.
    for (const p of POINTS.slice(0, 2)) {
      const want = interpret(ce, box(json), p) as number;
      const got = r.run(p) as Kinded;
      expect(got.kind).toBe('interval');
      expect(got.value!.lo <= want && want <= got.value!.hi).toBe(true);
    }
  });

  test('GLSL: a build written twice is written out once, a Sum written twice is one loop', () => {
    const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });
    const over = (l: string) => [
      'Comprehension',
      ['Multiply', 3, ['At', l, 'i']],
      ['Element', 'i', ['Range', 1, ['Length', l]]],
    ];
    // `Range(1, Length(S))` of `S: list<real^4>` has the constant length 4
    // (CE-1587): the build is the list of its 4 elements, each made once.
    const built = glsl(['Sum', ['Add', over('S'), over('S')]]);
    expect(built.success).toBe(true);
    expect(count(built.code, /3\.0 \* S\[/g)).toBe(4);
    const sum = [
      'Sum',
      ['Multiply', 'k', ['Sin', ['Multiply', 'k', 'x']]],
      ['Limits', 'k', 1, 'n'],
    ];
    const r = glsl(['Add', sum, ['Cos', sum]]);
    expect(count(r.code, /for \(/g)).toBe(1);
  });
});
