// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

import type { SymbolDefinitions } from '../global-types';
import { isNumber } from '../boxed-expression/type-guards';

export const COMPLEX_LIBRARY: SymbolDefinitions[] = [
  {
    Real: {
      // @todo: could be extended to return an expression, i.e. ["Real", ["Add", "x", ["Complex", 0, 5]]] -> "x". Not for any operator, but at least for Add, Multiply, Negate, etc.
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      sgn: ([op]) => {
        const re = op.re;
        if (isNaN(re)) return undefined;
        if (re === 0) return 'zero';
        return re > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number') return ops[0];
        return ce.number(op.bignumRe ?? op.re);
      },
    },
    Imaginary: {
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      sgn: ([op]) => {
        const im = op.im;
        if (isNaN(im)) return undefined;
        if (im === 0) return 'zero';
        return im > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number') return ce.Zero;
        return ce.number(op.im);
      },
    },
    Argument: {
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number') return op >= 0 ? ce.Zero : ce.Pi;
        if (op.im === 0) return op.re >= 0 ? ce.Zero : ce.Pi;
        return ce.function('ArcTan2', [op.im, op.re]).evaluate();
      },
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs

    AbsArg: {
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> tuple<real, real>',
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        return ce.tuple(
          ce.function('Abs', ops).evaluate(),
          ce.function('Argument', ops).evaluate()
        );
      },
    },

    Conjugate: {
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> number',
      type: ([z]) => z.type,
      sgn: ([z]) => z.sgn,
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) return ops[0];
        return ce.number(ce.complex(op.re, -op.im));
      },
    },

    ComplexRoots: {
      broadcastable: true,
      complexity: 1200,
      signature: '(number, number) -> list<number>',
      evaluate: (ops, { engine: ce }) => {
        const re = ops[0].re;
        if (isNaN(re)) return undefined;
        const n = ops[1].re;
        if (!Number.isInteger(n) || n <= 0) return undefined;

        const roots: [number, number][] = [];

        const im = ops[0].im ?? 0;

        const arg = Math.atan2(im, re);
        const mod = Math.sqrt(re * re + im * im);

        for (let k = 0; k < n; k++) {
          const theta = (arg + 2 * Math.PI * k) / n;
          const r = Math.pow(mod, 1 / n);
          roots.push([r * Math.cos(theta), r * Math.sin(theta)]);
        }

        return ce.function(
          'List',
          roots.map((r) =>
            ce.number(r[1] !== 0 ? ce.complex(r[0], r[1]) : r[0])
          )
        );
      },
    },
  },
];
