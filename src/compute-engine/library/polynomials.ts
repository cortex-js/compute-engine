import { factor, together } from '../boxed-expression/factor';
import { distribute } from '../symbolic/distribute';
import { expand, expandAll } from '../boxed-expression/expand';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  polynomialDivide,
  polynomialGCD,
  cancelCommonFactors,
} from '../boxed-expression/polynomials';
import type { SymbolDefinitions } from '../global-types';

export const POLYNOMIALS_LIBRARY: SymbolDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expand(x.canonical) ?? x.canonical,
    },

    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expandAll(x.canonical) ?? x.canonical,
    },

    Factor: {
      // @todo: extend to factor over the integers: return a ['Multiply', ['Power', a, b], ...]
      description:
        'Factors an algebraic expression into a product of irreducible factors',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => factor(x.canonical) ?? x.canonical,
    },

    Together: {
      description: 'Combine rational expressions into a single fraction',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => together(x.canonical),
    },

    Distribute: {
      description: 'Distribute multiplication over addition',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => (!x ? x : distribute(x.canonical)),
    },

    PolynomialDegree: {
      description:
        'Return the degree of a polynomial with respect to a variable',
      lazy: true,
      signature: '(value, symbol) -> integer',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        const deg = polynomialDegree(poly.canonical, variable);
        return deg >= 0 ? poly.engine.number(deg) : undefined;
      },
    },

    CoefficientList: {
      description:
        'Return the list of coefficients of a polynomial, from lowest to highest degree',
      lazy: true,
      signature: '(value, symbol) -> list<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        const coeffs = getPolynomialCoefficients(poly.canonical, variable);
        if (!coeffs) return undefined;
        return poly.engine.box(['List', ...coeffs]);
      },
    },

    PolynomialQuotient: {
      description:
        'Return the quotient of polynomial division of dividend by divisor',
      lazy: true,
      signature: '(dividend: value, divisor: value, variable: symbol) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        const result = polynomialDivide(
          dividend.canonical,
          divisor.canonical,
          variable
        );
        return result?.[0];
      },
    },

    PolynomialRemainder: {
      description:
        'Return the remainder of polynomial division of dividend by divisor',
      lazy: true,
      signature: '(dividend: value, divisor: value, variable: symbol) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        const result = polynomialDivide(
          dividend.canonical,
          divisor.canonical,
          variable
        );
        return result?.[1];
      },
    },

    PolynomialGCD: {
      description: 'Return the greatest common divisor of two polynomials',
      lazy: true,
      signature: '(a: value, b: value, variable: symbol) -> value',
      evaluate: ([a, b, varExpr]) => {
        if (!a || !b || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        return polynomialGCD(a.canonical, b.canonical, variable);
      },
    },

    Cancel: {
      description:
        'Cancel common polynomial factors in the numerator and denominator of a rational expression',
      lazy: true,
      signature: '(value, symbol) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr || !varExpr) return undefined;
        const variable = varExpr.canonical.symbol;
        if (!variable) return undefined;
        return cancelCommonFactors(expr.canonical, variable);
      },
    },
  },
];

//@todo
// Polynomial([0, 2, 0, 4]:list, x:symbol) -> 2x + 4x^3
//  -> Dot([0, 2, 0, 4], x^Range(0, 3)) -> 2x + 4x^3
// CoefficientList(2x + 4x^3, 'x') -> [0, 2, 0, 4]
// Degree(x) = Length(Coefficients(x)) - 1
//   Factors
//   Roots
