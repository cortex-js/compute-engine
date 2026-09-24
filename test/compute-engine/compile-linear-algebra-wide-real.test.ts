import { ComputeEngine, compile } from '../../src/compute-engine';

// A linear-algebra operand whose type does not say whether its entries are
// real or complex (`matrix<number>`, `vector<number>`, an undeclared
// collection symbol) is READ AS REAL on the JavaScript target in `strict` and
// `auto` mode (user decision of 2026-09-24, option B), as a `number`-typed
// scalar is. `mode: 'complex'` reads it as complex. A `complex` entry type
// keeps the complex lane in every mode.
//
// The compiled runner checks the entries of each collection-valued binding
// read on the real lane when it is called, for `number`- and `real`-typed
// entries alike, so a `{re, im}` entry throws a diagnostic that names the
// binding and the entry, instead of giving `NaN`, `null` or the string
// `"[object Object]1"`.
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

  it('an undeclared operand bound to a complex entry throws the entry diagnostic', () => {
    const ce = new ComputeEngine();
    const result = js(ce.parse('\\det(M)'));
    expect(() =>
      result.run({
        M: [
          [2, 1],
          [1, { re: 0, im: 1 }],
        ],
      })
    ).toThrow(
      /"M" \(type `matrix<number>`\) was compiled with real entries, but its entry \[1\]\[1\] is a complex \{re, im\} value/
    );
  });
});

describe('THE ENTRY CHECK OF A COLLECTION READ ON THE REAL LANE', () => {
  const COMPLEX_M = [
    [2, 1],
    [1, { re: 0, im: 1 }],
  ];
  for (const type of ['matrix<real>', 'matrix<number>'])
    for (const mode of MODES)
      it(`${mode}: det(M) + 1, M: ${type}, with a complex entry throws`, () => {
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
        // Before the entry check, the real helper read the complex entry as
        // NaN, and the runner answered NaN (`matrix<real>`).
        expect(() => result.run({ M: COMPLEX_M })).toThrow(
          new RegExp(
            `"M" \\(type \`${type}\`\\) was compiled with real entries, but its entry \\[1\\]\\[1\\] is a complex \\{re, im\\} value`
          )
        );
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

  // The check is not limited to the linear-algebra heads: an element read of
  // a `number`-typed list added to 1 returned the string `"[object Object]1"`.
  it('At(L, 1) + 1 over a list<number> bound to a complex entry throws', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 1], 1]));
    expect(result.run({ L: [2, 3] })).toBe(3);
    expect(() => result.run({ L: [{ re: 1, im: 2 }, 3] })).toThrow(
      /"L" \(type `list<number>`\) was compiled with real entries, but its entry \[0\] is a complex/
    );
  });

  it('a list<number> entry that is not a number throws; an absent entry does not', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 2], 1]));
    expect(() => result.run({ L: ['a', 2] })).toThrow(
      /"L" \(type `list<number>`\) was compiled with number entries, but its entry \[0\] is a string, not a number/
    );
    expect(result.run({ L: [undefined, 2] })).toBe(3);
  });

  it('a typed parameter of a function literal is checked too', () => {
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
    expect(() => result.run(COMPLEX_M)).toThrow(
      /argument 1 \(type `matrix<number>`\) was compiled with real entries, but its entry \[1\]\[1\] is a complex/
    );
  });

  it('an untyped parameter is checked from its inferred type, on both routes', () => {
    // `(M) ↦ det(M)` infers `M: matrix` from the body, which reads it with
    // the real `det` helper: a complex entry throws as it does for an
    // annotated parameter, instead of giving NaN.
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
      expect(() => f.run(COMPLEX_M)).toThrow(
        /argument 1 \(type `matrix<number>`\) was compiled with real entries, but its entry \[1\]\[1\] is a complex/
      );
    }
    // A scalar parameter has no entries to check.
    expect(js(ce.parse('(x) \\mapsto x+1')).run(2)).toBe(3);
  });

  it('typed-array rows are copied to plain arrays at entry', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<real>');
    const det = js(ce.parse('\\det(M)'));
    const M = [new Float64Array([1, 2]), new Float64Array([3, 4])];
    expect(det.run({ M })).toBe(-2);
    // The caller's value is not changed.
    expect(M[0]).toBeInstanceOf(Float64Array);
    const f = js(ce.parse('(A: matrix<real>) \\mapsto \\det(A)'));
    expect(f.run([new Float64Array([1, 2]), new Float64Array([3, 4])])).toBe(
      -2
    );
    const g = js(ce.parse('(A) \\mapsto \\det(A)'));
    expect(g.run([new Float64Array([1, 2]), new Float64Array([3, 4])])).toBe(
      -2
    );
  });

  it('an array nested deeper than the declared type is walked, not refused', () => {
    // A declared type constrains what the engine assigns, never what a caller
    // supplies: a caller may pass a matrix where a point was declared, and the
    // compiled code hands the value to the run-time helper (pinned in
    // compile-static-point-components.test.ts). The entry check therefore
    // walks into an array at any depth and refuses only a complex entry.
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<real>');
    const det = js(ce.parse('\\det(M)'));
    expect(() =>
      det.run({
        M: [
          [[1], 2],
          [3, 4],
        ],
      })
    ).not.toThrow();
    expect(() =>
      det.run({
        M: [
          [[{ re: 1, im: 1 }], 2],
          [3, 4],
        ],
      })
    ).toThrow(/its entry \[0\]\[0\]\[0\] is a complex \{re, im\} value/);
  });

  it('entryChecks: false turns the check off', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<number>');
    const result = compile(ce.parse('\\det(M)'), {
      to: 'javascript',
      fallback: false,
      entryChecks: false,
    } as any) as any;
    expect(result.run({ M: COMPLEX_M })).toBeNaN();
  });
});
