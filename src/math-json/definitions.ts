import { Expression } from './math-json-format';
import {
  LatexDictionary,
  LatexString,
  LatexToken,
  ParserFunction,
  SerializerFunction,
  LatexDictionaryEntry,
  DictionaryCategory,
  ErrorSignal,
  WarningSignal,
  Serializer,
  Delimiter,
} from './public';
import { tokenize, tokensToString } from './core/tokenizer';
import { DEFINITIONS_INEQUALITIES } from './definitions-inequalities';
import { DEFINITIONS_OTHERS } from './definitions-other';
import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import { Numeric } from './compute-engine-interface';
import { getArg, MISSING } from '../common/utils';

export type IndexedLatexDictionaryEntry<T extends number = number> = {
  name: string;
  kind: 'symbol' | 'matchfix' | 'infix' | 'prefix' | 'postfix' | 'environment';
  associativity: 'right' | 'left' | 'non' | 'both';
  precedence: number;

  arguments: 'group' | 'implicit' | '';

  optionalLatexArg: number;
  requiredLatexArg: number;

  openDelimiter: Delimiter | LatexToken[];
  closeDelimiter: Delimiter | LatexToken[];

  parse: ParserFunction<T>;
  serialize: SerializerFunction<T> | LatexString;
};

export type IndexedLatexDictionary<T extends number = number> = {
  // Maximum number of tokens ahead of the current one that  need to be
  // considered (longest trigger length)
  lookahead: number;

  // Mapping from  MathJSON function name to dictionary entry
  name: Map<string, IndexedLatexDictionaryEntry<T>>;

  // Mapping from token triggers of a given length to dictionary entry.
  // Definition can share triggers, so the entry is an array
  prefix: (Map<LatexString, IndexedLatexDictionaryEntry<T>[]> | null)[];
  infix: (Map<LatexString, IndexedLatexDictionaryEntry<T>[]> | null)[];
  postfix: (Map<LatexString, IndexedLatexDictionaryEntry<T>[]> | null)[];
  symbol: (Map<LatexString, IndexedLatexDictionaryEntry<T>[]> | null)[];

  // Matchfix entries use openDelimiter/closeDelimiter. They do not
  // have a trigger, and the entries are not sorted by trigger length.
  matchfix: IndexedLatexDictionaryEntry<T>[];

  // Environment definition must be unique. They are indexed by the name
  // of the environment.
  environment: Map<string, IndexedLatexDictionaryEntry<T>>;
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

// function hasDef(dic: LatexDictionary, latex: string): boolean {
//     let result = false;

//     dic.forEach((x) => {
//         if (x.trigger) {
//             if (typeof x.trigger === 'string' && x.trigger === latex) {
//                 result = true;
//             } else if (
//                 typeof x.trigger !== 'string' &&
//                 (triggerString(x.trigger.infix) === latex ||
//                     triggerString(x.trigger.postfix) === latex ||
//                     triggerString(x.trigger.symbol) === latex ||
//                     triggerString(x.trigger.prefix) === latex ||
//                     triggerString(x.trigger.matchfix) === latex ||
//                     triggerString(x.closeFence) === latex)
//             ) {
//                 result = true;
//             }
//         }
//     });
//     return result;
// }

export function indexLatexDictionary<T extends number = number>(
  dic: readonly LatexDictionaryEntry<T>[],
  onError: (sig: WarningSignal) => void
): IndexedLatexDictionary<T> {
  const result: IndexedLatexDictionary<T> = {
    lookahead: 1,
    name: new Map(),
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
      const triggerString = tokensToString(entry.trigger ?? '');
      const n = triggerLength(trigger);
      result.lookahead = Math.max(result.lookahead, n);
      // If no entries of this kind and length yet, create a map for it
      if (result[indexedEntry.kind][n] === undefined) {
        result[indexedEntry.kind][n] = new Map<
          string,
          IndexedLatexDictionaryEntry<T>[]
        >();
      }
      const list = result[indexedEntry.kind][n]!;
      if (!list.has(triggerString)) {
        list.set(triggerString, [
          indexedEntry as IndexedLatexDictionaryEntry<T>,
        ]);
      } else {
        const synonyms = list.get(triggerString)!;
        synonyms.push(indexedEntry);
        list.set(triggerString, synonyms); // note: not really needed, since synonyms is a reference
      }
      console.assert([...list].every((x) => typeof x === 'object'));
    }
  }

  return result;
}

function makeIndexedEntry<T extends number = Numeric>(
  entry: LatexDictionaryEntry<T>,
  onError: (sig: ErrorSignal | WarningSignal) => void
): [string | LatexToken[] | null, IndexedLatexDictionaryEntry<T> | null] {
  if (!entryIsValid(entry, onError)) return [null, null];

  const result: Partial<IndexedLatexDictionaryEntry> = {
    name: entry.name,
  };

  result.kind = entry.kind ?? 'symbol';

  //
  // 1. Handle matchfix definition
  //
  if (result.kind === 'matchfix') {
    result.openDelimiter = entry.openDelimiter;
    result.closeDelimiter = entry.closeDelimiter;

    // @todo: use groupStyle to decide on \left..\right, etc..
    if (typeof entry.serialize === 'function') {
      result.serialize = entry.serialize;
    } else if (entry.name) {
      if (
        typeof entry.openDelimiter === 'string' &&
        typeof entry.closeDelimiter === 'string'
      ) {
        result.serialize =
          DEFAULT_DELIMITER[entry.openDelimiter!] +
          '#1' +
          DEFAULT_DELIMITER[entry.closeDelimiter!];
      } else {
        result.serialize =
          tokensToString(entry.openDelimiter!) +
          '#1' +
          tokensToString(entry.closeDelimiter!);
      }
    }
    if (typeof entry.parse !== 'function') {
      result.parse = (seq: Expression<T> | null) => [
        (entry.parse as Expression) ?? entry.name,
        seq,
      ];
    } else result.parse = entry.parse;
    return [null, result as IndexedLatexDictionaryEntry<T>];
  }

  //
  // 2. Environment definitions
  //
  if (result.kind === 'environment') {
    const envName = entry.trigger as string;
    result.serialize = (
      serializer: Serializer<T>,
      expr: T | Expression<T>
    ): string => {
      return `\\begin{${envName}${serializer.serialize(
        getArg(expr, 1)
      )}\\end{${envName}`;
    };
    result.parse = (entry.parse as ParserFunction<T>) ?? (() => null);
    return [envName, result as IndexedLatexDictionaryEntry<T>];
  }

  //
  // 3. Other definitions (not matchfix, not environment)
  //

  result.kind = entry.kind ?? 'symbol';

  // If the trigger is a string, it's a LaTeX string which
  // is a shortcut for an array of LaTeX tokens assigned to `symbol`
  // This is convenient to define common long symbols, such as `\operator{gcd}`...
  const trigger =
    typeof entry.trigger === 'string'
      ? tokenize(entry.trigger, [])
      : entry.trigger!;
  const triggerString = trigger ? tokensToString(trigger) : '';

  if (typeof entry.trigger === 'string') {
    console.assert(
      trigger!.length > 1,
      'trigger shortcut should produce more than one token. Otherwise, not worth using the shortcut.'
    );
  }

  if (
    result.kind === 'infix' ||
    result.kind === 'prefix' ||
    result.kind === 'postfix'
  ) {
    if (trigger[0] === '^' || trigger[0] === '_') {
      result.precedence = 720;
      result.associativity = 'non';
    } else {
      result.precedence = entry.precedence ?? 0;
      result.associativity = entry.associativity ?? 'non';
    }
  }
  if (result.kind === 'symbol') {
    result.arguments = entry.arguments ?? '';
    result.optionalLatexArg = entry.optionalLatexArg ?? 0;
    result.requiredLatexArg = entry.requiredLatexArg ?? 0;
  }

  if (entry.kind === 'infix') {
    if (typeof entry.parse === 'function') {
      result.parse = entry.parse;
    } else if (trigger[0] === '^' || trigger[0] === '_') {
      const name = entry.parse ?? entry.name!;
      // Default parse function for infix operator
      result.parse = (arg: Expression<T>) => [
        null,
        [name, getArg(arg, 1) ?? MISSING, getArg(arg, 2) ?? MISSING],
      ];
    } else {
      const name = entry.parse ?? entry.name!;
      // Default parse function for infix operator
      result.parse = (lhs, scanner, minPrec) => {
        // If the precedence is too high, return
        if (result.precedence! < minPrec) return [lhs, null];
        // If the lhs is missing, return
        if (lhs === null) return [lhs, null];
        // Get the rhs
        const rhs = scanner.matchExpression(entry.precedence);
        // Note: for infix operators, we are lenient and tolerate
        // a missing rhs.
        // This is because it is unlikely to be an ambiguous parse
        // (i.e. `x+`) and more likely to be a syntax error we want to
        // capture as `['Add', 'x', 'Missing']`.
        // @todo: investigate if we couldn't just return an 'Error' instead
        return [null, [name, lhs, rhs ?? MISSING]];
      };
    }
  } else {
    if (typeof entry.parse === 'function') {
      result.parse = entry.parse;
    } else if (entry.parse !== undefined) {
      // If the parse property is not undefined, it's a shortcut for a simple
      // parse function
      console.assert(result.kind === 'symbol');
      result.parse = (lhs: Expression<T> | null) => [
        lhs,
        entry.parse as Expression,
      ];
    } else if (entry.parse === undefined && entry.name !== undefined) {
      // By default, when a LaTeX string triggers, the generated
      // output is the name of this record, i.e. 'Multiply'
      if (entry.kind === 'postfix') {
        result.parse = (lhs) =>
          lhs ? [null, [entry.name!, lhs]] : [lhs, null];
      } else if (entry.kind === 'prefix') {
        result.parse = (lhs, scanner, minPrec) => {
          // If the precedence is too high, return
          if (result.precedence! < minPrec) return [lhs, null];
          // Get the rhs
          const rhs = scanner.matchExpression(result.precedence);
          if (rhs === null) return [lhs, null];
          return [lhs, [entry.name!, rhs]];
        };
      } else {
        // Symbol
        result.parse = (lhs) => [lhs, entry.name!];
      }
    }
  }
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

  return [trigger, result as IndexedLatexDictionaryEntry<T>];
}

function entryIsValid<T extends number = Numeric>(
  entry: LatexDictionaryEntry<T>,
  onError: (sig: ErrorSignal | WarningSignal) => void
): boolean {
  const subject = entry.name ?? entry.trigger ?? entry.openDelimiter;

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
  if (entry.kind === 'matchfix') {
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
  if (
    entry.kind === 'infix' ||
    entry.kind === 'postfix' ||
    entry.kind === 'prefix'
  ) {
    if (
      (Array.isArray(entry.trigger) &&
        (entry.trigger[0] === '_' || entry.trigger[0] === '^')) ||
      (typeof entry.trigger === 'string' &&
        (entry.trigger.startsWith('^') || entry.trigger.startsWith('_')))
    ) {
      if (entry.precedence !== undefined || entry.associativity !== undefined) {
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
    if (entry.associativity !== undefined) {
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

  if (entry.kind === 'symbol') {
    if (
      typeof entry.optionalLatexArg !== undefined ||
      entry.requiredLatexArg !== undefined
    ) {
      onError({
        severity: 'warning',
        message: [
          'invalid-dictionary-entry',
          subject,
          'Unexpected "optionalLatexArg" or "requiredLatexArg" for non-symbol',
        ],
      });
      return false;
    }
  }

  if (entry.kind !== 'matchfix') {
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

  if (entry.parse === undefined && entry.name === undefined) {
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
  [category in DictionaryCategory]?: LatexDictionary<Numeric>;
} = {
  algebra: DEFINITIONS_ALGEBRA,
  arithmetic: DEFINITIONS_ARITHMETIC,
  calculus: DEFINITIONS_CALCULUS,
  core: DEFINITIONS_CORE,
  inequalities: DEFINITIONS_INEQUALITIES,
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

// {
//     const defaultDic = getDefaultLatexDictionary();
//     let i = 0;
//     for (const x of Object.keys(FUNCTIONS)) {
//         if (x.startsWith('\\') && !hasDef(defaultDic, x)) {
//             i++;
//             console.log(i + ' No def for function ' + x);
//         }
//     }
//     for (const x of Object.keys(MATH_SYMBOLS)) {
//         if (x.startsWith('\\') && !hasDef(defaultDic, x)) {
//             i++;
//             console.log(i + ' No def for symbol ' + x);
//         }
//     }
// }

// {
//     const defaultLatexDic = indexLatexDictionary(
//         getDefaultLatexDictionary('all'),
//         () => {
//             return;
//         }
//     );
//     const defaultDic = getDefaultDictionary('all');

//     let i = 0;
//     Array.from(defaultLatexDic.name.keys()).forEach((x) => {
//         if (!findInDictionary(defaultDic, x)) {
//             console.log(Number(i++).toString() + ' No entry for ' + x);
//         }
//     });
// }
