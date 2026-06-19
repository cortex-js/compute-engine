/**
 * Faithful JavaScript port of `INTERVAL_GLSL_PREAMBLE`
 * (`src/compute-engine/compilation/interval-glsl-target.ts`), used by the
 * interval-glsl test harness to *execute* generated code without a WebGL2
 * context (INTERVAL_GLSL_PLAN.md §6: "a CPU re-implementation of the `_iv_*`
 * preamble"). Each function mirrors its GLSL counterpart line-for-line; if the
 * preamble changes, update this in lockstep.
 *
 * Not a test file (no `.test.` suffix) so jest does not collect it.
 */

export const IV_INF = 1e18;
export type IV = [number, number];

const IV_EMPTY: IV = [IV_INF, -IV_INF];
const IV_ENTIRE: IV = [-IV_INF, IV_INF];

export const isEmptyIV = (a: IV): boolean => a[0] > a[1];

const vec2 = (a: number, b: number): IV => [a, b];
const cl = (a: IV): IV => [
  Math.min(Math.max(a[0], -IV_INF), IV_INF),
  Math.min(Math.max(a[1], -IV_INF), IV_INF),
];
const g1 = (r: IV, a: IV): IV => (isEmptyIV(a) ? IV_EMPTY : r);
const g2 = (r: IV, a: IV, b: IV): IV =>
  isEmptyIV(a) || isEmptyIV(b) ? IV_EMPTY : r;

// Outward rounding (mirrors the preamble's _iv_widen / _iv_widen_t). The port
// runs in float64, so widening here is conservative cosmetic parity (keeps the
// JS results outward of interval-js, exactly as float32 does on the GPU). `wd` =
// 1 ulp (correctly-rounded ops); `wdt` = a few ulp (`/`, sqrt, exp/log, pow,
// trig — builtins GLSL ES does not round tightly).
const IV_EPS = 1.1920929e-7; // 2^-23
const IV_ABS_FLOOR = 1e-30;
const IV_EPS_FN = 8 * IV_EPS;
const IV_EPS_POW = 32 * IV_EPS; // GLSL ES `pow` ~16 ulp; 32 = headroom
// Absolute sin/cos pad (mirrors the preamble's IV_TRIG_ABS; default 0 = off).
let IV_TRIG_ABS = 0;
export const setTrigAbsPad = (v: number): void => {
  IV_TRIG_ABS = v;
};
const wd = (r: IV): IV => [
  r[0] - (Math.abs(r[0]) * IV_EPS + IV_ABS_FLOOR),
  r[1] + (Math.abs(r[1]) * IV_EPS + IV_ABS_FLOOR),
];
const wdt = (r: IV): IV => [
  r[0] - (Math.abs(r[0]) * IV_EPS_FN + IV_ABS_FLOOR),
  r[1] + (Math.abs(r[1]) * IV_EPS_FN + IV_ABS_FLOOR),
];
const wpow = (r: IV): IV => [
  r[0] - (Math.abs(r[0]) * IV_EPS_POW + IV_ABS_FLOOR),
  r[1] + (Math.abs(r[1]) * IV_EPS_POW + IV_ABS_FLOOR),
];
const wsc = (r: IV): IV => [
  r[0] - (Math.abs(r[0]) * IV_EPS_FN + IV_TRIG_ABS + IV_ABS_FLOOR),
  r[1] + (Math.abs(r[1]) * IV_EPS_FN + IV_TRIG_ABS + IV_ABS_FLOOR),
];

const _iv_negate = (a: IV) => g1(cl([-a[1], -a[0]]), a);
const _iv_add = (a: IV, b: IV) => g2(cl(wd([a[0] + b[0], a[1] + b[1]])), a, b);
const _iv_sub = (a: IV, b: IV) => g2(cl(wd([a[0] - b[1], a[1] - b[0]])), a, b);
const _iv_mul = (a: IV, b: IV) => {
  const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return g2(cl(wd([Math.min(...p), Math.max(...p)])), a, b);
};
const _iv_div = (a: IV, b: IV) => {
  const spans = b[0] <= 0 && b[1] >= 0;
  const q = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]];
  let r: IV = [Math.min(...q), Math.max(...q)];
  if (spans) r = IV_ENTIRE;
  return g2(cl(wdt(r)), a, b);
};
const _iv_square = (a: IV) => {
  const l2 = a[0] * a[0];
  const h2 = a[1] * a[1];
  const lo = a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(l2, h2);
  return g1(cl(wd([lo, Math.max(l2, h2)])), a);
};
const psc = (x: number, n: number) => {
  const v = Math.pow(Math.abs(x), n);
  return n % 2 === 1 && x < 0 ? -v : v;
};
const _iv_powi = (a: IV, n: number) => {
  const pl = psc(a[0], n);
  const ph = psc(a[1], n);
  const even = n % 2 === 0;
  const st = a[0] <= 0 && a[1] >= 0;
  const lo = even ? (st ? 0 : Math.min(pl, ph)) : pl;
  const hi = even ? Math.max(pl, ph) : ph;
  return g1(cl(wpow([lo, hi])), a);
};
const _iv_abs = (a: IV) => {
  const al = Math.abs(a[0]);
  const ah = Math.abs(a[1]);
  const st = a[0] <= 0 && a[1] >= 0;
  return g1(cl([st ? 0 : Math.min(al, ah), Math.max(al, ah)]), a);
};
const _iv_sqrt = (a: IV) => {
  let r: IV = [Math.sqrt(Math.max(a[0], 0)), Math.sqrt(Math.max(a[1], 0))];
  if (a[1] < 0) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_exp = (a: IV) => g1(cl(wdt([Math.exp(a[0]), Math.exp(a[1])])), a);
const INV_LN10 = 0.43429448190325176;
const INV_LN2 = 1.4426950408889634;
const _iv_ln = (a: IV) => {
  let r: IV = [a[0] > 0 ? Math.log(a[0]) : -IV_INF, Math.log(a[1])];
  if (a[1] <= 0) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_log10 = (a: IV) => {
  let r: IV = [
    a[0] > 0 ? Math.log(a[0]) * INV_LN10 : -IV_INF,
    Math.log(a[1]) * INV_LN10,
  ];
  if (a[1] <= 0) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_log2 = (a: IV) => {
  let r: IV = [
    a[0] > 0 ? Math.log(a[0]) * INV_LN2 : -IV_INF,
    Math.log(a[1]) * INV_LN2,
  ];
  if (a[1] <= 0) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_powf = (a: IV, p: number) => {
  const lob = Math.max(a[0], 0);
  const e0 = Math.pow(lob, p);
  const e1 = Math.pow(a[1], p);
  let r: IV = p >= 0 ? [e0, e1] : [e1, e0];
  if (a[1] < 0) r = IV_EMPTY;
  return g1(cl(wpow(r)), a);
};
const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const THREE_HALF_PI = (3 * Math.PI) / 2;
const hasExt = (a: IV, ext: number, period: number) => {
  const n = Math.ceil((a[0] - ext) / period);
  const cand = ext + n * period;
  return cand >= a[0] - 1e-15 && cand <= a[1] + 1e-15;
};
const _iv_sin = (a: IV) => {
  let r: IV;
  if (a[1] - a[0] >= TWO_PI) r = [-1, 1];
  else {
    const sl = Math.sin(a[0]);
    const sh = Math.sin(a[1]);
    let lo = Math.min(sl, sh);
    let hi = Math.max(sl, sh);
    if (hasExt(a, HALF_PI, TWO_PI)) hi = 1;
    if (hasExt(a, THREE_HALF_PI, TWO_PI)) lo = -1;
    r = [lo, hi];
  }
  return g1(cl(wsc(r)), a);
};
const _iv_cos = (a: IV) => {
  let r: IV;
  if (a[1] - a[0] >= TWO_PI) r = [-1, 1];
  else {
    const c0 = Math.cos(a[0]);
    const ch = Math.cos(a[1]);
    let lo = Math.min(c0, ch);
    let hi = Math.max(c0, ch);
    if (hasExt(a, 0, TWO_PI)) hi = 1;
    if (hasExt(a, PI, TWO_PI)) lo = -1;
    r = [lo, hi];
  }
  return g1(cl(wsc(r)), a);
};
const _iv_tan = (a: IV) => {
  const pole = a[1] - a[0] >= PI || hasExt(a, HALF_PI, PI);
  const tl = Math.tan(a[0]);
  const th = Math.tan(a[1]);
  const crossed =
    (tl > 1e10 && th < -1e10) || (tl < -1e10 && th > 1e10);
  const r: IV = pole || crossed ? IV_ENTIRE : [tl, th];
  return g1(cl(wdt(r)), a);
};
const _iv_asin = (a: IV) => {
  let r: IV = [Math.asin(Math.max(a[0], -1)), Math.asin(Math.min(a[1], 1))];
  if (a[0] > 1 || a[1] < -1) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_acos = (a: IV) => {
  let r: IV = [Math.acos(Math.min(a[1], 1)), Math.acos(Math.max(a[0], -1))];
  if (a[0] > 1 || a[1] < -1) r = IV_EMPTY;
  return g1(cl(wdt(r)), a);
};
const _iv_atan = (a: IV) => g1(cl(wdt([Math.atan(a[0]), Math.atan(a[1])])), a);
const _iv_floor = (a: IV) => g1(cl([Math.floor(a[0]), Math.floor(a[1])]), a);
const _iv_ceil = (a: IV) => g1(cl([Math.ceil(a[0]), Math.ceil(a[1])]), a);
const _iv_round = (a: IV) =>
  g1(cl([Math.floor(a[0] + 0.5), Math.floor(a[1] + 0.5)]), a);
const _iv_trunc = (a: IV) => g1(cl([Math.trunc(a[0]), Math.trunc(a[1])]), a);
const _iv_sign = (a: IV) => g1([Math.sign(a[0]), Math.sign(a[1])], a);
const _iv_heaviside = (a: IV) => {
  const h = (t: number) => (t < 0 ? 0 : t > 0 ? 1 : 0.5);
  return g1([h(a[0]), h(a[1])], a);
};
const _iv_fract = (a: IV) => {
  const fl = Math.floor(a[0]);
  const r: IV = fl === Math.floor(a[1]) ? [a[0] - fl, a[1] - fl] : [0, 1];
  return g1(cl(wd(r)), a);
};
const _iv_min = (a: IV, b: IV) =>
  g2(cl([Math.min(a[0], b[0]), Math.min(a[1], b[1])]), a, b);
const _iv_max = (a: IV, b: IV) =>
  g2(cl([Math.max(a[0], b[0]), Math.max(a[1], b[1])]), a, b);
const _iv_mod = (a: IV, b: IV): IV => {
  if (b[0] <= 0 && b[1] >= 0) return g2(IV_ENTIRE, a, b);
  if (b[0] === b[1]) {
    const p = Math.abs(b[0]);
    const flo = Math.floor(a[0] / p);
    const r: IV =
      flo === Math.floor(a[1] / p) ? [a[0] - p * flo, a[1] - p * flo] : [0, p];
    return g2(cl(wd(r)), a, b);
  }
  return _iv_sub(a, _iv_mul(b, _iv_floor(_iv_div(a, b))));
};

const HELPERS = {
  vec2,
  _iv_negate,
  _iv_add,
  _iv_sub,
  _iv_mul,
  _iv_div,
  _iv_square,
  _iv_powi,
  _iv_abs,
  _iv_sqrt,
  _iv_exp,
  _iv_ln,
  _iv_log10,
  _iv_log2,
  _iv_powf,
  _iv_sin,
  _iv_cos,
  _iv_tan,
  _iv_asin,
  _iv_acos,
  _iv_atan,
  _iv_floor,
  _iv_ceil,
  _iv_round,
  _iv_trunc,
  _iv_sign,
  _iv_heaviside,
  _iv_fract,
  _iv_min,
  _iv_max,
  _iv_mod,
};

/**
 * Execute interval-glsl generated `code` (a `_iv_*`/`vec2` expression in the
 * given free variables) with `vars` bound to `[lo, hi]` intervals.
 */
export function runIntervalGLSL(
  code: string,
  vars: Record<string, IV>
): IV {
  const helperNames = Object.keys(HELPERS);
  const varNames = Object.keys(vars);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    ...helperNames,
    ...varNames,
    `return ${code};`
  );
  return fn(
    ...helperNames.map((n) => (HELPERS as Record<string, unknown>)[n]),
    ...varNames.map((n) => vars[n])
  );
}
