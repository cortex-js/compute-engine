import type { MathJsonExpression } from '../../../src/math-json/types';
import { ComputeEngine } from '../../../src/compute-engine';

// Tycho ask 311 (2026-09-24): the LaTeX serializer did not fence the operands
// of a non-canonical `InvisibleOperator` (a juxtaposition), and it did not
// fence an `InvisibleOperator` under a tighter-binding parent. The LaTeX then
// re-parsed as a different expression, for example
// `InvisibleOperator(y, Negate(x))` → `y-x` (a subtraction, a different
// value). The fence now follows the rule that the `Multiply` serializer uses.
//
// The assertion is the round trip: serialize the raw (or structural) form,
// parse the LaTeX, and compare with the canonical form of the input.

const ce = new ComputeEngine();

function roundTrip(
  json: MathJsonExpression,
  form: 'raw' | 'structural'
): { latex: string; back: string; ok: boolean } {
  const latex = ce.box(json, { form }).latex;
  const back = ce.parse(latex);
  return {
    latex,
    back: JSON.stringify(back.json),
    ok: back.isSame(ce.box(json)),
  };
}

const SHAPES: [MathJsonExpression, string][] = [
  [['InvisibleOperator', ['Mod', 'R', 2], ['Sin', 'a']], '(R\\bmod2)\\sin(a)'],
  [['InvisibleOperator', 3, ['Mod', 'R', 2]], '3(R\\bmod2)'],
  // A fence right after a bare symbol gets an explicit multiplication:
  // `x(R\bmod2)` would re-parse as a call of `x`.
  [['InvisibleOperator', 'x', ['Mod', 'R', 2]], 'x\\times(R\\bmod2)'],
  [['InvisibleOperator', ['Add', 'x', 1], ['Add', 'x', 2]], '(x+1)(x+2)'],
  [['Power', ['InvisibleOperator', 2, 'x'], 2], '(2x)^2'],
  [['Factorial', ['InvisibleOperator', 2, 'x']], '(2x)!'],
  [['InvisibleOperator', 'y', ['Negate', 'x']], 'y\\times(-x)'],
  [['Negate', ['InvisibleOperator', 2, 'x']], '-(2x)'],
  [['Divide', ['InvisibleOperator', 2, 'x'], 3], '\\frac{2x}{3}'],
  [['InvisibleOperator', ['Negate', 'x'], 'y'], '-xy'],
  [['InvisibleOperator', 'y', -2], 'y\\times(-2)'],
  [['InvisibleOperator', 'x', ['Add', 'a', 'b']], 'x\\times(a+b)'],
  [
    ['InvisibleOperator', 'x', ['Negate', ['Add', 'a', 'b']]],
    'x\\times(-(a+b))',
  ],
  // Two digits must not touch, or they re-parse as one number.
  [['InvisibleOperator', 2, 3], '2\\times3'],
  [['InvisibleOperator', 3, ['Power', 2, 2]], '3\\times2^2'],
  // A library constant before a fence keeps the juxtaposition.
  [['InvisibleOperator', 'Pi', ['Add', 'x', 1]], '\\pi(x+1)'],
  [['InvisibleOperator', 'K', ['Add', 'x', 1]], 'K\\times(x+1)'],
  // Unchanged spellings: parentheses written by the user, a mixed number,
  // and a juxtaposition inside a looser parent.
  [['InvisibleOperator', 'x', ['Delimiter', ['Add', 'a', 'b']]], 'x(a+b)'],
  [['InvisibleOperator', 2, ['Rational', 1, 2]], '2\\frac{1}{2}'],
  [['Subtract', 'a', ['InvisibleOperator', 2, 'x']], 'a-2x'],
  [['Mod', ['InvisibleOperator', 3, 'k'], 2], '3k\\bmod2'],
  [['Power', 'x', ['InvisibleOperator', 2, 'y']], 'x^{2y}'],
  [['Power', ['InvisibleOperator', 'f', ['Delimiter', 'x']], 2], '(f(x))^2'],
];

describe('INVISIBLE OPERATOR FENCING (Tycho ask 311)', () => {
  for (const form of ['raw', 'structural'] as const) {
    describe(`form: ${form}`, () => {
      test.each(SHAPES)('%j', (json, expectedLatex) => {
        const { latex, back, ok } = roundTrip(json, form);
        expect(latex).toBe(expectedLatex);
        // Show the re-parsed form on failure.
        expect({ back, ok }).toEqual({ back, ok: true });
      });
    });
  }
});
