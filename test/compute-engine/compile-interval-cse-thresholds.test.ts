/**
 * Target-aware admission thresholds of the common-subexpression harvest.
 *
 * The harvest's defaults (`CSE_MIN_SIZE` 4, `CSE_MIN_SCORE` 8) measure the
 * cost of a JavaScript expression, where a size-3 `1/n` is one division and a
 * temporary saves nothing. The interval target lowers every operation to a
 * library call that allocates its result — `1/n` is `_IA.div(_k1, _.n)` — so
 * it declares lower thresholds (`CompileTarget.cseMinSize`, `cseMinScore`) and
 * binds such a node once. The Tycho code-generation audit of 0.128.9 counted
 * one reciprocal 48 times across the two helper bodies of a Voronoi cell
 * distance (record 584).
 *
 * The spine of every case is that the ENCLOSURE is unchanged: a temporary
 * changes how many times a value is computed, never what it is.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  CSE_MIN_SCORE,
  CSE_MIN_SIZE,
} from '../../src/compute-engine/compilation/cse';
import { IntervalJavaScriptTarget } from '../../src/compute-engine/compilation/interval-javascript-target';

const ce = new ComputeEngine();
for (const s of ['x', 'y', 'n', 'h']) ce.declare(s, 'real');

const fn = (body: unknown, ...params: string[]) =>
  ce.expr(['Function', body, ...params.map((p) => ['Typed', p, 'real'])]);
const def = (name: string, body: unknown, ...params: string[]): void => {
  ce.declare(name, 'function');
  ce.assign(name, fn(body, ...params));
};

// A Voronoi-like cell distance: q(v) = floor(n·v)/n at five offsets.
const q = (v: unknown) => [
  'Multiply',
  ['Divide', 1, 'n'],
  ['Floor', ['Multiply', 'n', v]],
];
const d = (a: unknown, b: unknown) => [
  'Add',
  ['Square', ['Subtract', 'x', a]],
  ['Square', ['Subtract', 'y', b]],
];
def(
  'm',
  [
    'Min',
    d(q('x'), q('y')),
    d(q(['Add', 'x', 'h']), q('y')),
    d(q('x'), q(['Add', 'y', 'h'])),
    d(q(['Subtract', 'x', 'h']), q('y')),
    d(q('x'), q(['Subtract', 'y', 'h'])),
  ],
  'x',
  'y'
);

const ARGS = {
  x: { lo: 0.31, hi: 0.32 },
  y: { lo: 0.57, hi: 0.58 },
  n: { lo: 7, hi: 7 },
  h: { lo: 0.01, hi: 0.01 },
};

function intervalCompiled(json: unknown, cse = true) {
  const r = compile(ce.box(json), { to: 'interval-js', fallback: false, cse });
  expect(r.success).toBe(true);
  const source = (r.preamble ?? '') + r.code;
  const v: any = r.run!(ARGS);
  return { source, value: v.value ?? v };
}

const reciprocals = (source: string): number =>
  (source.match(/_IA\.div\(_k\d+, _\.n\)/g) ?? []).length;

describe('Interval target — small repeated operations are bound', () => {
  test('the interval target declares thresholds below the defaults', () => {
    const target = new IntervalJavaScriptTarget().createTarget({});
    expect(target.cseMinSize).toBeLessThan(CSE_MIN_SIZE);
    expect(target.cseMinScore).toBeLessThan(CSE_MIN_SCORE);
  });

  test('a reciprocal repeated in a helper body is computed once', () => {
    const json = ['m', 'x', 'y'];
    const shared = intervalCompiled(json);
    const inline = intervalCompiled(json, false);
    expect(reciprocals(inline.source)).toBe(10);
    expect(reciprocals(shared.source)).toBe(1);
    // The enclosure is the same value, endpoint for endpoint.
    expect(shared.value).toEqual(inline.value);
  });

  test('a reciprocal repeated at the root is computed once', () => {
    // Three occurrences of the size-3 node `1/n`.
    const json = [
      'Add',
      ['Sin', ['Divide', 1, 'n']],
      ['Cos', ['Divide', 1, 'n']],
      ['Floor', ['Divide', 1, 'n']],
    ];
    const shared = intervalCompiled(json);
    const inline = intervalCompiled(json, false);
    expect(reciprocals(inline.source)).toBe(3);
    expect(reciprocals(shared.source)).toBe(1);
    expect(shared.value).toEqual(inline.value);
  });

  test('the JavaScript target keeps its defaults: a size-3 division stays inline', () => {
    const r = compile(ce.box(['m', 'x', 'y']), { fallback: false });
    expect(r.success).toBe(true);
    const source = (r.preamble ?? '') + r.code;
    expect(source).not.toMatch(/_cse\d+ = 1 \/ _\.n/);
  });
});
