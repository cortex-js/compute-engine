import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Complex values on the targets that have no complex form for a head, or a
 * limited one.
 *
 * - GLSL and WGSL lower a complex value to a `vec2` of (re, im) and a real
 *   value to a `float`. A selection (`If`, `Which`) with one complex value
 *   lifts every real value to `vec2(v, 0.0)`: a ternary or a `select` with a
 *   `vec2` arm and a `float` arm is not valid shader source. `Norm` of a list
 *   with complex entries is the length of the vector of the entries' moduli.
 * - `interval-js` computes with real intervals only, so a complex symbol
 *   fails closed.
 * - Python computes `Artanh`, `Arsinh` and `Sign` of a non-real value with
 *   the complex value the interpreter computes, not `nan`.
 *
 * Every test builds its OWN engine: a use of an undeclared symbol can narrow
 * its type for the lifetime of the engine.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('z', 'complex');
  ce.declare('t', 'real');
  ce.declare('x', 'real');
  ce.declare('M', 'integer');
  ce.declare('h', { signature: '(real) -> complex' });
  ce.assign('h', ce.parse('u \\mapsto u + i'));
  return ce;
}

function run(ce: ComputeEngine, to: string, expr: any): any {
  return compile(ce.box(expr), { to, fallback: false } as any) as any;
}

/** The last line of the emitted code: the value, after any preamble. */
function value(result: any): string {
  return result.code.split('\n').pop();
}

const T_POS = ['Greater', 't', 0];

describe('GPU: a selection with one complex value lifts its real values', () => {
  test('If: the real arm is `vec2(v, 0.0)` / `vec2f(v, 0.0)`', () => {
    const ce = engine();
    const g = run(ce, 'glsl', ['If', T_POS, 'z', 1]);
    expect(g.success).toBe(true);
    expect(g.code).toBe('((0.0 < t) ? (z) : (vec2(1.0, 0.0)))');
    const w = run(ce, 'wgsl', ['If', T_POS, 'z', 1]);
    expect(w.success).toBe(true);
    expect(w.code).toBe('select(vec2f(1.0, 0.0), z, 0.0 < t)');
  });

  test('a parent of the selection reads the lifted value', () => {
    const ce = engine();
    const sel = ['If', T_POS, 'z', 1];
    expect(run(ce, 'glsl', ['Add', sel, 1]).code).toBe(
      '((0.0 < t) ? (z) : (vec2(1.0, 0.0))) + vec2(1.0, 0.0)'
    );
    expect(run(ce, 'glsl', ['Abs', sel]).code).toBe(
      'length(((0.0 < t) ? (z) : (vec2(1.0, 0.0))))'
    );
    expect(run(ce, 'glsl', ['Sqrt', sel]).code).toBe(
      '_gpu_csqrt(((0.0 < t) ? (z) : (vec2(1.0, 0.0))))'
    );
  });

  test('a complex arm computed by a head, and a real symbol arm', () => {
    const ce = engine();
    expect(run(ce, 'glsl', ['If', T_POS, ['Sqrt', 'z'], 't']).code).toBe(
      '((0.0 < t) ? (_gpu_csqrt(z)) : (vec2(t, 0.0)))'
    );
  });

  test('a call of a user function with a complex result', () => {
    const ce = engine();
    expect(value(run(ce, 'glsl', ['If', T_POS, ['h', 't'], 2]))).toBe(
      '((0.0 < t) ? (_fn_h(t)) : (vec2(2.0, 0.0)))'
    );
  });

  test('Which: each real value is lifted, and so is the fall-through NaN', () => {
    const ce = engine();
    expect(
      run(ce, 'wgsl', ['Which', T_POS, 'z', ['Less', 't', -1], 2, 'True', 3])
        .code
    ).toBe(
      'select(select((vec2f(3.0, 0.0)), vec2f(2.0, 0.0), t < -1.0), z, 0.0 < t)'
    );
    expect(
      run(ce, 'glsl', ['Which', T_POS, 'z', ['Less', 't', -1], 2]).code
    ).toBe(
      '((0.0 < t) ? (z) : (((t < -1.0) ? (vec2(2.0, 0.0)) : (vec2(_gpu_nan())))))'
    );
  });

  test('the statement form declares a `vec2` and lifts the real arm', () => {
    const ce = engine();
    const sum = ['Sum', ['Multiply', 'n', 't'], ['Limits', 'n', 1, 'M']];
    const g = run(ce, 'glsl', ['If', T_POS, 'z', sum]);
    expect(g.success).toBe(true);
    expect(g.code).toContain('vec2 _tv1;');
    expect(g.code).toContain('_tv1 = vec2(_tv2, 0.0);');
    const w = run(ce, 'wgsl', ['If', T_POS, 'z', sum]);
    expect(w.success).toBe(true);
    expect(w.code).toContain('var _tv1: vec2f;');
    expect(w.code).toContain('_tv1 = vec2f(_tv2, 0.0);');
  });

  test('a selection of real values is unchanged', () => {
    const ce = engine();
    expect(run(ce, 'glsl', ['If', T_POS, 1, 2]).code).toBe(
      '((0.0 < t) ? (1.0) : (2.0))'
    );
  });

  test('a boolean value beside a complex one fails closed', () => {
    // `vec2f(true, 0.0)` is not valid WGSL, nor `vec2(true, 0.0)` a complex
    // value in GLSL.
    const ce = engine();
    for (const to of ['wgsl', 'glsl'])
      expect(() => run(ce, to, ['If', T_POS, 'z', 'True'])).toThrow(
        /If: the value `.*True.*` is not a number.*Fail closed/
      );
    // A value of unknown type is read as a float, and lifted.
    expect(run(ce, 'wgsl', ['If', T_POS, 'z', 'w']).code).toBe(
      'select(vec2f(w, 0.0), z, 0.0 < t)'
    );
  });

  test('a real value that is not a scalar beside a complex one fails closed', () => {
    const ce = engine();
    expect(() => run(ce, 'glsl', ['If', T_POS, 'z', ['Tuple', 1, 2]])).toThrow(
      /If: the value `\(1, 2\)` is not a scalar.*Fail closed/
    );
  });
});

describe('GPU: Norm of a list with complex entries', () => {
  test('the length of the vector of the moduli', () => {
    const ce = engine();
    expect(run(ce, 'glsl', ['Norm', ['List', 'z', 'z']]).code).toBe(
      'length(vec2(length(z), length(z)))'
    );
    expect(run(ce, 'glsl', ['Norm', ['List', 'z', 1, 't']]).code).toBe(
      'length(vec3(length(z), 1.0, t))'
    );
    expect(run(ce, 'glsl', ['Norm', ['List', 'z']]).code).toBe('length(z)');
    expect(
      value(run(ce, 'wgsl', ['Norm', ['List', ['h', 't'], ['h', 't']]]))
    ).toBe('return length(vec2f(length(_cse1), length(_cse1)));');
  });

  test('the value agrees with the interpreter', () => {
    const ce = engine();
    // |1 + 2i|² + 3² = 14.
    expect(ce.box(['Norm', ['List', ['Complex', 1, 2], 3]]).N().re).toBeCloseTo(
      Math.sqrt(14),
      12
    );
  });

  test('a list of real entries is unchanged', () => {
    const ce = engine();
    expect(run(ce, 'glsl', ['Norm', ['List', 't', 'x']]).code).toBe(
      'length(vec2(t, x))'
    );
  });
});

describe('GPU: the real-only shader lowerings', () => {
  test('a complex operand of a real-only lowering fails closed', () => {
    const ce = engine();
    const cases: any[] = [
      ['Variance', ['List', 'z', 't', 'x']],
      ['Hypot', 'z', 't'],
      ['Arctan2', 'z', 't'],
      ['Haversine', 'z'],
      ['GammaLn', 'z'],
      ['Beta', 'z', 't'],
      ['Erf', 'z'],
      ['Erfc', 'z'],
      ['ErfInv', 'z'],
      ['Heaviside', 'z'],
      ['Sinc', 'z'],
      ['FresnelC', 'z'],
      ['FresnelS', 'z'],
      ['BesselJ', 1, 'z'],
      ['Arccot', 'z'],
      ['Arcsch', 'z'],
      ['InverseHaversine', 'z'],
      ['Gamma', 'z'],
      ['Factorial', 'z'],
    ];
    for (const to of ['glsl', 'wgsl'])
      for (const expr of cases)
        expect(() => run(ce, to, expr)).toThrow(/real-only/);
  });

  test('Root of a complex radicand compiles through the complex power', () => {
    const ce = engine();
    expect(run(ce, 'glsl', ['Root', 'z', 3]).code).toContain('_gpu_cpow(z,');
  });

  test('Mean has no shader lowering', () => {
    const ce = engine();
    expect(() => run(ce, 'glsl', ['Mean', ['List', 't', 1]])).toThrow(
      /Mean: cannot compile .* no lowering/
    );
  });
});

describe('interval-js: a complex symbol fails closed', () => {
  // The interval target reports a decline as `success: false` with the
  // reason in `error`, rather than throwing.
  test('a declared complex symbol in real arithmetic', () => {
    const ce = engine();
    const r = run(ce, 'interval-js', ['Subtract', 1, ['Add', 't', 'z']]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(
      /the symbol `z` has the complex type `complex`.*Fail closed/
    );
    const abs = run(ce, 'interval-js', ['Abs', 'z']);
    expect(abs.success).toBe(false);
    expect(abs.error).toMatch(/the symbol `z`/);
  });

  test('Re of a complex symbol fails closed', () => {
    const ce = engine();
    const r = run(ce, 'interval-js', ['Re', 'z']);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Fail closed/);
  });

  test('a real symbol, and an undeclared one, still compile', () => {
    const ce = engine();
    expect(
      run(ce, 'interval-js', ['Subtract', 1, ['Add', 't', 'x']]).code
    ).toBe('_IA.add(_IA.sub(_IA.negate(_.t), _.x), _k1)');
    // A use of an undeclared symbol infers `y: complex | infinity`; that is
    // not a complex-valued symbol.
    const r = compile(ce.parse('|y|'), { to: 'interval-js' } as any) as any;
    expect(r.success).toBe(true);
    expect(r.code).toBe('_IA.abs(_.y)');
  });
});

describe('Python: Artanh, Arsinh and Sign of a complex value', () => {
  test('Artanh: the complex routine for a non-real value', () => {
    const ce = engine();
    expect(value(run(ce, 'python', ['Artanh', 'z']))).toBe(
      '(lambda _tv1: (np.arctanh(_ce_creal(_tv1)) if _ce_cisreal(_tv1) else np.arctanh(_tv1)))(z)'
    );
  });

  test('Arsinh: `nan` on the branch cut only', () => {
    const ce = engine();
    expect(value(run(ce, 'python', ['Arsinh', 'z']))).toBe(
      "(lambda _tv1: (np.arcsinh(_ce_creal(_tv1)) if _ce_cisreal(_tv1) else (float('nan') if _tv1.real == 0 and abs(_tv1.imag) > 1 else np.arcsinh(_tv1))))(z)"
    );
  });

  test('Artanh of a value that is certainly not real compiles', () => {
    const ce = engine();
    const r = run(ce, 'python', ['Artanh', ['Add', 'x', 'ImaginaryUnit']]);
    expect(r.success).toBe(true);
    expect(value(r)).toBe(
      '(lambda _tv1: (np.arctanh(_ce_creal(_tv1)) if _ce_cisreal(_tv1) else np.arctanh(_tv1)))(x + complex(0, 1))'
    );
    // The interpreter evaluates it.
    expect(
      ce
        .box(['Artanh', ['Complex', 1, 2]])
        .N()
        .toString()
    ).toMatch(/^\(0\.1732\d+ \+ 1\.1780\d+i\)$/);
  });

  test('Sign: `z / |z|` for a non-real value, whatever the NumPy version', () => {
    const ce = engine();
    expect(value(run(ce, 'python', ['Sign', 'z']))).toBe(
      '(lambda _tv1: (np.sign(_ce_creal(_tv1)) if _ce_cisreal(_tv1) else _tv1 / abs(_tv1)))(z)'
    );
  });

  test('a real operand is unchanged', () => {
    const ce = engine();
    expect(run(ce, 'python', ['Artanh', 't']).code).toBe('np.arctanh(t)');
    expect(run(ce, 'python', ['Arsinh', 't']).code).toBe('np.arcsinh(t)');
    expect(run(ce, 'python', ['Sign', 't']).code).toBe('np.sign(t)');
  });
});
