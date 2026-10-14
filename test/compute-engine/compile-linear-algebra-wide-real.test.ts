import { ComputeEngine, compile } from '../../src/compute-engine';

// A linear-algebra operand whose type does not say whether its entries are
// real or complex (`matrix<number>`, `vector<number>`, an undeclared
// collection symbol) is READ AS REAL on the JavaScript target in `strict` and
// `auto` mode (user decision of 2026-09-24, option B), as a `number`-typed
// scalar is. `mode: 'complex'` reads it as complex. A `complex` entry type
// keeps the complex lane in every mode.
//
// The compiled runner does not read the entries of a collection-valued
// binding when it is called: `run()` requires inputs of the shape the
// compiled code reads. A `{re, im}` entry of a collection read on the real
// lane is not refused; the real helper computes with it as plain JavaScript
// would, and the result is not specified (the tests pin only that the call
// does not throw). A caller with complex entries declares the symbol
// `matrix<complex>` or compiles with `mode: 'complex'`. The runner walked every entry on each call until the
// user's decision of 2026-10-13, which removed the walk because its cost grew
// with the data (Tycho ledger row 371 was the motivating case: a kernel
// called a million times with a 9 801-element list input). See "inputs of
// the shape" in `docs/COMPILATION-MODEL.md`.
//
// (`Trace(M)` over an undeclared `M` is not listed: the use infers
// `M: number | list<number>`, which may be a scalar, and `Trace` declines a
// possibly-scalar operand for that reason, whatever its lane.)

const MODES = ['strict', 'auto'] as const;

function js(expr: any, mode: string = 'auto'): any {
  return compile(expr, { to: 'javascript', mode, fallback: false } as any);
}

/** The interpreter's value of `expr` with the symbols of `vars` replaced by
 * the real values of `vars`, as plain JavaScript numbers and arrays. */
function interpreted(ce: ComputeEngine, expr: any, vars: Record<string, any>) {
  const box = (v: any): any => (Array.isArray(v) ? ['List', ...v.map(box)] : v);
  const subs: Record<string, any> = {};
  for (const [k, v] of Object.entries(vars)) subs[k] = ce.box(box(v));
  const value = expr.subs(subs).N();
  const unbox = (x: any): any =>
    x.operator === 'List' ? x.ops.map(unbox) : x.re;
  return unbox(value);
}

function expectClose(actual: any, expected: any): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect(actual.length).toBe(expected.length);
    expected.forEach((e: any, k: number) => expectClose(actual[k], e));
    return;
  }
  expect(typeof actual).toBe('number');
  expect(actual).toBeCloseTo(expected, 9);
}

describe('AN UNDECLARED COLLECTION OPERAND IS READ AS REAL', () => {
  const CASES: Array<[string, (ce: ComputeEngine) => any, any]> = [
    [
      '\\det(M)',
      (ce) => ce.parse('\\det(M)'),
      {
        M: [
          [2, 1],
          [1, 3],
        ],
      },
    ],
    [
      '\\det(M) + 1',
      (ce) => ce.parse('\\det(M) + 1'),
      {
        M: [
          [2, 1],
          [1, 3],
        ],
      },
    ],
    [
      'Cross(u, v)',
      (ce) => ce.box(['Cross', 'u', 'v']),
      { u: [1, 2, 3], v: [4, 5, 6] },
    ],
    [
      'Dot(u, v)',
      (ce) => ce.box(['Dot', 'u', 'v']),
      { u: [1, 2, 3], v: [4, -5, 6] },
    ],
    [
      'Inverse(M)',
      (ce) => ce.box(['Inverse', 'M']),
      {
        M: [
          [2, 1],
          [1, 3],
        ],
      },
    ],
  ];
  for (const [name, build, vars] of CASES)
    for (const mode of MODES)
      it(`${mode}: ${name} compiles and answers the interpreter's value`, () => {
        const ce = new ComputeEngine();
        const expr = build(ce);
        const result = js(expr, mode);
        expect(result.success).toBe(true);
        expect(result.code).not.toMatch(/_SYS\.complex/);
        expectClose(result.run(vars), interpreted(ce, expr, vars));
      });

  // The interpreter has no reduced row echelon form of a complex matrix, so
  // before the decision `RowReduce` over a wide operand compiled in no mode.
  for (const mode of MODES)
    it(`${mode}: RowReduce(M) over an undeclared M`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box(['RowReduce', 'M']);
      const result = js(expr, mode);
      expect(result.code).toBe('_SYS.rref(_.M)');
      const M = [
        [2, 1],
        [1, 1],
      ];
      expect(interpreted(ce, expr, { M })).toEqual([
        [1, 0],
        [0, 1],
      ]);
      expect(result.run({ M })).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });

  it('an undeclared operand bound to a complex entry is not refused', () => {
    // The runner does not read the entries; the value the real helper
    // computes with the complex entry is not specified.
    const ce = new ComputeEngine();
    const result = js(ce.parse('\\det(M)'));
    expect(() =>
      result.run({
        M: [
          [2, 1],
          [1, { re: 0, im: 1 }],
        ],
      })
    ).not.toThrow();
  });
});

// A collection read on the real lane is passed to the compiled code as it
// is: the runner does not read its entries and does not copy a typed array
// into a plain array (a typed array bound to the collection itself is
// refused; a typed-array row is an entry, and is not read). Until the user's
// decision of 2026-10-13 the runner walked every entry on each call and threw
// a diagnostic that named the binding and the complex or non-numeric entry;
// the walk was removed because its cost grew with the data (Tycho ledger row
// 371). The caller now supplies plain arrays with real entries, or declares
// the entries `complex`. The checks that stay are constant per binding; the
// one tested here is that a `{re, im}` object bound to a real SCALAR binding
// throws.
describe('A COLLECTION READ ON THE REAL LANE IS NOT CHECKED ENTRY BY ENTRY', () => {
  const COMPLEX_M = [
    [2, 1],
    [1, { re: 0, im: 1 }],
  ];
  for (const type of ['matrix<real>', 'matrix<number>'])
    for (const mode of MODES)
      it(`${mode}: det(M) + 1, M: ${type}, with a complex entry is not refused`, () => {
        const ce = new ComputeEngine();
        ce.declare('M', type);
        const result = js(ce.parse('\\det(M) + 1'), mode);
        expect(result.code).toBe('_SYS.det(_.M) + 1');
        expect(
          result.run({
            M: [
              [2, 1],
              [1, 3],
            ],
          })
        ).toBe(6);
        // The runner does not read the entries: the value the real helper
        // computes with the complex entry is not specified.
        expect(() => result.run({ M: COMPLEX_M })).not.toThrow();
      });

  it('complex: det(M) + 1 over matrix<number> computes with complex entries', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<number>');
    const expr = ce.parse('\\det(M) + 1');
    const result = js(expr, 'complex');
    expect(result.code).toContain('_SYS.complexDet(_.M)');
    // det [[2, 1], [1, i]] + 1 = 2i − 1 + 1 = 2i
    const expected = expr
      .subs({ M: ce.parse('[[2, 1], [1, \\imaginaryI]]') })
      .N();
    expect([expected.re, expected.im]).toEqual([0, 2]);
    expect(result.run({ M: COMPLEX_M })).toEqual({ re: 0, im: 2 });
  });

  it('a matrix<complex> symbol keeps the complex lane in every mode', () => {
    for (const mode of [...MODES, 'complex']) {
      const ce = new ComputeEngine();
      ce.declare('M', 'matrix<complex>');
      const result = js(ce.parse('\\det(M) + 1'), mode);
      expect(result.code).toContain('_SYS.complexDet(_.M)');
      expect(result.run({ M: COMPLEX_M })).toEqual({ re: 0, im: 2 });
    }
  });

  // The same holds outside the linear-algebra heads: an element read of a
  // `number`-typed list added to 1 computes with the complex object as plain
  // JavaScript would, and the result is not specified.
  it('At(L, 1) + 1 over a list<number> bound to a complex entry is not refused', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 1], 1]));
    expect(result.run({ L: [2, 3] })).toBe(3);
    expect(() => result.run({ L: [{ re: 1, im: 2 }, 3] })).not.toThrow();
  });

  it('a list<number> entry that the code does not read has no effect, whatever it holds', () => {
    // The runner does not read the entries, so a string or an absent entry
    // that the compiled code does not read changes nothing.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 2], 1]));
    expect(result.run({ L: ['a', 2] })).toBe(3);
    expect(result.run({ L: [undefined, 2] })).toBe(3);
  });

  it('a typed parameter of a function literal is not checked either', () => {
    const ce = new ComputeEngine();
    const result = js(
      ce.box([
        'Function',
        ['Determinant', 'M'],
        ['Typed', 'M', { str: 'matrix<number>' }],
      ] as any)
    );
    expect(
      result.run([
        [2, 1],
        [1, 3],
      ])
    ).toBe(5);
    expect(() => result.run(COMPLEX_M)).not.toThrow();
  });

  it('an untyped parameter is read as real from its inferred type, on both routes', () => {
    // `(M) ↦ det(M)` infers `M: matrix` from the body, which reads it with
    // the real `det` helper: a complex entry is not refused, as for an
    // annotated parameter, and the result is not specified.
    const ce = new ComputeEngine();
    for (const f of [
      js(ce.parse('(M) \\mapsto \\det(M)')),
      js(ce.box(['Function', ['Determinant', 'M'], 'M'] as any)),
    ]) {
      expect(
        f.run([
          [2, 1],
          [1, 3],
        ])
      ).toBe(5);
      expect(() => f.run(COMPLEX_M)).not.toThrow();
    }
    // A scalar parameter with a real value is not affected.
    expect(js(ce.parse('(x) \\mapsto x+1')).run(2)).toBe(3);
  });

  it('typed-array rows are not copied to plain arrays at entry', () => {
    // The compiled code reads plain arrays only. A `Float64Array` row reads
    // as a non-array and the result is not the determinant: the host converts
    // a typed array to a plain `Array` once, on its side.
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<real>');
    const det = js(ce.parse('\\det(M)'));
    expect(
      det.run({
        M: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBe(-2);
    const M = [new Float64Array([1, 2]), new Float64Array([3, 4])];
    let value: any;
    expect(() => {
      value = det.run({ M });
    }).not.toThrow();
    expect(value).not.toBe(-2);
    // The caller's value is not changed.
    expect(M[0]).toBeInstanceOf(Float64Array);
    const f = js(ce.parse('(A: matrix<real>) \\mapsto \\det(A)'));
    const g = js(ce.parse('(A) \\mapsto \\det(A)'));
    for (const h of [f, g]) {
      expect(
        h.run([
          [1, 2],
          [3, 4],
        ])
      ).toBe(-2);
      expect(() => {
        value = h.run([new Float64Array([1, 2]), new Float64Array([3, 4])]);
      }).not.toThrow();
      expect(value).not.toBe(-2);
    }
  });

  it('a complex value bound to a real scalar is refused; entryChecks: false turns that off', () => {
    // The check that stays costs one `typeof` per binding: a `{re, im}`
    // object bound to a binding read as a real scalar throws.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(() => js(ce.parse('x + 1')).run({ x: { re: 0, im: 1 } })).toThrow(
      /"x" was compiled as a real number but received a complex \{re, im\} value/
    );
    const result = compile(ce.parse('x + 1'), {
      to: 'javascript',
      fallback: false,
      entryChecks: false,
    } as any) as any;
    let value: any;
    expect(() => {
      value = result.run({ x: { re: 0, im: 1 } });
    }).not.toThrow();
    expect(typeof value).not.toBe('number');
  });
});
