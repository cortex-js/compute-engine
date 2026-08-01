/**
 * `At` on the shader targets (GLSL / WGSL).
 *
 * `docs/plans/2026-08-01-at-gpu-compile-design.md`. The witness shape is
 * `p_0[i]` — a list with a STATICALLY DECLARED length, indexed by a loop or
 * instance variable inside a shader body. A runtime-length list has no shader
 * value at all, so the lowering is admissible only against a base whose
 * element count is static and whose elements are provably scalar numeric;
 * everything else declines with its OWN reason (Tycho item 109a).
 *
 * The lowering targets the NUMERIC-TARGET PROJECTION of `At`, not the raw
 * interpreter output: the interpreter's position-preserving absence marker
 * (`0` / out-of-range index) and its "no value at all" outcome (a non-integer
 * index leaves `At` unevaluated) both project to `NaN` (`_SYS.at`), and the
 * shader spells that `_gpu_nan()` on GLSL and `bitcast<f32>(0x7fc00000u)` on
 * WGSL — never a clamp. `at-collection-index-compile.test.ts` holds the
 * route-parity half of the story.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();
ce.declare('v', 'vector<3>');
ce.declare('w', 'vector<3>');
ce.declare('v2', 'vector<2>');
ce.declare('v4', 'vector<4>');
ce.declare('v7', 'vector<7>');
ce.declare('v1', 'vector<1>');
ce.declare('L', 'list<number>');
ce.declare('ys', 'list<number>');
ce.declare('tp', 'tuple');
ce.declare('t3', 'tuple<number, number, number>');
ce.declare('u', 'unknown');
ce.declare('str', 'string');
ce.declare('k', 'number');
ce.declare('sl', 'list<string>');
ce.declare('tc', 'tuple<complex, complex, complex>');
ce.declare('lc', 'list<complex^3>');
ce.declare('tns', 'tuple<number, string>');
ce.declare('vq', 'list<number^?>'); // unknown extent: `dimensions: [-1]`
ce.declare('_gpu_at5', 'number');

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

const g = (expr: any): string => glsl.compile(ce.box(expr)).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr)).code!;
const gPre = (expr: any): string => glsl.compile(ce.box(expr)).preamble ?? '';
const wPre = (expr: any): string => wgsl.compile(ce.box(expr)).preamble ?? '';

/** The decline message a shape produces on GLSL. */
const why = (expr: any): string => {
  try {
    g(expr);
  } catch (e: any) {
    return e.message as string;
  }
  throw new Error(`expected a decline, got \`${g(expr)}\``);
};

const GLSL_NAN = '_gpu_nan()';
const WGSL_NAN = 'bitcast<f32>(0x7fc00000u)';

const P: any = ['List', 10, 20, 30];

// The float-space guard, verbatim. `int()` is undefined outside the int range,
// so nothing may be cast before the range test; and the NEGATED compound
// swallows NaN and ±∞, which `floor` alone would not. Runtime behaviour is not
// testable in jest — the emitted guard IS the artifact.
const GLSL_AT3 = `
float _gpu_at3(vec3 v, float i) {
  // 1-based; negative counts from the end; anything else → NaN.
  // The guard runs entirely in float space: it rejects NaN, ±∞, huge
  // finite values, non-integers and 0 BEFORE the int cast (undefined
  // outside int range), and makes both languages' out-of-bounds rules
  // (GLSL UB / WGSL indeterminate) unreachable.
  if (!(i >= -3.0 && i <= 3.0) || i != floor(i) || i == 0.0)
    return _gpu_nan();
  int k = int(i);
  return v[(k > 0) ? k - 1 : 3 + k];
}
`;

// WGSL uses the INLINE bitcast — there is no `_gpu_nan` on WGSL — and
// `select(f, t, cond)` in place of `?:`.
const WGSL_AT3 = `
fn _gpu_at3(v: vec3f, i: f32) -> f32 {
  // 1-based; negative counts from the end; anything else → NaN.
  // The guard runs entirely in float space: it rejects NaN, ±∞, huge
  // finite values, non-integers and 0 BEFORE the int cast (undefined
  // outside int range), and makes both languages' out-of-bounds rules
  // (GLSL UB / WGSL indeterminate) unreachable.
  if (!(i >= -3.0 && i <= 3.0) || i != floor(i) || i == 0.0) {
    return bitcast<f32>(0x7fc00000u);
  }
  let k = i32(i);
  return v[select(3 + k, k - 1, k > 0)];
}
`;

// ---------------------------------------------------------------------------
// 1. Static folds — a literal index resolves against N at COMPILE time, so the
//    common form costs nothing at run time.
// ---------------------------------------------------------------------------

describe('At — static fold of a literal index (D1)', () => {
  test('an in-range positive index is a component swizzle', () => {
    expect(g(['At', 'v', 2])).toBe('v.y');
    expect(w(['At', 'v', 2])).toBe('v.y');
  });

  test('a negative index counts from the end', () => {
    expect(g(['At', 'v', -1])).toBe('v.z');
    expect(w(['At', 'v', -1])).toBe('v.z');
    expect(g(['At', 'v', -3])).toBe('v.x');
  });

  test('0, out-of-range and non-integer fold to the target NaN spelling', () => {
    // The interpreter yields the absence marker (`0`, out of range) or leaves
    // `At` unevaluated (non-integer); `_SYS.at` projects both to NaN.
    for (const i of [0, 5, -4, 1.5]) {
      expect(g(['At', 'v', i])).toBe(GLSL_NAN);
      expect(w(['At', 'v', i])).toBe(WGSL_NAN);
    }
  });

  test('a non-finite literal index folds to NaN too', () => {
    expect(g(['At', 'v', 'PositiveInfinity'])).toBe(GLSL_NAN);
    expect(w(['At', 'v', 'NaN'])).toBe(WGSL_NAN);
  });

  test('a LITERAL base with a literal index folds to the element literal', () => {
    // Not `vec3(10.0, 20.0, 30.0).y` — the element's own compiled literal.
    expect(g(['At', P, 2])).toBe('20.0');
    expect(w(['At', P, 2])).toBe('20.0');
    expect(g(['At', P, -1])).toBe('30.0');
  });

  test('a base wider than a vec4 takes a direct subscript', () => {
    // A `vector<7>` lowers to `float[7]` / `array<f32, 7>`, which has no
    // swizzle — but a constant subscript is provably in range.
    expect(g(['At', 'v7', 3])).toBe('v7[2]');
    expect(w(['At', 'v7', 3])).toBe('v7[2]');
    expect(g(['At', 'v7', -1])).toBe('v7[6]');
  });

  test('a parameterized tuple base is a vecN too', () => {
    expect(g(['At', 't3', 1])).toBe('t3.x');
  });

  test('a NON-ATOMIC base emission is parenthesized before the swizzle', () => {
    // The sibling point-list as-built rule: a bare identifier keeps the
    // emission atomic for the operand-shape gate (`v.y`); anything else is
    // parenthesized and judged as the compound it is.
    expect(g(['At', ['Add', 'v', 'w'], 2])).toBe('(v + w).y');
    expect(w(['At', ['Add', 'v', 'w'], 2])).toBe('(v + w).y');
    expect(g(['At', ['Add', 'v', 'w'], ['List', 1, 3]])).toBe('(v + w).xz');
  });
});

// ---------------------------------------------------------------------------
// 2. Dynamic index — the census witness. GLSL ES 3.00 and WGSL both permit
//    runtime indexing of a value-typed vector/array; the helper's guard is
//    what makes their out-of-bounds rules (UB / indeterminate) unreachable.
// ---------------------------------------------------------------------------

describe('At — dynamic index through the `_gpu_atN` helper (D1)', () => {
  test('the emission is one helper call', () => {
    expect(g(['At', 'v', 'k'])).toBe('_gpu_at3(v, k)');
    expect(w(['At', 'v', 'k'])).toBe('_gpu_at3(v, k)');
  });

  test('vec2 and vec4 bases get their own widths', () => {
    expect(g(['At', 'v2', 'k'])).toBe('_gpu_at2(v2, k)');
    expect(g(['At', 'v4', 'k'])).toBe('_gpu_at4(v4, k)');
    expect(w(['At', 'v4', 'k'])).toBe('_gpu_at4(v4, k)');
  });

  test('a wider base gets a per-N helper over `float[N]`, generated on demand', () => {
    expect(g(['At', 'v7', 'k'])).toBe('_gpu_at7(v7, k)');
    expect(gPre(['At', 'v7', 'k'])).toContain(
      'float _gpu_at7(float v[7], float i) {'
    );
    expect(gPre(['At', 'v7', 'k'])).toContain(
      'if (!(i >= -7.0 && i <= 7.0) || i != floor(i) || i == 0.0)'
    );
    expect(wPre(['At', 'v7', 'k'])).toContain(
      'fn _gpu_at7(v: array<f32, 7>, i: f32) -> f32 {'
    );
  });

  test('the GLSL preamble carries the helper AND `_gpu_nan`, IN THAT ORDER', () => {
    // The scans read the EMITTED code, never a helper BODY, so an emission
    // containing only `_gpu_at3(…)` must still FORCE the NaN helper — and GLSL
    // requires it declared first. Helper-mechanism drift tripwire: the
    // `_gpu_at*` branch must stay after the NaN branch in `preambleFor`.
    const pre = gPre(['At', 'v', 'k']);
    expect(pre).toContain('float _gpu_nan() {');
    expect(pre).toContain(GLSL_AT3);
    expect(pre.indexOf('float _gpu_nan()')).toBeLessThan(
      pre.indexOf('float _gpu_at3(')
    );
  });

  test('the GLSL helper body is pinned verbatim (the float-space guard)', () => {
    expect(gPre(['At', 'v', 'k'])).toContain(GLSL_AT3);
  });

  test('the WGSL helper body is pinned verbatim — inline bitcast, no `_gpu_nan`', () => {
    const pre = wPre(['At', 'v', 'k']);
    expect(pre).toBe(WGSL_AT3);
    expect(pre).not.toContain('_gpu_nan');
  });

  test('the WGSL ARRAY helper copies its parameter to a local first', () => {
    // Indexing a value-typed `array` PARAMETER by a runtime expression has
    // historically been restricted in WGSL (a `vecN` never was), and jest runs
    // no shader — so the array forms index a local `var` copy, which is a
    // reference. The vector forms keep indexing the parameter.
    const pre = wPre(['At', 'v7', 'k']);
    expect(pre).toContain(
      '  var a = v;\n  return a[select(7 + k, k - 1, k > 0)];'
    );
    expect(wPre(['At', 'v', 'k'])).not.toContain('var a = v;');
  });

  test('the helper scan reads CALL SITES, not any name that starts that way', () => {
    // A user symbol spelled `_gpu_at5` is not a helper call: generating one
    // for it emits a definition that REDECLARES the name.
    expect(g(['Add', '_gpu_at5', 1])).toBe('_gpu_at5 + 1.0');
    expect(gPre(['Add', '_gpu_at5', 1])).not.toContain('float _gpu_at5(');
    expect(gPre(['Add', '_gpu_at5', 1])).toBe('');
  });

  test('the helper is declared ONCE however often it is used', () => {
    const pre = gPre(['Add', ['At', 'v', 'k'], ['At', 'v', ['Add', 'k', 1]]]);
    expect(pre.match(/float _gpu_at3\(/g)).toHaveLength(1);
    expect(pre.match(/float _gpu_nan\(/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Composability — D1 ONLY. `At`'s type handler answers a scalar numeric
//    type for these shapes, so the parents' GPU shape gates see a scalar.
//    A GATHER is root-effective (its type is `list<…>` with no static
//    dimension), exactly like the sibling's point-list projections.
// ---------------------------------------------------------------------------

describe('At — composability of the SCALAR form (D1)', () => {
  test('arithmetic over a scalar access compiles', () => {
    expect(g(['Multiply', ['At', 'v', 'k'], 2])).toBe('2.0 * _gpu_at3(v, k)');
    expect(w(['Multiply', ['At', 'v', 'k'], 2])).toBe('2.0 * _gpu_at3(v, k)');
  });

  test('a builtin over a scalar access compiles', () => {
    expect(g(['Sin', ['At', 'v', 'k']])).toBe('sin(_gpu_at3(v, k))');
    expect(w(['Sin', ['At', 'v', 'k']])).toBe('sin(_gpu_at3(v, k))');
  });

  test('a static fold composes as the scalar it is', () => {
    expect(g(['Sin', ['At', 'v', 2]])).toBe('sin(v.y)');
  });
});

// ---------------------------------------------------------------------------
// 4. Evaluate-once and effect order.
// ---------------------------------------------------------------------------

describe('At — evaluate-once', () => {
  const count = (src: string, token: string): number =>
    src.match(new RegExp(`\\b${token}\\b`, 'g'))?.length ?? 0;

  test('base and index each appear exactly once in the D1 emission', () => {
    const src = g(['At', 'v', 'k']);
    expect(count(src, 'v')).toBe(1);
    expect(count(src, 'k')).toBe(1);
  });

  test('a static fold references the base once', () => {
    expect(count(g(['At', 'v', 2]), 'v')).toBe(1);
    expect(count(g(['At', 'v', ['List', 1, 3]]), 'v')).toBe(1);
  });

  // A literal base folds PER ELEMENT — the selected element is emitted, the
  // siblings are dropped — so the purity accounting is per element too. Asking
  // it of the whole literal over-declined `At([Random(), 1, 2], 1)`, whose
  // emission evaluates the draw exactly once, which is what the source says.
  describe('an IMPURE element of a literal base is accounted per element', () => {
    const impure: any = ['List', ['Random'], 1, 2];

    test('selecting the impure element compiles, emitting the draw ONCE', () => {
      expect(count(g(['At', impure, 1]), '_gpu_rnd_draw')).toBe(1);
      // Same accounting through the gather tier.
      const gather = g(['At', ['List', ['Random'], 2, 3], ['List', 1, 2]]);
      expect(count(gather, '_gpu_rnd_draw')).toBe(1);
      expect(gather).toMatch(/^vec2\(_gpu_rnd_draw\(.*\), 2\.0\)$/);
    });

    test('DISCARDING the impure element declines', () => {
      expect(why(['At', impure, 2])).toMatch(
        /element 1 of the literal base is impure and the access does not select it/
      );
      expect(why(['At', impure, ['List', 2, 3]])).toMatch(
        /element 1 of the literal base is impure and the gather does not select it/
      );
    });

    test('selecting the impure element TWICE declines', () => {
      // One element of the source, two evaluations of the draw.
      expect(why(['At', ['List', ['Random'], 2], ['List', 1, 1]])).toMatch(
        /impure and the gather selects it 2 times/
      );
    });

    test('a PURE sibling may be discarded freely', () => {
      // The out-of-range slot drops nothing that had to happen.
      expect(g(['At', impure, ['List', 1, 9]])).toMatch(
        /^vec2\(_gpu_rnd_draw\(.*\), _gpu_nan\(\)\)$/
      );
    });
  });

  test('an impure base AND an impure index decline', () => {
    // Neither language specifies the order a call evaluates its arguments in,
    // so two draws could commute between drivers.
    expect(why(['At', ['List', ['Random'], 1, 2], ['Random']])).toMatch(
      /neither shader language specifies the order/
    );
  });

  // A fold to NaN emits NEITHER operand. Dropping an impure one silently
  // removes a draw, which shifts the shader's whole random stream — the
  // discarded-operand rule the conditional forms already apply.
  describe('a fold to NaN may not DISCARD an impure operand', () => {
    const impure: any = ['List', ['Random'], 1, 2];

    test('an out-of-range literal index over an impure base declines', () => {
      expect(why(['At', impure, 9])).toMatch(/DISCARD the impure base/);
      expect(why(['At', impure, 0])).toMatch(/DISCARD the impure base/);
    });

    test('a `Missing` index over an impure base declines', () => {
      expect(why(['At', impure, 'Missing'])).toMatch(/DISCARD the impure base/);
    });

    test('an all-out-of-range gather over an impure base declines', () => {
      // Zero references to the base: the emission is `vec2(NaN, NaN)`.
      expect(why(['At', ['Add', 'v', ['Random']], ['List', 8, 9]])).toMatch(
        /gather selects no element of the base/
      );
    });

    test('the PURE equivalents still fold', () => {
      expect(g(['At', P, 9])).toBe(GLSL_NAN);
      expect(g(['At', P, 'Missing'])).toBe(GLSL_NAN);
      expect(g(['At', 'v', ['List', 8, 9]])).toBe(
        `vec2(${GLSL_NAN}, ${GLSL_NAN})`
      );
    });
  });

  test('an all-in-range gather over an impure base is ONE swizzle, so it compiles', () => {
    // The purity question is about the emission `gpuAtGather` actually takes:
    // a swizzle references the base once however many components it selects.
    const src = g(['At', ['Add', 'v', ['Random']], ['List', 1, 3]]);
    expect(src).toMatch(/\)\.xz$/);
    expect(count(src, '_gpu_rnd_draw')).toBe(1);
    // A mixed gather is a CONSTRUCTOR over the same slots, so it still
    // declines when it would reference the impure base twice.
    expect(why(['At', ['Add', 'v', ['Random']], ['List', 1, 3, 9]])).toMatch(
      /references the impure base more than once/
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Literal integer gather (D2, ruling 2).
// ---------------------------------------------------------------------------

describe('At — literal integer gather (D2)', () => {
  test('all slots in range over a vec base fold to a swizzle', () => {
    expect(g(['At', 'v', ['List', 1, 3]])).toBe('v.xz');
    expect(w(['At', 'v', ['List', 1, 3]])).toBe('v.xz');
    expect(g(['At', 'v', ['List', 3, 1, 3]])).toBe('v.zxz');
    expect(g(['At', 'v4', ['List', 1, 4]])).toBe('v4.xw');
  });

  test('an out-of-range slot forces a constructor with the NaN spelling', () => {
    // POSITION-PRESERVING: the result keeps the index list's length.
    expect(g(['At', 'v', ['List', 1, 9]])).toBe('vec2(v.x, _gpu_nan())');
    expect(w(['At', 'v', ['List', 1, 9]])).toBe(`vec2f(v.x, ${WGSL_NAN})`);
  });

  test('an array-shaped base gathers through a constructor of subscripts', () => {
    expect(g(['At', 'v7', ['List', 1, 3]])).toBe('vec2(v7[0], v7[2])');
    expect(w(['At', 'v7', ['List', 1, 3]])).toBe('vec2f(v7[0], v7[2])');
  });

  test('a literal base folds per element', () => {
    expect(g(['At', P, ['List', 1, 3]])).toBe('vec2(10.0, 30.0)');
    expect(g(['At', P, ['List', 1, 9]])).toBe('vec2(10.0, _gpu_nan())');
  });

  test('K = 1 declines — CE types it a 1-element LIST, which has no shader shape', () => {
    // Pinned at `at-collection-index-compile.test.ts`: `At(L, [2])` → `[20]`.
    expect(why(['At', 'v', ['List', 2]])).toMatch(/selects exactly 1 element/);
  });

  test('K = 0 declines — no zero-length value type', () => {
    expect(why(['At', 'v', ['List']])).toMatch(/selects 0 elements/);
  });

  test('K > 4 declines — the RESULT would be a vecK', () => {
    expect(why(['At', 'v', ['List', 1, 2, 3, 1, 2]])).toMatch(
      /the RESULT would be a `vec5`/
    );
  });

  test('a runtime-valued integer gather declines as demand-gated', () => {
    expect(why(['At', 'v', ['List', 'k', ['Add', 'k', 1]]])).toMatch(
      /static-count DYNAMIC gather is not lowered in this version/
    );
  });

  test('a literal list mixing a non-integer declines with its OWN reason', () => {
    // Not the "dynamic gather" text, which would be misleading.
    const m = why(['At', 'v', ['List', 1, 1.5]]);
    expect(m).toMatch(/is a literal that is not an integer/);
    expect(m).not.toMatch(/DYNAMIC gather/);
  });

  test('a NON-NUMERIC literal entry gets the same literal reason', () => {
    // Any literal that is not an integer selects no element. Classifying these
    // as runtime-valued handed them the demand-gated dynamic-gather text,
    // which describes something the caller did not write (D2).
    for (const entry of [{ str: 'a' }, ['List', 2, 3], 'Missing'] as any[]) {
      const m = why(['At', 'v', ['List', 1, entry]]);
      expect(m).toMatch(
        /entry 2 of the index list .* is a literal that is not/
      );
      expect(m).not.toMatch(/DYNAMIC gather/);
    }
  });

  test('the dynamic-gather reason counts the RUNTIME-VALUED entries', () => {
    // Not the list's length: `[1, k]` has one runtime-valued entry.
    expect(why(['At', 'v', ['List', 1, 'k']])).toMatch(
      /index list has 1 runtime-valued integer entry;/
    );
    expect(why(['At', 'v', ['List', 'k', ['Add', 'k', 1]]])).toMatch(
      /index list has 2 runtime-valued integer entries;/
    );
  });

  test('a literal list mixing integers with booleans declines', () => {
    expect(why(['At', 'v', ['List', 1, 'True']])).toMatch(
      /mixes integer entries with boolean ones/
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Masks. A LITERAL mask is statically a gather; a runtime-valued one is the
//    permanent decline of ruling 2.
// ---------------------------------------------------------------------------

describe('At — boolean masks (D2)', () => {
  test('a literal mask of matching length folds through the gather tier', () => {
    expect(g(['At', 'v', ['List', 'True', 'False', 'True']])).toBe('v.xz');
    expect(w(['At', 'v', ['List', 'True', 'False', 'True']])).toBe('v.xz');
  });

  test('a literal mask selecting one element hits the K=1 rule', () => {
    expect(why(['At', 'v', ['List', 'False', 'False', 'True']])).toMatch(
      /selects exactly 1 element/
    );
  });

  test('a statically mismatched mask length declines (the interpreter errors)', () => {
    expect(why(['At', 'v', ['List', 'True', 'False']])).toMatch(
      /mask's length must equal the collection's/
    );
  });

  test('a RUNTIME-VALUED mask declines, and the reason conveys permanence', () => {
    const m = why(['At', 'v', ['List', ['Greater', 'k', 0], 'True', 'False']]);
    expect(m).toMatch(/result LENGTH depends on how many of them are true/);
    expect(m).toMatch(/no shader lowering at all — it is not a missing tier/);
    // Not phrased as a TODO / not-yet tier.
    expect(m).not.toMatch(/not lowered in this version/);
  });
});

// ---------------------------------------------------------------------------
// 7. Discriminated declines (Tycho item 109a) — each shape names its own
//    cause; a caller must not have to guess from one shared "no lowering".
// ---------------------------------------------------------------------------

describe('At — every declining shape names its OWN cause', () => {
  const shapes: Array<[string, any, RegExp]> = [
    [
      'unknown-length base',
      ['At', 'L', 'k'],
      /base \(type `list<number>`\) has no statically known length/,
    ],
    [
      'unknown-length index symbol',
      ['At', 'v', 'ys'],
      /index is a collection \(type `list<number>`\) with no statically known length/,
    ],
    [
      'dictionary base',
      ['At', ['Dictionary', ['Tuple', { str: 'a' }, 1]], { str: 'a' }],
      /base is a dictionary .* shader has no keyed lookup/,
    ],
    ['string key', ['At', 'v', { str: 'a' }], /index is a string key/],
    [
      'multi-index',
      ['At', ['List', ['List', 1, 2], ['List', 3, 4]], 1, 2],
      /a multi-index access \(2 indices\)/,
    ],
    ['vector<1> base', ['At', 'v1', 1], /base has 1 element/],
    [
      'bare `tuple` base',
      ['At', 'tp', 1],
      /base is an unparameterized `tuple`/,
    ],
    ['`Missing` base', ['At', 'Missing', 1], /base is the absence marker/],
    [
      'aggregate (complex) element',
      ['At', ['List', 1, 2, 3, ['Complex', 1, 2]], 1],
      /element 4 of the base is itself an aggregate/,
    ],
    // The TYPE-based readings of the same question. `complex` IS a number and
    // lowers to a `vec2`, so "is it a number?" admitted these and emitted
    // `tc.x` — a component of a component — behind a reported success.
    [
      'non-real tuple slot',
      ['At', 'tc', 1],
      /slot 1 of the base tuple \(type `complex`\) is not a REAL scalar/,
    ],
    [
      'non-real list element type',
      ['At', 'lc', 1],
      /base's element type `complex` is not a REAL scalar/,
    ],
    [
      'non-real tuple slot (object domain)',
      ['At', 'tns', 1],
      /slot 2 of the base tuple \(type `string`\) is not a REAL scalar/,
    ],
    // An UNKNOWN extent is `dimensions: [-1]`, a sentinel and not a width;
    // untreated it emitted `_gpu_at-1(…)`, a call to a helper no preamble
    // generates.
    [
      'unknown-extent list base',
      ['At', 'vq', 'k'],
      /base \(type `vector`\) has no statically known length/,
    ],
    // The INDEX side of the same sentinel. Untreated, `-1` skipped the
    // no-static-count arm and described "a collection of -1 runtime-valued
    // entries" in the demand-gated text — where D4 makes an unknown-length
    // index list a PERMANENT decline.
    [
      'unknown-extent list index',
      ['At', 'v', 'vq'],
      /index is a collection \(type `vector`\) with no statically known length/,
    ],
  ];

  test.each(shapes)('%s', (_name, expr, pattern) => {
    expect(why(expr)).toMatch(pattern);
  });

  test('no two of them share a message', () => {
    const msgs = shapes.map(([, expr]) => why(expr));
    expect(new Set(msgs).size).toBe(msgs.length);
  });

  // A base whose ELEMENTS are object-domain never reaches the `At` entry: the
  // §3.F absence gate (`base-compiler.ts`) intercepts the node's
  // `T | missing` type first, with its own message. Stated here so nobody
  // hunts for a missing `At` reason.
  test('an object-domain element base is pre-empted by the §3.F gate', () => {
    expect(why(['At', ['List', 'True', 'False', 'True'], 1])).toMatch(
      /object-domain absent \('missing'\) position .* Discharge with 'Coalesce'/
    );
    expect(why(['At', 'sl', 1])).toMatch(/object-domain absent/);
  });
});

// ---------------------------------------------------------------------------
// 8. Index typing.
// ---------------------------------------------------------------------------

describe('At — index typing', () => {
  test('an `unknown`-typed index compiles (unknown-as-numeric-parameter)', () => {
    // The witness's loop variable routinely types as a wide union; a static
    // "provably numeric" gate would stop ordinary compilable code.
    expect(g(['At', 'v', 'u'])).toBe('_gpu_at3(v, u)');
  });

  test('a declared `string`-typed index declines, NAMING the type', () => {
    expect(why(['At', 'v', 'str'])).toMatch(
      /index \(type `string`\) is provably not a number/
    );
  });

  test('a boolean-typed index declines, naming the type', () => {
    expect(why(['At', 'v', 'True'])).toMatch(
      /index \(type `boolean`\) is provably not a number/
    );
  });

  test('a `Missing`-typed index folds to the NaN spelling', () => {
    expect(g(['At', 'v', 'Missing'])).toBe(GLSL_NAN);
    expect(w(['At', 'v', 'Missing'])).toBe(WGSL_NAN);
  });
});

// ---------------------------------------------------------------------------
// 9. CALLER-DECLARED names — the census witness's own shape. A `compileShader`
//    input and a `compileFunction` parameter are undeclared ENGINE symbols:
//    their boxed type says nothing, and the GPU declaration frame is the only
//    thing carrying their shader type (`gpuTypeOfValue` asks it first). Both
//    operands must be read from it.
// ---------------------------------------------------------------------------

describe('At — bases and indices the CALLER declared', () => {
  /** A one-statement fragment shader over the given inputs. */
  const shader = (
    inputs: Array<{ name: string; type: string }>,
    expr: any
  ): string =>
    glsl.compileShader({
      type: 'fragment',
      inputs,
      outputs: [{ name: 'o', type: 'float' }],
      body: [{ variable: 'o', expression: ce.box(expr) as any }],
    });

  const shaderWhy = (
    inputs: Array<{ name: string; type: string }>,
    expr: any
  ): string => {
    try {
      shader(inputs, expr);
    } catch (e: any) {
      return e.message as string;
    }
    throw new Error('expected a decline');
  };

  const VEC3_IN = { name: 'vin', type: 'vec3' };

  test('a declared `vec3` shader input is an admissible base', () => {
    expect(
      shader([VEC3_IN, { name: 'ki', type: 'float' }], ['At', 'vin', 'ki'])
    ).toContain('o = _gpu_at3(vin, ki);');
    expect(shader([VEC3_IN], ['At', 'vin', 2])).toContain('o = vin.y;');
  });

  test('a declared `vec3` function parameter is an admissible base', () => {
    const src = glsl.compileFunction(
      ce.box(['At', 'vv', 'kk']) as any,
      'f',
      'float',
      [
        ['vv', 'vec3'],
        ['kk', 'float'],
      ]
    );
    expect(src).toContain(
      'float f(vec3 vv, float kk) {\n  return _gpu_at3(vv, kk);'
    );
  });

  test('a declared base whose COMPONENTS are not floats declines, naming it', () => {
    expect(
      shaderWhy(
        [
          { name: 'iv', type: 'ivec3' },
          { name: 'ki', type: 'float' },
        ],
        ['At', 'iv', 'ki']
      )
    ).toMatch(
      /base is declared "ivec3" by the caller, whose components are not floats/
    );
  });

  test('a declared `bool` index declines, naming the declared type', () => {
    expect(
      shaderWhy([VEC3_IN, { name: 'bi', type: 'bool' }], ['At', 'vin', 'bi'])
    ).toMatch(/index is declared "bool" by the caller/);
  });

  test('a declared INTEGER index is converted at the call site', () => {
    // The helper's guard runs entirely in float space, so the index reaches it
    // as a float — `int` would not even bind to the parameter.
    expect(
      shader([VEC3_IN, { name: 'ii', type: 'int' }], ['At', 'vin', 'ii'])
    ).toContain('o = _gpu_at3(vin, float(ii));');
    // WGSL spells the conversion `f32`.
    expect(
      wgsl.compileFunction(ce.box(['At', 'vv', 'ii']) as any, 'f', 'f32', [
        ['vv', 'vec3f'],
        ['ii', 'i32'],
      ])
    ).toContain('return _gpu_at3(vv, f32(ii));');
  });
});

// ---------------------------------------------------------------------------
// 10. LOCALLY FRAMED names. The other half of the frame story: a `Block` local
//     and a parameter of a SYNTHESIZED user-function signature carry a WIDTH in
//     the shape frame and nothing else — no caller-declared type registers
//     alongside them. Their boxed type is `unknown`, which the
//     unknown-as-numeric-parameter rule reads as a float, so an
//     aggregate-valued one used as an INDEX emitted `_gpu_atN(v, p)` — a shader
//     type error behind a reported success, the same fail-open the declared
//     `bool` channel closes.
// ---------------------------------------------------------------------------

describe('At — an aggregate index whose shape lives only in a local frame', () => {
  test('a vector-valued `Block` local index declines, naming the width', () => {
    const m = why([
      'Block',
      ['Declare', 'p'],
      ['Assign', 'p', ['Tuple', 1, 2, 3]],
      ['At', 'v', 'p'],
    ]);
    expect(m).toMatch(/index is the local name "p", which holds an aggregate/);
    expect(m).toMatch(/of 3 components/);
  });

  test('a SCALAR `Block` local index still compiles', () => {
    // The frame's scalar sentinel is not an aggregate: the decline must be
    // about the width, not about being framed at all.
    expect(
      g(['Block', ['Declare', 'q'], ['Assign', 'q', 2], ['At', 'v', 'q']])
    ).toContain('_gpu_at3(v, q)');
  });

  test('a vector-typed user-function parameter index declines', () => {
    // A SYNTHESIZED signature: `gpuDeclaredTypeOf` has nothing for `p`, so the
    // frame's width is the only reading of it there is.
    const cef = new ComputeEngine();
    cef.declare('v', 'vector<3>');
    cef.declare('f', '(vector<3>) -> number');
    cef.assign('f', cef.box(['Function', ['At', 'v', 'p'], 'p']));
    let msg = '';
    try {
      new GLSLTarget().compile(cef.box(['f', 'v']));
    } catch (e: any) {
      msg = e.message;
    }
    expect(msg).toMatch(
      /index is the local name "p", which holds an aggregate/
    );
  });

  test('a vector-valued `Block` local BASE is still admissible', () => {
    // The base side reads the same frame for its WIDTH; only the index side
    // was fail-open.
    expect(
      g([
        'Block',
        ['Declare', 'p'],
        ['Assign', 'p', ['Tuple', 1, 2, 3]],
        ['At', 'p', 2],
      ])
    ).toContain('return p.y');
  });
});
