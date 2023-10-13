import { engine } from '../utils';
const ce = engine;
describe('CONTROL STRUCTURES', () => {
  describe('Block', () => {
    it('should evaluate a block wiht a single expression', () => {
      const expr = ce.box(['Block', ['Multiply', 10, 2]]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`20`);
    });

    it('should evaluate a block wiht multiple expressions', () => {
      const expr = ce.box(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`20`);
    });

    it('should evaluate the block with an assignment', () => {
      const expr = ce.box(['Block', ['Assign', 'c', 5], ['Multiply', 'c', 2]]);
      const result = expr.evaluate();
      expect(result.json).toMatchInlineSnapshot(`10`);
    });

    it('should evaluate the block with a return statement', () => {
      const expr = ce.box([
        'Block',
        ['Add', 1, 1],
        ['Return', 3],
        ['Add', 2, 2],
      ]);
      const result = expr.evaluate();
      expect(result.json).toMatchInlineSnapshot(`["Return", 3]`);
    });
  });

  describe('If', () => {
    it('should execute the true branch', () => {
      const expr = ce.box(['If', ['Equal', ['Subtract', 1, 1], 0], 42, 99]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`42`);
    });

    it('should execute the false branch', () => {
      const expr = ce.box(['If', ['Equal', ['Subtract', 1, 2], 0], 42, 99]);
      const result = expr.evaluate();
      expect(result.latex).toMatchInlineSnapshot(`99`);
    });
  });
});
