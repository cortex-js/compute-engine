import { joinLatex } from '../latex-syntax/tokenizer';

import { checkType, checkArity } from '../boxed-expression/validate';
import { canonicalForm } from '../boxed-expression/canonical';
import { asSmallInteger, toInteger } from '../boxed-expression/numerics';
import {
  addSequenceBaseCase,
  addSequenceRecurrence,
  addMultiIndexBaseCase,
  addMultiIndexRecurrence,
  containsSelfReference,
  extractIndexVariable,
} from '../sequence';

import {
  apply,
  canonicalFunctionLiteral,
  canonicalFunctionLiteralArguments,
} from '../function-utils';

import { flatten, flattenSequence } from '../boxed-expression/flatten';

import { fromDigits } from '../numerics/strings';

import { randomExpression } from './random-expression';
import { canonicalInvisibleOperator } from '../boxed-expression/invisible-operator';
import {
  collectionElementType,
  functionResult,
  isValidType,
} from '../../common/type/utils';
import { parseType } from '../../common/type/parse';
import { canonicalMultiply } from '../boxed-expression/arithmetic-mul-div';
// BoxedDictionary will be dynamically imported to avoid circular dependency
import type {
  Expression,
  SymbolDefinitions,
  CanonicalForm,
} from '../global-types';
import { BoxedString } from '../boxed-expression/boxed-string';
import { canonical } from '../boxed-expression/canonical-utils';
import { isDictionary, isValueDef } from '../boxed-expression/utils';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  sym,
} from '../boxed-expression/type-guards';

//   // := assign 80 // @todo
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbols() -> return list of all known symbols

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1

export const CORE_LIBRARY: SymbolDefinitions[] = [
  {
    // The sole member of the unit type, `nothing`
    Nothing: { type: 'nothing' },
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
      signature: 'function',
      // Note: since the canonical form will be a different operator,
      // no need to calculate the result type
      canonical: (x, { engine }) => {
        // The `canonicalInvisibleOperator` function will return only
        // canonicalization for the invisible operator, not for any operators
        // it may turn into.
        // This is necessary for `1(2+3)` to be correctly canonicalized to `2+3`.
        const y = canonicalInvisibleOperator(x, { engine });
        if (!y) return engine.Nothing;
        if (isFunction(y, 'Multiply')) return canonicalMultiply(engine, y.ops);
        return y;
      },
    },

    /** See above for a theory of operations */
    Sequence: {
      lazy: true,
      signature: 'function',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        if (args.length === 1) return args[0].type;
        return parseType(`tuple<${args.map((a) => a.type).join(', ')}>`);
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
        if (isFunction(body, 'Sequence'))
          return ce._fn('Tuple', canonical(ce, body.ops));

        body = body.canonical;

        const delim = isString(args[1]) ? args[1].string : undefined;

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

        if (
          (op1.operator === 'Sequence' || op1.operator === 'Delimiter') &&
          isFunction(ops[0])
        )
          ops = flattenSequence(ops[0].ops);

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
      signature: '((string|expression<ErrorCode>), expression?) -> nothing',
      // To make a canonical expression, don't canonicalize the args
      canonical: (args, { engine: ce }) => ce._fn('Error', args),
    },

    ErrorCode: {
      complexity: 500,
      lazy: true,
      signature: '(string, any*) -> error',
      canonical: (args, { engine: ce }) => {
        const checked = checkType(ce, args[0], 'string');
        const code = isString(checked) ? checked.string : undefined;
        if (code === 'incompatible-type') {
          return ce._fn('ErrorCode', [ce.string(code), args[1], args[2]]);
        }
        return ce._fn('ErrorCode', args);
      },
    },

    Unevaluated: {
      description: 'Prevent an expression from being evaluated',
      // Unlike Hold, the argument is canonicalized
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      canonical: (args, { engine: ce, scope }) =>
        ce._fn('Unevaluated', canonical(ce, args, scope)),
      evaluate: ([x], options) => x.evaluate(options),
    },

    Hold: {
      description:
        'Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it',
      lazy: true,
      signature: '(any) -> unknown',
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized.
      type: ([x]) => {
        if (isSymbol(x)) return 'symbol';
        if (isString(x)) return 'string';
        if (isNumber(x)) return x.type;
        if (isFunction(x)) return functionResult(x.type.type) ?? 'unknown';
        return 'unknown';
      },
      // When comparing hold expressions, consider them equal if their
      // arguments are structurally equal.
      eq: (a, b) => {
        if (isFunction(b, 'Hold')) b = b.ops[0];
        if (!isFunction(a)) return false;
        return a.ops[0].isSame(b);
      },
      evaluate: ([x], { engine }) => engine.hold(x),
    },

    ReleaseHold: {
      description: 'Release an expression held by `Hold`',
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => (isFunction(x, 'Hold') ? x.op1.type : x.type),
      // Note: the operator is lazy and doesn't have a canonical handler:
      // the argument is not canonicalized.
      evaluate: ([x], options) => {
        if (isFunction(x, 'Hold')) x = x.op1;
        return x.canonical.evaluate(options);
      },
    },

    HorizontalSpacing: {
      signature: '(number) -> nothing',
      canonical: (args, { engine: ce }) => {
        if (args.length === 2) return args[0].canonical;
        // Returning `Nothing` will make the expression be ignored
        return ce.Nothing;
      },
    },

    Annotated: {
      signature: '(expression, dictionary) -> expression',
      type: ([x]) => x.type,
      complexity: 9000,
      lazy: true,
      canonical: ([x, style], { engine: ce }) => {
        x = x.canonical;
        style = style.canonical;

        // Is the style dictionary empty?
        if (!isDictionary(style) || style.keys.length === 0) return x;

        return ce._fn('Annotated', [x, style]);
      },
      evaluate: ([x, _style], options) => x.evaluate(options),
      // xcompile: (expr) => expr.op1.compile(),
    },

    Text: {
      description:
        'A sequence of strings, annotated expressions and other Text expressions',
      signature: '(any*) -> expression',
    },
  },
  {
    //
    // Structural operations that can be applied to non-canonical expressions
    //
    About: {
      description: 'Return information about an expression',
      lazy: true,
      signature: '(any) -> string',
      evaluate: ([x], { engine: ce }) => {
        const s = [x.toString()];
        s.push(''); // Add a newline

        if (isString(x)) s.push('string');
        else if (isSymbol(x)) {
          if (x.valueDefinition) {
            const def = x.valueDefinition;

            if (def.isConstant) s.push('constant');

            if (typeof def.description === 'string') s.push(def.description);
            else if (Array.isArray(def.description))
              s.push(def.description.join('\n'));
            if (def.wikidata) s.push(`WikiData: ${def.wikidata}`);
            if (def.url) s.push(`Read More: ${def.url}`);
          } else {
            s.push('symbol');
            s.push(`value: ${x.evaluate().toString()}`);
          }
        } else if (isNumber(x)) s.push(x.type.toString());
        else if (isFunction(x)) {
          s.push(x.type.toString());
          s.push(x.isCanonical ? 'canonical' : 'non-canonical');
        } else s.push("Unknown expression's type");
        return ce.string(s.join('\n'));
      },
    },

    Head: {
      description: 'Return the head of an expression, the name of the operator',
      lazy: true,
      signature: '(any) -> symbol',
      canonical: (args, { engine: ce }) => {
        // **IMPORTANT** Head should work on non-canonical expressions
        if (args.length !== 1) return null;
        const op1 = args[0];
        return ce.box(op1.operator);
      },
      evaluate: (ops, { engine: ce }) =>
        ce.symbol(ops[0]?.operator ?? 'Undefined'),
    },

    Tail: {
      description:
        'Return the tail of an expression, the operands of the expression',
      lazy: true,
      signature: '(any) -> collection',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return null;
        const op1 = args[0];
        if (isFunction(op1)) return ce._fn('Sequence', op1.ops);
        return ce._fn('Tail', canonical(ce, args));
      },
      // **IMPORTANT** Tail should work on non-canonical expressions
      evaluate: ([x], { engine: ce }) =>
        isFunction(x) ? ce._fn('Sequence', x.ops) : ce.Nothing,
    },

    Identity: {
      description: 'Return the argument unchanged',
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      evaluate: ([x]) => x,
    },
  },
  {
    Apply: {
      description: 'Apply a function to a list of arguments',
      signature: '(name:symbol, arguments:expression*) -> unknown',
      type: ([fn]) => functionResult(fn.type.type) ?? 'unknown',
      canonical: (args, { engine: ce }) => {
        const s = sym(args[0]);
        if (s) return ce.function(s, args.slice(1));
        return ce._fn('Apply', args);
      },
      evaluate: (ops) => apply(ops[0], ops.slice(1)),
    },

    Assign: {
      description: 'Assign a value to a symbol or define a sequence',
      lazy: true,
      pure: false,
      signature: '(symbol | expression, any) -> any',
      type: ([_symbol, value]) => value.type,
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return null;

        // Check if LHS is a Subscript expression (for sequence definitions)
        // e.g., ['Subscript', 'L', 0] or ['Subscript', 'a', 'n']
        // Preserve both LHS and RHS as non-canonical to avoid single-letter
        // symbols being canonicalized to known constants (e.g., "G" →
        // "CatalanConstant", "i" → "ImaginaryUnit"). The evaluate handler
        // needs the raw symbol names for sequence registration and
        // self-reference detection.
        const lhs = args[0];
        if (isFunction(lhs, 'Subscript')) {
          return ce._fn('Assign', [lhs, args[1]]);
        }

        // Note: we can't use checkType() because it canonicalized/bind the argument.
        let symbol = lhs;
        if (!isSymbol(symbol)) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbol = checkType(ce, lhs, 'symbol');
        }

        return ce._fn('Assign', [symbol, args[1].canonical]);
      },
      evaluate: ([op1, op2], { engine: ce }) => {
        //
        // Check for Subscript LHS (sequence definition)
        // e.g., Subscript(L, 0) := 1  OR  Subscript(a, n) := a_{n-1} + 1
        // Also handles multi-index: Subscript(P, Sequence(n, k)) := ...
        //
        if (isFunction(op1, 'Subscript') && sym(op1.op1)) {
          const seqName = sym(op1.op1)!;
          const subscript = op1.op2;

          //
          // Check for multi-index subscript: P_{n,k}
          // Parser produces: Subscript(P, Sequence(n, k))
          // When non-canonical, it may be wrapped in Delimiter:
          //   Subscript(P, Delimiter(Sequence(n, k), ","))
          //
          let multiSub = subscript;
          if (isFunction(multiSub, 'Delimiter')) multiSub = multiSub.op1;
          if (isFunction(multiSub, 'Sequence')) {
            const subscript = multiSub;
            const indices = subscript.ops;

            // Case M1: All numeric → multi-index base case
            // e.g., P_{0,0} := 1
            if (
              indices.every((op) => isNumber(op) && Number.isInteger(op.re))
            ) {
              const key = indices.map((op) => op.re).join(',');
              addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
              return ce.Nothing;
            }

            // Extract variable names from indices
            // For symbols: use the symbol name
            // For numbers: use the number as string
            // For expressions: try to extract the variable
            const indexVars: string[] = [];
            let hasSymbols = false;
            let allValid = true;

            for (const idx of indices) {
              if (isSymbol(idx)) {
                indexVars.push(idx.symbol);
                hasSymbols = true;
              } else if (isNumber(idx) && Number.isInteger(idx.re)) {
                indexVars.push(String(idx.re));
              } else {
                // Complex expression - try to extract variable
                const v = extractIndexVariable(idx);
                if (v) {
                  indexVars.push(v);
                  hasSymbols = true;
                } else {
                  allValid = false;
                  break;
                }
              }
            }

            if (allValid && indexVars.length === indices.length) {
              if (containsSelfReference(op2, seqName)) {
                // Case M2: Recurrence with self-reference
                // e.g., P_{n,k} := P_{n-1,k-1} + P_{n-1,k}
                // Only use symbol variables for the recurrence
                const recurrenceVars = indices
                  .map((idx) => sym(idx))
                  .filter((s): s is string => s !== undefined);

                if (recurrenceVars.length > 0) {
                  addMultiIndexRecurrence(ce, seqName, recurrenceVars, op2);
                  return ce.Nothing;
                }
              } else if (hasSymbols) {
                // Case M3: Pattern base case (no self-reference)
                // e.g., P_{n,0} := 1 or P_{n,n} := 1
                const key = indexVars.join(',');
                addMultiIndexBaseCase(ce, seqName, key, op2.evaluate());
                return ce.Nothing;
              }
            }

            // Fallback for multi-index: if we couldn't handle it, continue
          }

          // Case 1: Numeric subscript → base case
          // e.g., L_0 := 1, F_1 := 1
          if (isNumber(subscript) && Number.isInteger(subscript.re)) {
            const index = subscript.re;
            const value = op2.evaluate();
            addSequenceBaseCase(ce, seqName, index, value);
            return ce.Nothing;
          }

          // Case 2: Symbol subscript → check for self-reference
          // e.g., a_n := a_{n-1} + 1  vs  f_n := 2*n + 1
          if (isSymbol(subscript)) {
            const indexVar = subscript.symbol;

            if (containsSelfReference(op2, seqName)) {
              // Sequence recurrence definition
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            } else {
              // Function definition (no self-reference)
              // Convert to: f(n) := expr
              const fnDef = ce.function('Function', [op2, ce.symbol(indexVar)]);
              ce.assign(seqName, fnDef);
              return ce.Nothing;
            }
          }

          // Case 3: Complex subscript → check for self-reference
          // e.g., a_{n+1} := a_n + 1
          if (containsSelfReference(op2, seqName)) {
            const indexVar = extractIndexVariable(subscript!);
            if (indexVar) {
              addSequenceRecurrence(ce, seqName, indexVar, op2);
              return ce.Nothing;
            }
          }

          // Fallback: treat as regular assignment to compound symbol
          // This shouldn't normally happen with well-formed input
        }

        // Regular symbol assignment
        const symbol = op1.evaluate();
        const symbolName = sym(symbol);
        if (!symbolName) return undefined;
        const val = op2.evaluate();
        ce.assign(symbolName, val);
        return val;
      },
    },

    Assume: {
      description: 'Assume a type for a symbol',
      lazy: true,
      pure: false,
      signature: '(any) -> symbol',
      evaluate: (ops, { engine: ce }) => ce.symbol(ce.assume(ops[0])),
    },

    Declare: {
      lazy: true,
      pure: false,
      signature: '(symbol, type: string | symbol) -> nothing',
      canonical: (args, { engine: ce }) => {
        // Note: we can't use checkType() because it canonicalized/bind the argument.
        let symbolExpr = args[0];
        if (!isSymbol(symbolExpr)) {
          // If the argument was not a symbol literal, see if we can evaluate it to a symbol
          symbolExpr = checkType(ce, args[0], 'symbol');
        }

        if (args.length === 1) return ce._fn('Declare', [symbolExpr]);

        if (args.length !== 2) return null;

        return ce._fn('Declare', [symbolExpr, args[1]]);
      },
      evaluate: (ops, { engine: ce }) => {
        const symbolName = sym(ops[0].evaluate());
        if (!symbolName) return undefined;

        if (!ops[1]) {
          ce.declare(symbolName, { inferred: true, type: 'unknown' });
          return ce.Nothing;
        }

        const t = ops[1].canonical.evaluate();

        const type = parseType(
          (isString(t) ? t.string : undefined) ?? sym(t) ?? undefined
        );
        if (!isValidType(type)) return undefined;

        ce.declare(symbolName, type);
        return ce.Nothing;
      },
    },

    /** Return the type of an expression */
    Type: {
      lazy: true,
      signature: '(any) -> string',
      evaluate: ([x], { engine: ce }) =>
        ce.string(x.type.toString() ?? 'unknown'),
    },

    Evaluate: {
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) =>
        ce._fn('Evaluate', checkArity(ce, ops, 1)),
      evaluate: ([x], options) => x.evaluate(options),
    },

    // Evaluate an expression at a specific point, potentially symbolically
    // i.e. it's the `f|_{a}` notation
    EvaluateAt: {
      lazy: true,
      signature: '(function, lower:number, upper:number) -> number',
      type: ([x]) => functionResult(x.type.type) ?? 'number',
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return null;
        const fn = canonicalFunctionLiteral(ops[0]);
        if (!fn) return null;
        return ce._fn('EvaluateAt', [
          fn,
          ...ops.slice(1).map((x) => checkType(ce, x, 'value')),
        ]);
      },
      evaluate: ([f, lower, upper], { engine: ce }) => {
        if (upper === undefined) {
          //
          // f|_a
          //
          // Let's try to evaluate the function
          const result = apply(f, [lower]);

          // If we did get a number, return it
          if (isNumber(result)) return result;

          // Fallback: return unevaluated symbolic form
          return ce._fn('EvaluateAt', [f, lower]);
        }

        //
        // f|_a^b = f(b) - f(a)
        //
        // Let's try to evaluate the function
        const fLower = apply(f, [lower]);
        const fUpper = apply(f, [upper]);
        if (fLower && fUpper && isNumber(fLower.N()) && isNumber(fUpper.N())) {
          return fUpper.sub(fLower);
        }
        // Fallback: return unevaluated symbolic form
        return ce._fn('EvaluateAt', [f, lower, upper]);
      },
    },

    BuiltinFunction: {
      complexity: 9876,
      lazy: true,
      signature: '(symbol | string) -> symbol',
      canonical: ([symbolArg], { engine: ce }) =>
        ce.symbol(
          sym(symbolArg) ??
            (isString(symbolArg) ? symbolArg.string : undefined) ??
            'Undefined'
        ),
    },

    Function: {
      description: 'A function literal',
      complexity: 9876,
      lazy: true,
      signature: '(expression, symbol*) -> function',
      type: ([body, ...args]) =>
        `(${args.map((x) => x.type.type)}) -> ${body.type.type}`,

      canonical: (args, { engine }) =>
        canonicalFunctionLiteralArguments(engine, args) ?? null,

      evaluate: (_args) => {
        // "evaluating" a function literal is not the same as applying
        // arguments to it.
        // See `function apply()` for that.

        return undefined;
      },
    },

    Rule: {
      lazy: true,
      signature:
        '(match: expression, replace: expression, predicate: function?) -> expression',
      evaluate: ([_match, _replace, _predicate], { engine: _ce }) => {
        return undefined;
      },
    },

    Simplify: {
      lazy: true,
      signature: '(any) -> expression',

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
      signature: '(any, symbol*) -> any',
      // Do not canonicalize the arguments, we want to preserve
      // the original form before modifying it
      canonical: (ops) => {
        if (ops.length === 1) return ops[0].canonical;

        const forms = ops
          .slice(1)
          .map((x) => sym(x) ?? (isString(x) ? x.string : undefined))
          .filter((x) => x !== undefined) as CanonicalForm[];
        return canonicalForm(ops[0], forms);
      },
    },

    N: {
      description: 'Numerically evaluate an expression',
      lazy: true,
      signature: '(any) -> unknown',
      type: ([x]) => x.type,
      canonical: (ops, { engine: ce }) => {
        // Only call checkArity (which canonicalize) if the
        // argument length is invalid
        if (ops.length !== 1) return ce._fn('N', checkArity(ce, ops, 1));

        const h = ops[0].operator;
        if (h === 'N' || h === 'Evaluate') return ops[0].canonical;

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
      signature: '(symbol) -> string | nothing',
      evaluate: ([x], { engine: ce }) => {
        if (!x.operatorDefinition) return ce.Nothing;

        return ce.string(x.operatorDefinition.signature.toString());
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

      signature: '(collection, any) -> any',
      type: ([op1, op2], { engine: ce }) => {
        if (isString(op1) && asSmallInteger(op2) !== null) return 'integer';
        if (op1.isIndexedCollection)
          return collectionElementType(op1.type.type) ?? 'any';

        // Check if the symbol is declared as a collection type
        const op1Name = sym(op1);
        if (op1Name) {
          const eltType = collectionElementType(op1.type.type);
          if (eltType) return eltType;
        }

        // For symbol bases with complex subscripts (like a_{n+1}), return 'unknown'
        // to allow type inference in arithmetic contexts. Simple subscripts
        // (like a_n) are converted to compound symbols during canonicalization
        // and won't reach this type function.
        if (op1Name) {
          // If the base symbol has subscriptEvaluate, the result will be a number
          // (or undefined, which keeps it as Subscript)
          const symbolDef = ce.lookupDefinition(op1Name);
          if (isValueDef(symbolDef) && symbolDef.value.subscriptEvaluate) {
            return 'number';
          }
          // Check if this would become a compound symbol (simple subscript)
          const sub =
            (isString(op2) ? op2.string : undefined) ??
            sym(op2) ??
            asSmallInteger(op2)?.toString();
          if (sub) return 'symbol';
          // Check for InvisibleOperator of symbols/numbers (also becomes compound symbol)
          if (isFunction(op2, 'InvisibleOperator')) {
            const parts = op2.ops.map(
              (x) => sym(x) ?? asSmallInteger(x)?.toString()
            );
            if (parts.every((p) => p !== undefined && p !== null))
              return 'symbol';
          }
          // Complex subscript - return 'unknown' to allow numeric inference
          return 'unknown';
        }
        return 'expression';
      },

      canonical: ([op1, op2], { engine: ce }) => {
        // Save the raw symbol name BEFORE canonicalization, so that
        // `i` stays `i` (not `ImaginaryUnit`) and `e` stays `e`
        // (not `ExponentialE`) when creating compound symbols.
        const rawName = sym(op1);

        op1 = op1.canonical;
        // Is it a string in a base form:
        // `"deadbeef"_{16}` `"0101010"_2?
        if (isString(op1)) {
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

        // Is it a collection expression (like a list literal)?
        if (op1.isIndexedCollection) return ce._fn('At', [op1, op2.canonical]);

        // Is it a symbol declared as a collection type?
        // If so, convert to At() for indexing
        const op1Name = sym(op1);
        if (op1Name && collectionElementType(op1.type.type)) {
          // For multi-index subscripts (Sequence/Tuple), pass each index as separate arg
          if (
            (op2.operator === 'Sequence' || op2.operator === 'Tuple') &&
            isFunction(op2)
          )
            return ce._fn('At', [op1, ...op2.ops.map((x) => x.canonical)]);
          return ce._fn('At', [op1, op2.canonical]);
        }

        // If the base symbol has a subscriptEvaluate handler, keep as Subscript
        // so the evaluate handler can call it (don't create compound symbol)
        if (op1Name) {
          const symbolDef = ce.lookupDefinition(op1Name);
          if (isValueDef(symbolDef) && symbolDef.value.subscriptEvaluate) {
            return ce._fn('Subscript', [op1, op2.canonical]);
          }
        }

        // Is it a compound symbol `x_\operatorname{max}`, `\mu_0`
        // Use rawName (pre-canonical) so `i_A` doesn't become `ImaginaryUnit_A`
        if (rawName) {
          const subStr =
            (isString(op2) ? op2.string : undefined) ??
            sym(op2) ??
            asSmallInteger(op2)?.toString();

          if (subStr) return ce.symbol(rawName + '_' + subStr);

          // If subscript is an InvisibleOperator of symbols/numbers (not wrapped
          // in a Delimiter), concatenate them to form a compound symbol name.
          // e.g., `A_{CD}` -> `A_CD`, `x_{ij}` -> `x_ij`, `T_{max}` -> `T_max`
          // Use parentheses for expressions: `A_{(CD)}` remains as subscript expression.
          if (isFunction(op2, 'InvisibleOperator')) {
            const parts = op2.ops.map(
              (x) => sym(x) ?? asSmallInteger(x)?.toString()
            );
            if (parts.every((p) => p !== undefined && p !== null)) {
              return ce.symbol(rawName + '_' + parts.join(''));
            }
          }
        }

        if (isFunction(op2, 'Sequence'))
          ce._fn('Subscript', [op1, ce._fn('List', op2.ops)]);

        // Unwrap Delimiter (parentheses) from the subscript expression
        // e.g., `A_{(n+1)}` -> `["Subscript", "A", ["Add", "n", 1]]`
        let sub = op2;
        if (isFunction(op2, 'Delimiter')) sub = op2.op1.canonical;

        return ce._fn('Subscript', [op1, sub]);
      },

      evaluate: (ops, { engine: ce, numericApproximation }) => {
        const [base, subscript] = ops;

        // Check if base is a symbol with a subscriptEvaluate handler
        if (isSymbol(base)) {
          const def = base.valueDefinition;
          if (def?.subscriptEvaluate) {
            // Evaluate the subscript first
            const evalSubscript = subscript.evaluate({ numericApproximation });

            // Call the custom handler
            const result = def.subscriptEvaluate(evalSubscript, {
              engine: ce,
              numericApproximation,
            });

            // If handler returned a result, use it
            if (result !== undefined) return result;
          }
        }

        // Fallback: return undefined to keep expression symbolic
        return undefined;
      },
    },

    Symbol: {
      complexity: 500,
      description:
        'Construct a new symbol with a name formed by concatenating the arguments',
      broadcastable: true,
      lazy: true,
      signature: 'function',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return 'symbol';
      },
      canonical: (ops, { engine: ce }) => {
        if (ops.length === 0) return ce.Nothing;

        // Do not canonicalized any symbol, i.e.
        // ["Symbol", "x"] should not cause the symbol "x" to be
        // declared in the current context.
        return ce._fn(
          'Symbol',
          ops.map((x) => (isSymbol(x) ? x : x.canonical))
        );
      },
      evaluate: (ops, { engine: ce }) => {
        console.assert(ops.length > 0);
        const arg = ops
          .map(
            (x) =>
              sym(x) ??
              (isString(x) ? x.string : undefined) ??
              asSmallInteger(x)?.toString() ??
              ''
          )
          .join('');

        // We canonicalize the symbol in the current
        // context. This allows the symbol to be interpreted as if dynamically scoped, not lexically scoped (lexical vs dynamic scoping)
        // let x = 5;
        // f := () |-> x
        // {
        //  x := 10;
        //  f()
        // }
        // This will return 5. But:
        // let x = 5;
        // f := () |-> Symbol(x)
        // {
        //  x := 10;
        //  f()
        // }
        // will return 10;
        return ce.symbol(arg);
      },
    },

    Timing: {
      description:
        '`Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation',
      signature:
        '(value, repeat: integer?) -> tuple<result:value, time:number>',
      evaluate: (ops, { engine: ce }) => {
        if (sym(ops[1]) === 'Nothing') {
          // Evaluate once
          const start = globalThis.performance.now();
          const result = ops[0].evaluate();
          const timing = 1000 * (globalThis.performance.now() - start);

          return ce.tuple(ce.number(timing), result);
        }

        // Evaluate multiple times
        let n = Math.max(3, toInteger(ops[1]) ?? 3);

        let timings: number[] = [];
        let result: Expression;
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
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('_');
        return ce.symbol('_' + (sym(args[0]) ?? ''));
      },
    },
    WildcardSequence: {
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('__');
        return ce.symbol('__' + (sym(args[0]) ?? ''));
      },
    },
    WildcardOptionalSequence: {
      signature: '(symbol) -> symbol',
      canonical: (args, { engine: ce }) => {
        if (args.length !== 1) return ce.symbol('___');
        return ce.symbol('___' + (sym(args[0]) ?? ''));
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
      signature: '(string) -> string',
      evaluate: ([s]) => s,
    },

    Latex: {
      description: 'Serialize an expression to LaTeX',
      signature: '(any+) -> string',
      evaluate: (ops, { engine: ce }) =>
        ce.box(['LatexString', ce.string(joinLatex(ops.map((x) => x.latex)))]),
    },

    Parse: {
      description:
        'Parse a LaTeX string and evaluate to a corresponding expression',
      signature: '(string) -> any',
      evaluate: ([s], { engine: ce }) =>
        ce.parse(isString(s) ? s.string : '') ?? ce.Nothing,
    },
  },

  //
  // String
  //
  {
    // This is a string interpolation function
    String: {
      description:
        'A string created by joining its arguments. The arguments are converted to their default string representation.',
      broadcastable: true,
      signature: '(any*) -> string',
      evaluate: (ops, { engine }) => {
        if (ops.length === 0) return engine.string('');
        return engine.string(ops.map((x) => x.toString()).join(''));
      },
    },

    // Converts arguments interpreted in a specified format to a string.
    StringFrom: {
      description:
        'Create a string by converting its arguments to a string and joining them.',
      broadcastable: true,
      signature: '(any, format:string?) -> string',
      evaluate: ([value, format], { engine }) => {
        if (value === undefined) return engine.string('');
        const fmt = (isString(format) ? format.string : undefined) ?? 'default';

        if (fmt === 'default') return engine.string(value.toString());

        if (fmt === 'utf-8') {
          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-8').decode(
              new Uint8Array(
                [...value.each()].map((x) => toInteger(x) ?? 0xfffd)
              )
            )
          );
        }

        if (fmt === 'utf-16') {
          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>'),
              value.type
            );
          }
          return engine.string(
            new TextDecoder('utf-16').decode(
              new Uint16Array(
                [...value.each()].map((x) => toInteger(x) ?? 0xfffd)
              )
            )
          );
        }

        if (fmt === 'unicode-scalars') {
          const cp = toInteger(value);
          if (cp !== null) return engine.string(String.fromCodePoint(cp));

          if (!value.isIndexedCollection) {
            return engine.typeError(
              parseType('indexed_collection<integer>|integer'),
              value.type
            );
          }
          return engine.string(
            String.fromCodePoint(
              ...[...value.each()].map((x) => toInteger(x) ?? 0xfffd)
            )
          );
        }

        return engine.string(value.toString());
      },
    },

    Utf8: {
      description: 'A collection of UTF-8 code units from a string.',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const utf8Buffer = (str as BoxedString).buffer;
        // Convert the Uint8Array to a list of integers
        return engine.function(
          'List',
          Array.from(utf8Buffer, (code) => engine.number(code))
        );
      },
    },

    Utf16: {
      description: 'A collection of UTF-16 code units from a string.',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const utf16Values: number[] = [];
        // Convert the string to a list of Unicode scalars
        for (let i = 0; i < str.string.length; i++) {
          const codePoint = str.string.charCodeAt(i)!;
          utf16Values.push(codePoint);
        }
        return engine.function(
          'List',
          utf16Values.map((cp) => engine.number(cp!))
        );
      },
    },

    UnicodeScalars: {
      description:
        'A collection of Unicode scalars from a string, same as UTF-32',
      signature: '(string) -> list<integer>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        const codePoints = (str as BoxedString).unicodeScalars;
        return engine.function(
          'List',
          codePoints.map((cp) => engine.number(cp))
        );
      },
    },

    GraphemeClusters: {
      description: 'A collection of grapheme clusters from a string.',
      signature: '(string) -> list<string>',
      evaluate: ([str], { engine }) => {
        if (!isString(str)) return undefined;
        // Use Intl.Segmenter to split the string into grapheme clusters
        const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
        const graphemes = Array.from(segmenter.segment(str.string), (seg) =>
          engine.string(seg.segment)
        );
        return engine.function('List', graphemes);
      },
    },

    BaseForm: {
      description: '`BaseForm(expr, base=10)`',
      complexity: 9000,
      signature: '(number, (string|integer)?) -> string | nothing',
      type: ([x]) => (x === undefined ? 'nothing' : x.type),
      evaluate: ([x]) => x,
    },

    DigitsFrom: {
      description: `Return an integer representation of the string \`s\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output

      signature: '(string, (string|integer)?) -> integer',

      evaluate: (ops, { engine }) => {
        let op1str = isString(ops[0]) ? ops[0].string : undefined;
        const ce = engine;
        if (!op1str) return ce.typeError('string', ops[0]?.type, ops[0]);

        op1str = op1str.trim();

        if (op1str.startsWith('0x'))
          return ce.number(parseInt(op1str.slice(2), 16));

        if (op1str.startsWith('0b'))
          return ce.number(parseInt(op1str.slice(2), 2));

        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing')
          return ce.number(Number.parseInt(op1str, 10));

        const base = op2.re;
        if (!op2.isInteger || !Number.isFinite(base) || base < 2 || base > 36)
          return ce.error(['unexpected-base', base.toString()], op2.toString());

        const [value, rest] = fromDigits(
          op1str,
          (isString(op2) ? op2.string : undefined) ?? sym(op2) ?? 10
        );

        if (rest) return ce.error(['unexpected-digit', rest[0]], rest);

        return ce.number(value);
      },
    },

    IntegerString: {
      description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
      // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
      // @todo could accept "roman"... as base
      // @todo could accept optional third parameter as the (padded) length of the output
      broadcastable: true,
      signature: '(integer, integer?) -> string',
      evaluate: (ops, { engine }) => {
        const ce = engine;
        const op1 = ops[0];
        if (!op1.isInteger) return ce.typeError('integer', op1.type, op1);

        const val = op1.re;
        if (!Number.isFinite(val))
          return ce.typeError('integer', op1.type, op1);

        const op2 = ops[1] ?? ce.Nothing;
        if (sym(op2) === 'Nothing') {
          if (op1.bignumRe !== undefined)
            return ce.string(op1.bignumRe.abs().toString());
          return ce.string(Math.abs(val).toString());
        }

        const base = asSmallInteger(op2);
        if (base === null) return ce.typeError('integer', op2.type, op2);

        if (base < 2 || base > 36)
          return ce.error(
            ['out-of-range', '2', '36', base.toString()],
            op2.toString()
          );

        return ce.string(Math.abs(val).toString(base));
      },
    },
  },
  {
    RandomExpression: {
      signature: '() -> expression',
      evaluate: (_ops, { engine }) => engine.box(randomExpression()),
    },
  },
];
