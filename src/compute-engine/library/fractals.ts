import type { SymbolDefinitions } from '../global-types';

/** Smooth escape-time value for the Mandelbrot set in [0, 1]. */
function mandelbrotEscape(cx: number, cy: number, maxN: number): number {
  let zx = 0,
    zy = 0;
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

export const FRACTALS_LIBRARY: SymbolDefinitions[] = [
  {
    Mandelbrot: {
      description:
        'Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, integer) -> real',
      evaluate: ([c, maxIter], { engine: ce }) => {
        const cn = c.numericValue;
        if (cn === null || cn === undefined) return undefined;
        const cx = typeof cn === 'number' ? cn : cn.re;
        const cy = typeof cn === 'number' ? 0 : cn.im;
        const n = maxIter.re;
        if (!isFinite(cx) || !isFinite(cy) || !isFinite(n) || n <= 0)
          return undefined;
        return ce.number(mandelbrotEscape(cx, cy, Math.round(n)));
      },
    },

    Julia: {
      description:
        'Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      complexity: 1200,
      signature: '(number, number, integer) -> real',
      evaluate: ([z, c, maxIter], { engine: ce }) => {
        const zn = z.numericValue;
        const cn = c.numericValue;
        if (zn === null || zn === undefined) return undefined;
        if (cn === null || cn === undefined) return undefined;
        let zx = typeof zn === 'number' ? zn : zn.re;
        let zy = typeof zn === 'number' ? 0 : zn.im;
        const cx = typeof cn === 'number' ? cn : cn.re;
        const cy = typeof cn === 'number' ? 0 : cn.im;
        const n = maxIter.re;
        if (
          !isFinite(zx) ||
          !isFinite(zy) ||
          !isFinite(cx) ||
          !isFinite(cy) ||
          !isFinite(n) ||
          n <= 0
        )
          return undefined;
        const maxN = Math.round(n);
        for (let i = 0; i < maxN; i++) {
          const newZx = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = newZx;
          const mag2 = zx * zx + zy * zy;
          if (mag2 > 4) {
            const smooth = (i - Math.log2(Math.log2(mag2)) + 4.0) / maxN;
            return ce.number(Math.max(0, Math.min(1, smooth)));
          }
        }
        return ce.One;
      },
    },
  },
];
