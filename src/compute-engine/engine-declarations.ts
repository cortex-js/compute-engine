import type {
  FunctionSignature,
  Type,
  TypeParameter,
  TypeParamsOption,
  TypeReference,
  TypeString,
} from '../common/type/types.js';
import {
  functionResult,
  hasFunctionSignature,
  isValidType,
  isValidTypeName,
  returnTypeText,
  signatureArms,
  widen,
  containsSignatureArm,
} from '../common/type/utils.js';
import { parseType, parseTypeParameterClause } from '../common/type/parse.js';
import { CACHE_STATS, bumpShadowCallable } from '../common/cache-stats.js';
import { isEffectSubset } from '../common/type/effects.js';
import {
  freeTypeVariables,
  hasFreeTypeVariables,
  isReservedTypeName,
  satisfiesTypeBound,
  substituteTypeVariables,
  TypeVariableError,
  isPolymorphicType,
} from '../common/type/instantiate.js';
import { declarationOf, forwardArities } from '../common/type/reference.js';
import { verifyVariance } from '../common/type/variance.js';
import type { VarianceResult } from '../common/type/variance.js';
import { BoxedType } from '../common/type/boxed-type.js';
import {
  assertSingleArmPolytype,
  EffectContractError,
  matchesDeclaredTypeAxes,
  signatureEffects,
  stripArrowEffects,
  withArrowEffects,
} from './boxed-expression/effects-inference.js';
import {
  constructorAssignmentError,
  declaredTypeError,
} from './boxed-expression/type-compatibility-error.js';
import { osaDistance } from '../common/fuzzy-string-match.js';

import { isValidSymbol, validateSymbol } from '../math-json/symbols.js';
import type { MathJsonExpression, MathJsonSymbol } from '../math-json/types.js';

import type {
  ValueDefinition,
  OperatorDefinition,
  AssignValue,
  Expression,
  BoxedDefinition,
  BoxedValueDefinition,
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
  defIsCallableShaped,
} from './boxed-expression/utils.js';
import { canonicalFunctionLiteral, lookup } from './function-utils.js';
import {
  provisionalLiteral,
  registerProvisionalDependents,
  repairProvisionalDependents,
  setProvisionalLiteral,
} from './boxed-expression/provisional-application.js';
import {
  checkTypeConstructorNamespace,
  installConstructorFunction,
  isMintedConstructor,
  loosenMintedConstructor,
  mintTypeConstructor,
} from './type-constructors.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from './boxed-expression/type-guards.js';
import { paramsAreScalar } from './boxed-expression/boxed-function.js';
import {
  functionLiteralDeclaredEffects,
  functionLiteralDeclaredSignature,
  functionLiteralParameters,
  functionLiteralReturnType,
  isScalarType,
  mentionsQuantifiedVariable,
} from './boxed-expression/function-literal.js';
import { typeToString } from '../common/type/serialize.js';

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
  if (cached && cached.generation === ce._anyVersion) return cached.names;

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

  operatorPoolCache.set(ce, { generation: ce._anyVersion, names });
  return names;
}

/**
 * Given a name that is *not* a known operator, return the closest known
 * operator name (a "did you mean" suggestion), or `undefined` when nothing is
 * close enough. Matching is conservative and applied in priority order, the
 * first tier that yields a match wins:
 *
 *  0. curated cross-language synonyms (`split` → `StringSplit`,
 *     `push` → `Append`, `ceiling` → `Ceil`),
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
/**
 * Curated cross-language synonyms: names newcomers (and LLM agents)
 * reflexively try — from Python, JavaScript, or Mathematica — that no fuzzy
 * tier can bridge. Keys are lowercase. A curated suggestion is returned only
 * when its target operator is actually visible in the current scope chain.
 */
const CURATED_SYNONYMS: Record<string, string> = {
  split: 'StringSplit',
  push: 'Append',
  ceiling: 'Ceil',
  // JavaScript Array method names.
  some: 'Any',
  every: 'All',
  // Wolfram Language names. These are SUGGESTIONS, not aliases: the operator
  // they point at is the right neighborhood, but the call shape often differs
  // (`Accumulate[xs]` vs `Scan(xs, Add)`). The namespace stays Epsil-native.
  total: 'Sum',
  select: 'Filter',
  cases: 'Filter',
  memberq: 'Contains',
  accumulate: 'Scan',
  randomreal: 'Random',
  randominteger: 'Random',
  nest: 'Iterate',
  nestlist: 'Iterate',
};

export function suggestOperatorName(
  ce: IComputeEngine,
  name: string
): string | undefined {
  if (!name) return undefined;

  const pool = operatorNamePool(ce);
  const lower = name.toLowerCase();

  // Tier 0: curated cross-language synonyms.
  const curated = CURATED_SYNONYMS[lower];
  if (curated !== undefined && curated !== name && pool.includes(curated))
    return curated;

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

  // State event: `shadowsCallable` must be captured BEFORE the placeholder
  // install below, while the chain still shows any shadowed binding — and
  // resolved through the TARGET scope's chain, not the engine's current
  // lexical scope (an explicit `scope` argument may differ).
  const shadowsCallable = defIsCallableShaped(lookup(name, scope));

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

  ce._noteStateEvent({
    kind: 'declare',
    callable: defIsCallableShaped(boxedDef),
    shadowsCallable,
  });
  ce._anyVersion += 1;

  return boxedDef;
}

export function declareSymbolOperator(
  ce: IComputeEngine,
  name: string,
  def: OperatorDefinition,
  scope?: Scope
): BoxedDefinition {
  scope ??= ce.context.lexicalScope;
  // State event: capture the shadow BEFORE the placeholder install, through
  // the TARGET scope's chain.
  const shadowsCallable = defIsCallableShaped(lookup(name, scope));
  // Insert a placeholder in the bindings to handle recursive calls
  // (the function is not yet defined)
  scope.bindings.set(name, {
    value: new _BoxedValueDefinition(ce, name, { type: 'function' }),
  });

  const boxedDef = scope.bindings.get(name)!;
  updateDef(ce, name, boxedDef, def);

  ce._noteStateEvent({ kind: 'declare', callable: true, shadowsCallable });
  ce._anyVersion += 1;

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
    // State event: emitted by the value SETTER below (`value-write`); the
    // extra G bump on the next line is the enumerated double-bump collapse
    // of the parity gate (design §8) — advancement-invisible, no second
    // event.
    def.value.value = value;
    ce._anyVersion += 1;
    // The declared-signature reconciliation paths (§6.3) store a `Function`
    // literal through here rather than through `updateDef`, so this is where a
    // function-typed value definition joins the forward-reference mechanism:
    // its own body may carry a provisional reading (register it), and `id`
    // becoming callable re-derives every body that read `id` as a
    // multiplication operand (`boxed-expression/provisional-application.ts`).
    if (def.value.type.matches('function')) {
      registerProvisionalDependents(ce, value, def.value);
      // `def.value` is what was just installed for `id`: a recursive literal
      // waits on its own name, and must not be re-derived against itself.
      repairProvisionalDependents(ce, id, def.value);
    }
    return;
  }

  // Operator definition: cannot set a plain value on an operator symbol
  throw new Error(`Cannot assign a value to operator symbol "${id}"`);
}

/**
 * A2 — normalize the `typeParams` option of `ce.declareType()` into
 * {@link TypeParameter}s. Throws (before ANY mutation) on a malformed clause.
 *
 * Both spellings the option admits go through the SHARED clause parser: a
 * string is clause TEXT (`'T'`, `'T, U: number'`, or one entry of an array),
 * and an object is a pre-built `{ name, bound? }` whose bound may be a type
 * string. Names are checked for validity, reservation and duplication across
 * the whole list.
 */
function normalizeDeclaredTypeParams(
  ce: IComputeEngine,
  typeName: string,
  option: TypeParamsOption
): TypeParameter[] {
  const entries = typeof option === 'string' ? [option] : option;
  const params: TypeParameter[] = [];
  const seen = new Set<string>();

  const push = (p: TypeParameter): void => {
    if (!isValidTypeName(p.name) || isReservedTypeName(p.name))
      throw new TypeVariableError(
        isReservedTypeName(p.name)
          ? 'reserved-type-name'
          : 'unsupported-variable-position',
        `The type parameter name "${p.name}" of "${typeName}" is invalid`
      );
    if (seen.has(p.name))
      throw new TypeVariableError(
        'unsupported-variable-position',
        `The type variable \`${p.name}\` is declared more than once in the clause of "${typeName}"`
      );
    seen.add(p.name);
    params.push(p);
  };

  for (const entry of entries) {
    if (typeof entry === 'string') {
      const parsed = parseTypeParameterClause(entry, ce._typeResolver);
      if ('error' in parsed)
        throw new TypeVariableError(
          parsed.error.code === 'reserved-name'
            ? 'reserved-type-name'
            : 'unsupported-variable-position',
          `Invalid type parameter clause for "${typeName}": ${parsed.error.message}`
        );
      for (const p of parsed.params) push(p);
      continue;
    }
    const bound =
      entry.bound === undefined
        ? undefined
        : parseType(entry.bound as Type | TypeString, ce._typeResolver);
    if (bound !== undefined && hasFreeTypeVariables(bound))
      throw new TypeVariableError(
        'unsupported-variable-position',
        `The bound of the type variable \`${entry.name}\` must be a ground type`
      );
    const param: TypeParameter = { name: entry.name };
    if (bound !== undefined) param.bound = bound;
    if (entry.variance !== undefined) param.variance = entry.variance;
    push(param);
  }

  if (params.length === 0)
    throw new TypeVariableError(
      'unsupported-variable-position',
      `The type parameter clause of "${typeName}" is empty`
    );

  return params;
}

export function declareType(
  ce: IComputeEngine,
  name: string,
  type: BoxedType | Type | TypeString,
  {
    alias,
    fromStatement,
    mint,
    typeParams,
  }: {
    alias?: boolean;
    fromStatement?: boolean;
    mint?: boolean;
    typeParams?: TypeParamsOption;
  } = {}
): void {
  // `forall` is a reserved word in type strings (the quantifier clause), so it
  // cannot also name a type.
  if (isReservedTypeName(name))
    throw new TypeVariableError(
      'reserved-type-name',
      `The type name "${name}" is reserved`
    );

  if (!isValidTypeName(name)) throw Error(`The type name "${name}" is invalid`);

  // The generic clause is validated FIRST — before any namespace is touched —
  // so a malformed one leaves both halves exactly as they were.
  const params =
    typeParams === undefined
      ? undefined
      : normalizeDeclaredTypeParams(ce, name, typeParams);

  // Variance is a property of a NOMINAL declaration: it relates two
  // applications of an opaque type. A transparent alias has no such relation
  // to declare — an applied alias IS its expansion — so a marker there is
  // rejected rather than silently ignored (parameterized-nominal design §2).
  if (params !== undefined && alias === true) {
    const marked = params.find((p) => p.variance !== undefined);
    if (marked !== undefined)
      throw new TypeVariableError(
        'unsupported-variable-position',
        `The type parameter \`${marked.name}\` of the ALIAS "${name}" cannot declare a variance: an alias is transparent, so its applications are expanded rather than related`
      );
  }

  // A type declaration claims BOTH namespaces: the type record, and a
  // value-level constructor of the same name (nominal-types design §4.1/D5).
  // Minting is unconditional per the design — including for the engine's own
  // bootstrap declarations, which therefore put `limits(…)`/`distribution(…)`
  // in the system scope. `mint: false` is an INTERNAL escape hatch kept for a
  // declaration that must not claim the value name; no caller uses it today.
  mint ??= true;

  // Is the type already defined? Types live in the ENGINE-LEVEL registry —
  // one namespace per engine, not lexically scoped
  // (`docs/plans/2026-08-10-global-type-registry.md`).
  //
  // The VALUE half splits across two scopes:
  //
  // - The D5 collision PRE-CHECK consults the GLOBAL scope: that is where the
  //   binding an engine-wide name claim actually collides with lives. The
  //   Epsil static pre-pass canonicalizes top-level statements inside a
  //   pushed frame, and checking THAT frame's (empty) bindings would miss a
  //   genuine collision during the canonical pass while the registry half
  //   went through — breaking D5's all-or-nothing contract across the two
  //   passes. (Bootstrap declarations run before the global frame exists and
  //   fall back to the current, system, scope.)
  //
  // - The MINT targets the GLOBAL scope too — the constructor's lifetime is
  //   the type's (§3.2): a host `declareType()` under a `pushScope()` must
  //   not leave a permanently-registered type stranded without its
  //   constructor when the scope pops. The ONE exception is the static
  //   pre-pass surrogate frame (depth-guarded, unforgeable): there the mint
  //   goes to the transient frame — visible to the rest of the pre-pass,
  //   discarded with it (the registry half is rolled back by the pre-pass's
  //   registry transaction, so the two halves stay in sync).
  const surrogate =
    ce._staticTypeCheckDepth > 0 && ce.context.name === 'epsil:static-check';
  const checkScope =
    ce._evalContextStack[1]?.lexicalScope ?? ce.context.lexicalScope;
  const scope = surrogate ? ce.context.lexicalScope : checkScope;
  const registry = ce._typeRegistry;
  const existing = registry[name];

  // An UNRESOLVED FORWARD REFERENCE is a promise to declare, not a conflict:
  // `type json_array` inside an earlier body made `resolver.forward()` install
  // an empty record, and every type mentioning the name captured THAT object.
  // This declaration fulfills it — IN PLACE, so those captures see the
  // definition (a fresh record would leave them pointing at the empty one, and
  // mutual recursion could never close). A record with a `def` is a completed
  // declaration and still conflicts; only the empty promise is fulfillable.
  const fulfillsForwardRef =
    existing !== undefined && existing.def === undefined;

  // A forward reference is created by USE, so its arity is known only from the
  // uses that created it: each one recorded how many arguments it applied
  // (`type forest` records 0, `type forest<T>` records 1). This declaration
  // must agree with every one of them — a mismatch would leave those types
  // holding an application at the wrong arity, which matches nothing
  // (`list<type Gen>` then matched `list<tuple<integer, integer>>` as
  // `false`). Reject instead, leaving the placeholder untouched for a
  // well-formed declaration later (design §4.2).
  if (fulfillsForwardRef) {
    const declaredArity = params?.length ?? 0;
    const used = forwardArities(existing!);
    const mismatch =
      used === undefined
        ? undefined
        : [...used].find((n) => n !== declaredArity);
    if (mismatch !== undefined)
      throw new TypeVariableError(
        'generic-alias-arity',
        `The type "${name}" is declared with ${declaredArity} type parameter${declaredArity === 1 ? '' : 's'}, but an earlier forward reference applies it to ${mismatch} type argument${mismatch === 1 ? '' : 's'}`
      );
  }

  if (existing && !fulfillsForwardRef) {
    // A record this scope created from a `DeclareType` statement (marked
    // `_declaredByStatement`, mirroring the `Declare` operator handler) is
    // ours to replace: the same program may be canonicalized then evaluated,
    // or re-run in a notebook with an edited definition. Any other conflict
    // (a host `ce.declareType()`, a builtin) still throws.
    if (
      !fromStatement ||
      (existing as { _declaredByStatement?: boolean })._declaredByStatement !==
        true
    )
      throw Error(`The type "${name}" is already defined`);
  }

  // A statement replacement UPDATES THE RECORD IN PLACE, for the same reason a
  // forward-reference fulfilment does: every type that mentions the name — and
  // every applied reference `box<integer>` already built — captured THIS
  // object, and an applied reference additionally holds it through a hard
  // `decl` back-pointer (`common/type/reference.ts`). Swapping in a fresh
  // record left those captures answering from the OLD definition: a node
  // parsed before the redeclaration and one parsed after gave different
  // subtyping verdicts for the same pair of types, and a mutually recursive
  // set needed a THIRD notebook run to converge. The definition is the
  // record's, so replacing the definition means writing the record.
  const replacesInPlace = existing !== undefined && !fulfillsForwardRef;

  // D5, atomicity: the value half is checked BEFORE anything is mutated, so a
  // collision leaves neither namespace touched — not the existing type record,
  // not the recursion placeholder below. An outer-scope binding is shadowed,
  // not conflicted; an inferred (valueless, auto-declared) binding upgrades; a
  // constructor we minted earlier is ours to replace.
  // A GENERIC ALIAS mints nothing (`deriveConstructorSignature` declines a
  // parameterized body, D4b), so it makes no claim on the value namespace and
  // must not be pre-checked against one: `function Duo(x) {…}` followed by
  // `type alias Duo<T> = tuple<T, T>` is legal. (A plain→generic replacement
  // still drops the constructor the plain form minted — `mintTypeConstructor`
  // calls `removeMintedTypeConstructor` before deriving.)
  // A parameterized NOMINAL type is the opposite: it mints a `forall`-quantified
  // constructor (design §5), so it does claim the value name. `alias` is not
  // yet defaulted here, so `!== true` reads "nominal".
  if (mint && (params === undefined || alias !== true))
    checkTypeConstructorNamespace(checkScope, name);

  alias ??= false; // Nominal by default

  // The state a failing replacement must put back. Unlike a forward-reference
  // fulfilment — whose rollback CLEARS the record back to an unfulfilled
  // promise — a replacement rolls back onto a type that was already working,
  // so every field it overwrites is snapshotted first. (`_declaredByStatement`
  // is in the snapshot even though the guard above proved it `true`: the
  // restore then states the whole prior record rather than re-deriving it.)
  const prior = replacesInPlace
    ? {
        def: existing!.def,
        alias: existing!.alias,
        typeParams: existing!.typeParams,
        varianceState: existing!._varianceState,
        varianceBlockedOn: existing!._varianceBlockedOn,
        declaredByStatement: (existing as { _declaredByStatement?: boolean })
          ._declaredByStatement,
      }
    : undefined;

  // First, add a placeholder record to allow recursive types. Fulfilling a
  // forward reference — or replacing a statement-declared type — REUSES the
  // record already in the scope (same object, now carrying this declaration's
  // `alias`), so the types that captured it resolve through to the definition
  // set below. Re-opening it as a placeholder (no `def`, no verified variance)
  // is what makes the body parse below behave exactly as it does for a first
  // declaration: a generic type that applies itself is detected as
  // `generic-alias-self-reference`, and the recursive occurrence in the new
  // body binds to this record rather than to the old definition.
  if (fulfillsForwardRef || replacesInPlace) {
    existing!.alias = alias;
    existing!.def = undefined;
    delete existing!.typeParams;
    delete existing!._varianceState;
    delete existing!._varianceBlockedOn;
  } else registry[name] = { kind: 'reference', name, alias, def: undefined };
  // The clause goes on the placeholder, BEFORE the body parses: a generic
  // alias that applies itself is then detected unambiguously (the record has
  // `typeParams` and no `def` yet) as `generic-alias-self-reference`.
  if (params !== undefined) registry[name].typeParams = params;
  if (fromStatement)
    (
      registry[name] as { _declaredByStatement?: boolean }
    )._declaredByStatement = true;

  /** Undo the placeholder: a declaration that failed declares nothing. */
  const rollbackTypeHalf = (): void => {
    if (prior !== undefined) {
      // A replacement restores the record's PREVIOUS definition, field by
      // field. Clearing it (the forward-reference behaviour below) would leave
      // a type that worked a moment ago undefined — and, since the record is
      // shared, would break every type that mentions it too.
      existing!.alias = prior.alias;
      existing!.def = prior.def;
      if (prior.typeParams === undefined) delete existing!.typeParams;
      else existing!.typeParams = prior.typeParams;
      if (prior.varianceState === undefined) delete existing!._varianceState;
      else existing!._varianceState = prior.varianceState;
      if (prior.varianceBlockedOn === undefined)
        delete existing!._varianceBlockedOn;
      else existing!._varianceBlockedOn = prior.varianceBlockedOn;
      if (prior.declaredByStatement === undefined)
        delete (existing as { _declaredByStatement?: boolean })
          ._declaredByStatement;
      else
        (existing as { _declaredByStatement?: boolean })._declaredByStatement =
          prior.declaredByStatement;
      return;
    }
    if (fulfillsForwardRef) {
      // The record is the forward reference's own; restoring it means putting
      // it back to the unfulfilled state, not removing it — the types holding
      // it stay as they were, still waiting for a declaration.
      existing!.alias = false;
      existing!.def = undefined;
      delete existing!.typeParams;
      // The variance verification state belongs to the DECLARATION this
      // handler was making. Left behind on the re-opened promise it would let
      // a subtype judgment read the (now absent) parameters as verified.
      delete existing!._varianceState;
      delete existing!._varianceBlockedOn;
      // `_declaredByStatement` was set on this very record before the body
      // parsed. Leaving it behind would mark a still-unfulfilled promise as
      // statement-created, and the redeclaration guard above keys on exactly
      // that flag — so a later `fromStatement` declaration would silently
      // replace a type this handler never declared.
      delete (existing as { _declaredByStatement?: boolean })
        ._declaredByStatement;
      return;
    }
    // A first declaration: the placeholder is this handler's own, so undoing it
    // is removing it. (Every case with an `existing` record is handled above —
    // both reuse it in place.)
    delete registry[name];
  };

  // Parse the type (which may reference itself). If it is malformed, leave
  // the scope as it was: a placeholder with no `def` is a dangling reference
  // that later resolves to a broken type.
  let def: Type;
  try {
    def =
      type instanceof BoxedType
        ? type.type
        : typeof type === 'string'
          ? // A2 — the clause is PRE-SEEDED into the body parse, so `T` reads
            // as a type variable rather than as an unknown type name.
            parseType(type, ce._typeResolver, params)
          : type;
  } catch (e) {
    rollbackTypeHalf();
    throw e;
  }

  // A body that is NOTHING BUT an application of the type being declared
  // (`type r<T> = r<T>`) defines nothing at all: erasure resolves the reference
  // to itself forever, and two such applications relate by a variance no body
  // ever justified. The generic-ALIAS form of this is caught while the body
  // parses (`generic-alias-self-reference`, `type-builder.ts`); a nominal body
  // reaches that site legitimately, because a recursive occurrence is exactly
  // what makes the feature work — so the vacuous case is recognized HERE, where
  // "top level of the body" is knowable. Recursion UNDER structure stays legal.
  if (
    alias !== true &&
    typeof def === 'object' &&
    def.kind === 'reference' &&
    def.args !== undefined &&
    declarationOf(def) === registry[name]
  ) {
    rollbackTypeHalf();
    throw new TypeVariableError(
      'generic-alias-self-reference',
      `The definition of the nominal type "${name}" cannot be just an application of itself: a recursive occurrence must appear under some structure (a tuple field, \`list<${name}<…>>\`, …)`
    );
  }

  // A phantom parameter is meaningless under either reading: transparently
  // `Tagged<integer>` and `Tagged<string>` are the same type, and opaquely
  // they are indistinguishable yet unequal. Rejected like the signature rule's
  // unused quantified variable.
  //
  // Hook A (design §4.2/§4.4): a parameterized NOMINAL type also has its
  // declared variance — the written marker, or the `out` a missing one
  // declares — VERIFIED against the body, and the same walk answers the
  // unused-parameter question, so the two checks are one call. It runs AFTER
  // the body parse returns (`parseType` prefixes "Failed to parse type" onto
  // anything thrown inside it) and BEFORE the definition feeds the mint block,
  // so a violating declaration never mints.
  if (params !== undefined && alias !== true) {
    const verdict = verifyVariance(name, params, def);
    if (verdict.status === 'violation') {
      rollbackTypeHalf();
      throw new TypeVariableError(verdict.code, verdict.message);
    }
    const record = registry[name];
    if (verdict.status === 'deferred') {
      record._varianceState = 'deferred';
      record._varianceBlockedOn = verdict.blockedOn;
    } else {
      record._varianceState = 'verified';
      delete record._varianceBlockedOn;
    }
  } else if (params !== undefined) {
    const free = freeTypeVariables(def);
    const unused = params.filter((p) => !free.has(p.name));
    if (unused.length > 0) {
      rollbackTypeHalf();
      throw new TypeVariableError(
        'generic-alias-unused-parameter',
        `The type parameter${unused.length === 1 ? '' : 's'} \`${unused
          .map((p) => p.name)
          .join('`, `')}\` of "${name}" ${
          unused.length === 1 ? 'is' : 'are'
        } never used in its definition`
      );
    }
  }

  // Adjust the definition (the type references in the type will point to
  // the placeholder record)
  registry[name].def = def;

  // Hook B: this declaration may have fulfilled the forward reference a
  // provisionally-accepted one was waiting on. Verify every group that has
  // become complete, to a fixpoint.
  //
  // A REPLACEMENT additionally re-verifies the types that already mention this
  // record. They follow the new definition (the record is theirs too), so a
  // redeclaration that changes this type's variance can invalidate a
  // dependent's own declared variance — and that dependent, not this
  // declaration, is where the contradiction lives. Such a verdict fails THIS
  // statement, which rolls back, leaving the dependent as it was.
  let settled: TypeReference[];
  try {
    // Value-level dependents are gathered from the CURRENT frame's chain
    // (which contains `scope`), so a transient frame's own declarations are
    // covered too.
    settled = settleVarianceGroup(
      ce,
      ce.context.lexicalScope,
      name,
      replacesInPlace ? existing : undefined
    );
  } catch (e) {
    rollbackTypeHalf();
    throw e;
  }

  // Mint the value-level constructor (§4.1, D4/D4b/D10). If it cannot be
  // declared, roll BOTH halves back: the registration is atomic across the two
  // namespaces. The value half needs its own snapshot because minting is not
  // atomic internally — it drops a previously minted constructor first, then
  // `ce.declare()` installs a placeholder binding BEFORE `updateDef()` builds
  // the real definition, and that construction can throw. Without the restore
  // a failure leaves the old constructor gone and a dead placeholder bound.
  if (mint) {
    const existingBinding = scope.bindings.get(name);
    try {
      // `mintTypeConstructor` installs through `ce.declare()`, which targets
      // the CURRENT frame — enter `scope` when they differ (a host
      // `declareType()` under a pushed scope) so the constructor lands next
      // to the binding the D5 check consulted.
      if (scope === ce.context.lexicalScope)
        mintTypeConstructor(ce, scope, name, registry[name], def);
      else
        ce._inScope(scope, () =>
          mintTypeConstructor(ce, scope, name, registry[name], def)
        );
    } catch (e) {
      rollbackTypeHalf();
      if (existingBinding !== undefined)
        scope.bindings.set(name, existingBinding);
      else scope.bindings.delete(name);
      throw e;
    }

    // A declaration that minted NO constructor (a record body, a generic
    // alias — or a REPLACEMENT to one, which removed the previous local
    // constructor) may still have a minted constructor for the name visible
    // in an OUTER scope: under the pre-pass surrogate, the previous run's
    // constructor lives in the global scope while this replacement operates
    // on the transient frame. Left visible, the rest of the pre-pass would
    // canonicalize calls against a constructor that real evaluation removes
    // (a spurious arity diagnostic, or a silently-validated call). Mask it
    // with an inert value shell in the mint scope, so the pass sees the same
    // value namespace real execution will.
    if (!isMintedConstructor(scope.bindings.get(name))) {
      let outer = scope.parent;
      let inherited = false;
      while (outer !== null && outer !== undefined && !inherited) {
        if (isMintedConstructor(outer.bindings.get(name))) inherited = true;
        outer = outer.parent;
      }
      if (inherited && !scope.bindings.has(name))
        ce._declareSymbolValue(
          name,
          { type: 'unknown', inferred: true },
          scope
        );
    }
  }

  // A5 — replacing a type record is a context change: bump the generation so
  // the caches keyed on it (and every expression boxed AFTER this point) see
  // the new definition. Expressions already boxed keep the type they computed,
  // exactly as a value redeclaration leaves them.
  // A variance flip from provisional (`inout`-conservative) to verified is the
  // same kind of change — it widens the answers subtyping gives. In practice it
  // only ever happens on a declaration that fulfils a forward reference, so
  // `existing` is already truthy; the second disjunct is there so a future
  // unblocking route cannot silently skip the bump.
  if (existing || settled.length > 0) {
    // State event: a type redefinition (G+M+E today) — `config`-class for
    // the parity dispatch, like the type-statement rollback in `index.ts`.
    // Both rows are recorded in the design's §2 table (2b addenda).
    ce._noteStateEvent({ kind: 'config' });
    ce._anyVersion += 1;
    // A type REDEFINITION (statement replace, forward-ref fulfillment,
    // variance settle) changes the answers subtyping gives — a
    // global-semantics event on all three axes ('operator/type redefinition'
    // in `_worldVersion`'s contract). A FRESH declaration deliberately bumps
    // none of these beyond what `ce.declare()` did for the constructor half.
    ce._semanticVersion += 1;
    ce._worldVersion += 1;
    // Shadow 'callable' axis (CE_CACHE_STATS probe): variance settle is a
    // binding-repair event in its predicate.
    if (CACHE_STATS) bumpShadowCallable();
  }
}

/**
 * Every mention of the declaration record `target` in `body` — `undefined` when
 * it is not mentioned at all. A BARE reference is an application at arity ZERO,
 * exactly as it is for a forward reference (`forwardArities`): it is what makes
 * a plain → generic re-declaration a mismatch (N7).
 *
 * STRUCTURAL walk: an applied reference is compared by the identity of its
 * declaration record (`declarationOf`, the `decl` back-pointer) and descended
 * into through its ARGUMENTS only — never through `def`. That is both the
 * cycle guard a recursive nominal needs (`type tree<T> = tuple<T,
 * list<tree<T>>>` closes its loop through `def`) and the right question:
 * mentioning a type is a property of the body as written, not of what the
 * mentioned type expands to. The visited set covers shared sub-structure.
 */
function mentionsOf(
  body: Type,
  target: TypeReference
): TypeReference[] | undefined {
  const seen = new Set<object>();
  let mentions: TypeReference[] | undefined;
  const visit = (t: Type | undefined): void => {
    if (t === undefined || typeof t !== 'object') return;
    if (seen.has(t)) return;
    seen.add(t);
    switch (t.kind) {
      case 'reference':
        if (declarationOf(t) === target) (mentions ??= []).push(t);
        (t.args ?? []).forEach(visit);
        return;
      case 'signature':
        (t.args ?? []).forEach((a) => visit(a.type));
        (t.optArgs ?? []).forEach((a) => visit(a.type));
        if (t.variadicArg !== undefined) visit(t.variadicArg.type);
        visit(t.result);
        return;
      // The contextual-callback wrapper (Design D §4) is transparent to this
      // walk: a reference occurring ONLY inside `callback<S>` is still a
      // mention of the target, and a re-declaration that invalidates it must
      // be caught here (clause 4 — the constructor retains what it wraps).
      case 'callback':
        visit(t.signature);
        return;
      case 'union':
      case 'intersection':
        t.types.forEach(visit);
        return;
      case 'negation':
        visit(t.type);
        return;
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        visit(t.elements);
        return;
      case 'dictionary':
        visit(t.values);
        return;
      case 'tuple':
        t.elements.forEach((el) => visit(el.type));
        return;
      case 'record':
        Object.values(t.elements).forEach(visit);
        return;
      default:
        return;
    }
  };
  visit(body);
  return mentions;
}

/**
 * Ruling C, fulfilment half: re-verify every provisionally-accepted declaration
 * in scope whose blocking forward references have since gained definitions,
 * until no further record settles.
 *
 * This terminates without a least-fixed-point search because no member's
 * variance is being SOLVED — each is verified against its own declared (or
 * default) variance, and a reference with a known definition composes with the
 * variance that declaration states. A mutually recursive pair therefore settles
 * in at most two passes.
 *
 * A late violation throws: the failing OPERATION is the fulfilling declaration
 * (which rolls back atomically, as any failing declaration does), while the
 * message is ATTRIBUTED to the original declaration and names the trigger. Any
 * record this pass already flipped is put back, so the throw leaves the scope
 * exactly as it found it.
 *
 * `replaced` is the record a statement re-declaration has just UPDATED IN
 * PLACE. Its dependents keep pointing at it, so they now read the new
 * declaration — its clause and its variance both — and every one that mentions
 * it is checked against it again: the ARITY of each mention against the new
 * type-parameter count, each argument against the new BOUNDS, and (for an
 * already-verified parameterized nominal) its own declared variance against the
 * new body. Dependents are both TYPE-level (the scope chain's type records) and
 * VALUE-level (its declared symbol types and operator signatures). That pass
 * changes no state: a dependent either still checks out (nothing to record) or
 * fails, which throws and so fails the redeclaration.
 */
function settleVarianceGroup(
  ce: IComputeEngine,
  scope: Scope,
  justDeclared: string,
  replaced?: TypeReference
): TypeReference[] {
  const flipped: TypeReference[] = [];
  const wasBlockedOn = new Map<TypeReference, string[] | undefined>();
  const undo = (): void => {
    for (const r of flipped) {
      r._varianceState = 'deferred';
      r._varianceBlockedOn = wasBlockedOn.get(r);
    }
  };

  // The dependent re-verification runs FIRST, before anything is flipped, so a
  // violation needs no undo. Deferred dependents are left to the variance
  // fixpoint below — they are re-verified there anyway, and only there can they
  // settle.
  if (replaced !== undefined) {
    const params = replaced.typeParams;
    const declaredArity = params?.length ?? 0;

    /**
     * Re-check every mention of the replaced record in `body` against the NEW
     * declaration. `subject` names the dependent in the diagnostic ("the
     * definition of \"holder\"", "the signature of \"f\""), `ownParams` is the
     * dependent's own generic clause, used to read an OPEN argument as its
     * declared bound exactly as A7's admission rule does at build time.
     */
    const recheckMentions = (
      body: Type,
      subject: string,
      ownParams: readonly TypeParameter[] | undefined
    ): void => {
      const mentions = mentionsOf(body, replaced);
      if (mentions === undefined) return;

      // ARITY first: a dependent that applies the replaced type at the old
      // arity holds an application that matches nothing, whatever anything
      // else says. Checked for EVERY dependent, alias or nominal, type-level or
      // value-level — arity is a property of the application, not of the
      // subtyping contract. Covers all three directions a clause edit can take:
      // a changed parameter count, generic → plain (`declaredArity` 0 against
      // applied uses) and plain → generic (a bare mention is arity 0, N7).
      for (const mention of mentions) {
        const arity = mention.args?.length ?? 0;
        if (arity !== declaredArity)
          throw new TypeVariableError(
            'generic-alias-arity',
            `${subject} applies "${replaced.name}" to ${arity} type argument${
              arity === 1 ? '' : 's'
            }, but "${replaced.name}" is now declared with ${declaredArity} type parameter${
              declaredArity === 1 ? '' : 's'
            } (surfaced when \`${justDeclared}\` was declared)`
          );
      }

      // BOUNDS: the arities now agree, so each argument is re-admitted against
      // the parameter it fills. A redeclaration that ADDS a bound
      // (`box<T>` → `box<T: integer>`) leaves every existing `box<string>`
      // behind it otherwise.
      if (params === undefined) return;
      for (const mention of mentions) {
        for (let i = 0; i < params.length; i++) {
          const bound = params[i].bound;
          if (bound === undefined) continue;
          const arg = mention.args![i];
          const free = freeTypeVariables(arg);
          let subjectArg = arg;
          if (free.size > 0) {
            const bindings: Record<string, Type> = Object.create(null);
            for (const v of free)
              bindings[v] =
                ownParams?.find((p) => p.name === v)?.bound ?? 'any';
            subjectArg = substituteTypeVariables(arg, bindings);
          }
          if (satisfiesTypeBound(subjectArg, bound)) continue;
          throw new TypeVariableError(
            'generic-alias-bound',
            `${subject} applies "${replaced.name}" to the type argument \`${typeToString(
              arg
            )}\`, which does not satisfy the bound \`${typeToString(bound)}\` of the parameter \`${
              params[i].name
            }\` of "${replaced.name}" (surfaced when \`${justDeclared}\` was declared)`
          );
        }
      }
    };

    // TYPE-level dependents come from the engine registry — one namespace,
    // no chain to walk.
    for (const record of Object.values(ce._typeRegistry)) {
      if (record === replaced || record.def === undefined) continue;
      recheckMentions(
        record.def,
        `The definition of "${record.name}"`,
        record.typeParams
      );

      // VARIANCE: only a parameterized nominal has one to re-verify, and a
      // still-deferred one belongs to the fixpoint below.
      if (record._varianceState !== 'verified') continue;
      if (record.typeParams === undefined) continue;
      const verdict = verifyVariance(
        record.name,
        record.typeParams,
        record.def,
        { triggeredBy: justDeclared }
      );
      if (verdict.status === 'violation')
        throw new TypeVariableError(verdict.code, verdict.message);
    }

    for (let s: Scope | null | undefined = scope; s; s = s.parent) {
      // VALUE-level dependents. A declared symbol type or operator signature
      // that mentions the record is broken by exactly the edits that break a
      // type dependent — after `type Foo<T>` replaces `type Foo`, a declared
      // `f: (Foo) -> integer` holds a bare application of a generic type, which
      // matches nothing, so `f` is uncallable with no diagnostic anywhere.
      //
      // Only DECLARED types are judged: an inferred one is the engine's own
      // running guess and is re-derived from use, not stated by an author.
      // Minted constructors are skipped too — they are derived from the type
      // records checked just above and are re-minted by the declaration running
      // right now, so within this window they are stale BY CONSTRUCTION (the
      // redeclared type's own constructor still carries the old clause).
      //
      // Out of scope, deliberately: types held by expressions that are already
      // boxed (design A5 — they keep the type they computed, exactly as a value
      // redeclaration leaves them), and CHILD scopes, which are unreachable
      // from here and, being popped by the time a later statement redeclares,
      // hold nothing a program can still use.
      for (const [bindingName, binding] of s.bindings) {
        if (isMintedConstructor(binding)) continue;
        let boxed: BoxedType | undefined;
        if (isOperatorDef(binding)) {
          if (binding.operator.inferredSignature) continue;
          boxed = binding.operator.signature;
        } else if (isValueDef(binding)) {
          if (binding.value.inferredType) continue;
          boxed = binding.value.type;
        } else continue;

        // A definition whose type cannot even be resolved is not a dependent
        // this pass can judge; leave it to whatever already reports it.
        let declared: Type;
        try {
          declared = boxed.type;
        } catch {
          continue;
        }
        const signature =
          typeof declared === 'object' && declared.kind === 'signature'
            ? declared
            : undefined;
        recheckMentions(
          declared,
          `The ${signature ? 'signature' : 'declared type'} of "${bindingName}"`,
          signature?.typeParams
        );
      }
    }
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const record of Object.values(ce._typeRegistry)) {
      if (record._varianceState !== 'deferred') continue;
      if (record.typeParams === undefined || record.def === undefined) continue;
      let verdict: VarianceResult;
      try {
        verdict = verifyVariance(record.name, record.typeParams, record.def, {
          triggeredBy: justDeclared,
        });
      } catch (e) {
        undo();
        throw e;
      }
      if (verdict.status === 'violation') {
        undo();
        throw new TypeVariableError(verdict.code, verdict.message);
      }
      if (verdict.status === 'deferred') {
        record._varianceBlockedOn = verdict.blockedOn;
        continue;
      }
      wasBlockedOn.set(record, record._varianceBlockedOn);
      record._varianceState = 'verified';
      delete record._varianceBlockedOn;
      flipped.push(record);
      progressed = true;
    }
  }
  return flipped;
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
    // Effects-axis provenance (`docs/EFFECTS-MODEL.md`, "Annotation
    // provenance"): the statement lives in the TYPE — a non-empty specifier,
    // or `pure`, which builds the stated-empty `effects: []`. A bare slot
    // leaves effects on the inferred track. An explicit `effectsDeclared` on
    // the incoming definition wins.
    const effectsDeclared =
      def.effectsDeclared ?? declaredTypeStatesEffects(ce, def.type);

    let valueDef: Partial<ValueDefinition> = effectsDeclared
      ? { ...def, effectsDeclared }
      : def;
    if (
      def.type !== undefined &&
      isFunction(def.value as Expression | undefined, 'Function')
    ) {
      const declaredType =
        def.type instanceof BoxedType ? def.type.type : parseType(def.type);
      if (hasFunctionSignature(declaredType)) {
        // G11 (§2.4) — see the assign path. Checked FIRST, ahead of the
        // arity/effects assertions: an overload set with a generic arm is not
        // a shape one erased body can implement, so an arity diagnostic for it
        // would name the wrong problem. A SINGLE generic signature proceeds
        // through the ordinary reconciliation below, whose return step knows
        // not to ascribe a variable-mentioning result (§2.4).
        if (isPolymorphicType(declaredType))
          assertSingleArmPolytype(
            id,
            def.value as Expression,
            ce.type(declaredType)
          );
        // The literal must be arity-compatible with the declared signature
        // (mirrors the assign path); otherwise a declared-arity call would
        // silently partial-apply.
        assertFunctionLiteralArity(
          id,
          def.value as Expression,
          declaredType,
          ce.type(declaredType).toString()
        );
        const reconciled = reconcileFunctionLiteralReturn(
          ce,
          ascribeDeclaredParameterTypes(
            ce,
            def.value as Expression,
            declaredType
          ),
          declaredType
        );
        assertDeclaredEffects(id, reconciled, declaredType, effectsDeclared);
        valueDef = { ...valueDef, value: reconciled };
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
    const type = parseType(def as Type | TypeString, ce._typeResolver);
    if (!isValidType(type)) {
      throw Error(
        [
          `Invalid argument for "${id}"`,
          JSON.stringify(def, undefined, 4),
          `Use a type, a \`OperatorDefinition\` or a \`ValueDefinition\``,
        ].join('\n|   ')
      );
    }

    ce._declareSymbolValue(
      id,
      {
        type,
        effectsDeclared: signatureEffects(type) !== undefined,
      },
      scope
    );
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

  // §4.5b D13/D15: when `id` names a type in the CURRENT scope and its minted
  // constructor is bound, loosen the constructor's signature while the
  // assigned literal canonicalizes (both here in the knot-tying re-box and in
  // the recognition block below) — a self-call in a constructor-function body
  // must not validate against the strict pre-install signature. Restored
  // right after canonicalization; the install then replaces the definition.
  let restoreCtor: (() => void) | undefined = undefined;
  {
    const scope = ce.context.lexicalScope;
    if (
      ce._typeRegistry[id]?.def !== undefined &&
      arg2 !== null &&
      typeof arg2 === 'object'
    )
      restoreCtor = loosenMintedConstructor(ce, scope, id);
  }

  // Tie the recursion knot for a programmatic box-then-assign (mirroring the
  // `Assign` operator's canonicalization): when the assigned value is a
  // `Function` literal whose body references `id`, the literal may have been
  // canonicalized BEFORE `id` was known to be a function — its self-call is
  // then bound to a stale auto-declaration (an undeclared name types the
  // application `any`, a shell-declared one `unknown`), and every downstream
  // consumer of the body's types misfires (e.g. the compile targets'
  // collection guard fail-closes on the top-typed self-call). Pre-declare
  // `id` as function-typed, then re-canonicalize the literal from its JSON so
  // the self-reference binds and types against the real definition.
  const ctorScope = ce.context.lexicalScope;
  const ctorType = ce._typeRegistry[id];
  let ctorLiteral: Expression | undefined = undefined;
  try {
    if (arg2 !== null && typeof arg2 === 'object') {
      const boxedFn = isFunction(arg2 as Expression, 'Function')
        ? (arg2 as Expression)
        : undefined;
      const rawFn =
        boxedFn === undefined && Array.isArray(arg2) && arg2[0] === 'Function';
      if (
        (boxedFn || rawFn) &&
        JSON.stringify(boxedFn ? boxedFn.json : arg2).includes(`"${id}"`)
      ) {
        if (!ce.lookupDefinition(id)) ce.symbol(id);
        const selfDef = ce.lookupDefinition(id);
        if (selfDef && isValueDef(selfDef) && selfDef.value.inferredType)
          selfDef.value.type = ce.type('function');
        // Serialize WITH `sourceOffsets` (`.json` drops them): this re-box
        // otherwise erased every recursive function body's source positions,
        // which is what the debugger's body breakpoints map statements back
        // through. NOT `toMathJson()` — that is the display serializer, and
        // its function shorthand collapses the literal (dropping the
        // parameter list).
        if (boxedFn)
          arg2 = ce.box(jsonWithSourceOffsets(boxedFn)) as AssignValue;
      }
    }

    // §4.5b D13 (nominal-types design) — constructor-function recognition. A
    // function literal assigned to a name that the engine's type registry
    // declares as a NOMINAL type is that type's constructor
    // function: recognized here, at install time, so the Epsil `function`
    // statement and the box/host routes agree by construction. Ordering falls
    // out of execution order — at Assign time the type either is already
    // declared (→ constructor) or is not (→ plain function; a LATER
    // same-scope type declaration then hits the D5 collision against a real
    // definition). An ALIAS type's same-name function is an ordinary function
    // (§4.5): it installs no constructor, but it IS licensed to replace the
    // alias's minted identity constructor (the guard carve-out below).
    if (
      ctorType?.def !== undefined &&
      arg2 !== undefined &&
      arg2 !== null &&
      typeof arg2 !== 'function' &&
      typeof arg2 !== 'boolean'
    ) {
      // Only an EXPLICIT `Function` literal is a constructor declaration —
      // `canonicalFunctionLiteral` would wrap any expression as a thunk, and
      // `point := 5` must keep hitting the constructor-assignment guard.
      const expr2 = ce.expr(arg2);
      if (isFunction(expr2, 'Function'))
        ctorLiteral = canonicalFunctionLiteral(expr2);
    }
  } finally {
    // Canonicalization is done: put the strict definition back. A nominal
    // install below replaces it wholesale; every other path (alias plain
    // function, non-literal value, error) proceeds against the real
    // definition.
    restoreCtor?.();
  }

  const def = ce.lookupDefinition(id);

  if (ctorLiteral !== undefined && ctorType !== undefined && !ctorType.alias) {
    // Same eligibility as the type declaration's own namespace claim (D5): an
    // explicit non-constructor binding in this scope is a genuine conflict.
    checkTypeConstructorNamespace(ctorScope, id, 'constructor-function');
    installConstructorFunction(ce, ctorScope, id, ctorType, ctorLiteral);
    return ce;
  }

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
    hasFunctionSignature(def.value.type.type)
  ) {
    const literal = canonicalFunctionLiteral(ce.expr(arg2));
    if (literal !== undefined) {
      const declaredType = def.value.type;

      // A generic declaration DOES take a function-literal body (the
      // generic-literals milestone, §2.4): the literal installs under the
      // declared polytype and every call instantiates it. Two things still run
      // first. `canonicalFunctionLiteral` LIFTS non-literals (a function-typed
      // SYMBOL comes back as a literal), so discriminate on the ORIGINAL
      // operand: a symbol has no body to erase — it gets the honest D3
      // rejection (`Ground <: Poly` is false). And G11 rejects a generic
      // OVERLOAD SET, ahead of the arity/effects assertions below.
      if (declaredType.isPolymorphic) {
        const orig = ce.expr(arg2);
        if (isSymbol(orig)) throw declaredTypeError(id, orig, declaredType);
        assertSingleArmPolytype(id, literal, declaredType);
      }

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
        ascribeDeclaredParameterTypes(ce, literal, declaredType.type),
        declaredType.type
      );
      // The effects axis is judged by its own provenance: a bare specifier is
      // the INFERRED track (the body's effects are simply re-stamped on every
      // assignment), a stated one is a contract.
      const effectsDeclared = def.value.effectsDeclared;
      assertDeclaredEffects(id, reconciled, declaredType.type, effectsDeclared);
      if (
        !matchesDeclaredTypeAxes(
          ce,
          reconciled.type,
          declaredType,
          effectsDeclared,
          reconciled,
          id
        )
      )
        throw declaredTypeError(id, reconciled, declaredType);
      ce._setSymbolValue(id, reconciled);
      return ce;
    }
  }

  if (isOperatorDef(def)) {
    // A builtin operator — owned by the system scope — is never mutated in
    // place: it is shared engine-wide (e.g. `N` is injected into every
    // lazy-broadcast marker), so overwriting it would destroy the builtin
    // for every consumer. Instead the assignment SHADOWS: declare in the
    // current scope, exactly as if there were no prior definition. A bare
    // symbol then resolves to the assigned value while `lookupApplicable`
    // still reaches the builtin in operator position. In-place conversion
    // is preserved for user-defined operators (non-system scopes) and
    // during library bootstrap (current scope IS the system scope).
    const systemScope = ce.contextStack[0]?.lexicalScope;
    const shadowBuiltin =
      systemScope !== undefined &&
      systemScope.bindings.get(id) === def &&
      ce.context.lexicalScope !== systemScope;

    // A minted type constructor is one half of a type declaration's claim on
    // BOTH namespaces (nominal-types design, D5). Every branch below replaces
    // the inner operator definition wholesale — which drops the minted marker
    // — so an in-place assignment would leave the type still resolving with
    // nothing able to build a value of it. Refuse it, in the shape of the
    // constant-reassignment error: the host route throws, the `Assign`
    // operator route surfaces it as an `Error` value.
    // A SHADOWING assignment is fine: it binds a new name in the current
    // scope and leaves the declaration's own scope untouched.
    // Carve-outs (§4.5b D13): a NOMINAL constructor-function install returned
    // above before reaching here; an ALIAS type's same-name function literal
    // is an ordinary function that deliberately replaces the minted identity
    // constructor (the marker drops with the inner def — the binding stops
    // being ours, per §4.5).
    const aliasFunctionOverride =
      ctorLiteral !== undefined && ctorType?.alias === true;
    if (!shadowBuiltin && isMintedConstructor(def) && !aliasFunctionOverride)
      throw constructorAssignmentError(id, def.operator.signature);

    const value = assignValueAsValue(ce, arg2);
    if (value !== undefined) {
      if (shadowBuiltin) {
        ce._declareSymbolValue(id, { value });
        return ce;
      }
      // Allow converting an operator to a value.
      // Existing expressions using this symbol as a function head (e.g.
      // ["g", 2]) will produce a type error at evaluation time if the
      // new value is not callable — which is the correct semantic.
      // State event: callability LEAVES the binding (§2b). Zero-mask
      // `type-write` in the parity regime (this caller bumps nothing
      // directly; the G+M arrive via the `_setSymbolValue` value-write).
      const callableBefore = defIsCallableShaped(def);
      updateDef(ce, id, def, { value });
      ce._noteStateEvent({
        kind: 'type-write',
        callableBefore,
        callableAfter: defIsCallableShaped(def),
      });
      ce._setSymbolValue(id, value);
      return ce;
    }

    // Phase 3 §6.3 — declared-signature reconciliation (operator-slot). A
    // symbol declared with an EXPLICIT function signature and no built-in
    // evaluate handler — the object form `ce.declare(f, { signature: … })`, or
    // a symbol already carrying a reconciled user lambda — is authoritative
    // over its signature. Assigning a function literal to it must PRESERVE the
    // declared signature, exactly as the value-slot case above, instead of
    // replacing it with one inferred from the literal (which is what
    // `assignValueAsOperatorDef` + `updateDef` would otherwise do). This makes
    // the two documented declare spellings — string `"(…) -> …"` (value slot)
    // and object `{ signature: "(…) -> …" }` (operator slot) — equivalent under
    // declare-then-assign. Built-in / native operators (a defined `evaluate`
    // handler that is not a user lambda) and inferred-signature operators
    // (auto-declared from usage) keep today's replace behavior.
    if (
      !def.operator.inferredSignature &&
      (def.operator.evaluate === undefined ||
        def.operator.lambda !== undefined) &&
      arg2 !== undefined &&
      arg2 !== null &&
      typeof arg2 !== 'function' &&
      hasFunctionSignature(def.operator.signature.type)
    ) {
      const literal = canonicalFunctionLiteral(ce.expr(arg2));
      // R4 — an UNTYPED literal assigned over a DERIVED signature full-replaces
      // it (D6, "Assign always full-replaces"). A signature derived from the
      // PREVIOUS assign's annotation is a record of that literal, not a contract
      // on the name: re-assigning a bare `x ↦ 2x` must re-infer from the new
      // body, not check it against — and keep — annotations the author has
      // deleted. The boundary is provenance, not shape: a signature that came
      // from `ce.declare()` is a DECLARATION and stays sticky. And an ANNOTATED
      // re-assign still reconciles below whatever the provenance, so
      // annotated → same-annotated rebuilds identically and
      // annotated → differently-annotated still errors.
      const replacesDerived =
        def.operator._derivedSignature &&
        literal !== undefined &&
        !functionLiteralHasAnnotation(literal);
      if (literal !== undefined && !replacesDerived) {
        const declaredType = def.operator.signature;

        // G11 — see the value-slot route above. The literal then installs as a
        // VALUE carrying the DECLARED polytype (the same representation this
        // route already produces for a ground declared signature), so calls
        // dispatch through the polytype-aware `validateArguments` / result
        // instantiation exactly as a built-in generic operator's do.
        if (declaredType.isPolymorphic)
          assertSingleArmPolytype(id, literal, declaredType);

        // The literal must be arity-compatible with the declared signature
        // (mirrors the value-slot path); otherwise a declared-arity call would
        // silently partial-apply on the fixed-arity body.
        assertFunctionLiteralArity(
          id,
          literal,
          declaredType.type,
          declaredType.toString()
        );

        const reconciled = reconcileFunctionLiteralReturn(
          ce,
          ascribeDeclaredParameterTypes(ce, literal, declaredType.type),
          declaredType.type
        );
        // The effects axis is judged by its own provenance. The operator
        // definition carries the bit (`effectsDeclared`), and it has to travel
        // with the value definition this route installs: the declared type
        // alone cannot record an author-written `pure`.
        const effectsDeclared = def.operator.effectsDeclared;
        assertDeclaredEffects(
          id,
          reconciled,
          declaredType.type,
          effectsDeclared
        );
        if (
          !matchesDeclaredTypeAxes(
            ce,
            reconciled.type,
            declaredType,
            effectsDeclared,
            reconciled,
            id
          )
        )
          throw declaredTypeError(id, reconciled, declaredType);

        // A definition that ALREADY carries a user lambda keeps its OPERATOR
        // representation: re-running `ce.assign('f', ⟨annotated literal⟩)` on
        // the same symbol must land where the first run did (notebook re-run
        // semantics — assign twice ≡ assign once). Migrating it to a VALUE def
        // instead dropped the operator half wholesale, and with it the derived
        // `broadcastable` flag and every `_isLambda`/`_lambdaLiteral` consumer,
        // so the second run of a cell broadcast differently from the first.
        // The DECLARED signature stays authoritative and travels onto the
        // rebuilt def — so this changes the representation only: the
        // compatibility checks above already rejected a literal that does not
        // fit. (The `evaluate === undefined` half of the guard above — a
        // declared-but-unimplemented signature — keeps installing a VALUE:
        // that is what makes the object-form `ce.declare(f, { signature })`
        // spelling observably identical to the string form.)
        // The EFFECTS specifier travels only when its provenance is
        // AUTHOR-STATED: the constructor reads ANY effect-bearing supplied
        // signature as a declared contract, so carrying an INFERRED specifier
        // over would promote it to one — a first bare assign of an effectful
        // body would silently become a contract on the second, and later valid
        // re-assigns would be checked against the previously-inferred set.
        // Strip it instead and let the body walk restamp the inference.
        if (def.operator.lambda !== undefined) {
          const lambdaDef: OperatorDefinition = {
            evaluate: reconciled,
            signature: effectsDeclared
              ? declaredType.type
              : stripArrowEffects(declaredType.type),
            broadcastable: paramsAreScalar(declaredType.type),
            // R4 — the signature's PROVENANCE travels with it: rebuilding the
            // def must not launder an assign-derived signature into a
            // declaration (nor a declaration into a derived one).
            _derivedSignature: def.operator._derivedSignature,
          };
          if (shadowBuiltin) ce._declareSymbolOperator(id, lambdaDef);
          else {
            const callableBefore = defIsCallableShaped(def);
            updateDef(ce, id, def, lambdaDef);
            ce._noteStateEvent({
              kind: 'redefine',
              callableBefore,
              callableAfter: true,
            });
            ce._semanticVersion += 1;
            ce._worldVersion += 1;
          }
          return ce;
        }

        // Store the reconciled literal as a VALUE under the declared signature
        // — the SAME representation the string-form (value-slot) declaration
        // produces. This makes the two spellings observably identical: `f(3)`
        // type-errors against the declared param.
        if (shadowBuiltin) {
          ce._declareSymbolValue(id, {
            value: reconciled,
            type: declaredType.type,
            effectsDeclared,
          });
          return ce;
        }
        {
          // State event: a value-slot reconciliation swap — zero-mask
          // `type-write` (the G+M arrive via the value-write below; the
          // updateDef-internal G via `binding-repair`).
          const callableBefore = defIsCallableShaped(def);
          updateDef(ce, id, def, {
            value: reconciled,
            type: declaredType.type,
            effectsDeclared,
          });
          ce._noteStateEvent({
            kind: 'type-write',
            callableBefore,
            callableAfter: defIsCallableShaped(def),
          });
        }
        ce._setSymbolValue(id, reconciled);
        return ce;
      }
    }

    // Update the operator definition.
    const fnDef = assignValueAsOperatorDef(ce, arg2);
    if (!fnDef) throw Error(`Invalid definition for symbol "${id}"`);
    if (shadowBuiltin) {
      ce._declareSymbolOperator(id, fnDef);
      return ce;
    }
    {
      const callableBefore = defIsCallableShaped(def);
      updateDef(ce, id, def, fnDef);
      ce._noteStateEvent({
        kind: 'redefine',
        callableBefore,
        callableAfter: true,
      });
    }
    // Redefining an existing operator is a semantic mutation (no value-setter
    // write happens on this path, so bump explicitly) — and a global-semantics
    // event, not a value write, so the epoch bumps too.
    ce._semanticVersion += 1;
    ce._worldVersion += 1;
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
    // The two rejections this install makes on sight of the existing
    // definition and the new value — a constant target, a value that does not
    // fit a DECLARED type — live in `assertAssignableValueDef` so the `Assign`
    // operator's destructuring route can ask the same question WITHOUT writing
    // (see `assertAssignable`).
    assertAssignableValueDef(ce, id, def.value, value);

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
      const adopted =
        typeof widened === 'object' && widened.kind === 'union' ? vt : widened;
      // State event (§2c): the D11 adopt branch can REMOVE a callable arm
      // (a `function` guess replaced by the scalar value's own type) before
      // the value write below classifies — emit `type-write` when the
      // arm-containment changes; the arm-preserving widen emits nothing.
      const armBefore = containsSignatureArm(current);
      const armAfter = containsSignatureArm(adopted);
      if (armBefore !== armAfter)
        ce._noteStateEvent({
          kind: 'type-write',
          callableBefore: armBefore,
          callableAfter: armAfter,
        });
      def.value.type = ce.type(adopted);
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
    const callableBefore = defIsCallableShaped(def);
    updateDef(ce, id, def, fnDef);
    ce._noteStateEvent({
      kind: 'redefine',
      callableBefore,
      callableAfter: true,
    });
    ce._semanticVersion += 1;
    ce._worldVersion += 1;
  } else {
    // No previous definition: create a new one
    ce.declare(id, fnDef);
  }

  return ce;
}

/**
 * The rejections the value-install branch of {@link assignFn} makes on sight of
 * an existing value definition and the value being written: a `const` target,
 * and a value that does not fit a DECLARED (non-inferred) type.
 *
 * Factored out of that branch — which is its only caller on the write path — so
 * {@link assertAssignable} can ask the same question without writing anything.
 * Both routes therefore raise the identical error: same class, same message,
 * same blamed name.
 */
function assertAssignableValueDef(
  ce: IComputeEngine,
  id: string,
  def: BoxedValueDefinition,
  value: Expression
): void {
  if (def.isConstant)
    throw Error(`Cannot assign a value to the constant "${id}"`);

  // An INFERRED type widens to cover the value (see the caller): nothing to
  // reject. When the type was DECLARED, hold the assigned value to it — the
  // same per-axis check the declare-with-value route applies in the
  // `_BoxedValueDefinition` constructor. Without it a declared type was a
  // contract only at declaration time: `ce.declare('p', 'point')` followed by
  // an assignment of a merely structurally-similar value silently installed a
  // value the `Declare(p, "point", …)` spelling rejects.
  // `matchesDeclaredTypeAxes` (rather than a bare `matches()`) keeps the
  // effects axis judged by its own provenance, so a `{scope}`-inferred closure
  // still fits a bare-specifier declared arrow.
  if (def.inferredType || def.type.isUnknown) return;
  if (
    !matchesDeclaredTypeAxes(
      ce,
      value.type,
      def.type,
      def.effectsDeclared,
      value,
      id
    )
  )
    throw declaredTypeError(id, value, def.type);
}

/**
 * Would `ce.assign(id, value)` be rejected? Answered WITHOUT writing anything,
 * so the `Assign` operator's destructuring route can validate every leaf of a
 * pattern before it writes the first one (`(a, b) := (1, 2.5)` with `b:integer`
 * must leave `a` alone). Throws exactly what the write would throw — the shared
 * {@link assertAssignableValueDef} is the single source of the verdict, so the
 * two cannot drift.
 *
 * Silent — the assignment is left to be attempted — for the cases whose
 * verdict is only reached by running the install machinery. Each is a
 * documented residual, mirroring the destructuring `let`'s pre-pass:
 * - a name with NO prior definition (the assignment creates one; there is
 *   nothing yet to conflict with);
 * - an OPERATOR-slot target: the minted-constructor guard, the
 *   declared-signature reconciliation and the builtin-shadowing choice all
 *   live inside the install;
 * - a value that installs as an operator DEFINITION rather than a value (a
 *   `Function` literal, a wildcard-bearing body): function-literal
 *   reconciliation and the effect-contract check happen there;
 * - a target carrying a DECLARED function signature: the assigned value is
 *   RECONCILED against it first (and `canonicalFunctionLiteral` lifts a
 *   non-literal, so this covers a scalar too), so judging it here could reject
 *   a value the install accepts.
 */
export function assertAssignable(
  ce: IComputeEngine,
  id: string,
  value: Expression
): void {
  if (id === 'Nothing') return; // `assignFn` no-ops on it
  const def = ce.lookupDefinition(id);
  if (def === undefined || !isValueDef(def)) return;
  const v = assignValueAsValue(ce, value);
  if (v === undefined) return;
  if (
    !def.value.isConstant &&
    !def.value.inferredType &&
    hasFunctionSignature(def.value.type.type)
  )
    return;
  assertAssignableValueDef(ce, id, def.value, v);
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

/** Convert an assigned value into an operator definition (a function literal
 * or a JS evaluate function). Exported for the `Assign` operator's
 * CANONICAL-time constructor-function recognition (§4.5b D13): an alias
 * type's same-name function replaces the minted identity constructor at
 * canonicalization so later statements validate against the real signature. */
/**
 * The plain-structure serialization of `get json`, with each node's
 * `sourceOffsets` kept, in the object form the Epsil parser itself emits —
 * so re-boxing preserves the debugger's statement-level pause points
 * (function statements, and the bare symbol/number/string statements that
 * are Epsil's idiomatic return values).
 *
 * Deliberately NOT `toMathJson()`: that is the display serializer, whose
 * function shorthand rewrites a `Function` literal (collapsing its parameter
 * list) — the re-boxed value must be structurally faithful.
 */
function jsonWithSourceOffsets(expr: Expression): MathJsonExpression {
  const sourceOffsets = expr.sourceOffsets;
  if (isSymbol(expr)) {
    return sourceOffsets !== undefined
      ? { sym: expr.symbol, sourceOffsets }
      : expr.json;
  }
  if (isNumber(expr)) {
    const json = expr.json;
    if (sourceOffsets === undefined) return json;
    if (typeof json === 'number') return { num: String(json), sourceOffsets };
    if (typeof json === 'object' && json !== null && 'num' in json)
      return { ...json, sourceOffsets };
    return json; // composite numeric form (e.g. ['Complex', …])
  }
  if (isString(expr)) {
    return sourceOffsets !== undefined
      ? { str: expr.string, sourceOffsets }
      : expr.json;
  }
  if (!isFunction(expr)) return expr.json;
  // Mirror `BoxedFunction.get json`: serialize the structural form's
  // operands (sorting/flattening for associative operators, no folding).
  const structural = expr.structural;
  const ops = isFunction(structural) ? structural.ops : expr.ops;
  const fn = [expr.operator, ...ops.map(jsonWithSourceOffsets)] as [
    MathJsonSymbol,
    ...MathJsonExpression[],
  ];
  return sourceOffsets !== undefined ? { fn, sourceOffsets } : fn;
}

export function assignValueAsOperatorDef(
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
  // The derived signature is INFERENCE-produced, so its arrow specifier must
  // not read as an author-stated effect contract (which would set
  // `effectsDeclared` and make the engine check its own inference against
  // itself). Strip the top-level specifier; the body walk re-derives it.
  // EXCEPT when the literal carries a full-signature return marker
  // (`docs/EFFECTS-MODEL.md`, "Epsil surface"): those effects are
  // AUTHOR-stated, so they ride onto the derived signature — which makes the
  // operator-def constructor set `effectsDeclared` and run the
  // definition-annotation check (`inferred ⊆ declared`) on its own.
  if (functionLiteralHasAnnotation(body)) {
    const stripped = stripArrowEffects(body.type.type);
    const declared = functionLiteralDeclaredEffects(body);
    return {
      evaluate: body,
      signature:
        declared === undefined
          ? stripped
          : withArrowEffects(stripped, declared),
      // The derived signature makes `inferredSignature = false`, so calls now
      // run through `validateArguments` — which admits a collection operand at
      // a scalar parameter only when the definition is `broadcastable`. Left at
      // its `false` default, a bare `ce.assign('f', ⟨annotated literal⟩)`
      // REJECTED `f([1,2,3])` with `incompatible-type` while the very same
      // literal broadcasts on the declare-then-assign VALUE route (`box.ts`
      // gates that validation on `paramsAreScalar`) and on the COMPILED path
      // (`userFunctionParamsAreScalar`, `base-compiler.ts`). Derive the flag
      // the same way, so the three routes read one gate. Polytype-aware: a
      // parameter quantified at a collection bound (`T: indexed_collection`)
      // binds its argument WHOLE and keeps the flag false.
      broadcastable: paramsAreScalar(stripped),
      // R4 — record that this pinned signature is DERIVED from the literal, not
      // declared on the NAME. A later UNTYPED assign full-replaces it (D6)
      // instead of checking the new body against the old annotation.
      _derivedSignature: true,
    };
  }

  // Untyped literal: don't set an explicit signature - let it be inferred from
  // the body. This ensures inferredSignature = true, which allows the return
  // type to be properly narrowed during type checking (e.g., in Add operands).
  return { evaluate: body };
}

/** True if a canonical `Function` literal carries at least one type annotation
 * — an annotated parameter or a return-type ascription (the Phase-1 §4.2
 * marker). Untyped literals return `false` and keep the inferred-signature
 * behavior.
 *
 * A full-signature marker with a WIDE result (`(…) scope -> unknown`) declares
 * no return type and may annotate no parameter, yet IS an annotation: the
 * effects it states are the author's contract. */
function functionLiteralHasAnnotation(literal: Expression): boolean {
  if (functionLiteralReturnType(literal) !== undefined) return true;
  if (functionLiteralDeclaredEffects(literal) !== undefined) return true;
  // A GENERIC literal (a whole-signature `forall` marker) is the strongest
  // annotation there is, yet it declares NO return type (the result mentions a
  // variable, so `functionLiteralReturnType` joins the wide-result convention)
  // and, under erasure, no annotated parameter either. Without this arm
  // `ce.assign('f', genericLiteral)` fell to the inferred-signature path, which
  // reads the ascribed BODY type and produced the nonsense
  // `(unknown) -> forall T. (x: T) -> T`.
  if (isPolymorphicType(literal.type.type)) return true;
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
  // here rather than `hasFunctionSignature`, which is true for that wildcard
  // (it is callable) and would wrongly bring it into the arity check.
  //
  // An OVERLOAD SET (an intersection of signatures) constrains arity too, and
  // every arm has to be satisfied — the value must be callable at all of them.
  // Returning early for it let a 2-parameter literal be assigned to
  // `((integer) -> number) & ((string) -> number)`, after which every declared
  // 1-argument call would silently partial-apply.
  const arms = signatureArms(declaredType);
  if (!arms) return;

  const literalArity = functionLiteralParameters(literal).length;

  /** The arities `sig` accepts, as a description, plus whether `literalArity`
   * is the ONLY one — a literal is a valid implementation of an arm only when
   * that arm accepts exactly one call arity and it is the literal's. */
  const armFits = (sig: FunctionSignature): boolean => {
    const required = sig.args?.length ?? 0;
    const optional = sig.optArgs?.length ?? 0;
    if (sig.variadicArg !== undefined || optional > 0) return false;
    return required === literalArity;
  };

  if (arms.every(armFits)) return;

  const describe = (sig: FunctionSignature): string => {
    const required = sig.args?.length ?? 0;
    const optional = sig.optArgs?.length ?? 0;
    if (sig.variadicArg !== undefined)
      return `${required + (sig.variadicMin ?? 0)} or more`;
    if (optional > 0) return `${required} to ${required + optional}`;
    return `exactly ${required}`;
  };

  // For an overload set, report every arm's accepted arity so the author can
  // see which one the literal fails — deduplicated, since arms commonly agree
  // on arity and differ only in parameter types ("exactly 1 / exactly 1").
  const accepted = [...new Set(arms.map((a) => describe(a)))].join(' / ');

  throw new Error(
    [
      `Symbol "${id}"`,
      `The function literal "${literal.toString()}" takes ${literalArity} parameter(s), but the declared signature "${declaredDisplay}" accepts ${accepted}`,
    ].join('\n|   ')
  );
}

/**
 * Whether a declaration's type STATES its arrow's effects — a non-empty
 * specifier, or the `pure` keyword, which builds the stated-empty `effects: []`
 * (ruled 2026-08-01). Either way the statement is IN the type, so this is just
 * "the arrow carries an effect set", and it reads the same off a type string
 * and off an already-boxed `BoxedType`.
 */
function declaredTypeStatesEffects(
  ce: IComputeEngine,
  declared: Type | TypeString | BoxedType | undefined
): boolean {
  if (declared === undefined) return false;
  const type =
    declared instanceof BoxedType
      ? declared.type
      : parseType(declared, ce._typeResolver);
  return signatureEffects(type) !== undefined;
}

/**
 * The definition-annotation check on the declared-signature routes
 * (`docs/EFFECTS-MODEL.md`, "Definition-annotation check"): an explicit effect
 * annotation is a contract, accepted iff `inferred ⊆ declared` — over-declaring
 * allowed.
 *
 * "Explicit" is the per-axis provenance of "Annotation provenance": any effect
 * set on the declared arrow — a non-empty specifier, or the stated-empty `[]`
 * an author-written `pure` builds (equivalently the `effects: []` field),
 * which declares the EMPTY set as a contract — or `effectsDeclared` for a
 * declaration that stated it some other way. A **bare** specifier slot states
 * nothing: effects stay on the inferred track and every assigned body is
 * accepted and re-stamped.
 *
 * Raising {@link EffectContractError} (rather than letting the generic "not
 * compatible with the type" check below fire) routes the failure through the
 * same `incompatible-type` error-value channel the `Assign` / `Declare`
 * operators use for the object-form declaration.
 */
function assertDeclaredEffects(
  id: MathJsonSymbol,
  literal: Expression,
  declaredType: Type,
  effectsDeclared: boolean
): void {
  const declared = signatureEffects(declaredType);
  if (declared === undefined && !effectsDeclared) return;
  const inferred = signatureEffects(literal.type.type);
  if (!isEffectSubset(inferred, declared))
    throw new EffectContractError(id, declared, inferred);
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
export function reconcileFunctionLiteralReturn(
  ce: IComputeEngine,
  literal: Expression,
  declaredType: Type
): Expression {
  if (!isFunction(literal, 'Function')) return literal;

  // A POLYTYPE declaration ascribes its whole clause onto a marker-less literal
  // (R1): the stored value is then self-describing — `f`'s value types as the
  // polytype, not as the erased `(unknown) -> unknown` its bare parameters
  // would otherwise infer. Runs BEFORE the return-type reconciliation below,
  // which has nothing ground to ascribe under a variable-mentioning result.
  const ascribed = ascribeDeclaredPolytype(ce, literal, declaredType);
  if (ascribed !== undefined) return ascribed;

  // A declared result that MENTIONS a quantified variable has nothing ground
  // to ascribe (§2.4, G4): the body's return stays inferred and call-site
  // result types come from the INSTANTIATED signature instead. Decided BEFORE
  // `functionResult`, which hands back the honest-but-useless-here `unknown`
  // on a polytype arm. A ground result under a `forall`
  // (`forall T. (T) -> boolean`) reconciles exactly as it does under a ground
  // declaration.
  if (
    typeof declaredType === 'object' &&
    declaredType.kind === 'signature' &&
    mentionsQuantifiedVariable(declaredType.result, declaredType)
  )
    return literal;

  // The declaration must be a function signature with a result type.
  const declaredResult = functionResult(declaredType);
  if (declaredResult === undefined) return literal;

  // Respect an author-supplied return ascription. A full-signature marker with
  // a wide result declares no return type but is still the author's ascription
  // — never overwrite it with the declaration's return type.
  if (functionLiteralReturnType(literal) !== undefined) return literal;
  if (functionLiteralDeclaredEffects(literal) !== undefined) return literal;

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
  // moves inside the Block, wrapping the last statement). `returnTypeText`
  // keeps a signature RESULT grouped, so the marker cannot re-read as the
  // literal's own contract (`functionLiteralDeclaredSignature`).
  const rebuilt = ce.box([
    'Function',
    ['Typed', literal.ops[0].json, `'${returnTypeText(declaredResult)}'`],
    ...literal.ops.slice(1).map((p) => p.json),
  ]);
  return isFunction(rebuilt, 'Function') ? rebuilt : literal;
}

/**
 * §6.3 declared-signature reconciliation, PARAMETER half — the mirror of
 * {@link reconcileFunctionLiteralReturn}, which ascribes only the result.
 *
 * The declaration is authoritative for parameters for the same reason it is for
 * the return type, and without this the two halves of a compiled call disagreed
 * about what a parameter IS. `declare L : (list<real>) -> list<real>` with
 * `L(a) := a + 1` stored a literal typing `(unknown) -> list<real>` — the result
 * ascribed, the parameter dropped — so the parameter fell back to usage
 * inference, which reads `a + 1` as scalar arithmetic and infers `number`. The
 * CALL SITE then read the DECLARED signature (`userFunctionParamsAreScalar`),
 * saw a collection parameter and passed the list WHOLE, while the emitted BODY
 * had been compiled as scalar code: `_fn_L([3, 4])` evaluated `[3,4] + 1` and
 * returned the string `"3,41"` behind `success: true` — and under
 * `realOnly: true`, which promises a number. `|a|` degraded to `NaN` the same
 * way. Ascribing the parameters makes the literal self-describing, and both
 * halves then read the same type (Tycho item 116).
 *
 * Deliberately NOT applied on the multi-clause route: a clause is checked as an
 * ARM of the declared signature (`assertClauseFitsDeclared`), and stamping the
 * general signature's parameter types onto a clause would make that check
 * vacuous. Clause parameters are narrowed by construction.
 *
 * Skips, each leaving the literal untouched: an author-annotated parameter (the
 * author's ascription always wins, as it does for the return type), a
 * non-symbol parameter operand (nothing to annotate), a parameter whose
 * declared type mentions a quantified variable (§2.4/G4 — nothing ground to
 * ascribe), and `unknown`/`any`, which state nothing and would merely flip the
 * literal to "annotated".
 */
export function ascribeDeclaredParameterTypes(
  ce: IComputeEngine,
  literal: Expression,
  declaredType: Type
): Expression {
  if (!isFunction(literal, 'Function')) return literal;
  if (typeof declaredType !== 'object' || declaredType.kind !== 'signature')
    return literal;
  // A polytype ascribes its whole clause through `ascribeDeclaredPolytype`.
  if (isPolymorphicType(declaredType)) return literal;

  const args = declaredType.args;
  if (args === undefined || args.length === 0) return literal;
  // An optional or variadic signature is not a valid declaration for a
  // fixed-arity literal at all — `assertFunctionLiteralArity` rejects it
  // upstream. Bail rather than mis-align a positional ascription.
  if ((declaredType.optArgs?.length ?? 0) > 0) return literal;
  if (declaredType.variadicArg !== undefined) return literal;

  const params = literal.ops.slice(1);
  if (params.length !== args.length) return literal;

  let changed = false;
  const rebuilt = params.map((p, i) => {
    if (isFunction(p, 'Typed')) return p.json;
    if (!isSymbol(p)) return p.json;
    const t = args[i].type;
    if (t === 'unknown' || t === 'any') return p.json;
    if (mentionsQuantifiedVariable(t, declaredType)) return p.json;
    // Only a NON-SCALAR parameter is ascribed. The disagreement this repairs
    // is `paramsAreScalar`-shaped: the call site consults the DECLARED type to
    // decide whether to pass a collection argument whole, so only a parameter
    // that binds whole can be handed a value the scalar-compiled body cannot
    // read. Stamping a scalar type buys nothing and is not inert — it
    // re-canonicalizes the body against a narrower parameter, which changed
    // how a tuple argument broadcasts through `x ↦ 2x`.
    if (isScalarType(t)) return p.json;
    // `broadcastable<T>` is not a parameter type to stamp: it is a
    // DECLARATION-level contract with its own assignment enforcement (ratified
    // 2026-08-08, item 157), and ascribing it onto the literal made a
    // consuming body satisfy a broadcastable slot that must be rejected.
    if (typeof t === 'object' && t.kind === 'broadcastable') return p.json;
    changed = true;
    return ['Typed', p.json, `'${returnTypeText(t)}'`] as MathJsonExpression;
  });
  if (!changed) return literal;

  // Rebuild from JSON, so the body is canonicalized AFRESH with the ascribed
  // parameters in place — that re-binding is the entire point: the body's
  // parameter references have to pick up the declared type. Handing the
  // already-canonical body object through instead leaves them bound at
  // whatever the pre-ascription inference chose, and the emitted code stays
  // scalar.
  const rebuiltLiteral = ce.box(['Function', literal.ops[0].json, ...rebuilt]);
  if (!isFunction(rebuiltLiteral, 'Function')) return literal;

  // A fresh body object orphans the literal's PROVISIONAL reading — a
  // juxtaposition frozen as multiplication, or a forward-referenced call —
  // which is recorded in a WeakMap keyed on the literal and body OBJECTS
  // (`provisional-application.ts`). `canonicalFunctionLiteral` carries that
  // record across a re-canonicalization only when it is handed the same body
  // object, which the JSON round-trip defeats, so it is re-attached here.
  // Without it the definition never registered as a dependent and the
  // forward-reference repair silently stopped firing: `g := t ↦ 2a(t)`
  // declared before `a(t) := t²` answered `6a` instead of `18`.
  const provisional =
    provisionalLiteral(literal) ?? provisionalLiteral(literal.ops[0]);
  if (provisional !== undefined) {
    setProvisionalLiteral(rebuiltLiteral, provisional);
    if (rebuiltLiteral.ops[0] !== undefined)
      setProvisionalLiteral(rebuiltLiteral.ops[0], provisional);
  }
  return rebuiltLiteral;
}

/**
 * R1 — ascribe a DECLARED POLYTYPE onto a marker-less function literal, so the
 * stored value describes itself.
 *
 * `let f: forall T. (x: T) -> T = x |-> x` installed a literal whose own type
 * was the erased `(unknown) -> unknown`: the declaration's clause lived only on
 * the definition, so `f`'s VALUE (what `evaluate()` and serialization hand back)
 * had lost it. Rebuilding through the Phase-1 authoring form — the full
 * signature as the body-slot marker — makes `functionLiteralSignatureType`
 * carry the clause VERBATIM (`effects-inference.ts`, the `isGenericSignature`
 * arm), so the value and the definition agree.
 *
 * Returns `undefined` (leave the literal alone) unless every precondition
 * holds:
 * - the declaration is a single polytype signature the E2 pre-pass accepts as a
 *   marker (a plain signature — no optional or variadic arguments — with one
 *   argument per literal parameter);
 * - the literal carries NO marker of its own (no full-signature marker, no
 *   return ascription, no declared effects) and NO parameter annotation;
 * - EVERY argument of the declaration mentions a quantified variable.
 *
 * Together those make the rebuild a pure DISPLAY fix. Erasure (G1) has nothing
 * to erase (every quantified parameter is already bare), the G9 α-agreement
 * check is trivially satisfied (the marker IS the declared type), and the
 * §2.4-rule-4 annotation-coverage check has no annotation to reject. A literal
 * that DOES carry its own marker already went through those checks and keeps
 * it.
 *
 * The last condition is not cosmetic. A GROUND argument in the clause
 * (`forall T. (x: T, n: number) -> T`) would become a real constraint on the
 * literal's OWN arrow, and that arrow is enforced at every direct application
 * of the stored value — notably the per-element `apply()` inside a broadcast,
 * where `n` legitimately receives a whole row. Ascribing it there turns a
 * working broadcast into `incompatible-type`. Restricting the ascription to
 * clauses whose arguments are all quantified means it can only ever RECORD the
 * `forall`, never tighten a parameter.
 *
 * Ground declarations are deliberately out of scope: their parameter types are
 * dropped from the stored literal's arrow too (`(x) |-> x` under
 * `(x: integer) -> integer` types `(unknown) -> integer`), but that asymmetry
 * predates this milestone and has a far larger surface.
 */
function ascribeDeclaredPolytype(
  ce: IComputeEngine,
  literal: Expression,
  declaredType: Type
): Expression | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  if (typeof declaredType !== 'object' || declaredType.kind !== 'signature')
    return undefined;
  if ((declaredType.typeParams?.length ?? 0) === 0) return undefined;
  if (
    declaredType.optArgs !== undefined ||
    declaredType.variadicArg !== undefined
  )
    return undefined;
  if ((declaredType.args?.length ?? 0) !== literal.nops - 1) return undefined;
  if (
    !(declaredType.args ?? []).every((a) =>
      mentionsQuantifiedVariable(a.type, declaredType)
    )
  )
    return undefined;

  // Already self-describing (or carrying an author ascription we must not
  // overwrite).
  if (functionLiteralDeclaredSignature(literal) !== undefined) return undefined;
  if (functionLiteralReturnType(literal) !== undefined) return undefined;
  if (functionLiteralDeclaredEffects(literal) !== undefined) return undefined;
  if (functionLiteralParameters(literal).some((p) => p.type !== undefined))
    return undefined;

  // As in `reconcileFunctionLiteralReturn` above, and under the same constraint
  // as `desugarSignatureString`: the serialized type goes straight back into
  // `canonicalFunctionLiteralArguments` — in this same scope — which re-parses
  // it with the resolver, so a scope-local type name stays resolved.
  const rebuilt = ce.box([
    'Function',
    ['Typed', literal.ops[0].json, `'${typeToString(declaredType)}'`],
    ...literal.ops.slice(1).map((p) => p.json),
  ]);
  return isFunction(rebuilt, 'Function') ? rebuilt : undefined;
}
