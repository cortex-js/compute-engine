/**
 * `Cross` accepts numeric 3-tuples alongside vectors, mirroring `Dot` — the
 * two classic vector products must agree on what a vector is (asked by a
 * consumer whose points arrive as `Tuple`/`PointList`, 2026-08-19; `Dot`
 * gained the same arm for the same reason in the earlier round recorded in
 * its definition comment). The result is a `List` for tuple operands too:
 * collection operators are not kind-preserving, a `tuple` operand yields
 * `list<T>`.
 */
import { ComputeEngine } from '../../src/compute-engine';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('Cross over tuple operands', () => {
  test('two numeric tuples compute the cross product as a List', () => {
    const r = ce.box(['Cross', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]);
    expect(r.isValid).toBe(true);
    expect(r.evaluate().json).toEqual(['List', -3, 6, -3]);
  });

  test('mixed tuple and list operands agree with the all-list result', () => {
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

  test('type of a tuple-operand Cross is vector, before and after eval', () => {
    const r = ce.box(['Cross', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]);
    expect(r.type.matches('vector')).toBe(true);
    // The evaluated result — an actual List of numbers — must satisfy the
    // declared type, not just the unevaluated node (whose type is trivially
    // the signature's).
    expect(r.evaluate().type.matches('vector')).toBe(true);
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
    expect(viaBox.json).toEqual(['List', -1, -35, 21]);
  });
});
