import { BoxedExpression, Dictionary } from '../public';

//   // eq, lt, leq, gt, geq, neq, approx
//   //     shortLogicalImplies: 52, // ➔
//   // shortImplies => 51
//   // implies ==> 49
//   //    impliedBy: 45, // <==
//   // less-than-or-equal-to: Q55935272 241
//   // greater-than-or-equal: Q55935291 242
//   // greater-than: Q47035128  243
//   // less-than: Q52834024 245

export const RELOP_DICTIONARY: Dictionary = {
  functions: [
    {
      name: 'Equal',
      domain: 'MaybeBoolean',
      commutative: true,
      complexity: 11000,
      relationalOperator: true,
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!lhs) lhs = arg;
          else {
            const test = lhs.isEqual(arg);
            if (test === false) return ce.symbol('False');
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'NotEqual',
      domain: 'MaybeBoolean',
      wikidata: 'Q28113351',
      commutative: true,
      complexity: 11000,
      relationalOperator: true,
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('False');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!lhs) lhs = arg;
          else {
            const test = lhs.isEqual(arg);
            if (test === true) return ce.symbol('False');
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'Less',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test <= 0) return ce.symbol('False');
            lhs = arg;
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'NotLess',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Less', args)]),
    },
    {
      name: 'Greater',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Less', args.reverse()),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test >= 0) return ce.symbol('False');
            lhs = arg;
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'NotGreater',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Greater', args)]),
    },
    {
      name: 'LessEqual',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test < 0) return ce.symbol('False');
            lhs = arg;
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'NotLessNotEqual',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('LessEqual', args)]),
    },
    {
      name: 'GreaterEqual',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('LessEqual', args.reverse()),
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test > 0) return ce.symbol('False');
            lhs = arg;
          }
        }
        return ce.symbol('True');
      },
    },
    {
      name: 'NotGreaterNotEqual',
      domain: 'MaybeBoolean',
      complexity: 11000,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('GreaterEqual', args)]),
    },
    {
      name: 'TildeFullEqual',
      description: 'Indicate isomorphism, congruence and homotopic equivalence',
      domain: 'MaybeBoolean',
      relationalOperator: true,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotTildeFullEqual',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeFullEqual', args)]),
    },
    {
      name: 'TildeEqual',
      description: 'Approximately or asymptotically equal',
      domain: 'MaybeBoolean',
      relationalOperator: true,
      complexity: 11000,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotTildeEqual',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeEqual', args)]),
    },
    {
      name: 'Approx',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotApprox',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Approx', args)]),
    },
    {
      name: 'ApproxEqual',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotApproxEqual',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxEqual', args)]),
    },
    {
      name: 'ApproxNotEqual',
      domain: 'MaybeBoolean',
      relationalOperator: true,
      complexity: 11100,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotApproxNotEqual',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxNotEqual', args)]),
    },
    {
      name: 'Precedes',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotPrecedes',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Precedes', args)]),
    },
    {
      name: 'Succeeds',
      domain: 'MaybeBoolean',
      // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
    },
    {
      name: 'NotSucceeds',
      domain: 'MaybeBoolean',
      complexity: 11100,
      relationalOperator: true,
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Succeeds', args)]),
    },
  ],
};
