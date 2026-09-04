import type { Type } from './types.js';
import { typeToString } from './serialize.js';
import { TYPE_SIZE_LIMIT } from './size-cap.js';

/**
 * Interning of FLAT composite types, so that equal composite types built at
 * different times are one object.
 *
 * A composite type synthesized from a value — a tuple's type from its
 * components, a list literal's from its cells, a record's from its fields —
 * is built once per node. A list of 5,000 points therefore holds 5,000
 * distinct `tuple<real, real>` objects unless they are interned, and every
 * consumer that folds element types by identity (the `List` shape analysis
 * collects DISTINCT cell types before it widens them) has to widen 5,000
 * times what it could widen once. With interning, the cells are one object
 * and join by identity.
 *
 * Only a FLAT composite is interned: a `tuple`, `list`, `set`,
 * `collection`, `indexed_collection`, `dictionary` or `record` node whose
 * components are all primitive names or already-interned composites. Such a
 * type is closed (no `reference` to a scope's declaration, no type
 * variable), so one object can stand for it in every engine; it carries no
 * literal cargo (a value node or a range is not a primitive name), so it is
 * a fixed point of `widenValueTypes`; and its size is bounded here to the
 * same `TYPE_SIZE_LIMIT` that `boundTypeSize` enforces, so the storage
 * seam can skip both walks for an interned result. Anything else is
 * returned unchanged.
 *
 * Interned objects are shared, so they are frozen. A parsed type is
 * deep-frozen for the same reason (`parse.ts`), so no consumer may mutate a
 * type it did not build.
 *
 * The key is the type's spelling (`typeToString`). Two spellings of one
 * type (a union's members in another order) intern to two objects; that
 * costs a dedup hit, never correctness.
 */

const TABLE_MAX_SIZE = 4096;
const table = new Map<string, Type>();
const interned = new WeakSet<object>();
/** Node count of each interned composite, for the size bound. */
const sizes = new WeakMap<object, number>();

/** Is `t` an object this module handed out? */
export function isInternedType(t: Readonly<Type>): boolean {
  return typeof t === 'object' && interned.has(t);
}

/**
 * The interned object for `t` when `t` is a flat composite within the size
 * bound; `t` itself otherwise.
 */
export function internType(t: Type): Type {
  if (typeof t === 'string') return t;
  if (interned.has(t)) return t;

  const size = flatSize(t);
  if (size === undefined || size > TYPE_SIZE_LIMIT) return t;

  const key = typeToString(t);
  const hit = table.get(key);
  if (hit !== undefined) return hit;

  freezeNode(t);
  interned.add(t);
  sizes.set(t, size);
  if (table.size >= TABLE_MAX_SIZE) table.clear();
  table.set(key, t);
  return t;
}

/** The node count of a leaf-only component, or `undefined` for any other. */
function leafSize(x: Readonly<Type>): number | undefined {
  if (typeof x === 'string') return 1;
  return sizes.get(x);
}

/**
 * The node count of `t` when it is a flat composite (every component a
 * primitive name or an interned composite); `undefined` otherwise.
 */
function flatSize(t: Exclude<Type, string>): number | undefined {
  let total = 1;
  switch (t.kind) {
    case 'tuple': {
      for (const e of t.elements) {
        const s = leafSize(e.type);
        if (s === undefined) return undefined;
        total += s;
      }
      return total;
    }
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection': {
      const s = leafSize(t.elements);
      return s === undefined ? undefined : total + s;
    }
    case 'dictionary': {
      const s = leafSize(t.values);
      return s === undefined ? undefined : total + s;
    }
    case 'record': {
      for (const v of Object.values(t.elements)) {
        const s = leafSize(v);
        if (s === undefined) return undefined;
        total += s;
      }
      return total;
    }
    default:
      return undefined;
  }
}

/** Freeze the node and the containers it owns (the leaves are strings or
 * interned objects, frozen already). */
function freezeNode(t: Exclude<Type, string>): void {
  Object.freeze(t);
  if (t.kind === 'tuple') {
    for (const e of t.elements) Object.freeze(e);
    Object.freeze(t.elements);
  } else if (t.kind === 'list' && t.dimensions !== undefined) {
    Object.freeze(t.dimensions);
  } else if (t.kind === 'record') {
    Object.freeze(t.elements);
  }
}
