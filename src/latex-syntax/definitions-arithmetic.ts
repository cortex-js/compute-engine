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
  MULTIPLY,
  DIVIDE,
  POWER,
  MISSING,
  LIST,
  IMAGINARY_UNIT,
} from '../common/utils';
import { joinLatex } from './core/tokenizer';
import { getFractionStyle, getRootStyle } from './serializer-style';
import { applyNegate } from '../compute-engine/dictionary/arithmetic';
import { Numeric } from '../compute-engine/public';

/**
 * If expression is a product, collect all the terms with a
 * negative exponents in the denominator, and all the terms
 * with a positive exponent (or no exponent) in the numerator.
 */
function numeratorDenominator(expr: Expression): [Expression[], Expression[]] {
  if (getFunctionName(expr) !== MULTIPLY) return [[], []];
  const numerator: Expression[] = [];
  const denominator: Expression[] = [];
  const args = getTail(expr);
  for (const arg of args) {
    if (getFunctionName(arg) === POWER) {
      if (getFunctionName(getArg(arg, 2)) === NEGATE) {
        const a = getArg(arg, 1) ?? NOTHING;
        const b = getArg(getArg(arg, 2), 1) ?? NOTHING;
        denominator.push([POWER, a, b]);
      } else {
        const exponentVal = getNumberValue(getArg(arg, 2)) ?? NaN;
        if (exponentVal === -1) {
          denominator.push(getArg(arg, 1) ?? NOTHING);
        } else if (exponentVal < 0) {
          denominator.push([
            POWER,
            getArg(arg, 1) ?? NOTHING,
            applyNegate(getArg(arg, 2)!) ?? NOTHING,
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
  base: Expression | null,
  degree: Expression | null
): string {
  if (base === null) return '\\sqrt{}';
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
          const [numer, denom] = getRationalValue(arg);
          if (numer !== null && denom !== null) {
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

  // "Multiply" doesn't increase the "level" for styling purposes
  // so, preventively decrease it now.
  serializer.level -= 1;

  let result = '';

  //
  // Is it a fraction?
  // (i.e. does it have a denominator, i.e. some factors with a negative power)
  //
  const [numer, denom] = numeratorDenominator(expr);
  if (denom.length > 0) {
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
  let prevWasNumber = false;
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
        prevWasNumber = true;
      } else if (
        getFunctionName(arg) === POWER &&
        !isNaN(getNumberValue(getArg(arg, 1)) ?? NaN)
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
        prevWasNumber = true;
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
          if (prevWasNumber && getFunctionName(arg) === DIVIDE) {
            // Can't use an invisible multiply if a number
            // multiplied by a fraction
            result = joinLatex([result, '\\times', term]);
          }
          // Not first term, use invisible multiply
          else if (!serializer.options.invisibleMultiply) {
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
        prevWasNumber = false;
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
    let fn = getArg(numer, 1);
    if (fn === null || fn === MISSING) {
      fn = scanner.matchExpression() ?? NOTHING;
    }

    let vars: Expression[] = [];
    if (getFunctionName(denom) === MULTIPLY) {
      // ?/∂x∂y
      for (const arg of getTail(denom)) {
        if (getFunctionHead(arg) === 'PartialDerivative') {
          const v = getArg(arg, 2);
          if (v) vars.push(v);
        }
      }
    } else {
      // ?/∂x
      const v = getArg(denom, 2);
      if (v) vars.push(v);
    }
    if (vars.length > 1) {
      vars = [LIST, ...vars];
    }

    return [
      lhs,
      ['PartialDerivative', fn, vars, degree === MISSING ? 1 : degree],
    ];
  }

  return [lhs, [DIVIDE, numer, denom]];
}

function serializeFraction(
  serializer: Serializer,
  expr: Expression | null
): string {
  console.assert(getFunctionName(expr) === DIVIDE);
  if (expr === null) return '';
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
  const val2 = getNumberValue(arg2) ?? 1;
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

export const DEFINITIONS_ARITHMETIC: LatexDictionary<Numeric> = [
  { name: 'ThreeQuarter', serialize: '\\frac{3}{4}' },
  { name: 'TwoThird', serialize: '\\frac{2}{3}' },
  { name: 'Half', serialize: '\\frac{1}{2}' },
  { name: 'Third', serialize: '\\frac{1}{3}' },
  { name: 'Quarter', serialize: '\\frac{1}{4}' },
  { name: 'CatalanConstant', serialize: 'G' },
  { name: 'GoldenRatio', serialize: '\\varphi' },
  { name: 'EulerGamma', serialize: '\\gamma' },
  { name: 'Degrees', serialize: '\\frac{\\pi}{180}' },
  { name: 'MinusDoublePi', serialize: '-2\\pi' },
  { name: 'MinusPi', serialize: '-\\pi' },
  { name: 'MinusHalfPi', serialize: '-\\frac{\\pi}{2}' },
  { name: 'QuarterPi', serialize: '\\frac{\\pi}{4}' },
  { name: 'ThirdPi', serialize: '\\frac{\\pi}{3}' },
  { name: 'HalfPi', serialize: '\\frac{\\pi}{2}' },
  { name: 'TwoThirdPi', serialize: '\\frac{2\\pi}{3}' },
  { name: 'ThreeQuarterPi', serialize: '\\frac{3\\pi}{4}' },
  { name: 'DoublePi', serialize: '2\\pi' },

  {
    name: 'Complex',
    precedence: 275, // Same precedence as `Add`
    serialize: (
      serializer: Serializer<Numeric>,
      expr: Expression<Numeric>
    ): string => {
      // Note: we should not have ['Complex'] functions in canonical expressions
      // but this is just in case...

      const re = getNumberValue(getArg(expr, 1));
      const im = getNumberValue(getArg(expr, 2));
      if (im === 0) return serializer.serialize(getArg(expr, 1));

      const imPart =
        im === 1
          ? '\\imaginaryI'
          : im === -1
          ? '-\\imaginaryI'
          : joinLatex([serializer.serialize(getArg(expr, 2)), '\\imaginaryI']);
      if (re === 0) return imPart;
      return joinLatex([serializer.serialize(getArg(expr, 1)), '+', imPart]);
    },
  },
  {
    name: 'Exp',
    serialize: (
      serializer: Serializer<Numeric>,
      expr: Expression<Numeric>
    ): string => {
      return joinLatex([
        '\\exponentialE^{',
        serializer.serialize(getArg(expr, 1) ?? NOTHING),
        '}',
      ]);
    },
  },
  {
    name: 'Square',
    serialize: (
      serializer: Serializer<Numeric>,
      expr: Expression<Numeric>
    ): string => serializer.wrapShort(getArg(expr, 1)) + '^2',
  },

  { trigger: { symbol: '\\infty' }, parse: { num: '+Infinity' } },
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
  { name: IMAGINARY_UNIT, trigger: { symbol: 'i' }, serialize: '\\imaginaryI' },
  { name: IMAGINARY_UNIT, trigger: { symbol: '\\imaginaryI' } },
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
    precedence: 275,
  },
  {
    name: SUBTRACT,
    trigger: { infix: '-' },
    parse: parseMinusSign,
    associativity: 'both',
    precedence: 275,
  },
  {
    name: 'PlusMinus',
    trigger: { infix: '\\pm' },
    associativity: 'both',
    precedence: 270,
  },
  {
    name: 'MinusPlus',
    trigger: { infix: '\\mp' },
    associativity: 'both',
    precedence: 270,
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
  {
    name: 'Lcm',
    trigger: { symbol: ['\\operatorname', '<{>', 'l', 'c', 'm', '<}>'] },
  },
  {
    name: 'Gcd',
    trigger: { symbol: ['\\operatorname', '<{>', 'g', 'c', 'd', '<}>'] },
  },
  {
    name: 'Ceil',
    trigger: { symbol: ['\\operatorname', '<{>', 'c', 'e', 'i', 'l', '<}>'] },
  },
  {
    name: 'Floor',
    trigger: {
      symbol: ['\\operatorname', '<{>', 'f', 'l', 'o', 'o', 'r', '<}>'],
    },
  },
  {
    name: 'Round',
    trigger: {
      symbol: ['\\operatorname', '<{>', 'r', 'o', 'u', 'n', 'd', '<}>'],
    },
  },
  {
    name: 'Sign',
    trigger: {
      // As per ISO 80000-2, "signum" is 'sgn'
      symbol: ['\\operatorname', '<{>', 's', 'g', 'n', '<}>'],
    },
  },
];
