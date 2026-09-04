/**
 * A POINT operand of a compiled `Hypot`.
 *
 * `Hypot` is `broadcastable`, so a collection-shaped operand used to reach the
 * flat `_SYS.bcast` lowering whatever its kind was. That is right for a LIST —
 * `Hypot([3, 4], 1)` is one hypotenuse per element — and wrong for a POINT: a
 * fixed-arity point is ONE leg, entering the sum of squares through its own
 * norm, so `Hypot((3, 4), 1)` is `√(‖(3,4)‖² + 1²) = √26`. The interpreter has
 * always answered that (its evaluate handler builds `Square(Norm(point))`,
 * `library/trigonometry.ts`); the compiled lane answered the componentwise
 * list `[√10, √17]` behind `success: true`.
 *
 * The spine of every case here is INTERPRETER PARITY.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

/**
 * Compile with constant folding OFF, so the LOWERING is what runs. Every case
 * below is a literal, which the folder would otherwise evaluate through the
 * interpreter — hiding the very code under test.
 */
function compiled(json: any): { code: string; value: unknown } {
  const r = compile(ce.box(json), { fallback: false, constantFold: false });
  if (r === undefined) throw new Error('compile() returned undefined');
  expect(r.success).toBe(true);
  return { code: r.code ?? '', value: r.run!({}) };
}

/** The interpreted value, as a real target represents it. */
function interpreted(json: any): number {
  return ce.box(json).N().re!;
}

describe('a compiled Hypot consumes a point leg whole', () => {
  test('`Hypot((3, 4), 1)` is √26, not the componentwise pair', () => {
    const { code, value } = compiled(['Hypot', ['Tuple', 3, 4], 1]);
    // The point's norm IS the leg, which is how the interpreter builds it.
    expect(code).toBe('Math.hypot(_SYS.norm([3, 4]), 1)');
    expect(value).toBeCloseTo(Math.sqrt(26), 12);
    expect(value).toBeCloseTo(interpreted(['Hypot', ['Tuple', 3, 4], 1]), 12);
  });

  test('the point may be either operand', () => {
    const { value } = compiled(['Hypot', 1, ['Tuple', 3, 4]]);
    expect(value).toBeCloseTo(Math.sqrt(26), 12);
  });

  test('a NaN component makes the whole hypotenuse NaN', () => {
    // Componentwise, the second cell was a perfectly ordinary number.
    const json = ['Hypot', ['Tuple', 'NaN', 3], 5];
    expect(compiled(json).value).toBeNaN();
    expect(ce.box(json).N().isNaN).toBe(true);
  });

  test('an infinite component dominates a NaN one', () => {
    // `Math.hypot` carries the IEEE rule for the outer legs and `_SYS.norm`
    // carries it inside the point, so the two agree.
    const json = ['Hypot', ['Tuple', 'PositiveInfinity', 'NaN'], 5];
    expect(compiled(json).value).toBe(Infinity);
    expect(interpreted(json)).toBe(Infinity);
  });

  test('an unsigned infinity in the point is the same `+∞`', () => {
    const json = ['Hypot', ['Tuple', 'ComplexInfinity', 1], 2];
    expect(compiled(json).value).toBe(Infinity);
    expect(interpreted(json)).toBe(Infinity);
  });

  test('a LIST operand still broadcasts, one hypotenuse per element', () => {
    // The distinction the fix rests on: a list is a set of legs, a point is
    // one leg. This case must keep the `_SYS.bcast` lowering.
    const { code, value } = compiled(['Hypot', ['List', 3, 4], 1]);
    expect(code).toContain('_SYS.bcast');
    expect(value).toEqual([Math.hypot(3, 1), Math.hypot(4, 1)]);
  });

  test('two scalar legs are unchanged', () => {
    const { code, value } = compiled(['Hypot', 3, 4]);
    expect(code).toBe('Math.hypot(3, 4)');
    expect(value).toBe(5);
  });

  test('a point whose component is a list is one hypotenuse per element', () => {
    // `([1, 2], 3)` is two points once the inner list is distributed, so
    // `Hypot(([1,2], 3), 4)` is `[√26, √29]` and the application declares
    // `list<number>`. The point leg lowers through `Norm`, which broadcasts
    // the point over its list component and answers one norm per element,
    // and that list of norms then broadcasts against the other leg.
    const json = ['Hypot', ['Tuple', ['List', 1, 2], 3], 4];
    const { value } = compiled(json);
    expect(value).toEqual([
      expect.closeTo(Math.sqrt(26), 12),
      expect.closeTo(Math.sqrt(29), 12),
    ]);
    const interpretedValue = ce.box(json).N();
    expect(interpretedValue.operator).toBe('List');
    expect(interpretedValue.ops!.map((x) => x.re)).toEqual([
      expect.closeTo(Math.sqrt(26), 12),
      expect.closeTo(Math.sqrt(29), 12),
    ]);
    // Either leg position, and two list components zipped.
    expect(compiled(['Hypot', 4, ['Tuple', ['List', 1, 2], 3]]).value).toEqual([
      expect.closeTo(Math.sqrt(26), 12),
      expect.closeTo(Math.sqrt(29), 12),
    ]);
    expect(
      compiled(['Hypot', ['Tuple', ['List', 1, 2], ['List', 3, 4]], 4]).value
    ).toEqual([expect.closeTo(Math.sqrt(26), 12), 6]);
  });

  test('every component is evaluated once', () => {
    // The non-list components and the other leg are bound outside the
    // broadcast closure, so an impure component draws once for the whole
    // list, as the interpreter's evaluate-once rule requires.
    const { code } = compiled(['Hypot', ['Tuple', ['List', 1, 2], ['Random']], 4]);
    expect(code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    expect(code).toMatch(/^_SYS\.bcast\(/);
  });

  test('a point leg beside a LIST leg lifts the point whole', () => {
    // The point is one leg of every hypotenuse — its norm — and the list
    // supplies the cells: `[√26, √29]`, never the positional pairing of the
    // point's components with the list's elements (`[√10, √20]`). Both lanes.
    for (const json of [
      ['Hypot', ['Tuple', 3, 4], ['List', 1, 2]],
      ['Hypot', ['List', 1, 2], ['Tuple', 3, 4]],
    ]) {
      expect(compiled(json).value).toEqual([
        expect.closeTo(Math.sqrt(26), 12),
        expect.closeTo(Math.sqrt(29), 12),
      ]);
      expect(ce.box(json).N().ops!.map((x) => x.re)).toEqual([
        expect.closeTo(Math.sqrt(26), 12),
        expect.closeTo(Math.sqrt(29), 12),
      ]);
    }
  });

  test('a per-element point leg beside a list leg zips with it', () => {
    // `([1, 2], 3)` is the two points `(1, 3)` and `(2, 3)`, so its norms are
    // `[√10, √13]`, and the list leg pairs with them: `[√26, √38]`. Both lanes
    // — the interpreter holds the point back from the list broadcast and its
    // `Hypot` handler builds `√(Norm(P)² + y²)`, whose arithmetic zips.
    const json = ['Hypot', ['Tuple', ['List', 1, 2], 3], ['List', 4, 5]];
    expect(compiled(json).value).toEqual([
      expect.closeTo(Math.sqrt(26), 12),
      expect.closeTo(Math.sqrt(38), 12),
    ]);
    expect(ce.box(json).N().ops!.map((x) => x.re)).toEqual([
      expect.closeTo(Math.sqrt(26), 12),
      expect.closeTo(Math.sqrt(38), 12),
    ]);
  });

  test('a point with a collection component that is not written out fails closed', () => {
    // A symbol bound to `([10, 20], 3)`, or declared `tuple<list<number>,
    // number>`, is one point per element too, but the per-element emission
    // reads the components off a `Tuple` literal and cannot see a symbol's.
    // `_SYS.norm` would flatten the nested array to one wrong number
    // (22.56 for `[10.44, 20.22]`), so `Norm`, `Abs` and `Hypot` decline and
    // the interpreter answers.
    const engine = new ComputeEngine();
    engine.assign('p', engine.box(['Tuple', ['List', 10, 20], 3]));
    engine.declare('q', 'tuple<list<number>, number>');
    for (const json of [
      ['Norm', 'p'],
      ['Abs', 'p'],
      ['Hypot', 'p', 4],
      ['Norm', 'q'],
      ['Hypot', 'q', 4],
    ]) {
      expect(() =>
        compile(engine.box(json), { fallback: false, constantFold: false })
      ).toThrow(/Fail closed/);
    }
    expect(engine.box(['Norm', 'p']).N().ops!.map((x) => x.re)).toEqual([
      expect.closeTo(Math.sqrt(109), 12),
      expect.closeTo(Math.sqrt(409), 12),
    ]);
  });

  test('a complex element still fails closed', () => {
    // `Math.hypot` has no complex call form. The head was protected by the
    // string branch of the broadcast gate until its codegen became a
    // function; it is listed in `REAL_ONLY_CODEGEN_HEADS` so the decline
    // survives.
    const expr: BoxedExpression = ce.box([
      'Hypot',
      ['List', ['Complex', 1, 1], 2],
      3,
    ]);
    expect(() =>
      compile(expr, { fallback: false, constantFold: false })
    ).toThrow(/Fail closed/);
  });
});
