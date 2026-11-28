import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

// CE-1785: a substitution leaves an exact number literal (`√2/2`, whose
// structural form is `Divide(Sqrt(2), 2)`) as it is. In a scope where a user
// function shadows one of the library heads of that structural form, the
// literal is not rebuilt as a call of the user function.

function withUserFunction(
  name: string,
  literal: ((ce: ComputeEngine) => Expression) | undefined,
  fn: (ce: ComputeEngine, n: Expression | undefined) => void
): void {
  const ce = new ComputeEngine();
  // The literal is boxed before the user function is declared
  const n = literal?.(ce);
  ce.pushScope();
  ce.declare(name, 'function');
  ce.assign(name, ce.expr(['Function', 1000, 'u', 'v']));
  try {
    fn(ce, n);
  } finally {
    ce.popScope();
  }
}

const SQRT2_2 = (ce: ComputeEngine) => ce.expr(['Divide', ['Sqrt', 2], 2]);
const THREE_QUARTERS_SQRT2 = (ce: ComputeEngine) =>
  ce.expr(['Multiply', ['Rational', 3, 4], ['Sqrt', 2]]);
const SQRT2_1_PLUS_I = (ce: ComputeEngine) =>
  ce.expr(['Multiply', ['Sqrt', 2], ['Complex', 1, 1]]);

describe('CE-1785: a substitution in a scope with a user operator', () => {
  test('the witness: x·(√2)^{-1} with a user Divide', () => {
    withUserFunction('Divide', undefined, (ce) => {
      const e = ce.expr(['Multiply', 'x', ['Power', ['Sqrt', 2], -1]]);
      expect(e.json).toEqual(['Multiply', ['Divide', ['Sqrt', 2], 2], 'x']);
      expect(e.subs({ x: 2 }).evaluate().json).toEqual(['Sqrt', 2]);
    });
  });

  test.each<[string, (ce: ComputeEngine) => Expression]>([
    ['Divide', SQRT2_2],
    ['Sqrt', SQRT2_2],
    ['Negate', (ce) => ce.expr(['Negate', ['Sqrt', 2]])],
    ['Multiply', THREE_QUARTERS_SQRT2],
    ['Rational', THREE_QUARTERS_SQRT2],
    ['Complex', SQRT2_1_PLUS_I],
    ['Multiply', SQRT2_1_PLUS_I],
    ['Add', SQRT2_1_PLUS_I],
  ])('a user %s: the number keeps its value', (name, literal) => {
    withUserFunction(name, literal, (ce, n) => {
      n = n!;
      expect(isNumber(n)).toBe(true);
      expect(n.subs({ x: 2 })).toBe(n);
      const v = n.N();
      // In a product and in a sum whose operator is not the user's
      const cases: [string, number, number, number][] = [
        ['Multiply', 2, 2 * v.re, 2 * v.im],
        ['Add', 1, 1 + v.re, v.im],
      ];
      for (const [op, x, re, im] of cases) {
        if (op === name) continue;
        const r = ce.function(op, ['x', n]).subs({ x }).N();
        expect(r.re).toBeCloseTo(re, 12);
        expect(r.im).toBeCloseTo(im, 12);
      }
    });
  });
});

// A rule whose two sides box to the same number (`√(-1) → i`, both
// `Complex(0, 1)`) is no change on that number: `replace()` gives `null`.
// Since the inherited `subs()` returns the number, such a rewrite differed
// from the structural subject only in its form, and was reported as a step.
describe('CE-1785: a rule that rewrites a number to itself', () => {
  test.each<[unknown, unknown]>([
    [['Sqrt', -1], 'ImaginaryUnit'],
    [['Divide', 1, 'ImaginaryUnit'], ['Negate', 'ImaginaryUnit']],
  ])('%j → %j does not fire', (match, replace) => {
    const ce = new ComputeEngine();
    const rules = ce.rules(
      [{ match: ce.expr(match as never), replace: ce.expr(replace as never) }],
      { canonical: true }
    );
    expect(ce.expr(match as never).replace(rules)).toBeNull();
  });
});
