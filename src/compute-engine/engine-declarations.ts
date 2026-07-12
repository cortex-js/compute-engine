import type { Type, TypeString } from '../common/type/types.js';
import { isValidType, isValidTypeName, widen } from '../common/type/utils.js';
import { parseType } from '../common/type/parse.js';
import { BoxedType } from '../common/type/boxed-type.js';
import { osaDistance } from '../common/fuzzy-string-match.js';

import { isValidSymbol, validateSymbol } from '../math-json/symbols.js';
import type { MathJsonSymbol } from '../math-json/types.js';

import type {
  ValueDefinition,
  OperatorDefinition,
  AssignValue,
  Expression,
  BoxedDefinition,
  DefinitionSearchResult,
  SymbolDefinition,
  IComputeEngine,
  Scope,
} from './global-types.js';

import { _BoxedValueDefinition } from './boxed-expression/boxed-value-definition.js';
import {
  isValidOperatorDef,
  isValidValueDef,
  isValueDef,
  isOperatorDef,
  updateDef,
} from './boxed-expression/utils.js';
import { canonicalFunctionLiteral, lookup } from './function-utils.js';

export function lookupDefinition(
  ce: IComputeEngine,
  id: MathJsonSymbol
): undefined | BoxedDefinition {
  return lookup(id, ce.context.lexicalScope);
}

/** The `kind` of a definition, matching `operatorInfo()`/`symbolInfo()`
 * semantics, or `undefined` if the definition is neither. */
function definitionKind(
  def: BoxedDefinition
): DefinitionSearchResult['kind'] | undefined {
  if (isOperatorDef(def)) {
    const op = def.operator;
    return op.evaluate || op.collection ? 'function' : 'opaque';
  }
  if (isValueDef(def)) return def.value.isConstant ? 'constant' : 'variable';
  return undefined;
}

/** The description line(s) of a definition, as a list of searchable strings. */
function descriptionLines(def: BoxedDefinition): string[] {
  const d = isOperatorDef(def)
    ? def.operator.description
    : isValueDef(def)
      ? def.value.description
      : undefined;
  if (!d) return [];
  return typeof d === 'string' ? [d] : d;
}

/** The curated search keywords of a definition, as a list of searchable
 * strings. */
function keywordsOf(def: BoxedDefinition): string[] {
  const k = isOperatorDef(def)
    ? def.operator.keywords
    : isValueDef(def)
      ? def.value.keywords
      : undefined;
  return k ?? [];
}

/**
 * Reverse library search: map a plain-text concept query to a ranked list of
 * matching identifiers. See `ComputeEngine.searchDefinitions`.
 */
export function searchDefinitions(
  ce: IComputeEngine,
  query: string,
  options?: { limit?: number }
): DefinitionSearchResult[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length === 0) return [];

  const tokens = q.split(' ');

  // Clamp limit to [1, 100], default 10.
  let limit = options?.limit ?? 10;
  if (!Number.isFinite(limit)) limit = 10;
  limit = Math.max(1, Math.min(100, Math.floor(limit)));

  // Trigger axis: name -> triggers. Degrades gracefully (no triggers) when no
  // LaTeX syntax is available or it doesn't implement `getNamedTriggers`. This
  // only augments scope-bound candidates; it never introduces new ids.
  const triggersByName = new Map<string, string[]>();
  const named = ce.latexSyntax?.getNamedTriggers?.();
  if (named)
    for (const { name, triggers } of named) triggersByName.set(name, triggers);

  type Ranked = {
    id: MathJsonSymbol;
    kind: DefinitionSearchResult['kind'];
    tier: number;
  };
  const results: Ranked[] = [];
  const seen = new Set<string>();

  // Walk the lexical scope chain; nearest scope wins for duplicate names.
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope) {
    for (const [name, def] of scope.bindings) {
      if (seen.has(name)) continue;
      seen.add(name);

      const kind = definitionKind(def);
      if (kind === undefined) continue;

      const idLower = name.toLowerCase();
      const triggersLower = (triggersByName.get(name) ?? []).map((t) =>
        t.toLowerCase()
      );
      const descriptions = descriptionLines(def).map((d) => d.toLowerCase());
      const keywordsLower = keywordsOf(def).map((k) => k.toLowerCase());

      const searchable = [
        idLower,
        ...triggersLower,
        ...keywordsLower,
        ...descriptions,
      ];

      // Gate: every query token must be a substring of at least one
      // searchable string.
      const matched = tokens.every((tok) =>
        searchable.some((s) => s.includes(tok))
      );
      if (!matched) continue;

      // Tier (lower is better). Pins the ranking invariants for single-token
      // queries; multi-token queries that only match via description land in
      // the last tier. An exact keyword match ranks with exact triggers (tier
      // 2) so a curated alias wins over name-substring noise; keyword
      // substring matches fall through to the description tier.
      let tier: number;
      if (idLower === q) tier = 0;
      else if (idLower.startsWith(q)) tier = 1;
      else if (triggersLower.some((t) => t === q)) tier = 2;
      else if (keywordsLower.some((k) => k === q)) tier = 2;
      else if (idLower.includes(q)) tier = 3;
      else if (triggersLower.some((t) => t.includes(q))) tier = 4;
      else tier = 5;

      results.push({ id: name, kind, tier });
    }
    scope = scope.parent;
  }

  // Deterministic ordering: tier, then shorter id, then alphabetical.
  results.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.id.length !== b.id.length) return a.id.length - b.id.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return results.slice(0, limit).map(({ id, kind }) => ({ id, kind }));
}

// Per-engine cache of the operator-name pool, invalidated when the definition
// generation changes.
const operatorPoolCache = new WeakMap<
  IComputeEngine,
  { generation: number; names: string[] }
>();

/**
 * The names of all operator (function) definitions visible in the current
 * scope chain — the candidate pool for `suggestOperatorName`. Nearest scope
 * wins for duplicate names. Cached per engine, invalidated by generation.
 */
function operatorNamePool(ce: IComputeEngine): string[] {
  const cached = operatorPoolCache.get(ce);
  if (cached && cached.generation === ce._generation) return cached.names;

  const names: string[] = [];
  const seen = new Set<string>();
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope) {
    for (const [name, def] of scope.bindings) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (isOperatorDef(def)) names.push(name);
    }
    scope = scope.parent;
  }

  operatorPoolCache.set(ce, { generation: ce._generation, names });
  return names;
}

/**
 * Given a name that is *not* a known operator, return the closest known
 * operator name (a "did you mean" suggestion), or `undefined` when nothing is
 * close enough. Matching is conservative and applied in priority order, the
 * first tier that yields a match wins:
 *
 *  1. case-insensitive exact match (`arg` → `Arg`),
 *  2. singular/plural (`Quartile` → `Quartiles`, or vice-versa),
 *  3. Damerau–Levenshtein distance ≤ 2 for names of length ≥ 6, ≤ 1 for
 *     length 5, never for length < 5 (short names produce junk suggestions:
 *     `vec` → `Sec`, `rand` → `And`, `print` → `Prime`),
 *  4. the name is a prefix (≥ 3 chars) of exactly one known operator.
 *
 * Within a tier, ties break to the candidate sharing the longest prefix with
 * the query (`integral` → `Integrate`, not `Interval`), then the shortest,
 * then alphabetically.
 */
export function suggestOperatorName(
  ce: IComputeEngine,
  name: string
): string | undefined {
  if (!name) return undefined;

  const pool = operatorNamePool(ce);
  const lower = name.toLowerCase();

  // Longest common prefix between the query and a candidate, case-insensitive.
  const lcp = (n: string): number => {
    const nl = n.toLowerCase();
    let i = 0;
    while (i < lower.length && i < nl.length && lower[i] === nl[i]) i += 1;
    return i;
  };

  const pick = (cands: string[]): string | undefined => {
    if (cands.length === 0) return undefined;
    return cands.sort((a, b) => {
      const pa = lcp(a);
      const pb = lcp(b);
      if (pa !== pb) return pb - pa;
      if (a.length !== b.length) return a.length - b.length;
      return a < b ? -1 : a > b ? 1 : 0;
    })[0];
  };

  // Tier 1: case-insensitive exact match (excluding identity).
  const ciExact = pool.filter((n) => n !== name && n.toLowerCase() === lower);
  if (ciExact.length > 0) return pick(ciExact);

  // Tier 2: singular/plural.
  const plural: string[] = [];
  for (const n of pool) {
    const nl = n.toLowerCase();
    if (
      nl === `${lower}s` ||
      (lower.endsWith('s') && nl === lower.slice(0, -1))
    )
      plural.push(n);
  }
  if (plural.length > 0) return pick(plural);

  // Tier 3: Damerau–Levenshtein distance.
  if (name.length >= 5) {
    const max = name.length >= 6 ? 2 : 1;
    let bestDist = max + 1;
    let ties: string[] = [];
    for (const n of pool) {
      if (n === name) continue;
      const d = osaDistance(lower, n.toLowerCase(), max);
      if (d > max) continue;
      if (d < bestDist) {
        bestDist = d;
        ties = [n];
      } else if (d === bestDist) ties.push(n);
    }
    if (ties.length > 0) return pick(ties);
  }

  // Tier 4: the name is a prefix (≥ 3 chars) of exactly one known operator.
  if (name.length >= 3) {
    const prefixed = pool.filter(
      (n) => n !== name && n.toLowerCase().startsWith(lower)
    );
    if (prefixed.length === 1) return prefixed[0];
  }

  return undefined;
}

export function declareSymbolValue(
  ce: IComputeEngine,
  name: MathJsonSymbol,
  def: Partial<ValueDefinition>,
  scope?: Scope
): BoxedDefinition {
  scope ??= ce.context.lexicalScope;

  // Insert a placeholder in the bindings to handle recursive calls
  // (the value could be a function that references itself)
  scope.bindings.set(name, {
    value: new _BoxedValueDefinition(ce, name, {
      type: 'unknown',
      inferred: true,
    }),
  });

  const boxedDef = scope.bindings.get(name)!;
  updateDef(ce, name, boxedDef, def);

  ce._generation += 1;

  return boxedDef;
}

export function declareSymbolOperator(
  ce: IComputeEngine,
  name: string,
  def: OperatorDefinition,
  scope?: Scope
): BoxedDefinition {
  scope ??= ce.context.lexicalScope;
  // Insert a placeholder in the bindings to handle recursive calls
  // (the function is not yet defined)
  scope.bindings.set(name, {
    value: new _BoxedValueDefinition(ce, name, { type: 'function' }),
  });

  const boxedDef = scope.bindings.get(name)!;
  updateDef(ce, name, boxedDef, def);

  ce._generation += 1;

  return boxedDef;
}

export function getSymbolValue(
  ce: IComputeEngine,
  id: MathJsonSymbol
): Expression | undefined {
  const def = lookup(id, ce.context.lexicalScope);
  if (!def || !isValueDef(def)) return undefined;
  return def.value.value;
}

export function setSymbolValue(
  ce: IComputeEngine,
  id: MathJsonSymbol,
  value: Expression | boolean | number | undefined
): void {
  if (typeof value === 'number') value = ce.number(value);
  else if (typeof value === 'boolean') value = value ? ce.True : ce.False;

  const def = lookup(id, ce.context.lexicalScope);
  if (!def) throw new Error(`Unknown symbol "${id}"`);

  if (isValueDef(def)) {
    def.value.value = value;
    ce._generation += 1;
    return;
  }

  // Operator definition: cannot set a plain value on an operator symbol
  throw new Error(`Cannot assign a value to operator symbol "${id}"`);
}

export function declareType(
  ce: IComputeEngine,
  name: string,
  type: BoxedType | Type | TypeString,
  { alias }: { alias?: boolean } = {}
): void {
  if (!isValidTypeName(name)) throw Error(`The type name "${name}" is invalid`);

  // Is the type already defined in this scope?
  const scope = ce.context.lexicalScope;
  if (scope.types?.[name])
    throw Error(`The type "${name}" is already defined in the current scope`);

  scope.types ??= {};

  alias ??= false; // Nominal by default

  // First, add a placeholder record to allow recursive types
  scope.types[name] = { kind: 'reference', name, alias, def: undefined };

  // Parse the type (which may reference itself)
  const def =
    type instanceof BoxedType
      ? type.type
      : typeof type === 'string'
        ? parseType(type, ce._typeResolver)
        : type;

  // Adjust the definition (the type references in the type will point to
  // the placeholder record)
  scope.types[name].def = def;
}

export function declareFn(
  ce: IComputeEngine,
  arg1:
    | string
    | {
        [id: string]: Type | TypeString | Partial<SymbolDefinition>;
      },
  arg2?: Type | TypeString | Partial<SymbolDefinition>,
  scope?: Scope
): IComputeEngine {
  //
  // If the argument is an object literal, call `declare` for each entry
  //
  if (typeof arg1 !== 'string') {
    for (const [id, def] of Object.entries(arg1)) ce.declare(id, def);
    return ce;
  }

  const id = arg1;

  // The special id `Nothing` can never be redeclared.
  // It is also used to indicate that a symbol should be ignored,
  // so it's valid, but it doesn't do anything.
  if (id === 'Nothing') return ce;

  // Can't "undeclare" (set to `undefined`/`null`) a symbol either
  // (but its value can be set to `undefined` with `ce.assign()`)
  if (arg2 === undefined || arg2 === null)
    throw Error(`Expected a definition or type for "${id}"`);

  // Check the id is valid
  if (typeof id !== 'string' || id.length === 0 || !isValidSymbol(id)) {
    throw new Error(`Invalid symbol "${id}": ${validateSymbol(id)}`);
  }

  scope ??= ce.context.lexicalScope;

  //
  // Check the id is not already declared in the current scope.
  //
  // Tolerate re-declaring a name that was only *auto-declared* (its type or
  // signature inferred from usage, e.g. by `ce.parse('f(x)')` or
  // `ce.parse('a + 1')`). An explicit declaration is allowed to refine an
  // inferred one — that is precisely what the `inferred` flag exists for — so
  // a declare-first flow can parse cells to discover names and then declare
  // them on the same engine without throwing. Re-declaring an *explicit*
  // binding still throws. The declaration below overwrites the inferred one.
  //
  const bindings = scope.bindings;
  const existing = bindings.get(id);
  if (existing !== undefined) {
    // Only a *value-less* inferred binding is upgradable: it was auto-declared
    // from usage (e.g. a free variable or function call seen by `parse`). A
    // binding that carries a value — a function argument, or an outer explicit
    // declaration — is a genuine conflict and still throws. This mirrors the
    // upgrade rule in the `Declare` operator handler (library/core.ts).
    const inferred =
      (isValueDef(existing) &&
        existing.value.inferredType &&
        existing.value.value === undefined) ||
      (isOperatorDef(existing) && existing.operator.inferredSignature);
    if (!inferred)
      throw new Error(`The symbol "${id}" is already declared in this scope`);
  }

  //
  // Declaring a symbol or function with a definition or type
  //

  const def = arg2;

  if (isValidValueDef(def)) {
    ce._declareSymbolValue(id, def, scope);
    return ce;
  }

  if (isValidOperatorDef(def)) {
    ce._declareSymbolOperator(id, def, scope);
    return ce;
  }

  //
  // Declaring a symbol with a type
  // `ce.declare("f", "number -> number")`
  // `ce.declare("z", "complex")`
  // `ce.declare("n", "integer")`
  //
  {
    const type = parseType(def, ce._typeResolver);
    if (!isValidType(type)) {
      throw Error(
        [
          `Invalid argument for "${id}"`,
          JSON.stringify(def, undefined, 4),
          `Use a type, a \`OperatorDefinition\` or a \`ValueDefinition\``,
        ].join('\n|   ')
      );
    }

    ce._declareSymbolValue(id, { type }, scope);
  }

  return ce;
}

export function assignFn(
  ce: IComputeEngine,
  arg1: string | { [id: string]: AssignValue },
  arg2?: AssignValue
): IComputeEngine {
  //
  // If the first argument is an object literal, call `assign()` for each key
  //
  if (typeof arg1 === 'object') {
    console.assert(arg2 === undefined);
    for (const [id, def] of Object.entries(arg1)) ce.assign(id, def);
    return ce;
  }

  const id = arg1;

  // Cannot set the value of 'Nothing'
  // @todo: could have a 'locked' attribute on the definition
  if (id === 'Nothing') return ce;

  const def = ce.lookupDefinition(id);

  if (isOperatorDef(def)) {
    const value = assignValueAsValue(ce, arg2);
    if (value !== undefined) {
      // Allow converting an operator to a value.
      // Existing expressions using this symbol as a function head (e.g.
      // ["g", 2]) will produce a type error at evaluation time if the
      // new value is not callable — which is the correct semantic.
      updateDef(ce, id, def, { value });
      ce._setSymbolValue(id, value);
      return ce;
    }

    // Update the operator definition.
    const fnDef = assignValueAsOperatorDef(ce, arg2);
    if (!fnDef) throw Error(`Invalid definition for symbol "${id}"`);
    updateDef(ce, id, def, fnDef);
    return ce;
  }

  //
  // 1/ We were given a value
  //
  const value = assignValueAsValue(ce, arg2);
  if (value !== undefined) {
    if (!def) {
      // No previous definition: create a new one
      ce._declareSymbolValue(id, { value });
      return ce;
    }
    if (def.value.isConstant)
      throw Error(`Cannot assign a value to the constant "${id}"`);

    // We have a value definition, update the inferred type...
    if (def.value.inferredType) {
      const current = def.value.type.type;
      const vt = value.type.type;
      // Normally widen the inferred type to cover the assigned value (an
      // `integer` guess refined by a `real` value widens to `real`). But when
      // the guess is genuinely incompatible with the value — widening yields a
      // union, e.g. a symbol heuristically auto-declared `function` by the
      // juxtaposition parser now given a scalar value (`number | function`) —
      // the guess was simply wrong: adopt the value's own type instead (D11).
      const widened = widen(current, vt);
      def.value.type = ce.type(
        typeof widened === 'object' && widened.kind === 'union' ? vt : widened
      );
    }

    // ... and set the value
    ce._setSymbolValue(id, value);

    return ce;
  }

  //
  // 2/ We were given an operator definition
  //
  const fnDef = assignValueAsOperatorDef(ce, arg2);
  if (fnDef === undefined) throw Error(`Invalid definition for symbol "${id}"`);

  if (def) {
    // If we get here, the previous definition was a value definition.
    // We can update it to an operator definition.
    console.assert(isValueDef(def));
    // updateDef removes def.value and sets def.operator — no separate
    // _setSymbolValue call needed to clear the old value.
    updateDef(ce, id, def, fnDef);
  } else {
    // No previous definition: create a new one
    ce.declare(id, fnDef);
  }

  return ce;
}

function assignValueAsValue(
  ce: IComputeEngine,
  value: AssignValue
): Expression | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'function') return undefined;

  if (typeof value === 'boolean') return value ? ce.True : ce.False;
  if (typeof value === 'number' || typeof value === 'bigint')
    return ce.number(value);
  const expr = ce.expr(value);
  // Explicit function expressions should always be treated as operator definitions
  if (expr.operator === 'Function') return undefined;
  if (expr.unknowns.some((s) => s.startsWith('_'))) {
    // If the expression has wildcards, it should be treated as a function
    // E.g. ["Add", "_", 1] or ["Add", "_x", 1]
    // Note: Regular unknowns (e.g., "x", "a", "b") are fine in values
    return undefined;
  }
  return expr;
}

function assignValueAsOperatorDef(
  ce: IComputeEngine,
  value: AssignValue
): OperatorDefinition | undefined {
  if (typeof value === 'function')
    return { evaluate: value, signature: 'function' };

  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return undefined;

  const body = canonicalFunctionLiteral(ce.expr(value));
  if (body === undefined) return undefined;

  // Don't set an explicit signature - let it be inferred from the body.
  // This ensures inferredSignature = true, which allows the return type
  // to be properly narrowed during type checking (e.g., in Add operands).
  return { evaluate: body };
}
