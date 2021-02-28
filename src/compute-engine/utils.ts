import { ErrorSignal, Expression, Signal } from '../public';

export const MACHINE_PRECISION_BITS = 53;
export const MACHINE_PRECISION = Math.log10(
  Math.pow(2, MACHINE_PRECISION_BITS)
); // ≈ 15.95 = number of digits of precision

// Numerical tolerance is in number of digits at the end of the number that
// are ignored for sameness evaluation, 7-bit ≈ 2.10721 digits.
export const MACHINE_TOLERANCE_BITS = 7;
export const MACHINE_TOLERANCE = Math.pow(
  2,
  -(MACHINE_PRECISION_BITS - MACHINE_TOLERANCE_BITS)
);

// Positive values smaller than NUMERICAL_TOLERANCE are considered to be zero
const NUMERICAL_TOLERANCE = Math.pow(10, -10);

export function chop(x: number): number {
  return Math.abs(x) < NUMERICAL_TOLERANCE ? 0 : x;
}

/**
 * Return the nth term in expr.
 * If expr is not a "add" function, returns null.
 */
// export function nth(_expr: Expression, _vars?: string[]): Expression {
//     return null;
// }

/**
 * Return the coefficient of the expression, assuming vars are variables.
 */
export function coef(_expr: Expression, _vars: string[]): Expression | null {
  // @todo
  return null;
}

export class CortexError {
  signal: ErrorSignal;
  constructor(errorSignal: Signal) {
    this.signal = { severity: 'error', ...errorSignal } as ErrorSignal;
  }
  toString(): string {
    let result = '';
    if (this.signal.head) {
      result += this.signal.head + ': ';
    }
    result += this.signal.code;

    if (this.signal.args) {
      result += ' ';
      for (const arg of this.signal.args) {
        result += arg.toString() + ' ';
      }
    }

    return result;
  }
}
