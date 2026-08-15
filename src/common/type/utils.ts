import { isEffectSubset, unionEffectSets } from './effects.js';
import { substituteTypeVariables } from './instantiate.js';
import { parseType } from './parse.js';
import { isValidType } from './primitive.js';
import { declarationOf } from './reference.js';
import { typeToString } from './serialize.js';
import { isSubtype, widen } from './subtype.js';

// Re-export isValidType from primitive for backward compatibility
export { isValidType };

// Re-export widen/narrow from subtype (moved there to break the
// subtype ↔ utils cycle; they depend on isSubtype)
export { widen, narrow } from './subtype.js';

import type {
  EffectSet,
  Type,
  ListType,
  FunctionSignature,
  TypeReference,
  TypeString,
} from './types.js';

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

export function collectionElementType(type: Readonly<Type>): Type | undefined {
  if (type === 'collection') return 'any';
  if (type === 'indexed_collection') return 'any';
  if (type === 'list') return 'any';
  // Unlike the unparameterized collection types above, an index span's
  // element type is KNOWN: its members are finite positive integers. (`any`
  // would be sound but would lose the precision `Range` had before the
  // `range` type existed, when it typed as `indexed_collection<integer>`.)
  if (type === 'range') return 'integer';
  if (type === 'set') return 'any';
  if (type === 'tuple') return 'any';
  if (type === 'dictionary') return 'any';
  if (type === 'record') return 'any';
  if (typeof type === 'string') return undefined;

  if (type.kind === 'collection' || type.kind === 'indexed_collection')
    return type.elements;

  if (type.kind === 'list') {
    // A multi-dimensional list (tensor) indexed by a single index yields a
    // sub-tensor with one fewer dimension, not its scalar element. E.g. a
    // single index into a `matrix<2x2>` (a row) is a `vector<2>`. Only a 1D
    // list (or one without declared dimensions) yields the scalar element.
    const dims = type.dimensions;
    if (dims && dims.length > 1)
      return {
        kind: 'list',
        elements: type.elements,
        dimensions: dims.slice(1),
      };
    return type.elements;
  }

  if (type.kind === 'set') return type.elements;

  if (type.kind === 'broadcastable') return type.elements;

  if (type.kind === 'tuple') return widen(...type.elements.map((x) => x.type));

  if (type.kind === 'dictionary')
    return parseType(`tuple<string, ${typeToString(type.values)}>`);

  if (type.kind === 'record') {
    return parseType(
      `tuple<string, ${typeToString(widen(...Object.values(type.elements)))}>`
    );
  }

  return undefined;
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
 * (`docs/plans/2026-08-01-nominal-types-design.md` §4.6 step 1).
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
 * (`docs/plans/2026-08-06-parameterized-nominal-types-design.md` §7) unfolds to
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
 * True if `t` carries a `missing` arm at any nesting level (a scalar `missing`,
 * a `T | missing` union, or a `missing` cell nested inside a list/collection/
 * tuple/record). Used to gate the missing-value strip (§3.B of
 * `docs/plans/2026-07-22-missing-value-typing-design.md`) so that a
 * Missing-free program is never touched by the lift.
 */
export function typeContainsMissing(t: Readonly<Type>): boolean {
  if (t === 'missing') return true;
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'union':
    case 'intersection':
      return t.types.some(typeContainsMissing);
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return typeContainsMissing(t.elements);
    case 'tuple':
      return t.elements.some((e) => typeContainsMissing(e.type));
    case 'dictionary':
      return typeContainsMissing(t.values);
    case 'record':
    case 'object':
      return Object.values(t.elements).some((x) => typeContainsMissing(x));
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
export function absorbNumericAbsence(t: Readonly<Type>): Type {
  // A whole `missing`/`never` cell in a `propagate` result is numeric-domain
  // (I6): its runtime value is `NaN`, so it is `number`. (`never <: number`,
  // so the string branch below already maps `never` → `number`.)
  if (t === 'missing') return 'number';
  if (typeof t === 'string') return isSubtype(t, 'number') ? 'number' : t;
  switch (t.kind) {
    case 'union': {
      const arms = t.types
        .map((x) => absorbNumericAbsence(x))
        .filter((x) => x !== 'never');
      if (arms.length === 0) return 'never';
      if (arms.length === 1) return arms[0];
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
 */
export function stripMissingFromType(t: Readonly<Type>): Type {
  if (t === 'missing') return 'never';
  if (typeof t === 'string') return t;
  switch (t.kind) {
    case 'union': {
      const arms = t.types
        .map((x) => stripMissingFromType(x))
        .filter((x) => x !== 'never');
      if (arms.length === 0) return 'never';
      if (arms.length === 1) return arms[0];
      return { kind: 'union', types: arms };
    }
    case 'intersection': {
      const arms = t.types.map((x) => stripMissingFromType(x));
      return { kind: 'intersection', types: arms };
    }
    case 'list':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return { ...t, elements: stripMissingFromType(t.elements) };
    case 'tuple':
      return {
        ...t,
        elements: t.elements.map((e) => ({
          ...e,
          type: stripMissingFromType(e.type),
        })),
      };
    default:
      return t;
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
 * (see `docs/plans/2026-07-20-tensor-unification-design.md`, §D5). Atomic
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
 * rule in `shapedListType` (bare symbols fold to `number`; applications
 * block). Callers must apply that second gate — do not use this predicate
 * alone to justify a shape.
 */
export function isAtomicValueType(t: Readonly<Type>): boolean {
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
      return t.types.every((arm) => isAtomicValueType(arm));

    case 'broadcastable':
      return false; // lift marker — may broadcast over a collection

    case 'negation':
      return false; // can't bound the negated set; conservative

    case 'reference':
      // Recurse on the resolved definition; unresolved → conservative.
      return t.def !== undefined ? isAtomicValueType(t.def) : false;

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
 * The statically-provable dimension vector of a collection type, or `null`
 * when the rank itself is not statically known. Open (unknown) lengths are
 * `-1` — the same wildcard convention `matrix`/`vector` parse to.
 *
 * - `list<T^2x3>` → `[2, 3]`
 * - `matrix` (= `list<number^(-1)x(-1)>`) → `[-1, -1]`
 * - `list<number>` → `[-1]` (rank 1, open length)
 * - `list<list<number>>` → `[-1, -1]` (nesting implies rank)
 * - bare `list` / `collection` / `indexed_collection` (no element info) →
 *   `null` (rank unknown — a bare `list` could be a list of lists)
 */
export function staticCollectionDims(t: Readonly<Type>): number[] | null {
  if (typeof t === 'string') return null;
  if (t.kind !== 'list') return null;
  // Rank comes from BOTH the explicit dimensions (if any) and the element
  // nesting: `list<list<number>^2>` (2 rows, each an open-length numeric
  // list) is rank 2 — `[2, -1]` — not rank 1. An `unknown`/`any`/bare-
  // collection element could itself be a list → rank unknown.
  const el = t.elements;
  const outer: number[] = t.dimensions ? [...t.dimensions] : [-1];
  if (el === 'unknown' || el === 'any' || el === 'list' || el === 'collection')
    return null;
  if (typeof el !== 'string' && el.kind === 'list') {
    const inner = staticCollectionDims(el);
    return inner === null ? null : [...outer, ...inner];
  }
  return outer;
}

/**
 * Rank/shape-aware broadcast result type (§D6.1 of
 * `docs/plans/2026-07-20-tensor-unification-design.md`): mirror the
 * shape-bearing operands' statically-provable structure onto the broadcast
 * result, in the **dimensioned** encoding (`list<R^2x2>`), so a fixed-shape
 * source (`Sqrt(M)` with `M: matrix<2x2>`) types compatibly with `matrix`/
 * `vector` signature parameters.
 *
 * `operandTypes` are the types of the operands that broadcast (scalars must
 * not be included — they impose no shape). Merge rule (review R3-2, sound
 * under the value machinery's zip-to-shortest semantics):
 * - every operand's dims provably identical → those dims;
 * - identical ranks, differing/open entries → that rank, all lengths open;
 * - any rank unknown, or ranks differ → plain unbounded `list<R>`
 *   (today's behavior — no invented structure).
 * A rank-1 all-open result also stays plain `list<R>` (byte-identical to
 * today for the common unbounded case).
 */
export function broadcastShapedResultType(
  operandTypes: ReadonlyArray<Readonly<Type>>,
  elementType: Readonly<Type>
): Type {
  let dims: number[] | null = null;
  for (const t of operandTypes) {
    const d = staticCollectionDims(t);
    if (d === null) return broadcastResultType(elementType); // rank unknown
    if (dims === null) {
      dims = d;
    } else if (dims.length !== d.length) {
      return broadcastResultType(elementType); // rank mismatch
    } else {
      // Same rank: keep provably-identical entries, open the rest.
      for (let i = 0; i < dims.length; i++) if (dims[i] !== d[i]) dims[i] = -1;
    }
  }
  if (dims === null) return broadcastResultType(elementType);
  // Rank-1 fully-open adds no information over the plain form.
  if (dims.length === 1 && dims[0] === -1)
    return broadcastResultType(elementType);
  const result: ListType = {
    kind: 'list',
    elements: elementType as Type,
    dimensions: dims,
  };
  return result;
}

/** The scalar leaf type of a (possibly nested/dimensioned) collection type:
 *  descend list-kind elements to the non-list leaf. `null` when the leaf is
 *  not statically known (bare `list`/`collection`, `unknown`/`any` element). */
function collectionLeafType(t: Readonly<Type>): Type | null {
  if (typeof t === 'string') return null; // bare collection kind — no element info
  if (t.kind === 'list') {
    const el = t.elements;
    if (el === 'unknown' || el === 'any') return null;
    if (typeof el !== 'string' && el.kind === 'list')
      return collectionLeafType(el);
    return el;
  }
  if (
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'broadcastable'
  ) {
    const el = t.elements;
    if (el === 'unknown' || el === 'any') return null;
    return el as Type;
  }
  return null;
}

/**
 * Overlap test for **deferred validation** (§D6.2 of
 * `docs/plans/2026-07-20-tensor-unification-design.md`): called after
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
export function overlapsForDeferredValidation(
  t: Readonly<Type>,
  param: Readonly<Type>
): boolean {
  // Union parameter (`matrix|vector` — the MatrixMultiply/Dot/LinearSolve
  // family): defer if any arm would. Union operand: any arm not refuted.
  if (typeof param !== 'string' && param.kind === 'union')
    return param.types.some((arm) => overlapsForDeferredValidation(t, arm));
  if (typeof t !== 'string' && t.kind === 'union')
    return t.types.some((arm) => overlapsForDeferredValidation(arm, param));

  // Only collection-kind parameters participate in deferral.
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
        t.kind === 'broadcastable'));
  if (!isCollectionLike) return false;

  // Rank refutation — only when both ranks are statically known. A
  // `broadcastable` operand has open rank (never refuted on rank).
  if (typeof t !== 'string' && t.kind === 'list') {
    const opDims = staticCollectionDims(t);
    const paramDims = staticCollectionDims(param);
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
    if (!isSubtype(opLeaf, paramLeaf) && !isSubtype(paramLeaf, opLeaf))
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
 */
export function broadcastElementType(type: Readonly<Type>): Type {
  if (typeof type !== 'string' && type.kind === 'union')
    return widen(...type.types.map((t) => broadcastElementType(t)));
  return collectionElementType(type) ?? (type as Type);
}

/**
 * A `broadcastable<S>` operand COULD be a plain scalar `S` at runtime — that
 * is the meaning of the lift (`S`, or an indexed collection of `S` that
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
 * True if `t` provably denotes a non-real number: a subtype of `complex` that
 * is not a subtype of `real` (`complex`, `imaginary`, `finite_complex`, …).
 *
 * Note that under the `real ⊂ complex` convention a bare
 * `isSubtype(t, 'complex')` is also true for every real type, so it cannot be
 * used on its own as an "is complex-valued" test.
 */
export function isNonRealNumber(t: Readonly<Type>): boolean {
  return isSubtype(t as Type, 'complex') && !isSubtype(t as Type, 'real');
}

/**
 * True if an operand of type `t` could be a non-real number: either the type
 * is a supertype of `complex` (`number`, `any`), or it is a numeric type
 * outside `real` (a complex literal types as `finite_complex`, `i` as
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
 * - `real`, `finite_real`, `integer`, `rational` → `false`
 * - `number`, `finite_number`, `any`, `unknown` → `true` (could be non-real)
 * - `complex`, `finite_complex`, `imaginary` → `true` (is non-real)
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
 * (`docs/plans/2026-08-09-state-event-invalidation-axes.md` §4): a value
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
    case 'callback':
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
