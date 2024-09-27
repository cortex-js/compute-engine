import { symbol } from '../../../math-json/utils.ts';
import { LatexDictionary, Parser, Terminator } from '../public.ts';

export const DEFINITIONS_STATISTICS: LatexDictionary = [
  {
    name: 'Mean',
    kind: 'function',
    identifierTrigger: 'mean',
  },
  {
    name: 'Median',
    kind: 'function',
    identifierTrigger: 'median',
  },
  {
    name: 'StandarDeviation',
    kind: 'function',
    identifierTrigger: 'stddev',
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
