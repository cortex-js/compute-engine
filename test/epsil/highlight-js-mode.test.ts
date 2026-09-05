import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SUBSCRIPT_UNICODE,
  isBreak,
  isIdentifierContinueProhibited,
  isSubscript,
  isSuperscript,
} from '../../src/epsil/characters';
import { tokenize } from '../../src/epsil/lexer';

/**
 * `highlight.js` is not a dependency of this repo, so the assembled mode can't
 * be exercised end to end here. Its character tables can be, though, and those
 * are where it drifts: the identifier class is a hand-maintained complement of
 * tables in `characters.ts`, and when it falls out of sync a symbol silently
 * swallows the punctuation after it (`Add(x, 2)` highlighting `x,` as one
 * name) — invisible in a screenshot, since identifiers render unstyled.
 *
 * So rather than eyeball the classes, read them out of the mode (and out of
 * the VS Code grammar, a hand-maintained port of the same classes) and compare
 * them against the lexer's own predicates on every code point, then against
 * the lexer's actual token boundaries on sample programs.
 */

/** A code point the lexer keeps INSIDE a symbol name while scanning it.
 * `scanSymbol` stops at `isBreak(c) || isIdentifierContinueProhibited(c)` and
 * at every script character. */
function isNameCore(c: number): boolean {
  if (isSuperscript(c) || isSubscript(c)) return false;
  return !isBreak(c) && !isIdentifierContinueProhibited(c);
}

/** A subscript letter or digit. A maximal run of these directly after a name
 * is folded back INTO the name by `scanSymbol` (`xₙ` is `x_n`); a run that
 * holds a sign is instead one `SUBSCRIPT` token. */
function isSubscriptAlnum(c: number): boolean {
  return isSubscript(c) && /^[a-z0-9]$/i.test(SUBSCRIPT_UNICODE.get(c)!);
}

/** A pragma name (`scanHash`) stops at the break rule only. */
function isPragmaCharacter(c: number): boolean {
  return !isBreak(c) && !isIdentifierContinueProhibited(c);
}

function hex(c: number): string {
  return `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Every BMP code point on which `test(ch)` and `expected(c)` disagree. */
function divergence(
  test: (ch: string) => boolean,
  expected: (c: number) => boolean
): string[] {
  const out: string[] = [];
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue; // lone surrogates
    if (test(String.fromCodePoint(c)) !== expected(c)) out.push(hex(c));
  }
  return out;
}

/** The SYMBOL / SUPERSCRIPT / SUBSCRIPT / PRAGMA token texts the lexer makes
 * of `src`, in order — the boundaries a highlighter must reproduce. */
function lexerNames(src: string): string[] {
  return tokenize(src)
    .filter(
      (t) =>
        t.type === 'SYMBOL' ||
        t.type === 'SUPERSCRIPT' ||
        t.type === 'SUBSCRIPT' ||
        t.type === 'PRAGMA'
    )
    .map((t) => src.slice(t.start, t.end));
}

/** A decimal number literal, as both highlighters match it BEFORE any name
 * rule (the digits are identifier characters, so without this a literal would
 * be read as a name). Its matches are consumed but not reported. */
const NUMBER = /\b(?:[0-9]_*)+(?:\.(?:[0-9]_*)+)?(?:[eE][+-]?(?:[0-9]_*)+)?/;

/**
 * The name-like tokens a highlighter makes of `src`: scan left to right, and
 * at each position try the number rule, then the given matchers in order (as
 * highlight.js and TextMate both do); a position no matcher claims is skipped
 * as one character.
 */
function highlighterNames(src: string, matchers: RegExp[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    let taken = false;
    for (const re of [NUMBER, ...matchers]) {
      const sticky = new RegExp(re.source, re.flags.replace('g', '') + 'y');
      sticky.lastIndex = i;
      const m = sticky.exec(src);
      if (m !== null && m[0].length > 0) {
        if (re !== NUMBER) out.push(m[0]);
        i += m[0].length;
        taken = true;
        break;
      }
    }
    if (!taken) i += 1;
  }
  return out;
}

// The programs whose name boundaries both highlighters must reproduce. Each
// exercises one rule: a folded subscript name, a subscript run that holds a
// sign (rolled back whole), a subscript after a non-name, an exponent after a
// name / a number / a parenthesis, a parenthesized exponent, the subscript
// `ⱼ` that Pattern_Syntax excludes, a glyph constant alone and as the first
// letter of a longer name, a big-operator glyph, and a pragma that a
// superscript does not end.
const SAMPLES = [
  'xₙ',
  'a₁₂',
  'xₖ₊₁',
  'aₙ₋₁ + aₙ₋₂',
  '(a+b)ₖ',
  'x²',
  '2²',
  '(x+1)²',
  'x⁽ⁿ⁺¹⁾',
  'xⱼ',
  'xᵢⱼ₊₁',
  'π',
  'πvalue',
  '2πr',
  'ℝ',
  '∫(f, x)',
  '√2x',
  '#simplify²',
];

describe('EPSIL HIGHLIGHT.JS MODE', () => {
  const source = readFileSync(
    join(__dirname, '../../src/epsil/highlight-js-mode.js'),
    'utf-8'
  );

  /** The regex literal assigned to `const <name> = /…/;` in the mode. */
  function classOf(name: string): RegExp {
    const m = source.match(
      new RegExp(`const ${name} =\\s*(\\/\\[[^\\n]*?\\]\\/);`)
    );
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    return eval(m![1]);
  }

  const identifierCharacter = classOf('IDENTIFIER_CHARACTER');
  const nameBoundaryCharacter = classOf('NAME_BOUNDARY_CHARACTER');
  const pragmaCharacter = classOf('PRAGMA_CHARACTER');

  /** `IDENTIFIER_CHARACTERS` is built with `concat(...)`: evaluate its
   * argument list the way `concat` does (regex source or string, joined). */
  const identifier: RegExp = (() => {
    const m = source.match(
      /const IDENTIFIER_CHARACTERS = concat\(([\s\S]*?)\n\);/
    );
    expect(m).not.toBeNull();
    const IDENTIFIER_CHARACTER = identifierCharacter;
    // eslint-disable-next-line no-eval, @typescript-eslint/no-unused-vars
    const parts: (RegExp | string)[] = eval(`[${m![1]}]`);
    void IDENTIFIER_CHARACTER;
    return new RegExp(
      parts.map((p) => (typeof p === 'string' ? p : p.source)).join('')
    );
  })();

  const script: RegExp = (() => {
    const m = source.match(
      /const SCRIPT = \{[\s\S]*?match:\s*(\/\[[^\n]*?\]\+\/),/
    );
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    return eval(m![1]);
  })();

  const glyphConstant: RegExp = (() => {
    // `concat(/[…]/, '(?!', NAME_BOUNDARY_CHARACTER, ')')` — the letter-like
    // glyph constants, which need a name boundary after them.
    const m = source.match(
      /match: concat\(\s*(\/\[[^\n]*?\]\/),\s*'\(\?!',\s*NAME_BOUNDARY_CHARACTER,\s*'\)'\s*\)/
    );
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    const glyphs: RegExp = eval(m![1]);
    return new RegExp(`${glyphs.source}(?!${nameBoundaryCharacter.source})`);
  })();

  const bigOperator: RegExp = (() => {
    const m = source.match(
      /const BIG_OPERATOR = \{[\s\S]*?match: (\/\[[^\n]*?\]\/),/
    );
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    return eval(m![1]);
  })();

  const pragma = new RegExp(`#${pragmaCharacter.source}+`);

  test('the identifier class is the complement of the lexer break and script tables', () => {
    expect(
      divergence((ch) => identifierCharacter.test(ch), isNameCore)
    ).toEqual([]);
  });

  test('the name-boundary class admits the subscript letters and digits too', () => {
    expect(
      divergence(
        (ch) => nameBoundaryCharacter.test(ch),
        (c) => isNameCore(c) || isSubscriptAlnum(c)
      )
    ).toEqual([]);
  });

  test('the pragma class stops only at the lexer break rule', () => {
    expect(
      divergence((ch) => pragmaCharacter.test(ch), isPragmaCharacter)
    ).toEqual([]);
  });

  test('the script class covers exactly the superscript and subscript tables', () => {
    expect(
      divergence(
        (ch) => script.test(ch),
        (c) => isSuperscript(c) || isSubscript(c)
      )
    ).toEqual([]);
  });

  test('name boundaries agree with the lexer on the sample programs', () => {
    for (const sample of SAMPLES) {
      expect({
        sample,
        names: highlighterNames(sample, [
          pragma,
          glyphConstant,
          bigOperator,
          script,
          identifier,
        ]),
      }).toEqual({ sample, names: lexerNames(sample) });
    }
  });

  test('a number literal ends where the lexer ends it', () => {
    // `scanNumber` stops as soon as the literal ends and lets `scanSymbol` take
    // over, so `3x` is a NUMBER followed by a SYMBOL. A trailing `\b` on the
    // mode's number patterns would fail to match `3` in `3x` — digit and letter
    // are both word characters — handing the whole run to the identifier
    // matcher as one unstyled name. Implicit multiplication is pervasive in the
    // Epsil docs, so that mistake is worth pinning.
    const decimal = source.match(
      /\/\/ decimal floating-point-literal[\s\S]*?match:\s*([\s\S]*?),\n\s*\},/
    );
    expect(decimal).not.toBeNull();

    const decimalDigits = '([0-9]_*)+';
    // eslint-disable-next-line no-eval
    const pattern: string = eval(
      decimal![1].replace(/\$\{decimalDigits\}/g, decimalDigits)
    );
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

describe('EPSIL TEXTMATE GRAMMAR', () => {
  // The VS Code grammar (`vscode-epsil/syntaxes/epsil.tmLanguage.json`) is a
  // hand-maintained port of the same classes. Read each rule's pattern out of
  // the JSON and hold it to the lexer, so the two highlighters cannot drift.
  const grammar = JSON.parse(
    readFileSync(
      join(__dirname, '../../vscode-epsil/syntaxes/epsil.tmLanguage.json'),
      'utf-8'
    )
  );
  const repo = grammar.repository;
  const rule = (
    patterns: { name?: string; match?: string }[],
    name: string
  ) => {
    const r = patterns.find((p) => p.name === name);
    expect(r).toBeDefined();
    return new RegExp(r!.match!, 'u');
  };
  const identifier = rule(repo.identifiers.patterns, 'variable.other.epsil');
  const script = rule(repo.operators.patterns, 'keyword.operator.script.epsil');
  const bigOperator = rule(
    repo.operators.patterns,
    'support.function.glyph.epsil'
  );
  const pragma = new RegExp(repo.pragma.match, 'u');
  const glyphRules = repo.constants.patterns
    .filter(
      (p: { name?: string }) => p.name === 'constant.language.glyph.epsil'
    )
    .map((p: { match: string }) => new RegExp(p.match, 'u'));

  test('the identifier and script rules agree with the lexer on every code point', () => {
    // `[core]+(…)?` on a single character answers for the core class alone;
    // `[script]+` on a single character answers for the script class.
    expect(divergence((ch) => identifier.test(ch), isNameCore)).toEqual([]);
    expect(
      divergence(
        (ch) => script.test(ch),
        (c) => isSuperscript(c) || isSubscript(c)
      )
    ).toEqual([]);
  });

  test('a pragma name stops only at the lexer break rule', () => {
    expect(
      divergence(
        (ch) => pragma.test('#' + ch),
        (c) => isPragmaCharacter(c)
      )
    ).toEqual([]);
  });

  test('name boundaries agree with the lexer on the sample programs', () => {
    expect(glyphRules).toHaveLength(2);
    for (const sample of SAMPLES) {
      expect({
        sample,
        names: highlighterNames(sample, [
          pragma,
          ...glyphRules,
          bigOperator,
          script,
          identifier,
        ]),
      }).toEqual({ sample, names: lexerNames(sample) });
    }
  });
});
