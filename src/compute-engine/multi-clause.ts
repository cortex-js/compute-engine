import type {
  EffectSet,
  FunctionSignature,
  Type,
} from '../common/type/types.js';
import {
  isEffectSubset,
  isPureEffectSet,
  sameEffectSet,
  unionEffectSets,
} from '../common/type/effects.js';
import { isSubtype } from '../common/type/subtype.js';

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
  OperatorDefinition,
} from './global-types.js';

import { isFunction } from './boxed-expression/type-guards.js';
import {
  armAdmission,
  isMoreSpecific,
  triStateSelect,
} from './boxed-expression/overload.js';
import { hasValueComponent } from './boxed-expression/value-membership.js';
import { provablyDisjoint } from '../common/type/subtype.js';
import { typeToString } from '../common/type/serialize.js';
import { isLiteralParamName } from '../math-json/symbols.js';
import { isOperatorDef, isValueDef, updateDef } from './boxed-expression/utils.js';
import { functionLiteralDeclaredEffects } from './boxed-expression/function-literal.js';
import { apply, lookup } from './function-utils.js';
import { isMintedConstructor } from './type-constructors.js';

/**
 * Multi-clause function definitions — the engine half of
 * `docs/plans/2026-08-01-function-polymorphism-design.md` (Phase 1;
 * implementation plan `…-phase1-plan.md`).
 *
 * A `DefineFunction` statement ACCUMULATES clauses on a symbol's operator
 * definition; `Assign` keeps full-replace semantics everywhere (D6). The
 * definition's stored signature is the intersection of the clause
 * signatures — the standard overload-set encoding, so static validation,
 * result typing and diagnostics ride the existing overload machinery — and
 * its `evaluate` selects a clause per call with the tri-state admission
 * model (§4.4): most-specific admitted clause wins, an undecidable clause
 * that could outrank or tie the winner keeps the application INERT, and a
 * call every clause refutes is the `no-matching-clause` error value (D7).
 *
 * Modeled on `type-constructors.ts` (the minted constructor is itself an
 * overload-set operator definition with a selecting `evaluate`).
 */

export interface FunctionClause {
  /** The clause's signature: the literal's arrow (annotated or inferred),
   * effects stripped — the effect row lives on the SYMBOL (D5). */
  signature: FunctionSignature;
  /** The canonical `Function` literal (with its captured scope). */
  literal: Expression;
}

/** Symbol-level effect-row state (D5): `explicit` is the author-established
 * row, or `undefined` while unestablished (row = join of the clauses'
 * inferred effects). */
interface EffectRowState {
  explicit: EffectSet | undefined;
}

interface MultiClauseState {
  clauses: FunctionClause[];
  effectRow: EffectRowState;
}

/** Marker on the INNER operator definition object (same pattern as
 * `_mintedTypeConstructor`): `updateDef()` replaces the inner definition
 * wholesale, so an `Assign` over the symbol drops the marker and the
 * clause list with it — full-replace falls out for free. */
const MULTI_CLAUSE = '_multiClauseFunction';

interface MultiClauseMarker {
  [MULTI_CLAUSE]?: MultiClauseState;
}

/** The clause state of a definition, when it is a multi-clause function WE
 * installed. */
export function multiClauseState(
  def: BoxedDefinition | undefined
): MultiClauseState | undefined {
  if (def === undefined || !isOperatorDef(def)) return undefined;
  return (def.operator as unknown as MultiClauseMarker)[MULTI_CLAUSE];
}

export class ClauseDefinitionError extends Error {
  constructor(
    readonly code: 'invalid-clause-definition' | 'incompatible-clause-effects',
    message: string
  ) {
    super(message);
    this.name = 'ClauseDefinitionError';
  }
}

//
// ─── Clause derivation ────────────────────────────────────────────────────
//

/** The clause signature of a canonical `Function` literal: its arrow with
 * the effects specifier removed (D5 — effects are symbol-level). */
function clauseSignatureOf(literal: Expression): FunctionSignature {
  const arrow = literal.type.type;
  if (typeof arrow === 'object' && arrow.kind === 'signature') {
    const sig = { ...arrow };
    delete sig.effects;
    return sig;
  }
  // A literal always types as a signature; degrade conservatively if not.
  return {
    kind: 'signature',
    variadicArg: { type: 'any' },
    variadicMin: 0,
    result: 'unknown',
  };
}

/** The literal's inferred effect row (its arrow's specifier), for the D5
 * state machine. */
function inferredEffectsOf(literal: Expression): EffectSet | undefined {
  const arrow = literal.type.type;
  if (typeof arrow === 'object' && arrow.kind === 'signature')
    return arrow.effects;
  return undefined;
}

//
// ─── Clause identity (§4.3) ───────────────────────────────────────────────
//

/** Two clauses are the SAME clause iff their parameter domains coincide:
 * identical arity structure and mutually-subtyped parameter types.
 * Result type and effects are deliberately excluded — a body edit that
 * changes the inferred result must REPLACE its clause, not append. */
function sameParameterDomain(
  a: FunctionSignature,
  b: FunctionSignature
): boolean {
  const aReq = a.args?.length ?? 0;
  const bReq = b.args?.length ?? 0;
  const aOpt = a.optArgs?.length ?? 0;
  const bOpt = b.optArgs?.length ?? 0;
  if (aReq !== bReq || aOpt !== bOpt) return false;
  if ((a.variadicArg === undefined) !== (b.variadicArg === undefined))
    return false;
  if (a.variadicArg && (a.variadicMin ?? 0) !== (b.variadicMin ?? 0))
    return false;

  const mutual = (x: Type, y: Type) => isSubtype(x, y) && isSubtype(y, x);
  for (let i = 0; i < aReq; i++)
    if (!mutual(a.args![i].type, b.args![i].type)) return false;
  for (let i = 0; i < aOpt; i++)
    if (!mutual(a.optArgs![i].type, b.optArgs![i].type)) return false;
  if (a.variadicArg && !mutual(a.variadicArg.type, b.variadicArg!.type))
    return false;
  return true;
}

//
// ─── Accumulation (§4.3) ──────────────────────────────────────────────────
//

/**
 * Accumulate one clause onto `id` in the current scope. The caller
 * (`DefineFunction`'s handlers) has already shape-checked `literal` as a
 * canonical `Function` literal — NEVER pass anything lifted through
 * `canonicalFunctionLiteral`'s shorthand path (a bare `5` lifts to a
 * constant lambda and would silently become a clause).
 *
 * Throws `ClauseDefinitionError` on rejection; the operator route converts
 * it to an `Error` value, the host route lets it propagate.
 */
export function defineFunctionClause(
  ce: IComputeEngine,
  id: string,
  literal: Expression
): void {
  if (!isFunction(literal, 'Function') || !literal.isCanonical)
    throw new ClauseDefinitionError(
      'invalid-clause-definition',
      `The definition of "${id}" is not a function literal`
    );

  const scope = ce.context.lexicalScope;

  // Constructor precedence (spec §4.7): a same-scope NOMINAL type
  // declaration owns the name — the CONSTRUCTOR interpretation wins, and
  // v1 has no constructor clauses. Delegate to assignment: its
  // constructor-function recognition installs the smart constructor
  // (nominal-types v2); re-defining it replaces the constructor, the
  // notebook re-run semantics that implementation pins. An ALIAS's
  // same-name function is an ordinary function (nominal spec §4.5), so it
  // falls through to normal clause accumulation below.
  const sameScopeType = scope.types?.[id];
  if (sameScopeType?.def !== undefined && sameScopeType.alias !== true) {
    ce.assign(id, literal);
    return;
  }

  // Resolve the existing binding. A builtin (system-scope) definition is
  // SHADOWED in the current scope, never accumulated onto (same rule as
  // assignment).
  let existing = lookupInScope(ce, id);
  const systemScope = ce.contextStack[0]?.lexicalScope;
  const isBuiltin =
    existing !== undefined &&
    systemScope !== undefined &&
    systemScope.bindings.get(id) === existing &&
    scope !== systemScope;
  if (isBuiltin) existing = undefined;

  if (existing !== undefined && isMintedConstructor(existing)) {
    // A same-scope ALIAS's minted identity constructor is a placeholder:
    // the first clause replaces it (the single-clause `ce.assign` below
    // takes assignment's alias branch). Any OTHER minted constructor — an
    // outer scope's, or a nominal type's reached without the §4.7
    // delegation — cannot hold clauses.
    if (sameScopeType?.alias === true) existing = undefined;
    else
      throw new ClauseDefinitionError(
        'invalid-clause-definition',
        `"${id}" is the constructor of a declared type; a type's constructor cannot be defined by clauses`
      );
  }

  const incoming: FunctionClause = {
    signature: clauseSignatureOf(literal),
    literal,
  };
  const incomingExplicit = functionLiteralDeclaredEffects(literal);

  // Existing clause state, or the conversion of a pre-existing single
  // user-function definition into its 1-clause equivalent.
  const state =
    multiClauseState(existing) ?? convertToClauseState(existing);

  if (state === undefined && existing !== undefined && !isBuiltin) {
    // The name is bound to something that cannot hold clauses (an opaque
    // host operator with a native handler, or a non-function value).
    if (
      isOperatorDef(existing) &&
      existing.operator.evaluate !== undefined &&
      (existing.operator as { _lambdaLiteral?: Expression })._lambdaLiteral ===
        undefined
    )
      throw new ClauseDefinitionError(
        'invalid-clause-definition',
        `"${id}" is an opaque function (native handler); it cannot be extended with clauses`
      );
    if (isValueDef(existing) && existing.value.value !== undefined)
      throw new ClauseDefinitionError(
        'invalid-clause-definition',
        `"${id}" already holds a non-function value; assign to replace it`
      );
  }

  // ── Build the PROSPECTIVE state (never mutate the installed state:
  // `multiClauseState` returns the LIVE marker object, and any check below
  // may still throw — a rejected clause must leave the installed definition
  // byte-identical, or a phantom effect row poisons every later
  // accumulation). Committed only by `installClauseList` at the end. ──
  const clauses = [...(state?.clauses ?? [])];
  const effectRow: EffectRowState = { explicit: state?.effectRow.explicit };

  // Replace (same parameter domain, position preserved) or append.
  const at = clauses.findIndex((c) =>
    sameParameterDomain(c.signature, incoming.signature)
  );
  if (at >= 0) clauses[at] = incoming;
  else clauses.push(incoming);

  // §4.2: a SINGLE clause keeps today's single-function representation —
  // no behavior change until a second clause exists. Assignment installs
  // the ordinary user-function definition (operator slot, `_lambdaLiteral`),
  // so every consumer of that representation (differentiation, closure
  // capture, compile) is untouched; conversion to clause storage happens
  // when the second clause arrives.
  if (clauses.length === 1 && multiClauseState(existing) === undefined) {
    ce.assign(id, literal);
    return;
  }

  // ── Effect-row state machine (D5) ──
  if (incomingExplicit !== undefined) {
    if (effectRow.explicit === undefined) {
      effectRow.explicit = incomingExplicit; // establish (prospective)
    } else if (!sameEffectSet(effectRow.explicit, incomingExplicit)) {
      throw new ClauseDefinitionError(
        'incompatible-clause-effects',
        `The clause's effect specifier conflicts with the established effects of "${id}"`
      );
    }
  }
  // EVERY prospective clause must fit the (possibly just-established) row —
  // not only the incoming one: establishing a narrow explicit row over an
  // existing wider-effect clause would silently mark an effectful function
  // pure when the row is stamped onto the arms.
  if (effectRow.explicit !== undefined)
    for (const c of clauses)
      if (!isEffectSubset(inferredEffectsOf(c.literal), effectRow.explicit))
        throw new ClauseDefinitionError(
          'incompatible-clause-effects',
          c === incoming
            ? `The clause's body has effects exceeding the established effects of "${id}"`
            : `The stated effects are narrower than the effects of an existing clause of "${id}"`
        );

  installClauseList(ce, id, existing, clauses, effectRow);
}

/** Convert a pre-existing single user-function definition — an operator
 * definition holding a function literal, or a value definition holding a
 * literal under a declared signature — into its 1-clause state. Returns
 * `undefined` when the definition holds no recoverable literal. */
function convertToClauseState(
  def: BoxedDefinition | undefined
): MultiClauseState | undefined {
  if (def === undefined) return { clauses: [], effectRow: { explicit: undefined } };

  let literal: Expression | undefined;
  if (isOperatorDef(def))
    literal = (def.operator as { _lambdaLiteral?: Expression })._lambdaLiteral;
  else if (isValueDef(def)) {
    const v = def.value.value;
    if (v !== undefined && isFunction(v, 'Function')) literal = v;
  }
  if (literal === undefined) return undefined;
  const canonical = literal.isCanonical ? literal : literal.canonical;
  if (!isFunction(canonical, 'Function')) return undefined;

  return {
    clauses: [{ signature: clauseSignatureOf(canonical), literal: canonical }],
    effectRow: { explicit: functionLiteralDeclaredEffects(canonical) },
  };
}

/** Look up `id` along the scope chain (read-only). */
function lookupInScope(
  ce: IComputeEngine,
  id: string
): BoxedDefinition | undefined {
  return lookup(id, ce.context.lexicalScope) ?? undefined;
}

/**
 * Loosen the accumulation target's signature to the wide `'function'` while
 * a clause literal canonicalizes, returning a restore thunk. Mirrors
 * `loosenMintedConstructor`: a recursive clause body (`f(n) = f(n-1) + …`)
 * canonicalizes BEFORE the new intersection signature exists, and its
 * self-call must not validate against the PREVIOUS clauses' signature (a
 * 1-clause `(0) -> …` would bake `incompatible-type` into the body).
 * Only definitions clause accumulation targets are loosened: an existing
 * multi-clause definition, or a user function literal (operator slot).
 * Builtins are left alone (they get shadowed, not accumulated onto).
 */
export function loosenForClauseDefinition(
  ce: IComputeEngine,
  id: string
): (() => void) | undefined {
  const binding = lookupInScope(ce, id);
  if (binding === undefined || !isOperatorDef(binding)) return undefined;
  const systemScope = ce.contextStack[0]?.lexicalScope;
  if (
    systemScope !== undefined &&
    systemScope.bindings.get(id) === binding &&
    ce.context.lexicalScope !== systemScope
  )
    return undefined; // builtin: shadowed later, never loosened
  const isTarget =
    multiClauseState(binding) !== undefined ||
    (binding.operator as { _lambdaLiteral?: Expression })._lambdaLiteral !==
      undefined;
  if (!isTarget) return undefined;
  const saved = binding.operator;
  updateDef(ce, id, binding, { signature: 'function' });
  return () => {
    (binding as { operator: unknown }).operator = saved;
  };
}

//
// ─── Installation ─────────────────────────────────────────────────────────
//

/** Build and install the operator definition for a clause list: intersection
 * signature (row stamped on every arm, D5), selecting `evaluate`, marker. */
function installClauseList(
  ce: IComputeEngine,
  id: string,
  existing: BoxedDefinition | undefined,
  clauses: FunctionClause[],
  effectRow: EffectRowState
): void {
  const row =
    effectRow.explicit ??
    clauses.reduce<EffectSet | undefined>(
      (acc, c) => unionEffectSets(acc, inferredEffectsOf(c.literal)),
      undefined
    );

  const arms: FunctionSignature[] = clauses.map((c) =>
    row === undefined || isPureEffectSet(row)
      ? c.signature
      : { ...c.signature, effects: row }
  );
  const signature: Type =
    arms.length === 1 ? arms[0] : { kind: 'intersection', types: arms };

  const frozen = [...clauses];
  const def: OperatorDefinition = {
    // ≥2 clauses by construction: a single clause installs via `ce.assign`
    // (§4.2) and never reaches this list.
    description: `Multi-clause function (${clauses.length} clauses)`,
    ...(row !== undefined && !isPureEffectSet(row)
      ? { effects: row }
      : { pure: true }),
    lazy: false,
    signature,
    evaluate: (ops, options) => selectAndApply(ce, id, frozen, ops, options),
  };

  if (existing !== undefined) updateDef(ce, id, existing, def);
  else ce.declare(id, def);

  const installed = lookupInScope(ce, id);
  if (installed !== undefined && isOperatorDef(installed))
    (installed.operator as unknown as MultiClauseMarker)[MULTI_CLAUSE] = {
      clauses,
      effectRow,
    };
  ce._mutationGeneration += 1;
  ce._semanticEpoch += 1;
}

//
// ─── Runtime selector (§4.4) ──────────────────────────────────────────────
//

/**
 * Select and apply a clause. Operands arrive ALREADY EVALUATED (the
 * definition is not lazy), so admission and application consume the same
 * values — arguments are evaluated exactly once per call.
 *
 * Dispatch is `triStateSelect` (overload.ts) — the SAME decision procedure
 * static result typing consumes, so the two routes cannot diverge:
 * `selected` applies the winning clause, `blocked` (an undecidable clause
 * could outrank or tie the best admitted one) stays inert, `none` is the
 * D7 `no-matching-clause` error value.
 *
 * Returns `undefined` (inert) when no clause can be committed to yet.
 */
function selectAndApply(
  ce: IComputeEngine,
  id: string,
  clauses: ReadonlyArray<FunctionClause>,
  ops: ReadonlyArray<Expression>,
  options: { numericApproximation?: boolean }
): Expression | undefined {
  const verdict = triStateSelect(
    ops,
    clauses.map((c) => c.signature)
  );

  if (verdict.kind === 'blocked') return undefined; // inert

  if (verdict.kind === 'selected')
    return apply(clauses[verdict.index].literal, ops, {
      numericApproximation: options.numericApproximation,
    });

  // Every clause refuted: the function is not defined at this point (D7).
  //
  // Note on the §4.4 backstop: "statically admitted ⇒ ≥1 non-refuted clause
  // at runtime" is NOT assertable here — reaching this line after static
  // admission is a LEGITIMATE outcome when evaluation reveals a concrete
  // value (`g(k)` with `k` statically `integer`, evaluating to a value no
  // clause covers — the design's "miss revealed only after evaluation"
  // case). The anti-drift guarantee the backstop wanted is enforced by
  // CONSTRUCTION instead: `admissionOf` is one shared implementation for
  // the static filter and this selector, so they cannot diverge on the
  // same operand knowledge.
  return ce._fn('Error', [
    ce.string('no-matching-clause'),
    ce.function(id, [...ops], { form: 'raw' }),
  ]);
}

//
// ─── Clause listing (§4.6, `About`) ───────────────────────────────────────
//

/**
 * The clause listing of a multi-clause function — the `About` diagnostic
 * surface (design §4.6): one line per clause, signature in declaration
 * order (= tie-break order), with the two v1 annotations:
 *
 * - **tie overlap** — an earlier clause of equal specificity (incomparable
 *   parameter domains) whose domain overlaps: declaration order decides in
 *   the overlap;
 * - **finite coverage** — a clause whose domain is entirely covered by
 *   strictly more specific clauses over a finite/enumerable domain
 *   (boolean and value-type domains only; no general set-containment).
 *
 * Returns `undefined` when `id` is not bound to a multi-clause function in
 * the current scope chain.
 */
export function clauseListing(
  ce: IComputeEngine,
  id: string
): string[] | undefined {
  const state = multiClauseState(lookupInScope(ce, id));
  if (state === undefined) return undefined;

  const sigs = state.clauses.map((c) => c.signature);
  const lines: string[] = [];
  for (let j = 0; j < sigs.length; j++) {
    const notes: string[] = [];
    for (let i = 0; i < j; i++)
      if (tieOverlaps(sigs[i], sigs[j])) {
        notes.push(
          `overlaps clause ${i + 1}; declaration order decides in the overlap`
        );
        break;
      }
    if (coveredByMoreSpecific(ce, sigs, j)) notes.push('unreachable (covered)');

    lines.push(
      `clause ${j + 1}: ${clauseSignatureToString(sigs[j])}` +
        (notes.length > 0 ? ` — ${notes.join('; ')}` : '')
    );
  }
  return lines;
}

/** Render a clause signature, suppressing generated literal-parameter names
 * (`(literalParam_1: 0) -> integer` reads `(0) -> integer` — the literal
 * spelling IS the value type's text). Only value-typed parameters are
 * anonymized: a non-value-typed parameter merely wearing the reserved
 * prefix (box route) keeps its name. */
function clauseSignatureToString(sig: FunctionSignature): string {
  const anon: FunctionSignature = {
    ...sig,
    args: sig.args?.map((a) =>
      a.name !== undefined &&
      isLiteralParamName(a.name) &&
      hasValueComponent(a.type)
        ? { type: a.type }
        : a
    ),
  };
  return typeToString(anon);
}

/** Two clauses of equal specificity (incomparable parameter domains) whose
 * domains overlap — the §4.6 tie-overlap annotation. Restricted to plain
 * fixed-arity clauses; a position that is not PROVABLY disjoint counts as
 * overlapping (this is a diagnostic surface, not a dispatch decision). */
function tieOverlaps(a: FunctionSignature, b: FunctionSignature): boolean {
  const n = a.args?.length ?? 0;
  if ((b.args?.length ?? 0) !== n || n === 0) return false;
  if (
    (a.optArgs?.length ?? 0) > 0 ||
    (b.optArgs?.length ?? 0) > 0 ||
    a.variadicArg !== undefined ||
    b.variadicArg !== undefined
  )
    return false;
  // Comparable domains are ranked by specificity, not declaration order.
  if (isMoreSpecific(a, b, n) || isMoreSpecific(b, a, n)) return false;
  for (let i = 0; i < n; i++)
    if (provablyDisjoint(a.args![i].type, b.args![i].type)) return false;
  return true;
}

/** Whether clause `j`'s domain is entirely covered by strictly more specific
 * clauses — detected only over finite/enumerable domains (boolean, value
 * types, and unions of them; enumeration capped). */
function coveredByMoreSpecific(
  ce: IComputeEngine,
  sigs: ReadonlyArray<FunctionSignature>,
  j: number
): boolean {
  const sig = sigs[j];
  const args = sig.args ?? [];
  if (args.length === 0) return false;
  if ((sig.optArgs?.length ?? 0) > 0 || sig.variadicArg !== undefined)
    return false;

  const domains: Expression[][] = [];
  let total = 1;
  for (const a of args) {
    const d = enumerateFiniteDomain(ce, a.type);
    if (d === undefined) return false;
    total *= d.length;
    if (total > 32) return false; // enumeration cap — stay cheap
    domains.push(d);
  }

  const covering = sigs.filter(
    (s, i) => i !== j && isMoreSpecific(s, sig, args.length)
  );
  if (covering.length === 0) return false;

  let tuples: Expression[][] = [[]];
  for (const d of domains)
    tuples = tuples.flatMap((t) => d.map((v) => [...t, v]));

  return tuples.every((tuple) =>
    covering.some((s) => armAdmission(tuple, s) === 'admit')
  );
}

/** The finite enumeration of a parameter type: `boolean` → the two booleans,
 * a value type → its value, a union → the concatenation of its branches'
 * enumerations. `undefined` when the type is not finitely enumerable in v1. */
function enumerateFiniteDomain(
  ce: IComputeEngine,
  t: Type
): Expression[] | undefined {
  if (t === 'boolean') return [ce.True, ce.False];
  if (typeof t === 'object') {
    if (t.kind === 'value') {
      const v = t.value;
      if (typeof v === 'number') return [ce.number(v)];
      if (typeof v === 'string') return [ce.string(v)];
      if (typeof v === 'boolean') return [v ? ce.True : ce.False];
      return undefined;
    }
    if (t.kind === 'union') {
      const out: Expression[] = [];
      for (const branch of t.types) {
        const d = enumerateFiniteDomain(ce, branch);
        if (d === undefined) return undefined;
        out.push(...d);
      }
      return out;
    }
  }
  return undefined;
}
