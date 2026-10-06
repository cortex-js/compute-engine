import {
  factorPolynomial,
  togetherReduced,
  partialFraction,
} from '../boxed-expression/factor.js';
import { distribute } from '../symbolic/distribute.js';
import { expand, expandAll } from '../boxed-expression/expand.js';
import {
  polynomialDegree,
  getPolynomialCoefficients,
  polynomialDivide,
  polynomialGCD,
  polynomialResultant,
  cancelCommonFactors,
  fromCoefficients,
} from '../boxed-expression/polynomials.js';
import type { Expression, SymbolDefinitions } from '../global-types.js';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';
import {
  defaultUnknown,
  reduceTransformerOperand,
} from '../boxed-expression/utils.js';

/**
 * The operands of a polynomial operator, resolved for its algorithm, and the
 * variable the operator works in.
 *
 * The polynomial operators are lazy, so each operand arrives unevaluated. An
 * operand is resolved the way `Expand` resolves its operand
 * (`reduceTransformerOperand`): a symbol bound to a polynomial
 * (`let p = x^2 - 1`) stands for its value. The variable is never
 * substituted, even when it has a value: with `x := 5`,
 * `PolynomialDegree(x^2 + 1, x)` is a question about `x`, so the resolution
 * protects that name. When no variable is given, it is read from the
 * resolved operands; when resolving folds every symbol away (the only
 * unknown had a value), it is read from the stored value of a bound operand
 * instead (`p := x^2 - 1` names `x`), and the operands are resolved with that
 * name protected.
 *
 * `undefined` when a variable is given but is not a symbol, or when no
 * variable can be found.
 */
function polynomialOperands(
  varExpr: Expression | undefined,
  ...ops: Expression[]
): { targets: Expression[]; variable: string } | undefined {
  const canonical = ops.map((op) => op.canonical);
  let variable: string | undefined;
  if (varExpr) {
    variable = sym(varExpr.canonical);
    if (!variable) return undefined;
  } else {
    variable =
      defaultUnknown(...canonical.map((op) => reduceTransformerOperand(op))) ??
      storedValueVariable(canonical);
    if (!variable) return undefined;
  }
  const protect = new Set([variable]);
  return {
    targets: canonical.map((op) => reduceTransformerOperand(op, protect)),
    variable,
  };
}

/**
 * The variable named by the stored values of bound operands, for a polynomial
 * operator called without a variable when every unknown of the resolved
 * operands has a value: with `p := x^2 - 1` and `x := 3`, `PolynomialDegree(p)`
 * is about `x`. The names are the non-constant symbols of each operand's
 * stored value (`p.value` is `x^2 - 1`, read without evaluation); one name is
 * the variable, and `x` wins among several, as in `defaultUnknown`.
 */
function storedValueVariable(ops: Expression[]): string | undefined {
  const names = new Set<string>();
  for (const op of ops) {
    const value = isSymbol(op) ? op.value : undefined;
    const source = value !== undefined && !isSymbol(value) ? value : op;
    for (const name of source.symbols) {
      if (name === '_') continue;
      if (source.engine.box(name).valueDefinition?.isConstant === true)
        continue;
      names.add(name);
    }
  }
  if (names.size === 1) return names.values().next().value;
  if (names.has('x')) return 'x';
  return undefined;
}

export const POLYNOMIALS_LIBRARY: SymbolDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      lazy: true,
      // Transformers report on the expression they are given: an invalid
      // operand is rewritten in place (the embedded `Error` survives), it is
      // not consumed. `inspectsErrors` keeps the routes that hand over an
      // already-canonical operand (`("a" + 1) |> Expand`, `Apply(Expand, …)`)
      // running the handler instead of bubbling — see the design's §8a
      // route-divergence residue. Audited on invalid canonical operands: no
      // throw, result is the (still invalid) rewritten expression.
      inspectsErrors: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expand(reduceTransformerOperand(x.canonical)),
    },

    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      lazy: true,
      inspectsErrors: true, // see `Expand`
      signature: '(value)-> value',
      evaluate: ([x]) => expandAll(reduceTransformerOperand(x.canonical)),
    },

    Factor: {
      description:
        'Factor a polynomial expression into a product of irreducible factors. ' +
        'Supports perfect square trinomials, difference of squares, and quadratic factoring with rational roots. ' +
        'Example: Factor(x² + 5x + 6) → (x+2)(x+3), Factor(x² + 2x + 1) → (x+1)²',
      lazy: true,
      inspectsErrors: true, // see `Expand`
      signature: '(value, symbol?) -> value',
      evaluate: ([x, varExpr]) => {
        if (!x) return x;

        // With a variable, factor in that variable. The variable is protected
        // from resolution: with `x := 5`, `Factor(x^2 - 1, x)` is a question
        // about `x`, not about `24`.
        if (varExpr) {
          const variable = sym(varExpr.canonical);
          if (!variable) return reduceTransformerOperand(x.canonical);
          return factorPolynomial(
            reduceTransformerOperand(x.canonical, new Set([variable])),
            variable
          );
        }

        // Otherwise, try polynomial factoring without specific variable
        return factorPolynomial(reduceTransformerOperand(x.canonical));
      },
    },

    Together: {
      description: 'Combine rational expressions into a single fraction',
      lazy: true,
      inspectsErrors: true, // see `Expand`
      signature: '(value)-> value',
      evaluate: ([x]) => {
        const target = reduceTransformerOperand(x.canonical);
        // An INVALID target has no rational form to combine: `togetherReduced`
        // reads the embedded `Error` node as a missing operand and returns
        // `1 / Error("missing")`, dropping the real error. Stay inert, like
        // the sibling transformers.
        if (!target.isValid) return target;
        return togetherReduced(target);
      },
    },

    Distribute: {
      description: 'Distribute multiplication over addition',
      lazy: true,
      inspectsErrors: true, // see `Expand`
      signature: '(value)-> value',
      evaluate: ([x]) =>
        !x ? x : distribute(reduceTransformerOperand(x.canonical)),
    },

    PolynomialDegree: {
      description:
        'Return the degree of a polynomial with respect to a variable. ' +
        'Example: PolynomialDegree(x³ + 2x + 1, x) → 3',
      lazy: true,
      signature: '(value, symbol?) -> integer',
      evaluate: ([poly, varExpr]) => {
        if (!poly) return undefined;
        const resolved = polynomialOperands(varExpr, poly);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        const deg = polynomialDegree(target, variable);
        return deg >= 0 ? poly.engine.number(deg) : undefined;
      },
    },

    CoefficientList: {
      description:
        'Return the list of coefficients of a polynomial, from highest to lowest degree. ' +
        'Example: CoefficientList(x³ + 2x + 1, x) → [1, 0, 2, 1]',
      lazy: true,
      signature: '(value, symbol?) -> list<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly) return undefined;
        const resolved = polynomialOperands(varExpr, poly);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        const coeffs = getPolynomialCoefficients(target, variable);
        if (!coeffs) return undefined;
        return poly.engine.expr(['List', ...coeffs.reverse()]);
      },
    },

    PolynomialQuotient: {
      description:
        'Return the quotient of polynomial division of dividend by divisor. ' +
        'Example: PolynomialQuotient(x³ - 1, x - 1, x) → x² + x + 1',
      lazy: true,
      signature:
        '(dividend: value, divisor: value, variable: symbol?) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor) return undefined;
        const resolved = polynomialOperands(varExpr, dividend, divisor);
        if (!resolved) return undefined;
        const [left, right] = resolved.targets;
        const { variable } = resolved;
        const result = polynomialDivide(left, right, variable);
        return result?.[0];
      },
    },

    PolynomialRemainder: {
      description:
        'Return the remainder of polynomial division of dividend by divisor. ' +
        'Example: PolynomialRemainder(x³ + 2x + 1, x + 1, x) → -2',
      lazy: true,
      signature:
        '(dividend: value, divisor: value, variable: symbol?) -> value',
      evaluate: ([dividend, divisor, varExpr]) => {
        if (!dividend || !divisor) return undefined;
        const resolved = polynomialOperands(varExpr, dividend, divisor);
        if (!resolved) return undefined;
        const [left, right] = resolved.targets;
        const { variable } = resolved;
        const result = polynomialDivide(left, right, variable);
        return result?.[1];
      },
    },

    PolynomialGCD: {
      description:
        'Return the greatest common divisor of two polynomials. ' +
        'Example: PolynomialGCD(x² - 1, x - 1, x) → x - 1',
      lazy: true,
      signature: '(a: value, b: value, variable: symbol?) -> value',
      evaluate: ([a, b, varExpr]) => {
        if (!a || !b) return undefined;
        const resolved = polynomialOperands(varExpr, a, b);
        if (!resolved) return undefined;
        const [left, right] = resolved.targets;
        const { variable } = resolved;
        return polynomialGCD(left, right, variable);
      },
    },

    Resultant: {
      description:
        'Return the resultant of two polynomials with respect to a variable. ' +
        'It is zero iff the polynomials share a common factor. ' +
        'Example: Resultant(x² - 1, x - 1, x) → 0',
      lazy: true,
      signature: '(a: value, b: value, variable: symbol?) -> value',
      evaluate: ([a, b, varExpr]) => {
        if (!a || !b) return undefined;
        const resolved = polynomialOperands(varExpr, a, b);
        if (!resolved) return undefined;
        const [left, right] = resolved.targets;
        const { variable } = resolved;
        return polynomialResultant(left, right, variable);
      },
    },

    Cancel: {
      description:
        'Cancel common polynomial factors in the numerator and denominator of a rational expression. ' +
        'Example: Cancel((x² - 1)/(x - 1), x) → x + 1',
      lazy: true,
      signature: '(value, symbol?) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr) return undefined;
        const resolved = polynomialOperands(varExpr, expr);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        return cancelCommonFactors(target, variable);
      },
    },

    PartialFraction: {
      description:
        'Decompose a rational expression into partial fractions. ' +
        'Example: PartialFraction(1/((x+1)(x+2)), x) → 1/(x+1) - 1/(x+2)',
      lazy: true,
      signature: '(value, symbol?) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr) return undefined;
        const resolved = polynomialOperands(varExpr, expr);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        return partialFraction(target, variable);
      },
    },

    Apart: {
      description:
        'Alias for PartialFraction. Decompose a rational expression into partial fractions.',
      lazy: true,
      signature: '(value, symbol?) -> value',
      evaluate: ([expr, varExpr]) => {
        if (!expr) return undefined;
        const resolved = polynomialOperands(varExpr, expr);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        return partialFraction(target, variable);
      },
    },

    PolynomialRoots: {
      description:
        'Return the roots of a polynomial expression. ' +
        'Example: PolynomialRoots(x² - 5x + 6, x) → {2, 3}',
      lazy: true,
      signature: '(value, symbol?) -> set<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly) return undefined;
        const resolved = polynomialOperands(varExpr, poly);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;
        const roots = target.polynomialRoots(variable);
        if (!roots || roots.length === 0) return undefined;
        return poly.engine.expr(['Set', ...roots.map((r) => r.json)]);
      },
    },

    Discriminant: {
      description:
        'Return the discriminant of a polynomial. ' +
        'Example: Discriminant(x² - 5x + 6, x) → 1',
      lazy: true,
      signature: '(value, symbol?) -> value',
      evaluate: ([poly, varExpr]) => {
        if (!poly) return undefined;
        const resolved = polynomialOperands(varExpr, poly);
        if (!resolved) return undefined;
        const [target] = resolved.targets;
        const { variable } = resolved;

        const coeffsAsc = getPolynomialCoefficients(target, variable);
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
            .sub(ce.number(192).mul(a).mul(a).mul(b).mul(d).mul(e).mul(e))
            .sub(ce.number(128).mul(a).mul(a).mul(c).mul(c).mul(e).mul(e))
            .add(ce.number(144).mul(a).mul(a).mul(c).mul(d).mul(d).mul(e))
            .sub(ce.number(27).mul(a).mul(a).mul(d).mul(d).mul(d).mul(d))
            .add(ce.number(144).mul(a).mul(b).mul(b).mul(c).mul(e).mul(e))
            .sub(ce.number(6).mul(a).mul(b).mul(b).mul(d).mul(d).mul(e))
            .sub(ce.number(80).mul(a).mul(b).mul(c).mul(c).mul(d).mul(e))
            .add(ce.number(18).mul(a).mul(b).mul(c).mul(d).mul(d).mul(d))
            .add(ce.number(16).mul(a).mul(c).mul(c).mul(c).mul(c).mul(e))
            .sub(ce.number(4).mul(a).mul(c).mul(c).mul(c).mul(d).mul(d))
            .sub(ce.number(27).mul(b).mul(b).mul(b).mul(b).mul(e).mul(e))
            .add(ce.number(18).mul(b).mul(b).mul(b).mul(c).mul(d).mul(e))
            .sub(ce.number(4).mul(b).mul(b).mul(b).mul(d).mul(d).mul(d))
            .sub(ce.number(4).mul(b).mul(b).mul(c).mul(c).mul(c).mul(e))
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
