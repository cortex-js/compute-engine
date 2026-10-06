import type {
  MathJsonExpression,
  ExpressionObject,
  MathJsonSymbol,
} from '../../math-json/types.js';
import {
  CLOSE_DELIMITER_PREFIX,
  DELIMITER_SHORTHAND,
  OPEN_DELIMITER_PREFIX,
} from './delimiter-tables.js';
export {
  CLOSE_DELIMITER_PREFIX,
  DELIMITER_SHORTHAND,
  OPEN_DELIMITER_PREFIX,
} from './delimiter-tables.js';
import {
  foldAssociativeOperator,
  getSequence,
  missingIfEmpty,
  nops,
  operator,
  operands,
  operand,
  isEmptySequence,
  matchesSymbol,
  symbol,
  stringValue,
  matchesString,
  matchesNumber,
} from '../../math-json/utils.js';

import {
  ParseLatexOptions,
  LatexToken,
  Delimiter,
  Terminator,
  Parser,
  INVISIBLE_OP_PRECEDENCE,
  MULTIPLICATION_PRECEDENCE,
  SymbolTable,
  newSymbolIds,
} from './types.js';
import type { ParseDiagnostic } from '../types-kernel-serialization.js';
import { tokenize, tokensToString } from './tokenizer.js';
import type { DiscardedComment } from './tokenizer.js';
import {
  parseSymbol,
  parseInvalidSymbol,
  absorbSubscripts,
} from './parse-symbol.js';
import type {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
  IndexedInfixEntry,
  IndexedPostfixEntry,
  IndexedPrefixEntry,
  IndexedSymbolEntry,
  IndexedExpressionEntry,
  IndexedFunctionEntry,
  IndexedEnvironmentEntry,
  IndexedMatchfixEntry,
} from './dictionary/definitions.js';
import {
  parseNumber as _parseNumber,
  parseRepeatingDecimal as _parseRepeatingDecimal,
  type NumberFormatTokens,
} from './parse-number.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { TypeString } from '../types.js';
import {
  isNumberLiteralFactor,
  normalizeContinuationRanges,
} from './dictionary/definitions-core.js';
import { ApplicationPolicy } from './application-policy.js';
import { continuationRanges } from './range-provenance.js';
import {
  getSymbolToUnicode,
  isGroupProductShape,
  isOperandStartToken,
  layoutOf,
  numberBeforePercent,
  openingParenthesisBefore,
  operandEnd,
  reportLineAmbiguities,
} from './lenient-ambiguity.js';

/**
 * A collected parse diagnostic with its internal monotonic sequence id. The
 * `_seq` field is used for seq-based checkpoints (see `_Parser.diagnostics`)
 * and is stripped before the diagnostic is forwarded to the sink, so the
 * public {@link ParseDiagnostic} shape is preserved.
 */
type CollectedDiagnostic = ParseDiagnostic & {
  _seq: number;
  /** The normalized-LaTeX offset that decides whether a rewind of the
   * parser removes the diagnostic (see `set index`), when it is not the
   * `start` of the span. A diagnostic whose span starts before the tokens
   * that the parser read for it (the span of `ambiguous-exponent-end` starts
   * at the base, the exponent is read later) sets it to the start of those
   * tokens, so that a rewind to before them still removes it. */
  _anchor?: number;
};

/** Does the index symbol `index` occur anywhere in `expr`? A fused compound
 * symbol (`a_n`) counts as mentioning its subscript token. */
function mentionsIndex(
  expr: MathJsonExpression | null,
  index: MathJsonSymbol
): boolean {
  if (expr === null) return false;
  if (typeof expr === 'string')
    return expr === index || expr.split('_').includes(index);
  if (Array.isArray(expr)) return expr.some((e) => mentionsIndex(e, index));
  return false;
}

/** Rewrite subscripted symbols that reference the sequence index into the
 * operator-call form (`a_n` → `["a_", "n"]`, `["Subscript","b",i+s]` →
 * `["b_", i+s]`) so the index binding survives symbol fusion. Subexpressions
 * that don't mention the index are left untouched. */
function liftIndexBinding(
  expr: MathJsonExpression,
  index: MathJsonSymbol
): MathJsonExpression {
  // Fused compound symbol `X_Y` whose subscript is exactly the index.
  if (typeof expr === 'string') {
    const i = expr.indexOf('_');
    if (i > 0 && expr.substring(i + 1) === index)
      return [expr.substring(0, i) + '_', index];
    return expr;
  }
  if (!Array.isArray(expr)) return expr;

  // Explicit `Subscript(base, sub)` on a plain symbol whose subscript
  // references the index (e.g. `b_{i+s}`).
  if (
    operator(expr) === 'Subscript' &&
    typeof operand(expr, 1) === 'string' &&
    mentionsIndex(operand(expr, 2), index)
  ) {
    const base = operand(expr, 1) as string;
    return [base + '_', liftIndexBinding(operand(expr, 2)!, index)];
  }

  // Otherwise recurse into operands, leaving the operator head untouched.
  return [
    expr[0],
    ...expr
      .slice(1)
      .map((o) => liftIndexBinding(o as MathJsonExpression, index)),
  ] as MathJsonExpression;
}

/** Least element of a set symbol, for mapping `n \in \mathbb{N}` subscripts to
 * a lower bound. Returns `undefined` when the set has no clear least element
 * (we don't guess in that case). */
function setLeastElement(set: MathJsonExpression | null): number | undefined {
  if (set === 'NonNegativeIntegers') return 0;
  if (set === 'PositiveIntegers') return 1;
  return undefined;
}

/** Rewrite a scripted `\{…\}` (Set) into the inert `IndexedSequence` head when
 * it carries an index-binding subscript. Both shapes produced by the parser
 * are recognized (regardless of `_`/`^` order):
 *   - `["Subscript", ["Set", term], sub]`               (subscript only)
 *   - `["Power", ["Subscript", ["Set", term], sub], up]` (with upper bound)
 * where `sub` is `Equal(index, lower)` or `Element(index, set)`. Returns the
 * expression unchanged if it is not a sequence-braces pattern. */
function parseIndexedSequence(expr: MathJsonExpression): MathJsonExpression {
  let upper: MathJsonExpression | undefined;
  let inner: MathJsonExpression | null = expr;
  if (operator(expr) === 'Power') {
    upper = operand(expr, 2) ?? undefined;
    inner = operand(expr, 1);
  }
  if (inner === null || operator(inner) !== 'Subscript') return expr;

  const setNode = operand(inner, 1);
  if (
    setNode === null ||
    operator(setNode) !== 'Set' ||
    (operands(setNode)?.length ?? 0) !== 1
  )
    return expr;

  const sub = operand(inner, 2);
  if (sub === null) return expr;

  let index: MathJsonSymbol | undefined;
  let lower: MathJsonExpression | undefined;
  if (operator(sub) === 'Equal') {
    const i = operand(sub, 1);
    if (typeof i !== 'string') return expr;
    index = i;
    lower = operand(sub, 2) ?? undefined;
  } else if (operator(sub) === 'Element') {
    const i = operand(sub, 1);
    if (typeof i !== 'string') return expr;
    const least = setLeastElement(operand(sub, 2));
    if (least === undefined) return expr; // no clear least element — don't guess
    index = i;
    lower = least;
  } else {
    return expr;
  }

  if (index === undefined || lower === undefined) return expr;

  const term = liftIndexBinding(operand(setNode, 1)!, index);
  return upper === undefined
    ? ['IndexedSequence', term, index, lower]
    : ['IndexedSequence', term, index, lower, upper];
}

/** The single order expression a norm subscript carries, or `null` when the
 * subscript is not one expression. A parenthesized order (`‖v‖_{(p+1)}`)
 * arrives wrapped in a `Delimiter`, which holds a `Sequence` as soon as the
 * parentheses contain several items (`‖v‖_{1,2}`); a bracketed `‖v‖_{[1,2]}`
 * is a list, which is never an order. */
function normOrderOperand(sub: MathJsonExpression): MathJsonExpression | null {
  if (operator(sub) === 'List') return null;

  let order = operator(sub) === 'Delimiter' ? operand(sub, 1) : sub;
  if (order === null) return null;

  if (operator(order) === 'Sequence') {
    const items = operands(order) ?? [];
    if (items.length !== 1) return null;
    order = items[0];
  }

  return order;
}

/** Rewrite a subscripted norm into the two-operand `Norm` form: a subscript on
 * `‖v‖` is the ORDER of the norm, not an index. `‖v‖_1` is the L1 norm,
 * `‖v‖_\infty` the maximum norm, `‖v‖_F` the Frobenius norm and `‖v‖_p` the
 * p-norm; `‖v‖` with no subscript stays the 2-norm. `Norm` spells the
 * Frobenius order as the string `"Frobenius"`, so the `F` subscript is
 * translated. All the delimiter spellings (`\Vert`, `\lVert`/`\rVert`, `\|`,
 * `||` and the `Vmatrix` environment) reach this point as the same
 * `["Subscript", ["Norm", v], order]` shape.
 *
 * A superscript is applied AFTER the subscript, so a raised norm arrives as
 * `["Power", ["Subscript", ["Norm", v], order], exponent]`: the power is
 * unwrapped and rebuilt around the rewritten norm, which is what makes
 * `‖v‖_1^2` the square of the L1 norm rather than a norm with its order
 * discarded. A norm that already carries an order is left alone. */
function parseNormOrder(expr: MathJsonExpression): MathJsonExpression {
  let exponent: MathJsonExpression | undefined;
  let inner: MathJsonExpression = expr;
  if (operator(expr) === 'Power') {
    const base = operand(expr, 1);
    const up = operand(expr, 2);
    if (base === null || up === null) return expr;
    inner = base;
    exponent = up;
  }

  if (operator(inner) !== 'Subscript') return expr;
  const norm = operand(inner, 1);
  if (norm === null || operator(norm) !== 'Norm') return expr;
  if ((operands(norm)?.length ?? 0) !== 1) return expr;

  const sub = operand(inner, 2);
  if (sub === null) return expr;
  const order = normOrderOperand(sub);
  if (order === null) return expr;

  const result: MathJsonExpression = [
    'Norm',
    operand(norm, 1)!,
    symbol(order) === 'F' ? { str: 'Frobenius' } : order,
  ];

  return exponent === undefined ? result : ['Power', result, exponent];
}

/** Tokens that cannot begin the braces-less argument of a LaTeX command
 * (e.g. `\frac12`). See `parseToken()`. */
const PARSE_TOKEN_EXCLUDED = new Set<string>([
  ...'!"#$%&(),/;:?@[]\\`|~'.split(''),
  '\\left',
  '\\bigl',
  '\\mleft',
]);

/** Commands that produce visual space, skipped by `skipVisualSpace()` */
const VISUAL_SPACE_COMMANDS = new Set<string>([
  '\\!',
  '\\,',
  '\\:',
  '\\;',
  '\\enskip',
  '\\enspace',
  '\\space',
  '\\quad',
  '\\qquad',
]);

/** Two-letter TeX units (as token sequences) accepted after `\hskip` and
 * `\kern`. See `skipVisualSpace()`. */
const TEX_UNIT_TOKENS: readonly string[][] = [
  'pt',
  'em',
  'mu',
  'ex',
  'mm',
  'cm',
  'in',
  'bp',
  'sp',
  'dd',
  'cc',
  'pc',
  'nc',
  'nd',
].map((unit) => [...unit]);

/**
 * The number of a run of decimal digits, with no loss: a run that a
 * JavaScript number cannot hold exactly (`9007199254740993`) is a number
 * string, `{ num: digits }`.
 */
function digitRunNumber(digits: string): MathJsonExpression {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : { num: digits };
}

/**
 * Whether the tokens `tokens` are only prime marks and white space, in any
 * spelling that the parser reads as a prime: `'`, `\prime`, `\doubleprime`,
 * `\tripleprime`, a `^` followed by one of these commands (`^\prime`), or a
 * `^` followed by a braced run of these commands (`^{\prime}`,
 * `^{\prime\prime}`, `^{\doubleprime}`). The serializer writes a prime as
 * `^{\prime}`.
 */
function isPrimeMarkSpan(tokens: readonly LatexToken[]): boolean {
  const isPrimeCommand = (t: LatexToken | undefined) =>
    t === '\\prime' || t === '\\doubleprime' || t === '\\tripleprime';
  let i = 0;
  const skipSpace = () => {
    while (tokens[i] === '<space>') i++;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '<space>' || t === "'" || isPrimeCommand(t)) {
      i++;
      continue;
    }
    if (t !== '^') return false;
    i++;
    skipSpace();
    if (isPrimeCommand(tokens[i])) {
      i++;
      continue;
    }
    if (tokens[i] !== '<{>') return false;
    i++;
    skipSpace();
    if (!isPrimeCommand(tokens[i])) return false;
    while (isPrimeCommand(tokens[i])) {
      i++;
      skipSpace();
    }
    if (tokens[i] !== '<}>') return false;
    i++;
  }
  return true;
}

/** Map of common bare function names (e.g. `sin(x)` without a backslash,
 * accepted in non-strict mode) to their MathJSON operator.
 * See `tryParseBareFunction()`. */
const BARE_FUNCTION_MAP: Record<string, string> = {
  // Trigonometric
  sin: 'Sin',
  cos: 'Cos',
  tan: 'Tan',
  cot: 'Cot',
  sec: 'Sec',
  csc: 'Csc',
  // Hyperbolic
  sinh: 'Sinh',
  cosh: 'Cosh',
  tanh: 'Tanh',
  coth: 'Coth',
  sech: 'Sech',
  csch: 'Csch',
  // Inverse trigonometric
  arcsin: 'Arcsin',
  arccos: 'Arccos',
  arctan: 'Arctan',
  arccot: 'Arccot',
  arcsec: 'Arcsec',
  arccsc: 'Arccsc',
  asin: 'Arcsin',
  acos: 'Arccos',
  atan: 'Arctan',
  acot: 'Arccot',
  asec: 'Arcsec',
  acsc: 'Arccsc',
  atan2: 'Arctan2', // Two-argument arctangent. Letter+digit name; see
  // the longest-match in `tryParseBareFunction` (so `atan2(1,2)` is
  // `Arctan2(1,2)`, not `Arctan` applied to `2·(1,2)`).
  // Inverse hyperbolic
  arcsinh: 'Arsinh',
  arccosh: 'Arcosh',
  arctanh: 'Artanh',
  arccoth: 'Arcoth',
  arcsech: 'Arsech',
  arccsch: 'Arcsch',
  asinh: 'Arsinh',
  acosh: 'Arcosh',
  atanh: 'Artanh',
  // Logarithms and exponentials
  log: 'Log',
  ln: 'Ln',
  exp: 'Exp',
  lg: 'Lg',
  lb: 'Lb',
  // Other common functions
  sqrt: 'Sqrt',
  abs: 'Abs',
  sgn: 'Sign',
  sign: 'Sign',
  floor: 'Floor',
  ceil: 'Ceil',
  round: 'Round',
  max: 'Max',
  min: 'Min',
  gcd: 'Gcd',
  lcm: 'Lcm',
  // Roots
  cbrt: 'Root', // Special-cased in `tryParseBareFunction` to add index 3
  // Combinatorics
  binom: 'Binomial',
  nCr: 'Binomial',
  nPr: 'Permutations', // Special-cased in `tryParseBareFunction`:
  // `nPr(n, k)` → the k-permutation count P(n, k) = C(n, k)·k!
};

/** Bare function names that are read as a function only when a parenthesis
 * follows them, in non-strict mode: `mod(x, 2)` is `Mod(x, 2)` and `Re(z)`
 * is `Real(z)`. Without a parenthesis these words keep their reading as
 * letters (`7 mod 3` is a product), because they are also common words or
 * symbol names. See `tryParseBareFunction()`. */
const PARENTHESIZED_BARE_FUNCTION_MAP: Record<string, string> = {
  mod: 'Mod',
  pow: 'Power',
  trunc: 'Truncate',
  Re: 'Real',
  Im: 'Imaginary',
};

/** The Greek letters that look the same as a Latin letter: the capitals
 * Alpha, Beta, Epsilon, Zeta, Eta, Iota, Kappa, Mu, Nu, Omicron, Rho, Tau,
 * Upsilon and Chi, and the small omicron. Text pasted from a document can
 * hold one of these where the writer meant the Latin letter. */
const LOOKALIKE_GREEK_LETTERS: ReadonlySet<string> = new Set([
  'Α',
  'Β',
  'Ε',
  'Ζ',
  'Η',
  'Ι',
  'Κ',
  'Μ',
  'Ν',
  'Ο',
  'Ρ',
  'Τ',
  'Υ',
  'Χ',
  'ο',
]);

/** The raw MathJSON names of the library constants that a person often uses
 * as a variable name on the left of `=`: `e`, `i`, `π` and infinity. */
const CONSTANT_NAMES_ON_LEFT_OF_EQUAL: ReadonlySet<string> = new Set([
  'e',
  'ExponentialE',
  'i',
  'ImaginaryUnit',
  'Pi',
  'PositiveInfinity',
]);

/** The library operators whose name is one letter: `D` (the derivative) and
 * `N` (the numeric evaluation). The parser does not read them as function
 * names (see `isFunctionOperator()`). Before a parenthesis they are still
 * read as a call, by the rule for a single capital letter (see
 * `looksLikePredicate()`), and the lenient grammar then reports an
 * `ambiguous-engine-operator` diagnostic. */
const ONE_LETTER_LIBRARY_OPERATORS: ReadonlySet<string> = new Set(['D', 'N']);

/** Mapping of special tokens to their LaTeX string, as used by
 * `tokensToString()`. Used by `lookAhead()` to build lookahead strings
 * incrementally. */
const LOOKAHEAD_TOKEN_TO_STRING: Record<string, string> = {
  '<space>': ' ',
  '<$$>': '$$',
  '<$>': '$',
  '<{>': '{',
  '<}>': '}',
};

/** Commands that can be used with a middle delimiter */
// const MIDDLE_DELIMITER_PREFIX = [
//   '\\middle',
//   '\\bigm',
//   '\\Bigm',
//   '\\biggm',
//   '\\Biggm',
//   '\\big',
//   '\\Big',
//   '\\bigg',
//   '\\Bigg',
// ];

/**
 * Map open delimiters to a matching close delimiter
 */
const CLOSE_DELIMITER: Record<string, string> = {
  '(': ')',
  '[': ']',
  '|': '|',
  '\\{': '\\}',
  '\\[': '\\]',
  '\\lbrace': '\\rbrace',
  '\\lparen': '\\rparen',
  '\\langle': '\\rangle',
  '\\lfloor': '\\rfloor',
  '\\lceil': '\\rceil',
  '\\vert': '\\vert',
  '\\lvert': '\\rvert',
  '\\Vert': '\\Vert',
  '\\lVert': '\\rVert',
  '\\|': '\\|',
  '\\lbrack': '\\rbrack',
  '\\ulcorner': '\\urcorner',
  '\\llcorner': '\\lrcorner',
  '\\lgroup': '\\rgroup',
  '\\lmoustache': '\\rmoustache',
  '\\llbracket': '\\rrbracket',
};

/**
 * The vertical-bar delimiter commands. Unlike a parenthesis or a bracket,
 * each of these spells its own closing delimiter, so a nested absolute value
 * or norm puts two of them side by side (`\vert x-\vert y\vert\vert`).
 * `parseEnclosure()` copes with that by re-parsing the body without its close
 * boundary and matching the boundary afterwards, which only works if a bar
 * that no enclosure claimed stops the expression parse instead of being
 * consumed. A bare `|` stops it because it is not a command; these spellings
 * must behave the same, so `parsePrimary()` does not gobble them as an
 * unknown command.
 */
const BAR_DELIMITER_COMMANDS = new Set<string>([
  '\\vert',
  '\\lvert',
  '\\rvert',
  '\\Vert',
  '\\lVert',
  '\\rVert',
  '\\|',
]);

/**
 * True for the value of a bracketed group that is a collection: a list
 * (`[1,2]`), a comprehension (`[u+1 \operatorname{for} u = L]`) or a range
 * (`[1...5]`). `parseBrackets()` returns a comprehension or a range as is, not
 * wrapped in a `List`. A bracket that opens something else, such as the
 * half-open interval `[1,2)`, is not a collection.
 */
function isBracketCollection(
  expr: MathJsonExpression | null | undefined
): boolean {
  const h = operator(expr);
  return (
    h === 'List' || h === 'Comprehension' || h === 'Range' || h === 'Linspace'
  );
}

/**
 * True when every token of a close boundary is a vertical bar (either the
 * bare `|` or one of the commands above).
 *
 * Such a boundary is ambiguous: the same token also opens an absolute value
 * or a norm, so an occurrence of it inside a brace group or at the start of
 * an enclosure body can be the opening of a nested enclosure rather than the
 * close of the enclosure that owns the boundary. A boundary with a closing
 * spelling of its own — `)`, `\end{cases}`, `\right\vert` — is never
 * ambiguous that way, so it stays visible and a runaway parse still stops
 * on it.
 */
function isBarBoundary(tokens: LatexToken[]): boolean {
  return tokens.every((tok) => tok === '|' || BAR_DELIMITER_COMMANDS.has(tok));
}

function describeTypeCallbackResult(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof BoxedType) return 'BoxedType';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    const ctor = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    if (ctor && ctor !== 'Object') return ctor;
    return 'object';
  }
  return `${typeof value} (${String(value)})`;
}

/**
 * ## THEORY OF OPERATIONS
 *
 * The parser is a recursive descent parser that uses a dictionary of
 * LaTeX commands to parse a LaTeX string into a MathJSON expression.
 *
 * The parser is a stateful object that keeps track of the current position
 * in the token stream, and the boundaries of the current parsing operation.
 *
 * To parse correctly some constructs, the parser needs to know the context
 * in which it is parsing. For example, parsing `k(2+x)` can be interpreted
 * as a function `k` applied to the sum of `2` and `x`, or as the product
 * of `k` and the sum of `2` and `x`. The parser needs to know that `k` is
 * a function to interpret the expression as a function application.
 *
 * The parser uses the current state of the compute engine, and any
 * symbol that may have been declared, to determine the correct
 * interpretation.
 *
 * Some constructs declare variables or functions while parsing. For example,
 * `\sum_{i=1}^n i` declares the variable `i` as the index of the sum.
 *
 * The parser keeps track of the parsing state with a stack of symbol tables.
 *
 * In addition, the `resolveSymbol()` handler is consulted when the parser
 * encounters a symbol the symbol tables don't know. It reports what the
 * ambient environment (e.g. the engine scope) knows about the symbol, or
 * `undefined` if the symbol is undeclared.
 *
 * Some functions affect the state of the parser:
 * - `Declare`, `Assign` modify the symbol table
 * - `Block` create a new symbol table (local scope)
 * - `Function` create a new symbol table with named arguments
 *
 *
 */
export class _Parser implements Parser {
  readonly options: Readonly<ParseLatexOptions>;

  private _applicationPolicy?: ApplicationPolicy;

  resolveApplications(expr: MathJsonExpression): MathJsonExpression {
    return this._applicationPolicy?.finish(expr) ?? expr;
  }

  _isApplicationCandidate(expr: MathJsonExpression): boolean {
    return this._applicationPolicy?.has(expr) ?? false;
  }

  _index = 0;

  symbolTable: SymbolTable = {
    parent: null,
    ids: newSymbolIds(),
  };

  pushSymbolTable(): void {
    this._symbolTableGen += 1;
    this.symbolTable = { parent: this.symbolTable, ids: newSymbolIds() };
  }

  popSymbolTable(): void {
    this._symbolTableGen += 1;
    this.symbolTable = this.symbolTable.parent ?? this.symbolTable;
  }

  addSymbol(id: string, type: BoxedType | TypeString): void {
    this._symbolTableGen += 1;
    if (typeof type === 'string') type = new BoxedType(type);
    // Conflict only when re-declaring with a *different* type. The check was
    // inverted (`.is()` is type-equality), so re-declaring with the same type
    // threw while a genuinely different type silently overwrote.
    if (id in this.symbolTable.ids && !this.symbolTable.ids[id].is(type.type))
      throw new Error(`Symbol ${id} already declared as a different type`);
    this.symbolTable.ids[id] = type;
  }

  // Track whether we're currently speculatively parsing the body of a
  // reversed-bracket ISO interval (`]a, b[`, open `]`/`\rbrack`). Because that
  // matchfix opens on `]` — a token that also closes ordinary index brackets
  // (`a[6]`) — a stray `]` triggers a speculative body parse of everything
  // ahead. Left unbounded, nested `]` tokens make each speculation spawn
  // another over the same tail: exponential. A genuine `]a, b[` body holds only
  // its two endpoints (no inner `]`), so forbidding re-entry caps the nesting
  // at depth 1 without rejecting any valid interval. See parseEnclosure.
  private _reversedIntervalDepth = 0;

  // A run of two or more letters that `tryParseBareRun()` left to the
  // per-letter path, so that `parsePrimary()` can report it as a
  // `ambiguous-letter-run` diagnostic. Only set when diagnostics are enabled.
  private _splitLetterRun: { name: string; start: number } | null = null;

  // Track whether we're inside a quantifier body (ForAll, Exists, etc.)
  // When true, single uppercase letters followed by () are parsed as predicates
  private _quantifierScopeDepth = 0;

  get inQuantifierScope(): boolean {
    return this._quantifierScopeDepth > 0;
  }

  enterQuantifierScope(): void {
    this._quantifierScopeDepth++;
  }

  exitQuantifierScope(): void {
    if (this._quantifierScopeDepth > 0) this._quantifierScopeDepth--;
  }

  get index(): number {
    return this._index;
  }
  set index(val: number) {
    // Structural diagnostics auto-prune on backtrack. Backtracking is
    // `parser.index = savedStart` in any parselet; when the parser rewinds
    // (`val < this._index`), every diagnostic whose span *starts* at or after
    // the rewind point was emitted by the branch now being abandoned. Drop
    // those — the adopted reparse re-emits whatever still applies. This makes
    // rejected-branch diagnostics self-cleaning, with no per-site rollback
    // convention to forget.
    //
    // Known imperfection: a diagnostic whose span starts *before* the rewind
    // point but extends past it survives — only start-at-or-after entries are
    // provably from the abandoned branch. Diagnostic `start`s are not monotone
    // in the array (`_pruneUndeclared` splices from the middle, and retro spans
    // exist), so the whole array is filtered, not truncated from the end.
    //
    // The `diagnostics === null` fast path keeps normal parsing (the flag off)
    // free of any overhead; the scan is O(#diagnostics) and only on regression.
    if (
      this.diagnostics !== null &&
      this.diagnostics.length > 0 &&
      val < this._index
    ) {
      const offsets = this.tokenPrefixOffsets();
      const cutoff = offsets[Math.max(0, Math.min(val, this._tokens.length))];
      const d = this.diagnostics;
      let w = 0;
      for (let r = 0; r < d.length; r++) {
        // drop abandoned-branch entry
        if ((d[r]._anchor ?? d[r].start) >= cutoff) continue;
        d[w++] = d[r];
      }
      d.length = w;
    }
    this._index = val;
    this._lastPeek = '';
    this._peekCounter = 0;
  }

  private _tokens: LatexToken[];

  private _positiveInfinityTokens: LatexToken[];
  private _negativeInfinityTokens: LatexToken[];
  private _notANumberTokens: LatexToken[];
  private _decimalSeparatorTokens: LatexToken[];
  private _wholeDigitGroupSeparatorTokens: LatexToken[];
  private _fractionalDigitGroupSeparatorTokens: LatexToken[];
  private _exponentProductTokens: LatexToken[];
  private _beginExponentMarkerTokens: LatexToken[];
  private _endExponentMarkerTokens: LatexToken[];
  private _truncationMarkerTokens: LatexToken[];
  private _imaginaryUnitTokens: LatexToken[];
  private readonly _dictionary: IndexedLatexDictionary;

  // A parsing boundary is a sequence of tokens that indicate that a
  // recursive parsing operation should stop.
  // In a traditional parser, keeping track of parsing boundaries would
  // not be necessary. However, because we attempt to deliver the best
  // interpretation of a partial expression, boundaries allow us to fail
  // parsing more locally.
  // For example, in `\begin{cases} | \end{cases}`, without boundary
  // detection, the parsing of `|` would attempt to goble up `\end{cases}`
  // which would be interpreted as an unexpected command, and the whole `\begin`
  // would be rejected as an unbalanced environment. With `\end{cases}` as a
  // boundary, the parsing of the `|` argument stops as soon as it encounters
  // the `\end{cases}` and can properly report an unexpected token on the `|`
  // only while correctly interpreting the `\begin{cases}...\end{cases}`
  //
  // A boundary with a `minIndex` is inert while the current token index is
  // below it. `parseEnclosure` uses that to re-read an apparently empty body
  // (`\vert\vert x\vert-1\vert`): the delimiter at the start of the body is
  // held to be the opening of a nested enclosure, so the boundary must not
  // match it, while every later occurrence still closes the body.
  private _boundaries: {
    index: number;
    tokens: LatexToken[];
    minIndex?: number;
  }[] = [];

  /**
   * Index of the lowest entry of `_boundaries` that `atBoundary` matches
   * without restriction. An entry below the barrier belongs to an enclosure
   * started outside the brace group or body currently being parsed, and is
   * hidden only when it is spelled with vertical bars (`isBarBoundary`): a
   * bar met inside opens a nested absolute value instead of closing the outer
   * one. An entry with a closing spelling of its own — `\end{cases}`, `)` —
   * stays visible, so an unclosed group still stops on it instead of running
   * to the end of the input. `parseGroup` and the re-read of an apparently
   * empty enclosure body raise the barrier and restore it afterwards.
   */
  private _boundaryBarrier = 0;

  // Those two properties are used to detect infinite loops while parsing
  private _lastPeek = '';
  private _peekCounter = 0;

  // Cache for `lookAhead()`: the token stream and the dictionary are
  // immutable, so the result only depends on the current index
  private _lookAheadCache: [count: number, tokens: string][] | null = null;
  private _lookAheadIndex = -1;

  // Cache for `sourceOffsets()`: cumulative character offset of each token
  // prefix. Entry `k` is the length of `tokensToString(this._tokens.slice(0,
  // k))`, so the array has `this._tokens.length + 1` entries. The token stream
  // is immutable, so this is built once on demand.
  private _tokenPrefixOffsets: number[] | null = null;
  // The character offset at which the text of each token starts, after the
  // space that separates a command from a letter. Built with
  // `_tokenPrefixOffsets` (see `tokenPrefixOffsets()`).
  private _tokenStartOffsets: number[] | null = null;

  // Cache for the speculative `parseSymbol()` performed by the
  // `symbolTrigger` path of `peekDefinitions()`. The parsed candidate
  // depends only on the (immutable) token stream, the position, and the
  // symbol table (tracked by `_symbolTableGen` — the ambient environment
  // consulted via `options.resolveSymbol` is stable for the duration of a
  // parse), so it can be reused across the several
  // `peekDefinitions()` calls made at the same position (once per kind).
  private _symbolTableGen = 0;
  private _symCandidateIndex = -1;
  private _symCandidateGen = -1;
  private _symCandidate: string | null = null;
  private _symCandidateCount = 0;

  // Opt-in parse diagnostics (codes `undeclared-symbol`,
  // `juxtaposition-as-multiply`, `ambiguous-letter-run`, …). Non-null only when
  // `options.diagnostics` is enabled; `emitDiagnostic` is a no-op otherwise.
  //
  // Each collected entry carries an internal monotonic `_seq` id (assigned in
  // emission order and never reused). Checkpoints are seq *values*, not array
  // positions, so `_rollbackDiagnostics`/`_pruneUndeclared` are robust to the
  // index-setter auto-prune deleting entries from the middle of the array (a
  // length-based checkpoint would silently mis-target after such a deletion).
  // `_seq` is stripped before a diagnostic reaches the sink — the public
  // `ParseDiagnostic` shape is unchanged.
  readonly diagnostics: CollectedDiagnostic[] | null;
  private _diagnosticSeq = 0;

  // True when the diagnostics are collected only to apply
  // `onAmbiguity: 'error'` (the lenient grammar with `diagnostics` off). Then
  // only the `ambiguous-*` codes are kept, and the symbol lookups of the
  // `undeclared-symbol` code are skipped.
  private readonly _ambiguityOnly: boolean;

  // With `onAmbiguity: 'error'` in the lenient grammar, the source span
  // (normalized-LaTeX character offsets) of each expression that `decorate()`
  // receives. `ambiguityErrors()` uses these spans to find the smallest
  // expression that holds the span of an `ambiguous-*` diagnostic. Arrays and
  // objects are keyed by identity. A number or a string has no identity, so
  // it is recorded with its value in `_primitiveSpans`. Both are `null` when
  // the option is not active.
  readonly _exprSpans: WeakMap<object, [number, number]> | null;
  readonly _primitiveSpans:
    { value: number | string; start: number; end: number }[] | null;

  /**
   * Record a parse diagnostic spanning `[startToken, endToken)` (token
   * indices, mapped to normalized-LaTeX character offsets via
   * `sourceOffsets`). No-op unless diagnostics collection is enabled.
   */
  emitDiagnostic(
    code: string,
    startToken: number,
    endToken: number,
    detail?: Record<string, unknown>
  ): void {
    if (this.diagnostics === null) return;
    if (this._ambiguityOnly && !code.startsWith('ambiguous-')) return;
    const [start, end] = this.sourceOffsets(startToken, endToken);
    const _seq = this._diagnosticSeq++;
    this.diagnostics.push(
      detail !== undefined
        ? { code, start, end, detail, _seq }
        : { code, start, end, _seq }
    );
  }

  /**
   * In non-strict mode, record a diagnostic whose code starts with
   * `ambiguous-`: the text in the tokens `[startToken, endToken)` has a
   * second common reading, and the parser kept the first one. The reading
   * does not change. In strict mode, and when diagnostics are off, this does
   * nothing. A diagnostic with the same code and the same span as one that
   * is already recorded is not recorded again, because a parselet can read
   * the same text more than once before the parse settles.
   *
   * A diagnostic recorded by a branch that the parser then abandons is
   * removed when the parser rewinds to before its span (see `set index`).
   * When the span starts before the tokens that the branch read, pass the
   * first of those tokens as `anchorToken`: a rewind to before
   * `anchorToken` then removes the diagnostic.
   */
  _emitAmbiguity(
    code: string,
    startToken: number,
    endToken: number,
    detail?: Record<string, unknown>,
    anchorToken?: number
  ): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const [start, end] = this.sourceOffsets(startToken, endToken);
    if (
      this.diagnostics.some(
        (d) => d.code === code && d.start === start && d.end === end
      )
    )
      return;
    const count = this.diagnostics.length;
    this.emitDiagnostic(code, startToken, endToken, detail);
    if (anchorToken !== undefined && this.diagnostics.length > count)
      this.diagnostics[this.diagnostics.length - 1]._anchor =
        this.sourceOffsets(anchorToken, anchorToken)[0];
  }

  /**
   * A checkpoint for {@link _rollbackDiagnostics} / {@link _pruneUndeclared}: the
   * next sequence id to be assigned. Every diagnostic collected *after* this
   * call has `_seq >= checkpoint`. Seq-based (not a length), so it stays valid
   * even if the index-setter auto-prune later deletes entries.
   */
  _diagnosticsCheckpoint(): number {
    return this._diagnosticSeq;
  }

  /**
   * Discard every diagnostic collected since `checkpoint` (a value returned by
   * {@link _diagnosticsCheckpoint}) — i.e. every entry with `_seq >= checkpoint`.
   * Used to unwind diagnostics emitted while speculatively parsing a branch the
   * parser then backtracks out of.
   */
  _rollbackDiagnostics(checkpoint: number): void {
    if (this.diagnostics === null) return;
    const d = this.diagnostics;
    let w = 0;
    for (let r = 0; r < d.length; r++)
      if (d[r]._seq < checkpoint) d[w++] = d[r];
    d.length = w;
  }

  /**
   * In non-strict mode, record the `ambiguous-*` diagnostics that a check of
   * the whole line finds (see `reportLineAmbiguities()` in
   * `lenient-ambiguity.ts`). Call it once, on the parser whose result is
   * adopted, with that raw result. `skippedTail` is the text that the
   * trailing-noise recovery removed, if any. No-op unless diagnostics are
   * enabled.
   */
  _reportLineAmbiguities(
    expr: MathJsonExpression | null,
    skippedTail?: string
  ): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    reportLineAmbiguities(
      this._tokens,
      expr,
      (code, start, end, detail) =>
        this._emitAmbiguity(code, start, end, detail),
      skippedTail,
      (word) => Object.prototype.hasOwnProperty.call(BARE_FUNCTION_MAP, word)
    );
  }

  /**
   * Retroactively remove `undeclared-symbol` diagnostics for bound variables
   * `names`, collected at or after `checkpoint` (`_seq >= checkpoint`). Called
   * by binder parselets once the bound names are known.
   *
   * Pruning is **span-aware** (A-3): a reference is removed only when it is
   * genuinely in the binder's scope — either within the construct's **body**
   * (`start >= bodyStart`, in normalized char offsets) or within one of the
   * explicit **declaration** spans `declSpans` (the index variable's own
   * occurrence in a subscript). References that share the name but sit in a
   * *limit/bound/domain* sub-expression outside those regions stay flagged: in
   * `\int_x^1 x\,dx` the lower-bound `x` is free and must fire, even though the
   * integrand/differential `x` is bound.
   *
   * With no `bodyStart` (the default), pruning is name-wide since the
   * checkpoint — correct for binders whose bound names have no competing free
   * occurrence (`\mapsto`/`:=` parameters, quantified variables).
   *
   * `bodyStart` / `declSpans` are given as **token** indices and mapped to char
   * offsets here. Diagnostics-only — never affects parse output.
   */
  _pruneUndeclared(
    names: Iterable<string>,
    checkpoint: number,
    bodyStartToken?: number,
    declSpanTokens?: readonly [number, number][]
  ): void {
    if (this.diagnostics === null) return;
    const set = names instanceof Set ? names : new Set(names);
    if (set.size === 0) return;

    // Register each deliberately-processed bound name: the post-check in
    // `ce.parse()` exempts these from its bound-only assertion, since any
    // surviving diagnostic for them is a deliberately-kept free occurrence
    // (span-aware pruning), not a missing-wiring gap.
    if (this.options.onBoundVariable)
      for (const name of set) this.options.onBoundVariable(name);

    const offsets = this.tokenPrefixOffsets();
    const n = this._tokens.length;
    const toOffset = (t: number): number =>
      offsets[Math.max(0, Math.min(t, n))];
    // No body start → prune every name-match since the checkpoint (name-wide).
    const bodyStart =
      bodyStartToken === undefined ? -Infinity : toOffset(bodyStartToken);
    const declSpans = (declSpanTokens ?? []).map(
      ([a, b]) => [toOffset(a), toOffset(b)] as const
    );

    const d = this.diagnostics;
    let w = 0;
    for (let r = 0; r < d.length; r++) {
      const e = d[r];
      const name = e.detail?.name;
      const isBoundName =
        e.code === 'undeclared-symbol' &&
        e._seq >= checkpoint &&
        typeof name === 'string' &&
        set.has(name);
      if (isBoundName) {
        const inBody = e.start >= bodyStart;
        const inDecl = declSpans.some(([a, b]) => e.start >= a && e.start < b);
        if (inBody || inDecl) continue; // drop bound reference
      }
      d[w++] = e;
    }
    d.length = w;
  }

  /**
   * Retroactively remove `juxtaposition-as-multiply` diagnostics for the head
   * `name`, collected at or after `checkpoint` (`_seq >= checkpoint`). Called by
   * parselets that consume an application-shaped left operand as a function
   * signature (e.g. `f(x) := …`): the `f(x)` shape is a definition, not a
   * multiplication, so the code-2 diagnostic emitted while `f(x)` was parsed as
   * a neutral juxtaposition is a false positive. Diagnostics-only — never
   * affects parse output.
   */
  _pruneJuxtaposition(name: string, checkpoint: number): void {
    if (this.diagnostics === null) return;
    const d = this.diagnostics;
    let w = 0;
    for (let r = 0; r < d.length; r++) {
      const e = d[r];
      if (
        e.code === 'juxtaposition-as-multiply' &&
        e._seq >= checkpoint &&
        e.detail?.name === name
      )
        continue; // drop the spurious multiplication diagnostic
      d[w++] = e;
    }
    d.length = w;
  }

  /**
   * The diagnostics checkpoint captured just before the left operand of the
   * innermost in-progress {@link parseExpression} was parsed. Infix binder
   * parselets (notably `\mapsto`, whose parameter is the already-parsed left
   * operand) use it to {@link _pruneUndeclared} bound-parameter references that
   * were emitted for that operand.
   */
  get operandDiagnosticCheckpoint(): number {
    return this._operandDiagnosticCheckpoint;
  }
  private _operandDiagnosticCheckpoint = 0;

  /**
   * The token index at which the left operand of the innermost in-progress
   * {@link parseExpression} began. Infix parselets receive their left operand
   * already parsed, so this is the only way for them to inspect how it was
   * SPELLED: the set operators use it to tell an ambiguous bracket pair
   * (`[1, 2]`, re-read as an `Interval`) from an explicitly named
   * `\operatorname{List}(1, 2)` (which stays a `List`).
   */
  get operandStartIndex(): number {
    return this._operandStartIndex;
  }
  private _operandStartIndex = 0;

  // The token index at which the primary whose postfix operators and
  // scripts are being read started (`e` in `e^2pi`), or -1 outside of that
  // step of `parsePrimary()`. The span of the `ambiguous-exponent-end`
  // diagnostic starts there.
  private _scriptBaseStart = -1;

  // The token index at which the primary being read by `parsePrimary()`
  // started. A function name parselet calls `parseArguments('implicit')`
  // from inside that primary, before any nested primary is read, so the
  // value is the start of the function name (`\sin`, `\operatorname{arctg}`,
  // the bare word `tan`): the span of the `ambiguous-factorial` diagnostic
  // of `\sin x !` starts there.
  private _primaryStart = -1;

  // The last symbol read by `parseSymbol()` from a spelling that takes a
  // subscript into the symbol name (`x_1`, `\alpha_{01}`, `\pi_0`): its
  // token span, its name, and the diagnostics sequence numbers before and
  // after it was read (see `_diagnosticsCheckpoint()`). `parseSupsub()`
  // uses it to read a subscript after a superscript (`x^2_{01}`) as the
  // symbol parser reads a subscript before it (`x_{01}^2`).
  private _subscriptableSymbol: {
    start: number;
    end: number;
    id: string;
    seqStart: number;
    seqEnd: number;
  } | null = null;

  // The token index of a spelled-out name at the end of a run of letters,
  // which `tryParseBareRun()` did not read because a script follows it
  // (`alpha` in `xalpha_1`), or of the letters after an argument of one
  // letter that `parseToken()` read (`alpha` in `e^xalpha_1`), or -1.
  // `tryParseBareSymbol()` reads a name at this index although a letter
  // comes before it.
  private _bareNameStart = -1;

  // The token index of the letters after an argument of one letter that
  // `parseToken()` read, when these letters are a bare function name
  // (`sin` in `e^xsin(t)`), or -1. `tryParseBareFunction()` reads a name at
  // this index although a letter comes before it.
  private _bareFunctionStart = -1;

  // The bracket nesting level of each token (see `layoutOf()` in
  // `lenient-ambiguity.ts`), computed on first use. The token stream does
  // not change, so it is computed once.
  private _tokenDepths: number[] | null = null;

  /**
   * The number of brackets and braces that are open at token `i`: 0 at the
   * top level of the line, 1 inside `(…)`, `[…]` or `{…}`, and so on.
   */
  private tokenDepth(i: number): number {
    this._tokenDepths ??= layoutOf(this._tokens).depth;
    return this._tokenDepths[i] ?? 0;
  }

  get ownedChain(): MathJsonExpression | null {
    return this._ownedChain;
  }
  /**
   * The chain array most recently produced by `_appendAssociativeOperand` at
   * the current `parseExpression` level. `parseExpression` saves and restores
   * it around its body, so a nested parse (an infix parser's right operand)
   * cannot make the outer loop forget — or wrongly claim — its own chain.
   */
  private _ownedChain: MathJsonExpression | null = null;

  /**
   * See `Parser._appendAssociativeOperand`. Why the in-place append is safe:
   * `lhs` is only extended when it is the very array this parser returned from
   * its previous append at this expression level. That array was handed to
   * the infix loop as its new `lhs`, and until the loop hands it on — to the
   * next infix parser (which extends it again) or as an operand of a larger
   * expression (after which it is never `lhs` again) — the loop holds the
   * only reference to it. A chain that reached the parser some other way — a
   * constant array from a dictionary entry, the result of a custom `parse`
   * handler, an array from an earlier parse — is not the owned chain, so it
   * is copied exactly as `foldAssociativeOperator` does and never mutated.
   *
   * Why: the infix loop parses a flat chain iteratively, handing the
   * accumulated `Add` back to the `+` parser at every step. Copying it each
   * time is O(k) work and allocation per operator, O(n²) for the chain — a
   * 12 000-term sum spent ~40% of its raw-parse time and most of its GC in
   * that copy.
   */
  _appendAssociativeOperand(
    op: string,
    lhs: MathJsonExpression,
    rhs: MathJsonExpression
  ): MathJsonExpression {
    if (lhs === this._ownedChain && Array.isArray(lhs) && lhs[0] === op) {
      const chain = lhs as unknown as MathJsonExpression[];
      if (operator(rhs) === op) chain.push(...operands(rhs));
      else chain.push(rhs);
      return lhs;
    }
    const result = foldAssociativeOperator(op, lhs, rhs);
    this._ownedChain = result;
    return result;
  }

  /**
   * The single symbol oracle (see {@link Parser.resolveSymbol}): parser-local
   * bindings — sum indices, `Block`/`Function` parameters, tracked in
   * `symbolTable` — merged over the `resolveSymbol` option handler.
   * `undefined` means undeclared; declaration *presence* is distinct from
   * type knowledge (a declared symbol may resolve with an `unknown` type).
   */
  resolveSymbol(
    id: MathJsonSymbol
  ):
    | { type: BoxedType; subscriptEvaluate?: boolean; inferred?: boolean }
    | undefined {
    // Parser-local bindings shadow the ambient environment
    let table: SymbolTable | null = this.symbolTable;
    while (table) {
      if (id in table.ids) return { type: table.ids[id] };
      table = table.parent;
    }

    const info = this.options.resolveSymbol?.(id);
    if (info === undefined || info === null) return undefined;

    // Both branches carry the record's other fields (`subscriptEvaluate`)
    // through unchanged; only `type` is normalized to a BoxedType.
    const type = info.type;
    if (type instanceof BoxedType)
      return info as { type: BoxedType; subscriptEvaluate?: boolean };

    if (typeof type === 'string') {
      try {
        return { ...info, type: new BoxedType(type) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `ce.parse(): resolveSymbol("${id}") returned invalid type string "${type}". ${message}`
        );
      }
    }

    throw new Error(
      `ce.parse(): resolveSymbol("${id}") must return a \`type\` that is a BoxedType or a type string, received ${describeTypeCallbackResult(
        type
      )}`
    );
  }

  /**
   * Whether `name` is claimed by a `kind: 'function'` dictionary entry's
   * `symbolTrigger` (`log`, `lcm`, `var`, …). Such a name owns its call
   * syntax — including any subscript, which its parser may bind as an
   * argument (`\operatorname{log}_2(x)` is `Log(x, 2)`) — so subscript
   * absorption must not fold `name_sub` into a plain symbol and preempt the
   * function reading (`peekDefinitions('function')` matches the
   * speculatively parsed symbol against the trigger map, and an absorbed
   * `log_2` candidate would miss the `log` claim).
   */
  isFunctionTriggerName(name: string): boolean {
    return (
      this._dictionary.symbolTriggerDefs.get('function')?.has(name) ?? false
    );
  }

  /**
   * Shared emission point for a symbol *reference*: records an
   * `undeclared-symbol` diagnostic iff `id` does not resolve (see
   * {@link resolveSymbol}). No-op unless diagnostics are enabled. Every
   * parser path that yields a bare symbol reference routes through here so no
   * charitable interpretation escapes the diagnostic.
   */
  emitSymbolReference(
    id: MathJsonSymbol,
    startToken: number,
    endToken: number
  ): void {
    if (this.diagnostics === null || this._ambiguityOnly) return;
    // An unresolved symbol has, by definition, no known type: `resolveSymbol`
    // reports a record (with a type) for every declared symbol.
    if (this.resolveSymbol(id) === undefined)
      this.emitDiagnostic('undeclared-symbol', startToken, endToken, {
        name: id,
        type: 'unknown',
      });
  }

  constructor(
    tokens: LatexToken[],
    dictionary: IndexedLatexDictionary,
    options: Readonly<ParseLatexOptions>
  ) {
    this._tokens = tokens;
    this.options = options;
    this._dictionary = dictionary;
    // `onAmbiguity: 'error'` needs the `ambiguous-*` diagnostics of the
    // lenient grammar even when `diagnostics` is off.
    const ambiguityErrors =
      options.strict === false && options.onAmbiguity === 'error';
    this._ambiguityOnly = ambiguityErrors && !options.diagnostics;
    this.diagnostics = options.diagnostics || ambiguityErrors ? [] : null;
    this._exprSpans = ambiguityErrors ? new WeakMap() : null;
    this._primitiveSpans = ambiguityErrors ? [] : null;

    this._positiveInfinityTokens = tokenize(this.options.positiveInfinity);
    this._negativeInfinityTokens = tokenize(this.options.negativeInfinity);
    this._notANumberTokens = tokenize(this.options.notANumber);
    this._decimalSeparatorTokens = tokenize(this.options.decimalSeparator);

    this._wholeDigitGroupSeparatorTokens = [];
    this._fractionalDigitGroupSeparatorTokens = [];
    if (this.options.digitGroupSeparator) {
      if (typeof this.options.digitGroupSeparator === 'string') {
        this._wholeDigitGroupSeparatorTokens = tokenize(
          this.options.digitGroupSeparator
        );
        this._fractionalDigitGroupSeparatorTokens =
          this._wholeDigitGroupSeparatorTokens;
      } else if (Array.isArray(this.options.digitGroupSeparator)) {
        this._wholeDigitGroupSeparatorTokens = tokenize(
          this.options.digitGroupSeparator[0]
        );
        this._fractionalDigitGroupSeparatorTokens = tokenize(
          this.options.digitGroupSeparator[1]
        );
      }
    }

    this._exponentProductTokens = tokenize(this.options.exponentProduct);
    this._beginExponentMarkerTokens = tokenize(
      this.options.beginExponentMarker
    );
    this._endExponentMarkerTokens = tokenize(this.options.endExponentMarker);
    this._truncationMarkerTokens = tokenize(this.options.truncationMarker);
    this._imaginaryUnitTokens = tokenize(this.options.imaginaryUnit);

    this._numberFormatTokens = {
      decimalSeparatorTokens: this._decimalSeparatorTokens,
      wholeDigitGroupSeparatorTokens: this._wholeDigitGroupSeparatorTokens,
      fractionalDigitGroupSeparatorTokens:
        this._fractionalDigitGroupSeparatorTokens,
      exponentProductTokens: this._exponentProductTokens,
      beginExponentMarkerTokens: this._beginExponentMarkerTokens,
      endExponentMarkerTokens: this._endExponentMarkerTokens,
      truncationMarkerTokens: this._truncationMarkerTokens,
    };
  }

  private _numberFormatTokens!: NumberFormatTokens;

  get peek(): LatexToken {
    const peek = this._tokens[this.index];
    if (peek === this._lastPeek) this._peekCounter += 1;
    else this._peekCounter = 0;
    if (this._peekCounter >= 1024) {
      const msg = `Infinite loop detected while parsing "${this.latex(
        0
      )}" at "${this._lastPeek}" (index ${this.index})`;
      console.error(msg);
      throw new Error(msg);
    }
    this._lastPeek = peek;
    return peek;
  }

  nextToken(): LatexToken {
    return this._tokens[this.index++];
  }

  get atEnd(): boolean {
    return this.index >= this._tokens.length;
  }

  /**
   * Return true if
   * - at end of the token stream
   * - the `t.condition` function returns true
   * Note: the `minPrec` condition is not checked. It should be checked separately.
   */
  atTerminator(t?: Readonly<Terminator>): boolean {
    return this.atBoundary || ((t?.condition && t.condition(this)) ?? false);
  }

  /**
   * True if the current token matches any of the boundaries we are
   * waiting for.
   */
  get atBoundary(): boolean {
    if (this.atEnd) return true;
    const start = this.index;
    for (let i = 0; i < this._boundaries.length; i++) {
      const boundary = this._boundaries[i];
      if (i < this._boundaryBarrier && isBarBoundary(boundary.tokens)) continue;
      if (boundary.minIndex !== undefined && start < boundary.minIndex)
        continue;
      if (this.matchBoundaryTokens(boundary.tokens)) {
        this.index = start;
        return true;
      }
    }
    return false;
  }

  /**
   * Like `matchAll()`, but also accepts a TeX *null delimiter* as the close of
   * a `\left`-style enclosure: a two-token close boundary `[closePrefix, X]`
   * (e.g. `['\\right', ')']`) is matched by `[closePrefix, '.']` in the input
   * (e.g. `\right.`). This makes one-sided enclosures such as
   * `\left(x\right.` parse instead of erroring on the unmatched `\left`.
   */
  matchBoundaryTokens(tokens: LatexToken[]): boolean {
    if (this.matchAll(tokens)) return true;
    if (
      tokens.length === 2 &&
      CLOSE_DELIMITER_PREFIX.has(tokens[0]) &&
      this._tokens[this.index] === tokens[0] &&
      this._tokens[this.index + 1] === '.'
    ) {
      this.index += 2;
      return true;
    }
    return false;
  }

  addBoundary(boundary: LatexToken[], minIndex?: number): void {
    this._boundaries.push({ index: this.index, tokens: boundary, minIndex });
  }

  removeBoundary(): void {
    this._boundaries.pop();
  }

  matchBoundary(): boolean {
    const currentBoundary = this._boundaries[this._boundaries.length - 1];
    if (
      currentBoundary?.minIndex !== undefined &&
      this.index < currentBoundary.minIndex
    )
      return false;
    const match =
      currentBoundary && this.matchBoundaryTokens(currentBoundary.tokens);
    if (match) this._boundaries.pop();
    return match;
  }

  boundaryError(
    msg: string | [string, ...MathJsonExpression[]]
  ): MathJsonExpression {
    const currentBoundary = this._boundaries[this._boundaries.length - 1];
    this._boundaries.pop();
    return this.error(msg, currentBoundary.index);
  }

  /**
   * Performance optimization: determines if we can skip expensive re-parsing
   * for matchfix boundary mismatches.
   *
   * We skip re-parsing only for specific non-ambiguous cases where we know
   * the boundary mismatch is due to trying interval notation on regular parens.
   * For example, trying (] on input () - we can safely skip without re-parsing.
   *
   * All other cases (including |, [, and other delimiters) require re-parsing
   * to handle nested delimiters correctly.
   */
  private canSkipMatchfixReparsing(
    openTrigger: string | undefined,
    boundary: LatexToken[],
    sameTrigger: boolean
  ): boolean {
    if (sameTrigger) return false; // Not same open/close (e.g., not ||)
    if (boundary.length !== 1) return false; // No prefix like \right

    // Mismatched-bracket interval notations: when the bounded body parse
    // failed to land on the close delimiter, the input is not one of these
    // intervals, so the boundary-less re-parse only over-consumes. Skipping it
    // also avoids exponential blowup: a stray delimiter that recurs many times
    // (e.g. the `]` closing each `a[6]` index, whose At-postfix swallows the
    // `[` this interval def expected as its close) would otherwise re-parse the
    // whole tail unbounded at every occurrence. A genuine interval matches its
    // close on the first (bounded) parse and never reaches here.

    // `(a, b]` — `(` open expecting `]` close (e.g. input `()`).
    if (
      (openTrigger === '(' || openTrigger === '\\lparen') &&
      (boundary[0] === ']' || boundary[0] === '\\rbrack')
    )
      return true;

    // `]a, b[` — reversed-bracket ISO interval, `]` open expecting `[` close.
    if (
      (openTrigger === ']' || openTrigger === '\\rbrack') &&
      (boundary[0] === '[' || boundary[0] === '\\lbrack')
    )
      return true;

    return false;
  }

  latex(start: number, end?: number): string {
    return tokensToString(this._tokens.slice(start, end));
  }

  sourceOffsets(
    startToken: number,
    endToken: number = this.index
  ): [start: number, end: number] {
    // Map token indices to character offsets in the serialized LaTeX. The
    // cumulative prefix lengths are computed once and cached (the token stream
    // is immutable), so each call is O(1) instead of re-serializing the prefix
    // on every error. For input that round-trips through `tokensToString`
    // unchanged (e.g. editor-generated LaTeX, which has no comments or Unicode
    // normalization), these offsets match the original input string.
    const offsets = this.tokenPrefixOffsets();
    const n = this._tokens.length;
    // A span starts at the text of its first token, after the space that
    // separates a command from a letter (`\alpha y`: a span that starts at
    // `y` starts after the space), and ends at the end of the text of its
    // last token, before such a space.
    const first = Math.max(0, Math.min(startToken, n));
    const start = first < n ? this._tokenStartOffsets![first] : offsets[first];
    const end = offsets[Math.max(0, Math.min(endToken, n))];
    return start <= end ? [start, end] : [end, start];
  }

  /**
   * Cumulative character offsets of the token prefixes, built once and cached.
   * Entry `k` is the length of `tokensToString(this._tokens.slice(0, k))`.
   *
   * This replicates the `tokensToString()`/`joinLatex()` join semantics in a
   * single pass (the same approach as `lookAhead()`), so all prefix lengths are
   * available in O(1) without re-joining a token slice for each lookup.
   */
  private tokenPrefixOffsets(): number[] {
    if (this._tokenPrefixOffsets !== null) return this._tokenPrefixOffsets;

    const tokens = this._tokens;
    const offsets = new Array<number>(tokens.length + 1);
    const starts = new Array<number>(tokens.length);
    offsets[0] = 0;
    let len = 0;
    let sep = '';
    for (let i = 0; i < tokens.length; i++) {
      const segment = LOOKAHEAD_TOKEN_TO_STRING[tokens[i]] ?? tokens[i];
      // If the segment begins with a char that *could* be in a command name,
      // insert the pending separator (see `joinLatex()`)
      if (/[a-zA-Z]/.test(segment[0])) len += sep.length;
      // The text of token `i` starts after that separator
      starts[i] = len;
      // If the segment ends in a command, a space precedes the next segment
      sep = /\\[a-zA-Z]+\*?$/.test(segment) ? ' ' : '';
      len += segment.length;
      offsets[i + 1] = len;
    }

    this._tokenPrefixOffsets = offsets;
    this._tokenStartOffsets = starts;
    return offsets;
  }

  // latexBefore(): string {
  //   return this.latex(0, this.index);
  // }
  // latexAfter(): string {
  //   return this.latex(this.index);
  // }

  /**
   * Return the LaTeX tokens ahead, joined incrementally: at most as many
   * tokens as the longest dictionary trigger starting with the current
   * token (see `triggerStartMax`), and none if no trigger starts with it.
   *
   * The index in the returned array correspond to the number of tokens.
   * Note that since a token can be longer than one char ('\\pi', but also
   * some astral plane unicode characters), the length of the string
   * does not match that index. However, knowing the index is important
   * to know by how many tokens to advance.
   *
   * For example:
   *
   * `[empty, '\\sqrt', '\\sqrt{', '\\sqrt{2', '\\sqrt{2}']`
   *
   */
  lookAhead(): [count: number, tokens: string][] {
    // The result depends only on the (immutable) token stream, the current
    // index and the (immutable) dictionary: cache it keyed on the index.
    // `peekDefinitions()` is called several times at the same position
    // (once per kind), so the cache hit rate is high.
    if (this._lookAheadIndex === this.index && this._lookAheadCache !== null)
      return this._lookAheadCache;

    // Bound the lookahead by the longest trigger that starts with the
    // current token (`triggerStartMax` is precomputed at indexing time).
    // Most tokens start no trigger at all, in which case the lookahead is
    // empty and no trigger can match.
    const maxN =
      this._dictionary.triggerStartMax.get(this._tokens[this.index]) ?? 0;
    const n = Math.min(maxN, this._tokens.length - this.index);

    const result: [number, string][] = [];

    // Build the lookahead strings incrementally (replicating the
    // `tokensToString()`/`joinLatex()` semantics) rather than re-joining
    // the token slice from scratch for each length.
    let s = '';
    let sep = '';
    for (let i = 0; i < n; i++) {
      const token = this._tokens[this.index + i];
      const segment = LOOKAHEAD_TOKEN_TO_STRING[token] ?? token;
      // If the segment begins with a char that *could* be in a command
      // name, insert the pending separator (see `joinLatex()`)
      if (/[a-zA-Z]/.test(segment[0])) s += sep;
      // If the segment ends in a command, add a space before the next one
      sep = /\\[a-zA-Z]+\*?$/.test(segment) ? ' ' : '';
      s += segment;
      // Entries are ordered by decreasing token count
      result[n - 1 - i] = [i + 1, s];
    }

    this._lookAheadCache = result;
    this._lookAheadIndex = this.index;

    return result;
  }

  /** Return all the definitions that match the tokens ahead
   *
   * The return value is an array of pairs `[def, n]` where `def` is the
   * definition that matches the tokens ahead, and `n` is the number of tokens
   * that matched.
   *
   * Note the 'operator' kind matches both infix, prefix and postfix operators.
   *
   */
  peekDefinitions(kind: 'expression'): [IndexedExpressionEntry, number][];
  peekDefinitions(kind: 'function'): [IndexedFunctionEntry, number][];
  peekDefinitions(kind: 'symbol'): [IndexedSymbolEntry, number][];
  peekDefinitions(kind: 'postfix'): [IndexedPostfixEntry, number][];
  peekDefinitions(kind: 'infix'): [IndexedInfixEntry, number][];
  peekDefinitions(kind: 'prefix'): [IndexedPrefixEntry, number][];
  peekDefinitions(
    kind: 'operator'
  ): [IndexedInfixEntry | IndexedPrefixEntry | IndexedPostfixEntry, number][];
  peekDefinitions(
    kind:
      | 'expression'
      | 'function'
      | 'symbol'
      | 'infix'
      | 'prefix'
      | 'postfix'
      | 'operator'
  ): [IndexedLatexDictionaryEntry, number][] {
    if (this.atEnd) return [];

    const result: [IndexedLatexDictionaryEntry, number][] = [];
    const dictionary = this._dictionary;

    // Get the appropriate trigger index for this kind
    let triggerIndex: Map<string, IndexedLatexDictionaryEntry[]>;

    switch (kind) {
      case 'infix':
        triggerIndex = dictionary.infixByTrigger;
        break;
      case 'prefix':
        triggerIndex = dictionary.prefixByTrigger;
        break;
      case 'postfix':
        triggerIndex = dictionary.postfixByTrigger;
        break;
      case 'function':
        triggerIndex = dictionary.functionByTrigger;
        break;
      case 'symbol':
        triggerIndex = dictionary.symbolByTrigger;
        break;
      case 'expression':
        triggerIndex = dictionary.expressionByTrigger;
        break;
      case 'operator':
        triggerIndex = dictionary.operatorByTrigger;
        break;
    }

    // 1. Universal definitions (empty `latexTrigger`), precomputed at
    //    indexing time, in priority order
    const universalDefs = dictionary.universalDefs.get(kind);
    if (universalDefs) for (const def of universalDefs) result.push([def, 0]);

    // 2. Direct index lookup for latexTrigger matches - O(lookahead)
    for (const [n, tokens] of this.lookAhead()) {
      const defs = triggerIndex.get(tokens);
      if (defs) {
        for (const def of defs) result.push([def, n]);
      }
    }

    // 3. symbolTrigger definitions: speculatively parse the symbol ahead
    //    *once*, then look it up in the trigger map precomputed at indexing
    //    time (instead of one speculative parse per symbolTrigger def)
    const symbolTriggerDefs = dictionary.symbolTriggerDefs.get(kind);
    if (symbolTriggerDefs) {
      let candidate: string | null;
      let n: number;
      if (
        this._symCandidateIndex === this.index &&
        this._symCandidateGen === this._symbolTableGen
      ) {
        // Reuse the candidate speculatively parsed at this position by a
        // previous call (typically for another kind)
        candidate = this._symCandidate;
        n = this._symCandidateCount;
      } else {
        const start = this.index;
        candidate = parseSymbol(this)?.trim() ?? null;
        n = this.index - start;
        this.index = start;
        this._symCandidateIndex = start;
        this._symCandidateGen = this._symbolTableGen;
        this._symCandidate = candidate;
        this._symCandidateCount = n;
      }
      if (candidate && n > 0) {
        const defs = symbolTriggerDefs.get(candidate);
        if (defs) for (const def of defs) result.push([def, n]);
      }
    }

    return result;
  }

  /** Skip strictly `<space>` tokens.
   * To also skip `{}` see `skipSpace()`.
   * To skip visual space (e.g. `\,`) see `skipVisualSpace()`.
   */
  skipSpaceTokens(): void {
    while (this.match('<space>')) {}
  }

  /** While parsing in math mode, skip applicable spaces, which includes `{}`.
   * Do not use to skip spaces while parsing a string. See  `skipSpaceTokens()`
   * instead.
   */
  skipSpace(): boolean {
    // Check if there is a `{}` token sequence.
    // Those are used in LaTeX to force an invisible separation between commands
    // and are considered skipable space.
    if (!this.atEnd && this.peek === '<{>') {
      const index = this.index;
      this.nextToken();
      while (this.match('<space>')) {}
      if (this.nextToken() === '<}>') {
        this.skipSpace();
        return true;
      }

      this.index = index;
    }

    if (!this.options.skipSpace) return false;
    let found = false;
    while (this.match('<space>')) found = true;
    if (found) this.skipSpace();

    return found;
  }

  /**
   * Skip the white space before a script. A spacing command (`\,`, `\;`,
   * `\quad`, `\hspace{1em}`) is skipped only when a `_` or a `^` follows it:
   * it is then white space before the script, and not the base of the
   * script. So `x\,_{01}` is read as `x _{01}`, not as a subscript of the
   * space. Otherwise the index does not move past the spacing command.
   */
  private skipSpaceBeforeScript(): void {
    this.skipSpace();
    const start = this.index;
    this.skipVisualSpace();
    if (this.peek !== '_' && this.peek !== '^' && !this.atDoubleStar())
      this.index = start;
  }

  skipVisualSpace(): void {
    if (!this.options.skipSpace) return;

    this.skipSpace();

    if (VISUAL_SPACE_COMMANDS.has(this.peek)) {
      this.nextToken();
      this.skipVisualSpace();
    }

    // \hspace{dim} and \hspace*{dim}
    if (this.match('\\hspace')) {
      this.match('*');
      this.parseStringGroup(); // consumes {content}
      this.skipVisualSpace();
    }

    // \hskip <glue> and \kern <glue> take an inline dimension
    // (e.g., \hskip5pt, \kern-3mu)
    // Each character is a separate token from the tokenizer.
    if (this.match('\\hskip') || this.match('\\kern')) {
      this.skipSpace();
      // Skip optional sign
      if (!this.match('-')) this.match('+');
      // Skip digits and decimal point
      while (/^[\d.]$/.test(this.peek)) this.nextToken();
      // Try to match a known two-letter TeX unit
      for (const unit of TEX_UNIT_TOKENS) {
        if (this.matchAll(unit)) break;
      }
      this.skipVisualSpace();
    }

    this.skipSpace();
  }

  match(token: LatexToken): boolean {
    if (this._tokens[this.index] !== token) return false;
    this.index++;
    return true;
  }

  matchAll(tokens: LatexToken[]): boolean {
    if (tokens.length === 0) return false;

    let matched: boolean;
    let i = 0;
    do {
      matched = this._tokens[this.index + i] === tokens[i++];
    } while (matched && i < tokens.length);
    if (matched) this.index += i;

    return matched;
  }

  matchAny(tokens: LatexToken[]): LatexToken {
    if (tokens.includes(this._tokens[this.index]))
      return this._tokens[this.index++];

    return '';
  }

  /**
   * A Latex number can be a decimal, hex or octal number.
   * It is used in some Latex commands, such as `\char`
   *
   * From TeX:8695 (scan_int):
   * > An integer number can be preceded by any number of spaces and `+' or
   * > `-' signs. Then comes either a decimal constant (i.e., radix 10), an
   * > octal constant (i.e., radix 8, preceded by '), a hexadecimal constant
   * > (radix 16, preceded by "), an alphabetic constant (preceded by `), or
   * > an internal variable.
   */
  parseLatexNumber(isInteger = true): null | number {
    let negative = false;
    let token = this.peek;
    while (token === '<space>' || token === '+' || token === '-') {
      if (token === '-') negative = !negative;
      this.nextToken();
      token = this.peek;
    }

    let radix = 10;
    let digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    if (this.match("'")) {
      // Apostrophe indicates an octal value
      radix = 8;
      digits = ['0', '1', '2', '3', '4', '5', '6', '7'];
      isInteger = true;
    } else if (this.match('"') || this.match('x')) {
      // Double-quote indicates a hex value
      // The 'x' prefix notation for the hexadecimal numbers is a MathJax extension.
      // For example: 'x3A'
      radix = 16;
      // Hex digits have to be upper-case
      digits = [
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
      ];
      isInteger = true;
    } else if (this.match('`')) {
      // A backtick indicates an alphabetic constant: a letter, or a single-letter command
      token = this.nextToken();
      if (token) {
        if (token.startsWith('\\') && token.length === 2) {
          return (negative ? -1 : 1) * (token.codePointAt(1) ?? 0);
        }

        return (negative ? -1 : 1) * (token.codePointAt(0) ?? 0);
      }

      return null;
    }

    let value = '';
    while (digits.includes(this.peek)) {
      value += this.nextToken();
    }

    // Parse the fractional part, if applicable
    if (!isInteger && this.match('.')) {
      value += '.';
      while (digits.includes(this.peek)) {
        value += this.nextToken();
      }
    }

    const result: number = isInteger
      ? Number.parseInt(value, radix)
      : Number.parseFloat(value);
    if (Number.isNaN(result)) return null;
    return negative ? -result : result;
  }

  // Match a LaTeX char, which can be a char literal, or a Unicode codepoint
  // in hexadecimal or decimal notation  with the `\char` or `\unicode` command,
  // or the `^` character repeated twice followed by a hexadecimal codepoint.
  parseChar(): string | null {
    const index = this.index;
    let caretCount = 0;
    while (this.match('^')) caretCount += 1;
    if (caretCount < 2) this.index = index;
    if (caretCount >= 2) {
      let digits = '';
      let n = 0;
      while (n != caretCount) {
        const digit = this.matchAny([
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          'a',
          'b',
          'c',
          'd',
          'e',
          'f',
        ]);
        if (!digit) break;
        digits += digit;
        n += 1;
      }
      if (digits.length === caretCount)
        return String.fromCodePoint(Number.parseInt(digits, 16));
    } else if (this.match('\\char')) {
      let codepoint = Math.floor(this.parseLatexNumber() ?? Number.NaN);
      if (
        !Number.isFinite(codepoint) ||
        codepoint < 0 ||
        codepoint > 0x10ffff
      ) {
        codepoint = 0x2753; // BLACK QUESTION MARK
      }
      return String.fromCodePoint(codepoint);
    } else if (this.match('\\unicode')) {
      this.skipSpaceTokens();
      if (this.match('<{>')) {
        const codepoint = this.parseLatexNumber();

        if (
          this.match('<}>') &&
          codepoint !== null &&
          codepoint >= 0 &&
          codepoint <= 0x10ffff
        ) {
          return String.fromCodePoint(codepoint);
        }
      } else {
        const codepoint = this.parseLatexNumber();

        if (codepoint !== null && codepoint >= 0 && codepoint <= 0x10ffff)
          return String.fromCodePoint(codepoint);
      }
    }
    this.index = index;
    return null;
  }

  /**
   *
   * If the next token matches the open delimiter, set a boundary with
   * the close token and return true.
   *
   * This method handles prefixes like `\left` and `\bigl`.
   *
   * It also handles "shorthand" delimiters, i.e. '(' will match both
   * `(` and `\lparen`. If a shorthand is used for the open delimiter, the
   * corresponding shorthand will be used for the close delimiter.
   * See DELIMITER_SHORTHAND.
   *
   */
  private matchDelimiter(
    open: Delimiter | LatexToken[],
    close: Delimiter | LatexToken[]
  ): boolean {
    const start = this.index;

    // Check for delimiter prefix like \left, \mathopen, etc.
    const closePrefix = OPEN_DELIMITER_PREFIX[this.peek];
    if (closePrefix) this.nextToken();

    // Handle braced form: \mathopen{(} or \mathopen{\lbrack}
    // After consuming the prefix, check if there's a braced delimiter
    const hasBracedDelimiter = closePrefix && this.peek === '<{>';
    if (hasBracedDelimiter) this.nextToken(); // consume the opening brace

    // If the delimiters are token arrays, look specifically for those
    if (Array.isArray(open)) {
      // If the open trigger is an array, the close trigger must be an array too
      console.assert(Array.isArray(close));

      // For single-token array triggers, also check DELIMITER_SHORTHAND
      // This allows ['['] to match both '[' and '\lbrack'
      if (open.length === 1) {
        const possibleTokens = DELIMITER_SHORTHAND[open[0]] ?? [open[0]];
        if (!possibleTokens.includes(this.peek)) {
          this.index = start;
          return false;
        }
        this.nextToken();

        // Consume closing brace if we had a braced delimiter \mathopen{(}
        if (hasBracedDelimiter && !this.match('<}>')) {
          this.index = start;
          return false;
        }

        // Use the close token exactly as specified in the trigger.
        // The matchfix entries already enumerate all delimiter combinations
        // (e.g., [/), \lbrack/), [/\rparen, \lbrack/\rparen for intervals),
        // so we should not transform the close token based on what format
        // the open token was in.
        const closeToken = close[0] as LatexToken;

        // Build the close boundary: for braced form, expect \mathclose{)}
        const closeBoundary = closePrefix
          ? hasBracedDelimiter
            ? [closePrefix, '<{>', closeToken, '<}>']
            : [closePrefix, closeToken]
          : [closeToken];
        this.addBoundary(closeBoundary);
        return true;
      }

      // For multi-token array triggers, match exactly
      if (!this.matchAll(open)) {
        this.index = start;
        return false;
      }
      // If there was a prefix, prepend the close prefix to the close tokens
      const closeBoundary = closePrefix
        ? [closePrefix, ...(close as LatexToken[])]
        : (close as LatexToken[]);
      this.addBoundary(closeBoundary);
      return true;
    }

    console.assert(!Array.isArray(close));

    if (open === '||' && this.matchAll(['|', '|'])) {
      this.addBoundary(['|', '|']);
      return true;
    }

    if (!(DELIMITER_SHORTHAND[open] ?? [open]).includes(this.peek)) {
      // Not the delimiter we were expecting: backtrack
      this.index = start;
      return false;
    }

    open = this.nextToken() as Delimiter;

    // Consume closing brace if we had a braced delimiter \mathopen{(}
    if (hasBracedDelimiter && !this.match('<}>')) {
      this.index = start;
      return false;
    }

    // If we are using a shorthand delimiter, we need to add the
    // corresponding close delimiter. (`close` is a single `Delimiter` here, as
    // asserted above.)
    const closeToken: LatexToken =
      CLOSE_DELIMITER[open] ?? (close as Delimiter);

    // Build the close boundary: for braced form, expect \mathclose{)}
    const closeBoundary = closePrefix
      ? hasBracedDelimiter
        ? [closePrefix, '<{>', closeToken, '<}>']
        : [closePrefix, closeToken]
      : [closeToken];
    this.addBoundary(closeBoundary);
    return true;
  }

  parseGroup(): MathJsonExpression | null {
    const start = this.index;
    this.skipSpaceTokens();
    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      // A brace group is a hard bracket for a bar: a vertical bar met inside
      // the group opens a nested absolute value, it never closes an enclosure
      // started outside the group. Without the barrier the `|` opening the
      // inner absolute value of `\vert\frac{\vert x\vert}{2}\vert` matches the
      // outer bar boundary, so the group parses as empty and the fraction
      // reports a missing numerator. Boundaries with a closing spelling of
      // their own stay visible, so an unclosed group still stops on the
      // enclosing `\end{cases}` instead of consuming it.
      const savedBarrier = this._boundaryBarrier;
      this._boundaryBarrier = this._boundaries.length - 1;
      try {
        const expr = this.parseExpression();
        this.skipSpace();
        if (this.matchBoundary()) return expr ?? 'Nothing';
        // Try to find the boundary (or the end)
        while (!this.matchBoundary() && !this.atEnd) this.nextToken();
        if (operator(expr) === 'Error') return expr;
        const err = this.error('expected-closing-delimiter', start);
        return expr !== null ? ['InvisibleOperator', expr, err] : err;
      } finally {
        this._boundaryBarrier = savedBarrier;
      }
    }

    this.index = start;
    return null;
  }

  parseOptionalGroup(): MathJsonExpression | null {
    const index = this.index;
    this.skipSpaceTokens();
    if (this.match('[')) {
      this.addBoundary([']']);
      const expr = this.parseExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr;
      return this.boundaryError('expected-closing-delimiter');
    }
    this.index = index;
    return null;
  }

  // Some LaTeX commands (but not all) can accept an argument without braces,
  // for example `^` , `\sqrt` or `\frac`.
  // This argument will usually be a single token, but can be a sequence of
  // tokens (e.g. `\sqrt\frac12` or `\sqrt\operatorname{speed}`).
  parseToken(): MathJsonExpression | null {
    // Skip any white space, for example in `\frac5 7`
    this.skipSpace();

    if (PARSE_TOKEN_EXCLUDED.has(this.peek)) return null;

    // Is it a single digit?
    // Note: `x^23` is `x^{2}3`, not x^{23}
    if (/^[0-9]$/.test(this.peek)) return parseInt(this.nextToken(), 10);

    const start = this.index;
    const result = this.parseGenericExpression() ?? this.parseSymbol();
    // In non-strict mode, a spelled-out Greek name directly after an
    // argument of one letter is read as a name (see `_bareNameStart`), as
    // `tryParseBareRun()` splits a run of letters: `e^xalpha_1` is
    // `e^x·alpha_1` and `\sqrt xalpha_1` is `\sqrt{x}·alpha_1`, as
    // `xalpha_1` is `x·alpha_1`. Before, the name was read one letter at a
    // time: `e^x·a·l·p·h·a_1`. The letter and the letters after it must
    // split there with the rule of `tryParseBareRun()`: the letters after
    // the argument are one Greek name, and no Greek name starts at the
    // argument. So `\sqrt beta` stays `\sqrt{b}·e·t·a`, not
    // `\sqrt{b}·eta`, and `x^foo` stays `x^f·o·o`, not `x^f·∞` (`oo` is
    // not a Greek name).
    // The same applies to a bare function name (see `_bareFunctionStart`):
    // `e^xsin(t)` is `e^x·sin(t)`, as `e^x sin(t)` is. It was
    // `e^x·s·i·n(t)`. `tryParseBareFunction()` reads the name only when a
    // parenthesis or an argument follows it. A word that a function name
    // starts at the argument is not split either: `x^acos t` stays as it
    // was.
    if (
      result !== null &&
      this.options.strict === false &&
      this.index === start + 1 &&
      /^[a-zA-Z]$/.test(this._tokens[start]) &&
      /^[a-zA-Z]$/.test(this.peek)
    ) {
      let run = '';
      let end = start;
      while (/^[a-zA-Z]$/.test(this._tokens[end] ?? ''))
        run += this._tokens[end++];
      const names = _Parser.SEGMENTABLE_SYMBOLS;
      const isFunctionName = (word: string) =>
        BARE_FUNCTION_MAP[word] !== undefined ||
        (PARENTHESIZED_BARE_FUNCTION_MAP[word] !== undefined &&
          this.parenthesisFollows(end));
      let nameAtStart = false;
      for (let n = 2; n <= run.length && !nameAtStart; n++)
        nameAtStart =
          names[run.slice(0, n)] !== undefined ||
          isFunctionName(run.slice(0, n));
      const rest = run.slice(1);
      if (!nameAtStart && names[rest] !== undefined)
        this._bareNameStart = this.index;
      else if (!nameAtStart && isFunctionName(rest))
        this._bareFunctionStart = this.index;
    }
    return result;
  }

  /**
   * Parse an expression in a tabular format, where rows are separated by `\\`
   * and columns by `&`.
   *
   * Return rows of sparse columns: empty rows are indicated with `Nothing`,
   * and empty cells are also indicated with `Nothing`.
   */
  parseTabular(): null | MathJsonExpression[][] {
    const result: MathJsonExpression[][] = [];

    let row: MathJsonExpression[] = [];
    let expr: MathJsonExpression | null = null;
    while (!this.atBoundary) {
      this.skipSpace();

      if (this.match('&')) {
        // new column
        // Push even if expr is NULL (it represents a skipped column)
        row.push(expr ?? 'Nothing');
        expr = null;
      } else if (this.match('\\\\') || this.match('\\cr')) {
        // new row

        this.skipSpace();
        // Parse but drop optional argument (used to indicate spacing between lines)
        this.parseOptionalGroup();

        if (expr !== null) row.push(expr);
        result.push(row);
        row = [];
        expr = null;
      } else {
        const cell: MathJsonExpression[] = [];
        let peek = this.peek;
        while (
          peek !== '&' &&
          peek !== '\\\\' &&
          peek !== '\\cr' &&
          !this.atBoundary
        ) {
          expr = this.parseExpression({
            minPrec: 0,
            condition: (p) => {
              const peek = p.peek;
              return peek === '&' || peek === '\\\\' || peek === '\\cr';
            },
          });
          if (expr !== null) cell.push(expr);
          else {
            cell.push([
              'Error',
              "'unexpected-token'",
              { str: tokensToString(peek) },
            ]);
            this.nextToken();
          }
          this.skipSpace();
          peek = this.peek;
        }
        if (cell.length > 1) expr = ['Sequence', ...cell];
        else expr = cell[0] ?? 'Nothing';
      }
    }
    // Capture any leftover columns or row
    if (expr !== null) row.push(expr);
    if (row.length > 0) result.push(row);

    return result;
  }

  /** Match a string used as a LaTeX symbol, for example an environment
   * name.
   * Not suitable for general purpose text, e.g. argument of a `\text{}
   * command. See `matchChar()` instead.
   */
  private parseStringGroupContent(): string {
    const start = this.index;
    let result = '';
    let level = 0;
    // Stop at end of input even with unbalanced braces (level > 0): otherwise
    // `nextToken()` returns `undefined` past the end and `token[0]` throws.
    // The caller (`parseStringGroup`) then fails its boundary match and the
    // malformed group degrades to an Error expression.
    while (!this.atEnd && (!this.atBoundary || level > 0)) {
      const token = this.nextToken();
      if (token === '<$>' || token === '<$$>') {
        this.index = start;
        return '';
      }
      if (token === '<{>') {
        level += 1;
        result += '\\{';
      } else if (token === '<}>') {
        level -= 1;
        result += '\\}';
      } else if (token === '<space>') {
        result += ' ';
      } else if (token[0] === '\\') {
        // TeX will give a 'Missing \endcsname inserted' error
        // if it encounters any command when expecting a string.
        // We're a bit more lax: substitute known symbols with their
        // Unicode character (e.g. \alpha → α).
        const unicode = getSymbolToUnicode().get(token);
        result += unicode ?? token;
      } else {
        result += token;
      }
    }
    return result;
  }

  /** Parse a group as a a string, for example for `\operatorname` or `\begin`.
   *
   * If `rawTokens` is provided, the raw (un-normalized) tokens of the group
   * content are appended to it. The returned string normalizes commands to
   * unicode (e.g. `\alpha` → `α`), which is lossy; callers that need to match
   * the same content verbatim later (e.g. the `\end` of an environment) must
   * use the raw tokens instead.
   */
  parseStringGroup(
    optional?: boolean,
    rawTokens?: LatexToken[]
  ): string | null {
    if (optional === undefined) optional = false;
    const start = this.index;
    while (this.match('<space>')) {}
    if (this.match(optional ? '[' : '<{>')) {
      const contentStart = this.index;
      this.addBoundary([optional ? ']' : '<}>']);
      const arg = this.parseStringGroupContent();
      if (this.matchBoundary()) {
        // `matchBoundary()` consumed the closing delimiter, so the content
        // tokens are everything up to (but not including) it.
        if (rawTokens)
          rawTokens.push(...this._tokens.slice(contentStart, this.index - 1));
        return arg;
      }
      this.removeBoundary();
    }

    this.index = start;
    return null;
  }

  /**
   * Parse an ASCII double-quoted string literal, e.g. `"hello"`, into a
   * MathJSON string. The content is read verbatim up to the closing quote,
   * with LaTeX commands normalized to Unicode (e.g. `"\alpha"` → `α`), matching
   * `\text{…}`. There is no escaping — a `"` cannot appear inside the string
   * (use `\text{…}` for content containing a quote). An unterminated string is
   * an error.
   *
   * Note: a `"` inside `\unicode{…}` / `\char` is a hex prefix consumed by the
   * number parser on a separate path, so it is unaffected by this.
   */
  parseDoubleQuoteString(): MathJsonExpression | null {
    if (this.peek !== '"') return null;
    const start = this.index;
    this.nextToken(); // Consume the opening `"`
    this.addBoundary(['"']);
    const s = this.parseStringGroupContent();
    if (!this.matchBoundary()) {
      this.removeBoundary();
      return this.error('expected-closing-delimiter', start);
    }
    return { str: s };
  }

  /** Parse an environment: `\begin{env}...\end{end}`
   */
  private parseEnvironment(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    const index = this.index;

    if (!this.match('\\begin')) return null;

    // Capture the raw name tokens alongside the normalized name: the name is
    // used for environment-definition lookup (commands normalized to unicode,
    // e.g. `\alpha` → `α`), but the matching `\end` boundary must be built from
    // the raw tokens. Otherwise `\end{\alpha}` — which tokenizes as the
    // `\alpha` command, not the character `α` — would never match the boundary,
    // and a balanced environment would be misreported as `unbalanced`. ASCII
    // names like `cases` are unaffected (each letter tokenizes to itself).
    const nameTokens: LatexToken[] = [];
    const name = this.parseStringGroup(false, nameTokens)?.trim();
    if (!name) return this.error('expected-environment-name', index);

    // Mirror the `.trim()` applied to `name`: drop surrounding whitespace tokens
    // so `\begin{ cases }` still matches `\end{cases}`.
    while (nameTokens[0] === '<space>') nameTokens.shift();
    while (nameTokens[nameTokens.length - 1] === '<space>') nameTokens.pop();

    this.addBoundary(['\\end', '<{>', ...nameTokens, '<}>']);

    for (const def of this.getDefs('environment') as IndexedEnvironmentEntry[])
      if (def.symbolTrigger === name) {
        const expr = def.parse(this, until);

        this.skipSpace();
        if (!this.matchBoundary())
          return this.boundaryError('unbalanced-environment');

        if (expr !== null) return this.decorate(expr, index);

        this.index = index;
        return null;
      }

    // Unknown environment:
    // attempt to parse as tabular, but discard content
    this.parseTabular();

    this.skipSpace();
    if (!this.matchBoundary())
      return this.boundaryError('unbalanced-environment');
    return this.error(['unknown-environment', { str: name }], index);
  }

  parseRepeatingDecimal(): string {
    return _parseRepeatingDecimal(this, this._numberFormatTokens);
  }

  parseNumber(): MathJsonExpression | null {
    return _parseNumber(this, this._numberFormatTokens);
  }

  private parsePrefixOperator(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    if (!until) until = { minPrec: 0 };
    if (!until.minPrec) until = { ...until, minPrec: 0 };

    const start = this.index;
    for (const [def, n] of this.peekDefinitions('prefix')) {
      this.index = start + n;
      const rhs = def.parse(this, { ...until, minPrec: def.precedence + 1 });
      if (rhs !== null) return rhs;
    }
    this.index = start;
    return null;
  }

  private parseInfixOperator(
    lhs: MathJsonExpression,
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    until ??= { minPrec: 0 };
    console.assert(until.minPrec !== undefined);
    if (until.minPrec === undefined) until = { ...until, minPrec: 0 };

    const start = this.index;
    // The longest operator token sequence ahead is the operator. When it
    // binds too loosely for the current context (its precedence is below
    // `minPrec`), the operator ends this operand: a shorter operator that is a
    // prefix of it must not be tried instead. Otherwise in `a <= b <= c` the
    // right operand of the first `<=` would read the `<` of the second `<=`
    // as `Less` (precedence 245 is higher than 241 for `<=`) and leave `=`
    // behind.
    let blockedLength = 0;
    for (const [def, n] of this.peekDefinitions('infix')) {
      if (n > 0 && n < blockedLength) continue;
      if (def.precedence >= until.minPrec) {
        this.index = start + n;
        const rhs = def.parse(this, lhs, until);
        if (rhs !== null) return rhs;
      } else if (n > blockedLength) blockedLength = n;
    }
    this.index = start;

    // A color command wrapping a bare infix operator — e.g.
    // `x \textcolor{red}{=} y` — acts as that operator (`Equal(x, y)`).
    if (this.peek === '\\textcolor') {
      const rhs = this.parseStyledInfixOperator(lhs, until);
      if (rhs !== null) return rhs;
      this.index = start;
    }

    return null;
  }

  /**
   * Parse a color-wrapped infix operator such as `\textcolor{red}{=}` as the
   * operator it contains, so `x \textcolor{red}{=} y` parses as `Equal(x, y)`
   * rather than erroring on the bare `=`. The styling applies only to the
   * operator glyph, which MathJSON has no way to represent, so the color is
   * dropped and the plain operator expression is returned.
   *
   * Returns null (restoring the index) when the wrapper is absent or its
   * braced content is not exactly a single infix operator.
   */
  private parseStyledInfixOperator(
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null {
    const start = this.index;
    if (!this.match('\\textcolor')) return null;

    // The color argument, e.g. `{red}`.
    if (this.parseStringGroup() === null) {
      this.index = start;
      return null;
    }

    // The operator argument, e.g. `{=}`.
    this.skipSpace();
    if (!this.match('<{>')) {
      this.index = start;
      return null;
    }
    this.skipSpace();

    const contentStart = this.index;
    for (const [def, n] of this.peekDefinitions('infix')) {
      if (def.precedence < until.minPrec) continue;
      // The braced content must be exactly the operator: after its trigger
      // tokens, the group must close.
      this.index = contentStart + n;
      this.skipSpace();
      if (!this.match('<}>')) {
        this.index = contentStart;
        continue;
      }
      const rhs = def.parse(this, lhs, until);
      if (rhs !== null) return rhs;
      this.index = contentStart;
    }

    this.index = start;
    return null;
  }

  /**
   * Speculatively check if any \text infix entry (e.g. "and", "or", "where")
   * would match the upcoming tokens. This is used to prevent InvisibleOperator
   * from consuming \text{keyword} as a text run when the keyword is actually
   * an infix operator that was skipped due to precedence constraints.
   *
   * Returns true if any entry's parse function would succeed (non-null result).
   * The parser index is always restored to its original position.
   */
  private wouldMatchTextInfix(
    opDefs: [
      IndexedInfixEntry | IndexedPrefixEntry | IndexedPostfixEntry,
      number,
    ][]
  ): boolean {
    const start = this.index;
    for (const [def, n] of opDefs) {
      if (def.kind !== 'infix') continue;
      this.index = start + n;
      // Use a dummy lhs — we only care if the parse succeeds (matches keyword)
      const result = def.parse(this, 'Nothing', { minPrec: 0 });
      if (result !== null) {
        this.index = start;
        return true;
      }
    }
    this.index = start;
    return false;
  }

  /**
   * This returns an array of arguments (as in a function application),
   * or null if there is no match.
   *
   * - 'enclosure' : will look for an argument inside an enclosure
   *   (open/close fence)
   * - 'implicit': either an expression inside a pair of `()`, or just a product
   *  (i.e. we interpret `\cos 2x + 1` as `\cos(2x) + 1`)
   *
   */
  parseArguments(
    kind: 'enclosure' | 'implicit' = 'enclosure',
    until?: Readonly<Terminator>
  ): ReadonlyArray<MathJsonExpression> | null {
    if (this.atTerminator(until)) return null;

    const savedIndex = this.index;

    const group = this.parseEnclosure();

    // We're looking for an enclosure i.e. `f(a, b, c)`
    if (kind === 'enclosure') {
      if (group === null) return null;
      // `getSequence` unwraps a `Delimiter`/`Sequence` into its arguments, but
      // returns `null` for a single non-sequence expression. That happens when
      // the enclosure parselet unwraps its content (e.g. `(\begin{pmatrix}…)`
      // collapses to a bare `Matrix`), in which case the whole group is the
      // single argument.
      return getSequence(group) ?? [group];
    }

    // We are looking for an expression inside an optional pair of `()`
    // (i.e. trig functions, as in `\cos x`.)
    if (kind === 'implicit') {
      // Even though they're optional, do we have some parentheses?
      if (operator(group) === 'Delimiter') {
        const op1 = operand(group, 1);

        if (operator(op1) === 'Sequence') return operands(op1);

        return op1 === null ? [] : [op1];
      }

      // Was there a matchfix? the "group" is the argument, i.e.
      // `\sin [a, b, c]`
      if (group !== null) return [group];

      // No group, but arguments without parentheses are allowed
      // Read a primary.
      //
      // A `!` after white space ends the argument and applies to the call:
      // `\sin x !`, `tan x !` and `\ln x !` are `(\sin x)!`, `(tan x)!` and
      // `(\ln x)!`, while `\sin x!` is `\sin(x!)`. Without white space the
      // `!` attaches to its operand before this terminator is consulted
      // (see `parsePostfixOperator()`). This holds on every route that
      // reads an argument without parentheses, so it is done here and not
      // in each function name parselet.
      const head = this._primaryStart;
      const primary = this.parseExpression({
        ...until,
        minPrec: MULTIPLICATION_PRECEDENCE,
        condition: (p: Parser) =>
          p.peek === '!' || (until?.condition?.(p) ?? false),
      });
      if (primary === null) return null;
      // In non-strict mode, that `!` is reported as `ambiguous-factorial`: a
      // person can mean `\sin(x!)`, which is how `\sin x!` is read. The same
      // holds for `!!`. `\sin x != 0` is not a factorial. The span runs from
      // the function name to the `!`. An argument in parentheses
      // (`\sin(x) !`) has a clear end and returns above, so it is not
      // reported. The argument parser has consumed the white space after
      // the argument, so the end of the argument is found by going back
      // over it.
      if (this.diagnostics !== null && head >= 0) {
        let argEnd = this.index;
        while (argEnd > head && this._tokens[argEnd - 1] === '<space>')
          argEnd -= 1;
        let bang = this.index;
        while (this._tokens[bang] === '<space>') bang += 1;
        if (
          bang > argEnd &&
          this._tokens[bang] === '!' &&
          this._tokens[bang + 1] !== '='
        )
          this._emitAmbiguity('ambiguous-factorial', head, bang + 1);
      }
      return [primary];
    }

    // The element following the function does not match
    // a possible argument list
    // That's OK, but need to undo the parsing of the matchfix
    // This is the case: `f[a]` or `f|a|`
    this.index = savedIndex;
    return null;
  }

  /**
   * Match one or more `{...}` groups as the argument list of a known
   * function head, exactly as if they were a parenthesized argument list:
   * `\gcd{a,b}` ≡ `\gcd(a,b)`, and consecutive groups are successive
   * arguments (`\mod{x}{2}` ≡ `\mod(x,2)`, the TeX multi-argument-macro
   * habit). A group whose content is a comma sequence contributes each
   * element as an argument.
   *
   * An empty group is not an argument — `{}` is spacing/grouping decoration
   * (see `skipSpace()`), so `\gcd{}` is left for other parsing paths.
   */
  parseBraceArguments(): ReadonlyArray<MathJsonExpression> | null {
    const start = this.index;
    const args: MathJsonExpression[] = [];
    while (this.peek === '<{>') {
      const groupStart = this.index;
      const group = this.parseGroup();
      if (group === null || group === 'Nothing') {
        // Empty (or unparseable) group: not an argument. Leave it
        // unconsumed and stop collecting.
        this.index = groupStart;
        break;
      }
      args.push(...(getSequence(group) ?? [group]));
    }
    if (args.length === 0) {
      this.index = start;
      return null;
    }
    return args;
  }

  /**
   * An enclosure is an opening matchfix operator, an optional expression,
   * optionally followed multiple times by a separator and another expression,
   * and finally a closing matching operator.
   */
  parseEnclosure(): MathJsonExpression | null {
    const start = this.index;
    const currentToken = this.peek;

    // Use the matchfix index for fast lookup of relevant definitions
    // If there's a delimiter prefix like \left, \mathopen, peek ahead to get the actual delimiter
    const hasPrefix = OPEN_DELIMITER_PREFIX[currentToken];
    let lookupToken = hasPrefix ? this._tokens[this.index + 1] : currentToken;
    // Handle braced form: \mathopen{(} - skip past the brace to get the actual delimiter
    if (hasPrefix && lookupToken === '<{>')
      lookupToken = this._tokens[this.index + 2];

    // Get only the matchfix defs that could match this opening token
    // Note: some tokens (like |) may match multiple defs (|| and |)
    let defs = this._dictionary.matchfixByOpen.get(lookupToken) ?? [];

    // If no defs found and lookupToken is undefined, fall back to all matchfix defs
    // (This handles edge cases with complex delimiters)
    if (defs.length === 0 && !lookupToken) {
      defs = [...this.getDefs('matchfix')] as IndexedMatchfixEntry[];
    }

    //
    // Try each potentially matching def
    //
    // Diagnostics from a rejected def's speculative body parse are cleaned up
    // structurally: every `this.index = start` / `this.index = bodyStart`
    // rewind below auto-prunes diagnostics emitted by the abandoned branch (see
    // the `set index` accessor), so no explicit rollback is needed here.
    for (const def of defs) {
      this.index = start;

      // Reversed-bracket ISO interval (`]a, b[`): opens on `]`/`\rbrack`, closes
      // on `[`/`\lbrack`. Its open token also closes ordinary index brackets, so
      // forbid re-entry while already inside such a speculation (see
      // `_reversedIntervalDepth`) — this caps nesting at depth 1 and prevents an
      // exponential fan-out over the tail on input like `a[6]a[6]…`.
      const isReversedInterval =
        Array.isArray(def.openTrigger) &&
        def.openTrigger.length === 1 &&
        (def.openTrigger[0] === ']' || def.openTrigger[0] === '\\rbrack') &&
        Array.isArray(def.closeTrigger) &&
        def.closeTrigger.length === 1 &&
        (def.closeTrigger[0] === '[' || def.closeTrigger[0] === '\\lbrack');
      if (isReversedInterval && this._reversedIntervalDepth > 0) continue;

      // Pre-check: if no token that could begin a close-delimiter match
      // appears ahead, this def cannot match. Skip without parsing the
      // body — otherwise speculative body parses can compound
      // exponentially when the same open token (e.g. `.`) recurs many
      // times in invalid input. The `closeTokens` set is pre-computed at
      // dictionary indexing time and mirrors `matchDelimiter`'s expansion
      // (DELIMITER_SHORTHAND variants, tokenizer-split forms, etc.).
      if (def.closeTokens.size > 0) {
        let found = false;
        const tokens = this._tokens;
        for (let i = start; i < tokens.length; i++) {
          if (def.closeTokens.has(tokens[i])) {
            found = true;
            break;
          }
          // A `\left`-style enclosure may be closed by a null delimiter
          // (`\right.`), which uses none of the def's close tokens. Allow it
          // when the open had such a prefix.
          if (
            hasPrefix &&
            CLOSE_DELIMITER_PREFIX.has(tokens[i]) &&
            tokens[i + 1] === '.'
          ) {
            found = true;
            break;
          }
        }
        if (!found) continue;
      }

      // The `EvaluateAt` matchfix (open `.`, close `|`) is only meaningful
      // with a `\left.` prefix; the canonical form is
      // `\left.expr\right|_{x=0}`. Without a prefix, a bare `.` in input
      // (e.g. Desmos's `p.x` field-access syntax) would speculatively try
      // to parse the rest of the input as an `EvaluateAt` body — and on
      // failure, fall into the matchfix re-parse loop, compounding work
      // exponentially when many `.` tokens appear with `|` somewhere
      // ahead.
      if (
        typeof def.openTrigger === 'string' &&
        def.openTrigger === '.' &&
        !OPEN_DELIMITER_PREFIX[currentToken]
      )
        continue;

      // 1. Match the opening delimiter
      const matched = this.matchDelimiter(def.openTrigger, def.closeTrigger);
      if (!matched) continue;

      // 2. Collect the expression in between the delimiters
      const bodyStart = this.index;
      this.skipSpace();
      // Visual spacing just inside the fences is decoration, not a body. It
      // is written exactly to separate two adjacent bars, as in
      // `|\,|x|\,|`, so it must not make the body look non-empty: an empty
      // body is what triggers the re-parse that reads the inner bars as a
      // nested absolute value.
      this.skipVisualSpace();
      if (isReversedInterval) this._reversedIntervalDepth += 1;
      let body = this.parseExpression();
      if (isReversedInterval) this._reversedIntervalDepth -= 1;
      this.skipSpace();
      const boundary = this._boundaries[this._boundaries.length - 1]?.tokens;
      const matchedBoundary = this.matchBoundary();
      const sameTrigger =
        (typeof def.openTrigger === 'string' &&
          typeof def.closeTrigger === 'string' &&
          def.openTrigger === def.closeTrigger) ||
        (Array.isArray(def.openTrigger) &&
          Array.isArray(def.closeTrigger) &&
          def.openTrigger.length === def.closeTrigger.length &&
          def.openTrigger.every((tok, i) => tok === def.closeTrigger[i]));
      if (matchedBoundary && isEmptySequence(body) && sameTrigger && boundary) {
        // The open and close delimiters are the same and the body came out
        // empty, so the delimiter that closed it is really the opening of a
        // nested enclosure ("||3-5|-4|"). Read the body again with the
        // boundary held inert on that one token: every later occurrence of
        // the delimiter still closes the body, which is what lets an
        // enclosure nest more than two deep.
        this.index = bodyStart;
        this.skipSpace();
        this.skipVisualSpace();
        this.addBoundary(boundary, this.index + 1);
        // Hide the enclosing bar boundaries as well. They are spelled with
        // the same delimiter one level up, so they would close the body at
        // the very token this re-read holds to be a nested opening — which is
        // what stopped an enclosure from nesting three deep. An enclosing
        // boundary with a closing spelling of its own is not ambiguous and
        // stays visible.
        const savedBarrier = this._boundaryBarrier;
        this._boundaryBarrier = this._boundaries.length - 1;
        if (isReversedInterval) this._reversedIntervalDepth += 1;
        try {
          body = this.parseExpression();
        } finally {
          this._boundaryBarrier = savedBarrier;
        }
        if (isReversedInterval) this._reversedIntervalDepth -= 1;
        this.skipSpace();
        if (!this.matchBoundary()) {
          this.removeBoundary();
          this.index = start;
          if (!this.atEnd) continue;
          return null;
        }
      } else if (!matchedBoundary) {
        // We couldn't parse the body up to the closing delimiter.
        const boundary = this._boundaries[this._boundaries.length - 1]?.tokens;
        if (!boundary) {
          this.index = start;
          continue;
        }

        if (
          !this.canSkipMatchfixReparsing(lookupToken, boundary, sameTrigger)
        ) {
          // Re-parse without the boundary to handle ambiguous cases
          this.removeBoundary();
          this.index = bodyStart;
          this.skipSpace();
          if (isReversedInterval) this._reversedIntervalDepth += 1;
          body = this.parseExpression();
          if (isReversedInterval) this._reversedIntervalDepth -= 1;
          this.skipSpace();
          if (!this.matchAll(boundary)) {
            this.index = start;
            if (!this.atEnd) continue;
            return null;
          }
        } else {
          // Performance optimization: skip re-parsing for (] when input is ()
          // Must remove the boundary that matchDelimiter added before continuing
          this.removeBoundary();
          this.index = start;
          continue;
        }
      }
      const result = def.parse(this, body ?? 'Nothing');
      if (result !== null) {
        this.emitAbsoluteValueAmbiguity(start);
        return result;
      }
    }
    // No def matched: the `this.index = start` rewind auto-prunes any
    // diagnostics the speculative bodies emitted (see `set index`).
    this.index = start;
    return null;
  }

  /**
   * In non-strict mode, record an `ambiguous-absolute-value` diagnostic when
   * the bars of the enclosure that starts at token `start`, just read, pair
   * two ways. `|x|y|z|` is read as `|x|·y·|z|`, and a person can mean
   * `|x·|y|·z|`. The second pairing needs a closing bar directly followed by
   * an operand, then a bar between two operands, then one more bar. `|a|+|b|`
   * and `|x|y` have one pairing and are not reported. The span is the bars
   * and what they hold.
   */
  private emitAbsoluteValueAmbiguity(start: number): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const t = this._tokens;
    if (t[start] !== '|' || t[this.index - 1] !== '|') return;
    if (!isOperandStartToken(t[this.index])) return;
    let middle = this.index;
    while (middle < t.length && t[middle] !== '|') middle++;
    if (middle >= t.length) return;
    const before = t[middle - 1];
    if (
      !(isOperandStartToken(before) || before === ')') ||
      !(isOperandStartToken(t[middle + 1]) || t[middle + 1] === '(')
    )
      return;
    let last = middle + 1;
    while (last < t.length && t[last] !== '|') last++;
    if (last >= t.length) return;
    this._emitAmbiguity('ambiguous-absolute-value', start, last + 1);
  }

  /**
   * A generic expression is used for dictionary entries that do
   * some complex (non-standard) parsing. This includes trig functions (to
   * parse implicit arguments), and integrals (to parse the integrand and
   * limits and the "dx" terminator).
   */

  private parseGenericExpression(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;
    let expr: MathJsonExpression | null = null;
    const fnDefs = this.peekDefinitions('expression') ?? [];
    for (const [def, tokenCount] of fnDefs) {
      // Skip the trigger tokens
      this.index = start + tokenCount;
      if (typeof def.parse === 'function') {
        // Give a custom parser a chance to parse the expression
        expr = def.parse(this, until);
        if (expr !== null) return expr;
      } else {
        return def.name!;
      }
    }

    this.index = start;
    return null;
  }

  /**
   * A function is an symbol followed by postfix operators
   * (`\prime`...) and some arguments.
   */

  private parseFunction(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;
    //
    // Is there a definition for this as a function? (a string wrapped in
    //  `\\mathrm`, etc...)
    //
    let fn: MathJsonExpression | null = null;
    let argMode: 'enclosure' | 'implicit' = 'enclosure';
    for (const [def, tokenCount] of this.peekDefinitions('function')) {
      // Skip the trigger tokens
      this.index = start + tokenCount;
      if (typeof def.parse === 'function') {
        // Give a custom parser a chance to parse the function
        fn = def.parse(this, until);
        if (fn !== null) return fn;
      } else {
        fn = def.name!;
        argMode = def.arguments ?? 'enclosure';
        break;
      }
    }

    //
    // No known operator definition matched.
    //
    let isPredicate = false;
    if (fn === null) {
      this.index = start;
      fn = parseSymbol(this);
      // Route the function head through the shared emission point: a bare,
      // undeclared head (e.g. the predicate `P` in `\forall x, P(x)`) is a
      // symbol reference that would otherwise bypass diagnostics — the raw
      // `parseSymbol()` above does not emit. Declared heads no-op; a head on a
      // path that backtracks below is cleaned up by the index-setter auto-prune.
      if (typeof fn === 'string')
        this.emitSymbolReference(fn, start, this.index);
      if (typeof fn === 'string' && this.options.resolveApplication) {
        // Match the ordinary symbol path before committing the occurrence.
        // The low-level name scanner can spell dictionary aliases differently.
        const scannerEnd = this.index;
        this.index = start;
        const policyHead = this.parseSymbol(until);
        const info =
          typeof policyHead === 'string'
            ? this.resolveSymbol(policyHead)
            : undefined;
        if (
          typeof policyHead === 'string' &&
          (info === undefined || info.inferred === true)
        ) {
          const candidate = this.parseApplicationCandidate(policyHead, start);
          if (candidate !== null) return candidate;
        }
        this.index = scannerEnd;
      }
      if (!this.isFunctionOperator(fn)) {
        // Check if this looks like a predicate: single uppercase letter
        // followed by parentheses (e.g., P(x), Q(a,b))
        // This enables automatic inference of predicates in FOL contexts
        if (!this.looksLikePredicate(fn)) {
          this.index = start;
          return null;
        }
        isPredicate = true;
      }
    }

    //
    // Is it followed by one or more postfix (e.g. `\prime`)
    //
    do {
      const pf = this.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    // If fn is a function symbol, it may be followed by an argument list

    const parenthesizedBracket =
      argMode === 'enclosure' && this.atParenthesizedIndexBracket();
    let args = this.parseArguments(argMode, until);

    if (args === null) return fn;

    // A single bracketed-list argument inside the call parentheses,
    // `A([1])` or `A\left(\left[1\right]\right)`, keeps the parentheses as a
    // `Delimiter` around the list. Without it, the non-canonical forms of
    // `A([1])` and of `A[1]` (a bracketed list after a function name is its
    // argument) are the same `["A", ["List", 1]]`, and a host that reads
    // `A([1])` differently from `A[1]` (Desmos reads the first as a product
    // and the second as an index) cannot tell them apart. The canonical form
    // removes the `Delimiter`, so both spellings are still `A(List(1))`. The
    // serializer writes a list as `\bigl\lbrack…\bigr\rbrack`, which is not an
    // index bracket, so `A(\bigl\lbrack1\bigr\rbrack)` gets no `Delimiter`:
    // the serialized form of `A[1]` reads back as `A[1]` did.
    if (
      parenthesizedBracket &&
      args.length === 1 &&
      isBracketCollection(args[0])
    )
      args = [['Delimiter', args[0]]];

    // Predicates are wrapped in ["Predicate", name, ...args] to distinguish
    // them from function applications. This is done only inside quantifier
    // scopes (ForAll, Exists, etc.). Outside a quantifier scope, a
    // predicate-looking name is treated as an ordinary function application
    // (e.g. N(\sqrt{10}) -> ["N", ["Sqrt", 10]], D(f, x) -> ["D", f, x]) so
    // that library functions like N (numeric evaluation) and D (derivative)
    // behave as expected.
    if (isPredicate && typeof fn === 'string') {
      if (this.inQuantifierScope) return ['Predicate', fn, ...args];
    }

    // In non-strict mode, a library operator whose name is one letter (`N`,
    // the numeric evaluation, and `D`, the derivative), written as a plain
    // letter before a parenthesis, is read as a call of that operator. A
    // person writing plain text usually means a function of their own with
    // that name. A LaTeX command (`\operatorname{N}(x)`) is a deliberate
    // spelling of the operator and is not reported.
    if (
      isPredicate &&
      typeof fn === 'string' &&
      ONE_LETTER_LIBRARY_OPERATORS.has(fn) &&
      this._tokens[start] === fn
    )
      this._emitAmbiguity('ambiguous-engine-operator', start, this.index, {
        name: fn,
      });

    return typeof fn === 'string' ? [fn, ...args] : ['Apply', fn!, ...args];
  }

  /**
   * With a `resolveApplication` hook, read `head` (whose source spans from
   * `start` to the current index) followed by a parenthesized group as an
   * application candidate: the hook decides later, once the enclosing
   * structure is known, whether it is a call or a product (see
   * `ApplicationPolicy`). Return `null` if no parenthesized group follows;
   * the index is then left after any skipped visual space, and the caller
   * restores it.
   *
   * The caller checks that `head` has no authoritative definition: the hook
   * is only consulted for a name that is undeclared or whose type was only
   * inferred.
   */
  private parseApplicationCandidate(
    head: MathJsonSymbol,
    start: number
  ): MathJsonExpression | null {
    const headEnd = this.index;
    const fallback = this.isFunctionOperator(head)
      ? 'apply'
      : this.looksLikePredicate(head)
        ? this.inQuantifierScope
          ? 'predicate'
          : 'apply'
        : 'juxtapose';
    this.skipVisualSpace();
    let opening = this.index;
    if (OPEN_DELIMITER_PREFIX[this._tokens[opening]]) opening++;
    if (this._tokens[opening] === '<{>') opening++;
    if (!DELIMITER_SHORTHAND['('].includes(this._tokens[opening])) return null;
    const group = this.parseEnclosure();
    if (group === null) return null;
    this._applicationPolicy ??= new ApplicationPolicy(
      this.options.resolveApplication
    );
    return this._applicationPolicy.add({
      head,
      group,
      fallback,
      sourceOffsets: this.sourceOffsets(start, this.index),
      headSourceOffsets: this.sourceOffsets(start, headEnd),
    });
  }

  /**
   * In non-strict mode, the bare-word parselets (`tryParseBareSymbol()`,
   * `tryParseBareRun()`) read a name such as `gamma` or `foo` before
   * `parseFunction()` can see it. When that name is followed by a
   * parenthesized group, give the `resolveApplication` hook the same chance
   * to decide the reading as it has for `f(x)`, under the same precedence
   * rules: a name with an authoritative definition (an explicit
   * declaration, a parser-local parameter, a `resolveSymbol` fact, a library
   * definition) is not submitted. Return `null`, with the index at `end`,
   * when the hook is absent or does not apply.
   */
  private parseBareApplicationCandidate(
    head: MathJsonSymbol,
    start: number
  ): MathJsonExpression | null {
    if (!this.options.resolveApplication) return null;
    const info = this.resolveSymbol(head);
    if (info !== undefined && info.inferred !== true) return null;
    const end = this.index;
    const candidate = this.parseApplicationCandidate(head, start);
    if (candidate === null) this.index = end;
    return candidate;
  }

  parseSymbol(until?: Readonly<Terminator>): MathJsonExpression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;
    const seqStart = this._diagnosticsCheckpoint();

    //
    // Is there a custom parser for this symbol?
    //
    for (const [def, tokenCount] of this.peekDefinitions('symbol')) {
      this.index = start + tokenCount;
      // @todo: should capture symbol, and check it is not in use as a symbol,  function, or inferred (calling resolveSymbol() or something like it). Maybe not during parsing, but canonicalization
      const result =
        typeof def.parse === 'function' ? def.parse(this, until) : def.name!;
      if (result === null) continue;
      // A dictionary-spelled symbol (`\eta`, `\alpha`, …) followed by `_`
      // absorbs the subscript into a joined symbol name (`\eta_{w}` →
      // `eta_w`), under the same rule as the single-letter and
      // trigger-spelled branches of `parseSymbol()` in `parse-symbol.ts`:
      // - a base with `subscriptEvaluate` owns its subscripts and never
      //   absorbs them;
      // - an indexed-collection base absorbs only a subscript whose joined
      //   name is DECLARED — a declared `eta_w` must win over the `At(eta,
      //   w)` element-access reading, or the serializer's own spelling of
      //   `eta_w` (`\eta_{w}`) stops round-tripping — while an undeclared
      //   one keeps the element-access reading;
      // - any other base absorbs unconditionally, so raw-form output is a
      //   plain symbol for `\eta_{w}` exactly as it is for `a_{0}`.
      // The unconditional arm is the user-ruled half (2026-08-19, consumer
      // item: a raw-form reader saw `"a_0"` for a Latin base but
      // `["Subscript","eta","w"]` for a Greek one — the asymmetry was an
      // oversight, this branch used to require a declaration for every
      // base).
      if (typeof result === 'string' && this.peek === '_') {
        const info = this.resolveSymbol(result);
        if (!info?.subscriptEvaluate) {
          const joined = absorbSubscripts(
            this,
            result,
            info?.type.matches('indexed_collection<any>') ?? false
          );
          // The fold can SYNTHESIZE a name no other path sees (`eta_w`
          // from `\eta_{w}`), so the undeclared-symbol diagnostic must be
          // emitted here for it, exactly as the generic `parseSymbol()`
          // path below emits for the names it produces. Only a name the
          // fold actually built is emitted — an unabsorbed base keeps this
          // branch's historical no-diagnostic behavior.
          if (
            joined !== result &&
            !this.resolveSymbol(joined)?.type.matches('error')
          )
            this.emitSymbolReference(joined, start, this.index);
          // The end of an unbraced letter subscript has a second reading
          // here as it has on a Latin base: `Δ_a2` is `Δ_a·2`, as `x_a2` is
          // `x_a·2`.
          if (joined !== result) this.emitSubscriptEndAmbiguity(joined, start);
          this.recordSubscriptableSymbol(joined, start, seqStart);
          return joined;
        }
      }
      if (typeof result === 'string')
        this.recordSubscriptableSymbol(result, start, seqStart);
      return result;
    }

    // No custom parser worked. Backtrack.
    // (we shouldn't need to backtrack, but this is in case there's a bug
    // in a custom parser)
    this.index = start;

    const id = parseSymbol(this);
    if (id !== null && !this.resolveSymbol(id)?.type.matches('error')) {
      // Diagnostic: a symbol reference that resolves to no declaration —
      // neither a parser-local binding (sum index, Block/Function parameter,
      // tracked in `symbolTable`) nor a definition in the engine scope.
      // Emitted at every reference site (spans differ); bound-variable
      // references are pruned retroactively by the binder parselets.
      this.emitSymbolReference(id, start, this.index);
      // A name that is not a valid MathJSON symbol spelling (`ж`, `é`) is
      // read as a string, not as a variable: it is not math, and a person
      // can mean a variable or a typing error.
      if (!matchesSymbol(id))
        this._emitAmbiguity('ambiguous-unknown-character', start, this.index, {
          text: id,
        });
      this.emitSubscriptEndAmbiguity(id, start);
      // A single letter takes a subscript into its name, and so does any
      // other spelling that is not the name of a function (see
      // `parseSymbol()` in `parse-symbol.ts`).
      if (
        /^[a-zA-Z]$/.test(this._tokens[start]) ||
        /^\p{XIDS}$/u.test(this._tokens[start]) ||
        !this.isFunctionTriggerName(id)
      )
        this.recordSubscriptableSymbol(id, start, seqStart);
      return id;
    }

    // This was a symbol, but not a valid symbol. Backtrack
    this.index = start;
    return null;
  }

  /**
   * Record that the symbol `id`, read from the token `start` to the index,
   * takes a subscript into its name. `seqStart` is the diagnostics
   * checkpoint taken before the symbol was read. See
   * `_subscriptableSymbol`.
   */
  private recordSubscriptableSymbol(
    id: string,
    start: number,
    seqStart: number
  ): void {
    this._subscriptableSymbol = {
      start,
      end: this.index,
      id,
      seqStart,
      seqEnd: this._diagnosticsCheckpoint(),
    };
  }

  /**
   * The symbol spelled by the tokens `base` was read, then a superscript,
   * and the index is at a `_`. When a symbol or expression entry of the
   * dictionary has a trigger made of `base` and the tokens at the index
   * (`\delta` `_` for `KroneckerDelta`, `\mu` `_` `0` for `Mu0`), read
   * that entry as the parser reads it when the subscript comes first, and
   * return its result with the index after it. The longest trigger has the
   * first priority. Otherwise, return `null` with the index unchanged.
   */
  private parseSubscriptTriggerAfterBase(
    base: LatexToken[]
  ): MathJsonExpression | null {
    const start = this.index;
    if (base.length === 0) return null;
    const max = Math.min(
      (this._dictionary.triggerStartMax.get(base[0]) ?? 0) - base.length,
      this._tokens.length - start
    );
    for (let n = max; n >= 1; n--) {
      const trigger = tokensToString([
        ...base,
        ...this._tokens.slice(start, start + n),
      ]);
      for (const def of [
        ...(this._dictionary.symbolByTrigger.get(trigger) ?? []),
        ...(this._dictionary.expressionByTrigger.get(trigger) ?? []),
      ]) {
        this.index = start + n;
        const result =
          typeof def.parse === 'function'
            ? def.parse(this, undefined)
            : (def.name ?? null);
        if (result !== null) return result;
      }
    }
    this.index = start;
    return null;
  }

  /**
   * Remove the `undeclared-symbol` diagnostic that `parseSymbol()` recorded
   * for the symbol `base` (see `_subscriptableSymbol`). Use it when a later
   * step joins subscripts to the name: the symbol is then the joined name,
   * not the base.
   */
  private removeSymbolReference(base: {
    id: string;
    seqStart: number;
    seqEnd: number;
  }): void {
    if (this.diagnostics === null) return;
    const d = this.diagnostics;
    let w = 0;
    for (const e of d)
      if (
        e.code !== 'undeclared-symbol' ||
        e.detail?.name !== base.id ||
        e._seq < base.seqStart ||
        e._seq >= base.seqEnd
      )
        d[w++] = e;
    d.length = w;
  }

  /**
   * The symbol `base`, with prime marks after it, took the subscripts from
   * the token `subscriptStart` to the index into the name `joined`:
   * `x'_{01}` is the derivative of `x_01`. Report the symbol as the symbol
   * parser reports `x_{01}'`: an `undeclared-symbol` diagnostic for
   * `joined`, not for `base`. The diagnostic of `base` is removed when
   * `base` is the last symbol that `parseSymbol()` read and only prime
   * marks come between it and `subscriptStart`. The span of the new
   * diagnostic then starts at `base`, else at `subscriptStart`.
   */
  _reportJoinedSymbol(
    base: string,
    joined: string,
    subscriptStart: number
  ): void {
    const symbolBase = this._subscriptableSymbol;
    let start = subscriptStart;
    if (
      symbolBase !== null &&
      symbolBase.id === base &&
      this._tokens
        .slice(symbolBase.end, subscriptStart)
        .every((token) =>
          [
            "'",
            '\\prime',
            '\\doubleprime',
            '\\tripleprime',
            '^',
            '<{>',
            '<}>',
          ].includes(token)
        )
    ) {
      start = symbolBase.start;
      this.removeSymbolReference(symbolBase);
    }
    if (!this.resolveSymbol(joined)?.type.matches('error'))
      this.emitSymbolReference(joined, start, this.index);
  }

  /**
   * In non-strict mode, record an `ambiguous-implicit-subscript` diagnostic
   * when the symbol `id`, read from the tokens between `start` and the
   * index, ends with an unbraced subscript that is a run of letters, and
   * the end of that subscript has a second common reading:
   *
   * - a digit directly after the run: `M_max0.5` is `M_max·0.5`, and a
   *   person can mean a subscript that holds the number;
   * - the run ends with a function name and has more letters before it:
   *   `A_maxsin t` is `A_maxsin·t`, and a person can mean `A_max·sin(t)`.
   *
   * The span starts at the `_`. A braced subscript (`A_{maxsin}`) has a
   * clear end and is not reported.
   */
  private emitSubscriptEndAmbiguity(id: string, start: number): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const t = this._tokens;
    const end = this.index;
    const isLetter = (i: number) =>
      t[i] !== undefined && /^[a-zA-Z]$/.test(t[i]);
    let runStart = end;
    while (runStart > start && isLetter(runStart - 1)) runStart--;
    const underscore = runStart - 1;
    if (runStart === end || underscore <= start || t[underscore] !== '_')
      return;
    const run = t.slice(runStart, end).join('');
    const base = id.slice(0, id.length - run.length - 1);
    if (/^[0-9]$/.test(t[end] ?? '')) {
      let numberEnd = end;
      while (/^[0-9]$/.test(t[numberEnd] ?? '')) numberEnd++;
      if (t[numberEnd] === '.' && /^[0-9]$/.test(t[numberEnd + 1] ?? '')) {
        numberEnd++;
        while (/^[0-9]$/.test(t[numberEnd] ?? '')) numberEnd++;
      }
      this._emitAmbiguity(
        'ambiguous-implicit-subscript',
        underscore,
        numberEnd,
        {
          base,
          subscript: run,
        }
      );
      return;
    }
    for (let k = 1; k < run.length - 1; k++) {
      const fn = run.slice(k);
      if (BARE_FUNCTION_MAP[fn] === undefined) continue;
      this._emitAmbiguity('ambiguous-implicit-subscript', underscore, end, {
        base,
        subscript: run,
        function: fn,
      });
      return;
    }
  }

  /**
   * Look ahead (without consuming any tokens) for a run of letters starting at
   * the current position, skipping leading spaces. Used to detect an upcoming
   * bare function name so that an implicit function argument stops before it
   * (e.g. `sin x cos y` groups as `(sin x)(cos y)`).
   */
  private peekBareWord(): string {
    let i = this.index;
    while (this._tokens[i] === '<space>') i++;
    let w = '';
    while (i < this._tokens.length && /^[a-zA-Z]$/.test(this._tokens[i])) {
      w += this._tokens[i];
      i++;
    }
    return w;
  }

  /**
   * Whether a parenthesis (`(` or `\left(`) starts at token `i`, after
   * optional white space.
   */
  private parenthesisFollows(i: number): boolean {
    while (this._tokens[i] === '<space>') i++;
    return (
      this._tokens[i] === '(' ||
      (this._tokens[i] === '\\left' && this._tokens[i + 1] === '(')
    );
  }

  /**
   * In non-strict mode, try to parse a bare function name, either applied to a
   * parenthesized argument list (`sin(x)`) or, without parentheses, to an
   * implicit argument the way `\sin x` works (`sin x`, `cos 2x`, `sqrt4`).
   *
   * Returns the parsed function call or null if not a bare function.
   */
  private tryParseBareFunction(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    if (this.options.strict !== false) return null;

    const start = this.index;

    // Word boundary: if the preceding token is a letter, we're in the
    // middle of a word that was partially consumed — don't match. The
    // exception is a name after an argument of one letter (`sin` in
    // `e^xsin(t)`, see `_bareFunctionStart`).
    if (
      start > 0 &&
      /^[a-zA-Z]$/.test(this._tokens[start - 1]) &&
      start !== this._bareFunctionStart
    )
      return null;

    // Collect consecutive letter tokens to form a potential function name
    let name = '';
    while (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
      name += this.peek;
      this.index++;
    }

    if (!name) {
      this.index = start;
      return null;
    }

    // Longest-match for bare function names that embed a trailing digit, e.g.
    // `atan2` → Arctan2. If the letter run followed by one or more digits forms
    // a known function name, consume those digits as part of the name. This
    // must run before the `log`-base and implicit-argument logic so that
    // `atan2(1,2)` is `Arctan2(1,2)` rather than `Arctan(2·(1,2))`. (Prefer the
    // longest matching name: only `atan2` is claimed, `atan` alone is not
    // extended when no digit follows.)
    if (!this.atEnd && /^[0-9]$/.test(this.peek)) {
      let digits = '';
      let j = this.index;
      while (j < this._tokens.length && /^[0-9]$/.test(this._tokens[j])) {
        digits += this._tokens[j];
        j++;
      }
      for (let k = digits.length; k >= 1; k--) {
        if (BARE_FUNCTION_MAP[name + digits.slice(0, k)] !== undefined) {
          name += digits.slice(0, k);
          this.index += k;
          break;
        }
      }
    }

    // Check the name before reading any script: a run that is not a known
    // function name is left to the other parselets. Reading the `^`/`_` group
    // first and discarding it made a nested exponent (`e^{-(e^{-(…)})}`) be
    // read twice per level, once here and once by `parseSupsub()`, which is
    // exponential in the nesting depth.
    const fnName =
      BARE_FUNCTION_MAP[name] ??
      (this.parenthesisFollows(this.index)
        ? PARENTHESIZED_BARE_FUNCTION_MAP[name]
        : undefined);
    if (!fnName) {
      this.index = start;
      return null;
    }

    const nameEnd = this.index;
    this.skipSpace();

    // A prime after the name (`sin'(x)`, `sin\prime(x)`) makes the function
    // the operand of a derivative, not a call. The name is left to the other
    // parselets, which read it as a symbol, and the prime is then read as a
    // postfix `Derivative`. Without this check, `\prime` was read as the
    // first token of the argument and gave an `unexpected-command` error.
    if (
      this.peek === "'" ||
      this.peek === '\\prime' ||
      this.peek === '\\doubleprime'
    ) {
      this.index = start;
      return null;
    }

    // Check for optional subscript: log_2(x) or log_{10}(x)
    let subscript: MathJsonExpression | null = null;
    // True when the subscript or the base of `log` is the `0` of a longer
    // run of digits (`log_01(x)`, `log012(x)`)
    let zeroRun = false;
    if (this.peek === '_') {
      this.index++; // skip '_'
      subscript = this.parseGroup();
      if (subscript === null) {
        // Try bare digits/letters: _2, _10, _b
        if (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
          subscript = this.peek;
          this.index++;
        } else {
          // A run of digits that starts with `0` gives only the `0`, as in
          // the strict grammar: the number value of `01` drops the zero.
          let digits = '';
          while (!this.atEnd && /^[0-9]$/.test(this.peek) && digits !== '0') {
            digits += this.peek;
            this.index++;
          }
          if (digits) subscript = digitRunNumber(digits);
          zeroRun = digits === '0' && /^[0-9]$/.test(this.peek);
        }
        if (subscript === null) {
          this.index = start;
          return null;
        }
      }
      this.skipSpace();
    }

    // In non-strict mode, a bare digit immediately after `log` is its base:
    // `log2(8)` → `log_2(8)`. (Only `log` takes a variable base; other bare
    // functions treat a following digit as an implicit argument, e.g.
    // `sqrt4` → `sqrt(4)`.)
    let logBaseSpan: [number, number] | null = null;
    if (
      subscript === null &&
      name === 'log' &&
      !this.atEnd &&
      /^[0-9]$/.test(this.peek)
    ) {
      const digitsStart = this.index;
      // As for a subscript (see above), a leading `0` is the whole base.
      let digits = '';
      while (!this.atEnd && /^[0-9]$/.test(this.peek) && digits !== '0') {
        digits += this.peek;
        this.index++;
      }
      subscript = digitRunNumber(digits);
      zeroRun = digits === '0' && /^[0-9]$/.test(this.peek);
      // `log 2 x` is read as the base-2 logarithm of `x`, and a person can
      // mean the logarithm of `2x`. Report it once the call is read (see
      // below). `log2 x` and `log2(x)`, with no white space, are the base-2
      // logarithm by convention and are not reported.
      if (digitsStart !== nameEnd) logBaseSpan = [start, this.index];
      this.skipSpace();
    }

    // Check for optional exponent: sin^2(x) or sin^{10}(x)
    let exponent: MathJsonExpression | null = null;
    if (this.peek === '^') {
      this.index++; // skip '^'
      // Try braced group first: ^{expr}
      exponent = this.parseGroup();
      if (exponent === null) {
        // In non-strict mode, try bare digits: ^2, ^-3
        let neg = false;
        if ((this.peek as string) === '-') {
          neg = true;
          this.index++;
        }
        let digits = '';
        while (!this.atEnd && /^[0-9]$/.test(this.peek)) {
          digits += this.peek;
          this.index++;
        }
        if (digits) {
          exponent = digitRunNumber(neg ? '-' + digits : digits);
        } else {
          // Not a valid exponent, backtrack entirely
          this.index = start;
          return null;
        }
      }
      this.skipSpace();
    }

    // Parse the argument(s). With parentheses this is an ordinary call
    // (`sin(x)`, `log_2(8)`). Without parentheses, in non-strict mode we accept
    // an implicit argument the same way `\sin x` does (`sin x` → `Sin(x)`,
    // `cos 2x` → `Cos(2x)`, `sqrt4` → `Sqrt(4)`), stopping before another bare
    // function so `sin x cos y` groups as `(sin x)(cos y)`.
    let args: ReadonlyArray<MathJsonExpression> | null;
    const argStart = this.index;
    let implicitArgument = false;
    if (this.peek === '(') {
      args = this.parseArguments('enclosure', until);
    } else {
      implicitArgument = true;
      args = this.parseArguments('implicit', {
        ...until,
        minPrec: MULTIPLICATION_PRECEDENCE,
        condition: (p: Parser) => {
          const w = this.peekBareWord();
          return (
            (w.length > 0 && BARE_FUNCTION_MAP[w] !== undefined) ||
            (until?.condition?.(p) ?? false)
          );
        },
      });
    }

    if (args === null) {
      // No valid arguments found, backtrack
      this.index = start;
      return null;
    }

    if (logBaseSpan !== null)
      this._emitAmbiguity('ambiguous-function-argument', ...logBaseSpan, {
        function: name,
      });

    // The base of `log` is the `0` of a longer run of digits: `log_01(x)`
    // and `log012(x)` are read as the logarithm in base 0 of `1(x)` and of
    // `12(x)`, as the strict `\log_01(x)` is. A person never means base 0:
    // the digits are a base with a leading zero, or a typing error. The
    // code is the one of a subscript on another function name (`tan_01x`,
    // reported below). The span is the call.
    if (zeroRun && name === 'log')
      this._emitAmbiguity('ambiguous-function-subscript', start, this.index, {
        name,
        subscript,
      });

    // `log(x, 2)` is read as the logarithm of `x` in base 2, with the base
    // second as in Python and in spreadsheets, and other tools put the base
    // first (`log(2, x)`). Every `log` with two arguments in parentheses and
    // no other base is reported. The name `lg` is the base-10 logarithm (ISO
    // 80000-2), and in computer science it is the base-2 logarithm, so it is
    // always reported.
    if (
      (name === 'log' &&
        subscript === null &&
        !implicitArgument &&
        args.length === 2) ||
      name === 'lg'
    )
      this._emitAmbiguity('ambiguous-log-base', start, this.index, { name });

    // An argument without parentheses that holds white space has more than
    // one factor: `sin x y` is read as `sin(x·y)`, and a person can mean
    // `sin(x)·y`. `sin 2x`, with no white space in the argument, is not
    // reported. White space after the argument, and white space inside a
    // group of the argument (`sin 2(x + 1)`), does not count.
    if (implicitArgument && this.diagnostics !== null) {
      let argEnd = this.index;
      while (argEnd > argStart && this._tokens[argEnd - 1] === '<space>')
        argEnd--;
      // An argument without parentheses that starts with `+`: `ln+1` is read
      // as `ln(+1)`, and the `+` is dropped. A person can mean a sum with a
      // missing argument of `ln`, or the letters `l·n` plus 1. A `-` is not
      // reported: `sin -x` is `sin(-x)` by convention.
      let signAt = argStart;
      while (this._tokens[signAt] === '<space>') signAt++;
      const plusSign = this._tokens[signAt] === '+' && signAt < argEnd;
      if (plusSign)
        this._emitAmbiguity('ambiguous-function-argument', start, argEnd, {
          function: name,
        });
      // A `!` after the argument and white space applies to the call
      // (`tan x !` is `(tan x)!`) and is reported by `parseArguments()`.
      let depth = 0;
      for (let k = plusSign ? argEnd : argStart; k < argEnd; k++) {
        const tok = this._tokens[k];
        if (tok === '(' || tok === '[' || tok === '<{>' || tok === '\\left')
          depth += 1;
        else if (
          tok === ')' ||
          tok === ']' ||
          tok === '<}>' ||
          tok === '\\right'
        )
          depth -= 1;
        else if (tok === '<space>' && depth === 0) {
          this._emitAmbiguity('ambiguous-function-argument', start, argEnd, {
            function: name,
          });
          break;
        }
      }
      // A power of `e` after the first factor of the argument: `sin2e^a` is
      // read as `sin(2e^a)`, and a person can mean `sin(2)·e^a`. The power
      // of `e` is the exponential function, a second function next to the
      // first one.
      const factors =
        args.length === 1 &&
        (operator(args[0]) === 'InvisibleOperator' ||
          operator(args[0]) === 'Multiply')
          ? operands(args[0])
          : [];
      if (
        factors
          .slice(1)
          .some(
            (f) =>
              operator(f) === 'Power' &&
              (operand(f, 1) === 'e' || operand(f, 1) === 'ExponentialE')
          )
      )
        this._emitAmbiguity('ambiguous-function-argument', start, argEnd, {
          function: name,
        });
    }

    // An exponent `-1`, unbraced (`sin^-1`) or braced (`sin^{-1}`, and
    // `sin⁻¹`, which the tokenizer reads as `sin^{-1}`)
    const inverseExponent =
      exponent === -1 ||
      (operator(exponent) === 'Negate' && operand(exponent, 1) === 1);

    // A subscript on a function name other than `log` is kept as the strict
    // grammar keeps it: `ln_3(x)` is `Log(x, 3)` as `\ln_3(x)` is, and
    // `tan_1x` is `Apply(Subscript(Tan, 1), x)` as `\tan_1 x` is. Before,
    // the subscript was read and then dropped (`tan_1x` was `tan(x)`). A
    // person can mean another reading (`tan_1` as a name, or `ln` with no
    // base), so the reading is reported.
    if (subscript !== null && name !== 'log')
      this._emitAmbiguity('ambiguous-function-subscript', start, this.index, {
        name,
        subscript,
      });

    // The inverse of a logarithm is a power, as in the strict grammar (see
    // `parseLog()`): `ln^-1(x)` is `exp(x)`, `log^-1(x)` and `lg^-1(x)` are
    // `10^x`, and a base replaces `e` or 10: `ln_3^-1(x)` and `log_3^-1(x)`
    // are `3^x`. In plain text a person also writes `^-1` for the
    // reciprocal `1/ln(x)`, so the reading is reported.
    if (
      inverseExponent &&
      (name === 'ln' || name === 'log' || (name === 'lg' && subscript === null))
    ) {
      this._emitAmbiguity('ambiguous-inverse-function', start, this.index, {
        name,
      });
      return name === 'ln' && subscript === null
        ? ['Exp', ...args]
        : ['Power', subscript ?? 10, ...args];
    }

    if (subscript !== null && name !== 'log') {
      // Arguments after the first argument of `ln` are kept, so that the
      // canonical form reports them as unexpected arguments: `ln_3(x, y)`
      // is `Log(x, 3, y)`.
      //
      // A name read as a special form keeps that form: the subscript goes on
      // the head of the form, `cbrt_2(x)` is
      // `Apply(Subscript(Root, 2), x, 3)`. The count `nPr` has no head (see
      // below), so the subscript goes on the count: `nPr_2(5, 2)` is
      // `Subscript(Binomial(5, 2)·2!, 2)`. The name of `nPr` in the
      // function table, `Permutations`, is the collection of the
      // arrangements, not their count.
      let call: MathJsonExpression;
      if (name === 'ln')
        call = ['Log', args[0] ?? 'Nothing', subscript, ...args.slice(1)];
      else if (name === 'cbrt')
        call = [
          'Apply',
          ['Subscript', fnName, subscript],
          args[0] ?? 'Nothing',
          3,
          ...args.slice(1),
        ];
      else if (name === 'nPr')
        call = [
          'Subscript',
          [
            'Multiply',
            ['Binomial', args[0] ?? 'Nothing', args[1] ?? 'Nothing'],
            ['Factorial', args[1] ?? 'Nothing'],
          ],
          subscript,
        ];
      else call = ['Apply', ['Subscript', fnName, subscript], ...args];
      return exponent !== null ? ['Power', call, exponent] : call;
    }

    // Special case: cbrt(x) -> ['Root', x, 3]
    if (name === 'cbrt') {
      const result: MathJsonExpression = ['Root', args[0] ?? 'Nothing', 3];
      return exponent !== null ? ['Power', result, exponent] : result;
    }

    // Special case: nPr(n, k) -> the k-permutation count P(n, k) = C(n, k)·k!
    // (`Permutations` proper is the collection of arrangements, not the count)
    if (name === 'nPr') {
      const result: MathJsonExpression = [
        'Multiply',
        ['Binomial', args[0] ?? 'Nothing', args[1] ?? 'Nothing'],
        ['Factorial', args[1] ?? 'Nothing'],
      ];
      return exponent !== null ? ['Power', result, exponent] : result;
    }

    // Special case: log with subscript base (matches \log_b behavior)
    // log_2(x) -> ['Lb', x], log_10(x) -> ['Log', x], log_b(x) -> ['Log', x, b]
    let result: MathJsonExpression;
    // Arguments after the first are kept, so that the canonical form reports
    // them as unexpected arguments: `log_3(x, y)` is `Log(x, 3, y)`. Before,
    // `y` was dropped, and `log_10(x, y)` was `Log(x, y)`, the logarithm
    // in base `y`.
    if (name === 'log' && subscript !== null) {
      if (args.length > 1)
        result = ['Log', args[0], subscript, ...args.slice(1)];
      else if (subscript === 2) result = ['Lb', ...args];
      else if (subscript === 10) result = ['Log', ...args];
      else result = ['Log', args[0], subscript];
    } else {
      result = [fnName, ...args];
    }

    // Mirror the strict `\sin^{-1}` convention: a `-1` exponent on a bare
    // function denotes the inverse function, not a reciprocal. For trig and
    // hyperbolic functions this canonicalizes to `Arcsin`, `Arsinh`, … so
    // `sin^-1 1` → `Arcsin(1)` (not `1/sin(1)`). Other exponents (e.g. `-2`)
    // stay a reciprocal power, matching strict `\sin^{-2}`.
    if (inverseExponent && Array.isArray(result)) {
      // In plain text a person also writes `sin^-1(x)` for the reciprocal
      // `1/sin(x)`, so the inverse reading is reported as a choice with a
      // second common reading. The span is the whole call.
      this._emitAmbiguity('ambiguous-inverse-function', start, this.index, {
        name,
      });
      const [head, ...callArgs] = result;
      return ['Apply', ['InverseFunction', head], ...callArgs];
    }

    return exponent !== null ? ['Power', result, exponent] : result;
  }

  private static readonly BARE_SYMBOL_MAP: Record<string, string> = {
    // Greek lowercase
    alpha: 'alpha',
    beta: 'beta',
    gamma: 'gamma',
    delta: 'delta',
    epsilon: 'epsilon',
    varepsilon: 'varepsilon',
    zeta: 'zeta',
    eta: 'eta',
    theta: 'theta',
    vartheta: 'vartheta',
    iota: 'iota',
    kappa: 'kappa',
    lambda: 'lambda',
    mu: 'mu',
    nu: 'nu',
    xi: 'xi',
    omicron: 'omicron',
    pi: 'Pi',
    rho: 'rho',
    sigma: 'sigma',
    tau: 'tau',
    upsilon: 'upsilon',
    phi: 'phi',
    varphi: 'varphi',
    chi: 'chi',
    psi: 'psi',
    omega: 'omega',
    // Greek uppercase
    Gamma: 'Gamma',
    Delta: 'Delta',
    Theta: 'Theta',
    Lambda: 'Lambda',
    Xi: 'Xi',
    Sigma: 'Sigma',
    Upsilon: 'Upsilon',
    Phi: 'Phi',
    Psi: 'Psi',
    Omega: 'Omega',
    // Special constants
    oo: 'PositiveInfinity',
    inf: 'PositiveInfinity',
    infinity: 'PositiveInfinity',
    ii: 'ImaginaryUnit',
  };

  /**
   * In non-strict mode, try to parse a bare symbol name like a Greek letter
   * or special constant (e.g., `alpha`, `pi`, `oo`, `ii`).
   */
  private tryParseBareSymbol(): MathJsonExpression | null {
    if (this.options.strict !== false) return null;

    const start = this.index;

    // Word boundary: if the preceding token is a letter, we're in the
    // middle of a word that was partially consumed — don't match. The
    // exception is the last part of a run that `tryParseBareRun()` left for
    // this step because a script follows it (`xalpha_1`).
    if (
      start > 0 &&
      /^[a-zA-Z]$/.test(this._tokens[start - 1]) &&
      start !== this._bareNameStart
    )
      return null;

    // Collect consecutive letter tokens
    let name = '';
    while (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
      name += this.peek;
      this.index++;
    }

    if (!name) {
      this.index = start;
      return null;
    }

    const symbolName = _Parser.BARE_SYMBOL_MAP[name];
    if (!symbolName) {
      this.index = start;
      return null;
    }

    // A spelled-out Greek name takes a subscript into its name, as the
    // backslash spelling does: `alpha_{01}` is `alpha_01` and `alpha_max` is
    // `alpha_max`, as `\alpha_{01}` and `\alpha_max` are. The join is the
    // join of the symbol parser (`absorbSubscripts()`), with its rules for an
    // unbraced subscript (a run of digits keeps its text, a run of two
    // letters before a script is split) and its diagnostics. The
    // requirements of the symbol parser apply: a base that evaluates its
    // subscript (`subscriptEvaluate`) or whose name is a function trigger of
    // the LaTeX dictionary keeps the subscript, and an indexed collection
    // base takes only a declared joined name. White space before the `_` stops the join, as
    // it does after a letter: `alpha _1` is the subscript `1` of `alpha`.
    // The ASCII names of constants (`oo`, `inf`, `infinity`, `ii`) do not
    // take a subscript into their name, as `\infty` does not.
    const seqStart = this._diagnosticsCheckpoint();
    const isGreekName = _Parser.SEGMENTABLE_SYMBOLS[name] !== undefined;
    let id: string = symbolName;
    if (
      isGreekName &&
      this.peek === '_' &&
      !this.isFunctionTriggerName(symbolName)
    ) {
      const info = this.resolveSymbol(symbolName);
      if (!info?.subscriptEvaluate)
        id = absorbSubscripts(
          this,
          symbolName,
          info?.type.matches('indexed_collection<any>') ?? false
        );
    }

    // Route the symbol through the shared emission point: a spelled-out
    // name that maps to an undeclared symbol (e.g. `alpha` under `strict:false`)
    // is a symbol reference that would otherwise bypass diagnostics. Mapped
    // constants (`oo`→`PositiveInfinity`, `pi`→`Pi`, …) are declared → no-op.
    // A name with a joined subscript is reported by its joined name.
    this.emitSymbolReference(id, start, this.index);
    // The end of an unbraced letter subscript has a second reading, as on
    // the backslash spelling: `alpha_max2` is `alpha_max·2`.
    if (id !== symbolName) this.emitSubscriptEndAmbiguity(id, start);

    // `ii` is read as the imaginary unit, and a person can mean the product
    // `i·i`.
    if (name === 'ii')
      this._emitAmbiguity('ambiguous-constant-name', start, this.index, {
        name: symbolName,
      });

    // A subscript after a superscript joins the name too, as on the
    // backslash spelling: `alpha^2_{01}` is `alpha_01^2` (see
    // `parseSupsub()`).
    if (isGreekName) this.recordSubscriptableSymbol(id, start, seqStart);

    return this.parseBareApplicationCandidate(id, start) ?? id;
  }

  /** Named constants that may be recognized *inside* a longer letter run by
   * `tryParseBareRun` (greedy longest-match). Only the spelled-out Greek
   * letters qualify: `2pix` → `2·π·x`, `xpi` → `x·π`. The ASCII shorthands
   * `oo`/`inf`/`infinity`/`ii` are deliberately excluded — they require word
   * boundaries (so `foo` stays `f·o·o`, not `f·∞`) and are matched only as
   * whole runs by `tryParseBareSymbol`. */
  private static readonly SEGMENTABLE_SYMBOLS: Record<string, string> =
    Object.fromEntries(
      Object.entries(_Parser.BARE_SYMBOL_MAP).filter(
        ([k]) => !['oo', 'inf', 'infinity', 'ii'].includes(k)
      )
    );

  /** Length of the longest key in `SEGMENTABLE_SYMBOLS`, used to bound the
   * greedy longest-match in `tryParseBareRun`. */
  private static readonly MAX_SEGMENTABLE_LENGTH = Math.max(
    ...Object.keys(_Parser.SEGMENTABLE_SYMBOLS).map((k) => k.length)
  );

  /** The MathJSON symbol names these constants map to (e.g. `alpha`, `Pi`).
   * Used by `parseSupsub` to allow an implicit subscript on a recognized
   * multi-letter constant base (`alpha2` → `alpha_2`). */
  private static readonly SEGMENTABLE_SYMBOL_VALUES: Set<string> = new Set(
    Object.values(_Parser.SEGMENTABLE_SYMBOLS)
  );

  /**
   * In non-strict mode, read the run of letters at the index as its parts:
   * the longest spelled-out Greek names, as `tryParseBareRun()` segments a
   * run, and single letters between them. `nalpha` is `n`, `alpha` and
   * `pi` is `Pi`. Each part is reported as a symbol reference. A run read
   * as more than one part with a name in it reports `ambiguous-letter-run`,
   * as `tryParseBareRun()` does. The `KroneckerDelta` entry uses it to
   * read a group of indices (`\delta_{nalpha}`). Return `null`, with the
   * index unchanged, in strict mode or when no letter is at the index.
   */
  _parseLetterRunParts(): MathJsonExpression[] | null {
    if (this.options.strict !== false) return null;
    const start = this.index;
    let name = '';
    while (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
      name += this.peek;
      this.index++;
    }
    if (!name) return null;
    const symbols = _Parser.SEGMENTABLE_SYMBOLS;
    const parts: MathJsonExpression[] = [];
    let matchedName = false;
    let i = 0;
    while (i < name.length) {
      let len = Math.min(name.length - i, _Parser.MAX_SEGMENTABLE_LENGTH);
      while (len >= 2 && symbols[name.slice(i, i + len)] === undefined) len--;
      let part: string = name[i];
      if (len >= 2) {
        part = symbols[name.slice(i, i + len)];
        matchedName = true;
      } else len = 1;
      parts.push(part);
      this.emitSymbolReference(part, start + i, start + i + len);
      i += len;
    }
    if (matchedName && parts.length > 1)
      this.emitLetterRunSplit(name, start, parts);
    return parts;
  }

  /**
   * In non-strict mode, handle a multi-letter run that is not itself a whole
   * known word. This runs *after* `tryParseBareFunction` and
   * `tryParseBareSymbol` have failed on the whole run.
   *
   * Two cases:
   * - A run that is exactly a known function name but reached here (i.e. could
   *   not be applied to an argument, e.g. `sin` in `sin*x` where the explicit
   *   `*` blocks the implicit argument) is returned as a single unknown symbol
   *   (`sin`), which is less surprising than the imaginary-unit letter soup
   *   `i·n·s`.
   * - Otherwise, greedily segment the run against the spelled-out Greek
   *   constants (`2pix` → `2·π·x`, `xpi` → `x·π`).
   * - A run with no Greek constant that is followed by a parenthesis (`(` or
   *   `\left(`) is ONE name: `foo(x)` is the symbol `foo` before the group,
   *   which the juxtaposition rule then reads as the application of `foo`.
   *   Split into letters it read as `f·o·o(x)`, the last letter applied — a
   *   reading no one writes. A subscripted run (`foo_1(x)`) is not read this
   *   way: the run ends at the `_`, and the subscript attaches to the last
   *   letter as before. Elsewhere the run is left untouched (returns `null`)
   *   so the existing per-letter parsing applies exactly as before.
   */
  private tryParseBareRun(): MathJsonExpression | null {
    if (this.options.strict !== false) return null;

    const start = this.index;

    // Word boundary: don't match in the middle of a partially consumed word.
    if (start > 0 && /^[a-zA-Z]$/.test(this._tokens[start - 1])) return null;

    // Collect the letter run.
    let name = '';
    while (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
      name += this.peek;
      this.index++;
    }

    // Only handle multi-letter runs. Single letters (including a standalone
    // `i`) are left to the existing symbol / imaginary-unit handling.
    if (name.length < 2) {
      this.index = start;
      return null;
    }

    // A whole run that is a known function name but could not be applied is
    // returned as a single unknown symbol (`sin*x` → `sin·x`).
    if (BARE_FUNCTION_MAP[name] !== undefined) {
      this.emitSymbolReference(name, start, this.index);
      // A function name with no argument (`y = min`, `sin*x`) is a symbol,
      // and a person can mean a call with an argument that is missing. A
      // name followed by a prime (`sin'(x)`) is the derivative of the
      // function, so the argument is not missing: it is not reported.
      if (this.peek !== "'" && this.peek !== '\\prime')
        this._emitAmbiguity('ambiguous-function-argument', start, this.index, {
          function: name,
        });
      return name;
    }

    // Greedy longest-match segmentation against spelled-out Greek constants.
    // The leftover letters are only NOTED here: a symbol reference is emitted
    // once the segmentation is adopted, so a run that is read another way
    // below leaves no diagnostic for letters that are not in the result.
    const symbols = _Parser.SEGMENTABLE_SYMBOLS;
    const segments: MathJsonExpression[] = [];
    const leftoverLetters: number[] = [];
    let matchedConstant = false;
    let i = 0;
    while (i < name.length) {
      let matched = false;
      const maxLen = Math.min(name.length - i, _Parser.MAX_SEGMENTABLE_LENGTH);
      // Segmentable constants are all at least 2 characters long.
      for (let len = maxLen; len >= 2; len--) {
        const candidate = name.slice(i, i + len);
        if (symbols[candidate] !== undefined) {
          segments.push(symbols[candidate]);
          i += len;
          matched = true;
          matchedConstant = true;
          break;
        }
      }
      if (!matched) {
        // A single leftover letter, kept as-is. (The boxer still maps the
        // identifiers `e`/`i` to `ExponentialE`/`ImaginaryUnit`, matching how
        // they parse standalone — that is a symbol-level decision, not one the
        // parser overrides here.)
        leftoverLetters.push(i);
        segments.push(name[i]);
        i += 1;
      }
    }

    if (!matchedConstant) {
      // Before a parenthesis the run is one name (see above). The spaces
      // between the run and the group do not separate them (`foo (x)`). A run
      // that a dictionary entry claims — a custom multi-letter trigger — is
      // left to that entry, which the dictionary dispatch reaches after this.
      let j = this.index;
      while (this._tokens[j] === '<space>') j++;
      // `\left` sizes whatever delimiter follows it; only `\left(` opens a
      // parenthesis (`ab\left|x\right|` stays the product `a·b·|x|`).
      const parenthesisFollows =
        this._tokens[j] === '(' ||
        (this._tokens[j] === '\\left' && this._tokens[j + 1] === '(');
      if (parenthesisFollows) {
        this.index = start;
        // A trigger that covers the run, or extends past it (`foo(`), claims
        // it; a universal definition (no trigger, count 0) claims nothing.
        const claimsRun = (defs: ReadonlyArray<[unknown, number]>): boolean =>
          defs.some(([, tokenCount]) => tokenCount > 0);
        const claimed =
          claimsRun(this.peekDefinitions('function') ?? []) ||
          claimsRun(this.peekDefinitions('expression') ?? []) ||
          claimsRun(this.peekDefinitions('symbol') ?? []);
        if (!claimed) {
          this.index = start + name.length;
          this.emitSymbolReference(name, start, this.index);
          return this.parseBareApplicationCandidate(name, start) ?? name;
        }
      }
      // Otherwise leave the run to the unchanged per-letter path.
      // `parsePrimary()` reports the split once that path has read the first
      // letter: reporting it here would be undone by the backtracking of the
      // dictionary dispatch that runs next (see `set index`).
      this.index = start;
      if (this.diagnostics !== null && !this.isDifferentialRun(start))
        this._splitLetterRun = { name, start };
      return null;
    }

    // A script, a prime or a digit directly after the run belongs to the
    // last part, as after a run of single letters (`xy_1` is `x·y_1`, `xy2`
    // is `x·y_2`) and after a command (`x\alpha_1` is `x·alpha_1`):
    // `xalpha_1` is `x·alpha_1`, `alphax^2` is `alpha·x^2` and `xalpha2` is
    // `x·alpha_2`. Before, the script applied to the product of the parts
    // (`(x·alpha)_1`), and the digit was a factor (`x·alpha·2`). The last
    // part is not read here: the index stops at its start, so that the next
    // primary reads it with its scripts, as `x` or as a spelled-out name
    // (see `_bareNameStart`).
    const lastLength = (segments[segments.length - 1] as string).length;
    const lastStart = start + name.length - lastLength;
    const splitLast =
      segments.length > 1 &&
      (this.peek === '_' ||
        this.peek === '^' ||
        this.peek === "'" ||
        this.peek === '\\prime' ||
        /^[0-9]$/.test(this.peek));

    // Each leftover letter is a single token, so its span is
    // `[start+i, start+i+1)`. A last part that the next primary reads is
    // reported there.
    for (const k of leftoverLetters)
      if (!splitLast || start + k < lastStart)
        this.emitSymbolReference(name[k], start + k, start + k + 1);
    if (segments.length > 1) this.emitLetterRunSplit(name, start, segments);
    // `Deltax` is `Δ·x`, and a person can mean the one symbol "change in x"
    // (see `emitJuxtapositionAmbiguity()` for `Δx`).
    let offset = 0;
    for (let k = 0; k < segments.length; k++) {
      const segment = segments[k] as string;
      if (segment === 'Delta' && k + 1 < segments.length)
        this._emitAmbiguity(
          'ambiguous-delta',
          start + offset,
          start + offset + 'Delta'.length + 1
        );
      // A segment is one letter or a spelled-out Greek name, and each name
      // has as many letters as its spelling (`pi` is `Pi`).
      offset += segment.length;
    }
    // (A copy: the `ambiguous-letter-run` diagnostic keeps `segments`.)
    const parts = splitLast ? segments.slice(0, -1) : segments;
    if (splitLast) {
      this.index = lastStart;
      if (lastLength > 1) this._bareNameStart = lastStart;
    }
    return parts.length === 1 ? parts[0] : ['Multiply', ...parts];
  }

  /**
   * Whether the letter run at token `start` is a differential (`d` and one
   * more letter) that is the numerator or the denominator of a differential
   * quotient: `dy/dx`, `d/dx`, `\frac{dy}{dx}`, `\frac{d}{dx}`. Such a run
   * is read as the intended product `d·y`, so it is not reported as a
   * `ambiguous-letter-run`. White space around the `/` is allowed.
   */
  private isDifferentialRun(start: number): boolean {
    const t = this._tokens;
    const isLetter = (i: number) =>
      t[i] !== undefined && /^[a-zA-Z]$/.test(t[i]);
    // `d` and one letter at `i`, with no letter on either side
    const isDiffRun = (i: number) =>
      t[i] === 'd' && isLetter(i + 1) && !isLetter(i + 2) && !isLetter(i - 1);
    // A lone `d` that ends at `i`
    const isLoneD = (i: number) =>
      t[i] === 'd' && !isLetter(i - 1) && !isLetter(i + 1);
    if (!isDiffRun(start)) return false;

    // `dy/dx`: the run is the numerator
    let j = start + 2;
    while (t[j] === '<space>') j++;
    if (t[j] === '/') {
      j++;
      while (t[j] === '<space>') j++;
      return isDiffRun(j);
    }
    // `dy/dx` or `d/dx`: the run is the denominator
    let i = start - 1;
    while (t[i] === '<space>') i--;
    if (t[i] === '/') {
      i--;
      while (t[i] === '<space>') i--;
      return isDiffRun(i - 1) || isLoneD(i);
    }
    // `\frac{dy}{dx}` or `\frac{d}{dx}`
    if (t[start - 1] !== '<{>' || t[start + 2] !== '<}>') return false;
    if (t[start - 2] === '\\frac')
      return (
        t[start + 3] === '<{>' && t[start + 6] === '<}>' && isDiffRun(start + 4)
      );
    if (t[start - 2] !== '<}>') return false;
    if (t[start - 6] === '\\frac' && t[start - 5] === '<{>')
      return isDiffRun(start - 4);
    return (
      t[start - 5] === '\\frac' && t[start - 4] === '<{>' && isLoneD(start - 3)
    );
  }

  /**
   * Record a `ambiguous-letter-run` diagnostic: the run of letters `run`, which
   * starts at token `start`, has no definition as a whole and is read as a
   * product of `parts` (`eps` is `e·p·s`, `xpi` is `x·π`). The diagnostic
   * span is the run. No-op unless diagnostics are enabled.
   */
  private emitLetterRunSplit(
    run: string,
    start: number,
    parts: MathJsonExpression[]
  ): void {
    if (this.diagnostics === null) return;
    this._emitAmbiguity('ambiguous-letter-run', start, start + run.length, {
      run,
      parts,
    });
  }

  /**
   * In non-strict mode, record a `ambiguous-letter-run` diagnostic when an
   * unbraced superscript or subscript that starts at token `scriptStart`
   * took only the first letter of a run of letters: `e^xy` is read as
   * `e^x·y` and `x^ab` as `x^a·b`. The letter may follow a sign (`e^-xy`).
   * The span is the whole run. `parts` is the script and the rest of the
   * run as written; the rest is then read on its own and can be reported
   * again if it is split. The reading does not change.
   */
  _emitScriptLetterRunSplit(
    scriptStart: number,
    script: MathJsonExpression
  ): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const t = this._tokens;
    const isLetter = (i: number) =>
      t[i] !== undefined && /^[a-zA-Z]$/.test(t[i]);
    let first = scriptStart;
    if (t[first] === '-' || t[first] === '+') first++;
    if (this.index !== first + 1 || !isLetter(first) || !isLetter(first + 1))
      return;
    let end = first + 1;
    while (isLetter(end)) end++;
    const run = t.slice(first, end).join('');
    this._emitAmbiguity('ambiguous-letter-run', first, end, {
      run,
      parts: [script, run.slice(1)],
    });
  }

  /**
   * In non-strict mode, record an `ambiguous-exponent-end` diagnostic when
   * the end of the unbraced exponent `sup`, which starts at token `supStart`
   * (after the `^`) and was just read, has a second common reading. The
   * index is at the end of the exponent. Three cases are reported:
   *
   * - an operand directly after the exponent: `e^2pi` is `e^2·π`, and a
   *   person can mean `e^{2π}`. The radical glyph `√` starts an operand
   *   (`e^θ√z`, `x^√θ√g`). When the exponent is one letter and a letter
   *   follows (`x^xy`), the `ambiguous-letter-run` diagnostic of
   *   `_emitScriptLetterRunSplit()` reports the run too;
   * - an operand after white space, when the exponent is a name, is signed,
   *   or the base is `e`: `e^i pi`, `e^-x y`, `e^2 pi i`, and a function
   *   call: `e^x cos(x)`, `e^-x sin x`. A number exponent on another base
   *   is not reported: `x^2 y` is `x^2·y`. The word `in` and a differential
   *   (`e^x dx`) after the white space are not reported;
   * - a `/` directly after an exponent that is a name, is signed or is the
   *   number 1: `e^x/2`, `x^1/2`. A `/` after another number is not
   *   reported: `x^3/2` is `x^3/2` by convention, `^` binds tighter than
   *   `/`.
   *
   * A braced or parenthesized exponent (`e^{2}pi`, `e^(2)pi`) has a clear
   * end and is not reported. The span starts at the base, at token
   * `baseStart` (at the `^` when `baseStart` is -1 or after it), and ends
   * after the operand that has the second reading: `e^2pi` gives `e^2pi`.
   * The diagnostic is anchored at the `^`: a rewind of the parser to before
   * the `^` removes it.
   */
  private emitExponentEndAmbiguity(
    base: MathJsonExpression | null,
    baseStart: number,
    supStart: number,
    sup: MathJsonExpression
  ): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const t = this._tokens;
    const signed = t[supStart] === '-' || t[supStart] === '+';
    const first = signed ? supStart + 1 : supStart;
    if (
      t[first] === '<{>' ||
      t[first] === '(' ||
      t[first] === '\\left' ||
      this.index <= first
    )
      return;
    const end = this.index;
    const exponent = this.latex(supStart, end);
    const isLetter = (i: number) =>
      t[i] !== undefined && /^[a-zA-Z]$/.test(t[i]);
    const exponentIsName =
      typeof sup === 'string' && !sup.startsWith("'") && !signed;
    const caret = supStart - 1;
    const spanStart = baseStart >= 0 && baseStart < caret ? baseStart : caret;
    // The span ends after the operand that starts at token `operandStart`:
    // for the radical glyph `√`, after its radicand.
    const report = (operandStart: number) =>
      this._emitAmbiguity(
        'ambiguous-exponent-end',
        spanStart,
        t[operandStart] === '√'
          ? operandEnd((k) => t[k], operandStart + 1)
          : operandEnd((k) => t[k], operandStart),
        { exponent },
        caret
      );

    // An operand directly after the exponent. The radical glyph `√` starts
    // an operand too: `e^θ√z` is `e^θ·√z`, and a person can mean
    // `e^{θ√z}`.
    const next = t[end];
    if (isOperandStartToken(next) || next === '√') {
      // `e^xy` is also reported as a letter run (see above). The span of
      // this diagnostic ends after the whole run.
      report(end);
      return;
    }

    // A `/` directly after the exponent
    if (next === '/') {
      if (exponentIsName || signed || sup === 1) report(end);
      return;
    }

    // An operand after white space
    if (next !== '<space>') return;
    const baseIsE = base === 'e' || base === 'ExponentialE';
    if (!exponentIsName && !signed && !baseIsE) return;
    let j = end;
    while (t[j] === '<space>') j++;
    if (!isOperandStartToken(t[j]) && t[j] !== '√') return;
    let word = '';
    for (let k = j; isLetter(k); k++) word += t[k];
    // A function name is an operand as another name is: `e^x cos(x)` is
    // `e^x·cos(x)`, and a person can mean `e^{x cos(x)}`, as `e^x y` can
    // mean `e^{xy}` and `e^-x sin x` can mean `e^{-x sin x}`.
    if (word === 'in') return;
    if (word.length === 2 && word[0] === 'd') return;
    report(j);
  }

  /**
   * In non-strict mode, whether the next tokens are the word `in` used as an
   * operator: the letters `i`, `n`, not preceded by a letter or a digit (so
   * `xin` and `2in` are not matched) and followed by a token that is not a
   * letter, a digit or `_` (so `int`, `inf`, `index`, `ink` and `in2` are not
   * matched). The end of the input does not count as a following token: the
   * operator needs a right operand.
   */
  private atBareInWord(): boolean {
    if (this.options.strict !== false) return false;
    const i = this.index;
    if (this._tokens[i] !== 'i' || this._tokens[i + 1] !== 'n') return false;
    if (i > 0 && /^[a-zA-Z0-9]$/.test(this._tokens[i - 1])) return false;
    const next = this._tokens[i + 2];
    if (next === undefined) return false;
    return !/^[a-zA-Z0-9_]$/.test(next);
  }

  /**
   * The precedence of the word `in` read as `\in` (see `atBareInWord()`):
   * the precedence of the first infix dictionary entry for `\in`. If there
   * is no such entry, return `Infinity`: no level stops at the word, and
   * `parseBareInOperator()` then reads nothing, so the word stays letters.
   */
  private bareInPrecedence(): number {
    const defs = this._dictionary.infixByTrigger.get('\\in') ?? [];
    for (const def of defs) if (def.kind === 'infix') return def.precedence;
    return Infinity;
  }

  /**
   * Read the word `in` (see `atBareInWord()`) with the dictionary definition
   * of `\in`, so `M in [0,1]` is the same as `M \in [0,1]`. Return `null`,
   * with the index unchanged, if the definition does not read the operands.
   */
  private parseBareInOperator(
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null {
    const start = this.index;
    const defs = this._dictionary.infixByTrigger.get('\\in') ?? [];
    for (const def of defs) {
      if (def.kind !== 'infix') continue;
      this.index = start + 2;
      const result = def.parse(this, lhs, until);
      if (result !== null) return result;
    }
    this.index = start;
    return null;
  }

  /**
   * Parse a sequence superfix/subfix operator, e.g. `^{*}`
   *
   * Superfix and subfix need special handling:
   *
   * - they act mostly like an infix operator, but they are commutative, i.e.
   * `x_a^b` should be parsed identically to `x^b_a`.
   *
   * - a second superscript on the same base (`x^a^b`) is a "Double
   *   superscript" error in LaTeX; we surface it as an error rather than
   *   gathering the scripts into a broadcasting `List` (see below).
   *
   */
  private parseSupsub(
    lhs: MathJsonExpression,
    pending?: { superscript: MathJsonExpression; start: number }
  ): MathJsonExpression | null {
    // `pending` is a superscript already read by the caller, starting at the
    // `^` token at `pending.start` (see `_parseLenientSignedExponent()`). The
    // scripts that follow it are gathered with it, as if this method had
    // read it.
    if (this.atEnd && !pending) return lhs;
    console.assert(lhs !== null);

    const index = pending?.start ?? this.index;
    // The start of the base, read before the scripts: the parse of a script
    // can change `_scriptBaseStart` while it runs.
    const baseStart = this._scriptBaseStart;
    // The base is a symbol whose spelling takes a subscript into its name
    // (`x`, `\alpha`, `θ`, `\pi`), read just before the scripts, or such a
    // symbol with prime marks (`x'`, `f''`, `x^{\prime}`). Read it here: the
    // parse of a script reads other symbols.
    const symbolBase = this._subscriptableSymbol;
    const primed =
      (operator(lhs) === 'Prime' || operator(lhs) === 'Derivative') &&
      typeof operand(lhs, 1) === 'string';
    const between =
      symbolBase === null ? [] : this._tokens.slice(symbolBase.end, index);
    const isSymbolBase =
      (typeof lhs === 'string' || primed) &&
      symbolBase !== null &&
      symbolBase.id === (primed ? operand(lhs, 1) : lhs) &&
      symbolBase.start === baseStart &&
      (primed
        ? isPrimeMarkSpan(between)
        : between.every((token) => token === '<space>'));

    // In non-strict mode, a single letter immediately followed by one or more
    // digits is treated as an implicit *subscript*: `x2 → x_2`, `x1 → x_1`,
    // `x12 → x_12`. Flattened subscripts (indexed variables such as `x1`, `x2`,
    // …) are the common intent of ASCII/copy-paste input; producing a subscript
    // (rather than a superscript power) preserves the index, matches the strict
    // `x_2` form. Loose adjacent digits are ordinary identifier text.
    // The base may be a single letter (`x2`) or a recognized multi-letter
    // constant name (`alpha2` → `alpha_2`, `Pi2` → `Pi_2`); an arbitrary
    // multi-letter run never reaches here as a single string (it is a product),
    // so this stays conservative.
    // Check before skipSpace() to require true adjacency.
    if (
      !pending &&
      this.options.strict === false &&
      typeof lhs === 'string' &&
      ((lhs.length === 1 && /^[a-zA-Z]$/.test(lhs)) ||
        _Parser.SEGMENTABLE_SYMBOL_VALUES.has(lhs)) &&
      /^[0-9]$/.test(this.peek)
    ) {
      let digits = '';
      while (!this.atEnd && /^[0-9]$/.test(this.peek)) {
        digits += this.peek;
        this.index++;
      }
      // `x2` is read as `x_2`, and a person can mean `x·2`. The span starts
      // at the base: a spelled-out name (`alpha2`) is a run of letters, any
      // other base is one token (`x`, `θ`, `\pi`).
      let baseStart = index - 1;
      if (lhs.length > 1 && /^[a-zA-Z]$/.test(this._tokens[baseStart]))
        while (
          baseStart > 0 &&
          /^[a-zA-Z]$/.test(this._tokens[baseStart - 1]) &&
          index - baseStart < lhs.length
        )
          baseStart--;
      // The digits keep their text when their number value does not:
      // `x01` is the symbol `x_01`, as `x_01` is, and not `x_1`. So is a
      // run that a JavaScript number cannot hold exactly.
      const value = Number(digits);
      const keepText =
        (digits.length > 1 && digits[0] === '0') ||
        !Number.isSafeInteger(value);
      this._emitAmbiguity(
        'ambiguous-implicit-subscript',
        baseStart,
        this.index,
        { base: lhs, subscript: keepText ? digits : value }
      );
      return this.parseSupsub(
        keepText ? `${lhs}_${digits}` : ['Subscript', lhs, value]
      );
    }

    // The end of the last script that was read, before the white space after
    // it. A subscript whose `_` is not at this index has white space before
    // it.
    let scriptEnd = this.index;
    this.skipSpaceBeforeScript();

    //
    // 1/ Gather possible superscript/subscripts
    //
    const superscripts: MathJsonExpression[] = pending
      ? [pending.superscript]
      : [];
    const subscripts: MathJsonExpression[] = [];
    let subIndex = index;
    // True when a subscript run was joined to the base symbol name (`lhs`)
    let joinedBase = false;
    while (this.peek === '_' || this.peek === '^' || this.atDoubleStar()) {
      // A subscript after a superscript on a symbol base has the reading
      // that the symbol parser gives to a subscript before the superscript,
      // in both grammars: the subscript joins the symbol name. So
      // `x^2_{01}` is `x_01^2`, as `x_{01}^2` is (the number value of the
      // group `{01}` drops the zero). `\alpha^2_01` is `alpha_01^2` in the
      // non-strict grammar, as `\alpha_01^2` is. On a primed symbol, the
      // subscript joins the name under the prime: `x'^2_{01}` is
      // `(x_01')^2`, as `x_{01}'^2` is. The requirements of the symbol
      // parser apply: a base with `subscriptEvaluate` keeps its subscript,
      // and an indexed collection base takes only a declared joined name.
      // White space directly before the `_` stops the join, as it does when
      // the subscript comes first: the symbol parser does not join `x _{01}`,
      // which is the subscript `1` of `x`. So `x^2 _{01}` is `x_1^2`, as
      // `x _{01}^2` is. White space before the superscript does not stop
      // the join: `x ^2_{01}` is `x_01^2`, as `x_{01} ^2` is.
      //
      // A dictionary entry whose trigger is the base with the subscript has
      // the first priority, as it has when the subscript comes first:
      // `\delta^2_{ij}` is `KroneckerDelta(i, j)^2` and `\mu^2_0` is
      // `Mu0^2`, as `\delta_{ij}^2` and `\mu_0^2` are. Before, the subscript
      // joined the name: `delta_ij^2` and `mu_0^2`. The base can also be a
      // set that a dictionary entry reads: `\R^2_-` is `NegativeNumbers^2`
      // and `\mathbb{R}^2_{>0}` is `PositiveNumbers^2`, as `\R_-^2` and
      // `\mathbb{R}_{>0}^2` are. Before, they were a syntax error and
      // `Subscript(RealNumbers, Error)^2`. The tokens of the base are the
      // tokens from the start of the primary to the first script. White
      // space before the `_` does not stop a dictionary entry: LaTeX
      // ignores it, so `\mu^2 _0` is `Mu0^2` and `\R^2 _-` is
      // `NegativeNumbers^2`, as `\mu^2_0` and `\R^2_-` are. Before, they
      // were `mu_0^2` and a syntax error. (The tokenizer drops the space
      // after a command, so `\mu _0^2` has no white space before the `_`.)
      // White space stops only the join of the subscript to a symbol name.
      if (
        typeof lhs === 'string' &&
        baseStart >= 0 &&
        baseStart < index &&
        !joinedBase &&
        this.peek === '_' &&
        superscripts.length > 0 &&
        subscripts.length === 0
      ) {
        let baseEnd = index;
        while (baseEnd > baseStart && this._tokens[baseEnd - 1] === '<space>')
          baseEnd--;
        const triggered = this.parseSubscriptTriggerAfterBase(
          this._tokens.slice(baseStart, baseEnd)
        );
        if (triggered !== null) {
          lhs = triggered;
          joinedBase = true;
          subIndex = this.index;
          this.skipSpaceBeforeScript();
          continue;
        }
      }
      if (
        isSymbolBase &&
        !joinedBase &&
        this.peek === '_' &&
        this.index === scriptEnd &&
        superscripts.length > 0 &&
        subscripts.length === 0
      ) {
        const id = symbolBase!.id;
        const info = this.resolveSymbol(id);
        const joined = info?.subscriptEvaluate
          ? id
          : absorbSubscripts(
              this,
              id,
              info?.type.matches('indexed_collection<any>') ?? false
            );
        if (joined !== id) {
          // The symbol is the joined name, not the base: replace the
          // `undeclared-symbol` diagnostic of the base, as the symbol
          // parser reports only the joined name.
          this.removeSymbolReference(symbolBase!);
          if (!this.resolveSymbol(joined)?.type.matches('error'))
            this.emitSymbolReference(joined, baseStart, this.index);
          this.emitSubscriptEndAmbiguity(joined, baseStart);
          lhs = primed
            ? [operator(lhs), joined, ...operands(lhs).slice(1)]
            : joined;
          joinedBase = true;
          subIndex = this.index;
          this.skipSpaceBeforeScript();
          continue;
        }
      }
      if (this.match('_')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          subscripts.push(this.error('syntax-error', subIndex));
        else {
          let sub = this.parseGroup();
          // In non-strict mode, consume consecutive digits as subscript
          // before parseToken(), which would only consume a single digit
          if (sub === null && this.options.strict === false) {
            // A run that starts with `0` gives only the `0`, as in the
            // strict grammar: the number value of `01` drops the zero.
            // `(x)^2_01` is `(x)_0^2·1`, and a person can mean
            // `(x)_{01}^2`. A symbol base keeps the run as text (see above).
            let digits = '';
            while (!this.atEnd && /^[0-9]$/.test(this.peek) && digits !== '0') {
              digits += this.peek;
              this.index++;
            }
            if (digits) sub = digitRunNumber(digits);
            const base = symbol(lhs) !== null ? { base: symbol(lhs) } : {};
            // `x_1y` is read as `x_1·y`, and a person can mean `x_{1y}`.
            if (digits && /^\p{L}$/u.test(this.peek))
              this._emitAmbiguity(
                'ambiguous-implicit-subscript',
                subIndex - 1,
                this.index + 1,
                { ...base, subscript: sub }
              );
            else if (digits === '0' && /^[0-9]$/.test(this.peek)) {
              let end = this.index;
              while (/^[0-9]$/.test(this._tokens[end] ?? '')) end++;
              this._emitAmbiguity(
                'ambiguous-implicit-subscript',
                subIndex - 1,
                end,
                { ...base, subscript: 0 }
              );
            }
          }
          sub ??= this.parseToken();
          // In non-strict mode, also accept parenthesized expressions
          // Note: After match('_'), peek has changed but TypeScript doesn't know
          if (
            sub === null &&
            this.options.strict === false &&
            (this.peek as string) === '('
          )
            sub = this.parseEnclosure();
          sub ??= this.parseStringGroup();
          if (sub === null) return this.error('missing', index);
          this._emitScriptLetterRunSplit(subIndex, sub);

          subscripts.push(sub);
        }
      } else if (this.match('^') || this.matchDoubleStar()) {
        // In non-strict mode, `**` is read as `^` (see `atDoubleStar()`).
        const doubleStar = this._tokens[this.index - 1] === '*';
        // In non-strict mode, white space after `^` does not change the
        // reading: `x ^ pi` is `x^pi`, and `e^ -x` is `e^-x`.
        if (this.options.strict === false) this.skipSpace();
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          superscripts.push(this.error('syntax-error', subIndex));
        else {
          // A chain of `**` is read from the right, as in programming
          // languages: `2**3**2` is `2^(3^2)`. A `^` after a `**` exponent
          // is a second superscript, an error, as `x^y^z` is.
          const sup = doubleStar
            ? this.parseDoubleStarExponent()
            : this.parseUnbracedSuperscript();
          if (sup === null) return this.error('missing', index);
          this._emitScriptLetterRunSplit(subIndex, sup);
          // A second superscript is an error (see below): not reported
          if (superscripts.length === 0)
            this.emitExponentEndAmbiguity(lhs, baseStart, subIndex, sup);
          superscripts.push(sup);
        }
      }
      subIndex = this.index;
      scriptEnd = this.index;
      this.skipSpaceBeforeScript();
    }

    if (superscripts.length === 0 && subscripts.length === 0) {
      if (!joinedBase) this.index = index;
      return lhs;
    }

    let result: MathJsonExpression | null = lhs;

    //
    // 2/ Apply subscripts (first)
    //
    // An empty subscript (e.g. `x_{}`) is dropped, mirroring the empty
    // superscript handling below — the base is returned unchanged.
    const nonEmptySubscripts = subscripts.filter(
      (x) => !isEmptySequence(x)
    ) as MathJsonExpression[];
    if (nonEmptySubscripts.length > 0) {
      // The `infixByTrigger` index buckets are in priority order
      // (later definitions first), same as filtering `getDefs('infix')`
      const defs = this._dictionary.infixByTrigger.get('_') ?? [];
      if (defs) {
        const arg: MathJsonExpression = [
          'Subscript',
          result,
          nonEmptySubscripts.length === 1
            ? nonEmptySubscripts[0]
            : ['List', ...nonEmptySubscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = def.parse(this, arg, { minPrec: 0 });
          else result = arg;
          if (result !== null) break;
        }
      }
    }

    //
    // 3/ Apply superscripts (second)
    //
    if (superscripts.length > 0) {
      const defs = this._dictionary.infixByTrigger.get('^') ?? [];

      if (defs) {
        // Drop empty superscripts (`x^{}`) and ordinal-suffix text runs
        // (`13^{\text{th}}`, `21^{\text{st}}`): the latter is typographic
        // decoration (an ordinal number written in LaTeX), not a power, so it
        // devolves to the base. Only an exact ordinal suffix string
        // (st/nd/rd/th, case-insensitive) is dropped; other text like
        // `x^{\text{m}}` is left untouched.
        const nonEmptySuperscripts = superscripts.filter((x) => {
          if (isEmptySequence(x)) return false;
          const s = stringValue(x);
          if (s !== null && /^(?:st|nd|rd|th)$/i.test(s)) return false;
          return true;
        }) as MathJsonExpression[];
        // In LaTeX, a second superscript on the same base (e.g. `x^2^3`) is a
        // "Double superscript" error. Previously these were gathered into a
        // `List`, which then *broadcasts* under evaluation (`2^3^4` → [8, 16]),
        // silently corrupting the value. Surface an error instead; the
        // intended nesting is written explicitly as `x^{2^3}`.
        if (nonEmptySuperscripts.length > 1)
          return this.error('unexpected-superscript', index);
        if (nonEmptySuperscripts.length !== 0) {
          const superscriptExpression: MathJsonExpression =
            nonEmptySuperscripts[0];
          result = this.applySuperscript(result!, superscriptExpression);
        }
      }
    }

    // Restore the index if we did not find a match
    if (result === null) this.index = index;

    return result;
  }

  /**
   * In non-strict mode, whether the next tokens are `**`, the exponent
   * operator of programming languages, read as `^` by `parseSupsub()`. So
   * `**` binds as `^` does: `-e**x` is `-(e^x)`, and `x**2y` is `x^2·y`.
   */
  private atDoubleStar(): boolean {
    return (
      this.options.strict === false &&
      this.peek === '*' &&
      this._tokens[this.index + 1] === '*'
    );
  }

  /** Match the two tokens of `**` in non-strict mode (see `atDoubleStar()`). */
  private matchDoubleStar(): boolean {
    if (!this.atDoubleStar()) return false;
    this.index += 2;
    return true;
  }

  /**
   * Read the superscript after `^` (or `**`): a braced group, or in
   * non-strict mode one unbraced operand (`x^12`, `x^2.5`, `x^pi`,
   * `e^sin(x)`, `e^-x`), or a single token, or in non-strict mode a
   * parenthesized expression. `spaceAfterSign` is passed to
   * `parseLenientExponent()`. Return `null` if there is no superscript.
   */
  private parseUnbracedSuperscript(
    spaceAfterSign = false
  ): MathJsonExpression | null {
    let sup = this.parseGroup();
    // In non-strict mode, an unbraced exponent is one whole operand, not the
    // single token parseToken() would read.
    if (sup === null && this.options.strict === false)
      sup = this.parseLenientExponent(spaceAfterSign);
    sup ??= this.parseToken();
    // In non-strict mode, also accept parenthesized expressions
    if (sup === null && this.options.strict === false && this.peek === '(')
      sup = this.parseEnclosure();
    return sup;
  }

  /**
   * In non-strict mode, after the exponent `exponent` of a `**`, read the
   * `**` operators that follow, from the right: `2**3**2` is `2^(3^2)`.
   * Return `exponent` when no `**` follows, and `null` when a `**` has no
   * exponent.
   */
  private parseDoubleStarTower(
    exponent: MathJsonExpression
  ): MathJsonExpression | null {
    const start = this.index;
    this.skipSpace();
    if (!this.matchDoubleStar()) {
      this.index = start;
      return exponent;
    }
    this.skipSpace();
    const next = this.parseDoubleStarExponent();
    if (next === null) return null;
    return this.applySuperscript(exponent, next);
  }

  /**
   * In non-strict mode, read the exponent after a `**` and the `**`
   * operators that follow it (see `parseDoubleStarTower()`). A sign before
   * the exponent applies to the whole rest of the chain, as in Python:
   * `2**-3**2` is `2^(-(3^2))`, not `2^((-3)^2)`. Return `null` when there
   * is no exponent.
   */
  private parseDoubleStarExponent(): MathJsonExpression | null {
    let sign = this.peek === '-' || this.peek === '+' ? this.peek : null;
    const sup = this.parseUnbracedSuperscript(true);
    if (sup === null) return null;
    // Get the operand after the sign. A `-` before a run of digits gives a
    // negative number (`-3`), before any other operand a `Negate`. If the
    // sign was not read as the sign of the operand, the exponent is used
    // as it is.
    let operand: MathJsonExpression = sup;
    if (sign === '-') {
      if (typeof sup === 'number' && (sup < 0 || Object.is(sup, -0)))
        operand = -sup;
      else if (Array.isArray(sup) && sup[0] === 'Negate' && sup.length === 2)
        operand = sup[1] as MathJsonExpression;
      else sign = null;
    }
    const tower = this.parseDoubleStarTower(operand);
    if (tower === null) return null;
    // No `**` follows: keep the exponent as it was read (`2**-3` is
    // `2^(-3)`, with the number `-3`).
    if (tower === operand) return sup;
    return sign === '-' ? ['Negate', tower] : tower;
  }

  /**
   * Read `base` with the superscript `sup` using the dictionary entries
   * triggered by `^` (the last step of `parseSupsub()`).
   */
  private applySuperscript(
    base: MathJsonExpression,
    sup: MathJsonExpression
  ): MathJsonExpression | null {
    const arg: MathJsonExpression = ['Superscript', base, sup];
    const defs = this._dictionary.infixByTrigger.get('^') ?? [];
    if (defs.length === 0) return base;
    let result: MathJsonExpression | null = null;
    for (const def of defs) {
      if (typeof def.parse === 'function')
        result = def.parse(this, arg, { minPrec: 0 });
      else result = arg;
      if (result !== null) break;
    }
    return result;
  }

  /**
   * In non-strict mode, read an unbraced exponent after `^`: an optional
   * sign followed by one operand (see `parseLenientExponentOperand()`).
   *
   * - A `-` followed by a run of digits is a negative integer literal
   *   (`x^-2` is `Power(x, -2)`).
   * - Any other `-` operand is negated (`e^-x` is `Power(e, Negate(x))`,
   *   the same as `e^{-x}`); a `+` is dropped (`e^+x` is `e^{+x}`).
   * - After a sign, a parenthesized group (`e^-(x)`), a braced group
   *   (`e^-{x}`) and any single token `parseToken()` reads (`e^-x`,
   *   `e^-\pi`) are also an operand. Without a sign the caller reads those.
   *   White space after the sign is skipped only when `spaceAfterSign` is
   *   true (see `_parseLenientSignedExponent()` and `**`): `\R^+ x` keeps
   *   its reading.
   *   A `_`, a `^`, a visual-spacing command or a closing delimiter after
   *   the sign is not an operand either (see `atSignedExponentOperand()`).
   *
   * Return `null`, with the index unchanged, if there is no such exponent.
   */
  private parseLenientExponent(
    spaceAfterSign = false
  ): MathJsonExpression | null {
    const start = this.index;
    const sign = this.peek === '-' || this.peek === '+' ? this.peek : null;
    if (sign === null) return this.parseLenientExponentOperand()?.[0] ?? null;

    this.index++;
    if (spaceAfterSign) this.skipSpace();
    let operand = this.parseLenientExponentOperand();
    if (operand === null && this.atSignedExponentOperand()) {
      const expr =
        this.peek === '(' || this.peek === '\\left'
          ? this.parseEnclosure()
          : this.peek === '<{>'
            ? this.parseGroup()
            : this.parseToken();
      if (expr !== null) operand = [expr, false];
    }
    if (operand === null) {
      this.index = start;
      return null;
    }
    const [expr, isDigitRun] = operand;
    if (sign === '+') return expr;
    if (isDigitRun && typeof expr === 'number') return -expr;
    return ['Negate', expr];
  }

  /**
   * Whether the token after the sign of an unbraced exponent (`^-`, `^+`)
   * can start the exponent operand. It cannot when it is the end of the
   * input, white space, a `_` or `^`, a visual-spacing command (`\,`,
   * `\quad`, `\hspace`, ...) or a closing delimiter. In that case the sign
   * is not followed by an operand, and the postfix reading of `^-`/`^+` is
   * kept: `n^+_k` is `Subscript(PseudoInverse(n), k)` and `x^-\,y` is
   * `Superminus(x)·y`.
   */
  private atSignedExponentOperand(): boolean {
    if (this.atEnd) return false;
    const tok = this.peek;
    return !(
      tok === '<space>' ||
      tok === '_' ||
      tok === '^' ||
      tok === '<}>' ||
      VISUAL_SPACE_COMMANDS.has(tok) ||
      tok === '\\hspace' ||
      tok === '\\hskip' ||
      tok === '\\kern' ||
      CLOSE_DELIMITER_PREFIX.has(tok) ||
      Object.values(CLOSE_DELIMITER).includes(tok)
    );
  }

  /**
   * In non-strict mode, read one operand of an unbraced exponent, the same
   * way the braced exponent would read it:
   *
   * - a run of digits, with its decimal part if the decimal separator is
   *   followed by a digit (`x^12`, `x^2.5`). Letters after the digits are
   *   not part of the operand (`x^2y` is `x^2·y`, `e^2pi` is `e^2·π`);
   * - a whole word that names a constant in non-strict mode (`x^pi`,
   *   `x^theta`, `x^inf`), when no digit or `_` follows it;
   * - a bare function name directly followed by a parenthesis (`e^sin(x)`).
   *
   * Any other token is left to the caller: a single letter (`e^x`), a letter
   * run that is not a whole known word (`x^ab` is `x^a·b`). White space ends
   * the operand.
   *
   * Return the operand and whether it is a plain run of digits, or `null`
   * with the index unchanged.
   */
  private parseLenientExponentOperand():
    [expr: MathJsonExpression, isDigitRun: boolean] | null {
    const start = this.index;
    const isDigit = (t: string | undefined) =>
      t !== undefined && /^[0-9]$/.test(t);

    if (isDigit(this.peek)) {
      let i = start;
      let digits = '';
      while (isDigit(this._tokens[i])) digits += this._tokens[i++];
      const sep = this._decimalSeparatorTokens;
      if (
        sep.length > 0 &&
        sep.every((t, k) => this._tokens[i + k] === t) &&
        isDigit(this._tokens[i + sep.length])
      ) {
        let end = i + sep.length;
        while (isDigit(this._tokens[end])) end++;
        // Read the decimal number with the number reader, so the result is
        // the same as in the braced spelling. Accept it only if the reader
        // stopped where the digits stop.
        const num = this.parseNumber();
        if (num !== null && this.index === end) return [num, false];
        this.index = start;
      }
      this.index = i;
      return [digitRunNumber(digits), true];
    }

    if (!/^[a-zA-Z]$/.test(this.peek)) return null;
    let end = start;
    let word = '';
    while (end < this._tokens.length && /^[a-zA-Z]$/.test(this._tokens[end]))
      word += this._tokens[end++];
    if (word.length < 2) return null;
    const next = this._tokens[end];
    let expr: MathJsonExpression | null = null;
    // A known name is the operand also when a `_` or a digit follows it, as
    // the command spelling is: `x^alpha_1` is `x^{alpha_1}`, as `x^\alpha_1`
    // is (`tryParseBareSymbol()` joins the subscript to the name), and
    // `x^alpha2` is `x^alpha·2`, as `x^\alpha2` is. Before, the name was
    // read one letter at a time: `x^a·l·p·h·a_1`.
    if (_Parser.BARE_SYMBOL_MAP[word] !== undefined)
      expr = this.tryParseBareSymbol();
    else if (BARE_FUNCTION_MAP[word] !== undefined && next === '(')
      expr = this.tryParseBareFunction();
    if (expr === null) {
      this.index = start;
      return null;
    }
    return [expr, false];
  }

  /**
   * In non-strict mode, read a signed exponent for the postfix entries
   * triggered by `^-` and `^+` (`Superminus`, `Superplus`, `PseudoInverse`),
   * which run before `parseSupsub()`: `e^-x` is `Power(e, Negate(x))`, not
   * `Superminus(e)·x`. The index is after the sign. Return `null`, with the
   * index unchanged, when no operand follows the sign directly (`\Z^+`,
   * `x \to 0^+`), so the postfix entry keeps its reading.
   *
   * When the sign is `-` and the base is a plain letter (`e`, `x`, `θ`),
   * white space after the sign is skipped: `e^- x` is `e^-x`, not
   * `Superminus(e)·x`. A `+` keeps the postfix reading (`A^+ x` is the
   * pseudo-inverse of `A` times `x`), and so does a base that is a command
   * (`\R^- x`), a digit (`0^- x`) or a group.
   */
  _parseLenientSignedExponent(
    lhs: MathJsonExpression,
    sign: '-' | '+'
  ): MathJsonExpression | null {
    if (this.options.strict !== false) return null;
    const start = this.index;
    if (this._tokens[start - 1] !== sign || this._tokens[start - 2] !== '^')
      return null;
    const baseStart = this._scriptBaseStart;
    let b = start - 3;
    while (this._tokens[b] === '<space>') b--;
    // A Unicode double-struck letter (`ℝ`) is a one-character spelling of a
    // `\mathbb{…}` command and is read as a command base, not as a letter:
    // `ℝ^- x` keeps the negative-set reading of `\mathbb{R}^- x`.
    const baseToken = this._tokens[b] ?? '';
    const letterBase =
      sign === '-' &&
      /^\p{L}$/u.test(baseToken) &&
      !/^[ℕℤℚℝℂ]$/.test(baseToken);
    this.index = start - 1;
    const superscript = this.parseLenientExponent(letterBase);
    if (superscript === null) {
      this.index = start;
      return null;
    }
    this._emitScriptLetterRunSplit(start - 1, superscript);
    const checkpoint = this._diagnosticsCheckpoint();
    this.emitExponentEndAmbiguity(lhs, baseStart, start - 1, superscript);
    // Gather the scripts that follow as `parseSupsub()` does for `e^{-x}`, so
    // `e^-x^2` is the same double-superscript error as `e^{-x}^2`.
    const result = this.parseSupsub(lhs, { superscript, start: start - 2 });
    if (result === null) {
      // The exponent diagnostic is anchored at the `^`, before `start`, so
      // the rewind below does not remove it.
      this._rollbackDiagnostics(checkpoint);
      this.index = start;
    }
    return result;
  }

  parsePostfixOperator(
    lhs: MathJsonExpression | null,
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    console.assert(lhs !== null); // @todo validate
    if (lhs === null || this.atEnd) return null;

    const start = this.index;
    // Space before a postfix trigger:
    //  - A `\{…\}` When-restriction attaches after any space, plain or visual
    //    (`\,`, `\quad`), so visual space is skipped before a brace trigger.
    //  - An index bracket (`[`, `\lbrack`, `\left[`, `\left\lbrack`) attaches
    //    after PLAIN whitespace only, because LaTeX ignores that whitespace:
    //    `a [1,2]` reads as `a[1,2]`. The tokenizer also turns `\ `, `~` and
    //    `\space` into plain whitespace, so `a\ [1,2]` is an index too.
    //  - A visual-space command before a bracket (`a\,[1,2]`) means
    //    multiplication by a list literal (Desmos semantics), not an index:
    //    no postfix is tried here, and `parseNumberTimesList()` reads the
    //    list as a factor.
    //  - Every other postfix trigger also attaches after PLAIN whitespace,
    //    for the same reason: `n !` is `n!`, `(x+1) !` is `(x+1)!`,
    //    `30 \degree` is `30°` and `f '(x)` is `f'(x)`. Before, the `!` of
    //    `n !` found no operand and the line was read as `n` followed by a
    //    `Factorial` of a `missing` error, while `3 !` and `x^2 !` read as
    //    factorials on other routes. One trigger keeps the no-space rule:
    //    the member access `.`, because `v .x` is not the member access
    //    `v.x` (it is an error, as before).
    //    A trigger after white space also defers to the terminator of the
    //    caller: the implicit argument of a function name ends before a
    //    `!` after white space, so `tan x !` is `(tan x)!` (see
    //    `parseArguments()`). The white space can be skipped here or
    //    already consumed by the operand (a number reads its digit groups
    //    across white space, so `tan 2 !` reaches this point at the `!`),
    //    so the token before the trigger is tested.
    // The `this.index = start` no-match restore rolls back the skipped space.
    this.skipVisualSpace();
    if (this.index !== start) {
      const tok = this._tokens[this.index];
      const isBraceTrigger =
        tok === '\\{' ||
        (tok === '\\left' && this._tokens[this.index + 1] === '\\{');
      if (!isBraceTrigger) {
        this.index = start;
        this.skipSpace();
        if (this._tokens[this.index] === '.') this.index = start;
      }
    }
    if (
      (this.index !== start || this._tokens[start - 1] === '<space>') &&
      (until?.condition?.(this) ?? false)
    ) {
      this.index = start;
      return null;
    }
    const afterSpace = this.index;
    for (const [def, n] of this.peekDefinitions('postfix')) {
      this.index = afterSpace + n;
      const result = def.parse(this, lhs, until);
      if (result !== null) return result;
    }
    this.index = start;
    return null;
  }

  /**
   * This method can be invoked when we know we're in an error situation,
   * for example when there are tokens remaining after we've finished parsing.
   *
   * In general, if a context does not apply, we return `null` to give
   * the chance to some other option to be considered. However, in some cases
   * we know we've exhausted all possibilities, and in this case this method
   * will return an error expression as informative as possible.
   *
   * We've encountered a LaTeX command or symbol but were not able to match it
   * to any entry in the LaTeX dictionary, or ran into it in an unexpected
   * context (postfix operator lacking an argument, for example)
   */
  parseSyntaxError(): MathJsonExpression {
    const start = this.index;

    //
    // Is this an unexpected operator?
    // (this is an error handling code path)
    //
    // '^' is a special infix operator, with a custom parser
    if (this.peek === '^') {
      this.index += 1;
      return [
        'Superscript',
        this.error('missing', start),
        missingIfEmpty(this.parseGroup()),
      ];
    }

    let opDefs = this.peekDefinitions('operator');
    if (opDefs.length > 0) {
      opDefs = this.peekDefinitions('postfix');
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedPostfixEntry, number];
        this.index += n;
        if (typeof def.parse === 'function') {
          const result = def.parse(this, this.error('missing', start));
          if (result !== null) return result;
        }
        // The postfix reading declined (e.g. the ring-quotient `/`, which only
        // claims the `R/mR` shape). A token can carry several operator
        // readings, so fall through to the prefix/infix ones when they exist
        // instead of giving up here — `/2` must still recover as
        // `Divide(missing, 2)`. With no alternative reading, report the
        // unexpected operator from where the declined parse left off (so the
        // error still carries the offending token).
        //
        // A NAMED postfix entry is deliberately NOT recovered here as
        // `[def.name, missing]` (which is what `0e8c11b9` removed): the only
        // named entry that reaches this point is `At`, and `2[1,2)` /
        // `\foo[0]{1}{2}` are pinned to the `unexpected-operator` reading by
        // `delimiters.test.ts` and `serialize.test.ts` — pins added AFTER
        // `0e8c11b9`, so the plain error is the intended recovery. (`!` alone
        // still yields `['Factorial', missing]`; it never reaches this path.)
        //
        // BREADTH: this fall-through applies to EVERY postfix entry that
        // declines (or has no `parse` handler at all), not only the
        // ring-quotient parselet that motivated it. Scan of the default LaTeX
        // dictionary on 2026-08-05 — matching each postfix trigger against the
        // prefix/infix triggers that can also match at the same index — found
        // the postfix entries with an alternative reading reachable here to be:
        // `/` (vs `Divide` and `SlashEqual`), the `_` family (`_`, `_+`, `_-`,
        // `_*`, `_\star` vs `Subscript`), `.` (vs `Range`) and `!` (vs
        // `Unequal`, and only when followed by `=`). The `^` family never
        // reaches this code: `^` is intercepted at the top of this method.
        // A postfix entry added later whose trigger collides with a
        // prefix/infix one has its error recovery changed by this path.
        const afterPostfix = this.index;
        this.index = start;
        if (
          this.peekDefinitions('prefix').length === 0 &&
          this.peekDefinitions('infix').length === 0
        ) {
          this.index = afterPostfix;
          return this.error('unexpected-operator', start);
        }
      }

      // Check prefix before infix, to catch `-` as a single missing operand
      opDefs = this.peekDefinitions('prefix');
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedPrefixEntry, number];
        this.index += n;
        if (typeof def.parse === 'function') {
          const result = def.parse(this, { minPrec: 0 });
          if (result !== null) return result;
        }
        if (def.name)
          return [
            def.name,
            // @todo: pass a precedence?
            this.parseExpression() ?? this.error('missing', start),
          ];
        return this.error('unexpected-operator', start);
      }

      opDefs = this.peekDefinitions('infix');
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedInfixEntry, number];
        this.index += n;
        const result = def.parse(this, this.error('missing', start), {
          minPrec: 0,
        });
        if (result !== null) return result;
        // A one-token trigger that is not a command, whose entry declines
        // here, has no reading at this position (for example `÷`, which only
        // non-strict mode reads). Report it as an unexpected token, the same
        // error as for a token with no dictionary entry.
        const token = this._tokens[start];
        if (n === 1 && token[0] !== '\\')
          return this.error(
            ['unexpected-token', { str: tokensToString(token) }],
            start
          );
        // if (def.name)
        //   return [
        //     def.name,
        //     this.error('missing', start),
        //     this.error('missing', start),
        //   ];
        return this.error('unexpected-operator', start);
      }
    }

    const index = this.index;

    let id = parseInvalidSymbol(this);
    if (id !== null) return id;
    id = parseSymbol(this);
    if (id !== null)
      return this.error(['unexpected-symbol', { str: id }], index);

    const command = this.peek;
    if (!command) return this.error('syntax-error', start);

    // If the command is an open or close delimiter prefix, exit
    if (isDelimiterCommand(this))
      return this.error('unexpected-delimiter', start);

    if (command[0] !== '\\') {
      this.nextToken();
      return this.error(
        ['unexpected-token', { str: tokensToString(command) }],
        start
      );
    }

    const errorToken = this.nextToken();

    this.skipSpaceTokens();

    if (errorToken === '\\end') {
      const name = this.parseStringGroup();

      return name === null
        ? this.error('expected-environment-name', start)
        : this.error(['unbalanced-environment', { str: name }], start);
    }

    // Capture potential optional and required LaTeX arguments
    // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
    // However, a `[` could be e.g. inside a string and this
    // would fail to parse.
    // Since we're already in an error situation, though, probably OK.
    while (this.match('[')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== ']') {
        if (this.peek === '[') level += 1;
        if (this.peek === ']') level -= 1;
        this.nextToken();
      }
      this.match(']');
    }

    // Capture any potential arguments to this unexpected command

    while (this.match('<{>')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== '<}>') {
        if (this.peek === '<{>') level += 1;
        if (this.peek === '<}>') level -= 1;
        this.nextToken();
      }
      this.match('<}>');
    }

    return this.error(
      ['unexpected-command', { str: tokensToString(errorToken) }],
      start
    );
  }

  /**
   * <primary> :=
   *  (<number> | <symbol> | <environment> | <matchfix-expr>)
   *    <subsup>* <postfix-operator>*
   *
   * <symbol> ::=
   *  (<symbol-id> | (<latex-command><latex-arguments>)) <arguments>
   *
   * <matchfix-expr> :=
   *  <matchfix-op-open>
   *  <expression>
   *  (<matchfix-op-separator> <expression>)*
   *  <matchfix-op-close>
   *
   */
  private parsePrimary(
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    if (this.atBoundary) return null;

    if (this.atTerminator(until)) return null;

    let result: MathJsonExpression | null = null;
    const start = this.index;
    this._primaryStart = start;

    //
    // 1. Is it a group? (i.e. `{...}`)
    //
    // Unabalanced `<}>`? Syntax error
    if (this.match('<}>'))
      return this.error('unexpected-closing-delimiter', start);

    result ??= this.parseGroup();

    //
    // 2. Is it a number?
    //
    result ??= this.parseNumber();

    //
    // 2b. Is it a double-quoted string literal? (e.g. `"hello"`)
    //
    result ??= this.parseDoubleQuoteString();

    //
    // 3. Is it an enclosure, i.e. a matchfix expression?
    //    (group fence, absolute value, integral, etc...)
    // (check before other LaTeX commands)
    //
    result ??= this.parseEnclosure();

    //
    // 4. Is it an environment?
    //    `\begin{...}...\end{...}`
    // (check before other LaTeX commands)
    //
    result ??= this.parseEnvironment(until);

    //
    // 5. Is it a symbol, a LaTeX command or a function call?
    //    `x` or `\pi'
    //    `f(x)` or `\sin(\pi)
    //    `\frac{1}{2}`
    //

    if (result === null && this.matchAll(this._positiveInfinityTokens))
      result = 'PositiveInfinity';
    if (result === null && this.matchAll(this._negativeInfinityTokens))
      result = 'NegativeInfinity';
    if (result === null && this.matchAll(this._notANumberTokens))
      result = 'NaN';
    if (result === null && this.matchAll(this._imaginaryUnitTokens))
      result = 'ImaginaryUnit';

    // In non-strict mode, try to parse bare function names like sin(x)
    result ??= this.tryParseBareFunction(until);

    // In non-strict mode, try to parse bare symbol names like alpha, pi, oo
    result ??= this.tryParseBareSymbol();

    // In non-strict mode, segment a multi-letter run that isn't a whole known
    // word (e.g. `2pix` → `2·π·x`), avoiding stray imaginary-unit injection.
    this._splitLetterRun = null;
    result ??= this.tryParseBareRun();
    // (The cast undoes the narrowing to `null` from the assignment above:
    // `tryParseBareRun()` sets the field.)
    const splitRun =
      result === null
        ? (this._splitLetterRun as { name: string; start: number } | null)
        : null;

    // ParseGenericExpression() has priority. Some generic expressions
    // may include symbols which have not been explicitly defined
    // with a 'symbol' kind
    result ??=
      this.parseGenericExpression(until) ??
      this.parseFunction(until) ??
      this.parseSymbol(until) ??
      parseInvalidSymbol(this);

    // A run of letters that is not a known word (`eps`, `sinx`) is read one
    // letter at a time: report it, unless a dictionary entry with a
    // multi-letter trigger read the whole run.
    if (
      splitRun !== null &&
      result !== null &&
      splitRun.start === start &&
      this.index < splitRun.start + splitRun.name.length
    )
      this.emitLetterRunSplit(splitRun.name, splitRun.start, [
        ...splitRun.name,
      ]);

    if (result !== null) this.emitPrimaryAmbiguity(start);

    // We're parsing invalid symbols explicitly so we can get a
    // better error message, otherwise we would end up with "unexpected
    // token")

    // If we got an empty sequence, ignore it.
    // This is returned by some purely presentational commands,
    // for example `\displaystyle`

    if (result !== null && isEmptySequence(result))
      return this.parsePrimary(until);

    //
    // 6. Are there postfix operators ?
    //
    const outerScriptBaseStart = this._scriptBaseStart;
    this._scriptBaseStart = start;
    if (result !== null) {
      result = this.decorate(result, start);
      let postfix: MathJsonExpression | null = null;
      let index = this.index;
      do {
        postfix =
          this.parsePostfixOperator(result, until) ??
          this.parseFunctionListArgument(result);
        if (postfix !== null && result !== null)
          this._applicationPolicy?.suffix(result, postfix);
        result = postfix ?? result;
        if (this.index === index && postfix !== null) {
          console.assert(this.index !== index, 'No token consumed');
          break;
        }
        index = this.index;
      } while (postfix !== null);
    }

    //
    // 7. Are there superscript or subfix operators?
    //
    if (result !== null) {
      const scripted = this.parseSupsub(result);
      if (scripted !== null) this._applicationPolicy?.suffix(result, scripted);
      result = scripted;
    }
    this._scriptBaseStart = outerScriptBaseStart;

    //
    // 7b. Scripted-brace sequence notation: `\{a_n\}_{n=1}^{\infty}`.
    //     A `\{…\}` (Set) carrying an index-binding subscript (and optional
    //     upper superscript) denotes an indexed sequence, not a set indexed
    //     by an equation. Rewrite to the inert `IndexedSequence` head.
    //
    if (result !== null) result = parseIndexedSequence(result);

    //
    // 7c. Norm order notation: `‖v‖_1`, `‖v‖_\infty`, `‖v‖_F`.
    //     A subscript on a norm is the order of the norm, so it becomes the
    //     second operand of `Norm` rather than an index.
    //
    if (result !== null) result = parseNormOrder(result);

    //
    // 8. Are there postfix operators after subsup?
    //    (e.g. `[x,y]^{2}.max` where `.max` is a postfix applied after `^{2}`)
    //
    //    A script after these postfix operators applies to the whole result:
    //    `x^2!^3` is `(x^2!)^3`, and `x^g.5^2` is `(x^g·0.5)^2`, as `x.5^2`
    //    is `(x·0.5)^2`. Without this step, the `^` reached the generic
    //    infix loop, where the `^` entry has no reading for it.
    if (result !== null) {
      const scriptBaseStart = this._scriptBaseStart;
      this._scriptBaseStart = start;
      let consumed = false;
      do {
        consumed = false;
        if (result === null) break;
        let postfix: MathJsonExpression | null = null;
        let index = this.index;
        do {
          postfix = this.parsePostfixOperator(result, until);
          if (postfix !== null)
            this._applicationPolicy?.suffix(result, postfix);
          result = postfix ?? result;
          if (this.index === index && postfix !== null) {
            console.assert(this.index !== index, 'No token consumed');
            break;
          }
          if (postfix !== null) consumed = true;
          index = this.index;
        } while (postfix !== null);
        if (consumed) {
          const before = this.index;
          const scripted = this.parseSupsub(result);
          if (scripted !== null)
            this._applicationPolicy?.suffix(result, scripted);
          result = scripted;
          // Read more postfix operators only after a script: `x^g.5^2!`
          consumed = this.index !== before && result !== null;
        }
      } while (consumed);
      this._scriptBaseStart = scriptBaseStart;
    }

    if (result === null) {
      result = this.options.parseUnexpectedToken?.(null, this) ?? null;
      if (
        result === null &&
        this.peek.startsWith('\\') &&
        !BAR_DELIMITER_COMMANDS.has(this.peek)
      ) {
        // Tolerate a stray bare `\` at end of input (e.g. Desmos trailing `\`).
        // Some sources emit a trailing `\` that the tokenizer surfaces as a
        // literal `\` token when followed by EOF.
        if (this.peek === '\\') {
          const saved = this.index;
          this.nextToken();
          this.skipVisualSpace();
          if (this.atEnd) {
            // The `\` was trailing junk — silently discarded, but consuming it
            // is exactly the `recovered` case (input dropped without an Error
            // node). Surface it as a diagnostic before discarding.
            this.emitDiagnostic('recovered', saved, this.index, {
              skipped: this.latex(saved, this.index),
            });
            return this.decorate(null, start);
          }
          // Not at end: restore and fall through to the error path.
          this.index = saved;
        }
        // We've encountered an unknown LaTeX command. May be a typo.
        // Gobble it. The scripts after it apply to the error, so that the
        // parse continues after them: `\foo^2 + y` is `Error^2 + y`.
        this.nextToken();
        result = this.error('unexpected-command', start);
        const scriptBaseStart = this._scriptBaseStart;
        this._scriptBaseStart = start;
        result = this.parseSupsub(result) ?? result;
        this._scriptBaseStart = scriptBaseStart;
      }
    }

    return this.decorate(result, start);
  }

  /**
   * In non-strict mode, record the `ambiguous-*` diagnostics of the primary
   * that starts at token `start` and was just read:
   *
   * - `ambiguous-lookalike-letter`: the primary is a Greek letter that looks
   *   the same as a Latin letter (`Α`, `Ρ`, `ο`, see
   *   `LOOKALIKE_GREEK_LETTERS`);
   * - `ambiguous-name-digits`: the primary starts a run of two or more
   *   letters followed by digits and a parenthesis, and the letters and
   *   digits are not a library function name. `atan3(y)` is read as
   *   `arctan(3·y)`, and a person can mean a function named `atan3`. The
   *   base of `log` is written this way (`log2(x)`, `log10(x)`), so a run
   *   that is `log` is not reported.
   */
  private emitPrimaryAmbiguity(start: number): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    const t = this._tokens;
    if (LOOKALIKE_GREEK_LETTERS.has(t[start])) {
      this._emitAmbiguity('ambiguous-lookalike-letter', start, start + 1, {
        letter: t[start],
      });
      return;
    }

    const isLetter = (i: number) =>
      t[i] !== undefined && /^[a-zA-Z]$/.test(t[i]);
    if (isLetter(start - 1)) return;
    let i = start;
    let name = '';
    while (isLetter(i)) name += t[i++];
    if (name.length < 2 || name === 'log') return;
    let digits = '';
    while (t[i] !== undefined && /^[0-9]$/.test(t[i])) digits += t[i++];
    if (digits === '' || !this.parenthesisFollows(i)) return;
    for (let k = digits.length; k >= 1; k--)
      if (BARE_FUNCTION_MAP[name + digits.slice(0, k)] !== undefined) return;
    this._emitAmbiguity('ambiguous-name-digits', start, i, {
      name: name + digits,
    });
  }

  /**
   * A number literal directly before a bracketed list is a product:
   * `4[1,2]` and `4\left[1,2\right]` parse as
   * `InvisibleOperator(4, List(1, 2))`, like `4(1,2)`.
   *
   * The generic juxtaposition branch of `parseExpression()` does not apply
   * here: it only runs when no operator definition matches the next token,
   * and `[` (also `\lbrack`, `\left[`) is the trigger of the postfix index
   * operator. That operator declines a number on its left, because a number
   * cannot be indexed, so without this method the bracket is left over and
   * reported as an `unexpected-operator` error.
   *
   * A visual-space command (`\,`, `\;`, `\quad`, `\hspace{…}`, the set
   * that `skipVisualSpace()` skips) before a bracketed list also makes a
   * product, whatever the left operand is: `a\,[1,2]` parses as
   * `InvisibleOperator(a, List(1, 2))`. Without the visual space, the
   * bracket after a symbol is an index (`a[1,2]` → `At(a, 1, 2)`, see
   * `parsePostfixOperator()`).
   *
   * The bracket must open a collection (a list, a comprehension or a range,
   * see `isBracketCollection()`). When it opens something else (for example
   * the half-open interval `[1,2)`), the parser position is restored and
   * `null` is returned, so that input is handled as before.
   */
  private parseNumberTimesList(
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null {
    const start = this.index;
    // The caller already skipped plain whitespace, so the position moves
    // only when a visual-space command is ahead.
    this.skipVisualSpace();
    const afterVisualSpace = this.index !== start;
    if (
      (!afterVisualSpace && !isNumberLiteralFactor(lhs)) ||
      !this.atIndexBracket()
    ) {
      this.index = start;
      return null;
    }
    const bracketStart = this.index;

    // Read the bracketed group alone first, to check that it is a collection.
    const group = this.parseEnclosure();
    this.index = bracketStart;
    if (!isBracketCollection(group)) {
      this.index = start;
      return null;
    }

    // Then read the whole right operand, so that suffixes of the list
    // (`4[1,2]^2`, `4[1,2,3][2]`) bind to the list and not to the product.
    const rhs = this.parseExpression({
      ...until,
      minPrec: INVISIBLE_OP_PRECEDENCE + 1,
    });
    if (rhs === null) {
      this.index = start;
      return null;
    }
    // Join the list to an existing product (`2a\,[1,2]`), as the generic
    // juxtaposition branch of `parseExpression()` does. A function call
    // reading (`f(x)`) is not a product and is kept as one operand.
    if (
      operator(lhs) === 'InvisibleOperator' &&
      !this._applicationPolicy?.has(lhs)
    )
      return ['InvisibleOperator', ...operands(lhs), rhs];
    return ['InvisibleOperator', lhs, rhs];
  }

  /**
   * A symbol whose type is a function, directly before a bracketed list, is
   * applied to that list: `\Gamma[a,b]` parses as `Gamma(List(a, b))`.
   *
   * A function cannot be indexed, so the postfix index operator (`parseAt()`)
   * declines such a symbol, and the bracket is the argument of the function.
   * Most function heads read their arguments in their own parser (`\sin`,
   * `\ln`, `\operatorname{…}`, a user function `f`). This method handles the
   * heads that `parsePrimary()` reads as a plain symbol, for example `\Gamma`
   * (a symbol trigger, also the Greek letter). `D` and `N` are excluded, as
   * in `isFunctionOperator()`: they are read as variables, so `D[1]` stays
   * an index. Without this
   * method, the bracket is left over and reported as an
   * `unexpected-operator` error. It runs in the postfix loop of
   * `parsePrimary()`, before superscripts, so `\Gamma[a]^2` reads as
   * `Power(Gamma(List(a)), 2)`.
   *
   * Plain whitespace before the bracket is skipped, as for an index
   * (`\Gamma [a]`). A visual-space command (`\Gamma\,[a]`) is not skipped:
   * that input stays a product, read by `parseNumberTimesList()`.
   *
   * The result is a function application, not an `InvisibleOperator`:
   * canonicalization reads `InvisibleOperator(Gamma, List(a))` as a product.
   *
   * The bracket must open a collection (a list, a comprehension or a range,
   * see `isBracketCollection()`). When it opens something else (for example
   * the half-open interval `[1,2)`), the parser position is restored and
   * `null` is returned.
   */
  private parseFunctionListArgument(
    lhs: MathJsonExpression | null
  ): MathJsonExpression | null {
    const head = symbol(lhs);
    if (head === null) return null;
    const start = this.index;
    this.skipSpace();
    if (!this.atIndexBracket() || !this.isFunctionOperator(head)) {
      this.index = start;
      return null;
    }
    const group = this.parseEnclosure();
    if (!isBracketCollection(group)) {
      this.index = start;
      return null;
    }
    return [head, group!];
  }

  /** True when the next tokens are an opening parenthesis (`(`, `\lparen`,
   * optionally sized: `\left(`, `\bigl(`, …) directly followed by an index
   * bracket (see `atIndexBracket()`), as in `A([1])` or
   * `A\left(\left[1\right]\right)`. The parser position does not move. */
  private atParenthesizedIndexBracket(): boolean {
    const start = this.index;
    this.skipSpace();
    if (OPEN_DELIMITER_PREFIX[this.peek]) this.index++;
    let result = false;
    if (DELIMITER_SHORTHAND['('].includes(this.peek)) {
      this.index++;
      this.skipSpace();
      result = this.atIndexBracket();
    }
    this.index = start;
    return result;
  }

  /** True when the next tokens open an index bracket: `[`, `\lbrack`,
   * `\left[` or `\left\lbrack`. These are the triggers of the postfix `At`
   * operator. */
  private atIndexBracket(): boolean {
    const tok = this.peek;
    if (tok === '[' || tok === '\\lbrack') return true;
    if (tok !== '\\left') return false;
    const next = this._tokens[this.index + 1];
    return next === '[' || next === '\\lbrack';
  }

  /**
   *  Parse an expression:
   *
   * <expression> ::=
   *  | <primary>
   *  | <prefix-op> <primary>
   *  | <primary> <infix-op> <expression>
   *
   * Stop when an operator of precedence less than `until.minPrec`
   * is encountered
   */
  parseExpression(until?: Readonly<Terminator>): MathJsonExpression | null {
    // We want to skip spaces before parsing the expression
    // That way, an "empty" `{}` expression is still considered
    // valid.
    this.skipSpace();

    const start = this.index;
    if (this.atBoundary) {
      this.index = start;
      return null;
    }

    // Diagnostics checkpoint before the left operand: infix binder parselets
    // (`\mapsto`) read this via `operandDiagnosticCheckpoint` to retro-prune
    // bound-parameter references emitted for their left operand.
    const operandDiagCheckpoint = this._diagnosticsCheckpoint();

    until ??= { minPrec: 0 };
    console.assert(until.minPrec !== undefined);
    if (until.minPrec === undefined) until = { ...until, minPrec: 0 };

    // The chain this level's infix loop is growing (see `_ownedChain`) must
    // survive the nested `parseExpression` calls the infix parsers make for
    // their right operands: save the caller's chain and restore it on exit.
    const outerOwnedChain = this._ownedChain;
    this._ownedChain = null;

    //
    // 1. Do we have a prefix operator?
    //
    let lhs = this.parsePrefixOperator({ ...until, minPrec: 0 });

    //
    // 2. Do we have a primary?
    // (if we had a prefix, it consumed the primary following it)
    //
    lhs ??= this.parsePrimary(until);

    //
    // 3. Are there some infix operators?
    //
    if (lhs !== null) {
      let done = false;
      while (!done && !this.atTerminator(until)) {
        const lhsEnd = this.index;
        // Record the span of the left operand built so far: the infix
        // operator ahead can make it an operand of a larger expression, and
        // only that larger expression reaches `decorate()`.
        if (this._exprSpans !== null) this.recordSpan(lhs, start);
        this.skipSpace();

        // Expose this expression's operand checkpoint and start position to
        // the infix parselet about to run (it consumes `lhs`, the
        // already-parsed left operand).
        this._operandDiagnosticCheckpoint = operandDiagCheckpoint;
        this._operandStartIndex = start;
        // In non-strict mode, the word `in` between two operands is the
        // membership operator `\in`. When `\in` binds less tightly than the
        // current context allows, stop here so that an outer level reads it,
        // instead of reading the word as the letters `i·n`.
        if (this.atBareInWord()) {
          if (until.minPrec > this.bareInPrecedence()) break;
          const element = this.parseBareInOperator(lhs, until);
          if (element !== null) {
            lhs = element;
            continue;
          }
        }
        const infixStart = this.index;
        let result = this.parseInfixOperator(lhs, until);
        // A library constant alone on the left of `=` (`e = 1.6e-19`,
        // `pi = 3.14`) is read as the constant, and a person usually means a
        // variable with that name. `f(pi) = 3` is not reported.
        // The same constant directly followed by a parenthesized group on the
        // left of `=` (`pi(x) = x`, `e(t) = t^2`) is read as a product of
        // the constant and the group, and a person can mean the definition
        // of a function with that name.
        // Only an `=` at the top level of the line is reported: the `=` of
        // an index or a limit (`\sum_{i=1}^n`, `sum_(i=1)^n`) or of any
        // other group is not.
        const constantName =
          this.diagnostics === null ||
          this.options.strict !== false ||
          result === null
            ? null
            : typeof lhs === 'string'
              ? lhs
              : operator(lhs) === 'InvisibleOperator' &&
                  nops(lhs) === 2 &&
                  operator(operand(lhs, 2)) === 'Delimiter'
                ? symbol(operand(lhs, 1))
                : null;
        if (
          result !== null &&
          constantName !== null &&
          CONSTANT_NAMES_ON_LEFT_OF_EQUAL.has(constantName) &&
          this._tokens[infixStart] === '=' &&
          this.tokenDepth(infixStart) === 0 &&
          operator(result) === 'Equal' &&
          operand(result, 1) === lhs
        ) {
          // The span ends at the end of the left operand: white space read
          // after the group is not part of it.
          let spanEnd = lhsEnd;
          while (spanEnd > start && this._tokens[spanEnd - 1] === '<space>')
            spanEnd -= 1;
          this._emitAmbiguity('ambiguous-constant-name', start, spanEnd, {
            name: constantName,
          });
        }
        if (result === null && until.minPrec <= INVISIBLE_OP_PRECEDENCE)
          result = this.parseNumberTimesList(lhs, until);
        if (result === null && until.minPrec <= INVISIBLE_OP_PRECEDENCE) {
          // If any operator, no sequence to apply
          const opDefs = this.peekDefinitions('operator');
          if (
            opDefs.length === 0 ||
            opDefs.every(
              ([def]) =>
                def.latexTrigger === '\\text' ||
                def.latexTrigger === '\\keyword'
            )
          ) {
            // All operator defs ahead are \text / \keyword entries. Check if
            // any would match an infix keyword (e.g. "and", "or", "where").
            // If so, this is a real operator that was skipped due to
            // precedence — do NOT enter InvisibleOperator.
            if (
              opDefs.length > 0 &&
              this.wouldMatchTextInfix(opDefs as [IndexedInfixEntry, number][])
            ) {
              // A \text infix keyword is ahead but has lower precedence
              // than our current minPrec — stop and let the caller handle it.
            } else {
              // No infix operator, join the expressions with a Sequence.
              // Capture the token position where the right operand begins (the
              // delimiter/environment) — used to reconstruct the source span of
              // an applied letter-run (`divisors(…)`) in the diagnostic below.
              const rhsStartToken = this.index;
              const rhs = this.parseExpression({
                ...until,
                minPrec: INVISIBLE_OP_PRECEDENCE + 1,
              });
              if (rhs !== null) {
                // Diagnostic: an application-like juxtaposition (a bare symbol
                // immediately followed by a delimited group or matrix
                // environment) read as multiplication. `lhs`/`rhs` here are the
                // as-parsed operands, before the InvisibleOperator flattening
                // below, so the source shape is still directly visible.
                this.emitJuxtapositionDiagnostic(
                  lhs,
                  rhs,
                  start,
                  rhsStartToken
                );
                this.emitJuxtapositionAmbiguity(lhs, rhs, rhsStartToken);
                // Diagnostic (non-strict mode): a parenthesized single name
                // followed by a parenthesized group with a comma, as in
                // `(x)(1,2)`, is read as a product, and a person can mean a
                // call. The span is from the `(` of the name to the end of
                // the group.
                if (
                  this.diagnostics !== null &&
                  this.options.strict === false &&
                  isGroupProductShape(lhs, rhs)
                ) {
                  const open = openingParenthesisBefore(
                    this._tokens,
                    rhsStartToken
                  );
                  this._emitAmbiguity(
                    'ambiguous-group-product',
                    open >= 0 ? open : start,
                    this.index
                  );
                }
                if (
                  operator(lhs) === 'InvisibleOperator' &&
                  !this._applicationPolicy?.has(lhs)
                ) {
                  if (
                    operator(rhs) === 'InvisibleOperator' &&
                    !this._applicationPolicy?.has(rhs)
                  )
                    result = [
                      'InvisibleOperator',
                      ...operands(lhs),
                      ...operands(rhs),
                    ];
                  else result = ['InvisibleOperator', ...operands(lhs), rhs];
                } else if (
                  operator(rhs) === 'InvisibleOperator' &&
                  !this._applicationPolicy?.has(rhs)
                ) {
                  result = ['InvisibleOperator', lhs, ...operands(rhs)];
                } else result = ['InvisibleOperator', lhs, rhs];
              } else {
                if (result === null) {
                  result =
                    this.options.parseUnexpectedToken?.(lhs, this) ?? null;
                }
              }
            }
          }
        }
        if (result !== null) {
          lhs = result;
        } else {
          // We could not apply the infix operator: the rhs may
          // have been a postfix operator, or something else
          done = true;
        }
      }
    }

    this._ownedChain = outerOwnedChain;
    return this.decorate(lhs, start);
  }

  /**
   * Add LaTeX or other requested metadata to the expression
   */
  decorate(
    expr: MathJsonExpression | null,
    start: number
  ): MathJsonExpression | null {
    if (expr === null) return null;
    if (this._exprSpans !== null) this.recordSpan(expr, start);
    if (!this.options.preserveLatex) return expr;

    const latex = this.latex(start, this.index);

    if (Array.isArray(expr)) {
      const decorated = { latex, fn: expr } as MathJsonExpression;
      this._applicationPolicy?.decorated(expr, decorated as object);
      if (continuationRanges.has(expr))
        continuationRanges.add(decorated as object);
      expr = decorated;
    } else if (typeof expr === 'number') {
      expr = { latex, num: Number(expr).toString() };
    } else if (typeof expr === 'string') {
      // Check if it's a string literal (starts with ')
      if (expr.startsWith("'")) {
        // String literal: remove the surrounding quotes
        expr = { latex, str: expr.slice(1, -1) };
      } else {
        expr = { latex, sym: expr };
      }
    } else if (typeof expr === 'object' && expr !== null) {
      (expr as ExpressionObject).latex = latex;
    }
    return expr;
  }

  /**
   * Record the source span of `expr`, the tokens from `start` to the current
   * position (see `_exprSpans`). The first span recorded for an expression is
   * kept: a later, larger span for the same expression can include white
   * space or tokens that do not belong to it.
   */
  private recordSpan(expr: MathJsonExpression, start: number): void {
    const [s, e] = this.sourceOffsets(start, this.index);
    if (typeof expr === 'object' && expr !== null) {
      if (!this._exprSpans!.has(expr)) this._exprSpans!.set(expr, [s, e]);
    } else if (typeof expr === 'number' || typeof expr === 'string') {
      this._primitiveSpans!.push({ value: expr, start: s, end: e });
    }
  }

  error(
    code: string | [string, ...MathJsonExpression[]],
    fromToken: number
  ): MathJsonExpression {
    let msg: MathJsonExpression;
    if (typeof code === 'string') {
      console.assert(!code.startsWith("'"));
      msg = { str: code };
    } else {
      console.assert(!code[0].startsWith("'"));
      msg = ['ErrorCode', { str: code[0] }, ...code.slice(1)];
    }

    const latex = this.latex(fromToken, this.index);
    const fn: [MathJsonSymbol, ...MathJsonExpression[]] = latex
      ? ['Error', msg, ['LatexString', { str: latex }]]
      : ['Error', msg];
    // A `missing` operand has no extent: report a zero-width caret at
    // `fromToken`, the position where the operand was expected (e.g. before the
    // orphaned operator in `=x` or `! 3`). Other errors span the offending
    // tokens, matching the `LatexString` above. When `fromToken === this.index`
    // (e.g. an empty `\sqrt{}`), both branches collapse to the same caret.
    const isMissing = typeof code === 'string' && code === 'missing';
    const sourceOffsets = isMissing
      ? this.sourceOffsets(fromToken, fromToken)
      : this.sourceOffsets(fromToken, this.index);
    return { fn, sourceOffsets };
  }

  /**
   * Emit a `juxtaposition-as-multiply` diagnostic when an application-shaped
   * left operand `lhs` is juxtaposed with an application-like group `rhs` (a
   * delimited group `(…)` or a matrix environment) — the source shape reads as
   * a function application but is parsed as multiplication. No-op unless
   * diagnostics are enabled and the shape matches.
   *
   * Three left-operand shapes are recognized (all report the *source* symbol):
   * - a bare symbol (`x(3)`, `\mathrm{Frobnicate}(x)`);
   * - a unit-lexed symbol (`\mathrm{N}(2)`, where `N` was read as the newton
   *   unit and wrapped `["__unit__", …]`) — reported with `detail.lexedAs:
   *   'unit'` so the generator sees "your `N` was read as a unit";
   * - an applied letter-run (`divisors(60)`, segmented into single-letter
   *   symbols) — one diagnostic for the joined run `divisors`, not per letter.
   *
   * `startToken` is the start of the enclosing expression; `rhsStartToken` is
   * the token where `rhs` begins, used to recover the run's source span.
   */
  private emitJuxtapositionDiagnostic(
    lhs: MathJsonExpression,
    rhs: MathJsonExpression,
    startToken: number,
    rhsStartToken: number
  ): void {
    if (this.diagnostics === null) return;

    // `rhs` must be an application-like group: a parenthesized/delimited group
    // or a matrix environment. `2\pi` (rhs is a symbol) and `xy` do not match.
    const rhsOp = operator(rhs);
    if (rhsOp !== 'Delimiter' && rhsOp !== 'Matrix') return;

    // Resolve the applied source name, its span start, and any lexing hint.
    let name: string | null = null;
    let spanStartToken = startToken;
    let lexedAs: string | undefined;

    const bare = symbol(lhs);
    if (bare !== null) {
      // A single bare symbol reference (`x`, `Frobnicate`).
      name = bare;
    } else if (operator(lhs) === '__unit__') {
      // A symbol the unit lexer read as a unit (`\mathrm{N}` → newton). Report
      // the inner source symbol and flag the unit interpretation.
      name = symbol(operand(lhs, 1));
      if (name !== null) lexedAs = 'unit';
    } else if (operator(lhs) === 'InvisibleOperator') {
      // An applied letter-run (`divisors(60)`). Reconstruct the maximal
      // contiguous run of single-letter tokens immediately before the group;
      // this stops at a number (`2x(3)` → run is `x`) or a multi-char command
      // (`\pi r(2)` → run is `r`).
      const run = this.trailingLetterRun(rhsStartToken);
      if (run === null) return;
      name = run.name;
      spanStartToken = run.startToken;
    }
    if (name === null) return;

    // `declaredAs` keys on declaration *presence*, not type knowledge: a
    // declared-but-unknown-type symbol is a `value`, and only a truly
    // undeclared name is reported as `unknown`.
    const info = this.resolveSymbol(name);
    const declaredAs =
      info === undefined
        ? 'unknown'
        : info.type.matches('function')
          ? 'function'
          : 'value';

    this.emitDiagnostic(
      'juxtaposition-as-multiply',
      spanStartToken,
      this.index,
      lexedAs !== undefined
        ? { name, declaredAs, lexedAs }
        : { name, declaredAs }
    );
  }

  /**
   * In non-strict mode, record the `ambiguous-*` diagnostics of a
   * juxtaposition read as a product: the operand `rhs`, which starts at
   * token `rhsStartToken`, follows `lhs`. The factor directly before `rhs`
   * is `lhs`, or the last operand of `lhs` when `lhs` is itself a product.
   * When that factor is a symbol:
   *
   * - `ambiguous-function-without-parentheses`: the symbol is declared as a
   *   function and `rhs` is not a parenthesized group. `f x` is `f·x`, and a
   *   person can mean `f(x)`;
   * - `ambiguous-name-then-number`: the symbol is not a function, white
   *   space separates it from `rhs`, and `rhs` starts with a digit. `x 2` is
   *   `x·2`, and a person can mean `x_2`. When the symbol is the last letter
   *   of a run read one letter at a time (`xy 0.5`), the span is the whole
   *   run. Also the glyph `∞` directly followed by a digit (`∞2`);
   * - `ambiguous-delta`: the symbol is `Δ` (also `\Delta` or the word
   *   `Delta`) followed by a letter. `Δx` and `Delta x` are `Δ·x`, and a
   *   person can mean the one symbol "change in x".
   *
   * A sign before the factor is ignored: `-Δα` is reported as `Δα` is.
   */
  private emitJuxtapositionAmbiguity(
    lhs: MathJsonExpression,
    rhs: MathJsonExpression,
    rhsStartToken: number
  ): void {
    if (this.diagnostics === null || this.options.strict !== false) return;
    let factor =
      operator(lhs) === 'InvisibleOperator' &&
      !this._applicationPolicy?.has(lhs)
        ? operands(lhs).at(-1)!
        : lhs;
    // A sign before the name does not change the reading of what follows
    // it: `-Δα` is `(-Δ)·α`, as `Δα` is `Δ·α`.
    if (operator(factor) === 'Negate' && nops(factor) === 1)
      factor = operand(factor, 1)!;
    const name = symbol(factor);
    if (name === null) return;
    const t = this._tokens;
    // The factor ends at `factorEnd`, before any white space
    let factorEnd = rhsStartToken;
    while (factorEnd > 0 && t[factorEnd - 1] === '<space>') factorEnd--;
    const spaced = factorEnd !== rhsStartToken;
    // A name spelled with letters (`foo`, `Delta`) is a run of letters; any
    // other name is one token (`f`, `θ`, `\Delta`).
    let factorStart = factorEnd - 1;
    if (name.length > 1 && /^[a-zA-Z]$/.test(t[factorStart] ?? ''))
      while (factorStart > 0 && /^[a-zA-Z]$/.test(t[factorStart - 1]))
        factorStart--;

    const info = this.resolveSymbol(name);
    if (info?.type.matches('function')) {
      const rhsOp = operator(rhs);
      if (rhsOp !== 'Delimiter' && rhsOp !== 'Matrix')
        this._emitAmbiguity(
          'ambiguous-function-without-parentheses',
          factorStart,
          this.index,
          { name }
        );
      return;
    }

    // The last letter of a run read one letter at a time (`xy 0.5` is
    // `x·y·0.5`) is reported with the whole run: the span starts at the
    // first letter, and `detail.name` is the run. A run that is a function
    // name of the lenient grammar (`7 mod 3`) is a word, not a name: the
    // run is reported as a letter run only.
    // A symbol that is not spelled with letters (`…`) is not a name either.
    if (
      spaced &&
      /^[0-9]$/.test(t[rhsStartToken] ?? '') &&
      isOperandStartToken(t[factorStart]) &&
      !/^[0-9]$/.test(t[factorStart])
    ) {
      let runStart = factorStart;
      if (name.length === 1)
        while (runStart > 0 && /^[a-zA-Z]$/.test(t[runStart - 1])) runStart--;
      const run = this.latex(runStart, factorEnd);
      if (
        runStart < factorStart &&
        (BARE_FUNCTION_MAP[run] !== undefined ||
          PARENTHESIZED_BARE_FUNCTION_MAP[run] !== undefined)
      )
        return;
      this._emitAmbiguity('ambiguous-name-then-number', runStart, this.index, {
        name: runStart < factorStart ? run : name,
      });
      return;
    }

    // The glyph `∞` directly followed by a digit: `∞2` is `∞·2`, and a
    // person can mean an index, as `π2` is read `π_2`. A letter is not
    // reported here: a letter directly followed by a digit is read as a
    // subscript (`x2`, `π2`) and reported as `ambiguous-implicit-subscript`.
    // The command `\infty` is LaTeX, where `\infty2` is a product.
    if (
      !spaced &&
      name === 'PositiveInfinity' &&
      factorStart === factorEnd - 1 &&
      t[factorStart] === '∞' &&
      /^[0-9]$/.test(t[rhsStartToken] ?? '')
    ) {
      this._emitAmbiguity(
        'ambiguous-name-then-number',
        factorStart,
        this.index,
        { name }
      );
      return;
    }

    // After white space, only a one-letter name is reported (`Delta x`,
    // `Δ x`): `Delta then` is a word after the symbol.
    if (
      name === 'Delta' &&
      /^\p{L}$/u.test(t[rhsStartToken] ?? '') &&
      (!spaced || !/^\p{L}$/u.test(t[rhsStartToken + 1] ?? ''))
    )
      this._emitAmbiguity('ambiguous-delta', factorStart, rhsStartToken + 1);
  }

  /**
   * Walk backward from `beforeToken` over a maximal contiguous run of
   * single-letter symbol tokens (skipping any immediately-preceding spaces),
   * returning the joined run name and the token where it starts, or `null` if
   * no such run precedes `beforeToken`. Used to reconstruct an applied
   * letter-run symbol (`divisors(…)`) for the `juxtaposition-as-multiply`
   * diagnostic.
   */
  private trailingLetterRun(
    beforeToken: number
  ): { name: string; startToken: number } | null {
    let i = beforeToken;
    // Skip spaces between the run and the group (`x (3)`).
    while (i > 0 && this._tokens[i - 1] === '<space>') i--;
    let letters = '';
    while (i > 0 && /^[a-zA-Z]$/.test(this._tokens[i - 1])) {
      letters = this._tokens[i - 1] + letters;
      i--;
    }
    if (letters.length === 0) return null;
    return { name: letters, startToken: i };
  }

  private isFunctionOperator(id: MathJsonSymbol | null): boolean {
    if (id === null) return false;

    // "D" is defined as the derivative function in the library, but "D(f, x)"
    // is not standard mathematical notation for derivatives. The derivative
    // should be written using Leibniz notation (\frac{d}{dx}f) or Lagrange
    // notation (f'). Exclude "D" so it can be used as a regular variable
    // (e.g., integration domain in \iint_D) or as a predicate in FOL.
    //
    // "N" is defined as the numeric evaluation function in the library, but
    // "N(x)" is CAS-specific notation, not standard math notation. Exclude "N"
    // so it can be used as a regular variable (e.g., "for all N in Naturals").
    // Users can call .N() method for numeric evaluation, or use \operatorname{N}
    // if they need the function in LaTeX.
    if (ONE_LETTER_LIBRARY_OPERATORS.has(id)) return false;

    // Is this a valid function symbol?
    if (this.resolveSymbol(id)?.type.matches('function')) return true;

    // This doesn't look like the expression could be the name of a function:
    // it's a number, a string, a symbol or something else.
    return false;
  }

  /**
   * Check if a symbol looks like a predicate in First-Order Logic.
   * A predicate is typically a single uppercase letter (P, Q, R, etc.)
   * followed by parentheses containing arguments.
   *
   * This enables automatic inference of predicates without explicit declaration,
   * so `\forall x. P(x)` works without having to declare `P` as a function.
   */
  private looksLikePredicate(id: MathJsonSymbol | null): boolean {
    if (id === null || typeof id !== 'string') return false;

    // Must be a single uppercase letter
    if (!/^[A-Z]$/.test(id)) return false;

    // Known scope information overrides the predicate heuristic. Consult the
    // same oracle the lowercase path uses (`resolveSymbol`): if the symbol
    // has a known, non-function type — an assigned value or an explicit
    // numeric/value declaration — it is a variable, so a following
    // parenthesized group is multiplication, not a call. Only an undeclared,
    // unknown-typed, or function-typed symbol falls through to the predicate
    // default.
    const type = this.resolveSymbol(id)?.type;
    if (type !== undefined && !type.isUnknown && !type.matches('function'))
      return false;

    // Must be followed by an opening parenthesis or \left(
    this.skipSpace();
    return this.peek === '(' || this.peek === '\\left';
  }

  /** Return all defs of the specified kind.
   * The defs at the end of the dictionary have priority, since they may
   * override previous definitions. (For example, there is a core definition
   * for matchfix[], which maps to a List, and a logic definition which
   * matches to Boole. The logic definition should take precedence.)
   */
  *getDefs(kind: string): Iterable<IndexedLatexDictionaryEntry> {
    if (kind === 'operator') {
      for (let i = this._dictionary.defs.length - 1; i >= 0; i--) {
        const def = this._dictionary.defs[i];
        if (/^prefix|infix|postfix/.test(def.kind)) yield def;
      }
    } else {
      // Iterate over the definitions, backwards
      for (let i = this._dictionary.defs.length - 1; i >= 0; i--) {
        const def = this._dictionary.defs[i];
        if (def.kind === kind) yield def;
      }
    }
  }
}

function isDelimiterCommand(parser: Parser): boolean {
  const command = parser.peek;
  if (
    Object.values(CLOSE_DELIMITER).includes(command) ||
    CLOSE_DELIMITER[command]
  ) {
    parser.nextToken();
    return true;
  }

  if (
    OPEN_DELIMITER_PREFIX[command] ||
    Object.values(OPEN_DELIMITER_PREFIX).includes(command)
  ) {
    parser.nextToken();
    parser.nextToken();
    return true;
  }

  return false;
}

/** Return true if `expr` is, or contains anywhere, an `Error` node.
 *
 * The tree is walked with an explicit stack instead of by recursion. It is as
 * deep as the input nests, and a left-nested chain is as deep as the input is
 * long: measured 2026-09-22, the recursive form of this walk overflowed the
 * stack on a 5 000-term `1-2-3-…` subtraction chain, which parses and boxes
 * without trouble otherwise. The answer is a single boolean, so the order the
 * stack visits the operands in does not matter. */
function containsError(expr: MathJsonExpression | null | undefined): boolean {
  const pending: (MathJsonExpression | null | undefined)[] = [expr];
  while (pending.length > 0) {
    const x = pending.pop();
    if (x === null || x === undefined) continue;
    const op = operator(x);
    if (op === 'Error') return true;
    if (op === '') continue;
    // Pushed one by one: a spread would pass every operand as an argument,
    // and a node of a parsed flat sum can have tens of thousands of them.
    for (const operand of operands(x)) pending.push(operand);
  }
  return false;
}

/**
 * Parse `latex` into a MathJSON expression, marking any leftover tokens with
 * an `Error` node. This is the core routine, without the trailing-punctuation
 * recovery or `preserveLatex` post-processing applied by `parse`.
 */
function parseCore(
  latex: string,
  dictionary: IndexedLatexDictionary,
  options: Readonly<ParseLatexOptions>,
  comments?: DiscardedComment[]
): { expr: MathJsonExpression | null; parser: _Parser } {
  const parser = new _Parser(
    tokenize(latex, [], comments),
    dictionary,
    options
  );

  let expr = parser.parseExpression();

  // If we didn't reach the end of the input, there was an error
  if (!parser.atEnd) {
    const error = parser.parseSyntaxError();
    // Note: there may still be tokens left in the input, but we will
    // ignore them
    expr = expr !== null ? ['Sequence', expr, error] : error;
  }

  return { expr, parser };
}

/** The elements of `expr` when it is a function expression, as an array or
 * in the object form `{ fn: [...] }`: the operator, then the operands.
 * `null` for a number, a symbol or a string. */
function functionElements(
  expr: MathJsonExpression
): MathJsonExpression[] | null {
  if (Array.isArray(expr)) return expr as MathJsonExpression[];
  if (typeof expr === 'object' && expr !== null && 'fn' in expr)
    return (expr as { fn: MathJsonExpression[] }).fn;
  return null;
}

/**
 * Replace, in the parse result `expr`, the smallest expression that holds the
 * span of each `ambiguous-*` diagnostic of `parser` with an `Error` node:
 * `["Error", "'ambiguous-sign'", ["LatexString", "'--'"]]`. The error code is
 * the diagnostic code, and the `LatexString` is the normalized LaTeX of the
 * span.
 *
 * An expression qualifies when the parser recorded its span (see
 * `_exprSpans` in `_Parser`) and that span holds the diagnostic span. A
 * number or a symbol has no identity, and the spans of a value are recorded
 * by value only, so a span recorded for the value can belong to another
 * occurrence of it. A number or a symbol qualifies only when:
 * - its parent has a recorded span;
 * - the value occurs once in the parent, at any depth: in
 *   `Sum(i, Tuple(i, 1, n))` neither `i` qualifies;
 * - a span recorded for the value is inside the parent span, holds the
 *   diagnostic span, and is outside the recorded spans of the other
 *   operands of the parent.
 * Otherwise the parent is replaced. When no expression qualifies, the
 * `Error` node replaces the whole result. When two diagnostics select
 * nested expressions, the outer replacement is kept.
 *
 * `extra` holds diagnostics that the parser did not record, in the same
 * normalized-LaTeX coordinates (`ambiguous-percent`).
 *
 * `expr` is not modified: the expressions along each replaced path are
 * copied.
 */
function ambiguityErrors(
  expr: MathJsonExpression,
  parser: _Parser,
  extra: readonly ParseDiagnostic[] = []
): MathJsonExpression {
  const diagnostics = [...(parser.diagnostics ?? []), ...extra].filter((d) =>
    d.code.startsWith('ambiguous-')
  );
  if (diagnostics.length === 0) return expr;
  const spans = parser._exprSpans!;
  const primitiveSpans = parser._primitiveSpans!;
  const source = parser.latex(0);

  const holds = (start: number, end: number, d: ParseDiagnostic): boolean =>
    start <= d.start && d.end <= end;

  // The number of occurrences of the number or symbol `value` in `node`, at
  // any depth.
  const occurrences = (node: MathJsonExpression, value: unknown): number => {
    if (node === value) return 1;
    const elements = functionElements(node);
    if (elements === null) return 0;
    let count = 0;
    for (let k = 1; k < elements.length; k++)
      count += occurrences(elements[k], value);
    return count;
  };

  // The path (element indexes) from `node` to the deepest qualifying
  // expression inside it, or `null` when there is none. `nodeSpan` is the
  // recorded span of `node`, if any.
  const locate = (
    node: MathJsonExpression,
    d: ParseDiagnostic,
    nodeSpan: [number, number] | undefined
  ): number[] | null => {
    const elements = functionElements(node);
    if (elements !== null) {
      for (let k = 1; k < elements.length; k++) {
        const child = elements[k];
        if (typeof child === 'object' && child !== null) {
          const found = locate(child, d, spans.get(child));
          if (found !== null) return [k, ...found];
        } else if (
          nodeSpan !== undefined &&
          (typeof child === 'number' || typeof child === 'string') &&
          occurrences(node, child) === 1 &&
          primitiveSpans.some(
            (p) =>
              p.value === child &&
              nodeSpan[0] <= p.start &&
              p.end <= nodeSpan[1] &&
              holds(p.start, p.end, d) &&
              elements.every((x, i) => {
                if (i === 0 || typeof x !== 'object' || x === null) return true;
                const span = spans.get(x);
                return (
                  span === undefined || p.end <= span[0] || span[1] <= p.start
                );
              })
          )
        )
          return [k];
      }
    }
    if (nodeSpan !== undefined && holds(nodeSpan[0], nodeSpan[1], d)) return [];
    return null;
  };

  const rootSpan =
    typeof expr === 'object' && expr !== null ? spans.get(expr) : undefined;
  const targets = diagnostics.map((d) => ({
    d,
    path: locate(expr, d, rootSpan) ?? [],
  }));
  // Outer replacements first, so that a replacement inside one is skipped.
  // The sort is stable: of two diagnostics that select the same expression,
  // the one reported first is kept.
  targets.sort((a, b) => a.path.length - b.path.length);

  const replace = (
    node: MathJsonExpression,
    path: number[],
    by: MathJsonExpression
  ): MathJsonExpression => {
    if (path.length === 0) return by;
    const elements = [...functionElements(node)!];
    elements[path[0]] = replace(elements[path[0]], path.slice(1), by);
    if (Array.isArray(node)) return elements as unknown as MathJsonExpression;
    return { ...(node as object), fn: elements } as MathJsonExpression;
  };

  const replaced: number[][] = [];
  let result = expr;
  for (const { d, path } of targets) {
    if (replaced.some((p) => p.every((k, i) => path[i] === k))) continue;
    replaced.push(path);
    const error: MathJsonExpression = [
      'Error',
      { str: d.code },
      ['LatexString', { str: source.slice(d.start, d.end) }],
    ];
    result = replace(result, path, error);
  }
  return result;
}

export function parse(
  latex: string,
  dictionary: IndexedLatexDictionary,
  options: Readonly<ParseLatexOptions>
): MathJsonExpression | null {
  // Opt-in diagnostics collection. Comments (code `comment-discarded`) are
  // captured from the primary tokenization in original-input coordinates.
  const wantDiagnostics = !!options.diagnostics && !!options.onDiagnostic;
  // In the lenient grammar, the `ambiguous-*` checks of the whole line run
  // when the diagnostics are wanted, and also for `onAmbiguity: 'error'`,
  // which replaces the expression that holds each of them with an `Error`.
  const ambiguityChecks =
    options.strict === false &&
    (wantDiagnostics || options.onAmbiguity === 'error');
  const comments: DiscardedComment[] | undefined =
    wantDiagnostics || ambiguityChecks ? [] : undefined;
  const recovered: ParseDiagnostic[] = [];

  const primary = parseCore(latex, dictionary, options, comments);
  let expr = primary.expr;
  // The parser whose collected diagnostics (codes 1 & 2) describe the adopted
  // parse. Updated if a trailing-noise retry is adopted below.
  let adoptedParser = primary.parser;
  // The text that the trailing-noise recovery below removed, if it adopted a
  // retry.
  let skippedTail: string | undefined;

  // Trailing-noise recovery (sentence punctuation and equation labels).
  //
  // A full expression copied from prose often ends with a sentence-terminating
  // `.`, `;`, `,` or `?` (e.g. `... = z^2.`, or an MCQ/rhetorical fragment
  // such as `\sum_{n=1}^{100} a_n^2?`), and MathNet-style corpus fragments
  // frequently append an equation label / attribution tag, e.g.
  // `... = f(x)+f(y). \quad (2)`, `... = 3+\cos(x+y). \quad (\text{Petar})`, or
  // `..., \qquad \textcircled{1}`. Both leave unconsumed tokens and produce an
  // `Error` node.
  //
  // If — and only if — the parse produced an Error, try a few reduced inputs
  // and adopt the first retry that is itself completely clean. Because the
  // retry is used only when it produces no Error, no currently-valid input can
  // change meaning: a valid decimal like `5.` parses without error and never
  // reaches this path, `x \quad (2)` already parses (it stays untouched), and
  // the extra parses run only on the error path.
  if (containsError(expr)) {
    const trimmed = latex.trimEnd();

    // Strip a single trailing sentence-punctuation character, if present.
    const stripPunctuation = (s: string): string | null => {
      const t = s.trimEnd();
      return t.length > 1 && /[.,;?]$/.test(t) ? t.slice(0, -1) : null;
    };

    // Strip a trailing equation label: a `\quad`/`\qquad`/`\hspace{…}` spacer
    // followed by either a parenthesized tag `(…)` (no nested parens; the
    // content may hold `\text{…}` etc.) or `\textcircled{…}`. A genuine math
    // tail such as `\quad (x+1)` would also match, but that is harmless here:
    // recovery runs only on the error path and only adopts a *clean* retry, so
    // a meaningful parenthesized trailer would either already parse (never
    // reaching this path) or leave the retry with an Error (rejected).
    const stripLabel = (s: string): string | null => {
      const t = s.trimEnd();
      const m = t.match(
        /(?:\\q?quad|\\hspace\{[^{}]*\})\s*(?:\([^()]*\)|\\textcircled\{[^{}]*\})$/
      );
      return m ? t.slice(0, m.index) : null;
    };

    // Candidates, in order: punctuation-strip, label-strip, then
    // label-strip-then-punctuation-strip (a label often follows a trailing
    // `.` or `,`, so the two strips must compose).
    const candidates: string[] = [];
    const p = stripPunctuation(trimmed);
    if (p !== null) candidates.push(p);
    const l = stripLabel(trimmed);
    if (l !== null) {
      candidates.push(l);
      const lp = stripPunctuation(l);
      if (lp !== null) candidates.push(lp);
    }

    for (const candidate of candidates) {
      const retry = parseCore(candidate, dictionary, options);
      if (retry.expr !== null && !containsError(retry.expr)) {
        expr = retry.expr;
        adoptedParser = retry.parser;
        skippedTail = latex.slice(candidate.length);
        // Diagnostic: trailing tokens silently dropped by recovery. The
        // adopted candidate is a prefix of the (trimmed) input, so the skipped
        // fragment is the original tail. It no longer surfaces as an `Error`
        // node (the retry is clean), which is exactly the `recovered` case.
        if (wantDiagnostics) {
          // Report the exact untrimmed tail so `latex.slice(start, end)`
          // reproduces `detail.skipped` (span and detail stay consistent).
          recovered.push({
            code: 'recovered',
            start: candidate.length,
            end: latex.length,
            detail: { skipped: latex.slice(candidate.length) },
          });
        }
        break;
      }
    }
  }

  // Non-strict mode: the `ambiguous-*` diagnostics that a check of the whole
  // line finds. They run once, on the raw result of the adopted parse, and do
  // not change `expr`. They run before `ambiguityErrors()` below, so that
  // `onAmbiguity: 'error'` applies to them too.
  const percents: ParseDiagnostic[] = [];
  // The same diagnostics, in normalized-LaTeX coordinates (see
  // `_Parser.sourceOffsets()`), for `ambiguityErrors()`.
  const normalizedPercents: ParseDiagnostic[] = [];
  if (ambiguityChecks) {
    adoptedParser._reportLineAmbiguities(expr, skippedTail);
    // A `%` directly after a number (`y = 50%`) starts a comment that
    // discards the rest of the line, and a person means a percentage. The
    // span is the number and the `%`, in original-input coordinates, as for
    // `comment-discarded`.
    for (const c of comments!) {
      const number = numberBeforePercent(latex.slice(0, c.start));
      if (number === null) continue;
      percents.push({
        code: 'ambiguous-percent',
        start: number[0],
        end: c.start + 1,
      });
      // The tokens of the number end where the tokens of the text before
      // the end of the number end. When they are not the number (the
      // tokenizer changed the text), the span is the whole line.
      const tokenEnd = tokenize(latex.slice(0, number[1])).length;
      const tokenStart = tokenEnd - (number[1] - number[0]);
      const [start, end] =
        tokenStart >= 0 &&
        adoptedParser.latex(tokenStart, tokenEnd) ===
          latex.slice(number[0], number[1])
          ? adoptedParser.sourceOffsets(tokenStart, tokenEnd)
          : [0, adoptedParser.latex(0).length];
      normalizedPercents.push({ code: 'ambiguous-percent', start, end });
    }
  }

  // `onAmbiguity: 'error'` in the lenient grammar: an `Error` node replaces
  // the expression that holds the span of each `ambiguous-*` diagnostic. This
  // runs before the passes below, which can rebuild parts of the result and
  // so lose the spans that the parser recorded.
  if (expr !== null && adoptedParser._exprSpans !== null)
    expr = ambiguityErrors(expr, adoptedParser, normalizedPercents);

  expr ??= 'Nothing';
  expr = adoptedParser.resolveApplications(expr);

  // The range infixes bind above `+` (and, for `..`, above implicit
  // multiplication and the prefix minus), so a compound first anchor is split:
  // `n+1..n+10` parses as `Add(n, Range(1, n+10))`. `parseBrackets` repairs
  // that inside brackets; this pass covers the bare and relation-embedded
  // forms. Runs on the raw parse output, where a parenthesized range still
  // carries its `Delimiter` — `n+(1..10)` stays a broadcast add.
  expr = normalizeContinuationRanges(expr);

  // Forward collected diagnostics to the sink before the `preserveLatex` block
  // (which has early returns). Order: symbol/juxtaposition diagnostics from the
  // adopted parser (source order), then discarded comments, then recovery.
  if (wantDiagnostics) {
    const sink = options.onDiagnostic!;
    if (adoptedParser.diagnostics)
      // Strip the internal `_seq` field so the sink sees the public
      // `ParseDiagnostic` shape exactly.
      for (const { code, start, end, detail } of adoptedParser.diagnostics)
        sink(
          detail !== undefined
            ? { code, start, end, detail }
            : { code, start, end }
        );
    for (const c of comments ?? [])
      sink({
        code: 'comment-discarded',
        start: c.start,
        end: c.end,
        detail: { discardedLength: c.discardedLength },
      });
    for (const d of percents) sink(d);
    for (const d of recovered) sink(d);
  }

  if (options.preserveLatex) {
    if (Array.isArray(expr)) return { latex, fn: expr } as MathJsonExpression;

    if (typeof expr === 'number')
      return { latex, num: Number(expr).toString() };

    if (typeof expr === 'string') {
      if (matchesString(expr)) return { latex, str: stringValue(expr)! };
      if (matchesSymbol(expr)) return { latex, sym: expr };
      if (matchesNumber(expr)) return { latex, num: expr };
    }

    if (typeof expr === 'object' && expr !== null)
      (expr as ExpressionObject).latex = latex;
  }

  return expr;
}
