import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { exactOrder } from '../../src/compute-engine/boxed-expression/compare';

// One order for exact values (`exactOrder`), and one splitter of a constant
// into its real and imaginary parts (`complexParts`). Every value below is
// also checked against `.N()` of the operand, so that a wrong closed form
// cannot pass.

const ce = new ComputeEngine();

function evaluate(expr: MathJsonExpression | string): Expression {
  return (typeof expr === 'string' ? ce.parse(expr) : ce.box(expr)).evaluate();
}

/** `x` and `y` have the same numeric value. */
function expectSameValue(x: Expression, y: Expression) {
  const a = x.N();
  const b = y.N();
  expect(a.re).toBeCloseTo(b.re, 12);
  expect(a.im).toBeCloseTo(b.im, 12);
}

describe('ORDER OF COMPLEX VALUES', () => {
  // `cmp()` computed `a − b` and ordered the operands when the difference was
  // a real number, without checking that they are real.
  test('complex values whose difference is real are not ordered', () => {
    for (const [a, b] of [
      ['\\pi+i', '4+i'],
      ['\\pi+i', '3+i'],
      ['\\pi+i', '4'],
    ]) {
      const x = ce.parse(a);
      const y = ce.parse(b);
      expect(x.isLess(y)).toBeUndefined();
      expect(x.isGreater(y)).toBeUndefined();
      expect(y.isLess(x)).toBeUndefined();
    }
    expect(ce.parse('\\pi+i').isLess(4)).toBeUndefined();
    expect(
      ce
        .box(['Add', 'Pi', 'ImaginaryUnit'])
        .isLess(ce.box(['Add', 4, 'ImaginaryUnit']))
    ).toBeUndefined();
  });

  test('the relation stays unevaluated', () => {
    expect(evaluate('\\pi+i < 4+i').operator).toBe('Less');
    // `a > b` is canonically `b < a`.
    expect(
      evaluate(['Greater', ['Add', 'Pi', 'ImaginaryUnit'], 3]).operator
    ).toBe('Less');
  });

  test('a symbol declared complex is not ordered', () => {
    const e = new ComputeEngine();
    e.declare('z', 'complex');
    expect(e.box('z').isLess(e.parse('z+1'))).toBeUndefined();
    expect(e.box('z').isGreater(e.parse('z-1'))).toBeUndefined();
    // Equality is defined for complex values.
    expect(e.box('z').isEqual(e.box('z'))).toBe(true);
    expect(e.box('z').isLessEqual(e.box('z'))).toBe(true);
  });

  test('equality of complex values is unchanged', () => {
    expect(ce.parse('\\pi+i').isEqual(ce.parse('\\pi+i'))).toBe(true);
    expect(ce.parse('\\pi+i').isEqual(ce.parse('\\pi+2i'))).toBe(false);
    expect(ce.parse('1+i').isEqual(ce.parse('1+i'))).toBe(true);
  });

  test('a symbol of unknown type is still ordered against itself', () => {
    const e = new ComputeEngine();
    expect(e.box('x').isLess(e.parse('x+1'))).toBe(true);
  });
});

describe('EQUALITY AGAINST AN ASSUMED EXACT VALUE', () => {
  // `eq()` made both operands numeric before it looked up the assumptions,
  // so a fact stated with the exact value was not found.
  test('x ≠ √2', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['NotEqual', 'x', ['Sqrt', 2]]));
    expect(e.verify(e.box(['Equal', 'x', ['Sqrt', 2]]))).toBe(false);
    expect(e.verify(e.box(['NotEqual', 'x', ['Sqrt', 2]]))).toBe(true);
  });

  test('a fact stated with a float is still found', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['NotEqual', 'w', 0.5]));
    expect(e.verify(e.box(['Equal', 'w', 0.5]))).toBe(false);
  });
});

describe('MAX AND MIN OF CONSTANTS', () => {
  const cases: [string, MathJsonExpression, string][] = [
    ['\\max(\\pi,3)', ['Max', 'Pi', 3], 'pi'],
    ['\\max(\\pi,\\sqrt{10})', ['Max', 'Pi', ['Sqrt', 10]], 'sqrt(10)'],
    ['\\max(2,\\pi)', ['Max', 2, 'Pi'], 'pi'],
    ['\\min(\\pi,3)', ['Min', 'Pi', 3], '3'],
    [
      '\\min(\\pi,e,\\sqrt2)',
      ['Min', 'Pi', 'ExponentialE', ['Sqrt', 2]],
      'sqrt(2)',
    ],
    [
      '\\max(\\pi,e^2,\\sqrt{50})',
      ['Max', 'Pi', ['Power', 'ExponentialE', 2], ['Sqrt', 50]],
      'e^2',
    ],
    ['\\min(\\sin(1),\\cos(1))', ['Min', ['Sin', 1], ['Cos', 1]], 'cos(1)'],
  ];
  for (const [tex, json, expected] of cases)
    test(tex, () => {
      for (const input of [tex, json]) {
        const result = evaluate(input);
        expect(result.toString()).toBe(expected);
        // The same value as the numeric evaluation of the operands.
        const ops = (input === tex ? ce.parse(tex) : ce.box(json)).ops!;
        const values = ops.map((op) => op.N().re);
        const isMax = (input === tex ? tex : json[0]).toString().includes('ax');
        expect(result.N().re).toBeCloseTo(
          isMax ? Math.max(...values) : Math.min(...values),
          12
        );
      }
    });

  test('a symbol with no value stays in the result', () => {
    expect(
      evaluate(['Max', 'Pi', 'x', 3]).isSame(ce.box(['Max', 'Pi', 'x']))
    ).toBe(true);
  });

  test('a complex constant stays in the result', () => {
    const result = evaluate(['Max', ['Add', 'Pi', 'ImaginaryUnit'], 3]);
    expect(result.operator).toBe('Max');
    expect(result.nops).toBe(2);
  });

  test('N()', () => {
    expect(ce.parse('\\max(\\pi,3)').N().re).toBeCloseTo(Math.PI, 12);
  });
});

describe('MATRIX NORMS ORDER EXACT LINE SUMS WITH exactOrder', () => {
  test('order 1 and order ∞ with a constant entry', () => {
    const M: MathJsonExpression = ['List', ['List', 'Pi', 1], ['List', 3, 1]];
    // Column sums π + 3 and 2; row sums π + 1 and 4, and π + 1 > 4.
    expect(evaluate(['Norm', M, 1]).toString()).toBe('3 + pi');
    expect(evaluate(['Norm', M, 'PositiveInfinity']).toString()).toBe('1 + pi');
    const P: MathJsonExpression = ['List', ['List', 'Pi', 0], ['List', 3, 1]];
    // Row sums π and 4, and 4 > π.
    expect(evaluate(['Norm', P, 'PositiveInfinity']).toString()).toBe('4');
    const N: MathJsonExpression = ['List', ['List', 'Pi', 1], ['List', 3, 0]];
    // Row sums π + 1 and 3.
    expect(evaluate(['Norm', N, 'PositiveInfinity']).toString()).toBe('1 + pi');
    expect(evaluate(['Norm', N, 'PositiveInfinity']).N().re).toBeCloseTo(
      Math.PI + 1,
      12
    );
  });

  test('line sums that a float64 cannot separate', () => {
    const M: MathJsonExpression = [
      'List',
      ['List', ['Power', 10, 20], 0],
      ['List', 0, ['Add', ['Power', 10, 20], 1]],
    ];
    expect(evaluate(['Norm', M, 1]).toString()).toBe('100000000000000000001');
  });

  test('an inexact entry gives a machine sum', () => {
    const M: MathJsonExpression = ['List', ['List', 'Pi', 1], ['List', 3, 1.2]];
    expect(evaluate(['Norm', M, 'PositiveInfinity']).re).toBeCloseTo(4.2, 12);
  });

  test('spectral norm of a matrix with one nonzero entry per line', () => {
    const M: MathJsonExpression = [
      'List',
      ['List', 0, 'Pi'],
      ['List', ['Sqrt', 10], 0],
    ];
    expect(evaluate(['Norm', M, 2]).toString()).toBe('sqrt(10)');
    const tiny: MathJsonExpression = [
      'List',
      ['List', ['Power', 10, -400], 0],
      ['List', 0, ['Multiply', ['Sqrt', 2], ['Power', 10, -400]]],
    ];
    expect(
      evaluate(['Norm', tiny, 2]).isSame(
        evaluate(['Multiply', ['Sqrt', 2], ['Power', 10, -400]])
      )
    ).toBe(true);
  });
});

describe('SQUARE ROOT OF A SQUARED REAL CONSTANT', () => {
  const cases: [string, string][] = [
    ['\\sqrt{\\pi^2}', 'pi'],
    ['\\sqrt{(-\\pi)^2}', 'pi'],
    ['\\sqrt{(1-\\pi)^2}', '-1 + pi'],
    ['\\sqrt{2\\pi^2}', 'sqrt(2) * pi'],
    ['\\sqrt{4\\pi^2}', '2pi'],
    ['\\sqrt{8\\pi^2}', '2sqrt(2) * pi'],
    ['\\sqrt{e^2\\pi^2}', 'e * pi'],
    ['\\sqrt{\\pi^4}', 'pi^2'],
  ];
  for (const [tex, expected] of cases)
    test(tex, () => {
      const result = evaluate(tex);
      expect(result.toString()).toBe(expected);
      expectSameValue(result, ce.parse(tex));
    });

  test('a symbol keeps its square root', () => {
    expect(evaluate('\\sqrt{x^2}').toString()).toBe('sqrt(x^2)');
  });
});

describe('ABS OF A CONSTANT PRODUCT, WITHOUT A PRODUCT RULE', () => {
  const cases: [string, MathJsonExpression, string][] = [
    ['|\\pi i|', ['Abs', ['Multiply', 'Pi', 'ImaginaryUnit']], 'pi'],
    [
      '|\\pi(1+i)|',
      ['Abs', ['Multiply', 'Pi', ['Complex', 1, 1]]],
      'sqrt(2) * pi',
    ],
    [
      '|e+\\pi i|',
      ['Abs', ['Add', 'ExponentialE', ['Multiply', 'Pi', 'ImaginaryUnit']]],
      'sqrt(e^2 + pi^2)',
    ],
    [
      '|\\frac{1+i}{2-i}|',
      ['Abs', ['Divide', ['Complex', 1, 1], ['Complex', 2, -1]]],
      'sqrt(10)/5',
    ],
  ];
  for (const [tex, json, expected] of cases)
    test(tex, () => {
      for (const input of [tex, json]) {
        const result = evaluate(input);
        expect(result.toString()).toBe(expected);
        const z = (input === tex ? ce.parse(tex) : ce.box(json)).op1.N();
        expect(result.N().re).toBeCloseTo(Math.hypot(z.re, z.im), 12);
      }
    });
});

describe('PARTS OF A CONSTANT: ONE SPLITTER', () => {
  const z: MathJsonExpression = ['Multiply', 'Pi', ['Add', 1, 'ImaginaryUnit']];
  const w: MathJsonExpression = [
    'Add',
    'ExponentialE',
    ['Multiply', 'Pi', 'ImaginaryUnit'],
  ];
  test('Real, Imaginary, Argument', () => {
    for (const x of [z, w]) {
      const v = ce.box(x).N();
      expect(evaluate(['Real', x]).N().re).toBeCloseTo(v.re, 12);
      expect(evaluate(['Imaginary', x]).N().re).toBeCloseTo(v.im, 12);
      expect(evaluate(['Argument', x]).N().re).toBeCloseTo(
        Math.atan2(v.im, v.re),
        12
      );
    }
    expect(evaluate(['Real', z]).toString()).toBe('pi');
    expect(evaluate(['Argument', z]).toString()).toBe('1/4 * pi');
  });

  test('Conjugate is re − im·i', () => {
    for (const x of [z, w]) {
      const v = ce.box(x).N();
      const c = evaluate(['Conjugate', x]);
      expect(c.operator).not.toBe('Conjugate');
      expect(c.N().re).toBeCloseTo(v.re, 12);
      expect(c.N().im).toBeCloseTo(-v.im, 12);
    }
  });

  test('an operand with a free variable is not split', () => {
    for (const op of ['Real', 'Imaginary', 'Argument', 'Conjugate'])
      expect(evaluate([op, ['Add', 'z', 'ImaginaryUnit']]).operator).toBe(op);
  });
});

describe('EIGENVALUES OF A 3×3 MATRIX: ONE REAL-ONLY CONVERSION', () => {
  test('a real matrix', () => {
    const result = evaluate([
      'Eigenvalues',
      ['List', ['List', 2, 0, 0], ['List', 0, 3, 4], ['List', 0, 4, 9]],
    ]);
    const values = result.ops!.map((x) => x.re).sort((a, b) => a - b);
    expect(values[0]).toBeCloseTo(1, 10);
    expect(values[1]).toBeCloseTo(2, 10);
    expect(values[2]).toBeCloseTo(11, 10);
  });

  test('a complex entry, or one a float64 cannot hold, stays unevaluated', () => {
    for (const entry of [
      ['Complex', 1, 1],
      ['Power', 10, 400],
    ] as MathJsonExpression[])
      expect(
        evaluate([
          'Eigenvalues',
          ['List', ['List', entry, 0, 0], ['List', 0, 3, 1], ['List', 0, 1, 3]],
        ]).operator
      ).toBe('Eigenvalues');
  });
});

describe('N() OF A COMPLEX NUMBER LITERAL IS INEXACT', () => {
  for (const tex of ['1+i', 'i', '2i', '\\frac12+i', '-3+4i'])
    test(tex, () => {
      const z = ce.parse(tex);
      const n = z.N();
      expect(n.isNumberLiteral).toBe(true);
      expect(n.isExact).toBe(false);
      expect(n.re).toBe(z.re);
      expect(n.im).toBe(z.im);
    });

  test('a real integer stays exact', () => {
    expect(ce.parse('3').N().isExact).toBe(true);
  });

  // The decision is made by the numeric value itself, so every reader of
  // `NumericValue.N()` sees it, not only `BoxedNumber.N()`.
  test('the numeric value of a Gaussian integer', () => {
    for (const tex of ['1+i', 'i', '-3+4i']) {
      const v = ce.parse(tex).numericValue;
      if (typeof v === 'number') throw new Error('expected a complex value');
      expect(v.N().isExact).toBe(false);
      expect(v.N().re).toBe(v.re);
      expect(v.N().im).toBe(v.im);
    }
  });

  test('an exact operation lifts the float back to an exact value', () => {
    // `(1 + i)·(1/2)` with the float `1 + i` from `.N()` is the exact
    // `1/2 + i/2`.
    const z = ce.parse('1+i').N();
    const w = ce.function('Multiply', [ce.parse('\\frac12'), z]).evaluate();
    expect(w.re).toBe(0.5);
    expect(w.im).toBe(0.5);
  });
});

// `Distance(p, q)` is `Norm(p − q)`: each term is the SQUARED MODULUS of a
// coordinate difference, so the distance between complex points is real.
describe('DISTANCE BETWEEN COMPLEX POINTS', () => {
  test('is the modulus of the difference', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Distance', ['Tuple', 2, 'ImaginaryUnit'], ['Tuple', 1, 1]]);
    expect(e.evaluate().toString()).toBe('sqrt(3)');
    expect(e.N().re).toBeCloseTo(Math.sqrt(3), 12);
    expect(e.N().im).toBe(0);
  });
  test('real points are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Distance', ['Tuple', 0, 0], ['Tuple', 3, 4]]).evaluate().toString()
    ).toBe('5');
  });
});

// With no tolerance (`Max`, `Min`, `Sort`), a constant with a value (`π`,
// `e`) is ordered against a float at the working precision. Its machine
// value `π.re` is the float `3.141592653589793`, so an order read from it
// made the float and `π` a tie, and the result depended on the operand
// order. At the working precision, π − 3.141592653589793 = 2.38·10⁻¹⁶ and
// e − 2.718281828459045 = 2.35·10⁻¹⁶.
describe('A CONSTANT AGAINST THE NEAREST FLOAT', () => {
  const PI = 3.141592653589793;
  const E = 2.718281828459045;
  test('the working-precision difference is positive', () => {
    expect(ce.box(['Subtract', 'Pi', PI]).N().re).toBeGreaterThan(0);
    expect(ce.box(['Subtract', 'ExponentialE', E]).N().re).toBeGreaterThan(0);
  });

  const cases: [MathJsonExpression, string, string][] = [
    [['Max', PI, 'Pi'], `\\max(${PI},\\pi)`, 'pi'],
    [['Max', 'Pi', PI], `\\max(\\pi,${PI})`, 'pi'],
    [['Min', PI, 'Pi'], `\\min(${PI},\\pi)`, `${PI}`],
    [['Min', 'Pi', PI], `\\min(\\pi,${PI})`, `${PI}`],
    [['Max', E, 'ExponentialE'], `\\max(${E},e)`, 'e'],
    [['Max', 'ExponentialE', E], `\\max(e,${E})`, 'e'],
    [['Min', E, 'ExponentialE'], `\\min(${E},e)`, `${E}`],
    [['Min', 'ExponentialE', E], `\\min(e,${E})`, `${E}`],
  ];
  for (const [json, tex, expected] of cases)
    test(tex, () => {
      expect(evaluate(json).toString()).toBe(expected);
      expect(evaluate(tex).toString()).toBe(expected);
    });

  test('Sort is ascending in both operand orders', () => {
    for (const input of [
      ['Sort', ['List', 'ExponentialE', E]],
      ['Sort', ['List', E, 'ExponentialE']],
    ] as MathJsonExpression[])
      expect(evaluate(input).toString()).toBe(`[${E},e]`);
    for (const input of [
      `\\operatorname{Sort}([e, ${E}])`,
      `\\operatorname{Sort}([${E}, e])`,
    ])
      expect(evaluate(input).toString()).toBe(`[${E},e]`);
  });

  test('a sum against a float is unchanged', () => {
    const x = 4.141592653589793;
    expect(evaluate(['Max', ['Add', 1, 'Pi'], x]).toString()).toBe('1 + pi');
    expect(evaluate(['Max', x, ['Add', 1, 'Pi']]).toString()).toBe('1 + pi');
  });

  test('the relational predicates keep the engine tolerance', () => {
    // With the default tolerance, `π` and its nearest float are equal.
    expect(ce.box('Pi').isEqual(PI)).toBe(true);
    expect(ce.box('Pi').isGreater(PI)).toBe(false);
  });
});

// `c = π − 314159265358979323846264338327950289/10³⁵` is −5.8·10⁻³⁶. At the
// default precision (21 digits) `c.N()` is +2.6·10⁻²¹: the difference is
// smaller than its rounding error, so its sign cannot be read from it. The
// order is then computed again at 50 digits (`exactOrder`, step 2), where
// the difference is larger than its error bound.
describe('A DIFFERENCE SMALLER THAN ITS ROUNDING ERROR', () => {
  const r: MathJsonExpression = [
    'Rational',
    '314159265358979323846264338327950289',
    '100000000000000000000000000000000000',
  ];
  const c: MathJsonExpression = ['Subtract', 'Pi', r];

  test('at the default precision, the order is decided at 50 digits', () => {
    // The sign of `c` does not use the higher precision.
    expect(ce.box(c).isNegative).toBeUndefined();
    // √(c²) is |c|, that is −c = r − π, and not the negative `c`.
    // (Its value at 21 digits has the wrong sign; the next test checks the
    // value at 60 digits.)
    const root = evaluate(['Sqrt', ['Power', c, 2]]);
    expect(root.isSame(evaluate(['Subtract', r, 'Pi']))).toBe(true);
    expect(evaluate(['Abs', c]).isSame(root)).toBe(true);
    expect(evaluate(['Max', 'Pi', r]).isSame(ce.box(r))).toBe(true);
    expect(evaluate(['Max', r, 'Pi']).isSame(ce.box(r))).toBe(true);
    expect(evaluate(['Min', 'Pi', r]).toString()).toBe('pi');
    expect(evaluate(['Min', r, 'Pi']).toString()).toBe('pi');
  });

  test('at precision 60, the order is decided', () => {
    const e = new ComputeEngine({ precision: 60 });
    try {
      // An independent check: the difference at 60 digits is −5.8·10⁻³⁶.
      const v = e.box(c).N();
      expect(v.re).toBeLessThan(0);
      expect(v.re).toBeCloseTo(-5.802830600624894e-36, 45);
      const root = e.box(['Sqrt', ['Power', c, 2]]).evaluate();
      expect(root.N().re).toBeCloseTo(5.802830600624894e-36, 45);
      expect(e.box(['Max', 'Pi', r]).evaluate().isSame(e.box(r))).toBe(true);
      expect(e.box(['Max', r, 'Pi']).evaluate().isSame(e.box(r))).toBe(true);
      expect(e.box(['Min', 'Pi', r]).evaluate().toString()).toBe('pi');
      expect(e.box(['Min', r, 'Pi']).evaluate().toString()).toBe('pi');
    } finally {
      // Constructing an engine sets the global precision of big decimals.
      // Setting the precision of the shared engine to its current value
      // does not reset it, so it is set to another value first.
      ce.precision = 30;
      ce.precision = 'auto';
    }
  });
});

// The order of `a` and `b` was read from the sign of `a − b` without a check
// that `a` and `b` are real. `z + π` and `z + 4` differ by a real number, but
// they are complex when `z` is.
describe('THE VALUES OF THE OPERANDS MUST BE REAL TO BE ORDERED', () => {
  test('a symbol of type number with a complex value', () => {
    const e = new ComputeEngine();
    e.declare('z', 'number');
    e.assign('z', e.parse('1+i'));
    expect(e.parse('z+\\pi').isLess(e.parse('z+4'))).toBeUndefined();
    expect(e.parse('z+4').isGreater(e.parse('z+\\pi'))).toBeUndefined();
    expect(e.parse('z+\\pi').isEqual(e.parse('z+\\pi'))).toBe(true);
  });

  test('Gamma(i), of type number', () => {
    const g: MathJsonExpression = ['Gamma', 'ImaginaryUnit'];
    const a = ce.box(['Add', g, 1]);
    const b = ce.box(['Add', g, 2]);
    expect(a.isLess(b)).toBeUndefined();
    expect(b.isGreater(a)).toBeUndefined();
    expect(a.isEqual(a)).toBe(true);
  });

  test('a function declared real whose value is complex', () => {
    // The declaration says `real`, but `f(−4)` is `2i`: the values decide.
    const e = new ComputeEngine();
    e.declare('f', '(number) -> real');
    e.assign('f', e.parse('x \\mapsto \\sqrt{x}'));
    expect(e.parse('f(-4)+1').isLess(e.parse('f(-4)+2'))).toBeUndefined();
  });

  test('a real sum is still ordered', () => {
    expect(ce.parse('\\pi+1').isLess(ce.parse('\\pi+2'))).toBe(true);
    expect(ce.parse('\\pi+1').isLess(5)).toBe(true);
  });
});

describe('A FINITE VALUE AGAINST A SIGNED INFINITY', () => {
  const cases: [MathJsonExpression, string][] = [
    [['Max', 'PositiveInfinity', 'Pi'], '+oo'],
    [['Max', 'Pi', 'PositiveInfinity'], '+oo'],
    [['Min', 'NegativeInfinity', 'Pi'], '-oo'],
    [['Min', 'Pi', 'NegativeInfinity'], '-oo'],
    [['Max', 'NegativeInfinity', 'Pi'], 'pi'],
    [['Min', 'PositiveInfinity', 'Pi'], 'pi'],
  ];
  for (const [json, expected] of cases)
    test(JSON.stringify(json), () =>
      expect(evaluate(json).toString()).toBe(expected)
    );

  test('isLess', () => {
    expect(ce.box('Pi').isLess(ce.box('PositiveInfinity'))).toBe(true);
    expect(ce.box('PositiveInfinity').isGreater(ce.box('Pi'))).toBe(true);
    expect(ce.box('Pi').isGreater(ce.box('NegativeInfinity'))).toBe(true);
  });
});

// `√(c²)` and `|c|` are the same value, and both are found from the sign of
// the real constant `c`.
describe('ABS OF A REAL CONSTANT', () => {
  const cases: [string, MathJsonExpression, string][] = [
    ['|1-\\pi|', ['Abs', ['Subtract', 1, 'Pi']], '-1 + pi'],
    ['|\\pi-1|', ['Abs', ['Subtract', 'Pi', 1]], '-1 + pi'],
    [
      '|i(1-\\pi)|',
      ['Abs', ['Multiply', 'ImaginaryUnit', ['Subtract', 1, 'Pi']]],
      '-1 + pi',
    ],
    [
      '\\sqrt{(1-\\pi)^2}',
      ['Sqrt', ['Power', ['Subtract', 1, 'Pi'], 2]],
      '-1 + pi',
    ],
    [
      '|\\sqrt2-\\sqrt3|',
      ['Abs', ['Subtract', ['Sqrt', 2], ['Sqrt', 3]]],
      '-sqrt(2) + sqrt(3)',
    ],
  ];
  for (const [tex, json, expected] of cases)
    test(tex, () => {
      for (const input of [tex, json]) {
        const result = evaluate(input);
        expect(result.toString()).toBe(expected);
        // The numeric value of the operand, computed independently.
        expectSameValue(result, ce.box(json).N());
      }
    });

  test('the vector norm', () => {
    const result = evaluate(['Norm', ['List', ['Subtract', 1, 'Pi']]]);
    expect(result.toString()).toBe('-1 + pi');
  });

  test('a symbol stays in Abs', () => {
    expect(evaluate(['Abs', ['Subtract', 1, 'x']]).operator).toBe('Abs');
  });
});

describe('CONJUGATE DISTRIBUTES OVER THE STRUCTURE', () => {
  const b: MathJsonExpression = [
    'Add',
    1,
    ['Multiply', ['Sqrt', 2], 'ImaginaryUnit'],
  ];
  test('an integer power above 16', () => {
    for (const n of [20, -20, 3]) {
      const x: MathJsonExpression = ['Power', b, n];
      const result = evaluate(['Conjugate', x]);
      expect(result.operator).not.toBe('Conjugate');
      const v = ce.box(x).N();
      const w = result.N();
      const scale = Math.hypot(v.re, v.im);
      expect(Math.abs(w.re - v.re) / scale).toBeLessThan(1e-12);
      expect(Math.abs(w.im + v.im) / scale).toBeLessThan(1e-12);
    }
  });

  test('a quotient has no double negation', () => {
    const x: MathJsonExpression = [
      'Divide',
      1,
      ['Add', 'Pi', ['Multiply', ['Sqrt', 2], 'ImaginaryUnit']],
    ];
    const result = evaluate(['Conjugate', x]);
    expect(result.toString()).not.toMatch(/-\s*i\s*\*\s*\(-/);
    expect(result.toString()).toBe('1 / (-sqrt(2)i + pi)');
    const v = ce.box(x).N();
    expect(result.N().re).toBeCloseTo(v.re, 12);
    expect(result.N().im).toBeCloseTo(-v.im, 12);
  });

  test('parse route', () => {
    const result = evaluate('\\overline{(1+\\sqrt2 i)^{20}}');
    expect(result.operator).not.toBe('Conjugate');
    const v = ce.parse('(1+\\sqrt2 i)^{20}').N();
    expect(result.N().re / v.re).toBeCloseTo(1, 12);
    expect(result.N().im / v.im).toBeCloseTo(-1, 12);
  });
});

describe('DISTANCE WITH A CONSTANT COORDINATE', () => {
  const cases: [MathJsonExpression, MathJsonExpression, string][] = [
    [['Tuple', 'Pi', 0], ['Tuple', 0, 0], 'pi'],
    [['Tuple', 0, 0], ['Tuple', 'Pi', 0], 'pi'],
    [['Tuple', ['Subtract', 1, 'Pi'], 0], ['Tuple', 0, 0], '-1 + pi'],
    [
      ['Tuple', ['Add', 1, ['Multiply', ['Sqrt', 2], 'ImaginaryUnit']], 0],
      ['Tuple', 0, 0],
      'sqrt(3)',
    ],
    [['List', 'Pi', 0], ['List', 0, 0], 'pi'],
    [['Tuple', 'Pi', 'ExponentialE'], ['Tuple', 0, 0], 'sqrt(e^2 + pi^2)'],
  ];
  for (const [p, q, expected] of cases)
    test(`${JSON.stringify(p)} ${JSON.stringify(q)}`, () => {
      const d = ce.box(['Distance', p, q]);
      const result = d.evaluate();
      expect(result.toString()).toBe(expected);
      // The numeric value is the independent computation.
      expect(result.N().re).toBeCloseTo(d.N().re, 12);
      expect(result.N().im).toBe(0);
    });

  test('parse route', () => {
    const result = evaluate('\\operatorname{Distance}((\\pi, 0), (0, 0))');
    expect(result.toString()).toBe('pi');
  });

  test('an infinite leg gives +oo, a free symbol is an error', () => {
    expect(
      evaluate([
        'Distance',
        ['Tuple', 'PositiveInfinity', 'NaN'],
        ['Tuple', 0, 0],
      ]).toString()
    ).toBe('+oo');
    expect(
      evaluate(['Distance', ['Tuple', 'Pi', 'NaN'], ['Tuple', 0, 0]]).toString()
    ).toBe('NaN');
    expect(
      evaluate(['Distance', ['Tuple', 'x', 0], ['Tuple', 0, 0]]).operator
    ).toBe('Error');
  });
});

// `cmp` answered `1 + π > 3` but not `3 < 1 + π`: a number literal on the
// left was only ordered against a symbol.
describe('A NUMBER LITERAL AGAINST A FUNCTION EXPRESSION', () => {
  test('both operand orders', () => {
    expect(ce.number(3).isLess(ce.parse('1+\\pi'))).toBe(true);
    expect(ce.parse('1+\\pi').isGreater(3)).toBe(true);
    expect(ce.number(3).isGreater(ce.parse('1+\\sqrt2'))).toBe(true);
    expect(ce.number(3).isLess(ce.parse('\\pi+i'))).toBeUndefined();
  });
});

// The vector ∞-norm compared machine values, and read no value for a
// magnitude that is not a number literal.
describe('THE VECTOR ∞-NORM ORDERS EXACT MAGNITUDES', () => {
  const cases: [MathJsonExpression, string][] = [
    [['Tuple', 'Pi', 3], 'pi'],
    [['List', ['Subtract', 1, 'Pi'], 2], '-1 + pi'],
    [['List', 2, ['Subtract', 1, 'Pi']], '-1 + pi'],
    [
      ['List', ['Power', 10, 20], ['Add', ['Power', 10, 20], 1]],
      '100000000000000000001',
    ],
    [['List', 'x', 'NaN'], 'NaN'],
  ];
  for (const [v, expected] of cases)
    test(JSON.stringify(v), () =>
      expect(evaluate(['Norm', v, 'PositiveInfinity']).toString()).toBe(
        expected
      )
    );

  test('a magnitude with no value leaves the norm undecided', () => {
    expect(
      evaluate(['Norm', ['List', 'x', 3], 'PositiveInfinity']).operator
    ).toBe('Norm');
  });
});

// `Erfc` of a complex argument is `1 − Erf(z)`. Values checked against
// `scipy.special.erfc`.
describe('ERFC OF A COMPLEX ARGUMENT', () => {
  test('evaluates with the complex Erf kernel', () => {
    const ce = new ComputeEngine();
    const a = ce.parse('\\operatorname{erfc}(0.5+\\imaginaryI)').evaluate();
    expect(a.re).toBeCloseTo(-0.2048475583142182, 12);
    expect(a.im).toBeCloseTo(-1.024400881608446, 12);
    const b = ce.parse('\\operatorname{erfc}(1+\\imaginaryI)').N();
    expect(b.re).toBeCloseTo(-0.3161512816979476, 12);
    expect(b.im).toBeCloseTo(-0.19045346923783463, 12);
  });
});

//
// A SIGN IS NEVER READ FROM ROUNDING NOISE
//
// Each value below is not zero, but it is much smaller than the rounding
// error of its computation at the default precision (21 digits). Its order
// against 0 must then be undecided. At precision 150 the error is smaller
// than the value, and the order is decided, with the correct sign. The
// values were checked against the digits of π and √2:
// - `r = 314159265358979323846264338327950288/10³⁵` is π − 4.1971693993751·10⁻³⁶,
//   so `sin r = 4.1971693993751·10⁻³⁶`;
// - `√2 − 414213562373095048801688724209698078569/10³⁹` is
//   1 + 6.7187537694807·10⁻⁴⁰, so `L = 6.7187537694807·10⁻⁴⁰`;
// - `ln((10³⁶ + 1)/10³⁶) = 10⁻³⁶ − 5·10⁻⁷³`.
//

const R: MathJsonExpression = [
  'Divide',
  '314159265358979323846264338327950288',
  ['Power', 10, 35],
];
const R_LATEX = '\\frac{314159265358979323846264338327950288}{10^{35}}';
const SIN_R: MathJsonExpression = ['Sin', R];
const L: MathJsonExpression = [
  'Ln',
  [
    'Subtract',
    ['Sqrt', 2],
    ['Divide', '414213562373095048801688724209698078569', ['Power', 10, 39]],
  ],
];
const L_LATEX =
  '\\ln(\\sqrt{2}-\\frac{414213562373095048801688724209698078569}{10^{39}})';
const LN_Q: MathJsonExpression = [
  'Ln',
  ['Divide', ['Add', ['Power', 10, 36], 1], ['Power', 10, 36]],
];
const TINY: MathJsonExpression = ['Power', 10, -40];

/** Run `f` with an engine at precision 150. Constructing an engine sets the
 * precision of big decimals for the whole module, so the precision of the
 * shared engine is set again after `f` (to another value first: setting it
 * to its current value does nothing). */
function atHighPrecision(f: (e: ComputeEngine) => void) {
  const e = new ComputeEngine({ precision: 150 });
  try {
    f(e);
  } finally {
    ce.precision = 30;
    ce.precision = 'auto';
  }
}

describe('A SIGN IS NEVER READ FROM ROUNDING NOISE', () => {
  test('a computed zero is not a tie: sin(r) against 0', () => {
    for (const x of [ce.box(SIN_R), ce.parse(`\\sin(${R_LATEX})`)]) {
      expect(x.N().isSame(0)).toBe(true); // the value at 21 digits
      // Not a tie: the order is decided at 50 digits (`exactOrder`, step 2).
      expect(exactOrder(x, ce.Zero)).toBe(1);
      expect(exactOrder(ce.Zero, x)).toBe(-1);
      // The sign does not use the higher precision.
      expect(x.sgn).toBeUndefined();
    }
  });

  // The values are decided at 50 digits, the precision of the second
  // attempt of `exactOrder` (step 2). At 21 digits, the computed values are
  // rounding noise.
  test('values near a root of ln and sin: decided at 50 digits', () => {
    const tiny = ce.box(TINY);
    for (const [x, y] of [
      [ce.box(L), ce.Zero],
      [ce.parse(L_LATEX), ce.Zero],
      [ce.box(LN_Q), tiny],
      [ce.box(SIN_R), tiny],
      [ce.parse(`\\sin(${R_LATEX})`), ce.parse('10^{-40}')],
    ]) {
      expect(exactOrder(x, y)).toBe(1);
      expect(exactOrder(y, x)).toBe(-1);
    }
    // `L` computes as −3.1·10⁻²² at 21 digits. It is positive.
    expect(ce.box(L).N().re).toBeLessThan(0);
    expect(evaluate(['Max', L, 0]).isSame(evaluate(L))).toBe(true);
    expect(evaluate(['Min', 0, L]).isSame(0)).toBe(true);
    expect(evaluate(`\\max(${L_LATEX}, 0)`).isSame(evaluate(L_LATEX))).toBe(
      true
    );
    const sorted = evaluate(['Sort', ['List', L, 0]]);
    expect(sorted.operator).toBe('List');
    expect(sorted.ops![0].isSame(0)).toBe(true);
    expect(sorted.ops![1].isSame(evaluate(L))).toBe(true);
  });

  test('the same values are ordered at precision 150', () =>
    atHighPrecision((e) => {
      const tiny = e.box(TINY);
      const cases: [Expression, Expression, number][] = [
        [e.box(SIN_R), e.Zero, 4.1971693993751e-36],
        [e.parse(`\\sin(${R_LATEX})`), e.Zero, 4.1971693993751e-36],
        [e.box(L), e.Zero, 6.7187537694807e-40],
        [e.parse(L_LATEX), e.Zero, 6.7187537694807e-40],
        [e.box(LN_Q), tiny, 1e-36],
        [e.box(SIN_R), tiny, 4.1971693993751e-36],
      ];
      for (const [x, y, value] of cases) {
        expect(x.N().re / value).toBeCloseTo(1, 12);
        expect(exactOrder(x, y)).toBe(1);
        expect(exactOrder(y, x)).toBe(-1);
      }
      expect(e.box(['Max', L, 0]).evaluate().isSame(e.box(L))).toBe(true);
      expect(e.box(['Min', L, 0]).evaluate().isSame(0)).toBe(true);
      const sorted = e.box(['Sort', ['List', L, 0]]).evaluate();
      expect(sorted.operator).toBe('List');
      expect(sorted.ops![0].isSame(0)).toBe(true);
      expect(sorted.ops![1].isSame(e.box(L))).toBe(true);
    }));

  test('a decided order is unchanged', () => {
    expect(exactOrder(ce.parse('\\pi'), ce.parse('\\sqrt{10}'))).toBe(-1);
    expect(exactOrder(ce.parse('\\ln 3'), ce.One)).toBe(1);
    expect(exactOrder(ce.parse('\\sin 3'), ce.parse('\\cos 3'))).toBe(1);
    expect(exactOrder(ce.parse('e^{\\pi}'), ce.parse('\\pi^e'))).toBe(1);
    expect(evaluate('\\max(\\sqrt2, \\ln 4, \\frac{\\pi}{2})').toString()).toBe(
      '1/2 * pi'
    );
  });
});

//
// A SPECIAL ANGLE IS RECOGNIZED FROM THE STRUCTURE OF THE ARGUMENT
//
// An argument within 10⁻¹² of a special angle was replaced by it, from its
// machine value: `sin(π − 10⁻³⁰)` evaluated to 0. Only an exact rational
// multiple of π is a special angle.
//
describe('A SPECIAL ANGLE IS RECOGNIZED FROM ITS STRUCTURE', () => {
  test('an angle near a special angle keeps its value', () => {
    expect(evaluate('\\sin(\\pi-10^{-30})').operator).toBe('Sin');
    expect(evaluate(['Sin', ['Subtract', 'Pi', TINY]]).operator).toBe('Sin');
    const cos = ce.parse('\\cos(\\frac{\\pi}{2}-10^{-12})');
    expect(cos.evaluate().operator).toBe('Cos');
    expect(cos.N().re / 1e-12).toBeCloseTo(1, 9);
    expect(evaluate('\\arcsin(\\frac12+10^{-30})').operator).toBe('Arcsin');
    expect(evaluate('\\arctan(1+10^{-30})').operator).toBe('Arctan');
    // A float is not an exact angle, and it numericizes.
    const s = evaluate('\\sin(3.14159265358979)');
    expect(s.re).toBeCloseTo(3.23846264338328e-15, 25);
    expect(evaluate('\\arcsin(0.5)').re).toBeCloseTo(0.5235987755982988, 15);
  });

  test('a large value near a pole is not the pole', () => {
    const t = ce.parse('\\tan(\\frac{\\pi}{2}+10^{-15})').N();
    expect(t.re / -1e15).toBeCloseTo(1, 6);
    atHighPrecision((e) => {
      const v = e.parse('\\tan(\\frac{\\pi}{2}+10^{-15})').N();
      expect(v.re / -1e15).toBeCloseTo(1, 12);
      expect(e.parse('\\sin(\\pi-10^{-30})').N().re / 1e-30).toBeCloseTo(1, 12);
    });
  });

  test('exact special angles are unchanged', () => {
    const cases: [string, string][] = [
      ['\\sin(\\frac{\\pi}{6})', '1/2'],
      ['\\cos(-\\frac{2\\pi}{3})', '-1/2'],
      ['\\sin(\\frac{7\\pi}{6})', '-1/2'],
      ['\\tan(\\pi+\\frac{\\pi}{3})', 'sqrt(3)'],
      ['\\sin(\\pi)', '0'],
      ['\\tan(\\frac{\\pi}{2})', '~oo'],
      ['\\arcsin(\\frac12)', '1/6 * pi'],
      ['\\arccos(-\\frac{\\sqrt3}{2})', '5/6 * pi'],
      ['e^{i\\pi/3}', '1/2 + sqrt(3)/2i'],
      ['e^{i\\pi}', '-1'],
    ];
    for (const [input, expected] of cases)
      expect([input, evaluate(input).toString()]).toEqual([input, expected]);
    expect(ce.parse('\\tan(\\frac{\\pi}{2})').N().toString()).toBe('~oo');
  });

  test('the sign of a trigonometric function of a literal', () => {
    // `r` is 4·10⁻³⁶ below π: the machine value cannot decide the sign.
    expect(ce.box(SIN_R).sgn).toBeUndefined();
    // A float 3.2·10⁻¹⁵ below π: the reduction at the working precision
    // (21 digits) decides it, as `evaluate()` does (`3.2e-15`). It is not π,
    // so not 'zero'.
    expect(ce.parse('\\sin(3.14159265358979)').sgn).toBe('positive');
    expect(ce.parse('\\sin(3.14159265358979)').evaluate().isPositive).toBe(
      true
    );
    // A float within the rounding of the working precision of π: undecided.
    expect(ce.parse('\\sin(3.14159265358979323846)').sgn).toBeUndefined();
    expect(ce.parse('\\sin(3.1415)').sgn).toBe('positive');
    expect(ce.parse('\\sin(3.1417)').sgn).toBe('negative');
    expect(ce.parse('\\sin(0)').sgn).toBe('zero');
    // In degrees, a literal is an angle in degrees.
    const e = new ComputeEngine();
    e.angularUnit = 'deg';
    expect(e.parse('\\sin(30)').sgn).toBe('positive');
    expect(e.parse('\\sin(200)').sgn).toBe('negative');
    expect(e.parse('\\cos(90)').sgn).toBe('zero');
    expect(e.parse('\\tan(90)').sgn).toBeUndefined();
  });
});

// `ln x` was signed with the tolerant comparisons of `x` with 1, and
// `1 − 10⁻³⁰` was equal to 1.
describe('THE SIGN OF LN NEAR 1', () => {
  test('ln(1 − 10⁻³⁰) is negative', () => {
    expect(ce.parse('\\ln(1-10^{-30})').sgn).toBe('negative');
    expect(ce.parse('\\ln(1+10^{-30})').sgn).toBe('positive');
    const abs = evaluate('|\\ln(1-10^{-30})|');
    expect(abs.operator).toBe('Negate');
    expect(
      evaluate(['Abs', ['Ln', ['Subtract', 1, ['Power', 10, -30]]]]).operator
    ).toBe('Negate');
    atHighPrecision((e) => {
      const v = e.parse('|\\ln(1-10^{-30})|').evaluate().N();
      expect(v.re / 1e-30).toBeCloseTo(1, 12);
    });
  });
});

describe('THE SQUARE ROOT OF THE SQUARE OF AN ABS', () => {
  test('√(|w|²) is |w|', () => {
    const d = evaluate([
      'Distance',
      ['Tuple', ['Sqrt', ['Subtract', 1, 'Pi']], 0],
      ['Tuple', 0, 0],
    ]);
    expect(d.operator).toBe('Abs');
    expect(d.N().re).toBeCloseTo(Math.sqrt(Math.PI - 1), 12);
  });
});

// A value that could not be ordered against the extremum stayed in the
// result, also when a later extremum is clearly larger than it.
//
// `L2 = ln(√2 − c2)` is 7.3247846210703885·10⁻⁶⁷ (checked at 120 digits):
// neither 21 nor 50 digits decide its order against 0, and `Max`/`Min`
// then make it a tie with 0 within the engine tolerance (`exactOrder`,
// step 3). A tie prefers the literal: `Max(-1, L2, 0)` is `0`, although
// `L2` is larger. This is the documented last resort of the order.
describe('AN UNDECIDED VALUE IS COMPARED WITH A LATER EXTREMUM', () => {
  const L2: MathJsonExpression = [
    'Ln',
    [
      'Subtract',
      ['Sqrt', 2],
      [
        'Divide',
        '414213562373095048801688724209698078569671875376948073176679737990',
        ['Power', 10, 66],
      ],
    ],
  ];
  test('Max and Min', () => {
    expect(exactOrder(ce.box(L2), ce.Zero)).toBeUndefined();
    expect(evaluate(['Max', L, 0, 1]).toString()).toBe('1');
    expect(evaluate(['Max', 0, L, 1]).toString()).toBe('1');
    expect(evaluate(['Min', L, 0, -1]).toString()).toBe('-1');
    expect(evaluate(`\\max(${L_LATEX}, 0, 1)`).toString()).toBe('1');
    expect(evaluate(['Max', L2, 0, 1]).toString()).toBe('1');
    expect(evaluate(['Min', L2, 0, -1]).toString()).toBe('-1');
    expect(evaluate(['Max', 1, L2, 0]).toString()).toBe('1');
    expect(evaluate(['Max', -1, L2, 0]).toString()).toBe('0');
  });
});

// `cmp(0, f)` did not read the sign of `f`, as `cmp(f, 0)` does.
describe('ZERO AGAINST A FUNCTION EXPRESSION', () => {
  test('both operand orders read the sign', () => {
    const e = new ComputeEngine();
    e.assume(e.parse('x > 1'));
    const ln = e.parse('\\ln(x)');
    expect(ln.isGreater(0)).toBe(true);
    expect(e.Zero.isLess(ln)).toBe(true);
    expect(e.number(0).isGreaterEqual(ln)).toBe(false);
  });
});

// Euler's formula `e^{iθ} = cos θ + i·sin θ` is in radians. In another
// angular unit, the angle was read as degrees twice, and `e^{iπ}` evaluated
// to `0.9999995 + 0.00096i` in degrees.
describe('EULER FORM IN EVERY ANGULAR UNIT', () => {
  for (const unit of ['rad', 'deg', 'grad', 'turn'] as const)
    test(unit, () => {
      const e = new ComputeEngine();
      e.angularUnit = unit;
      expect(e.parse('e^{i\\pi}').evaluate().toString()).toBe('-1');
      expect(e.parse('e^{i\\pi/3}').evaluate().toString()).toBe(
        '1/2 + sqrt(3)/2i'
      );
      const v = e.parse('e^{i}').evaluate().N();
      expect(v.re).toBeCloseTo(Math.cos(1), 14);
      expect(v.im).toBeCloseTo(Math.sin(1), 14);
    });
});

// Fixes of the last review round (2026-09-24).
describe('EXACT ORDER: LAST REVIEW ROUND', () => {
  test('an exact value against an inexact literal is ordered exactly', () => {
    const ce = new ComputeEngine();
    // 0.3333333333333333333333 (22 digits) < 1/3
    expect(
      exactOrder(ce.box(['Rational', 1, 3]), ce.parse('0.3333333333333333333333'))
    ).toBe(1);
    // the double 0.33333333333333331483… < 1/3
    expect(exactOrder(ce.box(['Rational', 1, 3]), ce.number(1 / 3))).toBe(1);
    expect(exactOrder(ce.number(1 / 3), ce.box(['Rational', 1, 3]))).toBe(-1);
  });
  test('two different complex values are never a computed tie', () => {
    const ce = new ComputeEngine();
    expect(
      exactOrder(
        ce.parse('i\\pi'),
        ce.parse('i\\cdot 3.14159265358979323846264338327950288')
      )
    ).toBeUndefined();
  });
  test('arsinh near 0 is accurate, so its order is not decided from noise', () => {
    const ce = new ComputeEngine();
    const a = ce.parse('\\operatorname{arsinh}(10^{-10})');
    expect(a.N().re).toBeCloseTo(9.99999999999999999998e-11, 25);
    expect(exactOrder(a, ce.parse('10^{-10}'))).not.toBe(1);
  });
  test('e^{i·0.5·π·…} keeps an exact product factor', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('e^{\\frac{i\\pi}{3}}').evaluate().toString()).toBe(
      '1/2 + sqrt(3)/2i'
    );
    expect(ce.parse('e^{i\\pi}').evaluate().toString()).toBe('-1');
  });
});
