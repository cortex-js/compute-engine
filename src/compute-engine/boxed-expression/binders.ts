import type {
  BoxedBaseDefinition,
  BoxedDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  TaggedValueDefinition,
} from '../global-types.js';
import { isFunction, isSymbol, isDictionary, isNumber } from './type-guards.js';
import { functionLiteralParameterNames } from './function-literal.js';
import { assertLiveBinding } from './binding-tombstone.js';

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
 * The activation-record link, as carried by `_BoxedValueDefinition`.
 *
 * Written structurally (rather than as a field of the public
 * `BoxedValueDefinition` interface) for the same reason as the debug
 * tombstone: it is an internal detail of the binder machinery, not part of the
 * definition contract.
 */
type Activated = { _activationOf?: BoxedValueDefinition };

/**
 * Record that `activation` — the per-call definition a `Function` literal's
 * call frame declares for a parameter — is an ACTIVATION of `staticBinding`,
 * the binding the literal's body `Block` declares for that same parameter
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §2.1).
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
 * The static binding `def` denotes: itself, or — for a call frame's parameter
 * definition — the literal's own binding for that parameter.
 *
 * ONE hop, non-recursive: an activation's target is always a static binding
 * (a body `Block`'s canonicalization-time declaration), never another
 * activation.
 */
function staticBindingOf(def: BoxedBaseDefinition): BoxedBaseDefinition {
  return (def as Activated)._activationOf ?? def;
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
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §4).
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
function isShield(def: BoxedValueDefinition): boolean {
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
  skipRootBinds = false
): Expression {
  if (isSymbol(expr)) return visit(expr, shadowed);

  // A dictionary is not a function node (`nops` 0): descend into its values
  // explicitly, or symbols inside them escape every rewrite pass.
  if (isDictionary(expr)) {
    const ce = expr.engine;
    let changed = false;
    const entries = expr.keys.map((key) => {
      const value = expr.get(key)!;
      const next = rewriteWithBinders(value, visit, shadowed, false);
      if (next !== value) changed = true;
      return ce.function('KeyValuePair', [ce.string(key), next]);
    });
    if (!changed) return expr;
    return ce.function('Dictionary', entries);
  }

  if (!isFunction(expr)) return expr;

  let inner = shadowed;
  if (!skipRootBinds) {
    const binds = boundVariableNames(expr);
    if (binds.length > 0)
      inner = new Set(shadowed ? [...shadowed, ...binds] : binds);
  }

  const ops = expr.ops;
  const next = ops.map((op) => rewriteWithBinders(op, visit, inner, false));
  if (next.every((op, i) => op === ops[i])) return expr;

  const ce = expr.engine;
  if (!next.every((x) => x.isValid))
    return ce.function(expr.operator, next, { form: 'raw' });
  const form = expr.isCanonical
    ? 'canonical'
    : expr.isStructural
      ? 'structural'
      : 'raw';
  return ce.function(expr.operator, next, { form, scope: expr.localScope });
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
      return target;
    },
    undefined,
    options?.skipRootBinds ?? false
  );
}

/**
 * Evaluate `value` in the environment its OWN free symbols denote — the
 * dereference half of the name-vs-binder repair
 * (`docs/plans/2026-07-24-defining-scope-dereference-design.md`).
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
    if (ce._debugBindings) assertLiveBinding(own, name);
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

  if (env === undefined) return evaluated();

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
