import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isBreak,
  isIdentifierContinueProhibited,
} from '../../src/cortex/characters';

/**
 * `highlight.js` is not a dependency of this repo, so the assembled mode can't
 * be exercised end to end here. Its character tables can be, though, and those
 * are where it drifts: the identifier class is a hand-maintained complement of
 * three tables in `characters.ts`, and when it falls out of sync a symbol
 * silently swallows the punctuation after it (`Add(x, 2)` highlighting `x,` as
 * one name) — invisible in a screenshot, since identifiers render unstyled.
 *
 * So rather than eyeball the class, read it out of the mode and compare it
 * against the lexer's own predicates on every code point.
 */
describe('CORTEX HIGHLIGHT.JS MODE', () => {
  const source = readFileSync(
    join(__dirname, '../../src/cortex/highlight-js-mode.js'),
    'utf-8'
  );

  test('the identifier class is the complement of the lexer break tables', () => {
    const match = source.match(
      /const IDENTIFIER_CHARACTER =\s*(\/\[\^[\s\S]*?\]\/);/
    );
    expect(match).not.toBeNull();

    // eslint-disable-next-line no-eval
    const identifierCharacter: RegExp = eval(match![1]);

    // `scanSymbol` consumes characters until `isBreak(c) ||
    // isIdentifierContinueProhibited(c)`. Anything else is an identifier
    // character, at any position: `isIdentifierStartProhibited` only adds
    // characters `PATTERN_SYNTAX` already excludes.
    const divergent: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      const lexerAllows = !isBreak(c) && !isIdentifierContinueProhibited(c);
      const modeAllows = identifierCharacter.test(String.fromCodePoint(c));
      if (lexerAllows !== modeAllows)
        divergent.push(`U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
    }

    expect(divergent).toEqual([]);
  });

  test('a number literal ends where the lexer ends it', () => {
    // `scanNumber` stops as soon as the literal ends and lets `scanSymbol` take
    // over, so `3x` is a NUMBER followed by a SYMBOL. A trailing `\b` on the
    // mode's number patterns would fail to match `3` in `3x` — digit and letter
    // are both word characters — handing the whole run to the identifier
    // matcher as one unstyled name. Implicit multiplication is pervasive in the
    // Cortex docs, so that mistake is worth pinning.
    const decimal = source.match(
      /\/\/ decimal floating-point-literal[\s\S]*?match:\s*([\s\S]*?),\n\s*\},/
    );
    expect(decimal).not.toBeNull();

    const decimalDigits = '([0-9]_*)+';
    // eslint-disable-next-line no-eval
    const pattern: string = eval(decimal![1].replace(/\$\{decimalDigits\}/g, decimalDigits));
    const re = new RegExp(pattern);

    expect('3x'.match(re)?.[0]).toBe('3');
    expect('2h + 5r'.match(re)?.[0]).toBe('2');
    expect('3.14e-2'.match(re)?.[0]).toBe('3.14e-2');
    expect('1_000'.match(re)?.[0]).toBe('1_000');
    // A digit inside a name stays inside it: the leading `\b` refuses to match
    // at the `2` of `x2`.
    expect('x2'.match(re)).toBeNull();
  });
});
