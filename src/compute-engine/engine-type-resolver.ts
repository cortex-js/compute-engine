import type {
  Type,
  TypeParameter,
  TypeReference,
  TypeResolver,
} from '../common/type/types.js';
import { isSubtype } from '../common/type/subtype.js';
import { TypeVariableError } from '../common/type/instantiate.js';
import { conditionalTargetInstance } from '../common/type/conditional-conformance.js';
import { typeToDedupKey } from '../common/type/serialize.js';

/** The resolver's window onto its engine: the engine-level type registry, and
 * the protocol registry the conformance oracle reads.
 *
 * Types are NOT lexically scoped — one namespace per engine, world state
 * (`docs/TYPE-SYSTEM.md`). The `TypeResolver`
 * interface is the seam: consumers are unaware of the backing store.
 *
 * The protocol registry is described STRUCTURALLY (only the conformance
 * targets are read) so this module needs no engine type import: the real
 * `Record<string, ProtocolRecord>` satisfies it.
 */
export type TypeResolverHost = {
  _typeRegistry: Record<string, TypeReference>;
  _protocolRegistry?: Record<
    string,
    {
      conformances: ReadonlyArray<{ target: Type; where?: TypeParameter[] }>;
    }
  >;
};

export function createTypeResolver(host: TypeResolverHost): TypeResolver {
  /** The (type, protocol) questions currently being answered.
   *
   * A CONDITIONAL conformance makes `conformsTo` RECURSIVE — deciding
   * `list<list<string>> is Comparable` through
   * `type list<T> is Comparable where T is Comparable` asks
   * `list<string> is Comparable`, which asks `string is Comparable`. That
   * recursion terminates on its own (the receiver shrinks at every step), but a
   * self-referential conformance reached through a RECURSIVE type would not, so
   * re-entry on the same question answers `false` — "not proven", the safe
   * direction for a predicate that grants conformance.
   *
   * Per RESOLVER, hence per engine: registries are engine state, never module
   * globals (P36). */
  const inFlight = new Set<string>();

  /**
   * The conformance oracle behind the `where T is Comparable` slot (P19).
   *
   * INHERITANCE is subtyping, exactly as dispatch admission and
   * `refreshInheritedPending` decide it: an edge registered for `number`
   * answers for `integer`. A PENDING edge still counts — a conformance
   * awaiting its implementation is declared conformance (P3 makes the hole
   * an end-of-batch warning, not a type error), and the call it enables
   * fails at run time with `protocol-implementation-missing` if it is never
   * filled.
   *
   * BOTTOM conforms VACUOUSLY (P40). `never` is a subtype of every
   * conformance target, so reading it through the edge scan below made the
   * verdict depend on whether the protocol happens to carry ANY conformance
   * — an order-dependent answer for a variable Rule U grounds at `never`
   * (`opt<T> = T | missing` applied to `missing`). Answering `true`
   * unconditionally is the same vacuity subtyping already grants the bottom
   * type, and it is deterministic.
   *
   * A standalone function, not a method: every consumer reads it off the
   * resolver UNBOUND (`const conformsTo = resolver?.conformsTo`), so `this` is
   * not available for the recursive call a conditional edge needs.
   */
  const conformsTo = (type: Type, protocol: string): boolean => {
    if (type === 'never') return true;
    const record = host._protocolRegistry?.[protocol];
    if (record === undefined) return false;
    // A CONDITIONAL edge (phase 5) applies to exactly those instantiations
    // whose arguments satisfy its clause, which is itself a conformance
    // question — hence the recursion, and the guard around it.
    const key = `${typeToDedupKey(type)} ${protocol}`;
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    try {
      return record.conformances.some((edge) =>
        edge.where === undefined
          ? isSubtype(type, edge.target)
          : conditionalTargetInstance(
              edge.target,
              edge.where,
              type,
              conformsTo
            ) !== null
      );
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    get names() {
      return Object.keys(host._typeRegistry);
    },

    resolve(name: string) {
      const type = host._typeRegistry[name];
      if (type !== undefined) return type;
      // A PROTOCOL in type position. Protocol names are deliberately NOT in the
      // type registry (P8: protocols and types share no names, and a protocol
      // is not a type), so the name misses — and the type layer, which has no
      // registry of its own, could only report a generic "unknown type". The
      // engine's resolver is the one place that can see the protocol registry,
      // so the diagnosis is made here, on the resolve-failure path.
      //
      // A `TypeVariableError` rather than a bare `Error`: `parseType()` wraps a
      // throw, and only that class's `code` survives the wrap (it is also the
      // head of the message), which is what lets a call site turn this into an
      // error VALUE carrying `protocol-in-type-position`.
      if (host._protocolRegistry?.[name] !== undefined)
        throw new TypeVariableError(
          'protocol-in-type-position',
          `\`${name}\` is a protocol, not a type. Use a constrained variable: \`(x: T) -> boolean where T is ${name}\``
        );
      return undefined;
    },

    forward(name: string) {
      // A forward reference is a PROMISE to declare, so it may only ever fill
      // an empty slot. Both call sites reach here only after `resolve()` came
      // back empty, so an existing record — defined or a still-unfulfilled
      // promise — is unreachable today; but overwriting one would silently
      // drop every capture of it, which is far worse than handing it back.
      // Answering with it is exactly what `resolve()` would have done.
      const existing = host._typeRegistry[name];
      if (existing !== undefined) return existing;
      const ref: TypeReference = {
        kind: 'reference',
        name,
        alias: false,
        def: undefined,
      };
      host._typeRegistry[name] = ref;
      return ref;
    },

    conformsTo,
  };
}
