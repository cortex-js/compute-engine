// Checks that assigned values and parameter writes match their declarations,
// and the assignment specs for each target.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isOperatorDef,
  isValueDef,
  collectBinderNames,
} from '../boxed-expression/utils.js';
import { paramsAreScalar } from '../boxed-expression/boxed-function.js';
import { capturedValueMismatchNowEntry } from '../function-utils.js';
import { isTupleShapedType } from '../collection-utils.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import {
  cannotHoldAList as typeCannotHoldAList,
  isSubtype,
} from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import {
  hasFreeTypeVariables,
  isPolymorphicType,
} from '../../common/type/instantiate.js';
import { substituteDeclaredBounds } from '../boxed-expression/generic-instantiation.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
  isDestructuringParameter,
  isRestParameter,
  capturedTypeWidening,
} from '../boxed-expression/function-literal.js';
import type { CompileTarget } from './types.js';

/**
 * The signature DECLARED for the user function `id`
 * (`ce.declare('k', '(real) -> real')`), or `undefined` when its signature
 * was only inferred from the function literal.
 */
export function declaredUserSignature(
  engine: ComputeEngine,
  id: string
): Type | undefined {
  const def = engine.lookupDefinition(id);
  if (!def) return undefined;
  if (isOperatorDef(def))
    return def.operator.inferredSignature
      ? undefined
      : def.operator.signature?.type;
  if (!('value' in def) || def.value === undefined) return undefined;
  if (def.value.inferredType) return undefined;
  const t = def.value.type?.type;
  return typeof t === 'object' && t.kind === 'signature' ? t : undefined;
}

/**
 * A call of a user function, or `Apply(literal, …args)`, with a tuple or a
 * list of tuples at a parameter with NO declared type, written in a form
 * that the JavaScript target compiles with the meaning the interpreter
 * gives it: an untyped parameter binds a tuple whole, and a list maps over
 * its elements, each one a point bound whole. The emitted JavaScript maps
 * a function over any array at run time (`_SYS.bcastFn`), and a point is
 * an array, so `Apply(u ↦ 7, (a, b))` gave `[7, 7]` and `g(P)` for a list
 * of points `P` gave `[[7, 7], [7, 7]]`, where the interpreter gives `7`
 * and `[7, 7]`.
 *
 * - `Apply(literal, …args)` where every argument is a tuple at an untyped
 *   parameter: the body of the literal with each parameter replaced by
 *   its argument. Each argument must be a symbol or a `Tuple` literal of
 *   symbols and numbers, so that the replacement computes nothing twice.
 * - A call with one argument, a list of tuples that is not a list
 *   literal, at an untyped parameter of a function that maps over a list:
 *   `Map(literal, list)` for `Apply`, and `Map(x ↦ g(x), list)` for a
 *   function `g` held as a value. `Map` binds each element whole. A
 *   function assigned with no declaration (an operator definition)
 *   already maps a list of points per element, and is not changed, except
 *   when `operatorDefinitions` is true (`Map(g, list)`, below).
 * - `Map(f, list)` over a list of tuples: the same map, with `f` a
 *   function literal or the name of a user function.
 *
 * `undefined` for any other call.
 */
export function wholeTupleCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  operatorDefinitions = false
): Expression | undefined {
  // `Map(f, list)` over a list of tuples is the same map as the call
  // `f(list)` below: rewritten so that each tuple is bound whole.
  // A function assigned with no declaration (an operator definition) is
  // included here: `Map` hands it the elements through its broadcasting
  // wrapper, which maps into each point.
  if (h === 'Map' && args.length === 2) {
    const [f, list] = args;
    const called = isSymbol(f)
      ? wholeTupleCall(engine, f.symbol, [list], target, true)
      : isFunction(f, 'Function') && !isElementCall(f)
        ? wholeTupleCall(engine, 'Apply', [f, list], target)
        : undefined;
    return isFunction(called, 'Map') ? called : undefined;
  }
  let literal: Expression | undefined;
  let callArgs: ReadonlyArray<Expression> = args;
  let declared: Type | undefined;
  if (h === 'Apply') {
    if (!isFunction(args[0], 'Function')) return undefined;
    literal = args[0];
    callArgs = args.slice(1);
  } else {
    // A block-local function `h` shadows an engine-level function with the
    // same name. Its call is compiled as a call of the local binding
    // (`tryCompileLocalFunctionCall`), and is not rewritten here.
    if (blockLocalFunction(h, target) !== undefined) return undefined;
    const def = engine.lookupDefinition(h);
    if (!def || (isOperatorDef(def) && !operatorDefinitions)) return undefined;
    literal = userFunctionLiteral(engine, h);
    if (literal === undefined) return undefined;
    declared = declaredUserSignature(engine, h);
  }
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  if (
    params.length !== callArgs.length ||
    params.some((p) => isRestParameter(p) || isDestructuringParameter(p))
  )
    return undefined;
  const declaredArgs =
    typeof declared === 'object' && declared.kind === 'signature'
      ? (declared.args ?? [])
      : [];
  const untyped = (i: number) => {
    if (functionLiteralParameterType(params[i]) !== undefined) return false;
    const t = declaredArgs[i]?.type;
    return t === undefined || t === 'unknown' || t === 'any';
  };
  const isTupleTyped = (x: Expression) =>
    isTupleShapedType(resolveTypeAlias(x.type.type));

  // `Apply` with a tuple at each untyped parameter: the body with the
  // tuples in place of the parameters.
  const simple = (x: Expression) =>
    isSymbol(x) ||
    (isFunction(x, 'Tuple') && x.ops.every((c) => isSymbol(c) || isNumber(c)));
  if (
    h === 'Apply' &&
    callArgs.length > 0 &&
    callArgs.every((x, i) => untyped(i) && isTupleTyped(x) && simple(x))
  ) {
    const substitutions: Record<string, Expression> = {};
    for (const [i, p] of params.entries()) {
      const name = functionLiteralParameterName(p);
      if (name === undefined) return undefined;
      substitutions[name] = callArgs[i];
    }
    // `subs` does not avoid capture. A binder of the body (a `Sum` index, a
    // nested `Function` parameter, a `Block` local) that has the name of a
    // parameter would get the tuple in place of its own variable, and a
    // binder with the name of a symbol of a tuple would capture that
    // symbol: `Apply(u ↦ Sum(k·u[1], k=1..3), (k, 2))` would read the
    // index `k` instead of the outer `k`. The body is a `Block` whose scope
    // also holds the parameters, so its statements are walked one by one,
    // and of its own bindings only the locals that are not parameters are
    // kept. A statement that declares or assigns a parameter rebinds it.
    const body = literal.op1;
    const statements = isFunction(body, 'Block') ? body.ops : [body];
    const binders = new Set<string>();
    for (const s of statements) {
      collectBinderNames(s, binders);
      if (
        (isFunction(s, 'Declare') || isFunction(s, 'Assign')) &&
        isSymbol(s.op1)
      )
        binders.add(s.op1.symbol);
    }
    if (isFunction(body, 'Block'))
      for (const n of boundVariableNames(body))
        if (!(n in substitutions)) binders.add(n);
    for (const [param, arg] of Object.entries(substitutions)) {
      const captured = binders.has(param)
        ? param
        : arg.symbols.find((s) => binders.has(s));
      if (captured !== undefined)
        throw new Error(
          `Could not compile \`Apply\`: a tuple argument is bound whole ` +
            `to an untyped parameter, and the body of the function binds ` +
            `\`${captured}\`, which is the name of the parameter or a ` +
            `symbol of the argument.`
        );
    }
    return literal.op1.subs(substitutions);
  }

  // One argument, a list of tuples at an untyped parameter of a function
  // that maps over a list: a map that binds each tuple whole.
  if (callArgs.length !== 1 || !untyped(0)) return undefined;
  const arg = callArgs[0];
  if (isFunction(arg, 'List')) return undefined;
  const t = resolveTypeAlias(arg.type.type);
  if (
    typeof t !== 'object' ||
    t.kind !== 'list' ||
    !isTupleShapedType(resolveTypeAlias(t.elements))
  )
    return undefined;
  const listsMap =
    h === 'Apply'
      ? paramsAreScalar(literal.type.type)
      : userFunctionParamsAreScalar(engine, h);
  if (!listsMap) return undefined;
  // The element is applied through a call (`Apply` of the literal, or a
  // call of `g`), which binds the point whole as the cases above do. A
  // `Map` over the literal itself would compile the literal with its
  // run-time broadcast, which maps into each point. The name of the element
  // must not be a symbol of the literal either, because the map's own
  // parameter would capture it.
  let element = '_point';
  while (
    arg.symbols.includes(element) ||
    (h === 'Apply' && literal.symbols.includes(element))
  )
    element = `_${element}`;
  // The literal and the argument are kept boxed, not sent through MathJSON:
  // boxed again in this scope, a symbol argument named `e`, `i` or `Pi`
  // (a local or a parameter) would read as the constant of that name.
  const call = h === 'Apply' ? ['Apply', literal, element] : [h, element];
  return engine.box(['Map', ['Function', call, element], arg] as never);
}

/**
 * The call `call` of a block-local function, wrapped in a `Typed` node
 * with the result type of the function's literal, when the engine types
 * the call `unknown` or `any` and that result type is a tuple. A call
 * whose arguments may be lists is skipped on every target except
 * `interval-javascript`. The JavaScript call of a local function maps over
 * a list argument (`_SYS.bcastFn`), and its value is then a list of
 * tuples, not a tuple; the other targets are treated the same way, since
 * their calls may map too. The `interval-javascript` target applies the
 * local function to its argument directly, with no map, so the value of
 * its call is always the tuple. `undefined` otherwise.
 */
export function localCallWithResultType(
  call: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isFunction(call)) return undefined;
  const t = call.type.type;
  if (t !== 'unknown' && t !== 'any') return undefined;
  const literal = blockLocalFunction(call.operator, target);
  if (!literal) return undefined;
  const signature = resolveTypeAlias(literal.type.type);
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return undefined;
  const result = resolveTypeAlias(signature.result);
  if (typeof result !== 'object' || result.kind !== 'tuple') return undefined;
  if (
    target.language !== 'interval-javascript' &&
    !call.ops.every(provablyScalarArg)
  )
    return undefined;
  return call.engine.function('Typed', [
    call,
    call.engine.string(typeToString(result)),
  ]);
}

/**
 * Apply `assertParameterWritesMatchTypes` to every function literal of
 * `root`, and of the user functions that `root` reaches by name, before
 * anything is compiled. The check also runs where a literal is compiled,
 * but the constant folder can replace the literal first: it evaluates
 * with `.N()`, which does not check an assignment to a typed parameter
 * (`Map(q ↦ { q = q + 0.5; q + 1 }, Range(1, 3))` gives `[2.5, 3.5, 4.5]`
 * under `.N()`, and an `incompatible-type` error for each element under
 * `evaluate()`).
 */
export function assertParameterWritesInUnit(root: Expression): void {
  const engine = root.engine;
  const seen = new WeakSet<Expression>();
  const names = new Set<string>();
  const visit = (node: Expression): void => {
    if (seen.has(node)) return;
    seen.add(node);
    const name = isSymbol(node)
      ? node.symbol
      : isFunction(node)
        ? node.operator
        : undefined;
    if (name !== undefined && !names.has(name)) {
      names.add(name);
      const literal = userFunctionLiteral(engine, name);
      if (literal !== undefined) visit(literal);
    }
    if (!isFunction(node)) return;
    if (node.operator === 'Function')
      assertParameterWritesMatchTypes(
        node,
        node.ops,
        node.ops.slice(1).map((x) => functionLiteralParameterName(x) || '_')
      );
    for (const op of node.ops) visit(op);
  };
  visit(root);
}

/**
 * Decline when the body of the function literal `literal` (its operands
 * `ops`, its parameter names `params`) assigns to a parameter a value
 * whose type is not a subtype of the parameter's type.
 *
 * The interpreter types an unannotated parameter of a range callback from
 * the range elements (`integer`), and checks each value assigned to a
 * typed parameter: `q = 0/0` in `Map(q ↦ { q = 0/0; If(q < 0, 1, 2) },
 * Range(1, 3))` is an `incompatible-type` error, and so is `q = [1, 2]`.
 * The emitted assignment has no check, so the compiled call gave `2` or
 * the string "1,21". The compilation fails closed. A value whose type is
 * wider than the parameter's but whose values can be of that type
 * (`q = q / 2`, typed `rational`) is refused too, since compiled code does
 * not test the value. CE-228.
 *
 * A write inside a nested function literal that has a parameter of the
 * same name, or inside a block that declares the name, writes another
 * binding and is not read.
 */
export function assertParameterWritesMatchTypes(
  literal: Expression | undefined,
  ops: ReadonlyArray<Expression>,
  params: ReadonlyArray<string>
): void {
  if (!isFunction(literal, 'Function')) return;
  const signature = literal.type.type;
  params.forEach((name, i) => {
    if (name === '_') return;
    const declared = signatureParamType(signature, i);
    if (declared === undefined || declared === 'unknown' || declared === 'any')
      return;
    const visit = (node: Expression): void => {
      if (!isFunction(node)) return;
      if (
        node.operator === 'Function' &&
        node.ops.slice(1).some((p) => functionLiteralParameterName(p) === name)
      )
        return;
      if (
        node.operator === 'Block' &&
        node.ops.some(
          (s) =>
            isFunction(s, 'Declare') && isSymbol(s.op1) && s.op1.symbol === name
        )
      )
        return;
      if (
        node.operator === 'Assign' &&
        isSymbol(node.op1) &&
        node.op1.symbol === name &&
        node.op2 !== undefined &&
        !isSubtype(node.op2.type.type, declared)
      )
        throw new Error(
          `Could not compile the function: its body assigns ` +
            `\`${node.op2.toString()}\` (type ` +
            `\`${typeToString(node.op2.type.type)}\`) to the parameter ` +
            `\`${name}\` of type \`${typeToString(declared)}\`. The ` +
            `interpreter gives an \`incompatible-type\` error for a value ` +
            `that is not of the type of the parameter, and the compiled ` +
            `assignment does not test the value.`
        );
      for (const op of node.ops) visit(op);
    };
    visit(ops[0]);
  });
}

/**
 * Whether the function literal `f` is `x ↦ g(x)` or `x ↦ Apply(…, x)`: a
 * call whose only argument is the one parameter. `wholeTupleCall` writes a
 * map in that form, and the form is not written again.
 */
export function isElementCall(f: Expression): boolean {
  if (!isFunction(f, 'Function') || f.nops !== 2) return false;
  const name = functionLiteralParameterName(f.ops[1]);
  let body = f.op1;
  while (isFunction(body, 'Block') && body.nops === 1) body = body.op1;
  if (!isFunction(body) || name === undefined) return false;
  const last = body.ops[body.nops - 1];
  return isSymbol(last, name) && (body.operator === 'Apply' || body.nops === 1);
}

/**
 * If `id` names a symbol whose engine definition is a user-defined function
 * literal, return that `["Function", body, …params]` literal; otherwise
 * `undefined`. Covers both storage routes:
 *  - an operator definition backed by a lambda (`f(x) := …`, `x ↦ …`, or
 *    `ce.assign(name, lambda)`), where the literal is kept on the operator
 *    definition as `_lambdaLiteral`; and
 *  - a plain symbol whose assigned value is itself a `Function` literal.
 *
 * Public so compilation targets can check whether a symbol operand is
 * structurally callable (e.g. the `Reduce` combiner) before compiling it.
 */
export function userFunctionLiteral(
  engine: ComputeEngine,
  id: string
): (Expression & FunctionInterface) | undefined {
  const def = engine.lookupDefinition(id);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined && isFunction(literal, 'Function')) {
      assertCapturedTypesCurrent(id, literal, def.operator);
      return literal;
    }
  }
  const value = engine._getSymbolValue(id);
  if (value !== undefined && isFunction(value, 'Function')) {
    assertCapturedTypesCurrent(
      id,
      value,
      isValueDef(def) ? def.value : undefined
    );
    return value;
  }
  return undefined;
}

/**
 * Refuse to compile a call of the user function `id` whose literal is
 * `literal` when a captured symbol of the body makes the static type of
 * the call doubtful, as the interpreter checks such a call:
 * - the symbol holds a value of another type than the body was typed with
 *   (`capturedValueMismatchNow()`, `function-utils.ts`), whatever the
 *   provenance of the type of the definition;
 * - `def`, the definition that holds the literal, has a captured symbol
 *   that changed type since the literal was stored
 *   (`capturedTypesWidened()`), whatever the provenance of the type of
 *   `def`: the body was typed with the earlier type, and its compiled
 *   operators do not check their operands (with `y` changed from a number
 *   to a string, `x + y` compiles to a string concatenation, where the
 *   interpreter gives the `incompatible-type` error of `Add`).
 * The interpreter checks such a call (`resultOutsideCallType()`,
 * `boxed-expression/function-literal.ts`, and the operators of the body).
 * The compiled code has no such check, so the compile fails closed and the
 * interpreter evaluates the call.
 * (User decision 2026-10-25, option (c) of CE-473 in `ROADMAP.md`.)
 */
export function assertCapturedTypesCurrent(
  id: string,
  literal: Expression,
  def: object | undefined
): void {
  // The message names the symbol and both types, so that a host can find
  // the declaration or the assignment that changed it.
  const widened = def !== undefined ? capturedTypeWidening(def) : undefined;
  let reason: string;
  if (widened !== undefined)
    reason =
      `the symbol '${widened.name}' that its body reads has the type ` +
      `\`${widened.now.toString()}\`, but the body of '${id}' was ` +
      `typed when '${widened.name}' had the type ` +
      `\`${widened.before.toString()}\``;
  else {
    const mismatch = capturedValueMismatchNowEntry(literal);
    if (mismatch === undefined) return;
    reason =
      `the symbol '${mismatch.name}' that its body reads holds a value of ` +
      `type \`${mismatch.value.type.toString()}\`, but the body was typed ` +
      `with '${mismatch.name}' of type \`${mismatch.expected.toString()}\``;
  }
  throw new Error(
    `Could not compile the function '${id}': ${reason}. ` +
      `The interpreter evaluates it instead.`
  );
}

/**
 * The function literal of the block-local function `h`: a function that an
 * enclosing statement list binds (`CompileTarget.localFunctions`). A call
 * of `h` is compiled as a call of that binding
 * (`tryCompileLocalFunctionCall`), not of an engine-level function with
 * the same name, so a rewrite of the call must read this literal too.
 *
 * `null` when `h` is a block local whose literal cannot be read here: its
 * value can change while the block runs (`CompileTarget.reboundFunctions`),
 * or the block binds it only after this point
 * (`CompileTarget.lexicalFunctions`). `undefined` when `h` is not a block
 * local.
 */
export function blockLocalFunction(
  h: string,
  target: CompileTarget<Expression>
): (Expression & FunctionInterface) | null | undefined {
  if (target.reboundFunctions?.has(h)) return null;
  const literal = target.localFunctions?.get(h);
  if (literal !== undefined)
    return isFunction(literal, 'Function') ? literal : null;
  return target.lexicalFunctions?.has(h) ? null : undefined;
}

/**
 * The signature `sig` with each parameter declared `broadcastable<T>` whose
 * `T` cannot hold a list (a number, a boolean, a string, a tuple) read as
 * `T`. Such a parameter maps to the cells (user decision 2026-10-24,
 * ROADMAP CE-405), as a scalar parameter does in the compiled code
 * (`_SYS.bcastFn`), so a signature whose every parameter is then scalar
 * compiles as one with scalar parameters. A parameter declared
 * `broadcastable<value>` maps one rank, which no compiled form expresses,
 * and is kept.
 */
export function withCellSlotsAsElements(sig: Type): Type {
  if (typeof sig !== 'object' || sig.kind !== 'signature') return sig;
  const read = <A extends { type: Type }>(arg: A): A => {
    const t = arg.type;
    return typeof t === 'object' &&
      t.kind === 'broadcastable' &&
      typeCannotHoldAList(t.elements)
      ? { ...arg, type: t.elements }
      : arg;
  };
  return {
    ...sig,
    ...(sig.args ? { args: sig.args.map(read) } : {}),
    ...(sig.optArgs ? { optArgs: sig.optArgs.map(read) } : {}),
    ...(sig.variadicArg ? { variadicArg: read(sig.variadicArg) } : {}),
  };
}

export function userFunctionParamsAreScalar(
  engine: ComputeEngine,
  h: string
): boolean {
  const def = engine.lookupDefinition(h);
  if (!def) return true;
  if (isOperatorDef(def)) return paramsAreScalar(def.operator);
  if (!('value' in def) || def.value === undefined) return true;
  const declared = def.value.type?.type;
  if (typeof declared === 'object' && declared.kind === 'signature') {
    // A GENERIC signature is read at its declared bounds, the same reading
    // `paramsAreScalar` itself performs and the same one the emission uses
    // (`userFunctionSignature`). A variable with no ground bound leaves the
    // parameters open: the function declines whole-fn there (G3,
    // generic-function-literals design §2.7, enforced in
    // `ensureUserFunctionEmitted`), and answering `true` would silently
    // claim scalar parameters for a signature nothing was emitted for.
    const ground = groundSignature(declared);
    return ground === undefined
      ? false
      : paramsAreScalar(withCellSlotsAsElements(ground));
  }
  const literal = def.value.value?.type?.type;
  if (literal === undefined) return true;
  if (typeof literal === 'object' && literal.kind === 'signature') {
    const ground = groundSignature(literal);
    return ground === undefined ? false : paramsAreScalar(ground);
  }
  return paramsAreScalar(literal);
}

/**
 * Is `a` PROVABLY not a collection (`number`/`boolean`/`string`-typed — a
 * plain numeric call such as `f(2)`), and so incapable of broadcasting at
 * run time? Note the direction: this decides only where the answer is
 * certain, so a type merely WIDER than the runtime value is treated as
 * possibly a collection.
 */
export const provablyScalarArg = (a: Expression): boolean =>
  a.type.matches('number') ||
  a.type.matches('boolean') ||
  a.type.matches('string');

/**
 * The type signature `t` gives positional parameter `i`: the required
 * parameters first, then the optional ones, then the variadic tail.
 * `undefined` when `t` is not a signature, or states no type at that
 * position.
 *
 * Shared by the ENGINE-defined route, which reads `t` from a definition
 * (`userFunctionParamType`), and the BLOCK-LOCAL route, which reads it from
 * the declared literal's own type — so the two agree on what a parameter is
 * declared as.
 */
export function signatureParamType(
  t: Type | undefined,
  i: number
): Type | undefined {
  if (t === undefined || typeof t === 'string' || t.kind !== 'signature')
    return undefined;
  const nArgs = t.args?.length ?? 0;
  if (i < nArgs) return t.args![i].type;
  const nOpt = t.optArgs?.length ?? 0;
  if (i < nArgs + nOpt) return t.optArgs![i - nArgs].type;
  return t.variadicArg?.type;
}

/**
 * `t` as a GROUND function signature: `t` itself when it is a signature
 * with no `where` clause, its bound reading when every quantified variable
 * has a ground declared bound, and `undefined` otherwise (not a signature,
 * or no ground reading — see {@link userFunctionSignature}).
 */
export function groundSignature(
  t: Type | undefined
): FunctionSignature | undefined {
  if (t === undefined || typeof t === 'string' || t.kind !== 'signature')
    return undefined;
  if (!isPolymorphicType(t)) return t;
  // `substituteDeclaredBounds` replaces every BOUNDED variable and drops it
  // from the `where` clause; an unbounded one stays, and so does any
  // variable a bound itself mentions (the substitution is single-pass).
  // Both leftovers are caught below.
  const g = substituteDeclaredBounds(t.typeParams, t);
  if (typeof g === 'string' || g.kind !== 'signature') return undefined;
  if (g.typeParams !== undefined && g.typeParams.length > 0) return undefined;
  return hasFreeTypeVariables(g) ? undefined : g;
}
