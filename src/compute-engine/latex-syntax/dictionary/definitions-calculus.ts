import { Expression } from '../../../math-json/math-json-format';
import {
  head,
  isEmptySequence,
  op,
  subs,
  symbol,
} from '../../../math-json/utils';
import { LatexDictionary, Parser, Serializer } from '../public';
import { joinLatex } from '../tokenizer';

// See https://de.wikipedia.org/wiki/Formelsatz
// for a discussion of typographical notation in Germany, Russia and France
// Also DIN 1304 (symbols in formulas) and DIN 1338 (typesetting of formulas)

// @todo: double integrals
function parseIntegral(head: string) {
  return (parser: Parser): Expression | null => {
    // There could be some superscript and subscripts
    parser.skipSpace();

    let sup: Expression | null = null;
    let sub: Expression | null = null;
    while (!(sub && sup) && (parser.peek === '_' || parser.peek === '^')) {
      if (parser.match('_')) sub = parser.matchRequiredLatexArgument();
      else if (parser.match('^')) sup = parser.matchRequiredLatexArgument();
      parser.skipSpace();
    }
    if (sub === 'Nothing' || isEmptySequence(sub)) sub = null;
    if (sup === 'Nothing' || isEmptySequence(sup)) sup = null;

    // An integral expression is of the form `\int \sin(x)dx`
    const start = parser.index;
    parser.addBoundary(['\\mathrm', '<{>', 'd', '<}>']);

    // Parse an expression (up to a relational operator, or the boundary)
    let fn = parser.matchExpression({ minPrec: 266 });

    let index: string | null = '';
    if (parser.matchBoundary()) {
      parser.skipSpace();
      index = parser.matchVariable();
    } else {
      parser.removeBoundary();
      // Try again, but looking for a simple "d"
      parser.index = start;
      parser.addBoundary(['d']);
      fn = parser.matchExpression({ minPrec: 266 });
      if (parser.matchBoundary()) {
        parser.skipSpace();
        index = parser.matchVariable();
      } else parser.removeBoundary();
    }

    if (fn && index) fn = ['Lambda', subs(fn, { [index]: '_' })];

    if (!fn) return [head];

    if (sup)
      return [
        head,
        fn ?? 'Nothing',
        ['Tuple', index ?? 'Nothing', sub ?? 1, sup],
      ];

    if (sub) return [head, fn ?? 'Nothing', ['Tuple', index ?? 'Nothing', sub]];

    if (index) return [head, fn ?? 'Nothing', ['Tuple', index]];

    if (fn) return [head, fn];

    return [head];
  };
}
function serializeIntegral(command: string) {
  return (serializer: Serializer, expr: Expression): string => {
    if (!op(expr, 1)) return command;

    let arg = op(expr, 2);
    const h = head(arg);
    if (h !== 'Tuple' && h !== 'Triple' && h !== 'Pair' && h !== 'Single')
      arg = null;

    const index = op(arg, 1) ?? 'x';

    let fn = op(expr, 1);
    if (head(fn) === 'Lambda' && op(fn, 1))
      fn = subs(op(fn, 1)!, { _: index, _1: index });

    if (!arg) {
      if (!op(expr, 2)) return joinLatex([command, serializer.serialize(fn)]);
      return joinLatex([
        command,
        '_{',
        serializer.serialize(op(expr, 2)),
        '}',
        serializer.serialize(fn),
      ]);
    }

    let sub = [serializer.serialize(op(arg, 2))];

    if (sub.length > 0) sub = ['_{', ...sub, '}'];

    let sup: string[] = [];
    if (op(arg, 3)) sup = ['^{', serializer.serialize(op(arg, 3)), '}'];

    return joinLatex([
      command,
      ...sup,
      ...sub,
      serializer.serialize(fn),
      ...(symbol(index) !== 'Nothing'
        ? ['\\,\\mathrm{d}', serializer.serialize(index)]
        : []),
    ]);
  };
}
export const DEFINITIONS_CALCULUS: LatexDictionary = [
  {
    name: 'Integrate',
    trigger: ['\\int'],
    parse: parseIntegral('Integrate'),
    serialize: serializeIntegral('\\int'),
  },
  {
    name: 'CircularIntegrate',
    trigger: ['\\oint'],
    parse: parseIntegral('CircularIntegrate'),
    serialize: serializeIntegral('\\oint'),
  },
];
