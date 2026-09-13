/**
 * A literal index pushed through an element-wise selection, and a selection
 * over a wide list-shaped condition written out per position.
 *
 * The Tycho code-generation audit document `ccoc40kfhj` writes a colour
 * channel as `Which(|6((x + [3, 2, 1]/3) mod 1) − 3| − 1 < 0, 0, …)[1]`:
 * a `Which` broadcast over a three-element list, read back at one index.
 * The interval target has no element-wise selection at all and the shader
 * targets have no run-time list to index, so 24 records declined. The
 * pre-pass (`fixed-width-unroll.ts`) now pushes the index through the
 * selection, the relations, `Mod`, `Abs` and the arithmetic down to the
 * literal list — and through a literal `Range` — so the row is one scalar
 * selection every target compiles.
 *
 * Two further changes of the same round: a `Which`/`If` whose FIRST
 * condition is a wide list built from non-constant lists is written out as
 * the literal list of its per-position selections (rule 7), and the
 * JavaScript run-time selection lifts a POINT arm whole — it used to read
 * the point's array as a list arm of the wrong length and answer `NaN`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { unrollFixedWidthCollections } from '../../src/compute-engine/compilation/fixed-width-unroll';

const ce = new ComputeEngine();
for (const s of ['x', 'u', 'v', 'a', 'b', 'c', 'd', 'e']) ce.declare(s, 'real');
ce.declare('L', 'list<number>');
ce.declare('P', 'tuple<real, real>');

const ROW = String.raw`\begin{cases}0&\vert6((x+\bigl\lbrack3, 2, 1\bigr\rbrack/3)\bmod1)-3\vert-1\lt0\\1&1\lt\vert6((x+\bigl\lbrack3, 2, 1\bigr\rbrack/3)\bmod1)-3\vert-1\\\vert6((x+\bigl\lbrack3, 2, 1\bigr\rbrack/3)\bmod1)-3\vert-1&\top\end{cases}`;
const K = String.raw`(0.5\cos(2\pi\begin{cases}\frac{-1}{2}&(3x)/2-\bigl\lbrack0, 1/2, 1, 3/2\bigr\rbrack\lt-1/2\\\frac{1}{2}&1/2\lt(3x)/2-\bigl\lbrack0, 1/2, 1, 3/2\bigr\rbrack\\(3x)/2-\bigl\lbrack0, 1/2, 1, 3/2\bigr\rbrack&\top\end{cases})+0.5)`;

/** The interpreter's value of `latex` at `x`, as a machine number. */
function interpreted(latex: string, x: number): number {
  return ce.parse(latex).subs({ x: ce.number(x) }).N().re as number;
}

function expectAllTargetsAgree(latex: string, xs: number[]): void {
  const expr = ce.parse(latex);
  for (const to of ['interval-js', 'javascript', 'glsl', 'wgsl'] as const) {
    const r = compile(expr, { to, fallback: false });
    expect([to, r.success, r.error?.message]).toEqual([to, true, undefined]);
  }
  const js = compile(expr, { fallback: false });
  for (const x of xs)
    expect(js.run!({ x })).toBeCloseTo(interpreted(latex, x), 10);
}

describe('A literal index pushed through an element-wise selection', () => {
  test('the audit colour-channel row compiles on every target', () => {
    expectAllTargetsAgree(ROW + '[1]', [0.1, 0.4, 0.7]);
    expectAllTargetsAgree(ROW + '[2]+0.02', [0.1, 0.4, 0.7]);
    expectAllTargetsAgree(ROW + '[3]-0.02', [0.1, 0.4, 0.7]);
  });

  test('the ratio of two indexed selections', () => {
    expectAllTargetsAgree(String.raw`\frac{${ROW}[1]}{${ROW}[2]}-1.5`, [
      0.1, 0.4,
    ]);
  });

  test('a selection under a cosine, read at two indices', () => {
    expectAllTargetsAgree(`${K}[1]+${K}[4]+4.5`, [0.1, 0.4]);
  });

  test('the row is one scalar selection: no run-time list', () => {
    const js = compile(ce.parse(ROW + '[2]'), { fallback: false });
    expect(js.code).not.toContain('_SYS.select');
    expect(js.code).not.toContain('_SYS.bcast');
    expect(js.code).not.toContain('[');
  });

  test('the index reads the k-th element of a literal range', () => {
    // `Which(|v·(1..3)/3| < 1, u, True, 0)[2]` is `Which(|2v/3| < 1, u, True, 0)`.
    const expr = ce.box([
      'At',
      [
        'Which',
        ['Less', ['Abs', ['Divide', ['Multiply', 'v', ['Range', 1, 3]], 3]], 1],
        'u',
        'True',
        0,
      ],
      2,
    ]);
    const pre = unrollFixedWidthCollections(expr);
    expect(pre.operator).toBe('Which');
    expect(JSON.stringify(pre.json)).not.toContain('Range');
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 5, v: 1.2 })).toBe(5);
    expect(r.run!({ u: 5, v: 1.6 })).toBe(0);
  });

  test('the relations and Mod are walked, the equality only against a scalar', () => {
    const at = (json: unknown) =>
      unrollFixedWidthCollections(ce.box(['At', json, 2]));
    expect(at(['Mod', ['Add', 'x', ['List', 'a', 'b', 'c']], 3]).json).toEqual(
      ['Mod', ['Add', 'x', 'b'], 3]
    );
    expect(at(['Less', ['List', 'a', 'b', 'c'], 'x']).json).toEqual([
      'Less',
      'b',
      'x',
    ]);
    // Canonicalization spells `a ≥ b` as `b ≤ a`.
    expect(
      at(['GreaterEqual', ['List', 'a', 'b', 'c'], ['List', 'd', 'e', 'x']])
        .json
    ).toEqual(['LessEqual', 'e', 'b']);
    expect(at(['Equal', ['List', 'a', 'b', 'c'], 'x']).json).toEqual([
      'Equal',
      'b',
      'x',
    ]);
    // Two lists are compared as WHOLE values by `Equal`: not walked.
    const whole = ce.box([
      'At',
      ['Equal', ['List', 'a', 'b', 'c'], ['List', 'd', 'e', 'x']],
      2,
    ]);
    expect(unrollFixedWidthCollections(whole)).toBe(whole);
  });

  test('a scalar first condition is not walked', () => {
    // When `x > 0` holds the interpreter answers the arm `5` WHOLE, and an
    // index into a scalar is its own answer, not `5`.
    const expr = ce.box([
      'At',
      ['Which', ['Greater', 'x', 0], 5, 'True', ['List', 'a', 'b', 'c']],
      2,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  test('a later scalar condition lifts to every position', () => {
    const expr = ce.box([
      'At',
      [
        'Which',
        ['Less', ['List', 'a', 'b', 'c'], 2],
        0,
        ['Greater', 'x', 0],
        1,
        'True',
        2,
      ],
      3,
    ]);
    // Canonicalization spells `x > 0` as `0 < x`.
    expect(unrollFixedWidthCollections(expr).json).toEqual([
      'Which',
      ['Less', 'c', 2],
      0,
      ['Less', 0, 'x'],
      1,
      'True',
      2,
    ]);
  });

  test('a point arm with no default clause is not walked', () => {
    // Element-wise, a position no clause selects is NaN; a scalar selection
    // with no default answers Missing, which lowers differently for a point.
    const expr = ce.box([
      'At',
      ['Which', ['Less', ['List', 'a', 'b', 'c'], 2], ['Tuple', 'u', 'v']],
      2,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
    // With a default clause the point lifts whole and the index is pushed.
    const withDefault = ce.box([
      'At',
      [
        'Which',
        ['Less', ['List', 'a', 'b', 'c'], 2],
        ['Tuple', 'u', 'v'],
        'True',
        ['Tuple', 0, 0],
      ],
      2,
    ]);
    expect(unrollFixedWidthCollections(withDefault).json).toEqual([
      'Which',
      ['Less', 'b', 2],
      ['Tuple', 'u', 'v'],
      'True',
      ['Tuple', 0, 0],
    ]);
  });

  test('an impure clause stops the walk', () => {
    const expr = ce.box([
      'At',
      ['Which', ['Less', ['List', 'a', 'b', 'c'], 2], ['Random'], 'True', 0],
      2,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  test('a head the caller overrode stops the walk', () => {
    const expr = ce.box([
      'At',
      ['Which', ['Less', ['Abs', ['List', 'a', 'b', 'c']], 2], 1, 'True', 0],
      2,
    ]);
    expect(
      unrollFixedWidthCollections(expr, { skipHeads: new Set(['Abs']) })
    ).toBe(expr);
  });
});

describe('A selection over a wide list-shaped condition is written out', () => {
  const WIDE = ['Less', ['Add', 'x', ['List', 'a', 'b', 'c', 'd', 'e']], 4];
  const VARS = { x: 1, a: 1, b: 2, c: 3, d: 4, e: 5, u: 7, v: 8 };
  const interpretedList = (json: unknown) =>
    [
      ...(ce
        .box(json)
        .subs(
          Object.fromEntries(
            Object.entries(VARS).map(([k, n]) => [k, ce.number(n)])
          )
        )
        .evaluate() as any).each(),
    ].map((e: any) => e.re as number);

  test('five scalar selections, no run-time selection', () => {
    const expr = ce.box(['Which', WIDE, 1, 'True', 0]);
    const pre = unrollFixedWidthCollections(expr);
    expect(pre.operator).toBe('List');
    expect(pre.nops).toBe(5);
    expect((pre.ops[1] as any).json).toEqual([
      'Which',
      ['Less', ['Add', 'b', 'x'], 4],
      1,
      'True',
      0,
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.select');
    expect(r.run!(VARS)).toEqual(interpretedList(expr.json));
  });

  test('a list arm is read at each position', () => {
    const expr = ce.box([
      'Which',
      WIDE,
      ['Multiply', 2, ['List', 'a', 'b', 'c', 'd', 'e']],
      'True',
      0,
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.select');
    expect(r.run!(VARS)).toEqual(interpretedList(expr.json));
  });

  test('the shader targets compile the written-out form', () => {
    const expr = ce.box(['Which', WIDE, 1, 'True', 0]);
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = compile(expr, { to, fallback: false });
      expect([to, r.success, r.error?.message]).toEqual([to, true, undefined]);
    }
  });

  test('a narrow condition keeps the run-time selection', () => {
    const expr = ce.box([
      'Which',
      ['Less', ['Add', 'x', ['List', 'a', 'b', 'c']], 4],
      1,
      'True',
      0,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
    expect(compile(expr, { fallback: false }).code).toContain('_SYS.select');
  });

  test('a list arm wider than the condition is a mismatch, not a fan-out', () => {
    // The interpreter reports the dimension mismatch and the run-time
    // selection answers NaN; five scalar selections would hide it. (The
    // arithmetic under the condition is still fanned out by rule 4, so the
    // selection node is rebuilt; it stays a selection.)
    const expr = ce.box([
      'Which',
      WIDE,
      ['List', 'a', 'b', 'c', 'd', 'e', 'x'],
      'True',
      0,
    ]);
    expect(unrollFixedWidthCollections(expr).operator).toBe('Which');
  });

  test('a clause reading live caller source is not repeated', () => {
    const expr = ce.box(['Which', WIDE, 'u', 'True', 0]);
    expect(
      unrollFixedWidthCollections(expr, {
        readsLiveSource: (name) => name === 'u',
      }).operator
    ).toBe('Which');
    const indexed = ce.box(['At', ['Which', WIDE, 'u', 'True', 0], 2]);
    expect(
      unrollFixedWidthCollections(indexed, {
        readsLiveSource: (name) => name === 'u',
      }).operator
    ).toBe('At');
  });

  test('a constant condition is left to the constant folder', () => {
    const expr = ce.box([
      'Which',
      ['Less', ['List', 1, 2, 3, 4, 5], 'x'],
      1,
      'True',
      0,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  test('the interval target compiles any width, with constants', () => {
    // `Which(x + [1, 2, 3] < 2, 1, True, 0)[k]` has an index; a bare
    // selection is a list value, which the interval target declines as a
    // root and this pass writes out under its options (`minWidth: 1`,
    // `unrollConstantLists: true`) when a scalar consumer reads it.
    const expr = ce.parse(
      String.raw`\sum_{k=1}^{3} \begin{cases}1 & x + \bigl\lbrack1, 2, 3\bigr\rbrack < 2 \\ 0 & \top\end{cases}[k]`
    );
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect([r.success, r.error?.message]).toEqual([true, undefined]);
  });
});

describe('A point arm of the run-time selection is lifted whole', () => {
  const NAN_AWARE = (_k: string, v: unknown) =>
    typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v;

  test('a literal point, no default clause', () => {
    const expr = ce.box([
      'Which',
      ['Less', ['List', 1, 2, 3], 2],
      ['Tuple', 1, 2],
    ]);
    expect(expr.evaluate().toString()).toBe('[(1, 2),NaN,NaN]');
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.wholeArm(');
    expect(JSON.stringify(r.run!({}), NAN_AWARE)).toBe('[[1,2],"NaN","NaN"]');
  });

  test('a point default beside a list arm', () => {
    const expr = ce.box([
      'Which',
      ['Less', ['List', 1, 2, 3], 2],
      ['List', 10, 20, 30],
      'True',
      ['Tuple', 1, 2],
    ]);
    expect(expr.evaluate().toString()).toBe('[10,(1, 2),(1, 2)]');
    const r = compile(expr, { fallback: false });
    expect(r.run!({})).toEqual([10, [1, 2], [1, 2]]);
  });

  test('an arm that may be a point or a scalar is lifted whole', () => {
    // The nested selection types `integer | tuple<…>`: a point reaching the
    // arm at run time is still one value, not a list of coordinates.
    const expr = ce.box([
      'Which',
      ['Less', 'L', 2],
      ['If', ['Greater', 'x', 0], ['Tuple', 1, 2], 5],
      'True',
      0,
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.wholeArm(');
    expect(r.run!({ L: [1, 2, 3], x: 1 })).toEqual([[1, 2], 0, 0]);
    expect(r.run!({ L: [1, 2, 3], x: -1 })).toEqual([5, 0, 0]);
  });

  test('a point symbol arm under a run-time list condition', () => {
    const expr = ce.box(['Which', ['Less', 'L', 2], 'P', 'True', 0]);
    const r = compile(expr, { fallback: false });
    expect(r.run!({ L: [1, 2, 3], P: [7, 8] })).toEqual([[7, 8], 0, 0]);
    // When the condition is a scalar at run time the arm is answered whole.
    expect(r.run!({ L: 1, P: [7, 8] })).toEqual([7, 8]);
    expect(r.run!({ L: 5, P: [7, 8] })).toBe(0);
  });
});
