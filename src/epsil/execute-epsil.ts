import type { MathJsonExpression } from '../math-json/types.js';
import {
  operator,
  operands,
  operand,
  stringValue,
  symbol,
  machineValue,
} from '../math-json/utils.js';
import { isLiteralParamName } from '../math-json/symbols.js';
import {
  budgetCauseOf,
  CancellationError,
  checkDeadline,
  isTimeoutCancellation,
  type CancellationCause,
} from '../common/interruptible.js';

// Type-only imports: `src/epsil` never statically imports the engine, so this
// adds no runtime dependency (and no `compute-engine` cycle — the engine never
// imports `epsil`). The engine is injected at call time, mirroring the
// `parseLatex`/`ILatexSyntax` injection pattern used elsewhere in `src/epsil`.
import type { Expression, ComputeEngine } from '../compute-engine.js';
import type { Type } from '../common/type/types.js';

import {
  DiagnosticNote,
  FatalParsingError,
  ParsingDiagnostic,
} from './diagnostics.js';
import {
  isDictionary,
  isFunction,
  isString,
  isSymbol,
} from '../compute-engine/boxed-expression/type-guards.js';
import { readBeforeDeclarationSite } from '../compute-engine/boxed-expression/read-before-declaration.js';
import {
  closedLiteralType,
  isHoistedFunctionDefinition,
  laterDeclarationReached,
  markLaterDeclarations,
  statementDeclaredNames,
  staticDeclarations,
} from '../compute-engine/library/control-structures.js';
import { parseEpsil } from './parse-epsil.js';
import { resolveLibraryNames } from './resolve-library-names.js';
import { epsilNameOf } from './library-names.js';
import { definitionSites } from './definition-sites.js';
import {
  narrowToFrames,
  offendingValue,
  traceFrames,
  type CanonicalOrder,
} from './error-location.js';
import { signatureNotes } from './signature-notes.js';
import {
  calleeSlotNamesResolver,
  constantAssignmentError,
  describeError,
  errorCode,
  frameOrderOf,
  isDeclarationStatement,
  staticDiagnostics,
  declaredVariableNames,
} from './static-diagnostics.js';

export interface ExecuteEpsilOptions {
  /** Source URL (for `#url`/`#filename` pragmas and diagnostic origins). */
  url?: string;
  /** Injected LaTeX parser for `$…$` islands (a structural mirror of the
   * engine's `ILatexSyntax` injection). */
  parseLatex?: (latex: string) => MathJsonExpression;
  /** Opt into the host-state pragmas `#env`/`#navigator` (default `false`). */
  allowHostPragmas?: boolean;
}

export interface ExecuteEpsilAsyncOptions extends ExecuteEpsilOptions {
  /** An abort of this signal stops the program: the promise of
   * `executeEpsilAsync` rejects with a `CancellationError` whose `cause` is
   * the signal's reason, as every asynchronous evaluation of the engine
   * does. The signal is given to the `evaluateAsync()` of each statement
   * and read again between two statements. */
  signal?: AbortSignal;
}

export interface ExecuteEpsilResult {
  /** The value of the last executed statement (or `Nothing`). Runtime problems
   * surface here as `["Error", …]` values, never as thrown exceptions. */
  value: Expression;
  /** Parse-time (and a few execution-time) problems: unparseable syntax, gated
   * host pragmas, a `#error` directive — plus a `static-type-error` diagnostic
   * for each type error the engine detects when the program is canonicalized
   * (reported *before* evaluation), and a `runtime-error` diagnostic for
   * each *non-final* statement that evaluated to an error value (its value is
   * discarded, so the problem would otherwise be invisible). */
  diagnostics: ParsingDiagnostic[];
  /** The source range of the statement that produced `value` (the last
   * executed statement) — narrowed, when the value is an error, to the
   * innermost breadcrumb frame that maps onto the source (the `s` inside
   * `Characters(s)`, not the whole statement). The final statement's
   * problems stay in `value` — deliberately NOT mirrored as a diagnostic,
   * since a program may legitimately *author* an `Error` value — so a host
   * that wants to point at the failing site anchors on this range instead. */
  valueRange?: [start: number, end: number];
  /** Explanations for the final statement's error value — the callee's
   * signature and where it was defined, when the value is an error raised by
   * a call that did not match its signature (see `signatureNotes()`).
   *
   * Present for the same reason as `valueRange`: the final statement gets no
   * diagnostic, so a host that renders its error has nowhere else to read the
   * notes a `runtime-error` diagnostic would have carried. Absent when there
   * are none. */
  valueNotes?: DiagnosticNote[];
}

/**
 * Parse and execute an Epsil program against a compute engine.
 *
 * Flow (plan §1): parse → report canonicalization-time type errors (nothing
 * runs; see `staticDiagnostics()`) → evaluate each top-level statement
 * **sequentially in `ce`'s current scope** (so a notebook cell-chain's
 * declarations persist — no scope is pushed around the whole program; engine
 * `Block`/`Function` still scope themselves). The returned `value` is the last
 * statement's evaluated value.
 *
 * Two invariants (`docs/principles.md`, plan §5):
 *  - **Symbolic-by-default.** Evaluation uses the engine's exactness contract:
 *    `ln(2)` stays symbolic; numeric approximation is explicit (`N(expr)`).
 *  - **Errors are values.** A runtime problem becomes an `["Error", …]` value
 *    captured into `value`; nothing throws to the host. *Parse* problems (and a
 *    `#error` directive) go to `diagnostics`.
 *
 * `while`/`for` lower to the engine's imperative `Loop` (see `parser.ts`), so
 * they evaluate as ordinary engine primitives — no special handling here.
 */
/** Every sum VARIANT the engine knows, mapped to the sum that declared it
 * (`_sumOf`, recorded by `declareSumType`). Read through the resolver, which
 * is the public window onto the engine-global type registry. */
function sumVariantNames(ce: ComputeEngine): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const name of ce._typeResolver.names) {
    const sum = ce._typeResolver.resolve(name)?._sumOf;
    if (sum !== undefined) variants[name] = sum;
  }
  return variants;
}

/** Source of {@link executeEpsil}'s batch ids. Monotone and never reused: the
 * ids are only ever compared for equality with the stamp an earlier install of
 * the same run left on the protocol registry (ruling P47). */
let epsilBatchCounter = 0;

export function executeEpsil(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteEpsilOptions
): ExecuteEpsilResult {
  const steps = executeEpsilRun(ce, source, options);
  let step = steps.next();
  while (!step.done) {
    // An exception of `evaluate()` goes back into the run, at the statement
    // that yielded: its `catch` makes the error the value of the statement.
    let value: Expression;
    try {
      value = step.value.evaluate();
    } catch (e) {
      step = steps.throw(e);
      continue;
    }
    step = steps.next(value);
  }
  return step.value;
}

/**
 * Parse and execute an Epsil program as `executeEpsil` does, with each
 * top-level statement evaluated by `evaluateAsync()`: an operator that has
 * an asynchronous handler (a `FindFit` whose scan runs on the engine's
 * worker pool, an operator with only an `evaluateAsync` handler) runs on its
 * asynchronous route, and the caller can wait for the program without
 * blocking its thread for the whole run. The result is the result of
 * `executeEpsil` for the same program (ROADMAP CE-314.1).
 *
 * The time limit of an enclosing `ce.withTimeLimit()` span applies to the
 * whole program, as on the synchronous route, although the span closes when
 * this function returns its promise: the deadline frame is read when the
 * call starts and put back in place for each part of the run.
 *
 * Between two statements, the run waits for the statement's evaluation. The
 * engine fields that the run sets (the batch id, the nested-statement hook,
 * the declaration-route marker) stay in place while it waits, because the
 * asynchronous parts of the statement read them after their own waits (a
 * nested statement of a block reports its error through the hook). The
 * deadline frame is the exception: the frame of the host's span is put back
 * only for the parts of the run, since other work on the engine during the
 * wait must not see a span that has closed (the evaluation of the statement
 * keeps the frame it read when it started).
 *
 * So, until the promise settles, run no other evaluation or declaration on
 * this engine, and no second program: that work would see the fields of
 * this run (a declaration would be stamped as a statement of this program,
 * the error of a nested statement would be reported in its diagnostics),
 * and it would share the engine's current scope, in which the program runs
 * as on the synchronous route.
 */
export async function executeEpsilAsync(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteEpsilAsyncOptions
): Promise<ExecuteEpsilResult> {
  const signal = options?.signal;
  const aborted = (): CancellationError =>
    new CancellationError({ cause: signal?.reason });
  if (signal?.aborted) throw aborted();
  // The deadline frame of the run (the frame of the span around the call,
  // if any), and the frame the engine has outside the run: when the call
  // starts, then when the run resumes after each wait (the host may have
  // closed the span since).
  const runFrame = ce._deadlineFrame;
  let outsideFrame = runFrame;
  // The frame outside the run is put back on every exit, an exception
  // included: the span around the call has closed, and its frame must not
  // stay on the engine.
  try {
    const steps = executeEpsilRun(ce, source, options);
    // The parts of the run between two statements are synchronous; each ends
    // when the generator yields the next statement to evaluate.
    let step = steps.next();
    while (!step.done) {
      // The evaluation starts here, with the fields of the run in place: it
      // reads the deadline frame when it starts.
      let pending: Promise<Expression>;
      try {
        pending = step.value.evaluateAsync({ signal });
      } catch (e) {
        step = steps.throw(e);
        continue;
      }
      ce._deadlineFrame = outsideFrame;
      let value: Expression | undefined;
      let failure: { error: unknown } | undefined;
      try {
        value = await pending;
      } catch (e) {
        failure = { error: e };
      }
      outsideFrame = ce._deadlineFrame;
      ce._deadlineFrame = runFrame;
      if (signal?.aborted) {
        // The `finally` blocks of the run restore what it changed.
        steps.return(undefined as never);
        throw failure?.error instanceof CancellationError
          ? failure.error
          : aborted();
      }
      // A statement whose evaluation rejects is handled as a statement whose
      // `evaluate()` throws: its error becomes the value of the statement.
      step =
        failure !== undefined ? steps.throw(failure.error) : steps.next(value!);
    }
    return step.value;
  } finally {
    ce._deadlineFrame = outsideFrame;
  }
}

/**
 * The run of a program, shared by `executeEpsil` and `executeEpsilAsync`: a
 * generator that yields each top-level statement to evaluate and receives
 * its value. The synchronous driver evaluates it with `evaluate()`, the
 * asynchronous one with `evaluateAsync()`; everything else is this code.
 */
function* executeEpsilRun(
  ce: ComputeEngine,
  source: string,
  options: ExecuteEpsilOptions | undefined
): Generator<Expression, ExecuteEpsilResult, Expression> {
  // The BATCH (ruling P47): everything below — the static pre-pass and the
  // evaluation loop alike — runs under one id, which the protocol registry
  // stamps on the implementations it installs so that a second implementation
  // block for one (type, protocol) pair in this program is an error while a
  // later batch replaces. Restored rather than cleared, so a nested run (a
  // host re-entering the interpreter) leaves the outer batch intact.
  const enclosingBatch = ce._epsilBatchId;
  ce._epsilBatchId = ++epsilBatchCounter;
  // The nested-statement hook the evaluation loop installs (see
  // `nestedStatementReporter`). The loop restores it when it ends; this
  // restores it too when the run ends with an exception. Restored rather
  // than cleared, so a nested run leaves the outer run's hook in place.
  const enclosingStatementHook = ce._epsilStatementResultHook;
  // The names that the preparation step declared in the program scope ahead
  // of the statements that declare them (`LaterDeclarations`). The statement
  // loop removes each name when it reaches its statement. The names that are
  // left when the run ends (a program that its time budget stopped, or an
  // exception) are removed here, so that a later canonicalization in that
  // scope counts their bindings as declared again.
  const laterDeclarations: LaterDeclarations = {
    scope: undefined,
    firstAt: new Map(),
  };
  try {
    // A program runs with no iteration limit: a loop written by its author
    // runs until it ends, and the host's time budget is the bound. A limit
    // that the host assigned to the engine still applies. The engine keeps
    // the lifted limit after the run, so that a lazy collection the program
    // returns can be enumerated by the host in full.
    ce._liftDefaultIterationLimit();
    return yield* executeEpsilSteps(ce, source, options, laterDeclarations);
  } finally {
    ce._epsilBatchId = enclosingBatch;
    ce._epsilStatementResultHook = enclosingStatementHook;
    reachLaterDeclarations(laterDeclarations, Infinity);
  }
}

/**
 * The names that `prepareFunctionDeclarations()` declared in the program
 * scope `scope` before the statement that declares them, and that it kept
 * there: each name with the index of the first statement of the program
 * that declares or writes it.
 *
 * Until that statement is reached, a function body canonicalized in the
 * program scope does not count the binding as declared
 * (`markLaterDeclarations()`, `library/control-structures.ts`), as when the
 * program runs in order and the name has no binding yet. So in
 * `function f() { t = 1; t }`, `let a = String(g())`, `let t = 0`,
 * `function g() { 5 }`, `[f(), t]`, where the preparation of `g` declares
 * `t`, the assignment in `f` makes a local of `f`, and the program answers
 * `[1, 0]`. Without this, the assignment was a write to the program
 * variable `t`, and `f` was refused because it does not declare the `scope`
 * effect.
 */
type LaterDeclarations = {
  scope: ComputeEngine['context']['lexicalScope'] | undefined;
  firstAt: Map<string, number>;
};

/**
 * Remove from `later` the names whose first declaring statement is at index
 * `i` or before (`laterDeclarationReached()`): their bindings count as
 * declared from statement `i` on.
 */
function reachLaterDeclarations(later: LaterDeclarations, i: number): void {
  const scope = later.scope;
  if (scope === undefined) return;
  for (const [name, at] of later.firstAt) {
    if (at > i) continue;
    laterDeclarationReached(scope, name);
    later.firstAt.delete(name);
  }
}

function* executeEpsilSteps(
  ce: ComputeEngine,
  source: string,
  options: ExecuteEpsilOptions | undefined,
  laterDeclarations: LaterDeclarations
): Generator<Expression, ExecuteEpsilResult, Expression> {
  const diagnostics: ParsingDiagnostic[] = [];

  let ast: MathJsonExpression;
  try {
    const [parsed, parseDiagnostics] = parseEpsil(source, options?.url, {
      parseLatex: options?.parseLatex,
      allowHostPragmas: options?.allowHostPragmas ?? false,
      // The engine's already-declared type names, so an annotation naming a
      // host type resolves at parse time. `names` walks the scope chain.
      typeNames: ce._typeResolver.names,
      // The engine's PROTOCOL names — a separate set (protocols are not types,
      // ruling P8), consulted only on the unknown-type path so that
      // `function f(x: Comparable)` is reported as `protocol-in-type-position`.
      protocolNames: Object.keys(ce._protocolRegistry),
      // …and which of those names are sum VARIANTS, so re-running a
      // sugar-declared sum still reads as the sugar (see `parseEpsil`).
      sumVariants: sumVariantNames(ce),
      // Parsing and lexing consume the same host budget as execution.
      deadline: ce._deadlineFrame,
    });
    // The Epsil spellings of the library (`sin`, `pi`) become the library
    // names (`Sin`, `Pi`) here, before anything reads the tree — the static
    // pass, the advisory scans, and the evaluation loop all see `Sin`. The
    // raw tree the parser produced is not kept: the diagnostics index the
    // SOURCE, and every node keeps its offsets through the rewrite.
    ast = resolveLibraryNames(parsed, source, ce);
    diagnostics.push(...parseDiagnostics);
  } catch (e) {
    // A `#error` pragma throws a `FatalParsingError`. A cell must NOT throw to
    // the host (plan §5) — convert it to a diagnostic and return `Nothing`.
    if (e instanceof FatalParsingError) {
      diagnostics.push(
        makeDiagnostic(['error-directive', e.message], [0, source.length])
      );
      return { value: ce.Nothing, diagnostics };
    }
    if (isTimeoutCancellation(e)) {
      return {
        value: ce.box([
          'Error',
          { str: e instanceof Error ? e.message : 'Timeout exceeded' },
          // A spent step budget is a budget expiry too (the host's
          // deterministic guard); the error value names which one fired.
          { str: budgetCauseOf(e) },
        ]),
        diagnostics,
        valueRange: [0, source.length],
      };
    }
    throw e;
  }

  // Unwrap a top-level `Block` into its statement list. The parser wraps a
  // multi-statement program in `Block`; a single statement is not wrapped, and
  // an empty program is `Nothing`. A top-level `Block` node is unambiguously the
  // program wrapper: top-level `{…}` source is the collection grammar
  // (Set/Dictionary), statement blocks parse only in keyword position, and a
  // program whose only statement is a `do { … }` block is wrapped too, so
  // that block stays a nested scope (`Block(Block(…))`).
  const statements = operator(ast) === 'Block' ? [...operands(ast)] : [ast];

  // Where this program binds each of its names, for the "defined here" note a
  // signature error carries. Read from the raw AST, the only tree with source
  // offsets — so it must be collected before anything canonicalizes.
  const defSites = definitionSites(ast);

  // Static (canonicalization-time) type errors, reported *before* anything
  // runs — `"a" + 1` is a static failure, not a runtime one (plan §5). The
  // program then evaluates exactly as it otherwise would: the same mistake
  // may surface a second time as a `runtime-error` diagnostic or as an error
  // value, and that duplication is accepted (a static diagnostic never
  // suppresses evaluation). One exception: a top-level `let` that re-declares
  // a name of this program is reported once, by the pass, since the loop
  // below refuses the statement itself (`declaredAtTopLevel`) and knows the
  // report exists. Skipped when parsing produced errors: the AST of
  // an unparseable program is a guess, and canonicalizing it sprays noise.
  //
  // Cost: the pass boxes each statement, and the loop below boxes it again.
  // The two boxings are deliberately not shared — the loop boxes a statement
  // only after the previous ones have *evaluated*, so its canonical form can
  // depend on declarations this pass cannot see. Programs are small and
  // canonicalization is cheap next to evaluation.
  // Set when the host's time budget expired DURING the static pass. The
  // evaluation loop's first act is the same deadline check, so it records the
  // cancellation as the program's value; the flag only spares the advisory
  // pre-evaluation scans, which walk the whole program and have no business
  // running once the budget is gone.
  let budgetExpired = false;
  if (!diagnostics.some((x) => x.severity === 'error')) {
    try {
      // The pass writes into `diagnostics` as it goes (rather than returning
      // an array) so that everything it established BEFORE a deadline breach
      // is kept — see the parameter note on `staticDiagnostics`.
      staticDiagnostics(ce, ast, source, diagnostics);
    } catch (e) {
      // The pass boxes every statement, so it can outlive the host's time
      // budget on its own. `staticDiagnostics` lets an expired budget through
      // (its per-statement catch keeps only ordinary boxing failures) — and
      // the pass is a report, so there is nothing to convert it into here.
      if (!isTimeoutCancellation(e)) throw e;
      budgetExpired = true;
    }
  }

  // Parameters that shadow an engine constant — `f(Pi) = Pi + 1` declares a
  // parameter NAMED `Pi` (the uniform binding convention, shared with match
  // patterns), so the body's `Pi` is the argument, not π. Advisory; one
  // diagnostic per name per program run. Skipped on parse errors for the
  // same reason as the static pass above: the AST of an unparseable program
  // is a guess.
  if (!budgetExpired && !diagnostics.some((x) => x.severity === 'error')) {
    const reportedShadows = new Set<string>();
    for (const stmt of statements)
      scanConstantShadowingParams(
        ce,
        stmt,
        reportedShadows,
        diagnostics,
        stmt,
        source
      );
  }

  let value: Expression = ce.Nothing;
  let valueRange: [number, number] | undefined;
  // The statement whose value is `value`: the last statement that ran.
  let valueStatement: MathJsonExpression | undefined;

  // Names already surfaced as `unknown-function` — one diagnostic per unknown
  // name per program run, not per occurrence.
  const reportedUnknowns = new Set<string>();

  // SAME-SCOPE RE-DECLARATION (ruled 2026-09-05), the top level's runtime
  // tier: a `let`/`const` of a name an earlier top-level `let`/`const` of
  // THIS program declared evaluates to the `variable-redeclaration` error
  // value instead of re-declaring — the value the same statement has inside
  // a block (`canonicalBlock`, `library/control-structures.ts`) — and the
  // later statements keep reading the first binding. The set is per program:
  // a later program on the same engine (a re-run notebook cell, a REPL line)
  // re-declares legally. The static pass reports the same statement
  // (`variableRedeclarationDiagnostic`); this is the behavior it describes.
  const declaredAtTopLevel = new Set<string>();

  // The `function` statements of the program, installed before the first
  // statement runs, so that a call before its definition resolves when its
  // statement runs (see `prepareFunctionDeclarations`). Skipped when the
  // host's time budget expired during the static pass: the first deadline
  // check of the loop below records the cancellation.
  const prepared = budgetExpired
    ? {
        preboxed: new Map<number, Expression>(),
        scanned: new Set<number>(),
      }
    : prepareFunctionDeclarations(
        ce,
        statements,
        source,
        reportedUnknowns,
        diagnostics,
        laterDeclarations
      );

  // A NESTED statement (in a loop body, a function body, an `if` branch)
  // whose value is discarded and holds an error is reported as a
  // `runtime-error` diagnostic too, by a hook the engine calls after each
  // such statement. Installed for the evaluation loop only: the static pass
  // above evaluates no statement.
  const enclosingStatementHook = ce._epsilStatementResultHook;
  // The failures (`failureKey()`) that the hook reported during the
  // evaluation of the current top-level statement. The value of the
  // statement can hold the same failure, which is then not reported again.
  const nestedFailures = new Set<object>();
  ce._epsilStatementResultHook = nestedStatementReporter(
    ce,
    statements,
    defSites,
    diagnostics,
    nestedFailures
  );

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    nestedFailures.clear();
    // The names that the preparation step declared ahead of this statement,
    // and that this statement declares first, count as declared from here
    // on (`LaterDeclarations`).
    reachLaterDeclarations(laterDeclarations, i);
    // "Errors are values": a runtime problem becomes an `["Error", …]` value.
    // Most engine problems already flow back as `["Error", …]` boxed values;
    // the try/catch is the backstop for the few paths that throw (e.g.
    // reassigning a `const`, or a cap breach such as `timeLimit`/
    // `iterationLimit`/`recursionLimit`, which throw a `CancellationError`).
    let cancellation: CancellationCause | undefined;
    // The name of the constant and the source range of the assignment, when
    // the statement threw the engine's `ConstantAssignmentError`.
    let constantName: string | undefined;
    let constantSite: [number, number] | undefined;
    valueRange = statementRange(stmt, source);
    valueStatement = stmt;
    // The name a top-level `let` of this statement re-declares, if any (see
    // `declaredAtTopLevel`).
    let redeclared: string | undefined;
    // The canonical form of the statement, which maps an error's frame back
    // to the written operand of a reordered call (`canonicalOrderOf`).
    let boxedStmt: Expression | undefined;

    // Run BEFORE the statement is boxed: this scan reads the RAW ast and needs
    // no value, and boxing an application INFERS a function signature for an
    // undeclared head — `area(c)` types `area` as `function`, which is exactly
    // the evidence `bindsACallable` reads to tell a genuine local function
    // binding from a bare name. Scanning afterwards let every call defeat its
    // own diagnostic. It also runs ahead of `scanUnknownFunctions` below, so a
    // head that is both a protocol property and a fuzzy match for some
    // operator gets the specific message rather than a "did you mean?" guess;
    // the two share `reportedUnknowns` and this scan adds to it only when it
    // actually reports, so every head it passes over reaches the other scan
    // unchanged. A `function` statement that the preparation step boxed
    // before the loop was scanned there, before its boxing.
    if (!prepared.scanned.has(i))
      scanProtocolPropertyCalls(
        ce,
        stmt,
        reportedUnknowns,
        diagnostics,
        stmt,
        source
      );
    // REDEFINITION DISCIPLINE — the statement-route marker, raised only for a
    // statement that itself declares. BOTH registrations this loop causes
    // (canonicalization inside `box`, then evaluation) happen inside the
    // window, and the static pre-pass raises the same marker around its own
    // canonicalization, so all three of a statement's registrations carry one
    // stamp and none of them looks like a second declaration of the name it
    // declares. A `ce.box(["DeclareType", …]).evaluate()` a host
    // operator makes re-entrantly runs with the marker DOWN — either because
    // its enclosing statement is not a declaration, or because the `Declare*`
    // handler cleared it around its own body — so it stays unstamped and
    // freely replaceable. Restored, not cleared, so a nested `executeEpsil`
    // leaves the outer marker intact.
    // See `docs/TYPE-SYSTEM.md`.
    const enclosingRoute = ce._epsilDeclarationRoute;
    ce._epsilDeclarationRoute = isDeclarationStatement(stmt);
    try {
      // The host's time budget is one deadline for the whole program (an
      // enclosing `withTimeLimit` span). The engine only checks it inside
      // long-running work — every few hundred evaluations, inside collection
      // walks — so a program of many cheap statements would otherwise run to
      // completion no matter how far past its deadline it is: the check
      // between statements bounds the overrun to one statement.
      checkDeadline(ce._deadlineFrame);
      redeclared = topLevelRedeclaration(stmt, declaredAtTopLevel);
      if (redeclared === undefined) {
        // A `function` statement that the preparation step boxed (and so
        // installed) is not boxed a second time: it is evaluated here, at its
        // own turn.
        boxedStmt = prepared.preboxed.get(i) ?? ce.box(stmt);
        // The driver evaluates the statement: `evaluate()` in
        // `executeEpsil`, `evaluateAsync()` in `executeEpsilAsync`.
        value = yield boxedStmt;
      } else value = ce.error(['variable-redeclaration', redeclared]);
      // An error value narrows the anchor to its breadcrumb's innermost
      // source-mapped frame, so a host that reports the error points at the
      // offending subexpression, not the whole statement.
      const errors = value.errors;
      if (errors.length > 0)
        valueRange = narrowErrorRange(
          ce,
          errors[0].json,
          stmt,
          valueRange,
          boxedStmt
        );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      cancellation = cancellationCause(e);
      constantName = constantAssignmentName(e);
      constantSite = constantAssignmentSite(e);
      // A cancellation (cap breach) carries a machine-readable `cause` as a
      // second Error operand — additively, so the message operand (which hosts
      // may still string-match, e.g. "Operation canceled" /
      // "Recursion limit exceeded") is unchanged. An assignment to a constant
      // becomes an error value with the code `constant-assignment`. Other
      // throws keep the single-operand shape.
      value =
        cancellation !== undefined
          ? ce.box(['Error', { str: message }, { str: cancellation }])
          : constantName !== undefined
            ? ce.box(constantAssignmentError(constantName))
            : ce.box(['Error', { str: message }]);
    } finally {
      ce._epsilDeclarationRoute = enclosingRoute;
    }

    // A runtime problem in a NON-final statement would otherwise vanish —
    // only the last statement's value is returned — so surface it as a
    // diagnostic (e.g. `xs[2] = 9`, an indexed assignment the engine rejects,
    // or reassigning a `const` mid-program). A cap breach becomes a structured
    // `evaluation-canceled` diagnostic carrying the cause; other runtime
    // problems become a `runtime-error` diagnostic. The final statement's
    // problems stay in `value`, per the errors-are-values contract.
    // A top-level re-declaration the static pass already reported (with the
    // first declaration's site as a note) is not reported a second time as a
    // `runtime-error`: it is one problem, and the value carries it.
    // The same holds for a binding of an absence marker (`let Missing =
    // 3`): the static pass reports it at the binding, and the statement's
    // `absence-marker-binding` error value is that same problem.
    // The walks of the value below run outside the per-statement `try`, and
    // nothing may throw to the host from them: a value can be nested so
    // deeply that a recursive walk (`errors`, `json`) overflows the stack.
    // A walk that throws is reported as a diagnostic of the statement
    // (`reportWalkFailure`), and the advisory result it was computing is
    // dropped.
    const walkFailure = { error: undefined as unknown };
    const markerError = walkValue(walkFailure, () => value.errors[0]);
    const markerCode =
      isFunction(markerError, 'Error') &&
      isFunction(markerError.op1, 'ErrorCode')
        ? markerError.op1.ops
        : undefined;
    const markerName =
      markerCode !== undefined &&
      isString(markerCode[0]) &&
      markerCode[0].string === 'absence-marker-binding' &&
      isString(markerCode[1])
        ? markerCode[1].string
        : undefined;
    const reportedStatically =
      (redeclared !== undefined &&
        diagnostics.some(
          (d) =>
            Array.isArray(d.message) &&
            d.message[0] === 'variable-redeclaration' &&
            d.message[1] === redeclared
        )) ||
      (markerName !== undefined &&
        diagnostics.some(
          (d) =>
            Array.isArray(d.message) &&
            d.message[0] === 'absence-marker-binding' &&
            d.message[1] === markerName
        )) ||
      // A `function` statement on a `const` binding: the static check reports
      // it as a `static-type-error` with the engine code
      // `invalid-clause-definition` at this statement, so the error value of
      // the statement is not reported a second time as a `runtime-error`.
      (markerError !== undefined &&
        errorCode(markerError.json) === 'invalid-clause-definition' &&
        diagnostics.some(
          (d) =>
            Array.isArray(d.message) &&
            d.message[0] === 'static-type-error' &&
            d.message[3] === 'invalid-clause-definition' &&
            d.range[0] === statementRange(stmt, source)[0]
        )) ||
      // An assignment to a `const` of the program: the static check reports
      // it as a `static-type-error` with the engine code
      // `constant-assignment`, at the range of the `Assign` node. The
      // assignment can be in a function body that this statement calls. The
      // engine records on the error the source range of the `Assign` node
      // that made the write (`constantSite`). The run-time error is the
      // problem of a static report only when the two ranges are the same and
      // the report names the same constant. A match by name alone is not
      // sufficient: the same name can be a constant of the program, a local
      // constant of a function, and a constant outside the program (a library
      // constant such as `Pi`, a constant of an earlier program), and a
      // statement can make a write that the static check did not report. Such
      // a write is reported here.
      (markerError !== undefined &&
        errorCode(markerError.json) === 'constant-assignment' &&
        constantSite !== undefined &&
        diagnostics.some(
          (d) =>
            Array.isArray(d.message) &&
            d.message[0] === 'static-type-error' &&
            d.message[3] === 'constant-assignment' &&
            d.message[1] === describeError(markerError.json) &&
            d.range[0] === constantSite?.[0] &&
            d.range[1] === constantSite?.[1]
        )) ||
      // A use of a local before it has a value: see
      // `reportedAsReadBeforeDeclaration()`.
      (markerError !== undefined &&
        reportedAsReadBeforeDeclaration(markerError, diagnostics));
    if (i < statements.length - 1 && !reportedStatically) {
      walkValue(walkFailure, () => {
        // A `Map` or `Filter` view that holds no error can still give one
        // when it is read (`lazyViewCellError`).
        const error = value.errors[0] ?? lazyViewCellError(ce, value);
        // A failure that a nested statement of this statement reported is
        // not reported again.
        if (error !== undefined && !nestedFailures.has(failureKey(error)))
          diagnostics.push(
            errorValueDiagnostic(
              ce,
              error,
              stmt,
              statementRange(stmt, source),
              defSites,
              cancellation,
              boxedStmt
            )
          );
      });
    }

    // An expired TIME budget ends the program: the deadline belongs to the
    // enclosing span, not to this statement, so it stays expired — every later
    // statement would fail the same check and none of them can run. Stopping
    // here makes the cancellation the program's result: `value` is the
    // `["Error", "Timeout exceeded", "timeout"]` of the statement that hit
    // it and `valueRange` points at that statement (plus the
    // `evaluation-canceled` diagnostic above when it was not the last one).
    // The count-based caps (`iterationLimit`, `recursionLimit`) are
    // per-construct configuration, not a shared budget: the next statement
    // gets a fresh allowance, so a breach there is an ordinary error value
    // and the program continues (see `docs/TIMEOUT-MODEL.md` §9).
    if (cancellation === 'timeout' || cancellation === 'step-budget') {
      reportWalkFailure(ce, walkFailure, stmt, source, defSites, diagnostics);
      break;
    }

    // "Did you mean?" — calling an unknown function stays *silently* symbolic
    // (an inert `["Quartile", …]` value), so the user never learns it did not
    // run. Walk the result for function applications whose head is not a known
    // operator and whose name is close to one, and emit a `warning`. The
    // returned value is unchanged (still symbolic); this is advisory. Source
    // ranges are lost from the evaluated tree, so the *statement's* range is
    // attached.
    walkValue(walkFailure, () =>
      scanUnknownFunctions(
        ce,
        value.json,
        reportedUnknowns,
        diagnostics,
        stmt,
        source
      )
    );
    reportWalkFailure(ce, walkFailure, stmt, source, defSites, diagnostics);
  }

  ce._epsilStatementResultHook = enclosingStatementHook;

  // PENDING CONFORMANCES (protocols design P3). A conformance declared without
  // an implementation block is *pending*, and the state persists across
  // batches — so the notebook pattern (declare in one cell, implement in the
  // next) works. Every batch re-reports each still-pending edge as a WARNING
  // until it is fulfilled, so the reminder cannot be lost with the cell that
  // produced it. A SEMANTIC protocol (no requirements) is complete at
  // declaration and is never pending.
  // Where each `type X is P` statement of THIS batch sits, so the warning can
  // point at the declaration instead of the whole program. Collected once, then
  // matched per pending edge.
  const conformanceSites = conformanceStatementSites(statements, source);

  for (const protocol of Object.values(ce._protocolRegistry))
    for (const conformance of protocol.conformances)
      if (conformance.pending)
        diagnostics.push({
          severity: 'warning',
          message: [
            'protocol-implementation-pending',
            conformance.targetKey,
            protocol.name,
            // An edge left pending by a RE-SETTLEMENT — a replaced protocol, or
            // a redefined target type — says what moved under it, since "there
            // is no implementation yet" is not the story there. Absent for the
            // ordinary declare-then-implement case, whose third operand stays
            // the empty string.
            conformance._pendingReason ?? '',
          ],
          // The declaring statement when this batch contains it. The registry
          // outlives the batch — the notebook pattern declares in one cell and
          // implements in a later one, and every batch re-reports the edge —
          // so an edge declared in an EARLIER batch has no range in this
          // source; it falls back to the whole program, which is the honest
          // "this cell is affected, the declaration is not in it" marker.
          range: conformanceSiteRange(
            conformanceSites,
            conformance.targetKey,
            protocol.name
          ) ?? [0, source.length],
        });

  // The final statement's error stays a VALUE (no diagnostic, by design), so
  // the notes that would have travelled on a diagnostic are returned beside
  // it — computed here because only this function has the engine, the raw AST
  // and the source together, exactly as for `valueRange`.
  const notesFailure = { error: undefined as unknown };
  const valueNotes =
    walkValue(notesFailure, () => {
      const errors = value.errors;
      return errors.length > 0
        ? signatureNotes(ce, errors[0].json, {
            definitionSites: defSites,
            primaryRange: valueRange,
            boxedError: errors[0],
          })
        : [];
    }) ?? [];
  if (valueStatement !== undefined)
    reportWalkFailure(
      ce,
      notesFailure,
      valueStatement,
      source,
      defSites,
      diagnostics
    );

  return {
    value,
    diagnostics,
    ...(valueRange === undefined ? {} : { valueRange }),
    ...(valueNotes.length === 0 ? {} : { valueNotes }),
  };
}

/**
 * The result of `walk`, a walk of the value of a statement that runs outside
 * the per-statement `try` of {@link executeEpsil}, or `undefined` when the
 * walk throws. The first exception is kept in `failure`, for
 * {@link reportWalkFailure}. A recursive walk of a deeply nested value can
 * overflow the stack (a `RangeError`), and a program must never throw to its
 * host.
 */
function walkValue<T>(
  failure: { error: unknown },
  walk: () => T
): T | undefined {
  try {
    return walk();
  } catch (e) {
    if (failure.error === undefined) failure.error = e;
    return undefined;
  }
}

/**
 * Report the exception that a walk of the value of `stmt` threw
 * ({@link walkValue}), if any, as a diagnostic at the statement: a
 * `runtime-error` with the message of the exception, or an
 * `evaluation-canceled` diagnostic when the exception is a cancellation (the
 * host's time budget expired during the walk). The exception is cleared, so
 * that it is reported once, and a diagnostic equal to one already reported
 * (the walks of the final value fail as the walks of its statement did) is
 * not added again.
 */
function reportWalkFailure(
  ce: ComputeEngine,
  failure: { error: unknown },
  stmt: MathJsonExpression,
  source: string,
  defSites: ReturnType<typeof definitionSites>,
  diagnostics: ParsingDiagnostic[]
): void {
  const e = failure.error;
  if (e === undefined) return;
  failure.error = undefined;
  const message = e instanceof Error ? e.message : String(e);
  const diagnostic = errorValueDiagnostic(
    ce,
    ce.box(['Error', { str: message }]),
    stmt,
    statementRange(stmt, source),
    defSites,
    cancellationCause(e)
  );
  const key = JSON.stringify([diagnostic.message, diagnostic.range]);
  if (!diagnostics.some((d) => JSON.stringify([d.message, d.range]) === key))
    diagnostics.push(diagnostic);
}

/**
 * A compact rendering of an error value's `ErrorTrace` breadcrumb —
 * `in Ln argument 1, in Add argument 2` — or `''` when it carries none.
 *
 * The breadcrumb is the LAST operand of an `["Error", …]` value and is
 * identified by its `ErrorTrace` head, never by position (engine design §2a):
 * `["ErrorTrace", ["ErrorFrame", "'Ln'", 1], ["ErrorFrame", "'Add'", 2]]`,
 * innermost frame first. Read here from MathJSON rather than through an
 * engine helper: `src/epsil` never statically imports the engine.
 *
 * The same breadcrumb also carries `["ErrorBroadcast", "'f'", index, length]`
 * entries — a user function with scalar parameters is auto-broadcast over a
 * collection argument, and a failure inside one element is unreadable without
 * saying so.
 */
/**
 * The first name a top-level `Declare` statement declares that `declared`
 * already holds, or `undefined` after adding every name the statement
 * declares to `declared` (`declaredVariableNames`, shared with the static
 * pass). The statement is accepted or refused whole: a refused destructuring
 * `let` adds none of its leaves.
 */
function topLevelRedeclaration(
  statement: MathJsonExpression,
  declared: Set<string>
): string | undefined {
  const names = declaredVariableNames(statement);
  const repeated = names.find((name) => declared.has(name));
  if (repeated !== undefined) return repeated;
  for (const name of names) declared.add(name);
  return undefined;
}

/**
 * DECLARATION PREPARATION: install the `function` statements of the program
 * before its first statement runs.
 *
 * A function declaration is available in its whole statement list, on every
 * route: in `let a = String(g(3)); function g(k) { k^2 }`, the call `g(3)`
 * resolves when its statement runs, and `a` is `"9"`. The whole-block
 * interpreter does this because the `DefineFunction` canonical handler
 * installs the clause when the block is canonicalized, before the first
 * statement runs (`library/core.ts`), and the compiler moves the definitions
 * to the front of the statement list. This runner boxes one statement at a
 * time, after the previous ones have run, so without this step a call before
 * the definition found no function. An assignment of a function literal
 * (`g = (k) => k^2`) is not a declaration: it takes effect when it runs.
 *
 * Which statements are declarations is the shared rule
 * `isHoistedFunctionDefinition()` (`library/control-structures.ts`). A
 * statement whose name a `type` statement of this program declares (the
 * name of a `DeclareType` or `DeclareSumType`, or a variant of a sum type)
 * is not prepared either: it is the smart constructor of that type, and it
 * can only be defined after the type statement has run. Nor is a statement
 * whose name an earlier statement of the program gives a value (an
 * assignment, or a `let`/`const` with an initial value, `writtenNames()`):
 * the definition then depends on that value (it adds a clause to a function
 * the assignment installs, it is refused on a name that holds a number, it
 * decides whether the assignment is accepted), so it runs in order. A `let`
 * with no value (`let g: (integer) -> integer`) does not prevent it. Nor is
 * a statement after the first statement that declares a type, a protocol or
 * a conformance: its annotations can name that type, which does not exist
 * before its statement runs. Nor is a statement whose name has another
 * `function` statement that the shared rule does not accept (a generic
 * definition, for example): that statement takes effect when it runs, and
 * the clauses of a name are prepared together or not at all. Nor is a
 * statement whose body uses a variable for which the preparation cannot
 * give the body the binding that the statement would see in order
 * (`isSettledBefore()`).
 *
 * Only the functions that the program can call before their definition are
 * prepared: a function that a statement other than a function definition
 * names, before the (last) `function` statement of that function, either
 * directly or through the bodies of the functions it names. Each other
 * function is installed at its turn, as it was before this step existed.
 *
 * For each such statement, in program order:
 *
 * 1. The names that the statements before it declare (each `let`/`const`
 *    target, with its static type, `staticDeclarations()`, and each target
 *    of an assignment, with the type of its first assigned value when that
 *    value is a closed literal, `closedLiteralType()`, as the assignment
 *    gives it when it runs) and that the program scope does not bind yet are
 *    declared in the program scope, valueless and inferred, as the block
 *    hoist does (`canonicalBlock()`). The body of the function is then
 *    canonicalized as it is when the statement is reached in order: a write
 *    to the target of an earlier `let` stays a `scope` write, a read of `i`
 *    after `let i = 2` reads the variable and not the imaginary unit, and
 *    `let g: (integer) -> integer` before `function g(k)` gives the binding
 *    the declared type, as the block hoist does. The clause itself is
 *    installed with its inferred signature until the `let` statement runs:
 *    the `Declare` handler then drops the early clause and, when the `let`
 *    has no value, installs it again at once under the declared signature
 *    (`CLAUSE_INSTALLED_AHEAD`, `library/core.ts`), so a call between the
 *    `let` and the `function` statement is resolved and checked against the
 *    declared signature. The target of an assignment that an enclosing
 *    scope declares is not declared: the assignment writes that binding. A
 *    later `let` upgrades the valueless binding in place, as it upgrades an
 *    auto-declared one.
 * 2. The statement is boxed, with the declaration-route marker raised as the
 *    statement loop raises it, which installs the clause. The loop evaluates
 *    the boxed statement at its turn and does not box it again. A boxing that
 *    throws leaves the statement to the loop, which boxes it at its turn and
 *    reports the error there. An expired time budget ends the preparation:
 *    the first deadline check of the loop records the cancellation.
 *
 *    A known difference from a program that runs in order: when the program
 *    stops before a prepared statement runs (a statement before it uses up
 *    the time or step budget, and the loop stops), the clause of the
 *    prepared statement stays installed, so the function is defined after
 *    the program although its statement did not run. The binding is not
 *    removed: the clause can have been added to a function that an earlier
 *    program defined, and removing the binding would remove that function
 *    too.
 * 3. The bindings that step 1 made for a name that an enclosing scope
 *    defines (a library constant such as `i`, `e` or `Pi`, another library
 *    definition, a binding of a host scope around the program scope) are
 *    removed, so that a statement before the `let` of that name still reads
 *    the outer definition, as it does when the program runs in order (and,
 *    for a library constant, as on the block route). Step 1 still declares
 *    these names, so that the body boxed in step 2 binds the variable and
 *    not the outer definition; the body reads the variable once the `let`
 *    has run and declared it again. A call of the function made before that
 *    `let` runs reads the outer definition in the body, where the block
 *    route gives the `read-before-declaration` error: the top level of this
 *    runner has no binding that is declared and not yet initialized.
 * 4. When all the statements are prepared, the bindings that step 1 made
 *    and step 3 kept are marked as later declarations of the program scope
 *    (`LaterDeclarations`, `markLaterDeclarations()`), until the statement
 *    loop reaches the first statement that declares each name. A function
 *    body boxed in a statement before that one does not count the binding
 *    as declared, so an assignment to the name in the body makes a local of
 *    the body, as when the program runs in order: in
 *    `function f() { t = 1; t }`, `let a = String(g())`, `let t = 0`,
 *    `function g() { 5 }`, `[f(), t]`, the value is `[1, 0]`. A read of the
 *    name still finds the binding, which has no value.
 *
 * `scanProtocolPropertyCalls` runs on a prepared statement before it is
 * boxed, for the reason the statement loop gives, and the loop does not scan
 * it again (`scanned`). The names that the statements before it declare are
 * passed to the scan as bound: their values are not assigned yet, so the
 * scan cannot see that one of them holds a function.
 *
 * Provenance: `docs/plans/2026-10-21-function-declaration-hoisting.md`,
 * section B.
 */
function prepareFunctionDeclarations(
  ce: ComputeEngine,
  statements: ReadonlyArray<MathJsonExpression>,
  source: string,
  reportedUnknowns: Set<string>,
  diagnostics: ParsingDiagnostic[],
  laterDeclarations: LaterDeclarations
): {
  /** The boxed `function` statements, keyed by statement index. */
  preboxed: Map<number, Expression>;
  /** The statements that `scanProtocolPropertyCalls` scanned already. */
  scanned: Set<number>;
} {
  const preboxed = new Map<number, Expression>();
  const scanned = new Set<number>();
  if (!statements.some((s) => operator(s) === 'DefineFunction'))
    return { preboxed, scanned };

  // The names that a `type` statement of this program declares: the type,
  // and each variant of a sum type (`["Tuple", {str: variant}, payload]`).
  const typeNames = new Set<string>();
  for (const s of statements) {
    const head = operator(s);
    if (head !== 'DeclareType' && head !== 'DeclareSumType') continue;
    const name = symbol(operand(s, 1));
    if (name) typeNames.add(name);
    if (head === 'DeclareSumType')
      for (const variant of operands(s).slice(1)) {
        if (operator(variant) !== 'Tuple') continue;
        const variantName = stringValue(operand(variant, 1));
        if (variantName) typeNames.add(variantName);
      }
  }

  // The statements boxed without canonicalization, which binds nothing and
  // declares nothing: the shared rules read their structure only.
  const raw = statements.map((s) => {
    try {
      return ce.box(s, { form: 'raw' });
    } catch {
      return undefined;
    }
  });

  // The `function` statements of each name, by statement index. The clauses
  // of a multi-clause function are prepared together, or not at all, so that
  // they are installed in their written order.
  const clauses = new Map<string, number[]>();
  // The names that have a `DefineFunction` statement that is not prepared:
  // a generic definition, a clause that is not a `Function` literal, or a
  // statement whose raw boxing threw. Such a statement takes effect only
  // when it runs, so no other clause of its name is prepared: a later clause
  // installed ahead of an earlier generic definition would make the generic
  // definition refused, where in written order the later clause is refused.
  const notHoisted = new Set<string>();
  statements.forEach((s, j) => {
    if (operator(s) !== 'DefineFunction') return;
    const name = symbol(operand(s, 1));
    if (!name) return;
    const candidate = raw[j];
    if (
      candidate === undefined ||
      !isHoistedFunctionDefinition(ce, candidate)
    ) {
      notHoisted.add(name);
      return;
    }
    const list = clauses.get(name);
    if (list === undefined) clauses.set(name, [j]);
    else list.push(j);
  });

  // For each name, the statements that declare it or write it, read in one
  // pass over the program, each statement once.
  const writes = statementWrites(ce, statements, raw);
  const writesBefore = (n: string, j: number): NameWrite[] =>
    (writes.get(n) ?? []).filter((w) => w.index < j);

  // The names whose statements are not prepared.
  const excluded = new Set<string>();
  // The index of the first statement that declares a type, a protocol or a
  // conformance. A `function` statement after it is not prepared: its
  // annotations can name a type that this statement declares, and the type
  // does not exist before the statement runs.
  const firstTypeStatement = statements.findIndex(
    (s) => isDeclarationStatement(s) && operator(s) !== 'DefineFunction'
  );
  for (const [name, indices] of clauses)
    if (
      notHoisted.has(name) ||
      typeNames.has(name) ||
      indices.some(
        (j) =>
          (firstTypeStatement >= 0 && j > firstTypeStatement) ||
          writesBefore(name, j).some((w) => w.valued)
      )
    )
      excluded.add(name);

  // The names to prepare: the functions that a statement before their last
  // `function` statement can call when it runs. A statement other than a
  // function definition can call each function it names, each function that
  // the `function` statements of those functions name, and so on
  // (`reach`). A use in the body of a function defined earlier is not a call
  // when its statement runs, and does not count by itself.
  //
  // The other functions are installed at their turn, as before this step
  // existed: preparing them would change nothing that the program can
  // observe, and preparing only some functions of a program installs them
  // in another order than the written one. That order shows when a body
  // calls a function with the wrong arguments: the error is the value of the
  // definition that comes second.
  const namesOf = statements.map((s) => namesIn(s));
  const reach = (k: number): Set<string> => {
    const found = new Set<string>();
    const pending = [...namesOf[k]];
    while (pending.length > 0) {
      const n = pending.pop()!;
      if (found.has(n)) continue;
      found.add(n);
      for (const c of clauses.get(n) ?? []) pending.push(...namesOf[c]);
    }
    return found;
  };
  const prepared = new Set<string>();
  statements.forEach((s, k) => {
    if (operator(s) === 'DefineFunction') return;
    for (const n of reach(k)) {
      const indices = clauses.get(n);
      if (
        indices !== undefined &&
        !excluded.has(n) &&
        k < indices[indices.length - 1]
      )
        prepared.add(n);
    }
  });

  // A `function` statement whose body uses a variable that is not settled
  // before it (`isSettledBefore()`) is not prepared either: the binding that
  // the preparation would give the body differs from the binding that the
  // statement sees when it runs in order. The names that the program defines
  // with `function` statements and the names that the function binds for
  // its own body (its parameters and the targets of the `let` statements of
  // its body, `functionLocalNames()`) are not checked: a use of one of these
  // in the body does not read a variable of the program. Read before any
  // statement is prepared, while the program scope holds only the bindings
  // made before the program runs.
  const scope = ce.context.lexicalScope;
  try {
    for (const name of prepared) {
      checkDeadline(ce._deadlineFrame);
      for (const j of clauses.get(name)!) {
        const own = functionLocalNames(statements[j]);
        const unsettled = [...namesIn(statements[j])].some(
          (n) =>
            !own.has(n) &&
            !clauses.has(n) &&
            !notHoisted.has(n) &&
            !isSettledBefore(scope, n, writesBefore(n, j))
        );
        if (unsettled) {
          prepared.delete(name);
          break;
        }
      }
    }
  } catch (e) {
    // Nothing is prepared yet: the first deadline check of the statement
    // loop records the cancellation.
    if (isTimeoutCancellation(e)) return { preboxed, scanned };
    throw e;
  }
  if (prepared.size === 0) return { preboxed, scanned };
  const isOwnClause = (k: number, name: string) =>
    clauses.get(name)!.includes(k);
  // The bindings that step 1 made and step 3 did not remove, each with the
  // index of the first statement that declares or writes the name.
  const kept = new Map<string, number>();

  for (let j = 0; j < statements.length; j++) {
    const name = symbol(operand(statements[j], 1));
    if (!name || !prepared.has(name) || !isOwnClause(j, name)) continue;

    // Step 1: the names that the statements before `j` declare. A name that
    // a `let`/`const` declares has the static type of the last such
    // statement that gives one (as `staticDeclarations()` reads a list of
    // statements); a name that only assignments write has the static type
    // of the first assignment, which declares it when it runs.
    const made: string[] = [];
    const bound = new Set<string>();
    for (const [n, all] of writes) {
      const before = all.filter((w) => w.index < j && w.kind !== 'other');
      if (before.length === 0) continue;
      bound.add(n);
      const lets = before.filter((w) => w.kind === 'let');
      if (lets.length > 0) {
        if (n === 'Nothing' || scope.bindings.has(n)) continue;
        let type: Type | undefined = undefined;
        for (const w of lets) type = w.type ?? type;
        ce._declareSymbolValue(
          n,
          { type: type ?? 'unknown', inferred: true },
          scope
        );
      } else {
        if (
          n === 'Nothing' ||
          n === '_' ||
          ce.lookupDefinition(n) !== undefined
        )
          continue;
        ce._declareSymbolValue(
          n,
          { type: before[0].type ?? 'unknown', inferred: true },
          scope
        );
      }
      made.push(n);
    }

    scanProtocolPropertyCalls(
      ce,
      statements[j],
      reportedUnknowns,
      diagnostics,
      statements[j],
      source,
      bound
    );
    scanned.add(j);

    // Step 2: box the statement, which installs the clause.
    let expired = false;
    const enclosingRoute = ce._epsilDeclarationRoute;
    ce._epsilDeclarationRoute = isDeclarationStatement(statements[j]);
    try {
      checkDeadline(ce._deadlineFrame);
      preboxed.set(j, ce.box(statements[j]));
    } catch (e) {
      // Any other failure leaves the statement to the loop.
      expired = isTimeoutCancellation(e);
    } finally {
      ce._epsilDeclarationRoute = enclosingRoute;
      // Step 3: a statement before the `let` of a name that an enclosing
      // scope defines (a library constant, a library definition, a host
      // binding) reads that definition.
      for (const n of made)
        if (hasOuterDefinition(scope, n)) ce.undeclare(n);
        else kept.set(n, writes.get(n)![0].index);
    }
    if (expired) break;
  }
  // Step 4: the bindings that step 1 made and step 3 kept are later
  // declarations for the statements before the first statement that
  // declares each name (`LaterDeclarations`): a function body boxed in such
  // a statement does not count the binding as declared, so an assignment to
  // the name in the body makes a local of the body, as in a program that
  // runs in order. They are marked only now: the statements prepared above
  // come after these statements, and their bodies must see the bindings.
  if (kept.size > 0) {
    laterDeclarations.scope = scope;
    for (const [n, at] of kept) laterDeclarations.firstAt.set(n, at);
    markLaterDeclarations(scope, kept.keys());
  }
  return { preboxed, scanned };
}

/** True when a scope that encloses `scope` binds `name`: the library scope
 * (a constant such as `i`, or any other library definition), or a scope of
 * the host around the program scope. */
function hasOuterDefinition(
  scope: ComputeEngine['context']['lexicalScope'],
  name: string
): boolean {
  // The parent of the root scope is `null` or absent.
  for (let s = scope.parent; s; s = s.parent)
    if (s.bindings.has(name)) return true;
  return false;
}

/** A top-level statement of the program that declares or writes a name
 * (`statementWrites()`). */
type NameWrite = {
  /** The index of the statement in the program. */
  index: number;
  /** `let`: a `let`/`const` of the name, with or without a value. `assign`:
   * an assignment to the name. `other`: a statement whose boxing with
   * `{ form: 'raw' }` failed and that gives the name a value
   * (`writtenNames()`); nothing else is read from it. */
  kind: 'let' | 'assign' | 'other';
  /** True when the statement gives the name a value (`writtenNames()`). */
  valued: boolean;
  /** The static type that the statement gives the name: the declared type,
   * or the type of a closed literal value, of a `let`/`const`
   * (`staticDeclarations()`), or the type of a closed literal value that an
   * assignment gives to a single name (`closedLiteralType()`). */
  type: Type | undefined;
  /** True when the statement gives the name a static picture: a binding
   * that the preparation can declare before the statement runs and that
   * boxes a function body as the binding that the statement makes does.
   * That is a `let`/`const` with a declared type, with a closed literal
   * value, or with neither a type nor a value (both bindings are then a
   * valueless `unknown` variable), or an assignment of a closed literal to
   * a single name. */
  static: boolean;
};

/**
 * For each name, the top-level statements of the program that declare it
 * (a `let`/`const`, with or without a value) or write it (an assignment), in
 * program order, one entry per statement. Each statement is read once.
 * `raw` holds the statements boxed with `{ form: 'raw' }`; a statement whose
 * boxing failed contributes only its `writtenNames()`, as `other` entries.
 */
function statementWrites(
  ce: ComputeEngine,
  statements: ReadonlyArray<MathJsonExpression>,
  raw: ReadonlyArray<Expression | undefined>
): Map<string, NameWrite[]> {
  const writes = new Map<string, NameWrite[]>();
  const add = (name: string, write: NameWrite): void => {
    const list = writes.get(name);
    if (list === undefined) writes.set(name, [write]);
    else if (list[list.length - 1].index !== write.index) list.push(write);
  };
  statements.forEach((statement, index) => {
    const valued = new Set(writtenNames(statement, raw[index]));
    const s = raw[index];
    if (s === undefined) {
      for (const n of valued)
        add(n, {
          index,
          kind: 'other',
          valued: true,
          type: undefined,
          static: false,
        });
      return;
    }
    if (isFunction(s, 'Assign')) {
      const targets = statementDeclaredNames(s);
      // The type of the value is the type of the target only when the
      // target is a single name, not a destructuring pattern.
      const type =
        targets.length === 1 && isSymbol(s.ops[0])
          ? closedLiteralType(ce, s.ops[1])
          : undefined;
      for (const n of targets)
        add(n, {
          index,
          kind: 'assign',
          valued: true,
          type,
          static: type !== undefined,
        });
      return;
    }
    const own = staticDeclarations(ce, [s]);
    // `writtenNames()` reads a plain `Declare` statement only: for another
    // form, whether the statement gives a value is not known, and a name
    // with no type then has no static picture.
    const known = operator(statement) === 'Declare';
    for (const n of own.declaredNames) {
      const type = own.declaredTypes.get(n);
      add(n, {
        index,
        kind: 'let',
        valued: valued.has(n),
        type,
        static: type !== undefined || (known && !valued.has(n)),
      });
    }
    for (const n of valued)
      if (!own.declaredNames.includes(n))
        add(n, {
          index,
          kind: 'other',
          valued: true,
          type: undefined,
          static: false,
        });
  });
  return writes;
}

/**
 * True when the preparation can box a function body that uses the variable
 * `name` with the binding that the body sees when its `function` statement
 * runs in order. `before` holds the statements before the `function`
 * statement that declare or write `name` (`statementWrites()`), and `scope`
 * is the program scope before any statement is prepared.
 *
 * With no such statement, the body sees the same binding on both routes.
 * Otherwise, all of these must hold:
 *
 * - `scope` does not bind `name`. A binding of an earlier program run on the
 *   same engine is replaced in order (a `let` declares the name again), but
 *   the preparation boxes the body against it: after `let c = "old"` in a
 *   first program, `let c = 2` then `function g() { c^2 }` in a second one
 *   boxed `c^2` against the string.
 * - Exactly one statement declares or writes `name`. With two, the binding
 *   that the body sees in order is the one the later statement leaves, and
 *   the preparation can only declare one type: after `let c = "old"` then
 *   `c = 2`, the preparation boxed `c^2` against the string.
 * - That statement gives `name` a static picture (`NameWrite.static`). The
 *   value of a `let` or an assignment with no static type is not known
 *   before the statement runs, and a use of the valueless variable in the
 *   body narrows its type: in `let value = {I -> 1, …}` then a body
 *   `value[String(c)]`, the use made `value` a string, and the `let` then
 *   gave it a dictionary, so the function was refused.
 */
function isSettledBefore(
  scope: ComputeEngine['context']['lexicalScope'],
  name: string,
  before: ReadonlyArray<NameWrite>
): boolean {
  if (before.length === 0) return true;
  return !scope.bindings.has(name) && before.length === 1 && before[0].static;
}

/**
 * The names that the `function` statement `statement`
 * (`["DefineFunction", name, ["Function", body, ...parameters]]`) binds for
 * its own body: the names of its parameters (each leaf of a destructuring
 * parameter), and the targets of the `let`/`const` statements of its body
 * block. A use of one of these names in the body does not read a variable
 * of the program.
 */
function functionLocalNames(statement: MathJsonExpression): Set<string> {
  const names = new Set<string>();
  const literal = operand(statement, 2);
  if (literal === null) return names;
  const leaves = (p: MathJsonExpression | null): void => {
    if (p === null) return;
    const head = operator(p);
    if (head === 'Tuple') for (const el of operands(p)) leaves(el);
    else if (head === 'Typed' || head === 'Spread') leaves(operand(p, 1));
    else {
      const name = symbol(p);
      if (name) names.add(name);
    }
  };
  for (const p of operands(literal).slice(1)) leaves(p);
  // The body, inside the return marker of a declared signature
  // (`["Typed", ["Block", …], "(x: T) -> T"]`) when there is one.
  let body = operand(literal, 1);
  if (body !== null && operator(body) === 'Typed') body = operand(body, 1);
  if (body !== null)
    for (const s of operator(body) === 'Block' ? operands(body) : [body])
      for (const n of declaredVariableNames(s)) names.add(n);
  return names;
}

/** The names that the MathJSON expression `expr` holds, as symbols or as
 * operators of applications, at any depth. */
function namesIn(expr: MathJsonExpression): Set<string> {
  const names = new Set<string>();
  const walk = (e: MathJsonExpression): void => {
    const name = symbol(e);
    if (name) names.add(name);
    const head = operator(e);
    if (head) names.add(head);
    for (const op of operands(e)) walk(op);
  };
  walk(expr);
  return names;
}

/**
 * The names to which the top-level statement `statement` gives a value: the
 * targets of an assignment, and the targets of a `let`/`const` with an
 * initial value (`["Declare", name, ["Dictionary", ["KeyValuePair", "value",
 * …]]]`, or a positional value after the type). `boxed` is the statement
 * boxed with `{ form: 'raw' }`, read for the targets of an assignment.
 */
function writtenNames(
  statement: MathJsonExpression,
  boxed: Expression | undefined
): string[] {
  const head = operator(statement);
  if (head === 'Assign')
    return boxed === undefined ? [] : statementDeclaredNames(boxed);
  if (head !== 'Declare') return [];
  const rest = operands(statement).slice(1);
  const hasValue = rest.some(
    (op, k) =>
      (k >= 1 && operator(op) !== 'Dictionary') ||
      (operator(op) === 'Dictionary' &&
        operands(op).some(
          (entry) =>
            operator(entry) === 'KeyValuePair' &&
            symbol(operand(entry, 1)) === 'value'
        ))
  );
  return hasValue ? declaredVariableNames(statement) : [];
}

export function errorFrameChain(error: MathJsonExpression): string {
  const ops = [...operands(error)];
  const trace = ops[ops.length - 1];
  if (trace === undefined || operator(trace) !== 'ErrorTrace') return '';
  const frames: string[] = [];
  for (const frame of operands(trace)) {
    if (operator(frame) === 'ErrorBroadcast') {
      const name = stringValue(operand(frame, 1));
      const index = machineValue(operand(frame, 2));
      const length = machineValue(operand(frame, 3));
      if (name === null || index === null || length === null) continue;
      frames.push(
        `while applying ${name} element-wise over ${length} element${
          length === 1 ? '' : 's'
        } (element ${index})`
      );
      continue;
    }
    if (operator(frame) !== 'ErrorFrame') continue;
    const name = stringValue(operand(frame, 1));
    const index = machineValue(operand(frame, 2));
    if (name === null || index === null) continue;
    // `Block` and `Function` frames are evaluation structure the engine
    // inserted (a lambda body, a statement block) — not calls the user
    // wrote — so they add no information a reader can act on.
    if (name === 'Block' || name === 'Function') continue;
    frames.push(`in ${name} argument ${index}`);
  }
  return frames.join(', ');
}

/**
 * Narrow a RUNTIME error's source anchor from the whole statement down to the
 * frame that produced it, using the error's own `ErrorTrace` breadcrumb — the
 * difference between underlining all of
 * `s |> Map(_ => Length(Characters(s)), _)` and underlining the `s` inside
 * `Characters(s)`. See `narrowToFrames()` for how a frame is matched onto the
 * source.
 */
function narrowErrorRange(
  ce: ComputeEngine,
  error: MathJsonExpression,
  stmt: MathJsonExpression,
  fallback: [number, number],
  boxedStmt?: Expression
): [number, number] {
  // The engine resolves the callee's declared parameter names so a NAMED
  // call's frame index (which counts declaration slots after the seam's
  // permutation) lands on the argument as WRITTEN — see `argumentAtSlot`
  // (error-location.ts). The seam's own normalization failures were never
  // permuted; their index counts written positions and is used directly.
  return narrowToFrames(
    traceFrames(error),
    stmt,
    fallback,
    calleeSlotNamesResolver(ce),
    frameOrderOf(errorCode(error)),
    canonicalOrderOf(ce, boxedStmt),
    offendingValue(error)
  );
}

/**
 * The canonical form `boxedStmt` of a statement as a `CanonicalOrder`
 * (error-location.ts), or `undefined` when it is not known.
 *
 * Canonicalization sorts the operands of a commutative call and flattens the
 * nested calls of an associative one, so the argument index of an error's
 * frame counts the operands of the CANONICAL call: in `Ln(w) * 2`, whose
 * canonical form is `2·Ln(w)`, the frame `Multiply argument 2` names
 * `Ln(w)`. Each canonical operand keeps the source range of the written
 * operand it was made from, which is how the frame is mapped back to the
 * source. The canonical call is found by its source range, which is the
 * range of the written call.
 */
function canonicalOrderOf(
  ce: ComputeEngine,
  boxedStmt: Expression | undefined
): CanonicalOrder | undefined {
  if (boxedStmt === undefined) return undefined;
  return {
    reorders: (operatorName) => {
      const def = ce.lookupDefinition(operatorName);
      if (def === undefined || !('operator' in def)) return false;
      return def.operator.commutative || def.operator.associative;
    },
    argumentOffsets: (operatorName, callRange, index) => {
      const pending: Expression[] = [boxedStmt];
      while (pending.length > 0) {
        const node = pending.pop()!;
        // The value of a `let` is in the `Dictionary` of its `Declare`.
        if (isDictionary(node)) pending.push(...node.values);
        if (!isFunction(node)) continue;
        const o = node.sourceOffsets;
        if (
          node.operator === operatorName &&
          o !== undefined &&
          o[0] === callRange[0] &&
          o[1] === callRange[1]
        ) {
          const op: Expression | undefined = node.ops[index - 1];
          if (op === undefined) return undefined;
          // A lazy operator such as `Add` or `Multiply` evaluates its
          // operands in its own handler. An error that the evaluation of an
          // operand makes reaches the frame through the RESULT of the
          // handler, whose operands can be in another order: the error of
          // `Sin(s)` in `Sin(s) * Cos(x)` has the frame `Multiply argument 2`.
          // Only an operand that is already an error in the canonical form
          // (`1 + "a"`) is then known.
          const def = ce.lookupDefinition(operatorName);
          if (
            def !== undefined &&
            'operator' in def &&
            def.operator.lazy &&
            op.isValid
          )
            return undefined;
          if (op.sourceOffsets !== undefined) return op.sourceOffsets;
          // A subtracted term `a - t` is `Negate(t)` in the canonical sum,
          // and an operand refused at canonicalization (`1 + "a"`) is
          // `Error(code, "a")`. Only `t` and `"a"` have a source range.
          if (op.operator === 'Negate' && isFunction(op))
            return op.op1.sourceOffsets;
          if (op.operator === 'Error' && isFunction(op))
            return op.ops[1]?.sourceOffsets;
          return undefined;
        }
        pending.push(...node.ops);
      }
      return undefined;
    },
  };
}

/**
 * The diagnostic for a statement whose value holds the error `error` and is
 * discarded: a non-final top-level statement, or a nested statement (see
 * {@link nestedStatementReporter}). A cap breach (`cancellation`, top level
 * only) is an `evaluation-canceled` diagnostic that carries the cause;
 * every other problem is a `runtime-error` diagnostic.
 *
 * `fallback` is the range of the statement; it is narrowed to the innermost
 * frame of the error's breadcrumb that maps onto the source.
 */
function errorValueDiagnostic(
  ce: ComputeEngine,
  error: Expression,
  stmt: MathJsonExpression,
  fallback: [number, number],
  defSites: ReturnType<typeof definitionSites>,
  cancellation?: CancellationCause,
  /** The canonical form of `stmt`, when it is known (see
   * {@link canonicalOrderOf}). */
  boxedStmt?: Expression
): ParsingDiagnostic {
  // An error that BUBBLED out of a subexpression carries a breadcrumb
  // of `(operator, operand index)` frames (engine design §2a). Rendered
  // compactly as `%1`, it recovers the context the bare error lost; the
  // statement range below supplies the source anchoring.
  const frames = errorFrameChain(error.json);
  const description = describeError(error.json);
  const range = narrowErrorRange(ce, error.json, stmt, fallback, boxedStmt);
  const diagnostic = makeDiagnostic(
    cancellation !== undefined
      ? ['evaluation-canceled', cancellation, error.toString()]
      : // `%2` (the frame chain) is `''` when the error was raised in
        // place, so `%3` — the machine-readable engine error code,
        // which keys extended docs (`epsil doc <code>`) — has a
        // stable position.
        ['runtime-error', description, frames, errorCode(error.json)],
    range
  );
  // A call that did not match its callee's signature gets the signature
  // and the callee's definition site as notes — the context the bare
  // "a required argument is missing" leaves the reader to hunt for.
  const notes = signatureNotes(ce, error.json, {
    definitionSites: defSites,
    primaryRange: range,
    boxedError: error,
  });
  if (notes.length > 0) diagnostic.notes = notes;
  return diagnostic;
}

/**
 * The object that identifies the failure of the error value `error`, so
 * that the same failure is reported once.
 *
 * When an error goes up through an operator or a call, it gets one more
 * frame in its breadcrumb, which makes a new `Error` node
 * (`withErrorFrames()`, `boxed-expression/error-value.ts`). The other
 * operands of the new node are the operands of the first one, the same
 * objects. So the first operand (the code or the message) identifies the
 * failure. For example, in `for x in [1, g("a"), 3] { s = s + x }`, the
 * failed cell is reported at the loop header (`nestedStatementReporter()`),
 * and the `Error` that the body then makes ends the loop and is the value of
 * the top-level statement. The two errors have different breadcrumbs, and
 * can point at different places, but have the same first operand.
 *
 * A first operand that is a symbol can be shared by different errors, so
 * the error itself is the key then.
 */
function failureKey(error: Expression): object {
  if (!isFunction(error) || error.nops === 0) return error;
  const first = error.op1;
  return isFunction(first) || isString(first) ? first : error;
}

/**
 * What happens to the value of a NESTED statement: a statement of a
 * `Block` (a function body, a loop body, an `if` branch, a `do` block)
 * that is written in the source.
 *
 * - `discarded`: nothing reads the value. This is a statement that is not
 *   the last one of its block (the block continues with the next
 *   statement), or the last statement of a loop body (a loop runs for
 *   effect, and starts the next iteration). The body of a `while let` loop
 *   is a loop body too. The collection of a loop or comprehension header
 *   (`[1, g("a"), 3]` in `for x in [1, g("a"), 3] { … }`) is `discarded`
 *   too: the loop reads its cells, but no statement holds the value.
 * - `returned`: the last statement of a function body. The value is the
 *   value of the call, and the expression that made the call reads it.
 * - `passed`: the last statement of any other block, for example an `if`
 *   branch. The value is the value of the block, so it becomes the value of
 *   the enclosing statement (the `if`), and that statement decides.
 */
type NestedStatementRole = 'discarded' | 'returned' | 'passed';

type NestedStatementSite = {
  stmt: MathJsonExpression;
  range: [number, number];
  role: NestedStatementRole;
};

/**
 * Every nested statement of the program that carries a source range, keyed
 * by that range (`"start:end"`), with its role. Two statements with the
 * same range map to `null`: the key does not tell them apart, so neither is
 * reported.
 *
 * Read from the RAW tree, because the evaluated statements keep only their
 * source range, not their place in the program.
 */
function nestedStatementSites(
  statements: ReadonlyArray<MathJsonExpression>
): Map<string, NestedStatementSite | null> {
  const sites = new Map<string, NestedStatementSite | null>();
  // `parent` is the operator of the node that holds `node`, and `index` the
  // place of `node` among its operands (0 for the first). `loopBody` is true
  // when the value of `node` is the value of one iteration of a loop, which
  // the loop discards.
  const visit = (
    node: MathJsonExpression,
    parent: string,
    index: number,
    loopBody: boolean
  ): void => {
    const ops = operands(node);
    const head = operator(node);
    // The collection of a loop or comprehension header,
    // `Loop(body, Element(x, coll))` or `Comprehension(body, Element(x,
    // coll))`. No statement holds its value, so a failed cell in it is
    // reported here, also when the body does not use the index. A header
    // that is a variable (`for x in xs`) is not a site: the value of the
    // variable was made by an earlier statement, which reports it.
    if (
      head === 'Element' &&
      (parent === 'Loop' || parent === 'Comprehension') &&
      index > 0
    ) {
      const coll = ops[1];
      const range = coll === undefined ? undefined : sourceOffsetsOf(coll);
      if (coll !== undefined && range !== undefined && symbol(coll) === null) {
        const key = `${range[0]}:${range[1]}`;
        sites.set(
          key,
          sites.has(key) ? null : { stmt: coll, range, role: 'discarded' }
        );
      }
    }
    if (head === 'Block') {
      ops.forEach((stmt, j) => {
        const range = sourceOffsetsOf(stmt);
        if (range === undefined) return;
        // The body of a function literal is the FIRST operand of
        // `Function`.
        const role: NestedStatementRole =
          j < ops.length - 1 || loopBody
            ? 'discarded'
            : parent === 'Function' && index === 0
              ? 'returned'
              : 'passed';
        const key = `${range[0]}:${range[1]}`;
        sites.set(key, sites.has(key) ? null : { stmt, range, role });
      });
    }
    ops.forEach((op, j) => {
      // The body of a loop is the FIRST operand of `Loop`. A `while let`
      // loop is a `Loop` whose body is a `Match`
      // (`Loop(Match(subject, MatchCase(pattern, guard, body),
      // MatchCase(_, Break)))`): the value of the `Match` is the value of
      // the case that matched, the last operand of a `MatchCase`, so the
      // loop discards the value of that case body too. No statement holds
      // the `Match` there, so the body's last statement is marked
      // `discarded` itself.
      const opLoopBody =
        head === 'Loop'
          ? j === 0
          : head === 'Match'
            ? loopBody && j > 0
            : head === 'MatchCase'
              ? loopBody && j === ops.length - 1
              : false;
      visit(op, head, j, opLoopBody);
    });
  };
  for (const stmt of statements) visit(stmt, '', 0, false);
  return sites;
}

/**
 * The error that a `Map` or `Filter` view `value` gives when it is read,
 * because a cell of its source literal fails, or `undefined`.
 *
 * Such a view is lazy: it keeps its source unevaluated, and a cell of the
 * source is evaluated only when the view is read. So the value of
 * `let ys = map((u) => u, [1, g("a"), 3])` holds no error (`isValid` is
 * `true`), although each read of `ys` gives the error at the second element.
 * A callback applied to a failed cell gives that error, and a `Filter` keeps
 * the error of its predicate in place, so a failed cell of the source is a
 * failed element of the view, whatever the callback is.
 *
 * Bounded, and without effects: only the unary `Map` and `Filter`, only a
 * source that is a `List` or `Set` literal, and only a cell that is a pure
 * call is evaluated. The callback is not applied. A cell that evaluates to a
 * collection holding a failed cell (`[1, g("a")]`) is not a failed element:
 * the callback receives that inner list as a value. The hook of the nested
 * statements is removed during the evaluation, so that nothing it evaluates
 * is reported as a statement of the program. An exception is ignored, as
 * the check is advisory, except a cancellation that ends the program (see
 * the `catch` clause).
 *
 * The result is not cached. A loop makes a new view at each turn, and a
 * cell can read a variable that the loop changes (`g(m)`, or a function
 * that reads `m`), so a check that found nothing at one turn does not tell
 * about the next turn.
 */
function lazyViewCellError(
  ce: ComputeEngine,
  value: Expression
): Expression | undefined {
  const source = isFunction(value, 'Map')
    ? value.nops === 2
      ? value.op2
      : undefined
    : isFunction(value, 'Filter')
      ? value.op1
      : undefined;
  if (!isFunction(source, 'List') && !isFunction(source, 'Set'))
    return undefined;
  const hook = ce._epsilStatementResultHook;
  ce._epsilStatementResultHook = undefined;
  try {
    for (const cell of source.ops) {
      if (!isFunction(cell) || !cell.isPure) continue;
      const cellValue = cell.evaluate();
      if (!cellValue.isValid && !cellValue.isCollection)
        return cellValue.errors[0];
    }
  } catch (e) {
    // The time budget and the step budget belong to the whole program: when
    // the check spends them, the program must stop, as it does when a
    // statement spends them. A limit of one construct (the iteration or the
    // recursion limit) is a failure of the cell, which the program gets
    // only if it reads the view, so the check ignores it.
    const cause = cancellationCause(e);
    if (cause === 'timeout' || cause === 'step-budget') throw e;
    return undefined;
  } finally {
    ce._epsilStatementResultHook = hook;
  }
  return undefined;
}

/**
 * True when the evaluated statement `boxed` is plausibly the raw statement
 * `raw`: the same operator and, for an assignment or a declaration, the
 * same target name.
 *
 * The source range alone does not identify a statement of THIS program: a
 * function that an earlier program declared on the same engine (an earlier
 * notebook cell) runs its body statements here too, and their ranges index
 * the earlier source. Such a statement can have the same range as a
 * statement of this program; this check rejects most of these. A statement
 * whose operator canonicalization changes (`a - b` becomes `Add`) is
 * rejected too, and is then not reported.
 */
function isSameStatement(boxed: Expression, raw: MathJsonExpression): boolean {
  const name = symbol(raw);
  if (name !== null) return isSymbol(boxed) && boxed.symbol === name;
  const head = operator(raw);
  if (head === '' || boxed.operator !== head) return false;
  if (head !== 'Assign' && head !== 'Declare') return true;
  const target = symbol(operand(raw, 1));
  if (target === null) return true;
  const written = isFunction(boxed) ? boxed.op1 : undefined;
  return isSymbol(written) && written.symbol === target;
}

/**
 * The hook `executeEpsil` installs on the engine
 * (`_epsilStatementResultHook`) for its evaluation loop. The engine calls it
 * after each nested statement written in the source evaluates.
 *
 * A top-level statement whose value is discarded (any statement but the
 * last) and holds an error is reported by the loop of `executeEpsilSteps`.
 * The same problem in a nested statement would vanish too: a loop or a
 * block stops only on a value whose operator is `Error`, and a value that
 * only HOLDS an error (a list built in a loop with one failed cell,
 * `[...fs, g("a")]`) is an ordinary value. The cell stays in the value (a
 * collection keeps a failed cell, `docs/ERROR-MODEL.md` §3), so this hook
 * reports it, and changes nothing that the program computes.
 *
 * Which statements report: a nested statement whose value is DISCARDED
 * (see {@link NestedStatementRole}) and holds at least one error
 * (`value.errors`, as for a top-level statement). A value whose operator is
 * `Error`, `Return`, `Break` or `Continue` is never discarded: it ends the
 * block and becomes its value, so the enclosing statement deals with it.
 *
 * Where the report goes: the range of the statement, narrowed by the
 * error's breadcrumb as at the top level. When the value was PASSED up from
 * the last statement of an inner block (the branch of an `if` that is the
 * last statement of a loop body), the report goes to that inner statement,
 * which is where the value was made. The value is matched by identity: a
 * block and an `if` return the value of their statement unchanged. A value
 * returned from a function body is not followed into the function.
 *
 * How often: once per source range. A loop body or a function body runs
 * its statements many times, and a problem in one of them is one problem.
 * The first report of a range is kept. Also once per failure
 * (`failureKey()`): a failed cell of a loop header is reported at the
 * header, and not again at a statement of the body that holds it. The
 * failures reported are added to `failures`, which the caller clears at
 * each top-level statement.
 */
function nestedStatementReporter(
  ce: ComputeEngine,
  statements: ReadonlyArray<MathJsonExpression>,
  defSites: ReturnType<typeof definitionSites>,
  diagnostics: ParsingDiagnostic[],
  failures: Set<object>
): (statement: Expression, result: Expression) => void {
  const sites = nestedStatementSites(statements);
  const reported = new Set<string>();
  // The site where a value passed up from an inner block was made, with the
  // canonical form of its statement.
  const madeAt = new WeakMap<
    Expression,
    { site: NestedStatementSite; statement: Expression }
  >();
  const hook = (statement: Expression, result: Expression): void => {
    // `isValid` is false exactly when the value holds an `Error`, and it is
    // memoized on each node, so this test does not walk a list again on
    // each iteration of the loop that grows it. A valid `Map` or `Filter`
    // view can still give an error when it is read, because a cell of its
    // source fails (`lazyViewCellError`), so it is examined too.
    const head = result.operator;
    const lazyView = result.isValid && (head === 'Map' || head === 'Filter');
    if (result.isValid && !lazyView) return;
    if (
      head === 'Error' ||
      head === 'Return' ||
      head === 'Break' ||
      head === 'Continue'
    )
      return;
    const offsets = statement.sourceOffsets;
    if (offsets === undefined) return;
    const key = `${offsets[0]}:${offsets[1]}`;
    const site = sites.get(key);
    if (site === undefined || site === null) return;
    if (!isSameStatement(statement, site.stmt)) return;
    if (site.role === 'returned') return;
    if (site.role === 'passed') {
      // The innermost statement that made the value is recorded first.
      if (!madeAt.has(result)) madeAt.set(result, { site, statement });
      return;
    }
    const made = madeAt.get(result);
    const origin = made?.site ?? site;
    const originKey = `${origin.range[0]}:${origin.range[1]}`;
    if (reported.has(originKey)) return;
    const lazyError = lazyView ? lazyViewCellError(ce, result) : undefined;
    if (lazyView && lazyError === undefined) return;
    reported.add(originKey);
    // Building the diagnostic reads definitions and serializes the error;
    // the hook is removed while it runs, so that nothing it evaluates is
    // reported as a statement of the program.
    ce._epsilStatementResultHook = undefined;
    try {
      // `errors` walks the value by recursion, so a deeply nested value can
      // overflow the stack. (A list that grows in a loop by `[...fs, x]`
      // stays one flat list, also with a failed cell: `canonicalJoin()`
      // splices a `ListJoin` operand. A value nested in other ways still can
      // be deep.)
      const errors = lazyError !== undefined ? [lazyError] : result.errors;
      if (
        errors.length > 0 &&
        !failures.has(failureKey(errors[0])) &&
        !reportedAsReadBeforeDeclaration(errors[0], diagnostics)
      ) {
        failures.add(failureKey(errors[0]));
        diagnostics.push(
          errorValueDiagnostic(
            ce,
            errors[0],
            origin.stmt,
            origin.range,
            defSites,
            undefined,
            made?.statement ?? statement
          )
        );
      }
    } catch (e) {
      // A report is advisory: a failure while it is built must not become
      // the value of the statement, which is what an exception thrown into
      // the engine here would do. A cap breach (the host's time budget) is
      // not a failure of the report, and goes on.
      if (cancellationCause(e) !== undefined) throw e;
    } finally {
      ce._epsilStatementResultHook = hook;
    }
  };
  return hook;
}

/**
 * Report a protocol PROPERTY member called as a function — `area(c)` where the
 * protocol declares `readonly area: number`.
 *
 * The two member kinds are spelled differently: a `function` member is invoked
 * in call position (`span(b)`), a property is read with a dot (`b.area`). The
 * call form of a property resolves to no operator, so it stays a silently inert
 * application — the program prints `area(Circle(…))` and nothing says why.
 *
 * Walks the RAW statement AST rather than the evaluated value that
 * {@link scanUnknownFunctions} walks, for two reasons: an inert application
 * consumed by an operator never reaches the result at all (`print(c, area(c))`
 * evaluates to `Nothing`, which is the shape this was reported on), and the raw
 * tree still carries `sourceOffsets`, so the warning underlines `area(c)`
 * instead of the whole statement.
 *
 * Reports only a head that names NOTHING ELSE. A protocol member name is not
 * reserved, so a program may legitimately bind it and call the binding, and
 * every such spelling must stay silent:
 *  - `let area = x => x + 1` installs a VALUE definition holding a lambda,
 *    which `operatorInfo` alone does NOT see, so checking only the operator
 *    table reported `area(3)` — valid code that evaluates to `4`. The test is
 *    on that definition's TYPE (`matches('function')`), not on its mere
 *    existence: boxing `area(c)` auto-declares `area` as a free symbol typed
 *    `unknown`, and since this scan runs after the statement evaluated, a
 *    presence check suppressed the very case the warning exists for;
 *  - a PARAMETER (`function g(area) { area(1) }`, `xs |> Map(_, area => …)`)
 *    is bound only inside its own body, so it exists in no table at all while
 *    this scan runs; `bound` carries the enclosing binders' names down instead.
 */
function scanProtocolPropertyCalls(
  ce: ComputeEngine,
  expr: MathJsonExpression,
  reported: Set<string>,
  diagnostics: ParsingDiagnostic[],
  stmt: MathJsonExpression,
  source: string,
  /** Names bound by function literals enclosing `expr`. */
  bound: ReadonlySet<string> = new Set()
): void {
  const head = operator(expr);
  if (head === '') return; // Not a function application (number/symbol/string).

  if (
    !reported.has(head) &&
    !bound.has(head) &&
    ce.operatorInfo(head) === undefined &&
    !bindsACallable(ce, head)
  ) {
    const protocolName = protocolPropertyNamed(ce, head);
    if (protocolName !== undefined) {
      // Added only on an actual report, so a head this scan passes over is
      // still fresh for `scanUnknownFunctions`.
      reported.add(head);
      diagnostics.push({
        severity: 'warning',
        message: ['protocol-property-not-callable', head, protocolName],
        // The application's own span when the parser recorded one, so the
        // squiggle sits on `area(c)`; the statement otherwise. Read directly
        // rather than through `statementRange`, whose own fallback is the
        // WHOLE PROGRAM — for a subexpression that is worse than the statement.
        range: sourceOffsetsOf(expr) ?? statementRange(stmt, source),
      });
    }
  }

  // A function literal is `["Function", body, ...parameters]`, so everything
  // after the body binds names over that body. Collected with a full symbol
  // walk rather than by reading each operand as a plain name, so a
  // destructuring or annotated parameter contributes its names too:
  // over-collecting only makes the scan quieter, which is the safe direction
  // for an advisory warning.
  const inner = head === 'Function' ? withBoundParameters(expr, bound) : bound;

  for (const op of operands(expr))
    scanProtocolPropertyCalls(
      ce,
      op,
      reported,
      diagnostics,
      stmt,
      source,
      inner
    );
}

/**
 * Does `name` have a value definition that could be CALLED — a lambda stored
 * under a `let`, say?
 *
 * Deliberately asks about the definition's type rather than its existence:
 * evaluating an application auto-declares its head as a free symbol typed
 * `unknown`, so by the time this scan runs every head it looks at HAS a
 * definition. `unknown` is the top of the value types and is not a subtype of
 * `function`, so an auto-declared name answers `false` here while a genuine
 * function binding answers `true`.
 */
function bindsACallable(ce: ComputeEngine, name: string): boolean {
  const def = ce.lookupDefinition(name);
  if (def === undefined) return false;
  // A definition is tagged either as a value or as an operator. An OPERATOR
  // definition is callable by construction — `operatorInfo` catches those
  // first, so this arm is only reached for a shape it does not report on.
  if (!('value' in def)) return true;
  return def.value.type.matches('function');
}

/** `bound` extended with every symbol appearing in a function literal's
 * PARAMETER operands (everything after the body). */
function withBoundParameters(
  literal: MathJsonExpression,
  bound: ReadonlySet<string>
): ReadonlySet<string> {
  const names = new Set(bound);
  const params = [...operands(literal)].slice(1);
  const collect = (e: MathJsonExpression): void => {
    const name = symbol(e);
    if (name !== null && name !== undefined) names.add(name);
    for (const op of operands(e)) collect(op);
  };
  for (const p of params) collect(p);
  return names;
}

/** One `type X is P` statement of this batch, as the pending-warning lookup
 * needs to see it. `clause` is the verbatim `where …` text when the
 * conformance is CONDITIONAL, `undefined` otherwise. */
type ConformanceSite = {
  target: string;
  protocol: string;
  clause: string | undefined;
  range: [number, number];
};

/**
 * Every `type X is P` statement in this batch — so a pending edge can be
 * reported on the line that declared it instead of on the whole program.
 *
 * The shape is `["DeclareConformance", {str: target}, ["List", ...protocols],
 * {str: whereClause}?]`: the target is a type SPELLING as a string, the
 * protocol names are symbols, and a CONDITIONAL conformance carries its
 * `where` clause as a third operand. One statement can name several protocols
 * (`type X is P, Q`), each a separate edge that can be pending on its own, so
 * every name in the list yields its own site at the same range.
 */
function conformanceStatementSites(
  statements: MathJsonExpression[],
  source: string
): ConformanceSite[] {
  const sites: ConformanceSite[] = [];
  for (const stmt of statements) {
    if (operator(stmt) !== 'DeclareConformance') continue;
    const target = stringValue(operand(stmt, 1)) ?? symbol(operand(stmt, 1));
    if (target === null || target === undefined) continue;
    const raw = stringValue(operand(stmt, 3));
    const clause = raw === null || raw === '' ? undefined : raw;
    const range = statementRange(stmt, source);
    for (const p of operands(operand(stmt, 2) ?? 'Nothing')) {
      const protocol = symbol(p) ?? stringValue(p);
      if (protocol !== null && protocol !== undefined)
        sites.push({ target, protocol, clause, range });
    }
  }
  return sites;
}

/**
 * The statement range for a pending edge, or `undefined` when this batch does
 * not contain its declaration (the notebook pattern declares in one cell and
 * implements in a later one, so the registry outlives the batch).
 *
 * Matched STRUCTURALLY rather than by rebuilding the registry's key, because
 * the two spellings are produced by different code from different inputs: the
 * registry composes a conditional edge's `targetKey` as
 * `<target> where <clause>` from PARSED type parameters, with its own
 * canonical spacing, while a statement carries the author's verbatim text —
 * `where T:number is Comparable` reaches the registry as
 * `where T: number is Comparable`, and a string comparison of the two misses.
 * So a conditional statement claims any key that begins `<target> where ` and
 * an unconditional one claims the bare `<target>`, which is spelling-proof in
 * the clause.
 *
 * An ambiguous match — two conditional statements in one batch for the same
 * target and protocol, differing only in their clauses — resolves to nothing
 * rather than to a guess, and falls back to the whole program.
 */
function conformanceSiteRange(
  sites: ConformanceSite[],
  targetKey: string,
  protocol: string
): [number, number] | undefined {
  const matches = sites.filter(
    (site) =>
      site.protocol === protocol &&
      (site.clause === undefined
        ? targetKey === site.target
        : targetKey.startsWith(`${site.target} where `))
  );
  return matches.length === 1 ? matches[0].range : undefined;
}

/**
 * The name of a protocol declaring `member` as a PROPERTY requirement
 * (`readonly`/`readwrite`), or `undefined` when no protocol does.
 *
 * `function` members are deliberately excluded: they are invoked exactly as
 * written in call position (`span(b)`), so a function member's name as a call
 * head is correct, not a mistake. Only the property kind has a different
 * spelling (`b.area`) to point the author at.
 *
 * First match wins. Two protocols can require a property of the same name, and
 * which one the author meant is not knowable here — but the advice the message
 * gives (use a dot) is the same either way, and the protocol name only serves
 * to say where the requirement came from.
 */
function protocolPropertyNamed(
  ce: ComputeEngine,
  member: string
): string | undefined {
  for (const protocol of Object.values(ce._protocolRegistry)) {
    const kind = protocol.members[member]?.kind;
    if (kind === 'readonly' || kind === 'readwrite') return protocol.name;
  }
  return undefined;
}

/** The source span the parser recorded on `expr`, or `undefined` when it
 * carries none. Callers pick their own fallback: the whole program is right for
 * a STATEMENT ({@link statementRange}) and wrong for a subexpression, which
 * should fall back to its statement instead. */
function sourceOffsetsOf(
  expr: MathJsonExpression
): [number, number] | undefined {
  return typeof expr === 'object' && expr !== null && !Array.isArray(expr)
    ? (expr as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}

/** The source range of a statement AST node, falling back to the whole
 * program when the node carries no offsets. */
function statementRange(
  stmt: MathJsonExpression,
  source: string
): [number, number] {
  return sourceOffsetsOf(stmt) ?? [0, source.length];
}

// Unresolved print-like names that get a did-you-mean toward the real
// `print` (the Epsil spelling of `Print`, resolved by `resolveLibraryNames`
// before this scan runs, and deliberately NOT in this set: a user binding
// that shadows it -- `let print` -- must not produce the self-contradictory
// "no print; did you mean print?").
const PRINT_LIKE = new Set(['println', 'printf', 'puts', 'echo']);

/**
 * Warn when a `Function` literal's parameter is named after an engine
 * CONSTANT: in `f(Pi) = Pi + 1` (or `Pi => Pi + 1`) the parameter binds a
 * fresh variable named `Pi` — the body's `Pi` is the argument, not π — the
 * same shadowing convention as match-pattern bindings. That is almost never
 * what the author meant when the name is a multi-character constant
 * reference (`Pi`, `GoldenRatio`, `ExponentialE`), so those warn.
 *
 * Single-character names (`e`, `i`, `x`) are the universal variable
 * namespace — `f(i) = i + 1` is an ordinary function of `i` — and stay
 * quiet, even though `e` and `i` are engine constants too. (`Infinity` and
 * `NaN` never reach this scan: they are numeric literals, and in parameter
 * position they are literal parameters, not names.)
 *
 * Only SYSTEM-scope (builtin) constants count: a `const Radius = 10` the
 * user declared in an earlier statement or cell is an ordinary binding —
 * shadowing it with a parameter is unremarkable, and warning would
 * misleadingly paint it as π-like. The system scope is the bottom of the
 * context stack, the same identification the engine's own
 * builtin-shadowing rules use.
 *
 * Advisory only — the parse and the semantics are unchanged.
 */
function scanConstantShadowingParams(
  ce: ComputeEngine,
  expr: MathJsonExpression,
  reported: Set<string>,
  diagnostics: ParsingDiagnostic[],
  stmt: MathJsonExpression,
  source: string
): void {
  if (operator(expr) === 'Function') {
    for (const p of operands(expr).slice(1)) {
      const name =
        symbol(p) ?? (operator(p) === 'Typed' ? symbol(operand(p, 1)) : null);
      if (name === null || name.length <= 1) continue;
      if (reported.has(name) || isLiteralParamName(name)) continue;
      const def = ce.lookupDefinition(name);
      const systemScope = ce.contextStack[0]?.lexicalScope;
      if (
        def !== undefined &&
        systemScope !== undefined &&
        systemScope.bindings.get(name) === def &&
        'value' in def &&
        def.value?.isConstant === true
      ) {
        reported.add(name);
        diagnostics.push({
          severity: 'warning',
          message: ['parameter-shadows-constant', name],
          range: statementRange(stmt, source),
        });
      }
    }
  }
  for (const op of operands(expr))
    scanConstantShadowingParams(ce, op, reported, diagnostics, stmt, source);
}

/**
 * Walk a result expression (in MathJSON form) for function applications whose
 * head is a symbol that is **not** a known operator (`ce.operatorInfo` is
 * `undefined` — an inert unknown call survives evaluation as itself, and
 * declared functions/params do not). For each such name, once per program run,
 * emit a `warning` diagnostic suggesting a close known operator — but only when
 * a suggestion exists (an intentionally symbolic `f(x)` with no near match is
 * never nagged).
 *
 * Two names get a dedicated diagnostic instead of the did-you-mean path: a
 * print-like name, and a name that is a DECLARED TYPE (`type-not-callable`).
 */
function scanUnknownFunctions(
  ce: ComputeEngine,
  expr: MathJsonExpression,
  reported: Set<string>,
  diagnostics: ParsingDiagnostic[],
  stmt: MathJsonExpression,
  source: string
): void {
  const head = operator(expr);
  if (head === '') return; // Not a function application (number/symbol/string).

  if (!reported.has(head) && ce.operatorInfo(head) === undefined) {
    reported.add(head);
    if (ce._typeResolver.resolve(head) !== undefined) {
      // A DECLARED TYPE name in call position: `type alias pt = tuple<…>`
      // followed by `pt(1, 2)`. Without this, the call stays a silent inert
      // application `["pt", 1, 2]` that looks like a working constructor —
      // untyped, unchecked and unrelated to the type (nominal-types design
      // §4.1b). The did-you-mean path never covers it (there is no close
      // known operator to suggest).
      //
      // The check keys on "no operator definition exists", so when a nominal
      // declaration starts minting a value-level constructor operator, the
      // call resolves like any other and this branch stops firing on its own —
      // no name table to retire.
      diagnostics.push({
        severity: 'warning',
        message: ['type-not-callable', head],
        range: statementRange(stmt, source),
      });
    } else if (PRINT_LIKE.has(head.toLowerCase())) {
      // A print-like name deserves better than a fuzzy suggestion: the one
      // that exists is `print` (since the Print/Input feature), so an
      // unresolved `puts`/`echo`/`println` points there.
      diagnostics.push({
        severity: 'warning',
        message: ['print-not-available', head],
        range: statementRange(stmt, source),
      });
    } else {
      const suggestion = ce.suggestOperatorName(head);
      // The engine suggests the library name; the author reads Epsil, so the
      // suggestion is its Epsil spelling when it has one (`sinn` → `sin`, not
      // `Sin`). A head that IS that spelling and still did not resolve was
      // written on purpose — the verbatim `` `sin` `` names the raw symbol —
      // and "no sin; did you mean sin?" would contradict itself.
      const spelled =
        suggestion === undefined
          ? undefined
          : (epsilNameOf(suggestion) ?? suggestion);
      if (spelled !== undefined && spelled !== head) {
        diagnostics.push({
          severity: 'warning',
          message: ['unknown-function', head, spelled],
          range: statementRange(stmt, source),
        });
      }
    }
  }

  for (const op of operands(expr))
    scanUnknownFunctions(ce, op, reported, diagnostics, stmt, source);
}

/**
 * If `e` is a `CancellationError` carrying a recognized machine-readable
 * `cause` (a cap breach: timeout / iteration / recursion), return that cause;
 * otherwise `undefined`.
 *
 * Detection is by `name` rather than `instanceof` so it survives a re-bundled
 * `CancellationError` crossing a plugin/host boundary (see the cross-bundle
 * identity hazard in CLAUDE.md).
 */
function cancellationCause(e: unknown): CancellationCause | undefined {
  if (!(e instanceof Error) || e.name !== 'CancellationError') return undefined;
  const cause = (e as { cause?: unknown }).cause;
  if (
    cause === 'timeout' ||
    cause === 'step-budget' ||
    cause === 'iteration-limit-exceeded' ||
    cause === 'recursion-depth-exceeded'
  )
    return cause;
  return undefined;
}

/** The name of the constant when `e` is the error that the engine throws
 * for an assignment to a constant (`ConstantAssignmentError`), else
 * `undefined`. The class is checked by name, since an `instanceof` fails
 * across bundle boundaries. */
function constantAssignmentName(e: unknown): string | undefined {
  if (!(e instanceof Error) || e.name !== 'ConstantAssignmentError')
    return undefined;
  const name = (e as { constantName?: unknown }).constantName;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Whether `error` is a `read-before-declaration` error value that the
 * static check already reported: a use of a local before it has a value (a
 * read, a call, the collection of a `for` loop). The static check reports
 * it as a `static-type-error` with the engine code
 * `read-before-declaration`, at the range of the use. The engine keeps the
 * range of the use on the error (`readBeforeDeclarationSite()`). The two
 * are the same problem when the ranges are the same and the descriptions
 * are the same (the same name, and the same kind of local), and the run
 * does not report it a second time.
 */
function reportedAsReadBeforeDeclaration(
  error: Expression,
  diagnostics: ReadonlyArray<ParsingDiagnostic>
): boolean {
  const site = readBeforeDeclarationSite(error);
  if (site === undefined) return false;
  const description = describeError(error.json);
  return diagnostics.some(
    (d) =>
      Array.isArray(d.message) &&
      d.message[0] === 'static-type-error' &&
      d.message[3] === 'read-before-declaration' &&
      d.message[1] === description &&
      d.range[0] === site[0] &&
      d.range[1] === site[1]
  );
}

/** The source range of the `Assign` node that made the write, when `e` is
 * the error that the engine throws for an assignment to a constant and the
 * node has source offsets, else `undefined` (see
 * `ConstantAssignmentError.sourceOffsets`). */
function constantAssignmentSite(e: unknown): [number, number] | undefined {
  if (constantAssignmentName(e) === undefined) return undefined;
  const site = (e as { sourceOffsets?: unknown }).sourceOffsets;
  return Array.isArray(site) &&
    site.length === 2 &&
    typeof site[0] === 'number' &&
    typeof site[1] === 'number'
    ? [site[0], site[1]]
    : undefined;
}

/** Build an execution-phase diagnostic. */
function makeDiagnostic(
  message: ParsingDiagnostic['message'],
  range: [number, number]
): ParsingDiagnostic {
  return { severity: 'error', message, range };
}
