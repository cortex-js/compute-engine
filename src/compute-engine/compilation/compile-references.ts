// Reference analysis of a compilation unit, free symbol types, reports, and
// the interpreter fallback.

import type { Expression, FunctionInterface } from '../global-types.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { isTupleShapedType } from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { loweredKindType } from './kind-lowering.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isString,
  isCharacter,
  isFunction,
  isAbsentSymbol,
} from '../boxed-expression/type-guards.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import {
  functionLiteralBoundNames,
  functionLiteralParameters,
} from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import { protocolOfSymbol } from '../engine-protocols.js';
import { planProtocolDispatch } from './protocol-dispatch.js';
import { matchPatternReferences } from '../boxed-expression/match-dispatch.js';
import type {
  CompileDiagnostic,
  CompileTarget,
  CompilationResult,
  CompiledColor,
  CompiledRunner,
  ComplexResult,
  FreeSymbolType,
  TargetSource,
} from './types.js';
import {
  builtinCallbackArity,
  isHostOperatorCallback,
  isRefusableBuiltinCallback,
} from './builtin-callback.js';
import {
  OPERAND_READ,
  UNREADABLE_OPERAND,
  chainedAmbientWrite,
} from './compile-locals.js';
import {
  appliedDerivativeLiteral,
  appliedDerivativeTooLarge,
  literalDeclaredParamTypes,
} from './compile-callbacks.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { bindsFoldedValue, expandedFoldSize } from './compile-folded-values.js';
import { foldValueCaptured } from './compile-folding.js';
import {
  COLOR_SPACE_HEADS,
  CONTROL_FLOW_HEADS,
  INTERPRETED_COLOR_SPACES,
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
  // The inner targets of the chained assignment statement `stmt`
  // (`t ≔ (w ≔ t + i)`) that the compiled code declares as locals of the
  // statement list: those that no engine scope outside the expression binds
  // (`chainedAmbientWrite`). They were reported as free symbols: `w`
  // above, when `w` is not declared.
  const chainedLocals = (stmt: Expression | undefined): string[] => {
    const names: string[] = [];
    let value = isFunction(stmt, 'Assign') ? stmt.ops[1] : undefined;
    while (isFunction(value, 'Assign') && isSymbol(value.ops[0])) {
      if (!chainedAmbientWrite(value.ops[0])) names.push(value.ops[0].symbol);
      value = value.ops[1];
    }
    return names;
  };
  const addFree = (e: Expression & { symbol: string }): void => {
    free.add(e.symbol);
    if (occurrences === undefined || indirectDepth !== 0) return;
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
      visit(literal.ops[0], params.length ? union(bound, params) : bound);
    } finally {
      declaredTypes = saved;
      indirectDepth--;
    }
  };

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
    plan: NonNullable<ReturnType<typeof planProtocolDispatch>>,
    bound: ReadonlySet<string>
  ): void => {
    if (userFnSeen.has(`protocol:${key}`)) return;
    userFnSeen.add(`protocol:${key}`);
    for (const c of plan.candidates) {
      // The CANONICAL literal — the body the dispatch tier compiles (the
      // raw one still carries `Typed` ascription nodes).
      const literal = c.literal.canonical;
      if (!isFunction(literal, 'Function')) continue;
      visitLiteralBody(literal, bound);
    }
  };

  const visit = (e: Expression, bound: ReadonlySet<string>): void => {
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
            visitLiteralBody(symLiteral, bound);
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
      // No mapping, no value, not a constant: a genuinely free symbol.
      addFree(e);
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
          visitProtocolPlan(`${record.name}:${member}`, plan, bound);
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
    const userLiteral =
      target.userFunctions !== undefined &&
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
    // a glsl/python target. So probe the handler with the real recursive
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

    if (
      h !== 'Error' &&
      !STRUCTURAL_HEADS.has(h) &&
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
      visitProtocolPlan(protocolPlanKey, protocolPlan, bound);

    if (userLiteral !== undefined) {
      if (!userFnSeen.has(h)) {
        userFnSeen.add(h);
        visitLiteralBody(userLiteral, bound);
      }
      // The call arguments are evaluated in the surrounding scope.
      for (const op of ops) visit(op, bound);
      return;
    }
    if (userClauses !== undefined) {
      if (!userFnSeen.has(h)) {
        userFnSeen.add(h);
        for (const c of userClauses)
          if (isFunction(c.literal, 'Function'))
            visitLiteralBody(c.literal, bound);
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
    if (
      h === 'Sum' ||
      h === 'Product' ||
      h === 'Integrate' ||
      h === 'Loop' ||
      h === 'Comprehension'
    ) {
      // A loop body that is one chained assignment declares its inner
      // targets as locals of the body (`chainedLocalDeclares`).
      const indices: string[] = h === 'Loop' ? chainedLocals(ops[0]) : [];
      const limitExprs: Array<[Expression, ReadonlySet<string>]> = [];
      // The names that the clauses of a `Comprehension` bind before the
      // clause being read: a later clause reads an earlier index
      // (`[(i, j) for i in 1..3 for j in 1..i]`).
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
          if (isSymbol(variable) && !bound.has(variable.symbol))
            addFree(variable);
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
          indices.push(...names);
          const outer = h === 'Comprehension' ? earlier : bound;
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
          if (h === 'Comprehension') earlier = own;
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
      // The inner targets of a chained assignment statement are locals of
      // the block (`withImplicitLocalDeclares`).
      const locals: string[] = ops.flatMap(chainedLocals);
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
        } else if (
          isFunction(stmt, 'Assign') &&
          isSymbol(stmt.ops[0]) &&
          e.localScope?.bindings.has(stmt.ops[0].symbol)
        ) {
          // An assignment that the canonical form hoisted into the scope
          // of the block (`v ≔ 2` with no outer `v`) declares a local of
          // the block, which the generated code declares too
          // (`withImplicitLocalDeclares`). It was reported as a free
          // symbol: `Block(v ≔ 2; v·x)` reported `v` and `x`.
          locals.push(stmt.ops[0].symbol);
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
        if (guard !== undefined) visit(guard, inner);
        visit(body, inner);
        for (const pin of pinExprs) visit(pin, bound);
      }
      return;
    }

    for (const op of ops) visit(op, bound);
  };

  visit(expr, new Set());
  return { freeSymbols: [...free], unsupported: [...unsupported] };
}

/**
 * Attach `freeSymbols` / `unsupported` (from `analyzeReferences`) and the
 * mode report (`mode`, `promoted`) to a compilation result, returning the
 * same object. Used by the built-in targets to make every result carry its
 * declarative reference analysis and the discipline it was compiled under.
 *
 * The report is the one frozen when the outermost compilation ended
 * (`modeReport`): `mode` is the latched discipline, `promoted` whether a
 * promotable head was lowered through a complex kernel.
 */
export function withReferences<
  R extends {
    freeSymbols?: string[];
    unsupported?: string[];
    mode?: 'strict' | 'complex';
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
    refs,
    {
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
    // The target of an assignment is not bound to a definition (it has no
    // `valueDefinition`, and its type is `unknown`). When it is the only
    // occurrence of an input (`If(c, u ≔ 1, …)` writes `u` and does not
    // read it), the report reads the definition in scope instead: it was
    // `unknown`, and a shader declared the local copy of a boolean input
    // as a `float`.
    const found = occurrences.get(name);
    const occurrence =
      found !== undefined && isSymbol(found) && !found.valueDefinition
        ? undefined
        : found;
    const symbol = occurrence ?? ce.symbol(name);
    let valueDef: { inferredType: boolean } | undefined;
    if (occurrence !== undefined && isSymbol(occurrence))
      valueDef = occurrence.valueDefinition;
    else {
      const def = ce.lookupDefinition(name);
      valueDef = isValueDef(def) ? def.value : undefined;
    }
    const declared = valueDef !== undefined && !valueDef.inferredType;
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
 * The type `t` as a host writes it in a declaration. The type printer
 * leaves out the entry type `number` of a vector or a matrix
 * (`matrix<number>` prints `matrix`), and a diagnostic that asks for
 * `matrix<real>` must show the `number` it replaces. The type report of a
 * compilation (`freeSymbolTypes`) and the run-time entry diagnostic of the
 * JavaScript runner both use this spelling, so that one symbol has one
 * spelling in both.
 */
export function declaredTypeText(t: Type): string {
  // A tensor of unknown rank with `number` cells prints `tensor` (the
  // printer leaves the cell type out); the diagnostic shows the cells.
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    t.elements === 'number' &&
    t.dimensions === null
  )
    return 'tensor<number>';
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    t.elements === 'number' &&
    t.dimensions &&
    (t.dimensions.length === 1 || t.dimensions.length === 2)
  ) {
    const head = t.dimensions.length === 1 ? 'vector' : 'matrix';
    if (t.dimensions.every((d) => d < 0)) return `${head}<number>`;
    const dims = t.dimensions.map((d) => (d < 0 ? '?' : `${d}`)).join('x');
    return `${head}<number^${dims}>`;
  }
  return typeToString(t);
}

/**
 * The type the code compiled for a target without a `loweredSymbolType`
 * hook reads the free symbol `symbol` as, from its engine type and its
 * lane: the runner's value convention on JavaScript (`number`, `complex`,
 * `boolean`, `string`, `color`, `point`, `array`, `function`), `interval`
 * for a real number on interval-js, and the Python value types on Python.
 * `undefined` when the type says none of these.
 */
export function defaultLoweredSymbolType(
  symbol: Expression,
  language: string | undefined
): string | undefined {
  const t = symbol.type.type;
  const python = language === 'python';
  if (core.isComplexValued(symbol) || isNonRealNumber(t)) return 'complex';
  if (isSubtype(t, 'boolean')) return python ? 'bool' : 'boolean';
  // A symbol with no type information (`unknown`) is read as a real
  // number, as the shader targets read it as a `float`.
  if (t === 'unknown' || isSubtype(t, 'number'))
    return python
      ? 'float'
      : language === 'interval-javascript'
        ? 'interval'
        : 'number';
  if (isSubtype(t, 'string')) return python ? 'str' : 'string';
  // A colour, or a colour operand whose type admits the other colour
  // spellings (`color | string | tuple`, the type of `a` after
  // `ColorMix(a, b, 0.5)`).
  if (
    !python &&
    (isSubtype(t, 'color') ||
      (isSubtype('color', t) && isSubtype(t, 'color | string | tuple')))
  )
    return 'color';
  if (isTupleShapedType(t)) return python ? 'tuple' : 'point';
  if (isSubtype(t, COLLECTION_SHAPE_TYPE)) return python ? 'list' : 'array';
  if (!python && isSubtype(t, 'function')) return 'function';
  return undefined;
}

/**
 * The `mode`/`promoted` fields every built-in result carries (see
 * `CompilationResult`): the report frozen when the most recent outermost
 * compilation ended (`_lastReport`) — the RESOLVED discipline the code was
 * compiled under, and whether a promotable head was lowered through a
 * complex kernel.
 *
 * `mode` is the latched DISCIPLINE, with `'auto'` collapsed to `'strict'`
 * (`'auto'` is never reported: it is a policy over the two disciplines —
 * try strict, escalate on a `LaneMismatch` — not one code can be compiled
 * under), widened to `'complex'` when a promotable head was promoted. So it
 * is `'complex'` when the complex discipline was requested, when `auto`
 * escalated to it on a retry, and when `auto`'s first attempt promoted a
 * head without escalating.
 *
 * It is NOT a lane oracle: an operand that is already complex-TYPED
 * (`Sqrt(z)` with `z: complex`) or a complex literal (`2i·x`) routes
 * through the complex kernel in every discipline, and
 * `promotesRadicalToComplex` deliberately does not count that as a
 * promotion — `promoted` reports a lane DIFFERENCE with the shader targets,
 * which only an unknown-sign real-shaped operand creates. Such a compile
 * emits `{re, im}` and still reports `mode: 'strict'`. Test a returned
 * value's shape with `typeof v === 'number'`, not with `mode`.
 *
 * `mode === 'complex'` is implied by `promoted === true`; the two still
 * differ, since an explicitly requested `'complex'` compile that contained
 * no promotable head reports `('complex', false)`.
 *
 * A DECLINE reports the neutral `('strict', false)`: the report describes
 * emitted code, and a decline emitted none (see `compile`'s `finally`).
 */
export function modeReport(): {
  mode: 'strict' | 'complex';
  promoted: boolean;
} {
  return { ...CompilerState._lastReport };
}

/**
 * The report of a compilation that declined: `strict` and not promoted,
 * since no code was emitted. It is not read from `_lastReport`, because a
 * decline can be thrown before the outermost `compile()` resets it (the
 * `AbsArg` refusal of `rewriteAngularUnit()` at a target's entry), and
 * `_lastReport` then still holds the report of the previous compilation.
 */
export function declineReport(): { mode: 'strict'; promoted: false } {
  return { mode: 'strict', promoted: false };
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
  // The color value of an evaluated color node, or `undefined` when `e` is
  // not one. The interpreter spells a color as one of five typed heads
  // (`library/colors.ts`), and the head names the space its three channels
  // are in — the same five spaces a compiled color value carries.
  //
  // The alpha follows the compiled runtime's rule (`normalizeAlpha`): an
  // absent, non-finite or effectively-1 alpha is `undefined`, so the two
  // routes answer the same object for an opaque color.
  const interpretedColorValue = (e: Expression): CompiledColor | undefined => {
    if (!isFunction(e)) return undefined;
    const space = INTERPRETED_COLOR_SPACES[e.operator];
    if (space === undefined) return undefined;
    const ops = e.ops;
    if (ops.length < 3) return undefined;
    // Each channel is numericized before it is read, for the reason
    // `interpretedRunValue` numericizes a scalar leaf: `evaluate()` stays
    // symbolic for an exact argument, and `.re` of a symbolic expression is
    // `NaN`.
    const channel = (i: number): number => ops[i].N().re;
    let alpha = ops.length >= 4 ? channel(3) : undefined;
    if (
      alpha === undefined ||
      !Number.isFinite(alpha) ||
      Math.abs(alpha - 1) < 1e-9
    )
      alpha = undefined;
    return {
      space,
      c0: channel(0),
      c1: channel(1),
      c2: channel(2),
      alpha,
    };
  };
  // The value an ABSENT interpreter result (`Missing`, `Undefined`) takes in
  // the compiled-runner value contract. Compiled code spells an absent value
  // by the kind of the position that holds it (`docs/ERROR-MODEL.md` §3): the
  // numeric marker `NaN` in a numeric position, and the target's object null
  // (`undefined` on JavaScript) in an object-domain position — a point, a
  // tuple, a list, a colour, a boolean, a string — and wherever the position
  // admits `missing` itself, since a written absence symbol lowers to the
  // object null so that an absent cell stays distinct from a `NaN` cell. The
  // fallback spells it the same way, so a host cannot tell from the value
  // which route ran. Without this rule every absent result was `NaN`, where
  // the compiled code answers `undefined` for the same absent point.
  //
  // The kind is read from the static type `t` of the position. When that
  // type says nothing (`unknown`, `any`, or no type), `hint` gives the kind
  // of the present sibling cells of the same collection; with no hint the
  // value is the spelling of a WRITTEN absence symbol on the target, since
  // a bare `Undefined` is typed `unknown` and compiles to that spelling
  // (`undefined` on JavaScript). A target that declares an absence
  // capability without an object axis (the shader targets, the interval
  // target) spells every absent value with its numeric marker, so the
  // fallback gives `NaN` there.
  //
  // A target that spells a written absence symbol with its NUMERIC marker
  // (the Python target, where a written `Missing` is `math.nan`) uses the
  // object null only for an absent value in an object-domain position (an
  // absent point is `None` there): a position whose type admits `missing`
  // gives `NaN` unless every other arm of the type is disjoint from
  // `number`.
  const hasObjectNull =
    compileTarget?.absence === undefined ||
    compileTarget.absence.object !== undefined;
  const writtenNumeric = compileTarget?.absence?.writtenSymbol === 'numeric';
  // Whether `t` admits `missing` as one of its own arms (not in a cell).
  const admitsMissing = (t: Readonly<Type>): boolean => {
    const r = resolveTypeForCompilation(t);
    if (r === 'missing') return true;
    return (
      typeof r !== 'string' && r.kind === 'union' && r.types.some(admitsMissing)
    );
  };
  const absentRunValue = (
    t: Readonly<Type> | undefined,
    hint: 'number' | 'object' | undefined
  ): number | undefined => {
    if (!hasObjectNull) return NaN;
    let typed = false;
    if (t !== undefined) {
      const r = resolveTypeForCompilation(t);
      if (r !== 'unknown' && r !== 'any') {
        typed = true;
        if (admitsMissing(r)) {
          if (!writtenNumeric) return undefined;
          const present =
            typeof r !== 'string' && r.kind === 'union'
              ? r.types.filter((x) => !admitsMissing(x))
              : [];
          return present.length > 0 &&
            present.every((x) => provablyDisjoint(x, 'number'))
            ? undefined
            : NaN;
        }
        if (isSubtype(r, 'number')) return NaN;
        if (provablyDisjoint(r, 'number')) return undefined;
      }
    }
    if (hint !== undefined) return hint === 'object' ? undefined : NaN;
    return typed || writtenNumeric ? NaN : undefined;
  };
  // The static type of cell `i` of a collection whose type is `t`: the
  // positional type of a tuple, the element type of a list, `undefined`
  // when the type does not say. The collection's own `missing` arm is
  // removed first: the collection is present, since it has cells. When `t`
  // is not a collection type at all, the collection is a cell of an outer
  // list whose type names only the scalar leaves (`[[1, Missing], [t, 2]]`
  // is typed `list<integer | missing | number>`), and that leaf type applies
  // to the cells at this depth too.
  const isCollectionType = (x: Readonly<Type>): boolean =>
    collectionElementType(x) !== undefined;
  const cellType = (
    t: Readonly<Type> | undefined,
    i: number
  ): Type | undefined => {
    if (t === undefined) return undefined;
    let r = resolveTypeForCompilation(t);
    if (typeof r !== 'string' && r.kind === 'union') {
      const arms = r.types
        .filter((x) => !admitsMissing(x))
        .map((x) => resolveTypeForCompilation(x));
      if (!arms.some(isCollectionType)) return r;
      if (arms.length !== 1) return undefined;
      r = arms[0];
    }
    if (typeof r !== 'string' && r.kind === 'tuple') return r.elements[i]?.type;
    return collectionElementType(r) ?? r;
  };
  const isAbsentValue = (e: Expression): boolean =>
    isSymbol(e, 'Missing') || isSymbol(e, 'Undefined');
  // Materialize an interpreted result matching the compiled-runner value
  // contract: a scalar yields a `number` (imaginary part exactly zero), a
  // `{re, im}` object (otherwise) or a boolean; a finite indexed collection
  // becomes a nested JS array of element values; an absent value is spelled
  // by `absentRunValue` from the static type `t` of its position. A scalar
  // leaf is numericized first — `evaluate()` correctly stays symbolic for an
  // exact argument (`ln(2)` evaluates to `Ln(2)`), and `.re` of a symbolic
  // expression is NaN, so without `.N()` every decline whose expression has
  // no non-symbolic evaluation would run to NaN instead of its value.
  const interpretedRunValue = (
    e: Expression,
    t?: Readonly<Type>
  ):
    | number
    | boolean
    | ComplexResult
    | CompiledColor
    | string
    | unknown[]
    | undefined => {
    if (isAbsentValue(e)) return absentRunValue(t, undefined);
    // A string is a JS string, as compiled code answers it. It is tested
    // before the collection rule below: a string is an indexed collection
    // of its grapheme clusters, which that rule read as an array of `NaN`.
    // A character (`isString` is false for it) is also a JS string, as
    // compiled code answers it: without this test the scalar rule below
    // read it as `NaN`. The same test serves a character cell of a list,
    // since the collection rule calls this function for each cell.
    if (isString(e) || isCharacter(e)) return e.string;
    // A COLOR node keeps its space. The interpreter answers a color as a
    // typed head — `Rgb(r, g, b)`, `Hsv(h, s, v)`, … — and the compiled
    // runtime's color value carries the same three channels plus the space
    // the head names, so a declining color expression comes back as the
    // color it denotes. Without this the numericization below reduced the
    // whole head to `NaN` (`.re` of a non-numeric expression), and a
    // declined color expression ran to a scalar `NaN` under the default
    // `fallback: true`.
    const color = interpretedColorValue(e);
    if (color !== undefined) return color;
    if (e.isCollection) {
      // The present cells are rendered first: when the type of an absent
      // cell says nothing, their kind is the hint for its spelling (a
      // list of points holds `undefined`, a list of numbers `NaN`).
      const cells = [...e.each()];
      const out = cells.map((c, i) =>
        isAbsentValue(c) ? undefined : interpretedRunValue(c, cellType(t, i))
      );
      const kinds = new Set(
        out
          .filter((v, i) => !isAbsentValue(cells[i]))
          .map((v) =>
            typeof v === 'number' || isComplexArg(v) ? 'number' : 'object'
          )
      );
      const hint =
        kinds.size === 1
          ? (kinds.values().next().value as 'number' | 'object')
          : undefined;
      return out.map((v, i) =>
        isAbsentValue(cells[i]) ? absentRunValue(cellType(t, i), hint) : v
      );
    }
    if (isSymbol(e, 'True')) return true;
    if (isSymbol(e, 'False')) return false;
    const n = e.N();
    if (isSymbol(n, 'True')) return true;
    if (isSymbol(n, 'False')) return false;
    if (isAbsentValue(n)) return absentRunValue(t, undefined);
    const im = n.im;
    // `im` is NaN for a symbolic residue (no numeric value): a number, not
    // an object, is the honest shape for "no value" — `re` is NaN too.
    if (im !== 0 && !Number.isNaN(im)) return { re: n.re, im };
    return n.re;
  };
  // The interpreter's value for a runtime argument: a `{re, im}` object is a
  // complex number, anything else boxes as it always did.
  const isComplexArg = (v: unknown): v is ComplexResult =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ComplexResult).re === 'number' &&
    typeof (v as ComplexResult).im === 'number';
  // A COLOR argument: the value shape a compiled runner answers for a color
  // (`CompiledColor`). The same test the compiled runtime makes — an object
  // whose `space` is one of the five spellings — so a color one runner
  // produced can be handed straight back in as a `vars` value.
  const isColorArg = (v: unknown): v is CompiledColor =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CompiledColor).space === 'string' &&
    (v as CompiledColor).space in COLOR_SPACE_HEADS &&
    typeof (v as CompiledColor).c0 === 'number';
  // A JS ARRAY is a collection VALUE — the runner-argument shape of a list
  // or point parameter (`{ P: [[0, 0], [3, 4]] }`) — not MathJSON:
  // `ce.expr([1, 2])` reads it as an application and boxes an
  // `unexpected-mathjson` error, so a list-valued argument ran the
  // interpreter against an error value (Tycho item 234). Box it element by
  // element, guided by the parameter's DECLARED type when one is in scope:
  // an array in a `tuple<…>` position is a point, in a `list<…>` position
  // a list whose elements follow the list's element type, and with no type
  // evidence an array is a `List` — the same reading `PointList` and the
  // compiled runtime give a bare array.
  const boxArg = (v: unknown, type?: Type): Expression => {
    if (isComplexArg(v)) return ce.number(ce.complex(v.re, v.im));
    // A JS string is a string VALUE. `ce.expr` reads a string as MathJSON,
    // where `"abc"` is the SYMBOL `abc`, so the interpreter read a text
    // argument as an unknown symbol.
    if (typeof v === 'string') return ce.string(v);
    // A color VALUE boxes to the typed head that names its space, with its
    // channels as operands and its alpha as a fourth. Without this the
    // object reached `ce.expr` as MathJSON and boxed to an error, so a
    // color a compiled runner produced could not be fed back into a
    // declining color expression.
    if (isColorArg(v)) {
      const ops = [ce.number(v.c0), ce.number(v.c1), ce.number(v.c2)];
      if (v.alpha !== undefined) ops.push(ce.number(v.alpha));
      return ce.function(COLOR_SPACE_HEADS[v.space], ops);
    }
    if (Array.isArray(v)) {
      const t = type === undefined ? undefined : resolveTypeAlias(type);
      if (typeof t !== 'string' && t?.kind === 'tuple')
        return ce.function(
          'Tuple',
          v.map((x, i) => boxArg(x, t.elements[i]?.type))
        );
      const elt =
        typeof t !== 'string' &&
        (t?.kind === 'list' || t?.kind === 'indexed_collection')
          ? t.elements
          : undefined;
      return ce.function(
        'List',
        v.map((x) => boxArg(x, elt))
      );
    }
    return ce.expr(v as never);
  };
  // The declared type of a free symbol of `expr`, when it has one in the
  // scope the fallback was built in — the shadow declared by `run` below
  // must admit the argument value under that declaration's shape.
  const declaredTypeOf = (k: string): Type | undefined => {
    const def = ce.lookupDefinition(k);
    if (!isValueDef(def)) return undefined;
    const t = def.value.type.type;
    return t === 'unknown' || t === 'any' ? undefined : t;
  };

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

  // A function literal (lambda) uses the positional `lambda` calling
  // convention — `run(a, b, ...)`. The fallback must mirror that by applying
  // the function to its positional arguments via the interpreter; otherwise
  // positional arguments are silently dropped.
  if (isFunction(expr, 'Function')) {
    // A positional argument is boxed under its parameter's declared type
    // (`(p: tuple<number, number>) -> …` receives `[0, 0]` as a POINT), as
    // the vars-object convention below does through `declaredTypeOf`.
    const paramTypes = functionLiteralParameters(expr).map((p) => p.type);
    // The absent result is spelled by the static type of the application,
    // which is the function's result type for these arguments.
    const lambdaRun = ((...args: unknown[]) => {
      const applied = ce.function('Apply', [
        expr,
        ...args.map((a, i) => boxArg(a, paramTypes[i])),
      ]);
      return interpretedRunValue(applied.evaluate(), applied.type.type);
    }) as unknown as CompiledRunner;
    return {
      target: targetName,
      success: false,
      code: '',
      calling: 'lambda',
      run: lambdaRun,
      error,
      diagnostic,
      ...declineReport(),
      ...refs,
      ...fallbackTypes(),
    } as CompilationResult<T>;
  }

  // Otherwise the expression uses the `expression` calling convention:
  // `run({ x, y, ... })` with a variables object.
  const fallbackRun = ((vars: Record<string, unknown>) => {
    ce.pushScope();
    try {
      if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
          // Declare a fresh local shadow before assigning so `popScope` fully
          // restores the previous state (a bare `assign` would mutate an
          // outer/global binding and leak the argument value engine-wide).
          // The shadow's type is the value's RUNTIME shape: a `{re, im}`
          // object is a complex number (declaring it `number` would reject
          // the assignment and run the expression against an unbound
          // symbol), a string is a string, a boolean a boolean, and a
          // number is a number.
          if (isComplexArg(v)) {
            ce.declare(k, 'complex');
            ce.assign(k, ce.number(ce.complex(v.re, v.im)));
          } else if (isColorArg(v)) {
            // A COLOR argument: the shadow takes the boxed color's own type
            // (`color`), which is what a color position admits. Declaring it
            // `number` below would reject the assignment and run the
            // expression against an unbound symbol.
            const boxed = boxArg(v);
            ce.declare(k, boxed.type.type);
            ce.assign(k, boxed);
          } else if (Array.isArray(v)) {
            // A collection argument: the shadow takes the value's own
            // type (a `List` of points types `list<tuple<…>>`), which is
            // what the expression's typing of the parameter admits.
            const boxed = boxArg(v, declaredTypeOf(k));
            ce.declare(k, boxed.type.type);
            ce.assign(k, boxed);
          } else if (typeof v === 'string') {
            // A string argument is a string. Declaring it `number` below
            // rejected the assignment, and a string that is a valid
            // identifier was read as a symbol.
            ce.declare(k, 'string');
            ce.assign(k, ce.string(v));
          } else if (typeof v === 'boolean') {
            // A boolean argument is a boolean, which `number` rejects too.
            ce.declare(k, 'boolean');
            ce.assign(k, v ? ce.True : ce.False);
          } else {
            ce.declare(k, 'number');
            ce.assign(k, v as number);
          }
        }
      }
      return interpretedRunValue(expr.evaluate(), expr.type.type);
    } finally {
      ce.popScope();
    }
  }) as unknown as CompiledRunner;
  return {
    target: targetName,
    success: false,
    code: '',
    calling: 'expression',
    run: fallbackRun,
    error,
    diagnostic,
    ...declineReport(),
    ...refs,
    ...fallbackTypes(),
  } as CompilationResult<T>;
}
