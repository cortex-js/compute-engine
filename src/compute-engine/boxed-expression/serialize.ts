import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';

import type { MathJsonExpression } from '../../math-json/types.js';

import { Rational } from '../numerics/types.js';
import { isInMachineRange } from '../numerics/numeric-bignum.js';
import {
  isInteger,
  isMachineRational,
  isNegativeOne,
  isOne,
  isRational,
  machineDenominator,
  machineNumerator,
  isZero,
  neg,
} from '../numerics/rationals.js';
import {
  numberToString,
  roundToSignificant,
  roundToDecimalPlace,
  validateDisplayDigits,
  withFractionPart,
} from '../numerics/strings.js';
import { isFloatSpelling, numberToExpression } from '../numerics/expression.js';

import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { displayDigits } from '../numeric-value/big-numeric-value.js';

import { order } from './order.js';
import { mayBeMatrixPowerBase } from './matrix-operand.js';
import { asRational, asSmallInteger } from './numerics.js';
import type {
  IComputeEngine as ComputeEngine,
  Metadata,
  Expression,
  FunctionInterface,
  JsonSerializationOptions,
  DisplayDigits,
} from '../global-types.js';
import { boxBignumResult, isOperatorDef } from './utils.js';
import { isInferredTypedParameter } from './inferred-annotations.js';
import { freeAnonymousSlots } from './function-literal.js';
import {
  isNumber,
  isSymbol,
  isString,
  isCharacter,
  isFunction,
  isObject,
  isDictionary,
  containsContinuationOperand,
} from './type-guards.js';
import { isImaginaryPartFinite } from './imaginary-part.js';
import {
  hidesLibraryBinding,
  inSerializationScope,
  structuralScope,
} from '../library-shadowing.js';
import { isApplicableDef } from '../function-utils.js';
import { matchesNumber, matchesSymbol } from '../../math-json/utils.js';
import { latexSerializeOptions } from './latex-serialize-options.js';

// Lazy reference to break circular dependency:
// arithmetic-mul-div → ... → abstract-boxed-expression → serialize
// Inline the subset of Product we need (constructor + asRationalExpression)
// to avoid importing from arithmetic-mul-div.ts.
interface ProductLike {
  asRationalExpression(): Expression;
}
type ProductConstructor = new (
  ce: ComputeEngine,
  xs?: ReadonlyArray<Expression>,
  options?: { canonical?: boolean }
) => ProductLike;
let _Product: ProductConstructor;
/** @internal */
export function _setProduct(fn: ProductConstructor) {
  _Product = fn;
}

function _escapeJsonString(s: undefined): undefined;
function _escapeJsonString(s: string): string;
function _escapeJsonString(s: string | undefined): string | undefined {
  return s;
}

/** Serialize an expression to LaTeX for metadata, applying any
 *  engine-wide latexOptions (e.g. decimalSeparator). */
function _serializeLatexMetadata(
  ce: ComputeEngine,
  expr: MathJsonExpression
): string {
  return ce.latexSyntax!.serialize(expr, latexSerializeOptions(ce));
}

/**
 * True for the sum of a negative integer and a negative fraction, the
 * canonical form of a negative mixed number (`-2\frac{1}{2}` is
 * `Add(-2, -1/2)`). It is kept as a sum, which the LaTeX serializer writes
 * as a mixed number: as a subtraction, `-\frac{1}{2}-2`, it reads back as
 * `-5/2`.
 */
function isNegativeMixedNumber(args: ReadonlyArray<Expression>): boolean {
  const [whole, fraction] = args;
  if (!isNumber(whole) || whole.isInteger !== true) return false;
  if (whole.isNegative !== true) return false;
  // A literal fraction (canonical form), or a `Rational` function of two
  // integer literals (structural form).
  if (isNumber(fraction))
    return (
      fraction.isInteger === false &&
      fraction.isNegative === true &&
      fraction.type.matches('rational')
    );
  return (
    isFunction(fraction, 'Rational') &&
    isNumber(fraction.op1) &&
    isNumber(fraction.op2) &&
    fraction.op1.isInteger === true &&
    fraction.op1.isNegative === true &&
    fraction.op2.isInteger === true
  );
}

/** Attempt to transform an expression a+b as a subtraction b-a. Return null
 * if could not.
 *
 * The caller should have checked that 'Subtract' is not in the exclusions.
 *
 */
function serializeSubtract(
  ce: ComputeEngine,
  a: Expression,
  b: Expression,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression | null {
  if (isNumber(a) && a.isNegative) {
    const v = a.numericValue;
    if (typeof v === 'number') {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(-v)],
        options,
        metadata
      );
    }

    if (a.type.matches('rational')) {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [b, ce.number(v.neg())],
        options,
        metadata
      );
    }
  }

  // `-x + b` is written `b - x`, but not when `b` is a negative number:
  // `-x - 1` keeps the order of its terms, not `-1 - x`. The caller then
  // tries the operands the other way round, and the branch above writes
  // `-x + (-1)` as `-x - 1`.
  if (
    a.operator === 'Negate' &&
    b.operator !== 'Negate' &&
    !(isNumber(b) && b.isNegative) &&
    isFunction(a)
  )
    return serializeJsonFunction(ce, 'Subtract', [b, a.op1], options, metadata);

  return null;
}

/**
 * Whether the factor `x` of a product can put something in the denominator
 * when the product is written as a fraction
 * (`Product.asNumeratorDenominator()`). `Product` takes an exact integer
 * exponent out of a power and splits its base too (`(a/x)^2` is `a^2·x^{-2}`),
 * and it splits a negation and a nested product into their parts, so the
 * test looks into them the same way: a `Divide`, a power or root whose
 * exponent is not a known non-negative real number or whose base can
 * contribute a denominator, and a negation or product of such a factor. Any
 * other factor stays in the numerator, so a product of such factors is not a
 * fraction.
 *
 * A number literal is never in the denominator, also a rational one such as
 * `1/2`. The serializer builds the `Product` with `canonical: false`, and
 * such a product does not fold a number literal into its coefficient: it
 * keeps the literal as a factor with the exponent 1, which is a factor of
 * the numerator. So `Multiply(1/8, |u|)` is written as it is, and the split,
 * which builds and types new nodes, is not made for it.
 */
function mayContributeDenominator(x: Expression): boolean {
  if (isNumber(x)) return false;
  if (!isFunction(x)) return false;
  const op = x.operator;
  if (op === 'Divide') return true;
  if (op === 'Negate' || op === 'Multiply')
    return x.ops.some(mayContributeDenominator);
  if (op === 'Sqrt') return mayContributeDenominator(x.op1);
  if (op === 'Power' || op === 'Root')
    return (
      mayContributeDenominator(x.op1) ||
      !(isNumber(x.op2) && x.op2.isExact && x.op2.im === 0 && x.op2.re >= 0)
    );
  return false;
}

/**
 * Does the factor `x` of a product give a part to the denominator of the
 * product? These are the factors that `numeratorDenominator()` in the LaTeX
 * dictionary puts in a denominator: a `Divide` or a `Rational`, a power with
 * a negative number or a `Negate` as exponent, and an exact number that is
 * not an integer. A power with a symbolic exponent (`e^x`, `2^n`) is a
 * factor of the numerator. Unlike `mayContributeDenominator()`, this test
 * does not look inside the factor.
 *
 * One difference: `numeratorDenominator()` keeps a negative integer power of
 * a base that can be a matrix (`g(t)^{-1}` with `g` not declared) in the
 * numerator, and this test counts it as a denominator. So
 * `Multiply(Divide(x, y), Power(g(t), -1))` is still one quotient here,
 * which gives the same value.
 */
function hasDenominator(x: Expression): boolean {
  if (isNumber(x)) return x.isExact && x.isInteger !== true;
  if (!isFunction(x)) return false;
  if ((x.operator === 'Divide' || x.operator === 'Rational') && x.nops === 2)
    return true;
  if (x.operator === 'Power' && x.nops === 2) {
    const exp = x.op2;
    if (isFunction(exp, 'Negate')) return true;
    return isNumber(exp) && exp.im === 0 && exp.re < 0;
  }
  return false;
}

/**
 * Is `x` a `Divide` whose numerator is not the exact number 1
 * (`Divide(x, y)`, not `Divide(1, y)`)?
 */
function isNonReciprocalDivide(x: Expression): boolean {
  if (!isFunction(x, 'Divide') || x.nops !== 2) return false;
  const num = x.op1;
  return !(isNumber(num) && num.isExact && asSmallInteger(num) === 1);
}

/**
 * Is `x` a number literal raised to an exact negative integer other than -1
 * (`10^{-30}`, `2^{-3}`)?
 *
 * In a product, such a factor is not moved to the denominator of a
 * fraction: a denominator of exact numbers is computed when the LaTeX is
 * parsed, so `3·10^{-30}` written `\frac{3}{10^{30}}` reads back as the
 * rational `3/10^30`, not as the product of `3` and the power. This is the
 * rule that keeps a lone `Power(10, -30)` written `10^{-30}` (the `Power`
 * branch of `serializePrettyJsonFunction()`), applied to each factor.
 */
function isNumberToNegativePower(x: Expression): boolean {
  if (!isFunction(x, 'Power') || x.nops !== 2 || !isNumber(x.op1)) return false;
  const exp = x.op2;
  if (!isNumber(exp) || !exp.isExact) return false;
  const n = asSmallInteger(exp);
  return n !== null && n < -1;
}

/**
 * Split the factors of a `Multiply` into a numerator and a denominator,
 * preserving the original operand order and any explicit `Delimiter` wrapper.
 *
 * This mirrors `numeratorDenominator()` in the LaTeX dictionary. It is used
 * for structural (i.e. bound but not canonical) expressions, where the
 * `Product`-based rewrite would reorder the factors and erase `Delimiter`s.
 *
 * Return `null` if there is no denominator part, i.e. no rewrite to do.
 */
function structuralNumeratorDenominator(
  ce: ComputeEngine,
  args: ReadonlyArray<Expression>
): [Expression, Expression] | null {
  // A number literal to a negative integer power is not moved to a
  // denominator (see `isNumberToNegativePower()`). Here it cannot be moved
  // after the fraction either, since that would change the order of the
  // factors: the product is not rewritten.
  if (args.some(isNumberToNegativePower)) return null;

  const numerator: Expression[] = [];
  const denominator: Expression[] = [];

  for (const arg of args) {
    if (isFunction(arg) && arg.operator === 'Power' && arg.nops === 2) {
      const base = arg.op1;
      const exp = arg.op2;
      if (isFunction(exp) && exp.operator === 'Negate' && exp.nops === 1) {
        denominator.push(
          ce._fn('Power', [base, exp.op1], { canonical: false })
        );
      } else {
        // A float exponent (`x^{-1.0}`) is kept: `1/x` would read back
        // with the exact exponent `-1`
        const n = isNumber(exp) && exp.isExact ? asSmallInteger(exp) : null;
        // A negative integer power of a base that can be a matrix stays in
        // the numerator: it is the matrix inverse when the base is a matrix
        // (see `mayBeMatrixPowerBase()`)
        if (n !== null && n < 0 && mayBeMatrixPowerBase(base))
          numerator.push(arg);
        else if (n === -1) denominator.push(base);
        else if (n !== null && n < 0)
          denominator.push(
            ce._fn('Power', [base, ce.number(-n)], { canonical: false })
          );
        else numerator.push(arg);
      }
    } else if (
      isFunction(arg) &&
      (arg.operator === 'Divide' || arg.operator === 'Rational') &&
      arg.nops === 2
    ) {
      const num = arg.op1;
      const den = arg.op2;
      if (!isNumber(num) || !num.isExact || asSmallInteger(num) !== 1)
        numerator.push(num);
      if (!isNumber(den) || !den.isExact || asSmallInteger(den) !== 1)
        denominator.push(den);
    } else {
      // A bare literal rational factor (not a `Divide`/`Rational` function
      // form) also contributes a denominator part, mirroring the
      // `rationalValue()` fallback of `numeratorDenominator()`.
      const r = asRational(arg);
      if (r !== undefined && !isInteger(r)) {
        if (machineNumerator(r) !== 1) numerator.push(ce.number(r[0]));
        denominator.push(ce.number(r[1]));
      } else numerator.push(arg);
    }
  }

  if (denominator.length === 0) return null;

  const combine = (xs: Expression[]): Expression =>
    xs.length === 0
      ? ce.One
      : xs.length === 1
        ? xs[0]
        : ce._fn('Multiply', xs, { canonical: false });

  return [combine(numerator), combine(denominator)];
}

/**
 * The pretty version of `serializeJsonFunction()` applies
 * additional transformations to make the MathJSON more readable, for example
 *  it uses `Divide`  instead of `Multiply`/`Power` when applicable.
 *
 * When `_preserveStructure` is set (a verbatim, non-canonical tree), the
 * operand order and any explicit `Delimiter` are meaningful, so only
 * shape-preserving rewrites are applied.
 */
/**
 * The parameters of a `Function` literal with the annotations that INFERENCE
 * wrote removed (see `isInferredTypedParameter`, `function-utils.ts`): an
 * inferred annotation is not part of what the author said, so the MathJSON —
 * and the LaTeX, which serializes it — show only the annotations the author
 * chose, and the printed form of a literal does not depend on what else the
 * engine has bound. A caller that wants to see what inference did passes
 * `toMathJson({ inferredAnnotations: true })`. Returns `args` itself when
 * nothing is removed.
 */
function withoutInferredAnnotations(
  args: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (!args.some((p, i) => i > 0 && isInferredTypedParameter(p))) return args;
  return args.map((p, i) =>
    i > 0 && isInferredTypedParameter(p) && isFunction(p) ? p.op1 : p
  );
}

function serializePrettyJsonFunction(
  ce: ComputeEngine,
  name: string,
  args: ReadonlyArray<Expression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression {
  const preserveStructure = _preserveStructure;
  const exclusions = options.exclude;

  if (
    name === 'Add' &&
    args.length === 2 &&
    !exclusions.includes('Subtract') &&
    !isNegativeMixedNumber(args)
  ) {
    const sub =
      serializeSubtract(ce, args[0], args[1], options, metadata) ??
      serializeSubtract(ce, args[1], args[0], options, metadata);
    if (sub) return sub;
  }

  if (name === 'Divide' && args.length === 2 && exclusions.includes('Divide')) {
    return serializeJsonFunction(
      ce,
      'Multiply',
      [args[0], ce._fn('Power', [args[1], ce.NegativeOne])],
      options,
      metadata
    );
  }

  if (name === 'Multiply' && !exclusions.includes('Negate')) {
    // Only an exact `-1` is written as a negation: `-1.0·x` keeps its float
    // coefficient
    if (
      isNumber(args[0]) &&
      args[0].isExact &&
      args[0].im === 0 &&
      args[0].re === -1
    ) {
      if (args.length === 2)
        return serializeJsonFunction(ce, 'Negate', [args[1]], options);
      const rest = [...args.slice(1)];
      // A verbatim tree keeps its factor order: canonicalizing (or sorting)
      // the remaining factors here would reorder them.
      if (preserveStructure)
        return serializeJsonFunction(
          ce,
          'Negate',
          [ce.function('Multiply', rest, { form: 'structural' })],
          options,
          metadata
        );
      return serializeJsonFunction(
        ce,
        'Negate',
        [ce._fn('Multiply', rest.sort(order))],
        options,
        metadata
      );
    }
  }

  if (
    name === 'Multiply' &&
    !exclusions.includes('Divide') &&
    // Ellipsis fold barrier: a `ContinuationPlaceholder` operand — direct OR
    // inside a nested barrier product — makes this a notational product.
    // Aggregating it into a single quotient would move numerators and
    // denominators ACROSS the ellipsis (`\frac1a·\frac1b·…·\frac1z` →
    // `\frac{\dots}{abz}`), and `_Product` SORTS, which re-orders the elided
    // pattern (`…` drifts to the front) — neither re-parses to the same
    // product. Depth-aware for the same reason the canonicalization barrier
    // is: a held-back nested product carries its ellipsis below the surface.
    !args.some((x) => containsContinuationOperand(x)) &&
    // A product whose only denominators are those of its `Divide` factors
    // with a numerator other than 1 (`Multiply(90, Divide(x, Sin(k)))`) is
    // written as it is, `90\times\frac{x}{\sin(k)}`. One quotient for the
    // whole product, `\frac{90x}{\sin(k)}`, reads back as
    // `Divide(Multiply(90, x), Sin(k))`, which is another tree. A `Divide`
    // with the numerator 1 is the canonical form of a reciprocal, and it
    // still goes into one quotient: `Multiply(2, Divide(1, a))` is
    // `\frac{2}{a}`. The LaTeX serializer of `Multiply` has the same rule
    // (`serializeMultiply()` in `definitions-arithmetic.ts`; ROADMAP CE-787).
    !(
      args.some(isNonReciprocalDivide) &&
      args.every((x) => isNonReciprocalDivide(x) || !hasDenominator(x))
    )
  ) {
    // Display a product with negative exponents as a division if
    // there are terms with a negative degree.
    if (preserveStructure) {
      // The operand order and any explicit `Delimiter` must be preserved:
      // use an order-preserving split instead of `Product`.
      const nd = structuralNumeratorDenominator(ce, args);
      if (nd) return serializeJsonFunction(ce, 'Divide', nd, options, metadata);
    } else {
      // A number literal to a negative integer power is a factor after the
      // fraction (see `isNumberToNegativePower()`): `3·10^{-30}` is not
      // written `\frac{3}{10^{30}}`, and `(3/7)·10^{-30}` is
      // `\frac{3}{7}\times10^{-30}`.
      const kept = args.filter(isNumberToNegativePower);
      // The split into a numerator and a denominator builds and
      // canonicalizes new expressions, and it is most of the cost of a
      // prettified serialization (ROADMAP CE-438). A product with no factor
      // that can go to a denominator is written as it is, which is what the
      // split gives for it.
      if (args.some(mayContributeDenominator)) {
        const result = new _Product(
          ce,
          kept.length === 0
            ? args
            : args.filter((x) => !isNumberToNegativePower(x)),
          { canonical: false }
        ).asRationalExpression();
        // `canonicalDivide` strips a denominator of `1`, so a `Divide` here has
        // a real denominator — except when a guard in `canonicalDivide` left the
        // node inert (an invalid operand, for one). A `Divide(Multiply, 1)`
        // would send this rewrite back into the same `Multiply` forever, so it
        // is not a fraction worth displaying: fall through and serialize the
        // product as it is.
        const ops =
          result.operator === 'Divide'
            ? (result as Expression & FunctionInterface).ops
            : null;
        if (ops && !(isNumber(ops[1]) && ops[1].isSame(1))) {
          if (kept.length > 0)
            return serializeJsonFunction(
              ce,
              'Multiply',
              [ce._fn('Divide', ops, { canonical: false }), ...kept],
              options,
              metadata
            );
          return serializeJsonFunction(
            ce,
            result.operator,
            ops,
            options,
            metadata
          );
        }
      }
    }
  }

  if (name === 'Power') {
    // e^x -> Exp(x)
    if (!exclusions.includes('Exp') && isSymbol(args[0], 'ExponentialE'))
      return serializeJsonFunction(ce, 'Exp', [args[1]], options, metadata);

    // Only an exact exponent is rewritten (`Square`, `Divide`, `Sqrt`,
    // `Root`): the rewrite writes an exact exponent, so `x^{2.0}` would read
    // back as `x^2`
    if (isNumber(args[1]) && args[1].isExact) {
      const exp = asSmallInteger(args[1]);
      // x^2 -> Square(x)
      if (exp === 2 && !exclusions.includes('Square'))
        return serializeJsonFunction(
          ce,
          'Square',
          [args[0]],
          options,
          metadata
        );

      // A number literal raised to a negative integer other than -1 keeps
      // its power form (`10^{-30}`, `2^{-3}`): the quotient would compute
      // the denominator (`\frac{1}{1\cdot10^{30}}`), which parses back as
      // the rational `1/10^30`, not as the power `10^-30`. A negative
      // integer power of a base that can be a matrix (`g(x)^{-1}`) is not
      // written as a quotient either, which is element-wise for a matrix
      // (see `mayBeMatrixPowerBase()`).
      if (
        exp !== null &&
        exp < 0 &&
        !exclusions.includes('Divide') &&
        !(exp !== -1 && isNumber(args[0])) &&
        !mayBeMatrixPowerBase(args[0])
      ) {
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, exp === -1 ? args[0] : args[0].pow(-exp)],
          options,
          metadata
        );
      }

      const r = args[1].re;

      if (!exclusions.includes('Sqrt') && r === 0.5)
        return serializeJsonFunction(ce, 'Sqrt', [args[0]], options, metadata);
      if (!exclusions.includes('Sqrt') && r === -0.5)
        return serializeJsonFunction(
          ce,
          'Divide',
          [ce.One, ce._fn('Sqrt', [args[0]])],
          options,
          metadata
        );

      if (isRational(r)) {
        const n = machineNumerator(r);
        const d = machineDenominator(r);
        if (n === 1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(
              ce,
              'Sqrt',
              [args[0]],
              options,
              metadata
            );
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Root',
              [args[0], ce.number(r[1])],
              options,
              metadata
            );
        }
        if (n === -1) {
          if (!exclusions.includes('Sqrt') && d === 2)
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Sqrt', [args[0]])],
              options,
              metadata
            );
          if (!exclusions.includes('Root'))
            return serializeJsonFunction(
              ce,
              'Divide',
              [ce.One, ce._fn('Root', [args[0], ce.number(r[1])])],
              options,
              metadata
            );
        }
      }
    }
  }

  if (name === 'Add' && args.length === 2 && !exclusions.includes('Subtract')) {
    // Only an exact negative term is written as a subtraction of its
    // magnitude: `x - 2` would read back with the exact `2`
    if (isNumber(args[1]) && args[1].isExact) {
      const t1 = asSmallInteger(args[1]);
      if (t1 !== null && t1 < 0)
        return serializeJsonFunction(
          ce,
          'Subtract',
          [args[0], ce.number(-t1)],
          options,
          metadata
        );
    }
    if (isFunction(args[1], 'Negate')) {
      return serializeJsonFunction(
        ce,
        'Subtract',
        [args[0], args[1].op1],
        options,
        metadata
      );
    }
  }

  if (name === 'Tuple') {
    if (args.length === 1 && !exclusions.includes('Single'))
      return serializeJsonFunction(ce, 'Single', args, options, metadata);
    if (args.length === 2 && !exclusions.includes('Pair'))
      return serializeJsonFunction(ce, 'Pair', args, options, metadata);
    if (args.length === 3 && !exclusions.includes('Triple'))
      return serializeJsonFunction(ce, 'Triple', args, options, metadata);
  }

  if (name === 'Function' && args.length > 0) {
    if (options.inferredAnnotations !== true) {
      const stripped = withoutInferredAnnotations(args);
      if (stripped !== args)
        return serializePrettyJsonFunction(
          ce,
          name,
          stripped,
          options,
          metadata
        );
    }
    if (isFunction(args[0], 'Block')) {
      const block = args[0];
      if (block.nops === 1) {
        const params = args.slice(1);
        // `["Function", ["Block", ["Add", "_1", 2]], "_1"]` is written
        // `["Function", ["Add", "_1", 2]]`: with no parameter operand,
        // boxing reads the parameters off the wildcards of the body
        // (`anonymousParameters`, `function-utils.ts`), which takes `_1`,
        // `_2`, … in order for every wildcard the body mentions. The
        // shorthand is therefore used only when the parameter list is
        // exactly what that reading gives back: the parameters are `_1`,
        // `_2`, …, `_n` in order, and the wildcards the body mentions are
        // exactly those. That reading renames a bare `_` to `_1` and stops
        // at `_9`, so a body with a bare `_`, a free wildcard outside the
        // list (`_2` in `["Function", ["Add", "_1", "_2"], "_1"]`), or a
        // list past `_9` keeps its parameters. A parameter list that differs
        // (a named parameter such as `x_1`, an unused `_2`, a gap, a list
        // starting at `_2`) is kept too, or the shorthand would change the
        // arity or drop the parameter. The former `["Function", "Add"]`
        // spelling for `_1, _2 \mapsto Add(_1, _2)` was dropped: boxed, it is
        // a function of no argument whose body is the symbol `Add`.
        //
        // The wildcards are read as boxing reads them: a wildcard inside a
        // nested `Function` literal is that literal's parameter, not one of
        // this literal's (`freeAnonymousSlots`). A parameter used only in a
        // nested literal therefore keeps the list, or the shorthand would
        // re-box with fewer parameters.
        const body = block.op1;
        const bodyWildcards = freeAnonymousSlots(body);
        const wildcardParams =
          params.length <= 9 &&
          !bodyWildcards.has('_') &&
          bodyWildcards.size === params.length &&
          params.every(
            (x, i) =>
              isSymbol(x) &&
              x.symbol === `_${i + 1}` &&
              bodyWildcards.has(x.symbol)
          );
        // The body is written without its `Block`, in the scope of the
        // `Block`, where the parameters are bound (`inSerializationScope()`).
        const scope = serializationScopeOf(block);
        if (wildcardParams) {
          return inSerializationScope(scope, () =>
            serializeJsonFunction(ce, 'Function', [body], options, metadata)
          );
        }
        return inSerializationScope(scope, () =>
          serializeJsonFunction(
            ce,
            'Function',
            [block.op1, ...args.slice(1)],
            options,
            metadata
          )
        );
      }
    }
  }

  return serializeJsonFunction(ce, name, args, options, metadata);
}

function serializeJsonFunction(
  ce: ComputeEngine,
  name: string,
  args: ReadonlyArray<undefined | Expression>,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression {
  const exclusions = options.exclude;
  // The non-pretty route reaches here directly; the pretty route has
  // already stripped the inferred annotations (`withoutInferredAnnotations`).
  if (
    name === 'Function' &&
    options.inferredAnnotations !== true &&
    args.some((p, i) => i > 0 && p !== undefined && isInferredTypedParameter(p))
  )
    args = args.map((p, i) =>
      i > 0 && p !== undefined && isInferredTypedParameter(p) && isFunction(p)
        ? p.op1
        : p
    );

  //
  // Negate(number) is always prettyfied as a negative number, since `-2` gets
  // parsed as `['Negate', 2]` and not `-2`.
  if (name === 'Negate' && args.length === 1 && isNumber(args[0])) {
    const num0 = args[0].numericValue;
    if (num0 !== undefined) {
      if (typeof num0 === 'number')
        return serializeJsonNumber(ce, -num0, options);
      if (num0 instanceof BigDecimal)
        return serializeJsonNumber(ce, num0.neg(), options);
      if (num0 instanceof Complex)
        return serializeJsonNumber(ce, num0!.neg(), options);
      if (isRational(num0)) return serializeJsonNumber(ce, neg(num0), options);
    }
  }

  //
  // If there are some exclusions, try to avoid them.
  // This is done both to canonical or non-canonical expressions.
  //
  if (typeof name === 'string' && exclusions.includes(name)) {
    if (name === 'Rational' && args.length === 2)
      return serializeJsonFunction(ce, 'Divide', args, options, metadata);

    if (name === 'Complex' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [args[0], ce._fn('Multiply', [args[1] ?? ce.Missing, ce.I])],
        options,
        metadata
      );

    if (name === 'Sqrt' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], exclusions.includes('Half') ? ce.number([1, 2]) : ce.Half],
        options,
        metadata
      );

    if (
      name === 'Root' &&
      args.length === 2 &&
      isNumber(args[1]) &&
      args[1].isExact
    ) {
      const n = asSmallInteger(args[1]);
      if (n === 2) return serializeJsonFunction(ce, 'Sqrt', [args[0]], options);

      if (n !== null) {
        if (n < 0)
          return serializeJsonFunction(
            ce,
            'Divide',
            [
              ce.One,
              ce._fn('Power', [args[0] ?? ce.Missing, ce.number([1, -n])]),
            ],
            options,
            metadata
          );

        return serializeJsonFunction(
          ce,
          'Power',
          [args[0], ce.number([1, -n])],
          options,
          metadata
        );
      }
    }

    if (name === 'Square' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [args[0], ce.number(2)],
        options,
        metadata
      );

    if (name === 'Exp' && args.length === 1)
      return serializeJsonFunction(
        ce,
        'Power',
        [ce.E, args[0]],
        options,
        metadata
      );

    if (name === 'Pair' || name == 'Single' || name === 'Triple')
      return serializeJsonFunction(ce, 'Tuple', args, options, metadata);

    // Note: even though 'Subtract' is boxed out, we still need to handle it here
    // because the function may be called with a non-canonical 'Subtract' operator.
    if (name === 'Subtract' && args.length === 2)
      return serializeJsonFunction(
        ce,
        'Add',
        [args[0], ce._fn('Negate', [args[1] ?? ce.Missing])],
        options,
        metadata
      );
    if (name === 'Subtract' && args.length === 1)
      return serializeJsonFunction(ce, 'Negate', args, options, metadata);
  }

  const jsonHead = _escapeJsonString(name);

  // The display rounding of a `Measurement(value, error)` is performed by the
  // LaTeX/AsciiMath serializers, which apply an error-aware significant-figures
  // convention (round the error to `n` sig figs, then the nominal to the
  // error's place). Keep the operands lossless here so that stage is the sole
  // authority — otherwise a `{ significant: n }` control would crop the nominal
  // before the measurement rounding runs.
  const argOptions: Readonly<JsonSerializationOptions> =
    name === 'Measurement' ? { ...options, digits: 'max' } : options;

  const fn: MathJsonExpression = [
    jsonHead,
    ...args.map((x, i) =>
      x
        ? serializeJson(
            ce,
            x,
            isBindingPattern(name, i, x)
              ? bindingPatternOptions(argOptions)
              : argOptions
          )
        : 'Missing'
    ),
  ];

  const md: Metadata = { ...(metadata ?? {}) };

  // Determine if we need some LaTeX metadata
  if (options.metadata.includes('latex') && ce.latexSyntax) {
    md.latex = _escapeJsonString(md.latex ?? _serializeLatexMetadata(ce, fn));
  } else md.latex = '';

  // Determine if we have some wikidata metadata
  if (!options.metadata.includes('wikidata')) md.wikidata = '';

  // Source offsets are opt-in metadata (like `latex`/`wikidata`): only emit
  // them when explicitly requested (`metadata: 'sourceOffsets'` or `'all'`).
  if (!options.metadata.includes('sourceOffsets')) md.sourceOffsets = undefined;

  const sourceOffsets = md.sourceOffsets;

  //  Is shorthand allowed, and no metadata to include
  if (
    !md.latex &&
    !md.wikidata &&
    !sourceOffsets &&
    options.shorthands.includes('function')
  )
    return fn;

  // No shorthand allowed, or some metadata to include
  const result = { fn } as {
    fn: MathJsonExpression;
    latex?: string;
    wikidata?: string;
    sourceOffsets?: [start: number, end: number];
  };
  if (md.latex) result.latex = md.latex;
  if (md.wikidata) result.wikidata = md.wikidata;
  if (sourceOffsets) result.sourceOffsets = sourceOffsets;
  return result as MathJsonExpression;
}

/**
 * True when the operand at `index` of a call to `name` is a destructuring
 * pattern: a `Tuple` parameter of a `Function` literal (`((p, q)) => p q`),
 * or the `Tuple` target of an `Assign` or a `Declare` (`(a, b) := v`). The
 * canonical forms of these operators read the pattern as a raw `Tuple` and
 * refuse another operator: `["Function", body, ["Pair", "x", "y"]]` boxes to
 * an `expected-a-symbol` error in place of its parameter, and
 * `["Assign", ["Pair", "a", "b"], v]` to an `incompatible-type` error. The
 * `Tuple` target of an `Element` clause is not listed: its canonical form
 * reads `Pair` back as `Tuple`.
 *
 * In a canonical tree, the pattern is a raw operand and is written as
 * authored (`operandsToSerialize()`), which keeps `Tuple` on its own. This
 * test, by position, covers the trees that carry no raw mark: a structural
 * root (`expr.structural.toMathJson()`), whose operands are all structural.
 */
function isBindingPattern(
  name: string,
  index: number,
  operand: Expression
): boolean {
  if (!isFunction(operand, 'Tuple')) return false;
  if (name === 'Function') return index > 0;
  return index === 0 && (name === 'Assign' || name === 'Declare');
}

/**
 * The serialization options for a destructuring pattern
 * (`isBindingPattern()`): the pretty serializer writes a value `Tuple` of
 * one, two or three elements as `Single`, `Pair` or `Triple`, and a pattern
 * must keep `Tuple`, also in its nested patterns, so that the MathJSON boxes
 * back to the same pattern.
 */
function bindingPatternOptions(
  options: Readonly<JsonSerializationOptions>
): Readonly<JsonSerializationOptions> {
  const tupleNames = ['Single', 'Pair', 'Triple'];
  if (tupleNames.every((x) => options.exclude.includes(x))) return options;
  return { ...options, exclude: [...options.exclude, ...tupleNames] };
}

function serializeJsonString(
  s: string,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  s = _escapeJsonString(s);
  if (options.shorthands.includes('string')) {
    // Does it need to be quoted?
    if (matchesNumber(s) || matchesSymbol(s)) return `'${s}'`;
    return s;
  }
  return { str: s };
}

function serializeJsonSymbol(
  ce: ComputeEngine,
  sym: string,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression {
  if (sym === 'Half' && options.exclude.includes('Half')) {
    return serializeJsonNumber(ce, [1, 2], options, metadata);
  }

  metadata = { ...metadata };
  if (options.metadata.includes('latex') && ce.latexSyntax) {
    metadata.latex = metadata.latex ?? _serializeLatexMetadata(ce, sym);

    if (metadata.latex !== undefined)
      metadata.latex = _escapeJsonString(metadata.latex);
  } else metadata.latex = undefined;

  if (options.metadata.includes('wikidata')) {
    if (metadata.wikidata === undefined) {
      const def = ce.lookupDefinition(sym);
      if (def) {
        const wikidata = isOperatorDef(def)
          ? def.operator.wikidata
          : def.value.wikidata;
        if (wikidata !== undefined)
          metadata.wikidata = _escapeJsonString(wikidata);
      }
    }
  } else metadata.wikidata = undefined;

  sym = _escapeJsonString(sym!);

  if (
    metadata.latex === undefined &&
    metadata.wikidata === undefined &&
    options.shorthands.includes('symbol')
  ) {
    // If a shorthand symbol, return it.
    if (matchesSymbol(sym)) return sym;
    // Otherwise, bracket it
    return `\`${sym}\``;
  }

  if (metadata.latex !== undefined && metadata.wikidata !== undefined)
    return { sym, latex: metadata.latex, wikidata: metadata.wikidata };
  if (metadata.latex !== undefined) return { sym, latex: metadata.latex };
  if (metadata.wikidata !== undefined)
    return { sym, wikidata: metadata.wikidata };
  return { sym };
}

function serializeRepeatingDecimals(
  s: string,
  options: Readonly<JsonSerializationOptions>
): string {
  if (!options.repeatingDecimal) return s;

  // eslint-disable-next-line prefer-const
  let [_, wholepart, fractionalPart, exponent] =
    s.match(/^(.*)\.([0-9]+)([e|E][-+]?[0-9]+)?$/) ?? [];
  if (!fractionalPart) return s.toLowerCase();

  // The last digit may have been rounded off if it exceeds the precision,
  // which could throw off the repeating pattern detection. Ignore it.
  const lastDigit = fractionalPart[fractionalPart.length - 1];
  fractionalPart = fractionalPart.slice(0, -1);

  const MAX_REPEATING_PATTERN_LENGTH = 16;
  let prefix = '';

  for (
    let i = 0;
    i < fractionalPart.length - MAX_REPEATING_PATTERN_LENGTH;
    i++
  ) {
    prefix = fractionalPart.substring(0, i);
    // Try to find a repeating pattern of length j
    for (let j = 0; j <= MAX_REPEATING_PATTERN_LENGTH; j++) {
      const repetend = fractionalPart.substring(i, i + j + 1);
      const times = Math.floor(
        (fractionalPart.length - prefix.length) / repetend.length
      );
      if (times < 3) break;
      if ((prefix + repetend.repeat(times + 1)).startsWith(fractionalPart)) {
        // Found a repeating pattern

        // Aktually...
        if (repetend === '0') {
          if (lastDigit === '0')
            return wholepart + '.' + prefix + (exponent ?? '');
          return s;
        }
        return (
          wholepart + '.' + prefix + '(' + repetend + ')' + (exponent ?? '')
        );
      }
    }
  }

  fractionalPart += lastDigit;
  while (fractionalPart.endsWith('0'))
    fractionalPart = fractionalPart.slice(0, -1);

  if (exponent)
    return `${wholepart}.${fractionalPart}${exponent.toLowerCase()}`;
  return `${wholepart}.${fractionalPart}`;
}

/**
 * Resolve the effective number-display control from the serialization options.
 *
 * `options.digits` can be absent when the options are constructed directly
 * rather than by `toMathJson()`; the control is then `'max'` (all digits).
 */
function effectiveDigits(
  options: Readonly<JsonSerializationOptions>
): DisplayDigits {
  // An invalid value (a bare number included) throws, with a message that
  // names the accepted values (`validateDisplayDigits()`).
  return validateDisplayDigits(options.digits) ?? 'max';
}

function serializeJsonNumber(
  ce: ComputeEngine,
  value: number | bigint | NumericValue | BigDecimal | Complex | Rational,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression {
  const json = serializeJsonNumberSpelling(ce, value, options, metadata);
  // A float (a big or machine numeric value) is written with a fraction part
  // so that it is read back as a float.
  if (value instanceof NumericValue && !value.isExact)
    return floatSpelling(ce, json, options);
  return json;
}

/**
 * Give the MathJSON number `json`, the serialization of a float (inexact)
 * value, a fraction part if it has none: `2` becomes `{ num: "2.0" }` and
 * `{ num: "1e+800" }` becomes `{ num: "1.0e+800" }`. The exactness of a
 * number literal follows its spelling: a literal with a fraction part is a
 * float, and a safe-integer JSON number or a `{ num }` string without a
 * fraction part is an exact integer. Any other JSON number (`1.5`, `1e+30`)
 * is read back as a float, and is kept. The parts of a `Complex` are handled
 * the same way, unless one of them is already read back as a float.
 *
 * A caller that asked for no digits after the decimal point
 * (`digits: { fractional: 0 }`) gets the integer spelling it asked for.
 */
function floatSpelling(
  ce: ComputeEngine,
  json: MathJsonExpression,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  const digits = effectiveDigits(options);
  if (typeof digits === 'object' && 'fractional' in digits)
    if (digits.fractional === 0) return json;

  if (typeof json === 'number') {
    if (!Number.isSafeInteger(json)) return json;
    return { num: withFractionPart(numberToString(json)) };
  }
  // A number shorthand written as a string. `withFractionPart()` returns a
  // string that is not a plain decimal number (a symbol name) unchanged.
  if (typeof json === 'string') return withFractionPart(json);

  // A `Complex` with one part spelled as a float is read back as a float,
  // and is kept: `["Complex", 0, -1.1]`. Otherwise every part is given a
  // fraction part.
  if (Array.isArray(json)) {
    if (json[0] !== 'Complex') return json;
    const parts = json.slice(1) as MathJsonExpression[];
    if (parts.some(isFloatSpelling)) return json;
    return [
      json[0],
      ...parts.map((x) => floatSpelling(ce, x, options)),
    ] as MathJsonExpression;
  }
  if (typeof json === 'object' && json !== null) {
    if ('num' in json && typeof json.num === 'string') {
      const num = withFractionPart(json.num);
      if (num === json.num) return json;
      // A `latex` metadata that was written from the integer spelling is
      // written again from the float spelling. A verbatim `latex` (the
      // source of a parsed number) is kept.
      if (
        typeof json.latex === 'string' &&
        ce.latexSyntax &&
        json.latex === _serializeLatexMetadata(ce, { num: json.num })
      )
        return { ...json, num, latex: _serializeLatexMetadata(ce, { num }) };
      return { ...json, num };
    }
    if (
      'fn' in json &&
      Array.isArray(json.fn) &&
      json.fn[0] === 'Complex' &&
      !(json.fn.slice(1) as MathJsonExpression[]).some(isFloatSpelling)
    )
      return {
        ...json,
        fn: [
          json.fn[0],
          ...json.fn
            .slice(1)
            .map((x) => floatSpelling(ce, x as MathJsonExpression, options)),
        ],
      } as MathJsonExpression;
  }
  return json;
}

function serializeJsonNumberSpelling(
  ce: ComputeEngine,
  value: number | bigint | NumericValue | BigDecimal | Complex | Rational,
  options: Readonly<JsonSerializationOptions>,
  metadata?: Metadata
): MathJsonExpression {
  metadata = { ...metadata };

  if (!options.metadata.includes('latex')) metadata.latex = undefined;

  const shorthandAllowed =
    metadata.latex === undefined &&
    metadata.wikidata === undefined &&
    !options.metadata.includes('latex') &&
    options.shorthands.includes('number');

  const exclusions = options.exclude;

  if (value instanceof NumericValue) {
    if (value.isNaN) return serializeJsonSymbol(ce, 'NaN', options, metadata);

    if (value.isPositiveInfinity)
      return serializeJsonSymbol(ce, 'PositiveInfinity', options, metadata);

    if (value.isNegativeInfinity)
      return serializeJsonSymbol(ce, 'NegativeInfinity', options, metadata);

    if (value.isComplexInfinity)
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);

    if (shorthandAllowed) {
      if (value.isZero) return 0;
      if (value.isOne) return 1;
      if (value.isNegativeOne) return -1;
    }

    // We have an exact numeric value
    if (value instanceof ExactNumericValue) {
      // Note: implement same logic as in ExactNumericValue.toJSON()

      // A pure real integer (no denominator, no radical, no imaginary part) is
      // a whole number *value*, not a structural composite — so the
      // number-display control applies to it directly (e.g. `1500.0` with
      // `{ fractional: 2 }` must pad to `1500.00`, matching a bare `1500`).
      // `{ significant: n }` remains a no-op on it, and `'auto'`/`'max'` still
      // emit the bare integer.
      if (!value.isComplex && value.radical === 1 && isInteger(value.rational))
        return serializeJsonNumber(ce, value.rational[0], options);

      // Honor the `exclude` option for the heads emitted here. The default
      // `.json` path (`ExactNumericValue.toJSON()`) always uses `Rational`/
      // `Sqrt`; only `toMathJson({ exclude: […] })` diverges, so the default
      // output is unchanged (exclusions default to `[]`).
      const excludeRational = exclusions.includes('Rational');
      const excludeSqrt = exclusions.includes('Sqrt');
      // The components of an exact value (numerator/denominator of a rational,
      // radicand of a radical) are structural integers and always render in
      // full — the number-display control (`digits`) applies to the value as a
      // whole, not to these parts (e.g. `{ fractional: 2 }` must not turn
      // `1/3` into `1.00/3.00`).
      const partOptions: Readonly<JsonSerializationOptions> = {
        ...options,
        digits: 'max',
      };
      const rationalExpr = (r: Rational) => {
        if (isInteger(r)) return serializeJsonNumber(ce, r[0], partOptions);
        return [
          excludeRational ? 'Divide' : 'Rational',
          serializeJsonNumber(ce, r[0], partOptions),
          serializeJsonNumber(ce, r[1], partOptions),
        ] as MathJsonExpression;
      };
      // `√r` as either `Sqrt(r)` or, when `Sqrt` is excluded, `Power(r, 1/2)`
      // (with the `1/2` exponent itself honoring a `Rational` exclusion).
      const sqrtExpr = (radical: number): MathJsonExpression =>
        excludeSqrt
          ? ['Power', radical, rationalExpr([1, 2])]
          : ['Sqrt', radical];

      const componentExpr = (
        rational: Rational,
        radical: number
      ): MathJsonExpression => {
        if (radical === 1) return rationalExpr(rational);
        // Only have a radical
        if (isOne(rational)) return sqrtExpr(radical);
        if (isNegativeOne(rational)) return ['Negate', sqrtExpr(radical)];

        // Have both a radical and a rational

        if (rational[0] == 1)
          return [
            'Divide',
            sqrtExpr(radical),
            serializeJsonNumber(ce, rational[1], partOptions),
          ];
        if (rational[0] == -1)
          return [
            'Negate',
            [
              'Divide',
              sqrtExpr(radical),
              serializeJsonNumber(ce, rational[1], partOptions),
            ],
          ];

        return ['Multiply', rationalExpr(rational), sqrtExpr(radical)];
      };

      // Exact complex value: `['Complex', re, im]` with exact components
      // (mirrors `ExactNumericValue.toJSON()`)
      if (value.isComplex)
        return [
          'Complex',
          isZero(value.rational)
            ? 0
            : componentExpr(value.rational, value.radical),
          componentExpr(value.imRational, value.imRadical),
        ];

      return componentExpr(value.rational, value.radical);
    }

    // A value made by `N(x, n)` is displayed with its `n` digits when `n`
    // is more than the precision of the engine (`displayDigits()`). This
    // applies only to the display that follows the precision (`'auto'`):
    // the other controls are the choice of the caller.
    if (effectiveDigits(options) === 'auto') {
      const digits = displayDigits(value);
      if (digits !== undefined && digits > ce.precision)
        options = { ...options, digits: { significant: digits } };
    }

    // We have a real number (big or machine)
    if (!value.isComplex) {
      const re = value.bignumRe ?? value.re;
      return serializeJsonNumber(ce, re, options, metadata);
    }

    // We have a complex number. Its imaginary part is read without loss
    // (`bignumIm`) when the value holds one: the double `im` is only the
    // nearest double, `±Infinity` for a finite imaginary part beyond the
    // double range.
    if (!isImaginaryPartFinite(value))
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);

    return serializeJsonFunction(
      ce,
      'Complex',
      [
        boxBignumResult(ce, value.bignumRe ?? value.re),
        ce.number(value.bignumIm ?? value.im),
      ],
      options,
      {
        ...metadata,
        wikidata: 'Q11567',
      }
    );
  }

  //
  // Bignum
  //
  let num = '';
  if (value instanceof BigDecimal) {
    let result: string | undefined;
    if (value.isNaN()) result = 'NaN';
    else if (!value.isFinite())
      result = value.isPositive() ? 'PositiveInfinity' : 'NegativeInfinity';
    else {
      const digits = effectiveDigits(options);
      const wantFractional =
        typeof digits === 'object' && 'fractional' in digits;
      const needsRounding = typeof digits === 'object';

      // Use the number shorthand if the number can be represented as a machine
      // number and no explicit display rounding was requested.
      if (shorthandAllowed && !needsRounding && isInMachineRange(value))
        return value.toNumber();

      if (value.isInteger()) {
        if (wantFractional) {
          // `toFixed` semantics: pad with trailing zeros (e.g. `5` → `5.00`).
          num = roundToDecimalPlace(value, digits.fractional);
        } else {
          // Use toFixed for small integers, toString (scientific notation) for large
          // For very large/small integers, use toString which gives scientific notation
          const absStr = (
            value.significand < 0n ? -value.significand : value.significand
          ).toString();
          const adjustedExp = absStr.length + value.exponent - 1;
          num = adjustedExp > 20 ? value.toString() : value.toFixed(0);
        }
      } else if (wantFractional) {
        // `toFixed` semantics: emit the fixed-point string directly (with
        // any trailing-zero padding) — do not run repeating-decimal
        // detection, which would strip the padding.
        num = roundToDecimalPlace(value, digits.fractional);
      } else {
        let s: string;
        if (digits === 'max') s = value.toString();
        else if (digits === 'auto')
          s = roundToSignificant(value, ce.precision).toString();
        else s = roundToSignificant(value, digits.significant).toString();

        num = serializeRepeatingDecimals(s, options);

        if (shorthandAllowed) {
          // Can we shorthand to a JSON number after accounting for serialization precision?
          const val = value.toNumber();
          if (val.toString() === num) return val;
        }
      }
    }

    if (options.metadata.includes('latex') && ce.latexSyntax)
      metadata.latex =
        metadata.latex ??
        _serializeLatexMetadata(ce, result ?? ({ num } as MathJsonExpression));

    if (result) {
      if (metadata.latex !== undefined)
        return { sym: result, latex: metadata.latex };
      if (shorthandAllowed) return result;
      return { sym: result };
    }

    if (metadata.latex !== undefined) return { num, latex: metadata.latex };
    return shorthandAllowed ? num : { num };
  }

  //
  // Complex
  //
  if (value instanceof Complex) {
    if (value.isInfinite())
      return serializeJsonSymbol(ce, 'ComplexInfinity', options, metadata);
    if (value.isNaN()) {
      num = 'NaN';
      if (options.metadata.includes('latex') && ce.latexSyntax)
        metadata.latex =
          metadata.latex ??
          _serializeLatexMetadata(ce, { num } as MathJsonExpression);

      return metadata.latex !== undefined
        ? { num, latex: metadata.latex }
        : { num };
    }

    return serializeJsonFunction(
      ce,
      'Complex',
      [ce.number(value.re), ce.number(value.im)],
      options,
      {
        ...metadata,
        wikidata: 'Q11567',
      }
    );
  }

  //
  // Rational
  //
  if (isRational(value)) {
    const allowRational = !exclusions.includes('Rational');
    //  Shorthand allowed, and no metadata to include?
    if (
      shorthandAllowed &&
      options.shorthands.includes('function') &&
      isMachineRational(value)
    ) {
      if (value[0] === 1 && value[1] === 2 && !exclusions.includes('Half'))
        return serializeJsonSymbol(ce, 'Half', options, metadata);
      return [allowRational ? 'Rational' : 'Divide', value[0], value[1]];
    }
    return serializeJsonFunction(
      ce,
      allowRational ? 'Rational' : 'Divide',
      [ce.number(value[0]), ce.number(value[1])],
      options,
      { ...metadata }
    );
  }

  //
  // BigInt
  //
  if (typeof value === 'bigint') {
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
      value = Number(value);
    } else {
      if (options.metadata.includes('latex') && ce.latexSyntax)
        metadata.latex =
          metadata.latex ??
          _serializeLatexMetadata(ce, {
            num: value.toString(),
          } as MathJsonExpression);

      if (metadata.latex !== undefined)
        return { num: value.toString(), latex: metadata.latex };
      return shorthandAllowed
        ? numberToExpression(value)
        : { num: numberToString(value) };
    }
  }

  //
  // Machine number
  //
  let result: string | undefined;
  if (Number.isNaN(value)) result = 'NaN';
  else if (!Number.isFinite(value))
    result = value > 0 ? 'PositiveInfinity' : 'NegativeInfinity';
  else {
    const digits = effectiveDigits(options);
    if (typeof digits === 'object' && 'fractional' in digits) {
      // `toFixed` semantics, preserving trailing-zero padding (bypass the
      // repeating-decimal detection which would strip it).
      num = roundToDecimalPlace(value, digits.fractional);
    } else {
      let v = value;
      // `{ significant: n }` is a no-op on exact values. A bare non-integer
      // machine number is an inexact float (exact non-integers are stored as
      // rationals/radicals), so `Number.isInteger` is the exact/inexact split.
      if (
        typeof digits === 'object' &&
        'significant' in digits &&
        !Number.isInteger(value)
      )
        v = roundToSignificant(value, digits.significant);
      num = serializeRepeatingDecimals(v.toString(), options);
    }
  }

  if (options.metadata.includes('latex') && ce.latexSyntax)
    metadata.latex =
      metadata.latex ??
      _serializeLatexMetadata(ce, { num } as MathJsonExpression);

  if (result) {
    if (metadata.latex !== undefined)
      return { sym: result, latex: metadata.latex };
    return shorthandAllowed ? result : { sym: result };
  }

  if (metadata.latex !== undefined) return { num, latex: metadata.latex };
  if (shorthandAllowed && num === value.toString()) return value;
  return { num };
}

/**
 * Serialize an expression to MathJSON.
 *
 * When the *root* of the serialized tree is not canonical, the expression is
 * verbatim: its operand order and any explicit `Delimiter` are meaningful and
 * must survive serialization (`_preserveStructure`). The flag is captured at
 * the root and inherited by the nested calls: a canonical expression's
 * `.structural` operands are themselves structural-but-not-canonical, so a
 * per-node test would misclassify them.
 */
export function serializeJson(
  ce: ComputeEngine,
  expr: Expression,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  const isRoot = _serializeDepth === 0;
  if (isRoot) _preserveStructure = !expr.isCanonical;
  _serializeDepth += 1;
  try {
    // Serialization is a read: the prettifier re-canonicalizes structural
    // rebuilds (`_Product.asRationalExpression()` → `flatten`), which must
    // not declare or infer into the current scope — an expression parsed
    // against a caller-supplied scope would otherwise leak its undeclared
    // heads into whatever scope is ambient at serialization time. The
    // structural forms that `originalsOf()` builds are reads of the same
    // kind, so the map is built inside the region too.
    return ce._resolveOnly(() => {
      if (isRoot && hasRawOperand(expr)) {
        _originalOf = originalsOf(expr);
        _rawOperands = new Set();
      }
      return serializeJsonExpression(ce, expr, options);
    });
  } finally {
    _serializeDepth -= 1;
    if (isRoot) {
      _originalOf = undefined;
      _rawOperands = undefined;
    }
  }
}

let _preserveStructure = false;
let _serializeDepth = 0;

/**
 * For the serialization in progress, the original operand (canonical or raw)
 * of which each structural node below the root is the structural form, as
 * `operandsToSerialize()` records them; `undefined` when the tree has no raw
 * operand. It lives from the root call of `serializeJson()` to its exit.
 */
let _originalOf: Map<Expression, Expression> | undefined = undefined;

/**
 * The raw operands that `operandsToSerialize()` put in place of their
 * structural form, for the serialization in progress; `undefined` when the
 * tree has no raw operand. Only these nodes turn on `_verbatim`: a raw node
 * that a pretty rewrite builds (a `Multiply` of the denominators of a
 * quotient) holds canonical operands, which keep their rewrites.
 */
let _rawOperands: Set<Expression> | undefined = undefined;

/**
 * True while the subtree of a raw operand of a canonical node is serialized
 * (`_rawOperands`): every node of that subtree is written as authored, from
 * its own operands and through `serializeJsonFunction()`, with no pretty
 * rewrite, so that the MathJSON boxes back to the same raw operand. The flag
 * is set when such an operand is met, and restored on exit from it. A raw
 * ROOT (an expression boxed with `canonical: false`) does not set it: its
 * children are serialized with the rewrites that `_preserveStructure`
 * allows, as before.
 */
let _verbatim = false;

/**
 * A "raw" expression: neither canonical nor structural, i.e. verbatim as
 * authored. Its operand order and any explicit `Delimiter` are meaningful.
 *
 * Note that this is *not* the same as `!isCanonical`: `BoxedFunction.structural`
 * rebuilds the children of a canonical expression as
 * `isCanonical: false, isStructural: true` nodes, and those must still be
 * serialized with the full pretty rewrites.
 */
function isRawExpression(expr: Expression): boolean {
  return !expr.isCanonical && !expr.isStructural;
}

function serializeJsonExpression(
  ce: ComputeEngine,
  expr: Expression,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  const wikidata = expr.wikidata;

  // Is it a number literal?
  if (isNumber(expr))
    return serializeJsonNumber(ce, expr.numericValue, options, {
      latex: expr.verbatimLatex,
    });

  // Is it a dictionary *value*? The test is on the kind of the node, not on
  // its type: a symbol merely *typed* `dictionary` has no entries and must
  // serialize as a symbol below, and reading the type of every node that is
  // serialized derives the type of each node that the serializer builds (the
  // quotient of a product, for one), which was about 40 % of the time of
  // `.latex` for a sum of products. Re-entering the public `toMathJson()` here
  // would recurse forever and re-trip its option-validation warnings.
  if (isDictionary(expr)) {
    if (options.shorthands.includes('dictionary')) {
      const json = expr.json;
      // `.json` serializes every entry with the default options, so the
      // entries are serialized again with THESE options, in the same shape
      // `.json` chose: the `{dict: …}` shorthand holds plain data only (no
      // function literal, so nothing depends on the options) and is returned
      // as is; the `["Dictionary", ["KeyValuePair", …]]` form is rebuilt
      // entry by entry. This is what gives a caller the inferred annotations
      // it asked for (`inferredAnnotations`), and what unwraps the
      // single-statement `Block` body of a function literal value, as for a
      // value held by a `Tuple`: with the raw `.json`, `{"a" -> u ↦ u + 1}`
      // was written in LaTeX with the block marker, `u\mapsto u+1;`, which
      // does not parse back.
      if (!Array.isArray(json)) return json;
      return [
        'Dictionary',
        ...expr.entries.map(
          ([key, value]) =>
            [
              'KeyValuePair',
              { str: key },
              serializeJson(ce, value, options),
            ] as MathJsonExpression
        ),
      ];
    }
    // Build data properties rather than assigning to `{}`: `__proto__` is a
    // valid dictionary key, and assignment would call the inherited setter
    // instead of serializing the entry.
    return {
      dict: Object.fromEntries(
        expr.entries.map(([key, value]) => [
          key,
          serializeJson(ce, value, options),
        ])
      ),
    };
  }

  // Is it an object (the mutable value kind)?
  //
  // Its `.json` IS the conversion: the `["Object", <record>, "'TypeName'"]`
  // form over the shared structural walk, computed fresh (never memoized —
  // the value is mutable) and cycle-marked. One walk, one mechanism, so the
  // record here is byte-identical to what `DictionaryFrom(object)` returns. The
  // arm exists ahead of the `.json` fallback at the bottom because this is
  // where the serializer's `objects: 'record' | 'reject'` option will be
  // honored (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Serialization").
  if (isObject(expr)) return expr.json;

  // Is it a string?
  if (isString(expr)) return serializeJsonString(expr.string, options);

  // Is it a character? MathJSON has only string literals, so a character
  // serializes as the CALL form its constructor operator produces — the wire
  // format that canonicalizes back to the identical character. The payload
  // goes through the same escaping and shorthand handling a string literal
  // does, so the operand of the call is a well-formed MathJSON string
  // whichever `shorthands` the caller asked for.
  if (isCharacter(expr))
    return ['CharacterFrom', serializeJsonString(expr.string, options)];

  // Is it a symbol?
  if (isSymbol(expr)) {
    const result = serializeJsonSymbol(ce, expr.symbol, options, {
      latex: expr.verbatimLatex,
      wikidata,
    });
    // A symbol bound to the library definition of its name, in a scope where
    // the name reads another definition, is qualified (`["Module", "Pi"]`):
    // see `hidesLibraryBinding()`. A symbol that the options replace with
    // another expression (`Half` as a number) is not.
    if (
      (typeof result === 'string' ||
        (typeof result === 'object' && result !== null && 'sym' in result)) &&
      hidesLibraryBinding(ce, expr.symbol, expr.baseDefinition)
    )
      return moduleJson(result, options);
    return result;
  }

  // Is it a function?
  if (isFunction(expr)) {
    // A raw operand of a canonical node (`operandsToSerialize()`) starts a
    // subtree that is written as authored, with no pretty rewrite
    // (`_verbatim`): each raw node is serialized from its own operands, not
    // from its structural form, which can order or splice them. The flag is
    // restored on exit. A raw ROOT keeps the rewrites that
    // `_preserveStructure` allows, which `serializeJson()` set.
    const savedVerbatim = _verbatim;
    if (!_verbatim && _rawOperands?.has(expr) === true) _verbatim = true;
    // The fallback when the structural form of a raw operand is not memoized
    // (a tree that holds a mutable object, see `originalsOf()`): the raw
    // operand is then not found and is serialized from its structural form,
    // so the structure-preserving mode of a raw tree is turned on for the
    // subtree, as before this map existed. The test runs here, while the
    // operands are still raw: `.structural` rebuilds them as structural nodes.
    const savedPreserveStructure = _preserveStructure;
    if (
      !_preserveStructure &&
      (isRawExpression(expr) || expr.ops.some(isRawExpression))
    )
      _preserveStructure = true;
    try {
      let structuralOps: ReadonlyArray<Expression>;
      if (_verbatim && isRawExpression(expr)) structuralOps = expr.ops;
      else {
        const structuralExpr = expr.structural;
        structuralOps = isFunction(structuralExpr)
          ? operandsToSerialize(expr, structuralExpr.ops)
          : [];
      }
      // The operands of a scoped node (a `Function` literal, a `Block`) are
      // written with its local scope as the reading scope: a local of the
      // node that shadows a library name makes a library-bound operand write
      // the `Module` qualifier (`inSerializationScope()`).
      const scope = serializationScopeOf(expr);
      const result = inSerializationScope(scope, () =>
        expr.isValid &&
        (expr.isCanonical || expr.isStructural) &&
        options.prettify &&
        !_verbatim
          ? serializePrettyJsonFunction(
              ce,
              expr.operator,
              structuralOps,
              options,
              {
                latex: expr.verbatimLatex,
                wikidata,
                sourceOffsets: expr.sourceOffsets,
              }
            )
          : serializeJsonFunction(ce, expr.operator, structuralOps, options, {
              latex: expr.verbatimLatex,
              wikidata,
              sourceOffsets: expr.sourceOffsets,
            })
      );
      // A call bound to the library definition of its operator, in a scope
      // where the name reads another definition, is qualified
      // (`["Apply", ["Module", "Floor"], …]`): see `hidesLibraryBinding()`.
      if (
        hidesLibraryBinding(
          ce,
          expr.operator,
          expr.baseDefinition,
          isApplicableDef
        )
      )
        return qualifiedCall(ce, expr.operator, result, options);
      return result;
    } finally {
      _verbatim = savedVerbatim;
      _preserveStructure = savedPreserveStructure;
    }
  }

  return expr.json;
}

/**
 * True when a canonical node of the tree `expr` has a raw operand
 * (`isRawExpression()`). The walk enters canonical nodes, raw nodes, which
 * can hold a canonical node made from boxed operands, and the values of a
 * dictionary, which are serialized as trees of their own
 * (`serializeJsonExpression()`); it does not enter a structural node, whose
 * operands are structural. A raw root with raw operands is not a hit: its
 * children keep the rewrites that `_preserveStructure` allows.
 */
function hasRawOperand(expr: Expression): boolean {
  if (isDictionary(expr))
    return expr.entries.some(([, value]) => hasRawOperand(value));
  if (!isFunction(expr) || expr.isStructural) return false;
  if (expr.isCanonical && expr.ops.some(isRawExpression)) return true;
  return expr.ops.some(hasRawOperand);
}

/**
 * The original node (canonical or raw) of which each function node of the
 * structural form of the tree `root` is the structural form, by that
 * structural node (`_originalOf`).
 *
 * The structural form of a canonical node rebuilds each operand as a
 * structural node, so the raw mark (`isRawExpression()`) is not on the nodes
 * that the serializer walks; this map leads back to the nodes that carry it.
 * The structural form of `root` is built first: one build makes and memoizes
 * the structural form of every node below, each in the scope of its parent
 * (`BoxedFunction._structuralOps()`). The walk then reads each memoized form
 * again, a hit that gives the object the parent's form holds, also when an
 * associative operator spliced the operands of a nested call into its own.
 * The walk enters a raw node too: a raw node made from boxed operands
 * (`ce.function('List', [expr], { form: 'raw' })`) can hold a canonical node
 * with raw operands of its own. When the memo did not keep a form (a tree
 * that holds a mutable object), the read rebuilds it as another object, and
 * the serializer does not find that node here: the raw operand is then
 * serialized from its structural form, in the structure-preserving mode of a
 * raw tree (`_preserveStructure`, which `serializeJsonExpression()` turns on
 * for a node with a raw operand), as before this map existed.
 */
function originalsOf(root: Expression): Map<Expression, Expression> {
  const map = new Map<Expression, Expression>();
  const visit = (x: Expression): void => {
    // The values of a dictionary are serialized as trees of their own.
    if (isDictionary(x)) {
      for (const [, value] of x.entries) visit(value);
      return;
    }
    if (!isFunction(x)) return;
    const s = x.structural;
    if (s !== x) map.set(s, x);
    for (const op of x.ops) visit(op);
  };
  visit(root);
  return map;
}

/**
 * The operands to serialize for the node `expr`, whose structural form has
 * the operands `structuralOps`: a raw operand of a canonical node is given as
 * is, every other operand in its structural form.
 *
 * A raw operand is kept as written by the canonical form of its operator,
 * and is read back as written: the pattern and the guard of a `MatchCase`,
 * the two sides of a `Rule`, the parameters of a `Function` literal, the
 * target of an `Assign`, the operand of `Hold`. The pretty rewrites would
 * change what it says. `Tuple(_a, _b)` written as `Pair(_a, _b)` and
 * `Add(_x, -1)` written as `Subtract(_x, 1)` are other patterns, which do
 * not match a `Tuple` or an `Add` value, and the canonical form of `Function`
 * refuses a `Pair` parameter. So the raw operand itself replaces its
 * structural form; when the nested call meets it, it is raw below the root
 * and turns on `_verbatim` for its subtree.
 *
 * `expr` is the root, a structural form that `_originalOf` leads back to its
 * original node, or a node that a pretty rewrite built (a `Sqrt` for a
 * `Power`), which has no original and no raw operand of its own.
 * `_originalOf` is `undefined` when the tree has no raw operand
 * (`hasRawOperand()`): the common case pays that one walk of the tree.
 */
function operandsToSerialize(
  expr: Expression & FunctionInterface,
  structuralOps: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const map = _originalOf;
  if (map === undefined) return structuralOps;
  const original = map.get(expr) ?? expr;
  if (
    !original.isCanonical ||
    !isFunction(original) ||
    !original.ops.some(isRawExpression)
  )
    return structuralOps;
  return structuralOps.map((s) => {
    const x = map.get(s);
    if (x === undefined || !isRawExpression(x)) return s;
    _rawOperands?.add(x);
    return x;
  });
}

/**
 * The serialized call `json`, with its head `name` replaced by the qualified
 * callee: `["Floor", "x"]` becomes `["Apply", ["Module", "Floor"], "x"]`,
 * also in the `{ fn: … }` form that carries metadata. A form whose head is
 * not `name` is returned unchanged: the options wrote the call as another
 * expression (a `Negate` of a number is the number, an excluded `Sqrt` is a
 * `Power`).
 */
function qualifiedCall(
  ce: ComputeEngine,
  name: string,
  json: MathJsonExpression,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  const qualify = (fn: MathJsonExpression): MathJsonExpression | undefined =>
    Array.isArray(fn) && fn[0] === name
      ? ([
          'Apply',
          moduleJson(
            serializeJsonSymbol(ce, name, { ...options, metadata: [] }),
            options
          ),
          ...fn.slice(1),
        ] as MathJsonExpression)
      : undefined;
  if (Array.isArray(json)) return qualify(json) ?? json;
  if (typeof json === 'object' && json !== null && 'fn' in json) {
    const fn = qualify(json.fn as MathJsonExpression);
    if (fn !== undefined) return { ...json, fn } as MathJsonExpression;
  }
  return json;
}

/**
 * The qualified name `["Module", name]`, where `name` is the serialized
 * symbol. It is written in the array shorthand only when `options.shorthands`
 * allows it for a function, as `serializeJsonFunction()` does.
 */
function moduleJson(
  name: MathJsonExpression,
  options: Readonly<JsonSerializationOptions>
): MathJsonExpression {
  const fn: [string, ...MathJsonExpression[]] = ['Module', name];
  return options.shorthands.includes('function') ? fn : { fn };
}

/**
 * The local scope that the operands of `expr` are serialized in
 * (`inSerializationScope()`): the scope of a scoped node (a `Function`
 * literal, a `Block`). The structural form of a scoped node has no scope of
 * its own: the scope is the one of the node it was made from
 * (`structuralScope()`). `undefined` for a node that is not scoped.
 */
function serializationScopeOf(expr: Expression & FunctionInterface) {
  return (
    expr.localScope ??
    (expr.isStructural && expr.operatorDefinition?.scoped === true
      ? structuralScope(expr)
      : undefined)
  );
}
