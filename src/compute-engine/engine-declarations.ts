import type { Type, TypeString } from '../common/type/types.js';
import {
  functionResult,
  functionSignature,
  isValidType,
  isValidTypeName,
  widen,
} from '../common/type/utils.js';
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
import { isFunction } from './boxed-expression/type-guards.js';
import {
  functionLiteralParameters,
  functionLiteralReturnType,
} from './boxed-expression/function-literal.js';

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
  query: string | string[],
  options?: { limit?: number }
): DefinitionSearchResult[] {
  // Normalize into a list of phrases (one per array element, or the whole
  // string), then a deduplicated bag of tokens. Matching is an OR over
  // tokens; ranking rewards matching more of them.
  const phrases = (typeof query === 'string' ? [query] : query)
    .map((q) => q.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((q) => q.length > 0);
  if (phrases.length === 0) return [];

  const tokens = [...new Set(phrases.flatMap((p) => p.split(' ')))];

  // Multi-word phrases also participate in tier scoring so an exact keyword
  // like "inverse cosine" ranks above token-level description matches.
  const probes = [
    ...new Set([...tokens, ...phrases.filter((p) => p.includes(' '))]),
  ];

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
    matched: number;
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

      // Tier of one probe string against this definition (lower is better),
      // or undefined when it matches no axis at all. An exact keyword match
      // ranks with exact triggers (tier 2) so a curated alias wins over
      // name-substring noise; keyword-substring and description matches land
      // in the last tier.
      const tierOf = (s: string): number | undefined => {
        if (idLower === s) return 0;
        if (idLower.startsWith(s)) return 1;
        if (triggersLower.some((t) => t === s)) return 2;
        if (keywordsLower.some((k) => k === s)) return 2;
        if (idLower.includes(s)) return 3;
        if (triggersLower.some((t) => t.includes(s))) return 4;
        if (searchable.some((x) => x.includes(s))) return 5;
        return undefined;
      };

      // Gate: at least one token must match (OR semantics). Ranking then
      // rewards matching more tokens, and matching them more exactly.
      const matched = tokens.filter((tok) => tierOf(tok) !== undefined).length;
      if (matched === 0) continue;

      let tier = Infinity;
      for (const probe of probes) {
        const t = tierOf(probe);
        if (t !== undefined && t < tier) tier = t;
      }

      results.push({ id: name, kind, matched, tier });
    }
    scope = scope.parent;
  }

  // Deterministic ordering: most tokens matched, then tier, then shorter id,
  // then alphabetical.
  results.sort((a, b) => {
    if (a.matched !== b.matched) return b.matched - a.matched;
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
    // Phase 3 §6.3 — declared-signature reconciliation (declare-with-value and
    // `Declare(f, type, value)` evaluate paths). When declaring a function
    // literal against an explicit function signature, ascribe the declared
    // return type onto the literal (if it lacks its own) so a merely-wider body
    // inference does not trip the covariant compatibility check. Genuine
    // conflicts still throw in the value-definition constructor.
    let valueDef: Partial<ValueDefinition> = def;
    if (
      def.type !== undefined &&
      isFunction(def.value as Expression | undefined, 'Function')
    ) {
      const declaredType =
        def.type instanceof BoxedType ? def.type.type : parseType(def.type);
      if (functionSignature(declaredType) !== undefined) {
        // The literal must be arity-compatible with the declared signature
        // (mirrors the assign path); otherwise a declared-arity call would
        // silently partial-apply.
        assertFunctionLiteralArity(
          id,
          def.value as Expression,
          declaredType,
          ce.type(declaredType).toString()
        );
        valueDef = {
          ...def,
          value: reconcileFunctionLiteralReturn(
            ce,
            def.value as Expression,
            declaredType
          ),
        };
      }
    }
    ce._declareSymbolValue(id, valueDef, scope);
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

  // Phase 3 §6.3 — declared-signature reconciliation (assign path).
  // Assigning a function literal to a symbol that carries an EXPLICIT declared
  // function signature (a non-inferred, function-typed value definition): the
  // declaration is authoritative. Ascribe its return type onto the literal (if
  // the literal lacks its own) and keep the value under the declared signature,
  // rather than dropping the signature by converting to an inferred operator
  // definition. Genuine parameter/return conflicts are still rejected.
  if (
    isValueDef(def) &&
    !def.value.isConstant &&
    !def.value.inferredType &&
    arg2 !== undefined &&
    arg2 !== null &&
    typeof arg2 !== 'function' &&
    functionSignature(def.value.type.type) !== undefined
  ) {
    const literal = canonicalFunctionLiteral(ce.expr(arg2));
    if (literal !== undefined) {
      const declaredType = def.value.type;

      // The literal must be arity-compatible with the declared signature (see
      // `assertFunctionLiteralArity`); otherwise function subtyping would treat
      // an over-arity literal as assignable to a lower-arity signature, or an
      // optional/variadic declaration would let a legal call silently
      // partial-apply on the fixed-arity body.
      assertFunctionLiteralArity(
        id,
        literal,
        declaredType.type,
        declaredType.toString()
      );

      const reconciled = reconcileFunctionLiteralReturn(
        ce,
        literal,
        declaredType.type
      );
      if (!reconciled.type.matches(declaredType))
        throw new Error(
          [
            `Symbol "${id}"`,
            `The value "${reconciled.toString()}" of type "${
              reconciled.type
            }" is not compatible with the type "${declaredType}"`,
          ].join('\n|   ')
        );
      ce._setSymbolValue(id, reconciled);
      return ce;
    }
  }

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

  // Phase 3 (§9.2): when the literal carries type annotations (an annotated
  // parameter or a return-type ascription), derive an explicit operator
  // signature from its type so that calls to the symbol validate the annotated
  // parameter types and carry the ascribed return type — exactly as the
  // `Declare(f, "(…) -> any", Function(…))` workaround does. This flips
  // `inferredSignature = false` for the operator.
  if (functionLiteralHasAnnotation(body))
    return { evaluate: body, signature: body.type };

  // Untyped literal: don't set an explicit signature - let it be inferred from
  // the body. This ensures inferredSignature = true, which allows the return
  // type to be properly narrowed during type checking (e.g., in Add operands).
  return { evaluate: body };
}

/** True if a canonical `Function` literal carries at least one type annotation
 * — an annotated parameter or a return-type ascription (the Phase-1 §4.2
 * marker). Untyped literals return `false` and keep the inferred-signature
 * behavior. */
function functionLiteralHasAnnotation(literal: Expression): boolean {
  if (functionLiteralReturnType(literal) !== undefined) return true;
  return functionLiteralParameters(literal).some((p) => p.type !== undefined);
}

/**
 * §6.3 declared-signature reconciliation — arity guard shared by the
 * declare-with-value, `Declare(f, sig, value)` and assign paths.
 *
 * A `Function` literal defines a *fixed-arity* function of arity `L`: it can
 * only service calls of exactly arity `L` (`function-utils.ts` curries calls
 * below `L` into a partial application and throws on calls above `L`). It is
 * therefore compatible with an explicit declared signature only when that
 * signature's set of accepted call arities is exactly `{L}` — i.e. a signature
 * with no optional and no variadic arguments whose required arity is `L`.
 *
 * A signature with optional or variadic arguments, or a different fixed arity,
 * permits call arities the literal cannot handle (which would otherwise let a
 * legal call silently partial-apply or throw at runtime), so it is a genuine
 * conflict and is rejected here rather than stored. Function subtyping alone
 * does not catch this: it treats an over-arity literal as assignable to a
 * lower-arity signature.
 *
 * Does nothing when the literal is not a `Function` literal or the declared
 * type is not a plain function signature (nothing to check).
 */
function assertFunctionLiteralArity(
  id: MathJsonSymbol,
  literal: Expression,
  declaredType: Type,
  declaredDisplay: string
): void {
  if (!isFunction(literal, 'Function')) return;

  // Only a concrete declared *signature* constrains arity. The top `function`
  // type (`ce.declare('f', 'function')`, stored as the primitive string
  // `'function'`) is a wildcard: it promises callers nothing about arity, so a
  // fixed-arity literal is a valid implementation. Use the raw declared type
  // here rather than `functionSignature`, which would synthesize a variadic
  // `(any*) -> unknown` signature for that wildcard and wrongly reject it.
  if (typeof declaredType !== 'object' || declaredType.kind !== 'signature')
    return;
  const declaredSig = declaredType;

  const literalArity = functionLiteralParameters(literal).length;
  const requiredArity = declaredSig.args?.length ?? 0;
  const optArity = declaredSig.optArgs?.length ?? 0;
  const hasVariadic = declaredSig.variadicArg !== undefined;

  // Compatible iff the signature accepts exactly one call arity, equal to the
  // literal's arity.
  if (!hasVariadic && optArity === 0 && requiredArity === literalArity) return;

  // Describe the arity range the declaration accepts for the error message.
  let accepted: string;
  if (hasVariadic) {
    const min = requiredArity + (declaredSig.variadicMin ?? 0);
    accepted = `${min} or more`;
  } else if (optArity > 0) {
    accepted = `${requiredArity} to ${requiredArity + optArity}`;
  } else {
    accepted = `exactly ${requiredArity}`;
  }

  throw new Error(
    [
      `Symbol "${id}"`,
      `The function literal "${literal.toString()}" takes ${literalArity} parameter(s), but the declared signature "${declaredDisplay}" accepts ${accepted}`,
    ].join('\n|   ')
  );
}

/**
 * §6.3 declared-signature reconciliation. When a `Function` literal is assigned
 * to a symbol carrying an explicit declared signature and the literal lacks its
 * own return-type ascription, the declared return type is *ascribed* onto the
 * literal (the declaration is authoritative, TypeScript-style) rather than
 * covariantly checked against weak body inference — which would otherwise throw
 * at `boxed-value-definition.ts`.
 *
 * Returns the (possibly rebuilt) literal. Genuine parameter/return conflicts
 * are left for the caller's compatibility check to reject.
 */
function reconcileFunctionLiteralReturn(
  ce: IComputeEngine,
  literal: Expression,
  declaredType: Type
): Expression {
  if (!isFunction(literal, 'Function')) return literal;

  // The declaration must be a function signature with a result type.
  const declaredResult = functionResult(declaredType);
  if (declaredResult === undefined) return literal;

  // Respect an author-supplied return ascription.
  if (functionLiteralReturnType(literal) !== undefined) return literal;

  // Only ascribe when the inferred body result would otherwise fail the
  // covariant check (e.g. inferred `number` vs declared `integer`). When it
  // already satisfies the declaration (e.g. declared `any`), leave the literal
  // untouched so the stored value is unchanged.
  const inferredResult = functionResult(literal.type.type);
  if (
    inferredResult !== undefined &&
    ce.type(inferredResult).matches(ce.type(declaredResult))
  )
    return literal;

  // Rebuild via the Phase-1 authoring form: wrap the body in a `Typed`
  // ascription and re-box so canonicalization normalizes it (§4.2 — the marker
  // moves inside the Block, wrapping the last statement).
  const rebuilt = ce.box([
    'Function',
    ['Typed', literal.ops[0].json, `'${ce.type(declaredResult).toString()}'`],
    ...literal.ops.slice(1).map((p) => p.json),
  ]);
  return isFunction(rebuilt, 'Function') ? rebuilt : literal;
}
