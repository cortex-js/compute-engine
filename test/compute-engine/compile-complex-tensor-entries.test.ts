/**
 * Complex entries inside compiled arrays.
 *
 * The collection form of `Sum`/`Product` whose elements are points, rows or
 * matrices folds with an element-wise helper. There was one, real-only form
 * (`_SYS.add`, `_SYS.mul`: the raw `+` and `*`), so the sum of the points
 * `[(1+i, 2), (3+i, 4)]` was `["0[object Object][object Object]", 6]`, and
 * a product of complex rows or matrices had `NaN` entries, behind
 * `success: true`. The compiler now chooses the form from the lane of the
 * operand, as for the other linear-algebra helpers: the real-only
 * `_SYS.add`/`_SYS.mul`, the complex `_SYS.cadd`/`_SYS.cmul` (every entry
 * `{re, im}`), or, when the shape is known only at run time, the
 * dispatching `_SYS.addAny`/`_SYS.mulAny`.
 *
 * The compiler also read a sum of REAL points as complex-valued, so a
 * parent read each coordinate as `{re, im}`; and `Product` of a list of
 * matrices was typed `number`. Both are fixed. A `Multiply` of complex rows
 * or matrices read with `At`, and a complex parent over such a fold, refuse
 * to compile, as the other complex operands of those routes do.
 *
 * Each case is compiled without a fallback and compared with the
 * interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type C = { re: number; im: number };
const c = (re: number, im: number): C => ({ re, im });

/** The MathJSON of a run-time value; `tuples` spells the rows as points. */
function toJson(v: unknown, tuples = false, depth = 0): unknown {
  if (Array.isArray(v))
    return [
      tuples && depth === 1 ? 'Tuple' : 'List',
      ...v.map((x) => toJson(x, tuples, depth + 1)),
    ];
  if (typeof v === 'object' && v !== null)
    return ['Complex', (v as C).re, (v as C).im];
  return v;
}

/** The compiled value and the interpreter's value as a string. The result
 * conversion of the compiled function (not this helper) returns an exactly
 * real `{re, im: 0}` as a number. */
function both(type: string, expr: unknown, value: unknown) {
  const ce = new ComputeEngine();
  ce.declare('P', type);
  const r = compile(ce.box(expr as any), { fallback: false });
  expect(r.success).toBe(true);
  const ce2 = new ComputeEngine();
  ce2.assign('P', ce2.box(toJson(value, type.includes('tuple')) as any));
  return {
    compiled: r.run!({ P: value }),
    evaluated: ce2
      .box(expr as any)
      .evaluate()
      .toString(),
  };
}

const ROWS = [
  [c(1, 1), 2],
  [c(3, 1), 4],
];

describe('COMPLEX ENTRIES IN COMPILED ARRAYS', () => {
  test('Sum of points with complex coordinates', () => {
    const { compiled, evaluated } = both(
      'list<tuple<complex, complex>>',
      ['Sum', 'P'],
      ROWS
    );
    expect(compiled).toEqual([c(4, 2), 6]);
    expect(evaluated).toBe('((4 + 2i), 6)');
  });

  test('Sum of complex rows', () => {
    const { compiled, evaluated } = both(
      'list<list<complex>>',
      ['Sum', 'P'],
      ROWS
    );
    expect(compiled).toEqual([c(4, 2), 6]);
    expect(evaluated).toBe('[(4 + 2i),6]');
  });

  test('Product of complex rows (element by element)', () => {
    const { compiled, evaluated } = both(
      'list<list<complex>>',
      ['Product', 'P'],
      ROWS
    );
    expect(compiled).toEqual([c(2, 4), 8]);
    expect(evaluated).toBe('[(2 + 4i),8]');
  });

  test('Product of complex matrices uses the complex matrix product', () => {
    const I = [
      [c(0, 1), 0],
      [0, 1],
    ];
    const { compiled, evaluated } = both(
      'list<matrix<complex^2x2>>',
      ['Product', 'P'],
      [I, I]
    );
    expect(compiled).toEqual([
      [-1, 0],
      [0, 1],
    ]);
    expect(evaluated).toBe('[[-1,0],[0,1]]');
  });

  test('Product of real matrices is unchanged', () => {
    const { compiled, evaluated } = both(
      'list<matrix<real^2x2>>',
      ['Product', 'P'],
      [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [0, 1],
          [1, 0],
        ],
      ]
    );
    expect(compiled).toEqual([
      [2, 1],
      [4, 3],
    ]);
    expect(evaluated).toBe('[[2,1],[4,3]]');
  });

  test('Sum of complex values from a function typed unknown', () => {
    // The element type is known only at run time.
    const ce = new ComputeEngine();
    ce.declare('h', '(number) -> unknown');
    ce.declare('t', 'number');
    const r = compile(ce.box(['Sum', ['h', 't']]), {
      fallback: false,
      // The function is serialized into the compiled code, so it cannot
      // read a variable of this file.
      functions: {
        h: () => [
          [{ re: 1, im: 1 }, 2],
          [{ re: 3, im: 1 }, 4],
        ],
      },
    } as any);
    expect(r.run!({ t: 1 })).toEqual([c(4, 2), 6]);
  });

  test('Multiply of complex rows or matrices read with At refuses to compile', () => {
    // This route refuses complex operands, but its test missed an operand
    // typed with an absent arm (`At(P, 1)`): it compiled the real product,
    // and the complex entries became `NaN`.
    const ce = new ComputeEngine();
    for (const type of ['list<matrix<complex^2x2>>', 'list<list<complex>>']) {
      ce.declare(`P${type.length}`, type);
      expect(() =>
        compile(
          ce.box([
            'Multiply',
            ['At', `P${type.length}`, 1],
            ['At', `P${type.length}`, 2],
          ]),
          { fallback: false }
        )
      ).toThrow(/Could not compile `Multiply`/);
    }
    ce.declare('Q', 'list<matrix<real^2x2>>');
    expect(
      compile(ce.box(['Multiply', ['At', 'Q', 1], ['At', 'Q', 2]]), {
        fallback: false,
      }).run!({
        Q: [
          [
            [1, 2],
            [3, 4],
          ],
          [
            [1, 0],
            [0, 1],
          ],
        ],
      })
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('A PARENT EXPRESSION OVER A FOLD OF POINTS, ROWS OR MATRICES', () => {
  // The compiler read a sum of REAL points as complex-valued, and the parent
  // read each coordinate as `{re, im}`: `Sum(P) + (1, 1)` gave `NaN`
  // coordinates. `Product` of a list of matrices was typed `number`, and
  // `Product(Q) + 1` was compiled as the sum of two numbers.
  test.each([
    [
      'real points',
      'list<tuple<real, real>>',
      ['Add', ['Sum', 'P'], ['Tuple', 1, 1]],
      [
        [1, 2],
        [3, 4],
      ],
      [5, 7],
      '(5, 7)',
    ],
    [
      'complex points',
      'list<tuple<complex, complex>>',
      ['Add', ['Sum', 'P'], ['Tuple', 1, 1]],
      ROWS,
      [c(5, 2), 7],
      '((5 + 2i), 7)',
    ],
    [
      'real matrices',
      'list<matrix<real^2x2>>',
      ['Add', ['Product', 'P'], 1],
      [
        [
          [1, 2],
          [3, 4],
        ],
        [
          [0, 1],
          [1, 0],
        ],
      ],
      [
        [3, 2],
        [5, 4],
      ],
      '[[3,2],[5,4]]',
    ],
    [
      'real rows',
      'list<list<real>>',
      ['Multiply', ['Sum', 'P'], 2],
      [
        [1, 2],
        [3, 4],
      ],
      [8, 12],
      '[8,12]',
    ],
  ])('%s', (_, type, expr, value, compiled, evaluated) => {
    const r = both(type as string, expr, value);
    expect(r.compiled).toEqual(compiled);
    expect(r.evaluated).toBe(evaluated);
  });

  test('a complex parent over complex rows or matrices refuses to compile', () => {
    for (const [type, expr] of [
      ['list<matrix<complex^2x2>>', ['Add', ['Product', 'P'], 1]],
      ['list<list<complex>>', ['Multiply', ['Sum', 'P'], 2]],
    ] as const) {
      const ce = new ComputeEngine();
      ce.declare('P', type);
      expect(() => compile(ce.box(expr as any), { fallback: false })).toThrow(
        /Could not compile/
      );
    }
  });

  test('Product of rows or square matrices has their shape', () => {
    const ce = new ComputeEngine();
    let count = 0;
    const typeOf = (type: string) => {
      const name = `X${(count += 1)}`;
      ce.declare(name, type);
      return ce.box(['Product', name]).type.toString();
    };
    expect(typeOf('list<matrix<real^2x2>>')).toBe(
      'integer | matrix<real^(2x2)>'
    );
    expect(typeOf('list<list<integer>>')).toBe('integer | list<integer>');
    expect(typeOf('matrix<integer^2x3>')).toBe('vector<integer^3>');
    // The product of two points is an error, and two matrices that are not
    // square do not multiply: the type stays `number`.
    expect(typeOf('list<tuple<real, real>>')).toBe('number');
    expect(typeOf('list<matrix<integer^2x3>>')).toBe('number');
  });
});

describe('FOLDS WHOSE SHAPE THE TYPE DID NOT GIVE', () => {
  const M = [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [0, 1],
      [1, 0],
    ],
  ];
  const run = (type: string, expr: unknown, value: unknown): unknown => {
    const ce = new ComputeEngine();
    ce.declare('P', type);
    return compile(ce.box(expr as any), { fallback: false }).run!({
      P: value,
    });
  };

  test('matrices with no dimensions, and an abstract collection', () => {
    // The type was `number`, and a parent read the matrix as one number
    // (a raw `+` over an array gave a string).
    expect(run('list<matrix<real>>', ['Add', ['Product', 'P'], 1], M)).toEqual([
      [3, 2],
      [5, 4],
    ]);
    expect(run('list<matrix<real>>', ['Add', ['Sum', 'P'], 1], M)).toEqual([
      [2, 4],
      [5, 5],
    ]);
    expect(
      run('collection<matrix<real^2x2>>', ['Add', ['Product', 'P'], 1], M)
    ).toEqual([
      [3, 2],
      [5, 4],
    ]);
  });

  test('Product of matrices that are not square refuses to compile', () => {
    expect(() =>
      run('list<matrix<integer^2x3>>', ['Product', 'P'], [])
    ).toThrow(/the shape of the result is not known/);
  });

  test('a scalar times a sum of points refuses to compile', () => {
    // The scalar code `2 * <array>` ran to NaN.
    for (const type of [
      'list<tuple<real, real>>',
      'list<tuple<complex, complex>>',
    ])
      expect(() => run(type, ['Multiply', ['Sum', 'P'], 2], [])).toThrow(
        /Could not compile `Multiply`/
      );
  });

  test('Sum and Product of elements that are numbers or lists', () => {
    // The scalar fold read two list elements as numbers and gave NaN.
    const type = 'list<broadcastable<real>>';
    expect(
      run(
        type,
        ['Sum', 'P'],
        [
          [1, 2],
          [3, 4],
        ]
      )
    ).toEqual([4, 6]);
    expect(run(type, ['Sum', 'P'], [1, 2])).toBe(3);
    expect(
      run(
        type,
        ['Product', 'P'],
        [
          [1, 2],
          [3, 4],
        ]
      )
    ).toEqual([3, 8]);
    const ce = new ComputeEngine();
    ce.declare('P', type);
    expect(ce.box(['Sum', 'P']).type.toString()).toBe('broadcastable<real>');
  });

  test('one matrix of unknown size sums and multiplies its rows', () => {
    // The shaped type now reads an unknown first dimension (the matrix may
    // have no rows, so the type is a union with `integer`).
    const m = [
      [1, 2],
      [3, 4],
    ];
    expect(run('matrix<real>', ['Sum', 'P'], m)).toEqual([4, 6]);
    expect(run('matrix<real>', ['Product', 'P'], m)).toEqual([3, 8]);
    expect(run('matrix<real>', ['Add', ['Sum', 'P'], 1], m)).toEqual([5, 7]);
  });

  test('elements that are abstract collections refuse to compile', () => {
    // The scalar fold gave NaN for `[[1, 2], [3, 4]]`.
    expect(() => run('list<collection<real>>', ['Sum', 'P'], [])).toThrow(
      /whose shape is not known/
    );
  });
});

describe('SUM AND PRODUCT WITH NO OPERAND', () => {
  test('the operand is reported missing', () => {
    // `canonicalBigop` read the engine of an undefined operand and threw.
    const ce = new ComputeEngine();
    expect(ce.box(['Sum']).toString()).toBe('sum(Error("missing"))');
    expect(ce.box(['Product']).toString()).toBe('prod(Error("missing"))');
  });
});
