import type {
  Expression,
  IComputeEngine,
  OperandDescriptor,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import { factsOf } from '../../common/type/facts.js';
import {
  collectionElementType,
  resolveTypeAlias,
} from '../../common/type/utils.js';
import { describe, describeType } from './operand-descriptor.js';
import {
  functionLiteralParameterName,
  isRestParameter,
  isDestructuringParameter,
} from './function-literal.js';
import { signatureParamsAreScalar } from './callback-broadcast-admission.js';
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

/**
 * The present part of an argument type with a `missing` arm: `missing | T`
 * reads as `T`. The index read `L[k]` of a declared `L: list<tuple<number,
 * number, number>>` is typed `missing | tuple<number, number, number>` (the
 * index may be out of range). The derivation types the body under the
 * present part, then once more with the parameter typed `missing`, and joins
 * the two (Tycho ledger row 374: `W(L[k], 2)` was typed from the declared
 * signature, with `broadcastable` components, because the union argument
 * stopped the derivation). The remaining arms are kept as the union they
 * were, not widened: `real | nan` stays a scalar union, which the parameter
 * guard below admits, where `widen` would make it `number`. A type with no
 * `missing` arm is returned unchanged.
 */
function presentPart(type: Type): Type {
  const t = resolveTypeAlias(type);
  if (typeof t === 'string' || t.kind !== 'union') return type;
  const arms = t.types.filter((x) => resolveTypeAlias(x) !== 'missing');
  if (arms.length === t.types.length || arms.length === 0) return type;
  return arms.length === 1 ? arms[0] : { kind: 'union', types: arms };
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

/**
 * Does a call of `head` hand each argument to the body WHOLE, a collection
 * argument included? It does when the signature that decides the binding has
 * a parameter that is not a scalar (a collection, a point): the interpreter
 * then maps over no argument (`applyFunctionLiteral`). The deciding signature
 * is the declared one when there is one, the literal's own type otherwise
 * (a bare `function` declaration, whose literal infers `l: collection` from
 * a use such as `Length(l)`). A generic signature is not read here: its
 * instantiation types the call.
 */
function bindsArgumentsWhole(
  engine: IComputeEngine,
  head: string,
  literal: Expression
): boolean {
  const binding = engine.lookupDefinition(head);
  if (!binding) return false;
  let sig: Type | undefined;
  if ('operator' in binding) sig = binding.operator.signature?.type;
  else {
    const declared = binding.value.type?.type;
    sig =
      typeof declared === 'object' && declared.kind === 'signature'
        ? declared
        : literal.type.type;
  }
  return (
    typeof sig === 'object' &&
    sig.kind === 'signature' &&
    sig.typeParams === undefined &&
    !signatureParamsAreScalar(sig)
  );
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
  if (
    !literal ||
    (args.some((x) => mayBroadcast(presentPart(x.type))) &&
      !bindsArgumentsWhole(engine, head, literal))
  )
    return undefined;
  const params = literal.ops.slice(1);
  if (
    params.length !== args.length ||
    params.some((p) => isRestParameter(p) || isDestructuringParameter(p))
  )
    return undefined;
  const running = active.get(engine) ?? new Set<Expression>();
  if (running.has(literal)) return undefined;
  active.set(engine, running);
  // Each parameter is typed as the PRESENT part of its argument. An argument
  // that may be absent (`missing | T`) is derived a second time below with
  // that parameter typed `missing`, and the two results are joined: a body
  // that passes the parameter through (`p ↦ p`) or stores it (`(p, s) ↦
  // (p, s)`) gives the absent value back, and the first derivation alone
  // would type the call as if the argument were always present.
  const names: string[] = [];
  const present: Type[] = [];
  let env = new Map<string, OperandDescriptor>();
  for (let i = 0; i < params.length; i++) {
    const name = functionLiteralParameterName(params[i]);
    if (!name) return undefined;
    const t = presentPart(args[i].type);
    names.push(name);
    present.push(t);
    // Unknown arguments may be collections at runtime. Do not infer a scalar
    // result by treating an unknown parameter as a numeric operand. A union
    // whose every member is a scalar (`real | nan`, the type of a value that
    // may be undefined) cannot be a collection, so it is typed like any other
    // scalar argument.
    if (
      t === 'unknown' ||
      t === 'any' ||
      t === 'value' ||
      (typeof t === 'object' &&
        (t.kind === 'broadcastable' ||
          (t.kind === 'union' &&
            !isSubtype(t, 'number') &&
            !isSubtype(t, 'boolean') &&
            !isSubtype(t, 'string'))))
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
      // A comprehension over `Element(i, source)` clauses: each index is
      // typed as an element of its source (a later clause sees the earlier
      // indexes), and the body is typed under those indexes. The
      // `Comprehension` type handler reads the body's type and nothing else.
      if (expr.operator === 'Comprehension' && expr.nops >= 2) {
        const saved = env;
        env = new Map(env);
        memo.clear();
        try {
          for (const clause of expr.ops.slice(1)) {
            if (
              !isFunction(clause, 'Element') ||
              clause.nops !== 2 ||
              !isSymbol(clause.op1)
            )
              return undefined;
            const source = walk(clause.op2);
            const element =
              source === undefined
                ? undefined
                : collectionElementType(source.type);
            if (element === undefined) return undefined;
            env.set(clause.op1.symbol, describeType(element));
            memo.clear();
          }
          const body = walk(expr.op1);
          if (!body) return undefined;
          const t = derive(expr.operator, [
            body,
            ...expr.ops.slice(1).map((x) => describe(x)),
          ]);
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
      // A call whose head is a parameter or a local of the literal (a
      // function-valued parameter `h` in `(h, a) ↦ h(a)`) is not a call of
      // the function of that name in the engine's scope: nothing is known
      // about it here, and `derive` would read the global one.
      if (env.has(expr.operator)) return undefined;
      if (memo.has(expr)) return memo.get(expr);
      const children = expr.ops.map(walk);
      if (children.some((x) => x === undefined)) return undefined;
      const operands = children as OperandDescriptor[];
      // The descriptor fallback does not model a lambda's elementwise lift.
      // Do not let its whole-argument result refine the enclosing call. A
      // function that binds its arguments whole has no such lift, and its
      // call is typed from its own body (`callResultType`, through `derive`).
      if (operands.some((x) => mayBroadcast(x.type))) {
        const callee = userFunctionLiteral(engine, expr.operator);
        if (callee && !bindsArgumentsWhole(engine, expr.operator, callee))
          return undefined;
      }
      const t = derive(expr.operator, operands);
      const result = t === undefined ? undefined : describeType(t);
      memo.set(expr, result);
      return result;
    };
    let result = walk(literal.op1)?.type;
    if (result !== undefined && present.some((t, i) => t !== args[i].type)) {
      // The absent arm: every argument with a `missing` arm is absent at
      // once, and the body is typed under that. (Absent in one and present
      // in another is covered by the join of the two arms for a body that
      // reads each parameter on its own; a body that combines two such
      // parameters is rare, and the declared result still bounds the join.)
      env = new Map(
        names.map((name, i) => [
          name,
          describeType(present[i] === args[i].type ? present[i] : 'missing'),
        ])
      );
      memo.clear();
      const absent = walk(literal.op1)?.type;
      result = absent === undefined ? undefined : widen(result, absent);
    }
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
