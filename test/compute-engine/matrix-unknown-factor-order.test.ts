import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// The matrix product is not commutative. In a product that has a matrix, a
// factor whose type does not exclude a matrix (the call `g(x)` of a function
// that was not declared, a symbol declared `any`) can be a matrix too, so it
// keeps its position: `A·g(x)·A` is not `A^2·g(x)`. A factor of a scalar type
// (`real`, `integer`, a symbol with no declaration) still moves to the front,
// and a product with no matrix is sorted as before.

const ce = new ComputeEngine();
ce.declare('A', 'matrix<2x2>');
ce.declare('B', 'matrix<2x2>');
ce.declare('C', 'matrix<2x2>');
ce.declare('h', '(any) -> any');
ce.declare('r', 'real');
ce.declare('n', 'integer');
ce.declare('p', 'any');

const str = (x: Expression) => x.toString();

//
// An independent check of the results: the value of a product of 2×2
// matrices, computed in the order of its factors, with `A`, `B`, the
// symbols `r`, `n`, `w`, `p` and the values of the calls `g(…)`, `k(…)`,
// `h(…)` given below.
//
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
const scalar = (s: number): M => [
  [s, 0],
  [0, s],
];
const power = (a: M, k: number): M => {
  let result = scalar(1);
  for (let i = 0; i < k; i++) result = mm(result, a);
  return result;
};
const SYMBOLS: Record<string, M> = {
  A: [
    [1, 2],
    [3, 4],
  ],
  B: [
    [2, 0],
    [1, 3],
  ],
  C: [
    [1, 1],
    [2, 1],
  ],
  p: [
    [1, 0],
    [2, 1],
  ],
  r: scalar(3),
  n: scalar(2),
  w: scalar(5),
};
const FUNCTIONS: Record<string, M> = {
  g: [
    [0, 1],
    [1, 1],
  ],
  k: [
    [2, 1],
    [1, 0],
  ],
  h: [
    [1, 1],
    [0, 1],
  ],
  // Two values with no zero element, for the element-wise quotients
  q: [
    [1, 2],
    [1, 1],
  ],
  s: [
    [2, 1],
    [1, 3],
  ],
};
// The quotient of two matrices is element-wise
const quotient = (a: M, b: M): M =>
  a.map((row, i) => row.map((x, j) => x / b[i][j]));
function value(e: unknown): M {
  if (typeof e === 'number') return scalar(e);
  if (typeof e === 'string') {
    if (!(e in SYMBOLS)) throw new Error(`No value for ${e}`);
    return SYMBOLS[e];
  }
  const [op, ...args] = e as [string, ...unknown[]];
  if (op === 'Multiply') return args.map(value).reduce(mm, scalar(1));
  if (op === 'MatrixPower' || op === 'Power')
    return power(value(args[0]), args[1] as number);
  if (op === 'Divide') {
    // A number numerator is divided by each element: `1/q(x)`
    const n = args[0];
    const numerator: M =
      typeof n === 'number'
        ? [
            [n, n],
            [n, n],
          ]
        : value(n);
    return quotient(numerator, value(args[1]));
  }
  if (op === 'Add')
    return args
      .map(value)
      .reduce((a, b) => a.map((row, i) => row.map((x, j) => x + b[i][j])));
  if (op in FUNCTIONS) return FUNCTIONS[op];
  throw new Error(`No value for ${JSON.stringify(e)}`);
}

describe('A FACTOR THAT CAN BE A MATRIX KEEPS ITS POSITION', () => {
  const cases: [unknown, string, string][] = [
    // [input, canonical form, value of evaluate() and simplify()]
    [['Multiply', 'A', ['g', 'A'], 'A'], 'A * g(A) * A', 'A * g(A) * A'],
    [
      [
        'Multiply',
        ['MatrixPower', 'A', 2],
        ['g', 'A'],
        ['MatrixPower', 'A', 3],
      ],
      'MatrixPower(A, 2) * g(A) * MatrixPower(A, 3)',
      'MatrixPower(A, 2) * g(A) * MatrixPower(A, 3)',
    ],
    [['Multiply', 'A', ['g', 'x'], 'A'], 'A * g(x) * A', 'A * g(x) * A'],
    [
      ['Multiply', ['g', 'x'], 'A', ['g', 'x']],
      'g(x) * A * g(x)',
      'g(x) * A * g(x)',
    ],
    [['Multiply', ['g', 'A'], 'A'], 'g(A) * A', 'g(A) * A'],
    [['Multiply', 'A', ['g', 'A']], 'A * g(A)', 'A * g(A)'],
    [
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x']],
      'A * g(x) * k(x) * g(x)',
      'A * g(x) * k(x) * g(x)',
    ],
    [
      ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x'], 'A'],
      'g(x) * k(x) * g(x) * A',
      'g(x) * k(x) * g(x) * A',
    ],
    [
      ['Multiply', ['g', 'x'], 'A', ['k', 'x']],
      'g(x) * A * k(x)',
      'g(x) * A * k(x)',
    ],
    [
      ['Multiply', 'A', 'B', ['g', 'A'], 'A'],
      'A * B * g(A) * A',
      'A * B * g(A) * A',
    ],
    [
      ['Multiply', ['Power', ['g', 'x'], 2], 'A', ['Power', ['k', 'x'], 2]],
      'g(x)^2 * A * k(x)^2',
      'g(x)^2 * A * k(x)^2',
    ],
    // A function declared with the result type `any`
    [['Multiply', 'A', ['h', 'x'], 'A'], 'A * h(x) * A', 'A * h(x) * A'],
    // A symbol declared `any` is not inferred to be a number
    [['Multiply', 'A', 'p', 'A'], 'A * p * A', 'A * p * A'],
    // The numbers still move to the front
    [
      ['Multiply', 2, 'A', ['g', 'A'], 3, 'A'],
      '6A * g(A) * A',
      '6A * g(A) * A',
    ],
    // Two adjacent equal factors are combined by evaluate() and simplify()
    [
      ['Multiply', 'A', ['g', 'x'], ['g', 'x'], 'A'],
      'A * g(x) * g(x) * A',
      'A * g(x)^2 * A',
    ],
    // A quotient whose denominator can be a matrix is element-wise. It keeps
    // its position, and its denominator does not move to the denominator of
    // the product.
    [
      ['Multiply', 'A', ['Divide', 1, ['q', 'x']], 'A'],
      'A * 1 / q(x) * A',
      'A * 1 / q(x) * A',
    ],
    [
      ['Multiply', 'A', ['Divide', ['q', 'x'], ['s', 'x']], 'A'],
      'A * q(x) / s(x) * A',
      'A * q(x) / s(x) * A',
    ],
    [
      ['Multiply', ['Divide', 'A', ['q', 'x']], 'A'],
      'A / q(x) * A',
      'A / q(x) * A',
    ],
    [['Multiply', ['Divide', 'A', 'C'], 'A'], 'A / C * A', 'A / C * A'],
    // `1/q(x)` and `q(x)` do not cancel: `1/q(x)` is element-wise
    [
      ['Multiply', 'A', ['Divide', 1, ['q', 'x']], ['q', 'x'], 'A'],
      'A * 1 / q(x) * q(x) * A',
      'A * 1 / q(x) * q(x) * A',
    ],
  ];

  test.each(cases)('%j', (input, canonical, result) => {
    const expr = ce.box(input as any);
    expect(str(expr)).toBe(canonical);
    const evaluated = expr.evaluate();
    const simplified = expr.simplify();
    expect(str(evaluated)).toBe(result);
    expect(str(simplified)).toBe(result);
    // Each result has the value of the product in the written order
    const expected = value(input);
    expect(value(expr.json)).toEqual(expected);
    expect(value(evaluated.json)).toEqual(expected);
    expect(value(simplified.json)).toEqual(expected);
  });

  test('the parse route gives the same products', () => {
    expect(str(ce.parse('A g(A) A'))).toBe('A * g(A) * A');
    expect(str(ce.parse('A g(A) A').evaluate())).toBe('A * g(A) * A');
    expect(str(ce.parse('A g(x) A').simplify())).toBe('A * g(x) * A');
    expect(str(ce.parse('A^2 g(A) A^3').evaluate())).toBe(
      'MatrixPower(A, 2) * g(A) * MatrixPower(A, 3)'
    );
  });

  test('the ce.function route gives the same products', () => {
    const expr = ce.function('Multiply', [
      ce.symbol('A'),
      ce.box(['g', 'A']),
      ce.symbol('A'),
    ]);
    expect(str(expr)).toBe('A * g(A) * A');
    expect(str(expr.evaluate())).toBe('A * g(A) * A');
  });

  test('a quotient by a factor that can be a matrix does not cancel it', () => {
    // The quotient is element-wise: `(A·q(x))/q(x)` is not `A`
    const input = ['Divide', ['Multiply', 'A', ['q', 'x']], ['q', 'x']];
    const result = ce.box(input as any).evaluate();
    expect(str(result)).toBe('(A * q(x)) / q(x)');
    expect(value(result.json)).toEqual(value(input));
    expect(value(input)).not.toEqual(value('A'));
  });

  test('Expand keeps the order of each distributed product', () => {
    // `Expand` distributes the sum of matrices. The factors after the sum
    // (`g(x)·k(x)·g(x)`) are not multiplied before the matrices are seen,
    // and each term of the sum keeps its order.
    const product = [
      'Multiply',
      'A',
      ['Add', 'B', 'C'],
      ['g', 'x'],
      ['k', 'x'],
      ['g', 'x'],
    ];
    const result = ce.box(['Expand', product] as any).evaluate();
    expect(str(result)).toBe(
      'A * B * g(x) * k(x) * g(x) + A * C * g(x) * k(x) * g(x)'
    );
    expect(
      str(
        ce
          .box([
            'Expand',
            ['Multiply', ['Add', 'B', 'C'], ['g', 'x'], ['k', 'x'], ['g', 'x']],
          ] as any)
          .evaluate()
      )
    ).toBe('B * g(x) * k(x) * g(x) + C * g(x) * k(x) * g(x)');
  });

  test('Expand does not distribute a product with a matrix over a sum with a scalar term', () => {
    // The sum of a matrix and a scalar adds the scalar to each element
    // (`[[1, 2], [3, 4]] + 3` is `[[4, 5], [6, 7]]`), so `A·(B + r)` is not
    // `A·B + r·A`. A term that can be a matrix (`g(x)`) can also be a scalar.
    for (const [input, expected] of [
      [['Multiply', 'A', ['Add', 'B', 'r']], 'A * (B + r)'],
      [
        ['Multiply', ['Add', 'B', 'r'], ['g', 'x'], ['k', 'x'], ['g', 'x']],
        '(B + r) * g(x) * k(x) * g(x)',
      ],
      [
        [
          'Multiply',
          'A',
          ['Add', 'B', 'r'],
          ['g', 'x'],
          ['k', 'x'],
          ['g', 'x'],
        ],
        'A * (B + r) * g(x) * k(x) * g(x)',
      ],
      [['Multiply', 'A', ['Add', ['g', 'x'], 1]], 'A * (g(x) + 1)'],
    ] as [unknown, string][]) {
      expect(str(ce.box(['Expand', input] as any).evaluate())).toBe(expected);
    }
    // A scalar factor is distributed over such a sum, and a sum of scalars
    // over a matrix
    expect(
      str(ce.box(['Expand', ['Multiply', 2, ['Add', 'B', 'r']]]).evaluate())
    ).toBe('2B + 2r');
    expect(
      str(
        ce
          .box([
            'Expand',
            ['Multiply', 'A', ['Add', 'x', 1], ['g', 'x'], ['k', 'x']],
          ])
          .evaluate()
      )
    ).toBe('x * A * g(x) * k(x) + A * g(x) * k(x)');
  });

  test('Expand of a product with a matrix combines the like terms after each sum', () => {
    // The product of 18 sums has 19 terms after the like terms are
    // combined. The terms are combined after each sum: the 2^18 products of
    // one term of each sum are not made (that took about 7 seconds).
    const sums = Array.from({ length: 18 }, (_, i) => ['Add', 'x', i + 1]);
    const result = ce
      .box(['Expand', ['Multiply', 'A', ['g', 'u'], ...sums]] as any)
      .evaluate();
    expect(result.operator).toBe('Add');
    expect(result.nops).toBe(19);
  });

  test('Expand of a product with no matrix does not change', () => {
    expect(
      str(
        ce
          .box([
            'Expand',
            ['Multiply', ['Add', 'x', 1], ['Add', 'y', 2], ['g', 'x']],
          ])
          .evaluate()
      )
    ).toBe('x * y * g(x) + 2x * g(x) + y * g(x) + 2g(x)');
    expect(
      str(
        ce
          .box([
            'Expand',
            ['Multiply', ['Add', 'x', 1], ['g', 'x'], ['k', 'x'], ['g', 'x']],
          ])
          .evaluate()
      )
    ).toBe('x * k(x) * g(x)^2 + k(x) * g(x)^2');
  });

  // A nested product that is not canonical yet is spliced into the outer
  // product before its operands are made canonical, so the outer product
  // sorts all the factors at once: `A·(g(x)·k(x)·g(x))` keeps the order
  // `A·g(x)·k(x)·g(x)`, like the flat product. See
  // `flattenRawProductOperands()` in
  // `src/compute-engine/boxed-expression/canonical-numeric.ts`.
  test.each([
    [
      ['Multiply', 'A', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]],
      'A * g(x) * k(x) * g(x)',
    ],
    [
      ['Multiply', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']], 'A'],
      'g(x) * k(x) * g(x) * A',
    ],
    [
      [
        'Multiply',
        'A',
        ['Multiply', ['g', 'x'], ['Multiply', ['k', 'x'], ['g', 'x']]],
      ],
      'A * g(x) * k(x) * g(x)',
    ],
    [
      [
        'Multiply',
        ['Multiply', 'A', ['g', 'x']],
        ['Multiply', ['k', 'x'], 'A'],
      ],
      'A * g(x) * k(x) * A',
    ],
    // A nested product in parentheses
    [
      [
        'Multiply',
        'A',
        ['Delimiter', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]],
      ],
      'A * g(x) * k(x) * g(x)',
    ],
  ])(
    'a nested product with no matrix keeps its order in a product with a matrix: %j',
    (input, expected) => {
      const expr = ce.box(input as any);
      expect(str(expr)).toBe(expected);
      expect(str(expr.evaluate())).toBe(expected);
      expect(str(expr.simplify())).toBe(expected);
      // Each result has the value of the product in the written order. The
      // parentheses do not change the value.
      const written = JSON.parse(
        JSON.stringify(input).replace(/\["Delimiter",(.*)\]\]$/, '$1]')
      );
      const expected_ = value(written);
      expect(value(expr.json)).toEqual(expected_);
      expect(value(expr.evaluate().json)).toEqual(expected_);
      expect(value(expr.simplify().json)).toEqual(expected_);
    }
  );

  test('the parse route keeps the order of a nested product', () => {
    expect(str(ce.parse('A\\cdot(g(x)\\cdot k(x)\\cdot g(x))'))).toBe(
      'A * g(x) * k(x) * g(x)'
    );
  });

  // A juxtaposition in parentheses is read first (a product, a mixed number,
  // a function application…). When it is a product, its factors are put in
  // the outer product in their written order, before the outer product
  // sorts them. See `juxtaposedFactors()` in
  // `src/compute-engine/boxed-expression/invisible-operator.ts`.
  test.each([
    [
      'A(g(x)k(x)g(x))',
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x']],
      'A * g(x) * k(x) * g(x)',
    ],
    [
      'A\\left(g(x)k(x)g(x)\\right)',
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x']],
      'A * g(x) * k(x) * g(x)',
    ],
    [
      'A(g(x)k(x)g(x))A',
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x'], 'A'],
      'A * g(x) * k(x) * g(x) * A',
    ],
    [
      '(g(x)k(x)g(x))A',
      ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x'], 'A'],
      'g(x) * k(x) * g(x) * A',
    ],
    [
      'A(g(x)(k(x)g(x)))',
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x']],
      'A * g(x) * k(x) * g(x)',
    ],
    [
      'A\\cdot(g(x)k(x)g(x))',
      ['Multiply', 'A', ['g', 'x'], ['k', 'x'], ['g', 'x']],
      'A * g(x) * k(x) * g(x)',
    ],
  ])(
    'a juxtaposition in parentheses keeps its order in a product with a matrix: %s',
    (latex, written, expected) => {
      const expr = ce.parse(latex);
      expect(str(expr)).toBe(expected);
      expect(str(expr.evaluate())).toBe(expected);
      expect(value(expr.json)).toEqual(value(written));
      expect(value(expr.evaluate().json)).toEqual(value(written));
    }
  );

  test('a juxtaposition in parentheses that is not a product with a matrix does not change', () => {
    // A product with no matrix has the canonical form of the juxtaposition
    // written with no parentheses
    for (const [nested, flat] of [
      ['2(3x)', '6x'],
      ['x(yz)', 'xyz'],
      ['(xy)(zw)', 'xyzw'],
      ['2(g(x)k(x)g(x))', '2g(x)k(x)g(x)'],
    ])
      expect(str(ce.parse(nested))).toBe(str(ce.parse(flat)));
    // A mixed number, an imaginary number and a function application are
    // read as before
    expect(str(ce.parse('A(2\\frac{1}{3})'))).toBe('A * (2 + 1/3)');
    expect(str(ce.parse('A(2i)'))).toBe('2i * A');
    expect(str(ce.parse('A\\cdot(2\\frac{1}{3})'))).toBe('A * (2 + 1/3)');
    // `y` is not used in this engine before, so `y(…)` is an application
    const fresh = new ComputeEngine();
    expect(str(fresh.parse('y(g(x)k(x)g(x))'))).toBe('y(k(x) * g(x) * g(x))');
  });

  test('a nested product with no matrix in a product with no matrix does not change', () => {
    // The raw nested product gives the same canonical form as the nested
    // product made canonical first (`ce.function()` with a canonical
    // operand), which is how it was made before the splice
    for (const [outer, inner] of [
      ['y', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]],
      [2, ['Multiply', 3, 'x']],
      ['x', ['Multiply', 'x', ['Power', 'x', -1]]],
      ['y', ['Multiply', ['Sqrt', 2], ['Sqrt', 3], 'y']],
      [
        ['Sin', 'x'],
        ['Multiply', -1, ['Cos', 'x'], ['Sin', 'x']],
      ],
    ] as [unknown, unknown][]) {
      const nested = ce.box(['Multiply', outer, inner] as any);
      const twoSteps = ce.function('Multiply', [
        ce.box(outer as any),
        ce.box(inner as any),
      ]);
      expect(str(nested)).toBe(str(twoSteps));
      expect(nested.isSame(twoSteps)).toBe(true);
    }
  });

  test('a product with an ellipsis is not spliced', () => {
    // `2·4·…·2n`: the nested product `2n` is the last term of the pattern.
    // The result is the same as when each operand is made canonical first.
    const first = ['Multiply', ['Multiply', 2, 4], 'ContinuationPlaceholder'];
    const last = ['Multiply', 2, 'n'];
    const expr = ce.box(['Multiply', first, last] as any);
    const twoSteps = ce.function('Multiply', [
      ce.box(first as any),
      ce.box(last as any),
    ]);
    expect(str(expr)).toBe(str(twoSteps));
  });

  test('with values for A and g, the result is the product in the written order', () => {
    // `g(x)` with a scalar `x` is the matrix value of `g`, not a matrix
    // made by applying `g` to each element.
    const ce2 = new ComputeEngine();
    ce2.assign(
      'A',
      ce2.box(['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]])
    );
    ce2.assign(
      'g',
      ce2.box([
        'Function',
        ['Matrix', ['List', ['List', 0, 1], ['List', 1, 1]]],
        'u',
      ])
    );
    ce2.assign('x', 5);
    for (const input of [
      ['Multiply', 'A', ['g', 'x'], 'A'],
      ['Multiply', ['g', 'x'], 'A', ['g', 'x']],
    ]) {
      const symbolic = ce.box(input as any).evaluate();
      expect(ce2.box(symbolic.json).evaluate().json).toEqual([
        'List',
        ...value(input).map((row) => ['List', ...row]),
      ]);
    }
  });
});

describe('A FACTOR OF A SCALAR TYPE STILL MOVES', () => {
  test.each([
    [['Multiply', 'A', 'r', 'A'], 'r * MatrixPower(A, 2)'],
    [['Multiply', 'A', 'n', 'B', 'r'], 'n * r * A * B'],
    // A symbol with no declaration is a number
    [['Multiply', 'A', 'w', 'A'], 'w * MatrixPower(A, 2)'],
    [['Multiply', 'A', ['Sin', 'x'], 'A'], 'sin(x) * MatrixPower(A, 2)'],
  ])('%j', (input, expected) => {
    const result = ce.box(input as any).evaluate();
    expect(str(result)).toBe(expected);
  });

  test('the parse route treats a symbol with no declaration as a number', () => {
    // `ce.parse()` does not infer the type `number` for `v`, but the
    // product is the same as on the box route
    expect(str(ce.parse('A v A').evaluate())).toBe('v * MatrixPower(A, 2)');
    expect(str(ce.parse('A^2 v B^2'))).toBe(
      'v * MatrixPower(A, 2) * MatrixPower(B, 2)'
    );
  });
});

describe('A PRODUCT WITH NO MATRIX DOES NOT CHANGE', () => {
  test.each([
    [['Multiply', ['g', 'x'], 'y', ['g', 'x']], 'y * g(x)^2'],
    [['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']], 'k(x) * g(x)^2'],
    [['Multiply', 'y', ['g', 'x']], 'y * g(x)'],
    [
      ['Multiply', ['Power', ['g', 'x'], 2], 'y', ['Power', ['k', 'x'], 2]],
      'y * k(x)^2 * g(x)^2',
    ],
  ])('%j', (input, expected) => {
    expect(str(ce.box(input as any).evaluate())).toBe(expected);
  });
});

describe('A FLOAT POWER OF A FACTOR THAT CAN BE A MATRIX', () => {
  // A float exponent is element-wise for a matrix, so `h(x)^{2.0}·h(x)` is not
  // `h(x)^3`: simplify() keeps the two factors apart.
  test('simplify() does not combine h(x)^{2.0} with h(x)', () => {
    const expr = ce.box([
      'Multiply',
      'A',
      ['Power', ['h', 'x'], { num: '2.0' }],
      ['h', 'x'],
    ] as any);
    const result = expr.simplify();
    expect(result.has('Power')).toBe(true);
    expect(str(result)).not.toContain('^3');
  });
});

describe('NESTED PRODUCTS: TIME, REPLACED DEFINITIONS, NEGATION, INVALID OPERANDS', () => {
  test('each level of a nested juxtaposition is made canonical once', () => {
    // Making each level canonical twice took a time exponential in the
    // depth (5.7 s for 16 levels)
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'real');
    ce2.declare('b', 'real');
    ce2.declare('A', 'matrix<2x2>');
    const nest = (inner: string, wrap: (s: string) => string) => {
      let latex = inner;
      for (let i = 0; i < 16; i++) latex = wrap(latex);
      return latex;
    };
    for (const latex of [
      nest('x y', (s) => `y (${s})`),
      nest('a b', (s) => `a(b ${s})`),
      nest('g(x) A', (s) => `A(g(x) ${s})`),
      nest('g(x) A', (s) => `(g(x) ${s}) A`),
    ]) {
      const start = Date.now();
      const expr = ce2.parse(latex);
      expect(Date.now() - start).toBeLessThan(100);
      expect(expr.isValid).toBe(true);
    }
  });

  test('a replaced definition of InvisibleOperator is used', () => {
    // The juxtaposition is not read by the library rule when the host
    // replaces the definition of `InvisibleOperator`
    const ce2 = new ComputeEngine();
    ce2.declare('InvisibleOperator', {
      signature: '(number, number) -> number',
      evaluate: (ops) => ops[0].add(ops[1]),
    });
    const expr = ce2.box(['Multiply', 7, ['InvisibleOperator', 2, 3]]);
    expect(expr.evaluate().json).toBe(35);
  });

  test('a negation or a quotient by an integer of a nested product is spliced', () => {
    expect(
      str(
        ce.box([
          'Multiply',
          'A',
          ['Negate', ['Multiply', ['g', 'x'], ['k', 'x']]],
        ])
      )
    ).toBe('-(A * g(x) * k(x))');
    expect(str(ce.parse('A\\cdot(-g(x)k(x))'))).toBe('-(A * g(x) * k(x))');
    expect(
      str(
        ce.box([
          'Multiply',
          'A',
          ['Divide', ['Multiply', ['g', 'x'], ['k', 'x']], 2],
        ])
      )
    ).toBe('1/2 * A * g(x) * k(x)');
  });

  test('a product with no factor that can be a matrix is not spliced', () => {
    // A product with an invalid operand is not sorted: the nested product
    // keeps its own canonical form
    const ce2 = new ComputeEngine();
    ce2.declare('f', 'function');
    const expr = ce2.parse('f\\cdot(b a)');
    expect(expr.isValid).toBe(false);
    expect((expr.json as any[]).slice(2)).toEqual(['a', 'b']);
    expect(str(ce2.parse('\\sum_{i=1}^3 x\\cdot(n i)'))).toBe(
      'sum_(i=1)^(3)(i * n * x)'
    );
  });
});
