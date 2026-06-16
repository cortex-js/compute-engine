import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Parser: for-comprehensions', () => {
  describe('basic comprehension', () => {
    test('`x for x = [1...3]` → Loop with single Element', () => {
      const ast = parse('x \\operatorname{for} x = \\left[1...3\\right]');
      expect(ast).toEqual([
        'Loop', 'x', ['Element', 'x', ['Range', 1, 3]],
      ]);
    });

    test('tuple body: `(x, y) for x=L_1, y=L_2`', () => {
      const ast = parse(
        '(x, y) \\operatorname{for} x = \\left[1...2\\right], y = \\left[3...4\\right]'
      );
      expect(ast).toEqual([
        'Loop',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ]);
    });
  });

  describe('evaluation: independent bindings produce Cartesian product', () => {
    test('(x,y) for x=[1..2], y=[1..2] → 4 tuples', () => {
      const result = ce.parse(
        '(x, y) \\operatorname{for} x = \\left[1...2\\right], y = \\left[1...2\\right]'
      ).evaluate();
      // Result is a List/collection of 4 tuples
      const items = result.ops ?? [];
      expect(items.length).toBe(4);
    });
  });

  describe('evaluation: later bindings see earlier', () => {
    test('(x,y) for x=[1..3], y=[1..x] → triangle', () => {
      const result = ce.parse(
        '(x, y) \\operatorname{for} x = \\left[1...3\\right], y = \\left[1...x\\right]'
      ).evaluate();
      const items = result.ops ?? [];
      // 1+2+3 = 6 tuples: (1,1), (2,1), (2,2), (3,1), (3,2), (3,3)
      expect(items.length).toBe(6);
    });
  });

  describe('scope hygiene', () => {
    test('bound names do not leak to enclosing scope', () => {
      const ce2 = new (ce.constructor as any)();
      ce2.parse(
        'x \\operatorname{for} x = \\left[1...3\\right]'
      ).evaluate();
      // The for-clause's `x` should not leak. Re-parsing 'x' should not pick up the binding.
      const fresh = ce2.parse('x').json;
      expect(fresh).toBe('x');
    });
  });

  describe('precedence', () => {
    test('`(x + y) for x = L1, y = L2` — body is the sum, not just y', () => {
      ce.declare('L_1', 'list<number>');
      ce.declare('L_2', 'list<number>');
      const ast = parse(
        '(x + y) \\operatorname{for} x = L_1, y = L_2'
      );
      expect(ast).toEqual([
        'Loop',
        ['Add', 'x', 'y'],
        ['Element', 'x', 'L_1'],
        ['Element', 'y', 'L_2'],
      ]);
    });
  });

  describe('round-trip', () => {
    test('multi-Element for-comprehension round-trips', () => {
      const ast: any = [
        'Loop',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ];
      const expr = ce.expr(ast);
      const latex = expr.toLatex();
      expect(latex).toContain('\\operatorname{for}');
      const reparsed = ce.parse(latex).json;
      expect(reparsed).toEqual(ast);
    });

    test('single-Element non-Range comprehension round-trips', () => {
      // L_1 may already be declared by the precedence test — only declare if needed
      if (!ce.context.lexicalScope.bindings.has('L_1'))
        ce.declare('L_1', 'list<number>');
      const ast: any = ['Loop', ['Power', 'x', 2], ['Element', 'x', 'L_1']];
      const expr = ce.expr(ast);
      const latex = expr.toLatex();
      expect(latex).toContain('\\operatorname{for}');
      const reparsed = ce.parse(latex).json;
      expect(reparsed).toEqual(ast);
    });
  });
});
