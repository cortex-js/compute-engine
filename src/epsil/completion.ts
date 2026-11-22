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
import type {
  EffectSet,
  FunctionSignature,
  Type,
} from '../common/type/types.js';
import { isEffectSubset } from '../common/type/effects.js';
import { substituteTypeVariables } from '../common/type/instantiate.js';
import { conditionalTargetInstance } from '../common/type/conditional-conformance.js';
import { parseType, type ParseTypeOptions } from '../common/type/parse.js';
import { PRIMITIVE_TYPES } from '../common/type/primitive.js';
import { typesOverlap } from '../common/type/reduce.js';
import { typeToString } from '../common/type/serialize.js';
import { resolveTypeReference } from '../common/type/subtype.js';
import {
  collectionElementType,
  resolveTypeAlias,
  signatureArms,
} from '../common/type/utils.js';
import { widenValueTypes } from '../common/type/widen-value.js';
import { widenLocalType } from '../compute-engine/boxed-expression/boxed-value-definition.js';
import { isOperatorDef } from '../compute-engine/boxed-expression/definition-guards.js';
import {
  protocolFunctionMemberOwners,
  protocolPropertyTypeOfReceiver,
} from '../compute-engine/engine-protocols.js';
import type { ProtocolMember } from '../compute-engine/types-engine.js';

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
import { SPECIFIER_WORDS } from './parser.js';
import {
  escapeProtocolName,
  escapeSymbol,
  serializeEpsil,
} from './serialize-epsil.js';
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
// offset. The tokens also tell the positions that take a new name, one
// keyword or no word at all (`slotAt`), where the parse does not: every item
// offered is valid where it is offered. Any other dropped position gets the
// names and the keywords.
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
  /** The call that a function item inserts, as a snippet in the syntax of
   * LSP and of CodeMirror's `snippet()`: one numbered field per required
   * parameter, whose default text is the name of the parameter (its type
   * when it has none), then the final caret (`take(${1:xs}, ${2:count})${0}`).
   * Only for a function with a required parameter, and not before a `(`;
   * after `|>` the first argument is left out. One line, with no `{`, `}`,
   * `$`, `#` or `\` outside the fields. An editor that does not take snippets
   * inserts `insertText` (or `label`). */
  snippet?: string;
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
   * type matches the expected type (`fit` is `'match'`), 3 library names
   * whose type matches, 4 other names of the source, 5 other library names,
   * 6 keywords. In rank 4 and 5, the names that may fit come before those
   * that cannot (`fit`). */
  rank: number;
  /** How the name fits the expected type, for a name item when
   * `expectedType` is set: `'match'` when its value is always of the type
   * that the position admits, `'never'` when it can never be, `'maybe'`
   * otherwise (a broader type such as `value`, a union with an arm that
   * fits, a generic result, a name whose type is not known). A function
   * name is judged by the result of a call, or, where the position expects
   * a function (`filter(xs, ▮`, `x |> ▮`), by its signature. A position
   * that maps a function over a list (a broadcastable operator, a function
   * of the source) admits a list of the expected type too. A host may hide
   * the names that are `'never'`. */
  fit?: 'match' | 'maybe' | 'never';
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
   * sorted by `rank`, then the names that may fit before those that cannot
   * (`fit`), then locals before globals, then label. */
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
  | { kind: 'protocol' }
  /** A `let` or a `const` with no type and a literal value (`let a = 5`):
   * its type is the type of the value, widened as the engine widens it
   * (`declarationDetail`). */
  | { kind: 'literal'; value: MathJsonExpression; constant: boolean };

/** How a candidate name fits the expected type (`EpsilCompletionItem.fit`). */
type Fit = 'match' | 'maybe' | 'never';

/** A function as a candidate where a function is expected: its positional
 * parameters (the required ones first; the last one is the element of the
 * rest parameter when `rest` is set), the number of required parameters,
 * its result and the effects of a call (`[]` when pure, `null` when not
 * known). `undefined` is a type that is not known. */
type Callable = {
  params: (Type | undefined)[];
  required: number;
  rest: boolean;
  result: Type | undefined;
  effects: EffectSet | null;
};

/** A library name as an item, computed once per engine. */
type LibraryEntry = {
  label: string;
  kind: 'library-function' | 'library-constant';
  detail?: string;
  documentation?: string;
  description?: string[];
  /** The type of a constant. */
  type?: Type;
  /** The signatures of a function: one, or the arms of an overload set. */
  arms?: readonly FunctionSignature[];
  /** Whether `arms` are the arms of a union: the function is one of them. */
  union?: boolean;
  /** Whether the function maps over a list argument. */
  broadcastable?: boolean;
};

const LIBRARY_ENTRIES = new WeakMap<ComputeEngine, LibraryEntry[]>();

/**
 * The completion items at `offset` of `source`.
 *
 * The items are the likely values of the type expected at the offset (`0`
 * for `let a: integer = ▮`), the names of the source that are visible at
 * the offset, the standard-library names (by their Epsil spelling, with
 * their signature) and the keywords valid at the position. After `:` in a
 * declaration or a parameter, after `->` of a function header, after
 * `type name =` and after `is` of a type test, the items are the type names
 * instead. Where the grammar takes a new name or no word, there are no items;
 * where it takes one keyword (`for i ▮`), that keyword.
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

  if (isTypePosition(source, before, start)) {
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
    // A protocol is not a type (`protocol-in-type-position`, ruling P8),
    // but a type test takes one (`x is Comparable`).
    const lastToken = before[before.length - 1];
    const typeTest = lastToken?.type === 'SYMBOL' && lastToken.text === 'is';
    for (const group of groups) {
      if (group.kind !== 'type') continue;
      const declaration = declarationOf(group, declarations);
      if (declaration?.kind === 'protocol' && !typeTest) continue;
      add(
        group.name,
        2,
        declaration?.kind === 'type' ? declaration.detail : undefined
      );
    }
    for (const name of options?.typeNames ?? []) add(name, 2);
    if (typeTest) for (const name of options?.protocolNames ?? []) add(name, 2);
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

  const slot = slotAt(source, before, start);
  if (slot.kind === 'words') {
    for (const keyword of slot.keywords)
      items.push({ label: keyword, kind: 'keyword', rank: 6, tier: 0 });
    return { range, replaceEnd, items: finish(items, prefix) };
  }

  if (slot.kind === 'protocol') {
    const seen = new Set<string>();
    const add = (label: string) => {
      if (seen.has(label)) return;
      seen.add(label);
      const spelling = escapeProtocolName(label);
      items.push({
        label,
        kind: 'type',
        rank: 2,
        tier: 0,
        ...(spelling === label ? {} : { insertText: spelling }),
      });
    };
    for (const group of groups)
      if (
        group.kind === 'type' &&
        declarationOf(group, declarations)?.kind === 'protocol'
      )
        add(group.name);
    for (const name of options?.protocolNames ?? []) add(name);
    return { range, replaceEnd, items: finish(items, prefix) };
  }

  // After `.`, the hole is the name of a `Field` or of a `MemberCall`: the
  // path ends at that node, whose value is the member.
  const path =
    slot.kind === 'member'
      ? findMemberHole(ast, placeholder)
      : findHole(ast, placeholder, start);
  const statementStart =
    path === undefined
      ? isStatementStart(source, before, start)
      : ['Program', 'Block'].includes(
          operator(path.nodes[path.nodes.length - 2])
        );

  const visible = visibleBindings(groups, placeholder, start);
  // A variant of a sum type of the source is a type too (`const q: square`).
  const typeNames = new Set([
    ...(options?.typeNames ?? []),
    ...sourceTypes.keys(),
    ...[...sourceTypes.values()].flatMap((declared) =>
      declared.kind === 'sum'
        ? declared.variants
            .filter((v) => v.payload !== undefined)
            .map((v) => v.name)
        : []
    ),
  ]);

  const context: Context = {
    ce,
    nodes: path?.nodes ?? [],
    indices: path?.indices ?? [],
    ast,
    visible,
    declarations,
    sourceTypes,
    text,
    typeNames,
  };
  let expectedType =
    path === undefined
      ? undefined
      : expectedTypeAt(context, path.nodes.length - 1);
  if (expectedType !== undefined && UNINFORMATIVE_TYPES.has(expectedType))
    expectedType = undefined;
  // The type that the position admits, for the fit of each name: `undefined`
  // when the expected type is a type of the source that the engine does not
  // know.
  const admitted =
    path === undefined || expectedType === undefined
      ? undefined
      : admittedTypeAt(context, path.nodes.length - 1, expectedType);
  // A call inserts a snippet, except before `(` (`take▮(xs)`, `take▮ (xs)`),
  // and where a function value is expected (`filter(xs, isPr▮)`): the name is
  // passed there, not called. After `|>` (`xs |> take`), the left side fills
  // the slot that the `Pipe` handler gives it (`pipedTopicField`), and the
  // snippet has no field for it; no snippet when that slot is not known.
  const called = /^[ \t]*\(/.test(source.slice(end));
  const piped =
    path !== undefined &&
    path.nodes.length >= 2 &&
    operator(path.nodes[path.nodes.length - 2]) === 'Pipe' &&
    path.indices[path.indices.length - 1] === 1;
  const expected =
    admitted ??
    (expectedType === undefined
      ? undefined
      : parseSourceType(ce, expectedType, typeNames));
  const passed =
    !piped && expected !== undefined && expectsFunction(context, expected);
  const left =
    piped && path !== undefined
      ? operand(path.nodes[path.nodes.length - 2], 1)
      : null;
  // `callables` are the signatures of the function, for the slot of the
  // piped value: without them, no snippet after `|>`.
  const snippetOf = (
    spelling: string,
    required: readonly Parameter[] | undefined,
    callables?: readonly Callable[]
  ): { snippet?: string } => {
    if (called || passed || required === undefined) return {};
    let fields: readonly Parameter[] | undefined = required;
    if (piped) {
      const topic =
        callables === undefined
          ? undefined
          : pipedTopicField(context, left, callables, required.length);
      fields =
        topic === undefined
          ? undefined
          : required.filter((_, i) => i !== topic);
    }
    const snippet =
      fields === undefined ? undefined : callSnippet(spelling, fields);
    return snippet === undefined ? {} : { snippet };
  };
  // Whether the position is the right side of `|>`, where a function may be
  // called with more arguments than the left side (`fitOfCallable`).
  const pipe =
    expectedType !== undefined &&
    path !== undefined &&
    path.nodes.length >= 2 &&
    operator(path.nodes[path.nodes.length - 2]) === 'Pipe';
  // Whether the position is a callback of a library function that takes a
  // variadic list of sources (`map(f, xs, ys)` calls `f` with one argument
  // per source), where the callback may take more arguments than its
  // declared signature (`fitOfFunction`).
  const library =
    expectedType === undefined ||
    path === undefined ||
    path.nodes.length < 2 ||
    context.visible.has(operator(path.nodes[path.nodes.length - 2]))
      ? undefined
      : libraryParameterAt(context, path.nodes.length - 1);
  const variadic = library?.signature.variadicArg?.type;
  const openArity =
    library !== undefined &&
    variadic !== undefined &&
    !isFunctionType(variadic) &&
    isFunctionType(library.parameter);
  // The fit of a name whose type is the type string `type` of the source. A
  // name of a function type where a value is expected may be called
  // (`determinant(f(A))`): it fits by the result of a call too.
  const fitOfText = (type: string | undefined): Fit => {
    if (type === undefined) return 'maybe';
    if (type === expectedType) return 'match';
    const t = parseTypeString(ce, type);
    if (t === undefined || admitted === undefined) return 'maybe';
    const fit = fitValue(ce, t, admitted, { pipe, openArity });
    if (isFunctionType(admitted) || !isFunctionType(t)) return fit;
    const arms = signatureArms(t);
    if (arms === undefined) return bestFit(fit, 'maybe');
    return bestFit(
      fit,
      fitOfFunction(ce, arms.map(callableOf), false, admitted, {
        union: typeof t === 'object' && t.kind === 'union',
      })
    );
  };

  // After `.`, the members of the value before the dot, and no other name:
  // none when its type is not known.
  if (slot.kind === 'member') {
    const node = path?.nodes[path.nodes.length - 1] ?? null;
    const receiver =
      path === undefined
        ? undefined
        : receiverTypeOf(context, operand(node, 1));
    // Before `(` (`c.ar▮()`), a function member is inserted as its name.
    const memberCall = operator(node) === 'MemberCall';
    // A member of a type of the source that the engine does not know cannot
    // fit when the body of that type cannot.
    const fitOfMember = (type: Type | undefined): Fit => {
      if (type === undefined) return 'maybe';
      const fit = fitOfText(typeToString(type));
      if (fit !== 'maybe' || admitted === undefined) return fit;
      const body = sourceTypeBody(context, type);
      return body !== undefined &&
        fitValue(ce, body, admitted, { pipe, openArity }) === 'never'
        ? 'never'
        : fit;
    };
    for (const member of receiver === undefined
      ? []
      : membersOf(context, receiver)) {
      // A function member is judged by the result of a call.
      const fit =
        expectedType === undefined
          ? undefined
          : fitOfMember(
              member.kind === 'function' ? member.result : member.type
            );
      const spelling = escapeSymbol(member.name);
      const snippet =
        member.kind === 'function' && !memberCall
          ? snippetOf(spelling, member.required).snippet
          : undefined;
      items.push({
        label: member.name,
        kind: member.kind === 'function' ? 'function' : 'variable',
        rank: fit === 'match' ? 2 : 4,
        tier: 0,
        ...(member.kind === 'function' && member.arity === 0 && !memberCall
          ? { insertText: `${spelling}()` }
          : spelling === member.name
            ? {}
            : { insertText: spelling }),
        ...(snippet === undefined ? {} : { snippet }),
        detail: member.detail,
        ...(fit === undefined ? {} : { fit }),
      });
    }
    return {
      range,
      replaceEnd,
      ...(expectedType === undefined ? {} : { expectedType }),
      items: finish(items, prefix),
    };
  }

  // 1. Likely values of the expected type.
  if (expectedType !== undefined)
    for (const value of likelyValues(context, expectedType, 0))
      items.push({ label: value, kind: 'value', rank: 1, tier: 0 });

  // 2. Names of the source visible at the offset.
  const textLength = text.length;
  for (const group of visible.values()) {
    const declaration = declarationOf(group, declarations);
    const kind: EpsilCompletionItem['kind'] =
      group.kind === 'function'
        ? 'function'
        : group.kind === 'type'
          ? 'type'
          : 'variable';
    const { detail, type } = declarationDetail(
      ce,
      declaration,
      text,
      typeNames
    );
    // A function of the source maps over a list argument whose elements
    // are of a parameter type: it is a broadcast candidate.
    const fit: Fit | undefined =
      expectedType === undefined
        ? undefined
        : kind === 'type'
          ? 'maybe'
          : declaration?.kind === 'function' && admitted !== undefined
            ? fitOfFunction(
                ce,
                [sourceCallable(ce, declaration, text, typeNames)],
                true,
                admitted,
                { pipe, openArity }
              )
            : fitOfText(type);
    const local = group.scope[0] !== 0 || group.scope[1] !== textLength;
    // A name that needs backticks (`` `while` ``) is inserted with them.
    const spelling = escapeSymbol(group.name);
    items.push({
      label: group.name,
      kind,
      rank: fit === 'match' ? 2 : 4,
      tier: local ? 0 : 1,
      ...(spelling === group.name ? {} : { insertText: spelling }),
      ...(declaration?.kind === 'function'
        ? snippetOf(
            spelling,
            sourceParameters(ce, group, declarations, text, typeNames),
            [sourceCallable(ce, declaration, text, typeNames)]
          )
        : {}),
      ...(detail === undefined ? {} : { detail }),
      ...(fit === undefined ? {} : { fit }),
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
      const fit = expectedType === undefined ? undefined : fitOfText(sum);
      items.push({
        label: variant.name,
        kind: 'function',
        rank: fit === 'match' ? 2 : 4,
        ...(fit === undefined ? {} : { fit }),
        tier: 1,
        ...(payload?.length === 0
          ? { insertText: `${spelling}()` }
          : spelling === variant.name
            ? {}
            : { insertText: spelling }),
        ...snippetOf(spelling, payloadParameters(context, payload)),
        detail:
          payload === undefined ? sum : `(${payload.join(', ')}) -> ${sum}`,
      });
    }
  }

  // 3. Library names, unless a name of the source shadows them.
  for (const entry of libraryEntries(ce)) {
    if (visible.has(entry.label)) continue;
    const fit: Fit | undefined =
      expectedType === undefined
        ? undefined
        : admitted === undefined
          ? 'maybe'
          : entry.arms !== undefined
            ? fitOfFunction(
                ce,
                entry.arms.map(callableOf),
                entry.broadcastable === true,
                admitted,
                { union: entry.union === true, pipe, openArity }
              )
            : entry.type !== undefined
              ? fitValue(ce, entry.type, admitted, { pipe, openArity })
              : 'maybe';
    items.push({
      label: entry.label,
      kind: entry.kind,
      rank: fit === 'match' ? 3 : 5,
      ...(fit === undefined ? {} : { fit }),
      tier: 0,
      ...snippetOf(
        entry.label,
        libraryParameters(entry),
        entry.arms?.map(callableOf)
      ),
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
  // A case pattern admits the literal keywords only; after the block of an
  // `if`, `else` continues the statement.
  const keywords: Iterable<string> =
    slot.kind === 'pattern'
      ? ['false', 'true']
      : statementStart || slot.kind === 'statement-or-else'
        ? new Set([
            ...STATEMENT_KEYWORDS,
            ...EXPRESSION_KEYWORDS,
            ...(slot.kind === 'statement-or-else' ? ['else'] : []),
          ])
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
        Number(a.fit === 'never') - Number(b.fit === 'never') ||
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
function isTypePosition(
  source: string,
  before: readonly Token[],
  start: number
): boolean {
  // Inside an annotation: scan back over the tokens of a type, then check
  // that they follow an annotation start and alternate operand, operator.
  const last = before[before.length - 1];
  if (
    (last?.type === 'OPERATOR' && (last.text === '<' || last.text === '|')) ||
    last?.type === 'COMMA'
  ) {
    const isOperand = (t: Token) =>
      (t.type === 'SYMBOL' && t.text !== 'is') || t.type === 'NUMBER';
    const isOperator = (t: Token) =>
      t.type === 'COMMA' ||
      (t.type === 'OPERATOR' &&
        ['<', '>', '>>', '|', '^', '..'].includes(t.text));
    let i = before.length - 1;
    while (i >= 0 && (isOperand(before[i]) || isOperator(before[i]))) i -= 1;
    if (i < 0 || !isAnnotationStart(before.slice(0, i + 1), source))
      return false;
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
  // A type test ends at the end of its line (`x is` and a new statement).
  if (
    last?.type === 'SYMBOL' &&
    last.text === 'is' &&
    /[\n\r]/.test(source.slice(last.end, start))
  )
    return false;
  return isAnnotationStart(before, source);
}

/** Whether the tokens end at the start of an annotation (see
 * `isTypePosition`). The `is` of a type test follows its operand on the same
 * line of `source`: an `is` at the start of a line is a name. */
function isAnnotationStart(before: readonly Token[], source: string): boolean {
  const last = before[before.length - 1];
  const word = (i: number): string | undefined =>
    before[i]?.type === 'SYMBOL' ? before[i].text : undefined;
  const n = before.length;
  // The type test `x is T`; after `type T is` come protocols.
  if (last?.type === 'SYMBOL' && last.text === 'is')
    return (
      endsOperand(before, n - 2) &&
      word(n - 3) !== 'type' &&
      // `let is`: `is` is the declared name.
      !['let', 'const', 'function', 'for'].includes(word(n - 2) ?? '') &&
      !/[\n\r]/.test(source.slice(before[n - 2].end, last.start))
    );
  if (last?.type !== 'OPERATOR') return false;
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

/**
 * What the grammar admits at a word position, as the tokens before it tell.
 * The parse with a hole does not settle it there: the parser drops the
 * statement, or recovers with the hole as a statement of its own.
 *
 * - `words`: only these keywords, possibly none: a name being declared
 *   (`let ▮`, `function f(▮`), the place after a declared name or a type
 *   (`let a ▮`, `let a: integer ▮`), after a block (`while x { } ▮`), or
 *   after a complete expression on its line (`f(1) ▮`, where `in`, `is` and
 *   a postfix `if` are valid);
 * - `protocol`: a protocol name (`type T is ▮`, `protocol P extends ▮`);
 * - `pattern`: a case pattern of a `match`;
 * - `member`: a member name after `.`;
 * - `statement-or-else`: a statement start that may also continue an `if`;
 * - `default`: the hole decides.
 */
type Slot =
  | { kind: 'words'; keywords: string[] }
  | { kind: 'protocol' }
  | { kind: 'pattern' }
  | { kind: 'member' }
  | { kind: 'statement-or-else' }
  | { kind: 'default' };

/** Words that cannot end an expression: the keywords the grammar consumes,
 * and the contextual heads when they head a statement (checked apart). */
const NON_OPERAND_WORDS: ReadonlySet<string> = new Set([
  'break',
  'const',
  'continue',
  'do',
  'else',
  'for',
  'function',
  'if',
  'in',
  'is',
  'match',
  'protocol',
  'while',
]);

function slotAt(source: string, before: readonly Token[], start: number): Slot {
  const n = before.length;
  if (n === 0) return { kind: 'default' };
  const last = before[n - 1];
  const none: Slot = { kind: 'words', keywords: [] };
  const word = (i: number): string | undefined =>
    before[i]?.type === 'SYMBOL' ? before[i].text : undefined;
  const isName = (i: number): boolean =>
    (before[i]?.type === 'SYMBOL' && !NON_OPERAND_WORDS.has(before[i].text)) ||
    before[i]?.type === 'VERBATIM_SYMBOL';
  // An unclosed verbatim name ends with the linebreak that ends it.
  const newlineAfter = (i: number, end: number) =>
    /[\n\r\u2028\u2029]/.test(
      source.slice(Math.max(before[i].start, before[i].end - 1), end)
    );
  const sameLine = !newlineAfter(n - 1, start);
  // Whether the token `i` heads a statement: `let` and `type` are also
  // ordinary names.
  const isHead = (i: number) =>
    isStatementStart(source, before.slice(0, i), before[i].start);
  const continuesLine = (t: Token) =>
    t.type === 'OPERATOR' ||
    t.type === 'COMMA' ||
    t.type === 'OPEN_PAREN' ||
    t.type === 'OPEN_BRACKET' ||
    t.type === 'OPEN_BRACE';

  // The block of a `match`, when the innermost unclosed bracket is one.
  const open = innermostOpen(before, n - 1);
  if (open >= 0 && before[open].type === 'OPEN_BRACE') {
    const head = headOfBlock(source, before, open);
    if (head === 'match') {
      // The start of the current case: after the `{`, a `;`, or a linebreak
      // at the depth of the block.
      // Past the pattern: after its `=>`, or in its guard (`n if n > 0`).
      let arrow = false;
      let guard = false;
      let depth = 0;
      for (let i = n - 1; i > open; i -= 1) {
        const t = before[i];
        if (/^CLOSE_/.test(t.type)) depth += 1;
        else if (/^OPEN_/.test(t.type)) depth -= 1;
        if (depth !== 0) continue;
        if (t.type === 'SEMICOLON') break;
        if (t.type === 'OPERATOR' && t.text === '=>') arrow = true;
        if (t.type === 'SYMBOL' && t.text === 'if') guard = true;
        if (newlineAfter(i - 1, t.start) && !continuesLine(before[i - 1]))
          break;
      }
      const caseStart =
        last === before[open] ||
        last.type === 'SEMICOLON' ||
        (!sameLine && !continuesLine(last));
      if (caseStart) return { kind: 'pattern' };
      if (!arrow && endsOperand(before, n - 1) && sameLine)
        return {
          kind: 'words',
          // In the guard, the `if` of the case is not a postfix `if`.
          keywords: guard ? ['if', 'in', 'is'] : ['if'],
        };
    }
    if (head === 'protocol') {
      // A member of a protocol: a function or a property requirement.
      if (last === before[open] || last.type === 'SEMICOLON' || !sameLine)
        return {
          kind: 'words',
          keywords: ['function', 'readonly', 'readwrite'],
        };
    }
  }

  // A list of protocols, after `type T is` or `protocol P extends`: a name
  // after the keyword or after `,` and `&`, and none after a name (`,`, `&`
  // or `{` follows).
  {
    const separator = (k: number) =>
      before[k].type === 'COMMA' ||
      (before[k].type === 'OPERATOR' && before[k].text === '&');
    let i = n - 1;
    while (i >= 0 && ((isName(i) && word(i) !== 'extends') || separator(i)))
      i -= 1;
    const inList =
      (word(i) === 'extends' && isName(i - 1) && word(i - 2) === 'protocol') ||
      (word(i) === 'is' &&
        isName(i - 1) &&
        word(i - 2) === 'type' &&
        isHead(i - 2));
    if (inList && sameLine)
      return i === n - 1 || separator(n - 1) ? { kind: 'protocol' } : none;
  }

  if (last.type === 'OPERATOR' && last.text === '.') return { kind: 'member' };

  if (last.type === 'SYMBOL') {
    switch (last.text) {
      case 'function':
      case 'const':
      case 'protocol':
      case 'for':
      case 'do':
        return none;
      case 'break':
      case 'continue':
        if (sameLine) return none;
        break;
      case 'else':
        // After a block, `if` or `{` follows; the `else` of a postfix
        // conditional (`a if c else ▮`) takes an expression.
        if (
          before[n - 2]?.type === 'CLOSE_BRACE' &&
          !isCollectionBrace(before, matchingOpen(before, n - 2)) &&
          ['if', 'else'].includes(
            headOfBlock(source, before, matchingOpen(before, n - 2)) ?? ''
          )
        )
          return { kind: 'words', keywords: ['if'] };
        break;
      case 'let':
        if (isHead(n - 1)) return none;
        break;
      case 'type':
        if (isHead(n - 1)) return { kind: 'words', keywords: ['alias'] };
        break;
      case 'parallel':
        if (isHead(n - 1)) return { kind: 'words', keywords: ['for'] };
        break;
      case 'alias':
        if (word(n - 2) === 'type' && isHead(n - 2)) return none;
        break;
      case 'readonly':
      case 'readwrite':
        if (open >= 0 && headOfBlock(source, before, open) === 'protocol')
          return none;
        break;
    }
  }

  // After the name of a declaration, on its line. `is` is a contextual word
  // and can be the name (`let is`).
  if (sameLine && (isName(n - 1) || word(n - 1) === 'is')) {
    const head = word(n - 2);
    if ((head === 'let' && isHead(n - 2)) || head === 'const') return none;
    if (head === 'function') return none;
    if (head === 'for') return { kind: 'words', keywords: ['in'] };
    if (head === 'protocol') return { kind: 'words', keywords: ['extends'] };
    if (head === 'type' && isHead(n - 2))
      return { kind: 'words', keywords: ['is'] };
    if (head === 'alias' && word(n - 3) === 'type') return none;
    // The name of a property requirement: `:` follows.
    if (
      (head === 'readonly' || head === 'readwrite') &&
      open >= 0 &&
      headOfBlock(source, before, open) === 'protocol'
    )
      return none;
  }

  // A parenthesized list of names: the parameters of a function header, the
  // names of a destructuring `let` or `for`. A parameter of a multi-clause
  // function can also be a literal (`function g(true) { 1 }`).
  const paren = openingParen(before, n - 1);
  if (
    paren >= 0 &&
    (isFunctionHeader(before, paren) ||
      ['let', 'const', 'for'].includes(word(paren - 1) ?? '')) &&
    (last.type === 'OPEN_PAREN' || last.type === 'COMMA' || isName(n - 1))
  )
    // A literal parameter makes the signature overloaded, which admits no
    // default value: after `x: integer = 1,` no literal is offered.
    return isFunctionHeader(before, paren) &&
      !isName(n - 1) &&
      !before
        .slice(paren + 1)
        .some((t) => t.type === 'OPERATOR' && t.text === '=')
      ? { kind: 'words', keywords: ['false', 'true'] }
      : none;

  // After the parameters of a function header, and after each word of its
  // specifier (`function roll(n) random -> integer`), a specifier word.
  {
    let i = n - 1;
    while (
      i >= 0 &&
      before[i].type === 'SYMBOL' &&
      SPECIFIER_WORDS.has(before[i].text)
    )
      i -= 1;
    if (sameLine && before[i]?.type === 'CLOSE_PAREN') {
      const p = matchingOpen(before, i);
      if (p >= 0 && isFunctionHeader(before, p))
        return { kind: 'words', keywords: [...SPECIFIER_WORDS].sort() };
    }
  }

  if (sameLine && last.type === 'CLOSE_PAREN') {
    const p = matchingOpen(before, n - 1);
    if (word(p - 1) === 'for') return { kind: 'words', keywords: ['in'] };
    if (word(p - 1) === 'let' || word(p - 1) === 'const') return none;
  }

  // After a type annotation: `=`, `{` or an operator of types follows.
  if (
    sameLine &&
    (endsOperand(before, n - 1) || last.text === '>' || last.text === '>>') &&
    inAnnotation(source, before)
  )
    return none;

  // A `{` after an operator, a comma or an opening bracket opens a set or a
  // dictionary, which ends an operand (`let s = {1} ▮`).
  let collection = false;
  if (last.type === 'CLOSE_BRACE') {
    const p = matchingOpen(before, n - 1);
    // A set, a dictionary, and the block of a `do` or `match` expression end
    // an operand (`let a = do { 1 } if c else 0`).
    collection =
      isCollectionBrace(before, p) ||
      ['do', 'match'].includes(headOfBlock(source, before, p) ?? '');
    if (!collection) {
      const isIf = p >= 0 && headOfBlock(source, before, p) === 'if';
      if (sameLine) return { kind: 'words', keywords: isIf ? ['else'] : [] };
      if (isIf) return { kind: 'statement-or-else' };
      return { kind: 'default' };
    }
  }

  // After a complete expression on its line: a word continues it only as
  // `in`, `is`, or a postfix `if` (and its `else`).
  if (sameLine && (collection || endsOperand(before, n - 1))) {
    const keywords = ['if', 'in', 'is'];
    if (hasPostfixIf(source, before)) keywords.push('else');
    return { kind: 'words', keywords };
  }

  return { kind: 'default' };
}

/** Whether `before[i]` ends an operand: a name that is not a keyword, a
 * number, a string, a literal, or a closing parenthesis or bracket. */
function endsOperand(before: readonly Token[], i: number): boolean {
  const t = before[i];
  if (t === undefined) return false;
  if (t.type === 'SYMBOL') return !NON_OPERAND_WORDS.has(t.text);
  return [
    'VERBATIM_SYMBOL',
    'NUMBER',
    'STRING',
    'LATEX_ISLAND',
    'CLOSE_PAREN',
    'CLOSE_BRACKET',
    'SUPERSCRIPT',
    'SUBSCRIPT',
  ].includes(t.type);
}

/** Whether the `{` at `p` opens a set or a dictionary, not a block: it
 * follows a comma, an opening bracket, an operator other than `=>`, `in`, or
 * the `else` of a postfix conditional. */
function isCollectionBrace(before: readonly Token[], p: number): boolean {
  const previous = before[p - 1];
  if (p <= 0 || previous === undefined) return false;
  return (
    previous.type === 'COMMA' ||
    /^OPEN_/.test(previous.type) ||
    // The `>` of a type argument list ends a type: a block follows
    // (`-> list<integer> {`, `if x is list<integer> {`).
    (previous.type === 'OPERATOR' &&
      !['=>', '>', '>>'].includes(previous.text)) ||
    (previous.type === 'SYMBOL' && previous.text === 'in') ||
    (previous.type === 'SYMBOL' &&
      previous.text === 'else' &&
      before[p - 2]?.type !== 'CLOSE_BRACE')
  );
}

/** The index of the bracket that `before[i]`, a closing bracket, closes. */
function matchingOpen(before: readonly Token[], i: number): number {
  let depth = 0;
  for (let j = i; j >= 0; j -= 1) {
    if (/^CLOSE_/.test(before[j].type)) depth += 1;
    else if (/^OPEN_/.test(before[j].type)) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** The index of the innermost bracket still open at `before[i]`, or -1. */
function innermostOpen(before: readonly Token[], i: number): number {
  let depth = 0;
  for (let j = i; j >= 0; j -= 1) {
    if (/^CLOSE_/.test(before[j].type)) depth += 1;
    else if (/^OPEN_/.test(before[j].type)) {
      if (depth === 0) return j;
      depth -= 1;
    }
  }
  return -1;
}

/** The keyword that heads the block opened by the `{` at `brace`: the first
 * of `if`, `else`, `match`, `while`, `for`, `do`, `function`, `protocol`
 * found back from it at its depth, within its statement. */
function headOfBlock(
  source: string,
  before: readonly Token[],
  brace: number
): string | undefined {
  const heads = [
    'if',
    'else',
    'match',
    'while',
    'for',
    'do',
    'function',
    'protocol',
  ];
  let depth = 0;
  for (let j = brace - 1; j >= 0; j -= 1) {
    const t = before[j];
    if (/^CLOSE_/.test(t.type)) depth += 1;
    else if (/^OPEN_/.test(t.type)) {
      if (depth === 0) return undefined;
      depth -= 1;
    }
    if (depth !== 0) continue;
    if (t.type === 'SEMICOLON') return undefined;
    if (t.type === 'SYMBOL' && heads.includes(t.text)) return t.text;
    // A linebreak ends the statement unless the line before continues.
    const previous = before[j - 1];
    if (
      previous !== undefined &&
      source.slice(previous.end, t.start).includes('\n') &&
      !(
        previous.type === 'OPERATOR' ||
        previous.type === 'COMMA' ||
        /^OPEN_/.test(previous.type)
      )
    )
      return undefined;
  }
  return undefined;
}

/** Whether the tokens end inside a type annotation of a declaration on
 * the line: back from the end, at bracket depth 0, a `:` of `let a:` or of a
 * parameter, a `->` of a function header or the `=` of `type T =` comes
 * before an `=`, a `;` or the start of the line. A type test (`x is T`) is
 * an expression, not an annotation. */
function inAnnotation(source: string, before: readonly Token[]): boolean {
  let depth = 0;
  for (let j = before.length - 1; j >= 0; j -= 1) {
    const t = before[j];
    if (/^CLOSE_/.test(t.type)) depth += 1;
    else if (/^OPEN_/.test(t.type)) {
      if (depth === 0) return false;
      depth -= 1;
    }
    if (depth === 0) {
      if (t.text !== 'is' && isAnnotationStart(before.slice(0, j + 1), source))
        return true;
      if (t.type === 'SEMICOLON' || (t.type === 'OPERATOR' && t.text === '='))
        return false;
    }
    // A linebreak ends the annotation unless the line before continues
    // (`let a: integer |` and `real` on the next line).
    const previous = before[j - 1];
    if (
      previous !== undefined &&
      /[\n\r]/.test(source.slice(previous.end, t.start)) &&
      !(
        previous.type === 'OPERATOR' ||
        previous.type === 'COMMA' ||
        /^OPEN_/.test(previous.type)
      )
    )
      return false;
  }
  return false;
}

/** Whether the line before the offset has a postfix `if` (`a if c`) that
 * has no `else` yet, at depth 0. */
function hasPostfixIf(source: string, before: readonly Token[]): boolean {
  let depth = 0;
  let open = 0;
  for (let j = before.length - 1; j > 0; j -= 1) {
    const t = before[j];
    if (/^CLOSE_/.test(t.type)) depth += 1;
    else if (/^OPEN_/.test(t.type)) {
      if (depth === 0) return false;
      depth -= 1;
    }
    // The first token of the line is not a postfix `if`: the `if` of a
    // statement follows the end of the line before.
    const lineStart = /[\n\r]/.test(source.slice(before[j - 1].end, t.start));
    if (depth === 0 && t.type === 'SYMBOL' && !lineStart) {
      if (t.text === 'else') open -= 1;
      if (t.text === 'if' && endsOperand(before, j - 1)) {
        open += 1;
        if (open > 0) return true;
      }
    }
    if (t.type === 'SEMICOLON' || lineStart) return false;
  }
  return false;
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

/** The path from the root to the `Field` or the `MemberCall` whose member
 * name is the placeholder (`a.▮` parses as `Field(a, "▮")`), as `findHole`
 * gives it. */
function findMemberHole(
  ast: MathJsonExpression | null,
  placeholder: string
): HolePath | undefined {
  if (ast === null) return undefined;
  const nodes: MathJsonExpression[] = [];
  const indices: number[] = [];
  const visit = (node: MathJsonExpression, index: number): boolean => {
    nodes.push(node);
    indices.push(index);
    if (
      (operator(node) === 'Field' || operator(node) === 'MemberCall') &&
      stringValue(operand(node, 2)) === placeholder
    )
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
  /** The source with the hole, that the tree was parsed from. */
  text: string;
  /** The types of the source and of the `typeNames` option. */
  typeNames: ReadonlySet<string>;
};

/**
 * The type expected for `nodes[k]`, from its parent:
 * - the value of a `let` with a type: that type;
 * - an element of a list whose expected type is `list<T>`: `T`;
 * - the value of an assignment to a declared variable: its type;
 * - an argument of a call of a function of the source: the type of its
 *   parameter, when it has one;
 * - an argument of a call of a library function: the parameter type of its
 *   signature;
 * - the right side of `|>`: a function of one argument of the type of the
 *   left side (`x |> f` is `f(x)`), `function` when the left side has no
 *   static type.
 */
function expectedTypeAt(context: Context, k: number): string | undefined {
  if (k < 1) return undefined;
  const { ce, nodes } = context;
  const parent = nodes[k - 1];
  const index = context.indices[k];
  const head = operator(parent);

  if (head === 'Pipe') {
    if (index !== 1) return undefined;
    const left = staticTypeOf(context, operand(parent, 1));
    if (left === undefined) return 'function';
    return typeToString({
      kind: 'signature',
      args: [{ type: left }],
      result: 'any',
    });
  }

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
    if (declaration?.kind !== 'function') return undefined;
    const params = declaration.params.map((p, i) =>
      p === undefined ||
      (declaration.rest && i === declaration.params.length - 1)
        ? undefined
        : parseTypeString(ce, p)
    );
    const required = declaration.optional.filter(
      (optional, i) =>
        !optional && !(declaration.rest && i === params.length - 1)
    ).length;
    const topic = implicitTopicSlot(
      context,
      k,
      params,
      required,
      declaration.rest
    );
    if (topic === null) return undefined;
    return declaration.params[slotOfOperand(index, topic)];
  }

  // A library function: the parameter type of its signature.
  const parameter = libraryParameterAt(context, k)?.parameter;
  return parameter === undefined ? undefined : typeToString(parameter);
}

/** The library function called by `nodes[k - 1]`, its signature, and the
 * declared type of the parameter of `nodes[k]`. `topic` is the slot that
 * the piped value fills (`implicitTopicSlot`). */
function libraryParameterAt(
  context: Context,
  k: number
):
  | {
      name: string;
      signature: FunctionSignature;
      parameter: Type;
      topic: number | undefined;
    }
  | undefined {
  const { ce } = context;
  const head = operator(context.nodes[k - 1]);
  const index = context.indices[k];
  const name =
    ce.operatorInfo(head) !== undefined ? head : canonicalLibraryName(head);
  const signature =
    name === undefined ? undefined : ce.operatorInfo(name)?.signature?.type;
  if (
    name === undefined ||
    typeof signature !== 'object' ||
    signature.kind !== 'signature'
  )
    return undefined;
  // The type variables are replaced by their bounds, for the fit of the
  // piped value only.
  const bounds: Record<string, Type> = {};
  for (const p of signature.typeParams ?? []) bounds[p.name] = p.bound ?? 'any';
  const params = [
    ...(signature.args ?? []),
    ...(signature.optArgs ?? []),
    ...(signature.variadicArg === undefined ? [] : [signature.variadicArg]),
  ].map((p) => substituteTypeVariables(p.type, bounds));
  const topic = implicitTopicSlot(
    context,
    k,
    params,
    (signature.args?.length ?? 0) +
      (signature.variadicArg === undefined ? 0 : (signature.variadicMin ?? 0)),
    signature.variadicArg !== undefined
  );
  if (topic === null) return undefined;
  const parameter = parameterAt(signature, slotOfOperand(index, topic));
  return parameter === undefined
    ? undefined
    : { name, signature, parameter, topic };
}

/**
 * The slot that the piped value fills in the call `nodes[k - 1]`, when the
 * call is the right side of `|>`, has no `_` operand and misses a required
 * argument: `xs |> filter(p)` is `filter(xs, p)`, and `xs |> map(f)` is
 * `map(f, xs)`. The operands from that slot on bind the next parameter
 * (`slotOfOperand`). `params` are the parameter types of the callee, the
 * variadic one last (`undefined` when not known), and `required` its number
 * of required arguments.
 *
 * The slot is that of the `Pipe` handler (`implicitTopicSlot` in
 * `library/core.ts`) for a callee with one signature, when the operand at
 * the hole fits the slot it binds: `topicSlotOf`. `null` when that slot is
 * not known. `undefined` when the call does not take the piped value as an
 * implicit argument.
 */
function implicitTopicSlot(
  context: Context,
  k: number,
  params: (Type | undefined)[],
  required: number,
  variadic: boolean
): number | null | undefined {
  if (k < 2) return undefined;
  const pipe = context.nodes[k - 2];
  const call = context.nodes[k - 1];
  if (operator(pipe) !== 'Pipe' || context.indices[k - 1] !== 1)
    return undefined;
  const written = operands(call);
  const n = written.length;
  if (written.some((arg) => symbol(arg) === '_')) return undefined;
  if (n >= required || (!variadic && n + 1 > params.length)) return undefined;
  const slot = topicSlotOf(
    context,
    operand(pipe, 1),
    written,
    context.indices[k],
    params
  );
  return slot === 'none' ? null : slot;
}

/**
 * The slot that the piped value `topic` fills in a call of the operands
 * `written` (`null` for an operand not written yet, of unknown type) to a
 * signature with the parameter types `params` (the variadic one last;
 * `undefined` when not known).
 *
 * The `Pipe` handler takes the last slot where the piped value and every
 * written operand fit: a subtype of the parameter (`matches`), a function
 * at a signature parameter, an operand of unknown type at any parameter.
 * Here, a value whose static type cannot overlap the type of the parameter
 * does not fit, and the operand at `hole` fits any slot. The last slot
 * where every value may fit is the slot of the handler when, at that slot,
 * the static type of the piped value and of each written operand other
 * than `hole` and `null` is a subtype of the parameter, or a function type
 * at a signature parameter: every later slot has a value that cannot fit.
 * That slot is returned; `null` when such a test fails or cannot be made
 * (a value or a parameter with no known type), since the handler may then
 * take an earlier slot; `'none'` when no slot may fit.
 */
function topicSlotOf(
  context: Context,
  topic: MathJsonExpression | null,
  written: readonly (MathJsonExpression | null)[],
  hole: number | undefined,
  params: readonly (Type | undefined)[]
): number | null | 'none' {
  const fits = (
    node: MathJsonExpression | null,
    param: Type | undefined
  ): boolean => {
    const type = staticTypeOf(context, node);
    if (param === undefined || type === undefined) return true;
    if (isFunctionType(type) && isFunctionType(param)) return true;
    return typesMayOverlap(type, param) !== false;
  };
  const accepts = (
    node: MathJsonExpression | null,
    param: Type | undefined
  ): boolean => {
    const type = staticTypeOf(context, node);
    if (param === undefined || type === undefined) return false;
    if (isFunctionType(type) && signatureArms(param) !== undefined) return true;
    return subtypeOf(context.ce, type, param) === true;
  };
  const last = params.length - 1;
  const paramOf = (j: number, i: number): Type | undefined =>
    params[Math.min(slotOfOperand(j, i), last)];
  for (let i = Math.min(last, written.length); i >= 0; i -= 1)
    if (
      fits(topic, params[i]) &&
      written.every((arg, j) => j === hole || fits(arg, paramOf(j, i)))
    )
      return accepts(topic, params[i]) &&
        written.every(
          (arg, j) => j === hole || arg === null || accepts(arg, paramOf(j, i))
        )
        ? i
        : null;
  return 'none';
}

/**
 * The field that the piped value `topic` fills in the snippet of a call
 * after `|>`, whose `m` fields are the required parameters of a function
 * with the signatures `callables`. The `Pipe` handler tries the signatures
 * in order and gives the piped value its slot in the call written with the
 * other fields (`topicSlotOf`, the fields of unknown type): `xs |> take` is
 * `take(count)`, and the field `xs` is left out; `xs |> fold` is
 * `fold(reducer, initial)`, and the collection is left out. `m` when the
 * piped value fills the slot after the fields (`[1, 2] |> map` is
 * `map(mapping)`, the collection is the rest parameter). `undefined` when
 * the slot is not known, or when neither call takes the piped value as an
 * implicit argument.
 */
function pipedTopicField(
  context: Context,
  topic: MathJsonExpression | null,
  callables: readonly Callable[],
  m: number
): number | undefined {
  // The call without the field of the piped value, then the call with every
  // field.
  for (const n of [m - 1, m]) {
    if (n < 0 || callables.some((c) => n >= c.required)) continue;
    let slot: number | null | 'none' = 'none';
    for (const c of callables) {
      if (!c.rest && n + 1 > c.params.length) continue;
      slot = topicSlotOf(
        context,
        topic,
        new Array<null>(n).fill(null),
        undefined,
        c.params
      );
      if (slot !== 'none') break;
    }
    if (slot === null) return undefined;
    if (slot !== 'none') return n === m - 1 || slot === m ? slot : undefined;
  }
  return undefined;
}

/** The parameter slot of operand `j` of a call where the piped value fills
 * the slot `topic` (`implicitTopicSlot`). */
function slotOfOperand(j: number, topic: number | undefined): number {
  return topic !== undefined && j >= topic ? j + 1 : j;
}

/** The type of the parameter at `index` of a signature. */
function parameterAt(
  signature: FunctionSignature,
  index: number
): Type | undefined {
  const args = signature.args ?? [];
  const optArgs = signature.optArgs ?? [];
  return (
    args[index] ??
    optArgs[index - args.length] ??
    (index >= args.length + optArgs.length ? signature.variadicArg : undefined)
  )?.type;
}

/**
 * The type that `nodes[k]` admits, for the fit of a name: the expected type
 * (`expectedTypeAt`), with three changes.
 *
 * - The right side of `|>` admits a function of the left side (`unknown`
 *   when it has no static type) of any effects.
 * - A type variable of the signature of a library function is bound from
 *   the static type of the other arguments, where one is a variable
 *   parameter or the element of a collection parameter
 *   (`filter([1, 2], ▮` admits `(integer) any -> boolean`); a variable left
 *   unbound is `unknown`.
 * - An argument of a broadcastable library function, or of a function of
 *   the source, admits a list of the type too (`A * A` with a matrix `A`):
 *   the call maps over it. A function type is not mapped over.
 *
 * `undefined` when the expected type does not parse (a type of the source
 * that the engine does not know).
 */
function admittedTypeAt(
  context: Context,
  k: number,
  expected: string
): Type | undefined {
  const { ce } = context;
  const parent = context.nodes[k - 1];
  const head = operator(parent);
  let type: Type | undefined;
  let broadcast = false;
  // The heads that `expectedTypeAt` reads before the library functions.
  if (head === 'Pipe')
    // `x |> f` admits a function of the left side, of any effects.
    type = {
      kind: 'signature',
      args: [{ type: staticTypeOf(context, operand(parent, 1)) ?? 'unknown' }],
      result: 'any',
      effects: 'any',
    };
  else if (
    ['KeyValuePair', 'List', 'Assign', 'Program', ''].includes(head) ||
    GRAMMAR_CONSTRUCTS.has(head)
  )
    type = parseTypeString(ce, expected);
  else if (
    head === 'NamedArgument' ||
    context.visible.get(head)?.kind === 'function'
  ) {
    type = parseTypeString(ce, expected);
    broadcast = true;
  } else {
    const library = libraryParameterAt(context, k);
    if (library === undefined) type = parseTypeString(ce, expected);
    else {
      type = library.parameter;
      const { signature } = library;
      if (signature.typeParams !== undefined) {
        const bindings: Record<string, Type> = {};
        // The operands, and the piped value at its slot.
        const args = operands(parent).map((arg, j) => ({
          arg: arg as MathJsonExpression | null,
          slot: slotOfOperand(j, library.topic),
          hole: j === context.indices[k],
        }));
        if (library.topic !== undefined)
          args.push({
            arg: operand(context.nodes[k - 2], 1),
            slot: library.topic,
            hole: false,
          });
        args.forEach(({ arg, slot, hole }) => {
          if (hole) return;
          const param = parameterAt(signature, slot);
          const argType = staticTypeOf(context, arg);
          if (param === undefined || argType === undefined) return;
          if (typeof param !== 'object') return;
          if (param.kind === 'variable') bindings[param.name] ??= argType;
          else if (
            (param.kind === 'collection' ||
              param.kind === 'indexed_collection' ||
              param.kind === 'list' ||
              param.kind === 'set') &&
            typeof param.elements === 'object' &&
            param.elements.kind === 'variable'
          ) {
            const element = collectionElementType(argType);
            if (element !== undefined)
              bindings[param.elements.name] ??= element;
          }
        });
        for (const p of signature.typeParams) bindings[p.name] ??= 'unknown';
        type = substituteTypeVariables(type, bindings);
      }
      broadcast = isBroadcastable(ce, library.name);
    }
  }
  if (type === undefined) return undefined;
  return broadcast && !isFunctionType(type)
    ? { kind: 'broadcastable', elements: type }
    : type;
}

/** Whether a library operator maps over a list argument. */
function isBroadcastable(ce: ComputeEngine, name: string): boolean {
  const def = ce.lookupDefinition(name);
  return isOperatorDef(def) && def.operator.broadcastable;
}

/** Whether a type is `function` or a signature (an overload set, a union of
 * signatures), also through a transparent alias. */
function isFunctionType(type: Type): boolean {
  const t = resolveTypeAlias(type);
  return t === 'function' || signatureArms(t) !== undefined;
}

/** Whether a position that admits `type` expects a function value, where a
 * call of a name cannot fit: a function type, or a union of function types
 * and `nothing` (`((real) -> real) | nothing`). An alias is unfolded, also
 * one that only the source declares (`type F = (real) -> real`). */
function expectsFunction(context: Context, type: Type): boolean {
  const unfold = (t: Type): Type => {
    for (let i = 0; i < 16; i += 1) {
      t = resolveTypeAlias(t);
      if (
        typeof t !== 'object' ||
        t.kind !== 'reference' ||
        t.def !== undefined
      )
        break;
      const declared = context.sourceTypes.get(t.name);
      const body =
        declared?.kind === 'alias'
          ? parseSourceType(context.ce, declared.body, context.typeNames)
          : undefined;
      if (body === undefined) break;
      t = body;
    }
    return t;
  };
  let t = unfold(type);
  // A broadcastable parameter admits a list of the type too, which a call of
  // a function name does not give either.
  if (typeof t === 'object' && t.kind === 'broadcastable')
    t = unfold(t.elements);
  if (isFunctionType(t)) return true;
  if (typeof t !== 'object' || t.kind !== 'union') return false;
  const arms = t.types.map(unfold);
  return (
    arms.some(isFunctionType) &&
    arms.every((arm) => isFunctionType(arm) || arm === 'nothing')
  );
}

/** The arms of a union that are function types when the union has other
 * arms too (`function | nothing`); `undefined` otherwise. A value of the
 * union fits one of its arms. */
function functionArmsOf(type: Type): Type[] | undefined {
  if (
    typeof type !== 'object' ||
    type.kind !== 'union' ||
    signatureArms(type) !== undefined
  )
    return undefined;
  const arms = type.types.map(resolveTypeAlias).filter(isFunctionType);
  return arms.length > 0 ? arms : undefined;
}

/**
 * The static type of an expression of the source, when the source gives it
 * simply: a literal (`5` is `integer`, `[1, 2]` is `vector<integer^2>`), a
 * name of the source with a type (`declarationDetail`), a call of a library
 * function with one signature that is not generic and does not map over its
 * arguments. `undefined` otherwise.
 */
function staticTypeOf(
  context: Context,
  node: MathJsonExpression | null
): Type | undefined {
  const { ce } = context;
  if (node === null) return undefined;
  if (isLiteral(node)) {
    const text = literalTypeText(ce, node, true);
    return text === undefined ? undefined : parseTypeString(ce, text);
  }
  const name = symbol(node);
  if (name !== null) {
    const group = context.visible.get(name);
    if (group === undefined || group.kind === 'function') return undefined;
    const { type } = declarationDetail(
      ce,
      declarationOf(group, context.declarations),
      context.text,
      context.typeNames
    );
    return type === undefined ? undefined : parseTypeString(ce, type);
  }
  const head = operator(node);
  if (head === '' || context.visible.has(head)) return undefined;
  const library =
    ce.operatorInfo(head) !== undefined ? head : canonicalLibraryName(head);
  const signature =
    library === undefined
      ? undefined
      : ce.operatorInfo(library)?.signature?.type;
  if (
    library === undefined ||
    typeof signature !== 'object' ||
    signature.kind !== 'signature' ||
    signature.typeParams !== undefined ||
    isBroadcastable(ce, library)
  )
    return undefined;
  return signature.result;
}

/** A member of a value, an item after `.`: a field of a record or of an
 * `object` type, a named element of a tuple, or a property or a function of
 * a protocol that the type of the value conforms to. `type` is the type of
 * a read and `result` the result of a call of a function, `undefined` when
 * not known; `arity` is the number of parameters of a function after the
 * receiver, `undefined` when not known. */
type Member =
  | {
      kind: 'field';
      name: string;
      type: Type | undefined;
      detail: string;
      /** A protocol property listed in place of a protocol function of the
       * same name: `x.name()` calls the function, not the property's value,
       * so the call has no type here. */
      noCall?: true;
    }
  | {
      kind: 'function';
      name: string;
      result: Type | undefined;
      arity: number | undefined;
      /** The required parameters after the receiver, for a snippet:
       * `undefined` when the signature is not known. */
      required: Parameter[] | undefined;
      detail: string;
    };

/**
 * The type of the receiver of a member (the expression before `.`): the
 * declared or literal type of a name of the source, which may be a type of
 * the source, the type of a member of a receiver (`a.b`, `a.f()`), else
 * `staticTypeOf`.
 */
function receiverTypeOf(
  context: Context,
  node: MathJsonExpression | null
): Type | undefined {
  const head = operator(node);
  if (head === 'Field' || head === 'MemberCall') {
    const base = receiverTypeOf(context, operand(node, 1));
    const name = stringValue(operand(node, 2));
    if (base === undefined || name === null) return undefined;
    // A function member is reached by a call only (`c.area` is an error).
    const member = membersOf(context, base).find((m) => m.name === name);
    if (member === undefined) return undefined;
    if (member.kind === 'function')
      return head === 'MemberCall' ? member.result : undefined;
    if (head === 'Field') return member.type;
    if (member.noCall) return undefined;
    // A call of a field that holds a function (`r.make()`): its result.
    const signature =
      member.type === undefined ? undefined : resolveTypeAlias(member.type);
    return typeof signature === 'object' && signature.kind === 'signature'
      ? signature.result
      : undefined;
  }
  const name = symbol(node);
  if (name !== null) {
    const group = context.visible.get(name);
    if (group === undefined || group.kind === 'function') return undefined;
    const { type } = declarationDetail(
      context.ce,
      declarationOf(group, context.declarations),
      context.text,
      context.typeNames
    );
    return type === undefined
      ? undefined
      : parseSourceType(context.ce, type, context.typeNames);
  }
  return staticTypeOf(context, node);
}

/** The body of a reference to a type that the source declares and the
 * engine does not know: the declared body, or the payload of a variant of a
 * sum type of the source (`square(s: number)` is `tuple<s: number>`). */
function sourceTypeBody(context: Context, type: Type): Type | undefined {
  if (typeof type !== 'object' || type.kind !== 'reference') return undefined;
  if (type.def !== undefined) return undefined;
  const declared = context.sourceTypes.get(type.name);
  if (declared === undefined) {
    const payload = sourceVariantPayload(context.sourceTypes, type.name);
    return payload?.length === 1
      ? parseSourceType(context.ce, payload[0], context.typeNames)
      : undefined;
  }
  if (declared.kind === 'sum') return undefined;
  // Only the body of a nominal type may be an `object{…}` layout.
  return parseSourceType(
    context.ce,
    declared.body,
    context.typeNames,
    declared.kind === 'nominal' ? { allowObjectType: true } : undefined
  );
}

/** The payload of a variant of a sum type of the source, `undefined` when
 * `name` is not one (a variant known only from the `sumVariants` option has
 * no payload here). A payload of several fields is one tuple type string. */
function sourceVariantPayload(
  sourceTypes: ReadonlyMap<string, SourceType>,
  name: string
): string[] | undefined {
  for (const declared of sourceTypes.values())
    if (declared.kind === 'sum')
      for (const variant of declared.variants)
        if (variant.name === name && variant.payload !== undefined)
          return variant.payload;
  return undefined;
}

/**
 * The members of a value of type `type`, fields first: the fields of a
 * record or of an `object` type, the named elements of a tuple, through an
 * alias or a nominal type of the source or of the engine; then the
 * properties and the functions of the protocols the type conforms to. A
 * field hides a protocol member of the same name (`c.area()` reads a field
 * `area` first). A function member leaves out its receiver: `c.scale(2)` is
 * `scale(c, 2)`.
 *
 * The conformances are those of the source (`type T is P`, with the parents
 * of `P`), to a protocol of the source or of the engine, and those that the
 * engine holds for a type that it knows (a host declaration). A conformance
 * of the source applies through a transparent alias and to a subtype, not
 * through a nominal type (`type Wrapped = Circle` does not conform as
 * `Circle` does); a conformance to a sum type applies to each of its
 * variants. A conditional conformance (`type list<T> is P where T: number`)
 * applies when the receiver matches its head and the argument satisfies the
 * clause, as the engine decides it; a clause that names a protocol holds
 * when an unconditional conformance to that protocol covers the argument
 * (a conditional one is not followed, and gives no member).
 *
 * A member is listed only when exactly one protocol declares it among the
 * protocols of the conformances that apply, even where the engine
 * dispatches to the more specific one (`type number is A` and `type integer
 * is B`, both declaring `f`: an `integer` lists no `f`). The properties and
 * the functions are counted apart, as the engine resolves a read and a call
 * apart; a name listed as both is listed as the property, which a `.` with
 * no parentheses reads.
 */
function membersOf(context: Context, type: Type): Member[] {
  const { ce } = context;
  const members: Member[] = [];
  const seen = new Set<string>();
  const add = (member: Member) => {
    if (seen.has(member.name)) return;
    seen.add(member.name);
    members.push(member);
  };

  // The fields are those of the layout, through the aliases and the nominal
  // types. A conformance names the type along its transparent aliases, up to
  // and including the first nominal type (`identity`).
  const names = new Set<string>([typeToString(type)]);
  let identity: Type = type;
  let nominal = false;
  let body: Type = type;
  for (let i = 0; i < 16; i += 1) {
    body = resolveTypeAlias(body);
    if (!nominal) identity = body;
    if (typeof body !== 'object' || body.kind !== 'reference') break;
    if (!nominal) names.add(body.name);
    if (
      !(body.def !== undefined
        ? body.alias
        : context.sourceTypes.get(body.name)?.kind === 'alias')
    )
      nominal = true;
    const next =
      body.def !== undefined
        ? resolveTypeReference(body)
        : sourceTypeBody(context, body);
    if (next === undefined) break;
    body = next;
  }
  if (typeof body === 'object') {
    if (body.kind === 'record' || body.kind === 'object')
      for (const [name, t] of Object.entries(body.elements))
        add({ kind: 'field', name, type: t, detail: typeToString(t) });
    else if (body.kind === 'tuple')
      for (const element of body.elements)
        if (element.name !== undefined)
          add({
            kind: 'field',
            name: element.name,
            type: element.type,
            detail: typeToString(element.type),
          });
  }

  // `Self` in a requirement is the type of the receiver.
  const self = typeToString(type);
  const addRequirement = (name: string, requirement: ProtocolMember) => {
    if (requirement.kind !== 'function') {
      const text = requirement.type.replace(/\bSelf\b/g, self);
      add({
        kind: 'field',
        name,
        type: parseSourceType(ce, text, context.typeNames),
        detail: text,
      });
      return;
    }
    const text = requirement.signature.replace(/\bSelf\b/g, self);
    const signature = parseSourceType(ce, text, context.typeNames);
    if (
      typeof signature !== 'object' ||
      signature.kind !== 'signature' ||
      (signature.args?.length ?? 0) === 0
    ) {
      add({
        kind: 'function',
        name,
        result: undefined,
        arity: undefined,
        required: undefined,
        detail: text,
      });
      return;
    }
    const rest: FunctionSignature = {
      ...signature,
      args: signature.args!.slice(1),
    };
    add({
      kind: 'function',
      name,
      result: signature.result,
      arity:
        rest.args!.length +
        (rest.optArgs?.length ?? 0) +
        (rest.variadicArg === undefined ? 0 : 1),
      required: parametersOf(rest),
      detail: typeToString(rest),
    });
  };

  // The protocols and the conformances of the source.
  const protocols = new Map<
    string,
    { members: [string, ProtocolMember][]; parents: string[] }
  >();
  const conformances: {
    target: string;
    protocols: string[];
    where: string | undefined;
  }[] = [];
  for (const statement of operands(context.ast)) {
    const head = operator(statement);
    if (head === 'DeclareProtocol') {
      const name = symbol(operand(statement, 1));
      if (name === null) continue;
      const requirements: [string, ProtocolMember][] = [];
      for (const kv of operands(operand(statement, 2))) {
        const member = symbol(operand(kv, 1));
        const kind = stringValue(operand(operand(kv, 2), 1));
        const text = stringValue(operand(operand(kv, 2), 2));
        if (member === null || text === null) continue;
        if (kind === 'function')
          requirements.push([member, { kind, signature: text }]);
        else if (kind === 'readonly' || kind === 'readwrite')
          requirements.push([member, { kind, type: text }]);
      }
      protocols.set(name, {
        members: requirements,
        parents: operands(operand(statement, 3))
          .map(symbol)
          .filter((p) => p !== null),
      });
    } else if (head === 'DeclareConformance') {
      const target = stringValue(operand(statement, 1));
      if (target !== null)
        conformances.push({
          target,
          protocols: operands(operand(statement, 2))
            .map(symbol)
            .filter((p) => p !== null),
          where: stringValue(operand(statement, 3)) ?? undefined,
        });
    }
  }
  // Whether an unconditional conformance to `protocol` covers `type`: one
  // of the source, to `protocol` or to a protocol that extends it, or one
  // that the engine holds. A conditional conformance is not followed.
  const extendsProtocol = (
    name: string,
    protocol: string,
    depth = 0
  ): boolean =>
    name === protocol ||
    (depth < 16 &&
      (
        protocols.get(name)?.parents ??
        ce._protocolRegistry[name]?.extends ??
        []
      ).some((parent) => extendsProtocol(parent, protocol, depth + 1)));
  const covers = (type: Type, protocol: string): boolean => {
    const text = typeToString(type);
    for (const conformance of conformances) {
      if (conformance.where !== undefined) continue;
      if (!conformance.protocols.some((p) => extendsProtocol(p, protocol)))
        continue;
      if (conformance.target === text) return true;
      const sum = context.sourceTypes.get(conformance.target);
      if (
        sum?.kind === 'sum' &&
        sum.variants.some((variant) => variant.name === text)
      )
        return true;
      const t = parseTypeString(ce, conformance.target);
      if (t !== undefined && subtypeOf(ce, type, t) === true) return true;
    }
    if (protocols.has(protocol)) return false;
    return (ce._protocolRegistry[protocol]?.conformances ?? []).some(
      (edge) =>
        edge.where === undefined && subtypeOf(ce, type, edge.target) === true
    );
  };
  // Whether a conformance of the source applies to the receiver.
  const conformsTo = (target: string, where: string | undefined): boolean => {
    if (where === undefined) {
      if (names.has(target)) return true;
      const sum = context.sourceTypes.get(target);
      if (
        sum?.kind === 'sum' &&
        sum.variants.some((variant) => names.has(variant.name))
      )
        return true;
      const engine = parseTypeString(ce, target);
      return engine !== undefined && subtypeOf(ce, identity, engine) === true;
    }
    // The head and the clause, parsed as the engine does (a carrier
    // signature binds the variables of the head).
    const carrier = parseSourceType(
      ce,
      `(self: ${target}) -> nothing ${where}`,
      context.typeNames
    );
    if (
      typeof carrier !== 'object' ||
      carrier.kind !== 'signature' ||
      carrier.args?.[0] === undefined ||
      carrier.typeParams === undefined
    )
      return false;
    try {
      return (
        conditionalTargetInstance(
          carrier.args[0].type,
          carrier.typeParams,
          identity,
          covers
        ) !== null
      );
    } catch {
      return false;
    }
  };
  // The properties and the functions by name, with the protocols that
  // declare each one and their requirement.
  const properties = new Map<string, Map<string, ProtocolMember>>();
  const functions = new Map<string, Map<string, ProtocolMember>>();
  const require = (
    protocol: string,
    name: string,
    requirement: ProtocolMember
  ) => {
    const byName = requirement.kind === 'function' ? functions : properties;
    const owners = byName.get(name) ?? new Map<string, ProtocolMember>();
    owners.set(protocol, requirement);
    byName.set(name, owners);
  };
  const visit = (protocol: string, visited: Set<string>) => {
    if (visited.has(protocol)) return;
    visited.add(protocol);
    const declared = protocols.get(protocol);
    const record =
      declared === undefined ? ce._protocolRegistry[protocol] : undefined;
    for (const [name, requirement] of declared?.members ??
      Object.entries(record?.members ?? {}))
      require(protocol, name, requirement);
    for (const parent of declared?.parents ?? record?.extends ?? [])
      visit(parent, visited);
  };
  for (const conformance of conformances) {
    if (!conformsTo(conformance.target, conformance.where)) continue;
    const visited = new Set<string>();
    for (const protocol of conformance.protocols) visit(protocol, visited);
  }

  // The conformances that the engine holds, for a type that it knows. Here
  // the engine's dispatch gives the owners of a function
  // (`protocolFunctionMemberOwners` keeps the most specific edges only), so
  // a member that the same declarations in the source leave out can be
  // listed: the engine's answer is the call's real dispatch.
  if (parseTypeString(ce, typeToString(identity)) !== undefined)
    for (const record of Object.values(ce._protocolRegistry)) {
      if (protocols.has(record.name)) continue;
      for (const [name, requirement] of Object.entries(record.members)) {
        try {
          const applies =
            requirement.kind === 'function'
              ? protocolFunctionMemberOwners(ce, identity, name).includes(
                  record.name
                )
              : !['error', 'unknown', undefined].includes(
                  protocolPropertyTypeOfReceiver(ce, identity, name, record) as
                    string | undefined
                );
          if (applies) require(record.name, name, requirement);
        } catch {
          // A type that the engine cannot compare: no member.
        }
      }
    }
  // The properties first: `add` keeps the first member of a name.
  for (const byName of [properties, functions])
    for (const [name, owners] of byName)
      if (owners.size === 1) addRequirement(name, [...owners.values()][0]);
  for (const member of members)
    if (
      member.kind === 'field' &&
      functions.has(member.name) &&
      properties.has(member.name)
    )
      member.noCall = true;
  return members;
}

/** Whether a node is a literal whose type the engine gives: a number, a
 * string, `true`, `false`, or a list of these that is not empty. */
function isLiteral(node: MathJsonExpression | null): boolean {
  if (typeof node === 'number' || isNumberNode(node)) return true;
  if (typeof node === 'object' && node !== null && 'str' in node) return true;
  const name = symbol(node);
  if (name === 'True' || name === 'False') return true;
  if (operator(node) !== 'List') return false;
  const elements = operands(node);
  return elements.length > 0 && elements.every(isLiteral);
}

function isNumberNode(node: MathJsonExpression | null): boolean {
  return typeof node === 'object' && node !== null && 'num' in node;
}

/** The type of a literal, as the engine types the value of a declaration
 * with no type: a `const` takes the type of the value with its literal
 * values widened (`5` is `integer`, `[1, 2]` is `vector<integer^2>`), a
 * `let` the wider type of a local (`number`, `list<number>`), which a later
 * assignment keeps. */
function literalTypeText(
  ce: ComputeEngine,
  value: MathJsonExpression,
  constant: boolean
): string | undefined {
  try {
    const type = ce.expr(value).type.type;
    return typeToString(
      constant ? widenValueTypes(type) : widenLocalType(ce, type)
    );
  } catch {
    return undefined;
  }
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
 * parse: the reference does not record the type parameters. `options` are
 * those of `parseType` (`allowObjectType` for the body of a nominal type). */
export function parseSourceType(
  ce: ComputeEngine,
  text: string,
  typeNames: ReadonlySet<string>,
  options?: ParseTypeOptions
): Type | undefined {
  const type = parseTypeString(ce, text);
  if (type !== undefined || (typeNames.size === 0 && options === undefined))
    return type;
  try {
    return parseType(
      text,
      {
        get names(): string[] {
          return [...typeNames];
        },
        forward: () => undefined,
        resolve: (name) =>
          typeNames.has(name)
            ? { kind: 'reference', name, alias: false, def: undefined }
            : undefined,
      },
      undefined,
      options
    );
  } catch {
    return undefined;
  }
}

const FIT_ORDER: Readonly<Record<Fit, number>> = {
  match: 0,
  maybe: 1,
  never: 2,
};

const worstFit = (a: Fit, b: Fit): Fit =>
  FIT_ORDER[a] >= FIT_ORDER[b] ? a : b;
const bestFit = (a: Fit, b: Fit): Fit => (FIT_ORDER[a] <= FIT_ORDER[b] ? a : b);

/** Whether `a` is a subtype of `b`; `undefined` when the engine cannot
 * tell (a type it does not know). */
function subtypeOf(ce: ComputeEngine, a: Type, b: Type): boolean | undefined {
  try {
    return ce.type(a).matches(ce.type(b));
  } catch {
    return undefined;
  }
}

/** Whether a value can be of both types; `undefined` when the engine cannot
 * tell. */
function typesMayOverlap(a: Type, b: Type): boolean | undefined {
  try {
    return typesOverlap(a, b);
  } catch {
    return undefined;
  }
}

/** The list of `type`, mapped over by a broadcast call, or `type` itself
 * for a function type. */
function broadcastOf(type: Type): Type {
  return isFunctionType(type)
    ? type
    : { kind: 'broadcastable', elements: type };
}

/**
 * How a value of type `type` fits the type `expected`: `'match'` when it is
 * a subtype, `'never'` when no value has both types, `'maybe'` otherwise (a
 * broader type such as `value`, a union with an arm that fits, an overlap of
 * two numeric ranges) and when the engine cannot tell. A function type
 * where a function is expected is judged by its signature (`fitOfCallable`),
 * also where a union expects a function in one of its arms
 * (`function | nothing`). A transparent alias is unfolded. `options` are
 * those of `fitOfFunction`.
 */
function fitValue(
  ce: ComputeEngine,
  type: Type,
  expected: Type,
  options?: { pipe?: boolean; openArity?: boolean }
): Fit {
  type = resolveTypeAlias(type);
  expected = resolveTypeAlias(expected);
  const arms = signatureArms(type);
  const mixed = arms !== undefined && functionArmsOf(expected) !== undefined;
  if (arms !== undefined && signatureArms(expected) !== undefined)
    return fitOfFunction(ce, arms.map(callableOf), false, expected, {
      ...options,
      union: typeof type === 'object' && type.kind === 'union',
    });
  const subtype = subtypeOf(ce, type, expected);
  const fit: Fit =
    subtype === undefined
      ? 'maybe'
      : subtype
        ? 'match'
        : typesMayOverlap(type, expected) === false
          ? 'never'
          : 'maybe';
  if (!mixed) return fit;
  return bestFit(
    fit,
    fitOfFunction(ce, arms.map(callableOf), false, expected, {
      ...options,
      union: typeof type === 'object' && type.kind === 'union',
    })
  );
}

/**
 * How a function name fits the type `expected`. `arms` are its signatures
 * (an overload set has several, a union of signatures is one of its arms),
 * `broadcast` whether it maps over a list argument, `union` whether `arms`
 * are the arms of a union, and `pipe` whether the name is at the right side
 * of `|>`.
 *
 * Where a function is expected (`expected` is a signature, a union or an
 * intersection of signatures, or `function`), the name is passed: its
 * signature is compared (`fitOfCallable`). An overload set fits by its best
 * arm; a union is `'match'` when every arm matches and `'never'` when every
 * arm is. Elsewhere the name is called, and its fit is that of the result of
 * a call: `'match'` when the result of every arm matches, `'never'` when the
 * result of no arm can fit, also as a list of a broadcast call. A union with
 * a function arm and other arms (`function | nothing`) takes the best of the
 * two. A transparent alias of `expected` is unfolded.
 *
 * A function whose result may be a function (or is not known) is not
 * `'never'` where a function is expected: the result of a call is passed
 * (`xs |> f(y)`, `filter(xs, mk(3))`). With `openArity` (a callback of a
 * library function that takes a variadic list of sources, `map(f, xs, ys)`),
 * the callback is called with one argument per source, of the type of its
 * source, not with the arguments of its declared signature: a function is
 * `'maybe'` at best, and `'never'` only for its effects or its result.
 */
function fitOfFunction(
  ce: ComputeEngine,
  arms: readonly Callable[],
  broadcast: boolean,
  expected: Type,
  options?: { union?: boolean; pipe?: boolean; openArity?: boolean }
): Fit {
  if (arms.length === 0) return 'maybe';
  expected = resolveTypeAlias(expected);
  if (expected === 'function') return 'match';
  const expectedArms = signatureArms(expected);
  if (expectedArms === undefined) {
    const fits = arms.map((arm) => {
      if (arm.result === undefined) return 'maybe';
      const fit = fitValue(ce, arm.result, expected);
      if (fit !== 'never' || !broadcast) return fit;
      return fitValue(ce, broadcastOf(arm.result), expected) === 'never'
        ? 'never'
        : 'maybe';
    });
    const called = fitOfAll(fits);
    const functionArms = functionArmsOf(expected);
    if (functionArms === undefined) return called;
    return functionArms
      .map((arm) => fitOfFunction(ce, arms, broadcast, arm, options))
      .reduce(bestFit, called);
  }
  const fitOfArm = (x: FunctionSignature) => {
    const fits = arms.map((arm) => {
      const fit = fitOfCallable(
        ce,
        arm,
        broadcast,
        x,
        options?.pipe === true,
        options?.openArity === true
      );
      if (fit !== 'never') return fit;
      const result =
        arm.result === undefined ? undefined : resolveTypeAlias(arm.result);
      return result === undefined ||
        typesMayOverlap(result, 'function') !== false
        ? 'maybe'
        : 'never';
    });
    return options?.union === true ? fitOfAll(fits) : fits.reduce(bestFit);
  };
  const fits = expectedArms.map(fitOfArm);
  return typeof expected === 'object' && expected.kind === 'intersection'
    ? fits.reduce(worstFit)
    : fits.reduce(bestFit);
}

/** The fit of a value that may be any of several values with these fits:
 * `'match'` when they all match, `'never'` when none can. */
function fitOfAll(fits: readonly Fit[]): Fit {
  if (fits.every((f) => f === 'match')) return 'match';
  if (fits.every((f) => f === 'never')) return 'never';
  return 'maybe';
}

/**
 * How a function fits where a function of signature `x` is expected: it is
 * called with the arguments that `x` admits, so it must take the required
 * ones (with its optional and rest parameters), each of its parameters must
 * admit the argument of `x` (contravariant), its result must fit the result
 * of `x`, and its effects must be a subset of those of `x`. A function that
 * cannot take an optional or a variadic argument of `x`, or whose parameter
 * may not admit it, is `'maybe'`: the caller may never pass it. An argument
 * that a broadcast function maps over (a list of the parameter type) gives a
 * list as the result.
 *
 * At the right side of `|>` (`pipe`), the call takes more arguments than the
 * left side (`xs |> take(2)` is `take(xs, 2)`): a function that is
 * `'never'` by this comparison is `'maybe'` when one of its parameters may
 * admit the left side. With `openArity`, a function is `'maybe'` at best
 * (`fitOfFunction`).
 */
function fitOfCallable(
  ce: ComputeEngine,
  callable: Callable,
  broadcast: boolean,
  x: FunctionSignature,
  pipe = false,
  openArity = false
): Fit {
  const fit = fitOfCall(ce, callable, broadcast, x, openArity);
  if (fit !== 'never' || !pipe) return fit;
  const left = x.args?.[0]?.type ?? 'unknown';
  const admits = callable.params.some(
    (param) =>
      param === undefined ||
      typesMayOverlap(left, param) !== false ||
      (broadcast &&
        !isFunctionType(param) &&
        typesMayOverlap(left, broadcastOf(param)) !== false)
  );
  return admits ? 'maybe' : 'never';
}

/** The comparison of `fitOfCallable`, without the rule of `|>`. */
function fitOfCall(
  ce: ComputeEngine,
  callable: Callable,
  broadcast: boolean,
  x: FunctionSignature,
  openArity: boolean
): Fit {
  const { params } = callable;
  // The arguments that `x` may pass, in order: the required ones, the
  // optional ones, then one for the variadic ones.
  const variadicMin = x.variadicArg !== undefined && x.variadicMin === 1;
  const positions = [
    ...(x.args ?? []).map((a) => ({ type: a.type, optional: false })),
    ...(x.optArgs ?? []).map((a) => ({ type: a.type, optional: true })),
    ...(x.variadicArg === undefined
      ? []
      : [{ type: x.variadicArg.type, optional: !variadicMin }]),
  ];
  // The shortest call of `x`, and the longest (`Infinity` when variadic).
  const shortest = positions.filter((p) => !p.optional).length;
  const longest = x.variadicArg === undefined ? positions.length : Infinity;
  if (callable.required > longest && !openArity) return 'never';
  if (!callable.rest && shortest > params.length) return 'never';
  let fit: Fit = callable.required > longest ? 'maybe' : 'match';
  // A call of `x` that the function cannot take: too few arguments, or
  // more than it has parameters.
  if (callable.required > shortest) fit = 'maybe';
  if (!callable.rest && longest > params.length) fit = 'maybe';
  // The effects of the function must be a subset of those of `x`
  // (`isSubtype` of two signatures).
  if (callable.effects === null) {
    if (x.effects !== 'any') fit = 'maybe';
  } else if (!isEffectSubset(callable.effects, x.effects)) return 'never';
  let mapped = false;
  for (const [i, { type: argument, optional }] of positions.entries()) {
    if (i >= params.length && !callable.rest) break;
    let param = i < params.length ? params[i] : params[params.length - 1];
    if (param === undefined) {
      fit = worstFit(fit, 'maybe');
      continue;
    }
    if (subtypeOf(ce, argument, param) === true) continue;
    if (broadcast && !isFunctionType(param)) {
      param = broadcastOf(param);
      mapped = true;
      if (subtypeOf(ce, argument, param) === true) continue;
    }
    if (!optional && !openArity && typesMayOverlap(argument, param) === false)
      return 'never';
    fit = worstFit(fit, 'maybe');
  }
  // The variadic tail of `x` may fill the further parameters of the
  // function: each of them must admit it.
  if (x.variadicArg !== undefined)
    for (let i = positions.length; i < params.length; i++) {
      const param = params[i];
      if (
        param === undefined ||
        subtypeOf(ce, x.variadicArg.type, param) !== true
      )
        fit = worstFit(fit, 'maybe');
    }
  // With `openArity`, the number and the types of the arguments of a call
  // are not those of `x`: one per source, each of the type of its source.
  if (openArity) fit = worstFit(fit, 'maybe');
  if (callable.result === undefined) return worstFit(fit, 'maybe');
  const result = mapped ? broadcastOf(callable.result) : callable.result;
  return worstFit(fit, fitValue(ce, result, x.result));
}

/** A signature as a `Callable`. A type variable of a generic signature is
 * replaced by its bound (`any` when it has none): the widest type of a
 * parameter and of the result. */
function callableOf(signature: FunctionSignature): Callable {
  let s = signature;
  if (signature.typeParams !== undefined) {
    const { typeParams, ...rest } = signature;
    const bindings: Record<string, Type> = {};
    for (const p of typeParams)
      bindings[p.name] = p.bound ?? (p.kind === 'value' ? 'integer' : 'any');
    s = substituteTypeVariables(rest, bindings) as FunctionSignature;
  }
  const params: (Type | undefined)[] = [
    ...(s.args ?? []),
    ...(s.optArgs ?? []),
  ].map((e) => e.type);
  if (s.variadicArg !== undefined) params.push(s.variadicArg.type);
  return {
    params,
    required:
      (s.args?.length ?? 0) +
      (s.variadicArg !== undefined && s.variadicMin === 1 ? 1 : 0),
    rest: s.variadicArg !== undefined,
    result: s.result,
    effects: s.effects ?? [],
  };
}

/** A `function` of the source as a `Callable`. A parameter or a result with
 * no type, or with a type that the engine does not know, is not known; so
 * is the element of a rest parameter, and so are the effects when the
 * definition does not declare them (`function f(x) random -> real`). */
function sourceCallable(
  ce: ComputeEngine,
  declaration: Extract<Declaration, { kind: 'function' }>,
  text: string,
  typeNames: ReadonlySet<string>
): Callable {
  const { params, result } = functionSignatureParts(
    ce,
    declaration,
    text,
    typeNames
  );
  const types = params.map((p, i) =>
    p === undefined || (declaration.rest && i === params.length - 1)
      ? undefined
      : parseTypeString(ce, p)
  );
  return {
    params: types,
    required: params.filter(
      (_, i) =>
        !declaration.optional[i] &&
        !(declaration.rest && i === params.length - 1)
    ).length,
    rest: declaration.rest,
    result: result === undefined ? undefined : parseTypeString(ce, result),
    effects: fullSignature(ce, declaration, text, typeNames)?.effects ?? null,
  };
}

/** A parameter of a call, for a snippet: its name and its type, when they
 * are known. */
type Parameter = { name?: string; type?: string };

/** The characters that a snippet holds only in its field syntax, and the
 * line breaks. */
const SNIPPET_UNSAFE = /[{}$#\\\n\r\u2028\u2029]/;

/** The snippet of a call of `spelling` with the `required` parameters:
 * `undefined` when there is none. The default text of a field is the name of
 * the parameter, else its type, else `arg<n>`: a text that holds a
 * character of `SNIPPET_UNSAFE` is skipped. */
function callSnippet(
  spelling: string,
  required: readonly Parameter[]
): string | undefined {
  if (required.length === 0 || SNIPPET_UNSAFE.test(spelling)) return undefined;
  const safe = (text: string | undefined): text is string =>
    text !== undefined && text !== '' && !SNIPPET_UNSAFE.test(text);
  const fields = required.map(({ name, type }, i) => {
    const label = safe(name) ? name : safe(type) ? type : `arg${i + 1}`;
    return `\${${i + 1}:${label}}`;
  });
  return `${spelling}(${fields.join(', ')})\${0}`;
}

/** The required parameters of a signature. */
function parametersOf(signature: FunctionSignature): Parameter[] {
  return (signature.args ?? []).map((e) => ({
    ...(e.name === undefined ? {} : { name: e.name }),
    type: typeToString(e.type),
  }));
}

/** The required parameters of a library function, from its first signature.
 * An overload set whose signatures differ in the number of required
 * parameters has no single call to insert: `undefined`. The count agrees
 * after `|>` too then, since each signature loses the same first argument. */
function libraryParameters(entry: LibraryEntry): Parameter[] | undefined {
  const arms = entry.arms;
  if (arms === undefined || arms.length === 0) return undefined;
  const count = arms[0].args?.length ?? 0;
  if (arms.some((arm) => (arm.args?.length ?? 0) !== count)) return undefined;
  return parametersOf(arms[0]);
}

/** The required parameters of a `function` of the source: not those with a
 * default value, nor the rest parameter. A function defined several times
 * (clauses or overloads) has them from its first definition, and
 * `undefined` when its definitions differ in the number of required
 * parameters (as `libraryParameters`). */
function sourceParameters(
  ce: ComputeEngine,
  group: BindingGroup,
  declarations: ReadonlyMap<number, Declaration>,
  text: string,
  typeNames: ReadonlySet<string>
): Parameter[] | undefined {
  let first: Parameter[] | undefined;
  for (const occurrence of group.occurrences) {
    if (occurrence.role !== 'definition') continue;
    const declaration = declarations.get(occurrence.start);
    if (declaration?.kind !== 'function') continue;
    const { params } = functionSignatureParts(ce, declaration, text, typeNames);
    const required: Parameter[] = [];
    params.forEach((type, i) => {
      if (declaration.optional[i]) return;
      if (declaration.rest && i === params.length - 1) return;
      const name = declaration.names[i];
      required.push({
        ...(name === undefined ? {} : { name }),
        ...(type === undefined ? {} : { type }),
      });
    });
    if (first === undefined) first = required;
    else if (required.length !== first.length) return undefined;
  }
  return first;
}

/** The parameters of the constructor of a variant: the elements of its
 * payload tuple, with their names when the declaration gives them
 * (`circle(r: real)`). `undefined` for a variant known only from the
 * options, whose payload is not known, or a payload that does not parse. */
function payloadParameters(
  context: Context,
  payload: readonly string[] | undefined
): Parameter[] | undefined {
  if (payload === undefined) return undefined;
  const parameters: Parameter[] = [];
  for (const text of payload) {
    const type = parseSourceType(context.ce, text, context.typeNames);
    if (type === undefined) return undefined;
    if (typeof type === 'object' && type.kind === 'tuple')
      for (const element of type.elements)
        parameters.push({
          ...(element.name === undefined ? {} : { name: element.name }),
          type: typeToString(element.type),
        });
    else parameters.push({ type: text });
  }
  return parameters;
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

/** What an editor shows for a declaration of the source (`detail`): the
 * declared type of a variable or of a parameter, the type of the literal
 * value of a variable with no type (`let a = 5` is `number`, `const a = 5`
 * is `integer`, see `literalTypeText`), the signature of a `function`
 * (`(real, integer?) -> real`), the body of a `type`. `type` is the type of
 * a use of the name, when the declaration gives it: the declared or literal
 * type of a value, the result type of a function. `text` is the source that
 * the declaration was parsed from, and `typeNames` are the types of the
 * source and of the `typeNames` option (see `functionSignatureParts`). */
export function declarationDetail(
  ce: ComputeEngine,
  declaration: Declaration | undefined,
  text: string,
  typeNames: ReadonlySet<string>
): { detail?: string; type?: string } {
  if (declaration?.kind === 'value')
    return { detail: declaration.type, type: declaration.type };
  if (declaration?.kind === 'literal') {
    const type = literalTypeText(ce, declaration.value, declaration.constant);
    return type === undefined ? {} : { detail: type, type };
  }
  if (declaration?.kind === 'function') {
    const { params, tail, result } = functionSignatureParts(
      ce,
      declaration,
      text,
      typeNames
    );
    const detail = `(${params
      .map((p, i) => (p ?? 'any') + (declaration.optional[i] ? '?' : ''))
      .join(', ')})${tail}`;
    return { detail, ...(result === undefined ? {} : { type: result }) };
  }
  if (declaration?.kind === 'type') return { detail: declaration.detail };
  return {};
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
 * literal value of a `let` with no type, the parameter and result types of a
 * `function`, the body of a `type`. */
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
      else if (head === 'Declare') {
        // `let a = 5`: the attributes of the declaration hold its value.
        const attribute = (key: string) =>
          operand(
            operands(operand(node, 2)).find(
              (kv) =>
                operator(kv) === 'KeyValuePair' &&
                symbol(operand(kv, 1)) === key
            ) ?? null,
            2
          );
        const value = attribute('value');
        if (operator(operand(node, 2)) === 'Dictionary' && isLiteral(value))
          record(operand(node, 1), {
            kind: 'literal',
            value: value!,
            constant: symbol(attribute('constant')) === 'True',
          });
      }
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
    let arms: readonly FunctionSignature[] | undefined;
    let union = false;
    if (isFunction) {
      const signature = ce.operatorInfo(name)?.signature?.type;
      arms = signatureArms(signature);
      union = typeof signature === 'object' && signature.kind === 'union';
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
      ...(arms === undefined ? {} : { arms }),
      ...(union ? { union } : {}),
      ...(isFunction && isBroadcastable(ce, name)
        ? { broadcastable: true }
        : {}),
    });
  }
  LIBRARY_ENTRIES.set(ce, entries);
  return entries;
}
