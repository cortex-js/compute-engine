import { validateArgument } from '../boxed-expression/validate';
import { makeScopedLambda1 } from '../function-utils';
import { centeredDiff8thOrder, monteCarloEstimate } from '../numerics/numeric';
import { BoxedExpression, IdTable } from '../public';

export const CALCULUS_LIBRARY: IdTable[] = [
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

    //
    // Functions
    //

    //
    // Represents the derivative of a function
    // Used when the derivative is not known
    // It is an inert function that can be used in other expressions
    //
    Derivative: {
      signature: {
        domain: [
          'Function',
          'Function',
          ['Maybe', 'Number'], // The order of the derivative
          'Function',
        ],
      },
    },

    // Evaluate a numerical approximation of a derivative at point x
    ND: {
      hold: 'first',
      signature: {
        domain: ['Function', 'Function', 'Number', 'Function'],
        N: (ce, ops) => {
          const x = ops[1]?.valueOf();
          if (typeof x !== 'number') return undefined;

          const f = makeScopedLambda1(ops[0]);
          if (!f) return undefined;
          ce.pushScope();
          const result = ce.number(centeredDiff8thOrder(f, x, 1e-6));
          ce.popScope();
          return result;
        },
      },
    },

    //
    // **D: Partial derivative**
    //
    // ["D", f, "x"] -> ["Derivative", f] if f is a function of with a single free variable
    // ["D", f, "x", "x"] -> ["Derivative", f, 2]
    // ["D", f, "y", "x"] -> cannot be represented with a ["Derivative"] expression

    D: {
      signature: {
        domain: ['Function', 'Function', ['Sequence', 'Symbol'], 'Function'],
        evaluate: (_ce, ops) => {
          // @todo: symbolic differentiation
          return undefined;
        },
      },
    },

    Integrate: {
      wikidata: 'Q80091',
      hold: 'all',
      signature: {
        domain: [
          'Function',
          'Function',
          ['Union', 'Nothing', 'Tuple', 'Symbol'],
          // ['Tuple', 'Symbol', ['Maybe', 'Integer'], ['Maybe', 'Integer']],
          'Number',
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
          index ??= ce.symbol('Nothing');
          if (!index.symbol)
            index = ce.error(['incompatible-domain', 'Symbol', index.domain]);

          // The range bounds, if present, should be numbers
          if (lower) lower = validateArgument(ce, lower, 'Number');
          if (upper) upper = validateArgument(ce, upper, 'Number');
          if (lower && upper) range = ce.tuple([index, lower, upper]);
          else if (upper)
            range = ce.tuple([index, ce._NEGATIVE_INFINITY, upper]);
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
        domain: ['Function', 'Function', 'Number', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const f = makeScopedLambda1(ops[0]);
          if (!f) return undefined;
          const [a, b] = ops.slice(1).map((op) => op.valueOf());
          if (typeof a !== 'number' || typeof b !== 'number') return undefined;
          ce.pushScope();
          const result = ce.number(monteCarloEstimate(f, a, b));
          ce.popScope();
          return result;
        },
      },
    },
  },
];
