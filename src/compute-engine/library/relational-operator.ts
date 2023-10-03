import { BoxedExpression, IdentifierDefinitions } from '../public';
import { flattenOps, flattenSequence } from '../symbolic/flatten';
import { canonical } from '../symbolic/utils';

//   // eq, lt, leq, gt, geq, neq, approx
//   //     shortLogicalImplies: 52, // ➔
//   // shortImplies => 51
//   // implies ==> 49
//   //    impliedBy: 45, // <==
//   // less-than-or-equal-to: Q55935272 241
//   // greater-than-or-equal: Q55935291 242
//   // greater-than: Q47035128  243
//   // less-than: Q52834024 245

export const RELOP_LIBRARY: IdentifierDefinitions = {
  Equal: {
    commutative: true,
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, ops) => {
        return ce._fn(
          'Equal',
          flattenOps(flattenSequence(canonical(ops)), 'Equal')
        );
      },
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops) {
          if (!lhs) lhs = arg;
          else {
            const test = lhs.isEqual(arg);
            if (test !== true) return ce.False;
          }
        }
        return ce.True;
      },
    },
  },
  NotEqual: {
    wikidata: 'Q28113351',
    commutative: true,
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.False;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!lhs) lhs = arg;
          else {
            const test = lhs.isEqual(arg);
            if (test === true) return ce.False;
          }
        }
        return ce.True;
      },
    },
  },
  Less: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, ops) =>
        ce._fn('Less', flattenOps(flattenSequence(canonical(ops)), 'Less')),
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test <= 0) return ce.False;
            lhs = arg;
          }
        }
        return ce.True;
      },
    },
  },
  NotLess: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Less', args)]),
    },
  },
  Greater: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Less', args.reverse()),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test >= 0) return ce.False;
            lhs = arg;
          }
        }
        return ce.True;
      },
    },
  },
  NotGreater: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Greater', args)]),
    },
  },
  LessEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test < 0) return ce.False;
            lhs = arg;
          }
        }
        return ce.True;
      },
    },
  },
  NotLessNotEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('LessEqual', args)]),
    },
  },
  GreaterEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('LessEqual', args.reverse()),
      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.fn('Subtract', [arg, lhs]).N().sgn;
            if (test === null || test === undefined) return undefined;
            if (test > 0) return ce.False;
            lhs = arg;
          }
        }
        return ce.True;
      },
    },
  },
  NotGreaterNotEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('GreaterEqual', args)]),
    },
  },
  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotTildeFullEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeFullEqual', args)]),
    },
  },
  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotTildeEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('TildeEqual', args)]),
    },
  },
  Approx: {
    complexity: 11100,
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApprox: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Approx', args)]),
    },
  },
  ApproxEqual: {
    complexity: 11100,
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApproxEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxEqual', args)]),
    },
  },
  ApproxNotEqual: {
    complexity: 11100,
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotApproxNotEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('ApproxNotEqual', args)]),
    },
  },
  Precedes: {
    complexity: 11100,
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotPrecedes: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Precedes', args)]),
    },
  },
  Succeeds: {
    signature: { domain: 'RelationalOperators' },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },
  NotSucceeds: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => ce._fn('Not', [ce._fn('Succeeds', args)]),
    },
  },
};
