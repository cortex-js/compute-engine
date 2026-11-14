import { BLUE, BOLD, CYAN, GREY, RESET } from '../common/ansi-codes.js';
import { CACHE_STATS, recordScopePop } from '../common/cache-stats.js';
import { typeToString } from '../common/type/serialize.js';

import type {
  BoxedDefinition,
  BoxedValueDefinition,
  FactRecord,
  IComputeEngine,
  Scope,
} from './global-types.js';

/** One frame of the engine's evaluation-context stack. */
type EvalContext = IComputeEngine['_evalContextStack'][number];

import { ExpressionMap } from './boxed-expression/expression-map.js';
import { isValueDef, isOperatorDef } from './boxed-expression/utils.js';
import {
  isDormantPop,
  reviveBindings,
  tombstoneBinding,
} from './boxed-expression/binding-tombstone.js';
import {
  activationValuesOf,
  scopeActivationTemplate,
} from './boxed-expression/ambient-chain.js';
import { _discardPendingSequencesOfScope } from './sequence.js';
import { notePushedScope } from './pending-call-scopes.js';

export function pushScope(
  ce: IComputeEngine,
  scope?: Scope,
  name?: string
): void {
  pushEvalContext(
    ce,
    scope ?? {
      parent: ce.context?.lexicalScope,
      bindings: new Map(),
    },
    name
  );
}

/**
 * Pop the scope that `pushScope()` pushed. The scope keeps its definitions:
 * an expression boxed in it reads them after the pop, as before it. Each
 * definition only stops listening to configuration changes (a popped
 * definition is not rounded again at a change of precision). The frame of a
 * call (`name` is `call`) is discarded as any evaluation frame is: a value
 * that reads it after the call reads the values that its activation holds.
 */
export function popScope(ce: IComputeEngine): void {
  const context = ce._evalContextStack.pop();
  discardEvalContext(ce, context, context?.name !== 'call');
}

export function pushEvalContext(
  ce: IComputeEngine,
  scope: Scope,
  name?: string
): void {
  if (!name) {
    const l = ce._evalContextStack.length;
    if (l === 0) name = 'system';
    if (l === 1) name = 'global';
    name ??= `anonymous_${l - 1}`;
  }

  // A scope object outlives its frame by design (a canonicalized `Sum` pushes
  // its `localScope` again on every evaluation), so pushing it revokes the
  // debug tombstone its earlier pop left behind.
  if (ce._debugBindings) reviveBindings(scope.bindings.values());
  // A frame reads the scope from now on: a declaration into it is a change
  // of a binding that the frame reads (`pending-call-scopes.ts`).
  notePushedScope(scope);

  ce._evalContextStack.push({
    lexicalScope: scope,
    name,
    assumptions: new ExpressionMap(ce.context?.assumptions ?? []),
    // The assumed-value overlay has the same lifetime as the fact map: the
    // new context starts from a copy of the enclosing one, and the copy dies
    // with the context, so a value assumed inside is reverted by the pop.
    assumedValues: new Map(ce.context?.assumedValues ?? []),
    // Pushing advances no axis, so record all three axis versions for the
    // pop's clean-bracket check (see `_anyVersionAtPush` in
    // `types-kernel-evaluation.ts` for why `any` alone is not enough).
    _anyVersionAtPush: ce._anyVersion,
    _semanticVersionAtPush: ce._semanticVersion,
    _worldVersionAtPush: ce._worldVersion,
  });
  countHolders(ce._evalContextStack[ce._evalContextStack.length - 1]);
}

export function popEvalContext(ce: IComputeEngine): void {
  discardEvalContext(ce, ce._evalContextStack.pop());
}

/**
 * Remove one SPECIFIC evaluation context from the current stack
 * (`ce._evalContextStack`), wherever it sits on that stack.
 *
 * The asynchronous evaluation path holds the frame of a scoped operator
 * across an `await` (`BoxedFunction._computeValueAsync`). It pushes the frame
 * on its own copy of the stack (`EvaluateOptions._contextStack`), not on the
 * engine's stack, and puts that copy in place of the engine's stack while it
 * removes the frame. A nested evaluation that holds a frame across an
 * `await` pushes it on a copy of its own, and a synchronous evaluation pops
 * its frames before it returns, so the frame is expected to be on top of
 * its copy. Removal by identity does not depend on that: if another frame
 * were above it, a pop of the top would dispose the bindings of a frame
 * that is still in use.
 *
 * A no-op if the context is not on the stack (already removed).
 */
export function removeEvalContext(
  ce: IComputeEngine,
  context: EvalContext
): void {
  const index = ce._evalContextStack.lastIndexOf(context);
  if (index < 0) return;
  ce._evalContextStack.splice(index, 1);
  discardEvalContext(ce, context);
}

function discardEvalContext(
  ce: IComputeEngine,
  context: EvalContext | undefined,
  keepDefinitions = false
): void {
  // Definitions owned by a scope may subscribe to engine-wide lifecycle
  // events. Release those subscriptions as soon as the scope is discarded,
  // rather than retaining otherwise-dead local constants for the lifetime of
  // the engine. Disposal is intentionally idempotent.
  //
  // A pop does not tombstone when another context of the stack still
  // has the same scope: a recursive call that runs the same loop pops the
  // scope while the loop of the caller still runs in it, and the caller
  // then reads its index. A push revives the tombstones, but the loop of
  // the caller does not push the scope again. Only the debug check reads
  // this, so the walk of the stack happens only when the flag is on.
  //
  // A definition that the scope of another live context holds is not
  // tombstoned and not disposed: that context still reads it, and the pop
  // of the last such context disposes it. The live contexts that hold a
  // definition are counted on the definition (`countHolders`), not looked
  // for on the stack: the context can be on another stack (the copy of an
  // asynchronous evaluation, the recorded stack of a lazy view, put in place
  // for a while). The temporary context of `inScope` is not counted: it is
  // popped without `discardEvalContext`. A definition that a pop keeps this
  // way is disposed by the pop of the last context that holds it, or by the
  // `ce.contextStack` setter when it drops that context
  // (`settleKeptDefinition`). Two scope objects can hold one
  // definition: the lazy comprehension that each call of
  // `u := (l) => [l[i] for i in 1..n]` returns is a new node with a new
  // local scope, and each of these scopes holds the definition of `i` of
  // the comprehension in the body of `u`. A walk of the result of `u(u(b))`
  // runs in the scope of the outer result and evaluates the inner result,
  // whose pop must not dispose the `i` that the outer walk still reads. The
  // same applies to a recursive call that runs the same loop. A disposed
  // definition is treated as dead by the assumptions (`assume.ts`) and by
  // the caches keyed on its `_writeVersion`.
  const keepsTombstone =
    !keepDefinitions &&
    ce._debugBindings &&
    !isDormantPop() &&
    context !== undefined &&
    !ce._evalContextStack.some((c) => c.lexicalScope === context.lexicalScope);
  // The pop of an activation neither disposes nor tombstones the static
  // definitions of its scope: they outlive the evaluation, and only their
  // values of this evaluation, held by the activation, end with it.
  const template =
    context !== undefined
      ? scopeActivationTemplate(context.lexicalScope)
      : undefined;
  // The definitions that this frame counted (`countHolders`).
  const counted = context?._countedDefs;
  if (context !== undefined) {
    context._discarded = true;
    if (counted !== undefined) {
      context._countedDefs = undefined;
      noteFrameUncounted(context);
    }
  }
  const held =
    context !== undefined
      ? activationValuesOf(context.lexicalScope)
      : undefined;
  for (const [name, binding] of context?.lexicalScope.bindings ?? []) {
    if (
      (template !== undefined && template.bindings.get(name) === binding) ||
      (isValueDef(binding) && held?.has(binding.value) === true)
    ) {
      if (isValueDef(binding) && counted?.delete(binding.value))
        decrementHolders(ce, binding.value);
      continue;
    }
    // A popped scope keeps its definitions: this frame stops holding each
    // one, and the pop disposes none, also one that the pop of another
    // frame kept for this frame (`keptDefinitions`).
    if (keepDefinitions) {
      if (isValueDef(binding)) {
        const def = binding.value;
        if (counted?.delete(def)) decrementHolders(ce, def);
        if (holderCount(def) === 0) keptDefinitions.delete(def);
        (
          def as { _releaseConfigurationChange?: () => boolean }
        )._releaseConfigurationChange?.();
      }
      continue;
    }
    if (isValueDef(binding)) {
      // Debug invariant (§3 of the binder-mechanism design): stamp BEFORE
      // disposing, so a later use of this binding reports where its scope died.
      // A DORMANT pop is exempt: `canonicalizeBinder` pops a scope the
      // canonical expression keeps and pushes again on every evaluation, so
      // that pop is not the scope's death and a tombstone there would report
      // every bound variable of every canonicalized binder.
      //
      // A definition that this frame did not count (installed in its scope
      // after the push by a route other than a declaration) adds nothing to
      // the count: the pop disposes it unless another counted frame holds
      // it. A definition under two names is uncounted once: it leaves
      // `counted` at the first one.
      const def = binding.value;
      if (counted?.delete(def)) decrementHolders(ce, def);
      if (holderCount(def) > 0) {
        keptDefinitions.set(def, keepsTombstone);
        continue;
      }
      keptDefinitions.delete(def);
      if (keepsTombstone) tombstoneBinding(def, context?.name ?? '<unnamed>');
      def.dispose();
    }
  }
  // What is left in `counted` is a counted definition that the scope no
  // longer holds (replaced or removed by a route that does not uncount it,
  // `uncountRemovedHolder`). It is uncounted too, and it is disposed only
  // when no frame holds it any more and an earlier pop kept it for this
  // frame (`settleKeptDefinition`).
  if (counted !== undefined && counted.size > 0) {
    for (const def of counted as Set<BoxedValueDefinition>) {
      decrementHolders(ce, def);
      if (holderCount(def) === 0) settleKeptDefinition(ce, def, context!.name);
    }
  }
  // The pending sequence definitions of the scope (`F_0 := 10` without a
  // recurrence) belong to its bindings, so they are removed with them.
  if (context !== undefined)
    _discardPendingSequencesOfScope(ce, context.lexicalScope);

  // Popping an eval context reverts the active assumptions and local
  // declarations to the enclosing context. Per-expression caches keyed on
  // `ce._anyVersion` (e.g. `BoxedFunction.sgn`/`.type`) would otherwise keep
  // returning values computed under the popped scope's assumptions — a stale
  // read on any expression held across the scope. `assume()`/`forget()`
  // advance the axis on the way in, but the revert on the way out is silent,
  // so this event covers it. (A matching event on push is not needed:
  // `pushEvalContext` copies the current assumptions unchanged, and any
  // assumption added inside the scope goes through `assume()`.) The
  // `assumptionsDirty` payload carries the M+E half: `_semanticVersion` (the
  // key of the `Comprehension` element memo) advances ONLY when this
  // context's assumptions were modified — a clean pop leaves it untouched so
  // mutation-keyed caches survive unrelated scoped evaluations (Tycho
  // item 38).
  //
  // The `clean` payload carries the `any` half of the same argument: when
  // NOTHING advanced any of the three axes while this context was on the
  // stack (every install of a local binding or value goes through an event
  // that advances at least one — `declare` and `value-write` including
  // ephemeral index writes advance `any`; a scoped operator redefinition
  // advances `semantic`+`world` but NOT `any`, which is why the check must
  // cover all three — and pushing itself changes nothing), there is no
  // silent revert for the pop to cover, and the pop must not advance `any`
  // either. This is what keeps
  // a read-only scoped probe — a `Comprehension` count/finiteness scan, a
  // lazy `Filter` emptiness walk — from retiring every `_type`/`_sgn` cache
  // engine-wide: those probes bracket with push/pop per read, and with an
  // unconditional bump each probe invalidated the very caches the enclosing
  // type derivation was filling, so boxing a row that references a
  // comprehension-bound name recomputed the whole subtree per node (Tycho
  // item 181: 872K clean pops and 1.85M wasted type recomputes in ONE
  // canonical box, ~60–90 s per `.type` read).
  // A frame whose scope received values before the push (a call of a
  // function literal, `_bindsValues`) is never clean: see that field.
  const clean =
    context?._bindsValues !== true &&
    context?._assumptionsDirty !== true &&
    context?._anyVersionAtPush === ce._anyVersion &&
    context?._semanticVersionAtPush === ce._semanticVersion &&
    context?._worldVersionAtPush === ce._worldVersion;
  if (CACHE_STATS) recordScopePop(clean ? 'clean' : 'dirty');
  ce._noteStateEvent({
    kind: 'scope-pop',
    assumptionsDirty: context?._assumptionsDirty === true,
    ...(clean ? { clean: true } : {}),
  });
}

export function inScope<T>(
  ce: IComputeEngine,
  scope: Scope | undefined,
  f: () => T
): T {
  if (!scope) return f();

  // Push a temporary eval context to switch to the given scope
  ce._evalContextStack.push({
    lexicalScope: scope,
    name: '',
    assumptions: new ExpressionMap(ce.context?.assumptions ?? []),
    // See `pushEvalContext`: the overlay is copied and dropped with the frame.
    assumedValues: new Map(ce.context?.assumedValues ?? []),
    // Popped without `discardEvalContext`, so never counted as a holder of
    // the definitions of its scope, also when the `ce.contextStack` setter
    // gets it back in a stack (`countHolders`).
    _uncounted: true,
  });

  try {
    return f();
  } finally {
    const popped = ce._evalContextStack.pop();
    // Mirror popEvalContext: reverting assumptions modified inside the
    // temporary context is a semantic change. (The `transient` variant has
    // no G advance — §2's measured mask — and emits even when clean, for
    // future axis subscribers.)
    ce._noteStateEvent({
      kind: 'scope-pop',
      assumptionsDirty: popped?._assumptionsDirty === true,
      transient: true,
    });
  }
}

export function printStack(
  ce: IComputeEngine,
  options?: { details?: boolean; maxDepth?: number }
): void {
  if (options) {
    options = { ...options };
    options.maxDepth ??= 1;
    options.details ??= false;
  } else options = { details: false, maxDepth: -2 };

  if (options.maxDepth !== undefined && options.maxDepth < 0)
    options.maxDepth = ce._evalContextStack.length + options.maxDepth;

  options.maxDepth = Math.min(
    ce._evalContextStack.length - 1,
    options.maxDepth!
  );

  let depth = 0;

  while (depth <= options.maxDepth) {
    const context =
      ce._evalContextStack[ce._evalContextStack.length - 1 - depth];
    if (depth === 0) console.group(`${BOLD}${BLUE}${context.name}${RESET}`);
    else
      console.groupCollapsed(
        `${BOLD}${BLUE}${context.name}${RESET} ${GREY}(${depth})${RESET}`
      );

    //
    // Display assumptions
    //
    const names =
      context.assumptions.size === 0
        ? new Map<BoxedValueDefinition, string>()
        : bindingNames(context.lexicalScope);
    const assumptions = [...context.assumptions.entries()].map(
      ([k, v]) =>
        `${k}: ${v.map((r) => factRecordToString(r, names)).join(', ')}`
    );
    if (assumptions.length > 0) {
      console.groupCollapsed(
        `${BOLD}${assumptions.length} assumptions${RESET}`
      );
      for (const a of assumptions) console.info(a);
      console.groupEnd();
    }

    //
    // Display bindings
    //

    if (context.lexicalScope.bindings.size === 0) {
      console.groupEnd();
      depth += 1;
      continue;
    }

    for (const [k, def] of context.lexicalScope.bindings)
      console.info(defToString(k, def));

    console.groupEnd();

    // Next execution context
    depth += 1;
  }
}

/**
 * The name each reachable scope binds to a value definition, innermost
 * binding first. An assumption record points at a DEFINITION, while the
 * reader of a scope dump wants a name; a definition bound in no reachable
 * scope has none to show.
 */
function bindingNames(
  scope: Scope | null | undefined
): Map<BoxedValueDefinition, string> {
  const names = new Map<BoxedValueDefinition, string>();
  while (scope) {
    for (const [name, def] of scope.bindings)
      if (isValueDef(def) && !names.has(def.value)) names.set(def.value, name);
    scope = scope.parent;
  }
  return names;
}

/** One assumption record for the scope dump: the truth value the assertion
 * carries, and the subjects it was recorded against, as `part:name` pairs
 * (`self:x`, `re:s`). A record with no named subject — a fact about symbols
 * with no value definition, or one whose scope is gone — prints its truth
 * value alone. */
function factRecordToString(
  record: FactRecord,
  names: Map<BoxedValueDefinition, string>
): string {
  const subjects = record.subjects
    .map((s) => `${s.part}:${names.get(s.def) ?? '?'}`)
    .join(', ');
  return subjects.length === 0
    ? `${record.truth}`
    : `${record.truth} (${subjects})`;
}

function defToString(name: string, def: BoxedDefinition): string {
  let result = '';
  if (isValueDef(def)) {
    const tags: string[] = [];
    if (def.value.holdUntil === 'never') tags.push('(hold never)');
    if (def.value.holdUntil === 'N') tags.push('(hold until N)');

    if (def.value.inferredType) tags.push('inferred');

    const allTags = tags.length > 0 ? ` ${tags.join(' ')}` : '';

    result = `${CYAN}${name}${RESET}:${allTags}`;

    // A function-typed VALUE
    // definition can carry the same signature an operator
    // definition does, and must print it the same way.
    const displayed = typeToString(def.value.type.type);
    if (def.value.isConstant) {
      result += ` const ${displayed}`;
      if (def.value.value !== undefined)
        result += ` = ${def.value.value?.toString()}`;
    } else result += ` ${displayed}`;
  } else if (isOperatorDef(def)) {
    const tags: string[] = [];
    if (def.operator.inferredSignature) tags.push('(inferred)');

    const allTags = tags.length > 0 ? ` (${tags.join(' ')})` : '';

    result = `${CYAN}${name}${RESET}:${allTags} ${typeToString(
      def.operator.signature.type
    )}`;

    const details: string[] = [];

    if (def.operator.lazy) details.push('lazy');
    if (def.operator.scoped) details.push('scoped');
    if (def.operator.broadcastable) details.push('broadcastable');
    if (def.operator.associative) details.push('associative');
    if (def.operator.commutative) details.push('commutative');
    if (def.operator.idempotent) details.push('idempotent');
    if (def.operator.involution) details.push('involution');
    if (!def.operator.pure) details.push('not pure');

    const allDetails = details.map((x) => `${GREY}${x}${RESET}`).join(' ');
    if (allDetails.length > 0) result += `\n   \u2514 ${allDetails}`;
  } else result = 'unknown';

  return result;
}

/** The empty set of counted definitions, shared by the frames whose scope
 * holds no value definition at the push. Never changed: a declaration
 * replaces it (`countDeclaredHolder`). */
const NO_COUNTED_DEFS: Set<object> = new Set();

/** The number of counted live frames for each bindings map of a scope. A
 * declaration into a scope that no such frame holds skips the walk of the
 * stack (`countDeclaredHolder`, `uncountRemovedHolder`). */
const countedFramesByBindings = new WeakMap<object, number>();

function noteFrameCounted(context: EvalContext): void {
  const key = context.lexicalScope.bindings;
  countedFramesByBindings.set(key, (countedFramesByBindings.get(key) ?? 0) + 1);
}

function noteFrameUncounted(context: EvalContext): void {
  const key = context.lexicalScope.bindings;
  const n = (countedFramesByBindings.get(key) ?? 1) - 1;
  if (n > 0) countedFramesByBindings.set(key, n);
  else countedFramesByBindings.delete(key);
}

/**
 * The definitions that a pop did not dispose because another live context
 * held them, with whether that pop would have tombstoned them (the debug
 * check of dead bindings). The pop of the last holder disposes such a
 * definition as one of its own bindings; the `ce.contextStack` setter and a
 * holder whose scope no longer holds it use this record
 * (`settleKeptDefinition`).
 */
const keptDefinitions = new WeakMap<BoxedValueDefinition, boolean>();

/** The number of live contexts whose scope holds `def`. */
function holderCount(def: BoxedValueDefinition): number {
  return (def as { _holders?: number })._holders ?? 0;
}

/** Take one holder from the count of `def`. With the debug check of dead
 * bindings on, a count that is already 0 throws: each decrement matches an
 * increment recorded on a frame (`_countedDefs`). */
function decrementHolders(ce: IComputeEngine, def: BoxedValueDefinition): void {
  const d = def as { _holders?: number };
  if ((d._holders ?? 0) > 0) d._holders! -= 1;
  else if (ce._debugBindings)
    throw new Error(
      `The holder count of "${(def as unknown as { name: string }).name}" is already 0.`
    );
}

/** Dispose `def`, whose holder count is 0, when an earlier pop kept it for
 * another holder (`keptDefinitions`), and tombstone it when that pop would
 * have. A definition that no pop kept is left as it is. */
function settleKeptDefinition(
  ce: IComputeEngine,
  def: BoxedValueDefinition,
  scopeName: string | undefined
): void {
  const tombstone = keptDefinitions.get(def);
  if (tombstone === undefined) return;
  keptDefinitions.delete(def);
  if (tombstone && ce._debugBindings)
    tombstoneBinding(def, scopeName ?? '<unnamed>');
  def.dispose();
}

/**
 * Count `context` as a holder of each value definition of its scope, and
 * record them on it (`_countedDefs`). `pushEvalContext` calls it, and so
 * does the `ce.contextStack` setter for a frame that it adds. A context is
 * counted once, and a discarded context is not counted again.
 *
 * A definition that a declaration installs in the scope while the frame is
 * live is counted then (`countDeclaredHolder`). One that another route
 * installs (a binding set aside and put back by a block, a borrowed
 * binding) is not counted: this frame adds nothing to its count, so the pop
 * of this frame disposes it unless another counted frame holds it, and the
 * pop of another frame that holds it can dispose it while this frame is
 * live, as before the count existed. The temporary context of `inScope` is
 * never counted (`_uncounted`).
 */
export function countHolders(context: EvalContext): void {
  if (
    context._countedDefs !== undefined ||
    context._discarded ||
    context._uncounted
  )
    return;
  let defs = NO_COUNTED_DEFS;
  for (const binding of context.lexicalScope.bindings.values()) {
    if (!isValueDef(binding)) continue;
    const def = binding.value as { _holders?: number };
    if (defs.has(def)) continue;
    if (defs === NO_COUNTED_DEFS) defs = new Set();
    defs.add(def);
    def._holders = (def._holders ?? 0) + 1;
  }
  context._countedDefs = defs;
  noteFrameCounted(context);
}

/**
 * Count the live frames of the current stack whose scope has the bindings
 * of `scope` as holders of `def`, which a declaration has just installed
 * in `scope` (`engine-declarations.ts`).
 */
export function countDeclaredHolder(
  ce: IComputeEngine,
  scope: Scope,
  def: BoxedValueDefinition
): void {
  if (!countedFramesByBindings.has(scope.bindings)) return;
  for (const frame of ce._evalContextStack) {
    const defs = frame._countedDefs;
    if (defs === undefined || frame.lexicalScope.bindings !== scope.bindings)
      continue;
    if (defs.has(def)) continue;
    if (defs === NO_COUNTED_DEFS) frame._countedDefs = new Set([def]);
    else defs.add(def);
    const d = def as { _holders?: number };
    d._holders = (d._holders ?? 0) + 1;
  }
}

/**
 * Uncount `def`, which a declaration has just replaced in `scope` or that
 * `ce.undeclare()` has removed from it, for the live frames of the current
 * stack whose scope has the bindings of `scope`. Their records then do not
 * keep the definition (and its value) for the life of the frame, which is
 * the life of the engine for the global frame. A definition whose count
 * reaches 0 and that an earlier pop kept is disposed
 * (`settleKeptDefinition`).
 */
export function uncountRemovedHolder(
  ce: IComputeEngine,
  scope: Scope,
  def: BoxedValueDefinition
): void {
  if (!countedFramesByBindings.has(scope.bindings)) return;
  // The scope can still hold the definition under another name.
  for (const binding of scope.bindings.values())
    if (isValueDef(binding) && binding.value === def) return;
  for (const frame of ce._evalContextStack) {
    if (frame.lexicalScope.bindings !== scope.bindings) continue;
    if (!frame._countedDefs?.delete(def)) continue;
    decrementHolders(ce, def);
    if (holderCount(def) === 0) settleKeptDefinition(ce, def, frame.name);
  }
}

/**
 * Stop counting `context` as a holder of the definitions it counted: the
 * `ce.contextStack` setter drops it. A definition whose count reaches 0 and
 * that an earlier pop kept is disposed (`settleKeptDefinition`). The other
 * definitions of the scope of `context` are not disposed: the frame leaves
 * the stack without a pop.
 */
export function uncountHolders(ce: IComputeEngine, context: EvalContext): void {
  const defs = context._countedDefs;
  if (defs === undefined) return;
  context._countedDefs = undefined;
  noteFrameUncounted(context);
  for (const def of defs as Set<BoxedValueDefinition>) {
    decrementHolders(ce, def);
    if (holderCount(def) === 0) settleKeptDefinition(ce, def, context.name);
  }
}
