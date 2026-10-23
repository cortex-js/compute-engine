import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic } from '../../src/compute-engine/interval';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * `Multiply` of two matrices is the matrix product, however the factors are
 * written (user decision 2026-10-22, as in SymPy, MATLAB and Julia):
 *
 * 1. Two matrices (two axes) give the matrix product, as `MatrixMultiply`:
 *    for symbols, literals and computed factors alike. Before, a product
 *    whose matrix factors were all symbols typed `tensor<number>`,
 *    `list<list<number>>`, `list`, `any` or `broadcastable<number>` was the
 *    product of each entry, and `.N()` was the product of each entry even
 *    for symbols typed `matrix`. So `p^2` (the matrix square) and `p·p`
 *    disagreed.
 * 2. A vector or a list of numbers times a vector or a list of numbers
 *    stays the product of each entry.
 * 3. A number times a matrix scales each entry.
 * 4. Compiled code follows the same rule. A type that may hold points (a
 *    bare `list`, `any`) keeps the element-wise code: compiled code holds a
 *    list of points and a matrix as the same array.
 *
 * The product of each entry stays available as `HadamardProduct`.
 */

type Value = number | Value[];

function toMathJson(v: Value): MathJsonExpression {
  return Array.isArray(v) ? ['List', ...v.map(toMathJson)] : v;
}

function fromJson(x: unknown): unknown {
  if (Array.isArray(x)) {
    if (x[0] === 'List') return x.slice(1).map(fromJson);
    return x;
  }
  if (typeof x === 'object' && x !== null && 'num' in x)
    return Number((x as { num: string }).num);
  return x;
}

const M: Value = [
  [1, 2],
  [3, 4],
];
const Q: Value = [
  [0, 1],
  [1, 0],
];
// M·M, Q·M, M·Q, M·Q·M, M ⊙ Q
const MM = [
  [7, 10],
  [15, 22],
];
const QM = [
  [3, 4],
  [1, 2],
];
const MQ = [
  [2, 1],
  [4, 3],
];
const MQM = [
  [5, 8],
  [13, 20],
];
const HADAMARD = [
  [0, 2],
  [3, 0],
];

/** A new engine with `p := M`, `q := Q` (declared `type` when given) and
 * `v := [5, 6]` (declared `list<number>`). */
function engineWith(type: string | undefined): ComputeEngine {
  const ce = new ComputeEngine();
  if (type !== undefined) {
    ce.declare('p', type);
    ce.declare('q', type);
  }
  ce.declare('v', 'list<number>');
  ce.assign('p', ce.box(toMathJson(M)));
  ce.assign('q', ce.box(toMathJson(Q)));
  ce.assign('v', ce.box(['List', 5, 6]));
  return ce;
}

const TYPES = [
  'matrix<number>',
  'matrix<number^(2x2)>',
  'tensor<number>',
  'list<list<number>>',
  'list',
  'any',
  'broadcastable<number>',
  undefined,
];

describe('the interpreter', () => {
  for (const type of TYPES) {
    describe(`p and q ${type === undefined ? 'not declared' : `declared ${type}`}`, () => {
      const ce = engineWith(type);
      const evaluate = (expr: MathJsonExpression) =>
        fromJson(ce.box(expr).evaluate().json);
      const n = (expr: MathJsonExpression) => fromJson(ce.box(expr).N().json);

      it('p·p is the matrix square, the value of p^2', () => {
        expect(evaluate(['Multiply', 'p', 'p'])).toEqual(MM);
        expect(n(['Multiply', 'p', 'p'])).toEqual(MM);
        expect(evaluate(['Power', 'p', 2])).toEqual(MM);
      });
      it('q·p is the matrix product in the written order', () => {
        expect(evaluate(['Multiply', 'q', 'p'])).toEqual(QM);
        expect(n(['Multiply', 'q', 'p'])).toEqual(QM);
        expect(evaluate(['Multiply', 'p', 'q'])).toEqual(MQ);
      });
      it('three factors are multiplied left to right', () => {
        expect(evaluate(['Multiply', 'p', 'q', 'p'])).toEqual(MQM);
        expect(n(['Multiply', 'p', 'q', 'p'])).toEqual(MQM);
      });
      it('a literal or a computed factor gives the same product', () => {
        expect(evaluate(['Multiply', 'p', toMathJson(Q)])).toEqual(MQ);
        expect(evaluate(['Multiply', toMathJson(Q), 'p'])).toEqual(QM);
        expect(evaluate(['Multiply', 'p', ['Transpose', 'q']])).toEqual(MQ);
      });
      it('a number scales each entry', () => {
        expect(evaluate(['Multiply', 2, 'p'])).toEqual([
          [2, 4],
          [6, 8],
        ]);
        expect(evaluate(['Multiply', 2, 'p', 'q'])).toEqual([
          [4, 2],
          [8, 6],
        ]);
      });
      it('a matrix times a vector is the matrix-vector product', () => {
        expect(evaluate(['Multiply', 'p', 'v'])).toEqual([17, 39]);
        expect(evaluate(['Multiply', 'v', 'p'])).toEqual([23, 34]);
        expect(n(['Multiply', 'p', 'v'])).toEqual([17, 39]);
      });
      it('HadamardProduct is the product of each entry', () => {
        expect(evaluate(['HadamardProduct', 'p', 'q'])).toEqual(HADAMARD);
      });
    });
  }

  it('keeps the written order of the factors that may be matrices', () => {
    for (const type of TYPES.filter((t) => t !== undefined)) {
      const ce = new ComputeEngine();
      ce.declare('p', type!);
      ce.declare('q', type!);
      expect(ce.box(['Multiply', 'q', 'p']).json).toEqual([
        'Multiply',
        'q',
        'p',
      ]);
      expect(ce.box(['Multiply', 'q', 2, 'p']).json).toEqual([
        'Multiply',
        2,
        'q',
        'p',
      ]);
    }
    // Scalars still sort.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    expect(ce.box(['Multiply', 'y', 'x']).json).toEqual(['Multiply', 'x', 'y']);
  });

  it('multiplies matrices that are not square', () => {
    const ce = new ComputeEngine();
    const a = toMathJson([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const b = toMathJson([
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(fromJson(ce.box(['Multiply', a, b]).evaluate().json)).toEqual([
      [4, 5],
      [10, 11],
    ]);
    expect(fromJson(ce.box(['Multiply', b, a]).evaluate().json)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [5, 7, 9],
    ]);
    expect(ce.box(['Multiply', a, a]).evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "3 vs 2")'
    );
  });

  it('keeps the product of each entry for two vectors', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'list<number>');
    ce.declare('w', 'vector<number^2>');
    ce.assign('v', ce.box(['List', 1, 2]));
    ce.assign('w', ce.box(['List', 3, 4]));
    expect(fromJson(ce.box(['Multiply', 'v', 'w']).evaluate().json)).toEqual([
      3, 8,
    ]);
    expect(fromJson(ce.box(['Multiply', 'v', 'w']).N().json)).toEqual([3, 8]);
    expect(
      fromJson(
        ce.box(['Multiply', ['List', 1, 2], ['List', 3, 4]]).evaluate().json
      )
    ).toEqual([3, 8]);
  });

  it('multiplies each pair of matrices of two tensors of rank 3, as Power', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tensor<number>');
    const r3 = toMathJson([M, Q]);
    ce.assign('t', ce.box(r3));
    const square = fromJson(ce.box(['Power', 't', 2]).evaluate().json);
    expect(square).toEqual([
      MM,
      [
        [1, 0],
        [0, 1],
      ],
    ]);
    expect(fromJson(ce.box(['Multiply', 't', 't']).evaluate().json)).toEqual(
      square
    );
    expect(fromJson(ce.box(['Multiply', r3, r3]).evaluate().json)).toEqual(
      square
    );
  });

  it('parses a product of matrix symbols in the written order', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<number>');
    ce.declare('B', 'matrix<number>');
    ce.assign('A', ce.box(toMathJson(M)));
    ce.assign('B', ce.box(toMathJson(Q)));
    for (const latex of ['AB', 'A B', 'A\\cdot B', 'A\\times B']) {
      const expr = ce.parse(latex);
      expect(expr.json).toEqual(['Multiply', 'A', 'B']);
      expect(fromJson(expr.evaluate().json)).toEqual(MQ);
    }
    expect(fromJson(ce.parse('BA').evaluate().json)).toEqual(QM);
    expect(fromJson(ce.parse('A^2').evaluate().json)).toEqual(MM);
  });
});

describe('the type of a product of matrices', () => {
  const ce = new ComputeEngine();
  ce.declare('a', 'matrix<number^(2x3)>');
  ce.declare('b', 'matrix<number^(3x2)>');
  ce.declare('u', 'vector<number^3>');
  const typeOf = (expr: MathJsonExpression) => ce.box(expr).type.toString();
  it('has the dimensions of the matrix product', () => {
    expect(typeOf(['Multiply', 'a', 'b'])).toBe('matrix<2x2>');
    expect(typeOf(['Multiply', 'b', 'a'])).toBe('matrix<3x3>');
    expect(typeOf(['Multiply', 2, 'a', 'b'])).toBe('matrix<2x2>');
    expect(typeOf(['Multiply', 'a', 'u'])).toBe('vector<2>');
  });
});

describe('compiled code', () => {
  /** Compile `expr` with `p` and `q` declared `type`, run it with
   * `p := pv`, `q := qv`, and return the result and the code. */
  function run(
    type: string,
    expr: MathJsonExpression,
    pv: Value,
    qv: Value
  ): { code: string; result: unknown; expected: unknown } {
    const ce = new ComputeEngine();
    ce.declare('p', type);
    ce.declare('q', type);
    const r = compile(ce.box(expr), { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    const result = r.run!({ p: pv, q: qv } as never);
    ce.assign('p', ce.box(toMathJson(pv)));
    ce.assign('q', ce.box(toMathJson(qv)));
    const expected = fromJson(ce.box(expr).N().json);
    return { code: r.code!, result, expected };
  }

  for (const type of [
    'matrix<number>',
    'matrix<number^(2x2)>',
    'tensor<number>',
    'list<list<number>>',
    'broadcastable<number>',
  ]) {
    describe(type, () => {
      for (const expr of [
        ['Multiply', 'p', 'q'],
        ['Multiply', 'q', 'p'],
        ['Multiply', 'p', 'p'],
        ['Multiply', 2, 'p', 'q'],
        ['Multiply', 'p', 'q', 'p'],
      ] as MathJsonExpression[]) {
        it(`${JSON.stringify(expr)} is the matrix product`, () => {
          const { result, expected } = run(type, expr, M, Q);
          expect(result).toEqual(expected);
        });
      }
    });
  }

  it('a matrix symbol times a literal matrix is the matrix product', () => {
    for (const type of ['matrix<number>', 'tensor<number>']) {
      const { result, expected } = run(
        type,
        ['Multiply', 'p', toMathJson(Q)],
        M,
        Q
      );
      expect(expected).toEqual(MQ);
      expect(result).toEqual(MQ);
    }
  });

  it('a matrix type calls the matrix product', () => {
    expect(run('matrix<number>', ['Multiply', 2, 'p', 'q'], M, Q).code).toBe(
      '_SYS.mul(2, _.p, _.q)'
    );
  });

  it('a type without a rank dispatches on the shape of the values', () => {
    const { code } = run('tensor<number>', ['Multiply', 'p', 'q'], M, Q);
    expect(code).toBe(
      '(_SYS.matrixProductShape(_.p, _.q) ?? (_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), _.p, _.q)))'
    );
    // Two vectors: the product of each entry, as in the interpreter.
    const vectors = run(
      'tensor<number>',
      ['Multiply', 'p', 'q'],
      [1, 2],
      [3, 4]
    );
    expect(vectors.expected).toEqual([3, 8]);
    expect(vectors.result).toEqual([3, 8]);
  });

  it('two tensors of rank 3 give the matrix product of each pair of matrices', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('q', 'tensor<number>');
    const r = compile(ce.box(['Multiply', 'p', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!({ p: [M, Q], q: [M, Q] } as never)).toEqual([
      MM,
      [
        [1, 0],
        [0, 1],
      ],
    ]);
    // Tensors of different lengths: the interpreter gives an
    // `incompatible-dimensions` error.
    expect(r.run!({ p: [M, Q], q: [M, Q, M] } as never)).toBeNaN();
  });

  it('a tensor of rank 3 beside a matrix throws when the code runs', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('q', 'tensor<number>');
    const r = compile(ce.box(['Multiply', 'p', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(() => r.run!({ p: [M, Q], q: M } as never)).toThrow(/rank 3/);
  });

  it('matrices whose dimensions do not agree do not compile', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'matrix<number^(2x3)>');
    expect(() =>
      compile(ce.box(['Multiply', 'a', 'a']), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/incompatible-dimensions/);
  });

  it('a type that may hold points keeps the element-wise code', () => {
    for (const type of ['list', 'list<unknown>']) {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      ce.declare('q', type);
      const r = compile(ce.box(['Multiply', 'p', 'q']), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.code).toBe(
        '_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), _.p, _.q)'
      );
    }
    // A list of points times a list of numbers scales each point.
    const ce = new ComputeEngine();
    ce.declare('p', 'list<tuple<number, number>>');
    ce.declare('v', 'list<number>');
    const r = compile(ce.box(['Multiply', 'p', 'v']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.code).not.toContain('matrixProductShape');
    expect(
      r.run!({
        p: [
          [1, 2],
          [3, 4],
        ],
        v: [2, 3],
      } as never)
    ).toEqual([
      [2, 4],
      [9, 12],
    ]);
  });

  it('Python calls np.matmul for matrix types', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'matrix<number>');
    ce.declare('q', 'matrix<number>');
    ce.declare('v', 'list<number>');
    const py = (expr: MathJsonExpression) =>
      compile(ce.box(expr), { to: 'python', fallback: false }).code;
    expect(py(['Multiply', 'p', 'q'])).toBe('np.matmul(p, q)');
    expect(py(['Multiply', 2, 'q', 'p'])).toBe('(2 * np.matmul(q, p))');
    expect(py(['Multiply', 'p', 'v'])).toBe('np.matmul(p, v)');
  });

  it('Python refuses a product whose ranks are known only at run time', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'tensor<number>');
    ce.declare('q', 'tensor<number>');
    expect(() =>
      compile(ce.box(['Multiply', 'p', 'q']), { to: 'python', fallback: false })
    ).toThrow();
  });

  it('GLSL multiplies two square matrices with its matrix product', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'matrix<number^(2x2)>');
    ce.declare('q', 'matrix<number^(2x2)>');
    const r = compile(ce.box(['Multiply', 'q', 'p']), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.code).toBe('q * p');
  });

  it('interval-js checks the shapes of the values of lists that may be matrices', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'broadcastable<number>');
    ce.declare('L', 'list<number>');
    for (const expr of [
      ['Multiply', 'a', 'L'],
      ['Multiply', 'a', 'a'],
    ] as MathJsonExpression[]) {
      const r = compile(ce.box(expr), { to: 'interval-js', fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).toContain('_IA.bcastProduct');
      // Two vectors: the product of each entry.
      const vectors = r.run!({ a: [1, 2], L: [3, 4] } as never) as unknown[];
      expect(vectors).toHaveLength(2);
      // A matrix beside another list: the interpreter takes the matrix
      // product, which this target does not compute. The code throws, and
      // the runner of this target turns a run-time error into `entire`
      // ("cannot bound this"). The absence marker (`empty`) would say
      // "no value", and the product has a value.
      expect(
        r.run!({
          a: [
            [1, 2],
            [3, 4],
          ],
          L: [3, 4],
        } as never)
      ).toMatchObject({ kind: 'entire' });
    }
    // Two lists of numbers keep the product of each entry, with no check.
    ce.declare('v', 'list<number>');
    ce.declare('w', 'list<number>');
    const vw = compile(ce.box(['Multiply', 'v', 'w']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(vw.code).toContain('_IA.bcast(');
  });

  it('evaluates a factor that is repeated once for each position', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '() -> tensor<number>');
    const call = ce.box(['f']);
    const r = compile(ce.function('Multiply', [call, call]), {
      to: 'javascript',
      fallback: false,
      functions: {
        f: () => {
          const g = globalThis as { __mmCalls?: number };
          g.__mmCalls = (g.__mmCalls ?? 0) + 1;
          return g.__mmCalls === 1 ? [1, 2] : [3, 4];
        },
      },
    });
    expect(r.run!({} as never)).toEqual([3, 8]);
  });

  it('Python keeps a sum that scales a matrix product in parentheses', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'matrix<number>');
    ce.declare('q', 'matrix<number>');
    ce.declare('x', 'real');
    expect(
      compile(ce.box(['Multiply', ['Add', 'x', 1], 'p', 'q']), {
        to: 'python',
        fallback: false,
      }).code
    ).toBe('((x + 1) * np.matmul(p, q))');
  });

  it('a list of points times a broadcastable<number> scales each point', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'list<tuple<number, number>>');
    ce.declare('b', 'broadcastable<number>');
    const pts = [
      [1, 2],
      [3, 4],
    ];
    for (const expr of [
      ['Multiply', 'b', 'a'],
      ['Multiply', 'a', 'b'],
    ] as MathJsonExpression[]) {
      const r = compile(ce.box(expr), { to: 'javascript', fallback: false });
      expect(r.code).not.toContain('_SYS.mul(');
      expect(r.run!({ a: pts, b: [2, 3] } as never)).toEqual([
        [2, 4],
        [9, 12],
      ]);
    }
  });

  it('an operand computed from a union of list types dispatches on the values', () => {
    const type = 'list<number> | list<list<number>>';
    for (const expr of [
      ['Multiply', ['Add', 'p', 1], 'q'],
      ['Multiply', 'p', ['Sin', 'q']],
    ] as MathJsonExpression[]) {
      const { result, expected } = run(type, expr, M, Q);
      expect(result).toEqual(expected);
    }
  });
});

describe('simplification and expansion of products that may be matrices', () => {
  for (const type of [
    'tensor<number>',
    'any',
    'broadcastable<number>',
    'number | matrix',
    'value',
  ]) {
    describe(type, () => {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      ce.declare('q', type);
      it('does not move a factor past another one', () => {
        expect(ce.box(['Multiply', 'p', 'q', 'p']).simplify().json).toEqual([
          'Multiply',
          'p',
          'q',
          'p',
        ]);
        expect(
          ce.box(['Multiply', 'q', 'p', ['Power', 'q', -1]]).simplify().json
        ).toEqual(['Multiply', 'q', 'p', ['Power', 'q', -1]]);
      });
      it('expands a power of a sum in order, if the terms are matrices', () => {
        const expanded = ce
          .box(['Expand', ['Power', ['Add', 'p', 'q'], 2]])
          .evaluate();
        const expected = ce.box([
          'Add',
          ['Power', 'p', 2],
          ['Multiply', 'p', 'q'],
          ['Multiply', 'q', 'p'],
          ['Power', 'q', 2],
        ]);
        // A type that may be a number too (`any`, `value`, ...): the sum of
        // a matrix and a number adds the number to every entry, so the
        // power is not expanded.
        if (type === 'tensor<number>')
          expect(expanded.isSame(expected)).toBe(true);
        else expect(expanded.toString()).toBe('(p + q)^2');
      });
    });
  }

  it('a scalar product still commutes', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.declare('q', 'real');
    expect(ce.box(['Multiply', 'p', 'q', 'p']).simplify().toString()).toBe(
      'q * p^2'
    );
  });
});

describe('products with a tensor of rank 3', () => {
  const L = (...xs: MathJsonExpression[]): MathJsonExpression => [
    'List',
    ...xs,
  ];
  const T3 = L(toMathJson(M), toMathJson(Q));
  const ce = new ComputeEngine();
  const evaluate = (expr: MathJsonExpression) =>
    ce.box(expr).evaluate().toString();

  it('two tensors of rank 3: the product of each pair of matrices', () => {
    expect(evaluate(['Multiply', T3, T3])).toBe(evaluate(['Power', T3, 2]));
  });
  it('beside a matrix or a vector: no product', () => {
    for (const expr of [
      ['Multiply', T3, toMathJson(M)],
      ['Multiply', toMathJson(M), T3],
      ['Multiply', T3, L(1, 2)],
    ] as MathJsonExpression[]) {
      const value = ce.box(expr).evaluate();
      expect(value.operator).toBe('Multiply');
    }
  });
  it('a number scales every cell', () => {
    expect(fromJson(ce.box(['Multiply', 2, T3]).evaluate().json)).toEqual([
      [
        [2, 4],
        [6, 8],
      ],
      [
        [0, 2],
        [2, 0],
      ],
    ]);
  });
  it('symbols that hold these tensors follow the same rules', () => {
    const ce = new ComputeEngine();
    for (const s of ['t', 'm', 'v']) ce.declare(s, 'tensor<number>');
    ce.assign('t', ce.box(T3));
    ce.assign('m', ce.box(toMathJson(M)));
    ce.assign('v', ce.box(L(1, 2)));
    expect(ce.box(['Multiply', 't', 't']).evaluate().toString()).toBe(
      ce.box(['Power', 't', 2]).evaluate().toString()
    );
    expect(ce.box(['Multiply', 't', 'm']).evaluate().operator).toBe('Multiply');
    expect(ce.box(['Multiply', 't', 'v']).evaluate().operator).toBe('Multiply');
  });
  it('the type has the dimensions of the products of the pairs', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'tensor<real^(2x2x3)>');
    ce.declare('r', 'tensor<real^(2x3x4)>');
    expect(ce.box(['Multiply', 's', 'r']).type.toString()).toBe(
      'tensor<real^(2x2x4)>'
    );
  });
});

describe('matrices beside a list of points', () => {
  it('are multiplied together before the points are scaled', () => {
    const ce = new ComputeEngine();
    const m = toMathJson(M);
    const pts: MathJsonExpression = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    const square = ce.box(['Multiply', ['Power', m, 2], pts]).evaluate();
    expect(ce.box(['Multiply', m, m, pts]).evaluate().isSame(square)).toBe(
      true
    );
  });
});

describe('matrices whose dimensions do not agree', () => {
  it('are typed as the error that their product is', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'matrix<real^(2x3)>');
    expect(ce.box(['Multiply', 'a', 'a']).type.toString()).toBe('error');
  });
});

describe('second review round', () => {
  const MJ = toMathJson(M);
  const QJ = toMathJson(Q);

  it('1. interval-js refuses a matrix-vector product, never answers empty', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'broadcastable<number>');
    ce.declare('L', 'list<number>');
    const r = compile(ce.box(['Multiply', 'a', 'L']), {
      to: 'interval-js',
      fallback: false,
    });
    // The compiled code throws, and the runner answers `entire` ("cannot
    // bound this"), never `empty` ("no value"): [3, 4] times the matrix has
    // the value [11, 25].
    const code = new Function('_IA', '_', `return ${r.code}`);
    expect(() =>
      code(IntervalArithmetic, {
        a: [
          [1, 2],
          [3, 4],
        ],
        L: [3, 4],
      })
    ).toThrow(/matrix product/);
    expect(
      r.run!({
        a: [
          [1, 2],
          [3, 4],
        ],
        L: [3, 4],
      } as never)
    ).toEqual({ kind: 'entire' });
  });

  it('2. broadcastable<number> products check the shapes at run time', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<number>');
    ce.declare('q', 'broadcastable<number>');
    const r = compile(ce.box(['Multiply', 'p', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.code).toContain('_SYS.mulChecked');
    // Two matrices: the matrix product. Two vectors: each entry.
    expect(r.run!({ p: M, q: Q } as never)).toEqual(MQ);
    expect(r.run!({ p: [1, 2], q: [3, 4] } as never)).toEqual([3, 8]);
    // Rank 3 beside rank 3: the matrix product of each pair, not NaN
    // cells. Rank 3 beside a matrix: refused.
    expect(r.run!({ p: [M, Q], q: [M, Q] } as never)).toEqual([
      MM,
      [
        [1, 0],
        [0, 1],
      ],
    ]);
    expect(() => r.run!({ p: [M, Q], q: M } as never)).toThrow(/rank 3/);
  });

  describe('3. Expand of a power of a sum', () => {
    it('vectors commute: the multinomial expansion is short', () => {
      for (const type of ['list<number>', 'vector<number^3>']) {
        const ce = new ComputeEngine();
        ce.declare('v', type);
        ce.declare('w', type);
        const s = ce
          .box(['Expand', ['Power', ['Add', 'v', 'w'], 8]])
          .evaluate()
          .toString();
        expect(s.length).toBeLessThan(200);
        expect(s).toContain('8');
      }
    });
    it('every type that may be a matrix agrees', () => {
      const results = new Set<string>();
      for (const type of ['tensor<number>', 'any', 'broadcastable<number>']) {
        const ce = new ComputeEngine();
        ce.declare('A', type);
        ce.declare('B', type);
        ce.declare('x', 'real');
        // A matrix plus a number adds the number to every entry: not expanded.
        expect(
          ce
            .box(['Expand', ['Power', ['Add', 'A', 'B', 'x'], 2]])
            .evaluate()
            .toString()
        ).toBe('(A + B + x)^2');
        results.add(
          ce
            .box(['Expand', ['Power', ['Add', 'A', 'B'], 2]])
            .evaluate()
            .toString()
        );
      }
      // Only `tensor<number>` is provably not a number: the others stay
      // factored.
      expect([...results].sort()).toEqual([
        '(A + B)^2',
        'A^2 + B^2 + B * A + A * B',
      ]);
    });
    it('a large power is left unexpanded', () => {
      const ce = new ComputeEngine();
      ce.declare('A', 'tensor<number>');
      ce.declare('B', 'tensor<number>');
      ce.declare('C', 'tensor<number>');
      // 3^8 = 6561 terms is over the cap of 1024.
      expect(
        ce
          .box(['Expand', ['Power', ['Add', 'A', 'B', 'C'], 8]])
          .evaluate()
          .toString()
      ).toBe('(A + B + C)^8');
    });
  });

  describe('4. the product rule keeps the order of the factors', () => {
    for (const type of ['tensor<number>', 'any', 'matrix<number>']) {
      it(`f and g return ${type}`, () => {
        const ce = new ComputeEngine();
        ce.declare('f', `(real) -> ${type}`);
        ce.declare('g', `(real) -> ${type}`);
        const d = ce.box(['D', ['Multiply', ['f', 'x'], ['g', 'x']], 'x']);
        const expected = ce.box([
          'Add',
          ['Multiply', ['Apply', ['Derivative', 'f', 1], 'x'], ['g', 'x']],
          ['Multiply', ['f', 'x'], ['Apply', ['Derivative', 'g', 1], 'x']],
        ]);
        expect(d.evaluate().isSame(expected.evaluate())).toBe(true);
        // The square: f'f + ff', not 2ff'.
        const square = ce.box(['D', ['Power', ['f', 'x'], 2], 'x']).evaluate();
        const expectedSquare = ce.box([
          'Add',
          ['Multiply', ['Apply', ['Derivative', 'f', 1], 'x'], ['f', 'x']],
          ['Multiply', ['f', 'x'], ['Apply', ['Derivative', 'f', 1], 'x']],
        ]);
        expect(square.isSame(expectedSquare.evaluate())).toBe(true);
      });
    }
    it('agrees with a finite difference', () => {
      const ce = new ComputeEngine();
      // f(x) = [[x, 1], [0, x]], g(x) = [[1, x], [x, 2]]
      const f = (x: number) => [
        [x, 1],
        [0, x],
      ];
      const g = (x: number) => [
        [1, x],
        [x, 2],
      ];
      const mm = (a: number[][], b: number[][]) =>
        a.map((r, i) =>
          b[0].map((_, j) => r.reduce((s, _v, k) => s + a[i][k] * b[k][j], 0))
        );
      const h = 1e-6;
      const x0 = 0.7;
      const numeric = mm(f(x0 + h), g(x0 + h)).map((r, i) =>
        r.map((v, j) => (v - mm(f(x0 - h), g(x0 - h))[i][j]) / (2 * h))
      );
      ce.declare('f', '(real) -> tensor<number>');
      ce.declare('g', '(real) -> tensor<number>');
      ce.assign(
        'f',
        ce.box(['Function', ['List', ['List', 'x', 1], ['List', 0, 'x']], 'x'])
      );
      ce.assign(
        'g',
        ce.box(['Function', ['List', ['List', 1, 'x'], ['List', 'x', 2]], 'x'])
      );
      const d = ce.box(['D', ['Multiply', ['f', 'x'], ['g', 'x']], 'x']);
      const value = fromJson(
        d.evaluate().subs({ x: x0 }).N().json
      ) as number[][];
      expect(Array.isArray(value)).toBe(true);
      value.forEach((row, i) =>
        row.forEach((v, j) => expect(v).toBeCloseTo(numeric[i][j], 4))
      );
    });
  });

  describe('4b. powers of a matrix function agree with a finite difference', () => {
    // f(x) = [[1, x], [x, 2]] does not commute with f'(x) = [[0, 1], [1, 0]].
    type Mat = number[][];
    const f = (x: number): Mat => [
      [1, x],
      [x, 2],
    ];
    const mm = (a: Mat, b: Mat): Mat =>
      a.map((r, i) => b[0].map((_, j) => r[0] * b[0][j] + r[1] * b[1][j]));
    const inv = (a: Mat): Mat => {
      const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
      return [
        [a[1][1] / det, -a[0][1] / det],
        [-a[1][0] / det, a[0][0] / det],
      ];
    };
    const pow = (a: Mat, n: number): Mat => {
      let base = n < 0 ? inv(a) : a;
      let r: Mat = [
        [1, 0],
        [0, 1],
      ];
      for (let k = 0; k < Math.abs(n); k++) r = mm(r, base);
      return r;
    };
    const ce = new ComputeEngine();
    ce.declare('f', '(real) -> tensor<number>');
    ce.assign(
      'f',
      ce.box(['Function', ['List', ['List', 1, 'x'], ['List', 'x', 2]], 'x'])
    );
    for (const n of [-1, -2, -3, 2, 3]) {
      it(`n = ${n}`, () => {
        const x0 = 0.4;
        const h = 1e-6;
        const hi = pow(f(x0 + h), n);
        const lo = pow(f(x0 - h), n);
        const d = ce.box(['D', ['Power', ['f', 'x'], n], 'x']);
        const value = fromJson(
          d.evaluate().subs({ x: x0 }).N().json
        ) as number[][];
        value.forEach((row, i) =>
          row.forEach((v, j) =>
            expect(v).toBeCloseTo((hi[i][j] - lo[i][j]) / (2 * h), 4)
          )
        );
      });
    }
    it('a non-integer exponent keeps D unevaluated', () => {
      const d = ce.box(['D', ['Power', ['f', 'x'], 0.5], 'x']).evaluate();
      expect(d.operator).toBe('D');
    });
  });

  describe('5. simplify does not move matrix factors', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'tensor<number>');
    ce.declare('B', 'tensor<number>');
    ce.declare('r', 'real');
    it('(A B)^2 stays a power', () => {
      expect(
        ce
          .box(['Power', ['Multiply', 'A', 'B'], 2])
          .simplify()
          .toString()
      ).toBe('(A * B)^2');
    });
    it('(A B)^-1 stays a power: A and B are not provably square', () => {
      expect(
        ce
          .box(['Power', ['Multiply', 'A', 'B'], -1])
          .simplify()
          .toString()
      ).toBe('(A * B)^(-1)');
    });
    it('a scalar still distributes', () => {
      expect(
        ce
          .box(['Power', ['Multiply', 'r', 'A'], 2])
          .simplify()
          .toString()
      ).toBe('A^2 * r^2');
    });
  });

  describe('6. Expand and Factor evaluate a product of matrix literals', () => {
    it('literals and symbols that hold matrices', () => {
      const ce = new ComputeEngine();
      ce.assign('p', ce.box(MJ));
      ce.assign('q', ce.box(QJ));
      const value = (e: MathJsonExpression) =>
        fromJson(ce.box(e).evaluate().json);
      expect(value(['Expand', ['Multiply', QJ, MJ]])).toEqual(QM);
      expect(value(['Expand', ['Multiply', 'q', 'p']])).toEqual(QM);
      expect(value(['Factor', ['Multiply', 'p', 'q']])).toEqual(MQ);
      expect(value(['Expand', ['Power', ['Add', 'p', 'q'], 2]])).toEqual([
        [13, 15],
        [20, 28],
      ]);
    });
  });

  describe('7. the type of a product with a union of matrix types', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'matrix<number^(2x3)> | matrix<number^(3x4)>');
    ce.declare('b', 'matrix<number^(3x4)>');
    ce.declare('a1', 'matrix<number^(2x3)>');
    ce.declare('w', 'matrix<number^(3x4)> | matrix<number^(3x5)>');
    const arms = (e: MathJsonExpression) =>
      ce.box(e).type.toString().split(' | ').sort();
    it('keeps the error arm', () => {
      expect(arms(['Multiply', 'u', 'b'])).toEqual(
        ['error', 'matrix<2x4>'].sort()
      );
    });
    it('joins the products of the arms', () => {
      expect(arms(['Multiply', 'a1', 'w'])).toEqual(
        ['matrix<2x4>', 'matrix<2x5>'].sort()
      );
    });
  });

  describe('8. rank 3 tensors of different lengths', () => {
    const t = (n: number): MathJsonExpression => [
      'List',
      ...Array.from({ length: n }, () => toMathJson(M)),
    ];
    it('literals and symbols give the same error, typed error', () => {
      const ce = new ComputeEngine();
      ce.assign('p', ce.box(t(2)));
      ce.assign('q', ce.box(t(3)));
      const symbols = ce.box(['Multiply', 'p', 'q']);
      const literals = ce.box(['Multiply', t(2), t(3)]);
      expect(symbols.type.toString()).toBe('error');
      expect(literals.type.toString()).toBe('error');
      const expected = 'Error("incompatible-dimensions", "2 vs 3")';
      expect(symbols.evaluate().toString()).toBe(expected);
      expect(literals.evaluate().toString()).toBe(expected);
    });
  });

  describe('9. canonical order', () => {
    it('(a) symbols typed expression are sorted as before', () => {
      const ce = new ComputeEngine();
      ce.declare('e1', 'expression');
      ce.declare('e2', 'expression');
      expect(ce.box(['Multiply', 'e2', 'e1']).toString()).toBe(
        ce.box(['Multiply', 'e1', 'e2']).toString()
      );
    });
    it('(b) a point list beside one matrix-capable symbol is sorted', () => {
      const ce = new ComputeEngine();
      ce.declare('b', 'list<tuple<number, number>>');
      ce.declare('a', 'any');
      expect(ce.box(['Multiply', 'b', 'a']).toString()).toBe('a * b');
    });
    it('(b) a point list beside two matrices keeps the written order', () => {
      const ce = new ComputeEngine();
      ce.declare('b', 'list<tuple<number, number>>');
      ce.declare('m', 'tensor<number>');
      ce.declare('n', 'tensor<number>');
      expect(ce.box(['Multiply', 'm', 'b', 'n']).toString()).toBe('m * b * n');
    });
  });

  describe('10. compiled m n P fails closed', () => {
    it('two typed matrices beside a list of points do not compile', () => {
      const ce = new ComputeEngine();
      ce.declare('m', 'tensor<number>');
      ce.declare('n', 'tensor<number>');
      ce.declare('P', 'list<tuple<number, number>>');
      expect(() =>
        compile(ce.box(['Multiply', 'm', 'n', 'P']), {
          to: 'javascript',
          fallback: false,
        })
      ).toThrow();
    });
  });

  describe('11. a Range is a vector beside a matrix', () => {
    it('M Q Range is the same as M Q List', () => {
      const ce = new ComputeEngine();
      const range = ce.box(['Multiply', MJ, QJ, ['Range', 1, 2]]).evaluate();
      const list = ce.box(['Multiply', MJ, QJ, ['List', 1, 2]]).evaluate();
      expect(range.isSame(list)).toBe(true);
      expect(fromJson(range.json)).toEqual([4, 10]);
    });
    it('M Range is the matrix-vector product', () => {
      const ce = new ComputeEngine();
      expect(
        fromJson(ce.box(['Multiply', MJ, ['Range', 1, 2]]).evaluate().json)
      ).toEqual([5, 11]);
    });
    it('two Ranges stay element-wise', () => {
      const ce = new ComputeEngine();
      expect(
        fromJson(
          ce.box(['Multiply', ['Range', 1, 2], ['Range', 1, 2]]).evaluate().json
        )
      ).toEqual([1, 4]);
    });
  });
});

describe('third review round', () => {
  const MJ = toMathJson(M);
  const QJ = toMathJson(Q);
  const CJ: MathJsonExpression = ['List', ['List', 1, 1], ['List', 0, 1]];

  describe('1. a sum of a matrix and a number is not distributed or expanded', () => {
    for (const type of ['tensor<number>', 'any']) {
      it(`A: ${type}`, () => {
        const ce = new ComputeEngine();
        ce.declare('A', type);
        ce.declare('C', type);
        ce.declare('b', 'any');
        ce.declare('x', 'real');
        // Symbolic: the sums stay factored.
        expect(
          ce.box(['Expand', ['Multiply', 'A', ['Add', 'b', 'C']]]).evaluate()
            .operator
        ).toBe('Multiply');
        expect(
          ce
            .box(['Expand', ['Power', ['Add', 'A', 'x'], 2]])
            .evaluate()
            .toString()
        ).toBe('(A + x)^2');
        // With values: A(b + C) at b = 1, C = 0 is 1 added to every entry of
        // C, times A: [[3,3],[7,7]]. (A + x)^2 at x = 1 is [[16,21],[28,37]].
        ce.assign('A', ce.box(MJ));
        ce.assign('C', ce.box(['List', ['List', 0, 0], ['List', 0, 0]]));
        ce.assign('b', ce.box(1));
        ce.assign('x', ce.box(1));
        const value = (e: MathJsonExpression) =>
          fromJson(ce.box(e).evaluate().json);
        expect(value(['Expand', ['Multiply', 'A', ['Add', 'b', 'C']]])).toEqual(
          [
            [3, 3],
            [7, 7],
          ]
        );
        expect(value(['Expand', ['Power', ['Add', 'A', 'x'], 2]])).toEqual([
          [16, 21],
          [28, 37],
        ]);
      });
    }
  });

  describe('2. the inverse of a product with a factor that may be a matrix', () => {
    it('is not reversed when the factors are not provably square matrices', () => {
      const ce = new ComputeEngine();
      ce.declare('A', 'tensor<number>');
      ce.declare('B', 'tensor<number>');
      expect(
        ce
          .box(['Power', ['Multiply', 'A', ['h', 'x'], 'B'], -1])
          .simplify()
          .toString()
      ).toBe('(A * h(x) * B)^(-1)');
    });
  });

  describe('3. a long Range beside a matrix factor is not materialized early', () => {
    it('Range(1, 10^6) times a number is fast and element-wise', () => {
      const ce = new ComputeEngine();
      const start = Date.now();
      ce.declare('p', 'tensor<number>');
      ce.declare('r', 'tensor<number>');
      ce.assign('p', ce.box(MJ));
      ce.assign('r', ce.box(['Range', 1, 1000000]));
      // A product that has no matrix does not read the Range.
      ce.box(['Multiply', 2, ['Range', 1, 1000000]]).evaluate();
      // Neither does the dispatch of a product with a matrix symbol: the
      // Range is longer than the limit, so it is not read as a vector.
      ce.box(['Multiply', 'p', 'r']).evaluate();
      expect(Date.now() - start).toBeLessThan(2000);
    });
    it('a Filter source beside a matrix is a vector', () => {
      const ce = new ComputeEngine();
      const f: MathJsonExpression = [
        'Filter',
        ['Range', 1, 4],
        ['Function', ['Less', 'x', 3], 'x'],
      ];
      expect(fromJson(ce.box(['Multiply', MJ, f]).evaluate().json)).toEqual([
        5, 11,
      ]);
    });
  });

  describe('4. symbols that hold matrices', () => {
    for (const type of ['tensor<number>', 'any']) {
      it(`${type}`, () => {
        const ce = new ComputeEngine();
        for (const n of ['A', 'B', 'C']) ce.declare(n, type);
        ce.assign('A', ce.box(MJ));
        ce.assign('B', ce.box(QJ));
        ce.assign('C', ce.box(CJ));
        const value = (e: MathJsonExpression) =>
          fromJson(ce.box(e).evaluate().json);
        expect(
          value([
            'Factor',
            ['Add', ['Multiply', 'A', 'B'], ['Multiply', 'A', 'C']],
          ])
        ).toEqual([
          [3, 4],
          [7, 10],
        ]);
        expect(
          value(['Expand', ['Multiply', 3, ['Add', 'A', 'B'], 'C']])
        ).toEqual([
          [3, 12],
          [12, 24],
        ]);
      });
    }
  });

  describe('5. a point list beside a typed vector or matrix keeps the written order', () => {
    for (const type of ['list<number>', 'vector<3>', 'matrix<number>']) {
      it(type, () => {
        const ce = new ComputeEngine();
        ce.declare('b', 'list<tuple<number, number>>');
        ce.declare('a', type);
        expect(ce.box(['Multiply', 'b', 'a']).toString()).toBe('b * a');
      });
    }
    it('beside a type that only may be a matrix it is sorted', () => {
      const ce = new ComputeEngine();
      ce.declare('b', 'list<tuple<number, number>>');
      ce.declare('a', 'any');
      expect(ce.box(['Multiply', 'b', 'a']).toString()).toBe('a * b');
    });
  });

  describe('6. p p^-1 and the derivative of f^0', () => {
    it('simplify does not cancel p p^-1 for p that may be a matrix', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'any');
      expect(
        ce
          .box(['Multiply', 'p', ['Power', 'p', -1]])
          .simplify()
          .toString()
      ).toBe('p * p^(-1)');
      ce.declare('r', 'real');
      expect(
        ce
          .box(['Multiply', 'r', ['Power', 'r', -1]])
          .simplify()
          .toString()
      ).toBe('1');
    });
    it("D(f^0) is 0 and D(f^1) is f'", () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(real) -> tensor<number>');
      expect(
        ce
          .box(['D', ['Power', ['f', 'x'], 0], 'x'])
          .evaluate()
          .toString()
      ).toBe('0');
      expect(
        ce
          .box(['D', ['MatrixPower', ['f', 'x'], 0], 'x'])
          .evaluate()
          .toString()
      ).toBe('0');
      expect(
        ce
          .box(['D', ['Power', ['f', 'x'], 1], 'x'])
          .evaluate()
          .toString()
      ).toBe('Apply(Derivative(f, 1), x)');
    });
  });
});

describe('fourth review round', () => {
  it('1. a float exponent of a matrix function is not the matrix rule', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(real) -> tensor<number>');
    ce.assign(
      'f',
      ce.box(['Function', ['List', ['List', 'x', 1], ['List', 0, 'x']], 'x'])
    );
    // f^2.0 is the entry-wise square, whose derivative is [[2x,0],[0,2x]],
    // not the derivative of the matrix square: D is left unevaluated.
    const d = ce.box(['D', ['Power', ['f', 'x'], { num: '2.0' }], 'x']);
    expect(d.evaluate().operator).toBe('D');
    // The exact exponent is the matrix power: [[2x, 2], [0, 2x]].
    expect(
      ce
        .box(['D', ['Power', ['f', 'x'], 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('[[2x,2],[0,2x]]');
  });

  it('2. the inverse of a product with a vector or a tensor is not reversed', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'tensor<number>');
    ce.declare('v', 'tensor<number>');
    ce.assign('A', ce.box(MJ4()));
    ce.assign('v', ce.box(['List', 5, 6]));
    const e = ce.box(['Power', ['Multiply', 'A', 'v'], -1]);
    expect(e.simplify().toString()).toBe('(A * v)^(-1)');
    expect(e.evaluate().toString()).toBe('[1/17,1/39]');
  });

  it('3. a per-element error result is typed as a list of errors', () => {
    const ce = new ComputeEngine();
    ce.declare('Boom', {
      signature: '(number) -> error',
      broadcastable: true,
    } as never);
    expect(ce.box(['Boom', ['List', 1, 2]]).type.toString()).toBe(
      'list<error^2>'
    );
    expect(ce.box(['Boom', 3]).type.toString()).toBe('error');
  });

  it('4. a collection over the limit keeps the product unevaluated', () => {
    const ce = new ComputeEngine();
    const n = 100001;
    const row = ce.box(['List', ['List', ...Array(n).fill(1)]]);
    const r = ce.box(['Multiply', row, ['Range', 1, n]]).evaluate();
    expect(r.operator).toBe('Multiply');
    expect(r.toString()).not.toContain('incompatible');
  });
});

function MJ4(): MathJsonExpression {
  return toMathJson(M);
}

/**
 * A list whose rows have different lengths, or that mixes numbers and lists
 * (`[[1], [2, 3]]`, `[[1, 2], 3]`), is not a matrix. The interpreter
 * multiplies it as a collection: the vectors and matrices beside it are first
 * multiplied together when one of them is a matrix, then the elements of the
 * arrays are paired and each pair is multiplied by the same rules. Compiled
 * code read the first row only, took such a list for a matrix, and gave
 * `null` or wrong values (ROADMAP CE-98.1). Compiled code has no error value:
 * where the interpreter gives an `incompatible-dimensions` error, it gives
 * `NaN`.
 */
describe('ragged lists', () => {
  const R: Value = [[1], [2, 3]];
  const S: Value = [[4], [5, 6]];
  // [label, factors, interpreter value, compiled value]
  const cases: Array<[string, Value[], string, unknown]> = [
    ['two ragged lists', [R, S], '[[4],[10,18]]', [[4], [10, 18]]],
    [
      'a ragged list and a matrix',
      [R, M],
      '[Error("incompatible-dimensions", "1 vs 2"),[6,12]]',
      [NaN, [6, 12]],
    ],
    [
      'a matrix and a ragged list',
      [M, R],
      '[Error("incompatible-dimensions", "2 vs 1"),[6,12]]',
      [NaN, [6, 12]],
    ],
    [
      'a ragged list and a vector',
      [R, [10, 20]],
      '[[10],[40,60]]',
      [[10], [40, 60]],
    ],
    [
      'a list that mixes numbers and lists, and a matrix',
      [[[1, 2], 3], M],
      '[[1,4],[9,12]]',
      [
        [1, 4],
        [9, 12],
      ],
    ],
    [
      'the matrices beside a ragged list are multiplied first',
      [R, M, Q],
      '[Error("incompatible-dimensions", "1 vs 2"),[8,9]]',
      [NaN, [8, 9]],
    ],
    [
      'a vector and a matrix beside a ragged list',
      [R, [1, 2], M],
      '[[7],[20,30]]',
      [[7], [20, 30]],
    ],
    [
      'a pair of matrices inside ragged lists',
      [
        [M, [5]],
        [Q, [2]],
      ],
      '[[[2,1],[4,3]],[10]]',
      [
        [
          [2, 1],
          [4, 3],
        ],
        [10],
      ],
    ],
    [
      'ragged lists of different lengths',
      [R, [[1], [2, 3], [4]]],
      'Error("incompatible-dimensions", "2 vs 3")',
      NaN,
    ],
    [
      'tensors of rank 3 inside ragged lists',
      [
        [[M, M], [1]],
        [[Q, Q], [2]],
      ],
      '[[[[2,1],[4,3]],[[2,1],[4,3]]],[2]]',
      [
        [
          [
            [2, 1],
            [4, 3],
          ],
          [
            [2, 1],
            [4, 3],
          ],
        ],
        [2],
      ],
    ],
    [
      'an empty list beside a matrix and a ragged list',
      [M, [[], []], []],
      'Error("incompatible-dimensions", "2 vs 0")',
      NaN,
    ],
    [
      'a matrix times a vector of the wrong length',
      [M, [1, 2, 3]],
      'Error("incompatible-dimensions", "2 vs 3")',
      NaN,
    ],
    [
      'a ragged list beside a product whose dimensions do not agree',
      [R, M, [1, 2, 3]],
      'Error("incompatible-dimensions", "2 vs 3")',
      NaN,
    ],
    [
      'an empty level',
      [[[], []], M],
      '[Error("incompatible-dimensions", "0 vs 2"),Error("incompatible-dimensions", "0 vs 2")]',
      [NaN, NaN],
    ],
  ];

  it.each(cases)('%s: the interpreter', (_, factors, value) => {
    const ce = new ComputeEngine();
    const names = factors.map((_, i) => `f${i}`);
    factors.forEach((f, i) => {
      ce.declare(names[i], 'list<unknown>');
      ce.assign(names[i], ce.box(toMathJson(f)));
    });
    expect(
      ce
        .box(['Multiply', ...names])
        .evaluate()
        .toString()
    ).toBe(value);
  });

  it.each(cases)('%s: compiled code', (_, factors, __, value) => {
    const ce = new ComputeEngine();
    const names = factors.map((_, i) => `f${i}`);
    for (const n of names) ce.declare(n, 'list<list<number>>');
    const r = compile(ce.box(['Multiply', ...names]), {
      to: 'javascript',
      fallback: false,
    });
    const inputs = Object.fromEntries(names.map((n, i) => [n, factors[i]]));
    expect(r.run!(inputs as never)).toEqual(value);
  });

  it('a number scales each pair', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<list<number>>');
    ce.declare('q', 'list<list<number>>');
    const r = compile(ce.box(['Multiply', 2, 'p', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!({ p: R, q: S } as never)).toEqual([[8], [20, 36]]);
  });

  it('a complex entry takes the complex product', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'list<list<number>>');
    ce.declare('q', 'list<list<number>>');
    const r = compile(ce.box(['Multiply', 'p', 'q']), {
      to: 'javascript',
      fallback: false,
    });
    expect(
      r.run!({
        p: R,
        q: [
          { re: 1, im: 1 },
          { re: 2, im: 1 },
        ],
      } as never)
    ).toEqual([
      [{ re: 1, im: 1 }],
      [
        { re: 4, im: 2 },
        { re: 6, im: 3 },
      ],
    ]);
  });

  it('Product of a list of ragged lists, interpreted and compiled', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    ce.assign('L', ce.box(toMathJson([R, S])));
    const product = ce.box(['Product', 'L']);
    expect(product.evaluate().toString()).toBe('[[4],[10,18]]');
    const r = compile(product, { to: 'javascript', fallback: false });
    expect(r.run!({} as never)).toEqual([[4], [10, 18]]);
  });

  // The elements of this list are typed `list<matrix<integer^(2x2)> |
  // vector<integer^1>>`. The callback check of `Reduce` refused `Multiply`
  // for them, and `Product(L)` was an `incompatible-type` error
  // (ROADMAP CE-98.2).
  it('Product of a list of ragged lists that hold matrices', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    ce.assign(
      'L',
      ce.box(
        toMathJson([
          [M, [5]],
          [Q, [2]],
        ])
      )
    );
    const product = ce.box(['Product', 'L']);
    expect(product.toString()).toBe('Reduce(L, "Multiply", 1)');
    expect(product.evaluate().toString()).toBe('[[[2,1],[4,3]],[10]]');
    const r = compile(product, { to: 'javascript', fallback: false });
    expect(r.run!({} as never)).toEqual([
      [
        [2, 1],
        [4, 3],
      ],
      [10],
    ]);
    const map = ce.box(['Map', 'Negate', 'L']);
    expect(map.evaluate().toString()).toBe(
      '[[[[-1,-2],[-3,-4]],[-5]],[[[0,-1],[-1,0]],[-2]]]'
    );
  });
});

describe('a compiled Product of tensors of rank 3', () => {
  it('is the matrix product of each pair of matrices', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    ce.assign(
      'L',
      ce.box(
        toMathJson([
          [M, M],
          [Q, Q],
        ])
      )
    );
    const product = ce.box(['Product', 'L']);
    const MQ2 = [
      [2, 1],
      [4, 3],
    ];
    expect(product.evaluate().toString()).toBe('[[[2,1],[4,3]],[[2,1],[4,3]]]');
    const r = compile(product, { to: 'javascript', fallback: false });
    expect(r.run!({} as never)).toEqual([MQ2, MQ2]);
  });
});
