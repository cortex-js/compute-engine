/**
 *
 * <!--
 * !@consider?
 * - In terms of BoxedExpressions - optimizations which are always desirable to take place are
 * possible...
 *  ^Perhaps then, a wrapper BoxedExpr. utility for specifying these permutations via 'condition'
 *  would be apt...?
 *
 * - ^If wishing to take adv. of this, the 'condition' callback would likely benefit from a second parameter typed as a collection
 * ('Set' if enforcing unique) with all hitherto (arbitrary representations) of generated
 * permutations.
 *  (See commented snippets within function signature below.)
 * -->
 *
 * @export
 * @template T
 * @param xs
 * @param [condition]
 * @returns
 */
export function permutations<T /* , Y extends any = any */>(
  xs: ReadonlyArray<T>,
  condition?: (
    xs: ReadonlyArray<T> /* , generated: Set<Y> | Set<[Y,T]>? */
  ) => boolean
  // cacheKey?: (T) => Y
): ReadonlyArray<ReadonlyArray<T>> {
  const result: ReadonlyArray<T>[] = [];

  const permute = (arr: T[], m: T[] = []) => {
    if (arr.length === 0) {
      if (!condition || condition(m)) {
        // Use spread operator to create a shallow copy of m
        result.push([...m]);
      }
    } else {
      for (let i = 0; i < arr.length; i++) {
        const curr = arr.slice();
        const next = curr.splice(i, 1);
        permute(curr.slice(), m.concat(next));
      }
    }
  };

  //@fix: (typing)
  permute(xs as T[]);

  return result;
}

export function hidePrivateProperties(obj: any) {
  for (const key in obj) {
    if (key.startsWith('_') && obj.hasOwnProperty(key)) {
      Object.defineProperty(obj, key, {
        enumerable: false,
        configurable: true, // Allows redefinition if necessary
        writable: true, // Allows modification
        value: obj[key],
      });
    }
  }
}
