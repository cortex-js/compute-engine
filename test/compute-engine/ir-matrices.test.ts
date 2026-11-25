import { ComputeEngine, compile } from '../../src/compute-engine';

// The matrix operators of the IR compiler (CE-1529; `ir/lower-matrices.ts`,
// README "Matrices"): each compiled value is the interpreter's numeric value
// (`evaluate().N()`) at the same inputs, and a shape that the compiler cannot
// settle declines.

type Value = number | Value[];

const DECLARED: Record<string, string> = {
  A: 'matrix<real^2x2>',
  B: 'matrix<real^2x3>',
  C: 'matrix<real^3x3>',
  E: 'matrix<real^4x4>',
  S: 'matrix<real^1x1>',
  P: 'list<list<real^2>>',
  M: 'list<list<real>>',
  L: 'list<real>',
  U: 'list<real^3>',
  V: 'tuple<real, real, real>',
  W: 'tuple<real, real, real>',
  n: 'integer',
  x: 'real',
};

const toJson = (v: Value): any =>
  Array.isArray(v) ? ['List', ...v.map(toJson)] : v;

/** The interpreter's value of `json` at `inputs`, as numbers and arrays
 *  (an unevaluated or failed value is `undefined`). */
function interpreted(json: any, inputs: Record<string, Value>): unknown {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(DECLARED)) ce.declare(k, t);
  for (const [k, v] of Object.entries(inputs)) ce.assign(k, ce.box(toJson(v)));
  const r = ce.box(json).evaluate().N();
  const read = (e: any): unknown => {
    if (e.operator === 'List' || e.operator === 'Tuple') {
      const xs = e.ops.map(read);
      return xs.some((x: unknown) => x === undefined) ? undefined : xs;
    }
    return e.isNumberLiteral ? e.re : undefined;
  };
  return read(r);
}

/** The compilation of `json`; a decline (thrown with `fallback: false`) is
 *  `{ success: false, message }`. */
function compiled(json: any, to = 'javascript') {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(DECLARED)) ce.declare(k, t);
  try {
    return compile(
      ce.box(json) as any,
      {
        to,
        inputs: DECLARED,
        fallback: false,
      } as any
    ) as any;
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

/** `a` and `b` agree within 1e-12, relative above 1 (`NaN` agrees with
 *  `NaN`). */
function close(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (Number.isNaN(a) || Number.isNaN(b))
    return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
}

function expectInterpreterValue(json: any, inputs: Record<string, Value>) {
  const r = compiled(json);
  expect(r.success).toBe(true);
  const value = r.run(inputs);
  const expected = interpreted(json, inputs);
  expect(expected).toBeDefined();
  if (!close(value, expected))
    throw new Error(
      `${JSON.stringify(json)} at ${JSON.stringify(inputs)}: compiled ${JSON.stringify(value)}, interpreter ${JSON.stringify(expected)}`
    );
}

/** A matrix of `NaN` of `r` rows of `c` columns. */
const nan = (r: number, c: number) =>
  Array.from({ length: r }, () => new Array(c).fill(NaN));

const A1 = [
  [1, 2],
  [3, 4],
];
const A2 = [
  [0.5, -1.25],
  [2, 3.5],
];
const B1 = [
  [1, 2, 3],
  [4, 5, 6],
];
const B2 = [
  [0.1, -2, 3.5],
  [4, 0, 6.25],
];
const C1 = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 10],
];
const C2 = [
  [0, 2, -1],
  [3, 0.5, 4],
  [-2, 1, 0],
];
const E1 = [
  [2, 1, 0, 3],
  [1, 5, 2, 0],
  [0, 2, 7, 1],
  [4, 0, 1, 6],
];
const E2 = [
  [0, 1, 2, 3],
  [1, 0, 4, 1],
  [2, 3, 0, 5],
  [1, 1, 1, 0],
];
const P1 = [
  [1, 2],
  [3, 4],
  [5, 6],
];

describe('MATRIX OPERATORS: THE INTERPRETER VALUE ON JAVASCRIPT', () => {
  const CASES: Array<[string, any, Record<string, Value>[]]> = [
    ['Matrix', ['Matrix', 'B'], [{ B: B1 }]],
    ['Vector', ['Vector', 'x', 2, 3], [{ x: 0.5 }]],
    ['Transpose', ['Transpose', 'B'], [{ B: B1 }, { B: B2 }]],
    ['Transpose of a vector', ['Transpose', 'L'], [{ L: [1, 2, 3] }]],
    ['ConjugateTranspose', ['ConjugateTranspose', 'B'], [{ B: B2 }]],
    ['Trace', ['Trace', 'C'], [{ C: C1 }, { C: C2 }]],
    ['Trace 1x1', ['Trace', 'S'], [{ S: [[-2.5]] }]],
    ['Diagonal of a matrix', ['Diagonal', 'B'], [{ B: B1 }, { B: B2 }]],
    ['Diagonal of rows of run-time count', ['Diagonal', 'P'], [{ P: P1 }]],
    ['Diagonal of a vector', ['Diagonal', 'U'], [{ U: [1.5, -2, 3] }]],
    ['Determinant 1x1', ['Determinant', 'S'], [{ S: [[3.5]] }]],
    ['Determinant 2x2', ['Determinant', 'A'], [{ A: A1 }, { A: A2 }]],
    ['Determinant 3x3', ['Determinant', 'C'], [{ C: C1 }, { C: C2 }]],
    ['Determinant 4x4', ['Determinant', 'E'], [{ E: E1 }, { E: E2 }]],
    [
      'Determinant, singular',
      ['Determinant', 'C'],
      [
        {
          C: [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
          ],
        },
      ],
    ],
    ['Inverse 1x1', ['Inverse', 'S'], [{ S: [[4]] }]],
    ['Inverse 2x2', ['Inverse', 'A'], [{ A: A1 }, { A: A2 }]],
    ['Inverse 3x3', ['Inverse', 'C'], [{ C: C1 }, { C: C2 }]],
    ['Inverse 4x4', ['Inverse', 'E'], [{ E: E1 }, { E: E2 }]],
    ['MatrixPower', ['MatrixPower', 'A', 3], [{ A: A1 }, { A: A2 }]],
    ['MatrixPower, negative', ['MatrixPower', 'C', -2], [{ C: C1 }]],
    [
      'MatrixPower, run-time exponent',
      ['MatrixPower', 'A', 'n'],
      [
        { A: A1, n: 0 },
        { A: A1, n: 1 },
        { A: A2, n: 5 },
        { A: A2, n: -1 },
      ],
    ],
    ['Power of a matrix', ['Power', 'A', 2], [{ A: A1 }]],
    [
      'MatrixMultiply matrix·matrix',
      ['MatrixMultiply', 'A', 'B'],
      [
        { A: A1, B: B1 },
        { A: A2, B: B2 },
      ],
    ],
    [
      'MatrixMultiply, rows of run-time count',
      ['MatrixMultiply', 'P', 'B'],
      [{ P: P1, B: B1 }],
    ],
    [
      'MatrixMultiply matrix·vector',
      ['MatrixMultiply', 'B', 'U'],
      [{ B: B2, U: [1, -2, 0.5] }],
    ],
    [
      'MatrixMultiply vector·matrix',
      ['MatrixMultiply', 'U', 'C'],
      [{ U: [1, 2, 3], C: C2 }],
    ],
    [
      'MatrixMultiply vector·vector',
      ['MatrixMultiply', 'L', 'L'],
      [{ L: [1, 2, 3] }],
    ],
    ['RowReduce', ['RowReduce', 'B'], [{ B: B1 }, { B: B2 }]],
    [
      'RowReduce, rank deficient',
      ['RowReduce', 'P'],
      [
        {
          P: [
            [1, 2],
            [2, 4],
            [5, 6],
          ],
        },
        {
          P: [
            [1, 2],
            [3, 6.000000000001],
          ],
        },
      ],
    ],
    ['RowReduce, square', ['RowReduce', 'C'], [{ C: C2 }]],
    ['Rank', ['Rank', 'B'], [{ B: B1 }]],
    ['Rank of a vector', ['Rank', 'L'], [{ L: [1, 2] }, { L: [] }]],
    ['Shape of a vector', ['Shape', 'L'], [{ L: [1, 2] }, { L: [] }]],
    ['Rank of a scalar', ['Rank', 'x'], [{ x: 2 }]],
    ['Shape', ['Shape', 'B'], [{ B: B1 }]],
    ['Flatten', ['Flatten', 'B'], [{ B: B2 }]],
    ['Flatten, rows of run-time count', ['Flatten', 'P'], [{ P: P1 }]],
    ['Flatten of a vector', ['Flatten', 'L'], [{ L: [1, 2] }]],
    ['Flatten to depth 1', ['Flatten', 'B', 1], [{ B: B2 }]],
    ['Flatten to depth 0', ['Flatten', 'B', 0], [{ B: B2 }]],
    ['Flatten to a depth past the nesting', ['Flatten', 'B', 5], [{ B: B1 }]],
    [
      'Flatten to an infinite depth',
      ['Flatten', 'B', { num: '+Infinity' }],
      [{ B: B1 }],
    ],
    [
      'Flatten of rows of run-time count to depth 1',
      ['Flatten', 'P', 1],
      [{ P: P1 }, { P: [[7, 8]] }],
    ],
    [
      'Flatten to depth 0, rows of run-time count',
      ['Flatten', 'P', 0],
      [{ P: P1 }],
    ],
    [
      'Flatten of a vector to depth 1',
      ['Flatten', 'L', 1],
      [{ L: [1, 2] }, { L: [] }],
    ],
    ['Flatten of a vector to depth 0', ['Flatten', 'L', 0], [{ L: [1, 2] }]],
    ['Flatten of a scalar to depth 1', ['Flatten', 'x', 1], [{ x: 2 }]],
    [
      'Flatten of a map of pairs to depth 1',
      [
        'Flatten',
        ['Map', ['Function', ['List', 'i', 'i'], 'i'], ['Range', 1, 'n']],
        1,
      ],
      [{ n: 1 }, { n: 3 }],
    ],
    [
      'Reshape to a row',
      ['Reshape', 'L', ['Tuple', 1, 5]],
      [{ L: [1.5, 2, 3, 4.5, 2] }],
    ],
    [
      'Reshape, cycling',
      ['Reshape', 'L', ['Tuple', 2, 2, 2]],
      [{ L: [1, 2, 3] }],
    ],
    ['Reshape of a matrix', ['Reshape', 'B', ['Tuple', 3, 2]], [{ B: B2 }]],
    [
      'Cross of lists',
      ['Cross', 'U', ['List', 'x', 2, 1]],
      [{ U: [1, 2, 3], x: 0.5 }],
    ],
    ['Cross of a vector with itself', ['Cross', 'U', 'U'], [{ U: [1, 2, 3] }]],
  ];
  for (const [name, json, points] of CASES)
    it(name, () => {
      for (const inputs of points) expectInterpreterValue(json, inputs);
    });

  it('Cross of two tuples', () => {
    const r = compiled(['Cross', 'V', 'W']);
    expect(r.success).toBe(true);
    expect(r.run({ V: [1, 2, 3], W: [3, 2, 1] })).toEqual([-4, 8, -4]);
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Cross', ['Tuple', 1, 2, 3], ['Tuple', 3, 2, 1]])
        .evaluate()
        .toString()
    ).toBe('(-4, 8, -4)');
  });

  // Where the interpreter leaves the operator unevaluated, the compiled
  // value is a matrix of NaN of the shape of the result.
  it('Inverse and a negative MatrixPower of a singular matrix are NaN', () => {
    const singular = [
      [1, 2],
      [2, 4],
    ];
    expect(compiled(['Inverse', 'A']).run({ A: singular })).toEqual(nan(2, 2));
    expect(compiled(['MatrixPower', 'A', -1]).run({ A: singular })).toEqual(
      nan(2, 2)
    );
    const E = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ];
    expect(compiled(['Inverse', 'E']).run({ E })).toEqual(nan(4, 4));
    // An exponent past `MAX_MATRIX_POWER_EXPONENT`: a computed one is NaN,
    // a literal one declines.
    expect(
      compiled(['MatrixPower', 'A', 'n']).run({ A: singular, n: 2000000 })
    ).toEqual(nan(2, 2));
    expect(compiled(['MatrixPower', 'A', 2000000]).message).toMatch(
      /past the cap/
    );
    const ce = new ComputeEngine();
    expect(ce.box(['Inverse', toJson(singular)]).evaluate().operator).toBe(
      'Inverse'
    );
  });

  // Exactly singular integer matrices whose elimination in doubles leaves a
  // rounding residue in place of a zero pivot: NaN, where the interpreter
  // leaves `Inverse` unevaluated, with `evaluate()` and with `.N()`
  // (`numberMatrixInverse()` of `numerics/linear-algebra.ts`, CE-1542).
  it('Inverse of a singular matrix with a rounding residue is NaN', () => {
    const SINGULAR: Array<[string, number[][]]> = [
      [
        'C',
        [
          [3, 2, 1],
          [1, 1, 1],
          [4, 3, 2],
        ],
      ],
      [
        'C',
        [
          [-5, -4, 4],
          [3, 2, 6],
          [-24, -22, 78],
        ],
      ],
      [
        'C',
        [
          [3, 4, -6],
          [-7, -9, -2],
          [61, 79, -10],
        ],
      ],
      [
        'E',
        [
          [-5, 7, -8, 0],
          [-8, -7, 8, 0],
          [-4, -9, 7, 8],
          [11, -70, 80, 0],
        ],
      ],
      [
        'E',
        [
          [-5, 8, -2, 5],
          [-2, 3, 0, -7],
          [-5, 6, 8, 3],
          [37, -59, 14, -28],
        ],
      ],
    ];
    for (const [name, m] of SINGULAR) {
      const ce = new ComputeEngine();
      expect(ce.box(['Inverse', toJson(m)]).evaluate().operator).toBe(
        'Inverse'
      );
      expect(ce.box(['Inverse', toJson(m)]).N().operator).toBe('Inverse');
      expect(ce.box(['PseudoInverse', toJson(m)]).N().operator).toBe(
        'PseudoInverse'
      );
      // Entries such as 1.5 are machine numbers: `evaluate()` takes the
      // numeric kernel too.
      const halves = m.map((row) => row.map((x) => x * 0.5));
      expect(ce.box(['Inverse', toJson(halves)]).evaluate().operator).toBe(
        'Inverse'
      );
      const n = m.length;
      expect(compiled(['Inverse', name]).run({ [name]: m })).toEqual(nan(n, n));
      expect(compiled(['MatrixPower', name, -2]).run({ [name]: m })).toEqual(
        nan(n, n)
      );
    }
  });

  // A name that holds a dimension of `Reshape` is a capture of the program:
  // a host that invalidates on `symbolDeps` compiles again when it changes.
  it('a dimension of Reshape held by a name is in symbolDeps', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.declare('d', 'integer');
    ce.assign('d', 2);
    const symbolDeps = new Set<string>();
    const r = compile(
      ce.box(['Reshape', 'L', ['Tuple', 'd', 2]]) as any,
      {
        to: 'javascript',
        inputs: { L: 'list<real>' },
        fallback: false,
        symbolDeps,
      } as any
    ) as any;
    expect(r.run({ L: [1, 2, 3] })).toEqual([
      [1, 2],
      [3, 1],
    ]);
    expect([...symbolDeps]).toContain('d');
  });

  it('a closed matrix expression is the interpreter value', () => {
    const r = compiled([
      'Determinant',
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ]);
    expect(r.success).toBe(true);
    expect(r.run({})).toBe(-2);
  });
});

describe('MATRIX OPERATORS: DECLINES', () => {
  const DECLINES: Array<[any, RegExp]> = [
    // The rows of a `list<list<real>>` can have two lengths: the input is
    // read only by an element read `M[i][j]` (`docs/COMPILATION-MODEL.md`).
    [['Determinant', 'M'], /M of type list<list<real>> other than in an element read/],
    [['Transpose', 'M'], /M of type list<list<real>> other than in an element read/],
    // A matrix that is not square, or whose number of rows is known at run
    // time only.
    [['Trace', 'B'], /not square/],
    [['Determinant', 'B'], /not square/],
    [['Inverse', 'P'], /known at run time only/],
    [['MatrixPower', 'P', 2], /known at run time only/],
    // The transpose of `P` has rows of run-time length.
    [['Transpose', 'P'], /known at run time only/],
    [['Diagonal', 'L'], /run-time length/],
    // The interpreter gives a root of the matrix for a half-integer exponent.
    [['MatrixPower', 'A', 'x'], /not an integer/],
    // Two inner lengths: `incompatible-dimensions` in the interpreter.
    [['MatrixMultiply', 'B', 'A'], /two inner lengths/],
    [['Reshape', 'L', ['Tuple', 'n', 2]], /constant positive integers/],
    [['Cross', 'U', 'V'], /a tuple and a list/],
    [['Cross', 'L', 'L'], /two vectors of three real numbers/],
    [['Shape', 'x'], /empty tuple/],
    [['Flatten', 'B', 'n'], /depth that is not a constant/],
    [['Flatten', 'B', -1], /depth that is not a constant/],
    // An empty list of rows has rank 1 and the shape `(0)` in the
    // interpreter, so a number of rows known at run time only settles
    // neither.
    [['Rank', 'P'], /known at run time only/],
    [['Shape', 'P'], /known at run time only/],
  ];
  for (const [json, cause] of DECLINES)
    it(JSON.stringify(json), () => {
      const r = compiled(json);
      expect(r.success).toBe(false);
      expect(r.message ?? '').toMatch(cause);
    });

  it('the kernels have no spelling on glsl and interval-js', () => {
    for (const to of ['glsl', 'interval-js'])
      for (const json of [
        ['Determinant', 'A'],
        ['Inverse', 'A'],
        ['RowReduce', 'B'],
        ['MatrixPower', 'A', 2],
      ])
        expect(compiled(json, to).success).toBe(false);
  });
});

describe('Cross ON GLSL AND interval-js', () => {
  it('two 3-tuples on glsl: a vec3 of the components', () => {
    const r = compiled(['Cross', 'V', 'W'], 'glsl');
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/vec3\(/);
  });

  it('two lists of three on glsl', () => {
    const r = compiled(['Cross', 'U', ['List', 1, 2, 3]], 'glsl');
    expect(r.success).toBe(true);
  });

  it('interval-js encloses the value', () => {
    const r = compiled(['Cross', 'U', ['List', 'x', 2, 1]], 'interval-js');
    expect(r.success).toBe(true);
    const v = r.run({ U: [1, 2, 3], x: 0.5 });
    const expected = [-4, 0.5, 1];
    v.forEach((c: any, i: number) => {
      const iv = c.value ?? c;
      expect(iv.lo).toBeLessThanOrEqual(expected[i]);
      expect(iv.hi).toBeGreaterThanOrEqual(expected[i]);
    });
  });
});
