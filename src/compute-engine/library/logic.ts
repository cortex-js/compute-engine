import {
  BoxedExpression,
  IdentifierDefinitions,
  IComputeEngine,
} from '../public';

export const LOGIC_LIBRARY: IdentifierDefinitions = {
  True: { wikidata: 'Q16751793', type: 'boolean', constant: true },
  False: { wikidata: 'Q5432619', type: 'boolean', constant: true },

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
    signature: '(boolean, ...boolean) -> boolean',
    evaluate: evaluateAnd,
  },
  Or: {
    wikidata: 'Q1651704',
    threadable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    complexity: 10000,
    signature: '(boolean, ...boolean) -> boolean',

    evaluate: evaluateOr,
  },
  Not: {
    wikidata: 'Q190558',
    threadable: true,
    involution: true,
    complexity: 10100,
    // @todo: this may not be needed, since we also have rules.
    signature: 'boolean -> boolean',
    evaluate: evaluateNot,
  },
  Equivalent: {
    wikidata: 'Q220433',
    threadable: true,
    complexity: 10200,
    signature: '(boolean, boolean) -> boolean',
    canonical: (args: BoxedExpression[], { engine: ce }) => {
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
    evaluate: evaluateEquivalent,
  },
  Implies: {
    wikidata: 'Q7881229',
    threadable: true,
    complexity: 10200,
    signature: '(boolean, boolean) -> boolean',
    evaluate: evaluateImplies,
  },
  Exists: { signature: 'function', hold: true },
  ExistsUnique: { signature: 'function', hold: true },
  ForAll: { signature: 'function', hold: true },

  KroneckerDelta: {
    description: 'Return 1 if the arguments are equal, 0 otherwise',
    signature: '(value, ...value) -> integer',
    evaluate: (args, { engine: ce }) => {
      if (args.length === 1)
        return args[0].symbol === 'True' ? ce.One : ce.Zero;

      if (args.length === 2) return args[0].isEqual(args[1]) ? ce.One : ce.Zero;

      // More than two arguments: they should all be equal
      for (let i = 1; i < args.length; i++) {
        if (!args[i].isEqual(args[0])) return ce.Zero;
      }
      return ce.One;
    },
  },

  // Iverson bracket
  Boole: {
    description:
      'Return 1 if the argument is true, 0 otherwise. Also known as the Iverson bracket',
    signature: 'boolean -> integer',
    evaluate: (args, { engine: ce }) =>
      args[0].symbol === 'True' ? ce.One : ce.Zero,
  },
};

function evaluateAnd(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
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
          (arg.operator === 'Not' && arg.op1.isSame(x)) ||
          (x.operator === 'Not' && x.op1.isSame(arg))
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

function evaluateOr(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
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
          (arg.operator === 'Not' && arg.op1.isSame(x)) ||
          (x.operator === 'Not' && x.op1.isSame(arg))
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

function evaluateNot(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
): BoxedExpression | undefined {
  const op1 = args[0]?.symbol;
  if (op1 === 'True') return ce.False;
  if (op1 === 'False') return ce.True;
  return undefined;
}

function evaluateEquivalent(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
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

function evaluateImplies(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: IComputeEngine }
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

export function simplifyLogicFunction(
  x: BoxedExpression
): { value: BoxedExpression; because: string } | undefined {
  const value = {
    And: evaluateAnd,
    Or: evaluateOr,
    Not: evaluateNot,
    Equivalent: evaluateEquivalent,

    Implies: evaluateImplies,
  }[x.operator]?.(x.engine, x.ops!);

  if (!value) return undefined;

  return { value, because: 'logic' };
}
