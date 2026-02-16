import { MathJsonExpression } from '../../../math-json/types';
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
} from '../../../math-json/utils';
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
  EXPONENTIATION_PRECEDENCE,
} from '../types';
import { latexTemplate } from '../serializer-style';
import { joinLatex, supsub } from '../tokenizer';
import { normalizeAngle, degreesToDMS } from '../serialize-dms';

/**
 * If expression is a product, collect all the terms with a
 * negative exponents in the denominator, and all the terms
 * with a positive exponent (or no exponent) in the numerator.
 */
function numeratorDenominator(
  expr: MathJsonExpression
): [MathJsonExpression[], MathJsonExpression[]] {
  if (operator(expr) !== 'Multiply') return [[], []];
  const numerator: MathJsonExpression[] = [];
  const denominator: MathJsonExpression[] = [];
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

function parseRoot(parser: Parser): MathJsonExpression | null {
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
  base: MathJsonExpression | null | undefined,
  degree: MathJsonExpression | null | undefined
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

function serializeAdd(
  serializer: Serializer,
  expr: MathJsonExpression
): string {
  // "add" doesn't increase the "level" for styling purposes
  // so, preventively decrease it now.
  serializer.level -= 1;

  const name = operator(expr);
  let result = '';
  let arg = operand(expr, 1);
  // Note: This Negate case is not expected to be hit because Negate has its
  // own serialize handler (defined in definitions.ts via makeSerializeHandler).
  // This function is only registered as the serializer for 'Add', so `name`
  // should always be 'Add' or 'Subtract'. Kept for defensive purposes.
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

          // Replace #1 and #2
          result = latexTemplate(
            serializer.options.invisiblePlus,
            serializer.serialize(lhs),
            serializer.serialize(rhs)
          );

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
  expr: MathJsonExpression | null
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
  let arg: MathJsonExpression | null | undefined = null;
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
        if (!result) result = term;
        else result = latexTemplate(serializer.options.multiply, result, term);
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
      if (!result) result = term;
      else result = latexTemplate(serializer.options.multiply, result, term);

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
        result = latexTemplate(serializer.options.multiply, result, term);
      }
      // Not first term, use invisible multiply
      else if (!serializer.options.invisibleMultiply) {
        // Replace, joining the terms correctly
        // i.e. inserting a space between '\pi' and 'x'
        result = joinLatex([result, term]);
      } else {
        result = latexTemplate(
          serializer.options.invisibleMultiply,
          result,
          term
        );
      }
    }
    prevWasNumber = false;
  }

  // Restore the level
  serializer.level += 1;

  return isNegative ? '-' + result : result;
}

function parseFraction(parser: Parser): MathJsonExpression | null {
  let numer: MathJsonExpression | null = parser.parseGroup();
  let denom: MathJsonExpression | null = null;
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

    let vars: MathJsonExpression[] = [];
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

  // Handle ordinary (Leibniz) derivative notation: \frac{d}{dx} f
  // Accept forms like: `\frac{d}{dx} f`, `\frac{\mathrm{d}}{dx} f`
  const numerSym = symbol(numer);
  const isDifferential =
    numerSym === 'd' ||
    numerSym === 'd_upright' ||
    numerSym === 'differentialD';

  if (isDifferential) {
    // Extract variable(s) from the denominator. Typical forms:
    // - 'dx' (single symbol)
    // - ['Sequence', 'd', 'x']
    // - ['Multiply', 'd', 'x']
    const vars: MathJsonExpression[] = [];

    const collectVars = (expr: MathJsonExpression | null) => {
      if (!expr) return;
      const s = symbol(expr);
      // If it's a symbol that's not a differential operator, it's a variable
      if (s && s !== 'd' && s !== 'd_upright' && s !== 'differentialD') {
        vars.push(expr);
        return;
      }
      // If it's a sequence/multiply/invisible operator, inspect operands
      const h = operator(expr);
      if (h === 'Sequence' || h === 'Multiply' || h === 'InvisibleOperator') {
        for (const op of operands(expr)) collectVars(op);
      }
    };

    collectVars(denom);

    // If no vars found, try parsing denom as 'dx' -> 'x'
    if (vars.length === 0) {
      const denomSym = symbol(denom);
      if (denomSym && denomSym.length > 1 && denomSym[0] === 'd') {
        vars.push(denomSym.slice(1));
      }
    }

    if (vars.length > 0) {
      // Parse the expression to differentiate
      const fn = missingIfEmpty(parser.parseExpression());
      // D expects variables as separate arguments: ['D', f, x] or ['D', f, x, y]
      return ['D', fn, ...vars];
    }
  }

  return ['Divide', numer, denom];
}

function serializeFraction(
  serializer: Serializer,
  expr: MathJsonExpression | null
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
  expr: MathJsonExpression | null
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
      const num = machineValue(operand(exp, 1));
      const denom = machineValue(operand(exp, 2));
      if (num === 1) {
        // It's x^{1/n} -> it's a root
        const style = serializer.rootStyle(expr, serializer.level);
        return serializeRoot(serializer, style, base, operand(exp, 2));
      }
      if (num === -1) {
        // It's x^{-1/n} -> it's 1/root(x, n)
        if (denom === 2) {
          // x^{-1/2} -> 1/sqrt(x)
          return serializer.serialize(['Divide', '1', ['Sqrt', base]]);
        }
        // x^{-1/n} -> 1/root(x, n)
        return serializer.serialize([
          'Divide',
          '1',
          ['Root', base, operand(exp, 2) ?? MISSING],
        ]);
      }
      if (denom === 2) {
        // It's x^(n/2) -> it's √x^n
        return `${serializer.serialize(['Sqrt', base])}^{${serializer.serialize(
          operand(exp, 1)
        )}}`;
      }
    } else if (operator(exp) === 'Power') {
      if (machineValue(operand(exp, 2)) === -1) {
        // It's x^{n^-1} -> it's a root
        const style = serializer.rootStyle(expr, serializer.level);
        return serializeRoot(serializer, style, base, operand(exp, 1));
      }
    }
  }

  const wrapNegativeBase = (latex: string): string =>
    latex.startsWith('-') ? serializer.wrapString(latex, 'normal') : latex;

  // For improved typography, serialize 2^2^2 as 2^{2^2} rather than {2^2}^2. Note that 2^2^2 is invalid LaTeX.
  if (operator(base) === 'Power') {
    const baseBody = operand(base, 1);
    const baseExponent = operand(base, 2);
    const baseBodyLatex = wrapNegativeBase(serializer.wrapShort(baseBody));
    const baseExponentLatex = serializer.wrapShort(baseExponent);
    return `
      ${baseBodyLatex}^{${supsub('^', baseExponentLatex, serializer.serialize(exp))}}`;
  }

  return supsub(
    '^',
    wrapNegativeBase(serializer.wrapShort(base)),
    serializer.serialize(exp)
  );
}
/**
 * Parse degrees-minutes-seconds (DMS) angle notation.
 * Handles: 9°, 9°30', 9°30'15"
 *
 * Only interprets ' and " as arcmin/arcsec when immediately following
 * a degree symbol, avoiding conflict with Prime (derivative) notation.
 */
function parseDMS(
  parser: Parser,
  lhs: MathJsonExpression
): MathJsonExpression {
  const parts: MathJsonExpression[] = [['Quantity', lhs, 'deg']];

  parser.skipSpace();

  // Check for arc-minutes: 30'
  const savepoint = parser.index;
  const minValue = parser.parseNumber();

  if (minValue !== null &&
      (parser.match("'") || parser.match('\\prime'))) {
    // Found arc-minutes
    parts.push(['Quantity', minValue, 'arcmin']);
    parser.skipSpace();

    // Check for arc-seconds: 15"
    const secSavepoint = parser.index;
    const secValue = parser.parseNumber();

    if (secValue !== null &&
        (parser.match('"') || parser.match('\\doubleprime'))) {
      // Found arc-seconds
      parts.push(['Quantity', secValue, 'arcsec']);
    } else {
      // No arc-seconds, restore position
      parser.index = secSavepoint;
    }
  } else {
    // No arc-minutes, restore position
    parser.index = savepoint;
  }

  if (parts.length === 1) {
    // Just degrees, use existing Degrees function
    return ['Degrees', lhs];
  }

  // Multiple parts, return Add
  return ['Add', ...parts];
}

export const DEFINITIONS_ARITHMETIC: LatexDictionary = [
  // Constants
  { name: 'CatalanConstant', symbolTrigger: 'G' },
  { name: 'GoldenRatio', latexTrigger: '\\varphi' },
  { name: 'EulerGamma', latexTrigger: '\\gamma' },
  {
    name: 'Degrees',
    latexTrigger: ['\\degree'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => ['Degrees', lhs] as MathJsonExpression,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const options = serializer.options;
      const arg = operand(expr, 1);

      // Check if DMS format or normalization is requested
      if (options.dmsFormat || options.angleNormalization !== 'none') {
        // Get numeric value
        const argValue = machineValue(arg);
        if (argValue !== null) {
          // Apply normalization
          let degrees = argValue;
          if (options.angleNormalization !== 'none') {
            degrees = normalizeAngle(degrees, options.angleNormalization);
          }

          // Format as DMS if requested
          if (options.dmsFormat) {
            const { deg, min, sec } = degreesToDMS(degrees);

            let result = `${deg}°`;

            if (Math.abs(sec) > 0.001) {
              // Include seconds
              const secStr = sec % 1 === 0 ? sec.toString() : sec.toFixed(2);
              result += `${Math.abs(min)}'${Math.abs(Number(secStr))}"`;
            } else if (Math.abs(min) > 0) {
              // Include minutes only
              result += `${Math.abs(min)}'`;
            } else {
              // Degrees only, show 0'0" for consistency
              result += `0'0"`;
            }

            return result;
          } else {
            // Just normalize, use decimal degrees
            return `${degrees}°`;
          }
        }
      }

      // Fall back to default serialization
      return joinLatex([serializer.serialize(arg), '\\degree']);
    },
  },
  {
    latexTrigger: ['\\degree'],
    kind: 'postfix',
    precedence: 880,
    parse: (_parser, lhs) => ['Degrees', lhs] as MathJsonExpression,
  },
  {
    latexTrigger: ['^', '<{>', '\\circ', '<}>'],
    kind: 'postfix',
    parse: (_parser, lhs) => ['Degrees', lhs] as MathJsonExpression,
  },

  {
    latexTrigger: ['^', '\\circ'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parseDMS(parser, lhs),
  },
  {
    latexTrigger: ['°'],
    kind: 'postfix',
    precedence: 880,
    parse: (parser: Parser, lhs: MathJsonExpression) =>
      parseDMS(parser, lhs),
  },

  {
    latexTrigger: ['\\ang'],
    parse: (parser: Parser): MathJsonExpression => {
      const arg = parser.parseGroup();
      return (
        arg === null ? ['Degrees'] : ['Degrees', arg]
      ) as MathJsonExpression;
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
    symbolTrigger: 'exp',
    parse: (parser: Parser) => {
      const args = parser.parseArguments('implicit');
      if (args === null) return 'Exp' as MathJsonExpression;
      return ['Exp', ...args] as MathJsonExpression;
    },
  },
  {
    latexTrigger: '\\exp',
    parse: (parser: Parser) => {
      const args = parser.parseArguments('implicit');
      if (args === null) return 'Exp' as MathJsonExpression;
      return ['Exp', ...args] as MathJsonExpression;
    },
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
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Abs', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\vert'],
    closeTrigger: ['\\vert'],
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Abs', body] as MathJsonExpression),
  },
  {
    symbolTrigger: 'abs',
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
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Ceil', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u2308'], // ⌈ U+2308 LEFT CEILING
    closeTrigger: ['\u2309'], // ⌉ U+2309 RIGHT CEILING
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Ceil', body] as MathJsonExpression),
  },
  {
    symbolTrigger: 'ceil',
    kind: 'function',
    parse: 'Ceil',
  },
  { name: 'Chop', symbolTrigger: 'chop', kind: 'function', parse: 'Chop' },
  {
    name: 'Complex',
    precedence: ADDITION_PRECEDENCE - 1, // One less than precedence of `Add`: used for correct wrapping
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
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
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
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
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Floor', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u230a'], // ⌊ U+230A LEFT FLOOR
    closeTrigger: ['\u230b'], // ⌋ U+230B RIGHT FLOOR
    parse: (_parser, body) =>
      isEmptySequence(body) ? null : (['Floor', body] as MathJsonExpression),
  },
  {
    symbolTrigger: 'floor',
    kind: 'function',
    parse: 'Floor',
  },
  {
    latexTrigger: ['\\Gamma'],
    parse: 'Gamma',
  },
  // Riemann zeta function - \zeta parses to Zeta function when followed by arguments
  // Note: \zeta without arguments is handled by definitions-symbols.ts as Greek letter
  {
    latexTrigger: ['\\zeta'],
    kind: 'function',
    parse: 'Zeta',
  },
  // Beta function - \Beta parses to Beta function when followed by arguments
  // Note: \Beta without arguments is handled by definitions-symbols.ts as Greek letter
  {
    latexTrigger: ['\\Beta'],
    kind: 'function',
    parse: 'Beta',
  },
  // Lambert W function (product logarithm)
  {
    name: 'LambertW',
    latexTrigger: ['\\operatorname{W}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{W}' + serializer.wrapArguments(expr),
  },
  // Bessel functions - order is first argument, value is second
  // BesselJ(n, x) represents J_n(x)
  {
    name: 'BesselJ',
    latexTrigger: ['\\operatorname{J}'],
    kind: 'function',
    serialize: (serializer, expr) => {
      const order = operand(expr, 1);
      const x = operand(expr, 2);
      if (order !== null && x !== null) {
        return (
          '\\operatorname{J}_{' +
          serializer.serialize(order) +
          '}' +
          serializer.wrapArguments(['BesselJ', x])
        );
      }
      return '\\operatorname{J}' + serializer.wrapArguments(expr);
    },
  },
  {
    name: 'BesselY',
    latexTrigger: ['\\operatorname{Y}'],
    kind: 'function',
    serialize: (serializer, expr) => {
      const order = operand(expr, 1);
      const x = operand(expr, 2);
      if (order !== null && x !== null) {
        return (
          '\\operatorname{Y}_{' +
          serializer.serialize(order) +
          '}' +
          serializer.wrapArguments(['BesselY', x])
        );
      }
      return '\\operatorname{Y}' + serializer.wrapArguments(expr);
    },
  },
  {
    name: 'BesselI',
    latexTrigger: ['\\operatorname{I}'],
    kind: 'function',
    serialize: (serializer, expr) => {
      const order = operand(expr, 1);
      const x = operand(expr, 2);
      if (order !== null && x !== null) {
        return (
          '\\operatorname{I}_{' +
          serializer.serialize(order) +
          '}' +
          serializer.wrapArguments(['BesselI', x])
        );
      }
      return '\\operatorname{I}' + serializer.wrapArguments(expr);
    },
  },
  {
    name: 'BesselK',
    latexTrigger: ['\\operatorname{K}'],
    kind: 'function',
    serialize: (serializer, expr) => {
      const order = operand(expr, 1);
      const x = operand(expr, 2);
      if (order !== null && x !== null) {
        return (
          '\\operatorname{K}_{' +
          serializer.serialize(order) +
          '}' +
          serializer.wrapArguments(['BesselK', x])
        );
      }
      return '\\operatorname{K}' + serializer.wrapArguments(expr);
    },
  },
  // Airy functions
  {
    name: 'AiryAi',
    latexTrigger: ['\\operatorname{Ai}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{Ai}' + serializer.wrapArguments(expr),
  },
  {
    name: 'AiryBi',
    latexTrigger: ['\\operatorname{Bi}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{Bi}' + serializer.wrapArguments(expr),
  },
  {
    name: 'GCD',
    latexTrigger: ['\\gcd'], // command from amsmath package
    kind: 'function',
  },
  {
    symbolTrigger: 'gcd',
    kind: 'function',
    parse: 'GCD',
  },
  {
    symbolTrigger: 'GCD',
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
      if (args === null) return 'Lg' as MathJsonExpression;
      return ['Log', ...args, 10] as MathJsonExpression;
    },
  },
  {
    name: 'Lb',
    latexTrigger: '\\lb',
    parse: (parser: Parser) => {
      const args = parser.parseArguments('implicit');
      if (args === null) return 'Log' as MathJsonExpression;
      return ['Log', args[0], 2] as MathJsonExpression;
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
    latexTrigger: ['\\lcm'],
    kind: 'function',
  },
  {
    symbolTrigger: 'lcm',
    kind: 'function',
    parse: 'LCM',
  },
  {
    symbolTrigger: 'LCM',
    kind: 'function',
    parse: 'LCM',
  },
  {
    symbolTrigger: 'max',
    kind: 'function',
    parse: 'Max',
    arguments: 'implicit',
  },
  {
    symbolTrigger: 'min',
    kind: 'function',
    parse: 'Min',
    arguments: 'implicit',
  },
  {
    name: 'Max',
    latexTrigger: '\\max',
    kind: 'function',
    arguments: 'implicit',
  },
  {
    name: 'Min',
    latexTrigger: '\\min',
    kind: 'function',
    arguments: 'implicit',
  },
  {
    name: 'Supremum',
    latexTrigger: '\\sup',
    kind: 'function',
    arguments: 'implicit',
  },
  {
    name: 'Infimum',
    latexTrigger: '\\inf',
    kind: 'function',
    arguments: 'implicit',
  },

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
      ] as MathJsonExpression;
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
      // Because \cdot can be used in other contexts, we do a soft failure
      // (for example, it's used as a separator in \int)
      if (rhs === null) return null;

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
    precedence: EXPONENTIATION_PRECEDENCE + 1,
    parse: (parser, terminator): MathJsonExpression | null => {
      parser.skipSpace();
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: EXPONENTIATION_PRECEDENCE + 3,
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
    parse: (_parser, expr) =>
      isEmptySequence(expr) ? null : (['Norm', expr] as MathJsonExpression),
  },
  {
    //   /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    kind: 'matchfix',
    openTrigger: ['\\left', '\\Vert'],
    closeTrigger: ['\\right', '\\Vert'],
    parse: (_parser, expr) =>
      isEmptySequence(expr) ? null : (['Norm', expr] as MathJsonExpression),
    serialize: (serializer, expr) => {
      const arg = operand(expr, 1);
      if (operator(arg) === 'Matrix') {
        // Re-inject ‖‖ delimiters so the Matrix serializer outputs Vmatrix
        const data = operand(arg, 1);
        const colSpec = operand(arg, 2);
        const matrixWithDelims: MathJsonExpression = colSpec
          ? (['Matrix', data, { str: '‖‖' }, colSpec] as MathJsonExpression)
          : (['Matrix', data, { str: '‖‖' }] as MathJsonExpression);
        return serializer.serialize(matrixWithDelims);
      }
      return `\\left\\Vert ${serializer.serialize(arg)}\\right\\Vert`;
    },
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
      return ['PlusMinus', 0, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['PlusMinus', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['PlusMinus', missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    name: 'Power',
    latexTrigger: ['^'],
    kind: 'infix',
    serialize: serializePower,
    // Parsing is done as a special case in `parseSupsub`
  },
  {
    latexTrigger: '\\prod',
    precedence: MULTIPLICATION_PRECEDENCE,
    name: 'Product',
    parse: parseBigOp('Product', 'Multiply', MULTIPLICATION_PRECEDENCE),
    serialize: serializeBigOp('\\prod'),
  },

  {
    // Non-strict mode: ** for exponentiation (Python-style)
    latexTrigger: ['*', '*'],
    kind: 'infix',
    associativity: 'right',
    precedence: EXPONENTIATION_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      if (parser.options.strict !== false) return null;
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: EXPONENTIATION_PRECEDENCE,
      });
      if (rhs === null) return null;
      return ['Power', lhs, rhs];
    },
  },
  {
    name: 'Rational',
    precedence: DIVISION_PRECEDENCE,
    serialize: (
      serializer: Serializer,
      expr: MathJsonExpression | null
    ): string => {
      if (expr && nops(expr) === 1)
        return '\\operatorname{Rational}' + serializer.wrapArguments(expr);
      return serializeFraction(serializer, expr);
    },
  },
  {
    name: 'Reduce',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const collection = operand(expr, 1);
      if (!collection) return '';

      const f = operand(expr, 2);
      if (symbol(f) === 'Add') {
        // This is a reduce over a collection -> \sum
        return `\\sum ${serializer.serialize(collection)}`;
      } else if (symbol(f) === 'Multiply') {
        // This is a reduce over a collection -> \prod
        return `\\prod ${serializer.serialize(collection)}`;
      }

      // This is a reduce over a collection -> \operatorname{Reduce}
      return `\\operatorname{Reduce}\\left(${serializer.serialize(collection)}, ${serializer.serialize(operand(expr, 2))}\\right)`;
    },
  },
  {
    name: 'Root',
    serialize: serializePower,
  },
  {
    name: 'Round',
    symbolTrigger: 'round',
    kind: 'function',
  },
  {
    name: 'Square',
    precedence: 720,
    serialize: (serializer, expr) => {
      const base = serializer.wrapShort(operand(expr, 1));
      const wrapped = base.startsWith('-')
        ? serializer.wrapString(base, 'normal')
        : base;
      return wrapped + '^2';
    },
  },
  {
    latexTrigger: ['\\sum'],
    precedence: ADDITION_PRECEDENCE,
    name: 'Sum',
    parse: parseBigOp('Sum', 'Add', MULTIPLICATION_PRECEDENCE),
    serialize: serializeBigOp('\\sum'),
  },
  {
    name: 'Sign',
    // As per ISO 80000-2, "signum" is 'sgn'
    symbolTrigger: 'sgn',
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
      return ['Add', lhs, rhs] as MathJsonExpression;
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
  expr: MathJsonExpression | null,
  upper?: MathJsonExpression | undefined
):
  | {
      index: string;
      lower?: MathJsonExpression;
      upper?: MathJsonExpression;
      element?: MathJsonExpression;
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

  // Handle Element expressions: ["Element", "n", "N"]
  // e.g., `n \in N` in the subscript
  if (operator(expr) === 'Element') {
    const index = symbol(operand(expr, 1)) ?? 'Nothing';
    return { index, element: expr };
  }

  return undefined;
}

/**
 * Check if an expression is likely a condition (predicate) rather than
 * an indexing set assignment or Element expression.
 * Conditions are typically relational expressions like `n > 0`, `x < 10`, etc.
 */
function isConditionExpression(expr: MathJsonExpression): boolean {
  const op = operator(expr);
  if (!op) return false;
  // Common relational operators that indicate conditions
  const conditionOperators = new Set([
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
    'NotEqual',
    'And',
    'Or',
    'Not',
    // Also allow function applications as conditions (e.g., IsPrime(n))
  ]);
  return conditionOperators.has(op);
}

/**
 * Extract operands from a sequence-like expression.
 * Handles Sequence, Tuple, and single expressions.
 */
function getSequenceOrTuple(
  expr: MathJsonExpression | null
): MathJsonExpression[] {
  if (expr === null) return [];

  // First try getSequence (handles Sequence and Delimiter)
  const seq = getSequence(expr);
  if (seq) return [...seq];

  // Also handle Tuple (which is what commas in subscripts often parse to)
  if (operator(expr) === 'Tuple') {
    const ops = operands(expr);
    return ops ? [...ops] : [expr];
  }

  // Single expression
  return [expr];
}

function getIndexes(
  sub: MathJsonExpression | null,
  sup: MathJsonExpression | null
): {
  index: string;
  lower?: MathJsonExpression;
  upper?: MathJsonExpression;
  element?: MathJsonExpression;
}[] {
  if (isEmptySequence(sub)) sub = null;
  if (isEmptySequence(sup)) sup = null;

  const subs = getSequenceOrTuple(sub);
  const sups = getSequenceOrTuple(sup);

  // If we have a superscript, we expect to have a subscript of the form
  // `i=1, j=1` with a superscript of the form `10, 20`
  // If we don't have a superscript, we may have a subscript of the form
  // `i=1..10, j=1..20`... or just `i=1, j=1` with an implied
  // infinite upper bound

  // In both cases, we access sups[i], which may be undefined

  // EL-3: Process subscripts, attaching conditions to preceding Element expressions
  const results: {
    index: string;
    lower?: MathJsonExpression;
    upper?: MathJsonExpression;
    element?: MathJsonExpression;
  }[] = [];

  let i = 0;
  while (i < subs.length) {
    const subExpr = subs[i];
    const assignment = getIndexAssignment(subExpr, sups[i]);

    if (assignment) {
      // EL-3: Check if this is an Element expression and the next item is a condition
      if (assignment.element && i + 1 < subs.length) {
        const nextExpr = subs[i + 1];
        // Check if next expression is a condition (not another Element or assignment)
        // Note: GreaterEqual IS allowed as a condition (e.g., n >= 2) when following an Element
        // It's only a traditional index assignment when standalone (not after Element)
        if (
          isConditionExpression(nextExpr) &&
          operator(nextExpr) !== 'Element' &&
          operator(nextExpr) !== 'Equal'
        ) {
          // Attach condition to the Element expression
          // Element goes from ["Element", var, domain] to ["Element", var, domain, condition]
          const elementExpr = assignment.element;
          if (Array.isArray(elementExpr) && elementExpr.length >= 3) {
            // Create a new array with the condition appended
            const newElement: MathJsonExpression = [
              elementExpr[0] as string,
              ...elementExpr.slice(1),
              nextExpr,
            ];
            assignment.element = newElement;
          }
          i++; // Skip the condition expression
        }
      }
      results.push(assignment);
    }
    i++;
  }

  return results;
}

function parseBigOp(name: string, reduceOp: string, minPrec: number) {
  return (parser: Parser): MathJsonExpression | null => {
    parser.skipSpace();

    // Push a symbol table early to isolate subscript/superscript parsing
    // This prevents index symbols (like 'n' in 'n \in S, n > 0') from
    // polluting the outer scope
    parser.pushSymbolTable();

    //
    // Capture the subscripts and superscripts
    // e.g. \sum_{i=1}^{10} i -> sup = `10`, sub = `i=1`
    //
    let sup: MathJsonExpression | null = null;
    let sub: MathJsonExpression | null = null;
    while (!(sub && sup) && (parser.peek === '_' || parser.peek === '^')) {
      if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();
      else if (parser.match('^'))
        sup = parser.parseGroup() ?? parser.parseToken();
      parser.skipSpace();
    }

    // If there are no sup/sub, this could be a bigop over a collection, i.e.
    // \sum \{ 1, 2, 3 \}
    if (!sup && !sub) {
      const collection = parser.parseExpression({ minPrec: minPrec });
      parser.popSymbolTable();
      if (collection) return ['Reduce', collection, reduceOp];
      return null;
    }

    const indexes = getIndexes(sub, sup);

    //
    // Parse the body of the function
    // The index symbols are already in scope from parsing the subscripts
    //

    const fn = parser.parseExpression({ minPrec: minPrec });

    parser.popSymbolTable();

    if (fn === null) return [name];

    //
    // Turn the indexing sets into a sequence of tuples or Element expressions
    //
    const indexingSetArguments: MathJsonExpression[] = [];
    for (const indexingSet of indexes) {
      // Handle Element expressions: preserve them directly
      if (indexingSet.element) {
        indexingSetArguments.push(indexingSet.element);
        continue;
      }
      // Handle traditional range-based indexing sets
      const lower = indexingSet.lower;
      const upper = indexingSet.upper;
      const index = indexingSet.index ?? 'Nothing';
      if (upper !== null && upper !== undefined)
        indexingSetArguments.push(['Tuple', index, lower ?? 1, upper]);
      else if (lower !== null && lower !== undefined)
        indexingSetArguments.push(['Tuple', index, lower]);
      else indexingSetArguments.push(['Tuple', index]);
    }
    return [name, fn, ...indexingSetArguments];
  };
}

const INDEXING_SET_HEADS = new Set([
  'Tuple',
  'Triple',
  'Pair',
  'Single',
  'Limits',
  'Element',
]);

function sanitizeLimitOperand(
  expr: MathJsonExpression | null | undefined
): MathJsonExpression | null {
  if (expr === null || expr === undefined) return null;
  if (symbol(expr) === 'Nothing') return null;
  return expr;
}

function collectIndexingSets(expr: MathJsonExpression): MathJsonExpression[] {
  const result: MathJsonExpression[] = [];
  const args = operands(expr);
  if (args.length <= 1) return result;
  for (const candidate of args.slice(1)) {
    const head = operator(candidate);
    if (head && INDEXING_SET_HEADS.has(head)) {
      result.push(candidate);
      continue;
    }
    break;
  }
  return result;
}

function serializeIndexingSet(
  serializer: Serializer,
  indexingSet: MathJsonExpression
): { sub?: string; sup?: string } {
  // Handle Element expressions: ["Element", "n", "N"]
  // Serialize as `n\in N`
  if (operator(indexingSet) === 'Element') {
    const indexLatex = serializer.serialize(operand(indexingSet, 1));
    const collectionLatex = serializer.serialize(operand(indexingSet, 2));
    return { sub: `${indexLatex}\\in ${collectionLatex}` };
  }

  let indexExpr = operand(indexingSet, 1);
  if (indexExpr !== null && operator(indexExpr) === 'Hold')
    indexExpr = operand(indexExpr, 1);

  const lowerExpr = sanitizeLimitOperand(operand(indexingSet, 2));
  const upperExpr = sanitizeLimitOperand(operand(indexingSet, 3));

  const result: { sub?: string; sup?: string } = {};
  const indexName = indexExpr ? symbol(indexExpr) : null;
  const hasIndex = indexName !== null && indexName !== 'Nothing';
  const indexLatex =
    hasIndex && indexExpr ? serializer.serialize(indexExpr) : undefined;

  if (hasIndex && lowerExpr !== null && indexLatex)
    result.sub = `${indexLatex}=${serializer.serialize(lowerExpr)}`;
  else if (hasIndex && indexLatex) result.sub = indexLatex;
  else if (lowerExpr !== null) result.sub = serializer.serialize(lowerExpr);

  if (upperExpr !== null) result.sup = serializer.serialize(upperExpr);

  return result;
}

function serializeBigOp(command: string) {
  return (serializer: Serializer, expr: MathJsonExpression): string => {
    const body = operand(expr, 1);
    if (!body) return command;

    const indexingSets = collectIndexingSets(expr);
    let decoratedCommand = command;
    if (indexingSets.length > 0) {
      const subs: string[] = [];
      const sups: string[] = [];
      for (const set of indexingSets) {
        const parts = serializeIndexingSet(serializer, set);
        if (parts.sub) subs.push(parts.sub);
        if (parts.sup) sups.push(parts.sup);
      }
      if (subs.length > 0)
        decoratedCommand = supsub('_', decoratedCommand, subs.join(', '));
      if (sups.length > 0)
        decoratedCommand = supsub('^', decoratedCommand, sups.join(', '));
    }

    return joinLatex([decoratedCommand, serializer.serialize(body)]);
  };
}

function parseLog(command: string, parser: Parser): MathJsonExpression | null {
  let sub: MathJsonExpression | null = null;

  if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();

  const args = parser.parseArguments('implicit');

  if (args === null && sub === null) return [command] as MathJsonExpression;
  if (args === null) return [command, sub] as MathJsonExpression;

  if (sub === null) return [command, ...args] as MathJsonExpression;

  if (sub === 10) return ['Log', args[0]] as MathJsonExpression;
  if (sub === 2) return ['Lb', ...args] as MathJsonExpression;
  return ['Log', args[0], sub] as MathJsonExpression;
}

/**
 * Attempt to recognize expressions that could be represented with a
 * leading negative sign.
 * For example, `-2`, `\frac{-2}{x}`, `-2x`, etc...
 * Also take care of (--2) -> 2, `-\frac{-2}{x}` -> \frac{2}{x}, etc...
 * This will be used when serialization additions to insert the negative
 * sign in the correct place.
 */
function unsign(expr: MathJsonExpression): [MathJsonExpression, -1 | 1] {
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
