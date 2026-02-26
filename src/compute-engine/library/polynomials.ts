import {
  factorPolynomial,
  together,
  partialFraction,
} from '../boxed-expression/factor';
import { distribute } from '../symbolic/distribute';
import { expand, expandAll } from '../boxed-expression/expand';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  polynomialDivide,
  polynomialGCD,
  cancelCommonFactors,
  fromCoefficients,
} from '../boxed-expression/polynomials';
import type { SymbolDefinitions } from '../global-types';
import { isFunction, sym } from '../boxed-expression/type-guards';

export const POLYNOMIALS_LIBRARY: SymbolDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expand(x.canonical),
    },

    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expandAll(x.canonical),
    },

    Factor: {
      description:
        'Factor a polynomial expression into a product of irreducible factors. ' +
        'Supports perfect square trinomials, difference of squares, and quadratic factoring with rational roots. ' +
        'Example: Factor(x² + 5x + 6) → (x+2)(x+3), Factor(x² + 2x + 1) → (x+1)²',
      lazy: true,
      signature: '(value, symbol?) -> value',
      evaluate: ([x, varExpr]) => {
        if (!x) return x;

        // If variable is provided, use polynomial factoring with that variable
        if (varExpr) {
          const variable = sym(varExpr.canonical);
          if (!variable) return x.canonical;
          return factorPolynomial(x.canonical, variable);
        }

        // Otherwise, try polynomial factoring without specific variable
        return factorPolynomial(x.canonical);
      },
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
        'Return the degree of a polynomial with respect to a variable. ' +
        'Example: PolynomialDegree(x³ + 2x + 1, x) → 3',
      lazy: true,
      signature: '(value, symbol) -> integer',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        const deg = polynomialDegree(poly.canonical, variable);
        return deg >= 0 ? poly.engine.number(deg) : undefined;
      },
    },

    CoefficientList: {
      description:
        'Return the list of coefficients of a polynomial, from highest to lowest degree. ' +
        'Example: CoefficientList(x³ + 2x + 1, x) → [1, 0, 2, 1]',
      lazy: true,
      signature: '(value, symbol) -> list<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        const coeffs = getPolynomialCoefficients(poly.canonical, variable);
        if (!coeffs) return undefined;
        return poly.engine.box(['List', ...coeffs.reverse()]);
      },
    },

    PolynomialQuotient: {
      description:
        'Return the quotient of polynomial division of dividend by divisor. ' +
        'Example: PolynomialQuotient(x³ - 1, x - 1, x) → x² + x + 1',
      lazy: true,
      signature: '(dividend: value, divisor: value, variable: symbol) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
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
        'Return the remainder of polynomial division of dividend by divisor. ' +
        'Example: PolynomialRemainder(x³ + 2x + 1, x + 1, x) → -2',
      lazy: true,
      signature: '(dividend: value, divisor: value, variable: symbol) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
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
      description:
        'Return the greatest common divisor of two polynomials. ' +
        'Example: PolynomialGCD(x² - 1, x - 1, x) → x - 1',
      lazy: true,
      signature: '(a: value, b: value, variable: symbol) -> value',
      evaluate: ([a, b, varExpr]) => {
        if (!a || !b || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        return polynomialGCD(a.canonical, b.canonical, variable);
      },
    },

    Cancel: {
      description:
        'Cancel common polynomial factors in the numerator and denominator of a rational expression. ' +
        'Example: Cancel((x² - 1)/(x - 1), x) → x + 1',
      lazy: true,
      signature: '(value, symbol) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        return cancelCommonFactors(expr.canonical, variable);
      },
    },

    PartialFraction: {
      description:
        'Decompose a rational expression into partial fractions. ' +
        'Example: PartialFraction(1/((x+1)(x+2)), x) → 1/(x+1) - 1/(x+2)',
      lazy: true,
      signature: '(value, symbol) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        return partialFraction(expr.canonical, variable);
      },
    },

    Apart: {
      description:
        'Alias for PartialFraction. Decompose a rational expression into partial fractions.',
      lazy: true,
      signature: '(value, symbol) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        return partialFraction(expr.canonical, variable);
      },
    },

    PolynomialRoots: {
      description:
        'Return the roots of a polynomial expression. ' +
        'Example: PolynomialRoots(x² - 5x + 6, x) → {2, 3}',
      lazy: true,
      signature: '(value, symbol) -> set<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        const roots = poly.canonical.polynomialRoots(variable);
        if (!roots || roots.length === 0) return undefined;
        return poly.engine.box(['Set', ...roots.map((r) => r.json)]);
      },
    },

    Discriminant: {
      description:
        'Return the discriminant of a polynomial. ' +
        'Example: Discriminant(x² - 5x + 6, x) → 1',
      lazy: true,
      signature: '(value, symbol) -> value',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;

        const coeffsAsc = getPolynomialCoefficients(poly.canonical, variable);
        if (!coeffsAsc) return undefined;

        const coeffs = [...coeffsAsc].reverse();
        const degree = coeffs.length - 1;
        const ce = poly.engine;

        if (degree === 2) {
          const [a, b, c] = coeffs;
          // b² - 4ac
          return b.mul(b).sub(ce.number(4).mul(a).mul(c));
        }

        if (degree === 3) {
          const [a, b, c, d] = coeffs;
          // b²c² - 4ac³ - 4b³d + 18abcd - 27a²d²
          return b
            .mul(b)
            .mul(c)
            .mul(c)
            .sub(ce.number(4).mul(a).mul(c).mul(c).mul(c))
            .sub(ce.number(4).mul(b).mul(b).mul(b).mul(d))
            .add(ce.number(18).mul(a).mul(b).mul(c).mul(d))
            .sub(ce.number(27).mul(a).mul(a).mul(d).mul(d));
        }

        if (degree === 4) {
          const [a, b, c, d, e] = coeffs;
          return ce
            .number(256)
            .mul(a)
            .mul(a)
            .mul(a)
            .mul(e)
            .mul(e)
            .mul(e)
            .sub(
              ce.number(192).mul(a).mul(a).mul(b).mul(d).mul(e).mul(e)
            )
            .sub(
              ce.number(128).mul(a).mul(a).mul(c).mul(c).mul(e).mul(e)
            )
            .add(
              ce.number(144).mul(a).mul(a).mul(c).mul(d).mul(d).mul(e)
            )
            .sub(
              ce.number(27).mul(a).mul(a).mul(d).mul(d).mul(d).mul(d)
            )
            .add(
              ce.number(144).mul(a).mul(b).mul(b).mul(c).mul(e).mul(e)
            )
            .sub(
              ce.number(6).mul(a).mul(b).mul(b).mul(d).mul(d).mul(e)
            )
            .sub(
              ce.number(80).mul(a).mul(b).mul(c).mul(c).mul(d).mul(e)
            )
            .add(
              ce.number(18).mul(a).mul(b).mul(c).mul(d).mul(d).mul(d)
            )
            .add(
              ce.number(16).mul(a).mul(c).mul(c).mul(c).mul(c).mul(e)
            )
            .sub(
              ce.number(4).mul(a).mul(c).mul(c).mul(c).mul(d).mul(d)
            )
            .sub(
              ce.number(27).mul(b).mul(b).mul(b).mul(b).mul(e).mul(e)
            )
            .add(
              ce.number(18).mul(b).mul(b).mul(b).mul(c).mul(d).mul(e)
            )
            .sub(
              ce.number(4).mul(b).mul(b).mul(b).mul(d).mul(d).mul(d)
            )
            .sub(
              ce.number(4).mul(b).mul(b).mul(c).mul(c).mul(c).mul(e)
            )
            .add(b.mul(b).mul(c).mul(c).mul(d).mul(d));
        }

        return undefined;
      },
    },

    Polynomial: {
      description:
        'Construct a polynomial from a list of coefficients (highest to lowest degree) and a variable. ' +
        'Example: Polynomial([1, 0, 2, 1], x) → x³ + 2x + 1',
      lazy: true,
      signature: '(list<value>, symbol) -> value',
      evaluate: ([coeffList, varExpr]) => {
        if (!coeffList || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;

        const canonical = coeffList.canonical;
        if (!isFunction(canonical, 'List')) return undefined;

        const coeffs = canonical.ops;
        if (coeffs.length === 0) return undefined;

        // Input is descending order, fromCoefficients expects ascending
        const ascending = [...coeffs].reverse();
        return fromCoefficients(ascending, variable);
      },
    },
  },
];
