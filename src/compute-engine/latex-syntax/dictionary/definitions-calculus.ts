import { Expression } from '../../../math-json/math-json-format';
import { LatexDictionary, Parser, Serializer } from '../public';

// See https://de.wikipedia.org/wiki/Formelsatz
// for a discussion of typographical notation in Germany, Russia and France
// Also DIN 1304 (symbols in formulas) and DIN 1338 (typesetting of formulas)

function parseIntegral(parser: Parser): Expression | null {
  // There could be some superscript and subscripts
  let sup: Expression | null = 'Nothing';
  let sub: Expression | null = 'Nothing';
  let done = false;
  while (!done) {
    parser.skipSpace();
    if (parser.match('_')) {
      sub = parser.matchRequiredLatexArgument();
    } else if (parser.match('^')) {
      sup = parser.matchRequiredLatexArgument();
    } else {
      done = true;
    }
  }

  // @todo: that's not quite right: the integral of the function is denoted
  // by a `...dx` pattern, e.g. `\int \sin(x)dx`
  const fn = parser.matchExpression({ tokens: ['d'] });

  return ['Integral', fn ?? '', sup ?? 'Nothing', sub ?? 'Nothing'];
}

function serializeIntegral(_serializer: Serializer, _expr: Expression): string {
  return '';
}

export const DEFINITIONS_CALCULUS: LatexDictionary = [
  {
    name: 'Integral',
    trigger: ['\\int'],
    parse: parseIntegral,
    serialize: serializeIntegral,
  },
];
