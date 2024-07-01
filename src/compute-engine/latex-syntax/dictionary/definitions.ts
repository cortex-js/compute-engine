import { Expression } from '../../../math-json/math-json-format';
import { countTokens, joinLatex, tokenize, tokensToString } from '../tokenizer';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_INEQUALITIES } from './definitions-relational-operators';
import { DEFINITIONS_LINEAR_ALGEBRA } from './definitions-linear-algebra';
import { DEFINITIONS_LOGIC } from './definitions-logic';
import { DEFINITIONS_OTHERS } from './definitions-other';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import {
  foldAssociativeOperator,
  head,
  isEmptySequence,
  isValidIdentifier,
  missingIfEmpty,
  nops,
  op,
  ops,
} from '../../../math-json/utils';
import { ErrorSignal, WarningSignal } from '../../../common/signals';
import { DEFINITIONS_COMPLEX } from './definitions-complex';
import { DEFINITIONS_STATISTICS } from './definitions-statistics';
import {
  Delimiter,
  EnvironmentParseHandler,
  ExpressionParseHandler,
  InfixParseHandler,
  LatexDictionary,
  LatexDictionaryEntry,
  LatexString,
  LatexToken,
  LibraryCategory,
  MatchfixParseHandler,
  Parser,
  PostfixParseHandler,
  Precedence,
  SerializeHandler,
  Terminator,
  isEnvironmentEntry,
  isExpressionEntry,
  isInfixEntry,
  isMatchfixEntry,
  isPostfixEntry,
  isPrefixEntry,
  isSymbolEntry,
} from '../public';

export type CommonEntry = {
  /** Note: a name is required if a serialize handler is provided */
  name?: string;

  serialize?: SerializeHandler;

  /** Note: not all kinds have a `latexTrigger` or `identifierTrigger`.
   * For example, matchfix operators use `openTrigger`/`closeTrigger`
   */
  latexTrigger?: LatexString;
  identifierTrigger?: string;
};

export type IndexedSymbolEntry = CommonEntry & {
  kind: 'symbol';

  // The 'precedence' of symbols is used to determine appropriate wrapping when serializing
  precedence: Precedence;

  parse: ExpressionParseHandler;
};
/** @internal */
export function isIndexedSymbolEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedSymbolEntry {
  return 'kind' in entry && entry.kind === 'symbol';
}

export type IndexedExpressionEntry = CommonEntry & {
  kind: 'expression';

  // The 'precedence' of expressions is used to determine appropriate wrapping when serializing
  precedence: Precedence;

  parse: ExpressionParseHandler;
};
/** @internal */
export function isIndexedExpressionEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedExpressionEntry {
  return 'kind' in entry && entry.kind === 'expression';
}

/**
 * A function has the following form:
 * - a prefix such as `\mathrm` or `\operatorname`
 * - a trigger string, such as `gcd`
 * - some postfix operators such as `\prime`
 * - an optional list of arguments in an enclosure (parentheses)
 *
 * Functions of this type are indexed in the dictionary by their trigger string.
 */
export type IndexedFunctionEntry = CommonEntry & {
  kind: 'function';

  parse: ExpressionParseHandler;
};
/** @internal */
export function isIndexedFunctionEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedFunctionEntry {
  return 'kind' in entry && entry.kind === 'function';
}

export type IndexedMatchfixEntry = CommonEntry & {
  kind: 'matchfix';

  openTrigger: Delimiter | LatexToken[];
  closeTrigger: Delimiter | LatexToken[];

  parse: MatchfixParseHandler;
};
/** @internal */
export function isIndexedMatchfixEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedMatchfixEntry {
  return 'kind' in entry && entry.kind === 'matchfix';
}

export type IndexedInfixEntry = CommonEntry & {
  kind: 'infix';
  associativity: 'right' | 'left' | 'none' | 'any';
  precedence: Precedence;

  parse: InfixParseHandler;
};
/** @internal */
export function isIndexedInfixdEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedInfixEntry {
  return 'kind' in entry && entry.kind === 'infix';
}

export type IndexedPrefixEntry = CommonEntry & {
  kind: 'prefix';
  precedence: Precedence;

  parse: ExpressionParseHandler;
};
/** @internal */
export function isIndexedPrefixedEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedPostfixEntry {
  return 'kind' in entry && entry.kind === 'prefix';
}

export type IndexedPostfixEntry = CommonEntry & {
  kind: 'postfix';
  precedence: Precedence;

  parse: PostfixParseHandler;
};

/** @internal */
export function isIndexedPostfixEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedPostfixEntry {
  return 'kind' in entry && entry.kind === 'postfix';
}

export type IndexedEnvironmentEntry = CommonEntry & {
  kind: 'environment';

  parse: EnvironmentParseHandler;
};

/** @internal */
export function isIndexedEnvironmentEntry(
  entry: IndexedLatexDictionaryEntry
): entry is IndexedEnvironmentEntry {
  return 'kind' in entry && entry.kind === 'environment';
}

export type IndexedLatexDictionaryEntry =
  | IndexedExpressionEntry
  | IndexedFunctionEntry
  | IndexedSymbolEntry
  | IndexedMatchfixEntry
  | IndexedInfixEntry
  | IndexedPrefixEntry
  | IndexedPostfixEntry
  | IndexedEnvironmentEntry;

export type IndexedLatexDictionary = {
  // Mapping from  MathJSON identifiers to dictionary entry
  ids: Map<string, IndexedLatexDictionaryEntry>;

  // Maximum number of tokens ahead of the current one that need to be
  // considered (longest trigger length)
  lookahead: number;

  defs: IndexedLatexDictionaryEntry[];
};

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

function addEntry(
  result: IndexedLatexDictionary,
  entry: LatexDictionaryEntry,
  onError: (sig: WarningSignal) => void
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
        parse = (_parser, expr) => [entry.name!, expr] as Expression;
      else parse = entry.name;
    }

    addEntry(
      result,
      {
        ...(entry as any),
        kind,
        name: undefined,
        serialize: undefined,
        parse,
        latexTrigger: [tokensTrigger[0], '<{>', tokensTrigger[1], '<}>'],
      },
      onError
    );
  }

  //
  // 2. Add to the list of definitions
  //
  result.defs.push(indexedEntry);

  //
  // 3. Update the name index
  //    This is an index of MathJSON identifiers to dictionary entries
  //
  // Note: makeIndexedEntry() already checked that the name is a
  // valid identifier
  if (indexedEntry.name !== undefined) {
    // Names must be unique
    if (result.ids.has(indexedEntry.name)) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          indexedEntry.name,
          'Duplicate definition. The name (MathJSON identifier) must be unique, but triggers can be shared by multiple definitions.',
        ],
      });
    }
    result.ids.set(indexedEntry.name, indexedEntry);
  }
}

export function indexLatexDictionary(
  dic: Readonly<Partial<LatexDictionaryEntry>[]>,
  onError: (sig: WarningSignal) => void
): IndexedLatexDictionary {
  const result: IndexedLatexDictionary = {
    lookahead: 1,
    ids: new Map(),
    defs: [],
  };

  for (const entry of dic)
    addEntry(result, entry as LatexDictionaryEntry, onError);

  return result;
}

/** Normalize a dictionary entry
 * - Ensure it has a kind property
 * - Ensure if it has a serialize property, it is a function, and it has a name
 *   property as a valid identifier
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
  if ('identifierTrigger' in entry) {
    idTrigger = entry.identifierTrigger as string;
  }

  if (tokensTrigger !== null)
    result.latexTrigger = tokensToString(tokensTrigger);
  if (idTrigger !== null) result.identifierTrigger = idTrigger;

  //
  // Make a default serialize handler if none is provided
  //
  if (entry.name) {
    // Note: the validity of the identifier has been checked
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
  // 3. Expression definition
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
  if (parse) result.parse = parse as any;

  return result as IndexedLatexDictionaryEntry;
}

function makeSerializeHandler(
  entry: LatexDictionaryEntry,
  latexTrigger: LatexToken[] | null,
  idTrigger: string | null
): SerializeHandler | undefined {
  if (typeof entry.serialize === 'function') return entry.serialize;

  const kind = entry['kind'] ?? 'expression';

  if (kind === 'environment') {
    // @todo: should do a serializeTabular(). op(expr,1) is likely to be
    // a matrix (List of List).
    const envName = entry['identifierTrigger'] ?? entry.name ?? 'unknown';
    return (serializer, expr) =>
      joinLatex([
        `\\begin{${envName}}`,
        serializer.serialize(op(expr, 1)),
        `\\end{${envName}}`,
      ]);
  }

  if (isMatchfixEntry(entry)) {
    // @todo: use groupStyle to decide on \left..\right, etc..
    const openDelim =
      typeof entry.openTrigger === 'string'
        ? DEFAULT_DELIMITER[entry.openTrigger]
        : tokensToString(entry.openTrigger);
    const closeDelim =
      typeof entry.closeTrigger === 'string'
        ? DEFAULT_DELIMITER[entry.closeTrigger]
        : tokensToString(entry.closeTrigger);

    return (serializer, expr) =>
      joinLatex([openDelim, serializer.serialize(op(expr, 1)), closeDelim]);
  }

  let latex = entry.serialize;
  if (latex === undefined && latexTrigger) latex = tokensToString(latexTrigger);

  //
  // We have a LaTeX version of the identifier
  //
  if (latex) {
    if (kind === 'postfix')
      return (serializer, expr) =>
        joinLatex([serializer.serialize(op(expr, 1)), latex!]);

    if (kind === 'prefix')
      return (serializer, expr) =>
        joinLatex([latex!, serializer.serialize(op(expr, 1))]);

    if (kind === 'infix') {
      return (serializer, expr) => {
        const n = nops(expr);
        if (n === 0) return '';
        const prec = entry['precedence'] ?? 10000;
        // Insert the operator (latex) between each argument
        return joinLatex(
          ops(expr)!.flatMap((val, i) => {
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
      head(expr) ? joinLatex([latex!, serializer.wrapArguments(expr)]) : latex!;
  }

  //
  // We do not have a LaTeX version of the identifier. Use a string identifier
  //
  const id = idTrigger ?? entry.name ?? 'unknown';
  if (kind === 'postfix')
    return (serializer, expr) =>
      joinLatex([
        serializer.serialize(op(expr, 1)),
        serializer.serializeSymbol(id),
      ]);

  if (kind === 'prefix')
    return (serializer, expr) =>
      joinLatex([
        serializer.serializeSymbol(id),
        serializer.serialize(op(expr, 1)),
      ]);

  if (kind === 'infix')
    return (serializer, expr) =>
      joinLatex([
        serializer.serialize(op(expr, 1)),
        serializer.serializeSymbol(id),
        serializer.serialize(op(expr, 2)),
      ]);

  // Function, symbol or expression. Depends on the actual shape of the
  // expression (the "kind" of the definition may not match the "kind"
  // of the expression). However, by the time this serializer is called,
  // `expr` is either a symbol or a function expression.
  return (serializer, expr) =>
    head(expr)
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

  const kind = 'kind' in entry ? entry.kind : 'expression' ?? 'expression';

  // If there is a parse handler as an Expression , use the
  // expression, but depending on the kind of the entry

  //
  // Environment
  //
  if (kind === 'environment') {
    // Assume we'll parse a tabular body
    const envName = entry.parse ?? entry.name ?? idTrigger;
    if (envName)
      return (parser: Parser, _until) => {
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
    if (fnName)
      return (parser: Parser, until: Terminator) => {
        const args = parser.parseArguments('enclosure', until);
        return args === null ? fnName : [fnName, ...args];
      };
  }

  //
  // Symbol
  //
  if (kind === 'symbol') {
    const symName = entry.parse ?? entry.name ?? idTrigger;
    if (symName) return (_parser, _terminator) => symName;
  }

  //
  // Prefix
  //
  if (kind === 'prefix') {
    const h = entry.parse ?? entry.name ?? idTrigger;
    if (h) {
      const prec = entry['precedence'] ?? 10000;
      return (parser, until) => {
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
    if (h) return (_parser, lhs) => (lhs === null ? null : [h, lhs]);
  }

  //
  // Infix
  //
  if (kind === 'infix') {
    // Special handling for ^ and _
    //
    if (/[_^]/.test(latexTrigger?.[0] ?? '')) {
      const h = entry.name ?? entry.parse;
      return (_parser, arg) => [
        h,
        missingIfEmpty(op(arg, 1)),
        missingIfEmpty(op(arg, 2)),
      ];
    }
    const h = entry.parse ?? entry.name ?? idTrigger;
    if (h) {
      const prec = entry['precedence'] ?? 10000;
      const associativity = entry['associativity'] ?? 'none';

      // Note: for infix operators, we are lenient and tolerate
      // a missing rhs.
      // This is because it is unlikely to be an ambiguous parse
      // (i.e. `x+`) and more likely to be a syntax error we want to
      // capture as `['Add', 'x', ['Error', "'missing'"]`.

      if (associativity === 'none') {
        return (parser, lhs, until) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec })
          );
          return [h, lhs, rhs];
        };
      }
      if (associativity === 'left') {
        return (parser, lhs, until) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec + 1 })
          );
          if (typeof h !== 'string') return [h, lhs, rhs];
          return [h, lhs, rhs];
        };
      }
      if (associativity === 'right') {
        return (parser, lhs, until) => {
          if (lhs === null) return null;
          const rhs = missingIfEmpty(
            parser.parseExpression({ ...until, minPrec: prec })
          );
          if (typeof h !== 'string') return [h, lhs, rhs];
          return [h, lhs, rhs];
        };
      }
      // "both"-associative: fold identical operators
      return (parser, lhs, until) => {
        if (lhs === null) return null;
        const rhs = missingIfEmpty(
          parser.parseExpression({ ...until, minPrec: prec })
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
      return (_parser, body) => {
        if (body === null || isEmptySequence(body)) return null;
        return [h, body];
      };
  }

  //
  // Expression
  //
  if (kind === 'expression') {
    // If no parse funtion provided, parse as a symbol
    const parseResult = entry.parse ?? entry.name ?? idTrigger;
    if (parseResult) return () => parseResult as Expression;
  }

  //
  // Default parse
  //
  if ('parse' in entry) {
    const parseResult = entry.parse;
    return () => parseResult as Expression;
  }

  return undefined;
}

function isValidEntry(
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
): boolean {
  let subject =
    entry.name ??
    entry['latexTrigger'] ??
    entry['identifierTrigger'] ??
    entry['openTrigger'];
  if (!subject) {
    try {
      subject = JSON.stringify(entry);
    } catch (e) {
      subject = '???';
    }
  }
  if (Array.isArray(subject)) subject = tokensToString(subject);

  if ('trigger' in entry) {
    onError({
      severity: 'warning',
      message: [
        'invalid-dictionary-entry',
        subject,
        `The 'trigger' property is deprecated. Use 'latexTrigger' or 'identifierTrigger' instead`,
      ],
    });
  }

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

  // Check that the identifierTrigger is a valid identifier is present
  if (
    'identifierTrigger' in entry &&
    (!('kind' in entry) || entry.kind !== 'environment')
  ) {
    if (
      typeof entry.identifierTrigger !== 'string' ||
      !isValidIdentifier(entry.identifierTrigger)
    ) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `The 'identifierTrigger' property must be a valid identifier`,
        ],
      });
    }
  }

  //
  // Check that the name identifier is valid if present
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
    } else if (!isValidIdentifier(entry.name)) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          entry.name,
          `The 'name' property must be a valid identifier`,
        ],
      });
    }
  }

  //
  // Checks specific to `matchfix`
  //
  if (isMatchfixEntry(entry)) {
    if ('latexTrigger' in entry || 'identifierTrigger' in isPrefixEntry) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `'matchfix' operators use a 'openTrigger' and 'closeTrigger' instead of a 'latexTrigger' or 'identifierTrigger'. `,
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
        entry['associativity'] !== undefined
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
    if (entry['associativity'] !== undefined) {
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
    if (!entry.latexTrigger && !entry.identifierTrigger && !entry.name) {
      // A trigger OR a name is required (except for matchfix and environment)
      // The trigger maps LaTeX -> json
      // The name maps json -> LaTeX
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `Expected a 'name', a 'latexTrigger' or a 'identifierTrigger'`,
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

export const DEFAULT_LATEX_DICTIONARY: {
  [category in LibraryCategory]?: LatexDictionary;
} = {
  'symbols': DEFINITIONS_SYMBOLS,
  'algebra': DEFINITIONS_ALGEBRA,
  'arithmetic': DEFINITIONS_ARITHMETIC,
  'calculus': DEFINITIONS_CALCULUS,
  'complex': DEFINITIONS_COMPLEX,
  'core': DEFINITIONS_CORE,
  'linear-algebra': DEFINITIONS_LINEAR_ALGEBRA,
  'logic': DEFINITIONS_LOGIC,
  'relop': DEFINITIONS_INEQUALITIES,
  'other': DEFINITIONS_OTHERS,
  'physics': [
    {
      name: 'mu0',
      kind: 'symbol',
      latexTrigger: '\\mu_0',
    },
  ],
  'sets': DEFINITIONS_SETS,
  'statistics': DEFINITIONS_STATISTICS,
  'trigonometry': DEFINITIONS_TRIGONOMETRY,
};

export function getLatexDictionary(
  category: LibraryCategory | 'all' = 'all'
): readonly Readonly<LatexDictionaryEntry>[] {
  if (category === 'all') {
    const result: LatexDictionaryEntry[] = [];
    for (const domain of Object.keys(DEFAULT_LATEX_DICTIONARY))
      if (DEFAULT_LATEX_DICTIONARY[domain])
        result.push(...DEFAULT_LATEX_DICTIONARY[domain]!);

    return result;
  }

  if (!DEFAULT_LATEX_DICTIONARY[category]) return [];

  return Object.freeze([
    ...DEFAULT_LATEX_DICTIONARY[category]!,
  ]) as Readonly<LatexDictionaryEntry>[];
}
