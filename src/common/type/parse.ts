import type { Type, TypeResolver, TypeString } from './types.js';

import { isValidType } from './primitive.js';
import { Parser } from './parser.js';
import { buildTypeFromAST } from './type-builder.js';

// Note: the authoritative BNF grammar for the type syntax lives with the
// parser implementation in `./parser.ts`.

/**
 * Memoization cache for resolver-less `parseType()` calls.
 *
 * `parseType()` is called with identical literal strings in per-evaluation
 * hot paths (e.g. `parseType('indexed_collection<integer>')` in collection
 * handlers, template-string types in operator definitions, and `isSubtype()`
 * parsing string operands on every call), so caching by the source string is
 * highly effective.
 *
 * Cached `Type` objects are deep-frozen: they are shared across all callers,
 * so they must be immutable. Calls with a `typeResolver` are not cached —
 * type references resolve differently per scope.
 */
const TYPE_CACHE = new Map<TypeString, Type>();
const TYPE_CACHE_MAX_SIZE = 2048;

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj)) deepFreeze(value);
  return obj;
}

export function parseType(s: undefined, typeResolver?: TypeResolver): undefined;
export function parseType(
  s: TypeString | Type,
  typeResolver?: TypeResolver
): Type;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver
): Type | undefined;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver
): Type | undefined {
  if (s === undefined) return undefined;
  // Check if it's a primitive type or already a Type object
  if (isValidType(s)) return s;

  // Parse the type string
  if (typeof s !== 'string') return undefined;

  const cacheable = typeResolver === undefined;
  if (cacheable) {
    const cached = TYPE_CACHE.get(s);
    if (cached !== undefined) return cached;
  }

  try {
    const parser = new Parser(s, { typeResolver });
    const ast = parser.parseType();
    const type = buildTypeFromAST(ast, typeResolver);

    if (cacheable) {
      // Simple bound: reset the cache if it grows too large (the working set
      // of distinct type strings is small, so this should rarely trigger)
      if (TYPE_CACHE.size >= TYPE_CACHE_MAX_SIZE) TYPE_CACHE.clear();
      TYPE_CACHE.set(s, deepFreeze(type));
    }

    return type;
  } catch (error) {
    throw new Error(
      `Failed to parse type "${s}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Parse a type from the *start* of `source`, returning the parsed {@link Type}
 * and the offset in `source` just past the consumed type (the delimiter or
 * whitespace that ended the type is *not* consumed).
 *
 * Unlike {@link parseType}, this does **not** require the whole string to be a
 * type: `source` may be followed by arbitrary trailing content (e.g.
 * `"real = 5"`, `"list<integer>, y"`). This is the entry point used by the
 * Cortex parser for type annotations (`x: real = 5`), where the type occupies
 * a prefix of the remaining source.
 *
 * The parser's `input`-scanning "did you mean `list<…>`" heuristics are scoped
 * to the consumed range, so trailing (non-type) source never leaks into a type
 * error or suggestion.
 *
 * On an invalid type this throws (as {@link parseType} does). The thrown
 * `Error` additionally carries a `position` property (the offset within
 * `source` of the offending token) and a `rawMessage` property (the bare error
 * message), so callers can offset-shift the diagnostic.
 *
 * This path deliberately does **not** touch the `parseType` `TYPE_CACHE`.
 */
export function parseTypePrefix(
  source: string,
  typeResolver?: TypeResolver
): { type: Type; end: number } {
  const parser = new Parser(source, { typeResolver, allowTrailing: true });
  const ast = parser.parseTypePrefix();
  const type = buildTypeFromAST(ast, typeResolver);
  return { type, end: parser.endOffset };
}
