/**
 * Residue classes: the elements of ℤ/nℤ, `ResidueClass(k, n)`.
 *
 * A class is held as a pair of integers `k` in [0, n) and `n ≥ 1`, in
 * `bigint`, so a modulus past 2^53 stays exact. Every function here works on
 * that pair; the arithmetic handlers of `Add`, `Multiply`, `Divide`, `Power`
 * and `Negate` call the `residue*` functions on their evaluated operands.
 *
 * Two classes with different moduli meet in ℤ/gcd(m, n), the largest ring
 * that both reduce onto: `ResidueClass(2, 4) + ResidueClass(1, 6)` is
 * `ResidueClass(1, 2)`. An integer, or a rational whose denominator is a unit,
 * is read in the ring that the classes meet in.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
} from '../global-types.js';
import { asBigint, asRational } from './numerics.js';
import { isFunction, isNumber } from './type-guards.js';
import { gcd, modularInverse } from '../numerics/numeric-bigint.js';
import { modPow } from '../numerics/primes.js';

/** A class `k + nℤ`, with `0 ≤ k < n`. */
export interface Residue {
  readonly k: bigint;
  readonly n: bigint;
}

const mod = (a: bigint, n: bigint): bigint => ((a % n) + n) % n;

/** The class of the rational `num/den` in ℤ/nℤ, if `den` is a unit mod `n`. */
export function residueOfRational(
  num: bigint,
  den: bigint,
  n: bigint
): Residue | undefined {
  if (n < 1n) return undefined;
  if (den === 1n) return { k: mod(num, n), n };
  const inverse = modularInverse(den, n);
  return inverse === null ? undefined : { k: mod(num * inverse, n), n };
}

/**
 * The class of an integer or rational literal in ℤ/nℤ. `undefined` for
 * anything else, a non-unit denominator included (`1/2` mod 4).
 */
export function residueOfLiteral(
  expr: Expression,
  n: bigint
): Residue | undefined {
  const integer = asBigint(expr);
  if (integer !== null) return { k: mod(integer, n), n };
  if (!isNumber(expr)) return undefined;
  const q = asRational(expr);
  if (q === undefined) return undefined;
  return residueOfRational(BigInt(q[0]), BigInt(q[1]), n);
}

/** `ResidueClass(k, n)` with literal integer operands, read as a pair. */
export function residueOf(expr: Expression | undefined): Residue | undefined {
  if (!isFunction(expr, 'ResidueClass') || expr.nops !== 2) return undefined;
  const k = asBigint(expr.op1);
  const n = asBigint(expr.op2);
  if (k === null || n === null || n < 1n || k < 0n || k >= n) return undefined;
  return { k, n };
}

export function isResidueClass(expr: Expression | undefined): boolean {
  return residueOf(expr) !== undefined;
}

/** An operand that is a `ResidueClass(…)` call, as a type handler sees it. */
export function isResidueClassOperand(d: OperandDescriptor): boolean {
  const s = d.structureOf?.();
  return s?.kind === 'application' && s.head === 'ResidueClass';
}

export function residueExpression(ce: ComputeEngine, x: Residue): Expression {
  return ce._fn('ResidueClass', [ce.number(x.k), ce.number(x.n)]);
}

/**
 * `ResidueClass(k, n)` in canonical form: `k` reduced into [0, n). `undefined`
 * when `n` is not an integer literal ≥ 1, or `k` is not an integer or a
 * rational literal that is a unit mod `n`: the call stays as it is.
 */
export function residueClassOf(
  ce: ComputeEngine,
  k: Expression,
  n: Expression
): Expression | undefined {
  const modulus = asBigint(n);
  if (modulus === null || modulus < 1n) return undefined;
  const r = residueOfLiteral(k, modulus);
  return r === undefined ? undefined : residueExpression(ce, r);
}

//
// Arithmetic on pairs
//

/** The same class read in ℤ/mℤ, for `m` dividing its modulus. */
const reduce = (x: Residue, m: bigint): Residue => ({ k: mod(x.k, m), n: m });

const meet = (x: Residue, y: Residue): [Residue, Residue] => {
  const m = gcd(x.n, y.n);
  return [reduce(x, m), reduce(y, m)];
};

const add = (x: Residue, y: Residue): Residue => {
  const [a, b] = meet(x, y);
  return { k: mod(a.k + b.k, a.n), n: a.n };
};

const multiply = (x: Residue, y: Residue): Residue => {
  const [a, b] = meet(x, y);
  return { k: mod(a.k * b.k, a.n), n: a.n };
};

const negate = (x: Residue): Residue => ({ k: mod(-x.k, x.n), n: x.n });

/** x⁻¹, or `undefined` when gcd(k, n) ≠ 1. */
const inverse = (x: Residue): Residue | undefined => {
  const k = modularInverse(x.k, x.n);
  return k === null ? undefined : { k, n: x.n };
};

/** xᵉ; a negative exponent inverts first, so it needs a unit. */
const power = (x: Residue, e: bigint): Residue | undefined => {
  const base = e < 0n ? inverse(x) : x;
  if (base === undefined) return undefined;
  return { k: modPow(base.k, e < 0n ? -e : e, x.n), n: x.n };
};

//
// Operands
//

/**
 * Every operand as a class of the ring that the classes among them meet in.
 * `undefined` when an operand is neither a class nor an integer or rational
 * literal that reads in that ring (a symbol, a float, `1/2` mod 4).
 */
function lift(ops: ReadonlyArray<Expression>): Residue[] | undefined {
  const classes = ops.map(residueOf).filter((x) => x !== undefined);
  if (classes.length === 0) return undefined;
  const ring = classes.map((x) => x.n).reduce(gcd);
  const values = ops.map((op) =>
    isResidueClass(op) ? residueOf(op) : residueOfLiteral(op, ring)
  );
  return values.every((x) => x !== undefined) ? values : undefined;
}

function fold(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  step: (x: Residue, y: Residue) => Residue | undefined
): Expression | undefined {
  const values = lift(ops);
  if (values === undefined) return undefined;
  let acc: Residue | undefined = values[0];
  for (const next of values.slice(1))
    acc = acc === undefined ? undefined : step(acc, next);
  return acc === undefined ? undefined : residueExpression(ce, acc);
}

/** The sum of operands one of which is a class, or `undefined`. */
export function residueAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return fold(ce, ops, add);
}

export function residueMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  return fold(ce, ops, multiply);
}

export function residueNegate(
  ce: ComputeEngine,
  x: Expression
): Expression | undefined {
  const r = residueOf(x);
  return r === undefined ? undefined : residueExpression(ce, negate(r));
}

/** `num / den`: `undefined` when `den` is not a unit of the common ring. */
export function residueDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  return fold(ce, [num, den], (x, y) => {
    const [a, b] = meet(x, y);
    const b1 = inverse(b);
    return b1 === undefined ? undefined : multiply(a, b1);
  });
}

/** `x ^ e` for an integer exponent: `undefined` for a negative one on a non-unit. */
export function residuePower(
  ce: ComputeEngine,
  x: Expression,
  e: Expression
): Expression | undefined {
  const r = residueOf(x);
  const exponent = asBigint(e);
  if (r === undefined || exponent === null) return undefined;
  const p = power(r, exponent);
  return p === undefined ? undefined : residueExpression(ce, p);
}
