import type { MathJsonExpression } from '../../../math-json/types.js';
import { symbol } from '../../../math-json/utils.js';
import type {
  LatexDictionary,
  Parser,
  Serializer,
  Terminator,
} from '../types.js';

// The distribution heads and `PDF`/`CDF`/`Quantile`/`GammaRegularized`/
// `BetaRegularized` round-trip via the default `\operatorname{…}(…)` path
// (the `Series` pattern). An explicit `kind: 'expression'` serialize entry is
// needed for each so an unevaluated expression serializes with `\operatorname`
// and re-parses to the same head.
const OPERATORNAME_HEADS = [
  'NormalDistribution',
  'BinomialDistribution',
  'PoissonDistribution',
  'UniformDistribution',
  'ExponentialDistribution',
  'PDF',
  'CDF',
  'Quantile',
  'GammaRegularized',
  'BetaRegularized',
  'Covariance',
  'PopulationCovariance',
  'Correlation',
  'LinearRegression',
  'PolynomialFit',
];

export const DEFINITIONS_STATISTICS: LatexDictionary = [
  ...OPERATORNAME_HEADS.map(
    (name) =>
      ({
        kind: 'expression',
        name,
        serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
          `\\operatorname{${name}}` + serializer.wrapArguments(expr),
      }) as LatexDictionary[number]
  ),
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
    parse: (parser: Parser, _until?: Readonly<Terminator>) => {
      const expr = parser.parseGroup() ?? parser.parseToken();
      if (!expr || !symbol(expr)) return null;
      return ['Mean', expr] as MathJsonExpression;
    },
  },
  // Function-style aliases: `\operatorname{var}(...)`, `\operatorname{cov}(...)`,
  // `\operatorname{corr}(...)`
  { latexTrigger: '\\operatorname{var}', kind: 'function', parse: 'Variance' },
  { latexTrigger: '\\operatorname{cov}', kind: 'function', parse: 'Covariance' },
  { latexTrigger: '\\operatorname{corr}', kind: 'function', parse: 'Correlation' },
];
