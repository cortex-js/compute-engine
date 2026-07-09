import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Tier 4 of the parser-hardening plan (structural tail):
 *  1. Alignment/multiline environments (`aligned`/`align`/`gather`/...) → a
 *     `List` of the row equations (same "system" convention as single-column
 *     `\begin{cases}`). `&` alignment markers are transparent.
 *  2. Subscript-/superscript-qualified blackboard sets (`\mathbb{R}_{>0}`,
 *     `\mathbb{Z}_{>0}`, `\mathbb{R}^{+}`, ...) → named sets; `\mathbb{N}_{>1}`
 *     (no named set) → an inert set-builder.
 *  3. `\backslash` between expressions → `SetMinus` (reusing the `\setminus`
 *     head), without disturbing standalone `\backslash` or the multi-token
 *     `\R\backslash\bar\Q` trigger.
 *  4. Standalone quantified conditions (`\forall n \ge 1`) and angle-bracket
 *     notation (`\langle a, b \rangle` → inert `AngleBracket`).
 *  5. `\underbrace{...}` → inert `UnderBrace` (mirrors `\overbrace`).
 *
 * A *fresh* engine is used per parse: CE narrows the types of free symbols from
 * usage and that inference persists in an engine, so set/relational parses can
 * cross-contaminate later fragments in a shared engine (a harness artifact, not
 * a parse-capability signal). Isolating each parse keeps these assertions about
 * parsing only.
 */

const json = (s: string) => new ComputeEngine().parse(s).json;
const isClean = (s: string): boolean => {
  const e = new ComputeEngine().parse(s);
  return e.isValid && !JSON.stringify(e.json).includes('"Error"');
};

describe('Tier 4 #1 — alignment environments → system (List)', () => {
  test('leading-`&` rows (alignment marker stripped)', () => {
    expect(
      json(
        `\\begin{aligned}\n& a^{2}+a b+c=0 \\\\\n& b^{2}+b c+a=0\n\\end{aligned}`
      )
    ).toEqual([
      'List',
      ['Equal', ['Add', ['Power', 'a', 2], ['Multiply', 'a', 'b'], 'c'], 0],
      ['Equal', ['Add', ['Power', 'b', 2], ['Multiply', 'b', 'c'], 'a'], 0],
    ]);
  });

  test('`&=` rows are reassembled into a single relation', () => {
    expect(json(`\\begin{aligned}\na+b+c+d & = 13 \\\\\na^2 & = 43\n\\end{aligned}`)).toEqual([
      'List',
      ['Equal', ['Add', 'a', 'b', 'c', 'd'], 13],
      ['Equal', ['Power', 'a', 2], 43],
    ]);
  });

  test('trailing sentence punctuation inside a row is dropped', () => {
    // `x + 2y,` — the trailing comma must not become a Tuple/Sequence.
    expect(json(`\\begin{aligned}\nx &= x + 2y, \\\\\ny &= x + 2y.\n\\end{aligned}`)).toEqual([
      'List',
      ['Equal', 'x', ['Add', 'x', ['Multiply', 2, 'y']]],
      ['Equal', 'y', ['Add', 'x', ['Multiply', 2, 'y']]],
    ]);
  });

  test('commas inside a group are preserved (not treated as row punctuation)', () => {
    expect(json(`\\begin{aligned}\nf(x, y) &= x + y\n\\end{aligned}`)).toEqual([
      'List',
      ['Equal', ['f', 'x', 'y'], ['Add', 'x', 'y']],
    ]);
  });

  test('`align`, `align*`, `gather`, `split` share the same handling', () => {
    for (const env of ['align', 'align*', 'gather', 'gathered', 'split']) {
      expect(json(`\\begin{${env}}\na = 1 \\\\ b = 2\n\\end{${env}}`)).toEqual([
        'List',
        ['Equal', 'a', 1],
        ['Equal', 'b', 2],
      ]);
    }
  });

  test('matches the single-column `cases` system convention', () => {
    // `\begin{cases}` of equations already yields a `List`; `aligned` should
    // produce the identical structure.
    const cases = json(`\\begin{cases} a=1 \\\\ b=2 \\end{cases}`);
    const aligned = json(`\\begin{aligned} a=1 \\\\ b=2 \\end{aligned}`);
    expect(aligned).toEqual(cases);
  });
});

describe('Tier 4 #2 — subscript/superscript-qualified blackboard sets', () => {
  test('forms mapping to a named set', () => {
    expect(json('\\mathbb{R}_{>0}')).toEqual('PositiveNumbers');
    expect(json('\\mathbb{R}^{+}')).toEqual('PositiveNumbers');
    expect(json('\\mathbb{R}_+')).toEqual('PositiveNumbers');
    expect(json('\\mathbb{Z}_{>0}')).toEqual('PositiveIntegers');
    expect(json('\\mathbb{Z}_{\\ge 0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{Z}_{<0}')).toEqual('NegativeIntegers');
    expect(json('\\mathbb{R}_{<0}')).toEqual('NegativeNumbers');
    expect(json('\\mathbb{N}_{>0}')).toEqual('PositiveIntegers');
    expect(json('\\mathbb{N}_0')).toEqual('NonNegativeIntegers');
  });

  test('named-set forms round-trip', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\mathbb{R}_{>0}').toLatex()).toEqual('\\R_{>0}');
    expect(ce.parse('\\mathbb{Z}_{>0}').toLatex()).toEqual('\\N^*');
  });

  test('`\\mathbb{N}_{>1}` — no named set → inert set-builder fallback', () => {
    expect(json('\\mathbb{N}_{>1}')).toEqual([
      'Set',
      ['Element', 'n', 'NonNegativeIntegers'],
      ['Condition', ['Greater', 'n', 1]],
    ]);
    expect(isClean('\\mathbb{N}_{>1}')).toBe(true);
  });

  test('qualified sets in a `\\to` function signature', () => {
    expect(json('f : \\mathbb{R}_{>0} \\to \\mathbb{R}_{>0}')).toEqual([
      'Colon',
      'f',
      ['To', 'PositiveNumbers', 'PositiveNumbers'],
    ]);
  });

  test('`\\geqslant`/`\\leqslant` (amssymb slanted forms) match the `\\geq`/`\\leq` triggers', () => {
    expect(json('\\mathbb{N}_{\\geqslant 0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{N}_{\\geq 0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{Z}_{\\geqslant 0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{R}_{\\leqslant 0}')).toEqual('NonPositiveNumbers');
  });

  test('`\\mathbb{N}_{\\geq...}`/`\\geqslant...` — previously-missing naturals rows', () => {
    expect(json('\\mathbb{N}_{\\geq0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{N}_{\\ge0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{N}_{\\geqslant0}')).toEqual('NonNegativeIntegers');
    expect(json('\\mathbb{N}_{\\geq1}')).toEqual('PositiveIntegers');
    expect(json('\\mathbb{N}_{\\ge1}')).toEqual('PositiveIntegers');
    expect(json('\\mathbb{N}_{\\geqslant1}')).toEqual('PositiveIntegers');
  });

  test('qualified sets with `\\geqslant` in a `\\mapsto` function signature', () => {
    expect(isClean('f: \\mathbb{N}_{\\geqslant 1} \\mapsto \\mathbb{N}_{\\geqslant 0}')).toBe(
      true
    );
  });
});

describe('Tier 4 #3 — `\\backslash` as set difference', () => {
  test('infix `\\backslash` → SetMinus (same head as `\\setminus`)', () => {
    expect(json('A \\backslash B')).toEqual(['SetMinus', 'A', 'B']);
    expect(new ComputeEngine().parse('A \\backslash B').toLatex()).toEqual(
      'A\\setminus B'
    );
  });

  test('non-regression: multi-token `\\R\\backslash\\bar\\Q` still wins', () => {
    expect(json('\\R\\backslash\\bar\\Q')).toEqual('TranscendentalNumbers');
  });

  test('non-regression: standalone `\\backslash` is not an operator', () => {
    // No left-hand side ⇒ the infix entry does not fire; a bare backslash is
    // still an unrecognized command (not silently turned into SetMinus).
    expect(isClean('\\backslash')).toBe(false);
  });
});

describe('Tier 4 #3b — inferred-type narrowing in argument checking', () => {
  // Regression: the written-out symmetric-difference idiom. In
  // `(A \setminus B) ∪ (B \setminus A)`, the free symbol `B` is first inferred
  // as `value` (the `value*` param of `SetMinus(A, B)`), then required as `set`
  // by `SetMinus(B, A)`. Because `set <: value` and `B`'s type was inferred
  // (not declared), the argument check narrows `B` to `set` rather than
  // erroring. Both `\setminus` and `\backslash` spellings must be clean.
  test('symmetric-difference idiom parses clean (`\\setminus`)', () => {
    expect(json('(A \\setminus B) \\cup (B \\setminus A)')).toEqual([
      'Union',
      ['SetMinus', 'A', 'B'],
      ['SetMinus', 'B', 'A'],
    ]);
    expect(isClean('(A \\setminus B) \\cup (B \\setminus A)')).toBe(true);
  });

  test('symmetric-difference idiom parses clean (`\\backslash`)', () => {
    expect(json('(A \\backslash B) \\cup (B \\backslash A)')).toEqual([
      'Union',
      ['SetMinus', 'A', 'B'],
      ['SetMinus', 'B', 'A'],
    ]);
    expect(isClean('(A \\backslash B) \\cup (B \\backslash A)')).toBe(true);
  });

  test('non-SetMinus narrowing: inferred `number` narrows to `integer`', () => {
    // `Factorial2` requires `integer`; an undeclared `n` is inferred as
    // `number`. Since `integer <: number` and `n`'s type is inferred, the
    // argument check narrows `n` instead of erroring — matching the
    // single-factorial `n!`, which already parsed clean.
    expect(json('n!!')).toEqual(['Factorial2', 'n']);
    expect(isClean('n!!')).toBe(true);
  });

  test('non-regression: narrowing does not mask genuine type errors', () => {
    // Narrowing fires only when the required type is a SUBTYPE of the current
    // type AND the current type was inferred. A string is not a subtype of
    // `set`, so a string literal in set position still errors...
    expect(isClean('\\text{hi} \\setminus A')).toBe(false);
    // ...and a *declared* (not inferred) `string` symbol still errors too:
    // the narrowing is gated on `inferredType`, protecting declared types.
    const ce = new ComputeEngine();
    ce.declare('kstr', 'string');
    expect(
      JSON.stringify(ce.parse('kstr \\setminus A').json)
    ).toContain('incompatible-type');
  });
});

describe('Tier 4 #4 — quantifiers & angle brackets', () => {
  test('standalone quantified condition `\\forall n \\ge 1`', () => {
    expect(json('\\forall n \\ge 1')).toEqual([
      'ForAll',
      ['GreaterEqual', 'n', 1],
      'True',
    ]);
    expect(json('\\exists x > 0')).toEqual(['Exists', ['Greater', 'x', 0], 'True']);
  });

  test('non-regression: bare `\\forall x` (no condition, no body) still errors', () => {
    expect(isClean('\\forall x')).toBe(false);
    expect(isClean('\\exists x')).toBe(false);
  });

  test('angle brackets → inert `AngleBracket`', () => {
    expect(json('\\langle a, b \\rangle')).toEqual(['AngleBracket', 'a', 'b']);
    expect(json('\\langle v \\rangle')).toEqual(['AngleBracket', 'v']);
    expect(isClean('\\langle EMZ \\rangle = \\langle EYF \\rangle')).toBe(true);
  });

  test('non-regression: `<`/`>` remain comparison operators', () => {
    expect(json('a < b')).toEqual(['Less', 'a', 'b']);
    // CE canonicalizes `a > b` to `Less(b, a)`.
    expect(json('a > b')).toEqual(['Less', 'b', 'a']);
  });
});

describe('Tier 4 #5 — `\\underbrace` (mirrors `\\overbrace`)', () => {
  test('`\\underbrace{...}_{...}` → inert UnderBrace', () => {
    expect(json('\\underbrace{x}_{n}')).toEqual([
      'Subscript',
      ['UnderBrace', 'x'],
      'n',
    ]);
    expect(isClean('\\underbrace{x}_{n}')).toBe(true);
  });

  test('round-trips', () => {
    expect(new ComputeEngine().parse('\\underbrace{x}_{n}').toLatex()).toEqual(
      '\\underbrace{x}_{n}'
    );
  });
});
