import type {
  BoxedExpression,
  SymbolDefinitions,
  ComputeEngine,
} from '../global-types';
import {
  evaluateAnd,
  evaluateOr,
  evaluateNot,
  evaluateEquivalent,
  evaluateImplies,
  evaluateXor,
  evaluateNand,
  evaluateNor,
  toNNF,
  toCNF,
  toDNF,
} from './logic-utils';
import {
  extractFiniteDomain,
  bodyContainsVariable,
  collectNestedDomains,
  getInnermostBody,
  evaluateForAllCartesian,
  evaluateExistsCartesian,
  isSatisfiable,
  isTautology,
  generateTruthTable,
} from './logic-analysis';

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

  // Predicate application in First-Order Logic.
  // ["Predicate", "P", "x"] represents the predicate P applied to x.
  // This is semantically different from a function application: predicates
  // return boolean values and are used in logical formulas.
  // In LaTeX, P(x) inside a quantifier context parses to ["Predicate", "P", "x"].
  Predicate: {
    description: 'Apply a predicate to arguments, returning a boolean',
    signature: '(symbol, value+) -> boolean',
    lazy: true,
    // Predicates remain symbolic unless explicitly defined
    evaluate: (args, { engine }) => {
      if (args.length === 0) return undefined;
      const pred = args[0];
      if (!pred.symbol) return undefined;
      // Could check if the predicate has a definition and evaluate it
      // For now, predicates remain symbolic
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
        [
          { variable: domain.variable, values: domain.values },
          ...nestedDomains,
        ],
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
        [
          { variable: domain.variable, values: domain.values },
          ...nestedDomains,
        ],
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
   *
   * Returns `True` if there exists an assignment of truth values to variables
   * that makes the expression true, `False` if no such assignment exists.
   *
   * **Performance**: Uses brute-force enumeration with O(2^n) complexity.
   * Limited to 20 variables; larger expressions return unevaluated.
   * Expressions with 15+ variables may take noticeable time (~10ms+).
   */
  IsSatisfiable: {
    description:
      'Check satisfiability using brute-force enumeration. O(2^n) complexity, max 20 variables.',
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return isSatisfiable(expr, ce);
    },
  },

  /**
   * Check if a boolean expression is a tautology.
   *
   * Returns `True` if the expression is true for all possible assignments
   * of truth values to variables, `False` otherwise.
   *
   * **Performance**: Uses brute-force enumeration with O(2^n) complexity.
   * Limited to 20 variables; larger expressions return unevaluated.
   * Expressions with 15+ variables may take noticeable time (~10ms+).
   */
  IsTautology: {
    description:
      'Check if expression is a tautology using brute-force enumeration. O(2^n) complexity, max 20 variables.',
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return isTautology(expr, ce);
    },
  },

  /**
   * Generate a truth table for a boolean expression.
   *
   * Returns a `List` of `List`s, where the first row contains column headers
   * (variable names followed by "Result") and subsequent rows contain the
   * truth values for each assignment.
   *
   * **Performance**: Generates all 2^n rows with O(2^n) time and space.
   * Limited to 10 variables (stricter than SAT/tautology checks due to
   * memory requirements); larger expressions return unevaluated.
   *
   * @example
   * TruthTable(["And", "A", "B"]) returns:
   * [["List", "A", "B", "Result"],
   *  ["List", False, False, False],
   *  ["List", False, True, False],
   *  ["List", True, False, False],
   *  ["List", True, True, True]]
   */
  TruthTable: {
    description:
      'Generate truth table for expression. O(2^n) complexity, max 10 variables.',
    signature: '(boolean) -> list',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      return generateTruthTable(expr, ce);
    },
  },
};
