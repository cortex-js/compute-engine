/**
 * A JavaScript model of the GPU Lerch transcendent and polylogarithm helpers
 * (`GPU_LERCH_PREAMBLE_GLSL`, `compilation/gpu-target.ts`), statement by
 * statement, in f32: every arithmetic result is rounded with `Math.fround`,
 * and every transcendental function (exp, log, pow, sin, cos, atan) is the
 * double result rounded once to f32. A GPU's exp, log and pow are a few ulp
 * less accurate than that, so this model tests the ALGORITHM (the methods,
 * the regions, the error estimates that make a helper decline), not the
 * driver. Shader text cannot run under jest; this model is how
 * `compile-gpu-lerch-continuation.test.ts` pins the algorithm's values.
 *
 * Each function has the name of the shader function it models. When the
 * shader text changes, this model must change with it.
 *
 * Not modelled: z = 1 (the shader calls `_gpu_hurwitz_zeta`, from the zeta
 * preamble), which returns NaN here.
 */

let gpuModel = false;
/** f32 rounding; in the GPU model, subnormal results flush to zero as GPUs
 * do (Apple's among them). */
const fr = (x: number): number => {
  const r = Math.fround(x);
  return gpuModel && r !== 0 && Math.abs(r) < 1.1754943508222875e-38
    ? 0 * r
    : r;
};
const add = (x: number, y: number) => fr(x + y);
const sub = (x: number, y: number) => fr(x - y);
const mul = (x: number, y: number) => fr(x * y);
const div = (x: number, y: number) => fr(x / y);
const sqrt = (x: number) => fr(Math.sqrt(fr(x)));
const sin = (x: number) => fr(Math.sin(fr(x)));
const cos = (x: number) => fr(Math.cos(fr(x)));
const atan = (x: number) => fr(Math.atan(fr(x)));
const atan2 = (y: number, x: number) => fr(Math.atan2(fr(y), fr(x)));
const { abs, max, min, floor, ceil } = Math;

/**
 * With `gpu` set, exp, log, log2 and pow follow the way GPU drivers build
 * them, with the argument-scaling error that brings: exp(x) is exp2 of the
 * f32 product x·log2(e), log2 carries up to 2.5 ulp of error (a GPU measured
 * about 1.5 ulp), and pow(x, y) is exp2 of the f32 product y·log2(x). This
 * is a pessimistic GPU, for measuring the error estimates; the jest pins use
 * the default, the double result rounded once to f32.
 */
export function setGpuErrorModel(on: boolean): void {
  gpuModel = on;
}
function noisyLog2(x: number): number {
  const l = fr(Math.log2(x));
  const h = Math.abs(Math.sin(x * 12.9898 + 78.233) * 43758.5453) % 1;
  return fr(l + (h - 0.5) * 5 * (Math.abs(l) * 2 ** -23 + 1e-45));
}
function exp(x: number): number {
  x = fr(x);
  if (!gpuModel) return fr(Math.exp(x));
  return fr(Math.pow(2, fr(x * fr(Math.LOG2E))));
}
function log(x: number): number {
  x = fr(x);
  if (!gpuModel) return fr(Math.log(x));
  return fr(noisyLog2(x) * fr(Math.LN2));
}
function log2(x: number): number {
  x = fr(x);
  if (!gpuModel) return fr(Math.log2(x));
  return noisyLog2(x);
}
/** GLSL `pow`: undefined for a negative base, NaN here. */
function pow(x: number, y: number): number {
  if (x < 0) return NaN;
  x = fr(x);
  y = fr(y);
  if (!gpuModel) return fr(Math.pow(x, y));
  if (x === 0) return y > 0 ? 0 : y === 0 ? NaN : Infinity;
  return fr(Math.pow(2, fr(y * noisyLog2(x))));
}

/** The method that produced the last value (for measurements). */
export let lastRoute = '';
/** The number of panels the last integral used (for measurements). */
export let lastPanels = 0;

const PI = fr(3.14159265358979);
const EPS = fr(6e-8);
const TOL = fr(3e-5);
const GX = [
  0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363,
].map(fr);
const GW = [
  0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
].map(fr);

/** [value, ok] — the shader's vec2(value, 1) or vec2(0, 0). */
type Result = [number, boolean];
const DECLINE: Result = [0, false];

function _gpu_zeta_pow(x: number, e: number): number {
  if (x >= 0) return pow(x, e);
  if (e !== floor(e)) return NaN;
  const r = pow(-x, e);
  if (abs(e) % 2 === 1) return -r;
  return r;
}

function _gpu_lerch_series(z: number, s: number, a: number): Result {
  const n0 = a < 0 ? ceil(-a) : 0;
  const az = abs(z);
  let sum = 0;
  let zk = 1;
  let prev = fr(3e38);
  let err = 0;
  let sizes = 0;
  let bmin = fr(3e38);
  let bmax = 0;
  let settled = 0;
  for (let k = 0; k < n0 + 4096; k++) {
    const b = add(a, k);
    const t = b !== 0 ? mul(zk, _gpu_zeta_pow(b, -s)) : 0;
    sum = add(sum, t);
    const size = abs(t);
    err = add(err, mul(size, add(2, k)));
    sizes = add(sizes, size);
    if (b !== 0) {
      bmin = min(bmin, abs(b));
      bmax = max(bmax, abs(b));
    }
    if (b > 0) {
      const rho = max(div(size, prev), az);
      if (
        size === 0 ||
        (size < prev &&
          rho < 1 &&
          div(mul(size, rho), sub(1, rho)) <= mul(fr(1e-7), abs(sum)))
      ) {
        settled++;
        if (settled === 3) {
          const lb = max(abs(log2(bmin)), abs(log2(bmax)));
          const bound = mul(EPS, add(err, mul(sizes, add(2, abs(mul(s, lb))))));
          if (!(bound <= mul(TOL, abs(sum)))) return DECLINE;
          if (mul(abs(sum), sub(1, az)) < fr(1.9721523e-31)) return DECLINE;
          return [sum, true];
        }
      } else settled = 0;
      prev = size;
    }
    zk = mul(zk, z);
  }
  return DECLINE;
}

const LERCH_EULER_TERMS = 64;
function _gpu_lerch_euler(z: number, s: number, a: number): Result {
  const n0 = a <= 0 ? floor(-a) + 1 : 0;
  let head = 0;
  let zn = 1;
  let largest = 0;
  for (let k = 0; k < n0; k++) {
    const b = add(a, k);
    const t = b !== 0 ? mul(zn, _gpu_zeta_pow(b, -s)) : 0;
    head = add(head, t);
    largest = max(largest, abs(t));
    zn = mul(zn, z);
  }
  const b0 = add(a, n0);
  const w: number[] = new Array(LERCH_EULER_TERMS + 1).fill(0);
  let nterm = 0;
  let sum = 0;
  let zPow = 1;
  let settled = 0;
  for (let k = 0; k < LERCH_EULER_TERMS; k++) {
    const cur = mul(zPow, pow(add(b0, k), -s));
    let inc: number;
    if (k === 0) {
      nterm = 1;
      w[1] = cur;
      inc = mul(0.5, cur);
    } else {
      let tmp = w[1];
      w[1] = cur;
      for (let j = 1; j <= nterm - 1; j++) {
        const dum = w[j + 1];
        w[j + 1] = mul(0.5, add(w[j], tmp));
        tmp = dum;
      }
      if (nterm >= LERCH_EULER_TERMS) return DECLINE;
      w[nterm + 1] = mul(0.5, add(w[nterm], tmp));
      if (abs(w[nterm + 1]) <= abs(w[nterm])) {
        nterm++;
        inc = mul(0.5, w[nterm]);
      } else inc = w[nterm + 1];
    }
    sum = add(sum, inc);
    zPow = mul(zPow, z);
    if (k > 4 && abs(inc) <= mul(fr(1e-7), abs(sum))) {
      settled++;
      if (settled === 3) {
        if (abs(sum) < fr(1.9721523e-31)) return DECLINE;
        const tail = mul(zn, sum);
        const res = add(head, tail);
        if (max(largest, abs(tail)) > mul(100, abs(res))) return DECLINE;
        return [res, true];
      }
    } else settled = 0;
  }
  return DECLINE;
}

function _gpu_lerch_em(t: number): number {
  if (t < 0.25) {
    let r = sub(1, div(t, 7));
    r = sub(1, mul(div(t, 6), r));
    r = sub(1, mul(div(t, 5), r));
    r = sub(1, mul(div(t, 4), r));
    r = sub(1, mul(div(t, 3), r));
    r = sub(1, mul(div(t, 2), r));
    return mul(t, r);
  }
  return sub(1, exp(-t));
}

function _gpu_lerch_lgamma(s: number): number {
  let p = 1;
  let x = s;
  for (let k = 0; k < 8; k++) {
    if (x >= 8) break;
    p = mul(p, x);
    x = add(x, 1);
  }
  const x2 = mul(x, x);
  const corr = div(
    sub(div(1, 12), div(sub(div(1, 360), div(1, mul(1260, x2))), x2)),
    x
  );
  return sub(
    add(sub(mul(sub(x, 0.5), log(x)), x), add(fr(0.91893853320467274), corr)),
    log(p)
  );
}

/** The largest n of Φ(w, −n, a) the helpers build (coefficient arrays
 * hold n + 2 entries). */
const LERCH_MAX_N = 16;

/**
 * The coefficients of P_n(w) = (1 − w)^(n+1) Φ(w, −n, a), from P_0 = 1 and
 * P_(m+1)(w) = (1 − w)(a P_m + w P_m') + (m + 1) w P_m, that is
 * p'_k = (a + k) p_k + (m + 2 − a − k) p_(k−1). Updated in place from the
 * top, so each entry still reads the previous row's values.
 */
function _gpu_lerch_pstep(c: number[], a: number, m: number): void {
  for (let k = m + 1; k >= 0; k--) {
    const hi = k <= m ? mul(add(a, k), c[k]) : 0;
    const lo = k >= 1 ? mul(sub(sub(m + 2, a), k), c[k - 1]) : 0;
    c[k] = add(hi, lo);
  }
}

/**
 * Φ(w, −n, a) = v Σ_k p_k u^k v^(n−k), v = 1/(1 − w), u = w v: returns the
 * sum without its factor v, and the sum of the moduli of its terms, by
 * Horner in u with the powers of v carried along. |u|, |v| <= 1 for w < −1,
 * so the sum does not overflow; the caller applies the factor v (or folds
 * it into an exponent, see the integral).
 */
function _gpu_lerch_poly(
  c: number[],
  n: number,
  u: number,
  vv: number
): [number, number] {
  const au = abs(u);
  const av = abs(vv);
  let r = c[n];
  let ra = abs(c[n]);
  let vp = vv;
  let avp = av;
  for (let k = n - 1; k >= 0; k--) {
    r = add(mul(r, u), mul(c[k], vp));
    ra = add(mul(ra, au), mul(abs(c[k]), avp));
    vp = mul(vp, vv);
    avp = mul(avp, av);
  }
  return [r, ra];
}

/** 1/(1 − z e^(−t)) for t >= 0 and z < 1, without cancellation. */
function _gpu_lerch_g(z: number, t: number): number {
  if (z < 0) return div(1, sub(1, mul(z, exp(-t))));
  return div(1, add(sub(1, z), mul(z, _gpu_lerch_em(t))));
}

/** Φ(z, −n, a) for an integer n >= 0 in closed form: [value, ok]. */
function _gpu_lerch_rational(z: number, n: number, a: number): Result {
  const c: number[] = new Array(LERCH_MAX_N + 2).fill(0);
  c[0] = 1;
  for (let m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  const v = div(1, sub(1, z));
  const [q, qa] = _gpu_lerch_poly(c, n, mul(z, v), v);
  if (!(mul(EPS, mul(add(n, 4), qa)) <= mul(TOL, abs(q)))) return DECLINE;
  return [mul(q, v), true];
}

function _gpu_lerch_integral(z: number, s: number, a: number): Result {
  // s <= 0: n integrations by parts bring the order to s + n in (0, 1].
  const n = s > 0 ? 0 : ceil(-s);
  const sn = add(s, n);
  const n0 = a < 0 ? ceil(-a) : 0;
  let head = 0;
  let zk = 1;
  let err = 0;
  for (let k = 0; k < n0; k++) {
    const bk = add(a, k);
    const t = mul(zk, _gpu_zeta_pow(bk, -s));
    head = add(head, t);
    err = add(err, mul(abs(t), add(add(2, k), abs(mul(s, log2(abs(bk)))))));
    zk = mul(zk, z);
  }
  a = add(a, n0);
  const c: number[] = new Array(LERCH_MAX_N + 2).fill(0);
  c[0] = 1;
  for (let m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  const lg = _gpu_lerch_lgamma(sn);
  const lam = min(1, div(1, a));
  const delta = z > 0 ? -log(z) : PI;
  const e0 = mul(fr(1e-3), min(lam, delta));
  const la = log(a);
  const tau0 = mul(a, e0);
  // The step of 1/(1 − z e^(−t)): at t = ln(−z) for z < 0, and the pole at
  // t = ln z < 0 for 0 < z < 1.
  const L = z < 0 ? log(-z) : log(z);
  // Below z = −1 the factor v = 1/(1 + e^(L−t)) is carried as its log,
  // lG = −softplus(L − t), inside the exponent of the density: v runs from
  // about 1/|z| to 1 and the density e^(−a t) to e^(−88) and below, so each
  // alone can fall under the smallest normal f32, which a GPU flushes to
  // zero, where their product does not.
  const big = z < -1;
  // With the factor in the exponent, every node also carries e^S,
  // S = min(a, 1) L, the size of the largest nodes (about |z|^(−min(a,1))),
  // so that the nodes of a value near the smallest normal f32 do not flush
  // to zero one by one; the sum is divided by e^S at the end, inside one
  // exp.
  const S = big ? mul(min(a, 1), L) : 0;
  let lG0 = 0;
  let v0h = div(1, sub(1, z));
  let u0 = mul(z, v0h);
  if (big) {
    lG0 = -add(L, log(add(1, exp(-L))));
    v0h = exp(lG0);
    u0 = -exp(add(L, lG0));
  }
  const [f0, f0a] = _gpu_lerch_poly(c, n, u0, v0h);
  const c1 = c.slice();
  _gpu_lerch_pstep(c1, a, n);
  const [f1, f1a] = _gpu_lerch_poly(c1, n + 1, u0, v0h);
  const p0 = big
    ? exp(add(add(sub(mul(sn, log(tau0)), lg), lG0), S))
    : mul(exp(sub(mul(sn, log(tau0)), lg)), v0h);
  const d1 = div(-f1, a);
  let sum = mul(p0, add(div(f0, sn), div(mul(d1, tau0), add(sn, 1))));
  // The head's error: the rounding of Φ(z, −n, a) and Φ(z, −n−1, a),
  // bounded by their sums of term moduli, and the exp that gives p0.
  let ferr = add(
    mul(
      abs(p0),
      mul(add(div(f0a, sn), div(mul(div(f1a, a), tau0), add(sn, 1))), add(n, 5))
    ),
    mul(abs(sum), add(add(abs(mul(sn, log(tau0))), abs(lg)), abs(L)))
  );
  const v0 = log(e0);
  const v1 = log(lam);
  const nlog = max(1, ceil(div(sub(v1, v0), 3)));
  const hv = div(sub(v1, v0), nlog);
  const TG = add(max(L, 0), 17);
  const tw = div(add(sn, 30), a);
  let tEnd = tw;
  if (z < 0) tEnd = max(tw, a > 1 ? min(TG, div(add(sn, 30), sub(a, 1))) : TG);
  const hW = div(8, a);
  let x = lam;
  let p = 0;
  for (p = 0; p < 28; p++) {
    const logPanel = p < nlog;
    if (!logPanel && x >= tEnd) break;
    // Linear panels: at most 2x wide (the t^(s+n-1) singularity at 0), at
    // most 8/a (e^(-at)), and at most max(4/(1 + n/4), 0.6 |x - L|): the
    // poles of the integrand (of order n + 1) sit at t = L +- i pi, so a
    // panel may be as wide as a fixed fraction of its distance to them.
    const w = logPanel
      ? hv
      : min(
          min(mul(2, x), hW),
          max(div(4, add(1, mul(0.25, n))), mul(0.6, abs(sub(x, L))))
        );
    const cc = logPanel ? add(v0, mul(add(p, 0.5), hv)) : add(x, mul(0.5, w));
    const r = mul(0.5, w);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const u = add(cc, mul(j === 0 ? -r : r, GX[i]));
        const t = logPanel ? exp(u) : u;
        const tau = mul(a, t);
        const e = logPanel ? mul(sn, add(u, la)) : mul(sub(sn, 1), log(tau));
        let vn: number;
        let un: number;
        let lG = 0;
        if (big) {
          const xs = sub(L, t);
          lG = -add(max(xs, 0), log(add(1, exp(-abs(xs)))));
          vn = exp(lG);
          un = -exp(add(xs, lG));
        } else {
          vn = _gpu_lerch_g(z, t);
          un = mul(mul(z, exp(-t)), vn);
        }
        const [pv, pa] = _gpu_lerch_poly(c, n, un, vn);
        const ex = sub(sub(e, tau), lg);
        const q = mul(
          mul(r, GW[i]),
          mul(
            logPanel ? 1 : a,
            big ? exp(add(add(ex, lG), S)) : mul(exp(ex), vn)
          )
        );
        sum = add(sum, mul(q, pv));
        ferr = add(
          ferr,
          mul(
            q,
            add(
              mul(abs(pv), add(add(abs(e), tau), add(abs(lG), abs(L)))),
              mul(pa, add(add(n, 3), t))
            )
          )
        );
      }
    }
    if (!logPanel) x = add(x, w);
  }
  lastPanels = p;
  if (x < tEnd) return DECLINE;
  const scaled = big
    ? mul(sum < 0 ? -1 : 1, exp(sub(log(abs(sum)), add(S, mul(sn, la)))))
    : mul(pow(a, -sn), sum);
  const tail = mul(zk, scaled);
  const res = add(head, tail);
  const rel = add(
    add(div(ferr, abs(sum)), add(8, abs(lg))),
    add(add(n0, 2), add(abs(mul(sn, log2(a))), S))
  );
  const bound = mul(EPS, add(err, mul(abs(tail), rel)));
  if (!(bound <= mul(TOL, abs(res)))) return DECLINE;
  return [res, true];
}

/** [Re h, Im h, error estimate in units of EPS, ok] */
type H = [number, number, number, boolean];

function _gpu_lerch_h_integer(sig: number, xr: number, xi: number): H {
  const n = sig - 1;
  const d = add(mul(xr, xr), mul(xi, xi));
  const ir = div(xr, d);
  const ii = div(-xi, d);
  const ix = sqrt(add(mul(ir, ir), mul(ii, ii)));
  let rr = 1;
  let ri = 0;
  let ra = 1;
  for (let j = 1; j <= n; j++) {
    const tr = sub(mul(ir, rr), mul(ii, ri));
    const ti = add(mul(ir, ri), mul(ii, rr));
    rr = add(1, mul(j, tr));
    ri = mul(j, ti);
    ra = add(1, mul(mul(j, ix), ra));
  }
  return [
    sub(mul(rr, ir), mul(ri, ii)),
    add(mul(rr, ii), mul(ri, ir)),
    mul(mul(add(n, 3), ra), ix),
    true,
  ];
}

function _gpu_lerch_h_series(sig: number, xr: number, xi: number): H {
  let tr = div(1, sig);
  let ti = 0;
  let sr = tr;
  let si = 0;
  let sa = tr;
  let k = 1;
  for (k = 1; k < 100; k++) {
    const f = add(sig, k);
    const nr = div(sub(mul(tr, xr), mul(ti, xi)), f);
    ti = div(add(mul(tr, xi), mul(ti, xr)), f);
    tr = nr;
    sr = add(sr, tr);
    si = add(si, ti);
    const ta = add(abs(tr), abs(ti));
    sa = add(sa, ta);
    if (ta < mul(fr(1e-8), add(abs(sr), abs(si)))) break;
  }
  const er = add(
    sub(xr, mul(sig, log(sqrt(add(mul(xr, xr), mul(xi, xi)))))),
    _gpu_lerch_lgamma(sig)
  );
  const arg =
    xr === 0 ? fr(xi < 0 ? -1.5707963267949 : 1.5707963267949) : atan2(xi, xr);
  const ei = sub(xi, mul(sig, arg));
  const m = exp(er);
  return [
    sub(mul(m, cos(ei)), sr),
    sub(mul(m, sin(ei)), si),
    add(mul(m, add(add(24, abs(er)), abs(ei))), mul(add(k, 3), sa)),
    true,
  ];
}

function _gpu_lerch_h_cf(sig: number, xr: number, xi: number): H {
  const FPMIN = fr(1e-30);
  let br = add(sub(xr, sig), 1);
  const bi = xi;
  let cr = fr(1e30);
  let ci = 0;
  let dd = add(mul(br, br), mul(bi, bi));
  let dr = div(br, dd);
  let di = div(-bi, dd);
  let hr = dr;
  let hi = di;
  for (let i = 1; i < 200; i++) {
    const an = mul(-i, sub(i, sig));
    br = add(br, 2);
    dr = add(mul(an, dr), br);
    di = add(mul(an, di), bi);
    if (add(abs(dr), abs(di)) < FPMIN) dr = FPMIN;
    const cc = add(mul(cr, cr), mul(ci, ci));
    cr = add(br, div(mul(an, cr), cc));
    ci = sub(bi, div(mul(an, ci), cc));
    if (add(abs(cr), abs(ci)) < FPMIN) cr = FPMIN;
    dd = add(mul(dr, dr), mul(di, di));
    dr = div(dr, dd);
    di = div(-di, dd);
    const er = sub(mul(dr, cr), mul(di, ci));
    const ei = add(mul(dr, ci), mul(di, cr));
    const nr = sub(mul(hr, er), mul(hi, ei));
    hi = add(mul(hr, ei), mul(hi, er));
    hr = nr;
    if (add(abs(sub(er, 1)), abs(ei)) < fr(1e-7))
      return [hr, hi, mul(35, sqrt(add(mul(hr, hr), mul(hi, hi)))), true];
  }
  return [0, 0, 0, false];
}

function _gpu_lerch_hermite(z: number, s: number, a: number): Result {
  if (s < -30) return DECLINE;
  const m = a < 1 ? ceil(sub(1, a)) : 0;
  let head = 0;
  let zk = 1;
  let err = 0;
  for (let k = 0; k < m; k++) {
    const bk = add(a, k);
    if (bk !== 0) {
      const t = mul(zk, _gpu_zeta_pow(bk, -s));
      head = add(head, t);
      err = add(err, mul(abs(t), add(add(2, k), abs(mul(s, log2(abs(bk)))))));
    }
    zk = mul(zk, z);
  }
  const b = add(a, m);
  const L = log(abs(z));
  const sig = sub(1, s);
  const xr = mul(-b, L);
  const xi = z < 0 ? mul(-b, PI) : 0;
  let h: H;
  if (sig === floor(sig)) h = _gpu_lerch_h_integer(sig, xr, xi);
  else if (sqrt(add(mul(xr, xr), mul(xi, xi))) < sig)
    h = _gpu_lerch_h_series(sig, xr, xi);
  else h = _gpu_lerch_h_cf(sig, xr, xi);
  if (!h[3]) return DECLINE;
  const t1 = mul(0.5, pow(b, -s));
  const bs = pow(b, sig);
  const t2 = mul(bs, h[0]);
  const t2abs = mul(bs, add(abs(h[0]), abs(h[1])));
  const q3 = max(-s, 0);
  const t3end = div(add(21, mul(q3, log(add(1, div(add(q3, 7), b))))), PI);
  const n3 = ceil(div(t3end, min(1.5, div(4, max(abs(L), fr(1e-3))))));
  if (n3 > 16) return DECLINE;
  const h3 = div(t3end, n3);
  let t3 = 0;
  let a3 = 0;
  const b2 = mul(b, b);
  for (let p = 0; p < 16; p++) {
    if (p >= n3) break;
    const c = mul(add(p, 0.5), h3);
    const r = mul(0.5, h3);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const t = add(c, mul(j === 0 ? -r : r, GX[i]));
        const y = mul(mul(2, PI), t);
        const q = exp(-y);
        const omq = _gpu_lerch_em(y);
        const K =
          z < 0
            ? div(mul(exp(mul(-PI, t)), add(1, q)), mul(2, omq))
            : div(q, omq);
        const f = mul(
          mul(
            sin(sub(mul(t, L), mul(s, atan(div(t, b))))),
            exp(mul(mul(-0.5, s), log(add(b2, mul(t, t)))))
          ),
          K
        );
        const wf = mul(mul(r, GW[i]), f);
        t3 = add(t3, wf);
        a3 = add(
          a3,
          mul(
            abs(wf),
            add(
              add(6, mul(10, t)),
              add(
                mul(abs(s), add(2, mul(0.5, log2(add(b2, mul(t, t)))))),
                abs(mul(t, L))
              )
            )
          )
        );
      }
    }
  }
  t3 = mul(-2, t3);
  a3 = mul(2, a3);
  const phi = add(add(t1, t2), t3);
  const res = add(head, mul(zk, phi));
  const e1 = mul(t1, add(2, abs(mul(s, log2(b)))));
  const e2 = add(mul(t2abs, add(2, abs(mul(sig, log2(b))))), mul(bs, h[2]));
  const ephi = add(add(e1, e2), add(a3, mul(3, add(add(t1, t2abs), abs(t3)))));
  const bound = mul(
    EPS,
    add(add(err, mul(abs(zk), add(ephi, mul(add(m, 2), abs(phi))))), abs(res))
  );
  if (!(bound <= mul(TOL, abs(res)))) return DECLINE;
  return [res, true];
}

/** s <= 0: the integral after n integrations by parts (a non-integer s
 * with a > 0 and s >= −LERCH_MAX_N), then the Hermite form. */
function _gpu_lerch_negative(z: number, s: number, a: number): Result {
  if (s !== floor(s) && a > 0 && s >= -LERCH_MAX_N) {
    const r = _gpu_lerch_integral(z, s, a);
    if (r[1]) {
      lastRoute = 'integral-n';
      return r;
    }
  }
  lastRoute = 'hermite';
  return _gpu_lerch_hermite(z, s, a);
}

function _gpu_lerch_core(z: number, s: number, a: number): Result {
  lastRoute = 'closed';
  if (z === 1) return [NaN, true]; // the Hurwitz zeta: not modelled
  if (z === 0) return [_gpu_zeta_pow(a, -s), true];
  if (s === 0) return [div(1, sub(1, z)), true];
  if (s < 0 && s === floor(s) && s >= -LERCH_MAX_N) {
    lastRoute = 'rational';
    const r = _gpu_lerch_rational(z, -s, a);
    if (r[1]) return r;
  }
  const aNonposInt = a <= 0 && a === floor(a);
  if (aNonposInt && s > 0) return [Infinity, true];
  if (a < 0 && s !== floor(s)) return DECLINE;
  if (a < -1e6) return DECLINE;
  if (z > 1) {
    if (s > 0 || s !== floor(s)) return DECLINE;
    lastRoute = 'hermite';
    return _gpu_lerch_hermite(z, s, a);
  }
  if (z < -1) {
    if (s > 0) {
      lastRoute = 'integral';
      return _gpu_lerch_integral(z, s, a);
    }
    return _gpu_lerch_negative(z, s, a);
  }
  if (z < 0 && s > 0) {
    lastRoute = 'euler';
    const e = _gpu_lerch_euler(z, s, a);
    if (e[1]) return e;
    lastRoute = 'integral';
    return _gpu_lerch_integral(z, s, a);
  }
  if (z === -1) return _gpu_lerch_negative(z, s, a);
  lastRoute = 'series';
  const r = _gpu_lerch_series(z, s, a);
  if (r[1]) return r;
  if (s > 0) {
    lastRoute = 'integral';
    return _gpu_lerch_integral(z, s, a);
  }
  return _gpu_lerch_negative(z, s, a);
}

/** The model of `_gpu_lerch_phi(z, s, a)`, at the f32-rounded operands. */
export function gpuLerchPhiModel(z: number, s: number, a: number): number {
  const r = _gpu_lerch_core(fr(z), fr(s), fr(a));
  return r[1] ? r[0] : NaN;
}

const BERNOULLI = [
  1 / 6,
  -1 / 30,
  1 / 42,
  -1 / 30,
  5 / 66,
  -691 / 2730,
  7 / 6,
  -3617 / 510,
].map(fr);

function _gpu_poly_log_inversion(s: number, z: number): Result {
  const ai = div(-log(-z), mul(2, PI));
  const sig = sub(1, s);
  let zr = 0;
  let zi = 0;
  let zerr = 0;
  for (let k = 0; k < 12; k++) {
    const wk = add(0.5, k);
    const lnwk = mul(0.5, log(add(mul(wk, wk), mul(ai, ai))));
    const ph = mul(-sig, atan2(ai, wk));
    const m = exp(mul(-sig, lnwk));
    zr = add(zr, mul(m, cos(ph)));
    zi = add(zi, mul(m, sin(ph)));
    zerr = add(zerr, mul(m, add(add(4, abs(mul(sig, lnwk))), abs(ph))));
  }
  const wr = fr(12.5);
  const lnw = mul(0.5, log(add(mul(wr, wr), mul(ai, ai))));
  const th = atan2(ai, wr);
  const m1 = div(exp(mul(s, lnw)), -s);
  const p1 = mul(s, th);
  zr = add(zr, mul(m1, cos(p1)));
  zi = add(zi, mul(m1, sin(p1)));
  zerr = add(zerr, mul(abs(m1), add(add(4, abs(mul(s, lnw))), abs(p1))));
  const m0 = exp(mul(-sig, lnw));
  const p0 = mul(-sig, th);
  zr = add(zr, mul(mul(0.5, m0), cos(p0)));
  zi = add(zi, mul(mul(0.5, m0), sin(p0)));
  zerr = add(zerr, mul(mul(0.5, m0), add(add(4, abs(mul(sig, lnw))), abs(p0))));
  const mu1 = exp(mul(sub(-sig, 1), lnw));
  const pu1 = mul(sub(-sig, 1), th);
  let ur = mul(mul(div(sig, 2), mu1), cos(pu1));
  let ui = mul(mul(div(sig, 2), mu1), sin(pu1));
  const w2r = sub(mul(wr, wr), mul(ai, ai));
  const w2i = mul(mul(2, wr), ai);
  const w2d = add(mul(w2r, w2r), mul(w2i, w2i));
  const iw2r = div(w2r, w2d);
  const iw2i = div(-w2i, w2d);
  let prev = fr(3e38);
  for (let j = 1; j <= 8; j++) {
    const tr = mul(ur, BERNOULLI[j - 1]);
    const ti = mul(ui, BERNOULLI[j - 1]);
    const ta = add(abs(tr), abs(ti));
    if (ta >= prev) break;
    zr = add(zr, tr);
    zi = add(zi, ti);
    zerr = add(zerr, mul(ta, add(10, abs(mul(sig, lnw)))));
    prev = ta;
    const mm = 2 * j;
    const c = div(mul(sub(add(sig, mm), 1), add(sig, mm)), (mm + 1) * (mm + 2));
    const nr = mul(c, sub(mul(ur, iw2r), mul(ui, iw2i)));
    ui = mul(c, add(mul(ur, iw2i), mul(ui, iw2r)));
    ur = nr;
  }
  const n = floor(add(s, 0.5));
  const d = sub(s, n);
  const sgn = n % 2 === 0 ? 1 : -1;
  const lg1 = _gpu_lerch_lgamma(sig);
  const fm = div(
    mul(mul(sgn, sin(mul(PI, d))), exp(add(mul(s, log(mul(2, PI))), lg1))),
    PI
  );
  const fre = mul(fm, cos(mul(mul(0.5, PI), s)));
  const fim = mul(fm, sin(mul(mul(0.5, PI), s)));
  const first = sub(mul(fre, zr), mul(fim, zi));
  const firstErr = add(
    mul(abs(fm), zerr),
    mul(
      mul(abs(fm), sqrt(add(mul(zr, zr), mul(zi, zi)))),
      add(add(30, abs(lg1)), abs(mul(s, 2.7)))
    )
  );
  const iz = div(1, z);
  let li = 0;
  let lierr = 0;
  if (iz >= -0.5) {
    let wk = 1;
    let prevT = fr(3e38);
    let done = false;
    for (let k = 1; k < 200; k++) {
      wk = mul(wk, iz);
      const t = mul(wk, pow(k, -s));
      li = add(li, t);
      const size = abs(t);
      lierr = add(lierr, mul(size, add(add(2, k), abs(mul(s, log2(k))))));
      const rho = max(div(size, prevT), -iz);
      if (
        size < prevT &&
        rho < 1 &&
        div(mul(size, rho), sub(1, rho)) <= mul(fr(1e-8), abs(li))
      ) {
        done = true;
        break;
      }
      prevT = size;
    }
    if (!done) return DECLINE;
  } else {
    const inner = _gpu_lerch_negative(iz, s, 1);
    if (!inner[1]) return DECLINE;
    li = mul(iz, inner[0]);
    lierr = mul(500, abs(li));
  }
  const res = sub(first, mul(mul(sgn, cos(mul(PI, d))), li));
  const bound = mul(
    EPS,
    add(add(firstErr, mul(4, abs(first))), add(lierr, mul(2, abs(li))))
  );
  if (!(bound <= mul(TOL, abs(res)))) return DECLINE;
  return [res, true];
}

/** The model of `_gpu_poly_log(s, z)`, at the f32-rounded operands. */
export function gpuPolyLogModel(s: number, z: number): number {
  s = fr(s);
  z = fr(z);
  lastRoute = 'closed';
  if (z === 0) return 0;
  if (s === 1) {
    if (z === 1) return Infinity;
    return z < 1 ? -log(sub(1, z)) : NaN;
  }
  if (s === 0) {
    if (z === 1) return Infinity;
    return div(z, sub(1, z));
  }
  if (s === -1) {
    if (z === 1) return Infinity;
    return div(z, mul(sub(1, z), sub(1, z)));
  }
  if (s <= -2 && s >= -12 && s === floor(s) && z !== 1) {
    lastRoute = 'eulerian';
    const n = -s;
    const row: number[] = new Array(13).fill(0);
    row[0] = 1;
    for (let m = 1; m <= n; m++)
      for (let k = m - 1; k >= 1; k--)
        row[k] = add(mul(k + 1, row[k]), mul(m - k, row[k - 1]));
    if (abs(z) > 1) {
      const v = div(1, sub(1, z));
      const u = mul(z, v);
      let r = row[n - 1];
      let vp = v;
      for (let k = n - 2; k >= 0; k--) {
        r = add(mul(r, u), mul(row[k], vp));
        vp = mul(vp, v);
      }
      return mul(mul(u, v), r);
    }
    let p = 0;
    for (let k = n - 1; k >= 0; k--) p = add(mul(p, z), row[k]);
    let den = 1;
    for (let i = 0; i <= n; i++) den = mul(den, sub(1, z));
    return div(mul(z, p), den);
  }
  const r = _gpu_lerch_core(z, s, 1);
  if (r[1]) return mul(z, r[0]);
  if (z < -1 && s < 0 && s !== floor(s)) {
    const v = _gpu_poly_log_inversion(s, z);
    lastRoute = 'inversion';
    if (v[1]) return v[0];
  }
  return NaN;
}
