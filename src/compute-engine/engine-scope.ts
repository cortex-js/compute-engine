import { BLUE, BOLD, CYAN, GREY, RESET } from '../common/ansi-codes.js';

import type { BoxedDefinition, IComputeEngine, Scope } from './global-types.js';

/** One frame of the engine's evaluation-context stack. */
type EvalContext = IComputeEngine['_evalContextStack'][number];

import { ExpressionMap } from './boxed-expression/expression-map.js';
import { isValueDef, isOperatorDef } from './boxed-expression/utils.js';

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

  ce._evalContextStack.push({
    lexicalScope: scope,
    name,
    assumptions: new ExpressionMap(ce.context?.assumptions ?? []),
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
  // Definitions owned by a scope may subscribe to engine-wide lifecycle
  // events. Release those subscriptions as soon as the scope is discarded,
  // rather than retaining otherwise-dead local constants for the lifetime of
  // the engine. Disposal is intentionally idempotent.
  for (const binding of context?.lexicalScope.bindings.values() ?? []) {
    if (isValueDef(binding)) binding.value.dispose();
  }

  // Popping an eval context reverts the active assumptions and local
  // declarations to the enclosing context. Per-expression caches keyed on
  // `ce._generation` (e.g. `BoxedFunction.sgn`/`.type`) would otherwise keep
  // returning values computed under the popped scope's assumptions — a stale
  // read on any expression held across the scope. `assume()`/`forget()` bump
  // the generation on the way in, but the revert on the way out is silent, so
  // bump here to invalidate those caches. (A matching bump on push is not
  // needed: `pushEvalContext` copies the current assumptions unchanged, and any
  // assumption added inside the scope goes through `assume()`, which bumps.)
  ce._generation += 1;

  // `_mutationGeneration` (the key of the `Comprehension` element memo) is
  // bumped by the pop ONLY when this context's assumptions were modified —
  // that revert is the one semantic change a pop can make. A clean pop leaves
  // it untouched so mutation-keyed caches survive unrelated scoped
  // evaluations (Tycho item 38).
  if (context?._assumptionsDirty) ce._mutationGeneration += 1;
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
  });

  try {
    return f();
  } finally {
    const popped = ce._evalContextStack.pop();
    // Mirror popEvalContext: reverting assumptions modified inside the
    // temporary context is a semantic change.
    if (popped?._assumptionsDirty) ce._mutationGeneration += 1;
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
    const assumptions = [...context.assumptions.entries()].map(
      ([k, v]) => `${k}: ${v}`
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

function defToString(name: string, def: BoxedDefinition): string {
  let result = '';
  if (isValueDef(def)) {
    const tags: string[] = [];
    if (def.value.holdUntil === 'never') tags.push('(hold never)');
    if (def.value.holdUntil === 'N') tags.push('(hold until N)');

    if (def.value.inferredType) tags.push('inferred');

    const allTags = tags.length > 0 ? ` ${tags.join(' ')}` : '';

    result = `${CYAN}${name}${RESET}:${allTags}`;

    if (def.value.isConstant) {
      result += ` const ${def.value.type.toString()}`;
      if (def.value.value !== undefined)
        result += ` = ${def.value.value?.toString()}`;
    } else result += ` ${def.value.type.toString()}`;
  } else if (isOperatorDef(def)) {
    const tags: string[] = [];
    if (def.operator.inferredSignature) tags.push('(inferred)');

    const allTags = tags.length > 0 ? ` (${tags.join(' ')})` : '';

    result = `${CYAN}${name}${RESET}:${allTags} ${def.operator.signature.toString()}`;

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
