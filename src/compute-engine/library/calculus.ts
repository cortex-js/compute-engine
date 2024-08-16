import { checkDomain } from '../boxed-expression/validate';
import { applicable, applicableN1 } from '../function-utils';
import { monteCarloEstimate } from '../numerics/monte-carlo';
import { centeredDiff8thOrder, limit } from '../numerics/numeric';
import { derivative, differentiate } from '../symbolic/derivative';
import { BoxedExpression, IdentifierDefinitions } from '../public';

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
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          ['OptArg', 'Numbers'], // The order of the derivative
          'Functions',
        ],
        evaluate: (ce, ops) => {
          // Is it a function name, i.e. ["Derivative", "Sin"]?
          const op = ops[0].evaluate();
          const degree = Math.floor(ops[1]?.N().re ?? 1);
          return derivative(op, degree);
        },
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
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          'Symbols',
          ['VarArg', 'Symbols'],
          'Anything',
        ],
        canonical: (ce, ops) => {
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
        evaluate: (ce, ops) => {
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
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      hold: 'first',
      threadable: false,
      signature: {
        domain: ['FunctionOf', 'Anything', 'Numbers', 'Functions'],
        N: (ce, ops) => {
          const x = ops[1]?.value;
          if (typeof x !== 'number') return undefined;

          const f = applicableN1(ce.box(ops[0]));
          return ce.number(centeredDiff8thOrder(f, x));
        },
      },
    },

    Integrate: {
      wikidata: 'Q80091',
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Functions',
          ['OptArg', ['Union', 'Tuples', 'Symbols']],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          'Numbers',
        ],
        canonical: (ce, ops) => {
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
          if (!index.symbol)
            index = ce.domainError('Symbols', index.domain, index);

          // The range bounds, if present, should be numbers
          if (lower) lower = checkDomain(ce, lower, ce.Numbers);
          if (upper) upper = checkDomain(ce, upper, ce.Numbers);
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
    },

    NIntegrate: {
      hold: 'first',
      threadable: false,
      signature: {
        domain: ['FunctionOf', 'Functions', 'Numbers', 'Numbers', 'Numbers'],
        params: ['Functions', 'Numbers', 'Numbers'],
        restParam: 'Numbers',
        evaluate: (ce, ops) => {
          // Switch to machine precision
          const precision = ce.precision;
          ce.precision = 'machine';
          const wasStrict = ce.strict;
          ce.strict = false;

          const [a, b] = ops.slice(1).map((op) => op.value);
          let result: BoxedExpression | undefined = undefined;
          if (typeof a === 'number' && typeof b === 'number') {
            const f = applicableN1(ops[0]);
            result = ce.number(monteCarloEstimate(f, a, b));
          }
          ce.precision = precision;
          ce.strict = wasStrict;
          return result;
        },
      },
    },
  },

  {
    // Limits
    Limit: {
      description: 'Limit of a function',
      complexity: 5000,
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          'Numbers',
          ['OptArg', 'Numbers'],
          'Numbers',
        ],
        N: (ce, ops) => {
          const [f, x, dir] = ops;
          const target = x.N().re ?? NaN;
          if (!isFinite(target)) return undefined;
          const fn = applicable(f);
          return ce.number(
            limit(
              (x) => {
                const y = fn([ce.number(x)])?.value;
                return typeof y === 'number' ? y : Number.NaN;
              },
              target,
              dir ? (dir.re ?? 1) : 1
            )
          );
        },
      },
    },
    NLimit: {
      description: 'Numerical approximation of the limit of a function',
      complexity: 5000,
      hold: 'all',
      threadable: false,
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          'Numbers',
          ['OptArg', 'Numbers'],
          'Numbers',
        ],
        evaluate: (ce, ops) => {
          const [f, x, dir] = ops;
          const target = x.N().re ?? NaN;
          if (Number.isNaN(target)) return undefined;
          const fn = applicable(f);
          return ce.number(
            limit(
              (x) => {
                const y = fn([ce.number(x)])?.value;
                return typeof y === 'number' ? y : Number.NaN;
              },
              target,
              dir ? (dir.re ?? 1) : 1
            )
          );
        },
      },
    },
  },
];
