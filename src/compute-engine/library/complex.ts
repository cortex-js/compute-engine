import { IdentifierDefinitions } from '../public';

// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

export const COMPLEX_LIBRARY: IdentifierDefinitions[] = [
  {
    Real: {
      // @todo: could be extended to return an expression, i.e. ["Real", ["Add", "x", ["Complex", 0, 5]]] -> "x". Not for any operator, but at least for Add, Multiply, Negate, etc.
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: ([op]) => {
          const re = op.re;
          if (re === undefined) return undefined;
          if (re === 0) return 0;
          return re > 0 ? 1 : -1;
        },
        evaluate: (ops, { engine: ce }) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (typeof op === 'number') return ops[0];
          return ce.number(op.bignumRe ?? op.re);
        },
      },
    },
    Imaginary: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        sgn: ([op]) => {
          const re = op.im;
          if (re === undefined) return undefined;
          if (re === 0) return 0;
          return re > 0 ? 1 : -1;
        },
        evaluate: (ops, { engine: ce }) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (typeof op === 'number') return ce.Zero;
          return ce.number(op.im);
        },
      },
    },
    Argument: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ops, { engine: ce }) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (typeof op === 'number') return op >= 0 ? ce.Zero : ce.Pi;
          if (op.im === 0) return op.re >= 0 ? ce.Zero : ce.Pi;
          return ce.function('ArcTan2', [op.im, op.re]).evaluate();
        },
      },
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs

    AbsArg: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Tuples'],
        evaluate: (ops, { engine: ce }) => {
          if (ops[0].numericValue === null) return undefined;
          return ce.tuple(
            ce.function('Abs', ops).evaluate(),
            ce.function('Argument', ops).evaluate()
          );
        },
      },
    },

    Conjugate: {
      threadable: true,
      complexity: 1200,
      signature: {
        sgn: ([z]) => z.sgn,
        domain: ['FunctionOf', 'Numbers', 'Numbers'],
        evaluate: (ops, { engine: ce }) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (typeof op === 'number' || op.im === 0) return ops[0];
          return ce.number(ce.complex(op.re, -op.im));
        },
      },
    },

    ComplexRoots: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['FunctionOf', 'Numbers', 'Numbers', 'Lists'],
        evaluate: (ops, { engine: ce }) => {
          const re = ops[0].re;
          if (re === undefined) return undefined;
          const n = ops[1].re;
          if (n === undefined || !Number.isInteger(n) || n <= 0)
            return undefined;

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
  },
];
