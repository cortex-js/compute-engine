import { MathJsonExpression } from '../../../math-json/types.js';
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
} from '../../../math-json/utils.js';
import {
  Serializer,
  Parser,
  Terminator,
  LatexDictionary,
  MULTIPLICATION_PRECEDENCE,
  ADDITION_PRECEDENCE,
  ARROW_PRECEDENCE,
  DIVISION_PRECEDENCE,
  POSTFIX_PRECEDENCE,
  COMPARISON_PRECEDENCE,
  EXPONENTIATION_PRECEDENCE,
} from '../types.js';
import { latexTemplate } from '../serializer-style.js';
import { joinLatex, supsub } from '../tokenizer.js';
import { normalizeAngle, formatDMS } from '../serialize-dms.js';
import { roundMeasurementForDisplay } from '../../numerics/strings.js';

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
    const missing = parser.error('missing', parser.index);
    if (degree !== null) return ['Root', missing, missingIfEmpty(degree)];
    return ['Sqrt', missing];
  }
  if (degree !== null) return ['Root', base, degree];
  return ['Sqrt', base];
}

function negateNumberLiteral(
  expr: number | string | { num: string }
): MathJsonExpression {
  if (typeof expr === 'number') return -expr;

  if (typeof expr === 'string') {
    if (expr.startsWith('-')) return expr.slice(1);
    if (expr.startsWith('+')) return '-' + expr.slice(1);
    return '-' + expr;
  }

  const num = expr.num;
  if (num.startsWith('-')) return { num: num.slice(1) };
  if (num.startsWith('+')) return { num: '-' + num.slice(1) };
  return { num: '-' + num };
}

/**
 * Serialize `Measurement(value, error)` → `value \pm error`.
 *
 * When both operands are plain (machine) numbers, the physics significant-
 * figures convention is applied: round the error to 1 significant figure, then
 * round the nominal to the error's decimal place. Exact/symbolic operands (e.g.
 * a radical error from `evaluate()`) are serialized losslessly.
 */
function serializeMeasurement(
  serializer: Serializer,
  expr: MathJsonExpression | null
): string {
  if (!expr) return '\\pm';
  const op1 = operand(expr, 1);
  const op2 = operand(expr, 2);
  if (op1 === null) return '\\pm';
  if (op2 === null) return serializer.serialize(op1);

  const v = machineValue(op1);
  const e = machineValue(op2);
  if (
    v !== null &&
    e !== null &&
    Number.isFinite(v) &&
    Number.isFinite(e) &&
    e > 0
  ) {
    const { value, error } = roundMeasurementForDisplay(
      v,
      e,
      serializer.options.digits
    );
    return joinLatex([value, '\\pm', error]);
  }
  return joinLatex([
    serializer.serialize(op1),
    '\\pm',
    serializer.serialize(op2),
  ]);
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

// ─────────────────────────────────────────────────────────────────────────
//  Series display order: sort `Add` operands so a `BigO` remainder term
//  (from `Series()`, see `symbolic/series.ts`) prints in textbook order.
//
//  This is purely a SERIALIZATION concern: canonical `Add` order (see
//  `boxed-expression/order.ts`, which is untouched and not reimplemented
//  here) is highest-degree-first for a stable internal representation, but
//  that reads as `x^5/120 - x^3/6 + x + O(x^7)` instead of the textbook
//  `x - x^3/6 + x^5/120 + O(x^7)`, and can place the `BigO` term mid-sum.
//  All of this is a no-op — same array, same order — for any `Add` that has
//  no `BigO` operand.
// ─────────────────────────────────────────────────────────────────────────

/** Named mathematical constants, excluded when inferring the series variable
 * from a `BigO` argument (e.g. `BigO((x - \pi)^7)` when expanding at
 * `x0 = \pi`: the series variable is `x`, not `Pi`). */
const NAMED_CONSTANTS = new Set([
  'Pi',
  'ExponentialE',
  'ImaginaryUnit',
  'GoldenRatio',
  'EulerGamma',
  'CatalanConstant',
  'MachineEpsilon',
]);

/** Does `expr` (raw MathJSON) mention `variable` anywhere? */
function jsonHasSymbol(expr: MathJsonExpression, variable: string): boolean {
  const s = symbol(expr);
  if (s !== null) return s === variable;
  for (const op of operands(expr)) if (jsonHasSymbol(op, variable)) return true;
  return false;
}

/** First non-constant symbol found in `expr` (pre-order), or `null`. */
function findSeriesVariable(expr: MathJsonExpression): string | null {
  const s = symbol(expr);
  if (s !== null) return NAMED_CONSTANTS.has(s) ? null : s;
  for (const op of operands(expr)) {
    const found = findSeriesVariable(op);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The degree of `expr` as a (possibly Laurent, i.e. negative-exponent) power
 * of `variable` — e.g. `1/x` and `x^{-1}` are both degree `-1`. Returns
 * `undefined` when `expr` is not expressible as a single power of `variable`
 * (e.g. it mentions the variable inside a transcendental function): callers
 * should treat that as degree `0` (see module doc).
 *
 * Deliberately NOT a reuse of `boxed-expression/polynomials.ts`'s
 * `polynomialDegree`: that helper is scoped to genuine (non-negative-integer
 * exponent) polynomials, and operates on `BoxedExpression`, not raw
 * MathJSON — neither fits the Laurent-degree, serialization-time need here.
 */
function seriesTermDegree(
  expr: MathJsonExpression,
  variable: string
): number | undefined {
  if (isNumberExpression(expr)) return 0;

  const s = symbol(expr);
  if (s !== null) return s === variable ? 1 : 0;

  const op = operator(expr);
  if (!op) return 0;

  if (op === 'Negate') return seriesTermDegree(operand(expr, 1)!, variable);

  if (op === 'Multiply') {
    let total = 0;
    for (const factor of operands(expr)) {
      const d = seriesTermDegree(factor, variable);
      if (d === undefined) return undefined;
      total += d;
    }
    return total;
  }

  if (op === 'Divide') {
    const num = seriesTermDegree(operand(expr, 1)!, variable);
    const denom = seriesTermDegree(operand(expr, 2)!, variable);
    if (num === undefined || denom === undefined) return undefined;
    return num - denom;
  }

  if (op === 'Power') {
    const base = operand(expr, 1)!;
    const exp = operand(expr, 2)!;
    const baseDeg = seriesTermDegree(base, variable);
    if (baseDeg === undefined) return undefined;
    if (baseDeg === 0) return jsonHasSymbol(exp, variable) ? undefined : 0;
    const expVal = machineValue(exp);
    if (expVal === null || !Number.isInteger(expVal)) return undefined;
    return baseDeg * expVal;
  }

  // `Power(_, 2)` is rewritten to `Square(_)` by the JSON "pretty" pass that
  // runs ahead of LaTeX serialization (see `boxed-expression/serialize.ts`),
  // so `x^2` arrives here as `["Square", "x"]`, not `["Power", "x", 2]`.
  if (op === 'Square') {
    const baseDeg = seriesTermDegree(operand(expr, 1)!, variable);
    return baseDeg === undefined ? undefined : baseDeg * 2;
  }

  // `(x - x0)` — the "shifted variable" building block of a Taylor series
  // expanded at a non-zero `x0` — is degree 1, same as bare `x`: take the
  // highest degree among the (defined-degree) terms, ignoring any constant
  // offset such as `x0`.
  if (op === 'Add' || op === 'Subtract') {
    let maxDeg: number | undefined;
    for (const term of operands(expr)) {
      const d = seriesTermDegree(term, variable);
      if (d !== undefined && (maxDeg === undefined || d > maxDeg)) maxDeg = d;
    }
    return maxDeg;
  }

  // Any other operator (Sin, Cos, Ln, Rational, Sqrt, BigO, ...): a constant
  // if it doesn't mention `variable`, otherwise not a simple power term
  // (falls back to degree 0 in the caller — see module doc).
  return jsonHasSymbol(expr, variable) ? undefined : 0;
}

/** If `expr` is a `BigO` term or its negation (`Negate(BigO(...))`), return
 * the `BigO` argument; otherwise `null`. */
function bigOArgument(expr: MathJsonExpression): MathJsonExpression | null {
  let e = expr;
  if (operator(e) === 'Negate') e = operand(e, 1)!;
  if (operator(e) === 'BigO') return operand(e, 1);
  return null;
}

/**
 * Reorder the operands of a top-level `Add` into textbook series order when
 * (and only when) they include a `BigO` remainder term:
 *
 *   - ascending degree in the series variable when the `BigO` argument's
 *     degree is non-negative (Taylor expansion at a finite point), or
 *   - descending degree when it is negative (asymptotic/Laurent expansion,
 *     e.g. `\pi/2 - 1/x + 1/(3x^3) + O(x^{-7})`),
 *
 * with the `BigO` term(s) always last.
 *
 * Returns the SAME array reference, untouched, when there is no `BigO`
 * operand or no series variable can be inferred — ordinary sums are
 * byte-identical to before this function existed.
 */
function reorderSeriesTerms(
  ops: ReadonlyArray<MathJsonExpression>
): ReadonlyArray<MathJsonExpression> {
  const bigOArgs = ops.map(bigOArgument);
  if (!bigOArgs.some((a) => a !== null)) return ops;

  let variable: string | null = null;
  for (const arg of bigOArgs) {
    if (arg === null) continue;
    variable = findSeriesVariable(arg);
    if (variable !== null) break;
  }
  if (variable === null) return ops;

  const firstBigOArg = bigOArgs.find((a) => a !== null)!;
  const ascending = (seriesTermDegree(firstBigOArg, variable) ?? 0) >= 0;

  const terms: MathJsonExpression[] = [];
  const bigOTerms: MathJsonExpression[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (bigOArgs[i] !== null) bigOTerms.push(ops[i]);
    else terms.push(ops[i]);
  }

  const degreeOf = (t: MathJsonExpression) =>
    seriesTermDegree(t, variable!) ?? 0;
  terms.sort((a, b) =>
    ascending ? degreeOf(a) - degreeOf(b) : degreeOf(b) - degreeOf(a)
  );

  return [...terms, ...bigOTerms];
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
    // Textbook series order: if this sum has a `BigO` remainder term (from
    // `Series()`), display it by ascending/descending degree in the series
    // variable with `BigO` last, instead of the canonical (highest-degree
    // first) operand order. A no-op — `ops` is the same array, in the same
    // order — for any `Add` without a `BigO` operand. See
    // `reorderSeriesTerms` above.
    const ops = reorderSeriesTerms(operands(expr));

    // If it is the sum of an integer and a rational, use a special form
    // (e.g. 1 + 1/2 -> 1 1/2)
    if (
      serializer.options.prettify &&
      ops.length === 2 &&
      serializer.options.invisiblePlus !== '+'
    ) {
      const [op1, op2] = ops;

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
    if (serializer.options.prettify && ops.length === 2) {
      const [first, firstSign] = unsign(ops[0]);
      const [second, secondSign] = unsign(ops[1]);
      if (firstSign < 0 && secondSign > 0) {
        result =
          serializer.wrap(second, ADDITION_PRECEDENCE) +
          '-' +
          serializer.wrap(first, ADDITION_PRECEDENCE);
        serializer.level += 1;
        return result;
      }
    }

    result = serializer.serialize(ops[0]);
    for (let i = 1; i < ops.length; i++) {
      arg = ops[i];
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
      // Can't use an invisible multiply if the term serializes starting
      // with a digit: juxtaposing it would merge it with a preceding
      // number into a single, different number. This happens with a
      // prettified power of a numeric base, e.g. `Square(2)` -> `2^2`,
      // where `Multiply(3, Square(2))` would otherwise serialize as
      // `32^2` instead of `3\times2^2`. (A `Power` with a numeric base is
      // already handled explicitly above, but prettify rewrites
      // `Power(n, 2)` to `Square(n)`, which bypasses that branch.)
      else if (/^\d/.test(term)) {
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
    numer = missingIfEmpty(numer);
    denom = missingIfEmpty(denom);
  } else {
    // Report an empty numerator/denominator (e.g. `\frac{}{}`) as a
    // missing-operand error positioned at the empty group, so the editor can
    // flag it. `error('missing', …)` is emitted right after each group is
    // consumed, while the parser is positioned at that group.
    numer = isEmptySequence(numer)
      ? parser.error('missing', parser.index)
      : numer;
    denom = parser.parseGroup();
    denom = isEmptySequence(denom)
      ? parser.error('missing', parser.index)
      : denom;
  }
  // Leibniz partial-derivative notation, assembled from the ∂ markers emitted
  // by the `\partial` parser: `∂f/∂x`, `∂/∂x f(x)`, `∂²f/∂x∂y`, `∂²f/∂x²`.
  // Each `PartialDerivative(fnOrVar, degree)` marker carries the numerator
  // function or a denominator variable; the result canonicalizes to `D`.
  const denomPartials: MathJsonExpression[] =
    operator(denom) === 'PartialDerivative'
      ? [denom!]
      : operator(denom) === 'Multiply' ||
          operator(denom) === 'Sequence' ||
          operator(denom) === 'InvisibleOperator'
        ? operands(denom).filter((t) => operator(t) === 'PartialDerivative')
        : [];

  if (denomPartials.length > 0) {
    // The function being differentiated: the numerator's captured operand for
    // `∂f/∂x`, or — for the bare-numerator form `∂/∂x f(x)` — the expression
    // that follows the fraction.
    let fn: MathJsonExpression | null =
      operator(numer) === 'PartialDerivative' ? operand(numer, 1) : null;
    if (fn === null || fn === undefined || fn === 'Nothing')
      fn = unwrapSingleItemList(missingIfEmpty(parser.parseExpression()));

    // Differentiation variables from the denominator's ∂ markers. Each marker
    // carries either a single variable or a `List` of them (a `∂x ∂y` chain).
    const vars: MathJsonExpression[] = [];
    for (const p of denomPartials) {
      const arg = operand(p, 1);
      const list = operator(arg) === 'List' ? operands(arg) : [arg];
      for (const v of list) if (v && v !== 'Nothing') vars.push(v);
    }

    // A single variable with a numerator degree (∂²f/∂x²) repeats that variable.
    const degree = machineValue(operand(numer, 2)) ?? 1;
    if (vars.length === 1 && degree > 1)
      for (let i = 1; i < degree; i++) vars.push(vars[0]);

    if (vars.length > 0) return ['D', fn, ...vars] as MathJsonExpression;
  }

  // Handle ordinary (Leibniz) derivative notation:
  // - `\frac{d}{dx} f`, `\frac{\mathrm{d}}{dx} f`      (first order)
  // - `\frac{d^n}{dx^n} f`, `\frac{\mathrm{d}^n}{\mathrm{d}x^n} f` (n-th order,
  //   the form the serializer emits for `f''(x)` etc.)
  // - `\frac{d^n f}{dx^n}`                              (single-fraction form)
  const isDiffSym = (s: string | null): boolean =>
    s === 'd' || s === 'd_upright' || s === 'differentialD';

  // Extract the differential degree from the numerator, and — for the
  // single-fraction form — the function folded into it. The numerator is one
  // of: `d` (degree 1), `d^n` (degree n), or a product `d^n · f` / `d · f`.
  let numerDegree: number | null = null;
  let numerFn: MathJsonExpression | null = null;
  {
    const numerHead = operator(numer);
    const factors =
      numerHead === 'Multiply' ||
      numerHead === 'InvisibleOperator' ||
      numerHead === 'Sequence'
        ? [...operands(numer!)]
        : [numer!];
    const head = factors[0];
    if (isDiffSym(symbol(head))) {
      numerDegree = 1;
    } else if (
      operator(head) === 'Power' &&
      isDiffSym(symbol(operand(head, 1)))
    ) {
      const deg = machineValue(operand(head, 2));
      if (deg !== null && deg > 0) numerDegree = deg;
    }
    if (numerDegree !== null && factors.length > 1) {
      const rest = factors.slice(1);
      numerFn =
        rest.length === 1
          ? rest[0]
          : (['Multiply', ...rest] as MathJsonExpression);
    }
  }

  if (numerDegree !== null) {
    // Extract variable(s) from the denominator. Typical forms:
    // - 'dx' (single symbol)
    // - ['Sequence', 'd', 'x'] / ['Multiply', 'd', 'x']
    // - ['Multiply', 'd', ['Power', 'x', n]]  (n-th order denominator `dx^n`)
    const vars: MathJsonExpression[] = [];

    const collectVars = (expr: MathJsonExpression | null) => {
      if (!expr) return;
      const s = symbol(expr);
      // If it's a symbol that's not a differential operator, it's a variable
      if (s && !isDiffSym(s)) {
        vars.push(expr);
        return;
      }
      // If it's a sequence/multiply/invisible operator, inspect operands
      const h = operator(expr);
      if (h === 'Sequence' || h === 'Multiply' || h === 'InvisibleOperator') {
        for (const op of operands(expr)) collectVars(op);
      } else if (h === 'Power') {
        // `dx^n`: the differentiation variable is the base of the power; the
        // exponent restates the degree already carried by the numerator.
        const base = operand(expr, 1);
        if (base && !isDiffSym(symbol(base))) vars.push(base);
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

    // A single variable with a numerator degree (`d²/dx²`) repeats that
    // variable, matching the nested `D` form (`D(D(f, x), x)`).
    if (vars.length === 1 && numerDegree > 1)
      for (let i = 1; i < numerDegree; i++) vars.push(vars[0]);

    if (vars.length > 0) {
      // The function being differentiated is either folded into the numerator
      // (`\frac{d^n f}{dx^n}`) or follows the fraction (`\frac{d^n}{dx^n} f`).
      const fn =
        numerFn ??
        unwrapSingleItemList(missingIfEmpty(parser.parseExpression()));
      // Build the nested `D` form, e.g. `D(D(f, x), x)` for a second
      // derivative. This matches the Lagrange (`f''(x)`) parse and the `D`
      // serializer, which recovers the order by counting nested `D`s (a flat
      // `['D', f, x, x]` would otherwise re-serialize as a first derivative).
      let result: MathJsonExpression = fn;
      for (const v of vars) result = ['D', result, v] as MathJsonExpression;
      return result;
    }
  }

  return ['Divide', numer, denom];
}

function unwrapSingleItemList(expr: MathJsonExpression): MathJsonExpression {
  if (operator(expr) === 'List' && nops(expr) === 1) return operand(expr, 1)!;
  return expr;
}

function parseSlashDivide(
  parser: Parser,
  lhs: MathJsonExpression,
  terminator: Readonly<Terminator>
): MathJsonExpression | null {
  const rhs = parser.parseExpression({
    ...terminator,
    minPrec: DIVISION_PRECEDENCE + 1,
  });
  if (rhs === null) return ['Divide', lhs, MISSING];

  const derivative = parseCompactDerivative(lhs, rhs);
  if (derivative) return derivative;

  return ['Divide', lhs, rhs];
}

function parseCompactDerivative(
  numer: MathJsonExpression,
  denom: MathJsonExpression
): MathJsonExpression | null {
  const numerSym = symbol(numer);
  if (
    numerSym !== 'd' &&
    numerSym !== 'd_upright' &&
    numerSym !== 'differentialD'
  )
    return null;

  const h = operator(denom);
  if (h !== 'InvisibleOperator' && h !== 'Multiply') return null;

  const terms = operands(denom);
  if (terms.length < 3) return null;
  const differential = symbol(terms[0]);
  if (
    differential !== 'd' &&
    differential !== 'd_upright' &&
    differential !== 'differentialD'
  )
    return null;

  const variable = terms[1];
  if (!symbol(variable)) return null;

  const body: MathJsonExpression =
    terms.length === 3
      ? terms[2]
      : (['InvisibleOperator', ...terms.slice(2)] as MathJsonExpression);
  return ['D', normalizeCompactDerivativeBody(body), variable];
}

function normalizeCompactDerivativeBody(
  expr: MathJsonExpression
): MathJsonExpression {
  if (operator(expr) === 'Delimiter')
    return normalizeCompactDerivativeBody(operand(expr, 1)!);

  if (operator(expr) === 'InvisibleOperator') {
    const ops = operands(expr);
    if (ops.length === 2 && symbol(ops[0]) && operator(ops[1]) === 'Delimiter')
      return [symbol(ops[0])!, normalizeCompactDerivativeBody(ops[1])];

    return [
      'InvisibleOperator',
      ...ops.map((op) => normalizeCompactDerivativeBody(op)),
    ];
  }

  if (Array.isArray(expr)) {
    const head = expr[0];
    if (typeof head !== 'string') return expr;
    const result: [string, ...MathJsonExpression[]] = [head];
    for (let i = 1; i < expr.length; i++)
      result.push(
        normalizeCompactDerivativeBody(expr[i] as MathJsonExpression)
      );
    return result;
  }

  return expr;
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

/** Parse `\binom{n}{k}` (and the `\dbinom`/`\tbinom` display/text variants)
 *  as `Binomial(n, k)`. Mirrors `parseFraction`'s two-group reading. */
function parseBinomial(parser: Parser): MathJsonExpression | null {
  let top: MathJsonExpression | null = parser.parseGroup();
  let bottom: MathJsonExpression | null = null;
  if (top === null) {
    top = missingIfEmpty(parser.parseToken());
    bottom = missingIfEmpty(parser.parseToken());
  } else {
    top = isEmptySequence(top) ? parser.error('missing', parser.index) : top;
    bottom = parser.parseGroup();
    bottom = isEmptySequence(bottom)
      ? parser.error('missing', parser.index)
      : bottom;
  }
  return ['Binomial', top, missingIfEmpty(bottom)];
}

function serializeBinomial(
  serializer: Serializer,
  expr: MathJsonExpression | null
): string {
  if (expr === null) return '';
  const top = serializer.serialize(missingIfEmpty(operand(expr, 1)));
  const bottom = serializer.serialize(missingIfEmpty(operand(expr, 2)));
  return `\\binom{${top}}{${bottom}}`;
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

  // A Power base means (a^b)^c. It must serialize as {a^b}^c — NOT a^{b^c},
  // which reads as a^(b^c), a different expression (e.g. (x^3)^{2/5} would
  // become x^{3^{2/5}} and fail to round-trip). `supsub` braces the base
  // because it contains '^', producing the correct {a^b}^c.

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
 *
 * When all components are numeric, computes decimal degrees and returns
 * Degrees(total). This ensures negation works correctly: -9°30' becomes
 * Negate(Degrees(9.5)) which canonicalizes to -9.5°.
 */
function parseDMS(parser: Parser, lhs: MathJsonExpression): MathJsonExpression {
  parser.skipSpace();

  // Check for arc-minutes: 30'
  const savepoint = parser.index;
  const minExpr = parser.parseNumber();

  let minNum: number | null = null;
  let secNum: number | null = null;

  if (minExpr !== null && (parser.match("'") || parser.match('\\prime'))) {
    // Found arc-minutes
    minNum = machineValue(minExpr);
    parser.skipSpace();

    // Check for arc-seconds: 15"
    const secSavepoint = parser.index;
    const secExpr = parser.parseNumber();

    if (
      secExpr !== null &&
      (parser.match('"') || parser.match('\\doubleprime'))
    ) {
      secNum = machineValue(secExpr);
    } else {
      // No arc-seconds, restore position
      parser.index = secSavepoint;
    }
  } else {
    // No arc-minutes, restore position
    parser.index = savepoint;
    return ['Degrees', lhs];
  }

  // Compute total decimal degrees when all components are numeric.
  // This avoids Negate(Add(Quantity...)) which fails canonicalization.
  const degNum = machineValue(lhs);
  if (degNum !== null && minNum !== null) {
    let total = degNum + minNum / 60;
    if (secNum !== null) total += secNum / 3600;
    return ['Degrees', total];
  }

  // Fallback for symbolic values: return structured Add form
  const parts: MathJsonExpression[] = [['Quantity', lhs, 'deg']];
  parts.push(['Quantity', minExpr!, 'arcmin']);
  if (secNum !== null) parts.push(['Quantity', secNum, 'arcsec']);
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
    parse: (parser: Parser, lhs: MathJsonExpression) => parseDMS(parser, lhs),
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const options = serializer.options;
      const arg = operand(expr, 1);

      // Check if DMS format or normalization is requested
      if (
        options.dmsFormat ||
        (options.angleNormalization && options.angleNormalization !== 'none')
      ) {
        const argValue = machineValue(arg);
        if (argValue !== null) {
          let degrees = argValue;
          if (
            options.angleNormalization &&
            options.angleNormalization !== 'none'
          )
            degrees = normalizeAngle(degrees, options.angleNormalization);

          if (options.dmsFormat) return formatDMS(degrees);
          return `${degrees}°`;
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
    parse: (parser: Parser, lhs: MathJsonExpression) => parseDMS(parser, lhs),
  },
  // No `precedence` on these entries: the dictionary validator
  // (definitions.ts:947-968) rejects `precedence` on entries whose
  // `latexTrigger` starts with `^` or `_`, since their binding is
  // governed by LaTeX grouping rules, not operator precedence.
  {
    latexTrigger: ['^', '<{>', '\\circ', '<}>'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) => parseDMS(parser, lhs),
  },
  {
    latexTrigger: ['^', '\\circ'],
    kind: 'postfix',
    parse: (parser: Parser, lhs: MathJsonExpression) => parseDMS(parser, lhs),
  },
  {
    latexTrigger: ['°'],
    kind: 'postfix',
    precedence: 880,
    parse: (parser: Parser, lhs: MathJsonExpression) => parseDMS(parser, lhs),
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
    name: 'DMS',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const deg = machineValue(operand(expr, 1));
      const min = machineValue(operand(expr, 2));
      const sec = machineValue(operand(expr, 3));

      // For numeric args, format as DMS notation
      if (deg !== null) {
        const m = min ?? 0;
        const s = sec ?? 0;
        let result = `${deg}°`;
        if (m !== 0 || s !== 0) result += `${m}'`;
        if (s !== 0) result += `${s}"`;
        return result;
      }

      // Fallback for symbolic args
      const args: string[] = [];
      for (const i of [1, 2, 3] as const) {
        const op = operand(expr, i);
        if (op !== null) args.push(serializer.serialize(op));
      }
      return `\\operatorname{DMS}(${args.join(', ')})`;
    },
  },
  {
    latexTrigger: ['\\infty'],
    parse: 'PositiveInfinity',
  },
  {
    latexTrigger: ['\\infin'],
    parse: 'PositiveInfinity',
  },
  {
    latexTrigger: ['∞'], // ∞ U+221E INFINITY
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
    parse: (parser: Parser) => parseExp(parser),
  },
  {
    latexTrigger: '\\exp',
    parse: (parser: Parser) => parseExp(parser),
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
    parse: (_parser: Parser, body: MathJsonExpression) =>
      isEmptySequence(body) ? null : (['Abs', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\\vert'],
    closeTrigger: ['\\vert'],
    parse: (_parser: Parser, body: MathJsonExpression) =>
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

      // Preserve explicit `+ -n` as a negative numeric literal in raw form
      // (while subtraction `a-b` still keeps a `Negate` term).
      if (operator(rhs) === 'Negate') {
        const value = operand(rhs, 1);
        if (isNumberExpression(value))
          return foldAssociativeOperator(
            'Add',
            lhs,
            negateNumberLiteral(value)
          );
      }

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
    parse: (_parser: Parser, body: MathJsonExpression) =>
      isEmptySequence(body) ? null : (['Ceil', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u2308'], // ⌈ U+2308 LEFT CEILING
    closeTrigger: ['\u2309'], // ⌉ U+2309 RIGHT CEILING
    parse: (_parser: Parser, body: MathJsonExpression) =>
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
    latexTrigger: '\\dfrac',
    precedence: DIVISION_PRECEDENCE,
    parse: parseFraction,
  },
  {
    latexTrigger: '\\tfrac',
    precedence: DIVISION_PRECEDENCE,
    parse: parseFraction,
  },
  {
    latexTrigger: '\\cfrac',
    precedence: DIVISION_PRECEDENCE,
    parse: parseFraction,
  },
  {
    name: 'Binomial',
    latexTrigger: '\\binom',
    parse: parseBinomial,
    serialize: serializeBinomial,
  },
  {
    latexTrigger: '\\dbinom',
    parse: parseBinomial,
  },
  {
    latexTrigger: '\\tbinom',
    parse: parseBinomial,
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
    parse: parseSlashDivide,
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
    parse: (
      parser: Parser,
      lhs: MathJsonExpression
    ): MathJsonExpression | null => {
      // Disambiguate `!` (factorial) from `!=` (not-equal): when a `!` is
      // *immediately* followed by `=` (no intervening space), read it as the
      // `!=` inequality operator, not `Factorial(lhs) = …`. `3!=2` is
      // not-equal; `3! = 2` (with a space) stays factorial. Returning null
      // lets the infix `!=` (`Unequal`) definition match instead.
      if (parser.peek === '=') return null;
      return ['Factorial', lhs];
    },
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
    parse: (_parser: Parser, body: MathJsonExpression) =>
      isEmptySequence(body) ? null : (['Floor', body] as MathJsonExpression),
  },
  {
    kind: 'matchfix',
    openTrigger: ['\u230a'], // ⌊ U+230A LEFT FLOOR
    closeTrigger: ['\u230b'], // ⌋ U+230B RIGHT FLOOR
    parse: (_parser: Parser, body: MathJsonExpression) =>
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
      const sup = parseFunctionSup(parser);
      const args = parser.parseArguments('implicit');
      if (args === null)
        return sup === null
          ? ('Lg' as MathJsonExpression)
          : (['Power', 'Lg', sup] as MathJsonExpression);
      // `\lg^{-1} x` → `10^x` (inverse of base-10 log).
      return applyFunctionSup(
        ['Log', ...args, 10] as MathJsonExpression,
        sup,
        () => ['Power', 10, args[0]] as MathJsonExpression
      );
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
      // Use parseExpression instead of parseArguments('implicit') so that
      // postfix operators like ^x are included in the limit body.
      // e.g. \lim_{x\to 0}\left(x\right)^x  →  Limit(x^x) not Limit(x)^x
      const expr = parser.parseExpression({
        minPrec: MULTIPLICATION_PRECEDENCE,
      });
      if (!expr) return null;
      return [
        'Limit',
        ['Function', expr, operand(base, 1)],
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
  // Unicode minus-plus spelling (paste/keyboard input), parsed the same as
  // `\mp`.
  {
    latexTrigger: ['∓'], // ∓ U+2213 MINUS-OR-PLUS SIGN
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    parse: 'MinusPlus',
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
  // Unicode multiplication-sign spellings (paste/keyboard input), parsed the
  // same as `\times`/`\cdot`.
  {
    latexTrigger: ['×'], // × U+00D7 MULTIPLICATION SIGN
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'Multiply',
  },
  {
    latexTrigger: ['·'], // · U+00B7 MIDDLE DOT
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'Multiply',
  },
  // --- Decorated binary operators (inert heads) ---
  // `\oplus`, `\otimes`, `\star`, `\circledast`, ... conventionally denote a
  // *custom* binary operation (group/ring constructions, convolutions,
  // competition-defined operators). They parse to inert structural heads
  // (CirclePlus, CircleTimes, Star, ... — MathML/Mathematica naming) that are
  // not evaluated; consumers or `ce.assign` give them meaning.
  {
    name: 'CirclePlus',
    latexTrigger: ['\\oplus'],
    kind: 'infix',
    associativity: 'any',
    precedence: ADDITION_PRECEDENCE,
  },
  {
    latexTrigger: ['⊕'], // U+2295 CIRCLED PLUS
    kind: 'infix',
    associativity: 'any',
    precedence: ADDITION_PRECEDENCE,
    parse: 'CirclePlus',
  },
  {
    name: 'CircleMinus',
    latexTrigger: ['\\ominus'],
    kind: 'infix',
    precedence: ADDITION_PRECEDENCE,
  },
  {
    latexTrigger: ['⊖'], // U+2296 CIRCLED MINUS
    kind: 'infix',
    precedence: ADDITION_PRECEDENCE,
    parse: 'CircleMinus',
  },
  {
    name: 'CircleTimes',
    latexTrigger: ['\\otimes'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
  },
  {
    latexTrigger: ['⊗'], // U+2297 CIRCLED TIMES
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'CircleTimes',
  },
  {
    name: 'CircleDot',
    latexTrigger: ['\\odot'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
  },
  {
    latexTrigger: ['⊙'], // U+2299 CIRCLED DOT OPERATOR
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'CircleDot',
  },
  {
    name: 'CircledAst',
    latexTrigger: ['\\circledast'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
  },
  {
    latexTrigger: ['⊛'], // U+229B CIRCLED ASTERISK OPERATOR
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'CircledAst',
  },
  {
    name: 'Star',
    latexTrigger: ['\\star'],
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
  },
  {
    latexTrigger: ['⋆'], // U+22C6 STAR OPERATOR
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'Star',
  },

  {
    latexTrigger: ['⋅'], // ⋅ U+22C5 DOT OPERATOR
    kind: 'infix',
    associativity: 'any',
    precedence: MULTIPLICATION_PRECEDENCE,
    parse: 'Multiply',
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
  // Function-style alias: `\operatorname{mod}(a, b)`
  { latexTrigger: '\\operatorname{mod}', parse: 'Mod' },
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
    parse: (_parser: Parser, expr: MathJsonExpression) =>
      isEmptySequence(expr) ? null : (['Norm', expr] as MathJsonExpression),
  },
  {
    //   /** If the argument is a vector */
    /** @todo: domain check */
    name: 'Norm',
    kind: 'matchfix',
    openTrigger: ['\\left', '\\Vert'],
    closeTrigger: ['\\right', '\\Vert'],
    parse: (_parser: Parser, expr: MathJsonExpression) =>
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
    // `a \pm b` is a measurement: a nominal value carrying a 1σ absolute error.
    // (The former branch-tuple `PlusMinus` role migrated to an explicit `List`
    // of the two branch values on the engine-output side.)
    name: 'Measurement',
    latexTrigger: ['\\pm'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    serialize: serializeMeasurement,
  },
  {
    latexTrigger: ['\\pm'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['Measurement', 0, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['Measurement', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    latexTrigger: ['\\plusmn'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['Measurement', 0, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  // Unicode plus-minus spelling (paste/keyboard input), parsed the same as
  // `\pm`/`\plusmn`.
  {
    latexTrigger: ['±'], // ± U+00B1 PLUS-MINUS SIGN
    kind: 'infix',
    associativity: 'any',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['Measurement', lhs, missingIfEmpty(rhs)] as MathJsonExpression;
    },
  },
  {
    latexTrigger: ['±'],
    kind: 'prefix',
    precedence: ARROW_PRECEDENCE,
    parse: (parser, terminator) => {
      const rhs = parser.parseExpression({ ...terminator, minPrec: 400 });
      return ['Measurement', 0, missingIfEmpty(rhs)] as MathJsonExpression;
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
      return `\\operatorname{Reduce}\\left(${serializer.serialize(
        collection
      )}, ${serializer.serialize(operand(expr, 2))}\\right)`;
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
    name: 'Heaviside',
    symbolTrigger: 'Heaviside',
    kind: 'function',
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
    latexTrigger: ['√'], // √ U+221A SQUARE ROOT (`√4`, `√{x+1}`)
    parse: parseRoot,
  },
  {
    latexTrigger: ['½'], // ½ U+00BD VULGAR FRACTION ONE HALF
    parse: (): MathJsonExpression => ['Rational', 1, 2],
  },
  {
    latexTrigger: ['⅓'], // ⅓ U+2153 VULGAR FRACTION ONE THIRD
    parse: (): MathJsonExpression => ['Rational', 1, 3],
  },
  {
    latexTrigger: ['¼'], // ¼ U+00BC VULGAR FRACTION ONE QUARTER
    parse: (): MathJsonExpression => ['Rational', 1, 4],
  },
  {
    latexTrigger: ['¾'], // ¾ U+00BE VULGAR FRACTION THREE QUARTERS
    parse: (): MathJsonExpression => ['Rational', 3, 4],
  },
  {
    latexTrigger: ['⅔'], // ⅔ U+2154 VULGAR FRACTION TWO THIRDS
    parse: (): MathJsonExpression => ['Rational', 2, 3],
  },
  {
    name: 'Subtract',
    latexTrigger: ['-'],
    kind: 'infix',
    associativity: 'left',
    precedence: ADDITION_PRECEDENCE + 2,
    parse: (parser, lhs, terminator) => {
      const rhs = parser.parseExpression({
        ...terminator,
        minPrec: ADDITION_PRECEDENCE + 3,
      });
      if (rhs === null) return null;
      return ['Subtract', lhs, rhs] as MathJsonExpression;
    },
    serialize: (serializer, expr) => {
      const lhs = serializer.wrap(operand(expr, 1), ADDITION_PRECEDENCE + 2);
      let rhs = serializer.wrap(operand(expr, 2), ADDITION_PRECEDENCE + 3);
      // If the right operand serializes with a leading `-` (a `Negate` or a
      // negative literal), wrap it in parentheses so we emit `x-(-y)` rather
      // than `x--y`, which would otherwise re-parse as double negation of a
      // different structure (and reads as a C-style decrement to a human).
      if (rhs.startsWith('-')) rhs = serializer.wrapString(rhs, 'normal');
      return joinLatex([lhs, '-', rhs]);
    },
  },
  // Euclidean distance between two points (tuples of numbers).
  {
    name: 'Distance',
    latexTrigger: ['\\operatorname{distance}'],
    kind: 'function',
    serialize: (serializer, expr) =>
      '\\operatorname{distance}' + serializer.wrapArguments(expr),
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

  // We have a `\le` range in the subscript. The chained form
  // `lower \le i \le upper` parses to a three-operand `LessEqual`; the
  // one-sided forms `lower \le i` and `i \le upper` to a two-operand one.
  // (Strict `<` chains and `Greater`/`Less` are intentionally not treated as
  // index sets — mirroring the existing non-strict-only `GreaterEqual` case;
  // their inclusive/exclusive bounds are a separate notation decision.)
  if (operator(expr) === 'LessEqual') {
    const ops = operands(expr) ?? [];
    if (ops.length === 3) {
      // lower \le index \le upper
      const index = symbol(ops[1]) ?? 'Nothing';
      return { index, lower: ops[0], upper: ops[2] };
    }
    if (ops.length === 2) {
      // `index \le upper` (symbol on the left) or `lower \le index`
      if (symbol(ops[0])) return { index: symbol(ops[0])!, upper: ops[1] };
      if (symbol(ops[1]))
        return { index: symbol(ops[1])!, lower: ops[0], upper };
    }
  }

  // We have `i=1` or `i=1..10` in the subscript
  if (operator(expr) === 'Equal') {
    const index = symbol(operand(expr, 1)) ?? 'Nothing';
    // We have i=1..10
    const rhs = operand(expr, 2);
    if (operator(rhs) === 'Range') {
      const lower = operand(rhs, 1) ?? 1;
      const upper = operand(rhs, 2) ?? undefined;
      // Note: Element form (i \in S) is handled below. Step-range form
      // (i=1..3..10) intentionally deferred — uncommon LaTeX notation.
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

/**
 * Consume an optional power superscript following a function name, e.g. the
 * `^2` in `\ln^2 x` or the `^{-1}` in `\ln^{-1} x`. Mirrors the handling in
 * `parseTrig` (`definitions-trigonometry.ts`): the superscript binds to the
 * *applied* function, so `\ln^2 x` reads as `(\ln x)^2`, not `\ln(x^2)`.
 * Returns the parsed exponent, or `null` if there is no superscript.
 */
function parseFunctionSup(parser: Parser): MathJsonExpression | null {
  parser.skipSpace();
  if (!parser.match('^')) return null;
  return parser.parseGroup() ?? parser.parseToken();
}

/** Whether a parsed superscript represents `-1` — either the literal `-1` or
 *  the `\ln^{-1}`-style `["Negate", 1]` that `parseGroup` produces for `{-1}`. */
function isMinusOneSup(sup: MathJsonExpression): boolean {
  if (machineValue(sup) === -1) return true;
  return operator(sup) === 'Negate' && machineValue(operand(sup, 1)) === 1;
}

/** Wrap an applied-function expression in a power, unless the exponent is
 *  `-1` (an inverse function), in which case `makeInverse` supplies the
 *  inverse form (e.g. `\ln^{-1} x` → `exp(x)`). */
function applyFunctionSup(
  applied: MathJsonExpression,
  sup: MathJsonExpression | null,
  makeInverse: () => MathJsonExpression
): MathJsonExpression {
  if (sup === null) return applied;
  if (isMinusOneSup(sup)) return makeInverse();
  return ['Power', applied, sup] as MathJsonExpression;
}

function parseExp(parser: Parser): MathJsonExpression {
  const sup = parseFunctionSup(parser);
  const args = parser.parseArguments('implicit');
  if (args === null)
    return sup === null
      ? ('Exp' as MathJsonExpression)
      : (['Power', 'Exp', sup] as MathJsonExpression);
  // `\exp^{-1} x` → `\ln x` (inverse of the exponential).
  return applyFunctionSup(
    ['Exp', ...args] as MathJsonExpression,
    sup,
    () => ['Ln', args[0]] as MathJsonExpression
  );
}

function parseLog(command: string, parser: Parser): MathJsonExpression | null {
  let sub: MathJsonExpression | null = null;

  if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();

  // Optional power/inverse superscript, e.g. `\log_2^2 x` → `(\log_2 x)^2`,
  // `\ln^2 x` → `(\ln x)^2`, `\ln^{-1} x` → the inverse (`exp`).
  const sup = parseFunctionSup(parser);

  const args = parser.parseArguments('implicit');

  if (args === null && sub === null)
    return sup === null
      ? ([command] as MathJsonExpression)
      : (['Power', command, sup] as MathJsonExpression);
  if (args === null)
    return sup === null
      ? ([command, sub] as MathJsonExpression)
      : (['Power', [command, sub], sup] as MathJsonExpression);

  // The natural log and the base-`b` log have well-defined inverses:
  // `\ln^{-1} x` → `exp(x)`, `\log_b^{-1} x` → `b^x` (with `b` defaulting to
  // 10, the base of a bare `\log`).
  const inverse = (): MathJsonExpression =>
    command === 'Ln'
      ? (['Exp', args[0]] as MathJsonExpression)
      : (['Power', sub ?? 10, args[0]] as MathJsonExpression);

  let applied: MathJsonExpression;
  if (sub === null) applied = [command, ...args] as MathJsonExpression;
  else if (sub === 10) applied = ['Log', args[0]] as MathJsonExpression;
  else if (sub === 2) applied = ['Lb', ...args] as MathJsonExpression;
  else applied = ['Log', args[0], sub] as MathJsonExpression;

  return applyFunctionSup(applied, sup, inverse);
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
