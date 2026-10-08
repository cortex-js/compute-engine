/** @category Definitions */
export type Hold = 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

/**
 * An opt-in parse-time diagnostic, collected when a LaTeX string is parsed
 * with `ce.parse(latex, { diagnostics: true })` and exposed on the top-level
 * result via `BoxedExpression.parseDiagnostics`.
 *
 * Diagnostics flag *charitable* parse decisions that are usually errors in
 * machine-generated LaTeX (LLM output, OCR): a name read as multiplication
 * where the source looked like a function application, a reference to an
 * undeclared symbol, an unescaped `%` that discarded input, or trailing noise
 * silently dropped by error recovery. They are additive metadata — enabling
 * them never changes the parse output.
 *
 * ## Codes (`code`, an open enum)
 *
 * - `"undeclared-symbol"` — a parsed symbol reference resolves to no
 *   declaration (neither a parser-local binding such as a sum index, nor a
 *   definition in the engine scope). `detail: { name, type }` where `type` is
 *   the string form of the resolved type (`"unknown"`). Fires at every
 *   reference site, including plain variables like `x`.
 * - `"juxtaposition-as-multiply"` — a symbol immediately followed by a
 *   delimited group `(…)` or a matrix environment was read as multiplication
 *   rather than function application. `detail: { name, declaredAs }` with
 *   `declaredAs` one of `"unknown" | "value" | "function"`. `name` is the
 *   source symbol even when it was lexed as a unit (`\mathrm{N}(2)`) or
 *   segmented into a letter run (`divisors(60)` → `"divisors"`). When the
 *   symbol was read as a unit, `detail` additionally carries
 *   `lexedAs: "unit"`.
 * - `"ambiguous-letter-run"` — non-strict mode only: a run of two or more
 *   letters that is not a known word was read as a product of its parts
 *   (`eps` → `e·p·s`, `sinx` → `s·i·n·x`, `xpi` → `x·π`). `detail: { run,
 *   parts }` with `run` the letters as written and `parts` the MathJSON
 *   symbols it was read as. The diagnostic span is the run. Not emitted for
 *   explicit products such as `a*b*c`, nor for a run read as one name (a
 *   bare function name, a spelled-out Greek letter, a letter run before a
 *   parenthesis), nor for a differential `d` and one letter that is the
 *   numerator or denominator of a differential quotient (`dy/dx`,
 *   `\frac{dy}{dx}`). Also emitted when an unbraced superscript or
 *   subscript takes only the first letter of a run (`e^xy` → `e^x·y`,
 *   `x^ab` → `x^a·b`): the span is then the whole run, and `parts` is the
 *   script and the rest of the run as written.
 * - `"comment-discarded"` — an unescaped `%` discarded the rest of a line.
 *   `detail: { discardedLength }`.
 * - `"recovered"` — trailing tokens skipped/coerced by non-strict error
 *   recovery that do not otherwise surface as an `Error` node. `detail` may
 *   include the skipped fragment as `{ skipped }`.
 * - `"ambiguous-denominator"` — non-strict mode only: the
 *   denominator of a `/` or `÷` is an implicit product, which binds tighter
 *   than `/`. `1/2x` is read as `1/(2x)`, not `(1/2)x`. The span covers the
 *   denominator. A differential denominator (`dy/dx`) is not reported.
 * - `"ambiguous-digit-groups"` — non-strict mode only: white space between
 *   digits was read as part of one number (`2 3` → 23, `1 000` → 1000,
 *   `3 .5` → 3.5). `detail: { digits }`. Visual space commands (`1\,000`) and the `{,}`
 *   separator are not reported.
 * - `"ambiguous-letter-decimal"` — non-strict mode only: a symbol is directly
 *   followed by `.digits` (`x.5`), read as the product `x \cdot 0.5`.
 *   `detail: { name }`. The span starts at the `.`.
 * - `"ambiguous-sign"` — non-strict mode only: a prefix `±` (also spelled
 *   `\pm`, `\plusmn` or `+-`) with no left operand, read as a measurement
 *   with a nominal value of 0 where a person often means two values
 *   (`x = ±1` is read as `Measurement(0, 1)`, and `y = +-\sqrt{x}` as
 *   `Measurement(0, √x)`), a prefix `∓` (also spelled `\mp` or `-+`) with
 *   no left operand, read as `MinusPlus(0, …)` (`x = ∓1` and `-+x` are
 *   read as `MinusPlus(0, 1)` and `MinusPlus(0, x)`), or two signs in a row
 *   (`--x`, `x - -y`, `a + -b`, and `a -+ b`, which is read as
 *   `MinusPlus(a, b)`).
 *   `detail: { signs }`, the signs as written with no white space. The span
 *   covers the signs. `a +- b` with no white space is read as
 *   `Measurement(a, b)` and is not reported.
 * - Non-strict mode only, codes for a reading that has a second common
 *   reading (the reading does not change):
 *   - `"ambiguous-exponent-end"` — where an unbraced exponent ends:
 *     `e^2pi` (`e^2·π`), `e^i pi`, `e^x/2`, `x^1/2`. `detail: { exponent }`.
 *     The span is from the base to the end of the operand after the
 *     exponent: `e^2pi`.
 *   - `"ambiguous-implicit-subscript"` — a letter followed by digits is a
 *     subscript (`x2` → `x_2`), and a digit subscript ends before a letter
 *     (`x_1y` → `x_1·y`). `detail: { base?, subscript }`.
 *   - `"ambiguous-name-digits"` — letters and digits that are not a library
 *     function, before a parenthesis: `atan3(y)` → `arctan(3y)`.
 *     `detail: { name }`.
 *   - `"ambiguous-function-argument"` — a bare function name with an
 *     argument of more than one factor and no parentheses (`sin x y` →
 *     `sin(xy)`), or `log` and a number after white space (`log 2 x` →
 *     `log_2(x)`), or an argument with no parentheses that starts with `+`
 *     (`ln+1` → `ln(1)`). `detail: { function }`.
 *   - `"ambiguous-function-subscript"` — a bare function name other than
 *     `log` with a subscript, read as the strict grammar reads it:
 *     `ln_3(x)` → `Log(x, 3)`, `tan_1x` → `Apply(Subscript(Tan, 1), x)`.
 *     A person can mean a name such as `tan_1`. `detail: { name, subscript }`.
 *   - `"ambiguous-function-without-parentheses"` — a symbol declared as a
 *     function followed by an operand: `f x` → `f·x`. `detail: { name }`.
 *   - `"ambiguous-name-then-number"` — a name, white space, a number:
 *     `x 2` → `x·2`. `detail: { name }`.
 *   - `"ambiguous-delta"` — `Δ` or `Delta` followed by a letter: `Δx` →
 *     `Δ·x`.
 *   - `"ambiguous-constant-name"` — a library constant alone on the left of
 *     `=` (`e = 1.6e-19`, `pi = 3.14`), or followed by a parenthesized group
 *     on the left of `=` (`pi(x) = x` → `π·x = x`, where a person can mean
 *     the definition of a function `pi`). `detail: { name }`. Only an `=`
 *     at the top level of the line is reported: the index of
 *     `\sum_{i=1}^n` is not.
 *   - `"ambiguous-log-base"` — `log` with two arguments in parentheses:
 *     `log(x, 2)` is `Log(x, 2)`, the base second, and other tools put the
 *     base first. Also the name `lg`, which is the base-10 logarithm and,
 *     in computer science, the base-2 logarithm. `detail: { name }`.
 *   - `"ambiguous-engine-operator"` — a one-letter library operator written
 *     as a plain letter before a parenthesis, read as a call of the
 *     operator: `N(x)` (numeric evaluation), `D(x)` (derivative). A person
 *     usually means a function of their own. `\operatorname{N}(x)` is not
 *     reported. `detail: { name }`.
 *   - `"ambiguous-lookalike-letter"` — a Greek letter that looks like a
 *     Latin letter (`Α`, `Ρ`, `ο`). `detail: { letter }`.
 *   - `"ambiguous-unknown-character"` — a character that is not math, read
 *     as a string: `y = ж`. `detail: { text }`.
 *   - `"ambiguous-radical"` — the extent of `√` without braces or
 *     parentheses: `√2π` → `√2·π`, `√x²` → `(√x)²`, `3√8` → `3·√8`. The
 *     span ends after the operand that follows the radicand.
 *   - `"ambiguous-absolute-value"` — bars that pair two ways: `|x|y|z|`.
 *   - `"ambiguous-equation-number"` — a parenthesized number or letter at
 *     the end of the line, after white space, read as a factor
 *     (`y = x^2 (2)`, `x = 4 (m)`). The span is the group.
 *   - `"ambiguous-group-product"` — a parenthesized name followed by a
 *     parenthesized group with a comma, read as a product (`(x)(1,2)`).
 *   - `"ambiguous-factorial"` — `!=` directly after an operand, read as
 *     `≠` (`5!=120`). The span is the `!=`.
 *   - `"ambiguous-arrow"` — `<-`, read as `< -` (`x <- 2`).
 *   - `"ambiguous-equal-chain"` — more than one `=` in a chain
 *     (`x = x = x`). The span is from the first to the last `=`.
 *   - `"ambiguous-element"` — `in`, `\in` or `∈` whose left operand is an
 *     equation (`y = x in [0,1]`). The span is the operator.
 *   - `"ambiguous-interval"` — after `in`, `\in`, `∈` or `\notin`, a
 *     bracket pair `[a, b]` or `(a, b)`, or a range `[a..b]`, followed by
 *     an operator, so the pair is not read as an interval:
 *     `M in [0,1]^2` → `Element(M, Power(List(0, 1), 2))`. The span is the
 *     bracket pair and the operator after it, with the operand of a `^` or
 *     a `/` (`[0,1]^2`). `M in [0,1]` is not reported.
 *   - `"ambiguous-range"` — a range with two `..` (`1..10..2`), a range
 *     with one `..` next to an operation (`1..5/2`), or `...` directly
 *     followed by a digit after a decimal number (`.5...5`, which can be
 *     `.5..` and `.5`).
 *   - `"ambiguous-percent"` — a `%` after a number (`y = 50%`), which
 *     starts a comment. The span is the number and the `%`, in
 *     original-input coordinates.
 *   - `"ambiguous-comma"` — a comma outside every bracket (`1,5`).
 *   - `"ambiguous-list-label"` — a list label read as math: `1. y = x`,
 *     `x = 1. 5`, `(1) y = x`, `a) y = x`, or a line that is only `1.`,
 *     `(1)`, `(i)` or `[1]`. A letter label is one of `a` to `h`, and only
 *     when more follows it: a line that is only `(x)` is not reported.
 *   - `"ambiguous-number-notation"` — `1_000` or `0x10`.
 *     `detail: { notation }`, `"digit-grouping"` or `"hexadecimal"`.
 *   - `"ambiguous-date"` — digit groups joined by `-` or `/` that can be a
 *     date, a phone number or a range (`2026-10-15`, `9/30/2026`,
 *     `555-1234`, `7-11`). `3/4`, `2-1` and two groups in parentheses
 *     (`x = (1-10)`) are not reported.
 *
 *   Their spans use the normalized-LaTeX convention below, except
 *   `ambiguous-percent`.
 *
 * ## Span convention (`start`/`end`)
 *
 * Spans for `undeclared-symbol`, `juxtaposition-as-multiply` and every
 * `ambiguous-*` code except `ambiguous-percent` are offsets into CE's
 * **normalized** LaTeX (the
 * re-serialized token stream), which matches the original input only when
 * the input round-trips unchanged. A Unicode superscript or subscript is the
 * exception: it is measured as written, not as its expansion, so `x²! + 1`
 * reports the span `x²!` (offsets 0 to 3), not `x^{2}!`.
 * `comment-discarded` is the exception: because the comment is precisely what
 * was stripped before tokenization, its span is in **original-input**
 * coordinates. `recovered` spans are a best-effort original-input range (equal
 * to normalized coordinates for the comment-free trailing noise that recovery
 * handles). Per the ratified spec, spans are informational; policy should key
 * on `code` + `detail`.
 *
 * @category Latex Parsing and Serialization
 */
export type ParseDiagnostic = {
  /** A diagnostic code (open enum). */
  code: string;
  /** Start offset of the source span (see span convention above). */
  start: number;
  /** End offset of the source span. */
  end: number;
  /** Code-specific structured detail. */
  detail?: Record<string, unknown>;
};

/**
 * Controls how many digits a number is **displayed** with when serialized.
 *
 * This is a display/formatting concern only: it does not change the stored
 * value, nor the precision used for computation.
 *
 * - `"auto"`: round to the engine's working precision (`ce.precision`). This is
 *   the default used by the `.latex` getter.
 * - `"max"`: display all stored digits, with no rounding. This is the default
 *   used by `.json` / `toMathJson()`.
 * - `{ significant: n }`: round **inexact** values to `n` significant figures.
 *   Exact values (integers, rationals, radicals) are displayed in full — this
 *   is a no-op on them. Truncation only: trailing zeros are not padded
 *   (`2.0` stays `2`).
 * - `{ fractional: n }`: display `n` digits after the decimal point, using
 *   `toFixed` semantics (may pad with trailing zeros, e.g. `2` → `2.00`).
 *
 * Rounding is orthogonal to notation: it never switches a number to
 * scientific/exponential notation as a side effect. Fixed-vs-scientific is
 * controlled by the `notation` / `avoidExponentsInRange` options.
 *
 * @category Serialization
 */
export type DisplayDigits =
  'auto' | 'max' | { significant: number } | { fractional: number };

/**
 * Options to control serialization to MathJSON when using
 * `Expression.toMathJson()`.
 *
 * @category Serialization
 */
export type JsonSerializationOptions = {
  /**
   * If true, serialization applies readability transforms.
   * Example: `["Power", "x", 2]` -> `["Square", "x"]`.
   */
  prettify: boolean;

  /**
   * If true, a `Function` literal's parameter annotations that the engine
   * INFERRED — the element type a callback parameter takes from the
   * collection it is applied to — are included as `["Typed", param, type]`.
   *
   * By default only the annotations the author wrote are serialized: an
   * annotation marks a contract the author chose, and the serialized form of
   * a literal must not depend on what else the engine has bound.
   *
   * **Default**: `false`
   */
  inferredAnnotations?: boolean;

  /**
   * Function names to exclude from prettified output.
   * Excluded functions are replaced by equivalent non-prettified forms.
   */
  exclude: string[];

  /**
   * Which expression kinds can use shorthand output.
   *
   * **Default**: `["all"]`
   */
  shorthands: (
    'all' | 'number' | 'symbol' | 'function' | 'string' | 'dictionary'
  )[];

  /**
   * Metadata fields to include. When metadata is included, shorthand notation
   * is disabled for affected nodes.
   */
  metadata: ('all' | 'wikidata' | 'latex' | 'sourceOffsets')[];

  /**
   * If true, detect and serialize repeating decimals (for example `0.(3)`).
   *
   * **Default**: `true`
   */
  repeatingDecimal: boolean;

  /**
   * Controls how many digits a number is displayed with. See
   * {@link DisplayDigits}.
   *
   * When both `digits` and the deprecated `fractionalDigits` are provided,
   * `digits` takes precedence.
   *
   * **Default**: `"max"` for `toMathJson()`, `"auto"` for the `.latex` getter.
   */
  digits?: DisplayDigits;

  /**
   * Controls how many digits are emitted for arbitrary-precision numbers.
   *
   * - `"max"`: all available digits from the raw `BigDecimal` value,
   *   including digits beyond the working precision (no rounding).
   * - `"auto"`: round to `ce.precision` significant digits. Internally
   *   converted to `-ce.precision` (negative = total significant digits).
   * - A non-negative number: exactly that many digits after the decimal
   *   point (passed to `BigDecimal.toFixed()`).
   *
   * The `.json` property and `toJSON()` use `"max"` for lossless data
   * interchange. The `.latex` getter uses `"auto"` so that noise digits
   * from precision-bounded operations are not displayed.
   *
   * **Default**: `"max"` (when called via `toMathJson()` directly)
   *
   * @deprecated Use {@link digits} instead. `fractionalDigits: n` (n ≥ 0) maps
   * to `{ fractional: n }`, `"auto"`/`"max"` map to the same `digits` values,
   * and the internal negative-`n` overload maps to `{ significant: -n }`.
   */
  fractionalDigits: 'auto' | 'max' | number;
};

/**
 * Control how a pattern is matched to an expression.
 *
 * ## Wildcards
 * - Universal (`_` or `_name`): exactly one element
 * - Sequence (`__` or `__name`): one or more elements
 * - Optional Sequence (`___` or `___name`): zero or more elements
 *
 * @category Pattern Matching
 */
export type PatternMatchOptions<T = unknown> = {
  /**
   * Preset bindings for named wildcards. Useful to enforce consistency
   * across repeated wildcard occurrences.
   */
  substitution?: BoxedSubstitution<T>;

  /**
   * If true, match recursively in sub-expressions; otherwise only at
   * the top level.
   */
  recursive?: boolean;

  /**
   * If true, allow structurally equivalent variations to match.
   * If false, require structural identity.
   */
  useVariations?: boolean;

  /**
   * If true (default), commutative operators may match with permuted operands.
   * If false, operand order must match exactly.
   */
  matchPermutations?: boolean;

  /**
   * If true, allow matching when the expression has fewer operands than the
   * pattern by treating missing terms as identity elements (0 for `Add`,
   * 1 for `Multiply`). A free wildcard in a missing product term is set to 0
   * (since 0 × anything = 0).
   *
   * For example, `3x²+5` matches `_a·x²+_b·x+_c` with `_b = 0`.
   *
   * **Default**: `true` when the pattern is a string, `false` otherwise.
   */
  matchMissingTerms?: boolean;
};

/**
 * Options for `Expression.replace()`.
 *
 * @category Boxed Expression
 */
export type ReplaceOptions = {
  /**
   * If true, apply rules to all sub-expressions.
   * If false, only the top-level expression is considered.
   */
  recursive: boolean;

  /**
   * If true, stop after the first matching rule.
   * If false, continue applying remaining rules.
   */
  once: boolean;

  /**
   * If true, rules may match equivalent variants.
   * Can be powerful but may introduce recursion hazards.
   */
  useVariations: boolean;

  /**
   * If true (default), commutative matches may permute operands.
   * If false, matching is order-sensitive.
   */
  matchPermutations: boolean;

  /**
   * Repeat rule application up to this limit when `once` is false.
   */
  iterationLimit: number;

  /**
   * Canonical-status of replaced sub-expressions.
   *
   * Equivalent to `form`: `true` maps to `'canonical'`, `false` to `'raw'`,
   * and a `CanonicalForm` (or array of them) is used as-is. Specifying both
   * `canonical` and `form` is an error.
   *
   * @deprecated Use `form` instead, which covers a wider range of forms.
   */
  canonical?: CanonicalOptions;

  /**
   * The form (`'canonical'`, `'structural'`, `'raw'`, or specific canonical
   * transforms) applied to *replaced* sub-expressions.
   *
   * The form does not automatically apply to the entire input expression.
   * However, a non-`'raw'` form propagates upward through the expression tree:
   * an expression whose operands all share a form after replacement assumes
   * that form as well.
   *
   * To guarantee a form for the *entire* result, either ensure the input is
   * already in the requested form before replacing, or request the form on the
   * result after replacement (e.g. with `.canonical`).
   *
   * If no `form` (or `canonical`) option is specified, the form of each
   * replacement is determined by the rule itself: see `replace()`.
   *
   * Note: a `'raw'` form does not undo a form the replacement already has,
   * e.g. when a `RuleFunction` returns an expression that is already
   * canonical.
   */
  form: FormOption;

  /**
   * Traversal direction through the expression tree, for both rule matching
   * and replacement:
   *
   * - `'left-right'` (default): post-order traversal — left sub-tree first,
   *   depth-first (LRN).
   * - `'right-left'`: reverse post-order — right sub-tree first, depth-first
   *   (RLN).
   *
   * In both cases the root (input) expression is visited last.
   *
   * The direction is only observable for order-sensitive rules, e.g. a
   * `RuleFunction` whose replacements depend on visit order.
   */
  direction: 'left-right' | 'right-left';
};

/**
 * Canonical normalization transforms.
 *
 * @category Boxed Expression
 */
export type CanonicalForm =
  | 'InvisibleOperator'
  | 'Number'
  | 'Multiply'
  | 'Add'
  | 'Power'
  | 'Divide'
  | 'Flatten'
  | 'Order';

/** @category Boxed Expression */
export type CanonicalOptions = boolean | CanonicalForm | CanonicalForm[];

/**
 * Controls how expressions are created.
 *
 * @category Boxed Expression
 */
export type FormOption =
  'canonical' | 'structural' | 'raw' | CanonicalForm | CanonicalForm[];

/**
 * Metadata that can be associated with a MathJSON expression.
 *
 * @category Boxed Expression
 */
export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
  /** Zero-based, end-exclusive offsets into the original source string. */
  sourceOffsets?: [start: number, end: number] | undefined;
};

/**
 * A substitution maps wildcard symbols to bound values.
 *
 * @category Pattern Matching
 */
export type Substitution<T = unknown> = {
  [symbol: string]: T;
};

/**
 * @category Pattern Matching
 */
export type BoxedSubstitution<T = unknown> = Substitution<T>;
