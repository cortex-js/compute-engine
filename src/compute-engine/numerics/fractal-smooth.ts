/**
 * The smooth escape value of `z -> z^2 + c`, where `(zx, zy)` is the first
 * iterate past the escape radius, at iteration `i` of at most `maxN`.
 *
 * The smoothing formula `n - log2(log2(|z|^2)) + 4` is continuous across
 * iteration boundaries only when |z| is much larger than |c|. The escape test
 * `|z|^2 > 4` stops too early for that: the count jumps by a median of 0.15 at
 * each boundary. So the test still decides inside or outside, and this function
 * then iterates further, for the smoothing only, until `|z|^2 > 65536`.
 *
 * The number of further iterations is bounded, because an orbit can stay above
 * the escape radius forever when `|c| > 2` (for a Julia set with `c = -6`, the
 * point `z = 3` is a fixed point). When the bound is reached, the value comes
 * from the first iterate past the escape radius. The value jumps at the edge of
 * that region, by about 10 counts: `Mandelbrot` at `c = -2.0000001` is 14.4
 * counts, and at `c = -2.0000000001` it is 3. Only a deep zoom near `c = -2` or
 * near a repelling fixed point reaches this edge.
 *
 * The GLSL form of this function is `_fractal_smooth` in
 * `compilation/gpu-preambles.ts`.
 */
export function smoothEscape(
  zx: number,
  zy: number,
  cx: number,
  cy: number,
  i: number,
  maxN: number
): number {
  const mag2 = zx * zx + zy * zy;
  let x = zx;
  let y = zy;
  let k = i;
  let m = mag2;
  for (let extra = 0; extra < 16 && m <= 65536; extra++) {
    const newX = x * x - y * y + cx;
    y = 2 * x * y + cy;
    x = newX;
    m = x * x + y * y;
    k++;
  }
  const smooth =
    m > 65536
      ? (k - Math.log2(Math.log2(m)) + 4.0) / maxN
      : (i - Math.log2(Math.log2(mag2)) + 4.0) / maxN;
  return Math.max(0, Math.min(1, smooth));
}
