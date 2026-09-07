import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { isCallerMapped } from './cse.js';
import { isSubtype } from '../../common/type/subtype.js';

type IntegerRange = { min: number; max: number };

// Each binder creates a new bound-variable set, even when it shadows the same
// name. Facts apply only in that exact scope; nested binders must prove their
// own ranges instead of accidentally inheriting a shadowed counter's bounds.
const loopRanges = new WeakMap<
  ReadonlySet<string>,
  Map<string, IntegerRange>
>();

export function clearIntegerRanges(target: CompileTarget<Expression>): void {
  if (target.boundVars) loopRanges.delete(target.boundVars);
}

export function recordIntegerRange(
  target: CompileTarget<Expression>,
  name: string,
  min: number,
  max: number
): void {
  if (
    !target.boundVars ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > max
  )
    return;
  let ranges = loopRanges.get(target.boundVars);
  if (!ranges) loopRanges.set(target.boundVars, (ranges = new Map()));
  ranges.set(name, { min, max });
}

function builtin(expr: Expression, target: CompileTarget<Expression>): boolean {
  const options = target.cse?.harvestOptions;
  return (
    options !== undefined &&
    isFunction(expr) &&
    !isCallerMapped(expr, { ...options, shadowedNames: target.boundVars })
  );
}

/** Bounds on the actual safe integers produced by a small arithmetic expression. */
function integerRange(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): IntegerRange | undefined {
  if (depth > 32) return undefined;
  if (isNumber(expr))
    return expr.im === 0 && Number.isSafeInteger(expr.re)
      ? { min: expr.re, max: expr.re }
      : undefined;
  if (isSymbol(expr))
    return target.boundVars
      ? loopRanges.get(target.boundVars)?.get(expr.symbol)
      : undefined;
  if (!isFunction(expr) || !builtin(expr, target)) return undefined;
  if (!['Add', 'Subtract', 'Negate', 'Multiply'].includes(expr.operator))
    return undefined;
  const args = expr.ops.map((x) => integerRange(x, target, depth + 1));
  if (args.some((x) => x === undefined)) return undefined;
  const ranges = args as IntegerRange[];
  let result: IntegerRange;
  if (expr.operator === 'Negate' && ranges.length === 1)
    result = { min: -ranges[0].max, max: -ranges[0].min };
  else if (expr.operator === 'Subtract' && ranges.length === 2)
    result = {
      min: ranges[0].min - ranges[1].max,
      max: ranges[0].max - ranges[1].min,
    };
  else if (expr.operator === 'Add' || expr.operator === 'Multiply') {
    const multiply = expr.operator === 'Multiply';
    result = { min: multiply ? 1 : 0, max: multiply ? 1 : 0 };
    for (const r of ranges) {
      if (multiply) {
        const products = [
          result.min * r.min,
          result.min * r.max,
          result.max * r.min,
          result.max * r.max,
        ];
        result = { min: Math.min(...products), max: Math.max(...products) };
      } else result = { min: result.min + r.min, max: result.max + r.max };
      if (
        !Number.isSafeInteger(result.min) ||
        !Number.isSafeInteger(result.max)
      )
        return undefined;
    }
  } else return undefined;
  return Number.isSafeInteger(result.min) && Number.isSafeInteger(result.max)
    ? result
    : undefined;
}

/** A compiler-owned array whose cells cannot be nullish or externally supplied. */
function numericArray(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 32) return false;
  if (isSymbol(expr)) {
    if (target.boundVars?.has(expr.symbol) || target.varsKeys?.has(expr.symbol))
      return false;
    const value = expr.engine._getSymbolValue(expr.symbol);
    return value !== undefined && numericArray(value, target, depth + 1);
  }
  return (
    isFunction(expr, 'List') &&
    builtin(expr, target) &&
    expr.ops.every((x) => isNumber(x) && x.im === 0)
  );
}

export function canIndexArrayDirectly(
  coll: Expression,
  index: Expression,
  target: CompileTarget<Expression>
): boolean {
  const range = integerRange(index, target);
  return range !== undefined && range.min > 0 && numericArray(coll, target);
}

/** A scalar constructed from numeric literals, compiler-owned counters and
 * scalar arithmetic, or an explicitly declared scalar runtime input. Inferred
 * types remain eligible for runtime broadcasting. */
export function isConstructedScalar(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 32) return false;
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) {
    if (integerRange(expr, target) !== undefined) return true;
    // A caller's explicit declaration is the input contract. A type inferred
    // from use in a scalar parameter is not such a promise. Local binders and
    // caller mappings have their own representations and do not inherit it.
    return (
      !target.boundVars?.has(expr.symbol) &&
      !target.varsKeys?.has(expr.symbol) &&
      expr.valueDefinition?.inferredType === false &&
      expr.engine._getSymbolValue(expr.symbol) === undefined &&
      ['number', 'boolean', 'string'].some((t) =>
        isSubtype(expr.type.type, t as 'number' | 'boolean' | 'string')
      )
    );
  }
  return (
    isFunction(expr) &&
    builtin(expr, target) &&
    [
      'Add',
      'Subtract',
      'Negate',
      'Multiply',
      'Divide',
      'Power',
      'Square',
      'Sin',
      'Cos',
      'Tan',
      'Exp',
      'Ln',
      'Sqrt',
      'Abs',
      'Floor',
      'Ceil',
      'Round',
      'Sign',
      'Min',
      'Max',
    ].includes(expr.operator) &&
    expr.ops.every((arg) => isConstructedScalar(arg, target, depth + 1))
  );
}
