import { symbol } from '../../../math-json/utils';
import type { LatexDictionary, Parser, Terminator } from '../types';

export const DEFINITIONS_STATISTICS: LatexDictionary = [
  {
    name: 'Mean',
    kind: 'function',
    symbolTrigger: 'mean',
  },
  {
    name: 'Median',
    kind: 'function',
    symbolTrigger: 'median',
  },
  {
    name: 'StandarDeviation',
    kind: 'function',
    symbolTrigger: 'stddev',
  },
  {
    latexTrigger: ['\\bar'],
    kind: 'expression',
    parse: (parser: Parser, _until: Terminator) => {
      const expr = parser.parseGroup() ?? parser.parseToken();
      if (!expr || !symbol(expr)) return null;
      return ['Mean', expr];
    },
  },
];
