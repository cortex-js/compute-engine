import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// CE-1429: with `z` a constant of value 0, `0/z` is `0/0` and `z^0` is `0^0`,
// which have no value. The rules `0/a -> 0` and `a^0 -> 1` read the constant
// as a free variable, which is not zero in general. They do not apply to a
// constant symbol whose value may be zero. A constant with a nonzero value, a
// constant with no value and a free variable keep the rules.
//

const ce = new ComputeEngine();
ce.declare('z', { value: 0, isConstant: true });
ce.declare('w', { value: 3, isConstant: true });
ce.declare('c', { type: 'real', isConstant: true });
ce.declare('q', { value: NaN, isConstant: true });
ce.declare('L', { value: ['List', 1, 2], isConstant: true });
ce.declare('u', { value: ['Add', 'y', 1], isConstant: true });
ce.declare('t', 'real');

const json = (x: MathJsonExpression) => ce.box(x).json;
const evaluate = (x: MathJsonExpression) => ce.box(x).evaluate().json;
const simplify = (x: MathJsonExpression) => ce.box(x).simplify().json;

describe('CE-1429: zero divided by a constant of value 0', () => {
  test('the quotient is kept, and its value is NaN', () => {
    expect(json(['Divide', 0, 'z'])).toEqual(['Divide', 0, 'z']);
    expect(evaluate(['Divide', 0, 'z'])).toEqual('NaN');
    expect(simplify(['Divide', 0, 'z'])).toEqual('NaN');
    expect(ce.parse('\\frac{0}{z}').simplify().json).toEqual('NaN');
    expect(ce.parse('\\frac{0}{z}').N().json).toEqual('NaN');
  });

  test('a numerator that simplifies to 0', () => {
    expect(simplify(['Divide', ['Multiply', 2, 'z'], 'z'])).toEqual('NaN');
    expect(simplify(['Add', 1, ['Divide', 0, 'z']])).toEqual('NaN');
  });

  test('the builder keeps the quotient', () => {
    expect(ce.box(0).div(ce.box('z')).json).toEqual(['Divide', 0, 'z']);
    expect(ce.box(0).div(ce.box('z')).evaluate().json).toEqual('NaN');
  });
});

describe('CE-1429: a constant of value 0 to the power 0', () => {
  test('the power is NaN, as the literal 0^0', () => {
    expect(json(['Power', 0, 0])).toEqual('NaN');
    expect(json(['Power', 'z', 0])).toEqual('NaN');
    expect(json(['Power', 'z', { num: '0.0' }])).toEqual('NaN');
    expect(ce.parse('z^0').json).toEqual('NaN');
    expect(ce.box('z').pow(0).json).toEqual('NaN');
  });

  test('a product with the power is NaN', () => {
    expect(evaluate(['Multiply', 't', ['Power', 'z', 0]])).toEqual('NaN');
    expect(simplify(['Multiply', 't', ['Power', 'z', 0]])).toEqual('NaN');
    expect(simplify(['Add', 't', ['Power', 'z', 0]])).toEqual('NaN');
  });

  test('a power of the power with the exponent 0 is NaN', () => {
    expect(json(['Power', ['Power', 'z', 2], 0])).toEqual('NaN');
    expect(json(['Power', ['Power', 'w', 2], 0])).toEqual(1);
    // A base that is not a constant: the same form as its power `t^0`
    expect(json(['Power', ['Power', 't', 2], 0])).toEqual(
      json(['Power', 't', 0])
    );
    expect(json(['Power', ['Power', 'x', 2], 0])).toEqual(
      json(['Power', 'x', 0])
    );
  });

  test('a product does not drop a factor whose exponent becomes 0', () => {
    // The canonical form keeps `(z·t)^0`: its base is not a constant symbol.
    // The product gives the exponent 0 to each factor of the base.
    const power = ce.box(['Power', ['Multiply', 'z', 't'], 0]);
    expect(power.json).toEqual(['Power', ['Multiply', 'z', 't'], 0]);
    expect(ce.box('x').mul(power).json).toEqual('NaN');
    expect(power.evaluate().json).toEqual('NaN');
  });

  test('the compiled value is the real NaN', () => {
    for (const to of ['javascript', 'interval-js'] as const) {
      const result = compile(ce.box(['Multiply', 't', ['Power', 'z', 0]]), {
        to,
      });
      expect(result.success).toBe(true);
    }
    const f = compile(ce.box(['Multiply', 't', ['Power', 'z', 0]]));
    expect(f.run!({ t: 2 })).toBeNaN();
    expect(compile(ce.box(['Divide', 0, 'z'])).run!({})).toBeNaN();
  });
});

describe('CE-1429: a constant whose value is not known to be nonzero', () => {
  test('a constant of value NaN', () => {
    expect(json(['Power', 'q', 0])).toEqual(['Power', 'q', 0]);
    expect(evaluate(['Power', 'q', 0])).toEqual('NaN');
    expect(simplify(['Power', 'q', 0])).toEqual('NaN');
    expect(simplify(['Divide', 0, 'q'])).toEqual('NaN');
    expect(ce.box('t').mul(ce.box(['Power', 'q', 0])).json).toEqual([
      'Multiply',
      't',
      ['Power', 'q', 0],
    ]);
  });

  test('a constant whose value has a free variable keeps the power', () => {
    // The value `y + 1` is 0 at `y = -1`, so `u^0` is not folded to 1.
    expect(json(['Power', 'u', 0])).toEqual(['Power', 'u', 0]);
    expect(simplify(['Power', 'u', 0])).toEqual(['Power', 'u', 0]);
    expect(ce.box(0).div(ce.box('u')).json).toEqual(['Divide', 0, 'u']);
  });

  test('a constant whose value is a list', () => {
    // `L^0` is the list `[1, 1]`, so the factor is not the number 1.
    expect(ce.box('t').mul(ce.box(['Power', 'L', 0])).json).toEqual([
      'Multiply',
      't',
      ['Power', 'L', 0],
    ]);
    expect(evaluate(['Multiply', 't', ['Power', 'L', 0]])).toEqual([
      'List',
      't',
      't',
    ]);
  });
});

describe('CE-1429: the rules apply to the other symbols', () => {
  test('a constant with a nonzero value', () => {
    expect(simplify(['Divide', 0, 'w'])).toEqual(0);
    expect(simplify(['Divide', 0, 'Pi'])).toEqual(0);
    expect(ce.box(0).div(ce.box('w')).json).toEqual(0);
    expect(json(['Power', 'w', 0])).toEqual(1);
    expect(json(['Power', 'Pi', 0])).toEqual(1);
    expect(json(['Multiply', 't', ['Power', 'w', 0]])).toEqual('t');
  });

  test('a constant with no value, as a free variable', () => {
    expect(simplify(['Divide', 0, 'c'])).toEqual(0);
    expect(json(['Power', 'c', 0])).toEqual(1);
    expect(json(['Divide', 0, 't'])).toEqual(0);
    expect(simplify(['Power', 't', 0])).toEqual(1);
    expect(ce.box('t').mul(ce.box(['Power', 'x', 0])).json).toEqual('t');
  });
});
