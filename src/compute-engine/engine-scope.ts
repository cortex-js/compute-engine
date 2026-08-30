import { BLUE, BOLD, CYAN, GREY, RESET } from '../common/ansi-codes.js';
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

export function popScope(ce: IComputeEngine): void {
  popEvalContext(ce);
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
}

export function popEvalContext(ce: IComputeEngine): void {
  discardEvalContext(ce, ce._evalContextStack.pop());
}

/**
 * Remove one SPECIFIC evaluation context, wherever it currently sits.
 *
 * The asynchronous evaluation path holds its context across an `await`
 * (`BoxedFunction._computeValueAsync`), so by the time it unwinds, its frame is
 * not necessarily on top: another evaluation on the same engine may have pushed
 * above it. Popping the top there would destroy a frame belonging to something
 * still running — disposing its bindings out from under it. Removing by
 * identity leaves every other frame intact.
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
  context: EvalContext | undefined
): void {
  // A checkpoint standing on this frame has no world left to restore once
  // the frame's bindings are disposed below — retire it, folding its journal
  // window downward so older checkpoints still unwind this scope's writes
  // (`checkpoint.ts`). Gated on the stack so the no-checkpoint path pays one
  // length read.
  if (context !== undefined && ce._checkpointStack.length > 0)
    ce._invalidateCheckpointsOnFrameDiscard(context);
  // Definitions owned by a scope may subscribe to engine-wide lifecycle
  // events. Release those subscriptions as soon as the scope is discarded,
  // rather than retaining otherwise-dead local constants for the lifetime of
  // the engine. Disposal is intentionally idempotent.
  for (const binding of context?.lexicalScope.bindings.values() ?? []) {
    if (isValueDef(binding)) {
      // Debug invariant (§3 of the binder-mechanism design): stamp BEFORE
      // disposing, so a later use of this binding reports where its scope died.
      // A DORMANT pop is exempt: `canonicalizeBinder` pops a scope the
      // canonical expression keeps and pushes again on every evaluation, so
      // that pop is not the scope's death and a tombstone there would report
      // every bound variable of every canonicalized binder.
      if (ce._debugBindings && !isDormantPop())
        tombstoneBinding(binding.value, context?.name ?? '<unnamed>');
      binding.value.dispose();
    }
  }

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
  const clean =
    context?._assumptionsDirty !== true &&
    context?._anyVersionAtPush === ce._anyVersion &&
    context?._semanticVersionAtPush === ce._semanticVersion &&
    context?._worldVersionAtPush === ce._worldVersion;
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
  });

  try {
    // During boxing this temporary lexical scope is the correct restart owner
    // for a devolved builtin shadow. Outside boxing, `withScopedRepair()` is a
    // transparent single pass, so evaluation side effects are never repeated.
    return ce._boxingState.withScopedRepair(scope, f);
  } finally {
    const popped = ce._evalContextStack.pop();
    // This transient pop bypasses `discardEvalContext`, so it runs the
    // checkpoint frame-retirement hook itself: a checkpoint taken inside
    // this extent stood on the popped frame and dies with it.
    if (popped !== undefined && ce._checkpointStack.length > 0)
      ce._invalidateCheckpointsOnFrameDiscard(popped);
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
