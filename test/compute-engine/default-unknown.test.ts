import { engine as ce } from '../utils';

// Operators whose variable/unknown argument may be omitted. The default is
// inferred from the input's free variables: the single free variable, or `x`
// when there are several free variables and one of them is `x`. When no
// default can be inferred, the expression stays inert (no guessing).
//
// `Solve` follows the same rule; its tests live in solve.test.ts.

describe('DEFAULT UNKNOWN INFERENCE', () => {
  describe('D', () => {
    test('single free variable', () => {
      expect(ce.expr(['D', ['Sin', 'y']]).evaluate().json).toEqual([
        'Cos',
        'y',
      ]);
    });

    test('several free variables: defaults to x', () => {
      const implicit = ce.expr(['D', ce.parse('a x^2')]).evaluate();
      const explicit = ce.expr(['D', ce.parse('a x^2'), 'x']).evaluate();
      expect(implicit.isSame(explicit)).toBe(true);
    });

    test('no default (several free variables, none named x): stays inert', () => {
      const e = ce.expr(['D', ce.parse('a b^2')]);
      expect(e.operator).toBe('D');
      expect(e.nops).toBe(1);
    });

    test('D(f) of a defined function symbol is not affected', () => {
      ce.pushScope();
      try {
        ce.assign('g_du', ce.parse('t \\mapsto 2t'));
        const e = ce.expr(['D', 'g_du']);
        // Same shape as before the default-variable feature: the function
        // symbol is applied, no inferred variable is injected.
        expect(e.json).toEqual(['D', ['g_du']]);
      } finally {
        ce.popScope();
      }
    });

    test('pipeline: x^2 |> D', () => {
      expect(
        ce.parse('x^2 \\rhd \\operatorname{D}').evaluate().json
      ).toEqual(['Multiply', 2, 'x']);
    });
  });

  describe('Series', () => {
    test('single free variable', () => {
      const implicit = ce.expr(['Series', ['Sin', 'y']]).evaluate();
      const explicit = ce.expr(['Series', ['Sin', 'y'], 'y']).evaluate();
      expect(implicit.isSame(explicit)).toBe(true);
    });

    test('several free variables: defaults to x', () => {
      const implicit = ce.expr(['Series', ce.parse('a\\sin x')]).evaluate();
      const explicit = ce
        .expr(['Series', ce.parse('a\\sin x'), 'x'])
        .evaluate();
      expect(implicit.isSame(explicit)).toBe(true);
    });
  });

  describe('polynomial operators', () => {
    test('PolynomialDegree', () => {
      expect(
        ce.expr(['PolynomialDegree', ce.parse('y^3+2y')]).evaluate().re
      ).toBe(3);
    });

    test('CoefficientList prefers x among several free variables', () => {
      expect(
        ce.expr(['CoefficientList', ce.parse('a x^2 + b')]).evaluate().json
      ).toEqual(['List', 'a', 0, 'b']);
    });

    test('PolynomialQuotient infers from both operands', () => {
      expect(
        ce
          .expr(['PolynomialQuotient', ce.parse('y^3-1'), ce.parse('y-1')])
          .evaluate().json
      ).toEqual(['Add', ['Power', 'y', 2], 'y', 1]);
    });

    test('PolynomialRemainder', () => {
      expect(
        ce
          .expr(['PolynomialRemainder', ce.parse('x^3+2x+1'), ce.parse('x+1')])
          .evaluate().re
      ).toBe(-2);
    });

    test('PolynomialGCD', () => {
      expect(
        ce
          .expr(['PolynomialGCD', ce.parse('y^2-1'), ce.parse('y-1')])
          .evaluate().json
      ).toEqual(['Add', 'y', -1]);
    });

    test('Resultant', () => {
      expect(
        ce.expr(['Resultant', ce.parse('x^2-1'), ce.parse('x-1')]).evaluate()
          .re
      ).toBe(0);
    });

    test('Cancel', () => {
      expect(
        ce
          .expr(['Cancel', ce.parse('\\frac{y^2-1}{y-1}')])
          .evaluate().json
      ).toEqual(['Add', 'y', 1]);
    });

    test('Apart (pipeline form)', () => {
      const implicit = ce
        .parse('\\frac{1}{(y+1)(y+2)} \\rhd \\operatorname{Apart}')
        .evaluate();
      const explicit = ce
        .expr(['PartialFraction', ce.parse('\\frac{1}{(y+1)(y+2)}'), 'y'])
        .evaluate();
      expect(implicit.isSame(explicit)).toBe(true);
    });

    test('PolynomialRoots', () => {
      const r = ce.expr(['PolynomialRoots', ce.parse('y^2-5y+6')]).evaluate();
      expect(r.operator).toBe('Set');
      expect(r.ops!.map((x) => x.re).sort()).toEqual([2, 3]);
    });

    test('Discriminant', () => {
      expect(
        ce.expr(['Discriminant', ce.parse('y^2-5y+6')]).evaluate().re
      ).toBe(1);
    });

    test('no default: stays inert', () => {
      const e = ce
        .expr(['PolynomialDegree', ce.parse('a b^2')])
        .evaluate();
      expect(e.operator).toBe('PolynomialDegree');
    });
  });
});
