import { ComputeEngine, compile } from '../../src/compute-engine';

// Compiled code holds a complex entry of a list as a `{re, im}` object:
// `[x, i]` lowers to `[x, { re: 0, im: 1 }]`. The JavaScript `_SYS` helpers
// behind the linear-algebra heads did real arithmetic on the entries, so a
// complex entry made them answer NaN behind `success: true` (`Norm([x, i])`
// at `x = 2` was NaN; the interpreter answers √5).
//
// `Norm` reads each entry only through its magnitude, and its result is real,
// so `_SYS.norm` reads a complex entry by its modulus, for every order. The
// other heads (`Dot`, `MatrixMultiply`, `Cross`, `Determinant`, `Inverse`,
// `Trace`, `MatrixPower`) compute with complex entries through the complex
// form of their helper (`_SYS.complexDet`, …), which the compiler emits when
// the lane of the operands is complex, and whose result a parent reads as
// complex. `Distance` reads complex coordinates through `_SYS.distanceAny`.
// `RowReduce` has no complex value in the interpreter, so it still fails
// closed.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('v', 'list<complex>');
  ce.declare('q', { signature: '(unknown) -> unknown' });
  ce.assign('q', ce.parse('s \\mapsto [s, \\imaginaryI]'));
  return ce;
}

const MODES = ['strict', 'auto'] as const;

describe('NORM OF A LIST WITH A COMPLEX ENTRY', () => {
  const CASES: Array<{
    name: string;
    build: (ce: ComputeEngine) => any;
    vars: Record<string, unknown>;
    // The same value as a MathJSON expression, for the interpreter.
    interpreterVars?: (ce: ComputeEngine) => Record<string, any>;
    expected: number;
  }> = [
    {
      name: 'parse route: Norm([x, i])',
      build: (ce) => ce.parse('\\operatorname{Norm}([x, \\imaginaryI])'),
      vars: { x: 2 },
      expected: Math.sqrt(5),
    },
    {
      name: 'box route: Norm([x, i])',
      build: (ce) => ce.box(['Norm', ['List', 'x', 'ImaginaryUnit']]),
      vars: { x: 2 },
      expected: Math.sqrt(5),
    },
    {
      name: 'parse route: Norm([x, 3 + 4i], 1)',
      build: (ce) => ce.parse('\\operatorname{Norm}([x, 3+4\\imaginaryI], 1)'),
      vars: { x: 2 },
      expected: 7,
    },
    {
      name: 'parse route: Norm([x, 3 + 4i], 3)',
      build: (ce) => ce.parse('\\operatorname{Norm}([x, 3+4\\imaginaryI], 3)'),
      vars: { x: 2 },
      expected: Math.cbrt(133),
    },
    {
      name: 'parse route: Norm([x, 3 + 4i], ∞)',
      build: (ce) =>
        ce.parse('\\operatorname{Norm}([x, 3+4\\imaginaryI], \\infty)'),
      vars: { x: 2 },
      expected: 5,
    },
    {
      name: 'parse route: Norm of a complex matrix (Frobenius)',
      build: (ce) =>
        ce.parse('\\operatorname{Norm}([[x, 3+4\\imaginaryI], [1, 2]])'),
      vars: { x: 2 },
      expected: Math.sqrt(34),
    },
    {
      name: 'parse route: Norm of a complex matrix, order 1 (max column sum)',
      build: (ce) =>
        ce.parse('\\operatorname{Norm}([[x, 3+4\\imaginaryI], [1, 2]], 1)'),
      vars: { x: 2 },
      expected: 7,
    },
    {
      name: 'parse route: Norm of a complex matrix, order ∞ (max row sum)',
      build: (ce) =>
        ce.parse(
          '\\operatorname{Norm}([[x, 3+4\\imaginaryI], [1, 2]], \\infty)'
        ),
      vars: { x: 2 },
      expected: 7,
    },
    {
      name: 'parse route: Norm(x + i), a complex scalar',
      build: (ce) => ce.parse('\\operatorname{Norm}(x+\\imaginaryI)'),
      vars: { x: 2 },
      expected: Math.sqrt(5),
    },
    {
      name: 'parse route: |(x, i·x)|, a point with a complex coordinate',
      build: (ce) => ce.parse('|(x, \\imaginaryI x)|'),
      vars: { x: 2 },
      expected: Math.sqrt(8),
    },
    {
      name: 'parse route: Norm(q(x)) with q(s) := [s, i]',
      build: (ce) => ce.parse('\\operatorname{Norm}(q(x))'),
      vars: { x: 2 },
      expected: Math.sqrt(5),
    },
    {
      name: 'box route: Norm(v) with v: list<complex>',
      build: (ce) => ce.box(['Norm', 'v']),
      vars: { v: [1, { re: 0, im: 1 }] },
      interpreterVars: (ce) => ({ v: ce.parse('[1, \\imaginaryI]') }),
      expected: Math.SQRT2,
    },
  ];

  for (const { name, build, vars, interpreterVars, expected } of CASES)
    for (const mode of MODES)
      it(`javascript ${mode}, ${name}`, () => {
        const ce = engine();
        const expr = build(ce);
        const interpreted = expr
          .subs(interpreterVars?.(ce) ?? (vars as Record<string, number>))
          .N();
        expect(interpreted.re).toBeCloseTo(expected, 12);
        const result = compile(expr, { to: 'javascript', mode } as any) as any;
        expect(result.success).toBe(true);
        expect(result.run(vars)).toBeCloseTo(expected, 12);
      });

  // A shader vector is a `vecN` of floats, so a complex entry cannot sit in
  // one: the norm of such a list is the length of the vector of the moduli
  // of the entries (`|i|` is `length(vec2(0.0, 1.0))`), which is what the
  // interpreter computes. Before 2026-09-24 the lowering emitted
  // `length(vec2[2](x, i))`, invalid shader code, behind `success: true`.
  for (const to of ['glsl', 'wgsl'] as const) {
    const vec = to === 'glsl' ? 'vec2' : 'vec2f';
    it(`${to} computes the norm of the moduli, parse route: Norm([x, i])`, () => {
      const ce = engine();
      const result = compile(
        ce.parse('\\operatorname{Norm}([x, \\imaginaryI])'),
        {
          to,
          fallback: false,
        } as any
      ) as any;
      expect(result.success).toBe(true);
      expect(result.code).toBe(`length(${vec}(x, length(${vec}(0.0, 1.0))))`);
    });
    it(`${to} computes the norm of the moduli, box route: Norm([x, i])`, () => {
      const ce = engine();
      const result = compile(ce.box(['Norm', ['List', 'x', 'ImaginaryUnit']]), {
        to,
        fallback: false,
      } as any) as any;
      expect(result.success).toBe(true);
      expect(result.code).toBe(`length(${vec}(x, length(${vec}(0.0, 1.0))))`);
    });
  }

  it('glsl: Norm(x + i) is the length of the complex vec2', () => {
    const ce = engine();
    const result = compile(ce.parse('\\operatorname{Norm}(x+\\imaginaryI)'), {
      to: 'glsl',
      fallback: false,
    } as any) as any;
    expect(result.code).toBe('length(vec2(x, 1.0))');
  });
});

/** The interpreter's value as the structure the compiled code returns: a
 * number, a `{re, im}` pair, or nested arrays of these. */
function interpreterValue(x: any): any {
  if (x.operator === 'List') return x.ops.map(interpreterValue);
  return { re: x.re, im: x.im };
}

/** Compare a compiled result with the interpreter's value, part by part. */
function expectClose(actual: any, expected: any, where = ''): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect(actual.length).toBe(expected.length);
    expected.forEach((e: any, k: number) =>
      expectClose(actual[k], e, `${where}[${k}]`)
    );
    return;
  }
  const re = typeof actual === 'number' ? actual : actual?.re;
  const im = typeof actual === 'number' ? 0 : actual?.im;
  expect([where, re]).toEqual([where, expect.closeTo(expected.re, 12)]);
  expect([where, im]).toEqual([where, expect.closeTo(expected.im, 12)]);
}

describe('LINEAR ALGEBRA OVER A COMPLEX ENTRY', () => {
  // Gaussian-integer entries (`i`, `3 + i`), a float complex entry (`0.5i`)
  // and a real symbol `x`, so the matrices are not constant-folded.
  const G = '[[\\imaginaryI, x], [2, 3+\\imaginaryI]]';
  const F = '[[0.5\\imaginaryI, 1], [2, x]]';
  const CASES: Array<{ name: string; build: (ce: ComputeEngine) => any }> = [
    {
      name: 'Dot([x, i], [1, i])',
      build: (ce) =>
        ce.parse('\\operatorname{Dot}([x, \\imaginaryI], [1, \\imaginaryI])'),
    },
    {
      name: 'box route: Dot([x, i], [1, i])',
      build: (ce) =>
        ce.box([
          'Dot',
          ['List', 'x', 'ImaginaryUnit'],
          ['List', 1, 'ImaginaryUnit'],
        ]),
    },
    {
      name: 'Dot([x + i, 2], [1 - i, 0.5i]) (no conjugation)',
      build: (ce) =>
        ce.parse(
          '\\operatorname{Dot}([x+\\imaginaryI, 2], [1-\\imaginaryI, 0.5\\imaginaryI])'
        ),
    },
    {
      name: 'Dot((x, i), (1, 2))',
      build: (ce) => ce.parse('\\operatorname{Dot}((x, \\imaginaryI), (1, 2))'),
    },
    {
      name: 'MatrixMultiply(G, F)',
      build: (ce) => ce.parse(`\\operatorname{MatrixMultiply}(${G}, ${F})`),
    },
    {
      name: 'MatrixMultiply(G, [1, x]) (matrix · vector)',
      build: (ce) => ce.parse(`\\operatorname{MatrixMultiply}(${G}, [1, x])`),
    },
    {
      name: 'Cross([x, i, 1], [1, 2i, 3])',
      build: (ce) =>
        ce.parse(
          '\\operatorname{Cross}([x, \\imaginaryI, 1], [1, 2\\imaginaryI, 3])'
        ),
    },
    {
      name: 'Determinant(G)',
      build: (ce) => ce.parse(`\\operatorname{Determinant}(${G})`),
    },
    {
      name: 'Determinant(F)',
      build: (ce) => ce.parse(`\\operatorname{Determinant}(${F})`),
    },
    {
      name: 'Determinant of a 3×3 with a zero leading entry',
      build: (ce) =>
        ce.parse(
          '\\operatorname{Determinant}([[0, \\imaginaryI, 1], [x, 0, 2], [1, 1+\\imaginaryI, 0]])'
        ),
    },
    {
      name: 'Inverse(G)',
      build: (ce) => ce.parse(`\\operatorname{Inverse}(${G})`),
    },
    {
      name: 'Inverse(F)',
      build: (ce) => ce.parse(`\\operatorname{Inverse}(${F})`),
    },
    {
      name: 'Trace(G)',
      build: (ce) => ce.parse(`\\operatorname{Trace}(${G})`),
    },
    {
      name: 'MatrixPower(G, 3)',
      build: (ce) => ce.parse(`\\operatorname{MatrixPower}(${G}, 3)`),
    },
    {
      name: 'MatrixPower(G, -2)',
      build: (ce) => ce.parse(`\\operatorname{MatrixPower}(${G}, -2)`),
    },
    {
      name: 'MatrixPower(G, 0)',
      build: (ce) => ce.parse(`\\operatorname{MatrixPower}(${G}, 0)`),
    },
    {
      name: 'Determinant(G) + 1 (a parent reads the complex result)',
      build: (ce) => ce.parse(`\\operatorname{Determinant}(${G}) + 1`),
    },
  ];

  for (const { name, build } of CASES)
    for (const mode of [...MODES, 'complex'] as const)
      it(`javascript ${mode}: ${name}`, () => {
        const ce = engine();
        const expr = build(ce);
        const result = compile(expr, {
          to: 'javascript',
          mode,
          fallback: false,
        } as any) as any;
        expect(result.success).toBe(true);
        const expected = interpreterValue(expr.subs({ x: 2 }).N());
        expectClose(result.run({ x: 2 }), expected);
      });

  // The interpreter computes no reduced row echelon form of a matrix with a
  // complex entry (`RowReduce` stays unevaluated), so there is no value to
  // match: the compilation fails closed.
  for (const mode of MODES)
    it(`javascript ${mode}: RowReduce(G) fails closed`, () => {
      const ce = engine();
      const expr = ce.parse(`\\operatorname{RowReduce}(${G})`);
      expect(expr.subs({ x: 2 }).N().operator).toBe('RowReduce');
      expect(() =>
        compile(expr, { to: 'javascript', mode, fallback: false } as any)
      ).toThrow(/RowReduce: .*no reduced row echelon form.*Fail closed/s);
    });

  // `Distance(p, q)` is the norm of the difference, `√(Σ|pᵢ − qᵢ|²)`. The
  // interpreter's own `Distance` squares a complex leg instead of taking its
  // modulus (it answers `1.272 − 0.786i` for `Distance((2, i), (1, 1))`), so
  // the reference here is the interpreter's `Norm` of the difference.
  for (const mode of MODES)
    it(`javascript ${mode}: Distance((x, i), (1, 1)) is ‖p − q‖`, () => {
      const ce = engine();
      const result = compile(
        ce.parse('\\operatorname{Distance}((x, \\imaginaryI), (1, 1))'),
        { to: 'javascript', mode, fallback: false } as any
      ) as any;
      const norm = ce
        .parse('\\operatorname{Norm}((x, \\imaginaryI) - (1, 1))')
        .subs({ x: 2 })
        .N();
      expect(norm.re).toBeCloseTo(Math.sqrt(3), 12);
      expect(result.run({ x: 2 })).toBeCloseTo(Math.sqrt(3), 12);
    });

  // Real entries still compile to the real-only helper.
  for (const mode of MODES)
    it(`javascript ${mode}: Dot([x, 1], [1, 2]) compiles`, () => {
      const ce = engine();
      const result = compile(ce.parse('\\operatorname{Dot}([x, 1], [1, 2])'), {
        to: 'javascript',
        mode,
      } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ x: 2 })).toBe(4);
    });

  // A complex entry OFF the diagonal still makes the trace complex-shaped:
  // the enclosing expression reads `{re, im}` off the node, because the
  // compiler decides the shape from the operand, not from the diagonal.
  for (const mode of MODES)
    it(`javascript ${mode}: Trace([[x, i], [1, 2]]) and its parent`, () => {
      const ce = engine();
      const trace = ce.parse(
        '\\operatorname{Trace}([[x, \\imaginaryI], [1, 2]])'
      );
      const result = compile(trace, { to: 'javascript', mode } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ x: 2 })).toBe(4);
      expect(trace.subs({ x: 2 }).evaluate().re).toBe(4);
      const plusOne = compile(
        ce.parse('\\operatorname{Trace}([[x, \\imaginaryI], [1, 2]]) + 1'),
        { to: 'javascript', mode } as any
      ) as any;
      expect(plusOne.run({ x: 2 })).toBe(5);
    });
});

// A symbol declared `matrix<complex>` (or `vector<complex>`) has a complex
// lane: the compiler emits the complex form of the helper, whose value is
// always `{re, im}`, and a parent expression reads it as complex. A symbol
// declared `matrix<number>` is read as REAL in `strict` and `auto` mode (user
// decision of 2026-09-24, option B), as a `number`-typed scalar is: the
// compiler emits the real-only helper, and the compiled runner checks the
// entries of the symbol when it is called, so a `{re, im}` entry throws a
// diagnostic that names the symbol and the entry. Before the entry check,
// `Determinant(W) + 1` over such a symbol returned the string
// `"[object Object]1"` behind `success: true` for complex entries; between
// 2026-09-23 and 2026-09-24 the compilation failed closed instead.
describe('A MATRIX SYMBOL BOUND TO COMPLEX ENTRIES AT RUN TIME', () => {
  function complexEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('W', 'matrix<complex>');
    ce.declare('u', 'vector<complex>');
    ce.declare('w', 'vector<complex>');
    return ce;
  }
  function wideEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('W', 'matrix<number>');
    ce.declare('R', 'matrix<real>');
    ce.declare('u', 'vector<number>');
    ce.declare('w', 'vector<number>');
    ce.declare('PC', 'list<tuple<number, number>>');
    return ce;
  }
  const W = [
    [{ re: 0, im: 1 }, 2],
    [{ re: 1, im: -1 }, 0.5],
  ];
  const W_LATEX = '[[\\imaginaryI, 2], [1-\\imaginaryI, 0.5]]';
  const u = [{ re: 1, im: 2 }, 0, 3];
  const U_LATEX = '[1+2\\imaginaryI, 0, 3]';
  const w = [2, { re: 0, im: -1 }, 1];
  const WV_LATEX = '[2, -\\imaginaryI, 1]';

  const CASES: Array<[string, any]> = [
    ['Determinant', ['Determinant', 'W']],
    ['Inverse', ['Inverse', 'W']],
    ['Trace', ['Trace', 'W']],
    ['MatrixMultiply', ['MatrixMultiply', 'W', 'W']],
    ['MatrixPower', ['MatrixPower', 'W', 3]],
    ['Dot', ['Dot', 'u', 'w']],
    ['Cross', ['Cross', 'u', 'w']],
    ['Determinant(W) + 1', ['Add', ['Determinant', 'W'], 1]],
    ['Trace(W) + 1', ['Add', ['Trace', 'W'], 1]],
    ['Dot(u, w) + 1', ['Add', ['Dot', 'u', 'w'], 1]],
  ];

  for (const [name, json] of CASES)
    for (const mode of [...MODES, 'complex'] as const)
      it(`javascript ${mode}, matrix<complex>: ${name}`, () => {
        const ce = complexEngine();
        const expr = ce.box(json);
        const result = compile(expr, {
          to: 'javascript',
          mode,
          fallback: false,
        } as any) as any;
        expect(result.code).toMatch(/_SYS\.complex[A-Z][a-z]+\(/);
        const expected = interpreterValue(
          expr
            .subs({
              W: ce.parse(W_LATEX),
              u: ce.parse(U_LATEX),
              w: ce.parse(WV_LATEX),
            })
            .N()
        );
        expectClose(result.run({ W, u, w }), expected);
      });

  // The same heads over `matrix<number>`/`vector<number>` symbols compile on
  // the real lane in the default modes, including under a parent
  // expression: real entries give the interpreter's value, and a complex
  // entry throws the entry diagnostic when the code is called.
  const W_REAL = [
    [2, 1],
    [1, 3],
  ];
  const W_REAL_LATEX = '[[2, 1], [1, 3]]';
  const U_REAL = [1, 2, 3];
  const U_REAL_LATEX = '[1, 2, 3]';
  const WV_REAL = [4, -5, 6];
  const WV_REAL_LATEX = '[4, -5, 6]';
  const PC_REAL = [
    [1, 2],
    [3, 4],
  ];
  const PC_REAL_JSON = [
    'List',
    ['Tuple', 1, 2],
    ['Tuple', 3, 4],
  ];
  for (const [name, json] of [
    ...CASES,
    ['RowReduce', ['RowReduce', 'W']],
    [
      'At(Dot(PC, (1, 2)), 1) + 1',
      ['Add', ['At', ['Dot', 'PC', ['Tuple', 1, 2]], 1], 1],
    ],
  ] as Array<[string, any]>)
    for (const mode of MODES)
      it(`javascript ${mode}, matrix<number>: ${name} is read as real`, () => {
        const ce = wideEngine();
        const expr = ce.box(json);
        const result = compile(expr, {
          to: 'javascript',
          mode,
          fallback: false,
        } as any) as any;
        expect(result.success).toBe(true);
        expect(result.code).not.toMatch(/_SYS\.complex/);
        const expected = interpreterValue(
          expr
            .subs({
              W: ce.parse(W_REAL_LATEX),
              u: ce.parse(U_REAL_LATEX),
              w: ce.parse(WV_REAL_LATEX),
              PC: ce.box(PC_REAL_JSON),
            })
            .N()
        );
        expectClose(
          result.run({ W: W_REAL, u: U_REAL, w: WV_REAL, PC: PC_REAL }),
          expected
        );
        // A complex entry is refused when the code is called, with the name
        // of the symbol and the position of the entry.
        const PC_COMPLEX = [
          [1, 2],
          [{ re: 0, im: 1 }, 4],
        ];
        expect(() =>
          result.run({ W, u, w: WV_REAL, PC: PC_COMPLEX })
        ).toThrow(
          /"(W|u|PC)" \(type `[^`]+`\) was compiled with real entries, but its entry \[[01]\](\[0\])? is a complex \{re, im\} value/
        );
      });

  // `Distance` reads either representation of a coordinate
  // (`_SYS.distanceAny`), but the entry check of a `vector<number>` symbol
  // refuses a complex entry in the default modes, as for every other use
  // of the symbol. Under `mode: 'complex'` the entries are complex and the
  // distance is ‖u − w‖.
  it('javascript: Distance(u, w) over vector<number> operands', () => {
    const ce = wideEngine();
    const result = compile(ce.box(['Distance', 'u', 'w']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(result.code).toBe('_SYS.distanceAny(_.u, _.w)');
    expect(() => result.run({ u, w })).toThrow(
      /"u" \(type `vector<number>`\) was compiled with real entries, but its entry \[0\] is a complex/
    );
    const complex = compile(ce.box(['Distance', 'u', 'w']), {
      to: 'javascript',
      mode: 'complex',
      fallback: false,
    } as any) as any;
    const norm = ce.parse(`\\operatorname{Norm}(${U_LATEX} - ${WV_LATEX})`).N();
    expect(complex.run({ u, w })).toBeCloseTo(norm.re, 12);
  });

  it('javascript: RowReduce of a matrix<complex> symbol fails closed', () => {
    const ce = complexEngine();
    expect(
      ce
        .box(['RowReduce', 'W'])
        .subs({ W: ce.parse(W_LATEX) })
        .N().operator
    ).toBe('RowReduce');
    expect(() =>
      compile(ce.box(['RowReduce', 'W']), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/RowReduce: .*no reduced row echelon form.*Fail closed/s);
  });

  // Under `mode: 'complex'` a wide operand is complex, and a wide result is
  // lifted at its parent, so the complex determinant composes with the
  // enclosing arithmetic.
  it('javascript complex: Determinant(W) + 1 over a matrix<number> symbol', () => {
    const ce = wideEngine();
    const expr = ce.box(['Add', ['Determinant', 'W'], 1]);
    const result = compile(expr, {
      to: 'javascript',
      mode: 'complex',
      fallback: false,
    } as any) as any;
    expect(result.code).toContain('_SYS.complexDet(_.W)');
    const expected = interpreterValue(expr.subs({ W: ce.parse(W_LATEX) }).N());
    expectClose(result.run({ W }), expected);
  });

  it('javascript: a matrix<real> symbol takes the real-only helper', () => {
    const ce = wideEngine();
    for (const [head, helper] of [
      ['Determinant', 'det'],
      ['Inverse', 'inv'],
      ['Trace', 'trace'],
      ['RowReduce', 'rref'],
    ])
      expect(
        (compile(ce.box([head, 'R']), { to: 'javascript' } as any) as any).code
      ).toBe(`_SYS.${helper}(_.R)`);
    const det = compile(ce.box(['Determinant', 'R']), {
      to: 'javascript',
    } as any) as any;
    expect(
      det.run({
        R: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toBe(-2);
  });
});
