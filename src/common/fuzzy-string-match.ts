/**
 * Optimal string alignment distance (restricted Damerau–Levenshtein: handles
 * substitution, insertion, deletion, and adjacent transposition). Bails out
 * early, returning `max + 1`, once the distance is known to exceed `max`.
 */
export function osaDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prevPrev = new Array<number>(lb + 1);
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prevPrev[j - 2] + 1); // transposition
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prevPrev, prev, curr] = [prev, curr, prevPrev];
  }
  return prev[lb];
}

/**
 * Given an invalid word, return the best match amongst validWords.
 *
 * Permissive by design (distance up to 7): callers use it to *decorate* an
 * error that has already been raised, where a mediocre suggestion is
 * harmless. For a matcher whose result decides whether a warning fires at
 * all, use the conservative `suggestOperatorName` (engine-declarations.ts),
 * which layers stricter policy over the same `osaDistance` kernel.
 */
export function fuzzyStringMatch(
  invalidWord: string,
  validWords: string[]
): string | null {
  const threshold = 7;
  let bestMatch: string | null = null;
  let minDistance = Infinity;

  for (const word of validWords) {
    const distance = osaDistance(invalidWord, word, threshold);

    if (distance === 0) return word; // Perfect match
    if (distance <= threshold && distance < minDistance) {
      minDistance = distance;
      bestMatch = word;
    }
  }

  return bestMatch;
}
