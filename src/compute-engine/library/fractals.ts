import type { SymbolDefinitions } from '../global-types';

/** Smooth escape-time value for the Mandelbrot set (z0 = 0) in [0, 1]. */
function mandelbrotEscape(cx: number, cy: number, maxN: number): number {
  return juliaEscape(0, 0, cx, cy, maxN);
}

/** Smooth escape-time value for any z0 → z^2 + c iteration in [0, 1]. */
function juliaEscape(
  zx: number,
  zy: number,
  cx: number,
  cy: number,
  maxN: number
): number {
  for (let i = 0; i < maxN; i++) {
    const newZx = zx * zx - zy * zy + cx;
    zy = 2 * zx * zy + cy;
    zx = newZx;
    const mag2 = zx * zx + zy * zy;
    if (mag2 > 4) {
      const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / maxN;
      return Math.max(0, Math.min(1, smooth));
    }
  }
  return 1.0;
}

/** Extract real and imaginary parts from a boxed numeric value. */
function getComplexParts(
  op: any
): { cx: number; cy: number } | undefined {
  const n = op.numericValue;
  if (n === null || n === undefined) return undefined;
  const cx = typeof n === 'number' ? n : n.re;
  const cy = typeof n === 'number' ? 0 : n.im;
  if (!isFinite(cx) || !isFinite(cy)) return undefined;
  return { cx, cy };
}

/** Extract a finite positive integer from a boxed numeric value. */
function getMaxIter(op: any): number | undefined {
  const n = op.numericValue;
  if (n === null || n === undefined) return undefined;
  const v = typeof n === 'number' ? n : n.re;
  if (!isFinite(v) || v <= 0) return undefined;
  return Math.round(v);
}

export const FRACTALS_LIBRARY: SymbolDefinitions[] = [
  {
    Mandelbrot: {
      description:
        'Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, integer) -> real',
      evaluate: ([c, maxIter], { engine: ce }) => {
        const cp = getComplexParts(c);
        const n = getMaxIter(maxIter);
        if (cp === undefined || n === undefined) return undefined;
        return ce.number(mandelbrotEscape(cp.cx, cp.cy, n));
      },
    },

    Julia: {
      description:
        'Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, number, integer) -> real',
      evaluate: ([z, c, maxIter], { engine: ce }) => {
        const zp = getComplexParts(z);
        const cp = getComplexParts(c);
        const n = getMaxIter(maxIter);
        if (zp === undefined || cp === undefined || n === undefined)
          return undefined;
        return ce.number(juliaEscape(zp.cx, zp.cy, cp.cx, cp.cy, n));
      },
    },
  },
];
