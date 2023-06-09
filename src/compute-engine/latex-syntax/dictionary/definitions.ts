import { Expression } from '../../../math-json/math-json-format';
import {
  LatexDictionary,
  LatexString,
  LatexToken,
  SerializeHandler,
  LatexDictionaryEntry,
  LibraryCategory,
  Delimiter,
  PostfixParseHandler,
  MatchfixParseHandler,
  InfixParseHandler,
  PrefixParseHandler,
  EnvironmentParseHandler,
  SymbolParseHandler,
  FunctionParseHandler,
  isMatchfixEntry,
  isInfixEntry,
  isSymbolEntry,
  isEnvironmentEntry,
  isPostfixEntry,
  isPrefixEntry,
  isFunctionEntry,
} from '../public';
import { joinLatex, tokenize, tokensToString } from '../tokenizer';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_INEQUALITIES } from './definitions-inequalities';
import { DEFINITIONS_LOGIC } from './definitions-logic';
import { DEFINITIONS_OTHERS } from './definitions-other';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import {
  applyAssociativeOperator,
  missingIfEmpty,
  op,
} from '../../../math-json/utils';
import { ErrorSignal, WarningSignal } from '../../../common/signals';

export type CommonEntry = {
  name?: string;
  serialize: SerializeHandler | LatexString;
};

export type SymbolEntry = CommonEntry & {
  kind: 'symbol';

  // The 'precedence' of symbols is used to determine appropriate wrapping when serializing
  precedence: number;

  parse: SymbolParseHandler;
};

export type FunctionEntry = CommonEntry & {
  kind: 'function';

  parse: FunctionParseHandler;
};

export type MatchfixEntry = CommonEntry & {
  kind: 'matchfix';

  openDelimiter: Delimiter | LatexToken[];
  closeDelimiter: Delimiter | LatexToken[];

  parse: MatchfixParseHandler;
};

export type InfixEntry = CommonEntry & {
  kind: 'infix';
  associativity: 'right' | 'left' | 'non' | 'both';
  precedence: number;

  parse: InfixParseHandler;
};

export type PrefixEntry = CommonEntry & {
  kind: 'prefix';
  precedence: number;

  parse: PrefixParseHandler;
};
export type PostfixEntry = CommonEntry & {
  kind: 'postfix';
  precedence: number;

  parse: PostfixParseHandler;
};

export type EnvironmentEntry = CommonEntry & {
  kind: 'environment';

  parse: EnvironmentParseHandler;
};

export type IndexedLatexDictionaryEntry =
  | FunctionEntry
  | SymbolEntry
  | MatchfixEntry
  | InfixEntry
  | PrefixEntry
  | PostfixEntry
  | EnvironmentEntry;

export type IndexedLatexDictionary = {
  // Maximum number of tokens ahead of the current one that need to be
  // considered (longest trigger length)
  lookahead: number;

  // Mapping from  MathJSON function name to dictionary entry
  name: Map<string, IndexedLatexDictionaryEntry>;

  // Mapping from token triggers of a given length to dictionary entry.
  // Definition can share triggers, so the entry is an array
  function: Map<string, FunctionEntry[]>;
  symbol: (Map<LatexString, SymbolEntry[]> | null)[];
  prefix: (Map<LatexString, PrefixEntry[]> | null)[];
  infix: (Map<LatexString, InfixEntry[]> | null)[];
  postfix: (Map<LatexString, PostfixEntry[]> | null)[];

  // Matchfix entries use openDelimiter/closeDelimiter. They do not
  // have a trigger, and the entries are not sorted by trigger length.
  matchfix: MatchfixEntry[];

  // Environment definition must be unique. They are indexed by the name
  // of the environment.
  environment: Map<string, EnvironmentEntry>;
};

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

function triggerLength(trigger: LatexToken | LatexToken[]): number {
  if (Array.isArray(trigger)) return trigger.length;
  return 1;
}

export function indexLatexDictionary(
  dic: readonly LatexDictionaryEntry[],
  onError: (sig: WarningSignal) => void
): IndexedLatexDictionary {
  const result: IndexedLatexDictionary = {
    lookahead: 1,
    name: new Map(),
    function: new Map(),
    symbol: [],
    infix: [],
    prefix: [],
    postfix: [],
    environment: new Map(),
    matchfix: [],
  };

  for (const entry of dic) {
    //
    // 1. Create a validated indexed entry
    //
    const [trigger, indexedEntry] = makeIndexedEntry(entry, onError);
    if (indexedEntry === null) continue;

    //
    // 2. Update the name index
    //
    if (indexedEntry.name !== undefined) {
      if (result.name.has(indexedEntry.name)) {
        onError({
          severity: 'warning',
          message: [
            'invalid-dictionary-entry',
            indexedEntry.name,
            'Duplicate definition',
          ],
        });
      }
      result.name.set(indexedEntry.name, indexedEntry);
    }

    if (indexedEntry.kind === 'matchfix') {
      //
      // 3.1/ Update the matchfix index
      result.matchfix.push(indexedEntry);
      //
    } else if (indexedEntry.kind === 'environment') {
      //
      // 3.1/ Update the environment index
      //
      const triggerString = tokensToString(entry.trigger ?? '');
      if (result.environment.has(triggerString)) {
        onError({
          severity: 'warning',
          message: [
            'invalid-dictionary-entry',
            triggerString,
            'Duplicate environment definition',
          ],
        });
      }
      result.environment.set(triggerString, indexedEntry);
    } else if (trigger) {
      //
      // 3.3/ Update the other symbol or operator index
      //
      console.assert(entry.trigger);
      const triggerString = tokensToString(entry.trigger ?? '');
      const n = triggerLength(trigger);
      result.lookahead = Math.max(result.lookahead, n);

      if (indexedEntry.kind === 'function') {
        // If no entries of this kind and length yet, create a map for it
        if (!result.function.has(triggerString))
          result.function.set(triggerString, [indexedEntry]);
        else
          result.function.set(triggerString, [
            ...result.function.get(triggerString)!,
            indexedEntry,
          ]);
      } else if (indexedEntry.kind === 'symbol') {
        // If no entries of this kind and length yet, create a map for it
        if (result.symbol[n] === undefined) result.symbol[n] = new Map();
        const list = result.symbol[n]!;
        if (list.has(triggerString))
          list.get(triggerString)!.push(indexedEntry);
        else list.set(triggerString, [indexedEntry]);
      } else if (indexedEntry.kind === 'prefix') {
        if (result.prefix[n] === undefined) result.prefix[n] = new Map();
        const list = result.prefix[n]!;
        if (list.has(triggerString))
          list.get(triggerString)!.push(indexedEntry);
        else list.set(triggerString, [indexedEntry]);
      } else if (indexedEntry.kind === 'infix') {
        if (result.infix[n] === undefined) result.infix[n] = new Map();
        const list = result.infix[n]!;
        if (list.has(triggerString))
          list.get(triggerString)!.push(indexedEntry);
        else list.set(triggerString, [indexedEntry]);
      } else if (indexedEntry.kind === 'postfix') {
        if (result.postfix[n] === undefined) result.postfix[n] = new Map();
        const list = result.postfix[n]!;
        if (list.has(triggerString))
          list.get(triggerString)!.push(indexedEntry);
        else list.set(triggerString, [indexedEntry]);
      }
    }
  }

  return result;
}

function makeIndexedEntry(
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
): [string | LatexToken[] | null, IndexedLatexDictionaryEntry | null] {
  if (!entryIsValid(entry, onError)) return [null, null];

  const result: Partial<IndexedLatexDictionaryEntry> = {
    name: entry.name,
    kind: 'kind' in entry ? entry.kind : 'symbol',
  };

  //
  // 1. Handle matchfix definition
  //
  if (result.kind === 'matchfix' && isMatchfixEntry(entry)) {
    result.openDelimiter = entry.openDelimiter!;
    result.closeDelimiter = entry.closeDelimiter!;

    // @todo: use groupStyle to decide on \left..\right, etc..
    if (typeof entry.serialize === 'function')
      result.serialize = entry.serialize;
    else {
      const openDelim =
        typeof result.openDelimiter === 'string'
          ? DEFAULT_DELIMITER[result.openDelimiter]
          : tokensToString(result.openDelimiter);
      const closeDelim =
        typeof result.closeDelimiter === 'string'
          ? DEFAULT_DELIMITER[result.closeDelimiter]
          : tokensToString(result.closeDelimiter);

      result.serialize = (serializer, expr) =>
        joinLatex([openDelim, serializer.serialize(op(expr, 1)), closeDelim]);
    }
    if (typeof entry.parse === 'function')
      result.parse = entry.parse as MatchfixParseHandler;
    else {
      console.assert(entry.parse || entry.name);
      const head = entry.parse ?? entry.name;
      result.parse = (_parser, expr) => [head!, expr];
    }
    return [null, result as IndexedLatexDictionaryEntry];
  }

  //
  // 2. Environment definitions
  //
  if (result.kind === 'environment' && isEnvironmentEntry(entry)) {
    const envName = entry.trigger as string;
    result.serialize =
      entry.serialize ??
      ((serializer, expr) =>
        `\\begin{${envName}}${serializer.serialize(
          op(expr, 1)
        )}\\end{${envName}}`);
    result.parse = (entry.parse as EnvironmentParseHandler) ?? (() => null);
    return [envName, result as IndexedLatexDictionaryEntry];
  }

  // If the trigger is a string, it's a LaTeX string which
  // is a shortcut for an array of LaTeX tokens assigned to `symbol`
  // This is convenient to define common long symbols, such as `\operator{gcd}`...
  const trigger =
    typeof entry.trigger === 'string'
      ? tokenize(entry.trigger, [])
      : entry.trigger;
  const triggerString = trigger ? tokensToString(trigger) : '';

  //
  // 3. Function
  //
  if (result.kind === 'function' && isFunctionEntry(entry)) {
    // Default serializer for functions
    result.serialize = entry.serialize;
    if (triggerString && !entry.serialize)
      result.serialize = (serializer, expr) =>
        `\\mathrm{${triggerString}}${serializer.wrapArguments(expr)}`;

    result.parse = entry.parse as FunctionParseHandler;
    if (!result.parse && entry.name)
      result.parse = ((parser) => {
        const arg = parser.matchArguments('enclosure');
        return arg === null ? entry.name : ([entry.name, ...arg] as Expression);
      }) as FunctionParseHandler;
    return [triggerString, result as IndexedLatexDictionaryEntry];
  }

  //
  // 4. Other definitions (not matchfix, not environment)
  //

  if (typeof entry.trigger === 'string') {
    console.assert(
      entry.parse || trigger!.length > 1,
      `Trigger shortcut should produce more than one token. Otherwise, not worth using the shortcut. (${triggerString})`
    );
  }

  if (result.kind === 'symbol' && isSymbolEntry(entry)) {
    result.precedence = entry.precedence ?? 10000;
  }

  //
  // Special case for ^ and _
  //

  if (
    (result.kind === 'infix' ||
      result.kind === 'prefix' ||
      result.kind === 'postfix') &&
    (isInfixEntry(entry) || isPrefixEntry(entry) || isPostfixEntry(entry))
  ) {
    if (trigger && (trigger[0] === '^' || trigger[0] === '_'))
      result.precedence = 720;
    else result.precedence = entry.precedence ?? 10000;
  }

  if (result.kind === 'infix' && isInfixEntry(entry)) {
    console.assert(
      !trigger ||
        (trigger[0] !== '^' && trigger[0] !== '_') ||
        !entry.associativity ||
        entry.associativity === 'non'
    );
    result.associativity = entry.associativity ?? 'non';

    if (typeof entry.parse === 'function') {
      //
      // Use a custom parse handler
      //
      result.parse = entry.parse as InfixParseHandler;
    } else if (trigger && (trigger[0] === '^' || trigger[0] === '_')) {
      //
      // No custom parse handler allowed for ^ and _
      //
      console.assert(!entry.parse);
      const name = entry.parse ?? entry.name!;
      result.parse = (_scanner, _terminator, arg) =>
        [
          name,
          missingIfEmpty(op(arg, 1)),
          missingIfEmpty(op(arg, 2)),
        ] as Expression;
    } else {
      //
      // Default parse function for infix operator
      //
      const head = entry.parse ?? entry.name!;
      const prec = result.precedence!;
      const associativity = result.associativity;
      result.parse = (scanner, terminator, lhs) => {
        // If the precedence is too high, return
        if (prec < terminator.minPrec) return null; // @todo should not be needed

        // Get the rhs
        // Note: for infix operators, we are lenient and tolerate
        // a missing rhs.
        // This is because it is unlikely to be an ambiguous parse
        // (i.e. `x+`) and more likely to be a syntax error we want to
        // capture as `['Add', 'x', ['Error', "'missing'"]`.
        // TODO: add tests: This line wasn't hit until I did the expression `1\div`
        const rhs = scanner.missingIfEmpty(
          scanner.matchExpression({
            ...terminator,
            minPrec: prec,
          })
        );

        return typeof head === 'string'
          ? applyAssociativeOperator(head, lhs, rhs, associativity)
          : [head, lhs, rhs];
      };
    }
  } else {
    if (typeof entry.parse === 'function') {
      //
      // Custom parse handler
      //
      result.parse = entry.parse;
    } else if (entry.parse !== undefined) {
      //
      // Parse handler as an expression
      //

      console.assert(result.kind === 'symbol');
      result.parse = () => entry.parse as Expression;
    } else if (entry.parse === undefined && entry.name !== undefined) {
      //
      // Default parse handler
      //

      // By default, when a LaTeX string triggers, the generated
      // output is the name of this record, i.e. 'Multiply'
      if (result.kind === 'postfix') {
        result.parse = (_parser, lhs) => (lhs ? [entry.name!, lhs] : null);
      } else if (result.kind === 'prefix') {
        const prec = result.precedence!;
        console.assert(entry.name);
        const head = entry.name;
        result.parse = (parser, terminator) => {
          // If the precedence is too high, return
          if (prec < terminator.minPrec) return null;
          // Get the rhs
          const rhs = parser.matchExpression({ ...terminator, minPrec: prec });
          return rhs === null ? null : [head, rhs];
        };
      }
    }
  }

  //
  // Serializer
  //

  if (
    typeof entry.serialize === 'function' ||
    typeof entry.serialize === 'string'
  ) {
    result.serialize = entry.serialize;
  } else if (trigger) {
    // By default, when LaTeX is serialized for this record,
    // it is the same as the trigger
    if (result.kind === 'postfix') {
      result.serialize = '#1' + triggerString;
    } else if (result.kind === 'prefix') {
      result.serialize = triggerString + '#1';
    } else if (result.kind === 'infix') {
      result.serialize = '#1' + triggerString + '#2';
    } else if (result.kind === 'symbol') {
      result.serialize = triggerString;
    } else {
      result.serialize = '';
    }
  }

  return [trigger ?? null, result as IndexedLatexDictionaryEntry];
}

function entryIsValid(
  entry: LatexDictionaryEntry,
  onError: (sig: ErrorSignal | WarningSignal) => void
): boolean {
  const subject = entry.name ?? entry.trigger ?? entry['openDelimiter'];

  if (entry.serialize !== undefined && !entry.name) {
    onError({
      severity: 'warning',
      message: [
        'invalid-dictionary-entry',
        subject,
        `Unexpected serialize property without a name property`,
      ],
    });
    return false;
  }

  //
  // Check specific to `matchfix`
  //
  if (isMatchfixEntry(entry)) {
    if (entry.trigger) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `Unexpected 'trigger' "${entry.trigger}". 'matchfix' operators use a 'openDelimiter' and 'closeDelimiter' instead of a trigger. `,
        ],
      });
      return false;
    }

    if (!entry.openDelimiter || !entry.closeDelimiter) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Expected `openDelimiter` and a `closeDelimiter` for matchfix operator',
        ],
      });
      return false;
    }

    if (typeof entry.openDelimiter !== typeof entry.closeDelimiter) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Expected `openDelimiter` and `closeDelimiter` to both be strings or array of LatexToken',
        ],
      });
      return false;
    }
  }

  //
  // Check for infix, postfix and prefix
  //
  if (isInfixEntry(entry) || isPostfixEntry(entry) || isPrefixEntry(entry)) {
    if (
      (Array.isArray(entry.trigger) &&
        (entry.trigger[0] === '_' || entry.trigger[0] === '^')) ||
      (typeof entry.trigger === 'string' &&
        (entry.trigger.startsWith('^') || entry.trigger.startsWith('_')))
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

  if (!isMatchfixEntry(entry)) {
    if (!entry.trigger && !entry.name) {
      // A trigger OR a name is required (except for matchfix)
      // The trigger maps LaTeX -> json
      // The name maps json -> LaTeX
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          `Expected at least a 'trigger' or a 'name'`,
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
  algebra: DEFINITIONS_ALGEBRA,
  arithmetic: DEFINITIONS_ARITHMETIC,
  calculus: DEFINITIONS_CALCULUS,
  core: DEFINITIONS_CORE,
  logic: DEFINITIONS_LOGIC,
  relop: DEFINITIONS_INEQUALITIES,
  other: DEFINITIONS_OTHERS,
  physics: [
    {
      name: 'mu-0',
      trigger: '\\mu_0',
    },
  ],
  sets: DEFINITIONS_SETS,
  symbols: DEFINITIONS_SYMBOLS,
  trigonometry: DEFINITIONS_TRIGONOMETRY,
};
