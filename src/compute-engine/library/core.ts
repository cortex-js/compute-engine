import {
  BoxedDomain,
  CanonicalForm,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { joinLatex } from '../latex-syntax/tokenizer';
import { fromDigits } from '../numerics/numeric';

import { checkDomain, checkArity } from '../boxed-expression/validate';
import { randomExpression } from './random-expression';
import { apply, canonicalFunctionExpression } from '../function-utils';
import { canonical } from '../symbolic/utils';
import { isDomain } from '../boxed-expression/boxed-domain';
import { isIndexableCollection } from '../collection-utils';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { normalizeIndexingSet } from './utils';
import { canonicalForm } from '../boxed-expression/canonical';
import { BoxedExpression } from '../boxed-expression/public';
import { asFloat, asMachineInteger } from '../boxed-expression/numerics';
import { order } from '../boxed-expression/order';

//   // := assign 80 // @todo
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbols() -> return list of all known symbols
// FreeVariables(expr) -> return list of all free variables in expr

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1

export const CORE_LIBRARY: IdentifierDefinitions[] = [
  {
    Nothing: { domain: 'NothingDomain' },
  },

  //
  // Inert functions
  //
  {
    /**
     * ### THEORY OF OPERATIONS: SEQUENCES
     *
     * There are three similar functions used to represent sequences of
     * expressions:
     *
     * - `InvisibleOperator` represent a sequence of expressions
     *  that are syntactically juxtaposed without any separator or
     *  operators combining them.
     *
     *  For example, `2x` is represented as `["InvisibleOperator", 2, "x"]`.
     *  `InvisibleOperator` gets transformed into `Multiply` (or some other
     *  semantic operation) during canonicalization.
     *
     * - `Sequence` is used to represent a sequence of expressions
     *   at a semantic level. It is a collection, but it is handled
     *   specially when canonicalizing expressions, for example it
     *   is automatically flattened and hoisted to the top level of the
     *   argument list.
     *
     *   For example:
     *
     *     `["Add", "a", ["Sequence", "b", "c"]]`
     *
     *   is canonicalized to
     *
     *     `["Add", "a", "b", "c"]`.
     *
     *   The empty `Sequence` expression (i.e. `["Sequence"]`) is ignored
     *   but it can be used to represent an "empty" expression.
     *
     * - `Delimiter` is used to represent a group of expressions
     *   with an open and close delimiter and a separator.
     *
     *   They capture the input syntax, and can get transformed into other
     *   expressions during boxing and canonicalization.
     *
     *   The first argument is a function expression, such as `List`
     *   or `Sequence`. The arguments of that expression are represented
     *   with a separator between them and delimiters around the whole
     *   group.
     *
     *   If the first argument is a `Sequence` with a single element,
     *   the `Sequence` can be omitted.
     *
     *   The second argument specify the separator and delimiters. If not
     *   specified, the default is the string `"(,)"`
     *
     * Examples:
     * - `f(x)` ->
     *    `["InvisibleOperator",
     *        "f",
     *        ["Delimiter", "x"]
     *     ]`
     *
     * - `1, 2; 3, 4` ->
     *    `["Delimiter",
     *      ["Sequence",
     *        ["Delimiter", ["Sequence", 1, 2], "','"],
     *        ["Delimiter", ["Sequence", 3, 4], "','"],
     *      ],
     *     "';'"
     *    ]`
     *
     * - `2x` -> `["InvisibleOperator", 2, "x"]`
     *
     * - `2+` -> `["InvisibleOperator", 2,
     *              ["Error", "'unexpected-operator'", "+"]]`
     *
     *
     *
     *
     */
    InvisibleOperator: {
      complexity: 9000,
      hold: 'all',
      signature: {
        restParam: 'Anything',
        result: (ce, args) => {
          if (args.length === 0) return ce.domain('NothingDomain');
          if (args.length === 1) return args[0].domain;
          return ce.Anything;
        },
        canonical: canonicalInvisibleOperator,
      },
    },
    /** See above for a theory of operations */
    Sequence: {
      hold: 'all',
      signature: {
        restParam: 'Anything',
        result: (ce, args) => {
          if (args.length === 0) return ce.domain('NothingDomain');
          if (args.length === 1) return args[0].domain;
          return ce.Anything;
        },
        canonical: (ce, args) => {
          const xs = flattenSequence(canonical(args));
          if (xs.length === 0) return ce._fn('Sequence', []);
          if (xs.length === 1) return xs[0];
          return ce._fn('Sequence', xs);
        },
      },
    },
    /** See above for a theory of operations */
    Delimiter: {
      // Use to represent groups of expressions.
      // Named after https://en.wikipedia.org/wiki/Delimiter
      complexity: 9000,
      hold: 'all',
      signature: {
        params: ['Anything'],
        optParams: ['Strings'],
        result: (ce, args) => {
          if (args.length === 0) return ce.domain('NothingDomain');
          return args[0].domain;
        },

        canonical: (ce, args) => {
          // During parsing, no interpretation is made of the delimiters.
          // This gives more option to this handler, or handler of
          // other functions that use `Delimiter` as a parameter.

          // An empty delimiter, i.e. `()` is an empty tuple.
          // Note: this codepath is not hit by `f()`, which is
          // handled in `InvisibleOperator`.
          if (args.length === 0) return ce._fn('Tuple', []);

          // The Delimiter function can have:
          // - a single argument, which is a sequence of expressions
          // - two arguments, the first is a sequence of expressions
          //   and the second is a delimiter string
          if (args.length > 2)
            return ce._fn('Delimiter', checkArity(ce, args, 2));

          let body = args[0];

          // If the body is a sequence, turn it into a Tuple
          // We'll have a sequence when there is a delimiter inside
          // the sequence, like `(a, b, c)`. The sequence is used to group
          // the arguments, so it needs to be preserved.
          // If there is a single element, unpack it.
          if (body.head === 'Sequence')
            return ce._fn('Tuple', canonical(body.ops!));

          body = body.canonical;

          const delim = args[1]?.string;

          // If we have a single argument and parentheses, i.e. `(2)`, return
          // the argument
          if (!delim || (delim.startsWith('(') && delim.endsWith(')')))
            return body;

          if ((delim?.length ?? 0) > 3) {
            return ce._fn('Delimiter', [
              body,
              ce.error('invalid-delimiter', args[1]),
            ]);
          }

          return ce._fn('Delimiter', [
            args[0],
            checkDomain(ce, args[1], 'Strings'),
          ]);
        },
        evaluate: (ce, ops) => {
          if (ops.length === 0) return ce.Nothing;

          const op1 = ops[0];

          if (op1.head === 'Sequence' || op1.head === 'Delimiter')
            ops = flattenSequence(ops[0].ops!);

          if (ops.length === 1) return ops[0].evaluate();

          return ce._fn(
            'Tuple',
            ops.map((x) => x.evaluate())
          );
        },
        N: (ce, ops) => {
          if (ops.length === 0) return ce.Nothing;

          const op1 = ops[0];

          if (op1.head === 'Sequence' || op1.head === 'Delimiter')
            ops = flattenSequence(ops[0].ops!);

          if (ops.length === 1) return ops[0].N();

          return ce._fn(
            'Tuple',
            ops.map((x) => x.N())
          );
        },
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
        domain: ['FunctionOf', 'Anything', ['OptArg', 'Anything'], 'Void'],
        // To make a canonical expression, don't canonicalize the args
        canonical: (ce, args) => ce._fn('Error', args),
      },
    },
    ErrorCode: {
      complexity: 500,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Strings', ['VarArg', 'Anything'], 'Anything'],
        canonical: (ce, args) => {
          const code = checkDomain(ce, args[0], ce.Strings).string;
          if (code === 'incompatible-domain') {
            return ce._fn('ErrorCode', [ce.string(code), args[1], args[2]]);
          }
          return ce._fn('ErrorCode', args);
        },
      },
    },
    Hold: {
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        result: (ce, args) => {
          if (args.length !== 1) return ce.domain('NothingDomain');
          const op1 = args[0];
          if (op1.symbol) return ce.domain('Symbols');
          if (op1.string) return ce.domain('Strings');
          if (op1.head === 'Numbers') return ce.domain('Numbers');
          return op1.domain;
        },
        // By definition, for arguments of the canonical expression of
        // `Hold` are not canonicalized.
        canonical: (ce, args) => (args.length !== 1 ? null : ce.hold(args[0])),
        evaluate: (ce, ops) => ops[0],
      },
    },
    HorizontalSpacing: {
      signature: {
        domain: 'Functions',
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
          'FunctionOf',
          'Anything',
          ['OptArg', 'Dictionaries'], // @todo
          'Anything',
        ],
      },

      // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x
    },
  },
  {
    // Structural operations that can be applied to non-canonical expressions
    // @todo
    About: { signature: { domain: 'Functions' } },

    Head: {
      hold: 'all',
      signature: {
        domain: 'Functions',
        canonical: (ce, args) => {
          // **IMPORTANT** Head should work on non-canonical expressions
          if (args.length !== 1) return null;
          const op1 = args[0];
          if (op1.head) return ce.box(op1.head);
          return ce._fn('Head', canonical(args));
        },
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (typeof op1?.head === 'string') return ce.symbol(op1.head);
          return op1?.head ?? ce.Nothing;
        },
      },
    },

    Tail: {
      hold: 'all',
      signature: {
        domain: 'Functions',
        canonical: (ce, args) => {
          // **IMPORTANT** Tail should work on non-canonical expressions
          if (args.length !== 1) return null;
          const op1 = args[0];
          if (op1.ops) return ce._fn('Sequence', op1.ops);
          return ce._fn('Tail', canonical(args));
        },
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          if (op1?.ops) return ce.box(['Sequence', ...op1.ops]);
          return ce.box(['Sequence']);
        },
      },
    },

    Identity: {
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        result: (ce, ops) => {
          if (ops.length !== 1) return ce.domain('NothingDomain');
          return ops[0].domain;
        },
        evaluate: (_ce, ops) => ops[0],
      },
    },
  },
  {
    Apply: {
      signature: {
        domain: 'Functions',
        canonical: (ce, args) => {
          if (args[0].symbol) return ce.box([args[0].symbol, ...args.slice(1)]);
          return ce._fn('Apply', args);
        },
        evaluate: (_ce, ops) => apply(ops[0], ops.slice(1)),
      },
    },

    Assign: {
      hold: 'all',
      pure: false,
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything', 'Anything'],
        canonical: (ce, args) => {
          if (args.length !== 2) return null;
          const op1 = args[0];
          if (!op1.symbol) return null;
          const op2 = args[1];
          return ce._fn('Assign', [op1, op2]);
        },
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          const op2 = ops[1];
          if (!op1.symbol) return ce.Nothing;
          const val = op2.evaluate();
          ce.assign(op1.symbol, val);
          return val;
        },
      },
    },

    Assume: {
      hold: 'all',
      pure: false,
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        evaluate: (ce, ops) => ce.string(ce.assume(ops[0])),
      },
    },

    Declare: {
      hold: 'all',
      pure: false,
      signature: {
        domain: ['FunctionOf', 'Symbols', 'Anything'],
        canonical: (ce, args) => {
          if (args.length !== 2) return null;
          const op1 = args[0];
          const op2 = args[1];
          if (!op1.symbol) return null;
          if (op2.symbol) return ce._fn('Declare', args);
          return ce._fn('Declare', [op1, ce._fn('Hold', [op2])]);
        },
        evaluate: (ce, ops) => {
          const op1 = ops[0];
          const op2 = ops[1];
          if (!op1.symbol) return ce.Nothing;
          const val = op2.evaluate();
          if (!isDomain(val)) return undefined;
          ce.declare(op1.symbol, val as BoxedDomain);
          return val;
        },
      },
    },

    Domain: {
      /** Return the domain of an expression */
      signature: {
        domain: ['FunctionOf', 'Anything', 'Domains'],
        evaluate: (_ce, ops) => ops[0].domain,
      },
    },

    Evaluate: {
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        result: (ce, ops) => {
          if (ops.length !== 1) return ce.domain('NothingDomain');
          return ops[0].domain;
        },
        canonical: (ce, ops) => ce._fn('Evaluate', checkArity(ce, ops, 1)),
        evaluate: (_ce, ops) => ops[0].evaluate(),
      },
    },

    Function: {
      complexity: 9876,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', ['VarArg', 'Symbols'], 'Functions'],
        canonical: (ce, args) => {
          // When canonicalizing a function expression, we need to
          // create a new scope and declare all the arguments as
          // variables in that scope.

          if (args.length === 0) return ce.box(['Sequence']);

          const canonicalFn = canonicalFunctionExpression(
            args[0],
            args.slice(1)
          );
          if (!canonicalFn) return null;

          const body = canonicalFn[0].canonical;
          const params = canonicalFn
            .slice(1)
            .map((x) => ce.symbol(x as string));

          // If the function has no arguments, it is equivalent to the body
          if (params.length === 0) return body;

          return ce._fn('Function', [body, ...params]);
        },
        evaluate: (_ce, _args) => {
          // "evaluating" a function expression is not the same
          // as applying arguments to it.
          // See `function apply()` for that.

          return undefined;
        },
      },
    },

    Simplify: {
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        result: (ce, ops) => {
          if (ops.length !== 1) return ce.domain('NothingDomain');
          return ops[0].domain;
        },
        canonical: (ce, ops) => ce._fn('Simplify', checkArity(ce, ops, 1)),
        evaluate: (_ce, ops) => ops[0]?.simplify() ?? undefined,
      },
    },

    // Can be used to sort arguments of an expression.
    // Sorting arguments of commutative functions is a weak form of
    // canonicalization that can be useful in some cases, for example
    // to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"

    CanonicalForm: {
      complexity: 8200,
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', ['VarArg', 'Symbols'], 'Anything'],
        // Do not canonicalize the arguments, we want to preserve
        // the original form before modifying it
        canonical: (_ce, ops) => {
          if (ops.length === 1) return ops[0].canonical;

          const forms = ops
            .slice(1)
            .map((x) => x.symbol ?? x.string)
            .filter((x) => x !== undefined && x !== null) as CanonicalForm[];
          return canonicalForm(ops[0], forms);
        },
      },
    },

    N: {
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
        result: (ce, ops) => {
          if (ops.length !== 1) return ce.domain('NothingDomain');
          return ops[0].domain;
        },
        canonical: (ce, ops) => {
          // Only call checkArity (which canonicalize) if the
          // argument length is invalid
          if (ops.length !== 1) return ce._fn('N', checkArity(ce, ops, 1));

          const h = ops[0].head;
          if (h === 'N') return ops[0].canonical;
          if (h === 'Integrate') {
            const [index, lower, upper] = normalizeIndexingSet(ops[0].op2);
            if (!index || lower === undefined || upper === undefined)
              return null;
            const fn = ops[0].op1;
            return ce._fn('NIntegrate', [
              ce.box(['Function', fn, index]),
              ce.number(lower),
              ce.number(upper),
            ]);
          }
          if (h === 'Limit') return ce._fn('NLimit', ops[0].ops!);

          return ce._fn('N', ops);
        },
        evaluate: (_ce, ops) => ops[0].N(),
      },
    },

    // @todo: need review
    Signatures: {
      signature: {
        domain: ['FunctionOf', 'Symbols', ['ListOf', 'Domains']],
        canonical: (ce, ops) => {
          ops = checkArity(ce, ops, 1);
          if (!ops[0].symbol)
            return ce._fn('Signatures', [
              ce.domainError('Symbols', ops[0].domain, ops[0]),
            ]);
          return ce._fn('Signatures', ops);
        },
        evaluate: (ce, ops) => {
          const name = ops[0].symbol;
          if (!name) return ce.Nothing;
          const def = ce.lookupFunction(name);
          if (!def) return ce.box(['List']);
          const sig = def.signature;
          const fnParams: BoxedExpression[] = [...sig.params];
          if (sig.optParams.length > 0)
            fnParams.push(ce._fn('OptArg', sig.optParams));
          if (sig.restParam) fnParams.push(ce._fn('VarArg', [sig.restParam]));

          if (typeof sig.result === 'function')
            fnParams.push(sig.result(ce, []) ?? ce.symbol('Undefined'));
          else fnParams.push(sig.result);
          return ce.box(['List', ...fnParams]);
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
        domain: ['FunctionOf', 'Anything', 'Anything', 'Anything'],
        result: (ce, args: ReadonlyArray<BoxedExpression>) => {
          if (args.length !== 2) return ce.domain('NothingDomain');
          const op1 = args[0];
          const op2 = args[1];
          if (op1.string && asMachineInteger(op2) !== null)
            return ce.domain('Integers');
          if (op1.symbol) {
            const vh = op1.evaluate()?.head;
            if (vh) {
              const def = ce.lookupFunction(vh);
              if (def?.at) return undefined;
              return ce.domain('Symbols');
            }
          }
          return undefined;
        },
        canonical: (ce, args) => {
          const op1 = args[0];
          const op2 = args[1];
          // Is it a string in a base form:
          // `"deadbeef"_{16}` `"0101010"_2?
          if (op1.string) {
            const base = asMachineInteger(op2);
            if (base !== null && base > 1 && base <= 36) {
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
          // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
          // or an indexable collection?
          if (op1.symbol) {
            // Is the value of the symbol an indexable collection?
            const vh = op1.evaluate()?.head;
            if (vh) {
              const def = ce.lookupFunction(vh);
              if (def?.at) return ce._fn('At', [op1.canonical, op2.canonical]);
            }
            // Maybe a compound symbol
            const sub =
              op2.string ?? op2.symbol ?? asMachineInteger(op2)?.toString();

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
        domain: ['FunctionOf', ['VarArg', 'Anything'], 'Anything'],
        canonical: (ce, ops) => {
          if (ops.length === 0) return ce.Nothing;
          const arg = ops
            .map(
              (x) =>
                x.symbol ?? x.string ?? asMachineInteger(x)?.toString() ?? ''
            )
            .join('');

          if (arg.length > 0) return ce.symbol(arg);

          return ce.Nothing;
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
          'FunctionOf',
          'Values',
          ['OptArg', 'Integers'],
          ['TupleOf', 'Values', 'Numbers'],
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
          let n = Math.max(3, Math.round(asMachineInteger(ops[1]) ?? 3));

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
  },

  //
  // Wildcards
  //
  {
    Wildcard: {
      signature: {
        params: ['Symbols'],
        result: 'Symbols',
        canonical: (ce, args) => {
          if (args.length !== 1) return ce.symbol('_');
          return ce.symbol('_' + args[0].symbol);
        },
      },
    },
    WildcardSequence: {
      signature: {
        params: ['Symbols'],
        result: 'Symbols',
        canonical: (ce, args) => {
          if (args.length !== 1) return ce.symbol('__');
          return ce.symbol('__' + args[0].symbol);
        },
      },
    },
    WildcardOptionalSequence: {
      signature: {
        params: ['Symbols'],
        result: 'Symbols',
        canonical: (ce, args) => {
          if (args.length !== 1) return ce.symbol('___');
          return ce.symbol('___' + args[0].symbol);
        },
      },
    },
  },

  //
  // LaTeX-related
  //
  {
    // Value preserving type conversion/tag indicating the string
    // is a LaTeX string
    LatexString: {
      inert: true,
      signature: { domain: ['FunctionOf', 'Strings', 'Strings'] },
    },

    // Serialize one or more expressions to LaTeX
    Latex: {
      signature: {
        domain: ['FunctionOf', ['VarArg', 'Anything'], 'Strings'],
        evaluate: (ce, ops) =>
          ce.box([
            'LatexString',
            ce.string(joinLatex(ops.map((x) => x.latex))),
          ]),
      },
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: {
        domain: ['FunctionOf', 'Anything', 'Anything'],
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
        domain: 'Functions',
        evaluate: (ce, _ops) => ce.box(randomExpression()),
      },
    },
  },
];

export function canonicalInvisibleOperator(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  if (ops.length === 0) return null;
  const lhs = ops[0];
  if (ops.length === 1) return lhs.canonical;

  if (ops.length === 2) {
    //
    // Is it an implicit addition/mixed fraction, e.g. "3 1/4"
    //
    const lhsNumber = asFloat(lhs);
    if (lhsNumber !== null && Number.isInteger(lhsNumber)) {
      const rhs = ops[1];
      if (rhs.head === 'Divide' || rhs.head === 'Rational') {
        const [n, d] = [asFloat(rhs.op1), asFloat(rhs.op2)];
        if (
          n !== null &&
          d !== null &&
          n > 0 &&
          n <= 1000 &&
          d > 1 &&
          d <= 1000 &&
          Number.isInteger(n) &&
          Number.isInteger(d)
        ) {
          let frac = rhs.canonical;
          if (lhsNumber < 0) frac = frac.neg();

          return ce._fn('Add', [lhs.canonical, frac]);
        }
      }
    }

    //
    // Is it a complex number, i.e. "2i"?
    //
    if (lhsNumber !== null && ops[1].symbol === 'ImaginaryUnit')
      return ce.number(ce.complex(0, lhsNumber));

    //
    // Is it a function application: symbol with a function
    // definition followed by delimiter
    //
    const rhs = ops[1];
    if (
      lhs.symbol &&
      rhs.head === 'Delimiter' &&
      !ce.lookupSymbol(lhs.symbol)
    ) {
      // @fixme: should use symbol table to check if it's a function
      // We have encountered something like `f(a+b)`, where `f` is not
      // defined. But it also could be `x(x+1)` where `x` is a number.
      // So, start with boxing the arguments and see if it makes sense.

      // No arguments, i.e. `f()`? It's a function call.
      if (rhs.nops === 0) {
        if (!ce.lookupFunction(lhs.symbol)) ce.declare(lhs.symbol, 'Functions');
        return ce.box([lhs.symbol]);
      }

      // Parse the arguments first, in case they reference lhs.symbol
      // i.e. `x(x+1)`.
      let args = rhs.op1.head === 'Sequence' ? rhs.op1.ops! : [rhs.op1];
      args = flattenSequence(canonical(args));
      if (!ce.lookupSymbol(lhs.symbol)) {
        // Still not a symbol (i.e. wasn't used as a symbol in the
        // subexpression), so it's a function call.
        if (!ce.lookupFunction(lhs.symbol)) ce.declare(lhs.symbol, 'Functions');
        return ce.function(lhs.symbol, args);
      }
    }

    // Is is an index operation, i.e. "v[1,2]"?
    if (
      lhs.symbol &&
      rhs.head === 'Delimiter' &&
      (rhs.op2.string === '[,]' || rhs.op2.string === '[;]')
    ) {
      const args = rhs.op1.head === 'Sequence' ? rhs.op1.ops! : [rhs.op1];
      return ce._fn('At', [lhs, ...args]);
    }
  }

  // Only call canonical here, because it will bind (auto-declare) the arguments
  ops = flattenSequence(canonical(ops));

  //
  // Is it an invisible multiplication?
  // (are all argument numeric or indexable collections?)
  //
  if (
    ops.every(
      (x) =>
        x.isValid &&
        (!x.domain ||
          x.domain.isNumeric ||
          (isIndexableCollection(x) && !x.string))
    )
  ) {
    ops = flattenOps(ops, 'Multiply');
    if (ops.length === 1) return ops[0];
    return ce._fn('Multiply', [...ops].sort(order));
  }

  //
  // If some of the elements are not numeric (or of unknown domain)
  // group them as a Tuple
  //
  return ce._fn('Tuple', ops);
}
