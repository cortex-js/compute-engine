import type { Type, TypeReference } from './types.js';

/**
 * Applied references to a parameterized NOMINAL type — the one node shape
 * `docs/plans/2026-08-06-parameterized-nominal-types-design.md` §3 adds.
 *
 * An application (`tree<integer>`) is a DISTINCT object from the declaration
 * record held in the scope (one record, many applications), but its `def` must
 * still track that record: the placeholder is installed BEFORE the body parses,
 * so a recursive `tree<T>` inside `tree`'s own definition is built while `def`
 * is still `undefined`. A snapshot would freeze that. `def` is therefore an
 * accessor delegating to the record, and every rebuild goes through
 * {@link withTypeArguments} so the delegation survives.
 *
 * The record itself is reachable through a NON-ENUMERABLE `decl` back-pointer
 * (read with {@link declarationOf}): the consumers that need the declared
 * parameters — the variance-aware subtype rule, field access at an
 * instantiated body — run below the resolver and cannot look the name up.
 * Non-enumerable is load-bearing: `subtype.ts`'s de-dup key drops `def` BY
 * NAME before `JSON.stringify`, so an enumerable back edge under any other
 * name would re-introduce the circular-structure throw. For the same reason
 * the record's `typeParams` are NOT copied onto the application — an
 * enumerable `typeParams` would make an application read as a DECLARATION
 * everywhere the two are told apart.
 */
export function applyTypeReference(
  record: TypeReference,
  args: Type[]
): TypeReference {
  const applied = {
    kind: 'reference',
    name: record.name,
    alias: record.alias,
    args,
  } as TypeReference;
  Object.defineProperty(applied, 'def', {
    get: () => record.def,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(applied, 'decl', {
    value: record,
    enumerable: false,
    configurable: true,
  });
  return applied;
}

/** The DECLARATION record behind a reference: the back-pointer for an applied
 * one, the reference itself for a declaration record or an unparameterized
 * use. Total — a caller never has to case-split on which it holds. */
export function declarationOf(ref: TypeReference): TypeReference {
  return (ref as { decl?: TypeReference }).decl ?? ref;
}

/**
 * `ref` with a new argument list — the rebuild every structural walker
 * (substitution, ground skeleton) needs.
 *
 * Copies property DESCRIPTORS, not values, so the `def` accessor installed by
 * {@link applyTypeReference} keeps pointing at the declaration record.
 */
export function withTypeArguments(
  ref: TypeReference,
  args: Type[]
): TypeReference {
  if (args === ref.args) return ref;
  const descriptors = Object.getOwnPropertyDescriptors(ref);
  descriptors.args = {
    value: args,
    writable: true,
    enumerable: true,
    configurable: true,
  };
  return Object.create(
    Object.getPrototypeOf(ref),
    descriptors
  ) as TypeReference;
}

/**
 * The argument counts of every use of a not-yet-declared (forward) reference —
 * `0` for a bare `type forest`, `n` for an applied `type forest<T, U>`.
 *
 * A forward reference is created by USE, so its arity is known only from the
 * uses; the declaration that fulfills it is checked against all of them
 * (design §4.2, replacing the earlier "a forward reference cannot be declared
 * generic" restriction). Stored NON-ENUMERABLY: the placeholder record is
 * itself a `Type` node captured by the bodies that mention it, and this is
 * bookkeeping, not structure — it must not reach a serialization or a
 * de-duplication key.
 */
const FORWARD_ARITY = '_forwardArity';

export function recordForwardArity(record: TypeReference, count: number): void {
  const holder = record as { _forwardArity?: Set<number> };
  if (holder._forwardArity === undefined)
    Object.defineProperty(record, FORWARD_ARITY, {
      value: new Set<number>(),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  holder._forwardArity!.add(count);
}

export function forwardArities(
  record: TypeReference
): ReadonlySet<number> | undefined {
  return (record as { _forwardArity?: Set<number> })._forwardArity;
}
