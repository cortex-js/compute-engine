/**
 * Three holes in the GPU operand-shape gate, all the same defect class:
 * INVALID SHADER SOURCE emitted behind `success: true`.
 *
 *  1. A MANDATORY scalar slot went unchecked when no scalar was present. The
 *     positional rules were PERMISSIONS ("a scalar may stand here") consulted
 *     only once `shapes.includes('scalar')`, so an all-vector call bypassed
 *     them entirely: `Refract([1,2,3], [4,5,6], [7,8,9])` emitted
 *     `refract(vec3, vec3, vec3)`, and neither language declares an overload
 *     with a genType in `refract`'s third slot.
 *
 *  2. The variadic `min`/`max` fold was fail-open over DECLARED vector
 *     symbols. Its checker reconstructed operand shapes from the emitted
 *     source, where a bare identifier is deliberately unrecognizable, so
 *     `ElementMax(2, v, w)` over two `vector<real^3>` symbols emitted
 *     `max(max(2.0, v), w)` — `max(float, vec3)` is not valid GLSL.
 *
 *  3. Compound lowerings bypassed the gate entirely. A head absent from
 *     `GPU_OPERATORS` whose emission was not a single call was INFERRED to
 *     consume an aggregate on purpose, which is true of the `Max`/`Min`
 *     reduction and false of every ordinary compound lowering: WGSL's `Mod`
 *     → `(((P % Q) + Q) % Q)` over a `vector<3>` and a `vector<2>` compiled,
 *     while GLSL — whose `Mod` IS a single call — declined it correctly.
 *
 * The obligations are derived per builtin from the language specs, and are
 * NOT the same thing as "has a scalar-tailed overload": `mix(genType, genType,
 * float)` coexists with `mix(genType, genType, genType)`, so `mix`'s third
 * slot stays a permission. Same for `clamp`, `smoothstep`, `step`, `mod`,
 * `min` and `max`. Only `refract` is declared with no all-genType form.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off throughout this file: most probes are
 * all-literal (`Median([1,5,3,2,4])`, `Dot([1,2,3],[4,5,6])`), i.e. pure
 * subtrees with no free variables that the compiler would otherwise evaluate at
 * compile time and emit as one number. The shape gate under test only runs on
 * the structural lowering.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any, engine = ce): string =>
  glsl.compile(engine.box(expr), NO_FOLD).code!;
const w = (expr: any, engine = ce): string =>
  wgsl.compile(engine.box(expr), NO_FOLD).code!;

const V3 = ['List', 1, 2, 3];
const W3 = ['List', 4, 5, 6];
const U3 = ['List', 7, 8, 9];
const V4 = ['List', 1, 2, 3, 4];
const M2 = ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]];

/** An engine with declared vector symbols — operands with no constructor in
 *  their emitted source, which is what defeated the source-level checks. */
const cev = new ComputeEngine();
cev.declare('v', 'vector<real^3>');
cev.declare('w', 'vector<real^3>');
cev.declare('P', 'vector<real^3>');
cev.declare('Q', 'vector<real^2>');

describe('GPU SHAPE GATE — a MANDATORY scalar slot (finding 1)', () => {
  it('`refract`s third argument must be a scalar, even with no scalar present', () => {
    // GLSL ES 3.00 §8.4 / GLSL 4.60 §8.5: `genType refract(genType I, genType
    // N, float eta)` — the ONLY signature. WGSL §17.5: `refract(e1: vecN<T>,
    // e2: vecN<T>, e3: T)`. An all-vector call has no overload at all.
    for (const emit of [g, w])
      expect(() => emit(['Refract', V3, W3, U3])).toThrow(
        /^Refract: the shader builtin `refract` requires a SCALAR in argument 3 .* Fail closed \(D6\)\.$/s
      );
  });

  it('declines a declared-vector third argument too', () => {
    for (const emit of [g, w])
      expect(() => emit(['Refract', 'v', 'w', 'v'], cev)).toThrow(
        /requires a SCALAR in argument 3/
      );
  });

  it('the valid scalar-eta form still compiles', () => {
    expect(g(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    expect(w(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0), 0.5)'
    );
  });

  it('a PERMISSION is not an obligation — the all-genType overloads still compile', () => {
    // Each of these builtins is declared BOTH `(genType, …, float)` AND
    // `(genType, …, genType)`; only `refract` lacks the second form. Marking
    // any of them mandatory would decline valid source.
    expect(g(['Mix', V3, W3, U3])).toBe(
      'mix(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), vec3(7.0, 8.0, 9.0))'
    );
    expect(w(['Mix', V3, W3, U3])).toBe(
      'mix(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0), vec3f(7.0, 8.0, 9.0))'
    );
    expect(g(['Smoothstep', V3, W3, U3])).toBe(
      'smoothstep(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), vec3(7.0, 8.0, 9.0))'
    );
    expect(g(['Clamp', V3, W3, U3])).toBe(
      'clamp(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), vec3(7.0, 8.0, 9.0))'
    );
    expect(g(['Step', V3, W3])).toBe(
      'step(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['Mod', V3, W3])).toBe(
      'mod(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['ElementMax', V3, W3])).toBe(
      'max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const target of [glsl, wgsl]) {
      const r = target.compile(ce.box(['Refract', V3, W3, U3] as any), {
        fallback: true,
      });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});

describe('GPU SHAPE GATE — the variadic fold over declared vectors (finding 2)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  it('a misplaced scalar in a NESTED fold call declines (bare identifiers)', () => {
    // `max(max(2.0, v), w)` — the inner call puts the scalar first, where
    // GLSL's `max(genType, float)` has no overload. Neither `v` nor `w` has a
    // `vecN` constructor in its source, so only the CE operand shapes can
    // decide: the fold carries them in.
    expect(() => g(['ElementMax', 2, 'v', 'w'], cev)).toThrow(
      /^ElementMax: the shader builtin `max` takes a scalar only in argument 2, but the emitted call `max\(2\.0, v\)` has a scalar in argument 1.* Fail closed \(D6\)\.$/s
    );
    expect(() => g(['ElementMin', 2, 'v', 'w'], cev)).toThrow(
      /the emitted call `min\(2\.0, v\)` has a scalar in argument 1/
    );
  });

  it('a scalar accumulator reaching a later vector operand declines', () => {
    // `max(max(2.0, 3.0), v)`: the accumulator is still a scalar when `v`
    // arrives, so the OUTER call is `max(float, vec3)`.
    expect(() => g(['ElementMax', 2, 3, 'v'], cev)).toThrow(
      /has a scalar in argument 1/
    );
  });

  it('the same fold with the scalar LAST still compiles', () => {
    // GLSL's `max(genType, float)` admits it there, and the accumulator is a
    // vector by then.
    expect(g(['ElementMax', 'v', 'w', 2], cev)).toBe('max(max(v, w), 2.0)');
    expect(g(['ElementMax', V3, W3, 2])).toBe(
      'max(max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0)), 2.0)'
    );
    expect(g(['ElementMax', 'v', 'w'], cev)).toBe('max(v, w)');
    expect(g(['ElementMax', V3, W3, U3])).toBe(
      'max(max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0)), vec3(7.0, 8.0, 9.0))'
    );
  });

  it('an all-scalar fold is untouched', () => {
    expect(g(['ElementMax', 1, 2, 3, 4])).toBe(
      'max(max(max(1.0, 2.0), 3.0), 4.0)'
    );
  });

  it('WGSL keeps its own (stricter) verdict — it has no scalar/vector `max`', () => {
    expect(() => w(['ElementMax', 2, 'v', 'w'], cev)).toThrow(
      /requires MATCHING genType arguments/
    );
    expect(() => w(['ElementMax', 'v', 'w', 2], cev)).toThrow(
      /requires MATCHING genType arguments/
    );
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    const r = glsl.compile(cev.box(['ElementMax', 2, 'v', 'w'] as any), {
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.code ?? '').toBe('');
  });
});

describe('GPU SHAPE GATE — ordinary compound lowerings (finding 3)', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  it('WGSL `Mod` over mismatched widths declines, as GLSL already did', () => {
    // WGSL lowers `Mod` to `(((a % b) + b) % b)` — not a single call, so the
    // gate used to step aside for it.
    for (const emit of [g, w])
      expect(() => emit(['Mod', 'P', 'Q'], cev)).toThrow(
        /^Mod: its operands lower to shader vectors of different widths \(vec3, vec2\).* Fail closed \(D6\)\.$/s
      );
  });

  it('a matrix or array operand of a compound lowering declines', () => {
    // `(cos(mat2) / sin(mat2))`, `(log(float[5]) / log(2.0))` — the shader
    // transcendentals have no `matN` overload and arrays have no operators.
    for (const emit of [g, w]) {
      expect(() => emit(['Cot', M2])).toThrow(
        /^Cot: the compound shader lowering .* have no `matN` reading.* Fail closed \(D6\)\.$/s
      );
      expect(() => emit(['Lb', ['List', 1, 2, 3, 4, 5]])).toThrow(
        /the compound shader lowering .* have no array reading/
      );
    }
  });

  it('WGSL `Mod(1, [1,2,3])` still compiles — `%` HAS a mixed form', () => {
    // WGSL §8.7 defines the mixed scalar/vector arithmetic operators, so this
    // is valid source and must not be "fixed".
    expect(w(['Mod', 1, V3])).toBe(
      '((((1.0) % (vec3f(1.0, 2.0, 3.0))) + (vec3f(1.0, 2.0, 3.0))) % (vec3f(1.0, 2.0, 3.0)))'
    );
    expect(w(['Mod', V3, 1])).toBe(
      '((((vec3f(1.0, 2.0, 3.0)) % (1.0)) + (1.0)) % (1.0))'
    );
  });

  it('a DESTRUCTURING consumer of a literal list is left alone', () => {
    // `Median` and `Variance` flatten a single `List` operand into one scalar
    // per element, so the emission carries none of the operand's `array`
    // shape. They DECLARE that (`markAggregateConsuming`); the gate must not
    // infer it, nor decline them.
    expect(g(['Median', ['List', 1, 5, 3, 2, 4]])).toBe(
      '_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)'
    );
    const variance = g(['Variance', ['List', 1, 2, 3, 4, 5]]);
    expect(variance).not.toContain('float[');
    // eslint-disable-next-line no-new-func
    expect(new Function(`return (${variance});`)()).toBeCloseTo(
      ce.box(['Variance', ['List', 1, 2, 3, 4, 5]]).evaluate().re,
      10
    );
    expect(w(['Variance', ['List', 1, 2, 3, 4, 5]])).not.toContain('array<');
  });

  it('the N-SCALAR form of a destructuring consumer stays gated', () => {
    // `Variance(x, y)` uses its operands ONE FOR ONE — nothing is
    // destructured — so mismatched widths there are still invalid source. The
    // capability is a predicate over the operands, not a blanket exemption.
    for (const emit of [g, w])
      expect(() => emit(['Variance', 'P', 'Q'], cev)).toThrow(
        /different widths \(vec3, vec2\)/
      );
  });

  it('a compound lowering that PASSES AN OPERAND THROUGH is not judged on the others', () => {
    // `Real(m)` → `m`, and a lowering that answers a constant, say nothing
    // about the shapes of operands they never used: judging such an emission
    // against all of them would be a false decline.
    const cem = new ComputeEngine();
    cem.declare('m', 'matrix<real^2x2>');
    expect(glsl.compile(cem.box(['Real', 'm'] as any)).code).toBe('m');
    expect(wgsl.compile(cem.box(['Real', 'm'] as any)).code).toBe('m');
  });
});

describe('GPU SHAPE GATE — the Max/Min reduction is DECLARED, not inferred', () => {
  // `compileGPUExtremum` used to rely on the gate reading its parentheses as
  // "not a call, so a deliberate aggregate consumer". The capability is now
  // declared on the handler (`markAggregateConsuming`), and the reduction must
  // keep compiling AND keep reducing to the interpreter's value.
  const runShader = (code: string): number => {
    const js = code
      .replace(/\bmax\s*\(/g, 'Math.max(')
      .replace(/\bmin\s*\(/g, 'Math.min(');
    // eslint-disable-next-line no-new-func
    return new Function(`return (${js});`)();
  };

  const CASES: Array<[label: string, expr: any]> = [
    ['Max of a 3-element list', ['Max', V3]],
    ['Min of a Range', ['Min', ['Range', 1, 5]]],
    ['Max of a list and a scalar', ['Max', V3, 5]],
    ['Max of a list and a smaller scalar', ['Max', V3, 0]],
    ['Max of a 5-element list (an ARRAY shape)', ['Max', ['List', 1, 2, 3, 4, 5]]],
    ['Min of two lists', ['Min', ['List', 8, 2, 5], ['List', 9, 1]]],
    ['Max of negatives', ['Max', ['List', -7, -2], -9]],
    ['Max of a 4-element list', ['Max', V4]],
  ];

  it.each(CASES)('%s reduces to the interpreter value', (_label, expr) => {
    const src = g(expr);
    expect(runShader(src)).toBe(ce.box(expr).evaluate().re);
    // Byte-identical on WGSL for this subset.
    expect(w(expr)).toBe(src);
  });

  it('the canonical emissions are unchanged', () => {
    expect(g(['Max', V3])).toBe('(max(max(1.0, 2.0), 3.0))');
    expect(g(['Min', ['Range', 1, 5]])).toBe(
      '(min(min(min(min(1.0, 2.0), 3.0), 4.0), 5.0))'
    );
    // WGSL's `max` has no scalar/vector overload, so a `vec3f` mixed with a
    // scalar would fail the generic gate — the declared capability is what
    // keeps this reduction compiling there.
    expect(w(['Max', V3, 5])).toBe('(max(max(max(1.0, 2.0), 3.0), 5.0))');
    // An empty collection contributes nothing; the WGSL NaN is a CALL, which
    // the gate would otherwise judge against the `array` shape of `[]`.
    expect(g(['Max', ['List'], 5])).toBe('(5.0)');
    expect(w(['Max', ['List']])).toBe('(bitcast<f32>(0x7fc00000u))');
  });
});

describe('GPU SHAPE GATE — valid source still compiles (regression guard)', () => {
  it('the componentwise builtins and operators are unaffected', () => {
    expect(g(['Arctan2', V3, W3])).toBe(
      'atan(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['Power', V3, W3])).toBe(
      'pow(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['Dot', V3, W3])).toBe(
      'dot(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['Add', V3, W3])).toBe('vec3(1.0, 2.0, 3.0) + vec3(4.0, 5.0, 6.0)');
    expect(g(['Multiply', V3, 2])).toBe('2.0 * vec3(1.0, 2.0, 3.0)');
    expect(g(['Sin', V4])).toBe('sin(vec4(1.0, 2.0, 3.0, 4.0))');
    expect(g(['Negate', V4])).toBe('(-(vec4(1.0, 2.0, 3.0, 4.0)))');
    expect(g(['Mix', V3, W3, 0.5])).toBe(
      'mix(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    expect(g(['Clamp', V3, 0, 1])).toBe('clamp(vec3(1.0, 2.0, 3.0), 0.0, 1.0)');
    expect(g(['Smoothstep', 0, 1, V3])).toBe(
      'smoothstep(0.0, 1.0, vec3(1.0, 2.0, 3.0))'
    );
    expect(g(['Mod', V3, 1])).toBe('mod(vec3(1.0, 2.0, 3.0), 1.0)');
    expect(g(['Step', 1, V3])).toBe('step(1.0, vec3(1.0, 2.0, 3.0))');
  });

  it('matrix arithmetic is unaffected', () => {
    expect(g(['Multiply', M2, M2])).toContain(') * mat2(');
    expect(g(['Multiply', M2, ['List', 5, 6]])).toBe(
      'mat2(vec2(1.0, 3.0), vec2(2.0, 4.0)) * vec2(5.0, 6.0)'
    );
    expect(g(['Add', M2, M2])).toContain(') + mat2(');
    expect(g(['Multiply', M2, 2])).toContain('2.0 * mat2(');
    expect(w(['Multiply', M2, ['List', 5, 6]])).toBe(
      'mat2x2f(vec2f(1.0, 3.0), vec2f(2.0, 4.0)) * vec2f(5.0, 6.0)'
    );
  });

  it('the destructuring and aggregate-aware helpers are unaffected', () => {
    expect(g(['Median', ['List', 1, 5, 3, 2, 4]])).toBe(
      '_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)'
    );
    expect(
      g(['ColorMix', ['Tuple', 0.5, 0.2, 120], ['Tuple', 0.8, 0.1, 30], 0.25])
    ).toBe('_gpu_color_mix(vec3(0.5, 0.2, 120.0), vec3(0.8, 0.1, 30.0), 0.25)');
  });

  it('the per-language divergence holds: `max(vec3, 2.0)` is GLSL-only', () => {
    expect(g(['ElementMax', V3, 2])).toBe('max(vec3(1.0, 2.0, 3.0), 2.0)');
    expect(() => w(['ElementMax', V3, 2])).toThrow(/MATCHING genType/);
  });
});
