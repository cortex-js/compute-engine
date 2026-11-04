// The absent value in compiled code: how a producer spells it (`NaN`, a
// point of `NaN` coordinates, or the target's object null) and which axis of
// the target's absence capability a discharge (`IsMissing`, `Coalesce`,
// `AssertPresent`) reads.

import type { Expression } from '../global-types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  leafwardElementType,
  pointArity,
  unmatchedCellKind,
} from '../collection-utils.js';
import {
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
} from '../../common/type/utils.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import type { CompileTarget, TargetSource } from './types.js';

/**
 * Pick the target's absence axis (§3.F) for a position of type `t` by its
 * DOMAIN (I6): a position whose type is not provably outside the numbers
 * uses `absence.numeric` — that is a numeric type, `never` (a bare
 * `missing` numeric absence is `NaN`), an unknown type, and a union that
 * mixes numbers with objects; a position provably outside the numbers (a
 * string, a list) uses `absence.object`. The predicate is
 * `absentDomainIsObject`, the same one the selection lowerings use to
 * PRODUCE an absent value (`absenceKind`). On the JavaScript and Python
 * targets both axes read the object null AND the numeric marker as absent:
 * a discharge reads an absent operand whatever its spelling (R3 of
 * `docs/plans/2026-11-01-absent-value-contract.md`), and an object-domain
 * position can hold the numeric marker at run time, from a producer that
 * picks its marker from a wider type (`_SYS.atWithValueMarker` returns a
 * `NaN` element as it is) or, on Python, from a written `Missing`, which is
 * `math.nan` there. A point position (`pointArity()`) uses
 * `absence.point` when the target has it, which reads a `NaN` point as
 * absent too. Throws
 * (fail closed) when the target declares no absence capability at all, or
 * lacks the required object axis.
 */
export function absenceAxisForType(
  t: Readonly<Type>,
  target: CompileTarget<Expression>,
  opName: string
): {
  isAbsent?: (x: TargetSource) => TargetSource;
  coalesce?: (x: TargetSource, d: TargetSource) => TargetSource;
} {
  if (target.absence === undefined)
    throw new Error(
      `Could not compile \`${opName}\`: target '${target.language ?? 'unknown'}' has no absence ` +
        `capability.`
    );
  // A point position (a tuple of `n` numbers) also reads a `NaN` point as
  // absent, with the target's point axis, chosen here from the static type.
  const point = target.absence.point;
  const n = point === undefined ? undefined : pointArity(t);
  if (point !== undefined && n !== undefined)
    return {
      isAbsent: (x) => point.isAbsent(x, n),
      coalesce: (x, d) => point.coalesce(x, d, n),
    };
  if (!absentDomainIsObject(t)) return target.absence.numeric;
  // A target whose absence spellings cover its whole value model
  // (`coversValueModel`) discharges a list or a verdict position on the
  // numeric axis too: its `isAbsent`/`coalesce` read every domain of the
  // model. The same predicate the gate applies, so a position that
  // compiles can also be discharged.
  if (
    target.absence.numeric.coversValueModel === true &&
    isNumericOrVerdictShaped(
      resolveTypeForCompilation(
        stripMissingFromType(resolveTypeForCompilation(t))
      )
    )
  )
    return target.absence.numeric;
  if (target.absence.object === undefined)
    throw new Error(
      `Could not compile \`${opName}\`: an object-domain absent position has no representation on ` +
        `target '${target.language ?? 'unknown'}'. Discharge with 'Coalesce' ` +
        `first.`
    );
  return target.absence.object;
}

/**
 * The value a compiled `If`/`Which` answers when it takes no branch, for
 * example when no clause of a `Which` matched.
 *
 * A numeric result is `NaN`, which is how every target that produces real
 * numbers represents a missing one (`docs/ERROR-MODEL.md` describes the
 * absence markers). A result that is PROVABLY not a number — a string, a
 * list — has no NaN, so the value is the target's literal for a missing
 * object, `undefined` in JavaScript. A result whose type is unknown keeps
 * `NaN`: it is a number until proven otherwise, and the object null would
 * turn every arithmetic consumer of the value into a `TypeError` instead
 * of a propagated NaN. See `absenceKind`, which the restriction and
 * the Python target's selection handlers share, so every selection form
 * answers absence the same way on a target. A target that declares no
 * object literal uses `NaN` for both.
 */
export function noBranchValue(
  node: Expression | undefined,
  target: CompileTarget<Expression>,
  complexArms: boolean
): TargetSource {
  if (complexArms) return '({ re: NaN, im: NaN })';
  const nullLiteral = target.absence?.object?.nullLiteral;
  if (
    nullLiteral !== undefined &&
    node !== undefined &&
    absenceKind([node.type.type], target) === 'object'
  )
    return nullLiteral;
  return 'NaN';
}

/**
 * Which absence representation a selection with the given result types
 * emits on `target` where no arm is selected: `'object'` — the target's
 * object null literal — only when the target declares one AND every type,
 * its own absence marker stripped, is provably disjoint from `number`;
 * `'numeric'` — the target's NaN — otherwise. An unknown type is numeric
 * here (see `noBranchValue`), and so is a mix of numeric and object arms,
 * whose consumers are arithmetic more often than not.
 *
 * Shared by the JavaScript lowering (`noBranchValue`) and the Python
 * target's `If`/`Which` handlers, so the two targets answer
 * absence by the same rule with their own spelling.
 */
export function absenceKind(
  types: ReadonlyArray<Type>,
  target: CompileTarget<Expression>
): 'numeric' | 'object' {
  if (target.absence?.object?.nullLiteral === undefined) return 'numeric';
  if (types.length === 0) return 'numeric';
  return types.every((type) => absentDomainIsObject(type))
    ? 'object'
    : 'numeric';
}

/**
 * Is `t` a number, a boolean, or an indexed collection (a list, a vector,
 * a tuple) of such values at any depth — a union of these included? The
 * value model of a target with no object domain (the interval target: an
 * enclosure, a verdict, an array of either).
 */
export function isNumericOrVerdictShaped(t: Readonly<Type>): boolean {
  const r = resolveTypeForCompilation(t);
  if (isSubtype(r, 'number') || isSubtype(r, 'boolean')) return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'union')
    return r.types.every((arm) => isNumericOrVerdictShaped(arm));
  // `broadcastable<T>` is `T | list<T>`: in the model when `T` is.
  if (r.kind === 'broadcastable') return isNumericShaped(r.elements);
  if (r.kind === 'tuple')
    return r.elements.every((el) => isNumericShaped(el.type));
  if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const element = leafwardElementType(r);
  return element !== undefined && isNumericShaped(element);
}

/** The collection half of `isNumericOrVerdictShaped`: a number, or an
 * indexed collection of numbers at any depth. A verdict is a value of the
 * model only as a SCALAR — the collection consumers of the interval target
 * read an element as a number, an enclosure or a kinded result, and a
 * verdict element would read as `entire`, a wrong value behind
 * `success: true`. */
export function isNumericShaped(t: Readonly<Type>): boolean {
  const r = resolveTypeForCompilation(t);
  if (isSubtype(r, 'number')) return true;
  if (typeof r === 'string') return false;
  if (r.kind === 'union') return r.types.every((arm) => isNumericShaped(arm));
  if (r.kind === 'broadcastable') return isNumericShaped(r.elements);
  if (r.kind === 'tuple')
    return r.elements.every((el) => isNumericShaped(el.type));
  if (!isSubtype(r, INDEXED_COLLECTION_SHAPE_TYPE)) return false;
  // Toward the cells (`leafwardElementType`), as in `typeHasComplexLeaf`.
  const element = leafwardElementType(r);
  return element !== undefined && isNumericShaped(element);
}

/**
 * The JavaScript literal of a point whose coordinates are all `NaN`
 * (`[NaN, NaN]`), when every type of `cellTypes` is a point (a tuple of
 * numbers, or a union of such tuples, as `pointArity()` reads it) of one
 * length; `undefined` otherwise. An element-wise selection
 * or a restriction by a list of conditions puts this point at a position
 * that is not selected, where a point is expected, as the interpreter does
 * (`unmatchedCell()` in `library/control-structures.ts`; selection rule of
 * 2026-11-02, `docs/BROADCAST-MODEL.md`). The literal is evaluated once for
 * each call of the run-time helper, and its positions share it; no compiled
 * code writes into an element of a list of points.
 */
export function nanPointLiteral(
  cellTypes: ReadonlyArray<Readonly<Type>>
): string | undefined {
  let n: number | undefined;
  for (const t of cellTypes) {
    // A point is a tuple of numbers, or a union of such tuples of one
    // length (`tuple<nan, nan, integer> | tuple<real, real, real>`), as the
    // interpreter reads it.
    const arity = pointArity(t);
    if (arity === undefined) return undefined;
    if (n !== undefined && n !== arity) return undefined;
    n = arity;
  }
  if (n === undefined) return undefined;
  return `[${Array.from({ length: n }, () => 'NaN').join(', ')}]`;
}

/**
 * The JavaScript literal of the value at a position that an element-wise
 * selection or a restriction by a list of conditions does not select, when
 * every type of `cellTypes` is a boolean (`false`: a relation arm, a
 * region of a plot, is not drawn there) or every type is a colour (the
 * non-finite colour, whose channels are `NaN`: the same object as
 * `nonFiniteColor()` in `javascript-runtime.ts` and the colour branch of the
 * `realGuard` of the JavaScript target, with the five keys in the same order;
 * the interpreter's cell is `Rgb(NaN, NaN, NaN)`, and a plotter reads either
 * as "no colour here"); `undefined` otherwise. The interpreter gives the same cells
 * (`unmatchedCell()` in `library/control-structures.ts`; both read
 * `unmatchedCellKind()`), user decision 2026-11-02, two-valued
 * comparisons.
 */
export function unmatchedCellLiteral(
  cellTypes: ReadonlyArray<Readonly<Type>>
): string | undefined {
  if (cellTypes.length === 0) return undefined;
  const kinds = cellTypes.map((t) => unmatchedCellKind(t));
  if (kinds.every((k) => k === 'boolean')) return 'false';
  if (kinds.every((k) => k === 'color'))
    return "({ space: 'oklch', c0: NaN, c1: NaN, c2: NaN, alpha: undefined })";
  return undefined;
}

/**
 * Whether an absent value of type `t` lives on the OBJECT axis: the type,
 * its own `missing` marker stripped and any declared alias unfolded, is
 * provably disjoint from `number`. `never`, an unknown type and `any` are
 * NOT object-domain — they are numbers until proven otherwise — and neither
 * is a union that mixes numbers with objects. The one predicate behind both
 * the production of an absent value (`absenceKind`, `noBranchValue`) and
 * its discharge (`absenceAxisForType`).
 *
 * The alias is unfolded BEFORE the strip: `stripMissingFromType` is
 * structural and does not see through a `reference`, so an alias such as
 * `type alias maybe_n = number | missing` would survive the strip intact
 * and be read as an object domain. It is resolved again afterwards, in case
 * removing the `missing` arm collapsed the union down to a single
 * reference arm.
 */
export function absentDomainIsObject(t: Readonly<Type>): boolean {
  const stripped = resolveTypeForCompilation(
    stripMissingFromType(resolveTypeForCompilation(t))
  );
  return (
    stripped !== 'never' &&
    stripped !== 'unknown' &&
    stripped !== 'any' &&
    provablyDisjoint(stripped, 'number')
  );
}
