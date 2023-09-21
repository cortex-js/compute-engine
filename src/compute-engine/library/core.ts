import { BoxedExpression, IdentifierDefinitions } from '../public';
import { joinLatex } from '../latex-syntax/tokenizer';
import { asSmallInteger, fromDigits } from '../numerics/numeric';

import {
  validateArgument,
  validateArgumentCount,
} from '../boxed-expression/validate';
import { canonical } from '../symbolic/flatten';
import { randomExpression } from './random-expression';
import { apply } from '../function-utils';

//   // := assign 80 // @todo
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbols() -> return list of all known symbols
// FreeVariables(expr) -> return list of all free variables in expr

export const CORE_LIBRARY: IdentifierDefinitions[] = [
  {
    Nothing: { domain: 'Nothing' },
  },

  //
  // Inert functions
  //
  {
    Delimiter: {
      // Use to represent groups of expressions. Named after https://en.wikipedia.org/wiki/Delimiter
      complexity: 9000,
      hold: 'first',
      signature: {
        domain: [
          'Function',
          'Anything',
          ['Maybe', 'String'],
          ['Maybe', 'String'],
          'Anything',
        ],
        codomain: (_ce, args) => args[0].domain,
        canonical: (ce, args) => args[0]?.canonical ?? ce.box(['Sequence']),
      },
    },
    Error: {
      /**
       * - The first argument is either a string or an `["ErrorCode"]`
       * expression indicating the nature of the error.
       * - The second argument, if present, indicates the context/location
       * of the error. If the error occur while parsing a LaTeX string,
       * for example, the argument will be a `Latex` expression.
       */
      hold: 'all',
      complexity: 500,
      signature: {
        domain: ['Function', 'Anything', ['Maybe', 'Anything'], 'Void'],
        // To make a canonical expression, don't canonicalize the args
        canonical: (ce, args) => ce._fn('Error', args),
      },
    },
    ErrorCode: {
      complexity: 500,
      hold: 'all',
      signature: {
        domain: [
          'Function',
          'String',
          ['Maybe', ['Sequence', 'Anything']],
          'Anything',
        ],
        canonical: (ce, args) => {
          const code = validateArgument(ce, args[0], 'String').string;
          if (code === 'incompatible-domain') {
            return ce._fn('ErrorCode', [
              ce.string(code),
              ce.domain(args[1] ?? 'Anything'),
              ce.domain(args[2] ?? 'Anything'),
            ]);
          }
          return ce._fn('ErrorCode', args);
        },
      },
    },
    Hold: {
      hold: 'all',
      signature: {
        domain: 'Function',
        codomain: (ce, args) =>
          args[0].symbol ? ce.domain('Symbol') : ce.domain('Anything'),
        // To make a canonical expression, don't canonicalize the args
        canonical: (ce, args) =>
          args.length !== 1
            ? ce._fn('Hold', validateArgumentCount(ce, args, 1))
            : ce._fn('Hold', [validateArgument(ce, args[0], 'Anything')]),
      },
    },
    HorizontalSpacing: {
      signature: {
        domain: 'Function',
        canonical: (ce, args) => {
          if (args.length === 2) return args[0].canonical;
          // Returning an empty `["Sequence"]` will make the expression be ignored
          return ce.box(['Sequence']);
        },
      },
    },
    Style: {
      complexity: 9000,
      inert: true,
      signature: {
        domain: [
          'Function',
          'Anything',
          ['Maybe', 'Dictionary'], // @todo
          'Anything',
        ],
      },

      // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x
    },
  },
  {
    Apply: {
      signature: {
        domain: 'Function',
        evaluate: (_ce, ops) => apply(ops[0], ops.slice(1)),
      },
    },

    Assume: {
      hold: 'all',
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        evaluate: (ce, ops) => ce.string(ce.assume(ops[0])),
      },
    },

    // @todo
    About: { signature: { domain: 'Function' } },

    Domain: {
      /** Return the domain of an expression */
      signature: {
        domain: ['Function', 'Anything', 'Domain'],
        canonical: (ce, ops) =>
          ce.domain(validateArgumentCount(ce, canonical(ops), 1)[0]),
        evaluate: (_ce, ops) => ops[0].domain,
      },
    },

    Evaluate: {
      hold: 'all',
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        codomain: (_ce, ops) => ops[0].domain,
        canonical: (ce, ops) =>
          ce._fn('Evaluate', validateArgumentCount(ce, canonical(ops), 1)),
        evaluate: (_ce, ops) => ops[0].evaluate(),
      },
    },

    Simplify: {
      hold: 'all',
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        codomain: (_ce, ops) => ops[0].domain,
        canonical: (ce, ops) =>
          ce._fn('Simplify', validateArgumentCount(ce, canonical(ops), 1)),
        evaluate: (_ce, ops) => ops[0].simplify(),
      },
    },

    N: {
      hold: 'all',
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        codomain: (_ce, ops) => ops[0].domain,
        canonical: (ce, ops) =>
          ce._fn('N', validateArgumentCount(ce, canonical(ops), 1)),
        evaluate: (_ce, ops) => ops[0].N(),
      },
    },

    Head: {
      signature: {
        domain: 'Function',
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (typeof op1?.head === 'string') return ce.symbol(op1.head);
          return op1?.head ?? ce.symbol('Nothing');
        },
      },
    },

    Identity: {
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        codomain: (_ce, ops) => ops[0].domain,
        evaluate: (_ce, ops) => ops[0],
      },
    },

    // @todo: need review
    Signatures: {
      signature: {
        domain: ['Function', 'Symbol', ['Maybe', ['List', 'Domain']]],
        canonical: (ce, ops) => {
          ops = validateArgumentCount(ce, ops, 1);
          if (!ops[0].symbol)
            return ce._fn('Signatures', [
              ce.error(
                ['incompatible-domain', 'Symbol', ops[0].domain],
                ops[0]
              ),
            ]);
          return ce._fn('Signatures', ops);
        },
        evaluate: (ce, ops) => {
          const name = ops[0].symbol;
          if (!name) return ce.symbol('Nothing');
          const result = ce.lookupFunction(name);
          if (!result) return ce.symbol('Nothing');
          return ce.fn('List', [result.signature.domain]);
        },
      },
    },

    Subscript: {
      /**
       * The `Subscript` function can take several forms:
       *
       * If `op1` is a string, the string is interpreted as a number in
       * base `op2` (2 to 36).
       *
       * If `op1` is an indexable collection, `x`:
       * - `x_*` -> `At(x, *)`
       *
       * Otherwise:
       * - `x_0` -> Symbol "x_0"
       * - `x_n` -> Symbol "x_n"
       * - `x_{\text{max}}` -> Symbol `x_max`
       * - `x_{(n+1)}` -> `At(x, n+1)`
       * - `x_{n+1}` ->  `Subscript(x, n+1)`
       */

      // The last (subscript) argument can include a delimiter that
      // needs to be interpreted. Without the hold, it would get
      // removed during canonicalization.
      hold: 'last',

      signature: {
        domain: ['Function', 'Anything', 'Anything', 'Anything'],
        codomain: (_ce, args) => {
          if (args[0].isFunction) return args[0].domain;
          return args[0].domain;
        },
        canonical: (ce, args) => {
          const op1 = args[0];
          const op2 = args[1];
          // Is it a string in a base form:
          // `"deadbeef"_{16}` `"0101010"_2?
          if (op1.string) {
            const base = asSmallInteger(op2);
            if (base !== null) {
              if (base > 1 && base <= 36) {
                const [value, rest] = fromDigits(op1.string, base);
                if (rest) {
                  return ce.error(
                    ['unexpected-digit', { str: rest[0] }],
                    ['LatexString', ce.string(op1.string)]
                  );
                }
                return ce.number(value);
              }
            }
          }
          // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
          // or an indexable collection?
          if (op1.symbol) {
            // Is the value of the symbol an indexable collection?
            const vh = op1.value?.head;
            if (vh) {
              const def = ce.lookupFunction(vh);
              if (def?.at) return ce._fn('At', [op1, op2.canonical]);
            }
            // Maybe a compound symbol
            const sub =
              op2.string ?? op2.symbol ?? asSmallInteger(op2)?.toString();

            if (sub) return ce.symbol(op1.symbol + '_' + sub);
          }
          if (op2.head === 'Sequence')
            ce._fn('Subscript', [op1, ce._fn('List', op2.ops!)]);

          return ce._fn('Subscript', args);
        },
      },
    },

    Symbol: {
      complexity: 500,
      description:
        'Construct a new symbol with a name formed by concatenating the arguments',
      threadable: true,
      hold: 'all',
      signature: {
        domain: ['Function', ['Sequence', 'Anything'], 'Anything'],
        canonical: (ce, ops) => {
          if (ops.length === 0) return ce.symbol('Nothing');
          const arg = ops
            .map(
              (x) => x.symbol ?? x.string ?? asSmallInteger(x)?.toString() ?? ''
            )
            .join('');

          if (arg.length > 0) return ce.symbol(arg);

          return ce.symbol('Nothing');
        },
        // Note: a `["Symbol"]` expression is never evaluated, it gets
        // transformed into something else (a symbol) during canonicalization
      },
    },

    Timing: {
      description:
        '`Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation',
      signature: {
        domain: [
          'Function',
          'Value',
          ['Maybe', 'Integer'],
          ['Tuple', 'Value', 'Number'],
        ],
        evaluate: (ce, ops) => {
          if (ops[1].symbol === 'Nothing') {
            // Evaluate once
            const start = globalThis.performance.now();
            const result = ops[0].evaluate();
            const timing = 1000 * (globalThis.performance.now() - start);

            return ce.pair(ce.number(timing), result);
          }

          // Evaluate multiple times
          let n = Math.max(3, Math.round(asSmallInteger(ops[1]) ?? 3));

          let timings: number[] = [];
          let result: BoxedExpression;
          while (n > 0) {
            const start = globalThis.performance.now();
            result = ops[0].evaluate();
            timings.push(1000 * (globalThis.performance.now() - start));
            n -= 1;
          }

          const max = Math.max(...timings);
          const min = Math.min(...timings);
          timings = timings.filter((x) => x > min && x < max);
          const sum = timings.reduce((acc, v) => acc + v, 0);

          if (sum === 0) return ce.pair(ce.number(max), result!);
          return ce.pair(ce.number(sum / timings.length), result!);
        },
      },
    },
    // {name: 'Pattern',},
  },

  //
  // LaTeX-related
  //
  {
    // Value preserving type conversion/tag indicating the string
    // is a LaTeX string
    LatexString: {
      inert: true,
      signature: { domain: ['Function', 'String', 'String'] },
    },

    // Serialize one or more expressions to LaTeX
    Latex: {
      signature: {
        domain: ['Function', ['Maybe', ['Sequence', 'Anything']], 'String'],
        evaluate: (ce, ops) =>
          ce.fn('LatexString', [ce.string(joinLatex(ops.map((x) => x.latex)))]),
      },
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: {
        domain: ['Function', 'Anything', 'Anything'],
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.box(['Sequence']);
          const op1 = ops[0];
          const s =
            op1.string ?? op1.head === 'LatexString' ? op1.op1.string : '';
          return ce.parse(s) ?? ce.box(['Sequence']);
        },
      },
    },
  },

  {
    RandomExpression: {
      signature: {
        domain: 'Function',
        evaluate: (ce, _ops) => ce.box(randomExpression()),
      },
    },
  },
];
