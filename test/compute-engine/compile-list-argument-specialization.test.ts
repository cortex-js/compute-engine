/**
 * A user function called with a LIST of numbers at a parameter its
 * definition leaves untyped, beside a point argument.
 *
 * The Tycho code-generation audit document `njncrg9fkv` scales a cube's
 * points with `W(p, x, y, z) := PointList(x·PointX(p), y·PointY(p),
 * z·PointZ(p))`, declared with `p` "a point or a list of points" and
 * `x`, `y`, `z` untyped, and calls it as `W(C(u, v), [0.8, 0.2, 0.8, 0.2],
 * [0.2, 0.8, 0.2, 0.8], 0.6)`: four scaled copies of one point. The
 * JavaScript target specialized such a call only for scalar and point
 * arguments; a list argument fell to the generic definition, where the
 * broadly declared `p` reads its coordinate as a collection of numbers,
 * and the `PointList` built from that coordinate scaled by the list had no
 * list source to zip: the call declined. The specialization now admits a
 * real-number list beside a point argument, and binds it as the
 * interpreter binds it: WHOLE, with its own type, when the definition
 * declares a point or collection parameter (`W` above); BROADCAST at the
 * call boundary otherwise, the helper being the scalar call's and the
 * point held (`f(p, x) := 42` over a two-element list is `[42, 42]`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const POINT_OR_LIST =
  "'indexed_collection<number | tuple<number, number, number>> | list<tuple<number, number, number>> | tuple<number, number, number>'";

function engineWithW(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('v', 'real');
  ce.declare('L', 'list<number>');
  ce.declare('C', 'function');
  ce.assign(
    'C',
    ce.parse(String.raw`(u, v) \mapsto \operatorname{PointList}(u, v, 0)`)
  );
  // Bound as the document's importer binds it: a typed point parameter, the
  // scale parameters untyped, the result ascribed the same union.
  ce.assign(
    'W',
    ce.box([
      'Function',
      [
        'Block',
        [
          'Typed',
          [
            'PointList',
            ['Multiply', 'x', ['PointX', 'p']],
            ['Multiply', 'y', ['PointY', 'p']],
            ['Multiply', 'z', ['PointZ', 'p']],
          ],
          POINT_OR_LIST,
        ],
      ],
      ['Typed', 'p', POINT_OR_LIST],
      'x',
      'y',
      'z',
    ])
  );
  return ce;
}

const VARS = { u: 0.25, v: 0.5, L: [1, 2, 3] };

function interpreted(ce: ComputeEngine, expr: any): number[][] {
  const value = expr
    .subs({
      u: ce.number(VARS.u),
      v: ce.number(VARS.v),
      L: ce.box(['List', ...VARS.L]),
    })
    .N();
  return [...value.each()].map((p: any) => [...p.each()].map((c: any) => c.re));
}

describe('A list argument at an untyped parameter is specialized', () => {
  test('an untyped definition is broadcast at the call boundary', () => {
    // No declared point or collection parameter: the interpreter maps the
    // call over the list, and so does the compiled call.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    ce.assign('k', ce.box(['Function', 42, 'p', 'x'] as any));
    const expr = ce.box(['k', ['Tuple', 1, 2], ['List', 'a', 'b']]);
    expect(
      expr
        .subs({ a: ce.number(3), b: ce.number(4) })
        .evaluate()
        .toString()
    ).toBe('[42,42]');
    const r = compile(expr, { fallback: false });
    expect(r.run!({ a: 3, b: 4 })).toEqual([42, 42]);
  });

  test('a declared point parameter maps a list at an untyped parameter', () => {
    // The untyped parameter `x` follows the rule of a one-parameter
    // function: it stays `unknown` in the refined signature, so the call
    // maps over the list (user decision 2026-10-24, ROADMAP CE-414.2).
    // Before, a declared point parameter made `x` bind the list whole, and
    // the call gave `42`.
    const ce = new ComputeEngine();
    ce.assign(
      'k',
      ce.box([
        'Function',
        42,
        ['Typed', 'p', "'tuple<number, number>'"],
        'x',
      ] as any)
    );
    const expr = ce.box(['k', ['Tuple', 1, 2], ['List', 3, 4]]);
    expect(expr.evaluate().toString()).toBe('[42,42]');
    const r = compile(expr, { fallback: false });
    expect(r.run!({})).toEqual([42, 42]);
  });

  test('the scalar call', () => {
    const ce = engineWithW();
    const r = compile(ce.parse(String.raw`W(C(u, v), 3, 3, 0.2)`), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!(VARS)).toEqual([0.75, 1.5, 0]);
  });

  test('the specialized scalar call adds to a point and to a point list', () => {
    const ce = engineWithW();
    const point = ce.parse(
      String.raw`W(C(u, v), 3, 3, 0.2)+\operatorname{PointList}(1, 2, 3)`
    );
    expect(compile(point, { fallback: false }).run!(VARS)).toEqual([
      1.75, 3.5, 3,
    ]);
    const list = ce.parse(
      String.raw`W(C(u, v), 3, 3, 0.2)+\operatorname{PointList}(\bigl\lbrack0, 0.3\bigr\rbrack, 1, 0.6)`
    );
    const got = compile(list, { fallback: false }).run!(VARS) as number[][];
    const want = interpreted(ce, list);
    got.forEach((p, i) =>
      p.forEach((c, j) => expect(c).toBeCloseTo(want[i][j], 12))
    );
  });

  test('a list alone, with no point beside it, keeps the generic definition', () => {
    // A scalar-bodied function over a list broadcasts element-wise through
    // its generic definition, which also carries the last-call memo; a
    // helper per list type would replace both for nothing.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('g', 'function');
    ce.assign('g', ce.parse(String.raw`x \mapsto 2x + 1`));
    const r = compile(ce.parse('g(L)'), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/_fn_g_[^(]*list/);
    expect(r.run!({ L: [1, 2] })).toEqual([3, 5]);
  });
});

describe('A point-or-list operand added to a list of points', () => {
  const LIST = String.raw`\operatorname{PointList}(\bigl\lbrack0, 1\bigr\rbrack, \bigl\lbrack1, 0\bigr\rbrack, 0)`;

  test('a union with a list-of-numbers arm declines', () => {
    // `[10, 20]` is a list of numbers by the declaration and has the shape
    // of a point; the interpreter pairs each number with a point (type
    // errors), while a run-time shape test would add it as a point. The two
    // members are the same array at run time, so the declared-union dispatch
    // cannot choose a body and declines.
    const engine = new ComputeEngine();
    engine.declare('Q', 'list<number> | tuple<number, number>');
    expect(() =>
      compile(engine.parse(String.raw`Q+${LIST}`), { fallback: false })
    ).toThrow(/Could not compile/);
  });

  test('a union whose point arm has a list coordinate declines', () => {
    // The run-time test reads an array whose first element is an array as
    // a list of points; a point with a list coordinate is such an array.
    const engine = new ComputeEngine();
    engine.declare(
      'Q',
      'list<tuple<number, number>> | tuple<list<number>, number>'
    );
    expect(() =>
      compile(engine.parse(String.raw`Q+${LIST}`), { fallback: false })
    ).toThrow();
  });
});
