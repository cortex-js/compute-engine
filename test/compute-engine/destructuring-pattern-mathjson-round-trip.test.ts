import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * `toMathJson()` writes a value `Tuple` of one, two or three elements as
 * `Single`, `Pair` or `Triple`. A destructuring pattern is not a value: the
 * canonical forms of `Function`, `Assign` and `Declare` read it as a raw
 * `Tuple` and refuse `Pair`. These tests pin that a pattern keeps `Tuple`,
 * so that `ce.box(e.toMathJson())` gives back the same expression.
 */

function roundTrip(ce: ComputeEngine, json: MathJsonExpression) {
  const expr = ce.box(json);
  const pretty = expr.toMathJson();
  const reboxed = ce.box(pretty);
  return { expr, pretty, reboxed };
}

describe('DESTRUCTURING PATTERN: MathJSON round trip', () => {
  test.each([
    [['Tuple', 'x']],
    [['Tuple', 'x', 'y']],
    [['Tuple', 'x', 'y', 'z']],
  ] as MathJsonExpression[][])(
    'a Function parameter %j keeps Tuple',
    (pattern) => {
      const ce = new ComputeEngine();
      const { expr, pretty, reboxed } = roundTrip(ce, [
        'Function',
        ['Multiply', 'x', 'y'],
        pattern,
      ]);
      expect(pretty).toEqual(['Function', ['Multiply', 'x', 'y'], pattern]);
      expect(reboxed.isValid).toBe(true);
      expect(reboxed.isSame(expr)).toBe(true);
    }
  );

  test('a nested pattern keeps Tuple at each level, and the function applies', () => {
    const ce = new ComputeEngine();
    const { pretty, reboxed } = roundTrip(ce, [
      'Function',
      ['Add', 'p', 'q', 'r'],
      ['Tuple', 'p', ['Tuple', 'q', 'r']],
    ]);
    expect(pretty).toEqual([
      'Function',
      ['Add', 'p', 'q', 'r'],
      ['Tuple', 'p', ['Tuple', 'q', 'r']],
    ]);
    const applied = ce
      .box(['Apply', reboxed.json, ['Tuple', 1, ['Tuple', 2, 3]]])
      .evaluate();
    expect(applied.re).toBe(6);
  });

  test('a value Tuple in the body of the function is still written Pair', () => {
    const ce = new ComputeEngine();
    const { pretty } = roundTrip(ce, [
      'Function',
      ['Tuple', 'y', 'x'],
      ['Tuple', 'x', 'y'],
    ]);
    expect(pretty).toEqual(['Function', ['Pair', 'y', 'x'], ['Tuple', 'x', 'y']]);
  });

  test('the target of an Assign keeps Tuple, its value is written Pair', () => {
    const ce = new ComputeEngine();
    const { expr, pretty, reboxed } = roundTrip(ce, [
      'Block',
      ['Declare', 'a', "'unknown'", 0],
      ['Declare', 'b', "'unknown'", 0],
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(pretty).toEqual([
      'Block',
      ['Declare', 'a', "'unknown'", 0],
      ['Declare', 'b', "'unknown'", 0],
      ['Assign', ['Tuple', 'a', 'b'], ['Pair', 1, 2]],
      ['Add', 'a', 'b'],
    ]);
    expect(reboxed.isValid).toBe(true);
    expect(reboxed.isSame(expr)).toBe(true);
    expect(reboxed.evaluate().re).toBe(3);
  });

  test('the target of a Declare keeps Tuple', () => {
    const ce = new ComputeEngine();
    const { expr, pretty, reboxed } = roundTrip(ce, [
      'Block',
      [
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        'unknown',
        ['Tuple', 1, ['Tuple', 2, 3]],
      ],
      ['Add', 'a', 'b', 'c'],
    ]);
    expect(pretty).toEqual([
      'Block',
      [
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        'unknown',
        ['Pair', 1, ['Pair', 2, 3]],
      ],
      ['Add', 'a', 'b', 'c'],
    ]);
    expect(reboxed.isValid).toBe(true);
    expect(reboxed.isSame(expr)).toBe(true);
    expect(reboxed.evaluate().re).toBe(6);
  });
});
