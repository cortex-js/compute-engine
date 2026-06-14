import { checkDeadline, getAmbientDeadline } from '../../common/interruptible';

/**
 * Quadrature for **conditionally-convergent oscillatory** semi-infinite
 * integrals — `∫ₐ^∞ f(x) dx` where `f` changes sign infinitely often
 * (`∫₀^∞ sin x/x = π/2`, `∫₀^∞ sin(x²) = √(π/8)`).
 *
 * Monte-Carlo importance sampling (the general numeric path) has unbounded
 * variance on these and returns garbage. The classic remedy (Longman's method)
 * is used here: integrate `f` over each **lobe** — the interval between two
 * consecutive zeros — with adaptive Simpson, which yields an alternating series
 * `∑ Iₖ`, then accelerate its partial sums with **Wynn's ε-algorithm**.
 *
 * Returns `{ estimate, error }`, or `null` when the integrand is not oscillatory
 * (no sign changes — let the general path handle it), the iteration runs out of
 * budget, or the lobes fail to shrink (a divergent integral such as `∫₀^∞ sin x`).
 */
export function integrateSemiInfiniteOscillatory(
  f: (x: number) => number,
  a: number,
  deadline?: number
): { estimate: number; error: number } | null {
  deadline ??= getAmbientDeadline();
  const MAX_LOBES = 2000;
  const TOL = 1e-12;

  // Start just inside the interval if f is singular at the endpoint (sin x/x at
  // 0 evaluates to 0/0 = NaN); the skipped sliver is negligible.
  let start = a;
  if (!Number.isFinite(f(start))) {
    const eps = Math.max(1e-8, Math.abs(a) * 1e-8);
    start = a + eps;
    if (!Number.isFinite(f(start))) return null;
  }

  const lobes: number[] = [];
  let cur = start;
  let prevWidth: number | undefined;

  for (let k = 0; k < MAX_LOBES; k++) {
    checkDeadline(deadline);
    const z = nextSignChange(f, cur, prevWidth, deadline);
    if (z === null) {
      if (lobes.length < 3) return null; // not (reliably) oscillatory
      break;
    }
    lobes.push(adaptiveSimpson(f, cur, z, TOL, deadline));
    prevWidth = z - cur;
    cur = z;

    // Once enough lobes are in, test convergence of the accelerated partials —
    // but only accept it if the lobes are actually shrinking. Otherwise the
    // ε-algorithm happily returns the Abel/Cesàro sum of a *divergent* integral
    // (∑ lobes = 2 − 2 + 2 − … → "1" for ∫₀^∞ sin x), which we must reject.
    if (lobes.length >= 6 && lobes.length % 2 === 0 && lobesDecaying(lobes)) {
      const conv = acceleratedEstimate(lobes);
      if (conv && conv.error < 1e-9 * (1 + Math.abs(conv.estimate)))
        return conv;
    }
  }

  // Out of lobes/budget: accept the accelerated value only if it converged and
  // the tail is genuinely decaying (else the integral diverges → give up).
  if (lobes.length < 6) return null;
  if (!lobesDecaying(lobes)) return null;
  const final = acceleratedEstimate(lobes);
  if (!final || !Number.isFinite(final.estimate)) return null;
  if (final.error > 1e-4 * (1 + Math.abs(final.estimate))) return null;
  return final;
}

/**
 * Find the next point > `x` at which `f` changes sign. `hint` is the previous
 * lobe width (used to size the scan); on the first lobe it is bootstrapped.
 * Returns the zero (bisected), or `null` if none is found within budget.
 */
function nextSignChange(
  f: (x: number) => number,
  x: number,
  hint: number | undefined,
  deadline: number | undefined
): number | null {
  // Scan in small steps relative to the local oscillation scale. Lobes can
  // shrink (sin x²) or stay constant (sin x), so scan a fraction of the hint
  // and allow up to a few hint-widths before giving up.
  let h =
    hint !== undefined ? hint / 16 : Math.max(1e-3, Math.abs(x) * 1e-3, 0.01);
  const maxScan = hint !== undefined ? hint * 6 : Infinity;

  let px = x;
  let pf = f(px);
  // `x` is itself a lobe boundary (a zero) for every lobe after the first, and
  // `f(x)` there is a tiny residual with an unreliable sign. Establish the lobe
  // sign from the first *stepped* sample instead, so we don't immediately
  // "cross" back to `x`.
  let refSign = 0;
  let scanned = 0;
  const MAX_STEPS = 200000;

  for (let i = 0; i < MAX_STEPS; i++) {
    if ((i & 0x3ff) === 0) checkDeadline(deadline);
    const nx = px + h;
    const nf = f(nx);
    if (!Number.isFinite(nf)) return null;
    const ns = Math.sign(nf);
    if (refSign === 0)
      refSign = ns; // first non-zero sample sets the lobe sign
    else if (ns !== 0 && ns !== refSign)
      return bisectZero(f, px, pf, nx, nf, deadline);

    px = nx;
    pf = nf;
    scanned += h;
    if (scanned > maxScan) return null;
    if (hint === undefined) h *= 1.25; // bootstrap: grow until first crossing
  }
  return null;
}

/** Bisect a sign-change bracket [xa, xb] (f(xa)·f(xb) < 0) to a zero. */
function bisectZero(
  f: (x: number) => number,
  xa: number,
  fa: number,
  xb: number,
  fb: number,
  deadline: number | undefined
): number {
  for (let i = 0; i < 80; i++) {
    if (xb - xa <= 1e-14 * (1 + Math.abs(xa))) break;
    const xm = 0.5 * (xa + xb);
    const fm = f(xm);
    if (fm === 0 || !Number.isFinite(fm)) return xm;
    if (Math.sign(fm) === Math.sign(fa)) {
      xa = xm;
      fa = fm;
    } else {
      xb = xm;
      fb = fm;
    }
  }
  void deadline;
  return 0.5 * (xa + xb);
}

/** Adaptive Simpson over [a, b]. */
function adaptiveSimpson(
  f: (x: number) => number,
  a: number,
  b: number,
  tol: number,
  deadline: number | undefined
): number {
  const fa = f(a);
  const fb = f(b);
  const m = 0.5 * (a + b);
  const fm = f(m);
  const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
  return recurse(f, a, b, fa, fm, fb, whole, tol, 24, deadline);
}

function recurse(
  f: (x: number) => number,
  a: number,
  b: number,
  fa: number,
  fm: number,
  fb: number,
  whole: number,
  tol: number,
  depth: number,
  deadline: number | undefined
): number {
  const m = 0.5 * (a + b);
  const lm = 0.5 * (a + m);
  const rm = 0.5 * (m + b);
  const flm = f(lm);
  const frm = f(rm);
  const left = ((m - a) / 6) * (fa + 4 * flm + fm);
  const right = ((b - m) / 6) * (fm + 4 * frm + fb);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * tol)
    return left + right + delta / 15;
  if ((depth & 0x7) === 0) checkDeadline(deadline);
  return (
    recurse(f, a, m, fa, flm, fm, left, tol / 2, depth - 1, deadline) +
    recurse(f, m, b, fm, frm, fb, right, tol / 2, depth - 1, deadline)
  );
}

/** Partial sums of the lobe integrals, then Wynn's ε-algorithm. */
function acceleratedEstimate(
  lobes: number[]
): { estimate: number; error: number } | null {
  const s: number[] = [];
  let acc = 0;
  for (const v of lobes) {
    acc += v;
    s.push(acc);
  }
  const est = epsilonAlgorithm(s);
  if (est === null) return null;
  // Error: spread between the last two accelerated estimates.
  const estPrev = epsilonAlgorithm(s.slice(0, -1));
  const error =
    estPrev === null
      ? Math.abs(s[s.length - 1] - s[s.length - 2])
      : Math.abs(est - estPrev);
  return { estimate: est, error };
}

/**
 * Wynn's ε-algorithm. Given partial sums `s`, returns the best (highest
 * even-order) extrapolated limit, or `null` if it can't be formed.
 */
function epsilonAlgorithm(s: number[]): number | null {
  const n = s.length;
  if (n < 3) return n > 0 ? s[n - 1] : null;
  // e[j] holds column j of the current/previous rows as we sweep.
  let prev: number[] = new Array(n).fill(0); // ε_{-1} = 0
  let curr: number[] = s.slice(); // ε_0 = partial sums
  let best = curr[n - 1];
  for (let col = 1; col < n; col++) {
    const next: number[] = new Array(n - col);
    for (let i = 0; i < n - col; i++) {
      const denom = curr[i + 1] - curr[i];
      next[i] = prev[i + 1] + (denom === 0 ? 1e30 : 1 / denom);
    }
    // Even columns hold the accelerated estimates.
    if (col % 2 === 0 && next.length > 0) {
      const cand = next[next.length - 1];
      if (Number.isFinite(cand)) best = cand;
    }
    prev = curr;
    curr = next;
    if (curr.length === 0) break;
  }
  return Number.isFinite(best) ? best : null;
}

/** Heuristic: are the recent lobe magnitudes trending downward (convergent)? */
function lobesDecaying(lobes: number[]): boolean {
  const n = lobes.length;
  if (n < 6) return false;
  const tail = lobes.slice(Math.max(0, n - 10)).map(Math.abs);
  const firstHalf = tail.slice(0, tail.length >> 1);
  const secondHalf = tail.slice(tail.length >> 1);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return avg(secondHalf) < 0.95 * avg(firstHalf);
}
