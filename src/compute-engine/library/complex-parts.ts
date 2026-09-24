import type { Expression } from '../global-types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { exactOrder } from '../boxed-expression/compare.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';

/**
 * The real and the imaginary part of a constant expression, as `[re, im]`,
 * or `undefined` when they cannot be found exactly. The parts are not
 * evaluated. This is the one splitter that `Abs`, `Real`, `Imaginary`,
 * `Argument` and `Conjugate` use for an operand that is not a number
 * literal.
 *
 * An exact complex value such as `1 + √2·i` is an `Add` of number literals,
 * not one literal, so the literal branches of these operators do not apply
 * to it. The parts go into the operands of `Add`, `Subtract` and `Negate`,
 * and into the factors of `Multiply`, where
 * `(a + bi)(c + di) = (ac − bd) + (ad + bc)i`. A quotient uses
 * `(a + bi)/(c + di) = ((ac + bd) + (bc − ad)i)/(c² + d²)`, and is not split
 * when `c² + d²` is zero or is not known to be non-zero. A power with an
 * integer exponent `n`, `1 ≤ |n| ≤ 16`, is a repeated product (the reciprocal
 * of one when `n` is negative). The parts are evaluated after each product,
 * so that the expression does not double in size at each step. Any other
 * power is not split.
 *
 * At a leaf, a finite number literal has its exact parts (`i` is a number
 * literal), and a real constant (`π`, `sin(1)`) is its own real part. Any
 * other leaf makes the result `undefined`.
 *
 * An operand with a free variable (`Real(z + 1)`) is not split, so that the
 * application stays unevaluated.
 *
 * The realness of a leaf is read from its type. A `Sqrt` of a constant
 * radicand of unknown sign has the type `complex` (`√(1 − π)`,
 * `√(e − π)`), so it is not taken for a real leaf. A type can still be
 * wrong when it comes from a declaration: with `f: (number) -> real` and
 * `f := x ↦ √x`, the unevaluated `f(−π)` has the type `real` and the
 * value `√π·i`. The operators evaluate their operand first, which replaces
 * `f(−π)` by `√(−π)`, but `Abs` still confirms the modulus it finds from
 * the parts against the numeric value, as a cheap check.
 */
export function complexParts(
  z: Expression
): [Expression, Expression] | undefined {
  if (z.unknowns.length > 0) return undefined;
  const ce = z.engine;

  const parts = (x: Expression): [Expression, Expression] | undefined => {
    if (isNumber(x)) {
      if (x.isFinite !== true) return undefined;
      const v = x.numericValue;
      if (typeof v === 'number' || v.im === 0) return [x, ce.Zero];
      // An exact complex value carries its parts as exact components (a
      // rational multiple of a square root): read them rather than the
      // machine values, so that the parts of `1/3 + (2/5)i` are `1/3` and
      // `2/5`.
      if (v instanceof ExactNumericValue)
        return [
          ce.number(
            ce._numericValue({ rational: v.rational, radical: v.radical })
          ),
          ce.number(
            ce._numericValue({ rational: v.imRational, radical: v.imRadical })
          ),
        ];
      return [ce.number(v.bignumRe ?? v.re), ce.number(v.im)];
    }
    if (x.type.matches('real')) return [x, ce.Zero];
    if (!isFunction(x)) return undefined;
    const op = x.operator;
    if (op === 'Negate') {
      const p = parts(x.op1);
      if (p === undefined) return undefined;
      return [ce.function('Negate', [p[0]]), ce.function('Negate', [p[1]])];
    }
    if (op === 'Add' || op === 'Subtract') {
      const re: Expression[] = [];
      const im: Expression[] = [];
      for (const operand of x.ops) {
        const p = parts(operand);
        if (p === undefined) return undefined;
        re.push(p[0]);
        im.push(p[1]);
      }
      return [ce.function(op, re), ce.function(op, im)];
    }
    if (op === 'Multiply') {
      let acc: [Expression, Expression] | undefined = undefined;
      for (const operand of x.ops) {
        const p = parts(operand);
        if (p === undefined) return undefined;
        acc = acc === undefined ? p : mulParts(acc, p);
      }
      return acc;
    }
    if (op === 'Divide' && x.nops === 2) {
      const p = parts(x.op1);
      if (p === undefined) return undefined;
      const q = parts(x.op2);
      if (q === undefined) return undefined;
      return divParts(p, q);
    }
    if (op === 'Power' && isNumber(x.op2) && x.op2.isInteger === true) {
      const n = x.op2.re;
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 16) return undefined;
      const p = parts(x.op1);
      if (p === undefined) return undefined;
      // Square-and-multiply: at most eight products for `|n| ≤ 16`.
      let result: [Expression, Expression] | undefined = undefined;
      let square = p;
      let k = Math.abs(n);
      while (true) {
        if (k % 2 === 1)
          result =
            result === undefined
              ? square
              : evaluateParts(mulParts(result, square));
        k = Math.floor(k / 2);
        if (k === 0) break;
        square = evaluateParts(mulParts(square, square));
      }
      if (n > 0) return result;
      return divParts([ce.One, ce.Zero], result!);
    }
    return undefined;
  };

  const mul = (u: Expression, v: Expression) => ce.function('Multiply', [u, v]);

  // `(a + bi)(c + di) = (ac − bd) + (ad + bc)i`
  const mulParts = (
    [a, b]: [Expression, Expression],
    [c, d]: [Expression, Expression]
  ): [Expression, Expression] => [
    ce.function('Subtract', [mul(a, c), mul(b, d)]),
    ce.function('Add', [mul(a, d), mul(b, c)]),
  ];

  // `(a + bi)/(c + di) = ((ac + bd) + (bc − ad)i)/(c² + d²)`. The result is
  // `undefined` when `c² + d²` is zero or is not known to be non-zero.
  const divParts = (
    [a, b]: [Expression, Expression],
    [c, d]: [Expression, Expression]
  ): [Expression, Expression] | undefined => {
    // `c` and `d` are real, so `c² + d²` is non-zero exactly when it is
    // positive. `isPositive` does not know the sign of a constant sum such as
    // `1 + (√2 − π)²`, so an exact comparison with zero is the fallback.
    const den = ce.function('Add', [mul(c, c), mul(d, d)]).evaluate();
    if (den.isPositive !== true && exactOrder(den, ce.Zero) !== 1)
      return undefined;
    return [
      ce.function('Divide', [ce.function('Add', [mul(a, c), mul(b, d)]), den]),
      ce.function('Divide', [
        ce.function('Subtract', [mul(b, c), mul(a, d)]),
        den,
      ]),
    ];
  };

  const evaluateParts = ([re, im]: [Expression, Expression]): [
    Expression,
    Expression,
  ] => [re.evaluate(), im.evaluate()];

  return parts(z);
}
