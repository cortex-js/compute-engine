import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTIVE_WORDS,
  HARD_RESERVED_WORDS,
  LITERAL_WORDS,
  RESERVED_WORDS,
} from '../../src/epsil/reserved-words';

describe('EPSIL RESERVED WORDS', () => {
  test('docs/literals.md reserved-word list matches reserved-words.ts', () => {
    const doc = readFileSync(
      join(__dirname, '../../src/epsil/docs/literals.md'),
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

  test('the hard set is the union of the literal and active words', () => {
    expect(HARD_RESERVED_WORDS).toStrictEqual(
      new Set([...LITERAL_WORDS, ...ACTIVE_WORDS])
    );
  });

  test('every hard-reserved word is also a documented reserved word', () => {
    const extra = [...HARD_RESERVED_WORDS].filter(
      (w) => !RESERVED_WORDS.has(w)
    );
    expect(extra).toEqual([]);
  });

  test('the syntax highlighter paints exactly the claimed words', () => {
    // `highlight-js-mode.js` carries its own hardcoded tables (highlight.js is
    // not a dependency, so the assembled mode has no automated test). The
    // TABLES need no dependency, so pin them here: the previous hand-kept list
    // painted all 87 reserved words as keywords, which after the relaxation
    // would tell an author a name is unavailable when it is available.
    const {
      KEYWORDS_LIST,
      CONSTANTS_LIST,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    } = require('../../src/epsil/highlight-js-mode.js');
    const keywords: string[] = KEYWORDS_LIST;
    const constants: string[] = CONSTANTS_LIST;

    // Every word the grammar claims is highlighted: the heads and word
    // operators as keywords, the literals as constants.
    const missing = [
      ...[...ACTIVE_WORDS].filter((w) => !keywords.includes(w)),
      ...[...LITERAL_WORDS].filter((w) => !constants.includes(w)),
    ];
    expect(missing).toEqual([]);

    // …and no merely-reserved word is, in either table.
    const painted = [...keywords, ...constants];
    const wrong = [...RESERVED_WORDS].filter(
      (w) => !HARD_RESERVED_WORDS.has(w) && painted.includes(w)
    );
    expect(wrong).toEqual([]);
  });
});

describe('MERELY RESERVED WORDS are ordinary identifiers', () => {
  // The reservation policy: hard-reserve only literals and the words the
  // grammar actually consumes. Everything else stays available in EVERY
  // position until its construct exists — the three positions this test pins
  // are the ones that used to reject all 87 words.
  const { parseEpsil } = require('../../src/epsil/parse-epsil');
  const codes = (src: string): string[] =>
    parseEpsil(src)[1].map((d: { message: unknown }) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );

  test.each([
    ['a bare assignment target', 'with = 5'],
    ['a mapsto parameter', 'set => set'],
    ["a call's callee", 'label(6)'],
    ['a definition target (already worked)', 'label(6) = 1'],
    ['a binding name', 'let where = 5'],
    ['a read of that binding', 'let where = 5\nwhere + 1'],
    ['an argument', 'f(each)'],
    ['a field name', 'p.set'],
    ['the not-yet-implemented tooling words', 'assert(1)'],
  ])('%s: `%s`', (_what, src) => {
    expect(codes(src)).toEqual([]);
  });

  test('every merely-reserved word parses as a plain symbol', () => {
    for (const word of RESERVED_WORDS) {
      if (HARD_RESERVED_WORDS.has(word)) continue;
      expect([word, codes(`${word} + 1`)]).toEqual([word, []]);
    }
  });
});

describe('ACTIVE WORDS stay reserved in expression position', () => {
  const { parseEpsil } = require('../../src/epsil/parse-epsil');
  const codes = (src: string): string[] =>
    parseEpsil(src)[1].map((d: { message: unknown }) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );

  // A keyword out of place is a keyword mistake, not a symbol reference.
  test.each(['y = while', 'y = for', 'x + else', 'x + in', 'y = const'])(
    '%s is a diagnostic',
    (src) => {
      expect(codes(src)).toContain('reserved-word');
    }
  );
});

describe('LITERAL WORDS cannot name a binding', () => {
  // `true`/`false` and the non-finite numeric literals `Infinity`/`oo`/`NaN`
  // are literal words: reserved in binding position (the verbatim form still
  // works), while remaining literals in expression position.
  const { parseEpsil } = require('../../src/epsil/parse-epsil');
  const codes = (src: string): string[] =>
    parseEpsil(src)[1].map((d: { message: unknown }) =>
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
    // An assignment target: the literal has already become its value node by
    // the time the `:=` is combined, so this position checks the source slice
    // (`parser.checkAssignTarget`).
    'true := 5',
    'false := 5',
    'NaN := 1',
    'oo := 5',
    'Infinity := 5',
  ])('%s is rejected', (src) => {
    expect(codes(src)).toContain('reserved-word');
  });

  test('an ordinary symbol assignment target is unaffected', () => {
    // `True`/`False` are not reserved words — only their `true`/`false` input
    // spellings are — and the verbatim form always binds.
    expect(codes('True := 5')).toEqual([]);
    expect(codes('`true` := 5')).toEqual([]);
  });

  test('a bare `=` against a literal is a COMPARISON, not a binding', () => {
    // Positional `=`: a literal is not a binding target, so `NaN = 1` is the
    // equation `NaN == 1`. Only the explicit `:=` asks to bind, and only that
    // spelling is rejected.
    expect(codes('NaN = 1')).toEqual([]);
    expect(codes('true = 5')).toEqual([]);
  });

  test('the verbatim form still binds, and literals still parse', () => {
    expect(codes('let `oo` = 5')).toEqual([]);
    expect(codes('x + oo')).toEqual([]);
    expect(codes('f(oo) = 1')).toEqual([]);
    expect(codes('f(NaN) = 1')).toEqual([]);
  });
});
