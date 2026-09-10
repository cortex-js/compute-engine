import type {
  Expression,
  IComputeEngine,
  OperandDescriptor,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import { isSubtype } from '../../common/type/subtype.js';
import { factsOf } from '../../common/type/facts.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { describe, describeType } from './operand-descriptor.js';
import {
  functionLiteralParameterName,
  isRestParameter,
  isDestructuringParameter,
} from './function-literal.js';
import { isFunction, isSymbol } from './type-guards.js';

const cache = new WeakMap<
  IComputeEngine,
  {
    generation: number;
    literals: WeakMap<Expression, Map<string, Type | undefined>>;
  }
>();
const active = new WeakMap<IComputeEngine, Set<Expression>>();

function userFunctionLiteral(engine: IComputeEngine, head: string) {
  const binding = engine.lookupDefinition(head);
  const literal =
    binding &&
    ('operator' in binding
      ? (binding.operator as { _lambdaLiteral?: Expression })._lambdaLiteral
      : binding.value.value);
  return literal && isFunction(literal, 'Function') ? literal : undefined;
}

/** Lists may bind elementwise; only known atomic arguments can bind whole. */
function mayBroadcast(type: Type): boolean {
  const t = resolveTypeAlias(type);
  if (
    isSubtype(t, 'string') ||
    (typeof t === 'object' &&
      t.kind === 'tuple' &&
      t.elements.every((x) => isSubtype(x.type, 'number')))
  )
    return false;
  return factsOf(t).collection !== false;
}

/** Derive a call's result from its body without changing the callable contract.
 * Parameters and straight-line locals carry descriptors, never runtime values.
 * Unsupported control flow and recursive calls keep the declared result. */
export function callResultType(
  engine: IComputeEngine,
  head: string,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  // Scalar declarations already describe their result's representation. This
  // analysis refines collection alternatives, not numeric domains.
  if (
    ['number', 'boolean', 'string'].some((t) =>
      isSubtype(declared, t as 'number' | 'boolean' | 'string')
    ) ||
    declared === 'never'
  )
    return undefined;
  const literal = userFunctionLiteral(engine, head);
  if (!literal || args.some((x) => mayBroadcast(x.type))) return undefined;
  const params = literal.ops.slice(1);
  if (
    params.length !== args.length ||
    params.some((p) => isRestParameter(p) || isDestructuringParameter(p))
  )
    return undefined;
  const running = active.get(engine) ?? new Set<Expression>();
  if (running.has(literal)) return undefined;
  active.set(engine, running);
  let env = new Map<string, OperandDescriptor>();
  for (let i = 0; i < params.length; i++) {
    const name = functionLiteralParameterName(params[i]);
    if (!name) return undefined;
    const t = args[i].type;
    // Unknown arguments may be collections at runtime. Do not infer a scalar
    // result by treating an unknown parameter as a numeric operand.
    if (
      t === 'unknown' ||
      t === 'any' ||
      t === 'value' ||
      (typeof t === 'object' &&
        (t.kind === 'broadcastable' || t.kind === 'union'))
    )
      return undefined;
    env.set(name, describeType(t));
  }
  const generation = engine._cacheGeneration();
  let stored = cache.get(engine);
  if (!stored || stored.generation !== generation) {
    stored = { generation, literals: new WeakMap() };
    cache.set(engine, stored);
  }
  let results = stored.literals.get(literal);
  if (!results) {
    results = new Map();
    stored.literals.set(literal, results);
  }
  const key = [declared, ...args.map((x) => x.type)]
    .map((t) => typeToString(t))
    .join(';');
  if (results.has(key)) return results.get(key);
  running.add(literal);
  try {
    const memo = new Map<Expression, OperandDescriptor | undefined>();
    let blockDepth = 0;
    const walk = (expr: Expression): OperandDescriptor | undefined => {
      if (isSymbol(expr)) return env.get(expr.symbol) ?? describe(expr);
      if (!isFunction(expr)) return describe(expr);
      if (expr.operator === 'Block') {
        const saved = env;
        env = new Map(env);
        const locals = new Set<string>();
        blockDepth++;
        try {
          let result: OperandDescriptor | undefined;
          for (const op of expr.ops) {
            if (isFunction(op, 'Declare') && isSymbol(op.op1)) {
              locals.add(op.op1.symbol);
              env.set(op.op1.symbol, describeType('unknown'));
              continue;
            }
            if (isFunction(op, 'Assign') && isSymbol(op.op1)) {
              if (
                !env.has(op.op1.symbol) ||
                (blockDepth > 1 && !locals.has(op.op1.symbol))
              )
                return undefined;
              result = walk(op.op2);
              if (!result) return undefined;
              env.set(op.op1.symbol, result);
              memo.clear();
              continue;
            }
            if (isFunction(op, 'Return'))
              return blockDepth === 1 && op.nops === 1
                ? walk(op.op1)
                : undefined;
            result = walk(op);
            if (!result) return undefined;
          }
          return result;
        } finally {
          blockDepth--;
          env = saved;
          memo.clear();
        }
      }
      if (
        (expr.operator === 'Sum' || expr.operator === 'Product') &&
        expr.nops === 2
      ) {
        const spec = expr.op2;
        if (
          (!isFunction(spec, 'Tuple') && !isFunction(spec, 'Limits')) ||
          !isSymbol(spec.op1)
        )
          return undefined;
        const saved = env;
        env = new Map(env);
        env.set(spec.op1.symbol, describeType('integer'));
        memo.clear();
        try {
          const body = walk(expr.op1);
          if (!body) return undefined;
          const t = derive(expr.operator, [body, describe(spec)]);
          return t === undefined ? undefined : describeType(t);
        } finally {
          env = saved;
          memo.clear();
        }
      }
      if (expr.operator === 'Typed') return walk(expr.op1);
      if (
        expr.operatorDefinition?.scoped ||
        [
          'Assign',
          'Declare',
          'Return',
          'Loop',
          'Break',
          'Continue',
          'Function',
        ].includes(expr.operator)
      )
        return undefined;
      if (memo.has(expr)) return memo.get(expr);
      const children = expr.ops.map(walk);
      if (children.some((x) => x === undefined)) return undefined;
      const operands = children as OperandDescriptor[];
      // The descriptor fallback does not model a lambda's elementwise lift.
      // Do not let its whole-argument result refine the enclosing call.
      if (
        operands.some((x) => mayBroadcast(x.type)) &&
        userFunctionLiteral(engine, expr.operator)
      )
        return undefined;
      const t = derive(expr.operator, operands);
      const result = t === undefined ? undefined : describeType(t);
      memo.set(expr, result);
      return result;
    };
    const result = walk(literal.op1)?.type;
    const refined =
      result === undefined || result === 'never' || !isSubtype(result, declared)
        ? undefined
        : result;
    // Repeated calls with literal argument types must not retain an unbounded
    // set of entries for one engine generation.
    if (results.size >= 256) results.delete(results.keys().next().value!);
    results.set(key, refined);
    return refined;
  } finally {
    running.delete(literal);
  }
}
