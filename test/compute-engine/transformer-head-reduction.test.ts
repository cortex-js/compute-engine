import { ComputeEngine } from '../../src/compute-engine';
import '../utils'; // For snapshot serializers

// A structural algorithm that holds its expression operand (Solve, Integrate,
// Limit) must reduce a transformer head (Simplify, Expand, Factor, …) before
// running: `Solve(Simplify(eq), x)` means "simplify, then solve", not "solve
// an expression whose operator is Simplify" (which finds no roots). This is
// how a multi-stage pipeline (`expr |> Simplify |> Solve`) reaches the
// algorithm. (Tycho 0.72.0 report, open item 7.)
//
// Blanket evaluation would be unsound: an `Equal` collapses to a boolean, and
// assigned symbol values would substitute into the unknown. Only the curated
// transformer heads are reduced — see `reduceTransformerHead()` in
// boxed-expression/utils.ts.

const ce = new ComputeEngine();

describe('Transformer-head reduction in hold operators', () => {
  describe('Solve', () => {
    test('Solve(Simplify(expr), x) solves the simplified expression', () => {
      const e = ce.box([
        'Solve',
        ['Simplify', ['Add', ['Power', 'x', 2], ['Multiply', 2, 'x'], 1]],
        'x',
      ]);
      expect(e.evaluate().json).toEqual(['List', -1]);
    });

    test('the pipeline `expr |> Simplify |> Solve` (Tycho repro)', () => {
      const e = ce.parse(
        'x^2+2x+1\\rhd\\operatorname{Simplify}\\rhd\\operatorname{Solve}'
      );
      expect(e.evaluate().json).toEqual(['List', -1]);
    });

    test('Solve(Expand(product), x) solves the expanded polynomial', () => {
      const e = ce.box([
        'Solve',
        ['Expand', ['Multiply', ['Add', 'x', 1], ['Add', 'x', 2]]],
        'x',
      ]);
      expect(e.evaluate().json).toEqual(['List', -1, -2]);
    });

    test('an Equal equation still solves (no relational collapse)', () => {
      const e = ce.box(['Solve', ['Equal', ['Power', 'x', 2], 1], 'x']);
      expect(e.evaluate().json).toEqual(['List', 1, -1]);
    });

    test('unknown inference still works through a transformer head', () => {
      const e = ce.box(['Solve', ['Simplify', ['Add', ['Power', 'x', 2], -4]]]);
      expect(e.evaluate().json).toEqual(['List', 2, -2]);
    });
  });

  describe('Integrate', () => {
    test('∫ Simplify(x²) dx integrates the simplified integrand', () => {
      const e = ce.box(['Integrate', ['Simplify', ['Power', 'x', 2]], 'x']);
      expect(e.evaluate().json).toEqual([
        'Multiply',
        ['Rational', 1, 3],
        ['Power', 'x', 3],
      ]);
    });

    test('plain and nested definite integrals are unchanged', () => {
      expect(ce.parse('\\int_0^1 x^2 dx').evaluate().json).toEqual([
        'Rational',
        1,
        3,
      ]);
      expect(
        ce.parse('\\int_0^1\\int_3^4 xy\\,dx\\,dy').evaluate().json
      ).toEqual(['Rational', 7, 4]);
    });
  });

  describe('Limit', () => {
    test('Limit(Simplify(sin x / x), 0) computes the limit', () => {
      const e = ce.box([
        'Limit',
        ['Simplify', ['Divide', ['Sin', 'x'], 'x']],
        0,
      ]);
      expect(e.evaluate().json).toEqual(1);
    });

    test('plain limit is unchanged', () => {
      expect(
        ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}').evaluate().json
      ).toEqual(1);
    });
  });
});
