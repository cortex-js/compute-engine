/**
 * Infinite arguments — cortex-js/compute-engine#396.
 *
 * A complex multiple of an infinity keeps its direction
 * (`i·∞ = DirectedInfinity(i)`), `Real`/`Imaginary`/`Abs` read a directed
 * infinity, and the heads that rejected an infinity at boxing (`Sin`, `Arcsin`,
 * `Ceil`, `Sign`, ...) answer every named infinity. Values are Mathematica's,
 * except `Arccot(~oo)`, which is `Indeterminate` on this engine's (0, π)
 * branch (`Arccot(+∞) = 0`, `Arccot(−∞) = π`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const I = 'ImaginaryUnit';
const PINF = 'PositiveInfinity';
const NINF = 'NegativeInfinity';
const CINF = 'ComplexInfinity';
const di = (d: unknown) => ['DirectedInfinity', d];
const DI_I = di(['Complex', 0, 1]);
const DI_MINUS_I = di(['Complex', 0, -1]);
const DI_DIAGONAL = di([
  'Complex',
  ['Divide', ['Sqrt', 2], 2],
  ['Divide', ['Sqrt', 2], 2],
]);

type Case = [label: string, input: unknown, expected: unknown];

const evaluate = (input: unknown) => ce.expr(input as never).evaluate().json;

describe('Multiply(c, ±∞) keeps the direction of a complex c', () => {
  const cases: Case[] = [
    ['i * +oo', ['Multiply', I, PINF], DI_I],
    ['i * -oo', ['Multiply', I, NINF], DI_MINUS_I],
    ['-i * -oo', ['Multiply', ['Negate', I], NINF], DI_I],
    ['(1 + i) * +oo', ['Multiply', ['Complex', 1, 1], PINF], DI_DIAGONAL],
    ['2i * +oo, the modulus drops out', ['Multiply', 2, I, PINF], DI_I],
    ['-2 * +oo is still real', ['Multiply', -2, PINF], NINF],
    ['i * i * +oo is real', ['Multiply', I, I, PINF], NINF],
    ['i * DirectedInfinity(i)', ['Multiply', I, DI_I], NINF],
    ['-DirectedInfinity(i)', ['Negate', DI_I], DI_MINUS_I],
    ['i * ~oo has no direction', ['Multiply', I, CINF], CINF],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} = ${JSON.stringify(expected)} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
  }

  test('i * +oo keeps the direction under .N()', () => {
    const r = ce.expr(['Multiply', I, PINF]).N();
    expect(r.operator).toBe('DirectedInfinity');
    expect(r.op1.re).toBeCloseTo(0, 12);
    expect(r.op1.im).toBeCloseTo(1, 12);
  });

  test('(1 + i) * +oo has the unit direction under .N()', () => {
    const r = ce.expr(['Multiply', ['Complex', 1, 1], PINF]).N();
    expect(r.operator).toBe('DirectedInfinity');
    expect(r.op1.re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(r.op1.im).toBeCloseTo(Math.SQRT1_2, 12);
  });

  test('i * oo through the parse route', () => {
    expect(ce.parse('i\\infty').evaluate().json).toEqual(DI_I);
  });

  test('a symbolic factor stays unevaluated', () => {
    expect(ce.expr(['Multiply', 'x', PINF]).evaluate().operator).not.toBe(
      'DirectedInfinity'
    );
  });
});

describe('DirectedInfinity(d) normalizes a literal direction', () => {
  const cases: Case[] = [
    ['DirectedInfinity(2i) = DirectedInfinity(i)', di(['Complex', 0, 2]), DI_I],
    ['DirectedInfinity(i) is unchanged', DI_I, DI_I],
    ['DirectedInfinity(3) = +oo', di(3), PINF],
    ['DirectedInfinity(-3) = -oo', di(-3), NINF],
    ['DirectedInfinity(0) = ~oo', di(0), CINF],
    ['DirectedInfinity(1 + i)', di(['Complex', 1, 1]), DI_DIAGONAL],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
  }

  test('a symbolic direction stays as written', () => {
    expect(evaluate(di('d'))).toEqual(di('d'));
  });
});

describe('Real, Imaginary and Abs of a directed infinity', () => {
  const cases: Case[] = [
    ['Real(DirectedInfinity(i)) = 0', ['Real', DI_I], 0],
    ['Imaginary(DirectedInfinity(i)) = +oo', ['Imaginary', DI_I], PINF],
    ['Imaginary(DirectedInfinity(-i)) = -oo', ['Imaginary', DI_MINUS_I], NINF],
    [
      'Real(DirectedInfinity(1 + i)) = +oo',
      ['Real', di(['Complex', 1, 1])],
      PINF,
    ],
    ['Real(DirectedInfinity(-1)) = -oo', ['Real', di(-1)], NINF],
    ['Imaginary(DirectedInfinity(-1)) = 0', ['Imaginary', di(-1)], 0],
    ['Abs(DirectedInfinity(i)) = +oo', ['Abs', DI_I], PINF],
    [
      'Abs(DirectedInfinity(1 + i)) = +oo',
      ['Abs', di(['Complex', 1, 1])],
      PINF,
    ],
    ['Real(i * +oo) = 0', ['Real', ['Multiply', I, PINF]], 0],
    ['Imaginary(i * +oo) = +oo', ['Imaginary', ['Multiply', I, PINF]], PINF],
    ['Abs(i * +oo) = +oo', ['Abs', ['Multiply', I, PINF]], PINF],
    ['Real(~oo) = Indeterminate', ['Real', CINF], 'Indeterminate'],
    ['Imaginary(~oo) = Indeterminate', ['Imaginary', CINF], 'Indeterminate'],
    ['Abs(~oo) = +oo', ['Abs', CINF], PINF],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
    test(`${label} (.N())`, () => {
      const r = ce.expr(input as never).N().json;
      // A float operand gives NaN where the exact answer is Indeterminate.
      expect(r === 'NaN' ? 'Indeterminate' : r).toEqual(expected);
    });
  }

  test('Abs(i * +oo) = +oo (simplify)', () => {
    expect(ce.expr(['Abs', ['Multiply', I, PINF]]).simplify().json).toBe(PINF);
  });

  test('Abs(DirectedInfinity(i)) = +oo (simplify)', () => {
    expect(ce.expr(['Abs', DI_I]).simplify().json).toBe(PINF);
  });

  test('Abs(i * +oo) through the parse route', () => {
    expect(ce.parse('|i\\infty|').evaluate().json).toBe(PINF);
  });

  test('Real(Multiply(i, 2 * +oo)), a compound operand', () => {
    expect(evaluate(['Real', ['Multiply', I, ['Multiply', 2, PINF]]])).toBe(0);
  });
});

describe('Sqrt, Gamma and Ln at a directed infinity', () => {
  const cases: Case[] = [
    ['Sqrt(-oo) = DirectedInfinity(i)', ['Sqrt', NINF], DI_I],
    ['Sqrt(+oo) = +oo', ['Sqrt', PINF], PINF],
    ['Gamma(DirectedInfinity(i)) = 0', ['Gamma', DI_I], 0],
    ['Gamma(DirectedInfinity(-i)) = 0', ['Gamma', DI_MINUS_I], 0],
    ['Gamma(i * +oo) = 0', ['Gamma', ['Multiply', I, PINF]], 0],
    ['Gamma(+oo) = +oo', ['Gamma', PINF], PINF],
    ['Gamma(~oo) = Indeterminate', ['Gamma', CINF], 'Indeterminate'],
    ['Ln(-oo) = +oo', ['Ln', NINF], PINF],
    ['Ln(+oo) = +oo', ['Ln', PINF], PINF],
    ['Log(-oo, 2) = +oo', ['Log', NINF, 2], PINF],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
  }

  test('Gamma(DirectedInfinity(i)) = 0 (.N())', () => {
    expect(ce.expr(['Gamma', DI_I]).N().json).toBe(0);
  });

  test('Sqrt(-oo) = DirectedInfinity(i) (.N())', () => {
    const r = ce.expr(['Sqrt', NINF]).N();
    expect(r.operator).toBe('DirectedInfinity');
    expect(r.op1.im).toBeCloseTo(1, 12);
  });

  test('Ln(-oo) = +oo (.N())', () => {
    expect(ce.expr(['Ln', NINF]).N().json).toBe(PINF);
  });

  test('Ln(-oo) = +oo (simplify)', () => {
    expect(ce.expr(['Ln', NINF]).simplify().json).toBe(PINF);
  });

  test('Sqrt(-oo) through the parse route', () => {
    expect(ce.parse('\\sqrt{-\\infty}').evaluate().json).toEqual(DI_I);
  });
});

describe('Ceil, Floor, Round and Sign at ~oo', () => {
  const cases: Case[] = [
    ['Ceil(~oo) = ~oo', ['Ceil', CINF], CINF],
    ['Floor(~oo) = ~oo', ['Floor', CINF], CINF],
    ['Round(~oo) = ~oo', ['Round', CINF], CINF],
    ['Round(~oo, 2) = ~oo', ['Round', CINF, 2], CINF],
    ['Sign(~oo) = Indeterminate', ['Sign', CINF], 'Indeterminate'],
    ['Ceil(+oo) = +oo', ['Ceil', PINF], PINF],
    ['Sign(-oo) = -1', ['Sign', NINF], -1],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
    test(`${label} (.N())`, () => {
      const r = ce.expr(input as never).N().json;
      expect(r === 'NaN' ? 'Indeterminate' : r).toEqual(expected);
    });
  }

  for (const head of ['Ceil', 'Floor', 'Round', 'Sign']) {
    test(`${head}(~oo) is a valid expression`, () => {
      expect(ce.expr([head, CINF]).isValid).toBe(true);
    });
  }

  test('Ceil(Multiply(2, ~oo)), a compound operand', () => {
    expect(evaluate(['Ceil', ['Multiply', 2, CINF]])).toBe(CINF);
  });

  test('Ceil of a finite complex number is still rejected', () => {
    expect(ce.expr(['Ceil', ['Complex', 1, 1]]).isValid).toBe(false);
  });
});

describe('Inverse trigonometric and hyperbolic heads at the infinities', () => {
  const cases: Case[] = [
    ['Arcsin(+oo) = DirectedInfinity(-i)', ['Arcsin', PINF], DI_MINUS_I],
    ['Arcsin(-oo) = DirectedInfinity(i)', ['Arcsin', NINF], DI_I],
    ['Arccos(+oo) = DirectedInfinity(i)', ['Arccos', PINF], DI_I],
    ['Arccos(-oo) = DirectedInfinity(-i)', ['Arccos', NINF], DI_MINUS_I],
    ['Arcsin(~oo) = ~oo', ['Arcsin', CINF], CINF],
    ['Arccos(~oo) = ~oo', ['Arccos', CINF], CINF],
    ['Arctan(~oo) = Indeterminate', ['Arctan', CINF], 'Indeterminate'],
    ['Arccot(~oo) = Indeterminate', ['Arccot', CINF], 'Indeterminate'],
    ['Arccot(+oo) = 0', ['Arccot', PINF], 0],
    ['Arccot(-oo) = Pi', ['Arccot', NINF], 'Pi'],
    ['Arsinh(~oo) = ~oo', ['Arsinh', CINF], CINF],
    ['Arcosh(-oo) = +oo', ['Arcosh', NINF], PINF],
    ['Arcosh(~oo) = +oo', ['Arcosh', CINF], PINF],
    ['Artanh(~oo) = Indeterminate', ['Artanh', CINF], 'Indeterminate'],
    ['Arsech(~oo) = Indeterminate', ['Arsech', CINF], 'Indeterminate'],
    ['Exp(~oo) = Indeterminate', ['Exp', CINF], 'Indeterminate'],
    ['E^~oo = Indeterminate', ['Power', 'ExponentialE', CINF], 'Indeterminate'],
    ['2^~oo = Indeterminate', ['Power', 2, CINF], 'Indeterminate'],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label} (evaluate)`, () => {
      expect(evaluate(input)).toEqual(expected);
    });
    test(`${label} (.N())`, () => {
      const r = ce.expr(input as never).N();
      if (expected === 'Indeterminate') expect(r.isNaN).toBe(true);
      else if (Array.isArray(expected)) expect(r.operator).toBe(expected[0]);
      else if (typeof expected === 'string' && expected !== 'Pi')
        expect(r.json).toBe(expected);
    });
  }

  test('Arcosh(-oo) is +oo under .N(), not ∞ + iπ', () => {
    expect(ce.expr(['Arcosh', NINF]).N().json).toBe(PINF);
  });

  test('Arsinh(+oo) and Artanh(+oo) are unchanged', () => {
    expect(evaluate(['Arsinh', PINF])).toBe(PINF);
    expect(evaluate(['Artanh', PINF])).toEqual([
      'Multiply',
      ['Complex', 0, ['Rational', -1, 2]],
      'Pi',
    ]);
  });

  test('Arcsin(+oo) through the parse route', () => {
    expect(ce.parse('\\arcsin(\\infty)').evaluate().json).toEqual(DI_MINUS_I);
  });

  test('Arcsin(Multiply(2, +oo)), a compound operand', () => {
    expect(evaluate(['Arcsin', ['Multiply', 2, PINF]])).toEqual(DI_MINUS_I);
  });

  test('Arcsin(2) is still complex', () => {
    expect(ce.expr(['Arcsin', 2]).type.toString()).toBe('complex');
  });
});

describe('Sin, Cos, Tan, Cot, Sec and Csc of an infinity are Indeterminate', () => {
  const heads = ['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc'];
  const infinities = [PINF, NINF, CINF];
  for (const head of heads)
    for (const inf of infinities) {
      test(`${head}(${inf}) = Indeterminate (evaluate, valid at boxing)`, () => {
        const b = ce.expr([head, inf]);
        expect(b.isValid).toBe(true);
        expect(b.evaluate().json).toBe('Indeterminate');
      });
      test(`${head}(${inf}) = NaN (.N())`, () => {
        expect(ce.expr([head, inf]).N().isNaN).toBe(true);
      });
    }

  test('Sin(+oo) through the parse route', () => {
    const b = ce.parse('\\sin(\\infty)');
    expect(b.isValid).toBe(true);
    expect(b.evaluate().json).toBe('Indeterminate');
  });

  test('Sin(+oo - 3 + 3), a compound argument that reduces to +oo', () => {
    expect(evaluate(['Sin', ['Add', PINF, -3, 3]])).toBe('Indeterminate');
  });

  test('Sin(1) is unchanged', () => {
    expect(ce.expr(['Sin', 0]).evaluate().json).toBe(0);
  });
});

describe('Types do not claim real at an infinity with a complex or directed value', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('x', 'real | signed_infinity');
  ce2.declare('w', 'number');
  ce2.declare('u', '~oo');

  const notReal: [string, unknown][] = [
    ['Arcsin(x)', ['Arcsin', 'x']],
    ['Arccos(x)', ['Arccos', 'x']],
    ['Arcosh(x)', ['Arcosh', 'x']],
    ['Sqrt(x)', ['Sqrt', 'x']],
    ['Arcsin(u)', ['Arcsin', 'u']],
    ['Sin(u)', ['Sin', 'u']],
    ['Sin(w)', ['Sin', 'w']],
    ['Sign(u)', ['Sign', 'u']],
    ['Real(w)', ['Real', 'w']],
  ];
  for (const [label, input] of notReal) {
    test(`${label} is not typed real`, () => {
      const t = ce2.expr(input as never).type;
      expect(t.matches('real')).toBe(false);
    });
  }

  test('Ceil(u) admits ~oo', () => {
    expect(ce2.expr(['Ceil', 'u']).type.toString()).toContain('~oo');
  });

  test('Ceil(y) for a real y is still an integer', () => {
    ce2.declare('y', 'real');
    expect(ce2.expr(['Ceil', 'y']).type.toString()).toBe('integer');
  });

  test('Sign(y) for a real y is still integer<-1..1>', () => {
    expect(ce2.expr(['Sign', 'y']).type.toString()).toBe('integer<-1..1>');
  });
});

describe('Compiled JavaScript agrees with the interpreter', () => {
  const cases: [string, unknown, number][] = [
    ['Sin(+oo) is NaN, as Indeterminate', ['Sin', PINF], NaN],
    ['Tan(+oo) is NaN, as Indeterminate', ['Tan', PINF], NaN],
    ['Ln(-oo) has an infinite real part', ['Ln', NINF], Infinity],
    ['Arcosh(-oo) is +oo', ['Arcosh', NINF], Infinity],
  ];
  for (const [label, input, expected] of cases) {
    test(`${label}`, () => {
      const result = compile(ce.expr(input as never)).run?.();
      const re = typeof result === 'number' ? result : (result as any).re;
      expect(re).toBe(expected);
    });
  }

  test('Arcosh(z) is +oo at an infinite complex argument', () => {
    const ce3 = new ComputeEngine();
    ce3.declare('z', 'complex');
    const f = compile(ce3.expr(['Arcosh', 'z']));
    for (const z of [
      { re: Infinity, im: 0 },
      { re: -Infinity, im: 0 },
      { re: Infinity, im: Infinity },
    ])
      expect(f.run?.({ z })).toBe(Infinity);
  });
});
