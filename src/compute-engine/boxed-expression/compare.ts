import { BigDecimal } from '../../big-decimal/index.js';
import { NumericValue } from '../numeric-value/types.js';
import { MACHINE_PRECISION } from '../numerics/numeric.js';
import type {
  BoxedBaseDefinition,
  BoxedValueDefinition,
  Expression,
} from '../global-types.js';
import { getInequalityBoundsFromAssumptions } from './inequality-bounds.js';
import {
  compareBounds,
  exactCompareNumbers,
  relationFromChains,
} from './constraint-subject.js';
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
 * into `2x`. See docs/SCOPING-MODEL.md.
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
    // Two store-backed lists (`ce.list()`) compare their numbers directly,
    // without boxing: an element is the same when both are `NaN` or when
    // they are `===` (a store never holds `-0`). This is `BoxedNumber.isSame`
    // restricted to machine numbers. A list with a store against one
    // without falls through to the operand walk, which boxes the store.
    const storeA = a._numericStore;
    const storeB = b._numericStore;
    if (storeA !== undefined && storeB !== undefined) {
      for (let i = 0; i < storeA.length; i++) {
        const x = storeA[i];
        const y = storeB[i];
        if (x !== y && !(Number.isNaN(x) && Number.isNaN(y))) return false;
      }
      return true;
    }
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
  // `isSame`. See `docs/STRING_ROADMAP.md`
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
  // The operands before `.N()`, for the assumptions database below.
  const aExact = a;
  a = a.unknowns.length > 0 ? a : a.N();
  let b: Expression;
  let bExact: Expression;
  if (typeof inputB === 'number') b = bExact = a.engine.expr(inputB);
  else {
    bExact = inputB.isCanonical ? inputB : inputB.canonical;
    b = bExact.unknowns.length > 0 ? bExact : bExact.N();
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
      if (a.type.matches('set<any>') !== b.type.matches('set<any>'))
        return false;
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
  // If we didn't come to a resolution yet, check the assumptions DB.
  //
  // A fact is stated with the values the user wrote, and those are not the
  // values of `.N()`: after `assume(x ≠ √2)`, the query `x = √2` must look
  // for `√2`, not for `1.414…`, or the fact is not found. So the operands
  // before `.N()` are looked up first. The operands after `.N()` are looked
  // up too, for a fact that was stated with a float.
  //
  const pairs: [Expression, Expression][] = [[aExact, bExact]];
  if (a !== aExact || b !== bExact) pairs.push([a, b]);
  for (const [x, y] of pairs)
    if (ce.ask(ce.expr(['Equal', x, y])).length > 0) return true;
  for (const [x, y] of pairs)
    if (ce.ask(ce.expr(['NotEqual', x, y])).length > 0) return false;

  // If a or b have some unknowns, we can't prove equality
  if (a.unknowns.length > 0 || b.unknowns.length > 0) return undefined;

  //
  // For strings and tensors, mathematical equality is same as structural
  // equality of their values
  //
  return same(a, b);
}

/**
 * The relation between `a` and `b`, or `undefined` when it is not known.
 *
 * Two values that differ by `tolerance` or less are `'='`. The default is
 * the engine tolerance, which the relational predicates (`isLess`,
 * `isGreater`…) use. An ordering that must separate two different numbers
 * however close they are (`Max`, `Sort`) passes `0`: see `exactOrder`.
 */
export function cmp(
  a: Expression,
  b: number | Expression,
  tolerance: number = a.engine.tolerance
): '<' | '=' | '>' | '>=' | '<=' | undefined {
  // A machine value's `isZeroWithTolerance(t)` tests `|x| < t`, which is
  // false for every `x` when `t` is 0. With no tolerance, only a zero is zero.
  const isZeroWithin = (x: NumericValue): boolean =>
    tolerance === 0 ? x.isZero : x.isZeroWithTolerance(tolerance);
  // Objects are UNORDERED — there is no `<` on references — so an object
  // operand answers `undefined` up front. This is a guard, not an
  // optimization: without it an object compared against a function expression
  // falls into the function branch below, which computes `a.sub(b)` and
  // `.N()`s the difference on an operand that has no numeric view at all.
  // (`docs/TYPE-SYSTEM.md`, "Equality":
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
        if (Math.abs(av - b) <= tolerance) return '=';
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
      if (isZeroWithin(av.sub(a.engine._numericValue(b)))) return '=';
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
          // We're comparing a (number) to b (symbol). The bound is compared
          // with `a` EXACTLY: read as doubles, a lower bound of `1 − 10⁻³⁰`
          // equalled `a = 1`, and `1 < b` was ordered from a bound that does
          // not entail it.
          // If b has a lower bound > a, then a < b
          if (bounds.lower !== undefined) {
            const order = exactCompareNumbers(bounds.lower, a);
            // b > lowerBound (if strict) or b >= lowerBound (if not strict)
            // If lowerBound > a, then b > a, so a < b
            if (order === 1) return '<';
            // If lowerBound = a and strict (b > a), then a < b
            if (order === 0 && bounds.lowerStrict) return '<';
            // If lowerBound = a and not strict (b >= a), then a <= b
            if (order === 0 && !bounds.lowerStrict) return '<=';
          }

          // If b has an upper bound < a, then a > b
          if (bounds.upper !== undefined) {
            const order = exactCompareNumbers(bounds.upper, a);
            // b < upperBound (if strict) or b <= upperBound (if not strict)
            // If upperBound < a, then b < a, so a > b
            if (order === -1) return '>';
            // If upperBound = a and strict (b < a), then a > b
            if (order === 0 && bounds.upperStrict) return '>';
            // If upperBound = a and not strict (b <= a), then a >= b
            if (order === 0 && !bounds.upperStrict) return '>=';
          }

          // Fall back to the symbol's known numeric value.
          // Only order if the symbol's value is provably real.
          const bSymNum = b.re;
          if (
            typeof bSymNum === 'number' &&
            Number.isFinite(bSymNum) &&
            b.im === 0
          ) {
            // With no tolerance, the machine value of the symbol is not
            // enough: `π.re` is the float `3.141592653589793`, which is
            // not `π`. See `orderByValue`.
            if (tolerance === 0) return orderByValue(a, b, tolerance);
            if (Math.abs(aNum - bSymNum) <= tolerance) return '=';
            return aNum < bSymNum ? '<' : '>';
          }
        }
        // A signed infinity is ordered against a finite value.
        if (aNum !== undefined && isSignedInfinity(aNum))
          return orderByValue(a, b, tolerance);
        return undefined;
      }
      // A function expression (`1 + π`): the branch below that orders a
      // function expression against a number answers, and its relation is
      // reversed here. Without this, `3 < 1 + π` had no answer while
      // `1 + π > 3` had one.
      if (isFunction(b)) {
        // Against a zero, `cmp(b, 0)` reads the sign of `b` first, as
        // `cmp(b, a)` with `b` a function expression does.
        const r = cmp(b, a.isSame(0) ? 0 : a, tolerance);
        if (r === '<') return '>';
        if (r === '>') return '<';
        if (r === '<=') return '>=';
        if (r === '>=') return '<=';
        return r;
      }
      return undefined;
    }

    const av = a.numericValue;
    const bv = b.numericValue as NumericValue;
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
      if (isZeroWithin(bv.sub(a.engine._numericValue(av)))) return '=';
      return gt ? '>' : '<';
    }
    if (av.isNaN) return undefined;
    if (av.eq(bv)) return '=';
    const lt = av.lt(bv);
    if (lt === undefined) return undefined;
    if (isZeroWithin(av.sub(bv))) return '=';
    return lt ? '<' : '>';
  }

  if (typeof b === 'number') {
    // Check if a is a symbol with inequality assumptions
    if (isSymbol(a)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);

      // We're comparing a (symbol) to b (number). The bound is compared
      // with `b` exactly, as in the number-to-symbol branch above.
      // If a has a lower bound >= b, then a > b (or a >= b)
      if (bounds.lower !== undefined) {
        const order = exactCompareNumbers(bounds.lower, b);
        // a > lowerBound (if strict) or a >= lowerBound (if not strict)
        // If lowerBound > b, then a > b
        if (order === 1) return '>';
        // If lowerBound = b and strict (a > b), then a > b
        if (order === 0 && bounds.lowerStrict) return '>';
        // If lowerBound = b and not strict (a >= b), then a >= b
        if (order === 0 && !bounds.lowerStrict) return '>=';
      }

      // If a has an upper bound <= b, then a < b (or a <= b)
      if (bounds.upper !== undefined) {
        const order = exactCompareNumbers(bounds.upper, b);
        // a < upperBound (if strict) or a <= upperBound (if not strict)
        // If upperBound < b, then a < b
        if (order === -1) return '<';
        // If upperBound = b and strict (a < b), then a < b
        if (order === 0 && bounds.upperStrict) return '<';
        // If upperBound = b and not strict (a <= b), then a <= b
        if (order === 0 && !bounds.upperStrict) return '<=';
      }

      // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE).
      // Only order if the symbol's value is provably real. With no
      // tolerance, or with a signed infinity, see `orderByValue`.
      const aNum = a.re;
      if (!Number.isNaN(aNum) && a.im === 0) {
        if (tolerance === 0 || !Number.isFinite(aNum) || !Number.isFinite(b))
          return orderByValue(a, a.engine.number(b), tolerance);
        if (Math.abs(aNum - b) <= tolerance) return '=';
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
      if (Number.isNaN(b)) return undefined;
      return orderByValue(a, a.engine.number(b), tolerance);
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

    return orderByValue(a, b, tolerance);
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
      // The bound is compared with `b` exactly, as in the number-to-symbol
      // branch above.
      // If symbol has a lower bound >= b, then symbol > b (or symbol >= b)
      if (bounds.lower !== undefined) {
        const order = exactCompareNumbers(bounds.lower, b);
        // symbol > lowerBound (if strict) or symbol >= lowerBound (if not strict)
        // If lowerBound > b, then symbol > b
        if (order === 1) return '>';
        // If lowerBound = b and strict (symbol > b), then symbol > b
        if (order === 0 && bounds.lowerStrict) return '>';
        // If lowerBound = b and not strict (symbol >= b), then symbol >= b
        if (order === 0 && !bounds.lowerStrict) return '>=';
      }

      // If symbol has an upper bound <= b, then symbol < b (or symbol <= b)
      if (bounds.upper !== undefined) {
        const order = exactCompareNumbers(bounds.upper, b);
        // symbol < upperBound (if strict) or symbol <= upperBound (if not strict)
        // If upperBound < b, then symbol < b
        if (order === -1) return '<';
        // If upperBound = b and strict (symbol < b), then symbol < b
        if (order === 0 && bounds.upperStrict) return '<';
        // If upperBound = b and not strict (symbol <= b), then symbol <= b
        if (order === 0 && !bounds.upperStrict) return '<=';
      }
    }

    // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE).
    // Only order if both sides are provably real. With no tolerance, or
    // with a signed infinity, see `orderByValue`.
    const aNum = a.re;
    if (!Number.isNaN(aNum) && a.im === 0) {
      const bx = typeof b === 'number' ? a.engine.number(b) : b;
      const bNum = bx.re;
      if (!Number.isNaN(bNum) && bx.im === 0) {
        if (tolerance === 0 || !Number.isFinite(aNum) || !Number.isFinite(bNum))
          return orderByValue(a, bx, tolerance);
        if (Math.abs(aNum - bNum) <= tolerance) return '=';
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
  // (`docs/STRING_ROADMAP.md`, decision D8).
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

/**
 * The order of `a` and `b` for an operator that orders values (`Max`,
 * `Min`, `Clamp`, `Sort`, `ArgMax`…): `-1`, `0` or `1`, or `undefined` when
 * the order is not known (a free symbol, a complex value).
 *
 * The order is EXACT: two different numbers are never a tie, however close
 * they are, so `Max(1e-12, 2e-12)` is `2e-12`. The relational predicates
 * (`isLess`, `isEqual`) apply the engine tolerance, and with it `1e-12` and
 * `2e-12` compare as equal. A compiled `Math.max` compares exactly too.
 *
 * Two real number literals compare by their values (`exactCompareNumbers`),
 * also when a float64 cannot hold them (`10^-400`). Other operands (`π`,
 * `√2 + 1`) compare by `cmp` with a zero tolerance, at working precision.
 * A weak relation (`'<='` or `'>='`, from an assumption) does not order
 * the operands and gives `undefined`.
 *
 * When the working precision does not decide the order of two constants
 * (the computed difference is not larger than the bound on its error),
 * these steps are tried, in this order:
 *
 * 1. The same comparison at a higher precision (`raisedPrecision`): two
 *    DIFFERENT constants that are closer than the rounding error of the
 *    working precision (`√(2 + 10⁻³⁰)` and `√2` at 21 digits) are ordered
 *    at 50 digits. The result is exact, as at the working precision: the
 *    order is known only when the difference is larger than its error
 *    bound. This is also done at machine precision.
 * 2. A symbolic proof that the two constants are EQUAL: `a − b` simplifies
 *    to the literal `0` (or `b − a` does). Two equal constants (`ln 6` and `ln 2 + ln 3`,
 *    `sin²1 + cos²1` and `1`) have a difference of exactly zero, and no
 *    precision can separate them: without this step, they are never
 *    ordered. The probabilistic verdict of `isIdenticallyEqual()` is not
 *    used: for two constants its sampling is a numeric evaluation, which
 *    step 3 already does.
 *
 *    Steps 1 and 2 are both exact, so they cannot disagree: a pair that the
 *    raised precision orders is not equal, and a proved-equal pair is never
 *    ordered by an error bound. Their order changes only the cost, with one
 *    exception: an error thrown by a host value function at the raised
 *    precision now reaches the caller also for a pair that the proof would
 *    have decided (a host constant that fails at a higher precision). The
 *    raised comparison runs first because it is much cheaper than a
 *    simplification and decides the common case, two constants that are
 *    close but different: a `Sort` of 200 such logarithms spent 65% of its
 *    time in failed proofs when the proof came first (measured
 *    2026-09-24). Two equal constants pay for both steps.
 * 3. Only when `options.tieWithinTolerance` is set: a TOLERANCE TIE. The
 *    two constants are a tie (`0`) when their values at the working
 *    precision differ by no more than the engine tolerance relative to
 *    `max(|a|, |b|, 1)`. This was the order of `Max`, `Min` and `Sort`
 *    before their order became exact. It is the last step because it can
 *    be wrong: two different constants within the tolerance of each other
 *    are a tie. It never orders two constants: it gives `0` or
 *    `undefined`, never `-1` or `1`. The callers that choose an extremum
 *    or sort a list set it (`Max`, `Min`, `Clamp`, `Sort`), because an
 *    answer that is one of two nearly equal values is better for them than
 *    no answer. A caller that reads a sign from the order (`Abs`, the
 *    argument of a complex number) does not set it: a tie with zero would
 *    make a negative value non-negative.
 *
 * Steps 1 and 2 are not run again inside themselves, for the same engine
 * (`resolvingTie`): the evaluations of step 1 and the simplification of
 * step 2 can evaluate an operator that calls `exactOrder` (`Abs`, `Max`),
 * and a nested run would simplify inside a simplification, which can
 * recurse without end. No simplification rule calls `exactOrder` directly;
 * it is reached from the evaluate handlers of the operators above, which a
 * simplification can call, and the guard bounds that case to one nested
 * simplification.
 */
export function exactOrder(
  a: Expression,
  b: Expression,
  options?: { tieWithinTolerance?: boolean }
): -1 | 0 | 1 | undefined {
  const order = orderAtWorkingPrecision(a, b);
  if (order !== undefined) return order;
  const ce = a.engine;
  if (resolvingTie.has(ce) || !isRealConstantPair(a, b)) return undefined;
  resolvingTie.add(ce);
  try {
    const raised = orderAtRaisedPrecision(a, b);
    if (raised !== undefined) return raised;
    if (isProvedEqual(a, b)) return 0;
    if (options?.tieWithinTolerance === true && isWithinTolerance(a, b))
      return 0;
    return undefined;
  } finally {
    resolvingTie.delete(ce);
  }
}

/** The engines for which `exactOrder` is running its steps for an
 *  undecided order (a symbolic proof, a higher precision). See
 *  `exactOrder`. One set for all the engines, so that a comparison in one
 *  engine does not skip the steps of a comparison in another engine. */
const resolvingTie = new WeakSet<Expression['engine']>();

/**
 * The precision of the raised comparison of `exactOrder` (step 1): twice the
 * working precision, at least 50 digits and at most 100 digits. At 21
 * digits (the default), the attempt is at 50 digits: `cos(10⁻²⁰) − 1`, which
 * is `−5·10⁻⁴¹`, needs about 44 digits. A precision of 100 digits or more is
 * not raised.
 */
function raisedPrecision(digits: number): number {
  return Math.min(100, Math.max(2 * digits, 50));
}

/** The order of `a` and `b` at the working precision: see `exactOrder`,
 *  which adds the steps for an order that this one does not decide. */
function orderAtWorkingPrecision(
  a: Expression,
  b: Expression
): -1 | 0 | 1 | undefined {
  const order = exactCompareNumbers(a, b);
  if (order !== undefined) return order;
  // Some branches of `cmp` decide only one operand order (a number against
  // a symbol with assumed bounds), so both directions are probed.
  const c = cmp(a, b, 0);
  if (c === '<') return -1;
  if (c === '>') return 1;
  if (c === '=') return 0;
  const r = cmp(b, a, 0);
  if (r === '<') return 1;
  if (r === '>') return -1;
  if (r === '=') return 0;
  return undefined;
}

/**
 * True when `a` and `b` are both constants (no unknowns) that can be real
 * numbers: the steps of `exactOrder` for an undecided order apply only to
 * them. A collection, a NaN and a value whose type is complex and not real
 * are excluded.
 */
function isRealConstantPair(a: Expression, b: Expression): boolean {
  for (const x of [a, b]) {
    if (x.unknowns.length > 0) return false;
    if (x.isCollection === true || x.isNaN === true) return false;
    if (!x.type.matches('number') || isNonRealComplex(x)) return false;
  }
  return true;
}

/**
 * True when `a − b` simplifies to the literal `0`: a proof that the
 * constants `a` and `b` are equal. The difference is built with
 * `ce.function`, not `a.sub(b)`, which can fold two exact radicals into
 * a float (see `orderByValue`).
 */
function isProvedEqual(a: Expression, b: Expression): boolean {
  // Both differences are tried: `simplify()` is not symmetric, it reduces
  // `(sin²1 + cos²1) − 1` and `ln 8 − 3 ln 2` to 0 but not `1 − sin²1 − cos²1`
  // or `3 ln 2 − ln 8`, and the answer must not depend on the order of the
  // operands.
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const difference = a.engine.function('Subtract', [x, y]);
    if (difference.isSame(0)) return true;
    const simplified = difference.simplify();
    if (isNumber(simplified) && simplified.isSame(0)) return true;
  }
  return false;
}

/**
 * The order of the real constants `a` and `b` with the precision raised to
 * `raisedPrecision`, or `undefined` when it is not decided or when the
 * precision cannot be raised.
 *
 * The comparison at the raised precision is the part of `orderByValue`
 * (with no tolerance) that depends on the precision: the approximation of
 * each operand, then the approximation of their difference. The other
 * steps of `orderAtWorkingPrecision` do not depend on the precision, and
 * they did not decide the order.
 *
 * The precision is raised with `_withTransientPrecision`, which sets the
 * precision of the engine and of the big decimals and restores both on
 * every exit, also when a host function throws. The precision of the
 * engine must be raised too, not only the precision of the big decimals:
 * the evaluation of `sin`, `cos` and `tan` rounds a value smaller than its
 * rounding error at the precision of the engine to 0 (`chopBignumDust`),
 * and at the working precision that error is larger than the error bound at
 * the raised precision. It does not use the `precision` setter of the
 * engine: the setter resets the engine (every cached value is discarded and
 * the cache axes advance), and here it would do so twice for each
 * comparison. Without a reset, the cached values keep the working
 * precision, so the approximations do not read them: the value of a
 * constant (`π`, `e`, `γ`) is computed again from its definition at the
 * raised precision (`constantApproximation`), and the approximations are
 * kept apart from the ones at the working precision (see
 * `approximations`). The tolerance of the engine does not change.
 *
 * This is also done at machine precision. A number literal made at
 * machine precision gets its value at the raised precision: the factory
 * of its float value (`ExactNumericValue.factory`, which is
 * `ce._inexactNumericValue`) reads the precision of the engine when it is
 * called. When the factory was chosen at the precision of the literal's
 * creation, the value of such a literal was a double at any later
 * precision, with the error of a double and not the error that the bound
 * assumes, and at 50 digits the order of `√(2 + 10⁻³⁰)` against `√2` was
 * `−1`.
 *
 * This step is also done while a computation holds scratch declaration
 * scopes (`_scratchDeclarationScopes`). It was skipped there when it used
 * the `precision` setter, because the reset clears that list; without a
 * reset, the list does not change.
 */
function orderAtRaisedPrecision(
  a: Expression,
  b: Expression
): -1 | 0 | 1 | undefined {
  const ce = a.engine;
  const precision = ce.precision;
  const raised = raisedPrecision(Math.min(precision, BigDecimal.precision));
  if (raised <= precision) return undefined;
  const atRaisedPrecision = <T>(fn: () => T): T =>
    ce._withTransientPrecision(raised, () => {
      atTransientPrecision.add(ce);
      try {
        return fn();
      } finally {
        atTransientPrecision.delete(ce);
      }
    });
  // The approximation of each operand.
  let order = atRaisedPrecision(() => orderOfApproximations(a, b));
  // The approximation of the difference `a − b`, which can be decided when
  // the operands are not: the terms that `a` and `b` have in common cancel
  // in the difference. Two complex values have no order, even when their
  // difference is real: their values are read at the working precision,
  // where the values of the constants are the ones that the engine keeps.
  if (order === undefined && isRealValue(a) && isRealValue(b))
    order = atRaisedPrecision(() => {
      const diff = a.sub(b);
      if (diff.unknowns.length > 0) return undefined;
      // A difference that `a.sub(b)` rounded to a float is not used (see
      // `orderByValue`).
      if (
        containsInexactLiteral(diff) &&
        !containsInexactLiteral(a) &&
        !containsInexactLiteral(b)
      )
        return undefined;
      return signOfApproximation(diff);
    });
  if (order === '<') return -1;
  if (order === '>') return 1;
  return undefined;
}

/**
 * The engines that compute at a precision set by `_withTransientPrecision`
 * (see `orderAtRaisedPrecision`). For them, `approximate` computes the
 * value of a constant from its definition, not from the value that the
 * engine keeps at its working precision.
 */
const atTransientPrecision = new WeakSet<Expression['engine']>();

/** True when the value of `x` is a finite real number. */
function isRealValue(x: Expression): boolean {
  const v = x.N();
  return isNumber(v) && v.im === 0 && v.isFinite === true;
}

/**
 * True when the values of `a` and `b` at the working precision are real and
 * differ by no more than the engine tolerance relative to
 * `max(|a|, |b|, 1)`: the tolerance tie of `exactOrder` (step 3). The
 * values are compared as big decimals, so a value outside the range of a
 * double (`10^400`) is compared too.
 */
function isWithinTolerance(a: Expression, b: Expression): boolean {
  const x = a.N();
  const y = b.N();
  if (!isNumber(x) || !isNumber(y) || x.im !== 0 || y.im !== 0) return false;
  const u = bigDecimalOf(x);
  const v = bigDecimalOf(y);
  if (!u.isFinite() || !v.isFinite()) return false;
  let scale = u.abs();
  if (v.abs().gt(scale)) scale = v.abs();
  if (scale.lt(1)) scale = BigDecimal.ONE;
  return u
    .sub(v)
    .abs()
    .lte(scale.mul(new BigDecimal(a.engine.tolerance)));
}

/**
 * The machine value of `x` when it is a correctly rounded double: a real
 * number literal, the constants `π` and `e`, or a symbol whose value is a
 * real number literal. `undefined` otherwise, and for a value that is not a
 * finite real number.
 */
function correctlyRoundedMachineValue(x: Expression): number | undefined {
  let y: Expression | undefined = x;
  if (isSymbol(x)) {
    if (x.symbol === 'Pi') return Math.PI;
    if (x.symbol === 'ExponentialE') return Math.E;
    y = x.value;
  }
  if (y === undefined || !isNumber(y) || y.im !== 0) return undefined;
  const v = y.re;
  return Number.isFinite(v) ? v : undefined;
}

/**
 * The special functions whose machine value `orderOfMachineSpecialValues`
 * reads. Their machine kernels were measured against mpmath: the relative
 * error was at most `1.4·10⁻¹³` (erfc near 2, where `1 − erf(x)` cancels;
 * erfc(x) ≥ erfc(2) > 4·10⁻³ there, so the cancellation costs at most
 * `3·10⁻¹³`), except for Γ at a negative argument near a pole, which is
 * excluded.
 */
const MACHINE_SPECIAL_FUNCTIONS = new Set([
  'Gamma',
  'Erf',
  'Erfc',
  'Erfi',
  'Zeta',
]);

/** A bound on the relative error of a machine kernel of
 *  `MACHINE_SPECIAL_FUNCTIONS`: more than 30 times the largest error that
 *  was measured. */
const MACHINE_KERNEL_ERROR = 1e-11;

/**
 * The order of `a` and `b` at machine precision, from their machine values,
 * when each one is a correctly rounded value (`correctlyRoundedMachineValue`)
 * or a function of `MACHINE_SPECIAL_FUNCTIONS` applied to one. `undefined`
 * when the values are not far apart, or when the other operands are not of
 * that form.
 *
 * At machine precision, `approximate` has no bound for these functions (see
 * `propagatedError`), so without this their order was never known. The error
 * of the machine value of `f(c)` is at most `w·F + K·|f(c)|`, where `w` is
 * the rounding of `c` to a double (at most `10⁻¹⁵·|c|`), `F` is the bound on
 * `|f′|` near `c` (`logDerivativeBound`) and `K` is `MACHINE_KERNEL_ERROR`.
 * The order is known when the two values differ by more than `10⁻⁶` of the
 * larger one and each error is less than `10⁻⁹` of it: then the difference
 * is much larger than the sum of the errors. An argument where `f` is badly
 * conditioned (Γ near a pole, ζ near 1) has a large `F`, and the order is
 * not known.
 *
 * Only at machine precision: at a higher precision, `approximate` gives a
 * bound for these functions, and its values are kept for each expression,
 * where these machine values would be computed again at each comparison.
 */
function orderOfMachineSpecialValues(
  a: Expression,
  b: Expression
): '<' | '>' | undefined {
  if (a.engine.precision > MACHINE_PRECISION) return undefined;
  const x = machineSpecialValue(a);
  if (x === undefined) return undefined;
  const y = machineSpecialValue(b);
  if (y === undefined) return undefined;
  const scale = Math.max(Math.abs(x.value), Math.abs(y.value));
  const difference = x.value - y.value;
  const logLimit = Math.log(1e-9 * scale);
  if (
    !(Math.abs(difference) > 1e-6 * scale) ||
    !(x.logError < logLimit) ||
    !(y.logError < logLimit)
  )
    return undefined;
  return difference < 0 ? '<' : '>';
}

/** The machine value of `x`, and `ln` of a bound on its absolute error, for
 *  `orderOfMachineSpecialValues`. */
function machineSpecialValue(
  x: Expression
): { value: number; logError: number } | undefined {
  const leaf = correctlyRoundedMachineValue(x);
  if (leaf !== undefined)
    return {
      value: leaf,
      // A correctly rounded value is within 2⁻⁵³ of the exact value
      logError: Math.log(Math.abs(leaf)) - 53 * Math.LN2,
    };
  if (
    !isFunction(x) ||
    x.nops !== 1 ||
    !MACHINE_SPECIAL_FUNCTIONS.has(x.operator)
  )
    return undefined;
  const c = correctlyRoundedMachineValue(x.op1);
  if (c === undefined) return undefined;
  // The reflection formula of the machine Γ loses digits near a pole.
  if (x.operator === 'Gamma' && !(c > 0)) return undefined;
  const v = x.N();
  if (!isNumber(v) || v.im !== 0) return undefined;
  const value = v.re;
  if (!Number.isFinite(value) || value === 0) return undefined;
  const logValue =
    Math.log(Math.abs(value)) + Math.log1p(2 * MACHINE_KERNEL_ERROR);
  const w = Math.abs(c) * 1e-15 + Number.MIN_VALUE;
  const derivative = logDerivativeBound(x.operator, c - w, c + w, logValue);
  if (derivative === undefined) return undefined;
  return {
    value,
    logError: logAdd(
      Math.log(w) + derivative,
      logValue + Math.log(MACHINE_KERNEL_ERROR)
    ),
  };
}

/**
 * The order of two numeric operands `a` and `b`, at least one of which is
 * not a number literal (`π`, `1 + π`, a symbol with a value), read from
 * their values. `undefined` when the order is not known.
 *
 * - A difference `a − b` with unknowns (`1 + y` and `x − 1`) has no value,
 *   and the order is not known. The test is made before any `.N()`: over
 *   nested user-function applications the walk of `.N()` is exponential in
 *   the nesting depth (see `constructibleValues`).
 * - Complex numbers have no order: both values must be real. The values
 *   are read, not the types, because a type such as `number` includes the
 *   complex numbers: with `z: number := 1 + i`, `z + π < z + 4` has no
 *   answer, although `(z + π) − (z + 4)` is real. Two equal complex values
 *   are `'='`. An operand without a value (`x` in `x < x + 1`) is refused
 *   only when its type is complex and not real.
 * - A signed infinity is ordered against a finite value.
 * - With a tolerance, two values within the tolerance are `'='`.
 * - With no tolerance (`exactOrder`), the order is exact. An exact
 *   difference has an exact sign. Otherwise the difference is computed at
 *   the working precision together with a bound on its error
 *   (`approximate`), and the order is known only when the computed
 *   difference is larger than that bound. The error can be much larger
 *   than the difference: `c = π − 314159265358979323846264338327950289/10^35`
 *   is `−5.8·10⁻³⁶`, and at 21 digits it computes as `+2.6·10⁻²¹`. Then
 *   `exactOrder(c, 0)` is `undefined` at 21 digits and `−1` at 60 digits.
 *   A computed difference of zero is never `'='`: it can be a rounding of a
 *   value that is not zero (`sin(r)` for a rational `r` near π). The
 *   machine value of the operands is not used for the order: `π.re` is
 *   `3.141592653589793`, so `π` and that float were a tie.
 */
function orderByValue(
  a: Expression,
  b: Expression,
  tolerance: number
): '<' | '=' | '>' | undefined {
  // Fast order: when the machine value of each operand is correctly rounded
  // and the two are far apart, the machine order is the exact order. This
  // holds for a real number literal, `π`, `e`, and a symbol whose value is a
  // number literal. It does NOT hold for a function expression: near a root
  // its machine value can have the wrong sign, so it takes the bound below.
  // The exception, at machine precision only, is a special function of such
  // a value, with a bound on its error: see `orderOfMachineSpecialValues`.
  if (tolerance === 0) {
    const am = correctlyRoundedMachineValue(a);
    const bm = correctlyRoundedMachineValue(b);
    if (
      am !== undefined &&
      bm !== undefined &&
      Math.abs(am - bm) > 1e-12 * Math.max(Math.abs(am), Math.abs(bm), 1e-300)
    )
      return am < bm ? '<' : '>';
    const special = orderOfMachineSpecialValues(a, b);
    if (special !== undefined) return special;
  }

  // With no tolerance, two operands without unknowns are ordered by the
  // approximation of each one. This comes before `a.sub(b)`, which can
  // round (see `orderOfApproximations`) and which costs more than the
  // approximations that `Sort` keeps for each element.
  if (tolerance === 0 && a.unknowns.length === 0 && b.unknowns.length === 0) {
    const order = orderOfApproximations(a, b);
    if (order !== undefined) return order;
  }

  // When exactly one operand has unknowns (symbols with no value), so does
  // `a − b`, and the order is undecided: answer before building it. The
  // subtraction boxes a new expression, and boxing can infer the type of a
  // symbol it holds; a sign computation reaches this function from a type
  // handler (`lnSign()` in `library/arithmetic.ts`), where that inference
  // is a state change that the type-handler purity guard
  // (`CE_TYPE_PURITY_GUARD`, `guardedTypeHandlerCall()` in
  // `operand-descriptor.ts`, always on under test) reports. Only when both
  // operands have unknowns can they cancel, as in `(x + 1) − x`. The guard
  // needs canonical operands: `.unknowns` lists the symbols written in the
  // expression without simplifying it, so a structural `Multiply(0, x)` lists
  // `x` although its value is 0; canonical form folds such a product.
  if (
    a.isCanonical &&
    b.isCanonical &&
    a.unknowns.length > 0 !== b.unknowns.length > 0
  )
    return undefined;

  const diff0 = a.sub(b);
  if (diff0.unknowns.length > 0) return undefined;
  // `a.sub(b)` folds two exact radicals into one float: `√(2 + 10⁻³⁰) − √2`
  // is `−1.7·10⁻²¹` at 21 digits, with the wrong sign. The error of that
  // float is not the error of its rounding, so its sign is not used.
  const roundedDifference =
    containsInexactLiteral(diff0) &&
    !containsInexactLiteral(a) &&
    !containsInexactLiteral(b);

  // An exact difference has an exact sign (`(x + 1) − (x + 2)` is `−1`).
  if (tolerance === 0 && isNumber(diff0) && diff0.isExact && diff0.im === 0) {
    if (diff0.isSame(0)) return '=';
    if (diff0.isNegative === true) return '<';
    if (diff0.isPositive === true) return '>';
    return undefined;
  }

  // An operand without a value: the order comes from the difference only.
  if (a.unknowns.length > 0 || b.unknowns.length > 0) {
    if (isNonRealComplex(a) || isNonRealComplex(b)) return undefined;
    if (tolerance === 0)
      return roundedDifference ? undefined : signOfApproximation(diff0);
    return orderFromDifference(diff0.N(), tolerance);
  }

  const aN = a.N();
  const bN = b.N();
  if (!isNumber(aN) || !isNumber(bN)) return undefined;
  if (aN.isNaN === true || bN.isNaN === true) return undefined;
  if (aN.im !== 0 || bN.im !== 0) {
    // With no tolerance, a computed zero can be the rounding of a value that
    // is not zero, so only an EXACT zero difference is a tie.
    if (tolerance === 0)
      return isNumber(diff0) && diff0.isExact && diff0.isSame(0)
        ? '='
        : undefined;
    const diff = diff0.N();
    if (!isNumber(diff)) return undefined;
    const d = diff.numericValue;
    if (typeof d === 'number') return d === 0 ? '=' : undefined;
    if (d.isNaN) return undefined;
    return d.isZeroWithTolerance(tolerance) ? '=' : undefined;
  }

  const aInfinite = aN.isFinite === false;
  const bInfinite = bN.isFinite === false;
  if (aInfinite || bInfinite) {
    const sa = aInfinite ? Math.sign(aN.re) : 0;
    const sb = bInfinite ? Math.sign(bN.re) : 0;
    if (sa === sb) return '=';
    return sa < sb ? '<' : '>';
  }

  if (tolerance > 0) return orderFromDifference(diff0.N(), tolerance);
  return roundedDifference ? undefined : signOfApproximation(diff0);
}

/** True when a number literal of `x`, at any depth, is not exact (a
 *  float). The value of a symbol is not read. */
function containsInexactLiteral(x: Expression): boolean {
  if (isNumber(x)) return !x.isExact;
  if (isFunction(x)) return x.ops.some((op) => containsInexactLiteral(op));
  return false;
}

/**
 * The order given by the sign of the difference `diff`, or `undefined`
 * when `diff` is not a real number. A difference within the tolerance is
 * `'='`.
 */
function orderFromDifference(
  diff: Expression,
  tolerance: number
): '<' | '=' | '>' | undefined {
  if (!isNumber(diff)) return undefined;
  const v = diff.numericValue;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return undefined;
    if (tolerance === 0 ? v === 0 : Math.abs(v) <= tolerance) return '=';
    return v < 0 ? '<' : '>';
  }
  if (v.isNaN || v.im !== 0) return undefined;
  if (tolerance === 0 ? v.isZero : v.isZeroWithTolerance(tolerance)) return '=';
  return v.lt(0) ? '<' : '>';
}

/**
 * The sign of the constant `diff`, as an order: `'<'` when it is negative,
 * `'>'` when it is positive. `undefined` when the value computed at the
 * working precision is not larger than the bound on its error
 * (`approximate`), or when no bound is known. Never `'='`: a computed
 * zero is not an exact zero.
 */
function signOfApproximation(diff: Expression): '<' | '>' | undefined {
  const approximation = approximate(diff, roundingUnit(diff.engine));
  if (approximation === undefined || approximation.sign === 0) return undefined;
  if (!(approximation.logMagnitude > approximation.logError + LOG_SLACK))
    return undefined;
  return approximation.sign < 0 ? '<' : '>';
}

/**
 * The order of the real constants `a` and `b`, from the approximation of
 * each one (`approximate`): the difference of the two computed values,
 * with a bound on its error that is the sum of the two bounds and of the
 * rounding of the difference. `undefined` when the difference is not larger
 * than that bound, or when there is no bound for one of the operands.
 *
 * Each operand is approximated alone, not their difference: the difference
 * of two operands built with `a.sub(b)` can fold two exact radicals into
 * one float (`√(2 + 10⁻³⁰) − √2` became `−1.7·10⁻²¹` at 21 digits, with
 * the wrong sign), and a float has only the error of its own rounding.
 * The approximation of an operand is kept (see `approximate`), so `Sort`
 * approximates each element once, not once for each comparison.
 */
function orderOfApproximations(
  a: Expression,
  b: Expression
): '<' | '>' | undefined {
  const unit = roundingUnit(a.engine);
  const x = approximate(a, unit);
  if (x === undefined) return undefined;
  const y = approximate(b, unit);
  if (y === undefined) return undefined;
  const d = bigDecimalOf(x.value).sub(bigDecimalOf(y.value));
  if (!d.isFinite() || d.isZero()) return undefined;
  const logError = logAdd(
    logAdd(x.logError, y.logError),
    Math.log(unit) + logAdd(x.logMagnitude, y.logMagnitude)
  );
  if (!(logAbs(d) > logError + LOG_SLACK)) return undefined;
  return d.isNegative() ? '<' : '>';
}

/**
 * The relative error allowed for one rounding at the working precision:
 * `10^(2 − digits)`, that is 100 units in the last digit. The number of
 * digits is the lower of the engine precision and the precision of the
 * big decimals: the second one is global to the module, and another
 * engine can change it (see `BigDecimal.precision`).
 */
function roundingUnit(engine: Expression['engine']): number {
  const digits = Math.min(engine.precision, BigDecimal.precision);
  return 10 ** (2 - Math.max(digits, MACHINE_PRECISION));
}

/**
 * A margin for the comparison of a logarithm of a value with the logarithm
 * of its error bound. The bounds are computed with the logarithms of
 * values (see `Approximation`), in machine arithmetic, and the relative
 * error of that arithmetic is about `10⁻¹⁶·|logarithm|`. A margin of
 * `10⁻⁶` is much larger than that, and changes the bound by a factor of
 * only `1.000001`.
 */
const LOG_SLACK = 1e-6;

/**
 * A real value computed at the working precision, and a bound on the
 * absolute difference between it and the exact value.
 *
 * The magnitude and the error are kept as natural logarithms, so that a
 * value outside the range of a double (`π·10^400`, `e^800`) has a bound
 * too: as doubles, they were `Infinity`, and there was no bound.
 */
type Approximation = {
  /** The computed value, a real number literal */
  value: Expression;
  sign: -1 | 0 | 1;
  /** `ln |value|`, `-Infinity` when the value is 0 */
  logMagnitude: number;
  /** `ln` of the error bound, `-Infinity` when the value is exact */
  logError: number;
};

/** `ln(eˣ + eʸ)`, without overflow. */
function logAdd(x: number, y: number): number {
  if (x === -Infinity) return y;
  if (y === -Infinity) return x;
  const m = Math.max(x, y);
  return m + Math.log1p(Math.exp(Math.min(x, y) - m));
}

/** `ln(eˣ − eʸ)`, or `undefined` when `eˣ − eʸ` is not positive. */
function logSub(x: number, y: number): number | undefined {
  if (!(x > y)) return undefined;
  if (y === -Infinity) return x;
  return x + Math.log1p(-Math.exp(y - x));
}

/** `ln |d|` for a finite big decimal `d`. `-Infinity` when `d` is 0. */
function logAbs(d: BigDecimal): number {
  const s = d.significand < 0n ? -d.significand : d.significand;
  if (s === 0n) return -Infinity;
  const digits = s.toString();
  // The leading 17 digits give `ln` to the precision of a double.
  const k = Math.min(digits.length, 17);
  return (
    Math.log(Number(digits.slice(0, k))) +
    (digits.length - k + d.exponent) * Math.LN10
  );
}

/** The real part of the number literal `v`, as a big decimal. */
function bigDecimalOf(v: Expression): BigDecimal {
  if (!isNumber(v)) return BigDecimal.NAN;
  const nv = v.numericValue;
  if (typeof nv === 'number') return new BigDecimal(nv);
  return nv.bignumRe ?? new BigDecimal(nv.re);
}

/** The sign and `ln` of the magnitude of `v`, when it is a finite real
 *  number literal. Read on the big decimal value when there is one: its
 *  double value can be `Infinity` (`10^400`) or `0` (`10^-400`). */
function realParts(
  v: Expression
): { sign: -1 | 0 | 1; logMagnitude: number } | undefined {
  if (!isNumber(v) || v.im !== 0) return undefined;
  const nv = v.numericValue;
  if (typeof nv === 'number') {
    if (!Number.isFinite(nv)) return undefined;
    return {
      sign: nv < 0 ? -1 : nv > 0 ? 1 : 0,
      logMagnitude: Math.log(Math.abs(nv)),
    };
  }
  if (nv.isNaN) return undefined;
  const big = nv.bignumRe;
  if (big === undefined) {
    const re = nv.re;
    if (!Number.isFinite(re)) return undefined;
    return {
      sign: re < 0 ? -1 : re > 0 ? 1 : 0,
      logMagnitude: Math.log(Math.abs(re)),
    };
  }
  if (!big.isFinite()) return undefined;
  return {
    sign: big.isNegative() ? -1 : big.isZero() ? 0 : 1,
    logMagnitude: logAbs(big),
  };
}

/**
 * The approximations already computed, by expression. An approximation
 * depends only on the expression, the precision (of the engine and of the
 * big decimals) and the angular unit, when every symbol in the expression
 * is a constant. Only those approximations are kept: the value of a symbol
 * that is not a constant can change. Boxed expressions are not modified,
 * so the expression is a valid key, and the map does not keep it alive.
 *
 * Each expression keeps the approximations of its last two keys: the
 * working precision and the raised precision of `exactOrder`, which
 * alternate when `Sort` orders values that are closer than the rounding
 * error of the working precision (see `orderAtRaisedPrecision`). With one
 * approximation for each expression, each one would replace the other.
 */
const approximations = new WeakMap<
  Expression,
  { key: string; approximation: Approximation | undefined }[]
>();

/**
 * The value of the real constant `x` at the working precision, with a
 * bound on its absolute error. `undefined` when `x` is not a real
 * constant, or when no bound is known.
 *
 * The error model. The value is computed bottom-up, one node at a time:
 * each node is computed from the values of its operands, so every node is
 * computed once. The error of a node is the sum of:
 *
 * - the error of its operands, propagated with a bound on the derivative
 *   of the operator over the whole interval `[value − error, value + error]`
 *   of each operand (by the mean value theorem). For example, `ln u` has
 *   the error `e/(|u| − e)`, and `sin u` the error `e`. When the interval
 *   contains a point where that bound does not exist (`ln` or `1/u` of an
 *   interval that contains 0, `tan` of an interval that contains a pole),
 *   there is no bound.
 * - the rounding of the node: `|value|·unit`, and for a sum
 *   `unit·Σ|term|`, since a sum is rounded relative to its terms. A
 *   trigonometric function also reduces its argument by a multiple of π,
 *   which costs `|argument|·unit`.
 *
 * A leaf is a number literal or a constant symbol: its error is
 * `|value|·unit`, except for an integer smaller than `10^(digits − 4)`,
 * which is exact. So a literal with more digits than the precision (a
 * 37-digit rational) has the error of its rounding. A symbol with an
 * assigned value is replaced by that value.
 *
 * The magnitudes and the errors are logarithms (see `Approximation`), so a
 * value larger than a double (`e^800`) or smaller (`10^-400`) has a bound.
 *
 * Limit: the model assumes that each operator in the list below computes
 * its value to within `unit` of the exact value of its (rounded) operands,
 * which is true for the big decimal functions of this library. An operator
 * that is not in the list has no known derivative bound, so there is no
 * bound for an expression that contains it, and its order is not known.
 * The list is: `Add`, `Subtract`, `Negate`, `Multiply`, `Divide`, `Square`,
 * `Sqrt`, `Root`, `Power`, `Exp`, `Ln`, `Log`, `Lb`, `Lg`, `Abs`, `Sin`,
 * `Cos`, `Tan`, `Cot`, `Sec`, `Csc`, `Arctan`, `Arcsin`, `Arccos`, `Sinh`,
 * `Cosh`, `Tanh`, `Arsinh`, `Arcosh`, `Artanh`, and, only above machine
 * precision, `Gamma`, `Erf`, `Erfc`, `Erfi`, `Zeta` (see `propagatedError`).
 */
function approximate(x: Expression, unit: number): Approximation | undefined {
  return approximateNode(x, unit).approximation;
}

/** The approximation of `x` (see `approximate`), and whether it depends
 *  only on `x` and the precision (`pure`: every symbol is a constant). The
 *  pure approximations are kept in `approximations`. */
function approximateNode(
  x: Expression,
  unit: number
): { approximation: Approximation | undefined; pure: boolean } {
  const ce = x.engine;
  const key = `${ce.precision}:${BigDecimal.precision}:${ce.angularUnit}`;
  const known = approximations.get(x);
  const entry = known?.find((k) => k.key === key);
  if (entry !== undefined)
    return { approximation: entry.approximation, pure: true };
  const result = computeApproximation(x, unit);
  if (result.pure) {
    const kept = { key, approximation: result.approximation };
    // The newest entry is last: the oldest one is dropped.
    approximations.set(
      x,
      known === undefined ? [kept] : [known[known.length - 1], kept]
    );
  }
  return result;
}

function computeApproximation(
  x: Expression,
  unit: number
): { approximation: Approximation | undefined; pure: boolean } {
  const ce = x.engine;
  const logUnit = Math.log(unit);

  const leaf = (y: Expression, exact: boolean): Approximation | undefined => {
    const v = y.N();
    const parts = realParts(v);
    if (parts === undefined) return undefined;
    return {
      value: v,
      ...parts,
      logError: exact ? -Infinity : parts.logMagnitude + logUnit,
    };
  };

  if (isNumber(x)) {
    // An integer literal smaller than 10^(digits − 4) is converted exactly.
    const exact = x.isInteger === true && Math.abs(x.re) < 0.01 / unit;
    return { approximation: leaf(x, exact), pure: true };
  }

  if (isSymbol(x)) {
    const transient = atTransientPrecision.has(ce);
    if (x.isConstant)
      return {
        approximation: transient
          ? constantApproximation(x, unit, leaf)
          : leaf(x, false),
        pure: true,
      };
    const value = x.value;
    if (value !== undefined && isFunction(value))
      return { approximation: approximate(value, unit), pure: false };
    // A value that is a constant symbol is approximated like the constant:
    // the value of a constant that is an expression (the golden ratio)
    // gets the error bound of its expression, not the bound of a leaf.
    if (transient && value !== undefined && isSymbol(value) && value.isConstant)
      return { approximation: approximate(value, unit), pure: false };
    return { approximation: leaf(x, false), pure: false };
  }

  if (!isFunction(x)) return { approximation: undefined, pure: true };

  // When an operand has no approximation, neither has `x`, whatever the
  // other operands are, so the walk stops there.
  let pure = true;
  const args: Approximation[] = [];
  for (const operand of x.ops) {
    const a = approximateNode(operand, unit);
    pure &&= a.pure;
    if (a.approximation === undefined)
      return { approximation: undefined, pure };
    args.push(a.approximation);
  }
  const value = ce
    .function(
      x.operator,
      args.map((a) => a.value)
    )
    .N();
  const parts = realParts(value);
  if (parts === undefined) return { approximation: undefined, pure };

  const propagated = propagatedError(
    ce,
    x.operator,
    args,
    parts.logMagnitude,
    logUnit
  );
  // `NaN` (for example `0·∞`) is not a bound either.
  if (
    propagated === undefined ||
    Number.isNaN(propagated) ||
    propagated === Infinity
  )
    return { approximation: undefined, pure };
  return {
    approximation: {
      value,
      ...parts,
      logError: logAdd(propagated, parts.logMagnitude + logUnit),
    },
    pure,
  };
}

/**
 * The approximation of the constant symbol `x` at a precision set by
 * `_withTransientPrecision`. The value that the engine keeps for `x` has the
 * working precision, so its error can be larger than the bound at the
 * current precision: the value is computed again from the definition of
 * `x` (the value of `π` is `BigDecimal.PI` at the current precision). A
 * value that is a number literal is a leaf (`leaf`); a value that is an
 * expression (the golden ratio, `(1 + √5)/2`) is approximated.
 */
function constantApproximation(
  x: Expression,
  unit: number,
  leaf: (y: Expression, exact: boolean) => Approximation | undefined
): Approximation | undefined {
  if (!isSymbol(x)) return undefined;
  // The type of `valueDefinition` is a structural mirror that does not
  // declare `_valueAtCurrentPrecision`; the definition object has it.
  const def = x.valueDefinition as BoxedValueDefinition | undefined;
  const value = def?._valueAtCurrentPrecision?.();
  if (value === undefined) return undefined;
  if (isNumber(value)) return leaf(value, false);
  // A constant whose value is itself has no approximation.
  if (isSymbol(value) && value.symbol === x.symbol) return undefined;
  return approximate(value, unit);
}

/**
 * The error of `op(args)` that comes from the errors of `args`, plus the
 * rounding that is specific to `op` (the terms of a sum, the reduction of
 * a trigonometric argument), as a natural logarithm. `logMagnitude` is
 * `ln |op(args)|`, and `logUnit` is `ln unit`. `undefined` when there is
 * no bound. See `approximate`.
 */
function propagatedError(
  ce: Expression['engine'],
  op: string,
  args: Approximation[],
  logMagnitude: number,
  logUnit: number
): number | undefined {
  const [u, w] = args;
  // `ln` of the lower bound of `|u|` over its interval, or `undefined` when
  // the interval contains 0.
  const lower = (a: Approximation): number | undefined =>
    logSub(a.logMagnitude, a.logError);
  // `ln` of the upper bound of `|u|` over its interval.
  const upper = (a: Approximation): number =>
    logAdd(a.logMagnitude, a.logError);
  // An operand that is an exact integer (`n` in `x^n`, `√[n]{x}`).
  const exactInteger = (a: Approximation | undefined): number | undefined =>
    a !== undefined && a.logError === -Infinity && Number.isInteger(a.value.re)
      ? a.value.re
      : undefined;
  // Radians per unit of angle, and the error of a trigonometric argument:
  // its own error and the reduction by a multiple of π.
  const radians = {
    rad: 1,
    deg: Math.PI / 180,
    grad: Math.PI / 200,
    turn: 2 * Math.PI,
  }[ce.angularUnit];
  const logRadians = Math.log(radians);
  const angleError = (a: Approximation): number =>
    logRadians + logAdd(a.logError, a.logMagnitude + logUnit);
  // A bound for a function `f` with `|f'| ≤ 1/g²`, where `g` is `sin` or
  // `cos` (so `|g'| ≤ 1`), `|g| = m` at the computed argument and `e` is
  // the error of the argument: `|g| ≥ m − e` over the interval, so the
  // error is at most `e/(m − e)²`. No bound when `g` can be 0 (a pole).
  // `logM` and `logE` are `ln m` and `ln e`.
  const poleBound = (logM: number, logE: number): number | undefined => {
    const gap = logSub(logM, logE);
    return gap === undefined ? undefined : logE - 2 * gap;
  };

  switch (op) {
    case 'Add':
    case 'Subtract': {
      let error = -Infinity;
      for (const a of args)
        error = logAdd(error, logAdd(a.logError, a.logMagnitude + logUnit));
      return error;
    }
    case 'Negate':
    case 'Abs':
      return u.logError;
    case 'Multiply': {
      // |Π aᵢ − Π bᵢ| ≤ Σ |aᵢ − bᵢ|·Π_{j≠i} (|aⱼ| + eⱼ)
      let error = -Infinity;
      for (let i = 0; i < args.length; i++) {
        let term = args[i].logError;
        if (term === -Infinity) continue;
        for (let j = 0; j < args.length; j++)
          if (j !== i) term += upper(args[j]);
        error = logAdd(error, term);
      }
      return logAdd(error, Math.log(args.length) + logMagnitude + logUnit);
    }
    case 'Divide': {
      const m = lower(w);
      if (m === undefined) return undefined;
      return logAdd(u.logError, logMagnitude + w.logError) - m;
    }
    case 'Square':
      return Math.LN2 + upper(u) + u.logError;
    case 'Sqrt':
      // |√x − √y| ≤ min(√|x − y|, |x − y|/√x) for x, y ≥ 0. When the
      // interval contains 0, the exact value may not be real.
      if (lower(u) === undefined) return undefined;
      return Math.min(u.logError / 2, u.logError - u.logMagnitude / 2);
    case 'Root': {
      const n = exactInteger(w);
      if (n === undefined || n < 2) return undefined;
      // An even root of an interval that contains 0 may not be real.
      if (n % 2 === 0 && lower(u) === undefined) return undefined;
      // |x^(1/n) − y^(1/n)| ≤ 2·|x − y|^(1/n), also for opposite signs.
      return Math.LN2 + u.logError / n;
    }
    case 'Power': {
      const n = exactInteger(w);
      if (n !== undefined) {
        if (n === 0 || u.logError === -Infinity) return -Infinity;
        if (n > 0) return Math.log(n) + (n - 1) * upper(u) + u.logError;
        const m = lower(u);
        if (m === undefined) return undefined;
        return Math.log(-n) + (n - 1) * m + u.logError;
      }
      // A real exponent: the base must be positive.
      if (u.sign <= 0) return undefined;
      const m = lower(u);
      if (m === undefined) return undefined;
      // `ln` of the bounds of the base
      const logBases = [m, upper(u)];
      const p = w.value.re;
      const pError = Math.exp(w.logError);
      if (!Number.isFinite(p) || !Number.isFinite(pError)) return undefined;
      const exponents = [p - pError, p + pError];
      // The largest |b^x| and |b^(x − 1)| over the corners of the intervals
      // (both are monotonic in each variable), as logarithms.
      let logPower = -Infinity;
      let logPowerLess1 = -Infinity;
      for (const lb of logBases)
        for (const x of exponents) {
          logPower = Math.max(logPower, x * lb);
          logPowerLess1 = Math.max(logPowerLess1, (x - 1) * lb);
        }
      // The largest |ln b| over the interval of the base
      const log = Math.max(...logBases.map((lb) => Math.abs(lb)));
      return logAdd(
        Math.log(Math.abs(p) + pError) + logPowerLess1 + u.logError,
        logPower + Math.log(log) + w.logError
      );
    }
    case 'Exp': {
      // |eˣ − eʸ| ≤ eˣ·(e^|x − y| − 1)
      if (u.logError === -Infinity) return -Infinity;
      const e = Math.exp(u.logError);
      if (!Number.isFinite(e)) return undefined;
      // ln(e^e − 1), without overflow for a large `e` and without
      // underflow for a small one.
      const logExpm1 =
        e > 1
          ? e + Math.log1p(-Math.exp(-e))
          : u.logError + (e === 0 ? 0 : Math.log(Math.expm1(e) / e));
      return logMagnitude + logExpm1;
    }
    case 'Ln': {
      const m = lower(u);
      return m === undefined ? undefined : u.logError - m;
    }
    case 'Lb':
    case 'Lg':
    case 'Log': {
      const m = lower(u);
      if (m === undefined) return undefined;
      const lnError = u.logError - m;
      if (op === 'Lb') return lnError - Math.log(Math.LN2);
      if (op === 'Lg' || w === undefined) return lnError - Math.log(Math.LN10);
      // log_b(u) = ln u / ln b
      const mb = lower(w);
      if (mb === undefined) return undefined;
      const lnBase = Math.abs(w.logMagnitude);
      const lnBaseError = Math.exp(w.logError - mb);
      if (!(lnBase > lnBaseError)) return undefined;
      return (
        logAdd(lnError, logMagnitude + Math.log(lnBaseError)) -
        Math.log(lnBase - lnBaseError)
      );
    }
    case 'Sin':
    case 'Cos':
      return angleError(u);
    case 'Tan':
    case 'Cot':
      // |tan'| = 1/cos², and |cos| = 1/√(1 + tan²) (the same for `cot`,
      // with `sin`)
      return poleBound(-0.5 * logAdd(0, 2 * logMagnitude), angleError(u));
    case 'Sec':
    case 'Csc':
      // |sec'| ≤ 1/cos² and |csc'| ≤ 1/sin², with |cos| = 1/|sec|
      return logMagnitude > -Infinity
        ? poleBound(-logMagnitude, angleError(u))
        : undefined;
    case 'Arctan':
      return u.logError - logRadians;
    case 'Arcsin':
    case 'Arccos': {
      const m = upper(u);
      if (!(m < 0)) return undefined;
      // 1 − m², with `m = |u| + e`
      const oneMinusSquare = -Math.expm1(2 * m);
      return u.logError - 0.5 * Math.log(oneMinusSquare) - logRadians;
    }
    case 'Sinh':
    case 'Cosh': {
      // e·cosh(|u| + e), with ln cosh(x) = x + ln(1 + e^(−2x)) − ln 2
      const x = Math.exp(upper(u));
      if (!Number.isFinite(x)) return undefined;
      return u.logError + x + Math.log1p(Math.exp(-2 * x)) - Math.LN2;
    }
    case 'Tanh':
    case 'Arsinh':
      return u.logError;
    case 'Gamma':
    case 'Erf':
    case 'Erfc':
    case 'Erfi':
    case 'Zeta':
    case 'Arcosh':
    case 'Artanh': {
      if (args.length !== 1) return undefined;
      // The machine kernels of Γ, erf, erfc, erfi and ζ are not within
      // `unit` of the exact value everywhere: `1 − erf(x)` loses about two
      // digits near x = 2, and the reflection formula of Γ loses digits
      // near a pole. Their big decimal kernels were measured against mpmath
      // to be within `unit`, so these functions have a bound only when the
      // big decimal kernels are used. `Math.acosh` and `Math.atanh` are
      // within a few units in the last place.
      if (
        op !== 'Arcosh' &&
        op !== 'Artanh' &&
        ce.precision <= MACHINE_PRECISION
      )
        return undefined;
      const range = errorInterval(u);
      if (range === undefined) return undefined;
      // The computed value is `f(ũ)·(1 + δ)` with `|δ| ≤ unit`, so
      // `|f(ũ)| ≤ |value|·(1 + 2·unit)`.
      const derivative = logDerivativeBound(
        op,
        range[0],
        range[1],
        logMagnitude + Math.log1p(2 * Math.exp(logUnit))
      );
      return derivative === undefined ? undefined : u.logError + derivative;
    }
  }
  return undefined;
}

/**
 * The interval `[lo, hi]` of doubles that holds every real value within the
 * error bound of `a`: `value ± error`, made wider by `10⁻¹⁵·|value|` (the
 * conversion of `value` to a double and the rounding of the two ends are
 * each at most `1.2·10⁻¹⁶·|value|`), by `10⁻¹²·error` (the rounding of the
 * error bound) and by the smallest double (a value that is too small for a
 * double). `undefined` when the value or the error is not a finite double.
 */
function errorInterval(a: Approximation): [number, number] | undefined {
  const v = a.value.re;
  const e = Math.exp(a.logError);
  if (!Number.isFinite(v) || !Number.isFinite(e)) return undefined;
  const w = e * (1 + 1e-12) + Math.abs(v) * 1e-15 + Number.MIN_VALUE;
  return [v - w, v + w];
}

/** `ln(2/√π)`: `|erf′(t)| = (2/√π)·e^(−t²)` */
const LOG_TWO_OVER_SQRT_PI = Math.log(2 / Math.sqrt(Math.PI));

/**
 * `ln` of an upper bound on `|f′(t)|` for every `t` in the real interval
 * `[lo, hi]`, where `f` is the function `op` of one real argument. By the
 * mean value theorem, an error `e` of an argument in the interval gives an
 * error of at most `e` times this bound in `f`. `undefined` when there is
 * no bound: the interval contains a pole of `f`, or a point where `f` is not
 * real, or `op` is not one of the functions below.
 *
 * `logValue` is `ln |f(t₀)|`, or more, at a point `t₀` of the interval. Only
 * the bound of `Gamma` uses it.
 *
 * The bounds were checked against mpmath at 40 digits (the digamma bounds
 * at `t = 10⁻³⁰` to `10⁷` and on 60 negative unit intervals, the `ζ′` bound
 * at `s = 1 + 10⁻¹¹` to 50): the ratio of the exact value to the bound was
 * never more than 1.
 */
function logDerivativeBound(
  op: string,
  lo: number,
  hi: number,
  logValue: number
): number | undefined {
  switch (op) {
    case 'Erf':
    case 'Erfc': {
      // |erf′(t)| = |erfc′(t)| = (2/√π)·e^(−t²), which is largest at the
      // point of the interval nearest to 0.
      const m = lo > 0 ? lo : hi < 0 ? -hi : 0;
      return LOG_TWO_OVER_SQRT_PI - m * m;
    }
    case 'Erfi': {
      // erfi′(t) = (2/√π)·e^(t²), which is largest at the end of the
      // interval farthest from 0.
      const m = Math.max(-lo, hi);
      return LOG_TWO_OVER_SQRT_PI + m * m;
    }
    case 'Arcosh':
      // arcosh′(t) = 1/√((t − 1)(t + 1)) for t > 1, which decreases: it is
      // largest at `lo`. There is no bound when the interval reaches 1.
      if (!(lo > 1)) return undefined;
      return -0.5 * (Math.log(lo - 1) + Math.log(lo + 1));
    case 'Artanh': {
      // artanh′(t) = 1/((1 − t)(1 + t)) for |t| < 1, which is largest at
      // the end of the interval farthest from 0. There is no bound when the
      // interval reaches −1 or 1.
      const m = Math.max(-lo, hi);
      if (!(m < 1)) return undefined;
      return -(Math.log(1 - m) + Math.log(1 + m));
    }
    case 'Zeta': {
      // For a real s > 1, |ζ′(s)| = Σ_{n≥2} ln n/nˢ, which decreases when s
      // increases: the bound at `lo` holds on the whole interval. The terms
      // n = 2 and n = 3 are kept. For n ≥ 4, ln n/nˢ ≤ ∫_{n−1}^{n} ln t/tˢ dt,
      // because ln t/tˢ decreases for t ≥ e^(1/s), and e^(1/s) < 3. So
      // Σ_{n≥4} ln n/nˢ ≤ ∫_3^∞ ln t/tˢ dt = 3^(1−s)·(ln 3/(s − 1) + 1/(s − 1)²).
      // There is no bound when the interval reaches s = 1 (the pole), or
      // for s < 1, where ζ is not computed from this series.
      if (!(lo > 1)) return undefined;
      const s1 = lo - 1;
      const ln3 = Math.log(3);
      return logAdd(
        logAdd(Math.log(Math.LN2) - lo * Math.LN2, Math.log(ln3) - lo * ln3),
        -s1 * ln3 + Math.log(ln3 / s1 + 1 / (s1 * s1))
      );
    }
    case 'Gamma': {
      // Γ′ = Γ·ψ, where ψ is the digamma function. A bound `psi` on |ψ|
      // over the interval:
      // - For t > 0: ln t − 1/t < ψ(t) < ln t − 1/(2t), so
      //   |ψ(t)| ≤ |ln t| + 1/t ≤ max(|ln lo|, |ln hi|) + 1/lo.
      // - For t < 0 in the interval (n, n + 1), with n an integer: the
      //   reflection formula ψ(t) = ψ(1 − t) − π·cot(πt). Since 1 − t > 1,
      //   |ψ(1 − t)| ≤ ln(1 − t) + 1 ≤ ln(1 − lo) + 1. And
      //   |π·cot(πt)| ≤ π/|sin(πt)| ≤ π/(2d), where d is the smallest
      //   distance from the interval to an integer, because
      //   |sin(πt)| ≥ 2·(distance from t to the nearest integer).
      // - There is no bound when the interval contains a pole (0 or a
      //   negative integer).
      // Then ln |Γ| changes by at most psi·(hi − lo) over the interval, so
      // |Γ(t)| ≤ |Γ(t₀)|·e^(psi·(hi − lo)), and |Γ′| ≤ psi times that.
      let psi: number;
      if (lo > 0)
        psi = Math.max(Math.abs(Math.log(lo)), Math.abs(Math.log(hi))) + 1 / lo;
      else if (hi < 0) {
        const n = Math.floor(lo);
        const d = Math.min(lo - n, n + 1 - hi);
        if (!(d > 0)) return undefined;
        psi = Math.log(1 - lo) + 1 + Math.PI / (2 * d);
      } else return undefined;
      return Math.log(psi) + logValue + psi * (hi - lo);
    }
  }
  return undefined;
}

/** True for `+∞` and `−∞`. */
function isSignedInfinity(x: number): boolean {
  return x === Infinity || x === -Infinity;
}

/** True when the type of `x` is complex and excludes every real value
 *  (for example `π + i`, or a symbol declared `complex`). An unknown type,
 *  a real type and the `number` type (which includes the reals) give
 *  `false`. */
function isNonRealComplex(x: Expression): boolean {
  const t = x.type;
  return t.matches('complex') && !t.matches('real | signed_infinity');
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
