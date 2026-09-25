import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ComputeEngine, compile } from '../../src/compute-engine';

// The lane of a linear-algebra head (`BaseCompiler.linearAlgebraLane`) selects
// the helper a target emits for it (a real one, or one that computes with
// complex entries) and is also the answer a parent expression reads for the
// value of the node. These tests check that every route agrees with that
// lane, and that the Python target agrees with the interpreter on complex
// values.

const MODES = ['strict', 'auto', 'complex'] as const;

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
        .subs({ p: ce.parse('(\\imaginaryI, 1)'), q: ce.parse('(\\imaginaryI, 1)') })
        .N();
      // i·i + 1·1 + 1 = 1
      expect(parts(expected)).toEqual([1, 0]);
      expectValue(result.run({ p: [I, 1], q: [I, 1] }), expected);
    });

    // In `strict` and `auto` mode a `number` coordinate is read as a real
    // number, as a scalar `number` symbol is, and the written-out sum is
    // kept.
    for (const mode of ['strict', 'auto'] as const)
      it(`${mode}, ${route} route: Dot(p, q) + 1 is written out`, () => {
        const result = js(build(engine()), mode);
        expect(result.code).not.toContain('_SYS.complexMatmul(');
        expect(result.code).toContain('_tv1[0] * _tv2[0]');
        expect(result.run({ p: [2, 1], q: [3, 1] })).toBe(8);
      });
  }
});

describe('A SIGNED INFINITY IS A REAL ENTRY', () => {
  // `Floor(x)` types `integer | signed_infinity`. The infinite members of a
  // union entry type made the entry wide, and a `Determinant` over such a
  // matrix declined in `strict` and `auto` mode.
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
    ['box', 'Trace(f(x)) + 1', (ce) => ce.box(['Add', ['Trace', ['f', 'x']], 1])],
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
        expect(result.preamble).toContain('const _fn_f = (t) => [[t, 1], [2, 3]];');
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
        for (const expr of [
          ce.box(['Add', ['Trace', ['g', 'x']], 1]),
          ce.parse('\\operatorname{Determinant}(g(x)) + 1'),
        ]) {
          const result = js(expr, mode);
          expectValue(result.run({ x: 2 }), expr.subs({ x: 2 }).N());
        }
      });
});

describe('THE LANE OF A NESTED LINEAR-ALGEBRA HEAD', () => {
  // The result type of `MatrixPower`, `MatrixMultiply` and `Cross` loses the
  // entry type (`MatrixPower(A, 2)` types `matrix`), so the lane read from
  // the type was wide, and the parent head declined in `strict` and `auto`
  // mode. The lane is read from the operands of the nested head instead.
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
            .subs({ A: ce.parse('[[1, 2], [3, 4]]'), u: ce.parse('[1, -2, 3]') })
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
    [
      'wgsl',
      'if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) { return vec2f(0.0); }',
    ],
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

// The repo's Python virtual environment, when present. The value checks are
// skipped without it.
const PYTHON = [
  path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
  path.join(process.cwd(), 'venv', 'bin', 'python3'),
].find((p) => fs.existsSync(p));

/** Run the Python compilation `r` with the variable bindings `setup`, and
 * return its value as `[re, im]`. */
function runPython(r: any, setup: string): [number, number] {
  const lines = (r.code as string).split('\n');
  const program = [
    'import numpy as np',
    'import scipy.special',
    'import cmath',
    'import math',
    'import warnings',
    'warnings.simplefilter("ignore")',
    setup,
    r.preamble ?? '',
    ...lines.slice(0, -1),
    `v = complex(${lines[lines.length - 1]})`,
    'print(repr(float(v.real)), repr(float(v.imag)))',
  ].join('\n');
  const out = execFileSync(PYTHON!, ['-c', program], {
    encoding: 'utf8',
  }).trim();
  return out.split(/\s+/).map((t) =>
    t === 'inf' ? Infinity : t === '-inf' ? -Infinity : Number(t)
  ) as [number, number];
}

describe('PYTHON: THE OPERANDS OF A COMPLEX PRODUCT AND POWER', () => {
  // A complex operand sends `Multiply` and `Power` to their function
  // lowerings, which joined the operands without parentheses: `2(x + z)`
  // emitted `2 * x + z`, and `(x + iy)^2` emitted `(x + complex(0, 1) * y ** 2)`.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('z', 'complex');
    return ce;
  }
  const CASES: Array<[any, string]> = [
    [['Multiply', 2, ['Add', 'x', 'z']], '2 * (x + z)'],
    [['Multiply', ['Add', 'y', 1], ['Add', 'z', 1]], '(y + 1) * (z + 1)'],
    [
      ['Power', ['Add', 'x', ['Multiply', 'y', 'ImaginaryUnit']], 2],
      '((x + complex(0, 1) * y) ** 2)',
    ],
    [
      ['Power', 2, ['Add', 'x', ['Multiply', 'y', 'ImaginaryUnit']]],
      '(2 ** (x + complex(0, 1) * y))',
    ],
  ];
  for (const [json, code] of CASES)
    it(`${JSON.stringify(json)} compiles to ${code}`, () => {
      const r = compile(engine().box(json), { to: 'python' } as any) as any;
      expect(r.code).toBe(code);
    });

  (PYTHON === undefined ? it.skip : it)('the values agree with the interpreter', () => {
    const ce = engine();
    for (const [json] of CASES) {
      const expr = ce.box(json);
      const r = compile(expr, { to: 'python', fallback: false } as any);
      const actual = runPython(r, 'x = 0.5\ny = -1.5\nz = complex(0.25, 2)');
      const expected = expr
        .subs({ x: 0.5, y: -1.5, z: ce.parse('0.25 + 2\\imaginaryI') })
        .N();
      expect([JSON.stringify(json), ...actual]).toEqual([
        JSON.stringify(json),
        expect.closeTo(expected.re, 9),
        expect.closeTo(expected.im, 9),
      ]);
    }
  });
});

describe('PYTHON: SPECIAL FUNCTIONS OF A COMPLEX ARGUMENT', () => {
  // `scipy.special.loggamma`, `np.arctanh` and `np.arcsinh` take a different
  // branch than the interpreter, so a complex operand of `GammaLn`, `Artanh`
  // and `Arsinh` takes the run-time realness rule: the real lowering on the
  // real part when the imaginary part is exactly zero, NaN otherwise.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    return ce;
  }
  const Z = ['Add', 'x', ['Multiply', 'y', 'ImaginaryUnit']];
  for (const head of ['GammaLn', 'Artanh', 'Arsinh'])
    it(`${head}(x + iy) takes the run-time realness rule`, () => {
      const r = compile(engine().box([head, Z]), {
        to: 'python',
        fallback: false,
      } as any) as any;
      expect(r.code).toContain('_ce_cisreal');
    });

  // The helpers that keep their complex argument agree with the interpreter
  // on the real axis, on both sides of their branch cuts, and at 0.
  const POINTS: Array<[number, number]> = [];
  for (const x of [-3, -2.5, -1, -0.5, 0, 0.5, 1, 2, 3])
    for (const y of [0, 1e-9, -1e-9, 1, -1]) POINTS.push([x, y]);
  for (const y of [2, -2, 0.5, -0.5])
    for (const x of [0, 1e-9, -1e-9]) POINTS.push([x, y]);
  for (const head of ['Erf', 'Erfc', 'Arcosh', 'Lb', 'Log2', 'Log10'])
    (PYTHON === undefined ? it.skip : it)(`${head}(x + iy) agrees with the interpreter`, () => {
      const ce = engine();
      const expr = ce.box([head, Z]);
      const r = compile(expr, { to: 'python', fallback: false } as any) as any;
      expect(r.code).not.toContain('_ce_cisreal');
      for (const [x, y] of POINTS) {
        const [re, im] = runPython(r, `x = ${x}\ny = ${y}`);
        const expected = expr.subs({ x, y }).N();
        const same = (a: number, b: number) =>
          a === b || Math.abs(a - b) <= 1e-9 * (1 + Math.abs(b));
        expect([head, x, y, same(re, expected.re), same(im, expected.im)]).toEqual(
          [head, x, y, true, true]
        );
      }
    });
});

describe('PYTHON: STATISTICS AND TRACE OF COMPLEX VALUES', () => {
  // `np.mean`, `np.var(…, ddof=1)` and `np.std(…, ddof=1)` compute the
  // interpreter's values over complex elements (the variance is the sum of
  // `|x − μ|²` over `n − 1`), so a `list<complex>` operand reaches them as it
  // is. They were declared real-only on every target, and `Mean(L)` compiled
  // to `np.mean(_ce_creal_elems(L))`, which is NaN.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<complex>');
    ce.declare('M', 'matrix<complex>');
    return ce;
  }
  const CASES: Array<[string, any, string]> = [
    ['Mean', ['Mean', 'L'], 'np.mean(L)'],
    ['Variance', ['Variance', 'L'], 'np.var(L, ddof=1)'],
    ['StandardDeviation', ['StandardDeviation', 'L'], 'np.std(L, ddof=1)'],
    // `float()` of a complex trace dropped its imaginary part.
    ['Trace', ['Trace', 'M'], 'complex(np.trace(np.asarray(M)))'],
  ];
  for (const [name, json, code] of CASES) {
    it(`${name}: the complex operand reaches NumPy as it is`, () => {
      const r = compile(engine().box(json), { to: 'python' } as any) as any;
      expect(r.code).toBe(code);
    });
    (PYTHON === undefined ? it.skip : it)(`${name}: the value agrees with the interpreter`, () => {
      const ce = engine();
      const expr = ce.box(json);
      const r = compile(expr, { to: 'python', fallback: false } as any);
      const actual = runPython(
        r,
        'L = [complex(1, 1), 2, complex(0, 3)]\n' +
          'M = [[complex(1, 1), 2], [complex(0, -1), complex(3, 2)]]'
      );
      const expected = expr
        .subs({
          L: ce.parse('[1+\\imaginaryI, 2, 3\\imaginaryI]'),
          M: ce.parse('[[1+\\imaginaryI, 2], [-\\imaginaryI, 3+2\\imaginaryI]]'),
        })
        .N();
      expect(actual[0]).toBeCloseTo(expected.re, 9);
      expect(actual[1]).toBeCloseTo(expected.im, 9);
    });
  }

  // The JavaScript reducers sum plain numbers: `Mean` keeps the run-time
  // realness rule there.
  it('JavaScript: Mean(L) keeps the run-time realness rule', () => {
    const r = js(engine().box(['Mean', 'L']), 'auto');
    expect(r.code).toContain('_SYS.crealElements(');
  });
});
