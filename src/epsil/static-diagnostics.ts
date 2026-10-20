import type { MathJsonExpression } from '../math-json/types.js';
import {
  checkDeadline,
  isTimeoutCancellation,
} from '../common/interruptible.js';
import {
  isDictionaryObject,
  machineValue,
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import type {
  EffectSet,
  FunctionSignature,
  Type,
  TypeString,
} from '../common/type/types.js';
import {
  isGroupedTypeText,
  isWildcardFunctionType,
  signatureEffects,
  withParameterNamesOf,
} from '../common/type/utils.js';
import { isSubtype } from '../common/type/subtype.js';
import { typesOverlap } from '../common/type/reduce.js';
import { parseType } from '../common/type/parse.js';
import { typeToString } from '../common/type/serialize.js';
import { isPolymorphicType } from '../common/type/instantiate.js';

// Type-only import: like `execute-epsil.ts`, this module never statically
// imports the engine — the engine is injected at call time.
import type { ComputeEngine } from '../compute-engine.js';

// RUNTIME imports, but not of the engine: `type-compatibility-error.ts` and
// `type-guards.ts` are engine-free leaves (their only runtime dependency is
// `common/type`), so the injected-engine rule above is preserved.
// `unboundSignatureHint` supplies the same near-miss wording the runtime
// declared-type check uses, so the static and runtime messages never drift.
import { unboundSignatureHint } from '../compute-engine/boxed-expression/type-compatibility-error.js';
// The two halves of literal narrowing, imported rather than restated so that
// this pass and the runtime cannot disagree about which string literals become
// characters: `expectsCharacterNotString` decides which declared types trigger
// the conversion, `isSingleGraphemeCluster` decides which literals qualify.
import { expectsCharacterNotString } from '../compute-engine/boxed-expression/validate.js';
import { isSingleGraphemeCluster } from '../compute-engine/boxed-expression/boxed-character.js';
import {
  functionLiteralDeclaredSignature,
  functionLiteralReturnType,
} from '../compute-engine/boxed-expression/function-literal.js';
import {
  functionLiteralHasAnnotation,
  reassignmentBaseSignature,
  validationSignatureOf,
} from '../compute-engine/engine-declarations.js';
import {
  inferTypeFromValue,
  refineConstructorPlaceholder,
  widenAssignedType,
} from '../compute-engine/boxed-expression/boxed-value-definition.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';

import type { ParsingDiagnostic } from './diagnostics.js';
import { documentBindings, type BindingGroup } from './occurrences.js';
import { binderSitesOf } from './resolve-library-names.js';
import { serializeEpsil } from './serialize-epsil.js';
import { definitionSites } from './definition-sites.js';
import {
  enclosingFrame,
  locateError,
  type ErrorFrameRef,
} from './error-location.js';
import {
  calleeSlotNames,
  errorIndexCountsWrittenArguments,
} from '../compute-engine/boxed-expression/named-arguments.js';
import {
  isOperatorDef,
  isValueDef,
} from '../compute-engine/boxed-expression/utils.js';
// `clause-identity.ts` is an engine-free leaf too (its only runtime dependency
// is `common/type/subtype.js`), so the redefinition discipline's two tiers can
// share ONE definition of clause identity without this module importing the
// engine — the same arrangement as `unboundSignatureHint` above.
import {
  canonInstallSkipped,
  noteCanonInstallSkipped,
  clauseSignatureOf,
  sameParameterDomain,
} from '../compute-engine/clause-identity.js';
import { signatureNotes } from './signature-notes.js';
import { readsBeforeAssignment } from './read-before-assignment.js';
import {
  matchExhaustivenessDiagnostics,
  type AnnotationScope,
} from './match-exhaustiveness.js';

/**
 * `locateError`'s slot-name resolver, bound to an engine: the callee's
 * declared parameter names, by operator name, for anchoring a diagnostic
 * inside a NAMED call (the seam permutes such a call into declaration order,
 * so a frame's argument index counts declaration slots while the source
 * lists the arguments as written).
 *
 * Exported for `execute-epsil.ts`, which keeps its no-static-engine-imports
 * discipline (the engine is injected there); this module already imports
 * engine internals, so the one runtime dependency lives here. The same
 * routing applies to {@link frameOrderOf}.
 */
export function calleeSlotNamesResolver(
  ce: ComputeEngine
): (operatorName: string) => readonly (string | undefined)[] | undefined {
  return (operatorName) => calleeSlotNames(ce, operatorName);
}

/**
 * Which order an error's frame indexes count in — `'written'` for the
 * named-argument seam's own normalization failures (the call was never
 * permuted), `'declaration'` for everything else. See
 * `errorIndexCountsWrittenArguments` (boxed-expression/named-arguments.ts)
 * for why the two exist.
 */
export function frameOrderOf(code: string): 'declaration' | 'written' {
  return errorIndexCountsWrittenArguments(code) ? 'written' : 'declaration';
}

/** Longest Epsil snippet quoted in a `static-type-error` message. */
const SNIPPET_LENGTH = 60;

/**
 * The error codes **canonicalization** mints: the `ce.error(…)` and
 * `ce.typeError(…)` calls of `boxed-expression/validate.ts` (argument
 * arity/type checking) and of the canonical handlers that use the same
 * machinery. `expected-…` codes (`expected-value`, `expected-pure-expression`,
 * `expected-matrix`, …) are matched by prefix rather than enumerated.
 *
 * Errors are values in Epsil: `Error("boom")` — or even
 * `Error(ErrorCode("incompatible-type", …))` — is a legitimate value a program
 * may construct, not a static problem. The walk therefore reports an `Error`
 * node only when its code is one the *engine* produces **and** the node is not
 * attributable to an `Error` the source itself authored (see `authoredErrors`).
 */
const CANONICALIZATION_ERROR_CODES = new Set([
  // A `let`/`const` that re-declares a name its own scope already declares —
  // a parameter, a loop index, an earlier `let` of the block — is refused by
  // `canonicalBlock` (`library/control-structures.ts`, user ruling
  // 2026-09-05), so it is a canonicalization error and belongs on the static
  // route. The top level has no block: `variableRedeclarationDiagnostic`
  // reports it there.
  'variable-redeclaration',
  // A SECOND implementation block for one (type, protocol) pair in this batch
  // (ruling P47). The pre-pass registers conformances from the canonical
  // handler, so it is the pass that sees the collision first — and, unlike the
  // other protocol-statement codes, this one is a property of the PROGRAM (two
  // blocks in one compilation unit), which is exactly what a static diagnostic
  // reports.
  'protocol-implementation-duplicate',
  // Named-argument matching (`f(rate: 0.05)`): the engine matches the parse
  // carriers against the callee's declared parameter names while it
  // canonicalizes the call, so every failure of that match is a
  // canonicalization error and belongs on the static route.
  'argument-name-unknown',
  'argument-order-invalid',
  'argument-name-duplicate',
  'argument-names-unavailable',
  'argument-optional-skipped',
  'argument-names-required',
  // A dotted call of a function that is not a protocol member (`xs.Sort()`).
  // The `MemberCall` canonical handler (`library/collections.ts`) refuses it
  // once the receiver's static type is decided, so it is a canonicalization
  // error and `epsil check` can report it.
  'dot-call-not-a-protocol-function',
  // A collection operator's callback declares a different number of
  // parameters than the operator passes it (`Map((p, q) => p + q, xs)`). The
  // operators mint it from their canonical handlers, so — like the
  // named-argument codes above — it is settled before anything runs.
  'callback-arity',
  // The same mismatch at a pipe STAGE (`xs |> (p, q) => p + q`), which is a
  // separate code because a pipe is not a callback slot and its remedy is the
  // call form rather than a tuple pattern. Minted by `Pipe`'s canonical
  // handler, so it is settled before anything runs too.
  'pipe-stage-arity',
  // A product between two POINTS (`tuple · tuple`), which has no implicit
  // dot/cross reading. Minted by `canonicalMultiply` (and by `mulTuples` for a
  // product built without canonicalization), so it is settled before anything
  // runs.
  'no-product-between-points',
  // A point used as a DIVISOR (`x / (1, 2)`), which has no reciprocal. Minted by
  // `canonicalDivide`, so it is settled before anything runs.
  'no-division-by-point',
  'incompatible-type',
  'incompatible-dimensions',
  'invalid-axis',
  'invalid-symbol',
  'missing',
  'unexpected-argument',
  'unexpected-mathjson',
  'unexpected-operator',
]);

/**
 * Record the effect summary of a top-level function definition, once the
 * statement has been canonicalized: `function f(…) { … }` (also the `f(x) =
 * …` and `hold` spellings, which parse to the same `DefineFunction`), or a
 * `let`/`const` whose value is written as a function literal. Any other
 * statement defines no function and records nothing.
 *
 * The labels come from the arrow type the definition now carries, which the
 * engine derived from the body (union with a declared contract, when there is
 * one). A later clause of the same name replaces the earlier entry: the arrow
 * then covers every clause seen so far, and the name's first definition site
 * stays the reported position.
 */
function recordEffectSummary(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  boxed: ReturnType<ComputeEngine['box']>,
  into: EffectSummary[]
): void {
  const head = operator(statement);
  let nameNode: MathJsonExpression | null = null;
  let literal: MathJsonExpression | null = null;
  if (head === 'DefineFunction') {
    nameNode = operand(statement, 1);
    literal = operand(statement, 2);
  } else if (head === 'Declare') {
    nameNode = operand(statement, 1);
    literal = declaredValue(statement);
  }
  const name = symbol(nameNode);
  if (name === null || literal === null || operator(literal) !== 'Function')
    return;

  const range = sourceRangeOf(nameNode) ?? sourceRangeOf(statement);
  if (range === undefined) return;

  // A `function` statement installed a definition carrying the arrow; so did
  // a `let`/`const` WITH a type annotation (the pass declares the contract).
  // An unannotated `let`/`const` is held unevaluated, so its arrow is read
  // off the literal itself.
  const type = definedFunctionType(ce, name) ?? heldLiteralType(boxed);
  // An arrow — one signature, or the union or intersection of the clauses of
  // a multi-clause definition — answers with its labels (none means pure);
  // anything else, a bare `function` or an unresolved definition, claims
  // nothing.
  const effects =
    typeof type === 'object' &&
    (type.kind === 'signature' ||
      type.kind === 'union' ||
      type.kind === 'intersection')
      ? (signatureEffects(type) ?? [])
      : undefined;

  const entry: EffectSummary = {
    name,
    range,
    effects,
    declared:
      declaresEffects(ce, literal) ||
      declarationAnnotatesEffects(ce, statement),
  };
  // A later clause of the same name keeps the first clause's position, and
  // the contract flag stays set once any clause declared one: the engine
  // checks every later clause against that contract.
  const previous = into.findIndex((x) => x.name === name);
  if (previous < 0) into.push(entry);
  else
    into[previous] = {
      ...entry,
      range: into[previous].range,
      declared: into[previous].declared || entry.declared,
    };
}

/** The arrow type the pass installed for `name` — by a `function` statement,
 * or by an annotated `let`/`const` — read back by name. `undefined` when no
 * definition is installed, or the installed one is not an arrow. */
function definedFunctionType(
  ce: ComputeEngine,
  name: string
): Type | undefined {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return undefined;
  const t =
    'operator' in def ? def.operator.signature.type : def.value.type.type;
  return typeof t === 'object' &&
    (t.kind === 'signature' || t.kind === 'union' || t.kind === 'intersection')
    ? t
    : undefined;
}

/** The arrow type of the function literal an unannotated `let`/`const`
 * statement holds. `Declare` is lazy and the pass never evaluates it, so no
 * definition carries the literal's type; it is read off the literal itself,
 * bound but not evaluated (`.canonical` is value-safe), through the same
 * `.type` accessor every reader of a literal's arrow uses. */
function heldLiteralType(
  boxed: ReturnType<ComputeEngine['box']>
): Type | undefined {
  if (!isFunction(boxed, 'Declare')) return undefined;
  const last = boxed.ops[boxed.ops.length - 1];
  const held =
    last !== undefined && isDictionary(last) ? last.get('value') : undefined;
  if (held === undefined || held.operator !== 'Function') return undefined;
  return held.canonical.type.type;
}

/** The attributes dictionary of a raw `Declare` statement, wherever it sits:
 * `["Declare", sym, ⟨attrs⟩]` for `let x = …`, and
 * `["Declare", sym, ⟨type⟩, ⟨attrs⟩]` for `let x: T = …`. */
function declareAttributes(
  statement: MathJsonExpression
): MathJsonExpression | null {
  for (const op of operands(statement).slice(1))
    if (operator(op) === 'Dictionary') return op;
  return null;
}

/** The `value` entry of a raw `Declare` statement, or `null` when the
 * declaration carries no value. */
function declaredValue(
  statement: MathJsonExpression
): MathJsonExpression | null {
  const attributes = declareAttributes(statement);
  if (attributes === null) return null;
  for (const pair of operands(attributes)) {
    if (operator(pair) !== 'KeyValuePair') continue;
    const key = operand(pair, 1);
    if (symbol(key) === 'value' || stringValue(key) === 'value')
      return operand(pair, 2);
  }
  return null;
}

/** Whether a type string spells an arrow with an effect specifier that is the
 * function's OWN contract. A fully parenthesized spelling is a grouped type,
 * an ordinary return-type ascription whose return happens to be an effectful
 * arrow (`-> ((number) random -> number)`), and declares nothing about the
 * function itself — the same reading the engine gives a literal's return
 * marker (`isGroupedTypeText`). */
function typeTextDeclaresEffects(ce: ComputeEngine, text: string): boolean {
  if (isGroupedTypeText(text)) return false;
  try {
    const t = parseType(text, ce._typeResolver);
    return (
      typeof t === 'object' && t.kind === 'signature' && t.effects !== undefined
    );
  } catch {
    return false;
  }
}

/** Whether a raw function literal carries an effect contract written by the
 * author: the parser records one as a `Typed` ascription on the body whose
 * type string spells an effect specifier (`(x: unknown) pure -> unknown`). */
function declaresEffects(
  ce: ComputeEngine,
  literal: MathJsonExpression
): boolean {
  const body = operand(literal, 1);
  if (body === null || operator(body) !== 'Typed') return false;
  const text = stringValue(operand(body, 2));
  return text !== null && typeTextDeclaresEffects(ce, text);
}

/** Whether a raw `Declare` statement's type annotation is an arrow with an
 * effect contract: `let f: (number) random -> number = …`. The annotation is
 * the positional string operand, or the `type` entry of the attributes. */
function declarationAnnotatesEffects(
  ce: ComputeEngine,
  statement: MathJsonExpression
): boolean {
  if (operator(statement) !== 'Declare') return false;
  let text: string | null = null;
  for (const op of operands(statement).slice(1)) {
    const s = stringValue(op);
    if (s !== null) text = s;
  }
  const attributes = declareAttributes(statement);
  if (text === null && attributes !== null)
    for (const pair of operands(attributes)) {
      if (operator(pair) !== 'KeyValuePair') continue;
      const key = operand(pair, 1);
      if (symbol(key) === 'type' || stringValue(key) === 'type')
        text = stringValue(operand(pair, 2));
    }
  return text !== null && typeTextDeclaresEffects(ce, text);
}

/** The `[start, end)` source offsets the parser stamped on a node, if any. */
function sourceRangeOf(
  node: MathJsonExpression | null
): [number, number] | undefined {
  if (node === null || typeof node !== 'object' || Array.isArray(node))
    return undefined;
  const offsets = (node as { sourceOffsets?: unknown }).sourceOffsets;
  if (
    Array.isArray(offsets) &&
    offsets.length === 2 &&
    typeof offsets[0] === 'number' &&
    typeof offsets[1] === 'number'
  )
    return [offsets[0], offsets[1]];
  return undefined;
}

function isCanonicalizationError(code: string): boolean {
  return CANONICALIZATION_ERROR_CODES.has(code) || code.startsWith('expected-');
}

/**
 * Diagnostics for the problems the engine detects at **canonicalization**
 * time: `"a" + 1` folds into a tree embedding `["Error", …]` nodes, a static
 * type error that would otherwise stay invisible until the program runs
 * (`docs/LANGUAGE-MODEL.md`).
 *
 * Nothing is evaluated. Each top-level statement is boxed canonically, in
 * source order: boxing resolves operators, signatures and types but never
 * runs user code — a `RandomInteger` call stays symbolic, an infinite `while`
 * lowers to a `Loop` that is not iterated, an unknown `print(…)` stays inert.
 *
 * **Anchoring.** The canonical tree carries no source offsets, so a
 * diagnostic cannot read its position off the node that failed. Instead the
 * error's POSITION in that tree names the call it belongs to
 * (`enclosingFrame`), and that call is matched back onto the raw AST by
 * operator name (`locateError`) — the same matcher the run phase uses on its
 * breadcrumb frames. So `IndexOf(xs, v, 23)` inside a forty-line definition
 * underlines the `23`, not the definition. When the match is ambiguous (two
 * `IndexOf` calls in one statement) or the operator does not survive
 * canonicalization, the anchor falls back to the enclosing statement's range
 * — or to the whole program when the statement carries no offsets, rather
 * than dropping the diagnostic.
 *
 * The caller supplies the engine: `epsil check` uses a fresh one, and
 * `executeEpsil()` uses the session engine (so the pass sees the same
 * library and the declarations of previous cells).
 *
 * **What is contained.** The walk runs in a scope pushed on the way in and
 * popped (in a `finally`) on the way out; that contains the **declarations**
 * canonicalization creates: boxing an expression auto-declares the symbols it
 * mentions, and leaving those behind would change how the program then
 * evaluates (a pre-declared `x` makes `let x = 2047` NARROW that existing
 * declaration instead of creating one). The pass additionally
 * runs under an inference ROLLBACK FRAME (see `staticDiagnostics` below),
 * which undoes what the scope never shielded: type inference written through
 * to definitions that already exist in an outer scope. Checking `u + 1`
 * still narrows a previous cell's unknown-typed `u` to `number` *while the
 * pass runs* — later statements of the same program check against it — but
 * the write is rolled back when the pass ends, so a checked-but-never-run
 * program leaves outer definitions untouched.
 *
 * **Prior declarations are mostly not modeled.** Each statement is
 * canonicalized in source order but *without* applying the bindings the
 * preceding statements declare — `Declare`/`Assign` only take effect when they
 * evaluate, which this pass never does. The pass is therefore incomplete
 * rather than unsound: a mistake that depends on a declared type is missed
 * (`let x: string = "a"` followed by `x + 1` checks clean), and the program
 * reports it when it runs. One carve-out: a top-level statement that pins a
 * names-carrying function signature (`f := ⟨annotated literal⟩`,
 * `let f : ⟨arrow type⟩ …`) registers that signature for the LATER statements
 * of the same program — see {@link registerPinnedSignature} — because without
 * it a named call to such a callee drew false `argument-names-unavailable`
 * diagnostics for a program that runs fine.
 *
 * `into`, when given, receives each diagnostic as it is found and is also the
 * returned array. It exists for the time-budget path: the pass checks the
 * host's deadline before every statement and lets an expired budget propagate
 * as a throw, and a caller that passed `into` keeps everything the pass had
 * established before the deadline (a static type error in statement 1 is a
 * fact about the program whether or not statement 400 reached the budget).
 */
/**
 * The effects the engine inferred for one function the program defines at
 * its top level — what `epsil check --effects` prints and what the editor
 * hover shows next to a definition. Collected while the static pass runs,
 * because the definitions it reads are rolled back when the pass ends.
 */
export type EffectSummary = {
  /** The defined name. */
  name: string;
  /** The source span of the name in its definition, `[start, end)`. */
  range: [number, number];
  /**
   * The effect set of the function's arrow: the labels in canonical order
   * (an empty list is a pure function), or `'any'` for an arrow that admits
   * every effect. `undefined` when the engine could not read a signature for
   * the name (the definition did not canonicalize to a function value), so
   * nothing is claimed.
   */
  effects: EffectSet | undefined;
  /**
   * Whether the author wrote an effect contract on the definition (`pure`,
   * `random`, …). A declared contract is checked, so the labels reported are
   * what the author promised; an inferred set is what the body does.
   */
  declared: boolean;
};

export function staticDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string,
  into: ParsingDiagnostic[] = [],
  options?: { effects?: EffectSummary[] }
): ParsingDiagnostic[] {
  // The frame NAME is load-bearing: the engine's `DeclareType` handler treats
  // 'epsil:static-check' as a top-level surrogate (types are engine-global,
  // and statements boxed directly in this frame are top-level by
  // construction) — see `declareTypeStatement` in
  // `src/compute-engine/library/core.ts`. Renaming it here without updating
  // that check would make every checked `type` statement a false
  // `invalid-type-declaration`.
  //
  // The registry rollback is the pre-pass's isolation for the TYPE namespace,
  // symmetric with what popping the frame does for value bindings: a
  // `DeclareType` registers at canonicalization time so LATER statements of
  // the same program check against the new definition (arity of a re-declared
  // constructor, self-references), and the rollback discards those
  // registrations so the program's real evaluation performs them in statement
  // order, on the real engine state — a declaration this pass diagnosed as a
  // conflict must not have half-registered, and a checked-but-never-run
  // program must not mutate the engine's types.
  const rollbackTypes = ce._typeRegistryRollbackPoint();
  // The PROTOCOL registry needs the identical transaction, for the identical
  // reason: `DeclareProtocol`/`DeclareConformance` register at canonicalization
  // time so later statements of the same program check against them, and a
  // checked-but-never-run program must not mutate the engine's protocols.
  const rollbackProtocols = ce._protocolRegistryRollbackPoint();
  // The engine requires the depth counter IN ADDITION to the frame name (so a
  // host `pushScope(undefined, 'epsil:static-check')` cannot forge the
  // surrogate and smuggle a nested `DeclareType` past the top-level rule).
  ce._staticTypeCheckDepth += 1;
  // The pre-pass is one long WRITE: it applies the type effect of every
  // top-level statement onto real definitions (`_infer`,
  // `_setElementRefinement`, the assignment-evidence map). None of that may
  // record what an assumption in force happens to prove, so the whole pass
  // runs with the assumptions hidden — the same bracket every other write
  // routine uses (`docs/plans/2026-08-29-assumptions-as-facts-type.md`
  // §2.4). The depth is raised on the line just before the `try` whose
  // `finally` lowers it, so no exception thrown by the setup between here
  // and the `try` can leave it raised: a leaked depth would silently hide
  // the assumptions from every later read on this engine.
  ce.pushScope(undefined, 'epsil:static-check');
  // Assignment EVIDENCE for this pass (see `applyAssignmentTypeEffect`):
  // maps a symbol's value-definition record to the RAW type of the last
  // top-level assignment's right-hand side, so the evidence-beats-requirement
  // guard in argument validation treats the symbol as ASSIGNED during the
  // pass. Restored (not cleared) so a nested pass leaves the outer one's
  // evidence intact, mirroring `_epsilBatchId`.
  const enclosingEvidence = ce._staticAssignmentEvidence;
  ce._staticAssignmentEvidence = new Map();
  // The value definitions this pass pinned from a FUNCTION LITERAL the
  // program declares or assigns (`registerPinnedSignature`), so boxing
  // validates the arguments of a later call against the literal's signature
  // — the run time defers that refusal to the application itself. Restored
  // for the same reason as the evidence map.
  const enclosingPinnedCallees = ce._staticPinnedCallees;
  ce._staticPinnedCallees = new Map();
  ce._factSuppressionDepth += 1;
  try {
    // One INFERENCE ROLLBACK FRAME spans the whole pass (phase 2b of
    // `docs/TYPE-SYSTEM.md`). It journals — and
    // rolls back on the way out — every inference-driven mutation the
    // checking makes: the FORWARD-REFERENCE registry entries a checked
    // `function` definition registers (that registry is keyed by ENGINE,
    // not by scope, so popping this pass's scope does not remove them — and
    // the program's real definition of the same function would be a second
    // entry waiting on the same callee), the declarations canonicalization
    // installs, and the type inference the checking writes onto
    // PRE-EXISTING outer definitions (which the pushed scope never
    // shielded: checking `u + 1` used to permanently narrow a previous
    // cell's `u` to `number`). The frame replaces the snapshot-based
    // `_provisionalRegistryRollbackPoint`, whose restore re-installed the
    // snapshot's own `Set` objects — a second pass over the same engine
    // restored already-mutated state. Definitions still visible ACROSS the
    // pass's own statements (a `function` defined by statement 1 checks
    // statement 2's call) — the rollback happens once, when the whole pass
    // is done. Its outputs are decision-shaped (`ParsingDiagnostic`:
    // strings and ranges), so nothing created inside the frame escapes it.
    //
    // The frame must nest inside ONE boxing-pass window; the per-statement
    // `ce.box()` windows then nest inside it.
    return ce._withBoxingPassWindow(() =>
      ce._withRolledBackInference(() =>
        canonicalizationDiagnostics(ce, ast, source, into, options?.effects)
      )
    );
  } finally {
    ce._staticAssignmentEvidence = enclosingEvidence;
    ce._staticPinnedCallees = enclosingPinnedCallees;
    ce.popScope();
    ce._factSuppressionDepth -= 1;
    ce._staticTypeCheckDepth -= 1;
    rollbackTypes();
    rollbackProtocols();
  }
}

/**
 * The STATIC TYPE EFFECT of a top-level assignment (`docs/INFERENCE_ROADMAP.md`,
 * Phase 0 guard — the whole-program half, 2026-08-18).
 *
 * At run time, evaluating `x = g()` gives `x` an inferred type
 * (`inferTypeFromValue`, widened) and assignment EVIDENCE, so a later use is
 * checked against the evidence instead of narrowing it. The Assign write
 * happens in the EVALUATE handler, which this pass never runs — so without
 * this, the pass checked `k(x)` against an `x` that never learned `number`,
 * and the mismatch a whole-file run reports at the `k(x)` statement was
 * invisible to `epsil check`. This applies the same effect statically: the
 * type is computable from the canonical right-hand side's STATIC type
 * (nothing is evaluated), written through the journaled `_infer` channel
 * with `replace` (assignment is last-write-wins), and the raw (unwidened)
 * type is recorded as evidence — raw for the same reason the runtime guard
 * checks the held VALUE's type: widening stores a `Complex` under `number`,
 * which a `complex` parameter must still admit.
 *
 * Deliberately narrow: TOP-LEVEL statements only (the caller iterates the
 * program's `Block`; an assignment nested in an `If` body is one statement
 * here and contributes nothing — conservative, matching what the pass can
 * know without control-flow analysis), symbol left-hand sides only, and
 * only when the statement carries no error and the right-hand side has a
 * usable static type. A `Function` right-hand side is left to
 * `registerPinnedSignature`, which owns function-signature effects. An
 * EXPLICITLY TYPED declaration contributes nothing either — its annotation
 * is a contract, and `declaredTypeMismatch` owns conflicts with it.
 */
function applyAssignmentTypeEffect(
  ce: ComputeEngine,
  boxed: ReturnType<ComputeEngine['box']>,
  effectDeclared: Set<string>
): void {
  const evidence = ce._staticAssignmentEvidence;
  if (evidence === undefined) return;

  let target: ReturnType<ComputeEngine['box']> | undefined;
  let rhs: ReturnType<ComputeEngine['box']> | undefined;
  if (isFunction(boxed, 'Assign')) {
    target = boxed.ops[0];
    rhs = boxed.ops[1];
  } else if (isFunction(boxed, 'Declare')) {
    // `["Declare", sym, type?, value?, attrs?]` — positional type and value,
    // or a trailing attributes dictionary carrying `type`/`value` entries
    // (the Epsil `let x = …` lowering). An explicit type annotation makes
    // the declaration a CONTRACT: the annotation is installed, and only the
    // initializer's EVIDENCE is recorded. NOTE: the attrs-vs-positional
    // split assumes Epsil-parser-shaped `Declare` nodes (the parser always
    // wraps a `let` initializer in the attributes dictionary); a
    // hand-constructed `Declare(sym, type, ⟨dictionary VALUE⟩)` would read
    // its positional dictionary value as the attributes bag and skip the
    // effect — harmless (the effect is best-effort) but worth knowing.
    target = boxed.ops[0];
    const rest = boxed.ops.slice(1);
    const last = rest[rest.length - 1];
    const attrs = isDictionary(last) ? last : undefined;
    const positional = attrs === undefined ? rest : rest.slice(0, -1);
    const typeOp = positional.find((op) => isString(op)) ?? attrs?.get('type');
    if (typeOp !== undefined) {
      // An explicit annotation is a CONTRACT. `Declare` installs it at
      // EVALUATE time, which this pass never runs — and
      // `registerPinnedSignature` covers only names-carrying function
      // signatures — so without this, `let f: () -> integer` left `f`
      // unknown for the pass and every later statement using `f` was
      // uncheckable. Install a pass-scoped declaration with the same
      // contract; it dies when the pass pops its scope.
      const source = isString(typeOp)
        ? typeOp.string
        : isSymbol(typeOp)
          ? typeOp.symbol
          : null;
      if (target !== undefined && isSymbol(target) && source !== null) {
        try {
          ce.declare(target.symbol, source as TypeString);
          effectDeclared.add(target.symbol);
        } catch {
          // Already declared in this scope (a forward use auto-declared
          // it), or a malformed annotation — both already have their own
          // diagnostics; the effect is best-effort.
        }
        // A typed declaration WITH an initializer still contributes
        // assignment EVIDENCE (the raw initializer type): the contract
        // stays the reported type, but a later use that the contract merely
        // OVERLAPS (`let x: number = 1.5` at an `integer` parameter —
        // `number` and `integer` are not disjoint, so the free-variable
        // un-rejection would otherwise call the mismatch provisional) is
        // checked against what the program actually assigned.
        const initOp =
          positional.find((op) => !isString(op)) ?? attrs?.get('value');
        if (initOp !== undefined && initOp.operator !== 'Function') {
          const init = initOp.canonical;
          if (init.isValid && !init.type.isUnknown) {
            const def = ce.box(target.symbol).valueDefinition;
            if (def !== undefined) {
              // A concrete literal initializer records its handler-visible
              // literal type (`1.5`, not `real`): exact evidence a
              // parameter can provably refute, which is what restores the
              // static line for `let x: number = 1.5; k(x)` under overlap
              // admission (path 1 of the ROADMAP entry "Epsil static
              // evidence diagnostics lost to overlap admission", ruled
              // 2026-08-23). A non-literal initializer keeps its public
              // type.
              evidence.set(def, init._literalType ?? init.type.type);
              // A pass-declared PLACEHOLDER skeleton (`let a: list = ["x"]`)
              // refines from its initializer here too, so element uses in
              // later statements (`k(a[1])`) are checkable — mirroring the
              // assignment branch below (review catch, 2026-08-18).
              if (
                def._placeholderSkeleton !== undefined &&
                effectDeclared.has(target.symbol)
              ) {
                const refined = refineConstructorPlaceholder(
                  def._placeholderSkeleton,
                  init.type.type
                );
                if (refined !== def.type.type)
                  def._setElementRefinement(ce.type(refined));
              }
            }
          }
        }
      }
      return;
    }
    rhs = positional.find((op) => !isString(op)) ?? attrs?.get('value');
  } else return;

  if (target === undefined) return;
  if (rhs === undefined || rhs.operator === 'Function') return;
  // `Assign`/`Declare` are LAZY: their held operands arrive UNBOUND, typing
  // `unknown`. Canonicalizing binds structure — resolving `f()` to its
  // declared result type — without substituting values or evaluating
  // anything (`op.canonical` is value-safe).
  rhs = rhs.canonical;
  if (!rhs.isValid) return;
  const raw = rhs.type;
  if (raw.isUnknown) return;

  // A DESTRUCTURING target (`let (a, b) = v`, `(a, b) = v`) distributes the
  // effect per leaf when the right-hand side's static type pins a matching
  // tuple shape; anything else (mismatched arity, non-tuple type, nested
  // patterns) contributes nothing — conservative, like the rest of this
  // function.
  if (isFunction(target, 'Tuple')) {
    const t = raw.type;
    if (
      typeof t === 'object' &&
      t.kind === 'tuple' &&
      t.elements.length === target.nops &&
      target.ops.every((o) => isSymbol(o))
    ) {
      target.ops.forEach((leaf, idx) => {
        const leafType = t.elements[idx].type;
        // A component typed `never` claims no value, so it is no evidence
        // for the leaf's type (the same rule as `joinEvidenceOnBinding` in
        // `library/core.ts`).
        if (leafType === 'unknown' || leafType === 'never' || !isSymbol(leaf))
          return;
        const leafSym = ce.box(leaf.symbol);
        const leafDef = leafSym.valueDefinition;
        if (leafDef === undefined) return;
        leafSym._infer(() => widenAssignedType(ce, leafType), 'replace');
        evidence.set(leafDef, leafType);
      });
    }
    return;
  }

  if (!isSymbol(target)) return;
  const sym = ce.box(target.symbol);
  const def = sym.valueDefinition;
  if (def === undefined) return;
  // A pass-declared placeholder skeleton (`let a: list` checked earlier in
  // this same pass) refines exactly as the runtime assignment will (Phase 1
  // rulings, 2026-08-18) — its definition lives in the pass scope, so the
  // direct type write dies with it. Skeleton-declared OUTER symbols are
  // left alone (their runtime refinement needs no help from the pass, and
  // a direct write here would bypass the rollback journal).
  if (
    def._placeholderSkeleton !== undefined &&
    effectDeclared.has(target.symbol)
  ) {
    const refined = refineConstructorPlaceholder(
      def._placeholderSkeleton,
      raw.type
    );
    if (refined !== def.type.type) def._setElementRefinement(ce.type(refined));
  } else {
    sym._infer(() => inferTypeFromValue(ce, rhs).type, 'replace');
  }
  // The INFERRED type above stays deliberately widened ("more likely, not
  // broadest"); only the EVIDENCE carries a literal right-hand side's exact
  // type (`1.5`), so a later use at a parameter the literal provably cannot
  // inhabit is refused at boxing and the pre-pass flags it (path 1 of the
  // ROADMAP entry "Epsil static evidence diagnostics lost to overlap
  // admission", ruled 2026-08-23).
  evidence.set(def, rhs._literalType ?? raw.type);
}

function canonicalizationDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string,
  diagnostics: ParsingDiagnostic[],
  effects?: EffectSummary[]
): ParsingDiagnostic[] {
  // The parser wraps a multi-statement program in `Block` (see
  // `executeEpsil()`); a single statement is not wrapped.
  const statements = operator(ast) === 'Block' ? [...operands(ast)] : [ast];

  // Where this program binds each of its names, for the "defined here" note a
  // signature error carries (see `signatureNotes()`).
  const defSites = definitionSites(ast);

  // The signatures this program's own statements pin (`f := ⟨annotated
  // literal⟩`, `let f : ⟨arrow type⟩`, `let f = ⟨annotated literal⟩`),
  // registered onto the definitions as the walk reaches them — see
  // `registerPinnedSignature`. Kept here as well as on the definition
  // because boxing a LATER `Assign` to the same name runs the recursion-knot
  // retype (library/core.ts), which resets the target to the wildcard
  // `function` type — the pass re-asserts (or, for a `let`/`const` pin,
  // replaces) the pinned signature from this map afterwards.
  const pinned = new Map<string, PinnedSignature>();

  // The names that a top-level `const` declaration of this program binds, in
  // the order of the walk, each with the range of its declaration. The run
  // time refuses a later `function` statement for such a name, and the
  // binding stays as it is (see `keepConstantBinding()`); the pass reports
  // the refusal (see `constantClauseDiagnostic()`).
  const constants = new Map<string, [number, number]>();

  // The constants of this program, as the scope-aware walk of the program
  // (`documentBindings()`) groups the occurrences of their names: each group
  // of a `const` binding. The assignments to such a constant, which the run
  // time refuses, are found once, when the constant is registered
  // (`registerConstant()`), and each is reported with the statement that
  // holds it. The walk is made only when the program declares a constant.
  //
  // A `const` in a function body or a block is registered here, before the
  // walk of the statements: its assignments are in the same top-level
  // statement as the declaration. A top-level `const` is registered when the
  // walk reaches it, because the walk then knows whether the run time
  // installs it (see below). Then the assignments to it in the function
  // bodies of the earlier statements are reported at once (a function
  // defined before the `const` writes the constant when it is called after
  // it).
  let constantWrites: ConstantWrites | undefined = undefined;
  const topLevel = new Set(statements);
  const localConstants = constantDeclarations(ast).filter(
    (declaration) => !topLevel.has(declaration)
  );
  if (localConstants.length > 0) {
    constantWrites = constantWritesOf(ce, ast, source, statements);
    for (const declaration of localConstants) {
      const range = statementRange(declaration, source);
      for (const group of declaredGroups(constantWrites.byName, declaration))
        if (
          !isRefusedLocalConstant(
            group,
            constantWrites.byName.get(group.name) ?? []
          )
        )
          registerConstant(constantWrites, group, range, -1);
    }
  }

  // REDEFINITION DISCIPLINE, static tier — the names THIS UNIT declares, and
  // where. A pass-local map, deliberately not the runtime batch stamp: the
  // static checker also runs with no batch at all (`epsil check` calls
  // `staticDiagnostics` directly, without `executeEpsil`), so a
  // stamp-keyed check could never fire on the tier the diagnostic is promised
  // for. See `docs/TYPE-SYSTEM.md`.
  const declaredInThisUnit = new Map<string, [number, number]>();

  // REDEFINITION DISCIPLINE, static tier — the function CLAUSES this unit
  // defines: name → one entry per clause, holding its parameter domain and the
  // range of the statement that defined it. Pass-local for the same reason as
  // `declaredInThisUnit` above, and separate from it because a clause is
  // identified by its parameter domain rather than by a name: a name may carry
  // any number of clauses, and only a second clause at the SAME domain is a
  // redefinition.
  const clausesInThisUnit = new Map<string, ClauseSite[]>();

  // SAME-SCOPE RE-DECLARATION (ruled 2026-09-05), top level: the range of
  // the first `let`/`const` of each name this unit declared, so a second one
  // in the SAME program is reported (`variable-redeclaration`). Across units
  // — a re-run notebook cell, a later REPL line — a `let` re-declares
  // legally, so the collector is pass-local, like `declaredInThisUnit`.
  // Inside a block the same rule is enforced by `canonicalBlock`
  // (`library/control-structures.ts`), whose error node this pass reports
  // like any other canonicalization error.
  const variablesInThisUnit = new Map<string, [number, number]>();

  // The names `applyAssignmentTypeEffect` itself declared into the pass
  // scope (so their definitions die with it) — the only definitions the
  // effect may REFINE in place (placeholder-skeleton refinement); an outer
  // definition is never mutated outside the journaled `_infer` channel.
  const effectDeclared = new Set<string>();

  // The annotations in force for the `match` exhaustiveness lint, threaded
  // through the whole program so a top-level `let t: light = …` types `t`
  // for the statements that follow (see `match-exhaustiveness.ts`).
  const annotations: AnnotationScope = new Map();

  diagnostics.push(...absenceMarkerBindingDiagnostics(ce, ast, source));

  let statementIndex = -1;
  for (const statement of statements) {
    statementIndex += 1;
    const redefinition = redefinitionDiagnostic(
      statement,
      source,
      declaredInThisUnit
    );
    if (redefinition !== undefined) diagnostics.push(redefinition);
    const variableRedeclaration = variableRedeclarationDiagnostic(
      statement,
      source,
      variablesInThisUnit
    );
    if (variableRedeclaration !== undefined)
      diagnostics.push(variableRedeclaration);
    const constantClause = constantClauseDiagnostic(
      statement,
      source,
      constants
    );
    if (constantClause !== undefined) diagnostics.push(constantClause);
    if (constantWrites !== undefined)
      diagnostics.push(...(constantWrites.pending.get(statementIndex) ?? []));

    // A rule (`name -> value`) passed where the callee expects a function is
    // the `->`-for-`=>` typo. It is read from the RAW statement, the only tree
    // that still has the arrow's source offsets, and runs before boxing so a
    // statement the engine cannot box still gets it. The engine reports the
    // same mistake as a confusing type error about the key (a key must be a
    // string) or about the callback (a rule is not a function), so the
    // canonicalization errors anchored on a reported pair or on its key are
    // suppressed below. An error anchored inside the VALUE of the pair is a
    // different mistake and is reported.
    const ruleSites = ruleAtFunctionSlotDiagnostics(ce, statement, source);
    for (const site of ruleSites) diagnostics.push(site.diagnostic);

    // Provenance: the `Error` nodes the statement already carries *before*
    // canonicalization are source-authored values, not static problems.
    const authored = authoredErrors(statement);

    let canonical: MathJsonExpression;
    let boxed: ReturnType<ComputeEngine['box']> | undefined;
    // Called after the statement is boxed, when the statement is a
    // `function` statement for a name that a `const` declaration of this
    // program pinned (`keepConstantBinding()`).
    let afterBox: (() => void) | undefined = undefined;
    // REDEFINITION DISCIPLINE — the statement-route marker. Boxing a
    // declaration statement registers it, and only a registration made on
    // THIS route may carry the batch stamp; a `ce.box(["DeclareType", …])`
    // performed re-entrantly by something the boxing triggers must stay
    // unstamped. Restored (not cleared) so nesting cannot leak.
    // See `docs/TYPE-SYSTEM.md`.
    const enclosingRoute = ce._epsilDeclarationRoute;
    ce._epsilDeclarationRoute = isDeclarationStatement(statement);
    try {
      // The pass runs under the host's time budget (`executeEpsil` under a
      // `withTimeLimit` span). Boxing rarely checks the deadline on its own,
      // so check it once per statement here; an expired budget propagates
      // out of the pass — see the catch below.
      checkDeadline(ce._deadlineFrame);
      afterBox = installAssignedLiteralBeforeClause(
        ce,
        statement,
        pinned,
        constants
      );
      boxed = ce.box(statement);
      canonical = boxed.json;
    } catch (e) {
      // An expired time budget is the host's cancellation, not a statement
      // that failed to box: swallowing it here would let the pass — and then
      // the program — run on past its deadline. It propagates to the caller
      // (`executeEpsil` turns it into the program's cancelled value).
      if (isTimeoutCancellation(e)) throw e;
      // Otherwise canonicalization is best-effort: a statement the engine
      // cannot box is left to the run phase rather than crashing the check.
      continue;
    } finally {
      ce._epsilDeclarationRoute = enclosingRoute;
      afterBox?.();
    }

    // A use of a local that is certain to come before the local has a
    // value: the run gives the `read-before-declaration` error when the use
    // runs.
    diagnostics.push(
      ...readBeforeAssignmentDiagnostics(boxed, statement, source)
    );

    // The `match` exhaustiveness lint runs on the RAW statement (the patterns
    // are only readable there), but only after the statement is boxed: a
    // `type` statement registers its sum when it is canonicalized, and the
    // lint resolves annotations against that registry.
    matchExhaustivenessDiagnostics(
      ce,
      statement,
      source,
      diagnostics,
      annotations
    );

    // REDEFINITION DISCIPLINE — the statement's names enter the unit's
    // collector only now, once it has actually been canonicalized WITHOUT a
    // declaration-blocking error. Recording them earlier would let a statement
    // rejected for an INDEPENDENT reason (a name a host already declared, a
    // malformed body) become the recorded "first" declaration, so a following
    // declaration of that name would be reported as a redefinition of
    // something that never got declared — while the runtime tier reported the
    // real cause for both. The two tiers must report the same problem.
    if (redefinition === undefined)
      recordDeclaredNames(statement, canonical, source, declaredInThisUnit);

    // REDEFINITION DISCIPLINE, static tier — the clause half. Unlike the
    // declaration half it can only run AFTER the statement is canonicalized:
    // clause identity is a TYPE-level test on the parameter domain (renaming a
    // parameter does not make a new clause, and an unannotated parameter's type
    // is inferred), so the raw AST cannot answer it. Records as well as
    // reports; see `clauseRedefinitionDiagnostic`.
    // …and an ASSIGNMENT to a name discards every clause this unit recorded for
    // it, because assignment FULL-REPLACES (design rule D6). Without this the
    // collector kept citing a clause the program had already thrown away:
    // `f(n) = 1` then `f = x ↦ 42` then `f(m) = 2` reported the third statement
    // as redefining the first, whose binding no longer existed. Runs BEFORE the
    // clause check below so a statement that both replaces and defines is read
    // in that order.
    forgetReplacedClauses(statement, clausesInThisUnit);

    const clauseRedefinition = clauseRedefinitionDiagnostic(
      ce,
      statement,
      boxed,
      source,
      clausesInThisUnit
    );
    if (clauseRedefinition !== undefined) diagnostics.push(clauseRedefinition);

    // The effect summary is read now, while the definition the statement
    // installed is still in the pass scope (the pass rolls it back on exit),
    // and only for a statement the pass accepted: a redefinition, or a
    // duplicate clause, was not installed and must not rewrite the entry.
    if (
      effects !== undefined &&
      redefinition === undefined &&
      clauseRedefinition === undefined
    )
      recordEffectSummary(ce, statement, boxed, effects);

    // A declaration whose initializer PROVABLY cannot satisfy the annotation
    // is a static problem too, even though `Declare` only enforces it at
    // evaluation time (see `declaredTypeMismatch`). Computed BEFORE the
    // signature registration below: when the mismatch is provable, the
    // runtime `Declare` refuses to install the binding, so registering its
    // signature would model a binding the program never gets.
    const declMismatch = declaredTypeMismatch(ce, boxed);

    // If this statement pins a names-carrying function signature when it
    // evaluates, make the pinned signature visible to the LATER statements of
    // this program (never to earlier ones — registration follows the walk's
    // source order, so a call written before the assignment still has no
    // names to check, matching the runtime where the callee is unassigned).
    if (declMismatch === undefined) registerPinnedSignature(ce, boxed, pinned);

    // A `const` declaration that the run time installs makes a later
    // `function` statement for the same name, and a later assignment to it,
    // a runtime error. A `const` that re-declares a name of this program is
    // refused at run time (`variable-redeclaration`), so the binding of the
    // name stays the earlier one, which is not a constant when it is a
    // `let`.
    if (declMismatch === undefined && variableRedeclaration === undefined) {
      const name = constantDeclarationName(boxed);
      if (name !== undefined)
        constants.set(name, statementRange(statement, source));
      // Each name of a destructuring `const` (`const (a, b) = t`) is a
      // constant too.
      if (isConstantDeclaration(statement)) {
        const range = statementRange(statement, source);
        constantWrites ??= constantWritesOf(ce, ast, source, statements);
        // The assignments to the constant in the statements before it and in
        // this statement are reported now. The assignments in the later
        // statements are reported when the walk reaches them. A function
        // defined before a top-level `const` does not write it: an
        // assignment to the name in the body of that function makes a local
        // of the function (`registerConstant()` does not read
        // `writesFromFunctionBodies()` for a top-level `const`).
        for (const group of declaredGroups(constantWrites.byName, statement))
          diagnostics.push(
            ...registerConstant(constantWrites, group, range, statementIndex)
          );
      }
    }

    // The statement's ASSIGNMENT type effect, visible to the LATER statements
    // of this program (never earlier ones — the walk is in source order,
    // matching the runtime where the assignment has not yet run).
    if (declMismatch === undefined)
      applyAssignmentTypeEffect(ce, boxed, effectDeclared);

    const errors: MathJsonExpression[] = [];
    collectErrors(canonical, errors);
    // Pair each collected JSON error with its BOXED twin, keyed by serialized
    // identity: the boxed error's site operand carries the faulted operand's
    // own binding, which the provenance note reads scope-accurately
    // (`signatureNotes`' `boxedError` option). The boxed walk mirrors
    // `collectErrors`' traversal (operands AND dictionary values), so the
    // JSON walk stays authoritative and the map is a lookup aside. Two
    // byte-identical errors in one statement collide on the key — they also
    // dedup to one diagnostic below, so first-wins is sufficient.
    const boxedErrorByJson = new Map<
      string,
      ReturnType<ComputeEngine['box']>
    >();
    indexBoxedErrors(boxed, boxedErrorByJson);

    // The errors inside the held stage of a pipe (`xs |> Filter("a")`). The
    // canonical form of a pipe does not contain them, because `Pipe` holds
    // its stage unbound until it is evaluated, so `collectErrors` above
    // cannot see them. `pipeStageErrors` canonicalizes each held stage as
    // the evaluation would, and gives the frame of each error: the call
    // whose argument is at fault, with the argument counted in the stage
    // AS WRITTEN, so the locator below finds it in the raw statement.
    const pipeStageFrames = new Map<
      MathJsonExpression,
      ErrorFrameRef | undefined
    >();
    for (const site of pipeStageErrors(ce, boxed)) {
      errors.push(site.error);
      pipeStageFrames.set(site.error, site.frame);
      const key = JSON.stringify(site.error);
      if (site.boxed !== undefined && !boxedErrorByJson.has(key))
        boxedErrorByJson.set(key, site.boxed);
    }
    if (errors.length === 0 && declMismatch === undefined) continue;

    const [start, end] = statementRange(statement, source);
    const snippet = epsilSnippet(statement);
    if (declMismatch !== undefined)
      diagnostics.push({
        severity: 'error',
        message: [
          'static-type-error',
          declMismatch,
          snippet,
          'incompatible-type',
        ],
        range: [start, end, start],
      });
    // One diagnostic per distinct problem: every error in a statement shares
    // the statement's range, so identical descriptions would be N copies of
    // the same line.
    const seen = new Set<string>();
    for (const error of errors) {
      const code = errorCode(error);
      if (!isCanonicalizationError(code)) continue;
      const description = describeError(error);
      // Dedup and authored-subtraction key on the SITE-LESS description
      // (`dedupKey`): the site operand the engine now attaches names WHERE,
      // not WHAT, so it must not split one problem into per-site diagnostics
      // or stop an authored (site-less) error from matching the engine-minted
      // equivalent. The rendered `description` keeps the site.
      const key = dedupKey(error);
      // Subtract the authored errors, one occurrence at a time: a program that
      // builds `Error(ErrorCode("incompatible-type", …))` twice and hits one
      // real type error still gets exactly one diagnostic.
      const authoredCount = authored.get(key);
      if (authoredCount !== undefined && authoredCount > 0) {
        authored.set(key, authoredCount - 1);
        continue;
      }
      // The error is taken out of the dedup below only when it is kept. An
      // error that is hidden because it is reported as a rule at a function
      // slot must not hide a different error later in the statement that has
      // the same description: `(map(x -> x + 1, [1]), f(y -> y + 1))` has
      // two errors "a key must be a string", and only the one of `map` is
      // reported as a rule.
      if (seen.has(key)) continue;

      // Where the error sits in the canonical tree names the call it belongs
      // to — the stand-in for the `ErrorTrace` breadcrumb a runtime error
      // carries (canonicalization records none). It does double duty: it
      // narrows the ANCHOR from the whole statement onto the offending
      // argument, so a mistake inside a 40-line function definition does not
      // underline the definition; and it names the callee whose signature the
      // notes explain.
      const frame = pipeStageFrames.has(error)
        ? pipeStageFrames.get(error)
        : writtenFrame(canonical, error, statement);
      const located = locateError(
        frame === undefined ? [] : [frame],
        statement,
        [start, end],
        // A named call was permuted into declaration order, so the frame's
        // argument index counts declaration slots; the callee's declared
        // names let the locator find the WRITTEN argument that fills the
        // faulted slot (see `argumentAtSlot`, error-location.ts). The seam's
        // own normalization failures were never permuted, so their index
        // counts written positions and is used directly.
        (operatorName) => calleeSlotNames(ce, operatorName),
        frameOrderOf(code)
      );
      const [from, to] = located.range;
      // The problem is already reported as a rule at a function slot. The
      // error on a key is recognized by its frame and its operand too, for
      // the case where the locator cannot find the pair (two pairs in one
      // statement) and falls back to the range of the statement.
      const keyError =
        frame?.name === 'KeyValuePair' && frame.index === 1
          ? symbol(operand(error, 2))
          : null;
      if (
        ruleSites.some(
          ({ anchors, keyName }) =>
            keyName === keyError ||
            anchors.some(([s, e]) => from === s && to === e)
        )
      )
        continue;
      seen.add(key);

      const diagnostic: ParsingDiagnostic = {
        severity: 'error',
        // Quote the CALL that failed rather than the whole statement: with
        // the anchor narrowed onto one argument, quoting a 40-line definition
        // describes the wrong thing — and a host that shows only the message
        // (an editor hover) would have nothing else to go on.
        message: [
          'static-type-error',
          description,
          located.call === undefined ? snippet : epsilSnippet(located.call),
          code,
        ],
        range: [from, to, from],
      };
      const notes = signatureNotes(ce, error, {
        definitionSites: defSites,
        primaryRange: [from, to],
        enclosingFrame: frame,
        call: located.call,
        boxedError: boxedErrorByJson.get(JSON.stringify(error)),
      });
      if (notes.length > 0) diagnostic.notes = notes;
      // Path-2 refinement (user-ruled 2026-08-23): when the mismatch is
      // only POSSIBLE — the faulted operand is a symbol whose recorded
      // assignment evidence merely OVERLAPS the expected type (`number`
      // from `x = g()` at an `integer` slot; the linter is deliberately
      // stricter than engine admission there) — say so, and suggest the
      // annotation that would turn the possibility into a checked
      // contract. A DEFINITE mismatch (evidence provably disjoint, e.g. a
      // `1.5` initializer at `integer`) gets no such note: no annotation
      // rescues it.
      if (code === 'incompatible-type') {
        const boxedErr = boxedErrorByJson.get(JSON.stringify(error));
        // Structural read of the error node's operands, matching the boxed
        // walk above: `ops` lives on a narrowed interface this module does
        // not import.
        const faulted = (
          boxedErr as
            { ops?: readonly ReturnType<ComputeEngine['box']>[] } | undefined
        )?.ops?.[1];
        const cause = operand(error, 1);
        const expectedText =
          cause !== null && operator(cause) === 'ErrorCode'
            ? text([...operands(cause)][1])
            : undefined;
        if (
          faulted !== undefined &&
          isSymbol(faulted) &&
          expectedText !== undefined &&
          expectedText !== ''
        ) {
          const def = faulted.valueDefinition;
          const evidence =
            def === undefined
              ? undefined
              : ce._staticAssignmentEvidence?.get(def);
          const expected = parseType(expectedText, ce._typeResolver);
          if (
            evidence !== undefined &&
            expected !== undefined &&
            typesOverlap(evidence, expected) &&
            !isSubtype(evidence, expected)
          ) {
            (diagnostic.notes ??= []).push({
              message:
                `the assignment gives \`${faulted.symbol}\` the type ` +
                `\`${typeToString(evidence)}\`, which only POSSIBLY fits ` +
                `\`${expectedText}\` — annotate the declaration ` +
                `(\`let ${faulted.symbol}: ${expectedText}\`) to state the ` +
                `contract and have each assignment checked against it`,
            });
          }
        }
      }
      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

/**
 * The names ONE declaration statement claims, gated on the statement's AST
 * HEAD — never on the `type` keyword, because `type string is Hashable` is a
 * bare CONFORMANCE (`DeclareConformance`), declares no type at all and is
 * deliberately outside this discipline (a re-declared edge is a no-op, and
 * duplicate implementation blocks are ruling P47's business).
 *
 * A sum statement claims N+1 names — its own and every variant's — under that
 * ONE statement: the sugar is a declaration bundler, and the statement owns
 * everything it declares
 * (`docs/TYPE-SYSTEM.md`, "the generated-name
 * rule").
 *
 * `kind` separates the two namespaces so that `type X = …` followed by
 * `protocol X { … }` is left to the no-dual-role rule (P8), which explains
 * that specific mistake better than "declared twice" would.
 */
function declaredNamesOf(
  statement: MathJsonExpression
): { kind: 'type' | 'protocol'; names: string[] } | undefined {
  switch (operator(statement)) {
    case 'DeclareType': {
      const name = declarationName(operand(statement, 1));
      return name === undefined ? undefined : { kind: 'type', names: [name] };
    }
    case 'DeclareSumType': {
      const ops = [...operands(statement)];
      const name = declarationName(ops[0] ?? null);
      if (name === undefined) return undefined;
      const names = [name];
      // Operand 1 may be the attributes dictionary (`typeParams`); a variant
      // is told apart by its `Tuple` head, exactly as the engine's
      // `DeclareSumType` handler does it.
      for (const op of ops.slice(1)) {
        if (operator(op) !== 'Tuple') continue;
        const variant = declarationName(operand(op, 1));
        if (variant !== undefined) names.push(variant);
      }
      return { kind: 'type', names };
    }
    case 'DeclareProtocol': {
      const name = declarationName(operand(statement, 1));
      return name === undefined
        ? undefined
        : { kind: 'protocol', names: [name] };
    }
    default:
      return undefined;
  }
}

/** The name a declaration operand holds — a string or a symbol, the two
 * spellings every `Declare*` operand is read in. */
function declarationName(op: MathJsonExpression | null): string | undefined {
  if (op === null) return undefined;
  return stringValue(op) ?? symbol(op) ?? undefined;
}

/**
 * Does `statement`'s AST head declare a name the REDEFINITION DISCIPLINE
 * governs — a type, a protocol, or a function CLAUSE? The discipline's
 * statement-route marker (`IComputeEngine._epsilDeclarationRoute`) is raised
 * only around such a statement, so that a statement like `let x = f()` —
 * whose callee might declare something through the box route — never raises
 * it.
 *
 * `DefineFunction` joins the three declaration heads under the user ruling of
 * 2026-08-14: a clause that REPLACES one defined by another statement of the
 * same program is refused, the same within-unit rule the other three follow.
 * Only the replace case is affected; a clause at a distinct parameter list
 * still accumulates (`fib(0) = 0; fib(1) = 1; fib(n) = …`), so raising the
 * marker here costs an ordinary multi-clause program nothing.
 *
 * `DeclareConformance` is included for the same-statement no-op rather than
 * for a stamp: a conformance statement leaves no `_declOrigin` (its
 * within-batch duplicate rule keys on the `{batch, block}` implementation
 * stamp instead, ruling P47), but its handlers read the marker to prove a
 * re-registration is the statement route's own canonical/evaluate pair — an
 * ambient batch id alone cannot tell that apart from a re-entrant box-route
 * `.evaluate()` of the same boxed statement, which must keep taking the full
 * replacement path (see `declareConformance`'s same-block no-op).
 *
 * Exported for `execute-epsil.ts`, whose evaluation loop raises the same
 * marker around the statement it boxes and evaluates.
 */
export function isDeclarationStatement(statement: MathJsonExpression): boolean {
  const head = operator(statement);
  return (
    head === 'DeclareType' ||
    head === 'DeclareSumType' ||
    head === 'DeclareProtocol' ||
    head === 'DeclareConformance' ||
    head === 'DefineFunction'
  );
}

/** The engine error codes that mean a declaration statement DID NOT declare.
 * A statement that produced one of these never becomes the recorded "first"
 * declaration of its names (see {@link recordDeclaredNames}); the codes are
 * the ones `declareTypeStatement`/`declareSumTypeStatement`/
 * `declareProtocolStatement` (`src/compute-engine/library/core.ts`) return. */
const DECLARATION_BLOCKING_CODES = new Set([
  'invalid-type-declaration',
  'invalid-protocol-declaration',
  'type-redefinition',
  'protocol-redefinition',
]);

/**
 * REDEFINITION DISCIPLINE, static tier: enter the names `statement` declares
 * into the unit's pass-local collector — name → the range of the statement
 * that first declared it.
 *
 * Called only AFTER the statement has been canonicalized, and only when the
 * canonical form carries no declaration-blocking error, because a statement
 * that failed to declare is not the first declaration of anything: recording
 * it would make the NEXT declaration of that name a `type-redefinition` on
 * this tier while the runtime tier reported the real cause for both.
 *
 * A statement is recorded WHOLE or not at all — all N+1 names of a sum enter
 * under the one statement, mirroring the runtime tier where a rejected sum
 * registers none of its names. That is also what makes a PARTIAL collision (a
 * second sum reusing one variant name while renaming the others) exactly one
 * diagnostic rather than one per colliding name.
 *
 * See `docs/TYPE-SYSTEM.md`.
 */
function recordDeclaredNames(
  statement: MathJsonExpression,
  canonical: MathJsonExpression,
  source: string,
  declared: Map<string, [number, number]>
): void {
  const claimed = declaredNamesOf(statement);
  if (claimed === undefined) return;

  const errors: MathJsonExpression[] = [];
  collectErrors(canonical, errors);
  if (errors.some((e) => DECLARATION_BLOCKING_CODES.has(errorCode(e)))) return;

  const range = statementRange(statement, source);
  for (const name of claimed.names)
    declared.set(`${claimed.kind} ${name}`, range);
}

/**
 * REDEFINITION DISCIPLINE, static tier: is `statement` a second declaration of
 * a name this unit already declared? `declared` is the pass-local collector
 * {@link recordDeclaredNames} fills; this function only consults it.
 *
 * The FIRST colliding name wins and the statement yields exactly one
 * diagnostic, so a sum reusing several of an earlier sum's names is still one
 * report anchored on the statement.
 *
 * See `docs/TYPE-SYSTEM.md`.
 */
function redefinitionDiagnostic(
  statement: MathJsonExpression,
  source: string,
  declared: Map<string, [number, number]>
): ParsingDiagnostic | undefined {
  const claimed = declaredNamesOf(statement);
  if (claimed === undefined) return undefined;
  const [start, end] = statementRange(statement, source);

  for (const name of claimed.names) {
    const first = declared.get(`${claimed.kind} ${name}`);
    if (first === undefined) continue;
    return {
      severity: 'error',
      message: [
        claimed.kind === 'type' ? 'type-redefinition' : 'protocol-redefinition',
        name,
      ],
      range: [start, end, start],
      notes: [{ message: `\`${name}\` is first declared here`, range: first }],
    };
  }

  return undefined;
}

/** The names that cannot be rebound: see `ABSENCE_MARKERS` in
 * `library/core.ts`, whose declaration handlers refuse them at run time. */
const ABSENCE_MARKER_NAMES: ReadonlySet<string> = new Set([
  'Nothing',
  'Missing',
  'Undefined',
]);

/**
 * A binding of an absence marker — `let Missing = 3`, `Nothing = 1`, a
 * parameter, loop variable, match pattern or function named `Undefined` —
 * is an error (user decision 2026-09-27): the engine recognizes each marker
 * by its name, so a user binding of it could never behave like the value it
 * holds. One diagnostic per binding site, over the whole program, found with
 * the scope walker the language server uses for rename
 * (`documentBindings`), fed the engine's binding sites so a variable a
 * library call binds (`sum(Missing, Missing in xs)`) is found too. The
 * declaration, assignment and definition statements are also refused at run
 * time, by their handlers.
 */
function absenceMarkerBindingDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string
): ParsingDiagnostic[] {
  const found: ParsingDiagnostic[] = [];
  const groups = documentBindings(ast, source, {
    binderSites: (node) => binderSitesOf(ce, node, source),
  });
  for (const group of groups) {
    if (group.kind === 'free' || !ABSENCE_MARKER_NAMES.has(group.name))
      continue;
    // Every binding site: the definition, and each later assignment to the
    // same name (`Missing = 1; Missing = 2` — the walker records the second
    // as a `write`). A variable a library call binds (`sum(Missing, Missing
    // in xs)`) has neither: the walker records its uses as reads, and its
    // first occurrence stands for the binding.
    const definitions = group.occurrences.filter(
      (occurrence) =>
        occurrence.role === 'definition' || occurrence.role === 'write'
    );
    const sites =
      definitions.length > 0 ? definitions : group.occurrences.slice(0, 1);
    for (const occurrence of sites)
      found.push({
        severity: 'error',
        message: ['absence-marker-binding', group.name],
        range: [occurrence.start, occurrence.end, occurrence.start],
      });
  }
  return found;
}

/**
 * SAME-SCOPE RE-DECLARATION, top level: is `statement` a `let`/`const` of a
 * name an earlier `let`/`const` of this unit already declared? `declared` maps
 * each declared name to the range of its first declaration; this function
 * fills it for a statement it accepts and consults it for the rest. A
 * destructuring `let (p, q) = t` declares each pattern leaf (`_` declares
 * nothing). The FIRST colliding name wins and the statement yields one
 * diagnostic. Assignment (`x = …`) is not a declaration and is never reported.
 */
function variableRedeclarationDiagnostic(
  statement: MathJsonExpression,
  source: string,
  declared: Map<string, [number, number]>
): ParsingDiagnostic | undefined {
  const names = declaredVariableNames(statement);
  if (names.length === 0) return undefined;
  const range = statementRange(statement, source);
  // The statement is accepted or refused WHOLE (as `canonicalBlock` does
  // inside a block): a refused destructuring `let` declares none of its
  // leaves, so they stay free for a later `let`.
  const collision = names.find((name) => declared.has(name));
  if (collision === undefined) {
    for (const name of names) declared.set(name, range);
    return undefined;
  }
  return {
    severity: 'error',
    message: ['variable-redeclaration', collision],
    range: [range[0], range[1], range[0]],
    notes: [
      {
        message: `\`${collision}\` is first declared here`,
        range: declared.get(collision)!,
      },
    ],
  };
}

/**
 * The names a `Declare` statement declares, read from the raw AST: the symbol
 * target, or each leaf of a destructuring tuple pattern (`let (p, q) = t`).
 * `_` discards a component and `Nothing` is the erasure marker; neither
 * declares. Empty for any other statement — assignment (`x = …`) is not a
 * declaration. Shared by the static pass and the runtime tier of
 * `executeEpsil`, so the two describe the same statement.
 */
export function declaredVariableNames(statement: MathJsonExpression): string[] {
  if (operator(statement) !== 'Declare') return [];
  const names: string[] = [];
  const collect = (node: MathJsonExpression | null): void => {
    if (node === null) return;
    if (operator(node) === 'Tuple') {
      for (const el of operands(node)) collect(el);
      return;
    }
    const name = symbol(node);
    if (
      name !== null &&
      name !== undefined &&
      name !== '_' &&
      name !== 'Nothing'
    )
      names.push(name);
  };
  collect(operand(statement, 1));
  return names;
}

/** REDEFINITION DISCIPLINE, static tier: one clause this unit defined — its
 * parameter domain, and the range of the `DefineFunction` statement that
 * defined it (the "first defined here" site of a later collision). */
interface ClauseSite {
  signature: FunctionSignature;
  range: [number, number];
}

/**
 * REDEFINITION DISCIPLINE, static tier: drop every clause site this unit
 * recorded for a name that `statement` ASSIGNS to.
 *
 * Assignment full-replaces a clause set (design rule D6 — `Assign` drops the
 * clause list wholesale, which is why `f(0) = 1; f(n) = n + 1; f = x ↦ 42`
 * answers 42). A clause defined AFTER such an assignment is therefore the first
 * clause of a fresh binding, never a redefinition of one the assignment already
 * discarded; reporting it as one both cites a statement whose clause is gone and
 * contradicts the runtime tier, which clears its own provenance on this route
 * (`clearClauseProvenance`, `clause-identity.ts`).
 *
 * `Declare` counts only when it carries an initializer — `let f: (integer) ->
 * integer` states a contract and defines no clause, so it must not wipe one.
 */
function forgetReplacedClauses(
  statement: MathJsonExpression,
  clauses: Map<string, ClauseSite[]>
): void {
  const head = operator(statement);
  if (head !== 'Assign' && head !== 'Declare') return;
  // `Declare` with nothing in the value slot is a bare declaration.
  if (head === 'Declare' && operand(statement, 2) === null) return;
  const name = declarationName(operand(statement, 1));
  if (name !== undefined) clauses.delete(name);
}

/**
 * REDEFINITION DISCIPLINE, static tier: is `statement` a second definition of a
 * clause this unit already defined — one whose parameter domain coincides with
 * an earlier clause's, so that it would silently discard it? Records the
 * statement's own clause in `clauses` when it is not, so the collector is
 * filled and consulted in one place (the declaration half splits the two
 * because its recording is gated on the canonical form).
 *
 * Clause identity is `sameParameterDomain` — the very test
 * `defineFunctionClause` (`src/compute-engine/multi-clause.ts`) uses to choose
 * between replacing a clause and appending one, so what this reports is exactly
 * what would be overwritten. Clause ADDITION at a distinct parameter list
 * (`fib(0) = 0; fib(1) = 1; fib(n) = …`) is the idiom multi-clause functions
 * exist for and is never flagged.
 *
 * `boxed` is the CANONICAL statement, `DefineFunction(name, literal)`: the
 * literal's arrow type is where the parameter domain becomes readable, since an
 * unannotated parameter has no type in the source at all.
 *
 * Two shapes are deliberately passed over, so that this tier never reports a
 * problem the run reports differently:
 * - a GENERIC clause, or one landing on a generic definition. Rule G2 makes
 *   generic functions single-clause, so a second one is refused as
 *   `generic-clause-unsupported`, which names the real constraint.
 * - anything whose canonical form is not the expected `DefineFunction(name,
 *   Function(…))` — a malformed definition the run diagnoses on its own terms.
 *
 * A statement is RECORDED as a first definition only when canonicalization
 * actually installed its clause — `canonInstallSkipped` is the canonical
 * route's own marker for an install it refused, the counterpart of the
 * declaration half's `DECLARATION_BLOCKING_CODES` gate (read as a marker rather
 * than as an error node because `DefineFunction`'s canonical handler swallows
 * its failures; they are minted on the evaluate route). Without it, a
 * definition refused for an INDEPENDENT reason — `x := 5` followed by
 * `x(n) = …` — would become the "first definition" a later clause is reported
 * as replacing, while the run reported the real cause for both. The gate is on
 * the recording only, never on the report: a clause the discipline itself
 * refuses is marked skipped too, and that one is exactly what must be reported.
 *
 * See `docs/TYPE-SYSTEM.md`.
 */
function clauseRedefinitionDiagnostic(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  boxed: ReturnType<ComputeEngine['box']> | undefined,
  source: string,
  clauses: Map<string, ClauseSite[]>
): ParsingDiagnostic | undefined {
  if (operator(statement) !== 'DefineFunction') return undefined;
  // The NAME and the RANGE come from the raw statement (the canonical tree
  // carries no source offsets); the parameter domain from the canonical one.
  const name = declarationName(operand(statement, 1));
  if (name === undefined || !isFunction(boxed, 'DefineFunction'))
    return undefined;
  const literal = boxed.ops[1];
  if (!isFunction(literal, 'Function')) return undefined;
  const literalType = literal.type.type;
  if (isPolymorphicType(literalType)) return undefined;

  const signature = clauseSignatureOf(literalType);
  const range = statementRange(statement, source);
  const defined = clauses.get(name) ?? [];
  const first = defined.find((c) =>
    sameParameterDomain(c.signature, signature)
  );

  if (first === undefined) {
    if (!canonInstallSkipped(ce.lookupDefinition(name))) {
      defined.push({ signature, range });
      clauses.set(name, defined);
    }
    return undefined;
  }

  return {
    severity: 'error',
    message: ['function-redefinition', name],
    range: [range[0], range[1], range[0]],
    notes: [
      {
        message: `this clause of \`${name}\` is first defined here`,
        range: first.range,
      },
    ],
  };
}

/**
 * Provisionally register the function signature a statement will PIN when it
 * evaluates, so the later statements of the same program check their calls —
 * named calls, and the ARGUMENTS of a call to a function literal — against
 * it. Three spellings pin one:
 *
 * - `f := (x: number, y: string) => …` — assignment of a function literal
 *   whose own (annotated) type is a signature carrying parameter names;
 * - `let/const f : (x: number, y: string) -> number [= …]` — a declaration
 *   whose type annotation is such a signature (with or without an
 *   initializer: the annotation alone pins it);
 * - `let/const f = (x: number, y: string) => …` — a declaration with no
 *   annotation whose initializer is such a function literal.
 *
 * All are evaluation-time effects this pass otherwise cannot see ("prior
 * declarations are mostly not modeled" above), so before this carve-out a
 * named call to such a callee drew one false `argument-names-unavailable`
 * static diagnostic per argument for a program that runs fine. (`function
 * f(…) {…}` definitions never had the problem: `DefineFunction` installs its
 * clause at canonicalization.)
 *
 * A pin made from a function LITERAL (the first and third spellings) also
 * registers the definition in `ce._staticPinnedCallees`, so boxing validates
 * the arguments of a later call against the literal's signature exactly as
 * it validates a call to a declared one. The run time never does: a value
 * definition holding a literal stays INFERRED, and the literal refuses a
 * wrong argument itself, when applied, with an error VALUE. So the linter is
 * deliberately stricter than the engine here — `k(1.5)` after
 * `let k = (n: integer) => n + 1` is reported, as it is after either
 * annotated spelling of the same callee.
 *
 * Deliberately narrow, so every diagnostic the pass still emits stays
 * truthful:
 *
 * - Only a signature that CARRIES at least one parameter name registers. An
 *   UNANNOTATED literal's inferred signature drops its names
 *   (`effects-inference.ts` types a bare parameter `{ type: 'unknown' }`), so
 *   a named call to `h := (x, y) => …` fails at runtime too and the static
 *   diagnostic is a true prediction — it must keep firing.
 * - An `Assign` registers only a function-LITERAL right-hand side. Any other
 *   expression's static type is an upper bound, not the signature the
 *   assignment will pin, and permuting a call against a guessed signature
 *   could silently reorder arguments.
 * - A `:=` pin is FIRST-wins per name (`PinnedSignature.firstWins`),
 *   mirroring the runtime: reassigning such a binding to an incompatible
 *   signature is a runtime error that leaves the original binding in force,
 *   and a compatible reassignment of an annotated literal leaves the
 *   parameter TYPES of the signature unchanged. It gives the pin its own
 *   parameter names, because the latest literal is the one that runs, and
 *   its own result when it states none (`reassignedPin()`). A literal with
 *   no annotation replaces the pin, as it replaces the signature at run
 *   time. First-wins also keeps
 *   `_infer()`'s `narrow(old, new)` off the incompatible-signatures path,
 *   whose meet is `never`. A `let`/`const` pin is the opposite, again
 *   mirroring the runtime, where an assignment REPLACES such a binding: a
 *   later assignment of a function literal re-pins the name with the new
 *   literal's signature (`_infer` in `replace` mode), and an assignment of
 *   anything else drops the pin. The map is needed on top of the
 *   definition's own state because boxing a later `Assign` to the same name
 *   runs the recursion-knot retype (library/core.ts), resetting the target
 *   to the wildcard `function` type mid-pass — after such a statement the
 *   pinned signature is re-asserted from the map.
 * - Beyond that, registration only fills a BLANK: an inferred `unknown`
 *   or wildcard `function` type (the auto-declaration a forward reference
 *   creates). A pre-existing concrete type — a user declaration, an earlier
 *   cell's binding — wins for the same mirror-the-runtime reason.
 *
 * The write goes through `_infer()` on a bound symbol — the `Assign`/`Declare`
 * operands hold their target structurally, unbound — inside the pass's
 * inference rollback frame, so it is journaled and undone when the pass ends:
 * checking still mutates nothing (`test/epsil/static-check-rollback.test.ts`).
 * A name that was not yet declared auto-declares into the pass's own scope,
 * which pops with it.
 */
function registerPinnedSignature(
  ce: ComputeEngine,
  boxed: ReturnType<ComputeEngine['box']>,
  pinned: Map<string, PinnedSignature>
): void {
  let name: string | null = null;
  let type: Type | undefined = undefined;
  // Whether a later assignment in this program KEEPS this signature (the
  // `:=` spelling) or REPLACES the binding (a `let`/`const` declaration);
  // see `PinnedSignature`.
  let firstWins = true;
  // A function LITERAL this statement binds to the name, when it does. Only
  // such a pin asks boxing to validate the arguments of later calls (the
  // `_staticPinnedCallees` registration below): an annotation pins a
  // DECLARED type, whose calls boxing validates on its own.
  let literalCallee: ReturnType<ComputeEngine['box']> | undefined = undefined;
  if (isFunction(boxed, 'Assign')) {
    const target = boxed.ops[0];
    name = isSymbol(target) ? target.symbol : null;
    const rhs = boxed.ops[1];
    const already = name === null ? undefined : pinned.get(name);
    if (already !== undefined) {
      // ANY assignment to an already-pinned name may just have run the
      // recursion-knot retype and blanked the definition. For a `:=` pin,
      // re-assert the first-registered signature (see the doc comment)
      // whatever this statement's right-hand side is.
      if (already.firstWins) {
        // An assignment of a function literal over a pin that an
        // assignment made does at run time what `assignFn`
        // (`engine-declarations.ts`) does, and the pin follows it:
        // - The pin came from a literal with no annotation (an inferred
        //   signature), or the new literal has no annotation
        //   (`functionLiteralHasAnnotation()`): the new literal replaces the
        //   signature. After `f := (x: number, y: number) => x + 3` and
        //   `f := (a, b) => a * b`, the signature has no parameter names, and
        //   `f(x: 2, y: 5)` is `argument-name-unknown`.
        // - Otherwise the new literal is checked against the pinned
        //   signature (`reassignedPin()`). When it is accepted, the pin
        //   takes its parameter names, because the latest literal is the one
        //   that runs, and its result when it states none. When it is
        //   refused, the binding keeps its signature.
        if (already.assigned && rhs?.operator === 'Function') {
          if (!already.annotated || !functionLiteralHasAnnotation(rhs)) {
            pinned.delete(name!);
            const def = ce.box(name!).valueDefinition;
            if (def !== undefined) ce._staticPinnedCallees?.delete(def);
            replacePin(ce, name!, rhs, pinned);
            return;
          }
          const next = reassignedPin(already, rhs);
          if (next !== undefined) {
            const sym = ce.box(name!);
            if (sym._infer(() => next, 'replace')) {
              pinned.set(name!, {
                ...already,
                type: next,
                validation: validationSignatureOf(rhs, next),
              });
              const def = sym.valueDefinition;
              if (def !== undefined) ce._staticPinnedCallees?.set(def, rhs);
              return;
            }
          }
        }
        ce.box(name!)._infer(() => already.type, 'narrow');
        return;
      }
      // A `let` binding is REPLACED by the assignment at run time. A
      // function-literal right-hand side re-pins the name with the
      // literal's own signature (see `replacePin`); anything else un-pins
      // it, and the assignment's type effect (`applyAssignmentTypeEffect`)
      // then owns the type. Either way the old signature must stop
      // validating calls.
      pinned.delete(name!);
      const sym = ce.box(name!);
      const def = sym.valueDefinition;
      if (def !== undefined) ce._staticPinnedCallees?.delete(def);
      if (rhs !== undefined && rhs.operator === 'Function')
        replacePin(ce, name!, rhs, pinned);
      return;
    }
    if (
      name !== null &&
      rhs !== undefined &&
      rhs.operator === 'Function' &&
      assignOverUserFunction(ce, name, rhs)
    )
      return;
    if (rhs !== undefined && rhs.operator === 'Function') {
      type = rhs.type.type;
      literalCallee = rhs;
      // The target may be an EARLIER evaluation's `let` binding that holds
      // a function literal (a previous notebook cell's
      // `let k = (n: integer) => n + 1`): an inferred value definition with
      // a `Function` value. The run time REPLACES such a binding, so the pin
      // replaces its signature too (see `replacePin`) — the fill-a-blank
      // gate below would keep the old one, and the calls that follow would
      // be checked against a signature the program just threw away.
      if (name !== null) {
        const def = ce.lookupDefinition(name);
        if (
          def !== undefined &&
          isValueDef(def) &&
          def.value.inferredType &&
          def.value.value?.operator === 'Function'
        ) {
          replacePin(ce, name, rhs, pinned);
          return;
        }
      }
    }
  } else if (isFunction(boxed, 'Declare')) {
    // `["Declare", sym, "'type'", {dict}?]` — the annotation is positional
    // and optional (same shape `declaredTypeMismatch` reads).
    const target = boxed.ops[0];
    name = isSymbol(target) ? target.symbol : null;
    const typeOp = boxed.ops[1];
    if (isString(typeOp)) {
      try {
        type = ce.type(typeOp.string).type;
      } catch {
        // A malformed annotation is already a `type-annotation-error`.
        return;
      }
    } else {
      // `let/const f = ⟨function literal⟩`, no annotation: the Epsil lowering
      // carries the initializer in a trailing attributes dictionary under
      // `value` (the shape `applyAssignmentTypeEffect` reads). The literal's
      // own signature is what the declaration will pin.
      const last = boxed.ops[boxed.ops.length - 1];
      const init = isDictionary(last) ? last.get('value') : undefined;
      if (init !== undefined && init.operator === 'Function') {
        type = init.type.type;
        // A `let` binding is replaced by a later assignment; a `const`
        // binding refuses it (the assignment is a runtime error that leaves
        // the binding in force), so its first signature keeps checking the
        // calls that follow.
        const constant = isDictionary(last) ? last.get('constant') : undefined;
        firstWins = constant !== undefined && isSymbol(constant, 'True');
        literalCallee = init;
      }
    }
  }
  if (name === null || type === undefined) return;
  if (!isNamedSignature(type) || pinned.has(name)) return;

  const def = ce.lookupDefinition(name);
  if (def !== undefined) {
    // An operator definition (a builtin, or a `function` definition earlier
    // in this program) is not this statement's to re-pin.
    if (!isValueDef(def)) return;
    if (def.value.isConstant) return;
    // Fill-a-blank gate (see the doc comment above).
    if (!def.value.inferredType && !def.value.type.isUnknown) return;
    if (
      !def.value.type.isUnknown &&
      !isWildcardFunctionType(def.value.type.type)
    )
      return;
  }
  // Bound to a `const` so the thunk keeps the narrowing the guards above
  // established (`type` is a reassignable local, which a closure widens back
  // to `Type | undefined`).
  const pinnedType = type;
  const sym = ce.box(name);
  if (!sym._infer(() => pinnedType, 'narrow')) return;
  pinned.set(name, {
    type: pinnedType,
    firstWins,
    assigned: isFunction(boxed, 'Assign'),
    annotated:
      literalCallee !== undefined &&
      functionLiteralHasAnnotation(literalCallee),
    validation:
      literalCallee === undefined
        ? undefined
        : validationSignatureOf(literalCallee, pinnedType),
  });
  // The pin came from a function literal: ask boxing to validate the
  // arguments of the later calls against it, exactly as it validates a call
  // to a DECLARED signature (the gate in `box.ts`, `staticallyPinnedCallee`).
  // The run time defers that refusal to the application itself — the pinned
  // definition stays INFERRED — so without this registration the pass boxed
  // `k(1.5)` clean for `let k = (n: integer) => n + 1` while both annotated
  // spellings of the same callee flagged the call.
  const pinnedDef = sym.valueDefinition;
  if (literalCallee !== undefined && pinnedDef !== undefined)
    ce._staticPinnedCallees?.set(pinnedDef, literalCallee);
}

/**
 * The definition of `name` in the scope of the pass (the frame that
 * `staticDiagnostics` pushes), or `undefined` when the name has no binding in
 * that scope. A binding of an outer scope (an earlier cell, a host
 * declaration) is never changed by the pass.
 */
function passScopeDefinition(
  ce: ComputeEngine,
  name: string
): ReturnType<ComputeEngine['lookupDefinition']> {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return undefined;
  return ce.context.lexicalScope.bindings.get(name) === def ? def : undefined;
}

/**
 * An assignment of the function literal `literal` to `name`, when `name` is
 * a user function that a `function` statement defined, in this program or in
 * an earlier program on the same engine. The pass makes the change that the
 * run time makes, with the same code (`assignFn`, `engine-declarations.ts`),
 * and returns `true`. The rules of
 * the run time, in short:
 * - A definition with several clauses, or one whose signature was inferred
 *   (no annotation), is replaced by the literal.
 * - A definition from an annotated literal is a record of that literal. A
 *   literal with no annotation replaces it. An annotated literal is checked
 *   against its parameters: when it is accepted, the signature takes the
 *   names of the literal, and its result when it states none; when it is
 *   refused, the definition stays (the run time reports the error).
 *
 * Example: after `function h(x: integer) { x }` and `h := (u) => "s"`, the
 * signature has no parameter names, and `h(x: 3)` is `argument-name-unknown`
 * at run time and in this pass.
 *
 * The pass never changes a binding of an outer scope. When the definition
 * comes from an earlier program, the pass first declares, in its own scope,
 * a binding that holds the same operator definition, and the assignment
 * then changes that binding. The assignment replaces the operator
 * definition of the binding with a new one (`updateDef()`), so the operator
 * definition of the earlier program is not changed, and the binding of the
 * pass is removed when the pass ends. When the run time refuses the
 * assignment, the binding of the pass is removed at once: it holds the
 * operator definition of the earlier program itself, not a copy, so a later
 * statement of the pass that changes the definition of the binding in place
 * would change the definition of the earlier program.
 *
 * `false`, and nothing changes, when `name` is not such a definition.
 */
function assignOverUserFunction(
  ce: ComputeEngine,
  name: string,
  literal: ReturnType<ComputeEngine['box']>
): boolean {
  let def = passScopeDefinition(ce, name);
  let declared = false;
  if (def === undefined) {
    const outer = ce.lookupDefinition(name);
    if (outer === undefined || !isOperatorDef(outer)) return false;
    if (!outer.operator.isUserFunctionDefinition) return false;
    def = ce._declareSymbolOperator(name, outer.operator);
    declared = true;
  }
  if (!isOperatorDef(def)) return false;
  if (!def.operator.isUserFunctionDefinition) return false;
  try {
    ce.assign(name, literal);
  } catch {
    // The run time refuses the assignment, and the definition stays. The
    // binding that this function declared holds the operator definition of
    // the earlier program, so it is removed, and the name again reads the
    // binding of the earlier program.
    if (declared) ce.undeclare(name);
  }
  return true;
}

/**
 * Before a `function` statement for `name` is boxed: when an assignment of a
 * function literal (`PinnedSignature.assigned`) or a `let` declaration made
 * the pin of `name`, make the binding in the scope of the pass the
 * definition that the run time has. The pass does not run the assignment or
 * the declaration: it only pins the signature of the literal on a value
 * definition. At run time the binding holds the literal, and the `function`
 * statement then adds a clause to it, or replaces it when the two have the
 * same parameter domain (`defineFunctionClause`, `multi-clause.ts`).
 *
 * Example: after `h := (x: integer) => x` and `function h(u) -> string {
 * "s" }`, `h` has the two clauses `(x: integer) -> integer` and
 * `(unknown) -> string`, so `h(x: 3)` is valid and gives `3`. Without the
 * first clause, the pass would read `h` as `(unknown) -> string` only and
 * report `argument-name-unknown`.
 *
 * The pin is then removed: the binding is a user function, and a later
 * assignment to it is handled as an assignment over a user function
 * (`assignOverUserFunction()`).
 *
 * When a `const` declaration of this program bound `name` (`constants`),
 * the run time refuses the `function` statement and the binding stays as it
 * is: see {@link keepConstantBinding}. The function to call after the
 * statement is boxed is then returned.
 */
function installAssignedLiteralBeforeClause(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  pinned: Map<string, PinnedSignature>,
  constants: Map<string, [number, number]>
): (() => void) | undefined {
  if (operator(statement) !== 'DefineFunction') return undefined;
  const name = declarationName(operand(statement, 1));
  if (name === undefined) return undefined;
  if (constants.has(name)) return keepConstantBinding(ce, name, pinned);
  const pin = pinned.get(name);
  if (pin === undefined) return undefined;
  // A pin that an annotation made (`let h : (x: integer) -> integer`) is not
  // `assigned` and is first-wins. It is left alone.
  if (!pin.assigned && pin.firstWins) return undefined;
  const def = passScopeDefinition(ce, name);
  if (def === undefined || !isValueDef(def)) return undefined;
  const literal = ce._staticPinnedCallees?.get(def.value);
  pinned.delete(name);
  ce._staticPinnedCallees?.delete(def.value);
  if (literal === undefined) return undefined;
  try {
    ce.assign(name, literal);
  } catch {
    // The binding stays a value definition: the `function` statement is
    // then checked as the first definition of the name.
  }
  return undefined;
}

/**
 * Before a `function` statement for `name` is boxed, when a `const`
 * declaration of this program bound `name`: keep the binding that the run
 * time has. At run time the binding is a constant, so the `function`
 * statement does not install its clause (`defineFunctionClause()` refuses it
 * with `invalid-clause-definition`), and the binding keeps its value and its
 * type.
 *
 * The pass does not run the declaration: the binding in the scope of the
 * pass is a value definition with an inferred type (with the signature of
 * the literal when the declaration pinned one, see
 * `registerPinnedSignature()`), or there is no binding yet. Boxing the
 * `function` statement would install the clause on it. To prevent this, the
 * binding gets the mark that the engine gives a binding whose clause it did
 * not install (`noteCanonInstallSkipped()`), which is also what boxing does
 * at run time when it cannot install the clause on the constant. The
 * binding is not marked as a constant: boxing the statement first changes
 * the type of an inferred binding to `function` (`DefineFunction`,
 * `library/core.ts`), and that change throws on a constant, which prints an
 * error to the console.
 *
 * When the declaration pinned a signature, the function that is returned
 * puts it back on the binding after the statement is boxed. Example: after
 * `const h = (x: integer) => x` and `function h(u: string) { u }`, `h(x: 3)`
 * is valid and gives `3`, and `h(u: "a")` is `argument-name-unknown`.
 *
 * Only a binding in the scope of the pass is marked: the mark is not undone
 * when the pass ends, so a binding of an outer scope (an earlier program, a
 * host declaration) must not get it. For such a binding nothing changes.
 */
function keepConstantBinding(
  ce: ComputeEngine,
  name: string,
  pinned: Map<string, PinnedSignature>
): (() => void) | undefined {
  // No binding at all: declare one in the scope of the pass, as boxing the
  // statement would.
  if (ce.lookupDefinition(name) === undefined) ce.box(name);
  const def = passScopeDefinition(ce, name);
  if (def === undefined || !isValueDef(def)) return undefined;
  noteCanonInstallSkipped(def);
  const pin = pinned.get(name);
  if (pin === undefined) return undefined;
  return () => {
    ce.box(name)._infer(() => pin.type, 'narrow');
  };
}

/**
 * A top-level `function` statement (or `name(params) = body` definition) for
 * a name that an earlier `const` declaration of this program bound. At run
 * time `defineFunctionClause()` (`multi-clause.ts`) refuses to add a clause
 * to a constant, the statement evaluates to an `invalid-clause-definition`
 * error, and the binding keeps its value. `constants` maps each such name to
 * the range of its declaration.
 *
 * The pass reports the refusal as the run time describes it, in the form the
 * pass uses for the other errors that the engine finds before anything runs:
 * a `static-type-error` that carries the engine's error code. Example:
 * `const c = 1` then `function c(x) { x }` gives `invalid clause definition —
 * "c" is a constant; it cannot be redefined` on the `function` statement,
 * with a note on the `const` declaration.
 *
 * A `function` statement inside a block or a function body is not a
 * redefinition: it declares a local binding that shadows the constant.
 */
function constantClauseDiagnostic(
  statement: MathJsonExpression,
  source: string,
  constants: Map<string, [number, number]>
): ParsingDiagnostic | undefined {
  if (operator(statement) !== 'DefineFunction') return undefined;
  const name = declarationName(operand(statement, 1));
  if (name === undefined) return undefined;
  const declared = constants.get(name);
  if (declared === undefined) return undefined;
  // The same error value as the one that the `DefineFunction` handler
  // returns at run time (the `ClauseDefinitionError` thrown for a constant
  // in `defineFunctionClause()`), so both tiers describe it with the same
  // words.
  const error: MathJsonExpression = [
    'Error',
    { str: 'invalid-clause-definition' },
    { str: `"${name}" is a constant; it cannot be redefined` },
  ];
  const [start, end] = statementRange(statement, source);
  return {
    severity: 'error',
    message: [
      'static-type-error',
      describeError(error),
      epsilSnippet(statement),
      'invalid-clause-definition',
    ],
    range: [start, end, start],
    notes: [
      { message: `\`${name}\` is declared constant here`, range: declared },
    ],
  };
}

/**
 * The data that the static pass uses to find the assignments to the
 * constants of the program. Made once for the program, when the program
 * declares a constant.
 */
type ConstantWrites = {
  /** The binding groups of the scope-aware walk of the program
   * (`documentBindings()`), by name. */
  byName: Map<string, BindingGroup[]>;
  /** The top-level statements, and the source range of each. */
  statements: MathJsonExpression[];
  statementRanges: [number, number][];
  source: string;
  /** The constants that are registered. */
  registered: Set<BindingGroup>;
  /** The source ranges of the function literals of the program. Made when
   * a constant first needs them. */
  functionRanges: [number, number][] | undefined;
  /** The reports for the statements that the pass did not reach yet, by
   * the index of the statement. */
  pending: Map<number, ParsingDiagnostic[]>;
};

function constantWritesOf(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string,
  statements: MathJsonExpression[]
): ConstantWrites {
  const byName = new Map<string, BindingGroup[]>();
  for (const group of documentBindings(ast, source, {
    binderSites: (node) => binderSitesOf(ce, node, source),
  })) {
    const named = byName.get(group.name);
    if (named === undefined) byName.set(group.name, [group]);
    else named.push(group);
  }
  return {
    byName,
    statements,
    statementRanges: statements.map((s) => statementRange(s, source)),
    source,
    registered: new Set(),
    functionRanges: undefined,
    pending: new Map(),
  };
}

/** The index of the top-level statement that holds the source range
 * `[start, end]`, else `-1`. The statements are in source order, so the
 * search is a binary search on their start offsets. */
function statementHolding(
  writes: ConstantWrites,
  start: number,
  end: number
): number {
  const ranges = writes.statementRanges;
  let low = 0;
  let high = ranges.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (ranges[middle][0] <= start) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found >= 0 && end <= ranges[found][1] ? found : -1;
}

/**
 * Register the constant of `group`, declared at the range `declared`, and
 * find each assignment to it: a binding of a `const` declaration of this
 * program, a top-level `const` or a `const` in a function body or a block.
 * At run time the assignment throws (the engine's
 * `ConstantAssignmentError`), and the binding keeps its value.
 *
 * The reports for the statements up to the statement of index `current`
 * are returned, for the pass to report now. The reports for the later
 * statements are kept in `writes.pending`, and the pass reports them when
 * it reaches each statement. A `const` in a function body or a block is
 * registered before the pass reaches any statement (`current` is `-1`).
 *
 * The scope-aware walk of the program (`documentBindings()`) records an
 * assignment to a visible binding as a `write` occurrence of the group of
 * that binding. So a write anywhere is found: at the top level (`c = 2`), in
 * a block or a loop body (`if t { c = 2 }`), in a function body, and in each
 * leaf of a destructuring assignment (`(a, c) := (3, 4)`). An assignment to
 * a binding that shadows the constant (a `let c`, a parameter `c`, a loop
 * variable `c`) is in the group of that binding, and is not reported. An
 * indexed assignment (`c[1] = 2`) is not a `write` of `c`: it does not
 * replace the binding (the engine refuses an indexed assignment to any
 * binding, with another error).
 *
 * The walk resolves a write that comes before a `let` of the same name in
 * an enclosing block to the outer binding, but at run time the write
 * targets the local of the block and fails with `read-before-declaration`.
 * Such a write is not reported here.
 *
 * An assignment in a function body that comes before the `const` is not a
 * `write` of the group: the walk makes it a declaration of a new binding.
 * For a top-level `const`, that is what the run does too: the assignment
 * makes a local of the function body, with a new binding at each call, and
 * the constant is not written. For a `const` in a block, the run binds the
 * name in the block before the function is canonicalized, so the
 * assignment writes the constant when the function is called after the
 * `const`. Such assignments are reported too (`writesFromFunctionBodies()`).
 *
 * Each diagnostic is a `static-type-error` that carries the engine code
 * `constant-assignment`, at the assignment, with a note on the `const`
 * declaration. The description is the one the run time gives for the error
 * value (`constantAssignmentError()`). `executeEpsil()` does not report the
 * run-time error a second time when the engine reports the same
 * assignment: the same source range of the `Assign` node.
 *
 * The cost is in proportion to the number of bindings with the name of the
 * constant, not to the size of the program: a program of many constants is
 * checked in linear time.
 */
function registerConstant(
  writes: ConstantWrites,
  group: BindingGroup,
  declared: [number, number],
  current: number
): ParsingDiagnostic[] {
  if (writes.registered.has(group)) return [];
  writes.registered.add(group);
  const named = writes.byName.get(group.name) ?? [];
  const occurrences = group.occurrences.filter((occurrence) => {
    if (occurrence.role !== 'write') return false;
    const shadowed = named.some(
      (other) =>
        other !== group &&
        other.kind !== 'free' &&
        other.scope[0] <= occurrence.start &&
        occurrence.end <= other.scope[1] &&
        group.scope[0] <= other.scope[0] &&
        other.scope[1] <= group.scope[1] &&
        (other.scope[0] !== group.scope[0] || other.scope[1] !== group.scope[1])
    );
    return !shadowed;
  });
  // A local `const` (`current` is `-1`) is hoisted in its block before the
  // functions of the block are canonicalized, so a function defined before
  // it in the block writes it. A top-level `const` is not: see
  // `writesFromFunctionBodies()`.
  if (current < 0)
    occurrences.push(...writesFromFunctionBodies(writes, group, named));
  occurrences.sort((a, b) => a.start - b.start);

  const now: ParsingDiagnostic[] = [];
  for (const occurrence of occurrences) {
    const index = statementHolding(writes, occurrence.start, occurrence.end);
    if (index < 0) continue;
    const statement = writes.statements[index];
    const assignment =
      assignmentWriting(statement, occurrence.start) ?? statement;
    const [start, end] = statementRange(assignment, writes.source);
    const diagnostic: ParsingDiagnostic = {
      severity: 'error',
      message: [
        'static-type-error',
        describeError(constantAssignmentError(group.name)),
        epsilSnippet(assignment),
        'constant-assignment',
      ],
      range: [start, end, start],
      notes: [
        {
          message: `\`${group.name}\` is declared constant here`,
          range: declared,
        },
      ],
    };
    if (index <= current) now.push(diagnostic);
    else {
      const later = writes.pending.get(index);
      if (later === undefined) writes.pending.set(index, [diagnostic]);
      else later.push(diagnostic);
    }
  }
  return now;
}

/**
 * The assignments that write the constant of `group` when they run, but
 * that the scope-aware walk does not record as a `write` of `group`: the
 * assignments in a function body (a `function` statement or a function
 * literal) that comes before the `const` in the scope of the constant.
 * `named` holds the binding groups with the name of the constant. Only for
 * a `const` in a block (a function body, a `do` block, a branch, a loop
 * body).
 *
 * Where the `const` is not yet visible, the walk makes such an assignment
 * the declaration of a new binding (a bare `c = 2` declares), in the
 * innermost block. The run binds each `const` of a block in the block
 * before it canonicalizes the statements of the block
 * (`canonicalBlock()`, `library/control-structures.ts`), so the function
 * body finds the constant, and the assignment writes it when the function
 * is called after the `const`. The engine refuses it:
 *
 * ```
 * function o() scope -> integer {
 *   let g = () => do { c = 2 }
 *   const c = 1
 *   g()        // the assignment `c = 2` writes the constant
 * }
 * ```
 *
 * The report does not depend on the calls: the assignment is reported also
 * when the function is not called.
 *
 * A top-level `const` is not bound before the earlier statements are
 * canonicalized, so for it the assignment makes a local of the function
 * body, as the walk says, and nothing is reported.
 *
 * Such a binding is reported when:
 * - it has the name of the constant, and its scope is in the scope of the
 *   constant and in a function body that is in the scope of the constant;
 * - each of its declarations is an assignment (not a `let` or a `const`,
 *   which make a real local binding);
 * - no other binding of the name, other than such a binding, has a scope
 *   that contains it and is in the scope of the constant. A `let`, a
 *   parameter or a loop variable of the name in an enclosing scope of the
 *   function is the binding that the assignment writes at run time.
 *
 * Each declaration and each `write` of such a binding is an assignment that
 * is returned.
 */
function writesFromFunctionBodies(
  writes: ConstantWrites,
  group: BindingGroup,
  named: BindingGroup[]
): BindingGroup['occurrences'] {
  const within = (inner: [number, number], outer: [number, number]) =>
    outer[0] <= inner[0] && inner[1] <= outer[1];
  const strictlyWithin = (inner: [number, number], outer: [number, number]) =>
    within(inner, outer) && (inner[0] !== outer[0] || inner[1] !== outer[1]);
  const candidates = named.filter(
    (candidate) =>
      candidate !== group &&
      candidate.kind === 'variable' &&
      strictlyWithin(candidate.scope, group.scope)
  );
  if (candidates.length === 0) return [];
  // A binding whose every declaration is an assignment (`c = 2`).
  const declaredByAssignment = (binding: BindingGroup) =>
    binding.occurrences.every((o) => {
      if (o.role !== 'definition') return true;
      const index = statementHolding(writes, o.start, o.end);
      return (
        index >= 0 &&
        assignmentWriting(writes.statements[index], o.start) !== undefined
      );
    });
  writes.functionRanges ??= writes.statements.flatMap(functionLiteralRanges);
  const functions = writes.functionRanges.filter((range) =>
    strictlyWithin(range, group.scope)
  );
  const result: BindingGroup['occurrences'] = [];
  for (const candidate of candidates) {
    if (!functions.some((range) => within(candidate.scope, range))) continue;
    if (!declaredByAssignment(candidate)) continue;
    const shadowed = named.some(
      (other) =>
        other !== group &&
        other !== candidate &&
        other.kind !== 'free' &&
        within(candidate.scope, other.scope) &&
        strictlyWithin(other.scope, group.scope) &&
        !(other.kind === 'variable' && declaredByAssignment(other))
    );
    if (shadowed) continue;
    for (const occurrence of candidate.occurrences)
      if (occurrence.role === 'definition' || occurrence.role === 'write')
        result.push(occurrence);
  }
  return result;
}

/**
 * The diagnostics of the uses of a local, in the canonical statement
 * `boxed`, that are certain to come before the local has a value: an
 * assignment local of a function body before its first assignment, a `let`
 * or `const` local before its declaration (`readsBeforeAssignment()`,
 * `read-before-assignment.ts`).
 * `statement` is the raw top-level statement, whose range is used when the
 * canonical tree has no range for the read.
 *
 * Each diagnostic is a `static-type-error` that carries the engine code
 * `read-before-declaration`, at the symbol that reads the local. The
 * description is the one the run time gives for the error value.
 */
function readBeforeAssignmentDiagnostics(
  boxed: ReturnType<ComputeEngine['box']>,
  statement: MathJsonExpression,
  source: string
): ParsingDiagnostic[] {
  return readsBeforeAssignment(boxed).map(
    ({ name, kind, read, statement: held }) => {
      const [start, end] = read ?? held ?? statementRange(statement, source);
      const [from, to] = held ?? statementRange(statement, source);
      let snippet = source.slice(from, to).replaceAll(/\s+/g, ' ').trim();
      if (snippet.length > SNIPPET_LENGTH)
        snippet = `${snippet.slice(0, SNIPPET_LENGTH - 1)}…`;
      return {
        severity: 'error',
        message: [
          'static-type-error',
          describeError([
            'Error',
            [
              'ErrorCode',
              { str: 'read-before-declaration' },
              { str: name },
              ...(kind === 'assignment' ? [{ str: 'assignment' }] : []),
            ],
          ]),
          snippet,
          'read-before-declaration',
        ],
        range: [start, end, start],
      };
    }
  );
}

/** The source ranges of the function literals (`Function` nodes) in the raw
 * expression `expr`, at any depth. A `function` statement holds one too. */
function functionLiteralRanges(expr: MathJsonExpression): [number, number][] {
  const result: [number, number][] = [];
  const visit = (node: MathJsonExpression): void => {
    if (operator(node) === '') return;
    if (operator(node) === 'Function') {
      const span =
        typeof node === 'object' && !Array.isArray(node)
          ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
          : undefined;
      if (span !== undefined) result.push(span);
    }
    for (const op of operands(node)) visit(op);
  };
  visit(expr);
  return result;
}

/**
 * The error value of an assignment to the constant `name`. The run time
 * (`executeEpsil()`) makes this value from the `ConstantAssignmentError`
 * that the engine throws, and the static check describes the same value, so
 * both tiers describe the problem with the same words.
 */
export function constantAssignmentError(name: string): MathJsonExpression {
  return [
    'Error',
    ['ErrorCode', { str: 'constant-assignment' }, { str: name }],
  ];
}

/** Whether the raw node `node` is a `const` declaration:
 * `["Declare", target, type?, ["Dictionary", …, ["KeyValuePair",
 * "constant", "True"]]]`. */
function isConstantDeclaration(node: MathJsonExpression): boolean {
  if (operator(node) !== 'Declare') return false;
  const ops = [...operands(node)];
  const last = ops[ops.length - 1];
  if (last === undefined || operator(last) !== 'Dictionary') return false;
  return [...operands(last)].some(
    (entry) =>
      operator(entry) === 'KeyValuePair' &&
      symbol(operand(entry, 1)) === 'constant' &&
      symbol(operand(entry, 2)) === 'True'
  );
}

/** Every `const` declaration in the raw program `ast`, at any depth, in
 * source order. */
function constantDeclarations(ast: MathJsonExpression): MathJsonExpression[] {
  const result: MathJsonExpression[] = [];
  const visit = (node: MathJsonExpression): void => {
    if (operator(node) === '') return;
    if (isConstantDeclaration(node)) result.push(node);
    for (const op of operands(node)) visit(op);
  };
  visit(ast);
  return result;
}

/** The names that the target of a declaration binds, each with the source
 * offset of its name: a symbol, or each leaf of a `Tuple` pattern (`_`
 * binds nothing). */
function declarationLeaves(
  target: MathJsonExpression | null
): { name: string; start: number }[] {
  if (target === null) return [];
  if (operator(target) === 'Tuple')
    return [...operands(target)].flatMap(declarationLeaves);
  if (operator(target) === 'Typed')
    return declarationLeaves(operand(target, 1));
  const name = symbol(target);
  const span =
    typeof target === 'object' && !Array.isArray(target)
      ? (target as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined;
  if (name === null || name === '_' || span === undefined) return [];
  return [{ name, start: span[0] }];
}

/** The binding groups of the names that the declaration `declaration`
 * binds: for each name, the group with a `definition` occurrence at the
 * source offset of the name. */
function declaredGroups(
  byName: Map<string, BindingGroup[]>,
  declaration: MathJsonExpression
): BindingGroup[] {
  const result: BindingGroup[] = [];
  for (const leaf of declarationLeaves(operand(declaration, 1))) {
    const group = (byName.get(leaf.name) ?? []).find((g) =>
      g.occurrences.some(
        (o) => o.role === 'definition' && o.start === leaf.start
      )
    );
    if (group !== undefined) result.push(group);
  }
  return result;
}

/**
 * Whether the run time refuses the `const` of `group`, which is in a
 * function body or a block, as a re-declaration (`variable-redeclaration`,
 * found when the block is canonicalized). Then the block or the function
 * does not run, and the name is not a constant. Two cases:
 * - The block declares the name a second time (a `let` or a `const` before
 *   or after it): the scope-aware walk puts both declarations in one group.
 * - The block is the body of a function that has a parameter of that name,
 *   or of a loop whose variable has that name. The walk gives the parameter
 *   or the loop variable a scope that ends where the body ends.
 */
function isRefusedLocalConstant(
  group: BindingGroup,
  groups: BindingGroup[]
): boolean {
  const definitions = group.occurrences.filter((o) => o.role === 'definition');
  if (definitions.length > 1) return true;
  return groups.some(
    (other) =>
      other !== group &&
      other.name === group.name &&
      (other.kind === 'parameter' || other.kind === 'loop') &&
      other.scope[0] <= group.scope[0] &&
      other.scope[1] === group.scope[1]
  );
}

/** The innermost `Assign` node in `expr` whose target (or a leaf of a
 * destructuring target) is the symbol written at the source offset
 * `offset`. */
function assignmentWriting(
  expr: MathJsonExpression,
  offset: number
): MathJsonExpression | undefined {
  if (operator(expr) === '') return undefined;
  for (const op of operands(expr)) {
    const nested = assignmentWriting(op, offset);
    if (nested !== undefined) return nested;
  }
  if (operator(expr) !== 'Assign') return undefined;
  const writes = (target: MathJsonExpression | null): boolean => {
    if (target === null) return false;
    const head = operator(target);
    if (head === 'Tuple') return [...operands(target)].some(writes);
    if (head === 'Typed') return writes(operand(target, 1));
    const span =
      typeof target === 'object' && !Array.isArray(target)
        ? (target as { sourceOffsets?: [number, number] }).sourceOffsets
        : undefined;
    return symbol(target) !== null && span?.[0] === offset;
  };
  return writes(operand(expr, 1)) ? expr : undefined;
}

/** The name that `boxed` binds when it is a `const` declaration
 * (`["Declare", name, type?, {constant: True, …}]`), else `undefined`. */
function constantDeclarationName(
  boxed: ReturnType<ComputeEngine['box']>
): string | undefined {
  if (!isFunction(boxed, 'Declare')) return undefined;
  const target = boxed.ops[0];
  if (!isSymbol(target)) return undefined;
  const last = boxed.ops[boxed.ops.length - 1];
  const constant = isDictionary(last) ? last.get('constant') : undefined;
  return constant !== undefined && isSymbol(constant, 'True')
    ? target.symbol
    : undefined;
}

/** A function signature the pass registered for a name (see
 * `registerPinnedSignature`). `firstWins` mirrors what a LATER assignment to
 * the name does at run time: a `:=`-pinned or `const` binding keeps the
 * types of its first signature (an incompatible reassignment is a runtime
 * error that leaves the original binding in force), while a `let`
 * declaration is REPLACED by the assignment, so its pin is replaced or
 * dropped along with it — once.
 *
 * `assigned` is true when an assignment of a function literal made the pin,
 * and `annotated` when that literal has an annotation
 * (`functionLiteralHasAnnotation()`). A later assignment of a function
 * literal then changes the pin as it changes the signature at run time (see
 * the `Assign` branch of `registerPinnedSignature`). A `const` pin is not
 * `assigned`: the run time refuses a reassignment of the binding.
 *
 * `validation` records which parameters the literal of the pin annotated:
 * `type` with each bare slot typed `any`, or `undefined` when every slot is
 * annotated (`validationSignatureOf()`, the same record that the run time
 * keeps as `_validationSignature`). The type of a bare slot is inferred from
 * the uses of the parameter, so it is not a contract when a later literal
 * annotates that parameter (`reassignedPin()`). */
type PinnedSignature = {
  type: Type;
  firstWins: boolean;
  assigned?: boolean;
  annotated?: boolean;
  validation?: Type;
};

/** The signature that the name gets at run time when the annotated function
 * literal `literal` is assigned over the pin `pin`, which an earlier
 * annotated literal gave (`assignFn`, `engine-declarations.ts`).
 * `undefined` when the run time refuses the assignment, and the binding
 * keeps the signature of `pin`.
 *
 * The run time checks the PARAMETERS of the literal against the pinned
 * signature: the same arity, and each pinned parameter type a subtype of the
 * parameter type of the literal. Two parts of the pinned signature are a
 * record of the earlier literal, not a contract, and the same rules as at
 * run time apply to them:
 * - A slot that the earlier literal left bare has a type inferred from the
 *   uses of the parameter. When the new literal annotates that parameter,
 *   the annotation replaces it (`bareSlotsAsPlaceholders()`, then
 *   `reassignmentBaseSignature()`): after `h := (p, n: number) => p[1] + n`,
 *   the literal `(q: string, m: number) => m` is accepted, and the slot is
 *   `string`. When the new literal leaves the parameter bare too, the
 *   inferred type stays.
 * - The result: a literal that states no return type gives its own result
 *   (`(a: integer, b: integer) => (a - b) / 2` over
 *   `(x: integer, y: integer) -> integer`). A stated return type must be a
 *   subtype of the pinned result, which stays.
 *
 * The effects are inferred again from the body, so they are not compared
 * here. The signature that is returned has the parameter types of the
 * refined pinned signature and the parameter names of the literal. */
function reassignedPin(
  pin: PinnedSignature,
  literal: ReturnType<ComputeEngine['box']>
): Type | undefined {
  const own = literal.type.type;
  if (typeof own !== 'object' || own.kind !== 'signature') return undefined;
  const pinned = reassignmentBaseSignature(pin.type, pin.validation, literal);
  if (typeof pinned !== 'object' || pinned.kind !== 'signature')
    return undefined;
  if (isPolymorphicType(pinned) || isPolymorphicType(own)) return undefined;
  const parameters = (t: FunctionSignature): FunctionSignature => ({
    ...t,
    result: 'unknown',
    effects: undefined,
  });
  if (!isSubtype(parameters(own), parameters(pinned))) return undefined;
  const stated =
    functionLiteralReturnType(literal) !== undefined ||
    functionLiteralDeclaredSignature(literal) !== undefined;
  if (stated && !isSubtype(own.result, pinned.result)) return undefined;
  return withParameterNamesOf(
    stated ? pinned : { ...pinned, result: own.result },
    own
  );
}

/**
 * Re-pin `name` with the signature of the function literal an assignment
 * just gave it, mirroring the run time: assigning a function literal to a
 * `let` binding that holds one converts the binding into an operator
 * definition carrying the NEW literal's signature (`assignFn`,
 * `engine-declarations.ts`), and from then on a further reassignment is
 * checked against that signature and refused when incompatible — so the
 * replacement pin is FIRST-wins. The literal's signature is taken whether or
 * not it carries parameter names (an unannotated `(s) => s` replaces an
 * annotated literal just the same, and its `unknown` parameters admit every
 * argument), and the definition is registered for argument validation like
 * any literal pin.
 */
function replacePin(
  ce: ComputeEngine,
  name: string,
  literal: ReturnType<ComputeEngine['box']>,
  pinned: Map<string, PinnedSignature>
): void {
  const signature = literal.type.type;
  const sym = ce.box(name);
  if (!sym._infer(() => signature, 'replace')) return;
  pinned.set(name, {
    type: signature,
    firstWins: true,
    assigned: true,
    annotated: functionLiteralHasAnnotation(literal),
    validation: validationSignatureOf(literal, signature),
  });
  const def = sym.valueDefinition;
  if (def !== undefined) ce._staticPinnedCallees?.set(def, literal);
}

/** Is `t` a function signature declaring at least one parameter NAME — the
 * shape a named-argument call can be matched against? A signature without
 * names (every unannotated literal's inferred type) is positional-only. */
function isNamedSignature(t: Type): boolean {
  if (typeof t === 'string' || t.kind !== 'signature') return false;
  return [...(t.args ?? []), ...(t.optArgs ?? [])].some(
    (a) => a.name !== undefined
  );
}

/**
 * The per-statement declared-type check: for `let s: string = 42` — a
 * `Declare` carrying BOTH an annotation and an initializer — everything
 * needed to spot the mistake is inside the one statement, yet the runtime
 * check (`declaredTypeError`, fired by `Declare`'s evaluate path) never runs
 * in this pass. Compare the canonicalized initializer's STATIC type against
 * the annotation here instead.
 *
 * Soundness — no false positives, by construction:
 * - **Disjointness tier.** Evaluation only narrows a value within its static
 *   type, so if the static type is PROVABLY DISJOINT from the annotation
 *   (`BoxedType.isDisjointFrom`, conservative: unproven ⇒ "may overlap" ⇒
 *   silent), every runtime outcome fails too. This catches
 *   `let s: string = 42` (number vs string) and the unnamed-signature
 *   near-miss `const f : (number) -> number = x^2 + 1` (function vs number
 *   — reported with the same {@link unboundSignatureHint} explanation the
 *   runtime error carries).
 * - **Closed-literal tier.** A bare number/string/boolean literal IS its
 *   runtime value, so the full covariant `matches()` check applies — the
 *   same verdict the runtime reaches — catching overlapping-but-wrong cases
 *   like `let n: integer = 1.5`.
 *
 * Everything else (unknown-typed values, overlapping types, cross-statement
 * bindings) is left to the run phase: incomplete rather than unsound,
 * matching the pass's philosophy.
 *
 * Returns the diagnostic description, or `undefined` when the statement is
 * not a checkable declaration or no mismatch is provable.
 */
function declaredTypeMismatch(
  ce: ComputeEngine,
  boxed: ReturnType<ComputeEngine['box']>
): string | undefined {
  if (!isFunction(boxed, 'Declare')) return undefined;
  // `["Declare", sym, "'type'", {dict}]` — the annotation is positional and
  // optional; without one there is nothing to check against.
  const typeOp = boxed.ops[1];
  if (!isString(typeOp)) return undefined;
  const attributes = boxed.ops.find((op) => isDictionary(op));
  if (attributes === undefined || !isDictionary(attributes)) return undefined;
  const value = attributes.get('value');
  if (value === undefined) return undefined;
  // A deferred value (`holdUntil`) is not this pass's to judge.
  if (attributes.get('holdUntil') !== undefined) return undefined;

  let declared: ReturnType<ComputeEngine['type']>;
  try {
    declared = ce.type(typeOp.string);
  } catch {
    // A malformed annotation is already a `type-annotation-error`.
    return undefined;
  }
  if (declared.isUnknown || value.type.isUnknown) return undefined;

  const isClosedLiteral =
    isNumber(value) ||
    isString(value) ||
    isSymbol(value, 'True') ||
    isSymbol(value, 'False');
  // LITERAL NARROWING: `let c: character = "a"` is not a mismatch. Epsil has
  // no character literal, so a one-grapheme-cluster string LITERAL written at
  // a name whose declared type expects a character (and refuses a string)
  // becomes that character — the same conversion `Declare` performs when the
  // statement runs, decided by the same two predicates. A multi-cluster or
  // empty literal narrows to nothing and is still reported, and a non-literal
  // string never converts (`docs/STRING_ROADMAP.md`, design constraint 4).
  if (
    isString(value) &&
    expectsCharacterNotString(declared.type) &&
    isSingleGraphemeCluster(value.string)
  )
    return undefined;

  const mismatch = isClosedLiteral
    ? !value.type.matches(declared)
    : declared.isDisjointFrom(value.type);
  if (!mismatch) return undefined;

  const lead = `The value "${value.toString()}" of type "${value.type}" is not compatible with the declared type "${declared}"`;
  const hint = unboundSignatureHint(value, declared);
  return hint === undefined ? lead : `${lead}. ${hint}`;
}

/**
 * The multiset of `Error` nodes a statement carries in its **raw** (parsed,
 * not yet canonicalized) form, keyed by their description. Errors are values:
 * these are `Error(…)` calls the source wrote, and the canonical tree carries
 * them through unchanged — reporting them would fail every errors-as-values
 * program.
 */
function authoredErrors(statement: MathJsonExpression): Map<string, number> {
  const errors: MathJsonExpression[] = [];
  collectErrors(statement, errors);
  const result = new Map<string, number>();
  for (const error of errors) {
    const description = dedupKey(error);
    result.set(description, (result.get(description) ?? 0) + 1);
  }
  return result;
}

/**
 * The per-statement dedup / authored-subtraction key: the error's
 * description WITHOUT its site operand. The site names WHERE the mistake
 * happened, not WHAT it is — two occurrences of the same mistake in one
 * statement are one distinct problem ("one diagnostic per problem, not per
 * cascade"), and a program-AUTHORED error value (typically site-less) must
 * keep matching the engine-minted equivalent it stands for. The RENDERED
 * message still uses the full `describeError`, site included — the site is
 * detail, never identity.
 */
function dedupKey(error: MathJsonExpression): string {
  const cause = operand(error, 1);
  return describeError(cause === null ? error : ['Error', cause]);
}

/**
 * The `->`-for-`=>` typo in a call argument: a rule `name -> value` (a
 * `KeyValuePair` whose key is a bare name) passed at a position where the
 * callee expects a FUNCTION, as in `map(x -> x^2, xs)`.
 *
 * The parser reads a bare `name -> value` after the `(` or a `,` of a call as
 * a rule in every argument position, because a rule is a legitimate argument
 * (`f(GridLines -> 1, Axes -> 2)`) and the serializer writes rule arguments
 * this way. Only the callee's signature can tell that a function was meant,
 * so the typo is found here, with the engine's definitions in hand. Each
 * result is a `mapsto-arrow-expected` diagnostic on the arrow, with a fixit
 * that replaces `->` by `=>`, and the source range of the pair.
 *
 * A position expects a function when its parameter type is `function`, a
 * signature, or a union of those, in at least one arm of the callee's
 * signature (an overload set such as `Sort`'s has several arms). Positions
 * are counted only up to the first spread or named argument: after one of
 * those, the written position no longer names a parameter. A call that is a
 * pipe stage with no `_` receives the piped value in the first slot that
 * fits its type, which can be before the written arguments
 * (`xs |> filter(x -> x > 1)` fills the collection slot first), so for such
 * a call the next parameter is checked as well.
 */
function ruleAtFunctionSlotDiagnostics(
  ce: ComputeEngine,
  statement: MathJsonExpression,
  source: string
): RuleAtFunctionSlot[] {
  const result: RuleAtFunctionSlot[] = [];

  const visit = (node: MathJsonExpression, pipeStage: boolean): void => {
    const head = operator(node);
    const args = [...operands(node)];
    if (head === '') return;
    if (head === 'Pipe') {
      args.forEach((arg, i) => visit(arg, i > 0));
      return;
    }
    if (head !== 'KeyValuePair') {
      const piped = pipeStage && !args.some((arg) => symbol(arg) === '_');
      let arms: FunctionSignature[] | undefined;
      for (const [i, arg] of args.entries()) {
        const argHead = operator(arg);
        if (argHead === 'Spread' || argHead === 'NamedArgument') break;
        if (argHead !== 'KeyValuePair') continue;
        const [key, value] = operands(arg);
        if (key === undefined || value === undefined || symbol(key) === null)
          continue;
        arms ??= calleeSignatureArms(ce, head);
        const slot = (piped ? [i, i + 1] : [i]).find((slot) =>
          arms!.some((arm) => slotIsFunction(arm, slot))
        );
        if (slot === undefined) continue;
        // The message gives the position AS WRITTEN: in a pipe stage, the
        // slot of the piped value comes before the written arguments, so
        // `slot` can be one more than `i`.
        const site = ruleAtFunctionSlot(node, arg, i, key, value, source);
        if (site !== undefined) result.push(site);
      }
    }
    for (const arg of args) visit(arg, false);
  };
  visit(statement, false);
  return result;
}

/** A rule `key -> value` at a parameter that expects a function: the
 * `mapsto-arrow-expected` diagnostic, and the source ranges on which the
 * engine anchors the errors that the wrong arrow causes. These are the range
 * of the pair (where the callback-type error is anchored) and the range of
 * the key (where the error "a key must be a string" is anchored). The pair
 * has two ranges for its node: its own source offsets, and the range from
 * the start of the key to the end of the value. */
type RuleAtFunctionSlot = {
  diagnostic: ParsingDiagnostic;
  anchors: [number, number][];
  /** The name that is the key of the pair. */
  keyName: string;
};

/** The arms of the callable type of `name` — one for a plain signature,
 * several for an overload set — or none when `name` resolves to nothing
 * callable. */
function calleeSignatureArms(
  ce: ComputeEngine,
  name: string
): FunctionSignature[] {
  let def: ReturnType<ComputeEngine['lookupDefinition']>;
  try {
    def = ce.lookupDefinition(name);
  } catch {
    return [];
  }
  if (def === undefined) return [];
  const type =
    'operator' in def ? def.operator.signature.type : def.value.type.type;
  if (typeof type !== 'object') return [];
  if (type.kind === 'signature') return [type];
  if (type.kind === 'intersection')
    return type.types.filter(
      (t): t is FunctionSignature =>
        typeof t === 'object' && t.kind === 'signature'
    );
  return [];
}

/** Whether the parameter at 0-based position `index` of `sig` expects a
 * function value. */
function slotIsFunction(sig: FunctionSignature, index: number): boolean {
  const required = sig.args?.length ?? 0;
  const param =
    sig.args?.[index] ?? sig.optArgs?.[index - required] ?? sig.variadicArg;
  if (param === undefined) return false;
  const isFunctionType = (t: Type): boolean =>
    isWildcardFunctionType(t) ||
    (typeof t === 'object' &&
      (t.kind === 'signature' ||
        (t.kind === 'union' &&
          t.types.length > 0 &&
          t.types.every(isFunctionType))));
  return isFunctionType(param.type);
}

/** The `mapsto-arrow-expected` diagnostic for the rule `pair`, which is
 * `key -> value`, the argument of `call` at the 0-based position `index` as
 * written, with the anchors of the errors it causes (see
 * `RuleAtFunctionSlot`). The diagnostic underlines the arrow and carries a
 * fixit to `=>` when the arrow is found in the source between the key and
 * the value; otherwise it underlines the whole rule and has no fixit.
 * `undefined` when the rule has no source offsets. */
function ruleAtFunctionSlot(
  call: MathJsonExpression,
  pair: MathJsonExpression,
  index: number,
  key: MathJsonExpression,
  value: MathJsonExpression,
  source: string
): RuleAtFunctionSlot | undefined {
  const keyRange = sourceRangeOf(key);
  const valueRange = sourceRangeOf(value);
  if (keyRange === undefined || valueRange === undefined) return undefined;
  const range: [number, number] = [keyRange[0], valueRange[1]];
  const anchors: [number, number][] = [range, keyRange];
  const pairRange = sourceRangeOf(pair);
  if (pairRange !== undefined) anchors.push(pairRange);
  let arrow: [number, number] | undefined;
  const gap = source.slice(keyRange[1], valueRange[0]);
  for (const spelling of ['->', '→']) {
    const at = gap.indexOf(spelling);
    if (at >= 0) {
      arrow = [keyRange[1] + at, keyRange[1] + at + spelling.length];
      break;
    }
  }
  // The callee as written (`map`, not the library name `Map`): the source
  // text from the start of the call to its `(`, when that is a plain name.
  const callRange = sourceRangeOf(call);
  const open = callRange === undefined ? -1 : source.indexOf('(', callRange[0]);
  const written = open < 0 ? '' : source.slice(callRange![0], open);
  const callee = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(written)
    ? written
    : operator(call);
  const diagnostic: ParsingDiagnostic = {
    severity: 'error',
    message: ['mapsto-arrow-expected', callee, String(index + 1)],
    range: arrow ?? range,
  };
  if (arrow !== undefined) diagnostic.fixits = [[arrow[0], arrow[1], '=>']];
  return { diagnostic, anchors, keyName: symbol(key)! };
}

/**
 * Collect the `["Error", …]` nodes of a canonical expression, keeping only
 * the **innermost** one of a nest: an error carrying another error as an
 * operand is a cascade of the inner one, and reporting both would double up
 * on a single mistake.
 */
function collectErrors(
  expr: MathJsonExpression,
  result: MathJsonExpression[]
): void {
  if (operator(expr) === 'Error') {
    const nested: MathJsonExpression[] = [];
    for (const op of operands(expr)) collectErrors(op, nested);
    result.push(...(nested.length > 0 ? nested : [expr]));
    return;
  }
  // A `let`/`const` initializer ends up inside a MathJSON **dictionary
  // literal** (`let f = …` boxes to `["Declare", "f", { dict: { value: … } }]`),
  // which `operands()` does not traverse. Descend into the dictionary values,
  // or every canonicalization error inside an initializer stays invisible
  // (`let g = "a" + 1`, or a `KeyValuePair` with a non-string key — the
  // common `->`/`=>` typo shapes are recovered by the parser as lambdas
  // with a `mapsto-arrow-expected` diagnostic, and a rule at a call's
  // function parameter gets the same diagnostic from
  // `ruleAtFunctionSlotDiagnostics`, but a bare-symbol key in an unclaimed
  // position, e.g. `let f = [n -> n + 1]`, still lands here).
  if (isDictionaryObject(expr)) {
    for (const value of Object.values(expr.dict))
      collectErrors(value as MathJsonExpression, result);
    return;
  }
  for (const op of operands(expr)) collectErrors(op, result);
}

/**
 * Record each `Error` node of the boxed tree `root` in `into`, keyed by its
 * serialized JSON, so that a JSON error found by `collectErrors` can be
 * paired with its BOXED twin. The boxed error's site operand carries the
 * binding of the operand at fault, which the provenance note reads.
 *
 * The walk is depth-first and LEFT-TO-RIGHT, the same visit order as the
 * JSON walk of `collectErrors`: when two byte-identical errors exist, the
 * entry kept (the first one) pairs with the FIRST collected JSON error,
 * which is the one the dedup loop keeps. An entry already in `into` is not
 * replaced. Children are pushed reversed because the stack pops from the
 * end.
 */
function indexBoxedErrors(
  root: ReturnType<ComputeEngine['box']>,
  into: Map<string, ReturnType<ComputeEngine['box']>>
): void {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.operator === 'Error') {
      const key = JSON.stringify(node.json);
      if (!into.has(key)) into.set(key, node);
    }
    // `ops` (functions) and `values` (dictionaries — the `let` initializer
    // shape `collectErrors` descends) live on narrowed interfaces this
    // module cannot prove without engine runtime guards; read them
    // structurally. `values` exists on no other expression kind, so the
    // read cannot trigger a collection materialization.
    const values = (node as { values?: readonly (typeof node)[] }).values;
    if (Array.isArray(values))
      for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
    const ops = (node as { ops?: readonly (typeof node)[] }).ops;
    if (ops !== undefined)
      for (let i = ops.length - 1; i >= 0; i--) stack.push(ops[i]);
  }
}

/**
 * The canonicalization errors inside the held operands of the pipes of the
 * boxed statement `root`.
 *
 * `Pipe` is a lazy operator: its canonical form holds the piped value and
 * the stage unbound, and canonicalizes them only when it is evaluated. A
 * function-literal stage and a chained pipe are the exceptions, which the
 * canonical handler of `Pipe` canonicalizes itself. So the canonical form of
 * `xs |> Filter("a")` has no error in it, while the call `Filter(xs, "a")`
 * has one. This function canonicalizes each held operand as the evaluation
 * does (`_pipeStageAsCall`, which puts the piped value in the slot that
 * evaluation selects), in the lexical scope of the pipe, and collects the
 * errors of the result. It evaluates nothing.
 *
 * Each result has the JSON error, its boxed twin (see `indexBoxedErrors`),
 * and the frame of the error: the call that contains it and the 1-based
 * position of the argument at fault. When the stage gets the piped value as
 * an implicit argument, the frame gives the operator and the position AS
 * WRITTEN, which is what `locateError` finds in the raw statement: the
 * position in the call is one more than the written position for the
 * arguments after the piped value, and canonicalization can also rename the
 * call and reorder its operands (`writtenPositions`). An error in the slot
 * of the piped value itself has the frame of the first operand of the
 * `Pipe`. An error at a position that is not known has no frame.
 *
 * The walk goes only through canonical nodes: the held operands of other
 * lazy operators are not canonical, and the evaluation decides what they
 * mean. Each node is visited once, so a chain `a |> f(1) |> g(2)`, whose
 * inner pipe is both an operand of the outer pipe and the piped value of the
 * outer call, is not walked twice per level.
 */
function pipeStageErrors(
  ce: ComputeEngine,
  root: ReturnType<ComputeEngine['box']>
): {
  error: MathJsonExpression;
  frame: ErrorFrameRef | undefined;
  boxed: ReturnType<ComputeEngine['box']> | undefined;
}[] {
  type Boxed = ReturnType<ComputeEngine['box']>;
  type Scope = Parameters<ComputeEngine['_inScope']>[0];
  const result: ReturnType<typeof pipeStageErrors> = [];
  const visited = new Set<Boxed>();

  const report = (
    checked: Boxed,
    stage?: { topicAt: number; written: Boxed }
  ): void => {
    const json = checked.json;
    const errors: MathJsonExpression[] = [];
    collectErrors(json, errors);
    if (errors.length === 0) return;
    const twins = new Map<string, Boxed>();
    indexBoxedErrors(checked, twins);
    const head = operator(json);
    const args = [...operands(json)];
    const writtenAt =
      stage === undefined
        ? undefined
        : writtenPositions(checked, stage.written);
    for (const error of errors) {
      let frame = enclosingFrame(json, error);
      // Only an error that is an argument of the call itself is moved: the
      // piped value is an operand of that call and of no nested one. The
      // frame names the call as written (`Fold`, not the canonical
      // `Reduce`) and counts the argument as written, without the piped
      // value, because the locator looks for both in the raw statement.
      if (
        stage !== undefined &&
        frame !== undefined &&
        frame.name === head &&
        args[frame.index - 1] === error
      ) {
        const at = writtenAt?.[frame.index - 1];
        const { topicAt } = stage;
        if (at === undefined) frame = undefined;
        else if (at === topicAt) frame = { name: 'Pipe', index: 1 };
        else
          frame = {
            name: stage.written.operator,
            index: at < topicAt ? at + 1 : at,
          };
      }
      result.push({ error, frame, boxed: twins.get(JSON.stringify(error)) });
    }
  };

  const visit = (node: Boxed, scope: Scope): void => {
    if (visited.has(node) || !node.isCanonical) return;
    visited.add(node);
    // `ops` and `values` are read structurally, as in `indexBoxedErrors`.
    const ops = (node as { ops?: readonly Boxed[] }).ops;
    if (node.operator === 'Pipe' && ops !== undefined && ops.length === 2) {
      const [heldTopic, heldStage] = ops;
      ce._inScope(scope, () => {
        const topic = heldTopic.isCanonical ? heldTopic : heldTopic.canonical;
        const checked = ce._pipeStageAsCall(topic, heldStage);
        // A piped value that is not in the checked call has errors of its
        // own to report. A piped value that was already canonical is part of
        // the canonical tree, and its errors are collected with it.
        if (topic !== heldTopic && checked?.topicAt === undefined)
          report(topic);
        if (checked !== undefined)
          report(
            checked.call,
            checked.topicAt === undefined || checked.written === undefined
              ? undefined
              : { topicAt: checked.topicAt, written: checked.written }
          );
        visit(topic, scope);
        if (checked !== undefined) visit(checked.call, scope);
      });
      visit(heldStage, scope);
      return;
    }
    const inner = node.localScope ?? scope;
    const values = (node as { values?: readonly Boxed[] }).values;
    if (Array.isArray(values)) for (const value of values) visit(value, inner);
    if (ops !== undefined) for (const op of ops) visit(op, inner);
  };

  visit(root, undefined);
  return result;
}

/**
 * For each operand of the canonical call `call`, its 0-based position in
 * `written`, the same call before canonicalization. `undefined` for an
 * operand whose position is not known.
 *
 * Canonicalization can change the operator and the order of the operands
 * (`Fold(f, 0, xs)` becomes `Reduce(xs, f, 0)`). An operand that was already
 * canonical before (the piped value, a number, a string) is the same object
 * after, so its position is found by identity. An operand that
 * canonicalization replaced (an argument that became an `Error`) is not
 * found that way. When the call kept its operator and every operand found by
 * identity is at its own position, the order did not change, and each
 * operand has the position it has in `call`. Otherwise, when exactly one
 * operand of each call is not found by identity, these two are the same
 * operand. Any other operand that is not found has no known position.
 */
function writtenPositions(
  call: ReturnType<ComputeEngine['box']>,
  written: ReturnType<ComputeEngine['box']>
): (number | undefined)[] {
  type Boxed = ReturnType<ComputeEngine['box']>;
  // `ops` is read structurally, as in `indexBoxedErrors`.
  const ops = (call as { ops?: readonly Boxed[] }).ops ?? [];
  const writtenOps = (written as { ops?: readonly Boxed[] }).ops ?? [];
  const used = new Set<number>();
  const at = ops.map((op) => {
    const i = writtenOps.findIndex((w, k) => w === op && !used.has(k));
    if (i < 0) return undefined;
    used.add(i);
    return i;
  });
  if (
    call.operator === written.operator &&
    ops.length === writtenOps.length &&
    at.every((i, k) => i === undefined || i === k)
  )
    return ops.map((_, k) => k);
  const missing = at.filter((i) => i === undefined).length;
  const unused = writtenOps.length - used.size;
  if (missing === 1 && unused === 1) {
    const free = writtenOps.findIndex((_, k) => !used.has(k));
    return at.map((i) => i ?? free);
  }
  return at;
}

/**
 * The frame of a canonicalization error on the direct route (no pipe), with
 * the operator and the argument position of the call AS WRITTEN in the raw
 * statement `statement`, which is what `locateError` looks for.
 *
 * The frame is first read from the canonical tree (`enclosingFrame`).
 * Canonicalization can rename a call and reorder its operands:
 * `Fold(a => a, "0", xs)` becomes `Reduce(xs, Error(…), "0")`. The raw
 * statement then has no call named `Reduce`, and the locator fell back to
 * the range of the whole statement. In that case the canonical call is
 * mapped back to the written call here (`writtenCallPositions`), and the
 * frame names the written operator (`Fold`) and the written position of the
 * argument at fault (the callback, 1). A frame whose operator is in the raw
 * statement is returned unchanged. When the written call cannot be found
 * with certainty, the canonical frame is returned, and the anchor is the
 * whole statement, as before.
 *
 * The pipe route has its own map, from boxed operands (`writtenPositions`).
 */
function writtenFrame(
  canonical: MathJsonExpression,
  error: MathJsonExpression,
  statement: MathJsonExpression
): ErrorFrameRef | undefined {
  const frame = enclosingFrame(canonical, error);
  if (frame === undefined) return undefined;
  if (containsOperator(statement, frame.name)) return frame;
  const call = enclosingCall(canonical, error);
  if (call === undefined) return frame;
  const callOps = [...operands(call)];
  const callKeys = callOps.map(operandKey);
  let found: ErrorFrameRef | undefined;
  let count = 0;
  const visit = (node: MathJsonExpression): void => {
    const head = operator(node);
    if (head === '' || count > 1) return;
    const ops = [...operands(node)];
    // A call with a named argument was permuted into declaration order
    // before canonicalization, and its written order is read by the
    // locator from the declared slot names. It is not mapped here.
    if (
      head !== frame.name &&
      ops.length === callOps.length &&
      !ops.some((op) => operator(op) === 'NamedArgument')
    ) {
      const at = writtenCallPositions(callKeys, ops.map(operandKey));
      const position = at?.[frame.index - 1];
      if (position !== undefined) {
        count += 1;
        found = { name: head, index: position + 1 };
      }
    }
    for (const op of ops) visit(op);
  };
  visit(statement);
  return count === 1 ? found : frame;
}

/**
 * For each operand of a canonical call, its 0-based position among the
 * operands of a written call, or `undefined` when the two calls do not
 * correspond. The operands are compared by their key (`operandKey`). Each
 * canonical operand takes the first written operand with the same key that
 * no other operand took. Canonicalization changes some operands (an
 * argument that became an `Error`, a function literal that got a `Block`):
 * when exactly one canonical operand and one written operand are left, and
 * at least one other operand matched by its key, they are the same operand.
 * Otherwise the calls do not correspond with certainty.
 */
function writtenCallPositions(
  canonicalKeys: ReadonlyArray<string | undefined>,
  writtenKeys: ReadonlyArray<string | undefined>
): number[] | undefined {
  const used = new Set<number>();
  const at = canonicalKeys.map((key) => {
    if (key === undefined) return undefined;
    const i = writtenKeys.findIndex((w, k) => w === key && !used.has(k));
    if (i < 0) return undefined;
    used.add(i);
    return i;
  });
  const left = at.filter((i) => i === undefined).length;
  if (left === 0) return at as number[];
  // The pairing needs at least one operand matched by its key. Without one,
  // any written call with the same number of operands would pair: a unary
  // `Negate(Error(…))` that canonicalization made from `sqrt(y) - "a"` would
  // pair with `Sqrt(y)` and put the error on `y`.
  if (left !== 1 || used.size === 0 || writtenKeys.length - used.size !== 1)
    return undefined;
  const free = writtenKeys.findIndex((_, k) => !used.has(k));
  return at.map((i) => i ?? free);
}

/**
 * A text that is the same for a raw operand and for its canonical form when
 * canonicalization does not change it: a number, a string, a symbol, or a
 * call of these. The raw form carries source offsets and spells numbers and
 * strings as objects, so the JSON texts of the two forms are not compared.
 * `undefined` for an operand that cannot be compared (a dictionary).
 */
function operandKey(expr: MathJsonExpression): string | undefined {
  const n = machineValue(expr);
  if (n !== null) return `#${n}`;
  const str = stringValue(expr);
  if (str !== null) return `'${str}'`;
  const sym = symbol(expr);
  if (sym !== null) return `$${sym}`;
  const head = operator(expr);
  if (head === '') return undefined;
  const keys = [...operands(expr)].map(operandKey);
  if (keys.some((k) => k === undefined)) return undefined;
  return `${head}(${keys.join(',')})`;
}

/** Whether a call with the operator `name` is in `expr`. */
function containsOperator(expr: MathJsonExpression, name: string): boolean {
  if (operator(expr) === '') return false;
  if (operator(expr) === name) return true;
  return [...operands(expr)].some((op) => containsOperator(op, name));
}

/** The call whose operand is the node `error`, found by identity in `root`
 * (see `enclosingFrame`, which gives the operator and position only). */
function enclosingCall(
  root: MathJsonExpression,
  error: MathJsonExpression
): MathJsonExpression | undefined {
  if (operator(root) === '') return undefined;
  for (const op of operands(root)) {
    if (op === error) return root;
    const nested = enclosingCall(op, error);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** The error code of an `["Error", cause, where?]` node: the head of its
 * `ErrorCode` payload, or the cause itself when it is a bare message. */
export function errorCode(error: MathJsonExpression): string {
  const cause = operand(error, 1);
  if (cause === null) return 'error';
  if (operator(cause) === 'ErrorCode')
    return text(operand(cause, 1) ?? 'Nothing');
  return text(cause);
}

/**
 * A human-readable description of an `["Error", cause, where?]` node: its
 * error code, the code's payload, and — separately — the offending
 * subexpression.
 *
 * The payload and `where` are kept apart because `ce.typeError()` mints the
 * three-operand shape `["Error", ["ErrorCode", "incompatible-type", expected,
 * actual], where]`: folding `where` in with the payload used to push the
 * argument count past two and degrade the readable "(expected X, got Y)" form.
 *
 * Also the shared translation for RUNTIME error values (`executeEpsil`'s
 * `runtime-error` diagnostics and the CLI's rendering of an error-valued
 * program result), so the same problem reads the same at both tiers. The
 * output doubles as the dedup / authored-error subtraction key in
 * `staticDiagnostics()` — both sides go through this function, so the
 * phrasing is free to change but must stay deterministic.
 */
export function describeError(error: MathJsonExpression): string {
  const cause = operand(error, 1);
  // The second operand is the error's site — unless it is the `ErrorTrace`
  // breadcrumb (identified by head, never by position; it is rendered
  // separately by `errorFrameChain`).
  const second = operand(error, 2);
  // The second operand of a cancellation value (`["Error", "Timeout
  // exceeded", "timeout"]`, built by `executeEpsil` and the CLI session) is
  // the machine-readable cause, not a site: the message already says what
  // happened, and rendering the cause as a site read "Timeout exceeded at
  // `timeout`".
  // Only the two-string shape is a cancellation value; an `ErrorCode` error
  // whose site happens to be the text "timeout" keeps its site.
  const where =
    operator(second) === 'ErrorTrace' ||
    (stringValue(cause) !== null && isCancellationCauseOperand(second))
      ? null
      : second;

  let code = 'error';
  const payload: string[] = [];
  if (cause !== null) {
    if (operator(cause) === 'ErrorCode') {
      const parts = [...operands(cause)].map(text);
      code = parts[0] ?? code;
      payload.push(...parts.slice(1));
    } else code = text(cause);
  }

  // `where` is the error's site: the offending subexpression, or (some
  // minters) a full explanatory sentence, each phrased differently. The
  // engine never puts an argument INDEX in this slot: `ce.typeError()` and
  // `ce.error()` receive the offending operand itself (or its text), so a
  // site that is an integer is the offending VALUE. Reading a bare integer
  // as an argument position printed "got `5` for argument 5" for
  // `take(5, 2)`. An integer site is therefore quoted like any other
  // subexpression.
  const siteText = where === null ? '' : text(where);
  const site =
    siteText === ''
      ? ''
      : siteText.length <= 40
        ? `at \`${siteText}\``
        : `— ${siteText}`;

  let detail: string;
  switch (code) {
    case 'expected-function':
      // Payload: [name, type]. With a site, the site quote names the symbol,
      // so the detail carries only the TYPE -- "expected a function, got
      // `real` at `Pi`". WITHOUT a site -- `dedupKey()` deliberately
      // strips it, and authored errors may omit it -- the payload's name is
      // the only identity, so keep it: two different heads with the same
      // declared type must not collapse to one dedup key.
      detail =
        payload.length >= 2
          ? site === ''
            ? `\`${payload[0]}\`: expected a function, got \`${payload[1]}\``
            : `expected a function, got \`${payload[1]}\``
          : `expected a function (${payload.join(', ')})`;
      break;
    case 'incompatible-type':
      detail =
        payload.length === 2
          ? `expected \`${payload[0]}\`, got \`${payload[1]}\``
          : `incompatible type: ${payload.join(', ')}`;
      break;
    case 'missing':
      detail =
        payload.length === 0
          ? 'a required argument is missing'
          : `a required argument is missing (${payload.join(', ')})`;
      break;
    case 'unexpected-argument':
      // No site: some minters put the argument's VALUE in the `where` slot,
      // where a numeric one would masquerade as an argument index — and the
      // report's caret already points at the argument.
      return payload.length === 0
        ? 'unexpected argument'
        : `unexpected argument \`${payload.join(', ')}\``;
    case 'callback-arity':
      // No site: the payload is a complete sentence that already quotes the
      // callback, and the report's caret points at the call.
      return payload.length === 0
        ? 'the callback takes the wrong number of parameters'
        : payload.join(' ');
    case 'pipe-stage-arity':
      // As `callback-arity`: a complete sentence quoting the stage, with the
      // caret on it.
      return payload.length === 0
        ? 'the pipe stage takes the wrong number of parameters'
        : payload.join(' ');
    case 'no-division-by-point':
      // No site: the caret is on the division. There is no alternative
      // operator to name — a point has no reciprocal.
      return 'a point cannot be a divisor';
    case 'no-product-between-points': {
      // No site: the caret is already on the product. The payload is a
      // machine-readable marker saying whether `Cross` applies, followed by
      // the remedy clause it corresponds to; only the clause is shown. See
      // `pointProductError` (`arithmetic-mul-div.ts`) for which alternatives
      // are named and why.
      const remedy = payload.slice(1).join(' ');
      return remedy === ''
        ? 'no product is defined between points'
        : `no product is defined between points; ${remedy}`;
    }
    case 'invalid-symbol':
      detail =
        payload.length === 0
          ? 'invalid symbol'
          : `invalid symbol \`${payload.join(', ')}\``;
      break;
    case 'protocol-function-not-a-field': {
      // Payload: [member, comma-separated owning protocols]. The site is the
      // receiver's TYPE name, so the sentence reads "… not a field, at `Box`".
      // The fix is the whole point of the message, so it is spelled out.
      //
      // With SEVERAL owners the fix changes: a bare `span(b)` is then
      // `protocol-call-ambiguous` in its own right, so the message must ask
      // for a qualified name rather than recommend a call that fails. And a
      // third payload slot of `assign` marks a STORE target (`b.span = 5`),
      // where no call is being recommended at all — the member simply cannot
      // be written.
      const owners = (payload[1] ?? '')
        .split(', ')
        .filter((p) => p !== '')
        .map((p) => `\`${p}\``);
      const kinds = owners.length === 1 ? 'protocol' : 'protocols';
      const advice =
        payload[2] === 'assign'
          ? ' and cannot be assigned'
          : owners.length === 1
            ? `: call it as \`${payload[0]}(x)\` or \`x.${payload[0]}()\``
            : '; more than one applies here, so call it with a qualified name';
      detail =
        payload.length >= 2 && owners.length > 0
          ? `\`${payload[0]}\` is a function member of the ${owners.join(' and ')} ${kinds}, not a field${advice}`
          : `a protocol function member is not a field (${payload.join(', ')})`;
      break;
    }
    case 'read-before-declaration':
      // Payload: [name] or [name, "assignment"]. A local of a block was read
      // in a run of the block before its `let` or `const` statement ran in
      // that run. With "assignment", the local is a name that a block of a
      // function body assigns with no declaration (an assignment local), and
      // it was read before its first assignment ran.
      detail =
        payload.length === 0
          ? 'a local is used before its declaration has run'
          : payload[1] === 'assignment'
            ? `\`${payload[0]}\` is read before its first assignment: the assignment makes \`${payload[0]}\` a local of the block, which has no value yet`
            : `\`${payload[0]}\` is used before its \`let\` or \`const\` has run in this block`;
      break;
    case 'dot-call-not-a-protocol-function': {
      // Payload: [name, receiver type]. The dot reaches protocol members
      // only, so the message names the two spellings that call an ordinary
      // function on the value.
      const [name, type] = payload;
      detail =
        name === undefined
          ? 'only a protocol function can be called with a dot'
          : `\`${name}\` is not a protocol function${type === undefined ? '' : ` on a value of type \`${type}\``}: write \`${name}(x)\` or \`x |> ${name}\``;
      break;
    }
    case 'constant-assignment':
      // Payload: [name]. The words of the message of the error that the
      // engine throws (`ConstantAssignmentError`).
      detail =
        payload.length === 0
          ? 'cannot assign a value to a constant'
          : `cannot assign a value to the constant \`${payload[0]}\``;
      break;
    default: {
      // A kebab-case code reads as words; a free-form message (a thrown
      // `Error`'s text captured as the cause) passes through verbatim.
      const readable = /^[a-z][a-z0-9-]*$/.test(code)
        ? code.replaceAll('-', ' ')
        : code;
      detail =
        payload.length === 0 ? readable : `${readable}: ${payload.join(', ')}`;
    }
  }

  return site === '' ? detail : `${detail} ${site}`;
}

/** Whether `expr` is the cause operand of a cancellation error value: one
 * of the `CancellationCause` spellings (`common/interruptible.ts`). */
function isCancellationCauseOperand(expr: MathJsonExpression | null): boolean {
  const cause = expr === null ? null : stringValue(expr);
  return (
    cause === 'timeout' ||
    cause === 'step-budget' ||
    cause === 'iteration-limit-exceeded' ||
    cause === 'recursion-depth-exceeded'
  );
}

/** The text of a MathJSON string operand, or its Epsil form. */
function text(expr: MathJsonExpression): string {
  // The site of a LaTeX parse error is the LaTeX fragment the parser stopped
  // at: quote the LaTeX itself, not its Epsil spelling `LatexString("…")`.
  if (operator(expr) === 'LatexString') {
    const latex = stringValue(operand(expr, 1));
    if (latex !== null) return latex;
  }
  return stringValue(expr) ?? epsilSnippet(expr);
}

/** A statement (or subexpression) in Epsil source form, condensed to a
 * single line so it can be quoted in a diagnostic message. */
function epsilSnippet(expr: MathJsonExpression): string {
  let snippet: string;
  try {
    snippet = serializeEpsil(expr).replaceAll(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
  return snippet.length > SNIPPET_LENGTH
    ? `${snippet.slice(0, SNIPPET_LENGTH - 1)}…`
    : snippet;
}

/** The source range of a statement, falling back to the whole program when
 * the node carries no offsets (mirrors `executeEpsil()`). */
function statementRange(
  statement: MathJsonExpression,
  source: string
): [number, number] {
  return (
    (typeof statement === 'object' &&
    statement !== null &&
    !Array.isArray(statement)
      ? (statement as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined) ?? [0, source.length]
  );
}
