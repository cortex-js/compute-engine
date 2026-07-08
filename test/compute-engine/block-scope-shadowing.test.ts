import { engine as ce } from '../utils';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Two engine-semantics behaviors for statement-position constructs:
 *
 * 1. A bare *symbol* `Break`/`Continue` (as opposed to the function form
 *    `Break()`/`Continue()`) in statement position canonicalizes to an error.
 *
 * 2. A block-local `Declare` of a constant-named symbol (`i`, `e`, `Pi`, …)
 *    shadows the constant for the rest of the block, so subsequent uses are
 *    ordinary variables (no imaginary-unit / e / Pi folding). The shadow ends
 *    at block exit.
 */

/** True if the expression tree contains an `Error` node. */
function hasError(expr: any): boolean {
  if (!expr) return false;
  if (expr.operator === 'Error') return true;
  return (expr.ops ?? []).some((op: any) => hasError(op));
}

describe('bare Break/Continue in statement position → Error', () => {
  test('bare `Break` as a Block statement is an error', () => {
    const block = ce.box(['Block', 'Break', ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).toBe('Error');
  });

  test('bare `Continue` in an If branch inside a Loop is an error', () => {
    const loop = ce.box([
      'Loop',
      ['If', ['Equal', 'x', 1], 'Continue', ['Assign', 'x', 1]],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(hasError(loop)).toBe(true);
  });

  test('function form `Break()` in a Block stays valid', () => {
    const block = ce.box(['Block', ['Break'], ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).toBe('Break');
    expect(hasError(block)).toBe(false);
  });

  test('function form `Continue()` in an If branch inside a Loop stays valid', () => {
    const loop = ce.box([
      'Loop',
      ['If', ['Equal', 'x', 1], ['Continue'], ['Assign', 'x', 1]],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(hasError(loop)).toBe(false);
  });

  test('bare `Return` is left untouched (not an error)', () => {
    const block = ce.box(['Block', 'Return', ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).not.toBe('Error');
  });
});

describe('block-local Declare shadows a constant-named symbol', () => {
  test('local `i` shadows the imaginary unit (no Complex fold), evaluates to 4', () => {
    const block = ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    // The trailing `Add(i, 1)` must NOT fold to `Complex(1, 1)`.
    expect(block.ops![2].operator).not.toBe('Complex');
    expect(block.evaluate().toString()).toBe('4');
  });

  test('local `e` shadows Euler’s number, evaluates to 6', () => {
    const block = ce.box([
      'Block',
      ['Declare', 'e', { str: 'integer' }],
      ['Assign', 'e', 2],
      ['Multiply', 'e', 3],
    ]);
    expect(block.evaluate().toString()).toBe('6');
  });

  test('after the Block, `i` is the imaginary unit again', () => {
    ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    // A fresh `Add(i, 1)` outside any block folds to the imaginary unit.
    expect(ce.box(['Add', 'i', 1]).operator).toBe('Complex');
  });

  test('Python compile of a Block declaring a local `i` emits bare `i`', () => {
    const python = new PythonTarget();
    const block = ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    const code = python.compile(block).code;
    expect(code).not.toContain('complex');
    expect(code).toContain('i + 1');
  });

  test('`Assign(i, 3)` without a Declare still throws (constant)', () => {
    expect(() => ce.box(['Block', ['Assign', 'i', 3]]).evaluate()).toThrow(
      /constant/
    );
  });
});
