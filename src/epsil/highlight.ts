import {
  FANCY_UNICODE,
  HEX_DIGITS,
  REVERSED_ESCAPED_CHARS,
  ROOT_SIGN_UNICODE,
  isLinebreak,
} from './characters.js';
import { tokenize } from './lexer.js';
import { ACTIVE_WORDS, LITERAL_WORDS } from './reserved-words.js';
import type { Token } from './tokens.js';

//
// Syntax highlighting of Epsil source, line by line.
//
// The token boundaries are the lexer's: each line (or the part of it after a
// construct carried over from the line before) is run through `tokenize()`,
// and the tokens are given a style. Only the four constructs that can span
// lines are scanned here, because the lexer sees one line at a time: a block
// comment (nested), a `"""` string, a `$…$` LaTeX island, and the body of a
// string, whose escapes and `\(…)` interpolations get their own styles.
//
// The style names are `@lezer/highlight` tag names where one exists. The
// others (`latex`, `rawString`, `functionName`) are custom names that a host
// maps to tags itself (CodeMirror's `tokenTable`).
//

/** One styled range of a source string. Offsets are UTF-16 code units,
 * half-open. */
export interface EpsilHighlightToken {
  start: number;
  end: number;
  style: string;
}

/** The state carried from one line to the next. */
interface LineState {
  /** Nesting depth of the open block comment, 0 when none is open. */
  commentDepth: number;
  /** The open block comment is a doc comment (`/** … *\/`). */
  docComment: boolean;
  /** Inside a `"""` string. */
  inString: boolean;
  /** Inside a `$…$` LaTeX island. */
  inIsland: boolean;
  /** The next line is the first line of the source (a shebang is possible). */
  firstLine: boolean;
}

/**
 * The state of {@link epsilStreamParser}. Hosts treat it as opaque.
 */
export interface EpsilHighlightState extends LineState {
  /** The line the cached spans belong to. */
  line: string | null;
  /** Every span of `line`, contiguous, unstyled gaps with a `null` style. */
  spans: { start: number; end: number; style: string | null }[];
  /** The index in `spans` of the next span. */
  next: number;
}

/**
 * The part of CodeMirror's `StringStream` that the stream parser uses. A
 * structural type, so this module has no CodeMirror dependency.
 */
export interface EpsilStringStream {
  /** The text of the current line. */
  string: string;
  /** The current position in `string`. */
  pos: number;
  sol(): boolean;
  skipToEnd(): void;
}

/** The shape of a CodeMirror 6 `StreamParser`, for the members this module
 * provides. */
export interface EpsilStreamParser {
  name: string;
  startState(): EpsilHighlightState;
  token(stream: EpsilStringStream, state: EpsilHighlightState): string | null;
  blankLine(state: EpsilHighlightState): void;
  copyState(state: EpsilHighlightState): EpsilHighlightState;
  languageData: {
    commentTokens: { line: string; block: { open: string; close: string } };
  };
}

// The words that head a construct only in context: elsewhere they are
// ordinary names (`let type = 5`). See `CONTEXTUAL_STATEMENT_WORDS` in
// `reserved-words.ts` and `KEYWORDS_LIST` in `highlight-js-mode.js`.
const CONTEXTUAL_KEYWORDS = new Map<string, string>([
  ['let', 'definitionKeyword'],
  ['type', 'definitionKeyword'],
  ['alias', 'definitionKeyword'],
  ['readonly', 'definitionKeyword'],
  ['readwrite', 'definitionKeyword'],
  ['where', 'definitionKeyword'],
  ['parallel', 'controlKeyword'],
  ['is', 'operatorKeyword'],
]);

// The style of each word of `ACTIVE_WORDS`, which are keywords everywhere.
const ACTIVE_WORD_STYLES = new Map<string, string>([
  ['break', 'controlKeyword'],
  ['continue', 'controlKeyword'],
  ['do', 'controlKeyword'],
  ['else', 'controlKeyword'],
  ['for', 'controlKeyword'],
  ['if', 'controlKeyword'],
  ['match', 'controlKeyword'],
  ['while', 'controlKeyword'],
  ['const', 'definitionKeyword'],
  ['function', 'definitionKeyword'],
  ['protocol', 'definitionKeyword'],
  ['in', 'operatorKeyword'],
]);

// Library constants that are ordinary symbols for the lexer.
const CONSTANT_SYMBOLS = new Set([
  'Maybe',
  'Missing',
  'Nothing',
  'None',
  'All',
]);

// How deep strings nested in interpolations are styled as code.
const MAX_INTERPOLATION_DEPTH = 8;

const BOOLEANS = new Set(['true', 'false', 'True', 'False']);

// Glyph aliases of library functions (`FANCY_UNICODE`): styled like the
// operators they look like.
const FUNCTION_GLYPHS = new Set(['Integrate', 'Sum', 'Product']);

/**
 * Highlight one line.
 *
 * `start` is the state at the start of the line. Returns the styled ranges of
 * the line, in order, and the state at its end.
 */
function highlightLine(
  line: string,
  start: LineState
): { spans: EpsilHighlightToken[]; end: LineState } {
  const out: EpsilHighlightToken[] = [];
  const st: LineState = { ...start, firstLine: false };
  let pos = 0;

  if (st.commentDepth > 0) {
    const r = scanBlockComment(line, 0, st.commentDepth);
    push(out, 0, r.end, st.docComment ? 'docComment' : 'comment');
    st.commentDepth = r.depth;
    if (r.depth > 0) return { spans: out, end: st };
    pos = r.end;
  } else if (st.inString) {
    const r = scanStringBody(line, 0, line.length, '"""', out);
    if (!r.closed) return { spans: out, end: st };
    st.inString = false;
    pos = r.end;
  } else if (st.inIsland) {
    const r = scanIslandBody(line, 0);
    push(out, 0, r.end, 'latex');
    if (!r.closed) return { spans: out, end: st };
    st.inIsland = false;
    pos = r.end;
  }

  highlightCode(line, pos, line.length, start.firstLine && pos === 0, st, out);
  return { spans: out, end: st };
}

/**
 * Style the code in `line.slice(from, to)`, appending to `out`. A construct
 * left open at the end of the range is recorded in `st`.
 */
function highlightCode(
  line: string,
  from: number,
  to: number,
  allowShebang: boolean,
  st: LineState,
  out: EpsilHighlightToken[],
  depth = 0
): void {
  // A leading space keeps the lexer from reading `#!` as a shebang anywhere
  // but at the start of the source. It is trivia, so it changes no token.
  const prefix = allowShebang ? '' : ' ';
  const src = prefix + line.slice(from, to);
  const offset = from - prefix.length;
  const tokens = tokenize(src);

  let gapStart = prefix.length;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    scanGap(src, gapStart, tok.start, offset, out);
    gapStart = tok.end;
    // The lexer can step one unit past the end of its source (a `\` that
    // ends an unclosed string), so a range is clamped to the code.
    const start = Math.min(tok.start + offset, to);
    const end = Math.min(tok.end + offset, to);

    switch (tok.type) {
      case 'EOF':
        return;
      case 'SHEBANG':
      case 'PRAGMA':
        push(out, start, end, 'meta');
        break;
      case 'NUMBER':
        push(out, start, end, 'number');
        break;
      case 'SYMBOL':
        push(out, start, end, symbolStyle(src, tokens, i));
        break;
      case 'VERBATIM_SYMBOL':
        push(
          out,
          start,
          end,
          isCallee(tokens, i) ? 'functionName' : 'variableName'
        );
        break;
      case 'STRING':
        stringToken(line, src, tok, start, end, st, out, depth);
        break;
      case 'LATEX_ISLAND':
        push(out, start, end, 'latex');
        if (hasDiagnostic(tok, 'string-literal-closing-delimiter-expected'))
          st.inIsland = true;
        break;
      case 'OPERATOR':
      case 'SUPERSCRIPT':
      case 'SUBSCRIPT':
        push(out, start, end, 'operator');
        break;
      case 'OPEN_PAREN':
      case 'CLOSE_PAREN':
        push(out, start, end, 'paren');
        break;
      case 'OPEN_BRACKET':
      case 'CLOSE_BRACKET':
        push(out, start, end, 'squareBracket');
        break;
      case 'OPEN_BRACE':
      case 'CLOSE_BRACE':
        push(out, start, end, 'brace');
        break;
      case 'COMMA':
      case 'SEMICOLON':
        push(out, start, end, 'separator');
        break;
      case 'ERROR':
        if (hasDiagnostic(tok, 'end-of-comment-expected')) {
          // A block comment that does not close on this line.
          const isDoc = isDocBlockComment(src, tok.start);
          const r = scanBlockComment(src, tok.start + 2, 1);
          push(out, start, end, isDoc ? 'docComment' : 'comment');
          st.commentDepth = r.depth;
          st.docComment = isDoc;
        } else if (isGlyphOperator(tok.text)) {
          // `×`, `¬`, `√`, …: a glyph the lexer does not know arrives as an
          // `ERROR` token, and the parser reads it as an operator
          // (`operatorText` and `rootSignDegree` in `parser.ts`).
          push(out, start, end, 'operator');
        } else push(out, start, end, 'invalid');
        break;
    }
  }
}

/** Style the comments in the trivia `src.slice(from, to)`. */
function scanGap(
  src: string,
  from: number,
  to: number,
  offset: number,
  out: EpsilHighlightToken[]
): void {
  let i = from;
  while (i < to) {
    if (src[i] === '/' && src[i + 1] === '/') {
      const style = src[i + 2] === '/' ? 'docComment' : 'comment';
      let j = i;
      while (j < to && !isLinebreak(src.charCodeAt(j))) j += 1;
      push(out, i + offset, j + offset, style);
      i = j;
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const style = isDocBlockComment(src, i) ? 'docComment' : 'comment';
      const r = scanBlockComment(src, i + 2, 1);
      const j = Math.min(r.end, to);
      push(out, i + offset, j + offset, style);
      i = j;
    } else i += 1;
  }
}

/** At `/*`: is it a doc comment (`/**`, but not the empty `/**\/`)? */
function isDocBlockComment(src: string, at: number): boolean {
  return src[at + 2] === '*' && src[at + 3] !== '/';
}

/**
 * Scan a nested block comment from `from`, at nesting `depth`, to the end of
 * `src`. Returns where it stopped and the depth there (0 when it closed).
 */
function scanBlockComment(
  src: string,
  from: number,
  depth: number
): { end: number; depth: number } {
  let i = from;
  while (depth > 0 && i < src.length) {
    if (src[i] === '/' && src[i + 1] === '*') {
      depth += 1;
      i += 2;
    } else if (src[i] === '*' && src[i + 1] === '/') {
      depth -= 1;
      i += 2;
    } else i += 1;
  }
  return { end: i, depth };
}

/** Scan the body of a `$…$` island from `from` to its closing `$` (included)
 * or to the end of `line`. `\$` escapes a `$`, as in `scanLatexIsland`. */
function scanIslandBody(
  line: string,
  from: number
): { end: number; closed: boolean } {
  let i = from;
  while (i < line.length) {
    if (line[i] === '\\' && line[i + 1] === '$') i += 2;
    else if (line[i] === '$') return { end: i + 1, closed: true };
    else i += 1;
  }
  return { end: i, closed: false };
}

/** Style a `STRING` token. */
function stringToken(
  line: string,
  src: string,
  tok: Token,
  start: number,
  end: number,
  st: LineState,
  out: EpsilHighlightToken[],
  depth: number
): void {
  if (src[tok.start] === '#') {
    push(out, start, end, 'rawString');
    return;
  }
  if (src.startsWith('"""', tok.start)) {
    // The opening `"""` of a multiline string ends its line, so the string
    // is open at the end of the code. When the opening does not end its line
    // (`multiline-string-expected`), the token is the three quotes alone. A
    // line of a host that does not end lines at U+2028 can hold a whole
    // multiline string, which the lexer then closes: its body is styled here.
    push(out, start, Math.min(start + 3, end), 'string');
    if (hasDiagnostic(tok, 'string-literal-closing-delimiter-expected'))
      st.inString = true;
    if (!hasDiagnostic(tok, 'multiline-string-expected'))
      scanStringBody(line, start + 3, end, '"""', out, depth);
    return;
  }
  push(out, start, start + 1, 'string'); // opening `"`
  scanStringBody(line, start + 1, end, '"', out, depth);
}

/**
 * Style the body of a string from `from`, up to and including its closing
 * delimiter, or up to `to`. Escapes are `escape`, a `\(…)` interpolation is
 * styled as code between two `escape` delimiters, the rest is `string`.
 */
function scanStringBody(
  line: string,
  from: number,
  to: number,
  closer: '"' | '"""',
  out: EpsilHighlightToken[],
  depth = 0
): { end: number; closed: boolean } {
  let i = from;
  let textStart = from;
  const flush = (at: number) => {
    push(out, textStart, at, 'string');
  };
  while (i < to) {
    if (line.startsWith(closer, i)) {
      i += closer.length;
      flush(i);
      return { end: i, closed: true };
    }
    if (line[i] !== '\\') {
      i += 1;
      continue;
    }
    flush(i);
    if (line[i + 1] === '(') {
      // Interpolation: the closing `)` is found by depth counting on this
      // line, as `scanInterpolationSpan` does.
      push(out, i, i + 2, 'escape');
      const inner = i + 2;
      let j = inner;
      let parens = 1;
      while (j < to) {
        if (line[j] === '(') parens += 1;
        else if (line[j] === ')') {
          parens -= 1;
          if (parens === 0) break;
        }
        j += 1;
      }
      const scratch: LineState = {
        commentDepth: 0,
        docComment: false,
        inString: false,
        inIsland: false,
        firstLine: false,
      };
      // Each level of strings nested in interpolations scans its inner code
      // again: past a few levels, the inner code is styled as string.
      if (depth < MAX_INTERPOLATION_DEPTH)
        highlightCode(line, inner, j, false, scratch, out, depth + 1);
      else push(out, inner, j, 'string');
      if (j < to) {
        push(out, j, j + 1, 'escape');
        j += 1;
      }
      i = j;
    } else {
      const n = escapeLength(line, i, to, closer === '"""');
      push(out, i, i + n.length, n.valid ? 'escape' : 'invalid');
      i += n.length;
    }
    textStart = i;
  }
  flush(i);
  return { end: i, closed: false };
}

/** The length of the escape sequence at the `\` at `at`, as
 * `scanEscapeSequence` reads it. A `\` that ends a line of a `"""` string
 * (`multiline`), alone or before spaces and tabs, is a line continuation,
 * styled as an escape. In a single-line string, a `\` that ends the line is
 * an invalid escape, and so is a `\` before a space or a tab. */
function escapeLength(
  line: string,
  at: number,
  to: number,
  multiline: boolean
): { length: number; valid: boolean } {
  if (at + 1 >= to) return { length: 1, valid: multiline };
  const next = line.codePointAt(at + 1)!;
  if (REVERSED_ESCAPED_CHARS.has(next)) return { length: 2, valid: true };
  if (multiline && (next === 0x20 || next === 0x09)) {
    let j = at + 1;
    while (line[j] === ' ' || line[j] === '\t') j += 1;
    if (j >= line.length) return { length: j - at, valid: true };
  }
  if (next !== 0x75)
    return { length: Math.min(next > 0xffff ? 3 : 2, to - at), valid: false };
  // `\u{1F600}` (up to 8 hex digits) or `\u0041` (exactly 4), naming a
  // Unicode scalar value: not above U+10FFFF, not a surrogate. A malformed
  // escape covers what `scanEscapeSequence` consumes: the `\u` or `\u{`, the
  // hex digits that follow (at most 4, or 8 in braces), and in the braced
  // form the `}` when it comes next. It ends before any other character.
  let k = at + 2;
  const braced = line[k] === '{' && k < to;
  if (braced) k += 1;
  const digitsStart = k;
  const maxDigits = braced ? 8 : 4;
  let code = 0;
  while (k < to && k - digitsStart < maxDigits) {
    const digit = HEX_DIGITS.get(line.charCodeAt(k));
    if (digit === undefined) break;
    code = 16 * code + digit;
    k += 1;
  }
  const count = k - digitsStart;
  let valid = braced ? count > 0 : count === 4;
  if (braced) {
    if (k < to && line[k] === '}') k += 1;
    else valid = false;
  }
  valid = valid && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
  return { length: k - at, valid };
}

/** Is `text` one glyph that the parser reads as an operator: a fancy-Unicode
 * operator (`×`, `¬`, `∈`) or a radical sign (`√`, `∛`, `∜`)? */
function isGlyphOperator(text: string): boolean {
  const c = text.codePointAt(0);
  if (c === undefined || text.length !== (c > 0xffff ? 2 : 1)) return false;
  return FANCY_UNICODE.has(c) || ROOT_SIGN_UNICODE.has(c);
}

/** The style of the `SYMBOL` token `tokens[i]`. */
function symbolStyle(src: string, tokens: Token[], i: number): string {
  const tok = tokens[i];
  const word = tok.text;
  const raw = src.slice(tok.start, tok.end);

  // A glyph alias (`π`, `ℝ`, `∞`, `∑`): `text` is the name it stands for.
  if (raw !== word && isGlyph(raw))
    return FUNCTION_GLYPHS.has(word) ? 'operator' : 'atom';

  const afterDot =
    i > 0 &&
    tokens[i - 1].type === 'OPERATOR' &&
    (tokens[i - 1].text === '.' || tokens[i - 1].text === '::') &&
    !tok.precededByWhitespace;

  if (!afterDot) {
    const active = ACTIVE_WORD_STYLES.get(word);
    if (active !== undefined && ACTIVE_WORDS.has(word)) return active;
    if (BOOLEANS.has(word)) return 'bool';
    if (LITERAL_WORDS.has(word) || CONSTANT_SYMBOLS.has(word)) return 'atom';
    const contextual = CONTEXTUAL_KEYWORDS.get(word);
    if (contextual !== undefined && headsConstruct(tokens, i))
      return contextual;
    // The module qualifier of `std::name`.
    const next = tokens[i + 1];
    if (
      next?.type === 'OPERATOR' &&
      next.text === '::' &&
      !next.precededByWhitespace
    )
      return 'namespace';
  }

  return isCallee(tokens, i) ? 'functionName' : 'variableName';
}

/** Is `raw` a single glyph of `FANCY_UNICODE`? */
function isGlyph(raw: string): boolean {
  const c = raw.codePointAt(0)!;
  return raw.length === (c > 0xffff ? 2 : 1) && FANCY_UNICODE.has(c);
}

/**
 * Does the contextual word `tokens[i]` head a construct? It does when a name
 * or a keyword follows it on the line (`let x`, `type T`, `x is real`,
 * `parallel for`), or a `(` follows `let`; `let type = 5` makes `type` a
 * name.
 */
function headsConstruct(tokens: Token[], i: number): boolean {
  const next = tokens[i + 1];
  if (next === undefined || next.precededByLinebreak) return false;
  // `let (q, r) = divmod(17, 5)` destructures (`parseDeclaration`).
  if (tokens[i].text === 'let' && next.type === 'OPEN_PAREN') return true;
  return next.type === 'SYMBOL' || next.type === 'VERBATIM_SYMBOL';
}

/** Is the name `tokens[i]` called? A `(` that abuts a name is always a call
 * clause (`parsePostfix` in `parser.ts`): `f(x)`, never `f (x)`. */
function isCallee(tokens: Token[], i: number): boolean {
  const next = tokens[i + 1];
  return next?.type === 'OPEN_PAREN' && !next.precededByWhitespace;
}

function hasDiagnostic(tok: Token, code: string): boolean {
  return (
    tok.diagnostics?.some((d) =>
      typeof d === 'string' ? d === code : d[0] === code
    ) ?? false
  );
}

function push(
  out: EpsilHighlightToken[],
  start: number,
  end: number,
  style: string
): void {
  if (end <= start) return;
  // Adjacent string ranges are one range: `"hi` is one string, not a quote
  // and a text. Other ranges stay apart: `((` is two tokens.
  const last = out[out.length - 1];
  if (
    style === 'string' &&
    last !== undefined &&
    last.end === start &&
    last.style === style
  )
    last.end = end;
  else out.push({ start, end, style });
}

function initialLineState(): LineState {
  return {
    commentDepth: 0,
    docComment: false,
    inString: false,
    inIsland: false,
    firstLine: true,
  };
}

function lineState(state: LineState): LineState {
  return {
    commentDepth: state.commentDepth,
    docComment: state.docComment,
    inString: state.inString,
    inIsland: state.inIsland,
    firstLine: state.firstLine,
  };
}

/** Fill the gaps between styled spans with unstyled ones, so the spans cover
 * the whole line. */
function contiguous(
  spans: EpsilHighlightToken[],
  length: number
): EpsilHighlightState['spans'] {
  const out: EpsilHighlightState['spans'] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ start: pos, end: s.start, style: null });
    out.push(s);
    pos = s.end;
  }
  if (pos < length) out.push({ start: pos, end: length, style: null });
  return out;
}

/**
 * A CodeMirror 6 `StreamParser` for Epsil. Use it with
 * `StreamLanguage.define(epsilStreamParser)` from `@codemirror/language`.
 *
 * The style names are `@lezer/highlight` tag names, plus three custom names
 * that the host maps with the `tokenTable` option of `StreamLanguage`:
 * `latex` (a `$…$` island), `rawString` (`#"…"#`) and `functionName` (a name
 * that is called).
 */
export const epsilStreamParser: EpsilStreamParser = {
  name: 'epsil',

  startState(): EpsilHighlightState {
    return { ...initialLineState(), line: null, spans: [], next: 0 };
  },

  token(stream, state) {
    if (stream.sol() || state.line !== stream.string) {
      const { spans, end } = highlightLine(stream.string, lineState(state));
      state.line = stream.string;
      state.spans = contiguous(spans, stream.string.length);
      state.next = 0;
      Object.assign(state, end);
    }
    let i = state.next;
    if (state.spans[i]?.start !== stream.pos)
      i = state.spans.findIndex((s) => s.start === stream.pos);
    const span = state.spans[i];
    if (span === undefined) {
      stream.skipToEnd();
      return null;
    }
    state.next = i + 1;
    stream.pos = span.end;
    return span.style;
  },

  blankLine(state) {
    state.firstLine = false;
    state.line = null;
  },

  copyState(state) {
    return { ...state };
  },

  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
};

/**
 * The styled ranges of an Epsil source, with the style names of
 * {@link epsilStreamParser}. Ranges with no style (white space) are left out.
 */
export function epsilHighlightTokens(source: string): EpsilHighlightToken[] {
  const out: EpsilHighlightToken[] = [];
  let state = initialLineState();
  // Lines end at `\n`, `\r\n`, `\r`, U+2028 and U+2029, as in the lexer.
  const re = /\r\n|[\n\r\u2028\u2029]/g;
  let lineStart = 0;
  for (;;) {
    const m = re.exec(source);
    const lineEnd = m === null ? source.length : m.index;
    const line = source.slice(lineStart, lineEnd);
    if (line.length === 0) state = { ...state, firstLine: false };
    else {
      const r = highlightLine(line, state);
      for (const s of r.spans)
        out.push({
          start: s.start + lineStart,
          end: s.end + lineStart,
          style: s.style,
        });
      state = r.end;
    }
    if (m === null) break;
    lineStart = m.index + m[0].length;
  }
  return out;
}
