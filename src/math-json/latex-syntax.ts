import { tokenize, tokensToString } from './core/tokenizer';
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
  DictionaryCategory,
  LatexToken,
  WarningSignalHandler,
} from './public';
import { Serializer } from './serializer';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
  DEFAULT_SERIALIZE_LATEX_OPTIONS,
} from './utils';
import { Expression } from './math-json-format';
import { ComputeEngine } from './compute-engine-interface';

export class LatexSyntax<T extends number = number> {
  onError: WarningSignalHandler;
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
        onError?: WarningSignalHandler;
      }
  ) {
    const onError: WarningSignalHandler = (warnings) => {
      if (typeof window !== 'undefined') {
        for (const warning of warnings) console.warn(warning.message);
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
      (sig) => this.onError([sig])
    );
  }

  static getDictionary(
    domain: DictionaryCategory | 'all' = 'all'
  ): Readonly<LatexDictionary<any>> {
    if (domain === 'all') {
      let result: Readonly<LatexDictionary<any>> = [];
      for (const domain of Object.keys(DEFAULT_LATEX_DICTIONARY)) {
        if (DEFAULT_LATEX_DICTIONARY[domain]) {
          result = [...result, ...DEFAULT_LATEX_DICTIONARY[domain]!];
        }
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

    let result = scanner.matchExpression();

    if (!scanner.atEnd) {
      const rest: LatexToken[] = [];
      while (!scanner.atEnd) rest.push(scanner.next());
      if (result) {
        result = [
          'Sequence',
          result,
          [
            'Error',
            ['LatexString', { str: tokensToString(rest) }],
            "'syntax-error'",
          ],
        ];
      } else {
        result = [
          'Error',
          ['LatexString', { str: tokensToString(rest) }],
          "'syntax-error'",
        ];
      }
    }

    return result ?? '';
  }
  serialize(expr: Expression<T>): LatexString {
    return this.serializer.serialize(expr);
  }

  get serializer(): Serializer {
    return new Serializer(
      this.options,
      this.dictionary,
      this.computeEngine,
      this.onError
    );
  }
}
