import { tokenize } from './core/tokenizer';
import {
  DEFAULT_LATEX_DICTIONARY,
  IndexedLatexDictionary,
  indexLatexDictionary,
} from './definitions';
import { Scanner } from './parse';
import {
  ParseLatexOptions,
  SerializeLatexOptions,
  LatexDictionaryEntry,
  LatexDictionary,
  LatexString,
  NumberFormattingOptions,
} from './public';
import { Serializer } from './serializer';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
  DEFAULT_SERIALIZE_LATEX_OPTIONS,
} from './utils';
import {
  DictionaryCategory,
  Expression,
  ErrorCode,
  ErrorListener,
} from '../public';
import { ComputeEngine, Numeric } from '../compute-engine/public';
export class LatexSyntax<T extends number = number> {
  onError: ErrorListener<ErrorCode>;
  options: Required<NumberFormattingOptions> &
    Required<ParseLatexOptions> &
    Required<SerializeLatexOptions>;
  readonly computeEngine?: ComputeEngine;

  private dictionary: IndexedLatexDictionary<T>;

  constructor(
    options?: NumberFormattingOptions &
      ParseLatexOptions &
      SerializeLatexOptions & {
        computeEngine?: ComputeEngine;
        dictionary?: readonly LatexDictionaryEntry<T>[];
        onError?: ErrorListener<ErrorCode>;
      }
  ) {
    const onError = (err) => {
      if (typeof window !== 'undefined') {
        if (!err.before || !err.after) {
          console.warn(err.code + (err.arg ? ': ' + err.arg : ''));
        } else {
          console.warn(
            err.code +
              (err.arg ? ': ' + err.arg : '') +
              '\n' +
              '%c' +
              '|  ' +
              err.before +
              '%c' +
              err.after +
              '\n' +
              '%c' +
              '|  ' +
              String(' ').repeat(err.before.length) +
              '▲',
            'font-weight: bold',
            'font-weight: normal; color: rgba(160, 160, 160)',
            'font-weight: bold; color: hsl(4deg, 90%, 50%)'
          );
        }
      }
      return;
    };
    this.onError = options?.onError ?? onError;
    this.computeEngine = options?.computeEngine;
    const opts = { ...(options ?? {}) };
    delete opts.dictionary;
    delete opts.onError;
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_SERIALIZE_LATEX_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...opts,
    };
    this.dictionary = indexLatexDictionary(
      options?.dictionary ?? LatexSyntax.getDictionary(),
      this.onError
    );
  }

  static getDictionary(
    domain: DictionaryCategory | 'all' = 'all'
  ): Readonly<LatexDictionary<any>> {
    if (domain === 'all') {
      let result: Readonly<LatexDictionary<any>> = [];
      for (const domain of Object.keys(DEFAULT_LATEX_DICTIONARY)) {
        result = [...result, ...DEFAULT_LATEX_DICTIONARY[domain]];
      }
      return result;
    }

    if (!DEFAULT_LATEX_DICTIONARY[domain]) return [];

    return [...DEFAULT_LATEX_DICTIONARY[domain]!];
  }

  parse(latex: LatexString): Expression {
    const scanner = new Scanner(
      tokenize(latex, []),
      this.options,
      this.dictionary,
      this.computeEngine,
      this.onError
    );

    const result = scanner.matchExpression();

    if (!scanner.atEnd) {
      // eslint-disable-next-line no-unused-expressions
      this.onError?.({ code: 'syntax-error' });
    }

    return result ?? '';
  }
  serialize(expr: Expression<T>): LatexString {
    const serializer = new Serializer(
      this.options,
      this.dictionary,
      this.computeEngine,
      this.onError
    );
    return serializer.serialize(expr);
  }
}

export function parse<T extends number = Numeric>(
  latex: LatexString,
  options?: NumberFormattingOptions &
    ParseLatexOptions & {
      dictionary?: Readonly<LatexDictionary<T>>;
      onError?: ErrorListener<ErrorCode>;
    }
): Expression {
  const syntax = new LatexSyntax(options);
  return syntax.parse(latex);
}

/**
 * Serialize a MathJSON expression as a LaTeX string.
 *
 */
export function serialize<T extends number = number>(
  expr: Expression<T>,
  options?: NumberFormattingOptions &
    SerializeLatexOptions & {
      dictionary?: Readonly<LatexDictionary<T>>;
      onError?: ErrorListener<ErrorCode>;
    }
): LatexString {
  const syntax = new LatexSyntax(options);
  return syntax.serialize(expr);
}
