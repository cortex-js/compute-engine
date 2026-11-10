import { scopeActivationTemplate } from './ambient-chain.js';
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
import { isFunction, isSymbol, isDictionary, isNumber } from './type-guards.js';
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
import { chainedScopeOf } from '../scope-chaining.js';
import { isPendingCallScope } from '../pending-call-scopes.js';
import { isQualifiedName } from '../library-shadowing.js';
import {
  inStaticTypingView,
  noteCallFrame,
  noteParameterReadByName,
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
 * The activation-record link, as carried by `_BoxedValueDefinition`.
 *
 * Written structurally (rather than as a field of the public
 * `BoxedValueDefinition` interface) for the same reason as the debug
 * tombstone: it is an internal detail of the binder machinery, not part of the
 * definition contract.
 */
type Activated = {
  _activationOf?: BoxedValueDefinition;
  _scopeActivationOf?: BoxedValueDefinition;
};

/**
 * Record that `activation` — the per-call definition a `Function` literal's
 * call frame declares for a parameter — is an ACTIVATION of `staticBinding`,
 * the binding the literal's body `Block` declares for that same parameter
 * (`docs/SCOPING-MODEL.md`).
 *
 * A binder with several simultaneous activations (recursion) produces N
 * definitions all pointing at ONE static binding. They are deliberately
 * indistinguishable: `sameBinding` already compares an occurrence enclosed by
 * its binder by NAME, so distinguishing activations would only change the
 * answer for an occurrence that has ESCAPED its frame — and an escaped
 * occurrence must be re-bound (`rebindEscaping`), not distinguished.
 */
export function markActivation(
  activation: BoxedValueDefinition,
  staticBinding: BoxedValueDefinition
): void {
  (activation as Activated)._activationOf = staticBinding;
}

/**
 * Whether `def` is the definition that a call frame declares for a parameter
 * of a `Function` literal (`markActivation`). A `let` local of the body, a
 * binder index and a top-level symbol are not.
 */
export function isParameterActivation(def: BoxedValueDefinition): boolean {
  return (def as Activated)._activationOf !== undefined;
}

/**
 * The static binding `def` denotes: itself, or — for a call frame's parameter
 * definition — the literal's own binding for that parameter.
 *
 * ONE hop, non-recursive: an activation's target is always a static binding
 * (a body `Block`'s canonicalization-time declaration), never another
 * activation.
 */
function staticBindingOf(def: BoxedBaseDefinition): BoxedBaseDefinition {
  const activated = def as Activated;
  return activated._activationOf ?? activated._scopeActivationOf ?? def;
}

/**
 * Do two definitions denote the same binding — identically, or because one is
 * an ACTIVATION of the other (or both activate the same binder)?
 *
 * The newly-equal pairs are exactly (static binding, its activation) and
 * (activation, activation of the same binder). A stored value's free `x` (a
 * global definition) and a frame's `x` stay unequal: neither activates the
 * other. Names are still compared separately everywhere — this does not make
 * equality rename-invariant.
 */
export function sameBindingDef(
  a: BoxedBaseDefinition | undefined,
  b: BoxedBaseDefinition | undefined
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return staticBindingOf(a) === staticBindingOf(b);
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
  // The scope holds only the borrowed binding. A name that the build
  // declares automatically (a new symbol of a raw operand) goes to the
  // enclosing scope: a declaration in this scope would be lost when the
  // scope is popped.
  ce.pushScope({
    parent: ce.context.lexicalScope,
    bindings,
    noAutoDeclare: true,
  });
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
  const activated = half as Activated;
  const isActivation =
    activated._activationOf !== undefined ||
    activated._scopeActivationOf !== undefined;
  const home = isActivation ? undefined : callableHomes.get(half);
  const start = ce.context.lexicalScope;
  // Inside a type computation, the static view of the bindings
  // (`static-typing-view.ts`): a call frame does not answer.
  for (let scope: Scope | null = start; scope; scope = staticParentOf(scope)) {
    const found = staticBindingIn(scope, name, scope === start);
    if (found === undefined) continue;
    const candidate = 'value' in found ? found.value : found.operator;
    if (
      candidate === half ||
      (!isActivation && sameBindingDef(candidate, half)) ||
      (home !== undefined && scopeStandsFor(scope, home))
    ) {
      if (!('value' in found) || !isForwardCallReference(found.value))
        return found;
      break;
    }
  }
  // Forward calls wait for a definition in their original lexical chain.
  // A type/evaluation read never binds them to an unrelated caller's scope.
  // The walk follows the link each scope was created with: while a node that
  // owns the scope (a `Block`, the body of an integrand) is evaluated, the
  // scope is chained onto the ambient scope (`scope-chaining.ts`), and a
  // declaration of the same name in a scope pushed later would capture the
  // call. With `∫₀¹ g(x) dx` made before `g(t) := t`, a scope that declares
  // `g := t ↦ 100` made the integral 100, not 1/2.
  if ('value' in own) {
    for (
      let scope = forwardCallScope(own.value);
      scope;
      scope = creationParentOf(scope)
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

/** The parent link `scope` was created with. A live evaluation frame can
 * re-point the link onto the ambient scope; the registry of chained scopes
 * keeps the link the scope had before (`chainedScopeOf`,
 * `scope-chaining.ts`). */
function creationParentOf(scope: Scope): Scope | undefined {
  const chained = chainedScopeOf(scope);
  const parent = (chained !== undefined ? chained.parent : scope.parent) as
    Scope | null | undefined;
  return parent ?? undefined;
}

/**
 * The value definition a symbol OCCURRENCE reads its value from in the
 * current runtime context. The scope chain is walked for the innermost
 * binding of `name`, as a name lookup would — with BINDER bindings of a
 * binding OTHER than `own` skipped. `own` is the definition the occurrence
 * is bound to, and `sameBindingDef` recognizes an activation of `own`
 * itself. A binder binding is one of two things: a call frame's parameter
 * activation (`markActivation`), or a name a binder operator declares in its
 * own scope — a `Sum` or `Product` index, a comprehension or loop index, a
 * `D` variable (`markBinderVariable`, written by `bindBindingSites` in
 * `box.ts`). Such a binding belongs to another expression's variable that
 * merely shares the name, and reading its value through this occurrence is a
 * capture.
 *
 * Ruled 2026-09-21: a binder of the CALLER never intercepts a read of a
 * global inside the body of the function it calls, whether or not the global
 * holds a value. With `w` declared and valueless and `W := x ↦ [w x, x]`,
 * `[W(w)[1] for w in [1, 2, 3]]` answers `[w, 2w, 3w]` — exactly what the
 * spelling `[W(k)[1] for k in [1, 2, 3]]` answers — where a by-name reading
 * of the comprehension index gave `[1, 4, 9]`. The same decision removes the
 * capture of a stored value's free name: with `a := n + 1`,
 * `Sum(a, n, 1, 3)` is `3n + 3`, not `9`. Before this date the binder case
 * was restricted to the parameter activation and every other binder read by
 * name, as a compatibility hatch.
 *
 * Why only binder bindings, and not every same-named binding: a declaration
 * made in a scope pushed after the occurrence was bound is ALSO a different
 * binding, but re-pointing earlier-boxed expressions that way is relied
 * upon — a document manager re-pushes a saved, populated scope around
 * evaluations and expects the expressions to read it (the lazy-collection
 * memo stamps the ambient scope for exactly this; see "a memoized view
 * re-resolves inside a re-pushed populated scope" in
 * `test/compute-engine/lazy-collection-regimes.test.ts`). That is the
 * compatibility reading `docs/SCOPING-MODEL.md` §"Symbol identity" allows,
 * and it stays. A shield (`markShieldDeclaration`) intercepts for the same
 * reason every ordinary declaration does — including a shield that sits on a
 * binder's own name, which is how `D`, `Integrate`, `Limit` and `Solve` hide
 * an assigned value of their variable.
 *
 * Why the parameter case must be skipped: a call frame captures whenever an
 * expression bound OUTSIDE it is evaluated INSIDE it. With `G(x) := cos(x)`
 * applied as `G(3x)`, the frame binds its parameter `x` to `3x`, whose `x` is
 * the caller's. Dereferencing the parameter answers `3x`, correctly, through
 * `evaluateInOwnBindings`; but the `Cos` handler then evaluates that `3x`
 * once more inside the frame, and by-name resolution read the caller's `x`
 * as the parameter again — `9x`, then `27x` on the next re-evaluation.
 * Every re-evaluation substituted the parameter's value into itself once
 * more, so it terminated only because handlers re-evaluate a bounded number
 * of times, answered wrong where a handler used the re-evaluation
 * (`f(x) := Σ_{k=1}^{3} x·k` gave `f(2x) = 24x`), and did not terminate at
 * all once the parameter's value contained an application that re-evaluates
 * its operand: `f(f(x))` for `f(x) := cos x`, and a twice-recursive
 * `R(i,x,y)` with free `x`, `y` at depth 3, overflowed the stack. Skipping
 * the foreign activation makes a second evaluation of an evaluated value a
 * fixed point again.
 *
 * A call frame is the one place where the chain does not reach a scope that
 * is still live: its parent is the scope that DEFINED the function, not the
 * scope of the caller (`callerBinding` below). An argument is evaluated, and
 * its symbols are bound, in the caller's scope; the frame then holds that
 * value as the value of a parameter, and the body reads it in the frame.
 * When `own` is not in the chain but is in the chain of the caller of a call
 * frame on the evaluation stack, `own` answers, whatever binding of the same
 * name the chain holds. Without this, with `c := 5` global, `c` declared
 * real (and valueless) in a pushed scope, and `g := a ↦ a·x` defined
 * globally, `g(c)` read the global `c` and gave `5x`, and with `i` declared
 * real in a pushed scope `g(i)` gave `ImaginaryUnit·x`. (Tycho ledger row
 * 403, 2026-10-19.)
 *
 * A run of a `Block` removes `own` from the scope of the block and makes a
 * new local for each `Declare` statement, so an occurrence boxed in the block
 * is bound to a definition that no scope holds. Inside a call frame, such an
 * occurrence reads its name in the chain of the caller that holds the block
 * (`sweptCallerBinding` below).
 *
 * When `own` is reachable from nowhere otherwise (an occurrence bound in a
 * scope that has since been popped, or an unbound one), the innermost binding
 * by name answers, foreign activation included — what the name lookup
 * answered before.
 *
 * One exception: inside a type computation, a parameter of a function literal
 * that is reachable from nowhere has no binding. The type of a literal is read
 * after the scope of its body was left, and the parameter has a value only
 * in a call. A binding of the same name is another variable: with
 * `n := [1, 2]`, the operand `n` of `n ↦ n + 1` does not hold a list, so the
 * literal is typed `(n) -> number`, not `(n) -> list<number>`.
 *
 * A local of a block (a `Declare` statement or a first assignment) has the
 * same exception: the type of a block is read after the scope of the block
 * was left, and the local has a value only in a run of the block. With
 * `n := [1, 2]`, the operand `n` of `Block(Declare(n, "real", 2), n + 1)`
 * does not hold a list, so the block is typed `real`, not `list<real>`. The
 * binding that a run of the block made for the local is the same variable,
 * and a type computation in the run reads it
 * (`isOutsideBindingOfBlockLocal()`). In a call of a function literal whose
 * body is the block, a type computation reads the binding that the
 * canonicalization made, which has no value (`staticBindingIn()`,
 * `static-typing-view.ts`).
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
  // A definition that a checkpoint restore marked `_rewound` (created in the
  // rewound window, in a scope that survived the restore) has no binding.
  // Without this test, the walk below would find a later definition of the
  // same name, and a symbol bound to the disposed definition would read
  // that value (and count as bound in `unknowns`, and be inlined by a
  // compile) while its type and flags stay those of its own record. Such a
  // symbol stays inert: rebuild the expression to read the new definition.
  // A definition that `popScope()` disposed, or that was installed in a
  // scope created in the window (a `Sum` index, a `Block` local), is not
  // marked and still resolves by name. (ROADMAP CE-586, user decision
  // 2026-10-28.)
  if (own !== undefined && (own as { _rewound?: true })._rewound)
    return undefined;
  const start = scope;
  let skippedBinder: BoxedDefinition | undefined;
  while (scope) {
    // Inside a type computation, the static view of the bindings
    // (`static-typing-view.ts`): a call frame does not answer.
    const found = staticBindingIn(scope, name, scope === start);
    if (found !== undefined) {
      if ('value' in found && isForeignBinderBinding(found.value, own)) {
        skippedBinder ??= found;
      } else if (
        'value' in found &&
        isOutsideBindingOfBinderVariable(ce, scope, found.value, own)
      ) {
        // Skip this binding: it is not the variable of the binder.
      } else {
        if (
          own === undefined ||
          sameBindingDef('value' in found ? found.value : found.operator, own)
        )
          return found;
        // The local of this run of the block (or of the call of the body)
        // that the occurrence was written in: no caller reads it in its place.
        const home = sweptHomeOf(own);
        if (home !== undefined && scopeStandsFor(scope, home)) return found;
        const caller = callerBinding(
          ce,
          name,
          own,
          start,
          staticParentOf(scope)
        );
        if (caller !== undefined) return caller;
        const other = sweptHomeBinding(name, own, scope, found);
        return readsNoOtherBinding(ce, name, own, other, start)
          ? undefined
          : other;
      }
    }
    scope = staticParentOf(scope);
  }
  if (own !== undefined) {
    const caller = callerBinding(ce, name, own, start, null);
    if (caller !== undefined) return caller;
    return skippedBinder !== undefined &&
      readsNoOtherBinding(ce, name, own, skippedBinder, start)
      ? undefined
      : skippedBinder;
  }
  return skippedBinder;
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
 */
export function freeNameBindingInContext(
  ce: ComputeEngine,
  name: string,
  scope: Scope | null = ce.context.lexicalScope
): BoxedDefinition | undefined {
  const start = scope;
  while (scope) {
    const found = staticBindingIn(scope, name, scope === start);
    if (
      found !== undefined &&
      !(
        'value' in found &&
        (isBinderVariable(found.value) ||
          isFunctionLiteralParameter(found.value) ||
          isActivation(found.value))
      )
    )
      return found;
    scope = staticParentOf(scope);
  }
  return undefined;
}

/**
 * True when an occurrence of `name` bound to `own`, about to read `other`, a
 * binding of the same name that is not its own, reads no binding: a type
 * computation reads a parameter of a function literal, or a local of a block
 * in a binding that is not a local of that block. See the exceptions in the
 * comment of `valueDefinitionInContext()`. `start` is the scope where the
 * walk of `bindingInContext()` started.
 *
 * Any other read of such a parameter or local keeps the read by name. When
 * `other` holds a value, it gives another answer than the type computation,
 * so it is recorded, and the caches keep the two answers under different keys
 * from now on (`noteParameterReadByName()`). A binding with no value answers
 * as the type computation does, and a later assignment to it moves the keys
 * of the caches, so the next read comes back here.
 *
 * The record is for the life of the engine, and it costs cache hits in every
 * later type computation. A program reaches it when a function literal that
 * reads a local of its block is called after the run of the block ended, and
 * a binding of the same name outside the block holds a value: with `x := 5`,
 * a call of the result of `Block(Declare(x, "real", 2), y ↦ x + y)`.
 */
function readsNoOtherBinding(
  ce: ComputeEngine,
  name: string,
  own: BoxedBaseDefinition,
  other: BoxedDefinition,
  start: Scope | null
): boolean {
  const inView = inStaticTypingView(ce);
  // Outside a type computation, only a binding with a value is recorded:
  // answer before the walk of the chain in `isOutsideBindingOfBlockLocal()`.
  if (!inView && !('value' in other && other.value.value !== undefined))
    return false;
  if (
    !isFunctionLiteralParameter(own) &&
    !isOutsideBindingOfBlockLocal(name, own, other, start)
  )
    return false;
  if (inView) return true;
  noteParameterReadByName(ce);
  return false;
}

/**
 * True when `own` is a local of a block (`_blockLocal`: the binding that the
 * canonicalization of the block made for a `Declare` statement or for a
 * first assignment), and `other`, a binding of the name `name`, is not a
 * local of that block: it is another variable with the same name, for
 * example a global.
 *
 * A run of the block removes `own` from the scope of the block and makes a
 * new binding for the local (`sweepCanonicalizationBindings()`,
 * `library/control-structures.ts`; `createBlockLocals()` and
 * `declareAssignmentLocals()`, `function-utils.ts`): in the scope of the
 * block, or, when the block is the body of a function literal, in the call
 * frame, which is a runtime copy of that scope. That binding is the same
 * variable. So `other` is a local of the block when a scope of the chain
 * that starts at `start` is the scope of the block, or a runtime copy of it
 * (`scopeStandsFor()`), and holds `other` for `name`.
 *
 * The scope of the block is the scope where the canonicalization declared
 * the local (`markCallableHome()`), and the scope that a run removed it from
 * (`markSweptBinding()`); a scope of the chain that stands for one of the
 * two counts. A local for which neither is recorded gives `false`: it keeps
 * the read by name.
 *
 * `other` can also be the record of `own` that the run kept
 * (`_sweptRecord`, which `sweptHomeBinding()` answers when no binding of the
 * name is left): it is the local itself, with no value, not another variable.
 */
function isOutsideBindingOfBlockLocal(
  name: string,
  own: BoxedBaseDefinition,
  other: BoxedDefinition,
  start: Scope | null
): boolean {
  const local = staticBindingOf(own);
  if ((local as { _blockLocal?: boolean })._blockLocal !== true) return false;
  if ('value' in other && sameBindingDef(other.value, own)) return false;
  const declaredIn = callableHomes.get(local);
  const sweptFrom = (local as Swept)._sweptHome;
  if (declaredIn === undefined && sweptFrom === undefined) return false;
  for (let scope = start; scope; scope = staticParentOf(scope)) {
    if (
      !(declaredIn !== undefined && scopeStandsFor(scope, declaredIn)) &&
      !(sweptFrom !== undefined && scopeStandsFor(scope, sweptFrom))
    )
      continue;
    if (staticBindingIn(scope, name, scope === start) === other) return false;
  }
  return true;
}

/**
 * The binding of `own` in the scope of a caller, when the occurrence bound
 * to `own` is read inside a call frame that cannot see that scope, or
 * `undefined`.
 *
 * The evaluation stack holds one context named `call` for each user-function
 * application in progress (`makeLambda`, `function-utils.ts`). The scope of
 * that context is the call frame, whose parent is the scope that defined the
 * function, and the context just below it is the context of the caller. An
 * argument is evaluated in the caller's context, so its symbols are bound to
 * the caller's definitions, and the frame keeps the evaluated argument as
 * the value of a parameter. When the body reads the parameter, the argument
 * is read inside the frame, where the walk of `bindingInContext` follows the
 * definition scope and never reaches the caller's scope. If the definition
 * scope has a binding of the same name, that walk reads it: a symbol that
 * the caller declared without a value in an inner scope then reads the value
 * of an outer definition of its name.
 *
 * This answers the binding `own` has in the chain of the caller of any call
 * frame on the stack (a nested call reaches the caller of an outer call:
 * `f` can pass its argument on to `g`). Four conditions keep it narrow:
 *
 * - `own` is not a binder's variable (`markBinderVariable`). An index reads
 *   by name (see `isForeignBinderBinding`), and a `bind` parameter of a
 *   `hold` function relies on it: in `mySum(k^2, k, 3)` with `mySum(body,
 *   bind i, n) = Sum(body, (i, 1, n))`, the `k` of the held `k^2` is the
 *   call node's index, and the `Sum` of the body must read it as its own
 *   index (`test/epsil/hold-functions.test.ts`).
 * - The walk started at the current scope (`start`). A consumer that walks
 *   from another scope (`bindLazyArgumentLocals` asks what the callee would
 *   find) gets the plain walk.
 * - `own` is not further up the current chain (`rest`, the part of the chain
 *   after the binding that was found). There, a newer declaration of the
 *   same name hides `own` on purpose: a document manager pushes a populated
 *   scope again around an evaluation, and an expression boxed earlier must
 *   read the new declaration (see `docs/SCOPING-MODEL.md`, "Symbol
 *   identity").
 * - A scope that has been popped is in no chain of the stack, so an
 *   occurrence bound there still reads by name.
 */
function callerBinding(
  ce: ComputeEngine,
  name: string,
  own: BoxedBaseDefinition,
  start: Scope | null,
  rest: Scope | null
): BoxedDefinition | undefined {
  if (start !== ce.context?.lexicalScope || isBinderVariable(own))
    return undefined;
  const stack = ce._evalContextStack;
  // Most reads happen outside any call frame: nothing to do then.
  let hasCall = false;
  for (let i = stack.length - 1; i > 0; i--)
    if (stack[i].name === 'call') {
      hasCall = true;
      break;
    }
  if (!hasCall) return undefined;
  if (ownBindingInChain(name, own, rest, false) !== undefined) return undefined;
  for (let i = stack.length - 1; i > 0; i--) {
    if (stack[i].name !== 'call') continue;
    const found = ownBindingInChain(name, own, stack[i - 1].lexicalScope, true);
    if (found !== undefined) return found;
  }
  return sweptCallerBinding(name, own, start, stack);
}

/**
 * The fields of a value definition that `markSweptBinding` sets (declared on
 * `_BoxedValueDefinition`): `_sweptHome`, the scope of the block or of the
 * body (the template of a runtime copy of it), and `_sweptRecord`, a binding
 * record that holds the definition. They are set on the static binding
 * (`staticBindingOf`): the definition that an occurrence boxed in the block
 * is bound to.
 */
type Swept = { _sweptHome?: Scope; _sweptRecord?: BoxedDefinition };

/** The scope that `own` was removed from (`markSweptBinding`), or
 * `undefined`. */
function sweptHomeOf(own: BoxedBaseDefinition): Scope | undefined {
  return (staticBindingOf(own) as Swept)._sweptHome;
}

/**
 * Record that `def` was removed from `home` while the statements of `home`
 * run: by the start of a run of a `Block` (`sweepCanonicalizationBindings`,
 * `library/control-structures.ts`), or by an application of a function
 * literal, which hides the valueless bindings of its body scope
 * (`hideBodyScopeParams`, `function-utils.ts`). `home` is the scope of the
 * block or of the body itself: the template scope when the run is in a
 * runtime copy of it (an asynchronous activation, a call frame).
 *
 * The run then declares a new binding for each `Declare` statement, or none
 * (a reference that canonicalization declared, which reads the enclosing
 * scopes by name). An occurrence boxed in the block is still bound to the
 * removed definition, so it is in no chain: `sweptCallerBinding()` reads it
 * in the scope of the caller.
 */
export function markSweptBinding(def: BoxedDefinition, home: Scope): void {
  // An occurrence that reads a value is bound to a value definition.
  if (!('value' in def)) return;
  const key = staticBindingOf(def.value) as Swept;
  if (key._sweptHome === home) return;
  key._sweptHome = home;
  key._sweptRecord =
    key === (def.value as Swept) ? def : { value: key as BoxedValueDefinition };
}

/**
 * The binding that the occurrence bound to `own` reads inside a call frame,
 * when the start of a run of a `Block` removed `own` from the scope of the
 * block (`markSweptBinding`), or `undefined`.
 *
 * A run of a block makes its own bindings, so `own` is in no chain, and
 * `ownBindingInChain()` cannot find it. In the block, the occurrence reads
 * its name: the innermost binding of the name, which is the local that a
 * `Declare` statement of this run made. An argument of a call made in the
 * block holds the occurrence and is read inside the call frame, whose chain
 * goes through the scope that defined the function, not through the block.
 * There, the name found a binding of the defining scope: with a global
 * `y := 5` and a global `g := x ↦ x + 0.5`, the block
 * `Block(Declare(y, 'real'), g(y))` gave `5.5`, not `y + 0.5`.
 *
 * So when the scope of the block (or a runtime copy of it) is in the chain
 * of the caller of a call frame on the stack, the occurrence reads its name
 * from that scope up, as it does in the block. The read starts at the scope
 * of the block, not at the innermost scope of the caller: a lazy view made
 * in the block and read in a block nested in it reads the local of its own
 * block, not a local of the same name that the nested block declares. When
 * no binding of the name is left from that scope up (the run removed a
 * reference and declared nothing in its place), the occurrence reads the
 * removed binding, which has no value, and not a binding of the name in the
 * chain of the call frame: a function that closes over a private `y` does
 * not give its `y` to the `y` of the caller.
 *
 * When the scope of the block is in the current chain (`start`), the walk of
 * `bindingInContext()` already reads the name there: a function defined in
 * the block and called from a scope nested in it reads the local of the
 * block, not a local of the nested scope.
 */
function sweptCallerBinding(
  name: string,
  own: BoxedBaseDefinition,
  start: Scope | null,
  stack: ComputeEngine['_evalContextStack']
): BoxedDefinition | undefined {
  const key = staticBindingOf(own) as Swept;
  const home = key._sweptHome;
  if (home === undefined || homeInChain(start, home) !== undefined)
    return undefined;
  for (let i = stack.length - 1; i > 0; i--) {
    if (stack[i].name !== 'call') continue;
    const callerScope = stack[i - 1].lexicalScope;
    const from = homeInChain(callerScope, home);
    if (from === undefined) continue;
    // A shield of the name between the caller and the block intercepts the
    // read, as it does in the caller (`markShieldDeclaration`): with
    // `y := 3` in the block, `HoldValues(g(y), y)` gives `g(y)` evaluated
    // with `y` and no value.
    for (let s: Scope | null = callerScope; s && s !== from;) {
      const found = staticBindingIn(s, name, s === callerScope);
      if (found !== undefined && 'value' in found && isShield(found.value))
        return found;
      s = staticParentOf(s);
    }
    for (let scope: Scope | null = from; scope; scope = staticParentOf(scope)) {
      const found = staticBindingIn(scope, name, scope === callerScope);
      if (
        found !== undefined &&
        !('value' in found && isForeignBinderBinding(found.value, own))
      )
        return found;
    }
    return key._sweptRecord;
  }
  return undefined;
}

/**
 * The binding that the occurrence bound to `own` reads when the walk of
 * `bindingInContext()` found `found`, another binding of the same name, in
 * `scope`, and no call frame changes the read (`callerBinding`).
 *
 * When `own` was removed from the scope of its block (`markSweptBinding`)
 * and that scope is further up the chain than `scope`, `found` is a local of
 * a block nested in the block of the occurrence. The occurrence was not
 * written in that nested block: a value carries it there, such as a lazy
 * view made in the outer block and read in the nested one. It reads its name
 * from the scope of its own block up, as it does in that block, or the
 * removed binding (no value) when no binding of the name is left there. With
 * `L := Map(g, [y])` made in a block that declares `y`, a nested block that
 * declares `y := 7` and reads `L[1]` gave `g(7)`.
 *
 * Otherwise `found` answers: the local of this run of the block of the
 * occurrence, or a binding of a scope that the walk reaches when the block
 * of the occurrence is not in the chain.
 */
function sweptHomeBinding(
  name: string,
  own: BoxedBaseDefinition,
  scope: Scope,
  found: BoxedDefinition
): BoxedDefinition {
  // A shield intercepts a read of its name whatever binding the occurrence
  // denotes (`markShieldDeclaration`): `HoldValues(y + 1, y)` in a block
  // where `y := 3` gives `y + 1`.
  if ('value' in found && isShield(found.value)) return found;
  const key = staticBindingOf(own) as Swept;
  const home = key._sweptHome;
  if (home === undefined || scopeStandsFor(scope, home)) return found;
  const from = homeInChain(staticParentOf(scope), home);
  if (from === undefined) return found;
  for (let s: Scope | null = from; s; s = staticParentOf(s)) {
    const binding = staticBindingIn(s, name, false);
    if (
      binding !== undefined &&
      !('value' in binding && isForeignBinderBinding(binding.value, own))
    )
      return binding;
  }
  return key._sweptRecord ?? found;
}

/** The first scope of the chain that starts at `scope` that is `home`, or a
 * runtime copy of it (`scopeStandsFor`), or `undefined`. */
function homeInChain(scope: Scope | null, home: Scope): Scope | undefined {
  for (; scope; scope = staticParentOf(scope))
    if (scopeStandsFor(scope, home)) return scope;
  return undefined;
}

/**
 * What a read of the occurrence bound to `own` answers in the chain that
 * starts at `scope`, when `own` is in that chain; `undefined` when it is not.
 *
 * The answer is the innermost binding of `name` in the chain that is not a
 * foreign binder's variable: `own` itself, or a declaration of the same name
 * pushed above it, which hides `own` there exactly as it does for a read in
 * that scope (the "Symbol identity" rule of `docs/SCOPING-MODEL.md`). So an
 * argument read inside a call frame answers what the same expression
 * answers in the caller's scope: with `c` declared in a pushed scope, `g(c)`
 * boxed there, then `c` declared again and assigned 7 in a scope pushed
 * above it, both `c` and `g(c)` read the 7.
 */
function ownBindingInChain(
  name: string,
  own: BoxedBaseDefinition,
  scope: Scope | null,
  isWalkStart: boolean
): BoxedDefinition | undefined {
  let innermost: BoxedDefinition | undefined;
  const start = scope;
  while (scope) {
    // Inside a type computation, the static view (`static-typing-view.ts`).
    // `scope` starts a walk when it is the scope of a caller, and continues
    // the walk of `bindingInContext()` when it is the rest of its chain.
    const found = staticBindingIn(scope, name, isWalkStart && scope === start);
    if (
      found !== undefined &&
      !('value' in found && isForeignBinderBinding(found.value, own))
    ) {
      innermost ??= found;
      if (sameBindingDef('value' in found ? found.value : found.operator, own))
        return innermost;
    }
    scope = staticParentOf(scope);
  }
  return undefined;
}

/**
 * Is the binding `scope` holds for `name` a BINDER's variable that the
 * occurrence bound to `own` does not denote?
 *
 * A call frame's parameter activation qualifies even when the occurrence
 * carries no binding at all (`own` is `undefined`), which is what the reading
 * before 2026-09-21 did. A binder operator's index (`markBinderVariable`)
 * qualifies under two further conditions.
 *
 * The occurrence must HAVE a binding. One with no binding names nothing in
 * particular, so the innermost binding by name is still the best answer for
 * it, and a raw index symbol handed to a binder from outside keeps reading
 * that binder's variable.
 *
 * And the occurrence's own binding must not itself be a binder's variable.
 * Two big operators that use the same index name can be evaluated at once —
 * the asynchronous lane suspends one mid-loop and runs the other — and then
 * both the loop's per-term ASSIGNMENT and the body's read resolve the name
 * through the ambient chain. They must resolve it the same way or the two
 * evaluations answer each other's terms, so an index reads by name, as it
 * did before. What the decision of 2026-09-21 removes is a caller's index
 * intercepting a read of a GLOBAL, which no assignment of the loop was ever
 * meant to reach.
 *
 * A shield never qualifies. A shield is a valueless shadow declared for the
 * sole purpose of hiding an enclosing value (`markShieldDeclaration`), and
 * `D`, `Integrate`, `Limit` and `Solve` put one on their own binding site —
 * so a shield sits on a binder's variable, and skipping it would read the
 * very value it hides.
 */
function isForeignBinderBinding(
  def: BoxedValueDefinition,
  own: BoxedBaseDefinition | undefined
): boolean {
  if (sameBindingDef(def, own)) return false;
  if (isActivation(def)) return true;
  if (own === undefined || isShield(def)) return false;
  return isBinderVariable(def) && !isBinderVariable(own);
}

/**
 * True when `own` is the variable of a binder operator (a loop index, a
 * `Sum` index, a comprehension variable), and `def` is an ordinary binding
 * of the same name in the global scope or in the system scope (`scope` holds
 * `def`): not `own`, not the variable of a binder, not a parameter
 * activation and not a shield.
 *
 * An occurrence of a binder's variable has a value only inside a run of its
 * binder. When such an occurrence is evaluated outside its binder (a part of
 * a loop body that is taken out of its `Loop`), a global or library
 * definition of the same name is a different symbol. Reading its value gave
 * a wrong result: with a loop index `i`, the detached part
 * `ReplaceAt([1, 2, 3], i, 9)` read the imaginary unit and evaluated to an
 * `incompatible-type` error. The occurrence now has no value there and stays
 * symbolic.
 *
 * A binding in a scope below the global scope is still read by name. Some
 * evaluations of a binder run in a scope that holds a copy of the index
 * binding, not the binding the occurrence is bound to: a `Sum` in the body
 * of a function literal that `Map` applies writes the value of its index in
 * such a scope (`assignLoopIndex`, `library/utils.ts`), and the occurrence
 * must read it.
 */
function isOutsideBindingOfBinderVariable(
  ce: ComputeEngine,
  scope: Scope,
  def: BoxedValueDefinition,
  own: BoxedBaseDefinition | undefined
): boolean {
  if (own === undefined || !isBinderVariable(own)) return false;
  const globalScope = ce._evalContextStack[1]?.lexicalScope;
  if (scope !== globalScope && scope !== globalScope?.parent) return false;
  if (sameBindingDef(def, own)) return false;
  return !isBinderVariable(def) && !isActivation(def) && !isShield(def);
}

/** Is `def` a call frame's parameter activation (see `markActivation`)? */
function isActivation(def: BoxedBaseDefinition): boolean {
  return (def as Activated)._activationOf !== undefined;
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
  // binding of the name instead.
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
 * outside the binder is the first binding on the scope chain that is not a
 * shield and not the variable of a binder.
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
    if (isShield(found.value) || isBinderVariable(found.value)) continue;
    outer = found.value;
    break;
  }
  if (outer === undefined || !isActivation(outer)) return true;
  let varies = false;
  rewriteWithBinders(value, (s, shadowed) => {
    if (s.symbol !== name || shadowed?.has(name)) return s;
    const def = s.valueDefinition;
    if (def === undefined || sameBindingDef(def, outer)) varies = true;
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
 * definition — the same two cases `markShieldDeclaration` leaves alone.
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

/** @see markShieldDeclaration */
type Shielded = { _isShield?: true };

/**
 * Mark the binding `scope` holds for `name` as a SHIELD.
 *
 * A shield is a valueless shadow declared for no reason other than to hide an
 * enclosing binding's VALUE for the duration of some work: `withValueShield`
 * (`utils.ts` — `D`, `Integrate`, `Limit`, `JacobianMatrix`, `Solve`) and
 * `simplifyValueBlind` (`simplify.ts` — the public `.simplify()`) are the two
 * sites, and between them every shield in the engine.
 *
 * `evaluateInOwnBindings`' restriction 2 used to infer this from "the
 * shadowing binding holds no value", which is a proxy, not the property: an
 * ordinary inner `Declare(x, 'real')` shields nothing yet intercepted a stored
 * value's free `x` all the same. The marker states it instead
 * (`docs/SCOPING-MODEL.md`).
 *
 * A no-op for a name the scope does not bind, or binds to an operator
 * definition: `declare` may legitimately have declined (an exotic type that
 * does not round-trip), and the caller leaves that symbol unshielded.
 */
export function markShieldDeclaration(scope: Scope, name: string): void {
  const def = scope.bindings.get(name);
  if (def !== undefined && 'value' in def)
    (def.value as unknown as Shielded)._isShield = true;
}

/** Is `def` a shield (see `markShieldDeclaration`)? */
export function isShield(def: BoxedValueDefinition): boolean {
  return (def as unknown as Shielded)._isShield === true;
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
 *   symbol's VALUE and the declaration would silently vanish).
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
 */
export function rebindToBindings(
  expr: Expression,
  scope: Scope,
  replacements: ReadonlyMap<string, Expression>,
  options?: {
    skipRootBinds?: boolean;
    accept?: (name: string) => boolean;
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
      if (def === undefined) return sym;
      // Inline value-def check (`isValueDef` lives in `utils.ts`, which
      // imports this module).
      const own = scope.bindings.get(name);
      if (own !== undefined && 'value' in own && own.value === def) return sym;
      if (isQualifiedName(sym)) return sym;
      return target;
    },
    undefined,
    options?.skipRootBinds ?? false
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
 * Two restrictions keep this confined to dereference, each one measured:
 *
 * - **The occurrence's definition must be reachable** in the current chain —
 *   it refuses to re-point a free symbol at a definition that is not in the
 *   chain AT ALL, i.e. one belonging to an already-popped scope. Generalizing
 *   to "an occurrence always means its own binding" contradicts both
 *   beta-reduction and the cached-expression re-binding contract (CONTRACT 4,
 *   `pipeline-contracts.test.ts`) — measured at 100+ failures.
 *
 *   "Reachable" is `sameBindingDef`, not identity: a call frame parks a
 *   parameter's value in a fresh definition and hides the body's own
 *   (`hideBodyScopeParams` in `function-utils.ts`), so a body occurrence used
 *   to be unreachable BY DESIGN — the restriction looked conditional on that
 *   arrangement. The frame's definition is an ACTIVATION of the body's
 *   binding, so the walk now finds it and the restriction is left doing only
 *   its own, unrelated job.
 * - **The shadowing binding must not be a SHIELD.** Shadowing a name valueless
 *   is how every shield in the engine works: `Solve` blinds its unknown at the
 *   source, so `Solve(Simplify(s) = 2, w)` resolves `s` to `(9-w²)/4` yet keeps
 *   `w` symbolic even though `w` has a global value (`solve.test.ts`), and
 *   `withValueShield`/`simplifyValueBlind` do the same for `simplify`. Honoring
 *   the occurrence's own binding there would resolve precisely what the shield
 *   exists to hide.
 *
 *   The restriction used to read "the shadowing binding must hold a VALUE",
 *   which is a PROXY for that and one the shields do not have a monopoly on: an
 *   ordinary `Block(Declare(x, 'real'), a + 5)` intercepted a stored `a = x + 1`
 *   too, and left it symbolic in a variable it does not refer to — while the
 *   same block with a VALUED shadow already did not intercept. Shields are now
 *   marked (`markShieldDeclaration`) and only they defer.
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
 * When `def` carries a tombstone, the read can still be live. An
 * asynchronous evaluation of a scoped node (a `Sum`, a `Product`) pushes an
 * activation, a copy of the local scope of the node with its own
 * definitions (`asyncScopeActivation`, `boxed-function.ts`), not the local
 * scope itself. The symbols of the body stay bound to the definitions of the
 * local scope, and the pop of any other evaluation of the node (a
 * synchronous one, or an asynchronous one on its own copy of the context
 * stack) tombstones them, also while this evaluation is suspended. The read
 * then finds the definition of the activation in the context
 * (`bindingInContext`), and that definition is the one checked. This
 * applies to a constant too: the activation holds a copy of it. A binding
 * found in the context that is not a copy of `def` (a definition of the
 * same name in an enclosing scope) does not stand for `def`, and `def` is
 * checked.
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

function ownBindingEnvironment(
  ce: ComputeEngine,
  value: Expression
): Map<string, BoxedDefinition> | undefined {
  let env: Map<string, BoxedDefinition> | undefined;
  rewriteWithBinders(value, (sym, shadowed) => {
    const name = sym.symbol;
    // An occurrence bound by a binder INSIDE the value (a stored lambda's own
    // parameter, a `Sum` index) is not free: it is not ours to re-point.
    if (shadowed?.has(name)) return sym;
    if (env?.has(name)) return sym;
    const own = sym.valueDefinition;
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
        // A shield between here and the occurrence's own binding intercepts
        // the name for every occurrence beneath it; borrowing the own binding
        // past it would read the very value the shield hides. Leave the
        // occurrence to the ambient resolution, which stops at the shield
        // (`bindingInContext`).
        if ('value' in found && isShield(found.value)) return sym;
      }
      scope = scope.parent;
    }
    if (!reachable || innermost === undefined) return sym;
    // Already the innermost binding, or shadowed by a SHIELD: the ambient
    // lookup answers correctly on its own.
    if ('value' in innermost && sameBindingDef(innermost.value, own))
      return sym;
    // An operator definition is not ours to shadow with a value binding.
    if (!('value' in innermost)) return sym;
    if (isShield(innermost.value)) return sym;
    (env ??= new Map()).set(name, {
      value: own,
    } satisfies TaggedValueDefinition);
    return sym;
  });

  return env;
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
