import type { Expression } from '../global-types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import type { NamedElement, Type } from '../../common/type/types.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import type {
  CompilationOptions,
  CompilationResult,
  ParallelLoopRecord,
  PoolAccumulator,
  PoolLoopReason,
} from './types.js';
import type { Scope } from '../types-evaluation.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  isOperatorDef,
  isValueDef,
} from '../boxed-expression/definition-guards.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isLibraryOperator } from './builtin-callback.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { isShippableCode } from '../kernel-pool.js';
import { overriddenHeadPredicate } from './fixed-width-unroll.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';

//
// The loops of a JavaScript compilation that can run on the worker pool
// (`docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`, sections 3 and
// 4): the conditions 2 to 8 of a `parallel for`, and "the loop as a
// function", a function of a sub-range of pass indices that the pool runs on
// a worker. This module does not change the code of the program: `run()`
// runs every loop in order.
//
// The analysis reads the loop as written, before `lowerParallelHeads()`
// rewrites `+=`: after that rewrite, `L[c] += 1` is
// `L = ReplaceAt(L, c, L[c] + 1)`, which reads `L`, and condition 4 (no read
// of an accumulator) can no longer be checked.
//

// The types of the records are declared in `types.ts`, beside
// `CompilationResult.parallelLoops`, which holds them: an import of this
// module by `types.ts` would make a cycle of modules.
export type {
  ParallelLoopRecord,
  PoolAccumulator,
  PoolLoopReason,
} from './types.js';

/**
 * A loop that passes the conditions of the analysis (3 to 6). `function` is
 * the loop as a function (see `poolLoopFunction()`). `outer` is the order of
 * the outer variables among its parameters, and `accumulators` the order of
 * the accumulators in the list that it returns.
 */
export type PoolLoopPlan = {
  readonly accumulators: ReadonlyArray<PoolAccumulator>;
  readonly outer: ReadonlyArray<{ name: string; type: string }>;
  readonly function: Expression;
};

/** The `ParallelLoop` node as written of a lowered loop, with the nodes
 * from the root of the tree that the lowering walks to it (its ancestors as
 * written, outermost first). */
type LoopOrigin = {
  readonly loop: Expression;
  readonly ancestors: ReadonlyArray<Expression>;
};

/**
 * The `ParallelDomain` node of each lowered `parallel for`, mapped to the
 * loop as written. `lowerParallelHeads()` makes a new `ParallelDomain` node
 * for each loop that it lowers and records it here
 * (`noteLoweredParallelLoop()`). The emitter of the counted loop
 * (`emitElementLoops()` in `compile-loops.ts`) meets that node as the domain
 * of the `Loop` and finds the loop as written with it. The key is the domain
 * node, not the `Loop` node: a rewrite after the lowering that changes only
 * the body (`rewriteAngularUnit()` on a `Sin` of the body) rebuilds the
 * `Loop` node and keeps its domain node. A rewrite that changes the domain
 * makes a new node, which this table does not know: that loop is not in the
 * collection, and runs in order. A node shared by several parents is
 * lowered once (the memo of `lowerParallelHeads()`), so it has one domain
 * node and one entry. Each call of `bodyWithParallelHeadsLowered()` lowers a
 * body again and adds entries for its new domain nodes.
 */
const loopOrigins = new WeakMap<Expression, LoopOrigin>();

/**
 * Record that `domain`, the `ParallelDomain` node that
 * `lowerParallelHeads()` made, is the domain of the lowered form of `loop`,
 * the `ParallelLoop` node as written. `ancestors` are the nodes from the
 * root of the tree that the lowering walks to `loop`, outermost first.
 */
export function noteLoweredParallelLoop(
  domain: Expression,
  loop: Expression,
  ancestors: ReadonlyArray<Expression>
): void {
  loopOrigins.set(domain, { loop, ancestors });
}

/**
 * The `ParallelLoop` node as written of the lowered loop whose domain is the
 * `ParallelDomain` node `domain`, or `undefined` when no lowering recorded
 * `domain` (a rewrite after the lowering made a new domain node).
 */
export function poolLoopAsWritten(domain: Expression): Expression | undefined {
  return loopOrigins.get(domain)?.loop;
}

/**
 * The loops that one JavaScript compilation meets, in the order in which
 * the emitter meets them. `JavaScriptTarget.compile()` opens a collection
 * for the time of the emission (`beginPoolLoopCollection()`), and the
 * emitter of the loops adds each `parallel for` to the open collection
 * (`notePoolLoopDomain()`). A second emission of the same program in the
 * same compilation (the batch body of `broadcast()`) meets the same loops
 * again, and the map keeps one entry for each loop as written.
 */
export type PoolLoopCollection = {
  readonly loops: Map<Expression, { origin: LoopOrigin; counted: boolean }>;
};

/** The open collections, innermost last: a compilation can run during
 * another one (a compile handler that compiles a part of its node). */
const collections: PoolLoopCollection[] = [];

/** While the loops as functions of a program are compiled, no collection is
 * opened: a `parallel for` inside the body of a pool loop runs in order
 * inside the pass, and needs no function of its own. */
let suppressed = 0;

/** Open a collection for one compilation, or `undefined` while the loops as
 * functions of another compilation are compiled. Close it with
 * `endPoolLoopCollection()`. */
export function beginPoolLoopCollection(): PoolLoopCollection | undefined {
  if (suppressed > 0) return undefined;
  const collection: PoolLoopCollection = { loops: new Map() };
  collections.push(collection);
  return collection;
}

/** Close `collection`, which `beginPoolLoopCollection()` opened. */
export function endPoolLoopCollection(
  collection: PoolLoopCollection | undefined
): void {
  if (collection === undefined) return;
  const i = collections.lastIndexOf(collection);
  if (i >= 0) collections.splice(i, 1);
}

/**
 * Called by the emitter of a loop over `domain`, a `ParallelDomain` node:
 * add the loop to the open collection. `counted` is `true` when the
 * emitter emits it as a counted loop over a range whose bounds make no
 * draw (`compileCountedRange()`), which condition 2 requires.
 */
export function notePoolLoopDomain(domain: Expression, counted: boolean): void {
  const collection = collections[collections.length - 1];
  if (collection === undefined) return;
  const origin = loopOrigins.get(domain);
  if (origin === undefined) return;
  const known = collection.loops.get(origin.loop);
  // A loop that one emission emits as a counted loop is counted.
  if (known !== undefined) known.counted ||= counted;
  else collection.loops.set(origin.loop, { origin, counted });
}

/**
 * Whether `t` is a type of the data that a worker can receive as an
 * argument (condition 6): a number, a boolean, a string, or a list or a
 * tuple of these.
 */
function isDataType(t: BoxedType): boolean {
  const scalar = 'number|boolean|string';
  if (t.matches(scalar)) return true;
  if (t.matches(`list<${scalar}>`)) return true;
  const type = t.type;
  return (
    typeof type === 'object' &&
    type.kind === 'tuple' &&
    type.elements.every((e: NamedElement) => isSubtype(e.type, scalar))
  );
}

/**
 * Whether `t` is the type of a number that the compiled code holds as a
 * JavaScript number in the default mode (an accumulator, condition 3): a
 * subtype of `number` that is not a number type with no real member
 * (`complex` without `real`, `imaginary`). Such a type is emitted on the
 * complex lane in every mode. `number` is accepted: in the default mode the
 * compiled code reads it as a real number (`isComplexValued()` in
 * `compiler-core.ts`).
 */
function isMachineNumber(t: Type): boolean {
  return isSubtype(t, 'number') && !isNonRealNumber(t);
}

/**
 * Whether `t` is the type of a list of numbers of the real lane (a list
 * accumulator, condition 3).
 */
function isMachineNumberList(t: Type): boolean {
  return (
    typeof t === 'object' &&
    t.kind === 'list' &&
    (t.dimensions === undefined ||
      (Array.isArray(t.dimensions) && t.dimensions.length === 1)) &&
    isMachineNumber(t.elements)
  );
}

/** Whether the definition of the symbol `sym` is the definition of its
 * name in the scopes of the engine, outside every scope of the program. */
function isEngineLevel(sym: Expression): boolean {
  if (!isSymbol(sym)) return false;
  const def = sym.engine.lookupDefinition(sym.symbol);
  if (def === undefined) return false;
  if (isValueDef(def)) return def.value === sym.valueDefinition;
  if (isOperatorDef(def)) return def.operator === sym.operatorDefinition;
  return false;
}

/**
 * Whether the call `e` is bound to the definition of its operator in the
 * scopes of the engine, outside every scope of the program. A function that
 * a block of the program defines with the name of a function of the engine,
 * or of a library operator, is another function: the loop as a function is
 * boxed again at the level of the engine (`poolLoopFunction()`), where the
 * name gives the function of the engine, so a worker would call another
 * function than `run()`. A call whose head is a function held as a value,
 * also one of the engine, is not accepted: a function value does not go to
 * a worker (condition 6), so the loop runs in order with `'function-value'`.
 */
function callsEngineLevel(e: Expression): boolean {
  const def = e.engine.lookupDefinition(e.operator);
  return isOperatorDef(def) && def.operator === e.operatorDefinition;
}

/** Whether `scope` binds the name of `sym` to the definition of `sym`. */
function scopeBinds(scope: Scope | undefined, sym: Expression): boolean {
  if (scope === undefined || !isSymbol(sym)) return false;
  const def = scope.bindings.get(sym.symbol);
  if (def === undefined) return false;
  if (isValueDef(def))
    return (
      sym.valueDefinition !== undefined && def.value === sym.valueDefinition
    );
  if (isOperatorDef(def))
    return (
      sym.operatorDefinition !== undefined &&
      def.operator === sym.operatorDefinition
    );
  return false;
}

/**
 * The operands of `e`: the operands of a function expression, or the values
 * of a dictionary. A dictionary is not a function expression, and the value
 * of a local (`let p = …`, `Declare(p, Dictionary(value: …))`) is one of
 * its values.
 */
function operandsOf(e: Expression): ReadonlyArray<Expression> {
  if (isFunction(e)) return e.ops;
  if (isDictionary(e)) return e.values;
  return [];
}

/** The local scopes of `expr` and of each node inside it. */
function scopesOf(expr: Expression, into = new Set<Scope>()): Set<Scope> {
  if (expr.localScope !== undefined) into.add(expr.localScope);
  for (const op of operandsOf(expr)) scopesOf(op, into);
  return into;
}

/** Whether a scope of `scopes` binds the name of `sym` to its definition. */
function boundIn(scopes: ReadonlySet<Scope>, sym: Expression): boolean {
  for (const scope of scopes) if (scopeBinds(scope, sym)) return true;
  return false;
}

/** The result of the analysis of a loop as written. */
export type PoolLoopAnalysis =
  { plan: PoolLoopPlan } | { reason: PoolLoopReason };

class NotPoolLoop extends Error {
  constructor(readonly reason: PoolLoopReason) {
    super(reason);
  }
}

/**
 * Whether the accumulator `sym` is a local variable of the function or
 * block that holds the loop (condition 3). `ancestors` are the nodes from
 * the root of the tree that the lowering walks to the loop. The variable is local when a
 * scope of an ancestor binds it and no `Function` literal is between that
 * ancestor and the loop: a variable of a block outside the function that
 * holds the loop is a variable that the function captures. The parameters
 * of a `Function` literal are declared in the scope of its body block, which
 * is below the literal. When no ancestor binds it, the variable is not
 * local: it can be a variable that a user function captured from the scope
 * where it was defined, which another function that the body calls can
 * read. The body of a user function of the engine that the lowering
 * receives (`definitionBodyExpr()` in `compile-cse.ts`, through
 * `bodyWithParallelHeadsLowered()`) is its body block, the first ancestor,
 * whose scope binds the parameters and the locals of the function. A single
 * statement of a body substituted into its caller has no such ancestor, and
 * its loop runs in order.
 */
function isLocalOfEnclosing(
  sym: Expression,
  ancestors: ReadonlyArray<Expression>
): boolean {
  let crossedFunction = false;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (scopeBinds(node.localScope, sym)) return !crossedFunction;
    if (isFunction(node, 'Function')) crossedFunction = true;
  }
  return false;
}

/**
 * The analysis of the conditions 2 to 6 of the loop as written `loop`, a
 * `ParallelLoop` node, with `ancestors` the nodes from the root of the
 * tree that the lowering walks to it. Condition 2 is checked here for the form of the
 * clause only (one binder that is a symbol, a `Range` domain, no guard);
 * the emitter checks the rest (`notePoolLoopDomain()`). The conditions on
 * the options of the compilation (the mode, condition 3, and
 * `iterationBudget`, condition 8) and condition 7 are checked by
 * `compilePoolLoops()`. `overridesHead` names the heads that the
 * `functions` or `operators` option of the compilation replaces. The
 * compilation of the loop as a function, a `Function` literal, names such
 * a function and does not define it, so a loop whose body, or a user
 * function that it calls, names such a head runs in order
 * (`'not-shippable'`), and the analysis does not look the head up in the
 * engine.
 */
export function analyzePoolLoop(
  loop: Expression,
  ancestors: ReadonlyArray<Expression>,
  overridesHead: (name: string) => boolean = () => false
): PoolLoopAnalysis {
  try {
    return { plan: analyze(loop, ancestors, overridesHead) };
  } catch (e) {
    if (e instanceof NotPoolLoop) return { reason: e.reason };
    throw e;
  }
}

function analyze(
  loop: Expression,
  ancestors: ReadonlyArray<Expression>,
  overridesHead: (name: string) => boolean
): PoolLoopPlan {
  const ce = loop.engine;
  if (!isFunction(loop, 'ParallelLoop') || loop.nops !== 2)
    throw new NotPoolLoop('domain');
  const [body, clause] = loop.ops;
  if (
    !isFunction(clause, 'Element') ||
    clause.nops !== 2 ||
    !isSymbol(clause.op1) ||
    !isFunction(clause.op2, 'Range')
  )
    throw new NotPoolLoop('domain');
  const binder = clause.op1;
  const range = clause.op2;

  // The variables that the passes declare: the bindings of the scope of the
  // loop (its index) and of each scope inside the body.
  const bodyScopes = scopesOf(body);
  if (loop.localScope !== undefined) bodyScopes.add(loop.localScope);
  const isBodyLocal = (sym: Expression) => boundIn(bodyScopes, sym);

  // The accumulators: each outer variable that is the target of a `+=`,
  // with its kind and one of its symbols.
  const accumulators = new Map<
    string,
    { kind: 'number' | 'list'; sym: Expression }
  >();
  // Each outer variable that the body reads: a symbol that appears in the
  // loop as written other than as the target of a `+=` (condition 4 compares
  // these names with the accumulators at the end).
  const outerReads = new Map<string, Expression>();
  const addAccumulator = (
    sym: Expression & { symbol: string },
    kind: 'number' | 'list'
  ) => {
    const known = accumulators.get(sym.symbol);
    if (known !== undefined && known.kind !== kind)
      throw new NotPoolLoop('accumulator-type');
    if (known === undefined) accumulators.set(sym.symbol, { kind, sym });
  };

  const visitedFunctions = new Set<string>();

  // Visit a node of the body. `loops` counts the inner loops around the
  // node, which a `break` or `continue` can leave. `inLiteral` is true
  // inside a `Function` literal written in the body, whose `return` leaves
  // only the literal. `path` holds the local scopes of the nodes from the
  // loop to `e`, outermost first. The name that an `Assign` or a
  // `Declare` writes is not a bound symbol: it is resolved by name in these
  // scopes, innermost first, as the interpreter resolves it.
  const visit = (
    e: Expression,
    loops: number,
    inLiteral: boolean,
    path: ReadonlyArray<Scope>
  ): void => {
    if (isSymbol(e)) {
      if (!isBodyLocal(e)) outerReads.set(e.symbol, e);
      return;
    }
    if (isDictionary(e)) {
      for (const value of e.values) visit(value, loops, inLiteral, path);
      return;
    }
    if (!isFunction(e)) return;
    if (e.localScope !== undefined) path = [...path, e.localScope];
    const next = (x: Expression, innerLoops = loops, literal = inLiteral) =>
      visit(x, innerLoops, literal, path);
    const h = e.operator;
    if (h === 'AddTo' && isLibraryOperator(e, 'AddTo') && e.nops === 2) {
      const [target, value] = e.ops;
      const at = isFunction(target, 'At') ? target : undefined;
      if (isSymbol(target) && !isBodyLocal(target)) {
        if (inLiteral) throw new NotPoolLoop('outer-write');
        addAccumulator(target, 'number');
      } else if (at !== undefined && isSymbol(at.op1) && !isBodyLocal(at.op1)) {
        if (inLiteral) throw new NotPoolLoop('outer-write');
        if (at.nops !== 2) throw new NotPoolLoop('accumulator-type');
        addAccumulator(at.op1, 'list');
        next(at.op2);
      } else next(target);
      next(value);
      return;
    }
    if (h === 'Assign') {
      const [target, ...rest] = e.ops;
      for (const name of assignedNames(target))
        if (!path.some((scope) => scope.bindings.has(name)))
          throw new NotPoolLoop('outer-write');
      if (!isSymbol(target) && !isFunction(target, 'Tuple')) next(target);
      for (const op of rest) next(op);
      return;
    }
    if (h === 'Declare') {
      for (const op of e.ops.slice(1)) next(op);
      return;
    }
    if (h === 'Return' && !inLiteral) throw new NotPoolLoop('jump');
    if ((h === 'Break' || h === 'Continue') && loops === 0 && !inLiteral)
      throw new NotPoolLoop('jump');
    if (h === 'Function') {
      next(e.op1, 0, true);
      return;
    }
    // The head of a call. A head that the `functions` or `operators` option
    // replaces is a function of the host: the compilation of the loop as a
    // function names it and does not define it (condition 7). A library
    // operator, and a function that the body defines, are compiled with the
    // pass. A user function of the engine is emitted as a definition of the
    // code, whose writes are checked (condition 5). Any other head is a
    // function of the program (a function of a block, also one with the
    // name of a function of the engine or of a library operator, a
    // parameter or a variable that holds a function): a function value
    // cannot go to a worker (condition 6).
    if (overridesHead(h)) throw new NotPoolLoop('not-shippable');
    if (
      !isLibraryOperator(e, h) &&
      !path.some((scope) => scope.bindings.has(h))
    ) {
      if (!callsEngineLevel(e)) throw new NotPoolLoop('function-value');
      if (userFunctionLiteral(ce as never, h) !== undefined)
        checkUserFunction(h);
    }
    const isLoop = h === 'Loop' || h === 'ParallelLoop';
    for (const op of e.ops) next(op, isLoop ? loops + 1 : loops);
  };

  // Condition 5 for a user function of the engine that the body calls,
  // and for each one that it calls or names as an operand (`map(h, xs)`):
  // it assigns only its own locals (its parameters, which are declared in
  // the scope of its body block, and the locals of its blocks), resolved by
  // name as in `visit`. A call or a name that a scope of the function binds
  // is checked by the walk itself. Any other one must be bound to the
  // definition of the engine (`callsEngineLevel()`, `isEngineLevel()`),
  // whose function is the one that the loop as a function calls.
  const checkUserFunction = (name: string): void => {
    if (visitedFunctions.has(name)) return;
    visitedFunctions.add(name);
    const literal = userFunctionLiteral(ce as never, name);
    if (literal === undefined) return;
    const walk = (e: Expression, path: ReadonlyArray<Scope>): void => {
      if (isSymbol(e)) {
        const s = e.symbol;
        if (overridesHead(s)) throw new NotPoolLoop('not-shippable');
        if (
          !path.some((scope) => scope.bindings.has(s)) &&
          userFunctionLiteral(ce as never, s) !== undefined
        ) {
          if (!isEngineLevel(e)) throw new NotPoolLoop('function-value');
          checkUserFunction(s);
        }
        return;
      }
      if (isDictionary(e)) for (const value of e.values) walk(value, path);
      if (!isFunction(e)) return;
      if (e.localScope !== undefined) path = [...path, e.localScope];
      if (e.operator === 'Assign' || e.operator === 'AddTo') {
        for (const target of assignedNames(e.op1))
          if (!path.some((scope) => scope.bindings.has(target)))
            throw new NotPoolLoop('outer-write');
      }
      const h = e.operator;
      if (overridesHead(h)) throw new NotPoolLoop('not-shippable');
      // A node that is bound to no definition (`Typed`) is not a call. A
      // call whose head is bound to a value definition (a symbol that holds
      // a function) is a call of a function value, which
      // `callsEngineLevel()` refuses.
      if (
        (e.operatorDefinition !== undefined ||
          e.valueDefinition !== undefined) &&
        !isLibraryOperator(e, h) &&
        !path.some((scope) => scope.bindings.has(h))
      ) {
        if (!callsEngineLevel(e)) throw new NotPoolLoop('function-value');
        if (userFunctionLiteral(ce as never, h) !== undefined)
          checkUserFunction(h);
      }
      for (const op of e.ops) walk(op, path);
    };
    walk(literal, []);
  };

  visit(body, 0, false, loop.localScope ? [loop.localScope] : []);

  // Condition 4: the name of an accumulator appears only as the target of a
  // `+=`. A read of the same name by a node of the loop that is not in the
  // body (the bounds of the range) is a read too.
  for (const op of range.ops)
    for (const name of op.symbols)
      if (accumulators.has(name)) throw new NotPoolLoop('accumulator-read');
  for (const name of accumulators.keys())
    if (outerReads.has(name)) throw new NotPoolLoop('accumulator-read');

  // Condition 3: each accumulator is a local of the function or block that
  // holds the loop, and a number or a list of numbers.
  for (const { kind, sym } of accumulators.values()) {
    if (!isLocalOfEnclosing(sym, ancestors))
      throw new NotPoolLoop('accumulator-scope');
    const type = sym.valueDefinition?.type ?? sym.type;
    if (
      kind === 'number'
        ? !isMachineNumber(type.type)
        : !isMachineNumberList(type.type)
    )
      throw new NotPoolLoop('accumulator-type');
  }

  // Condition 6: the outer variables that the body reads. A variable of the
  // engine that has a value (a constant, an assigned variable) is compiled
  // the same way in the program and in the loop as a function, and is not a
  // parameter. Every other one (a local or a parameter of the program, an
  // input of the program) is a parameter of the loop as a function.
  const outer: { name: string; type: string }[] = [];
  for (const [name, sym] of outerReads) {
    const def = sym.valueDefinition;
    const type = def?.type ?? sym.type;
    if (type.matches('function') || isFunction(def?.value, 'Function'))
      throw new NotPoolLoop('function-value');
    if (isEngineLevel(sym) && (def?.isConstant || def?.value !== undefined))
      continue;
    if (!isDataType(type)) throw new NotPoolLoop('outer-type');
    outer.push({ name, type: type.toString() });
  }

  const accs = [...accumulators].map(([name, { kind }]) => ({ name, kind }));
  return {
    accumulators: accs,
    outer,
    function: poolLoopFunction(
      loop,
      body,
      binder.symbol,
      range.ops,
      accs,
      accumulators,
      outer
    ),
  };
}

/** The names of the variables that the target of an `Assign` or an
 * `AddTo` writes: a symbol, the symbols of a `Tuple` pattern, or the list
 * of an `At`. */
function assignedNames(target: Expression): string[] {
  if (isSymbol(target)) return [target.symbol];
  if (isFunction(target, 'Tuple')) return target.ops.flatMap(assignedNames);
  if (isFunction(target, 'At')) return assignedNames(target.op1);
  return [];
}

/** The type that the loop as a function declares for a value of type `t`
 * (see `laneTypeOf()`). */
function laneType(t: BoxedType): string {
  return laneTypeOf(t.type);
}

/** The widest type of the real lane for a value of type `t`: `integer`
 * for an integer, `real` for another real number, `number` otherwise. */
function laneTypeOf(t: Type): string {
  if (isSubtype(t, 'integer')) return 'integer';
  if (isSubtype(t, 'real')) return 'real';
  return 'number';
}

/**
 * The loop as a function: a `Function` literal of the parameters, in this
 * order:
 *
 * 1. the first value of the range (`a`) and its step (`s`);
 * 2. the first and the last pass index of a sub-range, both included
 *    (pass `i` of the whole range, from 0);
 * 3. the outer variables that the body reads, in the order of `outer`, each
 *    with its static type;
 * 4. the length of each list accumulator, in the order of `accumulators`.
 *
 * The body declares each accumulator as a local set to zero (a number, or a
 * list of zeros of the given length), runs the passes of the sub-range, and
 * gives the list of the accumulators in the order of `accumulators` (a
 * list accumulator as a new list of its elements, see below). Pass
 * `i` declares the index of the loop as `a + s * i`, the expression of the
 * counted loop of the program (`compileCountedRange()` in
 * `compile-loops.ts`), so that a sub-range gives exactly the index values of
 * the same passes of the whole range, for a negative step and for bounds
 * that are not integers too. The passes are a counted loop over the integer
 * range of pass indices, with a step of 1, so an empty sub-range (the last
 * index before the first) runs no pass.
 *
 * The body of the loop is copied as MathJSON and boxed again inside the
 * literal: its outer variables then bind to the parameters, and its `+=`
 * on an accumulator to the local of the literal.
 */
function poolLoopFunction(
  loop: Expression,
  body: Expression,
  binder: string,
  rangeOps: ReadonlyArray<Expression>,
  accs: ReadonlyArray<PoolAccumulator>,
  accumulators: ReadonlyMap<
    string,
    { kind: 'number' | 'list'; sym: Expression }
  >,
  outer: ReadonlyArray<{ name: string; type: string }>
): Expression {
  const ce = loop.engine;
  // The names of the parameters and locals that the literal adds: each one
  // differs from every name of the loop.
  const taken = new Set<string>([
    ...loop.symbols,
    ...outer.map((v) => v.name),
    ...accs.map((a) => a.name),
  ]);
  const fresh = (base: string): string => {
    let name = base;
    for (let n = 1; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    return name;
  };
  const first = fresh('poolFirst');
  const step = fresh('poolStep');
  const from = fresh('poolFrom');
  const to = fresh('poolTo');
  const pass = fresh('poolPass');
  const lengths = new Map<string, string>();
  for (const a of accs)
    if (a.kind === 'list') lengths.set(a.name, fresh(`poolLength${a.name}`));

  const [lo, , stepExpr] = rangeOps;
  const firstType = laneType(lo.type);
  const stepType = stepExpr === undefined ? 'integer' : laneType(stepExpr.type);
  const indexType =
    firstType === 'integer' && stepType === 'integer' ? 'integer' : 'real';

  const typed = (name: string, type: string) => ['Typed', name, `'${type}'`];
  // A local declared with its type and its value (the form of `let`).
  const declare = (name: string, type: string, value: unknown) => [
    'Declare',
    name,
    `'${type}'`,
    ['Dictionary', ['KeyValuePair', "'value'", value]],
  ];
  const declarations: unknown[] = [];
  for (const a of accs) {
    const sym = accumulators.get(a.name)!.sym;
    const type = (sym.valueDefinition?.type ?? sym.type).type;
    if (a.kind === 'number')
      declarations.push(declare(a.name, laneTypeOf(type), 0));
    else
      declarations.push(
        declare(
          a.name,
          `list<${laneTypeOf(typeof type === 'object' && type.kind === 'list' ? type.elements : type)}>`,
          [
            'Comprehension',
            0,
            [
              'Element',
              fresh('poolElement'),
              ['Range', 1, lengths.get(a.name)!, 1],
            ],
          ]
        )
      );
  }
  const passes = [
    'Loop',
    [
      'Block',
      declare(binder, indexType, ['Add', first, ['Multiply', step, pass]]),
      body.json,
    ],
    ['Element', pass, ['Range', from, to, 1]],
  ];
  // The value of the literal. A list accumulator is given as a list of its
  // elements, read one by one: the in-place update of a local
  // (`ownedLocalUpdateChains()` in `in-place-update.ts`) accepts a read of
  // an element, and refuses the bare name as an operand of `List`, which
  // would make every pass copy the list.
  const results = accs.map((a) => {
    if (a.kind === 'number') return a.name;
    const j = fresh('poolElement');
    return [
      'Comprehension',
      ['At', a.name, j],
      ['Element', j, ['Range', 1, ['Length', a.name], 1]],
    ];
  });
  const json = [
    'Function',
    ['Block', ...declarations, passes, ['List', ...results]],
    typed(first, firstType),
    typed(step, stepType),
    typed(from, 'integer'),
    typed(to, 'integer'),
    ...outer.map((v) => typed(v.name, v.type)),
    ...accs
      .filter((a) => a.kind === 'list')
      .map((a) => typed(lengths.get(a.name)!, 'integer')),
  ];
  return ce.box(json as never);
}

/**
 * The records of the loops of `collection`, the loops that one compilation
 * emitted, in the order in which the emitter met them, or `undefined` when
 * it met none. For each loop that passes the conditions 2 to 6 and 8, the
 * loop as a function is compiled with `compile`, which the JavaScript
 * target gives (its own `compile()` with the options of the program); a
 * compilation that declines, whose code reads the object of variables
 * (`readsVarsObject`), or whose code is not shippable (condition 7: a random
 * draw, an identifier of the host with `hostNames`, a value kind) keeps the
 * loop in order. The functions are compiled after the emission of the
 * program ends, so this compilation does not change the state that the
 * compiler keeps for the emission (its temporary names, its table of user
 * functions). No collection is open while they compile: a `parallel for`
 * inside a pass runs in order there.
 */
export function compilePoolLoops(
  collection: PoolLoopCollection | undefined,
  options: CompilationOptions<Expression>,
  hostNames: boolean,
  compile: (
    expr: Expression,
    options: CompilationOptions<Expression>
  ) => CompilationResult<'javascript'>,
  readsVarsObject: (code: string) => boolean
): ParallelLoopRecord[] | undefined {
  if (collection === undefined || collection.loops.size === 0) return undefined;
  const records: ParallelLoopRecord[] = [];
  suppressed++;
  try {
    for (const { origin, counted } of collection.loops.values())
      records.push(
        poolLoopRecord(
          origin,
          counted,
          options,
          hostNames,
          compile,
          readsVarsObject
        )
      );
  } finally {
    suppressed--;
  }
  return records;
}

function poolLoopRecord(
  origin: LoopOrigin,
  counted: boolean,
  options: CompilationOptions<Expression>,
  hostNames: boolean,
  compile: (
    expr: Expression,
    options: CompilationOptions<Expression>
  ) => CompilationResult<'javascript'>,
  readsVarsObject: (code: string) => boolean
): ParallelLoopRecord {
  const inOrder = (reason: PoolLoopReason): ParallelLoopRecord => ({
    route: 'in-order',
    reason,
  });
  if (!counted) return inOrder('domain');
  if (options.mode === 'complex' || options.mode === 'bigint')
    return inOrder('mode');
  // No condition makes the compilation of the program decline: an error of
  // the analysis or of the building of the loop as a function (`ce.box()`,
  // the check of the captured types of a user function) keeps the loop in
  // order. A cancellation of the caller (an abort, an iteration or
  // recursion limit, an expired enclosing time limit) is thrown again.
  const ce = origin.loop.engine;
  let analysis: PoolLoopAnalysis;
  try {
    analysis = analyzePoolLoop(
      origin.loop,
      origin.ancestors,
      overriddenHeadPredicate(options.operators, options.functions) ??
        (() => false)
    );
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return inOrder('function-declined');
  }
  if ('reason' in analysis) return inOrder(analysis.reason);
  if (options.iterationBudget !== undefined) return inOrder('iteration-budget');
  const { plan } = analysis;
  // The outer variables are parameters of the literal: a `vars` entry of the
  // same name would replace the parameter.
  let vars = options.vars;
  if (vars !== undefined) {
    vars = { ...vars };
    for (const v of plan.outer) delete vars[v.name];
  }
  let fn: CompilationResult<'javascript'>;
  try {
    fn = compile(plan.function, {
      ...options,
      vars,
      fallback: false,
      broadcast: false,
    });
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return inOrder('function-declined');
  }
  if (!fn.success || fn.calling !== 'lambda')
    return inOrder('function-declined');
  const text = [fn.preambleOnce ?? '', fn.preamble ?? '', fn.code].join('\n');
  if (readsVarsObject(text)) return inOrder('function-declined');
  if (hostNames || fn.valueKinds !== undefined || !isShippableCode(text))
    return inOrder('not-shippable');
  return {
    route: 'pool',
    fn,
    outer: plan.outer.map((v) => v.name),
    accumulators: plan.accumulators,
  };
}
