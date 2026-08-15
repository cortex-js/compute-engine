import type {
  Type,
  TypeParameter,
  TypeResolver,
  TypeString,
  TypeVariance,
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

/**
 * Options accepted by the type-string entry points.
 *
 * `allowObjectType` admits the `object<name: T, …>` layout form, which is
 * legal ONLY as the definition of a named type (`type Person = object<…>`).
 * The routes that declare a type set it; every other route leaves it off and
 * the parse refuses the form with an `object-type-not-inline` error. The bare
 * `object` primitive is unaffected either way. See
 * `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an object type".
 */
export interface ParseTypeOptions {
  allowObjectType?: boolean;
}

export function parseType(
  s: undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[],
  options?: ParseTypeOptions
): undefined;
export function parseType(
  s: TypeString | Type,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[],
  options?: ParseTypeOptions
): Type;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[],
  options?: ParseTypeOptions
): Type | undefined;
export function parseType(
  s: TypeString | Type | undefined,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[],
  options?: ParseTypeOptions
): Type | undefined {
  if (s === undefined) return undefined;
  // Check if it's a primitive type or already a Type object
  if (isValidType(s)) return s;

  // Parse the type string
  if (typeof s !== 'string') return undefined;

  // A parse that admits the `object<…>` layout is a DECLARATION body, never a
  // hot path, and it reads the same text differently from every other route —
  // so it neither consults nor fills the string-keyed cache, and it skips the
  // resolver-less first attempt (which would refuse the form and throw).
  if (options?.allowObjectType === true)
    return assertObjectTypeNotInline(
      parseTypeUncached(s, typeResolver, typeVars, options).type
    );

  // A PRE-SEEDED parse is uncacheable: identical text means different things
  // under different seeds (`tuple<T, T>` with `T` seeded is an open type; with
  // nothing seeded it is an unknown-type error).
  if (typeVars !== undefined)
    return parseTypeUncached(s, typeResolver, typeVars).type;

  // Sound for resolver-aware calls too: `cacheResult()` admits only strings
  // whose resolver-less parse is resolver-INDEPENDENT (see below), so a hit
  // is the answer any resolver would give.
  const cached = TYPE_CACHE.get(s);
  if (cached !== undefined) return cached;

  // Two-step resolution: try the RESOLVER-LESS parse first even when a
  // resolver is supplied. A user type name can never shadow built-in type
  // syntax, so with one exception a resolver-less SUCCESS is identical to the
  // resolver-aware result — and cacheable, shared across all engines. This is
  // what lets the standard library's ~2000 signature parses per
  // `new ComputeEngine()` (all resolver-aware, ~300 distinct strings)
  // collapse into cache hits (P-BOX registration accretion).
  //
  // The exception is the `type X` forward-reference spelling
  // (`parser.sawForwardRef`): it parses resolver-less into an UNRESOLVED
  // placeholder instead of throwing, and its resolver-aware parse registers
  // the forward reference as a side effect — so such a result is discarded
  // and the resolver-aware parse runs. A string that NAMES a user type bare
  // throws on the first attempt and falls through the same way; both shapes
  // appear at declaration sites, not in per-box hot paths.
  if (typeResolver !== undefined) {
    try {
      const r = parseTypeUncached(s, undefined, undefined);
      if (!r.sawForwardRef) return cacheResult(s, r.type);
    } catch {}
    return parseTypeUncached(s, typeResolver, undefined).type;
  }

  const r = parseTypeUncached(s, undefined, undefined);
  // A forward-reference string never enters the shared cache — not even on
  // this resolver-less path — so a later resolver-aware call cannot hit a
  // placeholder parse.
  if (r.sawForwardRef) return r.type;
  return cacheResult(s, r.type);
}

/** Memoize a resolver-independent parse in {@link TYPE_CACHE}. */
function cacheResult(s: TypeString, type: Type): Type {
  // Simple bound: reset the cache if it grows too large (the working set
  // of distinct type strings is small, so this should rarely trigger)
  if (TYPE_CACHE.size >= TYPE_CACHE_MAX_SIZE) TYPE_CACHE.clear();
  TYPE_CACHE.set(s, deepFreeze(type));
  return type;
}

function parseTypeUncached(
  s: TypeString,
  typeResolver: TypeResolver | undefined,
  typeVars: readonly TypeParameter[] | undefined,
  options?: ParseTypeOptions
): { type: Type; sawForwardRef: boolean } {
  try {
    const parser = new Parser(s, {
      typeResolver,
      typeVars,
      allowObjectType: options?.allowObjectType,
    });
    const ast = parser.parseType();
    const type = buildTypeFromAST(ast, typeResolver, typeVars);

    // Polytypes are validated where they are boxed (§7.2). Gated on the parse
    // having seen a `where` clause: a variable can only be introduced by one,
    // so a type string without a clause pays nothing.
    if (parser.sawWhereClause) validateDeclaredType(type, typeResolver);

    return { type, sawForwardRef: parser.sawForwardRef };
  } catch (error) {
    const wrapped = new Error(
      `Failed to parse type "${s}": ${
        error instanceof Error ? error.message : String(error)
      }`
    ) as Error & { code?: string; rawMessage?: string };
    // Keep the structured code of a type-variable violation reachable on the
    // re-thrown error (the code is in the message either way).
    if (error instanceof TypeVariableError) {
      wrapped.code = error.code;
      wrapped.rawMessage = error.message;
    }
    // The type PARSER also codes some failures (`errorAtToken`'s `code`
    // argument), and a caller that reports diagnostics needs the code to
    // survive the wrap exactly as a type-variable violation's does.
    wrapped.code ??= (error as { code?: string }).code;
    // …and the BARE message, so a caller that reports the failure does not have
    // to quote the whole type string back at the author. `rawMessage` is the
    // type parser's own convention (set by `errorAtToken`).
    wrapped.rawMessage ??= (error as { rawMessage?: string }).rawMessage;
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
 * Epsil parser for type annotations (`x: real = 5`), where the type occupies
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
 *
 * `options.allowWhere` controls whether a trailing `where` clause may attach
 * to the type (default `false`): pass `true` only where the annotation is the
 * WHOLE type (a standalone `let f: <type> = …` annotation, a type-declaration
 * body). In embedded contexts — a return type after `->`, a comma-delimited
 * parameter or pattern annotation, a clause bound — the clause belongs to an
 * enclosing construct (or its `,`-separated list would swallow the next list
 * element), so the parse stops before the `where` and the caller's grammar
 * reports it. A PARENTHESIZED clause is always admitted.
 */
export function parseTypePrefix(
  source: string,
  typeResolver?: TypeResolver,
  typeVars?: readonly TypeParameter[],
  options?: { allowWhere?: boolean } & ParseTypeOptions
): { type: Type; end: number } {
  const parser = new Parser(source, {
    typeResolver,
    allowTrailing: true,
    allowWhere: options?.allowWhere ?? false,
    allowObjectType: options?.allowObjectType,
    typeVars,
  });
  const ast = parser.parseTypePrefix();
  const type = buildTypeFromAST(ast, typeResolver, typeVars);
  if (parser.sawWhereClause) validateDeclaredType(type, typeResolver);
  if (options?.allowObjectType === true) assertObjectTypeNotInline(type);
  return { type, end: parser.endOffset };
}

/**
 * The second half of the "an object type is legal only as the definition of a
 * named type" rule, for the routes that admit the layout form at all.
 *
 * The parser refuses `object<…>` outright everywhere else; here the form is
 * admitted, so what is left to check is its POSITION: only a body that IS the
 * layout declares an object type. A body that merely CONTAINS one
 * (`type T = list<object<a: integer>>`, `type T = object<…> | integer`) names
 * a layout no constructor is ever minted for and no value can inhabit, which
 * is inline by the same rule.
 *
 * The walk stops at a type REFERENCE: a layout reached through one belongs to
 * that reference's own declaration, which was checked when it was declared
 * (and following it could cycle).
 */
export function assertObjectTypeNotInline(type: Type): Type {
  // The body IS a layout: legal, provided no FIELD spells another one. A
  // field holding `object<…>` names a second, unnamed object type — inline by
  // the same rule; it must be declared and referred to by name.
  const inline =
    typeof type === 'object' && type.kind === 'object'
      ? Object.values(type.elements).some(containsObjectLayout)
      : containsObjectLayout(type);
  if (!inline) return type;

  const err = new Error(
    'object-type-not-inline: an `object<…>` type may only be the definition of a named type. Object types are nominal: declare one with `type Person = object<…>` (not `type alias`), then refer to `Person` here'
  ) as Error & { code?: string; rawMessage?: string };
  err.code = 'object-type-not-inline';
  err.rawMessage =
    'An `object<…>` type may only be the definition of a named type';
  throw err;
}

/** Does `t` contain an `object<…>` layout anywhere (not following type
 * references)? See {@link assertObjectTypeNotInline}. */
function containsObjectLayout(t: Type): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'object':
      return true;
    case 'record':
      return Object.values(t.elements).some(containsObjectLayout);
    case 'union':
    case 'intersection':
      return t.types.some(containsObjectLayout);
    case 'negation':
      return containsObjectLayout(t.type);
    case 'list':
    case 'set':
    case 'collection':
    case 'indexed_collection':
    case 'broadcastable':
      return containsObjectLayout(t.elements);
    case 'dictionary':
      return containsObjectLayout(t.values);
    case 'tuple':
      return t.elements.some((e) => containsObjectLayout(e.type));
    case 'callback':
      return containsObjectLayout(t.signature);
    case 'signature':
      return (
        containsObjectLayout(t.result) ||
        (t.args?.some((a) => containsObjectLayout(a.type)) ?? false) ||
        (t.optArgs?.some((a) => containsObjectLayout(a.type)) ?? false) ||
        (t.variadicArg !== undefined &&
          containsObjectLayout(t.variadicArg.type))
      );
    case 'reference':
      return t.args?.some(containsObjectLayout) ?? false;
    default:
      return false;
  }
}

//
// ── The shared type-parameter CLAUSE parser ──────────────────────────────────
//

/** A structured failure of {@link parseTypeParameterClause}: a machine code, a
 * human message, and the offset WITHIN the clause text where it was found.
 *
 * Structured rather than thrown because each consumer surfaces it differently:
 * the Epsil parser turns it into a ranged diagnostic, the `DeclareType`
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
 * Epsil `type alias Pair<T> = …` statement, whose own character scanner adds
 * source ranges and hands the text on. The input is the clause CONTENTS: the
 * enclosing `<`/`>` are not part of it.
 *
 * The whole text must be consumed (a trailing `,` or a stray `>` is an error).
 * Names are checked for duplicates and against {@link isReservedTypeName}.
 * ALL names are collected first, THEN bounds are parsed with every clause
 * name in scope (the seed-all-names-then-parse-all-bounds rule shared with
 * the trailing `where` clause, which makes the clause order-independent). A
 * bound referencing a clause variable therefore PARSES — and then fails the
 * ground-bound check with a clear message, since v1 bounds must be ground.
 *
 * A parameter may carry a leading VARIANCE marker — `out T`, `in T`,
 * `inout T` — the declaration-level variance of a parameterized nominal type
 * (parameterized-nominal design §3.1). The words are CONTEXTUAL: one is read
 * as a marker only when another name follows it, so a parameter legally named
 * `in` still parses as a name. Rejecting a marker where it is meaningless (a
 * transparent alias) is the CALLER's job — this reader is shared.
 */
/** A variance marker followed by (the start of) a parameter name. `inout` is
 * listed first so it is preferred over its `in` prefix. */
const VARIANCE_MARKER = /^(inout|in|out)\s+(?=[a-zA-Z_])/;

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

  // ── Pass 1: structure. Collect every entry's name (and the raw extent of
  // its bound, via a bracket-depth scan) WITHOUT parsing any bound, so that
  // all names can be seeded before any bound is parsed.
  interface ClauseEntry {
    name: string;
    variance?: TypeVariance;
    boundText?: string;
    boundPos?: number;
  }
  const entries: ClauseEntry[] = [];
  const seen = new Set<string>();
  for (;;) {
    skipSpace();
    // The contextual variance marker: only when a NAME follows it.
    let variance: TypeVariance | undefined;
    const vm = VARIANCE_MARKER.exec(text.slice(pos));
    if (vm !== null) {
      variance = vm[1] as TypeVariance;
      pos += vm[0].length;
    }
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

    const entry: ClauseEntry = { name };
    if (variance !== undefined) entry.variance = variance;

    skipSpace();
    if (text[pos] === ':') {
      pos += 1;
      const boundPos = pos;
      // Scan — not parse — to the end of the bound: the next `,` at bracket
      // depth 0, or the end of the clause. Bounds are types, so brackets may
      // nest commas of their own.
      pos = scanToClauseComma(text, pos);
      entry.boundText = text.slice(boundPos, pos);
      entry.boundPos = boundPos;
    }
    entries.push(entry);

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

  // ── Pass 2: bounds, with EVERY clause name in scope (the clause is
  // order-independent: a bound may reference a variable declared later). A
  // bound that does reference one parses — and is rejected right below by
  // the v1 ground-bound rule, with a message that names the variable.
  const seededNames: TypeParameter[] = entries.map((e) => ({ name: e.name }));
  const params: TypeParameter[] = [];
  for (const entry of entries) {
    const param: TypeParameter = { name: entry.name };
    if (entry.variance !== undefined) param.variance = entry.variance;
    if (entry.boundText !== undefined) {
      const boundPos = entry.boundPos!;
      let bound: Type;
      let consumed: number;
      try {
        const r = parseTypePrefix(entry.boundText, typeResolver, seededNames);
        bound = r.type;
        consumed = r.end;
      } catch (e) {
        const detail = e as { position?: number; rawMessage?: string };
        return err(
          'bound-error',
          detail.rawMessage ?? (e instanceof Error ? e.message : String(e)),
          boundPos + (detail.position ?? 0)
        );
      }
      // The prefix parse must have consumed the whole scanned extent: a
      // leftover (`T: number 5`) is the same separator error the single-pass
      // reader reported.
      if (entry.boundText.slice(consumed).trim().length > 0)
        return err(
          'separator-expected',
          'Expected `,` between type parameters',
          boundPos + consumed
        );
      // v1: a bound is GROUND — no reference to a clause variable (its own
      // name or any other), no F-bounded `T: comparable<T>`.
      if (freeTypeVariables(bound).size > 0)
        return err(
          'bound-error',
          `The bound of the type variable \`${entry.name}\` must be a ground type`,
          boundPos
        );
      param.bound = bound;
    }
    params.push(param);
  }

  return { params };
}

/**
 * Scan from `pos` to the next `,` at bracket depth 0, or to the end of
 * `text`, WITHOUT parsing: the raw extent of one clause entry's bound.
 * Brackets (`()`, `<>`, `[]`) nest; `->` is skipped atomically so its `>`
 * does not close a bracket; string literals (`"…"`, `'…'`, `` `…` ``) are
 * skipped with their escapes.
 */
function scanToClauseComma(text: string, pos: number): number {
  let depth = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === ',' && depth === 0) return pos;
    if (ch === '(' || ch === '<' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '>' || ch === ']') depth -= 1;
    else if (ch === '-' && text[pos + 1] === '>') pos += 1;
    else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      pos += 1;
      while (pos < text.length && text[pos] !== quote) {
        if (text[pos] === '\\') pos += 1;
        pos += 1;
      }
    }
    pos += 1;
  }
  return pos;
}
