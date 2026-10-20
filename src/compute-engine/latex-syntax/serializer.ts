import { TEXT_SPECIAL_CHARACTERS, escapeText } from './utils.js';
import type {
  DictionaryValue,
  MathJsonDictionaryObject,
  MathJsonExpression,
} from '../../math-json/types.js';
import {
  isDictionaryObject,
  nops,
  stringValue,
  operator,
  operand,
  symbol,
  isNumberObject,
  isSymbolObject,
  operands,
  isNumberExpression,
  machineValue,
} from '../../math-json/utils.js';

import {
  LatexString,
  SerializeLatexOptions,
  ResolvedSerializeLatexOptions,
  DelimiterScale,
  ADDITION_PRECEDENCE,
  MULTIPLICATION_PRECEDENCE,
  EXPONENTIATION_PRECEDENCE,
} from './types.js';

import { normalizeStyleOptions } from './style-options.js';

import type {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
} from './dictionary/definitions.js';

import {
  countTokens,
  endsWithSuperscript,
  joinLatex,
  supsub,
} from './tokenizer.js';
import { complexPartShape, serializeNumber } from './serialize-number.js';
import { SYMBOLS } from './dictionary/definitions-symbols.js';
import {
  DELIMITERS_SHORTHAND,
  isKeywordText,
} from './dictionary/definitions-core.js';
import { resolveUnitText } from './dictionary/definitions-units.js';
import { EMOJIS } from '../../math-json/symbols.js';

// ---------------------------------------------------------------------------
// Dot-notation serialization (dotNotation option)
// ---------------------------------------------------------------------------

/**
 * Map from function head name to the dot-notation suffix emitted when
 * `SerializeLatexOptions.dotNotation` is `true` and the function has exactly
 * one operand.
 */
const DOT_NOTATION_MAP: Readonly<Record<string, string>> = {
  // Only the point-coordinate accessors serialize to `.x`/`.y`/`.z`: the parser
  // reparses that syntax as `PointX`/`PointY`/`PointZ`, so serializing
  // `First`/`Second`/`Third` (element indexing) to `.x`/`.y`/`.z` would not
  // round-trip — `First(L)` would come back as `PointX(L)`, which broadcasts
  // over a list of points instead of returning the first element.
  PointX: '.x',
  PointY: '.y',
  PointZ: '.z',
  Real: '.\\operatorname{real}',
  Imaginary: '.\\operatorname{imag}',
  Length: '.\\operatorname{count}',
  Sum: '.\\operatorname{total}',
  Max: '.\\max',
  Min: '.\\min',
};

/**
 * If `serializer.options.dotNotation` is enabled and `expr` is a single-arg
 * form of a dot-notation head, return the dot-notation LaTeX string.
 * Otherwise return `null` (fall through to normal serialization).
 *
 * Member-access has very high precedence (similar to postfix ~810), so we use
 * POSTFIX_PRECEDENCE to decide whether the LHS operand needs parenthesization.
 */
function trySerializeDotNotation(
  serializer: Serializer,
  expr: MathJsonExpression
): string | null {
  if (!serializer.options.dotNotation) return null;
  const ops = operands(expr);
  if (!ops || ops.length !== 1) return null;
  const head = operator(expr);
  if (!head) return null;
  const suffix = DOT_NOTATION_MAP[head];
  if (suffix === undefined) return null;
  // Wrap the LHS with parens if its precedence is low enough to be ambiguous.
  // POSTFIX_PRECEDENCE (810) is used as the threshold — same order as
  // factorial/prime which have visually unambiguous postfix delimiters.
  const lhs = serializer.wrap(ops[0], 810);
  return `${lhs}${suffix}`;
}

const ACCENT_MODIFIERS: Record<string, (s: string) => string> = {
  deg: (s: string) => `${s}\\degree`,
  prime: (s: string) => `${s}^{\\prime}`,
  dprime: (s: string) => `${s}^{\\doubleprime}`,
  ring: (s: string) => `\\mathring{${s}}`,
  hat: (s: string) => `\\hat{${s}}`,
  tilde: (s: string) => `\\tilde{${s}}`,
  vec: (s: string) => `\\vec{${s}}`,
  bar: (s: string) => `\\overline{${s}}`,
  underbar: (s: string) => `\\underline{${s}}`,
  dot: (s: string) => `\\dot{${s}}`,
  ddot: (s: string) => `\\ddot{${s}}`,
  tdot: (s: string) => `\\dddot{${s}}`,
  qdot: (s: string) => `\\ddddot{${s}}`,

  // Supplemental
  acute: (s: string) => `\\acute{${s}}`,
  grave: (s: string) => `\\grave{${s}}`,
  breve: (s: string) => `\\breve{${s}}`,
  check: (s: string) => `\\check{${s}}`,
};

const STYLE_MODIFIERS: Record<string, (s: string) => string> = {
  upright: (s: string) => `\\mathrm{${s}}`,
  italic: (s: string) => `\\mathit{${s}}`,
  bold: (s: string) => `\\mathbf{${s}}`,
  script: (s: string) => `\\mathscr{${s}}`,
  fraktur: (s: string) => `\\mathfrak{${s}}`, // Note Unicode uses 'fraktur' for 'gothic'
  doublestruck: (s: string) => `\\mathbb{${s}}`, // Unicode uses 'double-struck' for 'blackboard'

  // Supplemental
  blackboard: (s: string) => `\\mathbb{${s}}`,
  calligraphic: (s: string) => `\\mathcal{${s}}`,
  gothic: (s: string) => `\\mathfrak{${s}}`,
  sansserif: (s: string) => `\\mathsf{${s}}`,
  monospace: (s: string) => `\\mathtt{${s}}`,
};

// ---------------------------------------------------------------------------
// Symbol-position serialization of operators
// ---------------------------------------------------------------------------

/**
 * The symbols whose notation is one of the number spellings configured on the
 * serializer (`positiveInfinity`, `negativeInfinity`, `notANumber`,
 * `imaginaryUnit`).
 *
 * Those denote a value, not an operator, so they stand on their own whether or
 * not the entry is flagged `standaloneSymbol`. `-\infty`, the spelling of
 * `NegativeInfinity`, in fact re-parses as `["Negate", "PositiveInfinity"]` —
 * the same value, but not the same symbol — so it could not be flagged.
 */
const NUMBER_SPELLING_SYMBOLS = new Set([
  'PositiveInfinity',
  'NegativeInfinity',
  'NaN',
  'ImaginaryUnit',
]);

/**
 * Is `name` a symbol whose spelling comes from the serializer's number
 * options?
 *
 * The exemption is keyed on the symbol being serialized, not on the LaTeX the
 * entry produces: an unrelated entry that happened to emit one of those
 * spellings would not re-parse to its own name, so it must still fall back to
 * `\mathrm{Name}`.
 */
function isNumberSpellingSymbol(name: string | null | undefined): boolean {
  return (
    name !== null && name !== undefined && NUMBER_SPELLING_SYMBOLS.has(name)
  );
}

export class Serializer {
  options: Readonly<Required<ResolvedSerializeLatexOptions>>;
  readonly dictionary: IndexedLatexDictionary;
  level = -1;
  /**
   * How deeply the expression being written is nested: 0 for the expression
   * `serialize()` was called on, 1 for one of its operands, and so on. Unlike
   * `level`, which drives the size of delimiters and which some serializers
   * adjust (a `Multiply` does not count as a level), it counts every nested
   * `serialize()` call, so a serializer can tell whether its expression is an
   * operand of another one.
   */
  depth = -1;
  constructor(
    dictionary: IndexedLatexDictionary,
    options: SerializeLatexOptions
  ) {
    this.dictionary = dictionary;
    // Ensure all optional properties are present with defaults
    // (`dotNotation` is required on `options`, so no default is needed for it)
    // The style options can be specified as a constant string: normalize them
    // to their function form.
    this.options = {
      dmsFormat: false,
      angleNormalization: 'none',
      readsAsPointList: undefined,
      readsAsCardinality: undefined,
      readsAsMatrixPowerBase: undefined,
      exponentialE: '\\exponentialE',
      ...normalizeStyleOptions(options),
    } as Required<ResolvedSerializeLatexOptions>;
  }

  /**
   * Serialize the expression, and if the expression is an operator
   * of precedence less than or equal to prec, wrap it in some parens.
   *
   * Skip wrapping for matchfix operators (Abs, Floor, Ceil, Norm, etc.)
   * and Delimiter since they already have visible delimiters.
   */
  wrap(expr: MathJsonExpression | null | undefined, prec?: number): string {
    if (expr === null || expr === undefined) return '';
    if (prec === undefined) {
      // Don't wrap matchfix operators — they already have visible delimiters
      const name = operator(expr);
      if (name) {
        const def = this.dictionary.ids.get(name);
        if (def?.kind === 'matchfix') return this.serialize(expr);
      }
      return this.wrapString(
        this.serialize(expr),
        this.options.groupStyle(expr, this.level + 1)
      );
    }

    if (typeof expr === 'number' || isNumberObject(expr)) {
      const val = machineValue(expr);
      if (val !== null && val < 0 && prec > ADDITION_PRECEDENCE)
        return this.wrap(expr);
      return this.serialize(expr);
    }
    const name = operator(expr);
    // A juxtaposition of two or more operands (`2x`) has no dictionary
    // precedence, but it is a product: wrap it as a `Multiply` would be
    // wrapped. Otherwise a tighter-binding parent takes only its last factor
    // on re-parse (`Factorial(InvisibleOperator(2, x))` → `2x!` reads as
    // `2·x!`).
    if (name === 'InvisibleOperator') {
      if (nops(expr) >= 2 && MULTIPLICATION_PRECEDENCE < prec)
        return this.wrapString(
          this.serialize(expr),
          this.options.applyFunctionStyle(expr, this.level)
        );
      return this.serialize(expr);
    }
    // The dictionary gives `Complex` a precedence just below `Add`, because
    // in general it writes as a sum (`1+2\imaginaryI`). With a real part of
    // 0 it writes as the imaginary part alone, which binds tighter: the bare
    // unit `\imaginaryI` is a single token, and `2\imaginaryI` is a product.
    // Use the precedence of the text that is actually written, so that
    // `Multiply(ImaginaryUnit, x)` is `\imaginaryI x`, not `(\imaginaryI)x`.
    // The zero tests are the ones the `Complex` serializer makes
    // (`complexPartShape()`), which read a number string from its digits:
    // `1e-800` rounds to the double 0 but is written, so it is not zero here.
    if (name === 'Complex') {
      if (complexPartShape(operand(expr, 2))?.isZero)
        return this.wrap(operand(expr, 1), prec);
      if (complexPartShape(operand(expr, 1))?.isZero) {
        const latex = this.serialize(expr);
        // A leading sign is wrapped as a negative number is
        if (latex.startsWith('-'))
          return prec > ADDITION_PRECEDENCE ? this.wrap(expr) : latex;
        if (latex === this.serialize('ImaginaryUnit')) return latex;
        if (MULTIPLICATION_PRECEDENCE < prec)
          return this.wrapString(
            latex,
            this.options.applyFunctionStyle(expr, this.level)
          );
        return latex;
      }
    }
    if (name && name !== 'Delimiter' && name !== 'Subscript') {
      const def = this.dictionary.ids.get(name);
      // `..` parses its END operand at minPrec 270 (below Add, 275) even
      // though the infix itself is declared tight (800) for its LHS — so
      // anything a parent places after a serialized `Range` is absorbed
      // into the range end on re-parse (`Add(Range(0, L-1), 3)` →
      // `0..(L-1)+3` → `Range(0, L+2)`, wrong values). For wrapping
      // purposes the effective precedence of a `Range` operand is its
      // end-binding. (Same round-trip class as the `Mod` handling in
      // `wrapShort`.)
      if (
        def &&
        (def.kind === 'symbol' ||
          def.kind === 'expression' ||
          def.kind === 'prefix' ||
          def.kind === 'infix' ||
          def.kind === 'postfix') &&
        (name === 'Range' ? 270 : def.precedence) < prec
      )
        return this.wrapString(
          this.serialize(expr),
          this.options.applyFunctionStyle(expr, this.level)
        );
    }
    return this.serialize(expr);
  }

  /**
   * If this is a "short" expression, wrap it.
   * Do not wrap symbols, positive numbers or functions.
   *
   * This is called by the serializer for power and division (i.e. "(a+1)/b")
   *
   */
  wrapShort(expr: MathJsonExpression | null | undefined): string {
    if (expr === null || expr === undefined) return '';
    const exprStr = this.serialize(expr);

    if (symbol(expr) !== null) return exprStr;

    const isNum = isNumberExpression(expr);
    // It's not a negative number, or a decimal number
    if (isNum && !/^(-|\.)/.test(exprStr)) return exprStr;

    // If the default Delimiter (i.e. using parens), don't wrap
    const h = operator(expr);
    if (h === 'Delimiter' && nops(expr) === 1) return exprStr;
    // A juxtaposition of two or more operands is a product: in a tight
    // context it must be wrapped like a `Multiply` (`(2x)^2`, not `2x^2`).
    if (h === 'InvisibleOperator' && nops(expr) >= 2)
      return this.wrapString(
        exprStr,
        this.options.groupStyle(expr, this.level + 1)
      );
    // A `Complex` node (raw, before it folds into a symbol or a real
    // literal — e.g. under `{ canonical: false }`) usually serializes to a
    // sum (`1+i`) or a scaled unit (`2i`). The precedence rule below wraps
    // those (the dictionary gives `Complex` a precedence looser than `^`).
    // Two shapes need a different decision. With an imaginary part of 0 the
    // node writes as its real part alone, so the real part decides
    // (`(\frac{1}{2})^{x}`, `1.5^{x}`). The bare unit `\imaginaryI` is a
    // single token and is not wrapped. The unit test compares the written
    // text: a float coefficient `1.0` is written (`1.0\imaginaryI`), and that
    // product must be wrapped, or `1.0\imaginaryI^{x}` reads as `1.0·i^x`.
    // A leading sign (`-\imaginaryI`) is wrapped by the rule below.
    if (h === 'Complex') {
      if (complexPartShape(operand(expr, 2))?.isZero)
        return this.wrapShort(operand(expr, 1));
      if (exprStr === this.serialize('ImaginaryUnit')) return exprStr;
    }

    // `Mod` serializes as open infix (`a\bmod b`): in a tight context
    // (power base, solidus fraction) the adjacent notation binds tighter
    // than `\bmod` and would absorb its trailing operand on re-parse
    // (`Mod(A,2)^x` → `A\bmod2^x` = `Mod(A, 2^x)`), so it must be wrapped.
    // `Range` has the same hazard on its END operand (parsed at minPrec
    // 270): `Range(1,n)^2` → `1..n^2` re-parses as `Range(1, n²)`.
    // A `Quantity` is written as a juxtaposition of its magnitude and its
    // unit: `Quantity(2, m)^n` → `2\,\mathrm{m}^{n}` re-parses as `2·m^n`.
    const isRoundTripHazard =
      h === 'Add' ||
      h === 'Negate' ||
      h === 'Subtract' ||
      h === 'Measurement' ||
      h === 'Multiply' ||
      h === 'Mod' ||
      h === 'Range' ||
      h === 'Quantity';

    // Anything the dictionary declares as an `expression`, `infix` or
    // `prefix` entry with a precedence looser than `^` reads the same way.
    // For example, `\frac{2}{3}^2` (`Rational`/`Divide`, at fraction
    // precedence) looks like the fraction raised to the denominator's power
    // squared, not the whole fraction squared, and `A\cup B^2` (`Union`)
    // re-parses as `Union(A, B^2)`.
    const def = h ? this.dictionary.ids.get(h) : undefined;
    const isLooseExpression =
      (def?.kind === 'expression' ||
        def?.kind === 'infix' ||
        def?.kind === 'prefix') &&
      def.precedence !== undefined &&
      def.precedence < EXPONENTIATION_PRECEDENCE;

    if (!isRoundTripHazard && !isLooseExpression) return exprStr;

    // Wrap the expression with delimiters
    return this.wrapString(
      exprStr,
      this.options.groupStyle(expr, this.level + 1)
    );
  }

  /**
   * Like `wrapShort`, but for a base that sits directly under a `^` (the
   * base of a `Power`/`Square`, or of a `Root` written in exponent form:
   * the solidus or quotient root style). Two more shapes read as
   * ambiguous there, though neither is a parsing hazard in `wrapShort`'s
   * other context, a solidus fraction's numerator or denominator (`a/n!`,
   * `a/x^{23}` are unambiguous, so those stay bare):
   *
   * - `Power`/`Square` (a `Power` with exponent 2 is rewritten to `Square`
   *   for serialization, see `boxed-expression/serialize.ts`): stacking
   *   superscripts, `x^{2^3}`, is read as `x^(2^3)`, a different
   *   expression than `(x^2)^3`. The fence is added only when the
   *   serialized base ends with a superscript: `Power(x, 1/2)` writes as
   *   `\sqrt{x}`, which is a single group and stays bare (`\sqrt{x}^2`).
   * - `Factorial`/`Factorial2`: `!` binds tighter than `^`
   *   (`POSTFIX_PRECEDENCE` > `EXPONENTIATION_PRECEDENCE`), so `n!^2` is
   *   unambiguous to parse, but reads as `n` factorial, squared, only
   *   with effort.
   */
  wrapPowerBase(base: MathJsonExpression | null | undefined): string {
    const wrapped = this.wrapShort(base);
    if (base === null || base === undefined) return wrapped;
    const h = operator(base);
    const isPower = h === 'Power' || h === 'Square';
    if (isPower && !endsWithSuperscript(wrapped)) return wrapped;
    if (!isPower && h !== 'Factorial' && h !== 'Factorial2') return wrapped;
    return this.wrapString(
      wrapped,
      this.options.groupStyle(base, this.level + 1)
    );
  }

  wrapString(s: string, style: DelimiterScale, fence?: string): string {
    if (style === 'none') return s;
    fence ??= '()';
    let openFence = fence?.[0] ?? '.';
    let closeFence = fence?.[1] ?? '.';

    // Map Unicode characters to LaTeX commands
    if (openFence === '"') openFence = '``';
    else if (openFence === '|') openFence = '\\lvert';
    else
      openFence =
        DELIMITERS_SHORTHAND[openFence as keyof typeof DELIMITERS_SHORTHAND] ??
        openFence;

    if (closeFence === '"') closeFence = "''";
    else if (closeFence === '|') closeFence = '\\rvert';
    else
      closeFence =
        DELIMITERS_SHORTHAND[closeFence as keyof typeof DELIMITERS_SHORTHAND] ??
        closeFence;

    if (openFence === '.' && closeFence === '.') return s;

    if ((openFence === '.' || closeFence === '.') && style === 'normal')
      style = 'scaled';

    // A fence that maps to a LaTeX command (`[` → `\lbrack`, `{` → `\lbrace`,
    // `|` → `\lvert`) must not touch a following letter: plain concatenation
    // produced `\lbrackx,y\rbrack`, which the parser rejects as the unknown
    // command `\lbrackx`. `joinLatex` inserts the separating space only where
    // a command would otherwise fuse with the next token.
    if (style === 'scaled')
      return joinLatex([`\\left${openFence}`, s, `\\right${closeFence}`]);

    if (style === 'big')
      return joinLatex([`\\Bigl${openFence}`, s, `\\Bigr${closeFence}`]);

    return joinLatex([openFence, s, closeFence]);
  }

  wrapArguments(expr: MathJsonExpression): string {
    return this.wrapString(
      operands(expr)
        // A `Block` operand fences itself (see the `Block` serializer): a
        // bare `;`-separated statement list would swallow the `, 3` of
        // `\mathrm{Repeat}(s≔2; s+1, 3)` (Tycho item 172).
        .map((x) => this.serialize(x))
        .join(', '),
      this.options.applyFunctionStyle(expr, this.level)
    );
  }

  serializeSymbol(
    expr: MathJsonExpression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    console.assert(typeof expr === 'string' || isSymbolObject(expr));
    if (def?.kind === 'function') {
      // It's a function, but it doesn't have arguments.
      // For example `"Cos"`.
      // Print the trigger as an symbol
      return this.spellSymbol(symbol(expr) ?? '');
    }
    // The def may be for an OPERATOR of that name (e.g. the infix `Add`, the
    // matchfix `Abs`, the postfix `Factorial`). Its serialize handler expects
    // an application: with no operands it yields either nothing (which would
    // silently delete the symbol) or a fragment of notation that does not
    // re-parse (`\vert\vert` for `Abs`, `!` for `Factorial`, `\sum` for
    // `Sum`). The entry's notation is used here only when the entry declares
    // that it stands on its own (`standaloneSymbol`, the `\sin` class) or is
    // one of the number symbols whose spelling comes from the serializer
    // options. Otherwise the name is spelled out as `\mathrm{Add}`, which
    // always re-parses to the same symbol.
    if (def?.serialize) {
      const result = def.serialize(this, expr);
      if (
        result.trim() !== '' &&
        (def.standaloneSymbol === true ||
          isNumberSpellingSymbol(symbol(expr) ?? def.name))
      )
        return result;
    }
    return this.spellSymbol(symbol(expr));
  }

  /**
   * Spell out a symbol name, without using any dictionary notation.
   *
   * The generic speller gives a letterlike command to the names in the
   * `SYMBOLS` table (`pi` → `\pi`). When this dictionary reads that command
   * back as a DIFFERENT symbol (`\pi` → `Pi`), the command is not this
   * symbol's to use: it is spelled upright instead (`\mathrm{pi}`), which
   * always re-parses to the symbol. See `claimedSpellings()`.
   */
  private spellSymbol(name: string | null): string {
    if (name === null) return '';
    // Every claimed name comes from the `SYMBOLS` table, so it is a plain
    // ASCII identifier and needs no escaping inside `\mathrm{}`.
    if (this.dictionary.claimedSpellings.has(name)) return `\\mathrm{${name}}`;
    return serializeSymbol(name) ?? '';
  }

  serializeFunction(
    expr: MathJsonExpression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    //
    // 0. Check dot-notation option first (pre-dispatch hook)
    //
    const dotResult = trySerializeDotNotation(this, expr);
    if (dotResult !== null) return dotResult;

    //
    // Use serialize handler if available
    //
    // ...unless the entry's own notation IS a spelling that belongs to another
    // symbol: the auto-generated entry for a head named `pi` spells it `\pi`,
    // so `\pi(x)` would read back as the constant `Pi`. Such a head is spelled
    // upright, exactly as a value symbol with the same name is (see
    // `spellSymbol()`). An entry with a notation of its own (a custom
    // `\operatorname{pi}` entry, say) is not affected: only the colliding
    // spelling is refused, not the name.
    const h = operator(expr);
    const claimed = this.dictionary.claimedSpellings.get(h);
    if (
      def?.serialize &&
      (claimed === undefined || def.latexTrigger !== claimed)
    )
      return def.serialize(this, expr);

    // It's a function without a serializer.
    // It may have come from the `resolveSymbol()` handler
    // Serialize the arguments as function arguments
    return this.spellSymbol(h) + this.wrapArguments(expr);
  }

  /**
   * Serialize `expr` as if it stood at nesting `depth` (0 for the root): for
   * a serializer that writes the same expression again in another form
   * (`ApplyWhole` as `Apply`), or for an operand whose parent already writes
   * the parentheses it would add (a `Delimiter`).
   */
  serializeAtDepth(
    expr: MathJsonExpression | null | undefined,
    depth: number
  ): LatexString {
    const saved = this.depth;
    this.depth = depth - 1;
    try {
      return this.serialize(expr);
    } finally {
      this.depth = saved;
    }
  }

  serialize(expr: MathJsonExpression | null | undefined): LatexString {
    if (expr === null || expr === undefined) return '';

    this.level += 1;
    this.depth += 1;
    try {
      const result = (() => {
        //
        // 1. Is it a number
        //
        // A JSON string is a number only when it has the form of one: the
        // string shorthand `"50%"` is the string "50%", not the number 50.
        const numericValue =
          typeof expr === 'string' && !isNumberExpression(expr)
            ? ''
            : serializeNumber(expr, this.options);
        if (numericValue) return numericValue;

        //
        // 2. Is it a string?
        //
        const s = stringValue(expr);
        if (s !== null) return serializeString(s);

        //
        // 3. Is it a symbol?
        //
        const symbolName = symbol(expr);
        if (symbolName !== null) {
          return this.serializeSymbol(
            expr,
            this.dictionary.ids.get(symbolName)
          );
        }

        //
        // 4. Is it a function?
        //
        const fnName = operator(expr);
        if (fnName) {
          const def = this.dictionary.ids.get(fnName);
          return this.serializeFunction(expr, def);
        }

        //
        // 5. Is it a dictionary object (`{dict: …}`)? It is written as the
        //    application `Dictionary(KeyValuePair(key, value), …)`.
        //
        if (isDictionaryObject(expr)) {
          const fn = dictionaryAsApplication(expr);
          return this.serializeFunction(
            fn,
            this.dictionary.ids.get('Dictionary')
          );
        }

        //
        // 6. Unknown expression
        //
        // This doesn't look like a symbol, or a function,
        // or anything we were expecting.
        // This is an invalid expression, for example an
        // object literal with no known fields, or an invalid number:
        // `{num: 'not a number'}`
        // `{foo: 'not an expression}`

        throw Error(
          `Syntax error ${expr ? JSON.stringify(expr, undefined, 4) : ''}`
        );
      })();
      this.level -= 1;
      this.depth -= 1;
      return result ?? '';
    } catch {}

    this.level -= 1;
    this.depth -= 1;
    return '';
  }
  applyFunctionStyle(expr: MathJsonExpression, level: number): DelimiterScale {
    return this.options.applyFunctionStyle(expr, level);
  }

  groupStyle(expr: MathJsonExpression, level: number): DelimiterScale {
    return this.options.groupStyle(expr, level);
  }

  rootStyle(
    expr: MathJsonExpression,
    level: number
  ): 'radical' | 'quotient' | 'solidus' {
    return this.options.rootStyle(expr, level);
  }

  fractionStyle(
    expr: MathJsonExpression,
    level: number
  ):
    | 'quotient'
    | 'block-quotient'
    | 'inline-quotient'
    | 'inline-solidus'
    | 'nice-solidus'
    | 'reciprocal'
    | 'factor' {
    return this.options.fractionStyle(expr, level);
  }

  logicStyle(
    expr: MathJsonExpression,
    level: number
  ): 'word' | 'boolean' | 'uppercase-word' | 'punctuation' {
    return this.options.logicStyle(expr, level);
  }

  powerStyle(
    expr: MathJsonExpression,
    level: number
  ): 'root' | 'solidus' | 'quotient' {
    return this.options.powerStyle(expr, level);
  }

  numericSetStyle(
    expr: MathJsonExpression,
    level: number
  ): 'compact' | 'regular' | 'interval' | 'set-builder' {
    return this.options.numericSetStyle(expr, level);
  }

  indexStyle(expr: MathJsonExpression, level: number): 'subscript' | 'bracket' {
    return this.options.indexStyle(expr, level);
  }
}

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a LaTeX command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/** Lazy map from symbol name (e.g. 'alpha') to LaTeX command (e.g.
 * '\\alpha'). Built once from the SYMBOLS table on first access; first entry
 * wins (like the `findIndex()` scan it replaces). */
let _latexBySymbolName: Map<string, string> | null = null;
function getLatexBySymbolName(): Map<string, string> {
  if (!_latexBySymbolName) {
    _latexBySymbolName = new Map();
    for (const [name, latex] of SYMBOLS)
      if (!_latexBySymbolName.has(name)) _latexBySymbolName.set(name, latex);
  }
  return _latexBySymbolName;
}

/** Lazy map from Unicode codepoint to LaTeX command. Built once from the
 * SYMBOLS table on first access; first entry wins. */
let _latexByCodepoint: Map<number, string> | null = null;
function getLatexByCodepoint(): Map<number, string> {
  if (!_latexByCodepoint) {
    _latexByCodepoint = new Map();
    for (const [, latex, codepoint] of SYMBOLS)
      if (!_latexByCodepoint.has(codepoint))
        _latexByCodepoint.set(codepoint, latex);
  }
  return _latexByCodepoint;
}

/** Digits spelled out, e.g. for `\mathbb{1}`. See `specialName()` */
const SPELLED_OUT_DIGITS = new Map<string, string>([
  ['zero', '0'],
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
  ['ten', '10'],
]);

/** Special symbol-body names mapped to LaTeX. See `specialName()` */
const EXTRA_SYMBOLS = new Map<string, string>([
  ['plus', '+'],
  ['minus', '-'],
  ['pm', '\\pm'],
  ['ast', '\\ast'],
  ['dag', '\\dag'],
  ['ddag', '\\ddag'],
  ['hash', '\\#'],
  ['bottom', '\\bot'],
  ['top', '\\top'],
  ['bullet', '\\bullet'],
  ['circle', '\\circ'],
  ['diamond', '\\diamond'],
  ['times', '\\times'],
  ['square', '\\square'],
  ['star', '\\star'],
]);

/**
 * A subscript part of a symbol name that is one of the symbols above
 * (`_plus`, `_dag`), followed by the end of the name or by another part.
 * Tested on a name whose unicode escapes are replaced by a letter.
 */
const SYMBOL_SUBSCRIPT = new RegExp(
  `_(${[...EXTRA_SYMBOLS.keys()].join('|')})(?![a-zA-Z0-9])`
);

/** If the string is a special name, extract it. A special name is considered
 * until we run into a '_' or a digit.
 * So, for example `Number` is not `\Nu mber`, but `Number`.
 */
function specialName(s: string): [result: string, rest: string] {
  // Handle ____XXXX unicode escape at the start of the string
  const unicodeMatch = s.match(/^____([0-9A-Fa-f]{6})(.*)/s);
  if (unicodeMatch) {
    // Trim leading zeros but keep at least 4 hex digits
    const hex = unicodeMatch[1].replace(/^0+/, '') || '0';
    const paddedHex = hex.padStart(4, '0');
    return [`\\unicode{"${paddedHex}}`, unicodeMatch[2]];
  }

  const prefix = s.match(/^([^_]+)/)?.[1] ?? '';
  // Does the name start with a greek letter or other special symbol?
  const symbolLatex = getLatexBySymbolName().get(prefix);
  if (symbolLatex !== undefined)
    return [symbolLatex, s.substring(prefix.length)];

  // Does the name start with a digit, spelled out?
  // i.e. for `\mathbb{1}`.
  // Match against the whole prefix (up to a subscript), like the SYMBOLS
  // branch above — not `startsWith`, which corrupted symbols such as
  // `tensor` → `10sor` and `onesie` → `1sie`.
  const digit = SPELLED_OUT_DIGITS.get(prefix);
  if (digit !== undefined) return [digit, s.substring(prefix.length)];

  // Does the name start with a Unicode symbol?
  const code = s.codePointAt(0);
  if (code !== undefined) {
    const latex = getLatexByCodepoint().get(code);
    if (latex !== undefined) return [latex, s.substring(1)];
  }

  const extra = EXTRA_SYMBOLS.get(prefix);
  if (extra !== undefined) return [extra, s.substring(prefix.length)];

  return [prefix, s.substring(prefix.length)];
}

/** Extract the body of the symbol, and the modifiers
 * (accents and styles)
 */
function parseModifiers(
  s: string
): [body: string, accents: string[], styles: string[], rest: string] {
  // Get the special names
  // eslint-disable-next-line prefer-const
  let [body, rest] = specialName(s);

  // Check for accent modifiers
  const accent: string[] = [];
  while (rest.length > 0) {
    const m = rest.match(/^_([a-zA-Z]+)(.*)/);
    if (!m) break;
    if (!ACCENT_MODIFIERS[m[1]]) break;
    accent.push(m[1]);
    rest = m[2];
  }

  const styles: string[] = [];
  while (rest.length > 0) {
    const m = rest.match(/^_([a-zA-Z]+)(.*)/);
    if (!m) break;
    if (!STYLE_MODIFIERS[m[1]]) break;
    styles.push(m[1]);
    rest = m[2];
  }

  return [body, accent, styles, rest];
}

/**
 * Spell out the body of a symbol name.
 *
 * The second and later subscripts of a top-level name are not part of
 * `result`: they are returned in `outerSubs`, and the caller applies them with
 * `withOuterSubscripts()` after it has wrapped `result` (for example in
 * `\operatorname{}`). See the comment where the subscripts are applied.
 *
 * A top-level name with a superscript part is the exception: all its
 * subscripts are in `result`, and `outerSubs` is empty. See
 * `scriptsInNameOrder()`.
 *
 * `prefix` is LaTeX written in front of the base of the name (the `\_` of a
 * wildcard name). It is part of `result`.
 */
function parseSymbolBody(
  s: string,
  topLevel = true,
  style: 'operator' | 'italic' | 'upright' | 'auto' | 'none' = 'auto',
  prefix = ''
): [result: string, rest: string, outerSubs: string[]] {
  // eslint-disable-next-line prefer-const
  let [body, accents, styles, rest] = parseModifiers(s);

  // The prefix is inside the accents and the styles of the base:
  // `_x_hat` is `\operatorname{\hat{\_x}}`, because
  // `\operatorname{\_\hat{x}}` does not parse.
  body = prefix + body;

  // Apply accents
  for (const accent of accents) {
    if (ACCENT_MODIFIERS[accent]) body = ACCENT_MODIFIERS[accent](body);
  }

  // Consume continuation text after unicode escapes (e.g., "abc" in "____2012abc")
  // This handles the case where specialName consumed a ____XXXX prefix and left
  // plain text in rest that isn't a modifier/subscript/superscript
  while (rest.length > 0 && !rest.startsWith('_') && !/^\d/.test(rest)) {
    const [nextSegment, nextRest] = specialName(rest);
    if (nextSegment === '' || nextRest === rest) break;
    body += nextSegment;
    rest = nextRest;
  }

  // Only the top level can have superscripts and subscripts
  let baseBody = body;
  let outerSubs: string[] = [];
  // Whether the name has a style of its own (`_bold`), which replaces the
  // default `style`.
  let explicitStyle = false;
  if (topLevel) {
    const sups: string[] = [];
    const subs: string[] = [];
    // The styles of a subscript of digits (`bold` in `x_1_bold`), and the
    // number of subscripts that the style encloses.
    let subStyles: string[] = [];
    let styledSubCount = 0;
    // The superscripts and subscripts in the order of the name. They are
    // used only for a name written in order (`ordered` below).
    const parts: NamePart[] = [];
    // The rest of the name, with each unicode escape (`____002012`) replaced
    // by one letter, so that its `____` is not read as separators.
    const plainRest = rest.replace(/____[0-9A-Fa-f]{6}/g, 'U');
    // Whether the name has a superscript part (`__`).
    const hasSupPart = /__/.test(plainRest);
    // A name with a superscript part, or with a subscript part that is a
    // symbol (`x_plus`, `x_1_dag`), is written in `\operatorname{}`, with its
    // parts in the order of the name. Without the wrapper, `x_{+}` reads back
    // as `Subplus(x)`, and a second subscript `{x_1}_{\dag}` is not read as a
    // part of the name. A name with two subscripts of digits with a style
    // (`x_1_bold_1_bold`) is written in order too:
    // `\operatorname{\mathbf{\mathbf{x_1}_1}}`.
    const ordered =
      hasSupPart ||
      SYMBOL_SUBSCRIPT.test(plainRest) ||
      (plainRest.match(STYLED_DIGIT_PART) ?? []).length > 1;

    // Check if we have a string of digits at the end of the body.
    //
    // Only a name that already uses the `_` subscript convention gets this
    // prettification: promoting the trailing digits of a PLAIN name would
    // change the symbol, since `x2` would be spelled `x_2` and read back as
    // the different symbol `x_2` (and a bare `x2` is not an option either: it
    // parses as the product `x·2`). A plain digit-suffixed name is therefore
    // spelled verbatim — upright, as `\mathrm{x2}`.
    //
    // A name that has a subscript after the digits (`x1_2`) does not get it
    // either: the digits and the subscript would be written as two nested
    // subscripts, `{x_1}_2`, which read back as the different symbol `x_1_2`.
    // Nor does a name with a style (`x1_bold`): it is written `\mathbf{x1}`,
    // because `\mathbf{x}_1` reads back as the different symbol `x_bold_1`.
    // Nor does a name with a superscript part (`x2__a`): it is written
    // `\operatorname{x2^{a}}`, because `\operatorname{{x_2}^{a}}` reads back
    // as the different symbol `x_2__a`. Nor does a name with a unicode escape
    // after the digits (`x1____002012`).
    //
    // The prefix of a wildcard name is not part of this test: `_1_2` keeps
    // `1` in its base.
    const bare = body.startsWith(prefix) ? body.slice(prefix.length) : body;
    const m =
      s.includes('_') &&
      styles.length === 0 &&
      !ordered &&
      !UNICODE_ESCAPE_START.test(rest) &&
      !/^_(?!_)/.test(rest)
        ? bare.match(/^([^\d].*?)(\d+)$/)
        : null;
    if (m) {
      subs.push(m[2]);
      body = body.slice(0, body.length - bare.length) + m[1];
    }

    while (rest.length > 0) {
      // Check for ____XXXX unicode escape (4 underscores + hex) before
      // checking __ (superscript) or _ (subscript) separators
      const ucMatch = rest.match(/^____([0-9A-Fa-f]{6})(.*)/s);
      if (ucMatch) {
        const ucHex = ucMatch[1].replace(/^0+/, '') || '0';
        let segment = `\\unicode{"${ucHex.padStart(4, '0')}}`;
        rest = ucMatch[2];
        // Consume any following text segment up to the next _ separator
        if (rest.length > 0 && !rest.startsWith('_')) {
          const [nextSegment, nextRest] = specialName(rest);
          segment += nextSegment;
          rest = nextRest;
        }
        // The escape continues the part before it, as the parser reads it:
        // `x_a____002012` is `x_{a\unicode{"2012}}` and `x__a____002012` is
        // `\operatorname{x^{a\unicode{"2012}}}`. A styled part is never
        // followed by an escape (see `styledDigitSubscript()`).
        const lastPart = parts[parts.length - 1];
        if (lastPart === undefined || lastPart.kind === 'styled')
          body += segment;
        else {
          lastPart.body += segment;
          if (lastPart.kind === '_') subs[subs.length - 1] += segment;
          else sups[sups.length - 1] += segment;
        }
      } else if (
        rest.startsWith('__') &&
        !UNICODE_ESCAPE_START.test(rest.substring(1))
      ) {
        // (A subscript that starts with a unicode escape, `_` followed by
        // `____002012`, is handled with the subscripts below.)
        //
        // A superscript of digits followed by a style (`x__10_bold`) is the
        // parse of a style written around the base and the superscript,
        // `\mathbf{x^{10}}`, for the same reason as a subscript (see below).
        const styled = styledDigitSubscript(rest.substring(1));
        if (styled && styled.styles.length === 0) {
          sups.push(styled.digits);
          parts.push({ kind: '^', body: styled.digits });
          rest = styled.rest;
          continue;
        }
        if (styled) {
          sups.push(styled.digits);
          parts.push({
            kind: 'styled',
            c: '^',
            digits: styled.digits,
            styles: styled.styles,
          });
          rest = styled.rest;
          continue;
        }
        const [sup, rest2] = parseSymbolBody(rest.substring(2), false, 'none');
        sups.push(sup);
        parts.push({ kind: '^', body: sup });
        rest = rest2;
      } else if (rest.startsWith('_')) {
        // A subscript of digits followed by a style (`x_1_bold`) is the parse
        // of a style written around the base and the subscript,
        // `\mathbf{x_1}`. It cannot be written as a styled subscript,
        // `x_{\mathbf{1}}`, because the parser spells out a styled digit:
        // `\mathbf{1}` is `one_bold`. The style is applied below, around the
        // base and the subscripts up to this one. The prefix of a wildcard
        // name is inside the style: `_x_1_bold` is
        // `\operatorname{\mathbf{\_x_1}}`.
        //
        // A name written in order (`ordered`) has none of the limits below: its
        // parts are written in order (`scriptsInNameOrder()`), so the style
        // can come after a superscript or after a style of the base:
        // `x__a_1_bold` is `\operatorname{\mathbf{x^{a}_1}}`.
        const styled =
          ordered || (sups.length === 0 && subStyles.length === 0)
            ? styledDigitSubscript(rest)
            : null;
        if (styled && styled.styles.length === 0) {
          subs.push(styled.digits);
          parts.push({ kind: '_', body: styled.digits });
          rest = styled.rest;
          continue;
        }
        if (styled) {
          subs.push(styled.digits);
          subStyles = styled.styles;
          styledSubCount = subs.length;
          parts.push({
            kind: 'styled',
            c: '_',
            digits: styled.digits,
            styles: styled.styles,
          });
          rest = styled.rest;
          continue;
        }
        const [sub, rest2] = parseSymbolBody(rest.substring(1), false, 'none');
        subs.push(sub);
        parts.push({ kind: '_', body: sub });
        rest = rest2;
      } else {
        break;
      }
    }

    // Remember the base (without sub/superscripts) so the auto font style is
    // decided from it alone: a single-token base such as `a` stays italic even
    // when it carries a subscript, so `a_1` serializes as `a_1`, not
    // `\mathrm{a_1}`. (A multi-letter base like `speed` is still wrapped, and
    // the wrapper keeps enclosing the whole symbol so descriptive subscripts
    // such as `speed_max` stay upright: `\mathrm{speed_{max}}`.)
    baseBody = body;

    // A name with a superscript part or a symbol subscript is written in
    // `\operatorname{}`, with its superscripts and subscripts in the order of
    // the name. See `scriptsInNameOrder()`. A wildcard name (the `'none'`
    // style) is wrapped in `\operatorname{}` by the caller.
    if (ordered) {
      for (const style of styles) {
        if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
      }
      body = scriptsInNameOrder(body, parts);
      if (style !== 'none') body = `\\operatorname{${body}}`;
      return [body, rest, []];
    }

    // Apply the superscripts and the first subscript.
    //
    // A symbol with two or more subscripts (`x_1_2`, which is also the
    // canonical form of `Subscript(Subscript(x, 1), 2)`) is written with
    // nested subscripts, `{x_1}_2`, and `{{x_1}_2}_3` for three. The parser
    // reads the nested form back as the same symbol. A comma list, `x_{1,2}`,
    // reads back as a different expression, `Subscript(x, Sequence(1, 2))`.
    // Neither spelling reads back when the base or a prefix of the name is an
    // indexed collection: with a matrix `A`, `{A_1}_2` is
    // `Subscript(At(A, 1), 2)`.
    //
    // The second and later subscripts are applied by the caller, outside of
    // the style wrapper below and outside of the `\operatorname{}` of a
    // wildcard name: `speed_1_2` is written `{\mathrm{speed_1}}_2`.
    //
    // A style is written around the base only, and the subscripts follow it:
    // `x_bold_1` is `\mathbf{x}_1` and `x_bold_1_2` is `{\mathbf{x}_1}_2`.
    // The parser reads a style around the base and the subscript,
    // `\mathbf{x_1}`, as the different symbol `x_1_bold`. That symbol is
    // written with the style around the base and the subscripts up to the
    // styled one, nested inside the style: `x_1_2_bold` is
    // `\mathbf{{x_1}_2}` (two subscripts in a row, `x_1_2`, are not valid
    // LaTeX).
    if (sups.length > 0) body = supsub('^', body, sups.join(','));
    if (styledSubCount > 0) {
      // A style of the base is inside the style of the subscript:
      // `x_bold_1_bold` is `\mathbf{\mathbf{x}_1}`.
      for (const style of styles) {
        if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
      }
      for (const sub of subs.slice(0, styledSubCount))
        body = nameSubscript(body, sub);
      for (const subStyle of subStyles) body = STYLE_MODIFIERS[subStyle](body);
      outerSubs = subs.slice(styledSubCount);
      explicitStyle = true;
    } else {
      for (const style of styles) {
        if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
      }
      explicitStyle = styles.length > 0;
      if (subs.length > 0) body = nameSubscript(body, subs[0]);
      outerSubs = subs.slice(1);
    }
  } else {
    for (const style of styles) {
      if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
    }
    explicitStyle = styles.length > 0;
  }

  if (!explicitStyle && style !== 'none') {
    switch (style) {
      case 'auto':
        if (countTokens(baseBody) > 1) {
          // Use \operatorname for symbols containing \unicode escapes
          // (these are named symbols, not styled text)
          if (body.includes('\\unicode')) body = `\\operatorname{${body}}`;
          else body = `\\mathrm{${body}}`;
        }
        break;
      case 'operator':
        body = `\\operatorname{${body}}`;
        break;
      case 'italic':
        body = `\\mathit{${body}}`;
        break;
      case 'upright':
        body = `\\mathrm{${body}}`;
        break;
    }
  }
  return [body, rest, outerSubs];
}

/** A superscript or a subscript of a symbol name. See `parseSymbolBody()`. */
type NamePart =
  | { kind: '^' | '_'; body: string }
  // A superscript (`c` is `^`) or a subscript (`c` is `_`) of digits
  // followed by styles (`__10_bold`, `_1_bold`). The styles enclose the base
  // and all the parts up to this one.
  | { kind: 'styled'; c: '^' | '_'; digits: string; styles: string[] };

/**
 * Write the superscripts and subscripts of a symbol name in the order of the
 * name, after `base` (the base of the name, with its prefix, accents and
 * styles).
 *
 * Inside `\operatorname{}`, the parser reads one superscript and one
 * subscript after a base, and makes the name `base__sup_sub` whatever their
 * order in the LaTeX. A brace group is a base of its own: `{x_1}^{a}` is
 * `x_1__a`. So a part is written after a new group when the part before it
 * would come after it in the name, or when it would make a double script,
 * which is not valid LaTeX:
 * - `x__a` is `x^{a}`, `x__a_1` is `x^{a}_1`;
 * - `x_1__a` is `{x_1}^{a}` (`x^{a}_1` is `x__a_1`);
 * - `x__0__plus` is `{x^0}^{+}`, `x_1_2__a` is `{{x_1}_2}^{a}`.
 *
 * A part of digits with styles puts what comes before it and the part in
 * the styles: `x__a_1_bold` is `\mathbf{x^{a}_1}`.
 */
function scriptsInNameOrder(base: string, parts: NamePart[]): string {
  // Whether the current group has a superscript or a subscript. An accent
  // can write a superscript after the base (`x_prime` is `x^{\prime}`).
  let hasSup = base.includes('^');
  let hasSub = false;
  let result = base;
  for (const part of parts) {
    const c = part.kind === 'styled' ? part.c : part.kind;
    const text = part.kind === 'styled' ? part.digits : part.body;
    if (hasSub || (c === '^' && hasSup)) {
      result = `{${result}}`;
      hasSup = false;
      hasSub = false;
    }
    result += /^[0-9]$/.test(text) ? `${c}${text}` : `${c}{${text}}`;
    if (c === '^') hasSup = true;
    else hasSub = true;
    if (part.kind === 'styled') {
      for (const style of part.styles) result = STYLE_MODIFIERS[style](result);
      hasSup = false;
      hasSub = false;
    }
  }
  return result;
}

/**
 * If `rest` starts with a subscript of digits followed by one or more styles
 * (`_1_bold`, `_12_bold_italic`), return the digits, the styles and what
 * follows them. Otherwise return `null`.
 *
 * When the only style is `upright` (`_1_upright`), the styles are empty: the
 * caller writes the digits with no style. The parser drops the upright style
 * from a name of more than one character, so `\mathrm{x_1}` reads back as
 * `x_1`, and the parser spells out a styled digit, so `x_{\mathrm{1}}` reads
 * back as `x_one`. No spelling reads back as `x_1_upright`; `x_1` is the
 * nearest one.
 */
function styledDigitSubscript(
  rest: string
): { digits: string; styles: string[]; rest: string } | null {
  const m = rest.match(/^_(\d+)((?:_[a-zA-Z]+)*)(.*)$/s);
  if (!m) return null;
  const names = m[2].split('_').slice(1);
  let count = 0;
  while (count < names.length && STYLE_MODIFIERS[names[count]]) count += 1;
  if (count === 0) return null;
  let styles = names.slice(0, count);
  if (styles.length === 1 && styles[0] === 'upright') styles = [];
  else if (styles.includes('upright')) return null;
  const after =
    names
      .slice(count)
      .map((name) => `_${name}`)
      .join('') + m[3];
  // A unicode escape right after the styles (`_1_bold____002012`) cannot be
  // written: the parser reads no text after a style command in a name.
  if (styles.length > 0 && UNICODE_ESCAPE_START.test(after)) return null;
  return { digits: m[1], styles, rest: after };
}

/**
 * A subscript of digits followed by one or more styles other than `upright`
 * (`_1_bold`). See `styledDigitSubscript()`.
 */
const STYLED_DIGIT_PART = new RegExp(
  `_\\d+(?:_(?:${Object.keys(STYLE_MODIFIERS)
    .filter((style) => style !== 'upright')
    .join('|')}))+(?![a-zA-Z0-9])`,
  'g'
);

/** A unicode escape at the start of a string of a symbol name: `____002012`. */
const UNICODE_ESCAPE_START = /^____[0-9A-Fa-f]{6}/;

/**
 * Add the subscript `sub` to the spelled-out body of a symbol name. Like
 * `supsub()`, but the `\_` of a wildcard name is not a subscript: `_x_1` is
 * `\_x_1`, not `{\_x}_1`.
 */
function nameSubscript(body: string, sub: string): string {
  if (body.replace(/\\_/g, '').includes('_')) return supsub('_', body, sub);
  return /^[0-9]$/.test(sub) ? `${body}_${sub}` : `${body}_{${sub}}`;
}

/**
 * Add the second and later subscripts of a symbol name to its spelled-out
 * body, one level of nesting each: `x_1` and `["2", "3"]` give `{{x_1}_2}_3`.
 */
function withOuterSubscripts(body: string, outerSubs: string[]): string {
  for (const sub of outerSubs) body = supsub('_', body, sub);
  return body;
}

// If the name contains an underscore, e.g.'mu_0', make sure
// to add braces.
//
// If s has a numeric prefix, put it in subscript.
//
// Other special symbols:
// 'x_012' --> `x_{012}`
// 'x012' --> `\mathrm{x012}` (a plain trailing digit run is NOT subscripted:
//            see `parseSymbolBody()`)
// 'x_"max"' --> `x_\operatorname{max}`
// '_' --> `\operatorname{\_}`
// '_a' --> `\operatorname{\_a}`
// '___a' --> `\operatorname{\_\_\_a}`
// 'alpha0' --> `\mathrm{alpha0}`
// 'alpha__beta' --> `\operatorname{\alpha^{\beta}}`
// 'alpha_beta' --> `\operatorname{\alpha_{beta}}`
// 'speed-of-sound' --> `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
// 'not[this]' --> `\mathit{\lbrace this\rbrace}`

/**
 * The `defaultMulticharStyle` indicate which style should be used to
 * wrap the symbol if it has more than one character and doesn't have a style
 * specified. This is used to display function names upright, and other
 * (single-char) symbols italic. If the style is '', the symbols is wrapped
 * in `\mathrm{...}` if it has more than one character and no other style
 * is specified.
 */
function serializeSymbol(
  s: string | null,
  style: 'operator' | 'italic' | 'upright' | 'none' | 'auto' = 'auto'
): string | null {
  if (s === null) return null;

  // If the symbol contains emojis, skip the wrapping
  if (EMOJIS.test(s)) return s;

  // If the symbol starts with one or more underscore,
  // it's a wildcard symbol and always wrapped with \operatorname{...}.
  // But ____XXXXXX (4 underscores + 6 hex digits) is a unicode escape, not a wildcard.
  const m = s.match(/^(_+)(.*)/);
  if (m && !s.match(/^____[0-9A-Fa-f]{6}/)) {
    // The prefix is part of the body: in a name with a superscript part, it
    // is inside the innermost brace group, `_x_1__a` is
    // `\operatorname{{\_x_1}^{a}}`.
    const [body, rest, outerSubs] = parseSymbolBody(
      m[2],
      true,
      'none',
      '\\_'.repeat(m[1].length)
    );
    // A text that could not be spelled out (`rest`) comes after the
    // subscripts in the name, so the subscripts stay in front of it.
    if (rest.length > 0)
      return `\\operatorname{${withOuterSubscripts(body, outerSubs) + rest}}`;
    return withOuterSubscripts(`\\operatorname{${body}}`, outerSubs);
  }

  const [body, rest, outerSubs] = parseSymbolBody(s, true, style);

  // We couldn't parse the symbol, so just wrap it in \operatorname{...}
  if (rest.length > 0) return `\\operatorname{${s}}`;

  return withOuterSubscripts(body, outerSubs);
}

export function serializeLatex(
  expr: MathJsonExpression | null,
  dict: IndexedLatexDictionary,
  options: Readonly<SerializeLatexOptions>
): string {
  const serializer = new Serializer(dict, options);
  return serializer.serialize(expr);
}

/**
 * The application `["Dictionary", ["KeyValuePair", key, value], …]` that has
 * the same entries as the dictionary object `expr`, in the same order. Each
 * key is a string.
 */
function dictionaryAsApplication(
  expr: MathJsonDictionaryObject
): MathJsonExpression {
  return [
    'Dictionary',
    ...Object.entries(expr.dict).map(
      ([key, value]) =>
        [
          'KeyValuePair',
          { str: key },
          dictionaryValueAsExpression(value),
        ] as MathJsonExpression
    ),
  ];
}

/**
 * The MathJSON expression for a value of a dictionary object. The values of a
 * `{dict: …}` object are data: a JavaScript string is a string (not a
 * symbol), an array is a list, and a boolean is `True` or `False`. This is
 * how the compute engine reads them (`dictionaryValueToBoxedExpression()` in
 * `boxed-dictionary.ts`). An object value (`{num}`, `{str}`, `{sym}`, `{fn}`,
 * `{dict}`) is a MathJSON expression already.
 */
function dictionaryValueAsExpression(
  value: DictionaryValue
): MathJsonExpression {
  if (typeof value === 'string') return { str: value };
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return value;
  if (Array.isArray(value))
    return ['List', ...value.map(dictionaryValueAsExpression)];
  return value as MathJsonExpression;
}

/**
 * A string is written `\text{…}`. When the parser reads that content as
 * something other than a string, the string is written with double quotes,
 * which the parser always reads as a string:
 * - a unit: `\text{m}` is the unit meter, `\text{m/s}` a unit quotient, and
 *   `\text{miles per hour}` a unit too (`resolveUnitText()`);
 * - a keyword: `\text{and}` is the conjunction (`isKeywordText()`).
 *
 * The test is a lookup in the unit and keyword tables, not a parse of the
 * string.
 *
 * Inside `\text{…}`, a character that LaTeX reads as a command or a
 * delimiter is escaped (`escapeText()`): `\$`, `\%`, `\{`, `\}`, `\#`, `\&`,
 * `\_`, `\textasciitilde`, `\textasciicircum`, `\textbackslash`. The parser
 * reads each escape back as the character (`parseTextRun()`). A string with
 * such a character is not written with double quotes: inside double quotes
 * these characters are not escaped (`"$"` is a syntax error).
 *
 * A control character or a private-use character is written as its code
 * point, `\char"0009{}`: TeX rejects most control characters in its input,
 * reads a tab or a line break as a space, and has no glyph for a
 * private-use character. The parser reads the code point back as the
 * character (`parseChar()`).
 */
function serializeString(s: string): string {
  if (
    !TEXT_SPECIAL_CHARACTERS.test(s) &&
    !s.includes('"') &&
    (isKeywordText(s) || resolveUnitText(s) !== null)
  )
    return `"${s}"`;
  return `\\text{${escapeText(s)}}`;
}
