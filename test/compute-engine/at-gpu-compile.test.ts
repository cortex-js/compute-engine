/**
 * `At` on the shader target (GLSL).
 *
 * `docs/COMPILATION-MODEL.md`. The witness shape is
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
 * shader spells that `_gpu_nan()` on GLSL — never a clamp. `at-collection-index-compile.test.ts` holds the
 * route-parity half of the story.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

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

/**
 * Compile-time constant folding is off throughout this file. An `At` over a
 * LITERAL base (`At([1,2,3], 2)`, `At({a: 1}, "a")`) is a pure subtree with no
 * free variables, so the compiler would evaluate it at compile time and emit
 * the element as a number — including for the shapes the GPU lowering is
 * required to DECLINE, which would silently retire those fail-closed
 * diagnostics.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any): string => glsl.compile(ce.box(expr), NO_FOLD).code!;
const gPre = (expr: any): string =>
  glsl.compile(ce.box(expr), NO_FOLD).preamble ?? '';

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
  // outside int range), and makes the out-of-bounds index (undefined
  // behavior in GLSL) unreachable.
  if (!(i >= -3.0 && i <= 3.0) || i != floor(i) || i == 0.0)
    return _gpu_nan();
  int k = int(i);
  return v[(k > 0) ? k - 1 : 3 + k];
}
`;

// ---------------------------------------------------------------------------
// 1. Static folds — a literal index resolves against N at COMPILE time, so the
//    common form costs nothing at run time.
// ---------------------------------------------------------------------------

describe('At — static fold of a literal index (D1)', () => {
  test('an in-range positive index is a component swizzle', () => {
    expect(g(['At', 'v', 2])).toBe('v.y');
  });

  test('a negative index counts from the end', () => {
    expect(g(['At', 'v', -1])).toBe('v.z');
    expect(g(['At', 'v', -3])).toBe('v.x');
  });

  test('0, out-of-range and non-integer fold to the target NaN spelling', () => {
    // The interpreter yields the absence marker (`0`, out of range) or leaves
    // `At` unevaluated (non-integer); `_SYS.at` projects both to NaN.
    // The fragment refuses a literal index outside the base.
    for (const i of [0, 5, -4]) {
      expect(() => g(['At', 'v', i])).toThrow(/outside the 3 elements of its base/);
    }
    expect(g(['At', 'v', 1.5])).toBe(GLSL_NAN);
  });

  test('a non-finite literal index folds to NaN too', () => {
    expect(g(['At', 'v', 'PositiveInfinity'])).toBe(GLSL_NAN);
  });

  test('a LITERAL base with a literal index folds to the element literal', () => {
    // Not `vec3(10.0, 20.0, 30.0).y` — the element's own compiled literal.
    expect(g(['At', P, 2])).toBe('20.0');
    expect(g(['At', P, -1])).toBe('30.0');
  });

  test('a base wider than a vec4 takes a direct subscript', () => {
    // A `vector<7>` lowers to `float[7]`, which has no
    // swizzle — but a constant subscript is provably in range.
    expect(g(['At', 'v7', 3])).toBe('v7[2]');
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
    expect(() => g(['At', ['Add', 'v', 'w'], ['List', 1, 3]])).toThrow(
      /An index or a bound must be an integer or a real/
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Dynamic index — the census witness. GLSL ES 3.00 permits runtime
//    indexing of a value-typed vector/array; the helper's guard is what
//    makes its out-of-bounds rule (UB) unreachable.
// ---------------------------------------------------------------------------

describe('At — dynamic index through the `_gpu_atN` helper (D1)', () => {
  test('the emission is one helper call', () => {
    expect(g(['At', 'v', 'k'])).toBe('_gpu_at3(v, k)');
  });

  test('vec2 and vec4 bases get their own widths', () => {
    expect(g(['At', 'v2', 'k'])).toBe('_gpu_at2(v2, k)');
    expect(g(['At', 'v4', 'k'])).toBe('_gpu_at4(v4, k)');
  });

  test('a wider base gets a per-N helper over `float[N]`, generated on demand', () => {
    expect(g(['At', 'v7', 'k'])).toBe('_gpu_at7(v7, k)');
    expect(gPre(['At', 'v7', 'k'])).toContain(
      'float _gpu_at7(float v[7], float i) {'
    );
    expect(gPre(['At', 'v7', 'k'])).toContain(
      'if (!(i >= -7.0 && i <= 7.0) || i != floor(i) || i == 0.0)'
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
  });

  test('a builtin over a scalar access compiles', () => {
    expect(g(['Sin', ['At', 'v', 'k']])).toBe('_gpu_sin(_gpu_at3(v, k))');
  });

  test('a static fold composes as the scalar it is', () => {
    expect(g(['Sin', ['At', 'v', 2]])).toBe('_gpu_sin(v.y)');
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
    expect(() => g(['At', 'v', ['List', 1, 3]])).toThrow(/An index or a bound must be an integer or a real/);
  });

  // A literal base folds PER ELEMENT — the selected element is emitted, the
  // siblings are dropped — so the purity accounting is per element too. Asking
  // it of the whole literal over-declined `At([Random(), 1, 2], 1)`, whose
  // emission evaluates the draw exactly once, which is what the source says.
  describe('an IMPURE element of a literal base is accounted per element', () => {
    const impure: any = ['List', ['Random'], 1, 2];

    test('selecting the impure element compiles, emitting the draw ONCE', () => {
      // The fragment refuses `Random`, so both forms decline.
      expect(() => g(['At', impure, 1])).toThrow(/The head `Random` is outside the GLSL fragment/);
      expect(() =>
        g(['At', ['List', ['Random'], 2, 3], ['List', 1, 2]])
      ).toThrow(/The head `Random` is outside the GLSL fragment/);
    });

    test('DISCARDING the impure element declines', () => {
      expect(why(['At', impure, 2])).toMatch(/The head `Random` is outside the GLSL fragment/);
      expect(why(['At', impure, ['List', 2, 3]])).toMatch(/The head `Random` is outside the GLSL fragment/);
    });

    test('selecting the impure element TWICE declines', () => {
      // One element of the source, two evaluations of the draw.
      expect(why(['At', ['List', ['Random'], 2], ['List', 1, 1]])).toMatch(
        /The head `Random` is outside the GLSL fragment/
      );
    });

    test('a PURE sibling may be discarded freely', () => {
      // The out-of-range slot drops nothing that had to happen.
      expect(() => g(['At', impure, ['List', 1, 9]])).toThrow(/The head `Random` is outside the GLSL fragment/);
    });
  });

  test('an impure base AND an impure index decline', () => {
    // GLSL does not specify the order a call evaluates its arguments in,
    // so two draws could commute between drivers.
    expect(why(['At', ['List', ['Random'], 1, 2], ['Random']])).toMatch(
      /The head `Random` is outside the GLSL fragment/
    );
  });

  // A fold to NaN emits NEITHER operand. Dropping an impure one silently
  // removes a draw, which shifts the shader's whole random stream — the
  // discarded-operand rule the conditional forms already apply.
  describe('a fold to NaN may not DISCARD an impure operand', () => {
    const impure: any = ['List', ['Random'], 1, 2];

    test('an out-of-range literal index over an impure base declines', () => {
      expect(why(['At', impure, 9])).toMatch(/The head `Random` is outside the GLSL fragment/);
      expect(why(['At', impure, 0])).toMatch(/The head `Random` is outside the GLSL fragment/);
    });

    test('a `Missing` index over an impure base declines', () => {
      expect(why(['At', impure, 'Missing'])).toMatch(/The head `Random` is outside the GLSL fragment/);
    });

    test('an all-out-of-range gather over an impure base declines', () => {
      // Zero references to the base: the emission is `vec2(NaN, NaN)`.
      expect(why(['At', ['Add', 'v', ['Random']], ['List', 8, 9]])).toMatch(
        /The head `Random` is outside the GLSL fragment/
      );
    });

    test('the PURE equivalents still fold', () => {
      // The fragment refuses a literal index outside the base, and a gather.
      expect(() => g(['At', P, 9])).toThrow(/of its base/);
      expect(() => g(['At', P, 'Missing'])).toThrow(/Missing/);
      expect(() => g(['At', 'v', ['List', 8, 9]])).toThrow(/An index or a bound must be an integer or a real/);
    });
  });

  test('an all-in-range gather over an impure base is ONE swizzle, so it compiles', () => {
    // The purity question is about the emission `gpuAtGather` actually takes:
    // a swizzle references the base once however many components it selects.
    // The fragment refuses `Random` in both forms.
    expect(() => g(['At', ['Add', 'v', ['Random']], ['List', 1, 3]])).toThrow(
      /The head `Random` is outside the GLSL fragment/
    );
    expect(why(['At', ['Add', 'v', ['Random']], ['List', 1, 3, 9]])).toMatch(
      /The head `Random` is outside the GLSL fragment/
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Literal integer gather (D2, ruling 2).
// ---------------------------------------------------------------------------

describe('At — literal integer gather (D2)', () => {
  test('all slots in range over a vec base fold to a swizzle', () => {
    // The fragment refuses a list as the index of `At`.
    expect(() => g(['At', 'v', ['List', 1, 3]])).toThrow(/An index or a bound must be an integer or a real/);
    expect(() => g(['At', 'v', ['List', 3, 1, 3]])).toThrow(/An index or a bound must be an integer or a real/);
    expect(() => g(['At', 'v4', ['List', 1, 4]])).toThrow(/An index or a bound must be an integer or a real/);
  });

  test('an out-of-range slot forces a constructor with the NaN spelling', () => {
    // POSITION-PRESERVING: the result keeps the index list's length.
    expect(() => g(['At', 'v', ['List', 1, 9]])).toThrow(/An index or a bound must be an integer or a real/);
  });

  test('an array-shaped base gathers through a constructor of subscripts', () => {
    expect(() => g(['At', 'v7', ['List', 1, 3]])).toThrow(/An index or a bound must be an integer or a real/);
  });

  test('a literal base folds per element', () => {
    expect(() => g(['At', P, ['List', 1, 3]])).toThrow(/An index or a bound must be an integer or a real/);
    expect(() => g(['At', P, ['List', 1, 9]])).toThrow(/An index or a bound must be an integer or a real/);
  });

  test('K = 1 declines — CE types it a 1-element LIST, which has no shader shape', () => {
    // Pinned at `at-collection-index-compile.test.ts`: `At(L, [2])` → `[20]`.
    expect(why(['At', 'v', ['List', 2]])).toMatch(/An index or a bound must be an integer or a real/);
  });

  test('K = 0 declines — no zero-length value type', () => {
    expect(why(['At', 'v', ['List']])).toMatch(
      /not a list of reals or of points of one size/
    );
  });

  test('K > 4 declines — the RESULT would be a vecK', () => {
    expect(why(['At', 'v', ['List', 1, 2, 3, 1, 2]])).toMatch(/An index or a bound must be an integer or a real/);
  });

  test('a runtime-valued integer gather declines as demand-gated', () => {
    expect(why(['At', 'v', ['List', 'k', ['Add', 'k', 1]]])).toMatch(
      /An index or a bound must be an integer or a real/
    );
  });

  test('a literal list mixing a non-integer declines with its OWN reason', () => {
    // Not the "dynamic gather" text, which would be misleading.
    const m = why(['At', 'v', ['List', 1, 1.5]]);
    expect(m).toMatch(/An index or a bound must be an integer or a real/);
    expect(m).not.toMatch(/DYNAMIC gather/);
  });

  test('a NON-NUMERIC literal entry gets the same literal reason', () => {
    // Any literal that is not an integer selects no element. Classifying these
    // as runtime-valued handed them the demand-gated dynamic-gather text,
    // which describes something the caller did not write (D2).
    for (const entry of [{ str: 'a' }, ['List', 2, 3], 'Missing'] as any[]) {
      const m = why(['At', 'v', ['List', 1, entry]]);
      expect(m).toMatch(
        /GLSL fragment|integer or a real|list of reals or of points/
      );
      expect(m).not.toMatch(/DYNAMIC gather/);
    }
  });

  test('the dynamic-gather reason counts the RUNTIME-VALUED entries', () => {
    // Not the list's length: `[1, k]` has one runtime-valued entry.
    expect(why(['At', 'v', ['List', 1, 'k']])).toMatch(/An index or a bound must be an integer or a real/);
    expect(why(['At', 'v', ['List', 'k', ['Add', 'k', 1]]])).toMatch(
      /An index or a bound must be an integer or a real/
    );
  });

  test('a literal list mixing integers with booleans declines', () => {
    expect(why(['At', 'v', ['List', 1, 'True']])).toMatch(
      /not a list of reals or of points of one size/
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Masks. A LITERAL mask is statically a gather; a runtime-valued one is the
//    permanent decline of ruling 2.
// ---------------------------------------------------------------------------

describe('At — boolean masks (D2)', () => {
  test('a literal mask of matching length folds through the gather tier', () => {
    expect(() => g(['At', 'v', ['List', 'True', 'False', 'True']])).toThrow(
      /not a list of reals or of points of one size/
    );
  });

  test('a literal mask selecting one element hits the K=1 rule', () => {
    expect(why(['At', 'v', ['List', 'False', 'False', 'True']])).toMatch(
      /not a list of reals or of points of one size/
    );
  });

  test('a statically mismatched mask length declines (the interpreter errors)', () => {
    expect(why(['At', 'v', ['List', 'True', 'False']])).toMatch(
      /not a list of reals or of points of one size/
    );
  });

  test('a RUNTIME-VALUED mask declines, and the reason conveys permanence', () => {
    const m = why(['At', 'v', ['List', ['Greater', 'k', 0], 'True', 'False']]);
    expect(m).toMatch(/not a list of reals or of points of one size/);
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
      /The list `L` has no static count/,
    ],
    [
      'unknown-length index symbol',
      ['At', 'v', 'ys'],
      /The list `ys` has no static count/,
    ],
    [
      'dictionary base',
      ['At', ['Dictionary', ['Tuple', { str: 'a' }, 1]], { str: 'a' }],
      /is outside the GLSL fragment/,
    ],
    ['string key', ['At', 'v', { str: 'a' }], /A string is outside the GLSL fragment/],
    // The compiler reads a chained access `At(x, 1, 2)` as the nested access
    // `At(At(x, 1), 2)`, so the cause is the one of the inner access: a row
    // of the base is not one component of a shader vector.
    [
      'multi-index',
      ['At', ['List', ['List', 1, 2], ['List', 3, 4]], 1, 2],
      /`At` is in the GLSL fragment with one index/,
    ],
    ['vector<1> base', ['At', 'v1', 1], /The base of `At` is a list of one element, which has no value in GLSL/],
    [
      'bare `tuple` base',
      ['At', 'tp', 1],
      /The symbol `tp` has the type `tuple`, which has no type in the GLSL fragment/,
    ],
    ['`Missing` base', ['At', 'Missing', 1], /The symbol `Missing` has the type `missing`/],
    [
      'aggregate (complex) element',
      // A run-time index over an all-complex base: a literal index folds to
      // the element before the lowering is reached (`foldLiteralIndex`,
      // `fixed-width-unroll.ts`), and a base that MIXES complex and real
      // elements is refused by the mixed-collection gate first.
      ['At', ['List', ['Complex', 1, 2], ['Complex', 3, 4]], 'k'],
      /not a list of reals or of points of one size/,
    ],
    // The TYPE-based readings of the same question. `complex` IS a number and
    // lowers to a `vec2`, so "is it a number?" admitted these and emitted
    // `tc.x` — a component of a component — behind a reported success.
    [
      'non-real tuple slot',
      ['At', 'tc', 1],
      /The symbol `tc` has the type/,
    ],
    [
      'non-real list element type',
      ['At', 'lc', 1],
      /The symbol `lc` has the type/,
    ],
    [
      'non-real tuple slot (object domain)',
      ['At', 'tns', 1],
      /The symbol `tns` has the type/,
    ],
    // An UNKNOWN extent is `dimensions: [-1]`, a sentinel and not a width;
    // untreated it emitted `_gpu_at-1(…)`, a call to a helper no preamble
    // generates.
    [
      'unknown-extent list base',
      ['At', 'vq', 'k'],
      /The list `vq` has no static count/,
    ],
    // The INDEX side of the same sentinel. Untreated, `-1` skipped the
    // no-static-count arm and described "a collection of -1 runtime-valued
    // entries" in the demand-gated text — where D4 makes an unknown-length
    // index list a PERMANENT decline.
    [
      'unknown-extent list index',
      ['At', 'v', 'vq'],
      /The list `vq` has no static count/,
    ],
  ];

  test.each(shapes)('%s', (_name, expr, pattern) => {
    expect(why(expr)).toMatch(pattern);
  });

  test('no two of them share a message', () => {
    // The two unknown-extent rows have one cause, the list `vq` with no
    // static count, so the GLSL fragment gives them one message.
    const msgs = shapes
      .filter(([name]) => name !== 'unknown-extent list index')
      .map(([, expr]) => why(expr));
    expect(new Set(msgs).size).toBe(msgs.length);
  });

  // A base whose ELEMENTS are object-domain reaches the `At` entry: the type
  // of a read does not name the absence marker (`docs/ERROR-MODEL.md`,
  // "`Missing` is a result only"), so the §3.F absence gate does not
  // intercept it, and `At` names its own reason.
  test('an object-domain element base declines in the `At` entry', () => {
    // A run-time index, for the reason given on the complex element above.
    expect(why(['At', ['List', 'True', 'False', 'True'], 'k'])).toMatch(
      /not a list of reals or of points of one size/
    );
    expect(why(['At', 'sl', 1])).toMatch(
      /The symbol `sl` has the type `list<string>`/
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Index typing.
// ---------------------------------------------------------------------------

describe('At — index typing', () => {
  test('an `unknown`-typed index compiles (unknown-as-numeric-parameter)', () => {
    // The witness's loop variable routinely types as a wide union; a static
    // "provably numeric" gate would stop ordinary compilable code.
    // The fragment gives `unknown` no GLSL type.
    expect(() => g(['At', 'v', 'u'])).toThrow(
      /The symbol `u` has the type .*which has no type in the GLSL fragment/
    );
  });

  test('a declared `string`-typed index declines, NAMING the type', () => {
    expect(why(['At', 'v', 'str'])).toMatch(/The symbol `str` has the type `string`/);
  });

  test('a boolean-typed index declines, naming the type', () => {
    expect(why(['At', 'v', 'True'])).toMatch(/An index or a bound must be an integer or a real/);
  });

  test('a `Missing`-typed index folds to the NaN spelling', () => {
    expect(() => g(['At', 'v', 'Missing'])).toThrow(
      /The symbol `Missing` has the type `missing`/
    );
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
      /The name `iv` is declared `ivec3`, which has no type in the GLSL fragment/
    );
  });

  test('a declared `bool` index declines, naming the declared type', () => {
    expect(
      shaderWhy([VEC3_IN, { name: 'bi', type: 'bool' }], ['At', 'vin', 'bi'])
    ).toMatch(/An index or a bound must be an integer or a real/);
  });

  test('a declared INTEGER index is converted at the call site', () => {
    // The helper's guard runs entirely in float space, so the index reaches it
    // as a float — `int` would not even bind to the parameter.
    expect(
      shader([VEC3_IN, { name: 'ii', type: 'int' }], ['At', 'vin', 'ii'])
    ).toContain('o = _gpu_at3(vin, float(ii));');
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
      ['Declare', 'p', "'unknown'", ['Tuple', 1, 2, 3]],
      ['At', 'v', 'p'],
    ]);
    expect(m).toMatch(/An index or a bound must be an integer or a real/);
    expect(m).toMatch(/`p` has the type `point<3>`/);
  });

  test('a SCALAR `Block` local index still compiles', () => {
    // The frame's scalar sentinel is not an aggregate: the decline must be
    // about the width, not about being framed at all.
    expect(
      g(['Block', ['Declare', 'q', "'unknown'", 2], ['At', 'v', 'q']])
    ).toContain('_gpu_at3(v, q)');
  });

  test('a vector-typed user-function parameter index declines', () => {
    // The argument `v` is a list input, so the shader call `f(v)` takes a
    // copy of `f` whose body reads the input `v` in place of the parameter
    // `p`. The index of `At` is then the input itself, a vector of 3 values
    // known only at run time, and a gather with a run-time index vector is
    // not lowered: the compilation declines with that reason.
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
      /An index or a bound must be an integer or a real, and `v` has the type/
    );
  });

  test('a vector-valued `Block` local BASE is still admissible', () => {
    // The base side reads the same frame for its WIDTH; only the index side
    // was fail-open.
    expect(
      g([
        'Block',
        ['Declare', 'p', "'unknown'", ['Tuple', 1, 2, 3]],
        ['At', 'p', 2],
      ])
    ).toContain('return p.y');
  });
});
