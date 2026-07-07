import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RESERVED_WORDS } from '../../src/cortex/reserved-words';

describe('CORTEX RESERVED WORDS', () => {
  test('docs/literals.md reserved-word list matches reserved-words.ts', () => {
    const doc = readFileSync(
      join(__dirname, '../../src/cortex/docs/literals.md'),
      'utf-8'
    );

    // Isolate the reserved-word list: everything between the
    // "**Reserved words** are:" marker and the terminating period, then
    // collect each backtick-quoted word.
    const region = doc.match(/\*\*Reserved words\*\* are:([\s\S]*?)\./);
    expect(region).not.toBeNull();

    const docWords = [...region![1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);

    // No accidental duplicates in the docs list.
    expect(new Set(docWords).size).toBe(docWords.length);

    expect(new Set(docWords)).toStrictEqual(RESERVED_WORDS);
  });
});
