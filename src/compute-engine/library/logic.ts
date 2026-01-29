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
  Xor: {
    description: 'Exclusive or: true when an odd number of operands are true',
    wikidata: 'Q498186',
    broadcastable: true,
    associative: true,
    commutative: true,
    complexity: 10200,
    signature: '(boolean+) -> boolean',
    evaluate: evaluateXor,
  },
  Nand: {
    description: 'Not-and: negation of conjunction',
    wikidata: 'Q189550',
    broadcastable: true,
    commutative: true,
    complexity: 10200,
    signature: '(boolean+) -> boolean',
    evaluate: evaluateNand,
  },
  Nor: {
    description: 'Not-or: negation of disjunction',
    wikidata: 'Q189561',
    broadcastable: true,
    commutative: true,
    complexity: 10200,
    signature: '(boolean+) -> boolean',
    evaluate: evaluateNor,
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

function evaluateXor(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary XOR is true when an odd number of operands are true
  // (equivalent to parity check)
  if (args.length === 0) return ce.False;

  let trueCount = 0;
  const unknowns: BoxedExpression[] = [];

  for (const arg of args) {
    if (arg.symbol === 'True') {
      trueCount++;
    } else if (arg.symbol === 'False') {
      // False doesn't change parity
    } else {
      unknowns.push(arg);
    }
  }

  // If all arguments are known, return the result
  if (unknowns.length === 0) {
    return trueCount % 2 === 1 ? ce.True : ce.False;
  }

  // Partial evaluation: XOR with known True values flips the result
  // XOR(True, x) = NOT(x), XOR(False, x) = x
  if (unknowns.length === 1 && trueCount % 2 === 1) {
    // Odd number of Trues with one unknown = NOT(unknown)
    return ce._fn('Not', [unknowns[0]]);
  }
  if (unknowns.length === 1 && trueCount % 2 === 0) {
    // Even number of Trues with one unknown = unknown
    return unknowns[0];
  }

  return undefined;
}

function evaluateNand(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary NAND is the negation of AND
  // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
  if (args.length === 0) return ce.False; // NOT(True) = False

  // If any argument is False, AND is False, so NAND is True
  for (const arg of args) {
    if (arg.symbol === 'False') return ce.True;
  }

  // Check if all are True
  let allTrue = true;
  for (const arg of args) {
    if (arg.symbol !== 'True') {
      allTrue = false;
      break;
    }
  }

  if (allTrue) return ce.False; // NOT(True) = False

  return undefined;
}

function evaluateNor(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  // N-ary NOR is the negation of OR
  // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
  if (args.length === 0) return ce.True; // NOT(False) = True

  // If any argument is True, OR is True, so NOR is False
  for (const arg of args) {
    if (arg.symbol === 'True') return ce.False;
  }

  // Check if all are False
  let allFalse = true;
  for (const arg of args) {
    if (arg.symbol !== 'False') {
      allFalse = false;
      break;
    }
  }

  if (allFalse) return ce.True; // NOT(False) = True

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
    Xor: evaluateXor,
    Nand: evaluateNand,
    Nor: evaluateNor,
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
    // op3 may be Nothing (a symbol) when not specified, so check ops length
    const step =
      domain.ops && domain.ops.length >= 3
        ? asSmallInteger(domain.op3)
        : 1;

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
 * Check if an expression contains a reference to a specific variable.
 */
function bodyContainsVariable(expr: BoxedExpression, variable: string): boolean {
  if (expr.symbol === variable) return true;
  if (expr.ops) {
    for (const op of expr.ops) {
      if (bodyContainsVariable(op, variable)) return true;
    }
  }
  return false;
}

/**
 * For nested quantifiers like ∀x∈S. ∀y∈T. P(x,y), collect the inner domains.
 * Returns an array of {variable, values} for nested ForAll/Exists with finite domains.
 */
function collectNestedDomains(
  body: BoxedExpression,
  ce: ComputeEngine
): { variable: string; values: BoxedExpression[] }[] {
  const canonicalBody = body.canonical;
  const op = canonicalBody.operator;

  // Only collect from same quantifier type (ForAll or Exists)
  if (op !== 'ForAll' && op !== 'Exists') return [];

  const condition = canonicalBody.op1;
  const innerBody = canonicalBody.op2;

  if (!condition || !innerBody) return [];

  const domain = extractFiniteDomain(condition, ce);
  if (!domain) return [];

  // Recursively collect from inner body
  const innerDomains = collectNestedDomains(innerBody, ce);

  return [{ variable: domain.variable, values: domain.values }, ...innerDomains];
}

/**
 * Get the innermost body of nested quantifiers.
 */
function getInnermostBody(body: BoxedExpression): BoxedExpression {
  const canonicalBody = body.canonical;
  const op = canonicalBody.operator;

  if (op === 'ForAll' || op === 'Exists') {
    const innerBody = canonicalBody.op2;
    if (innerBody) return getInnermostBody(innerBody);
  }

  return canonicalBody;
}

/**
 * Evaluate ForAll over a Cartesian product of domains.
 * Returns True if the predicate holds for all combinations.
 */
function evaluateForAllCartesian(
  domains: { variable: string; values: BoxedExpression[] }[],
  body: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  // Generate Cartesian product indices
  const indices = domains.map(() => 0);
  const lengths = domains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) return ce.True;

  while (true) {
    // Build substitution map for current combination
    const subs: Record<string, BoxedExpression> = {};
    for (let i = 0; i < domains.length; i++) {
      subs[domains[i].variable] = domains[i].values[indices[i]];
    }

    // Evaluate body with this combination
    const substituted = body.subs(subs).canonical;
    const result = substituted.evaluate();

    if (result.symbol === 'False') {
      return ce.False; // Found a counterexample
    }
    if (result.symbol !== 'True') {
      return undefined; // Can't determine
    }

    // Move to next combination
    let dim = domains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  return ce.True;
}

/**
 * Evaluate Exists over a Cartesian product of domains.
 * Returns True if the predicate holds for at least one combination.
 */
function evaluateExistsCartesian(
  domains: { variable: string; values: BoxedExpression[] }[],
  body: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  // Generate Cartesian product indices
  const indices = domains.map(() => 0);
  const lengths = domains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) return ce.False;

  while (true) {
    // Build substitution map for current combination
    const subs: Record<string, BoxedExpression> = {};
    for (let i = 0; i < domains.length; i++) {
      subs[domains[i].variable] = domains[i].values[indices[i]];
    }

    // Evaluate body with this combination
    const substituted = body.subs(subs).canonical;
    const result = substituted.evaluate();

    if (result.symbol === 'True') {
      return ce.True; // Found a witness
    }

    // Move to next combination
    let dim = domains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  return ce.False;
}

/**
 * Evaluate ForAll over a finite domain.
 * ∀x∈S. P(x) is true iff P(x) is true for all x in S.
 *
 * Symbolic simplifications:
 * - ∀x. True → True
 * - ∀x. False → False
 * - ∀x. P (where P doesn't contain x) → P
 *
 * Nested quantifiers:
 * - ∀x∈S. ∀y∈T. P(x,y) evaluates over the Cartesian product S × T
 */
function evaluateForAll(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Symbolic simplification: check if body is constant (doesn't depend on the variable)
  const canonicalBody = body.canonical;
  if (canonicalBody.symbol === 'True') return ce.True;
  if (canonicalBody.symbol === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const variable = condition.symbol ?? condition.op1?.symbol;
  if (variable && !bodyContainsVariable(canonicalBody, variable)) {
    // Body doesn't depend on x, so ∀x. P ≡ P
    return canonicalBody.evaluate();
  }

  // Try to extract a finite domain from the condition
  const domain = extractFiniteDomain(condition, ce);

  if (domain) {
    // Check for nested quantifiers - collect all domains for Cartesian product
    const nestedDomains = collectNestedDomains(body, ce);
    if (nestedDomains.length > 0) {
      // Evaluate over Cartesian product of all domains
      return evaluateForAllCartesian(
        [{ variable: domain.variable, values: domain.values }, ...nestedDomains],
        getInnermostBody(body),
        ce
      );
    }

    // Single quantifier - evaluate body for each value in the domain
    for (const value of domain.values) {
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

  // No finite domain - try evaluating the body
  const bodyEval = canonicalBody.evaluate();
  if (bodyEval.symbol === 'True') return ce.True;
  if (bodyEval.symbol === 'False') return ce.False;

  return undefined;
}

/**
 * Evaluate Exists over a finite domain.
 * ∃x∈S. P(x) is true iff P(x) is true for at least one x in S.
 *
 * Symbolic simplifications:
 * - ∃x. True → True
 * - ∃x. False → False
 * - ∃x. P (where P doesn't contain x) → P
 *
 * Nested quantifiers:
 * - ∃x∈S. ∃y∈T. P(x,y) evaluates over the Cartesian product S × T
 */
function evaluateExists(
  args: ReadonlyArray<BoxedExpression>,
  { engine: ce }: { engine: ComputeEngine }
): BoxedExpression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Symbolic simplification: check if body is constant (doesn't depend on the variable)
  const canonicalBody = body.canonical;
  if (canonicalBody.symbol === 'True') return ce.True;
  if (canonicalBody.symbol === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const variable = condition.symbol ?? condition.op1?.symbol;
  if (variable && !bodyContainsVariable(canonicalBody, variable)) {
    // Body doesn't depend on x, so ∃x. P ≡ P
    return canonicalBody.evaluate();
  }

  // Try to extract a finite domain from the condition
  const domain = extractFiniteDomain(condition, ce);

  if (domain) {
    // Check for nested quantifiers - collect all domains for Cartesian product
    const nestedDomains = collectNestedDomains(body, ce);
    if (nestedDomains.length > 0) {
      // Evaluate over Cartesian product of all domains
      return evaluateExistsCartesian(
        [{ variable: domain.variable, values: domain.values }, ...nestedDomains],
        getInnermostBody(body),
        ce
      );
    }

    // Single quantifier - evaluate body for each value in the domain
    for (const value of domain.values) {
      const substituted = body.subs({ [domain.variable]: value }).canonical;
      const result = substituted.evaluate();

      if (result.symbol === 'True') {
        return ce.True; // Found a witness
      }
    }
    return ce.False; // No value satisfied the predicate
  }

  // No finite domain - try evaluating the body
  const bodyEval = canonicalBody.evaluate();
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

  /**
   * Check if a boolean expression is satisfiable.
   * Returns True if there exists an assignment of truth values to variables
   * that makes the expression true.
   */
  IsSatisfiable: {
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return isSatisfiable(expr, ce);
    },
  },

  /**
   * Check if a boolean expression is a tautology.
   * Returns True if the expression is true for all possible assignments
   * of truth values to variables.
   */
  IsTautology: {
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return isTautology(expr, ce);
    },
  },

  /**
   * Generate a truth table for a boolean expression.
   * Returns a List of Lists, where each inner list contains the variable
   * assignments followed by the result.
   *
   * Example: TruthTable(["And", "A", "B"]) returns:
   * [["List", "A", "B", "Result"],
   *  ["List", False, False, False],
   *  ["List", False, True, False],
   *  ["List", True, False, False],
   *  ["List", True, True, True]]
   */
  TruthTable: {
    signature: '(boolean) -> list',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return generateTruthTable(expr, ce);
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

    // Negation of Xor: ¬(A ⊕ B) ≡ A ↔ B ≡ (A ∧ B) ∨ (¬A ∧ ¬B)
    if (innerOp === 'Xor') {
      const ops = inner.ops!;
      if (ops.length === 2) {
        const a = ops[0];
        const b = ops[1];
        return toNNF(
          ce._fn('Or', [
            ce._fn('And', [a, b]),
            ce._fn('And', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
          ]),
          ce
        );
      }
      // For n-ary Xor negation, first convert Xor to binary, then negate
      return toNNF(ce._fn('Not', [toNNF(inner, ce)]), ce);
    }

    // Negation of Nand: ¬NAND(A, B) ≡ A ∧ B
    if (innerOp === 'Nand') {
      return toNNF(ce._fn('And', inner.ops!), ce);
    }

    // Negation of Nor: ¬NOR(A, B) ≡ A ∨ B
    if (innerOp === 'Nor') {
      return toNNF(ce._fn('Or', inner.ops!), ce);
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
  // For n-ary Xor, we process pairwise
  if (op === 'Xor') {
    const ops = expr.ops!;
    if (ops.length === 2) {
      const a = ops[0];
      const b = ops[1];
      return toNNF(
        ce._fn('And', [
          ce._fn('Or', [a, b]),
          ce._fn('Or', [ce._fn('Not', [a]), ce._fn('Not', [b])]),
        ]),
        ce
      );
    }
    // For n-ary Xor, reduce: Xor(a, b, c) = Xor(Xor(a, b), c)
    if (ops.length > 2) {
      const first = ce._fn('Xor', [ops[0], ops[1]]);
      const rest = ops.slice(2);
      return toNNF(ce._fn('Xor', [first, ...rest]), ce);
    }
    if (ops.length === 1) return toNNF(ops[0], ce);
    return ce.False; // Empty Xor
  }

  // Handle Nand: NAND(A, B) ≡ ¬(A ∧ B) ≡ ¬A ∨ ¬B
  if (op === 'Nand') {
    const ops = expr.ops!;
    // NAND(a, b, c, ...) = NOT(AND(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('And', ops)]), ce);
  }

  // Handle Nor: NOR(A, B) ≡ ¬(A ∨ B) ≡ ¬A ∧ ¬B
  if (op === 'Nor') {
    const ops = expr.ops!;
    // NOR(a, b, c, ...) = NOT(OR(a, b, c, ...))
    return toNNF(ce._fn('Not', [ce._fn('Or', ops)]), ce);
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

//
// Satisfiability, Tautology, and Truth Table Functions
//

/**
 * Extract all propositional variables from a boolean expression.
 * Returns a sorted array of unique variable names.
 */
function extractVariables(expr: BoxedExpression): string[] {
  const variables = new Set<string>();

  function visit(e: BoxedExpression) {
    // Skip True/False constants
    if (e.symbol === 'True' || e.symbol === 'False') return;

    // If it's a symbol (variable), add it
    // Note: BoxedSymbol has operator === 'Symbol'
    if (e.symbol && e.operator === 'Symbol') {
      variables.add(e.symbol);
      return;
    }

    // Recursively process operands
    if (e.ops) {
      for (const op of e.ops) {
        visit(op);
      }
    }
  }

  visit(expr);
  return Array.from(variables).sort();
}

/**
 * Evaluate a boolean expression with a given truth assignment.
 * Returns True, False, or undefined if the expression cannot be evaluated.
 */
function evaluateWithAssignment(
  expr: BoxedExpression,
  assignment: Record<string, boolean>,
  ce: ComputeEngine
): BoxedExpression {
  // Build substitution map
  const subs: Record<string, BoxedExpression> = {};
  for (const [variable, value] of Object.entries(assignment)) {
    subs[variable] = value ? ce.True : ce.False;
  }

  // Substitute and evaluate
  const substituted = expr.subs(subs).canonical;
  return substituted.evaluate();
}

/**
 * Generate all possible truth assignments for a list of variables.
 * Each assignment is a Record mapping variable names to boolean values.
 */
function* generateAssignments(
  variables: string[]
): Generator<Record<string, boolean>> {
  const n = variables.length;
  const total = 1 << n; // 2^n combinations

  for (let i = 0; i < total; i++) {
    const assignment: Record<string, boolean> = {};
    for (let j = 0; j < n; j++) {
      // Use bit j of i to determine the value
      assignment[variables[j]] = ((i >> (n - 1 - j)) & 1) === 1;
    }
    yield assignment;
  }
}

/**
 * Check if a boolean expression is satisfiable.
 * Returns True if there exists an assignment that makes the expression true.
 */
function isSatisfiable(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return result.symbol === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion (2^n combinations)
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsSatisfiable', [expr]);
  }

  // Try all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (result.symbol === 'True') {
      return ce.True;
    }
  }

  return ce.False;
}

/**
 * Check if a boolean expression is a tautology.
 * Returns True if the expression is true for all possible assignments.
 */
function isTautology(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return result.symbol === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsTautology', [expr]);
  }

  // Check all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (result.symbol !== 'True') {
      return ce.False;
    }
  }

  return ce.True;
}

/**
 * Generate a truth table for a boolean expression.
 * Returns a List of Lists with headers and rows.
 */
function generateTruthTable(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Limit the number of variables to prevent explosion
  if (variables.length > 10) {
    // Too many rows to generate
    return ce._fn('TruthTable', [expr]);
  }

  const rows: BoxedExpression[] = [];

  // Header row: variable names + "Result"
  const header = ce._fn('List', [
    ...variables.map((v) => ce.string(v)),
    ce.string('Result'),
  ]);
  rows.push(header);

  // Generate all rows
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    const row = ce._fn('List', [
      ...variables.map((v) => (assignment[v] ? ce.True : ce.False)),
      result,
    ]);
    rows.push(row);
  }

  return ce._fn('List', rows);
}
