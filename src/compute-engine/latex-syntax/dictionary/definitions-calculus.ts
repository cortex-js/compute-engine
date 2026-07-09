import type { MathJsonExpression } from '../../../math-json/types.js';
import {
  operator,
  isEmptySequence,
  nops,
  operand,
  operands,
  symbol,
} from '../../../math-json/utils.js';
import { LatexDictionary, Parser, Serializer } from '../types.js';

// See https://de.wikipedia.org/wiki/Formelsatz
// for a discussion of typographical notation in Germany, Russia and France
// Also DIN 1304 (symbols in formulas) and DIN 1338 (typesetting of formulas)

/**
 * Parse an expression of the form:
 *    `/int_a^b\int_c^d f(x, y) dx dy`
 * to
 *    `["Integrate", f(x, y), [x, a, b], [y, c, d]]`
 *
 * The number of \int doesn't necessarily match the number of indexes
 * (for examples, `\iint f dxdy`
 *
 * When this function is called, the first `\int` has already been matched.
 *
 * `nIntegrals` is the number of integral signs the matched command stands for
 * (`\int` → 1, `\iint` → 2, `\iiint` → 3, etc.). It bounds how many trailing
 * differentials (`dx dy …`) this level may consume. Without this bound the
 * innermost integral of a nested expression (`\int\int … dx dy`) would greedily
 * swallow *all* the differentials, leaving the outer integrals with no
 * integration variable.
 *
 */
function parseIntegral(command: string, nIntegrals = 1) {
  return (parser: Parser): MathJsonExpression | null => {
    //
    // 1/ Capture the limits of integration
    //
    // A single integral sign carries one set of sub/super-script limits.
    // Consecutive signs are NOT merged into one level here: stacked `\int`s
    // parse as separate, recursively-nested `Integrate`s — each with its own
    // limits and differential (see `nIntegrals`) — while `\iint` / `\iiint`
    // pass nIntegrals=2/3 to bind several differentials to this one level.

    // Skip space or a `\limits` command
    parser.skipVisualSpace();
    parser.match('\\limits');
    parser.skipSpace();

    // Are there some superscripts or subscripts?
    let sup: MathJsonExpression | null = null;
    let sub: MathJsonExpression | null = null;
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
    if (isEmptySequence(sub)) sub = null;
    if (isEmptySequence(sup)) sup = null;

    const subs: MathJsonExpression[] = [sub ?? 'Nothing'];
    const sups: MathJsonExpression[] = [sup ?? 'Nothing'];

    parser.skipVisualSpace();

    //
    // 2/ Capture the body of the integral (the integrand)
    //   and the indexes that follow it.
    //

    // eslint-disable-next-line prefer-const
    let [fn, indexes] = parseIntegralBody(parser, nIntegrals);

    if (fn && indexes.length === 0) {
      if (operator(fn) === 'Add' || operator(fn) === 'Subtract') {
        // If the function is an addition, it could appear in any of the terms,
        // e.g. `\int \sin xdx + 1`
        const newOp: MathJsonExpression[] = [];
        const rest: MathJsonExpression[] = [];
        for (const op of operands(fn)) {
          if (indexes) rest.push(op);
          else {
            let op2: MathJsonExpression | null;
            [op2, indexes] = parseSubintegrand(op);
            newOp.push(op2 ?? op);
          }
        }
        if (indexes !== null && rest.length > 0) {
          return [
            'Add',
            makeIntegral(command, ['Add', ...newOp], {
              indexes,
              subs,
              sups,
            }) ?? 'Nothing',
            ...rest,
          ];
        }
      } else if (operator(fn) === 'Divide') {
        // We recognize \frac{dx}{x} as an integral
        let altNumerator: MathJsonExpression | null;
        [altNumerator, indexes] = parseSubintegrand(operand(fn, 1)!);
        if (altNumerator !== null && indexes !== null) {
          fn = ['Divide', altNumerator, operand(fn, 2)!];
        }
      }
    }

    //
    // 3/ Put together the limits, the function and the indexes
    //
    return makeIntegral(command, fn, { indexes, subs, sups });
  };
}

function makeIntegral(
  command: string,
  fn: MathJsonExpression | null,
  limits: {
    indexes: string[];
    subs: MathJsonExpression[];
    sups: MathJsonExpression[];
  }
): MathJsonExpression | null {
  if (!fn) return null;

  //
  // Make the tuples
  //

  if (limits.sups.length === 0 && limits.subs.length === 0) {
    // No limits, just the function
    // if (args.length === 0) return [command, fn];
    return [command, fn, ...limits.indexes];
  }

  // Use the provided indexes, or if none, use the arguments of the function
  const indexes =
    limits.indexes.length === 0
      ? operator(fn) === 'Function'
        ? operands(fn).slice(1)
        : []
      : limits.indexes;

  const count = Math.max(
    limits.sups.length,
    limits.subs.length,
    indexes.length
  );

  if (indexes.length === 0) {
    // If we have no indexes, fill them in
    // e.g. \int_0^1 \sin
    for (let i = 0; i < count; i++) indexes.push('Nothing');
  } else if (indexes.length !== count) {
    // We have more limits than indexes, or more indexes than limits
    // fill the missing indexes with error messages
    for (let i = indexes.length; i < count; i++)
      indexes.push(['Error', "'missing'"]);
  }

  if (limits.subs.length !== count) {
    // We have more indexes than subs.
    for (let i = limits.subs.length; i < count; i++)
      limits.subs.push('Nothing');
  }

  if (limits.sups.length !== count) {
    // We have more indexes than sups.
    for (let i = limits.sups.length; i < count; i++)
      limits.sups.push('Nothing');
  }

  const tuples = indexes.map((idx, i) => {
    const sup = limits.sups[i];
    const sub = limits.subs[i];
    if (sub === 'Nothing' && sup === 'Nothing')
      return idx as MathJsonExpression;

    return ['Tuple', idx, sub, sup] as MathJsonExpression;
  });

  return [command, fn, ...tuples];
}

/**  Parse the body of an integral (up to a relational operator, or the boundary)
 *
 * `maxIndexes` caps how many trailing differentials this integral level
 * consumes (see `parseIntegral`). The remaining differentials are left in the
 * stream for the enclosing integrals of a nested expression.
 */
function parseIntegralBody(
  parser: Parser,
  maxIndexes = 1
): [body: MathJsonExpression | null, indexes: string[]] {
  let found = false;

  const fn = parser.parseExpression({
    minPrec: 266,
    condition: () => {
      const start = parser.index;
      found = matchDifferentialOperator(parser);
      parser.index = start;
      return found;
    },
  });

  // If we didn't get a `\operatorname{d}x` or `dx` at the same level as the
  // expression, perhaps it was in a subexpression, e.g. `\frac{dx}{x}` or `3xdx`
  if (fn !== null && !found) return parseSubintegrand(fn);

  return [fn, parseIndexes(parser, maxIndexes)];
}

/** Assuming we are at a differential operator, parse one
 * or more indexes that follow it.
 *
 * At most `maxIndexes` indexes are consumed: a single `\int` claims one
 * differential, `\iint` two, etc. Any further differentials belong to the
 * enclosing integral(s) of a nested expression and are left untouched.
 */
function parseIndexes(parser: Parser, maxIndexes: number): string[] {
  const indexes: string[] = [];
  while (indexes.length < maxIndexes && matchDifferentialOperator(parser)) {
    parser.skipVisualSpace();
    const index = symbol(parser.parseSymbol());
    if (index === null) return indexes;
    indexes.push(index);
  }

  return indexes;
}

/** Parse a sub expression that may contain indexes, for example `2xdx` */
function parseSubintegrand(
  expr: MathJsonExpression
): [body: MathJsonExpression | null, indexes: string[]] {
  const h = operator(expr);
  const op1 = operand(expr, 1);
  if (!op1) return [expr, []];

  if (h === 'Sequence' && nops(expr) === 1) return parseSubintegrand(op1);

  if (h === 'Multiply' || h === 'InvisibleOperator') {
    // Handle the case `3xdx` where the `dx` is the last term of a
    // multiplication (in a subexpression, i.e. `\sin 3xdx`)
    // There could be consecutive `dx` terms, e.g. `3xdxdy`, we
    // want to extract all of them.
    const args = operands(expr);

    if (args) {
      const [rest, indexes] = parseFinalDiffOperators(args);
      if (rest.length > 0) return [[h, ...rest], indexes];
      return [null, indexes];
    }
  } else if (h === 'Delimiter') {
    const [fn2, indexes] = parseSubintegrand(op1);
    if (indexes) {
      if (!fn2) {
        // The indexes were in parens: `\int f (dxdy)`
        return [null, indexes];
      }
      // A subexpression and the indexes were in parens:
      // `\int (3x + 2 dx)`
      return [
        ['Delimiter', ['Sequence', fn2], ...operands(expr).slice(1)],
        indexes,
      ];
    }
  } else if (h === 'Add') {
    const args = operands(expr);
    if (args.length > 0) {
      const [fn2, indexes] = parseSubintegrand(args[args.length - 1]);
      if (indexes.length > 0) {
        if (fn2) return [['Add', ...args.slice(0, -1), fn2], indexes];
        if (args.length > 2) return [['Add', ...args.slice(0, -1)], indexes];
        if (args.length > 2) return [args[0], indexes];
      }
    }
  } else if (h === 'Negate') {
    const [fn2, indexes] = parseSubintegrand(op1);
    if (indexes.length > 0) return [fn2 ? ['Negate', fn2] : null, indexes];
  } else if (h === 'Divide') {
    const [fn2, indexes] = parseSubintegrand(op1);
    if (indexes.length > 0)
      return [['Divide', fn2 ?? 1, operand(expr, 2)!], indexes];
  } else {
    // Some other function, e.g. trig function, etc...
    const args = operands(expr);
    if (args.length === 1) {
      //If it has a single argument, we'll check if it includes an index
      // e.g. \sin 2xdx
      const [arg2, indexes] = parseSubintegrand(args[0]);
      if (indexes.length > 0)
        return [[operator(expr), arg2] as MathJsonExpression, indexes];
    }
  }

  return [expr, []];
}

function serializeIntegral(command: string) {
  return (serializer: Serializer, expr: MathJsonExpression): string => {
    if (!operand(expr, 1)) return command;

    // The arguments of the Integrate command are:
    // - the integrand (a function to integrate) as a function literal:
    //    - either a ["Function", body, arg1, arg2] expression
    //    - or a symbol (e.g. "Sin")
    //    - or a shorthand function literal
    // - one or more limits of the form
    //    - limits(index, lower, upper) (the index must match the arguments  of the function)
    //    - limits(lower, upper)
    //    - tuple(index, lower, upper) or range(lower, upper)
    //    - index: symbol (an unknown, that must be an argument of the function)

    let body = operand(expr, 1);
    let args: ReadonlyArray<MathJsonExpression> = [];
    if (operator(body) === 'BuiltInFunction') {
      args = ['x'];
      body = [operand(body, 1) as string, 'x'];
    } else if (operator(body) === 'Function') {
      args = operands(body).slice(1);
      body = operand(body, 1);
    } else if (symbol(body)) {
      // A function literal, e.g. `\sin`, keep it as `\sin`
      args = [];
    } else {
      // A shorthand function literal, e.g. `\sin(x)`, keep the body as is.
      args = [];
    }

    const limits = operands(expr).slice(1);

    // We're going to build the prefix: the '\int' commands with limits, and the suffix, the dx, then put it all together
    const indexes: string[] = [];

    const prefix = limits.map((limit, i) => {
      if (symbol(limit) === 'Nothing') {
        indexes.push(symbol(args[i]) ?? 'Nothing');
        return '';
      }

      if (symbol(limit)) {
        indexes.push(symbol(limit) ?? 'Nothing');
        return '';
      }

      const h = operator(limit);
      // A 3-element `Tuple` limit serializes to MathJSON as `Triple` (see
      // serialize.ts arity mapping), so it must be recognized here too —
      // otherwise `CircularIntegrate`'s `Triple` limits fall through and emit
      // `\ointundefined`.
      if (
        h === 'Tuple' ||
        h === 'Triple' ||
        h === 'Pair' ||
        h === 'Limits' ||
        h === 'Range'
      ) {
        if (nops(limit) === 3) {
          const index = operand(limit, 1);
          indexes.push(symbol(index) ?? 'Nothing');
          let lower = operand(limit, 2);
          let upper = operand(limit, 3);
          if (symbol(lower) === 'Nothing') lower = null;
          if (symbol(upper) === 'Nothing') upper = null;

          if (lower !== null && upper !== null)
            return `_{${serializer.serialize(lower)}}^{${serializer.serialize(
              upper
            )}}`;
          if (lower !== null) return `_{${serializer.serialize(lower)}}`;
          if (upper !== null) return `^{${serializer.serialize(upper)}}`;
          return '';
        }
        return `_{${serializer.serialize(limit)}}`;
      }
      if (nops(limit) === 2) {
        if (symbol(operand(limit, 1))) {
          // Tuple["x", 1]
          indexes.push(symbol(operand(limit, 1)) ?? 'Nothing');
          const lower = operand(limit, 2);
          if (symbol(lower) === 'Nothing') return '';
          return `_{${serializer.serialize(lower)}}`;
        }
        // Tuple[1, 2]
        indexes.push(symbol(args[i]) ?? 'Nothing');

        let lower = operand(limit, 1);
        let upper = operand(limit, 2);
        if (symbol(lower) === 'Nothing') lower = null;
        if (symbol(upper) === 'Nothing') upper = null;

        if (lower !== null && upper !== null)
          return `_{${serializer.serialize(lower)}}^{${serializer.serialize(
            upper
          )}}`;
        if (lower !== null) return `_{${serializer.serialize(lower)}}`;
        if (upper !== null) return `^{${serializer.serialize(upper)}}`;
      } else {
        indexes.push(symbol(args[i]) ?? 'Nothing');
      }
    });

    let suffix = indexes
      .filter((x) => symbol(x) !== 'Nothing')
      .map((arg) => `\\mathrm{d}${serializer.serialize(symbol(arg) ?? 'x')}`);
    if (suffix.length > 0) suffix = ['\\,', ...suffix];

    if (prefix.length === 0)
      return `${command}\\,${serializer.serialize(body)}\\!${suffix.join(' ')}`;

    // A flat, single-level multiple integral (`["Integrate", f, limitsX,
    // limitsY]`, as produced by `\iint` / `\iiint`) serializes back to the
    // compact `\iint` / `\iiint` (or `\oiint` / `\oiiint`) sign rather than a
    // stack of `\int`s, so it round-trips to the same structure.
    const compactSign = compactMultiIntegralSign(command, prefix);
    if (compactSign !== null)
      return (
        compactSign + '\\!' + serializer.serialize(body) + suffix.join(' ')
      );

    // The order of the limits is reversed
    return (
      prefix
        .reverse()
        .map((x) => `${command}${x}`)
        .join('') +
      '\\!' +
      serializer.serialize(body) +
      suffix.join(' ')
    );
  };
}

/** The compact multi-sign command (`\iint` / `\iiint` / `\oiint` / `\oiiint`)
 * for a flat 2- or 3-limit integral whose extra limits are bare, or `null` to
 * fall back to the iterated `\int…\int…` serialization. Those signs carry a
 * single region subscript, so every limit past the first must be bare —
 * otherwise the compact form would lose or garble per-variable bounds. (Nested
 * integrals serialize one limit per level and never reach here.) */
function compactMultiIntegralSign(
  command: string,
  prefix: ReadonlyArray<string | undefined>
): string | null {
  const n = prefix.length;
  if (n !== 2 && n !== 3) return null;
  const variants: Record<string, [twofold: string, threefold: string]> = {
    '\\int': ['\\iint', '\\iiint'],
    '\\oint': ['\\oiint', '\\oiiint'],
  };
  const variant = variants[command];
  if (!variant) return null;
  if (prefix.slice(1).some((p) => p)) return null;
  return variant[n - 2] + (prefix[0] ?? '');
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

  //
  // Series expansion, the inert `BigO` remainder, and `Normal`.
  //
  // An unevaluated `Series(...)` and `Normal(...)` serialize with
  // `\operatorname{…}` (and round-trip through the default `\operatorname`
  // parsing). `BigO(u)` serializes as `O\left(u\right)`; it is parsed from
  // `\mathcal{O}(…)` and `\operatorname{O}(…)` (there is deliberately no bare
  // `O(` capture).
  //
  {
    kind: 'expression',
    name: 'Series',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      '\\operatorname{Series}' + serializer.wrapArguments(expr),
  },
  {
    kind: 'expression',
    name: 'Normal',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      '\\operatorname{Normal}' + serializer.wrapArguments(expr),
  },
  {
    kind: 'expression',
    name: 'BigO',
    latexTrigger: ['\\mathcal', '<{>', 'O', '<}>'],
    parse: parseBigO,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      'O\\left(' + serializer.serialize(operand(expr, 1)) + '\\right)',
  },
  {
    kind: 'expression',
    latexTrigger: ['\\operatorname', '<{>', 'O', '<}>'],
    parse: parseBigO,
  },
];

function parseBigO(parser: Parser): MathJsonExpression {
  const args = parser.parseArguments();
  return args === null ? 'BigO' : ['BigO', ...args];
}

function matchDifferentialOperator(parser: Parser): boolean {
  const start = parser.index;

  // Skip \cdot (not correct, but used in the wild) and \, (thin space)
  while (parser.match('\\cdot') || parser.skipVisualSpace()) {}

  if (
    parser.matchAll(['\\mathrm', '<{>', 'd', '<}>']) ||
    parser.matchAll(['\\operatorname', '<{>', 'd', '<}>']) ||
    parser.match('d') ||
    parser.match('\\differentialD')
  ) {
    return true;
  }

  parser.index = start;
  return false;
}

function parseFinalDiffOperators(
  xs: ReadonlyArray<MathJsonExpression>
): [rest: ReadonlyArray<MathJsonExpression>, indexes: string[]] {
  let rest: ReadonlyArray<MathJsonExpression> = [...xs];
  const indexes: string[] = [];

  while (rest.length > 0) {
    let index: string;
    [rest, index] = parseFinalDiffOperator(rest);
    if (!index) break;
    indexes.push(index);
  }

  return [rest, indexes];
}

function parseFinalDiffOperator(
  expr: ReadonlyArray<MathJsonExpression>
): [rest: ReadonlyArray<MathJsonExpression>, index: string] {
  // If the second to last term is a differential operator, we capture the last term as the index

  if (expr.length < 2) return [expr, ''];

  const op = expr[expr.length - 2];

  if (op === 'd' || op === 'd_upright') {
    const index = symbol(expr[expr.length - 1]);
    if (index) return [expr.slice(0, -2), index];
  }
  return [expr, ''];
}
