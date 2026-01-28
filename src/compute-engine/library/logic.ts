import type {
  BoxedExpression,
  SymbolDefinitions,
  ComputeEngine,
} from '../global-types';
import { asSmallInteger } from '../boxed-expression/numerics';

export const LOGIC_LIBRARY: SymbolDefinitions = {
  True: {
    wikidata: 'Q16751793',
    type: 'boolean',
    isConstant: true,
  },
  False: {
    wikidata: 'Q5432619',
    type: 'boolean',
    isConstant: true,
  },

  // @todo: specify a `canonical` function that converts boolean
  // expressions into CNF (Conjunctive Normal Form)
  // https://en.wikipedia.org/wiki/Conjunctive_normal_form
  // using rules (with a rule set that's kinda the inverse of the
  // logic rules for simplify)
  // See also: https://en.wikipedia.org/wiki/Prenex_normal_form
  And: {
    wikidata: 'Q191081',
    broadcastable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    complexity: 10000,
    signature: '(boolean+) -> boolean',
    evaluate: evaluateAnd,
  },
  Or: {
    wikidata: 'Q1651704',
    broadcastable: true,
    associative: true,
    commutative: true,
    idempotent: true,
    complexity: 10000,
    signature: '(boolean+) -> boolean',

    evaluate: evaluateOr,
  },
  Not: {
    wikidata: 'Q190558',
    broadcastable: true,
    involution: true,
    complexity: 10100,
    // @todo: this may not be needed, since we also have rules.
    signature: '(boolean) -> boolean',
    evaluate: evaluateNot,
  },
  Equivalent: {
    wikidata: 'Q220433',
    broadcastable: true,
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
    broadcastable: true,
    complexity: 10200,
    signature: '(boolean, boolean) -> boolean',
    evaluate: evaluateImplies,
  },
  // Quantifiers return boolean values (they are propositions)
  // They support evaluation over finite domains (e.g., ForAll with Element condition)
  // The first argument can be:
  // - a symbol (e.g., "x") for symbolic quantification
  // - an Element expression (e.g., ["Element", "x", ["Set", 1, 2, 3]]) for finite domain evaluation
  Exists: {
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: true,
    evaluate: evaluateExists,
  },
  NotExists: {
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: true,
    evaluate: (args, options) => {
      const result = evaluateExists(args, options);
      if (result?.symbol === 'True') return options.engine.False;
      if (result?.symbol === 'False') return options.engine.True;
      return undefined;
    },
  },
  ExistsUnique: {
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: true,
    evaluate: evaluateExistsUnique,
  },
  ForAll: {
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: true,
    evaluate: evaluateForAll,
  },
  NotForAll: {
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: true,
    evaluate: (args, options) => {
      const result = evaluateForAll(args, options);
      if (result?.symbol === 'True') return options.engine.False;
      if (result?.symbol === 'False') return options.engine.True;
      return undefined;
    },
  },

  KroneckerDelta: {
    description: 'Return 1 if the arguments are equal, 0 otherwise',
    signature: '(value+) -> integer',
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
    signature: '(boolean) -> integer',
    evaluate: (args, { engine: ce }) =>
      args[0].symbol === 'True' ? ce.One : ce.Zero,
  },
};

function evaluateAnd(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
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
  { engine: ce }: { engine: ComputeEngine }
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
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  const op1 = args[0]?.symbol;
  if (op1 === 'True') return ce.False;
  if (op1 === 'False') return ce.True;
  return undefined;
}

function evaluateEquivalent(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
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
  { engine: ce }: { engine: ComputeEngine }
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
  const fn = {
    And: evaluateAnd,
    Or: evaluateOr,
    Not: evaluateNot,
    Equivalent: evaluateEquivalent,
    Implies: evaluateImplies,
  }[x.operator];

  if (!fn || !x.ops) return undefined;

  const value = fn(x.ops, { engine: x.engine });
  if (!value) return undefined;

  return { value, because: 'logic' };
}

//
// Quantifier Evaluation
//

/**
 * Extract the finite domain from a quantifier's condition.
 * Supports:
 * - ["Element", "x", ["Set", 1, 2, 3]] → [1, 2, 3]
 * - ["Element", "x", ["Range", 1, 5]] → [1, 2, 3, 4, 5]
 * - ["Element", "x", ["Interval", 1, 5]] → [1, 2, 3, 4, 5] (integers only)
 * Returns null if the domain is not finite or not recognized.
 */
function extractFiniteDomain(
  condition: BoxedExpression,
  ce: ComputeEngine
): { variable: string; values: BoxedExpression[] } | null {
  // Check for ["Element", var, set] pattern
  if (condition.operator !== 'Element') return null;

  const variable = condition.op1?.symbol;
  if (!variable) return null;

  const domain = condition.op2;
  if (!domain) return null;

  // Handle explicit sets: ["Set", 1, 2, 3]
  if (domain.operator === 'Set' || domain.operator === 'List') {
    const values = domain.ops;
    if (values && values.length <= 1000) {
      return { variable, values: [...values] };
    }
    return null;
  }

  // Handle Range: ["Range", start, end] or ["Range", start, end, step]
  if (domain.operator === 'Range') {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);
    const step = domain.op3 ? asSmallInteger(domain.op3) : 1;

    if (start !== null && end !== null && step !== null && step !== 0) {
      const count = Math.floor((end - start) / step) + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          values.push(ce.number(i));
        }
        return { variable, values };
      }
    }
    return null;
  }

  // Handle finite integer Interval: ["Interval", start, end]
  if (domain.operator === 'Interval') {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);

    if (start !== null && end !== null) {
      const count = end - start + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; i <= end; i++) {
          values.push(ce.number(i));
        }
        return { variable, values };
      }
    }
    return null;
  }

  return null;
}

/**
 * Evaluate ForAll over a finite domain.
 * ∀x∈S. P(x) is true iff P(x) is true for all x in S.
 */
function evaluateForAll(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Try to extract a finite domain from the condition
  const domain = extractFiniteDomain(condition, ce);

  if (domain) {
    // Evaluate body for each value in the domain using substitution
    for (const value of domain.values) {
      // Substitute the variable with the value, canonicalize, then evaluate
      // Note: body may be non-canonical due to lazy evaluation, so we need
      // to canonicalize the substituted expression before evaluation
      const substituted = body.subs({ [domain.variable]: value }).canonical;
      const result = substituted.evaluate();

      if (result.symbol === 'False') {
        return ce.False; // Found a counterexample
      }
      if (result.symbol !== 'True') {
        // Can't determine truth value, return undefined
        return undefined;
      }
    }
    return ce.True; // All values satisfied the predicate
  }

  // No finite domain - check for simple symbolic cases
  // If body is already True or False, return it
  const bodyEval = body.canonical.evaluate();
  if (bodyEval.symbol === 'True') return ce.True;
  if (bodyEval.symbol === 'False') return ce.False;

  return undefined;
}

/**
 * Evaluate Exists over a finite domain.
 * ∃x∈S. P(x) is true iff P(x) is true for at least one x in S.
 */
function evaluateExists(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Try to extract a finite domain from the condition
  const domain = extractFiniteDomain(condition, ce);

  if (domain) {
    // Evaluate body for each value in the domain using substitution
    for (const value of domain.values) {
      // Substitute the variable with the value, canonicalize, then evaluate
      // Note: body may be non-canonical due to lazy evaluation, so we need
      // to canonicalize the substituted expression before evaluation
      const substituted = body.subs({ [domain.variable]: value }).canonical;
      const result = substituted.evaluate();

      if (result.symbol === 'True') {
        return ce.True; // Found a witness
      }
    }
    return ce.False; // No value satisfied the predicate
  }

  // No finite domain - check for simple symbolic cases
  const bodyEval = body.canonical.evaluate();
  if (bodyEval.symbol === 'True') return ce.True;
  if (bodyEval.symbol === 'False') return ce.False;

  return undefined;
}

/**
 * Evaluate ExistsUnique over a finite domain.
 * ∃!x∈S. P(x) is true iff exactly one x in S satisfies P(x).
 */
function evaluateExistsUnique(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Try to extract a finite domain from the condition
  const domain = extractFiniteDomain(condition, ce);

  if (domain) {
    let count = 0;
    // Evaluate body for each value in the domain using substitution
    for (const value of domain.values) {
      // Substitute the variable with the value, canonicalize, then evaluate
      // Note: body may be non-canonical due to lazy evaluation, so we need
      // to canonicalize the substituted expression before evaluation
      const substituted = body.subs({ [domain.variable]: value }).canonical;
      const result = substituted.evaluate();

      if (result.symbol === 'True') {
        count++;
        if (count > 1) return ce.False; // More than one witness
      } else if (result.symbol !== 'False') {
        // Can't determine truth value
        return undefined;
      }
    }
    return count === 1 ? ce.True : ce.False;
  }

  return undefined;
}

//
// CNF/DNF Conversion Functions
//

export const LOGIC_FUNCTION_LIBRARY: SymbolDefinitions = {
  /**
   * Convert a boolean expression to Conjunctive Normal Form (CNF).
   * CNF is a conjunction (And) of disjunctions (Or) of literals.
   * A literal is either a variable or its negation.
   *
   * Example: (A ∨ B) ∧ (¬A ∨ C)
   */
  ToCNF: {
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return toCNF(expr.evaluate(), ce);
    },
  },

  /**
   * Convert a boolean expression to Disjunctive Normal Form (DNF).
   * DNF is a disjunction (Or) of conjunctions (And) of literals.
   * A literal is either a variable or its negation.
   *
   * Example: (A ∧ B) ∨ (¬A ∧ C)
   */
  ToDNF: {
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return toDNF(expr.evaluate(), ce);
    },
  },
};

/**
 * Convert a boolean expression to Negation Normal Form (NNF).
 * In NNF, negations only appear directly before variables (literals).
 * This is a prerequisite for CNF/DNF conversion.
 */
function toNNF(expr: BoxedExpression, ce: ComputeEngine): BoxedExpression {
  const op = expr.operator;

  // Base cases
  if (!op) return expr;
  if (expr.symbol === 'True' || expr.symbol === 'False') return expr;

  // Handle Not
  if (op === 'Not') {
    const inner = expr.op1;
    if (!inner) return expr;

    const innerOp = inner.operator;

    // Double negation: ¬¬A → A
    if (innerOp === 'Not') {
      return toNNF(inner.op1, ce);
    }

    // De Morgan's law: ¬(A ∧ B) → (¬A ∨ ¬B)
    if (innerOp === 'And') {
      const negatedOps = inner.ops!.map((x) => toNNF(ce._fn('Not', [x]), ce));
      return ce._fn('Or', negatedOps);
    }

    // De Morgan's law: ¬(A ∨ B) → (¬A ∧ ¬B)
    if (innerOp === 'Or') {
      const negatedOps = inner.ops!.map((x) => toNNF(ce._fn('Not', [x]), ce));
      return ce._fn('And', negatedOps);
    }

    // ¬True → False, ¬False → True
    if (inner.symbol === 'True') return ce.False;
    if (inner.symbol === 'False') return ce.True;

    // Negation of implication: ¬(A → B) → (A ∧ ¬B)
    if (innerOp === 'Implies') {
      const a = inner.op1;
      const b = inner.op2;
      return toNNF(ce._fn('And', [a, ce._fn('Not', [b])]), ce);
    }

    // Negation of equivalence: ¬(A ↔ B) → (A ∧ ¬B) ∨ (¬A ∧ B)
    if (innerOp === 'Equivalent') {
      const a = inner.op1;
      const b = inner.op2;
      return toNNF(
        ce._fn('Or', [
          ce._fn('And', [a, ce._fn('Not', [b])]),
          ce._fn('And', [ce._fn('Not', [a]), b]),
        ]),
        ce
      );
    }

    // Literal: ¬x stays as is
    return expr;
  }

  // Handle Implies: A → B ≡ ¬A ∨ B
  if (op === 'Implies') {
    const a = expr.op1;
    const b = expr.op2;
    return toNNF(ce._fn('Or', [ce._fn('Not', [a]), b]), ce);
  }

  // Handle Equivalent: A ↔ B ≡ (A → B) ∧ (B → A) ≡ (¬A ∨ B) ∧ (¬B ∨ A)
  if (op === 'Equivalent') {
    const a = expr.op1;
    const b = expr.op2;
    return toNNF(
      ce._fn('And', [
        ce._fn('Or', [ce._fn('Not', [a]), b]),
        ce._fn('Or', [ce._fn('Not', [b]), a]),
      ]),
      ce
    );
  }

  // Handle Xor: A ⊕ B ≡ (A ∨ B) ∧ (¬A ∨ ¬B)
  if (op === 'Xor') {
    const a = expr.op1;
    const b = expr.op2;
    return toNNF(
      ce._fn('And', [
        ce._fn('Or', [a, b]),
        ce._fn('Or', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
      ]),
      ce
    );
  }

  // Recursively process And/Or
  if (op === 'And' || op === 'Or') {
    const nnfOps = expr.ops!.map((x) => toNNF(x, ce));
    return ce._fn(op, nnfOps);
  }

  return expr;
}

/**
 * Distribute Or over And to get CNF.
 * (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
 */
function distributeOrOverAnd(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const op = expr.operator;

  if (op !== 'Or') {
    if (op === 'And') {
      return ce._fn(
        'And',
        expr.ops!.map((x) => distributeOrOverAnd(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ors
  const orOperands: BoxedExpression[] = [];
  for (const operand of expr.ops!) {
    if (operand.operator === 'Or') {
      orOperands.push(...operand.ops!);
    } else {
      orOperands.push(operand);
    }
  }

  // Find an And operand to distribute over
  const andIndex = orOperands.findIndex((x) => x.operator === 'And');
  if (andIndex === -1) {
    // No And to distribute, we're done
    return expr;
  }

  const andExpr = orOperands[andIndex];
  const otherOperands = [
    ...orOperands.slice(0, andIndex),
    ...orOperands.slice(andIndex + 1),
  ];
  const otherOr =
    otherOperands.length === 1 ? otherOperands[0] : ce._fn('Or', otherOperands);

  // Distribute: (A ∧ B) ∨ C → (A ∨ C) ∧ (B ∨ C)
  const distributed = ce._fn(
    'And',
    andExpr.ops!.map((x) => ce._fn('Or', [x, otherOr]))
  );

  // Recursively distribute
  return distributeOrOverAnd(distributed, ce);
}

/**
 * Convert a boolean expression to Conjunctive Normal Form (CNF).
 */
function toCNF(expr: BoxedExpression, ce: ComputeEngine): BoxedExpression {
  // First convert to NNF
  const nnf = toNNF(expr, ce);

  // Then distribute Or over And
  const cnf = distributeOrOverAnd(nnf, ce);

  // Simplify the result
  return cnf.simplify();
}

/**
 * Distribute And over Or to get DNF.
 * (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
 */
function distributeAndOverOr(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const op = expr.operator;

  if (op !== 'And') {
    if (op === 'Or') {
      return ce._fn(
        'Or',
        expr.ops!.map((x) => distributeAndOverOr(x, ce))
      );
    }
    return expr;
  }

  // Collect all operands, flattening nested Ands
  const andOperands: BoxedExpression[] = [];
  for (const operand of expr.ops!) {
    if (operand.operator === 'And') {
      andOperands.push(...operand.ops!);
    } else {
      andOperands.push(operand);
    }
  }

  // Find an Or operand to distribute over
  const orIndex = andOperands.findIndex((x) => x.operator === 'Or');
  if (orIndex === -1) {
    // No Or to distribute, we're done
    return expr;
  }

  const orExpr = andOperands[orIndex];
  const otherOperands = [
    ...andOperands.slice(0, orIndex),
    ...andOperands.slice(orIndex + 1),
  ];
  const otherAnd =
    otherOperands.length === 1
      ? otherOperands[0]
      : ce._fn('And', otherOperands);

  // Distribute: (A ∨ B) ∧ C → (A ∧ C) ∨ (B ∧ C)
  const distributed = ce._fn(
    'Or',
    orExpr.ops!.map((x) => ce._fn('And', [x, otherAnd]))
  );

  // Recursively distribute
  return distributeAndOverOr(distributed, ce);
}

/**
 * Convert a boolean expression to Disjunctive Normal Form (DNF).
 */
function toDNF(expr: BoxedExpression, ce: ComputeEngine): BoxedExpression {
  // First convert to NNF
  const nnf = toNNF(expr, ce);

  // Then distribute And over Or
  const dnf = distributeAndOverOr(nnf, ce);

  // Simplify the result
  return dnf.simplify();
}
