import { Expression } from '../../../math-json/math-json-format';
import {
  head,
  isEmptySequence,
  nops,
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
/** For double or triple integrals, n = 2 or 3.
 * Double or triple integrals are indefinite (no bounds) by default.
 */
function parseIntegral(command: string, n = 1) {
  return (parser: Parser): Expression | null => {
    parser.skipSpace();

    // Are there some superscript or subscripts?

    let sup: Expression | null = null;
    let sub: Expression | null = null;
    while (
      !(sub !== null && sup !== null) &&
      (parser.peek === '_' || parser.peek === '^')
    ) {
      if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();
      else if (parser.match('^')) {
        sup = parser.parseGroup() ?? parser.parseToken();
      }
      parser.skipSpace();
    }
    if (sub === 'Nothing' || isEmptySequence(sub)) sub = null;
    if (sup === 'Nothing' || isEmptySequence(sup)) sup = null;

    // An integral expression is of the form `\int \sin(x)dx`: `\sin(x)` is
    // the `fn` and `x` is the index.

    // eslint-disable-next-line prefer-const
    let [fn, index] = parseIntegralBody(parser, n);

    if (fn && !index) {
      if (head(fn) === 'Add' || head(fn) === 'Subtract') {
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
            makeIntegral(
              parser,
              command,
              ['Add', ...newOp],
              [{ index, sub, sup }]
            ),
            ...rest,
          ];
        }
      } else if (head(fn) === 'Divide') {
        // We recognize \frac{dx}{x} as an integral
        let altNumerator: Expression | null;
        [altNumerator, index] = parseIntegralBodyExpression(op(fn, 1)!);
        if (altNumerator !== null && index !== null) {
          fn = ['Divide', altNumerator, op(fn, 2)!];
        }
      }
    }
    return makeIntegral(parser, command, fn, [{ index, sub, sup }]);
  };
}

function makeIntegral(
  parser: Parser,
  command: string,
  fn: Expression | null,
  ranges: {
    index: string | null;
    sub: Expression | null;
    sup: Expression | null;
  }[]
): Expression {
  if (fn && ranges.length === 0) return [command, fn];

  fn ??= 'Nothing';
  parser.pushSymbolTable();
  for (const r of ranges) if (r.index) parser.addSymbol(r.index, 'symbol');

  parser.popSymbolTable();

  return [command, fn!, ...ranges.map((r) => makeRange(r))];
}

function makeRange(range: {
  index: string | null;
  sub: Expression | null;
  sup: Expression | null;
}): Expression {
  const heldIndex = range.index
    ? (['Hold', range.index] as Expression)
    : 'Nothing';
  if (range.sup !== null)
    return ['Tuple', heldIndex, range.sub ?? 'Nothing', range.sup];
  if (range.sub !== null) return ['Tuple', heldIndex, range.sub];
  return heldIndex;
}

/**  Parse an expression (up to a relational operator, or the boundary) */
function parseIntegralBody(
  parser: Parser,
  n = 1
): [body: Expression | null, index: string | null] {
  const start = parser.index;

  let found = false;

  let fn = parser.parseExpression({
    minPrec: 266,
    condition: () => {
      if (parser.matchAll(['\\mathrm', '<{>', 'd', '<}>'])) found = true;
      else if (parser.matchAll(['\\operatorname', '<{>', 'd', '<}>']))
        found = true;
      return found;
    },
  });

  if (!found) {
    // Try again, but looking for a simple "d"
    parser.index = start;
    fn = parser.parseExpression({
      minPrec: 266,
      condition: () => {
        if (parser.match('d')) found = true;
        return found;
      },
    });
  }

  // If we didn't get a `\operatorname{d}x` or `dx` at the same level as the
  // expression, perhaps it was in a subexpression, e.g. `\frac{dx}{x}` or `3xdx`
  if (fn && !found) return parseIntegralBodyExpression(fn);

  const indexes = parseIndexes(parser, n);
  return [fn, indexes[0] ?? null];
}

function parseIndexes(parser: Parser, _n = 1): string[] {
  parser.skipSpace();

  const result: string[] = [];
  const index = symbol(parser.parseSymbol());
  if (index === null) return [];
  result.push(index);

  // @todo: parse additional indexes (\operatorname{d}, 'd', etc...)

  return result;
}

function parseIntegralBodyExpression(
  expr: Expression
): [body: Expression | null, index: string | null] {
  const h = head(expr);
  const op1 = op(expr, 1);
  if (!op1) return [expr, null];

  if (h === 'Sequence' && nops(expr) === 1) {
    return parseIntegralBodyExpression(op1);
  }

  if (h === 'Multiply' || h === 'InvisibleOperator') {
    // Handle the case `3xdx` where the `dx` is the last term of a
    // multiplication (in a subexpression, i.e. `\sin 3xdx`)
    const args = ops(expr);
    if (args && args.length > 1) {
      const sym = symbol(args[args.length - 2]);
      if (sym === 'd' || sym === 'd_upright') {
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
      return [['Delimiter', ['Sequence', fn2], ...ops(expr)!.slice(1)], index];
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
    let indexExpr: Expression | null = null;
    if (h === 'Tuple' || h === 'Triple' || h === 'Pair' || h === 'Single') {
      indexExpr = op(arg, 1);
    } else if (h === 'Hold') {
      indexExpr = op(arg, 1);
    } else {
      indexExpr = op(arg, 1) ?? 'x';
      arg = null;
    }
    if (head(indexExpr) === 'Hold') indexExpr = op(indexExpr, 1);

    const index: string | null = indexExpr !== null ? symbol(indexExpr) : null;

    let fn = op(expr, 1);
    if (head(fn) === 'Lambda' && op(fn, 1))
      fn = subs(op(fn, 1)!, { _: index ?? 'x', _1: index ?? 'x' });

    if (!arg) {
      if (!index || index === 'Nothing')
        return joinLatex([command, '\\!', serializer.serialize(fn)]);
      return joinLatex([
        command,
        '\\!',
        serializer.serialize(fn),
        '\\,\\operatorname{d}',
        serializer.serialize(index),
      ]);
    }

    const subSymbol = op(arg, 2) ? symbol(op(arg, 2)) : null;
    let sub =
      arg && subSymbol !== 'Nothing' ? serializer.serialize(op(arg, 2)) : '';

    if (sub.length > 0) sub = `_{${sub}}`;

    let sup = '';
    const supSymbol = op(arg, 3) ? symbol(op(arg, 3)) : null;
    if (op(arg, 3) && supSymbol !== 'Nothing')
      sup = `^{${serializer.serialize(op(arg, 3))}}`;

    return joinLatex([
      command,
      sup,
      sub,
      '\\!',
      serializer.serialize(fn),
      ...(index && symbol(index) !== 'Nothing'
        ? ['\\,\\operatorname{d}', serializer.serialize(index)]
        : []),
    ]);
  };
}
export const DEFINITIONS_CALCULUS: LatexDictionary = [
  {
    kind: 'expression',
    name: 'Integrate',
    latexTrigger: ['\\int'],

    parse: parseIntegral('Integrate'),
    serialize: serializeIntegral('\\int'),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\iint'],
    parse: parseIntegral('Integrate', 2),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\iiint'],
    parse: parseIntegral('Integrate', 3),
  },
  {
    kind: 'expression',
    name: 'CircularIntegrate',
    latexTrigger: ['\\oint'],
    parse: parseIntegral('CircularIntegrate'),
    serialize: serializeIntegral('\\oint'),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\oiint'],
    parse: parseIntegral('CircularIntegrate', 2),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\oiiint'],
    parse: parseIntegral('CircularIntegrate', 3),
  },
];
