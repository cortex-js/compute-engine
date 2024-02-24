export function permutations<T>(
  xs: ReadonlyArray<T>
): ReadonlyArray<ReadonlyArray<T>> {
  const result: ReadonlyArray<T>[] = [];

  const permute = (arr, m = []) => {
    if (arr.length === 0) {
      result.push(m);
    } else {
      for (let i = 0; i < arr.length; i++) {
        const curr = arr.slice();
        const next = curr.splice(i, 1);
        permute(curr.slice(), m.concat(next));
      }
    }
  };

  permute(xs);

  return result;
}
