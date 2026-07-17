import type { MathJsonExpression } from '../../../math-json/types.js';
import { isValidSymbol } from '../../../math-json/symbols.js';
import {
  foldAssociativeOperator,
  operator,
  isEmptySequence,
  missingIfEmpty,
  nops,
  operand,
  operands,
} from '../../../math-json/utils.js';

import { ErrorSignal, WarningSignal } from '../../../common/signals.js';

import {
  countTokens,
  joinLatex,
  tokenize,
  tokensToString,
} from '../tokenizer.js';

import {
  Delimiter,
  LatexDictionaryEntry,
  LatexString,
  LatexToken,
  Parser,
  Precedence,
  Serializer,
  SerializeHandler,
  Terminator,
  isEnvironmentEntry,
  isExpressionEntry,
  isInfixEntry,
  isMatchfixEntry,
  isPostfixEntry,
  isPrefixEntry,
  isSymbolEntry,
} from '../types.js';

export type {
  CommonEntry,
  IndexedSymbolEntry,
  IndexedExpressionEntry,
  IndexedFunctionEntry,
  IndexedMatchfixEntry,
  IndexedInfixEntry,
  IndexedPrefixEntry,
  IndexedPostfixEntry,
  IndexedEnvironmentEntry,
  IndexedLatexDictionaryEntry,
  IndexedLatexDictionary,
} from './indexed-types.js';

import type {
  IndexedSymbolEntry,
  IndexedExpressionEntry,
  IndexedFunctionEntry,
  IndexedMatchfixEntry,
  IndexedInfixEntry,
  IndexedPrefixEntry,
  IndexedPostfixEntry,
  IndexedEnvironmentEntry,
  IndexedLatexDictionaryEntry,
  IndexedLatexDictionary,
} from './indexed-types.js';

/**
 * The optional fields that may appear on some (but not all) members of the
 * `LatexDictionaryEntry` union. Used as a typed view to read these fields
 * without narrowing on `kind` first. All fields are optional and read-only.
 */
type LatexDictionaryEntryFields = {
  readonly kind?: string;
  readonly precedence?: Precedence;
  readonly associativity?: 'right' | 'left' | 'none' | 'any';
  readonly latexTrigger?: LatexString | LatexToken[];
  readonly symbolTrigger?: string;
  readonly openTrigger?: Delimiter | LatexToken[];
};

/** Read optional union-member fields off an entry without narrowing on `kind`. */
function entryFields(entry: LatexDictionaryEntry): LatexDictionaryEntryFields {
  return entry as LatexDictionaryEntryFields;
}

/** Delimiter shorthands and their token variants for matchfix indexing */
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
  '|': ['|', '\\|', '\\lvert', '\\rvert'],
  '||': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'],
};

/** @internal */
export function isIndexedSymbolEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedSymbolEntry {
  return 'kind' in entry && entry.kind === 'symbol';
}

/** @internal */
export function isIndexedExpressionEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedExpressionEntry {
  return 'kind' in entry && entry.kind === 'expression';
}

/** @internal */
export function isIndexedFunctionEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedFunctionEntry {
  return 'kind' in entry && entry.kind === 'function';
}

/** @internal */
export function isIndexedMatchfixEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedMatchfixEntry {
  return 'kind' in entry && entry.kind === 'matchfix';
}

/** @internal */
export function isIndexedInfixdEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedInfixEntry {
  return 'kind' in entry && entry.kind === 'infix';
}

/** @internal */
export function isIndexedPrefixedEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedPostfixEntry {
  return 'kind' in entry && entry.kind === 'prefix';
}

/** @internal */
export function isIndexedPostfixEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedPostfixEntry {
  return 'kind' in entry && entry.kind === 'postfix';
}

/** @internal */
export function isIndexedEnvironmentEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedEnvironmentEntry {
  return 'kind' in entry && entry.kind === 'environment';
}

//
// This table is used for the default serializer for matchfix operators
//
const DEFAULT_DELIMITER: { [key: string]: LatexString } = {
  '(': '(',
  ')': ')',
  '[': '\\lbrack',
  ']': '\\rbrack',
  '{': '\\lbrace',
  '}': '\\rbrace',
  '<': '\\langle',
  '>': '\\rangle',
  '|': '\\vert',
  '||': '\\Vert',
  '\\lceil': '\\lceil',
  '\\lfloor': '\\lfloor',
  '\\rceil': '\\rceil',
  '\\rfloor': '\\rfloor',
};

function prependIndexedEntry<T>(
  index: Map<string, T[]>,
  trigger: string,
  entry: T
): void {
  const existing = index.get(trigger);
  if (existing) {
    existing.unshift(entry); // Prepend - maintain reverse order
  } else {
    index.set(trigger, [entry]);
  }
}

function addEntry(
  result: IndexedLatexDictionary,
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
) {
  //
  // 1. Create a validated indexed entry
  //
  const indexedEntry = makeIndexedEntry(entry, onError);
  if (indexedEntry === null) return;

  const kind = 'kind' in entry ? entry.kind : 'expression';

  const latexTrigger = indexedEntry.latexTrigger;
  if (typeof latexTrigger === 'string')
    result.lookahead = Math.max(result.lookahead, countTokens(latexTrigger));

  //
  // 1.1 Handle single token synonyms for ^ and _
  //
  // Turn the latex string into tokens
  const tokensTrigger = tokenize(latexTrigger ?? '');
  if (
    tokensTrigger.length === 2 &&
    /[_^]/.test(tokensTrigger[0]) &&
    tokensTrigger[1] !== '<{>' &&
    kind !== 'function' &&
    kind !== 'environment' &&
    kind !== 'matchfix'
  ) {
    //
    // This is a single token ^ or _ trigger, e.g. '^+' or '_*'
    // Add a "synonym" entry with brackets, e.g. '^+' -> '^{+}'
    //

    // We're going to add an entry without a name (since names must be unique)
    // so we need to provide a custom parser
    let parse = entry.parse;
    if (!parse && entry.name) {
      if (kind === 'postfix' || kind === 'prefix')
        parse = (_parser: Parser, expr: MathJsonExpression) =>
          [entry.name!, expr] as MathJsonExpression;
      else parse = entry.name;
    }

    addEntry(
      result,
      {
        ...(entry as Record<string, unknown>),
        kind,
        name: undefined,
        serialize: undefined,
        parse,
        latexTrigger: [tokensTrigger[0], '<{>', tokensTrigger[1], '<}>'],
      } as LatexDictionaryEntry,
      onError
    );
  }

  //
  // 2. Add to the list of definitions
  //
  result.defs.push(indexedEntry);

  //
  // 2.1 Update the matchfix index
  //     Index matchfix entries by their opening delimiter for fast lookup
  //
  if (isIndexedMatchfixEntry(indexedEntry)) {
    const openTrigger = indexedEntry.openTrigger;
    // Get all possible opening tokens for this matchfix def
    const openTokens: string[] = [];

    if (typeof openTrigger === 'string') {
      // For string triggers, include all variants from DELIMITER_SHORTHAND
      const variants = DELIMITER_SHORTHAND[openTrigger];
      if (variants) {
        openTokens.push(...variants);
      } else {
        openTokens.push(openTrigger);
      }
      // Special case: || can also start with single |
      if (openTrigger === '||') {
        openTokens.push('|');
      }
    } else if (Array.isArray(openTrigger) && openTrigger.length > 0) {
      // For array triggers, use the first token
      openTokens.push(openTrigger[0]);
    }

    // Pre-compute the set of tokens that could begin a successful close
    // match, so `parseEnclosure` can skip a def whose close cannot appear
    // ahead. Mirrors `matchDelimiter`'s expansion logic:
    //   - String triggers expand via DELIMITER_SHORTHAND.
    //   - Multi-char strings whose tokenizer splits (e.g. `||`) include
    //     their split form so we can find them in the token stream.
    //   - Array triggers are matched literally; only the first token is
    //     significant.
    const closeTrigger = indexedEntry.closeTrigger;
    const closeTokens = new Set<LatexToken>();
    if (typeof closeTrigger === 'string') {
      const variants = DELIMITER_SHORTHAND[closeTrigger];
      if (variants) for (const v of variants) closeTokens.add(v);
      else closeTokens.add(closeTrigger);
      // `||` tokenizes as two `|` tokens — include the split form.
      if (closeTrigger === '||') closeTokens.add('|');
    } else if (Array.isArray(closeTrigger) && closeTrigger.length > 0) {
      closeTokens.add(closeTrigger[0]);
    }
    indexedEntry.closeTokens = closeTokens;

    // Add this entry to the index for each possible opening token
    // Use unshift() to maintain reverse order (later defs tried first) for correctness.
    // This ensures selective defs (like Boole for []) are tried before catch-all defs (like List).
    for (const token of openTokens) {
      const existing = result.matchfixByOpen.get(token);
      if (existing) {
        existing.unshift(indexedEntry); // Prepend - maintain reverse order
      } else {
        result.matchfixByOpen.set(token, [indexedEntry]);
      }
    }
  }

  //
  // 2.2 Update the trigger-based indexes for operators
  //     Index entries by their latexTrigger for fast lookup
  //
  if (indexedEntry.latexTrigger && indexedEntry.latexTrigger !== '') {
    const trigger = indexedEntry.latexTrigger;

    // Record the first token → max trigger token count, used by
    // `lookAhead()` to bound the lookahead. Over-approximating (e.g. for
    // the non-indexed environment/matchfix kinds) is harmless; missing an
    // indexed trigger would be a correctness bug.
    if (tokensTrigger.length > 0) {
      const first = tokensTrigger[0];
      const count = tokensTrigger.length;
      const max = result.triggerStartMax.get(first);
      if (max === undefined || count > max)
        result.triggerStartMax.set(first, count);
      // `$`/`$$` are the only tokens whose lookahead segments can alias
      // (`<$>` + `<$>` joins to the same string as `<$$>`): register both
      // spellings defensively, with a safe (over-approximated) count.
      if (first === '<$>' || first === '<$$>') {
        const alias = first === '<$>' ? '<$$>' : '<$>';
        const aliasMax = result.triggerStartMax.get(alias);
        if (aliasMax === undefined || count + 1 > aliasMax)
          result.triggerStartMax.set(alias, count + 1);
      }
    }

    switch (indexedEntry.kind) {
      case 'infix':
        prependIndexedEntry(result.infixByTrigger, trigger, indexedEntry);
        break;
      case 'prefix':
        prependIndexedEntry(result.prefixByTrigger, trigger, indexedEntry);
        break;
      case 'postfix':
        prependIndexedEntry(result.postfixByTrigger, trigger, indexedEntry);
        break;
      case 'function':
        prependIndexedEntry(result.functionByTrigger, trigger, indexedEntry);
        break;
      case 'symbol':
        prependIndexedEntry(result.symbolByTrigger, trigger, indexedEntry);
        break;
      case 'expression':
        prependIndexedEntry(result.expressionByTrigger, trigger, indexedEntry);
        break;
      case 'environment':
      case 'matchfix':
        break;
    }
  }

  //
  // 3. Update the name index
  //    This is an index of MathJSON symbols to dictionary entries
  //
  // Note: makeIndexedEntry() already checked that the name is a
  // valid symbol
  if (indexedEntry.name !== undefined) {
    // Names must be unique
    if (result.ids.has(indexedEntry.name)) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          indexedEntry.name,
          'Duplicate definition. The name (MathJSON symbol) must be unique, but triggers can be shared by multiple definitions.',
        ],
      });
    }
    result.ids.set(indexedEntry.name, indexedEntry);
  }
}

export function indexLatexDictionary(
  dic: Readonly<Partial<LatexDictionaryEntry>[]>,
  onError: (sig: ErrorSignal | WarningSignal) => void
): IndexedLatexDictionary {
  const result: IndexedLatexDictionary = {
    lookahead: 1,
    ids: new Map(),
    defs: [],
    matchfixByOpen: new Map(),
    infixByTrigger: new Map(),
    prefixByTrigger: new Map(),
    postfixByTrigger: new Map(),
    functionByTrigger: new Map(),
    symbolByTrigger: new Map(),
    expressionByTrigger: new Map(),
    operatorByTrigger: new Map(),
    universalDefs: new Map(),
    symbolTriggerDefs: new Map(),
    triggerStartMax: new Map(),
  };

  for (const entry of dic)
    addEntry(result, entry as LatexDictionaryEntry, onError);

  // Precompute the per-kind def lists used by `peekDefinitions()`:
  // - `universalDefs`: defs with an empty `latexTrigger`
  // - `symbolTriggerDefs`: defs with a `symbolTrigger`, keyed by trigger
  // - `operatorByTrigger`: merged infix/prefix/postfix index by `latexTrigger`
  // All lists are in priority order: later definitions take precedence over
  // earlier ones, so iterate the definitions backwards (same order as
  // `getDefs()`). The dictionary is immutable once indexed, so these can be
  // computed once here rather than rebuilt on each `peekDefinitions()` call.
  for (let i = result.defs.length - 1; i >= 0; i--) {
    const def = result.defs[i];
    const isOperator =
      def.kind === 'infix' || def.kind === 'prefix' || def.kind === 'postfix';
    const kinds = isOperator ? [def.kind, 'operator'] : [def.kind];
    for (const kind of kinds) {
      if (def.latexTrigger === '') {
        const defs = result.universalDefs.get(kind);
        if (defs) defs.push(def);
        else result.universalDefs.set(kind, [def]);
      }
      if (def.symbolTrigger) {
        let byTrigger = result.symbolTriggerDefs.get(kind);
        if (!byTrigger) {
          byTrigger = new Map();
          result.symbolTriggerDefs.set(kind, byTrigger);
        }
        const defs = byTrigger.get(def.symbolTrigger);
        if (defs) defs.push(def);
        else byTrigger.set(def.symbolTrigger, [def]);
      }
      if (kind === 'operator' && def.latexTrigger && def.latexTrigger !== '') {
        const operatorDef = def as
          | IndexedInfixEntry
          | IndexedPrefixEntry
          | IndexedPostfixEntry;
        const defs = result.operatorByTrigger.get(def.latexTrigger);
        if (defs) defs.push(operatorDef);
        else result.operatorByTrigger.set(def.latexTrigger, [operatorDef]);
      }
    }
  }

  // Optimize matchfix index: sort each bucket to try common patterns first.
  // For delimiters with multiple definitions (like '(' with (), (], (\rbrack),
  // try defs with standard complementary pairs (like () or []) before
  // non-standard pairs (like (] for interval notation).
  // This improves performance for nested structures without breaking correctness.
  const COMPLEMENTARY_PAIRS: { [key: string]: string[] } = {
    '(': [')', '\\rparen'],
    '\\lparen': [')', '\\rparen'],
    '[': [']', '\\rbrack', '\\]'],
    '\\lbrack': [']', '\\rbrack', '\\]'],
    '\\[': [']', '\\rbrack', '\\]'],
    '{': ['}', '\\rbrace'],
    '\\lbrace': ['}', '\\rbrace'],
    '\\{': ['}', '\\rbrace'],
    '<': ['>', '\\rangle'],
    '\\langle': ['>', '\\rangle'],
    '|': ['|', '\\|', '\\rvert', '\\lvert'],
    '\\|': ['|', '\\|', '\\rvert', '\\lvert'],
    '\\lvert': ['|', '\\|', '\\rvert', '\\lvert'],
    '||': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'],
    '\\Vert': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'],
    '\\lVert': ['||', '\\Vert', '\\lVert', '\\rVert', '\\|'],
  };

  for (const [token, defs] of result.matchfixByOpen.entries()) {
    result.matchfixByOpen.set(
      token,
      defs.sort((a, b) => {
        // Check if close trigger is a standard complement for the open trigger
        const getOpenToken = (trigger: string | string[]): string =>
          typeof trigger === 'string' ? trigger : trigger[0] || '';
        const getCloseToken = (trigger: string | string[]): string =>
          typeof trigger === 'string' ? trigger : trigger[0] || '';

        const aOpen = getOpenToken(a.openTrigger);
        const aClose = getCloseToken(a.closeTrigger);
        const aIsStandard =
          COMPLEMENTARY_PAIRS[aOpen]?.includes(aClose) ?? false;

        const bOpen = getOpenToken(b.openTrigger);
        const bClose = getCloseToken(b.closeTrigger);
        const bIsStandard =
          COMPLEMENTARY_PAIRS[bOpen]?.includes(bClose) ?? false;

        // Standard pairs come first in array (tried first on iteration)
        // This maintains the reverse order within each category
        if (aIsStandard && !bIsStandard) return -1; // a before b
        if (!aIsStandard && bIsStandard) return 1; // b before a
        return 0; // Maintain original order within category
      })
    );
  }

  return result;
}

/** Normalize a dictionary entry
 * - Ensure it has a kind property
 * - Ensure if it has a serialize property, it is a function, and it has a name
 *   property as a valid symbol
 */
function makeIndexedEntry(
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
): IndexedLatexDictionaryEntry | null {
  if (!isValidEntry(entry, onError)) return null;

  const result: Partial<IndexedLatexDictionaryEntry> = {
    kind: 'kind' in entry ? entry.kind : 'expression',
  };

  //
  // Get and normalize the triggers
  //
  let tokensTrigger: LatexToken[] | null = null;
  if ('latexTrigger' in entry) {
    if (typeof entry.latexTrigger === 'string')
      tokensTrigger = tokenize(entry.latexTrigger);
    else tokensTrigger = entry.latexTrigger as LatexToken[];
  }
  let idTrigger: string | null = null;
  if ('symbolTrigger' in entry) {
    idTrigger = entry.symbolTrigger as string;
  }

  if (tokensTrigger !== null)
    result.latexTrigger = tokensToString(tokensTrigger);
  if (idTrigger !== null) result.symbolTrigger = idTrigger;

  //
  // Make a default serialize handler if none is provided
  //
  if (entry.name) {
    // Note: the validity of the symbol has been checked
    // in isValidEntry()
    result.name = entry.name;

    // A serialize function requires a name
    result.serialize = makeSerializeHandler(entry, tokensTrigger, idTrigger);
  }

  //
  // 1. Matchfix definition
  //
  if (result.kind === 'matchfix' && isMatchfixEntry(entry)) {
    result.openTrigger = entry.openTrigger!;
    result.closeTrigger = entry.closeTrigger!;
  }

  //
  // 2. Symbol definition
  //

  if (result.kind === 'symbol' && isSymbolEntry(entry)) {
    result.precedence = entry.precedence ?? 10000;
  }

  //
  // 3. MathJsonExpression definition
  //
  if (result.kind === 'expression' && isExpressionEntry(entry)) {
    result.precedence = entry.precedence ?? 10000;
  }

  //
  // 4. Postfix, prefix
  //

  if (
    (result.kind === 'prefix' || result.kind === 'postfix') &&
    (isPrefixEntry(entry) || isPostfixEntry(entry))
  ) {
    // Special case for ^ and _
    if (
      tokensTrigger &&
      (tokensTrigger[0] === '^' || tokensTrigger[0] === '_')
    ) {
      result.precedence = 720;
      console.assert(
        entry.precedence === undefined,
        "'precedence' is fixed and cannot be modified with ^ and _ triggers"
      );
    } else result.precedence = entry.precedence ?? 10000;
  }

  if (result.kind === 'infix' && isInfixEntry(entry)) {
    console.assert(
      !tokensTrigger ||
        (tokensTrigger[0] !== '^' && tokensTrigger[0] !== '_') ||
        !entry.associativity ||
        entry.associativity === 'none'
    );
    result.associativity = entry.associativity ?? 'none';
    result.precedence = entry.precedence ?? 10000;
  }

  //
  // Make a default parser if none was provided, but a trigger was provided
  //
  const parse = makeParseHandler(entry, tokensTrigger, idTrigger);
  if (parse)
    result.parse =
      parse as unknown as Partial<IndexedLatexDictionaryEntry>['parse'];

  // Carry over the arguments mode for function entries
  if (result.kind === 'function' && 'arguments' in entry)
    (result as Partial<IndexedFunctionEntry>).arguments = entry.arguments;

  return result as IndexedLatexDictionaryEntry;
}

/**
 * Serialize a body expression as tabular content if it's a matrix shape
 * (List of Lists): cells separated by `&`, rows separated by `\\`.
 * Otherwise, fall back to plain serialization.
 */
function serializeTabularBody(
  serializer: Serializer,
  body: MathJsonExpression | null | undefined
): string {
  if (!body) return '';
  if (operator(body) !== 'List') return serializer.serialize(body);

  const rows = operands(body);
  if (rows.length === 0) return '';

  // Check if all rows are Lists (matrix shape)
  if (!rows.every((row) => operator(row) === 'List'))
    return serializer.serialize(body);

  return rows
    .map((row) =>
      operands(row)
        .map((cell) => serializer.serialize(cell))
        .join(' & ')
    )
    .join(' \\\\\n');
}

function makeSerializeHandler(
  entry: LatexDictionaryEntry,
  latexTrigger: LatexToken[] | null,
  idTrigger: string | null
): SerializeHandler | undefined {
  if (typeof entry.serialize === 'function') return entry.serialize;

  const fields = entryFields(entry);
  const kind = fields.kind ?? 'expression';

  if (kind === 'environment') {
    const envName = fields.symbolTrigger ?? entry.name ?? 'unknown';
    return (serializer, expr) => {
      const body = operand(expr, 1);
      return joinLatex([
        `\\begin{${envName}}`,
        serializeTabularBody(serializer, body),
        `\\end{${envName}}`,
      ]);
    };
  }

  if (isMatchfixEntry(entry)) {
    const openDelim =
      typeof entry.openTrigger === 'string'
        ? DEFAULT_DELIMITER[entry.openTrigger]
        : tokensToString(entry.openTrigger);
    const closeDelim =
      typeof entry.closeTrigger === 'string'
        ? DEFAULT_DELIMITER[entry.closeTrigger]
        : tokensToString(entry.closeTrigger);

    return (serializer, expr) => {
      const style = serializer.groupStyle(expr, serializer.level + 1);
      const inner = serializer.serialize(operand(expr, 1));
      if (style === 'scaled')
        return joinLatex([`\\left${openDelim}`, inner, `\\right${closeDelim}`]);
      if (style === 'big')
        return joinLatex([`\\Bigl${openDelim}`, inner, `\\Bigr${closeDelim}`]);
      return joinLatex([openDelim, inner, closeDelim]);
    };
  }

  let latex = entry.serialize;
  if (latex === undefined && latexTrigger) latex = tokensToString(latexTrigger);

  //
  // We have a LaTeX version of the symbol
  //
  if (latex) {
    const prec = fields.precedence ?? 10000;

    if (kind === 'postfix')
      return (serializer, expr) =>
        joinLatex([serializer.wrap(operand(expr, 1), prec), latex!]);

    if (kind === 'prefix')
      return (serializer, expr) =>
        joinLatex([latex!, serializer.wrap(operand(expr, 1), prec)]);

    if (kind === 'infix') {
      return (serializer, expr) => {
        const n = nops(expr);
        if (n === 0) return '';
        const prec = fields.precedence ?? 10000;
        // Insert the operator (latex) between each argument
        return joinLatex(
          operands(expr).flatMap((val, i) => {
            const arg = serializer.wrap(val, prec + 1);
            return i < n - 1 ? [arg, latex!] : [arg];
          })
        );
      };
    }

    // Function, symbol or expression. Depends on the actual shape of the
    // expression (the "kind" of the definition may not match the "kind"
    // of the expression). However, by the time this serializer is called,
    // `expr` is either a symbol or a function expression.
    return (serializer, expr) =>
      operator(expr)
        ? joinLatex([latex!, serializer.wrapArguments(expr)])
        : latex!;
  }

  //
  // We do not have a LaTeX version of the symbol. Use a string symbol
  //
  const id = idTrigger ?? entry.name ?? 'unknown';
  const prec = fields.precedence ?? 10000;

  if (kind === 'postfix')
    return (serializer, expr) =>
      joinLatex([
        serializer.wrap(operand(expr, 1), prec),
        serializer.serializeSymbol(id),
      ]);

  if (kind === 'prefix')
    return (serializer, expr) =>
      joinLatex([
        serializer.serializeSymbol(id),
        serializer.wrap(operand(expr, 1), prec),
      ]);

  if (kind === 'infix')
    return (serializer, expr) =>
      joinLatex([
        serializer.wrap(operand(expr, 1), prec + 1),
        serializer.serializeSymbol(id),
        serializer.wrap(operand(expr, 2), prec + 1),
      ]);

  // Function, symbol or expression. Depends on the actual shape of the
  // expression (the "kind" of the definition may not match the "kind"
  // of the expression). However, by the time this serializer is called,
  // `expr` is either a symbol or a function expression.
  return (serializer, expr) =>
    operator(expr)
      ? joinLatex([
          serializer.serializeSymbol(id),
          serializer.wrapArguments(expr),
        ])
      : serializer.serializeSymbol(id);
}

function makeParseHandler(
  entry: LatexDictionaryEntry,
  latexTrigger: LatexToken[] | null,
  idTrigger: string | null
) {
  // If there is a custom parser function, always use it.
  if ('parse' in entry && typeof entry.parse === 'function') return entry.parse;

  const fields = entryFields(entry);
  const kind = ('kind' in entry ? entry.kind : 'expression') ?? 'expression';

  // If there is a parse handler as an MathJsonExpression , use the
  // expression, but depending on the kind of the entry

  //
  // Environment
  //
  if (kind === 'environment') {
    // Assume we'll parse a tabular body
    const envName = entry.parse ?? entry.name ?? idTrigger;
    if (envName)
      return (parser: Parser, _until?: Readonly<Terminator>) => {
        const array = parser.parseTabular();
        if (array === null) return null;
        return [envName, ['List', array.map((row) => ['List', ...row])]];
      };
  }

  //
  // Function
  //
  if (kind === 'function') {
    const fnName = entry.parse ?? entry.name ?? idTrigger;
    const argMode =
      ('arguments' in entry ? entry.arguments : undefined) ?? 'enclosure';
    if (fnName)
      return (parser: Parser, until: Terminator) => {
        let args = parser.parseArguments(argMode, until);
        // A `{...}` group after a function head is an argument list
        // (`\gcd{a,b}`, `\mod{x}{2}`, `\operatorname{floor}{x}`): the braces
        // render invisibly, but the writer's TeX-macro-style intent is
        // unambiguous. Without this, the head parsed as a bare symbol and
        // the group multiplied against it — silently wrong. Scoped to
        // dictionary-registered heads: for a generic declared or unknown
        // head (`f{x}`), a brace group keeps its juxtaposition (multiply)
        // reading.
        if (args === null && argMode === 'enclosure')
          args = parser.parseBraceArguments();
        return args === null ? fnName : [fnName, ...args];
      };
  }

  //
  // Symbol
  //
  if (kind === 'symbol') {
    const symName = entry.parse ?? entry.name ?? idTrigger;
    if (symName)
      return (_parser: Parser, _terminator?: Readonly<Terminator>) => symName;
  }

  //
  // Prefix
  //
  if (kind === 'prefix') {
    const h = entry.parse ?? entry.name ?? idTrigger;
    if (h) {
      const prec = fields.precedence ?? 10000;
      return (parser: Parser, until?: Readonly<Terminator>) => {
        const rhs = parser.parseExpression({
          ...(until ?? []),
          minPrec: prec,
        });
        return rhs === null ? null : [h, rhs];
      };
    }
  }

  //
  // Postfix
  //
  if (kind === 'postfix') {
    const h = entry.parse ?? entry.name;
    if (h)
      return (_parser: Parser, lhs: MathJsonExpression) =>
        lhs === null ? null : [h, lhs];
  }

  //
  // Infix
  //
  if (kind === 'infix') {
    // Special handling for ^ and _
    //
    if (/[_^]/.test(latexTrigger?.[0] ?? '')) {
      const h = entry.name ?? entry.parse;
      return (_parser: Parser, arg: MathJsonExpression) => [
        h,
        missingIfEmpty(operand(arg, 1)),
        missingIfEmpty(operand(arg, 2)),
      ];
    }
    const h = entry.parse ?? entry.name ?? idTrigger;
    if (h) {
      const prec = fields.precedence ?? 10000;
      const associativity = fields.associativity ?? 'none';

      // Note: for infix operators, we are lenient and tolerate
      // a missing rhs.
      // This is because it is unlikely to be an ambiguous parse
      // (i.e. `x+`) and more likely to be a syntax error we want to
      // capture as `['Add', 'x', ['Error', "'missing'"]`.

      if (associativity === 'none') {
        return (
          parser: Parser,
          lhs: MathJsonExpression,
          until: Readonly<Terminator>
        ) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec })
          );
          return [h, lhs, rhs];
        };
      }
      if (associativity === 'left') {
        return (
          parser: Parser,
          lhs: MathJsonExpression,
          until: Readonly<Terminator>
        ) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec + 1 })
          );
          if (typeof h !== 'string') return [h, lhs, rhs];
          return [h, lhs, rhs];
        };
      }
      if (associativity === 'right') {
        return (
          parser: Parser,
          lhs: MathJsonExpression,
          until: Readonly<Terminator>
        ) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec })
          );
          if (typeof h !== 'string') return [h, lhs, rhs];
          return [h, lhs, rhs];
        };
      }
      // "both"/"any"-associative: fold identical operators.
      //
      // Parse the right operand at `prec + 1` so a same-precedence
      // continuation (e.g. the next `\times` in `a \times b \times c`) is
      // left for the caller's infix loop rather than being consumed by a
      // nested `parseExpression`. This keeps a flat operator chain iterative
      // (bounded stack) instead of right-recursive; `foldAssociativeOperator`
      // flattens the accumulated left operand so the resulting expression is
      // identical to the right-recursive form.
      return (
        parser: Parser,
        lhs: MathJsonExpression,
        until: Readonly<Terminator>
      ) => {
        if (lhs === null) return null;
        const rhs = missingIfEmpty(
          parser.parseExpression({ ...until, minPrec: prec + 1 })
        );
        if (typeof h !== 'string') return [h, lhs, rhs];
        return foldAssociativeOperator(h, lhs, rhs);
      };
    }
  }

  //
  // Matchfix
  //
  if (kind === 'matchfix') {
    const h = entry.parse ?? entry.name;
    if (h)
      return (_parser: Parser, body: MathJsonExpression) => {
        if (isEmptySequence(body)) return null;
        return [h, body];
      };
  }

  //
  // MathJsonExpression
  //
  if (kind === 'expression') {
    // If no parse funtion provided, parse as a symbol
    const parseResult = entry.parse ?? entry.name ?? idTrigger;
    if (parseResult) return () => parseResult as MathJsonExpression;
  }

  //
  // Default parse
  //
  if ('parse' in entry) {
    const parseResult = entry.parse;
    return () => parseResult as MathJsonExpression;
  }

  return undefined;
}

function isValidEntry(
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
): boolean {
  const fields = entryFields(entry);
  let subject =
    entry.name ??
    fields.latexTrigger ??
    fields.symbolTrigger ??
    fields.openTrigger;
  if (!subject) {
    try {
      subject = JSON.stringify(entry);
    } catch {
      subject = '???';
    }
  }
  if (Array.isArray(subject)) subject = tokensToString(subject);

  if (
    'kind' in entry &&
    ![
      'expression',
      'symbol',
      'function',
      'infix',
      'postfix',
      'prefix',
      'matchfix',
      'environment',
    ].includes(entry.kind)
  ) {
    onError({
      severity: 'warning',
      message: [
        'invalid-dictionary-entry',
        subject,
        `The 'kind' property must be one of 'expression', 'symbol', 'function', 'infix', 'postfix', 'prefix', 'matchfix', 'environment'`,
      ],
    });
  }

  if (entry.serialize !== undefined && !entry.name) {
    onError({
      severity: 'warning',
      message: [
        'invalid-dictionary-entry',
        subject,
        `A 'name' property must be provided if a 'serialize' handler is provided`,
      ],
    });
    return false;
  }

  // Check that the symbolTrigger is a valid symbol is present
  if (
    'symbolTrigger' in entry &&
    (!('kind' in entry) || entry.kind !== 'environment')
  ) {
    if (
      typeof entry.symbolTrigger !== 'string' ||
      !isValidSymbol(entry.symbolTrigger)
    ) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `The 'symbolTrigger' property must be a valid symbol`,
        ],
      });
    }
  }

  //
  // Check that the name symbol is valid if present
  //
  if ('name' in entry) {
    if (typeof entry.name !== 'string') {
      if (entry.name !== undefined)
        onError({
          severity: 'warning',
          message: [
            'invalid-dictionary-entry',
            subject,
            `The 'name' property must be a string`,
          ],
        });
    } else if (!isValidSymbol(entry.name)) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          entry.name,
          `The 'name' property must be a valid symbol`,
        ],
      });
    }
  }

  //
  // Checks specific to `matchfix`
  //
  if (isMatchfixEntry(entry)) {
    if ('latexTrigger' in entry || 'symbolTrigger' in entry) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `'matchfix' operators use a 'openTrigger' and 'closeTrigger' instead of a 'latexTrigger' or 'symbolTrigger'. `,
        ],
      });
      return false;
    }

    if (!entry.openTrigger || !entry.closeTrigger) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Expected `openTrigger` and a `closeTrigger` for matchfix operator',
        ],
      });
      return false;
    }

    if (typeof entry.openTrigger !== typeof entry.closeTrigger) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Expected `openTrigger` and `closeTrigger` to both be strings or array of LatexToken',
        ],
      });
      return false;
    }
  }

  //
  // Checks for infix, postfix and prefix
  //
  if (isInfixEntry(entry) || isPostfixEntry(entry) || isPrefixEntry(entry)) {
    if (
      (Array.isArray(entry.latexTrigger) &&
        (entry.latexTrigger[0] === '_' || entry.latexTrigger[0] === '^')) ||
      (typeof entry.latexTrigger === 'string' &&
        (entry.latexTrigger.startsWith('^') ||
          entry.latexTrigger.startsWith('_')))
    ) {
      if (
        entry.precedence !== undefined ||
        fields.associativity !== undefined
      ) {
        onError({
          severity: 'warning',
          message: [
            'invalid-dictionary-entry',
            subject,
            `Unexpected "precedence" or "associativity" for superscript/subscript operator`,
          ],
        });
        return false;
      }
    } else if (entry.precedence === undefined) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `Expected a "precedence" for ${entry.kind} operator`,
        ],
      });
      return false;
    }
  } else {
    //
    // Check for symbols
    //
    // Note symbols can have a precedence (used for wrapping, e.g. 'Complex')
    if (fields.associativity !== undefined) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Unexpected "associativity" operator',
        ],
      });
      return false;
    }
  }

  if (!isMatchfixEntry(entry) && !isEnvironmentEntry(entry)) {
    if (!entry.latexTrigger && !entry.symbolTrigger && !entry.name) {
      // A trigger OR a name is required (except for matchfix and environment)
      // The trigger maps LaTeX -> json
      // The name maps json -> LaTeX
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `Expected a 'name', a 'latexTrigger' or a 'symbolTrigger'`,
        ],
      });
      return false;
    }
  }

  if (entry['parse'] === undefined && entry.name === undefined) {
    onError({
      severity: 'warning',
      message: [
        'invalid-dictionary-entry',
        subject,
        `Expected a 'parse' or 'name'`,
      ],
    });
    return false;
  }

  return true;
}

// left-operators, supfix/subfix:
// subscript
// sub-plus     super-plus
// sub-minus    super-minus
// sub-star     super-star
//              super-dagger
// over-bar     under-bar
// over-vector
// over-tilde
// over-hat
// over-dot
// overscript   underscript

// matchfix:
// angle-brack
// floor
// ceiling

// infix operators:
//->   rule
// :>   rule-delayed
// ==   eq
// !=   ne
// https://reference.wolfram.com/language/tutorial/OperatorInputForms.html
