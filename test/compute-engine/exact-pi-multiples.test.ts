/**
 * An EXACT rational multiple of π is reduced exactly under `.N()`, at every
 * precision, and a small part of the value of a FLOAT input is kept.
 *
 * The rule (user decision, 2026-10-02): roundoff that comes from an exact
 * input is removed where it starts, by reducing the multiple of π exactly
 * (`sin(π)` is `0`, `e^{iπ}` is `−1`); a small part of the value of a float
 * input is the value at that float, and is kept on every route
 * (`e^{3.141592653589793i}` is `−1 + 1.22·10⁻¹⁶i` at machine precision). The
 * `Chop` operator removes it on request.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { shaderFunctions } from './gpu-shader-f32-eval';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

const PRECISIONS = ['machine', 7, 21, 50] as const;

function engineAt(precision: (typeof PRECISIONS)[number]): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = precision;
  return ce;
}

describe('.N() of an exact multiple of π', () => {
  // [LaTeX, expected re, expected im]: each part exactly
  const CASES: [string, number, number][] = [
    ['\\sin(\\pi)', 0, 0],
    ['\\cos(\\frac{\\pi}{2})', 0, 0],
    ['\\tan(\\pi)', 0, 0],
    ['\\cot(\\frac{\\pi}{2})', 0, 0],
    ['\\cos(\\frac{2\\pi}{3})', -0.5, 0],
    ['e^{i\\pi}', -1, 0],
    ['e^{\\frac{i\\pi}{2}}', 0, 1],
    ['\\sinh(i\\pi)', 0, 0],
    ['\\cosh(\\frac{i\\pi}{2})', 0, 0],
    ['\\tanh(i\\pi)', 0, 0],
    // A large multiple is reduced with bigints.
    ['e^{i10^{20}\\pi}', 1, 0],
    ['e^{-i10^{20}\\pi}', 1, 0],
    ['e^{i2^{60}\\pi}', 1, 0],
    ['\\sinh(i10^{20}\\pi)', 0, 0],
    ['e^{-\\frac{i\\pi}{2}}', 0, -1],
  ];
  for (const precision of PRECISIONS)
    test.each(CASES)(`precision ${precision}: %s`, (latex, re, im) => {
      const v = engineAt(precision).parse(latex).N();
      expect(v.re).toBe(re);
      expect(v.im).toBe(im);
    });

  for (const precision of PRECISIONS)
    test(`precision ${precision}: e^{2iπ/3} is −0.5 + (√3/2)i`, () => {
      const v = engineAt(precision).parse('e^{\\frac{2i\\pi}{3}}').N();
      expect(v.re).toBe(-0.5);
      expect(v.im).toBeCloseTo(Math.sqrt(3) / 2, 15);
    });

  test('a float result: sin(π) at machine precision is the float 0', () => {
    const ce = engineAt('machine');
    expect(ce.parse('\\sin(\\pi)').N().json).toEqual({ num: '0.0' });
  });
});

describe('.N() of a float input keeps a small part at machine precision', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = engineAt('machine');
  });
  test('e^{3.141592653589793i}', () => {
    const v = ce.parse('e^{3.141592653589793i}').N();
    expect(v.re).toBe(-1);
    expect(v.im).toBe(Math.sin(Math.PI));
  });
  test('2^{10^{-100}i}', () => {
    const v = ce.box(['Power', 2, ['Complex', 0, 1e-100]]).N();
    expect(v.re).toBe(1);
    expect(v.im).toBeCloseTo(6.931471805599453e-101, 115);
  });
  test('the angle of an inverse function in degrees keeps a small part', () => {
    const deg = engineAt('machine');
    deg.angularUnit = 'deg';
    const v = deg.parse('\\arcsin(10^{-200}i)').N();
    expect(v.re).toBe(0);
    expect(v.im).toBeCloseTo((1e-200 * 180) / Math.PI, 214);
  });
  test('Chop removes it', () => {
    expect(
      ce.box(['Chop', ce.parse('e^{3.141592653589793i}').N()]).N().json
    ).toEqual({ num: '-1.0' });
  });
});

// The points of the compiled tests: an integer, a half-integer, and a
// value that is neither.
const POINTS: [number, [number, number]][] = [
  [1, [1, 1]],
  [2, [2, 1]],
  [0.5, [1, 2]],
  [1.5, [3, 2]],
  [-3, [-3, 1]],
  [0.25, [1, 4]],
];
const HEADS: [string, string][] = [
  ['e^{i\\pi x}', 'exp'],
  ['\\sin(\\pi x)', 'sin'],
  ['\\cos(\\pi x)', 'cos'],
  ['\\tan(\\pi x)', 'tan'],
];

function interpreted(
  ce: ComputeEngine,
  latex: string,
  [p, q]: [number, number]
): { re: number; im: number } {
  const v = ce
    .parse(latex)
    .subs({ x: ce.number([p, q]) })
    .N();
  // `~oo` (a pole of `tan`) is `Infinity` on the real lane.
  if (v.json === 'ComplexInfinity') return { re: Infinity, im: 0 };
  return { re: v.re, im: v.im };
}

function same(a: { re: number; im: number }, b: { re: number; im: number }) {
  const close = (u: number, v: number) =>
    u === v || Math.abs(u - v) <= 4e-16 * Math.abs(v);
  return close(a.re, b.re) && close(a.im, b.im);
}

describe('compiled: sin(πx), cos(πx), tan(πx) and e^{iπx}', () => {
  // The engine is made here, after the engines of the tests above: making an
  // engine sets the precision of big decimals, which is global, and an engine
  // made earlier would compute at the precision of the last one made.
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.declare('x', 'real');
  });

  test.each(HEADS)('JavaScript: %s', (latex) => {
    const result = compile(ce.parse(latex), { fallback: false });
    expect(result.success).toBe(true);
    for (const [x, exact] of POINTS) {
      const out = result.run!({ x }) as number | { re: number; im: number };
      const c = typeof out === 'number' ? { re: out, im: 0 } : out;
      const i = interpreted(ce, latex, exact);
      // A value whose imaginary part is 0 is a plain number.
      expect(typeof out === 'number').toBe(i.im === 0);
      if (!same(c, i))
        throw new Error(
          `${latex} at ${x}: ${c.re} + ${c.im}i, expected ${i.re} + ${i.im}i`
        );
    }
  });

  (TEST_PYTHON === undefined ? it.skip : it)('Python', () => {
    const py = new PythonTarget({ includeImports: true });
    let program = '';
    HEADS.forEach(([latex], k) => {
      program += py.compileFunction(ce.parse(latex), `f${k}`, ['x']) + '\n';
    });
    program += 'import json\nout = []\n';
    program += `for x in ${JSON.stringify(POINTS.map(([x]) => x))}:\n`;
    HEADS.forEach((_, k) => {
      program += `  r = complex(f${k}(float(x)))\n  out.append([r.real, r.imag])\n`;
    });
    program += 'print(json.dumps(out))\n';
    const values = JSON.parse(
      execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' }).replace(
        /Infinity/g,
        '1e999'
      )
    ) as [number, number][];
    const failures: string[] = [];
    let n = 0;
    for (const [x, exact] of POINTS)
      for (const [latex] of HEADS) {
        const [re, im] = values[n++];
        const i = interpreted(ce, latex, exact);
        if (!same({ re, im }, i))
          failures.push(
            `${latex} at ${x}: ${re} + ${im}i, expected ${i.re} + ${i.im}i`
          );
      }
    expect(failures).toEqual([]);
  });

  for (const [language, Target] of [
    ['glsl', GLSLTarget],
    ['wgsl', WGSLTarget],
  ] as const)
    it(`${language}: an integer or a half-integer x has an exact zero part`, () => {
      for (const [latex, head] of HEADS) {
        const r = new Target().compile(ce.parse(latex));
        const complex = head === 'exp';
        const main =
          language === 'glsl'
            ? complex
              ? `vec2 _main(float x) { return ${r.code}; }`
              : `float _main(float x) { return ${r.code}; }`
            : complex
              ? `fn _main(x: f32) -> vec2f { return ${r.code}; }`
              : `fn _main(x: f32) -> f32 { return ${r.code}; }`;
        const run = shaderFunctions(`${r.preamble ?? ''}\n${main}`, language);
        for (const [x, exact] of POINTS) {
          if (x === 0.25) continue;
          const v = run('_main', x);
          const c =
            typeof v === 'number' ? { re: v, im: 0 } : { re: v.x, im: v.y };
          const i = interpreted(ce, latex, exact);
          // A pole is an infinity of either sign in f32 (`1/±0`).
          if (!Number.isFinite(i.re)) {
            expect(Number.isFinite(c.re)).toBe(false);
            continue;
          }
          // `toBe` compares with `Object.is`: a `-0` part fails.
          expect(c.re).toBe(i.re);
          expect(c.im).toBe(i.im);
        }
      }
    });
});

describe('.N() of an exact multiple of π: units, poles, large multiples', () => {
  // The exponent of `e` and the argument of a hyperbolic function are in
  // radians whatever the angular unit.
  for (const unit of ['deg', 'grad', 'turn'] as const)
    for (const precision of ['machine', 21] as const)
      test(`${unit}, precision ${precision}`, () => {
        const ce = engineAt(precision);
        ce.angularUnit = unit;
        const v = (latex: string) => ce.parse(latex).N();
        expect([v('e^{i\\pi}').re, v('e^{i\\pi}').im]).toEqual([-1, 0]);
        expect(v('e^{\\frac{2i\\pi}{3}}').re).toBe(-0.5);
        expect(v('\\sinh(i\\pi)').re).toBe(0);
        expect(v('\\sinh(i\\pi)').im).toBe(0);
      });

  for (const precision of ['machine', 21] as const)
    test(`precision ${precision}: the poles of the hyperbolic functions of iπ`, () => {
      const ce = engineAt(precision);
      for (const latex of [
        '\\tanh(\\frac{i\\pi}{2})',
        '\\coth(i\\pi)',
        '\\operatorname{csch}(i\\pi)',
        '\\operatorname{sech}(\\frac{i\\pi}{2})',
      ])
        expect(ce.parse(latex).N().json).toEqual('ComplexInfinity');
    });

  for (const precision of ['machine', 21] as const)
    test(`precision ${precision}: a large multiple with a fraction, and a negative one`, () => {
      const ce = engineAt(precision);
      const a = ce.parse('e^{i(10^{20}+\\frac{1}{3})\\pi}').N();
      expect(a.re).toBe(0.5);
      expect(a.im).toBeCloseTo(Math.sqrt(3) / 2, 15);
      const b = ce.parse('e^{-\\frac{7i\\pi}{6}}').N();
      expect(b.re).toBeCloseTo(-Math.sqrt(3) / 2, 15);
      expect(b.im).toBe(0.5);
    });
});

describe('compiled: the sign of a zero part, e^{x + iπ}, and sin(πL)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('L', 'list<real>');
  });

  test('JavaScript: a zero part is +0', () => {
    const run = (latex: string, x: number) =>
      compile(ce.parse(latex), { fallback: false }).run!({ x }) as number;
    // `1/sin(πx)` at `x = 1` is `+∞` when the zero is `+0`.
    for (const x of [1, -1, 3])
      expect(Object.is(run('\\sin(\\pi x)', x), 0)).toBe(true);
    for (const x of [0.5, 1.5, -0.5])
      expect(Object.is(run('\\cos(\\pi x)', x), 0)).toBe(true);
    for (const x of [1, -1])
      expect(Object.is(run('\\tan(\\pi x)', x), 0)).toBe(true);
  });

  test('JavaScript: e^{x + iπ} is −e^x', () => {
    const result = compile(ce.parse('e^{x+i\\pi}'), { fallback: false });
    const out = result.run!({ x: 1 });
    expect(out).toBe(-Math.E);
    const i = ce.parse('e^{x+i\\pi}').subs({ x: ce.One }).N();
    expect(i.re).toBe(-Math.E);
    expect(i.im).toBe(0);
  });

  test('JavaScript: sin(πL) over a list', () => {
    const result = compile(ce.parse('\\sin(\\pi L)'), { fallback: false });
    expect(result.code).toContain('_SYS.sinpi(');
    expect(result.run!({ L: [1, 2, 0.5] })).toEqual([0, 0, 1]);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'Python: a scalar tan(πx) is a float, and a zero part is +0',
    () => {
      const py = new PythonTarget({ includeImports: true });
      let program = '';
      program +=
        py.compileFunction(ce.parse('\\tan(\\pi x)'), 'f_tan', ['x']) + '\n';
      program +=
        py.compileFunction(ce.parse('\\sin(\\pi x)'), 'f_sin', ['x']) + '\n';
      program +=
        py.compileFunction(ce.parse('e^{x+i\\pi}'), 'f_exp', ['x']) + '\n';
      program += 'import json, math\n';
      program +=
        'print(json.dumps([isinstance(f_tan(1.0), np.ndarray), ' +
        'math.copysign(1.0, float(f_tan(1.0))), ' +
        'math.copysign(1.0, float(f_sin(1.0))), ' +
        'complex(f_exp(1.0)).real, complex(f_exp(1.0)).imag]))\n';
      const [isArray, tanSign, sinSign, re, im] = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      );
      expect(isArray).toBe(false);
      expect(tanSign).toBe(1);
      expect(sinSign).toBe(1);
      expect(re).toBeCloseTo(-Math.E, 14);
      expect(im).toBe(0);
    }
  );

  test('a power with a Random() exponent does not draw when it is compiled', () => {
    // The Python and shader targets read a constant exponent's value to
    // decide the real root of a negative base; a draw would be frozen into
    // the code.
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const spy = jest.spyOn(engine as any, '_random');
    // The Python target has no lowering of `Random` and declines it.
    try {
      new PythonTarget().compile(engine.box(['Power', 'x', ['Random']]));
    } catch {}
    new GLSLTarget().compile(engine.box(['Power', 'x', ['Random']]));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
