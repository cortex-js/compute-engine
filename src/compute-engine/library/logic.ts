import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
} from '../public';

export const LOGIC_LIBRARY: IdentifierDefinitions = {
  True: { wikidata: 'Q16751793', domain: 'Booleans', constant: true },
  False: {
    wikidata: 'Q5432619',
    domain: 'Booleans',
    constant: true,
  },
  // Maybe: {
  //   wikidata: 'Q781546',
  //   domain: 'MaybeBooleans',
  //   constant: true,
  // },
  // @todo: specify a `canonical` function that converts boolean
  // expressions into CNF (Conjunctive Normal Form)
  // https://en.wikipedia.org/wiki/Conjunctive_normal_form
  // using rules (with a rule set that's kinda the inverse of the
  // logic rules for simplify)
  // See also: https://en.wikipedia.org/wiki/Prenex_normal_form
  And: {
    wikidata: 'Q191081',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    complexity: 10000,
    signature: {
      domain: 'LogicOperators',
      simplify: processAnd,
      evaluate: processAnd,
    },
  },
  Or: {
    wikidata: 'Q1651704',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    complexity: 10000,
    signature: {
      domain: 'LogicOperators',
      simplify: processOr,
      evaluate: processOr,
    },
  },
  Not: {
    wikidata: 'Q190558',
    threadable: true,
    involution: true,
    complexity: 10100,
    // @todo: this may not be needed, since we also have rules.
    signature: {
      domain: 'LogicOperators',
      simplify: processNot,
      evaluate: processNot,
    },
  },
  Equivalent: {
    wikidata: 'Q220433',
    threadable: true,
    complexity: 10200,
    signature: {
      domain: 'LogicOperators',
      canonical: (ce: IComputeEngine, args: BoxedExpression[]) => {
        const lhs = args[0].symbol;
        const rhs = args[1].symbol;
        if (
          (lhs === 'True' && rhs === 'True') ||
          (lhs === 'False' && rhs === 'False')
        )
          return ce.True;
        if (
          (lhs === 'True' && rhs === 'False') ||
          (lhs === 'False' && rhs === 'True')
        )
          return ce.False;
        return ce._fn('Equivalent', args);
      },
      simplify: processEquivalent,
      evaluate: processEquivalent,
    },
  },
  Implies: {
    wikidata: 'Q7881229',
    threadable: true,
    complexity: 10200,
    signature: {
      domain: 'LogicOperators',
      simplify: processImplies,
      evaluate: processImplies,
    },
  },
  Exists: { signature: { domain: 'Functions' }, hold: 'all' },
  ExistsUnique: { signature: { domain: 'Functions' }, hold: 'all' },
  ForAll: { signature: { domain: 'Functions' }, hold: 'all' },

  KroneckerDelta: {
    signature: {
      domain: 'Functions',
      evaluate: (ce, args) => {
        if (args.length === 1)
          return args[0].symbol === 'True' ? ce.One : ce.Zero;

        if (args.length === 2)
          return args[0].isEqual(args[1]) ? ce.One : ce.Zero;

        // More than two arguments: they should all be equal
        for (let i = 1; i < args.length; i++) {
          if (!args[i].isEqual(args[0])) return ce.Zero;
        }
        return ce.One;
      },
    },
  },

  // Iverson bracket
  Boole: {
    signature: {
      domain: 'Functions',
      evaluate: (ce, args) => (args[0].symbol === 'True' ? ce.One : ce.Zero),
    },
  },
};

function processAnd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  if (args.length === 0) return ce.True;
  const ops: BoxedExpression[] = [];
  for (const arg of args) {
    // ['And', ... , 'False', ...] -> 'False'
    if (arg.symbol === 'False') return ce.False;
    if (arg.symbol !== 'True') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['And', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.head === 'Not' && arg.op1.isSame(x)) ||
          (x.head === 'Not' && x.op1.isSame(arg))
        ) {
          // ['And', ['Not', a],... a]
          // Contradiction
          return ce.False;
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.True;
  if (ops.length === 1) return ops[0];
  return ce._fn('And', ops);
}

function processOr(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  if (args.length === 0) return ce.True;
  const ops: BoxedExpression[] = [];
  for (const arg of args) {
    // ['Or', ... , 'True', ...] -> 'True'
    if (arg.symbol === 'True') return ce.True;
    if (arg.symbol !== 'False') {
      //Check if arg matches one of the tail elements
      let duplicate = false;
      for (const x of ops) {
        if (x.isSame(arg)) {
          // ['Or', a, ..., a]
          // Duplicate element, ignore it
          duplicate = true;
        } else if (
          (arg.head === 'Not' && arg.op1.isSame(x)) ||
          (x.head === 'Not' && x.op1.isSame(arg))
        ) {
          // ['Or', ['Not', a],... a]
          // Tautology
          return ce.True;
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.False;
  if (ops.length === 1) return ops[0];
  return ce._fn('Or', ops);
}

function processNot(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  const op1 = args[0]?.symbol;
  if (op1 === 'True') return ce.False;
  if (op1 === 'False') return ce.True;
  return undefined;
}

function processEquivalent(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  const lhs = args[0].symbol;
  const rhs = args[1].symbol;
  if (
    (lhs === 'True' && rhs === 'True') ||
    (lhs === 'False' && rhs === 'False')
  )
    return ce.True;
  if (
    (lhs === 'True' && rhs === 'False') ||
    (lhs === 'False' && rhs === 'True')
  )
    return ce.False;
  return undefined;
}

function processImplies(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  const lhs = args[0].symbol;
  const rhs = args[1].symbol;
  if (
    (lhs === 'True' && rhs === 'True') ||
    (lhs === 'False' && rhs === 'False') ||
    (lhs === 'False' && rhs === 'True')
  )
    return ce.True;
  if (lhs === 'True' && rhs === 'False') return ce.False;
  return undefined;
}
