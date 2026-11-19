import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import type {
  FunctionSignature,
  NamedElement,
  Type,
} from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';

import {
  collectDeclarations,
  collectSourceTypes,
  declarationOf,
  functionSignatureParts,
  insideLiteralOrComment,
  isFunctionHeader,
  parseSourceType,
  parseWithHole,
  visibleBindings,
  wordAt,
  type Declaration,
  type SourceType,
} from './completion.js';
import { describeName } from './describe-name.js';
import { tokenize } from './lexer.js';
import { canonicalLibraryName, epsilNameOf } from './library-names.js';
import { documentBindings, type BindingGroup } from './occurrences.js';
import { HARD_RESERVED_WORDS } from './reserved-words.js';
import { escapeSymbol } from './serialize-epsil.js';
import type { Token } from './tokens.js';

//
// Signature help at an offset of an Epsil source.
//
// The call comes from the tokens: the innermost unmatched `(` before the
// word under the offset that follows a name, and the commas between them
// that are not inside nested brackets. The parse of the source with the
// HOLE of `epsilCompletions()` (the word replaced by a placeholder) resolves
// the callee under the scope rules: the parser's recovery can drop the
// placeholder (`join(1 ▮`, `f(sin(1)▮, 2)`), so its tree does not give the
// call.
//

/** One parameter of a signature. */
export type EpsilSignatureParameter = {
  /** The name of the parameter, when the signature gives one. */
  name?: string;
  /** The type of the parameter: `any` for a parameter of the source with no
   * declared type. */
  type: string;
  /** The offsets of the parameter's text in the `label` of its signature. */
  range: [start: number, end: number];
};

/** One signature of the callee. */
export type EpsilSignature = {
  /** The callee and its parameters: `f(x: real, n: integer?) -> real`. */
  label: string;
  parameters: EpsilSignatureParameter[];
  /** The first line of the library description, for a library function. */
  documentation?: string;
};

/** The signature help at an offset of an Epsil source. */
export type EpsilSignatureHelp = {
  /** The name of the callee: a name of the source, or the Epsil spelling of
   * a library function (`join` for `Join`). */
  callee: string;
  /** One signature per arm of the callee's type: a library function whose
   * signature is an overload set (`join`, `slice`) has several. */
  signatures: EpsilSignature[];
  /** The index of the first signature that has the active parameter, or 0
   * when none has it. */
  activeSignature: number;
  /** The index of the active parameter in the active signature, or -1 when
   * the argument at the offset matches none of its parameters. */
  activeParameter: number;
};

/** A signature with what selects its active parameter. */
type Candidate = EpsilSignature & {
  /** Whether the last parameter takes all the remaining arguments. */
  rest: boolean;
};

/**
 * The signature help at `offset` of `source`, or `null` when the offset is
 * not in the arguments of a call of a name with a known signature.
 *
 * The call is the innermost call `name(…)` whose argument list contains the
 * offset, also when it is not closed (`join(1, ▮`). The callee is the
 * function of the source visible at the offset under the scope rules of
 * `epsilCompletions()`, or else a standard-library function. A callee that
 * is not a name (`(f)(▮`), an unknown name, a variable whose declared type
 * is not a function type and an offset inside a string or a comment give
 * `null`. A function of the source with several clauses has one signature
 * per clause. A type of the source written with type arguments
 * (`(Box<real>) -> real`) in the declared type of a variable does not parse,
 * so that variable gives `null`; in the full signature of a `function`, the
 * signature shows the parameters of the header with no result.
 *
 * The active parameter is the parameter of the argument at the offset: the
 * argument index (the commas at the depth of the call before the offset), or
 * for a named argument (`f(n: ▮)`) the parameter of that name. A rest or
 * variadic parameter stays active for every argument after its position. An
 * argument past the last parameter, or a name that no parameter has, gives
 * `-1`.
 *
 * The options are those of `epsilCompletions()`.
 */
export function epsilSignatureHelp(
  ce: ComputeEngine,
  source: string,
  offset: number,
  options?: {
    typeNames?: readonly string[];
    protocolNames?: readonly string[];
    sumVariants?: Readonly<Record<string, string>>;
  }
): EpsilSignatureHelp | null {
  offset = Math.max(0, Math.min(offset, source.length));
  const [start, end] = wordAt(source, offset);
  const tokens = tokenize(source);
  if (insideLiteralOrComment(source, tokens, start)) return null;

  const call = callAt(tokens, start);
  if (call === undefined) return null;
  const { head, headStart, std, index, label } = call;

  const { text, placeholder, ast } = parseWithHole(source, start, end, options);
  // The binding of the callee at the callee: a name bound between the callee
  // and the offset (a lambda parameter) does not shadow it. A `std::` call
  // is always a library function.
  const group = std
    ? undefined
    : visibleBindings(documentBindings(ast, text), placeholder, headStart).get(
        head
      );
  const sourceTypes = collectSourceTypes(ast, options?.sumVariants);
  const typeNames = new Set([
    ...(options?.typeNames ?? []),
    ...sourceTypes.keys(),
  ]);
  const candidates = signaturesOf(
    ce,
    head,
    group,
    ast,
    text,
    typeNames,
    sourceTypes
  );
  if (candidates === undefined || candidates.length === 0) return null;

  const active = candidates.map((c) => activeParameterOf(c, index, label));
  const activeSignature = Math.max(
    0,
    active.findIndex((i) => i >= 0)
  );
  return {
    callee: candidates.callee,
    signatures: candidates.map(({ rest: _rest, ...signature }) => signature),
    activeSignature,
    activeParameter: active[activeSignature],
  };
}

/** The parameter of the argument `index`, or of the named argument
 * `label`, in a signature. */
function activeParameterOf(
  candidate: Candidate,
  index: number,
  label: string | undefined
): number {
  const { parameters, rest } = candidate;
  if (label !== undefined) return parameters.findIndex((p) => p.name === label);
  if (index < parameters.length) return index;
  return rest ? parameters.length - 1 : -1;
}

/** The innermost call written `name(…)` whose arguments contain `start`:
 * its callee, the offset of the callee, whether it is qualified by `std::`,
 * the index of the argument at `start` (the commas at the depth of the call
 * before `start`) and the label of that argument when it is a named argument
 * (`f(n: ▮)`, also `f(n▮: 2)`). A bracket that is not such a call (a group, a
 * list, a block, `(f)(x)`, `g(1)(x)`, `f (x)`, a member call, the parameters
 * of a `function` header, a keyword) is skipped with its commas. */
function callAt(
  tokens: readonly Token[],
  start: number
):
  | {
      head: string;
      headStart: number;
      std: boolean;
      index: number;
      label?: string;
    }
  | undefined {
  let last = -1;
  while (
    last + 1 < tokens.length &&
    tokens[last + 1].type !== 'EOF' &&
    tokens[last + 1].end <= start
  )
    last += 1;
  let depth = 0;
  let commas = 0;
  let lastComma = -1;
  for (let j = last; j >= 0; j -= 1) {
    const type = tokens[j].type;
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
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      const callee = type === 'OPEN_PAREN' ? calleeOf(tokens, j) : undefined;
      if (callee !== undefined) {
        // The first tokens of the argument: `name :` is a named argument. As
        // in the parser, the name may be verbatim, and the colon may start a
        // merged operator token (`:-` in `f(n:-1)`) other than `:=` and `::`.
        const first = tokens[(lastComma < 0 ? j : lastComma) + 1];
        const colon = tokens[(lastComma < 0 ? j : lastComma) + 2];
        const label =
          (first?.type === 'SYMBOL' || first?.type === 'VERBATIM_SYMBOL') &&
          colon?.type === 'OPERATOR' &&
          colon.text.startsWith(':') &&
          !colon.text.startsWith(':=') &&
          !colon.text.startsWith('::')
            ? first.type === 'VERBATIM_SYMBOL'
              ? (first.value ?? '')
              : first.text
            : undefined;
        return {
          ...callee,
          index: commas,
          ...(label === undefined ? {} : { label }),
        };
      }
      commas = 0;
      lastComma = -1;
    } else if (type === 'COMMA' && depth === 0) {
      if (lastComma < 0) lastComma = j;
      commas += 1;
    }
  }
  return undefined;
}

/** The name written before the `(` at `paren`, its offset, and whether it
 * is qualified by `std::`, when the bracket is the argument list of a call
 * of that name. As in the parser, the `(` of a call follows the name with no
 * whitespace. */
function calleeOf(
  tokens: readonly Token[],
  paren: number
): { head: string; headStart: number; std: boolean } | undefined {
  const token = tokens[paren - 1];
  if (
    token === undefined ||
    tokens[paren].precededByWhitespace ||
    isFunctionHeader(tokens, paren)
  )
    return undefined;
  const before = tokens[paren - 2];
  if (before?.type === 'OPERATOR' && before.text === '.') return undefined;
  let head: string | undefined;
  if (token.type === 'VERBATIM_SYMBOL') head = token.value;
  else if (token.type === 'SYMBOL' && !HARD_RESERVED_WORDS.has(token.text))
    head = token.text;
  if (head === undefined) return undefined;
  if (before?.type !== 'OPERATOR' || before.text !== '::')
    return { head, headStart: token.start, std: false };
  // A qualified name: `std` is the only module.
  const module = tokens[paren - 3];
  return module?.type === 'SYMBOL' && module.text === 'std'
    ? { head, headStart: token.start, std: true }
    : undefined;
}

/** The signatures of the callee `head`: the function of the source that
 * `group` binds, or a library function when no name of the source is
 * visible. */
function signaturesOf(
  ce: ComputeEngine,
  head: string,
  group: BindingGroup | undefined,
  ast: MathJsonExpression | null,
  text: string,
  typeNames: ReadonlySet<string>,
  sourceTypes: ReadonlyMap<string, SourceType>
): (Candidate[] & { callee: string }) | undefined {
  const withCallee = (candidates: Candidate[], callee: string) =>
    Object.assign(candidates, { callee });

  if (group !== undefined) {
    const declarations = collectDeclarations(ast);
    // A function with several clauses: one signature per clause.
    const clauses = group.occurrences
      .filter((o) => o.role === 'definition')
      .map((o) => declarations.get(o.start))
      .filter(
        (d): d is Extract<Declaration, { kind: 'function' }> =>
          d?.kind === 'function'
      );
    if (clauses.length > 0)
      return withCallee(
        clauses.map((declaration) =>
          clauseSignature(ce, head, declaration, text, typeNames)
        ),
        head
      );
    // A variable whose declared type is a function type, or an alias of one.
    const declaration = declarationOf(group, declarations);
    if (declaration?.kind === 'value') {
      let type = parseSourceType(ce, declaration.type, typeNames);
      const seen = new Set<string>();
      while (typeof type === 'object' && type.kind === 'reference') {
        const declared = sourceTypes.get(type.name);
        if (declared?.kind !== 'alias' || seen.has(type.name)) break;
        seen.add(type.name);
        type = parseSourceType(ce, declared.body, typeNames);
      }
      return type === undefined
        ? undefined
        : withCallee(signaturesOfType(escapeSymbol(head), type), head);
    }
    return undefined;
  }

  const name =
    ce.operatorInfo(head) !== undefined ? head : canonicalLibraryName(head);
  const type =
    name === undefined ? undefined : ce.operatorInfo(name)?.signature?.type;
  if (name === undefined || type === undefined) return undefined;
  const spelling = epsilNameOf(name);
  const callee =
    spelling !== undefined && canonicalLibraryName(spelling) === name
      ? spelling
      : name;
  const documentation = describeName(ce, name)
    ?.description?.[0]?.split('\n')[0]
    ?.trim();
  const candidates = signaturesOfType(callee, type);
  if (documentation)
    for (const candidate of candidates) candidate.documentation = documentation;
  return withCallee(candidates, callee);
}

/** The signature of one clause of a `function` of the source. */
function clauseSignature(
  ce: ComputeEngine,
  head: string,
  declaration: Extract<Declaration, { kind: 'function' }>,
  text: string,
  typeNames: ReadonlySet<string>
): Candidate {
  const { params, tail } = functionSignatureParts(
    ce,
    declaration,
    text,
    typeNames
  );
  const texts = params.map((type, i) => {
    const name = declaration.names[i];
    if (declaration.rest && i === declaration.params.length - 1)
      return `...${name ?? ''}`;
    const optional = declaration.optional[i] ? '?' : '';
    if (name === undefined) return `${type ?? 'any'}${optional}`;
    return type === undefined
      ? `${name}${optional}`
      : `${name}: ${type}${optional}`;
  });
  const { label, ranges } = layout(escapeSymbol(head), texts, tail);
  return {
    label,
    parameters: texts.map((_, i) => ({
      ...(declaration.names[i] === undefined
        ? {}
        : { name: declaration.names[i] }),
      type: params[i] ?? 'any',
      range: ranges[i],
    })),
    rest: declaration.rest,
  };
}

/** One signature per arm of a function type: a signature, or an overload
 * set (an intersection of signatures). Another type gives none. */
function signaturesOfType(callee: string, type: Type): Candidate[] {
  if (typeof type !== 'object') return [];
  if (type.kind === 'intersection')
    return type.types.flatMap((t) => signaturesOfType(callee, t));
  if (type.kind !== 'signature') return [];

  const elements: NamedElement[] = [
    ...(type.args ?? []),
    ...(type.optArgs ?? []),
    ...(type.variadicArg === undefined ? [] : [type.variadicArg]),
  ];
  // The text of each parameter, as the type serializer writes it: the
  // serialization of a signature with that one parameter in the same slot.
  const texts = elements.map((element, i) => {
    const slot: Partial<FunctionSignature> =
      i < (type.args?.length ?? 0)
        ? { args: [element] }
        : element === type.variadicArg
          ? { variadicArg: element, variadicMin: type.variadicMin }
          : { optArgs: [element] };
    const one = typeToString({ kind: 'signature', ...slot, result: 'any' });
    return one.slice(1, one.lastIndexOf(') -> any'));
  });
  const full = typeToString(type);
  // The serialization starts with the parameter list, followed by the
  // effects, the result and the `where` clause.
  const list = `(${texts.join(', ')})`;
  const { label, ranges } = layout(
    callee,
    texts,
    full.startsWith(list)
      ? full.slice(list.length)
      : ` -> ${typeToString(type.result)}`
  );
  return [
    {
      label,
      parameters: elements.map((element, i) => ({
        ...(element.name === undefined ? {} : { name: element.name }),
        type: typeToString(element.type),
        range: ranges[i],
      })),
      rest: type.variadicArg !== undefined,
    },
  ];
}

/** The label `callee(p1, p2)rest` and the range of each parameter in it. */
function layout(
  callee: string,
  texts: string[],
  rest: string
): { label: string; ranges: [number, number][] } {
  const ranges: [number, number][] = [];
  let label = `${callee}(`;
  texts.forEach((text, i) => {
    if (i > 0) label += ', ';
    ranges.push([label.length, label.length + text.length]);
    label += text;
  });
  return { label: `${label})${rest}`, ranges };
}
