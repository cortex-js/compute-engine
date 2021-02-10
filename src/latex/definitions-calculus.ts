import { Expression } from '../public';
import { Scanner, Serializer, LatexDictionary } from './public';
import { NOTHING } from '../dictionary/dictionary';

function parseIntegral(
  lhs: Expression,
  scanner: Scanner,
  _minPrec: number
): [Expression | null, Expression | null] {
  if (!scanner.match('\\int')) return [lhs, null];
  // There could be some superscript and subscripts
  let sup: Expression = NOTHING;
  let sub: Expression = NOTHING;
  let done = false;
  while (!done) {
    scanner.skipSpace();
    if (scanner.match('_')) {
      sub = scanner.matchRequiredLatexArgument();
    } else if (scanner.match('^')) {
      sup = scanner.matchRequiredLatexArgument();
    } else {
      done = true;
    }
  }

  // @todo: that's not quite right: the integral of the function is denoted
  // by a `...dx` pattern, e.g. `\int \sin(x)dx`
  const fn = scanner.matchBalancedExpression('<{>', '<}>');

  return [lhs, ['Integral', fn ?? '', sup, sub]];
}

function serializeIntegral(_serializer: Serializer, _expr: Expression): string {
  return '';
}

export const DEFINITIONS_CALCULUS: LatexDictionary = [
  {
    trigger: { symbol: '\\int' },
    parse: parseIntegral,
    serialize: serializeIntegral,
  },
];
