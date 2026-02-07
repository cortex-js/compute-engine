import type { BoxedExpression, SymbolDefinitions } from '../global-types';

import { checkType } from '../boxed-expression/validate';
import { hasSymbolicTranscendental } from '../boxed-expression/utils';

import {
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
} from '../function-utils';
import { monteCarloEstimate } from '../numerics/monte-carlo';
import { centeredDiff8thOrder, limit } from '../numerics/numeric';
import { derivative, differentiate } from '../symbolic/derivative';
import { antiderivative } from '../symbolic/antiderivative';
import { canonicalLimits, canonicalLimitsSequence } from './utils';

export const CALCULUS_LIBRARY: SymbolDefinitions[] = [
  {
    /* @todo
    ## Definite Integral
`\int f dx` -> ["Integrate", "f", "x"]

`\int\int f dxdy` -> ["Integrate", "f", "x", "y"]

Note: `["Integrate", ["Integrate", "f" , "x"], "y"]` is equivalent to
`["Integrate", "f" , "x", "y"]`


`\int_{a}^{b} f dx` -> ["Integrate", f, [x, a, b]]
`\int_{c}^{d} \int_{a}^{b} f dxdy` -> ["Integrate", "f", ["Triple", "x", "a",
"b"], ["Triple", "y", "c", "d"]]

`\int_{a}^{b}\frac{dx}{f}` -> ["Integrate", ["Power", "f", -1], ["Triple", "x",
"a", "b"]]

`\int_{a}^{b}dx f` -> ["Integrate", "f", ["Triple", "x", "a", "b"]]

If `[a, b]` are numeric, numeric methods are used to approximate the integral.

## Domain Integral

`\int_{x\in D}` -> ["Integrate", f, ["In", x, D]]

### Contour Integral

`\oint f dx` -> `["ContourIntegral", "f", "x"]`

`\varointclockwise f dx` -> `["ClockwiseContourIntegral", "f", "x"]`

`\ointctrclockwise f dx` -> `["CounterclockwiseContourIntegral", "f", "x"]`

`\oiint f ds` -> `["DoubleCountourIntegral", "f", "s"]` : integral over closed
surfaces

`\oiiint` f dv -> `["TripleCountourIntegral", "f", "v"]` : integral over closed
volumes

`\intclockwise`

`\intctrclockwise`

`\iint`

`\iiint`
*/

    // @todo: review the following
    // - https://index.scala-lang.org/cascala/galileo
    // - https://symbolics.juliasymbolics.org/stable/
    // - https://github.com/symengine/SymEngine.jl

    //
    // Functions
    //

    //
    // **Derivative**
    //
    // Returns a function that represents the derivative of the
    // given function.
    //
    // In contrast to the `D` function, the `Derivative` function
    // returns a function that represents the derivative of the given
    // function, rather than the result of evaluating the derivative
    // at a given point.

    // `['Derivative', f]` < = > `["D", ["Apply", f, "x"], "x"]`
    //
    //
    // ["Derivative", "Sin"]
    //    -> "Cos"
    //
    // ["Derivative", ["Function", ["Square", "x"], "x"], 2]
    //    -> "2"
    //
    // The argument "2" of the `Derivative` function indicates the order
    // of the derivative.
    //
    //
    // @todo: consider Fractional Calculus, i.e. Louiville-Riemann derivative
    // https://en.wikipedia.org/wiki/Fractional_calculus
    // with values of the order that can be either fractional or negative
    //
    Derivative: {
      broadcastable: false,

      lazy: true,
      signature: '(function, order:number?) -> function',
      canonical: (ops, { engine }) => {
        const fn = canonicalFunctionLiteral(ops[0].canonical);
        if (!fn) return null;
        if (!ops[1]) return engine._fn('Derivative', [fn]);
        const order = checkType(engine, ops[1]?.canonical, 'number');
        return engine._fn('Derivative', [fn, order]);
      },
      evaluate: (ops) => {
        const op = ops[0].evaluate();
        const degree = Math.floor(ops[1]?.N().re);
        return derivative(op, isNaN(degree) ? 1 : degree);
      },
    },

    //
    // **D: Partial derivative**
    //
    // Returns the partial derivative of a function with respect to a
    // variable.
    //
    // ["D", "Sin", "x"]
    //    -> ["Cos", "x"]
    //
    // This is equivalent to `["Apply", ["Derivative", "Sin"], "x"]`

    D: {
      broadcastable: false,

      scoped: true,
      lazy: true,
      signature:
        '(expression, variable:symbol, variables:symbol+) -> expression',
      canonical: (ops, { engine: ce, scope }) => {
        const f = canonicalFunctionLiteralArguments(ce, ops);
        if (!f) return null;

        return ce._fn('D', [f, ...ops!.slice(1)], { scope });
      },
      evaluate: (ops, { engine }) => {
        let f: BoxedExpression | undefined = ops[0].canonical;
        f = f.evaluate();
        const params = ops.slice(1);
        if (params.length === 0) f = undefined;
        for (const param of params) {
          if (!param.symbol) {
            f = undefined;
            break;
          }
          if (f && f.operator === 'Function') f = f.op1;
          f = differentiate(f!, param.symbol);
          if (f === undefined) break;
        }
        f = f?.canonical;
        // Avoid recursive evaluation
        if (f?.operator === 'D') return f;
        // Avoid evaluating symbolic derivative applications like Digamma'(x)
        // which would incorrectly evaluate to 0
        if (f?.operator === 'Apply' && f.op1?.operator === 'Derivative')
          return f;
        // If the result contains symbolic transcendentals (like ln(2)),
        // return it without full evaluation to preserve the symbolic form
        if (f && hasSymbolicTranscendental(f)) return f;
        return f?.evaluate();
      },
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      broadcastable: false,
      lazy: true,
      signature: '(function, at:number) -> number',
      canonical: (ops, { engine }) => {
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        const x = checkType(engine, ops[1]?.canonical, 'number');
        return engine._fn('ND', [fn, x]);
      },
      evaluate: ([body, x], { engine }) => {
        const xValue = x.N().re;
        if (isNaN(xValue)) return undefined;

        return engine.number(
          centeredDiff8thOrder(engine._compile(body), xValue)
        );
      },
    },

    Integrate: {
      wikidata: 'Q80091',
      broadcastable: false,

      lazy: true,
      signature: '(function, limits+) -> number',
      canonical: (ops, { engine: ce }) => {
        if (!ops[0]) return null;

        const f = canonicalFunctionLiteral(ops[0]);
        if (!f) return null;

        const limits = canonicalLimitsSequence(ops.slice(1), { engine: ce });
        return ce._fn('Integrate', [f, ...limits]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (numericApproximation) {
          // If a numeric approximation is requested, equivalent to NIntegrate
          const f = ops[0];
          const firstLimit = ops[1];
          const [lower, upper] = [firstLimit.op2.N().re, firstLimit.op3.N().re];
          if (isNaN(lower) || isNaN(upper)) return undefined;

          // Get the integration variable from the limits
          const variable = firstLimit.op1.symbol ?? 'x';

          // Compile the integrand as a function.
          // If it's already a Function expression, compile directly.
          // Otherwise wrap it in a Function to compile correctly for numerical eval.
          // This converts e.g. 'x' to ['Function', 'x', 'x'] -> (x) => x
          const fnExpr =
            f.operator === 'Function' ? f : ce.box(['Function', f, variable]);
          const jsf = ce._compile(fnExpr);

          const mce = monteCarloEstimate(
            jsf,
            lower,
            upper,
            jsf.isCompiled ? 1e7 : 1e4
          );
          return ce.box([
            'PlusMinus',
            ce.number(mce.estimate),
            ce.number(mce.error),
          ]);
        }

        let expr = ops[0];
        const argNames = expr.ops?.slice(1)?.map((x) => x.symbol) ?? [];

        const limitsSequence = ops.slice(1);

        // Indefinite integral?
        if (limitsSequence.length === 0) {
          return undefined;
        }

        let isIndefinite = true;
        for (let i = limitsSequence.length - 1; i >= 0; i--) {
          const [varExpr, lower, upper] = limitsSequence[i].ops!;
          let variable = varExpr.symbol;

          // Default variable name if missing
          if ((!variable || variable === 'Nothing') && i < argNames.length)
            variable = argNames[i];
          if (!variable) variable = 'x';

          const antideriv = antiderivative(expr, variable);

          if (antideriv.operator !== 'Integrate') {
            const fAntideriv = antideriv; // ce.box(['Function', antideriv.op1, variable]);
            if (lower.symbol === 'Nothing' && upper.symbol === 'Nothing') {
              expr = fAntideriv;
            } else {
              isIndefinite = false;
              const F = ce.box(['Function', antideriv, variable]);
              expr = ce.box(['EvaluateAt', F, lower, upper]);
            }
          } else {
            if (lower.symbol === 'Nothing' && upper.symbol === 'Nothing') {
              expr = antideriv;
            } else {
              isIndefinite = false;
              const F = ce.box(['Function', antideriv, variable]);
              expr = ce.box(['EvaluateAt', F, lower, upper]);
            }
          }
        }
        if (expr.operator !== 'Integrate') {
          // For indefinite integrals with symbolic transcendental constants
          // (like ln(2)), don't call evaluate/simplify as it would convert
          // them to numeric values. Otherwise, simplify for cleaner output.
          if (isIndefinite) {
            if (hasSymbolicTranscendental(expr)) return expr;
            return expr.simplify();
          }
          return expr.evaluate({ numericApproximation });
        }
        return expr;
      },
    },

    NIntegrate: {
      broadcastable: false,
      lazy: true,
      signature: '(function, limits:(tuple|symbol)?) -> number',
      canonical: (ops, { engine }) => {
        const [body, lower, upper] = ops;
        const fn = canonicalFunctionLiteral(body);
        // @todo: normalizeIndexingSet() ?
        if (!fn) return null;
        if (!lower || !upper) return null;
        return engine._fn('NIntegrate', [fn, lower.canonical, upper.canonical]);
      },
      evaluate: ([f, a, b], { engine }) => {
        const [lower, upper] = [a.N().re, b.N().re];
        if (isNaN(lower) || isNaN(upper)) return undefined;
        const jsf = engine._compile(f);
        return engine.number(
          monteCarloEstimate(jsf, lower, upper, jsf.isCompiled ? 1e7 : 1e4)
            .estimate
        );
      },
    },

    // This is used to represent the indexing set/limits (i.e.
    // an index, lower and upper bounds) of a function
    // (not to be confused with Limit, which calculates the limit of a
    // function at a point)
    // It is a convenient function that prevents the first argument (the index)
    // from being canonicalized
    Limits: {
      description: 'Limits of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(index:symbol, lower:value, upper:value) -> tuple',
      canonical: (ops, { engine }) => canonicalLimits(ops, { engine }) ?? null,
    },
  },

  {
    // Limits
    Limit: {
      description: 'Limit of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(function, point:number, direction:number?) -> number',
      canonical: ([f, x, dir], { engine }) => {
        const fn = canonicalFunctionLiteral(f);
        if (!fn || !x) return null;
        if (dir === undefined) return engine._fn('Limit', [fn, x.canonical]);
        return engine._fn('Limit', [fn, x.canonical, dir.canonical]);
      },
      evaluate: ([f, x, dir], { engine, numericApproximation }) => {
        if (numericApproximation) {
          const target = x.N().re;
          if (Number.isNaN(target)) return undefined;
          const fn = engine._compile(f);
          return engine.number(limit(fn, target, dir ? dir.re : 1));
        }
        return undefined;
      },
    },
    NLimit: {
      description: 'Numerical approximation of the limit of a function',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(function, point:number, direction:number?) -> number',
      canonical: ([f, x, dir], { engine }) => {
        const fn = canonicalFunctionLiteral(f);
        if (!fn || !x) return null;
        if (dir === undefined) return engine._fn('NLimit', [fn, x.canonical]);
        return engine._fn('NLimit', [fn, x.canonical, dir.canonical]);
      },
      evaluate: ([f, x, dir], { engine }) => {
        const target = x.N().re;
        if (Number.isNaN(target)) return undefined;
        const fn = engine._compile(f);
        return engine.number(limit(fn, target, dir ? dir.re : 1));
      },
    },
  },
];
