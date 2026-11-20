import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator } from '../math-json/utils.js';

import {
  collectDeclarations,
  collectSourceTypes,
  declarationDetail,
  declarationOf,
} from './completion.js';
import { definitionSitesByOffset } from './definition-sites.js';
import {
  describeLibraryName,
  describeName,
  type DocEntry,
} from './describe-name.js';
import { tokenize } from './lexer.js';
import { canonicalLibraryName } from './library-names.js';
import {
  documentBindings,
  protocolFunctionMembers,
  type BindingGroup,
  type ProtocolFunctionMember,
} from './occurrences.js';
import { parseEpsil } from './parse-epsil.js';
import { HARD_RESERVED_WORDS } from './reserved-words.js';
import { binderSitesOf } from './resolve-library-names.js';
import type { SourceSpan, Token } from './tokens.js';

//
// What the name at an offset of an Epsil source is (`epsilHover`) and where
// the source declares it (`epsilDefinition`), for an editor.
//
// The name comes from the tokens, so that a word in a string or in a comment
// is not a name. Its meaning comes from the scope model that gives the names
// their meaning before a program runs (`documentBindings()` with the binder
// sites of `resolveLibraryNames()`): a name that the source binds is that
// binding, also when it shadows a library name, and a free name is read as
// the library-name resolution pass reads it.
//

/** What the name at an offset of an Epsil source is. */
export type EpsilHover = {
  /** The offsets of the name under the offset. A verbatim name
   * (`` `while` ``) includes its backticks. */
  range: [start: number, end: number];
  /** The name as written, without the backticks of a verbatim name. */
  name: string;
  /** `library-function` and `library-constant` for a name of the standard
   * library; `function`, `variable` and `type` for a name that the source
   * declares, or that the engine defines outside the standard library. */
  kind:
    | 'library-function'
    | 'library-constant'
    | 'function'
    | 'variable'
    | 'type'
    | 'keyword';
  /** A signature (`(real, integer?) -> real`), a type, or the body of a
   * `type` declaration, as in a completion item. */
  detail?: string;
  /** The paragraphs of the library description, or the doc comment of a
   * `function` of the source as one paragraph. */
  description?: string[];
  /** The address of the entry of a standard-library name in the library
   * reference. */
  reference?: string;
};

/** Where an Epsil source declares a name. */
export type EpsilDefinition = {
  /** The offsets of the name in its declaration. */
  name: [start: number, end: number];
  /** The offsets of the text that shows the declaration: the header of a
   * `function` (up to its body), the statement of a `let`, a `const`, a
   * first assignment or a `type`, the `x in xs` clause of a loop variable.
   * For a parameter and for a variable of a `match` pattern, the name. */
  header: [start: number, end: number];
};

/** The options of `parseEpsil()` that the editor functions take. */
type SourceOptions = {
  typeNames?: readonly string[];
  protocolNames?: readonly string[];
  sumVariants?: Readonly<Record<string, string>>;
};

/** The contextual words that head a statement, with the operators of the
 * statements they head. Each is an ordinary name elsewhere (`let type = 5`). */
const CONTEXTUAL_HEADS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['let', new Set(['Declare'])],
  [
    'type',
    new Set(['DeclareType', 'DeclareSumType', 'DeclareConformance']),
  ],
  ['parallel', new Set(['ParallelLoop', 'ParallelComprehension'])],
]);

/** How many levels of interpolation holes (a string in a hole of a string)
 * are read as code. The parser stops an expression at 256 levels of nesting
 * (`expression-nesting-limit`), and each hole is at least one level, so a
 * deeper hole holds no parsed name. The limit also bounds the recursion on a
 * source built to nest deeper. */
const MAX_HOLE_NESTING = 256;

/** The name at an offset of a source, and what the source says about it. */
type NameAt = {
  range: [number, number];
  /** The name that the parser reads: `Pi` for `π`, `while` for
   * `` `while` ``. */
  name: string;
  written: string;
  verbatim: boolean;
  /** The name follows `std::`: it names the standard library, whatever the
   * source or the engine binds. */
  qualified: boolean;
  ast: MathJsonExpression | null;
  /** The binding of the occurrence at the name, when the name is an
   * occurrence: a `free` group for a name that the source does not bind. A
   * type name of the engine, a field name, a field label in a type, a
   * keyword and a name in a statement that the parser drops are not
   * occurrences. */
  group: BindingGroup | undefined;
  members: ReadonlyMap<string, ProtocolFunctionMember>;
};

/**
 * What the name at `offset` of `source` is, or `null` when the offset is not
 * on a name that the function can describe.
 *
 * The name is the name token that contains the offset or ends at it. A name
 * that the source binds at that place (a `function`, a `let`, a parameter, a
 * loop or pattern variable, a `type`, the variable of a library call such as
 * the `k` of `sum(k^2, k, 1, 3)`) is described from its declaration, also
 * when it shadows a library name: its `detail` is the detail of its
 * completion item, and its `description` is the doc comment of a `function`.
 * Any other name is read as the program reads it when it runs: the definition
 * of the engine under the written name (a name that an earlier program
 * declared), a function member of a `protocol` of the source, or the
 * standard-library name that the spelling stands for (`sin` for `Sin`), with
 * the entry that `epsil doc` prints. A variant of a sum type of the source is
 * a `function`.
 *
 * A reserved word, and `let`, `type` or `parallel` at the head of its
 * statement, is a `keyword`.
 *
 * A name that follows `std::` is the standard library's, whatever the source
 * or the engine binds, and `null` when the standard library does not define
 * it (``std::`pi` `` names the raw symbol `pi`).
 *
 * The result is `null` in the text of a string (a name in an interpolation
 * hole, `"\(x + 1)"`, is code), in a LaTeX island or in a comment, on a name
 * that nothing defines, and on a name that is not a use of a binding: a type
 * name of the engine (`real`), a field name after `.`, a field label in a
 * type (`tuple<x: real>`), the label of a named argument of a library
 * function. The label of a named argument of a function of the source is
 * the parameter. A name in a statement that the parser drops gives `null`
 * too.
 *
 * The source is parsed and not evaluated. The options are those of
 * `epsilCompletions()`.
 */
export function epsilHover(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options?: SourceOptions
): EpsilHover | null {
  const at = nameAt(ce, source, offset, options);
  if (at === undefined) return null;
  const { range, written, group, ast } = at;

  if (group !== undefined && group.kind !== 'free') {
    const sourceTypes = collectSourceTypes(ast, options?.sumVariants);
    const { detail } = declarationDetail(
      ce,
      declarationOf(group, collectDeclarations(ast)),
      source,
      new Set([...(options?.typeNames ?? []), ...sourceTypes.keys()])
    );
    const definition = group.occurrences.find((o) => o.role === 'definition');
    const description =
      definition === undefined || ast === null
        ? undefined
        : definitionSitesByOffset(ast).get(definition.start)?.description;
    return {
      range,
      name: written,
      kind:
        group.kind === 'function'
          ? 'function'
          : group.kind === 'type'
            ? 'type'
            : 'variable',
      ...(detail === undefined ? {} : { detail }),
      ...(description === undefined ? {} : { description: [description] }),
    };
  }

  if (group === undefined && !at.qualified)
    return isKeyword(at) ? { range, name: written, kind: 'keyword' } : null;

  return engineHover(ce, at, options);
}

/**
 * Where `source` declares the name at `offset`, or `null`.
 *
 * The name is resolved in its scope, as `epsilHover()` resolves it: a use of
 * a parameter that shadows a variable of the same name gives the parameter.
 * A `function` with several clauses gives its first clause. The result is
 * `null` when the source does not declare the name at that place: a library
 * name, a name that only the engine defines, a keyword, an unknown name, the
 * variable of a library call (`sum(k^2, k, 1, 3)` has no declaration of
 * `k`), and an offset that is not on a name.
 *
 * The source is parsed and not evaluated. The options are those of
 * `epsilCompletions()`.
 */
export function epsilDefinition(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options?: SourceOptions
): EpsilDefinition | null {
  const at = nameAt(ce, source, offset, options);
  if (at === undefined || at.ast === null) return null;
  const { group } = at;
  if (group === undefined || group.kind === 'free') return null;
  const definition = group.occurrences.find((o) => o.role === 'definition');
  if (definition === undefined) return null;
  const site = definitionSitesByOffset(at.ast).get(definition.start);
  if (site !== undefined) return { name: site.name, header: site.header };
  // A parameter, a loop or pattern variable, a name of a destructuring
  // `let` and a `type` have no site of their own: the scope model gives the
  // name, and the span of the declaring construct when it records one.
  const name: [number, number] = [definition.start, definition.end];
  return { name, header: group.declaration ?? name };
}

/** The name token at `offset` of `source` and its binding, or `undefined`
 * when the offset is not on a name token. */
function nameAt(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options: SourceOptions | undefined
): NameAt | undefined {
  offset = Math.max(0, Math.min(offset, source.length));
  const tokens = codeTokens(source, 0, source.length);
  const index = nameTokenAt(tokens, offset);
  if (index < 0) return undefined;
  const token = tokens[index];
  const verbatim = token.type === 'VERBATIM_SYMBOL';
  const name = token.value ?? token.text;
  const text = source.slice(token.start, token.end);

  let ast: MathJsonExpression | null = null;
  try {
    [ast] = parseEpsil(source, undefined, {
      typeNames: options?.typeNames,
      protocolNames: options?.protocolNames,
      sumVariants: options?.sumVariants,
    });
  } catch {
    // A `#error` pragma throws: no tree, so no name of the source.
  }
  const members: ReadonlyMap<string, ProtocolFunctionMember> =
    ast === null ? new Map() : protocolFunctionMembers(ast);
  // The scope model of the library-name resolution pass: a variable that a
  // library call binds (`sum(k^2, k, 1, 3)`) is a binding of that call.
  const groups = documentBindings(ast, source, {
    binderSites: (node, isBound, declaration) =>
      binderSitesOf(ce, node, source, members, isBound, declaration),
  });
  const group = groups.find(
    (g) =>
      g.name === name && g.occurrences.some((o) => o.start === token.start)
  );

  const scope = tokens[index - 1];
  const module = tokens[index - 2];
  return {
    range: [token.start, token.end],
    name,
    written:
      verbatim && text.length >= 2 && text.endsWith('`')
        ? text.slice(1, -1)
        : verbatim
          ? text.slice(1)
          : text,
    verbatim,
    qualified:
      scope?.type === 'OPERATOR' &&
      scope.text === '::' &&
      module?.type === 'SYMBOL' &&
      module.text === 'std',
    ast,
    group,
    members,
  };
}

/** The tokens of `source` between `from` and `to`, in source order and with
 * offsets of `source`. A string with interpolation holes (`"\(x + 1)"`) is
 * replaced by the tokens of its holes: a hole is code, and the parser reads
 * it from the same span. */
function codeTokens(
  source: string,
  from: number,
  to: number,
  depth = 0
): Token[] {
  const result: Token[] = [];
  for (const token of tokenize(source.slice(from, to))) {
    if (token.type === 'EOF') continue;
    // A string in a hole of a string, and so on: past the limit, the string
    // is kept whole, and a name in it is not a name.
    const holes = (
      token.type === 'STRING' && depth < MAX_HOLE_NESTING
        ? (token.parts ?? [])
        : []
    ).filter((part): part is SourceSpan => typeof part !== 'string');
    if (holes.length === 0)
      result.push({
        ...token,
        start: token.start + from,
        end: token.end + from,
      });
    for (const hole of holes)
      result.push(
        ...codeTokens(source, from + hole.start, from + hole.end, depth + 1)
      );
  }
  return result;
}

/** The index of the name token that contains `offset` or ends at it, or -1.
 * Of two names that touch, the one that starts at the offset. */
function nameTokenAt(tokens: readonly Token[], offset: number): number {
  let found = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.start > offset) break;
    if (offset > token.end) continue;
    if (token.type !== 'SYMBOL' && token.type !== 'VERBATIM_SYMBOL') continue;
    found = i;
    if (offset < token.end) break;
  }
  return found;
}

/** Whether a name that is not an occurrence is a keyword: a reserved word
 * (a plain name cannot spell one), or a contextual word at the start of the
 * statement that it heads. */
function isKeyword(at: NameAt): boolean {
  if (at.verbatim) return false;
  if (HARD_RESERVED_WORDS.has(at.written)) return true;
  const heads = CONTEXTUAL_HEADS.get(at.written);
  return heads !== undefined && startsNode(at.ast, at.range[0], heads);
}

/** Whether a node of `ast` whose operator is one of `heads` starts at
 * `start`. */
function startsNode(
  ast: MathJsonExpression | null,
  start: number,
  heads: ReadonlySet<string>
): boolean {
  if (ast === null) return false;
  const head = operator(ast);
  if (head === '') return false;
  const span =
    typeof ast === 'object' && !Array.isArray(ast)
      ? (ast as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined;
  if (span?.[0] === start && heads.has(head)) return true;
  // Every operand is visited: the span of a node does not always contain
  // the spans of its operands (the return type of a function is written
  // before the body that the `Typed` node spans).
  return operands(ast).some((op) => startsNode(op, start, heads));
}

/** The hover of a name that the source does not bind, or of a qualified
 * name (`std::sin`). */
function engineHover(
  ce: ComputeEngine,
  at: NameAt,
  options: SourceOptions | undefined
): EpsilHover | null {
  const { range, name, written } = at;
  const system = ce.contextStack[0]?.lexicalScope.bindings;

  // A qualified name is the standard library's definition, whatever the
  // engine binds: of the written name when the system scope defines it or
  // the name is verbatim, or else of the library name of the spelling. A
  // name that the system scope does not define is the error
  // `not-a-library-name` when the program runs.
  if (at.qualified) {
    const entry = describeLibraryName(
      ce,
      at.verbatim || system?.has(name)
        ? name
        : (canonicalLibraryName(name) ?? name)
    );
    return entry === undefined ? null : entryHover(at, entry, true);
  }

  // The name that the engine reads, by the rules of the library-name
  // resolution pass (`resolveLibraryNames()`): the engine's definition under
  // the written name, or else, unless the name is verbatim, the library name
  // of the spelling.
  let id: string | undefined;
  if (ce.lookupDefinition(name) !== undefined) id = name;
  else if (!at.verbatim) {
    // A function member of a protocol declared above the name shadows the
    // spelling: the call reaches the dispatcher of the member.
    const member = at.members.get(name);
    if (member !== undefined && range[0] >= member.from)
      return {
        range,
        name: written,
        kind: 'function',
        detail: member.declarations[0].signature,
      };
    id = canonicalLibraryName(name);
  }

  const entry = id === undefined ? undefined : describeName(ce, id);
  if (entry === undefined) {
    // A constructor of a sum type of the source, as in its completion item.
    for (const [sum, declared] of collectSourceTypes(
      at.ast,
      options?.sumVariants
    )) {
      if (declared.kind !== 'sum') continue;
      const variant = declared.variants.find((v) => v.name === name);
      if (variant === undefined) continue;
      return {
        range,
        name: written,
        kind: 'function',
        detail:
          variant.payload === undefined
            ? sum
            : `(${variant.payload.join(', ')}) -> ${sum}`,
      };
    }
    return null;
  }

  // The definition is the standard library's unless a binding of the engine
  // shadows it (`describeName()` then describes that binding).
  const definition = system?.get(entry.id);
  return entryHover(
    at,
    entry,
    definition !== undefined && definition === ce.lookupDefinition(entry.id)
  );
}

/** The hover of a name that a documentation entry describes. `isLibrary`
 * says that the entry is of the standard library's definition. */
function entryHover(
  at: NameAt,
  entry: DocEntry,
  isLibrary: boolean
): EpsilHover {
  const isFunction = entry.kind === 'function' || entry.kind === 'opaque';
  const detail = entry.signature ?? entry.type;
  return {
    range: at.range,
    name: at.written,
    kind: isLibrary
      ? isFunction
        ? 'library-function'
        : 'library-constant'
      : isFunction
        ? 'function'
        : 'variable',
    ...(detail === undefined ? {} : { detail }),
    ...(entry.description === undefined
      ? {}
      : { description: entry.description }),
    ...(entry.reference === undefined ? {} : { reference: entry.reference }),
  };
}
