import { clauseRedefinitionMessage } from '../compute-engine/declaration-origin.js';
import type { MathJsonExpression } from '../math-json/types.js';
import { CancellationError, checkDeadline } from '../common/interruptible.js';
import {
  isDictionaryObject,
  machineValue,
  nops,
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
import { narrowGuardedReads } from './presence-narrowing.js';
import { parallelLoopDiagnostics } from './parallel-checks.js';
import type {
  EffectSet,
  FunctionSignature,
  Type,
} from '../common/type/types.js';
import {
  isGroupedTypeText,
  isWildcardFunctionType,
  signatureEffects,
  resolveTypeAlias,
  stripMissingFromType,
  typeContainsMissing,
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
  declarationRefusalSite,
  programSourceOrder,
  programInterruption,
} from '../compute-engine/library/control-structures.js';
import { diagnosticFlow } from './diagnostic-flow.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';

import type { ParsingDiagnostic } from './diagnostics.js';
import {
  documentBindings,
  occurrenceAt,
  protocolFunctionMembers,
  type BindingGroup,
} from './occurrences.js';
import { binderSitesOf } from './resolve-library-names.js';
import { DefinitionRestorePoint } from '../compute-engine/boxed-expression/definition-restore-point.js';
import { provisionalRegistryRollbackPoint } from '../compute-engine/boxed-expression/provisional-application.js';
import { kindRegistryRollbackPoint } from '../compute-engine/boxed-expression/value-kinds.js';
import { serializeEpsil } from './serialize-epsil.js';
import { definitionSites } from './definition-sites.js';
import {
  enclosingFrame,
  locateError,
  offendingValue,
  type ErrorFrameRef,
} from './error-location.js';
import {
  calleeSlotNames,
  errorIndexCountsWrittenArguments,
} from '../compute-engine/boxed-expression/named-arguments.js';
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
  // A second clause of a function, with the parameter domain of an earlier
  // clause of the same block, is refused by `canonicalBlock` in the same way
  // (`blockClauseRedefinition()`). At the top level the canonical handler of
  // `DefineFunction` mints no error node: `clauseRedefinitionDiagnostic`
  // reports it there.
  'function-redefinition',
  // The rules of block locals (`docs/ERROR-MODEL.md`): a declaration has a
  // value (`declaration-without-value`, minted by the `Declare` canonical
  // handler), a declaration is a statement of a block and not in a branch
  // or a loop body (`declaration-below-statement`, minted by the `Declare`
  // canonical handler), an assignment writes a declared name
  // (`assignment-to-undeclared-variable`, minted by the `Assign` canonical
  // handler), a local is not used before the statement that declares it
  // (`read-before-declaration`, minted by `canonicalBlock`), an
  // assignment is a statement and not an operand (`assignment-in-operand`,
  // minted when the enclosing expression is built), and an assignment to a
  // local gives a value of the local's type (`assignment-type-mismatch`,
  // minted by the `Assign` canonical handler). All are settled before
  // anything runs.
  'declaration-without-value',
  'declaration-below-statement',
  'assignment-to-undeclared-variable',
  'read-before-declaration',
  'assignment-in-operand',
  'assignment-type-mismatch',
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
  // A read of a field that the record type of the operand does not list
  // (`r.b` with `r: record{a: integer}`). Record types are closed, so the
  // `Field` canonical handler (`library/collections.ts`) refuses it once the
  // type of the operand is known, before anything runs. The same code from
  // an evaluation (an object, a tagged nominal value) never reaches this
  // pass, which evaluates nothing.
  'unknown-field',
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

/** The `[start, end)` source offsets that the engine recorded on the boxed
 * expression `expr`, if any. */
function sourceOffsetsOfBoxed(
  expr: ReturnType<ComputeEngine['box']> | undefined
): [number, number] | undefined {
  const offsets = (expr as { sourceOffsets?: unknown } | undefined)
    ?.sourceOffsets;
  return Array.isArray(offsets) &&
    offsets.length === 2 &&
    typeof offsets[0] === 'number' &&
    typeof offsets[1] === 'number'
    ? [offsets[0], offsets[1]]
    : undefined;
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
  // The registry of definitions to re-derive when a name gains a definition
  // (`provisional-application.ts`) is engine-wide: it is put back too, and
  // so is the registry of value kinds.
  const rollbackRegistry = provisionalRegistryRollbackPoint(ce);
  const rollbackKinds = kindRegistryRollbackPoint(ce);
  const freshlyInferred =
    ce._freshlyInferred === null ? null : new Set(ce._freshlyInferred);
  const typeVersion = ce._typeVersion;
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
  // A statement can redefine or narrow a definition that outlives the check
  // (a definition of an enclosing scope, a parameter of a host function):
  // each writer records the definition before its first write, and the
  // check puts it back when it ends. A narrowing is reported to no sink.
  const outerDefinitions = new DefinitionRestorePoint(
    ce,
    ce.context.lexicalScope
  );
  outerDefinitions.open();
  const narrowingSink = ce._narrowingSink;
  ce._narrowingSink = undefined;

  ce._factSuppressionDepth += 1;
  let bodyFailed = false;
  try {
    // Nothing that the check writes outlives it: what it declares is in
    // the scope it pushed, which it pops; what it writes on a definition of
    // an enclosing scope, and in the registries of the engine, is put back
    // below. Definitions stay visible ACROSS the pass's own statements (a
    // `function` defined by statement 1 checks statement 2's call). Its
    // outputs are decision-shaped (`ParsingDiagnostic`: strings and ranges).
    //
    // The check has one program
    // environment, as a run has (rule 10 of
    // `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): each statement
    // is boxed in it, so a later statement reads what an earlier one
    // required. It is discarded when the check ends. Its boxing-pass window
    // spans the per-statement `ce.box()` windows; when the check runs
    // inside another window, the fresh inferences of that window are put
    // back as they were.
    return ce._withProgramEnvironment(() =>
      ce._withBoxingPassWindow(() =>
        canonicalizationDiagnostics(ce, ast, source, into, options?.effects)
      )
    );
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    outerDefinitions.close();
    // Each step runs even when an earlier one throws; the first error is
    // thrown after them, unless the body threw.
    let failure: { error: unknown } | undefined;
    const run = (step: () => void): void => {
      try {
        step();
      } catch (error) {
        failure ??= { error };
      }
    };
    ce._narrowingSink = narrowingSink;
    run(() => ce.popScope());
    ce._factSuppressionDepth -= 1;
    ce._staticTypeCheckDepth -= 1;
    if (ce._inferenceTxDepth > 0) ce._freshlyInferred = freshlyInferred;
    run(rollbackTypes);
    run(rollbackProtocols);
    run(rollbackRegistry);
    run(rollbackKinds);
    const restored = outerDefinitions.recorded;
    run(() => outerDefinitions.restore());
    // A definition put back can have a wider type than the one written
    // during the check: the event of a widening makes a type cached since
    // then be computed again. When the check only declared, its
    // declarations are gone: the type version moves, as for a declaration.
    // A check that wrote nothing sends nothing.
    if (restored)
      run(() =>
        ce._noteStateEvent({
          kind: 'inference',
          valueType: true,
          widening: true,
        })
      );
    else if (ce._typeVersion !== typeVersion)
      run(() =>
        ce._noteStateEvent({
          kind: 'declare',
          callable: false,
          shadowsCallable: false,
        })
      );
    if (failure !== undefined && !bodyFailed) throw failure.error;
  }
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
  const rawStatements =
    operator(ast) === 'Program' ? [...operands(ast)] : [ast];
  const narrowed = rawStatements.map(narrowGuardedReads);
  let program: ReturnType<ComputeEngine['box']>;
  let preparationFailure: unknown;
  let order: readonly number[];
  const savedFrame = ce._deadlineFrame;
  try {
    program = ce.box(['Program', ...narrowed]);
    order = programSourceOrder(program);
  } catch (error) {
    const prefix = programInterruption(error);
    if (prefix === undefined) throw error;
    preparationFailure = error;
    ce._deadlineFrame = undefined;
    program = ce._fn('Program', prefix.statements);
    order = prefix.order;
  }
  try {
    const statements = order.map((i) => rawStatements[i]);
    const boxedStatements = isFunction(program) ? program.ops : [];
    const flow = diagnosticFlow(ce, program);

    // Where this program binds each of its names, for the "defined here" note a
    // signature error carries (see `signatureNotes()`).
    const defSites = definitionSites(ast);

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
      constantWrites = constantWritesOf(ce, ast, source, rawStatements);
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

    // The annotations in force for the `match` exhaustiveness lint, threaded
    // through the whole program so a top-level `let t: light = …` types `t`
    // for the statements that follow (see `match-exhaustiveness.ts`).
    const annotations: AnnotationScope = new Map();

    // The protocol function members of the program: a call of a member that
    // shadows a library binder (`solve`) binds no variable, the same rule
    // `resolveLibraryNames()` applies, so the two passes read one program the
    // same way.
    const members = protocolFunctionMembers(ast);
    const bindings = documentBindings(ast, source, {
      binderSites: (node, isBound, declarationOf) =>
        binderSitesOf(ce, node, source, members, isBound, declarationOf),
    });
    diagnostics.push(...absenceMarkerBindingDiagnostics(bindings));
    diagnostics.push(...equationBodyDiagnostics(ast, source, bindings));
    diagnostics.push(...qualifiedNameDiagnostics(ce, ast));

    let statementIndex = -1;
    for (const statement of statements) {
      statementIndex += 1;
      const redefinition = redefinitionDiagnostic(
        statement,
        source,
        declaredInThisUnit
      );
      if (redefinition !== undefined) diagnostics.push(redefinition);
      const constantClause = constantClauseDiagnostic(
        statement,
        source,
        constants
      );
      if (constantClause !== undefined) diagnostics.push(constantClause);
      if (constantWrites !== undefined)
        diagnostics.push(
          ...(constantWrites.pending.get(order[statementIndex]) ?? [])
        );

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

      // The shared sequence has already established every binding and type.
      checkDeadline(ce._deadlineFrame);
      narrowedStatement = narrowed[order[statementIndex]] !== statement;
      const boxed = boxedStatements[statementIndex];
      if (boxed === undefined) continue;
      let canonical: MathJsonExpression;
      try {
        canonical = boxed.json;
      } catch (error) {
        if (error instanceof CancellationError) throw error;
        // Statement-value traversal has its reporting backstop on execution.
        // A failing serializer cannot prevent the remaining raw checks.
        continue;
      }

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
      if (clauseRedefinition !== undefined)
        diagnostics.push(clauseRedefinition);

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

      // The rules of the parallel loops and comprehensions of the statement
      // (`parallel-checks.ts`). Read after the statement is boxed, so the
      // effects of a function that this statement or an earlier one defines
      // are known. The boxed statement gives the static types of rule 2.
      diagnostics.push(...parallelLoopDiagnostics(ce, statement, boxed));

      // A declaration whose initializer PROVABLY cannot satisfy the annotation
      // is a static problem too, even though `Declare` only enforces it at
      // evaluation time (see `declaredTypeMismatch`). A provable mismatch
      // prevents this declaration from contributing constant-write facts. A possibly
      // absent or possibly `NaN` initializer (`let r: real = zs[i]`) is
      // reported too, but the run time installs the binding in the usual case,
      // so the steps below still model it: a later write to that `const`, or
      // a later use of the name, is checked as for any other binding.
      const declMismatch = declaredTypeMismatch(ce, boxed);
      const provableDeclMismatch = declMismatch?.provable === true;

      // A `const` declaration that the run time installs makes a later
      // `function` statement for the same name, and a later assignment to it,
      // a runtime error. A `const` that re-declares a name of this program is
      // refused at run time (`variable-redeclaration`), so the binding of the
      // name stays the earlier one, which is not a constant when it is a
      // `let`.
      if (!provableDeclMismatch && isFunction(boxed, 'Declare')) {
        const name = constantDeclarationName(boxed);
        if (name !== undefined)
          constants.set(name, statementRange(statement, source));
        // Each name of a destructuring `const` (`const (a, b) = t`) is a
        // constant too.
        if (isConstantDeclaration(statement)) {
          const range = statementRange(statement, source);
          constantWrites ??= constantWritesOf(ce, ast, source, rawStatements);
          // All statements are prepared already. Report their source sites
          // now, including bodies hoisted ahead of this declaration.
          for (const group of declaredGroups(constantWrites.byName, statement))
            diagnostics.push(
              ...registerConstant(
                constantWrites,
                group,
                range,
                rawStatements.length
              )
            );
        }
      }

      const errors: MathJsonExpression[] = [];
      collectErrors(canonical, errors);
      // Pair each collected JSON error with its BOXED twin, keyed by serialized
      // identity: the boxed error's site operand carries the faulted operand's
      // own binding, which the provenance note reads scope-accurately
      // (`signatureNotes`' `boxedError` option). The boxed walk mirrors
      // `collectErrors`' traversal (operands AND dictionary values), so the
      // JSON walk stays authoritative and the map is a lookup aside. Two
      // byte-identical errors in one statement collide on the key — they also
      // dedup to one diagnostic below, so the first twin is sufficient. The one
      // exception is an assignment to an undeclared name, reported at each
      // assignment: the map keeps every twin in walk order, and the n-th JSON
      // error of a key is the n-th boxed one.
      const boxedErrorsByJson = new Map<
        string,
        ReturnType<ComputeEngine['box']>[]
      >();
      indexBoxedErrors(boxed, boxedErrorsByJson);
      const firstTwin = (error: MathJsonExpression) =>
        boxedErrorsByJson.get(JSON.stringify(error))?.[0];
      const occurrences = new Map<string, number>();

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
        if (site.boxed === undefined) continue;
        const twins = boxedErrorsByJson.get(key);
        if (twins !== undefined) twins.push(site.boxed);
        else boxedErrorsByJson.set(key, [site.boxed]);
      }
      for (const site of flow.get(boxed) ?? []) {
        const json = site.error.json;
        errors.push(json);
        pipeStageFrames.set(json, site.frame);
        boxedErrorsByJson.set(JSON.stringify(json), [site.error]);
      }
      if (errors.length === 0 && declMismatch === undefined) continue;

      const [start, end] = statementRange(statement, source);
      const snippet = epsilSnippet(statement);
      if (declMismatch !== undefined)
        diagnostics.push({
          severity: 'error',
          message: [
            'static-type-error',
            declMismatch.message,
            snippet,
            'incompatible-type',
          ],
          code: 'incompatible-type',
          range: [start, end, start],
        });
      // One diagnostic per distinct problem: every error in a statement shares
      // the statement's range, so identical descriptions would be N copies of
      // the same line.
      const seen = new Set<string>();
      for (const error of errors) {
        const twins = boxedErrorsByJson.get(JSON.stringify(error));
        if (
          twins !== undefined &&
          twins.length > 0 &&
          twins.every((node) => flow.suppresses(node))
        )
          continue;
        const code = errorCode(error);
        if (!isCanonicalizationError(code)) continue;
        // An assignment to an undeclared name is reported at each assignment,
        // as at the top level, where each assignment is a statement: in
        // `for k in 1..3 { t = 1; t = 1 }` the second `t = 1` gives the same
        // error as the first. The source range of its own boxed twin names the
        // assignment, and the dedup below keys on it. A read of a local before
        // its declaration is reported at each statement that reads it, at the
        // name that is read: the `ErrorCode` operand of its twin has the range
        // of that name, or of the call when the local is called
        // (`useBeforeDeclarationCheck()`), and the range of a call `h(1)` is
        // narrowed to the name `h` that starts it.
        const isAssignment = code === 'assignment-to-undeclared-variable';
        const perSite = isAssignment || code === 'read-before-declaration';
        let siteRange: [number, number] | undefined;
        if (perSite) {
          const jsonKey = JSON.stringify(error);
          const n = occurrences.get(jsonKey) ?? 0;
          occurrences.set(jsonKey, n + 1);
          const twin = boxedErrorsByJson.get(jsonKey)?.[n];
          siteRange = sourceOffsetsOfBoxed(
            isAssignment || !isFunction(twin) ? twin : twin.op1
          );
          const name = stringValue(operand(operand(error, 1), 2));
          if (
            !isAssignment &&
            siteRange !== undefined &&
            name &&
            source.startsWith(name, siteRange[0])
          )
            siteRange = [siteRange[0], siteRange[0] + name.length];
        }
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
        // reported as a rule. The errors reported at each site are deduped
        // after the locator, on their range.
        if (!perSite && seen.has(key)) continue;

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
          frameOrderOf(code),
          undefined,
          // When two calls match the frame (`Ln("a") + Ln(2)`), the value that
          // the error names tells which one made it.
          offendingValue(error)
        );
        // When the locator falls back to the whole statement (two calls match
        // the frame: two equal errors in one function body), the source range
        // that the engine recorded on the error names the site.
        const recorded =
          located.range[0] === start && located.range[1] === end
            ? sourceOffsetsOfBoxed(firstTwin(error))
            : undefined;
        const [from, to] = siteRange ?? recorded ?? located.range;
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
        if (perSite) {
          const siteKey = `${key}@${from}:${to}`;
          if (seen.has(siteKey)) continue;
          seen.add(siteKey);
        } else seen.add(key);

        const diagnostic: ParsingDiagnostic = {
          severity: 'error',
          // Quote the CALL that failed rather than the whole statement: with
          // the anchor narrowed onto one argument, quoting a 40-line definition
          // describes the wrong thing — and a host that shows only the message
          // (an editor hover) would have nothing else to go on.
          message: [
            'static-type-error',
            description,
            located.call === undefined
              ? snippet
              : epsilSnippet(
                  elementRebindingWithValue(statement, located.call) ??
                    located.call
                ),
            code,
          ],
          code,
          range: [from, to, from],
        };
        const notes = signatureNotes(ce, error, {
          calleeType: flow.calleeType(firstTwin(error)),
          definitionSites: defSites,
          primaryRange: [from, to],
          enclosingFrame: frame,
          call: located.call,
          boxedError: firstTwin(error),
        });
        const firstDeclaration =
          code === 'variable-redeclaration'
            ? declarationRefusalSite(firstTwin(error))
            : undefined;
        if (firstDeclaration !== undefined)
          notes.push({
            message: 'first declared here',
            range: [...firstDeclaration],
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
          const boxedErr = firstTwin(error);
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
              def === undefined ? undefined : flow.evidenceAt(boxed, def);
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
    narrowedStatement = false;

    effects?.sort((a, b) => a.range[0] - b.range[0]);
    if (preparationFailure !== undefined) throw preparationFailure;
    return diagnostics;
  } finally {
    ce._deadlineFrame = savedFrame;
  }
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
]);

/** `Module`, the operator of every qualified name (`std::pi` is
 * `["Module", "Pi"]`), cannot be rebound either: see `MODULE_OPERATOR` in
 * `library/core.ts`, whose declaration handlers refuse it at run time. */
const MODULE_OPERATOR = 'Module';

/**
 * A binding of an absence marker — `let Missing = 3`, `Nothing = 1`, a
 * parameter, loop variable, match pattern or function named `Missing` —
 * is an error (user decision 2026-09-27): the engine recognizes each marker
 * by its name, so a user binding of it could never behave like the value it
 * holds. One diagnostic per binding site, over the whole program, found with
 * the scope walker the language server uses for rename
 * (`documentBindings`), fed the engine's binding sites so a variable a
 * library call binds (`sum(Missing, Missing in xs)`) is found too. The
 * declaration, assignment and definition statements are also refused at run
 * time, by their handlers.
 *
 * A binding of `Module` is reported the same way, with the code
 * `module-binding`: a user binding of the operator of every qualified name
 * would change what every `std::name` reads.
 */
function absenceMarkerBindingDiagnostics(
  groups: readonly BindingGroup[]
): ParsingDiagnostic[] {
  const found: ParsingDiagnostic[] = [];
  for (const group of groups) {
    const code = ABSENCE_MARKER_NAMES.has(group.name)
      ? 'absence-marker-binding'
      : group.name === MODULE_OPERATOR
        ? 'module-binding'
        : undefined;
    if (group.kind === 'free' || code === undefined) continue;
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
        message: [code, group.name],
        range: [occurrence.start, occurrence.end, occurrence.start],
      });
  }
  return found;
}

/**
 * A `not-a-library-name` error for each qualified name `std::x` of the
 * program whose name the library of `ce` does not define (the system scope,
 * where the standard library and the libraries of the constructor's
 * `libraries` option are installed). The resolution pass has already
 * rewritten an Epsil spelling to its library name (`std::pi` is
 * `["Module", "Pi"]`), so the name is read as it is. The engine gives the
 * same statement an error value when it runs; this reports it before.
 */
function qualifiedNameDiagnostics(
  ce: ComputeEngine,
  ast: MathJsonExpression
): ParsingDiagnostic[] {
  const system = ce.contextStack[0]?.lexicalScope.bindings;
  const found: ParsingDiagnostic[] = [];
  const visit = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (operator(node) === 'Module' && nops(node) === 1) {
      const nameNode = operand(node, 1);
      const name = symbol(nameNode);
      const range = sourceRangeOf(nameNode) ?? sourceRangeOf(node);
      if (name !== null && range !== undefined && !system?.has(name))
        found.push({
          severity: 'error',
          message: ['not-a-library-name', name],
          range: [range[0], range[1], range[0]],
        });
      return;
    }
    const head = operator(node);
    if (typeof head === 'object') visit(head as MathJsonExpression);
    for (const op of operands(node)) visit(op);
    if ('dict' in node)
      for (const value of Object.values(node.dict as Record<string, unknown>))
        visit(value as MathJsonExpression);
  };
  visit(ast);
  return found;
}

/**
 * Where the value of an expression goes, as far as the walk of
 * `equationBodyDiagnostics()` can tell:
 *
 * - `'discarded'`: nothing reads it. It is a statement that is not the last of
 *   its block, or the last one of a block whose own value is discarded, or a
 *   statement of a loop body (a loop has no value).
 * - `'used'`: something can read it. The last statement of the program is
 *   here, because its value is the result that the host receives.
 * - a number: a call of a named function returns it. The number is the source
 *   offset of a name that binds the function, and the uses of that name tell
 *   where the value goes.
 */
type ValueUse = 'discarded' | 'used' | number;

/**
 * The equation that is the whole body in `body`, if it is one: `a = 2`, or the
 * one-element set that `{ a = 2 }` is in expression position, the form that a
 * reader of JavaScript or Rust writes for a block body. The parser wraps the
 * body of a function that states a result type or an effect in `Typed`.
 */
function equationOfBody(body: MathJsonExpression): MathJsonExpression | null {
  if (operator(body) === 'Typed') return equationOfBody(operand(body, 1)!);
  if (operator(body) === 'Set' && nops(body) === 1)
    return equationOfBody(operand(body, 1)!);
  return operator(body) === 'Equal' && nops(body) === 2 ? body : null;
}

/**
 * A `match` case, a branch of a conditional expression or a function whose
 * whole body is `name = value`, where `name` is a variable that the program
 * declares and nothing reads the value of the body. In expression position `=`
 * is an equation, so the program compares and discards the result, and the
 * variable keeps its value: this is almost always a forgotten `do { … }`
 * (`match 1 { 1 => a = 2 }`). It is a warning, because the program is valid. It
 * has no fixit: a fixit of a warning must be safe to apply, and the two repairs
 * (`do { a = 2 }` and `a == 2`) each give the program a new meaning.
 *
 * Three kinds of body are not reported, and each one is a valid program:
 *
 * - a body whose value something can read (`let r = match k { 1 => a = 2 }`, a
 *   lambda passed to `map` or to `solve`);
 * - an equation written with `==`, which is how a program says that it means
 *   the comparison;
 * - an equation of a name that this program does not declare as a variable: a
 *   free name is an unknown of the equation, a parameter or a pattern variable
 *   of the body itself is what a predicate compares (`x => x = 2`), and a
 *   constant cannot be assigned, so a comparison is all that the body can mean.
 *
 * The value of a function body goes where the calls of the function send it.
 * The body is reported only when the function is bound to a name that has at
 * least one read, and each read is a call in a discarded position: a function
 * with no read in this program can still be read by the host or by a later
 * program unit. Any other read counts as a use, also a recursive call in the
 * last position of the function, so a body can stay unreported, but a body that
 * something reads is never reported.
 */
function equationBodyDiagnostics(
  ast: MathJsonExpression,
  source: string,
  bindings: readonly BindingGroup[]
): ParsingDiagnostic[] {
  const bodies: {
    body: MathJsonExpression;
    equation: MathJsonExpression;
    use: ValueUse;
  }[] = [];
  // The source offset of each call whose value nothing reads. The read of a
  // called name is recorded at the same offset (`documentBindings()`).
  const discardedCalls = new Set<number>();

  const visitBody = (body: MathJsonExpression | null, use: ValueUse): void => {
    if (body === null) return;
    const equation = use === 'used' ? null : equationOfBody(body);
    if (equation !== null) bodies.push({ body, equation, use });
    visit(body, use);
  };

  const visitFunction = (fn: MathJsonExpression, use: ValueUse): void => {
    const [body, ...parameters] = operands(fn);
    visitBody(body ?? null, use);
    for (const parameter of parameters) visit(parameter, 'used');
  };

  /** The value that a declaration or an assignment binds to `target`. */
  const visitBoundValue = (
    target: MathJsonExpression | null,
    value: MathJsonExpression | null
  ): void => {
    if (value === null) return;
    const offset =
      target !== null && symbol(target) !== null
        ? sourceRangeOf(target)?.[0]
        : undefined;
    if (offset !== undefined && operator(value) === 'Function')
      visitFunction(value, offset);
    else visit(value, 'used');
  };

  const visit = (node: MathJsonExpression, use: ValueUse): void => {
    const op = operator(node);
    if (op === '') return;
    switch (op) {
      case 'Program':
      case 'Block': {
        const statements = operands(node);
        statements.forEach((statement, i) =>
          visit(statement, i < statements.length - 1 ? 'discarded' : use)
        );
        return;
      }
      case 'Loop':
      case 'ParallelLoop': {
        const [body, ...iterators] = operands(node);
        if (body !== undefined) visit(body, 'discarded');
        for (const iterator of iterators) visit(iterator, 'used');
        return;
      }
      case 'If': {
        const [condition, ...branches] = operands(node);
        if (condition !== undefined) visit(condition, 'used');
        for (const branch of branches) visitBody(branch, use);
        return;
      }
      case 'Match': {
        const [subject, ...cases] = operands(node);
        if (subject !== undefined) visit(subject, 'used');
        for (const matchCase of cases) {
          if (operator(matchCase) !== 'MatchCase') continue;
          // A case is (pattern, body) or (pattern, guard, body).
          const parts = operands(matchCase);
          if (parts.length === 3) visit(parts[1], 'used');
          visitBody(parts[parts.length - 1] ?? null, use);
        }
        return;
      }
      case 'Typed':
        visit(operand(node, 1)!, use);
        return;
      case 'Function':
        visitFunction(node, 'used');
        return;
      case 'Declare':
        visitBoundValue(operand(node, 1), declaredValue(node));
        return;
      case 'Assign':
      case 'DefineFunction':
        visitBoundValue(operand(node, 1), operand(node, 2));
        return;
      default: {
        // A statement `f(1)`. The source of a call starts with the name of its
        // operator, and the source of `f + 1` (operator `Add`) does not, so a
        // read of `f` in that statement does not count as a discarded call.
        const start = sourceRangeOf(node)?.[0];
        if (use === 'discarded' && start !== undefined)
          if (source.startsWith(op, start)) discardedCalls.add(start);
        for (const child of operands(node)) visit(child, 'used');
      }
    }
  };

  visit(ast, 'used');
  if (bodies.length === 0) return [];

  // The source offset of each name that a `const` declares.
  const constants = new Set(
    constantDeclarations(ast)
      .flatMap((declaration) => declarationLeaves(operand(declaration, 1)))
      .map((leaf) => leaf.start)
  );

  const found: ParsingDiagnostic[] = [];
  for (const { body, equation, use } of bodies) {
    const target = operand(equation, 1)!;
    const targetRange = sourceRangeOf(target);
    const bodyRange = sourceRangeOf(body);
    const equationRange = sourceRangeOf(equation);
    const name = symbol(target);
    if (
      name === null ||
      targetRange === undefined ||
      bodyRange === undefined ||
      equationRange === undefined
    )
      continue;
    // The parser gives `=` and `==` the same node, so only the source tells
    // them apart.
    if (!/^\s*=(?!=)/.test(source.slice(targetRange[1]))) continue;
    const variable = occurrenceAt(bindings, targetRange[0])?.group;
    if (variable?.kind !== 'variable' || variable.name !== name) continue;
    if (
      variable.occurrences.some(
        (occurrence) =>
          occurrence.role === 'definition' && constants.has(occurrence.start)
      )
    )
      continue;
    if (typeof use === 'number') {
      const reads = occurrenceAt(bindings, use)?.group.occurrences.filter(
        (occurrence) => occurrence.role === 'read'
      );
      if (
        reads === undefined ||
        reads.length === 0 ||
        !reads.every((read) => discardedCalls.has(read.start))
      )
        continue;
    }
    found.push({
      severity: 'warning',
      message: [
        'equation-not-assignment',
        source.slice(equationRange[0], equationRange[1]),
      ],
      range: [bodyRange[0], bodyRange[1], bodyRange[0]],
    });
  }
  return found;
}

/**
 * The names a `Declare` statement declares, read from the raw AST: the symbol
 * target, or each leaf of a destructuring tuple pattern (`let (p, q) = t`).
 * `_` discards a component and `Nothing` is a value, not a name; neither
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
    message: [
      'function-redefinition',
      name,
      clauseRedefinitionMessage(name, first.range),
    ],
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
    code: 'invalid-clause-definition',
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
  // Same rule as in `canonicalizationDiagnostics()`: a protocol member
  // that shadows a library binder binds nothing.
  const members = protocolFunctionMembers(ast);
  for (const group of documentBindings(ast, source, {
    binderSites: (node, isBound, declarationOf) =>
      binderSitesOf(ce, node, source, members, isBound, declarationOf),
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
 * Program and Block bindings are both established before function bodies
 * canonicalize. Such assignments therefore write the constant and are
 * reported too (`writesFromFunctionBodies()`).
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
  // Program and Block constants are both in scope while function bodies
  // canonicalize; the raw occurrence groups retain the source sites.
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
      code: 'constant-assignment',
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
 * `named` holds the binding groups with the name of the constant.
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
 * not a checkable declaration or no mismatch is found. `provable` is `true`
 * when every run of the statement fails, so the run time never installs the
 * binding. It is `false` for a possibly absent or possibly `NaN` initializer
 * (`let r: real = zs[i]`): the run time refuses only the absent case, and in
 * the usual case it installs the binding.
 */
function declaredTypeMismatch(
  ce: ComputeEngine,
  boxed: ReturnType<ComputeEngine['box']>
): { message: string; provable: boolean } | undefined {
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

  // `Missing` is a result only, and a store into a declared name accepts it
  // where the declared type accepts a present value (`matchesOrAbsent`, the
  // run-time check of the same store): `let y: string = xs[5]` is `Missing`
  // and is accepted, and `let y: list<string> = ["a", Missing]` is
  // accepted. So the `missing` arms of the value's type, at the top and in
  // every element, are removed before the comparison, and a value typed
  // `missing` alone is not reported. A value that is wrong where it is
  // present (`let y: list<string> = [5, Missing]`) is still reported.
  // (`docs/ERROR-MODEL.md`, "`Missing` is a result only".)
  const valueType = typeContainsMissing(value.type.type)
    ? ce.type(stripMissingFromType(value.type.type))
    : value.type;
  if (valueType.type === 'never') return undefined;

  // A closed literal IS its runtime value, so the full `matches()` check
  // applies to it. A list, tuple or set literal of closed literals is closed
  // too, the absence symbols included: `let xs: list<string> = [5,
  // Missing]` is reported here as the run time refuses it (user decision
  // P1b, 2026-10-21: a declared element contract is checked on assignment).
  const isClosedLiteral = isClosedLiteralValue(value);
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
    ? !valueType.matches(declared)
    : declared.isDisjointFrom(valueType);
  if (!mismatch) {
    // A value that may be `NaN` (`zs[i]` on a `list<real>` is `nan |
    // real`): only `number` (and a union that names `nan`) admits `NaN`;
    // `real`, `integer` and `complex` hold finite values only, and the run
    // time refuses `NaN` there. So a `nan` arm is reported at a declaration
    // that does not admit `nan`, when every OTHER arm fits the declaration:
    // the possible `NaN` is then the only reason the value can fail. A value
    // with another arm outside the declaration (`a / b` with `a, b: real` is
    // `infinity | nan | real`) overlaps the declaration and is not reported,
    // as an overlap is not reported elsewhere in this check. A possible
    // `Missing` is not reported: its arm was removed above.
    if (
      !isSubtype('nan', declared.type) &&
      hasTopLevelArm(valueType.type, 'nan') &&
      otherArmsFit(valueType.type, 'nan', declared.type)
    ) {
      const snippet = epsilSnippet(value.json);
      // `?!` is a postfix operator: `a / b?!` would assert `b` alone, so a
      // snippet with an infix operator is wrapped in parentheses.
      const operand = /\s/.test(snippet) ? `(${snippet})` : snippet;
      const message =
        `The value \`${snippet}\` of type "${value.type}" may be \`NaN\`, ` +
        `and the declared type "${declared}" excludes \`NaN\`. Write ` +
        `\`${operand}?!\` to assert that it is not \`NaN\`, ` +
        `\`${operand} ?? fallback\` to replace \`NaN\`, ` +
        `or declare \`${declared} | nan\``;
      return { message, provable: false };
    }
    return undefined;
  }

  const lead = `The value "${value.toString()}" of type "${value.type}" is not compatible with the declared type "${declared}"`;
  const hint = unboundSignatureHint(value, declared);
  return {
    message: hint === undefined ? lead : `${lead}. ${hint}`,
    provable: true,
  };
}

/** Whether `t` is `arm` (`missing` or `nan`) or a union with that arm: the
 * value as a WHOLE may be absent. An absent cell inside a collection
 * (`list<missing | string>`) is not this: the value is a list, and the
 * declared element contract judges the cell. */
function hasTopLevelArm(t: Type, arm: 'missing' | 'nan'): boolean {
  const r = resolveTypeAlias(t);
  if (r === arm) return true;
  if (typeof r === 'string' || r.kind !== 'union') return false;
  return r.types.some((x) => resolveTypeAlias(x) === arm);
}

/** Whether every arm of `t` other than `arm` is a subtype of `declared`. A
 * `t` that is `arm` alone has no other arm, and the answer is `true`. */
function otherArmsFit(
  t: Type,
  arm: 'missing' | 'nan',
  declared: Type
): boolean {
  const r = resolveTypeAlias(t);
  if (typeof r === 'string' || r.kind !== 'union') return true;
  return r.types
    .filter((x) => resolveTypeAlias(x) !== arm)
    .every((x) => isSubtype(x, declared));
}

/** Whether `value` is a literal whose static type is exactly its runtime
 * type: a number, a string, a boolean, an absence or omission symbol, or a
 * list, tuple, set or dictionary literal of such values. The type of a
 * dictionary literal is the record type of exactly its keys, and record
 * types are closed. */
function isClosedLiteralValue(
  value: ReturnType<ComputeEngine['box']>
): boolean {
  if (
    isNumber(value) ||
    isString(value) ||
    isSymbol(value, 'True') ||
    isSymbol(value, 'False') ||
    isSymbol(value, 'Missing') ||
    isSymbol(value, 'Nothing')
  )
    return true;
  if (
    isFunction(value, 'List') ||
    isFunction(value, 'Tuple') ||
    isFunction(value, 'Set')
  )
    return value.ops.every((op) => isClosedLiteralValue(op));
  if (isDictionary(value))
    return value.values.every((op) => isClosedLiteralValue(op));
  return false;
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
 * JSON walk of `collectErrors`: the twins of one key are listed in visit
 * order, so the n-th byte-identical JSON error pairs with the n-th entry, and
 * the first entry with the first collected JSON error, which is the one the
 * dedup loop keeps. Children are pushed reversed because the stack pops from
 * the end.
 */
function indexBoxedErrors(
  root: ReturnType<ComputeEngine['box']>,
  into: Map<string, ReturnType<ComputeEngine['box']>[]>
): void {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.operator === 'Error') {
      const key = JSON.stringify(node.json);
      const twins = into.get(key);
      if (twins !== undefined) twins.push(node);
      else into.set(key, [node]);
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
    const twins = new Map<string, Boxed[]>();
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
      result.push({
        error,
        frame,
        boxed: twins.get(JSON.stringify(error))?.[0],
      });
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
          : payload.length === 0
            ? 'incompatible type'
            : `incompatible type: ${payload.join(', ')}`;
      break;
    case 'unevaluated-tuple': {
      // Payload: [operator] when the value is an application, else none. The
      // site is the value that has a tuple type but did not evaluate to a
      // tuple, so a destructuring cannot take it apart. The sentence names a
      // short value itself; a long one stays a trailing site. Only an
      // application gets the `N` hint: `N` does not give a value to a symbol.
      const short = siteText !== '' && siteText.length <= 40;
      const subject = short ? `\`${siteText}\`` : 'the value';
      const tail = short || site === '' ? '' : ` ${site}`;
      const hint =
        payload.length > 0
          ? `; if \`${payload[0]}\` needs numeric input, write \`N(…)\``
          : '';
      return `${subject} did not evaluate to a tuple, so it cannot be destructured${hint}${tail}`;
    }
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
      // Payload: [name]. A statement of a block uses a local of the block
      // before the statement that declares it: a `let` or a `const`.
      detail =
        payload.length === 0
          ? 'a local is used before its declaration'
          : `\`${payload[0]}\` is used before the statement that declares it in this block`;
      break;
    case 'declaration-without-value':
      // Payload: [name] or [name, "function"]. A `let` or `Declare` with
      // no value. With "function", the declared type is a function type
      // and no `function` statement of the same name is in the same block.
      detail =
        payload.length === 0
          ? 'a declaration must give a value'
          : payload[1] === 'function'
            ? `\`${payload[0]}\` is declared without a value: define \`${payload[0]}\` with a function statement in the same block, or give the declaration a value`
            : `\`${payload[0]}\` is declared without a value: write \`let ${payload[0]} = …\``;
      break;
    case 'declaration-below-statement':
      // Payload: [name]. A `let` or a `const` in a branch of a conditional
      // or in a loop body that is not a block.
      detail =
        payload.length === 0
          ? 'a declaration is a statement of a block'
          : `\`${payload[0]}\` is declared in a branch or a loop body: declare \`${payload[0]}\` in a statement of the block`;
      break;
    case 'assignment-to-undeclared-variable':
      // Payload: [name]. An assignment to a name that no scope declares.
      detail =
        payload.length === 0
          ? 'a variable is assigned before it is declared'
          : `\`${payload[0]}\` is not declared: write \`let ${payload[0]} = …\``;
      break;
    case 'assignment-in-operand':
      // Payload: [name] or []. An assignment or a declaration is an operand
      // of an expression.
      detail =
        payload.length === 0
          ? 'an assignment is a statement, not a value'
          : `the assignment of \`${payload[0]}\` is a statement, not a value: assign \`${payload[0]}\` in a statement of its own before the expression`;
      break;
    case 'assignment-type-mismatch':
      // Payload: [name, local type, value type].
      detail =
        payload.length < 3
          ? 'the value does not have the type of the local'
          : `\`${payload[0]}\` has the type \`${payload[1]}\`, and the value has the type \`${payload[2]}\``;
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
    case 'unknown-field': {
      // Payload: [name, the fields of the value or its type, joined with
      // `, `]. The site is the value read.
      const [name, fields] = payload;
      const list =
        fields === undefined || fields === ''
          ? ''
          : `; the fields are ${fields
              .split(', ')
              .map((f) => `\`${f}\``)
              .join(', ')}`;
      detail =
        name === undefined
          ? 'unknown field'
          : `\`${name}\` is not a field${list}`;
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

/**
 * Whether the statement the check is boxing was rewritten by
 * `narrowGuardedReads` (`presence-narrowing.ts`). That rewrite wraps a read
 * of a symbol that an `isMissing` test proves present in `AssertPresent(v)`,
 * for the check only: the author did not write `v?!`, so a message that
 * quotes the engine's `where` operand (or a value of the boxed statement)
 * must not show the wrapper. While the flag is set, `epsilSnippet` prints
 * `AssertPresent(<symbol>)` as the bare symbol. The flag is per statement:
 * `canonicalizationDiagnostics` sets it while reporting each canonical statement,
 * builds that statement's messages inside the same loop iteration, and clears
 * it when the loop ends (or before it rethrows a time-budget cancellation).
 */
let narrowedStatement = false;

/** A statement (or subexpression) in Epsil source form, condensed to a
 * single line so it can be quoted in a diagnostic message. */
function epsilSnippet(expr: MathJsonExpression): string {
  // The check's own `AssertPresent` wrapper around a symbol is not the
  // author's text (see `narrowedStatement`).
  if (
    narrowedStatement &&
    operator(expr) === 'AssertPresent' &&
    symbol(operand(expr, 1)) !== null
  )
    return epsilSnippet(operand(expr, 1)!);
  let snippet: string;
  try {
    snippet = serializeEpsil(elementAssignmentsAsWritten(expr))
      .replaceAll(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
  return snippet.length > SNIPPET_LENGTH
    ? `${snippet.slice(0, SNIPPET_LENGTH - 1)}…`
    : snippet;
}

/**
 * True when `expr` is an assignment to a list element: `Assign(xs,
 * ReplaceAt(xs, i, v))`, which the parser reads from `xs[i] = v`.
 */
function isElementRebinding(expr: MathJsonExpression): boolean {
  if (operator(expr) !== 'Assign' || nops(expr) !== 2) return false;
  const target = symbol(operand(expr, 1));
  const value = operand(expr, 2);
  return (
    target !== null &&
    operator(value) === 'ReplaceAt' &&
    nops(value) >= 3 &&
    symbol(operand(value, 1)) === target
  );
}

/**
 * `expr` with each assignment to a list element in the form that the program
 * wrote: a snippet of `Assign(xs, ReplaceAt(xs, i, v))` is `xs[i] := v`, not
 * `xs := replaceAt(xs, i, v)`. A nested target `m[j][i]` is written
 * `m[j, i]`, the same element. Gives `expr` itself when it holds no such
 * assignment.
 */
function elementAssignmentsAsWritten(
  expr: MathJsonExpression
): MathJsonExpression {
  const head = operator(expr);
  if (head === '') return expr;
  const ops = operands(expr);
  const rewritten = ops.map(elementAssignmentsAsWritten);
  const node = [head, ...rewritten] as MathJsonExpression;
  if (isElementRebinding(node)) {
    const parts = operands(operand(node, 2));
    return [
      'Assign',
      ['At', parts[0], ...parts.slice(1, -1)],
      parts[parts.length - 1],
    ];
  }
  if (rewritten.every((op, i) => op === ops[i])) return expr;
  return node;
}

/**
 * The assignment to a list element in `statement` whose value is the node
 * `call` (`isElementRebinding()`), or `undefined`. An error located in the
 * `ReplaceAt` of `xs[1] = 3` is quoted as the assignment `xs[1] := 3`: the
 * program does not write the `ReplaceAt`.
 */
function elementRebindingWithValue(
  statement: MathJsonExpression,
  call: MathJsonExpression
): MathJsonExpression | undefined {
  if (isElementRebinding(statement) && operand(statement, 2) === call)
    return statement;
  for (const op of operands(statement)) {
    const found = elementRebindingWithValue(op, call);
    if (found !== undefined) return found;
  }
  return undefined;
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
