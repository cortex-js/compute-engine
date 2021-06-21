import {
  DictionaryCategory,
  Expression,
  ErrorCode,
  ErrorListener,
} from '../public';
import {
  LatexDictionary,
  LatexString,
  LatexToken,
  ParserFunction,
  SerializerFunction,
  LatexDictionaryEntry,
} from './public';
import { tokensToString } from './core/tokenizer';
import { DEFINITIONS_INEQUALITIES } from './definitions-inequalities';
import { DEFINITIONS_OTHERS } from './definitions-other';
import { DEFINITIONS_CORE } from './definitions-core';
import { DEFINITIONS_ARITHMETIC } from './definitions-arithmetic';
import { DEFINITIONS_TRIGONOMETRY } from './definitions-trigonometry';
import { DEFINITIONS_ALGEBRA } from './definitions-algebra';
import { DEFINITIONS_SETS } from './definitions-sets';
import { DEFINITIONS_CALCULUS } from './definitions-calculus';
import { DEFINITIONS_SYMBOLS } from './definitions-symbols';
import { Numeric } from '../compute-engine/public';

export type IndexedLatexDictionaryEntry<T extends number = number> = {
  name: string;
  trigger?: {
    symbol?: LatexToken | LatexToken[];
    matchfix?: LatexToken | LatexToken[];
    infix?: LatexToken | LatexToken[];
    prefix?: LatexToken | LatexToken[];
    postfix?: LatexToken | LatexToken[];
    superfix?: LatexToken | LatexToken[];
    subfix?: LatexToken | LatexToken[];
  };
  parse: Expression<T> | ParserFunction<T>;
  serialize: SerializerFunction<T> | LatexString;
  associativity: 'right' | 'left' | 'non' | 'both';
  precedence: number;
  arguments: 'group' | 'implicit' | '';
  optionalLatexArg: number;
  requiredLatexArg: number;
  separator: LatexString;
  closeFence: LatexString;
};

export type IndexedLatexDictionary<T extends number = number> = {
  lookahead: number;
  name: Map<string, IndexedLatexDictionaryEntry<T>>;
  prefix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  infix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  postfix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  matchfix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  superfix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  subfix: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  symbol: (Map<LatexString, IndexedLatexDictionaryEntry<T>> | null)[];
  environment: Map<string, IndexedLatexDictionaryEntry<T>>;
};

function triggerLength(trigger: LatexToken | LatexToken[]): number {
  if (Array.isArray(trigger)) return trigger.length;
  return 1;
}

function triggerString(trigger: LatexToken | LatexToken[]) {
  return tokensToString(trigger);
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
  onError: ErrorListener<ErrorCode>
): IndexedLatexDictionary<T> {
  const result = {
    lookahead: 1,
    name: new Map(),
    prefix: [],
    infix: [],
    postfix: [],
    matchfix: [],
    superfix: [],
    subfix: [],
    symbol: [],
    environment: new Map(),
  };

  for (const record of dic) {
    if (record.parse === undefined) {
      // By default, when a latex string triggers, the generated
      // output is the name of this record, i.e. MULTIPLY
      record.parse = record.name;
    }
    // If the trigger is a string, it's a shortcut for a symbol
    if (typeof record.trigger === 'string') {
      record.trigger = { symbol: record.trigger };
    }
    if (typeof record.serialize === 'string') {
      if (record.trigger?.symbol !== undefined) {
        if (/#[0-9]/.test(record.serialize)) {
          onError({ code: 'unexpected-argument', arg: record.name });
        }
      }
    }
    if (record.serialize === undefined) {
      // By default, when latex is serialized for this record,
      // it is the same as the trigger (note there could be multiple
      // triggers, so we just pick one)
      if (record.trigger?.postfix !== undefined) {
        record.serialize = '#1' + triggerString(record.trigger.postfix);
      } else if (record.trigger?.prefix !== undefined) {
        record.serialize = triggerString(record.trigger.prefix) + '#1';
      } else if (record.trigger?.infix !== undefined) {
        record.serialize = '#1' + triggerString(record.trigger.infix) + '#2';
      } else if (record.trigger?.symbol !== undefined) {
        record.serialize = triggerString(record.trigger.symbol);
      } else if (record.trigger?.superfix !== undefined) {
        record.serialize =
          '#1^{' + triggerString(record.trigger?.superfix) + '}';
      } else if (record.trigger?.subfix !== undefined) {
        record.serialize = '#1_{' + triggerString(record.trigger?.subfix) + '}';
      } else {
        record.serialize = '';
      }
    }
    if (record.trigger?.infix !== undefined) {
      if (record.precedence === undefined) {
        onError({
          code: 'syntax-error',
          arg: 'Infix operators require a precedence',
        });
      }
      if (!record.associativity) {
        record.associativity = 'non';
      }
    }
    if (record.trigger?.symbol !== undefined) {
      record.arguments = record.arguments ?? '';
      record.optionalLatexArg = record.optionalLatexArg ?? 0;
      record.requiredLatexArg = record.requiredLatexArg ?? 0;
    }
    if (record.trigger?.matchfix !== undefined) {
      if (record.parse !== 'function' && !record.closeFence) {
        onError({
          code: 'syntax-error',
          arg: 'Matchfix operators require a close fence or a custom parse function',
        });
      }
    }

    if (record.trigger !== undefined) {
      [
        'infix',
        'prefix',
        'postfix',
        'symbol',
        'matchfix',
        'superfix',
        'subfix',
      ].forEach((x) => {
        if (record.trigger![x]) {
          const n = triggerLength(record.trigger![x]);
          result.lookahead = Math.max(result.lookahead, n);
          if (result[x][n] === undefined) {
            result[x][n] = new Map<string, IndexedLatexDictionaryEntry<T>>();
          }
          result[x][n].set(triggerString(record.trigger![x]), record);
        }
      });
      if (record.trigger.environment !== undefined) {
        result.environment.set(record.trigger.environment, record);
      }
    }
    if (record.name !== undefined) {
      result.name.set(triggerString(record.name), record);
    } else if (typeof record.parse === 'string') {
      result.name.set(record.parse, record);
    }
    if (record.trigger === undefined && !record.name) {
      // A trigger OR a name is required.
      // The trigger maps latex -> json
      // The name maps json -> latex
      onError({
        code: 'syntax-error',
        arg: 'Need at least a trigger or a name',
      });
    }
  }

  return result;
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
      trigger: { symbol: ['\\mu', '_', '0'] },
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
