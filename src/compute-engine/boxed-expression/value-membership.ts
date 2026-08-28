import type { Type, TypeReference } from '../../common/type/types.js';
import { isComplexInfinityValue } from '../../common/type/types.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';

import type { Expression } from '../global-types.js';

import {
  isCharacter,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from './type-guards.js';

/**
 * Value membership — does a *concrete value* inhabit a type containing
 * value-kind (literal) or bounded-numeric components?
 *
 * See `docs/TYPE-SYSTEM.md`.
 *
 * Subtyping compares a value's *synthesized* type (`ce.box(0).type` is
 * `finite_integer`), which can never witness membership in a value type such
 * as `0` — the type would reject its own witness. This predicate tests the
 * value itself. It is consulted as an ADMISSION fallback wherever a concrete
 * value is at hand (argument validation, assign compatibility, overload arm
 * filtering) and never replaces the synthesized-type check.
 *
 * Contract:
 * - **Side-effect-free**: never evaluates; the only indirection followed is
 *   one symbol → literal-value hop through the symbol's existing binding.
 * - **Exactness (D1)**: number comparison is `isSame` — the engine's exact
 *   value identity (`0.0` boxes to the exact integer `0`; `3.5 ≡ 7/2`).
 *   `NaN` is a member of exactly the `NaN` value type (amended 2026-08-02;
 *   see `acceptsValueLiteral`) and of no other value type or range. Range
 *   endpoints are inclusive. The same "match only themselves" rule covers the
 *   unsigned complex infinity `~oo`, whose value type carries a tagged
 *   sentinel instead of a JavaScript number (see `acceptsValueLiteral`).
 * - **Primitives that no value synthesizes**: membership in a primitive name
 *   normally coincides with subtyping the value's synthesized type, but the
 *   `nan` and `infinity` primitives name values whose synthesized type is
 *   still the wide `number`, so subtyping alone would make each of them
 *   reject its own members. Those two are decided on the value (see
 *   `accepts`).
 * - Error values are members of nothing.
 * - `false` means "not provably a member" — a symbolic or partially-known
 *   expression yields `false` and the caller keeps its ordinary behavior
 *   (the tri-state refinement is Phase 1 of the design).
 */
export function typeAcceptsValue(
  expr: Expression,
  type: Type | undefined
): boolean {
  if (type === undefined) return false;
  // Fast bail: without a value-kind/bounded-numeric component, membership
  // coincides with subtyping and the caller has already checked that. The
  // `nan` and `infinity` primitives are the exception — they are decided on
  // the value by `accepts` — so this entry point does not answer for them;
  // `admissionOf` reaches `accepts` directly and does.
  if (!hasValueComponent(type)) return false;

  const v = concreteValueOf(expr);
  if (v === undefined) return false;

  return accepts(v, type);
}

/**
 * Tri-state admission of one operand against one parameter type
 * (`docs/TYPE-SYSTEM.md`) — ONE
 * implementation consumed by both static resolution and the runtime clause
 * selector, so the two can never disagree.
 *
 * - `'admit'` — the operand certainly satisfies the parameter: a fully-known
 *   concrete value passing membership, or a static type that is a subtype of
 *   the parameter.
 * - `'refute'` — certainly not: a fully-known concrete value failing
 *   membership, or a static type PROVABLY disjoint from the parameter.
 *   Refutation from a static type uses `provablyDisjoint` — `couldMatch`
 *   answers "could be" and `!isDisjointFrom` is not the same claim; only
 *   proven disjointness refutes.
 * - `'undecidable'` — neither: e.g. a symbolic operand against a value-type
 *   parameter. Unknown/`any` operands are always undecidable (an unknown
 *   operand never refutes — same rule as `validateArguments`).
 *
 * Write-free: never infers or narrows.
 */
export type Admission = 'admit' | 'refute' | 'undecidable';

export function admissionOf(op: Expression, param: Type): Admission {
  if (!op.isValid) return 'refute';

  const opType = op.type;
  if (opType.isUnknown || opType.type === 'any') return 'undecidable';

  // A static subtype match admits regardless of value components: a symbol
  // DECLARED type `0` (no value yet) statically satisfies parameter `0` —
  // classifying it undecidable would needlessly block dispatch and widen
  // result types.
  if (opType.matches(param)) return 'admit';

  // A FULLY-KNOWN concrete value decides EXACTLY, in BOTH directions, against
  // ANY parameter (USER RULING 2026-08-12): a fully-known value never keeps
  // dispatch inert. `accepts` implements the total §4.1 membership definition
  // — value components test the value, everything else falls back to
  // subtyping the value's synthesized type, which for a literal IS its
  // principal type — so it refutes as precisely as it admits.
  //
  // The `hasValueComponent` fast bail (`typeAcceptsValue`) is sound for
  // ADMISSION only: without a value component, membership coincides with the
  // subtype check already made above. It is NOT sound for REFUTATION —
  // failing to match `integer` is a refutation for the value `0.3` but only
  // an open question for a symbol. That asymmetry is why the verdict is
  // taken here, on the value, rather than through `typeAcceptsValue`.
  //
  // This subsumes the former NaN carve-out (`NaN` vs a `real` parameter was
  // "undecidable" — its synthesized type is the wide `number`, so neither
  // the subtype match above nor disjointness below could settle it): NaN is
  // simply one fully-known value among all the others.
  const v = concreteValueOf(op);
  if (v !== undefined) return accepts(v, param) ? 'admit' : 'refute';

  // No concrete value: a value component keeps the answer open, and so does
  // any other parameter, unless the STATIC types are already disjoint (an
  // operand typed `string` can never inhabit `0`).
  return provablyDisjoint(opType.type, param) ? 'refute' : 'undecidable';
}

/** Does `type` contain a component whose membership depends on the VALUE
 * (a literal value type or a bounded numeric), so that `typeAcceptsValue`
 * could answer differently from subtyping? */
export function hasValueComponent(t: Type): boolean {
  return valueComponent(t, undefined);
}

/** `hasValueComponent`, carrying the set of alias references currently being
 * unfolded on THIS path — the same cycle guard `isSubtype` applies at its own
 * unfold sites (`common/type/subtype.ts`), which this predicate previously
 * lacked: a self-recursive alias (`type alias json = … | list<json>`) unfolded
 * forever and overflowed the stack.
 *
 * Answering `false` on re-entry is EXACT here, not merely conservative: every
 * component reachable by going around the cycle is also reachable on the first
 * unfold, so no value component can be lost by cutting the back edge.
 *
 * The set is path-scoped (each frame deletes its own entry in a `finally`) and
 * allocated lazily at the first reference, so the ground-type path — types with
 * no reference in them at all — allocates nothing. */
function valueComponent(
  t: Type,
  seen: Set<TypeReference> | undefined
): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'value':
    case 'numeric':
      return true;
    case 'union':
    case 'intersection':
      return t.types.some((x) => valueComponent(x, seen));
    case 'negation':
      return valueComponent(t.type, seen);
    case 'reference': {
      // Structural aliases unfold; a nominal reference stays opaque.
      if (t.alias !== true || t.def === undefined) return false;
      if (seen === undefined) seen = new Set();
      else if (seen.has(t)) return false; // cycle — cut the back edge
      seen.add(t);
      try {
        return valueComponent(t.def, seen);
      } finally {
        seen.delete(t);
      }
    }
    case 'list':
      return valueComponent(t.elements, seen);
    case 'tuple':
      return t.elements.some((e) => valueComponent(e.type, seen));
    default:
      return false;
  }
}

/** The concrete literal `expr` denotes, or `undefined` when `expr` is not a
 * concrete value. Never evaluates: literals answer directly; a symbol is
 * followed one hop into its existing binding iff that binding holds a
 * literal.
 *
 * Exported for the runtime conformance check (`validate.ts`), which must
 * make the same concrete-vs-symbolic split this module's admission makes:
 * a concrete evaluated operand decides exactly, a symbolic one is left
 * alone. */
export function concreteValueOf(expr: Expression): Expression | undefined {
  if (!expr.isValid) return undefined;
  if (isNumber(expr) || isString(expr)) return expr;
  if (isSymbol(expr)) {
    const name = expr.symbol;
    if (name === 'True' || name === 'False') return expr;
    const bound = expr.valueDefinition?.value;
    if (
      bound !== undefined &&
      bound !== expr &&
      (isNumber(bound) || isString(bound) || isBooleanLiteral(bound))
    )
      return bound;
    return undefined;
  }
  // A `List`/`Tuple` application whose elements are ALL concrete is itself a
  // concrete value (fully-known shape, spec §4.1); anything less — a lazy or
  // symbolic collection, any other application, error values — is not.
  if (isFunction(expr, 'List') || isFunction(expr, 'Tuple')) {
    if (expr.ops.every((op) => concreteValueOf(op) !== undefined)) return expr;
    return undefined;
  }
  return undefined;
}

function isBooleanLiteral(expr: Expression): boolean {
  return isSymbol(expr, 'True') || isSymbol(expr, 'False');
}

/** `admissionOf`, but an operand HOLDING a concrete value is judged by that
 * value even when the operand's own type is `any`/`unknown` (where
 * `admissionOf` bails to `undecidable` before looking at the value — a rule
 * about TYPE-based refutation: an unknown STATIC type never refutes). The
 * runtime conformance check makes the same concrete-vs-symbolic split; use
 * this wherever held-value evidence should decide — e.g. the `Rational`
 * constructor refusing `Rational(3, x)` with `x := 2.5`. */
export function evidenceAdmissionOf(op: Expression, param: Type): Admission {
  const v = concreteValueOf(op);
  if (v !== undefined && v !== op) return admissionOf(v, param);
  return admissionOf(op, param);
}

/** Does this operand hold a concrete non-numeric SCALAR (a string or a
 * boolean)?
 *
 * The unary `Multiply`/`Subtract` canonicalization folds a lone operand to
 * itself, which erases the operator before the arithmetic evaluate guard can
 * examine it — the one arithmetic route where a wrong-kind operand flowed
 * through unexamined (`Multiply(s)` with `s := "str"` evaluated to `"str"`
 * while the literal `Multiply("str")` refused). Those fold sites consult this
 * predicate and reject when it answers `true`.
 *
 * Only scalar evidence counts: a lone list/tensor operand is the legitimate
 * broadcast identity (`Multiply([1, 2])` is `[1, 2]`), and a symbol with no
 * held value stays admitted — the same concrete-vs-symbolic split the
 * admission machinery above makes. A `character` counts as such a scalar too,
 * and has to be recognized separately: `concreteValueOf` does not report
 * character literals, so both a bare character operand and a symbol whose
 * binding holds one are checked here directly. */
export function heldNonNumericScalar(op: Expression): boolean {
  const v = concreteValueOf(op);
  if (v !== undefined) return isString(v) || isBooleanLiteral(v);
  // `concreteValueOf` deliberately excludes `character` literals; a held
  // character is equally a non-numeric scalar.
  if (isCharacter(op)) return true;
  if (isSymbol(op)) {
    const bound = op.valueDefinition?.value;
    return bound !== undefined && bound !== op && isCharacter(bound);
  }
  return false;
}

/** Recursive membership of the concrete literal `v` in `t`. Components with
 * no value dependence fall back to subtyping on the synthesized type.
 *
 * `seen` carries the alias unfolds live on THIS path — see the `reference`
 * case. It is threaded rather than module-level because the recursion never
 * leaves this file (`isSubtype` cannot call back into `accepts`), and it is
 * allocated lazily at the first structural alias, so the ground-type path
 * allocates nothing. */
function accepts(
  v: Expression,
  t: Type,
  seen?: Map<TypeReference, Set<Expression>>
): boolean {
  if (typeof t === 'string') {
    // Two primitive names have members whose SYNTHESIZED type is the wide
    // `number`, so subtyping alone would make each of them reject its own
    // members: a boxed NaN types `number`, and so does the unsigned complex
    // infinity `~oo`. Decide those on the value.
    //
    // The signed infinities need no arm here: they synthesize
    // `non_finite_number`, which IS a primitive subtype of `infinity`, so the
    // subtype fallback below already admits them.
    if (t === 'nan') return isNumber(v) && v.isNaN === true;
    if (t === 'infinity' && isComplexInfinityLiteral(v)) return true;
    return isSubtype(v.type.type, t);
  }

  switch (t.kind) {
    case 'value':
      return acceptsValueLiteral(v, t.value);

    case 'numeric': {
      // Bounds are only meaningful over an ordered (real) domain — a
      // non-real value (e.g. `5+1000i` against `complex<0..10>`) is never a
      // member. Mirrors `rangeContains` (match-dispatch.ts).
      if (!isNumber(v) || v.isNaN === true || v.isExtendedReal !== true)
        return false;
      // The base kind is judged on the synthesized type (an integer literal
      // inhabits `integer<…>`; a non-integer float does not).
      if (!isSubtype(v.type.type, t.type)) return false;
      // Inclusive bounds (spec §4.1), compared through the boxed
      // exactness-aware comparators — `.re` would project an exact bignum
      // or rational onto a double and could round it onto an endpoint
      // (e.g. 2^53 + 1 admitted by an upper bound of 2^53).
      const ce = v.engine;
      if (
        t.lower !== undefined &&
        v.isGreaterEqual(ce.number(t.lower)) !== true
      )
        return false;
      if (t.upper !== undefined && v.isLessEqual(ce.number(t.upper)) !== true)
        return false;
      return true;
    }

    case 'union':
      return t.types.some((u) => accepts(v, u, seen));
    case 'intersection':
      return t.types.every((u) => accepts(v, u, seen));
    case 'negation':
      return !accepts(v, t.type, seen);
    case 'reference': {
      // Nominal references are opaque — synthesized subtyping decides.
      if (!t.alias || t.def === undefined) return isSubtype(v.type.type, t);

      // Structural aliases unfold, under a cycle guard keyed on the PAIR
      // (the alias record + the IDENTITY of the value being tested) — the
      // same discriminator `isSubtype`'s rhs unfold uses
      // (`beginUnfoldAgainst`, `common/type/subtype.ts`). Keying on the
      // record alone would be wrong here for exactly the reason it is wrong
      // there: an equirecursive alias legitimately reaches itself through a
      // CONSTRUCTOR (`type alias json = number | list<json>`), once per level
      // of a nested list, each time against a strictly SMALLER value — a
      // record-keyed guard would cut that off and report a non-member. A
      // value is an immutable tree, so descending into a `list`/`tuple`
      // element always yields a different object; re-entering with the same
      // value object is therefore exactly the non-progressing cycle
      // (`type alias a = a | number`, or a mutual alias chain), which
      // recursed forever and overflowed the stack.
      //
      // VERDICT ON A CYCLE: `false`. Membership in an equirecursive alias is
      // the LEAST fixed point — a member needs a finite unfolding that makes
      // progress, and a back edge reached at the same value witnesses
      // nothing, so no member can be lost by cutting it. `false` is EXACT
      // here, not merely conservative, the same claim `valueComponent`'s
      // guard makes above: for `type alias a = a | number` the members are
      // exactly `number`, which the non-cyclic union arm already supplies.
      // That is the right answer for BOTH callers. `typeAcceptsValue` reads
      // it as its documented "not provably a member". `admissionOf` reads it
      // as `'refute'`, which is both sound (the value genuinely is not a
      // member) and the verdict its contract wants — a fully-known value
      // must never leave dispatch inert — and it keeps this predicate
      // agreeing with `isSubtype`/`provablyDisjoint`, which likewise answer
      // negatively when they cut an alias cycle.
      if (seen === undefined) seen = new Map();
      let values = seen.get(t);
      if (values === undefined) seen.set(t, (values = new Set()));
      else if (values.has(v)) return false;
      values.add(v);
      try {
        return accepts(v, t.def, seen);
      } finally {
        // Path-scoped: each frame drops its OWN entry, so a sibling arm asked
        // later at the same value still gets a full unfold.
        values.delete(v);
      }
    }

    // Fully-known constructor shapes recurse element-wise (spec §4.1):
    // `List(0)` inhabits `list<0>`. `concreteValueOf` only admits List/Tuple
    // applications whose elements are all concrete, so `v.ops` is safe to
    // walk here. Other constructor kinds (set, record, dictionary) stay
    // conservative — they fall through to synthesized subtyping.
    case 'list': {
      if (!isFunction(v, 'List')) return isSubtype(v.type.type, t);
      // A declared first dimension must match the element count; deeper
      // dimensions are the nested lists' own membership problem.
      if (t.dimensions !== undefined && t.dimensions.length > 0) {
        const d0 = t.dimensions[0];
        if (Number.isFinite(d0) && d0 >= 0 && v.ops.length !== d0) return false;
        if (t.dimensions.length > 1) return isSubtype(v.type.type, t);
      }
      return v.ops.every((op) => {
        const el = concreteValueOf(op);
        return el !== undefined && accepts(el, t.elements, seen);
      });
    }
    case 'tuple': {
      if (!isFunction(v, 'Tuple')) return isSubtype(v.type.type, t);
      if (v.ops.length !== t.elements.length) return false;
      return v.ops.every((op, i) => {
        const el = concreteValueOf(op);
        return el !== undefined && accepts(el, t.elements[i].type, seen);
      });
    }

    default:
      return isSubtype(v.type.type, t);
  }
}

/** Membership in a literal value type (`0`, `"red"`, `true`): the engine's
 * exact value identity (`isSame`). `NaN` is a member of exactly the `NaN`
 * value type — "match only themselves", like the infinities (amended
 * 2026-08-02; v1 ruled NaN a member of NO value type, which made a `NaN`
 * literal parameter unreachable). NaN never inhabits any OTHER value type
 * even though `isSame(NaN, NaN)` is `true`, so both directions stay
 * explicit.
 *
 * The unsigned complex infinity `~oo` matches only itself too, and needs its
 * own arm: it has no JavaScript number to stand for it, so its value type
 * carries the frozen `COMPLEX_INFINITY_VALUE` sentinel object instead, which
 * the `typeof` chain below would answer `false` for — including against the
 * very value the type names. */
function acceptsValueLiteral(v: Expression, value: unknown): boolean {
  if (isComplexInfinityValue(value)) return isComplexInfinityLiteral(v);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return isNumber(v) && v.isNaN === true;
    if (!isNumber(v) || v.isNaN === true) return false;
    return v.isSame(v.engine.number(value));
  }
  if (typeof value === 'string') return isString(v) && v.string === value;
  if (typeof value === 'boolean')
    return isSymbol(v) && v.symbol === (value ? 'True' : 'False');
  return false;
}

/** Is `v` the boxed unsigned complex infinity `~oo`?
 *
 * It cannot be recognized the way the signed infinities are: its synthesized
 * type is the wide `number`, and no JavaScript number denotes it. The flag
 * lives on the numeric value instead (`isComplexInfinity`,
 * `numeric-value/types.ts`), and only a NumericValue object carries it — a
 * number literal held as a plain JavaScript `number` is never `~oo`. */
function isComplexInfinityLiteral(v: Expression): boolean {
  if (!isNumber(v)) return false;
  const nv = v.numericValue;
  return typeof nv === 'object' && nv !== null && nv.isComplexInfinity;
}
