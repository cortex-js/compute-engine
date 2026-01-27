/**
 * Generate all permutations of an array.
 *
 * @param xs - The array to permute
 * @param condition - Optional filter function to exclude certain permutations
 * @returns All permutations that pass the condition filter
 */
export function permutations<T>(
  xs: ReadonlyArray<T>,
  condition?: (xs: ReadonlyArray<T>) => boolean
): ReadonlyArray<ReadonlyArray<T>> {
  const result: ReadonlyArray<T>[] = [];

  const permute = (arr: T[], m: T[] = []) => {
    if (arr.length === 0) {
      if (!condition || condition(m)) {
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

  permute([...xs]);

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
