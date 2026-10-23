/**
 * The sign of the integral of `f` from `lower` to `upper`, with at least one
 * infinite bound, when the integral diverges on an infinite tail: `1` for
 * `+∞`, `-1` for `−∞`, `0` when this cannot be shown.
 *
 * `f` is read at points spaced by powers of two from each finite bound, on
 * the side of the interval, and from `0` for a doubly infinite interval: at
 * distances `2⁻⁵⁰` to `2⁶⁴` in steps of a factor 4, then up to `2¹⁰¹⁶` in
 * steps of a factor 256. The points cover the whole range of doubles, which
 * is also the range that the quadrature reads through its change of variable
 * (`adaptiveQuadrature`, `gauss-kronrod.ts`). A change of sign beyond the
 * largest double (`t·(1 − t/10³⁰⁹)`) cannot be seen by a numeric method, and
 * is not seen here. The integral is infinite when:
 * - every value is a number with one sign (zeros allowed), so no part of the
 *   interval can cancel a divergence: a pole of the other sign at a finite
 *   bound shows as values of that sign next to the bound, a change of sign
 *   on the tail (`t·(1 − t/10²⁰)`) shows at the larger points, and an
 *   interior pole is decided before the quadrature (`interiorPoleVerdict`,
 *   `symbolic/interior-pole.ts`); and
 * - on some infinite tail, `|f(x)|·|x|` does not decrease over the last
 *   eight points that are not `0` (`f` decays no faster than `1/x`,
 *   `∫₁^∞ dx/x` included), or a value is infinite (an overflow, `eˣ`).
 *
 * A caller asks only after the quadrature reported a divergence or an
 * overflow. The quadrature does not report a slowly decaying convergent tail
 * (`x^(−1.01)`) as divergent, and this test would not either. An integrand
 * whose sign changes (`sin x`, `x − 1`) gives `0`, and the caller keeps the
 * answer it had. Used by `integrateRealPart` (`library/calculus.ts`) and by
 * the compiled `_SYS.integrate` (`compilation/javascript-runtime.ts`), so that
 * both give the same answer.
 */
export function divergentTailSign(
  f: (x: number) => number,
  lower: number,
  upper: number
): 1 | -1 | 0 {
  if (!(lower !== upper)) return 0;
  const orientation = lower > upper ? -1 : 1;
  const lo = Math.min(lower, upper);
  const hi = Math.max(lower, upper);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return 0;

  // The points at the distances above from `origin`, in order of distance.
  const spread = (origin: number, direction: 1 | -1): number[] => {
    const xs: number[] = [];
    for (let k = -50; k <= 64; k += 2) xs.push(origin + direction * 2 ** k);
    for (let k = 72; k <= 1016; k += 8) xs.push(origin + direction * 2 ** k);
    return xs;
  };

  // Every point read for the sign, and the points of each infinite tail.
  const points: number[] = [];
  const tails: number[][] = [];
  if (Number.isFinite(lo)) {
    const xs = spread(lo, 1);
    points.push(...xs);
    tails.push(xs.filter((x) => x - lo >= 1));
  } else if (Number.isFinite(hi)) {
    const xs = spread(hi, -1);
    points.push(...xs);
    tails.push(xs.filter((x) => hi - x >= 1));
  } else {
    const right = spread(0, 1);
    const left = spread(0, -1);
    points.push(0, ...right, ...left);
    tails.push(
      right.filter((x) => x >= 1),
      left.filter((x) => x <= -1)
    );
  }

  const values = new Map<number, number>();
  let positive = false;
  let negative = false;
  for (const x of points) {
    const v = f(x);
    if (Number.isNaN(v)) return 0;
    values.set(x, v);
    if (v > 0) positive = true;
    else if (v < 0) negative = true;
  }
  if (positive === negative) return 0;

  const diverges = tails.some((xs) => {
    const weighted = xs
      .map((x) => Math.abs(values.get(x)!) * Math.abs(x))
      .filter((g) => g > 0);
    if (weighted.some((g) => g === Infinity)) return true;
    const last = weighted.slice(-8);
    if (last.length < 8) return false;
    for (let i = 1; i < last.length; i++)
      if (last[i] < last[i - 1] * (1 - 1e-6)) return false;
    return true;
  });
  if (!diverges) return 0;
  return positive ? orientation : orientation === 1 ? -1 : 1;
}

/** The points of the infinite tails of the interval from `lower` to `upper`,
 * at distances `1` to `2¹⁰¹⁶` from the finite bound (or from `0`), in steps of
 * a factor 256. Empty when both bounds are finite. */
function tailPoints(lower: number, upper: number): number[] {
  const lo = Math.min(lower, upper);
  const hi = Math.max(lower, upper);
  const far: number[] = [];
  for (let k = 0; k <= 1016; k += 8) far.push(2 ** k);
  const points: number[] = [];
  if (hi === Infinity)
    for (const d of far) points.push((Number.isFinite(lo) ? lo : 0) + d);
  if (lo === -Infinity)
    for (const d of far) points.push((Number.isFinite(hi) ? hi : 0) - d);
  return points;
}

/**
 * Whether `f` is a finite number at every point of the infinite tails of the
 * interval from `lower` to `upper` (the points of `tailReachesInfinity`).
 * When the quadrature of such an integrand is not a number, the overflow is
 * in the size of the integral or of its change of variable, not in the
 * integrand (`∫₀^∞ x¹⁷⁰·e⁻ˣ dx = 170! ≈ 7·10³⁰⁶`, next to the largest double),
 * and Monte Carlo cannot give the value either. `false` when both bounds are
 * finite.
 */
export function tailIsFinite(
  f: (x: number) => number,
  lower: number,
  upper: number
): boolean {
  const points = tailPoints(lower, upper);
  return points.length > 0 && points.every((x) => Number.isFinite(f(x)));
}

/**
 * Whether `f` is `+∞` or `−∞` at some point of an infinite tail of the
 * interval from `lower` to `upper` (the points of {@link divergentTailSign}).
 * An integrand that reaches an infinite value on the tail grows past the
 * largest double (`eˣ − 5`), so its quadrature overflow is a divergence, even
 * when its sign is not known. An integrand that is only `NaN` there (an
 * `∞/∞` such as `sinh x / cosh² x`, whose integral is `1`) gives `false`:
 * its overflow is a rounding of a convergent integrand. An interval with two
 * finite bounds has no tail, and gives `false`.
 */
export function tailReachesInfinity(
  f: (x: number) => number,
  lower: number,
  upper: number
): boolean {
  return tailPoints(lower, upper).some((x) => {
    const v = f(x);
    return v === Infinity || v === -Infinity;
  });
}
