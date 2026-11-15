import { ComputeEngine, compile } from '../../src/compute-engine';

// The lane of a linear-algebra head (`BaseCompiler.linearAlgebraLane`) selects
// the helper a target emits for it (a real one, or one that computes with
// complex entries) and is also the answer a parent expression reads for the
// value of the node. These tests check that every route agrees with that
// lane.

const MODES = ['strict', 'complex'] as const;

function js(expr: any, mode: string): any {
  return compile(expr, { to: 'javascript', mode, fallback: false } as any);
}

/** The value `v` as `[re, im]`: a number, a `{re, im}` object or a boxed
 * number. */
function parts(v: any): [number, number] {
  if (typeof v === 'number') return [v, 0];
  return [v.re, v.im];
}

function expectValue(actual: any, expected: any): void {
  const [re, im] = parts(actual);
  const [eRe, eIm] = parts(expected);
  expect(re).toBeCloseTo(eRe, 9);
  expect(im).toBeCloseTo(eIm, 9);
}

describe('THE WRITTEN-OUT INNER PRODUCT FOLLOWS THE LANE OF ITS OPERANDS', () => {
  // `Dot(p, q)` of two points of one static width was written out as the
  // real sum `p[0] * q[0] + p[1] * q[1]` whenever no operand was complex by
  // its TYPE. Under `mode: 'complex'` a `tuple<number, number>` symbol is
  // complex, and the parent read the node as complex: the real sum of two
  // `{re, im}` objects was NaN, and `Dot(p, q) + 1` answered `null`.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('p', 'tuple<number, number>');
    ce.declare('q', 'tuple<number, number>');
    return ce;
  }
  const I = { re: 0, im: 1 };
  const ROUTES: Array<[string, (ce: ComputeEngine) => any]> = [
    ['parse', (ce) => ce.parse('\\operatorname{Dot}(p, q) + 1')],
    ['box', (ce) => ce.box(['Add', ['Dot', 'p', 'q'], 1])],
  ];
  for (const [route, build] of ROUTES) {
    it(`complex, ${route} route: Dot(p, q) + 1 at p = q = (i, 1)`, () => {
      const ce = engine();
      const expr = build(ce);
      const result = js(expr, 'complex');
      expect(result.code).toContain('_SYS.complexMatmul(');
      const expected = expr
        .subs({
          p: ce.parse('(\\imaginaryI, 1)'),
          q: ce.parse('(\\imaginaryI, 1)'),
        })
        .N();
      // i·i + 1·1 + 1 = 1
      expect(parts(expected)).toEqual([1, 0]);
      expectValue(result.run({ p: [I, 1], q: [I, 1] }), expected);
    });

    // In `strict` mode a `number` coordinate is read as a real number, as a
    // scalar `number` symbol is, and the written-out sum is kept.
    for (const mode of ['strict'] as const)
      it(`${mode}, ${route} route: Dot(p, q) + 1 is written out`, () => {
        const result = js(build(engine()), mode);
        expect(result.code).not.toContain('_SYS.complexMatmul(');
        expect(result.code).toContain('_.p[0] * _.q[0]');
        expect(result.run({ p: [2, 1], q: [3, 1] })).toBe(8);
      });
  }
});

describe('A SIGNED INFINITY IS A REAL ENTRY', () => {
  // `Floor(x)` types `integer | signed_infinity`. The infinite members of a
  // union entry type made the entry wide, and a `Determinant` over such a
  // matrix declined in `strict` mode.
  for (const mode of MODES)
    it(`${mode}: Determinant(M) + 1 over a matrix<integer | +oo> symbol`, () => {
      const ce = new ComputeEngine();
      ce.declare('M', 'matrix<integer | +oo>');
      const result = js(ce.box(['Add', ['Determinant', 'M'], 1]), mode);
      expect(result.code).toBe('_SYS.det(_.M) + 1');
      expect(
        result.run({
          M: [
            [1, 2],
            [3, 4],
          ],
        })
      ).toBe(-1);
    });
});

describe('A USER FUNCTION THAT RETURNS A MATRIX', () => {
  // `f: (real) -> matrix<real>`. The stored literal does not carry the
  // declared type of its scalar parameter, so `mode: 'complex'` read `t` as
  // wide, hence complex, and emitted `[[_SYS.cplx(t), 1], [2, 3]]`, while a
  // parent read the call with the real lane of its declared type:
  // `_SYS.trace` added a `{re, im}` object, and the value was `null`.
  function declared(sig: string, body: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', sig);
    ce.assign('f', ce.parse(body));
    return ce;
  }
  const REAL_BODY = 't \\mapsto [[t, 1], [2, 3]]';
  const COMPLEX_BODY = 't \\mapsto [[t, \\imaginaryI], [2, 3]]';
  const ROUTES: Array<[string, string, (ce: ComputeEngine) => any]> = [
    ['parse', 'Trace(f(x))', (ce) => ce.parse('\\operatorname{Trace}(f(x))')],
    [
      'parse',
      'Determinant(f(x)) + 1',
      (ce) => ce.parse('\\operatorname{Determinant}(f(x)) + 1'),
    ],
    [
      'box',
      'Trace(f(x)) + 1',
      (ce) => ce.box(['Add', ['Trace', ['f', 'x']], 1]),
    ],
    [
      'box',
      'Determinant(f(x)) + 1',
      (ce) => ce.box(['Add', ['Determinant', ['f', 'x']], 1]),
    ],
  ];
  for (const [route, name, build] of ROUTES)
    for (const mode of MODES)
      it(`${mode}, ${route} route: ${name}, f: (real) -> matrix<real>`, () => {
        const ce = declared('(real) -> matrix<real>', REAL_BODY);
        const expr = build(ce);
        const result = js(expr, mode);
        expect(result.preamble).toContain(
          'const _fn_f = (t) => [[t, 1], [2, 3]];'
        );
        expectValue(result.run({ x: 2 }), expr.subs({ x: 2 }).N());
      });

  // A declared result type whose entries are wide (`matrix<number>`) says
  // nothing about the entries of the body: the lane of the call is the lane
  // that the definition records for the collection it returns.
  for (const mode of MODES)
    it(`${mode}: Determinant(f(x)) + 1, f: (real) -> matrix<number>, complex body`, () => {
      const ce = declared('(real) -> matrix<number>', COMPLEX_BODY);
      const expr = ce.parse('\\operatorname{Determinant}(f(x)) + 1');
      const result = js(expr, mode);
      expect(result.code).toContain('_SYS.complexDet(');
      const expected = expr.subs({ x: -2 }).N();
      // 3·(−2) − 2i + 1
      expect(parts(expected)).toEqual([-5, -2]);
      expectValue(result.run({ x: -2 }), expected);
    });

  // A complex entry under a declared `matrix<real>` contradicts the
  // declaration, as a complex scalar under `real` does: fail closed.
  for (const mode of MODES)
    it(`${mode}: f: (real) -> matrix<real> with a complex entry fails closed`, () => {
      const ce = declared('(real) -> matrix<real>', COMPLEX_BODY);
      expect(() =>
        js(ce.parse('\\operatorname{Determinant}(f(x)) + 1'), mode)
      ).toThrow(
        /Could not compile `Typed`: the value .* has a complex entry, but its ascribed type `matrix<real>` says every entry is real/s
      );
    });

  // An undeclared function whose body is a literal matrix: its entries are
  // identified from the body, on the parse and the box routes.
  const UNDECLARED: Array<[string, (ce: ComputeEngine) => void]> = [
    ['parse', (ce) => ce.assign('g', ce.parse(REAL_BODY))],
    [
      'box',
      (ce) =>
        ce.assign(
          'g',
          ce.box(['Function', ['List', ['List', 't', 1], ['List', 2, 3]], 't'])
        ),
    ],
  ];
  for (const [route, assign] of UNDECLARED)
    for (const mode of MODES)
      it(`${mode}, ${route} route: Trace(g(x)) + 1 and Determinant(g(x)) + 1, g undeclared`, () => {
        const ce = new ComputeEngine();
        assign(ce);
        const trace = ce.box(['Add', ['Trace', ['g', 'x']], 1]);
        const det = ce.parse('\\operatorname{Determinant}(g(x)) + 1');
        // The signature of `g` says `(unknown) -> list<list<unknown>>` (its
        // parameter has no use that narrows it), so with a free `x` the
        // engine types the entries of `g(x)` as unknown. A free input with
        // no type is refused, so `x` is a parameter of the root function.
        const root = (e: any, type: string) =>
          ce.box(['Function', e.json, ['Typed', 'x', { str: type }]]);
        // With `x: any` the shape of the argument of `g(x)` is not settled,
        // and the compilation declines on every lane.
        for (const e of [trace, det]) {
          const r = compile(root(e, 'any'), { to: 'javascript', mode } as any);
          expect(r.success).toBe(false);
          expect(r.diagnostic?.code).toBe('unsettled-shape');
          expect(r.unsupported).toContain('x');
        }
        // With `x: real`, `Trace(g(x))` compiles on every lane (ROADMAP
        // CE-377; the complex lane declined before).
        expectValue(
          js(root(trace, 'real'), mode).run(2),
          trace.subs({ x: 2 }).N()
        );
        expectValue(js(root(det, 'real'), mode).run(2), det.subs({ x: 2 }).N());
      });
});

describe('THE LANE OF A NESTED LINEAR-ALGEBRA HEAD', () => {
  // The result type of `MatrixPower`, `MatrixMultiply` and `Cross` loses the
  // entry type (`MatrixPower(A, 2)` types `matrix`), so the lane read from
  // the type was wide, and the parent head declined in `strict` mode. The lane is read from the operands of the nested head instead.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<real>');
    ce.declare('u', 'vector<real>');
    return ce;
  }
  const VARS = {
    A: [
      [1, 2],
      [3, 4],
    ],
    u: [1, -2, 3],
  };
  const CASES: Array<[string, any, string, string]> = [
    [
      'Trace(MatrixPower(A, 2)) + 1',
      ['Add', ['Trace', ['MatrixPower', 'A', 2]], 1],
      '\\operatorname{Trace}(\\operatorname{MatrixPower}(A, 2)) + 1',
      '_SYS.trace(_SYS.matpow(_.A, 2)) + 1',
    ],
    [
      'Determinant(MatrixMultiply(A, A)) + 1',
      ['Add', ['Determinant', ['MatrixMultiply', 'A', 'A']], 1],
      '\\operatorname{Determinant}(\\operatorname{MatrixMultiply}(A, A)) + 1',
      '_SYS.det(_SYS.matmul(_.A, _.A)) + 1',
    ],
    [
      'Dot(Cross(u, u), u) + 1',
      ['Add', ['Dot', ['Cross', 'u', 'u'], 'u'], 1],
      '\\operatorname{Dot}(\\operatorname{Cross}(u, u), u) + 1',
      '_SYS.matmul(_SYS.cross(_.u, _.u), _.u) + 1',
    ],
    [
      'Trace(Transpose(MatrixPower(A, 2))) + 1',
      ['Add', ['Trace', ['Transpose', ['MatrixPower', 'A', 2]]], 1],
      '\\operatorname{Trace}(\\operatorname{Transpose}(\\operatorname{MatrixPower}(A, 2))) + 1',
      '_SYS.trace(_SYS.transpose(_SYS.matpow(_.A, 2))) + 1',
    ],
  ];
  for (const [name, json, latex, code] of CASES)
    for (const mode of MODES)
      for (const route of ['box', 'parse'] as const)
        it(`${mode}, ${route} route: ${name}`, () => {
          const ce = engine();
          const expr = route === 'box' ? ce.box(json) : ce.parse(latex);
          const result = js(expr, mode);
          expect(result.code).toBe(code);
          const expected = expr
            .subs({
              A: ce.parse('[[1, 2], [3, 4]]'),
              u: ce.parse('[1, -2, 3]'),
            })
            .N();
          expectValue(result.run(VARS), expected);
        });

  // `Map` takes the mapping function FIRST. Its type handler gives the entry
  // type of the result, so the lane of `Map(t ↦ t², u)` is read from its
  // type.
  for (const mode of MODES)
    it(`${mode}: Dot(u, Map(t ↦ t², u)) + 1`, () => {
      const ce = engine();
      const expr = ce.parse(
        '\\operatorname{Dot}(u, \\operatorname{Map}(t \\mapsto t^2, u)) + 1'
      );
      const result = js(expr, mode);
      expect(result.code).toContain('_SYS.matmul(');
      expect(result.run(VARS)).toBe(21);
    });
});

describe('A `Power` WHOSE BASE IS A MATRIX ONLY AFTER THE PARSE', () => {
  // Canonicalization writes `A^n` as `MatrixPower(A, n)` only when the type of
  // `A` is a matrix when the `Power` is built. `B^2` parsed before `B` holds a
  // matrix stays a `Power`, and `evaluate()` computes the matrix power for a
  // square matrix and an integer exponent (`isSquareMatrixPower()`). The
  // compiled code must compute the same power, not the element-wise one.
  function assignedAfterParse(latex: string, value: string) {
    const ce = new ComputeEngine();
    const expr = ce.parse(latex);
    ce.assign('B', ce.parse(value));
    return expr;
  }

  it.each([
    ['B^2', '[[7,10],[15,22]]'],
    ['B^{3}', '[[37,54],[81,118]]'],
    ['B^{0}', '[[1,0],[0,1]]'],
    ['B^{-2}', '[[5.5,-2.5],[-3.75,1.75]]'],
  ])(
    'javascript: %s of a square matrix is the matrix power',
    (latex, value) => {
      const expr = assignedAfterParse(latex, '[[1, 2], [3, 4]]');
      expect(expr.N().toString()).toBe(value);
      const result = js(expr, 'strict');
      expect(result.code).toContain('_SYS.matpow(_val_B, ');
      // The inverse in `B^{-2}` has rounding errors in floating point.
      const actual = result.run();
      for (const [i, row] of JSON.parse(value).entries())
        for (const [j, x] of row.entries())
          expect(actual[i][j]).toBeCloseTo(x, 12);
    }
  );

  it('javascript: the structural `Power` of a square matrix literal', () => {
    const ce = new ComputeEngine();
    const expr = ce.function(
      'Power',
      [ce.parse('[[1, 2], [3, 4]]'), ce.number(2)],
      { form: 'structural' }
    );
    const result = compile(expr, {
      to: 'javascript',
      constantFold: false,
      fallback: false,
    } as any);
    expect(result.code).toContain('_SYS.matpow(');
    expect(result.run()).toEqual([
      [7, 10],
      [15, 22],
    ]);
  });

  it('javascript: a non-integer exponent keeps the element-wise power', () => {
    const expr = assignedAfterParse('B^{0.5}', '[[1, 2], [3, 4]]');
    const result = js(expr, 'strict');
    expect(result.code).not.toContain('matpow');
    expect(result.code).toContain('_SYS.bcast(');
    const expected = [
      [1, Math.SQRT2],
      [Math.sqrt(3), 2],
    ];
    const actual = result.run();
    for (const [i, row] of expected.entries())
      for (const [j, x] of row.entries())
        expect(actual[i][j]).toBeCloseTo(x, 12);
  });

  it('javascript: a float exponent with an integer value keeps the element-wise power', () => {
    // A float exponent is not an integer, so `B^{2.0}` is the square of each
    // entry, on the interpreter and in the compiled code.
    const expr = assignedAfterParse('B^{2.0}', '[[1, 2], [3, 4]]');
    expect(expr.evaluate().toString()).toBe('[[1,4],[9,16]]');
    const result = js(expr, 'strict');
    expect(result.code).not.toContain('matpow');
    expect(result.code).toContain('_SYS.bcast(');
    expect(result.run()).toEqual([
      [1, 4],
      [9, 16],
    ]);
    // A declared matrix: canonicalization keeps the `Power`.
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<real^(2x2)>');
    const declared = js(ce.parse('A^{2.0}'), 'strict');
    expect(declared.code).not.toContain('matpow');
    expect(js(ce.parse('A^2'), 'strict').code).toContain('_SYS.matpow(');
  });

  it('javascript: an exponent typed integer is the matrix power, as on evaluate()', () => {
    // The written exponent decides (`isSquareMatrixPower`): `n + 1.0` with
    // `n: integer`, and `n` holding the float `2.0`, are typed `integer`.
    const m = '[[1, 2], [3, 4]]';
    const power = [
      [7, 10],
      [15, 22],
    ];
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.assign('n', 1);
    const sum = ce.box(['Power', ce.parse(m), ['Add', 'n', { num: '1.0' }]]);
    expect(sum.evaluate().toString()).toBe('[[7,10],[15,22]]');
    const compiledSum = js(sum, 'strict');
    expect(compiledSum.code).toContain('_SYS.matpow(');
    expect(compiledSum.run({ n: 1 })).toEqual(power);
    const held = new ComputeEngine();
    held.declare('n', 'integer');
    held.assign('n', held.parse('2.0'));
    const byN = held.box(['Power', held.parse(m), 'n']);
    expect(byN.evaluate().toString()).toBe('[[7,10],[15,22]]');
    const compiledN = js(byN, 'strict');
    expect(compiledN.code).toContain('_SYS.matpow(');
    expect(compiledN.run({ n: 2 })).toEqual(power);
  });

  it('javascript: an exponent typed real over a matrix declines', () => {
    // Only the value of such an exponent decides, so the compilation
    // declines (`isSquareMatrixPower` answers `undefined`).
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.declare('A', 'matrix<real^(2x2)>');
    expect(() => js(ce.parse('A^k'), 'strict')).toThrow(
      /Could not compile `Power`: the base is a matrix/
    );
  });

  it('javascript: an integer power of a matrix that is not square declines', () => {
    // `evaluate()` gives the `expected-square-matrix` error, as `B^2` parsed
    // after the assignment does (`MatrixPower(B, 2)`). Compiled code cannot
    // return that error, so the compilation declines.
    const expr = assignedAfterParse('B^2', '[[1, 2, 3], [4, 5, 6]]');
    expect(expr.evaluate().toString()).toMatch(/expected-square-matrix/);
    expect(() => js(expr, 'strict')).toThrow(
      /Could not compile `Power`: the base is a matrix that is not square/
    );
  });

  it('javascript: a vector keeps the element-wise power', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'vector<real>');
    const expr = ce.function('Power', [ce.symbol('v'), ce.number(2)], {
      form: 'structural',
    });
    const result = js(expr, 'strict');
    expect(result.code).toBe(
      '_SYS.bcast((_tv1, _tv2) => _SYS.pow(_tv1, _tv2), _.v, 2)'
    );
    expect(result.run({ v: [1, 2, 3] })).toEqual([1, 4, 9]);
  });

  it('javascript: a matrix of unknown shape declines', () => {
    // A square matrix gives the matrix power and any other matrix gives the
    // element-wise power, so only the value at run time can decide.
    const ce = new ComputeEngine();
    ce.declare('A', 'matrix<real>');
    const expr = ce.function('Power', [ce.symbol('A'), ce.number(2)], {
      form: 'structural',
    });
    expect(() => js(expr, 'strict')).toThrow(
      /Could not compile `Power`: the base is a matrix/
    );
  });
});

describe('THE GPU COMPLEX POWER AT ZERO', () => {
  // `_gpu_cpow(z, w)` is `exp(w · ln z)`, and at `z = 0` the product
  // `w · (−∞, 0)` has a NaN imaginary part. The interpreter answers 0 for a
  // positive real part of `w`: `Root(z, 4)` at `z = 0` is 0.
  it('the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    expect(parts(ce.parse('\\sqrt[4]{z}').subs({ z: 0 }).N())).toEqual([0, 0]);
  });
  for (const [to, guard] of [
    ['glsl', 'if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) return vec2(0.0);'],
  ] as const)
    it(`${to}: Root(z, 4) answers 0 at z = 0`, () => {
      const ce = new ComputeEngine();
      ce.declare('z', 'complex');
      const result = compile(ce.parse('\\sqrt[4]{z}'), {
        to,
        fallback: false,
      } as any) as any;
      expect(result.code).toContain('_gpu_cpow(z, ');
      expect(result.preamble).toContain(guard);
    });
});

describe('STATISTICS OF COMPLEX VALUES', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<complex>');
    return ce;
  }
  // JavaScript has a complex lowering of `Mean` (`_SYS.cmean`), which sums
  // `{re, im}` entries; before it, `Mean` took the run-time realness rule and
  // answered NaN for complex data.
  it('JavaScript: Mean(L) takes the complex lowering', () => {
    const r = js(engine().box(['Mean', 'L']), 'complex');
    expect(r.code).toContain('_SYS.cmean(');
  });
});
