import type { Type } from '../../common/type/types.js';
import type {
  Expression,
  OperandDescriptor,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
  Scope,
  EvaluateHandlerOptions,
  EvaluateOptions,
} from '../global-types.js';
import {
  acEquivalentBoolean,
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
} from '../symbolic/logic-utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isSymbol, isFunction, sym } from '../boxed-expression/type-guards.js';
import { limitsIndexSites } from '../boxed-expression/binding-sites.js';
import { validateArguments } from '../boxed-expression/validate.js';
import { flatten } from '../boxed-expression/flatten.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  isCollectionShaped,
  isFiniteBroadcastParticipant,
} from '../collection-utils.js';
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
} from './logic-analysis.js';

/**
 * The quantified variable is the first operand — either a bare symbol
 * (`ForAll(x, P)`) or the index of an `Element` domain spec
 * (`Exists(Element(x, {1,2,3}), P)`). Both shapes are what
 * `limitsIndexSites` already recognizes.
 *
 * Before this, the quantifiers were `scoped: true` with a `localScope` that was
 * created and stayed EMPTY forever, so the quantified variable was bound
 * wherever the caller had it: `∀x. x > 4` with `x := 5` assigned evaluated to
 * `True`, the bound occurrence having resolved the global's value
 * (`docs/SCOPING-MODEL.md` stage 8).
 */
const QUANTIFIER_SITES = limitsIndexSites(0);

/**
 * The quantifiers are `lazy`, so their operands arrive RAW — unbound and
 * uncanonicalized — on the `ce.box()` and `ce.parse()` routes (see the
 * "`lazy: true` operators with no `canonical` handler are inert" trap in
 * CLAUDE.md). Without this handler a *parenthesized* body kept its parse
 * sugar: `\forall n, (a, b)` came back as
 * `ForAll(n, Delimiter(Sequence(a, b)))` instead of `ForAll(n, Tuple(a, b))`,
 * and the serializer therefore could not delimit the body with parentheses
 * at all (the body is truncated at the first low-precedence operator without
 * them — see `serializeQuantifier`).
 *
 * `.canonical` is value-safe: it binds structure but does NOT substitute
 * assigned symbol values. The handler runs inside the quantifier's own scope,
 * with the bound variable already declared by the binder hook in `box.ts`.
 */
function canonicalQuantifier(
  name: string
): (
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
) => Expression {
  return (ops, { engine: ce, scope }) =>
    ce._fn(
      name,
      ops.map((x) => x.canonical),
      { scope }
    );
}

/**
 * `And` and `Or` are SHORT-CIRCUIT operators: their operands are evaluated
 * left to right, in the order written, and evaluation stops at the first
 * operand that decides the result (`False` for `And`, `True` for `Or`). The
 * remaining operands are never evaluated — no side effect, no error, no
 * random draw is produced by them. This is what the Epsil `&&`/`||`
 * operators lower to, what the JavaScript compilation target emits, and what
 * `docs/RANDOMNESS-MODEL.md` (draw order) and the left-to-right ruling of
 * `docs/TYPE_SYSTEM_ROADMAP.md` (ruling B8) promise.
 *
 * Two definition choices follow from this, both load-bearing:
 *
 * - The operators are `lazy`, so the driver hands the handler its operands
 *   UNEVALUATED and the handler evaluates them one at a time. Before this
 *   they were strict — every operand was evaluated before `evaluateAnd` saw a
 *   `False` — so `false && f()` still ran `f()`, and `i <= n && xs[i] > 0`
 *   still read `xs[i]` out of range.
 * - The operators are NOT declared `commutative`/`associative`: those flags
 *   sort the operands at canonicalization (`And(q, p)` boxed as
 *   `And(p, q)`), which destroys the written order that short-circuiting is
 *   defined over. Nested same-operator operands are still flattened
 *   (`And(And(a, b), c)` → `And(a, b, c)`, which preserves the order) by the
 *   canonical handler below, and the symbolic reducers in
 *   `symbolic/logic-utils.ts` (duplicate removal, `A ∧ ¬A → False`,
 *   absorption) are order-independent, so nothing symbolic is lost.
 *
 * The lazy route needs a `canonical` handler (a lazy operator without one
 * receives RAW, unbound operands — see the "inert on box/parse" trap in
 * CLAUDE.md). Framework validation deliberately does not bind or type-check
 * lazy operands, so the handler runs `validateArguments` with the now-bound
 * operands itself: `And(1, 2)` still reports `incompatible-type`, an unknown
 * symbol operand is still inferred `boolean`, and a possibly-absent operand
 * (`boolean | missing`, e.g. a comparison on an indexed read) is still
 * admitted through the strip-before-validate gate that
 * `missingBehavior: 'handle'` enables.
 */
function canonicalShortCircuit(
  name: ShortCircuitOperator,
  /** Splice nested same-operator operands (`And(And(a, b), c)` →
   * `And(a, b, c)`)? True only for the associative connectives `And`/`Or`;
   * `Nand`/`Nor` are NOT associative (`Nand(Nand(a, b), c) ≠ Nand(a, b, c)`)
   * and `Implies` is binary. */
  flattenNested: boolean
): (
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
) => Expression {
  return (ops, { engine: ce }) => {
    // Canonicalize (value-safe: binds structure, does not substitute values)
    // and, for `And`/`Or`, flatten nested same-operator operands, preserving
    // the written order.
    let args: ReadonlyArray<Expression> = flatten(
      ops,
      flattenNested ? name : undefined
    );
    const def = ce.lookupDefinition(name);
    if (def && isOperatorDef(def)) {
      const opDef = def.operator;
      const adjusted = validateArguments(
        ce,
        args,
        opDef.signature.type,
        false,
        // `broadcastable: true` — every position threads element-wise.
        true,
        ce._inferenceTxDepth > 0
          ? (ce._freshlyInferred ?? new Set())
          : undefined,
        (i) => opDef.stripsMissingAt(i)
      );
      if (adjusted) args = adjusted;
    }
    return ce._fn(name, args);
  };
}

/**
 * The evaluate handler of a short-circuit operator (see
 * `canonicalShortCircuit`), and its async twin (`evaluateShortCircuitAsync`,
 * which mirrors it step for step so that an operand with only an
 * `evaluateAsync` handler is awaited rather than left inert, and a
 * cancellation `signal` reaches the operands).
 *
 * SCALAR application (no operand is collection-shaped, see
 * `isElementwiseOperand`): evaluate the operands left to right and stop at
 * the first `decider` (`False` for `And`, `True` for `Or`) — or at the first
 * operand that evaluates to an error, which is returned as-is: an error is
 * as final as a decider, and evaluating past it would run operands the failed
 * one was guarding. The survivors are then handed to the order-independent
 * symbolic reducer (`reduce`: `evaluateAnd`/`evaluateOr`), which folds
 * `True`/`False`, duplicates, contradictions and absorptions, and keeps the
 * rest symbolic.
 *
 * ELEMENT-WISE application (some operand is collection-shaped): the result is
 * a list, cell by cell, and EVERY operand is evaluated once, left to right —
 * there is no per-cell short-circuit. This is the documented exception to the
 * short-circuit rule: the shape of the result is decided by the operand types
 * (`And(False, L())` with `L : () -> list<boolean>` is typed `list<boolean>`,
 * so it must return a list, which requires `L()`), and it is what every other
 * broadcastable operator, and the driver's own pre-evaluation broadcast (step
 * 2 of `_computeValue`, which intercepts a LITERAL or symbol-bound collection
 * before this handler runs and evaluates each lifted operand once), already
 * do. Only when the collection is produced by evaluation (a call) does this
 * handler see it: it then rebuilds the call over the evaluated values so the
 * driver zips them. The rebuild is guarded against re-entry — it only fires
 * when NO operand was already a literal collection on entry, since in that
 * case the driver has already declined to broadcast and rebuilding would loop.
 */
function evaluateShortCircuit(
  name: ShortCircuitOperator,
  decide: Decider,
  reduce: Reducer
): (
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
) => Expression | undefined {
  return (ops, options) => {
    const ce = options.engine;
    const evalOptions = evaluateOptionsOf(options);
    const elementwise = ops.some(isCollectionShaped);
    const values: Expression[] = [];
    for (let i = 0; i < ops.length; i++) {
      const v = ops[i].evaluate(evalOptions);
      if (!elementwise) {
        if (!v.isValid) return v;
        const decided = decide(ce, v, i);
        if (decided) return decided;
      }
      values.push(v);
    }
    return finishShortCircuit(ce, name, ops, values, reduce, evalOptions);
  };
}

/** The async twin of `evaluateShortCircuit` — see there. */
function evaluateShortCircuitAsync(
  name: ShortCircuitOperator,
  decide: Decider,
  reduce: Reducer
): (
  ops: ReadonlyArray<Expression>,
  options: EvaluateHandlerOptions
) => Promise<Expression | undefined> {
  return async (ops, options) => {
    const ce = options.engine;
    const evalOptions = evaluateOptionsOf(options);
    const elementwise = ops.some(isCollectionShaped);
    const values: Expression[] = [];
    for (let i = 0; i < ops.length; i++) {
      const v = await ops[i].evaluateAsync(evalOptions);
      if (!elementwise) {
        if (!v.isValid) return v;
        const decided = decide(ce, v, i);
        if (decided) return decided;
      }
      values.push(v);
    }
    return finishShortCircuit(ce, name, ops, values, reduce, evalOptions);
  };
}

type ShortCircuitOperator = 'And' | 'Or' | 'Nand' | 'Nor' | 'Implies';

/** Does the evaluated operand `v`, at position `i`, decide the result by
 * itself? Returns the result if so, `undefined` otherwise. */
type Decider = (
  ce: ComputeEngine,
  v: Expression,
  i: number
) => Expression | undefined;

/** The order-independent symbolic reducer applied to the surviving values. */
type Reducer = (
  args: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine }
) => Expression | undefined;

/** `And` stops at the first `False` (result `False`). */
const decideAnd: Decider = (ce, v) =>
  sym(v) === 'False' ? ce.False : undefined;
/** `Or` stops at the first `True` (result `True`). */
const decideOr: Decider = (ce, v) => (sym(v) === 'True' ? ce.True : undefined);
/** `Nand` = ¬`And`: stops at the first `False` (result `True`). */
const decideNand: Decider = (ce, v) =>
  sym(v) === 'False' ? ce.True : undefined;
/** `Nor` = ¬`Or`: stops at the first `True` (result `False`). */
const decideNor: Decider = (ce, v) =>
  sym(v) === 'True' ? ce.False : undefined;
/** `Implies(p, q)`: a `False` antecedent decides (`True`) without evaluating
 * the consequent — `False ⇒ q` is `True` for every `q`. The consequent (the
 * last operand) never decides early. */
const decideImplies: Decider = (ce, v, i) =>
  i === 0 && sym(v) === 'False' ? ce.True : undefined;

/** The `EvaluateOptions` to hand to an operand: everything the caller passed
 * (`numericApproximation`, `materialization`, the cancellation `signal`) minus
 * the handler-only fields (`engine`, `expression`). */
function evaluateOptionsOf(
  options: EvaluateHandlerOptions
): Partial<EvaluateOptions> {
  const { numericApproximation, materialization, signal } = options;
  return { numericApproximation, materialization, signal };
}

/**
 * Shared tail of the sync/async short-circuit handlers, once every surviving
 * operand has been evaluated into `values` (a decider or an error has already
 * returned early on the scalar path). A collection produced by evaluation is
 * handed back to the driver's broadcast by rebuilding the call over the
 * values (see the element-wise paragraph of `evaluateShortCircuit`); anything
 * else goes to the symbolic reducer.
 */
function finishShortCircuit(
  ce: ComputeEngine,
  name: ShortCircuitOperator,
  ops: ReadonlyArray<Expression>,
  values: ReadonlyArray<Expression>,
  reduce: Reducer,
  evalOptions: Partial<EvaluateOptions>
): Expression | undefined {
  const isCollectionValue = (x: Expression) => isFiniteBroadcastParticipant(x);
  if (!ops.some(isCollectionValue) && values.some(isCollectionValue))
    return ce.function(name, values).evaluate(evalOptions);
  return reduce(values, { engine: ce });
}

/** The boolean VALUE an operand's type proves: `true`/`false` for a value
 * type, `undefined` otherwise (boolean value types,
 * `docs/plans/2026-08-29-boolean-value-types.md` §3.1). */
function booleanClaim(x: OperandDescriptor): boolean | undefined {
  const t = x.type;
  return typeof t === 'object' &&
    t.kind === 'value' &&
    typeof t.value === 'boolean'
    ? t.value
    : undefined;
}

/** Result type of a connective from its operands' claims by the truth
 * table: `And` is `false` as soon as one operand is, `true` when all are;
 * `Or` the dual; `Not` flips; `Xor` folds when every operand is decided.
 * Anything undecided keeps `boolean`. An operand whose type is not a plain
 * `boolean` (it may be absent, or a collection) keeps the head's declared
 * answer: this refines only a result that is already the bare `boolean`.
 *
 * Reads operand DESCRIPTORS: everything it needs is in the operand's type,
 * so the derivation touches no engine state. */
function connectiveType(
  head: 'And' | 'Or' | 'Not' | 'Xor',
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  if (!ops.every((x) => isSubtype(x.type, 'boolean'))) return 'boolean';
  const claims = ops.map(booleanClaim);
  const verdict = (v: boolean): Type => ({ kind: 'value', value: v });
  if (head === 'Not') {
    const c = claims[0];
    return c === undefined ? 'boolean' : verdict(!c);
  }
  if (head === 'And') {
    if (claims.some((c) => c === false)) return verdict(false);
    if (claims.every((c) => c === true)) return verdict(true);
    return 'boolean';
  }
  if (head === 'Or') {
    if (claims.some((c) => c === true)) return verdict(true);
    if (claims.every((c) => c === false)) return verdict(false);
    return 'boolean';
  }
  if (claims.every((c) => c !== undefined))
    return verdict(claims.filter((c) => c === true).length % 2 === 1);
  return 'boolean';
}

export const LOGIC_LIBRARY: SymbolDefinitions = {
  True: {
    description: 'The boolean truth value true.',
    wikidata: 'Q16751793',
    type: 'boolean',
    isConstant: true,
  },
  False: {
    description: 'The boolean truth value false.',
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
    type: (ops) => connectiveType('And', ops),
    description:
      'Logical conjunction (AND): true when all operands are true. ' +
      'Short-circuits: operands are evaluated left to right and evaluation ' +
      'stops at the first `False`.',
    wikidata: 'Q191081',
    broadcastable: true,
    // Not `associative`/`commutative`/`idempotent`: see
    // `canonicalShortCircuit` — those flags would sort the operands and are
    // incompatible with a `canonical` handler; flattening and the symbolic
    // folds are done by the handlers instead.
    lazy: true,
    complexity: 10000,
    signature: '(boolean+) -> boolean',
    // A possibly-absent operand (`boolean | missing`, e.g. a comparison on an
    // indexed read `cs[j] == "a"`) validates — the strip-before-validate gate
    // (§3.B) removes the `missing` arm — and evaluation is Kleene: `False`
    // dominates, a surviving `Missing` operand propagates. Without this, a
    // guarded loop condition `j <= n && cs[j] == "a"` was REJECTED at
    // canonicalization with `incompatible-type`.
    missingBehavior: 'handle',
    // The operands are boolean values, never applied as functions: like the
    // other held-operand selectors (`If`, `Which`, `Block`), no position
    // invokes, so effects inference does not project a held operand's latent
    // effects through the conjunction.
    invokes: false,
    // "Option B" (user-ruled 2026-08-16): the VALUE is commutative even
    // though the tree stays ordered. Permutation matching is restored via
    // `commutativeMatch` (decoupled from the canonical sort `commutative`
    // would impose), and `isEqual`/`isIdenticallyEqual` compare modulo
    // permutation and nesting via the `eq` handler. `isSame` stays strictly
    // syntactic and evaluation still short-circuits left to right.
    //
    // The commutativity this restores is a claim about VALUES, and it does not
    // extend to error propagation, which is demand-ordered: `And(False, 1)`
    // answers `False` while `And(1, False)` answers the `incompatible-type`
    // error on the `1`. Canonicalization mints that diagnostic in both trees —
    // `1` is not a boolean — but evaluation demands operands left to right and
    // stops at the first decisive one, so the error is dead code in the first
    // tree and demanded in the second (the demanded-operands rule,
    // `docs/ERROR-MODEL.md` §3; `selectsOperands` below is what implements
    // it). Both trees stay INVALID and keep the diagnostic in place for static
    // analysis; only the evaluated answers differ. This exception is
    // deliberate: making it symmetric would mean either failing `And(False, 1)`
    // — reporting an arm the program never reaches — or swallowing a genuine
    // fault in `And(1, False)`.
    commutativeMatch: true,
    eq: (a, b, prover) => acEquivalentBoolean('And', a, b, prover),
    // Selects among its operands, so an error in an operand it does not
    // choose does not bubble (`docs/ERROR-MODEL.md` §3).
    selectsOperands: true,
    canonical: canonicalShortCircuit('And', true),
    evaluate: evaluateShortCircuit('And', decideAnd, evaluateAnd),
    evaluateAsync: evaluateShortCircuitAsync('And', decideAnd, evaluateAnd),
  },
  Or: {
    type: (ops) => connectiveType('Or', ops),
    description:
      'Logical disjunction (OR): true when at least one operand is true. ' +
      'Short-circuits: operands are evaluated left to right and evaluation ' +
      'stops at the first `True`.',
    wikidata: 'Q1651704',
    broadcastable: true,
    // See `And` above.
    lazy: true,
    complexity: 10000,
    signature: '(boolean+) -> boolean',
    // Kleene over absence, mirroring `And`: `True` dominates, a surviving
    // `Missing` operand propagates.
    missingBehavior: 'handle',
    invokes: false,
    // "Option B" — see `And` above.
    commutativeMatch: true,
    eq: (a, b, prover) => acEquivalentBoolean('Or', a, b, prover),
    // Selects among its operands, so an error in an operand it does not
    // choose does not bubble (`docs/ERROR-MODEL.md` §3).
    selectsOperands: true,
    canonical: canonicalShortCircuit('Or', true),
    evaluate: evaluateShortCircuit('Or', decideOr, evaluateOr),
    evaluateAsync: evaluateShortCircuitAsync('Or', decideOr, evaluateOr),
  },
  Not: {
    type: (ops) => connectiveType('Not', ops),
    description: 'Logical negation (NOT).',
    wikidata: 'Q190558',
    broadcastable: true,
    involution: true,
    complexity: 10100,
    // @todo: this may not be needed, since we also have rules.
    signature: '(boolean) -> boolean',
    // Kleene over absence, like `And`/`Or`: a possibly-absent operand
    // validates and `Not(Missing)` evaluates to `Missing`.
    missingBehavior: 'handle',
    evaluate: evaluateNot,
  },
  Equivalent: {
    description:
      'Logical equivalence (if and only if): true when both operands have the same truth value.',
    wikidata: 'Q220433',
    broadcastable: true,
    complexity: 10200,
    signature: '(boolean, boolean) -> boolean',
    canonical: (args: ReadonlyArray<Expression>, { engine: ce }) => {
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
    description:
      'Logical implication: false only when the antecedent is true and the ' +
      'consequent is false. Short-circuits: a `False` antecedent decides ' +
      '(`True`) without evaluating the consequent.',
    wikidata: 'Q7881229',
    broadcastable: true,
    // Kleene over absence, as for `And`/`Or`: a possibly-absent operand
    // (`boolean | missing`) validates through the strip-before-validate gate,
    // and a surviving `Missing` operand propagates (see the reducers).
    missingBehavior: 'handle',
    lazy: true,
    invokes: false,
    complexity: 10200,
    signature: '(boolean, boolean) -> boolean',
    // Selects among its operands, so an error in an operand it does not
    // choose does not bubble (`docs/ERROR-MODEL.md` §3).
    selectsOperands: true,
    canonical: canonicalShortCircuit('Implies', false),
    evaluate: evaluateShortCircuit('Implies', decideImplies, evaluateImplies),
    evaluateAsync: evaluateShortCircuitAsync(
      'Implies',
      decideImplies,
      evaluateImplies
    ),
  },
  Xor: {
    type: (ops) => connectiveType('Xor', ops),
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
    description:
      'Logical NAND: the negation of AND (n-ary). Short-circuits: operands ' +
      'are evaluated left to right and evaluation stops at the first `False`.',
    wikidata: 'Q189550',
    broadcastable: true,
    // Not `commutative` — the flag sorts the operands, and a short-circuit
    // form is defined over the WRITTEN order (see `canonicalShortCircuit`).
    // Kleene over absence, as for `And`/`Or`: a possibly-absent operand
    // (`boolean | missing`) validates through the strip-before-validate gate,
    // and a surviving `Missing` operand propagates (see the reducers).
    missingBehavior: 'handle',
    lazy: true,
    invokes: false,
    complexity: 10200,
    signature: '(boolean+) -> boolean',
    // Selects among its operands, so an error in an operand it does not
    // choose does not bubble (`docs/ERROR-MODEL.md` §3).
    selectsOperands: true,
    canonical: canonicalShortCircuit('Nand', false),
    evaluate: evaluateShortCircuit('Nand', decideNand, evaluateNand),
    evaluateAsync: evaluateShortCircuitAsync('Nand', decideNand, evaluateNand),
  },
  Nor: {
    description:
      'Logical NOR: the negation of OR (n-ary). Short-circuits: operands are ' +
      'evaluated left to right and evaluation stops at the first `True`.',
    wikidata: 'Q189561',
    broadcastable: true,
    // Kleene over absence, as for `And`/`Or`: a possibly-absent operand
    // (`boolean | missing`) validates through the strip-before-validate gate,
    // and a surviving `Missing` operand propagates (see the reducers).
    missingBehavior: 'handle',
    lazy: true,
    invokes: false,
    complexity: 10200,
    signature: '(boolean+) -> boolean',
    // Selects among its operands, so an error in an operand it does not
    // choose does not bubble (`docs/ERROR-MODEL.md` §3).
    selectsOperands: true,
    canonical: canonicalShortCircuit('Nor', false),
    evaluate: evaluateShortCircuit('Nor', decideNor, evaluateNor),
    evaluateAsync: evaluateShortCircuitAsync('Nor', decideNor, evaluateNor),
  },
  // Quantifiers return boolean values (they are propositions)
  // They support evaluation over finite domains (e.g., ForAll with Element condition)
  // The first argument can be:
  // - a symbol (e.g., "x") for symbolic quantification
  // - an Element expression (e.g., ["Element", "x", ["Set", 1, 2, 3]]) for finite domain evaluation
  Exists: {
    description:
      'Existential quantifier (there exists): true when the predicate holds for at least one value.',
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: QUANTIFIER_SITES,
    canonical: canonicalQuantifier('Exists'),
    evaluate: evaluateExists,
  },
  NotExists: {
    description:
      'Negated existential quantifier (there does not exist): true when the predicate holds for no value.',
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: QUANTIFIER_SITES,
    canonical: canonicalQuantifier('NotExists'),
    evaluate: (args, options) => {
      const result = evaluateExists(args, options);
      if (sym(result) === 'True') return options.engine.False;
      if (sym(result) === 'False') return options.engine.True;
      return undefined;
    },
  },
  ExistsUnique: {
    description:
      'Unique existential quantifier (there exists exactly one value satisfying the predicate).',
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: QUANTIFIER_SITES,
    canonical: canonicalQuantifier('ExistsUnique'),
    evaluate: evaluateExistsUnique,
  },
  ForAll: {
    description:
      'Universal quantifier (for all): true when the predicate holds for every value.',
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: QUANTIFIER_SITES,
    canonical: canonicalQuantifier('ForAll'),
    evaluate: evaluateForAll,
  },
  NotForAll: {
    description:
      'Negated universal quantifier (not for all): true when the predicate fails for at least one value.',
    signature: '(value, boolean) -> boolean',
    lazy: true,
    scoped: QUANTIFIER_SITES,
    canonical: canonicalQuantifier('NotForAll'),
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
      if (!isSymbol(pred)) return undefined;
      // Could check if the predicate has a definition and evaluate it
      // For now, predicates remain symbolic
      return undefined;
    },
  },

  KroneckerDelta: {
    description:
      'Return 1 if the arguments are equal, 0 otherwise. With a single ' +
      'argument n, this is δ_{n,0}: 1 if n = 0, 0 otherwise.',
    signature: '(value+) -> integer',
    evaluate: (args, { engine: ce }) => {
      // Three-valued equality of two arguments: 1 if equal, 0 if their
      // difference is a non-zero *constant*, and symbolic if the difference
      // still contains free variables (undetermined). Using `isEqual` directly
      // is wrong here: it reports two distinct free symbols as *unequal* even
      // though `x = y` is undetermined.
      const kron = (a: Expression, b: Expression): 0 | 1 | undefined => {
        if (a.isSame(b)) return 1;
        const diff = a.sub(b).simplify();
        if (diff.isSame(0)) return 1;
        // `isConstant` (lexical), not the dynamic-scope `unknowns`: inside a
        // function application a bound parameter counts as known to
        // `unknowns`, so `KroneckerDelta(w)` in a body wrongly returned 0
        // for a symbolic `w` (see the D2 comment on `Add` in arithmetic.ts).
        if (diff.isConstant) return 0; // non-zero constant
        return undefined; // depends on free variables → stay symbolic
      };

      if (args.length === 1) {
        // Unary KroneckerDelta(n) = δ_{n,0}: 1 if n = 0, 0 otherwise
        // (standard convention; matches Mathematica's KroneckerDelta[n]).
        const r = kron(args[0], ce.Zero);
        return r === undefined ? undefined : r === 1 ? ce.One : ce.Zero;
      }

      if (args.length === 2) {
        const r = kron(args[0], args[1]);
        return r === undefined ? undefined : r === 1 ? ce.One : ce.Zero;
      }

      // More than two arguments: they should all be equal. A definite
      // inequality gives 0; an undetermined comparison keeps it symbolic.
      let undetermined = false;
      for (let i = 1; i < args.length; i++) {
        const r = kron(args[0], args[i]);
        if (r === 0) return ce.Zero;
        if (r === undefined) undetermined = true;
      }
      return undetermined ? undefined : ce.One;
    },
  },

  // Iverson bracket
  Boole: {
    description:
      'Return 1 if the argument is true, 0 otherwise. Also known as the Iverson bracket',
    signature: '(boolean) -> integer',
    evaluate: (args, { engine: ce }) => {
      // Only a definite truth value resolves; an undetermined predicate
      // (e.g. `Equal(x, y)` with free symbols) stays symbolic instead of 0.
      const s = sym(args[0]);
      if (s === 'True') return ce.One;
      if (s === 'False') return ce.Zero;
      return undefined;
    },
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
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Symbolic simplification: check if body is constant (doesn't depend on the variable)
  const canonicalBody = body.canonical;
  if (sym(canonicalBody) === 'True') return ce.True;
  if (sym(canonicalBody) === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const condOp1 = isFunction(condition) ? condition.op1 : undefined;
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
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
  if (args.length < 2) return undefined;

  const condition = args[0];
  const body = args[1];

  // Symbolic simplification: check if body is constant (doesn't depend on the variable)
  const canonicalBody = body.canonical;
  if (sym(canonicalBody) === 'True') return ce.True;
  if (sym(canonicalBody) === 'False') return ce.False;

  // Check if body doesn't contain the quantified variable
  const condOp1 = isFunction(condition) ? condition.op1 : undefined;
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
  args: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | undefined {
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
    description:
      'Convert a boolean expression to conjunctive normal form (CNF), an AND of ORs.',
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
    description:
      'Convert a boolean expression to disjunctive normal form (DNF), an OR of ANDs.',
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
