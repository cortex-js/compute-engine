import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { isLibraryOperator } from '../library-shadowing.js';

/**
 * The Taylor coefficients of a special function at a point where the closed
 * form of its derivative is `0/0` and the derivative exists.
 *
 * The derivative rules of `symbolic/derivative.ts` give closed forms with a
 * removable singularity: `K′(m) = (E(m) − (1 − m)K(m))/(2m(1 − m))` and
 * `E′(m) = (E(m) − K(m))/(2m)` at `m = 0`, `Li′ₛ(z) = Liₛ₋₁(z)/z` and
 * `∂_zΦ(z, s, a) = (Φ(z, s − 1, a) − aΦ(z, s, a))/z` at `z = 0`, and
 * `W′(z) = W(z)/(z(1 + W(z)))` at `z = 0`. Substitution gives `NaN` there.
 * This table gives the coefficients at that point, from the Maclaurin series
 * of the function:
 *
 * - `EllipticK(m)`: `(π/2)·((½)ₖ/k!)²`, and `EllipticE(m)`:
 *   `−(π/2)·((½)ₖ/k!)²/(2k − 1)`, which are `(π/2)(a)ₖ(½)ₖ/(k!)²` with
 *   `a = ½` and `a = −½` (DLMF 19.5.1, 19.5.2);
 * - `PolyLog(s, z)`: `k^(−s)` for `k ≥ 1`, and 0 for `k = 0` (DLMF 25.12.10);
 * - `LerchPhi(z, s, a)`: `(k + a)^(−s)` (DLMF 25.14.1);
 * - `LambertW(z)`, principal branch: `(−k)^(k − 1)/k!` for `k ≥ 1`, and 0 for
 *   `k = 0` (DLMF 4.13.5).
 *
 * The point is 0 for every entry. The other operands must not depend on the
 * variable; the caller checks it.
 */
type RemovablePointEntry = {
  /** The index of the operand that is the variable. */
  slot: number;
  /** The numbers of operands this entry is for. */
  arity: number[];
  /** Whether the other operands are in the domain of the series. */
  admits?: (ops: ReadonlyArray<Expression>) => boolean;
  /** The coefficient of `tᵏ`, an expression of the other operands. */
  coefficient: (
    ce: ComputeEngine,
    ops: ReadonlyArray<Expression>,
    k: number
  ) => Expression;
};

/** `(½)ₖ/k! = ∏ᵢ (2i − 1)/(2i)`, as `[numerator, denominator]`. */
function halfPochhammerRatio(k: number): [bigint, bigint] {
  let num = 1n;
  let den = 1n;
  for (let i = 1n; i <= BigInt(k); i++) {
    num *= 2n * i - 1n;
    den *= 2n * i;
  }
  return [num, den];
}

function factorial(k: number): bigint {
  let r = 1n;
  for (let i = 2n; i <= BigInt(k); i++) r *= i;
  return r;
}

// A `Map`, not an object: a user function named `constructor` or `toString`
// must not find an inherited property.
const ENTRIES = new Map<string, RemovablePointEntry>(
  Object.entries({
    EllipticK: {
      slot: 0,
      arity: [1],
      coefficient: (ce, _ops, k) => {
        const [n, d] = halfPochhammerRatio(k);
        return ce.function('Multiply', [ce.number([n * n, 2n * d * d]), ce.Pi]);
      },
    },
    EllipticE: {
      slot: 0,
      arity: [1],
      coefficient: (ce, _ops, k) => {
        const [n, d] = halfPochhammerRatio(k);
        return ce.function('Multiply', [
          ce.number([-n * n, 2n * d * d * BigInt(2 * k - 1)]),
          ce.Pi,
        ]);
      },
    },
    PolyLog: {
      slot: 1,
      arity: [2],
      coefficient: (ce, ops, k) =>
        k === 0
          ? ce.Zero
          : ce.function('Power', [
              ce.number(k),
              ce.function('Negate', [ops[0]]),
            ]),
    },
    LerchPhi: {
      slot: 0,
      arity: [3],
      // Only for a proved `a > 0`: each base `k + a` is then positive, and
      // `Power` gives the principal value. At a negative `a`, `Power` takes
      // the real root of a negative base (`(−3/2)^(−1/3)` is `−∛(2/3)`)
      // where `LerchPhi` takes the principal one, and at an integer
      // `a ≤ 0` a base is 0.
      admits: (ops) => ops[2].isPositive === true,
      coefficient: (ce, ops, k) =>
        // `ce.function()`, not `.add()`: `.add()` of an exact radical and an
        // integer gives a float (`√2 + 1`).
        ce.function('Power', [
          ce.function('Add', [ops[2], ce.number(k)]),
          ce.function('Negate', [ops[1]]),
        ]),
    },
    LambertW: {
      slot: 0,
      arity: [1, 2],
      // The principal branch only: the other branches are singular at 0.
      admits: (ops) => ops.length === 1 || ops[1].isSame(0),
      coefficient: (ce, _ops, k) =>
        k === 0
          ? ce.Zero
          : ce.number([BigInt(-k) ** BigInt(k - 1), factorial(k)]),
    },
  } satisfies Record<string, RemovablePointEntry>)
);

/**
 * The index of the operand that is the variable when `expr` is a function of
 * the table, bound to the definition of the standard library
 * (`isLibraryOperator()`: a user function named `EllipticK` is another
 * function), with other operands that the entry admits, and `undefined`
 * otherwise. The caller checks that the other operands do not depend on the
 * variable.
 */
export function removablePointSlot(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const entry = ENTRIES.get(expr.operator);
  if (entry === undefined || !entry.arity.includes(expr.nops)) return undefined;
  if (!isLibraryOperator(expr)) return undefined;
  if (entry.admits && !entry.admits(expr.ops)) return undefined;
  return entry.slot;
}

/**
 * The exact Taylor coefficients `c₀ … c_W` of `expr` in its operand at
 * `removablePointSlot(expr)`, around the value `at` of that operand, when
 * `at` is the exact point of the entry, and `undefined` otherwise. The
 * operand at the slot is not read.
 */
export function removablePointCoefficients(
  expr: Expression,
  at: Expression,
  W: number
): Expression[] | undefined {
  if (!isFunction(expr) || removablePointSlot(expr) === undefined)
    return undefined;
  if (!isNumber(at) || !at.isExact || !at.isSame(0)) return undefined;
  const ce = expr.engine;
  const entry = ENTRIES.get(expr.operator)!;
  const result: Expression[] = [];
  for (let k = 0; k <= W; k++) {
    const c = entry.coefficient(ce, expr.ops, k).evaluate();
    if (!c.isValid || c.isNaN === true || c.isInfinity === true)
      return undefined;
    result.push(c);
  }
  return result;
}

/**
 * The value at `at` of the derivative of order `order` of `expr` in its
 * operand at `removablePointSlot(expr)`, when `at` is the exact point of the
 * entry: `order!·c_order`. `undefined` otherwise.
 */
export function removablePointDerivative(
  expr: Expression,
  at: Expression,
  order: number
): Expression | undefined {
  const coeffs = removablePointCoefficients(expr, at, order);
  if (coeffs === undefined) return undefined;
  const ce = expr.engine;
  return ce
    .function('Multiply', [ce.number(factorial(order)), coeffs[order]])
    .evaluate();
}
