import { Expression } from '../public';
import { Scanner, LatexDictionary, Serializer } from './public';
import {
  getFunctionName,
  getTail,
  getArg,
  getNumberValue,
  getArgCount,
  getRationalValue,
  isNumberObject,
  getFunctionHead,
  SQRT,
  ROOT,
  NOTHING,
  NEGATE,
  SUBTRACT,
  ADD,
  COMPLEX_INFINITY,
  PI,
  EXPONENTIAL_E,
  IMAGINARY_I,
  MULTIPLY,
  DIVIDE,
  POWER,
  MISSING,
  LIST,
} from '../common/utils';
import { applyNegate } from '../compute-engine/forms';
import { joinLatex } from './core/tokenizer';
import { getFractionStyle, getRootStyle } from './serializer-style';

/**
 * If expression is a product, collect all the terms with a
 * negative exponents in the denominator, and all the terms
 * with a positive exponent (or no exponent) in the numerator.
 */
function numeratorDenominator(
  expr: Expression
): [Expression[] | null, Expression[] | null] {
  if (getFunctionName(expr) !== MULTIPLY) return [null, null];
  const numerator: Expression[] = [];
  const denominator: Expression[] = [];
  const args = getTail(expr);
  for (const arg of args) {
    if (getFunctionName(arg) === POWER) {
      if (getFunctionName(getArg(arg, 2)) === NEGATE) {
        denominator.push([POWER, getArg(arg, 1), getArg(getArg(arg, 2), 1)]);
      } else {
        const exponentVal = getNumberValue(getArg(arg, 2)) ?? NaN;
        if (exponentVal === -1) {
          denominator.push(getArg(arg, 1));
        } else if (exponentVal < 0) {
          denominator.push([
            POWER,
            getArg(arg, 1),
            applyNegate(getArg(arg, 2)),
          ]);
        } else {
          numerator.push(arg);
        }
      }
    } else {
      numerator.push(arg);
    }
  }
  return [numerator, denominator];
}

function serializeRoot(
  serializer: Serializer,
  style: 'radical' | 'quotient' | 'solidus',
  base: Expression,
  degree: Expression
): string {
  degree = degree ?? 2;
  if (style === 'solidus') {
    return (
      serializer.wrapShort(base) + '^{1\\/' + serializer.serialize(degree) + '}'
    );
  } else if (style === 'quotient') {
    return (
      serializer.wrapShort(base) +
      '^{\\frac{1}{' +
      serializer.serialize(degree) +
      '}}'
    );
  }

  const degreeValue = getNumberValue(degree);
  if (degreeValue === 2) {
    return '\\sqrt{' + serializer.serialize(base) + '}';
  }

  // It's the n-th root
  return (
    '\\sqrt[' +
    serializer.serialize(degree) +
    ']{' +
    serializer.serialize(base) +
    '}'
  );
}

function parseRoot(
  lhs: Expression,
  scanner: Scanner,
  _minPrec: number
): [Expression | null, Expression | null] {
  if (!scanner.match('\\sqrt')) return [lhs, null];
  const degree = scanner.matchOptionalLatexArgument();
  const base = scanner.matchRequiredLatexArgument();
  if (base === null) {
    if (degree !== null) return [lhs, [ROOT, NOTHING, degree]];
    return [lhs, [SQRT]];
  }
  if (degree !== null) return [lhs, [ROOT, base, degree]];
  return [lhs, [SQRT, base]];
}

function parseMinusSign(
  lhs: Expression,
  scanner: Scanner,
  minPrec: number
): [Expression | null, Expression | null] {
  if (276 < minPrec) return [lhs, null];
  const index = scanner.index;
  if (!scanner.match('-')) return [lhs, null];
  const rhs = scanner.matchExpression(lhs === null ? 400 : 277);
  if (rhs === null) {
    scanner.index = index;
    return [lhs, null];
  }
  if (lhs === null) return [null, [NEGATE, rhs]];
  return [null, [SUBTRACT, lhs, rhs]];
}

function parsePlusSign(
  lhs: Expression,
  scanner: Scanner,
  minPrec: number
): [Expression | null, Expression | null] {
  if (275 < minPrec) return [lhs, null];
  const index = scanner.index;
  if (!scanner.match('+')) return [lhs, null];
  const rhs = scanner.matchExpression(lhs === null ? 400 : 275);
  if (rhs === null) {
    scanner.index = index;
    return [lhs, null];
  }
  if (lhs === null) return [null, rhs];
  return scanner.applyOperator(ADD, lhs, rhs);
}

function serializeAdd(serializer: Serializer, expr: Expression): string {
  // "add" doesn't increase the "level" for styling purposes
  // so, preventatively decrease it now.
  serializer.level -= 1;

  const name = getFunctionName(expr);
  let result = '';
  let arg = getArg(expr, 1);
  let argWasNumber = !Number.isNaN(getNumberValue(arg) ?? NaN);
  if (name === NEGATE) {
    result = '-' + serializer.wrap(arg, 276);
  } else if (name === ADD) {
    result = serializer.serialize(arg);
    const last = getArgCount(expr) + 1;
    for (let i = 2; i < last; i++) {
      arg = getArg(expr, i);
      const val = getNumberValue(arg) ?? NaN;
      const argIsNumber = !Number.isNaN(val);
      let done = false;
      if (arg !== null) {
        if (argWasNumber) {
          // Check if we can convert to an invisible plus, e.g. "1\frac{1}{2}"
          const rational = getRationalValue(arg);
          if (rational) {
            const [numer, denom] = rational;
            if (isFinite(numer) && isFinite(denom) && denom !== 1) {
              // Don't include the '+' sign, it's a rational, use 'invisible plus'
              result +=
                serializer.options.invisiblePlus + serializer.serialize(arg);
              done = true;
            }
          }
        }
      }
      if (!done) {
        if (val < 0) {
          // Don't include the minus sign, it will be serialized for the arg
          result += serializer.serialize(arg);
        } else if (getFunctionName(arg) === NEGATE) {
          result += serializer.wrap(arg, 275);
        } else {
          const term = serializer.wrap(arg, 275);
          if (term[0] === '-' || term[0] === '+') {
            result += term;
          } else {
            result = result + '+' + term;
          }
        }
      }
      argWasNumber = argIsNumber;
    }
  } else if (name === SUBTRACT) {
    const arg2 = getArg(expr, 2);
    if (arg2 !== null) {
      result = serializer.wrap(arg, 275) + '-' + serializer.wrap(arg2, 275);
    } else {
      result = serializer.wrap(arg, 275);
    }
  }

  // Restore the level
  serializer.level += 1;

  return result;
}

function serializeMultiply(
  serializer: Serializer,
  expr: Expression | null
): string {
  if (expr === null) return '';

  // "multiply" doesn't increase the "level" for styling purposes
  // so, preventively decrease it now.
  serializer.level -= 1;

  let result = '';

  //
  // Is it a fraction?
  // (i.e. does it have a denominator, i.e. some factors with a negative power)
  //
  const [numer, denom] = numeratorDenominator(expr);
  if (numer !== null && denom !== null && denom.length > 0) {
    if (denom.length === 1 && denom[0] === 1) {
      if (numer.length === 0) {
        result = '1';
      } else if (numer.length === 1) {
        result = serializer.serialize(numer[0]);
      } else {
        result = serializeMultiply(serializer, [MULTIPLY, ...numer]);
      }
    } else {
      result = serializer.serialize([
        DIVIDE,
        numer.length === 1 ? numer[0] : [MULTIPLY, ...numer],
        denom.length === 1 ? denom[0] : [MULTIPLY, ...denom],
      ]);
    }
  }
  if (result) {
    // Restore the level
    serializer.level += 1;
    return result;
  }

  let isNegative = false;
  let arg: Expression | null = null;
  const count = getArgCount(expr) + 1;
  for (let i = 1; i < count; i++) {
    arg = getArg(expr, i);
    if (arg !== null) {
      let term: string;
      //
      // 1. Should the terms be separated by an explicit MULTIPLY?
      //
      if (typeof arg === 'number' || isNumberObject(arg)) {
        term = serializer.serialize(arg);
        if (term === '-1' && !result) {
          result = '-';
        } else {
          if (term[0] === '-') {
            term = term.slice(1);
            isNegative = !isNegative;
          }
          result = result
            ? joinLatex([result, serializer.options.multiply, term])
            : term;
        }
      } else if (
        getFunctionName(arg) === POWER &&
        !isNaN(getNumberValue(getArg(arg, 1) ?? NaN))
      ) {
        // It's a power and the base is a number...
        // add a multiply...
        result = result
          ? joinLatex([
              result,
              serializer.options.multiply,
              serializer.serialize(arg),
            ])
          : serializer.serialize(arg);
      } else {
        if (getFunctionName(arg) === NEGATE) {
          arg = getArg(arg, 1);
          isNegative = !isNegative;
        }
        // 2.1 Wrap the term if necessary
        // (if it's an operator of precedence less than 390)
        term = serializer.wrap(arg, 390);

        // 2.2. The terms can be separated by an invisible multiply.
        if (!result) {
          // First term
          result = term;
        } else {
          // Not first term, use invisible multiply
          if (!serializer.options.invisibleMultiply) {
            // Replace, joining the terms correctly
            // i.e. inserting a space between '\pi' and 'x'
            result = joinLatex([result, term]);
          } else {
            result = joinLatex([
              result,
              serializer.options.invisibleMultiply,
              term,
            ]);
          }
        }
      }
    }
  }

  // Restore the level
  serializer.level += 1;

  return isNegative ? '-' + result : result;
}

function parseFraction(
  lhs: Expression,
  scanner: Scanner,
  _minPrec: number
): [Expression | null, Expression | null] {
  if (!scanner.match('\\frac')) return [lhs, null];
  const numer = scanner.matchRequiredLatexArgument() ?? MISSING;
  const denom = scanner.matchRequiredLatexArgument() ?? MISSING;
  if (
    getFunctionName(numer) === 'PartialDerivative' &&
    (getFunctionName(denom) === 'PartialDerivative' ||
      (getFunctionName(denom) === MULTIPLY &&
        getFunctionName(getArg(denom, 1)) === 'PartialDerivative'))
  ) {
    // It's a Leibniz notation partial derivative
    // `∂f(x)/∂x` or `∂^2f(x)/∂x∂y` or `∂/∂x f(x)`
    const degree: Expression = getArg(numer, 3) ?? NOTHING;
    // Expect: getArg(numer, 2) === NOTHING -- no args
    let fn: Expression = getArg(numer, 1);
    if (fn === null || fn === NOTHING) {
      fn = scanner.matchExpression() ?? NOTHING;
    }

    let vars: Expression[] = [];
    if (getFunctionName(denom) === MULTIPLY) {
      // ?/∂x∂y
      for (const arg of getTail(denom)) {
        if (getFunctionHead(arg) === 'PartialDerivative') {
          vars.push(getArg(arg, 2));
        }
      }
    } else {
      // ?/∂x
      vars.push(getArg(denom, 2));
    }
    if (vars.length > 1) {
      vars = [LIST, ...vars];
    }

    return [
      lhs,
      ['PartialDerivative', fn, vars, degree === NOTHING ? 1 : degree],
    ];
  }

  return [lhs, [DIVIDE, numer, denom]];
}

function serializeFraction(
  serializer: Serializer,
  expr: Expression | null
): string {
  console.assert(getFunctionName(expr) === DIVIDE);
  if (getArgCount(expr) === 1) return serializer.serialize(getArg(expr, 1));
  const style = getFractionStyle(expr, serializer.level);
  if (style === 'inline-solidus' || style === 'nice-solidus') {
    const numerStr = serializer.wrapShort(getArg(expr, 1));
    const denomStr = serializer.wrapShort(getArg(expr, 2));

    if (style === 'nice-solidus') {
      return `^{${numerStr}}\\!\\!/\\!_{${denomStr}}`;
    }
    return `${numerStr}\\/${denomStr}`;
  } else if (style === 'reciprocal') {
    return (
      serializer.wrap(getArg(expr, 1)) +
      serializer.wrap(getArg(expr, 2)) +
      '^{-1}'
    );
  } else if (style === 'factor') {
    return (
      '\\frac{1}{' +
      serializer.serialize(getArg(expr, 2)) +
      '}' +
      serializer.wrap(getArg(expr, 1))
    );
  }
  // Quotient (default)
  return (
    '\\frac{' +
    serializer.serialize(getArg(expr, 1)) +
    '}{' +
    serializer.serialize(getArg(expr, 2)) +
    '}'
  );
}

function serializePower(
  serializer: Serializer,
  expr: Expression | null
): string {
  const arg1 = getArg(expr, 1);
  const arg2 = getArg(expr, 2);
  if (arg2 === null) {
    return serializer.serialize(arg1);
  }
  if (arg1 === null) {
    return '';
  }
  const name = getFunctionName(expr);
  if (name === SQRT || name === ROOT) {
    const style = getRootStyle(expr, serializer.level);
    return serializeRoot(serializer, style, getArg(expr, 1), getArg(expr, 2));
  }
  const val2 = getNumberValue(arg2);
  if (val2 === -1) {
    return serializer.serialize([DIVIDE, '1', arg1]);
  } else if (val2 < 0) {
    return serializer.serialize([DIVIDE, '1', [POWER, arg1, -val2]]);
  } else if (getFunctionName(arg2) === DIVIDE) {
    if (getNumberValue(getArg(arg2, 1)) === 1) {
      // It's x^{1/n} -> it's a root
      const style = getRootStyle(expr, serializer.level);
      return serializeRoot(serializer, style, arg1, getArg(arg2, 2));
    }
  } else if (getFunctionName(arg2) === POWER) {
    if (getNumberValue(getArg(arg2, 2)) === -1) {
      // It's x^{n^-1} -> it's a root
      const style = getRootStyle(expr, serializer.level);
      return serializeRoot(serializer, style, arg1, getArg(arg2, 1));
    }
  }
  return serializer.wrapShort(arg1) + '^{' + serializer.serialize(arg2) + '}';
}

export const DEFINITIONS_ARITHMETIC: LatexDictionary = [
  { trigger: { symbol: '\\infty' }, parse: { num: 'Infinity' } },
  {
    name: COMPLEX_INFINITY,
    trigger: { symbol: ['\\tilde', '\\infty'] },
    serialize: '\\tilde\\infty',
  },
  {
    name: COMPLEX_INFINITY,
    trigger: { symbol: ['\\tilde', '<{>', '\\infty', '<}>'] },
    serialize: '\\tilde\\infty',
  },
  { name: PI, trigger: { symbol: '\\pi' } },
  { name: PI, trigger: { symbol: 'π' }, serialize: '\\pi' },
  { name: EXPONENTIAL_E, trigger: { symbol: 'e' }, serialize: 'e' },
  { name: IMAGINARY_I, trigger: { symbol: 'i' }, serialize: '\\imaginaryI' },
  { name: IMAGINARY_I, trigger: { symbol: '\\imaginaryI' } },
  {
    name: ADD,
    trigger: { prefix: '+', infix: '+' },
    parse: parsePlusSign,
    serialize: serializeAdd,
    associativity: 'both',
    precedence: 275,
  },
  {
    name: NEGATE,
    trigger: { prefix: '-' },
    parse: parseMinusSign,
    associativity: 'left', // prefix are always left-associative
    precedence: 665, // ??? MathML: 275. Needs to be higher than add, multiply
  },
  {
    name: SUBTRACT,
    trigger: { infix: '-' },
    parse: parseMinusSign,
    associativity: 'both',
    precedence: 275,
  },
  {
    name: MULTIPLY,
    trigger: { infix: '\\times' },
    serialize: serializeMultiply,
    associativity: 'both',
    precedence: 390,
  },
  {
    name: MULTIPLY,
    trigger: { infix: '\\cdot' },
    serialize: serializeMultiply,
    associativity: 'both',
    precedence: 390,
  },
  {
    name: MULTIPLY,
    trigger: { infix: '*' },
    serialize: serializeMultiply,
    associativity: 'both',
    precedence: 390,
  },
  {
    name: DIVIDE,
    trigger: '\\frac',
    // For \frac specifically, not for \div, etc..
    // handles Leibnitz notation for partial derivatives
    parse: parseFraction,
    serialize: serializeFraction,
    requiredLatexArg: 2,
  },
  {
    name: DIVIDE,
    trigger: { infix: '\\/' },
    serialize: serializeFraction,
    associativity: 'non',
    precedence: 660, // ??? MathML has 265, but it's wrong.
    // It has to be at least higher than multiply
    // e.g. `1/2+3*x` -> `1/2 + 3*x` , not `1/(2+3*x)`
  },
  {
    name: DIVIDE,
    trigger: { infix: '/' },
    serialize: serializeFraction,
    associativity: 'non',
    precedence: 660,
  },
  {
    name: DIVIDE,
    trigger: { infix: '\\div' },
    serialize: serializeFraction,
    associativity: 'non',
    precedence: 660, // ??? according to MathML
  },
  {
    name: POWER,
    trigger: { infix: '^' },
    associativity: 'non',
    precedence: 720,
    serialize: serializePower,
  },
  {
    name: POWER,
    trigger: { infix: ['*', '*'] },
    associativity: 'non',
    precedence: 720,
    serialize: serializePower,
  },
  {
    name: SQRT,
    trigger: '\\sqrt',
    optionalLatexArg: 1,
    requiredLatexArg: 1,
    parse: parseRoot,
    serialize: serializePower,
  },
  {
    name: ROOT,
    trigger: '\\sqrt',
    optionalLatexArg: 1,
    requiredLatexArg: 1,
    parse: parseRoot,
  },

  {
    /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    trigger: { matchfix: '\\lVert' },
    closeFence: '\\rVert',
  },
  {
    /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    trigger: { matchfix: '\\|' },
    closeFence: '\\|',
  },
  {
    /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    trigger: { matchfix: ['|', '|'] },
    closeFence: ['|', '|'],
  },
  {
    /** Could be the determinant if the argument is a matrix */
    /** @todo: domain check */
    /** If a literal matrix, the `serialize` should be custom, the parens are
     * replaced with bars */
    name: 'Abs',
    trigger: { matchfix: '|' },
    closeFence: '|',
  },
  {
    name: 'Abs',
    trigger: { matchfix: '\\lvert' },
    closeFence: '\\rvert',
  },
  {
    name: 'Factorial',
    trigger: { postfix: '!' },
    precedence: 810,
  },
  {
    name: 'Factorial2',
    trigger: { postfix: ['!', '!'] },
    precedence: 810,
  },
];
