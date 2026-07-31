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
 * Consequently the `realOnly` constant-fold refusal is retired here too, the
 * same ruling the JavaScript target landed (`NO_REAL_VALUE_FOLD` /
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

const g = (expr: any): string => glsl.compile(ce.box(expr)).code!;
const w = (expr: any): string => wgsl.compile(ce.box(expr)).code!;

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

  it('ComplexInfinity uses the complex vec2(re, im) convention', () => {
    expect(g(['Divide', 1, 0])).toBe(`vec2(${INF.glsl}, ${INF.glsl})`);
    expect(w(['Divide', 1, 0])).toBe(`vec2f(${INF.wgsl}, ${INF.wgsl})`);
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
    // `Sqrt(negative)` is typed complex (tightened to `finite_complex`
    // 2026-07-31: √−5 = i√5 is finite), so the enclosing emission is the
    // vec2(re, im) complex codegen and the fold must agree with it — a scalar
    // NaN would be consumed as a real by the surrounding complex arithmetic.
    expect(ce.box(['Sqrt', -5]).type.toString()).toBe('finite_complex');
    expect(g(['Sqrt', -5])).toBe(`vec2(0.0, ${Math.sqrt(5)})`);
    expect(w(['Sqrt', -5])).toBe(`vec2f(0.0, ${Math.sqrt(5)})`);
    // …and it composes as a complex value.
    expect(g(['Add', 1, ['Sqrt', -5]])).toBe(
      `vec2(1.0, 0.0) + vec2(0.0, ${Math.sqrt(5)})`
    );
  });

  it('a Power/Root fold agrees with the node TYPE on each branch', () => {
    // SUPERSEDED CONTRACT (2026-07-30 ruling). This test used to assert that
    // `Power(-2, 0.3)` / `Root(-8, 4)` were typed `finite_number` and folded to
    // the shader NaN — true only because the type handlers did not yet track
    // the negative-base branch. They now do: an exponent whose reduced-rational
    // denominator is EVEN (or an even root degree) is the principal COMPLEX
    // branch and the node is typed `finite_complex`, so by the same
    // type-agreement rule as `Sqrt(-5)` above the fold must be a `vec2`. A
    // scalar NaN there is silently scalar-broadcast into `vec2(NaN, NaN)` —
    // valid shader source, wrong value — which is exactly the regression the
    // ruling fixed. Do NOT restore the NaN assertion.
    expect(ce.box(['Power', -2, 0.3]).type.toString()).toBe('finite_complex');
    const p = principalComplexPow(-2, 0.3);
    expect(g(['Power', -2, 0.3])).toBe(`vec2(${p.re}, ${p.im})`);
    expect(w(['Power', -2, 0.3])).toBe(`vec2f(${p.re}, ${p.im})`);
    expect(ce.box(['Root', -8, 4]).type.toString()).toBe('finite_complex');
    const r = principalComplexPow(-8, 0.25);
    expect(g(['Root', -8, 4])).toBe(`vec2(${r.re}, ${r.im})`);
    expect(w(['Root', -8, 4])).toBe(`vec2f(${r.re}, ${r.im})`);
    // …and it composes as a complex value, rather than broadcasting a scalar
    // NaN into the parent's vec2 (`vec2(1.0, 0.0) + _gpu_nan()`).
    expect(g(['Add', 1, ['Power', -2, 0.3]])).toBe(
      `vec2(1.0, 0.0) + vec2(${p.re}, ${p.im})`
    );

    // The ODD-denominator branch keeps a REAL principal root, stays
    // `finite_number`, and must fold to that real value — NOT to NaN, which is
    // all the shader `pow` yields for a negative base. `Power` had no such
    // correction (only `Root` did), so this folded to NaN while the
    // interpreter returned 4.
    expect(ce.box(['Power', -8, ['Divide', 2, 3]]).type.toString()).toBe(
      'finite_number'
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
      'finite_number'
    );
    const real100over3 = `${Math.pow(2, 100 / 3)}`;
    expect(g(['Power', -2, ['Divide', 100, 3]])).toBe(real100over3);
    expect(w(['Power', -2, ['Divide', 100, 3]])).toBe(real100over3);
  });

  it('the SIBLING cases it used to disagree with are unchanged', () => {
    // The defect pattern was a refusal enforced at two sites while every
    // sibling reaching the same mathematical situation compiled and NaN-ed.
    //
    // `Ln(-2)` is NOT one of them: it is typed `finite_complex`, so by the
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
    expect(ce.box(['Ln', -2]).type.toString()).toBe('finite_complex');
    expect(g(['Ln', -2])).toBe('_gpu_cln(vec2(-2.0, 0.0))');
    expect(ce.box(['Arcsin', 2]).type.toString()).toBe('finite_complex');
    expect(g(['Arcsin', 2])).toBe('_gpu_casin(vec2(2.0, 0.0))');
    // An IN-domain argument is still real-typed and still lowers to the scalar.
    expect(ce.box(['Arcsin', 0.5]).type.toString()).toBe('finite_real');
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
