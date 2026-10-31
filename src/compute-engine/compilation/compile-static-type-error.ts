// The compile decline of an expression that has a sub-expression whose
// static type is `error`.

import type { Expression } from '../global-types.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { boundVariableNamesInOperand } from '../boxed-expression/binders.js';
import {
  clauseOperandShadow,
  declaredBinders,
  ownIndexClauseAt,
} from '../boxed-expression/binding-sites.js';
import { multiClauseState } from '../multi-clause.js';
import type { CompileTarget } from './types.js';
import { CompileDeclineError } from './diagnostics.js';
import { isCompileBoundName } from './compiler-names.js';
import {
  blockLocalFunction,
  userFunctionLiteral,
} from './compile-assignment-checks.js';

/** The `code` of the diagnostic of `assertNoStaticTypeError()`. */
export const STATIC_TYPE_ERROR_CODE = 'static-type-error';

/**
 * The innermost sub-expression of static type `error` that the compiled code
 * of `root` evaluates, or `undefined` when there is none.
 *
 * The walk goes into every operand: the bodies of function literals, both
 * branches of an `If` or a `Which`, the statements of a `Block`, the values
 * of a dictionary. It also goes into the body of each user function that
 * the code calls or reads by a name that is free where it occurs, because
 * the compiled code emits or inlines that body. A user-function body is
 * walked in its own scope.
 *
 * The walk keeps the names bound around each node: the parameters of a
 * function literal, the index of a `Sum` or another big operator, the
 * locals of a `Block`, the names the target binds (`target.boundVars`) and
 * the names the compiler does not resolve through the engine scope (a name
 * mapped through `vars`, a function or operator that the caller replaces, a
 * block-local function of the compilation, a name the compiler binds
 * itself). A name that a statement of a `Block` assigns is bound after that
 * statement. A bound name is not followed to a global definition, but every
 * node, a bound symbol and a call of a bound name included, still declines
 * when its own static type is `error`. This is the simple, sound version:
 * type inference can read that type from the global definition of the name,
 * so the check cannot tell an error of the bound function or symbol from an
 * error that the global one would give, and it declines in both cases. With
 * a global `G` whose body has the type `error`, `G() + u` with `G` replaced
 * through `functions` declines, although the caller's `G` gives a value.
 *
 * The walk also goes into the stored value of a symbol that it reaches,
 * because the compiler inlines that value where the symbol is read.
 *
 * The walk does not go into a `Hold`: its operand is data, which the
 * compiled code does not run.
 *
 * The types are cached on each node, so the cost is about one visit of each
 * node for each set of bound names around it, and of each body reached. A
 * node that several branches share (a DAG) is visited once for each set.
 */
export function staticTypeErrorIn(
  root: Expression,
  target?: CompileTarget<Expression>
): Expression | undefined {
  const engine = root.engine;
  const skipped = (name: string): boolean =>
    target !== undefined &&
    (isCompileBoundName(name) ||
      target.varsKeys?.has(name) === true ||
      target.foldExcludedOps?.has(name) === true ||
      target.overridesHead?.(name) === true ||
      blockLocalFunction(name, target) !== undefined);
  const boundKeys = new WeakMap<ReadonlySet<string>, string>();
  const boundKey = (bound: ReadonlySet<string>): string => {
    let key = boundKeys.get(bound);
    if (key === undefined) {
      key = JSON.stringify([...bound].sort());
      boundKeys.set(bound, key);
    }
    return key;
  };
  const reached = new Set<string>();
  const pending: Expression[] = [];
  const reach = (name: string): void => {
    if (reached.has(name) || skipped(name)) return;
    reached.add(name);
    const literal = userFunctionLiteral(engine, name);
    if (literal !== undefined) {
      pending.push(literal);
      return;
    }
    const clauses = multiClauseState(engine.lookupDefinition(name))?.clauses;
    if (clauses !== undefined) {
      for (const clause of clauses) pending.push(clause.literal);
      return;
    }
    // The stored value of a symbol: the compiler inlines it where the symbol
    // is read (`tryFoldKnownSymbol()`, `compile-folded-values.ts`), so an
    // error in it runs in the compiled code. With `s` assigned
    // `List(ADD("ab", u))`, the expression `s` declines. The `reached` set
    // stops a value that mentions its own symbol.
    const value = engine._getSymbolValue(name);
    if (value !== undefined) pending.push(value);
  };

  // The nodes visited, each with the keys of the sets of bound names it was
  // visited with. A visit that finds a node of type `error` ends the walk,
  // so every recorded visit found none.
  const seen = new WeakMap<Expression, Set<string>>();
  const isBound = (name: string, bound: ReadonlySet<string>): boolean =>
    bound.has(name) || skipped(name);

  const walk = (
    node: Expression,
    bound: ReadonlySet<string>
  ): Expression | undefined => {
    const key = boundKey(bound);
    const contexts = seen.get(node);
    if (contexts?.has(key)) return undefined;
    if (contexts) contexts.add(key);
    else seen.set(node, new Set([key]));

    // A symbol: a bound one is not followed to its global definition, but
    // its own type is still checked, because it comes from the binding of
    // the symbol itself (an input mapped through `vars` and declared
    // `error` declines).
    if (isSymbol(node)) {
      if (!isBound(node.symbol, bound)) reach(node.symbol);
      return node.type.type === 'error' ? node : undefined;
    }
    if (isDictionary(node)) {
      for (const value of node.values) {
        const found = walk(value, bound);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!isFunction(node)) return node.type.type === 'error' ? node : undefined;
    if (node.operator === 'Hold') return undefined;

    if (!isBound(node.operator, bound)) reach(node.operator);

    // The operands, innermost first.
    const binders = declaredBinders(node, 'post');
    // A name that a statement of a `Block` assigns or declares is bound
    // after that statement: the interpreter writes it when the statement
    // has computed its value, so the statements before it, and the value of
    // the statement itself, read the outer definition. With a global `G`
    // whose body has the type `error`, `Block(y := G(), G := () ↦ 1, y + u)`
    // and `Block(G := Equal(G(), 1), G)` decline. The binder helpers do not
    // list these names.
    const locals = node.operator === 'Block' ? blockLocals(node) : [];
    const writes = node.operator === 'Assign' || node.operator === 'Declare';
    for (let i = 0; i < node.ops.length; i++) {
      const arg = node.ops[i];
      // The target of an assignment or a declaration (a name, or a `Tuple`
      // of names) is written, not read.
      if (i === 0 && writes && isAssignedNames(arg)) continue;
      const names = boundVariableNamesInOperand(node, i, binders);
      const inner = names.length === 0 ? bound : new Set([...bound, ...names]);
      const own = ownIndexClauseAt(node, i, binders);
      let found: Expression | undefined;
      if (own !== undefined && isFunction(arg)) {
        for (let j = 0; j < arg.ops.length && found === undefined; j++)
          found = walk(
            arg.ops[j],
            clauseOperandShadow(bound, inner, own, j) ?? inner
          );
      } else found = walk(arg, inner);
      if (found !== undefined) return found;
      const assigned = locals[i];
      if (assigned !== undefined && assigned.length > 0)
        bound = new Set([...bound, ...assigned]);
    }
    // A call of a bound name uses its own type too. Type inference can read
    // that type from the global definition of the name, so the check cannot
    // tell an error of the bound function from an error that the global one
    // would give: it declines in both cases. With the body of the local
    // `ADD` the same as the global one, `Block(ADD := (x, y) ↦ x + y,
    // List(ADD("ab", u)))` declines, as it must; with a global `G` whose
    // body has the type `error`, `G()` declines also when the caller
    // replaces `G` (a documented over-decline).
    return node.type.type === 'error' ? node : undefined;
  };

  const initial: ReadonlySet<string> = new Set(target?.boundVars ?? []);
  const found = walk(root, initial);
  if (found !== undefined) return found;
  while (pending.length > 0) {
    const body = walk(pending.pop()!, new Set());
    if (body !== undefined) return body;
  }
  return undefined;
}

/**
 * True when `target`, the first operand of an `Assign` or a `Declare`, is
 * a name or a `Tuple` of names: a target that the statement writes and
 * does not read. Another target (`At(L, i)`) reads its operands.
 */
function isAssignedNames(target: Expression): boolean {
  if (isSymbol(target)) return true;
  return isFunction(target, 'Tuple') && target.ops.every(isAssignedNames);
}

/**
 * For each statement of `block`, the names that the statement assigns or
 * declares (`Assign`, `Declare`, with the leaves of a destructuring `Tuple`
 * target). A statement inside a nested binder is not read: its names are
 * local to that binder. The walk binds them after the statement.
 */
function blockLocals(block: Expression): string[][] {
  if (!isFunction(block)) return [];
  return block.ops.map((statement) => {
    const names: string[] = [];
    const record = (t: Expression | undefined): void => {
      if (t === undefined) return;
      if (isSymbol(t)) names.push(t.symbol);
      else if (isFunction(t, 'Tuple')) for (const leaf of t.ops) record(leaf);
    };
    if (
      isFunction(statement) &&
      (statement.operator === 'Assign' || statement.operator === 'Declare')
    )
      record(statement.ops[0]);
    return names;
  });
}

/**
 * Decline the compilation of `root` when a sub-expression that the compiled
 * code evaluates has the static type `error` (`staticTypeErrorIn()`).
 *
 * The contract of compiled code (`docs/COMPILATION-MODEL.md`, "Fail
 * closed") requires this decline. The interpreter gives an error for such a
 * sub-expression, and the compiled code would compute a value of a
 * different kind instead: with `u: real` and `ADD = (x, y) ↦ x + y`, the
 * expression `ADD("ab", u)` is valid but has the type `error`, and the
 * JavaScript target gave `"ab2"` at `u = 2`.
 *
 * The diagnostic has the code `'static-type-error'` and the kind
 * `'correctness'`: the value the compiled code would compute is withdrawn.
 * Its `value` is the sub-expression, as `toString()` writes it. The
 * interpreter fallback puts `ErrorCode` in `unsupported` for this decline,
 * as for an invalid expression (`buildInterpreterFallback()`).
 */
export function assertNoStaticTypeError(
  root: Expression,
  target: CompileTarget<Expression>
): void {
  const node = staticTypeErrorIn(root, target);
  if (node === undefined) return;
  const value = node.toString();
  throw new CompileDeclineError({
    code: STATIC_TYPE_ERROR_CODE,
    kind: 'correctness',
    message:
      `Could not compile an expression with a sub-expression of type ` +
      `'error': "${value}". The interpreter gives an error for it.`,
    value,
  });
}
