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
  });
});
