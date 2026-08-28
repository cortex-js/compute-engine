import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';
describe('CONTROL STRUCTURES', () => {
  describe('Block', () => {
    it('should evaluate a block with a single expression', () => {
      const expr = ce.expr(['Block', ['Multiply', 10, 2]]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`20`);
    });

    it('should evaluate a block with multiple expressions', () => {
      const expr = ce.expr(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`20`);
    });

    it('should evaluate the block with an assignment', () => {
      const expr = ce.expr(['Block', ['Assign', 'c', 5], ['Multiply', 'c', 2]]);
      const result = expr.evaluate();
      expect(result.json).toMatchInlineSnapshot(`10`);
    });

    it('should evaluate the block with a return statement', () => {
      const expr = ce.expr([
        'Block',
        ['Add', 1, 1],
        ['Return', 3],
        ['Add', 2, 2],
      ]);
      const result = expr.evaluate();
      // The Return short-circuits the block, and the Block's value is the
      // Return expression itself: it propagates through nested blocks and
      // loops until a function application unwraps it.
      expect(result.json).toMatchInlineSnapshot(`
        [
          Return,
          3,
        ]
      `);
    });

    it('should short-circuit when a statement evaluates to a control-flow expression', () => {
      // The If statement is not literally a Return, but evaluates to one:
      // the block must stop, not run the following statements.
      const expr = ce.expr([
        'Block',
        ['If', 'True', ['Return', 3], 'Nothing'],
        ['Add', 2, 2],
      ]);
      const result = expr.evaluate();
      expect(result.json).toMatchInlineSnapshot(`
        [
          Return,
          3,
        ]
      `);
    });

    it('should short-circuit on a statement that evaluates to an Error value', () => {
      // A non-final statement's value is discarded, so a refusal that IS the
      // statement's value (a mistyped protocol write, an indexed assignment
      // the engine rejects) used to VANISH — execution continued past the
      // fault and the block answered 42. It now propagates like control
      // flow: the error is the block's value.
      const eng = new ComputeEngine();
      const expr = eng.box([
        'Block',
        ['Error', { str: 'test-fault' }],
        42,
      ] as any);
      const result = expr.evaluate();
      expect(result.operator).toBe('Error');
    });
  });

  describe('Loop faults and index typing', () => {
    it('a loop stops on a body Error value and surfaces it', () => {
      // The body's statement list short-circuits on the fault (above); the
      // loop must then STOP with the error as its value — before, each
      // iteration's error was discarded and the loop answered `Nothing`.
      const eng = new ComputeEngine();
      const expr = eng.box([
        'Loop',
        ['Block', ['Error', { str: 'test-fault' }], 1],
        ['Element', 'i', ['Range', 1, 5]],
      ] as any);
      const result = expr.evaluate();
      expect(result.operator).toBe('Error');
    });

    it('a bare infinite loop stops on a body Error value', () => {
      // Before, the fault was discarded every iteration and the loop ran to
      // the iteration limit (a CancellationError throw). Now the first
      // faulting iteration ends it with the error as the loop's value.
      const eng = new ComputeEngine();
      const expr = eng.box([
        'Loop',
        ['Block', ['Error', { str: 'test-fault' }], 1],
      ] as any);
      const result = expr.evaluate();
      expect(result.operator).toBe('Error');
    });

    it('a loop index over an integer Range is integer-typed', () => {
      // The binder hook declares the index `unknown` and arithmetic use then
      // widened it to `number` — so `10 * i` typed `finite_number`, wide
      // enough to falsely refuse an `integer`-declared protocol-property
      // write. The Element clause now gives the fresh binding the
      // collection's element type.
      const eng = new ComputeEngine();
      const loop = eng.box([
        'Loop',
        ['Block', ['Assign', 'acc', ['Multiply', 10, 'i']]],
        ['Element', 'i', ['Range', 1, 3]],
      ] as any);
      const index = loop.ops![1].ops![0];
      expect(index.type.matches('integer')).toBe(true);
      // The product inherits it.
      const product = loop.ops![0].ops![0].ops![1];
      expect(product.type.matches('integer')).toBe(true);
      // A float-element collection must NOT claim integer.
      const eng2 = new ComputeEngine();
      const loop2 = eng2.box([
        'Loop',
        ['Block', ['Assign', 'acc', ['Multiply', 10, 'x']]],
        ['Element', 'x', ['List', 0.5, 1.5]],
      ] as any);
      expect(loop2.ops![1].ops![0].type.matches('integer')).toBe(false);
      expect(loop2.ops![1].ops![0].type.matches('real')).toBe(true);
      // An ALIAS collection type contributes its element type too (the
      // reference is resolved before the element type is read).
      const eng3 = new ComputeEngine();
      eng3.declareType('ints', 'list<integer>');
      eng3.declare('xs', 'ints');
      const loop3 = eng3.box([
        'Loop',
        ['Block', ['Assign', 'acc', ['Multiply', 10, 'x']]],
        ['Element', 'x', 'xs'],
      ] as any);
      expect(loop3.ops![1].ops![0].type.matches('integer')).toBe(true);
    });
  });

  describe('If', () => {
    it('should execute the true branch', () => {
      const expr = ce.expr(['If', ['Equal', ['Subtract', 1, 1], 0], 42, 99]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`42`);
    });

    it('should execute the false branch', () => {
      const expr = ce.expr(['If', ['Equal', ['Subtract', 1, 2], 0], 42, 99]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`99`);
    });

    // Without an else branch a false condition evaluates to Missing (the
    // no-selection ruling of 2026-08-27); the static type must keep the
    // `missing` arm.
    it('types a missing else branch as `| missing`', () => {
      ce.declare('ifCond57', 'boolean');
      const expr = ce.expr(['If', 'ifCond57', 42]);
      expect(expr.type.matches('finite_integer | missing')).toBe(true);
      expect(expr.type.matches('finite_integer')).toBe(false);
      const both = ce.expr(['If', 'ifCond57', 42, 99]);
      expect(both.type.matches('finite_integer')).toBe(true);
    });
  });
});
