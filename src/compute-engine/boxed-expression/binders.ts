import { activationOnLinks, scopeActivationTemplate } from './ambient-chain.js';
import {
  externalFactScope,
  forwardCallScope,
  isForwardCallReference,
  retiredBindingScope,
} from './forward-call-reference.js';
import type {
  BoxedBaseDefinition,
  BoxedDefinition,
  BoxedValueDefinition,
  Expression,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
  TaggedValueDefinition,
} from '../global-types.js';
import {
  isFunction,
  isSymbol,
  isDictionary,
  isNumber,
  isFreeName,
  isFreeCallHead,
} from './type-guards.js';
import {
  functionLiteralParameterNames,
  isFunctionLiteralParameter,
} from './function-literal.js';
import { assertLiveBinding, isTombstoned } from './binding-tombstone.js';
import {
  binderBoundAt,
  declaredBinders,
  mapOwnIndexClause,
  ownIndexClauseAt,
  type DeclaredBinders,
} from './binding-sites.js';
import { isInvalidNonCollection } from './error-value.js';
import { copyContextStack } from './evaluation-epoch.js';
import { isPendingCallScope } from '../pending-call-scopes.js';
import { isQualifiedName } from '../library-shadowing.js';
import {
  noteCallFrame,
  staticBindingIn,
  staticParentOf,
} from '../static-typing-view.js';

/**
 * The names bound BY THIS NODE (not by its descendants).
 *
 * Two sources: a scoped expression (`Block`, `Sum`, `Comprehension`, …) owns a
 * `localScope` whose bindings are its bound variables, and a `Function`
 * literal binds its parameter list.
 *
 * Lives in its own module because both the traversal in `utils.ts`
 * (`collectBinderNames`, for capture-avoiding substitution) and the equality
 * walk in `compare.ts` (which compares a bound occurrence by name and a free
 * one by binding) need it — and importing `utils.ts` from `compare.ts` closes
 * the cycle `compare → utils → abstract-boxed-expression → compare`.
 */
export function boundVariableNames(expr: Expression): readonly string[] {
  // Fast path: most nodes bind nothing. `same()` asks this of EVERY function
  // node it descends through, so returning a shared empty array rather than a
  // fresh one keeps the equality walk allocation-free on the hot path.
  const bindings = expr.localScope?.bindings;
  const isLambda = isFunction(expr, 'Function');
  if (!isLambda && !bindings?.size) return NO_BINDERS;

  const names: string[] = [];
  if (bindings) names.push(...bindings.keys());
  if (isLambda) {
    // Every name the parameter list binds — a destructuring parameter
    // (`((p, q)) => …`) binds each of its pattern's leaves, and a walk that
    // missed them would treat a body occurrence of `p` as free.
    const ops = expr.ops;
    for (let i = 1; i < ops.length; i++)
      names.push(...functionLiteralParameterNames(ops[i]));
  }
  return names.length === 0 ? NO_BINDERS : names;
}

const NO_BINDERS: readonly string[] = [];

/**
 * The names bound by `expr` that are IN SCOPE in its operand `index`.
 *
 * The same list as {@link boundVariableNames} for most binders. A binder whose
 * sites are iterator CLAUSES (`BindingSite.clauseLocal`: `Sum`, `Product`,
 * `Comprehension`, `Loop`, …) binds each index from its own clause onward:
 * in `Comprehension(b, Element(i, [j, j+1]), Element(j, [10, 20]))` the first
 * clause's collection reads the ENCLOSING `j`, not the second clause's index
 * — "later clauses see earlier bindings", not the reverse — while the body
 * (every operand before the first clause) sees every binding. That is the
 * scope `bindBindingSites` (`box.ts`) canonicalizes against, so a
 * free-variable walk or a rewrite that treated every bound name as shadowing
 * the whole node would report such a `j` bound and never substitute it, and a
 * route that folds a node with no free variables would then evaluate it with
 * the enclosing `j` unbound (a guarded comprehension compiled to `[]`, found
 * 2026-09-27).
 *
 * `binders` is the node's clause ordering, `declaredBinders(expr, 'post')`
 * (`binding-sites.ts`) for a canonical node. A node that is not canonical
 * and has no scope (held content) has its ordering read in the `'pre'`
 * phase, which a raw tree can answer for (`rewriteWithBinders`). A walk
 * over the operands computes it ONCE per node and passes it in, so the
 * selector is not re-run for every operand; the default serves a one-off
 * question. A name the scope binds that the selectors do not order (a
 * `Block` local) is in scope throughout.
 */
export function boundVariableNamesInOperand(
  expr: Expression,
  index: number,
  binders: DeclaredBinders | undefined = declaredBinders(expr, 'post')
): readonly string[] {
  const names = boundVariableNames(expr);
  if (names.length === 0) return names;
  if (binders === undefined || index < binders.firstClause) return names;
  const visible = names.filter(
    (n) => (binders.visibleFrom.get(n) ?? 0) <= index
  );
  return visible.length === names.length ? names : visible;
}

/**
 * Whether `def` is a parameter of a `Function` literal, whose value a call
 * frame holds. A `let` local of the body, a binder index and a top-level
 * symbol are not.
 */
export function isParameterActivation(def: BoxedValueDefinition): boolean {
  return isActivation(def);
}

/**
 * Do two definitions denote the same binding? A parameter, a binder variable
 * and a block local have one definition, whatever activation holds their
 * value, so this is identity.
 */
export function sameBindingDef(
  a: BoxedBaseDefinition | undefined,
  b: BoxedBaseDefinition | undefined
): boolean {
  return a === b;
}

// Static block locals can change representation from a value placeholder to
// an operator at runtime. Their lexical home still identifies the same slot.
const callableHomes = new WeakMap<BoxedBaseDefinition, Scope>();
const callableFrames = new WeakMap<Scope, Scope>();
export function hasCallableHome(def: BoxedDefinition): boolean {
  return callableHomes.has('value' in def ? def.value : def.operator);
}
export function markCallableHome(def: BoxedDefinition, scope: Scope): void {
  const half = 'value' in def ? def.value : def.operator;
  if (!callableHomes.has(half)) callableHomes.set(half, scope);
}
export function markCallableFrame(frame: Scope, template: Scope): void {
  callableFrames.set(frame, template);
  // A call frame of a function literal, made for this call and not pushed
  // yet: the static view of the bindings (`static-typing-view.ts`) reads
  // the body scope in its place.
  if (isPendingCallScope(frame)) noteCallFrame(frame, template);
}

/**
 * Whether `scope` is `home`, or a runtime copy of it: a call frame of a
 * function body (`markCallableFrame`), an activation of a scoped node
 * (`registerScopeActivation`), or a scope that a closure captured in place
 * of a nested block scope (`captureNestedLocals`, `function-utils.ts`).
 * A copy can stand for another copy (a closure captures the call frame of
 * the function that creates it, and a closure returned again is re-rooted on
 * a copy of its captured scopes), so the links are followed to their end.
 * Each link goes from a new scope to a scope that exists already, so they
 * do not make a cycle; the set of visited scopes is a guard only.
 */
function scopeStandsFor(scope: Scope, home: Scope): boolean {
  if (scope === home) return true;
  const visited = new Set<Scope>();
  let current: Scope | undefined = scope;
  while (current !== undefined && !visited.has(current)) {
    if (current === home) return true;
    visited.add(current);
    current = callableFrames.get(current) ?? scopeActivationTemplate(current);
  }
  return false;
}

/**
 * The temporary scopes that lend an operator definition to the head of a
 * call (`withBorrowedBinding()`, and the scope in which `simplify()` masks
 * the calls of a shadowed library operator), with the names lent. A symbol
 * does not read such a binding
 * (`bindingInContext()`): it is lent to a call head. The type of an occurrence is read by name in the current
 * context (rule 3 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`),
 * so with `N` declared a real variable, the operand `N` of `Range(1, N)`,
 * read while a call of the library operator `N` is rebuilt, would have the
 * type of that operator.
 */
const BORROWED_OPERATOR_SCOPES = new WeakMap<Scope, Set<string>>();

/**
 * Record that `scope`, a temporary scope, lends an operator definition under
 * `name` to the head of a call (`BORROWED_OPERATOR_SCOPES`).
 */
export function markBorrowedOperator(scope: Scope, name: string): void {
  let names = BORROWED_OPERATOR_SCOPES.get(scope);
  if (names === undefined)
    BORROWED_OPERATOR_SCOPES.set(scope, (names = new Set()));
  names.add(name);
}

/** Preserve a callable's binding while canonicalizing rewritten operands. */
export function withCallableBinding<T>(expr: Expression, build: () => T): T {
  if (!isFunction(expr)) return build();
  const own =
    expr.valueDefinition !== undefined
      ? { value: expr.valueDefinition }
      : expr.operatorDefinition !== undefined
        ? { operator: expr.operatorDefinition }
        : undefined;
  const ce = expr.engine;
  const binding = callableBindingInContext(ce, expr.operator, own);
  if (binding === undefined || ce.lookupDefinition(expr.operator) === binding)
    return build();
  return withBorrowedBinding(ce, expr.operator, binding, build);
}

/**
 * Run `build` in a scope where `name` resolves to `binding`, a definition
 * that a scope of the chain or the system scope already holds: a call that
 * `build` boxes by name is bound to `binding`, not to the definition the
 * current scope resolves the name to. `withCallableBinding()` uses it to keep
 * the binding of a call that is rebuilt, and
 * `BoxedFunction._withLibraryBinding()` to keep the library binding of a call
 * whose structural form is rebuilt in a scope that shadows its name.
 */
export function withBorrowedBinding<T>(
  ce: ComputeEngine,
  name: string,
  binding: BoxedDefinition,
  build: () => T
): T {
  // The scope of the chain (or the system scope) that holds `binding` is its
  // home: mark it before `build` runs. `BoxedFunction._bind()` marks the
  // first scope of the chain that holds the binding of a call, and that
  // would be the temporary scope below, which would then stay alive with
  // its parent chain for as long as the definition.
  if (!hasCallableHome(binding))
    for (
      let scope: Scope | null = ce.context.lexicalScope;
      scope;
      scope = scope.parent
    )
      if (scope.bindings.get(name) === binding) {
        markCallableHome(binding, scope);
        break;
      }
  const bindings = new Map([[name, binding]]);
  const borrowsOperator = 'operator' in binding;
  // The scope holds only the borrowed binding. A name that the build
  // declares automatically (a new symbol of a raw operand) goes to the
  // enclosing scope: a declaration in this scope would be lost when the
  // scope is popped.
  ce.pushScope({
    parent: ce.context.lexicalScope,
    bindings,
    noAutoDeclare: true,
  });
  if (borrowsOperator) markBorrowedOperator(ce.context.lexicalScope, name);
  try {
    return build();
  } finally {
    // The scope borrows definitions; popping it must not dispose their facts.
    bindings.clear();
    ce.popScope();
  }
}

/** Callable positions use lexical identity. Runtime activations of that
 * identity supply parameters and block locals; an unrelated shadow cannot. */
export function callableBindingInContext(
  ce: ComputeEngine,
  name: string,
  own: BoxedDefinition | undefined
): BoxedDefinition | undefined {
  if (own === undefined) return ce.lookupDefinition(name);
  const half = 'value' in own ? own.value : own.operator;
  const home = callableHomes.get(half);
  const start = ce.context.lexicalScope;
  // Inside a type computation, the static view of the bindings
  // (`static-typing-view.ts`): a call frame does not answer.
  for (let scope: Scope | null = start; scope; scope = staticParentOf(scope)) {
    const found = staticBindingIn(scope, name, scope === start);
    if (found === undefined) continue;
    const candidate = 'value' in found ? found.value : found.operator;
    if (
      candidate === half ||
      (home !== undefined && scopeStandsFor(scope, home))
    ) {
      if (!('value' in found) || !isForwardCallReference(found.value))
        return found;
      break;
    }
  }
  // Forward calls wait for a definition in their original lexical chain.
  // A type/evaluation read never binds them to an unrelated caller's scope:
  // with `∫₀¹ g(x) dx` made before `g(t) := t`, a scope that declares
  // `g := t ↦ 100` does not make the integral 100.
  if ('value' in own) {
    for (
      let scope = forwardCallScope(own.value);
      scope;
      scope = scope.parent ?? undefined
    ) {
      const found = scope.bindings.get(name);
      if (
        found !== undefined &&
        !('value' in found && isForwardCallReference(found.value))
      )
        return found;
    }
    // A fact that a `resolveSymbol` callback of `ce.parse()` gave (`f` of
    // type `(real) -> real`) states a type, and does not define the name.
    // Its scope belongs to the parsed expression, and is not on the chain
    // when the expression is evaluated (when it is, the search above found
    // the fact). The call reads the definition that the scope of the
    // `parse()` call, or a scope that encloses it, holds when it is
    // evaluated: after `ce.assign('f', …)` in that scope, `f(5)` is
    // evaluated with the assigned function. A binding there that does not
    // define the name (an inferred placeholder with no value) does not
    // replace the fact. The search starts above the fact scope, so a
    // declaration of the same name in an unrelated scope does not change
    // the call.
    const factScope = externalFactScope(own.value);
    if (factScope !== undefined) {
      for (let scope = factScope.parent; scope; scope = scope.parent) {
        const found = scope.bindings.get(name);
        if (found === undefined) continue;
        if ('value' in found && found.value.value === undefined) continue;
        return found;
      }
      return own;
    }
    // The record of a binding that `ce.undeclare()` removed holds an empty
    // definition of type `unknown`. A call boxed before the removal reads
    // the definition that the scope it was removed from, or a scope that
    // encloses it, holds when the call is evaluated: `f(2)` reads a later
    // declaration of `f` in that scope, or the declaration of `f` in an
    // enclosing scope, and stays unevaluated when there is none. A
    // declaration of `f` in an unrelated scope does not change the call.
    const retiredScope = retiredBindingScope(own.value);
    if (retiredScope !== undefined) {
      for (
        let scope: Scope | null = retiredScope;
        scope;
        scope = scope.parent
      ) {
        const found = scope.bindings.get(name);
        if (
          found !== undefined &&
          !('value' in found && isForwardCallReference(found.value))
        )
          return found;
      }
    }
  }
  return own;
}

/**
 * The value definition a symbol OCCURRENCE reads its value from in the
 * current runtime context (`bindingInContext()`).
 *
 * An occurrence of a parameter, of the variable of a binder or of a local of
 * a block (`readsActivation()`) reads its own definition `own`: the first
 * binding of the chain that holds it, whose value is in the activation of its
 * scope found on the links. When the chain does not hold it, the occurrence
 * is read outside its activation and has no value; a binding of the same
 * name is another variable. With `n := [1, 2]`, the operand `n` of
 * `n ↦ n + 1` read outside a call has no value, so the literal is typed
 * `(n) -> number`, not `(n) -> list<number>`.
 *
 * Any other occurrence reads the innermost binding of its name, except the
 * variable of a binder and the parameter activation of a call frame that are
 * not `own`: they belong to another expression's variable that shares the
 * name (ruled 2026-09-21: with `w` declared and valueless and
 * `W := x ↦ [w x, x]`, `[W(w)[1] for w in [1, 2, 3]]` is `[w, 2w, 3w]`). When
 * no other binding is found, such a skipped binding answers, except for a
 * free name of the body of a function literal (rule 3 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`).
 */
export function valueDefinitionInContext(
  ce: ComputeEngine,
  name: string,
  own: BoxedBaseDefinition | undefined
): BoxedValueDefinition | undefined {
  const found = bindingInContext(ce, name, own);
  return found !== undefined && 'value' in found ? found.value : undefined;
}

/**
 * The binding `valueDefinitionInContext` reads from, as the scope's own
 * (tagged) entry, and starting from `scope` rather than the current context
 * when given — so a consumer that validates a dependency against the chain
 * an instance resolves through (`collection-element-memo.ts`) walks the same
 * way the evaluator does.
 */
export function bindingInContext(
  ce: ComputeEngine,
  name: string,
  own: BoxedBaseDefinition | undefined,
  scope: Scope | null = ce.context.lexicalScope
): BoxedDefinition | undefined {
  // A parameter, a binder variable and a local of a block read their own
  // definition, in the activation of their scope found on the chain. None
  // found: the occurrence is read outside its activation, and has no value.
  const local = own !== undefined && readsActivationHalf(own);
  const start = scope;
  let skippedBinder: BoxedDefinition | undefined;
  while (scope) {
    // Inside a type computation, the static view of the bindings
    // (`static-typing-view.ts`): a call frame does not answer.
    const found = staticBindingIn(scope, name, scope === start);
    if (
      found !== undefined &&
      !(BORROWED_OPERATOR_SCOPES.get(scope)?.has(name) === true)
    ) {
      if (local) {
        if (
          sameBindingDef('value' in found ? found.value : found.operator, own)
        )
          return found;
      } else if ('value' in found && isForeignBinderBinding(found.value, own)) {
        skippedBinder ??= found;
      } else return found;
    }
    // The parent of a scope reads in the activation of that parent on the
    // links from the current lexical scope (`activationOnLinks()`), as the
    // variable of a binder reads its value there.
    const parent = staticParentOf(scope);
    scope = parent && activationOnLinks(ce.context.lexicalScope, parent);
  }
  if (local) return undefined;
  return skippedBinder;
}

/**
 * True when an occurrence bound to `def` reads its value in an activation:
 * `def` is a parameter of a function literal or a call frame's activation of
 * one, the variable of a binder, or a local of a block or of the body of a
 * function literal. Such an occurrence reads the activation that the
 * evaluation in progress is in (`bindingInContext()`). Every other occurrence
 * reads the definition that its home chain gives (`homeChainBinding()`).
 */
export function readsActivation(def: BoxedDefinition): boolean {
  if (isBlockLocalBinding(def)) return true;
  return 'value' in def && readsActivationHalf(def.value);
}

/** `readsActivation()` for the value definition `def`, without the local
 * that a run of a `Declare` statement outside an activation made: the value
 * of such a local is held by the definition, not by an activation. */
export function readsActivationHalf(def: BoxedBaseDefinition): boolean {
  if (isActivation(def)) return true;
  const own = def as BoxedValueDefinition;
  return (
    isFunctionLiteralParameter(own) ||
    isBinderVariable(own) ||
    own._blockLocal === true
  );
}

/**
 * The definition that an occurrence of `name`, bound to `own` when it was
 * boxed in the scope `home`, reads: the first binding of `name` up the chain
 * of `home`. That binding is `own`, or a declaration made later in `home` or
 * in an ancestor of `home` below the scope of `own`, which hides `own`, or,
 * when no scope of the chain holds `own` any more (a removed declaration), a
 * binding of the name by which `own` was replaced. With no binding of the
 * name on the chain, `own`. The current scope plays no part. The walk skips the
 * variable of a binder, a parameter and a call frame's activation, as a free
 * name does (`freeNameBindingAndScope()`), and an operator definition that a
 * temporary scope lends (`markBorrowedOperator()`).
 *
 * The result holds the scope of the definition found, `undefined` for
 * `own` when no scope holds it.
 *
 * Only a declaration changes the answer, and a declaration moves the type
 * version of the engine, so a caller can keep the answer under that version.
 */
export function homeChainBinding(
  name: string,
  own: BoxedDefinition,
  home: Scope
): { def: BoxedDefinition; scope: Scope | undefined } {
  let first: { def: BoxedDefinition; scope: Scope } | undefined;
  for (let s: Scope | null | undefined = home; s; s = s.parent) {
    const found = s.bindings.get(name);
    if (found === undefined) continue;
    if (found === own) return first ?? { def: own, scope: s };
    if (
      first === undefined &&
      !(BORROWED_OPERATOR_SCOPES.get(s)?.has(name) === true) &&
      !(
        'value' in found &&
        (isBinderVariable(found.value) ||
          isFunctionLiteralParameter(found.value) ||
          isActivation(found.value))
      )
    )
      first = { def: found, scope: s };
  }
  return first ?? { def: own, scope: undefined };
}

/**
 * The definition that an occurrence of the free name `name` reads in the
 * current context, or `undefined` when there is none (`binding-unit.ts`).
 *
 * A free name is a canonical symbol with no definition: it was boxed when its
 * name had no definition, and it was not inside a binder then. The walk
 * skips the variable of a binder (a `Sum` index), a parameter of a function
 * literal and the parameter activation of a call frame: such a binding is
 * not the one that the free name denotes. The skip applies to an occurrence
 * that stays free and is read while the scope of a binder is current, for
 * example an occurrence reached through the value of a name: with
 * `a := n + 1`, the `n` of the value of `a` is read inside `Σ_n a`, and it
 * does not read the index `n`. Every other binding
 * is read by name, as `bindingInContext()` reads it for an occurrence with
 * no definition of its own.
 *
 * With `skipLibraryOperator`, the walk also skips an operator definition of
 * the root scope (the standard library): the unit of the occurrence reads
 * the name as a variable (`N` in `N + 1`, `UnitEnvironment.readsAsVariable()`).
 *
 * With `home`, the home scope of the free name, a read of a free name of a
 * stored value also skips a local of a `Block` (`isBlockLocalBinding()`) in a
 * scope that is not `home` or an ancestor of it: the stored value was not
 * inside that block when it was boxed. The read is one of a stored value
 * when `outsideBlocks` is true, or when the walk passes the scope that the
 * evaluation of a stored value pushes (`evaluateInOwnBindings()`). With
 * `a := x + 1`, the `x` of the value of `a` is read inside
 * `Block(Declare(x, real, 7), a + 5)`, and it does not read the local `x`. A
 * free name that is an operand of the block (a host builds the block with
 * `ce.function()`) is read by the block itself, and reads the local.
 */
export function freeNameBindingInContext(
  ce: ComputeEngine,
  name: string,
  scope: Scope | null = ce.context.lexicalScope,
  skipLibraryOperator = false,
  home?: Scope,
  outsideBlocks = false
): BoxedDefinition | undefined {
  return freeNameBindingAndScope(
    ce,
    name,
    scope,
    skipLibraryOperator,
    home,
    outsideBlocks
  )?.def;
}

/**
 * The definition that `freeNameBindingInContext()` finds, and the scope of
 * the walk that holds it. `undefined` when there is no definition.
 */
export function freeNameBindingAndScope(
  ce: ComputeEngine,
  name: string,
  scope: Scope | null = ce.context.lexicalScope,
  skipLibraryOperator = false,
  home?: Scope,
  outsideBlocks = false
): { def: BoxedDefinition; scope: Scope } | undefined {
  const start = scope;
  let storedValue = outsideBlocks;
  while (scope) {
    if (storedValueScopes.has(scope)) storedValue = true;
    const found = staticBindingIn(scope, name, scope === start);
    if (
      found !== undefined &&
      !(skipLibraryOperator && 'operator' in found && !scope.parent) &&
      !(
        'value' in found &&
        (isBinderVariable(found.value) ||
          isFunctionLiteralParameter(found.value) ||
          isActivation(found.value))
      ) &&
      !(
        home !== undefined &&
        storedValue &&
        isBlockLocalBinding(found) &&
        !isScopeOrAncestor(scope, home)
      )
    )
      return { def: found, scope };
    scope = staticParentOf(scope);
  }
  return undefined;
}

/**
 * True when `found` is a local of a `Block`: a binding that the
 * canonicalization of the block made for a `Declare` statement
 * (`_blockLocal`), or that a run of a `Declare` statement outside an
 * activation made (`_declaredByStatement`, `declareSteps()`,
 * `library/core.ts`).
 */
export function isBlockLocalBinding(found: BoxedDefinition): boolean {
  if ((found as { _declaredByStatement?: boolean })._declaredByStatement)
    return true;
  return 'value' in found && found.value._blockLocal === true;
}

/** The scopes that `evaluateInOwnBindings()` pushes for the evaluation of a
 * stored value (`freeNameBindingAndScope()`). */
const storedValueScopes = new WeakSet<Scope>();

/** True when `scope` is `home` or an ancestor of `home`. */
function isScopeOrAncestor(scope: Scope, home: Scope): boolean {
  for (let s: Scope | null = home; s; s = s.parent)
    if (s === scope) return true;
  return false;
}

/**
 * Is the binding `scope` holds for `name` a BINDER's variable that the
 * occurrence bound to `own` does not denote?
 *
 * A call frame's parameter activation qualifies even when the occurrence
 * carries no binding at all (`own` is `undefined`). A binder operator's index
 * (`markBinderVariable`) qualifies when the occurrence has a binding: one
 * with no binding names nothing in particular, so the innermost binding by
 * name is still the best answer for it, and a raw index symbol handed to a
 * binder from outside keeps reading that binder's variable. An occurrence of
 * a binder's own variable reads its definition (`bindingInContext()`) and
 * does not come here.
 */
function isForeignBinderBinding(
  def: BoxedValueDefinition,
  own: BoxedBaseDefinition | undefined
): boolean {
  if (sameBindingDef(def, own)) return false;
  if (isActivation(def)) return true;
  if (own === undefined) return false;
  return isBinderVariable(def);
}

/** Is `def` a parameter of a function literal, whose value a call frame
 * holds? */
function isActivation(def: BoxedBaseDefinition): boolean {
  return isFunctionLiteralParameter(def);
}

/**
 * The value a running function call gave to the parameter that `sym` denotes,
 * or `undefined` when `sym` is not such a parameter (a global, a local
 * variable, a loop index) or holds no value.
 *
 * A held operator that differentiates or integrates its operand needs this:
 * the operand `f` of `g(f) = D(f, x)` is a parameter whose value, `x^2`, only
 * exists once the call is running, so the operator must read it from the call
 * frame instead of taking the symbol for a constant.
 */
export function parameterActivationValue(
  ce: ComputeEngine,
  sym: Expression & { symbol: string }
): Expression | undefined {
  // An operand that a held operator received unbound has no binding of its
  // own, and `valueDefinitionInContext` then skips an activation to return the
  // next binding of the name, so a global of the same name (created by any
  // later parse of that name) would hide the parameter. Read the innermost
  // binding of the name instead. A free name (`isFreeName()`,
  // `binding-unit.ts`) was boxed outside the call: it never denotes a
  // parameter.
  if (isFreeName(sym)) return undefined;
  const def =
    sym.valueDefinition === undefined
      ? binderBindingOf(ce, sym.symbol)
      : valueDefinitionInContext(ce, sym.symbol, sym.valueDefinition);
  if (def === undefined || !isActivation(def)) return undefined;
  return def.value;
}

/**
 * The value a running function call gave to the parameter that the operator
 * of the application `app` denotes (the `f` of `f(x)`, with `f` a parameter
 * that holds a function), or `undefined` when the operator is not such a
 * parameter. The binding is read as `parameterActivationValue` reads the
 * binding of a symbol. An operator bound to an operator definition (a user
 * function `w(x) := …`, a library function) is not a parameter.
 */
export function calledParameterValue(
  ce: ComputeEngine,
  app: Expression
): Expression | undefined {
  if (!isFunction(app)) return undefined;
  const own = app.valueDefinition;
  if (own === undefined && app.operatorDefinition !== undefined)
    return undefined;
  // A free call head (`isFreeCallHead()`) was boxed outside the call: it
  // never denotes a parameter.
  if (isFreeCallHead(app)) return undefined;
  const def =
    own === undefined
      ? binderBindingOf(ce, app.operator)
      : valueDefinitionInContext(ce, app.operator, own);
  if (def === undefined || !isActivation(def)) return undefined;
  return def.value;
}

/**
 * Can `value`, the value of a parameter of a running function call, vary
 * with the variable `name` of the binder that is being evaluated (the
 * variable of a `D` or of an `Integrate`)?
 *
 * When the variable of the binder is a parameter of a running call too
 * (`(x, y) ↦ D(x·y, x)`), the parameters are independent variables: the
 * derivative is `y`, and the call then puts each argument in place of its
 * parameter. The value of another parameter does not vary with that
 * variable, even if it holds a symbol with the same name: in the
 * application at `(3, x)`, the `x` that `y` receives is the `x` of the
 * caller, not the parameter `x`. Put in place of `y` before the
 * differentiation, it gave the derivative `x + 3`, which is neither
 * reading; the value of the application is `x`. Only an occurrence bound to
 * that same parameter, or one with no binding, varies with the variable.
 *
 * In other cases (`g(f) = D(f, x)` with `x` a global), the name decides:
 * the value `x^2` of `f` in `g(x^2)` varies with `x`.
 *
 * Call this inside the evaluation of the binder: the binding of `name`
 * outside the binder is the first binding on the scope chain that is not the
 * variable of a binder.
 */
export function parameterValueVariesWith(
  ce: ComputeEngine,
  value: Expression,
  name: string
): boolean {
  if (!value.has(name)) return false;
  let outer: BoxedValueDefinition | undefined;
  for (
    let scope: Scope | null = ce.context.lexicalScope;
    scope;
    scope = scope.parent
  ) {
    const found = scope.bindings.get(name);
    if (found === undefined) continue;
    if (!('value' in found)) break;
    if (isBinderVariable(found.value)) continue;
    outer = found.value;
    break;
  }
  if (outer === undefined || !isActivation(outer)) return true;
  let varies = false;
  rewriteWithBinders(value, (s, shadowed) => {
    if (s.symbol !== name || shadowed?.has(name)) return s;
    const def = s.valueDefinition;
    // A free name (`isFreeName()`) was boxed outside the call: it is not the
    // parameter.
    if ((def === undefined && !isFreeName(s)) || sameBindingDef(def, outer))
      varies = true;
    return s;
  });
  return varies;
}

/**
 * The binding a BINDER holds for `name`, looked up from `scope` outward, or
 * `undefined` when the innermost binding of the name is not a binder's
 * variable.
 *
 * A caller that substitutes a binder's current index value into an
 * expression uses this to tell the occurrences the value is meant for — the
 * ones bound to the index — from occurrences of the same NAME that denote
 * something else, typically a global a stored value's body refers to. Ruled
 * 2026-09-21: only the former take the value (`substituteBinderValues`,
 * `library/utils.ts`).
 *
 * `scope` is the binder's own scope when the caller holds it — a
 * comprehension substitutes after its scope is no longer on the ambient
 * chain — and the current context otherwise.
 */
export function binderBindingOf(
  ce: ComputeEngine,
  name: string,
  scope: Scope | null = ce.context.lexicalScope
): BoxedValueDefinition | undefined {
  while (scope) {
    const found = scope.bindings.get(name);
    if (found !== undefined) {
      if (!('value' in found)) return undefined;
      if (isActivation(found.value) || isBinderVariable(found.value))
        return found.value;
      return undefined;
    }
    scope = scope.parent;
  }
  return undefined;
}

/** @see markBinderVariable */
type BinderVariable = { _isBinderVariable?: true };

/**
 * Mark the binding `scope` holds for `name` as a BINDER VARIABLE: the
 * variable a binder operator declares at one of its binding sites — a `Sum`
 * or `Product` index, a comprehension or loop index, a `D` or `Integrate`
 * variable. Written by `bindBindingSites` (`box.ts`), which owns the
 * authoritative set of sites.
 *
 * The mark is what lets `bindingInContext` tell such a binding from an
 * ordinary declaration without holding the scope it came from, and so lets a
 * read of a GLOBAL inside a called function body walk past a caller's index
 * of the same name (ruled 2026-09-21).
 *
 * A no-op for a name the scope does not bind, or binds to an operator
 * definition.
 */
export function markBinderVariable(scope: Scope, name: string): void {
  const def = scope.bindings.get(name);
  if (def !== undefined && 'value' in def)
    (def.value as unknown as BinderVariable)._isBinderVariable = true;
}

/** Is `def` a binder's variable (see `markBinderVariable`)? */
function isBinderVariable(def: BoxedBaseDefinition | undefined): boolean {
  return (def as BinderVariable | undefined)?._isBinderVariable === true;
}

/**
 * What this node binds, as name → the binding itself.
 *
 * `null` marks a name this node binds without owning a definition for it: a
 * `Function` literal's parameter list names the parameters, but their
 * definitions live in the body `Block`'s `localScope`, which is a child node.
 *
 * `same()` needs the definition, not just the name: an occurrence of `x`
 * inside a node that binds `x` is only that binder's variable if it actually
 * RESOLVES to that binding. A symbol carrying an outer binding can sit inside
 * the subtree — `.subs()` transplants one without re-canonicalizing — and
 * treating it as bound would compare it by name, which is precisely the
 * capture this repair exists to prevent.
 */
export function boundVariableBindings(
  expr: Expression
): ReadonlyMap<string, BoxedValueDefinition | null> | undefined {
  const bindings = expr.localScope?.bindings;
  const isLambda = isFunction(expr, 'Function');
  if (!isLambda && !bindings?.size) return undefined;

  const map = new Map<string, BoxedValueDefinition | null>();
  if (bindings)
    for (const [name, def] of bindings)
      // Inline value-def check (importing `isValueDef` from `utils.ts`
      // would restore the cycle this module exists to break).
      map.set(name, def !== undefined && 'value' in def ? def.value : null);
  if (isLambda) {
    const ops = expr.ops;
    for (let i = 1; i < ops.length; i++)
      for (const n of functionLiteralParameterNames(ops[i]))
        // Only as a fallback: the body Block's own binding (set above when this
        // node is the Block) is the definition-precise one.
        if (!map.has(n)) map.set(n, null);
  }
  // A lambda with no extractable parameter names binds nothing after all:
  // return `undefined` rather than an empty map, so `extendBinders` does not
  // copy the entire outer map to merge in nothing (nested binders would
  // otherwise cost O(depth²) in map copies).
  return map.size === 0 ? undefined : map;
}

/**
 * Rewrite the symbols of `expr`, tracking which names are shadowed by binders
 * along the way — the shared skeleton of every "re-point some symbols at a
 * different binding" pass (`rebindEscaping`, `rebindParameters`,
 * `bindingKeyedSubs`).
 *
 * `visit` is called for every symbol with the set of names bound by binders
 * between the ROOT and that occurrence (from `boundVariableNames`, so scoped
 * operators — `Sum`, `Block`, `Comprehension` — count, not just `Function`
 * parameter lists); the visitor decides what, if anything, the shadowing
 * means for its rewrite. Returning the same object means "unchanged", and
 * untouched subtrees are preserved by identity.
 *
 * `skipRootBinds` ignores what the root node itself binds — for a caller
 * whose whole purpose is to rewrite occurrences of the root's own bound
 * variables (`rebindParameters`).
 *
 * A rebuilt node carries its own `localScope` and form: `ce.function` would
 * otherwise mint a fresh empty scope for a scoped operator, leaving untouched
 * operands bound to the old scope while the rebuilt node advertises a
 * different one — a `Sum` whose body no longer resolves its index.
 */
export function rewriteWithBinders(
  expr: Expression,
  visit: (
    sym: Expression & { symbol: string },
    shadowed: ReadonlySet<string> | undefined
  ) => Expression,
  shadowed?: ReadonlySet<string>,
  skipRootBinds = false,
  // Per-call memo: the rewrite of a function node under a given set of
  // shadowed names. A subtree reached through several operands — a user
  // function applied to its own previous result embeds that result once per
  // mention of the parameter — is rewritten once per distinct shadowing, not
  // once per path, which is what keeps this walk linear in the number of
  // distinct nodes rather than exponential in the nesting depth. The root is
  // never memoized under `skipRootBinds`: its entry is keyed like any other
  // node's, and the two treatments differ.
  memo: Map<Expression, Map<string, Expression>> = new Map(),
  // Called for every application, with its operands already rewritten and
  // the names shadowed at the application (the names that the application
  // binds itself do not shadow its own operator name). It returns the
  // replacement of the whole application, or `undefined` to keep the
  // application with the rewritten operands. A caller that replaces a name
  // by a function value uses it for the occurrences of the name as an
  // operator: `f(x)` → `Apply(value, x)`.
  visitApplication?: (
    app: Expression,
    ops: ReadonlyArray<Expression>,
    shadowed: ReadonlySet<string> | undefined
  ) => Expression | undefined,
  // Called for every function node that binds a name
  // (`boundVariableNames`), and for every function node that is not
  // canonical, before the walk descends into it, with the names shadowed at
  // the node. A node that is not canonical (a held operand) has no scope, so
  // `boundVariableNames` does not see what it binds: the hook reads that
  // from its syntax. It returns a replacement of the node, or
  // `undefined` to keep it. The walk then rewrites the replacement in place
  // of the node, and the memo records the result under the original node. A
  // capture-avoiding substitution uses it to rename a bound variable of the
  // node that a substituted value mentions (`bindingKeyedSubs`). It is not
  // called for the root under `skipRootBinds`.
  visitBinder?: (
    node: Expression,
    shadowed: ReadonlySet<string> | undefined
  ) => Expression | undefined,
  // Called for each function node with the names that it binds
  // (`boundVariableNames`). It returns the names that shadow the walk into
  // the operands of the node. A name that it removes does not shadow the
  // walk: the scope of a nested `Block` can hold the binding of a parameter
  // of an enclosing literal, which a lookup by name finds there, and an
  // occurrence below it still denotes that parameter. A name that it adds
  // and that the clause ordering of the node lists (the index of a clause
  // of a held `Sum`) shadows the walk into the operands where the name is
  // in scope only (`binderBoundAt()`). Another name that it adds shadows
  // the walk into every operand: a local of a `Block` that a statement
  // makes, which the scope of the block does not always hold
  // (`bindingKeyedSubs`).
  bindsNames?: (node: Expression, names: readonly string[]) => readonly string[]
): Expression {
  if (isSymbol(expr)) return visit(expr, shadowed);

  if (!isFunction(expr) && !isDictionary(expr)) return expr;

  // A dictionary binds nothing, so the root treatment does not apply to it:
  // it is memoized under the plain shadowing key like any inner node.
  const memoKey =
    skipRootBinds && isFunction(expr) ? undefined : shadowedKey(shadowed);
  if (memoKey !== undefined) {
    const hit = memo.get(expr)?.get(memoKey);
    if (hit !== undefined) return hit;
  }

  const replacement =
    visitBinder !== undefined &&
    !skipRootBinds &&
    isFunction(expr) &&
    (!expr.isCanonical || boundVariableNames(expr).length > 0)
      ? visitBinder(expr, shadowed)
      : undefined;

  let result: Expression;
  if (replacement !== undefined && replacement !== expr) {
    result = rewriteWithBinders(
      replacement,
      visit,
      shadowed,
      false,
      memo,
      visitApplication,
      visitBinder,
      bindsNames
    );
  } else if (isDictionary(expr)) {
    // A dictionary is not a function node (`nops` 0): descend into its values
    // explicitly, or symbols inside them escape every rewrite pass.
    const ce = expr.engine;
    let changed = false;
    const entries = expr.keys.map((key) => {
      const value = expr.get(key)!;
      const next = rewriteWithBinders(
        value,
        visit,
        shadowed,
        false,
        memo,
        visitApplication,
        visitBinder,
        bindsNames
      );
      if (next !== value) changed = true;
      return ce.function('KeyValuePair', [ce.string(key), next]);
    });
    result = changed ? ce.function('Dictionary', entries) : expr;
  } else if (isFunction(expr) && expr._numericStore !== undefined) {
    // A store-backed list (`ce.list()`) holds numbers only: nothing in it
    // can be rewritten, and reading its `ops` would box every element.
    result = expr;
  } else {
    // The names this node binds shadow the walk into each operand — the
    // names IN SCOPE in that operand (`boundVariableNamesInOperand`): an
    // iterator clause's index shadows its own clause and the later ones, not
    // an earlier clause's collection or guard, where the same name denotes
    // the enclosing binding and must be rewritten as such.
    const allBinds = skipRootBinds ? NO_BINDERS : boundVariableNames(expr);
    const binds =
      bindsNames === undefined || skipRootBinds
        ? allBinds
        : bindsNames(expr, allBinds);
    // The clause ordering is read once per node, not once per operand. A
    // node that is not canonical and has no scope (held content) is read
    // in the phase that a raw tree can answer for.
    const held = !expr.isCanonical && expr.localScope === undefined;
    const binders =
      binds.length > 0
        ? declaredBinders(expr, held ? 'pre' : 'post')
        : undefined;
    const shadowedIn = (i: number): ReadonlySet<string> | undefined => {
      if (binds.length === 0) return shadowed;
      let here =
        binders === undefined
          ? binds
          : boundVariableNamesInOperand(expr, i, binders);
      // A name that `bindsNames` adds shadows every operand, except a name
      // that the clause ordering of the node lists (the index of a clause
      // of a held `Sum`): it shadows the operands where it is in scope
      // only, as a name of the scope does.
      if (here !== binds && binds !== allBinds)
        here = [
          ...here.filter((name) => binds.includes(name)),
          ...binds.filter(
            (name) =>
              !allBinds.includes(name) &&
              (!binders?.visibleFrom.has(name) ||
                binderBoundAt(binders, name, i))
          ),
        ];
      if (here.length === 0) return shadowed;
      return new Set(shadowed ? [...shadowed, ...here] : here);
    };

    const ops = expr.ops;
    const next = ops.map((op, i) => {
      // The bounds of a `Limits` clause and the collection of an `Element`
      // clause are outside the scope of the clause's own index
      // (`ownIndexClause()`, `binding-sites.ts`).
      const own = ownIndexClauseAt(expr, i, binders);
      if (own !== undefined)
        return mapOwnIndexClause(op, own, shadowed, shadowedIn(i), (o, s) =>
          rewriteWithBinders(
            o,
            visit,
            s,
            false,
            memo,
            visitApplication,
            visitBinder,
            bindsNames
          )
        );
      return rewriteWithBinders(
        op,
        visit,
        shadowedIn(i),
        false,
        memo,
        visitApplication,
        visitBinder,
        bindsNames
      );
    });
    const replaced = visitApplication?.(expr, next, shadowed);
    if (replaced !== undefined) result = replaced;
    else if (next.every((op, i) => op === ops[i])) result = expr;
    else {
      const ce = expr.engine;
      // An operand whose only errors are failed cells of a `List` or `Set`
      // literal (`isInvalidNonCollection()` is `false` for it) is a
      // collection value, and canonicalization accepts it: `Map(f, [1, err,
      // 3])` is a `Map` view, as on the direct route. Such an operand does
      // not prevent the rebuild in the node's own form below. A raw rebuild
      // would leave the node unbound, so `[1, err, 3] |> Map(f, _)` stayed an
      // inert `Map` that a loop could not iterate.
      if (!next.every((x) => x.isValid || !isInvalidNonCollection(x))) {
        // An operand that holds an `Error` node must not be canonicalized
        // again (canonicalization short-circuits on an invalid expression),
        // so the node is rebuilt without canonical transforms. A node that
        // OWNS a scope (the body `Block` of a function literal) keeps that
        // scope: it is rebuilt bound-but-not-canonical, with its scope
        // attached, because a raw rebuild carries no scope at all. Without
        // this, a literal whose body holds an error — `x ↦ (x -> x^2)`,
        // lifted from a key-value pair whose key is not a string — lost its
        // body scope here, and `makeLambda` then threw "Function body must
        // be a scoped Block expression" instead of answering the error.
        result =
          expr.localScope !== undefined
            ? ce.function(expr.operator, next, {
                form: 'structural',
                scope: expr.localScope,
              })
            : ce.function(expr.operator, next, { form: 'raw' });
      } else {
        const form = expr.isCanonical
          ? 'canonical'
          : expr.isStructural
            ? 'structural'
            : 'raw';
        result = withCallableBinding(expr, () =>
          ce.function(expr.operator, next, {
            form,
            scope: expr.localScope,
          })
        );
      }
    }
  }
  if (memoKey !== undefined) {
    let byShadowing = memo.get(expr);
    if (byShadowing === undefined) {
      byShadowing = new Map();
      memo.set(expr, byShadowing);
    }
    byShadowing.set(memoKey, result);
  }
  return result;
}

/**
 * A memo key for a set of shadowed names: the names, sorted and joined. Two
 * set objects with the same names (built on two paths through the same
 * binder structure) must key the same, and a set's key is asked once per
 * node it is carried into, so it is cached on the set.
 */
const SHADOWED_KEYS = new WeakMap<ReadonlySet<string>, string>();
export function shadowedKey(shadowed: ReadonlySet<string> | undefined): string {
  if (shadowed === undefined || shadowed.size === 0) return '';
  let key = SHADOWED_KEYS.get(shadowed);
  if (key === undefined) {
    key = [...shadowed].sort().join('\0');
    SHADOWED_KEYS.set(shadowed, key);
  }
  return key;
}

/**
 * Re-point occurrences of some names at the bindings a binder owns for them —
 * the ONE implementation of *"rebind these names to this scope's bindings"*.
 *
 * Two callers had drifted copies of this walk: step 6 of the binder
 * mechanism's post-phase (`bindBindingSites`, `box.ts`), which rebinds a
 * declared binder's variables inside the node's other operands, and a
 * `Function` literal's parameter repair (`rebindParameters`,
 * `function-utils.ts`), which does the same for the one binder that is not
 * definition-driven. They exist for the same reason — canonicalizing an
 * already-canonical body is a no-op, so a body built BEFORE the binder existed
 * keeps the bindings it was built with, and its occurrences of the bound
 * variable go on denoting the enclosing scope's variable of the same name.
 *
 * `scope` is the AUTHORITY for "is this occurrence already the binder's
 * variable"; `replacements` supplies the symbol to re-point it at otherwise,
 * which the caller must have resolved inside `scope`. The two are separate on
 * purpose: `ce.symbol(name)` does not always come back carrying the scope's
 * binding — a parameter named after a library constant (`Function(Pi + 1, Pi)`)
 * resolves to the CONSTANT — so comparing the occurrence against the resolved
 * symbol rather than against the scope would rewrite a correctly-bound
 * occurrence into the constant. Four rules, and they are the whole contract:
 *
 * - An occurrence shadowed by a binder INSIDE `expr` belongs to that binder.
 * - An occurrence carrying NO binding is left alone — the equality contract's
 *   raw-operand rule: it already denotes the enclosing binder, and it is also
 *   how a BINDING SITE reaches here (a lazy operator holds its operands raw,
 *   and `Declare` deliberately keeps its first operand un-canonicalized so the
 *   about-to-be-declared name is not turned into a reference to an outer
 *   definition — `Declare`'s `sym(ops[0].evaluate())` would then read the
 *   symbol's VALUE and the declaration would silently vanish). A free name
 *   (a canonical symbol with no definition, `isFreeName()`) is not such an
 *   occurrence: it is re-pointed like a bound occurrence.
 * - An occurrence already on `scope`'s binding for the name is returned
 *   unchanged, so an already-correct body is preserved by identity.
 * - A qualified name, the canonical form of `["Module", name]` made where a
 *   local definition shadows the name (`isQualifiedName()`,
 *   `library-shadowing.ts`), is returned unchanged: it names the library
 *   definition on purpose.
 * - Everything else is re-pointed at `replacements`.
 *
 * `accept` restricts a name to part of the tree — the clause ordering of
 * `BindingSite.clauseLocal`, where an earlier clause's collection legitimately
 * denotes the ENCLOSING binding. `skipRootBinds` ignores what the ROOT itself
 * binds, for a caller whose whole purpose is to rewrite occurrences of the
 * root's own bound variables (the body `Block` of a `Function` literal).
 * With `calls`, a canonical application whose operator is a name of
 * `replacements` is boxed again in the current scope, which must be `scope`,
 * so that its operator is bound to the definition of that name in `scope`.
 */
export function rebindToBindings(
  expr: Expression,
  scope: Scope,
  replacements: ReadonlyMap<string, Expression>,
  options?: {
    skipRootBinds?: boolean;
    accept?: (name: string) => boolean;
    calls?: boolean;
  }
): Expression {
  if (replacements.size === 0) return expr;
  return rewriteWithBinders(
    expr,
    (sym, shadowed) => {
      const name = sym.symbol;
      if (shadowed?.has(name)) return sym;
      const target = replacements.get(name);
      if (target === undefined) return sym;
      if (options?.accept?.(name) === false) return sym;
      const def = sym.valueDefinition;
      // A free name (`isFreeName()`, `binding-unit.ts`) has no binding, but
      // it is not a raw occurrence: it is an occurrence of the name in the
      // body, boxed before the binder existed, so it is re-pointed at the
      // binder's variable.
      if (def === undefined && !isFreeName(sym)) return sym;
      // Inline value-def check (`isValueDef` lives in `utils.ts`, which
      // imports this module).
      const own = scope.bindings.get(name);
      if (own !== undefined && 'value' in own && own.value === def) return sym;
      if (isQualifiedName(sym)) return sym;
      return target;
    },
    undefined,
    options?.skipRootBinds ?? false,
    new Map(),
    options?.calls
      ? (app, ops, shadowed) => {
          const name = app.operator;
          if (
            !app.isCanonical ||
            !replacements.has(name) ||
            shadowed?.has(name) ||
            options.accept?.(name) === false
          )
            return undefined;
          return app.engine.function(name, [...ops], {
            scope: app.localScope,
          });
        }
      : undefined
  );
}

/**
 * Evaluate `value` in the environment its OWN free symbols denote — the
 * dereference half of the name-vs-binder repair
 * (`docs/SCOPING-MODEL.md`).
 *
 * Two things were wrong with returning the stored value verbatim:
 *
 * - **Staleness** ("one-evaluate-late"): `let d = 3x^2 + 1; let x = 2; d` gave
 *   `3x^2 + 1`, while `N(d)` and `compile()` both said `13`. Plain `evaluate()`
 *   was the outlier.
 * - Simply evaluating it instead — the naive fix, measured in §Appendix B of the
 *   design doc — resolves those free symbols by NAME in whatever context the
 *   dereference happens to occur, so a call frame's parameter or a block-local
 *   `let` captures them: `let a = x + 1; f(y) = do { let x = 99; a + y }; f(5)`
 *   became `105`.
 *
 * Both fall out of asking the right question. A free symbol inside a stored
 * value is not a name to be looked up again: it already carries the binding it
 * was canonicalized against, and that binding is the environment the value must
 * be evaluated in. So such an occurrence is bound to ITS OWN definition for the
 * duration of the evaluation, shadowing whatever the ambient context calls the
 * same name. The value then resolves what it genuinely refers to (`x = 2` → 13,
 * a global `x = 100` → 101) and stays symbolic for what it does not (an unbound
 * `x` stays `x`, whatever a frame names its parameter).
 *
 * One restriction keeps this confined to dereference, measured:
 *
 * - **The occurrence's definition must be reachable** in the current chain —
 *   it refuses to re-point a free symbol at a definition that is not in the
 *   chain AT ALL, i.e. one belonging to an already-popped scope. Generalizing
 *   to "an occurrence always means its own binding" contradicts both
 *   beta-reduction and the cached-expression re-binding contract (CONTRACT 4,
 *   `pipeline-contracts.test.ts`) — measured at 100+ failures.
 *
 *   "Reachable" is `sameBindingDef`, not identity: a call frame holds the
 *   body's own definition of a parameter (`holdBodyLocals()` in
 *   `function-utils.ts`), or a fresh definition that is an ACTIVATION of it,
 *   so the walk finds a body occurrence.
 *
 * (The value-definition checks are inlined rather than using `isValueDef`:
 * `utils.ts` imports this module, so this module cannot import it back.)
 *
 * Recursion is bounded by the caller's cycle guard — see
 * `BoxedSymbol._dereference`, which aborts the whole chain rather than the
 * re-entered step.
 */
/**
 * How many times `evaluateInOwnBindings` has re-pointed a stored value's free
 * symbol to its own binding past an ordinary shadow, since the module loaded.
 *
 * A memo of a stored value's evaluation validates its entry by re-resolving
 * the value's free names through the AMBIENT chain (the element memo's
 * dependency snapshot, `collection-element-memo.ts`), and that chain is
 * exactly what the re-pointing bypasses: an entry computed under a shadow
 * would be validated against the shadow's binding and never see a write to
 * the own binding it actually read. The memo compares this count before and
 * after the evaluation and does not store when it moved.
 */
let _ownBindingRewrites = 0;
export function ownBindingRewriteCount(): number {
  return _ownBindingRewrites;
}

export function evaluateInOwnBindings(
  ce: ComputeEngine,
  value: Expression,
  options?: { numericApproximation?: boolean }
): Expression {
  const evaluated = (): Expression =>
    options?.numericApproximation ? value.N() : value.evaluate(options);

  // Fast path: a number literal cannot contain a symbol, so there is nothing to
  // protect. Keeps the hot path (loop counters, numeric arguments, `x = 2`) off
  // the walk entirely.
  //
  // Deliberately NOT gated on `value.symbols.length === 0`, which looks cheaper
  // and is unsound: `symbols` descends through function nodes only, so a stored
  // DICTIONARY reports no symbols while its values are full of them. That gate
  // sent `a = {k: x + 1}` down the fast path, and evaluating it inside a frame
  // whose parameter is also `x` produced `{k: 6}` — the very capture this helper
  // exists to prevent. `rewriteWithBinders` does descend into dictionary values.
  if (isNumber(value)) return evaluated();

  // Written-out data (a list of numbers, a list of points) holds numbers
  // only, so it has no symbol to protect either. The walk below visited every
  // element of such a list at every use of the symbol that holds it: 13% of
  // `(2 − 2·PointZ(C)).N()` for a `C` of ten thousand points. Whether a node
  // is written-out data is computed once per node (`_isLiteralData`), and a
  // dictionary is never one, so the unsound shortcut described above is not
  // taken here.
  if (isFunction(value) && value._isLiteralData()) return evaluated();

  const env = ownBindingEnvironment(ce, value);
  if (env === undefined) return evaluated();

  // A re-pointing is about to happen: the value reads a binding the ambient
  // chain does not resolve to. The stored-value memo of `BoxedSymbol` reads
  // this count to keep such an evaluation out of its cache (see
  // `ownBindingRewriteCount`).
  _ownBindingRewrites += 1;
  // The entries carry the occurrences' OWN value definitions, so the value
  // resolves the very bindings it references — and an assignment performed
  // during the evaluation reaches the real definition.
  const borrowed = [...env];
  ce.pushScope({ parent: ce.context.lexicalScope, bindings: env });
  storedValueScopes.add(ce.context.lexicalScope);
  try {
    return evaluated();
  } finally {
    // Hand the borrowed definitions back BEFORE popping. Popping a scope
    // disposes every value definition among its bindings (`discardEvalContext`,
    // `engine-scope.ts`) — which is right for definitions the scope owns, and
    // wrong for these: they belong to the caller's scopes, and disposing one
    // bumps its write version and permanently unsubscribes it from
    // configuration changes, leaving a dynamic constant stale after a
    // precision change.
    //
    // Only entries still identical to what was injected are withdrawn, so a
    // definition genuinely created inside this scope — or one that REPLACED a
    // borrowed entry — is left for normal disposal.
    for (const [name, def] of borrowed)
      if (env.get(name) === def) env.delete(name);
    ce.popScope();
  }
}

/**
 * The debug check of dead bindings (`ce._debugBindings`) at a resolution
 * site: throw if a read of `name` through `def`, the definition that the
 * occurrence was bound to at canonicalization, uses a binding of a
 * discarded scope.
 *
 * When `def` carries a tombstone, the read can still be live: the context
 * can hold another definition of the same binding (`sameBindingDef`, found
 * by `bindingInContext`), or a definition in an activation of the scope that
 * holds `def` (`activationBindingOf()`), and that definition is the one
 * checked. A binding found in the context that does not stand for `def` (a
 * definition of the same name in an enclosing scope) is not used, and `def`
 * is checked.
 */
export function assertLiveRead(
  ce: ComputeEngine,
  def: BoxedValueDefinition,
  name: string
): void {
  if (!isTombstoned(def)) return;
  const found = bindingInContext(ce, name, def);
  const live = found !== undefined && 'value' in found ? found.value : def;
  if (live !== def && sameBindingDef(live, def)) {
    assertLiveBinding(live, name);
    return;
  }
  const activated = activationBindingOf(ce, name, def);
  assertLiveBinding(activated ?? def, name);
}

/**
 * The value definition of `name` in the innermost scope of the context that
 * has a binding of `name`, when that scope is an activation of the scope
 * that holds `def` under `name`. A definition that the evaluation
 * installs in the activation (a `Declare` in a `Block` makes a new one)
 * is not a copy of `def`, but the read goes through the activation.
 * `undefined` otherwise.
 */
function activationBindingOf(
  ce: ComputeEngine,
  name: string,
  def: BoxedValueDefinition
): BoxedValueDefinition | undefined {
  let scope: Scope | null | undefined = ce.context?.lexicalScope;
  while (scope) {
    const found = scope.bindings.get(name);
    if (found !== undefined) {
      // Inline value-definition checks: importing `isValueDef` from
      // `utils.ts` would restore the import cycle that this module breaks.
      if (!('value' in found)) return undefined;
      const held = scopeActivationTemplate(scope)?.bindings.get(name);
      return held !== undefined && 'value' in held && held.value === def
        ? found.value
        : undefined;
    }
    scope = scope.parent;
  }
  return undefined;
}

/**
 * The bindings that the evaluation of the stored value `value` borrows
 * (`evaluateInOwnBindings()`), or `undefined` when it needs none. An empty
 * map when it borrows none, but a free name of `value` must not read the
 * local of a block that the read by name finds (`storedValueFreeNameRead()`):
 * the scope pushed for the evaluation then stops that read
 * (`freeNameBindingAndScope()`).
 */
function ownBindingEnvironment(
  ce: ComputeEngine,
  value: Expression
): Map<string, BoxedDefinition> | undefined {
  let env: Map<string, BoxedDefinition> | undefined;
  let hidesLocal = false;
  rewriteWithBinders(value, (sym, shadowed) => {
    const name = sym.symbol;
    // An occurrence bound by a binder INSIDE the value (a stored lambda's own
    // parameter, a `Sum` index) is not free: it is not ours to re-point.
    if (shadowed?.has(name)) return sym;
    if (env?.has(name)) return sym;
    // A free name (`isFreeName()`): the definition that it resolves to,
    // past the local of a block that it was not in when it was boxed
    // (`storedValueFreeNameRead()`).
    let own = sym.valueDefinition;
    if (isFreeName(sym)) {
      const read = storedValueFreeNameRead(ce, sym);
      own = read.def;
      if (read.hidesLocal) hidesLocal = true;
    }
    if (own === undefined) return sym;
    // Debug invariant (§3 of the binder-mechanism design). This site also pins
    // the withdrawal below: were a borrowed definition ever left behind for the
    // pop to dispose, the caller's next use of that symbol would report it here
    // instead of silently going stale.
    if (ce._debugBindings) assertLiveRead(ce, own, name);
    let scope: Scope | null = ce.context.lexicalScope;
    let innermost: BoxedDefinition | undefined;
    let reachable = false;
    while (scope) {
      const found = scope.bindings.get(name);
      if (found !== undefined) {
        innermost ??= found;
        if ('value' in found && sameBindingDef(found.value, own)) {
          reachable = true;
          break;
        }
      }
      scope = scope.parent;
    }
    if (!reachable || innermost === undefined) return sym;
    // Already the innermost binding: the ambient lookup answers correctly on
    // its own.
    if ('value' in innermost && sameBindingDef(innermost.value, own))
      return sym;
    // An operator definition is not ours to shadow with a value binding.
    if (!('value' in innermost)) return sym;
    (env ??= new Map()).set(name, {
      value: own,
    } satisfies TaggedValueDefinition);
    return sym;
  });

  return env ?? (hidesLocal ? new Map() : undefined);
}

/**
 * For the free name `sym` (`isFreeName()`) of a stored value: `def`, the
 * value definition that it reads (`freeNameBindingInContext()` with
 * `outsideBlocks`), and `hidesLocal`, true when that read skips a local of a
 * `Block` that a read by name would find.
 */
function storedValueFreeNameRead(
  ce: ComputeEngine,
  sym: Expression & { symbol: string }
): { def: BoxedValueDefinition | undefined; hidesLocal: boolean } {
  const home = (sym as { _homeScope?: Scope })._homeScope;
  const found = freeNameBindingInContext(
    ce,
    sym.symbol,
    undefined,
    false,
    home,
    true
  );
  const byName = freeNameBindingInContext(ce, sym.symbol);
  return {
    def: found !== undefined && 'value' in found ? found.value : undefined,
    hidesLocal: byName !== found,
  };
}

/** Await a stored expression while protecting the free bindings it denotes.
 * The borrowed frame belongs to a private context stack and is removed only
 * after the value settles; borrowed definitions are never disposed. */
export async function evaluateInOwnBindingsAsync(
  ce: ComputeEngine,
  value: Expression,
  options?: Partial<EvaluateOptions>
): Promise<Expression> {
  const contextStack = copyContextStack(
    options?._contextStack ?? ce._evalContextStack
  );
  const carried = { ...options, _contextStack: contextStack };
  const inContext = <T>(fn: () => T): T =>
    ce.withEvaluationContext(carried, fn);
  const env = inContext(() =>
    isNumber(value) || (isFunction(value) && value._isLiteralData())
      ? undefined
      : ownBindingEnvironment(ce, value)
  );
  if (env === undefined) return value.evaluateAsync(carried);
  const borrowed = [...env];
  inContext(() => {
    _ownBindingRewrites += 1;
    ce.pushScope({ parent: ce.context.lexicalScope, bindings: env });
    storedValueScopes.add(ce.context.lexicalScope);
  });
  try {
    return await value.evaluateAsync(carried);
  } finally {
    inContext(() => {
      for (const [name, def] of borrowed)
        if (env.get(name) === def) env.delete(name);
      ce.popScope();
    });
  }
}
