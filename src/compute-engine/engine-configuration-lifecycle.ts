import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../common/cache-stats.js';
import { runWhenIdle } from '../common/computation-depth.js';
import { sharedEvaluationStarts } from './boxed-expression/shared-evaluation-memo.js';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

/**
 * A semantic state change used to classify cache invalidation. Write sites
 * report what changed; {@link axisMaskOf} selects the affected cache axes.
 */
export type StateEvent =
  | {
      kind: 'value-write';
      ephemeral: boolean;
      callable: boolean;
      /** A type computation can read the value written: the definition is
       * a constant, or the write is `callable` and the definition is not
       * held by activations (`storedValue`). Only such a write advances the
       * type version: see `typeVersion`. */
      typeRead: boolean;
    }
  | {
      kind: 'declare';
      callable: boolean;
      shadowsCallable: boolean;
      /** The declaration's target scope is a registered scratch scope, or a
       * scope created under one (`scratch-scopes.ts`), so the binding cannot
       * outlive the computation that registered it. See "Scratch events" in
       * the documentation of {@link axisMaskOf}. */
      scratch?: boolean;
      /** The declaration binds a parameter of a function literal, or a local
       * of a block, at its first reference while the body is canonicalized,
       * into the body's own scope (`isShadowedParameterDeclaration`,
       * `engine-declarations.ts`). See the `declare` case of
       * {@link axisMaskOf}. */
      parameter?: boolean;
      /** The declaration gives a
       * value to a name that the engine made a free name for
       * (`ce.assign('ws', …)` for a name that was only boxed), outside the
       * parameter bindings of a call, or declares a function of that name.
       * A free name boxed before it reads that value from now on (a call
       * with a free head applies the function), so the declaration advances
       * the `semantic` axis as a value write does. */
      installsValue?: boolean;
      /** The declaration installs a value, or replaces a binding of the
       * name, in a scope that a frame on the evaluation stack reads
       * (`changesFrameBinding`, `engine-declarations.ts`). It advances the
       * evaluation version. */
      changesFrameBinding?: boolean;
      /** The declaration is made in the new scope of a call of a function
       * literal (a parameter or a destructured leaf of one), before the
       * frame of the call is pushed (`isPendingCallScope`). It advances the
       * `any` version but not the type version: see `typeVersion`. */
      activation?: boolean;
    }
  // variance settle, callable-swap repair, minted-ctor removal
  | {
      kind: 'binding-repair';
      /** The repaired binding lives under a registered scratch scope
       * (`scratch-scopes.ts`). See "Scratch events" in the documentation of
       * {@link axisMaskOf}. */
      scratch?: boolean;
      /** The repair installs the first binding of a name in its scope (a
       * FRESH declaration, `updateDef`). It does not advance the definition
       * version: see `noteStateEvent`. */
      fresh?: boolean;
      /** Set only with `scratch` and `fresh`: the first binding of the name
       * above the target scope lives outside every registered scratch scope,
       * so an existing expression can read it by name and reads the new
       * binding from now on (`updateDef`). See the `binding-repair` case of
       * {@link axisMaskOf}. */
      shadowing?: boolean;
    }
  | { kind: 'redefine'; callableBefore: boolean; callableAfter: boolean }
  | { kind: 'type-write'; callableBefore: boolean; callableAfter: boolean }
  | {
      kind: 'scope-pop';
      assumptionsDirty: boolean;
      transient?: boolean;
      /** No cache axis advanced while this assumption-free scope was active,
       * so popping it cannot invalidate a version-keyed entry. */
      clean?: boolean;
      /** The pop of the frame of a call of a function literal
       * (`_bindsValues`) that would be clean but for the values of the
       * parameters: no assumption changed, and the type version, the
       * semantic version and the world version did not advance while the
       * frame was on the stack. It advances the `any` version but not the
       * type version: see `typeVersion`. */
      activation?: boolean;
    }
  | { kind: 'assumption' } // assume / forget
  /** `valueType`: a symbol's value type was written by an inference.
   * `widening`: the new type is not a subtype of the old one — a `widen` or
   * `replace` inference, a narrowing whose result is not below the previous
   * type, or the rollback of a narrowing putting the wider type back. Only an
   * event without it is a true narrowing. */
  | {
      kind: 'inference';
      symbolSignature?: boolean;
      valueType?: boolean;
      widening?: boolean;
      /** The inferred binding lives under a registered scratch scope
       * (`scratch-scopes.ts`). See "Scratch events" in the documentation of
       * {@link axisMaskOf}. */
      scratch?: boolean;
      /** Set only on a true narrowing: the bindings are the parameters of
       * a function literal whose boxing ends, and no evaluation that keeps
       * its result in the memo of shared evaluations started since that
       * boxing started (`ParameterRecord.memoStarts`). It does not advance
       * the evaluation version: see `noteStateEvent`. */
      parameter?: boolean;
    }
  /** The deferred half of a value-type inference: see `noteStateEvent`. */
  | { kind: 'inference-settled' }
  | { kind: 'config' } // precision, tolerance, angularUnit, maxCollectionSize, jit, reset, type-statement redefinition
  /** A mutable-object field write, invalidated through per-object versions. */
  | { kind: 'object-store' };

/** Which axes an event advances. */
export type AxisMask = {
  any: boolean;
  semantic: boolean;
  world: boolean;
};

/** Whether an event can change the cached effects of a callable expression. */
export function callableAxisSelects(e: StateEvent): boolean {
  switch (e.kind) {
    case 'assumption':
    case 'inference':
    case 'config':
      return true;
    case 'binding-repair':
      // A new name in a scratch scope has no reader (see `axisMaskOf`).
      return !(e.scratch === true && e.fresh === true && e.shadowing !== true);
    case 'redefine':
    case 'type-write':
      return e.callableBefore || e.callableAfter;
    case 'scope-pop':
      return e.assumptionsDirty;
    case 'value-write':
      return e.callable;
    case 'declare':
      // A scratch binding dies with the scope it was declared into (see
      // `axisMaskOf`), so it cannot change any cached callable's effects
      // either.
      return !e.scratch && (e.callable || e.shadowsCallable);
    case 'object-store':
      // A field store changes no declaration, binding, or signature.
      return false;
    case 'inference-settled':
      // The `inference` event it follows already selected this axis.
      return false;
  }
}

/**
 * `CE_OBJECT_STORE_BUMPS_ANY`: the field-store canary.
 *
 * Field stores normally use the per-object version channel in
 * `boxed-expression/object-deps.ts`, not an engine-wide cache axis.
 *
 * Setting this environment variable makes every store additionally advance the
 * engine-wide `any` version. If this removes a stale result, a cache family is
 * missing object-dependency tracking. This is a diagnostic flag, not a
 * semantic mode.
 */
const OBJECT_STORE_BUMPS_ANY: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_OBJECT_STORE_BUMPS_ANY;
  return flag !== undefined && flag !== '0';
})();

/**
 * Return the cache axes invalidated by an event. This pure mapping is exported
 * so `state-events.test.ts` can pin every event and payload combination.
 *
 * Scratch events. A `declare`, `binding-repair` or `inference` event can carry
 * `scratch: true`: the binding it writes lives in a scope that a running
 * computation registered as scratch, or in a scope created under one
 * (`scratch-scopes.ts`). The registrars are the `withScratchScope` calls of
 * `resultUnderDeclaredParameters`, which boxes a copy of a function literal
 * under the declared parameter types, and of the two value shields
 * (`simplifyValueBlind` in `boxed-expression/simplify.ts`, `withValueShield`
 * in `boxed-expression/utils.ts`), which register it only while their
 * shadow declarations are made. The computation discards that scope when it
 * returns. A persistent scope that an evaluation inside the computation
 * chains onto the scratch scope (the local scope of a block or a sum,
 * `pushEvalContext` in `engine-scope.ts`) is not under it for this test:
 * the walk follows the link the scope had before it was chained
 * (`scratchRootOf`), so a `Declare` run by such a block keeps its axis
 * advance. For the signature derivation, only the expressions it builds
 * there resolve a name to a binding in it. A value shield is different: it
 * shadows a name whose VALUE existing expressions read by name, through the
 * current scope chain, and that is its purpose. Those expressions would
 * cache value-blind answers under the outer cache key, and serve answers
 * derived from the value inside the shield, so a shield also runs under a
 * cache key of its own (`IComputeEngine._withValueShieldKey`), which
 * separates the two sides without advancing any axis. So no cache that
 * outlives the computation can depend on the binding, and the three scratch
 * events leave the `semantic` and `world` axes and the definition version
 * alone: those are what such caches key on (the memo of a derived signature
 * reads all three, `declaredResultMemoKey`).
 *
 * The three kinds differ only in the axes that the computation's OWN caches
 * key on. A scratch `binding-repair` or `inference` changes a binding that
 * already exists, and expressions the computation built earlier may have
 * cached a type (`any` axis) or an effect set (`callable` axis) from it. So
 * both still advance `any` and `callable`. The exception is the repair that
 * a declaration of a NEW callable name emits (`fresh`, and no `shadowing`):
 * no binding existed for an expression to read, so it advances nothing, as
 * a scratch `declare` does (the `binding-repair` case below). A value-type
 * inference advances `any` later, through the deferred `inference-settled`
 * event (`noteStateEvent`), as it does for any binding. A scratch `declare` makes a
 * new binding that no expression has resolved to yet (an expression binds its
 * names when it is canonicalized, and a new declaration does not rebind it),
 * so it advances neither `any` nor `callable`.
 */
export function axisMaskOf(e: StateEvent): AxisMask {
  switch (e.kind) {
    case 'value-write':
      return { any: true, semantic: !e.ephemeral, world: false };
    case 'declare':
      // A SCRATCH declaration advances nothing (see "Scratch events" above).
      // It is emitted from INSIDE a computation whose caches key on the `any`
      // axis, and advancing the axis retires the `_type`/`_sgn` cache of every
      // expression in the engine, including the sources the enclosing
      // computation is mid-way through reading. Historical note: the
      // exemption was added when the `Map` type handler derived a bare
      // mapping's element type by declaring stand-ins in a scope it
      // registered around one probe; for a chain of nested lazy `Map` views
      // the advances turned each level into a fresh recursive descent
      // (measured 998K handler invocations and 2.0M axis advances in ONE
      // `PointList` evaluation, about 17 s, against 5 ms before). That
      // handler no longer registers a scope; the registrars are
      // `withScratchScope` calls in `resultUnderDeclaredParameters` and in
      // the two value shields (`simplifyValueBlind` in `simplify.ts`,
      // `withValueShield` in `utils.ts`). Same remedy as the `clean`
      // scope-pop flag below.
      //
      // The soundness condition is ONE property, and it is established
      // mechanically rather than by a caller's promise: the declaration's
      // resolved target scope is itself a scope some computation on the stack
      // registered as scratch (`_scratchDeclarationScopes`), or a scope
      // created under one (`scratchRootOf`, `scratch-scopes.ts`), so the pop
      // that ends that computation discards the binding. A scope created
      // under a scratch scope is reached only from the expressions the
      // computation builds there: the local scope of the copy of a function
      // literal that a signature derivation boxes and then drops
      // (`resultUnderDeclaredParameters`). `declareSymbolValue` and
      // `declareSymbolOperator` set the flag only on that test, so a
      // declaration aimed anywhere else keeps its axis advance even when made
      // during a scratch extent. That matters: canonicalizing the probe can
      // declare into scopes that OUTLIVE it — a function literal's
      // `block.localScope` (`function-utils.ts`), a protocol member's
      // explicit scope (`engine-protocols.ts`) — and exempting those would
      // leave stale `_type`/`_sgn` answers engine-wide, the exact class of
      // bug this axis exists to prevent. A colliding name is harmless for the
      // same structural reason: it shadows inside a scope that is discarded.
      if (e.scratch) return { any: false, semantic: false, world: false };
      // The auto-declaration of a PARAMETER (or a hoisted block local) at
      // its first reference, while the literal's body is canonicalized,
      // into the body's own scope, advances nothing either. The `any` axis
      // retires the `_type`/`_sgn` cache of every expression because a
      // declaration can change what a name resolves to. A name is resolved
      // by walking UP the scope chain from the scope it is read in, so a
      // binding that appears in a scope can only change the resolution of a
      // read made in that scope or below it. The body scope was created by
      // the canonicalization that is running, so the only reads below it are
      // the body's own, and the shadowed-name frame routes every reference
      // of the name in the body to one binding: the first reference makes
      // it (this declaration), and every later one reuses it
      // (`_shadowedParameterDef`), including a reference in a sibling or
      // nested block. No read of the name was resolved before this
      // declaration, so no cached answer depends on its absence. The
      // declaration of a parameter the body never mentions, made after the
      // frame is popped, is not exempt: the body scope may be one that
      // already existed (`canonicalFunctionLiteralArguments` keeps a canonical
      // `Block` as it is), with reads resolved through it before.
      //
      // Measured on the chain of Tycho ledger row 380 (a user function
      // applied to its own result, each level building ten lazy broadcast
      // maps with parameters `_1`, `_2`, …): these declarations advanced
      // the axis ten times per level, each advance retired the inert
      // evaluation memo of every node, and the next read of a held tree
      // walked and copied it again, so the result's distinct nodes grew
      // quadratically with the depth.
      if (e.parameter) return { any: false, semantic: false, world: false };
      return { any: true, semantic: e.installsValue === true, world: false };
    case 'binding-repair':
      // The repair of a NEW name declared in a scratch scope advances
      // nothing: it is `scratch` and `fresh` (the target scope held no
      // binding of the name), and it shadows no binding outside the scratch
      // scopes (`shadowing` is not set). No expression can have read the
      // binding: an expression binds its names when it is canonicalized,
      // the name resolved to nothing visible outside the computation before
      // the declaration, and the scratch scope is popped before any
      // expression outside the computation runs. This is the rule of a
      // scratch `declare` (below), for the event that a declaration of a
      // callable name emits in addition to it. The private copies that the
      // compiler declares for a user function with a library name
      // (`withShadowingCallsRenamed()`, `compilation/shadowing-calls.ts`)
      // are such declarations. A fresh scratch declaration that shadows a
      // binding outside the scratch scopes (a value shield of a
      // function-valued symbol) keeps its advance: existing expressions read
      // that name through the current scope chain.
      if (e.scratch === true && e.fresh === true && e.shadowing !== true)
        return { any: false, semantic: false, world: false };
      // Any other SCRATCH repair (the auto-declared head `b` of `b(x)` in the
      // scope where a derivation boxes a function body again: the name
      // already has a binding there) advances `any`, as every repair does
      // (see "Scratch events" above).
      return { any: true, semantic: false, world: false };
    case 'redefine':
      // A zero-mask redefinition is valid only when an accompanying value
      // write advances an axis. Otherwise a stale cache could survive a scope
      // that `discardEvalContext` classifies as clean.
      return e.callableAfter
        ? { any: false, semantic: true, world: true }
        : { any: false, semantic: false, world: false };
    case 'type-write':
      // `_sgn` and `_type` use the `any` version in their cache keys.
      return { any: true, semantic: false, world: false };
    case 'scope-pop':
      return {
        // A clean scope changed no cache axis, so its removal invalidates
        // nothing. A transient scope advances `any` only when it reverts an
        // assumption.
        any: (!e.transient && !e.clean) || e.assumptionsDirty,
        semantic: e.assumptionsDirty,
        world: e.assumptionsDirty,
      };
    case 'assumption':
      return { any: true, semantic: true, world: true };
    case 'inference':
      // Value-type inference can run while `_type` and `_sgn` are being
      // computed. Advancing their cache axis here would invalidate that
      // computation recursively. Signature inference is not self-triggered and
      // can safely advance all axes.
      //
      // The recursion comes from the in-flight window of `cachedValue`
      // (`boxed-expression/cache.ts`): a cell being computed is stamped with
      // the generation it was read at, and a re-entrant read with the same
      // generation is served from the cell. After an advance, a re-entrant
      // read has a new generation, so it computes the cell again. When each
      // of these computations sends the same inference again, the recursion
      // does not end.
      //
      // One exception: a WIDENING value-type inference advances `any` at
      // once, on a scratch binding or on any other binding. Work that runs
      // inside a cached computation (for example the boxing of a function
      // body by a signature derivation, which a `_type` read can reach) would
      // otherwise see the advance only after the outermost computation
      // returns. A type cached before the widening (`x + 1` typed `integer`)
      // would then be served again after `x` became `real`: a type too
      // narrow, which is wrong, not only loose.
      //
      // The recomputation that this advance causes is bounded:
      // - The `widen` and `replace` writes, and a `narrow` write whose result
      //   is not a subtype of the previous type (which also sends the
      //   widening flag), are made when an expression is canonicalized (the
      //   block evidence sites, the repair of a juxtaposition head, the
      //   validation of a function literal, the inference cause of a
      //   narrowing), not by a type handler, so computing a type again does
      //   not make them again. The undo of a rollback frame runs once. This
      //   is the bound. Canonicalization can itself run inside a cached
      //   computation (a type handler that reads a canonical form), but a
      //   second canonicalization of the same expression makes the same
      //   write again, and `_infer` (`boxed-symbol.ts`) sends no event for a
      //   write of a type equal to the recorded type: the same object, or a
      //   type built as an object that prints the same and is a subtype of
      //   the recorded type both ways.
      // - A recursive body does not start a second derivation of the same
      //   signature: while one runs, `_derivingSignature` (in both
      //   definition classes) serves the re-entrant read with the stored
      //   signature.
      // - The outer computations on the stack store their results under the
      //   generation they were read at, which is then past, so each is
      //   computed again at its next read, as after a deferred advance.
      //
      // These bounds do not depend on where the binding lives: a binding
      // outside a scratch scope is also read by expressions outside the
      // computation, but those reads only see a newer generation and compute
      // their type once more.
      //
      // A narrowing keeps the deferred advance because it can only leave a
      // cached type wider than it could be, never wrong. Narrowings are made
      // at canonicalization too: over 143 test files about inference,
      // assumptions, typing, caches, blocks and loops, and the Epsil tests
      // (measured 2026-11-01), the value-type inferences made while a cached
      // computation was running were all narrowings made by a
      // canonicalization that a computation reached (`checkNumericArgs`,
      // the binding of a loop index); none was made by a type handler. Over
      // the same files, an immediate advance for every value-type inference,
      // narrowings included, did not bring back the recursion described
      // above, but it changed inferred types: in
      // `parameter-index-read-inference.test.ts`, a symbol read by index
      // and passed to a call was typed `indexed_collection<number>`, not
      // `tuple<number, number>`.
      if (e.valueType)
        return e.widening
          ? { any: true, semantic: false, world: false }
          : { any: false, semantic: false, world: false };
      // A value-type inference on a SCRATCH binding that is not a widening
      // takes the branch above: its `any` advance is the deferred
      // `inference-settled` event. Any other SCRATCH inference advances `any`
      // at once, and not `semantic` or `world` (see "Scratch events" above).
      if (e.scratch) return { any: true, semantic: false, world: false };
      if (e.symbolSignature) return { any: true, semantic: true, world: true };
      return { any: true, semantic: true, world: true };
    case 'config':
      return { any: true, semantic: true, world: true };
    case 'inference-settled':
      // Types and signs cached before a value-type inference narrowed a
      // symbol are outdated; see `noteStateEvent`. Only the axis that the
      // `_type` and `_sgn` caches key on advances, as for a `type-write`.
      return { any: true, semantic: false, world: false };
    case 'object-store':
      // Field-derived cache entries carry `(object, version)` dependencies and
      // revalidate independently of engine-wide versions. The diagnostic flag
      // below can additionally cold generation-keyed caches when investigating
      // a missing dependency.
      return OBJECT_STORE_BUMPS_ANY
        ? { any: true, semantic: false, world: false }
        : { any: false, semantic: false, world: false };
  }
}

export class EngineConfigurationLifecycle {
  private _anyVersion = 0;
  private _typeVersion = 0;
  private _semanticVersion = 0;
  private _worldVersion = 0;
  private _callableVersion = 0;
  private _definitionVersion = 0;
  private _evaluationVersion = 0;
  private _persistentEvaluationVersion = 0;
  private _ephemeralWriteDepth = 0;
  private _factSuppressionDepth = 0;
  private _scratchDeclarationScopes: object[] = [];
  private _scratchAnyAdvances = 0;
  private _scratchCallableAdvances = 0;
  /** A deferred `inference-settled` advance is waiting (`noteStateEvent`). */
  private _inferencePending = false;
  /** `sharedEvaluationStarts()` when the waiting `inference-settled`
   * advance was scheduled. */
  private _startsAtInference = 0;
  private _tracker = new ConfigurationChangeTracker();

  get anyVersion(): number {
    return this._anyVersion;
  }

  /**
   * The version that keys the type cache of a function expression
   * (`BoxedFunction.type`). It advances with the `any` version, except for
   * the write of a value that no type computation reads (a `value-write`
   * without `typeRead`) and for the events of a call of a function literal:
   * the declaration of its parameters in the new scope of the call, and the
   * pop of its frame (the `activation` flag of the `declare` and
   * `scope-pop` events).
   *
   * A static type does not depend on a value: in a type computation a
   * definition that is not a constant has no value, except a variable that
   * holds a function literal (`storedValue`, `boxed-value-definition.ts`).
   * A write that changes the TYPE of a definition reports a `type-write`
   * of its own.
   *
   * Without this exception each call moved the key of every cached type,
   * and all of them were computed again, with the same result. A call of
   * the issue #487 function (8 nested `Fold`s, 75 calls of function
   * literals) recomputed 6,332 types, each to the same answer, and took
   * about 100 ms instead of about 19 ms from source (ROADMAP CE-689).
   *
   * This is sound because a type computation reads the bindings in the
   * static view (`static-typing-view.ts`): a read by name, or a read of the
   * value of a symbol, does not find the bindings that a call made, but the
   * bindings of the function literal, as they are outside every call. So a
   * type does not depend on the values that a call gives the parameters,
   * and the events of a call cannot change it. The sign and value caches
   * stay keyed on the `any` version: they depend on the values of the
   * parameters (the sign of `x + 1` in a call with `x = 3` and in the next
   * call with `x = -5`).
   */
  get typeVersion(): number {
    return this._typeVersion;
  }

  get semanticVersion(): number {
    return this._semanticVersion;
  }

  get worldVersion(): number {
    return this._worldVersion;
  }

  get callableVersion(): number {
    return this._callableVersion;
  }

  /** Advanced by every event that can change the value that a node
   * evaluates to in an evaluation frame that is still on the stack: a value
   * write (a loop index included), a redefinition, a retype, an inference,
   * an assumption, a configuration change, a binding repair, a store to an
   * object, a declaration that shadows a callable or that installs a value
   * or replaces a binding in a scope that a frame on the stack reads
   * (`changesFrameBinding`), and the pop of a scope
   * that reverts an assumption. It is not advanced by the other
   * declarations and scope pops: a function call declares its parameters
   * in a new scope, read only by the nodes evaluated in the new frame of
   * the call, and pops the frame when it returns, which gives back the
   * bindings of the caller's frame unchanged. The memo of the evaluations
   * of shared nodes keys on this counter (`shared-evaluation-memo.ts`):
   * if a call advanced it, the nodes evaluated in the caller's frame after
   * the call would be evaluated again, and an expression that shares a
   * node with a call in it would take exponential time again. */
  get evaluationVersion(): number {
    return this._evaluationVersion;
  }

  /** The {@link evaluationVersion} less the ephemeral value writes (the
   * index of a `Sum` or of a loop, written in the scope of its binder and
   * gone when the binder returns). The evaluator reads it before and after
   * the call of a host handler (`host-handler-changes.ts`): a handler that
   * evaluates a `Sum` has changed no state that outlives the call. */
  get persistentEvaluationVersion(): number {
    return this._persistentEvaluationVersion;
  }

  /** Advanced when an existing definition changes: a symbol retyped (a
   * `type-write`), a declaration that SHADOWS a callable (a name that held a
   * function now resolves to the new binding, in whatever scope), or any
   * other event that can change a callable (`callableAxisSelects`). A retype
   * of a scalar advances only the `any` axis, which every declaration also
   * advances; and a declaration of a parameter that may hold a function (an
   * `unknown` parameter) selects the `callable` axis without shadowing
   * anything. A cache that must follow those changes but must not be
   * invalidated by the declarations every function literal makes for its
   * parameters keys on this counter, and tracks the other declarations it
   * depends on per scope (`scopeChainDeclarationCount`). See
   * `declaredResultMemoKey`.
   *
   * A symbol narrowed by a use (an `inference` event with `valueType`, and
   * the `inference-settled` event that follows it) does not advance it:
   * those are frequent during type derivation, and counting them made a
   * Tycho document three times slower to register. A narrowing
   * can only make a cached result wider than it could be, never wrong. */
  get definitionVersion(): number {
    return this._definitionVersion;
  }

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  /** See `IComputeEngine._factSuppressionDepth`: while this is above zero the
   * assumptions store answers every QUERY as if it were empty. */
  get factSuppressionDepth(): number {
    return this._factSuppressionDepth;
  }

  set factSuppressionDepth(value: number) {
    this._factSuppressionDepth = value;
  }

  get scratchDeclarationScopes(): object[] {
    return this._scratchDeclarationScopes;
  }

  /**
   * The number of advances of the `any` version, and of the `callable`
   * version, that SCRATCH events made (a `declare`, `binding-repair` or
   * `inference` with `scratch: true`; see "Scratch events" in the
   * documentation of `axisMaskOf`). Each count is part of the version it
   * names: the version less the count is the number of advances made by the
   * other events. The repair that shadows a binding outside the scratch
   * scopes (`shadowing`, a value shield) is not counted: expressions outside
   * the computation read that name.
   *
   * The purity check of type handlers (`guardedTypeHandlerCall`,
   * `boxed-expression/operand-descriptor.ts`) compares the versions less
   * these counts. A type handler can read the type of a function literal for
   * the first time, and for a recursive literal that derives its signature:
   * the derivation boxes a copy of the body in a scratch scope, where a use
   * narrows a parameter (`n` in `n - 1`, from `unknown` to `number`). That
   * scratch inference advances the `callable` version at once. No cache that
   * outlives the computation keys on what a scratch event changes, so the
   * check does not report it.
   */
  get scratchAnyAdvances(): number {
    return this._scratchAnyAdvances;
  }

  get scratchCallableAdvances(): number {
    return this._scratchCallableAdvances;
  }

  /**
   * The only writer of the invalidation versions. Callers report a semantic
   * event, and the dispatch functions decide which versions advance.
   */
  noteStateEvent(e: StateEvent): void {
    // A value-type inference changes the type of a symbol that expressions
    // built earlier have cached types from (`l = List(x)` keeps `vector<1>`
    // after a use narrows `x` to `real`). A NARROWING does not advance the
    // `any` axis where it happens: it can happen while a `_type` or `_sgn` is
    // computed (a canonicalization that the computation reaches), and a late
    // advance can only leave a cached type wider than it could be. So the
    // advance runs when no cached computation is running (`runWhenIdle`).
    //
    // This holds for a SCRATCH binding too (`scratch-scopes.ts`): the
    // computation that owns the scratch scope may have cached a type while
    // the binding had the previous type, and `inference-settled` advances
    // only `any`, which no cache that outlives the computation keys on.
    //
    // A WIDENING, of a scratch binding or of any other binding, is the one
    // exception: it advances `any` where it happens, as well as here (the
    // `inference` case of `axisMaskOf` says why that is safe).
    if (e.kind === 'inference' && e.valueType && !this._inferencePending) {
      // One advance covers every inference made before it runs.
      this._inferencePending = true;
      this._startsAtInference = sharedEvaluationStarts();
      runWhenIdle(() => {
        this._inferencePending = false;
        this.noteStateEvent({ kind: 'inference-settled' });
      });
    }
    const m = axisMaskOf(e);
    const scratch =
      (e.kind === 'declare' ||
        e.kind === 'inference' ||
        e.kind === 'binding-repair') &&
      e.scratch === true;
    // The counts of `scratchAnyAdvances` and `scratchCallableAdvances` leave
    // out the repair that shadows a binding outside the scratch scopes (a
    // value shield of a function-valued symbol, `shadowing`): expressions
    // outside the computation read that name through the current scope
    // chain, so its advances are not private to the computation.
    const countsAsScratch =
      scratch && !(e.kind === 'binding-repair' && e.shadowing === true);
    // The evaluation version keys the memo of shared evaluations
    // (`shared-evaluation-memo.ts`). The persistent evaluation version moves
    // with it (less the ephemeral value writes), and a host handler call
    // during which it moved counts as a change of state
    // (`endHostHandlerCall`). Two events that advance other versions do not
    // always advance them:
    //
    // - the narrowing of the parameters of a literal flagged `parameter`
    //   does not: no result of the memo, kept or to be kept, can have read
    //   the type of those bindings before the narrowing
    //   (`canonicalFunctionLiteralArguments()`, `function-utils.ts`).
    // - `inference-settled` advances them only when an evaluation that
    //   keeps its result in the memo started after it was scheduled. Each
    //   inference that it follows advanced them when it was sent, except a
    //   narrowing flagged `parameter`. But a narrowing leaves the types
    //   cached on the nodes until this event runs, so a result computed in
    //   between can have read an outdated type of a node. The event runs
    //   at once unless a cached computation is running (`runWhenIdle`), so
    //   this interval is inside one. The test does not see an evaluation
    //   that started before the narrowing and continues in that
    //   computation: it can keep a result that read the wider type. That
    //   result is less specific, never wrong, as for the types cached on
    //   the nodes (see the deferral above).
    //
    // Neither event changes host state, so a host handler call during which
    // only these events happened did not change state either.
    //
    // An element-wise operator over a list makes a function literal at each
    // evaluation (`lazyBroadcastMap`, `collection-utils.ts`), and the end of
    // its boxing narrows its parameter. When these two events always advanced the
    // version, the copies of a node that holds such an operator could not
    // read the result of the first copy, and each was evaluated (CE-882).
    const advancesEvaluation =
      e.kind === 'declare'
        ? (e.shadowsCallable || e.changesFrameBinding === true) &&
          e.scratch !== true
        : e.kind === 'scope-pop'
          ? e.assumptionsDirty
          : e.kind === 'inference'
            ? e.parameter !== true || e.widening === true
            : e.kind === 'inference-settled'
              ? sharedEvaluationStarts() !== this._startsAtInference
              : e.kind !== 'binding-repair' || m.any;
    if (advancesEvaluation) {
      this._evaluationVersion += 1;
      if (e.kind !== 'value-write' || !e.ephemeral)
        this._persistentEvaluationVersion += 1;
    }
    if (m.any) {
      this._anyVersion += 1;
      if (countsAsScratch) this._scratchAnyAdvances += 1;
    }
    if (
      m.any &&
      !((e.kind === 'declare' || e.kind === 'scope-pop') && e.activation) &&
      !(e.kind === 'value-write' && !e.typeRead)
    )
      this._typeVersion += 1;
    if (m.semantic) this._semanticVersion += 1;
    if (m.world) this._worldVersion += 1;
    if (callableAxisSelects(e)) {
      this._callableVersion += 1;
      if (countsAsScratch) this._scratchCallableAdvances += 1;
    }
    // A value-type inference (a symbol narrowed by a use, such as `unknown`
    // to `number` for a free `T` read by `sin(4x - T)`) does not advance the
    // definition version, for the same reason its deferred
    // `inference-settled` event does not: a narrowing can only leave a
    // memoized result wider than it could be, never wrong. Counting it made
    // the cost of a type read exponential. The memo of a declared function's
    // derived signature keys on this version, and deriving that signature
    // boxes the function's body again, in a fresh local scope. A free name
    // of the body that no enclosing scope declares is then declared again in
    // that fresh scope and narrowed by its use, so each derivation advanced
    // the version and invalidated the memo of every other declared function.
    // Typing a product of calls re-derived the callees of each factor
    // recursively: 1.87 million derivations for one sum over 400 terms,
    // which did not finish in 60 s (Tycho item 329, reproduced in
    // `test/compute-engine/tycho-item-329-signature-memo.test.ts`). An
    // inference that is not a true narrowing (`widening`: a `widen` or
    // `replace` write, or the rollback of a narrowing) still advances the
    // version: it can put a WIDER or a different type in place, so a result
    // memoized under the old type could be wrong, not only loose.
    //
    // A write to a SCRATCH binding (`scratch-scopes.ts`: a `declare`, a
    // `binding-repair` or an `inference` whose binding lives under a scope
    // that a running computation registered as scratch) does not advance the
    // definition version either (see "Scratch events" in the documentation
    // of `axisMaskOf`). Deriving the signature of a function
    // declared `-> unknown` boxes its body again in such a scope, and every
    // undeclared name the body APPLIES (`b` in `b(x, y)`) is declared there
    // as a function, which repairs its binding. When that advanced the
    // version, each derivation invalidated the memoized signature of every
    // other declared function, and typing nested calls of such functions
    // derived their signatures again at each level (Tycho item 336,
    // `test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts`).
    // This is sound because a memoized signature is computed from bindings
    // that the scratch scope cannot hold: the memo is stored after the
    // derivation returns, the scratch scope is then discarded, and no later
    // read of any function resolves a name to a binding in it. A write to a
    // binding OUTSIDE a scratch scope keeps its advance, even when made
    // during a derivation: a declaration in the scope a function was defined
    // in, an assignment, or a repair of a binding that later reads see.
    //
    // The `binding-repair` of a FRESH declaration (`fresh`: the target scope
    // held no binding of the name) does not advance it either. The reasons
    // are in `updateDef`, which emits it.
    if (
      !scratch &&
      (e.kind === 'type-write' ||
        (e.kind === 'declare'
          ? e.shadowsCallable
          : e.kind === 'binding-repair' && e.fresh === true
            ? false
            : e.kind === 'inference' && e.valueType === true && !e.widening
              ? false
              : callableAxisSelects(e)))
    )
      this._definitionVersion += 1;
    if (CACHE_STATS) {
      if (m.any) recordBump('generation');
      if (m.semantic) recordBump('mutationGeneration');
      if (m.world) recordBump('semanticEpoch');
    }
  }

  reset(hooks: ResetHooks): void {
    // A scratch extent brackets its own registration in a `finally`, so a
    // non-empty list here means a computation was abandoned mid-flight (a
    // host `throw` past the bracket). Clearing it keeps a leaked entry from
    // exempting declarations for the rest of the engine's life.
    this._scratchDeclarationScopes.length = 0;
    this.noteStateEvent({ kind: 'config' });
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
