import { BoxedExpression, SymbolTable, IComputeEngine } from '../public';

export const LOGIC_LIBRARY: SymbolTable = {
  symbols: [
    { name: 'True', wikidata: 'Q16751793', domain: 'Boolean', constant: true },
    {
      name: 'False',
      wikidata: 'Q5432619',
      domain: 'Boolean',
      constant: true,
    },
    {
      name: 'Maybe',
      wikidata: 'Q781546',
      domain: 'MaybeBoolean',
      constant: true,
    },
  ],
  functions: [
    // @todo: specify a `canonical` function that converts boolean
    // expressions into CNF (Conjunctive Normal Form)
    // https://en.wikipedia.org/wiki/Conjunctive_normal_form
    // using rules (with a rule set that's kinda the inverse of the
    // logic rules for simplify
    {
      name: 'And',
      wikidata: 'Q191081',
      threadable: true,
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 10000,
      signature: {
        domain: 'LogicOperator',
        simplify: processAnd,
        evaluate: processAnd,
      },
    },
    {
      name: 'Or',
      wikidata: 'Q1651704',
      threadable: true,
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 10000,
      signature: {
        domain: 'LogicOperator',
        simplify: processOr,
        evaluate: processOr,
      },
    },
    {
      name: 'Not',
      wikidata: 'Q190558',
      involution: true,
      complexity: 10100,
      // @todo: this may not be needed, since we also have rules.
      signature: {
        domain: 'LogicOperator',
        simplify: processNot,
        evaluate: processNot,
      },
    },
    {
      name: 'Equivalent',
      wikidata: 'Q220433',
      complexity: 10200,
      signature: {
        domain: 'LogicOperator',
        simplify: processEquivalent,
        evaluate: processEquivalent,
      },
    },
    {
      name: 'Implies',
      wikidata: 'Q7881229',
      complexity: 10200,
      signature: {
        domain: 'LogicOperator',
        simplify: processImplies,
        evaluate: processImplies,
      },
    },
    { name: 'Exists', signature: { domain: 'MaybeBoolean' } },

    {
      name: 'If',
      hold: 'rest',
      signature: {
        domain: 'Function',
        codomain: (ce, ops) => ce.domain(['Union', ops[0], ops[1]]),
        simplify: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].simplify() : ce.box('Nothing');
          return ops[2] ? ops[2].simplify() : ce.box('Nothing');
        },
        evaluate: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].evaluate() : ce.box('Nothing');
          return ops[2] ? ops[2].evaluate() : ce.box('Nothing');
        },
        N: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].N() : ce.box('Nothing');
          return ops[2] ? ops[2].N() : ce.box('Nothing');
        },
      },
    },

    {
      name: 'Loop',
      hold: 'all',
      signature: {
        domain: 'Function',
        simplify: (ce, ops) => ops[0]?.simplify() ?? ce.box('Nothing'),
        evaluate: (ce, ops) => {
          const body = ops[0] ?? ce.box('Nothing');
          if (body.symbol === 'Nothing') return body;
          let result: BoxedExpression;
          let i = 0;
          do {
            result = body.evaluate();
            i += 1;
          } while (result.head !== 'Return' && i < ce.iterationLimit);
          if (result.head === 'Return') return result.op1;
          return ce.error('iteration-limit-exceeded');
        },
        N: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].N() : ce.box('Nothing');
          return ops[2] ? ops[2].N() : ce.box('Nothing');
        },
      },
    },
  ],
};

function processAnd(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  if (args.length === 0) return ce.symbol('True');
  const ops: BoxedExpression[] = [];
  for (const arg of args) {
    // ['And', ... , 'False', ...] -> 'False'
    if (arg.symbol === 'False') return ce.symbol('False');
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
          // Contradition
          return ce.symbol('False');
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.symbol('True');
  if (ops.length === 1) return ops[0];
  return ce._fn('And', ops);
}

function processOr(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  if (args.length === 0) return ce.symbol('True');
  const ops: BoxedExpression[] = [];
  for (const arg of args) {
    // ['Or', ... , 'True', ...] -> 'True'
    if (arg.symbol === 'True') return ce.symbol('True');
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
          return ce.symbol('True');
        }
      }
      if (!duplicate) ops.push(arg);
    }
  }
  if (ops.length === 0) return ce.symbol('True');
  if (ops.length === 1) return ops[0];
  return ce._fn('Or', ops);
}

function processNot(
  ce: IComputeEngine,
  args: BoxedExpression[]
): BoxedExpression | undefined {
  const op1 = args[0].symbol;
  if (op1 === 'True') return ce.symbol('False');
  if (op1 === 'False') return ce.symbol('True');
  if (op1 === 'Maybe') return ce.symbol('Maybe');
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
    return ce.symbol('True');
  if (
    (lhs === 'True' && rhs === 'False') ||
    (lhs === 'False' && rhs === 'True')
  )
    return ce.symbol('False');
  if (lhs === 'Maybe' || rhs === 'Maybe') return ce.symbol('Maybe');
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
    return ce.symbol('True');
  if (lhs === 'True' && rhs === 'False') return ce.symbol('False');
  if (lhs === 'Maybe' || rhs === 'Maybe') return ce.symbol('Maybe');
  return undefined;
}
