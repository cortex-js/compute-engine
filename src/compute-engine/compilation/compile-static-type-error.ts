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

/** The `code` of the diagnostic of `throwStaticTypeError()`. */
export const STATIC_TYPE_ERROR_CODE = 'static-type-error';

/**
 * The innermost sub-expression for which `test` is true, among the nodes
 * that the compiled code of `root` evaluates, or `undefined` when there is
 * none. The decline of a sub-expression of static type `error` and the
 * decline of a value with no settled shape (`unsettledShapeIn()`,
 * `compile-admission.ts`) use this walk.
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
 * statement. A bound name is not followed to a global definition, but
 * `test` is still called on every node, a bound symbol and a call of a
 * bound name included. For the static type `error`, this is the simple,
 * sound version: type inference can read that type from the global
 * definition of the name, so the check cannot tell an error of the bound
 * function or symbol from an error that the global one would give, and it
 * declines in both cases. With a global `G` whose body has the type
 * `error`, `G() + u` with `G` replaced through `functions` declines,
 * although the caller's `G` gives a value.
 *
 * The walk also goes into the stored value of a symbol that it reaches,
 * because the compiler inlines that value where the symbol is read.
 *
 * The walk does not go into a `Hold`: its operand is data, which the
 * compiled code does not run.
 *
 * It calls `test` on each symbol, on each node that is not a function
 * expression, and on each function expression after its operands. It does
 * not call `test` on a dictionary.
 *
 * When `dropped` is given, it gives for a node the indices of the operands
 * that the generated code drops (a branch of an `If` whose condition is
 * known at compile time). The walk still goes into a dropped operand, but
 * `test` receives `false` as its second argument for each node in it, and
 * for each node of a user-function body or of a stored value that the walk
 * reaches only from dropped operands. `test` receives `true` for every
 * other node. A node visited first in a dropped operand and then in code
 * that is kept is visited again.
 *
 * When `onRoot` is given, the walk calls it on each user-function body and
 * each stored value that it reaches, before it walks that node, with the
 * same second argument as `test`. It calls it also when the node was
 * already visited, for example as an operand of `root`, and the walk does
 * not visit it again.
 *
 * The third argument of `test` is true for a symbol whose name is free
 * where it occurs, and for a function expression whose operator name is
 * free there: no binder around the node and no statement before it in a
 * `Block` binds the name, and the target and the compiler do not bind it
 * (the bound names above). In `Sum(z, Limits(z, 1, 3))` each `z` is bound.
 * It is false for every other node.
 *
 * The types are cached on each node, so the cost is about one visit of each
 * node for each set of bound names around it, and of each body reached. A
 * node that several branches share (a DAG) is visited once for each set,
 * and at most twice more when it is also in a dropped operand.
 */
export function compiledNodeWhere(
  root: Expression,
  target: CompileTarget<Expression> | undefined,
  test: (node: Expression, kept: boolean, free: boolean) => boolean,
  dropped?: (node: Expression) => ReadonlySet<number> | undefined,
  onRoot?: (node: Expression, kept: boolean) => void
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
  // The names reached, each as `K:name` when it was reached from code that
  // is kept, and as `D:name` when it was reached from a dropped operand. A
  // name reached from kept code is not walked again for a dropped operand.
  const reached = new Set<string>();
  const pending: { node: Expression; kept: boolean }[] = [];
  const reach = (name: string, kept: boolean): void => {
    if (reached.has(`K:${name}`) || skipped(name)) return;
    if (!kept && reached.has(`D:${name}`)) return;
    reached.add(`${kept ? 'K' : 'D'}:${name}`);
    const literal = userFunctionLiteral(engine, name);
    if (literal !== undefined) {
      pending.push({ node: literal, kept });
      return;
    }
    const clauses = multiClauseState(engine.lookupDefinition(name))?.clauses;
    if (clauses !== undefined) {
      for (const clause of clauses)
        pending.push({ node: clause.literal, kept });
      return;
    }
    // The stored value of a symbol: the compiler inlines it where the symbol
    // is read (`tryFoldKnownSymbol()`, `compile-folded-values.ts`), so an
    // error in it runs in the compiled code. With `s` assigned
    // `List(ADD("ab", u))`, the expression `s` declines. The `reached` set
    // stops a value that mentions its own symbol.
    const value = engine._getSymbolValue(name);
    if (value !== undefined) pending.push({ node: value, kept });
  };

  // The nodes visited, each with the keys of the sets of bound names it was
  // visited with, as `K:key` for a visit in code that is kept and as `D:key`
  // for a visit in a dropped operand. A visit that finds a node for which
  // `test` is true ends the walk, so every recorded visit found none. A
  // visit in a dropped operand is not needed after a visit in kept code
  // with the same bound names.
  const seen = new WeakMap<Expression, Set<string>>();
  const isBound = (name: string, bound: ReadonlySet<string>): boolean =>
    bound.has(name) || skipped(name);

  const walk = (
    node: Expression,
    bound: ReadonlySet<string>,
    kept: boolean
  ): Expression | undefined => {
    const key = boundKey(bound);
    const contexts = seen.get(node);
    if (contexts?.has(`K:${key}`)) return undefined;
    if (!kept && contexts?.has(`D:${key}`)) return undefined;
    const visit = `${kept ? 'K' : 'D'}:${key}`;
    if (contexts) contexts.add(visit);
    else seen.set(node, new Set([visit]));

    // A symbol: a bound one is not followed to its global definition, but
    // its own type is still checked, because it comes from the binding of
    // the symbol itself (an input mapped through `vars` and declared
    // `error` declines).
    if (isSymbol(node)) {
      const free = !isBound(node.symbol, bound);
      if (free) reach(node.symbol, kept);
      return test(node, kept, free) ? node : undefined;
    }
    if (isDictionary(node)) {
      for (const value of node.values) {
        const found = walk(value, bound, kept);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!isFunction(node)) return test(node, kept, false) ? node : undefined;
    if (node.operator === 'Hold') return undefined;

    const free = !isBound(node.operator, bound);
    if (free) reach(node.operator, kept);
    const droppedOps = kept ? dropped?.(node) : undefined;

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
      const keptArg = kept && droppedOps?.has(i) !== true;
      let found: Expression | undefined;
      if (own !== undefined && isFunction(arg)) {
        for (let j = 0; j < arg.ops.length && found === undefined; j++)
          found = walk(
            arg.ops[j],
            clauseOperandShadow(bound, inner, own, j) ?? inner,
            keptArg
          );
      } else found = walk(arg, inner, keptArg);
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
    return test(node, kept, free) ? node : undefined;
  };

  const initial: ReadonlySet<string> = new Set(target?.boundVars ?? []);
  const found = walk(root, initial, true);
  if (found !== undefined) return found;
  while (pending.length > 0) {
    const { node, kept } = pending.pop()!;
    onRoot?.(node, kept);
    const body = walk(node, new Set(), kept);
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
 * Decline the compilation because `node`, a sub-expression that the compiled
 * code evaluates, has the static type `error`. `unsettledShapeIn()`
 * (`compile-admission.ts`) finds such a node in the walk of the expression
 * that it shares with the check of settled shapes, and calls this function
 * at once.
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
export function throwStaticTypeError(node: Expression): never {
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

/**
 * Decline the compilation of `root` when a sub-expression that the compiled
 * code evaluates has the static type `error` (`throwStaticTypeError()`).
 * This is only the check of static type `error`, without the check of
 * settled shapes that `unsettledShapeIn()` does in the same walk. The
 * JavaScript target calls it in `mode: 'bigint'` before the lane analysis,
 * so that this decline comes first in every compile mode.
 */
export function assertNoStaticTypeError(
  root: Expression,
  target: CompileTarget<Expression>
): void {
  const error = compiledNodeWhere(
    root,
    target,
    (node) => node.type.type === 'error'
  );
  if (error !== undefined) throwStaticTypeError(error);
}
