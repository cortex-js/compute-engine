import type { Type, TypeResolver } from './types';
import { reduceType } from './reduce';
import { typeToString } from './serialize';

function error(type: Type, ...message: string[]): never {
  throw new Error(
    `\nType error "${typeToString(type)}"\n|   ${message.join('\n|   ')}`
  );
}

function resolve(type: Readonly<Type>, resolver: TypeResolver): Type {
  // Primitive type
  if (typeof type === 'string') return type;

  if (type.kind === 'reference') {
    const resolved = resolver.resolve(type.name);
    if (resolved === undefined)
      error(type, `Type reference ${type.name} not found`);

    return resolved;
  }

  if (type.kind === 'collection' || type.kind === 'indexed_collection')
    return { ...type, elements: resolve(type.elements, resolver) };

  if (type.kind === 'list') {
    return {
      ...type,
      elements: resolve(type.elements, resolver),
      dimensions: type.dimensions,
    };
  }

  if (type.kind === 'set')
    return { ...type, elements: resolve(type.elements, resolver) };

  if (type.kind === 'record') {
    const elements: Record<string, Type> = {};
    for (const key in type.elements)
      elements[key] = resolve(type.elements[key], resolver);

    return { kind: 'record', elements };
  }

  if (type.kind === 'dictionary') {
    return {
      kind: 'dictionary',
      values: resolve(type.values, resolver),
    };
  }

  if (type.kind === 'tuple') {
    const elements = type.elements.map((element) => ({
      ...element,
      type: resolve(element.type, resolver),
    }));

    return { ...type, elements };
  }

  if (type.kind === 'signature') {
    const args = type.args?.map((param) => ({
      ...param,
      type: resolve(param.type, resolver),
    }));
    const optArgs = type.optArgs?.map((param) => ({
      ...param,
      type: resolve(param.type, resolver),
    }));
    const varArg = type.variadicArg
      ? { ...type.variadicArg, type: resolve(type.variadicArg.type, resolver) }
      : undefined;

    const result = resolve(type.result, resolver);

    return { ...type, args, optArgs, variadicArg: varArg, result };
  }

  return type;
}

export function resolveType(type: Type, resolver?: TypeResolver): Type {
  if (!resolver) return type;
  return reduceType(resolve(type, resolver));
}
