import type { TypeReference, TypeResolver } from '../common/type/types.js';

/** The resolver's window onto its engine: the engine-level type registry.
 *
 * Types are NOT lexically scoped — one namespace per engine, world state
 * (`docs/plans/2026-08-10-global-type-registry.md`). The `TypeResolver`
 * interface is the seam: consumers are unaware of the backing store.
 */
export type TypeResolverHost = {
  _typeRegistry: Record<string, TypeReference>;
};

export function createTypeResolver(host: TypeResolverHost): TypeResolver {
  return {
    get names() {
      return Object.keys(host._typeRegistry);
    },

    resolve(name: string) {
      return host._typeRegistry[name];
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
  };
}
