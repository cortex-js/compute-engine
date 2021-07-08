import { Expression } from './math-json-format';
import { NOTHING } from '../common/utils';
import { Scanner, Serializer, LatexDictionary } from './public';

// See https://de.wikipedia.org/wiki/Formelsatz
// for a discussion of typographical notation in Germany, Russia and France
// Also DIN 1304 (symbols in formulas) and DIN 1338 (typesetting of formulas)

function parseIntegral(
  lhs: Expression,
  scanner: Scanner,
  _minPrec: number
): [Expression | null, Expression | null] {
  // There could be some superscript and subscripts
  let sup: Expression | null = NOTHING;
  let sub: Expression | null = NOTHING;
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
  const fn = scanner.matchExpression();

  return [lhs, ['Integral', fn ?? '', sup ?? NOTHING, sub ?? NOTHING]];
}

function serializeIntegral(_serializer: Serializer, _expr: Expression): string {
  return '';
}

export const DEFINITIONS_CALCULUS: LatexDictionary<any> = [
  {
    name: 'Integral',
    trigger: ['\\int'],
    parse: parseIntegral,
    serialize: serializeIntegral,
  },
];
