import { HARD_RESERVED_WORDS } from './reserved-words.js';
import type { Token } from './tokens.js';

//
// The call around an offset, read from the tokens: the signature help
// (`epsilSignatureHelp()`) and the completion of the keys of an options
// dictionary (`epsilCompletions()`) share it.
//

/**
 * The dictionary literal written as the argument at an offset of a call
 * (`plot(s, {grid -> ▮})`), as `epsilSignatureHelp()` reads it: whether the
 * offset is at the key of an entry or in its value, the key of that entry
 * (in the value), and the keys that the literal writes. `undefined` when the
 * offset is not in a dictionary literal that is a whole argument of a call.
 * @internal
 */
export type DictionaryArgument = {
  position: 'key' | 'value';
  key?: string;
  written: string[];
};

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

/** The innermost call written `name(…)` whose arguments contain `start`:
 * its callee, the offset of the callee, whether it is qualified by `std::`,
 * the index of the argument at `start` (the commas at the depth of the call
 * before `start`) and the label of that argument when it is a named argument
 * (`f(n: ▮)`, also `f(n▮: 2)`). A member call (`xs.f(…)`) is such a call,
 * with `member` set. A bracket that is not such a call (a group, a list, a
 * block, `(f)(x)`, `g(1)(x)`, `f (x)`, the parameters of a `function`
 * header, a keyword) is skipped with its commas.
 *
 * When the innermost bracket around `start` is a `{` that starts an
 * argument of the call (`f(1, {a -> 2, ▮`, `f(opts: {▮`), `dictionary` says
 * where `start` is in that literal.
 * @internal */
export function callAt(
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
      dictionary?: DictionaryArgument;
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
  // The innermost `{` around `start`, while no other bracket encloses it.
  let brace: { open: number; lastComma: number } | undefined;
  let innermost = true;
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
        const argumentStart = (lastComma < 0 ? j : lastComma) + 1;
        const dictionary =
          brace !== undefined &&
          (brace.open === argumentStart ||
            (label !== undefined && brace.open === argumentStart + 2))
            ? dictionaryAt(tokens, brace.open, brace.lastComma, last)
            : undefined;
        return {
          ...callee,
          index: commas,
          ...(label === undefined ? {} : { label }),
          ...(dictionary === undefined ? {} : { dictionary }),
        };
      }
      brace =
        innermost && type === 'OPEN_BRACE' ? { open: j, lastComma } : undefined;
      innermost = false;
      commas = 0;
      lastComma = -1;
    } else if (type === 'COMMA' && depth === 0) {
      if (lastComma < 0) lastComma = j;
      commas += 1;
    }
  }
  return undefined;
}

/** Where the tokens up to `last` end in the dictionary literal that opens
 * at `open`, whose last comma before them is `lastComma` (-1 for none). */
function dictionaryAt(
  tokens: readonly Token[],
  open: number,
  lastComma: number,
  last: number
): DictionaryArgument {
  const keyOf = (token: Token | undefined): string | undefined =>
    token === undefined
      ? undefined
      : token.type === 'SYMBOL'
        ? token.text
        : token.type === 'VERBATIM_SYMBOL' || token.type === 'STRING'
          ? (token.value ?? undefined)
          : undefined;
  const isArrow = (token: Token | undefined) =>
    token?.type === 'OPERATOR' && token.text === '->';
  // The keys of the entries of the literal, up to its closing brace.
  const written: string[] = [];
  let depth = 0;
  let entryStart = open + 1;
  for (let j = open + 1; j < tokens.length; j += 1) {
    const type = tokens[j].type;
    if (type === 'EOF') break;
    if (
      type === 'OPEN_PAREN' ||
      type === 'OPEN_BRACKET' ||
      type === 'OPEN_BRACE'
    )
      depth += 1;
    else if (
      type === 'CLOSE_PAREN' ||
      type === 'CLOSE_BRACKET' ||
      type === 'CLOSE_BRACE'
    ) {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && type === 'COMMA') entryStart = j + 1;
    // An unclosed literal (`plot(s, {▮` above more code) ends at the first
    // line that does not start an entry: the code after it is not a key.
    else if (
      depth === 0 &&
      j > open + 1 &&
      j !== entryStart &&
      tokens[j].precededByLinebreak &&
      tokens[j - 1].type !== 'COMMA' &&
      // An operator at the end of a line or at the start of the next one
      // continues the value (`width -> 1 +` then `2`).
      tokens[j - 1].type !== 'OPERATOR' &&
      tokens[j].type !== 'OPERATOR'
    )
      break;
    if (depth === 0 && j === entryStart && isArrow(tokens[j + 1])) {
      const key = keyOf(tokens[j]);
      if (key !== undefined) written.push(key);
    }
  }
  // The entry that holds the offset: in its value once its `->` is written.
  const first = (lastComma < 0 ? open : lastComma) + 1;
  if (first + 1 <= last && isArrow(tokens[first + 1])) {
    const key = keyOf(tokens[first]);
    return {
      position: 'value',
      ...(key === undefined ? {} : { key }),
      written,
    };
  }
  return { position: 'key', written };
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
