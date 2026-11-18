// Reference analysis of a compilation unit, free symbol types, reports, and
// the interpreter fallback.

import type { Expression, FunctionInterface, Scope } from '../global-types.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { isTupleShapedType } from '../collection-utils.js';
import { isNonRealNumber, narrow } from '../../common/type/utils.js';
import { loweredKindType } from './kind-lowering.js';
import { declaredTypeText } from './type-facts.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isString,
  isFunction,
  isAbsentSymbol,
  isDictionary,
  isFreeName,
} from '../boxed-expression/type-guards.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import {
  freeAnonymousSlots,
  functionLiteralBoundNames,
} from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import { STATIC_TYPE_ERROR_CODE } from './compile-static-type-error.js';
import {
  UNION_DISPATCH_CODE,
  UNSETTLED_SHAPE_CODE,
  UNTYPED_INPUT_CODE,
} from './diagnostics.js';
import { interpreterRun } from './interpreter-fallback.js';
import { storageHintsOf } from './storage-hints.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import { protocolOfSymbol } from '../engine-protocols.js';
import { planProtocolDispatch } from './protocol-dispatch.js';
import { buildCaseClosure } from '../boxed-expression/match-dispatch.js';
import { matchPatternReferences } from '../boxed-expression/pattern-utils.js';
import type {
  CompileDiagnostic,
  CompileTarget,
  CompilationResult,
  FreeSymbolType,
  StorageKind,
  TargetSource,
} from './types.js';
import {
  builtinCallbackArity,
  isHostOperatorCallback,
  isRefusableBuiltinCallback,
} from './builtin-callback.js';
import { OPERAND_READ, UNREADABLE_OPERAND } from './compile-locals.js';
import {
  appliedDerivativeLiteral,
  appliedDerivativeTooLarge,
  literalDeclaredParamTypes,
} from './compile-callbacks.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { bindsFoldedValue, expandedFoldSize } from './compile-folded-values.js';
import { foldValueCaptured } from './compile-folding.js';
import {
  CONTROL_FLOW_HEADS,
  MAX_FOLD_EXPANDED_NODES,
  OVERRIDABLE_CONTROL_FLOW_HEADS,
  STRUCTURAL_HEADS,
} from './compiler-tables.js';
import { jetDerivativeLowering } from './compile-cse.js';
import {
  compileValueOperand,
  statementListDeclaredVarTypes,
} from './compile-statements.js';
import { operandTypeInContext } from './compile-user-calls.js';
import {
  fieldArgsWithDeclaredReceiver,
  protocolCallParts,
} from './compile-protocol-dispatch.js';
import { declareValueOperand } from './compile-declarations.js';
import { core } from './compiler-core-hooks.js';
import { CompilerState } from './compiler-state.js';
import { implicitIntegrationVariable } from '../boxed-expression/integration-variables.js';
import { bodyWithParallelHeadsLowered } from './parallel-lowering.js';

/**
 * Analyze — without compiling, and never throwing — which external references
 * the generated code for `expr` would have on `target`:
 *
 * - `freeSymbols`: identifiers the caller must supply at run time. These are
 *   the free symbols *as codegen sees them*: symbols with no value in the
 *   engine, after descending into the values of folded (assigned / constant)
 *   symbols — so `a = b + 1` surfaces `b`, which `expr.unknowns` misses — and
 *   after excluding bound variables (lambda parameters, indices of
 *   `Sum`/`Product`/`Integrate`/`Loop`, `Block` locals). A `vars`-mapped
 *   symbol is always included: the mapping makes it an external input even
 *   when it also has an assigned value.
 *
 * - `unsupported`: operator heads with no operator/function mapping in the
 *   target and not one of the structural forms above.
 *
 * Lets a caller validate that a compiled result is self-contained
 * (`freeSymbols` covered by its inputs, `unsupported` empty) declaratively,
 * instead of executing or GPU-compiling the code to discover a dangling
 * reference or an unlowerable operator.
 *
 * When `occurrences` is given, the walk records in it, for each free
 * symbol, its first FREE occurrence in `expr` itself: an occurrence that no
 * enclosing binder (a parameter, an index, a local) shadows, and that is
 * not inside a folded symbol value or a user-function body. A bound
 * occurrence of the same name (the index `q` of `Sum(q, Limits(q, 1, n))`
 * beside a free `q`) is a different variable, with its own type.
 */
export function analyzeReferences(
  expr: Expression,
  target: CompileTarget<Expression>,
  varsKeys?: ReadonlySet<string>,
  occurrences?: Map<string, Expression>
): { freeSymbols: string[]; unsupported: string[] } {
  const engine = expr.engine;
  const free = new Set<string>();
  // Greater than zero while the walk is inside a folded symbol value or a
  // function-literal body: an occurrence there is not an occurrence in
  // `expr`, so it is not recorded in `occurrences`.
  let indirectDepth = 0;
  // The symbols that are the target of an `Assign`. Such a symbol is not
  // read, and it has no type of its own (the target of `u ≔ u + 1` is
  // `unknown` where the read `u` is `complex`), so a read of the same name
  // that the walk meets later replaces it in `occurrences`.
  const assignTargets = new Set<Expression>();
  // The `Assign` whose target the walk visits now, when the target is a
  // name or a `Tuple` of names.
  let writing: Expression | undefined;
  // The names of the variables of the indefinite integrals and of the `D`
  // nodes met so far. The walk reports such a variable free (the code reads
  // the input of that name), but its occurrences in the integral or the
  // `D` are the variable of the binder: their type is not a requirement on
  // the input. An occurrence of
  // such a name is not recorded for the type of the input
  // (`noteTypedOccurrence()`), in the integral or after it: the input then
  // has the type of its first occurrence in `expr`.
  const binderInputNames = new Set<string>();
  const addFree = (e: Expression & { symbol: string }): void => {
    // The placeholder `_` of a destructuring target (`(a, _) ≔ v`) is not
    // a name: the statement writes nothing there, and the code does not
    // read an input `_`.
    if (writing !== undefined && e.symbol === '_') return;
    free.add(e.symbol);
    if (occurrences === undefined) return;
    if (!assignTargets.has(e) && !binderInputNames.has(e.symbol))
      noteTypedOccurrence(occurrences, e);
    if (indirectDepth !== 0) return;
    const recorded = occurrences.get(e.symbol);
    if (
      recorded === undefined ||
      (assignTargets.has(recorded) && !assignTargets.has(e))
    )
      occurrences.set(e.symbol, e);
  };
  const unsupported = new Set<string>();
  // Guard against a symbol whose value (transitively) references itself.
  const foldedSeen = new Set<string>();
  // The names in scope where a BOUND folded value is emitted: none, except
  // on the `Function`-literal route, where the preamble sits inside the
  // lambda body and the lambda's own parameters are visible there
  // (`userFunctions.valueRoot`). Mirrors the emitter so the analysis and
  // the generated code agree about which names are external inputs.
  const valueBound: ReadonlySet<string> = new Set(
    isFunction(expr, 'Function')
      ? functionLiteralBoundNames(expr.ops.slice(1))
      : []
  );
  // Guard against a (mutually) recursive user-defined function body.
  const userFnSeen = new Set<string>();

  const union = (a: ReadonlySet<string>, more: string[]): Set<string> => {
    const s = new Set(a);
    for (const m of more) s.add(m);
    return s;
  };

  // The declared parameter types of the literal body currently being
  // walked — the analysis-side mirror of `CompileTarget.declaredVarTypes`,
  // so probes that read a raw (never-bound) symbol (the protocol SET root)
  // resolve the same static type the compile path does. Replaced (not
  // stacked) per body, matching `prepareUserFunctionBody`.
  let declaredTypes: Readonly<Record<string, Type>> | undefined =
    target.declaredVarTypes;

  // The names bound where a function that the code calls by name is
  // emitted: none (see `visitDefinitionBody`).
  const noBoundNames: ReadonlySet<string> = new Set();

  // An expression is a DAG, not a tree: one sub-expression object can be an
  // operand of many parents. A caller that substitutes helper bodies into a
  // published value builds exactly that — Tycho's terrain document holds a
  // height map as a four-level chain of list helpers whose bodies each read
  // their parameter a dozen times, so every level shares its argument a
  // dozen times and the value has 236,663 distinct nodes but 2.5e10 nodes
  // when walked as a tree (corpus document `nxlddeh5zv`, 2026-09-16; the
  // walk ran the process out of memory at every terrain size).
  //
  // What the walk contributes for a node depends only on the node, on the
  // names bound around it and on the declared-type frame, and it only ever
  // ADDS to `free`, `unsupported` and the seen sets. So a second visit of
  // the same node under the same frame adds nothing, and the walk can skip
  // it. Each node remembers the frames it was visited under; a frame key is
  // the sorted bound names plus the identity of the declared-type frame
  // (the frame is replaced, never mutated, so identity is a sound key).
  const visitedFrames = new Map<Expression, Set<string>>();
  const boundKeys = new WeakMap<ReadonlySet<string>, string>();
  // Greater than zero while the walk is inside a symbol value the compile
  // refuses to bake in (`assertFoldableSize`). The compile never reaches a
  // node of such a value, so the walk must not run a caller's `compile`
  // handler on one either: a handler is free to read an operand's `.json`
  // (Tycho's `Which` handler does), and on a shared value that serializes
  // a sub-DAG as a tree — the height map above serialized to more than
  // the heap at every terrain size. Inside such a value a head that has a
  // handler is taken as lowerable without asking.
  let oversizedValueDepth = 0;
  const declaredFrameIds = new WeakMap<object, number>();
  let nextDeclaredFrameId = 1;
  const frameKey = (bound: ReadonlySet<string>): string => {
    let key = boundKeys.get(bound);
    if (key === undefined) {
      key = [...bound].sort().join(',');
      boundKeys.set(bound, key);
    }
    let frameId = 0;
    if (declaredTypes !== undefined) {
      frameId = declaredFrameIds.get(declaredTypes) ?? 0;
      if (frameId === 0) {
        frameId = nextDeclaredFrameId++;
        declaredFrameIds.set(declaredTypes, frameId);
      }
    }
    // The probe suppression inside an oversized value is part of the frame:
    // a node met there is taken as lowerable without a probe, so meeting the
    // same node again outside such a value must probe it.
    return `${oversizedValueDepth > 0 ? 'o' : ''}${frameId}|${key}`;
  };
  /** True when `e` was already walked under the current frame; records the
   * visit otherwise.
   *
   * When `occurrences` is recorded, a DIRECT visit (not inside a folded
   * symbol value or a function-literal body) adds to it and an indirect
   * visit does not. So a node that was visited only indirectly must be
   * visited again when the walk meets it directly: with `a := q + 1`, the
   * walk of `[a, q + 1]` meets the shared node `q + 1` first in the value
   * of `a`, and the occurrence of `q` is recorded only at the second,
   * direct, visit. A direct visit adds all that an indirect visit adds, so
   * an indirect visit after a direct visit is skipped. */
  const alreadyVisited = (e: Expression, bound: ReadonlySet<string>) => {
    const key = frameKey(bound);
    const directKey = `${key}|d`;
    const direct = occurrences !== undefined && indirectDepth === 0;
    let frames = visitedFrames.get(e);
    if (frames === undefined) {
      frames = new Set();
      visitedFrames.set(e, frames);
    }
    if (frames.has(directKey)) return true;
    if (!direct && frames.has(key)) return true;
    frames.add(direct ? directKey : key);
    return false;
  };

  /** Visit a function literal's body with its parameters bound and its
   * declared-type frame installed. */
  const visitLiteralBody = (
    literal: Expression & FunctionInterface,
    bound: ReadonlySet<string>
  ): void => {
    // A destructuring parameter binds its LEAF names, not a name of its own,
    // so `functionLiteralBoundNames` (not `functionLiteralParameterName`) is
    // what shadows them here: analysed as unbound, the leaves would read as
    // free ambient symbols of the enclosing scope.
    const params = functionLiteralBoundNames(literal.ops.slice(1));
    const saved = declaredTypes;
    declaredTypes = literalDeclaredParamTypes(literal);
    indirectDepth++;
    try {
      // The body as the emission compiles it: on JavaScript, a body that
      // the engine defines has its `parallel for` heads and `+=` lowered
      // (`bodyWithParallelHeadsLowered()`). A body that is not lowered (the
      // lowering threw, or the target is not JavaScript) keeps its
      // `ParallelLoop` and `ParallelComprehension` heads, whose clauses the
      // walk binds as those of `Loop` and `Comprehension`.
      let body = literal.ops[0];
      try {
        body = bodyWithParallelHeadsLowered(body, target);
      } catch {
        // The lowering throws for a body that the emission declines (a
        // position with an effect in `L[random(1..9)] += 1`): the analysis
        // then visits the body as it is, and does not throw.
      }
      visit(body, params.length ? union(bound, params) : bound);
    } finally {
      declaredTypes = saved;
      indirectDepth--;
    }
  };

  /** Visit the body of a function that the code calls BY NAME: a user
   * function of the engine, a clause of a multi-clause function, an
   * implementation of a protocol member.
   *
   * Such a function is emitted once, in the preamble, outside every binder
   * of the expression: `prepareUserFunctionBody()` compiles its body
   * against the root target of the compilation (`userFunctions.root`), with
   * only its own parameters bound. A name that a binder around the CALL
   * binds (a `Block` local, a parameter of an enclosing function literal,
   * the index of a `Sum`) is therefore not bound in the body. A free name
   * of the body is an input of the code, also when a binder around the
   * call has the same name.
   *
   * With `ok(c) := 1 / c ≥ minR`, the code of
   * `Block(Declare(minR, {value: 0.008}), ok(4))` is the helper
   * `_fn_ok = (c) => _.minR <= 1 / c` and the body
   * `let minR = 0.008; return _fn_ok(4)`: the helper reads the input
   * `minR`, not the local. When the body was visited with the names of the
   * call site bound, `freeSymbols` did not have `minR`, and an undeclared
   * `minR` was not declined as an untyped input, where the same call
   * outside the `Block` reported it and declined. The first visit of a
   * body is also the only one (`userFnSeen`), so a call inside such a
   * binder hid the name for a later call outside it. */
  const visitDefinitionBody = (literal: Expression & FunctionInterface): void =>
    visitLiteralBody(literal, noBoundNames);

  /** The receiver type a dispatch probe should use — the expression's own
   * static type, falling back to the current body's declared parameter
   * type for a raw symbol (the same fallback `tryCompileProtocolDispatch`
   * applies). */
  const probeReceiverType = (r: Expression | undefined): Type | undefined => {
    if (r === undefined) return undefined;
    let t = r.type.type;
    if ((t === 'unknown' || t === 'any') && isSymbol(r)) {
      const declared = declaredTypes?.[r.symbol];
      if (declared !== undefined) t = declared;
    }
    return t;
  };

  /** Can the protocol dispatch tier run on this target at all? */
  const jsProtocolTarget = (): boolean =>
    target.language === 'javascript' &&
    target.userFunctions !== undefined &&
    target.userFunctions.lowering === undefined;

  /** Descend into a dispatch plan's implementation bodies, once per
   * DISPATCH IDENTITY (protocol restriction + impl key — never the
   * syntactic head, which `ProtocolMember`/`Field` share across members). */
  const visitProtocolPlan = (
    key: string,
    plan: NonNullable<ReturnType<typeof planProtocolDispatch>>
  ): void => {
    if (userFnSeen.has(`protocol:${key}`)) return;
    userFnSeen.add(`protocol:${key}`);
    for (const c of plan.candidates) {
      // The CANONICAL literal — the body the dispatch tier compiles (the
      // raw one still carries `Typed` ascription nodes).
      const literal = c.literal.canonical;
      if (!isFunction(literal, 'Function')) continue;
      visitDefinitionBody(literal);
    }
  };

  // The local scopes of the nodes that the walk is inside, innermost last.
  // A raw `Match` case body is canonicalized in the innermost one, as the
  // compiled code does (`inCompiledScope()` in `compile-match.ts`).
  const scopes: Scope[] = [];
  const visit = (e: Expression, bound: ReadonlySet<string>): void => {
    const scope = isFunction(e) ? e.localScope : undefined;
    if (scope === undefined) return visitNode(e, bound);
    scopes.push(scope);
    try {
      visitNode(e, bound);
    } finally {
      scopes.pop();
    }
  };
  // The canonical form of a raw `Match` case body or guard, made as the
  // compiled code makes it (`compileMatchBody()` in `compile-match.ts`):
  // in the innermost local scope, and, when the case captures names, as
  // the body of a function literal whose parameters are the captures. A
  // name that the body assigns is then a local of the scope of that body,
  // as in the compiled code and in the interpreter. In the raw body it
  // was an input: in `Match(x, 1 -> Map(L, v ↦ Block(q ≔ 2v, q)), …)`,
  // `q` was reported as a free symbol with the type `unknown`.
  const canonicalCasePart = (
    part: Expression,
    captures: readonly string[]
  ): Expression => {
    const inner = scopes[scopes.length - 1];
    const inScope = <T>(f: () => T): T =>
      inner === undefined ? f() : engine._inScope(inner, f);
    try {
      if (captures.length === 0) return inScope(() => part.canonical);
      const closure = inScope(() => buildCaseClosure(engine, part, captures));
      return isFunction(closure, 'Function') ? closure.ops[0] : part;
    } catch {
      return part;
    }
  };
  const visitNode = (e: Expression, bound: ReadonlySet<string>): void => {
    // Symbols are not memoized: a symbol is cheap to visit, and every
    // repeated symbol visit hangs off a repeated function node, which is.
    if (isFunction(e) && alreadyVisited(e, bound)) return;
    if (isSymbol(e)) {
      const s = e.symbol;
      if (bound.has(s)) return;
      // An operator used as a value (e.g. compiling a bare `Add`) is lowered
      // to a lambda, not a free input.
      if (target.operators?.(s) !== undefined) return;
      // A `vars`-mapped symbol is an external input the caller supplies; the
      // mapping always wins (see `CompileTarget.vars`) — checked before the
      // user-function lowering so a `vars` key that shadows a user-function
      // name stays an external input, consistent with the value-position
      // codegen in `compile`.
      if (varsKeys?.has(s)) {
        addFree(e);
        return;
      }
      // A bare symbol naming a user-defined function, used in value position
      // (a higher-order operand like `Map(f, list)`), is lowered to the
      // shared emitted local `_fn_f` — not a free input. Descend into its
      // body (parameters bound) to surface transitively referenced free
      // symbols; guard against recursion. Mirrors the value-position codegen
      // in `compile` and the head-position handling below. (A bound name is
      // already handled by the `bound.has(s)` guard above.)
      if (target.userFunctions !== undefined) {
        const symLiteral = userFunctionLiteral(engine, s);
        if (symLiteral !== undefined) {
          if (!userFnSeen.has(s)) {
            userFnSeen.add(s);
            visitDefinitionBody(symLiteral);
          }
          return;
        }
        // Likewise a bare BUILT-IN operator symbol in value position: the
        // codegen eta-expands it into the shared local `_fn_Sin`
        // (`ensureBuiltinCallbackEmitted`), so the artifact needs no input
        // for it. Its wrapper body references nothing but its parameters.
        if (builtinCallbackArity(engine, s) !== undefined) return;
        // A built-in that does not eta-expand (`LCM`, which is variadic),
        // and an operator the host declared, are refused in value
        // position when the code reads them, or emitted as a callback:
        // neither is an input the caller supplies. A fold that consumes
        // the name (`Reduce(1..20, LCM, 1)` folds to `232792560`) reads
        // no input either. Before, the name was reported as a free
        // symbol ("LCM: no value"). CE-232.2.
        if (
          isRefusableBuiltinCallback(engine, s) ||
          isHostOperatorCallback(engine, s)
        )
          return;
      }
      // A symbol with a value (assigned, or a constant like `Pi`) is folded
      // into the code; descend into the value to surface any transitively
      // referenced free symbols.
      const value = engine._getSymbolValue(s);
      if (value !== undefined) {
        if (!foldedSeen.has(s)) {
          foldedSeen.add(s);
          // A value the emitter BINDS as a preamble local is written
          // outside every enclosing parameter and index, so its names are
          // read there and a name an enclosing binder happens to spell is
          // still an external input (ruled 2026-09-21; see
          // `bindsFoldedValue`). With `a := 3t + 1` and `g := t ↦ t + a`,
          // compiling `g(2)` emits `const _val_a = 3 * _.t + 1`, so `t` is
          // an input the caller must supply. A value folded INLINE keeps
          // the enclosing names, which is where it is written.
          const inner =
            bindsFoldedValue(target, value) ||
            foldValueCaptured(value, bound, valueBound)
              ? valueBound
              : bound;
          // Sized with sharing, as the fold guard sizes it, so the check
          // itself stays linear in the value's distinct nodes.
          const oversized =
            isFunction(value) &&
            expandedFoldSize(engine, value, target) > MAX_FOLD_EXPANDED_NODES;
          if (oversized) oversizedValueDepth++;
          indirectDepth++;
          try {
            visit(value, inner);
          } finally {
            if (oversized) oversizedValueDepth--;
            indirectDepth--;
          }
        }
        return;
      }
      // A constant the target bakes into the emitted code is not an input
      // the caller has to supply. Most constants never reach here — the
      // engine holds a value for `Pi` and friends, so the fold above claims
      // them — but one the engine has no value for does, and on the
      // JavaScript target the boolean literals `True`/`False` are exactly
      // that, so `Which(x > 0, 1, True, 2)` used to report a phantom input
      // named `True`.
      //
      // This must be `constant`, never `var`: `var` is the general variable
      // emitter and falls back to a vars-object reference (`_.x`) for any
      // symbol it does not recognize, so testing it here would suppress
      // EVERY free symbol. Which constants exist is per-target — only the
      // JavaScript target inlines the booleans — so the answer has to come
      // from the target rather than from a fixed list here.
      if (target.constant?.(s) !== undefined) return;
      // A WRITTEN absence symbol is a value the emitter spells out — the
      // target's object null, or its numeric marker where there is no object
      // axis (2026-09-22, see the absence-symbol branch of `_compileInner`).
      // Nothing binds it at run time, so it is not an input the caller has
      // to supply. A BOUND name or a `vars` key spelled `Missing` is a
      // genuine variable and was claimed above.
      if (isAbsentSymbol(e)) return;
      // The symbol `Nothing` is not an input either. In a value position
      // the compilation declines (`nothingOperandDecline()`, the symbol
      // branch of `_compileInner`), and in a statement position (the `else`
      // branch of `If(k > 2, Break(), Nothing)`, a statement of a block) the
      // emitter drops it, so no emitted code reads a variable of that name.
      // Reported as free, a host that checks each free symbol against its
      // inputs read it as an input with no value (Tycho row 506). A BOUND
      // name or a `vars` key spelled `Nothing` is a genuine variable and was
      // claimed above.
      if (isSymbol(e, 'Nothing')) return;
      // No mapping, no value, not a constant: a genuinely free symbol.
      addFree(e);
      return;
    }

    // The values of a dictionary literal are not operands (`ops`), but the
    // compiled literal reads each of them, so their names are read too.
    if (isDictionary(e)) {
      for (const value of e.values) visit(value, bound);
      return;
    }

    if (!isFunction(e)) return; // numbers, strings: nothing to collect

    // Capture `ops`/`h` up front: narrowing `e` with `isFunction(e, 'X')`
    // below would otherwise strip `.ops` from `e` in the fall-through.
    const h = e.operator;
    const ops: ReadonlyArray<Expression> = e.ops;
    if (h === 'Assign' && isSymbol(ops[0])) assignTargets.add(ops[0]);

    // The two compile-path protocol intercepts that do NOT key on the head
    // alone — mirrored here, or their operands are analyzed as ordinary
    // expressions (listing `Field` as unsupported on a compilable SET, or
    // descending into a getter where the compile path emits a setter).
    //
    // Resolve small derivative callees with the same limit as the interval
    // and shader emitters. Other nonliteral callees are not compiled, so do
    // not probe their handlers: that could expand a derivative the target
    // rejects.
    if (
      h === 'Apply' &&
      target.appliesFunctionLiteralsOnly === true &&
      !isFunction(ops[0], 'Function')
    ) {
      const literal = appliedDerivativeLiteral(ops, {
        exactFactors: target.language === 'interval-javascript',
      });
      if (isFunction(literal, 'Function') && literal.nops === ops.length) {
        visitLiteralBody(literal, bound);
        for (const op of ops.slice(1)) visit(op, bound);
        return;
      }
      unsupported.add('Apply');
      // A SYMBOL callee is still reported: naming it costs a symbol lookup
      // and it is what tells the caller which function it could not lower.
      // Anything else — a `Derivative` node above all — is left alone.
      if (isSymbol(ops[0])) visit(ops[0], bound);
      for (const op of ops.slice(1)) visit(op, bound);
      return;
    }

    // A multi-index derivative, or a derivative applied to more than one
    // argument, whose closed form is too large to write out
    // (`appliedDerivativeTooLarge`). Every target declines it without
    // computing that closed form, so the `Derivative` head's compile
    // handler must not be probed here: the probe computes the closed form,
    // which can take tens of seconds.
    if (
      h === 'Apply' &&
      isFunction(ops[0], 'Derivative') &&
      (ops[0].ops.length > 2 || ops.length > 2) &&
      appliedDerivativeTooLarge(ops)
    ) {
      unsupported.add('Apply');
      for (const op of ops.slice(1)) visit(op, bound);
      return;
    }

    // Applied derivative: `Apply(Derivative(f, n), x)`. On the JavaScript
    // target this lowers through forward-mode automatic differentiation
    // (`tryCompileJetDerivative`, javascript-target.ts) and the callee is
    // never compiled, so the `Derivative` head's compile handler must not
    // be probed here either. That probe is not free: it computes the
    // symbolic n-th derivative — the very work the jet lowering exists to
    // avoid — and then discards it.
    if (
      h === 'Apply' &&
      ops.length === 2 &&
      isFunction(ops[0], 'Derivative') &&
      (target.language ?? 'javascript') === 'javascript'
    ) {
      const lowering = jetDerivativeLowering(
        engine,
        ops,
        (e) => compileValueOperand(e, target),
        target.mode === 'complex'
      );
      if (lowering !== undefined) {
        // The body's own free symbols still have to be reported: the jet
        // emitter compiles each parameter-free subexpression in a
        // throwaway context, which records nothing here.
        visitLiteralBody(lowering, bound);
        visit(ops[1], bound);
        return;
      }
    }

    // Qualified call: `Apply(Field(Protocol, "member"), args…)`. The
    // compile path declines whole-unit when the tier declines, so the
    // member is reported unsupported in that case.
    if (h === 'Apply' && ops.length >= 2 && isFunction(ops[0], 'Field')) {
      const fieldOps = ops[0].ops;
      const record = protocolOfSymbol(engine, fieldOps[0]);
      const member = isString(fieldOps[1]) ? fieldOps[1].string : undefined;
      if (record !== undefined && member !== undefined) {
        const plan = jsProtocolTarget()
          ? planProtocolDispatch(engine, {
              implKey: member,
              argc: ops.length - 1,
              receiverType: probeReceiverType(ops[1]),
              protocol: record.name,
            })
          : undefined;
        if (plan !== undefined)
          visitProtocolPlan(`${record.name}:${member}`, plan);
        else unsupported.add(member);
        // The call arguments are ordinary expressions; the protocol-naming
        // `Field` callee is consumed by the intercept and never compiled.
        for (const op of ops.slice(1)) visit(op, bound);
        return;
      }
    }
    // A property STORE, in either of its two spellings:
    // `Assign(Field(root, "name"), v)` — the unqualified `p.name = v`, which
    // keeps its `Field` target through canonicalization — and the
    // four-operand `ProtocolProperty(P, "name", root, v)` the qualified
    // `p.(P.name) = v` lowers to. Neither is lowerable: a store writes a
    // mutable object, and objects have no compiled representation yet. Both
    // are reported UNSUPPORTED here, in step with the value path, which fails
    // closed on the same two shapes.
    //
    // The `Assign` arm claims EVERY `Field` target, not only names some
    // protocol declares as a property: an ordinary layout store has no
    // lowering either, and the value path refuses it identically.
    if (
      h === 'Assign' &&
      (isFunction(ops[0], 'Field') || isFunction(ops[0], 'ProtocolProperty'))
    ) {
      unsupported.add(ops[0].operator);
      // The receiver is the LAST operand of either target shape.
      const root = ops[0].ops[ops[0].ops.length - 1];
      if (root !== undefined) visit(root, bound);
      if (ops[1] !== undefined) visit(ops[1], bound);
      return;
    }
    if (h === 'ProtocolProperty' && ops.length === 4) {
      unsupported.add('ProtocolProperty');
      for (const op of ops.slice(2)) visit(op, bound);
      return;
    }

    // A head that names a user-defined function literal is lowerable (emitted
    // as a named local function — see `tryCompileUserFunction`), not
    // unsupported. Descend into its body (parameters bound) so free symbols it
    // references transitively are surfaced; guard against recursion.
    //
    // A head that the expression binds (a block local, a parameter, an
    // index) hides an engine function of the same name: the compiler does
    // not read the engine function for it (`target.boundVars` in
    // `compileExpr()`), so the body of that function is not visited. With
    // the engine function `f(t) := t·w`, the program `function f(t) { t + 1 }`
    // then `f(x)` calls its own `f`, and `w` was reported in `freeSymbols`.
    const userLiteral =
      target.userFunctions !== undefined &&
      !bound.has(h) &&
      !STRUCTURAL_HEADS.has(h) &&
      target.functions?.(h) === undefined &&
      target.operators?.(h) === undefined
        ? userFunctionLiteral(engine, h)
        : undefined;
    // A multi-clause function has no single literal: its clause bodies are
    // walked below as a literal body is, so a symbol that only a clause
    // reads is surfaced as an input (the emitted `_fn_w$c1` reads it).
    const userClauses =
      userLiteral === undefined &&
      target.userFunctions !== undefined &&
      !bound.has(h) &&
      !STRUCTURAL_HEADS.has(h) &&
      target.functions?.(h) === undefined &&
      target.operators?.(h) === undefined
        ? multiClauseState(engine.lookupDefinition(h))?.clauses
        : undefined;

    // A head whose operator definition supplies a custom `compile` handler
    // (the public per-operator extension point) MAY be lowerable via that
    // handler even with no operator/function mapping — so it must NOT be
    // reported as unsupported (finding A4). But a handler can decline for the
    // current target language, returning `undefined`/`null`/`''` (see the
    // handler consult in `compileExpr`); assuming support unconditionally
    // would under-report `unsupported` for e.g. a JavaScript-only handler on
    // a glsl target. So probe the handler with the real recursive
    // compile machinery in a throwaway context: a non-empty string return
    // means it lowers this head, while `undefined`/`null`/`''`/throw means it
    // declined. Executing the handler here is safe — the compile path would
    // run the same handler on the same expression anyway. The probe only runs
    // when no other lowering applies (structural/control-flow heads are not
    // overridable and are excluded — except the
    // `OVERRIDABLE_CONTROL_FLOW_HEADS` carve-out — matching the consult in
    // `compileExpr`; the two guards must stay identical).
    let hasCustomCompile = false;
    if (
      (!CONTROL_FLOW_HEADS.has(h) || OVERRIDABLE_CONTROL_FLOW_HEADS.has(h)) &&
      target.functions?.(h) === undefined &&
      target.operators?.(h) === undefined &&
      userLiteral === undefined
    ) {
      const customCompileDef = engine.lookupDefinition(h);
      if (
        isOperatorDef(customCompileDef) &&
        typeof customCompileDef.operator.compile === 'function'
      ) {
        const handler = customCompileDef.operator.compile;
        const context = {
          language: target.language ?? 'javascript',
          typeOf: (x: Expression) => operandTypeInContext(x, target),
        };
        const claims = (probe: unknown): boolean =>
          probe !== undefined && probe !== null && probe !== '';
        if (oversizedValueDepth > 0) {
          // Inside a value the compile refuses to bake in, the handler
          // gets operands it cannot read: every access throws a private
          // marker. A handler that declines before reading them (a
          // language check, the usual first line) is honored; one that
          // reads them is taken as claiming the shape, since the compile
          // never reaches this node and reading the real operands is what
          // serialized a sub-DAG as a tree.
          try {
            hasCustomCompile = claims(
              handler(
                ops.map(() => UNREADABLE_OPERAND as unknown as Expression),
                () => '0',
                context
              )
            );
          } catch (e) {
            // A handler is caller code, which can evaluate: a caller's
            // cancellation propagates.
            throwIfCallerCancellation(e, engine._deadlineFrame);
            hasCustomCompile = e === OPERAND_READ;
          }
        } else if (CompilerState._callerLowered.has(e)) {
          // The compilation in progress already called the handler on this
          // node (`compileExpr()`), and recorded whether it wrote the code
          // of the node: that is the answer, and the handler, which is
          // caller code, is not called again for it. The admission checks
          // run this analysis after the code was generated
          // (`assertAdmitted()`).
          hasCustomCompile = CompilerState._callerLowered.get(e) === true;
        } else {
          try {
            // The probe asks one question — does the handler CLAIM this
            // shape? A handler answers it by returning a string into
            // which it splices its operands' code, so a placeholder
            // stands for each of the node's OWN operands here: the probe
            // used to hand the handler the real operand compiler, which
            // compiled every operand in full, once per node of the tree
            // that carries such a handler, for an answer that was then
            // discarded (on a document whose `Which` head the caller maps
            // and whose height-map value holds thousands of them, this
            // analysis alone ran the process out of memory). Anything
            // else the handler asks to compile is a synthesized
            // expression — the derivative handler compiles the closed
            // form it computed, and declines when that fails — and is
            // compiled for real, exactly as the compile path would, so
            // that decline still reaches the report. The operands' own
            // references and unsupported heads are collected by the
            // visit below, exactly as for every other head.
            const probeArgs =
              // The declared-type receiver fallback the compile path
              // applies (see `fieldArgsWithDeclaredReceiver`), with the
              // analysis walk's own frame standing in for the target's
              // map.
              fieldArgsWithDeclaredReceiver(engine, h, ops, declaredTypes) ??
              ops;
            const compileOperand = (e: Expression): TargetSource =>
              probeArgs.includes(e) || ops.includes(e)
                ? '0'
                : compileValueOperand(e, target);
            hasCustomCompile = claims(
              handler(probeArgs, compileOperand, context)
            );
          } catch (e) {
            // As in the probe above: a caller's cancellation propagates,
            // and any other error means the handler claims nothing.
            throwIfCallerCancellation(e, engine._deadlineFrame);
            hasCustomCompile = false;
          }
        }
      }
    }

    // A protocol call the dispatch tier can lower is supported on the JS
    // target; everywhere else it keeps reporting unsupported (the tier is
    // JS-only, mirroring `tryCompileProtocolDispatch`'s gate). The probe is
    // the pure planner — no emission, same decision the compile path makes.
    let protocolPlan: ReturnType<typeof planProtocolDispatch> = undefined;
    let protocolPlanKey = '';
    if (
      jsProtocolTarget() &&
      !STRUCTURAL_HEADS.has(h) &&
      target.functions?.(h) === undefined &&
      target.operators?.(h) === undefined &&
      userLiteral === undefined &&
      !hasCustomCompile
    ) {
      const parts = protocolCallParts(engine, h, ops);
      if (parts !== undefined && parts.args[0] !== undefined) {
        protocolPlan = planProtocolDispatch(engine, {
          implKey: parts.implKey,
          argc: parts.args.length,
          receiverType: probeReceiverType(parts.args[0]),
          protocol: parts.protocol,
        });
        if (parts.staticOnly === true && protocolPlan?.tier !== 'static')
          protocolPlan = undefined;
        protocolPlanKey = `${parts.protocol ?? ''}:${parts.implKey}`;
      }
    }

    // A head that the expression binds (a block local, a parameter of a
    // function literal, an index) is not an operator of the target, so it
    // is not reported: a call of a local function is a call of the binding
    // that its statement list emits (`tryCompileLocalFunctionCall()`), and
    // a call of any other bound name declines with a message of its own.
    // Reported, the local function `f` of a program that declined for
    // another operator was read by a host as a name with no definition.
    if (
      h !== 'Error' &&
      !STRUCTURAL_HEADS.has(h) &&
      !bound.has(h) &&
      target.functions?.(h) === undefined &&
      target.operators?.(h) === undefined &&
      userLiteral === undefined &&
      userClauses === undefined &&
      !hasCustomCompile &&
      protocolPlan === undefined
    )
      unsupported.add(h);

    // Descend into the plan's implementation bodies (parameters bound), the
    // same walk the user-literal branch below performs, so symbols an
    // implementation references transitively are surfaced. Keyed by the
    // DISPATCH IDENTITY, not the head — `ProtocolMember`/`ProtocolProperty`
    // are shared wrappers across every member.
    if (protocolPlan !== undefined)
      visitProtocolPlan(protocolPlanKey, protocolPlan);

    if (userLiteral !== undefined) {
      if (!userFnSeen.has(h)) {
        userFnSeen.add(h);
        visitDefinitionBody(userLiteral);
      }
      // The call arguments are evaluated in the surrounding scope.
      for (const op of ops) visit(op, bound);
      return;
    }
    if (userClauses !== undefined) {
      if (!userFnSeen.has(h)) {
        userFnSeen.add(h);
        for (const c of userClauses)
          if (isFunction(c.literal, 'Function')) visitDefinitionBody(c.literal);
      }
      for (const op of ops) visit(op, bound);
      return;
    }

    // Binding forms: shadow their bound variables in the body, but visit the
    // bound expressions (limits / collections) in the outer scope.
    if (h === 'Function') {
      // A destructuring parameter binds its LEAF names, not a name of its
      // own; shadowing only the readable parameter names would leave those
      // leaves analysed as free ambient symbols.
      const params = functionLiteralBoundNames(ops.slice(1));
      visit(ops[0], params.length ? union(bound, params) : bound);
      return;
    }
    if (h === 'D') {
      // The variables of a derivative (`D(f(x), x)`) are bound in the scope
      // of the `D`, where their type is inferred from the body, or is
      // `unknown`. The compiled code computes the derivative at the value
      // of the input of that name (`_.x`), which is the symbol outside the
      // `D`, so a declaration of that symbol gives the type of the input:
      // with `x` declared `real`, the input `x` of `D(F(x), x)` is `real`.
      // The outer symbol is recorded before the body is visited, because
      // the first occurrence of a name gives the type that
      // `freeSymbolTypes()` reports. When the outer symbol has no declared
      // type (no definition, or a definition with an inferred type), the
      // occurrence in the `D` gives the type: an undeclared `x` is read
      // with the type inferred in the `D`, and not with the type `unknown`
      // of the automatic outer definition.
      for (const variable of ops.slice(1)) {
        if (!isSymbol(variable) || bound.has(variable.symbol)) continue;
        // The occurrences in the `D` are its variable (`binderInputNames`).
        binderInputNames.add(variable.symbol);
        const def = engine.lookupDefinition(variable.symbol);
        if (!isValueDef(def) || def.value.inferredType) continue;
        const outer = engine.symbol(variable.symbol);
        if (isSymbol(outer)) addFree(outer);
      }
      for (const op of ops) visit(op, bound);
      return;
    }
    if (h === 'Pipe' && ops.length === 2 && isFunction(ops[1])) {
      // A stage that is a call with its own slots (`Pipe(L, Take(_, 2))`)
      // is lifted to a function literal whose parameters are those slots
      // (`pipeApplication()`), so the slots are bound in the stage, as the
      // parameters of a `Function` literal are bound in its body. A slot of
      // a nested function literal is not a slot of the stage
      // (`freeAnonymousSlots()`). A `Function` stage binds its own
      // parameters when it is visited.
      visit(ops[0], bound);
      const stage = ops[1];
      const slots =
        stage.operator === 'Function' ? [] : [...freeAnonymousSlots(stage)];
      visit(stage, slots.length ? union(bound, slots) : bound);
      return;
    }
    if (
      h === 'Sum' ||
      h === 'Product' ||
      h === 'Integrate' ||
      h === 'Loop' ||
      h === 'ParallelLoop' ||
      h === 'Comprehension' ||
      h === 'ParallelComprehension'
    ) {
      const indices: string[] = [];
      const limitExprs: Array<[Expression, ReadonlySet<string>]> = [];
      // The names that the clauses of a `Comprehension` or an `Integrate`
      // bind before the clause being read: a later clause reads an earlier
      // index (`[(i, j) for i in 1..3 for j in 1..i]`). The compiled code of
      // an integral with several limits nests the integral of a later limit
      // inside the integral of an earlier one, so the bound `x` of
      // `Integrate(e^(y^2), Limits(x, 0, 1), Limits(y, 0, x))` is the
      // variable of the first limit, not an input.
      let earlier: ReadonlySet<string> = bound;
      for (const clause of ops.slice(1)) {
        // An indefinite integral (`Limits(x, Nothing, Nothing)`) is
        // compiled as its antiderivative, a function of the variable, so
        // the variable is an input of the compiled code (`_.x`), and the
        // erasure marker `Nothing` of the absent bounds is not. Before,
        // `Nothing` was reported as a free symbol and `x` was not.
        // CE-232.4.
        if (
          h === 'Integrate' &&
          isFunction(clause, 'Limits') &&
          clause.ops.slice(1).every((b) => isSymbol(b, 'Nothing'))
        ) {
          const variable = clause.ops[0];
          if (isSymbol(variable) && !bound.has(variable.symbol)) {
            // The variable in the `Limits` is bound in the scope of the
            // integral, and its type is `unknown`. The input that the
            // compiled code reads (`_.x`) is the symbol of that name outside
            // the integral, so its declaration gives the type of the input:
            // with `x` declared `real`, the input `x` of `\int x^2 dx` is
            // `real`. When no definition of the name is in scope, the
            // variable stays the occurrence, and its type is `unknown`.
            const outer =
              engine.lookupDefinition(variable.symbol) !== undefined
                ? engine.symbol(variable.symbol)
                : undefined;
            binderInputNames.add(variable.symbol);
            addFree(isSymbol(outer) ? outer : variable);
          }
          continue;
        }
        if (isFunction(clause)) {
          // The index of the clause, or the leaves of a destructuring
          // index (`for (value, letters) in table`), which were reported
          // as free symbols.
          const names: string[] = [];
          const leaves = (p: Expression | undefined): void => {
            if (isSymbol(p)) {
              if (p.symbol !== '_') names.push(p.symbol);
            } else if (isFunction(p, 'Tuple')) for (const q of p.ops) leaves(q);
          };
          leaves(clause.ops[0]);
          // A limit that names no variable binds the variable that the
          // interpreter gives it (`implicitIntegrationVariable`): `x` in
          // `\int_0^1 x` is not an input of the compiled code.
          if (h === 'Integrate' && isSymbol(clause.ops[0], 'Nothing')) {
            const implicit = implicitIntegrationVariable(
              ops[0],
              ops.slice(1),
              ops.slice(1).indexOf(clause)
            );
            if (typeof implicit === 'string') names.push(implicit);
          }
          indices.push(...names);
          const outer =
            h === 'Comprehension' ||
            h === 'ParallelComprehension' ||
            h === 'Integrate'
              ? earlier
              : bound;
          const own = names.length === 0 ? outer : union(outer, names);
          // The operands of an `Element` clause after its collection are
          // its conditions, which read the index of the clause
          // (`[k for k in 1..100 if isOdd(sigma0(k))]`). They were read in
          // the outer scope, and `k` was reported as a free symbol.
          // CE-232.3.
          clause.ops.slice(1).forEach((sub, i) => {
            limitExprs.push([
              sub,
              clause.operator === 'Element' && i >= 1 ? own : outer,
            ]);
          });
          if (
            h === 'Comprehension' ||
            h === 'ParallelComprehension' ||
            h === 'Integrate'
          )
            earlier = own;
        } else {
          limitExprs.push([clause, bound]);
        }
      }
      visit(ops[0], indices.length ? union(bound, indices) : bound);
      for (const [le, scope] of limitExprs) visit(le, scope);
      return;
    }
    if (h === 'Declare') {
      // Only the initial value is an expression the code reads. The name
      // (or destructuring pattern) is a local the code defines, and the
      // type is a type, not a symbol: visiting them as operands reported
      // the type `number` of `Declare(w, "number")` as a free input. The
      // value can also sit in the trailing attributes dictionary
      // (`let y = x + 1` is `Declare(y, {value: x + 1})`), which the
      // generic operand walk does not open, so `x` was missed.
      const value = declareValueOperand(ops);
      if (value !== undefined) visit(value, bound);
      return;
    }
    if (h === 'Block') {
      const locals: string[] = [];
      // A destructuring declare (`let (x, y) = …`) binds every symbol leaf
      // of its tuple pattern (`_` binds nothing; patterns nest).
      const collectPatternLeaves = (p: Expression): void => {
        if (isSymbol(p)) {
          if (p.symbol !== '_') locals.push(p.symbol);
        } else if (isFunction(p, 'Tuple'))
          for (const el of p.ops) collectPatternLeaves(el);
      };
      for (const stmt of ops)
        if (isFunction(stmt, 'Declare')) {
          if (isSymbol(stmt.ops[0])) locals.push(stmt.ops[0].symbol);
          else if (isFunction(stmt.ops[0], 'Tuple'))
            collectPatternLeaves(stmt.ops[0]);
        } else if (isFunction(stmt, 'DefineFunction')) {
          // A function the block defines (`f(x) = x + 1`) is a local the
          // generated code declares (`let f = …`), not an input the caller
          // supplies; without this the program's own function name was
          // reported as a free symbol.
          if (isSymbol(stmt.ops[0])) locals.push(stmt.ops[0].symbol);
        }
      const inner = locals.length ? union(bound, locals) : bound;
      // Typed block locals extend the declared-type frame (the mirror of
      // the `compileBlock` / `loopBodyTempTarget` merge), so a protocol
      // SET/GET probe on a local declared in this list resolves the same
      // static type the compile path does.
      const saved = declaredTypes;
      declaredTypes = statementListDeclaredVarTypes(ops, declaredTypes);
      try {
        for (const op of ops) visit(op, inner);
      } finally {
        declaredTypes = saved;
      }
      return;
    }
    if (h === 'Match') {
      // The subject is evaluated in the enclosing scope.
      if (ops[0] !== undefined) visit(ops[0], bound);
      for (const c of ops.slice(1)) {
        if (!isFunction(c, 'MatchCase') || c.ops.length < 2) continue;
        const cops = c.ops;
        const pattern = cops[0];
        const guard = cops.length >= 3 ? cops[1] : undefined;
        const body = cops[cops.length - 1];
        // Captures shadow the guard/body; pin operands are external references
        // (evaluated in the enclosing scope at match time).
        const { captures, pinExprs } = matchPatternReferences(pattern);
        const inner = captures.length ? union(bound, captures) : bound;
        if (guard !== undefined)
          visit(canonicalCasePart(guard, captures), inner);
        visit(canonicalCasePart(body, captures), inner);
        for (const pin of pinExprs) visit(pin, bound);
      }
      return;
    }

    ops.forEach((op, i) => {
      if (i === 0 && h === 'Assign' && isNamesTarget(op)) {
        const saved = writing;
        writing = e;
        try {
          visit(op, bound);
        } finally {
          writing = saved;
        }
      } else visit(op, bound);
    });
  };

  visit(expr, new Set());
  return { freeSymbols: [...free], unsupported: [...unsupported] };
}

/**
 * True when `t`, the target of an `Assign`, is a name or a `Tuple` of
 * names: the statement writes these names. Another target (`At(L, i)`)
 * reads its operands.
 */
export function isNamesTarget(t: Expression): boolean {
  if (isSymbol(t)) return true;
  return isFunction(t, 'Tuple') && t.ops.every(isNamesTarget);
}

/**
 * The storage hints of a compilation, validated and normalized to a map from
 * symbol name to storage kind — or `undefined` when the caller gave none
 * (`storageHintsOf()`, `storage-hints.ts`).
 *
 * Every hinted name must be a free symbol of (at least one of) `exprs` as the
 * code generator sees them (`analyzeReferences`): a symbol the
 * engine has no value for, once bound variables are excluded, plus any
 * `vars`-mapped symbol, and including the free symbols of a user-defined
 * function body the expression calls (`f(x) := At(S, x)` read as `f(k)`
 * reads `S`). A symbol with an assigned value is folded into the generated
 * code and is never read from storage, so a hint on it names nothing; so does
 * a hint on a name that does not occur at all. Both throw, naming the free
 * symbols the hint could have applied to.
 *
 * `target` is the language target the expression will be compiled to
 * (`languageTarget.createTarget()` suffices); `options` are the caller's
 * `vars` and `functions`. The analysis walks a user-defined function body only
 * when the target carries a user-function registry and the caller has not
 * overridden that function's implementation — the same two conditions the
 * real compilation lowers such a call under — so an analysis-only target with
 * those two facts is built here rather than asked of every caller. Callers
 * should invoke this only when `storage` is given: the target construction is
 * not free, and there is nothing to validate otherwise.
 */
export function resolveStorageHints(
  storage: unknown,
  exprs: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  options: {
    vars?: Readonly<Record<string, unknown>>;
    functions?: Readonly<Record<string, unknown>>;
  } = {}
): ReadonlyMap<MathJsonSymbol, StorageKind> | undefined {
  return storageHintsOf(storage, () => {
    const { vars, functions } = options;
    const analysis: CompileTarget<Expression> = {
      ...target,
      userFunctions: target.userFunctions ?? {
        defs: new Map(),
        compiling: new Set(),
      },
      // A head the caller overrides is not a user-function literal to descend
      // into (its body is never compiled), so the analysis must see it as
      // defined. Only definedness is read here; the spelling is immaterial.
      functions: (id) =>
        functions !== undefined && Object.hasOwn(functions, id)
          ? id
          : target.functions?.(id),
    };
    const varsKeys = vars ? new Set(Object.keys(vars)) : undefined;
    const free = new Set<string>();
    for (const expr of exprs)
      for (const s of analyzeReferences(expr, analysis, varsKeys).freeSymbols)
        free.add(s);
    return free;
  });
}

/**
 * Attach `freeSymbols` and `freeSymbolTypes` (from `analyzeReferences`),
 * `unsupported` and the mode report (`mode`) to a compilation result,
 * returning the same object. Used by the built-in targets to make every
 * result carry its declarative reference analysis and the discipline it
 * was compiled under.
 *
 * The report is the one frozen when the outermost compilation ended
 * (`modeReport`): `mode` is the mode the code was compiled under.
 *
 * `unsupported` is empty for a compilation that produced code. The
 * compiler throws for an operator that the target does not lower, so no
 * such operator is in the expression. The list that `analyzeReferences()`
 * gives is not used for such a result: it is a static walk that does not
 * follow every rule of the compiler, and it named operators that were
 * lowered. The program `function f(x) { x + 1 }` then `f(2)` compiles to
 * `let f = ((x) => x + 1)` on JavaScript, and the walk gave
 * `["DefineFunction", "f"]`: it reads the definition as an operator with
 * no lowering, and it does not know that `f` is a local function.
 *
 * A declined result gets the list of the walk in
 * `buildInterpreterFallback()`. On a decline the list can name
 * `DefineFunction` beside the operator that caused the decline.
 */
export function withReferences<
  R extends {
    success?: boolean;
    freeSymbols?: string[];
    unsupported?: string[];
    mode?: 'strict' | 'complex' | 'bigint';
    promoted?: boolean;
  },
>(
  result: R,
  expr: Expression,
  target: CompileTarget<Expression>,
  varsKeys?: ReadonlySet<string>
): R {
  const occurrences = new Map<string, Expression>();
  const refs = analyzeReferences(expr, target, varsKeys, occurrences);
  return Object.assign(
    result,
    {
      freeSymbols: refs.freeSymbols,
      unsupported: result.success === false ? refs.unsupported : [],
      freeSymbolTypes: freeSymbolTypes(
        expr,
        target,
        refs.freeSymbols,
        occurrences
      ),
    },
    modeReport()
  );
}

/**
 * The type report of each free symbol in `names` (see
 * `CompilationResult.freeSymbolTypes`): its engine type, the type the code
 * compiled for `target` reads it as, and whether it was declared.
 *
 * The types are read from a FREE occurrence of the symbol in `expr`,
 * which is bound in the scope the expression was compiled in.
 * `occurrences` holds them, as recorded by `analyzeReferences`, which
 * skips an occurrence that a binder shadows: in
 * `[Sum(q, Limits(q, 1, n)), Real(q)]` the index `q` is an integer local
 * of the sum, while the free `q` can be complex. A symbol reachable only
 * through a folded value or a user-function body has no occurrence in
 * `expr`; it is then read from its definition.
 *
 * The provenance is read from the definition the occurrence is bound to,
 * not from a lookup in the current scope: an expression parsed in a scope
 * that declared `q`, and compiled after that scope was popped, reads the
 * declared `q`, and must report it `declared`.
 *
 * The type is spelled as a host writes it in a declaration
 * (`declaredTypeText`), which is also the spelling of the run-time entry
 * diagnostic of the JavaScript runner.
 */
export function freeSymbolTypes(
  expr: Expression,
  target: CompileTarget<Expression>,
  names: ReadonlyArray<string>,
  occurrences: ReadonlyMap<string, Expression>
): Record<string, FreeSymbolType> {
  const ce = expr.engine;
  const result: Record<string, FreeSymbolType> = {};
  for (const name of names) {
    const occurrence = freeSymbolOccurrence(name, occurrences);
    const symbol = occurrence ?? ce.symbol(name);
    const declared = isDeclaredFreeSymbol(expr, name, occurrences);
    let lowered: string | undefined;
    try {
      // A symbol of a kind type is read as the representation that the
      // kind's compile contract gives (`compile.type.lowered()`).
      lowered =
        loweredKindType(ce, symbol.type.type, {
          language: target.language ?? 'javascript',
        }) ??
        target.loweredSymbolType?.(symbol) ??
        defaultLoweredSymbolType(symbol, target.language);
    } catch (e) {
      throwIfCallerCancellation(e, ce._deadlineFrame);
      lowered = undefined;
    }
    // Defined, not assigned: a symbol named `__proto__` must become an
    // own entry, not replace the prototype of the report.
    Object.defineProperty(result, name, {
      value: {
        type: declaredTypeText(symbol.type.type),
        lowered: lowered ?? 'unknown',
        provenance: declared ? 'declared' : 'inferred',
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

/**
 * True when the type of the free symbol `name` of `expr` is declared, and
 * not inferred: this is the provenance `'declared'` that
 * `freeSymbolTypes()` reports. `occurrences` is the map of occurrences that
 * `analyzeReferences()` recorded. The provenance is read from the
 * definition that the occurrence is bound to (`freeSymbolOccurrence()`),
 * or from the definition of `name` in scope when there is no occurrence.
 */
function isDeclaredFreeSymbol(
  expr: Expression,
  name: string,
  occurrences: ReadonlyMap<string, Expression>
): boolean {
  const occurrence = freeSymbolOccurrence(name, occurrences);
  let valueDef: { inferredType: boolean } | undefined;
  if (occurrence !== undefined && isSymbol(occurrence))
    valueDef = occurrence.valueDefinition;
  else {
    const def = expr.engine.lookupDefinition(name);
    valueDef = isValueDef(def) ? def.value : undefined;
  }
  return valueDef !== undefined && !valueDef.inferredType;
}

/**
 * The occurrence of the free symbol `name` that its type is read from, from
 * the occurrences that `analyzeReferences()` recorded, or `undefined` when
 * the type is read from the definition of `name` in scope
 * (`ce.symbol(name)`). `freeSymbolTypes()` and the check of the inputs with
 * no type (`untypedInputs()`, `compile-admission.ts`) read the same type.
 *
 * The target of an assignment is not bound to a definition (it has no
 * `valueDefinition`, and its type is `unknown`). When it is the only
 * occurrence of an input (`If(c, u ≔ 1, …)` writes `u` and does not read
 * it), the type is read from the definition in scope instead, so that the
 * input has its declared type and not `unknown`.
 */
export function freeSymbolOccurrence(
  name: string,
  occurrences: ReadonlyMap<string, Expression>
): Expression | undefined {
  const found = occurrences.get(name);
  const typed = typedOccurrences.get(occurrences)?.get(name);
  if (typed !== undefined && (typed.length > 1 || typed[0] !== found))
    return narrowestOccurrence(typed);
  // A free name (`isFreeName()`, `binding-unit.ts`) has no definition, and
  // its type holds the requirements of its unit: it is kept.
  return found !== undefined &&
    isSymbol(found) &&
    !found.valueDefinition &&
    !isFreeName(found)
    ? undefined
    : found;
}

/**
 * For the map of occurrences of one
 * reference analysis, for each free symbol, the occurrences that can read
 * different types (`noteTypedOccurrence()`).
 */
const typedOccurrences = new WeakMap<
  ReadonlyMap<string, Expression>,
  Map<string, Expression[]>
>();

/** The environment of the unit of the symbol `e`, and the key of its entry
 * there: its value definition, or its home scope for a free name
 * (`binding-unit.ts`). */
function unitKeyOf(e: Expression): { env: unknown; key: unknown } {
  const s = e as {
    _env?: unknown;
    _homeScope?: unknown;
    valueDefinition?: unknown;
  };
  return { env: s._env, key: s.valueDefinition ?? s._homeScope };
}

/**
 * Record the occurrence `e` of a free symbol of the compiled expression.
 * Boxing declares no name, so the
 * type of an input is in the environments of the units that use it: the
 * unit of the expression, the unit of an assigned value that the code
 * folds (`b := c + 1`), the unit of the body of a function that the code
 * calls. Each occurrence reads its own unit, and the compilation gives the
 * input the meet of these types (`narrowestOccurrence()`; rule 8 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`).
 *
 * An occurrence with the unit and the key of a recorded one reads the same
 * entry and is not recorded again. The target of an assignment, which has
 * no definition and is not a free name, has no type and is not recorded.
 */
function noteTypedOccurrence(
  occurrences: ReadonlyMap<string, Expression>,
  e: Expression & { symbol: string }
): void {
  if (!isFreeName(e) && !e.valueDefinition) return;
  let byName = typedOccurrences.get(occurrences);
  if (byName === undefined)
    typedOccurrences.set(occurrences, (byName = new Map()));
  const list = byName.get(e.symbol);
  if (list === undefined) {
    byName.set(e.symbol, [e]);
    return;
  }
  const { env, key } = unitKeyOf(e);
  for (const recorded of list) {
    const r = unitKeyOf(recorded);
    if (r.env === env && r.key === key) return;
  }
  list.push(e);
}

/**
 * Of the occurrences `typed` of one input, the first whose type is the meet
 * of the types of all of them. An occurrence of type `unknown` requires
 * nothing.
 *
 * When the meet is `never` (the units disagree), or when no occurrence has
 * exactly the meet as its type (`real<0..>` in one unit and `real<..1>` in
 * another), the result is a symbol of the name with no definition and no
 * unit, whose type is `unknown`: the input then has no type, and the
 * compilation declines with `untyped-input`. This is the simple, sound
 * version: a type report that carries the meet itself would compile the
 * second case.
 */
function narrowestOccurrence(typed: ReadonlyArray<Expression>): Expression {
  let meet: Type = 'unknown';
  let anyTyped = false;
  for (const occurrence of typed) {
    const t = occurrence.type.type;
    if (t === 'unknown') continue;
    anyTyped = true;
    meet = narrow(meet, t);
    if (meet === 'never') break;
  }
  if (!anyTyped) return typed[0];
  if (meet !== 'never') {
    const text = typeToString(meet);
    const exact = typed.find((o) => typeToString(o.type.type) === text);
    if (exact !== undefined) return exact;
  }
  const first = typed[0] as Expression & { symbol: string };
  return first.engine.symbol(first.symbol, { canonical: false });
}

export { declaredTypeText };

/**
 * The type the code compiled for a target without a `loweredSymbolType`
 * hook reads the free symbol `symbol` as, from its engine type and its
 * lane: the runner's value convention on JavaScript (`number`, `complex`,
 * `boolean`, `string`, `color`, `point`, `array`, `function`), and
 * `interval` for a real number on interval-js.
 * `undefined` when the type says none of these.
 */
export function defaultLoweredSymbolType(
  symbol: Expression,
  language: string | undefined
): string | undefined {
  const t = symbol.type.type;
  if (core.isComplexValued(symbol) || isNonRealNumber(t)) return 'complex';
  if (isSubtype(t, 'boolean')) return 'boolean';
  // A symbol with no type information (`unknown`) is read as a real
  // number, as the shader targets read it as a `float`.
  if (t === 'unknown' || isSubtype(t, 'number'))
    return language === 'interval-javascript' ? 'interval' : 'number';
  if (isSubtype(t, 'string')) return 'string';
  // A colour, or a colour operand whose type admits the other colour
  // spellings (`color | string | tuple`, the type of `a` after
  // `ColorMix(a, b, 0.5)`).
  if (
    isSubtype(t, 'color') ||
    (isSubtype('color', t) && isSubtype(t, 'color | string | tuple'))
  )
    return 'color';
  if (isTupleShapedType(t)) return 'point';
  if (isSubtype(t, COLLECTION_SHAPE_TYPE)) return 'array';
  if (isSubtype(t, 'function')) return 'function';
  return undefined;
}

/**
 * The `mode` field every built-in result carries (see
 * `CompilationResult`): the report frozen when the most recent outermost
 * compilation ended (`_lastReport`) — the mode the code was compiled under.
 *
 * It is NOT a lane oracle: an operand that is complex-TYPED (`Sqrt(z)` with
 * `z: complex`) or a complex literal (`2i·x`) routes through the complex
 * kernel in every discipline, so such a compile emits `{re, im}` and still
 * reports `mode: 'strict'`. Test a returned value's shape with
 * `typeof v === 'number'`, not with `mode`.
 *
 * A DECLINE reports the neutral `'strict'`: the report describes emitted
 * code, and a decline emitted none (see `compile`'s `finally`).
 */
export function modeReport(): {
  mode: 'strict' | 'complex' | 'bigint';
} {
  return { ...CompilerState._lastReport };
}

/**
 * The report of a compilation that declined: `strict`, since no code was
 * emitted. It is not read from `_lastReport`, because a
 * decline can be thrown before the outermost `compile()` resets it (the
 * `AbsArg` refusal of `rewriteAngularUnit()` at a target's entry), and
 * `_lastReport` then still holds the report of the previous compilation.
 */
export function declineReport(): { mode: 'strict' } {
  return { mode: 'strict' };
}

/**
 * Build the documented `success: false` compilation result for an expression
 * that could not be lowered to the target, with `run` set to an
 * interpreter-backed evaluator (the "fall back to interpretation" contract).
 *
 * This is the shared implementation behind both the engine-level free-function
 * `compile()` (which always falls back unless `fallback: false`) and the
 * built-in `LanguageTarget.compile()` methods (which throw by default, but
 * fall back to this shape when the caller opts in with `fallback: true`). The
 * `run` closure mirrors `evaluate()` semantics: a scalar collapses to its real
 * part, a finite indexed collection materializes to a nested JS array, and a
 * `Function` literal uses the positional `lambda` calling convention.
 *
 * `error` is preserved on the result so the caller can report *why* it could
 * not be compiled without re-throwing, and `diagnostic` (the structured form
 * — the payload of a `CompileDeclineError`, or the generic `capability`
 * diagnostic `compileDiagnosticOf` builds from the message) is set beside
 * it; `compileTarget` (when available) drives the declarative
 * `freeSymbols`/`unsupported` reference analysis. This method never throws
 * for a compile reason — the reference analysis is guarded.
 *
 * The runner honors the compiled runner's value contract in both
 * directions (design D7, `docs/COMPILATION-MODEL.md`
 * §8): each `vars` value is declared from its RUNTIME SHAPE (`complex` for
 * a `{re, im}` object, `number` for a number), and a scalar result comes
 * back as a plain `number` when its imaginary part is exactly zero, as a
 * `{re, im}` `ComplexResult` otherwise, and as a boolean when it is one —
 * the same convention a successful JavaScript compile uses, so a caller
 * cannot tell a decline from a compile by the SHAPE of the values.
 */
export function buildInterpreterFallback<T extends string>(
  expr: Expression,
  error: string,
  targetName: T,
  compileTarget: CompileTarget<Expression> | undefined,
  varsKeys: Set<string> | undefined,
  diagnostic?: CompileDiagnostic
): CompilationResult<T> {
  const ce = expr.engine;
  diagnostic ??= {
    code: 'compile-error',
    kind: 'capability',
    message: error,
  };
  // The run of `expr` with the interpreter, under the spelling of an absent
  // value of the target (`interpreterRun()`, `interpreter-fallback.ts`).
  const { calling, run } = interpreterRun(expr, {
    objectNull:
      compileTarget?.absence === undefined ||
      compileTarget.absence.object !== undefined,
    writtenNumeric: compileTarget?.absence?.writtenSymbol === 'numeric',
  });

  // Declarative reference analysis so the (success: false) result still tells
  // the caller *why* it could not be compiled without parsing `error`. Never
  // let the analysis itself break the fallback.
  let refs: { freeSymbols: string[]; unsupported: string[] } = {
    freeSymbols: [],
    unsupported: [],
  };
  const occurrences = new Map<string, Expression>();
  try {
    if (compileTarget)
      refs = analyzeReferences(expr, compileTarget, varsKeys, occurrences);
  } catch (e) {
    // The analysis runs the compile handlers of custom operators, which
    // can evaluate: a caller's cancellation propagates. Any other error
    // keeps the empty analysis.
    throwIfCallerCancellation(e, ce._deadlineFrame);
  }
  // The decline of an invalid expression, and the decline of a
  // sub-expression of static type `error` (`throwStaticTypeError()`,
  // code `'static-type-error'`), report `ErrorCode` in `unsupported` on every
  // target. A host reads this token to tell a decline for an error in the
  // expression from a decline for a missing lowering. The reference analysis
  // finds `ErrorCode` only inside an `Error` node, and only on some targets;
  // a valid call whose type is `error` (`ADD("ab", u)` with `u: real`) has
  // no such node.
  if (
    !refs.unsupported.includes('ErrorCode') &&
    (diagnostic.code === STATIC_TYPE_ERROR_CODE || !expr.isValid)
  )
    refs = { ...refs, unsupported: [...refs.unsupported, 'ErrorCode'] };

  // The type report of the free symbols, read against the target the
  // analysis used. Like the analysis, it never breaks the fallback.
  const fallbackTypes = (): {
    freeSymbolTypes?: Record<string, FreeSymbolType>;
  } => {
    if (!compileTarget) return {};
    try {
      return {
        freeSymbolTypes: freeSymbolTypes(
          expr,
          compileTarget,
          refs.freeSymbols,
          occurrences
        ),
      };
    } catch (e) {
      throwIfCallerCancellation(e, ce._deadlineFrame);
      return {};
    }
  };

  // Every decline names in `unsupported` the inputs whose static type is
  // `unknown` or `any`. The decline for such an input
  // (`assertAdmitted()`, code `'untyped-input'`) runs only when nothing
  // else declines. When the expression declines for another reason, that
  // reason stays the `error` and the `diagnostic`, and the inputs are named
  // too: a host still learns which inputs to declare. In both cases the
  // names come from the same function as the decline (`untypedInputsOf()`,
  // `compile-admission.ts`), applied to the reference analysis above. Like
  // the analysis, it never breaks the fallback. The decline of a value with
  // no settled shape (`assertAdmitted()`, code `'unsettled-shape'`) also
  // names the node, as `toString()` writes it. The decline of an input
  // declared with a union of shapes that the code cannot dispatch on (code
  // `'union-dispatch'`) names the inputs.
  const named: string[] = [];
  if (
    diagnostic.value !== undefined &&
    diagnostic.code === UNSETTLED_SHAPE_CODE
  )
    named.push(diagnostic.value);
  // The target of the fallback is made without the options of the caller
  // (its `functions`), so it can see a name as dropped where the target of
  // the compilation reads it: with `functions: { Which: 'myWhich' }`,
  // `Which(True, 0, True, M)` declines for `M`. The names of the decline
  // itself are always listed.
  if (
    diagnostic.value !== undefined &&
    (diagnostic.code === UNTYPED_INPUT_CODE ||
      diagnostic.code === UNION_DISPATCH_CODE)
  )
    named.push(...diagnostic.value.split(','));
  if (compileTarget) {
    try {
      named.push(
        ...core.untypedInputsOf(
          expr,
          compileTarget,
          refs.freeSymbols,
          occurrences
        )
      );
    } catch (e) {
      throwIfCallerCancellation(e, ce._deadlineFrame);
    }
  }
  const added = [...new Set(named)].filter(
    (n) => !refs.unsupported.includes(n)
  );
  if (added.length > 0)
    refs = { ...refs, unsupported: [...refs.unsupported, ...added] };

  return {
    target: targetName,
    success: false,
    code: '',
    calling,
    run,
    error,
    diagnostic,
    ...declineReport(),
    ...refs,
    ...fallbackTypes(),
  } as CompilationResult<T>;
}
