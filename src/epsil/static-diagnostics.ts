import type { MathJsonExpression } from '../math-json/types.js';
import {
  checkDeadline,
  isTimeoutCancellation,
} from '../common/interruptible.js';
import {
  isDictionaryObject,
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import type {
  FunctionSignature,
  Type,
  TypeString,
} from '../common/type/types.js';
import { isWildcardFunctionType } from '../common/type/utils.js';
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
import { serializeEpsil } from './serialize-epsil.js';
import { definitionSites } from './definition-sites.js';
import { enclosingFrame, locateError } from './error-location.js';
import {
  calleeSlotNames,
  errorIndexCountsWrittenArguments,
} from '../compute-engine/boxed-expression/named-arguments.js';
import { isValueDef } from '../compute-engine/boxed-expression/utils.js';
// `clause-identity.ts` is an engine-free leaf too (its only runtime dependency
// is `common/type/subtype.js`), so the redefinition discipline's two tiers can
// share ONE definition of clause identity without this module importing the
// engine — the same arrangement as `unboundSignatureHint` above.
import {
  canonInstallSkipped,
  clauseSignatureOf,
  sameParameterDomain,
} from '../compute-engine/clause-identity.js';
import { signatureNotes } from './signature-notes.js';

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
 * evaluates (a pre-declared `x` makes `let x = 2047` narrow to
 * `finite_integer` instead of declaring `integer`). The pass additionally
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
export function staticDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression,
  source: string,
  into: ParsingDiagnostic[] = []
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
  ce.pushScope(undefined, 'epsil:static-check');
  // Assignment EVIDENCE for this pass (see `applyAssignmentTypeEffect`):
  // maps a symbol's value-definition record to the RAW type of the last
  // top-level assignment's right-hand side, so the evidence-beats-requirement
  // guard in argument validation treats the symbol as ASSIGNED during the
  // pass. Restored (not cleared) so a nested pass leaves the outer one's
  // evidence intact, mirroring `_epsilBatchId`.
  const enclosingEvidence = ce._staticAssignmentEvidence;
  ce._staticAssignmentEvidence = new Map();
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
        canonicalizationDiagnostics(ce, ast, source, into)
      )
    );
  } finally {
    ce._staticAssignmentEvidence = enclosingEvidence;
    ce.popScope();
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
              // literal type (`1.5`, not `finite_real`): exact evidence a
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
        if (leafType === 'unknown' || !isSymbol(leaf)) return;
        const leafSym = ce.box(leaf.symbol);
        const leafDef = leafSym.valueDefinition;
        if (leafDef === undefined) return;
        leafSym._infer(widenAssignedType(ce, leafType), 'replace');
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
    sym._infer(inferTypeFromValue(ce, rhs).type, 'replace');
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
  diagnostics: ParsingDiagnostic[]
): ParsingDiagnostic[] {
  // The parser wraps a multi-statement program in `Block` (see
  // `executeEpsil()`); a single statement is not wrapped.
  const statements = operator(ast) === 'Block' ? [...operands(ast)] : [ast];

  // Where this program binds each of its names, for the "defined here" note a
  // signature error carries (see `signatureNotes()`).
  const defSites = definitionSites(ast);

  // The signatures this program's own statements pin (`f := ⟨annotated
  // literal⟩`, `let f : ⟨arrow type⟩`), registered onto the definitions as
  // the walk reaches them — see `registerPinnedSignature`. FIRST-wins per
  // name, and kept here as well as on the definition because boxing a LATER
  // `Assign` to the same name runs the recursion-knot retype (library/
  // core.ts), which resets the target to the wildcard `function` type — the
  // pass re-asserts the pinned signature from this map afterwards.
  const pinned = new Map<string, Type>();

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

  // The names `applyAssignmentTypeEffect` itself declared into the pass
  // scope (so their definitions die with it) — the only definitions the
  // effect may REFINE in place (placeholder-skeleton refinement); an outer
  // definition is never mutated outside the journaled `_infer` channel.
  const effectDeclared = new Set<string>();

  for (const statement of statements) {
    const redefinition = redefinitionDiagnostic(
      statement,
      source,
      declaredInThisUnit
    );
    if (redefinition !== undefined) diagnostics.push(redefinition);

    // Provenance: the `Error` nodes the statement already carries *before*
    // canonicalization are source-authored values, not static problems.
    const authored = authoredErrors(statement);

    let canonical: MathJsonExpression;
    let boxed: ReturnType<ComputeEngine['box']> | undefined;
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
    }

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
    {
      // Depth-first, LEFT-TO-RIGHT — the same visit order as
      // `collectErrors`' JSON walk, so when two byte-identical errors exist
      // the first-wins entry pairs with the FIRST collected JSON error (the
      // one the dedup loop keeps) rather than a same-looking twin with a
      // different binding. Children are pushed reversed because the stack
      // pops from the end.
      const stack = [boxed];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.operator === 'Error') {
          const key = JSON.stringify(node.json);
          if (!boxedErrorByJson.has(key)) boxedErrorByJson.set(key, node);
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
      if (seen.has(key)) continue;
      seen.add(key);

      // Where the error sits in the canonical tree names the call it belongs
      // to — the stand-in for the `ErrorTrace` breadcrumb a runtime error
      // carries (canonicalization records none). It does double duty: it
      // narrows the ANCHOR from the whole statement onto the offending
      // argument, so a mistake inside a 40-line function definition does not
      // underline the definition; and it names the callee whose signature the
      // notes explain.
      const frame = enclosingFrame(canonical, error);
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
 * named calls in particular — against it. Two spellings pin one:
 *
 * - `f := (x: number, y: string) => …` — assignment of a function literal
 *   whose own (annotated) type is a signature carrying parameter names;
 * - `let/const f : (x: number, y: string) -> number [= …]` — a declaration
 *   whose type annotation is such a signature (with or without an
 *   initializer: the annotation alone pins it).
 *
 * Both are evaluation-time effects this pass otherwise cannot see ("prior
 * declarations are mostly not modeled" above), so before this carve-out a
 * named call to such a callee drew one false `argument-names-unavailable`
 * static diagnostic per argument for a program that runs fine. (`function
 * f(…) {…}` definitions never had the problem: `DefineFunction` installs its
 * clause at canonicalization.)
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
 * - Registration is FIRST-wins per name (the `pinned` map), mirroring the
 *   runtime: reassigning a pinned binding to an incompatible signature is a
 *   runtime error that leaves the original binding in force, and even a
 *   compatible reassignment leaves the binding's declared TYPE — where the
 *   parameter names live — unchanged. First-wins also keeps `_infer()`'s
 *   `narrow(old, new)` off the incompatible-signatures path, whose meet is
 *   `never`. The map is needed on top of the definition's own state because
 *   boxing a later `Assign` to the same name runs the recursion-knot retype
 *   (library/core.ts), resetting the target to the wildcard `function` type
 *   mid-pass — after such a statement the pinned signature is re-asserted
 *   from the map.
 * - Beyond first-wins, registration only fills a BLANK: an inferred `unknown`
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
  pinned: Map<string, Type>
): void {
  let name: string | null = null;
  let type: Type | undefined = undefined;
  if (isFunction(boxed, 'Assign')) {
    const target = boxed.ops[0];
    name = isSymbol(target) ? target.symbol : null;
    // ANY assignment to an already-pinned name may just have run the
    // recursion-knot retype and blanked the definition — re-assert the
    // first-registered signature (see the doc comment) whatever this
    // statement's right-hand side is.
    const already = name === null ? undefined : pinned.get(name);
    if (already !== undefined) {
      ce.box(name!)._infer(already, 'narrow');
      return;
    }
    const rhs = boxed.ops[1];
    if (rhs !== undefined && rhs.operator === 'Function') type = rhs.type.type;
  } else if (isFunction(boxed, 'Declare')) {
    // `["Declare", sym, "'type'", {dict}?]` — the annotation is positional
    // and optional (same shape `declaredTypeMismatch` reads).
    const typeOp = boxed.ops[1];
    if (isString(typeOp)) {
      const target = boxed.ops[0];
      name = isSymbol(target) ? target.symbol : null;
      try {
        type = ce.type(typeOp.string).type;
      } catch {
        // A malformed annotation is already a `type-annotation-error`.
        return;
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
  if (ce.box(name)._infer(type, 'narrow')) pinned.set(name, type);
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
  // with a `mapsto-arrow-expected` diagnostic, but a bare-symbol key in an
  // unclaimed position, e.g. `let f = [n -> n + 1]`, still lands here).
  if (isDictionaryObject(expr)) {
    for (const value of Object.values(expr.dict))
      collectErrors(value as MathJsonExpression, result);
    return;
  }
  for (const op of operands(expr)) collectErrors(op, result);
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
  const where = operator(second) === 'ErrorTrace' ? null : second;

  let code = 'error';
  const payload: string[] = [];
  if (cause !== null) {
    if (operator(cause) === 'ErrorCode') {
      const parts = [...operands(cause)].map(text);
      code = parts[0] ?? code;
      payload.push(...parts.slice(1));
    } else code = text(cause);
  }

  // `where` is the error's site — a bare argument index when the engine
  // validated a signature positionally, the offending subexpression, or
  // (some minters) a full explanatory sentence, each phrased differently.
  const siteText = where === null ? '' : text(where);
  const site =
    siteText === ''
      ? ''
      : /^\d+$/.test(siteText)
        ? `for argument ${siteText}`
        : siteText.length <= 40
          ? `at \`${siteText}\``
          : `— ${siteText}`;

  let detail: string;
  switch (code) {
    case 'expected-function':
      // Payload: [name, type]. With a site, the site quote names the symbol,
      // so the detail carries only the TYPE -- "expected a function, got
      // `finite_real` at `Pi`". WITHOUT a site -- `dedupKey()` deliberately
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
            ? `: call it as \`${payload[0]}(x)\``
            : '; more than one applies here, so call it with a qualified name';
      detail =
        payload.length >= 2 && owners.length > 0
          ? `\`${payload[0]}\` is a function member of the ${owners.join(' and ')} ${kinds}, not a field${advice}`
          : `a protocol function member is not a field (${payload.join(', ')})`;
      break;
    }
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

/** The text of a MathJSON string operand, or its Epsil form. */
function text(expr: MathJsonExpression): string {
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
