import { ComputeEngine } from '../../src/compute-engine';

//
// A negation, sum, difference or product of operands that are all finite
// numbers is finite (`get isFinite`,
// `src/compute-engine/boxed-expression/boxed-function.ts`). Before,
// `isFinite` was `undefined` for `−π`, `π − 4` and `√2 − 3`, so code that
// tests `isFinite === true` gave up for every compound constant.
//

const ce = new ComputeEngine();

describe('isFinite of Negate, Add, Subtract and Multiply', () => {
  test.each([
    [['Negate', 'Pi']],
    [['Subtract', 'Pi', 4]],
    [['Multiply', -1, 'Pi']],
    [['Subtract', ['Sqrt', 2], 3]],
    [['Add', 'Pi', 'ExponentialE', ['Rational', 1, 3]]],
    [['Multiply', 2, 'Pi', ['Sqrt', 3]]],
    [['Add', 'Pi', ['Complex', 1, 2]]],
    [['Negate', ['Add', 'Pi', ['Multiply', 3, 'ExponentialE']]]],
  ])('%j is finite', (x) => {
    expect(ce.box(x as any).isFinite).toBe(true);
  });

  test('a declared real symbol is finite in a sum', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('r', 'real');
    expect(ce2.box(['Add', 'r', 1]).isFinite).toBe(true);
  });

  test.each([
    [['Add', 'Pi', 'PositiveInfinity'], false],
    [['Negate', 'PositiveInfinity'], false],
    [['Add', 1, ['Ln', 0]], false],
    [['Multiply', 0, 'PositiveInfinity'], undefined],
    [['Add', 'Pi', 'NaN'], undefined],
    [['Multiply', 'Pi', 'x'], undefined],
    [['Add', 'Pi', ['Divide', 1, 'y']], undefined],
  ])('%j is not known to be finite', (x, expected) => {
    expect(ce.box(x as any).isFinite).toBe(expected);
  });

  test('an operand that is not a number is not finite', () => {
    expect(ce.box(['Add', 'Pi', ['List', 1, 2]]).isFinite).toBe(false);
  });
});
