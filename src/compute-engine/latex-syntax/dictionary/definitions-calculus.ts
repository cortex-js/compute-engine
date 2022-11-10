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
function parseIntegral(command: string) {
  return (parser: Parser): Expression | null => {
    parser.skipSpace();

    // Are there some superscript or subscripts?

    let sup: Expression | null = null;
    let sub: Expression | null = null;
    while (!(sub && sup) && (parser.peek === '_' || parser.peek === '^')) {
      if (parser.match('_')) sub = parser.matchRequiredLatexArgument();
      else if (parser.match('^')) sup = parser.matchRequiredLatexArgument();
      parser.skipSpace();
    }
    if (sub === 'Nothing' || isEmptySequence(sub)) sub = null;
    if (sup === 'Nothing' || isEmptySequence(sup)) sup = null;

    // An integral expression is of the form `\int \sin(x)dx`: `\sin(x)` is
    // the `fn` and `x` is the index.

    // eslint-disable-next-line prefer-const
    let [fn, index] = parseIntegralBody(parser);

    if (fn && !index && (head(fn) === 'Add' || head(fn) === 'Subtract')) {
      // If the function is an addition, it could appear in any of the terms,
      // e.g. `\int \sin xdx + 1`
      const newOp: Expression[] = [];
      const rest: Expression[] = [];
      for (const op of ops(fn) ?? []) {
        if (index) rest.push(op);
        else {
          let op2: Expression | null;
          [op2, index] = parseIntegralBodyExpression(op);
          newOp.push(op2 ?? op);
        }
      }
      if (index !== null && rest.length > 0) {
        return [
          'Add',
          makeIntegral(command, ['Add', ...newOp], index, sub, sup),
          ...rest,
        ];
      }
    }
    return makeIntegral(command, fn, index, sub, sup);
  };
}

function makeIntegral(
  command: string,
  fn: Expression | null,
  index: string | null,
  sub: Expression | null,
  sup: Expression | null
): Expression {
  if (fn && index) fn = ['Lambda', subs(fn, { [index]: '_' })];

  if (fn && !sup && !sub && !index) return [command, fn];

  fn ??= 'Nothing';

  const heldIndex: Expression | null = index
    ? (['Hold', index] as Expression)
    : null;

  if (sup)
    return [
      command,
      fn,
      ['Tuple', heldIndex ?? 'Nothing', sub ?? 'Nothing', sup],
    ];
  if (sub) return [command, fn, ['Tuple', heldIndex ?? 'Nothing', sub]];
  if (heldIndex) return [command, fn, heldIndex];
  return [command];
}

/**  Parse an expression (up to a relational operator, or the boundary) */
function parseIntegralBody(
  parser: Parser
): [body: Expression | null, index: string | null] {
  const start = parser.index;

  let found = false;

  let fn = parser.matchExpression({
    minPrec: 266,
    condition: () => {
      if (parser.matchAll(['\\mathrm', '<{>', 'd', '<}>'])) found = true;
      return found;
    },
  });

  if (!found) {
    // Try again, but looking for a simple "d"
    parser.index = start;
    fn = parser.matchExpression({
      minPrec: 266,
      condition: () => {
        if (parser.match('d')) found = true;
        return found;
      },
    });
  }

  // If we didn't get a `\mathrm{d}x` or `dx` at the same level as the
  // expression, perhaps it was in a subexpression, e.g. `\frac{dx}{x}`
  if (fn && !found) return parseIntegralBodyExpression(fn);

  return [fn, found ? symbol(parser.matchSymbol()) : null];
}

function parseIntegralBodyExpression(
  expr: Expression
): [body: Expression | null, index: string | null] {
  const h = head(expr);
  const op1 = op(expr, 1);
  if (!op1) return [expr, null];

  if (h === 'Multiply') {
    // Handle the case `3xdx` where the `dx` is the last term of a
    // multiplication (in a subexpression, i.e. `\sin 3xdx`)
    const args = ops(expr);
    if (args && args.length > 1) {
      if (symbol(args[args.length - 2]) === 'd') {
        if (args.length === 2) return [null, symbol(args[1])];
        if (args.length === 3) return [args[0], symbol(args[2])];
        return [
          ['Multiply', ...args.slice(0, -2)],
          symbol(args[args.length - 1]),
        ];
      }
      const [fn2, index] = parseIntegralBodyExpression(args[args.length - 1]);
      if (fn2) return [['Multiply', ...args.slice(0, -1), fn2], index];
    }
  } else if (h === 'Delimiter') {
    const [fn2, index] = parseIntegralBodyExpression(op1);
    if (index) {
      if (!fn2) return [null, index];
      return [['Delimiter', fn2, ...ops(expr)!.slice(1)], index];
    }
  } else if (h === 'Add') {
    const args = ops(expr);
    if (args && args.length > 0) {
      const [fn2, index] = parseIntegralBodyExpression(args[args.length - 1]);
      if (index) {
        if (fn2) return [['Add', ...args.slice(0, -1), fn2], index];
        if (args.length > 2) return [['Add', ...args.slice(0, -1)], index];
        if (args.length > 2) return [args[0], index];
      }
    }
  } else if (h === 'Negate') {
    const [fn2, index] = parseIntegralBodyExpression(op1);
    if (index) return [fn2 ? ['Negate', fn2] : null, index];
  } else if (h === 'Divide') {
    const [fn2, index] = parseIntegralBodyExpression(op1);
    if (index) return [['Divide', fn2 ?? 1, op(expr, 2)!], index];
  } else {
    // Some other function, e.g. trig function, etc...
    const args = ops(expr);
    if (args?.length === 1) {
      //If it has a single argument, we'll check if it includes an index
      // e.g. \sin 2xdx
      const [arg2, index] = parseIntegralBodyExpression(args[0]);
      if (index) return [[head(expr), arg2] as Expression, index];
    }
  }

  return [expr, null];
}

function serializeIntegral(command: string) {
  return (serializer: Serializer, expr: Expression): string => {
    if (!op(expr, 1)) return command;

    let arg = op(expr, 2);
    const h = head(arg);
    let index: string | null = null;
    if (h !== 'Tuple' && h !== 'Triple' && h !== 'Pair' && h !== 'Single') {
      index = symbol(arg);
      arg = null;
    } else index = symbol(op(arg, 1)) ?? 'x';

    let fn = op(expr, 1);
    if (head(fn) === 'Lambda' && op(fn, 1))
      fn = subs(op(fn, 1)!, { _: index ?? 'x', _1: index ?? 'x' });

    if (!arg) {
      if (!index) return joinLatex([command, serializer.serialize(fn)]);
      return joinLatex([
        command,
        serializer.serialize(fn),
        '\\mathrm{d}',
        index,
      ]);
    }

    let sub = arg ? [serializer.serialize(op(arg, 2))] : [];

    if (sub.length > 0) sub = ['_{', ...sub, '}'];

    let sup: string[] = [];
    if (op(arg, 3)) sup = ['^{', serializer.serialize(op(arg, 3)), '}'];

    return joinLatex([
      command,
      ...sup,
      ...sub,
      serializer.serialize(fn),
      ...(index && symbol(index) !== 'Nothing'
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
    trigger: ['\\iint'],
    parse: parseIntegral('Integrate'),
  },
  {
    name: 'CircularIntegrate',
    trigger: ['\\oint'],
    parse: parseIntegral('CircularIntegrate'),
    serialize: serializeIntegral('\\oint'),
  },
];
