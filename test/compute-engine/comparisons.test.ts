import { ComputeEngine } from '../../src/compute-engine';
import { MathJsonExpression as Expression } from '../../src/math-json/types';
import { latex } from '../utils';

export const engine = new ComputeEngine();

/*
    [a, b, compare(a,b)]
*/
const exprs: [Expression, Expression, number | undefined][] = [
  [1, 1, 0], // 1 === 1
  [1, 0, 1], // 1 > 0
  [2, 5, -1],
  [5, 2, 1],
  [7, 7, 0],

  [1, 'Pi', -1],
  ['Pi', 'Pi', 0],
  [4, 'Pi', 1],
  ['Pi', 1, 1],
  ['Pi', 4, -1],

  [1, 'x', undefined],
  ['x', 1, undefined],
  ['x', 'y', undefined],
  ['x', ['Foo'], undefined],
];

// describe.skip('COMPARE', () => {
//   for (const expr of exprs) {
//     test(`compare(${latex(expr[0])}, ${latex(expr[1])})`, () => {
//       expect(engine.compare(expr[0], expr[1])).toEqual(expr[2]);
//     });
//   }
// });

describe('EQUAL', () => {
  for (const expr of exprs) {
    test(`equal(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.expr(expr[0]).isEqual(engine.expr(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] === 0 ? true : false
      );
    });
  }
});

describe('LESS THAN', () => {
  for (const expr of exprs) {
    test(`less(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.expr(expr[0]).isLess(engine.expr(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] < 0 ? true : false
      );
    });
  }
});

describe('LESS EQUAL', () => {
  for (const expr of exprs) {
    test(`lessEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.expr(expr[0]).isLessEqual(engine.expr(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] <= 0 ? true : false
      );
    });
  }
});

describe('GREATER', () => {
  for (const expr of exprs) {
    test(`greater(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.expr(expr[0]).isGreater(engine.expr(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] > 0 ? true : false
      );
    });
  }
});

describe('GREATER EQUAL', () => {
  for (const expr of exprs) {
    test(`greaterEqual(${latex(expr[0])}, ${latex(expr[1])})`, () => {
      expect(engine.expr(expr[0]).isGreaterEqual(engine.expr(expr[1]))).toEqual(
        expr[2] === undefined ? undefined : expr[2] >= 0 ? true : false
      );
    });
  }
});

// Regressions for the comparison bugs reported in REVIEW.md (A1, A3).
describe('Comparison correctness (REVIEW.md A1, A3)', () => {
  // A1: cmp() treated an eq-handler result of `false` (definitely NOT equal) as
  // equality, so unordered values like lists wrongly compared as <= / equal.
  test('A1: unordered lists do not compare as <= or equal', () => {
    const ce = new ComputeEngine();
    const a = ce.expr(['List', 1, 2]);
    const b = ce.expr(['List', 3, 4]);
    expect(a.isLessEqual(b)).toBeUndefined();
    expect(a.isLess(b)).toBeUndefined();
    expect(a.isEqual(b)).toBe(false);
    // identical lists are still equal.
    // Phase C representation unification: `isEqual` takes a boxed operand
    // (`number | Expression`); the raw-MathJSON form used to work only via the
    // now-removed BoxedTensor.isEqual override, so box the argument.
    expect(ce.expr(['List', 1, 2]).isEqual(ce.expr(['List', 1, 2]))).toBe(true);
  });

  // A3: strict/opposite predicates returned a definitive `false` for the
  // indeterminate '<='/'>=' that an assumption produces.
  test('A3: indeterminate strict predicates return undefined', () => {
    const ce = new ComputeEngine();
    ce.assume(['GreaterEqual', 'y', 3]); // y >= 3
    const y = ce.expr('y');
    expect(y.isGreaterEqual(3)).toBe(true); // known: y >= 3
    expect(y.isLess(3)).toBe(false); // known false
    expect(y.isGreater(3)).toBeUndefined(); // y could be exactly 3
    expect(y.isLessEqual(3)).toBeUndefined(); // y could be exactly 3
  });

  test('A3: definite orderings are unaffected', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(5).isGreater(3)).toBe(true);
    expect(ce.expr(3).isGreater(5)).toBe(false);
    expect(ce.expr(3).isLessEqual(3)).toBe(true);
    ce.assume(['Greater', 'z', 10]); // z > 10
    expect(ce.expr('z').isGreater(3)).toBe(true);
  });

  // G14: cmp() derived '>' from "not equal and not less". For equal
  // infinities the tolerance check is `|∞ − ∞| = NaN` and `∞ < ∞` is false,
  // so strict self-comparisons of infinities returned `true` (e.g.
  // `-∞ > -∞`). Same derivation made NaN compare as greater than anything.
  describe('G14: comparisons of infinities and NaN', () => {
    for (const precision of ['machine', 50] as const) {
      describe(`at ${precision} precision`, () => {
        const ce = new ComputeEngine();
        ce.precision = precision;
        const pinf = ce.expr('PositiveInfinity');
        const ninf = ce.expr('NegativeInfinity');
        const nan = ce.expr('NaN');

        test('strict self-comparison of equal infinities is false', () => {
          expect(ninf.isGreater(ninf)).toBe(false);
          expect(ninf.isLess(ninf)).toBe(false);
          expect(pinf.isGreater(pinf)).toBe(false);
          expect(pinf.isLess(pinf)).toBe(false);
        });

        test('non-strict self-comparison of equal infinities is true', () => {
          expect(ninf.isGreaterEqual(ninf)).toBe(true);
          expect(ninf.isLessEqual(ninf)).toBe(true);
          expect(pinf.isGreaterEqual(pinf)).toBe(true);
          expect(pinf.isLessEqual(pinf)).toBe(true);
        });

        test('mixed-sign infinities are ordered', () => {
          expect(ninf.isLess(pinf)).toBe(true);
          expect(ninf.isLessEqual(pinf)).toBe(true);
          expect(pinf.isGreater(ninf)).toBe(true);
          expect(pinf.isGreaterEqual(ninf)).toBe(true);
          expect(ninf.isGreater(pinf)).toBe(false);
          expect(pinf.isLess(ninf)).toBe(false);
        });

        test('equality of infinities', () => {
          expect(pinf.isEqual(pinf)).toBe(true);
          expect(ninf.isEqual(ninf)).toBe(true);
          expect(pinf.isEqual(ninf)).toBe(false);
        });

        test('comparisons involving NaN are indeterminate', () => {
          expect(nan.isLess(pinf)).toBeUndefined();
          expect(nan.isGreater(ninf)).toBeUndefined();
          expect(nan.isLessEqual(nan)).toBeUndefined();
          expect(nan.isGreaterEqual(nan)).toBeUndefined();
          expect(pinf.isLess(nan)).toBeUndefined();
          expect(ce.expr(0).isGreater(nan)).toBeUndefined();
        });

        test('infinity vs finite numbers', () => {
          expect(pinf.isGreater(1e308)).toBe(true);
          expect(ninf.isLess(-1e308)).toBe(true);
          expect(ce.expr(0).isLess(pinf)).toBe(true);
          expect(ce.expr(0).isGreater(ninf)).toBe(true);
        });

        test('evaluated relational operators on equal infinities', () => {
          const ev = (op: string) =>
            ce.expr([op, 'NegativeInfinity', 'NegativeInfinity']).evaluate()
              .symbol;
          expect(ev('Greater')).toBe('False');
          expect(ev('Less')).toBe('False');
          expect(ev('GreaterEqual')).toBe('True');
          expect(ev('LessEqual')).toBe('True');
          expect(ev('Equal')).toBe('True');
        });
      });
    }
  });
});
