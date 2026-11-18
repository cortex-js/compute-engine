import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// CE-1361: with `z` a constant of value 0, `z/z` is `0/0`, which has no
// value, but its canonical form was `1`. A constant symbol is now divided out
// only when its value is not zero: by `canonicalDivide`, by the two `a/a -> 1`
// rules of `simplify()`, and by the `Product` tally, which cancelled `z` and
// `z^{-1}`. A constant with no value is divided out, as a free variable is.
//

const ce = new ComputeEngine();
ce.declare('z', { value: 0, isConstant: true });
ce.declare('w', { value: 3, isConstant: true });
ce.declare('c', { type: 'real', isConstant: true });

const json = (x: MathJsonExpression) => ce.box(x).json;
const evaluate = (x: MathJsonExpression) => ce.box(x).evaluate().json;
const simplify = (x: MathJsonExpression) => ce.box(x).simplify().json;

describe('CE-1361: a constant of value 0 divided by itself', () => {
  test('the quotient is kept, and its value is NaN', () => {
    expect(json(['Divide', 'z', 'z'])).toEqual(['Divide', 'z', 'z']);
    expect(evaluate(['Divide', 'z', 'z'])).toEqual('NaN');
    expect(simplify(['Divide', 'z', 'z'])).toEqual('NaN');
    expect(ce.parse('\\frac{z}{z}').N().json).toEqual('NaN');
  });

  test('a product does not cancel the constant', () => {
    expect(ce.box('z').div(ce.box('z')).json).toEqual(['Divide', 'z', 'z']);
    expect(simplify(['Multiply', 'z', ['Power', 'z', -1]])).toEqual('NaN');
    expect(evaluate(['Multiply', 'z', ['Power', 'z', -1]])).toEqual('NaN');
    expect(evaluate(['Divide', ['Multiply', 2, 'z'], 'z'])).toEqual('NaN');
  });

  test('the literal 0/0 is NaN', () => {
    expect(json(['Divide', 0, 0])).toEqual('NaN');
  });
});

describe('CE-1361: other constants are divided out', () => {
  test('a constant with a nonzero value', () => {
    expect(json(['Divide', 'w', 'w'])).toEqual(1);
    expect(json(['Divide', 'Pi', 'Pi'])).toEqual(1);
    expect(json(['Divide', 'ImaginaryUnit', 'ImaginaryUnit'])).toEqual(1);
    expect(json(['Divide', 'GoldenRatio', 'GoldenRatio'])).toEqual(1);
    expect(ce.box('w').div(ce.box('w')).json).toEqual(1);
    expect(simplify(['Divide', ['Multiply', 2, 'Pi'], 'Pi'])).toEqual(2);
  });

  test('a constant with no value, as a free variable', () => {
    expect(json(['Divide', 'c', 'c'])).toEqual(1);
    expect(json(['Divide', 'x', 'x'])).toEqual(1);
  });
});
