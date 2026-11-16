import { ComputeEngine } from '../../src/compute-engine';

//
// The derivative of a special function at a point where its closed form is
// 0/0 and the derivative exists: K′(m) = (E − (1 − m)K)/(2m(1 − m)) and
// E′(m) = (E − K)/(2m) at m = 0, Li′ₛ(z) = Liₛ₋₁(z)/z, ∂_zΦ(z, s, a) and
// W′(z) at z = 0. The value comes from the Maclaurin series of the function
// (symbolic/removable-points.ts), and `Series` at 0 uses the same
// coefficients.
//

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.expr>[0];

const value = (expr: Json) => ce.expr(expr).evaluate();

describe('THE DERIVATIVE AT A REMOVABLE POINT OF ITS CLOSED FORM', () => {
  test.each<[Json, Json]>([
    [
      ['Apply', ['Derivative', 'EllipticK'], 0],
      ['Divide', 'Pi', 8],
    ],
    [
      ['Apply', ['Derivative', 'EllipticK', 2], 0],
      ['Divide', ['Multiply', 9, 'Pi'], 64],
    ],
    [
      ['Apply', ['Derivative', 'EllipticK', 3], 0],
      ['Divide', ['Multiply', 75, 'Pi'], 256],
    ],
    [
      ['Apply', ['Derivative', 'EllipticE'], 0],
      ['Negate', ['Divide', 'Pi', 8]],
    ],
    [
      ['Apply', ['Derivative', 'EllipticE', 2], 0],
      ['Negate', ['Divide', ['Multiply', 3, 'Pi'], 64]],
    ],
    [['Apply', ['Derivative', 'LambertW'], 0], 1],
    [['Apply', ['Derivative', 'LambertW', 2], 0], -2],
    [['Apply', ['Derivative', 'LambertW', 3], 0], 9],
    [['Apply', ['Derivative', ['Function', ['PolyLog', 2, 'x'], 'x']], 0], 1],
    [
      ['Apply', ['Derivative', ['Function', ['PolyLog', 2, 'x'], 'x'], 2], 0],
      ['Rational', 1, 2],
    ],
    [
      ['Apply', ['Derivative', ['Function', ['PolyLog', 's', 'x'], 'x'], 2], 0],
      ['Multiply', 2, ['Power', 2, ['Negate', 's']]],
    ],
    [
      [
        'Apply',
        [
          'Derivative',
          ['Function', ['LerchPhi', 'x', 2, ['Rational', 3, 2]], 'x'],
        ],
        0,
      ],
      ['Rational', 4, 25],
    ],
    [['Apply', ['Derivative', ['Function', ['LambertW', 'x', 0], 'x']], 0], 1],
  ])('%j is %j', (expr, expected) => {
    const result = value(expr);
    expect(result.isSame(ce.expr(expected).evaluate())).toBe(true);
    // A value with a free parameter (`s`) has no numeric value.
    const approx = ce.expr(expected).N();
    if (!Number.isNaN(approx.re))
      expect(ce.expr(expr).N().re).toBeCloseTo(approx.re, 12);
  });

  // The closed form near the point agrees with the value at the point.
  test.each<[string, number]>([
    ['EllipticK', 1],
    ['EllipticK', 2],
    ['EllipticE', 1],
    ['LambertW', 1],
  ])('%s, order %d, is the limit of the closed form', (f, order) => {
    const near = value(['Apply', ['Derivative', f, order], 1e-6]).N().re;
    const at0 = value(['Apply', ['Derivative', f, order], 0]).N().re;
    expect(at0).toBeCloseTo(near, 4);
  });

  test('N() of the application', () => {
    expect(
      ce.expr(['Apply', ['Derivative', 'EllipticK'], 0]).N().re
    ).toBeCloseTo(Math.PI / 8, 14);
  });

  test('a float 0 gives the float of the value', () => {
    const result = value([
      'Apply',
      ['Derivative', 'EllipticK'],
      { num: '0.0' },
    ]);
    expect(result.isExact).toBe(false);
    expect(result.re).toBeCloseTo(Math.PI / 8, 14);
  });

  test('an exact radical operand stays exact', () => {
    // ∂_zΦ(0, 2, √2) = (1 + √2)^(−2)
    const result = value([
      'Apply',
      ['Derivative', ['Function', ['LerchPhi', 'x', 2, ['Sqrt', 2]], 'x']],
      0,
    ]);
    expect(result.isSame(value(['Power', ['Add', ['Sqrt', 2], 1], -2]))).toBe(
      true
    );
    expect(result.N().re).toBeCloseTo((1 + Math.SQRT2) ** -2, 14);
  });

  test('a user function with the name of a table entry is not read from the table', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.assign(
      'EllipticK',
      engine.expr(['Function', ['Add', 'x', 100], 'x'])
    );
    expect(
      engine.expr(['Apply', ['Derivative', 'EllipticK'], 0]).evaluate().re
    ).toBe(1);
    expect(
      engine
        .expr(['Series', ['EllipticK', 'x'], 'x', 0, 2])
        .evaluate()
        .toString()
    ).not.toMatch(/pi/i);
    engine.popScope();
  });

  test('a user function named `constructor` is not a table entry', () => {
    const engine = new ComputeEngine();
    engine.declare('constructor', '(real) -> real');
    expect(() =>
      engine.expr(['Apply', ['Derivative', 'constructor'], 0]).evaluate()
    ).not.toThrow();
  });

  test('a user function named `Derivative` is not the library one', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.assign(
      'Derivative',
      engine.expr(['Function', ['Function', 42, 'x'], 'f'])
    );
    const result = engine
      .expr(['Apply', ['Derivative', 'EllipticK'], 0])
      .evaluate();
    expect(result.toString()).not.toMatch(/pi/i);
    engine.popScope();
  });

  test('a callee shadowed where it was written keeps that binding', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    engine.assign(
      'EllipticK',
      engine.expr(['Function', ['Add', 'x', 100], 'x'])
    );
    const expr = engine.expr(['Apply', ['Derivative', 'EllipticK'], 0]);
    engine.popScope();
    expect(expr.evaluate().toString()).not.toMatch(/pi/i);
  });

  test('the asynchronous evaluation gives the same value', async () => {
    const result = await ce
      .expr(['Apply', ['Derivative', 'EllipticK', 2], 0])
      .evaluateAsync();
    expect(result.isSame(value(['Divide', ['Multiply', 9, 'Pi'], 64]))).toBe(
      true
    );
  });

  test('another point is the closed form', () => {
    expect(value(['Apply', ['Derivative', 'EllipticK'], 0.5]).re).toBeCloseTo(
      0.847213084793979,
      12
    );
  });

  // A branch other than the principal one is singular at 0, a literal
  // whose other operand holds the parameter is not a call of the table, and
  // `LerchPhi` is read only for a proved `a > 0` (at a negative `a`, `Power`
  // would take the real root where `LerchPhi` takes the principal one).
  test.each<Json>([
    [
      'Apply',
      [
        'Derivative',
        [
          'Function',
          ['LerchPhi', 'x', ['Rational', 1, 3], ['Rational', -3, 2]],
          'x',
        ],
      ],
      0,
    ],
    ['Apply', ['Derivative', ['Function', ['LambertW', 'x', -1], 'x']], 0],
    ['Apply', ['Derivative', ['Function', ['PolyLog', 'x', 'x'], 'x']], 0],
    ['Apply', ['Derivative', ['Function', ['LerchPhi', 'x', 2, 0], 'x']], 0],
  ])('%j is not read from the table', (expr) => {
    const result = value(expr);
    expect(result.isFinite === true && result.isExact === true).toBe(false);
  });
});

describe('SERIES AT A REMOVABLE POINT OF THE DERIVATIVE', () => {
  test.each<[Json, Json]>([
    [
      ['Series', ['EllipticK', 'x'], 'x', 0, 3],
      [
        'Add',
        ['Divide', 'Pi', 2],
        ['Multiply', ['Rational', 1, 8], 'Pi', 'x'],
        ['Multiply', ['Rational', 9, 128], 'Pi', ['Power', 'x', 2]],
        ['Multiply', ['Rational', 25, 512], 'Pi', ['Power', 'x', 3]],
        ['BigO', ['Power', 'x', 4]],
      ],
    ],
    [
      ['Series', ['EllipticE', 'x'], 'x', 0, 2],
      [
        'Add',
        ['Divide', 'Pi', 2],
        ['Multiply', ['Rational', -1, 8], 'Pi', 'x'],
        ['Multiply', ['Rational', -3, 128], 'Pi', ['Power', 'x', 2]],
        ['BigO', ['Power', 'x', 3]],
      ],
    ],
    [
      ['Series', ['PolyLog', 2, 'x'], 'x', 0, 3],
      [
        'Add',
        'x',
        ['Multiply', ['Rational', 1, 4], ['Power', 'x', 2]],
        ['Multiply', ['Rational', 1, 9], ['Power', 'x', 3]],
        ['BigO', ['Power', 'x', 4]],
      ],
    ],
    [
      ['Series', ['LambertW', 'x'], 'x', 0, 3],
      [
        'Add',
        'x',
        ['Negate', ['Power', 'x', 2]],
        ['Multiply', ['Rational', 3, 2], ['Power', 'x', 3]],
        ['BigO', ['Power', 'x', 4]],
      ],
    ],
    [
      ['Series', ['LerchPhi', 'x', 2, ['Rational', 3, 2]], 'x', 0, 1],
      [
        'Add',
        ['Rational', 4, 9],
        ['Multiply', ['Rational', 4, 25], 'x'],
        ['BigO', ['Power', 'x', 2]],
      ],
    ],
    // A composition: the inner series is x², whose constant term is 0.
    [
      ['Series', ['EllipticK', ['Square', 'x']], 'x', 0, 4],
      [
        'Add',
        ['Divide', 'Pi', 2],
        ['Multiply', ['Rational', 1, 8], 'Pi', ['Power', 'x', 2]],
        ['Multiply', ['Rational', 9, 128], 'Pi', ['Power', 'x', 4]],
        ['BigO', ['Power', 'x', 6]],
      ],
    ],
  ])('%j', (expr, expected) => {
    const result = value(expr);
    expect(result.operator).not.toBe('Series');
    expect(result.isSame(ce.expr(expected).evaluate())).toBe(true);
  });
});
