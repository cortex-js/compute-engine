import { ComputeEngine, compile } from '../../src/compute-engine';

// Compiled code holds a complex entry of a list as a `{re, im}` object:
// `[x, i]` lowers to `[x, { re: 0, im: 1 }]`. The JavaScript `_SYS` helpers
// behind the linear-algebra heads did real arithmetic on the entries, so a
// complex entry made them answer NaN behind `success: true` (`Norm([x, i])`
// at `x = 2` was NaN; the interpreter answers √5).
//
// `Norm` reads each entry only through its magnitude, and its result is real,
// so `_SYS.norm` now reads a complex entry by its modulus, for every order.
// The other heads return a complex value, which their helpers cannot build:
// they fail closed, and the interpreter evaluates them.

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

  // A shader vector is a `vecN` of floats: a complex entry has no place in
  // one, so the norm of such a list fails closed. A complex SCALAR is a
  // `vec2`, whose `length` is its modulus.
  for (const to of ['glsl', 'wgsl'] as const) {
    it(`${to} fails closed, parse route: Norm([x, i])`, () => {
      const ce = engine();
      expect(() =>
        compile(ce.parse('\\operatorname{Norm}([x, \\imaginaryI])'), {
          to,
          fallback: false,
        } as any)
      ).toThrow(/is itself vector-valued .*Fail closed/s);
    });
    it(`${to} fails closed, box route: Norm([x, i])`, () => {
      const ce = engine();
      expect(() =>
        compile(ce.box(['Norm', ['List', 'x', 'ImaginaryUnit']]), {
          to,
          fallback: false,
        } as any)
      ).toThrow(/is itself vector-valued .*Fail closed/s);
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

describe('LINEAR ALGEBRA OVER A COMPLEX ENTRY FAILS CLOSED', () => {
  const M = '[[x, \\imaginaryI], [1, 2]]';
  const CASES: Array<{ head: string; build: (ce: ComputeEngine) => any }> = [
    {
      head: 'Dot',
      build: (ce) =>
        ce.parse('\\operatorname{Dot}([x, \\imaginaryI], [1, \\imaginaryI])'),
    },
    {
      head: 'Dot',
      build: (ce) =>
        ce.box([
          'Dot',
          ['List', 'x', 'ImaginaryUnit'],
          ['List', 1, 'ImaginaryUnit'],
        ]),
    },
    {
      head: 'Dot',
      build: (ce) => ce.parse('\\operatorname{Dot}((x, \\imaginaryI), (1, 2))'),
    },
    {
      head: 'Dot',
      build: (ce) => ce.box(['Dot', 'v', 'v']),
    },
    {
      head: 'MatrixMultiply',
      build: (ce) => ce.parse(`\\operatorname{MatrixMultiply}(${M}, ${M})`),
    },
    {
      head: 'Cross',
      build: (ce) =>
        ce.parse('\\operatorname{Cross}([x, \\imaginaryI, 1], [1, 2, 3])'),
    },
    {
      head: 'Determinant',
      build: (ce) => ce.parse(`\\operatorname{Determinant}(${M})`),
    },
    {
      head: 'Inverse',
      build: (ce) => ce.parse(`\\operatorname{Inverse}(${M})`),
    },
    {
      head: 'Trace',
      build: (ce) =>
        ce.parse('\\operatorname{Trace}([[\\imaginaryI, 1], [1, x]])'),
    },
    {
      head: 'MatrixPower',
      build: (ce) => ce.parse(`\\operatorname{MatrixPower}(${M}, 2)`),
    },
    {
      head: 'RowReduce',
      build: (ce) => ce.parse(`\\operatorname{RowReduce}(${M})`),
    },
    {
      head: 'Distance',
      build: (ce) =>
        ce.parse('\\operatorname{Distance}((x, \\imaginaryI), (1, 1))'),
    },
  ];

  for (const { head, build } of CASES)
    for (const mode of MODES)
      it(`javascript ${mode}: ${build(engine()).toString()}`, () => {
        const ce = engine();
        const expr = build(ce);
        expect(() =>
          compile(expr, { to: 'javascript', mode, fallback: false } as any)
        ).toThrow(
          new RegExp(`${head}: .*cannot represent a complex entry`, 's')
        );
        // With the fallback, the result is the interpreter's value.
        const result = compile(expr, { to: 'javascript', mode } as any) as any;
        expect(result.success).toBe(false);
      });

  // Real entries still compile.
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

  // The trace reads only the diagonal: a complex entry OFF the diagonal of a
  // literal matrix does not reach the helper, so the trace still compiles.
  for (const mode of MODES)
    it(`javascript ${mode}: Trace(${M}) compiles (real diagonal)`, () => {
      const ce = engine();
      const expr = ce.parse(`\\operatorname{Trace}(${M})`);
      const result = compile(expr, { to: 'javascript', mode } as any) as any;
      expect(result.success).toBe(true);
      expect(result.run({ x: 2 })).toBe(4);
      expect(expr.subs({ x: 2 }).evaluate().re).toBe(4);
    });
});
