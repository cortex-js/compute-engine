import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { isCallerMapped } from './cse.js';

type IntegerFact = { min: number; max: number; code: string };
type CounterFact = IntegerFact & { reference: string };

// Integers in this interval survive the counter's float/f32 conversion exactly.
const EXACT_INTEGER = 2 ** 24;
const counters = new WeakMap<ReadonlySet<string>, Map<string, CounterFact>>();

function exact(min: number, max: number): boolean {
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= -EXACT_INTEGER &&
    max <= EXACT_INTEGER &&
    min <= max
  );
}

/** Facts belong to this binder's exact scope, never to a shadowing binder. */
export function recordGPUCounter(
  target: CompileTarget<Expression>,
  name: string,
  min: number,
  max: number,
  code: string
): void {
  if (!target.boundVars || !exact(min, max)) return;
  let scope = counters.get(target.boundVars);
  if (!scope) counters.set(target.boundVars, (scope = new Map()));
  const reference = target.var(name);
  if (reference !== undefined) scope.set(name, { min, max, code, reference });
}

export function clearGPUCounters(target: CompileTarget<Expression>): void {
  if (target.boundVars) counters.delete(target.boundVars);
}

/**
 * Native integer source equivalent to the shader's float arithmetic. Every
 * intermediate must stay exactly representable, including before cancellation.
 * Only compiler-owned counters and builtin arithmetic can supply a proof.
 */
export function gpuIntegerFact(
  expr: Expression,
  target: CompileTarget<Expression>,
  builtin: (operator: string) => boolean,
  depth = 0
): IntegerFact | undefined {
  if (depth > 32) return undefined;
  if (isNumber(expr))
    return expr.im === 0 && exact(expr.re, expr.re)
      ? { min: expr.re, max: expr.re, code: String(expr.re) }
      : undefined;
  if (isSymbol(expr)) {
    const fact = target.boundVars
      ? counters.get(target.boundVars)?.get(expr.symbol)
      : undefined;
    return fact && fact.reference === target.var(expr.symbol)
      ? fact
      : undefined;
  }
  if (!isFunction(expr) || isCallerMapped(expr) || !builtin(expr.operator))
    return undefined;
  if (!['Add', 'Subtract', 'Negate', 'Multiply'].includes(expr.operator))
    return undefined;
  const args = expr.ops.map((x) =>
    gpuIntegerFact(x, target, builtin, depth + 1)
  );
  if (args.some((x) => x === undefined)) return undefined;
  const values = args as IntegerFact[];
  if (expr.operator === 'Negate' && values.length === 1) {
    const v = values[0];
    return { min: -v.max, max: -v.min, code: `(-(${v.code}))` };
  }
  if (expr.operator === 'Subtract' && values.length === 2) {
    const [a, b] = values;
    const min = a.min - b.max,
      max = a.max - b.min;
    return exact(min, max)
      ? { min, max, code: `(${a.code} - ${b.code})` }
      : undefined;
  }
  if (!['Add', 'Multiply'].includes(expr.operator) || values.length === 0)
    return undefined;
  const multiply = expr.operator === 'Multiply';
  let result = values[0];
  for (const v of values.slice(1)) {
    const endpoints = multiply
      ? [
          result.min * v.min,
          result.min * v.max,
          result.max * v.min,
          result.max * v.max,
        ]
      : [result.min + v.min, result.max + v.max];
    const min = Math.min(...endpoints),
      max = Math.max(...endpoints);
    if (!exact(min, max)) return undefined;
    result = {
      min,
      max,
      code: `(${result.code} ${multiply ? '*' : '+'} ${v.code})`,
    };
  }
  return result;
}
