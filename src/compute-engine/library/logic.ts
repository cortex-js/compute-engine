import type {
  BoxedExpression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
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
  toCNF,
  toDNF,
} from '../symbolic/logic-utils';
import {
  isBoxedSymbol,
  isBoxedFunction,
  sym,
} from '../boxed-expression/type-guards';
import {
  extractFiniteDomainWithReason,
  bodyContainsVariable,
  collectNestedDomains,
  getInnermostBody,
  evaluateForAllCartesian,
  evaluateExistsCartesian,
  isSatisfiable,
  isTautology,
  generateTruthTable,
  findPrimeImplicants,
  findPrimeImplicates,
  minimalDNF,
  minimalCNF,
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
      const lhs = sym(args[0]);
      const rhs = sym(args[1]);
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
      if (sym(result) === 'True') return options.engine.False;
      if (sym(result) === 'False') return options.engine.True;
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
      if (sym(result) === 'True') return options.engine.False;
      if (sym(result) === 'False') return options.engine.True;
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
    evaluate: (args, { engine: _engine }) => {
      if (args.length === 0) return undefined;
      const pred = args[0];
      if (!isBoxedSymbol(pred)) return undefined;
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
        return sym(args[0]) === 'True' ? ce.One : ce.Zero;

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
      sym(args[0]) === 'True' ? ce.One : ce.Zero,
  },
};

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
  if (sym(canonicalBody) === 'True') return ce.True;
  if (sym(canonicalBody) === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const condOp1 = isBoxedFunction(condition) ? condition.op1 : undefined;
  const variable = sym(condition) ?? (condOp1 ? sym(condOp1) : undefined);
  if (variable && !bodyContainsVariable(canonicalBody, variable)) {
    // Body doesn't depend on x, so ∀x. P ≡ P
    return canonicalBody.evaluate();
  }

  // Try to extract a finite domain from the condition
  const domainResult = extractFiniteDomainWithReason(condition, ce);

  if (domainResult.status === 'success') {
    // Check for nested quantifiers - collect all domains for Cartesian product
    const nestedDomains = collectNestedDomains(body, ce);
    if (nestedDomains.length > 0) {
      // Evaluate over Cartesian product of all domains
      return evaluateForAllCartesian(
        [
          { variable: domainResult.variable, values: domainResult.values },
          ...nestedDomains,
        ],
        getInnermostBody(body),
        ce
      );
    }

    // Single quantifier - evaluate body for each value in the domain
    for (const value of domainResult.values) {
      const substituted = body.subs({
        [domainResult.variable]: value,
      }).canonical;
      const result = substituted.evaluate();

      if (sym(result) === 'False') {
        return ce.False; // Found a counterexample
      }
      if (sym(result) !== 'True') {
        // Can't determine truth value, return undefined
        return undefined;
      }
    }
    return ce.True; // All values satisfied the predicate
  }

  // No finite domain - try evaluating the body
  const bodyEval = canonicalBody.evaluate();
  if (sym(bodyEval) === 'True') return ce.True;
  if (sym(bodyEval) === 'False') return ce.False;

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
  if (sym(canonicalBody) === 'True') return ce.True;
  if (sym(canonicalBody) === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const condOp1 = isBoxedFunction(condition) ? condition.op1 : undefined;
  const variable = sym(condition) ?? (condOp1 ? sym(condOp1) : undefined);
  if (variable && !bodyContainsVariable(canonicalBody, variable)) {
    // Body doesn't depend on x, so ∃x. P ≡ P
    return canonicalBody.evaluate();
  }

  // Try to extract a finite domain from the condition
  const domainResult = extractFiniteDomainWithReason(condition, ce);

  if (domainResult.status === 'success') {
    // Check for nested quantifiers - collect all domains for Cartesian product
    const nestedDomains = collectNestedDomains(body, ce);
    if (nestedDomains.length > 0) {
      // Evaluate over Cartesian product of all domains
      return evaluateExistsCartesian(
        [
          { variable: domainResult.variable, values: domainResult.values },
          ...nestedDomains,
        ],
        getInnermostBody(body),
        ce
      );
    }

    // Single quantifier - evaluate body for each value in the domain
    for (const value of domainResult.values) {
      const substituted = body.subs({
        [domainResult.variable]: value,
      }).canonical;
      const result = substituted.evaluate();

      if (sym(result) === 'True') {
        return ce.True; // Found a witness
      }
    }
    return ce.False; // No value satisfied the predicate
  }

  // No finite domain - try evaluating the body
  const bodyEval = canonicalBody.evaluate();
  if (sym(bodyEval) === 'True') return ce.True;
  if (sym(bodyEval) === 'False') return ce.False;

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
  const domainResult = extractFiniteDomainWithReason(condition, ce);

  if (domainResult.status === 'success') {
    let count = 0;
    // Evaluate body for each value in the domain using substitution
    for (const value of domainResult.values) {
      // Substitute the variable with the value, canonicalize, then evaluate
      // Note: body may be non-canonical due to lazy evaluation, so we need
      // to canonicalize the substituted expression before evaluation
      const substituted = body.subs({
        [domainResult.variable]: value,
      }).canonical;
      const result = substituted.evaluate();

      if (sym(result) === 'True') {
        count++;
        if (count > 1) return ce.False; // More than one witness
      } else if (sym(result) !== 'False') {
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

  /**
   * Find all prime implicants of a boolean expression.
   *
   * A prime implicant is a minimal product term (conjunction of literals)
   * that implies the expression. Uses the Quine-McCluskey algorithm.
   *
   * **Performance**: O(3^n) worst case, limited to 12 variables.
   *
   * @example
   * PrimeImplicants(["Or", ["And", "A", "B"], ["And", "A", ["Not", "B"]]]])
   * → [A] (both AB and A¬B simplify to just A)
   */
  PrimeImplicants: {
    description:
      'Find all prime implicants using Quine-McCluskey. Max 12 variables.',
    signature: '(boolean) -> list',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      const result = findPrimeImplicants(expr, ce);
      if (result === null) {
        return ce._fn('PrimeImplicants', [expr]);
      }
      return ce._fn('List', result);
    },
  },

  /**
   * Find all prime implicates of a boolean expression.
   *
   * A prime implicate is a minimal sum term (disjunction of literals)
   * that is implied by the expression. These are the minimal clauses in CNF.
   *
   * **Performance**: O(3^n) worst case, limited to 12 variables.
   *
   * @example
   * PrimeImplicates(["And", "A", "B"])
   * → [A, B] (the expression implies both A and B separately)
   */
  PrimeImplicates: {
    description:
      'Find all prime implicates using Quine-McCluskey. Max 12 variables.',
    signature: '(boolean) -> list',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      const result = findPrimeImplicates(expr, ce);
      if (result === null) {
        return ce._fn('PrimeImplicates', [expr]);
      }
      return ce._fn('List', result);
    },
  },

  /**
   * Convert a boolean expression to minimal Disjunctive Normal Form (DNF).
   *
   * Uses the Quine-McCluskey algorithm to find prime implicants, then
   * selects a minimal cover. The result is a disjunction of conjunctions
   * of literals with the fewest terms possible.
   *
   * **Performance**: O(3^n) worst case, limited to 12 variables.
   *
   * @example
   * MinimalDNF(["Or", ["And", "A", "B"], ["And", "A", ["Not", "B"]], ["And", ["Not", "A"], "B"]])
   * → ["Or", "A", "B"] (simplified from 3 terms to 2)
   */
  MinimalDNF: {
    description:
      'Convert to minimal DNF using Quine-McCluskey. Max 12 variables.',
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      const result = minimalDNF(expr, ce);
      if (result === null) {
        return ce._fn('MinimalDNF', [expr]);
      }
      return result;
    },
  },

  /**
   * Convert a boolean expression to minimal Conjunctive Normal Form (CNF).
   *
   * Uses the Quine-McCluskey algorithm to find prime implicates, then
   * selects a minimal cover. The result is a conjunction of disjunctions
   * of literals with the fewest clauses possible.
   *
   * **Performance**: O(3^n) worst case, limited to 12 variables.
   *
   * @example
   * MinimalCNF(["Or", ["And", "A", "B"], ["And", "A", ["Not", "B"]]])
   * → A (the expression simplifies to just A)
   */
  MinimalCNF: {
    description:
      'Convert to minimal CNF using Quine-McCluskey. Max 12 variables.',
    signature: '(boolean) -> boolean',
    evaluate: ([expr], { engine: ce }) => {
      if (!expr) return undefined;
      const result = minimalCNF(expr, ce);
      if (result === null) {
        return ce._fn('MinimalCNF', [expr]);
      }
      return result;
    },
  },
};
