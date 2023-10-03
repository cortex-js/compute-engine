import { checkArg } from '../boxed-expression/validate';
import { applicableN1 } from '../function-utils';
import { centeredDiff8thOrder, monteCarloEstimate } from '../numerics/numeric';
import { BoxedExpression, IdentifierDefinitions } from '../public';
import { partialDerivative } from '../symbolic/derivative';

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
    // Represents the derivative of a function
    // ["Derivative", "Sin"] -> "Cos"
    // ["Derivative", ["Sin", "_"]] -> ["Cos", "_"]
    // @todo: consider Fractional Calculus, i.e. Louiville-Riemann derivative
    // https://en.wikipedia.org/wiki/Fractional_calculus
    // with values of the order that can be either fractional or negative
    //
    Derivative: {
      hold: 'all',
      signature: {
        domain: [
          'FunctionOf',
          'Symbols',
          ['OptArg', 'Numbers'], // The order of the derivative
          'Functions',
        ],
        canonical: (ce, ops) => {
          // Is it a function name, i.e. ["Derivative", "Sin"]?
          if (ops[0].functionDefinition) {
            return (
              partialDerivative(ce._fn(ops[0].canonical, [ce.symbol('_')]), '_')
                ?.canonical ?? ce._fn('Derivative', ops)
            );
          }
          return ce._fn('Derivative', ops);
        },
        simplify: (ce, ops) => {
          const expr = ops[0].simplify();
          if (ops[1]) return ce._fn('Derivative', [expr, ops[1]]);

          return ce._fn('Derivative', [expr]);
        },
        evaluate: (ce, ops) => {
          // Is it a function name, i.e. ["Derivative", "Sin"]?
          if (ops[0].functionDefinition) {
            return (
              partialDerivative(
                ce._fn(ops[0].evaluate(), [ce.symbol('_')]),
                '_'
              )?.canonical ?? undefined
            );
          }
          // It's a function expression, i.e. ["Derivative", ["Sin", "_"]]
          const f = partialDerivative(ops[0].evaluate(), '_');
          if (!f) return undefined;
          return f.canonical;
        },
      },
    },

    //
    // **D: Partial derivative**
    //
    // ["D", f, "x"] -> If f is an expression of x, derivative of f with respect
    //                        to x
    // ["D", f, "x", "x"]
    // ["D", f, "y", "x"]

    D: {
      hold: 'all',
      signature: {
        domain: [
          'FunctionOf',
          'Anything',
          'Symbols',
          ['VarArg', 'Symbols'],
          'Anything',
        ],
        evaluate: (ce, ops) => {
          let f = ops[0];
          // Iterate aver all variables
          const vars = ops.slice(1);
          while (vars.length > 0) {
            const v = vars.shift();
            if (!v?.symbol) return undefined;
            ce.pushScope();
            ce.declare(v.symbol, ce.Numbers);
            const fPrime = partialDerivative(f.canonical, v.symbol);
            ce.popScope();
            // If we couldn't derivate with respect to this variable, return
            // a partial derivation
            if (fPrime === undefined) return ce._fn(f, vars);
            f = fPrime;
          }
          return f;
        },
      },
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      hold: 'first',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Numbers', 'Functions'],
        N: (ce, ops) => {
          const x = ops[1]?.valueOf();
          if (typeof x !== 'number') return undefined;

          const f = applicableN1(ce.box(ops[0]));
          return ce.number(centeredDiff8thOrder(f, x, 1e-6));
        },
      },
    },

    Integrate: {
      wikidata: 'Q80091',
      hold: 'all',
      signature: {
        domain: [
          'FunctionOf',
          'Functions',
          ['OptArg', ['Union', 'Tuples', 'Symbols']],
          // ['Tuple', 'Symbols', ['OptArg', 'Integers'], ['OptArg', 'Integers']],
          'Numbers',
        ],
        canonical: (ce, ops) => {
          const body = ops[0] ?? ce.error('missing');

          let range = ops[1];
          let index: BoxedExpression | null = null;
          let lower: BoxedExpression | null = null;
          let upper: BoxedExpression | null = null;
          if (
            range &&
            range.head !== 'Tuple' &&
            range.head !== 'Triple' &&
            range.head !== 'Pair' &&
            range.head !== 'Single'
          ) {
            index = range;
          } else if (range) {
            // Don't canonicalize the index. Canonicalization as the
            // side effect of declaring the symbol, here we're using
            // it to do a local declaration
            index = range.ops?.[0] ?? null;
            lower = range.ops?.[1]?.canonical ?? null;
            upper = range.ops?.[2]?.canonical ?? null;
          }
          // The index, if present, should be a symbol
          if (index && index.head === 'Hold') index = index.op1;
          if (index && index.head === 'ReleaseHold')
            index = index.op1.evaluate();
          index ??= ce.Nothing;
          if (!index.symbol)
            index = ce.error(['incompatible-domain', 'Symbols', index.domain]);

          // The range bounds, if present, should be numbers
          if (lower) lower = checkArg(ce, lower, ce.Numbers);
          if (upper) upper = checkArg(ce, upper, ce.Numbers);
          if (lower && upper) range = ce.tuple([index, lower, upper]);
          else if (upper) range = ce.tuple([index, ce.NegativeInfinity, upper]);
          else if (lower) range = ce.tuple([index, lower]);
          else range = index;

          return ce._fn('Integrate', [body.canonical, range]);
          // evaluate: (ce, ops) => {
          // @todo: implement using Risch Algorithm
          // },
          // N: (ce, ops) => {
          // @todo: implement using Monte Carlo integration
          // }
        },
      },
    },

    NIntegrate: {
      hold: 'first',
      signature: {
        domain: ['FunctionOf', 'Functions', 'Numbers', 'Numbers', 'Numbers'],
        evaluate: (ce, ops) => {
          const f = applicableN1(ops[0]);
          const [a, b] = ops.slice(1).map((op) => op.valueOf());
          if (typeof a !== 'number' || typeof b !== 'number') return undefined;
          return ce.number(monteCarloEstimate(f, a, b));
        },
      },
    },
  },
];
