/**
 * The sine hash on the shader targets (`compilation/gpu-exact-trig.ts`).
 *
 * `Mod(u, 1)` whose operand is a sine or a cosine amplified by a constant of
 * magnitude ≥ 1000 has no float32 value related to its exact value. On GLSL,
 * the shapes `O·sin(Σ K·x + c)` (or `cos`, or with a `Dot`) compile to exact
 * arithmetic built from float32, and the result lists the bound of each
 * operand (`float32Bounds`); every other flagged operand, and every flagged
 * operand on WGSL, keeps the usual float32 code and the result has a warning
 * (`warnings`, code `float32-unsafe-argument`). User decision 2026-10-18: a
 * decline moved Tycho's 2-D noise fields to the CPU at up to 2.7 s per zoom.
 *
 * The values cannot be checked here: the exact form depends on `uint`
 * arithmetic, and on a GPU compiler that reorders float arithmetic, which no
 * jest interpreter reproduces. The emitted code was run in WebGL2 on
 * 2026-10-18, on an Apple M5 Max (ANGLE on Metal) and on SwiftShader, at
 * 4,096 inputs per shape: every shape matched the float64 value within 10⁻³
 * (maximum error 9.5·10⁻⁵ to 6.3·10⁻⁴, including B and C across their whole
 * bound), and every input beyond the bound gave NaN. Details in the ROADMAP
 * entry for Tycho ledger rows 382 and 384.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
  for (const s of ['x', 'y', 'z']) ce.declare(s, 'real');
  ce.declare('p', 'tuple<real, real, real>');
});

function glsl(e: unknown) {
  const expr = typeof e === 'string' ? ce.parse(e) : ce.box(e as any);
  return compile(expr, { to: 'glsl', fallback: true });
}

describe('GLSL: the exact form', () => {
  test('fract(10^4·sin(10^4·x))', () => {
    const r = glsl('\\operatorname{mod}(10^4\\sin(10^4x),1)');
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_gpu_xhash_sin(_gpu_xred(x, 10000.0, 0.0, 2600.0), 10000.0, 0.0)'
    );
    expect(r.float32Bounds).toEqual([{ operand: 'x', maxAbs: 2600 }]);
    // The helpers it names, and the uniform the barrier reads, which GLSL
    // ES 3.00 initializes to 0 at link time.
    expect(r.preamble).toContain('uniform highp uint _gpu_zero_u;');
    expect(r.preamble).toContain('highp float _gpu_xhash_sin(');
    expect(r.preamble).not.toContain('_gpu_xhash_cos');
  });

  test('a constant is carried as two float32 parts', () => {
    const r = glsl('\\operatorname{mod}(43758.5453\\sin(12.9898x),1)');
    // The bound is the smaller of 2.6·10^7/K and the range in which the
    // part of K that the two float32 parts leave out stays below 10⁻⁴ after
    // the outer factor.
    expect(r.code).toBe(
      '_gpu_xhash_sin(_gpu_xred(x, 12.9898, -4.5318603e-7, 993860.1), 43758.547, -0.001575)'
    );
    expect(r.float32Bounds).toEqual([{ operand: 'x', maxAbs: 993860.125 }]);
  });

  test('a sum of terms, and a Dot with a list of numbers', () => {
    const sum = glsl(
      '\\operatorname{mod}(43758.5453\\sin(12.9898x+78.233y+45.164z),1)'
    );
    expect(sum.code).toEqual(
      expect.stringMatching(
        /^_gpu_xhash_sin\(_gpu_xred_add\(_gpu_xred_add\(_gpu_xred\(x, 12\.9898, -4\.5318603e-7, [\d.e+]+\), _gpu_xred\(y, 78\.233, -0\.0000017089844, [\d.e+]+\)\), _gpu_xred\(z, 45\.164, -0\.0000014648438, [\d.e+]+\)\), 43758\.547, -0\.001575\)$/
      )
    );
    expect(sum.float32Bounds?.map((b) => b.operand)).toEqual(['x', 'y', 'z']);
    const dot = glsl([
      'Mod',
      [
        'Multiply',
        43758.5453,
        ['Sin', ['Dot', 'p', ['List', 12.9898, 78.233, 45.164]]],
      ],
      1,
    ]);
    expect(dot.code).toEqual(
      expect.stringMatching(
        /^_gpu_xhash_sin\(_gpu_xred_add\(_gpu_xred_add\(_gpu_xred\(\(p\)\.x, /
      )
    );
    expect(dot.float32Bounds?.map((b) => b.operand)).toEqual([
      'At(p, 1)',
      'At(p, 2)',
      'At(p, 3)',
    ]);
  });

  test('cos, and a constant term reduced to quarter turns at compile time', () => {
    // 10^6 = 636620·π/2 − 0.3575…, and 636620 is a multiple of 4.
    const r = glsl('\\operatorname{mod}(10^4\\cos(10^4x+10^6),1)');
    expect(r.code).toBe(
      '_gpu_xhash_cos(_gpu_xred_add(_gpu_xred(x, 10000.0, 0.0, 2600.0), vec4(-0.35756418, 1.4003666e-8, 0.0, 1.0)), 10000.0, 0.0)'
    );
  });

  test('π joins the factor; a Dot drops a zero coefficient', () => {
    expect(glsl('\\operatorname{mod}(10^4\\sin(1000\\pi x),1)').code).toMatch(
      /^_gpu_xhash_sin\(_gpu_xred\(x, 3141\.5928, /
    );
    const r = glsl([
      'Mod',
      [
        'Multiply',
        43758.5453,
        ['Sin', ['Dot', 'p', ['List', 12.9898, 0, 45.164]]],
      ],
      1,
    ]);
    expect(r.float32Bounds?.map((b) => b.operand)).toEqual([
      'At(p, 1)',
      'At(p, 3)',
    ]);
  });

  test('an integer-valued operand, and a loop index', () => {
    const r = glsl([
      'Mod',
      [
        'Multiply',
        10000,
        ['Sin', ['Multiply', 10000, ['Add', ['Floor', 'x'], 0.5]]],
      ],
      1,
    ]);
    expect(r.code).toMatch(/^_gpu_xhash_sin\(/);
    expect(r.float32Bounds).toEqual([
      { operand: 'floor(x) + 0.5', maxAbs: 2600 },
    ]);
    // `Floor(5x)` rounds `5x` first, so its integer can differ from the
    // float64 one: the usual code, with a warning.
    const rounded = glsl([
      'Mod',
      [
        'Multiply',
        10000,
        ['Sin', ['Multiply', 10000, ['Floor', ['Multiply', 5, 'x']]]],
      ],
      1,
    ]);
    expect(rounded.code).toBe('fract(fract(10000.0 * sin(10000.0 * floor(5.0 * x))))');
    expect(rounded.warnings?.[0]?.code).toBe('float32-unsafe-argument');
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    expect(
      compile(e.parse('\\operatorname{mod}(10^4\\sin(10^4n),1)'), {
        to: 'glsl',
      }).code
    ).toMatch(/^_gpu_xhash_sin\(/);
  });

  test('Fract has the same exact form', () => {
    const r = glsl([
      'Fract',
      ['Multiply', 10000, ['Sin', ['Multiply', 10000, 'x']]],
    ]);
    expect(r.code).toBe(
      '_gpu_xhash_sin(_gpu_xred(x, 10000.0, 0.0, 2600.0), 10000.0, 0.0)'
    );
  });

  test('a function the caller maps is left to the caller', () => {
    const r = compile(
      ce.parse('\\operatorname{mod}(43758.5453\\sin(12.9898x),1)'),
      {
        to: 'glsl',
        functions: { Sin: 'mysin' },
      }
    );
    expect(r.code).toBe('fract(fract(43758.547 * mysin(12.9898 * x)))');
  });

  test('an operand that is not amplified compiles as before', () => {
    // A large constant in a term that does not hold the call, or behind
    // another function.
    expect(glsl('\\operatorname{mod}(1000x+\\sin(y),1)').code).toBe(
      'fract(fract(1000.0 * x + sin(y)))'
    );
    expect(
      glsl(['Mod', ['Floor', ['Multiply', 1000, ['Sin', 'x']]], 7]).code
    ).toBe(
      '_gpu_fmod(floor(1000.0 * sin(x)), 7.0)'
    );
    expect(glsl('\\operatorname{mod}(\\sin(x)+1,1)').code).toBe(
      'fract(fract(sin(x) + 1.0))'
    );
    expect(glsl('\\operatorname{mod}(10^4x,1)').code).toBe(
      'fract(fract(10000.0 * x))'
    );
    expect(glsl('\\operatorname{mod}(5\\sin(x),1)').code).toBe(
      'fract(fract(5.0 * sin(x)))'
    );
    expect(glsl('\\operatorname{mod}(\\sin(x)+1,1)').float32Bounds).toBe(
      undefined
    );
  });
});

describe('a warning where no exact form exists', () => {
  // The usual float32 code, a successful result, and the warning.
  const warned = (r: ReturnType<typeof glsl>) => {
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_gpu_xhash');
    expect(r.float32Bounds).toBe(undefined);
    expect(r.warnings?.map((w) => [w.code, w.kind])).toEqual([
      ['float32-unsafe-argument', 'correctness'],
    ]);
  };

  test('each warning names its operand, once', () => {
    const r = glsl(
      '\\operatorname{mod}(43758.5453\\tan(y),1)+\\operatorname{mod}(43758.5453\\sin(x^2),1)+\\operatorname{mod}(43758.5453\\tan(y),1)'
    );
    expect(r.warnings?.map((w) => w.value).sort()).toEqual([
      '43758.5453 * sin(x^2)',
      '43758.5453 * tan(y)',
    ]);
  });

  test('Fract of a vector is reported too', () => {
    const r = glsl(['Fract', ['Multiply', 43758.5453, ['Sin', 'p']]]);
    expect(r.code).toBe('fract(43758.547 * sin(p))');
    expect(r.warnings?.[0]?.code).toBe('float32-unsafe-argument');
  });

  test('a hash in code that is not emitted is not reported', () => {
    // `f(2)` folds to a constant: the definition of `f` is compiled, then
    // removed.
    const e = new ComputeEngine();
    e.parse('f(t) := \\operatorname{mod}(43758.5453\\tan(t),1)').evaluate();
    const r = compile(e.parse('f(2)'), { to: 'glsl' });
    expect(r.code).not.toContain('_fn_f');
    expect(r.warnings).toBe(undefined);
  });

  test('the usual code is kept', () => {
    const r = glsl([
      'Mod',
      ['Multiply', 1.9e9, ['Sin', ['Multiply', 10000, 'x']]],
      1,
    ]);
    expect(r.code).toBe('fract(fract(1900000000.0 * sin(10000.0 * x)))');
    // No warning for an operand that is not amplified.
    expect(glsl('\\operatorname{mod}(\\sin(x)+1,1)').warnings).toBe(undefined);
  });

  test('GLSL: another shape', () => {
    // tan, a divisor other than 1, and an outer factor that is not a number.
    warned(glsl('\\operatorname{mod}(10^4\\tan(x),1)'));
    warned(glsl('\\operatorname{mod}(10^4\\sin(10^4x),2)'));
    warned(glsl('\\operatorname{mod}(10^4y\\sin(x),1)'));
    // A divisor of magnitude ≤ 10⁻³, and a factor that is not a literal.
    warned(glsl(['Mod', ['Divide', ['Sin', 'x'], 0.0001], 1]));
    warned(glsl(['Mod', ['Multiply', ['Sin', 'x'], ['Power', 10, 40]], 1]));
    // An outer factor above 5·10^4.
    warned(
      glsl(['Mod', ['Multiply', 1.9e9, ['Sin', ['Multiply', 10000, 'x']]], 1])
    );
  });

  test('GLSL: an operand whose float32 value is rounded', () => {
    // `x + 10^4`, `x·y` and `x^2` are rounded before the exact product, and
    // so is a vector computed from `p`.
    warned(glsl('\\operatorname{mod}(10^4\\sin(1000(x+10^4)),1)'));
    warned(glsl('\\operatorname{mod}(43758.5453\\sin(12.9898xy),1)'));
    warned(glsl('\\operatorname{mod}(43758.5453\\sin(12.9898x^2),1)'));
    warned(
      glsl([
        'Mod',
        [
          'Multiply',
          43758.5453,
          [
            'Sin',
            ['Dot', ['Multiply', 3, 'p'], ['List', 12.9898, 78.233, 45.164]],
          ],
        ],
        1,
      ])
    );
    // A parameter of a function: its value comes from the call.
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.parse('f(t) := \\operatorname{mod}(10^4\\sin(10^4 t),1)').evaluate();
    warned(compile(e.parse('f(x)'), { to: 'glsl', fallback: true }));
  });

  test('WGSL: every amplified operand', () => {
    for (const latex of [
      '\\operatorname{mod}(10^4\\sin(10^4x),1)',
      '\\operatorname{mod}(43758.5453\\sin(12.9898x),1)',
    ]) {
      const r = compile(ce.parse(latex), { to: 'wgsl', fallback: true });
      expect(r.success).toBe(true);
      expect(r.code).toMatch(/^fract\(/);
      expect(r.warnings?.[0]?.code).toBe('float32-unsafe-argument');
    }
    expect(
      compile(ce.parse('\\operatorname{mod}(\\sin(x)+1,1)'), { to: 'wgsl' })
        .code
    ).toBe('fract(fract(sin(x) + 1.0))');
  });
});
