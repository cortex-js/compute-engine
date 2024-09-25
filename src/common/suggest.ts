// Levenshtein distance function
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];

  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Suggest a keyword
export function suggestKeyword(
  invalidWord: string,
  validKeywords: string[]
): string | null {
  let bestMatch: null | string = null;
  let minDistance = Infinity;
  const threshold = 3; // Only suggest if distance is 3 or less

  for (const keyword of validKeywords) {
    const distance = levenshtein(invalidWord, keyword);

    // Option 1: Check if distance is below a threshold
    if (distance <= threshold) {
      // Option 2: Check if the lengths are similar enough
      const lengthDifference = Math.abs(invalidWord.length - keyword.length);
      if (lengthDifference <= 2) {
        // Option 3: Check if they share at least 2 starting characters
        // const commonPrefix = invalidWord.slice(0, 2) === keyword.slice(0, 2);
        // if (commonPrefix) {
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = keyword;
        }
        // }
      }
    }
  }

  return bestMatch;
}
