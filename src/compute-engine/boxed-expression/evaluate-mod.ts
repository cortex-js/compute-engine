import type { ComputeEngine, Expression } from '../global-types.js';
import type { EvaluateModContext } from '../types-expression.js';

import { toBigint } from './numerics.js';
import { isFunction, isNumber } from './type-guards.js';
import { isTransitivelyPure } from './transitive-purity.js';
import { modPow } from '../numerics/primes.js';

/** Canonical residue of `x` in `[0, m)`, for `m > 0`. */
function floorMod(x: bigint, m: bigint): bigint {
  return ((x % m) + m) % m;
}

/** The value of an exact integer literal, or `undefined`. */
function exactIntegerLiteral(x: Expression): bigint | undefined {
  if (!isNumber(x) || !x.isExact || x.isInteger !== true) return undefined;
  return toBigint(x) ?? undefined;
}

/**
 * The value of `x` when it is an exact integer: a literal as it is, and
 * another pure expression through its exact evaluation. An expression that
 * is not pure is not evaluated, since a decline makes the caller evaluate it
 * again.
 */
export function exactIntegerValueOf(x: Expression): bigint | undefined {
  if (isNumber(x)) return exactIntegerLiteral(x);
  if (!isTransitivelyPure(x)) return undefined;
  return exactIntegerLiteral(x.evaluate());
}

/**
 * The residue of `x` modulo `m >= 2` through the `evaluateMod` hook of its
 * operator, or `undefined` when the operator has none or the hook declines.
 * `x` is not evaluated.
 */
export function evaluateModHook(
  x: Expression,
  m: bigint,
  engine: ComputeEngine
): bigint | undefined {
  if (!isFunction(x)) return undefined;
  const hook = x.operatorDefinition?.evaluateMod;
  if (hook === undefined) return undefined;
  const r = hook(x.ops, m, evaluateModContext(engine, m));
  return r === undefined ? undefined : floorMod(r, m);
}

/**
 * The residue of `x` modulo `m >= 2`: an exact integer literal gives its
 * residue, an operand with a hook answers through it (never evaluated), and
 * any other operand is evaluated, giving its residue when the value is an
 * exact integer.
 */
function residueOf(
  x: Expression,
  m: bigint,
  engine: ComputeEngine
): bigint | undefined {
  if (isNumber(x)) {
    const v = exactIntegerLiteral(x);
    return v === undefined ? undefined : floorMod(v, m);
  }
  if (isFunction(x) && x.operatorDefinition?.evaluateMod !== undefined)
    return evaluateModHook(x, m, engine);
  const v = exactIntegerValueOf(x);
  return v === undefined ? undefined : floorMod(v, m);
}

function evaluateModContext(
  engine: ComputeEngine,
  m: bigint
): EvaluateModContext {
  return { engine, mod: (x) => residueOf(x, m, engine) };
}

/**
 * The answer of `Mod(x, n)` or `Mod(x, n, d)` (`ops` as written, not
 * evaluated) from the `evaluateMod` hook of `x`, or `undefined` to evaluate
 * the call as usual. The modulus `n` must be an exact integer `>= 2`, and so
 * must the offset `d`.
 *
 * `Mod(x, n, d)` is `d + Mod(x - d, n)`: the difference is built without
 * evaluating `x`, so the hook of `Add` reduces it.
 */
export function modHookAnswer(
  ops: ReadonlyArray<Expression>,
  engine: ComputeEngine
): Expression | undefined {
  if (ops.length < 2 || ops.length > 3) return undefined;
  const [x, n, d] = ops;
  if (!isFunction(x) || x.operatorDefinition?.evaluateMod === undefined)
    return undefined;
  const m = exactIntegerValueOf(n);
  if (m === undefined || m < 2n) return undefined;
  if (d === undefined) {
    const r = evaluateModHook(x, m, engine);
    return r === undefined ? undefined : engine.number(r);
  }
  const offset = exactIntegerValueOf(d);
  if (offset === undefined) return undefined;
  const r = evaluateModHook(
    engine.function('Subtract', [x, engine.number(offset)]),
    m,
    engine
  );
  return r === undefined ? undefined : engine.number(r + offset);
}

/**
 * The answer of `PowerMod(a, e, m)` (operands as written, not evaluated) from
 * the `evaluateMod` hook of the base `a`: the residue of `a`, raised to the
 * exact non-negative integer `e` by square-and-multiply. `undefined` to
 * evaluate the call as usual.
 */
export function powerModHookAnswer(
  ops: ReadonlyArray<Expression>,
  engine: ComputeEngine
): Expression | undefined {
  if (ops.length !== 3) return undefined;
  const [a, e, n] = ops;
  if (!isFunction(a) || a.operatorDefinition?.evaluateMod === undefined)
    return undefined;
  const m = exactIntegerValueOf(n);
  if (m === undefined || m < 2n) return undefined;
  const exponent = exactIntegerValueOf(e);
  if (exponent === undefined || exponent < 0n) return undefined;
  const r = evaluateModHook(a, m, engine);
  return r === undefined ? undefined : engine.number(modPow(r, exponent, m));
}

//
// The hooks of the core operators
//

type ModHook = NonNullable<
  NonNullable<Expression['operatorDefinition']>['evaluateMod']
>;

/** The residues of all the operands, or `undefined` when one declines. */
function residues(
  ops: ReadonlyArray<Expression>,
  mod: EvaluateModContext['mod']
): bigint[] | undefined {
  const out: bigint[] = [];
  for (const x of ops) {
    const r = mod(x);
    if (r === undefined) return undefined;
    out.push(r);
  }
  return out;
}

export const addModHook: ModHook = (ops, m, { mod }) => {
  const rs = residues(ops, mod);
  return rs === undefined
    ? undefined
    : floorMod(
        rs.reduce((a, b) => a + b, 0n),
        m
      );
};

export const multiplyModHook: ModHook = (ops, m, { mod }) => {
  const rs = residues(ops, mod);
  return rs === undefined ? undefined : rs.reduce((a, b) => (a * b) % m, 1n);
};

export const negateModHook: ModHook = ([x], m, { mod }) => {
  if (x === undefined) return undefined;
  const r = mod(x);
  return r === undefined ? undefined : floorMod(-r, m);
};

export const subtractModHook: ModHook = (ops, m, { mod }) => {
  if (ops.length === 0) return undefined;
  const rs = residues(ops, mod);
  if (rs === undefined) return undefined;
  const [first, ...rest] = rs;
  return floorMod(
    rest.reduce((a, b) => a - b, first),
    m
  );
};

/**
 * `Power(b, e)` for an exact positive integer `e`, by square-and-multiply on
 * the residue of `b`. `e` is evaluated before `b` is read, and a negative or
 * non-integer exponent declines. So does `e = 0`: `0^0` is `NaN`, and a residue
 * of 0 does not tell a zero base from a multiple of the modulus.
 */
export const powerModHook: ModHook = ([b, e], m, { mod }) => {
  if (b === undefined || e === undefined) return undefined;
  const exponent = exactIntegerValueOf(e);
  if (exponent === undefined || exponent <= 0n) return undefined;
  const r = mod(b);
  return r === undefined ? undefined : modPow(r, exponent, m);
};
