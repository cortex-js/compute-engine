import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The element-wise sum of two lists keeps exact elements exact under
// `evaluate()`. Before, the tensor kernel of `Add` combined the cells with
// the `.add()` method, which folds two exact number literals to a float:
// `[√2, 2] + [1, 1]` evaluated to `[2.414…, 3]`. Under `.N()` the cells
// are floats, as before.

const ce = new ComputeEngine();

function evaluateBox(expr: MathJsonExpression) {
  return ce.box(expr).evaluate();
}

describe('Element-wise Add of two lists stays exact', () => {
  test('list + list, box route', () => {
    expect(
      evaluateBox(['Add', ['List', ['Sqrt', 2], 2], ['List', 1, 1]]).toString()
    ).toBe('[1 + sqrt(2),3]');
  });

  test('list - list, box route', () => {
    expect(
      evaluateBox([
        'Subtract',
        ['List', ['Sqrt', 2], 2],
        ['List', 1, 1],
      ]).toString()
    ).toBe('[-1 + sqrt(2),1]');
  });

  test('list with a symbol + list', () => {
    expect(
      evaluateBox([
        'Add',
        ['List', ['Sqrt', 2], 'x'],
        ['List', 1, 1],
      ]).toString()
    ).toBe('[1 + sqrt(2),x + 1]');
  });

  test('two radicals in the same cell', () => {
    expect(
      evaluateBox([
        'Add',
        ['List', ['Sqrt', 2], 2],
        ['List', ['Sqrt', 3], 1],
      ]).toString()
    ).toBe('[sqrt(2) + sqrt(3),3]');
  });

  test('list + list + scalars', () => {
    expect(
      evaluateBox([
        'Add',
        ['List', ['Sqrt', 2], 2],
        ['List', 1, 1],
        ['Sqrt', 5],
        1,
      ]).toString()
    ).toBe('[2 + sqrt(2) + sqrt(5),4 + sqrt(5)]');
  });

  test('matrix + matrix', () => {
    expect(
      evaluateBox([
        'Add',
        ['List', ['List', ['Sqrt', 2], 2], ['List', 3, ['Rational', 1, 3]]],
        ['List', ['List', 1, 1], ['List', 1, 1]],
      ]).toString()
    ).toBe('[[1 + sqrt(2),3],[4,4/3]]');
  });

  test('list + list, parse route', () => {
    const expr = ce.parse('[\\sqrt{2}, 2] + [1, 1]');
    expect(expr.operator).toBe('Add');
    expect(expr.evaluate().toString()).toBe('[1 + sqrt(2),3]');
  });

  test('list - list, parse route', () => {
    expect(ce.parse('[\\sqrt{2}, 2] - [1, 1]').evaluate().toString()).toBe(
      '[-1 + sqrt(2),1]'
    );
  });

  // Cases that were already correct: they must stay so.
  test('list + scalar', () => {
    expect(evaluateBox(['Add', ['List', ['Sqrt', 2], 2], 1]).toString()).toBe(
      '[1 + sqrt(2),3]'
    );
  });

  test('list + list with a rational', () => {
    expect(
      evaluateBox([
        'Add',
        ['List', ['Rational', 1, 3], 2],
        ['List', 1, 1],
      ]).toString()
    ).toBe('[4/3,3]');
  });

  test('list * list', () => {
    expect(
      evaluateBox([
        'Multiply',
        ['List', ['Sqrt', 2], 2],
        ['List', ['Sqrt', 3], 1],
      ]).toString()
    ).toBe('[sqrt(6),2]');
  });

  test('.N() of list + list gives floats', () => {
    const result = ce
      .box(['Add', ['List', ['Sqrt', 2], 2], ['List', 1, 1]])
      .N();
    expect(result.operator).toBe('List');
    const [first, second] = result.ops!;
    expect(first.isNumberLiteral).toBe(true);
    expect(first.re).toBeCloseTo(1 + Math.SQRT2, 12);
    expect(second.re).toBe(3);
  });
});
