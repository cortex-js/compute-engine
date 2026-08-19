import type {
  DeclarationOrigin,
  EffectSet,
  FunctionSignature,
  Type,
} from '../common/type/types.js';
import { checkSameUnitClauseRedefinition } from './declaration-origin.js';
import {
  clauseSignatureOf as clauseSignatureOfType,
  noteSingleClauseDeclared,
  noteSingleClauseOrigin,
  sameParameterDomain,
  singleClauseDeclared,
  singleClauseOrigin,
} from './clause-identity.js';
// The canonicalization-time install marker lives in the same leaf, because the
// Epsil static checker reads it too — a clause the canonical route did not
// install is not this program's first definition of anything, and must not be
// reported as one (`src/epsil/static-diagnostics.ts`). Re-exported so the
// engine's own callers keep importing it from here.
export {
  canonInstallSkipped,
  noteCanonInstallSkipped,
} from './clause-identity.js';
import {
  isEffectSubset,
  isPureEffectSet,
  sameEffectSet,
  unionEffectSets,
} from '../common/type/effects.js';
import { isSubtype, provablyDisjoint } from '../common/type/subtype.js';
import { isPolymorphicType } from '../common/type/instantiate.js';

import type {
  BoxedDefinition,
  Expression,
  IComputeEngine,
  OperatorDefinition,
} from './global-types.js';

import { isFunction, isSymbol } from './boxed-expression/type-guards.js';
import { operandSites } from './boxed-expression/binding-sites.js';
import {
  armAdmission,
  isMoreSpecific,
  triStateSelect,
} from './boxed-expression/overload.js';
import { hasValueComponent } from './boxed-expression/value-membership.js';
import { typeToString } from '../common/type/serialize.js';
import { isLiteralParamName } from '../math-json/symbols.js';
import {
  isOperatorDef,
  isValueDef,
  updateDef,
} from './boxed-expression/utils.js';
import {
  functionLiteralDeclaredEffects,
  functionLiteralParameters,
} from './boxed-expression/function-literal.js';
import {
  EffectContractError,
  inferFunctionLiteralEffects,
} from './boxed-expression/effects-inference.js';
import { apply, lookup } from './function-utils.js';
import { isMintedConstructor } from './type-constructors.js';
import { isProtocolDispatcher } from './engine-protocols.js';
import {
  ascribeDeclaredParameterTypes,
  assignValueAsOperatorDef,
  reconcileFunctionLiteralReturn,
} from './engine-declarations.js';
import { journalDefinitionRecord } from './boxed-expression/boxed-value-definition.js';

/**
 * Multi-clause function definitions — the engine half of the contract in
 * `docs/TYPE-SYSTEM.md`.
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
  /** REDEFINITION DISCIPLINE — which compilation unit and which defining
   * STATEMENT installed this clause, when it came in on the Epsil statement
   * route (`docs/TYPE-SYSTEM.md`). Present only
   * for a clause defined by an Epsil statement while a batch was live; a box-
   * route or host-API definition leaves it absent, which is what keeps those
   * routes freely replaceable. Consulted only when a later clause would
   * REPLACE this one — see `checkSameUnitClauseRedefinition`. */
  origin?: DeclarationOrigin;
  /** `true` for the clause of a **hold** function (Epsil `hold f(e) = …`):
   * the arguments are bound to the parameters as WRITTEN — canonical, bound
   * in the caller's scope, unevaluated — and evaluate where the body reads
   * them (call-by-name). This is the user-function spelling of an operator
   * definition's `lazy` flag: the installed definition is `lazy`, and the
   * selector applies the literal with `holdArguments`. A hold function is
   * SINGLE-CLAUSE — a literal-parameter clause admits on evaluated values,
   * which a hold definition never has — so it always lives in clause storage
   * (never the plain `_lambdaLiteral` representation) and refuses a second
   * clause, hold or not. */
  hold?: boolean;
  /** The definition ATTRIBUTES this clause was installed with, beyond
   * `hold`: the bound-variable parameters (`bind`), the algebraic flags and
   * the doc-comment description. Kept on the clause so a same-domain
   * REDEFINITION (which replaces the clause) carries its own attributes and
   * `installClauseList` rebuilds the definition from the surviving clause. */
  attributes?: ClauseAttributes;
}

/**
 * The attributes of a function DEFINITION statement — the optional third
 * operand of `DefineFunction`, a dictionary (`["DefineFunction", "f",
 * ‹literal›, {hold: True, bind: ["i"], commutative: True, description: "…"}]`),
 * decoded. Every field is optional; an absent bag is an ordinary definition.
 *
 * - `hold` — the arguments are bound to the parameters unevaluated
 *   (`FunctionClause.hold`).
 * - `bind` — the NAMES of the parameters that are BOUND VARIABLES: `hold
 *   mySum(body, bind i, n) = Sum(body, i, 1, n)`. Each such parameter must
 *   receive a symbol; at the call the parameter is SUBSTITUTED by that symbol
 *   in the body (so `Sum` re-canonicalizes with the caller's symbol as its
 *   index), and the installed definition is a BINDER (`scoped:
 *   operandSites(…)`), so the call node declares the symbol in its own scope
 *   exactly as `Sum` does. Requires `hold`.
 * - `commutative` / `associative` / `idempotent` / `involution` — the
 *   algebraic flags of an operator definition, applied by the engine when a
 *   CALL is canonicalized (operand sorting, flattening, `f(f(x))` folds). An
 *   associative user function is binary; a flattened n-ary call is folded
 *   left by the clause selector. Incompatible with `hold` (the engine's
 *   `lazy` flag is).
 * - `description` — the doc comment (`///` / `/** … *​/`) written before
 *   the definition, surfaced as the definition's `description` (`About`,
 *   editor hovers).
 */
export type ClauseAttributes = {
  hold?: boolean;
  bind?: readonly string[];
  commutative?: boolean;
  associative?: boolean;
  idempotent?: boolean;
  involution?: boolean;
  description?: string;
};

const ALGEBRAIC_FLAGS = [
  'commutative',
  'associative',
  'idempotent',
  'involution',
] as const;

/** True when the bag carries anything that only CLAUSE STORAGE can install:
 * `hold`, `bind`, or an algebraic flag. A bare `description` does not — the
 * plain single-clause representation takes it as a field. */
function needsClauseStorage(attrs: ClauseAttributes): boolean {
  return (
    attrs.hold === true ||
    (attrs.bind !== undefined && attrs.bind.length > 0) ||
    ALGEBRAIC_FLAGS.some((f) => attrs[f] === true)
  );
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
  /** The symbol's author-DECLARED signature, when the clause set accumulates
   * onto a name that was declared before it was defined (§4.3a). The
   * declaration is authoritative: every clause is checked as an ARM of it and
   * it stays the definition's signature instead of the clause intersection —
   * so a recursive clause body types its self-call against the declaration
   * (the whole point of declare-then-define). */
  declared: FunctionSignature | undefined;
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
    readonly code:
      | 'invalid-clause-definition'
      | 'incompatible-clause-effects'
      | 'generic-clause-unsupported'
      // A `hold` definition (Epsil `hold f(e) = …`) is single-clause; a
      // second clause — hold or ordinary — at a DIFFERENT parameter domain
      // is refused (same domain is a redefinition and replaces).
      | 'hold-single-clause'
      // A `hold` definition where the mechanism has no meaning: a declared
      // type's constructor (applied to values), or a GENERIC literal (a
      // generic definition installs through the plain single-clause path,
      // which a hold definition cannot take — see the `!hold` gate on the
      // single-clause shortcut in `defineFunctionClause`).
      | 'hold-unsupported'
      // A `hold` definition with a value-typed (literal) parameter — `hold
      // f(0) = …` — which would select the clause by an argument's VALUE that
      // a hold function never has. The parser diagnoses the Epsil spelling
      // (`hold-literal-parameter`); this is the same rule on the MathJSON /
      // host route, where the attribute is written directly.
      | 'hold-literal-parameter'
      // A `bind` parameter naming a parameter the literal does not have; an
      // algebraic flag on a `hold` definition (the engine's `lazy` flag is
      // incompatible with them), on a constructor or a generic function, or
      // with the wrong arity; clauses disagreeing on their flags.
      | 'invalid-definition-attribute'
      // A `bind` parameter on a definition that is not `hold` — the same
      // rule the Epsil parser reports under this code, so the MathJSON route
      // and the statement route agree.
      | 'bind-requires-hold',
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
 * the effects specifier removed (D5 — effects are symbol-level). The rule
 * itself lives in `clause-identity.ts`, shared with the Epsil static checker. */
function clauseSignatureOf(literal: Expression): FunctionSignature {
  return clauseSignatureOfType(literal.type.type);
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
// ─── Declare-then-define (§4.3a) ──────────────────────────────────────────
//

/**
 * The author-declared signature governing `id`, or `undefined` when the
 * binding carries none.
 *
 * "Declared" means the AUTHOR wrote the signature for the SYMBOL and nothing
 * has been defined under it yet — the string form
 * `ce.declare(f, "(…) -> …")` (value slot, no value) or the object form
 * `ce.declare(f, { signature: … })` (operator slot, no handler). A signature
 * DERIVED from an installed definition is NOT a declaration: an annotated
 * literal flips `inferredSignature` off (`assignValueAsOperatorDef`) and the
 * §6.3 reconciliation stores a literal under a non-inferred value type, so
 * without the "holds nothing yet" tests a clause-1 install would look declared
 * and its own domain would refuse every later clause. Once a clause SET exists
 * the declaration travels on its state instead.
 *
 * Only a PLAIN signature counts: an intersection is either our own clause
 * encoding or an overload declaration, neither of which is an arm contract
 * in v1.
 */
export function declaredSignatureOf(
  def: BoxedDefinition | undefined
): FunctionSignature | undefined {
  if (def === undefined) return undefined;
  const state = multiClauseState(def);
  if (state !== undefined) return state.declared;
  // A LONE clause installed under a declaration keeps the plain single-function
  // representation (§4.2), so there is no clause state to carry `declared` —
  // the side-channel below remembers it. Without this the declaration became
  // invisible the moment clause 1 installed: clause 2 was neither ascribed nor
  // arm-checked, and `let f: (integer) -> integer` / `f(n) = 1` / `f(m) = 2`
  // built the nonsense intersection
  // `((n: integer) -> integer) & ((unknown) -> number)` instead of reporting
  // the redefinition. Same problem, and the same fix, as SINGLE_CLAUSE_ORIGIN.
  const remembered = singleClauseDeclared(def);
  if (remembered !== undefined) return remembered;
  let t: Type | undefined;
  if (isValueDef(def)) {
    if (def.value.inferredType || def.value.value !== undefined)
      return undefined;
    t = def.value.type.type;
  } else if (isOperatorDef(def)) {
    if (def.operator.inferredSignature || def.operator.evaluate !== undefined)
      return undefined;
    t = def.operator.signature.type;
  }
  if (typeof t !== 'object' || t.kind !== 'signature') return undefined;
  // G2 (generic-function-literals design §2.6, rule 4): a `typeParams`-carrying
  // declaration is NOT an arm contract clause storage can check — every
  // `assertClauseFitsDeclared` comparison below would read the OPEN pattern
  // `T` as a ground type. Reporting "no declaration" hands the single-clause
  // case to `ce.assign`, which installs it through the generic boundary
  // (§2.4); a SECOND clause is refused outright by the G2 gate in
  // `defineFunctionClause`, so no polytype ever reaches clause storage.
  if (isPolymorphicType(t)) return undefined;
  return t;
}

/** True when a canonical `Function` literal states its own `where` clause
 * (the E1/E2/E4 spellings) — i.e. the incoming clause is GENERIC. */
export function isGenericClauseLiteral(literal: Expression): boolean {
  return isPolymorphicType(literal.type.type);
}

/** True when a clause carries a value-pattern (literal) parameter — a
 * parameter wearing the generated `literalParam_` name. Read from the NAME,
 * not from the annotation: erasure (§2.3) drops a quantified position's own
 * annotation, so by the time the clause arrives here the value type may be
 * gone while the generated name remains. */
function hasLiteralPatternParam(literal: Expression): boolean {
  return functionLiteralParameters(literal).some((p) =>
    isLiteralParamName(p.name)
  );
}

/** True when a clause has a VALUE-typed parameter — one whose declared type
 * has a value component (a literal type such as `0`, or a bounded numeric),
 * so admission depends on the argument's VALUE. Read from the TYPE, not the
 * name: on the MathJSON / host route a value-typed parameter is written as an
 * ordinary annotated one (`["Typed", "z", {str: "0"}]`) and carries no
 * generated `literalParam_` name. */
function hasValueParam(literal: Expression): boolean {
  return (
    clauseSignatureOf(literal).args?.some((a) => hasValueComponent(a.type)) ??
    false
  );
}

/**
 * REDEFINITION DISCIPLINE — the origin stamp of a SINGLE-clause definition,
 * which does not live in clause storage.
 *
 * §4.2 keeps a lone clause in the ordinary single-function representation
 * (`ce.assign`), so its stamp has nowhere to ride: `FunctionClause.origin`
 * only exists once a clause LIST does. Without this side-channel the very
 * shape the ruling targets — one function defined twice in one program,
 * `g(n) = 1` then `g(n) = 2` — would be invisible, because the second
 * definition reconstructs the first through {@link convertToClauseState},
 * which rebuilds the clause from the installed literal and would hand back a
 * clause with no origin to compare against.
 *
 * Weakly keyed on the definition RECORD, like {@link CANON_INSTALL_SKIPPED}:
 * it is mutated in place across installs and dies with its scope.
 */

/**
 * True when installing a clause onto `def` would produce a GENERIC target —
 * either because it already holds a generic function, or because it DECLARES
 * a polytype that a plain definition installs through (§2.4), which leaves
 * the target generic just the same.
 *
 * The distinction matters to a caller that must not install the same clause
 * twice: rule G2 refuses any clause onto a generic target, so an install that
 * makes the target generic cannot be repeated.
 * {@link holdsGenericDefinition} alone does not answer this — a bare
 * declaration has neither a value nor an evaluate handler, so it reads as
 * non-generic right up until the install that makes it generic.
 */
export function isGenericTarget(def: BoxedDefinition | undefined): boolean {
  if (def === undefined) return false;
  if (holdsGenericDefinition(def)) return true;
  if (isValueDef(def)) return isPolymorphicType(def.value.type.type);
  if (isOperatorDef(def)) return isPolymorphicType(def.operator.signature.type);
  return false;
}

export function holdsGenericDefinition(
  def: BoxedDefinition | undefined
): boolean {
  if (def === undefined) return false;
  const state = multiClauseState(def);
  if (state !== undefined)
    return state.clauses.some((c) => isPolymorphicType(c.signature));
  if (isValueDef(def))
    return (
      def.value.value !== undefined && isPolymorphicType(def.value.type.type)
    );
  if (isOperatorDef(def))
    return (
      def.operator.evaluate !== undefined &&
      isPolymorphicType(def.operator.signature.type)
    );
  return false;
}

/** True when `def` already holds a function BODY — clause state, a stored
 * value, or an evaluate handler. An incoming clause onto such a binding is
 * clause 2 (or a replacement of clause 1), i.e. multi-clause territory. */
function holdsDefinition(def: BoxedDefinition | undefined): boolean {
  if (def === undefined) return false;
  if (multiClauseState(def) !== undefined) return true;
  if (isValueDef(def)) return def.value.value !== undefined;
  if (isOperatorDef(def)) return def.operator.evaluate !== undefined;
  return false;
}

/** The declared type of positional parameter `i` (required, then optional,
 * then variadic); `undefined` when the signature takes no such parameter. */
function declaredParamAt(sig: FunctionSignature, i: number): Type | undefined {
  const nArgs = sig.args?.length ?? 0;
  if (i < nArgs) return sig.args![i].type;
  const nOpt = sig.optArgs?.length ?? 0;
  if (i < nArgs + nOpt) return sig.optArgs![i - nArgs].type;
  return sig.variadicArg?.type;
}

/**
 * Check one clause against the symbol's declared signature — ARM-shaped, not
 * function-subtype.
 *
 * A clause is a NARROWED arm of the declaration (`(0, complex) -> complex`
 * under `(number, complex) -> complex`): it accepts a SUBSET of the declared
 * domain, which is precisely what makes it a clause. Function subtyping is
 * contravariant in the parameters, so checking a clause that way can never
 * pass — the clause SET, not any single clause, implements the declaration.
 * So: each parameter type must be a subtype of the declared type at that
 * position, and the result a subtype of the declared result.
 *
 * An UNANNOTATED parameter is the exception. It infers `unknown` — the top
 * type, a subtype of nothing — so the positional test would reject every clause
 * that leaves a parameter bare, and `let f: (integer) -> integer` followed by
 * `f(n) = 1` failed as "parameter 1 of type "unknown" is outside the declared
 * "integer"". A bare parameter states no narrowing at all, so the arm it
 * describes is the DECLARED parameter itself: it is accepted here and the
 * declaration governs the call, exactly as it already did on the single-function
 * route (`ce.declare('h', '(integer) -> integer')` followed by
 * `ce.assign('h', n ↦ 1)` has always been accepted, so refusing the same shape
 * on the clause route was a route inconsistency rather than a rule).
 *
 * This does NOT stamp the declared type onto the clause — the reason
 * `ascribeDeclaredParameterTypes` (`engine-declarations.ts`) documents for
 * staying off this route. Stamping would re-canonicalize the body against a
 * narrower parameter and, applied generally, would make this very check
 * vacuous. Only the check is relaxed, and only where the author narrowed
 * nothing: an ANNOTATED parameter, including one annotated `0` or `string`, is
 * still checked positionally, so every narrowing clause is verified as before.
 */
function assertClauseFitsDeclared(
  id: string,
  clause: FunctionSignature,
  declared: FunctionSignature,
  bareParams: readonly boolean[]
): void {
  const reject = (why: string): never => {
    throw new ClauseDefinitionError(
      'invalid-clause-definition',
      `The clause "${typeToString(clause)}" is not an arm of the declared type "${typeToString(declared)}" of "${id}": ${why}`
    );
  };

  const params = clause.args ?? [];
  if (
    (clause.optArgs?.length ?? 0) > 0 ||
    clause.variadicArg !== undefined ||
    params.length < (declared.args?.length ?? 0)
  )
    reject('the clause does not cover the declared parameters');

  for (let i = 0; i < params.length; i++) {
    const d = declaredParamAt(declared, i);
    if (d === undefined)
      reject(`the declaration takes no parameter at position ${i + 1}`);
    // A BARE parameter narrows nothing, so its arm IS the declared parameter.
    // Keyed on what the author WROTE, not on the resulting type: the ascription
    // stamps most bare parameters to the declared type, but not all of them (a
    // declared type mentioning a quantified variable, or `unknown`/`any`, is
    // deliberately left alone), so those still arrive as `unknown` and must
    // pass. Testing the TYPE instead would also wave through an author-written
    // `x: unknown`, which is a stated arm and has to be checked like any other.
    else if (bareParams[i] === true) continue;
    else if (!isSubtype(params[i].type, d))
      reject(
        `parameter ${i + 1} of type "${typeToString(params[i].type)}" is outside the declared "${typeToString(d)}"`
      );
  }

  if (!isSubtype(clause.result, declared.result))
    reject(
      `the result type "${typeToString(clause.result)}" is not a subtype of the declared "${typeToString(declared.result)}"`
    );
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
  literal: Expression,
  origin?: DeclarationOrigin,
  attributes: ClauseAttributes = {}
): void {
  const hold = attributes.hold === true;
  const bind = attributes.bind ?? [];
  const algebraic = ALGEBRAIC_FLAGS.filter((f) => attributes[f] === true);
  if (!isFunction(literal, 'Function') || !literal.isCanonical)
    throw new ClauseDefinitionError(
      'invalid-clause-definition',
      `The definition of "${id}" is not a function literal`
    );

  const scope = ce.context.lexicalScope;

  // Constructor precedence (spec §4.7): a NOMINAL type declaration owns the
  // name engine-wide (types are registry-level, not scoped) — the
  // CONSTRUCTOR interpretation wins, and v1 has no constructor clauses.
  // Delegate to assignment: its constructor-function recognition installs
  // the smart constructor (nominal-types v2); re-defining it replaces the
  // constructor, the notebook re-run semantics that implementation pins. An
  // ALIAS's same-name function is an ordinary function (nominal spec §4.5),
  // so it falls through to normal clause accumulation below.
  const sameScopeType = ce._typeRegistry[id];
  if (sameScopeType?.def !== undefined && sameScopeType.alias !== true) {
    // A constructor is applied to VALUES (its arguments become the fields of
    // the instance), so it has no held form.
    if (hold)
      throw new ClauseDefinitionError(
        'hold-unsupported',
        `"${id}" is the constructor of a declared type; a type's constructor cannot be a hold function`
      );
    if (algebraic.length > 0)
      throw new ClauseDefinitionError(
        'invalid-definition-attribute',
        `"${id}" is the constructor of a declared type; a type's constructor cannot carry an algebraic attribute`
      );
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

  // A protocol DISPATCHER is shadowed the same way (protocols design P13,
  // Appendix A name-resolution step 1: "a lexically visible user definition of
  // the name shadows all protocol members"). Without this the dispatcher —
  // an operator definition with a native handler — would be read as an opaque
  // builtin below and REJECT the user's definition instead of replacing it.
  // The qualified form (`Comparable.compare(…)`) keeps reaching the protocol.
  //
  // Same-scope vs INHERITED, exactly as for a builtin: a dispatcher bound in
  // THIS scope is ours to replace (the top-level case), but one inherited from
  // an outer scope must be SHADOWED — and `ce.assign`, which the single-clause
  // path below delegates to, resolves the name through the whole scope chain
  // and mutates the definition it finds IN PLACE. A `function compare(…)`
  // inside a block would therefore replace the global dispatcher permanently,
  // the replacement outliving the block. `installClauseList` already declares
  // into the current scope when `existing` is undefined; only the single-clause
  // shortcut needs the flag.
  const shadowsDispatcher =
    isProtocolDispatcher(existing) && scope.bindings.get(id) !== existing;
  if (isProtocolDispatcher(existing)) existing = undefined;

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

  // G2 (generic-function-literals design §2.6, RULED — reject). Generic
  // clauses in a clause SET are out of scope for this milestone, in BOTH
  // directions, and the gate runs BEFORE any signature-assembly diagnostic so
  // the rejection names the real problem. A plain single-clause generic
  // definition is NOT rejected here: it falls through to the §4.2
  // single-clause rule below, which delegates to `ce.assign` and installs
  // through the generic declaration boundary (§2.4).
  //
  // Rule 1 — clause slot + literal parameter(s) (`function f<T>(0) { … }`) — is
  // refused at the FIRST definition, so it is deliberately NOT gated on
  // `existing`: value-clause machinery is multi-clause territory whether or not
  // anything is bound yet. Without it the §4.2 single-clause shortcut below
  // hands the literal to `ce.assign` unchecked, and erasure has already dropped
  // the value annotation at a quantified marker position — the value guard
  // would silently vanish.
  // A hold definition is refused where hold has no meaning or no
  // implementation: a value-typed (literal) parameter admits on an evaluated
  // VALUE, which a hold function never has; and a generic literal installs
  // only through the plain single-clause path (the G2 rule below), which a
  // hold definition cannot take (see the `!hold` gate on that shortcut).
  if (hold && (hasLiteralPatternParam(literal) || hasValueParam(literal)))
    throw new ClauseDefinitionError(
      'hold-literal-parameter',
      `"${id}" is a hold function; a hold function cannot have a literal parameter (it never evaluates its arguments)`
    );
  if (hold && isGenericClauseLiteral(literal))
    throw new ClauseDefinitionError(
      'hold-unsupported',
      `"${id}" is a generic function; a generic function cannot be a hold function`
    );

  // Attribute consistency (see `ClauseAttributes`).
  const paramNames = functionLiteralParameters(literal).map((p) => p.name);
  if (bind.length > 0 && !hold)
    throw new ClauseDefinitionError(
      'bind-requires-hold',
      `"${id}" has a bound-variable (bind) parameter, so it must be a hold function`
    );
  for (const b of bind)
    if (!paramNames.includes(b))
      throw new ClauseDefinitionError(
        'invalid-definition-attribute',
        `"${id}" has no parameter named "${b}" to bind`
      );
  if (algebraic.length > 0 && hold)
    throw new ClauseDefinitionError(
      'invalid-definition-attribute',
      `"${id}" cannot be both a hold function and ${algebraic.join('/')}: a hold function's arguments are not evaluated, so its calls are not reordered or flattened`
    );
  if (algebraic.length > 0 && isGenericClauseLiteral(literal))
    throw new ClauseDefinitionError(
      'invalid-definition-attribute',
      `"${id}" is a generic function; a generic function cannot carry an algebraic attribute`
    );
  if (
    (attributes.associative === true || attributes.commutative === true) &&
    paramNames.length < 2
  )
    throw new ClauseDefinitionError(
      'invalid-definition-attribute',
      `"${id}" is ${attributes.associative ? 'associative' : 'commutative'} but takes fewer than two parameters`
    );
  if (attributes.associative === true && paramNames.length !== 2)
    throw new ClauseDefinitionError(
      'invalid-definition-attribute',
      `"${id}" is associative, so it must be binary (a call with more arguments is folded pairwise)`
    );
  if (
    (attributes.idempotent === true || attributes.involution === true) &&
    paramNames.length !== 1
  )
    throw new ClauseDefinitionError(
      'invalid-definition-attribute',
      `"${id}" is ${attributes.idempotent ? 'idempotent' : 'an involution'}, so it must take exactly one parameter`
    );

  if (isGenericClauseLiteral(literal) && hasLiteralPatternParam(literal))
    throw new ClauseDefinitionError(
      'generic-clause-unsupported',
      `"${id}" cannot combine a generic clause with a literal parameter; generic functions are single-clause`
    );
  if (holdsGenericDefinition(existing))
    throw new ClauseDefinitionError(
      'generic-clause-unsupported',
      `"${id}" is defined by a generic function; it cannot be extended with clauses`
    );
  if (isGenericClauseLiteral(literal) && holdsDefinition(existing))
    throw new ClauseDefinitionError(
      'generic-clause-unsupported',
      `A generic clause cannot be added to "${id}", which is already defined; generic functions are single-clause`
    );

  // §4.3a — declare-then-define (the prescribed shape for a recursive
  // definition). When `id` carries an author-declared signature, it is
  // authoritative: ascribe its result onto an unannotated clause body (the
  // same reconciliation `ce.assign` performs for a plain definition), then
  // check the clause as an ARM of it.
  const declared = declaredSignatureOf(existing);
  // Which parameter positions the author left BARE, captured BEFORE the
  // ascription below stamps them — afterwards a stamped parameter is
  // indistinguishable from one the author annotated. `assertClauseFitsDeclared`
  // needs the distinction: a bare parameter narrows nothing and its arm is the
  // declared parameter, but an author-written `x: unknown` is a stated arm and
  // must still be checked against the declared domain like any other.
  const bareParams = isFunction(literal, 'Function')
    ? literal.ops.slice(1).map((p) => !isFunction(p, 'Typed'))
    : [];
  if (declared !== undefined) {
    // PARAMETERS first, then the result. A bare parameter otherwise types as
    // `unknown` inside the body, and everything computed from it widens: under
    // `let fact: (integer) -> integer`, `fact(n) = n * fact(n - 1)` read `n - 1`
    // as `number` and the self-call then violated the declaration it was
    // written against. Only BARE parameters are stamped — an annotated one is
    // the author's narrowing and is left alone, so `assertClauseFitsDeclared`
    // below still checks every clause that narrows.
    //
    // Ordering is load-bearing: the result reconciliation reads the body's
    // INFERRED result, so the body has to have been canonicalized against the
    // declared parameter types before it runs, or it reconciles against a
    // result derived from `unknown` parameters.
    literal = ascribeDeclaredParameterTypes(ce, literal, declared, {
      includeScalar: true,
    });
    literal = reconcileFunctionLiteralReturn(ce, literal, declared);
  }

  const incoming: FunctionClause = {
    signature: clauseSignatureOf(literal),
    literal,
    ...(origin !== undefined ? { origin } : {}),
    ...(hold ? { hold: true } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
  };
  if (declared !== undefined)
    assertClauseFitsDeclared(id, incoming.signature, declared, bareParams);

  const incomingExplicit = functionLiteralDeclaredEffects(literal);

  // Existing clause state, or the conversion of a pre-existing single
  // user-function definition into its 1-clause equivalent.
  const state = multiClauseState(existing) ?? convertToClauseState(existing);

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
  //
  // REDEFINITION DISCIPLINE (user ruling 2026-08-14): a REPLACEMENT is refused
  // when the clause it would overwrite was defined by a different statement of
  // the SAME compilation unit. That is precisely the silent, value-changing
  // overwrite the ruling targets; an APPEND — a clause at a distinct parameter
  // list — is the multi-clause idiom and passes untouched. Across units the
  // replacement stands (the notebook re-run gesture), and both routes with no
  // origin stamp (box route, host API) are exempt.
  //
  // Checked BEFORE the prospective state is mutated, so a refused clause
  // leaves the installed definition byte-identical — the same discipline the
  // effect-row checks below observe.
  const at = clauses.findIndex((c) =>
    sameParameterDomain(c.signature, incoming.signature)
  );
  if (at >= 0) {
    checkSameUnitClauseRedefinition(id, clauses[at].origin, origin);
    clauses[at] = incoming;
  } else clauses.push(incoming);

  // A hold function is single-clause (see `FunctionClause.hold`): a hold
  // clause cannot join an existing clause set, and an ordinary clause cannot
  // join a hold definition. Replacing the lone clause in place — the same
  // parameter domain — is a redefinition and passes, in either direction.
  if (clauses.length > 1 && clauses.some((c) => c.hold === true))
    throw new ClauseDefinitionError(
      'hold-single-clause',
      `A hold function is single-clause: "${id}" cannot combine a hold definition with another clause`
    );
  // The algebraic flags describe the OPERATOR, so every clause of a
  // definition must state the same ones (the flags are read at call
  // canonicalization, before any clause is selected).
  if (clauses.length > 1) {
    const flagsOf = (c: FunctionClause) =>
      ALGEBRAIC_FLAGS.filter((f) => c.attributes?.[f] === true).join(',');
    const first = flagsOf(clauses[0]);
    if (clauses.some((c) => flagsOf(c) !== first))
      throw new ClauseDefinitionError(
        'invalid-definition-attribute',
        `The clauses of "${id}" disagree on its algebraic attributes (commutative/associative/idempotent/involution); every clause must state the same ones`
      );
  }

  // §4.2: a SINGLE clause keeps today's single-function representation —
  // no behavior change until a second clause exists. Assignment installs
  // the ordinary user-function definition (operator slot, `_lambdaLiteral`),
  // so every consumer of that representation (differentiation, closure
  // capture, compile) is untouched; conversion to clause storage happens
  // when the second clause arrives.
  //
  // A clause that NARROWS a declared signature is the exception: installing
  // it as the plain definition would make the symbol total over the declared
  // domain (`J(5, z)` would apply the `J(0, z)` body), so it goes to clause
  // storage right away and a call outside its domain is the D7
  // `no-matching-clause` error. A clause covering the declared domain
  // exactly is the ordinary declare-then-assign shape and keeps it.
  //
  // A HOLD clause never takes the shortcut: the plain representation applies
  // the literal to EVALUATED arguments (its operator definition is not
  // `lazy`), and the declare-then-assign spelling stores the literal as a
  // VALUE, where no `lazy` flag exists at all. Clause storage is the one
  // representation whose dispatch (`selectAndApply`) can hand the literal its
  // arguments unevaluated.
  if (
    !needsClauseStorage(attributes) &&
    clauses.length === 1 &&
    multiClauseState(existing) === undefined &&
    (declared === undefined ||
      sameParameterDomain(incoming.signature, declared))
  ) {
    // A REDEFINITION restates the whole definition, its effect annotation
    // included. `ce.assign` installs a body, not a signature, so the previous
    // definition's annotation PROVENANCE would otherwise survive it: after
    // `function h(x: integer) pure -> integer { x }`, redeclaring
    // `function h(x: integer) -> integer { x }` kept `pure` on the signature,
    // and redeclaring it `random` was refused as `incompatible-type` against
    // the contract the author had just rewritten away. Cross-unit redefinition
    // has REPLACEMENT semantics (`docs/TYPE-SYSTEM.md`), so the incoming
    // statement is the whole
    // truth about its own effects.
    //
    // Only when there is no author DECLARATION in force: under
    // `let f: (integer) pure -> integer` the declaration is the contract and a
    // later clause is checked against it (§4.3a), which is the case `declared`
    // marks.
    // Written only once the install SUCCEEDS, per this file's rule that the
    // installed state is never mutated before the checks: `ce.assign` refuses a
    // redefinition that widens the effect annotation (it validates the incoming
    // literal against the binding's existing signature — the open widening
    // defect recorded in `ROADMAP.md`), and a refused statement that had
    // already flipped this flag would leave the surviving `pure` definition
    // claiming it declares nothing, which `contractViolation` reads.
    const retarget =
      declared === undefined &&
      existing !== undefined &&
      isOperatorDef(existing)
        ? existing.operator
        : undefined;
    const priorDeclared = retarget?.effectsDeclared;
    // Checkpoint journal (funnel 5): `retarget` is the operator half in force
    // BEFORE the install below, and the refusal path in the `catch` writes
    // `effectsDeclared` back onto it — a write to a pre-existing record that
    // reaches no other hook, since the install that would have journaled it
    // is the one that just threw. Recorded here rather than in the `catch` so
    // the snapshot predates the install's own writes.
    //
    // The write after a SUCCESSFUL install lands on an orphan: `ce.assign`
    // routes to `updateDef`, which constructs a fresh
    // `_BoxedOperatorDefinition` for a plain-object definition and swaps the
    // record's pointer to it, so `retarget` is no longer what the binding
    // holds. That write is dead rather than wrong — the installed half
    // derives the same `effectsDeclared` from the incoming literal — but it
    // is dead only for as long as that derivation agrees; see the ROADMAP
    // entry "Dead post-install `effectsDeclared` write in
    // `defineFunctionClause`".
    if (retarget !== undefined) journalDefinitionRecord(ce, retarget, 'redefine');
    try {
      if (shadowsDispatcher) declareShadowingFunction(ce, id, literal);
      else ce.assign(id, literal);
    } catch (e) {
      if (retarget !== undefined && priorDeclared !== undefined)
        retarget.effectsDeclared = priorDeclared;
      throw e;
    }
    if (retarget !== undefined)
      retarget.effectsDeclared = incomingExplicit !== undefined;
    // The doc-comment description rides on the plain representation as a
    // field: written directly rather than through `_update()`, which would
    // rebuild the definition's evaluate handler for a one-string change.
    if (attributes.description !== undefined) {
      const plain = lookupInScope(ce, id);
      if (plain !== undefined && isOperatorDef(plain))
        plain.operator.description = attributes.description;
    }
    // Stamp the installed record so a SECOND definition of this same lone
    // clause, later in the same program, can see whose it was — the shape the
    // redefinition ruling targets. Read back by `convertToClauseState`.
    const installed = lookupInScope(ce, id);
    noteSingleClauseOrigin(installed, origin);
    // …and remember the DECLARATION the same way, so a later clause of this
    // same name is still ascribed and arm-checked against it (§4.3a). The
    // plain representation has nowhere else to keep it.
    noteSingleClauseDeclared(installed, declared);
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

  // ── The default-`!scope` ceiling, for the CLAUSE route ──
  //
  // A named definition that states no effect contract promises it does not
  // mutate the world: an escaping write (an assignment to a variable the body
  // does not own, or an `Assume`) must be opted into with the `scope` effect —
  // `function f(…) scope { … }` or a `(…) scope -> …` signature. See
  // `docs/EFFECTS-MODEL.md`, "Scope is opt-in".
  //
  // The single-clause path gets this from the operator definition's
  // constructor, which walks the body it is handed. Clause storage cannot:
  // `installClauseList` builds `evaluate` as a JS dispatch function and hands
  // the definition an already-unioned effect row as an author-STATED one, so
  // the constructor's walk-and-gate never runs on a clause body. Hence this
  // gate — only for the clause the caller is admitting right now, since every
  // clause already in the list was gated when IT was admitted (the first one
  // by the `ce.assign` shortcut above).
  //
  // The trigger is the walk's PROVEN-mutation bit, never the `scope` label of
  // the inferred set: an unresolved forward-referenced head contributes `{any}`
  // without proving anything, and gating on that would break mutual recursion.
  // The gate is skipped entirely when the AUTHOR stated a row — an explicit
  // clause specifier or a symbol row established by an earlier clause (D5), or
  // an effect-carrying declared signature. Those are checked against every
  // clause by the subset test above instead.
  if (effectRow.explicit === undefined && declared?.effects === undefined) {
    const inferred = inferFunctionLiteralEffects(ce, incoming.literal, {
      selfName: id,
    });
    if (inferred.escapingWrite)
      throw new EffectContractError(
        id,
        undefined,
        inferred.effects,
        undefined,
        /* scopeDefault */ true
      );
  }

  installClauseList(ce, id, existing, clauses, effectRow, declared);
}

/** Convert a pre-existing single user-function definition — an operator
 * definition holding a function literal, or a value definition holding a
 * literal under a declared signature — into its 1-clause state. Returns
 * `undefined` when the definition holds no recoverable literal. */
function convertToClauseState(
  def: BoxedDefinition | undefined
): MultiClauseState | undefined {
  if (def === undefined)
    return {
      clauses: [],
      effectRow: { explicit: undefined },
      declared: undefined,
    };

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

  // The reconstructed clause carries the origin the single-clause install
  // recorded on the side (`noteSingleClauseOrigin`), so a second definition of
  // the same lone clause within one program is seen as the redefinition it is.
  const origin = singleClauseOrigin(def);
  // A plain single-clause install keeps a doc-comment description on the
  // operator definition itself (`defineFunctionClause`, the shortcut path);
  // carry it onto the reconstructed clause so converting to clause storage —
  // a second overload arriving — does not lose it.
  const description =
    isOperatorDef(def) && typeof def.operator.description === 'string'
      ? def.operator.description
      : undefined;
  return {
    clauses: [
      {
        signature: clauseSignatureOf(canonical),
        literal: canonical,
        ...(origin !== undefined ? { origin } : {}),
        ...(description !== undefined ? { attributes: { description } } : {}),
      },
    ],
    effectRow: { explicit: functionLiteralDeclaredEffects(canonical) },
    declared: declaredSignatureOf(def),
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
 * Give `id` a binding in the CURRENT scope when it only has one further out,
 * so that the clause `defineFunctionClause` is about to install lands here
 * instead of being written through to the enclosing definition.
 *
 * This is the RUNTIME half of the rule that a one-step function definition
 * written inside a block or a function body is block-local: it binds where it
 * is written, SHADOWS a same-named outer function rather than overwriting it,
 * and dies with the frame. `canonicalBlock` (library/control-structures.ts)
 * enforces the same rule at canonicalization time by hoisting the name into
 * the block's own scope; that hoisted binding is not in the chain at
 * evaluation time (a call frame is built from the parameters alone — see
 * `makeLambda` step 5 in function-utils.ts), which is why the runtime needs
 * its own shell. The two-step form `let f; f(x) = …` gets exactly this from
 * `Declare`'s evaluate handler, which declares its name in the current scope.
 *
 * Two names are deliberately left to write through:
 * - one already bound in the current scope — that is the accumulation target
 *   (a second clause, or a redefinition in the same scope);
 * - one owned by a declared nominal type, whose definition is a smart
 *   CONSTRUCTOR definition: types are engine-global rather than scoped, so
 *   the definition has to reach the type's constructor.
 *
 * A BUILTIN is left alone too: `defineFunctionClause` already recognizes a
 * system-scope definition and shadows it rather than accumulating onto it.
 */
export function declareLocalClauseTarget(ce: IComputeEngine, id: string): void {
  const scope = ce.context.lexicalScope;
  if (scope.bindings.has(id)) return;
  if (ce._typeRegistry[id]?.def !== undefined) return;
  const existing = lookupInScope(ce, id);
  if (existing === undefined) return;
  const systemScope = ce.contextStack[0]?.lexicalScope;
  if (systemScope?.bindings.get(id) === existing) return;
  ce.declare(id, 'function');
}

/**
 * Install `literal` as a NEW definition in the CURRENT scope, leaving whatever
 * the enclosing scopes bind `id` to untouched. The definition is the one
 * `ce.assign` builds for a function literal — so a shadowing clause and a
 * replacing clause install the same representation — but it is DECLARED here
 * rather than assigned, and assignment is what walks the scope chain.
 */
function declareShadowingFunction(
  ce: IComputeEngine,
  id: string,
  literal: Expression
): void {
  const def = assignValueAsOperatorDef(ce, literal);
  // `assignValueAsOperatorDef` returns `undefined` only for values that are
  // not function literals — which the caller has already excluded — but a
  // shadowing install must never be the thing that drops a definition.
  if (def === undefined) ce.assign(id, literal);
  else ce.declare(id, def);
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
  // A clause set accumulating onto a DECLARED signature keeps it: that
  // declaration is exactly what a recursive clause's self-call is meant to
  // validate (and type) against — loosening it to `'function'` would put the
  // self-call back at `unknown` (§4.3a).
  if (declaredSignatureOf(binding) !== undefined) return undefined;
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
 * signature (row stamped on every arm, D5) — or the author's DECLARED
 * signature when there is one (§4.3a) — plus the selecting `evaluate` and the
 * marker. */
function installClauseList(
  ce: IComputeEngine,
  id: string,
  existing: BoxedDefinition | undefined,
  clauses: FunctionClause[],
  effectRow: EffectRowState,
  declared: FunctionSignature | undefined
): void {
  const row =
    effectRow.explicit ??
    clauses.reduce<EffectSet | undefined>(
      (acc, c) => unionEffectSets(acc, inferredEffectsOf(c.literal)),
      undefined
    );

  const attrs0 = clauses[0].attributes ?? {};
  const arms: FunctionSignature[] = clauses.map((c) => {
    let sig: FunctionSignature =
      row === undefined || isPureEffectSet(row)
        ? c.signature
        : { ...c.signature, effects: row };
    // An ASSOCIATIVE function is written binary, but call canonicalization
    // flattens nested calls (`op(a, op(b, c))` → `op(a, b, c)`), so its
    // signature must admit any number of further operands of the second
    // parameter's type; `selectAndApply` folds them pairwise.
    if (
      attrs0.associative === true &&
      sig.args !== undefined &&
      sig.args.length === 2
    )
      sig = {
        ...sig,
        variadicArg: { type: sig.args[1].type },
        variadicMin: 0,
      };
    return sig;
  });
  const signature: Type =
    declared ??
    (arms.length === 1 ? arms[0] : { kind: 'intersection', types: arms });

  const frozen = [...clauses];
  // A hold definition is `lazy` — its operands reach `evaluate` unevaluated
  // (and, from the box or parse route, unbound) — and single-clause, so the
  // whole set is hold or none of it is; its attributes are the lone
  // clause's. The algebraic flags are uniform across clauses (checked
  // above), so the first clause's are the definition's.
  const hold = clauses.some((c) => c.hold === true);
  const attrs = attrs0;
  const bindPositions = (attrs.bind ?? []).map((name) =>
    functionLiteralParameters(clauses[0].literal).findIndex(
      (p) => p.name === name
    )
  );
  const flags = Object.fromEntries(
    ALGEBRAIC_FLAGS.filter((f) => attrs[f] === true).map((f) => [f, true])
  );
  // The description is the MOST RECENT documented clause's — a doc comment on
  // a later overload updates it — independently of the flags, which are the
  // first clause's (uniform across the set).
  const documented = [...clauses]
    .reverse()
    .find((c) => c.attributes?.description !== undefined);
  const def: OperatorDefinition = {
    description:
      documented?.attributes?.description ??
      (hold
        ? 'Hold function (arguments are bound unevaluated)'
        : `Multi-clause function (${clauses.length} clause${clauses.length === 1 ? '' : 's'})`),
    ...(row !== undefined && !isPureEffectSet(row)
      ? { effects: row }
      : { pure: true }),
    lazy: hold,
    // A `bind` parameter makes the definition a BINDER: the call node
    // declares the symbol passed at that position in its own scope (the
    // same mechanism `Sum`/`D` use), so route parity and shadowing are the
    // framework's, not improvised here.
    ...(bindPositions.length > 0
      ? { scoped: operandSites(...bindPositions) }
      : {}),
    ...flags,
    signature,
    evaluate: (ops, options) =>
      selectAndApply(ce, id, frozen, ops, options, hold, attrs),
  };

  if (existing !== undefined) updateDef(ce, id, existing, def);
  else ce.declare(id, def);

  const installed = lookupInScope(ce, id);
  if (installed !== undefined && isOperatorDef(installed)) {
    (installed.operator as unknown as MultiClauseMarker)[MULTI_CLAUSE] = {
      clauses,
      effectRow,
      declared,
    };
    // Checkpoint journal (funnel 5): a bare-field write on a half that may
    // pre-date this install. Today `updateDef` constructs a fresh operator
    // half for every plain-object definition, so the target is always
    // window-created and a restore drops it wholesale — but that is an
    // invariant of `updateDef`'s dispatch, not of this call, and an
    // identity-preserving fast path there would silently turn this write into
    // an unjournaled mutation of a pre-existing record.
    journalDefinitionRecord(ce, installed.operator, 'redefine');
    // Lets the call-time broadcast arms treat this definition as user code
    // (see `_BoxedOperatorDefinition._isMultiClause`).
    (installed.operator as { _isMultiClause?: boolean })._isMultiClause = true;
  }
  // A multi-clause install mutates an operator definition in place.
  ce._noteStateEvent({
    kind: 'redefine',
    callableBefore: true,
    callableAfter: true,
  });
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
  options: { numericApproximation?: boolean },
  hold = false,
  attrs: ClauseAttributes = {}
): Expression | undefined {
  // An ASSOCIATIVE user function is binary, but call canonicalization
  // flattens `op(a, op(b, c))` to `op(a, b, c)`: fold such a call pairwise
  // from the left, `op(op(a, b), c)`, so the literal always sees two
  // arguments. Each step re-enters the definition through the ordinary call
  // route, so the fold composes with the clause selection below.
  if (attrs.associative === true && ops.length > 2) {
    let acc = ce.function(id, [ops[0], ops[1]]).evaluate(options);
    for (let i = 2; i < ops.length; i++)
      acc = ce.function(id, [acc, ops[i]]).evaluate(options);
    return acc;
  }

  // A definition that is in clause storage ONLY because of its attributes —
  // hold, bind, or an algebraic flag on a lone clause — has nothing to
  // select between and is applied like the plain single-function
  // representation would apply it: unless an operand is REFUTED (wrong
  // arity, a type provably outside the parameter's), the literal runs, and
  // strict mode's own argument validation inside it does the rest.
  // `triStateSelect`'s tri-state verdict is not used here on purpose: it
  // keeps a call INERT ("blocked") when an operand's type is `unknown` —
  // the right caution when several clauses compete on evaluated values, and
  // for a lone clause that NARROWS a declared signature (which stays on the
  // selecting path below) — but for these definitions it would make
  // `op(x, y)` inert where `f(x, y)` without the flag evaluates, and for a
  // hold function, whose operands are unevaluated expressions and very often
  // `unknown`-typed, it would defeat the one thing the function exists to do.
  const permissive =
    hold || (clauses.length === 1 && needsClauseStorage(attrs));
  if (permissive) {
    // A hold definition is `lazy`, so its operands arrive as written — and
    // from the box or parse route still UNBOUND. `.canonical` binds their
    // structure (a value-safe step: no assigned symbol value is substituted)
    // so that admission reads real types and the literal binds real
    // expressions.
    if (hold) ops = ops.map((op) => op.canonical);
    // A `bind` parameter must receive a SYMBOL — it is the bound variable
    // the caller names (`mySum(k^2, k, 3)`); anything else is an error
    // value, exactly as `Sum(k^2, 3, 1, 3)` is.
    const bindNames = attrs.bind ?? [];
    if (bindNames.length > 0) {
      const params = functionLiteralParameters(clauses[0].literal);
      for (let i = 0; i < ops.length && i < params.length; i++)
        if (bindNames.includes(params[i].name) && !isSymbol(ops[i]))
          return ce._fn('Error', [
            ce.string('bind-symbol-expected'),
            ce.function(id, [...ops], { form: 'raw' }),
          ]);
    }
    if (armAdmission(ops, clauses[0].signature) !== 'refute')
      return apply(clauses[0].literal, ops, {
        numericApproximation: options.numericApproximation,
        ...(hold ? { holdArguments: true } : {}),
        ...(hold && attrs.bind !== undefined && attrs.bind.length > 0
          ? { bindParameters: attrs.bind }
          : {}),
      });
    return ce._fn('Error', [
      ce.string('no-matching-clause'),
      ce.function(id, [...ops], { form: 'raw' }),
    ]);
  }

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
