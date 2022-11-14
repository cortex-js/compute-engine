import { tokenize, tokensToString } from './tokenizer';
import {
  DEFAULT_LATEX_DICTIONARY,
  IndexedLatexDictionary,
  indexLatexDictionary,
} from './dictionary/definitions';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
  _Parser,
} from './parse';
import {
  ParseLatexOptions,
  SerializeLatexOptions,
  LatexDictionaryEntry,
  LatexDictionary,
  LatexString,
  NumberFormattingOptions,
  LibraryCategory,
} from './public';
import { Serializer } from './serializer';
import { Expression } from '../../math-json/math-json-format';
import { WarningSignalHandler } from '../../common/signals';
import {
  getApplyFunctionStyle,
  getGroupStyle,
  getRootStyle,
  getFractionStyle,
  getLogicStyle,
  getPowerStyle,
  getNumericSetStyle,
} from './serializer-style';
import { IComputeEngine } from '../public';

export const DEFAULT_SERIALIZE_LATEX_OPTIONS: Required<SerializeLatexOptions> =
  {
    invisibleMultiply: '', // '\\cdot',
    invisiblePlus: '', // '+',
    // invisibleApply: '',

    multiply: '\\times',

    missingSymbol: '\\blacksquare',

    // openGroup: '(',
    // closeGroup: ')',
    // divide: '\\frac{#1}{#2}',
    // subtract: '#1-#2',
    // add: '#1+#2',
    // negate: '-#1',
    // squareRoot: '\\sqrt{#1}',
    // nthRoot: '\\sqrt[#2]{#1}',
    applyFunctionStyle: getApplyFunctionStyle,
    groupStyle: getGroupStyle,
    rootStyle: getRootStyle,
    fractionStyle: getFractionStyle,
    logicStyle: getLogicStyle,
    powerStyle: getPowerStyle,
    numericSetStyle: getNumericSetStyle,
  };

export class LatexSyntax {
  onError: WarningSignalHandler;
  readonly options: NumberFormattingOptions &
    ParseLatexOptions &
    SerializeLatexOptions;
  readonly computeEngine: IComputeEngine;

  private dictionary: IndexedLatexDictionary;
  private _serializer?: Serializer;

  constructor(
    options: Partial<NumberFormattingOptions> &
      Partial<ParseLatexOptions> &
      Partial<SerializeLatexOptions> & {
        computeEngine: IComputeEngine;
        dictionary?: readonly LatexDictionaryEntry[];
        onError?: WarningSignalHandler;
      }
  ) {
    const onError: WarningSignalHandler = (warnings) => {
      if (typeof window !== 'undefined') {
        for (const warning of warnings) console.warn(warning.message);
      }
      return;
    };
    this.onError = options.onError ?? onError;
    this.computeEngine = options.computeEngine;
    const opts = { ...options };
    delete opts.dictionary;
    delete opts.onError;
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...DEFAULT_SERIALIZE_LATEX_OPTIONS,
      ...opts,
    };
    this.dictionary = indexLatexDictionary(
      options.dictionary ?? LatexSyntax.getDictionary(),
      (sig) => this.onError([sig])
    );
  }

  updateOptions(
    opt: Partial<NumberFormattingOptions> &
      Partial<ParseLatexOptions> &
      Partial<SerializeLatexOptions>
  ) {
    for (const k of Object.keys(this.options))
      if (k in opt) this.options[k] = opt[k];

    this.serializer.updateOptions(opt);
  }

  static getDictionary(
    category: LibraryCategory | 'all' = 'all'
  ): Readonly<LatexDictionary> {
    if (category === 'all') {
      const result: LatexDictionaryEntry[] = [];
      for (const domain of Object.keys(DEFAULT_LATEX_DICTIONARY))
        if (DEFAULT_LATEX_DICTIONARY[domain])
          result.push(...DEFAULT_LATEX_DICTIONARY[domain]!);

      return result;
    }

    if (!DEFAULT_LATEX_DICTIONARY[category]) return [];

    return [...DEFAULT_LATEX_DICTIONARY[category]!];
  }

  parse(latex: LatexString): Expression {
    const parser = new _Parser(
      tokenize(latex, []),
      this.options,
      this.dictionary,
      this.computeEngine
    );

    let expr = parser.matchExpression();

    if (!parser.atEnd) {
      // Somethin went wrong, generate error expressin
      const opDefs = parser.peekDefinitions('infix');
      if (opDefs) {
        const start = parser.index;
        const [def, n] = opDefs[0];
        parser.index += n;
        const result = def.parse(
          parser,
          { minPrec: 0 },
          expr ?? parser.error('missing', start)
        );
        if (result) return result;
        if (def.name) {
          return [
            def.name,
            expr ?? parser.error('missing', start),
            parser.error('missing', start),
          ];
        }
        parser.index = start;
      }

      const index = parser.index;
      const closeDelimiter = parser.matchEnclosureOpen();
      if (closeDelimiter) {
        const enclosureError = parser.error(
          ['expected-close-delimiter', closeDelimiter],
          index
        );
        return expr ? ['Sequence', expr, enclosureError] : enclosureError;
      }

      const openDelimiter = parser.matchEnclosureClose();
      if (openDelimiter) {
        const enclosureError = parser.error(
          ['expected-open-delimiter', openDelimiter],
          index
        );
        return expr ? ['Sequence', expr, enclosureError] : enclosureError;
      }

      const rest = parser.index;
      const token = parser.next();
      while (!parser.atEnd) parser.next();

      // Something went wrong, generate error expression
      const error = parser.error(
        [
          token.length > 1 && token.startsWith('\\')
            ? 'unexpected-command'
            : 'unexpected-token',
          { str: tokensToString([token]) },
        ],
        rest
      );
      expr = expr ? ['Sequence', expr, error] : error;
    }

    expr ??= ['Sequence'];

    if (this.options.preserveLatex) {
      if (Array.isArray(expr)) expr = { latex, fn: expr };
      else if (typeof expr === 'number')
        expr = { latex, num: Number(expr).toString() };
      else if (typeof expr === 'string') expr = { latex, sym: expr };
      else if (typeof expr === 'object' && expr !== null) expr.latex = latex;
    }
    return expr ?? ['Sequence'];
  }
  serialize(expr: Expression): LatexString {
    return this.serializer.serialize(expr);
  }

  get serializer(): Serializer {
    if (this._serializer) return this._serializer;
    this._serializer = new Serializer(
      this.options,
      this.dictionary,
      this.onError
    );
    return this._serializer;
  }
}
