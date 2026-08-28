/**
 * NON-FINITE values and NO-REAL-VALUE constants on the GPU targets.
 *
 * Neither GLSL nor WGSL has a `NaN` or an `Infinity` LITERAL, and the number
 * formatter used to reject both outright ("Cannot compile the non-finite
 * value …"). But the mechanism to MAKE those values already existed and was
 * already in use for masked `When`/`Which` branches: a bit pattern, reached
 * through `gpuNonFiniteLiteral` — the overridable `_gpu_nan()` / `_gpu_inf()`
 * preamble helpers on GLSL, an inline `bitcast` on WGSL. The literal path could
 * not reach it only because the formatter did not know the language.
 *
 * Consequently the constant-fold refusal for a provably non-real value is
 * retired here too, the same ruling the JavaScript target landed
 * (`NO_REAL_VALUE_FOLD` /
 * `complexSqrtLiteral`): a provably non-real constant FOLDS rather than
 * declining, to the value its own node TYPE calls for. Refusing only the
 * provable-constant case bought no safety — every sibling case
 * (`Ln(-2)` → `log(-2.0)`, `Arcsin(2)` → `asin(2.0)`, `Sqrt(x)` at `x = -2`)
 * already compiled and NaNs at run time.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { principalComplexPow } from '../../src/compute-engine/compilation/constant-folding';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off throughout this file. Every probe here
 * is a literal constant (`Add(1, NaN)`, `Root(-8, 4)`, `Ln(-2)`), i.e. a pure
 * subtree with no free variables that the compiler would otherwise evaluate at
 * compile time and emit as a single literal — which is precisely the lowering
 * these tests inspect: the bit-pattern `_gpu_nan()`/`_gpu_inf()` mechanism, the
 * per-node real-vs-complex type agreement, and the complex helper each
 * no-real-value constant routes through.
 */
const NO_FOLD = { constantFold: false } as const;

const g = (expr: any): string => glsl.compile(ce.box(expr), NO_FOLD).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr), NO_FOLD).code!;

const NAN = { glsl: '_gpu_nan()', wgsl: 'bitcast<f32>(0x7fc00000u)' };
const INF = { glsl: '_gpu_inf()', wgsl: 'bitcast<f32>(0x7f800000u)' };

describe('GPU non-finite LITERALS route through the bit-pattern mechanism', () => {
  it('a NaN literal is the same symbol a masked branch produces', () => {
    expect(g('NaN')).toBe(NAN.glsl);
    expect(w('NaN')).toBe(NAN.wgsl);
    // The same symbol the `When` else-branch has always used.
    expect(g(['When', 'x', ['Greater', 'x', 0]])).toContain(NAN.glsl);
    expect(w(['When', 'x', ['Greater', 'x', 0]])).toContain(NAN.wgsl);
  });

  it('±∞ is a BIT PATTERN, never `1.0 / 0.0` (fast-math would fold it)', () => {
    expect(g('PositiveInfinity')).toBe(INF.glsl);
    expect(w('PositiveInfinity')).toBe(INF.wgsl);
    expect(g('NegativeInfinity')).toBe(`(-${INF.glsl})`);
    expect(w('NegativeInfinity')).toBe(`(-${INF.wgsl})`);
    for (const code of [g('PositiveInfinity'), w('NegativeInfinity')])
      expect(code).not.toMatch(/\/\s*0(\.0)?\b/);
  });

  it('a non-finite operand composes with ordinary arithmetic', () => {
    expect(g(['Add', 1, 'NaN'])).toBe(`1.0 + ${NAN.glsl}`);
    expect(w(['Add', 1, 'PositiveInfinity'])).toBe(`1.0 + ${INF.wgsl}`);
  });

  it('ComplexInfinity lowers to the shader Infinity, not a vec2', () => {
    // `~oo` types `number` (the non-finite typing convention admits an
    // undirected infinity at the top type only), and a shader lane is real:
    // its float projection is `Infinity` (pole-encoding ruling 2026-08-28 —
    // the magnitude survives, the missing direction does not), matching what
    // the bare `/` instruction answers at a runtime pole. A `vec2` here was
    // also a shape mismatch wherever the surrounding expression expects a
    // float.
    expect(g(['Divide', 1, 0])).toBe(INF.glsl);
    expect(w(['Divide', 1, 0])).toBe(INF.wgsl);
  });

  it('the gamma helper guards its poles, and GLSL declares Infinity before it', () => {
    // Gamma has a pole at every non-positive integer, and the helper's
    // reflection formula cannot see it — sin(PI * z) is not exactly 0 there —
    // so without a guard a shader returned a large finite number for
    // Gamma(-2). The pole answers the float projection of the interpreter's
    // undirected infinity, `Infinity` (pole-encoding ruling 2026-08-28). The
    // guard's body calls the Infinity helper, which the preamble scan cannot
    // see (it reads the EMITTED code, never a helper body), so GLSL must be
    // forced to declare `_gpu_inf()` FIRST: GLSL requires a declaration
    // before its use.
    const gGamma = glsl.compile(ce.box(['Gamma', -2]), NO_FOLD);
    const gPre = gGamma.preamble ?? '';
    expect(gPre).toContain('z <= 0.0 && z == floor(z)');
    expect(gPre.indexOf('float _gpu_inf')).toBeGreaterThanOrEqual(0);
    expect(gPre.indexOf('float _gpu_inf')).toBeLessThan(
      gPre.indexOf('float _gpu_gamma')
    );

    const wPre = wgsl.compile(ce.box(['Gamma', -2]), NO_FOLD).preamble ?? '';
    expect(wPre).toContain('z <= 0.0 && z == floor(z)');
    // WGSL has no Infinity helper — the bit pattern is spelled inline there.
    expect(wPre).toContain(INF.wgsl);
  });

  it('GLSL declares `_gpu_inf()` beside `_gpu_nan()`, both overridable', () => {
    const inf = glsl.compile(ce.box('PositiveInfinity'));
    expect(inf.preamble ?? '').toContain('float _gpu_inf()');
    // Built the same way as the NaN helper, from the ES 3.00 builtin the
    // target already assumes.
    expect(inf.preamble ?? '').toContain('intBitsToFloat(0x7F800000)');
    const nan = glsl.compile(ce.box('NaN'));
    expect(nan.preamble ?? '').toContain('float _gpu_nan()');
    // Declared only when referenced.
    expect(nan.preamble ?? '').not.toContain('_gpu_inf');
    expect(inf.preamble ?? '').not.toContain('_gpu_nan');
  });

  it('WGSL emits no preamble for either (the bit pattern is inline)', () => {
    expect(wgsl.compile(ce.box('NaN')).preamble ?? '').toBe('');
    expect(wgsl.compile(ce.box('PositiveInfinity')).preamble ?? '').toBe('');
  });
});

describe('GPU no-real-value constants FOLD (the JS target ruling, applied)', () => {
  it('a `complex`-typed Sqrt folds to the complex principal value', () => {
    // `Sqrt(negative)` is typed complex (tightened to `complex`
    // 2026-07-31: √−5 = i√5 is finite), so the enclosing emission is the
    // vec2(re, im) complex codegen and the fold must agree with it — a scalar
    // NaN would be consumed as a real by the surrounding complex arithmetic.
    expect(ce.box(['Sqrt', -5]).type.toString()).toBe('complex');
    expect(g(['Sqrt', -5])).toBe(`vec2(0.0, ${Math.sqrt(5)})`);
    expect(w(['Sqrt', -5])).toBe(`vec2f(0.0, ${Math.sqrt(5)})`);
    // …and it composes as a complex value.
    expect(g(['Add', 1, ['Sqrt', -5]])).toBe(
      `vec2(1.0, 0.0) + vec2(0.0, ${Math.sqrt(5)})`
    );
  });

  it('a Power/Root fold agrees with the node TYPE on each branch', () => {
    // SUPERSEDED CONTRACT (2026-07-30 ruling). This test used to assert that
    // `Power(-2, 0.3)` / `Root(-8, 4)` were typed `number` and folded to
    // the shader NaN — true only because the type handlers did not yet track
    // the negative-base branch. They now do: an exponent whose reduced-rational
    // denominator is EVEN (or an even root degree) is the principal COMPLEX
    // branch and the node is typed `complex`, so by the same
    // type-agreement rule as `Sqrt(-5)` above the fold must be a `vec2`. A
    // scalar NaN there is silently scalar-broadcast into `vec2(NaN, NaN)` —
    // valid shader source, wrong value — which is exactly the regression the
    // ruling fixed. Do NOT restore the NaN assertion.
    expect(ce.box(['Power', -2, 0.3]).type.toString()).toBe('complex');
    const p = principalComplexPow(-2, 0.3);
    expect(g(['Power', -2, 0.3])).toBe(`vec2(${p.re}, ${p.im})`);
    expect(w(['Power', -2, 0.3])).toBe(`vec2f(${p.re}, ${p.im})`);
    expect(ce.box(['Root', -8, 4]).type.toString()).toBe('complex');
    const r = principalComplexPow(-8, 0.25);
    expect(g(['Root', -8, 4])).toBe(`vec2(${r.re}, ${r.im})`);
    expect(w(['Root', -8, 4])).toBe(`vec2f(${r.re}, ${r.im})`);
    // …and it composes as a complex value, rather than broadcasting a scalar
    // NaN into the parent's vec2 (`vec2(1.0, 0.0) + _gpu_nan()`).
    expect(g(['Add', 1, ['Power', -2, 0.3]])).toBe(
      `vec2(1.0, 0.0) + vec2(${p.re}, ${p.im})`
    );

    // The ODD-denominator branch keeps a REAL principal root, stays
    // `number`, and must fold to that real value — NOT to NaN, which is
    // all the shader `pow` yields for a negative base. `Power` had no such
    // correction (only `Root` did), so this folded to NaN while the
    // interpreter returned 4.
    expect(ce.box(['Power', -8, ['Divide', 2, 3]]).type.toString()).toBe(
      'number'
    );
    expect(g(['Power', -8, ['Divide', 2, 3]])).toBe('4.0');
    expect(w(['Power', -8, ['Divide', 2, 3]])).toBe('4.0');
    expect(g(['Root', -8, 3])).toBe('-2.0');

    // …including an exponent whose EXACT denominator is odd but whose double
    // reconstructs to an even one: `100/3`'s double expands by continued
    // fractions to the dyadic `4691249611844267/140737488355328`. The branch is
    // decided by the exact rational (as the type handler already did), so this
    // folds to the real `+2^(100/3)` on both shader targets instead of the
    // shader NaN it used to yield.
    expect(ce.box(['Power', -2, ['Divide', 100, 3]]).type.toString()).toBe(
      'number'
    );
    const real100over3 = `${Math.pow(2, 100 / 3)}`;
    expect(g(['Power', -2, ['Divide', 100, 3]])).toBe(real100over3);
    expect(w(['Power', -2, ['Divide', 100, 3]])).toBe(real100over3);
  });

  it('the SIBLING cases it used to disagree with are unchanged', () => {
    // The defect pattern was a refusal enforced at two sites while every
    // sibling reaching the same mathematical situation compiled and NaN-ed.
    //
    // `Ln(-2)` is NOT one of them: it is typed `complex`, so by the
    // same type-agreement rule as `Sqrt(-5)` above its lowering is the complex
    // one — the scalar `log(-2.0)` this used to assert disagreed with the
    // `vec2` codegen its own parent emits (see
    // `compile-complex-result.test.ts`).
    //
    // `Arcsin(2)` JOINED that set on 2026-07-30: it used to be typed the coarse
    // `number` (not a complex type), so it stayed real and NaN-ed. The bounded
    // inverse heads now type a provably out-of-domain argument by the value it
    // takes — `arcsin(2) = π/2 − 1.3169…i`, a finite complex — so the SAME
    // type-agreement rule applies and its lowering is the complex one.
    expect(ce.box(['Ln', -2]).type.toString()).toBe('complex');
    expect(g(['Ln', -2])).toBe('_gpu_cln(vec2(-2.0, 0.0))');
    expect(ce.box(['Arcsin', 2]).type.toString()).toBe('complex');
    expect(g(['Arcsin', 2])).toBe('_gpu_casin(vec2(2.0, 0.0))');
    // An IN-domain argument is still real-typed and still lowers to the scalar.
    expect(ce.box(['Arcsin', 0.5]).type.toString()).toBe('real');
    expect(g(['Arcsin', 0.5])).toBe('asin(0.5)');
    // …including the SAME head with a variable operand, which cannot be caught
    // in principle, so the caller has to handle NaN either way.
    expect(g(['Sqrt', 'x'])).toBe('sqrt(x)');
    expect(g(['Power', 'x', 0.3])).toBe('pow(x, 0.3)');
  });

  it('an odd root of a negative constant still folds to the REAL value', () => {
    expect(g(['Root', -8, 3])).toBe('-2.0');
    expect(w(['Root', -8, 3])).toBe('-2.0');
  });
});

describe('a POLE JOIN drives the GPU complex lane by its FINITE part', () => {
  // A head that is complex off its real domain AND blows up at a pole types as
  // a union of the two: `Artanh(x)` for a real `x` is
  // `complex | non_finite_number` (complex for |x| > 1, ±∞ at x = ±1).
  //
  // The lane test must therefore ask about the FINITE part of that union.
  // Asking about the whole union answers "not complex" — `non_finite_number`
  // is a real tier — and the emitter would take the SCALAR lane while the
  // parent, which consults `BaseCompiler.isComplexValued` (already reading the
  // finite part), takes the complex one. On a shader that is not a type error:
  // scalar-broadcast turns `atanh(x) + vec2(0.0, 1.0)` into
  // `vec2(atanh(x), atanh(x) + 1.0)`, a silently wrong value everywhere.
  ce.declare('xr', 'real');

  it('types the pole heads as a union of a complex and a non-finite branch', () => {
    for (const head of ['Artanh', 'Arcoth', 'Arsech'])
      expect(ce.box([head, 'xr']).type.toString()).toBe(
        'complex | non_finite_number'
      );
  });

  it('lowers them through the COMPLEX helpers on both shader targets', () => {
    expect(g(['Artanh', 'xr'])).toBe('_gpu_catanh(vec2(xr, 0.0))');
    expect(w(['Artanh', 'xr'])).toBe('_gpu_catanh(vec2f(xr, 0.0))');
    expect(g(['Arcoth', 'xr'])).toBe(
      '_gpu_catanh(_gpu_cdiv(vec2(1.0, 0.0), vec2(xr, 0.0)))'
    );
    expect(g(['Arsech', 'xr'])).toBe(
      '_gpu_cacosh(_gpu_cdiv(vec2(1.0, 0.0), vec2(xr, 0.0)))'
    );
  });

  it('agrees with the vec2 convention its own PARENT emits', () => {
    // The regression witness: the parent adds a `vec2` literal, so a scalar
    // `atanh(xr)` on the left would broadcast instead of failing to compile.
    const sum = ['Add', ['Artanh', 'xr'], ['Complex', 0, 1]];
    expect(g(sum)).toBe('_gpu_catanh(vec2(xr, 0.0)) + vec2(0.0, 1.0)');
    expect(w(sum)).toBe('_gpu_catanh(vec2f(xr, 0.0)) + vec2f(0.0, 1.0)');
  });
});
