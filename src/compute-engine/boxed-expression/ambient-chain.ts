import type { Scope } from '../global-types.js';

// Runtime activations have private bindings but denote their template's
// lexical level. Both synchronous and asynchronous children need this link
// when their canonical parent is the template rather than the active scope.
const scopeTemplates = new WeakMap<Scope, Scope>();

// The scopes that have had at least one activation. A scope that is not in
// this set cannot have an activation on a chain, so `activationOnLinks`
// answers it without a walk of the links.
const activatedTemplates = new WeakSet<Scope>();

// The values of an activation: for each static definition of its template,
// its value in this evaluation of the node.
const activationValues = new WeakMap<Scope, Map<object, unknown>>();

// The scopes on the chain of parents of an activation that a function value,
// a lazy collection, a scoped node or an asynchronous evaluation keeps
// (`markActivationKept()`). Only a kept activation outlives the evaluation
// that pushed it, so only a kept activation of a loop needs a new one for
// the next iteration (`renewIterationActivation()`).
const keptScopes = new WeakSet<Scope>();

// For each parent, and for each scope, an activation of the scope with that
// parent that the pop of its frame released (`releaseActivation()`). The
// next activation of the scope in that parent is this object when it would
// be equal to it: the same bindings. Both maps are weak: a released
// activation keeps neither a parent nor a scope that nothing else holds.
const idleActivations = new WeakMap<Scope, WeakMap<Scope, Scope>>();

// The values of a released activation: none. Nothing reads them, and the
// values of the last evaluation are not kept (`releaseActivation()`).
const RELEASED_VALUES = new Map<object, unknown>();

// A static definition of a scope that has had an activation: its value is
// read and written in an activation (`activationRecordOf()`). A field of the
// definition, not a side table: it is read at each read of a value.
type ActivatedDefinition = { _activated?: true };

/**
 * Record that `scope` is an activation of `template`, or holds the values
 * of an evaluation with no template (a call frame). `values` holds the
 * value of each static definition in this evaluation. With `known`, the
 * definitions of `values` are those of an activation registered before,
 * and are already marked (`ActivatedDefinition`).
 */
function registerScopeActivation(
  scope: Scope,
  template: Scope | undefined,
  values?: Map<object, unknown>,
  known = false
): void {
  if (template !== undefined) {
    scopeTemplates.set(scope, template);
    activatedTemplates.add(template);
  }
  if (values === undefined) return;
  activationValues.set(scope, values);
  if (!known)
    for (const def of values.keys())
      (def as ActivatedDefinition)._activated = true;
}

// The body scope of the function literal that each call frame applies
// (`registerCallFrame()`).
const frameBodies = new WeakMap<Scope, Scope>();

/**
 * Record that `frame` is the call frame of an application of the function
 * literal whose body scope is `bodyScope`: an activation of that scope,
 * whose `values` hold the parameters and the locals of the body in this
 * call. Its parent is the activation that the function value keeps.
 */
export function registerCallFrame(
  frame: Scope,
  bodyScope: Scope,
  values: Map<object, unknown>
): void {
  frameBodies.set(frame, bodyScope);
  activatedTemplates.add(bodyScope);
  registerScopeActivation(frame, undefined, values);
}

/** The body scope that the call frame `scope` applies, or `undefined` when
 * `scope` is not a call frame. */
export function callFrameBodyOf(scope: Scope): Scope | undefined {
  return frameBodies.get(scope);
}

// The body scope of the function literal that the scope of the body of each
// function value stands for (`registerFunctionValueScope()`).
const valueBodyTemplates = new WeakMap<Scope, Scope>();

/**
 * Record that `scope`, the scope of the body `Block` of a function value,
 * stands for `template`, the body scope of the literal the value was made
 * from. Its parent is the activation that the value keeps; its operands,
 * and the scopes nested in them, are those of the literal.
 */
export function registerFunctionValueScope(
  scope: Scope,
  template: Scope
): void {
  valueBodyTemplates.set(scope, template);
}

/** The body scope of the literal that the function value whose body scope is
 * `scope` was made from, or `undefined` when `scope` is not the body scope
 * of a function value. */
export function functionValueTemplateOf(scope: Scope): Scope | undefined {
  return valueBodyTemplates.get(scope);
}

/** True when the chain of parents of `scope` holds an activation. */
export function holdsActivation(scope: Scope | null | undefined): boolean {
  for (let s = scope; s != null; s = s.parent)
    if (activationValues.has(s)) return true;
  return false;
}

/** True when the value of the static definition `def` is held by the
 * activations of its scope. */
export function isActivatedDefinition(def: object): boolean {
  return (def as ActivatedDefinition)._activated === true;
}

/**
 * The values of the first activation on the links from `from` (the parents
 * of the scopes) that holds the static definition `def`, or `undefined`
 * when there is none: the definition is read outside any evaluation of its
 * node, and it has no value. With `skipCallFrames`, the activation of a
 * call (registered with no template) does not answer.
 */
export function activationRecordOf(
  def: object,
  from: Scope | null | undefined,
  skipCallFrames = false
): Map<object, unknown> | undefined {
  for (let s = from; s != null; s = s.parent) {
    if (skipCallFrames && !scopeTemplates.has(s)) continue;
    const values = activationValues.get(s);
    if (values?.has(def)) return values;
  }
  return undefined;
}

/** The values that the activation `scope` holds, or `undefined` when
 * `scope` is not an activation. */
export function activationValuesOf(
  scope: Scope
): Map<object, unknown> | undefined {
  return activationValues.get(scope);
}

export function scopeActivationTemplate(scope: Scope): Scope | undefined {
  return scopeTemplates.get(scope);
}

/**
 * The activation of `scope` on the links from `from` (the parents of the
 * scopes, `from` included): an activation of `scope`, the frame of a call
 * that applies it, or `scope` itself, whichever the links reach first;
 * `scope` when they reach none of them.
 */
export function activationOnLinks(
  from: Scope | null | undefined,
  scope: Scope
): Scope {
  if (!activatedTemplates.has(scope)) return scope;
  for (let s = from; s != null; s = s.parent)
    if (
      s === scope ||
      scopeTemplates.get(s) === scope ||
      frameBodies.get(s) === scope
    )
      return s;
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
 * An activation of `scope` for one evaluation of the node that holds it:
 * the bindings of `scope` (the static definitions) and the value of each of
 * its locals in this evaluation: a local of a block and a variable of a
 * binder (`markBinderVariable()`), each of which starts with no value. A
 * binding of another kind that the
 * scope holds (a parameter of an enclosing function literal, a name that
 * the boxing declared there) is not a local of the node, and its value is
 * held elsewhere. Its parent is `parent`, the activation in which the node
 * is evaluated (the current lexical scope).
 */
export function scopeActivation(
  parent: Scope | null | undefined,
  scope: Scope
): Scope {
  const values = new Map<object, unknown>();
  for (const [name, binding] of scope.bindings) {
    if (!('value' in binding)) continue;
    const def = binding.value as unknown as {
      isConstant: boolean;
      _blockLocal?: boolean;
      _programVariable?: boolean;
      _isBinderVariable?: boolean;
    };
    if (
      (def._blockLocal === true && !def._programVariable) ||
      (!def.isConstant &&
        (def._isBinderVariable === true ||
          scope.binderNames?.has(name) === true))
    )
      values.set(def, undefined);
  }
  const live = parent ?? scope.parent;
  const released = live != null ? idleActivations.get(live) : undefined;
  const idle = released?.get(scope);
  if (idle !== undefined) {
    released!.delete(scope);
    if (
      idle.parent === live &&
      idle.noAutoDeclare === scope.noAutoDeclare &&
      idle.binderNames === scope.binderNames &&
      sameEntries(idle.bindings, scope.bindings)
    ) {
      activationValues.set(idle, values);
      return idle;
    }
  }
  const result: Scope = {
    ...scope,
    parent: live,
    bindings: new Map(scope.bindings),
  };
  registerScopeActivation(result, scope, values);
  return result;
}

/** True when the maps `a` and `b` have the same entries. */
function sameEntries<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/**
 * Release `scope`, an activation whose frame was popped from `stack`: the
 * next activation of its template in the same parent can be the same object,
 * with new values (`scopeActivation()`). The released activation holds no
 * values. These activations are not released:
 * - one that a function value, a lazy collection, a scoped node or an
 *   asynchronous evaluation keeps (`markActivationKept()`);
 * - one that a frame of `stack` still has;
 * - one whose parent is a call frame: the next evaluation is in another
 *   call, with another frame.
 */
export function releaseActivation(
  scope: Scope,
  stack: ReadonlyArray<{ lexicalScope: Scope }>
): void {
  const template = scopeTemplates.get(scope);
  if (template === undefined || keptScopes.has(scope)) return;
  const parent = scope.parent;
  if (parent == null || frameBodies.has(parent)) return;
  for (const frame of stack) if (frame.lexicalScope === scope) return;
  activationValues.set(scope, RELEASED_VALUES);
  let released = idleActivations.get(parent);
  if (released === undefined)
    idleActivations.set(parent, (released = new WeakMap()));
  released.set(template, scope);
}

/**
 * Record that `scope`, an activation, outlives the evaluation that pushed
 * it: a function value keeps it as the parent of the scope of its body, a
 * lazy collection as its record, a scoped node made by an evaluation on the
 * chain of parents of its scope (`noteNodeScope()`), or an asynchronous
 * evaluation on a copy of the stack. Every scope on its chain of parents is kept too. The parent of
 * a scope does not change, so a kept scope has kept parents, and the walk
 * stops at the first scope that is kept already.
 */
export function markActivationKept(scope: Scope | null | undefined): void {
  for (let s = scope; s != null && !keptScopes.has(s); s = s.parent)
    keptScopes.add(s);
}

/**
 * Keep the activation of each frame of `stack`, the copy of the context
 * stack that an asynchronous evaluation runs on (`beginAsyncEvaluation()`,
 * `beginAsyncStatement()`): the evaluation can run after the frames that it
 * shares with the stack it copied are popped (`markActivationKept()`).
 */
export function keepStackActivations(
  stack: ReadonlyArray<{ lexicalScope: Scope }> | undefined
): void {
  if (stack === undefined) return;
  for (const frame of stack) markActivationKept(frame.lexicalScope);
}

/**
 * Give the iteration that is about to write the binder variable `name` an
 * activation of its own. When the top frame of `stack` is an activation
 * that holds the value of `name`, the frame gets a new activation of the
 * same template, with the same parent, whose values start as a copy of the
 * previous ones. A function value made in the previous iteration keeps the
 * previous activation, and so the value of `name` in that iteration.
 *
 * An activation that no function value keeps (`markActivationKept()`) is
 * read by nothing after this iteration, so the next iteration writes its
 * values in place.
 */
export function renewIterationActivation(
  stack: ReadonlyArray<{ lexicalScope: Scope }>,
  name: string
): void {
  const top = stack[stack.length - 1];
  const scope = top?.lexicalScope;
  if (scope === undefined || !keptScopes.has(scope)) return;
  const template = scopeTemplates.get(scope);
  const values = activationValues.get(scope);
  if (template === undefined || values === undefined) return;
  const binding = template.bindings.get(name) as { value?: object } | undefined;
  if (binding?.value === undefined || !values.has(binding.value)) return;
  const fresh: Scope = { ...scope, bindings: new Map(scope.bindings) };
  registerScopeActivation(fresh, template, new Map(values), true);
  (top as { lexicalScope: Scope }).lexicalScope = fresh;
}

/**
 * True when every name resolves from the scope `a` as it resolves from the
 * scope `b`: the two chains of parents reach the same scope, and before it
 * they have, level by level, the same template (an activation of the same
 * scope, the frame of a call of the same function literal) and the same
 * bindings. Two activations of one scope are equivalent unless an
 * evaluation declared a name in one of them. The values that the
 * activations hold may differ: a cache keyed on the chain records the
 * values it reads (`effects-of.ts`).
 */
export function equivalentChains(
  a: Scope | null | undefined,
  b: Scope | null | undefined
): boolean {
  while (a !== b) {
    if (a == null || b == null) return false;
    const ka = scopeTemplates.get(a) ?? frameBodies.get(a);
    if (
      ka === undefined ||
      ka !== (scopeTemplates.get(b) ?? frameBodies.get(b))
    )
      return false;
    if (a.bindings !== b.bindings) {
      if (a.bindings.size !== b.bindings.size) return false;
      for (const [name, binding] of a.bindings)
        if (b.bindings.get(name) !== binding) return false;
    }
    a = a.parent;
    b = b.parent;
  }
  return true;
}
