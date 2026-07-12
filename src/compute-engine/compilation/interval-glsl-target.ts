import type { Expression } from '../global-types.js';
import type {
  CompiledFunctions,
  CompiledOperators,
  CompileTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { GLSLTarget } from './glsl-target.js';
import { formatGPUNumber } from './gpu-target.js';
import { isNumber, isSymbol } from '../boxed-expression/type-guards.js';

/**
 * `interval-glsl` — a GPU compilation target that evaluates an expression with
 * **interval arithmetic** in a GLSL fragment shader. Each value is a `vec2`
 * `(lo, hi)`; the shader computes the interval of `f` over a screen cell's box
 * so the renderer can decide whether the curve `f = 0` can pass through it.
 *
 * Design contract (Phase 0, see `INTERVAL_GLSL_PLAN.md` §8–§9):
 *
 * - **Exclusion oracle only.** The GPU computes the per-cell interval of `f`;
 *   curve extraction and discontinuity classification stay on the CPU
 *   (`interval-js`). So no tagged union, no `singular`/`partial`, no comparison
 *   ops on this target — just arithmetic and elementary functions.
 * - **Representation:** `vec2 (lo, hi)`. `empty` (domain-undefined) is the
 *   inverted interval `vec2(IV_INF, -IV_INF)` (`lo > hi`); the renderer's
 *   exclusion predicate `lo > 0 || hi < 0` excludes it for free. `empty`
 *   propagates **exactly** through every op via a branchless guard.
 * - **Sentinel:** a *finite* `IV_INF = 1e18`, small enough that a single op's
 *   worst intermediate (`IV_INF²` in `mul`/`square`) stays below `FLT_MAX`, and
 *   finite so `0 · IV_INF = 0` rather than `0 · inf = NaN`. Every op clamps its
 *   output to `[-IV_INF, IV_INF]`.
 *
 * Phase 1 covers arithmetic + integer powers (polynomials / rationals). Other
 * heads are intentionally absent: they surface in `result.unsupported`, and a
 * curve using one falls back to CPU `interval-js` with no trial-compile.
 */

const IV_INF = '1e18';

/**
 * GLSL preamble template: the `_iv_*` interval-arithmetic library. The
 * `__IV_TRIG_ABS__` token is filled in by {@link intervalGLSLPreamble}.
 */
const INTERVAL_GLSL_PREAMBLE_TEMPLATE = `
const float IV_INF = ${IV_INF};
const vec2 IV_ENTIRE = vec2(-IV_INF, IV_INF);
const vec2 IV_EMPTY = vec2(IV_INF, -IV_INF);

bool _iv_is_empty(vec2 a) { return a.x > a.y; }

// Clamp bounds to the finite sentinel range. Preserves IV_EMPTY (its components
// already sit at the sentinels) and folds any overflowed intermediate back to
// the sentinel (min(inf, IV_INF) = IV_INF), so a real \`inf\` never escapes an op.
vec2 _iv_clamp(vec2 a) { return clamp(a, -IV_INF, IV_INF); }

// Exact empty propagation: force empty if any operand is empty.
vec2 _iv_guard1(vec2 r, vec2 a) { return _iv_is_empty(a) ? IV_EMPTY : r; }
vec2 _iv_guard2(vec2 r, vec2 a, vec2 b) {
  return (_iv_is_empty(a) || _iv_is_empty(b)) ? IV_EMPTY : r;
}

// ── Outward rounding (float32 soundness) ────────────────────────────────────
// GLSL ES has no \`nextafter\`, and float32 ops round to nearest — which can make
// an op's result interval slightly *narrower* than the true range, violating the
// exclusion contract (interval-glsl ⊇ true-range; INTERVAL_GLSL_PLAN.md §4 point
// 4 / §13). So every *inexact* op widens its result outward — \`lo\` down, \`hi\`
// up — by a relative ulp (plus a tiny absolute floor for bounds at 0) BEFORE
// clamping. Widening only ever moves bounds outward, so it can never break
// soundness; the cost is marginally fatter intervals. Widening \`IV_EMPTY\` keeps
// it empty (lo still ≫ hi) and \`IV_ENTIRE\` re-clamps to entire, so the guards
// and sentinels are preserved.
//
// These widen helpers and their epsilons are a **public, stable** part of the
// preamble. The per-op pads (\`_iv_widen\`*) are *value-relative* — correct
// because each op's rounding error scales with its own result. The cell-box pad
// is different: see \`_iv_widen_box\` below.
const float IV_EPS = 1.1920929e-7;   // 2^-23, float32 machine epsilon (1 ulp)
const float IV_ABS_FLOOR = 1e-30;    // widen bounds that sit exactly at 0
// \`_iv_widen_t\`: builtins GLSL ES does NOT round to ≤0.5 ulp — \`/\` (≈2.5 ulp),
// \`sqrt\`/\`exp\`/\`log\` (≈3 ulp), inverse-trig (a few ulp).
const float IV_EPS_FN = 8.0 * IV_EPS;
// \`_iv_widen_pow\`: GLSL ES \`pow\` is ~16 ulp (it is exp2(y·log2(x))); 32 ulp gives
// headroom for moderate exponents. Very large exponents grow past this — keep a
// CPU refine for those.
const float IV_EPS_POW = 32.0 * IV_EPS;
// \`_iv_widen_box\`: pad for a cell box built by \`mix(domainLo, domainHi, t)\`. The
// mix construction error is bounded by ~ulp of the **domain extent**, NOT of the
// local edge value (\`min + t·span\` rounds to ulp(|coord|) ≤ ulp(max|domain|)).
// So the box pad is *absolute, scaled to the domain* — a value-relative pad
// would vanish for an edge near 0 in a wide domain (e.g. a cell straddling the
// y-axis at x≈0 in x∈[−2,2] still carries ~ulp(2) of error). 8 ulp of the extent.
const float IV_BOX_EPS = 8.0 * IV_EPS;
// \`_iv_widen_sc\`: \`sin\`/\`cos\` carry an *absolute* ~2^-11 error that is
// implementation-defined (macOS ANGLE→Metal differs from desktop GL) — no
// relative pad can cover it. \`IV_TRIG_ABS\` is an opt-in absolute pad (default 0
// = off; set via the \`trigAbsPad\` compile option / intervalGLSLPreamble). With
// it 0, a sin/cos tangency is best-effort — CPU-refine if you need strict (§13).
const float IV_TRIG_ABS = __IV_TRIG_ABS__;

vec2 _iv_widen(vec2 r) {
  return vec2(r.x - (abs(r.x) * IV_EPS + IV_ABS_FLOOR),
              r.y + (abs(r.y) * IV_EPS + IV_ABS_FLOOR));
}
vec2 _iv_widen_pow(vec2 r) {
  return vec2(r.x - (abs(r.x) * IV_EPS_POW + IV_ABS_FLOOR),
              r.y + (abs(r.y) * IV_EPS_POW + IV_ABS_FLOOR));
}
vec2 _iv_widen_sc(vec2 r) {
  return vec2(r.x - (abs(r.x) * IV_EPS_FN + IV_TRIG_ABS + IV_ABS_FLOOR),
              r.y + (abs(r.y) * IV_EPS_FN + IV_TRIG_ABS + IV_ABS_FLOOR));
}
vec2 _iv_widen_t(vec2 r) {
  return vec2(r.x - (abs(r.x) * IV_EPS_FN + IV_ABS_FLOOR),
              r.y + (abs(r.y) * IV_EPS_FN + IV_ABS_FLOOR));
}
// Outward-round a cell box. \`domainExtent\` = max(|domainLo|, |domainHi|) for that
// axis; the pad is scaled to it, not to the box edges (see note above). A
// renderer that builds its own boxes should call this on each axis.
vec2 _iv_widen_box(vec2 box, float domainExtent) {
  float pad = IV_BOX_EPS * domainExtent + IV_ABS_FLOOR;
  return vec2(box.x - pad, box.y + pad);
}

// negate/abs/min/max and the step family are *exact* (sign flip / selection /
// integer results), so they are not widened — only ops that round are.
vec2 _iv_negate(vec2 a) { return _iv_guard1(_iv_clamp(vec2(-a.y, -a.x)), a); }

vec2 _iv_add(vec2 a, vec2 b) {
  return _iv_guard2(_iv_clamp(_iv_widen(vec2(a.x + b.x, a.y + b.y))), a, b);
}

vec2 _iv_sub(vec2 a, vec2 b) {
  return _iv_guard2(_iv_clamp(_iv_widen(vec2(a.x - b.y, a.y - b.x))), a, b);
}

vec2 _iv_mul(vec2 a, vec2 b) {
  float p1 = a.x * b.x, p2 = a.x * b.y, p3 = a.y * b.x, p4 = a.y * b.y;
  vec2 r = vec2(min(min(p1, p2), min(p3, p4)), max(max(p1, p2), max(p3, p4)));
  return _iv_guard2(_iv_clamp(_iv_widen(r)), a, b);
}

vec2 _iv_div(vec2 a, vec2 b) {
  // Denominator spanning 0 → entire (wide, never narrow): the CPU pass turns
  // the pole into a proper asymptote break.
  bool spansZero = (b.x <= 0.0 && b.y >= 0.0);
  float q1 = a.x / b.x, q2 = a.x / b.y, q3 = a.y / b.x, q4 = a.y / b.y;
  vec2 r = vec2(min(min(q1, q2), min(q3, q4)), max(max(q1, q2), max(q3, q4)));
  r = spansZero ? IV_ENTIRE : r;
  return _iv_guard2(_iv_clamp(_iv_widen_t(r)), a, b); // \`/\` is not ≤0.5 ulp
}

vec2 _iv_square(vec2 a) {
  float lo2 = a.x * a.x, hi2 = a.y * a.y;
  // Straddles 0 ⇒ min is 0; otherwise the smaller endpoint² is the min.
  float lo = (a.x <= 0.0 && a.y >= 0.0) ? 0.0 : min(lo2, hi2);
  return _iv_guard1(_iv_clamp(_iv_widen(vec2(lo, max(lo2, hi2)))), a);
}

// Scalar integer power that is correct for negative bases (GLSL \`pow\` requires
// a non-negative base): keep the sign for odd exponents, drop it for even.
float _iv_powi_scalar(float x, float n) {
  float a = pow(abs(x), n);
  return (mod(n, 2.0) == 1.0 && x < 0.0) ? -a : a;
}

vec2 _iv_powi(vec2 a, float n) {
  float pl = _iv_powi_scalar(a.x, n);
  float ph = _iv_powi_scalar(a.y, n);
  bool even = (mod(n, 2.0) == 0.0);
  bool straddle = (a.x <= 0.0 && a.y >= 0.0);
  float lo = even ? (straddle ? 0.0 : min(pl, ph)) : pl;
  float hi = even ? max(pl, ph) : ph;
  return _iv_guard1(_iv_clamp(_iv_widen_pow(vec2(lo, hi))), a); // pow ~16 ulp
}

// ── Phase 2: elementary functions ──────────────────────────────────────────

vec2 _iv_abs(vec2 a) {
  float al = abs(a.x), ah = abs(a.y);
  bool straddle = (a.x <= 0.0 && a.y >= 0.0);
  return _iv_guard1(_iv_clamp(vec2(straddle ? 0.0 : min(al, ah), max(al, ah))), a);
}

// Domain x ≥ 0: fully-negative box → empty; a box straddling 0 clamps lo to 0.
vec2 _iv_sqrt(vec2 a) {
  vec2 r = vec2(sqrt(max(a.x, 0.0)), sqrt(max(a.y, 0.0)));
  r = (a.y < 0.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

vec2 _iv_exp(vec2 a) {
  return _iv_guard1(_iv_clamp(_iv_widen_t(vec2(exp(a.x), exp(a.y)))), a);
}

// Domain x > 0: fully-≤0 box → empty; straddling box → lo clamped to −IV_INF
// (ln → −∞ as x → 0⁺, never a real −inf).
vec2 _iv_ln(vec2 a) {
  vec2 r = vec2(a.x > 0.0 ? log(a.x) : -IV_INF, log(a.y));
  r = (a.y <= 0.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

const float _IV_INV_LN10 = 0.43429448190325176;
const float _IV_INV_LN2 = 1.4426950408889634;

vec2 _iv_log10(vec2 a) {
  vec2 r = vec2(a.x > 0.0 ? log(a.x) * _IV_INV_LN10 : -IV_INF, log(a.y) * _IV_INV_LN10);
  r = (a.y <= 0.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

vec2 _iv_log2(vec2 a) {
  vec2 r = vec2(a.x > 0.0 ? log(a.x) * _IV_INV_LN2 : -IV_INF, log(a.y) * _IV_INV_LN2);
  r = (a.y <= 0.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

// Non-integer power. Real only for base ≥ 0: fully-negative box → empty; a box
// straddling 0 clamps the base low end to 0. \`p\` is a compile-time constant, so
// the \`p >= 0\` test is a constant branch.
vec2 _iv_powf(vec2 a, float p) {
  float lob = max(a.x, 0.0);
  float e0 = pow(lob, p), e1 = pow(a.y, p);
  vec2 r = (p >= 0.0) ? vec2(e0, e1) : vec2(e1, e0);
  r = (a.y < 0.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_pow(r)), a); // pow ~16 ulp
}

// Real value of x^(p/q) for an ODD denominator q (real for every real x),
// mirroring the interpreter / interval-js \`powRational\` convention:
//   - \`numer\` even → even function,  |x|^e (≥ 0)
//   - \`numer\` odd  → odd function,   sign(x)·|x|^e
// Only called for a POSITIVE exponent (e = numer/q > 0, guaranteed by the
// caller), so x = 0 → 0.
float _iv_pow_rat_scalar(float x, float numer, float e) {
  if (x == 0.0) return 0.0;
  float m = pow(abs(x), e);
  return (mod(abs(numer), 2.0) == 1.0 && x < 0.0) ? -m : m;
}

// x^(numer/q), q ODD, numer/q = e > 0: real for every real base (e.g.
// (-8)^(2/3) = 4, (-32)^(3/5) = -8) — unlike \`_iv_powf\`, which clamps a
// negative base to empty. Monotone increasing everywhere when \`numer\` is odd;
// decreasing on x<0 / increasing on x>0 (interior minimum of 0) when \`numer\`
// is even — the endpoints, plus 0 when it is interior, bracket the range
// (mirrors interval-js \`powRational\`).
vec2 _iv_powrat(vec2 a, float numer, float e) {
  float lo = _iv_pow_rat_scalar(a.x, numer, e);
  float hi = _iv_pow_rat_scalar(a.y, numer, e);
  vec2 r = vec2(min(lo, hi), max(lo, hi));
  if (a.x <= 0.0 && a.y >= 0.0) r = vec2(min(r.x, 0.0), max(r.y, 0.0));
  return _iv_guard1(_iv_clamp(_iv_widen_pow(r)), a); // pow ~16 ulp
}

// ── Phase 3: trigonometric & inverse-trigonometric functions ───────────────
// Mirrors interval-js (interval/trigonometric.ts): endpoints with extremum
// snapping, then outward-widened by the transcendental margin (\`_iv_widen_t\`).
// CAVEAT: GLSL ES \`sin\`/\`cos\` carry an *absolute* error a relative pad cannot
// fully cover, so a tangency verdict here is best-effort — CPU-refine if strict
// (§13). Per the Option-A contract, a tan pole yields \`entire\` (interval-js
// returns \`singular\`; entire ⊇ singular and the CPU classifies the asymptote).

const float _IV_PI = 3.141592653589793;
const float _IV_TWO_PI = 6.283185307179586;
const float _IV_HALF_PI = 1.5707963267948966;
const float _IV_THREE_HALF_PI = 4.71238898038469;

// True if [a] contains an extremum of the family { ext + n·period }.
bool _iv_has_ext(vec2 a, float ext, float period) {
  float n = ceil((a.x - ext) / period);
  float cand = ext + n * period;
  return cand >= a.x - 1e-15 && cand <= a.y + 1e-15;
}

vec2 _iv_sin(vec2 a) {
  vec2 r;
  if (a.y - a.x >= _IV_TWO_PI) r = vec2(-1.0, 1.0);
  else {
    float sl = sin(a.x), sh = sin(a.y);
    float lo = min(sl, sh), hi = max(sl, sh);
    if (_iv_has_ext(a, _IV_HALF_PI, _IV_TWO_PI)) hi = 1.0;
    if (_iv_has_ext(a, _IV_THREE_HALF_PI, _IV_TWO_PI)) lo = -1.0;
    r = vec2(lo, hi);
  }
  return _iv_guard1(_iv_clamp(_iv_widen_sc(r)), a);
}

vec2 _iv_cos(vec2 a) {
  vec2 r;
  if (a.y - a.x >= _IV_TWO_PI) r = vec2(-1.0, 1.0);
  else {
    float cl = cos(a.x), ch = cos(a.y);
    float lo = min(cl, ch), hi = max(cl, ch);
    if (_iv_has_ext(a, 0.0, _IV_TWO_PI)) hi = 1.0;
    if (_iv_has_ext(a, _IV_PI, _IV_TWO_PI)) lo = -1.0;
    r = vec2(lo, hi);
  }
  return _iv_guard1(_iv_clamp(_iv_widen_sc(r)), a);
}

vec2 _iv_tan(vec2 a) {
  // A pole in the interval → entire (cannot exclude).
  bool pole =
    (a.y - a.x >= _IV_PI) || _iv_has_ext(a, _IV_HALF_PI, _IV_PI);
  float tl = tan(a.x), th = tan(a.y);
  // Floating-point branch-cross sanity (large opposite-sign endpoints).
  bool crossed = (tl > 1e10 && th < -1e10) || (tl < -1e10 && th > 1e10);
  vec2 r = (pole || crossed) ? IV_ENTIRE : vec2(tl, th);
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

// asin: domain [−1, 1]. Fully outside → empty; straddling clamps to the valid
// sub-range. Monotonic increasing.
vec2 _iv_asin(vec2 a) {
  vec2 r = vec2(asin(max(a.x, -1.0)), asin(min(a.y, 1.0)));
  r = (a.x > 1.0 || a.y < -1.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

// acos: domain [−1, 1], monotonic decreasing (bounds swap).
vec2 _iv_acos(vec2 a) {
  vec2 r = vec2(acos(min(a.y, 1.0)), acos(max(a.x, -1.0)));
  r = (a.x > 1.0 || a.y < -1.0) ? IV_EMPTY : r;
  return _iv_guard1(_iv_clamp(_iv_widen_t(r)), a);
}

vec2 _iv_atan(vec2 a) {
  return _iv_guard1(_iv_clamp(_iv_widen_t(vec2(atan(a.x), atan(a.y)))), a);
}

// ── Discontinuous / step functions ─────────────────────────────────────────
// Bounded jump-discontinuity functions return the TIGHT value-range enclosure
// (sound, and excludable when the range misses 0) rather than \`entire\` — only
// genuine poles are entire. Per the Option-A division of labor, the CPU still
// classifies the discontinuity on the (kept) live cells; the GPU only needs a
// sound bound for the exclusion test. These functions are monotone, so the
// enclosure is just [f(lo), f(hi)] unless noted.

vec2 _iv_floor(vec2 a) { return _iv_guard1(_iv_clamp(vec2(floor(a.x), floor(a.y))), a); }
vec2 _iv_ceil(vec2 a) { return _iv_guard1(_iv_clamp(vec2(ceil(a.x), ceil(a.y))), a); }
// Round half away from zero (Round(-2.5) = -3), matching the interpreter —
// NOT GLSL \`round()\` (round-half-to-even) nor \`floor(x + 0.5)\` (half toward
// +∞). Monotone non-decreasing like Floor/Ceil, so the pointwise endpoint
// application is a sound, tight value-range enclosure.
float _iv_round_half_away(float x) { return sign(x) * floor(abs(x) + 0.5); }
vec2 _iv_round(vec2 a) { return _iv_guard1(_iv_clamp(vec2(_iv_round_half_away(a.x), _iv_round_half_away(a.y))), a); }
vec2 _iv_trunc(vec2 a) { return _iv_guard1(_iv_clamp(vec2(trunc(a.x), trunc(a.y))), a); }
vec2 _iv_sign(vec2 a) { return _iv_guard1(vec2(sign(a.x), sign(a.y)), a); }

vec2 _iv_heaviside(vec2 a) {
  float hl = a.x < 0.0 ? 0.0 : (a.x > 0.0 ? 1.0 : 0.5);
  float hh = a.y < 0.0 ? 0.0 : (a.y > 0.0 ? 1.0 : 0.5);
  return _iv_guard1(vec2(hl, hh), a);
}

// fract(x) = x − floor(x): continuous within an integer cell, sawtooth across
// one (→ full [0, 1] range).
vec2 _iv_fract(vec2 a) {
  float fl = floor(a.x);
  vec2 r = (fl == floor(a.y)) ? vec2(a.x - fl, a.y - fl) : vec2(0.0, 1.0);
  return _iv_guard1(_iv_clamp(_iv_widen(r)), a);
}

vec2 _iv_min(vec2 a, vec2 b) {
  return _iv_guard2(_iv_clamp(vec2(min(a.x, b.x), min(a.y, b.y))), a, b);
}
vec2 _iv_max(vec2 a, vec2 b) {
  return _iv_guard2(_iv_clamp(vec2(max(a.x, b.x), max(a.y, b.y))), a, b);
}

// mod(x, y) = x − y·floor(x/y). A modulus straddling 0 is a pole → entire. For
// a constant (point) modulus the fast path is exact; otherwise compose (the
// tight floor keeps it sound).
vec2 _iv_mod(vec2 a, vec2 b) {
  if (b.x <= 0.0 && b.y >= 0.0) return _iv_guard2(IV_ENTIRE, a, b);
  if (b.x == b.y) {
    // Signed modulus: floored mod's sign follows the DIVISOR (Mod(5,-3) = -1),
    // matching the interpreter and interval-js. Using abs(b) here returned the
    // nonnegative mod-by-abs value for a negative divisor — wrong sign.
    float p = b.x;
    float flo = floor(a.x / p);
    vec2 r = (flo == floor(a.y / p)) ? vec2(a.x - p * flo, a.y - p * flo)
                                     : vec2(min(p, 0.0), max(p, 0.0));
    return _iv_guard2(_iv_clamp(_iv_widen(r)), a, b);
  }
  // Composed path widens via the inner _iv_sub/_iv_mul/_iv_div/_iv_floor.
  return _iv_sub(a, _iv_mul(b, _iv_floor(_iv_div(a, b))));
}
`;

/**
 * Options that shape the emitted interval-glsl preamble.
 *
 * @deprecated Part of the deprecated `interval-glsl` target (removed in a future
 * release). Use `interval-js` or the scalar `glsl`/`wgsl` targets instead.
 */
export interface IntervalGLSLPreambleOptions {
  /**
   * Absolute outward pad (in output units) added to `sin`/`cos` bounds, on top
   * of the relative transcendental margin. GLSL ES `sin`/`cos` carry an
   * *absolute*, implementation-defined error (~2⁻¹¹ in the worst case; macOS
   * ANGLE→Metal differs) that no relative pad can cover. Default `0` (off) —
   * opt in for a strictly-sound trig oracle without a CPU refine, at the cost of
   * fatter trig intervals. A value around `5e-4` covers the ES worst case.
   */
  trigAbsPad?: number;
}

/**
 * Build the `interval-glsl` `_iv_*` preamble. The widen helpers
 * (`_iv_widen`/`_iv_widen_t`/`_iv_widen_pow`/`_iv_widen_sc`) and their epsilons
 * (`IV_EPS`/`IV_EPS_FN`/`IV_EPS_POW`) are a stable, public part of the output: a
 * renderer that boxes its own cell coordinates should outward-round them with
 * `_iv_widen_t` (§13/Q1).
 *
 * @deprecated Part of the deprecated `interval-glsl` target (removed in a future
 * release). Use `interval-js` or the scalar `glsl`/`wgsl` targets instead.
 */
export function intervalGLSLPreamble(
  options: IntervalGLSLPreambleOptions = {}
): string {
  const trigAbsPad = options.trigAbsPad ?? 0;
  return INTERVAL_GLSL_PREAMBLE_TEMPLATE.replace(
    '__IV_TRIG_ABS__',
    formatGPUNumber(trigAbsPad)
  );
}

/**
 * Default preamble (no absolute trig pad).
 *
 * @deprecated Part of the deprecated `interval-glsl` target (removed in a future
 * release). Use `interval-js` or the scalar `glsl`/`wgsl` targets instead.
 */
export const INTERVAL_GLSL_PREAMBLE = intervalGLSLPreamble();

/**
 * Operator/function heads → `_iv_*` calls. Arithmetic routes through functions
 * (never native infix), exactly like the `interval-js` target.
 */
const INTERVAL_GLSL_FUNCTIONS: CompiledFunctions<Expression> = {
  Add: (args, compile) => {
    if (args.length === 0) return 'vec2(0.0, 0.0)';
    let r = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      r = `_iv_add(${r}, ${compile(args[i])})`;
    return r;
  },
  Subtract: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Subtract: missing argument');
    return `_iv_sub(${compile(a)}, ${compile(b)})`;
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return 'vec2(1.0, 1.0)';
    let r = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      r = `_iv_mul(${r}, ${compile(args[i])})`;
    return r;
  },
  Divide: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Divide: missing argument');
    return `_iv_div(${compile(a)}, ${compile(b)})`;
  },
  Negate: ([a], compile) => {
    if (a === null) throw new Error('Negate: no argument');
    return `_iv_negate(${compile(a)})`;
  },
  Square: ([a], compile) => {
    if (a === null) throw new Error('Square: no argument');
    return `_iv_square(${compile(a)})`;
  },
  Sqrt: ([a], compile) => {
    if (a === null) throw new Error('Sqrt: no argument');
    return `_iv_sqrt(${compile(a)})`;
  },
  Abs: ([a], compile) => {
    if (a === null) throw new Error('Abs: no argument');
    return `_iv_abs(${compile(a)})`;
  },
  Exp: ([a], compile) => {
    if (a === null) throw new Error('Exp: no argument');
    return `_iv_exp(${compile(a)})`;
  },
  Ln: ([a], compile) => {
    if (a === null) throw new Error('Ln: no argument');
    return `_iv_ln(${compile(a)})`;
  },
  Log: (args, compile) => {
    if (args.length === 1) return `_iv_log10(${compile(args[0])})`;
    // Log(x, b) = log_b(x) = ln(x) / ln(b)
    return `_iv_div(_iv_ln(${compile(args[0])}), _iv_ln(${compile(args[1])}))`;
  },
  Lb: ([a], compile) => {
    if (a === null) throw new Error('Lb: no argument');
    return `_iv_log2(${compile(a)})`;
  },
  Sin: ([a], compile) => {
    if (a === null) throw new Error('Sin: no argument');
    return `_iv_sin(${compile(a)})`;
  },
  Cos: ([a], compile) => {
    if (a === null) throw new Error('Cos: no argument');
    return `_iv_cos(${compile(a)})`;
  },
  Tan: ([a], compile) => {
    if (a === null) throw new Error('Tan: no argument');
    return `_iv_tan(${compile(a)})`;
  },
  Arcsin: ([a], compile) => {
    if (a === null) throw new Error('Arcsin: no argument');
    return `_iv_asin(${compile(a)})`;
  },
  Arccos: ([a], compile) => {
    if (a === null) throw new Error('Arccos: no argument');
    return `_iv_acos(${compile(a)})`;
  },
  Arctan: ([a], compile) => {
    if (a === null) throw new Error('Arctan: no argument');
    return `_iv_atan(${compile(a)})`;
  },
  Floor: ([a], compile) => {
    if (a === null) throw new Error('Floor: no argument');
    return `_iv_floor(${compile(a)})`;
  },
  Ceil: ([a], compile) => {
    if (a === null) throw new Error('Ceil: no argument');
    return `_iv_ceil(${compile(a)})`;
  },
  Round: ([a], compile) => {
    if (a === null) throw new Error('Round: no argument');
    return `_iv_round(${compile(a)})`;
  },
  Truncate: ([a], compile) => {
    if (a === null) throw new Error('Truncate: no argument');
    return `_iv_trunc(${compile(a)})`;
  },
  Fract: ([a], compile) => {
    if (a === null) throw new Error('Fract: no argument');
    return `_iv_fract(${compile(a)})`;
  },
  Sign: ([a], compile) => {
    if (a === null) throw new Error('Sign: no argument');
    return `_iv_sign(${compile(a)})`;
  },
  Heaviside: ([a], compile) => {
    if (a === null) throw new Error('Heaviside: no argument');
    return `_iv_heaviside(${compile(a)})`;
  },
  Mod: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Mod: missing argument');
    return `_iv_mod(${compile(a)}, ${compile(b)})`;
  },
  Min: (args, compile) => {
    if (args.length === 0) throw new Error('Min: no argument');
    let r = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      r = `_iv_min(${r}, ${compile(args[i])})`;
    return r;
  },
  Max: (args, compile) => {
    if (args.length === 0) throw new Error('Max: no argument');
    let r = compile(args[0]);
    for (let i = 1; i < args.length; i++)
      r = `_iv_max(${r}, ${compile(args[i])})`;
    return r;
  },
  Power: ([base, exp], compile) => {
    if (base === null || exp === null)
      throw new Error('Power: missing argument');
    // e^x
    if (isSymbol(base, 'ExponentialE')) return `_iv_exp(${compile(exp)})`;
    if (isNumber(exp) && exp.im === 0) {
      const v = exp.re;
      if (v === 0.5) return `_iv_sqrt(${compile(base)})`;
      if (v === 2) return `_iv_square(${compile(base)})`;
      // Tight integer power (even/odd handled in _iv_powi).
      if (Number.isInteger(v) && v >= 0)
        return `_iv_powi(${compile(base)}, ${formatGPUNumber(v)})`;
      // Positive non-integer (rational) power.
      if (!Number.isInteger(v) && v > 0) {
        // A rational exponent p/q (lowest terms) with an ODD denominator is
        // real for a negative base too (e.g. (-8)^(2/3) = 4). Route through
        // `_iv_powrat`, which applies the interpreter's real-root convention;
        // `_iv_powf` clamps a negative base to empty.
        const p = exp.numerator?.re;
        const q = exp.denominator?.re;
        if (Number.isInteger(p) && Number.isInteger(q) && q > 1 && q % 2 !== 0)
          return `_iv_powrat(${compile(base)}, ${formatGPUNumber(p)}, ${formatGPUNumber(v)})`;
        // Even denominator (or non-rational): real only for base ≥ 0.
        return `_iv_powf(${compile(base)}, ${formatGPUNumber(v)})`;
      }
      // Negative exponents (reciprocal powers) are deferred → `unsupported`
      // → CPU `interval-js` fallback. (Reciprocals via `Divide` are supported.)
      throw new Error(
        `interval-glsl: Power with exponent \`${exp.toString()}\` is not yet supported`
      );
    }
    throw new Error(
      'interval-glsl: Power with a variable exponent is not yet supported'
    );
  },
};

/** Mathematical constants as point intervals. */
const INTERVAL_GLSL_CONSTANTS: Record<string, string> = {
  Pi: 'vec2(3.14159265359, 3.14159265359)',
  ExponentialE: 'vec2(2.71828182846, 2.71828182846)',
  GoldenRatio: 'vec2(1.61803398875, 1.61803398875)',
  CatalanConstant: 'vec2(0.91596559417, 0.91596559417)',
  EulerGamma: 'vec2(0.57721566490, 0.57721566490)',
};

/**
 * GLSL interval-arithmetic compilation target. Reuses `GLSLTarget`'s shader
 * assembly; swaps in the interval function table, the `vec2` point-interval
 * number/var hooks, and the `_iv_*` preamble.
 *
 * @deprecated The `interval-glsl` target is deprecated and will be removed in a
 * future release. GPU interval evaluation only pays off when the whole pipeline
 * stays on the GPU; the compile → FBO → readPixels → CPU round-trip is
 * net-negative versus CPU `interval-js`, and this target cannot compile any
 * relational operator (so it cannot host restriction/masking conditions). Use
 * `interval-js` (CPU interval arithmetic) or the scalar `glsl`/`wgsl` targets
 * instead.
 */
export class IntervalGLSLTarget extends GLSLTarget {
  protected readonly languageId = 'interval-glsl';

  getOperators(): CompiledOperators {
    return {}; // arithmetic routes through functions, never native infix
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_GLSL_FUNCTIONS;
  }

  getConstants(): Record<string, string> {
    return INTERVAL_GLSL_CONSTANTS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return super.createTarget({
      operators: () => undefined,
      functions: (id) => INTERVAL_GLSL_FUNCTIONS[id],
      number: (n) => `vec2(${formatGPUNumber(n)}, ${formatGPUNumber(n)})`,
      complex: () => {
        throw new Error('interval-glsl: complex values are not supported');
      },
      var: (id) => INTERVAL_GLSL_CONSTANTS[id],
      ...options,
    });
  }

  /**
   * The `_iv_*` interval-arithmetic preamble, optionally configured (e.g. an
   * absolute `trigAbsPad`). A renderer that builds its own cell box and calls
   * `iv.code` directly should inject this and outward-round its box inputs with
   * the public `_iv_widen_t` helper (§13/Q1).
   */
  getPreamble(options: IntervalGLSLPreambleOptions = {}): string {
    return intervalGLSLPreamble(options);
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> & IntervalGLSLPreambleOptions = {}
  ): CompilationResult {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    // (This override does not chain to `super.compile`, so it applies the
    // rewrite itself — exactly once per compilation.)
    expr = rewriteAngularUnit(expr);
    const { vars, trigAbsPad } = options;

    const target = this.createTarget({
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        if (id in INTERVAL_GLSL_CONSTANTS) return INTERVAL_GLSL_CONSTANTS[id];
        // Assigned value (folded by BaseCompiler) or a genuinely free symbol
        // (a bare `vec2` uniform the caller supplies as the cell's box).
        return undefined;
      },
    });

    const code = BaseCompiler.compile(expr, target);
    const result = BaseCompiler.withReferences(
      { target: 'interval-glsl', success: true, code } as CompilationResult,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );

    // Emit the preamble whenever an `_iv_` op is used OR the curve has free
    // variables a renderer will box — so the public `_iv_widen_box` box-pad
    // helper is always available even for an op-free curve like `f = x` (§13/Q1).
    if (code.includes('_iv_') || (result.freeSymbols?.length ?? 0) > 0)
      result.preamble = this.getPreamble({ trigAbsPad });

    return result;
  }

  /**
   * Emit a complete, self-contained GLSL fragment shader implementing the
   * **interval exclusion oracle** for the implicit curve `f = 0` (Phase 4).
   *
   * The shader is structured so the core contract — the interval evaluator —
   * is cleanly separable from the render harness:
   *
   * - `vec2 _implicit(<vec2 per free variable>)` evaluates the interval of `f`
   *   over a cell box (this is the part that matters; it is exactly
   *   `compile(expr).code` wrapped in a function).
   * - `main()` is a **reference harness**: it derives each fragment's cell box
   *   from `gl_FragCoord` and the viewport uniforms, **outward-rounds** that box
   *   (see below), evaluates `_implicit`, and writes the exclusion result. The
   *   renderer is free to replace `main()` / the uniforms with its own
   *   conventions and keep `_implicit`.
   *
   * **Box outward-rounding (float32 soundness, §13).** The cell box is built in
   * float32 (`mix` of the domain uniforms), which rounds to nearest and can land
   * a few ulp *inside* the true cell edge — enough to flip a grazing tangency's
   * exclusion verdict, independent of the per-op widening. `main()` therefore
   * widens each box with `_iv_widen_box(box, extent)` before evaluating. The pad
   * is scaled to the **domain extent**, not the local edge value, because that is
   * what bounds the `mix` error — a value-relative pad would vanish for an edge
   * near 0 in a wide domain. A renderer that builds its own boxes must do the
   * same (call `_iv_widen_box` per axis).
   *
   * The first free variable maps to `u_domainX`, the second to `u_domainY`
   * (≤ 2 free variables; a 2D implicit curve). The exclusion predicate is
   * `f.lo > 0 || f.hi < 0` — which also excludes the `empty` (domain-undefined)
   * interval, since its `lo` is the `+IV_INF` sentinel.
   *
   * @throws if the expression has more than two free variables, or cannot be
   * lowered (an unsupported head propagates from `BaseCompiler.compile`).
   */
  compileExclusionShader(
    expr: Expression,
    options: {
      version?: string;
      precision?: string;
    } & IntervalGLSLPreambleOptions = {}
  ): string {
    const { version = '300 es', precision = 'highp', trigAbsPad } = options;
    const compiled = this.compile(expr);
    const vars = compiled.freeSymbols ?? [];
    if (vars.length > 2)
      throw new Error(
        `interval-glsl exclusion shader supports at most 2 free variables ` +
          `(got ${vars.length}: ${vars.join(', ')})`
      );

    const params = vars.map((v) => `vec2 ${v}`).join(', ');
    const [axisX, axisY] = vars;

    const main: string[] = ['void main() {'];
    main.push('  vec2 _cell = gl_FragCoord.xy / u_resolution;');
    main.push('  vec2 _step = 1.0 / u_resolution;');
    const callArgs: string[] = [];
    if (axisX !== undefined) {
      main.push('  float _xlo = mix(u_domainX.x, u_domainX.y, _cell.x);');
      main.push(
        '  float _xhi = mix(u_domainX.x, u_domainX.y, _cell.x + _step.x);'
      );
      // Outward-round the box by a pad scaled to the domain extent (§13).
      main.push('  float _xext = max(abs(u_domainX.x), abs(u_domainX.y));');
      callArgs.push('_iv_widen_box(vec2(_xlo, _xhi), _xext)');
    }
    if (axisY !== undefined) {
      main.push('  float _ylo = mix(u_domainY.x, u_domainY.y, _cell.y);');
      main.push(
        '  float _yhi = mix(u_domainY.x, u_domainY.y, _cell.y + _step.y);'
      );
      main.push('  float _yext = max(abs(u_domainY.x), abs(u_domainY.y));');
      callArgs.push('_iv_widen_box(vec2(_ylo, _yhi), _yext)');
    }
    main.push(`  vec2 _f = _implicit(${callArgs.join(', ')});`);
    // lo > 0 || hi < 0  ⇒  the curve cannot pass through this cell (also
    // excludes `empty`, whose lo is +IV_INF). Live cells are kept (white).
    main.push('  bool _excluded = (_f.x > 0.0 || _f.y < 0.0);');
    main.push(
      '  fragColor = _excluded ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);'
    );
    main.push('}');

    return [
      `#version ${version}`,
      `precision ${precision} float;`,
      '',
      this.getPreamble({ trigAbsPad }).trim(),
      '',
      'uniform vec2 u_domainX;    // [min, max] for the 1st free variable',
      'uniform vec2 u_domainY;    // [min, max] for the 2nd free variable',
      'uniform vec2 u_resolution; // render target size, in pixels',
      '',
      'out vec4 fragColor;',
      '',
      '// Interval evaluation of the implicit field f over a cell box. The box is',
      '// outward-rounded by the caller (main(), via _iv_widen_box).',
      `vec2 _implicit(${params}) {`,
      `  return ${compiled.code};`,
      '}',
      '',
      main.join('\n'),
      '',
    ].join('\n');
  }
}
