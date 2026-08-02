import type {
  FunctionSignature,
  Type,
  TypeString,
} from '../common/type/types.js';
import {
  functionResult,
  hasFunctionSignature,
  isValidType,
  isValidTypeName,
  signatureArms,
  widen,
} from '../common/type/utils.js';
import { parseType } from '../common/type/parse.js';
import { isEffectSubset } from '../common/type/effects.js';
import { BoxedType } from '../common/type/boxed-type.js';
import {
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
import {
  checkTypeConstructorNamespace,
  installConstructorFunction,
  isMintedConstructor,
  loosenMintedConstructor,
  mintTypeConstructor,
} from './type-constructors.js';
import { isFunction } from './boxed-expression/type-guards.js';
import {
  functionLiteralDeclaredEffects,
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
  // (`Accumulate[xs]` vs `Scan(xs, Add)`). The namespace stays Cortex-native.
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
  {
    alias,
    fromStatement,
    mint,
  }: { alias?: boolean; fromStatement?: boolean; mint?: boolean } = {}
): void {
  if (!isValidTypeName(name)) throw Error(`The type name "${name}" is invalid`);

  // A type declaration claims BOTH namespaces: the type record, and a
  // value-level constructor of the same name (nominal-types design §4.1/D5).
  // Minting is unconditional per the design — including for the engine's own
  // bootstrap declarations, which therefore put `limits(…)`/`distribution(…)`
  // in the system scope. `mint: false` is an INTERNAL escape hatch kept for a
  // declaration that must not claim the value name; no caller uses it today.
  mint ??= true;

  // Is the type already defined in this scope?
  const scope = ce.context.lexicalScope;
  const existing = scope.types?.[name];
  if (existing) {
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
      throw Error(`The type "${name}" is already defined in the current scope`);
  }

  // D5, atomicity: the value half is checked BEFORE anything is mutated, so a
  // collision leaves neither namespace touched — not the existing type record,
  // not the recursion placeholder below. An outer-scope binding is shadowed,
  // not conflicted; an inferred (valueless, auto-declared) binding upgrades; a
  // constructor we minted earlier is ours to replace.
  if (mint) checkTypeConstructorNamespace(scope, name);

  if (existing) delete scope.types![name];

  scope.types ??= {};

  alias ??= false; // Nominal by default

  // First, add a placeholder record to allow recursive types
  scope.types[name] = { kind: 'reference', name, alias, def: undefined };
  if (fromStatement)
    (
      scope.types[name] as { _declaredByStatement?: boolean }
    )._declaredByStatement = true;

  // Parse the type (which may reference itself). If it is malformed, leave
  // the scope as it was: a placeholder with no `def` is a dangling reference
  // that later resolves to a broken type.
  let def: Type;
  try {
    def =
      type instanceof BoxedType
        ? type.type
        : typeof type === 'string'
          ? parseType(type, ce._typeResolver)
          : type;
  } catch (e) {
    delete scope.types[name];
    if (existing) scope.types[name] = existing;
    throw e;
  }

  // Adjust the definition (the type references in the type will point to
  // the placeholder record)
  scope.types[name].def = def;

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
      mintTypeConstructor(ce, scope, name, scope.types[name], def);
    } catch (e) {
      delete scope.types[name];
      if (existing) scope.types[name] = existing;
      if (existingBinding !== undefined)
        scope.bindings.set(name, existingBinding);
      else scope.bindings.delete(name);
      throw e;
    }
  }
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
          def.value as Expression,
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
      scope.types?.[id]?.def !== undefined &&
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
  const ctorType = ctorScope.types?.[id];
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
        if (boxedFn) arg2 = ce.box(boxedFn.json) as AssignValue;
      }
    }

    // §4.5b D13 (nominal-types design) — constructor-function recognition. A
    // function literal assigned to a name that the CURRENT scope's own
    // `scope.types` declares as a NOMINAL type is that type's constructor
    // function: recognized here, at install time, so the Cortex `function`
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
          reconciled
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
      updateDef(ce, id, def, { value });
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
      if (literal !== undefined) {
        const declaredType = def.operator.signature;

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
          literal,
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
            reconciled
          )
        )
          throw declaredTypeError(id, reconciled, declaredType);

        // Store the reconciled literal as a VALUE under the declared signature
        // — the SAME representation the string-form (value-slot) declaration
        // produces. This makes the two spellings observably identical: `f(3)`
        // type-errors against the declared param, and a well-typed call applies
        // the lambda (an operator def cannot apply a bare tuple argument, so
        // keeping it an operator would leave `f((3, 4))` unevaluated).
        if (shadowBuiltin) {
          ce._declareSymbolValue(id, {
            value: reconciled,
            type: declaredType.type,
            effectsDeclared,
          });
          return ce;
        }
        updateDef(ce, id, def, {
          value: reconciled,
          type: declaredType.type,
          effectsDeclared,
        });
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
    updateDef(ce, id, def, fnDef);
    // Redefining an existing operator is a semantic mutation (no value-setter
    // write happens on this path, so bump explicitly) — and a global-semantics
    // event, not a value write, so the epoch bumps too.
    ce._mutationGeneration += 1;
    ce._semanticEpoch += 1;
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
    } else if (!def.value.type.isUnknown) {
      // ... or, when the type was DECLARED (not on the inferred track), hold
      // the assigned value to it — the same per-axis check the
      // declare-with-value route applies in the `_BoxedValueDefinition`
      // constructor. Without it a declared type was a contract only at
      // declaration time: `ce.declare('p', 'point')` followed by an assignment
      // of a merely structurally-similar value silently installed a value the
      // `Declare(p, "point", …)` spelling rejects. `matchesDeclaredTypeAxes`
      // (rather than a bare `matches()`) keeps the effects axis judged by its
      // own provenance, so a `{scope}`-inferred closure still fits a
      // bare-specifier declared arrow.
      if (
        !matchesDeclaredTypeAxes(
          ce,
          value.type,
          def.value.type,
          def.value.effectsDeclared,
          value
        )
      )
        throw declaredTypeError(id, value, def.value.type);
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
    ce._mutationGeneration += 1;
    ce._semanticEpoch += 1;
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

/** Convert an assigned value into an operator definition (a function literal
 * or a JS evaluate function). Exported for the `Assign` operator's
 * CANONICAL-time constructor-function recognition (§4.5b D13): an alias
 * type's same-name function replaces the minted identity constructor at
 * canonicalization so later statements validate against the real signature. */
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
  // (`docs/EFFECTS-MODEL.md`, "Cortex surface"): those effects are
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
function reconcileFunctionLiteralReturn(
  ce: IComputeEngine,
  literal: Expression,
  declaredType: Type
): Expression {
  if (!isFunction(literal, 'Function')) return literal;

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
  // moves inside the Block, wrapping the last statement).
  const rebuilt = ce.box([
    'Function',
    ['Typed', literal.ops[0].json, `'${ce.type(declaredResult).toString()}'`],
    ...literal.ops.slice(1).map((p) => p.json),
  ]);
  return isFunction(rebuilt, 'Function') ? rebuilt : literal;
}
