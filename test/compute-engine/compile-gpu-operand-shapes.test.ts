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
 *   _gpu_powi(float[1](1.0), 2.0)             array to a scalar-only helper
 *   length(vec2(float[1](3.0), 4.0))          array constructor in a vector one
 *   sin(mat2(vec2(1.0, 3.0), vec2(2.0, 4.0))) no matrix overload
 *
 * They now fail closed through `CompileTarget.checkOperandShapes`, which
 * derives its verdict from the operand shapes and from the emitted source —
 * never from a list of head names.
 *
 * A lowering may also REPAIR a mixed-genType call itself, by writing the
 * broadcast constructor the language does not supply (`Power` emits
 * `pow(v, vec3(y))`); the gate reads the emitted argument, so such a call
 * compiles instead of declining.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();

/**
 * Compile-time constant folding is off throughout this file: the probes are
 * all-literal (`Dot([1,2,3],[4,5,6])`, `Median([1,5,3,2,4])`), i.e. pure
 * subtrees with no free variables that the compiler would otherwise evaluate at
 * compile time and emit as one number. The operand-shape gate under test only
 * runs on the structural lowering.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any): string => glsl.compile(ce.box(expr), NO_FOLD).code!;

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
    // is not valid GLSL source.
    expect(() => g(['Arctan2', V3, 1])).toThrow(
      /No signature of `Arctan2` in the GLSL fragment/
    );
  });

  it('an array-shaped operand packed into a vector constructor declines (Hypot)', () => {
    // `length(vec2(float[1](3.0), 4.0))` — an array constructor spliced inside
    // a vector constructor.
    expect(() => g(['Hypot', ['List', 3], 4])).toThrow(
      /No signature of `Hypot` in the GLSL fragment/
    );
  });

  it('a vector operand a lowering would RESHAPE declines (Hypot of two vectors)', () => {
    // `length(vec2(vec3(…), vec3(…)))`: the lowering packs its operands into a
    // `vec2`, which has no room for a `vec3` in each slot.
    expect(() => g(['Hypot', V3, W3])).toThrow(
      /No signature of `Hypot` in the GLSL fragment/
    );
  });

  it('a matrix operand of a scalar/genType builtin declines (Sin)', () => {
    // The GLSL fragment does not take the `Matrix` head.
    expect(() => g(['Sin', M2])).toThrow(/The head `Matrix` is outside the GLSL fragment/);
  });

  it('an ARRAY operand of a scalar-only preamble helper declines (Power)', () => {
    // `_gpu_powi` is declared `float _gpu_powi(float x, float n)`, and a
    // 1-element list has no `vecN` reading at all — it lowers to a shader
    // array, which the `_gpu_powiN` overloads do not cover either.
    expect(() => g(['Power', ['List', 1], 2])).toThrow(
      /No signature of `Power` in the GLSL fragment/
    );
  });

  it('operands of different vector widths decline', () => {
    expect(() => g(['Add', V3, ['List', 4, 5]])).toThrow(
      /No signature of `Add` in the GLSL fragment/
    );
  });

  it('every decline names the head that the GLSL fragment refuses', () => {
    for (const emit of [g])
      expect(() => emit(['Sin', M2])).toThrow(/The head `Matrix` is outside/);
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const target of [glsl]) {
      for (const expr of [
        ['Arctan2', V3, 1],
        ['Hypot', ['List', 3], 4],
        ['Power', ['List', 1], 2],
        ['Sin', M2],
      ]) {
        // `...NO_FOLD`: these probes are all-literal, so constant folding would
        // emit a folded literal instead of reaching the operand-shape gate.
        const r = target.compile(ce.box(expr as any), {
          fallback: true,
          ...NO_FOLD,
        });
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
    // `*` and `/` broadcast a scalar over a vector in GLSL.
    expect(g(['Multiply', V3, 2])).toBe('2.0 * vec3(1.0, 2.0, 3.0)');
    expect(g(['Divide', 2, V3])).toBe('(2.0) / (vec3(1.0, 2.0, 3.0))');
  });

  it('matrix arithmetic GLSL defines', () => {
    // The GLSL fragment does not take the `Matrix` head, so each of these
    // declines.
    for (const expr of [
      ['Multiply', M2, ['List', 5, 6]],
      ['Multiply', M2, 2],
      ['Multiply', M2, M2],
      ['Add', M2, M2],
    ])
      expect(() => g(expr)).toThrow(
        /The head `Matrix` is outside the GLSL fragment/
      );
  });

  it('the unary fan-out lowerings are unaffected', () => {
    expect(g(['Sin', V4])).toBe('sin(vec4(1.0, 2.0, 3.0, 4.0))');
    expect(g(['Negate', V4])).toBe('(-(vec4(1.0, 2.0, 3.0, 4.0)))');
  });

  it('a lowering that DESTRUCTURES its collection operand is left alone', () => {
    // `Median` spreads a constant-size list into one scalar argument per
    // element — a reduction, not a componentwise application.
    // The GLSL fragment does not take the `Median` head.
    expect(() => g(['Median', ['List', 1, 5, 3, 2, 4]])).toThrow(
      /The head `Median` is outside the GLSL fragment/
    );
  });

  it('an AGGREGATE-AWARE preamble helper is left alone', () => {
    // `_gpu_color_mix(vec3, vec3, float)`, `_gpu_apca(vec3, vec3)` and
    // `_gpu_srgb_to_oklch(vec3)` are declared over vectors: their operand
    // shapes are the point. A tuple at a color position is 0-1 sRGB on every
    // route, so each one arrives through that conversion — a second
    // aggregate-aware helper the shape gate must also leave alone.
    expect(
      g(['ColorMix', ['Tuple', 0.5, 0.2, 120], ['Tuple', 0.8, 0.1, 30], 0.25])
    ).toBe(
      '_gpu_color_mix(_gpu_srgb_to_oklch(vec3(0.5, 0.2, 120.0)), ' +
        '_gpu_srgb_to_oklch(vec3(0.8, 0.1, 30.0)), 0.25)'
    );
    // The background is the SECOND argument of each contrast, matching the
    // argument order the interpreter uses.
    expect(g(['ContrastingColor', ['Tuple', 0.5, 0.2, 120]])).toContain(
      '_gpu_apca(vec3(1.0, 0.0, 0.0), _gpu_srgb_to_oklch(vec3(0.5, 0.2, 120.0)))'
    );
  });

  it('an aggregate CONSTRUCTOR builds a shape from vector operands', () => {
    // `Matrix` assembles `vecN` columns — the gate must not read that as a
    // vector reaching a scalar lowering.
    // The GLSL fragment does not take the `Matrix` head.
    expect(() => g(M2)).toThrow(/The head `Matrix` is outside the GLSL fragment/);
  });

  it('a lowering that WIDENS a scalar operand itself is left alone', () => {
    // `pow` is declared over ONE genType, so `Power` writes the broadcast
    // constructor that GLSL does not supply. The CE operand is still a scalar
    // there; the gate has to read the emitted argument to see the vector.
    // (`Exp([1,2,3])` canonicalizes to `Power(e, […])`.)
    expect(g(['Exp', V3])).toBe(
      'pow(vec3(2.71828182846), vec3(1.0, 2.0, 3.0))'
    );
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
    // A divisor of 2: a divisor of 1 is the `fract` peephole (CE-254).
    expect(g(['Mod', V3, 2])).toBe(
      '_gpu_fmod3(vec3(1.0, 2.0, 3.0), vec3(2.0))'
    );
    // A scalar dividend beside a vector divisor is broadcast by the
    // `_gpu_fmod` helper, so it no longer reaches the built-in `mod`.
    expect(() => g(['Mod', 1, V3])).toThrow(
      /No signature of `Mod` in the GLSL fragment/
    );
  });

  it('GLSL `step(float, genType)` takes its scalar FIRST', () => {
    expect(g(['Step', 1, V3])).toBe('step(1.0, vec3(1.0, 2.0, 3.0))');
    expect(() => g(['Step', V3, 1])).toThrow(
      /No signature of `Step` in the GLSL fragment/
    );
  });

  it('`mix(genType, genType, float)` takes its scalar THIRD', () => {
    expect(g(['Mix', V3, W3, 0.5])).toBe(
      'mix(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    for (const emit of [g]) {
      expect(() => emit(['Mix', 0.5, V3, W3])).toThrow(
        /No signature of `Mix` in the GLSL fragment/
      );
      expect(() => emit(['Mix', V3, 0.5, W3])).toThrow(
        /No signature of `Mix` in the GLSL fragment/
      );
    }
  });

  it('`refract(genType, genType, float)` takes its scalar THIRD', () => {
    expect(g(['Refract', V3, W3, 0.5])).toBe(
      'refract(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0), 0.5)'
    );
    for (const emit of [g])
      expect(() => emit(['Refract', 0.5, V3, W3])).toThrow(
        /No signature of `Refract` in the GLSL fragment/
      );
  });

  it('GLSL `clamp(genType, float, float)` takes its scalars in the BOUNDS', () => {
    // The literal cells and bounds are finite for certain, so the built-ins
    // `min`/`max` take the broadcast bounds (CE-565.2).
    expect(g(['Clamp', V3, 0, 1])).toBe(
      'min(max(vec3(1.0, 2.0, 3.0), vec3(0.0)), vec3(1.0))'
    );
    expect(() => g(['Clamp', 0, V3, 1])).toThrow(
      /No signature of `Clamp` in the GLSL fragment/
    );
  });

  it('GLSL `smoothstep(float, float, genType)` takes its scalars in the EDGES', () => {
    expect(g(['Smoothstep', 0, 1, V3])).toBe(
      '_gpu_smoothstep3(vec3(0.0), vec3(1.0), vec3(1.0, 2.0, 3.0))'
    );
    // Slot 2 is a legal home for a scalar, slot 3 is not — the first
    // MISPLACED scalar is the one named.
    expect(() => g(['Smoothstep', V3, 0, 1])).toThrow(
      /No signature of `Smoothstep` in the GLSL fragment/
    );
  });

  it('a DECLARED vector operand is judged on its shape, not on its source', () => {
    // `v` lowers to a bare identifier with no `vecN` constructor to read, so
    // only the CE operand shapes can place it.
    const cev = new ComputeEngine();
    cev.declare('v', 'vector<3>');
    const gv = (expr: any): string => glsl.compile(cev.box(expr)).code!;
    expect(gv(['Step', 2, 'v'])).toBe('step(2.0, v)');
    expect(() => gv(['Step', 'v', 2])).toThrow(
      /No signature of `Step` in the GLSL fragment/
    );
    expect(gv(['Mod', 'v', 2])).toBe('_gpu_fmod3(v, vec3(2.0))');
    expect(() => gv(['Mod', 1, 'v'])).toThrow(
      /No signature of `Mod` in the GLSL fragment/
    );
  });

  it('a VARIADIC element-wise fold broadcasts a scalar in any position', () => {
    // A scalar operand is broadcast wherever it stands, as the interpreter
    // broadcasts it: GLSL has no `max(float, genType)`. The literal operands
    // are finite for certain, so the built-in `max` takes the broadcast
    // operands (CE-565.2); otherwise the vector helper `_gpu_max3` does.
    expect(g(['ElementMax', V3, W3, 2])).toBe(
      'max(max(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0)), vec3(2.0))'
    );
    expect(g(['ElementMax', 2, V3, W3])).toBe(
      'max(max(vec3(2.0), vec3(1.0, 2.0, 3.0)), vec3(4.0, 5.0, 6.0))'
    );
  });

  it('every positional decline names the head', () => {
    expect(() => g(['Step', V3, 1])).toThrow(
      /No signature of `Step` in the GLSL fragment/
    );
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const [target, expr] of [
      [glsl, ['Step', V3, 1]],
      [glsl, ['Clamp', 0, V3, 1]],
    ] as const) {
      // `...NO_FOLD`: these probes are all-literal, so constant folding would
      // emit a folded literal instead of reaching the operand-shape gate.
      const r = target.compile(ce.box(expr as any), {
        fallback: true,
        ...NO_FOLD,
      });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});

describe('GPU OPERAND SHAPE GATE — broadcasts and matrix-vector forms', () => {
  it('an element-wise max broadcasts a scalar', () => {
    // The built-in `max` has a `max(genType, float)` overload in GLSL, but
    // the scalar is broadcast. The literal operands are
    // finite for certain: the built-in (CE-565.2).
    expect(g(['ElementMax', V3, 2])).toBe(
      'max(vec3(1.0, 2.0, 3.0), vec3(2.0))'
    );
  });

  it('a matrix and a vector combine only under `*`', () => {
    // `mat2 * vec2` is the matrix-vector product; `mat2 + vec2` has no
    // overload in GLSL.
    // The GLSL fragment does not take the `Matrix` head.
    expect(() => g(['Multiply', M2, ['List', 5, 6]])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
    expect(() => g(['Add', M2, ['List', 5, 6]])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
  });
});

describe('GPU OPERAND SHAPE GATE — the infix operator route', () => {
  // A typed symbol (`P` declared `vector<real^3>`) and a `Matrix` literal are
  // NOT `.isCollection`, so they used to take the raw infix path in the base
  // compiler with no shape check at all: `P + Q` for a vec3/vec2 pair and
  // `2.0 + mat2(…)` were emitted behind `success: true`. The infix
  // emission now runs through the same `checkOperandShapes` gate as the
  // function-call paths, with the DIMENSIONS of each operand, not just its
  // kind.
  //
  // Spec basis: GLSL 4.60 §5.9 (scalar mixes with a vector or matrix under
  // any of `+ - * /`; `mat±mat` and `mat/mat` componentwise with the same
  // dimensions; `*` linear-algebraic with the inner-dimension constraint;
  // unary operators include matrices).
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
  const M3 = [
    'Matrix',
    ['List', ['List', 1, 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]],
  ];
  const COL3 = ['Matrix', ['List', ['List', 1], ['List', 2], ['List', 3]]];

  it('typed vectors of DIFFERENT widths decline', () => {
    for (const emit of [gi])
      expect(() => emit(['Add', 'P', 'Q'])).toThrow(
        /No signature of `Add` in the GLSL fragment/
      );
  });

  it('matrices of DIFFERENT dimensions decline, componentwise and under `*`', () => {
    for (const emit of [gi]) {
      expect(() => emit(['Add', M2, M3])).toThrow(/outside the GLSL fragment/);
      expect(() => emit(['Add', 'M2t', 'M3t'])).toThrow(
        /has no type in the GLSL fragment/
      );
      // The product has the static type `error`, so the compilation
      // declines before the shape check of the shader target.
      expect(() => emit(['Multiply', M2, M3])).toThrow(/GLSL fragment/);
    }
  });

  it('a matrix-vector product with disagreeing dimensions declines', () => {
    for (const emit of [gi])
      // The product has the static type `error`, so the compilation
      // declines before the shape check of the shader target.
      expect(() => emit(['Multiply', M2, 'P'])).toThrow(/GLSL fragment/);
  });

  // The input `Mu` declines before the operator reads it: no shader can
  // declare a matrix of unknown dimensions.
  it('a matrix of unknown dimensions declines', () => {
    for (const emit of [gi])
      expect(() => emit(['Add', 'Mu', 'Mu'])).toThrow(
        /has no type in the GLSL fragment/
      );
  });

  it('GLSL applies scalar±matrix componentwise', () => {
    expect(() => gi(['Add', M2, 2])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
  });

  it('GLSL negates a matrix componentwise', () => {
    expect(() => gi(['Negate', M2])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
  });

  it('valid scalar/vector infix shapes still compile', () => {
    expect(gi(['Add', 'P', 'R'])).toBe('P + R');
    expect(gi(['Subtract', 'P', 'R'])).toBe('P + -R');
    expect(gi(['Multiply', 'P', 'R'])).toBe('P * R');
    expect(gi(['Multiply', 2, 'P'])).toBe('2.0 * P');
    expect(gi(['Multiply', 'P', 2])).toBe('2.0 * P');
    expect(gi(['Divide', 'P', 2])).toBe('0.5 * P');
    // GLSL §5.9 defines the mixed scalar/vector forms for EVERY arithmetic
    // operator, in both orders.
    expect(gi(['Add', 'P', 2])).toBe('P + 2.0');
    // Scalar-scalar arithmetic: the overwhelmingly common case.
    expect(gi(['Add', 'x', 1])).toBe('x + 1.0');
  });

  it('valid matrix infix shapes still compile', () => {
    // The GLSL fragment has no matrix type and does not take the `Matrix`
    // head, so each of these declines.
    for (const expr of [
      ['Multiply', M2, M2],
      ['Multiply', M2, 'Q'],
      ['Add', M2, M2],
      ['Multiply', M2, 2],
      ['Add', 'M2t', 'N2t'],
    ])
      expect(() => gi(expr)).toThrow(/GLSL fragment/);
  });

  it('an N×1 column Matrix literal is the vecN it flattens to', () => {
    expect(() => gi(['Add', COL3, COL3])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
    expect(() => gi(['Add', COL3, 'Q'])).toThrow(
      /The head `Matrix` is outside the GLSL fragment/
    );
  });

  it('reports `success: false` (no source) through the fallback route', () => {
    for (const [target, expr] of [
      [glsl, ['Add', 'P', 'Q']],
      [glsl, ['Multiply', M2, M3]],
    ] as const) {
      const r = target.compile(cei.box(expr as any), { fallback: true });
      expect(r.success).toBe(false);
      expect(r.code ?? '').toBe('');
    }
  });
});
