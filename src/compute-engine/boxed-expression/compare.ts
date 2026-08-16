import { NumericValue } from '../numeric-value/types.js';
import type {
  BoxedBaseDefinition,
  BoxedValueDefinition,
  Expression,
} from '../global-types.js';
import { getInequalityBoundsFromAssumptions } from './inequality-bounds.js';
import { compareBounds, relationFromChains } from './constraint-subject.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  isString,
  isCharacter,
  isDictionary,
  isObject,
} from './type-guards.js';
import { boundVariableBindings, sameBindingDef } from './binders.js';
import { isTensorValue } from './tensor-view.js';
import { stochasticEqual } from './stochastic-equal.js';

// Lazy reference to break circular dependency:
// expand → arithmetic-add → boxed-tensor → abstract-boxed-expression → compare
type ExpandFn = (expr: Expression) => Expression;
let _expand: ExpandFn;
/** @internal */
export function _setExpand(fn: ExpandFn) {
  _expand = fn;
}

/**
 * Do two same-named symbols denote the same binding?
 *
 * `true` when the name is bound by an enclosing binder on both sides (each
 * denotes its binder, so the name is the whole answer), or when both free
 * occurrences resolve to the same binding — where a standard-library
 * definition counts as the same binding across engines, and a user constant
 * compares by its value. (That last case is BINDING identity — two engines'
 * same-named constant — not value-following: a mutable symbol's value is
 * never dereferenced by `isSame`.) Everything else — including a raw
 * occurrence against a bound one — is a different symbol; a caller comparing
 * a TEMPLATE against a subject asks the syntactic question explicitly via
 * `sameSyntactic`.
 *
 * @internal Exported for `BoxedSymbol.isSame`, which handles the top-level
 * symbol-vs-symbol case before `same()` is reached.
 */
export function sameBinding(
  a: Expression & { symbol: string },
  b: Expression & { symbol: string },
  boundA?: BinderMap,
  boundB?: BinderMap,
  syntactic = false
): boolean {
  // Comparing SYNTAX: the names already matched and bindings are not the
  // question. See `sameSyntactic`.
  if (syntactic) return true;

  // Is each occurrence bound by a binder enclosing it ON ITS OWN SIDE? An
  // occurrence counts as bound only when it RESOLVES to that binder: a symbol
  // carrying an outer binding can sit inside the subtree (`.subs()`
  // transplants one without re-canonicalizing), and comparing that by name is
  // the capture this repair prevents. `null` marks a binder that owns the name
  // but not a definition (a `Function`'s parameter list). An occurrence with
  // NO definition denotes the binder — there is nothing else it could mean,
  // and the parser leaves a binding-site symbol raw (the `k` in
  // `\sum_{k=1}^n`) while `ce.box(json)` binds it.
  const ea = boundA?.get(a.symbol);
  const eb = boundB?.get(b.symbol);
  const aBound = isBoundHere(ea, a.valueDefinition);
  const bBound = isBoundHere(eb, b.valueDefinition);
  // One is its binder's variable and the other is a free reference: different
  // symbols, whatever they are spelled.
  if (aBound !== bBound) return false;
  // Both bound, names already equal: each denotes its own side's binder, and
  // the binders sit at the same position — the same variable.
  if (aBound) return true;

  // Free occurrences: which binding do they refer to? `baseDefinition` covers
  // operator definitions too — a symbol naming a local function has no
  // `valueDefinition`, and reading only that would make two distinct local
  // functions of the same name compare equal.
  const ad = a.baseDefinition;
  const bd = b.baseDefinition;

  // Same definition object (or both unbound): the common case, and the only
  // way two same-engine occurrences of one symbol compare — check it before
  // anything that would walk or compare values.
  //
  // A call frame's parameter definition counts as the literal's own binding
  // for that parameter: it is an ACTIVATION of it, and activations are
  // deliberately indistinguishable (§2.1 of the binder-mechanism design). One
  // hop on each side, so the newly-equal pairs are exactly (static binding,
  // its activation) and (two activations of the same binder) — a stored
  // value's free `x` and a frame's `x` stay unequal.
  if (sameBindingDef(ad, bd)) return true;

  // A standard-library symbol is not a binding: `Pi`, `Nothing`, `Sin` denote
  // the same object in every engine, so two ROOT-scope definitions can differ
  // in identity (two engine instances, or an engine restart) while naming the
  // same thing. The root scope of the chain IS the standard library — user
  // globals land in a child scope — so this stays exact: a user symbol that
  // merely shadows a library name resolves to its own (non-root) binding and
  // never reaches this carve-out.
  if (
    ad !== undefined &&
    bd !== undefined &&
    isLibraryBinding(a, ad) &&
    isLibraryBinding(b, bd)
  )
    return true;

  // A user-defined constant compares by what it holds: a constant IS its
  // value, so two definitions can legitimately differ in identity while
  // denoting the same thing. But a constant with NO value has nothing to
  // compare — two unrelated valueless constants that merely share a spelling
  // stay distinct (their definitions already differ, above).
  if (ad?.isConstant && bd?.isConstant) {
    const av = (ad as { value?: Expression }).value;
    const bv = (bd as { value?: Expression }).value;
    if (av === undefined || bv === undefined) return false;
    return same(av, bv);
  }

  // Both sides must agree on being bound, AND on the binding — and the
  // bindings differ here.
  //
  // The lenient form — either side unbound ⇒ equal — was not merely "outside
  // the relation for raw expressions": a CANONICAL expression can CONTAIN raw
  // operands, because a lazy operator holds them un-canonicalized. So a
  // canonical `Map(…)` holding a raw `q` compared equal to canonical `Map(…)`s
  // from two different scopes that were themselves unequal — the transitivity
  // bridge sat inside the domain every dedup key uses.
  //
  // A caller that legitimately compares a TEMPLATE against a bound subject
  // asks for it explicitly (`sameSyntactic`) rather than relying on
  // unboundness as an implicit signal.
  return false;
}

/**
 * Is `def` the standard-library definition of `sym.symbol`?
 *
 * The engine's ROOT scope (the end of the parent chain) holds exactly the
 * standard library; every user declaration — including a top-level one —
 * lands in a child scope. Only reached when the two sides' definitions
 * already differ in identity, so the chain walk is off the hot path.
 */
function isLibraryBinding(
  sym: Expression & { symbol: string },
  def: BoxedBaseDefinition
): boolean {
  let scope = sym.engine.context?.lexicalScope;
  if (scope === undefined) return false;
  // Loose check: the chain terminates with `null` OR `undefined` depending on
  // how the root context was built.
  while (scope.parent != null) scope = scope.parent;
  const binding = scope.bindings.get(sym.symbol);
  if (binding === undefined) return false;
  // A scope binding is a tagged record; `baseDefinition` unwraps it, so
  // compare against both halves. (Inline — `isValueDef`/`isOperatorDef` live
  // in `utils.ts`, whose import would close the cycle `binders.ts` broke.)
  return (
    ('value' in binding && binding.value === def) ||
    ('operator' in binding && binding.operator === def)
  );
}

/**
 * Structural equality that compares symbols by NAME, ignoring bindings.
 *
 * For comparing a TEMPLATE against a subject: a rule pattern is parsed raw so
 * canonicalization cannot collapse its structure or mangle its wildcards,
 * which leaves its literal symbols unbound — the `\pi` of `\pi + a -> 2a`
 * must still match a canonical `π`. That is a question about syntax, not
 * about which binding a symbol denotes, so it gets its own entry point.
 */
export function sameSyntactic(a: Expression, b: Expression): boolean {
  return same(a, b, undefined, undefined, true);
}

/** What a node binds: name → its definition, or `null` when the binder names
 * the variable without owning its definition. See `boundVariableBindings`. */
type BinderMap = ReadonlyMap<string, BoxedValueDefinition | null>;

/**
 * Does an occurrence denote the enclosing binder?
 *
 * `entry` is what the binder holds for that name (`undefined` = it does not
 * bind the name at all; `null` = it names the variable without owning a
 * definition). `def` is the occurrence's own binding.
 */
function isBoundHere(
  entry: BoxedValueDefinition | null | undefined,
  def: BoxedValueDefinition | undefined
): boolean {
  if (entry === undefined) return false; // not bound by this binder
  if (entry === null) return true; // binder owns the name, not a definition
  if (def === undefined) return true; // raw occurrence: nothing else it can mean
  return entry === def;
}

/** Merge an enclosing binder map with the one a node introduces. */
function extendBinders(
  outer: BinderMap | undefined,
  inner: BinderMap | undefined
): BinderMap | undefined {
  if (inner === undefined) return outer;
  if (outer === undefined) return inner;
  const merged = new Map(outer);
  for (const [k, v] of inner) merged.set(k, v);
  return merged;
}

/**
 * Structural equality of boxed expressions, up to BINDING IDENTITY.
 *
 * NOT alpha-equivalence: bound occurrences are compared by NAME, so renaming
 * a bound variable changes the answer — `(x ↦ x+1)` ≠ `(y ↦ y+1)`, exactly as
 * in SymPy (`==`) and Mathematica (`SameQ`). What is quotiented is only the
 * IDENTITY of the binding objects for identically-named bound variables (the
 * re-boxing case). If rename-invariance is ever added, `BoxedFunction.hash`
 * must become alpha-invariant first — it folds bound-variable NAMES, and
 * rename-invariant equality over name-keyed hashing silently breaks every
 * hash consumer (`match.ts` anchor bucketing).
 *
 * Two symbols are the same symbol when they share a name AND denote the same
 * binding. A name alone is not identity: since scopes were introduced, the
 * same spelling can name different bindings (a call frame's parameter `x` and
 * a stored value's free `x`), and treating them as one is what let a frame
 * capture a value's free symbols and let `Add` merge two unrelated `x` terms
 * into `2x`. See docs/plans/2026-07-24-defining-scope-dereference-design.md.
 *
 * `bound` carries the names bound by binders ENCLOSING the current position
 * (a `Function`'s parameters, a scoped `Block`/`Sum`/`Comprehension`'s local
 * bindings). A bound occurrence is compared by NAME only: it denotes its
 * binder, not a scope, so re-boxing or reparsing an expression — which mints
 * fresh binding objects for every bound variable — must not change the
 * answer (`serialization.test.ts`, "Bound-variable identity across
 * re-boxing"). Only FREE occurrences ask which binding they refer to.
 *
 * The set is allocated lazily, so comparing binder-free expressions — the hot
 * path, via `Terms.find` — costs exactly what it did before.
 *
 * ### Contract: an equivalence relation
 *
 * Reflexive, symmetric and transitive — unconditionally, for every operand.
 * A symbol's assigned value is NEVER dereferenced: `isSame` is strictly
 * syntactic, so `x := 1` leaves `x.isSame(1)` false, exactly like
 * `x.isSame(y)` with `y := 1`. (Value equality is the `Equal`/`.isEqual()`
 * tier; identity in the free variables is `.isIdenticallyEqual()`.) Any
 * dedup key is therefore safe, including a set mixing symbols and values.
 *
 * An earlier revision exempted RAW operands, on the reasoning that they carry
 * no bindings and so can only be compared syntactically. That broke
 * transitivity even between two CANONICAL expressions: a lazy operator holds
 * its operands un-canonicalized, so a canonical `Map(…)` containing a raw `q`
 * compared equal to canonical `Map(…)`s from two different scopes that were
 * themselves unequal. The bridge sat inside the domain every dedup key uses
 * (`Terms.find`'s like-term collection, the assumptions `ExpressionMap`).
 *
 * Comparing a TEMPLATE against a subject — a rule pattern is raw by
 * necessity — is now an explicit mode (`sameSyntactic`) rather than an
 * implicit consequence of unboundness.
 */
export function same(
  a: Expression,
  b: Expression,
  boundA?: BinderMap,
  boundB?: BinderMap,
  syntactic = false
): boolean {
  if (a === b) return true;

  // An OBJECT is compared by reference identity, unconditionally: it is the
  // one mutable kind, so two objects that are equal by contents now can differ
  // a moment later, and "are these the same object" is the only question whose
  // answer stays true. Reaching the structural branches below would answer
  // `true` for two distinct objects with equal slots. Having already failed
  // the `a === b` fast path, the answer here is always `false`; it is written
  // as the identity comparison because that is the rule, not the outcome.
  if (isObject(a) || isObject(b))
    return (a as Expression) === (b as Expression);

  // A symbol is compared as a symbol, never as its value: exactly one operand
  // being a symbol falls through to the type-mismatch branches below and is
  // `false`.

  //
  // BoxedFunction
  // Operator and operands must match
  //
  if (isFunction(a)) {
    if (a.operator !== b.operator) return false;
    if (!isFunction(b)) return false;
    if (a.nops !== b.nops) return false;
    // What this node binds shadows any outer binding of the same name for the
    // whole subtree. Tracked PER SIDE: `a` and `b` mint their own definitions
    // for the same bound variable (re-boxing does exactly that), so a single
    // shared set would be asymmetric — `same(a,b)` could differ from
    // `same(b,a)`, breaking the equivalence relation this is a key for.
    const innerA = extendBinders(boundA, boundVariableBindings(a));
    const innerB = extendBinders(boundB, boundVariableBindings(b));
    return a.ops.every((op, i) =>
      same(op, b.ops[i], innerA, innerB, syntactic)
    );
  }

  //
  // BoxedNumber
  //
  if (isNumber(a)) {
    if (!isNumber(b)) return false;
    const av = a.numericValue;
    const bv = b.numericValue;
    if (av === bv) return true;
    // Two NaN literals are structurally the same number leaf, whether or not
    // they happen to be the same interned object. `isSame` is a dedup/matching
    // key and must stay an equivalence relation (reflexive on NaN), so it
    // cannot inherit IEEE's `NaN !== NaN` — otherwise `NaN === NaN` in Epsil
    // answers `True` or `False` depending only on whether the operands carried
    // `sourceOffsets` metadata (which defeats interning). This mirrors the
    // explicit NaN check in the primitive overload of `BoxedNumber.isSame`
    // (#15). Tolerant `Equal` is unaffected and keeps IEEE semantics.
    const aNaN = typeof av === 'number' ? Number.isNaN(av) : av.isNaN;
    const bNaN = typeof bv === 'number' ? Number.isNaN(bv) : bv.isNaN;
    if (aNaN || bNaN) return aNaN && bNaN;
    if (typeof av === 'number') {
      if (typeof bv === 'number') return av === bv;
      return bv.eq(av);
    }
    return av.eq(bv);
  }

  //
  // BoxedString and BoxedCharacter
  //
  // The two kinds BRIDGE: a character and a one-cluster string holding the
  // same content are the same VALUE, so they compare equal in both directions
  // (and `BoxedCharacter.hash` uses `BoxedString`'s formula so hashing agrees).
  // This is a value law — two values with identical scalar sequences are equal
  // — not a type conversion: `f(c: character)` still refuses a `string`-TYPED
  // argument. Without it, `c == "a"`, `"a" in "abc"` and `IndexOf("abc", "b")`
  // would each need their own narrowing hook, since all of them reduce to
  // `isSame`. See `docs/plans/2026-08-16-string-phase1-character-type.md`
  // (decision D5).
  if (isString(a) || isString(b) || isCharacter(a) || isCharacter(b)) {
    const sa = isString(a) || isCharacter(a) ? a.string : undefined;
    const sb = isString(b) || isCharacter(b) ? b.string : undefined;
    if (sa === undefined || sb === undefined) return false;
    return sa === sb;
  }

  //
  // BoxedSymbol
  //
  if (isSymbol(a) || isSymbol(b)) {
    if (!isSymbol(a) || !isSymbol(b)) return false;
    if (a.symbol !== b.symbol) return false;
    return sameBinding(a, b, boundA, boundB, syntactic);
  }

  // (No tensor special case: tensor values are canonical `List` function
  // expressions, so the function-expression branch above already compares
  // them structurally, operand by operand.)

  //
  // BoxedDictionary
  // Two dictionaries are structurally equal when they have the same key set and
  // recursively-same values. Keys are compared order-insensitively (a
  // dictionary is a keyed collection, so entry order is not significant). This
  // also makes `.json` round-trips verifiable for dictionaries (RT-P1-2);
  // without it `same()` fell through to `false` for any two distinct dict
  // objects, even structurally identical ones.
  //
  if (isDictionary(a)) {
    if (!isDictionary(b)) return false;
    const aKeys = a.keys;
    if (aKeys.length !== b.keys.length) return false;
    for (const key of aKeys) {
      const bValue = b.get(key);
      if (bValue === undefined) return false;
      if (!same(a.get(key)!, bValue, boundA, boundB, syntactic)) return false;
    }
    return true;
  }

  return false;
}

/**
 * Arithmetic equality of two boxed expressions.
 *
 * The cheap tier, backing `=` (`Equal`) and `.isEqual()`: evaluate the
 * operands, then compare structurally (`isSame`), then — when neither side
 * has unknowns — check that their difference is zero within the engine
 * tolerance. Anything still undecided (in particular, a comparison with free
 * variables) is **inert**: `undefined`, not `false`. No expand, no simplify,
 * no stochastic sampling.
 *
 * Proving an identity in the free variables (`sin²x + cos²x = 1`) is the
 * prover tier's job: see `eqIdentical()` / `.isIdenticallyEqual()`. In
 * general it is impossible to always prove equality
 * ([Richardson's theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)).
 */
export function eq(
  a: Expression,
  inputB: number | Expression
): boolean | undefined {
  return eqImpl(a, inputB, false);
}

/**
 * Identity of two boxed expressions in all their free variables.
 *
 * This is the "prover" tier: in addition to everything `eq()` does, the free
 * variable machinery (stochastic sampling at random sample points, then a
 * symbolic expand+simplify proof) is engaged. Three-valued: a stochastic
 * disagreement degrades to `undefined` rather than a definitive `false`.
 */
export function eqIdentical(
  a: Expression,
  inputB: number | Expression
): boolean | undefined {
  return eqImpl(a, inputB, true);
}

/**
 * Shared implementation of `eq()` and `eqIdentical()`.
 *
 * When `prover` is false, the free-variable branch (stochastic sampling +
 * expand/simplify fallback) is skipped and the comparison degrades to
 * `undefined` at that point.
 */
function eqImpl(
  a: Expression,
  inputB: number | Expression,
  prover: boolean
): boolean | undefined {
  // An OBJECT operand decides by reference identity, and nothing may answer
  // ahead of it — including the two operator `eq` handlers immediately below,
  // which run on the RAW operands and would therefore beat the
  // post-evaluation object branch further down. `a == obj` where `a` is a
  // function expression whose operator supplies an `eq` handler must still be
  // a reference comparison, not whatever that handler makes of an object it
  // was never written for. (Appendix B, "Equality": object comparisons always
  // decide by reference identity and are never inert.)
  //
  // The post-evaluation branch below is still needed and is not redundant
  // with this one: an operand that is a CONSTRUCTOR CALL is not an object
  // until it has been evaluated, and only that branch sees it.
  if (isObject(a) || (typeof inputB !== 'number' && isObject(inputB)))
    return (a as unknown) === (inputB as unknown);

  // We want to give a chance to the eq handler of the functions first.
  // The tier is passed to the handler: a handler that does prover-tier work
  // (e.g. relation equivalence) declines when `prover` is false.
  if (a.operatorDefinition?.eq) {
    const cmp = a.operatorDefinition.eq(a, a.engine.expr(inputB), prover);
    if (cmp !== undefined) return cmp;
  }
  if (typeof inputB !== 'number' && inputB.operatorDefinition?.eq) {
    const cmp = inputB.operatorDefinition.eq(inputB, a, prover);
    if (cmp !== undefined) return cmp;
  }

  //
  // We want to compare the **value** of the boxed expressions.
  //
  // Canonicalize non-canonical inputs first: a non-canonical (unbound)
  // expression such as `Add(1, 1)` does not evaluate under `.N()` (it stays
  // `1 + 1` with `isFinite === false`), which used to collapse to a spurious
  // definitive `false` in the finiteness branch below (CM-P1-3).
  //
  if (!a.isCanonical) a = a.canonical;
  a = a.unknowns.length > 0 ? a : a.N();
  let b: Expression;
  if (typeof inputB === 'number') b = a.engine.expr(inputB);
  else {
    const b0 = inputB.isCanonical ? inputB : inputB.canonical;
    b = b0.unknowns.length > 0 ? b0 : b0.N();
  }

  //
  // The second half of the object rule: an operand that only BECAME an object
  // by being evaluated (a constructor call) is caught here, after evaluation,
  // and still ahead of every path that could otherwise answer for it — the
  // operator `eq` handlers below, the numeric-difference branch, and the
  // assumptions database. (An operand that was already an object on entry was
  // decided by the pre-pass at the top of this function, before the two
  // handler calls that run on the raw operands.) An `assume(a == b)` on two
  // distinct objects must not flip the verdict — an object comparison is a
  // fact about references, not a constraint assumptions can furnish.
  // (Appendix B, "Equality": object comparisons always decide by reference
  // identity and are never inert. A per-type contents-comparison opt-in — the
  // deferred `Equatable` protocol — would carve into this branch and the
  // pre-pass above, and nowhere else.)
  //
  if (isObject(a) || isObject(b))
    return (a as Expression) === (b as Expression);

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (isFunction(a) || isFunction(b)) {
    // If the function has a special handler for equality, use it
    let cmp = a.operatorDefinition?.eq?.(a, b, prover);
    if (cmp !== undefined) return cmp;
    cmp = b.operatorDefinition?.eq?.(b, a, prover);
    if (cmp !== undefined) return cmp;

    // If the expressions are structurally identical, they are equal — EXCEPT
    // a collection containing NaN, where an identical NaN pattern must still
    // compare unequal (`[NaN].isEqual([NaN])` is `false`, mirroring scalar
    // `NaN ≠ NaN`; canonical-comparison #16 pins this, and
    // `BoxedTensor.isEqual` deliberately provided it before the
    // representation unification). The NaN scan is a cheap property walk —
    // far cheaper than discarding the `isSame` result and re-walking with
    // per-element tolerant `eq()` for every identical large list.
    if (a.isSame(b)) {
      if (a.isCollection && b.isCollection && containsNaNLeaf(a)) return false;
      return true;
    }

    // Two collections compare by their elements. Lazy pipelines (`Map(…)`,
    // `Join(…)`, `Filter(…)`) deliberately do not materialize under `.N()`
    // ("pipelines are generators"), so the operator-based handlers above
    // decline and the numeric-difference logic below cannot decide.
    // Ordered comparison when both are indexed; membership otherwise.
    if (a.isCollection && b.isCollection) {
      // A set never equals a sequence, whatever the elements
      if (a.type.matches('set') !== b.type.matches('set')) return false;
      // A STRING never equals a collection of another kind, whatever the
      // characters. A string is an indexed collection of its grapheme
      // clusters, so without this the element walk below compared `"ab"` with
      // `["a", "b"]` character by character and answered True — but `string`
      // and `list<character>` are SIBLINGS in the lattice, neither a subtype
      // of the other, and two values of different kinds are different values
      // (`docs/STRING_ROADMAP.md`). Two strings never reach here: identical
      // ones are caught by `isSame` above, and differing ones have differing
      // characters.
      if (isString(a) !== isString(b)) return false;
      const ca = a.count;
      const cb = b.count;
      if (ca === undefined || cb === undefined) return undefined;
      if (ca !== cb) return false;
      if (!Number.isFinite(ca)) return undefined;
      if (a.isIndexedCollection && b.isIndexedCollection) {
        const itB = b.each();
        for (const xa of a.each()) {
          const xb = itB.next();
          if (xb.done) return false;
          const cmp = eqImpl(xa, xb.value, prover);
          if (cmp !== true) return cmp;
        }
        return true;
      }
      // Unordered (set-like): equal counts + one-way membership
      for (const xa of a.each()) {
        const inB = b.contains(xa);
        if (inB !== true) return inB;
      }
      return true;
    }

    // If the difference is zero (within tolerance), the expressions are equal
    if (a.unknowns.length === 0 && b.unknowns.length === 0) {
      // No free variables, so `.N()` already evaluates the difference fully —
      // the intermediate `.simplify()` was redundant and a latent recursion
      // hazard (`eq` is reachable from `isEqual`, which evaluate handlers call).
      if (a.isFinite && b.isFinite) return isZeroWithTolerance(a.sub(b).N());
      if (a.isNaN || b.isNaN) return false;
      if (a.isInfinity && b.isInfinity && a.sgn === b.sgn) return true;
      // One side is (determinately) infinite and it is not the same infinity
      // as the other: they are provably unequal.
      if (a.isInfinity || b.isInfinity) return false;
      // Finiteness could not be determined (e.g. an inert expression whose
      // value did not resolve to a number). Don't assert a definitive `false`.
      return undefined;
    }

    // The free-variable prover: only the "identical" tier engages it. Without
    // it, a comparison with free variables is simply undecided.
    if (!prover) return undefined;

    // Stochastic evaluation at random sample points, BEFORE the symbolic
    // expand+simplify proof: sampling is a compile + ~50 point evaluations,
    // where expand+simplify on a large tree can cost hundreds of ms — and a
    // sampled verdict is already final in both directions. A sampled
    // *disagreement* refutes only identity-in-all-variables — under the
    // engine's "truth under constraints" equality contract (an assumption
    // such as `x = 4` could still make `x + 1 = 5` true), it is not a
    // definitive `false`, so it degrades to `undefined`; note an identity
    // that expand+simplify could prove cannot genuinely disagree at a shared
    // sample point, so skipping the symbolic proof loses nothing but
    // float-pathology corners the sampling fallback already carried. Sampled
    // *agreement* suggests an identity, which holds under any constraints —
    // the pragmatic `true` is kept. (Decision D9, FINDINGS-TRACKER.md; makes
    // free-variable answers uniform with `x.isEqual(2)` → undefined.)
    const sampled = stochasticEqual(a, b);
    if (sampled !== undefined) return sampled === false ? undefined : sampled;

    // Sampling was uninformative (no compilable/finite sample points — e.g.
    // non-numeric subexpressions or poles everywhere): fall back to the
    // symbolic proof, structural equality after expand+simplify.
    a = _expand(a).simplify();
    b = _expand(b).simplify();
    if (same(a, b)) return true;
    return undefined;
  }

  //
  // A symbol may have special comparison handlers
  //
  if (isSymbol(a)) {
    const cmp = a.valueDefinition?.eq?.(b);
    if (cmp !== undefined) return cmp;
  }
  if (isSymbol(b)) {
    const cmp = b.valueDefinition?.eq?.(a);
    if (cmp !== undefined) return cmp;
  }
  // Two symbols with the same name are equal. Distinct names, however, are
  // NOT a definitive `false`: the symbols may be constrained equal by an
  // assumption (e.g. `assume(a = b)`), or be entirely free (indeterminate).
  // Fall through to the assumptions-DB consult below rather than deciding
  // from the names alone.
  if (isSymbol(a) && isSymbol(b) && a.symbol === b.symbol) return true;

  const ce = a.engine;

  //
  // For number literals, we compare the approximate values, that is
  // we want 0.9 and 9/10 to be considered equal
  //
  if (isNumber(a) && isNumber(b)) {
    if (a.isFinite && b.isFinite) return isZeroWithTolerance(a.sub(b));
    if (a.isNaN || b.isNaN) return false;
    if (a.isInfinity && b.isInfinity && a.sgn === b.sgn) return true;
    return false;
  }

  //
  // Antisymmetry over assumed ≥/≤ chains: if a ≥ … ≥ b and b ≥ … ≥ a
  // (a directed cycle in the assumed inequalities), then a = b.
  //
  if (
    isSymbol(a) &&
    isSymbol(b) &&
    relationFromChains(ce, a.symbol, b.symbol) === '='
  )
    return true;

  //
  // If we didn't come to a resolution yet, check the assumptions DB
  //
  if (ce.ask(ce.expr(['Equal', a, b])).length > 0) return true;
  if (ce.ask(ce.expr(['NotEqual', a, b])).length > 0) return false;

  // If a or b have some unknowns, we can't prove equality
  if (a.unknowns.length > 0 || b.unknowns.length > 0) return undefined;

  //
  // For strings and tensors, mathematical equality is same as structural
  // equality of their values
  //
  return same(a, b);
}

export function cmp(
  a: Expression,
  b: number | Expression
): '<' | '=' | '>' | '>=' | '<=' | undefined {
  // Objects are UNORDERED — there is no `<` on references — so an object
  // operand answers `undefined` up front. This is a guard, not an
  // optimization: without it an object compared against a function expression
  // falls into the function branch below, which computes `a.sub(b)` and
  // `.N()`s the difference on an operand that has no numeric view at all.
  // (`docs/plans/2026-08-14-object-representation-decision.md`, "Equality":
  // "`cmp()` keeps returning `undefined` (objects are unordered)".)
  if (isObject(a) || (typeof b !== 'number' && isObject(b))) return undefined;

  if (isNumber(a)) {
    //
    // Special case when b is a plain machine number
    //
    if (
      typeof b !== 'number' &&
      isNumber(b) &&
      typeof b.numericValue === 'number'
    )
      b = b.numericValue;
    if (typeof b === 'number') {
      if (b === 0) {
        // We could be querying the sign of a number
        const s = a.sgn;
        if (s === undefined) return undefined;
        if (s === 'zero') return '=';
        if (s === 'positive') return '>';
        if (s === 'negative') return '<';
        if (s === 'non-negative') return '>=';
        if (s === 'non-positive') return '<=';
        return undefined;
      }

      // To be mathematically equal to b, a must be a number
      const av = a.numericValue;
      if (typeof av === 'number') {
        // NaN is unordered: comparisons involving it are indeterminate
        if (Number.isNaN(av) || Number.isNaN(b)) return undefined;
        // Exact match first: `Infinity - Infinity` is NaN, so the
        // tolerance check below cannot detect equal infinities
        if (av === b) return '=';
        if (Math.abs(av - b) <= a.engine.tolerance) return '=';
        return av < b ? '<' : '>';
      }
      if (av.isNaN || Number.isNaN(b)) return undefined;
      if (av.eq(b)) return '=';
      const lt = av.lt(b);
      if (lt === undefined) return undefined;
      // Tolerance-aware equality, consistent with the machine path above and
      // the symbol branches below: values within tolerance must not be ordered
      // strictly, or `isEqual` and `isGreater`/`isLess` would both be true
      // (CM-P1-4).
      if (
        av
          .sub(a.engine._numericValue(b))
          .isZeroWithTolerance(a.engine.tolerance)
      )
        return '=';
      return lt ? '<' : '>';
    }

    if (!isNumber(b)) {
      // Check if b is a symbol with inequality assumptions
      if (isSymbol(b)) {
        // A non-real (complex) number cannot be ordered against a real symbol
        if (a.im !== 0) return undefined;
        const bounds = getInequalityBoundsFromAssumptions(a.engine, b.symbol);
        const aNum =
          typeof a.numericValue === 'number'
            ? a.numericValue
            : a.numericValue.re;

        if (aNum !== undefined && Number.isFinite(aNum)) {
          // We're comparing a (number) to b (symbol)
          // If b has a lower bound > a, then a < b
          if (bounds.lower !== undefined) {
            const lb = bounds.lower;
            const lowerNum = isNumber(lb)
              ? typeof lb.numericValue === 'number'
                ? lb.numericValue
                : lb.numericValue.re
              : undefined;

            if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
              // b > lowerBound (if strict) or b >= lowerBound (if not strict)
              // If lowerBound > a, then b > a, so a < b
              if (lowerNum > aNum) return '<';
              // If lowerBound = a and strict (b > a), then a < b
              if (lowerNum === aNum && bounds.lowerStrict) return '<';
              // If lowerBound = a and not strict (b >= a), then a <= b
              if (lowerNum === aNum && !bounds.lowerStrict) return '<=';
            }
          }

          // If b has an upper bound < a, then a > b
          if (bounds.upper !== undefined) {
            const ub = bounds.upper;
            const upperNum = isNumber(ub)
              ? typeof ub.numericValue === 'number'
                ? ub.numericValue
                : ub.numericValue.re
              : undefined;

            if (upperNum !== undefined && Number.isFinite(upperNum)) {
              // b < upperBound (if strict) or b <= upperBound (if not strict)
              // If upperBound < a, then b < a, so a > b
              if (upperNum < aNum) return '>';
              // If upperBound = a and strict (b < a), then a > b
              if (upperNum === aNum && bounds.upperStrict) return '>';
              // If upperBound = a and not strict (b <= a), then a >= b
              if (upperNum === aNum && !bounds.upperStrict) return '>=';
            }
          }

          // Fall back to the symbol's known numeric value.
          // Only order if the symbol's value is provably real.
          const bSymNum = b.re;
          if (
            typeof bSymNum === 'number' &&
            Number.isFinite(bSymNum) &&
            b.im === 0
          ) {
            const tol = a.engine.tolerance;
            if (Math.abs(aNum - bSymNum) <= tol) return '=';
            return aNum < bSymNum ? '<' : '>';
          }
        }
      }
      return undefined;
    }

    const av = a.numericValue;
    const bv = b.numericValue as NumericValue;
    const tol = a.engine.tolerance;
    // NaN is unordered: comparisons involving it are indeterminate
    if (bv.isNaN) return undefined;
    if (typeof av === 'number') {
      if (Number.isNaN(av)) return undefined;
      // Exact equality first: `Infinity - Infinity` is NaN, so the tolerance
      // check below cannot detect equal infinities.
      if (bv.eq(av)) return '=';
      const gt = bv.lt(av); // is `bv < av`? undefined when unordered (complex)
      if (gt === undefined) return undefined;
      // Tolerance-aware equality, consistent with the machine and symbol
      // branches of cmp(): values within tolerance must not be ordered
      // strictly, or `isEqual` and `isLess` would both be true (CM-P1-4).
      if (bv.sub(a.engine._numericValue(av)).isZeroWithTolerance(tol))
        return '=';
      return gt ? '>' : '<';
    }
    if (av.isNaN) return undefined;
    if (av.eq(bv)) return '=';
    const lt = av.lt(bv);
    if (lt === undefined) return undefined;
    if (av.sub(bv).isZeroWithTolerance(tol)) return '=';
    return lt ? '<' : '>';
  }

  if (typeof b === 'number') {
    // Check if a is a symbol with inequality assumptions
    if (isSymbol(a)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);

      // We're comparing a (symbol) to b (number)
      // If a has a lower bound >= b, then a > b (or a >= b)
      if (bounds.lower !== undefined) {
        const lb = bounds.lower;
        const lowerNum = isNumber(lb)
          ? typeof lb.numericValue === 'number'
            ? lb.numericValue
            : lb.numericValue.re
          : undefined;

        if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
          // a > lowerBound (if strict) or a >= lowerBound (if not strict)
          // If lowerBound > b, then a > b
          if (lowerNum > b) return '>';
          // If lowerBound = b and strict (a > b), then a > b
          if (lowerNum === b && bounds.lowerStrict) return '>';
          // If lowerBound = b and not strict (a >= b), then a >= b
          if (lowerNum === b && !bounds.lowerStrict) return '>=';
        }
      }

      // If a has an upper bound <= b, then a < b (or a <= b)
      if (bounds.upper !== undefined) {
        const ub = bounds.upper;
        const upperNum = isNumber(ub)
          ? typeof ub.numericValue === 'number'
            ? ub.numericValue
            : ub.numericValue.re
          : undefined;

        if (upperNum !== undefined && Number.isFinite(upperNum)) {
          // a < upperBound (if strict) or a <= upperBound (if not strict)
          // If upperBound < b, then a < b
          if (upperNum < b) return '<';
          // If upperBound = b and strict (a < b), then a < b
          if (upperNum === b && bounds.upperStrict) return '<';
          // If upperBound = b and not strict (a <= b), then a <= b
          if (upperNum === b && !bounds.upperStrict) return '<=';
        }
      }

      // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE).
      // Only order if the symbol's value is provably real.
      const aNum = a.re;
      if (typeof aNum === 'number' && Number.isFinite(aNum) && a.im === 0) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - b) <= tol) return '=';
        return aNum < b ? '<' : '>';
      }
    }

    // Handle function expressions (e.g., Negate(Pi)) compared to a number
    if (isFunction(a)) {
      if (b === 0) {
        const s = a.sgn;
        if (s === 'zero') return '=';
        if (s === 'positive') return '>';
        if (s === 'negative') return '<';
        if (s === 'non-negative') return '>=';
        if (s === 'non-positive') return '<=';
      }
      const aNum = a.re;
      if (typeof aNum === 'number' && Number.isFinite(aNum)) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - b) <= tol) return '=';
        return aNum < b ? '<' : '>';
      }
    }
    return undefined;
  }

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  // Tensor values first: only equality applies, and this must PRECEDE the
  // generic function branch — a tensor value is a `List` function
  // expression, and the numeric-difference logic there returns `undefined`
  // for it (the old bottom-of-function tensor branch was unreachable for
  // the same reason, for `BoxedTensor` too). Delegate to `eq` (tolerant,
  // NaN-aware, cell-type-agnostic): `[Rgb,Rgb] ≤ [Rgb,Rgb]` is `true`
  // via `=`.
  if (isTensorValue(a) && typeof b !== 'number' && isTensorValue(b))
    return eq(a, b) === true ? '=' : undefined;

  if (isFunction(a) || isFunction(b)) {
    // If the function has a special handler for equality, use it. Only a
    // definite `true` means equal; `false` (definitely not equal) and
    // `undefined` (unknown) fall through to the numeric comparison below.
    const cmp = a.operatorDefinition?.eq?.(a, b);
    if (cmp === true) return '=';

    // Subtract the two expressions. A difference with unknowns can never
    // numericize, so `.N()` would walk it only for the `isNumber` test below
    // to reject it — and over nested user-function applications that walk is
    // exponential in the nesting depth (see `constructibleValues`).
    const diff0 = a.sub(b);
    if (diff0.unknowns.length > 0) return undefined;
    const diff = diff0.N();

    // If the difference is not a number, we can't compare
    // For example, '1 + y' and 'x - 1' can't be compared
    if (!isNumber(diff)) return undefined;

    // We'll use the the tolerance of the engine
    const tol = a.engine.tolerance;

    if (typeof diff.numericValue === 'number') {
      const v = diff.numericValue;
      // A NaN difference is indeterminate, not "greater".
      if (Number.isNaN(v)) return undefined;
      // Compare within tolerance, consistent with the NumericValue path below.
      if (Math.abs(v) <= tol) return '=';
      return v < 0 ? '<' : '>';
    }

    // A NaN difference is indeterminate, not "greater".
    if (diff.numericValue.isNaN) return undefined;
    if (diff.numericValue.isZeroWithTolerance(tol)) return '=';
    return diff.numericValue.lt(0) ? '<' : '>';
  }

  //
  // A symbol
  //
  if (isSymbol(a)) {
    // A symbol without a value is equal to itself
    if (isSymbol(b) && a.symbol === b.symbol) return '=';

    // Symbols may have special comparision handlers
    const cmpResult = a.valueDefinition?.cmp?.(b);
    if (cmpResult) return cmpResult;
    const eqResult = a.valueDefinition?.eq?.(b);
    if (eqResult === true) return '=';

    // Symbol-vs-symbol ordering from assumed interval bounds (SYM P2-8):
    // e.g. `assume(s > 4); assume(t < 1)` ⇒ `s > t`. Only a bounds separation
    // decides the relation; overlapping bounds stay `undefined` (fail closed).
    if (typeof b !== 'number' && isSymbol(b)) {
      const rel = compareBounds(
        getInequalityBoundsFromAssumptions(a.engine, a.symbol),
        getInequalityBoundsFromAssumptions(a.engine, b.symbol)
      );
      if (rel !== undefined) return rel;
    }

    // Check inequality assumptions for the symbol.
    // Only compare against a provably real number (a complex value is unordered
    // and its bounds relationship is indeterminate).
    if (isNumber(b) && b.im === 0) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);
      const bNum =
        typeof b.numericValue === 'number' ? b.numericValue : b.numericValue.re;

      if (bNum !== undefined && Number.isFinite(bNum)) {
        // If symbol has a lower bound >= b, then symbol > b (or symbol >= b)
        if (bounds.lower !== undefined) {
          const lb = bounds.lower;
          const lowerNum = isNumber(lb)
            ? typeof lb.numericValue === 'number'
              ? lb.numericValue
              : lb.numericValue.re
            : undefined;

          if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
            // symbol > lowerBound (if strict) or symbol >= lowerBound (if not strict)
            // If lowerBound > b, then symbol > b
            if (lowerNum > bNum) return '>';
            // If lowerBound = b and strict (symbol > b), then symbol > b
            if (lowerNum === bNum && bounds.lowerStrict) return '>';
            // If lowerBound = b and not strict (symbol >= b), then symbol >= b
            if (lowerNum === bNum && !bounds.lowerStrict) return '>=';
          }
        }

        // If symbol has an upper bound <= b, then symbol < b (or symbol <= b)
        if (bounds.upper !== undefined) {
          const ub = bounds.upper;
          const upperNum = isNumber(ub)
            ? typeof ub.numericValue === 'number'
              ? ub.numericValue
              : ub.numericValue.re
            : undefined;

          if (upperNum !== undefined && Number.isFinite(upperNum)) {
            // symbol < upperBound (if strict) or symbol <= upperBound (if not strict)
            // If upperBound < b, then symbol < b
            if (upperNum < bNum) return '<';
            // If upperBound = b and strict (symbol < b), then symbol < b
            if (upperNum === bNum && bounds.upperStrict) return '<';
            // If upperBound = b and not strict (symbol <= b), then symbol <= b
            if (upperNum === bNum && !bounds.upperStrict) return '<=';
          }
        }
      }
    }

    // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE).
    // Only order if both sides are provably real.
    const aNum = a.re;
    if (typeof aNum === 'number' && Number.isFinite(aNum) && a.im === 0) {
      const bNum = typeof b === 'number' ? b : b.re;
      const bIm = typeof b === 'number' ? 0 : b.im;
      if (typeof bNum === 'number' && Number.isFinite(bNum) && bIm === 0) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - bNum) <= tol) return '=';
        return aNum < bNum ? '<' : '>';
      }
    }

    return undefined;
  }

  //
  // A character
  //
  // Ordered by the NFC CODE-POINT sequence of the cluster, not by
  // `String.prototype.<`: that compares UTF-16 code UNITS, which places every
  // astral character (U+10000 and above, encoded as a surrogate pair starting
  // at 0xD800) BELOW U+E000–U+FFFF — an order no reader expects. The
  // character/string bridge applies here too, so a one-cluster string on
  // either side is compared by the same rule
  // (`docs/plans/2026-08-16-string-phase1-character-type.md`, decision D8).
  // The bridge stops there: a string of two or more clusters is NOT a
  // character, and ordering it against one would answer a comparison the
  // design leaves inert, so that pair yields `undefined`. A string's `count`
  // is its number of NFC grapheme clusters, which is the same "exactly one
  // character" test `isSingleGraphemeCluster` (`boxed-character.ts`) applies —
  // read here off the string's own facet, since importing that module into
  // this one would close a dependency cycle through
  // `abstract-boxed-expression.ts`.
  if (isCharacter(a) || (typeof b !== 'number' && isCharacter(b))) {
    const scalarsOf = (x: Expression): number[] | undefined => {
      if (isCharacter(x)) return x.unicodeScalars;
      if (isString(x) && x.count === 1) return x.unicodeScalars;
      return undefined;
    };
    const sa = scalarsOf(a);
    const sb = typeof b === 'number' ? undefined : scalarsOf(b);
    if (sa === undefined || sb === undefined) return undefined;
    const n = Math.min(sa.length, sb.length);
    for (let i = 0; i < n; i++) {
      if (sa[i] < sb[i]) return '<';
      if (sa[i] > sb[i]) return '>';
    }
    if (sa.length === sb.length) return '=';
    return sa.length < sb.length ? '<' : '>';
  }

  //
  // A string
  //
  if (isString(a)) {
    if (!isString(b)) return undefined;
    if (a.string === b.string) return '=';
    return a.string < b.string ? '<' : '>';
  }

  // (Tensor equality is handled ABOVE the function-expression branch —
  // a tensor value IS a function expression and never reaches this point.)

  return undefined;
}

/** True when any leaf of a (possibly nested) structure is a NaN number
 *  literal. Cheap property walk — used to preserve `NaN ≠ NaN` semantics for
 *  structurally-identical collections without paying the tolerant
 *  element-wise `eq()` walk on every identical pair. */
function containsNaNLeaf(expr: Expression): boolean {
  if (isNumber(expr)) return expr.isNaN === true;
  if (isFunction(expr)) return expr.ops.some((op) => containsNaNLeaf(op));
  return false;
}

function isZeroWithTolerance(expr: Expression): boolean {
  if (!isNumber(expr)) return false;
  const n = expr.numericValue;
  const ce = expr.engine;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}
