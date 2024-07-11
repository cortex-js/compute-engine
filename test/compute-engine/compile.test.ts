import { engine as ce } from '../utils';

describe('COMPILE', () => {
  describe('Expressions', () => {
    it('should compile (and simplify) a simple expression', () => {
      expect(
        ce.parse('3.45 + \\frac57').compile()?.toString()
      ).toMatchInlineSnapshot(`4.164285714285715`);
    });

    it('should compile an expression with a constant', () => {
      expect(
        ce.parse('2\\exponentialE').compile()?.toString()
      ).toMatchInlineSnapshot(`2 * Math.E`);
    });

    it('should compile an expression with trig functions', () => {
      expect(
        ce.parse('2 \\cos(\\frac{\\pi}{5})').compile()?.toString()
      ).toMatchInlineSnapshot(`0.5 * (Math.sqrt(5) + 1)`);
    });
  });

  describe('Blocks', () => {
    it('should compile a simple block', () => {
      const expr = ce.box(['Block', ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`20`);
    });

    it('should compile a block with two statements', () => {
      const expr = ce.box(['Block', ['Add', 13, 15], ['Multiply', 10, 2]]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        28;
        return 20
        })()
      `);
    });

    it('should compile a block with a declaration', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Multiply', 'x', 'n'],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return _.n * x
        })()
      `);
    });

    it('should compile a block with a return statement', () => {
      const expr = ce.box([
        'Block',
        ['Declare', 'x', 'Numbers'],
        ['Assign', 'x', 4.1],
        ['Return', ['Add', 'x', 1]],
        ['Multiply', 'x', 2],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(`
        (() => {
        let x;
        x = 4.1;
        return x + 1;
        return 2 * x
        })()
      `);
    });
  });

  describe('Conditionals / Ifs', () => {
    it('should compile an if statement', () => {
      const expr = ce.box(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });

    it('should compile an if statement with blocks', () => {
      const expr = ce.box([
        'If',
        ['Greater', 'x', 0],
        ['Block', 'x'],
        ['Block', ['Negate', 'x']],
      ]);
      expect(expr.compile()?.toString() ?? '').toMatchInlineSnapshot(
        `((0 < _.x) ? (_.x) : (-_.x))`
      );
    });
  });
});
