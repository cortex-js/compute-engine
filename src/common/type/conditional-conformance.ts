import type {
  CollectionType,
  DictionaryType,
  ListType,
  TupleType,
  Type,
  TypeParameter,
  TypeReference,
} from './types.js';
import {
  cannotHoldAList,
  isSubtype,
  listElementType,
  listShapeKey,
} from './subtype.js';
import {
  freeTypeVariables,
  isDecidedConstraintType,
  substituteTypeVariables,
} from './instantiate.js';
import { typeToDedupKey } from './serialize.js';

//
// CONDITIONAL CONFORMANCE — the type-layer half (protocols design phase 5,
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A "Conditional Conformance").
//
// A conditional conformance target is a HEAD PATTERN — an application of a
// type constructor to the variables its trailing `where` clause binds
// (`list<T> … where T is Comparable`). Deciding whether it applies to a
// receiver type is therefore two questions: does the receiver MATCH the head
// (same constructor, extract the arguments), and does every extracted argument
// satisfy the clause (bounds by subtyping, `is` entries through the caller's
// conformance oracle)?
//
// It lives in the type layer, not in `engine-protocols.ts`, because BOTH the
// engine's protocol machinery and its `TypeResolver.conformsTo` oracle
// (`engine-type-resolver.ts`) must answer identically — and the type layer may
// not import the engine.
//

/** The conformance oracle a conditional target's `is` entries are checked
 * against — `TypeResolver.conformsTo`, supplied by the engine (ruling P36). */
export type ConformanceOracle = (type: Type, protocol: string) => boolean;

/** Do any of `variables` occur free in `t`? */
function mentions(t: Type, variables: ReadonlySet<string>): boolean {
  for (const name of freeTypeVariables(t)) if (variables.has(name)) return true;
  return false;
}

/**
 * Match the head PATTERN `pattern` against the ground type `subject`,
 * accumulating one binding per clause variable.
 *
 * Structural, head by head: a clause variable binds whatever stands at its
 * position, a pattern part that mentions no clause variable is decided by
 * ordinary subtyping, and everything else must agree on its constructor.
 *
 * The receiver's SHAPE is ignored unless the pattern states one — `["a", "b"]`
 * synthesizes `list<string^2>`, and `list<T>` must match it (a dimensioned list
 * IS a list), with `T` bound to the receiver's elements, here `string`. A
 * pattern that states a shape (`matrix<T>`) must be fitted by the receiver's
 * shape (`subjectFitsTensorPattern`). This is deliberately looser than `reduce.ts`'s
 * `sameHeadArguments`, whose caller (the overlap predicate) compares two
 * DECLARED targets and must treat differing shapes as incomparable.
 */
function matchHead(
  pattern: Type,
  subject: Type,
  variables: ReadonlySet<string>,
  bindings: Record<string, Type>
): boolean {
  if (typeof pattern === 'object' && pattern.kind === 'variable') {
    // A variable no clause binds cannot be matched against anything: the head
    // was validated at declaration, so this is unreachable in practice.
    if (!variables.has(pattern.name)) return false;
    const previous = bindings[pattern.name];
    if (previous !== undefined)
      return typeToDedupKey(previous) === typeToDedupKey(subject);
    bindings[pattern.name] = subject;
    return true;
  }

  // A part of the pattern with no clause variable in it is ground: ordinary
  // subtyping is the answer, and it may not be handed an open type.
  if (!mentions(pattern, variables)) return isSubtype(subject, pattern);
  if (typeof pattern !== 'object') return false;

  // A structural ALIAS on the subject side IS its definition — the same LHS
  // unfold `isSubtype` performs. A NOMINAL reference keeps its own identity.
  if (
    typeof subject === 'object' &&
    subject.kind === 'reference' &&
    subject.alias === true &&
    subject.def !== undefined
  )
    return matchHead(pattern, subject.def, variables, bindings);

  if (typeof subject !== 'object' || subject.kind !== pattern.kind)
    return false;

  switch (pattern.kind) {
    case 'list': {
      const other = subject as ListType;
      // A plain list pattern `list<T>` matches a list of any shape, and `T`
      // binds to the ELEMENTS of the subject, what one index into it
      // returns (`listElementType`): the elements of a plain list, the
      // cells of a rank-1 tensor, the rows of a tensor of rank 2 or more
      // (`matrix<string^(2x1)>` binds `T = list<string^1>`), and
      // `U | tensor<U>` for a tensor of unknown rank. The `elements` field
      // of a dimensioned subject is its cell type, which is not the element
      // type at rank 2 or more. The generic solver binds `T` the same way
      // (`walkPattern` in `instantiate.ts`).
      if (pattern.dimensions === undefined)
        return matchHead(
          pattern.elements,
          listElementType(other),
          variables,
          bindings
        );
      // A tensor pattern (`vector<T>`, `matrix<T>`, `tensor<T>`) binds `T`
      // to the CELLS of a subject whose shape fits the pattern's.
      if (!subjectFitsTensorPattern(pattern, other)) return false;
      return matchHead(pattern.elements, other.elements, variables, bindings);
    }

    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return matchHead(
        pattern.elements,
        (subject as CollectionType).elements,
        variables,
        bindings
      );

    case 'dictionary':
      return matchHead(
        pattern.values,
        (subject as DictionaryType).values,
        variables,
        bindings
      );

    case 'reference': {
      const other = subject as TypeReference;
      if (pattern.name !== other.name) return false;
      const args = pattern.args;
      const otherArgs = other.args;
      if (
        args === undefined ||
        otherArgs === undefined ||
        args.length !== otherArgs.length
      )
        return false;
      return args.every((a, i) =>
        matchHead(a, otherArgs[i]!, variables, bindings)
      );
    }

    case 'tuple': {
      const elements = pattern.elements ?? [];
      const otherElements = (subject as TupleType).elements ?? [];
      if (elements.length !== otherElements.length) return false;
      return elements.every((e, i) => {
        const other = otherElements[i]!;
        // A field NAME is erasable in the subtype direction, so a named and an
        // unnamed element can describe the same value — but two DIFFERENT names
        // cannot. The same rule `subtype.ts`'s `couldMatch` applies, so a head
        // `tuple<a: T, b: T>` does not match `tuple<x: string, y: string>`.
        if (
          e.name !== undefined &&
          other.name !== undefined &&
          e.name !== other.name
        )
          return false;
        return matchHead(e.type, other.type, variables, bindings);
      });
    }

    default:
      return false;
  }
}

/**
 * Whether the shape of the list type `subject` fits the shape of the tensor
 * pattern `pattern` (a list pattern whose `dimensions` field is `null` or a
 * dimension list), so that the pattern's element position, its cell type,
 * can be matched against the cells of the subject (its `elements` field).
 *
 * - A tensor of unknown rank, `tensor<T>`, fits a tensor of any rank, and a
 *   plain list whose elements cannot be lists (`cannotHoldAList`), read at
 *   rank 1 with its elements as the cells (`list<E>` is a subtype of
 *   `tensor<U>` when `E` is a subtype of `U` and no value of `E` is a
 *   list). A `list<any>` or a `list<list<integer>>` does not fit.
 * - A pattern with a dimension variable on an axis fits a subject whose
 *   shape is spelled the same only (`listShapeKey`).
 * - Otherwise the subject must be a tensor of the same rank whose length on
 *   each axis is the pattern's length, or any length where the pattern has
 *   an open axis (`-1`): `matrix<T>` fits `matrix<integer^(2x2)>`. A plain
 *   list of numbers fits a rank-1 pattern with an open length (`list<E>`
 *   and `vector<E>` denote the same values when `E` is a subtype of
 *   `number`); a `list<string>` does not fit `vector<T>`, since a
 *   `list<string>` is not a vector. A tensor of unknown rank fits no
 *   pattern with a dimension list, because its rank is not known.
 *
 * These are the shape conditions of the subtype rules for lists in
 * `subtype.ts`. (Section 3.3 of
 * `docs/plans/2026-10-21-list-element-tensor-cell.md`.)
 */
function subjectFitsTensorPattern(
  pattern: Readonly<ListType>,
  subject: Readonly<ListType>
): boolean {
  const dims = pattern.dimensions;
  const subjectDims = subject.dimensions;
  if (dims === null)
    return subjectDims !== undefined || cannotHoldAList(subject.elements);
  if (dims === undefined) return false;
  if (pattern.dimensionVariables !== undefined)
    return listShapeKey(pattern) === listShapeKey(subject);
  if (subjectDims === null) return false;
  if (subjectDims === undefined)
    return (
      dims.length === 1 &&
      dims[0] === -1 &&
      isSubtype(subject.elements, 'number')
    );
  return (
    subjectDims.length === dims.length &&
    dims.every((d, i) => d === -1 || d === subjectDims[i])
  );
}

/**
 * Does the conditional target `head … where params` apply to a receiver of
 * type `subject`? Returns the INSTANTIATED head (the ground target the edge
 * stands for at this receiver), or `null` when it does not apply.
 *
 * The instantiation is what makes a conditional edge comparable with the other
 * edges for specificity: `list<T>` at a `list<string>` receiver competes as
 * `list<string>`.
 *
 * An argument whose solved type cannot decide a conformance question — a top or
 * compound type — is ADMITTED rather than refused, the same open-world posture
 * the solver's `where T is P` check takes (P32/P35): conformance is monotone,
 * and `never` conforms vacuously (P40, in the oracle).
 */
export function conditionalTargetInstance(
  head: Type,
  params: readonly TypeParameter[],
  subject: Type,
  conformsTo: ConformanceOracle
): Type | null {
  const variables = new Set(params.map((p) => p.name));
  const bindings: Record<string, Type> = Object.create(null);
  if (!matchHead(head, subject, variables, bindings)) return null;

  for (const p of params) {
    const solved = bindings[p.name];
    // A clause variable the head never mentions is a declaration-time error
    // (`unsolvable-type-variable`), so this cannot be reached from a registered
    // edge; refusing is the safe answer if it ever is.
    if (solved === undefined) return null;
    if (!isDecidedConstraintType(solved)) continue;
    if (p.bound !== undefined && !isSubtype(solved, p.bound)) return null;
    for (const protocol of p.protocols ?? [])
      if (!conformsTo(solved, protocol)) return null;
  }

  return substituteTypeVariables(head, bindings);
}

/**
 * The WIDEST instantiation of a conditional target: every clause variable read
 * as its declared bound (`unknown` when unbounded), matching the solver's
 * current S3 rule and `readTypeVariablesAsBounds`. Migrating the legacy
 * inference default is tracked separately from bare-family semantics.
 *
 * A ground stand-in for the whole family of instantiations, used wherever a
 * conditional edge has to be compared against another target with no receiver
 * in hand — the lattice-inheritance pass (an impl-less conditional edge may
 * inherit only from an edge that contains every instantiation of its head) and
 * the two-way applicability of the static advisory diagnostics.
 */
export function widestConditionalTarget(
  head: Type,
  params: readonly TypeParameter[]
): Type {
  const bindings: Record<string, Type> = Object.create(null);
  for (const p of params) bindings[p.name] = p.bound ?? 'unknown';
  return substituteTypeVariables(head, bindings);
}
