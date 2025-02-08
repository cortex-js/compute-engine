import type { BoxedExpression } from '../public';

import { checkType } from '../boxed-expression/validate';

import { applicable, applicableN1 } from '../function-utils';
import { monteCarloEstimate } from '../numerics/monte-carlo';
import { centeredDiff8thOrder, limit } from '../numerics/numeric';
import { derivative, differentiate } from '../symbolic/derivative';
import type { IdentifierDefinitions } from '../types';

export const CALCULUS_LIBRARY: IdentifierDefinitions[] = [
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
      threadable: false,

      lazy: true,
      signature: '(any, order:number?) -> function',
      canonical: (ops, { engine }) => {
        return engine._fn('Derivative', [ops[0].canonical, ...ops.slice(1)]);
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
      threadable: false,

      lazy: true,
      signature:
        '(expression, variable:symbol, variables:...symbol) -> expression',
      canonical: (ops, { engine }) => {
        const ce = engine;
        let f = ops[0];
        if (!f) return null;

        ce.pushScope();
        const params = ops.slice(1);
        // const vars: BoxedExpression[] = [];
        // for (const param of params) {
        //   let v = param;
        //   if (v.op === 'ReleaseHold') v = param.op1.evaluate();
        //   if (!v.symbol) {
        //     ce.popScope();
        //     return null;
        //   }
        //   ce.declare(v.symbol, ce.Numbers);
        //   vars.push(ce.box(v.symbol));
        // }
        f.bind();
        f = f.canonical;
        const result = ce._fn('D', [f, ...params]);
        ce.popScope();
        return result;
      },
      evaluate: (ops, { engine }) => {
        const ce = engine;
        let f: BoxedExpression | undefined = ops[0].canonical;
        const context = ce.swapScope(f.scope);
        f = f.evaluate();
        const params = ops.slice(1);
        if (params.length === 0) f = undefined;
        for (const param of params) {
          if (!param.symbol) {
            f = undefined;
            break;
          }
          f = differentiate(f!, param.symbol);
          if (f === undefined) break;
        }
        ce.swapScope(context);
        f = f?.canonical;
        // Avoid recursive evaluation
        return f?.operator === 'D' ? f : f?.evaluate();
      },
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      threadable: false,
      lazy: true,
      signature: '(function, at:number) -> number',
      evaluate: ([body, x], { engine }) => {
        const xValue = x?.canonical.N().re;
        if (isNaN(xValue)) return undefined;

        const f = applicableN1(engine.box(body));
        return engine.number(centeredDiff8thOrder(f, xValue));
      },
    },

    Integrate: {
      wikidata: 'Q80091',
      threadable: false,

      lazy: true,
      signature: '(expression, range:(tuple|symbol|nothing)) -> number',
      canonical: (ops, { engine }) => {
        const ce = engine;
        let range = ops[1];
        let index: BoxedExpression | null = null;
        let lower: BoxedExpression | null = null;
        let upper: BoxedExpression | null = null;
        if (
          range &&
          range.operator !== 'Tuple' &&
          range.operator !== 'Triple' &&
          range.operator !== 'Pair' &&
          range.operator !== 'Single'
        ) {
          index = range;
        } else if (range) {
          // Don't canonicalize the index. Canonicalization has the
          // side effect of declaring the symbol, here we're using
          // it to do a local declaration
          index = range.ops?.[0] ?? null;
          lower = range.ops?.[1]?.canonical ?? null;
          upper = range.ops?.[2]?.canonical ?? null;
        }
        // The index, if present, should be a symbol
        if (index && index.operator === 'Hold') index = index.op1;
        if (index && index.operator === 'ReleaseHold')
          index = index.op1.evaluate();
        index ??= ce.Nothing;
        if (!index.symbol) index = ce.typeError('symbol', index.type, index);

        // The range bounds, if present, should be numbers
        if (lower && lower.symbol !== 'Nothing') {
          if (!lower.type.isUnknown) lower = checkType(ce, lower, 'number');
        }
        if (upper && upper.symbol !== 'Nothing') {
          if (!upper.type.isUnknown) upper = checkType(ce, upper, 'number');
        }
        if (lower && upper) range = ce.tuple(index, lower, upper);
        else if (upper) range = ce.tuple(index, ce.NegativeInfinity, upper);
        else if (lower) range = ce.tuple(index, lower);
        else range = index;

        let body = ops[0] ?? ce.error('missing');
        body = body.canonical;
        if (body.operator === 'Delimiter' && body.op1.operator === 'Sequence')
          body = body.op1.op1;

        return ce._fn('Integrate', [body, range]);
        // evaluate: (ce, ops) => {
        // @todo: implement using Risch Algorithm
        // },
        // N: (ce, ops) => {
        // N(Integrate) is transformed into NIntegrate
        // }
      },
    },

    NIntegrate: {
      threadable: false,
      lazy: true,
      signature: '(expression, lower:number, upper:number) -> number',
      evaluate: (ops, { engine }) => {
        // Switch to machine precision
        const precision = engine.precision;
        engine.precision = 'machine';
        const wasStrict = engine.strict;
        engine.strict = false;

        const [a, b] = ops.slice(1).map((op) => op.value);
        let result: BoxedExpression | undefined = undefined;
        if (typeof a === 'number' && typeof b === 'number') {
          const f = applicableN1(ops[0]);
          result = engine.number(monteCarloEstimate(f, a, b));
        }
        engine.precision = precision;
        engine.strict = wasStrict;
        return result;
      },
    },
  },

  {
    // Limits
    Limit: {
      description: 'Limit of a function',
      complexity: 5000,
      threadable: false,

      lazy: true,
      signature: '(expression, point:number, direction:number?) -> number',
      evaluate: (ops, { engine: ce }) => {
        const [f, x, dir] = ops;
        const target = x.N().re;
        if (!isFinite(target)) return undefined;
        const fn = applicable(f);
        return ce.number(
          limit(
            (x) => {
              const y = fn([ce.number(x)])?.value;
              return typeof y === 'number' ? y : Number.NaN;
            },
            target,
            dir ? dir.re : 1
          )
        );
      },
    },
    NLimit: {
      description: 'Numerical approximation of the limit of a function',
      complexity: 5000,
      threadable: false,

      lazy: true,
      signature: '(expression, point:number, direction:number?) -> number',
      evaluate: ([f, x, dir], { engine }) => {
        const target = x.N().re;
        if (Number.isNaN(target)) return undefined;
        const fn = applicable(f);
        return engine.number(
          limit(
            (x) => {
              const y = fn([engine.number(x)])?.value;
              return typeof y === 'number' ? y : Number.NaN;
            },
            target,
            dir ? dir.re : 1
          )
        );
      },
    },
  },
];
