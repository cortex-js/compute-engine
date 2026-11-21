import type { MathJsonExpression } from '../math-json/types.js';
import { UnitEnvironment } from '../compute-engine/binding-unit.js';
import { nextProgramBatchId } from '../compute-engine/statement-position.js';
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
  frameOnClock,
  isTimeoutCancellation,
  makePauseClock,
  type CancellationCause,
} from '../common/interruptible.js';

// Type-only imports: `src/epsil` never statically imports the engine, so this
// adds no runtime dependency (and no `compute-engine` cycle — the engine never
// imports `epsil`). The engine is injected at call time, mirroring the
// `parseLatex`/`ILatexSyntax` injection pattern used elsewhere in `src/epsil`.
import type { Expression, ComputeEngine } from '../compute-engine.js';
import type { EpsilDebugHooks } from '../compute-engine/types-debug.js';
import {
  isDebugHookFailure,
  noteStatementSources,
} from '../common/debug-hook.js';
import { isBindingStatement } from '../compute-engine/function-utils.js';

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
import { isDeclarationTypeErrorValue } from '../compute-engine/boxed-expression/type-compatibility-error.js';
import { listedElement } from '../compute-engine/boxed-expression/listed-element.js';
import { protocolExtendsConflicts } from '../compute-engine/engine-protocols.js';
import { isValueDef } from '../compute-engine/boxed-expression/definition-guards.js';
import {
  programSourceOrder,
  programInterruption,
} from '../compute-engine/library/control-structures.js';
import { parseEpsil } from './parse-epsil.js';
import { resolveLibraryNames } from './resolve-library-names.js';
import { canonicalLibraryName, epsilNameOf } from './library-names.js';
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
  describeError,
  errorCode,
  frameOrderOf,
  staticDiagnostics,
} from './static-diagnostics.js';

export interface ExecuteEpsilOptions {
  /** Source URL (for `#url`/`#filename` pragmas and diagnostic origins). */
  url?: string;
  /** Injected LaTeX parser for `$…$` islands (a structural mirror of the
   * engine's `ILatexSyntax` injection). */
  parseLatex?: (latex: string) => MathJsonExpression;
  /** Opt into the host-state pragmas `#env`/`#navigator` (default `false`). */
  allowHostPragmas?: boolean;
  /** Called after each top-level statement, with its source index and range. */
  onStatement?: (statement: {
    index: number;
    expression: Expression;
    value: Expression;
    range: [number, number];
  }) => void;
  /** Independent time limit for each statement, in milliseconds. When the
   * value of the program is a lazy collection, its elements are computed
   * after the last statement, in a second span of the same limit: the last
   * statement and its elements can take up to twice the limit together. */
  statementTimeLimitMs?: number;
}

export interface ExecuteEpsilAsyncOptions extends ExecuteEpsilOptions {
  /** An abort of this signal stops the program: the promise of
   * `executeEpsilAsync` rejects with a `CancellationError` whose `cause` is
   * the signal's reason, as every asynchronous evaluation of the engine
   * does. The signal is given to the `evaluateAsync()` of each statement
   * and read again between two statements. */
  signal?: AbortSignal;
  /** Hooks with which a debugger follows the run: they are called before
   * and after each statement of the source that the run evaluates on the
   * asynchronous route, and the run waits while a hook's promise is
   * pending. See `EpsilDebugHooks` for the statements that call them. */
  debug?: EpsilDebugHooks;
}

export interface ExecuteEpsilResult {
  /** The value of the last executed statement (or `Nothing`). Runtime problems
   * surface here as `["Error", …]` values, never as thrown exceptions.
   *
   * When the last statement gives a finite lazy collection (`map(…)`,
   * `filter(…)`, `take(…)`, a comprehension), the value is the list, the
   * set or the dictionary of its elements, so `json` and `latex` show the
   * elements: `map(u => u + 1, [5, 6])` gives `["List", 6, 7]`, not the
   * `Map` expression. These collections stay as they are: a range (`1..4`),
   * a collection with no last element, a collection with more than
   * `ce.maxCollectionSize` elements, a collection whose function applies an
   * operator that has only an asynchronous handler, a collection whose
   * function has an effect when no bound on the number of its elements is
   * known before they are computed, and a collection whose elements cannot
   * be computed. */
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
export function sumVariantNames(ce: ComputeEngine): Record<string, string> {
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

/** A new batch id, for a run of `executeEpsil` or a check by `checkEpsil`. */
export function nextEpsilBatchId(): number {
  return nextProgramBatchId();
}

export function executeEpsil(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteEpsilOptions
): ExecuteEpsilResult {
  // The run has one program
  // environment (rule 10 of
  // `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): each statement
  // is boxed in it, and its evaluation by this driver writes in it, so a
  // later statement reads what an earlier one required.
  return ce._withProgramEnvironment(() => {
    const steps = executeEpsilRun(ce, source, options);
    let step = steps.next();
    while (!step.done) {
      // An exception of `evaluate()` goes back into the run, at the
      // statement that yielded: its `catch` makes the error the value of the
      // statement.
      let value: Expression;
      try {
        const stmt = step.value;
        value = ce._boxingState.asProgramStatement(() => stmt.evaluate());
      } catch (e) {
        step = steps.throw(e);
        continue;
      }
      step = steps.next(value);
    }
    return step.value;
  });
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
  const hostFrame = ce._deadlineFrame;
  // A debug run has a pause clock of its own (`PauseClock`): the frame of the
  // run is the host's frame on that clock (a frame with no deadline when
  // there is no span), so that a time limit of the run, and of each span
  // inside it, counts running time only. A frame made outside the run keeps
  // the `Date.now()` clock.
  const debugRun =
    options?.debug === undefined
      ? undefined
      : (() => {
          const clock = makePauseClock();
          return {
            clock,
            frame: frameOnClock(
              hostFrame ?? { at: Infinity, spans: [] },
              clock
            ),
          };
        })();
  const runFrame = debugRun?.frame ?? hostFrame;
  let outsideFrame = hostFrame;
  // The program environment of the run
  // (rule 10 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`, see
  // `executeEpsil()`). It is put in place for each synchronous part of the
  // run, and never across an `await`: other work can run on the engine
  // then. The evaluation of a statement captures it when it starts
  // (`AsyncEvaluation.operation`).
  const program = UnitEnvironment.forOperation(
    undefined,
    ce.context?.lexicalScope
  );
  const inProgram = <T>(fn: () => T): T =>
    ce._boxingState.withOperation(program, fn);
  // The debug hooks are installed for the whole run, waits included, and the
  // hooks of an enclosing run are put back when it ends.
  const enclosingDebugHooks = ce._epsilDebugHooks;
  const enclosingDebugRun = ce._epsilDebugRun;
  if (options?.debug !== undefined) {
    ce._epsilDebugHooks = options.debug;
    ce._epsilDebugRun = debugRun;
  }
  // The frame outside the run is put back on every exit, an exception
  // included: the span around the call has closed, and its frame must not
  // stay on the engine.
  try {
    ce._deadlineFrame = runFrame;
    const steps = executeEpsilRun(ce, source, options);
    // The parts of the run between two statements are synchronous; each ends
    // when the generator yields the next statement to evaluate.
    let step = inProgram(() => steps.next());
    while (!step.done) {
      // The evaluation starts here, with the fields of the run in place: it
      // reads the deadline frame when it starts.
      let pending: Promise<Expression>;
      try {
        const stmt = step.value;
        pending = inProgram(() =>
          ce._boxingState.asProgramStatement(() =>
            stmt.evaluateAsync({ signal })
          )
        );
      } catch (e) {
        step = inProgram(() => steps.throw(e));
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
        inProgram(() => steps.return(undefined as never));
        throw failure?.error instanceof CancellationError
          ? failure.error
          : aborted();
      }
      // A statement whose evaluation rejects is handled as a statement whose
      // `evaluate()` throws: its error becomes the value of the statement.
      step = inProgram(() =>
        failure !== undefined ? steps.throw(failure.error) : steps.next(value!)
      );
    }
    return step.value;
  } finally {
    ce._deadlineFrame = outsideFrame;
    ce._epsilDebugHooks = enclosingDebugHooks;
    ce._epsilDebugRun = enclosingDebugRun;
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
  ce._epsilBatchId = nextEpsilBatchId();
  // The Epsil spelling of the library, for the protocol dispatchers the
  // batch installs (`IComputeEngine._epsilLibraryName`).
  const enclosingLibraryName = ce._epsilLibraryName;
  ce._epsilLibraryName = canonicalLibraryName;
  // The nested-statement hook the evaluation loop installs (see
  // `nestedStatementReporter`). The loop restores it when it ends; this
  // restores it too when the run ends with an exception. Restored rather
  // than cleared, so a nested run leaves the outer run's hook in place.
  const enclosingStatementHook = ce._epsilStatementResultHook;
  // The deadline frame of the run. The statement loop removes it from the
  // engine when a statement ends with an expired time or step budget (see
  // the `catch` of the statement loop); it is put back when the run ends.
  const runFrame = ce._deadlineFrame;
  try {
    // A program runs with no iteration limit: a loop written by its author
    // runs until it ends, and the host's time budget is the bound. A limit
    // that the host assigned to the engine still applies. The engine keeps
    // the lifted limit after the run, so that a lazy collection the program
    // returns can be enumerated by the host in full.
    ce._liftDefaultIterationLimit();
    return yield* executeEpsilSteps(ce, source, options, runFrame);
  } finally {
    ce._deadlineFrame = runFrame;
    ce._epsilBatchId = enclosingBatch;
    ce._epsilLibraryName = enclosingLibraryName;
    ce._epsilStatementResultHook = enclosingStatementHook;
  }
}

function* executeEpsilSteps(
  ce: ComputeEngine,
  source: string,
  options: ExecuteEpsilOptions | undefined,
  /** The deadline frame of the run, as `executeEpsilRun()` read it. */
  runFrame: ComputeEngine['_deadlineFrame']
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
      // A definition `Sin(x) := 5` would replace the library function `Sin`
      // on this engine, so the parse refuses it.
      isLibraryFunction: (name) => ce._isLibraryFunction(name),
    });
    // The Epsil spellings of the library (`sin`, `pi`) become the library
    // names (`Sin`, `Pi`) here, before anything reads the tree — the static
    // pass, the advisory scans, and the evaluation loop all see `Sin`. The
    // raw tree the parser produced is not kept: the diagnostics index the
    // SOURCE, and every node keeps its offsets through the rewrite.
    ast = resolveLibraryNames(parsed, source, ce);
    // The source of each statement, for a debugger that follows a later run
    // which calls a function of this one (`EpsilDebugStatement.sourceContent`).
    noteStatementSources(ce._epsilStatementSources, ast, {
      content: source,
      url: options?.url,
    });
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
  const sourceStatements =
    operator(ast) === 'Program' ? [...operands(ast)] : [ast];
  let statements = sourceStatements;

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
  let budgetExpired: unknown;
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
      budgetExpired = e;
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
    for (const stmt of sourceStatements)
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
  // The lazy collection that the last statement gave, when `value` holds
  // what `listedFinalValue()` made of it.
  let listedView: Expression | undefined;

  // Names already surfaced as `unknown-function` — one diagnostic per unknown
  // name per program run, not per occurrence.
  const reportedUnknowns = new Set<string>();

  // The names that the program can bind, for the scan of the canonical form
  // of each statement below (`scanUnknownFunctions` with `bound`). `undefined`
  // when the walk failed (a tree too deep to walk): that scan is then skipped,
  // because without these names it would report a call of a local function.
  const programNames = collectNonHeadSymbols(statements);

  // Advisory scans read the raw source before canonicalization. They do not
  // install heads or declarations; Program owns all binding preparation.
  for (const stmt of sourceStatements)
    scanProtocolPropertyCalls(
      ce,
      stmt,
      reportedUnknowns,
      diagnostics,
      stmt,
      source
    );
  if (budgetExpired !== undefined)
    return canceledPreparation(
      ce,
      budgetExpired,
      sourceStatements,
      source,
      defSites,
      diagnostics
    );
  let program: Expression;
  try {
    program = ce.box(ast);
  } catch (error) {
    if (!isTimeoutCancellation(error)) throw error;
    return canceledPreparation(
      ce,
      error,
      sourceStatements,
      source,
      defSites,
      diagnostics
    );
  }
  const order = programSourceOrder(program);
  statements = order.map((i) => sourceStatements[i]);
  const savedStatementLimit = ce._epsilStatementTimeLimitMs;
  ce._epsilStatementTimeLimitMs = options?.statementTimeLimitMs;

  // A NESTED statement (in a loop body, a function body, an `if` branch)
  // whose value is discarded and holds an error is reported as a
  // `runtime-error` diagnostic too, by a hook the engine calls after each
  // such statement. Installed for the evaluation loop only: the static pass
  // above evaluates no statement.
  const enclosingStatementHook = ce._epsilStatementResultHook;
  // The failures (`failureKey()`) that the hook reported during the
  // evaluation of the current top-level statement. The value of the
  // statement can hold the same failure, which is then not reported again.
  // Each failure maps to the diagnostic that reports it.
  const nestedFailures = new Map<object, ParsingDiagnostic | undefined>();
  const reportNested = nestedStatementReporter(
    ce,
    statements,
    defSites,
    diagnostics,
    nestedFailures
  );
  // The report of the top-level statement `i` of the program (an index in
  // `statements`), which evaluated to `result`.
  const reportStatement = (
    boxedStmt: Expression,
    result: Expression,
    i: number,
    error: unknown
  ): void => {
    const stmt = statements[i];
    value = result;
    const range = statementRange(stmt, source);
    valueRange = range;
    valueStatement = stmt;
    const cancellation = cancellationCause(error);
    const constantSite = constantAssignmentSite(error);
    const declarationCode =
      isFunction(value, 'Error') && isFunction(value.op1, 'ErrorCode')
        ? value.op1
        : undefined;
    const redeclared =
      declarationCode !== undefined &&
      isString(declarationCode.op1) &&
      declarationCode.op1.string === 'variable-redeclaration' &&
      isString(declarationCode.op2)
        ? declarationCode.op2.string
        : undefined;
    const walkFailure = { error: undefined as unknown };
    // The value of the program is a value, not the call that makes it: a
    // lazy collection that the last statement gives is listed
    // (`listedFinalValue()`). A declaration or an assignment has no value
    // (the program then gives `Nothing`), so its collection is not walked.
    if (
      i === statements.length - 1 &&
      !isBindingStatement(boxedStmt) &&
      value.isLazyCollection
    ) {
      const reportedBefore = new Set(nestedFailures.keys());
      listedView = value;
      value = listedFinalValue(ce, value, runFrame);
      const held = new Set<object>();
      walkValue(walkFailure, () => {
        for (const error of value.errors) held.add(failureKey(error));
      });
      for (const [failure, diagnostic] of nestedFailures) {
        if (reportedBefore.has(failure) || !held.has(failure)) continue;
        const k = diagnostic ? diagnostics.indexOf(diagnostic) : -1;
        if (k >= 0) diagnostics.splice(k, 1);
      }
    }
    walkValue(walkFailure, () => {
      const heldErrors = value.errors;
      if (heldErrors.length > 0)
        valueRange = narrowErrorRange(
          ce,
          heldErrors[0].json,
          stmt,
          range,
          boxedStmt
        );
    });
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
    // 3`) or of `Module`: the static pass reports it at the binding, and the
    // statement's `absence-marker-binding` or `module-binding` error value is
    // that same problem.
    // The walks of the value below run outside the per-statement `try`, and
    // nothing may throw to the host from them: a value can be nested so
    // deeply that a recursive walk (`errors`, `json`) overflows the stack.
    // A walk that throws is reported as a diagnostic of the statement
    // (`reportWalkFailure`), and the advisory result it was computing is
    // dropped.
    const markerError = walkValue(walkFailure, () => value.errors[0]);
    const markerCode =
      isFunction(markerError, 'Error') &&
      isFunction(markerError.op1, 'ErrorCode')
        ? markerError.op1.ops
        : undefined;
    const markerKind =
      markerCode !== undefined &&
      isString(markerCode[0]) &&
      (markerCode[0].string === 'absence-marker-binding' ||
        markerCode[0].string === 'module-binding')
        ? markerCode[0].string
        : undefined;
    const markerName =
      markerKind !== undefined &&
      markerCode !== undefined &&
      isString(markerCode[1])
        ? markerCode[1].string
        : undefined;
    const refusalCode = isFunction(markerError, 'Error')
      ? isString(markerError.op1)
        ? markerError.op1.string
        : isFunction(markerError.op1, 'ErrorCode') &&
            isString(markerError.op1.op1)
          ? markerError.op1.op1.string
          : undefined
      : undefined;
    const reportedStatically =
      walkValue(
        walkFailure,
        () =>
          // A declaration refused during preparation and again by its ordinary
          // runtime owner is one problem at the same authored statement.
          (['Declare', 'DefineFunction'].includes(operator(stmt)) &&
            markerError !== undefined &&
            ([
              'variable-redeclaration',
              'function-redefinition',
              'invalid-clause-definition',
            ].includes(refusalCode ?? '') ||
              (isFunction(boxedStmt, 'Declare') &&
                isDeclarationTypeErrorValue(markerError, boxedStmt.op1))) &&
            diagnostics.some(
              (d) =>
                (d.message[0] === refusalCode ||
                  (d.message[0] === 'static-type-error' &&
                    d.message[3] === refusalCode)) &&
                d.range[0] === range[0] &&
                d.range[1] === range[1]
            )) ||
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
                d.message[0] === markerKind &&
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
          // `reportedAsBlockLocalError()`.
          (markerError !== undefined &&
            reportedAsBlockLocalError(
              markerError,
              diagnostics,
              statementRange(stmt, source)
            ))
      ) ?? false;
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
    if (programNames !== undefined)
      walkValue(walkFailure, () =>
        scanUnknownFunctions(
          ce,
          boxedStmt.json,
          reportedUnknowns,
          diagnostics,
          stmt,
          source,
          programNames
        )
      );
    reportWalkFailure(ce, walkFailure, stmt, source, defSites, diagnostics);
    options?.onStatement?.({
      index: order[i],
      expression: boxedStmt,
      value,
      range: statementRange(stmt, source),
    });
    nestedFailures.clear();
  };
  ce._epsilStatementResultHook = (boxedStmt, result, i, error) => {
    if (i === undefined) {
      reportNested(boxedStmt, result);
      return;
    }
    // `listedFinalValue()` removes the deadline frame from the engine when
    // the walk of the final value spends a time or a step budget, so that
    // the report of the statement is built. The frame is put back here.
    const frame = ce._deadlineFrame;
    try {
      reportStatement(boxedStmt, result, i, error);
    } finally {
      ce._deadlineFrame = frame;
    }
  };
  try {
    const result = yield program;
    // The shared Program evaluator determines the value (declarations and
    // assignments as final statements produce Nothing, as in a Block). When
    // that value is the lazy collection that the hook listed, the value of
    // the program is the list, which `value` holds.
    if (result !== listedView) value = result;
  } finally {
    ce._epsilStatementTimeLimitMs = savedStatementLimit;
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

  // A protocol replacement may leave one member name declared by two
  // protocols of the closure of a protocol that extends it. The replacement
  // does not refuse it, because the rest of an edited program usually
  // resolves it (the extending protocol is re-declared without the member);
  // each conflict still present at the end of the batch is an error here,
  // and is reported again by every later batch until it is resolved. The
  // range is the whole program: the conflict belongs to no one statement.
  for (const conflict of protocolExtendsConflicts(ce))
    diagnostics.push({
      severity: 'error',
      message: [
        'protocol-extends-member-conflict',
        conflict.protocol,
        conflict.message,
      ],
      range: [0, source.length],
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
 * The value of a program whose last statement gives the lazy collection
 * `view`: the list, the set or the dictionary of the elements of `view`, so
 * that every form of the value (`json`, `latex`, `toString()`) shows the
 * elements. Without this, the value of `map(u => u + 1, [5, 6])` is the
 * `Map` call, and a host that writes its LaTeX shows the call, not `[6, 7]`.
 *
 * The collection is listed as an element of a list literal is
 * (`listedElement()`), so `view` is returned unchanged in the same cases: a
 * `Range`, a collection that is not known to be finite, one whose elements
 * are more than `ce.maxCollectionSize`, a held conditional, a callback that
 * applies an operator with only an asynchronous handler, a callback with an
 * effect when the number of elements is not known without a walk, and a
 * walk that throws (the host gets the failure when it reads the value). One
 * difference: a view of a dictionary (`filter(d, p)`) is listed too, into a
 * `Dictionary`, because the value of a program is a whole value, as the
 * accumulator of a fold is.
 *
 * The walk computes the elements, so it is a part of the evaluation of the
 * statement, with the same limits. It runs in `runFrame`, the deadline frame
 * of the run, which is not on the engine after a wait of the asynchronous
 * route. When the run has a time limit for each statement, the walk runs in
 * a span of that limit. The span is a second one: the span of the statement
 * closed before the statement was reported, so the last statement can take
 * up to twice the limit. The time that the statement has left is not
 * computed here, because the time that a debugger keeps the program stopped
 * before the statement is not known here, and it must not count. A walk
 * that is canceled gives the error value that a canceled statement gives
 * (`["Error", message, cause]`): a program never throws to its host. The
 * exception of a debugger hook is thrown again, as the statement loop of
 * the engine does.
 *
 * When the walk spends a time or a step budget, the engine is left with no
 * deadline frame, as the statement loop of the engine leaves it after a
 * statement that spends one: an operation that builds the error value or
 * the report of the statement would otherwise throw at its next check of
 * the spent budget. The caller puts the frame back. In every other case the
 * engine has the frame that it had before the call.
 */
function listedFinalValue(
  ce: ComputeEngine,
  view: Expression,
  runFrame: ComputeEngine['_deadlineFrame']
): Expression {
  const outsideFrame = ce._deadlineFrame;
  ce._deadlineFrame = runFrame;
  try {
    const list = (): Expression =>
      listedElement(
        ce,
        view,
        { used: 0, max: ce.maxCollectionSize },
        true,
        true
      );
    const ms = ce._epsilStatementTimeLimitMs;
    const listed =
      ms === undefined
        ? list()
        : ce.withTimeLimit({ ms, label: 'epsil:statement' }, list);
    ce._deadlineFrame = outsideFrame;
    return listed;
  } catch (e) {
    if (isDebugHookFailure(e)) {
      ce._deadlineFrame = outsideFrame;
      throw e;
    }
    ce._deadlineFrame = isTimeoutCancellation(e) ? undefined : outsideFrame;
    const message = ce.string(e instanceof Error ? e.message : String(e));
    // The cause that the statement loop of the engine writes
    // (`programFailureValue()`, `compute-engine/function-utils.ts`).
    const cause =
      cancellationCause(e) ??
      (e instanceof CancellationError ? budgetCauseOf(e) : undefined);
    return ce._fn(
      'Error',
      cause === undefined ? [message] : [message, ce.string(cause)]
    );
  }
}

/** A preparation timeout has no statement value to report through the evaluator. */
function canceledPreparation(
  ce: ComputeEngine,
  error: unknown,
  statements: readonly MathJsonExpression[],
  source: string,
  sites: ReturnType<typeof definitionSites>,
  diagnostics: ParsingDiagnostic[]
): ExecuteEpsilResult {
  const saved = ce._deadlineFrame;
  ce._deadlineFrame = undefined;
  try {
    const value = ce._fn('Error', [
      ce.string(error instanceof Error ? error.message : String(error)),
      ce.string(budgetCauseOf(error)),
    ]);
    const index = programInterruption(error)?.index ?? 0;
    const statement = statements[index];
    const valueRange: [number, number] =
      statement === undefined
        ? [0, source.length]
        : statementRange(statement, source);
    if (statement !== undefined && index < statements.length - 1)
      diagnostics.push(
        errorValueDiagnostic(
          ce,
          value,
          statement,
          valueRange,
          sites,
          cancellationCause(error)
        )
      );
    return { value, diagnostics, valueRange };
  } finally {
    ce._deadlineFrame = saved;
  }
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
      (parent === 'Loop' ||
        parent === 'Comprehension' ||
        parent === 'ParallelLoop' ||
        parent === 'ParallelComprehension') &&
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
        // `Function`. An assignment or a declaration has no value: when it
        // is the last statement, the block has the value `Nothing`, and the
        // value of the statement is discarded.
        const statementHead = operator(
          operator(stmt) === 'Typed' ? (operands(stmt)[0] ?? stmt) : stmt
        );
        const role: NestedStatementRole =
          j < ops.length - 1 ||
          loopBody ||
          statementHead === 'Assign' ||
          statementHead === 'Declare'
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
        head === 'Loop' || head === 'ParallelLoop'
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
 * failures reported are added to `failures`, with the diagnostic that
 * reports each one, and the caller clears `failures` at each top-level
 * statement.
 */
function nestedStatementReporter(
  ce: ComputeEngine,
  statements: ReadonlyArray<MathJsonExpression>,
  defSites: ReturnType<typeof definitionSites>,
  diagnostics: ParsingDiagnostic[],
  failures: Map<object, ParsingDiagnostic | undefined>
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
    const enclosingHook = ce._epsilStatementResultHook;
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
        !reportedAsBlockLocalError(errors[0], diagnostics, origin.range)
      ) {
        failures.set(failureKey(errors[0]), undefined);
        const diagnostic = errorValueDiagnostic(
          ce,
          errors[0],
          origin.stmt,
          origin.range,
          defSites,
          undefined,
          made?.statement ?? statement
        );
        failures.set(failureKey(errors[0]), diagnostic);
        diagnostics.push(diagnostic);
      }
    } catch (e) {
      // A report is advisory: a failure while it is built must not become
      // the value of the statement, which is what an exception thrown into
      // the engine here would do. A cap breach (the host's time budget) is
      // not a failure of the report, and goes on.
      if (cancellationCause(e) !== undefined) throw e;
    } finally {
      ce._epsilStatementResultHook = enclosingHook;
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

/**
 * Does `name` have a callable value definition that is not only the shell
 * that boxing a call makes?
 *
 * Boxing `rnage(1, 3)` declares `rnage` as a value of type `function`, with an
 * inferred type and no value, so `bindsACallable()` answers `true` for every
 * unknown head once its statement is boxed. A binding with a value
 * (`let f = (y) => y + 1`) or with a declared type (a host's
 * `ce.declare('f', 'function')`) is not such a shell.
 */
function bindsACallableNotShell(ce: ComputeEngine, name: string): boolean {
  if (!bindsACallable(ce, name)) return false;
  const def = ce.lookupDefinition(name);
  if (def === undefined || !isValueDef(def)) return true;
  return !(def.value.inferredType && def.value.value === undefined);
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
    for (let p of operands(expr).slice(1)) {
      // A parameter with a default value: `["Optional", param, default]`.
      if (operator(p) === 'Optional') p = operand(p, 1) ?? p;
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
 *
 * With `bound`, `expr` is the CANONICAL form of the statement, not its
 * result. That form holds calls of functions that the program binds as values
 * (`let f = (y) => y + 1; f(2)`), of parameters (`function g(h) { h(1) }`)
 * and of local functions of a body, which have no operator definition at the
 * top level. A head is then skipped when its name is in `bound` (every name
 * that the program writes in a position other than the head of a call, see
 * `collectNonHeadSymbols()`) or when its definition is a callable value
 * (`bindsACallableNotShell()`, for a binding of an earlier program or of the
 * host).
 */
function scanUnknownFunctions(
  ce: ComputeEngine,
  expr: MathJsonExpression,
  reported: Set<string>,
  diagnostics: ParsingDiagnostic[],
  stmt: MathJsonExpression,
  source: string,
  bound?: ReadonlySet<string>
): void {
  const head = operator(expr);
  if (head === '') return; // Not a function application (number/symbol/string).

  if (
    !reported.has(head) &&
    ce.operatorInfo(head) === undefined &&
    (bound === undefined ||
      (!bound.has(head) && !bindsACallableNotShell(ce, head)))
  ) {
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
    scanUnknownFunctions(ce, op, reported, diagnostics, stmt, source, bound);
}

/**
 * Every symbol that `statements` write in a position other than the head of
 * a function application: a name declared or assigned (`let f = …`, `f = …`),
 * a parameter, a loop variable, a name read as a value. A name that the
 * program binds as a function is written this way at its binding, so the set
 * holds it; a capture of a `match` pattern adds its bare name. The set holds
 * more names than the program binds; that only
 * makes the scan of the canonical form report fewer calls, which is the safe
 * direction for an advisory warning.
 *
 * Returns `undefined` when the walk fails (a tree nested too deeply for a
 * recursive walk).
 */
function collectNonHeadSymbols(
  statements: readonly MathJsonExpression[]
): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  // A capture of a `match` pattern is a wildcard symbol (`_n`, `__rest`,
  // `___rest`) or the head of an application (`_f(x)`), and the case body
  // reads it by its bare name (`n`, `rest`, `f`), with the leading
  // underscores removed (`collectCaptures()` in `match-dispatch.ts`). The
  // bare name is added too.
  const add = (name: string): void => {
    names.add(name);
    const bare = name.replace(/^_+/, '');
    if (bare.length > 0) names.add(bare);
  };
  const collect = (e: MathJsonExpression): void => {
    const name = symbol(e);
    if (name !== null && name !== undefined) {
      add(name);
      return;
    }
    const head = operator(e);
    if (head.startsWith('_')) add(head);
    for (const op of operands(e)) collect(op);
  };
  try {
    for (const stmt of statements) collect(stmt);
  } catch {
    return undefined;
  }
  return names;
}

/**
 * If `e` is a `CancellationError` carrying a recognized machine-readable
 * `cause` (a cap breach: timeout / iteration / recursion), return that cause;
 * otherwise `undefined`.
 *
 * Detection is by `name` rather than `instanceof` so it survives a re-bundled
 * `CancellationError` crossing a plugin/host boundary (see the cross-bundle
 * identity hazard in ARCHITECTURE.md).
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
 * The codes of the static errors of the rules of block locals
 * (`docs/ERROR-MODEL.md`): the canonicalization puts the error in place in
 * the statement, and the static check reports it as a `static-type-error`
 * with the code.
 */
const BLOCK_LOCAL_ERROR_CODES = [
  'read-before-declaration',
  'read-before-initialization',
  'variable-redeclaration',
  'declaration-without-value',
  'declaration-below-statement',
  'assignment-to-undeclared-variable',
  'assignment-in-operand',
  'assignment-type-mismatch',
];

/**
 * Whether `error` holds a static error of the rules of block locals
 * (`BLOCK_LOCAL_ERROR_CODES`) that the static check already reported. The
 * error is in the canonical statement, so the run gives it as the value of
 * the statement, also inside another error (the `Invalid function` error of
 * a `function` statement whose body holds it). The run does not report it a
 * second time.
 *
 * Each block-local error that `error` holds must match a diagnostic of the
 * static check: the same code, the same description, and a range that
 * overlaps the source range of the error. The source range is the range of
 * the `ErrorCode` operand or of the `Error` node when the engine recorded
 * one (the use of a local for `read-before-declaration`), else
 * `statementRange`, the range of the statement that gave the value. An
 * error that holds the block-local error only in the text of its message is
 * matched by the code and the range of the statement. A
 * match by code alone is not sufficient: a statement can hold a static
 * error and give a different run-time error with the same code elsewhere.
 */
function reportedAsBlockLocalError(
  error: Expression,
  diagnostics: ReadonlyArray<ParsingDiagnostic>,
  statementRange: readonly [number, number]
): boolean {
  const found: Expression[] = [];
  const walk = (e: Expression): void => {
    if (!isFunction(e)) return;
    if (
      e.operator === 'Error' &&
      isFunction(e.op1, 'ErrorCode') &&
      isString(e.op1.op1) &&
      BLOCK_LOCAL_ERROR_CODES.includes(e.op1.op1.string)
    ) {
      found.push(e);
      return;
    }
    for (const op of e.ops) walk(op);
  };
  walk(error);
  const overlaps = (
    d: ParsingDiagnostic,
    site: readonly [number, number]
  ): boolean => d.range[0] <= site[1] && site[0] <= d.range[1];
  // An error that holds the block-local error only as text (the message of
  // the `Invalid function` error of a `function` statement) is matched by
  // its code, with a diagnostic in the range of the statement.
  if (found.length === 0) {
    const text = JSON.stringify(error.json);
    const codes = BLOCK_LOCAL_ERROR_CODES.filter((code) => text.includes(code));
    return (
      codes.length > 0 &&
      codes.every((code) =>
        diagnostics.some(
          (d) =>
            Array.isArray(d.message) &&
            d.message[0] === 'static-type-error' &&
            d.message[3] === code &&
            overlaps(d, statementRange)
        )
      )
    );
  }
  return found.every((e) => {
    const code = errorCode(e.json);
    const description = describeError(e.json);
    const site =
      (isFunction(e) ? e.op1.sourceOffsets : undefined) ??
      e.sourceOffsets ??
      statementRange;
    return diagnostics.some(
      (d) =>
        Array.isArray(d.message) &&
        d.message[0] === 'static-type-error' &&
        d.message[3] === code &&
        d.message[1] === description &&
        overlaps(d, site)
    );
  });
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
