import { ComputeEngine } from '../../../src/compute-engine';

// ROADMAP CE-617: a Leibniz derivative (`\frac{d}{dx}`, `\frac{\partial}{\partial
// x}`, `\partial_x`) in the integrand of an integral read the closing
// differential `dx` of the integral as part of its operand, the product
// `d·x`. The integral then had no variable (`Nothing`), and its value still
// held `x`. The operand of the derivative now stops at the terminator of the
// expression that contains it, so in an integrand it stops before the
// differential.

const ce = new ComputeEngine();

function raw(latex: string): string {
  return JSON.stringify(ce.parse(latex, { canonical: false }).json);
}

describe('CE-617 a derivative in an integrand leaves the differential to the integral', () => {
  test('the operand of \\frac{d}{dx} stops before the differential', () => {
    expect(raw('\\int_0^1 \\frac{d}{dx}x^3\\,dx')).toBe(
      '["Integrate",["D",["Power","x",3],"x"],["Tuple","x",0,1]]'
    );
    expect(raw('\\int_0^1 \\frac{d}{dx}x^3 \\cdot E\\,dx')).toBe(
      '["Integrate",["D",["Multiply",["Power","x",3],"E"],"x"],["Tuple","x",0,1]]'
    );
  });

  test('the operand keeps the extent of a term', () => {
    expect(raw('\\int \\frac{d}{dx}x^3 + 1\\,dx')).toBe(
      '["Integrate",["D",["Add",["Power","x",3],1],"x"],"x"]'
    );
  });

  test('the partial-derivative spellings stop before the differential', () => {
    expect(
      raw('\\int_0^1 \\frac{\\partial}{\\partial x}x^3\\,dx')
    ).toBe(
      '["Integrate",["D",["Power","x",3],"x"],["Tuple","x",0,1]]'
    );
    expect(raw('\\int_0^1 \\partial_x x^3\\,dx')).toBe(
      '["Integrate",["D",["Power","x",3],"x"],["Tuple","x",0,1]]'
    );
  });

  test('a parenthesized operand is unchanged (control)', () => {
    expect(raw('\\int_0^1 \\frac{d}{dx}(x^3)\\,dx')).toBe(
      '["Integrate",["D",["Delimiter",["Power","x",3]],"x"],["Tuple","x",0,1]]'
    );
  });

  test('outside an integral, the operand still reads a trailing differential', () => {
    // No enclosing integral claims the differential, so it stays a factor of
    // the operand, as before.
    expect(raw('\\frac{d}{dx} x\\,dy')).toBe(
      '["D",["InvisibleOperator","x",["HorizontalSpacing",3],"d","y"],"x"]'
    );
  });

  test('an argument separator of an enclosing function does not end the operand', () => {
    // The argument of `\sin` stops before another trigonometric function,
    // but only the differential of an enclosing integral ends the operand of
    // the derivative: the operand is `\cos x`, not a missing operand.
    expect(raw('\\sin \\frac{d}{dx}\\cos x')).toBe(
      '["Sin",["D",["Cos","x"],"x"]]'
    );
    expect(raw('\\sin \\partial_x \\cos x')).toBe(
      '["Sin",["D",["Cos","x"],"x"]]'
    );
    expect(raw('\\int_0^1 \\sin \\frac{d}{dx}\\cos x\\,dx')).toBe(
      '["Integrate",["Sin",["D",["Cos","x"],"x"]],["Tuple","x",0,1]]'
    );
  });

  test('a bare function name (strict: false) does not end the operand', () => {
    // The argument of a bare `sin` stops before another bare function name,
    // but the operand of the derivative is `cos x`, as with `\sin`.
    const bare = (latex: string) =>
      JSON.stringify(ce.parse(latex, { canonical: false, strict: false }).json);
    expect(bare('sin \\frac{d}{dx} cos x')).toBe(
      '["Sin",["D",["Cos","x"],"x"]]'
    );
    expect(bare('sin \\partial_x cos x')).toBe(
      '["Sin",["D",["Cos","x"],"x"]]'
    );
    expect(bare('\\int_0^1 sin \\frac{d}{dx} cos x\\,dx')).toBe(
      '["Integrate",["Sin",["D",["Cos","x"],"x"]],["Tuple","x",0,1]]'
    );
    // Control: outside a derivative, the stop still applies.
    expect(bare('sin x cos y')).toBe(
      '["InvisibleOperator",["Sin","x"],["Cos","y"]]'
    );
  });

  test('the operand stops at a keyword of an enclosing `if`', () => {
    // The condition of the `then` branch stops at `else`: the derivative
    // keeps `x^2` and the `If` keeps its false branch.
    expect(
      raw('\\text{if} x>0 \\text{then} \\frac{d}{dx}x^2 \\text{else} 0')
    ).toBe('["If",["Greater","x",0],["D",["Power","x",2],"x"],0]');
    expect(
      raw('\\text{if} x>0 \\text{then} \\partial_x x^2 \\text{else} 0')
    ).toBe('["If",["Greater","x",0],["D",["Power","x",2],"x"],0]');
  });

  test('the trigonometric stop still applies outside a derivative', () => {
    expect(raw('\\sin \\frac{d}{dx} x\\cos x')).toBe(
      '["Sin",["D",["InvisibleOperator","x",["Cos","x"]],"x"]]'
    );
    expect(raw('\\cos a \\sin b')).toBe(
      '["InvisibleOperator",["Cos","a"],["Sin","b"]]'
    );
  });

  test('a derivative with no operand in an integrand', () => {
    // `\partial_x` with no operand is `D(Nothing, x)`, before the
    // differential as at the end of the input.
    expect(raw('\\partial_x')).toBe('["D","Nothing","x"]');
    expect(raw('\\int \\partial_x \\,dx')).toBe(
      '["Integrate",["D","Nothing","x"],"x"]'
    );
    // `\frac{d}{dx}` with no operand reports a missing operand, and the
    // integral keeps its variable.
    expect(raw('\\int_0^1 \\frac{d}{dx}\\,dx')).toBe(
      '["Integrate",["D",["Error","\'missing\'"],"x"],["Tuple","x",0,1]]'
    );
  });

  test('the definite integral of the derivative has no free x', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('E', 'list<integer>');
    ce2.assign('E', ce2.box(['List', 1, 2]));
    expect(
      ce2.parse('\\int_0^1 \\frac{d}{dx}x^3 \\cdot E\\,dx').evaluate().toString()
    ).toBe('[1,2]');
    expect(
      ce2.parse('\\int_0^1 \\frac{d}{dx}x^3\\,dx').N().re
    ).toBeCloseTo(1, 10);
  });
});
