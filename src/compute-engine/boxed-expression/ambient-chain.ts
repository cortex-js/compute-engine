import type { Scope } from '../global-types.js';

// Runtime activations have private bindings but denote their template's
// lexical level. Both synchronous and asynchronous children need this link
// when their canonical parent is the template rather than the active scope.
const scopeTemplates = new WeakMap<Scope, Scope>();

// The scopes that have had at least one activation. A scope that is not in
// this set cannot have an activation on a context stack, so `liveScopeOf`
// answers it without a walk of the stack.
const activatedTemplates = new WeakSet<Scope>();

export function registerScopeActivation(scope: Scope, template: Scope): void {
  scopeTemplates.set(scope, template);
  activatedTemplates.add(template);
}

export function scopeActivationTemplate(scope: Scope): Scope | undefined {
  return scopeTemplates.get(scope);
}

/**
 * The scope that stands for `scope` in the evaluation whose context stack is
 * `stack`: the innermost runtime activation of `scope` on the stack, or
 * `scope` itself when the stack holds no activation of it, or holds `scope`
 * itself above every activation of it.
 *
 * An asynchronous evaluation of a scoped node (a `Sum`, a `Product`) does not
 * push the node's local scope. It pushes an activation: a copy with its own
 * value definitions, so that two evaluations of the node that run at the same
 * time do not write the index of each other. A function literal created in
 * the body of the node has the local scope (the template) as its defining
 * scope, and a call frame of the literal chains to its defining scope. With
 * the template in the chain, the body of the literal reads the index in the
 * template, which holds the value that an earlier synchronous evaluation
 * assigned last, not the value of the current iteration:
 * `Sum(Reduce(Map(x ↦ k·x, [1, 1]), Add, 0), k ∈ 1..2)` gave 8 with
 * `evaluateAsync()` after a synchronous `evaluate()` had given 6.
 */
export function liveScopeOf(
  stack: ReadonlyArray<{ lexicalScope: Scope }>,
  scope: Scope
): Scope {
  if (!activatedTemplates.has(scope)) return scope;
  for (let i = stack.length - 1; i >= 0; i--) {
    const active = stack[i].lexicalScope;
    if (active === scope) return scope;
    if (scopeTemplates.get(active) === scope) return active;
  }
  return scope;
}

/**
 * Whether `scope` is reached by walking the parent links up from `from`
 * (`from` itself included). A root scope's parent link may be `undefined`
 * rather than `null` (the first frame is pushed with no context to read a
 * parent from).
 */
export function chainContains(
  from: Scope | null | undefined,
  scope: Scope
): boolean {
  for (let s = from; s != null; s = s.parent)
    if (s === scope || scopeTemplates.get(s) === scope) return true;
  return false;
}

/**
 * The scope a node's local scope is chained onto while the node evaluates
 * in the ambient scope `ambient`, or `undefined` when the local scope keeps
 * its own parent link.
 *
 * A node that owns a local scope — a comprehension, a sum, a block — pushes
 * that scope again on every evaluation. Its parent link is the scope it was
 * canonicalized in, so a declaration made later in a scope pushed on top of
 * that one (a child scope that shadows `n` with a value) is not on the
 * chain, and the node's free symbols never see it, while a plain symbol
 * evaluated beside it does (`bindingInContext` walks the ambient chain).
 * Ruled 2026-09-15: a directly evaluated expression reads the environment it
 * is evaluated in, so the local scope is chained onto the ambient scope —
 * only when the ambient chain descends from the scope's own parent, so an
 * unrelated chain captures nothing, and never onto the scope itself (a
 * re-entrant evaluation). A call frame is NOT chained: a stored function
 * value is a closure and evaluates in its own environment
 * (`docs/SCOPING-MODEL.md`).
 */
export function ambientChainParent(
  ambient: Scope | null | undefined,
  scope: Scope
): Scope | undefined {
  if (
    ambient != null &&
    ambient !== scope &&
    scope.parent != null &&
    scope.parent !== ambient &&
    !chainContains(ambient, scope) &&
    chainContains(ambient, scope.parent)
  )
    return ambient;
  return undefined;
}

/**
 * Run `fn` with `scope` chained onto `ambient` exactly as an evaluation of
 * the node that owns `scope` would chain it (`ambientChainParent`), and the
 * parent link restored afterwards. A memo that resolves the node's free
 * names must resolve them through this chain — the one the node's walk
 * reads — or a value computed under one ambient scope is served under
 * another.
 */
export function withAmbientChain<T>(
  ambient: Scope | null | undefined,
  scope: Scope | undefined,
  fn: () => T
): T {
  const parent =
    scope === undefined ? undefined : ambientChainParent(ambient, scope);
  if (scope === undefined || parent === undefined) return fn();
  const saved = scope.parent;
  scope.parent = parent;
  try {
    return fn();
  } finally {
    scope.parent = saved;
  }
}
