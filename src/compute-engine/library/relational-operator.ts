import { equalOrder } from '../boxed-expression/order';
import { isRelationalOperator } from '../boxed-expression/utils';
import {
  BoxedExpression,
  FunctionDefinition,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { flatten } from '../boxed-expression/flatten';

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
    description: 'Indicate that two expressions are congruent modulo a number',
    complexity: 11000,
    signature: '(number, number, modulo: integer) -> boolean',
    evaluate: (ops, { engine: ce }) => {
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

  IsSame: {
    description: 'Compare two expressions for structural equality',
    hold: true,
    commutative: true,
    commutativeOrder: equalOrder,
    signature: '(any, any) -> boolean',

    // Since we want to work on non-canonical expressions,
    // do nothing to canonicalize the arguments
    evaluate: (ops, { engine: ce }) => {
      if (ops.length !== 2) return undefined;
      const [lhs, rhs] = ops;
      return lhs.isSame(rhs) === true ? ce.True : ce.False;
    },
  },

  Equal: {
    commutative: true,
    commutativeOrder: equalOrder,
    complexity: 11000,
    signature: '(any, any) -> boolean',

    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Equal', args),

    // Comparing two equalities...
    eq: (a, b) => {
      if (a.operator !== b.operator) return false;
      // Equality is commutative
      if (
        (a.op1.isEqual(b.op1) && a.op2.isEqual(b.op2)) ||
        (a.op1.isEqual(b.op2) && a.op2.isEqual(b.op1))
      )
        return true;
      return false;
    },

    evaluate: (ops, { engine: ce }) => {
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
  } as FunctionDefinition,

  NotEqual: {
    wikidata: 'Q28113351',
    commutative: true,
    commutativeOrder: equalOrder,
    complexity: 11000,

    signature: '(any, any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'NotEqual', args),

    // Comparing two equalities...
    eq: (a, b) => {
      if (a.operator !== b.operator) return false;
      // Equality is commutative
      if (
        (a.op1.isEqual(b.op1) && a.op2.isEqual(b.op2)) ||
        (a.op1.isEqual(b.op2) && a.op2.isEqual(b.op1))
      )
        return true;
      return false;
    },

    evaluate: (ops, { engine: ce }) => {
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
  } as FunctionDefinition,

  Less: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',

    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Less', ops),

    eq: (a, b) => inequalityEq(a, b, 'Greater'),

    evaluate: (ops, { engine: ce }) => {
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        const cmp = lhs.isLess(rhs);
        if (cmp === undefined) return undefined;
        return cmp ? ce.True : ce.False;
      }
      if (ops.length < 2) return ce.True;
      // Less can have multiple arguments, i.e. a < b < c < d
      let lhs: BoxedExpression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const cmp = arg.isLess(lhs);
          if (cmp === undefined) return undefined;
          if (cmp === false) return ce.False;
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as FunctionDefinition,

  NotLess: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Less', ops)]),
  },

  Greater: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'Less', [...ops].reverse()),
  },

  NotGreater: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [ce._fn('Greater', args)]),
  },

  LessEqual: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',

    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', ops),

    eq: (a, b) => inequalityEq(a, b, 'LessGreater'),

    evaluate: (ops, { engine: ce }) => {
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        const cmp = lhs.isLessEqual(rhs);
        if (cmp === undefined) return undefined;
        return cmp ? ce.True : ce.False;
      }
      if (ops.length < 2) return ce.True;
      // LessEqual can have multiple arguments, i.e. a <= b <= c <= d
      let lhs: BoxedExpression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const cmp = arg.isLessEqual(lhs);
          if (cmp === undefined) return undefined;
          if (cmp === false) return ce.False;
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as FunctionDefinition,

  NotLessNotEqual: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'LessEqual', ops)]),
  },

  GreaterEqual: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', [...args].reverse()),
  },

  NotGreaterNotEqual: {
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'GreaterEqual', args)]),
  },

  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: '(any, any, ...any) -> boolean',

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeFullEqual', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotTildeFullEqual: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeFullEqual', args)]),
  },

  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeEqual', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotTildeEqual: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeEqual', args)]),
  },

  Approx: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Approx', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApprox: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Approx', args)]),
  },

  ApproxEqual: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxEqual', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApproxEqual: {
    complexity: 11100,
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'ApproxEqual', args)]),
  },

  ApproxNotEqual: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxNotEqual', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotApproxNotEqual: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'ApproxNotEqual', args)]),
  },

  Precedes: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Precedes', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotPrecedes: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Precedes', args)]),
  },

  Succeeds: {
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Succeeds', args),
    // @todo evaluate: (ce, ...args: BoxedExpression[]) => SemiBoxedExpression {}
  },

  NotSucceeds: {
    complexity: 11100,
    signature: '(any, any, ...any) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Succeeds', args)]),
  },
};

function canonicalRelational(
  ce: IComputeEngine,
  operator: string,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  ops = flatten(ops, operator);

  const nestedRelational: BoxedExpression[] = [];
  const newOps: BoxedExpression[] = [];
  // Separate any nested relational operators
  for (const op of ops) {
    if (isRelationalOperator(op)) {
      nestedRelational.push(op);
      newOps.push(op.ops![op.ops!.length - 1]);
    } else newOps.push(op);
  }

  if (nestedRelational.length === 0) return ce._fn(operator, newOps);

  return ce._fn('And', [ce._fn(operator, newOps), ...nestedRelational]);

  // if (!ops.every((op) => op.isValid))
}

function inequalityEq(
  a: BoxedExpression,
  b: BoxedExpression,
  oppositeOperator?: string
): boolean {
  if (a.operator === b.operator) {
    if (a.nops !== b.nops) return false;
    return a.ops!.every((op, i) => op.isEqual(b.ops![i]));
  }

  if (b.operator === oppositeOperator) {
    if (a.nops !== b.nops) return false;
    return a.ops!.every((op, i) => op.isEqual(b.ops![b.nops - 1 - i]));
  }

  return false;
}
