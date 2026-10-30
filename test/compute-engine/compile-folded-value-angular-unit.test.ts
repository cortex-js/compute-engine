/**
 * A compiled expression is in the radian convention: each compile entry
 * rewrites it for the engine's angular unit (`rewriteAngularUnit()`). The
 * stored value of an assigned symbol, which the compilation writes in place
 * of the symbol (`BaseCompiler.tryFoldKnownSymbol()`), was not rewritten, so
 * in degree mode `c := sin(x)` compiled to `Math.sin(_.x)`, the sine of `x`
 * radians: 0.894 at x = 90 instead of 1. The value is now rewritten alone
 * (`BaseCompiler.foldedValueInRadians()`), so nothing is converted twice.
 *
 * The routes `compileToSource()` and `compileFunction()` of the GLSL, WGSL
 * and Python targets did not rewrite their expression at all; they now do,
 * as `compile()` does.
 *
 * Found during the work on ROADMAP CE-593.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';
import { execFileSync } from 'child_process';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = 'deg';
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('c', 'real');
  ce.assign('c', ce.parse('\\sin(x)'));
  ce.declare('P', 'tuple<real, real>');
  ce.assign('P', ce.box(['Tuple', ['Sin', 'x'], 0]));
  return ce;
}

describe('a folded value in degree mode', () => {
  test('javascript', () => {
    const ce = engine();
    const r = compile(ce.parse('c + 1'), { fallback: false });
    expect(r.code).toBe('_val_c + 1');
    expect(r.preamble).toBe(
      'const _val_c = Math.sin(0.017453292519943295 * _.x);\n'
    );
    expect(r.run!({ x: 90 })).toBe(2);
    const p = compile(ce.parse('P.x'), { fallback: false });
    expect(p.preamble).toBe(
      'const _val_P = [Math.sin(0.017453292519943295 * _.x), 0];\n'
    );
    expect(p.run!({ x: 90 })).toBe(1);
  });

  test.each([
    ['glsl', 'sin(0.017453292 * x) + 1.0', 'vec2(sin(0.017453292 * x), 0.0).x'],
    [
      'wgsl',
      'sin(0.017453292 * x) + 1.0',
      'vec2f(sin(0.017453292 * x), 0.0).x',
    ],
  ] as const)('%s', (to, scalar, point) => {
    const ce = engine();
    expect(compile(ce.parse('c + 1'), { to, fallback: false }).code).toBe(
      scalar
    );
    expect(compile(ce.parse('P.x'), { to, fallback: false }).code).toBe(point);
  });

  test('python', () => {
    const ce = engine();
    expect(
      compile(ce.parse('c + 1'), { to: 'python', fallback: false }).code
    ).toBe('np.sin(0.017453292519943295 * x) + 1');
  });

  test('interval-js', () => {
    const ce = engine();
    const r = compile(ce.parse('c + 1'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.code).toBe('_IA.add(_val_c, _k2)');
    expect(r.preamble).toContain('const _val_c = _IA.sin(_IA.mul(_k1, _.x));');
    const p = compile(ce.parse('P.x'), { to: 'interval-js', fallback: false });
    expect(p.code).toBe('_IA.sin(_IA.mul(_k1, _.x))');
  });

  test('a trig call of the expression and of the value: each converted once', () => {
    const ce = engine();
    expect(
      compile(ce.parse('\\sin(x) + c'), { to: 'glsl', fallback: false }).code
    ).toBe('sin(0.017453292 * x) + sin(0.017453292 * x)');
  });
});

describe('compileToSource() and compileFunction() in degree mode', () => {
  function engineWithY(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('c', 'real');
    ce.assign('c', ce.parse('\\sin(y)'));
    return ce;
  }

  test.each([
    ['glsl', new GLSLTarget()],
    ['wgsl', new WGSLTarget()],
  ] as const)('%s: compileToSource()', (_, target) => {
    const ce = engineWithY();
    expect(target.compileToSource(ce.parse('\\sin(x) + c'))).toBe(
      '_gpu_sin(0.017453292 * y) + _gpu_sin(0.017453292 * x)'
    );
  });

  test('glsl: compileFunction()', () => {
    const ce = engineWithY();
    const source = new GLSLTarget().compileFunction(
      ce.parse('\\sin(x) + c'),
      'f',
      'float',
      [['x', 'float']]
    );
    expect(source).toContain(
      'float f(float x) {\n  return _gpu_sin(0.017453292 * y) + _gpu_sin(0.017453292 * x);\n}'
    );
  });

  test('wgsl: compileFunction()', () => {
    const ce = engineWithY();
    const source = new WGSLTarget().compileFunction(
      ce.parse('\\sin(x) + c'),
      'f',
      'f32',
      [['x', 'f32']]
    );
    expect(source).toContain(
      'fn f(x: f32) -> f32 {\n  return _gpu_sin(0.017453292 * y) + _gpu_sin(0.017453292 * x);\n}'
    );
  });

  test('python: compileToSource() and compileFunction()', () => {
    const ce = engineWithY();
    const target = new PythonTarget();
    expect(target.compileToSource(ce.parse('\\sin(x)'))).toBe(
      'np.sin(0.017453292519943295 * x)'
    );
    expect(target.compileFunction(ce.parse('\\sin(x)'), 'f', ['x'])).toBe(
      'def f(x):\n    return np.sin(0.017453292519943295 * x)\n'
    );
  });
});

describe('the constant folder in degree mode reads a stored definition', () => {
  // The constant folder evaluates a constant subtree in radian mode, because
  // the compile entry rewrote the compiled tree into radians. The value of an
  // assigned symbol and the body of a user function were not rewritten, so
  // `.N()` read them in radians: `2k` with `k := Sin(30)` folded to -1.976
  // instead of 1. A subtree that reads such a definition is not folded, and
  // its structural compilation rewrites each value and body
  // (`BaseCompiler.readsAngularDefinition()`).
  function engineWithK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('k', 'real');
    ce.assign('k', ce.box(['Sin', 30]));
    ce.assign('f', ce.parse('(t) \\mapsto \\sin(t)'));
    return ce;
  }

  const CASES = [
    '2k',
    'k+1',
    '\\sin(k)',
    '\\arcsin(k)',
    'f(k)',
    'f(30)',
    '\\cos(30)+k',
  ];

  function expected(ce: ComputeEngine, src: string): number {
    return ce.parse(src).evaluate().N().re;
  }

  test.each(CASES)('javascript: %s', (src) => {
    const ce = engineWithK();
    const r = compile(ce.parse(src), { fallback: false });
    expect(r.success).toBe(true);
    const v = r.run!({}) as number | { re: number };
    expect(typeof v === 'number' ? v : v.re).toBeCloseTo(expected(ce, src), 12);
  });

  // The GLSL code of these cases is arithmetic on literals and `sin`, which
  // is evaluated here with the JavaScript functions, in single precision.
  test.each([
    ['2k', '1.0'],
    ['k+1', '1.5'],
    ['\\sin(k)', 'sin(0.008726646)'],
    ['\\cos(30)+k', '1.3660254'],
  ])('glsl: %s', (src, code) => {
    const ce = engineWithK();
    const r = compile(ce.parse(src), { to: 'glsl', fallback: false });
    expect(r.code).toBe(code);
    const value = new Function('sin', `return ${code};`)(Math.sin);
    expect(value).toBeCloseTo(expected(ce, src), 6);
  });

  test('glsl: arcsin and a user function', () => {
    const ce = engineWithK();
    expect(
      compile(ce.parse('\\arcsin(k)'), { to: 'glsl', fallback: false }).code
    ).toBe('(57.29578 * _gpu_casin(vec2(0.5, 0.0)))');
    const r = compile(ce.parse('f(k)'), { to: 'glsl', fallback: false });
    expect(r.code).toBe('_fn_f(0.5)');
    expect(r.preamble).toContain('return sin(0.017453292 * t);');
  });

  const PYTHON: Array<[string, string]> = [
    ['2k', '2 * 0.5'],
    ['k+1', '0.5 + 1'],
    ['\\sin(k)', 'np.sin(0.017453292519943295 * 0.5)'],
    ['\\arcsin(k)', '57.29577951308232 * np.arcsin(0.5)'],
    ['\\cos(30)+k', '0.5 + 0.8660254037844387'],
  ];

  test.each(PYTHON)('python: %s', (src, code) => {
    const ce = engineWithK();
    expect(compile(ce.parse(src), { to: 'python', fallback: false }).code).toBe(
      code
    );
  });

  // The Python target has no lowering for a call of a user function, so a
  // call that is not folded is refused, as `f(x)` is. Before, the fold
  // compiled `f(k)` to the sine of 0.5 radians.
  test('python: a user function', () => {
    const ce = engineWithK();
    expect(() =>
      compile(ce.parse('f(k)'), { to: 'python', fallback: false })
    ).toThrow(/Could not compile `f`/);
  });

  const hasNumpy = (() => {
    if (!TEST_PYTHON) return false;
    try {
      execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  (hasNumpy ? test : test.skip)('python: the values, run by numpy', () => {
    const ce = engineWithK();
    const src =
      'import numpy as np\nimport json\n' +
      `print(json.dumps([float(v) for v in [${PYTHON.map(([, c]) => c).join(', ')}]]))\n`;
    const out = execFileSync(TEST_PYTHON!, ['-c', src], { encoding: 'utf8' });
    const values = JSON.parse(out) as number[];
    PYTHON.forEach(([s], i) =>
      expect(values[i]).toBeCloseTo(expected(ce, s), 12)
    );
  });
});

describe('python: compileLambda() in degree mode', () => {
  // `compileLambda()` did not rewrite its expression for the angular unit,
  // while the stored value of `c` was rewritten: the code mixed the two
  // units, `lambda x: np.sin(0.0174… * y) + np.sin(x)`.
  test('the expression and the value are both converted', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('c', 'real');
    ce.assign('c', ce.parse('\\sin(y)'));
    expect(
      new PythonTarget().compileLambda(ce.parse('\\sin(x) + c'), ['x'])
    ).toBe(
      'lambda x: np.sin(0.017453292519943295 * y) + np.sin(0.017453292519943295 * x)'
    );
  });
});

describe('a compiled integral in degree mode reads a stored definition', () => {
  // The antiderivative attempt evaluates `Integrate` in radian mode, and read
  // the stored value of `k` and the body of `f` in radians: `∫₀ˣ k dt`
  // compiled to `x·sin(30 rad)`, -1.976 at x = 2 instead of 1. Such an
  // integral now compiles by its numeric route, where the integrand compiles
  // structurally with each stored value rewritten for the unit. The GLSL and
  // Python targets have no lowering for these integrals.
  function engineWithK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('x', 'real');
    ce.declare('k', 'real');
    ce.assign('k', ce.box(['Sin', 30]));
    ce.assign('f', ce.parse('(t) \\mapsto \\sin(t)'));
    return ce;
  }

  const CASES = [
    '\\int_0^x k\\,dt',
    '\\int_0^x \\sin(k t)\\,dt',
    '\\int_0^x f(t)\\,dt',
    '\\int_0^2 k\\,dt',
  ];

  test.each(CASES)('javascript: %s', (src) => {
    const ce = engineWithK();
    const e = ce.parse(src);
    const expected = e.subs({ x: 2 }).evaluate().N().re;
    const r = compile(e, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ x: 2 }) as number).toBeCloseTo(expected, 8);
  });

  test.each(CASES)('interval-js: %s', (src) => {
    const ce = engineWithK();
    const e = ce.parse(src);
    const expected = e.subs({ x: 2 }).evaluate().N().re;
    const r = compile(e, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    const v = r.run!({ x: 2 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(expected);
    expect(v.value.hi).toBeGreaterThanOrEqual(expected);
  });

  // An integrand that reads no stored definition still compiles to its
  // closed form.
  test('javascript: the closed form of an integrand with no stored value', () => {
    const ce = engineWithK();
    const r = compile(ce.parse('\\int_0^x \\sin(t)\\,dt'), {
      fallback: false,
    });
    expect(r.code).toBe(
      '(-57.29577951308232 * Math.cos(0.017453292519943295 * _.x) + 57.29577951308232)'
    );
  });
});

describe('AbsArg in degree mode', () => {
  // `AbsArg(z)` is the pair `(Abs(z), Argument(z))`, and its second
  // component is an angle in the engine's unit, which the compiled code
  // would compute in radians. The constant folder gave
  // `2·At(AbsArg(1 + i), 2)` = 1.5708 instead of 90. In any unit other than
  // radians every target refuses `AbsArg`, directly, through a stored value
  // and through a function body.
  const REFUSAL =
    /Could not compile `AbsArg` when the angular unit is not radians/;
  const TARGETS = [
    'javascript',
    'interval-js',
    'glsl',
    'wgsl',
    'python',
  ] as const;

  function engineWithK(unit: 'deg' | 'rad' = 'deg'): ComputeEngine {
    const ce = new ComputeEngine();
    ce.angularUnit = unit;
    ce.declare('x', 'real');
    ce.assign('k', ce.box(['AbsArg', ['Complex', 1, 1]]));
    ce.parse('g(t) := t + \\operatorname{AbsArg}(t)').evaluate();
    return ce;
  }

  const CASES: Array<[string, unknown]> = [
    ['direct', ['AbsArg', ['Add', 'x', ['Complex', 0, 1]]]],
    [
      'a constant component',
      ['Multiply', 2, ['At', ['AbsArg', ['Complex', 1, 1]], 2]],
    ],
    ['a stored value', ['Multiply', 2, ['At', 'k', 2]]],
    ['a list operand', ['AbsArg', ['List', 1, -2]]],
    ['a function body', ['g', 'x']],
  ];

  // The interval target reports a refusal as `success: false`; the others
  // throw.
  function refusal(ce: ComputeEngine, json: unknown, to: string): string {
    try {
      const r = compile(ce.box(json as any), {
        to: to as any,
        fallback: false,
      });
      return r.success ? `success: ${r.code}` : (r.error ?? '');
    } catch (e) {
      return (e as Error).message;
    }
  }

  for (const [label, json] of CASES)
    test.each(TARGETS)(`${label}: %s refuses`, (to) => {
      expect(refusal(engineWithK(), json, to)).toMatch(REFUSAL);
    });

  // The refusal is thrown at the entry of the target, before the outermost
  // compilation resets its report. The fallback result reported the mode
  // and the promotion of the previous compilation.
  test('the fallback reports no promotion', () => {
    const ce = engineWithK();
    const previous = compile(ce.box(['Sqrt', ['Subtract', 'x', 1]]), {
      mode: 'complex',
    });
    expect(previous.promoted).toBe(true);
    const r = compile(ce.box(['AbsArg', 'x']));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(REFUSAL);
    expect(r.mode).toBe('strict');
    expect(r.promoted).toBe(false);
  });

  test('the values of evaluate()', () => {
    const ce = engineWithK();
    expect(
      ce
        .box(CASES[1][1] as any)
        .evaluate()
        .N().re
    ).toBeCloseTo(90, 12);
    expect(
      ce
        .box(CASES[2][1] as any)
        .evaluate()
        .N().re
    ).toBeCloseTo(90, 12);
  });

  // Radian mode is unchanged: the constant component folds.
  test('radian mode', () => {
    const ce = engineWithK('rad');
    const e = ce.box(CASES[1][1] as any);
    expect(compile(e, { fallback: false }).code).toBe('1.5707963267948966');
    expect(compile(e, { to: 'glsl', fallback: false }).code).toBe('1.5707964');
    expect(compile(e, { to: 'python', fallback: false }).code).toBe(
      '1.5707963267948966'
    );
  });
});

describe('Argument of a real value at NaN', () => {
  // The real lowering of `Argument` was `x >= 0 ? 0 : π`, so at NaN it gave
  // π (180 in degree mode), where `evaluate()` gives NaN.
  test.each(['rad', 'deg'] as const)('javascript, %s', (unit) => {
    const ce = new ComputeEngine();
    ce.angularUnit = unit;
    ce.declare('x', 'real');
    const e = ce.box(['Argument', 'x']);
    const r = compile(e, { fallback: false });
    for (const v of [NaN, -0, -2, 3]) {
      const expected = e.subs({ x: v }).evaluate().N().re;
      const actual = r.run!({ x: v }) as number;
      if (Number.isNaN(expected)) expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected, 12);
    }
  });

  test.each([
    [
      'glsl',
      '((x >= 0.0) ? (0.0) : (((x < 0.0) ? (3.14159265359) : (_gpu_nan()))))',
    ],
    [
      'wgsl',
      'select(select(_gpu_nan(), 3.14159265359, x < 0.0), 0.0, x >= 0.0)',
    ],
  ] as const)('%s', (to, code) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(ce.box(['Argument', 'x']), { to, fallback: false });
    expect(r.code).toBe(code);
    expect(r.preamble).toContain('_gpu_nan()');
  });
});
