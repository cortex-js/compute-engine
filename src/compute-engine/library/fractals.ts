import type { SymbolDefinitions, Expression } from '../global-types.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import { escapeTime } from '../numerics/fractal-smooth.js';

/** Extract finite real and imaginary parts from a boxed numeric value. */
function getComplexParts(
  op: Expression
): { cx: number; cy: number } | undefined {
  if (!isNumber(op)) return undefined;
  const cx = op.re;
  const cy = op.im;
  if (!isFinite(cx) || !isFinite(cy)) return undefined;
  return { cx, cy };
}

/** Extract a finite positive integer from a boxed numeric value. */
function getMaxIter(op: Expression): number | undefined {
  if (!isNumber(op)) return undefined;
  const v = op.re;
  if (!isFinite(v) || v <= 0) return undefined;
  return Math.round(v);
}

export const FRACTALS_LIBRARY: SymbolDefinitions[] = [
  {
    Mandelbrot: {
      description:
        'Smooth escape-time value for the Mandelbrot set. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      examples: ['Mandelbrot(0, 100)', 'Mandelbrot(1 + i, 100)'],
      complexity: 1200,
      signature: '(c: complex, maxIterations: integer) -> real',
      parameters: {
        c: {
          description:
            'The point of the complex plane, the constant of `z^2 + c`.',
          sample: '-0.5 + 0.5i',
        },
        maxIterations: {
          description:
            'The maximum number of iterations, a positive integer; a point that has not escaped by then counts as inside the set.',
          sample: '100',
        },
      },
      broadcastable: true,
      evaluate: ([c, maxIter], { engine: ce }) => {
        const cp = getComplexParts(c);
        const n = getMaxIter(maxIter);
        if (cp === undefined || n === undefined) return undefined;
        return ce.number(escapeTime(0, 0, cp.cx, cp.cy, n));
      },
    },

    Julia: {
      description:
        'Smooth escape-time value for a Julia set with parameter c. Returns 1 for points inside the set, values in [0,1) for escaping points.',
      examples: ['Julia(0, -0.4 + 0.6i, 100)', 'Julia(1, -0.4 + 0.6i, 100)'],
      complexity: 1200,
      signature: '(z: complex, c: complex, maxIterations: integer) -> real',
      parameters: {
        z: {
          description: 'The starting point of the iteration of `z^2 + c`.',
          sample: '0.5i',
        },
        c: {
          description:
            'The constant of the iteration, which selects the Julia set.',
          sample: '-0.4 + 0.6i',
        },
        maxIterations: {
          description:
            'The maximum number of iterations, a positive integer; a point that has not escaped by then counts as inside the set.',
          sample: '100',
        },
      },
      broadcastable: true,
      evaluate: ([z, c, maxIter], { engine: ce }) => {
        const zp = getComplexParts(z);
        const cp = getComplexParts(c);
        const n = getMaxIter(maxIter);
        if (zp === undefined || cp === undefined || n === undefined)
          return undefined;
        return ce.number(escapeTime(zp.cx, zp.cy, cp.cx, cp.cy, n));
      },
    },
  },
];
