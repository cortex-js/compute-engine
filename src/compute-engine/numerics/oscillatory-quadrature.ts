import {
  checkDeadline,
  getAmbientDeadline,
  type DeadlineFrame,
} from '../../common/interruptible.js';
import { adaptiveQuadrature, gk15 } from './gauss-kronrod.js';
import { levinU, wynnEpsilon } from './endpoint-quadrature.js';

/**
 * Quadrature for **conditionally-convergent oscillatory** semi-infinite
 * integrals — `∫ₐ^∞ f(x) dx` where `f` changes sign infinitely often
 * (`∫₀^∞ sin x/x = π/2`, `∫₀^∞ sin(x²) = √(π/8)`).
 *
 * Monte-Carlo importance sampling (the general numeric path) has unbounded
 * variance on these and returns garbage. The classic remedy (Longman's method)
 * is used here: integrate `f` over each **lobe** — the interval between two
 * consecutive zeros — with adaptive Gauss–Kronrod (`integrateLobe`), which
 * yields an alternating series `∑ Iₖ`, then accelerate its partial sums with
 * **Wynn's ε-algorithm**.
 *
 * The ε-algorithm assumes that the lobes alternate with a smooth amplitude.
 * When the lobes also have a part of one sign that decreases smoothly (the
 * lobes of `sin t·(2 + cos t)/t` are `±2/(kπ)` plus a term in `1/k²`, and the
 * lobes of `sin t·cos 3t/t` repeat a pattern of four lobes whose sum is about
 * `−c/k²`), the partial sums converge only as `1/k` to the integral, and the
 * accelerated values move slowly toward it: two of them can agree to `1e-10`
 * while they are `1e-5` from the integral. Two tests find such a series:
 * - the error of an accelerated value is the spread of the values from the
 *   last four partial sums and from the first half of the partial sums
 *   (`acceleratedEstimate`). A value that is still moving does not converge;
 * - when the ε-algorithm has not converged after `LEVIN_BLOCKS` blocks of
 *   lobes, the Levin u-transform of the sums of blocks of lobes
 *   (`blockLevin`) gives a second value. A block is one period of the
 *   pattern of the lobe widths, with an even number of lobes, so the block
 *   sums have one sign and decrease smoothly, which is the case that the
 *   Levin u-transform accelerates. When the two values do not agree, or the
 *   error of the Levin value is smaller, the Levin value is used.
 *
 * Returns `{ estimate, error }`, or `null` when the integrand is not oscillatory
 * (no sign changes — let the general path handle it), or the lobes fail to
 * shrink (a divergent integral such as `∫₀^∞ sin x`). When the lobes shrink
 * but no method finds the integral to `1e-4` relative accuracy, the adaptive
 * Gauss–Kronrod quadrature is tried, and when it does not converge the
 * result is `{ estimate: NaN, error: NaN }`: the integral has a value that
 * this routine cannot find. A caller must not then sample the integrand
 * (Monte Carlo gave `0.072 ± 0.018` for `∫₀^∞ sin t·cos(√2·t)/t dt = 0`).
 */
export function integrateSemiInfiniteOscillatory(
  f: (x: number) => number,
  a: number,
  deadline?: number | DeadlineFrame,
  options?: {
    /** The panel budget of each adaptive Gauss–Kronrod quadrature: over the
     * whole interval (tried last), over a first lobe with a singular end, and
     * over the parts of a lobe with a singular point. The default is the
     * default of `adaptiveQuadrature`. A caller with an expensive integrand (an
     * integrand that did not compile) gives a smaller budget. */
    maxIntervals?: number;
  }
): { estimate: number; error: number } | null {
  deadline ??= getAmbientDeadline();
  const MAX_LOBES = 2000;
  const TOL = 1e-12;

  // When f is not finite at the endpoint (sin x/x at 0 evaluates to 0/0 =
  // NaN), the scan for the first zero starts just inside the interval, and
  // the first lobe, from `a` to that zero, is integrated by the adaptive
  // Gauss–Kronrod quadrature, which does not evaluate f at `a` and resolves
  // a singularity there (`sin x/x^1.5` is about `x^(−½)` next to 0). Its
  // error is added to the error of the result. The first lobe was integrated
  // by adaptive Simpson from `a + 10⁻⁸`, and the sliver `[a, a + 10⁻⁸]` was
  // left out: `∫₀^∞ sin x/x dx` was `π/2 − 1e-8`, 40 times the reported
  // error, and `∫₀^∞ sin x/x^1.5 dx = √(2π)` was off by `4.0e-5`, with a
  // reported error of `1.3e-10` (Simpson's smallest panel, `π/2²⁴`, is
  // wider than the distance to the singularity). A first lobe whose integral
  // diverges or does not converge gives `null`.
  let start = a;
  const singularStart = !Number.isFinite(f(start));
  if (singularStart) {
    start = a + Math.max(1e-8, Math.abs(a) * 1e-8);
    if (!Number.isFinite(f(start))) return null;
  }
  let firstLobeError = 0;
  // The sum of the errors of the lobes after the first: the errors of all
  // the panels of `integrateLobe` (infinite when the value of a panel is not
  // finite), or the error of `splitLobe`. A result is accepted only when its
  // error plus this sum meets the tolerance, and this sum is added to the
  // reported error.
  let lobeError = 0;
  // The lobes are integrated and summed in doubles: the error of the result
  // is at least `LOBE_ROUNDOFF_ULPS` units in the last place of `magnitude`,
  // the sum of the rounding scales of the lobes (`lobeRoundingScale`).
  let magnitude = 0;
  // The tolerances are relative to the larger of the magnitude of the
  // estimate and the magnitude of the largest lobe, so that they do not
  // depend on the scale of the integrand. With `1 + |estimate|`, the
  // integral of `10⁶·sin t·cos 3t/t`, which is 0, could not meet them, and
  // the integral of `10⁻⁸·sin t/t` was found to 3e-8 relative accuracy.
  let largestLobe = 0;
  const tolerance = (relative: number, estimate: number) =>
    relative * Math.max(Math.abs(estimate), largestLobe);
  const roundoff = () => LOBE_ROUNDOFF_ULPS * Number.EPSILON * magnitude;
  const finish = (r: { estimate: number; error: number }) => ({
    estimate: r.estimate,
    error: Math.max(r.error + firstLobeError + lobeError, roundoff()),
  });
  // The error of the values of the lobes: their rounding and the errors of
  // their quadratures. An accelerated value whose spread is not larger than
  // this cannot be made more accurate by more lobes.
  const noise = () => roundoff() + lobeError + firstLobeError;

  // The adaptive quadrature over the whole interval, which is tried when
  // the lobes do not give the integral. An integrand that decreases fast
  // enough is integrated by it. Otherwise the integral has no value here,
  // and the result is `NaN`: the caller must not sample the integrand.
  // `budget` is the panel budget of each adaptive quadrature of this
  // routine: over the whole interval, over the first lobe when `f` is not
  // finite at `a`, and over each part of a lobe that `splitLobe` divides.
  const budget =
    options?.maxIntervals !== undefined
      ? { maxIntervals: options.maxIntervals }
      : {};
  const wholeInterval = () => {
    const gk = adaptiveQuadrature(f, a, Number.POSITIVE_INFINITY, {
      singularEndpoints: true,
      deadline,
      ...budget,
    });
    if (
      !gk.divergent &&
      (gk.converged || gk.extrapolated === true) &&
      Number.isFinite(gk.estimate) &&
      Number.isFinite(gk.error)
    )
      return { estimate: gk.estimate, error: gk.error };
    return { estimate: NaN, error: NaN };
  };

  const lobes: number[] = [];
  // The error of the value of each lobe: its rounding and the error of its
  // quadrature. `blockLevin` ignores a change of a block sum that is not
  // larger than the errors of its lobes.
  const lobeErrors: number[] = [];
  const widths: number[] = [];
  // The middle of each lobe, for `lobesDecaying`.
  const centers: number[] = [];
  const sums: number[] = [];
  // The block of the last Levin value that was not accepted. The Levin
  // value of the same block is not computed again: it uses only the first
  // `LEVIN_BLOCKS` blocks, so it does not change when more lobes are
  // added. A different block (the period of the widths can be found only
  // after more lobes) gives a different value, which is tried.
  let levinTriedBlock = 0;
  let cur = start;
  let prevWidth: number | undefined;
  let maxWidth = 0;
  // False after a lobe that `splitLobe` found to have a part that diverges
  // or is not finite, or after `MAX_SPLIT_FAILURES` lobes whose split did
  // not converge or did not make the error smaller: then the following
  // lobes are not split. A split costs some thousands of evaluations of
  // `f`, and an integrand that has a singularity in each lobe would
  // otherwise do this for each of the `MAX_LOBES` lobes. One failure does
  // not stop the splits: with `10¹²·sin t/(t·√|t − 50|)`, a split of a lobe
  // with no singularity did not make its error smaller, the lobe that holds
  // `t = 50` was then not split, and the result was `NaN` after 7.0M
  // evaluations of `f`.
  let splitLobes = true;
  let splitFailures = 0;

  for (let k = 0; k < MAX_LOBES; k++) {
    checkDeadline(deadline);
    const z = nextSignChange(f, cur, prevWidth, maxWidth, deadline);
    if (z === null) {
      if (lobes.length < 3) return null; // not (reliably) oscillatory
      break;
    }
    let lobe: number;
    let thisLobeError = 0;
    if (k === 0 && singularStart) {
      const r = adaptiveQuadrature(f, a, z, {
        singularEndpoints: true,
        deadline,
        ...budget,
      });
      if (
        r.divergent ||
        !(r.converged || r.extrapolated === true) ||
        !Number.isFinite(r.estimate) ||
        !Number.isFinite(r.error)
      )
        return null;
      lobe = r.estimate;
      firstLobeError = r.error;
      thisLobeError = r.error;
    } else {
      const first = integrateLobe(f, cur, z, TOL, largestLobe, deadline);
      let r: { value: number; error: number } = first;
      // A lobe that the GK15 panels did not integrate to the tolerance can
      // have an integrable singularity inside it or at one of its ends
      // (`sin t/√|t − 5|` at `t = 5`): `splitLobe` integrates it again in two
      // parts, with the singular point at an end of each part.
      if (splitLobes && first.unresolved > first.tolerance) {
        const split = splitLobe(f, cur, z, first, deadline, budget);
        if (split === 'diverges') splitLobes = false;
        else if (split === null) {
          splitFailures += 1;
          if (splitFailures >= MAX_SPLIT_FAILURES) splitLobes = false;
        } else r = split;
      }
      lobe = r.value;
      thisLobeError = r.error;
      lobeError += r.error;
      // A lobe whose value is not finite (a pole inside the lobe, as in
      // `sin t/(t − 5)²`) has an infinite error: no sum of the lobes can be
      // accepted, and more lobes are not integrated.
      if (!Number.isFinite(lobeError)) return wholeInterval();
    }
    lobes.push(lobe);
    sums.push((sums.length > 0 ? sums[sums.length - 1] : 0) + lobe);
    const rounding = lobeRoundingScale(lobe, k === 0 ? a : cur, z);
    magnitude += rounding;
    lobeErrors.push(
      LOBE_ROUNDOFF_ULPS * Number.EPSILON * rounding + thisLobeError
    );
    largestLobe = Math.max(largestLobe, Math.abs(lobe));
    widths.push(z - cur);
    centers.push(0.5 * (cur + z));
    prevWidth = z - cur;
    maxWidth = Math.max(maxWidth, prevWidth);
    cur = z;

    // Once enough lobes are in, test convergence of the accelerated partials —
    // but only accept it if the lobes are actually shrinking. Otherwise the
    // ε-algorithm happily returns the Abel/Cesàro sum of a *divergent* integral
    // (∑ lobes = 2 − 2 + 2 − … → "1" for ∫₀^∞ sin x), which we must reject.
    if (
      lobes.length >= 6 &&
      lobes.length % 2 === 0 &&
      lobesDecaying(lobes, centers)
    ) {
      const conv = acceleratedEstimate(sums);
      // When the ε value is accepted, its error is twice the spread of the
      // ε values: the spread can be smaller than the distance to the
      // integral. `∫₀^∞ sin t·cos 10t/t dt = 0` gave `-1.868e-12` with a
      // spread of `1.74e-12`.
      if (conv && conv.error + lobeError < tolerance(1e-11, conv.estimate))
        return finish({ estimate: conv.estimate, error: 2 * conv.error });
      // The spread of the ε values is not larger than the error of the
      // lobes: more lobes do not make the value more accurate. The value is
      // accepted when it meets the tolerance of the last test below
      // (`1e-4`). Without this test, a lobe whose error is larger than the
      // tolerance `1e-11` (a lobe that holds the singular point of
      // `sin t/√|t − 5| + sin t/√|t − 20|`), or the rounding of lobes far
      // from 0 (`∫ from 10⁴ of sin t/√t`), made the loop integrate all the
      // `MAX_LOBES` lobes, and the result was `NaN`. The test is made only
      // after `MIN_NOISE_LOBES` lobes: with fewer partial sums, the ε values
      // can agree by chance.
      if (
        conv &&
        lobes.length >= MIN_NOISE_LOBES &&
        conv.error <= noise() &&
        2 * conv.error + noise() <= tolerance(1e-4, conv.estimate)
      )
        return finish({ estimate: conv.estimate, error: 2 * conv.error });
      // The ε-algorithm has not converged after `LEVIN_BLOCKS` blocks. When
      // the Levin value is accurate, and it does not agree with the ε value
      // or its error is smaller, the Levin value is used: the lobes may not
      // fit the model of the ε-algorithm, and then more lobes only move its
      // value slowly (`∫₀^∞ sin t·cos 3t/t dt` was still `1.2e-5` from 0
      // after 2000 lobes).
      const block = lobeBlock(widths);
      if (
        block > 0 &&
        block !== levinTriedBlock &&
        lobes.length >= 1 + LEVIN_BLOCKS * block
      ) {
        levinTriedBlock = block;
        const lev = blockLevin(lobes, block, lobeErrors);
        if (
          lev !== null &&
          lev.error + lobeError <= tolerance(1e-6, lev.estimate) &&
          (conv === null ||
            lev.error < conv.error ||
            Math.abs(conv.estimate - lev.estimate) > conv.error + lev.error)
        )
          return finish(lev);
      }
    }
  }

  // Out of lobes/budget: accept the accelerated value only if it converged and
  // the tail is genuinely decaying (else the integral diverges → give up).
  if (lobes.length < 6) return null;
  if (!lobesDecaying(lobes, centers)) return null;
  const accurate = (r: { estimate: number; error: number } | null) =>
    r !== null &&
    Number.isFinite(r.estimate) &&
    Number.isFinite(r.error) &&
    r.error + lobeError <= tolerance(1e-4, r.estimate);
  const final = slowEstimate(sums, noise());
  const lev = blockLevin(lobes, lobeBlock(widths), lobeErrors);
  if (
    accurate(lev) &&
    (!accurate(final) ||
      lev!.error < final!.error ||
      Math.abs(final!.estimate - lev!.estimate) > final!.error + lev!.error)
  )
    return finish(lev!);
  if (accurate(final)) return finish(final!);

  // The lobes shrink, but neither the ε-algorithm nor the Levin u-transform
  // found the integral (`∫₀^∞ sin t·cos(√2·t)/t dt`, whose lobes have no
  // period).
  return wholeInterval();
}

/**
 * Find the next point > `x` at which `f` changes sign. `hint` is the previous
 * lobe width (used to size the scan); on the first lobe it is bootstrapped.
 * `maxWidth` is the width of the widest lobe so far.
 * Returns the zero (bisected), or `null` if none is found within budget.
 */
function nextSignChange(
  f: (x: number) => number,
  x: number,
  hint: number | undefined,
  maxWidth: number,
  deadline: number | DeadlineFrame | undefined
): number | null {
  // Scan in small steps relative to the local oscillation scale. Lobes can
  // shrink (sin x²) or stay constant (sin x), so scan a fraction of the hint
  // and allow up to a few widths of the widest lobe before giving up. A
  // narrow lobe can come before a wide one: the lobes of
  // `sin t·cos(√2·t)/t` have the widths 2.03, 0.19 and 2.6, and a scan of 6
  // widths of the previous lobe did not find the third zero.
  let h =
    hint !== undefined ? hint / 16 : Math.max(1e-3, Math.abs(x) * 1e-3, 0.01);
  const maxScan = hint !== undefined ? Math.max(hint, maxWidth) * 6 : Infinity;

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

/**
 * The factor by which `|f|` must increase in `bisectZero` for a bracket to be
 * taken as a pole. At a zero, `|f|` decreases. When the first bracket is
 * already at a zero, its values are rounding errors (`1e-16` for
 * `sin t/t`), and the next values are rounding errors too, which can be a
 * few times larger. At a pole `|t − c|^(−p)`, the bracket is about `10¹³`
 * times smaller at the end of the bisection, and `|f|` is about `10^(13·p)`
 * times larger: a pole with `p ≥ 0.25` is found. A pole with a smaller `p`
 * is not, but then the part of the integral that the lobe does not include
 * is small: the integral of `|t − c|^(−p)` over `10⁻¹⁴`.
 */
const POLE_GROWTH = 1e3;

/**
 * Bisect a sign-change bracket [xa, xb] (f(xa)·f(xb) < 0) to a zero.
 *
 * `f` can also change sign at a pole (`sin t/|t − π|^1.5` at `t = π`). Then
 * `|f|` increases at each step. When `|f|` at both ends of the bracket is
 * larger than `POLE_GROWTH` times its largest value at the ends of the first
 * bracket, the bisection continues until `xa` and `xb` are adjacent doubles.
 * A pole at a double, where `f` is not finite, is then found exactly, and it
 * is the end of two lobes. When the bisection stopped at `10⁻¹⁴` from the
 * pole, as it does at a zero, the lobe before the pole ended at a point `z`
 * before it, and did not include the integral from `z` to `π`, which is
 * about `2·√(π − z)`: the integral of `sin t/|t − π|^1.5` was `5.0e-8` from
 * its value, with an error of `2.6e-10`.
 */
function bisectZero(
  f: (x: number) => number,
  xa: number,
  fa: number,
  xb: number,
  fb: number,
  deadline: number | DeadlineFrame | undefined
): number {
  const initial = Math.max(Math.abs(fa), Math.abs(fb));
  for (let i = 0; i < 80; i++) {
    // Each step evaluates `f` once, which can be expensive (a nested
    // integral), so check the deadline at each step.
    checkDeadline(deadline);
    if (
      xb - xa <= 1e-14 * (1 + Math.abs(xa)) &&
      !(Math.min(Math.abs(fa), Math.abs(fb)) > POLE_GROWTH * initial)
    )
      break;
    const xm = 0.5 * (xa + xb);
    if (!(xm > xa && xm < xb)) break;
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
  return 0.5 * (xa + xb);
}

/**
 * The largest number of GK15 panels for one lobe in `integrateLobe`.
 */
const LOBE_PANELS = 256;

/**
 * A GK15 panel whose error is not larger than this number of units in the
 * last place of its value is accepted by `integrateLobe`: its error is the
 * rounding of its value, and a bisection does not make it smaller. This is
 * the rounding level of the error estimate of QUADPACK, `50·ε·∫|f|`.
 */
const PANEL_ROUNDOFF_ULPS = 50;

/**
 * Adaptive GK15 quadrature over one lobe `[a, b]`. The tolerance of the lobe
 * is relative: `rtol` times the larger of `scale` (the magnitude of the
 * largest lobe so far) and the magnitude of the GK15 value of the whole
 * lobe. A panel whose error is larger than its share of the tolerance, and
 * larger than the rounding of its value (`PANEL_ROUNDOFF_ULPS`), is
 * bisected, up to `LOBE_PANELS` panels. With an absolute tolerance, the
 * lobes of `10¹²·sin t/t` took 34,622 evaluations of `f`, and the lobes of
 * `sin t/t` 2,387.
 *
 * The `error` of the result is the sum of the errors of all the panels.
 * `unresolved` is the sum of the errors of the panels that were not
 * resolved: a panel that is larger than its share when the panel budget is
 * used up, or a panel whose value or error is not finite (its error is then
 * `+∞`). `tolerance` is the tolerance of the lobe. `worst` is the
 * unresolved panel with the largest error: the first panel whose value or
 * error is not finite, or else the panel with the largest finite error.
 *
 * A lobe is smooth, and one GK15 panel (15 evaluations) usually integrates
 * it to the precision of a double. Adaptive Simpson took about 300
 * evaluations for each lobe of `sin x/x`, and its lobes were less accurate.
 */
function integrateLobe(
  f: (x: number) => number,
  a: number,
  b: number,
  rtol: number,
  scale: number,
  deadline: number | DeadlineFrame | undefined
): {
  value: number;
  error: number;
  unresolved: number;
  tolerance: number;
  worst?: [number, number];
} {
  let panels = 0;
  let error = 0;
  let unresolved = 0;
  let worst: [number, number] | undefined;
  let worstError = 0;
  const accept = (p: { value: number; error: number }) => {
    error += p.error;
    return p.value;
  };
  const panel = (
    lo: number,
    hi: number,
    share: number,
    p: { value: number; error: number } = gk15(f, lo, hi)
  ): number => {
    panels += 1;
    if (
      p.error <= share ||
      p.error <= PANEL_ROUNDOFF_ULPS * Number.EPSILON * Math.abs(p.value)
    )
      return accept(p);
    if (!Number.isFinite(p.value) || !Number.isFinite(p.error)) {
      if (worstError !== Number.POSITIVE_INFINITY) worst = [lo, hi];
      worstError = Number.POSITIVE_INFINITY;
      unresolved = Number.POSITIVE_INFINITY;
      return accept({ value: p.value, error: Number.POSITIVE_INFINITY });
    }
    if (panels >= LOBE_PANELS) {
      if (p.error > worstError) {
        worst = [lo, hi];
        worstError = p.error;
      }
      unresolved += p.error;
      return accept(p);
    }
    if ((panels & 0xf) === 0) checkDeadline(deadline);
    const m = 0.5 * (lo + hi);
    return panel(lo, m, share / 2) + panel(m, hi, share / 2);
  };
  const whole = gk15(f, a, b);
  const tolerance =
    rtol *
    Math.max(scale, Number.isFinite(whole.value) ? Math.abs(whole.value) : 0);
  const value = panel(a, b, tolerance, whole);
  return { value, error, unresolved, tolerance, worst };
}

/**
 * Integrate again a lobe `[a, b]` that `integrateLobe` did not integrate to
 * its tolerance (the result `r`). The lobe is supposed to have one point `c`
 * where `|f|` is not bounded or `f` is not finite (`locateSingularity`). The
 * parts `[a, c]` and `[c, b]` are integrated by the adaptive Gauss–Kronrod
 * quadrature with `singularEndpoints`, which resolves an integrable
 * singularity at an end of the interval and reports a divergent one. When
 * `c` is at a few units in the last place from `a` or `b`, the whole lobe is
 * integrated in one part: a part that is narrower than some units in the
 * last place does not converge.
 *
 * The result is the sum of the values of the parts, with the sum of their
 * errors as its error. Returns `'diverges'` when a part diverges (the pole of
 * order 2 of `sin t/(t − 5)²`) or its value or error is not finite, and
 * `null` when a part does not converge or the sum of the errors is not
 * smaller than the error of `r`. In both cases the caller keeps `r`.
 * `budget` is the panel budget of the adaptive quadrature of each part.
 */
function splitLobe(
  f: (x: number) => number,
  a: number,
  b: number,
  r: { value: number; error: number; worst?: [number, number] },
  deadline: number | DeadlineFrame | undefined,
  budget: { maxIntervals?: number }
): { value: number; error: number } | 'diverges' | null {
  if (r.worst === undefined) return null;
  const c = locateSingularity(f, a, b, r.worst, deadline);
  const near = 64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
  const bounds = c - a <= near || b - c <= near ? [a, b] : [a, c, b];
  let value = 0;
  let error = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const q = adaptiveQuadrature(f, bounds[i], bounds[i + 1], {
      singularEndpoints: true,
      deadline,
      ...budget,
    });
    if (
      q.divergent ||
      !Number.isFinite(q.estimate) ||
      !Number.isFinite(q.error)
    )
      return 'diverges';
    if (!(q.converged || q.extrapolated === true)) return null;
    value += q.estimate;
    error += q.error;
  }
  return error < r.error ? { value, error } : null;
}

/**
 * The point of the lobe `[a, b]` where `f` is singular. `worst` is the panel
 * of `integrateLobe` with the largest error.
 *
 * The first point where `f` is not finite is the result: `sin t/√|t − π|`
 * is `+∞` at the double nearest to `π`, and is finite at all the other
 * points. The panel `worst` is searched first, because it has such a point
 * when its value is not finite. Otherwise the lobe is bisected again and
 * again, and the half whose GK15 error is the larger is kept: near an
 * integrable singularity, the GK15 error of a panel that contains it is much
 * larger than the error of a panel that does not. The search stops when the
 * two halves cannot be made smaller, and the result is the middle of the
 * last interval. The search does not start from `worst`, because `worst` can
 * be next to the singular point and not contain it: the error of a panel is
 * compared with its share of the tolerance, and the panels that contain the
 * singular point can be smaller and have a smaller error.
 */
function locateSingularity(
  f: (x: number) => number,
  a: number,
  b: number,
  worst: [number, number],
  deadline: number | DeadlineFrame | undefined
): number {
  let singular: number | undefined;
  const g = (x: number) => {
    const y = f(x);
    if (singular === undefined && !Number.isFinite(y)) singular = x;
    return y;
  };
  gk15(g, worst[0], worst[1]);
  let lo = a;
  let hi = b;
  while (singular === undefined) {
    checkDeadline(deadline);
    const m = 0.5 * (lo + hi);
    if (!(m > lo && m < hi)) break;
    if (gk15(g, lo, m).error >= gk15(g, m, hi).error) hi = m;
    else lo = m;
  }
  return singular ?? 0.5 * (lo + hi);
}

/**
 * The error of the result is at least this number of units in the last
 * place (`Number.EPSILON` times the value) of the sum of the magnitudes of
 * the lobes: the rounding of the lobes and of their sum. Without this floor,
 * `∫₀^∞ e^(−t/5)·cos 3t dt` gave an error of `3.5e-16`, and its true error is
 * `4.4e-16`, about 0.6 units of the sum of the magnitudes of the lobes.
 */
const LOBE_ROUNDOFF_ULPS = 4;

/**
 * The magnitude of the lobe `[x0, x1]` with value `lobe`, for the rounding
 * floor of the error: `|lobe|` times the larger of 1 and the ratio of the
 * largest abscissa to the width of the lobe. The GK15 nodes of a lobe far
 * from 0 are rounded to the spacing of the doubles at that abscissa, a
 * relative error of `ε·|x|/(x1 − x0)` of the width, and the value of the
 * lobe has a relative error of the same order, with the same sign for
 * adjacent lobes. With `|lobe|` only, `∫ from 10⁴ of sin t/t` was
 * `-0.0000952185910152 ± 3.9e-15`, 13 times its error from the integral.
 */
function lobeRoundingScale(lobe: number, x0: number, x1: number): number {
  const width = x1 - x0;
  const ratio = Math.max(Math.abs(x0), Math.abs(x1)) / width;
  return Math.abs(lobe) * (ratio > 1 ? ratio : 1);
}

/**
 * The number of lobes whose split by `splitLobe` did not converge or did not
 * make the error smaller, after which the following lobes are not split.
 */
const MAX_SPLIT_FAILURES = 3;

/**
 * The smallest number of lobes for which an ε value whose spread is not
 * larger than the error of the lobes is accepted.
 */
const MIN_NOISE_LOBES = 20;

/** The number of partial sums that the ε-algorithm uses: the last ones. The
 * table of the ε-algorithm has a size that is the square of this number. */
const WYNN_WINDOW = 50;

/**
 * The ε-algorithm value of the partial sums `s`, with its error: the spread
 * of the ε-algorithm values from the partial sums that end at the last four
 * indexes, and from the first half of the partial sums.
 *
 * With only the last two values, `∫₀^∞ sin(t/2)·cos 2t/t dt = 0` gave
 * `-0.00000000681 ± 0.00000000089`. The first half of the partial sums finds
 * a series that converges as `1/k` (see `integrateSemiInfiniteOscillatory`):
 * the values move toward the integral at each new lobe by an amount much
 * smaller than their distance to it, so values from adjacent partial sums
 * agree, but the value from half of the partial sums does not.
 */
function acceleratedEstimate(
  s: number[]
): { estimate: number; error: number } | null {
  const n = s.length;
  const wynn = (end: number) =>
    epsilonAlgorithm(s.slice(Math.max(0, end - WYNN_WINDOW), end));
  const est = wynn(n);
  if (est === null) return null;
  let lo = est;
  let hi = est;
  for (const end of [n - 1, n - 2, n - 3, Math.ceil(n / 2)]) {
    const v = wynn(end);
    if (v === null) return null;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { estimate: est, error: hi - lo };
}

/**
 * The ε-algorithm value of the partial sums `s` when it did not converge.
 * Its error is the largest of:
 * - the error of `acceleratedEstimate`, which includes the difference `d₁`
 *   of the values from `n/2` and `n` partial sums;
 * - the difference of the values from `n/4` and `n` partial sums;
 * - the distance to the limit of the values when their differences decrease
 *   as those of a power of the number of partial sums. When the error of the
 *   values is `C·n^(−q)`, the ratio `r` of `d₁` to the difference of the
 *   values from `n/4` and `n/2` partial sums is `2^(−q)`, and the error of
 *   the last value is `d₁·r/(1 − r)`.
 *
 * With `d₁` alone, `∫₀^∞ sin t·cos(√3·t)/√t dt` gave `-0.35337 ± 0.000066`,
 * `8.2e-5` from the integral: the values of the lobes of an integrand with
 * two frequencies whose ratio is not rational do not converge regularly.
 * Returns `null` when the differences do not decrease (`r ≥ 0.9`).
 *
 * When `d₁` and the difference of the values from `n/4` and `n/2` partial
 * sums are both not larger than `noise`, the error of the values of the
 * lobes, the values have converged and their differences are rounding: the
 * ratio `r` has no meaning. The error is then the larger of the error of
 * `acceleratedEstimate` and the difference of the values from `n/4` and `n`
 * partial sums. Without this test, `∫ from 10⁴ of sin t/√t` was `NaN`.
 */
function slowEstimate(
  s: number[],
  noise: number
): { estimate: number; error: number } | null {
  const r = acceleratedEstimate(s);
  if (r === null) return null;
  const n = s.length;
  const wynn = (end: number) =>
    epsilonAlgorithm(s.slice(Math.max(0, end - WYNN_WINDOW), end));
  const half = wynn(Math.ceil(n / 2));
  const quarter = wynn(Math.ceil(n / 4));
  if (half === null || quarter === null) return null;
  const d1 = Math.abs(r.estimate - half);
  const d2 = Math.abs(half - quarter);
  if (d1 === 0) return r;
  if (d1 <= noise && d2 <= noise)
    return {
      estimate: r.estimate,
      error: Math.max(r.error, Math.abs(r.estimate - quarter)),
    };
  const ratio = d1 / d2;
  if (!(ratio < 0.9)) return null;
  return {
    estimate: r.estimate,
    error: Math.max(
      r.error,
      Math.abs(r.estimate - quarter),
      (d1 * ratio) / (1 - ratio)
    ),
  };
}

/**
 * Wynn's ε-algorithm (`wynnEpsilon`). Given partial sums `s`, returns the
 * best (highest even-order) extrapolated limit. With fewer than 3 partial
 * sums, or when no even column of the table has a finite entry, the result
 * is the last partial sum. Returns `null` when that value is not finite.
 */
function epsilonAlgorithm(s: number[]): number | null {
  const n = s.length;
  if (n < 3) return n > 0 ? s[n - 1] : null;
  const best = wynnEpsilon(s) ?? s[n - 1];
  return Number.isFinite(best) ? best : null;
}

/**
 * The number of blocks of lobes after which the Levin value is compared to
 * the ε-algorithm value. The Levin values are most accurate with about 15 to
 * 30 blocks: with more blocks, the block sums are smaller and the rounding
 * of the lobes is a larger part of them.
 */
const LEVIN_BLOCKS = 30;

/** The smallest exponent `q` of the decrease `j^(−q)` of the block sums
 * for which `blockLevin` gives a value. A sum of terms in `j^(−q)` converges
 * only when `q > 1`. The margin above 1 is for the error of the estimate of
 * `q` from a small number of blocks. */
const LEVIN_MIN_BLOCK_DECAY = 1.15;

/** The number of the last lobe widths that `lobeBlock` examines to find
 * their period: 3 times the longest period that is looked for (12). */
const PERIOD_WINDOW = 36;

/**
 * The number of lobes in a block for `blockLevin`: one period of the widths
 * of the last lobes, doubled when it is odd, so that the block holds as many
 * positive as negative lobes. The lobes of `sin t·cos 3t/t` have the widths
 * `π/3, π/3, π/6, π/6` (a block of 4), and the lobes of
 * `sin(t/2)·cos 2t/t` have the widths `π/2, π/2, π/2, π/4, π/4` (a block of
 * 10). Lobes whose widths have no period up to 12 (`sin x²`,
 * `sin t·cos(√2·t)/t`) have no block, and the result is 0: the sums of
 * pairs of lobes of `(sin t + sin(√2·t))/t` do not decrease smoothly, and
 * their Levin value was `3.16124 ± 0.00034`, `0.02` from `π`.
 *
 * A period `m` is accepted only when each of the last `PERIOD_WINDOW`
 * widths is equal to the width `m` lobes after it, whatever `m` is. When
 * the number of widths that are compared grows with `m`, a short period
 * can be found in a run of equal widths: the lobes of `sin t·cos 6t` have
 * the widths `π/12`, five times `π/6`, and `π/12` again, and the last
 * `3·m` widths gave the period 1 instead of 7.
 */
function lobeBlock(widths: number[]): number {
  const n = widths.length;
  for (let m = 1; m <= 12 && n >= PERIOD_WINDOW + m; m++) {
    let periodic = true;
    for (let k = n - PERIOD_WINDOW; k < n - m && periodic; k++)
      periodic =
        Math.abs(widths[k + m] - widths[k]) <=
        1e-8 * Math.max(widths[k], widths[k + m]);
    if (periodic) return m % 2 === 0 ? m : 2 * m;
  }
  return 0;
}

/**
 * The Levin u-transform of the partial sums of the first lobe followed by
 * blocks of `block` lobes, with its error. `lobeErrors` are the errors of
 * the values of the lobes.
 *
 * The block sums have one sign and decrease smoothly in the index of the
 * block, as `1/j²` for a `1/t` envelope. The Levin u-transform accelerates
 * such a series, which the ε-algorithm does not.
 *
 * The transform is applied to a tail of blocks that fits this model: the
 * tail starts at the block after the last block that has a sign different
 * from the block before it, or is larger in magnitude, by more than the
 * errors of the lobes of the two blocks. All the blocks are examined, also
 * the blocks after the ones that the transform uses. The partial sums of the
 * tail include all the lobes before it, so a block that does not fit the
 * model is in the value: `∫₀^∞ (sin t·cos 3t/t + e^(−(t − 60)²)) dt = √π`
 * was `1.0e-8 ± 2.5e-8` when only the blocks before the first block that did
 * not fit were used, and the lobes after them were left out.
 *
 * For each number of partial sums from 12 to `LEVIN_BLOCKS` from the first
 * block of the tail (from the first lobe when the tail is all the blocks), the
 * transforms of orders 4 to 7 of the last partial sums are computed. The
 * result is the middle of the range of the four values, with the width of
 * the range as its error, for the number of blocks whose range is the
 * narrowest. Returns `null` when `block` is 0, when the tail has fewer than
 * 12 blocks, when its block sums do not decrease fast enough to have a sum,
 * or when no number of blocks can be used.
 */
function blockLevin(
  lobes: number[],
  block: number,
  lobeErrors: number[]
): { estimate: number; error: number } | null {
  if (block === 0) return null;
  const s: number[] = [lobes[0]];
  // `noise[j]` is the sum of the errors of the lobes of block `j`.
  const noise: number[] = [lobeErrors[0]];
  for (let j = 1; j + block <= lobes.length; j += block) {
    let sum = 0;
    let error = 0;
    for (let i = j; i < j + block; i++) {
      sum += lobes[i];
      error += lobeErrors[i];
    }
    s.push(s[s.length - 1] + sum);
    noise.push(error);
  }
  const blockSum = (j: number) => s[j] - s[j - 1];
  // `first` is the first block of the tail.
  let first = 1;
  for (let j = 2; j < s.length; j++) {
    const b = blockSum(j);
    const previous = blockSum(j - 1);
    const signChange =
      Math.sign(b) !== Math.sign(previous) &&
      Math.min(Math.abs(b), Math.abs(previous)) > noise[j] + noise[j - 1];
    const growth = Math.abs(b) - Math.abs(previous) > noise[j] + noise[j - 1];
    if (signChange || growth) first = j;
  }
  // The partial sums `s[0]` to `s[end − 1]` are used: up to `LEVIN_BLOCKS`
  // blocks from the first block of the tail.
  const end = Math.min(s.length, first + LEVIN_BLOCKS - 1);
  if (end - first < 11) return null;
  // The block sums must decrease fast enough for their sum to converge.
  // Block sums of one sign that decrease as `j^(−q)` with `q ≤ 1` have no
  // sum, but their Levin value can be finite: the lobes of
  // `sin t·(1 + sin t)/√t` from 1 have block sums in `j^(−½)`, and their
  // Levin value was `-0.14277 ± 0.000069`. The exponent `q` is estimated
  // from the block sums of index `j` and `2j`, for the largest `2j` that is
  // used. A block sum of a `t^(−p)` envelope decreases as `j^(−p−1)`, and the
  // estimate of `q` approaches `p + 1` from above (1.28 after 30 blocks for
  // `p = 0.25`). When the block sums do not converge, the estimate
  // approaches `q` from below (0.49 for `q = ½`, 0.89 for `q = 0.9`). When
  // the tail starts after the first block, `j` is the first block of the
  // tail when `2j` is larger than the last block. Far from 0, the block sums
  // decrease slowly in `j` (from `t = 10⁴`, by about 1% over 30 blocks, an
  // estimate of `q` of about 0.03), and no value is returned. The index is
  // not shifted to the abscissa: with the shift, the Levin value of
  // `sin t·(2 + cos t)/t` from `10⁴` was `1.8e-4` from the integral, and the
  // range of its values was only `7e-8`.
  const last = end - 1;
  const half = Math.max(first, Math.floor(last / 2));
  const decay =
    Math.log(Math.abs(blockSum(half) / blockSum(last))) / Math.log(last / half);
  if (!(decay >= LEVIN_MIN_BLOCK_DECAY)) return null;
  let best: { estimate: number; error: number } | null = null;
  for (let nb = first + 11; nb <= end; nb++) {
    let lo = Infinity;
    let hi = -Infinity;
    let defined = true;
    for (let k = 4; k <= 7 && defined; k++) {
      const v = levinU(s, nb - 1 - k, k, 1);
      if (v === undefined) defined = false;
      else {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!defined) continue;
    if (best === null || hi - lo < best.error)
      best = { estimate: 0.5 * (lo + hi), error: hi - lo };
  }
  return best;
}

/**
 * Heuristic: are the recent lobe magnitudes trending downward (convergent)?
 *
 * With at most 20 lobes, the average magnitude of the last 5 lobes is
 * compared with the average magnitude of the 5 lobes before them. With more
 * lobes, the average magnitude of the last half of the lobes is compared
 * with the average magnitude of the quarter before it. Lobes that decrease
 * as `k^(−p)` then decrease by the factor `2^(−p)`, whatever the number of
 * lobes, and a pattern of lobes (the 10 lobes of a period of
 * `sin(t/2)·cos 2t/t`) is averaged out. With only the last 10 lobes, lobes
 * that decrease slowly (as `k^(−0.2)` for `∫₀^∞ cos t/t^0.2 dt`) did not
 * decrease by 5% after 30 lobes.
 *
 * Far from 0, the lobes of a `t^(−p)` envelope decrease by less than 5%:
 * from `t = 10⁵`, the `MAX_LOBES` lobes of `sin t/√t` decrease by about 1.5%,
 * and the integral was not found. When the middles (`centers`) of the lobes
 * of the two groups are positive and increase, the factor is the larger of
 * 0.95 and `(t₁/t₂)^0.074`, where `t₁` and `t₂` are the means of the middles
 * of the lobes of the two groups. The exponent `0.074` gives 0.95 when
 * `t₂ = 2·t₁`: the lobes must decrease as fast as for an envelope `t^(−p)`
 * with `p ≥ 0.074`, as they do near 0.
 */
function lobesDecaying(lobes: number[], centers: number[]): boolean {
  const n = lobes.length;
  if (n < 6) return false;
  const avg = (values: number[], from: number, to: number, abs = true) => {
    let sum = 0;
    for (let i = from; i < to; i++)
      sum += abs ? Math.abs(values[i]) : values[i];
    return sum / (to - from);
  };
  const decaying = (from: number, middle: number, to: number) => {
    const t1 = avg(centers, from, middle, false);
    const t2 = avg(centers, middle, to, false);
    const factor =
      t1 > 0 && t2 > t1 ? Math.max(0.95, (t1 / t2) ** 0.074) : 0.95;
    return avg(lobes, middle, to) < factor * avg(lobes, from, middle);
  };
  if (n <= 20) {
    const from = Math.max(0, n - 10);
    return decaying(from, from + ((n - from) >> 1), n);
  }
  return decaying(n >> 2, n >> 1, n);
}
