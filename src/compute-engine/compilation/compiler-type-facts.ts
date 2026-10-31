// Questions about declared and inferred types that need no emission: provable
// strings, numeric lists, points, tuples, collections and their shapes.

import type { Expression } from '../global-types.js';
import {
  isConstructedScalar,
  isDecidedLoopIndex,
} from './javascript-value-facts.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import {
  broadcastingComponentKind,
  isNumericTuple,
  isPossiblyCollectionTyped,
  isTuple,
  isTupleShapedType,
  leafwardElementType,
  isTopTypedBlockLocal,
} from '../collection-utils.js';
import {
  collectionElementType,
  isPointElementType,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  resolveTypeForCompilation as resolveDeclaredTypeForCompilation,
  signatureArms,
  stripMissingFromType,
  topTypeBesideAbsence,
  typeElementCount,
  kindArmNames,
} from '../../common/type/utils.js';
import { kindTypeNames } from '../boxed-expression/value-kinds.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { freeTypeVariables } from '../../common/type/instantiate.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import {
  isSymbol,
  isNumber,
  isString,
  isCharacter,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { sortOperands } from '../boxed-expression/order.js';
import { unrollFixedWidthCollections } from './fixed-width-unroll.js';
import type { CompileTarget } from './types.js';
import {
  exactDoubleValue,
  exactValueDoubleRoundings,
} from '../numeric-value/exact-integer-value.js';
import { CompilerState } from './compiler-state.js';
import { core } from './compiler-core-hooks.js';

/**
 * True when a symbol of `expr`, at any depth, has a type with an
 * `enclosure` arm at any level (`enclosure`, `real | enclosure`,
 * `list<enclosure>`). On `interval-js` such an expression is compiled with
 * the kind lowering of the enclosure, which checks the host value of the
 * symbol and declines a collection of enclosures. The `interval-js` target
 * also reads it to refuse the interpreter fallback for an enclosure input
 * (`holdsEnclosureInputOrResult()`, `interval-javascript-target.ts`).
 */
export function hasEnclosureSymbol(expr: Expression): boolean {
  const kinds = kindTypeNames(expr.engine);
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e))
      return kindArmNames(e.type.type, kinds).includes('enclosure');
    return isFunction(e) && e.ops.some(visit);
  };
  return visit(expr);
}

export function compilationType(expr: Expression): Type {
  return resolveTypeForCompilation(expr.type.type);
}

/**
 * Is the value of this number literal held EXACTLY by the engine while no
 * double represents it?
 *
 * `expr.re` is then the nearest double, which is a rounded value: `1/49` is
 * `0.02040816326530612`, `√2` is `1.4142135623730951`, and the difference is
 * real to a target that promises an enclosure. The test is
 * `exactDoubleValue`, the same one the machine-number admission uses: an
 * integer inside the significand's reach and a rational with a power-of-two
 * denominator DO have a double and answer `false` here, as does every
 * inexact literal — a machine float is its own exact value, and the
 * interpreter computes with that same double.
 *
 * Read by the number-literal lowering to decide between `target.number` and
 * `target.inexactNumber`.
 */
export function literalHasNoDoubleValue(expr: Expression): boolean {
  if (!isNumber(expr)) return false;
  const nv = expr.numericValue;
  // A machine float carries no exact value beyond the double it already is.
  if (typeof nv === 'number') return false;
  if (!nv.isExact || nv.isComplex) return false;
  // An infinity and a NaN have no enclosure to widen; they are emitted as
  // themselves.
  if (!Number.isFinite(expr.re)) return false;
  return exactDoubleValue(nv) === undefined;
}

/**
 * How many double roundings stand between this literal's exact value and the
 * `expr.re` a target is handed, for a target that emits an ENCLOSURE
 * (`CompileTarget.inexactNumber`).
 *
 * A target steps one ulp out per rounding. `1/49` and `√2` are one rounding
 * and keep the narrowest enclosure; a rational whose numerator or denominator
 * is past the reach of the significand is three, because the two integer
 * conversions round before the division does. See
 * `exactValueDoubleRoundings`, which reads the exact representation.
 */
export function literalDoubleRoundings(expr: Expression): number {
  if (!isNumber(expr)) return 1;
  const nv = expr.numericValue;
  if (typeof nv === 'number') return 1;
  return exactValueDoubleRoundings(nv);
}

/**
 * True when `a` is provably string-valued: a string literal, or an operand
 * whose (alias-resolved) static type is a subtype of `string`.
 *
 * Deliberately `isSubtype`, NOT `.matches('string')`: `matches` is the
 * "could be" direction, so an `unknown`-typed symbol would answer true and
 * gate a numeric plot equality such as `x^2 + y^2 = 4`, whose inferred
 * parameters must stay on the numeric fast path with byte-identical output.
 * Only positive string evidence gates. `never` is a subtype of every type and
 * so is not evidence either.
 *
 * Shared by BaseCompiler's infix-ordering divert (which falls through to the
 * JS ordering codegen on a mixed string operand) and javascript-target's
 * fail-closed string gates (`assertNoStringOperand`,
 * `isMixedStringOrdering`) — their agreement is load-bearing.
 */
export function isProvablyStringOperand(x: Expression): boolean {
  if (isString(x)) return true;
  const t = resolveTypeForCompilation(x.type.type);
  return t !== 'never' && isSubtype(t, 'string');
}

/**
 * True when `x` is provably a character: a character value, or an operand whose
 * (alias-resolved) static type is a subtype of `character`.
 *
 * `character` and `string` are disjoint siblings in the type lattice (neither is
 * a subtype of the other), so `isProvablyStringOperand` never answers true for a
 * character and every character-specific lowering has to ask this question
 * separately. Same `isSubtype`-not-`.matches` discipline as the string
 * predicate: only positive evidence gates, so an `unknown`-typed operand is
 * never treated as a character.
 *
 * A character lowers to a one-cluster target string, so it compares by value
 * with `===` — but not with `<`, which on JavaScript strings compares UTF-16
 * code units while the interpreter orders characters by their NFC code-point
 * sequence (`compare.ts`).
 */
export function isProvablyCharacterOperand(x: Expression): boolean {
  if (isCharacter(x)) return true;
  const t = resolveTypeForCompilation(x.type.type);
  return t !== 'never' && isSubtype(t, 'character');
}

/**
 * True when a type admits every basic sort: string, number, boolean, and an
 * indexed collection. Such a type supplies no useful string evidence.
 *
 * `unknown` has never been string evidence (see `isProvablyStringOperand`), and
 * this extends the same reading to a top type spelled as a union. `At`'s index
 * slot is
 * `boolean | character | indexed_collection | number | string` (a gather
 * index may itself be a collection, and a string or a character is a
 * dictionary key), so indexing with a local —
 * `cs[j]` — types `j` with that union, and the numeric operators never narrow
 * it back, because an operand that could be a collection is skipped by the
 * threadable-operator inference (`validate.ts`, Tycho item 121). A plain
 * `while j <= Length(cs)` next to such an index then declined as a "mixed
 * string ordering" although neither operand is remotely a string — a whole
 * ordinary scanner loops, even though neither operand was a string.
 *
 * Requiring all three scalar sorts and a collection arm keeps narrower mixed
 * unions such as `number | string` or `string | list<string>` on the
 * fail-closed path because they represent a real run-time string possibility.
 *
 * A hand-written `boolean | indexed_collection | number | string` is also
 * exempt because it is indistinguishable from the inferred top-like shape.
 */
export function carriesNoSortEvidence(t: Type): boolean {
  return (
    isSubtype('string', t) &&
    isSubtype('number', t) &&
    isSubtype('boolean', t) &&
    isSubtype('indexed_collection', t)
  );
}

/**
 * True when any leaf type reachable from `t` is provably string: `t` itself,
 * the element type of a collection (recursively — `list<list<string>>` carries
 * evidence), or a member of a union (`list<string | number>` carries evidence
 * even though the widened element type is not wholly string).
 *
 * Only positive evidence counts, exactly as in `isProvablyStringOperand`:
 * `unknown`/`any` is not evidence (`collectionElementType` reports `any` for a
 * bare `list`, and it must not gate numeric plot shapes), and neither is
 * `never` — the element type of the empty literal `[]`.
 *
 * A `dictionary` or `record` is walked through its value types only. Its
 * synthesized string key is metadata, not a value compared by these operators;
 * aggregate fidelity is checked separately by `unfaithfulComparisonAggregate`.
 *
 * The walk has no depth cutoff because returning `false` admits compilation.
 * Termination is structural, plus a cycle guard for the non-structural step: a
 * `reference` unfolds to its definition, so a recursive alias
 * (`type json = list<json> | integer`) would descend forever. The guard is the
 * repo's standard one for a `.def`-following walker — remember the reference
 * DECLARATION records (`declarationOf`, stable per name and unaffected by the
 * re-application a parameterized unfold rebuilds) along the CURRENT PATH, and
 * stop on a repeat. The set is copied on descent so a reference visited in one
 * branch cannot suppress evidence in a sibling, and is allocated only once a
 * reference is actually met — the numeric fast path allocates nothing.
 */
function typeHasStringEvidence(
  t: Type,
  visited?: ReadonlySet<TypeReference>
): boolean {
  if (typeof t === 'object' && t.kind === 'reference' && t.def !== undefined) {
    const decl = declarationOf(t);
    if (visited?.has(decl)) return false;
    visited = new Set(visited).add(decl);
  }
  const r = resolveTypeForCompilation(t);
  if (r === 'never') return false;
  if (carriesNoSortEvidence(r)) return false;
  if (isSubtype(r, 'string')) return true;
  if (typeof r !== 'string') {
    // A union member that is provably string is evidence even when its siblings
    // are not: the run-time value could be that member.
    if (r.kind === 'union')
      return r.types.some((x) => typeHasStringEvidence(x, visited));
    // The keyed aggregates: their VALUES, never the synthesized string key.
    if (r.kind === 'dictionary')
      return typeHasStringEvidence(r.values, visited);
    if (r.kind === 'record')
      return Object.values(r.elements).some((x) =>
        typeHasStringEvidence(x, visited)
      );
  }
  // Toward the cells (`leafwardElementType`): the element of a tensor of
  // unknown rank contains the tensor itself, which would send the walk
  // round for ever.
  const elt = leafwardElementType(r);
  if (elt === undefined) return false;
  return typeHasStringEvidence(elt, visited);
}

/**
 * The aggregate kinds whose whole-value comparison neither the `_SYS.eq`/
 * `_SYS.neq` tolerance kernel nor `_SYS.bcast` can reproduce faithfully —
 * returned by name for the diagnostic, or `null` when the participant is
 * comparable. See `assertComparableAggregate` (javascript-target.ts) for the
 * evidence.
 *
 * Keyed collections (`dictionary`, `record`) have no positional JS-array
 * lowering, and a heterogeneous fixed-arity `tuple` binds atomically in
 * the interpreter while both kernels treat its JS array as a collection to map
 * over. A union member counts: the run-time value could BE it.
 *
 * The two kinds are searched to different depths:
 *
 *  - a keyed aggregate counts at any depth (`list<dictionary<integer>>` too);
 *  - a `tuple` counts only as the participant itself (through unions). A tuple
 *    nested in an indexed collection is the point-list lowering
 *    (`list<tuple<number, number>>`), which compiles today and must keep
 *    compiling; whether the whole-list comparison of one agrees with
 *    interpretation is a separate, unverified question, not this gate's.
 */
export function unfaithfulComparisonAggregate(
  x: Expression
): 'dictionary' | 'record' | 'tuple' | null {
  // Same cycle guard as `typeHasStringEvidence` — a recursive alias
  // (`type json = … | dictionary<json>`) is reached again through its own body.
  const walk = (
    t: Type,
    top: boolean,
    visited?: ReadonlySet<TypeReference>
  ): 'dictionary' | 'record' | 'tuple' | null => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return null;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') {
      if (r === 'dictionary' || r === 'record') return r;
      return top && r === 'tuple' ? r : null;
    }
    if (r.kind === 'dictionary' || r.kind === 'record') return r.kind;
    if (r.kind === 'tuple') return top ? 'tuple' : null;
    // A union stays at the SAME level: each member is an alternative value of
    // this participant, not an element of it.
    if (r.kind === 'union') {
      for (const m of r.types) {
        const found = walk(m, top, visited);
        if (found !== null) return found;
      }
      return null;
    }
    // Toward the cells (`leafwardElementType`), for the reason given at
    // `typeHasStringEvidence`.
    const elt = leafwardElementType(r);
    if (elt === undefined) return null;
    return walk(elt, false, visited);
  };
  return walk(x.type.type, true);
}

/**
 * True when a comparison PARTICIPANT is provably tuple-typed — a `Tuple`
 * literal, or a symbol/application whose static type is a tuple (through a
 * union only when EVERY member is one).
 *
 * This is the ADMISSION side of the aggregate gate's tuple case, and it exists
 * for the EQUALITY family alone (see `compileJSEquality`): tuple-vs-tuple
 * `Equal`/`NotEqual` lowers to `_SYS.eq`/`_SYS.neq`, whose array-vs-array
 * branch is whole-value equality — the same answer the interpreter's atomic
 * point comparison gives, at equal AND unequal arity (a length mismatch is
 * `false`, and the interpreter answers `False` too). It was verified faithful
 * before `unfaithfulComparisonAggregate` existed, and the gate declining it was
 * over-broad; point equality (`p == q` over `tuple<number, number>`) is the
 * realistic consumer.
 *
 * Deliberately narrower than "not `unfaithfulComparisonAggregate`":
 *  - EVERY participant must qualify, so the mixed shapes the gate was written
 *    for keep declining — `Equal(Tuple(1,2), 1)` ran element-wise to
 *    `[true, false]` and `Equal(Tuple(1,2), List(1,2))` to `true`, where the
 *    interpreter answers `False` to both;
 *  - a union member that is NOT a tuple disqualifies: the run-time value could
 *    be the shape the kernel gets wrong;
 *  - the ORDERINGS never consult it. `Less(Tuple, Tuple)` was declining before
 *    this gate existed (the interpreter leaves it inert) and stays closed.
 */
/**
 * True when a comparison participant is provably a collection that is NOT a
 * tuple — a `list`, `set` or `range` kind, every union member included. A
 * bare `tuple`, a structural `tuple<…>`, a `collection`/`indexed_collection`
 * (which a tuple inhabits), a string (a collection of clusters in the
 * lattice, but compared as text), a scalar or an unknown all answer `false`.
 *
 * The other half of the list-vs-point fold in `compileJSEquality`: a list and
 * a point are never equal in the interpreter (`Equal([1,0], Tuple(1,0))` is
 * `False`, and a point binds atomically), so an equality whose one side is
 * provably a point and whose other side is provably a non-tuple collection is
 * a constant, whatever the values (Tycho item 215).
 */
export function isProvablyNonTupleCollectionParticipant(
  x: Expression
): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    // Only the kinds a tuple can NEVER inhabit. A tuple IS a subtype of
    // `collection` and `indexed_collection` (`subtype.ts`: every component a
    // subtype of the element type), so a symbol declared
    // `indexed_collection<number>` may be bound to a point, and folding it
    // against a point would answer `false` where the interpreter answers
    // `True`. Those kinds keep declining through the aggregate gate.
    if (typeof r === 'string')
      return r === 'list' || r === 'set' || r === 'range';
    if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    return r.kind === 'list' || r.kind === 'set';
  };
  return walk(x.type.type);
}

export function isProvablyTupleParticipant(x: Expression): boolean {
  // Same cycle guard as `unfaithfulComparisonAggregate` — but note `false` is
  // the DECLINING direction here, so stopping on a repeat is conservative.
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (typeof r === 'string') return r === 'tuple';
    if (r.kind === 'tuple') return true;
    if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    return false;
  };
  return walk(x.type.type);
}

/**
 * True when EVERY component of a provably-tuple participant is provably
 * NUMERIC, recursing into nested tuple components (a point of points qualifies)
 * and requiring every member of a union to qualify.
 *
 * The other half of the ADMISSION side of the tuple-equality carve-out, paired
 * with `isProvablyTupleParticipant` — see `compileJSEquality` and
 * `compilePythonEquality`. Tuple-ness alone is not enough on EITHER target,
 * because the element leaf of the whole-value comparison is numeric and coerces
 * a boolean: `_SYS.eq`'s tolerance test makes `Math.abs(true - 1)` zero, and
 * Python's `==` makes `True == 1` true, so `Equal(Tuple(True, 2), Tuple(1, 2))`
 * answered `True` where the interpreter answers `False`. Anything but a provable
 * number — a boolean, a string, `unknown`, a union with a non-numeric member, or
 * a bare `tuple` with no component information at all — disqualifies, and the
 * aggregate gate then declines the head (fail closed).
 */
export function isNumericTupleParticipant(x: Expression): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    // A bare `tuple` carries no component information: nothing to prove numeric.
    if (r === 'tuple' || r === 'never') return false;
    if (typeof r !== 'string') {
      if (r.kind === 'tuple')
        return r.elements.every((e) => walk(e.type, visited));
      if (r.kind === 'union') return r.types.every((m) => walk(m, visited));
    }
    return isSubtype(r, 'number');
  };
  return walk(x.type.type);
}

/**
 * String evidence for a COMPARISON PARTICIPANT — the value the scalar
 * comparison actually compares, which for a broadcast source is its ELEMENT,
 * not the array.
 *
 * `isProvablyStringOperand` alone is blind to this: `_SYS.bcast` hands ELEMENTS
 * to the scalar closure, and `_SYS.eq`/`_SYS.neq` compare a list against a
 * scalar element-wise, so a `list<string>` operand puts strings on the numeric
 * comparison path even though the operand's own type is not a subtype of
 * `string`. That blind spot is what let `Less("a", [1, 2])` compile to
 * `[false, false]` and `Equal(["a"], ["a"])` to `false`.
 *
 * The walk is RECURSIVE over the type structure (`typeHasStringEvidence`),
 * because the numeric lowerings reach nested and mixed elements just as
 * silently: `Equal([["a"]], [["a"]])` ran to `false` (one peel yields
 * `list<string>`, not `string`) and `Equal(["a", 1], ["a", 1])` ran to `false`
 * (the widened element type `number | string` is not wholly string), both where
 * the interpreter answers `True`.
 *
 * This predicate is the DECLINE trigger (the `some` side of the mixed rule).
 * The keep-compiling `every` side uses the narrower
 * `isFlatAllStringComparisonParticipant` — see there.
 */
export function isProvablyStringComparisonParticipant(x: Expression): boolean {
  if (isProvablyStringOperand(x)) return true;
  return typeHasStringEvidence(compilationType(stringEvidenceSource(x)));
}

/**
 * The expression whose static type carries the string evidence of `x`: `x`
 * itself, or, when `x` applies a STRING-PRESERVING collection operator, the
 * evidence source of its subject (its first operand), recursively —
 * `Take(Reverse(S), 2)` reads `S`.
 *
 * A string-preserving operator (`Slice`, `Take`, `Drop`, `Rest`, `Reverse`,
 * `RotateLeft`, `Sort`, …) returns a string exactly when its subject is a
 * string, and a list of the subject's elements otherwise. When the subject's
 * type does not decide which, overload resolution types the application with
 * the JOIN of the two results (`resolvedArm`, `boxed-function.ts`): a bare
 * `indexed_collection` subject gives `list<unknown> | string`. That `string`
 * member says only that the subject may be a string, which the subject's own
 * type already said without counting as string evidence. So the evidence of
 * the application is the evidence of its subject: a subject declared
 * `string`, or `string | list<number>`, still has evidence, and a bare
 * `indexed_collection`, `collection` or `list` subject has none.
 *
 * The set of operators is derived from the definitions, not listed: see
 * {@link isStringPreservingSignature}.
 */
export function stringEvidenceSource(x: Expression): Expression {
  let current = x;
  for (;;) {
    if (!isFunction(current) || current.nops === 0) return current;
    const sig = current.operatorDefinition?.signature.type;
    if (sig === undefined || !isStringPreservingSignature(sig)) return current;
    current = current.ops[0];
  }
}

const stringPreservingSignatures = new WeakMap<object, boolean>();

/**
 * True when `sig` is an overload set with a string-preserving arm and at
 * least one other arm. A string-preserving arm has the shape `(T, …) -> T
 * where T: string`: its first parameter and its result are the same type
 * variable, whose declared bound is `string`, and no other parameter
 * mentions that variable. The last condition keeps out an arm such as
 * `(T+) -> T`, whose result also depends on its other operands.
 */
function isStringPreservingSignature(sig: Type): boolean {
  if (typeof sig === 'string' || sig.kind !== 'intersection') return false;
  const cached = stringPreservingSignatures.get(sig);
  if (cached !== undefined) return cached;
  const arms = signatureArms(sig) ?? [];
  const preserving = arms.filter((arm) => {
    const first = arm.args?.[0]?.type;
    if (typeof first !== 'object' || first.kind !== 'variable') return false;
    const result = arm.result;
    if (
      typeof result !== 'object' ||
      result.kind !== 'variable' ||
      result.name !== first.name
    )
      return false;
    if (arm.typeParams?.find((p) => p.name === first.name)?.bound !== 'string')
      return false;
    const others = [
      ...(arm.args ?? []).slice(1),
      ...(arm.optArgs ?? []),
      ...(arm.variadicArg ? [arm.variadicArg] : []),
    ];
    return others.every((p) => !freeTypeVariables(p.type).has(first.name));
  });
  const answer = preserving.length > 0 && preserving.length < arms.length;
  stringPreservingSignatures.set(sig, answer);
  return answer;
}

/**
 * The ADMISSION side of the mixed-string ordering rule: a participant whose
 * compared value is WHOLLY string — a string operand, a collection whose
 * element type is a subtype of `string`, or a string or tensor of strings
 * of any rank (a subtype of `broadcastable<string>`).
 *
 * Deliberately NOT the recursive `isProvablyStringComparisonParticipant`,
 * which finds string evidence anywhere in a type: only the shapes above are
 * verified to agree with interpretation (`Less("a", ["x","y"])`,
 * `Less(["a","b"], ["a","c"])`, a matrix of strings against a string, pinned
 * in `compile-string-fail-closed.test.ts` and
 * `compile-string-tensor-comparison.test.ts`). A type such as
 * `list<list<string>>`, which is not a tensor type, is not admitted, and the
 * head fails closed.
 */
export function isFlatAllStringComparisonParticipant(x: Expression): boolean {
  if (isProvablyStringOperand(x)) return true;
  const type = compilationType(x);
  // A string or a tensor of strings of any rank (`broadcastable<string>`,
  // `tensor<string>`, `matrix<string>`): the compiled comparison maps each
  // cell of the nested arrays, and the interpreter compares each cell, so
  // `Less(S, "b")` with `S = [["a", "b"], ["c", "d"]]` is
  // `[[True, False], [False, False]]` on both routes, also for rows of
  // different lengths. (ROADMAP CE-219.)
  const resolved = resolveTypeForCompilation(type);
  if (resolved !== 'never' && isSubtype(resolved, 'broadcastable<string>'))
    return true;
  const elt = collectionElementType(type);
  if (elt === undefined) return false;
  const t = resolveTypeForCompilation(elt);
  return t !== 'never' && isSubtype(t, 'string');
}

/**
 * True when a comparison PARTICIPANT's static type ADMITS a collection at run
 * time — not only when the whole type is one.
 *
 * `x.type.matches('collection<any>')` (and Python's `isPyCollectionOperand`) answer
 * the SUBTYPE question, so a general UNION with a collection arm slips through:
 * `string | list<string>` is not a subtype of `collection`, yet the run-time
 * value can be a list. That blind spot let the tier-2 scalar string-equality
 * admission compile `Equal(uq, "a")` (`uq: string | list<string>`) to a scalar
 * `((uq) === ("a"))` — a wrong SHAPE and a wrong value behind `success: true`,
 * where the interpreter broadcasts element-wise to `["True", "False"]`. It is
 * reachable from inferred unions too (`g(flag) = "a" if flag else [1,2,3]`).
 *
 * Only POSITIVE union evidence counts. A top type (`unknown`/`any`/`value`) is
 * deliberately NOT a collection signal — that is "nothing is known", not "a
 * collection is possible", and the settled admission rule for the string
 * comparisons is "≥1 provably string AND none provably numeric", which keeps a
 * bare-`unknown` participant admitted (the run-time-array residual there is the
 * same accepted one the numeric fast path has). Targets pair this with their
 * own possibly-collection test (`isPossiblyCollectionTypedJS`) for the
 * `broadcastable<T>` / top-typed-application signals it does not cover.
 *
 * Same shape (and cycle guard) as the other participant walks here: a
 * `reference` unfolds to its definition, and a recursive alias stops on a
 * repeat — `false` is the ADMITTING direction only for a type that cannot be a
 * collection, and a cycle means the union arm was already visited.
 */
export function couldBeCollectionParticipant(x: Expression): boolean {
  const walk = (t: Type, visited?: ReadonlySet<TypeReference>): boolean => {
    if (
      typeof t === 'object' &&
      t.kind === 'reference' &&
      t.def !== undefined
    ) {
      const decl = declarationOf(t);
      if (visited?.has(decl)) return false;
      visited = new Set(visited).add(decl);
    }
    const r = resolveTypeForCompilation(t);
    if (r === 'unknown' || r === 'any' || r === 'value' || r === 'never')
      return false;
    // A STRING is a subtype of `collection` (its elements are its grapheme
    // clusters) but is ATOMIC at run time: it lowers to a JS string, and both
    // the interpreter and the emitted scalar comparison treat it as one value.
    // Answering `true` here would make every string participant look like a
    // possibly-element-wise operand and close the scalar `===` admission.
    if (r === 'string') return false;
    if (typeof r !== 'string' && r.kind === 'union')
      return r.types.some((m) => walk(m, visited));
    return isSubtype(r, COLLECTION_SHAPE_TYPE);
  };
  return walk(x.type.type);
}

/**
 * The MIXED-string ORDERING rule, shared by every site that must agree on it:
 * the two infix diverts below (`orderingOverString` for JavaScript,
 * `pyOrderingUnfaithful` for Python) and the Python target's ordering gate
 * (`assertPyNoMixedStringOrdering`). At least one participant carries string
 * evidence, but not every one is a provably FLAT string — the only all-string
 * shape whose parity with interpretation is verified. The `some` and `every`
 * sides deliberately use DIFFERENT predicates; see each for why.
 */
export function isMixedStringOrderingParticipants(
  args: ReadonlyArray<Expression>
): boolean {
  return (
    args.some(isProvablyStringComparisonParticipant) &&
    !args.every(isFlatAllStringComparisonParticipant)
  );
}

/**
 * The JavaScript test recognizing the complex runtime convention — a
 * `{ re, im }` object (see `branchComplexCoercion`). An array (a compiled
 * collection) fails it: `[].re` is `undefined`.
 */
export function jsComplexObjectTest(a: string): string {
  return `(${a} !== null && typeof ${a} === "object" && typeof ${a}.re === "number")`;
}

/**
 * True when `t` is a UNION with at least one indexed-collection branch and at
 * least one branch that is not a collection — an operand that is "a scalar OR
 * a JS array at run time" by its static type alone (`integer |
 * vector<integer^2>`, the type of a `Which` whose arms return a 2-element list
 * or the scalar `-1`).
 *
 * The typing-side `isPossiblyCollectionTyped` (`collection-utils.ts`) is
 * deliberately FALSE for this shape: the type of arithmetic over such an
 * operand is computed PER BRANCH by the union lift, which is the sharper
 * answer for a TYPE. Code generation has no per-branch path — one emission
 * must serve both run-time shapes — so the compile-side twins
 * (`isBoundPossiblyCollectionTyped` here, `isPossiblyCollectionTypedJS` in
 * `javascript-target.ts`) admit the shape through this helper and route it
 * to the run-time-dispatching lowerings (`_SYS.bcast`, the `Array.isArray`
 * guarded reduce). Before that, `2·x` and `x + 1` over such an operand
 * compiled to the bare scalar operators — `NaN` and `"1,21"` behind
 * `success: true` — and `Sum(x)` (Desmos `.total`) failed closed with "no
 * indexing set" (Tycho item 249).
 *
 * A string branch and a TUPLE branch are atomic at run time — a string
 * lowers to a JS string, a tuple is a point that every element-wise lowering
 * keeps whole (`_SYS.select` and the interpreter's selection both refuse a
 * tuple condition) — so both count as non-collection branches; a top-typed
 * branch is "nothing is known", not a collection signal, and counts as
 * neither. A union whose branches are ALL indexed collections is provably
 * array-shaped and is the provable tests' job (`isIndexedCollectionOperand`),
 * not this one's.
 *
 * A NOMINAL value is atomic whatever its representation (ruled 2026-08-12,
 * `isNominalAtomicType`): a sugar-declared sum such as `type json = jnull |
 * … | jarr(list<json>)` resolves, under the erased policy, to a union with
 * a list branch, but the interpreter binds a `json` value whole and never
 * maps over it. Its reference is refused before it is resolved — as the
 * whole type, and as a BRANCH: `integer | Bag` with an opaque `type Bag =
 * list<number>` would otherwise resolve the branch to the erased list and
 * broadcast over a value the interpreter leaves whole.
 */
export function unionAdmitsIndexedCollection(t: Type): boolean {
  if (isNominalAtomicType(t)) return false;
  const r = resolveTypeForCompilation(t);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  let collection = false;
  let other = false;
  for (const branch of r.types) {
    if (isNominalAtomicType(branch)) return false;
    const b = resolveTypeForCompilation(branch);
    if (b === 'unknown' || b === 'any' || b === 'value' || b === 'never')
      continue;
    if (b === 'string' || isTupleShapedType(b)) other = true;
    else if (isSubtype(b, INDEXED_COLLECTION_SHAPE_TYPE)) collection = true;
    else if (!isSubtype(b, COLLECTION_SHAPE_TYPE)) other = true;
  }
  return collection && other;
}

/**
 * Is `a` an operand that MAY be a point, or a list of points, with the
 * decision left to run time? True for a union type with a tuple-shaped arm
 * (a point) beside an arm of another shape: a collection arm
 * (`list<tuple<…>> | tuple<…>`, the shape the point-consuming document
 * functions declare for their parameter) or a scalar arm
 * (`number | tuple<integer, integer>`, which is what `P − (4, 0)` is typed
 * when `P` is declared `unknown`). A provably scalar, provably point or
 * provably collection operand keeps its static lowering. A TOP type
 * (`unknown`, `any`, `value`) is FALSE: it says nothing at all about the
 * shape, so a run-time array could as well be a plain list of numbers, or a
 * matrix, that the interpreter reads element-wise. Read by the `Abs`
 * run-time shape dispatch (`_SYS.absShape`) and by the run-time point-list
 * lift of `Add` in `tryCompileBroadcast` (Tycho item 253).
 *
 * A NOMINAL value is atomic whatever its representation, as the whole type
 * and as a BRANCH — the interpreter binds it whole and never maps over it.
 * The guard mirrors `unionAdmitsIndexedCollection` above.
 */
export function isRuntimePointShaped(a: Expression): boolean {
  const raw = a.type.type;
  if (isNominalAtomicType(raw)) return false;
  const r = resolveTypeForCompilation(raw);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  let tuple = false;
  let other = false;
  for (const branch of r.types) {
    if (isNominalAtomicType(branch)) return false;
    const b = resolveTypeForCompilation(branch);
    if (b === 'never') continue;
    if (isTupleShapedType(b)) tuple = true;
    else other = true;
  }
  return tuple && other;
}

/**
 * Is `a` a GATED indexed collection: a value whose static type is
 * `missing | C`, where every arm of `C` is an indexed collection that is not
 * a string (a point, a list, or a union of those)?
 *
 * A restriction gives this type: `When(PointList(0, 1), c)` is typed
 * `missing | tuple<integer, integer>`, and it lowers to the ternary
 * `c ? [0, 1] : undefined`. At run time the value is therefore a JS array or
 * the absent value, never a number. The plain type tests
 * (`matches('indexed_collection<any>')`) reject the type because of the
 * `missing` arm, and `unionAdmitsIndexedCollection` does not see it either,
 * because a tuple arm is atomic there. Without this test, `t·P` with a
 * restricted point `P` compiled to the scalar `_.t * [0, 1]`, which runs to
 * `NaN` where the interpreter answers the point `(0, t)`. The interpreter
 * answers `Missing` (the absent point) for the product of a number and an
 * absent point, and the broadcast lowering answers `undefined`, the
 * JavaScript spelling of an absent object (user decision of 2026-09-27,
 * which replaces the `NaN` of the decision of 2026-09-09; see
 * `objectAbsenceLevels`).
 *
 * A NOMINAL value is atomic whatever its representation, as for
 * `unionAdmitsIndexedCollection` above.
 */
export function isGatedIndexedCollection(a: Expression): boolean {
  return gatedCollectionArms(a) !== undefined;
}

/**
 * The reason that the compiled `Shape` or `Rank` of the operand `a` cannot
 * give the value of the interpreter, or `undefined` when it can.
 *
 * The interpreter gives no shape (the operator stays unevaluated) for a
 * collection that is not indexed (a set, an interval, a dictionary) and for
 * an infinite collection (`shapeOfOperand()` in
 * `library/linear-algebra.ts`). The compiled code measures the nested arrays
 * of the run-time value, and a set has the same run-time form as a list, so
 * it would give a shape. Thus the compilation declines when the type of `a`
 * has an arm that is a collection type but not an indexed collection type
 * (`set<integer>`, `number | set<integer>`, `collection<integer>`), or when
 * `a` is an infinite collection.
 *
 * A tuple (a point) is one value with the shape `()` in the interpreter, but
 * at run time it is an array, which the compiled code measures as a vector:
 * `Rank((1, 2))` is 0, and `Rank([(1, 2), (3, 4)])` is 1, not 2. Thus the
 * compilation also declines when a tuple type is an arm of the type of `a`,
 * or of its element type at any depth. The same applies to a string: the
 * interpreter gives `"ab"` the shape `(2)`, but at run time it is a
 * JavaScript or Python string, which is not an array.
 */
export function shapeOperandRefusal(a: Expression): string | undefined {
  if (a.isFiniteCollection === false) return 'is an infinite collection';
  // The declared type is read without the compiled-lane reading of the open
  // form (`resolveTypeForCompiledLanes`), which would hide its `tuple` arm:
  // `Rank` of a value of that form that is the point `(3, 4)` is `0` in the
  // interpreter, and the run-time shape of its array is `[2]`.
  const refusal = (t: Type, depth: number): string | undefined => {
    const r = resolveDeclaredTypeForCompilation(t);
    const arms = typeof r !== 'string' && r.kind === 'union' ? r.types : [r];
    for (const arm of arms) {
      const b = resolveDeclaredTypeForCompilation(arm);
      if (b === 'never') continue;
      if (isTupleShapedType(b))
        return (
          'can be a tuple or hold tuples, which the run-time value does not ' +
          'tell apart from a list'
        );
      if (isSubtype(b, 'string'))
        return (
          'can be a string or hold strings, whose shape the run-time value ' +
          'does not give'
        );
      if (
        isSubtype(b, 'collection<any>') &&
        !isSubtype(b, 'indexed_collection<any>')
      )
        return (
          'can be a collection that is not indexed (a set, an interval or a ' +
          'dictionary), which has no shape'
        );
      if (depth < 8 && isSubtype(b, 'indexed_collection<any>')) {
        const elt = collectionElementType(b);
        if (elt !== undefined) {
          const inner = refusal(elt, depth + 1);
          if (inner !== undefined) return inner;
        }
      }
    }
    return undefined;
  };
  return refusal(a.type.type, 0);
}

/**
 * Is `a` a GATED POINT: a gated indexed collection
 * (`isGatedIndexedCollection`) whose every present arm is a tuple, such as
 * `When((0, 1), c)`? At run time it is a point or the absent value. The
 * broadcast lowering must then apply the point rules of the interpreter: a
 * point does not add to a number, two points have no product, and a number
 * cannot be divided by a point.
 */
export function isGatedPoint(a: Expression): boolean {
  const arms = gatedCollectionArms(a);
  return arms !== undefined && arms.every((b) => isTupleShapedType(b));
}

/**
 * Is `a` a GATED LIST OF POINTS: a gated indexed collection
 * (`isGatedIndexedCollection`) whose every present arm is a list whose
 * elements are points, such as `PointList(L {c}, y)`, typed
 * `list<tuple<…>> | missing`? At run time it is a list of points or the
 * absent value.
 */
export function isGatedPointList(a: Expression): boolean {
  const arms = gatedCollectionArms(a);
  return (
    arms !== undefined &&
    arms.every((b) => {
      if (isTupleShapedType(b)) return false;
      const elt = collectionElementType(b);
      return elt !== undefined && isPointElementType(stripMissingFromType(elt));
    })
  );
}

/**
 * Whether a `Take`/`Drop` count can be `NaN` (or have no value) at run time.
 * It cannot when it is a number literal other than `NaN` (a literal `±∞` is
 * not a constant to `tryGetConstant` and takes the run-time branch, but it
 * is never `NaN`), or when it is typed `integer` and reads no symbol.
 *
 * The type `integer` alone is not a proof. A variable the caller leaves
 * out of the vars object reads as `undefined`, and `Math.round(undefined)`
 * is `NaN`; and a user function with one clause accepts `NaN` at a
 * parameter typed `integer` (`docs/ERROR-MODEL.md`, "A user function
 * accepts `NaN` at a numeric parameter — RULED 2026-09-30"). So `Take(xs,
 * k)` with `k: integer` unsupplied must give no value, as in the
 * interpreter, and not `[]`.
 *
 * An integer count whose every symbol is an index of an enclosing binder
 * that the compiler controls (`BaseCompiler.isCompiledIndex`: a loop index
 * with literal bounds, the index of an unrolled `Sum` term) is proven too:
 * `Sum(Length(Take(xs, i)), (i, 1, 3))` takes no test at each term.
 */
export function countMayBeNaN(
  count: Expression,
  target?: CompileTarget<Expression>
): boolean {
  if (isNumber(count) && !count.isComplex && !Number.isNaN(count.re))
    return false;
  if (
    isSubtype(count.type.type, 'integer') &&
    count.symbols.every((s) => isCompiledIndex(s, target))
  )
    return false;
  return true;
}

/**
 * The present arms of a gated indexed collection (see
 * `isGatedIndexedCollection`), alias-resolved, or `undefined` when `a` is
 * not one.
 */
export function gatedCollectionArms(a: Expression): Type[] | undefined {
  return gatedCollectionArmsOfType(a.type.type);
}

/** `gatedCollectionArms` for a type rather than an operand. */
function gatedCollectionArmsOfType(raw: Type): Type[] | undefined {
  if (isNominalAtomicType(raw)) return undefined;
  const r = resolveTypeForCompilation(raw);
  if (typeof r === 'string' || r.kind !== 'union') return undefined;
  let absent = false;
  const arms: Type[] = [];
  for (const branch of r.types) {
    if (isNominalAtomicType(branch)) return undefined;
    const b = resolveTypeForCompilation(branch);
    if (b === 'missing') absent = true;
    else if (b === 'never') continue;
    else if (
      !isSubtype(b, 'string') &&
      isSubtype(b, INDEXED_COLLECTION_SHAPE_TYPE)
    )
      arms.push(b);
    else return undefined;
  }
  return absent && arms.length > 0 ? arms : undefined;
}

/**
 * The collection arms of a union of `missing`, number arms and at least one
 * indexed collection arm (`missing | number | vector<2>`, the type of an
 * index into a `broadcastable<vector<2>>`), or `undefined` for another
 * type. A value of such a type is a number, a collection, or the absent
 * object. An absent number is the numeric marker `NaN`, so `undefined` at
 * run time is always the absent collection, which the interpreter answers
 * as `Missing`: the value can hold an absent object at level 0, as a gated
 * indexed collection can (`gatedCollectionArmsOfType`). A number arm is
 * read by `bcastAbsent` as by `bcast`.
 */
function numberOrGatedCollectionArms(raw: Type): Type[] | undefined {
  if (isNominalAtomicType(raw)) return undefined;
  const r = resolveTypeForCompilation(raw);
  if (typeof r === 'string' || r.kind !== 'union') return undefined;
  const present: Type[] = [];
  let absent = false;
  let numeric = false;
  for (const branch of r.types) {
    const b = resolveTypeForCompilation(branch);
    if (b === 'missing') absent = true;
    else if (isSubtype(b, 'number')) numeric = true;
    else present.push(branch);
  }
  if (!absent || !numeric || present.length === 0) return undefined;
  return gatedCollectionArmsOfType({
    kind: 'union',
    types: ['missing', ...present],
  });
}

/** True when `t` is a union with a `missing` arm. */
function hasMissingArm(t: Type): boolean {
  const r = resolveTypeForCompilation(t);
  return (
    typeof r !== 'string' &&
    r.kind === 'union' &&
    r.types.some((b) => resolveTypeForCompilation(b) === 'missing')
  );
}

/**
 * The array levels at which a value of type `raw` can hold an ABSENT OBJECT
 * (a point, a list, or another indexed collection that may be `undefined`
 * at run time), as a bit set: bit `k` is set when level `k` can hold one.
 * `0` (no bit set) means the value cannot hold an absent object.
 *
 * - Level `0`: the value itself can be absent. Its type is a gated indexed
 *   collection (`gatedCollectionArms`), such as the restricted point
 *   `When((0, 1), c)`, typed `missing | tuple<integer, integer>`.
 * - Level `k + 1`: the value is a list (not a tuple) whose elements can hold
 *   an absent object at level `k`, such as `[P{c}, Q]`, typed
 *   `list<missing | tuple<…>>`, at level 1.
 *
 * A value can have more than one level. The restricted list of points
 * `[P{c}, Q]{d}`, typed `missing | list<missing | tuple<…>>`, is absent
 * when `d` fails (level 0), and when it is present its first element is
 * absent when `c` fails (level 1): its set is `0b11`. The present arm of a
 * gated type is read for its own levels for this reason.
 *
 * A tuple has no level of its own: its components are numeric slots, where
 * an absent value is `NaN`. Read by `tryCompileBroadcast`, which routes an
 * operand with a level through `_SYS.bcastAbsent`, so that arithmetic on an
 * absent point answers `undefined` for the whole point, as the interpreter
 * answers `Missing` (`docs/ERROR-MODEL.md` §3).
 *
 * A top type beside a `missing` arm (`missing | unknown`, the type of an
 * index into a `list<unknown>`) is a value of any kind that can be absent:
 * level 0 (ROADMAP CE-368).
 */
export function objectAbsenceLevels(raw: Type, depth = 0): number {
  if (depth > 4 || isNominalAtomicType(raw)) return 0;
  // A top type beside absence markers (`missing | unknown`, the type of an
  // index into a `list<unknown>`: `g(x)[5]` with `g := t ↦ [t, 2t]` and
  // `x: any`) is a value of any kind, or absent. The compiled `At` spells
  // the absent element `undefined`, and the plain `bcast` applied the
  // scalar function to it: `g(x)[5] + 1` gave `NaN` and `g(x)[5] < 1` gave
  // `false`, where the interpreter answers `Missing` (ROADMAP CE-368). The
  // value can be absent at level 0; its elements, when it is a list, are
  // read by the rules of `bcast`.
  if (topTypeBesideAbsence(raw) !== undefined && hasMissingArm(raw)) return 1;
  const arms =
    gatedCollectionArmsOfType(raw) ?? numberOrGatedCollectionArms(raw);
  if (arms !== undefined) {
    // Level 0, and the levels a present arm can hold.
    let levels = 1;
    for (const arm of arms) levels |= objectAbsenceLevels(arm, depth + 1);
    return levels;
  }
  const r = resolveTypeForCompilation(raw);
  if (typeof r === 'string' || r.kind === 'tuple') return 0;
  if (isSubtype(r, 'string') || !isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE))
    return 0;
  const elt = collectionElementType(r);
  if (elt === undefined) return 0;
  return objectAbsenceLevels(elt, depth + 1) << 1;
}

/**
 * The compilation type of `a` without its absence: for a GATED indexed
 * collection with one present arm (`isGatedIndexedCollection`, such as the
 * restricted list of points `PointList(When(A, 0 < t), B)`, typed
 * `list<tuple<real, real>> | missing`), that arm; otherwise the compilation
 * type of `a`. At run time such an operand is an array of the present type,
 * or the absent value `undefined`. The point-list plans of
 * `tryCompileBroadcast` read an operand's element type to prove that it is
 * a list of points, and the `missing` arm hid it: `(A\{0<t\}, B) + (1, 1)`
 * declined to compile where the interpreter answers the shifted points.
 * Those plans emit `NaN` for a source that is not an array at run time, or
 * `undefined` for an absent source when the result can be absent
 * (`A\{0<t\} + 1` runs to `undefined` when `t` is negative; see
 * `objectAbsenceLevels`).
 */
export function presentCompilationType(a: Expression): Type {
  const arms = gatedCollectionArms(a);
  if (arms !== undefined && arms.length === 1) return arms[0];
  return compilationType(a);
}

/**
 * For an operand `isRuntimePointShaped` admitted, can its run-time value be
 * told apart as a point or a list of points by its SHAPE alone? Every tuple
 * arm of the union must be a point of plain NUMBERS (a coordinate that is
 * itself a collection would be read as a list of points), and every other
 * arm must be a NUMBER — never an array, so the shape test cannot mistake
 * it — or a collection of POINTS (`isPointElementType`): a collection arm
 * that admits plain numbers — `list<number>`, or the
 * `indexed_collection<number | tuple<…>>` a document may declare — could
 * hold a flat array of numbers, which has the shape of a point. Read by the
 * run-time point-or-list plan of `Add`.
 */
export function runtimePointShapeIsUnambiguous(a: Expression): boolean {
  const r = resolveTypeForCompilation(a.type.type);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  return r.types.every((branch) => {
    const b = resolveTypeForCompilation(branch);
    if (b === 'never' || isSubtype(b, 'number')) return true;
    if (typeof b !== 'string' && b.kind === 'tuple')
      return b.elements.every((c) => isSubtype(c.type, 'number'));
    return isPointElementType(collectionElementType(b));
  });
}

/**
 * The finite real number a piece of EMITTED code denotes when it is a bare
 * numeric literal — `undefined` for anything else.
 *
 * `Number`, NOT `parseFloat`: `parseFloat` reads a LEADING NUMERIC PREFIX and
 * ignores the rest, so it reports `0.333` for the compiled bound
 * `0.3333333333333333 * (_.L).length` and a caller would fold a constant out
 * of an expression that has none. `Number` requires the WHOLE string to be
 * numeric. The empty string is excluded explicitly, since `Number('')` is 0.
 */
export function numericLiteralSource(code: string): number | undefined {
  const trimmed = code.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Does a point-or-other union (`isRuntimePointShaped` above) also admit a
 * FLAT NUMERIC LIST — a run-time array of plain numbers that is NOT a point?
 * True when one of its non-tuple arms is a collection whose element type is
 * not itself tuple-shaped: `list<number> | tuple<…>` admits `[3, −4]` as a
 * list the interpreter reads element-wise, and
 * `indexed_collection<number | tuple<…>> | …` admits it too, because its
 * element type has a scalar member. An unknown element type (no element type
 * at all, or a top one) counts as admitting it, since nothing rules it out.
 *
 * A compiled array carries no tuple-versus-list tag, so for such an operand
 * a flat array of numbers is ambiguous at run time, and reading it as a
 * point would answer the norm where the interpreter answers the element-wise
 * result. The `Abs` run-time shape dispatch therefore refuses these operands
 * unless the operand is a point SUM, which the interpreter refuses for a
 * flat list (Tycho item 253).
 */
export function unionAdmitsFlatNumericList(a: Expression): boolean {
  const r = resolveTypeForCompilation(a.type.type);
  if (typeof r === 'string' || r.kind !== 'union') return false;
  for (const branch of r.types) {
    const b = resolveTypeForCompilation(branch);
    if (b === 'never' || isTupleShapedType(b)) continue;
    if (!isSubtype(b, COLLECTION_SHAPE_TYPE)) continue;
    const elt = collectionElementType(b);
    if (elt === undefined) return true;
    if (!isTupleShapedType(elt)) return true;
  }
  return false;
}

/**
 * Is `a` a sum with a provable POINT among its operands? Such a sum can
 * never hold a flat list of numbers at run time: adding a point to a number
 * is the interpreter's `incompatible-type` error, and over a list of numbers
 * that error is answered at every element. The `Abs` run-time shape dispatch
 * uses this to admit an operand whose type would otherwise also admit a flat
 * numeric list (Tycho item 253).
 */
export function isPointSumOperand(a: Expression): boolean {
  return isFunction(a, 'Add') && a.ops.some((o) => isNumericTuple(o));
}

/**
 * The `p / q` of an operand that is an EXACT rational number literal whose
 * denominator is neither 1 nor a power of two — the shape that must be
 * lowered as a target DIVISION rather than as a multiplication by the
 * reciprocal.
 *
 * Canonicalization turns `x / 49` into `Multiply(Rational(1, 49), x)`, and
 * emitting that literal directly gives `fl(1/49) * x`. IEEE division is
 * correctly rounded, so `x / 49` is exactly `k` at `x = 49k`, while
 * `x * fl(1/49)` is not: `floor`, `mod 1` and `= 1` then answer one less
 * than the interpreter at every exact multiple. A denominator that IS a
 * power of two is exempt: its reciprocal is exact in binary floating point,
 * so `0.5 * x` and `x / 2` agree bit for bit and the shorter product is
 * kept.
 *
 * Returns `undefined` for anything else: an inexact (float) literal, a
 * complex one, a value with a radical part (`√2 / 49` is not a plain
 * rational), and any numerator or denominator too large to survive the round
 * trip through a target `number` literal.
 *
 * The Tycho code-generation audit of 2026-09-08 measured 82 divisors below
 * 1000 for which the reciprocal product misses an exact multiple.
 */
export function exactRationalDivisor(
  x: Expression
): { p: number; q: number } | undefined {
  if (!isNumber(x) || !x.isExact) return undefined;
  const r = asRational(x);
  if (r === undefined) return undefined;
  const p = Number(r[0]);
  const q = Number(r[1]);
  if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q)) return undefined;
  if (q <= 1) return undefined;
  // A power-of-two denominator has an exact reciprocal, so the product is
  // already correctly rounded. The test must NOT use the JavaScript bitwise
  // operators: they truncate their operand to 32 bits, so a denominator such
  // as `49 · 2^32` — well inside the safe-integer range — would pass as a
  // power of two and keep the reciprocal product.
  if (2 ** Math.round(Math.log2(q)) === q) return undefined;
  return { p, q };
}

/**
 * `isPossiblyCollectionTyped` for the compiled lanes: a symbol the user
 * declared `any` or `value` is read as a SCALAR here, and so is a library
 * element-wise application over scalars (`2a + 1`), where the typing route
 * reads them as a possible collection (user decision 2026-10-17, Tycho
 * ledger row 379). Compiled code binds such a symbol as the value the host
 * passes, and a run-time kernel such as `_SYS.absAny` checks that value
 * itself; wrapping every use in a broadcast would cost a closure per site
 * for a consumer that declares every parameter `any`. A call of a user
 * function typed `any` and a `broadcastable<T>` type keep their reading.
 *
 * The JavaScript target still checks the value at run time at an arithmetic
 * site (`declaredTopGuard` in `BaseCompiler`): it emits the scalar code and
 * the list code, and chooses one with `Array.isArray`. The list code is
 * compiled while `declaredTopMode` is `'list'`, and then such a symbol is
 * read as a possible collection here.
 */
export function possiblyCollectionTypedForCompile(e: Expression): boolean {
  if (CompilerState.declaredTopMode === 'list')
    return isPossiblyCollectionTyped(e);
  return isPossiblyCollectionTyped(e, { declaredSymbols: false });
}

/**
 * Is `e` read as a scalar by the compiled lanes only because of the rule of
 * `possiblyCollectionTypedForCompile`? This is a symbol the user declared
 * `any` or `value`, or a library application over such a symbol (`2p + 1`):
 * the typing reads it as a possible collection, and the compiled lanes read
 * it as a number.
 */
export function isDeclaredTopOperand(e: Expression): boolean {
  return (
    !isPossiblyCollectionTyped(e, { declaredSymbols: false }) &&
    isPossiblyCollectionTyped(e)
  );
}

/**
 * The symbols declared `any` or `value` whose values decide whether `e` is a
 * list at run time: `e` itself when it is such a symbol, else the symbols of
 * its operands when `e` is an application that `isDeclaredTopOperand` admits.
 */
export function collectDeclaredTopSymbols(
  e: Expression,
  out: Set<Expression>,
  visited: Set<Expression> = new Set()
): void {
  // An expression can share one node at many positions (a tower where each
  // level uses the level below twice). The walk visits each node once, so its
  // cost grows with the number of nodes, not with the number of positions.
  if (visited.has(e)) return;
  visited.add(e);
  if (!isDeclaredTopOperand(e)) return;
  if (isSymbol(e)) out.add(e);
  else if (isFunction(e))
    for (const op of e.ops) collectDeclaredTopSymbols(op, out, visited);
}

/**
 * For the JavaScript target: is `e` read as a possible collection only
 * because the list code of a run-time check is being compiled (see
 * `declaredTopMode`)? The JavaScript target has its own test of a possible
 * collection, and asks this one too.
 */
export function isDeclaredTopListOperand(e: Expression): boolean {
  return CompilerState.declaredTopMode === 'list' && isDeclaredTopOperand(e);
}

/**
 * `isTopTypedBlockLocal` (`collection-utils.ts`), for the JavaScript target,
 * whose twin predicate cannot import that module: a `Block` local typed by
 * a top type may hold a list, and the compiled code broadcasts over it. A
 * symbol the user declared `any` is not a local, and stays scalar code.
 */
export function isTopTypedLocalSymbol(e: Expression): boolean {
  return isTopTypedBlockLocal(e);
}

/**
 * `target` is optional, and passing it can only make the answer NARROWER: a
 * value the JavaScript emission proves scalar by CONSTRUCTION — a literal, an
 * explicitly declared scalar input, scalar arithmetic over those, or a call of
 * a user function whose body yields a scalar under scalar parameters — is not
 * a collection at run time whatever its static type says. Only the callers
 * that DECIDE an emitted broadcast pass it (the arithmetic broadcast in
 * `tryCompileBroadcast`); the callers that merely classify an operand of a
 * broadcast someone else decided keep the conservative reading, which for them
 * costs nothing: `_SYS.bcast` applies its closure directly to a scalar
 * operand.
 */
export function isBoundPossiblyCollectionTyped(
  a: Expression,
  target?: CompileTarget<Expression>
): boolean {
  if (
    target !== undefined &&
    target.language === 'javascript' &&
    isConstructedScalar(a, target)
  )
    return false;
  // A declared scalar-or-collection union is reliable on any node, bound or
  // not — see `unionAdmitsIndexedCollection`. The RAW type is passed: the
  // helper refuses a nominal reference before resolving it, and
  // `compilationType` would already have resolved a sum alias to its body.
  if (unionAdmitsIndexedCollection(a.type.type)) return true;
  const t = compilationType(a);
  if (!possiblyCollectionTypedForCompile(a)) return false;
  if (typeof t !== 'string' && t.kind === 'broadcastable') return true;
  return a.isCanonical || a.isStructural;
}

/**
 * Is `e` PROVABLY a flat list of numbers — the one collection shape the
 * interval target broadcasts a scalar kernel over, and the only argument
 * shape it maps a scalar-parameter user function over?
 *
 * The evidence is the static type: an indexed collection (`list<number>`,
 * `vector<3>`, a `Range`, `indexed_collection<integer>`) whose element type
 * is a subtype of `number`. Three indexed shapes are refused although they
 * match the collection tops: a TUPLE is one point, which the interval target
 * consumes whole (`Norm`, the coordinate accessors) and which the
 * interpreter excludes from broadcasting; a STRING is an indexed collection
 * of its grapheme clusters in the type lattice but has no numeric elements;
 * and a nested list (`list<list<number>>`) has an element type that is not a
 * number. A wide type — `unknown`, a `broadcastable<number>` application, a
 * union with a scalar arm — is not evidence: only a proof admits the
 * element-wise lowering, so a value that is not a list of intervals can never
 * reach the run-time broadcast from compiled code.
 *
 * Exported for the interval target, which must not import
 * `collection-utils` directly (see `pointHasBroadcastComponent`).
 */
export function isProvablyNumericListOperand(e: Expression): boolean {
  if (isProvablyStringOperand(e)) return false;
  const t = compilationType(e);
  if (isTupleShapedType(t)) return false;
  if (
    !e.type.matches('list<any>') &&
    !e.type.matches('indexed_collection<any>')
  )
    return false;
  const element = collectionElementType(t);
  if (element === undefined) return false;
  return isSubtype(element, 'number');
}

/**
 * Is `e` a RESTRICTED list of numbers: a gated indexed collection
 * (`isGatedIndexedCollection`, typed `C | missing`) whose every present arm
 * is a flat list of numbers, never a point? `When(A, 0 < t)` with
 * `A: list<real>` is one, typed `list<real> | missing`. At run time it is
 * that list or the absent value. `isProvablyNumericListOperand` refuses it,
 * because the `missing` arm is not a list.
 *
 * Exported for the interval target, whose run-time `PointList` zip
 * (`_IA.pointList`) passes an absent source through as the value of the
 * whole list of points.
 */
export function isGatedNumericListOperand(e: Expression): boolean {
  if (isProvablyStringOperand(e)) return false;
  const arms = gatedCollectionArms(e);
  if (arms === undefined) return false;
  return arms.every((b) => {
    if (isTupleShapedType(b)) return false;
    const element = collectionElementType(b);
    return element !== undefined && isSubtype(element, 'number');
  });
}

/**
 * Is the point component `op` a RESTRICTED list: a list or the absent value,
 * typed `list<…> | missing` (`L {c}`)? When it is present, the point is one
 * point per element of the list (`broadcastingComponentKind`). Exported for
 * the compile targets, which must not import `collection-utils` directly.
 */
export function isGatedListComponent(op: Expression): boolean {
  return broadcastingComponentKind(op.type.type) === 'gated-list';
}

/**
 * True when every coordinate of every point that a value of type `t` can
 * hold is a number: `t` is a tuple whose components are all numbers, or a
 * `broadcastable`, a list or a union whose points are all such tuples, at
 * every level. A bare `tuple`, a coordinate that is not provably a number
 * (`string`, `number | missing`), and any other type answer `false`.
 *
 * The run-time point dispatch of the compile targets (`_SYS.pointComponent`
 * in `javascript-runtime.ts`, `pointComponent` in `interval/collections.ts`)
 * sees a point and a list of numbers as the same array. It reads an array
 * as a point only when every cell of it is a number. A point that has a
 * non-numeric coordinate (`("a", 1)`) is then read as a list that is not a
 * list of points, and the answer is wrong. The compile targets use this
 * test to refuse such an operand, so that the interpreter answers.
 */
export function everyPointCoordinateIsNumeric(t: Type, depth = 0): boolean {
  // The depth limit stops a self-referential alias.
  if (depth > 16) return false;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return false;
  if (r.kind === 'tuple')
    return (
      r.elements.length > 0 &&
      r.elements.every((c) => isSubtype(c.type, 'number'))
    );
  if (r.kind === 'union')
    return r.types.every((arm) =>
      everyPointCoordinateIsNumeric(arm, depth + 1)
    );
  if (r.kind === 'broadcastable' || r.kind === 'list')
    return everyPointCoordinateIsNumeric(r.elements, depth + 1);
  return false;
}

/**
 * True when a value of type `t` may be an array of numbers of rank `rank` or
 * more, with no tuple at any level: `[[[1, 2], [3, 4]]]` for `rank` 3. The
 * answer is `true` for a type that states nothing (`unknown`, `any`, a bare
 * `list`), and for a type this test does not read, so a caller that refuses
 * on `true` fails closed. A tuple answers `false`: the interpreter reads a
 * tuple as a point, never as numeric data.
 *
 * The run-time point dispatch of the compile targets (`_SYS.pointComponent`
 * in `javascript-runtime.ts`, `pointComponent` in `interval/collections.ts`)
 * sees a tuple and a list as the same array. So it cannot tell a list of
 * lists of points (`[[(1, 2), (3, 4)]]`, which the interpreter maps down to
 * its points, `[[1, 3]]`) from a numeric array of rank 3 (`[[[1, 2], [3,
 * 4]]]`, which the interpreter element-indexes, `[[1, 2], [3, 4]]`). The
 * compile targets use this test to refuse an operand whose static type
 * admits such numeric data, so that the interpreter answers.
 */
export function mayHoldNumericArrayOfRank(
  t: Type,
  rank: number,
  depth = 0
): boolean {
  // The depth limit stops a self-referential alias.
  if (depth > 16) return true;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') {
    if (rank <= 0) return couldMatch(r, 'number');
    if (
      r === 'unknown' ||
      r === 'any' ||
      r === 'value' ||
      r === 'expression' ||
      r === 'list' ||
      r === 'set' ||
      r === 'collection' ||
      r === 'indexed_collection'
    )
      return true;
    if (r === 'range') return rank <= 1;
    return false;
  }
  const next = (x: Type, n: number) =>
    mayHoldNumericArrayOfRank(x, n, depth + 1);
  switch (r.kind) {
    case 'union':
      return r.types.some((arm) => next(arm, rank));
    case 'intersection':
      return r.types.every((arm) => next(arm, rank));
    case 'tuple':
      return false;
    // A numeric range type (`real<0..1>`) is a number.
    case 'numeric':
      return rank <= 0;
    case 'list': {
      if (rank <= 0) return false;
      const dims = r.dimensions;
      // A tensor of unknown rank (`tensor<U>`) holds every rank.
      if (dims === null) return next(r.elements, 0);
      if (dims !== undefined) return dims.length >= rank && next(r.elements, 0);
      return next(r.elements, rank - 1);
    }
    case 'set':
    case 'collection':
    case 'indexed_collection':
      return rank > 0 && next(r.elements, rank - 1);
    case 'broadcastable':
      // `broadcastable<T>` is `T` or a tensor of `T` cells of any rank.
      return next(r.elements, 0) || next(r.elements, rank);
    case 'record':
    case 'dictionary':
    case 'signature':
      return false;
    default:
      return true;
  }
}

/**
 * True when type `t` is a function type, or a union with a function arm.
 */
export function typeHasFunctionArm(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return r === 'function';
  if (r.kind === 'signature') return true;
  if (r.kind === 'union') return r.types.some(typeHasFunctionArm);
  return false;
}

/**
 * True when a value of type `t` may hold a tuple (a point) at any level: a
 * tuple type, a collection whose elements may be tuples, or a type that
 * states nothing (`unknown`, `any`, a bare `list`). A number type and a
 * collection of numbers answer `false`.
 */
export function typeMayHoldTuple(t: Type, depth = 0): boolean {
  // The depth limit stops a self-referential alias.
  if (depth > 16) return true;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string')
    return (
      r === 'tuple' ||
      r === 'unknown' ||
      r === 'any' ||
      r === 'value' ||
      r === 'expression' ||
      r === 'list' ||
      r === 'set' ||
      r === 'collection' ||
      r === 'indexed_collection'
    );
  const next = (x: Type) => typeMayHoldTuple(x, depth + 1);
  switch (r.kind) {
    case 'tuple':
      return true;
    case 'union':
      return r.types.some(next);
    case 'intersection':
      return r.types.every(next);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return next(r.elements);
    default:
      return false;
  }
}

/**
 * Whether the type `t` holds a point by an explicit tuple: a tuple type, a
 * union with such an arm, or a list, a tensor or a `broadcastable` whose
 * elements are such a type (`broadcastable<tuple<number, number>>`). A top
 * type (`any`, `unknown`, `value`) and a bare `list` answer `false`: they
 * may hold a point, but they do not show one. The depth limit stops a
 * self-referential alias.
 */
export function typeHasPointArm(t: Type, depth = 0): boolean {
  if (depth > 16) return false;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') return r === 'tuple';
  switch (r.kind) {
    case 'tuple':
      return true;
    case 'union':
      return r.types.some((x) => typeHasPointArm(x, depth + 1));
    case 'list':
    case 'broadcastable':
      return typeHasPointArm(r.elements, depth + 1);
    default:
      return false;
  }
}

/**
 * Whether every value of the type `t` that compiled code holds as an array
 * is a point or a collection of points: each arm is a scalar number, an
 * absence marker, a tuple, or a list, a tensor or a `broadcastable` whose
 * cells are tuples. `broadcastable<tuple<number, number>>` and
 * `missing | number | tuple<…> | tensor<tuple<…>>` answer `true`;
 * `list<number> | tuple<…>` and a top type answer `false`. The depth limit
 * stops a self-referential alias.
 */
export function arraysArePoints(t: Type, depth = 0): boolean {
  if (depth > 16) return false;
  const r = resolveTypeAlias(t);
  const next = (x: Type) => arraysArePoints(x, depth + 1);
  const cellsArePoints = (x: Type, d: number): boolean => {
    if (d > 16) return false;
    const c = resolveTypeAlias(x);
    if (typeof c === 'string')
      return c === 'tuple' || c === 'missing' || c === 'never';
    if (c.kind === 'tuple') return true;
    if (c.kind === 'union')
      return c.types.every((arm) => cellsArePoints(arm, d + 1));
    if (c.kind === 'list' || c.kind === 'broadcastable')
      return cellsArePoints(c.elements, d + 1);
    return false;
  };
  if (typeof r === 'string') {
    if (r === 'tuple' || r === 'missing' || r === 'nothing' || r === 'never')
      return true;
    return isSubtype(r, 'number');
  }
  switch (r.kind) {
    case 'tuple':
      return true;
    case 'union':
      return r.types.every(next);
    case 'list':
    case 'broadcastable':
      return cellsArePoints(r.elements, depth + 1);
    default:
      return isSubtype(r, 'number');
  }
}

/**
 * A `Tuple` or `List` literal with a broadcasting component — a shape whose
 * norm does NOT reduce to one scalar, so `Norm`/`Abs` compile handlers use
 * this to fail closed and let the interpreter broadcast. Exported for
 * the compile targets, which must not import `collection-utils` directly
 * (module-init ordering — see `isIndexedCollectionOperand` in
 * javascript-target.ts); this module already imports it safely.
 *
 * The broadcast test differs by literal kind, mirroring evaluation
 * semantics:
 * - `Tuple` (a point): ANY non-tuple collection component broadcasts —
 *   `([1,2], 3)` zips into a list of two points, one norm per element. A
 *   tuple-typed component is atomic (a nested point), not a broadcast.
 * - `List` (a vector): a literal `List` component is a matrix ROW (the
 *   Frobenius norm is a legitimate scalar), so only a NON-literal
 *   collection-typed component (e.g. the `broadcastable`-typed `x+[0.5,1]`)
 *   is a hazard — evaluation nests it where a compiled flatten cannot
 *   follow (invalid vecN shader source; a silently-flattened wrong scalar
 *   through `_SYS.norm`).
 */
export function pointHasBroadcastComponent(expr: Expression): boolean {
  // A `PointList` component is read the same way as a `Tuple` component: an
  // all-scalar `PointList` is one point, and a collection-valued component
  // makes it a SOURCE of several points.
  //
  // A RESTRICTED list component (`L {c}`, typed `list<…> | missing`) is a
  // broadcasting component too: when it is present, the point is one point
  // per element (`broadcastingComponentKind`).
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'PointList'))
    return expr.ops.some(
      (op) =>
        !isTuple(op) &&
        (op.isCollection ||
          op.type.matches('indexed_collection<any>') ||
          isGatedListComponent(op))
    );
  if (isFunction(expr, 'List'))
    return expr.ops.some(
      (op) =>
        !isFunction(op, 'List') &&
        !isTuple(op) &&
        (op.isCollection || op.type.matches('indexed_collection<any>'))
    );
  return false;
}

/**
 * The norm of a point with a broadcasting component, written as the explicit
 * Euclidean norm `Sqrt(Square(c1) + … + Square(cn))`, or a string that says
 * why this form is not used.
 *
 * `point` is a `Tuple` or a `PointList` literal for which
 * `pointHasBroadcastComponent` is true. The interpreter reads it as one point
 * per element of its list components, so its norm is one number per element.
 * The explicit form computes the same list: every target already compiles
 * `Square` and `Add` element-wise over a list of numbers, and the result has
 * the shape of the same norm written by hand (`vec2` on a shader target, an
 * array of intervals on the interval target). Each component occurs once in
 * the explicit form, so it is evaluated once.
 *
 * The explicit form is used only when it gives the same value:
 *
 * - every component is a number or a provable list of numbers. A nested
 *   point or a list of lists is not a coordinate, and its `Square` is not
 *   the square of a coordinate.
 * - no component is complex. The norm takes the square of the modulus, and
 *   `Square` of a complex number is not that.
 * - every list component has the same length, and its static type gives
 *   that length. A `PointList` zips its lists to the length of the shortest
 *   one, but the element-wise `Add` requires lists of one length. Two lists
 *   of different lengths, or a list whose length is known only at run time,
 *   would give a different answer, so the caller must handle them another
 *   way or decline.
 *
 * Shared by the interval and shader targets. The JavaScript target has its
 * own run-time lowering of the same norm (its `Norm` handler).
 */
export function explicitBroadcastPointNorm(
  point: Expression,
  target: CompileTarget<Expression>
): Expression | string {
  if (!isFunction(point, 'Tuple') && !isFunction(point, 'PointList'))
    return 'the operand is not a point literal';
  if (!pointHasBroadcastComponent(point))
    return 'the point has no list component';
  let length: number | undefined;
  for (const op of point.ops) {
    if (core.isComplexValued(op))
      return `the component \`${op.toString()}\` is complex`;
    if (isTuple(op))
      return `the component \`${op.toString()}\` is a point, not a coordinate`;
    // A restricted list has no static value: it can be absent, and the
    // explicit form has no reading of an absent list.
    if (isGatedListComponent(op))
      return `the component \`${op.toString()}\` is a restricted list, which can be absent`;
    if (!op.isCollection && !op.type.matches('indexed_collection<any>')) {
      // A symbol with no type evidence (the free plot variable) is read as a
      // number, as every scalar position of these targets reads it.
      const t = compilationType(op);
      if (!op.type.matches('number') && t !== 'unknown' && t !== 'any')
        return `the component \`${op.toString()}\` is not a number`;
      continue;
    }
    if (!isProvablyNumericListOperand(op))
      return `the component \`${op.toString()}\` is not a list of numbers`;
    const n = typeElementCount(compilationType(op));
    if (n === undefined)
      return `the length of the component \`${op.toString()}\` is not known at compile time`;
    if (length !== undefined && n !== length)
      return `its list components have different lengths (${length} and ${n})`;
    length = n;
  }
  // A caller who overrode one of the heads of the explicit form (the
  // `functions` and `operators` compilation options) did not ask for it to
  // be called for a norm.
  const heads = ['Sqrt', 'Add', 'Square', 'Power'];
  if (heads.some((h) => target.unrollSkipHeads?.has(h) === true))
    return 'the caller overrides a head of the explicit norm';
  // The nodes are STRUCTURAL, not canonical: canonical construction folds a
  // literal coordinate (`Square(3)` becomes `9`), which is a constant fold
  // that a compilation with `constantFold: false` asks not to make. Each
  // square is `Power(c, 2)`, the canonical form of `Square(c)`, because the
  // shader targets lower `Power` of a `vecN` component by component and do
  // not lower `Square` of a `vecN`. The terms of the sum are sorted in the
  // canonical order of `Add`, so the code has the same term order as the
  // norm written by hand.
  const ce = point.engine;
  const squares = point.ops.map((c) =>
    ce.function('Power', [c, ce.number(2)], { form: 'structural' })
  );
  const norm = ce.function(
    'Sqrt',
    [
      squares.length === 1
        ? squares[0]
        : ce.function('Add', sortOperands('Add', squares), {
            form: 'structural',
          }),
    ],
    { form: 'structural' }
  );
  // The compile entry has already applied the fixed-width unroll to the
  // expression, but not to these new nodes. Apply it here with the options
  // of the target, so that the explicit form compiles the same as the norm
  // written by hand (on the interval target, an array of one norm per
  // element instead of a run-time broadcast).
  return unrollFixedWidthCollections(norm, {
    skipHeads: target.unrollSkipHeads,
    overridesHead: target.overridesHead,
    iterationBudget: target.iterationBudget,
    readsLiveSource: target.cse?.harvestOptions?.isStringVar,
    minWidth: target.unrollMinWidth,
    unrollConstantLists: target.unrollConstantLists,
    typedPointLists: target.unrollTypedPointLists,
    unrollComprehensions: target.unrollComprehensions,
  });
}

/**
 * Whether the tuple type `t` declares a coordinate `broadcastable<…>`, which
 * admits a list at that coordinate (`tuple<broadcastable<number>,
 * broadcastable<number>>`).
 */
export function hasBroadcastableCoordinate(t: Type): boolean {
  if (typeof t === 'string') return false;
  if (t.kind === 'union') return t.types.some(hasBroadcastableCoordinate);
  if (t.kind !== 'tuple') return false;
  return t.elements.some(
    (e) => typeof e.type !== 'string' && e.type.kind === 'broadcastable'
  );
}

/**
 * True when `name` is read as an index of an enclosing binder that the
 * compiler controls: a loop index with literal bounds
 * (`isDecidedLoopIndex`), or the index of an unrolled `Sum`/`Product`
 * term, which compiles to its integer value (`_unrolledIndexValues`).
 * Such an index is never `NaN` and never absent.
 */
export function isCompiledIndex(
  name: string,
  target: CompileTarget<Expression> | undefined
): boolean {
  if (isDecidedLoopIndex(name, target?.boundVars)) return true;
  const frames = CompilerState._unrolledIndexValues;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].masked.has(name)) return false;
    if (frames[i].values.has(name)) return true;
  }
  // A name that the target compiles to a number literal (the index of
  // an unrolled term, emitted as its value through the target's
  // variables).
  if (target === undefined || !CompilerState._boundVarsCtx?.has(name))
    return false;
  const code = target.var?.(name);
  return code !== undefined && Number.isFinite(Number(code));
}

/** The type-level half of {@link isNominalAtomicArg}: an opaque nominal
 * reference, or a transparent alias reference that is a sugar-declared sum
 * (its declaration record carries `_sumVariants`). */
export function isNominalAtomicType(t: Type): boolean {
  if (typeof t === 'string' || t.kind !== 'reference') return false;
  if (t.alias !== true) return true;
  return declarationOf(t)._sumVariants !== undefined;
}
