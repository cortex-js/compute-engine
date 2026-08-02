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

describe('LITERAL WORDS cannot name a binding', () => {
  // `true`/`false` and the non-finite numeric literals `Infinity`/`oo`/`NaN`
  // are literal words: reserved in binding position (the verbatim form still
  // works), while remaining literals in expression position.
  const { parseCortex } = require('../../src/cortex/parse-cortex');
  const codes = (src: string): string[] =>
    parseCortex(src)[1].map((d: { message: unknown }) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );

  test.each([
    'let Infinity = 5',
    'let oo = 5',
    'let NaN = 1',
    'const oo = 5',
    'let (oo, x) = (1, 2)',
    'type oo = number',
    'function oo(x) { x }',
    'Infinity(x) = x',
    'oo: number = 5',
    'for oo in [1, 2] { 1 }',
  ])('%s is rejected', (src) => {
    expect(codes(src)).toContain('reserved-word');
  });

  test('the verbatim form still binds, and literals still parse', () => {
    expect(codes('let `oo` = 5')).toEqual([]);
    expect(codes('x + oo')).toEqual([]);
    expect(codes('f(oo) = 1')).toEqual([]);
    expect(codes('f(NaN) = 1')).toEqual([]);
  });
});
