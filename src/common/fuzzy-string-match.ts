/** Calculate the Levenshtein distance between two strings using a two-row optimization */
function levenshtein(source: string, target: string): number {
  if (source === target) return 0;
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  let prevRow: number[] = Array.from(
    { length: source.length + 1 },
    (_, j) => j
  );
  let currRow: number[] = new Array(source.length + 1);

  for (let i = 1; i <= target.length; i++) {
    currRow[0] = i;
    for (let j = 1; j <= source.length; j++) {
      const cost = source[j - 1] === target[i - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[source.length];
}

/** Given an invalid word, return the best match amongst validWords */
export function fuzzyStringMatch(
  invalidWord: string,
  validWords: string[]
): string | null {
  const threshold = 3;
  let bestMatch: string | null = null;
  let minDistance = Infinity;
  const invalidLength = invalidWord.length;

  for (const word of validWords) {
    // Pre-check: if the length difference is too high, skip early.
    if (Math.abs(invalidLength - word.length) > threshold) continue;

    const distance = levenshtein(invalidWord, word);

    if (distance === 0) return word; // Perfect match
    if (distance <= threshold && distance < minDistance) {
      minDistance = distance;
      bestMatch = word;
    }
  }

  return bestMatch;
}
