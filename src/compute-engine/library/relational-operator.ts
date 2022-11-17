import { BoxedExpression, IDTable } from '../public';
import { flattenOps, flattenSequence } from '../symbolic/flatten';

//   // eq, lt, leq, gt, geq, neq, approx
//   //     shortLogicalImplies: 52, // ➔
//   // shortImplies => 51
//   // implies ==> 49
//   //    impliedBy: 45, // <==
//   // less-than-or-equal-to: Q55935272 241
//   // greater-than-or-equal: Q55935291 242
//   // greater-than: Q47035128  243
//   // less-than: Q52834024 245

export const RELOP_LIBRARY: IDTable = {
  Equal: {
    commutative: true,
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, ops) => {
        ops =
          flattenOps(
            flattenSequence(ops).map((x) => x.canonical),
            'Equal'
          ) ?? ops;
        return ce._fn('Equal', ops);
      },
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.symbol('True');
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops) {
          if (!lhs) lhs = arg;
          else {
            const test = lhs.isEqual(arg);
            if (test !== true) return ce.symbol('False');
          }
        }
        return ce.symbol('True');
      },
    },
  },
  NotEqual: {
    wikidata: 'Q28113351',
    commutative: true,
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
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
  },
  Less: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, ops) => {
        ops =
          flattenOps(
            flattenSequence(ops).map((x) => x.canonical),
            'Less'
          ) ?? ops;
        return ce._fn('Less', ops);
      },
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
  },
  NotLess: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Less', args)]),
    },
  },
  Greater: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
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
  },
  NotGreater: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Greater', args)]),
    },
  },
  LessEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
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
  },
  NotLessNotEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('LessEqual', args)]),
    },
  },
  GreaterEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
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
  },
  NotGreaterNotEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('GreaterEqual', args)]),
    },
  },
  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotTildeFullEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeFullEqual', args)]),
    },
  },
  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotTildeEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeEqual', args)]),
    },
  },
  Approx: {
    complexity: 11100,
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApprox: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Approx', args)]),
    },
  },
  ApproxEqual: {
    complexity: 11100,
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApproxEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxEqual', args)]),
    },
  },
  ApproxNotEqual: {
    complexity: 11100,
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApproxNotEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxNotEqual', args)]),
    },
  },
  Precedes: {
    complexity: 11100,
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotPrecedes: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Precedes', args)]),
    },
  },
  Succeeds: {
    signature: { domain: 'RelationalOperator' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotSucceeds: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperator',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Succeeds', args)]),
    },
  },
};
