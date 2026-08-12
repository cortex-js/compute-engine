// complex-cartesian (constructor) = re + i * im
// complex-polar = abs * exp(i * arg)

import type {
  Expression,
  Sign,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { shouldNumericize } from '../boxed-expression/apply.js';
import { groundEnumerationOperand } from '../collection-utils.js';
import {
  type SubjectPart,
  hasAssumptions,
  signFromBounds,
} from '../boxed-expression/constraint-subject.js';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds.js';

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
      // Re follows the operand's finiteness: a finite number has a finite
      // real part, `Re(±∞) = ±∞`, and `~oo`/NaN (typed `number`) stay
      // unrepresentable by a finite claim.
      type: ([z]) => {
        if (!z) return 'number';
        const t = z.type;
        if (t.matches('finite_number')) return 'finite_real';
        if (t.matches('non_finite_number')) return 'non_finite_number';
        if (isNumber(z)) return 'number'; // NaN or ~oo literal
        // Collection operand: scalar claim for the broadcast lift — elements
        // keep the generic finite-point convention (list-broadcast-typing).
        if (t.matches('indexed_collection')) return 'finite_real';
        // A real-typed operand is its own real part (`real` excludes NaN);
        // a `number`-typed one may be NaN/~oo, which `real` cannot admit.
        return t.matches('real') ? 'real' : 'number';
      },
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
      // Im of a finite number is a finite real, and a real ±∞ has a zero
      // imaginary part; `~oo`/NaN (typed `number`) do not admit a finite claim.
      type: ([z]) => {
        if (!z) return 'number';
        const t = z.type;
        if (t.matches('finite_number') || t.matches('non_finite_number'))
          return 'finite_real';
        if (isNumber(z)) return 'number'; // NaN or ~oo literal
        if (t.matches('indexed_collection')) return 'finite_real';
        // A real-typed operand has Im = 0; a `number`-typed one may be
        // NaN/~oo, whose imaginary part is not a (finite) real.
        return t.matches('real') ? 'finite_real' : 'number';
      },
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
      // Arg of a finite number — or of a real ±∞ (0 or π) — is a finite
      // real; `Arg(~oo)`/`Arg(NaN)` (typed `number`) are NaN.
      type: ([z]) => {
        if (!z) return 'number';
        const t = z.type;
        if (t.matches('finite_number') || t.matches('non_finite_number'))
          return 'finite_real';
        if (isNumber(z)) return 'number'; // NaN or ~oo literal
        if (t.matches('indexed_collection')) return 'finite_real';
        // A real-typed operand has Arg ∈ {0, π}; a `number`-typed one may be
        // NaN/~oo, where Arg is NaN.
        return t.matches('real') ? 'finite_real' : 'number';
      },
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

    Arg: {
      description:
        '`Arg` is an alias for `Argument`, which is the preferred name. Returns the complex argument (phase angle) of a number.',
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> real',
      canonical: (ops, { engine: ce }) => ce._fn('Argument', ops),
    },

    // For Abs (magnitude) see src/compute-engine/library/processAbs

    AbsArg: {
      description: 'Tuple of magnitude and argument of a complex number.',
      keywords: ['polar form'],
      broadcastable: true,
      complexity: 1200,
      signature: '(number) -> tuple<real, real>',
      // Complete precondition: the evaluate guard (`isNumber`) on the ground
      // operand — the tuple is always built for a number literal, NaN and ±∞
      // included. A ground COLLECTION operand takes the broadcast route
      // instead, which this precondition does not model.
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        const z = groundEnumerationOperand(expr.op1);
        if (z === undefined) return undefined;
        if (z === null) return false;
        if (z.isCollection) return undefined;
        return isNumber(z);
      },
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
      signature: 'forall T: number. (T) -> T',
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
      // Complete precondition, mirroring both evaluate declines on the ground
      // operands: a non-NaN real part, and a positive integer root count. (A
      // ground collection operand broadcasts — not modelled here.)
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        const z = groundEnumerationOperand(expr.ops[0]);
        if (z === undefined) return undefined;
        if (z === null) return false;
        if (z.isCollection) return undefined;
        if (isNaN(z.re)) return false;
        const nOp = groundEnumerationOperand(expr.ops[1]);
        if (nOp === undefined) return undefined;
        if (nOp === null) return false;
        if (nOp.isCollection) return undefined;
        const n = nOp.re;
        return Number.isInteger(n) && n > 0;
      },
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
