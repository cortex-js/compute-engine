import { Expression } from '../../../math-json/math-json-format';
import {
  head,
  isEmptySequence,
  op,
  ops,
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

    // eslint-disable-next-line prefer-const
    let [fn, index] = parseIntegralBody(parser);

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

function parseIntegralBody(
  parser: Parser
): [body: Expression, index: string | null] {
  // Parse an expression (up to a relational operator, or the boundary)
  const start = parser.index;

  let found = false;

  let fn = parser.matchExpression({
    minPrec: 266,
    condition: () => {
      if (parser.matchAll(['\\mathrm', '<{>', 'd', '<}>'])) found = true;
      return found;
    },
  });

  let index: string | null = '';
  if (fn && found) {
    parser.skipSpace();
    index = parser.matchVariable();
  } else {
    // Try again, but looking for a simple "d"
    parser.index = start;
    fn = parser.matchExpression({
      minPrec: 266,
      condition: () => {
        if (parser.match('d')) found = true;
        return found;
      },
    });
    if (fn && found) {
      parser.skipSpace();
      index = parser.matchVariable();
    }
  }

  if (!found && fn) {
    // We didn't get a `\mathrm{d}x` or `dx` at the same level as the expression
    // but perhaps it was in a subexpression, e.g. `\frac{dx}{x}`
    [fn, index] = parseIntegralBodyExpression(fn);
  }

  return [fn ?? 'Nothing', index];
}

function parseIntegralBodyExpression(
  expr: Expression
): [body: Expression | null, index: string | null] {
  const h = head(expr);
  const op1 = op(expr, 1);
  if (!op1) return [expr, null];
  if (h === 'Delimiter') {
    const [fn2, index2] = parseIntegralBodyExpression(op1);
    if (index2) {
      if (!fn2) return [null, index2];
      return [['Delimiter', fn2, ...ops(expr)!.slice(1)], index2];
    }
  } else if (h === 'Add') {
    const args = ops(expr);
    if (args && args.length > 0) {
      const [fn2, index2] = parseIntegralBodyExpression(args[args.length - 1]);
      if (index2) {
        if (fn2) return [['Add', ...args.slice(0, -1), fn2], index2];
        if (args.length > 2) return [['Add', ...args.slice(0, -1)], index2];
        if (args.length > 2) return [args[0], index2];
      }
    }
  } else if (h === 'Negate') {
    const [fn2, index2] = parseIntegralBodyExpression(op1);
    if (!fn2) return [null, index2];
    if (index2) return [['Negate', fn2], index2];
  } else if (h === 'Multiply') {
    const args = ops(expr);
    if (args && args.length > 0) {
      if (args[args.length - 2] === 'd') {
        if (args.length === 2) return [null, symbol(args[1])];
        if (args.length === 3) return [args[0], symbol(args[2])];
        return [
          ['Multiply', ...args.slice(0, -2)],
          symbol(args[args.length - 1]),
        ];
      }
    }
  } else if (h === 'Divide') {
    const [fn2, index2] = parseIntegralBodyExpression(op1);
    if (index2) return [['Divide', fn2 ?? 1, op(expr, 2)!], index2];
  }

  return [expr, null];
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
