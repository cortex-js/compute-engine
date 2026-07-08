import { widen } from '../common/type/utils';
import { isSubtype } from '../common/type/subtype';
import { Expression, CollectionHandlers } from './global-types';
import { isFunction, isNumber, isSymbol } from './boxed-expression/type-guards';

/** If a collection has fewer than this many elements, eagerly evaluate it.
 *
 * For example, evaluate the Union of two sets with 10 elements each will
 * result in a set with 20 elements.
 *
 * If the sum of the sizes of the two sets is greater than
 * `MAX_SIZE_EAGER_COLLECTION`, the result is a Union expression
 *
 */
export const MAX_SIZE_EAGER_COLLECTION = 100;

export function isFiniteIndexedCollection(col: Expression): boolean {
  return (col.isFiniteCollection ?? false) && col.isIndexedCollection;
}

/** Operators that construct a tuple. All canonicalize to `Tuple`. */
const TUPLE_OPERATORS = new Set(['Tuple', 'Pair', 'Triple', 'Single']);

/**
 * A **numeric tuple** is a `Tuple`/`Pair`/`Triple` — type `tuple<number,…>` —
 * whose every element type is a subtype of `number`. These are treated as
 * points/vectors in ℝⁿ, semantically distinct from Lists (see
 * `docs/plans/2026-07-07-tuple-point-semantics.md`).
 *
 * Type-based, so it covers literal tuples AND symbols declared with a numeric
 * tuple type (e.g. `z: tuple<number, number>`).
 */
export function isNumericTuple(expr: Expression): boolean {
  const t = expr.type.type;
  if (typeof t === 'string') return false;
  if (t.kind !== 'tuple') return false;
  return t.elements.every((el) => isSubtype(el.type, 'number'));
}

/**
 * True when `expr` is provably a **scalar** number — a subtype of `number`
 * that is not a numeric tuple — established by one of three shapes:
 *
 * - a number **literal**; or
 * - a **symbol** with an explicitly DECLARED (non-inferred) number type; or
 * - a **function call** whose operator has a declared (non-inferred) numeric
 *   result AND none of whose operands is collection-typed / a collection
 *   literal.
 *
 * Everything else stays symbolic (the guards defer to evaluation). Two kinds of
 * evidence are deliberately treated as *not* proof:
 *
 * 1. Inferred types are retractable: a symbol or user function whose numeric
 *    type was merely *inferred* from earlier use might still turn out to be a
 *    tuple (Desmos forward references make this common).
 * 2. A broadcastable arithmetic operator over a list (e.g.
 *    `Multiply([0,0,1], x)`) reports a dishonest scalar-`number` result type
 *    while its value is actually a List. Requiring no collection operand keeps
 *    such calls out of the `scalar + tuple` rejection.
 *
 * STOPGAP: clause (2) works around dishonest collection-broadcast result types
 * and can be removed once those are honest — see
 * `docs/plans/2026-07-07-honest-list-broadcast-typing.md`.
 */
export function isDeclaredScalarNumber(expr: Expression): boolean {
  if (isNumericTuple(expr)) return false;
  if (!isSubtype(expr.type.type, 'number')) return false;

  // A number literal is unconditionally a provable scalar.
  if (isNumber(expr)) return true;

  // A symbol counts only when its number type was explicitly declared, not
  // merely inferred from earlier use.
  if (isSymbol(expr)) return !expr.valueDefinition?.inferredType;

  // A function call counts only when its operator has a declared (non-inferred)
  // numeric result AND no operand is a collection (type or literal). See
  // clause (2) above: a list-broadcast such as `Multiply([...], x)` reports a
  // dishonest scalar type and must NOT count as a provable scalar.
  if (isFunction(expr)) {
    if (!expr.operatorDefinition) return false;
    if (expr.operatorDefinition.inferredSignature) return false;
    if (expr.ops?.some((op) => op.isCollection)) return false;
    return true;
  }

  return false;
}

/** The element count of a tuple-typed expression when statically known. */
export function numericTupleArity(expr: Expression): number | undefined {
  const t = expr.type.type;
  if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
  return t.elements.length;
}

/**
 * True when `expr` is a literal tuple expression whose components are directly
 * accessible as operands, so component-wise arithmetic can be computed now. A
 * tuple-typed *symbol* has no accessible components and must stay symbolic.
 */
export function hasAccessibleComponents(expr: Expression): boolean {
  return (
    isFunction(expr) &&
    TUPLE_OPERATORS.has(expr.operator) &&
    (expr.ops?.length ?? 0) > 0
  );
}

export function repeat(
  value: Expression,
  count?: number
): Iterator<Expression> {
  if (typeof count === 'number') {
    if (count < 0) count = 0;
    return {
      next() {
        if (count === 0) return { done: true, value: undefined };
        count!--;
        return { done: false, value };
      },
    };
  }
  // Infinite iterator
  return {
    next() {
      return { done: false, value };
    },
  };
}

/**
 * Zips together multiple collections into a single iterator.
 *
 * Example:
 * ```typescript
 * const a = ce.expr(['List', 1, 2, 3]);
 * const b = ce.expr(['List', 4, 5, 6]);
 * const zipped = zip([a, b]);
 * for (const [x, y] of zipped) {
 *   console.log(x, y); // 1 4, 2 5, 3 6
 * }
 * ```
 */
export function zip(items: ReadonlyArray<Expression>): Iterator<Expression[]> {
  if (items.length === 0) {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  }

  if (items.length === 1) {
    const item = items[0];
    const iter = item.each();
    if (!iter) {
      // Return the value, then be done
      let done = false;
      return {
        next() {
          if (done) return { done, value: undefined };
          done = true;
          return { done: false, value: [item] };
        },
      };
    }
    return {
      next() {
        const next = iter.next();
        if (next.done) return { done: true, value: undefined };
        return { done: false, value: [next.value] };
      },
    };
  }

  // Get the length of the shortest collection
  const shortest = Math.min(
    ...items.map((x) => (x.isCollection ? (x.count ?? 1) : Infinity))
  );

  // If the shortest collection is empty, return an empty iterator
  if (shortest === 0) {
    return {
      next() {
        return { done: true, value: undefined };
      },
    };
  }

  // Get iterators for each item
  // If an item is not a collection, repeat it
  const iterators = items.map((x) => (x.isCollection ? x.each() : repeat(x)));
  let count = 0;

  // Return an iterator that zips the items
  return {
    next() {
      if (count >= shortest) {
        return { done: true, value: undefined };
      }
      const values = iterators.map((x) => x.next());
      count += 1;
      return { done: false, value: values.map((x) => x.value!) };
    },
  };
}

function collectionSubset(
  a: Expression,
  b: Expression,
  strict: boolean
): boolean | undefined {
  if (a.isFiniteCollection !== true || b.isFiniteCollection !== true)
    return undefined;

  // All elements of a must be in b
  for (const x of a.each()) if (b.contains(x) !== true) return false;

  // A strict subset (a ⊂ b) must have at least one element that is not in b
  if (strict) {
    // a must not be equal to b, therefore their size must be different
    const aSize = a.count;
    if (aSize === undefined) return false;
    const bSize = b.count;
    if (bSize === undefined) return false;
    if (aSize === bSize) return false;
  }
  return true;
}

function basicCollectionIndexWhere(
  expr: Expression,
  predicate: (element: Expression) => boolean
): number | undefined {
  if (!isFunction(expr)) return undefined;
  for (let i = 0; i !== expr.nops; i += 1)
    if (predicate(expr.ops[i]!)) return i + 1;

  return undefined;
}

function collectionIndexWhere(
  expr: Expression,
  predicate: (element: Expression) => boolean
): number | undefined {
  if (expr.isIndexedCollection !== true) return undefined;

  let i = 1;
  let op = expr.at(i);
  while (op !== undefined) {
    if (predicate(op)) return i;
    i += 1;
    op = expr.at(i);
  }

  return undefined;
}

function collectionContains(
  expr: Expression,
  target: Expression
): boolean | undefined {
  if (expr.isFiniteCollection !== true) return undefined;

  // For indexed collections, we can use the indexWhere method
  if (expr.isIndexedCollection)
    return expr.indexWhere((x) => x.isSame(target)) !== undefined;

  // For non-indexed collections, we check if the element is in the collection
  for (const x of expr.each()) if (x.isSame(target)) return true;

  return false;
}

/**
 * Default collection handlers suitable for collections that store their
 * elements as operands.
 *
 * This is the case for List, Tuple, etc.
 */
export function basicIndexedCollectionHandlers(): CollectionHandlers {
  return {
    isLazy: (_expr) => false,

    count: (expr) => (isFunction(expr) ? expr.nops : 0),

    isEmpty: (expr) => !isFunction(expr) || expr.nops === 0,

    isFinite: (_expr) => true,

    contains: (expr, target) =>
      isFunction(expr) ? expr.ops.some((x) => x.isSame(target)) : false,

    iterator: (expr) => {
      if (!isFunction(expr))
        return { next: () => ({ value: undefined, done: true as const }) };
      let index = 1;
      const last = expr.nops;

      return {
        next: () => {
          if (index === last + 1)
            return { value: undefined, done: true as const };
          index += 1;
          return { value: expr.ops[index - 1 - 1], done: false as const };
        },
      };
    },

    subsetOf: collectionSubset,

    at: (expr: Expression, index: number | string): undefined | Expression => {
      if (typeof index !== 'number' || !isFunction(expr)) return undefined;
      if (index < 0) index = expr.nops + index + 1;
      if (index < 1 || index > expr.nops) return undefined;
      return expr.ops[index - 1];
    },

    indexWhere: basicCollectionIndexWhere,

    eltsgn: (_expr) => undefined,

    elttype: (expr) => {
      if (!isFunction(expr) || expr.nops === 0) return 'unknown';
      if (expr.nops === 1) return expr.ops[0].type.type;
      return widen(...expr.ops.map((op) => op.type.type));
    },
  };
}

export function defaultCollectionHandlers(
  def: undefined | CollectionHandlers
): CollectionHandlers | undefined {
  if (!def) return undefined;

  if (!def.count || !def.iterator)
    throw new Error(
      'A collection must have at least an "iterator" and a "count" handler'
    );

  if (def.indexWhere && def.at === undefined) {
    throw new Error(
      'A collection with an "indexWhere" handler must also have an "at" handler'
    );
  }

  const result: CollectionHandlers = {
    iterator: def.iterator,
    count: def.count,
    contains: def.contains ?? collectionContains,
    isEmpty:
      def.isEmpty ??
      ((expr) => {
        const count = def.count(expr);
        if (count === undefined) return undefined;
        return def.count(expr) === 0;
      }),
    isFinite:
      def.isFinite ??
      ((expr) => {
        const count = def.count(expr);
        if (count === undefined) return undefined;
        return Number.isFinite(count);
      }),
    subsetOf: def.subsetOf ?? collectionSubset,
  };
  if (def.isLazy) result.isLazy = def.isLazy;
  if (def.eltsgn) result.eltsgn = def.eltsgn;
  if (def.elttype) result.elttype = def.elttype;
  if (def.at) {
    result.at = def.at;
    result.indexWhere = def.indexWhere ?? collectionIndexWhere;
  }
  return result;
}
