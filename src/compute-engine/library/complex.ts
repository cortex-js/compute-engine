import { asFloat } from '../numerics/numeric';
import { IdTable } from '../public';

// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

export const COMPLEX_LIBRARY: IdTable[] = [
  {
    Real: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (ce.isComplex(op)) return ce.number(op.re);
          return ops[0];
        },
      },
    },
    Imaginary: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (ce.isComplex(op)) return ce.number(op.im);
          return ce._ZERO;
        },
      },
    },
    Argument: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (ce.isComplex(op)) return ce.number(op.arg());
          const f = asFloat(ops[0]);
          if (f === null) return undefined;
          if (f >= 0) return ce.number(0);
          return ce.number(Math.PI);
        },
      },
    },
    AbsArg: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Tuple'],
        evaluate: (ce, ops) => {
          const op = ops[0].numericValue;
          if (op === null) return undefined;
          if (ce.isComplex(op))
            return ce.tuple([ce.number(op.abs()), ce.number(op.arg())]);

          const f = asFloat(ops[0]);
          if (f === null) return undefined;
          return ce.tuple([
            ce.number(Math.abs(f)),
            ce.number(f >= 0 ? 0 : Math.PI),
          ]);
        },
      },
    },
    Conjugate: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const op = ops[0].numericValue;
          if (op === null || !ce.isComplex(op)) return undefined;
          return ce.number(op.conjugate());
        },
      },
    },

    ComplexRoots: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', 'Number', 'Number', 'List'],
        evaluate: (ce, ops) => {
          const x = asFloat(ops[0]);
          const n = asFloat(ops[1]);
          if (x === null || n === null || !Number.isInteger(n) || n <= 0)
            return undefined;

          const roots: [number, number][] = [];
          const [re, im] = ce.isComplex(x) ? [x.re, x.im] : [x, 0];
          const arg = Math.atan2(im, re);
          const mod = Math.sqrt(re * re + im * im);

          for (let k = 0; k < n; k++) {
            const theta = (arg + 2 * Math.PI * k) / n;
            const r = Math.pow(mod, 1 / n);
            roots.push([r * Math.cos(theta), r * Math.sin(theta)]);
          }

          return ce.box([
            'List',
            ...roots.map((r) =>
              ce.number(r[1] !== 0 ? ce.complex(r[0], r[1]) : r[0])
            ),
          ]);
        },
      },
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs
  },
];
