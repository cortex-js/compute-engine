import type {
  MathJsonExpression,
  ExpressionObject,
  MathJsonSymbol,
} from '../../math-json/types.js';
import {
  getSequence,
  missingIfEmpty,
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
} from './types.js';
import type { ParseDiagnostic } from '../types-kernel-serialization.js';
import { tokenize, tokensToString } from './tokenizer.js';
import type { DiscardedComment } from './tokenizer.js';
import { parseSymbol, parseInvalidSymbol } from './parse-symbol.js';
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
import { SYMBOLS } from './dictionary/definitions-symbols.js';

/**
 * A collected parse diagnostic with its internal monotonic sequence id. The
 * `_seq` field is used for seq-based checkpoints (see `_Parser.diagnostics`)
 * and is stripped before the diagnostic is forwarded to the sink, so the
 * public {@link ParseDiagnostic} shape is preserved.
 */
type CollectedDiagnostic = ParseDiagnostic & { _seq: number };

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
  sgn: 'Sgn',
  sign: 'Sgn',
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
};

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

/** Lazy map from LaTeX command (e.g. '\\alpha') to its Unicode character.
 * Built once from the SYMBOLS table on first access. */
let _symbolToUnicode: Map<string, string> | null = null;
function getSymbolToUnicode(): Map<string, string> {
  if (!_symbolToUnicode) {
    _symbolToUnicode = new Map();
    for (const [, latex, codepoint] of SYMBOLS) {
      _symbolToUnicode.set(latex, String.fromCodePoint(codepoint));
    }
  }
  return _symbolToUnicode;
}

/** These delimiters can be used as 'shorthand' delimiters in
 * `openTrigger` and `closeTrigger` for `matchfix` operators.
 */
const DELIMITER_SHORTHAND: { [key: string]: LatexToken[] } = {
  '(': ['\\lparen', '('],
  ')': ['\\rparen', ')'],
  '[': ['\\lbrack', '\\[', '['],
  ']': ['\\rbrack', '\\]', ']'],
  '<': ['<', '\\langle'],
  '>': ['>', '\\rangle'],
  '{': ['\\{', '\\lbrace'],
  '}': ['\\}', '\\rbrace'],
  ':': [':', '\\colon'],
  '|': ['|', '\\|', '\\lvert', '\\rvert'], //special: '\lvert` when open, `\rvert` when close
  '||': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'], // special: `\lVert` when open, `\rVert` when close; `\|` is a self-closing synonym for `\Vert`
  // '\\lfloor': ['\\lfloor'],
  // '\\rfloor': ['\\rfloor'],
  // '\\lceil': ['\\lceil'],
  // '\\rceil': ['\\rceil'],
  // '\\ulcorner': ['\\ulcorner'],
  // '\\urcorner': ['\\urcorner'],
  // '\\llcorner': ['\\llcorner'],
  // '\\lrcorner': ['\\lrcorner'],
  // '\\lgroup': ['\\lgroup'],
  // '\\rgroup': ['\\rgroup'],
  // '\\lmoustache': ['\\lmoustache'],
  // '\\rmoustache': ['\\rmoustache'],
  // '\\llbracket': ['\\llbracket'],
  // '\\rrbracket': ['\\rrbracket'],
};

// const MIDDLE_DELIMITER = {
//   ':': [':', '\\colon'],
//   '|': ['|', '\\|', '\\mid', '\\mvert'],
// };

/** Commands that can be used with an open delimiter, and their corresponding
 * closing commands.
 */

const OPEN_DELIMITER_PREFIX: Record<string, string> = {
  '\\left': '\\right',
  '\\bigl': '\\bigr',
  '\\Bigl': '\\Bigr',
  '\\biggl': '\\biggr',
  '\\Biggl': '\\Biggr',
  '\\big': '\\big',
  '\\Big': '\\Big',
  '\\bigg': '\\bigg',
  '\\Bigg': '\\Bigg',
  '\\mathopen': '\\mathclose',
  '\\mleft': '\\mright',
};

/** The closing-delimiter commands (e.g. `\right`, `\bigr`) that pair with the
 * `\left`-style open prefixes above. After one of these, a `.` is a TeX *null
 * delimiter*: it produces no visible fence, so `\left(x\right.` is a valid,
 * one-sided enclosure. Used to accept `\right.` when matching a close boundary.
 */
const CLOSE_DELIMITER_PREFIX = new Set<string>(
  Object.values(OPEN_DELIMITER_PREFIX)
);

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
 * In addition, the handler `getSymbolType()` is called when the parser
 * encounters an unknown symbol. This handler can be used to declare the
 * symbol, or to return `unknown` if the symbol is not known.
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

  _index = 0;

  symbolTable: SymbolTable = {
    parent: null,
    ids: {},
  };

  pushSymbolTable(): void {
    this._symbolTableGen += 1;
    this.symbolTable = { parent: this.symbolTable, ids: {} };
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
    // in the array (`pruneUndeclared` splices from the middle, and retro spans
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
        if (d[r].start >= cutoff) continue; // drop abandoned-branch entry
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
  private _boundaries: { index: number; tokens: LatexToken[] }[] = [];

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

  // Cache for the speculative `parseSymbol()` performed by the
  // `symbolTrigger` path of `peekDefinitions()`. The parsed candidate
  // depends only on the (immutable) token stream, the position, and the
  // symbol table (tracked by `_symbolTableGen` — the engine scope consulted
  // via `options.getSymbolType`/`options.hasSubscriptEvaluate` is stable
  // for the duration of a parse), so it can be reused across the several
  // `peekDefinitions()` calls made at the same position (once per kind).
  private _symbolTableGen = 0;
  private _symCandidateIndex = -1;
  private _symCandidateGen = -1;
  private _symCandidate: string | null = null;
  private _symCandidateCount = 0;

  // Opt-in parse diagnostics (codes `undeclared-symbol`,
  // `juxtaposition-as-multiply`). Non-null only when `options.diagnostics` is
  // enabled; `emitDiagnostic` is a no-op otherwise.
  //
  // Each collected entry carries an internal monotonic `_seq` id (assigned in
  // emission order and never reused). Checkpoints are seq *values*, not array
  // positions, so `rollbackDiagnostics`/`pruneUndeclared` are robust to the
  // index-setter auto-prune deleting entries from the middle of the array (a
  // length-based checkpoint would silently mis-target after such a deletion).
  // `_seq` is stripped before a diagnostic reaches the sink — the public
  // `ParseDiagnostic` shape is unchanged.
  readonly diagnostics: CollectedDiagnostic[] | null;
  private _diagnosticSeq = 0;

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
    const [start, end] = this.sourceOffsets(startToken, endToken);
    const _seq = this._diagnosticSeq++;
    this.diagnostics.push(
      detail !== undefined
        ? { code, start, end, detail, _seq }
        : { code, start, end, _seq }
    );
  }

  /**
   * A checkpoint for {@link rollbackDiagnostics} / {@link pruneUndeclared}: the
   * next sequence id to be assigned. Every diagnostic collected *after* this
   * call has `_seq >= checkpoint`. Seq-based (not a length), so it stays valid
   * even if the index-setter auto-prune later deletes entries.
   */
  diagnosticsCheckpoint(): number {
    return this._diagnosticSeq;
  }

  /**
   * Discard every diagnostic collected since `checkpoint` (a value returned by
   * {@link diagnosticsCheckpoint}) — i.e. every entry with `_seq >= checkpoint`.
   * Used to unwind diagnostics emitted while speculatively parsing a branch the
   * parser then backtracks out of.
   */
  rollbackDiagnostics(checkpoint: number): void {
    if (this.diagnostics === null) return;
    const d = this.diagnostics;
    let w = 0;
    for (let r = 0; r < d.length; r++)
      if (d[r]._seq < checkpoint) d[w++] = d[r];
    d.length = w;
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
  pruneUndeclared(
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
  pruneJuxtaposition(name: string, checkpoint: number): void {
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
   * operand) use it to {@link pruneUndeclared} bound-parameter references that
   * were emitted for that operand.
   */
  get operandDiagnosticCheckpoint(): number {
    return this._operandDiagnosticCheckpoint;
  }
  private _operandDiagnosticCheckpoint = 0;

  /**
   * True if `id` resolves to a declaration — a parser-local binding tracked in
   * `symbolTable`, or a definition in the engine scope (via the
   * `isSymbolDeclared` hook). Declaration *presence*, not type knowledge: a
   * symbol declared with an `unknown` type is still declared.
   */
  isSymbolDeclared(id: MathJsonSymbol): boolean {
    let table: SymbolTable | null = this.symbolTable;
    while (table) {
      if (id in table.ids) return true;
      table = table.parent;
    }
    // A declaration-presence hook (e.g. engine scope lookup) is authoritative
    // when it reports the symbol declared, but it is not the whole story: the
    // `getSymbolType` handler (which the parse-option handler REPLACES for
    // typing) may know a non-`unknown` type for a symbol the presence hook does
    // not find — Tycho's validator declares in-scope definitions purely through
    // `getSymbolType`. Treat a known type as a declaration too, so the
    // `undeclared-symbol` diagnostic never contradicts a resolved type.
    if (this.options.isSymbolDeclared?.(id)) return true;
    return !this.getSymbolType(id).isUnknown;
  }

  /**
   * Shared emission point for a symbol *reference*: records an
   * `undeclared-symbol` diagnostic iff `id` is not declared (see
   * {@link isSymbolDeclared}). No-op unless diagnostics are enabled. Every
   * parser path that yields a bare symbol reference routes through here so no
   * charitable interpretation escapes the diagnostic.
   */
  emitSymbolReference(
    id: MathJsonSymbol,
    startToken: number,
    endToken: number
  ): void {
    if (this.diagnostics === null) return;
    if (!this.isSymbolDeclared(id))
      this.emitDiagnostic('undeclared-symbol', startToken, endToken, {
        name: id,
        type: this.getSymbolType(id).toString(),
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
    this.diagnostics = options.diagnostics ? [] : null;

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

  getSymbolType(id: MathJsonSymbol): BoxedType {
    // Check if the symbol is in the symbol table
    // (which means it has been encountered as part of the current parsing)
    let table: SymbolTable | null = this.symbolTable;
    while (table) {
      if (id in table.ids) return table.ids[id];
      table = table.parent;
    }

    // Is the symbol known in the compute engine current scope?
    if (this.options.getSymbolType) {
      const type = this.options.getSymbolType(id);
      if (type instanceof BoxedType) return type;

      if (typeof type === 'string') {
        try {
          return new BoxedType(type);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `ce.parse(): getSymbolType("${id}") returned invalid type string "${type}". ${message}`
          );
        }
      }

      throw new Error(
        `ce.parse(): getSymbolType("${id}") must return a BoxedType or a type string, received ${describeTypeCallbackResult(
          type
        )}`
      );
    }

    return BoxedType.unknown;
  }

  hasSubscriptEvaluate(id: MathJsonSymbol): boolean {
    // Check if the symbol has a custom subscript evaluation handler
    if (this.options.hasSubscriptEvaluate)
      return this.options.hasSubscriptEvaluate(id);
    return false;
  }

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
    for (const boundary of this._boundaries) {
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

  addBoundary(boundary: LatexToken[]): void {
    this._boundaries.push({ index: this.index, tokens: boundary });
  }

  removeBoundary(): void {
    this._boundaries.pop();
  }

  matchBoundary(): boolean {
    const currentBoundary = this._boundaries[this._boundaries.length - 1];
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
    const start = offsets[Math.max(0, Math.min(startToken, n))];
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
    offsets[0] = 0;
    let len = 0;
    let sep = '';
    for (let i = 0; i < tokens.length; i++) {
      const segment = LOOKAHEAD_TOKEN_TO_STRING[tokens[i]] ?? tokens[i];
      // If the segment begins with a char that *could* be in a command name,
      // insert the pending separator (see `joinLatex()`)
      if (/[a-zA-Z]/.test(segment[0])) len += sep.length;
      // If the segment ends in a command, a space precedes the next segment
      sep = /\\[a-zA-Z]+\*?$/.test(segment) ? ' ' : '';
      len += segment.length;
      offsets[i + 1] = len;
    }

    this._tokenPrefixOffsets = offsets;
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
      const expr = this.parseExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr ?? 'Nothing';
      // Try to find the boundary (or the end)
      while (!this.matchBoundary() && !this.atEnd) this.nextToken();
      if (operator(expr) === 'Error') return expr;
      const err = this.error('expected-closing-delimiter', start);
      return expr !== null ? ['InvisibleOperator', expr, err] : err;
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

    return this.parseGenericExpression() ?? this.parseSymbol();
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
    for (const [def, n] of this.peekDefinitions('infix')) {
      if (def.precedence >= until.minPrec) {
        this.index = start + n;
        const rhs = def.parse(this, lhs, until);
        if (rhs !== null) return rhs;
      }
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
      // Read a primary
      const primary = this.parseExpression({
        ...until,
        minPrec: MULTIPLICATION_PRECEDENCE,
      });
      return primary === null ? null : [primary];
    }

    // The element following the function does not match
    // a possible argument list
    // That's OK, but need to undo the parsing of the matchfix
    // This is the case: `f[a]` or `f|a|`
    this.index = savedIndex;
    return null;
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
        // If the open/close delimiter are identical and the body is empty,
        // we may have consumed an inner delimiter (e.g. "||3-5|-4|").
        // Retry parsing without the boundary and look for the closing delimiter.
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
      if (result !== null) return result;
    }
    // No def matched: the `this.index = start` rewind auto-prunes any
    // diagnostics the speculative bodies emitted (see `set index`).
    this.index = start;
    return null;
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

    const args = this.parseArguments(argMode, until);

    if (args === null) return fn;

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

    return typeof fn === 'string' ? [fn, ...args] : ['Apply', fn!, ...args];
  }

  parseSymbol(until?: Readonly<Terminator>): MathJsonExpression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;

    //
    // Is there a custom parser for this symbol?
    //
    for (const [def, tokenCount] of this.peekDefinitions('symbol')) {
      this.index = start + tokenCount;
      // @todo: should capture symbol, and check it is not in use as a symbol,  function, or inferred (calling getSymbolType() or somethinglike it (getSymbolType() may aggressively return 'symbol'...)). Maybe not during parsing, but canonicalization
      if (typeof def.parse === 'function') {
        const result = def.parse(this, until);
        if (result !== null) return result;
      } else return def.name!;
    }

    // No custom parser worked. Backtrack.
    // (we shouldn't need to backtrack, but this is in case there's a bug
    // in a custom parser)
    this.index = start;

    const id = parseSymbol(this);
    if (id !== null && !this.getSymbolType(id).matches('error')) {
      // Diagnostic: a symbol reference that resolves to no declaration —
      // neither a parser-local binding (sum index, Block/Function parameter,
      // tracked in `symbolTable`) nor a definition in the engine scope.
      // Emitted at every reference site (spans differ); bound-variable
      // references are pruned retroactively by the binder parselets.
      this.emitSymbolReference(id, start, this.index);
      return id;
    }

    // This was a symbol, but not a valid symbol. Backtrack
    this.index = start;
    return null;
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
    // middle of a word that was partially consumed — don't match.
    if (start > 0 && /^[a-zA-Z]$/.test(this._tokens[start - 1])) return null;

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

    this.skipSpace();

    // Check for optional subscript: log_2(x) or log_{10}(x)
    let subscript: MathJsonExpression | null = null;
    if (this.peek === '_') {
      this.index++; // skip '_'
      subscript = this.parseGroup();
      if (subscript === null) {
        // Try bare digits/letters: _2, _10, _b
        if (!this.atEnd && /^[a-zA-Z]$/.test(this.peek)) {
          subscript = this.peek;
          this.index++;
        } else {
          let digits = '';
          while (!this.atEnd && /^[0-9]$/.test(this.peek)) {
            digits += this.peek;
            this.index++;
          }
          if (digits) subscript = parseInt(digits);
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
    if (
      subscript === null &&
      name === 'log' &&
      !this.atEnd &&
      /^[0-9]$/.test(this.peek)
    ) {
      let digits = '';
      while (!this.atEnd && /^[0-9]$/.test(this.peek)) {
        digits += this.peek;
        this.index++;
      }
      subscript = parseInt(digits);
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
          const num = parseInt(digits);
          exponent = neg ? -num : num;
        } else {
          // Not a valid exponent, backtrack entirely
          this.index = start;
          return null;
        }
      }
      this.skipSpace();
    }

    const fnName = BARE_FUNCTION_MAP[name];
    if (!fnName) {
      // Not a recognized function name, backtrack
      this.index = start;
      return null;
    }

    // Parse the argument(s). With parentheses this is an ordinary call
    // (`sin(x)`, `log_2(8)`). Without parentheses, in non-strict mode we accept
    // an implicit argument the same way `\sin x` does (`sin x` → `Sin(x)`,
    // `cos 2x` → `Cos(2x)`, `sqrt4` → `Sqrt(4)`), stopping before another bare
    // function so `sin x cos y` groups as `(sin x)(cos y)`.
    let args: ReadonlyArray<MathJsonExpression> | null;
    if (this.peek === '(') {
      args = this.parseArguments('enclosure', until);
    } else {
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

    // Special case: cbrt(x) -> ['Root', x, 3]
    if (name === 'cbrt') {
      const result: MathJsonExpression = ['Root', args[0] ?? 'Nothing', 3];
      return exponent !== null ? ['Power', result, exponent] : result;
    }

    // Special case: log with subscript base (matches \log_b behavior)
    // log_2(x) -> ['Lb', x], log_10(x) -> ['Log', x], log_b(x) -> ['Log', x, b]
    let result: MathJsonExpression;
    if (name === 'log' && subscript !== null) {
      if (subscript === 2) result = ['Lb', ...args];
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
    if (exponent === -1 && Array.isArray(result)) {
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
    // middle of a word that was partially consumed — don't match.
    if (start > 0 && /^[a-zA-Z]$/.test(this._tokens[start - 1])) return null;

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

    // Route the mapped name through the shared emission point: a spelled-out
    // name that maps to an undeclared symbol (e.g. `alpha` under `strict:false`)
    // is a symbol reference that would otherwise bypass diagnostics. Mapped
    // constants (`oo`→`PositiveInfinity`, `pi`→`Pi`, …) are declared → no-op.
    this.emitSymbolReference(symbolName, start, this.index);

    return symbolName;
  }

  /** Named constants that may be recognized *inside* a longer letter run by
   * `tryParseBareRun` (greedy longest-match). Only the spelled-out Greek
   * letters qualify: `2pix` → `2·π·x`, `xpi` → `x·π`. The ASCII shorthands
   * `oo`/`inf`/`ii` are deliberately excluded — they require word boundaries
   * (so `foo` stays `f·o·o`, not `f·∞`) and are matched only as whole runs by
   * `tryParseBareSymbol`. */
  private static readonly SEGMENTABLE_SYMBOLS: Record<string, string> =
    Object.fromEntries(
      Object.entries(_Parser.BARE_SYMBOL_MAP).filter(
        ([k]) => !['oo', 'inf', 'ii'].includes(k)
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
   *   constants (`2pix` → `2·π·x`, `xpi` → `x·π`). If no Greek constant is
   *   found the run is left untouched (returns `null`) so the existing
   *   per-letter parsing applies exactly as before.
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
      return name;
    }

    // Greedy longest-match segmentation against spelled-out Greek constants.
    const symbols = _Parser.SEGMENTABLE_SYMBOLS;
    const segments: MathJsonExpression[] = [];
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
        // A single leftover letter, emitted as-is. (The boxer still maps the
        // identifiers `e`/`i` to `ExponentialE`/`ImaginaryUnit`, matching how
        // they parse standalone — that is a symbol-level decision, not one the
        // parser overrides here.)
        // Each letter is a single token, so its span is `[start+i, start+i+1)`.
        this.emitSymbolReference(name[i], start + i, start + i + 1);
        segments.push(name[i]);
        i += 1;
      }
    }

    // Only take over the run when a Greek constant was actually recognized;
    // otherwise leave it to the unchanged per-letter path.
    if (!matchedConstant) {
      this.index = start;
      return null;
    }

    return segments.length === 1 ? segments[0] : ['Multiply', ...segments];
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
  private parseSupsub(lhs: MathJsonExpression): MathJsonExpression | null {
    if (this.atEnd) return lhs;
    console.assert(lhs !== null);

    const index = this.index;

    // In non-strict mode, a single letter immediately followed by one or more
    // digits is treated as an implicit *subscript*: `x2 → x_2`, `x1 → x_1`,
    // `x12 → x_12`. Flattened subscripts (indexed variables such as `x1`, `x2`,
    // …) are the common intent of ASCII/copy-paste input; producing a subscript
    // (rather than a superscript power) preserves the index, matches the strict
    // `x_2` form, and follows the recommendation in `docs/LENIENT_PARSER.md`.
    // The base may be a single letter (`x2`) or a recognized multi-letter
    // constant name (`alpha2` → `alpha_2`, `Pi2` → `Pi_2`); an arbitrary
    // multi-letter run never reaches here as a single string (it is a product),
    // so this stays conservative.
    // Check before skipSpace() to require true adjacency.
    if (
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
      return this.parseSupsub(['Subscript', lhs, parseInt(digits)]);
    }

    this.skipSpace();

    //
    // 1/ Gather possible superscript/subscripts
    //
    const superscripts: MathJsonExpression[] = [];
    const subscripts: MathJsonExpression[] = [];
    let subIndex = index;
    while (this.peek === '_' || this.peek === '^') {
      if (this.match('_')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          subscripts.push(this.error('syntax-error', subIndex));
        else {
          let sub = this.parseGroup();
          // In non-strict mode, consume consecutive digits as subscript
          // before parseToken(), which would only consume a single digit
          if (sub === null && this.options.strict === false) {
            let digits = '';
            while (!this.atEnd && /^[0-9]$/.test(this.peek)) {
              digits += this.peek;
              this.index++;
            }
            if (digits) sub = parseInt(digits);
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

          subscripts.push(sub);
        }
      } else if (this.match('^')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          superscripts.push(this.error('syntax-error', subIndex));
        else {
          let sup = this.parseGroup();
          // In non-strict mode, consume optional '-' and consecutive digits
          // before parseToken(), which would only consume a single digit
          if (sup === null && this.options.strict === false) {
            const digitStart = this.index;
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
              const num = parseInt(digits);
              sup = neg ? -num : num;
            } else {
              this.index = digitStart;
            }
          }
          sup ??= this.parseToken();
          // In non-strict mode, also accept parenthesized expressions
          // Note: After match('^'), peek has changed but TypeScript doesn't know
          if (
            sup === null &&
            this.options.strict === false &&
            (this.peek as string) === '('
          )
            sup = this.parseEnclosure();
          if (sup === null) return this.error('missing', index);
          superscripts.push(sup);
        }
      }
      subIndex = this.index;
      this.skipSpace();
    }

    if (superscripts.length === 0 && subscripts.length === 0) {
      this.index = index;
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
          const arg: MathJsonExpression = [
            'Superscript',
            result!,
            superscriptExpression,
          ];
          for (const def of defs) {
            if (typeof def.parse === 'function')
              result = def.parse(this, arg, { minPrec: 0 });
            else result = arg;
            if (result !== null) break;
          }
        }
      }
    }

    // Restore the index if we did not find a match
    if (result === null) this.index = index;

    return result;
  }

  parsePostfixOperator(
    lhs: MathJsonExpression | null,
    until?: Readonly<Terminator>
  ): MathJsonExpression | null {
    console.assert(lhs !== null); // @todo validate
    if (lhs === null || this.atEnd) return null;

    const start = this.index;
    // Skip visual space (e.g. `\ `, `\,`) before peeking postfix triggers, so
    // a `\{…\}` When-restriction can attach even when separated from its base
    // by space. Restricted to brace triggers: for other postfix operators —
    // notably `\left[…\right]` indexing — a preceding space means implicit
    // multiplication by a list literal (Desmos semantics), not a postfix.
    // The `this.index = start` no-match restore rolls back the skipped space.
    this.skipVisualSpace();
    if (this.index !== start) {
      const tok = this._tokens[this.index];
      const isBraceTrigger =
        tok === '\\{' ||
        (tok === '\\left' && this._tokens[this.index + 1] === '\\{');
      if (!isBraceTrigger) this.index = start;
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
        return this.error('unexpected-operator', start);
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
    result ??= this.tryParseBareRun();

    // ParseGenericExpression() has priority. Some generic expressions
    // may include symbols which have not been explicitly defined
    // with a 'symbol' kind
    result ??=
      this.parseGenericExpression(until) ??
      this.parseFunction(until) ??
      this.parseSymbol(until) ??
      parseInvalidSymbol(this);

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
    if (result !== null) {
      result = this.decorate(result, start);
      let postfix: MathJsonExpression | null = null;
      let index = this.index;
      do {
        postfix = this.parsePostfixOperator(result, until);
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
    if (result !== null) result = this.parseSupsub(result);

    //
    // 7b. Scripted-brace sequence notation: `\{a_n\}_{n=1}^{\infty}`.
    //     A `\{…\}` (Set) carrying an index-binding subscript (and optional
    //     upper superscript) denotes an indexed sequence, not a set indexed
    //     by an equation. Rewrite to the inert `IndexedSequence` head.
    //
    if (result !== null) result = parseIndexedSequence(result);

    //
    // 8. Are there postfix operators after subsup?
    //    (e.g. `[x,y]^{2}.max` where `.max` is a postfix applied after `^{2}`)
    //
    if (result !== null) {
      let postfix: MathJsonExpression | null = null;
      let index = this.index;
      do {
        postfix = this.parsePostfixOperator(result, until);
        result = postfix ?? result;
        if (this.index === index && postfix !== null) {
          console.assert(this.index !== index, 'No token consumed');
          break;
        }
        index = this.index;
      } while (postfix !== null);
    }

    if (result === null) {
      result = this.options.parseUnexpectedToken?.(null, this) ?? null;
      if (result === null && this.peek.startsWith('\\')) {
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
        // Gobble it.
        this.nextToken();
        result = this.error('unexpected-command', start);
      }
    }

    return this.decorate(result, start);
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
    const operandDiagCheckpoint = this.diagnosticsCheckpoint();

    until ??= { minPrec: 0 };
    console.assert(until.minPrec !== undefined);
    if (until.minPrec === undefined) until = { ...until, minPrec: 0 };

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
        this.skipSpace();

        // Expose this expression's operand checkpoint to the infix parselet
        // about to run (it consumes `lhs`, the already-parsed left operand).
        this._operandDiagnosticCheckpoint = operandDiagCheckpoint;
        let result = this.parseInfixOperator(lhs, until);
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
                if (operator(lhs) === 'InvisibleOperator') {
                  if (operator(rhs) === 'InvisibleOperator')
                    result = [
                      'InvisibleOperator',
                      ...operands(lhs),
                      ...operands(rhs),
                    ];
                  else result = ['InvisibleOperator', ...operands(lhs), rhs];
                } else if (operator(rhs) === 'InvisibleOperator') {
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
    if (!this.options.preserveLatex) return expr;

    const latex = this.latex(start, this.index);

    if (Array.isArray(expr)) {
      expr = { latex, fn: expr } as MathJsonExpression;
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
    const declaredAs = !this.isSymbolDeclared(name)
      ? 'unknown'
      : this.getSymbolType(name).matches('function')
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
    if (id === 'D' || id === 'N') return false;

    // Is this a valid function symbol?
    if (this.getSymbolType(id).matches('function')) return true;

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

/** Return true if `expr` is, or contains anywhere, an `Error` node. */
function containsError(expr: MathJsonExpression | null | undefined): boolean {
  if (expr === null || expr === undefined) return false;
  const op = operator(expr);
  if (op === 'Error') return true;
  if (op === '') return false;
  return operands(expr).some((x) => containsError(x));
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

export function parse(
  latex: string,
  dictionary: IndexedLatexDictionary,
  options: Readonly<ParseLatexOptions>
): MathJsonExpression | null {
  // Opt-in diagnostics collection. Comments (code `comment-discarded`) are
  // captured from the primary tokenization in original-input coordinates.
  const wantDiagnostics = !!options.diagnostics && !!options.onDiagnostic;
  const comments: DiscardedComment[] | undefined = wantDiagnostics
    ? []
    : undefined;
  const recovered: ParseDiagnostic[] = [];

  const primary = parseCore(latex, dictionary, options, comments);
  let expr = primary.expr;
  // The parser whose collected diagnostics (codes 1 & 2) describe the adopted
  // parse. Updated if a trailing-noise retry is adopted below.
  let adoptedParser = primary.parser;

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

  expr ??= 'Nothing';

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
    for (const c of comments!)
      sink({
        code: 'comment-discarded',
        start: c.start,
        end: c.end,
        detail: { discardedLength: c.discardedLength },
      });
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
