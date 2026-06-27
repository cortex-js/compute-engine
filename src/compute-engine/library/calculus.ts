import type { Expression, SymbolDefinitions } from '../global-types';

import { checkType } from '../boxed-expression/validate';
import { hasSymbolicTranscendental } from '../boxed-expression/utils';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';
import { BoxedNumber } from '../boxed-expression/boxed-number';

import {
  applicableN1,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
} from '../function-utils';
import { monteCarloEstimate } from '../numerics/monte-carlo';
import { integrateSemiInfiniteOscillatory } from '../numerics/oscillatory-quadrature';
import { centeredDiff8thOrder, limit } from '../numerics/numeric';
import { nDSolve } from '../numerics/differential-equations';
import { derivative, differentiate } from '../symbolic/derivative';
import { antiderivative } from '../symbolic/antiderivative';
import { dSolve } from '../symbolic/differential-equations';
import { symbolicLimit } from '../symbolic/limit';
import { residue } from '../symbolic/residue';
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
      description: 'Derivative operator that returns a derivative function.',
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
      description:
        'Symbolic partial derivative with respect to one or more variables.',
      broadcastable: false,

      scoped: true,
      lazy: true,
      signature:
        '(expression, variable:symbol, variables:symbol+) -> expression',
      type: ([body]) => {
        // The derivative of a numeric expression is numeric
        if (body && body.type.matches('number')) return body.type;
        return undefined; // fall back to signature
      },
      canonical: (ops, { engine: ce, scope }) => {
        // If the first argument is a function symbol (e.g., f where f(x):=2x),
        // apply it to the differentiation variables to produce a function call.
        // e.g., ['D', 'f', 'x'] → ['D', ['f', 'x'], 'x']
        if (isSymbol(ops[0]) && ops[0].canonical.operatorDefinition) {
          const vars = ops.slice(1);
          const fCall = ce.function(ops[0].symbol, vars);
          return ce._fn('D', [fCall, ...vars], { scope });
        }

        // If the first argument is already a function call (e.g., f'(x)
        // parsed as ['D', ['f', 'x'], 'x']), use it directly rather than
        // wrapping in Function(Block(...)).
        const op0 = ops[0].canonical;
        if (isFunction(op0) && op0.operator) {
          return ce._fn('D', [op0, ...ops.slice(1)], { scope });
        }

        const f = canonicalFunctionLiteralArguments(ce, ops);
        if (!f) return null;

        return ce._fn('D', [f, ...ops!.slice(1)], { scope });
      },
      evaluate: (ops, { engine: _engine }) => {
        let f: Expression | undefined = ops[0].canonical;

        // Unwrap Function literals to get the body for differentiation.
        // For non-Function expressions (e.g., ['f', 'x']), do NOT call
        // .evaluate() before differentiating — that would prematurely
        // substitute variable values (e.g., x=5) and lose structural info.
        if (isFunction(f, 'Function')) {
          f = f.op1;
        }

        const params = ops.slice(1);
        if (params.length === 0) f = undefined;
        for (const param of params) {
          const paramSym = sym(param);
          if (!paramSym) {
            f = undefined;
            break;
          }
          f = differentiate(f!, paramSym);
          if (f === undefined) break;
        }
        f = f?.canonical;
        // Avoid recursive evaluation
        if (f?.operator === 'D') return f;
        // Avoid evaluating symbolic derivative applications like Digamma'(x)
        // which would incorrectly evaluate to 0
        if (
          f?.operator === 'Apply' &&
          isFunction(f) &&
          f.op1?.operator === 'Derivative'
        )
          return f;
        // If the result contains symbolic transcendentals (like ln(2)),
        // return it without full evaluation to preserve the symbolic form
        if (f && hasSymbolicTranscendental(f)) return f;
        return f?.evaluate();
      },
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      description: 'Numerical derivative evaluated at a point.',
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
        // ND uses compiled JS functions (machine arithmetic), so box
        // the result directly as a machine number to avoid wrapping
        // in BigDecimal at higher engine precisions.
        const xValue = x.N().re;
        if (isNaN(xValue)) return undefined;

        const compiled = engine._compile(body);
        const fn =
          (compiled.run as (x: number) => number) ?? applicableN1(body);
        return new BoxedNumber(engine, centeredDiff8thOrder(fn, xValue));
      },
    },

    Integrate: {
      description: 'Symbolic integral with optional bounds.',
      wikidata: 'Q80091',
      broadcastable: false,

      lazy: true,
      signature: '(function, limits+) -> number',
      canonical: (ops, { engine: ce }) => {
        if (!ops[0]) return null;

        const limits = canonicalLimitsSequence(ops.slice(1), { engine: ce });

        let f = canonicalFunctionLiteral(ops[0]);
        if (!f) return null;

        // Bind only the integration variable(s) from the limits, not every
        // free symbol. `canonicalFunctionLiteral` infers a parameter for each
        // free symbol in the body, so a free coefficient (e.g. `a` in
        // `∫ a·sin(x) dx`, or the wrongly-inferred `F` in `∫ (G−F) dt`) would
        // become a spurious integrand parameter. Reuse its already-processed
        // body and re-bind with just the (de-duplicated) integration
        // variable(s). Skip when the integrand is already an explicit
        // `Function` (preserve user-supplied parameters) or a bare symbol.
        if (isFunction(f, 'Function') && ops[0].operator !== 'Function') {
          const seen = new Set<string>();
          const vars: Expression[] = [];
          for (const l of limits) {
            const v = isFunction(l) ? l.op1 : undefined;
            if (
              v &&
              isSymbol(v) &&
              v.symbol !== 'Nothing' &&
              !seen.has(v.symbol)
            ) {
              seen.add(v.symbol);
              vars.push(v);
            }
          }
          if (vars.length > 0) f = ce._fn('Function', [f.op1, ...vars]);
        }

        return ce._fn('Integrate', [f, ...limits]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        if (numericApproximation) {
          // If a numeric approximation is requested, equivalent to NIntegrate
          const f = ops[0];
          const firstLimit = ops[1];
          if (!isFunction(firstLimit)) return undefined;
          const [lower, upper] = [firstLimit.op2.N().re, firstLimit.op3.N().re];
          if (isNaN(lower) || isNaN(upper)) return undefined;

          // Get the integration variable from the limits
          const variable = sym(firstLimit.op1) ?? 'x';

          // Compile the integrand as a function.
          // If it's already a Function expression, compile directly.
          // Otherwise wrap it in a Function to compile correctly for numerical eval.
          // This converts e.g. 'x' to ['Function', 'x', 'x'] -> (x) => x
          const fnExpr =
            f.operator === 'Function' ? f : ce.expr(['Function', f, variable]);
          const compiled = ce._compile(fnExpr);
          const jsf =
            (compiled.run as (x: number) => number) ?? applicableN1(fnExpr);

          // Semi-infinite interval: a conditionally-convergent oscillatory
          // integrand (∫₀^∞ sin x/x, ∫₀^∞ sin(x²)) defeats Monte-Carlo
          // importance sampling. Try the dedicated lobe-integration +
          // ε-acceleration quadrature first; it returns null (→ Monte Carlo)
          // for non-oscillatory or divergent integrands.
          const aInf = !isFinite(lower);
          const bInf = !isFinite(upper);
          if (aInf !== bInf) {
            const osc = bInf
              ? integrateSemiInfiniteOscillatory(jsf, lower, ce._deadline)
              : integrateSemiInfiniteOscillatory(
                  (t) => jsf(-t),
                  -upper,
                  ce._deadline
                );
            if (osc)
              return ce.expr([
                'PlusMinus',
                ce.number(osc.estimate),
                ce.number(osc.error),
              ]);
          }

          const mce = monteCarloEstimate(
            jsf,
            lower,
            upper,
            compiled.success ? 1e7 : 1e4,
            ce._deadline
          );
          return ce.expr([
            'PlusMinus',
            ce.number(mce.estimate),
            ce.number(mce.error),
          ]);
        }

        let expr = ops[0];
        const argNames = isFunction(expr)
          ? expr.ops.slice(1).map((x) => sym(x))
          : [];

        const limitsSequence = ops.slice(1);

        // Indefinite integral?
        if (limitsSequence.length === 0) {
          return undefined;
        }

        let isIndefinite = true;
        for (let i = limitsSequence.length - 1; i >= 0; i--) {
          if (!isFunction(limitsSequence[i])) continue;
          const limitFn = limitsSequence[i] as Expression &
            import('../global-types').FunctionInterface;
          const [varExpr, lower, upper] = limitFn.ops;
          let variable = sym(varExpr);

          // Default variable name if missing
          if ((!variable || variable === 'Nothing') && i < argNames.length)
            variable = argNames[i];
          if (!variable) variable = 'x';

          // An opt-in integration provider (e.g. the Rubi rule driver loaded
          // via `loadIntegrationRules`) is consulted first; it returns null or
          // an inert `Integrate` when it can't close the integrand, in which
          // case we fall back to the built-in antiderivative. With no provider
          // registered (the default), behavior is unchanged.
          let antideriv: Expression | null = null;
          if (ce._integrationProvider) {
            try {
              antideriv = ce._integrationProvider(expr, variable);
            } catch {
              antideriv = null;
            }
          }
          if (!antideriv || antideriv.operator === 'Integrate')
            antideriv = antiderivative(expr, variable);

          if (antideriv.operator !== 'Integrate') {
            const fAntideriv = antideriv; // ce.expr(['Function', antideriv.op1, variable]);
            if (sym(lower) === 'Nothing' && sym(upper) === 'Nothing') {
              expr = fAntideriv;
            } else {
              isIndefinite = false;
              const F = ce.expr(['Function', antideriv, variable]);
              expr = ce.expr(['EvaluateAt', F, lower, upper]);
            }
          } else {
            if (sym(lower) === 'Nothing' && sym(upper) === 'Nothing') {
              expr = antideriv;
            } else {
              isIndefinite = false;
              const F = ce.expr(['Function', antideriv, variable]);
              expr = ce.expr(['EvaluateAt', F, lower, upper]);
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
      description: 'Numerical approximation of a definite integral.',
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
        // Uses compiled JS functions (machine arithmetic)
        const [lower, upper] = [a.N().re, b.N().re];
        if (isNaN(lower) || isNaN(upper)) return undefined;
        const compiled = engine._compile(f);
        const jsf = (compiled.run as (x: number) => number) ?? applicableN1(f);

        // Dedicated oscillatory quadrature for semi-infinite intervals (see
        // the `Integrate` numeric path); null → fall back to Monte Carlo.
        const aInf = !isFinite(lower);
        const bInf = !isFinite(upper);
        if (aInf !== bInf) {
          const osc = bInf
            ? integrateSemiInfiniteOscillatory(jsf, lower, engine._deadline)
            : integrateSemiInfiniteOscillatory(
                (t) => jsf(-t),
                -upper,
                engine._deadline
              );
          if (osc) return new BoxedNumber(engine, osc.estimate);
        }

        return new BoxedNumber(
          engine,
          monteCarloEstimate(
            jsf,
            lower,
            upper,
            compiled.success ? 1e7 : 1e4,
            engine._deadline
          ).estimate
        );
      },
    },

    DSolve: {
      description: 'Symbolic differential equation solver.',
      broadcastable: false,
      lazy: true,
      signature: '(expression, symbol, symbol) -> expression',
      canonical: (ops, { engine }) => {
        const symbolArg = (arg: Expression | undefined): Expression => {
          if (arg === undefined) return engine.error('missing');
          if (!isSymbol(arg)) return engine.typeError('symbol', arg.type, arg);
          return arg;
        };

        if (ops.length === 0)
          return engine._fn('DSolve', [
            engine.error('missing'),
            engine.error('missing'),
            engine.error('missing'),
          ]);
        if (ops.length === 1)
          return engine._fn('DSolve', [
            ops[0],
            engine.error('missing'),
            engine.error('missing'),
          ]);
        if (ops.length === 2)
          return engine._fn('DSolve', [
            ops[0],
            symbolArg(ops[1]),
            engine.error('missing'),
          ]);

        return engine._fn('DSolve', [
          ops[0],
          symbolArg(ops[1]),
          symbolArg(ops[2]),
        ]);
      },
      evaluate: ([equation, dependent, independent]) =>
        dSolve(equation, dependent, independent),
    },

    NDSolve: {
      description: 'Numerical differential equation solver.',
      broadcastable: false,
      lazy: true,
      signature:
        '(expression, symbol, limits:(tuple|symbol), number, number?) -> list',
      canonical: (ops, { engine }) => {
        const symbolArg = (arg: Expression | undefined): Expression => {
          if (arg === undefined) return engine.error('missing');
          if (!isSymbol(arg)) return engine.typeError('symbol', arg.type, arg);
          return arg;
        };

        const missing = engine.error('missing');
        return engine._fn('NDSolve', [
          ops[0] ?? missing,
          symbolArg(ops[1]),
          ops[2] ?? missing,
          ops[3]?.canonical ?? missing,
          ...(ops[4] ? [ops[4].canonical] : []),
        ]);
      },
      evaluate: ([equation, dependent, limits, initialValue, steps]) =>
        nDSolve(equation, dependent, limits, initialValue, steps),
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
        // Symbolic path first: it produces an exact closed form (`sin x/x → 1`,
        // `(3ˣ+5ˣ)^{1/x} → 5`) and is the only path under a non-numeric
        // `evaluate()`. It returns `undefined` when it can't determine the
        // limit, so the numeric machinery below still covers everything it did.
        if (isFunction(f)) {
          const varName = sym(f.op2);
          if (varName) {
            const direction =
              dir && Number.isFinite(dir.re) ? dir.re : undefined;
            const symbolic = symbolicLimit(
              f.op1,
              varName,
              x,
              direction,
              engine
            );
            if (symbolic !== undefined)
              return numericApproximation ? symbolic.N() : symbolic;
          }
        }

        // Numeric fallback: compiled JS functions (machine arithmetic).
        if (numericApproximation) {
          const target = x.N().re;
          if (Number.isNaN(target)) return undefined;
          const compiled = engine._compile(f);
          const fn = (compiled.run as (x: number) => number) ?? applicableN1(f);
          return new BoxedNumber(
            engine,
            limit(fn, target, dir ? dir.re : 1, engine._deadline)
          );
        }
        return undefined;
      },
    },
    Residue: {
      description:
        'Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion)',
      complexity: 5000,
      broadcastable: false,

      lazy: true,
      signature: '(expression, variable:symbol, point:value) -> number',
      canonical: ([f, x, a], { engine }) => {
        if (!f || !x || !a || !isSymbol(x)) return null;
        return engine._fn('Residue', [f.canonical, x, a.canonical]);
      },
      evaluate: ([f, x, a], { engine, numericApproximation }) => {
        const varName = sym(x);
        if (!varName) return undefined;
        const r = residue(f, varName, a, engine);
        if (r === undefined) return undefined;
        return numericApproximation ? r.N() : r;
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
        // Uses compiled JS functions (machine arithmetic)
        const target = x.N().re;
        if (Number.isNaN(target)) return undefined;
        const compiled = engine._compile(f);
        const fn = (compiled.run as (x: number) => number) ?? applicableN1(f);
        return new BoxedNumber(
          engine,
          limit(fn, target, dir ? dir.re : 1, engine._deadline)
        );
      },
    },
  },
];
