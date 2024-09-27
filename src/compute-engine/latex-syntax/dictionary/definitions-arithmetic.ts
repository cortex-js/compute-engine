import { Expression } from '../../../math-json/types.ts';
import {
  machineValue,
  foldAssociativeOperator,
  rationalValue,
  operand,
  nops,
  operator,
  operands,
  symbol,
  isEmptySequence,
  missingIfEmpty,
  isNumberExpression,
  MISSING,
  getSequence,
} from '../../../math-json/utils.ts';
import {
  Serializer,
  Parser,
  LatexDictionary,
  MULTIPLICATION_PRECEDENCE,
  ADDITION_PRECEDENCE,
  ARROW_PRECEDENCE,
  DIVISION_PRECEDENCE,
  POSTFIX_PRECEDENCE,
  COMPARISON_PRECEDENCE,
} from '../public.ts';
import { joinLatex, supsub } from '../tokenizer.ts';

/**
 * If expression is a product, collect all the terms with a
 * negative exponents in the denominator, and all the terms
 * with a positive exponent (or no exponent) in the numerator.
 */
function numeratorDenominator(expr: Expression): [Expression[], Expression[]] {
  if (operator(expr) !== 'Multiply') return [[], []];
  const numerator: Expression[] = [];
  const denominator: Expression[] = [];
  for (const arg of operands(expr)) {
    if (operator(arg) === 'Power') {
      const op1 = operand(arg, 1);
      const op2 = operand(arg, 2);
      if (operator(op2) === 'Negate') {
        const b = operand(op2, 1);
        if (op1 && b) denominator.push(['Power', op1, b]);
      } else {
        const exponentVal = machineValue(op2) ?? NaN;
        if (exponentVal === -1) {
          if (op1) denominator.push(op1);
        } else if (exponentVal < 0) {
          if (op1) denominator.push(['Power', op1, -exponentVal]);
        } else {
          numerator.push(arg);
        }
      }
    } else if (
      (operator(arg) === 'Rational' && nops(arg) === 2) ||
      operator(arg) === 'Divide'
    ) {
      const op1 = operand(arg, 1)!;
      const op2 = operand(arg, 2)!;
      if (machineValue(op1) !== 1) numerator.push(op1);
      if (machineValue(op2) !== 1) denominator.push(op2);
    } else {
      const r = rationalValue(arg);
      if (r !== null) {
        if (r[0] !== 1) numerator.push(r[0]);
        denominator.push(r[1]);
      } else numerator.push(arg);
    }
  }
  return [numerator, denominator];
}

function parseRoot(parser: Parser): Expression | null {
  const degree = parser.parseOptionalGroup();
  const base = parser.parseGroup() ?? parser.parseToken();
  if (isEmptySequence(base)) {
    if (degree !== null) return ['Root', MISSING, missingIfEmpty(degree)];
    return ['Sqrt', MISSING];
  }
  if (degree !== null) return ['Root', base, degree];
  return ['Sqrt', base];
}

function serializeRoot(
  serializer: Serializer,
  style: 'radical' | 'quotient' | 'solidus',
  base: Expression | null | undefined,
  degree: Expression | null | undefined
): string {
  if (base === null || base === undefined) return '\\sqrt{}';
  degree = degree ?? 2;
  if (style === 'solidus') {
    return (
      serializer.wrapShort(base) + '^{1/' + serializer.serialize(degree) + '}'
    );
  } else if (style === 'quotient') {
    return (
      serializer.wrapShort(base) +
      '^{\\frac{1}{' +
      serializer.serialize(degree) +
      '}}'
    );
  }

  const degreeValue = machineValue(degree);
  if (degreeValue === 2) return '\\sqrt{' + serializer.serialize(base) + '}';

  // It's the n-th root
  return (
    '\\sqrt[' +
    serializer.serialize(degree) +
    ']{' +
    serializer.serialize(base) +
    '}'
  );
}

function serializeAdd(serializer: Serializer, expr: Expression): string {
  // "add" doesn't increase the "level" for styling purposes
  // so, preventively decrease it now.
  serializer.level -= 1;

  const name = operator(expr);
  let result = '';
  let arg = operand(expr, 1);
  if (name === 'Negate') {
    result = '-' + serializer.wrap(arg, ADDITION_PRECEDENCE + 1);
  } else if (name === 'Subtract') {
    result = serializer.wrap(arg, ADDITION_PRECEDENCE);
    const arg2 = operand(expr, 2);
    if (arg2 !== null) {
      const term = serializer.wrap(arg2, ADDITION_PRECEDENCE);
      if (term[0] === '-') result += '+' + term.slice(1);
      else if (term[0] === '+') result += '-' + term.slice(1);
      else result = result + '-' + term;
    }
  } else if (name === 'Add') {
    // If it is the sum of an integer and a rational, use a special form
    // (e.g. 1 + 1/2 -> 1 1/2)
    if (
      serializer.options.prettify &&
      nops(expr) === 2 &&
      serializer.options.invisiblePlus !== '+'
    ) {
      const [op1, op2] = [operand(expr, 1), operand(expr, 2)];

      let [lhs, rhs] = [op1, op2];
      let lhsValue = machineValue(lhs);
      let rhsValue = rationalValue(rhs);
      if (lhsValue === null || rhsValue === null) {
        [lhs, rhs] = [op2, op1];
        lhsValue = machineValue(lhs);
        rhsValue = rationalValue(rhs);
      }

      if (lhsValue !== null && rhsValue !== null) {
        if (
          isFinite(lhsValue) &&
          Number.isInteger(lhsValue) &&
          lhsValue >= 0 &&
          lhsValue <= 1000 &&
          isFinite(rhsValue[0]) &&
          isFinite(rhsValue[1]) &&
          rhsValue[0] > 0 &&
          rhsValue[0] <= 100 &&
          rhsValue[1] <= 100
        ) {
          // Don't include the '+' sign, it's a rational, use 'invisible plus'
          result = joinLatex([
            serializer.serialize(lhs),
            serializer.options.invisiblePlus,
            serializer.serialize(rhs),
          ]);

          serializer.level += 1;
          return result;
        }
      }
    }

    // If we have (-a)+b, we want to render it as b-a
    if (serializer.options.prettify && nops(expr) === 2) {
      const [first, firstSign] = unsign(arg!);
      const [second, secondSign] = unsign(operand(expr, 2)!);
      if (firstSign < 0 && secondSign > 0) {
        result =
          serializer.wrap(second, ADDITION_PRECEDENCE) +
          '-' +
          serializer.wrap(first, ADDITION_PRECEDENCE);
        serializer.level += 1;
        return result;
      }
    }

    result = serializer.serialize(arg);
    const last = nops(expr) + 1;
    const ops = operands(expr);
    for (let i = 2; i < last; i++) {
      arg = ops[i - 1];
      if (serializer.options.prettify) {
        const [newArg, sign] = unsign(arg);
        const term = serializer.wrap(newArg, ADDITION_PRECEDENCE);
        if (sign > 0) {
          if (term.startsWith('+') || term.startsWith('-')) result += term;
          else result += '+' + term;
        } else {
          if (term.startsWith('+')) result += '-' + term.slice(1);
          else if (term.startsWith('-')) result += '+' + term.slice(1);
          else result += '-' + term;
        }
      } else {
        const term = serializer.wrap(arg, ADDITION_PRECEDENCE);
        if (term[0] === '-' || term[0] === '+') result += term;
        else result += '+' + term;
      }
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
  if (serializer.options.prettify === true) {
    const [numer, denom] = numeratorDenominator(expr);
    if (denom.length > 0) {
      if (denom.length === 1 && denom[0] === 1) {
        if (numer.length === 0) result = '1';
        else if (numer.length === 1) result = serializer.serialize(numer[0]);
        else result = serializeMultiply(serializer, ['Multiply', ...numer]);
      } else {
        result = serializer.serialize([
          'Divide',
          numer.length === 1 ? numer[0] : ['Multiply', ...numer],
          denom.length === 1 ? denom[0] : ['Multiply', ...denom],
        ]);
      }
    }
  }

  if (result) {
    // Restore the level
    serializer.level += 1;
    return result;
  }

  let isNegative = false;
  let arg: Expression | null | undefined = null;
  const count = nops(expr) + 1;
  let xs = operands(expr);

  if (serializer.options.prettify === true) {
    if (xs.length === 2) {
      if (isNumberExpression(xs[1]) && !isNumberExpression(xs[0])) {
        xs = [xs[1], xs[0]];
      }
    }
  }
  let prevWasNumber = false;
  for (let i = 1; i < count; i++) {
    arg = xs[i - 1];
    if (arg === null) continue;
    let term: string;
    //
    // 1. Should the terms be separated by an explicit 'Multiply'?
    //
    if (isNumberExpression(arg)) {
      term = serializer.serialize(arg);
      if (term === '-1' && !result) {
        result = '';
        isNegative = !isNegative;
      } else {
        if (term[0] === '-') {
          term = term.slice(1);
          isNegative = !isNegative;
        }
        result = !result
          ? term
          : joinLatex([result, serializer.options.multiply, term]);
      }
      prevWasNumber = true;
      continue;
    }

    if (operator(arg) === 'Power') {
      // It's a power with a fractional exponent,
      // it's a nth-root
      const r = rationalValue(operand(arg, 2));
      if (r !== undefined && r !== null) {
        const [n, d] = r;
        if (n === 1 && d !== null) {
          result += serializeRoot(
            serializer,
            serializer.rootStyle(arg, serializer.level),
            operand(arg, 1),
            d
          );
          prevWasNumber = false;
          continue;
        }
      }
    }

    if (
      operator(arg) === 'Power' &&
      !isNaN(machineValue(operand(arg, 1)) ?? NaN)
    ) {
      // It's a power and the base is a number...
      // add a multiply...
      term = serializer.serialize(arg);
      result = !result
        ? term
        : joinLatex([result, serializer.options.multiply, term]);
      prevWasNumber = true;
      continue;
    }

    if (operator(arg) === 'Negate') {
      arg = operand(arg, 1);
      isNegative = !isNegative;
    }
    // 2.1 Wrap the term if necessary
    // (if it's an operator of precedence less than MULTIPLICATION_PRECEDENCE)
    term = serializer.wrap(arg, MULTIPLICATION_PRECEDENCE);

    // 2.2. The terms can be separated by an invisible multiply.
    if (!result) {
      // First term
      result = term;
    } else {
      const h = operator(arg);
      if (prevWasNumber && (h === 'Divide' || h === 'Rational')) {
        // Can't use an invisible multiply if a number
        // multiplied by a fraction
        result = joinLatex([result, serializer.options.multiply, term]);
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

  // Restore the level
  serializer.level += 1;

  return isNegative ? '-' + result : result;
}

function parseFraction(parser: Parser): Expression | null {
  let numer: Expression | null = parser.parseGroup();
  let denom: Expression | null = null;
  if (numer === null) {
    numer = parser.parseToken();
    denom = parser.parseToken();
  } else {
    denom = parser.parseGroup();
  }
  numer = missingIfEmpty(numer);
  denom = missingIfEmpty(denom);
  if (
    operator(numer) === 'PartialDerivative' &&
    (operator(denom) === 'PartialDerivative' ||
      (operator(denom) === 'Multiply' &&
        operator(operand(denom, 1)) === 'PartialDerivative'))
  ) {
    // It's a Leibniz notation partial derivative
    // `∂f(x)/∂x` or `∂^2f(x)/∂x∂y` or `∂/∂x f(x)`
    const degree = operand(numer, 3) ?? null;
    // Expect: getArg(numer, 2) === 'Nothing' -- no args
    let fn = operand(numer, 1);
    if (fn === null || fn === undefined)
      fn = missingIfEmpty(parser.parseExpression());

    let vars: Expression[] = [];
    if (operator(denom) === 'Multiply') {
      // ?/∂x∂y
      for (const arg of operands(denom)) {
        if (operator(arg) === 'PartialDerivative') {
          const v = operand(arg, 2);
          if (v) vars.push(v);
        }
      }
    } else {
      // ?/∂x
      const v = operand(denom, 2);
      if (v) vars.push(v);
    }
    if (vars.length > 1) {
      vars = ['List', ...vars];
    }

    return ['PartialDerivative', fn, ...vars, degree === null ? 1 : degree];
  }

  return ['Divide', numer, denom];
}

function serializeFraction(
  serializer: Serializer,
  expr: Expression | null
): string {
  // console.assert(getFunctionName(expr) === 'Divide');
  if (expr === null) return '';

  const numer = missingIfEmpty(operand(expr, 1));
  const denom = missingIfEmpty(operand(expr, 2));

  const style = serializer.options.prettify
    ? serializer.fractionStyle(expr, serializer.level)
    : 'quotient';
  if (style === 'inline-solidus' || style === 'nice-solidus') {
    const numerStr = serializer.wrapShort(numer);
    const denomStr = serializer.wrapShort(denom);

    if (style === 'inline-solidus') return `${numerStr}/${denomStr}`;
    return `{}^{${numerStr}}\\!\\!/\\!{}_{${denomStr}}`;
  } else if (style === 'reciprocal') {
    if (machineValue(numer) === 1) return serializer.wrap(denom) + '^{-1}';
    return serializer.wrap(numer) + serializer.wrap(denom) + '^{-1}';
  } else if (style === 'factor') {
    if (machineValue(denom) === 1) return serializer.wrap(numer);
    return (
      '\\frac{1}{' +
      serializer.serialize(denom) +
      '}' +
      serializer.wrapString(
        serializer.serialize(numer),
        serializer.groupStyle(expr, 1)
      )
    );
  }

  // Quotient (default)
  let cmd = '\\frac';
  if (style === 'block-quotient') cmd = '\\dfrac';
  else if (style === 'inline-quotient') cmd = '\\tfrac';

  const numerLatex = serializer.serialize(numer);
  const denomLatex = serializer.serialize(denom);
  return `${cmd}{${numerLatex}}{${denomLatex}}`;
}

function serializePower(
  serializer: Serializer,
  expr: Expression | null
): string {
  if (!expr) return '';

  const name = operator(expr);
  const base = missingIfEmpty(operand(expr, 1));

  if (name === 'Sqrt') {
    return serializeRoot(
      serializer,
      serializer.rootStyle(expr, serializer.level - 1),
      base,
      2
    );
  }

  const exp = missingIfEmpty(operand(expr, 2));
  if (name === 'Root')
    return serializeRoot(
      serializer,
      serializer.rootStyle(expr, serializer.level - 1),
      base,
      exp
    );

  if (serializer.options.prettify) {
    const val2 = machineValue(exp) ?? 1;
    if (val2 === -1) {
      return serializer.serialize(['Divide', '1', base]);
    } else if (val2 < 0) {
      return serializer.serialize(['Divide', '1', ['Power', base, -val2]]);
    } else if (operator(exp) === 'Divide' || operator(exp) === 'Rational') {
      if (machineValue(operand(exp, 1)) === 1) {
        // It's x^{1/n} -> it's a root
        const style = serializer.rootStyle(expr, serializer.level);
        return serializeRoot(serializer, style, base, operand(exp, 2));
      }
      if (machineValue(operand(exp, 2)) === 2) {
        // It's x^(n/2) -> it's √x^n
        return `${serializer.serialize(['Sqrt', base])}${supsub(
          '^',
          serializer.serialize(operand(exp, 1))
        )}`;
      }
    } else if (operator(exp) === 'Power') {
      if (machineValue(operand(exp, 2)) === -1) {
        // It's x^{n^-1} -> it's a root
        const style = serializer.rootStyle(expr, serializer.level);
        return serializeRoot(serializer, style, base, operand(exp, 1));
      }
    }
  }
  return serializer.wrapShort(base) + supsub('^', serializer.serialize(exp));
}

export const DEFINITIONS_ARITHMETIC: LatexDictionary = [
  // Constants
  { name: 'CatalanConstant', identifierTrigger: 'G' },
  { name: 'GoldenRatio', latexTrigger: '\\varphi' },
  { name: 'EulerGamma', latexTrigger: '\\gamma' },
  {
    name: 'Degrees',
    latexTrigger: ['\\degree'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => ['Degrees', lhs],
    serialize: (serializer: Serializer, expr: Expression): string => {
      return joinLatex([serializer.serialize(operand(expr, 1)), '\\degree']);
    },
  },
  {
    latexTrigger: ['\\degree'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => ['Degrees', lhs],
  },
  {
    latexTrigger: ['^', '<{>', '\\circ', '<}>'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Degrees', lhs],
  },

  {
    latexTrigger: ['^', '\\circ'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Degrees', lhs],
  },
  {
    latexTrigger: ['°'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => ['Degrees', lhs],
  },

  {
    latexTrigger: ['\\ang'],
    parse: (parser: Parser): Expression => {
      const arg = parser.parseGroup();
      return (arg === null ? ['Degrees'] : ['Degrees', arg]) as Expression;
    },
  },
  {
    latexTrigger: ['\\infty'],
    parse: 'PositiveInfinity',
  },
  {
    name: 'PositiveInfinity',
    serialize: (serializer) => serializer.options.positiveInfinity,
  },
  {
    name: 'NegativeInfinity',
    serialize: (serializer) => serializer.options.negativeInfinity,
  },
  {
    name: 'ComplexInfinity',
    latexTrigger: ['\\tilde', '\\infty'],
    serialize: '\\tilde\\infty',
  },
  {
    latexTrigger: ['\\tilde', '<{>', '\\infty', '<}>'],
    parse: 'ComplexInfinity',
  },
  { name: 'Pi', kind: 'symbol', latexTrigger: ['\\pi'] },
  { latexTrigger: ['π'], parse: 'Pi' },
  {
    name: 'ExponentialE',
    latexTrigger: ['\\exponentialE'],
    parse: 'ExponentialE',
    serialize: '\\exponentialE',
  },
  {
    latexTrigger: '\\operatorname{e}',
    parse: 'ExponentialE',
  },
  {
    latexTrigger: '\\mathrm{e}',
    parse: 'ExponentialE',
  },
  {
    kind: 'function',
    identifierTrigger: 'exp',
    parse: 'Exp',
  },
  {
    latexTrigger: '\\exp',
    parse: 'Exp',
  },
  {
    name: 'ImaginaryUnit',
    latexTrigger: ['\\imaginaryI'],
  },
  {
    latexTrigger: '\\operatorname{i}',
    parse: 'ImaginaryUnit',
  },
  {
    latexTrigger: '\\mathrm{i}',
    parse: 'ImaginaryUnit',
  },

  // Operations
  {
    /** Could be the determinant if the argument is a matrix */
    /** @todo: domain check */
    /** If a literal matrix, the `serialize` should be custom, the parens are
     * replaced with bars */
    name: 'Abs',
    kind: 'matchfix',
    openTrigger: '|',
    closeTrigger: '|',
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Abs', body]),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\vert'],
    closeTrigger: ['\\vert'],
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Abs', body]),
  },
  {
    identifierTrigger: 'abs',
    kind: 'function',
    parse: 'Abs',
  },
  {
    name: 'Add',
    latexTrigger: ['+'],
    kind: 'infix',
    associativity: 'any',
    precedence: ADDITION_PRECEDENCE,
    parse: (parser, lhs, until) => {
      const rhs = parser.parseExpression({
        ...until,
        minPrec: ADDITION_PRECEDENCE,
      });
      // If we did not see a valid rhs, it is important to return null
      // to give a chance to something else to continue the parsing
      // This is the case for |a+|b||.
      if (rhs === null) return null;

      return foldAssociativeOperator('Add', lhs, rhs);
    },
    serialize: serializeAdd,
  },
  {
    kind: 'prefix',
    latexTrigger: ['+'],
    precedence: ADDITION_PRECEDENCE,
    parse: (parser, until) => {
      return parser.parseExpression({ ...until, minPrec: 400 });
    },
  },
  {
    name: 'Ceil',
    kind: 'matchfix',
    openTrigger: '\\lceil',
    closeTrigger: '\\rceil',
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Ceil', body]),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u2308'], // ⌈ U+2308 LEFT CEILING
    closeTrigger: ['\u2309'], // ⌉ U+2309 RIGHT CEILING
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Ceil', body]),
  },
  {
    identifierTrigger: 'ceil',
    kind: 'function',
    parse: 'Ceil',
  },
  { name: 'Chop', identifierTrigger: 'chop', kind: 'function', parse: 'Chop' },
  {
    name: 'Complex',
    precedence: ADDITION_PRECEDENCE - 1, // One less than precedence of `Add`: used for correct wrapping
    serialize: (serializer: Serializer, expr: Expression): string => {
      const rePart = serializer.serialize(operand(expr, 1));

      const im = machineValue(operand(expr, 2));
      if (im === 0) return rePart;

      const imPart =
        im === 1
          ? '\\imaginaryI'
          : im === -1
            ? '-\\imaginaryI'
            : joinLatex([
                serializer.serialize(operand(expr, 2)),
                '\\imaginaryI',
              ]);

      const re = machineValue(operand(expr, 1));
      if (re === 0) return imPart;

      if (im !== null && im < 0) return joinLatex([rePart, imPart]);

      return joinLatex([rePart, '+', imPart]);
    },
  },
  {
    name: 'Divide',
    latexTrigger: '\\frac',
    precedence: DIVISION_PRECEDENCE,
    // For \frac specifically, not for \div, etc..
    // handles Leibnitz notation for partial derivatives
    parse: parseFraction,
    serialize: serializeFraction,
  },
  {
    kind: 'infix',
    latexTrigger: '\\over',
    associativity: 'none', // In LaTeX, the \over command is not associative
    precedence: DIVISION_PRECEDENCE,
    parse: 'Divide',
  },
  {
    // The \/ command is recognized by MathLive, but not by KaTeX, so we
    // try to avoid generating it.
    latexTrigger: ['\\/'],
    kind: 'infix',
    associativity: 'left',
    precedence: DIVISION_PRECEDENCE, // ??? MathML has 265, but it's wrong.
    // It has to be at least higher than multiply
    // e.g. `1/2+3*x` -> `1/2 + 3*x` , not `1/(2+3*x)`
    parse: 'Divide',
  },
  {
    latexTrigger: ['/'],
    kind: 'infix',
    associativity: 'left',
    precedence: DIVISION_PRECEDENCE,
    parse: 'Divide',
  },
  {
    latexTrigger: ['\\div'],
    kind: 'infix',
    associativity: 'left',
    precedence: DIVISION_PRECEDENCE, // ??? according to MathML
    parse: 'Divide',
  },
  {
    name: 'Exp',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const op1 = operand(expr, 1);
      if (symbol(op1) || machineValue(op1) !== null)
        return joinLatex(['\\exponentialE^{', serializer.serialize(op1), '}']);

      return joinLatex(['\\exp', serializer.wrap(missingIfEmpty(op1))]);
    },
  },
  {
    name: 'Factorial',
    latexTrigger: ['!'],
    kind: 'postfix',
    precedence: POSTFIX_PRECEDENCE,
  },
  {
    name: 'Factorial2',
    latexTrigger: ['!', '!'],
    kind: 'postfix',
    precedence: POSTFIX_PRECEDENCE,
  },
  {
    name: 'Floor',
    kind: 'matchfix',
    openTrigger: '\\lfloor',
    closeTrigger: '\\rfloor',
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Floor', body]),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u230a'], // ⌊ U+230A LEFT FLOOR
    closeTrigger: ['\u230b'], // ⌋ U+230B RIGHT FLOOR
    parse: (_parser, body) => (isEmptySequence(body) ? null : ['Floor', body]),
  },
  {
    identifierTrigger: 'floor',
    kind: 'function',
    parse: 'Floor',
  },
  {
    latexTrigger: ['\\Gamma'],
    parse: 'Gamma',
  },
  {
    name: 'GCD',
    identifierTrigger: 'gcd',
    kind: 'function',
  },
  {
    identifierTrigger: 'GCD',
    kind: 'function',
    parse: 'GCD',
  },
  {
    name: 'Half',
    serialize: '\\frac12',
  },
  {
    name: 'Lg',
    latexTrigger: ['\\lg'],
    serialize: (serializer, expr) =>
      '\\log_{10}' + serializer.wrapArguments(expr),
    parse: (parser: Parser) => {
      const args = parser.parseArguments('implicit');
      if (args === null) return 'Lg' as Expression;
      return ['Log', ...args, 10] as Expression;
    },
  },
  {
    name: 'Lb',
    latexTrigger: '\\lb',
    parse: (parser: Parser) => {
      const args = parser.parseArguments('implicit');
      if (args === null) return 'Log' as Expression;
      return ['Log', args[0], 2] as Expression;
    },
  },
  {
    name: 'Ln',
    latexTrigger: ['\\ln'],
    parse: (parser: Parser) => parseLog('Ln', parser),
    serialize: (serializer, expr) => '\\ln' + serializer.wrapArguments(expr),
  },
  {
    name: 'Log',
    latexTrigger: ['\\log'],
    parse: (parser: Parser) => parseLog('Log', parser),
    serialize: (serializer, expr) => {
      const [body, base] = operands(expr)!;
      if (!base) return '\\log' + serializer.wrapArguments(expr);

      return joinLatex([
        '\\log_{',
        serializer.serialize(base),
        '}',
        serializer.wrap(body),
      ]);
    },
  },

  {
    name: 'LCM',
    identifierTrigger: 'lcm',
    kind: 'function',
  },
  {
    identifierTrigger: 'LCM',
    kind: 'function',
    parse: 'LCM',
  },
  { identifierTrigger: 'max', kind: 'function', parse: 'Max' },
  { identifierTrigger: 'min', kind: 'function', parse: 'Min' },
  { name: 'Max', latexTrigger: '\\max', kind: 'function' },
  { name: 'Min', latexTrigger: '\\min', kind: 'function' },
  { name: 'Supremum', latexTrigger: '\\sup', kind: 'function' },
  { name: 'Infimum', latexTrigger: '\\inf', kind: 'function' },

  {
    name: 'Limit',
    latexTrigger: '\\lim',
    kind: 'expression',
    parse: (parser: Parser) => {
      if (!parser.match('_')) return null;
      const base = parser.parseGroup();
      if (operator(base) !== 'To') return null;
      const expr = parser.parseArguments('implicit');
      if (!expr) return null;
      return [
        'Limit',
        ['Function', expr[0], operand(base, 1)],
        operand(base, 2),
      ] as Expression;
    },
    serialize: (serializer, expr) => {
      const fn = operand(expr, 1);
      const fnVar = operand(fn, 2);
      const to = operand(expr, 2);
      return joinLatex([
        '\\lim_{',
        serializer.serialize(fnVar),
        '\\to',
        serializer.serialize(to),
        '}',
        serializer.serialize(operand(fn, 1)),
      ]);
    },
  },

  {
    name: 'MinusPlus',
    latexTrigger: ['\\mp'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
  },
  {
    name: 'Multiply',
    latexTrigger: ['\\times'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    serialize: serializeMultiply,
  },
  {
    latexTrigger: ['\\cdot'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: MULTIPLICATION_PRECEDENCE + 2,
      });
      if (rhs === null) return ['Multiply', lhs, MISSING];

      return foldAssociativeOperator('Multiply', lhs, rhs);
    },
  },
  {
    latexTrigger: ['*'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: MULTIPLICATION_PRECEDENCE + 2,
      });
      if (rhs === null) return ['Multiply', lhs, MISSING];

      return foldAssociativeOperator('Multiply', lhs, rhs);
    },
  },
  // Infix modulo, as in `26 \bmod 5`
  {
    name: 'Mod',
    latexTrigger: '\\bmod',
    kind: 'infix',
    precedence: DIVISION_PRECEDENCE,
    serialize: (serializer, expr) => {
      if (nops(expr) !== 2) return '';
      const lhs = serializer.serialize(operand(expr, 1));
      const rhs = serializer.serialize(operand(expr, 2));
      return joinLatex([lhs, '\\bmod', rhs]);
    },
  },
  // Synonym to \\bmod
  {
    latexTrigger: '\\mod',
    kind: 'infix',
    precedence: DIVISION_PRECEDENCE,
    parse: 'Mod',
  },
  {
    latexTrigger: '\\pmod',
    kind: 'prefix',
    precedence: COMPARISON_PRECEDENCE,
    parse: (parser) => {
      const rhs = parser.parseGroup() ?? parser.parseToken();
      return ['Mod', missingIfEmpty(rhs)];
    },
  },
  {
    name: 'Congruent',
    serialize: (serializer, expr) => {
      const lhs = serializer.serialize(operand(expr, 1));
      const rhs = serializer.serialize(operand(expr, 2));
      if (operand(expr, 3) === null) return joinLatex([lhs, '\\equiv', rhs]);
      const modulus = serializer.serialize(operand(expr, 3));
      return joinLatex([lhs, '\\equiv', rhs, '\\pmod{', modulus, '}']);
    },
  },

  {
    name: 'Negate',
    latexTrigger: ['-'],
    kind: 'prefix',
    precedence: ADDITION_PRECEDENCE + 2,
    parse: (parser, terminator): Expression | null => {
      parser.skipSpace();
      // Quick check if the next token is a digit, if so, it's a number
      // not a Negate
      if (/\d/.test(parser.peek)) return null;

      // If the next token is a number, it's not a Negate, backtrack
      if (parser.parseNumber() !== null) return null;

      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: ADDITION_PRECEDENCE + 3,
      });

      // If we did not see a valid rhs, this may not be a negate, for example
      // "->" is not a negate, so return null
      if (rhs === null) return null;

      return ['Negate', rhs];
    },
  },

  // {
  //   /** If the argument is a vector */
  //   /** @todo: domain check */
  //   name: 'Norm',
  //   kind: 'matchfix',
  //   openDelimiter: '|',
  //   closeDelimiter: '|',
  // },
  // {
  //   /** If the argument is a set */
  //   /** @todo: domain check */
  //   name: 'Cardinality',
  //   kind: 'matchfix',
  //   openDelimiter: '|',
  //   closeDelimiter: '|',
  // },
  {
    //   /** If the argument is a vector */
    /** @todo: domain check */
    kind: 'matchfix',
    openTrigger: '||',
    closeTrigger: '||',
    parse: (_parser, expr) => (isEmptySequence(expr) ? null : ['Norm', expr]),
  },
  {
    //   /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    kind: 'matchfix',
    openTrigger: ['\\left', '\\Vert'],
    closeTrigger: ['\\right', '\\Vert'],
    parse: (_parser, expr) => (isEmptySequence(expr) ? null : ['Norm', expr]),
  },
  {
    name: 'PlusMinus',
    latexTrigger: ['\\pm'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    serialize: (serializer, expr) => {
      const op1 = operand(expr, 1);
      if (op1 === null) return '\\pm';
      if (nops(expr) === 1)
        return joinLatex(['\\pm', serializer.serialize(op1)]);
      const op2 = operand(expr, 2);
      return joinLatex([
        serializer.serialize(op1),
        '\\pm',
        serializer.serialize(op2),
      ]);
    },
  },
  {
    latexTrigger: ['\\pm'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['PlusMinus', missingIfEmpty(rhs)] as Expression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['PlusMinus', lhs, missingIfEmpty(rhs)] as Expression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['PlusMinus', missingIfEmpty(rhs)] as Expression;
    },
  },
  {
    name: 'Power',
    latexTrigger: ['^'],
    kind: 'infix',
    serialize: serializePower,
    // Parsing is done as a special case in `parseExpression`
  },
  {
    latexTrigger: '\\prod',
    precedence: MULTIPLICATION_PRECEDENCE,
    name: 'Product',
    parse: parseBigOp('Product', MULTIPLICATION_PRECEDENCE),
    serialize: serializeBigOp('\\prod'),
  },

  // {
  //   trigger: ['*', '*'],
  //   kind: 'infix',
  //   associativity: 'none',
  //   precedence: 720,
  // },
  {
    name: 'Rational',
    precedence: DIVISION_PRECEDENCE,
    serialize: (serializer: Serializer, expr: Expression | null): string => {
      if (expr && nops(expr) === 1)
        return '\\operatorname{Rational}' + serializer.wrapArguments(expr);
      return serializeFraction(serializer, expr);
    },
  },
  {
    name: 'Root',
    serialize: serializePower,
  },
  {
    name: 'Round',
    identifierTrigger: 'round',
    kind: 'function',
  },
  {
    name: 'Square',
    precedence: 720,
    serialize: (serializer, expr) =>
      serializer.wrapShort(operand(expr, 1)) + '^2',
  },
  {
    latexTrigger: ['\\sum'],
    precedence: ADDITION_PRECEDENCE,
    name: 'Sum',
    parse: parseBigOp('Sum', ADDITION_PRECEDENCE),
    serialize: serializeBigOp('\\sum'),
  },
  {
    name: 'Sign',
    // As per ISO 80000-2, "signum" is 'sgn'
    identifierTrigger: 'sgn',
    kind: 'function',
  },
  {
    name: 'Sqrt',
    latexTrigger: ['\\sqrt'],
    parse: parseRoot,
    serialize: serializePower,
  },
  {
    name: 'Subtract',
    latexTrigger: ['-'],
    kind: 'infix',
    associativity: 'left',
    precedence: ADDITION_PRECEDENCE + 2,
    parse: (parser, lhs, terminator) => {
      // Go back one token: we'll parse the '-' as part of the rhs so we
      // can keep the expression an 'Add'.
      parser.index -= 1;
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: ADDITION_PRECEDENCE + 3,
      });
      if (rhs === null) return null;
      return ['Add', lhs, rhs] as Expression;
    },
    serialize: (serializer, expr) => {
      const lhs = serializer.wrap(operand(expr, 1), ADDITION_PRECEDENCE + 2);
      const rhs = serializer.wrap(operand(expr, 2), ADDITION_PRECEDENCE + 3);
      return joinLatex([lhs, '-', rhs]);
    },
  },
];

/**
 * Expect an expression of the form ['Equal', index, lower] or
 * ['Equal', index, ['Range', lower, upper]]
 *
 */
function getIndexAssignment(
  expr: Expression | null,
  upper?: Expression | undefined
):
  | {
      index: string;
      lower?: Expression;
      upper?: Expression;
    }
  | undefined {
  if (expr === null) return undefined;
  // We only have a symbol, e.g. `i`
  if (symbol(expr)) return { index: symbol(expr) ?? 'Nothing', upper };

  // We have `i>=1` in the subscript
  if (operator(expr) === 'GreaterEqual') {
    const index = symbol(operand(expr, 1)) ?? 'Nothing';
    const lower = operand(expr, 2) ?? 1;
    return { index, lower, upper };
  }

  // We have `i=1` or `i=1..10` in the subscript
  if (operator(expr) === 'Equal') {
    const index = symbol(operand(expr, 1)) ?? 'Nothing';
    // We have i=1..10
    const rhs = operand(expr, 2);
    if (operator(rhs) === 'Range') {
      const lower = operand(rhs, 1) ?? 1;
      const upper = operand(rhs, 2) ?? undefined;
      // @todo: we currently do not support step range, i.e. `i=1..3..10`. The step is the third argument of Range. We should extend the indexing set to include step-range and collections, i.e. i={1,2,3,4}
      return { index, lower, upper };
    }
    // We have i=1
    const lower = rhs ?? 1;
    return { index, lower, upper };
  }

  return undefined;
}

function getIndexes(
  sub: Expression | null,
  sup: Expression | null
): {
  index: string;
  lower?: Expression;
  upper?: Expression;
}[] {
  if (isEmptySequence(sub)) sub = null;
  if (isEmptySequence(sup)) sup = null;

  const subs = sub === null ? [] : (getSequence(sub) ?? [sub]);
  const sups = sup === null ? [] : (getSequence(sup) ?? [sup]);

  // If we have a superscript, we expect to have a subscript of the form
  // `i=1, j=1` with a superscript of the form `10, 20`
  // If we don't have a superscript, we may have a subscript of the form
  // `i=1..10, j=1..20`... or just `i=1, j=1` with an implied
  // infinite upper bound

  // In both cases, we access sups[i], which may be undefined

  return subs
    .map((subExpr, i) => getIndexAssignment(subExpr, sups[i]))
    .filter((x) => x !== undefined);
}

function parseBigOp(name: string, prec: number) {
  return (parser: Parser): Expression | null => {
    parser.skipSpace();

    //
    // Capture the subscripts and superscripts
    // e.g. \sum_{i=1}^{10} i -> sup = `10`, sub = `i=1`
    //
    let sup: Expression | null = null;
    let sub: Expression | null = null;
    while (!(sub && sup) && (parser.peek === '_' || parser.peek === '^')) {
      if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();
      else if (parser.match('^'))
        sup = parser.parseGroup() ?? parser.parseToken();
      parser.skipSpace();
    }

    const indexes = getIndexes(sub, sup);

    //
    // Parse the body of the function
    //
    parser.pushSymbolTable();

    for (const indexinSet of indexes)
      parser.addSymbol(indexinSet.index, 'symbol');

    const fn = parser.parseExpression({ minPrec: prec + 1 });

    parser.popSymbolTable();

    if (fn === null) return [name];

    //
    // Turn the indexing sets into a sequence of tuples
    //
    const indexingSetArguments: Expression[] = [];
    for (const indexinSet of indexes) {
      const lower = indexinSet.lower;
      const upper = indexinSet.upper;
      const index = indexinSet.index ?? 'Nothing';
      if (upper !== null && upper !== undefined)
        indexingSetArguments.push(['Tuple', index, lower ?? 1, upper]);
      else if (lower !== null && lower !== undefined)
        indexingSetArguments.push(['Tuple', index, lower]);
      else indexingSetArguments.push(['Tuple', index]);
    }
    return [name, fn, ...indexingSetArguments];
  };
}

function serializeBigOp(command: string) {
  return (serializer, expr) => {
    if (operand(expr, 1) !== null) return command;

    let arg = operand(expr, 2);
    const h = operator(arg);
    if (h !== 'Tuple' && h !== 'Triple' && h !== 'Pair' && h !== 'Single')
      arg = null;

    let index = operand(arg, 1);
    if (index !== null && operator(index) === 'Hold') index = operand(index, 1);

    const fn = operand(expr, 1);

    if (arg !== null && arg !== undefined) {
      if (operand(expr, 2) !== null)
        return joinLatex([command, serializer.serialize(fn)]);
      return joinLatex([
        command,
        '_{',
        serializer.serialize(operand(expr, 2)),
        '}',
        serializer.serialize(fn),
      ]);
    }

    const lower = operand(arg, 2);

    let sub: string[] = [];
    if (index && symbol(index) !== 'Nothing' && lower)
      sub = [serializer.serialize(index), '=', serializer.serialize(lower)];
    else if (index && symbol(index) !== 'Nothing')
      sub = [serializer.serialize(index)];
    else if (lower !== null) sub = [serializer.serialize(lower)];

    if (sub.length > 0) sub = ['_{', ...sub, '}'];

    let sup: string[] = [];
    if (operand(arg, 3) !== null)
      sup = ['^{', serializer.serialize(operand(arg, 3)), '}'];

    return joinLatex([command, ...sup, ...sub, serializer.serialize(fn)]);
  };
}

function parseLog(command: string, parser: Parser): Expression | null {
  let sub: Expression | null = null;

  if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();

  const args = parser.parseArguments('implicit');

  if (args === null && sub === null) return [command] as Expression;
  if (args === null) return [command, sub] as Expression;

  if (sub === null) return [command, ...args] as Expression;

  if (sub === 10) return ['Log', args[0]] as Expression;
  if (sub === 2) return ['Lb', ...args] as Expression;
  return ['Log', args[0], sub] as Expression;
}

/**
 * Attempt to recognize expressions that could be represented with a
 * leading negative sign.
 * For example, `-2`, `\frac{-2}{x}`, `-2x`, etc...
 * Also take care of (--2) -> 2, `-\frac{-2}{x}` -> \frac{2}{x}, etc...
 * This will be used when serialization additions to insert the negative
 * sign in the correct place.
 */
function unsign(expr: Expression): [Expression, -1 | 1] {
  let sign: -1 | 1 = 1;
  let newExpr = expr;
  do {
    expr = newExpr;
    const fnName = operator(expr);
    if (fnName === 'Negate') {
      sign *= -1;
      newExpr = operand(expr, 1)!;
    } else if (fnName === 'Multiply') {
      const [first, firstSign] = unsign(operand(expr, 1)!);
      if (firstSign < 0) {
        sign *= -1;
        if (first === 1) newExpr = ['Multiply', ...operands(expr).slice(1)];
        else newExpr = ['Multiply', first, ...operands(expr).slice(1)];
      }
    } else if (fnName === 'Divide' || fnName === 'Rational') {
      const [numer, numerSign] = unsign(operand(expr, 1)!);
      if (numerSign < 0) {
        sign *= -1;
        newExpr = [fnName, numer, operand(expr, 2)!];
      }
    } else {
      const val = machineValue(expr);
      if (val !== null && val < 0) {
        sign *= -1;
        newExpr = -val;
      }
    }
  } while (newExpr !== expr);
  return [expr, sign as -1 | 1];
}
