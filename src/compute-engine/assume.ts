import { isEmptyType, isSubtype } from '../common/type/subtype.js';
import { functionResult } from '../common/type/utils.js';
import { BoxedType } from '../common/type/boxed-type.js';
import type { Type } from '../common/type/types.js';

import {
  AssumeResult,
  BoxedValueDefinition,
  Expression,
  FactRecord,
  FactSubject,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
  Sign,
} from './global-types.js';

import { findUnivariateRoots } from './boxed-expression/solve.js';
import {
  domainToType,
  isValueDef,
  isOperatorDef,
  assignedVariableNames,
} from './boxed-expression/utils.js';
import { SIGNED_NUMBER_SETS } from './boxed-expression/number-set-types.js';
import { isInequalityOperator } from './latex-syntax/utils.js';
import {
  isFunction,
  isSymbol,
  isNumber,
  isString,
} from './boxed-expression/type-guards.js';
import {
  type Subject,
  subjectOf,
  toSubject,
  subjectKey,
  matchesSubject,
  boundsFromNormalizedInequality,
  containsPartTerm,
  mergeTightestBounds,
  partBoundSubject,
  signFromBounds,
  getFactIndex,
  hasAssumptions,
  contextAssumptions,
  membershipType,
  provenTypeNode,
  refutingFact,
  withShieldedValues,
} from './boxed-expression/constraint-subject.js';

/**
 * The subjects of a fact: every symbol it mentions that has a value
 * definition, resolved to that definition, with the part of the value the
 * fact constrains.
 *
 * A part term (`Real(s)`, `Abs(z)`) resolves to the definition of the WHOLE
 * value `s`/`z` with a non-`'self'` part, and its inner symbol is NOT
 * revisited — the fact is about the part, not about the bare symbol. A
 * symbol with no value definition contributes nothing: there is no
 * definition to record the assertion against.
 */
function factSubjects(
  ce: ComputeEngine,
  fact: Expression
): ReadonlyArray<FactSubject> {
  const found = new Map<string, FactSubject>();

  const visit = (expr: Expression): void => {
    const subject = subjectOf(expr);
    if (subject !== undefined) {
      const key = subjectKey(subject);
      if (!found.has(key)) {
        const def = ce.lookupDefinition(subject.symbol);
        if (def !== undefined && isValueDef(def))
          found.set(
            key,
            Object.freeze({
              symbol: subject.symbol,
              def: def.value,
              part: subject.part,
            })
          );
      }
      // A part term has been accounted for as a whole; descending into it
      // would also record its inner symbol under the 'self' part.
      if (subject.part !== 'self') return;
    }
    if (isFunction(expr)) for (const op of expr.ops) visit(op);
  };

  visit(fact);
  return Object.freeze([...found.values()]);
}

/** True if `expr` carries an `incompatible-type` error anywhere. The code sits
 * either directly under the `Error` head or inside its `ErrorCode` wrapper,
 * depending on whether the error carries the expected and actual types. */
function hasIncompatibleTypeError(expr: Expression): boolean {
  if (isFunction(expr, 'Error')) {
    const code = expr.op1;
    if (isString(code) && code.string === 'incompatible-type') return true;
    if (
      isFunction(code, 'ErrorCode') &&
      isString(code.op1) &&
      code.op1.string === 'incompatible-type'
    )
      return true;
  }
  return isFunction(expr) && expr.ops.some(hasIncompatibleTypeError);
}

/**
 * `fact`, with every symbol node bound to the definition its name is bound to
 * NOW.
 *
 * A conjunct the assumptions layer refuses gives back the bindings it alone
 * introduced, and the definitions go with them — DISPOSED, so that an
 * assertion about one is known to be about a value that no longer exists. A
 * LATER conjunct of the same proposition that mentions the same name gets a
 * fresh definition, while the expression it was canonicalized into still holds
 * the dead one: `assume(And(Foo(y), y > 3))` recorded `y > 3` with its subject
 * on the live `y` and the fact expression's own `y` on the disposed one, so
 * the two disagreed about which value the assertion is about. Re-boxing the
 * fact against the live scope puts them back in agreement.
 *
 * The re-boxing is reached only when a disposed definition is actually
 * present; every other fact pays one traversal and is returned unchanged.
 */
function withLiveDefinitions(ce: ComputeEngine, fact: Expression): Expression {
  const hasDisposedDef = (expr: Expression): boolean => {
    if (isSymbol(expr)) return expr.valueDefinition?.disposed === true;
    return isFunction(expr) && expr.ops.some(hasDisposedDef);
  };
  if (!hasDisposedDef(fact)) return fact;
  return ce.expr(fact.json);
}

/**
 * Record `fact` in the current context's assumptions store.
 *
 * One key holds a LIST of assertions and this appends a fresh frozen record
 * to a NEW array, never mutating the array in place: a scope push
 * shallow-copies the map, so the inner and the enclosing context share the
 * array objects, and only installing a replacement leaves the enclosing
 * scope's assertions untouched.
 *
 * Answers `'ok'` when the fact was stored. An INVALID fact is never stored,
 * because an error expression as a key would be handed to every reader of the
 * store, and to the index that turns facts into types.
 */
function recordFact(
  ce: ComputeEngine,
  assertion: Expression,
  truth: boolean
): AssumeResult {
  // The fact expression and the subjects recorded with it must be about the
  // same definitions: `factSubjects` resolves each name in the live scope,
  // and the expression can still hold a definition an earlier, rolled-back
  // conjunct disposed of.
  const fact = withLiveDefinitions(ce, assertion);

  // A predicate that does not type-check is no fact. `declare s string;
  // assume(Re(s) > 1)` reduces to the `incompatible-type` error itself: a
  // string has no real part, so the predicate is REFUTED and the answer is a
  // contradiction. Any other invalid shape is simply not a predicate the
  // assumptions layer can represent.
  if (!fact.isValid)
    return hasIncompatibleTypeError(fact) ? 'contradiction' : 'not-a-predicate';

  const assumptions = ce.context.assumptions;
  const record: FactRecord = Object.freeze({
    id: ce._nextFactId(),
    truth,
    subjects: factSubjects(ce, fact),
  });
  const previous = assumptions.get(fact);
  const tx = _transaction;
  if (tx !== undefined) {
    tx.undo.push(() => {
      if (previous === undefined) assumptions.delete(fact);
      else assumptions.set(fact, previous);
    });
    for (const s of record.subjects) tx.touched.add(s.def);
  }
  assumptions.set(fact, previous ? [...previous, record] : [record]);
  return 'ok';
}

//
// ─── The assume transaction (design §2.5) ───────────────────────────────────
//
// `assume()` applies its conjuncts for real, against an UNDO LOG, and rolls
// the log back when the result is a contradiction — where it used to validate
// the whole conjunction in a throw-away child scope and then replay it. The
// log is what makes a conjunction atomic (`And(p > 0, p < −5)` reports a
// contradiction and leaves `p > 0` nowhere), and it is also what lets a
// contradiction be detected by READING the effective type after the fact is
// stored, now that storing a fact writes no type.

type AssumeTransaction = {
  readonly ce: ComputeEngine;
  /** Applied in reverse to put both stores back exactly as they were. */
  readonly undo: (() => void)[];
  /** Every definition an applied fact is about: what the consistency checks
   * re-read once the whole proposition is in. */
  readonly touched: Set<BoxedValueDefinition>;
  /** The assumed values this transaction installed, with what the overlay
   * held for that definition before. */
  readonly stagedValues: Map<
    BoxedValueDefinition,
    { prior: Expression | undefined; next: Expression }
  >;
  /** The scope the transaction opened in: where a binding it introduced is
   * removed from when it gives that binding up. */
  readonly scope: ComputeEngine['context']['lexicalScope'];
  /** Names the scope did not bind when this transaction started, and that no
   * conjunct has claimed yet. Canonicalizing the proposition binds every free
   * symbol it mentions, so without this list the bindings a rolled-back
   * transaction introduced could not be told from the ones that predate it. */
  readonly unattributed: Set<string>;
  /** The names claimed by a conjunct that was applied: they go only if the
   * WHOLE transaction rolls back. A name claimed by a conjunct the assumptions
   * layer refuses is discarded with that conjunct instead, and never reaches
   * this list. */
  readonly introduced: string[];
};

/** The open transaction, if any. `assume()` is synchronous and one
 * proposition is applied at a time, so module state is the whole story; a
 * nested `assume()` (a conjunct, a link of a chain, a bound implied by a
 * membership) joins the transaction its caller opened. */
let _transaction: AssumeTransaction | undefined;

function rollbackTransaction(tx: AssumeTransaction): void {
  for (let i = tx.undo.length - 1; i >= 0; i--) tx.undo[i]();
  // Every binding the transaction introduced goes with it — the ones a
  // conjunct claimed as well as the ones no conjunct reached.
  for (const name of tx.introduced) discardBinding(tx, name);
  for (const name of tx.unattributed) discardBinding(tx, name);
}

/**
 * Remove from the transaction's own scope a binding it introduced.
 *
 * The definition is DISPOSED as well as unbound: an expression boxed while the
 * proposition was being applied still holds it by identity, and the flag is
 * what tells the fact index and a checkpoint restore that assertions about it
 * are about a value that no longer exists.
 */
function discardBinding(tx: AssumeTransaction, name: string): void {
  const binding = tx.scope.bindings.get(name);
  if (binding === undefined) return;
  if (isValueDef(binding)) binding.value.dispose();
  tx.scope.bindings.delete(name);
}

/**
 * Install `value` as the assumed value of `def` in the current context's
 * overlay.
 *
 * The definition itself is untouched: an assumed value is a FACT about the
 * current scope's state, and the overlay is copied on a scope push and
 * dropped on the pop, so the value has the lifetime of the scope that assumed
 * it even when the definition belongs to an enclosing one.
 */
function stageAssumedValue(
  ce: ComputeEngine,
  def: BoxedValueDefinition,
  value: Expression
): void {
  const overlay = ce.context.assumedValues;
  const had = overlay.has(def);
  const prior = overlay.get(def);
  const tx = _transaction;
  if (tx !== undefined) {
    tx.undo.push(() => {
      if (had) overlay.set(def, prior!);
      else overlay.delete(def);
    });
    tx.stagedValues.set(def, { prior, next: value });
    tx.touched.add(def);
  }
  overlay.set(def, value);
}

/**
 * Give `symbol` a definition for a fact to be recorded against, when nothing
 * declared it.
 *
 * The definition is PROVISIONAL: its type is `unknown` — an assumption
 * declares nothing, it only states a fact, and what the fact proves is merged
 * in by the type read — and the transaction discards the binding if it rolls
 * back.
 */
function declareProvisional(ce: ComputeEngine, symbol: string): void {
  if (ce.lookupDefinition(symbol) !== undefined) return;
  ce.declare(symbol, { type: 'unknown', inferred: true });
  const scope = ce.context.lexicalScope;
  _transaction?.undo.push(() => {
    const binding = scope.bindings.get(symbol);
    if (binding !== undefined && isValueDef(binding)) binding.value.dispose();
    scope.bindings.delete(symbol);
  });
}

/** The type the FACTS alone prove about `def`, or `undefined` when they prove
 * nothing. */
function provenType(
  ce: ComputeEngine,
  def: BoxedValueDefinition
): BoxedType | undefined {
  const node = provenTypeNode(ce, def);
  return node === undefined ? undefined : new BoxedType(node, ce._typeResolver);
}

/**
 * The consistency checks that can only be run once the whole proposition is
 * stored, because what a fact proves is now read back off the store rather
 * than written into a definition.
 *
 * Returns `'contradiction'` when the applied facts cannot all hold, and the
 * caller then rolls the transaction back.
 */
function transactionConsistency(
  tx: AssumeTransaction
): 'contradiction' | undefined {
  const ce = tx.ce;

  for (const [def, staged] of tx.stagedValues) {
    if (def.disposed) continue;
    // Two assumed values for one symbol in one proposition: `And(x = 1, x =
    // 2)`. Compared arithmetically, so `x = 1` and `x = 2/2` agree.
    if (
      staged.prior !== undefined &&
      staged.prior.isEqual(staged.next) === false
    )
      return 'contradiction';
    // A DECLARED type is a contract the assumed value must inhabit
    // (`declare w integer<0..3>; assume w = 5`). An INFERRED type is a guess
    // and is not enforced.
    const declared = def.declaredType;
    if (
      !def.inferredType &&
      !declared.isUnknown &&
      !staged.next.type.matches(declared)
    )
      return 'contradiction';
    // What the other facts prove IS enforced, inferred declaration or not: a
    // fact is an assertion, not a guess (`assume(x > 3); assume(x = 1)`).
    const proven = provenType(ce, def);
    if (proven !== undefined && !staged.next.type.matches(proven))
      return 'contradiction';
    // The type a fact proves is only a summary of it — an equality proves the
    // promoted TIER of its value, so the check above lets `x = 1` past `x =
    // 2`, and a fact relating two symbols proves no type at all, so it lets
    // `And(x > y, y = 5, x = 1)` past. The facts themselves decide: put the
    // staged value back into each one and ask whether it still holds.
    if (refutingFact(ce, def, staged.next) !== undefined)
      return 'contradiction';
  }

  // The facts about a definition must leave it something to be: `declare x
  // real<..-1>; assume(x > 0)` reduces to an empty type. A definition holding
  // a stored value is exempt — facts never merge into its type, and the value
  // itself was checked against the predicate before it was recorded.
  for (const def of tx.touched) {
    if (def.disposed || def.storedValue !== undefined) continue;
    if (isEmptyType(def.type.type)) return 'contradiction';
  }

  return undefined;
}

/**
 * Add an assumption, in the form of a predicate, for example:
 *
 * - `x = 5`
 * - `x ∈ ℕ`
 * - `x > 3`
 * - `x + y = 5`
 *
 * Assumptions that represent a value definition (equality to an expression,
 * membership to a type, >0, <=0, etc...) are stored directly in the current
 * scope's symbols dictionary, and an entry for the symbol is created if
 * necessary.
 *
 * Predicates that involve multiple symbols are simplified (for example
 * `x + y = 5` becomes `x + y - 5 = 0`), then stored in the `assumptions`
 * record of the current context.
 *
 * New assumptions can 'refine' previous assumptions, if they don't contradict
 * previous assumptions.
 *
 * To set new assumptions that contradict previous ones, you must first
 * `forget` about any symbols in the new assumption.
 *
 */

export function assume(
  proposition: Expression,
  /** The names the proposition mentions that the scope did not bind when the
   * call started (`introducibleNames`, `engine-assumptions.ts`).
   * Canonicalization binds every free symbol, so this is the only record of
   * which bindings the transaction caused, and therefore of the only ones it
   * may take back. */
  undeclared?: ReadonlyArray<string>
): AssumeResult {
  // A nested call — a conjunct, a link of a chain, a bound a membership
  // implies — joins the transaction its caller opened, so the whole
  // proposition is applied and rolled back as one.
  if (_transaction !== undefined)
    return assumeConjunct(_transaction, proposition);

  const ce = proposition.engine;
  const tx: AssumeTransaction = {
    ce,
    undo: [],
    touched: new Set(),
    stagedValues: new Map(),
    scope: ce.context.lexicalScope,
    unattributed: new Set(undeclared),
    introduced: [],
  };
  _transaction = tx;
  try {
    let result = assumeConjunct(tx, proposition);
    if (result !== 'contradiction' && result !== 'internal-error')
      result = transactionConsistency(tx) ?? result;
    if (result === 'contradiction' || result === 'internal-error')
      rollbackTransaction(tx);
    return result;
  } catch (e) {
    rollbackTransaction(tx);
    throw e;
  } finally {
    _transaction = undefined;
    // EVERY outcome ends here, a rollback included: the store moved and moved
    // back, and a memo computed against the staged facts in between must not
    // survive the answer.
    ce._noteStateEvent({ kind: 'assumption' });
  }
}

/**
 * Apply one conjunct — or the whole proposition, when it is not a conjunction
 * — inside the open transaction, claiming for it the bindings it is the first
 * to need.
 *
 * A conjunct the assumptions layer cannot represent is DROPPED and the
 * conjuncts applied before it stand (`assume(And(x > 3, Foo(y)))` keeps `x >
 * 3`). The scope follows the same rule: the names the rejected conjunct alone
 * introduced go with it, while a name an earlier, committed conjunct already
 * needed stays bound.
 */
function assumeConjunct(
  tx: AssumeTransaction,
  proposition: Expression
): AssumeResult {
  // A conjunction is not a conjunct: claiming its names here would leave its
  // conjuncts nothing to answer for.
  if (proposition.operator === 'And') return assumeShielded(proposition);

  const claimed: string[] = [];
  if (tx.unattributed.size !== 0)
    for (const name of proposition.symbols)
      if (tx.unattributed.delete(name)) claimed.push(name);

  const result = assumeShielded(proposition);
  if (result === 'not-a-predicate')
    for (const name of claimed) discardBinding(tx, name);
  else tx.introduced.push(...claimed);
  return result;
}

/**
 * Record `proposition`, with the values of the symbols it mentions hidden.
 *
 * ── Value-blindness shield (ARCHITECTURE.md, "Bound variables, free symbols,
 *    and assigned values"; ratified 2026-07-24) ─────────────────────────────
 *
 * When the predicate mentions assigned, non-constant free symbols, evaluating
 * it *through* those values would fold it to `True`/`False` before the
 * assumption system can record it. For example `w := 5; assume(w > 0)` folded
 * to a no-op `'tautology'` (and `w := -2` to `'contradiction'`), silently
 * dropping the fact. Shield + record: keep the consistency signal, but record
 * the surviving predicate as a fact about the *symbol*, not its value.
 */
function assumeShielded(proposition: Expression): AssumeResult {
  const names = assignedVariableNames(proposition);
  if (names.length === 0) return assumeDispatch(proposition);

  // 1. Consistency check first, values applied: a *provably False* predicate is
  //    a user error — return `'contradiction'` and record nothing (unchanged
  //    signal). `True`/indeterminate falls through to value-blind recording.
  if (isSymbol(proposition.evaluate(), 'False')) return 'contradiction';

  // 2. Record value-blind. The shield hides the definitions rather than
  //    stripping and restoring their values: a strip is two value WRITES per
  //    symbol, which move the invalidation axis and are not re-entrant.
  const ce = proposition.engine;
  const shielded = new Set<BoxedValueDefinition>();
  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (isValueDef(def) && !def.value.isConstant) shielded.add(def.value);
  }
  return withShieldedValues(shielded, () => assumeDispatch(proposition));
}

function assumeDispatch(proposition: Expression): AssumeResult {
  const op = proposition.operator;
  if (op === 'Element') return assumeElement(proposition);
  if (op === 'NotElement') return assumeNotElement(proposition);
  if (op === 'Equal') return assumeEquality(proposition);
  if (op === 'NotEqual') return assumeNotEqual(proposition);
  if (op === 'And') return assumeConjunction(proposition);
  if (isInequalityOperator(op)) return assumeInequality(proposition);

  // Well-formed predicate shapes that the assumptions layer cannot
  // represent (disjunctions, quantifiers...): return 'not-a-predicate'
  // instead of throwing, so callers (e.g. the Fungrim loader) can probe
  // guard dischargeability in bulk (design §4.1, §9).
  if (UNSUPPORTED_PREDICATE_OPERATORS.has(op)) return 'not-a-predicate';

  // Outright malformed input (not a predicate operator at all) reports
  // `'not-a-predicate'` too — errors are VALUES (error-propagation design
  // §8a): the throw escaped to the host on the direct route (`Assume(Ln("a"))`
  // via `ce.box`), while the same program run through Epsil became an
  // `["Error", …]` value, so the two routes disagreed on whether an
  // unassumable proposition is catastrophic. Every sub-dispatcher below
  // already reports malformed input this way (`!isFunction(proposition)`,
  // `!fact.isValid`); the fallthrough now matches them.
  return 'not-a-predicate';
}

/**
 * Predicate operators that are syntactically valid assumptions but that the
 * structural-predicate layer cannot represent (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md
 * §7 non-goals). `assume()` reports these as `'not-a-predicate'`.
 */
const UNSUPPORTED_PREDICATE_OPERATORS = new Set<string>([
  'Or',
  'Not',
  'Implies',
  'Equivalent',
  'Xor',
  'Nand',
  'Nor',
  'ForAll',
  'Exists',
  'ExistsUnique',
  'ForElement',
]);

/**
 * Assume a conjunction: each conjunct is assumed independently
 * (design §3.2, "shallow saturation").
 *
 * Result: `'contradiction'` if any conjunct contradicts,
 * `'not-a-predicate'` if any conjunct is unsupported, `'tautology'` if
 * every conjunct was already known, `'ok'` otherwise.
 */
function assumeConjunction(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'And');
  if (!isFunction(proposition)) return 'not-a-predicate';

  // Atomicity (SYM P2-9): a conjunction applies all-or-nothing when it
  // contradicts — `And(p > 0, p < −5)` must report `'contradiction'` and
  // leave `p > 0` nowhere. The undo log of the enclosing transaction is what
  // provides it: each conjunct is applied for real and the whole log is
  // rolled back on a contradiction. A `'not-a-predicate'` conjunct is NOT a
  // rollback — the conjuncts applied before it stand, which is the historical
  // behavior of `assume(And(x > 3, Foo(x)))`.
  let sawOk = false;
  let sawNotAPredicate = false;
  for (const conjunct of proposition.ops) {
    const result = assume(conjunct);
    if (result === 'contradiction' || result === 'internal-error')
      return result;
    if (result === 'not-a-predicate') sawNotAPredicate = true;
    else if (result === 'ok') sawOk = true;
  }
  if (sawNotAPredicate) return 'not-a-predicate';
  return sawOk ? 'ok' : 'tautology';
}

/**
 * Assume a disequality `NotEqual(x, v)` or `NotEqual(Part(x), v)`
 * (design §4.1; stored in the §3.2 normal form `NotEqual(subject, v)`).
 */
function assumeNotEqual(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'NotEqual');
  if (!isFunction(proposition) || proposition.ops.length !== 2)
    return 'not-a-predicate';
  return storeNotEqual(proposition.engine, proposition.op1, proposition.op2);
}

/**
 * Store a `NotEqual(lhs, rhs)` fact in the assumptions DB.
 *
 * Contradiction scope (design §4.3): if neither side has unknowns (e.g.
 * the symbol has an assigned value), the disequality is decided now and
 * yields `'tautology'`/`'contradiction'` instead of being stored.
 */
function storeNotEqual(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): AssumeResult {
  const fact = ce.function('NotEqual', [lhs, rhs]);
  if (!fact.isValid) return 'not-a-predicate';

  if (fact.unknowns.length === 0) {
    const val = fact.evaluate();
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
  }

  return recordFact(ce, fact, true);
}

/**
 * Assume `NotElement(x, S)`: store an exclusion fact (design §4.1).
 */
function assumeNotElement(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'NotElement');
  if (!isFunction(proposition) || proposition.ops.length !== 2)
    return 'not-a-predicate';
  const ce = proposition.engine;
  const dom = proposition.op2.evaluate();
  if (!dom.isValid) return 'not-a-predicate';
  return storeNotElement(ce, proposition.op1, dom);
}

/**
 * Store a `NotElement(x, setExpr)` exclusion fact in the assumptions DB.
 * If `x` has a value, the exclusion is decided by evaluation instead.
 */
function storeNotElement(
  ce: ComputeEngine,
  x: Expression,
  setExpr: Expression
): AssumeResult {
  const fact = ce.function('NotElement', [x, setExpr]);
  if (!fact.isValid) return 'not-a-predicate';

  const xSymbol = isSymbol(x) ? x.symbol : undefined;
  if (xSymbol === undefined || hasValue(ce, xSymbol)) {
    const val = fact.evaluate();
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
  }

  return recordFact(ce, fact, true);
}

function assumeEquality(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'Equal');
  // Four cases:
  // 1/ proposition contains no unknowns
  //    e.g. `2 + 1 = 3`, `\pi + 1 = \pi`
  //    => evaluate and return
  //
  // 2/ lhs is a single unknown and `rhs` does not contain `lhs`
  //    e.g. `x = 2`, `x = 2\pi`
  //    => if `lhs` has a definition, set its value to `rhs`, otherwise
  //          declare a new symbol with a value of `rhs`
  //
  // 3/ proposition contains a single unknown
  //    => solve for the unknown, create new def or set value of the
  //      unknown with the root(s) as value
  //
  // 4/ proposition contains multiple unknowns
  //    => add (lhs - rhs = 0) to assumptions DB

  // Case 1
  const unknowns = proposition.unknowns;
  if (unknowns.length === 0) {
    const val = proposition.evaluate();
    if (isSymbol(val, 'True')) return 'tautology';
    if (isSymbol(val, 'False')) return 'contradiction';
    return 'not-a-predicate';
  }

  const ce = proposition.engine;

  // Case 2
  // @todo: this is dubious. Should we allow this?
  // i.e. `ce.assume(ce.parse("x = 3"))`
  // that's not really an assumption, that's an assignment.
  // Assumptions are meant to be complementary to declarations, not replacing
  // them, i.e. `ce.assume(ce.parse("x > 0"))`
  if (!isFunction(proposition)) return 'not-a-predicate';
  const lhsExpr = proposition.op1;
  const lhs = isSymbol(lhsExpr) ? lhsExpr.symbol : undefined;
  if (lhs && !hasValue(ce, lhs) && !proposition.op2.has(lhs)) {
    const val = proposition.op2.evaluate();
    if (!val.isValid) return 'not-a-predicate';
    return storeEquality(ce, lhs, val);
  }

  // Case 3
  if (unknowns.length === 1) {
    const lhs = unknowns[0];
    const sols = findUnivariateRoots(proposition, lhs);
    const def = ce.lookupDefinition(lhs);

    // Contradiction check (P1-3): an *explicitly* typed symbol whose declared
    // type is incompatible with every root is inconsistent with the equation.
    // Compare *each root* against the definition's type; the earlier code
    // compared the roots-`List` type (`list<…>`) against each root's type,
    // which never matched and so always reported a contradiction for
    // multi-root equations. A single compatible root suffices — with
    // `x: natural`, `x² = 4` is satisfiable (x = 2) even though the root −2
    // is not. As in Case 2, an *inferred* declared type is widened, not
    // enforced.
    if (
      def &&
      isValueDef(def) &&
      def.value.type &&
      !def.value.inferredType &&
      sols.length > 0 &&
      !sols.some((sol) => !sol.type || sol.type.matches(def.value.type!))
    )
      return 'contradiction';

    // Zero or multiple roots: the symbol is *not* uniquely determined, so
    // store the equation itself as an opaque fact (answered later by the
    // `verify()` DB lookup) rather than assigning a value. (P1-3: the old
    // code assigned `x := List(2, −2)` — a *list* — as the value of `x`,
    // which then broadcast through arithmetic, e.g. `x + 1 → List(3, −1)`.)
    if (sols.length !== 1)
      return recordFact(
        ce,
        ce.function('Equal', [proposition.op1.sub(proposition.op2), 0]),
        true
      );

    // Exactly one root: it is the symbol's value for as long as the fact
    // holds.
    return storeEquality(ce, lhs, sols[0]);
  }

  return recordFact(ce, proposition, true);
}

function assumeInequality(proposition: Expression): AssumeResult {
  //
  // 1/ lhs is a single **undefined** free var e.g. "x < 0"
  //    => define a new var, if the domain can be inferred set it, otherwise
  // RealNumbers and add to assumptions (e.g. x < 5)
  // 2/ (lhs - rhs) is an expression with no free vars
  //  e.g. "\pi < 5"
  //  => evaluate
  // 3/ (lhs - rhs) is an expression with a single **undefined** free var
  //    e.g. "x + 1 < \pi"
  //    => add def as RealNumbers, add to assumptions
  // 4/ (lhs - rhs) is an expression with multiple free vars
  //    e.g. x + y < 0
  //    => add to assumptions

  const ce = proposition.engine;
  // Case 1
  // if (proposition.op1!.symbol && !hasDef(ce, proposition.op1!.symbol)) {
  //   if (proposition.op2.is(0)) {
  //     if (proposition.operator === 'Less') {
  //       // x < 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'negative' },
  //       });
  //     } else if (proposition.operator === 'LessEqual') {
  //       // x <= 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'non-positive' },
  //       });
  //     } else if (proposition.operator === 'Greater') {
  //       // x > 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'positive' },
  //       });
  //     } else if (proposition.operator === 'GreaterEqual') {
  //       // x >= 0
  //       ce.defineSymbol(proposition.op1.symbol, {
  //         type: 'real',
  //         flags: { sgn: 'non-negative' },
  //       });
  //     }
  //   } else {
  //     ce.defineSymbol(proposition.op1.symbol, { type: 'real' });
  //     recordFact(ce, proposition, true);
  //   }
  //   return 'ok';
  // }
  // // @todo: handle if proposition.op1 *has* a def (and no value)

  // Normalize to Less, LessEqual
  if (!isFunction(proposition)) return 'internal-error';

  // Chained comparison (P1-2): a same-operator n-ary chain `a < b < c` means
  // `a < b ∧ b < c ∧ …`. Decompose into pairwise conjuncts and assume each,
  // so that *every* link is established (not just the first pair). Mixed
  // chains (`a ≤ b > c`) canonicalize to an explicit `And` and are handled by
  // `assumeConjunction` before reaching here.
  if (proposition.ops.length > 2) {
    const chainOps = proposition.ops;
    const chainOp = proposition.operator;
    let sawOk = false;
    for (let i = 0; i + 1 < chainOps.length; i++) {
      const r = assumeInequality(
        ce.function(chainOp, [chainOps[i], chainOps[i + 1]])
      );
      if (r === 'contradiction' || r === 'internal-error') return r;
      if (r === 'ok') sawOk = true;
    }
    return sawOk ? 'ok' : 'tautology';
  }

  let op = '';
  let lhs: Expression;
  let rhs: Expression;
  if (proposition.operator === 'Less') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<';
  } else if (proposition.operator === 'LessEqual') {
    lhs = proposition.op1;
    rhs = proposition.op2;
    op = '<=';
  } else if (proposition.operator === 'Greater') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<';
  } else if (proposition.operator === 'GreaterEqual') {
    lhs = proposition.op2;
    rhs = proposition.op1;
    op = '<=';
  }
  if (!op) return 'internal-error';
  // The proposition is boxed `{ form: 'raw' }` (engine-assumptions.ts), so its
  // operands are non-canonical. Arithmetic (`.sub()`, and the `.neg()` it calls)
  // must run on canonical operands — otherwise a canonical `Negate` ends up
  // wrapping a non-canonical symbol, tripping the `isCanonical` assert in
  // `BoxedSymbol.toNumericValue` once the difference is numerically compared.
  const p = lhs!.canonical.sub(rhs!.canonical);

  // Case 2
  const result = ce.expr([op === '<' ? 'Less' : 'LessEqual', p, 0]).evaluate();

  if (isSymbol(result, 'True')) return 'tautology';
  if (isSymbol(result, 'False')) return 'contradiction';

  const unknowns = result.unknowns;
  if (unknowns.length === 0) return 'not-a-predicate';

  //
  // Part-subject inequalities (design §4.2), e.g. `Re(s) > 1` normalized to
  // `Less(1 - Real(s), 0)`: the normalized lhs is ±Part(x) plus an optional
  // numeric constant, where Part ∈ {Real, Imaginary, Abs, Argument}.
  //
  const normalizedLhs = isFunction(result) ? result.op1 : undefined;
  const partSubject =
    normalizedLhs !== undefined ? partBoundSubject(normalizedLhs) : undefined;
  if (partSubject !== undefined) {
    const newBounds = boundsFromNormalizedInequality(result, partSubject);

    // Bounds-level tautology/contradiction check against existing bounds on
    // the *same* subject (design §4.3; cross-subject consistency is out of
    // scope).
    if (newBounds !== undefined) {
      const existing = boundsForCurrentDefinition(ce, partSubject);
      const status = checkBoundsAgainst(existing, newBounds);
      if (status !== undefined) return status;
    }

    // What a part-predicate over Real/Imaginary/Abs/Argument(x) proves about
    // the WHOLE value — at most `x: number`, or `complex` when a finite
    // upper bound on `Abs(x)` proves finiteness — is a CONTRIBUTION the type
    // read merges in from the fact recorded just below, derived in
    // `boxed-expression/constraint-subject.ts`. All this path owes it is a
    // definition to be recorded against.
    declareProvisional(ce, partSubject.symbol);

    // Store the normalized part-bound (normal form §3.2)
    const stored = recordFact(ce, result, true);
    if (stored !== 'ok') return stored;

    // Derived facts (design §3.2), stored alongside — never inferred at
    // query time: `Imaginary(x)` bounded away from 0 implies `x ∉ ℝ` and
    // `x ≠ 0`.
    if (
      partSubject.part === 'im' &&
      newBounds !== undefined &&
      boundsExcludeZero(newBounds)
    ) {
      storeNotElement(
        ce,
        ce.symbol(partSubject.symbol),
        ce.symbol('RealNumbers')
      );
      storeNotEqual(ce, ce.symbol(partSubject.symbol), ce.Zero);
    }

    return 'ok';
  }

  // Check if the new inequality is implied by or contradicts existing bounds
  // (for single-symbol inequalities)
  if (unknowns.length === 1) {
    const symbol = unknowns[0];
    const bounds = boundsForCurrentDefinition(ce, toSubject(symbol));

    // The normalized form is Less(p, 0) or LessEqual(p, 0) where p = lhs - rhs
    // For a simple symbol case like "x > k", this becomes Less(-x + k, 0) meaning k - x < 0, i.e., x > k
    // For "x < k", this becomes Less(x - k, 0) meaning x - k < 0, i.e., x < k

    // Check if this is a simple "symbol > value" or "symbol < value" case
    const originalOp = proposition.operator;
    const propOp1 = proposition.op1;
    const propOp2 = proposition.op2;
    const isSymbolOnLeft = isSymbol(propOp1, symbol);
    const otherSide = isSymbolOnLeft ? propOp2 : propOp1;

    // Only do bounds checking for simple comparisons like "x > k" where k is numeric
    const otherNumericValue = isNumber(otherSide)
      ? otherSide.numericValue
      : undefined;
    if (otherNumericValue !== undefined) {
      const k = otherNumericValue;

      if (typeof k === 'number' && isFinite(k)) {
        // Determine the EFFECTIVE relationship based on operator and symbol position
        // Less(a, b) means a < b:
        //   - if a is symbol: symbol < b, effective is "less"
        //   - if b is symbol: a < symbol, so symbol > a, effective is "greater"
        // Greater(a, b) means a > b:
        //   - if a is symbol: symbol > b, effective is "greater"
        //   - if b is symbol: a > symbol, so symbol < a, effective is "less"
        let effectiveOp: 'greater' | 'greaterEqual' | 'less' | 'lessEqual';
        if (originalOp === 'Greater') {
          effectiveOp = isSymbolOnLeft ? 'greater' : 'less';
        } else if (originalOp === 'GreaterEqual') {
          effectiveOp = isSymbolOnLeft ? 'greaterEqual' : 'lessEqual';
        } else if (originalOp === 'Less') {
          effectiveOp = isSymbolOnLeft ? 'less' : 'greater';
        } else {
          // LessEqual
          effectiveOp = isSymbolOnLeft ? 'lessEqual' : 'greaterEqual';
        }

        // Check for tautologies and contradictions based on existing bounds
        if (effectiveOp === 'greater' || effectiveOp === 'greaterEqual') {
          // We're asserting symbol > k or symbol >= k
          const isStrict = effectiveOp === 'greater';

          if (bounds.lower !== undefined) {
            const lowerVal = isNumber(bounds.lower)
              ? bounds.lower.numericValue
              : undefined;
            if (typeof lowerVal === 'number' && isFinite(lowerVal)) {
              // We already know symbol > lowerVal (or >=)
              if (isStrict) {
                // Assuming symbol > k: tautology if existing lower bound implies this
                // If lowerVal > k, then symbol > lowerVal > k, so symbol > k (tautology)
                // If lowerVal == k and bound is strict, then symbol > lowerVal = k (tautology)
                if (lowerVal > k) return 'tautology';
                if (bounds.lowerStrict && lowerVal >= k) return 'tautology';
              } else {
                // Assuming symbol >= k: tautology if lowerVal >= k (with strict bound) or lowerVal > k
                if (lowerVal > k) return 'tautology';
                if (bounds.lowerStrict && lowerVal >= k) return 'tautology';
                if (!bounds.lowerStrict && lowerVal >= k) return 'tautology';
              }
            }
          }

          if (bounds.upper !== undefined) {
            const upperVal = isNumber(bounds.upper)
              ? bounds.upper.numericValue
              : undefined;
            if (typeof upperVal === 'number' && isFinite(upperVal)) {
              // We know symbol < upperVal (or <=), now checking symbol > k
              if (isStrict) {
                // Contradiction if upperVal <= k
                if (upperVal < k) return 'contradiction';
                if (bounds.upperStrict && upperVal <= k) return 'contradiction';
                if (!bounds.upperStrict && upperVal <= k)
                  return 'contradiction';
              } else {
                // symbol >= k: contradiction if upperVal < k
                if (upperVal < k) return 'contradiction';
                if (bounds.upperStrict && upperVal <= k) return 'contradiction';
              }
            }
          }
        } else {
          // effectiveOp is 'less' or 'lessEqual'
          // We're asserting symbol < k or symbol <= k
          const isStrict = effectiveOp === 'less';

          if (bounds.upper !== undefined) {
            const upperVal = isNumber(bounds.upper)
              ? bounds.upper.numericValue
              : undefined;
            if (typeof upperVal === 'number' && isFinite(upperVal)) {
              // We already know symbol < upperVal (or <=)
              if (isStrict) {
                // Assuming symbol < k: tautology if existing upper bound implies this
                if (upperVal < k) return 'tautology';
                if (bounds.upperStrict && upperVal <= k) return 'tautology';
              } else {
                // symbol <= k: tautology if upperVal <= k
                if (upperVal < k) return 'tautology';
                if (upperVal <= k) return 'tautology';
              }
            }
          }

          if (bounds.lower !== undefined) {
            const lowerVal = isNumber(bounds.lower)
              ? bounds.lower.numericValue
              : undefined;
            if (typeof lowerVal === 'number' && isFinite(lowerVal)) {
              // We know symbol > lowerVal (or >=), now checking symbol < k
              if (isStrict) {
                // Contradiction if lowerVal >= k
                if (lowerVal > k) return 'contradiction';
                if (bounds.lowerStrict && lowerVal >= k) return 'contradiction';
                if (!bounds.lowerStrict && lowerVal >= k)
                  return 'contradiction';
              } else {
                // symbol <= k: contradiction if lowerVal > k
                if (lowerVal > k) return 'contradiction';
                if (bounds.lowerStrict && lowerVal > k) return 'contradiction';
              }
            }
          }
        }
      }
    }
  }

  // Case 3: single unknown. An inequality implies the symbol is a real
  // number, and a simple comparison against a finite literal implies a
  // RANGE. Both are CONTRIBUTIONS the type READ merges into the declared
  // type from the fact recorded just below — nothing is written here, so
  // retracting the fact retracts what it proved and no stored type can be
  // built from it (`docs/plans/2026-08-29-assumptions-as-facts-type.md`
  // §2.5; the contributions themselves are derived in
  // `boxed-expression/constraint-subject.ts`).
  //
  // A part term (Real/Imaginary/Abs/Argument of a symbol) is excluded here
  // as it was before: `Re(s) + Im(s) < 0` does not imply `s: real` (design
  // §4.2, case 4 — this was the `Re(s) > 1` destructive-retype bug).
  //
  // All this path still owes the fact is a definition to be recorded
  // against, so that the contribution has a subject.
  if (
    unknowns.length === 1 &&
    (normalizedLhs === undefined || !containsPartTerm(normalizedLhs))
  )
    declareProvisional(ce, unknowns[0]);

  // Case 3, 4
  // An INVALID result is not a normalized inequality — `Re(s) > 1` on a
  // `string` subject reduces to the `incompatible-type` error itself — and
  // `recordFact` refuses it just below, so it must not trip this assert.
  console.assert(
    !result.isValid ||
      result.operator === 'Less' ||
      result.operator === 'LessEqual'
  );
  return recordFact(ce, result, true);
}

/**
 * The form of a set expression a membership assumption is decomposed from and
 * recorded in.
 *
 * The set is EVALUATED, so that a name (`Integers`, a symbol bound to a set)
 * and a computed set expression alike reach the decomposition below as the set
 * they denote. Evaluation, however, also MATERIALIZES a union of finite
 * ranges: `Union(Range(1, 3), Range(5, 7))` folds to `Set(1, 2, 3, 5, 6, 7)`,
 * and a finite set literal proves no type at all (`membershipType`,
 * `boxed-expression/constraint-subject.ts`), so `assume(m ∈ Union(Range(1, 3),
 * Range(5, 7)))` left `m` `unknown` where the very same union with an infinite
 * arm — which evaluation leaves alone — proves `integer`. Keep the written
 * form whenever evaluating it loses the type it proves.
 *
 * The choice is made ONCE, here, and the chosen form is both decomposed and
 * recorded: the tier the membership is judged by and the tier a reader later
 * derives from the stored fact come from the same expression.
 */
function normalizedSetOperand(setExpr: Expression): Expression {
  const evaluated = setExpr.evaluate();
  if (!evaluated.isValid || membershipType(evaluated) !== undefined)
    return evaluated;
  return membershipType(setExpr) !== undefined ? setExpr : evaluated;
}

function assumeElement(proposition: Expression): AssumeResult {
  console.assert(proposition.operator === 'Element');

  // Cases:
  // 1/ lhs is a bare symbol
  //    => decompose the set per the design §3.2 table
  //       (`assumeElementOfSet`): type refinement, bound facts, exclusion
  //       facts, membership facts
  //
  // 2/ lhs is an expression with some free variables with no definition
  //    e.g. `x+2 \in \R`
  //    => declare the single undefined var if the domain maps to a type
  //       (historical behavior), otherwise add to assumptions DB
  //
  // 3/ otherwise (expression with no undefined vars)
  //    => evaluate and return result (contradiction or tautology)

  const ce = proposition.engine;
  if (!isFunction(proposition)) return 'not-a-predicate';

  const dom = normalizedSetOperand(proposition.op2);
  if (!dom.isValid) return 'not-a-predicate';

  // Case 1: bare symbol — decompose the set
  const propOp1 = proposition.op1;
  if (isSymbol(propOp1)) return assumeElementOfSet(ce, propOp1.symbol, dom);

  // Case 2: compound lhs. Stored verbatim, as a fact about the expression:
  // `x + 2 ∈ ℝ` says nothing about `x` that a fact about `x` itself could
  // carry, and an assumption declares nothing.
  //
  // Note: this is not 'unknowns' because proposition is not canonical (so
  // all symbols are "unknowns")
  const undefs = undefinedIdentifiers(propOp1);
  if (undefs.length > 0) return recordFact(ce, proposition, true);

  // Case 3
  const val = proposition.evaluate();
  if (isSymbol(val, 'True')) return 'tautology';
  if (isSymbol(val, 'False')) return 'contradiction';
  return 'not-a-predicate';
}

/**
 * Assume `symbol ∈ setExpr`, decomposing structured sets into independent
 * stored facts plus type refinements ("shallow saturation", design §3.2):
 *
 * | Set shape | Action |
 * |---|---|
 * | primitive number set (ℂ, ℝ, ℤ…) | type refinement (historical behavior) |
 * | `Range(a, b)` | `integer` refinement + bound facts `a ≤ x ≤ b` |
 * | `Interval(a, b)` (with `Open` markers) | `real` refinement + bound facts |
 * | `SetMinus(S, Set(e1…en))` | recurse on `S` + `NotEqual(x, ei)` facts |
 * | `SetMinus(S, T)`, non-finite `T` | recurse on `S` + `NotElement(x, T)` fact |
 * | inert/unknown set | stored membership fact (used to throw) |
 *
 * Infinite or non-numeric interval endpoints are skipped (no bound fact).
 */
function assumeElementOfSet(
  ce: ComputeEngine,
  symbol: string,
  setExpr: Expression
): AssumeResult {
  // 1. Primitive number sets → the membership fact alone; the type it
  //    proves is merged in by the type read (`membershipType`,
  //    `boxed-expression/constraint-subject.ts`).
  const type = domainToType(setExpr);
  if (type !== 'unknown') return recordMembership(ce, symbol, setExpr, type);

  // 1b. Signed number sets (SYM P2-11): the positive/negative/non-negative/
  //     non-positive integer and real sets decompose into a base type
  //     *plus* a sign bound, so that `isInteger`/`isPositive` etc.
  //     respond (e.g. `assume(k ∈ PositiveIntegers)` ⇒ `k` integer and > 0).
  //     The membership fact alone yields no bound.
  if (isSymbol(setExpr)) {
    const signed = SIGNED_NUMBER_SETS[setExpr.symbol];
    if (signed !== undefined) {
      const r = recordMembership(ce, symbol, setExpr, signed.type);
      if (r !== 'ok') return r;
      const b = assumeBound(ce, symbol, signed.op, ce.number(signed.value));
      return b === 'contradiction' ? 'contradiction' : 'ok';
    }
  }

  // 2. Range(lo, hi[, step]): integer-valued (`ZZGreaterEqual(1)`
  //    translates to Range(1, +∞))
  if (isFunction(setExpr, 'Range') && setExpr.ops.length >= 2) {
    const result = recordMembership(ce, symbol, setExpr, 'integer');
    if (result !== 'ok') return result;

    let [lo, hi] = setExpr.ops;
    const step = setExpr.ops[2];
    if (step !== undefined && step.isSame(-1)) [lo, hi] = [hi, lo];
    // For non-unit steps only the type refinement is kept
    if (step !== undefined && !step.isSame(1) && !step.isSame(-1)) return 'ok';

    if (assumeBound(ce, symbol, 'GreaterEqual', lo) === 'contradiction')
      return 'contradiction';
    if (assumeBound(ce, symbol, 'LessEqual', hi) === 'contradiction')
      return 'contradiction';
    return 'ok';
  }

  // 3. Interval(lo, hi), endpoints possibly wrapped in `Open`
  if (isFunction(setExpr, 'Interval') && setExpr.ops.length === 2) {
    const result = recordMembership(ce, symbol, setExpr, 'real');
    if (result !== 'ok') return result;

    let [lo, hi] = setExpr.ops;
    let loStrict = false;
    let hiStrict = false;
    if (isFunction(lo, 'Open')) {
      loStrict = true;
      lo = lo.op1;
    }
    if (isFunction(hi, 'Open')) {
      hiStrict = true;
      hi = hi.op1;
    }

    if (
      assumeBound(ce, symbol, loStrict ? 'Greater' : 'GreaterEqual', lo) ===
      'contradiction'
    )
      return 'contradiction';
    if (
      assumeBound(ce, symbol, hiStrict ? 'Less' : 'LessEqual', hi) ===
      'contradiction'
    )
      return 'contradiction';
    return 'ok';
  }

  // 4. SetMinus(S, T): recurse on S, then store exclusions
  if (isFunction(setExpr, 'SetMinus') && setExpr.ops.length === 2) {
    const [base, excluded] = setExpr.ops;
    const result = assumeElementOfSet(ce, symbol, normalizedSetOperand(base));
    if (result === 'contradiction' || result === 'internal-error')
      return result;

    if (isFunction(excluded, 'Set')) {
      // Finite exclusion set: store a disequality per element
      for (const e of excluded.ops) {
        if (storeNotEqual(ce, ce.symbol(symbol), e) === 'contradiction')
          return 'contradiction';
      }
      return 'ok';
    }
    // Non-finite exclusion: store a NotElement fact
    const r = storeNotElement(ce, ce.symbol(symbol), excluded);
    return r === 'tautology' ? 'ok' : r;
  }

  // 5, 6. A union of intervals/ranges, and any inert or unknown set: store
  //    the membership fact verbatim (design §4.1 — this used to throw
  //    "Invalid domain"). A union yields a disjunction of bounds, which the
  //    fact layer does not represent, so only the type it proves — `integer`
  //    for a union of ranges, `real` when an interval is in the mix —
  //    reaches the reader, through the same fact.
  if (isNumber(setExpr) || isString(setExpr)) return 'not-a-predicate';
  // A union of ranges/intervals still proves a tier, and the same producer the
  // fact index uses derives it, so the refusal check just below judges the
  // membership by exactly what a reader will later see it prove. An inert or
  // unknown set proves nothing, and `'unknown'` turns that check off.
  return recordMembership(
    ce,
    symbol,
    setExpr,
    membershipType(setExpr) ?? 'unknown'
  );
}

/**
 * Record `symbol ∈ setExpr` as a fact, after making sure the subject can
 * carry it.
 *
 * `type` is what the membership proves about the subject; it is passed only
 * to refuse a membership an OPERATOR definition's result type cannot satisfy
 * — the contribution the type read merges in is derived from the stored fact
 * itself, never from this argument.
 */
function recordMembership(
  ce: ComputeEngine,
  symbol: string,
  setExpr: Expression,
  type: Type
): AssumeResult {
  const check = checkOperatorSubject(ce, symbol, type);
  if (check !== 'ok') return check;
  declareProvisional(ce, symbol);
  const fact = ce.function('Element', [ce.symbol(symbol), setExpr]);
  return recordFact(ce, fact, true);
}

/**
 * Refuse a membership assumption about a symbol bound to an OPERATOR
 * definition whose result type cannot be a member (`assume(f ∈ Integers)`
 * for an `f` declared `(number) -> string`).
 *
 * A VALUE definition needs no check here: what the facts prove about it is
 * merged into its type by the read, and an empty result is caught by the
 * transaction's consistency pass.
 */
function checkOperatorSubject(
  ce: ComputeEngine,
  symbol: string,
  type: Type
): AssumeResult {
  // `'unknown'` is the caller saying the membership proves no type at all (an
  // inert set). There is nothing to compare, and `isSubtype('unknown', T)` is
  // false for every `T`, so comparing would report a contradiction for a
  // membership that claims nothing.
  if (type === 'unknown') return 'ok';
  const def = ce.lookupDefinition(symbol);
  if (def === undefined || isValueDef(def)) return 'ok';
  if (!isOperatorDef(def)) return 'not-a-predicate';
  // `functionResult` yields `undefined` when the signature has no single
  // result type — an overload set (an intersection of signatures) is the
  // reachable case. "Cannot determine the result type" is not a proven
  // contradiction, so decline to claim one.
  const result = functionResult(def.operator.signature.type);
  if (result === undefined) return 'ok';
  return isSubtype(type, result) ? 'ok' : 'contradiction';
}

/**
 * The interval bounds the facts recorded against the definition that
 * `subject`'s name is bound to NOW put on it.
 *
 * `getInequalityBoundsFromAssumptions` answers by NAME — which is what the
 * query channels want — but an assertion is recorded against a DEFINITION,
 * and the redundancy and consistency of a NEW assertion have to be judged
 * against the same value it is about. Without this, re-declaring `x` in an
 * inner scope and asserting a bound on the new `x` was answered from the
 * enclosing `x`'s bounds: `assume(x > 3)` reported `'tautology'` and recorded
 * nothing, leaving the inner `x` unbounded.
 *
 * Falls back to the name-keyed bounds when the name has no value definition
 * to record an assertion against, so nothing is ever seen LESS than before.
 */
function boundsForCurrentDefinition(
  ce: ComputeEngine,
  subject: Subject
): IntervalBounds {
  const def = ce.lookupDefinition(subject.symbol);
  if (!isValueDef(def)) return getInequalityBoundsFromAssumptions(ce, subject);
  const target = def.value;
  const result: IntervalBounds = {};
  for (const [assumption, records] of contextAssumptions(ce).entries()) {
    const aboutTarget = records.some(
      (record) =>
        record.truth === true &&
        record.subjects.some(
          (s) =>
            s.def === target &&
            s.symbol === subject.symbol &&
            s.part === subject.part
        )
    );
    if (!aboutTarget) continue;
    const partial = boundsFromNormalizedInequality(assumption, subject);
    if (partial !== undefined) mergeTightestBounds(result, partial);
  }
  return result;
}

/**
 * Assume `symbol <op> bound` by delegating to `assumeInequality` (which
 * performs the §4.3 consistency checks and stores the normalized fact).
 *
 * Non-numeric or infinite bounds are skipped: membership in
 * `Range(1, +∞)` yields only the lower bound fact.
 */
function assumeBound(
  ce: ComputeEngine,
  symbol: string,
  op: 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual',
  bound: Expression
): AssumeResult {
  if (!isNumber(bound) || bound.isFinite !== true) return 'ok';
  // Canonical boxing normalizes the operator to Less/LessEqual (possibly
  // swapping the operands), which `assumeInequality` handles directly.
  return assumeInequality(ce.function(op, [ce.symbol(symbol), bound]));
}

/** The numeric (finite, real) value of a bound expression, or undefined. */
function numericBoundValue(b: Expression | undefined): number | undefined {
  if (b === undefined || !isNumber(b)) return undefined;
  const v = b.numericValue;
  const n = typeof v === 'number' ? v : v?.re;
  return typeof n === 'number' && isFinite(n) ? n : undefined;
}

/**
 * Check a candidate bound against the existing bounds for the same subject
 * (design §4.3 — bounds-level consistency only, per subject).
 *
 * Returns `'tautology'` if the new bound is already implied,
 * `'contradiction'` if it is incompatible, `undefined` otherwise (store it).
 */
function checkBoundsAgainst(
  existing: IntervalBounds,
  candidate: IntervalBounds
): 'tautology' | 'contradiction' | undefined {
  // New lower bound: subject > k (strict) or subject >= k
  const newLower = numericBoundValue(candidate.lower);
  if (newLower !== undefined) {
    const strict = candidate.lowerStrict === true;
    const upper = numericBoundValue(existing.upper);
    if (upper !== undefined) {
      if (upper < newLower) return 'contradiction';
      if (upper === newLower && (strict || existing.upperStrict === true))
        return 'contradiction';
    }
    const lower = numericBoundValue(existing.lower);
    if (lower !== undefined) {
      if (lower > newLower) return 'tautology';
      if (lower === newLower && (existing.lowerStrict === true || !strict))
        return 'tautology';
    }
  }

  // New upper bound: subject < k (strict) or subject <= k
  const newUpper = numericBoundValue(candidate.upper);
  if (newUpper !== undefined) {
    const strict = candidate.upperStrict === true;
    const lower = numericBoundValue(existing.lower);
    if (lower !== undefined) {
      if (lower > newUpper) return 'contradiction';
      if (lower === newUpper && (strict || existing.lowerStrict === true))
        return 'contradiction';
    }
    const upper = numericBoundValue(existing.upper);
    if (upper !== undefined) {
      if (upper < newUpper) return 'tautology';
      if (upper === newUpper && (existing.upperStrict === true || !strict))
        return 'tautology';
    }
  }

  return undefined;
}

/** True if the bounds imply the subject is non-zero (e.g. `Im(x) > 0`). */
function boundsExcludeZero(bounds: IntervalBounds): boolean {
  const lower = numericBoundValue(bounds.lower);
  if (
    lower !== undefined &&
    (lower > 0 || (lower === 0 && bounds.lowerStrict === true))
  )
    return true;
  const upper = numericBoundValue(bounds.upper);
  if (
    upper !== undefined &&
    (upper < 0 || (upper === 0 && bounds.upperStrict === true))
  )
    return true;
  return false;
}

function hasDef(ce: ComputeEngine, s: string): boolean {
  return ce.lookupDefinition(s) !== undefined;
}

function undefinedIdentifiers(expr: Expression): string[] {
  return expr.symbols.filter((x) => !hasDef(expr.engine, x));
}

/**
 * Record `symbol = value`.
 *
 * Two records, and no write to the definition: the equality itself becomes a
 * FACT (what it proves about the type — the promoted tier of the value — is
 * merged in by the type read, so `forget()` retracts it), and the value goes
 * into the current context's assumed-value overlay, which the scope that
 * assumed it drops on its pop. A user `declare()`/`assign()` value is stored
 * on the definition instead, and the two never collide.
 */
function storeEquality(
  ce: ComputeEngine,
  symbol: string,
  value: Expression
): AssumeResult {
  declareProvisional(ce, symbol);
  const def = ce.lookupDefinition(symbol);
  if (!isValueDef(def)) return 'not-a-predicate';
  const fact = ce.function('Equal', [ce.symbol(symbol), value]);
  if (!fact.isValid) return 'not-a-predicate';

  // The recording shield hides the value the FIRST assertion installed, so
  // re-asserting the same equality reaches this point instead of folding to
  // `1 = 1`. It states nothing new about the same definition, so it is a
  // tautology and stores nothing: appending a second record for it would grow
  // the store on every repetition and make `forget()` more expensive for no
  // added knowledge.
  const subjects = factSubjects(ce, fact);
  const existing = ce.context.assumptions.get(fact);
  if (
    existing?.some(
      (record) =>
        record.truth === true &&
        record.subjects.length === subjects.length &&
        record.subjects.every(
          (s, i) => s.def === subjects[i].def && s.part === subjects[i].part
        )
    )
  )
    return 'tautology';

  const stored = recordFact(ce, fact, true);
  if (stored !== 'ok') return stored;
  stageAssumedValue(ce, def.value, value);
  return 'ok';
}

function hasValue(ce: ComputeEngine, s: string): boolean {
  const def = ce.lookupDefinition(s);
  if (!def) return false;

  if (isValueDef(def) && def.value.isConstant) return true;

  if (ce._getSymbolValue(s) !== undefined) return true;
  return false;
}

/**
 * Query assumptions to determine the sign of a subject.
 *
 * The subject may be a bare symbol (pass the symbol name, or a `Subject`
 * with `part: 'self'`) or a part-extractor of a symbol, e.g.
 * `{ symbol: 's', part: 're' }` for facts about `Real(s)` (see
 * `boxed-expression/constraint-subject.ts`).
 *
 * Examines inequality assumptions in the current context to determine
 * if the subject's sign can be inferred. Assumptions are stored in
 * normalized form (Less or LessEqual with lhs-rhs compared to 0), so:
 * - `x > 0` is stored as `Less(-x, 0)` meaning `-x < 0`
 * - `x >= 0` is stored as `LessEqual(-x, 0)` meaning `-x <= 0`
 * - `x < 0` is stored as `Less(x, 0)` meaning `x < 0`
 * - `x <= 0` is stored as `LessEqual(x, 0)` meaning `x <= 0`
 * - `Re(s) > 1` is stored as `Less(Add(Negate(Real(s)), 1), 0)`
 *
 * @param ce - The compute engine instance
 * @param subject - The symbol name or `Subject` to query
 * @returns The inferred sign, or undefined if no relevant assumptions found
 */
export function getSignFromAssumptions(
  ce: ComputeEngine,
  subject: string | Subject
): Sign | undefined {
  if (!hasAssumptions(ce)) return undefined;

  const subj = toSubject(subject);

  // Cycle guard. The legacy scan below reads the SIGN of an assumption's
  // sibling terms (`t.isNonNegative` in its Add arm), and with a
  // multi-symbol assumption those reads are mutually recursive: from
  // `assume(b > y + 1)`, the sign of `y` asks the sign of `-b`, which asks
  // the sign of `y`. A subject whose sign query is already in flight on
  // this engine answers `undefined` — the conservative "no assumption
  // decides it".
  const inFlight = signQueryInFlight.get(ce) ?? new Set<string>();
  if (inFlight.size === 0) signQueryInFlight.set(ce, inFlight);
  const flightKey = subjectKey(subj);
  if (inFlight.has(flightKey)) return undefined;
  inFlight.add(flightKey);
  try {
    return getSignFromAssumptionsGuarded(ce, subj);
  } finally {
    inFlight.delete(flightKey);
  }
}

const signQueryInFlight = new WeakMap<ComputeEngine, Set<string>>();

function getSignFromAssumptionsGuarded(
  ce: ComputeEngine,
  subj: Subject
): Sign | undefined {
  // Primary path (Perf P2-3 / SYM P2-7): answer from the cached FactIndex
  // bounds, the same source of truth `verify()` uses. This is O(1) after the
  // index is built (vs. the O(#assumptions) scan below), and it is strictly
  // *sharper*: `n ∈ Range(1, 10)` yields a lower bound of 1 → `positive`,
  // whereas the legacy scan only saw the *sign* of the constant (`≥ 0`) and
  // returned `non-negative`, leaving `n.isPositive` undefined while
  // `verify(n > 0)` was already `true`.
  const index = getFactIndex(ce);
  const key = subjectKey(subj);
  const facts = index.bySubject.get(key);
  if (facts !== undefined) {
    let s = signFromBounds(facts.bounds);
    // Refine a non-strict sign to strict using a disequality-from-zero fact
    // (`x ≥ 0` together with `x ≠ 0` ⇒ `x > 0`). This is a sound superset of
    // both the bounds path and the legacy scan (which handled neither).
    if (
      (s === 'non-negative' || s === 'non-positive') &&
      facts.notEqual.some((v) => v.isSame(0))
    )
      s = s === 'non-negative' ? 'positive' : 'negative';
    if (s !== undefined) return s;
  }

  // Fallback: the legacy linear scan. It is kept only for the cases the
  // FactIndex bounds do not capture — chiefly multi-symbol inequalities whose
  // sibling terms have a *known symbolic sign* but no numeric bound (e.g.
  // `assume(x + y < 0)` with `y` non-negative ⇒ `x` negative). Every case it
  // decides is decided identically or more sharply by the bounds path above,
  // so this preserves the historical envelope as a strict superset.
  //
  // Gate (Perf P2-3): the scan can only decide subjects that appear in some
  // normalized inequality entry; for any other subject it provably returns
  // `undefined`, so skip the O(#assumptions) walk. This never turns
  // "unknown" into a definite sign — it only avoids recomputing "unknown".
  if (!index.inequalitySubjects.has(key)) return undefined;
  return getSignFromAssumptionsLegacy(ce, subj);
}

/**
 * Legacy linear-scan sign inference (superseded by the FactIndex bounds path
 * in `getSignFromAssumptions`; retained only as a fallback for symbolic
 * multi-term inequalities the index does not represent — see the note there).
 */
function getSignFromAssumptionsLegacy(
  ce: ComputeEngine,
  subj: Subject
): Sign | undefined {
  const assumptions = contextAssumptions(ce);

  for (const [assumption, _] of assumptions.entries()) {
    const op = assumption.operator;
    if (!op) continue;

    // Assumptions are normalized to Less or LessEqual
    if (op !== 'Less' && op !== 'LessEqual') continue;

    if (!isFunction(assumption)) continue;
    const ops = assumption.ops;
    if (ops.length !== 2) continue;

    const [lhs, rhs] = ops;

    // Check if RHS is 0 (normalized form: expr < 0 or expr <= 0)
    if (!rhs.isSame(0)) continue;

    // Case 1: Direct subject comparison
    // x < 0 means x is negative
    // x <= 0 means x is non-positive
    if (matchesSubject(lhs, subj)) {
      if (op === 'Less') return 'negative';
      if (op === 'LessEqual') return 'non-positive';
    }

    // Case 2: Negated subject comparison
    // -x < 0 means x > 0 (positive)
    // -x <= 0 means x >= 0 (non-negative)
    if (isFunction(lhs, 'Negate') && matchesSubject(lhs.op1, subj)) {
      if (op === 'Less') return 'positive';
      if (op === 'LessEqual') return 'non-negative';
    }

    // Case 3: Subject with subtraction from constant
    // a - x < 0 means x > a, so if a >= 0, x is positive
    // x - a < 0 means x < a, so if a <= 0, x is negative
    if (isFunction(lhs, 'Subtract')) {
      const [a, b] = lhs.ops;
      if (a && b) {
        // a - x < 0 => x > a
        if (matchesSubject(b, subj) && a.isNonNegative === true) {
          if (op === 'Less') return 'positive';
        }
        // x - a < 0 => x < a
        if (matchesSubject(a, subj) && b.isNonPositive === true) {
          if (op === 'Less') return 'negative';
        }
      }
    }

    // Case 4: Addition form (canonical form of subtraction)
    // x + (-a) < 0 means x < a, so if a <= 0, x is negative
    // -x + a < 0 means -x < -a means x > a, so if a >= 0, x is positive
    if (isFunction(lhs, 'Add')) {
      for (const term of lhs.ops) {
        // Direct subject in sum: check if other terms give us bounds
        if (matchesSubject(term, subj)) {
          // x + ... < 0, check if other terms are all non-negative
          // That would mean x < -(sum of others), so x < non-positive = negative
          const otherTerms = lhs.ops.filter((t) => t !== term);
          if (
            otherTerms.length > 0 &&
            otherTerms.every((t) => t.isNonNegative === true)
          ) {
            if (op === 'Less') return 'negative';
            if (op === 'LessEqual') return 'non-positive';
          }
        }
        // Negated subject in sum: -x + ... < 0
        if (isFunction(term, 'Negate') && matchesSubject(term.op1, subj)) {
          // -x + ... < 0 means x > (sum of others), so if the other terms
          // are all non-negative, x > non-negative = positive
          const otherTerms = lhs.ops.filter((t) => t !== term);
          if (
            otherTerms.length > 0 &&
            otherTerms.every((t) => t.isNonNegative === true)
          ) {
            if (op === 'Less') return 'positive';
            if (op === 'LessEqual') return 'non-negative';
          }
        }
      }
    }
  }

  return undefined;
}

// Re-export from its new home for backward compatibility
import { getInequalityBoundsFromAssumptions } from './boxed-expression/inequality-bounds.js';
export { getInequalityBoundsFromAssumptions };
