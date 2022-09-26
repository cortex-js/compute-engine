import { BoxedExpression, SemiBoxedExpression } from '../public';
import { factorPower, reducedRational } from '../numerics/numeric';
import { isInMachineRange } from '../numerics/numeric-decimal';

/**
 * If expression is a product or a division, collect all the terms with a
 * negative exponents in the denominator, and all the terms
 * with a positive exponent (or no exponent) in the numerator, and put the
 * numerator and denominators of all the terms that are a division (or a rational)
 * into separate numerator/denominator
 */
export function numeratorDenominator(
  expr: BoxedExpression
): [SemiBoxedExpression[], SemiBoxedExpression[]] {
  if (expr.head === 'Divide') {
    const [n1, d1] = numeratorDenominator(expr.op1);
    const [n2, d2] = numeratorDenominator(expr.op2);
    return [
      [...n1, ...d2],
      [...d1, ...n2],
    ];
  }

  if (expr.head === 'Rational') {
    const [n, d] = expr.rationalValue;
    return [[n!], [d!]];
  }

  if (expr.head !== 'Multiply') return [[], []];

  const numerator: SemiBoxedExpression[] = [];
  const denominator: SemiBoxedExpression[] = [];

  for (const arg of expr.ops!) {
    if (arg.head === 'Rational') {
      const [n, d] = arg.rationalValue;
      numerator.push(n!);
      denominator.push(d!);
    } else if (arg.head === 'Divide)') {
      const [n, d] = numeratorDenominator(arg);
      numerator.push(...n);
      denominator.push(...d);
    } else if (arg.head !== 'Power') {
      numerator.push(arg);
    } else {
      if (arg.op2.head === 'Negate') {
        const a = arg.op1;
        const b = arg.op2.op1;
        denominator.push(!a || !b ? arg : ['Power', a, b]);
      } else if (arg.op1.symbol === 'Nothing') {
        const exponentVal = arg.op2;
        if (exponentVal.isNegativeOne) {
          denominator.push(arg.op1);
        } else if (exponentVal.isNegative) {
          denominator.push(['Power', arg.op1, ['Negate', exponentVal]]);
        } else {
          numerator.push(arg);
        }
      }
    }
  }
  return [numerator, denominator];
}

/**
 * Attempt to factor a rational coefficient `c` and a `rest` out of a
 * canonical expression `expr` such that `ce.mul(c, rest)` is equal to `expr`.
 *
 * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
 *
 *
 * ['Multiply', 2, 'x', 3, 'a', ['Sqrt', 5]]
 *    -> [[6, 1], ['Multiply', 'x', 'a', ['Sqrt', 5]]]
 *
 * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
 *    -> [[2, 3], ['Divide', 'x', ['Multiply, 'y', 'a']]]
 */
export function asCoefficient(
  expr: BoxedExpression
): [coef: [numer: number, denom: number], rest: BoxedExpression] {
  console.assert(expr.isCanonical);

  const ce = expr.engine;

  let numer = 1;
  let denom = 1;

  //
  // Multiply
  //
  if (expr.head === 'Multiply') {
    const rest: BoxedExpression[] = [];
    for (const arg of expr.ops!) {
      // Only consider the value of literals
      if (!arg.isLiteral) rest.push(arg);
      else {
        const [n, d] = arg.asRational;
        if (n !== null && d !== null) {
          numer = numer * n;
          denom = denom * d;
        } else rest.push(arg);
      }
    }

    [numer, denom] = reducedRational([numer, denom]);

    if (numer === denom) return [[1, 1], expr];
    if (rest.length === 0) return [[numer, denom], ce._ONE];
    if (rest.length === 1) return [[numer, denom], rest[0]];
    return [[numer, denom], ce.mul(rest)];
  }

  //
  // Divide
  //
  if (expr.head === 'Divide') {
    // eslint-disable-next-line prefer-const
    let [[n1, d1], numer] = asCoefficient(expr.op1);
    const [[n2, d2], denom] = asCoefficient(expr.op2);
    const [n, d] = reducedRational([n1 * d2, n2 * d1]);
    if (numer.isOne && denom.isOne) return [[n, d], ce._ONE];
    if (denom.isOne) return [[n, d], numer];
    return [[n, d], ce.fn('Divide', [numer, denom]).canonical];
  }

  //
  // Power
  //
  if (expr.head === 'Power') {
    // We can only extract a coef if the exponent is a literal
    if (!expr.op2.isLiteral) return [[1, 1], expr];

    // eslint-disable-next-line prefer-const
    let [[numer, denom], base] = asCoefficient(expr.op1);
    if (numer === 1 && denom === 1) return [[1, 1], expr];

    const exponent = expr.op2;

    const e = exponent.asSmallInteger;
    if (e !== null) {
      if (e === -1) return [[denom, numer], ce.inverse(base)];
      if (
        Math.log10(Math.abs(numer)) * Math.abs(e) < 15 &&
        Math.log10(Math.abs(denom)) * Math.abs(e) < 15
      ) {
        // The exponent is an integer literal, apply it directly to numerator/denominator
        if (e > 0)
          return [
            [Math.pow(numer, e), Math.pow(denom, e)],
            ce.power(base, exponent),
          ];
        return [
          [Math.pow(denom, -e), Math.pow(numer, -e)],
          ce.power(base, exponent),
        ];
      }
    }
    // The exponent might be a rational (square root, cubic root...)
    const [en, ed] = exponent.rationalValue;
    if (en !== null && ed !== null) {
      if (numer > 0 && Math.abs(en) === 1) {
        const [nCoef, nRest] = factorPower(numer, ed);
        const [dCoef, dRest] = factorPower(denom, ed);
        if (nCoef === 1 && dCoef === 1) return [[1, 1], expr];
        // en = -1 -> inverse the extracted coef
        return [
          en === 1 ? [nCoef, dCoef] : [dCoef, nCoef],
          ce.power(ce.mul([ce.number([nRest, dRest]), base]), exponent),
        ];
      }
    }

    return [[1, 1], expr];
  }

  //
  // Negate
  //
  if (expr.head === 'Negate') {
    const [coef, rest] = asCoefficient(expr.op1);
    return [[-coef[0], coef[1]], rest];
  }

  // @todo:  could consider others.. `Ln`, `Abs`, trig functions

  //
  // Literal
  //
  if (expr.isLiteral) {
    if (expr.decimalValue) {
      if (expr.decimalValue.isInteger() && isInMachineRange(expr.decimalValue))
        return [[expr.decimalValue.toNumber(), 1], ce._ONE];
      if (expr.decimalValue?.isNegative())
        return [[-1, 1], ce.number(expr.decimalValue.neg())];
    }

    if (expr.machineValue !== null) {
      if (Number.isInteger(expr.machineValue))
        return [[expr.machineValue, 1], ce._ONE];

      if (expr.machineValue < 0)
        return [[-1, 1], ce.number(-expr.machineValue)];
    }

    const [a, b] = expr.rationalValue;
    if (a !== null && b !== null) return [[a, b], ce._ONE];

    if (expr.complexValue !== null) {
      const c = expr.complexValue!;
      // Make the part positive if the real part is negative
      if (c.re < 0) return [[-1, 1], ce.number(ce.complex(-c.re, -c.im))];
    }
  }

  return [[1, 1], expr];
}

/**
 * Return a rational coef and constant such that `coef * mod + constant = expr`
 */
export function multiple(
  expr: BoxedExpression,
  mod: BoxedExpression
): [coef: [number, number], constant: BoxedExpression] {
  if (expr.head === 'Negate') {
    const [coef, constant] = multiple(expr.op1, mod);
    return [[-coef[0], coef[1]], constant];
  }

  if (expr.head === 'Multiply') {
    // @todo
  }

  if (expr.head === 'Divide') {
    // @todo
  }

  if (expr.head === 'Add') {
    // @todo
  }

  return [[0, 1], expr];
}

/**
 * Return a coef, term and constant such that:
 *
 * `coef * term + constant = expr`
 *
 * Return null if no `coef`/`constant` can be found.
 */
export function linear(expr: BoxedExpression): null | {
  coef: [number, number];
  term: BoxedExpression;
  constant: [number, number];
} {
  // @todo
  return { coef: [1, 1], term: expr, constant: [0, 1] };
}

/**
 * Apply the operator `op` to the left-hand-side and right-hand-side
 * expression. Applies the associativity rule specified by the definition,
 * i.e. 'op(a, op(b, c))` -> `op(a, b, c)`, etc...
 *
 */
export function applyAssociativeOperator(
  op: string,
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  associativity: 'right' | 'left' | 'non' | 'both' = 'both'
): BoxedExpression {
  const ce = lhs.engine;

  if (associativity === 'non') return ce.fn(op, [lhs, rhs]);

  const lhsName = lhs.head;
  const rhsName = rhs.head;

  if (associativity === 'left') {
    if (lhsName === op) return ce.fn(op, [...(lhs.ops ?? []), rhs]);
    return ce.fn(op, [lhs, rhs]);
  }

  if (associativity === 'right') {
    if (rhsName === op) return ce.fn(op, [lhs, ...(rhs.ops ?? [])]);
    return ce.fn(op, [lhs, rhs]);
  }

  // Associativity: 'both'
  if (lhsName === op && rhsName === op) {
    return ce.fn(op, [...(lhs.ops ?? []), ...(rhs.ops ?? [])]);
  }
  if (lhsName === op) return ce.fn(op, [...(lhs.ops ?? []), rhs]);
  if (rhsName === op) return ce.fn(op, [lhs, ...(rhs.ops ?? [])]);
  return ce.fn(op, [lhs, rhs]);
}

// @todo: replace usage with factorRationalCoef():
// it does the same thing, but also extracts any literal coefficient
export function makePositive(
  expr: BoxedExpression
): [sign: number, expr: BoxedExpression] {
  if (expr.head === 'Negate') return [-1, expr.op1];

  if (!expr.isLiteral) return [1, expr];

  const ce = expr.engine;

  if (expr.machineValue !== null && expr.machineValue < 0)
    return [-1, ce.number(-expr.machineValue)];

  if (expr.decimalValue?.isNegative())
    return [-1, ce.number(expr.decimalValue.neg())];

  if (expr.complexValue !== null) {
    const c = expr.complexValue!;
    // Make the part positive if the real part is negative
    if (c.re < 0) return [-1, ce.number(ce.complex(-c.re, -c.im))];
  }

  const [n, d] = expr.rationalValue;
  if (n !== null && d !== null && n < 0) return [-1, ce.number([-n, d])];

  return [1, expr];
}
