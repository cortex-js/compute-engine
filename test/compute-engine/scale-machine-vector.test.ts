/**
 * `scalar · vector` over a vector of machine numbers is computed on doubles.
 *
 * The general route boxes every cell of the vector and builds a symbolic
 * product for it. When the vector and the scalar are machine numbers, and the
 * products are either exact integers or floats the engine computes as doubles
 * (machine precision), the doubles are the same values, and the answer is a
 * list that holds its numbers unboxed.
 *
 * Every case checks the VALUE against the cell-by-cell product; the fast path
 * is an optimization and must not change one.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

/** Does the list hold its numbers unboxed — was the fast path taken? */
const unboxed = (e: Expression): boolean =>
  (e as unknown as { _numericStore?: unknown })._numericStore !== undefined;

function machineEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  return ce;
}

describe('A scalar times a vector of machine numbers', () => {
  test('floats at machine precision are multiplied as doubles', () => {
    const ce = machineEngine();
    const r = ce.box(['Multiply', 2, ['List', 0.5, 1.25, -3.75]]).evaluate();
    expect(unboxed(r)).toBe(true);
    expect(r.json).toEqual(['List', 1, 2.5, -7.5]);
    expect(r.type.toString()).toBe(
      ce.box(['List', 1, 2.5, -7.5]).evaluate().type.toString()
    );
  });

  test('integers stay exact integers, at any precision', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Multiply', -3, ['List', 1, 2, -4, 0]]).evaluate();
    expect(unboxed(r)).toBe(true);
    expect(r.json).toEqual(['List', -3, -6, 12, 0]);
    expect(r.ops!.every((c) => c.isInteger === true)).toBe(true);
  });

  test('the N() route answers the same list', () => {
    const ce = machineEngine();
    const e = ce.box(['Multiply', 0.5, ['List', 3, 4.5, -1]]);
    expect(e.N().json).toEqual(['List', 1.5, 2.25, -0.5]);
    expect(e.evaluate().json).toEqual(['List', 1.5, 2.25, -0.5]);
  });

  test('a consumer reads the scaled vector as before', () => {
    const ce = machineEngine();
    const L = ['List', 1.5, 2, -0.25];
    expect(ce.box(['Sum', ['Multiply', 2, L]]).evaluate().re).toBe(6.5);
    expect(ce.box(['At', ['Multiply', 2, L], 3]).evaluate().re).toBe(-0.5);
    expect(
      ce.box(['Add', ['Multiply', 2, L], ['List', 1, 1, 1]]).evaluate().json
    ).toEqual(['List', 4, 5, 0.5]);
    expect(
      ce.box(['Dot', ['Multiply', 2, L], ['List', 1, 1, 1]]).evaluate().re
    ).toBe(6.5);
  });

  test('ten thousand elements', () => {
    const ce = machineEngine();
    const values = Array.from({ length: 10000 }, (_, i) => Math.sin(i));
    const r = ce.box(['Multiply', 2, ['List', ...values]]).evaluate();
    expect(unboxed(r)).toBe(true);
    expect(r.array).toEqual(values.map((v) => (2 * v === 0 ? 0 : 2 * v)));
  });
});

describe('The general route is kept where the doubles would differ', () => {
  test('an exact rational scalar keeps its products exact', () => {
    const ce = machineEngine();
    const r = ce.box(['Multiply', ['Rational', 1, 3], ['List', 1, 2]]).evaluate();
    expect(unboxed(r)).toBe(false);
    expect(r.json).toEqual(['List', ['Rational', 1, 3], ['Rational', 2, 3]]);
  });

  test('an exact rational element keeps its product exact', () => {
    const ce = machineEngine();
    const r = ce.box(['Multiply', 3, ['List', ['Rational', 1, 2], 2]]).evaluate();
    expect(unboxed(r)).toBe(false);
    expect(r.json).toEqual(['List', ['Rational', 3, 2], 6]);
  });

  test('floats above machine precision keep their digits', () => {
    const ce = new ComputeEngine(); // 21 digits by default
    const r = ce.box(['Multiply', 3, ['List', 0.1, 0.2]]).evaluate();
    expect(unboxed(r)).toBe(false);
    // 3 × 0.1 is 0.30000000000000004 as a double, and 0.3 in the engine.
    expect(r.ops![0].re).toBe(0.3);
  });

  test('a scalar made at a higher precision keeps its decimal arithmetic', () => {
    // The engine is set to machine precision AFTER the scalar was made, and
    // a big-number float keeps its digits: 0.1 × 3 is 0.3, where the doubles
    // give 0.30000000000000004.
    const ce = new ComputeEngine();
    ce.precision = 25;
    const tenth = ce.box({ num: '0.1' });
    ce.precision = 'machine';
    for (const vector of [
      ce.list([3, 1.5]),
      ce.function('List', [ce.number(3), ce.number(1.5)]),
    ]) {
      const r = ce.function('Multiply', [tenth, vector]).evaluate();
      expect(unboxed(r)).toBe(false);
      expect(r.json).toEqual(['List', 0.3, 0.15]);
    }
  });

  test('an element made at a higher precision is read as its double, as before', () => {
    // The cell products read a numeric vector from the packed tensor, which
    // holds doubles, so the digits of such an element never reached the
    // product: `3 · [N(1/3), 1]` was `[1, 3]` before the doubles were
    // multiplied directly, and it still is.
    const ce = new ComputeEngine();
    ce.precision = 25;
    const third = ce.box(['Divide', 1, 3]).N();
    ce.precision = 'machine';
    const vector = ce.function('List', [third, ce.number(1)]);
    const r = ce.function('Multiply', [ce.number(3), vector]).evaluate();
    expect(r.json).toEqual(['List', 1, 3]);
  });

  test('an integer product past the safe range is not rounded', () => {
    const ce = machineEngine();
    const big = 9007199254740991; // 2^53 − 1
    const r = ce.box(['Multiply', 3, ['List', big, 1]]).evaluate();
    expect(unboxed(r)).toBe(false);
    expect(r.ops![0].json).toEqual({ num: '27021597764222973' });
  });

  test('NaN and an infinity are left to the cell products', () => {
    const ce = machineEngine();
    const a = ce.box(['Multiply', 0, ['List', 'PositiveInfinity', 1]]).evaluate();
    expect(unboxed(a)).toBe(false);
    expect(a.ops![0].isNaN).toBe(true);
    const b = ce.box(['Multiply', 2, ['List', 'NaN', 1]]).evaluate();
    expect(b.ops![0].isNaN).toBe(true);
    expect(b.ops![1].re).toBe(2);
  });

  test('a symbolic scalar or element stays symbolic', () => {
    const ce = machineEngine();
    expect(ce.box(['Multiply', 'Pi', ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      'Pi',
      ['Multiply', 2, 'Pi'],
    ]);
    expect(ce.box(['Multiply', 2, ['List', 1, 'q']]).evaluate().json).toEqual([
      'List',
      2,
      ['Multiply', 2, 'q'],
    ]);
  });
});
