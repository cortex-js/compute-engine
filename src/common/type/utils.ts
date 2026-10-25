import { makeNumericRangeType } from './numeric-range.js';
import { immutableNumericType } from './immutable.js';
import { isEffectSubset, unionEffectSets } from './effects.js';
import { substituteTypeVariables } from './instantiate.js';
import { parseType } from './parse.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  isValidType,
  NUMERIC_TYPES_SET,
} from './primitive.js';
import { isComplexInfinityValue, isIndeterminateValue } from './types.js';
import { declarationOf } from './reference.js';
import { typeToDedupKey, typeToString } from './serialize.js';
import {
  broadcastCollectionArm,
  cannotHoldAList,
  isSubtype,
  joinUnresolvedArm,
  listElementType,
  provablyAdmits,
  provablyDisjoint,
  widen,
} from './subtype.js';

// Re-export isValidType from primitive for backward compatibility
export { isValidType };

// Whether a list whose cells have a given type may carry dimensions (be a
// tensor). Defined in `primitive.ts`, a leaf module, so that the type
// builder can ask the same question as the engine's literal typing without
// a circular import; consumers in the engine import it from here.
export { cellTypeMayCarryDimensions } from './primitive.js';

// Re-export widen/narrow from subtype (moved there to break the
// subtype ↔ utils cycle; they depend on isSubtype)
export { widen, widenAll, widenElementTypes, narrow } from './subtype.js';

import type {
  EffectSet,
  NamedElement,
  Type,
  ListType,
  FunctionSignature,
  NumericPrimitiveType,
  TypeReference,
  TypeString,
} from './types.js';

/**
 * Is `t` a NUMERIC SCALAR type — a numeric primitive name (`integer`,
 * `real`, …), a numeric range (`real<0..1>`) or a numeric value type (`3`,
 * `~oo`)? A value of such a type is never a collection, a tuple or a
 * broadcast lift, so a shape gate can skip its collection predicates for
 * an operand of that type. A union, an alias reference, `unknown` and `any`
 * do not qualify: each may hold a collection.
 */
export function isNumericScalarType(t: Type): boolean {
  if (typeof t === 'string')
    return NUMERIC_TYPES_SET.has(t as NumericPrimitiveType);
  return (
    t.kind === 'numeric' ||
    (t.kind === 'value' &&
      (typeof t.value === 'number' ||
        isComplexInfinityValue(t.value) ||
        isIndeterminateValue(t.value)))
  );
}

/** `tier<0..>` — the non-negative half of a numeric tier. */
export function nonNegativeRangeType(tier: NumericPrimitiveType): Type {
  return immutableNumericType(tier, 0);
}

/** `tier<..0>` — the non-positive half of a numeric tier. */
export function nonPositiveRangeType(tier: NumericPrimitiveType): Type {
  return immutableNumericType(tier, undefined, 0);
}

/** `tier<0<..>` — the positive members of a numeric tier, as an open range
 * (`signOfType` reads it back as `positive`). */
export function positiveRangeType(tier: NumericPrimitiveType): Type {
  // The open range IS the canonical spelling of "positive" (open-bound
  // ranged types, ruled 2026-08-28): `real<0<..>`, and on an integer tier
  // the normalized closed `integer<1..>`.
  return makeNumericRangeType(tier, 0, Infinity, true, false);
}

/** `tier<..<0>` — the negative members of a numeric tier. */
export function negativeRangeType(tier: NumericPrimitiveType): Type {
  return makeNumericRangeType(tier, -Infinity, 0, false, true);
}

/**
 * Widen every range, sign or value decoration on a numeric type back to its
 * bare tier: `real<0..>` → `real`, `real<0..> & !0` → `real`, the value
 * type `21` → `integer`. Structural nodes (unions, collections, tuple
 * components, `broadcastable`) are descended; everything else — including a
 * non-numeric intersection — is returned as is, by identity when nothing
 * changed.
 *
 * This is what a JOIN-based result computation (the widen tail of
 * `addTypeOnTypes`, the cell absorption of `Add`/`Multiply`, the broadcastable element join) must
 * apply to its inputs: a join is a set union, and neither a sum nor a
 * product of two values lies in the union of their ranges (`x, y > −1` does
 * not put `x + y` above −1). Bare tiers ARE closed under those operations,
 * so stripping first keeps the old claims and drops only the unsound bound.
 * Carrying bounds through arithmetic is interval arithmetic, which the
 * ROADMAP entry "Ranged types should carry sign…" scopes separately.
 */
export function stripNumericRanges(t: Type): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'numeric':
      return t.type;
    case 'value': {
      const v = t.value;
      // The `Indeterminate` literal strips to `nan`, as `NaN` does below.
      if (isIndeterminateValue(v)) return 'nan';
      if (typeof v !== 'number') return t;
      // The tiers a non-finite literal strips to, matching `widenValueTypes`
      // (`widen-value.ts`) exactly: the three infinities share `infinity`, and
      // NaN has `nan`. Both used to strip to the top type `number`, which said
      // nothing; the named tiers exist since the numeric tree became
      // finite-by-default.
      if (Number.isNaN(v)) return 'nan';
      if (!Number.isFinite(v)) return 'infinity';
      return Number.isInteger(v) ? 'integer' : 'real';
    }
    case 'intersection': {
      // The intersection is a subset of each member, so any single member's
      // strip is a sound upper bound; take the first that reaches a numeric
      // tier (`real<0..> & !0` → `real`). A non-numeric intersection is not
      // this function's business.
      for (const m of t.types) {
        const st = stripNumericRanges(m);
        if (
          typeof st === 'string' &&
          NUMERIC_TYPES_SET.has(st as NumericPrimitiveType)
        )
          return st;
      }
      return t;
    }
    case 'union': {
      const types = t.types.map((x) => stripNumericRanges(x));
      if (types.every((x, i) => x === t.types[i])) return t;
      // Two members can strip to the same tier: the two signed infinities of
      // `signed_infinity` (`+oo | -oo`) both strip to `infinity`, and
      // `integer<0..> | integer<..-5>` strips to `integer` twice. Keep one
      // of each, or the union prints the same member twice
      // (`infinity | infinity | nan | real`).
      const seen = new Set<string>();
      const unique = types.filter((x) => {
        const key = typeToDedupKey(x);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (unique.length === 1) return unique[0];
      return { ...t, types: unique };
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = stripNumericRanges(t.elements);
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'tuple': {
      const elements = t.elements.map((el) => {
        const type = stripNumericRanges(el.type);
        return type === el.type ? el : { ...el, type };
      });
      if (elements.every((el, i) => el === t.elements[i])) return t;
      return { ...t, elements };
    }
    default:
      return t;
  }
}

/**
 * The type of `−x` given the type of `x`: ranges and numeric values are
 * REFLECTED about zero (`real<−1..>` → `real<..1>`, `21` → `−21`, and the
 * `!0` exclusion is invariant), structural nodes are descended, and every
 * other type — the numeric tiers themselves included — is its own negation.
 * This is what keeps `Negate`'s type echo sound now that operand types can
 * carry bounds: echoing `real<0..>` for `−|x|` claimed a sign the value
 * contradicts.
 */
export function negateNumericType(t: Type): Type {
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'numeric': {
      const lo = t.lower ?? undefined;
      const hi = t.upper ?? undefined;
      if (lo === undefined && hi === undefined) return t;
      // Reflect bounds AND their open flags (`-0` normalizes to `0` in the
      // constructor so a reflected zero bound stays canonical).
      return makeNumericRangeType(
        t.type,
        hi === undefined ? -Infinity : -hi,
        lo === undefined ? Infinity : -lo,
        t.upperOpen === true,
        t.lowerOpen === true
      );
    }
    case 'value': {
      const v = t.value;
      if (typeof v !== 'number' || Number.isNaN(v)) return t;
      return v === 0 ? t : { kind: 'value', value: -v };
    }
    case 'negation': {
      const inner = negateNumericType(t.type);
      return inner === t.type ? t : { ...t, type: inner };
    }
    case 'union':
    case 'intersection': {
      const types = t.types.map((x) => negateNumericType(x));
      if (types.every((x, i) => x === t.types[i])) return t;
      return { ...t, types };
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = negateNumericType(t.elements);
      return elements === t.elements ? t : { ...t, elements };
    }
    case 'tuple': {
      const elements = t.elements.map((el) => {
        const type = negateNumericType(el.type);
        return type === el.type ? el : { ...el, type };
      });
      if (elements.every((el, i) => el === t.elements[i])) return t;
      return { ...t, elements };
    }
    default:
      return t;
  }
}

export function isSignatureType(
  type: Readonly<Type> | TypeString
): type is FunctionSignature {
  type = typeof type === 'string' ? parseType(type) : type;
  return typeof type !== 'string' && type.kind === 'signature';
}

/**
 * The signature arms of a callable type: `[t]` for a plain signature, and
 * every member of a union or intersection whose members are ALL signatures.
 * `undefined` otherwise — including for the bare `function` type, which
 * carries no arm information and is handled separately by each caller.
 *
 * - An **intersection** of signatures is an overload set: the value inhabits
 *   every arm, i.e. it is callable at each of them.
 * - A **union** of signatures is a value that is one of those functions,
 *   without saying which.
 *
 * A mixed algebraic type (`((number) -> real) & list<boolean>`) is not
 * reliably callable, so it yields `undefined` rather than a partial arm list.
 */
export function signatureArms(
  type: Readonly<Type> | undefined
): ReadonlyArray<FunctionSignature> | undefined {
  if (!type || typeof type === 'string') return undefined;
  if (type.kind === 'signature') return [type];
  if (type.kind === 'union' || type.kind === 'intersection') {
    const arms: FunctionSignature[] = [];
    for (const member of type.types) {
      if (typeof member === 'string' || member.kind !== 'signature')
        return undefined;
      arms.push(member);
    }
    return arms.length > 0 ? arms : undefined;
  }
  return undefined;
}

/**
 * True when narrowing an operand of type `from` to the parameter type `to`
 * would not silently DROP effects (`docs/EFFECTS-MODEL.md`, "Subtyping").
 *
 * Argument validation narrows an INFERRED symbol type to the parameter when the
 * parameter is a subtype of it (`isSubtype(param, op.type)`) rather than
 * erroring. On the effect axis that test is inverted: effect sets are
 * COVARIANT, so a pure parameter is a subtype of a `random` operand — and
 * narrowing on its strength would both admit an effectful callback at a
 * pure-arrow bound and rewrite the symbol's type to claim the absence of an
 * effect it has. The narrowing is admissible only when the operand's arrow
 * effects are already within the parameter's bound.
 *
 * Non-callable types have no arrow, so they are unaffected: the check is a
 * no-op unless both types are callable with a known shape.
 */
export function narrowingPreservesEffects(
  from: Readonly<Type> | undefined,
  to: Readonly<Type> | undefined
): boolean {
  const fromArms = signatureArms(from);
  if (fromArms === undefined) return true;
  const toArms = signatureArms(to);
  if (toArms === undefined) return true;
  return isEffectSubset(armsEffects(fromArms), armsEffects(toArms));
}

/** The union of the arms' effect specifiers. */
function armsEffects(
  arms: ReadonlyArray<FunctionSignature>
): EffectSet | undefined {
  let effects: EffectSet | undefined = undefined;
  for (const arm of arms) effects = unionEffectSets(effects, arm.effects);
  return effects;
}

/**
 * The effects attached to a callable type's arrow, if any. `undefined` means
 * the arrow states nothing — and is also the answer for a type that is not
 * callable at all. The stated-empty `[]` (an author-written `pure`) is
 * PRESERVED: "states the empty set" is what distinguishes a purity contract
 * from the inferred track.
 *
 * An INTERSECTION of signatures is the overload-set representation; the
 * effects of an overload set are the UNION of the arms' ("One source of
 * truth"): an overload with one effect-bearing arm is not a pure definition. A
 * MIXED intersection is not a callable overload set and contributes nothing.
 *
 * A UNION is the shape an EXTRACTION produces: `At(list<(…) random -> …>, i)`
 * types as `((…) random -> …) | missing`, and the element really may be that
 * arrow — so the effects of a union are the union of its members', with
 * non-signature members (`missing`, `nothing`) contributing nothing.
 *
 * This is the reader behind `BoxedType.effects`, and the compute-engine
 * layer's `effects-inference.ts` re-exports it: there is ONE implementation.
 */
export function signatureEffects(
  type: Readonly<Type> | undefined
): EffectSet | undefined {
  if (type === undefined || typeof type === 'string') return undefined;
  if (type.kind === 'signature') return canonicalEffectSet(type.effects);
  if (type.kind === 'union') {
    let effects: EffectSet | undefined = undefined;
    for (const member of type.types)
      effects = unionEffectSets(effects, signatureEffects(member));
    return effects;
  }
  if (type.kind !== 'intersection') return undefined;
  const arms = signatureArms(type);
  return arms === undefined ? undefined : canonicalEffectSet(armsEffects(arms));
}

/**
 * True when a type's SOURCE TEXT is fully parenthesized — the whole spelling
 * is a single `(…)` group, e.g. `((real) random -> real)` (whereas
 * `(real) random -> real` opens with the ARGUMENT list, whose group closes
 * before the arrow).
 *
 * Grouping does not survive parsing — a {@link Type} records no parentheses —
 * so a consumer that gives grouped spellings a distinct reading must test the
 * text. The consumer (ruled 2026-08-01): the `Function`-literal return marker,
 * where the ungrouped spelling of an effect-bearing signature declares the
 * LITERAL's own effect contract, and the grouped spelling is an ordinary
 * return-type ascription whose return happens to be an effectful arrow
 * (`function mk(x) -> ((real) random -> real) { … }`). Since 2026-08-04 the
 * same reading applies to an EFFECT-FREE arrow, so grouping is what every
 * "returns a function" return-type marker rests on.
 */
export function isGroupedTypeText(text: string): boolean {
  const s = text.trim();
  if (!s.startsWith('(')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i === s.length - 1;
    }
  }
  return false;
}

/**
 * The text to store in a `Function`-literal RETURN-type marker for `t`.
 *
 * The inverse of {@link isGroupedTypeText}: a result that is itself a signature
 * has to be spelled GROUPED, or the marker re-reads as the literal's own
 * contract (`functionLiteralDeclaredSignature`) — the plain `typeToString`
 * spelling of `(number) -> number` is exactly the ungrouped form that ruling
 * gives to the literal. Every site that SYNTHESIZES a return-type marker from
 * a {@link Type} (`desugarSignatureString`, `reconcileFunctionLiteralReturn`)
 * must go through here; a site that carries an author-written type OPERAND
 * through verbatim already preserves the author's grouping.
 */
export function returnTypeText(t: Type): string {
  const s = typeToString(t);
  return typeof t === 'object' && t.kind === 'signature' ? `(${s})` : s;
}

/**
 * `effects` in canonical form: de-duplicated and alphabetically sorted.
 *
 * `ce.type()` accepts a hand-built `Type` object as-is, so an arrow's `effects`
 * array can reach a reader unsorted (`['scope', 'random']`) — yet the sorted
 * labels are what `BoxedType.effects` promises its callers. Extraction
 * therefore normalizes defensively, for the same reason `effectSetToString`
 * sorts.
 *
 * `undefined`, `'any'` and the stated-pure `[]` are preserved exactly, and an
 * already-canonical array is returned unchanged (no allocation).
 */
function canonicalEffectSet(
  effects: EffectSet | undefined
): EffectSet | undefined {
  if (effects === undefined || effects === 'any' || effects.length <= 1)
    return effects;
  // `>=` catches an out-of-order label and a duplicate in the same pass
  for (let i = 1; i < effects.length; i++)
    if (effects[i - 1] >= effects[i]) return [...new Set(effects)].sort();
  return effects;
}

/**
 * True when `type` is callable with a known shape: the bare `function` type, a
 * signature, or a union/intersection of signatures.
 *
 * Replaces the old `functionSignature`, which returned the signature itself
 * but whose every caller only asked `!== undefined`. The one caller that
 * wanted the value asked for the arity — see {@link functionArity}. Returning
 * a value also meant synthesizing `(any*) -> unknown` for the bare `function`
 * type, which callers then had to special-case back out (see
 * `assertFunctionLiteralArity` in `engine-declarations.ts`).
 */
export function hasFunctionSignature(
  type: Readonly<Type> | undefined
): boolean {
  if (type === 'function') return true;
  return signatureArms(type) !== undefined;
}

/**
 * True for the bare `function` WILDCARD — the type installed by
 * `ce.declare('f', 'function')`, the documented forward-declaration form.
 *
 * It is a widening, not a contract: it promises callers only that the name is
 * callable, and says nothing about arity, parameter types or return type. Code
 * that needs a signature to reason with must therefore treat it as "no
 * signature yet" and look elsewhere (typically at the assigned value's own
 * type), rather than as a constraint to check against. {@link
 * hasFunctionSignature} is true for it — it IS callable — so that predicate
 * cannot make this distinction; see `assertFunctionLiteralArity`
 * (`engine-declarations.ts`), which excludes the wildcard from arity checking
 * for the same reason.
 */
export function isWildcardFunctionType(
  type: Readonly<Type> | undefined
): boolean {
  return type === 'function';
}

/**
 * The fixed arity of a callable type: 1 for a unary function, 2 for a binary
 * one, or `undefined` when the arity is not statically a single fixed value —
 * a bare `function` type, a variadic or optional-argument signature, a
 * non-callable type, or a union/intersection whose arms disagree.
 *
 * For a union/intersection every arm must be fixed-arity AND agree, since a
 * caller keying behavior off the arity (e.g. `Sort`'s unary-key vs. binary-
 * comparator dispatch) must not guess which arm applies.
 */
export function functionArity(
  type: Readonly<Type> | undefined
): number | undefined {
  // The top `function` type promises callers nothing about arity.
  if (type === 'function') return undefined;
  const arms = signatureArms(type);
  if (!arms) return undefined;

  let arity: number | undefined;
  for (const sig of arms) {
    // Variadic or optional arguments make the arity ambiguous.
    if (sig.variadicArg || (sig.optArgs && sig.optArgs.length > 0))
      return undefined;
    const n = sig.args?.length ?? 0;
    if (arity === undefined) arity = n;
    else if (arity !== n) return undefined;
  }
  return arity;
}

/**
 * The type an application of `type` yields, without reference to the actual
 * arguments. `undefined` when `type` is not callable.
 *
 * For a union or intersection of signatures this is the **join** (`widen`) of
 * the arms' results — never the meet. Consider
 * `((integer) -> integer) & ((string) -> string)`: `f(3)` is an `integer` and
 * `f("a")` is a `string`, so an unspecified application yields
 * `integer | string`. The meet would be `integer & string` — an empty type,
 * and plainly wrong. (Narrowing is only sound when every arm shares a domain,
 * a special case not worth encoding; the join stays sound there, just less
 * precise.) When the *arguments* are known, do not use this — resolve the
 * overload and read the selected arm's result
 * (`boxed-expression/overload.ts`).
 *
 * The bare `function` type yields `unknown`, not `any`: it carries no
 * information about the result, and `unknown` is this system's "not known"
 * signal — notably `infer()` treats inferring `unknown` as a no-op
 * (`boxed-symbol.ts`), whereas `any` would be written into a definition as a
 * positive claim. It also matches the `(any*) -> unknown` shape the old
 * `functionSignature` synthesized for `function`, which `functionResult`
 * contradicted by answering `any`.
 */
export function functionResult(
  type: Readonly<Type> | undefined
): Type | undefined {
  if (!type) return undefined;
  if (type === 'function') return 'unknown';
  const arms = signatureArms(type);
  if (!arms) return undefined;
  // A POLYTYPE arm's declared result is OPEN — it is a pattern, not a type
  // (`(T) -> T where T` results in `T`). An open type must never escape as
  // an expression's `.type` (§4.2 ground invariant of the type-variables
  // design), and this function is read by a dozen library `type:` handlers
  // that pass it straight through (`Map(genericFn, xs)`). Callers that CAN
  // instantiate — argument validation and the two result-typing sites — solve
  // the arm at the call site and override this; everyone else gets the honest
  // `unknown`.
  const armResult = (a: FunctionSignature): Type =>
    a.typeParams !== undefined && a.typeParams.length > 0
      ? 'unknown'
      : a.result;
  if (arms.length === 1) return armResult(arms[0]);
  return widen(...arms.map(armResult));
}

/**
 * Is `t` the type of a POINT: the bare `tuple`, a parameterized tuple, or a
 * union whose every arm is one of those? A collection whose element type is
 * such a union — `list<tuple<integer, number> | tuple<number, integer>>`,
 * which is what a list literal of two tuple spellings infers — holds points
 * in every element, exactly as `list<tuple<number, number>>` does, so the
 * point accessors must read both the same way. Transparent aliases are
 * unfolded; a nominal reference stays opaque and is not a point.
 *
 * The union walk recurses into the arms, so an alias is unfolded through
 * {@link unfoldAliasOnDescent}: a self-referential alias such as
 * `type alias cyc = cyc | tuple<number, number>` reaches itself through an
 * arm, and unfolding it afresh at every level would never end. An arm whose
 * allowance on the current path is spent contributes no members, so it
 * answers `false` — the conservative reading for a union arm.
 */
export function isPointElementType(
  t: Readonly<Type> | undefined,
  seen: AliasDescent = undefined
): boolean {
  if (t === undefined) return false;
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return false;
  const resolved = unfolded.type;
  if (resolved === 'tuple') return true;
  if (typeof resolved === 'string') return false;
  if (resolved.kind === 'tuple') return true;
  if (resolved.kind === 'union')
    return (
      resolved.types.length > 0 &&
      resolved.types.every((arm) => isPointElementType(arm, unfolded.seen))
    );
  return false;
}

// Bare family names place no constraint on their contents. Entry iteration
// of a dictionary or an open record still exposes a key/value tuple.
export function collectionElementType(type: Readonly<Type>): Type | undefined {
  // A transparent alias of a collection IS that collection, so its elements
  // are the body's elements: `At(L, 1)` for `L: myints` (an alias of
  // `list<integer>`) yields an integer, and the broadcast lift reads the
  // same cell type through `broadcastElementType`. A nominal reference is
  // not unfolded (it is deliberately not a subtype of its definition) and
  // answers `undefined`, as it did before.
  type = resolveTypeAlias(type);
  if (type === 'collection') return 'any';
  if (type === 'indexed_collection') return 'any';
  if (type === 'list') return 'any';
  // An index span is the ONE unparameterized case whose element type is
  // genuinely known: its members are finite positive integers. That is a fact
  // about `range`, not an absence of one, so it stays concrete. (`unknown`
  // would be sound but would lose the precision `Range` had before the
  // `range` type existed, when it typed as `indexed_collection<integer>`.)
  if (type === 'range') return 'integer';
  // A string's elements are its grapheme clusters, so — like `range` — its
  // element type is genuinely KNOWN rather than absent. See
  // `STRING_STRUCTURAL_TYPE` (`primitive.ts`).
  if (type === 'string') return 'character';
  if (type === 'set') return 'any';
  if (type === 'tuple') return 'any';
  if (type === 'dictionary' || type === 'record')
    return { kind: 'tuple', elements: [{ type: 'string' }, { type: 'any' }] };
  if (typeof type === 'string') return undefined;

  if (type.kind === 'collection' || type.kind === 'indexed_collection')
    return type.elements;

  // A plain list `list<E>` yields `E`. A tensor with a dimension list
  // yields its cells at rank 1 and its rows (a tensor with one axis fewer)
  // at rank 2 or more: one index into a `matrix<2x2>` is a `vector<2>`. A
  // tensor of unknown rank `tensor<U>` yields a cell or a tensor,
  // `U | tensor<U>`. (`listElementType`, `subtype.ts`.)
  if (type.kind === 'list') return listElementType(type);

  if (type.kind === 'set') return type.elements;

  // A `broadcastable<T>` is a `T` or its collection arm
  // (`broadcastCollectionArm`). The elements of the arm are `T` for a
  // plain `list<T>`, and `T | tensor<T>` for the `tensor<T>` of a numeric
  // `T`; the scalar reading adds nothing to either. (What an INDEX returns
  // also includes the elements of a `T` that can hold a list or can be
  // indexed, such as a tuple or a string: that reading is
  // `indexElementType`, which only the element readers use.)
  if (type.kind === 'broadcastable')
    return listElementType(broadcastCollectionArm(type.elements));

  if (type.kind === 'tuple') {
    const slots = type.elements.map((x) => x.type);
    // The slots are a value's cells: an `unknown` slot beside absence
    // markers only is kept as an arm (`joinUnresolvedArm`), so
    // `tuple<unknown, missing>` reads `missing | unknown`, not `missing`;
    // beside value slots it reads as those values (`(1, x)` with a free
    // `x` stays numeric).
    const joined = joinUnresolvedArm(slots, true);
    // Evidence widening absorbs Nothing; reading tuple slots must preserve it.
    return !provablyAdmits('nothing', joined) &&
      slots.some((t) => provablyAdmits('nothing', t))
      ? {
          kind: 'union',
          types: [
            ...(typeof joined === 'object' && joined.kind === 'union'
              ? joined.types
              : [joined]),
            'nothing',
          ],
        }
      : joined;
  }

  if (type.kind === 'dictionary')
    return parseType(`tuple<string, ${typeToString(type.values)}>`);

  // A record type is open: `record{a: integer}` matches `{a: 1, b: Missing}`,
  // a value with fields it does not declare, of any type. An entry of such a
  // value is `("b", Missing)`, so the entry type is `tuple<string, any>`,
  // not the join of the declared fields: with that join, `FlatMap(ra, x ↦
  // [At(x, 2)])` refused the entry `("b", Missing)` with an
  // `incompatible-type` error. (CE-77)
  if (type.kind === 'record')
    return {
      kind: 'tuple',
      elements: [{ type: 'string' }, { type: 'any' }],
    };
  return undefined;
}

/**
 * The type of the values of a dictionary VALUE whose type is `t`: the join
 * of its field types when `t` is a record type, the value type of a
 * `dictionary<V>`, otherwise `undefined`.
 *
 * Only for the type of a dictionary value itself, never for a declared type.
 * The callers decide which types those are: a dictionary literal, or a symbol
 * whose type was inferred from the dictionary it holds
 * (`closedDictionaryType()`, `boxed-expression/generic-instantiation.ts`).
 * The type of a dictionary value is
 * the record of exactly the fields it has (`BoxedDictionary`), so the join of
 * those fields holds every value. A declared record type is open
 * (`collectionElementType()` gives `tuple<string, any>` for its entries).
 * (CE-77)
 */
export function dictionaryValueValuesType(
  t: Readonly<Type>
): Type | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'dictionary') return t.values;
  if (t.kind === 'record') return widen(...Object.values(t.elements));
  return undefined;
}

/**
 * What one index into a value of the type `t` returns: the type of the
 * element readers (`At` with a scalar index, the elements of the list that
 * `At` with a gather index returns, `First`, `Second`, `Third`, `Last`, and
 * the elements of the list that `Take`, `Drop`, `Rest`, `Most` and `Slice`
 * return). It is
 * {@link collectionElementType}, except for a `broadcastable<T>` whose `T`
 * can hold a list or can be indexed (a tuple, a string, a record, a
 * dictionary).
 *
 * A `broadcastable<T>` is a `T` or a list of `T`. When `T` can hold a list
 * (`vector<2>`), a value of the `T` arm is itself a list, and one index into
 * it returns an element of `T`. So an index into `broadcastable<vector<2>>`
 * (the type of `g(x)` for `g(t) = [t, 2t]` and an `x` that can be a number
 * or a list) returns `number | vector<2>`: a number when the value is one
 * vector, a vector when it is a list of vectors.
 *
 * A tuple or a string is one cell for broadcasting (the collection arm of
 * `broadcastable<tuple<number, number>>` is `tensor<tuple<number, number>>`),
 * but an index into a value of the `T` arm still reads that value: `At(p,
 * 1)` is `1` for `p = (1, 2)` and the character `"a"` for `p = "abc"`. So
 * an index into `broadcastable<tuple<number, number>>` returns
 * `number | tuple<number, number> | tensor<tuple<number, number>>`, and an
 * index into `broadcastable<string>` returns
 * `character | string | tensor<string>`.
 *
 * This is not the element type that the other readers use
 * (`collectionElementType`): a compile gate or an aggregate (`Sum`, `Max`,
 * `Reduce`) that reads the elements of `broadcastable<vector<2>>` as
 * vectors maps over the collection arm, and reading them as
 * `number | vector<2>` made it combine a vector and a number.
 */
export function indexElementType(t: Readonly<Type>): Type | undefined {
  return indexElementTypeOnDescent(t as Type, undefined);
}

/**
 * {@link indexElementType} under the alias descent guard `seen`. A union
 * (`matrix<2x2> | missing | vector<2>`, an index into a
 * `broadcastable<matrix<2x2>>`) is read arm by arm: a `missing` or
 * `nothing` arm is an absent value, which has no element, and is skipped;
 * the element types of the other arms are joined. When an arm has no
 * element type (a number), the union has none either (`undefined`), as
 * `collectionElementType` answers for a union.
 */
function indexElementTypeOnDescent(
  t: Type,
  seen: AliasDescent
): Type | undefined {
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return undefined;
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union') {
    const present = r.types.filter((arm) => {
      const a = resolveTypeAlias(arm);
      return a !== 'missing' && a !== 'nothing';
    });
    if (present.length === 0) return undefined;
    let result: Type | undefined;
    for (const arm of present) {
      const e = indexElementTypeOnDescent(arm, unfolded.seen);
      if (e === undefined) return undefined;
      result = result === undefined ? e : joinIndexElementTypes(result, e);
    }
    return result;
  }
  return broadcastableIndexElementTypeOf(r) ?? collectionElementType(r);
}

/**
 * {@link indexElementType} when it differs from `collectionElementType`:
 * for a `broadcastable<T>` (or a transparent alias of one) whose `T` can
 * hold a list, or whose `T` cannot hold a list but can be indexed (a
 * tuple, a string, a record, a dictionary, or a union with such an arm).
 * `undefined` for every other type, a `broadcastable<number>` included. A
 * reader that has a more precise element type from another source (the
 * `elttype` handler of the operand) uses that source only when this
 * function answers `undefined`.
 */
export function broadcastableIndexElementTypeOf(
  t: Readonly<Type>
): Type | undefined {
  const unfolded = unfoldAliasOnDescent(t, undefined);
  if (unfolded === undefined) return undefined;
  const r = unfolded.type;
  if (typeof r === 'string' || r.kind !== 'broadcastable') return undefined;
  if (
    cannotHoldAList(r.elements) &&
    ownElementsOfBroadcastCell(r.elements, unfolded.seen) === undefined
  )
    return undefined;
  return broadcastableIndexElementType(r.elements, unfolded.seen);
}

/**
 * What one index into a value of `broadcastable<cells>` returns (see
 * {@link indexElementType}): the elements of the collection arm, joined
 * with what one index into a value of the `cells` arm returns
 * (`ownElementsOfBroadcastCell`). A `cells` that can be indexed adds its
 * own elements whether or not it can hold a list: the slots of a tuple,
 * the characters of a string. A `cells` that cannot be indexed (a number,
 * a boolean) adds nothing. `seen` is the alias descent of the walk
 * (`unfoldAliasOnDescent`).
 */
function broadcastableIndexElementType(cells: Type, seen: AliasDescent): Type {
  const armElements = listElementType(broadcastCollectionArm(cells));
  const own = ownElementsOfBroadcastCell(cells, seen);
  return own === undefined
    ? armElements
    : joinIndexElementTypes(own, armElements);
}

/**
 * What one index into a value of the type `t` returns, when `t` is the cell
 * type of a `broadcastable<t>`, or `undefined` when a value of `t` adds no
 * element that the collection arm does not give.
 *
 * - A transparent alias is unfolded under the descent guard: a recursive
 *   alias (`type alias R = broadcastable<R>`) is cut at its third unfold on
 *   one path, and the cut answers the alias itself.
 * - A union is read arm by arm, and the elements of the arms that add some
 *   are joined: for `vector<2> | missing` (the cells of `h(x)` for
 *   `h(t) = When([t, 2t], t > 0)`), the elements are `number`.
 * - A nested `broadcastable<U>` adds what an index into it returns.
 * - A type that cannot hold a list adds what an index into it returns
 *   (`ownElementsOfIndexableCell`): the slots of a tuple, the characters
 *   of a string, the values of a record or a dictionary. A number, a
 *   boolean or an absence marker adds nothing.
 * - Another type adds its element type (`collectionElementType`). A type
 *   with no element type (`any`, a type variable) adds nothing.
 */
function ownElementsOfBroadcastCell(
  t: Type,
  seen: AliasDescent
): Type | undefined {
  const unfolded = unfoldAliasOnDescent(t, seen);
  // At the cut the alias answers itself: a value of
  // `type alias R = broadcastable<R>` is an `R` or a list of `R`, so its
  // elements are `R`s.
  if (unfolded === undefined) return t;
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union') {
    let result: Type | undefined;
    for (const arm of r.types) {
      const own = ownElementsOfBroadcastCell(arm, unfolded.seen);
      if (own === undefined) continue;
      result = result === undefined ? own : joinIndexElementTypes(result, own);
    }
    return result;
  }
  if (typeof r !== 'string' && r.kind === 'broadcastable')
    return broadcastableIndexElementType(r.elements, unfolded.seen);
  if (cannotHoldAList(r)) return ownElementsOfIndexableCell(r);
  return collectionElementType(r);
}

/**
 * What one index into a value of the type `t` returns, for a `t` that
 * cannot hold a list (`cannotHoldAList`) and is not a union: the join of
 * the slot types of a tuple, `character` for a string, the join of the
 * field types of a record (an `unknown` field is kept as an arm, as for
 * the cells of a value: a field `a: unknown` can hold a string beside a
 * field `b: integer`), and the value type of a dictionary (an index
 * into a record or a dictionary is a key, which reads a value; the
 * iteration pair that `collectionElementType` gives for them is not what
 * an index returns). `undefined` for a type that cannot be indexed: a
 * number, a boolean, a set, a function, `missing`, `nothing`, `never`.
 */
function ownElementsOfIndexableCell(t: Type): Type | undefined {
  if (t === 'never' || t === 'nothing' || t === 'missing') return undefined;
  if (t === 'tuple' || (typeof t !== 'string' && t.kind === 'tuple'))
    return collectionElementType(t);
  if (t === 'record' || t === 'dictionary') return 'any';
  if (typeof t !== 'string' && t.kind === 'record') {
    const fields = Object.values(t.elements);
    return fields.length === 0 ? undefined : joinUnresolvedArm(fields);
  }
  if (typeof t !== 'string' && t.kind === 'dictionary') return t.values;
  if (isSubtype(t, 'string')) return 'character';
  return undefined;
}

/**
 * The join of the element types `a` and `b` of two readings of one value.
 * When one holds the other, it is kept. An `unknown` or `any` element type
 * does not absorb the other one: the two are kept as a union
 * (`list<unknown> | unknown` for an index into `broadcastable<list<unknown>>`),
 * so that a reader still sees the list arm and adds its absence marker
 * (`widen` would also drop an `unknown` arm). A `nothing` arm is kept too:
 * `widen` absorbs it, but a slot of a tuple can hold `Nothing`, so one
 * index into `broadcastable<tuple<nothing, nothing>>` holding
 * `(Nothing, Nothing)` is `Nothing`.
 */
function joinIndexElementTypes(a: Type, b: Type): Type {
  if (a === b) return a;
  if (a === 'unknown' || a === 'any' || b === 'unknown' || b === 'any')
    return { kind: 'union', types: [b, a] };
  if (isSubtype(b, a)) return a;
  if (isSubtype(a, b)) return b;
  const joined = widen(a, b);
  if (
    provablyAdmits('nothing', joined) ||
    (!provablyAdmits('nothing', a) && !provablyAdmits('nothing', b))
  )
    return joined;
  return {
    kind: 'union',
    types: [
      ...(typeof joined === 'object' && joined.kind === 'union'
        ? joined.types
        : [joined]),
      'nothing',
    ],
  };
}

/**
 * The transparent-alias declarations a structural descent has already
 * unfolded on its current path, each with how many times. `undefined` until
 * the first unfold, so a walk over ordinary types allocates nothing.
 */
export type AliasDescent = ReadonlyMap<TypeReference, number> | undefined;

/**
 * How many times one declaration may be unfolded on one path of a
 * structural descent before the descent cuts it.
 *
 * Two, not one. The answer for a recursive occurrence of an alias is what
 * the alias's NON-recursive arms give — the least fixed point — and a walk
 * meets those arms only by unfolding the alias once more:
 * `type alias json = list<json> | integer` has numeric elements because of
 * its `integer` arm, which the element walk reaches on the SECOND unfold
 * (the first unfold, from the collection walk, descended into `list<json>`).
 * The third occurrence is the cut: by then every non-recursive arm has been
 * seen from both entry points of a walk (a collection kind and its element),
 * so unfolding again can only repeat the same two steps.
 */
const ALIAS_UNFOLDS_PER_PATH = 2;

/**
 * Record one unfold of the declaration `decl` on a descent path: the
 * descent to hand to the recursive calls, or `undefined` when the
 * declaration has spent its allowance on this path and the descent must cut
 * (see {@link unfoldAliasOnDescent}). Sibling arms never share a path — the
 * map is copied, never mutated — so an alias met in two arms of a union is
 * not a cycle. Exported for the one walker that unfolds NOMINAL references
 * too (`mayHoldAnIndexedCollection`, `collection-utils.ts`) and so cannot use
 * the alias-only helper.
 */
export function recordUnfoldOnDescent(
  decl: TypeReference,
  seen: AliasDescent
): AliasDescent | undefined {
  const count = seen?.get(decl) ?? 0;
  if (count >= ALIAS_UNFOLDS_PER_PATH) return undefined;
  const next = new Map(seen);
  next.set(decl, count + 1);
  const bare =
    seen === undefined ? undefined : BARE_SINCE_CONSTRUCTOR.get(seen);
  BARE_SINCE_CONSTRUCTOR.set(next, new Set(bare).add(decl));
  return next;
}

/**
 * For each descent, the declarations it unfolded since the walk last
 * entered a constructor (a list element, a tuple component, …). A walk
 * that calls {@link descendIntoConstructor} when it enters a constructor
 * can then tell the two kinds of cut apart ({@link isBareCutOnDescent}).
 * Keyed by the descent map, so the type of a descent stays a plain map.
 */
const BARE_SINCE_CONSTRUCTOR = new WeakMap<
  ReadonlyMap<TypeReference, number>,
  ReadonlySet<TypeReference>
>();

/**
 * The descent to hand to a recursive call that enters a constructor: a
 * list, set or collection element, a tuple component, a record field, a
 * dictionary value. The unfold counts are kept, and no declaration is bare
 * any more (see {@link isBareCutOnDescent}).
 */
export function descendIntoConstructor(seen: AliasDescent): AliasDescent {
  if (seen === undefined || !BARE_SINCE_CONSTRUCTOR.has(seen)) return seen;
  return new Map(seen);
}

/**
 * Whether the descent guard cuts `t` on this path: `t` is a transparent
 * alias that has spent its unfolds (see {@link unfoldAliasOnDescent}).
 * Allocates nothing, unlike a call of `unfoldAliasOnDescent` used as a
 * yes/no test.
 */
export function isCutOnDescent(t: Readonly<Type>, seen: AliasDescent): boolean {
  if (
    seen === undefined ||
    typeof t !== 'object' ||
    t.kind !== 'reference' ||
    t.alias !== true ||
    t.def === undefined
  )
    return false;
  return (seen.get(declarationOf(t)) ?? 0) >= ALIAS_UNFOLDS_PER_PATH;
}

/**
 * Whether the descent guard cuts `t` here (see {@link isCutOnDescent}) AND
 * the walk entered no constructor since it last unfolded the same alias. The
 * alias then reaches itself as a bare arm of its own union (the `cyc` arm of
 * `type alias cyc = cyc | tuple<number, number>`, possibly inside a nested
 * union): the occurrence adds no value of its own, so a walk may drop it,
 * or keep it unchanged, and its answer stays exact.
 *
 * A cut that is not bare was reached through a constructor (the `a` inside
 * `type alias a = list<a | integer> | missing`): it stands for values deeper
 * in the structure, which the walk has not read at that depth. Dropping it
 * loses those values, and keeping it unchanged under a rewrite that changes
 * the leaves keeps the old leaves. A walk must answer soundly there: keep
 * the reference when it rewrites nothing, or widen. This test is reliable
 * only in a walk that calls {@link descendIntoConstructor} whenever it
 * enters a constructor.
 */
export function isBareCutOnDescent(
  t: Readonly<Type>,
  seen: AliasDescent
): boolean {
  if (!isCutOnDescent(t, seen)) return false;
  const bare = BARE_SINCE_CONSTRUCTOR.get(seen!);
  return bare?.has(declarationOf(t as TypeReference)) === true;
}

/**
 * Unfold a transparent alias for a STRUCTURAL DESCENT — a walk that reads
 * the body's parts (list elements, union arms, tuple components) and
 * recurses into them.
 *
 * {@link resolveTypeAlias} guards only the reference CHAIN inside one call.
 * A walk that recurses into the unfolded body meets the same alias again
 * when the alias is self-referential — `type alias nest = list<nest>`
 * reaches itself through a constructor, `type alias cyc = cyc | 0` through a
 * bare union arm — and each recursive call would unfold it afresh, forever
 * (`RangeError: Maximum call stack size exceeded` out of `.type`). The
 * descent `seen` counts the unfolds of each declaration on the current
 * PATH ({@link recordUnfoldOnDescent}). Only the outermost declaration of a
 * chain is recorded: a chain cannot reach back to a later declaration (a
 * type name must exist before it is referenced), so every cycle closes
 * through a declaration that names itself, which is the one recorded.
 *
 * Returns `undefined` when `t` is an alias whose allowance on this path is
 * spent: the alias reaches itself, and the caller stops with its
 * conservative answer — the occurrence contributes no members (`false` for
 * a COULD predicate, `null` for a shape, the type unchanged for a rewrite).
 * Otherwise returns the unfolded type and the descent to hand to every
 * recursive call. A type that is not a transparent alias comes back
 * unchanged, with the same descent.
 */
export function unfoldAliasOnDescent(
  t: Readonly<Type>,
  seen: AliasDescent
): { type: Type; seen: AliasDescent } | undefined {
  if (
    typeof t !== 'object' ||
    t.kind !== 'reference' ||
    t.alias !== true ||
    t.def === undefined
  )
    return { type: t as Type, seen };
  const next = recordUnfoldOnDescent(declarationOf(t), seen);
  if (next === undefined) return undefined;
  return { type: resolveTypeAlias(t), seen: next };
}

/**
 * The number of TOP-LEVEL elements a value of this type must have, when the
 * type alone pins it; `undefined` when it does not.
 *
 * "Top-level" matches the `count` contract on an expression: a `matrix<3x4>`
 * counts its 3 rows, not its 12 scalar entries, the same way `each()` and
 * `at()` walk rows. A `tuple` counts its declared members. A `list<T>` or
 * `set<T>` carries no length, so it stays `undefined`.
 *
 * Purely a question about the TYPE: it says nothing about whether a value
 * exists or whether its elements can be produced. Deciding what to do with
 * that is the caller's; see `BoxedSymbol.count`, which uses it as the
 * fallback for a declared-but-unassigned symbol.
 */
export function typeElementCount(type: Readonly<Type>): number | undefined {
  return typeElementCountGuarded(type, undefined);
}

/**
 * {@link typeElementCount}, carrying the cycle guard the union arm needs.
 *
 * `resolveTypeForCompilation` guards its own reference CHAIN, but that guard is
 * local to one call and its loop never descends into a union's members — safe
 * for it, not for us. Recursing into union arms re-enters it with a fresh
 * guard, so a self-referential alias whose recursive occurrence is a bare arm
 * (`type selfu = selfu | integer`) unfolds back to the same union forever and
 * overflows the stack. The set below is threaded THROUGH the arm recursion so
 * re-entering a declaration already being unfolded answers `undefined` instead.
 *
 * Entries are removed on the way back out (a depth-first mark, not a permanent
 * one) so that a legitimate DIAMOND still answers: both arms of
 * `pair | pair` resolve independently and agree, rather than the second arm
 * being refused because the first visited the same declaration.
 */
function typeElementCountGuarded(
  type: Readonly<Type>,
  seen: Set<unknown> | undefined
): number | undefined {
  let decl: unknown;
  if (
    typeof type === 'object' &&
    type.kind === 'reference' &&
    type.def !== undefined
  ) {
    decl = declarationOf(type as TypeReference);
    if (seen?.has(decl)) return undefined;
  }

  const t = resolveTypeForCompilation(type);
  if (typeof t === 'string') return undefined;

  // A declared-dimension list: `vector<2>` is `dimensions: [2]`, and
  // `matrix<3x4>` is `dimensions: [3, 4]` whose top-level elements are its
  // rows, so the FIRST dimension is the count in both cases. A `list<T>`
  // parses without `dimensions` and keeps an unknown length, and an unsized
  // dimension is the sentinel `-1` (`matrix` is `[-1, -1]`), never a length.
  if (t.kind === 'list') {
    const dims = t.dimensions;
    if (dims && dims.length > 0 && Number.isInteger(dims[0]) && dims[0] >= 0)
      return dims[0];
    return undefined;
  }

  if (t.kind === 'tuple') return t.elements.length;

  // A union still pins the size when every arm does and they agree: every
  // value of `vector<2> | tuple<number, number>` has two top-level elements,
  // whichever arm it came from. One arm that is unsized, or any disagreement,
  // makes the whole union unknown.
  if (t.kind === 'union') {
    const guard = seen ?? new Set<unknown>();
    if (decl !== undefined) guard.add(decl);
    try {
      let count: number | undefined = undefined;
      for (const arm of t.types) {
        const n = typeElementCountGuarded(arm, guard);
        if (n === undefined) return undefined;
        if (count === undefined) count = n;
        else if (count !== n) return undefined;
      }
      return count;
    } finally {
      if (decl !== undefined) guard.delete(decl);
    }
  }

  return undefined;
}

export function isValidTypeName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * The type a **representation** question should be answered from
 * (`docs/TYPE-SYSTEM.md` step 1).
 *
 * Compilation is type erasure: the nominal/structural distinction is static
 * information, fully discharged by the checker before any code is emitted, so
 * *layout* questions — is this numeric? how many vector components? is it a
 * tuple? — must be answered by a type reference's DEFINITION, for aliases and
 * nominal types alike. Admissibility is a different question and stays opaque
 * for a nominal type (D3, `isSubtype`); this helper is only ever used where the
 * compiler is asking about layout.
 *
 * A non-reference type is returned unchanged (identity for the overwhelming
 * majority of calls), so this is safe to drop in at any compile type gate. An
 * unresolved reference (`def === undefined`) is returned as-is: nothing is
 * known about its layout, and every gate already treats an unrecognized type
 * conservatively.
 *
 * A self-referential alias (`type alias json = list<json> | integer`) must not
 * spin, so the walk is cycle-guarded: it remembers the reference RECORDS it has
 * unfolded (the resolver hands back the same stable object for every occurrence
 * of a name, so identity is the cycle test) and stops on the first repeat,
 * returning that reference unresolved. An ACYCLIC chain of references unfolds
 * to its body no matter how long. The guard state is local to this call — the
 * loop is flat, so there is no re-entrancy to reason about, and no guard state
 * is shared with `subtype.ts` (which must not import this module). The set is
 * allocated only once a reference is actually unfolded, so the identity path
 * (a non-reference type) allocates nothing.
 *
 * An APPLIED reference to a parameterized nominal type
 * (`docs/TYPE-SYSTEM.md`) unfolds to
 * its definition INSTANTIATED at the application's arguments: `tree<integer>`
 * erases to whatever `tuple<value: integer, children: list<tree<integer>>>`
 * compiles to, and declines identically where that would. Without the
 * substitution the compiler would meet the declaration's bare type variables
 * and answer every layout question about `T` instead of about `integer`.
 * The cycle guard keys on the DECLARATION record (`declarationOf`), not on the
 * application: substitution rebuilds an application, so the fresh object would
 * defeat an identity guard on the node itself. For an unparameterized reference
 * the record IS the node, so the existing behavior is unchanged.
 */
export function resolveTypeForCompilation(t: Readonly<Type>): Type {
  let seen: Set<TypeReference> | undefined;
  let result: Type = t as Type;
  while (
    typeof result === 'object' &&
    result.kind === 'reference' &&
    result.def !== undefined
  ) {
    seen ??= new Set();
    const decl = declarationOf(result);
    if (seen.has(decl)) return result;
    seen.add(decl);
    const typeParams = decl.typeParams;
    const args = result.args;
    if (args !== undefined && typeParams !== undefined) {
      const bindings: Record<string, Type> = Object.create(null);
      for (let i = 0; i < typeParams.length; i++)
        if (args[i] !== undefined) bindings[typeParams[i].name] = args[i];
      result = substituteTypeVariables(result.def, bindings);
    } else result = result.def;
  }
  return result;
}

/**
 * The type an **admissibility** question should be answered from: a chain of
 * TRANSPARENT alias references unfolded down to the body it names.
 *
 * A transparent alias (`ce.declareType(name, body, { alias: true })`) IS its
 * definition, so a value typed by the alias is admissible exactly where a
 * value of the body is — `isSubtype` unfolds such a reference on both sides
 * for that reason. A structural gate that inspects a type's KIND directly
 * ("is this a tuple?", "is this a numeric collection?") bypasses `isSubtype`,
 * so without unfolding first it sees an opaque `reference` node and answers
 * "no": an alias of `tuple<number, number>` was refused by the arithmetic
 * operand gate while an alias of `number` — decided through `isSubtype` —
 * was accepted.
 *
 * A NOMINAL reference is returned UNCHANGED: a nominal type is deliberately
 * not a subtype of its definition, so a gate deciding admissibility must keep
 * seeing the reference and refuse. That is the difference from
 * {@link resolveTypeForCompilation}, which unfolds nominal references too
 * because compilation asks about LAYOUT — a question type erasure has already
 * settled — rather than about what is allowed.
 *
 * A non-reference type is returned unchanged, so this is safe to drop in at
 * the head of any structural gate. The walk is cycle-guarded on the reference
 * RECORDS it has unfolded, so a self-referential alias
 * (`type alias json = list<json> | integer`) stops on the first repeat and
 * returns that reference unresolved instead of spinning; an acyclic chain
 * unfolds all the way to its body no matter how long. The guard set is
 * allocated only once a reference is actually unfolded.
 */
export function resolveTypeAlias(t: Readonly<Type>): Type {
  let seen: Set<TypeReference> | undefined;
  let result: Type = t as Type;
  while (
    typeof result === 'object' &&
    result.kind === 'reference' &&
    result.alias === true &&
    result.def !== undefined
  ) {
    seen ??= new Set();
    const decl = declarationOf(result);
    if (seen.has(decl)) return result;
    seen.add(decl);
    // A generic alias is expanded eagerly when the type is built, so an
    // applied alias reference is not expected here; substituting anyway keeps
    // the unfold correct if one is ever constructed directly.
    const typeParams = decl.typeParams;
    const args = result.args;
    if (args !== undefined && typeParams !== undefined) {
      const bindings: Record<string, Type> = Object.create(null);
      for (let i = 0; i < typeParams.length; i++)
        if (args[i] !== undefined) bindings[typeParams[i].name] = args[i];
      result = substituteTypeVariables(result.def, bindings);
    } else result = result.def;
    // A union arm that is the alias itself (or an alias already unfolded on
    // this walk) adds no value to the union: `cyc = cyc | list<integer>`
    // holds the values of `list<integer>` and nothing else. So such arms are
    // removed, and the walk goes on with the other arms. Without this,
    // `cyc` resolved to `cyc | list<integer>`, and a reader of the arms (the
    // source type of `Map`) met the unresolved `cyc` arm again. When no other
    // arm remains (`c = c | c`), the union is kept as it is.
    if (typeof result === 'object' && result.kind === 'union') {
      const visited = seen;
      const others = result.types.filter(
        (arm) =>
          !(
            typeof arm === 'object' &&
            arm.kind === 'reference' &&
            arm.alias === true &&
            arm.def !== undefined &&
            visited.has(declarationOf(arm))
          )
      );
      if (others.length > 0 && others.length < result.types.length)
        result =
          others.length === 1 ? others[0] : { kind: 'union', types: others };
    }
  }
  return result;
}

/**
 * The top type (`unknown`, `any` or `value`) of a union whose other branches
 * are only the absence markers `missing` and `nothing`, or `undefined` for
 * any other type. A transparent alias is unfolded, the union and each of its
 * branches.
 *
 * An index into a list whose elements are typed `unknown` has such a type:
 * with `g: (unknown) -> list<unknown>` and `x: any`, `g(x)[1]` is typed
 * `missing | unknown`, and its value is a list when `x` is a list (the call
 * maps over it). The absence branches do not change what a present value can
 * be, so the readers that ask whether an operand may be a collection read
 * such a type as its top type. Without this, they read the union only by its
 * `broadcastable` branches, and took the element for a scalar: compiled
 * `g(x)[1] + 1` added `1` to an array with the JavaScript `+` and gave the
 * string `"1,21"` at `x = [1, 2]`.
 */
export function topTypeBesideAbsence(
  t: Readonly<Type>
): 'unknown' | 'any' | 'value' | undefined {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return undefined;
  let top: 'unknown' | 'any' | 'value' | undefined;
  for (const branch of r.types) {
    const b = resolveTypeAlias(branch);
    if (b === 'unknown' || b === 'any' || b === 'value') top ??= b;
    else if (b !== 'missing' && b !== 'nothing') return undefined;
  }
  return top;
}

/**
 * Can a `Block` local of type `t` hold a list? A local takes its type from
 * the value assigned to it, and that value may be a list when the type is
 * `any` or `value`, or a top type beside absence markers only
 * (`missing | unknown`, the type of an index into a `list<unknown>`). With
 * `g := t ↦ [t, 2t]` and `x: any`, the local `y` of
 * `Block(Assign(y, g(x)[1]), Sin(y) + 1)` is typed `missing | unknown` (or
 * `any` when `g` is declared `(unknown) -> list`), and holds `[1, 2]` at
 * `x = [1, 2]`.
 *
 * A local typed `unknown` alone is not one: it has no value yet, and the
 * arithmetic around it infers its type, as for a free variable.
 */
export function blockLocalTypeMayHoldList(t: Readonly<Type>): boolean {
  const r = resolveTypeAlias(t);
  return r === 'any' || r === 'value' || topTypeBesideAbsence(r) !== undefined;
}

/**
 * True if `t` carries a `missing` arm at any nesting level (a scalar `missing`,
 * a `T | missing` union, or a `missing` cell nested inside a list/set/
 * collection/tuple/record/dictionary). Used to gate the missing-value strip
 * (§3.B of `docs/TYPE-SYSTEM.md`) so that a
 * Missing-free program is never touched by the lift.
 *
 * The kinds this recurses into must stay the same as the kinds
 * {@link stripMissingFromType} rebuilds: a kind detected here but not stripped
 * there arms the strip and then leaves the arm in place, so the caller both
 * pays for the transform and still sees the absence arm.
 *
 * A transparent alias is read through its definition, at the top and at any
 * nested position: an alias of `missing | tuple<number, number>`, and
 * `list<…>` of that alias, carry a `missing` arm exactly as the spelled-out
 * definition does. A nominal reference is opaque and answers false. The
 * unfold runs under the descent guard (`seen`), so a self-referential alias
 * stops at its repeat instead of recursing forever.
 */
export function typeContainsMissing(
  t: Readonly<Type>,
  seen?: AliasDescent
): boolean {
  return containsPrimitive(t, (p) => p === 'missing', seen);
}

/**
 * True when a value of type `t` can be a residue class: `t` is `residue`, or
 * has a `residue` arm at some nesting level (`integer | residue`,
 * `list<residue>`, `residue | missing`), read through transparent aliases
 * as {@link typeContainsMissing} reads them. `value`, `unknown` and `any`
 * answer false: they can hold a class, but they do not say so, and the
 * arithmetic operators read them as possible numbers (`validate.ts`).
 *
 * The test that admits a class in a numeric position and that recognizes a
 * class by its type (`residue-class.ts`): a class is protected from the
 * number rules by its type, not by the name of the head that made it
 * (`docs/plans/2026-10-23-residue-class-type.md`).
 */
export function hasResidueArm(t: Readonly<Type>, seen?: AliasDescent): boolean {
  return containsPrimitive(t, (p) => p === 'residue', seen);
}

/**
 * `t` without its `residue` arm, at the top level only: `residue` is
 * `never`, `complex | infinity | residue` is `complex | infinity`, any other
 * type is itself. For a predicate that asks whether a PARAMETER is numeric
 * (the propagation of an absent operand, `boxed-operator-definition.ts`; the
 * numeric inference of free arguments, `box.ts`): the arithmetic operators
 * admit a residue class beside their numbers, and a class beside an absent
 * operand gives `NaN` as a number does, so the `residue` arm does not change
 * what those predicates decide.
 */
export function withoutResidueArm(t: Readonly<Type>): Type {
  if (t === 'residue') return 'never';
  if (typeof t === 'string' || t.kind !== 'union') return t;
  if (!t.types.includes('residue')) return t;
  const rest = t.types.filter((x) => x !== 'residue');
  if (rest.length === 0) return 'never';
  if (rest.length === 1) return rest[0];
  return { kind: 'union', types: rest };
}

/**
 * `t` without its `residue` arms at every level: the top level
 * ({@link withoutResidueArm}), the cells of a list, a set or a collection
 * (`list<integer | residue>` is `list<integer>`, `list<residue>` is
 * `list<never>`), the components of a tuple, and the arms of a union of
 * them. For the type handlers of the arithmetic operators, which type the
 * numeric answer over the operands read without their classes
 * (`library/arithmetic.ts`).
 */
export function withoutResidueArmDeep(t: Readonly<Type>): Type {
  const top = withoutResidueArm(t);
  if (typeof top === 'string') return top;
  switch (top.kind) {
    case 'union':
      return { ...top, types: top.types.map(withoutResidueArmDeep) };
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable': {
      const elements = withoutResidueArmDeep(top.elements);
      return elements === top.elements ? top : { ...top, elements };
    }
    case 'tuple':
      return {
        ...top,
        elements: top.elements.map((e) => ({
          ...e,
          type: withoutResidueArmDeep(e.type),
        })),
      };
    default:
      return top;
  }
}

/**
 * Whether no value of type `t` is left once its `residue` arms are removed
 * ({@link withoutResidueArmDeep}): `t` is `never` or `nan`, or a collection
 * or a tuple with such a cell. The values of such a type are residue
 * classes, or collections of them, for certain.
 */
export function isUninhabitedWithoutResidue(t: Readonly<Type>): boolean {
  const rest = withoutResidueArmDeep(t);
  const uninhabited = (x: Readonly<Type>): boolean => {
    if (x === 'never' || x === 'nan') return true;
    if (typeof x === 'string') return false;
    switch (x.kind) {
      case 'union':
        return x.types.every(uninhabited);
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        return uninhabited(x.elements);
      case 'tuple':
        return x.elements.some((e) => uninhabited(e.type));
      default:
        return false;
    }
  };
  return uninhabited(rest);
}

/**
 * True if a value of type `t` can hold the absence marker `Missing` at some
 * nesting level: `t` has a `missing` arm ({@link typeContainsMissing}), or
 * `any` at some position, because `any` admits the absence markers. A value
 * typed `any` or `list<any>` can be `Missing` or hold a `Missing` cell. The
 * bare collection names also permit absent contents; `unknown` and `value`
 * still exclude the named absence markers in the current type relation.
 *
 * Use it where a result type is built from what an operand can hold, so
 * that the result admits an absent element whenever the operand can carry
 * one. Use {@link typeContainsMissing} to decide whether to STRIP a
 * `missing` arm: there is nothing to strip from `any`.
 */
export function typeCouldHoldMissing(
  t: Readonly<Type>,
  seen?: AliasDescent
): boolean {
  return containsPrimitive(
    t,
    (p) =>
      p === 'missing' ||
      p === 'any' ||
      [
        'list',
        'set',
        'dictionary',
        'record',
        'tuple',
        'collection',
        'indexed_collection',
      ].includes(p),
    seen
  );
}

/** Whether `t` has, at some nesting level, a primitive type that `leaf`
 * accepts. The walk is the one of {@link typeContainsMissing}.
 *
 * `memo` holds the answer for each alias unfolded in this walk, by name: an
 * alias that two arms of a union name (`list<A^2> | list<A^3>`) is walked
 * once, not once per arm, so a chain of such aliases costs its depth and not
 * two to the power of its depth (a chain of depth 32 took minutes without
 * it, measured 2026-10-23 on `declareType()`, which asks this question for
 * every declaration through `hasResidueArm`). The registry does not change
 * during one walk, so the memo is sound for the walk; it is not kept
 * between walks. A reference with type arguments (an applied nominal type)
 * is not unfolded here, so only an alias name is a key.
 */
function containsPrimitive(
  t: Readonly<Type>,
  leaf: (p: string) => boolean,
  seen?: AliasDescent,
  memo: Map<string, boolean> = new Map()
): boolean {
  if (typeof t === 'string') return leaf(t);
  const contains = (x: Readonly<Type>) =>
    containsPrimitive(x, leaf, seen, memo);
  switch (t.kind) {
    case 'union':
    case 'intersection':
      return t.types.some(contains);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return contains(t.elements);
    case 'tuple':
      return t.elements.some((e) => contains(e.type));
    case 'dictionary':
      return contains(t.values);
    case 'record':
    case 'object':
      return Object.values(t.elements).some(contains);
    case 'reference': {
      const key = t.args === undefined ? t.name : undefined;
      if (key !== undefined) {
        const known = memo.get(key);
        if (known !== undefined) return known;
      }
      const unfolded = unfoldAliasOnDescent(t, seen);
      // A cut of the descent guard (the alias is already being unfolded
      // further up) answers `false` for this occurrence only: the answer for
      // the alias is set by the occurrence that unfolds it.
      //
      // An answer computed below a cut is kept too. With `A = B | residue`
      // and `B = list<A>`, `B` reached through `A` sees `A` cut and is kept
      // as `false`, which is wrong for `B` on its own. It does not change
      // the answer of the walk: the walk joins its answers with "or", so a
      // kept `false` is wrong only when the cut alias (`A`) ends `true`, and
      // that `true` reaches the top of the walk at once, before any later
      // occurrence of `B` is read. Not keeping an answer computed below a
      // cut made a chain of 32 aliases with a self-recursive arm
      // exponential again (measured 2026-10-23).
      if (unfolded === undefined || unfolded.type === t) return false;
      const result = containsPrimitive(
        unfolded.type,
        leaf,
        unfolded.seen,
        memo
      );
      if (key !== undefined) memo.set(key, result);
      return result;
    }
    default:
      return false;
  }
}

/**
 * The result type of a `propagate` application in which some operand cell may
 * be absent (I6 absorption, §3.0/§3.B). Every `propagate` result cell is
 * numeric, and an absent numeric cell contributes `NaN` — which is `number`
 * but not any `finite_*`/`real`/`integer` subtype (Q2). So this transform:
 *
 * - strips every `missing` arm (the arm is absorbed, never re-attached), and
 * - widens every numeric leaf to `number` (to admit the injected `NaN`),
 *
 * recursing through list/collection/tuple cells. `Sin(Missing) : number`,
 * `Add(Missing, 1) : number`, `Sin(list<number|missing>) : list<number>`,
 * `Add(Missing, matrix) : matrix`. Applied ONLY when absence is possible (some
 * operand carries a `missing` arm), so Missing-free programs are untouched.
 */
/**
 * True when `t` contains a numeric cell that excludes `nan` — the
 * candidacy test for the Contract B derived-application-type adjustment
 * (`docs/ERROR-MODEL.md` §4): only such a cell can be made more honest by
 * a `| nan` arm. Recurses through unions, collections, `broadcastable`
 * and tuples the way {@link absorbNumericAbsence} does.
 */
export function typeHasNanFreeNumericCell(t: Readonly<Type>): boolean {
  if (isSubtype(t, 'number')) return !isSubtype('nan', t);
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'union':
      return t.types.some((x) => typeHasNanFreeNumericCell(x));
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return typeHasNanFreeNumericCell(t.elements);
    case 'tuple':
      return t.elements.some((e) => typeHasNanFreeNumericCell(e.type));
    default:
      return false;
  }
}

/**
 * Widen every `nan`-free numeric cell of `t` with a `| nan` arm — the
 * Contract B result adjustment applied through collection shapes
 * (`docs/ERROR-MODEL.md` §4): under a broadcast, a propagated `NaN` (or an
 * undischarged partiality) lands in individual CELLS, so the honest lifted
 * type is `list<real | nan>`, never a widened top-level union. A cell that
 * already admits `nan` (bare `number`) is left alone; non-numeric cells
 * pass through. The union is built unreduced — `isSubtype`/`matches`
 * treat it correctly, and the `nan`-free guard keeps it duplicate-free.
 */
/**
 * Widen every cell of `t` with its codomain marker (rule 4 of
 * `docs/ERROR-MODEL.md` §2): a `nan`-free numeric cell gains `| nan`; a
 * settled non-numeric cell gains `| missing` — the one primitive quiet
 * datum, of which `NaN` is the numeric absorption; a cell that already
 * admits its marker (bare `number`, `unknown`) is left alone. Used for an
 * UNDISCHARGED declared partiality, where a domain failure may land in
 * any cell of the result.
 */
export function widenCellsWithMarker(t: Readonly<Type>): Type {
  if (isSubtype(t, 'number')) {
    if (isSubtype('nan', t)) return t as Type;
    // Splice into an existing union rather than nesting one: a nested
    // union is a legal Type but a needlessly hostile shape for downstream
    // set reasoning (`(integer | signed_infinity) | nan` vs the flat
    // three-member union).
    if (typeof t !== 'string' && t.kind === 'union')
      return { kind: 'union', types: [...t.types, 'nan'] };
    return { kind: 'union', types: [t as Type, 'nan'] };
  }
  if (typeof t !== 'string') {
    switch (t.kind) {
      case 'union':
        return {
          kind: 'union',
          types: t.types.map((x) => widenCellsWithMarker(x)),
        };
      case 'list':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        return { ...t, elements: widenCellsWithMarker(t.elements) };
      case 'tuple':
        return {
          ...t,
          elements: t.elements.map((e) => ({
            ...e,
            type: widenCellsWithMarker(e.type),
          })),
        };
    }
  }
  if (provablyAdmits('missing', t)) return t as Type;
  return { kind: 'union', types: [t as Type, 'missing'] };
}

/**
 * The marker TYPE of a codomain (rule 4 of `docs/ERROR-MODEL.md` §2): the
 * type of the value a domain failure answers — `nan` for a numeric
 * codomain, `missing` for a settled non-numeric one, and the per-arm
 * markers for a union codomain (which is sharper than the rule's
 * "union of the two" for the indeterminate case, and reduces to it for
 * `unknown`-like arms).
 */
export function codomainMarkerType(t: Readonly<Type>): Type {
  if (isSubtype(t, 'number')) return 'nan';
  if (typeof t !== 'string') {
    switch (t.kind) {
      case 'union':
        return {
          kind: 'union',
          types: t.types.map((x) => codomainMarkerType(x)),
        };
      // A collection-shaped codomain (arm) is not a whole-value claim —
      // the failure lands per cell — so it takes the cell widening, the
      // same rule its top-level consumer applies before calling here.
      case 'list':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
      case 'tuple':
        return widenCellsWithMarker(t);
    }
  }
  return 'missing';
}

/**
 * Widen `t` as a WHOLE with a `| nan` arm — the Contract B adjustment for
 * a scalar operand that may carry `NaN` in a `propagate` slot: the NaN
 * gate answers the bare marker for the whole application, whatever the
 * codomain's shape, so the honest type is `tuple<real, real> | nan`, never
 * `tuple<real | nan, real | nan>` (which is the per-cell widening of a
 * broadcast lift, {@link widenNumericCellsWithNan}). A type that already
 * admits `nan` is left alone; a union is spliced flat.
 */
export function widenWithNan(t: Readonly<Type>): Type {
  if (isSubtype('nan', t)) return t as Type;
  if (typeof t !== 'string' && t.kind === 'union')
    return { kind: 'union', types: [...t.types, 'nan'] };
  return { kind: 'union', types: [t as Type, 'nan'] };
}

export function widenNumericCellsWithNan(
  t: Readonly<Type>,
  seen?: AliasDescent
): Type {
  // A transparent alias of a collection is widened cell by cell like the
  // collection it names, and the result is the structure, not the name (the
  // alias policy of the broadcast lift). A SCALAR alias keeps its name: it is
  // widened as a whole, so `meters | nan` names the cell, not `number | nan`.
  // The unfold runs under the descent guard: a self-referential alias
  // (`type alias nest = list<nest>`) is returned unchanged at its first
  // repeat (`unfoldAliasOnDescent`).
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return t as Type;
  const r = unfolded.type;
  seen = unfolded.seen;
  if (isSubtype(r, 'number')) {
    if (isSubtype('nan', t)) return t as Type;
    // Splice into an existing union rather than nesting one: a nested
    // union is a legal Type but a needlessly hostile shape for downstream
    // set reasoning (`(integer | signed_infinity) | nan` vs the flat
    // three-member union).
    if (typeof t !== 'string' && t.kind === 'union')
      return { kind: 'union', types: [...t.types, 'nan'] };
    return { kind: 'union', types: [t as Type, 'nan'] };
  }
  if (typeof r === 'string') return t as Type;
  switch (r.kind) {
    case 'union': {
      const types = r.types.map((x) => widenNumericCellsWithNan(x, seen));
      // Nothing widened (an alias of a scalar-free union): keep the spelling
      // the caller handed in, alias name included.
      if (types.every((x, i) => x === r.types[i])) return t as Type;
      return { kind: 'union', types };
    }
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...r, elements: widenNumericCellsWithNan(r.elements, seen) };
    case 'tuple':
      // A tuple reached through a broadcast lift is the per-cell RESULT
      // of a structured head (`AbsArg([1, NaN])` is `[(1, 0), NaN]`): the
      // NaN cell replaces the whole tuple, so the tuple gains a top-level
      // `| nan` arm. Its fields are widened as well, for the reading in
      // which the tuple is itself the broadcast container (a point whose
      // components are the cells) — sound under either reading.
      return widenWithNan({
        ...r,
        elements: r.elements.map((e) => ({
          ...e,
          type: widenNumericCellsWithNan(e.type, seen),
        })),
      });
    default:
      return t as Type;
  }
}

export function absorbNumericAbsence(t: Readonly<Type>): Type {
  // A whole `missing` cell in a `propagate` result is numeric-domain (I6):
  // its runtime value is `NaN`, so it is `nan`. A numeric arm keeps the type
  // the handler answered and gains a `nan` arm: `Length` of a list that may
  // be absent is `integer | +oo | nan`, not `number`. A `never` cell stays
  // `number`, as before.
  if (t === 'missing') return 'nan';
  if (t === 'never') return 'number';
  if (typeof t === 'string') return isSubtype(t, 'number') ? widenWithNan(t) : t;
  switch (t.kind) {
    case 'union': {
      // A `missing` arm beside present arms that are all tuples is an
      // absent POINT, not an absent number. A point is atomic, so its
      // absence is not absorbed into a `NaN` coordinate: the cell answers
      // `Missing` (`docs/ERROR-MODEL.md`, the section on `Missing` in a
      // numeric slot), and the arm stays. `list<missing | tuple<…>>` stays
      // as it is; `list<missing | integer>` becomes `list<integer | nan>`. The
      // bare `tuple`, a point of no stated arity, is a tuple arm too.
      // Without it, the sum of a `list<tuple<number, number>> | tuple` and
      // a `list<missing | tuple<number, number>> | tuple<number, number>`,
      // which is `list<missing | tuple> | tuple`, had its `missing` cell
      // absorbed into `number`.
      const present = t.types.filter((x) => resolveTypeAlias(x) !== 'missing');
      const keepMissing =
        present.length > 0 &&
        present.length < t.types.length &&
        present.every((x) => {
          const r = resolveTypeAlias(x);
          return r === 'tuple' || (typeof r !== 'string' && r.kind === 'tuple');
        });
      const arms = (keepMissing ? present : t.types)
        .map((x) => absorbNumericAbsence(x))
        .filter((x) => x !== 'never');
      if (keepMissing) arms.push('missing');
      if (arms.length === 0) return 'never';
      if (arms.length === 1) return arms[0];
      // Numeric arms are kept side by side, not joined: `widen` joins
      // `integer | nan` and `+oo | nan` to `number`, which loses the arms the
      // handler answered.
      if (arms.every((x) => isSubtype(x, 'number'))) {
        const flat: Type[] = [];
        for (const arm of arms)
          for (const x of typeof arm !== 'string' && arm.kind === 'union'
            ? arm.types
            : [arm])
            if (!flat.includes(x)) flat.push(x);
        return flat.length === 1 ? flat[0] : { kind: 'union', types: flat };
      }
      return widen(...arms);
    }
    case 'intersection':
      return {
        kind: 'intersection',
        types: t.types.map((x) => absorbNumericAbsence(x)),
      };
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...t, elements: absorbNumericAbsence(t.elements) };
    case 'tuple':
      return {
        ...t,
        elements: t.elements.map((e) => ({
          ...e,
          type: absorbNumericAbsence(e.type),
        })),
      };
    // A RANGED or literal numeric type (`integer<1..3>`, `real<0..1>`) is a
    // number, and an absent operand makes its value `NaN`, which no range
    // admits: it widens to its bare tier and gains a `nan` arm, as the bare
    // numeric primitives do in the string branch above. The range is
    // removed because the value of a literal is typed without its range
    // (`[1, NaN]` is a `list<integer | nan>`, not a list of `integer<0..>`),
    // so the type of the value of `Abs(L)` would not be a subtype of a
    // ranged result. Without this arm `2·y` with
    // `y: integer<1..3> | missing` was typed `integer<2..6>`, while the same
    // product over `y: integer | missing` was wider, and a `Map` of `2x`
    // over `[1, Missing, 3]` claimed `list<integer<2..6>>` for a value that
    // holds `NaN` (found 2026-09-26).
    case 'numeric':
      return widenWithNan(stripNumericRanges(t));
    default:
      return t;
  }
}

/**
 * `t` with every `missing` arm removed, recursively through each cell (§3.B
 * step 1). A bare `missing` cell becomes `never` (`never <:` anything, so the
 * absence signal is carried by the runtime, not the type). This is the
 * strip-before-validate transform: an operand of type `T | missing` validates
 * against a parameter `P` iff `strip(T | missing) = T <: P`, so a scalar
 * `Missing` is admissible without widening `P` (I4 — inference still unifies an
 * unconstrained symbol against the bare `P`).
 *
 * Every kind {@link typeContainsMissing} recurses into is rebuilt here, so the
 * two stay symmetric: a `record{x: integer | missing}` or a
 * `dictionary<number | missing>` that arms the strip is also stripped by it.
 *
 * `tupleComponents` selects what happens to a `missing` arm inside a tuple
 * component (an absent coordinate); see the `tuple` case below. The default,
 * `'strip'`, treats it like any other cell.
 *
 * A transparent alias whose definition carries a `missing` arm is replaced by
 * its stripped definition, at the top and at any nested position: `list<mpt>`,
 * with `mpt` an alias of `missing | tuple<number, number>`, strips to
 * `list<tuple<number, number>>`. An alias with no `missing` arm keeps its
 * name, and a nominal reference is opaque and is returned unchanged. The
 * unfold runs under the descent guard (`seen`), so a self-referential alias
 * is returned unchanged at its repeat.
 */
export function stripMissingFromType(
  t: Readonly<Type>,
  tupleComponents: 'strip' | 'keep' | 'nan' = 'strip',
  seen?: AliasDescent
): Type {
  if (t === 'missing') return 'never';
  if (typeof t === 'string') return t;
  const strip = (x: Readonly<Type>) =>
    stripMissingFromType(x, tupleComponents, seen);
  // The parts of a constructor (list elements, tuple components, …) are
  // stripped with a descent that records the entry into the constructor, so
  // that a cut there is not taken for a bare union arm (see the `union`
  // case).
  const stripPart = (x: Readonly<Type>) =>
    stripMissingFromType(x, tupleComponents, descendIntoConstructor(seen));
  switch (t.kind) {
    case 'reference': {
      // At a cut of the descent guard the reference is kept as it is. That
      // is sound: it names every value of the alias, its absent ones too.
      const unfolded = unfoldAliasOnDescent(t, seen);
      if (
        unfolded === undefined ||
        unfolded.type === t ||
        !typeContainsMissing(unfolded.type, unfolded.seen)
      )
        return t as Type;
      const stripped = stripMissingFromType(
        unfolded.type,
        tupleComponents,
        unfolded.seen
      );
      // With `tupleComponents: 'keep'`, a tuple is not rebuilt, so the
      // definition can come back unchanged: the alias then keeps its name.
      return stripped === unfolded.type ? (t as Type) : stripped;
    }
    case 'union': {
      // A union arm that is a self-referential alias reaching itself again
      // as a bare union arm, with no constructor entered since it was last
      // unfolded (the `cyc` arm of `type alias cyc = cyc | list<integer> |
      // missing`), is dropped: its values are those of the other arms. Kept,
      // it would still carry the `missing` arm of its definition, and each
      // new strip of the result would unfold it once more, so the type would
      // grow without end. An alias cut after the walk entered a constructor
      // (the `a` inside `type alias a = list<a | integer> | missing`) stands
      // for deeper values, so it is kept: dropping it would lose them.
      const arms = t.types
        .filter((x) => !isBareCutOnDescent(x, seen))
        .map((x) => strip(x))
        .filter((x) => x !== 'never');
      if (arms.length === 0) return 'never';
      if (arms.length === 1) return arms[0];
      return { kind: 'union', types: arms };
    }
    case 'intersection': {
      const arms = t.types.map((x) => strip(x));
      return { kind: 'intersection', types: arms };
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...t, elements: stripPart(t.elements) };
    case 'tuple':
      // A `missing` component of a tuple is an absent COORDINATE of a point.
      // `tupleComponents` says what becomes of it:
      // - `'strip'` removes the arm, as for every other cell, so a bare
      //   `missing` component becomes `never`;
      // - `'keep'` leaves the tuple as it is, for an operator that READS a
      //   coordinate (`PointY((1, Missing))` is `Missing`);
      // - `'nan'` removes the arm, but a component that was nothing BUT
      //   absent becomes `nan`, the value an absent coordinate contributes
      //   to a numeric computation (`Norm((1, Missing))` is `NaN`). With
      //   `'strip'`, such a component is `never`, the bottom type, and a
      //   tuple with a `never` component has no value at all, so a type
      //   handler that reads it proves every claim vacuously.
      if (tupleComponents === 'keep') return t;
      return {
        ...t,
        elements: t.elements.map((e) => {
          const type = stripPart(e.type);
          return {
            ...e,
            type:
              tupleComponents === 'nan' &&
              type === 'never' &&
              e.type !== 'never'
                ? 'nan'
                : type,
          };
        }),
      };
    case 'dictionary':
      return { ...t, values: stripPart(t.values) };
    case 'record':
    case 'object': {
      // `elements` is a prototype-free map from field name to field type, and
      // it is rebuilt the same way, because a record key can be `__proto__`
      // or `toString` — an ordinary object literal would drop the first and
      // inherit a bogus type for the second.
      const elements: Record<string, Type> = Object.create(null);
      for (const key of Object.keys(t.elements))
        elements[key] = stripPart(t.elements[key]);
      return { ...t, elements };
    }
    default:
      return t;
  }
}

/**
 * The ELEMENT strip: `t` with every `missing` arm removed, for an operand that
 * holds a collection whose elements may be absent (`list<string | missing>`,
 * `set<integer | missing>`, a tuple with a `missing` component, a dictionary
 * whose values may be `missing`). Argument validation uses it at a
 * collection-kind parameter: such an operand is admitted where the stripped
 * type fits, and the operator that reads an absent element decides at run
 * time, in the same way that a scalar `T | missing` operand is admitted at a
 * `T` parameter and checked when its value is known. The transform is
 * {@link stripMissingFromType}, so the element strip and the strip of a scalar
 * operand cannot give different types.
 *
 * Returns `undefined`, and the ordinary rules decide, in two cases:
 *
 * - No `missing` member sits inside a collection: the type has no `missing`
 *   at all, or only a top-level `missing` arm (`missing | list<string>`),
 *   which is the scalar case.
 * - A cell can hold nothing but an absent value: an element type, a tuple
 *   component, a dictionary value or a record field that is `missing` alone
 *   (`list<missing>`, the type of `[Missing, Missing]`). A call with such an
 *   operand fails whenever it reads a cell, as a scalar operand typed
 *   `missing` alone fails at a `string` parameter.
 */
export function stripMissingFromElements(t: Readonly<Type>): Type | undefined {
  const arms = typeof t !== 'string' && t.kind === 'union' ? t.types : [t];
  if (!arms.some((arm) => arm !== 'missing' && typeContainsMissing(arm)))
    return undefined;
  if (hasAbsentOnlyCell(t)) return undefined;
  const stripped = stripMissingFromType(t);
  return stripped === 'never' ? undefined : stripped;
}

/** True when a cell of `t` (an element type, a tuple component, a dictionary
 * value or a record field, at any depth) is `missing` and nothing else. */
function hasAbsentOnlyCell(t: Readonly<Type>): boolean {
  const absentOnly = (x: Readonly<Type>): boolean =>
    typeContainsMissing(x) && stripMissingFromType(x) === 'never';
  const cell = (x: Readonly<Type>): boolean =>
    absentOnly(x) || hasAbsentOnlyCell(x);
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'union':
    case 'intersection':
      return t.types.some(hasAbsentOnlyCell);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return cell(t.elements);
    case 'tuple':
      return t.elements.some((e) => cell(e.type));
    case 'dictionary':
      return cell(t.values);
    case 'record':
    case 'object':
      return Object.values(t.elements).some((x) => cell(x));
    default:
      return false;
  }
}

/**
 * Is `t` a type whose `missing` arm sits on a NUMERIC base (`number | missing`,
 * `integer | missing`, …)? Such a slot's absence representation is `NaN`, not
 * the `Missing` symbol (I6 domain normalization) — comparisons read it as `NaN`
 * (IEEE) and its arm never surfaces in a comparison result.
 *
 * Shared by the comparison handlers' absence read (`readComparisonAbsence`) and
 * the broadcast evaluate-once substitution: a lifted operand is replaced by its
 * VALUE, which erases the slot type the absence read depends on, so the
 * substitution has to apply the same normalization or the same operand would be
 * Kleene under a broadcast and IEEE as a scalar.
 */
export function numericMissingSlot(t: Readonly<Type>): boolean {
  if (!typeContainsMissing(t)) return false;
  const stripped = stripMissingFromType(t);
  return stripped !== 'never' && isSubtype(stripped, 'number');
}

/**
 * True if `t` denotes an **atomic** value type — a cell in the cell/axis model
 * (see `docs/COLLECTIONS-MODEL.md`). Atomic
 * types are the ones that may occupy a single tensor cell: numbers, booleans,
 * strings, symbols, colors, function/expression values, and all
 * product/aggregate values (tuples, sets, dictionaries, records). List- and
 * collection-kind types are NOT atomic (they form axes / are opaque
 * collections), and neither is `value` (documented as scalar ∪ collection — a
 * value-typed element could be a collection at runtime).
 *
 * Conservative principle: **when in doubt, not atomic** — a false "not atomic"
 * only withholds a shape claim (safe); a false "atomic" creates a spurious
 * tensor. One deliberate exception, per §D5: `unknown`/`any` ARE atomic —
 * atomicity governs *cell classification* only, and whether an
 * unknown-typed element supports a *shape claim* is the stricter, separate
 * rule in the `List` shape analysis (`shapedListTypeD`,
 * `library/collections.ts`: bare symbols fold to `number`; applications
 * block). Callers must apply that second gate — do not use this predicate
 * alone to justify a shape.
 */
export function isAtomicValueType(
  t: Readonly<Type>,
  seen?: AliasDescent
): boolean {
  // Bare (primitive) string form first — the codebase's `typeof t === 'string'`
  // idiom.
  if (typeof t === 'string')
    return (
      t !== 'list' &&
      t !== 'collection' &&
      t !== 'indexed_collection' &&
      t !== 'value'
    );

  switch (t.kind) {
    case 'list':
    case 'collection':
    case 'indexed_collection':
      return false;

    case 'union':
    case 'intersection':
      // union: the value MIGHT be a collection arm → block unless all atomic.
      // intersection: the value IS every arm → any collection arm makes it one.
      return t.types.every((arm) => isAtomicValueType(arm, seen));

    case 'broadcastable':
      return false; // lift marker — may broadcast over a collection

    case 'negation':
      return false; // can't bound the negated set; conservative

    case 'reference': {
      // Recurse on the resolved definition; unresolved → conservative.
      if (t.def === undefined) return false;
      // The definition is read under the descent guard
      // (`recordUnfoldOnDescent`, which counts nominal references too): a
      // self-referential type (`type alias cyc = cyc | tuple<number,
      // number>`) stops when it reaches itself again. The walk descends
      // only through union, intersection and reference arms, so the values
      // of the repeated occurrence are those of the other arms, and it
      // answers `true`, the neutral answer for "every arm is atomic".
      // Without the guard the walk overflows the stack.
      const next = recordUnfoldOnDescent(declarationOf(t), seen);
      if (next === undefined) return true;
      return isAtomicValueType(t.def, next);
    }

    case 'value':
      // A literal value type — recurse on the literal's underlying type.
      return isAtomicValueType(valueLiteralType(t.value));

    // signature (functions are cells), tuple/set/dictionary/record
    // (product/aggregate cells), and all remaining primitive kinds
    // (numeric, symbol, expression, ...) are atomic.
    default:
      return true;
  }
}

/** The primitive type of a `value`-kind literal's JS value. */
function valueLiteralType(value: unknown): Type {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'expression';
}

/**
 * Given the scalar per-element result type `elementType` a broadcastable
 * operator computed for its arguments, produce the type of the broadcast
 * (element-wise) result: an (unbounded) `list<elementType>`.
 *
 * The result is deliberately length-agnostic: the value path materializes the
 * broadcast into a plain `List`, whose own type handler is `list<…>` (it drops
 * the operand's fixed length), so an unbounded `list<elementType>` is the
 * consistent, sound upper bound of what evaluation produces. (The exact
 * fixed-length `vector<n>` cases — `Add`/`Multiply` over a tensor — are typed
 * by those operators' own handlers, which see the tensor operand directly.)
 */
export function broadcastResultType(elementType: Readonly<Type>): Type {
  const result: ListType = { kind: 'list', elements: elementType as Type };
  return result;
}

/**
 * The type of a broadcast whose per-element result `elementType` is itself a
 * collection (`x ↦ (x, x)` gives a tuple): one `list` level around it for
 * each rank the broadcast descends in the deepest operand of
 * `operandTypes`. A broadcast of a scalar-parameter function descends into
 * every rank of a nested list (a list of lists is mapped at the leaves), and
 * stops at a tuple, a string, or a collection with no indexed element type.
 * So `x ↦ (x, x)` over `list<list<integer>>` is
 * `list<list<tuple<…>>>`; {@link broadcastResultType} alone gave one level,
 * a type the value is not a member of.
 */
export function nestedBroadcastResultType(
  operandTypes: ReadonlyArray<Readonly<Type>>,
  elementType: Readonly<Type>
): Type {
  // The bound on the ranks read: a type does not nest deeper in practice,
  // and it stops a recursive alias from looping.
  const MAX_RANK = 8;
  // Set when an element of an operand has a type that does not state its
  // depth (`any`, `unknown`, `value`: the element of a `list<any>`). A value
  // of that element can be a list, and the broadcast maps it at its leaves
  // too, so an element of the innermost level of the result is the
  // per-element result or a list of any depth.
  let openLeaf = false;
  // The ranks a broadcast descends into `t`: none for a tuple, a string or a
  // non-indexed type; one more than its element for an indexed collection;
  // the deepest member for a union of collections (`list<integer^2> |
  // list<integer^3>`, a ragged row). `undefined` for a union that mixes a
  // scalar and a collection, which each cell descends to a different depth.
  // A transparent alias is unfolded under the descent guard
  // (`unfoldAliasOnDescent`). The rank bound alone does not stop an alias
  // that names itself as an arm of its own union (`type alias lcyc = lcyc |
  // list<integer>`): the walk of a union arm does not go deeper, and it
  // overflowed the stack. Such an arm adds no value, and it is skipped
  // (`isBareCutOnDescent`). An alias that the guard cuts inside a list
  // element nests to a depth the type does not bound, and the answer is
  // `undefined`.
  const ranks = (
    t0: Type,
    d: number,
    seen: AliasDescent
  ): number | undefined => {
    if (d >= MAX_RANK) return 0;
    const unfolded = unfoldAliasOnDescent(t0, seen);
    if (unfolded === undefined) return undefined;
    const t = unfolded.type;
    if (d > 0 && (t === 'any' || t === 'unknown' || t === 'value')) {
      openLeaf = true;
      return 0;
    }
    if (typeof t === 'object' && t.kind === 'tuple') return 0;
    if (isSubtype(t, 'string')) return 0;
    if (typeof t === 'object' && t.kind === 'union') {
      const members = t.types
        .filter((m) => !isBareCutOnDescent(m, unfolded.seen))
        .map((m) => ranks(m, d, unfolded.seen));
      if (members.length === 0) return 0;
      if (members.some((m) => m === undefined)) return undefined;
      const depths = members as number[];
      const deepest = Math.max(...depths);
      return depths.every((m) => m === deepest) ? deepest : undefined;
    }
    if (!isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE)) return 0;
    // A `broadcastable<T>` that is a collection type (its `T` is a list
    // type) holds a `T` or a list of `T`: the two arms have different
    // depths, so no single nesting describes it.
    if (typeof t === 'object' && t.kind === 'broadcastable') return undefined;
    const e = collectionElementType(t);
    if (e === undefined) return 1;
    const inner = ranks(e, d + 1, descendIntoConstructor(unfolded.seen));
    return inner === undefined ? undefined : 1 + inner;
  };
  let depth = 1;
  for (const t of operandTypes) {
    const d = ranks(t as Type, 0, undefined);
    // A ragged element is mapped to a different depth in each cell, which no
    // single nesting describes: the cell type is then `any`.
    if (d === undefined) return broadcastResultType('any');
    depth = Math.max(depth, d);
  }
  // An element result that is `unknown` or `any` already admits a list, and
  // it is kept: the join is neutral in `unknown`, so
  // `widen('unknown', list<any>)` is `list<any>`, which is narrower than
  // `unknown`.
  let result =
    openLeaf && elementType !== 'unknown' && elementType !== 'any'
      ? widen(elementType as Type, { kind: 'list', elements: 'any' })
      : (elementType as Type);
  for (let k = 0; k < depth; k++) result = broadcastResultType(result);
  return result;
}

/**
 * The statically-provable dimension vector of a collection type, or `null`
 * when the rank itself is not statically known. Open (unknown) lengths are
 * `-1` — the same wildcard convention `matrix`/`vector` parse to.
 *
 * A tensor type states its rank: its dimension list is the answer, whatever
 * its cell type (`matrix<T^(2x3)>` → `[2, 3]`; `matrix`, which is
 * `matrix<number^(?x?)>`, → `[-1, -1]`). A tensor of unknown rank
 * (`tensor<U>`, `dimensions` `null`) → `null`.
 *
 * A plain list `list<E>` is not a tensor type, and its rank is not read
 * from the nesting of its element type: `list<list<number>>` → `null`,
 * because its rows may differ in length, and `list<vector<3>>` → `null`
 * too, because the type is a list of vectors, not a matrix (the broadcast
 * result typing, `broadcastOperandShape`, reads such rows for its own
 * purpose). A plain list whose elements cannot be lists (`list<number>`,
 * `list<string>`, `list<tuple<number, number>>`) is read at rank 1 with an
 * open length, `[-1]`: every such list is a rank-1 arrangement of its
 * elements. A plain list whose elements could be lists (`list<any>`, a bare
 * `list`, `list<value>`, `list<integer | list<integer>>`) → `null`.
 */
export function staticCollectionDims(
  t: Readonly<Type>,
  seen?: AliasDescent
): number[] | null {
  // A transparent alias of a shaped list carries that list's dimensions:
  // `Sin(v)` for `v: vec2` (an alias of `vector<2>`) mirrors the shape onto
  // the lifted result exactly as `Sin(w)` for `w: vector<2>` does. The
  // unfold runs under the descent guard: a self-referential alias
  // (`type alias nest = list<nest>`) stops at its first repeat with rank
  // unknown (`unfoldAliasOnDescent`).
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return null;
  t = unfolded.type;
  if (typeof t === 'string') return null;
  if (t.kind !== 'list') return null;
  if (t.dimensions === null) return null;
  if (t.dimensions !== undefined) return [...t.dimensions];
  const element = unfoldAliasOnDescent(t.elements, unfolded.seen);
  if (element === undefined) return null;
  return elementCanBeList(element.type) ? null : [-1];
}

/**
 * The rank of an abstract collection type, `collection<T>` or
 * `indexed_collection<T>`, when it is known: `[-1]` (rank 1, any length)
 * when its elements `T` cannot be lists, `null` otherwise. A collection
 * type holds ELEMENTS (the list-element reading of 2026-10-21), so a
 * `collection<number>` is a collection of numbers: a matrix, whose elements
 * are rows, is not one. The data parameter of `Mean` and the other
 * statistics is spelled this way, and a matrix argument is refused when the
 * expression is boxed (ROADMAP CE-13).
 * `staticCollectionDims()` answers only for a `list` type, so the deferral
 * check of `overlapsDeferred()` reads this as the rank of such a parameter.
 */
function abstractCollectionDims(t: Readonly<Type>): number[] | null {
  if (typeof t === 'string') return null;
  if (t.kind !== 'collection' && t.kind !== 'indexed_collection') return null;
  return elementCanBeList(t.elements) ? null : [-1];
}

/**
 * The type of the immediate elements of a list without dimensions, a set or
 * an abstract collection; `undefined` for any other type, and for a list
 * with dimensions, whose rank the rank refutation of `overlapsDeferred()`
 * reads instead.
 */
function immediateElementType(t: Readonly<Type>): Type | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'list')
    return t.dimensions === undefined ? t.elements : undefined;
  if (
    t.kind === 'set' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection'
  )
    return t.elements;
  return undefined;
}

/**
 * Whether a value of the element type `el` of a plain list could itself be
 * a list: a top type, a bare collection name, a name that `list` is below
 * (`value`, `expression`), a list or abstract collection type, a
 * broadcastable, or a union, intersection, negation or reference that is
 * not provably disjoint from `list<any>`.
 */
function elementCanBeList(el: Readonly<Type>): boolean {
  if (typeof el === 'string')
    return (
      el === 'unknown' ||
      el === 'any' ||
      el === 'list' ||
      el === 'collection' ||
      el === 'indexed_collection' ||
      el === 'value' ||
      el === 'expression'
    );
  switch (el.kind) {
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return true;
    case 'union':
    case 'intersection':
    case 'negation':
    case 'reference':
      return !provablyDisjoint(el as Type, LIST_OF_ANY);
    default:
      return false;
  }
}

/** `list<any>`, built as a literal node (the type parser is not yet
 * initialized when this module loads under jest) and frozen, because it is
 * shared. */
const LIST_OF_ANY: Type = Object.freeze({ kind: 'list', elements: 'any' });

/**
 * The dimensions of the list type `t` as a broadcast over it reads them, and
 * whether the rows at each depth provably have the same length (`uniform`),
 * or `null` when the rank is not known.
 *
 * A tensor with a dimension list has that shape, and its rows are uniform:
 * the dimensions describe a rectangular value, an open length included. A
 * tensor of unknown rank (`dimensions` `null`) has an unknown shape. A
 * plain list is read at rank 1 with an open length, and the shape of its
 * rows is appended when its elements are lists: a list type nested in the
 * element of another (`list<list<integer>>`, `list<vector>`) says only that
 * each row is a list, so its length is the same in every row only when its
 * dimensions are all fixed (`list<vector<3>>`), and the rows of a union of
 * lists (the type of the literal `[[1, 2], [3]]`,
 * `list<vector<integer^1> | vector<integer^2>>`) are uniform only when every
 * arm has the same fixed dimensions. The broadcast result typing
 * (`broadcastShapedResultType`) spells a non-uniform shape as nested plain
 * lists, so this nested reading never claims a tensor that the value is not.
 *
 * `'mixed rank'` is the answer when a value of `t` can be a nested list of
 * one of several depths whose rows can differ in length (a union of lists
 * of different ranks whose rows are not all uniform,
 * `list<integer> | list<list<integer>>`), or when a row has that property:
 * neither one depth nor a tensor describes it (`unionOperandShape`).
 *
 * `'tensor rows'` is the answer for a plain list whose elements are each a
 * cell or a tensor of unknown rank (`list<tensor<number>>`,
 * `list<broadcastable<number>>`). Each element is rectangular, but two
 * elements can have different ranks (`[1, [2, 3], [[4]]]`), so the value is
 * not a tensor. It is a list of rank 1 whose elements are tensors of the
 * cells, and a broadcast keeps that reading (`broadcastShapedResultType`).
 */
function broadcastOperandShape(
  t: Readonly<Type>,
  seen?: AliasDescent,
  depth = 0
):
  | { dims: number[]; uniform: boolean }
  | 'unknown rank'
  | 'mixed rank'
  | 'tensor rows'
  | null {
  if (depth > MAX_CELL_DEPTH) return null;
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return null;
  const outer = unfolded.type;
  if (typeof outer !== 'string' && outer.kind === 'union')
    return unionOperandShape(outer.types, unfolded.seen, depth);
  if (typeof outer === 'string' || outer.kind !== 'list') return null;
  // A tensor of unknown rank: the operand itself states that its rank is
  // not known, which the result reports as a tensor of unknown rank too.
  if (outer.dimensions === null) return 'unknown rank';
  if (outer.dimensions !== undefined)
    return { dims: [...outer.dimensions], uniform: true };
  const element = unfoldAliasOnDescent(
    outer.elements,
    descendIntoConstructor(unfolded.seen)
  );
  if (
    element !== undefined &&
    typeof element.type !== 'string' &&
    element.type.kind === 'broadcastable' &&
    cannotHoldAList(element.type.elements)
  )
    return 'tensor rows';
  const row = broadcastRowShape(outer.elements, unfolded.seen, depth);
  // Rows that are tensors of unknown rank can have different ranks, so the
  // list is not one tensor of unknown rank.
  if (row === 'unknown rank') return 'tensor rows';
  if (row === null || row === 'mixed rank') return row;
  if (row === 'leaf') return { dims: [-1], uniform: true };
  return { dims: [-1, ...row.dims], uniform: row.uniform };
}

/**
 * The shape of an operand whose type is the union of the types `arms`, for
 * `broadcastOperandShape`. A value of the union is a value of one arm, so
 * the shape is read from every arm:
 *
 * - When an arm is not a list type (a scalar arm, `integer | list<integer>`),
 *   or its shape is not known for another reason: `null`.
 * - When an arm is a tensor of unknown rank (`list<integer> | tensor<integer>`):
 *   `'unknown rank'`.
 * - When every arm has the same rank: that rank, with the length of an axis
 *   kept where every arm states the same length and open (`-1`) otherwise
 *   (`vector<integer^2> | vector<integer^3>` reads as `[-1]`). The rows are
 *   uniform when they are uniform in every arm, since one value is in one
 *   arm.
 * - When the arms have different ranks (`list<integer> | matrix<integer>`):
 *   `'unknown rank'` when the rows of every arm are uniform, because each
 *   value is then a tensor of the rank of its arm; `'mixed rank'`
 *   otherwise, because a value with rows of different lengths is not a
 *   tensor, and the values of different arms have different depths.
 */
function unionOperandShape(
  arms: ReadonlyArray<Readonly<Type>>,
  seen: AliasDescent | undefined,
  depth: number
): { dims: number[]; uniform: boolean } | 'unknown rank' | 'mixed rank' | null {
  let shape: { dims: number[]; uniform: boolean } | undefined;
  let mixedRanks = false;
  for (const arm of arms) {
    const s = broadcastOperandShape(arm, seen, depth + 1);
    // An arm whose elements are tensors of different ranks is a nested list
    // whose depth is not one number.
    if (s === 'tensor rows') return 'mixed rank';
    if (s === null || s === 'unknown rank' || s === 'mixed rank') return s;
    if (shape === undefined) shape = { dims: [...s.dims], uniform: s.uniform };
    else if (shape.dims.length !== s.dims.length) {
      mixedRanks = true;
      shape.uniform = shape.uniform && s.uniform;
    } else
      shape = {
        dims: shape.dims.map((n, i) => (n === s.dims[i] ? n : -1)),
        uniform: shape.uniform && s.uniform,
      };
  }
  if (shape === undefined) return null;
  if (mixedRanks) return shape.uniform ? 'unknown rank' : 'mixed rank';
  return shape;
}

/**
 * The depth of the values of a broadcast operand of type `t` whose shape
 * `broadcastOperandShape` does not know (it answers `null`), for
 * `broadcastShapedResultType`:
 *
 * - `'tensor'`: a value of `t` that is a collection is a tensor of a rank
 *   that is not known, whose rows have one length at each depth. This is
 *   the case of a `broadcastable<T>` whose `T` cannot hold a list
 *   (`cannotHoldAList`): its collection arm is `tensor<T>`, so a
 *   `broadcastable<number>` can hold a matrix.
 * - `'any depth'`: a value of `t` can be a nested list of any depth whose
 *   rows differ in length. This is the case of a top type or a bare
 *   collection name (`any`, `list`), of a list or an abstract indexed
 *   collection whose elements can be lists (`list<any>`,
 *   `indexed_collection<list<integer>>`), and of a `broadcastable<T>` whose
 *   `T` can hold a list. The broadcast maps such a value at its leaves, so
 *   the value of the result has the depth of the operand.
 * - `undefined`: a value of `t` is a scalar or a list of rank 1 (a `range`,
 *   an `indexed_collection<number>`, a `set`, a tuple).
 *
 * A union is read arm by arm, and the deepest answer of an arm is the
 * answer.
 */
function unknownShapeOperandDepth(
  t: Readonly<Type>,
  seen?: AliasDescent,
  depth = 0
): 'tensor' | 'any depth' | undefined {
  if (depth > MAX_CELL_DEPTH) return 'any depth';
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return 'any depth';
  const r = unfolded.type;
  if (typeof r === 'string')
    return elementCanBeList(r) ? 'any depth' : undefined;
  if (r.kind === 'broadcastable')
    return cannotHoldAList(r.elements) ? 'tensor' : 'any depth';
  if (r.kind === 'list' || r.kind === 'indexed_collection') {
    // A tensor of unknown rank, or a list whose rows have a known shape,
    // is read by `broadcastOperandShape`; this function sees it as a union
    // arm only.
    const shape = broadcastOperandShape(r, unfolded.seen, depth + 1);
    if (shape === 'unknown rank') return 'tensor';
    if (shape === 'mixed rank' || shape === 'tensor rows') return 'any depth';
    if (shape !== null) {
      if (!shape.uniform) return 'any depth';
      return shape.dims.length > 1 ? 'tensor' : undefined;
    }
    const element = unfoldAliasOnDescent(
      r.elements,
      descendIntoConstructor(unfolded.seen)
    );
    if (element === undefined || elementCanBeList(element.type))
      return 'any depth';
    return undefined;
  }
  if (r.kind === 'union') {
    let answer: 'tensor' | 'any depth' | undefined = undefined;
    for (const arm of r.types) {
      const a = unknownShapeOperandDepth(arm, unfolded.seen, depth + 1);
      if (a === 'any depth') return a;
      if (a === 'tensor') answer = a;
    }
    return answer;
  }
  return undefined;
}

/** The shape of the rows of a list whose element type is `t`, for
 * `broadcastOperandShape`: `'leaf'` when an element is not a list, the
 * dimensions of a row and whether every row has them otherwise,
 * `'unknown rank'` when a row is a tensor of unknown rank, `'mixed rank'`
 * when the rows can have different depths (a union of a list and a scalar,
 * or of lists of different ranks, or a row that is `'mixed rank'` itself),
 * `null` when the rank is not known for another reason (an element of
 * unknown shape). */
function broadcastRowShape(
  t: Readonly<Type>,
  seen: AliasDescent | undefined,
  depth: number
):
  | 'leaf'
  | 'unknown rank'
  | 'mixed rank'
  | { dims: number[]; uniform: boolean }
  | null {
  const element = unfoldAliasOnDescent(t, seen);
  if (element === undefined) return null;
  const el = element.type;
  if (typeof el === 'string') return elementCanBeList(el) ? null : 'leaf';
  if (el.kind === 'list') {
    const s = broadcastOperandShape(el, element.seen, depth + 1);
    // A row whose own elements are tensors of different ranks: the rows of
    // the outer list do not have one depth.
    if (s === 'tensor rows') return 'mixed rank';
    if (s === null || s === 'unknown rank' || s === 'mixed rank') return s;
    return { dims: s.dims, uniform: s.uniform && s.dims.every((n) => n >= 0) };
  }
  if (el.kind !== 'union') return elementCanBeList(el) ? null : 'leaf';
  let shape: 'leaf' | { dims: number[]; uniform: boolean } | undefined;
  for (const arm of el.types) {
    const s = broadcastRowShape(arm, element.seen, depth);
    if (s === null || s === 'unknown rank' || s === 'mixed rank') return s;
    if (shape === undefined) shape = s;
    else if (shape === 'leaf' || s === 'leaf') {
      if (shape !== s) return 'mixed rank';
    } else if (shape.dims.length !== s.dims.length) return 'mixed rank';
    else {
      const same = shape.dims.every((n, i) => n === s.dims[i]);
      shape = {
        dims: shape.dims.map((n, i) => (n === s.dims[i] ? n : -1)),
        uniform: shape.uniform && s.uniform && same,
      };
    }
  }
  return shape ?? 'leaf';
}

/**
 * Rank/shape-aware broadcast result type (§D6.1 of
 * `docs/COLLECTIONS-MODEL.md`): mirror the
 * shape-bearing operands' statically-provable structure onto the broadcast
 * result, in the **dimensioned** encoding (`matrix<R^(2x2)>`), so a fixed-shape
 * source (`Sqrt(M)` with `M: matrix<2x2>`) types compatibly with `matrix`/
 * `vector` signature parameters.
 *
 * `operandTypes` are the types of the operands that broadcast (scalars must
 * not be included — they impose no shape). Merge rule (review R3-2, sound
 * under the value machinery's zip-to-shortest semantics):
 * - every operand's dims provably identical → those dims;
 * - identical ranks, differing/open entries → that rank, all lengths open;
 * - the rank of the result is not known → a tensor of unknown rank whose
 *   cells are `R` (`tensor<R>`, a list node with `dimensions` `null`): the
 *   value is an arrangement of `R` cells of some depth. The rank is not
 *   known when an operand is a tensor of unknown rank (`tensor<U>`, or a
 *   list whose rows are one), when an operand is a union of tensors of
 *   different ranks (`list<integer> | matrix<integer>`,
 *   `unionOperandShape`), and when two operands have different known
 *   ranks: a vector against a matrix broadcasts the vector over the rows
 *   (`[10, 20]` against `[[1, 2], [3, 4]]` gives `[[10, 10], [20, 20]]`),
 *   so the value has the larger rank, and a plain `list<R>` does not
 *   describe it. The rows of every operand must be uniform (a value whose
 *   rows differ in length is not a tensor), and no value of `R` may be a
 *   list (`cannotHoldAList`: a number, a boolean, a tuple), since the
 *   cells of a tensor are not lists. Otherwise the answer is a nested
 *   plain list: one `list` level for each axis of the largest rank when
 *   every operand has one known rank (`list<list<R>>` for a vector against
 *   a `list<list<number>>`), and `list<R | list<any>>`, a list of cells or
 *   lists of any depth, when the depth is not known (an operand of unknown
 *   rank, a union of lists of different ranks whose rows differ in length,
 *   or an `R` that can hold a list);
 * - an operand whose shape is not known otherwise is read by
 *   `unknownShapeOperandDepth`: a `broadcastable<T>` whose `T` cannot hold
 *   a list holds a tensor of unknown rank, and counts as an operand of
 *   unknown rank above; an operand whose values can be nested lists of any
 *   depth (`any`, `list<any>`, an abstract indexed collection whose
 *   elements can be lists) gives `list<R | list<any>>`; any other operand
 *   (a `range`, an abstract `indexed_collection<T>` whose elements cannot
 *   be lists, a union of scalars and lists of rank 1) gives the plain
 *   `list<R>`: a broadcast over an abstract collection is a list of the
 *   cell result (no invented structure).
 * A rank-1 all-open result stays plain `list<R>`, which denotes the same
 * values as `vector<R>` (byte-identical to the earlier output for the
 * common unbounded case).
 */
export function broadcastShapedResultType(
  operandTypes: ReadonlyArray<Readonly<Type>>,
  elementType: Readonly<Type>,
  absentCell?: Readonly<Type>
): Type {
  const ragged = raggedBroadcastResultType(
    operandTypes,
    elementType,
    absentCell
  );
  if (ragged !== undefined) return ragged;
  const cells = elementType as Type;
  // A nested list of unknown depth whose rows may differ in length:
  // `list<R | list<any>>`, a list whose elements are cells or lists. Every
  // broadcast result is in it. When `R` already admits every list, it is
  // `list<R>`.
  const anyDepth = (): Type =>
    isSubtype(LIST_OF_ANY, cells)
      ? broadcastResultType(cells)
      : broadcastResultType(widen(cells, LIST_OF_ANY));
  let dims: number[] | null = null;
  let uniform = true;
  let mixedRanks = false;
  let unknownRank = false;
  let tensorRows = false;
  let rankOneAbstract = false;
  // Whether some operand of a known rank of 3 or more has rows that may
  // differ in length: an element of such an operand may be a ragged list.
  let raggedDeepRows = false;
  let maxRank = 0;
  for (const t of operandTypes) {
    const shape = broadcastOperandShape(t);
    if (shape === null) {
      // The rank is not known. A value of the operand can still be a
      // tensor of rank 2 or more (a `broadcastable<number>` that holds a
      // matrix), or a nested list of any depth (`list<any>`, `any`), and
      // the broadcast maps it at its leaves: the one-level `list<R>` does
      // not hold such a value.
      const deep = unknownShapeOperandDepth(t);
      if (deep === 'any depth') return anyDepth();
      if (deep === 'tensor') {
        unknownRank = true;
        continue;
      }
      // A scalar or a list of rank 1 (a `range`): the answer is the plain
      // `list<R>` below, unless another operand is a list of tensors, which
      // makes the elements of the value tensors too.
      rankOneAbstract = true;
      continue;
    }
    // The rank of this operand is not known: the loop goes on, so that the
    // uniformity of the other operands is known before the answer.
    if (shape === 'unknown rank') {
      unknownRank = true;
      continue;
    }
    // A value of this operand can be a nested list of any depth whose rows
    // differ in length: no tensor describes the result.
    if (shape === 'mixed rank') return anyDepth();
    // A list whose elements are tensors of different ranks: the loop goes
    // on, so that the shapes of the other operands are known.
    if (shape === 'tensor rows') {
      tensorRows = true;
      continue;
    }
    const d = shape.dims;
    if (!shape.uniform) uniform = false;
    if (!shape.uniform && d.length > 2) raggedDeepRows = true;
    maxRank = Math.max(maxRank, d.length);
    if (dims === null) {
      dims = d;
    } else if (dims.length !== d.length) {
      // Two known ranks that differ: the value has the larger rank when the
      // shapes nest, so the rank of the result is read as unknown below,
      // once the uniformity of every operand is known.
      mixedRanks = true;
    } else {
      // Same rank: keep provably-identical entries, open the rest.
      for (let i = 0; i < dims.length; i++) if (dims[i] !== d[i]) dims[i] = -1;
    }
  }
  if (rankOneAbstract && !tensorRows) return broadcastResultType(elementType);
  if (tensorRows) {
    // An operand is a list whose elements are each a cell or a tensor
    // (`list<broadcastable<number>>`). The broadcast pairs the elements of
    // the operands by index, so element `i` of the value is the broadcast of
    // element `i` of every operand. When each of those is a cell or a tensor
    // (a scalar operand, a tensor of any rank, a list of rank 1 or 2, a list
    // of tensors), and the result for one cell, `R`, cannot be a list,
    // element `i` is a cell or a tensor of `R` cells, and the value is
    // `list<broadcastable<R>>`: `[1, [2, 3], [[4]]] + 1` is
    // `[2, [3, 4], [[5]]]`. When `R` can be a list (a function whose result
    // for one cell is a `broadcastable<number>`), element `i` is a nested
    // list whose rows can differ in length, and the depth of the value is
    // not known. `R` is the result for one CELL: the caller asks the
    // handler again with each operand typed as its cell
    // (`broadcastLiftType`).
    if (raggedDeepRows || !cannotHoldAList(cells)) return anyDepth();
    return {
      kind: 'list',
      elements: { kind: 'broadcastable', elements: cells },
    };
  }
  if (unknownRank || mixedRanks) {
    // Every operand is a tensor (its rows are uniform), so the value is a
    // tensor of some rank whose cells are `R`: `tensor<R>`, when no value
    // of `R` is a list. When `R` can hold a list, a tensor of `R` cells
    // would not describe the depth of the value, and the answer is the
    // nested list of any depth.
    if (uniform) {
      if (cannotHoldAList(cells))
        return { kind: 'list', elements: cells, dimensions: null };
      return anyDepth();
    }
    // Some rows may differ in length. With an operand of unknown rank the
    // depth is not known either. Otherwise every operand has one known
    // rank, and a broadcast over operands of different ranks has the
    // largest of them (a vector against a matrix broadcasts the vector
    // over the rows): one plain list level for each.
    if (unknownRank) return anyDepth();
    let nested = cells;
    for (let k = 0; k < maxRank; k++) nested = broadcastResultType(nested);
    return nested;
  }
  if (dims === null) return broadcastResultType(elementType);
  // Rank-1 fully-open adds no information over the plain form.
  if (dims.length === 1 && dims[0] === -1)
    return broadcastResultType(elementType);
  // The dimensioned form says that all the rows at one depth have the same
  // length. A list of lists does not promise this (`list<list<integer>>`
  // holds `[[1, 2], [3]]`), so the result is then a plain list for each rank:
  // `Sin` of `[[1, 2], [3]]` is `[[Sin(1), Sin(2)], [Sin(3)]]`, which is a
  // `list<list<real>>`, not a matrix.
  if (dims.length > 1 && !uniform) {
    let nested = elementType as Type;
    for (let k = 0; k < dims.length; k++) nested = broadcastResultType(nested);
    return nested;
  }
  const result: ListType = {
    kind: 'list',
    elements: elementType as Type,
    dimensions: dims,
  };
  return result;
}

/**
 * The deepest cell level that a walk over the cells of a collection type
 * reads. A data type does not nest deeper in practice, and the bound also
 * stops a walk through a self-referential alias.
 */
export const MAX_CELL_DEPTH = 8;

/**
 * The number of list levels between a collection type and its one `elements`
 * type: the rank of a tensor with a dimension list (`matrix<integer^(2x3)>`
 * holds its leaves two levels down), and 1 for any other collection. A
 * tensor of unknown rank (`dimensions` is `null`) holds its cells at an
 * unknown depth; it is read as one level here, as a plain list of its
 * cells, which is what its callers did before the unknown rank existed.
 */
export function collectionLevels(t: Readonly<Type>): number {
  return typeof t !== 'string' && t.kind === 'list' && t.dimensions
    ? Math.max(t.dimensions.length, 1)
    : 1;
}

/** The type of one cell of the list type `t`: its `elements`, or, for a
 * tensor of rank 2 or more, the tensor of its remaining dimensions
 * (`matrix<integer^(2x3)>` has cells of type `list<integer^3>`). A tensor of
 * unknown rank reads as a list of its cells here. */
function listCellType(t: ListType): Type {
  if (!t.dimensions || t.dimensions.length < 2) return t.elements;
  const rest = t.dimensions.slice(1);
  // An open length of rank 1 (`[-1]`) adds nothing to a plain list.
  if (rest.length === 1 && rest[0] === -1)
    return { kind: 'list', elements: t.elements };
  return { kind: 'list', elements: t.elements, dimensions: rest };
}

/** Whether `t` is a type that says nothing of the shape of its values (`any`,
 * `unknown`, a bare collection kind such as `list`): a value of it may be a
 * number or a list of any depth. */
function isShapeOpenType(t: Readonly<Type>): boolean {
  if (typeof t !== 'string') return false;
  if (t === 'any' || t === 'unknown' || t === 'value' || t === 'expression')
    return true;
  if (t === 'never' || t === 'tuple' || isSubtype(t, 'string')) return false;
  return isSubtype(t, COLLECTION_SHAPE_TYPE);
}

/** Whether the chain of cell types of `t` (its `elements`, their `elements`,
 * …) reaches a union or a reference: only such a cell can be ragged. This
 * check allocates nothing, so the common case, a list with no union in its
 * cells, costs one walk down the chain. */
function mayHaveRaggedCells(t: Readonly<Type>): boolean {
  let x: Readonly<Type> = t;
  for (let d = 0; d <= MAX_CELL_DEPTH; d++) {
    if (typeof x === 'string') return false;
    if (x.kind === 'union' || x.kind === 'reference') return true;
    if (
      x.kind !== 'list' &&
      x.kind !== 'collection' &&
      x.kind !== 'indexed_collection' &&
      x.kind !== 'broadcastable'
    )
      return false;
    x = x.elements;
  }
  return false;
}

/**
 * The type of a broadcast over a list whose cells are RAGGED: at some depth,
 * a cell type is a union whose arms have different ranks, a list arm beside
 * a scalar arm (`list<list<integer> | integer>`) or lists of different depths
 * (`list<list<list<integer>> | list<integer>>`), or a union with an arm that
 * says nothing of its shape (`any | list<integer>`). The rank of such a list
 * is not known (`staticCollectionDims` reads `list<list<integer> | integer>`
 * as rank 1), so the shaped form gave `list<R>`, a type the value is not a
 * member of. The broadcast maps every leaf, so each cell of the result has
 * the structure of its operand cell, with each leaf replaced by
 * `elementType`: `Sin` of `[[1, 2], 3]` is `[[Sin(1), Sin(2)], Sin(3)]`,
 * typed `list<list<R> | R>`. The ranks are read from the operand types, so
 * a per-element result that is itself a list does not hide them.
 *
 * Each arm is mirrored as follows:
 * - a scalar arm is `elementType`;
 * - a list arm is a list of the mirrored cell;
 * - a tuple arm is `elementType` or a tuple of `elementType` components,
 *   because a head can map a point component-wise (`Sin`) or read it as one
 *   value (`Abs`);
 * - an arm with no stated shape (`any`, `unknown`), a nominal type, and a
 *   cut of a self-referential alias are `any`, which holds a cell of any
 *   shape, an absent one included (`unknown` would be dropped as the empty
 *   case when the absorption of an absent cell widens the cell type); a
 *   transparent alias is read as its definition;
 * - a `missing` arm is `absentCell`: the result for an absent cell, which is
 *   `elementType` unless the caller knows better. For an operator that
 *   propagates absence the caller strips the `missing` arms first and adds
 *   the marker of an absent cell afterwards (`absorbOperandAbsence`,
 *   `broadcast-lift-type.ts`).
 *
 * With two operands, a result cell takes the structure of the deeper of its
 * two operand cells, so the result cell is the union of the mirrored cells of
 * every operand.
 *
 * `undefined` when no operand is a list with a ragged cell: the caller then
 * keeps the shaped form.
 */
function raggedBroadcastResultType(
  operandTypes: ReadonlyArray<Readonly<Type>>,
  elementType: Readonly<Type>,
  absentCell: Readonly<Type> = elementType
): Type | undefined {
  if (!operandTypes.some(mayHaveRaggedCells)) return undefined;
  let ragged = false;
  // The rank of the cells of type `t` (0 for a scalar), or `undefined` when
  // it is not one number. A union whose arms do not have one rank is ragged.
  // A `missing` arm is a scalar arm: the result for an absent cell is a
  // scalar (`NaN`, `Missing`, or the boolean of `And(Missing, False)`).
  const rankOf = (
    t: Readonly<Type>,
    depth: number,
    seen?: AliasDescent
  ): number | undefined => {
    if (depth > MAX_CELL_DEPTH) return undefined;
    const unfolded = unfoldAliasOnDescent(t, seen);
    if (unfolded === undefined) return undefined;
    const r = unfolded.type;
    if (typeof r === 'string') return isShapeOpenType(r) ? undefined : 0;
    switch (r.kind) {
      case 'union': {
        let rank: number | undefined;
        let mixed = false;
        for (const arm of r.types) {
          const k = rankOf(arm, depth, unfolded.seen);
          if (k === undefined || (rank !== undefined && k !== rank))
            mixed = true;
          else rank = k;
        }
        if (mixed) {
          ragged = true;
          return undefined;
        }
        return rank ?? 0;
      }
      case 'list':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable': {
        const levels = collectionLevels(r);
        const inner = rankOf(
          r.elements,
          depth + levels,
          descendIntoConstructor(unfolded.seen)
        );
        return inner === undefined ? undefined : levels + inner;
      }
      case 'tuple':
      case 'numeric':
      case 'value':
        return 0;
      default:
        return undefined;
    }
  };
  for (const t of operandTypes) {
    if (typeof t === 'string' || t.kind !== 'list') return undefined;
    rankOf(listCellType(t), 1);
  }
  if (!ragged) return undefined;

  // A union built here is flattened into a union that contains it, and an
  // arm that occurs twice is kept once. Any other union (a union
  // `elementType`) is kept as one arm.
  const built = new WeakSet<object>();
  const union = (arms: ReadonlyArray<Type>): Type => {
    const keys = new Set<string>();
    const types: Type[] = [];
    const add = (arm: Type) => {
      if (typeof arm !== 'string' && built.has(arm)) {
        for (const m of (arm as { types: Type[] }).types) add(m);
        return;
      }
      const key = typeToDedupKey(arm);
      if (keys.has(key)) return;
      keys.add(key);
      types.push(arm);
    };
    for (const arm of arms) add(arm);
    // Beside an `any` arm, an arm that states no shape (`unknown`, `value`,
    // `expression`) adds nothing, since `any` holds it, and it is dropped. A
    // shaped arm is kept (`any | list<number>`): it records the mirrored
    // structure of a list cell. An absent arm beside a shape-open arm gives
    // the dropped case: for an `unknown` per-element result,
    // `list<missing | unknown>` mirrors `missing` to `unknown` and `unknown`
    // to `any`, and the cell was the unreduced `unknown | any`.
    if (types.includes('any')) {
      const shaped = types.filter(
        (t) => t !== 'unknown' && t !== 'value' && t !== 'expression'
      );
      types.length = 0;
      types.push(...shaped);
    }
    if (types.length === 1) return types[0];
    const result: Type = { kind: 'union', types };
    built.add(result);
    return result;
  };
  const mirror = (
    t: Readonly<Type>,
    depth: number,
    seen?: AliasDescent
  ): Type => {
    if (depth > MAX_CELL_DEPTH) return 'any';
    const unfolded = unfoldAliasOnDescent(t, seen);
    if (unfolded === undefined) return 'any';
    const r = unfolded.type;
    if (typeof r === 'string') {
      if (r === 'missing') return absentCell as Type;
      if (r === 'tuple') return union([elementType as Type, 'tuple']);
      return isShapeOpenType(r) ? 'any' : (elementType as Type);
    }
    switch (r.kind) {
      case 'union':
        return union(r.types.map((m) => mirror(m, depth, unfolded.seen)));
      case 'list':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable': {
        const elements = mirror(
          r.elements,
          depth + collectionLevels(r),
          descendIntoConstructor(unfolded.seen)
        );
        return r.kind === 'list' && r.dimensions !== undefined
          ? { kind: 'list', elements, dimensions: r.dimensions }
          : { kind: 'list', elements };
      }
      case 'tuple':
        // A component that is not a scalar has no mirrored form here.
        if (
          !r.elements.every(
            (e) => rankOf(e.type, depth + 1, unfolded.seen) === 0
          )
        )
          return 'any';
        return union([
          elementType as Type,
          {
            kind: 'tuple',
            elements: r.elements.map((e) => ({
              ...e,
              type: elementType as Type,
            })),
          },
        ]);
      case 'numeric':
      case 'value':
        return elementType as Type;
      default:
        return 'any';
    }
  };
  return {
    kind: 'list',
    elements: union(
      operandTypes.map((t) => mirror(listCellType(t as ListType), 1))
    ),
  };
}

/** The scalar leaf type of a (possibly nested/dimensioned) collection type:
 *  descend list-kind elements to the non-list leaf. `null` when the leaf is
 *  not statically known (bare `list`/`collection`, `unknown`/`any` element). */
function collectionLeafType(
  t: Readonly<Type>,
  seen?: AliasDescent
): Type | null {
  // A transparent alias of a collection has the leaf of the collection it
  // names (same rule, and same descent guard, as `staticCollectionDims`).
  const unfolded = unfoldAliasOnDescent(t, seen);
  if (unfolded === undefined) return null;
  t = unfolded.type;
  seen = unfolded.seen;
  if (typeof t === 'string') return null; // bare collection kind — no element info
  if (t.kind === 'list') {
    const element = unfoldAliasOnDescent(t.elements, seen);
    if (element === undefined) return null;
    const el = element.type;
    if (el === 'unknown' || el === 'any') return null;
    if (typeof el !== 'string' && el.kind === 'list')
      return collectionLeafType(el, element.seen);
    return el;
  }
  if (
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'broadcastable'
  ) {
    const element = unfoldAliasOnDescent(t.elements, seen);
    if (element === undefined) return null;
    const el = element.type;
    if (el === 'unknown' || el === 'any') return null;
    // Recurse through a collection-kind element to the LEAF, exactly as the
    // `list` branch above does. Without this, a refined
    // `indexed_collection<vector<integer^2>>` (the shape a
    // placeholder-declared symbol takes from an assigned list of points —
    // Phase 1, 2026-08-18) reported its ROW as the leaf, and the
    // leaf-disjointness refutation compared `vector<…>` against `number`
    // and wrongly refuted an operand whose runtime value fits.
    if (
      typeof el !== 'string' &&
      (el.kind === 'list' ||
        el.kind === 'collection' ||
        el.kind === 'indexed_collection')
    )
      return collectionLeafType(el, element.seen);
    return el as Type;
  }
  return null;
}

/**
 * Overlap test for **deferred validation** (§D6.2 of
 * `docs/COLLECTIONS-MODEL.md`): called after
 * `.matches(param)` failed, for a collection-kind `param` (a `matrix`/
 * `vector`/`list<…>` signature parameter). Returns `true` when the operand's
 * static type does not *refute* conformance — i.e. the operand could still
 * evaluate to a conforming value — so the operator accepts it provisionally
 * and runtime conformance is left to the operator's own evaluate-time gate
 * (handler precedence; a nonconforming or still-symbolic operand stays
 * inert or gets the handler's specific error).
 *
 * Refutations (→ `false`, keep the canonicalization-time error):
 * - the operand type is not collection-like at all (a string, a number, …);
 * - both ranks are statically known and differ (`list<number>` — provably
 *   rank 1 with *number* elements — can never be a `matrix`);
 * - both leaf element types are known and disjoint (`list<list<string>>`
 *   vs `matrix`).
 *
 * Non-refutable (→ `true`): bare `list`/`collection`/`indexed_collection`;
 * unknown/`any` elements; `broadcastable<R>` (its collection alternative has
 * open rank — the rank-unknowable case §D6.1 identifies) with a compatible
 * leaf; rank-compatible nested lists with compatible leaves.
 */
/**
 * The slots of a TUPLE-shaped type, for the deferral test above:
 * `'not-a-tuple'` when the type is not a tuple at all, `'unknown-arity'` for
 * the bare `tuple` (which states no arity), and the slots themselves
 * otherwise.
 *
 * The whole `NamedElement` is returned, not just its type: a slot NAME is a
 * conformance constraint, so `tuple<x: number>` and `tuple<y: number>` are not
 * interchangeable and the caller has to see the names to refute them.
 *
 * A transparent alias is unfolded first, for the same reason `collectionLeafType`
 * unfolds one: a parameter or operand may name its tuple through an alias
 * (`type alias Point = tuple<number, number>`), and reading the reference node
 * as "not a tuple" would decline the deferral for exactly the shapes it exists
 * to admit. A NOMINAL reference is deliberately left folded — it does not
 * subtype its definition, and treating it as its definition here would admit
 * what the lattice refuses.
 */
function tupleSlots(
  t: Readonly<Type>
): NamedElement[] | 'unknown-arity' | 'not-a-tuple' {
  const unfolded = unfoldAliasOnDescent(t, undefined);
  if (unfolded === undefined) return 'not-a-tuple';
  t = unfolded.type;
  if (t === 'tuple') return 'unknown-arity';
  if (typeof t === 'string' || t.kind !== 'tuple') return 'not-a-tuple';
  return t.elements;
}

/** Whether a tuple slot's type is itself a tuple or a list, collection or
 * indexed collection: the kinds `overlapsForDeferredValidation` compares
 * structurally. */
function isCompositeSlotType(t: Readonly<Type>): boolean {
  if (tupleSlots(t) !== 'not-a-tuple') return true;
  if (typeof t === 'string')
    return t === 'list' || t === 'collection' || t === 'indexed_collection';
  return (
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection'
  );
}

export function overlapsForDeferredValidation(
  t: Readonly<Type>,
  param: Readonly<Type>
): boolean {
  return overlapsDeferred(t, param, undefined);
}

/**
 * The nested comparison of two composite types (two tuple slots, or two tuple
 * leaves of collections) by {@link overlapsDeferred}, with a guard against
 * transparent recursive aliases.
 *
 * `tupleSlots` unfolds an alias with a fresh descent on every call, so two
 * aliases that reach themselves through their own slots (`type alias A =
 * tuple<list<A>, unknown, integer>` against `type alias B = tuple<list<B>,
 * number, number>`) would be compared again and again until the stack
 * overflows. `visiting` holds the pairs being compared on the current path,
 * keyed by their printed form, which names an alias instead of expanding it
 * and is therefore finite. A pair met again on its own path is taken to
 * overlap: the cycle by itself refutes nothing (an empty list ends it, so
 * `([], 5, 3)` is a value of both aliases above), and every slot that could
 * refute the pair is still checked on the first pass. Overlap only defers
 * the decision to the runtime check, so this answer is the safe one.
 */
function overlapsNested(
  t: Readonly<Type>,
  param: Readonly<Type>,
  visiting: Set<string> | undefined
): boolean {
  const key = `${typeToDedupKey(t as Type)}\u0000${typeToDedupKey(param as Type)}`;
  if (visiting?.has(key)) return true;
  const path = visiting ?? new Set<string>();
  path.add(key);
  try {
    return overlapsDeferred(t, param, path);
  } finally {
    path.delete(key);
  }
}

function overlapsDeferred(
  t: Readonly<Type>,
  param: Readonly<Type>,
  visiting: Set<string> | undefined
): boolean {
  // Union parameter (`matrix|vector` — the MatrixMultiply/Dot/LinearSolve
  // family): defer if any arm would. Union operand: any arm not refuted.
  if (typeof param !== 'string' && param.kind === 'union')
    return param.types.some((arm) => overlapsDeferred(t, arm, visiting));
  if (typeof t !== 'string' && t.kind === 'union')
    return t.types.some((arm) => overlapsDeferred(arm, param, visiting));

  // TUPLE parameters participate too, and only against a tuple operand.
  //
  // Without this arm there was a HOLE. A tuple-shaped parameter is exempt from
  // the general overlap admission (`runtimeCheckExemptParam` classes it with
  // the collection kinds, because `typesOverlap` is unsound for them — it
  // reads `list<number> ∧ matrix` as inhabited, since the empty list inhabits
  // both), so this function is the authority for such a parameter. But it
  // recognized only `list`, `collection` and `indexed_collection`, so a tuple
  // parameter reached NEITHER admission and every union operand with a tuple
  // member was refused.
  //
  // That is what made a library operator disagree with a user function
  // declared with the identical signature: `PointX`, declared
  // `(xs: collection<any> | tuple) -> any`, refused an indexed point carrier
  // typed `missing | number | tuple<number, number>` — one member of which
  // satisfies the parameter exactly — while a user `g` of the same signature
  // admitted it (Tycho item 257).
  //
  // Only the tuple/tuple pairing defers. A tuple operand at a collection
  // parameter, or a collection operand at a tuple parameter, keeps the
  // refusal it has today; the union distribution above means one admitting
  // pair is enough to admit the whole operand.
  const paramTupleSlots = tupleSlots(param);
  const opTupleSlots = tupleSlots(t);
  if (paramTupleSlots !== 'not-a-tuple' || opTupleSlots !== 'not-a-tuple') {
    if (paramTupleSlots === 'not-a-tuple' || opTupleSlots === 'not-a-tuple')
      return false;
    // A bare tuple constrains neither arity nor slot contents.
    if (paramTupleSlots === 'unknown-arity' || opTupleSlots === 'unknown-arity')
      return true;
    // Arity refutation: a 2-tuple can never be a 3-tuple. This is the tuple
    // counterpart of the rank refutation the list arm performs below.
    if (paramTupleSlots.length !== opTupleSlots.length) return false;
    // Slot refutation, with the same either-direction `isSubtype`
    // approximation the leaf refutation below documents: two slots that are
    // incomparable are treated as disjoint.
    for (let i = 0; i < paramTupleSlots.length; i++) {
      // A NESTED top in the OPERAND is refuted, and must be tested before the
      // either-direction check below would waive it. The top-type waiver
      // (design decision D8) applies to a top arriving as the WHOLE operand's
      // type; under a constructor there is no ground counterpart to preserve,
      // because `(tuple<number>) -> number` refuses a `tuple<any>` operand and
      // the deferring reading must not be looser than the ground signature.
      // Without this the either-direction test admits it: `any` is a supertype
      // of `number`, so `isSubtype(paramSlot, opSlot)` holds and a top slot
      // reads exactly like the ordinary deferral case (a `number` slot that
      // may hold an integer at run time).
      const opSlot = opTupleSlots[i].type;
      const paramSlot = paramTupleSlots[i].type;
      // A slot NAME is part of the contract: `tuple<x: number>` does not
      // satisfy `tuple<y: number>`, and `isSubtype` refuses it. Only two
      // EXPLICIT and different names refute — a named slot still pairs with an
      // unnamed one, which is the name erasure the lattice already permits.
      const opName = opTupleSlots[i].name;
      const paramName = paramTupleSlots[i].name;
      if (
        opName !== undefined &&
        paramName !== undefined &&
        opName !== paramName
      )
        return false;
      // An `unknown` slot in the operand is a placeholder, not a top the
      // operand claims: nothing is known about that component yet, so it
      // refutes nothing and the slot is deferred to the runtime check, as a
      // whole operand typed `unknown` is (user decision 2026-09-30). A list
      // of tuples built from element reads of values whose types are not
      // known yet, `[(A[1], A[2], A[3], 1)]` typed
      // `list<tuple<unknown, unknown, unknown, integer>>`, was refused at a
      // parameter declared `list<tuple<number, number, number, number>>`.
      // `any` stays refuted: it admits the absence markers, which a value
      // slot of the parameter does not.
      if (opSlot === 'unknown') continue;
      const paramSlotIsTop = paramSlot === 'any' || paramSlot === 'unknown';
      if (opSlot === 'any' && !paramSlotIsTop) return false;
      // Two COMPOSITE slots (a tuple or a collection each) are compared by
      // this function again, so that an `unknown` component nested deeper
      // defers too. A scalar or union slot keeps the either-direction test
      // alone.
      if (
        !isSubtype(opSlot, paramSlot) &&
        !isSubtype(paramSlot, opSlot) &&
        !(
          isCompositeSlotType(opSlot) &&
          isCompositeSlotType(paramSlot) &&
          overlapsNested(opSlot, paramSlot, visiting)
        )
      )
        return false;
    }
    return true;
  }

  // Only collection-kind parameters participate in deferral. A `string`
  // operand is deliberately NOT treated as collection-like below, even though
  // a string IS an indexed collection of its grapheme clusters: deferral
  // exists for operands whose conformance cannot be decided statically (a bare
  // `list`, unknown elements), and a string's element type is fully known
  // (`character`), so `isSubtype` decides it exactly. Admitting it here would
  // defer — and therefore accept — `Determinant("abc")`, whose `matrix`
  // parameter a string can never satisfy.
  const paramIsCollection =
    (typeof param === 'string' &&
      (param === 'list' ||
        param === 'collection' ||
        param === 'indexed_collection')) ||
    (typeof param !== 'string' &&
      (param.kind === 'list' ||
        param.kind === 'collection' ||
        param.kind === 'indexed_collection'));
  if (!paramIsCollection) return false;

  // Operand must itself be collection-like (or a broadcastable, whose
  // collection alternative is in play).
  const isCollectionLike =
    (typeof t === 'string' &&
      (t === 'list' ||
        t === 'collection' ||
        t === 'indexed_collection' ||
        // An index span is collection-like for deferral purposes.
        t === 'range')) ||
    (typeof t !== 'string' &&
      (t.kind === 'list' ||
        t.kind === 'collection' ||
        t.kind === 'indexed_collection' ||
        t.kind === 'broadcastable' ||
        // A set is collection-like at a `collection<T>` parameter of rank 1
        // only: `set<unknown>` at `collection<number>` is decided when the
        // set has elements. A set is not indexed, so it never defers at an
        // `indexed_collection<T>` parameter. `collectionLeafType` does not
        // read a set, so its elements are compared by the element check
        // below.
        (t.kind === 'set' &&
          typeof param !== 'string' &&
          param.kind === 'collection' &&
          abstractCollectionDims(param) !== null)));
  if (!isCollectionLike) return false;

  // Element refutation at an abstract collection parameter of rank 1
  // (`collection<number>`, `abstractCollectionDims`). Its elements are
  // not lists, so an operand whose immediate elements must be lists
  // (`list<list<number>>`, rows of unknown length) is refused, as is one
  // whose elements cannot be of the element type (`set<boolean>` at
  // `collection<number>`). The leaf refutation below reads the innermost
  // cells, so it compares `number` with `number` for nested rows. An
  // element type that is not known yet (`unknown`, `any`) is deferred.
  if (abstractCollectionDims(param) !== null) {
    const paramElement = immediateElementType(param);
    const opElement = immediateElementType(t);
    if (
      paramElement !== undefined &&
      opElement !== undefined &&
      opElement !== 'unknown' &&
      opElement !== 'any'
    ) {
      if (isSubtype(opElement, LIST_OF_ANY)) return false;
      if (provablyDisjoint(opElement, paramElement)) return false;
    }
  }

  // Rank refutation — only when both ranks are statically known. A
  // `broadcastable` operand has open rank (never refuted on rank).
  if (typeof t !== 'string' && t.kind === 'list') {
    const opDims = staticCollectionDims(t);
    const paramDims =
      staticCollectionDims(param) ?? abstractCollectionDims(param);
    if (opDims !== null && paramDims !== null) {
      if (opDims.length !== paramDims.length) return false;
      for (let i = 0; i < opDims.length; i++)
        if (
          opDims[i] !== -1 &&
          paramDims[i] !== -1 &&
          opDims[i] !== paramDims[i]
        )
          return false;
    }
  }

  // Leaf refutation — only when both leaves are statically known.
  // LIMITATION (known approximation): either-direction `isSubtype` treats
  // incomparable-but-overlapping leaves as disjoint (e.g. two unions
  // sharing a member, `string|number` vs `number|boolean`). Sound in the
  // conservative direction for the current signature inventory (all
  // collection params have `number`-family leaves); replace with a real
  // type meet if a union-leaf collection parameter is ever added.
  const opLeaf = collectionLeafType(t);
  const paramLeaf = collectionLeafType(param);
  if (opLeaf !== null && paramLeaf !== null) {
    if (
      !isSubtype(opLeaf, paramLeaf) &&
      !isSubtype(paramLeaf, opLeaf) &&
      // Two TUPLE leaves are compared slot by slot (the tuple arm above),
      // so that a tuple element with `unknown` components defers as the
      // same tuple does when it is the whole operand.
      !(
        tupleSlots(opLeaf) !== 'not-a-tuple' &&
        tupleSlots(paramLeaf) !== 'not-a-tuple' &&
        overlapsNested(opLeaf, paramLeaf, visiting)
      )
    )
      return false;
  }

  return true;
}

/**
 * The scalar element type that a broadcastable operator's result contributes to
 * its broadcast `list<…>`. A handler may have computed the scalar per-element
 * type directly (`number`), leaked the collection type (`list<number>` — e.g.
 * `Negate` returning `x.type`), or — when a collection operand reached a naive
 * handler such as `Mod`'s or `Remainder`'s `widen(…)` — a `scalar | list<E>`
 * union. Unwrap any collection branch to its element type and widen the
 * branches, so the wrapper never nests a list or a union inside the broadcast
 * result. (For a plain scalar this is the identity.)
 *
 * `string` is the one collection type that is NOT unwrapped. A string is an
 * indexed collection of its characters, but it is ATOMIC under broadcast —
 * a string is not a tensor, so it is not a `broadcastable<character>` — so
 * a `-> string` handler result contributes a whole `string` per cell, never
 * a `character`. Without the
 * exception `String("x=", [1, 2])`, whose value is `["x=1", "x=2"]`, typed
 * `list<character^2>`.
 *
 * A union with NO collection branch is already a scalar per-element type and
 * is returned verbatim. Widening it would only lose information — the union
 * IS the tightest name for the set — and the lattice often has no tighter
 * supertype than `number`: `LogIntegral`'s honest claim
 * `+oo | -oo | real` would otherwise reach the broadcast wrapper as
 * `list<number>`.
 */
export function broadcastElementType(
  type: Readonly<Type>,
  seen?: AliasDescent
): Type {
  // A transparent alias of a collection is unwrapped like the collection it
  // names, and an alias of a union of collections is descended arm by arm.
  // A SCALAR alias contributes its own type, name included (`meters`, not
  // `number`), like every other scalar. The unfold runs under the descent
  // guard: a self-referential alias (`type alias cyc = cyc | 0`) is
  // returned unchanged at its first repeat (`unfoldAliasOnDescent`).
  const unfolded = unfoldAliasOnDescent(type, seen);
  if (unfolded === undefined) return type as Type;
  const r = unfolded.type;
  if (typeof r !== 'string' && r.kind === 'union') {
    const branches = r.types.map((t) => broadcastElementType(t, unfolded.seen));
    if (branches.every((t, i) => t === r.types[i])) return type as Type;
    return widen(...branches);
  }
  if (r === 'string') return type as Type;
  // A `broadcastable<T>` contributes `T`: the broadcast reaches the cells
  // of its collection arm, which are `T`. A tensor (a dimension list, or an
  // unknown rank) contributes its cells `U`, not its rows: the broadcast
  // reaches every cell. `collectionElementType` would answer the rows of a
  // matrix and `T | tensor<T>` for a broadcastable, which every reader of
  // the broadcast cell would then inherit.
  if (typeof r !== 'string' && r.kind === 'broadcastable') return r.elements;
  if (typeof r !== 'string' && r.kind === 'list' && r.dimensions !== undefined)
    return r.elements;
  return collectionElementType(r) ?? (type as Type);
}

/**
 * The type of the values an operand contributes to an application under a
 * broadcast lift: the operand's own type for a scalar, and its element
 * type with EVERY collection rank unwrapped for a collection —
 * `broadcastElementType` applied to its fixpoint (it returns its argument
 * by reference when no descent is possible). A type handler or a
 * `definedWhen` predicate that reads this claims per CELL, which is what
 * the lift re-shapes; the Contract B result adjustment reads it to find
 * NaN evidence in a lifted operand's cells.
 */
export function broadcastCellType(type: Readonly<Type>): Type {
  let t = type as Type;
  let spellings: Set<string> | undefined;
  for (;;) {
    const e = broadcastElementType(t);
    if (e === t) return t;
    // A self-referential alias can unwrap to a type that is never the same
    // object as its predecessor yet repeats in spelling — the arms of
    // `type alias json = list<json> | integer` widen to a fresh union on
    // every turn — so the descent also stops at the first repeated
    // spelling. An ordinary type has finite rank and never repeats.
    const spelling = typeToString(t);
    if (spellings?.has(spelling)) return t;
    (spellings ??= new Set()).add(spelling);
    t = e;
  }
}

/**
 * A `broadcastable<S>` operand COULD be a plain scalar `S` at runtime — that
 * is the meaning of the lift (`S`, or a list of `S` that
 * broadcasts). When the scalar base matches the parameter type, admit the
 * operand instead of baking a type error: before the lift the same expression
 * typed plain `S` and was admitted by the `matches(param)` check, so this
 * exactly restores that admission (e.g. `Totient(p^e(k))` where `e(k)` is an
 * unknown application lifts `Power` to `broadcastable<number>`, which a
 * `number` parameter must still accept). Same COULD-semantics as
 * `typeCouldBeNumericCollection`.
 *
 * Lives here rather than in `boxed-expression/validate.ts` so that the
 * write-free overload filter (`boxed-expression/overload.ts`) can share the
 * exact same admission rule without importing `validate.ts` — which would
 * close a cycle, since `validate.ts` imports the resolver.
 */
export function broadcastableBaseMatches(
  type: Readonly<Type>,
  param: Readonly<Type>
): boolean {
  if (typeof type === 'string') return false;
  if (type.kind === 'broadcastable')
    return isSubtype(type.elements, param as Type);
  if (type.kind === 'union')
    return type.types.some((t) => broadcastableBaseMatches(t, param));
  return false;
}

/**
 * Whether an expression of type `t` is accepted where a BOOLEAN is expected
 * (a condition, a predicate, a `boolean` rule wildcard): `t` is a boolean
 * type, or it is `broadcastable<R>` (alone or as an arm of a union) with a
 * boolean `R`.
 *
 * `broadcastable<boolean>` is the type of a comparison whose operand may be
 * a collection or a scalar until it is evaluated: `Sin(P) > x` with `P`
 * declared `collection<number>` and no value. Its scalar arm may be the
 * value, so it is admitted, as a typed parameter admits it
 * (`broadcastableBaseMatches`).
 */
export function isBooleanOrBroadcastableBooleanType(
  t: Readonly<Type>
): boolean {
  return (
    isSubtype(t as Type, 'boolean') || broadcastableBaseMatches(t, 'boolean')
  );
}

/**
 * True if `t` provably denotes a non-real number: a subtype of `complex` that
 * is not a subtype of `real` (`complex`, `imaginary`, …). The top numeric
 * name `number` answers `false` — it is a SUPERTYPE of `complex`, not a
 * subtype — and so does every real tier, so a generic numeric result typed
 * `number` reads as the compiler's REAL lane.
 *
 * Note that under the `real ⊂ complex` convention a bare
 * `isSubtype(t, 'complex')` is also true for every real type, so it cannot be
 * used on its own as an "is complex-valued" test.
 */
export function isNonRealNumber(t: Readonly<Type>): boolean {
  return isSubtype(t as Type, 'complex') && !isSubtype(t as Type, 'real');
}

/**
 * Whether every value of the static type `t` is a member of `target`, in
 * the three-valued discipline the membership predicates (`isNumber`,
 * `isInteger`, `isRational`) answer with: `true` when `t` is a subtype of
 * `target` (every value is a member), `false` when the two types are
 * provably disjoint (no value is), and `undefined` otherwise — the types
 * overlap, so the answer depends on the value. `unknown` and `any` are
 * always undecided.
 *
 * The distinction matters for a claimed type that is a HEDGE rather than a
 * proof: `Divide(k, 2)` for an integer `k` claims `real`, and `Sqrt(x)` for
 * a real `x` of unknown sign claims `complex`; neither claim proves the
 * value is not an integer, so a two-valued "not a subtype of `integer`"
 * answer would have called `k / 2` a non-integer for an even `k`.
 */
export function staticMembership(
  t: Readonly<Type>,
  target: Readonly<Type>
): boolean | undefined {
  if (t === 'unknown' || t === 'any') return undefined;
  if (isSubtype(t as Type, target as Type)) return true;
  if (provablyDisjoint(t as Type, target as Type)) return false;
  return undefined;
}

/**
 * `t` with its infinite and NaN branches dropped.
 *
 * Written for the compiler's real-versus-complex LANE question, which asks
 * about the SHAPE of an emitted value — a plain number, or a `{re, im}`
 * object. An infinity or a NaN is representable in both shapes, so it
 * decides nothing there; the finite part of the claim does. This matters
 * because a head whose value can blow up must spell its result as a union
 * now that the bare numeric names are finite — `Artanh(r)` claims
 * `complex | +oo | -oo` — and `isNonRealNumber` of that whole union
 * is `false`, which would report a real lane for a head whose emitter
 * produces `{re, im}`.
 *
 * Returns `t` unchanged when it is not a union, and when dropping the
 * branches would leave nothing (a claim of `+oo | -oo` alone has no
 * finite part to read).
 */
export function finitePartOfType(t: Readonly<Type>): Type {
  if (typeof t === 'string' || t.kind !== 'union') return t as Type;
  const finite = t.types.filter(
    (b) => !isSubtype(b, 'infinity') && !isSubtype(b, 'nan')
  );
  if (finite.length === 0 || finite.length === t.types.length) return t as Type;
  return finite.length === 1 ? finite[0] : { kind: 'union', types: finite };
}

/**
 * True if an operand of type `t` could be a non-real number: either the type
 * is a supertype of `complex` (`number`, `any`), or it is a numeric type
 * outside `real` (a complex literal types as `complex`, `i` as
 * `imaginary` — neither is a *supertype* of `complex`, so the first check
 * alone misses actual complex-valued operands).
 *
 * Used to decide whether numeric arguments should be inferred as `number`
 * rather than `real`.
 *
 * Note the argument order in the first check: `isSubtype('complex', t)` asks
 * whether `t` is a *supertype* of `complex` — it is NOT true for `real` and
 * its subtypes:
 *
 * - `real`, `integer`, `rational` → `false`
 * - `number`, `any`, `unknown` → `true` (could be non-real)
 * - `complex`, `imaginary` → `true` (is non-real)
 */
export function couldBeNonRealNumber(t: Readonly<Type>): boolean {
  return (
    isSubtype('complex', t as Type) ||
    (isSubtype(t as Type, 'number') && !isSubtype(t as Type, 'real'))
  );
}

/**
 * Does `t` contain a function-signature arm ANYWHERE — including inside
 * composite types (list elements, tuple/record members, dictionary values,
 * unions/intersections, negations, broadcastable bases, nominal references)?
 *
 * This is the `callable` write-classifier of the state-event design
 * (`docs/EFFECTS-MODEL.md` §4): a value
 * write or def retype is callable-relevant iff either side's effective type
 * passes this test. It deliberately reaches FARTHER than `couldBeCallable`
 * in `effects-of.ts`: the effects projection can surface an arm stored
 * inside a composite through type-level operations (an `At` over a callback
 * list yields `signature | nothing` — the R1 repro), so the classifier must
 * match that reach or a relevant write escapes the axis.
 *
 * Policy (§4): exhaustive switch over the `Type` union; opaque or
 * unrecognized kinds classify as CONTAINING (fail-conservative — a spurious
 * event is a lost optimization, a missed one is a stale cache). Nominal
 * references expand through their embedded `def` with a cycle guard.
 */
export function containsSignatureArm(t: Type | undefined): boolean {
  return containsArm(t, undefined);
}

function containsArm(
  t: Type | undefined,
  visited: Set<Readonly<Type>> | undefined
): boolean {
  if (t === undefined) return false;
  if (typeof t === 'string')
    return t === 'function' || t === 'unknown' || t === 'any';
  switch (t.kind) {
    case 'signature':
      return true;
    case 'variable':
      // A type variable can instantiate to anything: conservative.
      return true;
    case 'union':
    case 'intersection':
      return t.types.some((x) => containsArm(x, visited));
    case 'negation':
      return containsArm(t.type, visited);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return containsArm(t.elements, visited);
    case 'tuple':
      return t.elements.some((e) => containsArm(e.type, visited));
    case 'record':
    case 'object':
      return Object.values(t.elements).some((x) => containsArm(x, visited));
    case 'dictionary':
      return containsArm(t.values, visited);
    case 'reference': {
      // Cycle guard: recursive nominal types reach their own reference.
      if (visited?.has(t)) return false;
      (visited ??= new Set()).add(t);
      // An applied parameterized nominal keeps its type ARGUMENTS
      // (`tree<(number) -> number>`): an arm can live there even when the
      // declaration body carries none.
      if (t.args?.some((x) => containsArm(x, visited))) return true;
      if (t.def === undefined) return true; // opaque: conservative
      return containsArm(t.def, visited);
    }
    case 'value':
    case 'symbol':
    case 'expression':
    case 'numeric':
      return false;
    default:
      // A kind this switch does not know (added later): conservative.
      return true;
  }
}

/**
 * The sign every value admitted by a numeric type must have, or `undefined`
 * when the type does not decide one.
 *
 * This is how a *ranged declaration* reaches the sign channel: a symbol
 * declared `integer<1..>` is positive, `real<0..>` is non-negative,
 * `real<..0>` is non-positive, and the intersection spelling of "positive"
 * — `real<0..> & !0` — combines a bound with a `!0` exclusion. A value type
 * (`21`, `-3`) answers with its exact sign.
 *
 * Sound rules only:
 * - A range claims a sign only when its BASE excludes NaN and is
 *   real-valued (a complex or imaginary base has no sign). The bases that
 *   qualify are listed in `REAL_NAN_FREE_PRIMITIVES` below; `number` and
 *   `nan` are absent because a NaN value has no sign, `infinity` is absent
 *   because it admits the unsigned `~oo`, and `complex` and `imaginary` are
 *   absent because a value off the real axis has no sign either. The SIGNED
 *   infinities are signed reals here (`+∞` is positive), so an unbounded
 *   side does not block a claim; a signed-infinity VALUE type carries its
 *   sign as a point.
 * - An intersection may combine facts from its members (the intersection is
 *   a subset of each member, so any member's sign constraint holds); members
 *   that carry no sign information are ignored.
 * - A union claims only what EVERY member proves; one undecided member makes
 *   the union undecided.
 *
 * The result vocabulary is the subset of the engine's `Sign` type that a
 * type can express (a type never proves `unsigned`).
 */
const REAL_NAN_FREE_PRIMITIVES = new Set(['integer', 'rational', 'real']);

export function signOfType(
  t: Readonly<Type> | undefined,
  seen?: Set<object>
):
  | 'positive'
  | 'negative'
  | 'zero'
  | 'non-negative'
  | 'non-positive'
  | 'not-zero'
  | undefined {
  if (t === undefined || typeof t === 'string') return undefined;
  // A TRANSPARENT alias is semantically identical to its definition
  // (`type alias positive_int = integer<1..>`), so unfold it; a nominal
  // reference stays opaque. The `seen` set breaks a recursive alias.
  if (t.kind === 'reference') {
    if (!t.alias || t.def === undefined) return undefined;
    seen ??= new Set();
    if (seen.has(t)) return undefined;
    seen.add(t);
    return signOfType(t.def, seen);
  }
  switch (t.kind) {
    case 'value': {
      const v = t.value;
      if (typeof v !== 'number' || Number.isNaN(v)) return undefined;
      return v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
    }
    case 'numeric': {
      // Only a real-valued, NaN-free base can claim a sign (see above). The
      // test is the INCLUSION list, not a list of bases to reject: an
      // exclusion list silently admits every base nobody thought to name —
      // `infinity` (which contains the unsigned `~oo`), `nan`, and `complex`
      // (which contains the finite off-axis values) all have no sign, and
      // none is reachable through the range parser today, so a hand-built
      // type was the only witness.
      if (!REAL_NAN_FREE_PRIMITIVES.has(t.type)) return undefined;
      const lo = t.lower ?? -Infinity;
      const hi = t.upper ?? Infinity;
      // An OPEN endpoint at 0 proves the strict sign directly (`real<0<..>`
      // is "x > 0"); a closed one proves the weak sign.
      if (lo > 0 || (lo === 0 && t.lowerOpen === true)) return 'positive';
      if (hi < 0 || (hi === 0 && t.upperOpen === true)) return 'negative';
      if (lo === 0 && hi === 0) return 'zero';
      if (lo === 0) return 'non-negative';
      if (hi === 0) return 'non-positive';
      return undefined;
    }
    case 'negation':
      // A BARE `!0` proves no sign: it is the complement of the value `0`
      // over the whole type universe, so it admits strings, collections and
      // NaN — none of which has a sign. The zero exclusion becomes usable
      // only inside an intersection whose other members prove a NaN-free
      // real domain (`real<0..> & !0`), which the intersection arm below
      // handles by reading the negation member directly.
      return undefined;
    case 'intersection': {
      let ge0 = false; // every admitted value is >= 0
      let le0 = false; // every admitted value is <= 0
      let notZero = false; // no admitted value is 0
      // A sign claim needs at least one member proving a NaN-free real
      // domain (`real`, a range over one, a numeric value): `!0` alone, or
      // `!0 & string`, must claim nothing.
      let realDomain = false;
      for (const member of t.types) {
        if (typeof member === 'string') {
          if (REAL_NAN_FREE_PRIMITIVES.has(member)) realDomain = true;
          continue;
        }
        if (
          member.kind === 'negation' &&
          typeof member.type === 'object' &&
          member.type.kind === 'value' &&
          member.type.value === 0
        ) {
          notZero = true;
          continue;
        }
        if (
          member.kind === 'numeric' &&
          REAL_NAN_FREE_PRIMITIVES.has(member.type)
        )
          realDomain = true;
        const s = signOfType(member, seen);
        if (s === undefined) continue;
        realDomain = true; // only a numeric member answers a sign
        if (s === 'positive' || s === 'zero' || s === 'non-negative')
          ge0 = true;
        if (s === 'negative' || s === 'zero' || s === 'non-positive')
          le0 = true;
        if (s === 'positive' || s === 'negative' || s === 'not-zero')
          notZero = true;
      }
      if (!realDomain) return undefined;
      // ge0 ∧ le0 ∧ notZero is the empty set; claim nothing for it.
      if (ge0 && le0) return notZero ? undefined : 'zero';
      if (ge0) return notZero ? 'positive' : 'non-negative';
      if (le0) return notZero ? 'negative' : 'non-positive';
      return notZero ? 'not-zero' : undefined;
    }
    case 'union': {
      let mayNeg = false;
      let mayZero = false;
      let mayPos = false;
      for (const member of t.types) {
        const s = signOfType(member, seen);
        if (s === undefined) return undefined;
        if (s === 'negative' || s === 'non-positive' || s === 'not-zero')
          mayNeg = true;
        if (s === 'zero' || s === 'non-negative' || s === 'non-positive')
          mayZero = true;
        if (s === 'positive' || s === 'non-negative' || s === 'not-zero')
          mayPos = true;
      }
      if (!mayNeg && !mayZero) return 'positive';
      if (!mayPos && !mayZero) return 'negative';
      if (!mayNeg && !mayPos) return 'zero';
      if (!mayNeg) return 'non-negative';
      if (!mayPos) return 'non-positive';
      if (!mayZero) return 'not-zero';
      return undefined;
    }
  }
  return undefined;
}

/**
 * Does `type` admit a `broadcastable<T>` value — directly, through a
 * transparent alias, or as one member of a union? Such a value is a `T` or an
 * indexed collection of `T`, decided only at run time, so a consumer that
 * must know which (the `PointList` lowerings, which zip a list but splice a
 * scalar) treats the whole type as undecided. The routing decision in the
 * `PointList` definition handler and the run-time role in the JavaScript zip
 * lowering both use this one predicate, so neither can admit a shape the
 * other rejects.
 */
export function containsBroadcastableType(type: Readonly<Type>): boolean {
  const t = resolveTypeAlias(type);
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind === 'union') return t.types.some(containsBroadcastableType);
  return false;
}

/**
 * The declared type of the parameter slot that operand `i` of a call fills:
 * the required parameters first, then the optional ones, then the variadic
 * parameter for every later operand; `undefined` past the end of a
 * non-variadic signature. Named arguments are not considered — the callers
 * read positional calls.
 */
export function signatureSlotType(
  sig: FunctionSignature,
  i: number
): Type | undefined {
  const required = sig.args ?? [];
  if (i < required.length) return required[i].type;
  const optional = sig.optArgs ?? [];
  if (i < required.length + optional.length)
    return optional[i - required.length].type;
  return sig.variadicArg?.type;
}

/** `t` with the parameter names of the signature `source`, slot by slot.
 * `t` itself when one of the two is not a signature, or when they do not
 * have the same required, optional and variadic slots. A slot that has no
 * name in `source` has no name in the result. */
export function withParameterNamesOf(t: Type, source: Type): Type {
  if (typeof t !== 'object' || t.kind !== 'signature') return t;
  if (typeof source !== 'object' || source.kind !== 'signature') return t;
  const sameLength = (a?: unknown[], b?: unknown[]) =>
    (a?.length ?? 0) === (b?.length ?? 0);
  if (
    !sameLength(t.args, source.args) ||
    !sameLength(t.optArgs, source.optArgs) ||
    (t.variadicArg === undefined) !== (source.variadicArg === undefined)
  )
    return t;
  const named = (
    slots: FunctionSignature['args'],
    names: FunctionSignature['args']
  ) => slots?.map((a, i) => ({ ...a, name: names![i].name }));
  return {
    ...t,
    args: named(t.args, source.args),
    optArgs: named(t.optArgs, source.optArgs),
    variadicArg:
      t.variadicArg === undefined
        ? undefined
        : { ...t.variadicArg, name: source.variadicArg!.name },
  };
}

/**
 * `derived` (a declared signature with its `unknown` slots refined from the
 * assigned body) with every PARAMETER that is a placeholder in `skeleton`
 * (the signature as the author declared it) replaced by `replacement`.
 * `derived` unchanged when there is no skeleton, when the two do not pair
 * parameter by parameter, or when no parameter is a placeholder.
 *
 * A placeholder slot is one the author did not give a type to: with `f`
 * declared `(unknown) -> unknown` and assigned `p ↦ p[1] + 1`, the reported
 * signature is `(indexed_collection<number>) -> number`, where the parameter
 * type was inferred from the use `p[1]`. Only a parameter the author typed
 * is a contract (user decision 2026-09-30), so that inferred type must not
 * refuse an argument: `f(First(xs))`, whose argument is typed
 * `missing | tuple<…>`, was refused at boxing, and answered an
 * `incompatible-type` error when the value was absent, although the same
 * body with no declaration accepts the call and answers `NaN`. A slot the
 * author did type (`(unknown, number) -> unknown`) keeps its type. Two
 * readings are built from this:
 *
 * - with `'any'`, the signature a CALL validates its arguments against
 *   (`any`, not `unknown`, because `unknown` excludes the absence markers);
 * - with `'unknown'`, the signature whose parameter types are stamped onto
 *   the stored literal (`ascribeDeclaredParameterTypes`, which stamps
 *   nothing for `unknown`): a stamped parameter is an annotation, and the
 *   application of the literal enforces its annotations at run time.
 */
export function placeholderSlotsAs(
  derived: Type,
  skeleton: Type | undefined,
  replacement: 'any' | 'unknown'
): Type {
  if (
    skeleton === undefined ||
    typeof skeleton !== 'object' ||
    skeleton.kind !== 'signature' ||
    typeof derived !== 'object' ||
    derived.kind !== 'signature'
  )
    return derived;
  const declared = skeleton.args ?? [];
  const args = derived.args ?? [];
  if (declared.length !== args.length) return derived;
  if (!declared.some((a) => a.type === 'unknown')) return derived;
  return {
    ...derived,
    args: args.map((a, i) =>
      declared[i].type === 'unknown' ? { ...a, type: replacement } : a
    ),
  };
}
