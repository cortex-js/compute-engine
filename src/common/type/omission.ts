import { reduceType } from './reduce.js';
import { resolveTypeAlias } from './utils.js';
import type { Type } from './types.js';

/** Remove a whole-value omission, without changing nested data or inference. */
export function withoutNothing(
  type: Type,
  seen: ReadonlySet<Type> = new Set()
): Type {
  const t = resolveTypeAlias(type);
  if (seen.has(t)) return type;
  if (t === 'unknown' || (typeof t === 'object' && t.kind === 'variable'))
    return t;
  if (typeof t === 'object' && t.kind === 'union') {
    const next = new Set(seen).add(t);
    return reduceType({
      kind: 'union',
      types: t.types.map((arm) => withoutNothing(arm, next)),
    });
  }
  return reduceType({
    kind: 'intersection',
    types: [t, { kind: 'negation', type: 'nothing' }],
  });
}

/** Transform only immediate elements, preserving tuple slots and source lengths. */
export function mapImmediateElements(
  type: Type,
  transform: (element: Type) => Type,
  seen: ReadonlySet<Type> = new Set()
): Type {
  const t = resolveTypeAlias(type);
  if (seen.has(t)) return type;
  if (typeof t === 'string') {
    if (
      t === 'list' ||
      t === 'set' ||
      t === 'collection' ||
      t === 'indexed_collection'
    )
      return { kind: t, elements: transform('unknown') };
    return t;
  }
  switch (t.kind) {
    case 'union': {
      const next = new Set(seen).add(t);
      return reduceType({
        kind: 'union',
        types: t.types.map((arm) => mapImmediateElements(arm, transform, next)),
      });
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
      return { ...t, elements: transform(t.elements) };
    case 'tuple':
      return {
        ...t,
        elements: t.elements.map((e) => ({ ...e, type: transform(e.type) })),
      };
    default:
      return t;
  }
}

export function withNothing(type: Type): Type {
  return reduceType({ kind: 'union', types: [type, 'nothing'] });
}
