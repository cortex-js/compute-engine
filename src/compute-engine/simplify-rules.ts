import { Rule } from './public';

/**
 * @todo: a set to "tidy" an expression. Different from a canonical form, but
 * inline with the user's expectations.
 *
 * Example:
 *
 * - a^n * a^m -> a^(n+m)
 * - a / √b -> (a * √b) / b
 *
 */

/**
 * A set of simplification rules.
 *
 * The rules are expressed as
 *
 *    `[lhs, rhs, condition]`
 *
 * where `lhs` is rewritten as `rhs` if `condition` is true.
 *
 * `lhs` and `rhs` can be either an Expression or a LaTeX string.
 *
 * If using an Expression, the expression is *not* canonicalized before being
 * used. Therefore in some cases using Expression, while more verbose,
 * may be necessary as the expression could be simplified by the canonicalization.
 */
export const SIMPLIFY_RULES: Rule[] = [
  '\\frac{x}{x} -> 1', // Note this is not true for x = 0

  '\\frac{x^n}{x^m} -> x^{n-m}', // Note this is not always true
  'x^n * x^m -> x^{n+m}',
  'x^a * x^b -> x^{a+b}',
  'x^n^m -> x^{n * m}',

  // Exponential and logarithms
  '\\log(xy) -> \\log(x) + \\log(y)',
  '\\log(x^n) -> n \\log(x)',
  '\\log(\\frac{x}{y}) -> \\log(x) - \\log(y)',
  '\\log(\\exp(x) * y) -> x + \\log(y)',
  '\\log(\\exp(x) / y) -> x - \\log(y)',
  '\\log(\\exp(x)^y) -> y * x',
  '\\log(\\exp(x)) -> x',

  '\\exp(x) * \\exp(y) -> \\exp(x + y)',
  '\\exp(x)^n -> \\exp(n x)',
  '\\exp(\\log(x)) -> x',
  '\\exp(\\log(x) + y) -> x * \\exp(y)',
  '\\exp(\\log(x) - y) -> x / \\exp(y)',
  '\\exp(\\log(x) * y) -> x^y',
  '\\exp(\\log(x) / y) -> x^(1/y)',
  '\\exp(\\log(x) * \\log(y)) -> x^\\log(y)',
  '\\exp(\\log(x) / \\log(y)) -> x^{1/\\log(y)}',

  // Trigonometric
  '\\sin(-x) -> -\\sin(x)',
  '\\cos(-x) -> \\cos(x)',
  '\\tan(-x) -> -\\tan(x)',
  '\\cot(-x) -> -\\cot(x)',
  '\\sec(-x) -> \\sec(x)',
  '\\csc(-x) -> -\\csc(x)',
  '\\sin(\\pi - x) -> \\sin(x)',
  '\\cos(\\pi - x) -> -\\cos(x)',
  '\\tan(\\pi - x) -> -\\tan(x)',
  '\\cot(\\pi - x) -> -\\cot(x)',
  '\\sec(\\pi - x) -> -\\sec(x)',
  '\\csc(\\pi - x) -> \\csc(x)',
  '\\sin(\\pi + x) -> -\\sin(x)',
  '\\cos(\\pi + x) -> -\\cos(x)',
  '\\tan(\\pi + x) -> \\tan(x)',
  '\\cot(\\pi + x) -> -\\cot(x)',
  '\\sec(\\pi + x) -> -\\sec(x)',
  '\\csc(\\pi + x) -> \\csc(x)',

  '\\sin(\\frac{\\pi}{2} - x) -> \\cos(x)',
  '\\cos(\\frac{\\pi}{2} - x) -> \\sin(x)',
  '\\tan(\\frac{\\pi}{2} - x) -> \\cot(x)',
  '\\cot(\\frac{\\pi}{2} - x) -> \\tan(x)',
  '\\sec(\\frac{\\pi}{2} - x) -> \\csc(x)',
  '\\csc(\\frac{\\pi}{2} - x) -> \\sec(x)',
  '\\sin(x) * \\cos(x) -> \\frac{1}{2} \\sin(2x)',
  '\\sin(x) * \\sin(y) -> \\frac{1}{2} (\\cos(x-y) - \\cos(x+y))',
  '\\cos(x) * \\cos(y) -> \\frac{1}{2} (\\cos(x-y) + \\cos(x+y))',
  '\\tan(x) * \\cot(x) -> 1',
  // '\\sin(x)^2 + \\cos(x)^2 -> 1',
  '\\sin(x)^2 -> \\frac{1 - \\cos(2x)}{2}',
  '\\cos(x)^2 -> \\frac{1 + \\cos(2x)}{2}',
  {
    match: ['Tan', '__x'],
    replace: ['Divide', ['Sin', '__x'], ['Cos', '__x']],
  },
  {
    match: ['Cot', '__x'],
    replace: ['Divide', ['Cos', '__x'], ['Sin', '__x']],
  },
  {
    match: ['Sec', '__x'],
    replace: ['Divide', 1, ['Cos', '__x']],
  },
  {
    match: ['Csc', '__x'],
    replace: ['Divide', 1, ['Sin', '__x']],
  },
  // {
  //   match: ['Cos', '__x'],
  //   replace: ['Sin', ['Add', ['Divide', 'Pi', 2], '__x']],
  // },
  {
    match: ['Arcosh', '__x'],
    replace: [
      'Ln',
      ['Add', '__x', ['Sqrt', ['Subtract', ['Square', '__x'], 1]]],
    ],
    condition: (sub, ce) => sub.__x.isGreater(ce.One) ?? false,
  },
  {
    match: ['Arcsin', '__x'],
    replace: [
      'Multiply',
      2,
      [
        'Arctan2',
        '__x',
        ['Add', 1, ['Sqrt', ['Subtract', 1, ['Square', '__x']]]],
      ],
    ],
  },
  {
    match: ['Arsinh', '__x'],
    replace: [
      'Multiply',
      2,
      ['Ln', ['Add', '__x', ['Sqrt', ['Add', ['Square', '__x'], 1]]]],
    ],
  },
  {
    match: ['Artanh', '__x'],
    replace: [
      'Multiply',
      'Half',
      ['Ln', ['Divide', ['Add', 1, '__x'], ['Subtract', 1, '__x']]],
    ],
  },
  {
    match: ['Cosh', '__x'],
    replace: ['Divide', ['Add', ['Exp', '__x'], ['Exp', ['Negate', '__x']]], 2],
  },
  {
    match: ['Sinh', '__x'],
    replace: [
      'Divide',
      ['Subtract', ['Exp', '__x'], ['Exp', ['Negate', '__x']]],
      2,
    ],
  },
];
//  [
//   // `Subtract`
//   ['$\\_ - \\_$', 0],
//   [['Subtract', '\\_x', 0], 'x'],
//   [['Subtract', 0, '\\_x'], '$-x$'],

//   // `Add`
//   [['Add', '_x', ['Negate', '_x']], 0],

//   // `Multiply`
//   ['$\\_ \\times \\_ $', '$\\_^2$'],

//   // `Divide`
//   [['Divide', '_x', 1], { sym: '_x' }],
//   [['Divide', '_x', '_x'], 1, { condition: (sub) => sub.x.isNotZero ?? false }],
//   [
//     ['Divide', '_x', 0],
//     { num: '+Infinity' },
//     { condition: (sub) => sub.x.isPositive ?? false },
//   ],
//   [
//     ['Divide', '_x', 0],
//     { num: '-Infinity' },
//     { condition: (sub) => sub.x.isNegative ?? false },
//   ],
//   [['Divide', 0, 0], NaN],

//   // `Power`
//   [['Power', '_x', 'Half'], '$\\sqrt{x}$'],
//   [
//     ['Power', '_x', 2],
//     ['Square', '_x'],
//   ],

//   // Complex
//   [
//     ['Divide', ['Complex', '_re', '_im'], '_x'],
//     ['Add', ['Divide', ['Complex', 0, '_im'], '_x'], ['Divide', '_re', '_x']],
//     {
//       condition: (sub: Substitution): boolean =>
//         (sub.re.isNotZero ?? false) &&
//         (sub.re.isInteger ?? false) &&
//         (sub.im.isInteger ?? false),
//     },
//   ],

//   // `Abs`
//   [
//     ['Abs', '_x'],
//     { sym: '_x' },
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNonNegative ?? false,
//     },
//   ],
//   [
//     ['Abs', '_x'],
//     ['Negate', '_x'],
//     {
//       condition: (sub: Substitution): boolean => sub.x.isNegative ?? false,
//     },
//   ],

//   //
//   // Boolean
//   //
//   [['Not', ['Not', '_x']], '_x'], // @todo Since Not is an involution, should not be needed
//   [['Not', 'True'], 'False'],
//   [['Not', 'False'], 'True'],
//   [['Not', 'OptArg'], 'OptArg'],

//   [['And'], 'True'],
//   [['And', '__x'], '__x'],
//   [['And', '__x', 'True'], '_x'],
//   [['And', '__', 'False'], 'False'],
//   [['And', '__', 'OptArg'], 'OptArg'],
//   [['And', '__x', ['Not', '__x']], 'False'],
//   [['And', ['Not', '__x'], '__x'], 'False'],

//   [['Or'], 'False'],
//   [['Or', '__x'], '__x'],
//   [['Or', '__', 'True'], 'True'],
//   [['Or', '__x', 'False'], '__x'],
//   [
//     ['Or', '__x', 'OptArg'],
//     ['Or', '__x'],
//   ],

//   [
//     ['NotEqual', '__x'],
//     ['Not', ['Equal', '__x']],
//   ],
//   [
//     ['NotElement', '__x'],
//     ['Not', ['Element', '__x']],
//   ],
//   [
//     ['NotLess', '__x'],
//     ['Not', ['Less', '__x']],
//   ],
//   [
//     ['NotLessNotEqual', '__x'],
//     ['Not', ['LessEqual', '__x']],
//   ],
//   [
//     ['NotTildeFullEqual', '__x'],
//     ['Not', ['TildeFullEqual', '__x']],
//   ],
//   [
//     ['NotApprox', '__x'],
//     ['Not', ['Approx', '__x']],
//   ],
//   [
//     ['NotApproxEqual', '__x'],
//     ['Not', ['ApproxEqual', '__x']],
//   ],
//   [
//     ['NotGreater', '__x'],
//     ['Not', ['Greater', '__x']],
//   ],
//   [
//     ['NotApproxNotEqual', '__x'],
//     ['Not', ['GreaterEqual', '__x']],
//   ],
//   [
//     ['NotPrecedes', '__x'],
//     ['Not', ['Precedes', '__x']],
//   ],
//   [
//     ['NotSucceeds', '__x'],
//     ['Not', ['Succeeds', '__x']],
//   ],
//   [
//     ['NotSubset', '__x'],
//     ['Not', ['Subset', '__x']],
//   ],
//   [
//     ['NotSuperset', '__x'],
//     ['Not', ['Superset', '__x']],
//   ],
//   [
//     ['NotSubsetNotEqual', '__x'],
//     ['Not', ['SubsetEqual', '__x']],
//   ],
//   [
//     ['NotSupersetEqual', '__x'],
//     ['Not', ['SupersetEqual', '__x']],
//   ],

//   // DeMorgan's Laws
//   [
//     ['Not', ['And', ['Not', '_a'], ['Not', '_b']]],
//     ['Or', '_a', '_b'],
//   ],
//   [
//     ['And', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['Or', '_a', '_b']],
//   ],
//   [
//     ['Not', ['Or', ['Not', '_a'], ['Not', '_b']]],
//     ['And', '_a', '_b'],
//   ],
//   [
//     ['Or', ['Not', '_a'], ['Not', '_b']],
//     ['Not', ['And', '_a', '_b']],
//   ],

//   // Implies

//   [['Implies', 'True', 'False'], 'False'],
//   [['Implies', '_', 'OptArg'], 'True'],
//   [['Implies', '_', 'True'], 'True'],
//   [['Implies', 'False', '_'], 'True'],
//   [
//     ['Or', ['Not', '_p'], '_q'],
//     ['Implies', '_p', '_q'],
//   ], // p => q := (not p) or q
//   // if           Q=F & P= T      F
//   // otherwise                    T

//   //  Equivalent

//   [
//     ['Or', ['And', '_p', '_q'], ['And', ['Not', '_p'], ['Not', '_q']]],
//     ['Equivalent', '_p', '_q'],
//   ], // p <=> q := (p and q) or (not p and not q), aka `iff`
//   //   if (q = p), T. Otherwise, F
//   [['Equivalent', 'True', 'True'], 'True'],
//   [['Equivalent', 'False', 'False'], 'True'],
//   [['Equivalent', 'OptArg', 'OptArg'], 'True'],
//   [['Equivalent', 'True', 'False'], 'False'],
//   [['Equivalent', 'False', 'True'], 'False'],
//   [['Equivalent', 'True', 'OptArg'], 'False'],
//   [['Equivalent', 'False', 'OptArg'], 'False'],
//   [['Equivalent', 'OptArg', 'True'], 'False'],
//   [['Equivalent', 'OptArg', 'False'], 'False'],
// ];

// export function internalSimplify(
//   ce: ComputeEngine,
//   expr: BoxedExpression | null,
//   simplifications?: Simplification[]
// ): BoxedExpression | null {
//   if (expr === null) return null;

//   //
//   // 1/ Apply simplification rules
//   //
//   simplifications = simplifications ?? ['simplify-all'];
//   if (simplifications.length === 1 && simplifications[0] === 'simplify-all') {
//     simplifications = [
//       'simplify-arithmetic',
//       // 'simplify-logarithmic',
//       // 'simplify-trigonometric',
//     ];
//   }
//   for (const simplification of simplifications) {
//     expr = ce.replace(
//       expr,
//       ce.cache<RuleSet>(
//         simplification,
//         (): RuleSet => compileRules(ce, SIMPLIFY_RULES[simplification])
//       )
//     );
//   }

//   //
//   // 2/ Numeric simplifications
//   //
//   // expr = simplifyNumber(ce, expr!) ?? expr;

//   //
//   // 3/ Simplify boolean expressions, using assumptions.
//   //
//   //
//   expr = simplifyBoolean(expr);

//   if (isAtomic(expr!)) return expr;

//   //
//   // 4/ Simplify Dictionary
//   //
//   // if (getDictionary(expr!) !== null) {
//   //   return applyRecursively(
//   //     expr!,
//   //     (x) => internalSimplify(ce, x, simplifications) ?? x
//   //   );
//   // }

//   //
//   // 5/ It's a function (not a dictionary and not atomic)
//   //

//   const head = internalSimplify(
//     ce,
//     getFunctionHead(expr) ?? 'Missing',
//     simplifications
//   );
//   if (typeof head === 'string') {
//     const def = ce.getFunctionDefinition(head);
//     if (def) {
//       // Simplify the arguments, except those affected by `hold`
//       const args: BoxedExpression[] = [];
//       const tail = getTail(expr);
//       for (let i = 0; i < tail.length; i++) {
//         const name = getFunctionName(tail[i]);
//         if (name === 'Evaluate') {
//           args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
//         } else if (name === 'Hold') {
//           args.push(getArg(tail[i], 1) ?? 'Missing');
//         } else if (
//           (i === 0 && def.hold === 'first') ||
//           (i > 0 && def.hold === 'rest') ||
//           def.hold === 'all'
//         ) {
//           args.push(tail[i]);
//         } else {
//           args.push(internalSimplify(ce, tail[i], simplifications) ?? tail[i]);
//         }
//       }
//       const result =
//         typeof def.simplify === 'function'
//           ? def.simplify(ce, ...args) ?? expr
//           : [head, ...args];
//       return ce.cost(result) <= ce.cost(expr) ? result : expr;
//     }
//   }
//   if (head !== null) {
//     // If we can't identify the function, we don't know how to process
//     // the arguments (they may be Hold...), so don't attempt to process them.
//     return [head, ...getTail(expr)];
//   }
//   return expr;
// }
