/**
 * The count of the walks of a collection that missed elements.
 *
 * The iterator of `FlatMap` splices the collection that its callback returns
 * for each element. That collection can be one that cannot be enumerated now:
 * a `Join([x], v)` where `v` has no value, a `Reverse` of a `FlatMap`, or a
 * symbol of a collection type that has no value. The walk of such a
 * collection yields nothing, or the symbol as one element, so the walk of the
 * `FlatMap` misses elements, and it cannot tell its consumer. A view over the
 * `FlatMap` (`Take(FlatMap(…), 3)`) does not see the inner collection either.
 * So the iterator adds one to this count (`noteIncompleteWalk()`).
 *
 * A consumer that must know whether its walk listed every element reads the
 * count before and after the walk, and declines when the count is different:
 * `listFiniteUncountedCollection()` (`collection-utils.ts`), the
 * materialization (`RepeatableWalk`, `boxed-function.ts`), and the element
 * memo (`collection-element-memo.ts`), which must not keep such a walk as the
 * elements of the collection: a later walk would read the memo and would not
 * see that elements are missing. A read of one element by position
 * (`BoxedFunction.at()`) and a search (`IndexOf`, `IndexWhere`) use
 * `unlessWalkMissedElements()`, and a walk to a decision (`Any`, `All`,
 * `Find`) uses `MeasuredWalk`, both below.
 *
 * The count is for the process, not for one engine. Each read of it measures
 * a part of a walk that is synchronous: a pull, a read by position, the call
 * of a synchronous handler. No other evaluation can run during such a part
 * (an asynchronous evaluation runs only at an `await`), so the result of one
 * evaluation does not depend on another evaluation that runs at the same
 * time. A read before an `await` and again after it can see the incomplete
 * walks of another evaluation, so a result must not depend on such a read.
 * The element memo reads the count around the whole walk, which can include
 * an `await` of its consumer; there a changed count only stops the memo from
 * keeping the walk, and the result is the same.
 *
 * A nested evaluation whose result is a value takes back the incomplete
 * walks that it recorded (`takeBackIncompleteWalks()`), so that a read that
 * stayed unevaluated in it does not make an enclosing handler discard its
 * own result.
 *
 * This module imports nothing, so that each module can import it with no
 * dependency cycle.
 */

let incompleteWalks = 0;

/** The number of the walks that missed elements in this process. */
export function incompleteWalkCount(): number {
  return incompleteWalks;
}

/** Record that the walk in progress missed elements that it could not
 * compute. */
export function noteIncompleteWalk(): void {
  incompleteWalks += 1;
}

/**
 * Set the count back to `mark`, a value of `incompleteWalkCount()` read
 * before a nested evaluation, when the count is larger: the incomplete walks
 * that the evaluation recorded are taken back.
 *
 * An evaluation does this when its result is a value
 * (`resultHoldsNoIncompleteWalk()`, `boxed-function.ts`): a read in it that
 * met an inner collection that it cannot walk stayed unevaluated, and that is
 * a correct result. Without this, the handler that evaluated it
 * (`GroupBy([1, 2, 3], x ↦ x + Sum(Take(FlatMap(…), 3)))`) would discard its
 * own result.
 *
 * A measured read that encloses the evaluation compares the count with its
 * own earlier value. That value is at most `mark`, so an incomplete walk
 * that the read recorded before the evaluation still shows.
 */
export function takeBackIncompleteWalks(mark: number): void {
  if (incompleteWalks > mark) incompleteWalks = mark;
}

/**
 * The value of `read()`, or `undefined` when a walk during `read()` missed
 * elements (the count of `noteIncompleteWalk()` changed).
 *
 * Use it for a read whose `undefined` answer means "not known": a read of an
 * element by position (`at()`), or a search whose caller keeps the expression
 * unevaluated on `undefined`. The `at()` of `FlatMap` walks the collection up
 * to the position: when an inner collection of the walk cannot be walked, the
 * element at the position is not known, and the walk can give a wrong one
 * (the first element of `v` for the second element of
 * `FlatMap([1, 2], x ↦ Join([x], v))`).
 *
 * The count stays changed after the read, so an outer read that also measures
 * the count gets `undefined` too.
 */
export function unlessWalkMissedElements<T>(read: () => T): T | undefined {
  const before = incompleteWalks;
  const value = read();
  return incompleteWalks === before ? value : undefined;
}

/**
 * A walk of the elements that `start()` gives, which measures the start of
 * the walk and each pull from the iterator.
 *
 * The start is measured too, because the iterator of some views pulls from
 * its source when it is made: the iterator of `Differences` reads the first
 * element of its source, to subtract it from the second. So `start` is a
 * function (`() => xs.each()`), called in the walk.
 *
 * When the start or a pull records an incomplete walk
 * (`noteIncompleteWalk()`), the walk ends there with no element, and
 * `missedElements` becomes true. The element of that pull is not given: it
 * can be a symbol of a collection type that the iterator of `FlatMap` gives
 * as one element, or an element that is not at its correct position (the
 * elements of `v` are not known in `Join(v, [x])`).
 *
 * A consumer that walks to a decision (`Any`, `All`, `Find`) can then decide
 * from each element that the loop gives: these elements are the first
 * elements of the collection, in order. After the loop, a consumer that uses
 * the end of the walk (the "not found" answer of `Find`, the `False` of
 * `Any`) must first read `missedElements`, and stay unevaluated when it is
 * true.
 *
 * With a `limit`, the walk gives at most `limit` elements. When the
 * collection has more, the walk ends there and `exceededLimit` becomes true:
 * an eager operator that keeps every element (`Tally`, `GroupBy`) then stays
 * unevaluated instead of listing a collection of any size
 * (`Tally(Permutations(Range(1, 25)))` did not end, and other such reads ran
 * out of memory). `complete` is true when the walk gave every element.
 *
 * Only the start and the pulls are measured. An evaluation of the consumer
 * between two
 * pulls (a predicate) can also record an incomplete walk, but that does not
 * change the elements of this walk.
 */
export class MeasuredWalk<T> implements Iterable<T> {
  missedElements = false;
  exceededLimit = false;

  constructor(
    private readonly start: () => Iterable<T>,
    private readonly limit = Infinity
  ) {}

  /** True when the walk gave every element of the collection. */
  get complete(): boolean {
    return !this.missedElements && !this.exceededLimit;
  }

  *[Symbol.iterator](): Generator<T, void, undefined> {
    const started = incompleteWalks;
    const iter = this.start()[Symbol.iterator]();
    if (incompleteWalks !== started) {
      this.missedElements = true;
      iter.return?.();
      return;
    }
    try {
      let given = 0;
      while (true) {
        const before = incompleteWalks;
        const step = iter.next();
        if (incompleteWalks !== before) {
          this.missedElements = true;
          return;
        }
        if (step.done) return;
        if (given >= this.limit) {
          this.exceededLimit = true;
          return;
        }
        given += 1;
        yield step.value;
      }
    } finally {
      iter.return?.();
    }
  }
}
