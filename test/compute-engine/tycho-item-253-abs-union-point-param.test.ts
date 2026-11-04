import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho item 253 — `Abs` over a parameter declared with the point-or-point-
 * list union (`list<tuple<number, number>> | tuple<number, number>`, or the
 * three-arm form a point-consuming document function declares), or with no
 * type at all, lowered to ELEMENT-WISE `Math.abs` (`_SYS.bcast(Math.abs, …)`
 * or a bare `Math.abs(array)`), where `evaluate()` of the same call answers
 * the NORM. Neither static rewrite (`Abs(point)` → `Norm`, `Abs(point list)`
 * → `Norm`) applied, because the operand is not provably either.
 *
 * Where a declared union of the parameter selects a variant of the function
 * for each member, each variant has a static shape. Where it does not (one
 * body for both members), the sum declines (rule R3 of "Shapes are settled
 * at compile time", `docs/COMPILATION-MODEL.md`). Before, the shape was
 * decided at run time (`_SYS.absShape`, which a `broadcastable` point still
 * uses): a number is
 * `Math.abs`, an array of numbers a point (its norm), an array of arrays a
 * point list (one norm per point). A compiled array carries no
 * tuple-versus-list tag, so a flat numeric array is read as a point. That
 * run-time test, and its exception for a point SUM, are removed: a union
 * of a point and another shape now declines in the `Abs` lowering.
 */

const DECLARATIONS = [
  'tuple<number, number>',
  'list<tuple<number, number>> | tuple<number, number>',
  'indexed_collection<number | tuple<number, number>> | list<tuple<number, number>> | tuple<number, number>',
  'unknown',
];

function declareG(ce: ComputeEngine, type: string): void {
  ce.declare('g', { signature: `(${type}) -> number` });
  ce.assign(
    'g',
    ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
  );
}

describe('Tycho item 253: Abs over a union-typed point parameter', () => {
  for (const type of DECLARATIONS) {
    test(`g((x, y)) with P: ${type} compiles to the norm`, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      ce.declare('y', 'real');
      declareG(ce, type);
      expect(ce.parse('g\\left(\\left(5,1\\right)\\right)').N().re).toBeCloseTo(
        Math.SQRT2,
        12
      );
      const r = compile(ce.parse('g\\left(\\left(x,y\\right)\\right)'), {
        to: 'javascript',
      });
      expect(r.success).toBe(true);
      expect(r.run!({ x: 5, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
    });
  }

  test('a point list through the union answers one norm per point', () => {
    const ce = new ComputeEngine();
    declareG(ce, 'list<tuple<number, number>> | tuple<number, number>');
    ce.declare('Q', 'list<tuple<number, number>>');
    const r = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(
      r.run!({
        Q: [
          [5, 1],
          [4, 2],
        ],
      })
    ).toEqual([Math.SQRT2, 2]);
  });

  test('a chain of point subtractions declines', () => {
    // Canonicalization flattens `P − (4, 0) − (1, 2)` into ONE `Add` with
    // THREE operands, two of them tuple-valued. The declared union of the
    // parameter `P` has no variant of `g` for each member here: the
    // ordinary definition, one body for both members, is compiled, and in
    // it the sum may be a point or a list of points. Its absolute value is
    // a norm or a list of norms, and only the value tells which, so the
    // compilation declines (rule R3 of "Shapes are settled at compile
    // time", `docs/COMPILATION-MODEL.md`), where the code tested the value
    // at run time. The interpreter gives the values.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('g', {
      signature:
        '(list<tuple<number, number>> | tuple<number, number>) -> number',
    });
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Abs',
          ['Subtract', ['Subtract', 'P', ['Tuple', 4, 0]], ['Tuple', 1, 2]],
        ],
        'P',
      ])
    );
    ce.declare('Q', 'list<tuple<number, number>>');

    const overList = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(overList.success).toBe(false);
    expect(overList.diagnostic?.code).toBe('unsettled-shape');
    expect(
      ce
        .box(['g', ['List', ['Tuple', 5, 1], ['Tuple', 4, 2]]])
        .N()
        .ops!.map((op) => op.re)
    ).toEqual([1, 1]);
  });

  test('an empty point list answers the empty list', () => {
    // The call compiles a copy of `g` for the list member of the union, and
    // its point-list `Norm` lowering (`Q.map((p) => _SYS.norm(p))`) maps
    // over the empty array and gives `[]`.
    const ce = new ComputeEngine();
    declareG(ce, 'list<tuple<number, number>> | tuple<number, number>');
    ce.declare('Q', 'list<tuple<number, number>>');
    const r = compile(ce.box(['g', 'Q']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ Q: [] })).toEqual([]);
  });

  test('a declaration that admits a list coordinate declines for inputs declared with a union', () => {
    // `x` and `y` are declared with a union of shapes, so the compiler
    // compiles one body for each combination of members. For `x, y:
    // list<real>`, the copy of `k` typed by the argument `(x, y)` has a
    // sub-expression of static type `error` (`P − (4, 0)` with list
    // coordinates), so that body declines, and the compilation declines
    // with it. One body for all the members would test the shapes of `x`
    // and `y` inside the body (rules R2 and R4 of "Shapes are settled at
    // compile time", `docs/COMPILATION-MODEL.md`).
    for (const type of [
      'tuple<number, number> | tuple<list<number>, list<number>>',
      'tuple<broadcastable<number>, broadcastable<number>>',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('x', 'real | list<real>');
      ce.declare('y', 'real | list<real>');
      ce.declare('k', { signature: `(${type}) -> number` });
      ce.assign(
        'k',
        ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
      );
      const r = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
        to: 'javascript',
      });
      expect(r.success).toBe(false);
    }
  });

  test('a point with a list coordinate under an open declaration answers one norm per element', () => {
    // `P: unknown` and `P: tuple<broadcastable<number>, …>` both admit a
    // list coordinate; the interpreter reads `([1, 2], 3) − (4, 0)` as two
    // points and answers `[|(−3, 3)|, |(−2, 3)|]`. `_SYS.norm` on the nested
    // array flattened it to one number (4.69) behind `success: true`.
    //
    // `x` and `y` are not declared, so their static type is `unknown` and
    // the compiled code cannot know whether each one is a number or a list.
    // The compilation refuses such an input, on every target, and names it
    // in `unsupported` (rule R1 of
    // `docs/plans/2026-10-31-static-shape-compilation.md`).
    for (const type of [
      'unknown',
      'tuple<broadcastable<number>, broadcastable<number>>',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('k', { signature: `(${type}) -> number` });
      ce.assign(
        'k',
        ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
      );
      const r = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
        to: 'javascript',
      });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('untyped-input');
      expect(r.unsupported).toContain('x');
      // On the interpreter, the LaTeX `(x, y)` with `x` a list is the list
      // of points `PointList(x, y)` (user decision 2026-09-24), so the call
      // answers one norm per point: bound whole under `unknown`, mapped over
      // the points under the point declaration (user decision 2026-09-25).
      ce.assign('x', ce.box(['List', 1, 2]));
      ce.assign('y', 3);
      const call = ce.parse('k\\left(\\left(x,y\\right)\\right)');
      expect(call.json).toEqual(['k', ['PointList', 'x', 'y']]);
      expect(call.N().ops!.map((op) => op.re)).toEqual([
        expect.closeTo(Math.hypot(3, 3), 12),
        expect.closeTo(Math.hypot(2, 3), 12),
      ]);
    }
  });

  test('a code-built Tuple with a list coordinate is an error, not a point', () => {
    // A MathJSON `Tuple` with a list coordinate is data, not a point and not
    // a list of points (user decision 2026-09-25): the arithmetic in the
    // body is an `incompatible-type` error on the interpreter, and the
    // compiled call fails closed.
    for (const type of [
      'unknown',
      'tuple<broadcastable<number>, broadcastable<number>>',
      'tuple<real, real>',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('k', { signature: `(${type}) -> number` });
      ce.assign(
        'k',
        ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
      );
      ce.declare('x', 'list<real>');
      ce.declare('y', 'real');
      // At `tuple<real, real>`, the call is refused when it is boxed
      // (`tuple<list<real>, real>` is disjoint from it), so the compiler
      // sees an invalid expression. The other parameters admit the call, and
      // the compiler refuses the tuple with a list coordinate.
      expect(() =>
        compile(ce.box(['k', ['Tuple', 'x', 'y']]), {
          to: 'javascript',
          fallback: false,
        } as any)
      ).toThrow(
        type === 'tuple<real, real>'
          ? /incompatible-type/
          : /tuple with a list coordinate/
      );
      ce.assign('x', ce.box(['List', 1, 2]));
      ce.assign('y', 3);
      const r = ce.box(['k', ['Tuple', 'x', 'y']]).N();
      expect(r.operator).toBe('Error');
      expect(r.op1.op1.string).toBe('incompatible-type');
    }
  });

  test('a list arm of scalar-coordinate points still specializes the point call', () => {
    // `list<tuple<number, number>>` holds points with scalar coordinates, so
    // a written point with a list coordinate is not a member of either arm;
    // the interpreter rejects it and the compiled call rebuilds the point at
    // `tuple<number, number>`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('k', {
      signature:
        '(list<tuple<number, number>> | tuple<number, number>) -> number',
    });
    ce.assign(
      'k',
      ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
    );
    const r = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    // The parameter of `k` is declared with a union of shapes, so `k` has
    // one variant per member. The argument `(x, y)` has the shape of the
    // point member, so the call reads that variant directly, with no
    // run-time test of the shape.
    expect(r.preamble).toContain(
      'const _fn_k$tuple = (P) => _SYS.norm([(P[0] + (-4)), (P[1] + 0)]);'
    );
    expect(r.code).toBe('_fn_k$tuple([_.x, _.y])');
    expect(r.run!({ x: 5, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
    expect(r.run!({ x: 5, y: 1 })).toBeCloseTo(
      ce.box(['k', ['Tuple', 5, 1]]).N().re,
      12
    );
  });

  test('a union that admits a flat numeric list declines', () => {
    // A compiled array carries no tuple-versus-list tag. For `P: list<number>
    // | tuple<number, number>` a flat array of numbers is a list, which the
    // interpreter reads element-wise, or a point, whose absolute value is its
    // norm. No run-time test tells the two apart, so the function has one
    // body for both members, and `|P|` declines (rule R3 of "Shapes are
    // settled at compile time", `docs/COMPILATION-MODEL.md`). The
    // element-wise lowering gave `[3, 4]` for the point `(3, −4)`, where the
    // interpreter gives `5`.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('h', {
      signature: '(list<number> | tuple<number, number>) -> number',
    });
    ce.assign('h', ce.box(['Function', ['Abs', 'P'], 'P']));
    ce.declare('Q', 'list<number>');
    const bare = compile(ce.box(['h', 'Q']), { to: 'javascript' });
    expect(bare.success).toBe(false);
    expect(bare.diagnostic?.code).toBe('unsettled-shape');

    // The same declaration, but a call whose argument is one point compiles
    // a copy of the helper for that point, where `P − (4, 0)` is a point.
    ce.declare('k', {
      signature: '(list<number> | tuple<number, number>) -> number',
    });
    ce.assign(
      'k',
      ce.box(['Function', ['Abs', ['Subtract', 'P', ['Tuple', 4, 0]]], 'P'])
    );
    const sum = compile(ce.parse('k\\left(\\left(x,y\\right)\\right)'), {
      to: 'javascript',
    });
    expect(sum.success).toBe(true);
    // A concrete point call specializes the helper and selects its norm.
    expect(sum.preamble).toContain('_SYS.norm(');
    expect(sum.run!({ x: 5, y: 1 })).toBeCloseTo(Math.SQRT2, 12);
  });

  test('a scalar-typed parameter keeps Math.abs', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> number');
    ce.assign('h', ce.box(['Function', ['Abs', ['Subtract', 'P', 4]], 'P']));
    const r = compile(ce.parse('h(x)'), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(String(r.preamble ?? '') + String(r.code)).toContain('Math.abs');
    expect(String(r.preamble ?? '') + String(r.code)).not.toContain('absShape');
    expect(r.run!({ x: 1 })).toBe(3);
  });

  test('the D-264 shape: min over seven discs is a disc union, not axis bands', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    // f(P) = min([ |P − (4, 0) − 2(H(i+.2), H(i+.4))| − .9 H(i+.6) for i = 1..7 ])
    // with H a smooth hash; the region f((x,y)) ≤ 0 is a union of discs. At a
    // point inside the first disc and off both axes through its centre, the
    // element-wise reading answered a positive value (no band contains it).
    ce.declare('H', '(number) -> number');
    ce.assign('H', ce.box(['Function', ['Sin', ['Multiply', 7, 'u']], 'u']));
    ce.declare(
      'f',
      '(list<tuple<number, number>> | tuple<number, number>) -> number'
    );
    ce.assign(
      'f',
      ce.parse(
        'P\\mapsto\\min\\left(\\left[\\left|P-\\left(4,0\\right)-2\\left(H\\left(i+.2\\right),H\\left(i+.4\\right)\\right)\\right|-.9H\\left(i+.6\\right)\\ \\text{for}\\ i=\\left[1...7\\right]\\right]\\right)'
      )
    );
    const row = ce.parse('f\\left(\\left(x,y\\right)\\right)');
    const r = compile(row, { to: 'javascript' });
    expect(r.success).toBe(true);
    for (const [x, y] of [
      [4.3, 0.4],
      [2.1, -1.2],
      [5.7, 1.1],
    ]) {
      const expected = ce.box(['f', ['Tuple', x, y]]).N().re;
      expect(r.run!({ x, y })).toBeCloseTo(expected, 9);
    }
  });
});
