import type { BoxedValueDefinition, Expression } from '../global-types.js';
import { isFunction, isSymbol, isDictionary } from './type-guards.js';
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
