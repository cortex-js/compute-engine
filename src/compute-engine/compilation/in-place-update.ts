import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  collectionElementType,
  resolveTypeForCompilation,
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
