/**
 * Maximum number of elements for which permutations will be generated.
 * 6! = 720 permutations, which is a reasonable limit.
 * Beyond this, combinatorial explosion makes permutation-based matching impractical.
 */
const MAX_PERMUTATION_ELEMENTS = 6;

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
  // Guard against combinatorial explosion: n! grows very fast
  // 7! = 5040, 8! = 40320, 9! = 362880, 10! = 3628800
  if (xs.length > MAX_PERMUTATION_ELEMENTS) {
    console.assert(
      false,
      `permutations(): input has ${xs.length} elements, which exceeds the limit of ${MAX_PERMUTATION_ELEMENTS}. ` +
        `This would generate ${factorial(xs.length)} permutations. Returning empty array to prevent memory exhaustion.`
    );
    return [];
  }

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

/** Helper to compute factorial for error messages */
function factorial(n: number): number {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
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
