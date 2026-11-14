import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The derivative of ErfInv, HurwitzZeta and LerchPhi in `a`, Beta,
// BarnesG, LogBarnesG, the complete EllipticK and EllipticE and ClausenCl.
// Each closed form is compared with a central difference of the function
// itself, under evaluate() and N(), and compiled. An operand with no closed
// form (∂ₛζ(s, a)) keeps the inert Derivative. `D(f, [x, n])` is the n-th
// derivative, as `D(f, {x, n})` is.
//

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.expr>[0];

const at = (f: Json, x: number) => ce.expr(f).subs({ x }).N().re;

const centralDifference = (f: Json, x: number) => {
  const h = 1e-5;
  return (at(f, x + h) - at(f, x - h)) / (2 * h);
};

// [function of x, a point inside its domain]
const FUNCTIONS: [Json, number][] = [
  [['ErfInv', 'x'], 0.37],
  [['ErfInv', 'x'], -0.8],
  [['HurwitzZeta', 3, 'x'], 1.7],
  [['HurwitzZeta', ['Rational', 5, 2], 'x'], 0.6],
  [['LerchPhi', ['Rational', 1, 3], 2, 'x'], 1.2],
  [['LerchPhi', 'x', 2, 1.5], 0.4],
  [['LerchPhi', 'x', 3, 2], -0.5],
  [['Beta', 'x', 3], 1.3],
  [['Beta', 2.5, 'x'], 1.3],
  [['Beta', 'x', 'x'], 0.9],
  [['LogBarnesG', 'x'], 2.3],
  [['BarnesG', 'x'], 2.3],
  [['EllipticK', 'x'], 0.37],
  [['EllipticK', ['Multiply', 2, 'x']], 0.2],
  [['EllipticE', 'x'], 0.37],
  [['EllipticE', 'x'], -2.5],
  [['ClausenCl', 1, 'x'], 1.1],
  [['ClausenCl', 2, 'x'], 1.1],
  [['ClausenCl', 3, 'x'], 1.1],
  [['ClausenCl', 4, 'x'], 1.1],
];

describe('THE DERIVATIVE OF A SPECIAL FUNCTION', () => {
  for (const [f, x0] of FUNCTIONS) {
    const name = JSON.stringify(f);
    const d = ce.expr(['D', f, 'x'] as never);

    test(`D(${name}, x) has no Derivative left (evaluate)`, () => {
      const e = d.evaluate();
      expect(e.operator).not.toBe('D');
      expect(e.has('Derivative')).toBe(false);
    });

    test(`D(${name}, x) at ${x0} is the central difference (evaluate)`, () => {
      const got = d.evaluate().subs({ x: x0 }).N().re;
      const want = centralDifference(f, x0);
      expect(Math.abs(got - want)).toBeLessThan(
        1e-6 * Math.max(1, Math.abs(want))
      );
    });

    test(`D(${name}, x) at ${x0} is the central difference (N)`, () => {
      const got = d.N().subs({ x: x0 }).N().re;
      const want = centralDifference(f, x0);
      expect(Math.abs(got - want)).toBeLessThan(
        1e-6 * Math.max(1, Math.abs(want))
      );
    });
  }

  // The compiled derivative is the one of the value. BarnesG has no lowering.
  for (const [f, x0] of FUNCTIONS.filter(
    ([f]) => (f as string[])[0] !== 'BarnesG'
  )) {
    const name = JSON.stringify(f);
    test(`D(${name}, x) compiles and agrees at ${x0}`, () => {
      const compiled = compile(ce.expr(['D', f, 'x'] as never));
      expect(compiled.success).toBe(true);
      const want = centralDifference(f, x0);
      expect(
        Math.abs((compiled.run!({ x: x0 }) as number) - want)
      ).toBeLessThan(1e-6 * Math.max(1, Math.abs(want)));
    });
  }

  const exact: [Json, Json][] = [
    [
      ['HurwitzZeta', 3, 'x'],
      ['Multiply', -3, ['HurwitzZeta', 4, 'x']],
    ],
    [
      ['Beta', 'x', 'x'],
      [
        'Multiply',
        2,
        ['Beta', 'x', 'x'],
        ['Subtract', ['Digamma', 'x'], ['Digamma', ['Multiply', 2, 'x']]],
      ],
    ],
    [
      ['ErfInv', 'x'],
      [
        'Multiply',
        ['Divide', ['Sqrt', 'Pi'], 2],
        ['Exp', ['Square', ['ErfInv', 'x']]],
      ],
    ],
    [
      ['ClausenCl', 2, 'x'],
      ['ClausenCl', 1, 'x'],
    ],
    [
      ['ClausenCl', 3, 'x'],
      ['Negate', ['ClausenCl', 2, 'x']],
    ],
  ];
  // `θ` of `ClausenCl` is in radians in every angular unit, `Cot` is not.
  test('D(ClausenCl(1, x), x) is the central difference in degree mode', () => {
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    const f: Json = ['ClausenCl', 1, 'x'];
    const value = (x: number) => deg.expr(f).subs({ x }).N().re;
    const h = 1e-5;
    const want = (value(1.1 + h) - value(1.1 - h)) / (2 * h);
    const got = deg
      .expr(['D', f, 'x'] as never)
      .evaluate()
      .subs({ x: 1.1 })
      .N().re;
    expect(Math.abs(got - want)).toBeLessThan(1e-6);
  });

  for (const [f, expected] of exact) {
    test(`D(${JSON.stringify(f)}, x) is ${JSON.stringify(expected)}`, () => {
      const got = ce.expr(['D', f, 'x'] as never).evaluate();
      expect(got.isSame(ce.expr(expected).evaluate())).toBe(true);
    });
  }
});

describe('NO CLOSED FORM KEEPS THE INERT DERIVATIVE', () => {
  const inert: [string, Json][] = [
    ['∂ₛ HurwitzZeta(s, 2)', ['HurwitzZeta', 'x', 2]],
    ['Zeta(s)', ['Zeta', 'x']],
    ['ClausenCl in a symbolic order', ['ClausenCl', 'x', 1.1]],
    ['∂ₙ ClausenCl(n, 1)', ['ClausenCl', 'x', 1]],
  ];
  for (const [name, f] of inert) {
    test(`D(${name}) stays an Apply(Derivative)`, () => {
      const e = ce.expr(['D', f, 'x'] as never).evaluate();
      expect(e.operator).toBe('Apply');
      expect(e.op1.operator).toBe('Derivative');
    });
  }

  test('a slot with a closed form and a slot without add', () => {
    const e = ce
      .expr(['D', ['HurwitzZeta', 'x', 'x'], 'x'] as never)
      .evaluate();
    expect(e.operator).toBe('Add');
    expect(e.has('Derivative')).toBe(true);
    expect(e.has('HurwitzZeta')).toBe(true);
  });

  test('a variable-free operand has the derivative 0', () => {
    for (const f of [
      ['Beta', 2, 3],
      ['ErfInv', 'y'],
      ['HurwitzZeta', 3, 2],
    ])
      expect(
        ce
          .expr(['D', f, 'x'] as never)
          .evaluate()
          .is(0)
      ).toBe(true);
  });
});

describe('SERIES OF A FUNCTION WITH A DERIVATIVE RULE', () => {
  test('ErfInv(x) at 0 is x√π/2 + π^(3/2) x³/24 + 7π^(5/2) x⁵/960', () => {
    const s = ce
      .expr(['Series', ['ErfInv', 'x'], 'x', 0, 5] as never)
      .evaluate();
    expect(s.has('Derivative')).toBe(false);
    expect(s.has('BigO')).toBe(true);
    const polynomial = ce.expr([
      'Normal',
      ['Series', ['ErfInv', 'x'], 'x', 0, 5],
    ] as never);
    const x = 0.1;
    const expected =
      (x * Math.sqrt(Math.PI)) / 2 +
      (Math.PI ** 1.5 * x ** 3) / 24 +
      (7 * Math.PI ** 2.5 * x ** 5) / 960;
    expect(polynomial.evaluate().subs({ x }).N().re).toBeCloseTo(expected, 12);
  });

  test('HurwitzZeta(3, x) about 2 has a Zeta(4) coefficient', () => {
    const s = ce
      .expr(['Series', ['HurwitzZeta', 3, 'x'], 'x', 2, 1] as never)
      .evaluate();
    expect(s.has('Derivative')).toBe(false);
    expect(s.has('Zeta')).toBe(true);
  });
});

describe('D(f, [x, n]), THE n-TH DERIVATIVE', () => {
  const cases: [Json, unknown, Json][] = [
    [
      ['Power', 'x', 5],
      ['List', 'x', 3],
      ['Multiply', 60, ['Square', 'x']],
    ],
    [
      ['Power', 'x', 5],
      ['Set', 'x', 3],
      ['Multiply', 60, ['Square', 'x']],
    ],
    [
      ['Sin', 'x'],
      ['List', 'x', 2],
      ['Negate', ['Sin', 'x']],
    ],
    [
      ['Sin', 'x'],
      ['List', 'x', 5],
      ['Cos', 'x'],
    ],
    [['Power', 'x', 5], ['List', 'x', 7], 0],
    [
      ['Power', 'x', 5],
      ['List', 'x', 0],
      ['Power', 'x', 5],
    ],
  ];
  for (const [f, spec, expected] of cases) {
    test(`D(${JSON.stringify(f)}, ${JSON.stringify(spec)}) = ${JSON.stringify(expected)}`, () => {
      const e = ce.expr(['D', f, spec] as never).evaluate();
      const want = ce.expr(expected);
      expect(e.subs({ x: 0.7 }).N().re).toBeCloseTo(
        want.subs({ x: 0.7 }).N().re,
        12
      );
    });
  }

  test('D(x^n, [x, 3]) = n(n−1)(n−2) x^(n−3), as with {x, 3}', () => {
    const list = ce
      .expr(['D', ['Power', 'x', 'n'], ['List', 'x', 3]] as never)
      .evaluate();
    const set = ce
      .expr(['D', ['Power', 'x', 'n'], ['Set', 'x', 3]] as never)
      .evaluate();
    expect(list.isSame(set)).toBe(true);
    expect(list.operator).not.toBe('D');
    expect(list.subs({ x: 2, n: 5 }).N().re).toBe(5 * 4 * 3 * 2 ** 2);
  });

  test('a compound function: D(e^(2x) sin x, [x, 4]) = −4 e^(2x) sin x … at a point', () => {
    const f: Json = ['Multiply', ['Exp', ['Multiply', 2, 'x']], ['Sin', 'x']];
    const list = ce.expr(['D', f, ['List', 'x', 4]] as never).evaluate();
    const chain = ce.expr(['D', f, 'x', 'x', 'x', 'x'] as never).evaluate();
    expect(list.subs({ x: 0.3 }).N().re).toBeCloseTo(
      chain.subs({ x: 0.3 }).N().re,
      10
    );
  });

  test('a negative order is an error, as with {x, −1}', () => {
    const e = ce
      .expr(['D', ['Power', 'x', 5], ['List', 'x', -1]] as never)
      .evaluate();
    expect(e.has('Error')).toBe(true);
  });

  test('a fractional or symbolic order stays inert', () => {
    expect(
      ce.expr(['D', ['Power', 'x', 5], ['List', 'x', 1.5]] as never).evaluate()
        .operator
    ).toBe('D');
    expect(
      ce.expr(['D', ['Power', 'x', 5], ['List', 'x', 'n']] as never).evaluate()
        .operator
    ).toBe('D');
  });

  test('an order past the cap stays inert', () => {
    expect(
      ce.expr(['D', ['Power', 'x', 5], ['List', 'x', 5000]] as never).evaluate()
        .operator
    ).toBe('D');
  });

  test('a list of two variables is not an order pair', () => {
    const e = ce.expr([
      'D',
      ['Multiply', 'x', 'y'],
      ['List', 'x', 'y'],
    ] as never);
    expect(e.op2.operator).toBe('List');
  });
});
