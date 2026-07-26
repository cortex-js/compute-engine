import type {
  BoxedDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  TaggedValueDefinition,
} from '../global-types.js';
import {
  isFunction,
  isSymbol,
  isDictionary,
  isNumber,
} from './type-guards.js';
import { functionLiteralParameterName } from './function-literal.js';

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
    const ops = expr.ops;
    for (let i = 1; i < ops.length; i++) {
      const n = functionLiteralParameterName(ops[i]);
      if (n) names.push(n);
    }
  }
  return names.length === 0 ? NO_BINDERS : names;
}

const NO_BINDERS: readonly string[] = [];

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
    for (let i = 1; i < ops.length; i++) {
      const n = functionLiteralParameterName(ops[i]);
      // Only as a fallback: the body Block's own binding (set above when this
      // node is the Block) is the definition-precise one.
      if (n && !map.has(n)) map.set(n, null);
    }
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
  const form = expr.isCanonical || expr.isStructural ? 'canonical' : 'raw';
  return ce.function(expr.operator, next, { form, scope: expr.localScope });
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
 * - **The occurrence's definition must be reachable** in the current chain. A
 *   call frame parks a parameter's value in a fresh definition and hides the
 *   body's own (`hideBodyScopeParams` in `function-utils.ts`), so a body
 *   occurrence's definition is unreachable BY DESIGN and the name lookup is the
 *   only thing that can answer. Generalizing to "an occurrence always means its
 *   own binding" contradicts both beta-reduction and the cached-expression
 *   re-binding contract (CONTRACT 4, `scope.test.ts`) — measured at 100+
 *   failures.
 * - **The shadowing binding must hold a VALUE.** A valueless shadow cannot
 *   capture anything, and shadowing a name valueless is how every shield in the
 *   engine works: `Solve` blinds its unknown at the source, so
 *   `Solve(Simplify(s) = 2, w)` resolves `s` to `(9-w²)/4` yet keeps `w`
 *   symbolic even though `w` has a global value (`solve.test.ts`), and
 *   `withValueShield`/`simplifyValueBlind` do the same for `simplify`. Honoring
 *   the occurrence's own binding there would resolve precisely what the shield
 *   exists to hide.
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
    let scope: Scope | null = ce.context.lexicalScope;
    let innermost: BoxedDefinition | undefined;
    let reachable = false;
    while (scope) {
      const found = scope.bindings.get(name);
      if (found !== undefined) {
        innermost ??= found;
        if ('value' in found && found.value === own) {
          reachable = true;
          break;
        }
      }
      scope = scope.parent;
    }
    if (!reachable || innermost === undefined) return sym;
    // Already the innermost binding, or shadowed by something that holds no
    // value: the ambient lookup answers correctly on its own.
    if ('value' in innermost && innermost.value === own) return sym;
    if (!('value' in innermost) || innermost.value.value === undefined)
      return sym;
    (env ??= new Map()).set(name, { value: own } satisfies TaggedValueDefinition);
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
