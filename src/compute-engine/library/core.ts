import type { CanonicalForm, IdentifierDefinitions } from '../public';

import { joinLatex } from '../latex-syntax/tokenizer';

import { checkType, checkArity } from '../boxed-expression/validate';
import { canonicalForm } from '../boxed-expression/canonical';
import type { BoxedExpression } from '../boxed-expression/public';
import { asSmallInteger } from '../boxed-expression/numerics';

import { apply, canonicalFunctionExpression } from '../function-utils';

import { flatten, flattenSequence } from '../boxed-expression/flatten';

import { fromDigits } from '../numerics/strings';

import { randomExpression } from './random-expression';
import { normalizeIndexingSet } from './utils';
import { canonicalInvisibleOperator } from './invisible-operator';
import { canonical } from '../boxed-expression/utils';
import {
  collectionElementType,
  functionResult,
  functionSignature,
  isValidType,
} from '../../common/type/utils';
import { parseType } from '../../common/type/parse';
import { isIndexableCollection } from '../collection-utils';
import { typeToString } from '../../common/type/serialize';

//   // := assign 80 // @todo
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbols() -> return list of all known symbols
// FreeVariables(expr) -> return list of all free variables in expr

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1

export const CORE_LIBRARY: IdentifierDefinitions[] = [
  {
    // The sole member of the unit type, `nothing`
    Nothing: { signature: 'nothing' },
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
     *   but it can be used to represent an "empty" expression. It is a
     *   synonym for `Nothing`.
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
      lazy: true,
      signature: '...any -> any',
      // Note: since the canonical form will be a different operator,
      // no need to calculate the result type
      canonical: canonicalInvisibleOperator,
    },

    /** See above for a theory of operations */
    Sequence: {
      lazy: true,
      signature: '...any -> any',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        if (args.length === 1) return args[0].type;
        // @fixme: need more logic to determine the result type
        return 'any';
      },
      canonical: (args, { engine: ce }) => {
        const xs = flatten(args);
        if (xs.length === 0) return ce.Nothing;
        if (xs.length === 1) return xs[0];
        return ce._fn('Sequence', xs);
      },
    },

    /** See above for a theory of operations */
    Delimiter: {
      // Use to represent groups of expressions.
      // Named after https://en.wikipedia.org/wiki/Delimiter
      complexity: 9000,
      lazy: true,
      signature: '(any, string?) -> any',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return args[0].type;
      },

      canonical: (args, { engine: ce }) => {
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
        if (body.operator === 'Sequence')
          return ce._fn('Tuple', canonical(ce, body.ops!));

        body = body.canonical;

        const delim = args[1]?.string;

        // If we have a single argument and parentheses, i.e. `(2)`, return
        // the argument
        if (!delim || (delim.startsWith('(') && delim.endsWith(')')))
          return body;

        if ((delim?.length ?? 0) > 3) {
          return ce._fn('Delimiter', [
            body,
            ce.error('invalid-delimiter', args[1].toString()),
          ]);
        }

        return ce._fn('Delimiter', [args[0], checkType(ce, args[1], 'string')]);
      },
      evaluate: (ops, options) => {
        const ce = options.engine;
        if (ops.length === 0) return ce.Nothing;

        const op1 = ops[0];

        if (op1.operator === 'Sequence' || op1.operator === 'Delimiter')
          ops = flattenSequence(ops[0].ops!);

        if (ops.length === 1) return ops[0].evaluate(options);

        return ce._fn(
          'Tuple',
          ops.map((x) => x.evaluate(options))
        );
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
      lazy: true,
      complexity: 500,
      signature: '((string|expression), expression?) -> nothing',
      // To make a canonical expression, don't canonicalize the args
      canonical: (args, { engine: ce }) => ce._fn('Error', args),
    },

    ErrorCode: {
      complexity: 500,
      lazy: true,
      signature: '(string, ...any) -> error',
      canonical: (args, { engine: ce }) => {
        const code = checkType(ce, args[0], 'string').string;
        if (code === 'incompatible-domain') {
          return ce._fn('ErrorCode', [ce.string(code), args[1], args[2]]);
        }
        return ce._fn('ErrorCode', args);
      },
    },

    Unevaluated: {
      description: 'Prevent an expression from being evaluated',
      // Unlike Hold, the argument is canonicalized
      lazy: false,
      signature: 'any -> any',
      type: ([x]) => x.type,
      evaluate: ([x]) => x,
    },

    Hold: {
      description:
        'Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it',
      lazy: true,
      signature: 'any -> unknown',
      type: ([x]) => {
        if (x.symbol) return 'symbol';
        if (x.string) return 'string';
        if (x.isNumberLiteral) return x.type;
        if (x.ops) return functionResult(x.type) ?? 'unknown';
        return 'unknown';
      },
      // When comparing hold expressions, consider them equal if their
      // arguments are structurally equal.
      eq: (a, b) => {
        if (b.operator === 'Hold') b = b.ops![0];
        return a.ops![0].isSame(b);
      },
      // By definition, the argument of the canonical expression of
      // `Hold` are not canonicalized.
      canonical: (args, { engine }) =>
        args.length !== 1 ? null : engine.hold(args[0]),
      evaluate: ([x], { engine }) => engine.hold(x),
    },

    ReleaseHold: {
      description: 'Release an expression held by `Hold`',
      lazy: true,
      signature: 'any -> any',
      type: ([x]) => x.type,
      evaluate: ([x], options) => {
        if (x.operator === 'Hold') return x.ops![0].evaluate(options);
        return x.evaluate(options);
      },
    },

    HorizontalSpacing: {
      signature: 'number -> nothing',
      canonical: (args, { engine: ce }) => {
        if (args.length === 2) return args[0].canonical;
        // Returning `Nothing` will make the expression be ignored
        return ce.Nothing;
      },
    },

    Style: {
      complexity: 9000,
      signature: '(expression, ...any) -> expression',
      type: ([x]) => x.type,
      evaluate: ([x]) => x,
      // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x in canonical()
    },
  },
  {
    //
    // Structural operations that can be applied to non-canonical expressions
    //
    About: {
      description: 'Return information about an expression',
      lazy: true,
      signature: 'any -> string',
      evaluate: ([x], { engine: ce }) => {
        const s = [x.toString()];
        s.push(''); // Add a newline

        if (x.string) s.push('string');
        else if (x.symbol) {
          if (x.symbolDefinition) {
            const def = x.symbolDefinition;

            if (def.isConstant) s.push('constant');
            if (def.isFunction) s.push('function');

            if (typeof def.description === 'string') s.push(def.description);
            else if (Array.isArray(def.description))
              s.push(def.description.join('\n'));
            if (def.wikidata) s.push(`WikiData: ${def.wikidata}`);
            if (def.url) s.push(`Read More: ${def.url}`);
          } else {
            s.push('symbol');
            s.push(`value: ${x.evaluate().toString()}`);
          }
        } else if (x.isNumberLiteral) s.push(typeToString(x.type));
        else if (x.ops) {
          s.push(typeToString(x.type));
          s.push(x.isCanonical ? 'canonical' : 'non-canonical');
        } else s.push("Unknown expression's type");
        return ce.string(s.join('\n'));
      },
    },

    Head: {
      description: 'Return the head of an expression, the name of the operator',
      lazy: true,
      signature: 'any -> symbol',
      canonical: (args, { engine: ce }) => {
        // **IMPORTANT** Head should work on non-canonical expressions
        if (args.length !== 1) return null;
        const op1 = args[0];
        if (op1.operator) return ce.box(op1.operator);
        return ce._fn('Head', canonical(ce, args));
      },
      evaluate: (ops, { engine: ce }) =>
        ce.symbol(ops[0]?.operator ?? 'Undefined'),
    },

    Tail: {
      description:
        'Return the tail of an expression, the operands of the expression',
      lazy: true,
      signature: 'any -> collection',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        const op1 = args[0];
        if (op1.ops) return ce._fn('Sequence', op1.ops);
        return ce._fn('Tail', canonical(ce, args));
      },
      // **IMPORTANT** Tail should work on non-canonical expressions
      evaluate: ([x], { engine: ce }) =>
        x?.ops ? ce._fn('Sequence', x.ops) : ce.Nothing,
    },

    Identity: {
      description: 'Return the argument unchanged',
      signature: 'any -> any',
      type: ([x]) => x.type,
      evaluate: ([x]) => x,
    },
  },
  {
    Apply: {
      description: 'Apply a function to a list of arguments',
      signature: '(name:symbol, arguments:...expression) -> any',
      type: ([fn]) => functionResult(fn.type) ?? 'any',
      canonical: (args, { engine: ce }) => {
        if (args[0].symbol) return ce.function(args[0].symbol, args.slice(1));
        return ce._fn('Apply', args);
      },
      evaluate: (ops) => apply(ops[0], ops.slice(1)),
    },

    Assign: {
      description: 'Assign a value to a symbol',
      lazy: true,
      pure: false,
      signature: '(symbol, any) -> any',
      type: ([_symbol, value]) => value.type,
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;
        const op1 = args[0];
        if (!op1.symbol) return null;
        const op2 = args[1];
        return ce._fn('Assign', [op1.canonical, op2.canonical]);
      },
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0];
        const op2 = ops[1];
        if (!op1.symbol) return ce.Nothing;
        const val = op2.evaluate();
        ce.assign(op1.symbol, val);
        return val;
      },
    },

    Assume: {
      description: 'Assume a type for a symbol',
      lazy: true,
      pure: false,
      signature: 'any -> symbol',
      evaluate: (ops, { engine: ce }) => ce.symbol(ce.assume(ops[0])),
    },

    Declare: {
      lazy: true,
      pure: false,
      signature: 'symbol -> any',
      type: ([_symbol, value]) => value.type,
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;
        const op1 = args[0];
        const op2 = args[1];
        if (!op1.symbol) return null;
        if (op2.symbol) return ce._fn('Declare', args);
        return ce._fn('Declare', [op1, ce._fn('Hold', [op2])]);
      },
      evaluate: (ops, { engine: ce }) => {
        const op1 = ops[0];
        const op2 = ops[1];
        if (!op1.symbol) return ce.Nothing;
        const val = op2.evaluate();
        if (!val.string) return undefined;
        const type = parseType(val.string);
        if (!isValidType(type)) return undefined;
        ce.declare(op1.symbol, type);
        return val;
      },
    },

    /** Return the type of an expression */
    Type: {
      lazy: true,
      signature: 'any -> string',
      evaluate: ([x], { engine: ce }) => ce.string(typeToString(x.type)),
    },

    Evaluate: {
      lazy: true,
      signature: 'any -> any',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) =>
        ce._fn('Evaluate', checkArity(ce, ops, 1)),
      evaluate: ([x], options) => x.evaluate(options),
    },

    Function: {
      complexity: 9876,
      lazy: true,
      signature: '(any, ...symbol) -> any',
      type: ([body]) => body.type,
      canonical: (args, { engine: ce }) => {
        // When canonicalizing a function expression, we need to
        // create a new scope and declare all the arguments as
        // variables in that scope.

        if (args.length === 0) return ce.Nothing;

        const canonicalFn = canonicalFunctionExpression(args[0], args.slice(1));
        if (!canonicalFn) return null;

        const body = canonicalFn[0].canonical;
        const params = canonicalFn.slice(1).map((x) => ce.symbol(x as string));

        // If the function has no arguments, it is equivalent to the body
        if (params.length === 0) return body;

        return ce._fn('Function', [body, ...params]);
      },
      evaluate: (_args) => {
        // "evaluating" a function expression is not the same
        // as applying arguments to it.
        // See `function apply()` for that.

        return undefined;
      },
    },

    Simplify: {
      lazy: true,
      signature: 'any -> expression',

      canonical: (ops, { engine: ce }) =>
        ce._fn('Simplify', checkArity(ce, ops, 1)),
      evaluate: ([x]) => x.simplify() ?? undefined,
    },

    CanonicalForm: {
      description: [
        'Return the canonical form of an expression',
        'Can be used to sort arguments of an expression.',
        'Sorting arguments of commutative functions is a weak form of canonicalization that can be useful in some cases, for example to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"',
      ],
      complexity: 8200,
      lazy: true,
      signature: '(any, ...symbol) -> any',
      // Do not canonicalize the arguments, we want to preserve
      // the original form before modifying it
      canonical: (ops) => {
        if (ops.length === 1) return ops[0].canonical;

        const forms = ops
          .slice(1)
          .map((x) => x.symbol ?? x.string)
          .filter((x) => x !== undefined && x !== null) as CanonicalForm[];
        return canonicalForm(ops[0], forms);
      },
    },

    N: {
      description: 'Numerically evaluate an expression',
      lazy: true,
      signature: 'any -> any',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) => {
        // Only call checkArity (which canonicalize) if the
        // argument length is invalid
        if (ops.length !== 1) return ce._fn('N', checkArity(ce, ops, 1));

        const h = ops[0].operator;
        if (h === 'N') return ops[0].canonical;
        if (h === 'Integrate') {
          const { index, lower, upper } = normalizeIndexingSet(ops[0].op2);
          if (!index || lower === undefined || upper === undefined) return null;
          const fn = ops[0].op1;
          return ce._fn('NIntegrate', [
            ce.function('Function', [fn, index]),
            ce.number(lower),
            ce.number(upper),
          ]);
        }
        if (h === 'Limit') return ce._fn('NLimit', ops[0].ops!);

        return ce._fn('N', ops);
      },
      evaluate: ([x]) => x.N(),
    },

    Random: {
      description: [
        'Random(): Return a random number between 0 and 1',
        'Random(n): Return a random integer between 0 and n-1',
        'Random(m, n): Return a random integer between m and n-1',
      ],
      pure: false,
      signature: '(lower:integer?, upper:integer?) -> finite_number',
      type: ([lower, upper]) => {
        if (lower === undefined && upper === undefined) return 'finite_number';
        return 'finite_integer';
      },
      sgn: () => 'non-negative',
      evaluate: (ops, { engine: ce }) => {
        // With no arguments, return a random number between 0 and 1
        if (ops.length === 0) return ce.number(Math.random());

        // If one or more arguments are provided, they must be integers
        // The result will be an integer between the two arguments
        const [lowerOp, upperOp] = ops;
        let lower: number;
        let upper: number;
        if (upperOp === undefined) {
          lower = 0;
          upper = Math.floor(lowerOp.re - 1)!;
          if (isNaN(upper)) upper = 0;
        } else {
          lower = Math.floor(lowerOp.re);
          upper = Math.floor(upperOp.re);
          if (isNaN(lower)) lower = 0;
          if (isNaN(upper)) upper = 0;
        }
        return ce.number(lower + Math.floor(Math.random() * (upper - lower)));
      },
    },

    // @todo: need review
    Signature: {
      lazy: true,
      signature: 'symbol -> string | nothing',
      evaluate: ([x], { engine: ce }) => {
        if (!x.functionDefinition) return ce.Nothing;

        return ce.string(x.functionDefinition.signature.toString());
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
      lazy: true,

      signature: '(collection|string, any) -> any',
      type: ([op1, op2]) => {
        if (op1.string && asSmallInteger(op2) !== null) return 'integer';
        if (op1.isCollection && isIndexableCollection(op1))
          return collectionElementType(op1.type) ?? 'any';
        if (op1.symbol) return 'symbol';
        return 'expression';
      },

      canonical: ([op1, op2], { engine: ce }) => {
        op1 = op1.canonical;
        // Is it a string in a base form:
        // `"deadbeef"_{16}` `"0101010"_2?
        if (op1.string) {
          const base = asSmallInteger(op2.canonical);
          if (base !== null && base > 1 && base <= 36) {
            const [value, rest] = fromDigits(op1.string, base);
            if (rest) {
              return ce.error(['unexpected-digit', rest[0]], op1.toString());
            }
            return ce.number(value);
          }
          return ce._fn('Baseform', [
            op1,
            ce.error(['invalid-base', op2.toString()]),
          ]);
        }

        // Is it a collection?
        if (op1.isCollection && isIndexableCollection(op1))
          return ce._fn('At', [op1, op2.canonical]);

        // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
        if (op1.symbol) {
          const sub =
            op2.string ?? op2.symbol ?? asSmallInteger(op2)?.toString();

          if (sub) return ce.symbol(op1.symbol + '_' + sub);
        }

        if (op2.operator === 'Sequence')
          ce._fn('Subscript', [op1, ce._fn('List', op2.ops!)]);

        return ce._fn('Subscript', [op1, op2]);
      },
    },

    Symbol: {
      complexity: 500,
      description:
        'Construct a new symbol with a name formed by concatenating the arguments',
      threadable: true,
      lazy: true,
      signature: '...any -> any',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return 'symbol';
      },
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.Nothing;
        const arg = ops
          .map(
            (x) => x.symbol ?? x.string ?? asSmallInteger(x)?.toString() ?? ''
          )
          .join('');

        if (arg.length > 0) return ce.symbol(arg);

        return ce.Nothing;
      },
      // Note: a `["Symbol"]` expression is never evaluated, it gets
      // transformed into something else (a symbol) during canonicalization
    },

    Timing: {
      description:
        '`Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation',
      signature:
        '(value, repeat: integer?) -> tuple<result:value, time:number>',
      evaluate: (ops, { engine: ce }) => {
        if (ops[1].symbol === 'Nothing') {
          // Evaluate once
          const start = globalThis.performance.now();
          const result = ops[0].evaluate();
          const timing = 1000 * (globalThis.performance.now() - start);

          return ce.tuple(ce.number(timing), result);
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

        if (sum === 0) return ce.tuple(ce.number(max), result!);
        return ce.tuple(ce.number(sum / timings.length), result!);
      },
    },
  },

  //
  // Wildcards
  //
  {
    Wildcard: {
      signature: 'symbol -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('_');
        return ce.symbol('_' + args[0].symbol);
      },
    },
    WildcardSequence: {
      signature: 'symbol -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('__');
        return ce.symbol('__' + args[0].symbol);
      },
    },
    WildcardOptionalSequence: {
      signature: 'symbol -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('___');
        return ce.symbol('___' + args[0].symbol);
      },
    },
  },

  //
  // LaTeX-related
  //
  {
    LatexString: {
      description:
        'Value preserving type conversion/tag indicating the string is a LaTeX string',
      signature: 'string -> string',
      evaluate: ([s]) => s,
    },

    Latex: {
      description: 'Serialize an expression to LaTeX',
      signature: '...any -> string',
      evaluate: (ops, { engine: ce }) =>
        ce.box(['LatexString', ce.string(joinLatex(ops.map((x) => x.latex)))]),
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: 'string -> any',
      evaluate: ([s], { engine: ce }) => ce.parse(s.string) ?? ce.Nothing,
    },
  },

  {
    RandomExpression: {
      signature: '() -> expression',
      evaluate: (_ops, { engine }) => engine.box(randomExpression()),
    },
  },
];
