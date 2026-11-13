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

// The static definitions of the scopes that have had an activation: their
// value is read and written in an activation (`activationRecordOf()`).
const activatedDefinitions = new WeakSet<object>();

/**
 * Record that `scope` is an activation of `template`, or holds the values
 * of an evaluation with no template (a call frame). `values` holds the
 * value of each static definition in this evaluation.
 */
function registerScopeActivation(
  scope: Scope,
  template: Scope | undefined,
  values?: Map<object, unknown>
): void {
  if (template !== undefined) {
    scopeTemplates.set(scope, template);
    activatedTemplates.add(template);
  }
  if (values === undefined) return;
  activationValues.set(scope, values);
  for (const def of values.keys()) activatedDefinitions.add(def);
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

/** True when the chain of parents of `scope` holds an activation. */
export function holdsActivation(scope: Scope | null | undefined): boolean {
  for (let s = scope; s != null; s = s.parent)
    if (activationValues.has(s)) return true;
  return false;
}

/** True when the value of the static definition `def` is held by the
 * activations of its scope. */
export function isActivatedDefinition(def: object): boolean {
  return activatedDefinitions.has(def);
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
  const result: Scope = {
    ...scope,
    parent: parent ?? scope.parent,
    bindings: new Map(scope.bindings),
  };
  const values = new Map<object, unknown>();
  for (const [name, binding] of scope.bindings) {
    if (!('value' in binding)) continue;
    const def = binding.value as unknown as {
      isConstant: boolean;
      _blockLocal?: boolean;
      _isBinderVariable?: boolean;
    };
    if (
      def._blockLocal === true ||
      (!def.isConstant &&
        (def._isBinderVariable === true ||
          scope.binderNames?.has(name) === true))
    )
      values.set(def, undefined);
  }
  registerScopeActivation(result, scope, values);
  return result;
}

/**
 * Give the iteration that is about to write the binder variable `name` an
 * activation of its own. When the top frame of `stack` is an activation
 * that holds the value of `name`, the frame gets a new activation of the
 * same template, with the same parent, whose values start as a copy of the
 * previous ones. A function value made in the previous iteration keeps the
 * previous activation, and so the value of `name` in that iteration.
 */
export function renewIterationActivation(
  stack: ReadonlyArray<{ lexicalScope: Scope }>,
  name: string
): void {
  const top = stack[stack.length - 1];
  const scope = top?.lexicalScope;
  if (scope === undefined) return;
  const template = scopeTemplates.get(scope);
  const values = activationValues.get(scope);
  if (template === undefined || values === undefined) return;
  const binding = template.bindings.get(name) as { value?: object } | undefined;
  if (binding?.value === undefined || !values.has(binding.value)) return;
  const fresh: Scope = { ...scope, bindings: new Map(scope.bindings) };
  registerScopeActivation(fresh, template, new Map(values));
  (top as { lexicalScope: Scope }).lexicalScope = fresh;
}
