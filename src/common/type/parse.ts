import type {
  Type,
  TypeParameter,
  TypeResolver,
  TypeString,
} from './types.js';

import { isValidType } from './primitive.js';
import { Parser } from './parser.js';
import { buildTypeFromAST } from './type-builder.js';
import {
  TypeVariableError,
  freeTypeVariables,
  isReservedTypeName,
  validateDeclaredType,
} from './instantiate.js';

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

export function parseType(
  s: undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): undefined;
export function parseType(
  s: TypeString | Type,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): Type;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): Type | undefined;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): Type | undefined {
  if (s === undefined) return undefined;
  // Check if it's a primitive type or already a Type object
  if (isValidType(s)) return s;

  // Parse the type string
  if (typeof s !== 'string') return undefined;

  // A PRE-SEEDED parse is uncacheable: identical text means different things
  // under different seeds (`tuple<T, T>` with `T` seeded is an open type; with
  // nothing seeded it is an unknown-type error).
  const cacheable = typeResolver === undefined && typeVars === undefined;
  if (cacheable) {
    const cached = TYPE_CACHE.get(s);
    if (cached !== undefined) return cached;
  }

  try {
    const parser = new Parser(s, { typeResolver, typeVars });
    const ast = parser.parseType();
    const type = buildTypeFromAST(ast, typeResolver, typeVars);

    // Polytypes are validated where they are boxed (§7.2). Gated on the parse
    // having seen a `forall` clause: a variable can only be introduced by one,
    // so a type string without a clause pays nothing.
    if (parser.sawForall) validateDeclaredType(type);

    if (cacheable) {
      // Simple bound: reset the cache if it grows too large (the working set
      // of distinct type strings is small, so this should rarely trigger)
      if (TYPE_CACHE.size >= TYPE_CACHE_MAX_SIZE) TYPE_CACHE.clear();
      TYPE_CACHE.set(s, deepFreeze(type));
    }

    return type;
  } catch (error) {
    const wrapped = new Error(
      `Failed to parse type "${s}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    // Keep the structured code of a type-variable violation reachable on the
    // re-thrown error (the code is in the message either way).
    if (error instanceof TypeVariableError)
      (wrapped as Error & { code?: string }).code = error.code;
    throw wrapped;
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
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[]
): { type: Type; end: number } {
  const parser = new Parser(source, {
    typeResolver,
    allowTrailing: true,
    typeVars,
  });
  const ast = parser.parseTypePrefix();
  const type = buildTypeFromAST(ast, typeResolver, typeVars);
  if (parser.sawForall) validateDeclaredType(type);
  return { type, end: parser.endOffset };
}

//
// ── The shared type-parameter CLAUSE parser ──────────────────────────────────
//

/** A structured failure of {@link parseTypeParameterClause}: a machine code, a
 * human message, and the offset WITHIN the clause text where it was found.
 *
 * Structured rather than thrown because each consumer surfaces it differently:
 * the Cortex parser turns it into a ranged diagnostic, the `DeclareType`
 * operator into an error VALUE, the host `ce.declareType()` into a throw. */
export interface TypeParameterClauseError {
  code:
    | 'name-expected'
    | 'duplicate-name'
    | 'reserved-name'
    | 'bound-error'
    | 'separator-expected'
    | 'empty-clause';
  message: string;
  position: number;
}

/**
 * Parse the TEXT of a type-parameter clause — `"T"`, `"T, U: number"` — into
 * {@link TypeParameter}s.
 *
 * The one clause reader shared by every route that carries a clause as text:
 * the `typeParams` attrs entry of a `DeclareType` statement (A1), the host
 * `ce.declareType(…, { typeParams })` option (A2), and — indirectly — the
 * Cortex `type alias Pair<T> = …` statement, whose own character scanner adds
 * source ranges and hands the text on. The input is the clause CONTENTS: the
 * enclosing `<`/`>` are not part of it.
 *
 * The whole text must be consumed (a trailing `,` or a stray `>` is an error).
 * Names are checked for duplicates and against {@link isReservedTypeName}.
 * Bounds are parsed as ordinary — GROUND — types with the clause's own names
 * NOT in scope, so an F-bounded `T: list<U>` is an unknown-type error.
 */
export function parseTypeParameterClause(
  text: string,
  typeResolver?: TypeResolver
): { params: TypeParameter[] } | { error: TypeParameterClauseError } {
  const err = (
    code: TypeParameterClauseError['code'],
    message: string,
    position: number
  ): { error: TypeParameterClauseError } => ({
    error: { code, message, position },
  });

  let pos = 0;
  const skipSpace = (): void => {
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  };

  skipSpace();
  if (pos >= text.length)
    return err('empty-clause', 'Expected at least one type parameter', pos);

  const params: TypeParameter[] = [];
  const seen = new Set<string>();
  for (;;) {
    skipSpace();
    const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(pos));
    if (m === null)
      return err('name-expected', 'Expected a type parameter name', pos);
    const name = m[0];
    const namePos = pos;
    pos += name.length;

    if (isReservedTypeName(name))
      return err(
        'reserved-name',
        `The type name "${name}" is reserved`,
        namePos
      );
    // `Set` is prototype-free-safe: a parameter legally named `__proto__` or
    // `toString` is an ordinary member here.
    if (seen.has(name))
      return err(
        'duplicate-name',
        `The type variable \`${name}\` is declared more than once`,
        namePos
      );
    seen.add(name);

    skipSpace();
    let bound: Type | undefined;
    if (text[pos] === ':') {
      pos += 1;
      const boundPos = pos;
      try {
        const { type, end } = parseTypePrefix(text.slice(pos), typeResolver);
        bound = type;
        pos += end;
      } catch (e) {
        const detail = e as { position?: number; rawMessage?: string };
        return err(
          'bound-error',
          detail.rawMessage ?? (e instanceof Error ? e.message : String(e)),
          boundPos + (detail.position ?? 0)
        );
      }
      // v1: a bound is GROUND. Unreachable through the type parser (the
      // clause's names are not seeded), but a `forall`-carrying bound is not.
      if (freeTypeVariables(bound).size > 0)
        return err(
          'bound-error',
          `The bound of the type variable \`${name}\` must be a ground type`,
          boundPos
        );
    }

    params.push(bound === undefined ? { name } : { name, bound });

    skipSpace();
    if (pos >= text.length) break;
    if (text[pos] !== ',')
      return err(
        'separator-expected',
        'Expected `,` between type parameters',
        pos
      );
    pos += 1;
    skipSpace();
    if (pos >= text.length)
      return err('name-expected', 'Expected a type parameter name', pos);
  }

  return { params };
}
