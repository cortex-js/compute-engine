import { BoxedExpression, Dictionary } from '../public';
import { joinLatex } from '../latex-syntax/tokenizer';
import { fromDigits } from '../numerics/numeric';

//   // := assign 80 // @todo

export const CORE_DICTIONARY: Dictionary[] = [
  {
    symbols: [
      { name: 'Missing', domain: 'Anything' },
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
        signatures: [
          {
            domain: [
              'Function',
              'String',
              'Anything',
              ['Tuple', 'String', 'Anything'],
            ],
            canonical: (ce, args) => ce.tuple(args),
          },
        ],
      },
      {
        name: 'Single',
        description: 'A tuple with a single element',
        complexity: 8200,
        signatures: [
          {
            domain: ['Function', 'Anything', ['Tuple', 'Anything']],
            canonical: (ce, args) => ce.tuple(args),
          },
        ],
      },
      {
        name: 'Pair',
        description: 'A tuple of two elements',
        complexity: 8200,
        signatures: [
          {
            domain: [
              'Function',
              'Anything',
              'Anything',
              ['Tuple', 'Anything', 'Anything'],
            ],
            canonical: (ce, args) => ce.tuple(args),
          },
        ],
      },
      {
        name: 'Triple',
        description: 'A tuple of three elements',
        complexity: 8200,
        signatures: [
          {
            domain: [
              'Function',
              'Anything',
              'Anything',
              'Anything',
              ['Tuple', 'Anything', 'Anything', 'Anything'],
            ],
            canonical: (ce, args) => ce.tuple(args),
          },
        ],
      },
      {
        name: 'Tuple',
        description: 'A fixed number of heterogeneous elements',
        complexity: 8200,
        signatures: [
          {
            domain: [
              'Function',
              ['Some', 'Anything'],
              ['Tuple', ['Some', 'Anything']],
            ],
          },
        ],
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
        signatures: [
          {
            domain: ['Function', 'Value', ['Optional', 'Integer'], 'Value'],
          },
        ],
      },
      {
        // Use to represent groups of expressions. Named after https://en.wikipedia.org/wiki/Delimiter
        name: 'Delimiter',
        complexity: 9000,
        inert: true,
        signatures: [
          {
            domain: [
              'Function',
              'Value',
              ['Optional', 'String'],
              ['Optional', 'String'],
              'Value',
            ],
          },
        ],
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
         * for example, the argument will be a `LatexForm` expression.
         */
        name: 'Error',
        complexity: 500,
        inert: true,
        signatures: [
          {
            domain: [
              'Function',
              'Anything',
              ['Optional', 'String'],
              ['Optional', 'Value'],
              'Anything',
            ],
          },
        ],
      },
      {
        name: 'Style',
        complexity: 9000,
        inert: true,
        signatures: [
          {
            domain: [
              'Function',
              'Anything',
              ['Optional', ['Head', 'Dictionary']], // @todo
              'Anything',
            ],
          },
        ],
        // @todo: simplify: merge Style(Style(x, s1), s2),  Style(x) -> x
      },
    ],
  },
  {
    functions: [
      { name: 'Apply', signatures: [{ domain: 'Function' }] },
      { name: 'About', signatures: [{ domain: 'Function' }] },
      /** Create a local scope. First argument is a dictionary of local variables.
       * They are evaluated in the context of the parent scope. The second argument
       * is an expression to be evaluated in the context of the new scope.
       * ["Block", ["List", ["Equal", "x", 1]], [...]]
       */
      { name: 'Block', signatures: [{ domain: 'Function' }] },
      /** Return the domain of an expression */
      { name: 'Domain', signatures: [{ domain: 'Function' }] },
      {
        name: 'Evaluate',
        hold: 'all',
        signatures: [
          { domain: 'Function', evaluate: (ce, ops) => ops[0].evaluate() },
        ],
      },
      {
        name: 'FromDigits',
        description: `\`FromDigits(s, base=10)\` \
      return an integer representation of the string \`s\` in base \`base\`.`,
        // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
        // @todo could accept "roman"... as base
        // @todo could accept optional third parameter as the (padded) length of the output
        signatures: [
          {
            evaluate: (ce, ops) => {
              const op1 = ops[0];
              if (op1.isMissing) return undefined;
              if (!op1.string) {
                return ce.error(
                  ce._fn('FromDigits', ops),
                  'Expected first argument as a string',
                  ['LatexForm', op1.latex]
                );
              }
              const op2 = ops[1];
              if (op2.isMissing) ce.number(Number.parseInt(op1.string, 10));
              if (op2.machineValue === null) {
                return [
                  'Error',
                  ce._fn('FromDigits', ops),
                  { str: 'Expected `base` as an integer between 2 and 36' },
                  ['LatexForm', op2.latex],
                ];
              }
              const base = op2.machineValue;
              if (base < 2 || base > 36) {
                return [
                  'Error',
                  ce._fn('FromDigits', ops),
                  { str: 'Expected `base` as an integer between 2 and 36' },
                  ['LatexForm', op2.latex],
                ];
              }
              const [value, rest] = fromDigits(op1.string, base);
              if (rest) {
                return [
                  'Error',
                  value,
                  { str: 'unexpected-digits' },
                  ['LatexForm', rest],
                ];
              }
              return ce.number(value);
            },
          },
        ],
      },
      {
        name: 'Head',
        signatures: [
          {
            domain: 'Function',
            evaluate: (ce, ops) => {
              const op1 = ops[0];
              if (typeof op1.head === 'string') return ce.symbol(op1.head);
              return op1.head;
            },
          },
        ],
      },
      {
        name: 'Html',
        signatures: [
          {
            domain: ['Function', 'Value', 'String'],
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce.string('');
              // @todo if head(arg[0]) === 'LatexString', call MathLive renderToMarkup()
              return ce.string('');
            },
          },
        ],
      },

      {
        name: 'IntegerString',
        description: `\`IntegerString(n, base=10)\` \
      return a string representation of the integer \`n\` in base \`base\`.`,
        // @todo could accept `0xcafe`, `0b01010` or `(deadbeef)_16` as string formats
        // @todo could accept "roman"... as base
        // @todo could accept optional third parameter as the (padded) length of the output
        signatures: [
          {
            domain: ['Function', 'Integer', ['Optional', 'Integer'], 'String'],
            evaluate: (ce, ops) => {
              const op1 = ops[0];
              if (op1.isMissing) return undefined;
              const val =
                op1.machineValue ?? op1.decimalValue?.toNumber() ?? NaN;
              if (Number.isNaN(val) || !Number.isInteger(val)) {
                ce.signal(
                  ce._fn('IntegerString', ops),
                  `Expected first argument as an integer. Got \\(${op1.latex}$\\)`
                );
                return undefined;
              }

              const op2 = ops[1];
              if (op2.isMissing) {
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
        ],
      },

      {
        name: 'Lambda',
        wikidata: 'Q567612',
        hold: 'all',
        signatures: [{ domain: 'Function' }],
      },
      {
        name: 'Latex',
        signatures: [
          {
            domain: 'Function',
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce._fn('LatexString', []);
              return ce._fn('LatexString', [
                ce.string(joinLatex(ops.map((x) => x.latex))),
              ]);
            },
          },
        ],
      },
      {
        name: 'LatexString',
        signatures: [
          {
            domain: 'Function',
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce._fn('LatexString', []);
              return ce._fn('LatexString', [
                ce.string(joinLatex(ops.map((x) => ce.serialize(x)))),
              ]);
            },
          },
        ],
      },
      {
        name: 'LatexTokens',
        signatures: [
          {
            domain: 'Function',
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce._fn('LatexString', []);
              return ce._fn('LatexString', [
                ce.string(joinLatex(ops.map((x) => ce.serialize(x)))),
              ]);
            },
          },
        ],
      },
      {
        name: 'Parse',
        signatures: [
          {
            domain: 'Function',
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce.symbol('Nothing');
              const latex = joinLatex(ops.map((x) => ce.serialize(x)));
              return ce.parse(latex)!;
            },
          },
        ],
      },
      {
        name: 'String',
        threadable: true,
        signatures: [
          {
            domain: ['Function', ['Some', 'Anything'], 'String'],
            evaluate: (ce, ops) => {
              if (ops.length === 0) return ce.string('');
              return ce.string(
                ops.map((x) => x.string ?? `\\(${x.latex}$\\)`).join('')
              );
            },
          },
        ],
      },
      {
        name: 'Symbol',
        complexity: 500,
        description:
          'Construct a new symbol with a name formed by concatenating the arguments',
        threadable: true,
        // evalDomain: () => 'Symbol',
        signatures: [
          {
            domain: ['Function', ['Some', 'Anything'], 'Symbol'],
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
        ],
      },
      {
        name: 'SymbolName',
        signatures: [
          {
            domain: ['Function', 'Anything', 'String'],
            evaluate: (ce, ops) =>
              ops[0].symbol ? ce.string(ops[0].symbol) : ce.symbol('Nothing'),
          },
        ],
      },
      {
        name: 'Tail',
        signatures: [
          {
            domain: ['Function', 'Value', ['List', 'Value']],
            evaluate: (ce, ops) => ce._fn('List', ops[0].ops ?? []),
          },
        ],
      },
      {
        name: 'Timing',
        description:
          '`Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation',
        signatures: [
          {
            domain: ['Function', 'Value', ['Tuple', 'Value', 'Number']],
            evaluate: (ce, ops) => {
              if (!ops[1] || ops[1].isMissing) {
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
        ],
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
