import {
  ErrorListener,
  ErrorCode,
  DictionaryCategory,
  Expression,
} from '../../dist/types/public';
import { tokenize } from '../core/tokenizer';
import {
  DEFAULT_LATEX_DICTIONARY,
  IndexedLatexDictionary,
  indexLatexDictionary,
} from './definitions';
import { Scanner } from './parse';
import {
  LatexNumberOptions,
  ParseLatexOptions,
  SerializeLatexOptions,
  LatexDictionaryEntry,
  LatexDictionary,
  LatexString,
} from './public';
import { Serializer } from './serializer';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
  DEFAULT_SERIALIZE_LATEX_OPTIONS,
} from './utils';

export class LatexSyntax {
  onError?: ErrorListener<ErrorCode>;

  options: Required<LatexNumberOptions> &
    Required<ParseLatexOptions> &
    Required<SerializeLatexOptions>;
  private dictionary: IndexedLatexDictionary;

  constructor(
    options?: LatexNumberOptions &
      ParseLatexOptions &
      SerializeLatexOptions & {
        dictionary?: readonly LatexDictionaryEntry[];
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
  ): Readonly<LatexDictionary> {
    if (domain === 'all') {
      let result: Readonly<LatexDictionary> = [];
      for (const domain of Object.keys(DEFAULT_LATEX_DICTIONARY)) {
        result = [...result, ...DEFAULT_LATEX_DICTIONARY[domain]];
      }
      return result;
    }

    return [...DEFAULT_LATEX_DICTIONARY[domain]];
  }

  parse(latex: LatexString): Expression {
    const scanner = new Scanner(
      tokenize(latex, []),
      this.options,
      this.dictionary,
      this.onError
    );

    const result = scanner.matchExpression();

    if (!scanner.atEnd) {
      // eslint-disable-next-line no-unused-expressions
      this.onError?.({ code: 'syntax-error' });
    }

    return result ?? '';
  }
  serialize(expr: Expression): LatexString {
    const serializer = new Serializer(
      this.options,
      this.dictionary,
      this.onError
    );
    return serializer.serialize(expr);
  }
}

export function parse(
  latex: LatexString,
  options?: LatexNumberOptions &
    ParseLatexOptions & {
      dictionary?: Readonly<LatexDictionary>;
      onError?: ErrorListener<ErrorCode>;
    }
): Expression {
  const syntax = new LatexSyntax(options);
  return syntax.parse(latex);
}

/**
 * Serialize a MathJSON expression as a Latex string.
 *
 */
export function serialize(
  expr: Expression,
  options?: LatexNumberOptions &
    SerializeLatexOptions & {
      dictionary?: Readonly<LatexDictionary>;
      onError?: ErrorListener<ErrorCode>;
    }
): LatexString {
  const syntax = new LatexSyntax(options);
  return syntax.serialize(expr);
}
