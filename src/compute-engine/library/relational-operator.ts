import { isRelationalOperator } from '../boxed-expression/utils';
import { checkPure } from '../boxed-expression/validate';
import {
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
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
  Congruent: {
    commutative: false,
    complexity: 11000,
    numeric: true,
    signature: {
      simplify: (ce, ops) => {
        if (ops.length < 3) return undefined;
        return ce
          ._fn('Equal', [
            ce.box(['Mod', ops[0], ops[2]]).simplify(),
            ce.box(['Mod', ops[1], ops[2]]).simplify(),
          ])
          .simplify();
      },
      evaluate: (ce, ops) => {
        if (ops.length < 3) return undefined;
        const [lhs, rhs, modulo] = ops;
        const nLhs = lhs.value;
        const nRhs = rhs.value;
        const nModulo = modulo.value;
        if (typeof nLhs !== 'number') return undefined;
        if (typeof nRhs !== 'number') return undefined;
        if (typeof nModulo !== 'number') return undefined;
        return nLhs % nModulo === nRhs % nModulo ? ce.True : ce.False;
      },
    },
  },

  IsSame: {
    description: 'Compare two expressions for structural equality',
    hold: 'all',
    signature: {
      domain: 'RelationalOperators',

      // Since we want to work on non-canonical expressions,
      // do nothing to canonicalize the arguments
      evaluate: (ce, ops) => {
        if (ops.length !== 2) return undefined;
        const [lhs, rhs] = ops;
        return lhs.isSame(rhs) === true ? ce.True : ce.False;
      },
    },
  },

  Equal: {
    commutative: true,
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',

      canonical: (ce, args) => canonicalRelational(ce, 'Equal', args),

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

      canonical: (ce, args) => canonicalRelational(ce, 'NotEqual', args),

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

      canonical: (ce, ops) => canonicalRelational(ce, 'Less', ops),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.box(['Subtract', arg, lhs]).N().sgn; // @fixme: use signdiff
            if (test === null || test === undefined) return undefined;
            if (test <= 0) return ce.False; // @fixme: shouldn't that be test < 0?
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

      canonical: (ce, ops) =>
        ce._fn('Not', [canonicalRelational(ce, 'Less', ops)]),
    },
  },

  Greater: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, ops) =>
        canonicalRelational(ce, 'Less', [...ops].reverse()),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.box(['Subtract', arg, lhs]).N().sgn;
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

      canonical: (ce, ops) => canonicalRelational(ce, 'LessEqual', ops),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.box(['Subtract', arg, lhs]).N().sgn;
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
      canonical: (ce, ops) =>
        ce._fn('Not', [canonicalRelational(ce, 'LessEqual', ops)]),
    },
  },

  GreaterEqual: {
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',

      canonical: (ce, args) =>
        canonicalRelational(ce, 'LessEqual', [...args].reverse()),

      evaluate: (ce, ops) => {
        if (ops.length < 2) return ce.True;
        let lhs: BoxedExpression | undefined = undefined;
        for (const arg of ops!) {
          if (!arg.isNumber) return undefined;
          if (!lhs) lhs = arg;
          else {
            const test = ce.box(['Subtract', arg, lhs]).N().sgn;
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
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'GreaterEqual', args)]),
    },
  },

  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: {
      domain: 'RelationalOperators',

      canonical: (ce, args) => canonicalRelational(ce, 'TildeFullEqual', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotTildeFullEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',

      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'TildeFullEqual', args)]),
    },
  },

  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'TildeEqual', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotTildeEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',

      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'TildeEqual', args)]),
    },
  },

  Approx: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'Approx', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApprox: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'Approx', args)]),
    },
  },

  ApproxEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'ApproxEqual', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApproxEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'ApproxEqual', args)]),
    },
  },

  ApproxNotEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'ApproxNotEqual', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApproxNotEqual: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'ApproxNotEqual', args)]),
    },
  },

  Precedes: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'Precedes', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotPrecedes: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'Precedes', args)]),
    },
  },

  Succeeds: {
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) => canonicalRelational(ce, 'Succeeds', args),
    },
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotSucceeds: {
    complexity: 11100,
    signature: {
      domain: 'RelationalOperators',
      canonical: (ce, args) =>
        ce._fn('Not', [canonicalRelational(ce, 'Succeeds', args)]),
    },
  },
};

function canonicalRelational(
  ce: IComputeEngine,
  head: string,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  ops = flattenOps(flattenSequence(canonical(ops)), head);

  const nestedRelational: BoxedExpression[] = [];
  const newOps: BoxedExpression[] = [];
  // Separate any nested relational operators
  for (const op of ops) {
    if (isRelationalOperator(op)) {
      nestedRelational.push(op);
      newOps.push(op.ops![op.ops!.length - 1]);
    } else newOps.push(op);
  }

  if (nestedRelational.length === 0) return ce._fn(head, newOps);

  return ce._fn('And', [ce._fn(head, newOps), ...nestedRelational]);

  // if (!ops.every((op) => op.isValid))
}
