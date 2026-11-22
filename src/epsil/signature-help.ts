import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import type {
  FunctionSignature,
  NamedElement,
  Type,
} from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';

import {
  operand,
  operator,
  operands,
  stringValue,
  symbol,
} from '../math-json/utils.js';

import {
  collectDeclarations,
  contextAt,
  declarationOf,
  functionSignatureParts,
  insideLiteralOrComment,
  isFunctionHeader,
  memberCallee,
  parseSourceType,
  parseWithHole,
  pipedTopicSlots,
  slotOfOperand,
  spanOf,
  unfoldSourceAliases,
  wordAt,
  type Context,
  type Declaration,
  type SourceType,
} from './completion.js';
import { describeName } from './describe-name.js';
import { tokenize } from './lexer.js';
import { canonicalLibraryName, epsilNameOf } from './library-names.js';
import type { BindingGroup } from './occurrences.js';
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
  /** Present when a call can leave the parameter out: an optional parameter
   * of a signature (`axis1: integer?` in `transpose`), or a parameter of the
   * source with a default value. */
  optional?: true;
  /** Present when the parameter takes the remaining arguments: the variadic
   * parameter of a signature (`tuple*` in `sum`, `collection<T>+` in
   * `map`), or a rest parameter of the source (`...rest`). */
  rest?: true;
  /** Present when the call fills the parameter with a value that is not
   * written between its parentheses: `'pipe'` for the left side of `|>`
   * (`xs |> take(` fills `xs`, `xs |> map(` fills the collection), in the
   * slot that the `Pipe` handler gives it, and absent when that slot is not
   * known; `'receiver'` for the value before the `.` of a member call
   * (`c.scale(` fills `self`). */
  implicit?: 'pipe' | 'receiver';
};

/** One signature of the callee. */
export type EpsilSignature = {
  /** The callee and its parameters: `f(x: real, n: integer?) -> real`. */
  label: string;
  parameters: EpsilSignatureParameter[];
  /** The first line of the library description, for a library function. */
  documentation?: string;
  /** The index of the active parameter in this signature, or -1 when the
   * argument at the offset matches none of its parameters. The signatures
   * of an overload set can differ: in `slice(s, 1, ▮`, the signature
   * `slice(value, start, end)` has the active parameter 2, and
   * `slice(value, span)` has none. */
  activeParameter: number;
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
   * the argument at the offset matches none of its parameters: the
   * `activeParameter` of `signatures[activeSignature]`. */
  activeParameter: number;
};

/** A signature with what selects its active parameter. */
type Candidate = Omit<EpsilSignature, 'activeParameter'> & {
  /** Whether the last parameter takes all the remaining arguments. */
  rest: boolean;
  /** The parameter that the call fills with an implicit argument (the
   * piped value, the receiver), which no written argument binds; `'none'`
   * when the piped value fits no parameter, so the signature cannot be the
   * one called. */
  implicit?: number | 'none';
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
 * A member call (`c.scale(▮`) has the signature of the member as member
 * completion resolves it: a protocol function, whose first parameter the
 * receiver fills (`implicit: 'receiver'`), or a field that holds a
 * function. A member that is not one function, or a receiver of unknown
 * type, gives `null`: a library function is not a member (`xs.take(▮`,
 * `dot-call-not-a-protocol-function`). After `|>` (`xs |> take(▮`), the
 * parameter that the piped value fills is marked `implicit: 'pipe'` in each
 * signature where its slot is known (the slot of the completion snippets);
 * a signature where the piped value fits no parameter has no active
 * parameter.
 *
 * The active parameter is the parameter of the argument at the offset: the
 * argument index (the commas at the depth of the call before the offset),
 * past the parameter of the piped value or of the receiver, or for a named
 * argument (`f(n: ▮)`) the parameter of that name. A rest or variadic
 * parameter stays active for every argument after its position. An argument
 * past the last parameter, or a name that no parameter has, gives `-1`.
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
  const { head, headStart, std, member, index, label } = call;

  const { text, placeholder, ast } = parseWithHole(source, start, end, options);
  // The names visible at the callee: a name bound between the callee and
  // the offset (a lambda parameter) does not shadow it.
  const context = contextAt(ce, ast, text, placeholder, headStart, options);
  const candidates = member
    ? memberSignaturesOf(context, head, headStart)
    : signaturesOf(
        ce,
        head,
        // A `std::` call is always a library function.
        std ? undefined : context.visible.get(head),
        ast,
        text,
        context.typeNames,
        context.sourceTypes
      );
  if (candidates === undefined || candidates.length === 0) return null;
  if (!member && !(std && context.visible.has(head)))
    markPipedTopic(
      context,
      candidates,
      head,
      headStart,
      index,
      // A `_` under the offset places the piped value (`xs |> take(_▮`).
      source.slice(start, end) === '_' ? placeholder : undefined
    );

  const active = candidates.map((c) => activeParameterOf(c, index, label));
  const activeSignature = Math.max(
    0,
    active.findIndex((i) => i >= 0)
  );
  return {
    callee: candidates.callee,
    signatures: candidates.map(
      ({ rest: _rest, implicit: _, ...signature }, i) => ({
        ...signature,
        activeParameter: active[i],
      })
    ),
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
  const { parameters, rest, implicit } = candidate;
  if (implicit === 'none') return -1;
  if (label !== undefined) return parameters.findIndex((p) => p.name === label);
  // The written arguments skip the parameter of the implicit argument.
  const slot = slotOfOperand(index, implicit);
  if (slot < parameters.length) return slot;
  return rest ? parameters.length - 1 : -1;
}

/**
 * Mark the parameter that the left side of `|>` fills in each signature,
 * when the call written at `headStart` is the right side of a `Pipe` that
 * takes the piped value as an implicit argument: the slot of the completion
 * snippets (`pipedTopicSlots`). A signature whose slot is not known is not
 * marked; one with no slot for the piped value cannot be the call's.
 * `underscore` is the placeholder of the hole when the hole replaced a
 * `_`, which places the piped value: the call then has no implicit
 * argument.
 */
function markPipedTopic(
  context: Context,
  candidates: Candidate[],
  head: string,
  headStart: number,
  index: number,
  underscore: string | undefined
): void {
  const found = innermostNode(
    context.ast,
    (node) => operator(node) === head && spanOf(node)?.[0] === headStart
  );
  if (found?.parent === undefined) return;
  const { node, parent, index: position } = found;
  if (operator(parent) !== 'Pipe' || position !== 1) return;
  if (underscore !== undefined && symbol(operands(node)[index]) === underscore)
    return;
  const slots = pipedTopicSlots(
    context,
    operand(parent, 1),
    node,
    index < operands(node).length ? index : undefined
  );
  if (slots === undefined || slots.length !== candidates.length) return;
  candidates.forEach((candidate, i) => {
    const slot = slots[i];
    if (slot === null) return;
    candidate.implicit = slot;
    if (slot !== 'none')
      candidate.parameters[slot] = {
        ...candidate.parameters[slot],
        implicit: 'pipe',
      };
  });
}

/**
 * The signatures of the member call `receiver.head(…)` whose member name is
 * at `headStart`, as member completion resolves the member
 * (`memberCallee`): the signature of a protocol function, its first
 * parameter filled by the receiver, or the signatures of a field that holds
 * a function. `undefined` when the member is not one function.
 */
function memberSignaturesOf(
  context: Context,
  head: string,
  headStart: number
): (Candidate[] & { callee: string }) | undefined {
  const found = innermostNode(context.ast, (node) => {
    const span = spanOf(node);
    return (
      operator(node) === 'MemberCall' &&
      stringValue(operand(node, 2)) === head &&
      span !== undefined &&
      span[0] < headStart &&
      headStart <= span[1]
    );
  });
  if (found === undefined) return undefined;
  const callee = memberCallee(context, operand(found.node, 1), head);
  if (callee === undefined) return undefined;
  const name = escapeSymbol(head);
  if (callee.kind === 'field')
    return Object.assign(signaturesOfType(name, callee.type), {
      callee: head,
    });
  const candidates = signaturesOfType(name, callee.signature);
  for (const candidate of candidates) {
    if (candidate.parameters.length === 0) return undefined;
    candidate.implicit = 0;
    candidate.parameters[0] = {
      ...candidate.parameters[0],
      implicit: 'receiver',
    };
  }
  return Object.assign(candidates, { callee: head });
}

/** The deepest node of `ast` that passes `test`, with its parent and its
 * index among the operands of its parent. */
function innermostNode(
  ast: MathJsonExpression | null,
  test: (node: MathJsonExpression) => boolean
):
  | { node: MathJsonExpression; parent?: MathJsonExpression; index: number }
  | undefined {
  let found:
    | { node: MathJsonExpression; parent?: MathJsonExpression; index: number }
    | undefined;
  let depth = -1;
  const visit = (
    node: MathJsonExpression,
    parent: MathJsonExpression | undefined,
    index: number,
    d: number
  ) => {
    if (d > depth && test(node)) {
      found = { node, ...(parent === undefined ? {} : { parent }), index };
      depth = d;
    }
    operands(node).forEach((op, i) => visit(op, node, i, d + 1));
  };
  if (ast !== null) visit(ast, undefined, -1, 0);
  return found;
}

/** The innermost call written `name(…)` whose arguments contain `start`:
 * its callee, the offset of the callee, whether it is qualified by `std::`,
 * the index of the argument at `start` (the commas at the depth of the call
 * before `start`) and the label of that argument when it is a named argument
 * (`f(n: ▮)`, also `f(n▮: 2)`). A member call (`xs.f(…)`) is such a call,
 * with `member` set. A bracket that is not such a call (a group, a list, a
 * block, `(f)(x)`, `g(1)(x)`, `f (x)`, the parameters of a `function`
 * header, a keyword) is skipped with its commas. */
function callAt(
  tokens: readonly Token[],
  start: number
):
  | {
      head: string;
      headStart: number;
      std: boolean;
      member: boolean;
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

/** The name written before the `(` at `paren`, its offset, whether it is
 * qualified by `std::` and whether it is the member of a member call
 * (`xs.f(`), when the bracket is the argument list of a call of that name.
 * As in the parser, the `(` of a call follows the name with no whitespace. */
function calleeOf(
  tokens: readonly Token[],
  paren: number
):
  | { head: string; headStart: number; std: boolean; member: boolean }
  | undefined {
  const token = tokens[paren - 1];
  if (
    token === undefined ||
    tokens[paren].precededByWhitespace ||
    isFunctionHeader(tokens, paren)
  )
    return undefined;
  const before = tokens[paren - 2];
  let head: string | undefined;
  if (token.type === 'VERBATIM_SYMBOL') head = token.value;
  else if (token.type === 'SYMBOL' && !HARD_RESERVED_WORDS.has(token.text))
    head = token.text;
  if (head === undefined) return undefined;
  const member = before?.type === 'OPERATOR' && before.text === '.';
  if (before?.type !== 'OPERATOR' || before.text !== '::')
    return { head, headStart: token.start, std: false, member };
  // A qualified name: `std` is the only module.
  const module = tokens[paren - 3];
  return module?.type === 'SYMBOL' && module.text === 'std'
    ? { head, headStart: token.start, std: true, member: false }
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
      const type = unfoldSourceAliases(
        ce,
        parseSourceType(ce, declaration.type, typeNames),
        sourceTypes,
        typeNames
      );
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
      ...(declaration.rest && i === declaration.params.length - 1
        ? { rest: true as const }
        : declaration.optional[i]
          ? { optional: true as const }
          : {}),
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
        ...(element === type.variadicArg
          ? { rest: true as const }
          : i >= (type.args?.length ?? 0)
            ? { optional: true as const }
            : {}),
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
