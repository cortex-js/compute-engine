import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { LatexSyntax } from '../../src/latex-syntax';

// A negative integer power of an operand that can be a matrix (the call
// `g(x)` of a function that was not declared, an operand of type `any`, a
// union with a matrix) stays a `Power`: when the value of the operand is a
// matrix, the power is the matrix inverse. It is not made the quotient
// `1/g(x)`, which is the element-wise reciprocal of a matrix. A symbol with
// no declaration is a number, and its negative power is still a quotient.

const ce = new ComputeEngine();
ce.declare('A', 'matrix<2x2>');
ce.declare('M', 'matrix<2x2>');
ce.declare('h', '(any) -> any');
ce.declare('p', 'any');
ce.declare('u', 'number | matrix');
ce.declare('r', 'real');
ce.declare('v', 'vector<3>');

const str = (x: Expression) => x.toString();

// An independent computation of the values of 2×2 matrices
type M = number[][];
const mm = (a: M, b: M): M => [
  [
    a[0][0] * b[0][0] + a[0][1] * b[1][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1],
  ],
  [
    a[1][0] * b[0][0] + a[1][1] * b[1][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1],
  ],
];
const inverse = (a: M): M => {
  const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
  return [
    [a[1][1] / det, -a[0][1] / det],
    [-a[1][0] / det, a[0][0] / det],
  ];
};
const A_VALUE: M = [
  [1, 2],
  [3, 4],
];
const G_VALUE: M = [
  [2, 1],
  [1, 1],
];

/** An engine where `A` and `g(…)` have the matrix values above. */
function engineWithValues(): ComputeEngine {
  const ce2 = new ComputeEngine();
  ce2.assign(
    'A',
    ce2.box(['Matrix', ['List', ...A_VALUE.map((row) => ['List', ...row])]])
  );
  ce2.assign(
    'g',
    ce2.box([
      'Function',
      ['Matrix', ['List', ...G_VALUE.map((row) => ['List', ...row])]],
      'w',
    ])
  );
  ce2.assign('x', 5);
  return ce2;
}

describe('A NEGATIVE POWER OF AN OPERAND THAT CAN BE A MATRIX', () => {
  test.each([
    [
      ['Power', ['g', 'x'], -1],
      ['Power', ['g', 'x'], -1],
    ],
    [
      ['Power', ['h', 'x'], -1],
      ['Power', ['h', 'x'], -1],
    ],
    [
      ['Power', 'p', -1],
      ['Power', 'p', -1],
    ],
    [
      ['Power', 'u', -1],
      ['Power', 'u', -1],
    ],
    // `g(A)` has the type `list<unknown^(2x2)>`: it can be a matrix
    [
      ['Power', ['g', 'A'], -1],
      ['Power', ['g', 'A'], -1],
    ],
    [
      ['Power', ['g', 'x'], -2],
      ['Power', ['g', 'x'], -2],
    ],
  ])('%j stays a power', (input, expected) => {
    const expr = ce.box(input as any);
    expect(expr.json).toEqual(expected);
    expect(expr.evaluate().json).toEqual(expected);
    expect(expr.simplify().json).toEqual(expected);
  });

  test('the parse route gives the same power', () => {
    expect(ce.parse('g(x)^{-1}').json).toEqual(['Power', ['g', 'x'], -1]);
  });

  test('with a matrix value, the power is the matrix inverse', () => {
    const ce2 = engineWithValues();
    const expected = inverse(G_VALUE);
    expect(expected).toEqual([
      [1, -1],
      [-1, 2],
    ]);
    // The canonical form made where `g` has no value, then evaluated where
    // `g(x)` is a matrix
    const symbolic = ce.box(['Power', ['g', 'x'], -1]);
    expect(ce2.box(symbolic.json).evaluate().json).toEqual([
      'List',
      ...expected.map((row) => ['List', ...row]),
    ]);
    // The inverse times the matrix is the identity
    expect(mm(expected, G_VALUE)).toEqual([
      [1, 0],
      [0, 1],
    ]);
    // The quotient `1/g(x)` is the element-wise reciprocal: a different value
    expect(ce2.box(['Divide', 1, ['g', 'x']]).evaluate().json).toEqual([
      'List',
      ['List', ['Rational', 1, 2], 1],
      ['List', 1, 1],
    ]);
  });

  test('a product with a matrix keeps the order of its factors', () => {
    const input = ['Multiply', 'A', ['Power', ['g', 'x'], -1], 'A'];
    const expr = ce.box(input as any);
    expect(str(expr)).toBe('A * g(x)^(-1) * A');
    expect(str(expr.evaluate())).toBe('A * g(x)^(-1) * A');
    expect(str(expr.simplify())).toBe('A * g(x)^(-1) * A');
    expect(str(ce.parse('A g(x)^{-1} A'))).toBe('A * g(x)^(-1) * A');

    const expected = mm(mm(A_VALUE, inverse(G_VALUE)), A_VALUE);
    expect(expected).toEqual([
      [8, 10],
      [14, 18],
    ]);
    const ce2 = engineWithValues();
    expect(ce2.box(expr.evaluate().json).evaluate().json).toEqual([
      'List',
      ...expected.map((row) => ['List', ...row]),
    ]);
  });

  test('a power and its inverse in a product with a matrix do not cancel', () => {
    // `g(x)^{-1}·g(x)` is the identity only when `g(x)` is invertible
    const expr = ce.box([
      'Multiply',
      'A',
      ['Power', ['g', 'x'], -1],
      ['g', 'x'],
      'A',
    ] as any);
    expect(str(expr.evaluate())).toBe('A * g(x)^(-1) * g(x) * A');
  });
});

describe('A NEGATIVE POWER OF ANOTHER OPERAND DOES NOT CHANGE', () => {
  test.each([
    // A symbol with no declaration is a number
    [
      ['Power', 'x', -1],
      ['Divide', 1, 'x'],
    ],
    [
      ['Power', 'r', -1],
      ['Divide', 1, 'r'],
    ],
    [
      ['Power', ['Sin', 'x'], -1],
      ['Divide', 1, ['Sin', 'x']],
    ],
    // A list of numbers has one dimension: its power is element-wise
    [
      ['Power', 'v', -1],
      ['Divide', 1, 'v'],
    ],
    [
      ['Power', ['List', 1, 2, 3], -1],
      ['Divide', 1, ['List', 1, 2, 3]],
    ],
    // A matrix
    [
      ['Power', 'M', -1],
      ['Inverse', 'M'],
    ],
    [
      ['Power', 'M', -2],
      ['MatrixPower', 'M', -2],
    ],
    // A non-integer exponent is element-wise
    [
      ['Power', ['g', 'x'], ['Rational', -1, 2]],
      ['Divide', 1, ['Sqrt', ['g', 'x']]],
    ],
  ])('%j', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
  });

  test('a float exponent stays as it is', () => {
    const expr = ce.box(['Power', ['g', 'x'], { num: '-1.0' }] as any);
    expect(expr.operator).toBe('Power');
  });

  test('the quotient 1/g(x) stays a quotient', () => {
    expect(ce.box(['Divide', 1, ['g', 'x']]).json).toEqual([
      'Divide',
      1,
      ['g', 'x'],
    ]);
    expect(ce.parse('\\frac{1}{g(x)}').json).toEqual(['Divide', 1, ['g', 'x']]);
  });
});

/** The MathJSON of a 2×2 matrix value, as `evaluate()` gives it */
const matrixJson = (m: M) => ['List', ...m.map((row) => ['List', ...row])];
const scale = (k: number, m: M): M => m.map((row) => row.map((x) => k * x));

describe('A PRODUCT KEEPS A NEGATIVE POWER OF AN OPERAND THAT CAN BE A MATRIX', () => {
  // `evaluate()` and `simplify()` of a product do not move the power to a
  // denominator: `2/g(x)` is element-wise when `g(x)` is a matrix
  test.each([
    [['Multiply', 2, ['Power', ['g', 'x'], -1]]],
    [['Multiply', 'y', ['Power', ['g', 'x'], -1]]],
    [['Multiply', 'y', ['Power', ['g', 'x'], -2]]],
  ])('%j', (input) => {
    const expr = ce.box(input as any);
    for (const result of [expr.evaluate(), expr.simplify(), expr.N()]) {
      expect(result.has('Divide')).toBe(false);
      expect(result.json).toEqual(input);
    }
  });

  test('with a matrix value, 2·g(x)^{-1} is twice the inverse', () => {
    const ce2 = engineWithValues();
    const expected = scale(2, inverse(G_VALUE));
    expect(expected).toEqual([
      [2, -2],
      [-2, 4],
    ]);
    const expr = ce.box(['Multiply', 2, ['Power', ['g', 'x'], -1]]);
    for (const symbolic of [expr.evaluate(), expr.simplify()])
      expect(ce2.box(symbolic.json).evaluate().json).toEqual(
        matrixJson(expected)
      );
    // `y·g(x)^{-1}` with `y = 3`
    ce2.assign('y', 3);
    const expr2 = ce.box(['Multiply', 'y', ['Power', ['g', 'x'], -1]]);
    for (const symbolic of [expr2.evaluate(), expr2.simplify()])
      expect(ce2.box(symbolic.json).evaluate().json).toEqual(
        matrixJson(scale(3, inverse(G_VALUE)))
      );
  });
});

describe('THE LATEX OF A NEGATIVE POWER OF AN OPERAND THAT CAN BE A MATRIX', () => {
  // The power is written `g(x)^{-1}`, not `\frac{1}{g(x)}`, which reads
  // back as a quotient (element-wise for a matrix)
  test.each([
    [['Power', ['g', 'x'], -1], 'g(x)^{-1}'],
    [['Multiply', 'y', ['Power', ['g', 'x'], -1]], 'yg(x)^{-1}'],
    [
      ['Multiply', ['Power', ['g', 'x'], 2], ['Power', ['g', 'x'], -1]],
      'g(x)^2g(x)^{-1}',
    ],
    [['Power', ['g', 'x'], -2], 'g(x)^{-2}'],
    [
      ['Multiply', ['Power', ['f', 'x'], -1], ['Power', ['f', 'x'], -1]],
      'f(x)^{-1}f(x)^{-1}',
    ],
  ])('%j', (input, latex) => {
    const expr = ce.box(input as any);
    expect(expr.latex).toBe(latex);
    const back = ce.parse(expr.latex);
    expect(back.json).toEqual(expr.json);
  });

  test('the LaTeX reads back with the same value', () => {
    const ce2 = engineWithValues();
    ce2.assign('y', 3);
    const expr = ce.box(['Multiply', 'y', ['Power', ['g', 'x'], -1]]);
    expect(ce2.parse(expr.latex).evaluate().json).toEqual(
      matrixJson(scale(3, inverse(G_VALUE)))
    );
  });

  test('a scalar negative power is still written as a fraction', () => {
    expect(ce.box(['Power', 'x', -1]).latex).toBe('\\frac{1}{x}');
    expect(ce.box(['Power', 'x', -2]).latex).toBe('\\frac{1}{x^2}');
    expect(ce.box(['Divide', 1, ['g', 'x']]).latex).toBe('\\frac{1}{g(x)}');
  });

  test('a product with every factor in the denominator has the numerator 1', () => {
    expect(
      new LatexSyntax().serialize([
        'Multiply',
        ['Power', 'x', -1],
        ['Power', 'y', -1],
      ])
    ).toBe('\\frac{1}{xy}');
  });
});

describe('A POWER WITH THE EXPONENT 1', () => {
  test('(f(x)^{-1})^{-1} is f(x)', () => {
    const expr = ce.box(['Power', ['Power', ['f', 'x'], -1], -1]);
    expect(expr.json).toEqual(['f', 'x']);
    expect(expr.evaluate().json).toEqual(['f', 'x']);
  });

  test('g(x)^1 is g(x)', () => {
    expect(ce.box(['Power', ['g', 'x'], 1]).json).toEqual(['g', 'x']);
  });

  test('a Power with the exponent 1 evaluates to its base, not a Root', () => {
    const expr = ce._fn('Power', [ce.box(['f', 'x']), ce.One]);
    expect(expr.evaluate().json).toEqual(['f', 'x']);
  });
});

describe('SIMPLIFY COMBINES THE INTEGER POWERS OF AN OPERAND THAT CAN BE A MATRIX', () => {
  // In a product with no matrix, `f(x)` is a scalar, and `simplify()`
  // combines its integer powers as `evaluate()` does, also with exponents
  // of opposite signs
  test.each([
    [
      ['Multiply', ['Power', ['f', 'x'], 2], ['Power', ['f', 'x'], -1]],
      ['f', 'x'],
    ],
    [
      ['Multiply', ['Power', ['f', 'x'], -1], ['Power', ['f', 'x'], -1]],
      ['Power', ['f', 'x'], -2],
    ],
  ])('%j', (input, expected) => {
    const expr = ce.box(input as any);
    expect(expr.simplify().json).toEqual(expected);
    expect(expr.evaluate().json).toEqual(expected);
  });

  test('in a product with a matrix, only exponents of the same sign are combined', () => {
    // `g(x)^{-1}·g(x)^{-1}` is `g(x)^{-2}`, but `g(x)^2·g(x)^{-1}` is `g(x)`
    // only when `g(x)` is invertible: `evaluate()` and `simplify()` keep it
    const same = ce.box([
      'Multiply',
      'A',
      ['Power', ['g', 'x'], -1],
      ['Power', ['g', 'x'], -1],
      'A',
    ] as any);
    expect(str(same.simplify())).toBe('A * g(x)^(-2) * A');
    expect(str(same.evaluate())).toBe('A * g(x)^(-2) * A');
    const opposite = ce.box([
      'Multiply',
      'A',
      ['Power', ['g', 'x'], 2],
      ['Power', ['g', 'x'], -1],
      'A',
    ] as any);
    expect(str(opposite.simplify())).toBe('A * g(x)^2 * g(x)^(-1) * A');
    expect(str(opposite.evaluate())).toBe('A * g(x)^2 * g(x)^(-1) * A');
  });
});
