import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import {
  isDictionary,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  collectionElementType,
  // The compiled lanes read the open form of a broadcast over an operand
  // of type `unknown` as `broadcastable<R>` (`resolveTypeForCompiledLanes`).
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';

// Analyses of a compiled fold (`Reduce`/`Scan`, which `Fold` becomes) that
// the JavaScript and Python targets share: whether the step can update its
// accumulator in place, and whether the step was typed for the seed it
// receives. Each target emits its own code.

/**
 * The operators whose value never holds the list they read: an element, a
 * count, an aggregate or a truth value. An accumulator read through one of
 * these, as its first operand, is not kept by the step. An element can be a
 * row of a list of lists; such a row is shared, but an in-place update only
 * writes the outer array, so the row is not changed.
 */
const NON_RETAINING_READS = new Set([
  'At',
  'Length',
  'Count',
  'IsEmpty',
  'First',
  'Second',
  'Third',
  'Last',
  'Sum',
  'Product',
  'Max',
  'Min',
  'Mean',
  'Contains',
  'IndexOf',
]);

/**
 * For the step of a fold, `(acc, x) => body`, the operand arrays of the
 * `ReplaceAt` chains that can update the accumulator in place, or `undefined`
 * when the step must keep the copying form.
 *
 * In-place update is correct when the array is not visible to anything but
 * the fold. The fold copies its seed once, so the
 * accumulator is a fresh array at the first step. The step keeps that
 * property when every value it can return is `acc` itself, or a chain of
 * `ReplaceAt` whose innermost list operand is `acc`: then each step returns
 * the same array, and no other array is ever written. The places where the
 * step returns a value are the body, both branches of an `If`, the last
 * statement of a `Block`, and the operand of a `Return` anywhere in the step.
 * A step with any other return value, such as a new list or another variable,
 * keeps the copying form.
 *
 * Everywhere else in the step, `acc` may appear only as the first operand of
 * a read in `NON_RETAINING_READS`, so no other value holds a reference to
 * it. In particular the step cannot store `acc` in a variable or a list, pass
 * it to a function, or mention it in a function literal, which could be
 * called after the update. A read inside an index or a value of the chain is
 * allowed: the emitted code computes them before the first write
 * (`_SYS.replaceAtInPlace` on the JavaScript target,
 * `_ce_replaceat_inplace` on the Python target).
 *
 * Lean calls this "functional but in place", and Clojure's transients do the
 * same. Expressions stay immutable; only the emitted code changes. Requested
 * in issue #386.
 */
export function inPlaceUpdateChains(
  step: Expression
): ReadonlyArray<Expression>[] | undefined {
  if (!isFunction(step, 'Function') || step.nops !== 3) return undefined;
  const acc = functionLiteralParameterName(step.ops[1]);
  if (!acc || acc === functionLiteralParameterName(step.ops[2]))
    return undefined;
  const isAcc = (e: Expression): boolean => isSymbol(e, acc);
  // True when every occurrence of `acc` in `e` is the first operand of a
  // read in `NON_RETAINING_READS`, outside any function literal.
  const readsOnly = (e: Expression): boolean => {
    if (isAcc(e)) return false;
    if (!isFunction(e)) return true;
    if (e.operator === 'Function') return !mentions(e);
    // A `Return` ends the step with its operand, so it is a return value of
    // the step, wherever it is (a `Return` inside a function literal ends
    // that function instead, and the test above handles it).
    if (e.operator === 'Return') return returnsOwned(e);
    return e.ops.every((x, k) =>
      k === 0 && isAcc(x) && NON_RETAINING_READS.has(e.operator)
        ? true
        : readsOnly(x)
    );
  };
  const mentions = (e: Expression): boolean =>
    isAcc(e) || (isFunction(e) && e.ops.some(mentions));
  const chains: ReadonlyArray<Expression>[] = [];
  // True when every value that `e` can return is `acc` or a chain of
  // `ReplaceAt` rooted at `acc`, and no other part of `e` keeps `acc`.
  const returnsOwned = (e: Expression): boolean => {
    if (isAcc(e)) return true;
    if (isFunction(e, 'ReplaceAt') && e.nops === 3) {
      let node: Expression = e;
      while (isFunction(node, 'ReplaceAt') && node.nops === 3) {
        if (!readsOnly(node.op2) || !readsOnly(node.op3)) return false;
        node = node.op1;
      }
      if (!isAcc(node)) return false;
      chains.push(e.ops);
      return true;
    }
    if (isFunction(e, 'Return') && e.nops === 1) return returnsOwned(e.op1);
    if (isFunction(e, 'If') && e.nops === 3)
      return readsOnly(e.op1) && returnsOwned(e.op2) && returnsOwned(e.op3);
    if (isFunction(e, 'Block') && e.nops > 0)
      return (
        e.ops.slice(0, -1).every(readsOnly) && returnsOwned(e.ops[e.nops - 1])
      );
    return false;
  };
  if (!returnsOwned(step.ops[0]) || chains.length === 0) return undefined;
  return chains;
}

/**
 * For a local `name` of the statement list `stmts` of a block, the operand
 * arrays of the `ReplaceAt` chains that can update the value of the local in
 * place, or `undefined` when every update must keep the copying form.
 *
 * The statement `xs = ReplaceAt(xs, i, v)` copies the list. In a loop that
 * visits each element once, the copies cost O(n²). The emitted code can
 * instead copy the list once, at the first update, and then write that copy
 * in place, under two conditions:
 *
 * - The copy is known at run time. The block declares a temporary that holds
 *   the array the block made, and an update writes in place only when the
 *   local still holds that array; otherwise it makes a new copy first. So an
 *   assignment of another value to the local (`xs = L`) is allowed: the next
 *   update copies again.
 * - No other value holds a reference to the copy. So every mention of `name`
 *   in the list must be one of these: the target of an `Assign` or a
 *   `Declare` that is a statement, the innermost list operand of a chain
 *   assigned to `name`, the first operand of a read in
 *   `NON_RETAINING_READS`, or a statement by itself. A statement of the list
 *   gives its value to nothing but the block, and nothing in the block runs
 *   after its last statement. A mention anywhere else, in particular in a
 *   function literal, which can be called after an update, keeps the copying
 *   form for every update of the local. A nested scope that binds the same
 *   name is counted as such a mention, which can only keep a copy that is
 *   not needed.
 *
 * The emitted code is in `OWNED_LOCAL_UPDATE_OPS`.
 *
 * The indexes and values of a chain may read `name`: the emitted code
 * computes them before the first write, as for a fold
 * (`inPlaceUpdateChains`). Requested in issue #386 (CE-329).
 */
export function ownedLocalUpdateChains(
  stmts: ReadonlyArray<Expression>,
  name: string
): ReadonlyArray<Expression>[] | undefined {
  const isName = (e: Expression): boolean => isSymbol(e, name);
  // The values of a dictionary are walked too: a dictionary is not a
  // function expression, but a value in it can hold the list.
  // An expression can share subtrees (a node that is an operand of several
  // nodes), and the count of paths through a shared tree can grow as 2^depth.
  // So each walk keeps its answer per node: the answer of `mentions`, and the
  // answer of `allowed` for a node whose value is used, depend only on the
  // node, not on the path that reached it.
  const mentionMemo = new Map<Expression, boolean>();
  const mentions = (e: Expression): boolean => {
    if (isName(e)) return true;
    let result = mentionMemo.get(e);
    if (result !== undefined) return result;
    result =
      (isDictionary(e) && e.values.some(mentions)) ||
      (isFunction(e) && e.ops.some(mentions));
    mentionMemo.set(e, result);
    return result;
  };
  const chains: ReadonlyArray<Expression>[] = [];
  // A call with `statement` false never adds to `chains` (an assignment whose
  // value is used is refused before that), so its answer can be kept.
  // A call with `statement` true has its own memo. Its answer also depends
  // only on the node, and the first visit of the node has already added its
  // chains to `chains`. So a node that is in several statement positions
  // (`If(c, B, B)`) is walked once, and its chains are added once.
  const allowedMemo = new Map<Expression, boolean>();
  const statementMemo = new Map<Expression, boolean>();
  const allowed = (e: Expression, statement = false): boolean => {
    const memo = statement ? statementMemo : allowedMemo;
    let result = memo.get(e);
    if (result === undefined) {
      result = allowedAt(e, statement);
      memo.set(e, result);
    }
    return result;
  };
  // True when every mention of `name` in `e` is allowed. `statement` is true
  // when the value of `e` is not used: an assignment elsewhere, such as
  // `ys = (xs = ReplaceAt(xs, i, v))`, would give its value, the copy, to
  // another name. A statement is a statement of a block, the body of a
  // loop, or a branch of a conditional that is a statement. The statements
  // of `stmts` are all counted as statements, the last one too: its value is
  // the value of the block, and nothing in the block runs after it.
  const allowedAt = (e: Expression, statement: boolean): boolean => {
    if (isName(e)) return statement;
    // A dictionary keeps a reference to each of its values, for example the
    // attributes of `Declare(ys, Dictionary(value: xs))`, which give the
    // list to `ys`. So a mention of `name` in a dictionary is not allowed.
    if (isDictionary(e)) return !mentions(e);
    if (!isFunction(e)) return true;
    const h = e.operator;
    if (h === 'Function') return !mentions(e);
    if (h === 'Block' && e.localScope?.bindings.has(name)) return !mentions(e);
    if (statement && h === 'Block') return e.ops.every((x) => allowed(x, true));
    if (statement && h === 'Loop')
      return allowed(e.ops[0], true) && e.ops.slice(1).every((x) => allowed(x));
    if (statement && h === 'If')
      return e.ops.every((x, k) => allowed(x, k > 0));
    if ((h === 'Assign' || h === 'Declare') && isName(e.ops[0])) {
      if (!statement) return false;
      const value = e.ops[1];
      if (
        h === 'Assign' &&
        e.nops === 2 &&
        isFunction(value, 'ReplaceAt') &&
        value.nops === 3
      ) {
        let node: Expression = value;
        while (isFunction(node, 'ReplaceAt') && node.nops === 3) {
          if (!allowed(node.op2) || !allowed(node.op3)) return false;
          node = node.op1;
        }
        if (isName(node)) {
          chains.push(value.ops);
          return true;
        }
        return allowed(node);
      }
      return e.ops.slice(1).every((x) => allowed(x));
    }
    return e.ops.every((x, k) =>
      k === 0 && isName(x) && NON_RETAINING_READS.has(h) ? true : allowed(x)
    );
  };
  const ok = stmts.every((stmt) => allowed(stmt, true));
  return ok && chains.length > 0 ? chains : undefined;
}

/**
 * The operand arrays of the `ReplaceAt` chains accepted by
 * `ownedLocalUpdateChains`, each with the name of the temporary that holds
 * the array the block owns. The block lowering (`compileBlock`) adds them for
 * the time it compiles its statements and declares the temporary. The
 * JavaScript `ReplaceAt` lowering, which receives the operand array as
 * `args`, then writes `xs` in place when `xs` is that array, and otherwise
 * writes a copy of `xs` and keeps the copy in the temporary:
 *
 *     (_tv1 = _SYS.replaceAtInPlace(xs === _tv1 ? xs : (_tv1 = _SYS.ownedCopy(xs)), i, v))
 *
 * If the compiler passes a different array, the update keeps the copying
 * form, which is slower but correct.
 */
export const OWNED_LOCAL_UPDATE_OPS = new WeakMap<
  ReadonlyArray<Expression>,
  string
>();

/**
 * Fail closed when the seed of a fold does not fit the type the step's first
 * parameter was given. A parameter without an
 * annotation is typed from its uses, not from the fold: in
 * `Fold((acc, i) => ReplaceAt(acc, i, Sum(acc)), s, 1..2)` over a list of
 * lists `s`, `Sum(acc)` types `acc` as `indexed_collection<number>`. The
 * step is then compiled for a list of numbers, and `Sum(acc)` added two rows
 * with the scalar `+`, which joins them as a string (`"01,23,4"` where the
 * interpreter answers `[4, 6]`). The interpreter does not depend on that
 * type, so refusing lets it answer. Shared by the JavaScript and Python
 * `Reduce`/`Scan` lowerings (on Python, `Mean(acc)` became `np.mean` over the
 * rows).
 *
 * Only that case is refused: the elements of the seed are collections and
 * the step was typed for number elements. The seed's type is read, not the
 * type of every accumulator (`foldAccumulatorArgType`), which joins the
 * seed with the step's result and is often a union with no single element
 * type. A step typed for other elements
 * (`[i, i]` stored in a list of lists types `acc` as a list of 2-vectors) is
 * not affected, because its code does not depend on the element type. A scalar
 * lane is decided by `combinerPlan`, and an annotated parameter by
 * `assertCallbackAnnotations`.
 */
export function assertAccumulatorFitsStep(
  operator: string,
  step: Expression,
  seed: Expression | null | undefined
): void {
  if (seed == null || !isFunction(step, 'Function')) return;
  const passed = seed.type.type;
  const signature = step.type.type;
  if (typeof signature === 'string' || signature.kind !== 'signature') return;
  const param = signature.args?.[0]?.type;
  if (param === undefined) return;
  const passedElement = collectionElementType(
    resolveTypeForCompilation(passed)
  );
  const paramElement = collectionElementType(resolveTypeForCompilation(param));
  if (
    paramElement === undefined ||
    !isDefinitelyCollectionType(passedElement) ||
    !isSubtype(resolveTypeForCompilation(paramElement), 'number')
  )
    return;
  throw new Error(
    `Could not compile \`${operator}\`: the accumulator is \`${typeToString(passed)}\`, but ` +
      `the step was typed for \`${typeToString(param)}\` from its uses. The ` +
      `interpreter evaluates it instead.`
  );
}

/**
 * True when every value of type `t` is a collection: a row of a list of
 * lists, but also a string, a set or a dictionary. `never`, the element type of an empty list (`[]` is
 * `list<never>`), is a subtype of every type but has no value, so it is not
 * counted: an empty list holds no row.
 */
export function isDefinitelyCollectionType(t: Type | undefined): boolean {
  if (t === undefined) return false;
  // A named type (`Row` declared as `list<real>`) is resolved first, so a
  // list of rows given through a type name is recognized too.
  const resolved = resolveTypeForCompilation(t);
  return resolved !== 'never' && isSubtype(resolved, 'collection<any>');
}

/**
 * True when `t` is a union that is not definitely a collection
 * (`isDefinitelyCollectionType`) but has an arm that is: `number | vector<2>`,
 * the elements of `Rest(g(x))` for `g(t) = [t, 2t]` and `x: any`. A value of
 * such an element type may be a collection, so a fold or a statistic that
 * reads each element as a number is wrong for it: the compiled `+` of two
 * arrays concatenates them as strings.
 */
export function mayBeCollectionType(t: Type | undefined): boolean {
  if (t === undefined || isDefinitelyCollectionType(t)) return false;
  const resolved = resolveTypeForCompilation(t);
  return (
    typeof resolved !== 'string' &&
    resolved.kind === 'union' &&
    resolved.types.some((arm) => isDefinitelyCollectionType(arm))
  );
}

/**
 * True when an element of a collection operand of type `t` is, or may be,
 * a collection, so that a fold or a statistic that reads each element as a
 * number does not apply. The operand is read without its `missing` arm (a
 * restricted list of vectors, `list<vector<2>> | missing`, is a list of
 * vectors when present). The elements are a collection
 * (`isDefinitelyCollectionType`), or a union with a collection arm
 * (`mayBeCollectionType`). An operand that is a union
 * (`matrix<2x2> | vector<2>`, an index into a `broadcastable<matrix<2x2>>`)
 * is read arm by arm: its elements may be collections when those of one
 * arm may be.
 *
 * When `tensorsReadByOwnRule` is true (the JavaScript target), an operand
 * that is a tensor of unknown rank or a `broadcastable<T>`, whose elements
 * are `T | tensor<T>`, is not counted: each JavaScript lowering reads such
 * an operand by its own rule. The Python target has no such rule, and
 * passes `false`.
 */
export function elementsMayBeCollections(
  t: Type,
  tensorsReadByOwnRule = true,
  depth = 0
): boolean {
  // The depth bound stops the walk through a self-referential alias
  // (`type alias cyc = cyc | list<integer>`).
  if (depth > 8) return false;
  const present = resolveTypeForCompilation(stripMissingFromType(t));
  if (typeof present !== 'string' && present.kind === 'union')
    return present.types.some((arm) => {
      const a = resolveTypeForCompilation(arm);
      return (
        a !== 'missing' &&
        a !== 'nothing' &&
        elementsMayBeCollections(arm, tensorsReadByOwnRule, depth + 1)
      );
    });
  const elt = collectionElementType(present);
  if (isDefinitelyCollectionType(elt)) return true;
  if (!mayBeCollectionType(elt)) return false;
  if (!tensorsReadByOwnRule) return true;
  return !(
    typeof present !== 'string' &&
    (present.kind === 'broadcastable' ||
      (present.kind === 'list' && present.dimensions === null))
  );
}
