// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

import type {
  Expression,
  Sign,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isNumber, isSymbol } from '../boxed-expression/type-guards';
import { shouldNumericize } from '../boxed-expression/apply';
import {
  type SubjectPart,
  hasAssumptions,
  signFromBounds,
} from '../boxed-expression/constraint-subject';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds';

/**
 * Assumption-based sign fallback for the part extractors
 * (`Real`, `Imaginary`, `Argument` — and `Abs` in the arithmetic library):
 * when the operand is a symbol with no value, look up assumed bounds for the
 * corresponding subject (e.g. `im:tau` after `assume(Im(tau) > 0)`) and
 * derive the sign from them (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1b).
 *
 * Reads the fact index directly (never `ask()`), so it works inside
 * `verify()`. Returns `undefined` when the facts don't entail a sign.
 */
export function signFromAssumedPart(
  ce: ComputeEngine,
  op: Expression,
  part: SubjectPart
): Sign | undefined {
  if (!isSymbol(op) || op.value !== undefined) return undefined;
  // Fast gate: engines with no assumptions do no index work.
  if (!hasAssumptions(ce)) return undefined;
  return signFromBounds(
    getInequalityBoundsFromAssumptions(ce, { symbol: op.symbol, part })
  );
}

export const COMPLEX_LIBRARY: SymbolDefinitions[] = [
  {
    Real: {
      description: 'Real part of a complex number.',
      // @todo: could be extended to return an expression, i.e. ["Real", ["Add", "x", ["Complex", 0, 5]]] -> "x". Not for any operator, but at least for Add, Multiply, Negate, etc.
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      sgn: ([op], { engine: ce }) => {
        const re = op.re;
        // Symbol with no value: fall back to assumed bounds on `re:op`
        // (design §5.1b)
        if (isNaN(re)) return signFromAssumedPart(ce, op, 're');
        if (re === 0) return 'zero';
        return re > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        // A real value is its own real part: return the operand unchanged so an
        // exact real (`1/2`, `√2`) stays exact instead of being rounded to a
        // float. Only a genuinely complex value extracts a (machine) real part.
        if (typeof op === 'number' || op.im === 0) return ops[0];
        return ce.number(op.bignumRe ?? op.re);
      },
    },
    Imaginary: {
      description: 'Imaginary part of a complex number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      sgn: ([op], { engine: ce }) => {
        const im = op.im;
        // Symbol with no value: fall back to assumed bounds on `im:op`
        // (design §5.1b)
        if (isNaN(im)) return signFromAssumedPart(ce, op, 'im');
        if (im === 0) return 'zero';
        return im > 0 ? 'positive' : 'negative';
      },
      evaluate: (ops, { engine: ce }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) return ce.Zero;
        return ce.number(op.im);
      },
    },
    Argument: {
      description: 'Complex argument (phase angle) of a number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      type: () => 'finite_real',
      // Sign from assumed bounds on `arg:op` (design §5.1b); values are
      // handled by `evaluate`
      sgn: ([op], { engine: ce }) => signFromAssumedPart(ce, op, 'arg'),
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (!isNumber(ops[0])) return undefined;
        const op = ops[0].numericValue;
        if (typeof op === 'number' || op.im === 0) {
          const isNonNegative = typeof op === 'number' ? op >= 0 : op.re >= 0;
          const result = isNonNegative ? ce.Zero : ce.Pi;
          // D2: an inexact (float) argument numericizes even under plain
          // evaluate() — `Argument(-5.1)` → 3.14159… (not the symbolic `Pi`).
          return shouldNumericize(numericApproximation, ops[0])
            ? result.N()
            : result;
        }
        return ce
          .function('Arctan2', [op.im, op.re])
          .evaluate({ numericApproximation });
      },
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs

    AbsArg: {
      description: 'Tuple of magnitude and argument of a complex number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> tuple<real, real>',
      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (!isNumber(ops[0])) return undefined;
        return ce.tuple(
          ce.function('Abs', ops).evaluate({ numericApproximation }),
          ce.function('Argument', ops).evaluate({ numericApproximation })
        );
      },
    },

    Conjugate: {
      description: 'Complex conjugate of a number.',
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
      description: 'All n-th complex roots of a number.',
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
