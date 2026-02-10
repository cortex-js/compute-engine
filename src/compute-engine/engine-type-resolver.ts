import type { TypeReference, TypeResolver } from '../common/type/types';

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
      const ref: TypeReference = {
        kind: 'reference',
        name,
        alias: false,
        def: undefined,
      };
      host.context.lexicalScope.types ??= {};
      host.context.lexicalScope.types[name] = ref;
      return ref;
    },
  };
}
