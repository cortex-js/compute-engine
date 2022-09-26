import { BoxedExpression, SymbolTable } from '../public';
import { joinLatex, tokenize } from '../latex-syntax/tokenizer';
import { fromDigits } from '../numerics/numeric';

//   // := assign 80 // @todo

export const CORE_LIBRARY: SymbolTable[] = [
  {
    symbols: [
      // { name: 'Missing', domain: 'Anything' },
      { name: 'Nothing', domain: 'Nothing' },
    ],
  },
  //
  // Data Structures
  //
  {
    functions: [
      {
        name: 'KeyValuePair',
        description: 'A key/value pair',
        complexity: 8200,
        signature: {
          domain: [
            'Function',
            'String',
            'Anything',
            ['Tuple', 'String', 'Anything'],
          ],
          codomain: (ce, args) => ce.domain(['Tuple', 'String', args[1]]),
          canonical: (ce, args) => ce.tuple(args),
        },
      },
      {
        name: 'Single',
        description: 'A tuple with a single element',
        complexity: 8200,
        signature: {
          domain: ['Function', 'Anything', ['Tuple', 'Anything']],
          codomain: (ce, args) => ce.domain(['Tuple', args[0]]),
          canonical: (ce, args) => ce.tuple(args),
        },
      },
      {
        name: 'Pair',
        description: 'A tuple of two elements',
        complexity: 8200,
        signature: {
          domain: [
            'Function',
            'Anything',
            'Anything',
            ['Tuple', 'Anything', 'Anything'],
          ],

          codomain: (ce, args) => ce.domain(['Tuple', args[0], args[1]]),
          canonical: (ce, args) => ce.tuple(args),
        },
      },
      {
        name: 'Triple',
        description: 'A tuple of three elements',
        complexity: 8200,
        signature: {
          domain: [
            'Function',
            'Anything',
            'Anything',
            'Anything',
            ['Tuple', 'Anything', 'Anything', 'Anything'],
          ],

          codomain: (ce, args) =>
            ce.domain(['Tuple', args[0], args[1], args[2]]),
          canonical: (ce, args) => ce.tuple(args),
        },
      },
      {
        name: 'Tuple',
        description: 'A fixed number of heterogeneous elements',
        complexity: 8200,
        signature: {
          domain: [
            'Function',
            ['Sequence', 'Anything'],
            ['Tuple', ['Sequence', 'Anything']],
          ],
          codomain: (ce, args) => ce.domain(['Tuple', ...args]),
        },
      },
    ],
  },
  //
  // Inert functions
  //
  {
    functions: [
      {
        name: 'BaseForm',
        description: '`BaseForm(expr, base=10)`',
        complexity: 9000,
        inert: true,
        signature: {
          domain: ['Function', 'Value', ['Maybe', 'Integer'], 'Value'],
          codomain: (_ce, args) => args[0],
        },
      },
      {
        // Use to represent groups of expressions. Named after https://en.wikipedia.org/wiki/Delimiter
        name: 'Delimiter',
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
          codomain: (_ce, args) => args[0],
          canonical: (_ce, args) => args[0].canonical,
        },
      },
      {
        /**
         * - The first argument is an expression that indicates a partial
         * success, or a suitable substitution. If no substitution is possible,
         * the `Nothing` symbol is used. `NaN`, `0` and `1` are other popular
         * choices.
         * - The second argument indicates the reason for the error. It is
         * an expression that evaluates to a string
         * - The third argument, if present, indicates the context/location
         * of the error. If the error occur while parsing a LaTeX string,
         * for example, the argument will be a `Latex` expression.
         */
        name: 'Error',
        complexity: 500,
        inert: true,
        signature: {
          domain: ['Function', 'Anything', ['Maybe', 'Anything'], 'Void'],
        },
      },
      {
        name: 'Error-code',
        complexity: 500,
        inert: true,
        signature: {
          domain: [
            'Function',
            'Anything',
            ['Maybe', ['Sequence', 'Anything']],
            'Anything',
          ],
        },
      },
      {
        name: 'Style',
        complexity: 9000,
        inert: true,
        signature: {
          domain: [
            'Function',
            'Anything',
            ['Maybe', ['Head', 'Dictionary']], // @todo
            'Anything',
          ],
        },

        // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x
      },
    ],
  },
  {
    functions: [
      { name: 'Apply', signature: { domain: 'Function' } },
      { name: 'About', signature: { domain: 'Function' } },

      {
        /** Create a local scope. First argument is a dictionary of local variables.
         * They are evaluated in the context of the parent scope. The second argument
         * is an expression to be evaluated in the context of the new scope.
         * ["Block", ["List", ["Equal", "x", 1]], [...]]
         */
        name: 'Block',
        signature: { domain: 'Function' },
      },
      {
        /** Return the domain of an expression */
        name: 'Domain',
        signature: {
          domain: ['Function', 'Anything', 'Domain'],
          canonical: (ce, args) => ce.domain(args[0]),
        },
      },
      {
        name: 'Evaluate',
        hold: 'all',
        signature: {
          domain: ['Function', 'Anything', 'Anything'],
          codomain: (_ce, args) => args[0],
          evaluate: (_ce, ops) => ops[0].evaluate(),
        },
      },
      {
        name: 'FromDigits',
        description: `\`FromDigits(s, base=10)\` \
      return an integer representation of the string \`s\` in base \`base\`.`,
        // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
        // @todo could accept "roman"... as base
        // @todo could accept optional third parameter as the (padded) length of the output
        signature: {
          domain: [
            'Function',
            'String',
            ['Maybe', ['Range', 1, 36]],
            'Integer',
          ],
          evaluate: (ce, ops) => {
            const op1 = ops[0];
            if (!op1.string)
              return ce.error(
                ['mismatched-argument-domain', ['Domain', 'String']],
                ['Latex', op1.latex]
              );

            const op2 = ops[1];
            if (op2.symbol === 'Nothing')
              return ce.number(Number.parseInt(op1.string, 10));
            if (op2.machineValue === null) {
              return ce.error(
                ['unexpected-base', op2.latex],
                ['Latex', op2.latex]
              );
            }
            const base = op2.machineValue;
            if (base < 2 || base > 36)
              return ce.error(['unexpected-base', base], ['Latex', op2.latex]);

            const [value, rest] = fromDigits(op1.string, base);

            if (rest)
              return ce.error(['unexpected-digit', rest[0]], ['Latex', rest]);

            return ce.number(value);
          },
        },
      },
      {
        name: 'Head',
        signature: {
          domain: 'Function',
          evaluate: (ce, ops) => {
            const op1 = ops[0];
            if (typeof op1.head === 'string') return ce.symbol(op1.head);
            return op1.head;
          },
        },
      },
      {
        name: 'Html',
        signature: {
          domain: ['Function', 'Value', 'String'],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce.string('');
            // @todo if head(arg[0]) === 'LatexString', call MathLive renderToMarkup()
            return ce.string('');
          },
        },
      },

      {
        name: 'IntegerString',
        description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
        // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
        // @todo could accept "roman"... as base
        // @todo could accept optional third parameter as the (padded) length of the output
        signature: {
          domain: ['Function', 'Integer', ['Maybe', 'Integer'], 'String'],
          evaluate: (ce, ops) => {
            const op1 = ops[0];
            const val = op1.machineValue ?? op1.decimalValue?.toNumber() ?? NaN;
            if (Number.isNaN(val) || !Number.isInteger(val)) {
              ce.signal(
                ce._fn('IntegerString', ops),
                `Expected first argument as an integer. Got \\(${op1.latex}$\\)`
              );
              return undefined;
            }

            const op2 = ops[1];
            if (op2.symbol === 'Nothing') {
              if (op1.machineValue)
                return ce.string(Math.abs(op1.machineValue).toString());
              if (op1.decimalValue)
                return ce.string(op1.decimalValue.abs().toString());
              return ce.string(
                Math.abs(Math.round(op1.asFloat ?? NaN)).toString()
              );
            }

            if (op2.asSmallInteger === null) {
              ce.signal(
                ce._fn('IntegerString', ops),
                `Expected \`base\` as an integer between 2 and 36. Got \\(${op2.latex}$\\)`
              );
              return undefined;
            }
            const base = op2.asSmallInteger;
            if (base < 2 || base > 36) {
              ce.signal(
                ce._fn('IntegerString', ops),
                `Expected \`base\` as an integer between 2 and 36. Got ${base}`
              );
              return undefined;
            }

            return ce.string(Math.abs(val).toString(base));
          },
        },
      },

      {
        name: 'Lambda',
        wikidata: 'Q567612',
        hold: 'all',
        signature: { domain: 'Function' },
      },
      {
        name: 'Latex',
        inert: true,
        signature: {
          domain: ['Function', 'String', 'String'],
        },
      },
      {
        name: 'LatexString',
        hold: 'all',
        signature: {
          domain: ['Function', ['Sequence', 'Anything'], 'String'],
          evaluate: (ce, ops) =>
            ce.string(joinLatex(ops.map((x) => ce.serialize(x)))),
        },
      },
      {
        name: 'LatexTokens',
        hold: 'all',
        signature: {
          domain: ['Function', 'Anything', ['List', 'String']],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce._fn('List', []);
            let latex = '';
            if (ops[0].head === 'Latex') latex = ops[0].op1.string ?? '';
            else if (ops[0].head === 'LatexString') latex = ops[0].op1.latex;
            else latex = ops[0].latex;
            return ce._fn(
              'List',
              tokenize(latex, []).map((x) => ce.string(x))
            );
          },
        },
      },
      {
        name: 'JoinLatexTokens',
        signature: {
          domain: ['Function', ['Sequence', 'String'], 'String'],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce.string('');
            return ce.string(joinLatex(ops.map((x) => x.string ?? '')));
          },
        },
      },
      {
        name: 'FromLatex',
        signature: {
          domain: ['Function', 'String', 'Anything'],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce.symbol('Nothing');
            return ce.parse(ops[0].string ?? '');
          },
        },
      },
      {
        name: 'Signatures',
        signature: {
          domain: ['Function', 'Symbol', ['Maybe', ['List', 'Domain']]],
          evaluate: (ce, ops) => {
            const name = ops[0].symbol;
            if (!name) return ce.symbol('Nothing');
            const result = ce.lookupFunctionName(name);
            if (!result) return ce.symbol('Nothing');
            return ce.fn('List', [result.signature.domain]);
          },
        },
      },
      {
        name: 'String',
        threadable: true,
        signature: {
          domain: ['Function', ['Maybe', 'Anything'], 'String'],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce.string('');
            return ce.string(
              ops.map((x) => x.string ?? `\\(${x.latex}$\\)`).join('')
            );
          },
        },
      },
      {
        name: 'Symbol',
        complexity: 500,
        description:
          'Construct a new symbol with a name formed by concatenating the arguments',
        threadable: true,
        signature: {
          domain: ['Function', ['Sequence', 'Anything'], 'Symbol'],
          evaluate: (ce, ops) => {
            if (ops.length === 0) return ce.symbol('Nothing');
            const args = ops;
            const arg = args
              .map((x) => {
                const symName = x.symbol;
                if (symName !== null) return symName;

                const stringValue = arg.string;
                if (stringValue !== null) return stringValue;

                const numValue = arg.smallIntegerValue;
                if (numValue !== null) return numValue.toString();

                return '';
              })
              .join('');

            if (arg.length > 0) return ce.symbol(arg);

            return ce.symbol('Nothing');
          },
        },
      },
      {
        name: 'SymbolName',
        signature: {
          domain: ['Function', 'Anything', ['Maybe', 'String']],
          evaluate: (ce, ops) =>
            ops[0].symbol ? ce.string(ops[0].symbol) : ce.symbol('Nothing'),
        },
      },
      {
        name: 'Tail',
        signature: {
          domain: ['Function', 'Value', ['List', 'Value']],
          evaluate: (ce, ops) => ce._fn('List', ops[0].ops ?? []),
        },
      },
      {
        name: 'Timing',
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
            let n = Math.max(3, Math.round(ops[1].asSmallInteger ?? 3));

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
    ],
  },
];

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1
// length(expr, depth:integer) (for a list, an expression, etc..)
// shape
// length
// depth

/*
 DICTIONARY
 aka Association in Wolfram, Dictionary in Python and Swift, Record in Maple,
 Map Containers in mathlab, Map in JavaScript
 Dictionary("field1", "value1", "field2", "value2"...)
 Need a new atomic 'dict' MathJSON type?
  {{name: 'dict',"field1": "value1", "field2": "value2"}}
*/

// LISTS
// take(n, list) -> n first elements of the list
// https://www.mathworks.com/help/referencelist.html?type=function&listtype=cat&category=&blocktype=&capability=&s_tid=CRUX_lftnav        // list
// repeat(x) -> infinite list with "x" as argument
// cycle(list) -> infinitely repeating list, i.e. cycle({1, 2, 3}) -> {1, 2, 3, 1, 2, 3, 1...}
// iterate(f, acc) -> {f(acc), f(f(acc)), f(f(f(acc)))...}
// == NestList ??
// Append (python) / Push
// Insert(i, x)
// Pop(): remove last, Pop(i): remove item at [i]

// Range
// index
// Evaluate
// Bind // replace  ( x-> 1)
// Domain
// min, max
// None -- constant for some options
// rule ->
// delayed-rule: :> (value of replacement is recalculated each time)
// set, set delayed
// join
// convert(expr, CONVERT_TO, OPTIONS) -- See Maple
// convert(expr, options), with options such as 'cos', 'sin, 'trig, 'exp', 'ln', 'latex', 'string', etc...)
// N
// set, delayed-set
// spread -> expand the elements of a list. If inside a list, insert the list into its parent
// compose (compose(f, g) -> a new function such that compose(f, g)(x) -> f(g(x))

// Symbol(x) -> x as a symbol, e.g. symbol('x' + 'y') -> `xy` (and registers it)
// Symbols() -> return list of all known symbols
// variables() -> return list of all free variables
