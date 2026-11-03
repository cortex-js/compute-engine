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
import { SYS_HELPERS } from '../../src/compute-engine/compilation/javascript-runtime';

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

  test('a point arm with no default clause is walked', () => {
    // Element-wise, a position no clause selects is `Missing` for a point
    // (`NaN` for a number), as a scalar selection with no default answers
    // (user decision 2026-10-17), so the index is pushed through. Before,
    // the element-wise position was `NaN` and the selection was not walked.
    const expr = ce.box([
      'At',
      ['Which', ['Less', ['List', 'a', 'b', 'c'], 2], ['Tuple', 'u', 'v']],
      2,
    ]);
    expect(unrollFixedWidthCollections(expr).json).toEqual([
      'Which',
      ['Less', 'b', 2],
      ['Tuple', 'u', 'v'],
    ]);
    const point = ce.box([
      'Which',
      ['Less', ['List', 1, 3, 1], 2],
      ['Tuple', 1, 2],
    ]);
    // An unmatched point cell is a point of `NaN` coordinates (selection
    // rule of 2026-11-02; it was `Missing`).
    expect(point.evaluate().toString()).toBe('[(1, 2),(NaN, NaN),(1, 2)]');
    expect(
      ce
        .box(['Which', ['Less', 3, 2], ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
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

  test('the index is pushed through a When over a list of conditions', () => {
    // `If(cond, value)` over a list of conditions masks each position:
    // `NaN` for a number and `Missing` for a point, as the scalar restriction
    // answers. A scalar or point value is repeated at every position, a list
    // value is read at the index.
    const cond = ['Less', ['List', 'a', 'b', 'c'], 2];
    const scalar = ce.box(['At', ['If', cond, 'x'], 2]);
    expect(unrollFixedWidthCollections(scalar).json).toEqual(['If', ['Less', 'b', 2], 'x']);
    const point = ce.box(['At', ['If', cond, ['Tuple', 'u', 'v']], 3]);
    expect(unrollFixedWidthCollections(point).json).toEqual(['If', ['Less', 'c', 2], ['Tuple', 'u', 'v']]);
    const list = ce.box(['At', ['If', cond, ['List', 'u', 'v', 'x']], 2]);
    expect(unrollFixedWidthCollections(list).json).toEqual(['If', ['Less', 'b', 2], 'v']);
    // A list value of another width is truncated by the interpreter: not
    // walked.
    const short = ce.box(['At', ['If', cond, ['List', 'u', 'v']], 2]);
    expect(unrollFixedWidthCollections(short)).toBe(short);
    // The scalar form and the element-wise form agree at each position for
    // a number and for a point: an unmatched cell of a point is a point of
    // `NaN` coordinates (selection rule of 2026-11-02), and so is a false
    // restriction of a point (user decision 2026-11-03).
    for (const [value, masked, maskedOne] of [
      [7, 'NaN', 'NaN'],
      [['Tuple', 1, 2], '(NaN, NaN)', '(NaN, NaN)'],
    ] as const) {
      const whole = ce
        .box(['If', ['Less', ['List', 1, 3], 2], value])
        .evaluate();
      const one = ce.box(['If', ['Less', 3, 2], value]).evaluate();
      expect(whole.ops![1].toString()).toBe(masked);
      expect(one.toString()).toBe(maskedOne);
    }
  });

  test('a restriction over a list of conditions compiles at one index on every target', () => {
    expectAllTargetsAgree(
      String.raw`\operatorname{If}(\vert x+\bigl\lbrack3, 2, 1\bigr\rbrack/3\vert\lt1, 7)[2]`,
      [-0.5, 0.2, -1.5]
    );
    // At `x = 0.9` the condition fails: the masked number is `NaN` in the
    // interpreter and in the compiled code.
    const latex = String.raw`\operatorname{If}(\vert x+\bigl\lbrack3, 2, 1\bigr\rbrack/3\vert\lt1, 7)[2]`;
    expect(interpreted(latex, 0.9)).toBeNaN();
    expect(compile(ce.parse(latex), { fallback: false }).run!({ x: 0.9 })).toBeNaN();
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
      ...(
        ce
          .box(json)
          .subs(
            Object.fromEntries(
              Object.entries(VARS).map(([k, n]) => [k, ce.number(n)])
            )
          )
          .evaluate() as any
      ).each(),
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
    // The lengths are known statically and differ, so the selection is the
    // static `incompatible-dimensions` error (selection rule of 2026-11-02);
    // before, it stayed a selection and the run-time selection answered
    // NaN. Five scalar selections would hide it.
    const expr = ce.box([
      'Which',
      WIDE,
      ['List', 'a', 'b', 'c', 'd', 'e', 'x'],
      'True',
      0,
    ]);
    expect(expr.isValid).toBe(false);
    expect(unrollFixedWidthCollections(expr).toString()).toMatch(
      /incompatible-dimensions/
    );
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
  test('a literal point, no default clause', () => {
    const expr = ce.box([
      'Which',
      ['Less', ['List', 1, 2, 3], 2],
      ['Tuple', 1, 2],
    ]);
    // An unmatched point position is a point of `NaN` coordinates in the
    // interpreter and in the compiled array (selection rule of 2026-11-02,
    // which reverses the decisions of 2026-10-17 and 2026-10-18: the cell
    // was `Missing`, compiled `undefined`).
    expect(expr.evaluate().toString()).toBe(
      '[(1, 2),(NaN, NaN),(NaN, NaN)]'
    );
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.wholeArm(');
    expect(r.run!({})).toEqual([
      [1, 2],
      [NaN, NaN],
      [NaN, NaN],
    ]);
  });

  test('a point default beside a list arm of numbers is a static error', () => {
    // All arms of a selection under a list condition have one element kind
    // (selection rule of 2026-11-02); it gave `[10, (1, 2), (1, 2)]`.
    const expr = ce.box([
      'Which',
      ['Less', ['List', 1, 2, 3], 2],
      ['List', 10, 20, 30],
      'True',
      ['Tuple', 1, 2],
    ]);
    expect(expr.isValid).toBe(false);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /invalid expression/
    );
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
    // The nested `If` has a point and a number as branches, so the shape of
    // its value is known only at run time, and the compilation declines.
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a point symbol arm under a list condition', () => {
    // A point arm beside a number arm is a static error (selection rule of
    // 2026-11-02; it gave `[[7, 8], 0, 0]`). With a point default, the
    // arm is lifted whole.
    expect(
      ce.box(['Which', ['Less', 'L', 2], 'P', 'True', 0]).isValid
    ).toBe(false);
    const expr = ce.box(['Which', ['Less', 'L', 2], 'P', 'True', ['Tuple', 0, 0]]);
    const r = compile(expr, { fallback: false });
    expect(r.run!({ L: [1, 2, 3], P: [7, 8] })).toEqual([
      [7, 8],
      [0, 0],
      [0, 0],
    ]);
  });
});

describe('A point selection whose condition is a scalar at run time', () => {
  // A condition whose static type may be a list (`boolean | list<boolean>`,
  // or `B < 0` with `B: broadcastable<number>`) can be one boolean at run
  // time. Under a list of conditions an unselected position is a point of
  // `NaN` coordinates; a false scalar condition selects nothing for the
  // whole value, which can be one point or a list of points, so the whole
  // value is `undefined`, as the scalar `If` compiles it, not one point
  // `[NaN, NaN]` in place of a list of points.
  const pe = new ComputeEngine();
  pe.declare('c', 'boolean | list<boolean>');
  pe.declare('B', 'broadcastable<number>');
  pe.declare('P', 'tuple<real, real>');
  pe.declare('Q', 'list<tuple<real, real>>');
  const P = [1, 2];
  const Q = [
    [1, 2],
    [3, 4],
  ];

  test.each([
    ['If', 'c', 'P'],
    ['If', 'c', 'Q'],
    ['Which', 'c', 'P'],
    ['Which', 'c', 'Q'],
    ['If', ['Less', 'B', 0], 'P'],
    ['If', ['Less', 'B', 0], 'Q'],
    ['Which', ['Less', 'B', 0], 'P'],
    ['Which', ['Less', 'B', 0], 'Q'],
  ])('%s(%j, %s)', (h, cond, value) => {
    const r = compile(pe.box([h, cond, value] as any), { fallback: false });
    expect(r.success).toBe(true);
    // A false scalar condition: the whole value is absent. A false
    // restriction of a point is the point of `NaN` coordinates (user
    // decision 2026-11-03): `c` is an input declared `boolean |
    // list<boolean>`, which compiles one body per member, and the body of a
    // boolean `c` gives that point. With `B < 0`, the shape of the
    // condition is not known, and the run-time selection gives `undefined`
    // for the whole value (a known limitation, `docs/COMPILATION-MODEL.md`).
    expect(r.run!({ c: false, B: 1, P, Q })).toEqual(
      h === 'If' && cond === 'c' && value === 'P' ? [NaN, NaN] : undefined
    );
    // A true scalar condition: the value whole.
    expect(r.run!({ c: true, B: -1, P, Q })).toEqual(value === 'P' ? P : Q);
    // A list of conditions: a point of `NaN` coordinates where the
    // condition is false.
    expect(r.run!({ c: [true, false], B: [-1, 1], P, Q })).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  test('the restriction helper over a scalar condition', () => {
    // `_SYS.restrict` is also reached with a condition that is a scalar at
    // run time: a false one gives `undefined` for a point cell, `NaN` for a
    // number cell.
    expect(SYS_HELPERS.restrict(false, Q, true, [NaN, NaN])).toBeUndefined();
    expect(SYS_HELPERS.restrict(false, P, false, [NaN, NaN])).toBeUndefined();
    expect(SYS_HELPERS.restrict(true, Q, true, [NaN, NaN])).toEqual(Q);
    expect(SYS_HELPERS.restrict(false, [1, 2], null, NaN)).toBeNaN();
    expect(SYS_HELPERS.restrict([false, true], Q, true, [NaN, NaN])).toEqual([
      [NaN, NaN],
      [3, 4],
    ]);
  });
});
