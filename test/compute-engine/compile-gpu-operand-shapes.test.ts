/**
 * Fail-closed gate on a NON-SCALAR operand (a collection, a matrix, an array)
 * reaching a shader lowering that cannot accept it.
 *
 * The companion of `compile-broadcast-unary.test.ts`: that change made the
 * unary fan-out target-mediated (`Sin([1,2,3,4])` → `sin(vec4(…))`) and gated
 * it on `gpuIsComponentwise`. The same defect class survived on every path
 * that never reaches that hook — the generic function-codegen and
 * string-mapped-helper emissions — which used to splice invalid shader source
 * behind `success: true`:
 *
 *   atan(vec3(1.0, 2.0, 3.0), 1.0)            mixed genTypes
 *   pow(2.71828182846, vec3(1.0, 2.0, 3.0))   mixed genTypes
 *   length(vec2(float[1](3.0), 4.0))          array constructor in a vector one
 *   sin(mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))) no matrix overload
 *
 * They now fail closed (D6) through `CompileTarget.checkOperandShapes`, which
 * derives its verdict from the operand shapes and from the emitted source —
 * never from a list of head names.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off throughout this file: the probes are
 * all-literal (`Dot([1,2,3],[4,5,6])`, `Median([1,5,3,2,4])`), i.e. pure
 * subtrees with no free variables that the compiler would otherwise evaluate at
 * compile time and emit as one number. The operand-shape gate under test only
 * runs on the structural lowering.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any): string => glsl.compile(ce.box(expr), NO_FOLD).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr), NO_FOLD).code!;

const V3 = ['List', 1, 2, 3];
const W3 = ['List', 4, 5, 6];
const V4 = ['List', 1, 2, 3, 4];
const M2 = ['Matrix', ['List', ['List', 1, 2], ['List', 3, 4]]];

describe('GPU OPERAND SHAPE GATE — invalid shader source fails closed', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  it('a scalar second operand of a genType builtin declines (Arctan2)', () => {
    // `atan(genType, genType)` requires MATCHING types; `atan(vec3, float)`
    // is not valid source in either language.
    expect(() => g(['Arctan2', V3, 1])).toThrow(/MATCHING genType/);
    expect(() => w(['Arctan2', V3, 1])).toThrow(/MATCHING genType/);
  });

  it('an array-shaped operand packed into a vector constructor declines (Hypot)', () => {
    // `length(vec2(float[1](3.0), 4.0))` — an array constructor spliced inside
    // a vector constructor.
    expect(() => g(['Hypot', ['List', 3], 4])).toThrow(/no .*array.* overload/);
    expect(() => w(['Hypot', ['List', 3], 4])).toThrow(/no .*array.* overload/);
  });

  it('a vector operand a lowering would RESHAPE declines (Hypot of two vectors)', () => {
    // `length(vec2(vec3(…), vec3(…)))`: the lowering packs its operands into a
    // `vec2`, which has no room for a `vec3` in each slot.
    expect(() => g(['Hypot', V3, W3])).toThrow(/packs its operands/);
    expect(() => w(['Hypot', V3, W3])).toThrow(/packs its operands/);
  });

  it('a scalar FIRST operand of a genType builtin declines (Exp → Power)', () => {
    // `Exp([1,2,3])` canonicalizes to `Power(e, […])` → `pow(float, vec3)`.
    expect(() => g(['Exp', V3])).toThrow(/MATCHING genType/);
    expect(() => w(['Exp', V3])).toThrow(/MATCHING genType/);
  });

  it('a matrix operand of a scalar/genType builtin declines (Sin)', () => {
    expect(() => g(['Sin', M2])).toThrow(/no `matN` overload/);
    expect(() => w(['Sin', M2])).toThrow(/no `matN` overload/);
  });

  it('a vector operand of a scalar-only preamble helper declines (Power)', () => {
    // `_gpu_powi` is declared `float _gpu_powi(float x, float n)`.
    expect(() => g(['Power', V3, 2])).toThrow(/_gpu_powi/);
    expect(() => w(['Power', V3, 2])).toThrow(/_gpu_powi/);
  });

  it('operands of different vector widths decline', () => {
    expect(() => g(['Add', V3, ['List', 4, 5]])).toThrow(/different widths/);
    expect(() => w(['Add', V3, ['List', 4, 5]])).toThrow(/different widths/);
  });

  it('every decline names the head and ends with the D6 marker', () => {
    for (const emit of [g, w])
      expect(() => emit(['Sin', M2])).toThrow(/^Sin: .*Fail closed \(D6\)\.$/s);
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const target of [glsl, wgsl]) {
      for (const expr of [
        ['Arctan2', V3, 1],
        ['Hypot', ['List', 3], 4],
        ['Exp', V3],
        ['Sin', M2],
      ]) {
        const r = target.compile(ce.box(expr as any), { fallback: true });
        expect(r.success).toBe(false);
        expect(r.code ?? '').toBe('');
      }
    }
  });
});

describe('GPU OPERAND SHAPE GATE — valid componentwise shapes still compile', () => {
  it('a genType builtin over matching vectors', () => {
    expect(g(['Arctan2', V3, W3])).toBe(
      'atan(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(w(['Arctan2', V3, W3])).toBe(
      'atan(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0))'
    );
    expect(g(['Power', V3, W3])).toBe(
      'pow(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    // `ElementMax` — not `Max`, which is a REDUCTION on the GPU too (it
    // destructures its collection operands; see `compileGPUExtremum`).
    expect(g(['ElementMax', V3, W3])).toBe(
      'max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
    expect(g(['Dot', V3, W3])).toBe(
      'dot(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0))'
    );
  });

  it('arithmetic over matching vectors, and vector-scalar broadcast', () => {
    expect(g(['Add', V3, W3])).toBe(
      'vec3(1.0, 2.0, 3.0) + vec3(4.0, 5.0, 6.0)'
    );
    // `*` and `/` broadcast a scalar over a vector in both languages.
    expect(g(['Multiply', V3, 2])).toBe('2.0 * vec3(1.0, 2.0, 3.0)');
    expect(w(['Multiply', V3, 2])).toBe('2.0 * vec3f(1.0, 2.0, 3.0)');
    expect(g(['Divide', 2, V3])).toBe('(2.0) / (vec3(1.0, 2.0, 3.0))');
  });

  it('matrix arithmetic GLSL and WGSL both define', () => {
    expect(g(['Multiply', M2, ['List', 5, 6]])).toBe(
      'mat2(vec2(1.0, 3.0), vec2(2.0, 4.0)) * vec2(5.0, 6.0)'
    );
    expect(w(['Multiply', M2, ['List', 5, 6]])).toBe(
      'mat2x2f(vec2f(1.0, 3.0), vec2f(2.0, 4.0)) * vec2f(5.0, 6.0)'
    );
    expect(g(['Multiply', M2, 2])).toContain('2.0 * mat2(');
    expect(w(['Multiply', M2, 2])).toContain('2.0 * mat2x2f(');
    expect(g(['Multiply', M2, M2])).toContain(') * mat2(');
    expect(g(['Add', M2, M2])).toContain(') + mat2(');
  });

  it('the unary fan-out lowerings are unaffected', () => {
    expect(g(['Sin', V4])).toBe('sin(vec4(1.0, 2.0, 3.0, 4.0))');
    expect(w(['Sin', V4])).toBe('sin(vec4f(1.0, 2.0, 3.0, 4.0))');
    expect(g(['Negate', V4])).toBe('(-(vec4(1.0, 2.0, 3.0, 4.0)))');
    expect(w(['Negate', V4])).toBe('(-(vec4f(1.0, 2.0, 3.0, 4.0)))');
  });

  it('a lowering that DESTRUCTURES its collection operand is left alone', () => {
    // `Median` spreads a constant-size list into one scalar argument per
    // element — a reduction, not a componentwise application.
    expect(g(['Median', ['List', 1, 5, 3, 2, 4]])).toBe(
      '_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)'
    );
  });

  it('an AGGREGATE-AWARE preamble helper is left alone', () => {
    // `_gpu_color_mix(vec3, vec3, float)` and `_gpu_apca(vec3, vec3)` are
    // declared over vectors: their operand shapes are the point.
    expect(
      g(['ColorMix', ['Tuple', 0.5, 0.2, 120], ['Tuple', 0.8, 0.1, 30], 0.25])
    ).toBe('_gpu_color_mix(vec3(0.5, 0.2, 120.0), vec3(0.8, 0.1, 30.0), 0.25)');
    expect(g(['ContrastingColor', ['Tuple', 0.5, 0.2, 120]])).toContain(
      '_gpu_apca(vec3(0.5, 0.2, 120.0)'
    );
  });

  it('an aggregate CONSTRUCTOR builds a shape from vector operands', () => {
    // `Matrix` assembles `vecN` columns — the gate must not read that as a
    // vector reaching a scalar lowering.
    expect(g(M2)).toBe('mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))');
    expect(w(M2)).toBe('mat2x2f(vec2f(1.0, 3.0), vec2f(2.0, 4.0))');
  });
});

describe('GPU OPERAND SHAPE GATE — a scalar in the WRONG argument slot', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  // The scalar-tailed overloads constrain the POSITION as well as the
  // presence: `mod(genType, float)` admits a scalar only LAST,
  // `step(float, genType)` only FIRST, `mix`/`refract` only third,
  // `clamp(genType, float, float)` only in the two bounds, `smoothstep(float,
  // float, genType)` only in the two edges. A name-only rule waved every
  // mixed call through, so `Mod(1, [1,2,3])` emitted `mod(1.0, vec3(…))` —
  // source no GLSL driver accepts — behind `success: true`.

  it('GLSL `mod(genType, float)` takes its scalar LAST', () => {
    expect(g(['Mod', V3, 1])).toBe('mod(vec3(1.0, 2.0, 3.0), 1.0)');
    expect(() => g(['Mod', 1, V3])).toThrow(
      /^Mod: the shader builtin `mod` takes a scalar only in argument 2, but here the scalar stands in argument 1/
    );
    // WGSL is unaffected: it lowers `Mod` to `%`, whose scalar/vector mixed
    // forms ARE defined, so there is no builtin overload to violate.
    expect(w(['Mod', 1, V3])).toBe(
      '((((1.0) % (vec3f(1.0, 2.0, 3.0))) + (vec3f(1.0, 2.0, 3.0))) % (vec3f(1.0, 2.0, 3.0)))'
    );
  });

  it('GLSL `step(float, genType)` takes its scalar FIRST', () => {
    expect(g(['Step', 1, V3])).toBe('step(1.0, vec3(1.0, 2.0, 3.0))');
    expect(() => g(['Step', V3, 1])).toThrow(
      /^Step: the shader builtin `step` takes a scalar only in argument 1, but here the scalar stands in argument 2/
    );
    // WGSL has no scalar-tailed `step` at all.
    expect(() => w(['Step', 1, V3])).toThrow(/MATCHING genType/);
  });

  it('`mix(genType, genType, float)` takes its scalar THIRD, in both languages', () => {
    expect(g(['Mix', V3, W3, 0.5])).toBe(
      'mix(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    expect(w(['Mix', V3, W3, 0.5])).toBe(
      'mix(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0), 0.5)'
    );
    for (const emit of [g, w]) {
      expect(() => emit(['Mix', 0.5, V3, W3])).toThrow(
        /takes a scalar only in argument 3, but here the scalar stands in argument 1/
      );
      expect(() => emit(['Mix', V3, 0.5, W3])).toThrow(
        /takes a scalar only in argument 3, but here the scalar stands in argument 2/
      );
    }
  });

  it('`refract(genType, genType, float)` takes its scalar THIRD, in both languages', () => {
    expect(g(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    expect(w(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3f(1.0, 2.0, 3.0), vec3f(4.0, 5.0, 6.0), 0.5)'
    );
    for (const emit of [g, w])
      expect(() => emit(['Refract', 0.5, V3, W3])).toThrow(
        /^Refract: the shader builtin `refract` takes a scalar only in argument 3, but here the scalar stands in argument 1/
      );
  });

  it('GLSL `clamp(genType, float, float)` takes its scalars in the BOUNDS', () => {
    expect(g(['Clamp', V3, 0, 1])).toBe('clamp(vec3(1.0, 2.0, 3.0), 0.0, 1.0)');
    expect(() => g(['Clamp', 0, V3, 1])).toThrow(
      /^Clamp: the shader builtin `clamp` takes a scalar only in arguments 2 and 3, but here the scalar stands in argument 1/
    );
    expect(() => w(['Clamp', V3, 0, 1])).toThrow(/MATCHING genType/);
  });

  it('GLSL `smoothstep(float, float, genType)` takes its scalars in the EDGES', () => {
    expect(g(['Smoothstep', 0, 1, V3])).toBe(
      'smoothstep(0.0, 1.0, vec3(1.0, 2.0, 3.0))'
    );
    // Slot 2 is a legal home for a scalar, slot 3 is not — the first
    // MISPLACED scalar is the one named.
    expect(() => g(['Smoothstep', V3, 0, 1])).toThrow(
      /takes a scalar only in arguments 1 and 2, but here the scalar stands in argument 3/
    );
  });

  it('a DECLARED vector operand is judged on its shape, not on its source', () => {
    // `v` lowers to a bare identifier with no `vecN` constructor to read, so
    // only the CE operand shapes can place it.
    const cev = new ComputeEngine();
    cev.declare('v', 'vector<3>');
    const gv = (expr: any): string => glsl.compile(cev.box(expr)).code!;
    expect(gv(['ElementMax', 'v', 2])).toBe('max(v, 2.0)');
    expect(() => gv(['ElementMax', 2, 'v'])).toThrow(
      /takes a scalar only in argument 2, but here the scalar stands in argument 1/
    );
    expect(gv(['Mod', 'v', 1])).toBe('mod(v, 1.0)');
    expect(() => gv(['Mod', 1, 'v'])).toThrow(/takes a scalar only in argument 2/);
  });

  it('a VARIADIC fold is judged on the emitted call tree', () => {
    // `ElementMax(a, b, c)` folds to `max(max(a, b), c)`: the CE operand
    // positions no longer line up with the emitted ones, so each nested call
    // is judged on its own arguments.
    expect(g(['ElementMax', V3, W3, 2])).toBe(
      'max(max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0)), 2.0)'
    );
    expect(() => g(['ElementMax', 2, V3, W3])).toThrow(
      /the emitted call `max\(2\.0, vec3\(1\.0, 2\.0, 3\.0\)\)` has a scalar in argument 1/
    );
  });

  it('every positional decline names the head and ends with the D6 marker', () => {
    expect(() => g(['Mod', 1, V3])).toThrow(/^Mod: .*Fail closed \(D6\)\.$/s);
    expect(() => w(['Mix', 0.5, V3, W3])).toThrow(
      /^Mix: .*Fail closed \(D6\)\.$/s
    );
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const [target, expr] of [
      [glsl, ['Mod', 1, V3]],
      [glsl, ['Step', V3, 1]],
      [glsl, ['Clamp', 0, V3, 1]],
      [wgsl, ['Mix', 0.5, V3, W3]],
      [wgsl, ['Refract', 0.5, V3, W3]],
    ] as const) {
      const r = target.compile(ce.box(expr as any), { fallback: true });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});

describe('GPU OPERAND SHAPE GATE — the two languages differ', () => {
  it('GLSL promotes a scalar in `max(genType, float)`; WGSL does not', () => {
    expect(g(['ElementMax', V3, 2])).toBe('max(vec3(1.0, 2.0, 3.0), 2.0)');
    expect(() => w(['ElementMax', V3, 2])).toThrow(/MATCHING genType/);
  });

  it('a matrix and a vector combine only under `*`, in both languages', () => {
    // `mat2 * vec2` is the matrix-vector product; `mat2 + vec2` has no
    // overload in either language.
    expect(g(['Multiply', M2, ['List', 5, 6]])).toContain(') * vec2(');
    expect(w(['Multiply', M2, ['List', 5, 6]])).toContain(') * vec2f(');
    expect(() => g(['Add', M2, ['List', 5, 6]])).toThrow(/only under `\*`/);
    expect(() => w(['Add', M2, ['List', 5, 6]])).toThrow(/only under `\*`/);
  });
});

describe('GPU OPERAND SHAPE GATE — the infix operator route', () => {
  // A typed symbol (`P` declared `vector<real^3>`) and a `Matrix` literal are
  // NOT `.isCollection`, so they used to take the raw infix path in the base
  // compiler with no shape check at all: `P + Q` for a vec3/vec2 pair and
  // `2.0 + mat2x2f(…)` on WGSL were emitted behind `success: true`. The infix
  // emission now runs through the same `checkOperandShapes` gate as the
  // function-call paths, with the DIMENSIONS of each operand, not just its
  // kind.
  //
  // Spec basis: GLSL 4.60 §5.9 (scalar mixes with a vector or matrix under
  // any of `+ - * /`; `mat±mat` and `mat/mat` componentwise with the same
  // dimensions; `*` linear-algebraic with the inner-dimension constraint;
  // unary operators include matrices). WGSL §8.7 (mixed scalar/vector forms
  // for every arithmetic operator; matrices ONLY under `mat±mat`,
  // `mat*scalar`, `mat*vec`/`vec*mat` and `mat*mat`; unary negation over
  // scalars and vecN only).
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  const cei = new ComputeEngine();
  cei.declare('P', 'vector<real^3>');
  cei.declare('Q', 'vector<real^2>');
  cei.declare('R', 'vector<real^3>');
  cei.declare('M2t', 'matrix<real^(2x2)>');
  cei.declare('N2t', 'matrix<real^(2x2)>');
  cei.declare('M3t', 'matrix<real^(3x3)>');
  cei.declare('Mu', 'matrix');
  const gi = (expr: any): string => glsl.compile(cei.box(expr)).code!;
  const wi = (expr: any): string => wgsl.compile(cei.box(expr)).code!;
  const M3 = [
    'Matrix',
    ['List', ['List', 1, 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]],
  ];
  const COL3 = ['Matrix', ['List', ['List', 1], ['List', 2], ['List', 3]]];

  it('typed vectors of DIFFERENT widths decline', () => {
    for (const emit of [gi, wi])
      expect(() => emit(['Add', 'P', 'Q'])).toThrow(
        /^Add: .*different widths \(vec3, vec2\).*Fail closed \(D6\)\.$/s
      );
  });

  it('matrices of DIFFERENT dimensions decline, componentwise and under `*`', () => {
    for (const emit of [gi, wi]) {
      expect(() => emit(['Add', M2, M3])).toThrow(
        /SAME dimensions.*\(mat2, mat3\)/s
      );
      expect(() => emit(['Add', 'M2t', 'M3t'])).toThrow(
        /SAME dimensions.*\(mat2, mat3\)/s
      );
      expect(() => emit(['Multiply', M2, M3])).toThrow(
        /dimensions must agree.*\(mat2, mat3\)/s
      );
    }
  });

  it('a matrix-vector product with disagreeing dimensions declines', () => {
    for (const emit of [gi, wi])
      expect(() => emit(['Multiply', M2, 'P'])).toThrow(
        /must agree.*\(mat2, vec3\)/s
      );
  });

  it('a matrix of unknown dimensions declines', () => {
    for (const emit of [gi, wi])
      expect(() => emit(['Add', 'Mu', 'Mu'])).toThrow(/not statically known/);
  });

  it('WGSL has no scalar±matrix overload; GLSL applies it componentwise', () => {
    expect(gi(['Add', M2, 2])).toBe(
      '2.0 + mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))'
    );
    expect(() => wi(['Add', M2, 2])).toThrow(
      /no overload for the operand shapes \(scalar, mat2\)/
    );
  });

  it('WGSL has no unary matrix negation; GLSL negates componentwise', () => {
    expect(gi(['Negate', M2])).toBe(
      '-mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))'
    );
    expect(() => wi(['Negate', M2])).toThrow(
      /unary `-` is declared over scalars and `vecN` only/
    );
  });

  it('valid scalar/vector infix shapes still compile, in both languages', () => {
    expect(gi(['Add', 'P', 'R'])).toBe('P + R');
    expect(wi(['Add', 'P', 'R'])).toBe('P + R');
    expect(gi(['Subtract', 'P', 'R'])).toBe('P + -R');
    expect(wi(['Subtract', 'P', 'R'])).toBe('P + -R');
    expect(gi(['Multiply', 'P', 'R'])).toBe('P * R');
    expect(wi(['Multiply', 'P', 'R'])).toBe('P * R');
    expect(gi(['Multiply', 2, 'P'])).toBe('2.0 * P');
    expect(wi(['Multiply', 2, 'P'])).toBe('2.0 * P');
    expect(gi(['Multiply', 'P', 2])).toBe('2.0 * P');
    expect(wi(['Multiply', 'P', 2])).toBe('2.0 * P');
    expect(gi(['Divide', 'P', 2])).toBe('0.5 * P');
    expect(wi(['Divide', 'P', 2])).toBe('0.5 * P');
    // WGSL §8.7 defines the mixed scalar/vector forms for EVERY arithmetic
    // operator, in both orders — same as GLSL §5.9.
    expect(gi(['Add', 'P', 2])).toBe('P + 2.0');
    expect(wi(['Add', 'P', 2])).toBe('P + 2.0');
    // Scalar-scalar arithmetic: the overwhelmingly common case.
    expect(gi(['Add', 'x', 1])).toBe('x + 1.0');
    expect(wi(['Add', 'x', 1])).toBe('x + 1.0');
  });

  it('valid matrix infix shapes still compile, in both languages', () => {
    expect(gi(['Multiply', M2, M2])).toContain(') * mat2(');
    expect(wi(['Multiply', M2, M2])).toContain(') * mat2x2f(');
    expect(gi(['Multiply', M2, 'Q'])).toContain(') * Q');
    expect(wi(['Multiply', M2, 'Q'])).toContain(') * Q');
    expect(gi(['Add', M2, M2])).toContain(') + mat2(');
    expect(wi(['Add', M2, M2])).toContain(') + mat2x2f(');
    expect(gi(['Multiply', M2, 2])).toContain('2.0 * mat2(');
    expect(wi(['Multiply', M2, 2])).toContain('2.0 * mat2x2f(');
    expect(gi(['Add', 'M2t', 'N2t'])).toBe('M2t + N2t');
    expect(wi(['Add', 'M2t', 'N2t'])).toBe('M2t + N2t');
  });

  it('an N×1 column Matrix literal is the vecN it flattens to', () => {
    expect(gi(['Add', COL3, COL3])).toBe(
      'vec3(1.0, 2.0, 3.0) + vec3(1.0, 2.0, 3.0)'
    );
    expect(wi(['Add', COL3, COL3])).toBe(
      'vec3f(1.0, 2.0, 3.0) + vec3f(1.0, 2.0, 3.0)'
    );
    // …and it still carries its width: vec3 + vec2 declines.
    expect(() => gi(['Add', COL3, 'Q'])).toThrow(/different widths/);
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const [target, expr] of [
      [glsl, ['Add', 'P', 'Q']],
      [wgsl, ['Add', M2, 2]],
      [wgsl, ['Negate', M2]],
      [glsl, ['Multiply', M2, M3]],
    ] as const) {
      const r = target.compile(cei.box(expr as any), { fallback: true });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});
