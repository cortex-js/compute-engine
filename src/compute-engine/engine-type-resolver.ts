import type { TypeReference, TypeResolver } from '../common/type/types.js';

type ResolverScope = {
  parent: ResolverScope | null;
  types?: Record<string, TypeReference>;
};

export type TypeResolverHost = {
  context: {
    lexicalScope: ResolverScope;
  };
};

function collectTypeNames(scope: ResolverScope): string[] {
  const result: string[] = [];
  let current: ResolverScope | null = scope;
  while (current) {
    if (current.types) result.push(...Object.keys(current.types));
    current = current.parent;
  }
  return result;
}

function resolveTypeReference(
  scope: ResolverScope,
  name: string
): TypeReference | undefined {
  let current: ResolverScope | null = scope;
  while (current) {
    if (current.types?.[name]) return current.types[name];
    current = current.parent;
  }
  return undefined;
}

export function createTypeResolver(host: TypeResolverHost): TypeResolver {
  return {
    get names() {
      return collectTypeNames(host.context.lexicalScope);
    },

    resolve(name: string) {
      return resolveTypeReference(host.context.lexicalScope, name);
    },

    forward(name: string) {
      const scope = host.context.lexicalScope;
      scope.types ??= {};
      // A forward reference is a PROMISE to declare, so it may only ever fill
      // an empty slot. Both call sites reach here only after `resolve()` came
      // back empty, so a defined record in this scope is unreachable today —
      // but overwriting one would silently drop a working declaration (and
      // every capture of it), which is far worse than handing the existing
      // record back. Answering with it is exactly what `resolve()` would have
      // done.
      const existing = scope.types[name];
      if (existing?.def !== undefined) return existing;
      const ref: TypeReference = {
        kind: 'reference',
        name,
        alias: false,
        def: undefined,
      };
      scope.types[name] = ref;
      return ref;
    },
  };
}
