import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import {
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import { isValidSymbol } from '../math-json/symbols.js';
import type { FunctionSignature, Type } from '../common/type/types.js';
import { parseType } from '../common/type/parse.js';
import { PRIMITIVE_TYPES } from '../common/type/primitive.js';
import { typeToString } from '../common/type/serialize.js';

import {
  isBreak,
  isIdentifierContinueProhibited,
  isSubscript,
  isSuperscript,
} from './characters.js';
import { describeName } from './describe-name.js';
import { tokenize } from './lexer.js';
import {
  canonicalLibraryName,
  epsilLibraryNames,
  GRAMMAR_CONSTRUCTS,
} from './library-names.js';
import {
  documentBindings,
  isNameVisibleAt,
  type BindingGroup,
} from './occurrences.js';
import { parseEpsil } from './parse-epsil.js';
import { escapeSymbol, serializeEpsil } from './serialize-epsil.js';
import type { Token } from './tokens.js';

//
// Completion at an offset of an Epsil source.
//
// The context comes from a HOLE: the word being typed is replaced by a
// placeholder name that does not occur in the source, the result is parsed,
// and the placeholder is found in the raw tree by its `sourceOffsets`. The
// parser's recovery keeps an unclosed `[1, ▮` or `Sin(▮` as a `List` or a
// call, so the parent of the placeholder tells what is expected there. A
// statement that does not parse (`if ▮`, `let a: ▮`) is dropped by the
// parser: a type position is then detected from the tokens before the
// offset, and any other dropped position gets the names and the keywords.
//
// Design: `docs/plans/2026-11-19-ce1521-epsil-completion.md`.
//

/** One completion item. */
export type EpsilCompletionItem = {
  label: string;
  kind:
    | 'fixit'
    | 'variable'
    | 'function'
    | 'type'
    | 'library-function'
    | 'library-constant'
    | 'keyword'
    | 'value';
  /** The text inserted over the `range` of the completions, when it differs
   * from `label`. A fix-it has `edits` instead. */
  insertText?: string;
  /** The edits of a fix-it, as `[start, end, text]` offsets of the source. */
  edits?: [start: number, end: number, text: string][];
  /** A signature (`(real, integer) -> real`) or a type. */
  detail?: string;
  /** The first line of the library description, for a library name. */
  documentation?: string;
  /** The paragraphs of the library description, for a library name: what
   * the hover of the name shows. */
  description?: string[];
  /** Smaller first: 0 fix-its, 1 likely values, 2 names of the source whose
   * type matches the expected type, 3 library names whose type matches, 4
   * other names of the source, 5 other library names, 6 keywords. */
  rank: number;
};

/** The completions at an offset of an Epsil source. */
export type EpsilCompletions = {
  /** The text that an item replaces: the word being typed before the offset
   * (`[offset, offset]` when there is none). */
  range: [start: number, end: number];
  /** The end of the word under the offset, at or after `range[1]`: an editor
   * that replaces the whole word (`l▮e` accepting `let` gives `let`, not
   * `lete`) replaces `[range[0], replaceEnd]`. */
  replaceEnd: number;
  /** The type expected at the offset, when the context gives one. */
  expectedType?: string;
  /** The items whose label starts with the word being typed, ignoring case,
   * sorted by `rank`, then locals before globals, then label. */
  items: EpsilCompletionItem[];
};

/** Statement heads, offered at the start of a statement. */
const STATEMENT_KEYWORDS = [
  'break',
  'const',
  'continue',
  'do',
  'for',
  'function',
  'if',
  'let',
  'match',
  'parallel',
  'protocol',
  'type',
  'while',
];

/** Keywords that start an expression. */
const EXPRESSION_KEYWORDS = ['false', 'if', 'match', 'true'];

/** Expected types that do not narrow the items. */
const UNINFORMATIVE_TYPES: ReadonlySet<string> = new Set([
  'any',
  'unknown',
  'expression',
  'value',
]);

/** Whether a code point continues a name, by the lexer's rule (`scanSymbol`):
 * a combining mark or an emoji does. A superscript is an exponent and a
 * subscript is respelled (`xₙ` is `x_n`), so both end the word. */
const isWordChar = (c: number): boolean =>
  !isBreak(c) &&
  !isIdentifierContinueProhibited(c) &&
  !isSuperscript(c) &&
  !isSubscript(c);

/** A type declared by the source, with what `likelyValues` needs. */
export type SourceType =
  | {
      kind: 'sum';
      /** `payload` is `undefined` for a variant known only from the
       * `sumVariants` option, whose payload is unknown. */
      variants: { name: string; payload: string[] | undefined }[];
    }
  | { kind: 'alias' | 'nominal'; body: string };

/** What the declaring node of a name says about its type. */
export type Declaration =
  | { kind: 'value'; type: string }
  | {
      kind: 'function';
      params: (string | undefined)[];
      /** The name of each parameter, for a named argument. */
      names: (string | undefined)[];
      /** Whether each parameter has a default value. */
      optional: boolean[];
      /** Whether the last parameter is a rest parameter (`...xs`). */
      rest: boolean;
      /** The ascription of the body: the return type, or the full signature
       * when the definition declares effects or type parameters. */
      result?: string;
      /** The offset of the ascription in the source: a return type follows
       * the `->` of the header, a full signature starts at the effects or at
       * the type parameters. */
      resultStart?: number;
    }
  | { kind: 'type'; detail: string }
  | { kind: 'protocol' };

/** A library name as an item, computed once per engine. */
type LibraryEntry = {
  label: string;
  kind: 'library-function' | 'library-constant';
  detail?: string;
  documentation?: string;
  description?: string[];
  /** The result type of a function, the type of a constant. */
  type?: Type;
};

const LIBRARY_ENTRIES = new WeakMap<ComputeEngine, LibraryEntry[]>();

/**
 * The completion items at `offset` of `source`.
 *
 * The items are the likely values of the type expected at the offset (`0`
 * for `let a: integer = ▮`), the names of the source that are visible at
 * the offset, the standard-library names (by their Epsil spelling, with
 * their signature) and the keywords valid at the position. After `:` in a
 * declaration or a parameter, after `->` of a function header, and after
 * `type name =`, the items are the type names instead.
 *
 * The options are those of `parseEpsil()`: the type, protocol and sum
 * variant names that the source may use without declaring them.
 */
export function epsilCompletions(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options?: {
    typeNames?: readonly string[];
    protocolNames?: readonly string[];
    sumVariants?: Readonly<Record<string, string>>;
  }
): EpsilCompletions {
  offset = Math.max(0, Math.min(offset, source.length));
  let [start, end] = wordAt(source, offset);
  const tokens = tokenize(source);
  // A word typed after an opening backtick (`` `wh▮ ``) is a verbatim name:
  // the range covers the backtick, and the items match the text after it.
  // An unclosed verbatim name ends with the linebreak that ends its token; a
  // closed one (`` `wh▮` ``) contains the offset before its closing backtick,
  // and the word to replace runs to that backtick.
  const verbatimToken = tokens.find((t) => {
    if (t.type !== 'VERBATIM_SYMBOL' || t.start >= offset) return false;
    if (/[\n\r\u2028\u2029]/.test(source.slice(t.start, offset))) return false;
    const unclosed = t.diagnostics?.some(
      (d) => (typeof d === 'string' ? d : d[0]) === 'unbalanced-verbatim-symbol'
    );
    return unclosed ? offset <= t.end : offset < t.end;
  });
  const verbatim = verbatimToken !== undefined;
  if (verbatim) {
    start = verbatimToken.start;
    if (source[verbatimToken.end - 1] === '`' && offset < verbatimToken.end)
      end = verbatimToken.end;
  }
  const prefix = source.slice(verbatim ? start + 1 : start, offset);
  const range: [number, number] = [start, offset];
  const replaceEnd = end;

  // A digit starts a number literal, not a name.
  if (!verbatim && /^\p{N}/u.test(prefix))
    return { range, replaceEnd, items: [] };

  if (insideLiteralOrComment(source, tokens, start))
    return { range, replaceEnd, items: [] };
  const before = tokens.filter((t) => t.type !== 'EOF' && t.end <= start);

  const { text, placeholder, ast } = parseWithHole(source, start, end, options);
  const groups = documentBindings(ast, text);
  const declarations = collectDeclarations(ast);
  const sourceTypes = collectSourceTypes(ast, options?.sumVariants);

  const items: (EpsilCompletionItem & { tier: number })[] = [];

  if (isTypePosition(before)) {
    const seen = new Set<string>();
    const add = (label: string, rank: number, detail?: string) => {
      if (seen.has(label)) return;
      seen.add(label);
      items.push({
        label,
        kind: 'type',
        rank,
        tier: 0,
        ...(detail === undefined ? {} : { detail }),
      });
    };
    // A protocol is not a type (`protocol-in-type-position`, ruling P8).
    for (const group of groups) {
      if (group.kind !== 'type') continue;
      const declaration = declarationOf(group, declarations);
      if (declaration?.kind === 'protocol') continue;
      add(
        group.name,
        2,
        declaration?.kind === 'type' ? declaration.detail : undefined
      );
    }
    for (const name of options?.typeNames ?? []) add(name, 2);
    for (const name of Object.values(options?.sumVariants ?? {})) add(name, 2);
    // A variant of a sum type of the source is a type (`let a: red = red()`);
    // a variant known only from the options is not.
    for (const [sum, declared] of sourceTypes)
      if (declared.kind === 'sum')
        for (const variant of declared.variants)
          if (variant.payload !== undefined) add(variant.name, 2, sum);
    for (const name of [...PRIMITIVE_TYPES, 'matrix', 'tensor', 'vector'])
      add(name, 3);
    return { range, replaceEnd, items: finish(items, prefix) };
  }

  const path = findHole(ast, placeholder, start);
  const statementStart =
    path === undefined
      ? isStatementStart(source, before, start)
      : ['Program', 'Block'].includes(
          operator(path.nodes[path.nodes.length - 2])
        );

  const visible = visibleBindings(groups, placeholder, start);

  const context: Context = {
    ce,
    nodes: path?.nodes ?? [],
    indices: path?.indices ?? [],
    ast,
    visible,
    declarations,
    sourceTypes,
  };
  let expectedType =
    path === undefined
      ? undefined
      : expectedTypeAt(context, path.nodes.length - 1);
  if (expectedType !== undefined && UNINFORMATIVE_TYPES.has(expectedType))
    expectedType = undefined;

  // 1. Likely values of the expected type.
  if (expectedType !== undefined)
    for (const value of likelyValues(context, expectedType, 0))
      items.push({ label: value, kind: 'value', rank: 1, tier: 0 });

  // 2. Names of the source visible at the offset.
  const textLength = text.length;
  const typeNames = new Set([
    ...(options?.typeNames ?? []),
    ...sourceTypes.keys(),
  ]);
  for (const group of visible.values()) {
    const declaration = declarationOf(group, declarations);
    const kind: EpsilCompletionItem['kind'] =
      group.kind === 'function'
        ? 'function'
        : group.kind === 'type'
          ? 'type'
          : 'variable';
    let detail: string | undefined;
    let type: string | undefined;
    if (declaration?.kind === 'value') detail = type = declaration.type;
    else if (declaration?.kind === 'function') {
      const { params, tail, result } = functionSignatureParts(
        ce,
        declaration,
        text,
        typeNames
      );
      detail = `(${params
        .map((p, i) => (p ?? 'any') + (declaration.optional[i] ? '?' : ''))
        .join(', ')})${tail}`;
      type = result;
    } else if (declaration?.kind === 'type') detail = declaration.detail;
    const matches =
      expectedType !== undefined &&
      kind !== 'type' &&
      type !== undefined &&
      typeMatches(ce, type, expectedType);
    const local = group.scope[0] !== 0 || group.scope[1] !== textLength;
    // A name that needs backticks (`` `while` ``) is inserted with them.
    const spelling = escapeSymbol(group.name);
    items.push({
      label: group.name,
      kind,
      rank: matches ? 2 : 4,
      tier: local ? 0 : 1,
      ...(spelling === group.name ? {} : { insertText: spelling }),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  // The variants of the sum types, as constructors. A variant is a call,
  // also when it has no payload (`green()`); a variant known only from the
  // options has an unknown payload, and is inserted as its name.
  for (const [sum, declared] of sourceTypes) {
    if (declared.kind !== 'sum') continue;
    for (const variant of declared.variants) {
      if (visible.has(variant.name)) continue;
      const spelling = escapeSymbol(variant.name);
      const payload = variant.payload;
      const matches =
        expectedType !== undefined && typeMatches(ce, sum, expectedType);
      items.push({
        label: variant.name,
        kind: 'function',
        rank: matches ? 2 : 4,
        tier: 1,
        ...(payload?.length === 0
          ? { insertText: `${spelling}()` }
          : spelling === variant.name
            ? {}
            : { insertText: spelling }),
        detail:
          payload === undefined ? sum : `(${payload.join(', ')}) -> ${sum}`,
      });
    }
  }

  // 3. Library names, unless a name of the source shadows them.
  for (const entry of libraryEntries(ce)) {
    if (visible.has(entry.label)) continue;
    const matches =
      expectedType !== undefined &&
      entry.type !== undefined &&
      typeMatches(ce, entry.type, expectedType);
    items.push({
      label: entry.label,
      kind: entry.kind,
      rank: matches ? 3 : 5,
      tier: 0,
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
      ...(entry.documentation === undefined
        ? {}
        : { documentation: entry.documentation }),
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
    });
  }

  // 4. Keywords. At the start of a statement an expression is valid too.
  const keywords = statementStart
    ? new Set([...STATEMENT_KEYWORDS, ...EXPRESSION_KEYWORDS])
    : EXPRESSION_KEYWORDS;
  // A name of the source hides a keyword only when it inserts the same text:
  // `` `while` `` does not hide `while`.
  for (const keyword of keywords)
    if (!visible.has(keyword) || escapeSymbol(keyword) !== keyword)
      items.push({ label: keyword, kind: 'keyword', rank: 6, tier: 0 });

  return {
    range,
    replaceEnd,
    ...(expectedType === undefined ? {} : { expectedType }),
    items: finish(items, prefix),
  };
}

/** The word under `offset`, as `[start, end]`: the word is scanned by code
 * point (`𝑥` is two UTF-16 units), the offsets stay UTF-16 offsets. */
export function wordAt(source: string, offset: number): [number, number] {
  let start = offset;
  while (start > 0) {
    const pair = source.slice(Math.max(0, start - 2), start);
    const char =
      pair.length === 2 && pair.codePointAt(0)! > 0xffff
        ? pair
        : source[start - 1];
    if (!isWordChar(char.codePointAt(0)!)) break;
    start -= char.length;
  }
  let end = offset;
  while (end < source.length) {
    const char = String.fromCodePoint(source.codePointAt(end)!);
    if (!isWordChar(char.codePointAt(0)!)) break;
    end += char.length;
  }
  return [start, end];
}

/** The source with the hole: `[start, end]` (the whole word under the
 * offset, so that the rest of a word does not glue to the placeholder)
 * replaced by a placeholder name that does not occur in the source, and its
 * raw parse, or `null` when the parse throws. */
export function parseWithHole(
  source: string,
  start: number,
  end: number,
  options:
    | {
        typeNames?: readonly string[];
        protocolNames?: readonly string[];
        sumVariants?: Readonly<Record<string, string>>;
      }
    | undefined
): { text: string; placeholder: string; ast: MathJsonExpression | null } {
  let placeholder = 'completionHole';
  for (let i = 1; source.includes(placeholder); i += 1)
    placeholder = `completionHole${i}`;
  const text = source.slice(0, start) + placeholder + source.slice(end);
  let ast: MathJsonExpression | null = null;
  try {
    [ast] = parseEpsil(text, undefined, {
      typeNames: options?.typeNames,
      protocolNames: options?.protocolNames,
      sumVariants: options?.sumVariants,
    });
  } catch {
    // A `#error` pragma throws: no tree.
  }
  return { text, placeholder, ast };
}

/** The innermost binding of each name visible at `start`. */
export function visibleBindings(
  groups: readonly BindingGroup[],
  placeholder: string,
  start: number
): Map<string, BindingGroup> {
  const visible = new Map<string, BindingGroup>();
  for (const group of groups) {
    if (group.kind === 'free' || group.name === placeholder) continue;
    if (!isNameVisibleAt([group], group.name, start)) continue;
    const known = visible.get(group.name);
    if (known === undefined || group.scope[0] >= known.scope[0])
      visible.set(group.name, group);
  }
  return visible;
}

/** Keep the items that match `prefix`, sort them and drop the sort tier. */
function finish(
  items: (EpsilCompletionItem & { tier: number })[],
  prefix: string
): EpsilCompletionItem[] {
  const lower = prefix.toLowerCase();
  const seen = new Set<string>();
  return items
    .filter((item) => item.label.toLowerCase().startsWith(lower))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.tier - b.tier ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    )
    .filter((item) => {
      // A text offered twice (a keyword that is also a likely value, such
      // as `true`) keeps its first, best-ranked item.
      const text = item.insertText ?? item.label;
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    })
    .map(({ tier: _tier, ...item }) => item);
}

/** Whether `start` is inside a string, a LaTeX island or a comment. */
export function insideLiteralOrComment(
  source: string,
  tokens: readonly Token[],
  start: number
): boolean {
  for (const token of tokens) {
    // An unclosed string or island runs to the end of its line or of the
    // source, an unclosed block comment (an `ERROR` token) to the end of the
    // source: the offset just past it is still inside.
    const unclosed = token.diagnostics?.some((d) => {
      const code = typeof d === 'string' ? d : d[0];
      return (
        code === 'string-literal-closing-delimiter-expected' ||
        code === 'string-literal-opening-delimiter-expected' ||
        code === 'end-of-comment-expected'
      );
    });
    if (unclosed && token.start < start && start <= token.end) return true;
    if (token.type !== 'STRING' && token.type !== 'LATEX_ISLAND') continue;
    if (token.start < start && start < token.end) return true;
  }
  // Between tokens the source is whitespace and comments. Lex the trivia
  // before `start` followed by a name: the name is a token unless the trivia
  // ends inside a comment (nested block comments and `//` inside a closed
  // block comment follow the lexer's rules).
  let gapStart = 0;
  for (const token of tokens)
    if (token.type !== 'EOF' && token.end <= start) gapStart = token.end;
  const gap = source.slice(gapStart, start);
  return !tokenize(gap + 'x').some(
    (t) => t.type === 'SYMBOL' && t.start === gap.length
  );
}

/**
 * Whether the tokens before the word being typed end at a type position:
 * `let name:` or `const name:`, `name:` among the parameters of a
 * `function` header, `->` after the parameter list of a `function` header,
 * or `type name =`, or inside the annotation that follows one of these:
 * after `<`, after `,` between type arguments, or after `|`
 * (`let xs: list<▮`, `let x: integer | ▮`). The tokens decide, because the
 * parser drops a statement whose annotation does not parse.
 */
function isTypePosition(before: readonly Token[]): boolean {
  // Inside an annotation: scan back over the tokens of a type, then check
  // that they follow an annotation start and alternate operand, operator.
  const last = before[before.length - 1];
  if (
    (last?.type === 'OPERATOR' && (last.text === '<' || last.text === '|')) ||
    last?.type === 'COMMA'
  ) {
    const isOperand = (t: Token) => t.type === 'SYMBOL' || t.type === 'NUMBER';
    const isOperator = (t: Token) =>
      t.type === 'COMMA' ||
      (t.type === 'OPERATOR' &&
        ['<', '>', '>>', '|', '^', '..'].includes(t.text));
    let i = before.length - 1;
    while (i >= 0 && (isOperand(before[i]) || isOperator(before[i]))) i -= 1;
    if (i < 0 || !isAnnotationStart(before.slice(0, i + 1))) return false;
    let depth = 0;
    let operand = true;
    for (const t of before.slice(i + 1)) {
      // A closing `>` or `>>` follows an operand and is followed by an
      // operator, as an operand is.
      if (t.text === '>' || t.text === '>>') {
        if (operand) return false;
        depth -= t.text.length;
      } else {
        if (isOperand(t) !== operand) return false;
        operand = !operand;
        if (t.text === '<') depth += 1;
      }
      if (depth < 0 || (t.type === 'COMMA' && depth === 0)) return false;
    }
    return true;
  }
  return isAnnotationStart(before);
}

/** Whether the tokens end at the start of an annotation (see
 * `isTypePosition`). */
function isAnnotationStart(before: readonly Token[]): boolean {
  const last = before[before.length - 1];
  if (last?.type !== 'OPERATOR') return false;
  const word = (i: number): string | undefined =>
    before[i]?.type === 'SYMBOL' ? before[i].text : undefined;
  const n = before.length;
  if (last.text === ':') {
    if (word(n - 2) === undefined) return false;
    const head = word(n - 3);
    if (head === 'let' || head === 'const') return true;
    const separator = before[n - 3]?.type;
    if (separator !== 'OPEN_PAREN' && separator !== 'COMMA') return false;
    return isFunctionHeader(before, openingParen(before, n - 3));
  }
  if (last.text === '->') {
    if (before[n - 2]?.type !== 'CLOSE_PAREN') return false;
    return isFunctionHeader(before, openingParen(before, n - 3));
  }
  if (last.text === '=') {
    if (word(n - 2) === undefined) return false;
    return (
      word(n - 3) === 'type' ||
      (word(n - 3) === 'alias' && word(n - 4) === 'type')
    );
  }
  return false;
}

/** The index of the unmatched `(` at or before `i`, or -1. */
function openingParen(before: readonly Token[], i: number): number {
  let depth = 0;
  for (let j = i; j >= 0; j -= 1) {
    const type = before[j].type;
    if (
      type === 'CLOSE_PAREN' ||
      type === 'CLOSE_BRACKET' ||
      type === 'CLOSE_BRACE'
    )
      depth += 1;
    else if (
      type === 'OPEN_PAREN' ||
      type === 'OPEN_BRACKET' ||
      type === 'OPEN_BRACE'
    ) {
      if (depth === 0) return type === 'OPEN_PAREN' ? j : -1;
      depth -= 1;
    }
  }
  return -1;
}

/** Whether the `(` at `paren` opens the parameters of `function name(`. As
 * in the parser, the name may be verbatim. */
export function isFunctionHeader(
  before: readonly Token[],
  paren: number
): boolean {
  return (
    paren >= 2 &&
    (before[paren - 1].type === 'SYMBOL' ||
      before[paren - 1].type === 'VERBATIM_SYMBOL') &&
    before[paren - 2].type === 'SYMBOL' &&
    before[paren - 2].text === 'function'
  );
}

/** For a position the parser dropped: whether it starts a statement. */
function isStatementStart(
  source: string,
  before: readonly Token[],
  start: number
): boolean {
  const last = before[before.length - 1];
  if (last === undefined) return true;
  if (
    last.type === 'SEMICOLON' ||
    last.type === 'OPEN_BRACE' ||
    last.type === 'CLOSE_BRACE'
  )
    return true;
  if (
    last.type === 'OPERATOR' ||
    last.type === 'OPEN_PAREN' ||
    last.type === 'OPEN_BRACKET' ||
    last.type === 'COMMA'
  )
    return false;
  return source.slice(last.end, start).includes('\n');
}

/** The path from the root to the placeholder: `nodes[k]` is operand
 * `indices[k]` (zero-based, the head not counted) of `nodes[k - 1]`. */
export type HolePath = { nodes: MathJsonExpression[]; indices: number[] };

export function findHole(
  ast: MathJsonExpression | null,
  placeholder: string,
  start: number
): HolePath | undefined {
  if (ast === null) return undefined;
  const nodes: MathJsonExpression[] = [];
  const indices: number[] = [];
  const visit = (node: MathJsonExpression, index: number): boolean => {
    nodes.push(node);
    indices.push(index);
    if (symbol(node) === placeholder && spanOf(node)?.[0] === start)
      return true;
    const ops = operands(node);
    for (let i = 0; i < ops.length; i += 1) if (visit(ops[i], i)) return true;
    nodes.pop();
    indices.pop();
    return false;
  };
  return visit(ast, -1) ? { nodes, indices } : undefined;
}

export function spanOf(
  node: MathJsonExpression | null
): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}

type Context = {
  ce: ComputeEngine;
  nodes: MathJsonExpression[];
  indices: number[];
  ast: MathJsonExpression | null;
  visible: ReadonlyMap<string, BindingGroup>;
  declarations: ReadonlyMap<number, Declaration>;
  sourceTypes: ReadonlyMap<string, SourceType>;
};

/**
 * The type expected for `nodes[k]`, from its parent:
 * - the value of a `let` with a type: that type;
 * - an element of a list whose expected type is `list<T>`: `T`;
 * - the value of an assignment to a declared variable: its type;
 * - an argument of a call of a function of the source: the type of its
 *   parameter, when it has one;
 * - an argument of a call of a library function: the parameter type of its
 *   signature.
 */
function expectedTypeAt(context: Context, k: number): string | undefined {
  if (k < 1) return undefined;
  const { ce, nodes } = context;
  const parent = nodes[k - 1];
  const index = context.indices[k];
  const head = operator(parent);

  if (head === 'KeyValuePair') {
    const declare = nodes[k - 3];
    if (
      index !== 1 ||
      symbol(operand(parent, 1)) !== 'value' ||
      operator(nodes[k - 2]) !== 'Dictionary' ||
      operator(declare) !== 'Declare'
    )
      return undefined;
    return stringValue(operand(declare, 2)) ?? undefined;
  }

  if (head === 'List') {
    const listType = expectedTypeAt(context, k - 1);
    if (listType === undefined) return undefined;
    const type = parseTypeString(ce, listType);
    if (
      typeof type === 'object' &&
      type.kind === 'list' &&
      (type.dimensions === undefined || type.dimensions?.length === 1)
    )
      return typeToString(type.elements);
    return undefined;
  }

  if (head === 'Assign') {
    const name = symbol(operand(parent, 1));
    if (index !== 1 || name === null) return undefined;
    const group = context.visible.get(name);
    const declaration =
      group === undefined
        ? undefined
        : declarationOf(group, context.declarations);
    return declaration?.kind === 'value' ? declaration.type : undefined;
  }

  // A named argument of a call of a function of the source (`f(n: ▮)`): the
  // type of the parameter of that name.
  if (head === 'NamedArgument') {
    const label = stringValue(operand(parent, 1));
    const group = context.visible.get(operator(nodes[k - 2]));
    const declaration =
      group === undefined
        ? undefined
        : declarationOf(group, context.declarations);
    if (index !== 1 || label === null || declaration?.kind !== 'function')
      return undefined;
    const i = declaration.names.indexOf(label);
    return i < 0 ? undefined : declaration.params[i];
  }

  if (head === '' || GRAMMAR_CONSTRUCTS.has(head) || head === 'Program')
    return undefined;

  // A function of the source: the type of its parameter.
  const group = context.visible.get(head);
  if (group !== undefined) {
    const declaration = declarationOf(group, context.declarations);
    return declaration?.kind === 'function'
      ? declaration.params[index]
      : undefined;
  }

  // A library function: the parameter type of its signature.
  const name =
    ce.operatorInfo(head) !== undefined ? head : canonicalLibraryName(head);
  const signature =
    name === undefined ? undefined : ce.operatorInfo(name)?.signature?.type;
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return undefined;
  const args = signature.args ?? [];
  const optArgs = signature.optArgs ?? [];
  const parameter =
    args[index] ??
    optArgs[index - args.length] ??
    (index >= args.length + optArgs.length ? signature.variadicArg : undefined);
  return parameter === undefined ? undefined : typeToString(parameter.type);
}

/** The likely values of a type, as source text. */
function likelyValues(
  context: Context,
  typeString: string,
  depth: number
): string[] {
  if (depth > 3) return [];
  const declared = context.sourceTypes.get(typeString);
  if (declared !== undefined) {
    if (declared.kind === 'sum') {
      const values: string[] = [];
      for (const variant of declared.variants) {
        // A variant is a call, also when it has no payload: `green()`.
        // A variant with an unknown payload has no likely value.
        if (variant.payload === undefined) continue;
        // A payload of several fields is one tuple type string, and the
        // constructor takes one argument per field: `pair(0, "")`.
        const payload = variant.payload.flatMap((p) => {
          const t = parseTypeString(context.ce, p);
          return typeof t === 'object' && t.kind === 'tuple'
            ? t.elements.map((e) => typeToString(e.type))
            : [p];
        });
        const args = payload.map((p) => likelyValues(context, p, depth + 1)[0]);
        if (args.every((a) => a !== undefined))
          values.push(`${variant.name}(${args.join(', ')})`);
      }
      return values;
    }
    if (declared.kind === 'alias')
      return likelyValues(context, declared.body, depth + 1);
    // A nominal tuple type is built by its constructor; a nominal record
    // type has none until the source writes one.
    const body = parseTypeString(context.ce, declared.body);
    if (typeof body !== 'object' || body.kind !== 'tuple') return [];
    const args = body.elements.map(
      (e) => likelyValues(context, typeToString(e.type), depth + 1)[0]
    );
    return args.every((a) => a !== undefined)
      ? [`${typeString}(${args.join(', ')})`]
      : [];
  }
  const type = parseTypeString(context.ce, typeString);
  return type === undefined ? [] : valuesOfType(context, type, depth);
}

function valuesOfType(context: Context, type: Type, depth: number): string[] {
  const { ce } = context;
  if (type === 'boolean') return ['true', 'false'];
  if (type === 'string') return ['""'];
  // An empty list, unless the type fixes a size (`vector<integer^3>`).
  const emptyList = (t: Type) =>
    ce.type('list<never>').matches(ce.type(t)) ? ['[]'] : [];
  if (type === 'list') return emptyList(type);
  if (typeof type === 'string' || type.kind === 'numeric') {
    // A numeric type that holds 0: `integer`, `real`, `number`, and a range
    // such as `integer<-5..5>`.
    return ce.number(0).type.matches(ce.type(type)) ? ['0'] : [];
  }
  if (type.kind === 'reference')
    return likelyValues(context, type.name, depth + 1);
  if (type.kind === 'union') {
    const values = type.types.flatMap((t) => valuesOfType(context, t, depth));
    return [...new Set(values)];
  }
  if (type.kind === 'list') return emptyList(type);
  if (type.kind === 'tuple') {
    const args = type.elements.map(
      (e) => valuesOfType(context, e.type, depth + 1)[0]
    );
    // `(0)` is a scalar and `()` does not parse: these arities use the
    // function form, as the serializer writes them.
    if (!args.every((a) => a !== undefined)) return [];
    return args.length < 2
      ? [`Tuple(${args.join(', ')})`]
      : [`(${args.join(', ')})`];
  }
  if (type.kind === 'record') {
    // A key that needs backticks is written as a string, as the serializer
    // writes it (`{"while" -> 0}`). A key that is not a valid symbol name
    // has no spelling that gives a record: `` {`first-name` -> 0} `` does not
    // parse, and `{"first-name" -> 0}` is a `dictionary<integer>`.
    const fields = Object.entries(type.elements).map(([key, t]) => {
      const value = valuesOfType(context, t, depth + 1)[0];
      if (value === undefined) return undefined;
      if (escapeSymbol(key) === key) return `${key} -> ${value}`;
      if (!isValidSymbol(key)) return undefined;
      return `${serializeEpsil({ str: key })} -> ${value}`;
    });
    return fields.every((f) => f !== undefined)
      ? [`{${fields.join(', ')}}`]
      : [];
  }
  return [];
}

/** A type string parsed by the engine, or `undefined` when it does not
 * parse (a type of the source that the engine does not know). */
export function parseTypeString(
  ce: ComputeEngine,
  text: string
): Type | undefined {
  try {
    return ce.type(text).type;
  } catch {
    return undefined;
  }
}

/** A type of the source: parsed by the engine, or else with the names of
 * `typeNames` (the types the source declares and those of the `typeNames`
 * option, which the engine does not know) resolved to a reference by name,
 * as in the parser. A reference with type arguments (`Box<real>`) does not
 * parse: the reference does not record the type parameters. */
export function parseSourceType(
  ce: ComputeEngine,
  text: string,
  typeNames: ReadonlySet<string>
): Type | undefined {
  const type = parseTypeString(ce, text);
  if (type !== undefined || typeNames.size === 0) return type;
  try {
    return parseType(text, {
      get names(): string[] {
        return [...typeNames];
      },
      forward: () => undefined,
      resolve: (name) =>
        typeNames.has(name)
          ? { kind: 'reference', name, alias: false, def: undefined }
          : undefined,
    });
  } catch {
    return undefined;
  }
}

/** Whether a value of type `type` is a value of type `expected`. A type of
 * the source that the engine does not know matches by name only. */
function typeMatches(
  ce: ComputeEngine,
  type: string | Type,
  expected: string
): boolean {
  if (type === expected) return true;
  try {
    return ce.type(type).matches(ce.type(expected));
  } catch {
    return false;
  }
}

/** The ascription of a `function` definition when it is a full signature
 * (the definition declares effects or type parameters), not a return type:
 * a return type follows the `->` of the header in `text`. `null` for a full
 * signature that does not parse (a reference with type arguments to a type
 * of the source): it is not a return type either. */
function fullSignature(
  ce: ComputeEngine,
  declaration: Extract<Declaration, { kind: 'function' }>,
  text: string,
  typeNames: ReadonlySet<string>
): FunctionSignature | null | undefined {
  const { result, resultStart } = declaration;
  if (result === undefined || resultStart === undefined) return undefined;
  const before = tokenize(text).filter(
    (t) => t.type !== 'EOF' && t.end <= resultStart
  );
  const arrow = before[before.length - 1];
  if (arrow?.type === 'OPERATOR' && arrow.text === '->') return undefined;
  const type = parseSourceType(ce, result, typeNames);
  return typeof type === 'object' && type.kind === 'signature' ? type : null;
}

/** The parameter types of a `function` declaration, the text after its
 * parameter list (`-> real`, or the effects, the result and the `where`
 * clause of a full signature: ` pure -> real`) and its result type. A
 * parameter of a full signature typed `unknown` has no declared type; a rest
 * parameter, always last, has no slot in it (its tail is `any*`). A full
 * signature that does not parse gives the parameters of the header and no
 * tail or result. `typeNames` are the types of the source and of the
 * `typeNames` option (see `parseSourceType`). */
export function functionSignatureParts(
  ce: ComputeEngine,
  declaration: Extract<Declaration, { kind: 'function' }>,
  text: string,
  typeNames: ReadonlySet<string>
): { params: (string | undefined)[]; tail: string; result?: string } {
  const signature = fullSignature(ce, declaration, text, typeNames);
  if (signature === null) return { params: declaration.params, tail: '' };
  if (signature === undefined)
    return {
      params: declaration.params,
      tail: declaration.result === undefined ? '' : ` -> ${declaration.result}`,
      ...(declaration.result === undefined
        ? {}
        : { result: declaration.result }),
    };
  const elements = [...(signature.args ?? []), ...(signature.optArgs ?? [])];
  const params = declaration.params.map((type, i) => {
    const t = elements[i]?.type;
    return t === undefined || t === 'unknown' ? type : typeToString(t);
  });
  // The serialization of the signature with no parameters, after the `()`.
  const {
    args: _args,
    optArgs: _optArgs,
    variadicArg: _variadicArg,
    variadicMin: _variadicMin,
    ...rest
  } = signature;
  const result = typeToString(signature.result);
  return {
    params,
    tail: typeToString(rest).slice(2),
    ...(result === 'unknown' ? {} : { result }),
  };
}

/** The declaration of a binding: the one recorded at its first definition
 * occurrence. */
export function declarationOf(
  group: BindingGroup,
  declarations: ReadonlyMap<number, Declaration>
): Declaration | undefined {
  const definition = group.occurrences.find((o) => o.role === 'definition');
  return definition === undefined
    ? undefined
    : declarations.get(definition.start);
}

/** What the source declares about each name, keyed by the start offset of
 * the name in its declaration: the type of a `let` or of a parameter, the
 * parameter and result types of a `function`, the body of a `type`. */
export function collectDeclarations(
  ast: MathJsonExpression | null
): Map<number, Declaration> {
  const result = new Map<number, Declaration>();
  const record = (name: MathJsonExpression | null, d: Declaration) => {
    const span = symbol(name) === null ? undefined : spanOf(name);
    if (span !== undefined && !result.has(span[0])) result.set(span[0], d);
  };
  // A parameter with a default is `Optional(param, default)`, a rest
  // parameter is `Spread(param)`.
  const unwrap = (node: MathJsonExpression | null) =>
    operator(node) === 'Optional' || operator(node) === 'Spread'
      ? operand(node, 1)
      : node;
  const typeOf = (node: MathJsonExpression | null): string | undefined =>
    operator(unwrap(node)) === 'Typed'
      ? (stringValue(operand(unwrap(node), 2)) ?? undefined)
      : undefined;
  const nameOf = (node: MathJsonExpression | null): string | undefined => {
    const param = unwrap(node);
    return (
      symbol(operator(param) === 'Typed' ? operand(param, 1) : param) ??
      undefined
    );
  };
  const visit = (node: MathJsonExpression) => {
    const head = operator(node);
    if (head === 'Declare' || head === 'Typed') {
      const type = stringValue(operand(node, 2));
      if (type !== null) record(operand(node, 1), { kind: 'value', type });
    } else if (head === 'DefineFunction') {
      const fn = operand(node, 2);
      if (operator(fn) === 'Function') {
        const [body, ...params] = operands(fn);
        record(operand(node, 1), {
          kind: 'function',
          params: params.map(typeOf),
          names: params.map(nameOf),
          optional: params.map((p) => operator(p) === 'Optional'),
          rest: operator(params[params.length - 1]) === 'Spread',
          result: typeOf(body),
          resultStart:
            operator(body) === 'Typed'
              ? spanOf(operand(body, 2))?.[0]
              : undefined,
        });
      }
    } else if (head === 'DeclareType') {
      const body = stringValue(operand(node, 2));
      if (body !== null)
        record(operand(node, 1), { kind: 'type', detail: body });
    } else if (head === 'DeclareSumType') {
      const variants = operands(node)
        .slice(1)
        .map((v) => stringValue(operand(v, 1)))
        .filter((v) => v !== null);
      record(operand(node, 1), { kind: 'type', detail: variants.join(' | ') });
    } else if (head === 'DeclareProtocol') {
      record(operand(node, 1), { kind: 'protocol' });
    }
    for (const op of operands(node)) visit(op);
  };
  if (ast !== null) visit(ast);
  return result;
}

/** The types the source declares, and the sum types of the variants the
 * options name, keyed by type name. */
export function collectSourceTypes(
  ast: MathJsonExpression | null,
  sumVariants: Readonly<Record<string, string>> | undefined
): Map<string, SourceType> {
  const result = new Map<string, SourceType>();
  for (const [variant, sum] of Object.entries(sumVariants ?? {})) {
    const known = result.get(sum);
    if (known === undefined)
      result.set(sum, {
        kind: 'sum',
        variants: [{ name: variant, payload: undefined }],
      });
    else if (known.kind === 'sum')
      known.variants.push({ name: variant, payload: undefined });
  }
  for (const statement of operands(ast)) {
    const head = operator(statement);
    const name = symbol(operand(statement, 1));
    if (name === null) continue;
    if (head === 'DeclareSumType') {
      const variants: { name: string; payload: string[] | undefined }[] = [];
      for (const v of operands(statement).slice(1)) {
        const [variant, ...payload] = operands(v).map(stringValue);
        if (variant === null || variant === undefined) continue;
        variants.push({
          name: variant,
          payload: payload.filter(
            (p): p is string => p !== null && p !== 'nothing'
          ),
        });
      }
      result.set(name, { kind: 'sum', variants });
    } else if (head === 'DeclareType') {
      const body = stringValue(operand(statement, 2));
      if (body === null) continue;
      const attributes = operand(statement, 3);
      const alias = operands(attributes).some(
        (kv) =>
          symbol(operand(kv, 1)) === 'alias' &&
          symbol(operand(kv, 2)) === 'True'
      );
      result.set(name, { kind: alias ? 'alias' : 'nominal', body });
    }
  }
  return result;
}

/** The standard-library names of the engine, by their Epsil spelling. */
function libraryEntries(ce: ComputeEngine): LibraryEntry[] {
  const cached = LIBRARY_ENTRIES.get(ce);
  if (cached !== undefined) return cached;
  const entries: LibraryEntry[] = [];
  for (const [spelling, name] of epsilLibraryNames()) {
    const entry = describeName(ce, name);
    if (entry === undefined) continue;
    const isFunction = entry.kind === 'function' || entry.kind === 'opaque';
    let type: Type | undefined;
    if (isFunction) {
      const signature = ce.operatorInfo(name)?.signature?.type;
      if (typeof signature === 'object' && signature.kind === 'signature')
        type = signature.result;
    } else type = ce.symbolInfo(name)?.type.type;
    const documentation = entry.description?.[0]?.split('\n')[0]?.trim();
    entries.push({
      label: spelling,
      kind: isFunction ? 'library-function' : 'library-constant',
      ...(entry.signature !== undefined || entry.type !== undefined
        ? { detail: entry.signature ?? entry.type }
        : {}),
      ...(documentation ? { documentation } : {}),
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
      ...(type === undefined ? {} : { type }),
    });
  }
  LIBRARY_ENTRIES.set(ce, entries);
  return entries;
}
