import { callableBindingInContext } from './binders.js';
import { isForwardCallReference } from './forward-call-reference.js';
import type {
  Expression,
  BoxedDefinition,
  IComputeEngine,
  OperandDescriptor,
} from '../global-types.js';
import type { FunctionInterface } from '../types-expression.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import { factsOf } from '../../common/type/facts.js';
import {
  collectionElementType,
  resolveTypeAlias,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { absentMarkerIsNumeric } from './validate.js';
import {
  deriveApplicationOf,
  describe,
  describeCallee,
  describedFunctionLiteral,
  describeType,
} from './operand-descriptor.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterNames,
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

function userFunctionLiteral(binding: BoxedDefinition | undefined) {
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
  binding: BoxedDefinition | undefined,
  literal: Expression
): boolean {
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
  derive: (
    head: string,
    args: readonly OperandDescriptor[]
  ) => Type | undefined,
  binding?: BoxedDefinition
): Type | undefined {
  if (isScalarResult(declared)) return undefined;
  if (binding && 'value' in binding && isForwardCallReference(binding.value))
    binding = callableBindingInContext(engine, head, binding);
  binding ??= engine.lookupDefinition(head);
  const literal = userFunctionLiteral(binding);
  if (
    !literal ||
    (args.some((x) => mayBroadcast(presentPart(x.type))) &&
      !bindsArgumentsWhole(binding, literal))
  )
    return undefined;
  return literalBodyResultType(engine, literal, args, declared, derive);
}

/** Scalar declarations already describe their result's representation. This
 * analysis refines collection alternatives, not numeric domains. */
function isScalarResult(declared: Type): boolean {
  return (
    ['number', 'boolean', 'string'].some((t) =>
      isSubtype(declared, t as 'number' | 'boolean' | 'string')
    ) || declared === 'never'
  );
}

/**
 * The type of `Apply(fn, …args)`, where `fn` is the descriptor of a function
 * literal written in place (`x ↦ …`, not a name), derived from the literal's
 * body as `callResultType` derives the result of a call of a user function:
 * each parameter is typed as its argument, and the body is walked under the
 * same rules (an early `Return` other than a last statement, a loop, an
 * assignment to a name that is not a parameter or a local, and an operator
 * that binds a variable other than `Sum`, `Product` and `Comprehension` stop
 * the derivation; an assignment to a parameter retypes it). `declared` is the
 * result type of the literal's signature, and the derived type is used only
 * when it fits it.
 *
 * The literal's signature types a parameter from the uses in its body,
 * before any argument is known: in `a ↦ Map(p, a)` the parameter is typed
 * `collection<unknown>` by the signature of `Map`, and so is the result.
 * Applied to a `list<real>`, the body is `Map(p, M)` with `M` a list of
 * reals, a `list<number>` (Tycho ledger row 426).
 *
 * `undefined` (the caller keeps `declared`) when `fn` is not a canonical
 * function literal, when its result is a scalar, when the signature is
 * generic (its instantiation types the call), when the literal maps over a
 * collection argument (its parameters are scalars: the mapping types the
 * call), and when an argument does not fit the type of its parameter, the
 * contract of the literal.
 */
export function appliedLiteralResultType(
  fn: OperandDescriptor,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  if (isScalarResult(declared)) return undefined;
  const sig = fn.type;
  if (
    typeof sig !== 'object' ||
    sig.kind !== 'signature' ||
    sig.typeParams !== undefined
  )
    return undefined;
  if (
    args.some((x) => mayBroadcast(presentPart(x.type))) &&
    signatureParamsAreScalar(sig)
  )
    return undefined;
  const slots = [...(sig.args ?? []), ...(sig.optArgs ?? [])];
  for (let i = 0; i < args.length; i++) {
    const slot = slots[i]?.type;
    if (slot !== undefined && !isSubtype(presentPart(args[i].type), slot))
      return undefined;
  }
  const literal = describedFunctionLiteral(fn);
  if (!isFunction(literal, 'Function')) return undefined;
  // An applied literal in the body of another is typed by this function
  // again, and the walk of its body is not memoized across the different
  // argument types it meets. Beyond a depth of 8 the result type of the
  // literal is kept, which bounds the work.
  if (appliedLiteralDepth >= 8) return undefined;
  appliedLiteralDepth += 1;
  try {
    return literalBodyResultType(
      literal.engine,
      literal,
      args,
      declared,
      derive
    );
  } finally {
    appliedLiteralDepth -= 1;
  }
}

/** The number of `appliedLiteralResultType` derivations in progress, one
 * inside the body of the other. */
let appliedLiteralDepth = 0;

/**
 * Whether the function literal `literal` reads a symbol named in `names`,
 * other than one of its own parameters or the parameters of a literal
 * nested in it.
 */
function readsAnyName(
  literal: Expression & FunctionInterface,
  names: ReadonlyMap<string, unknown>
): boolean {
  // A subexpression shared by several operands is visited once for each set
  // of shadowed names, not once per path.
  const seen = new Map<ReadonlySet<string>, Set<Expression>>();
  const visit = (e: Expression, shadowed: ReadonlySet<string>): boolean => {
    if (isSymbol(e)) return names.has(e.symbol) && !shadowed.has(e.symbol);
    if (!isFunction(e)) return false;
    let done = seen.get(shadowed);
    if (done === undefined) seen.set(shadowed, (done = new Set()));
    if (done.has(e)) return false;
    done.add(e);
    if (e.operator === 'Function') {
      const inner = new Set(shadowed);
      for (const p of e.ops.slice(1))
        for (const n of functionLiteralParameterNames(p)) inner.add(n);
      return visit(e.op1, inner);
    }
    return e.ops.some((op) => visit(op, shadowed));
  };
  return visit(literal, new Set());
}

/** The body walk shared by `callResultType` and `appliedLiteralResultType`. */
function literalBodyResultType(
  engine: IComputeEngine,
  literal: Expression & FunctionInterface,
  args: readonly OperandDescriptor[],
  declared: Type,
  derive: (head: string, args: readonly OperandDescriptor[]) => Type | undefined
): Type | undefined {
  // A number literal argument is typed by its tier (`integer`, `real`, …),
  // not by its value: the result of `(x ↦ (2x, x))(3)` is a pair of
  // integers, the type of the value it gives, and a call with another
  // literal shares the cache entry.
  args = args.map((a) => {
    const s = a.structureOf?.();
    return s?.kind === 'number' ? describeType(s.tier) : a;
  });
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
      // A nested function literal (the callback of `Map(u ↦ 2u, a)`) that
      // reads no name of the walk (a parameter or a local of the outer
      // literal) is an operand of its own type, its signature: its body runs
      // when it is applied, and its `Return` statements and assignments are
      // its own. One that reads such a name (`u ↦ At(b, 1)` with `b` a
      // parameter) has a signature typed with that name at its declared or
      // inferred type, not at the type of the argument, so its result says
      // nothing about this call and the derivation stops.
      if (expr.operator === 'Function')
        return readsAnyName(expr, env) ? undefined : describe(expr);
      if (
        expr.operatorDefinition?.scoped ||
        ['Assign', 'Declare', 'Return', 'Loop', 'Break', 'Continue'].includes(
          expr.operator
        )
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
      // An application over an ABSENT operand (a parameter typed `missing`,
      // or a value derived as absent) is typed as the evaluation of the body
      // answers it, not as the operator's type handler types a literal
      // `Missing` operand. At evaluation, an operator that propagates
      // absence answers the marker of its codomain read off the type of the
      // application AS WRITTEN in the body (`absentMarkerIsNumeric`,
      // `validate.ts`): `NaN` when that type is numeric, `Missing` otherwise.
      // The written type is fixed by the parameter's declared type: inside
      // `(p, s) ↦ (s·PointX(p), …)` with `p` inferred `collection<any> |
      // tuple`, `PointX(p)` is typed `unknown` and its absent value is
      // `Missing`, where the type handler of `PointX` over a literal
      // `Missing` says `number` (the top-level `PointX(Missing)` is `NaN`).
      // The condition is the evaluation's (step 4a of `BoxedFunction.
      // evaluate`): no operand is a collection (beside one, the absence
      // lands in each cell through the operator's own kernel); a
      // broadcastable operator answers for an absent operand anywhere, any
      // other only for one at a position that strips `missing`
      // (`Contains(c, Missing)` runs its handler: a search for an absent
      // value finds nothing). An operator that handles or passes absence
      // through (a container such as `Tuple`, `IsMissing`, a user function)
      // is typed by its handler.
      const absentAt = (i: number) =>
        resolveTypeAlias(operands[i].type) === 'missing';
      const absentOperand = operands.some((_, i) => absentAt(i));
      if (absentOperand && !operands.some((x) => mayBroadcast(x.type))) {
        const def = expr.operatorDefinition as
          | {
              resolvedMissingBehavior: string;
              broadcastable: boolean;
              signature: { type: Type };
              stripsMissingAt?: (i: number) => boolean;
            }
          | undefined;
        if (
          def?.resolvedMissingBehavior === 'propagate' &&
          (def.broadcastable ||
            operands.some(
              (_, i) => absentAt(i) && def.stripsMissingAt?.(i) === true
            ))
        ) {
          const result = describeType(
            absentMarkerIsNumeric(expr.type.type, def.signature.type)
              ? 'number'
              : 'missing'
          );
          memo.set(expr, result);
          return result;
        }
      }
      const callee = describeCallee(expr);
      let t = deriveApplicationOf({ head: expr.operator, callee }, operands, {
        engine,
        derive,
      });
      if (callee !== undefined) {
        const binding =
          expr.valueDefinition !== undefined
            ? { value: expr.valueDefinition }
            : expr.operatorDefinition !== undefined
              ? { operator: expr.operatorDefinition }
              : undefined;
        if (binding !== undefined)
          t =
            callResultType(
              engine,
              expr.operator,
              operands,
              t ?? 'unknown',
              derive,
              binding
            ) ?? t;
      }
      const result = t === undefined ? undefined : describeType(t);
      memo.set(expr, result);
      return result;
    };
    let result = walk(literal.op1)?.type;
    // The absent arms: for every combination of the arguments that may be
    // absent (each one present or absent on its own), the body is typed with
    // those parameters typed `missing`, and the results are joined with the
    // present arm. With `(p, q) ↦ (p, q)` over two index reads, one absent
    // and one present gives a tuple with one absent coordinate, which neither
    // the all-present nor the all-absent arm contains. More than three such
    // arguments (eight combinations) is declined: the call keeps the declared
    // result.
    const gated = present
      .map((t, i) => (t !== args[i].type ? i : -1))
      .filter((i) => i >= 0);
    if (result !== undefined && gated.length > 3) result = undefined;
    for (
      let mask = 1;
      result !== undefined && mask < 1 << gated.length;
      mask++
    ) {
      const absentAt = new Set(gated.filter((_, j) => (mask >> j) & 1));
      env = new Map(
        names.map((name, i) => [
          name,
          describeType(absentAt.has(i) ? 'missing' : present[i]),
        ])
      );
      memo.clear();
      const arm = walk(literal.op1)?.type;
      result = arm === undefined ? undefined : widen(result, arm);
    }
    // The declared result bounds the PRESENT values; a `missing` arm the
    // absent arm added is outside it by nature (`missing` is a subtype of no
    // values-only type), so the bound is checked with that arm stripped.
    const refined =
      result === undefined ||
      result === 'never' ||
      !isSubtype(stripMissingFromType(result), declared)
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
