/**
 * `Cross` accepts numeric 3-tuples alongside vectors, mirroring `Dot` — the
 * two classic vector products must agree on what a vector is (asked by a
 * consumer whose points arrive as `Tuple`/`PointList`, 2026-08-19; `Dot`
 * gained the same arm for the same reason in the earlier round recorded in
 * its definition comment). The result has the KIND of the operands: two
 * POINTS give a point, so the cross product of two points adds to a point
 * (user-ruled 2026-09-13: the Frenet frame of a space curve,
 * `F_1(t) × F_0(t)`, is drawn as a point offset, and a list result made
 * that sum three type errors); a list beside a point, or two lists, give a
 * list.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('Cross over tuple operands', () => {
  test('two numeric tuples compute the cross product as a point', () => {
    const r = ce.box(['Cross', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]);
    expect(r.isValid).toBe(true);
    expect(r.evaluate().json).toEqual(['Tuple', -3, 6, -3]);
  });

  test('the point result adds to a point', () => {
    const r = ce.box([
      'Add',
      ['Cross', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]],
      ['Tuple', 1, 1, 1],
    ]);
    expect(r.evaluate().json).toEqual(['Tuple', -2, 7, -2]);
  });

  test('a point-typed symbol pair compiles to a point on every target', () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'tuple<real, real, real>');
    engine.declare('Q', 'tuple<real, real, real>');
    engine.declare('s', 'real');
    const expr = engine.box([
      'Add',
      ['Multiply', 's', ['Cross', 'P', 'Q']],
      'P',
    ]);
    expect(expr.type.matches('tuple<number, number, number>')).toBe(true);
    const js = compile(expr, { fallback: false });
    expect([js.success, js.error?.message]).toEqual([true, undefined]);
    expect(js.run!({ P: [1, 2, 3], Q: [4, 5, 6], s: 2 })).toEqual([-5, 14, -3]);
    for (const to of ['glsl', 'wgsl'] as const) {
      const r = compile(expr, { to, fallback: false });
      expect([to, r.success, r.error?.message]).toEqual([to, true, undefined]);
    }
  });

  test('symbols declared with the bare tuple type type a point', () => {
    const engine = new ComputeEngine();
    engine.declare('P', 'tuple');
    engine.declare('Q', 'tuple');
    const r = engine.box(['Cross', 'P', 'Q']);
    expect(r.type.matches('tuple<number, number, number>')).toBe(true);
    engine.assign('P', engine.box(['Tuple', 1, 0, 0]));
    engine.assign('Q', engine.box(['Tuple', 0, 1, 0]));
    expect(r.evaluate().json).toEqual(['Tuple', 0, 0, 1]);
  });

  test('a list beside a tuple, and two lists, still answer a list', () => {
    const mixed = ce
      .box(['Cross', ['Tuple', 1, 2, 3], ['List', 4, 5, 6]])
      .evaluate();
    const lists = ce
      .box(['Cross', ['List', 1, 2, 3], ['List', 4, 5, 6]])
      .evaluate();
    expect(mixed.json).toEqual(lists.json);
  });

  test('a 2-tuple still reports the dimension error, not a type error', () => {
    const r = ce.box(['Cross', ['Tuple', 1, 2], ['Tuple', 4, 5]]).evaluate();
    expect(r.toString()).toContain('incompatible-dimensions');
  });

  test('a tuple with symbolic components stays a symbolic Cross', () => {
    // Not (yet) a provable numeric tuple: no components to lower, and no
    // error either — the expression is valid and inert, like symbolic Dot.
    const r = ce.box(['Cross', ['Tuple', 'p', 'q', 'r'], ['Tuple', 4, 5, 6]]);
    expect(r.isValid).toBe(true);
    expect(r.evaluate().operator).toBe('Cross');
  });

  test('type of a tuple-operand Cross is a point, before and after eval', () => {
    const r = ce.box(['Cross', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]);
    expect(r.type.matches('tuple<number, number, number>')).toBe(true);
    // The evaluated result — an actual point — must satisfy the type the
    // handler answered, not just the unevaluated node.
    expect(r.evaluate().type.matches('tuple<number, number, number>')).toBe(
      true
    );
    // A list operand keeps the vector type.
    expect(
      ce
        .box(['Cross', ['List', 1, 2, 3], ['Tuple', 4, 5, 6]])
        .type.matches('vector')
    ).toBe(true);
  });

  test('a tuple with a collection component stays symbolic', () => {
    // The `isNumericTuple` guard: a point-list-shaped tuple (a component
    // that is itself a collection) is not a point in ℝ³ and must neither
    // lower nor error — it stays a symbolic Cross, like Dot's same case.
    const r = ce.box([
      'Cross',
      ['Tuple', -6, ['List', 1, 2], 3],
      ['Tuple', 1, 2, 3],
    ]);
    expect(r.isValid).toBe(true);
    expect(r.evaluate().operator).toBe('Cross');
    // The type describes the success — a cross product of two tuples
    // succeeds only as a numeric 3-point — and a symbolic remainder is not
    // a success, so the point type stands (`docs/ERROR-MODEL.md`).
    expect(r.type.matches('tuple<number, number, number>')).toBe(true);
  });

  test('box route with raw MathJSON works like pre-boxed arguments', () => {
    // Route-parity probe: Cross is not lazy, but pin the raw-MathJSON route
    // anyway — operand admission happens at canonicalization and a suite
    // that only exercises ce.function() misses that class.
    const viaBox = ce
      .box(['Cross', ['Tuple', 7, 1, 2], ['Tuple', 0, 3, 5]])
      .evaluate();
    const viaFn = ce
      .function('Cross', [
        ce.box(['Tuple', 7, 1, 2]),
        ce.box(['Tuple', 0, 3, 5]),
      ])
      .evaluate();
    expect(viaBox.json).toEqual(viaFn.json);
    expect(viaBox.json).toEqual(['Tuple', -1, -35, 21]);
  });
});
