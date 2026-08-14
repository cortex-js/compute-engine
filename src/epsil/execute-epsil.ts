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
import type { CancellationCause } from '../common/interruptible.js';

// Type-only imports: `src/epsil` never statically imports the engine, so this
// adds no runtime dependency (and no `compute-engine` cycle — the engine never
// imports `epsil`). The engine is injected at call time, mirroring the
// `parseLatex`/`ILatexSyntax` injection pattern used elsewhere in `src/epsil`.
import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';

import {
  DiagnosticNote,
  FatalParsingError,
  ParsingDiagnostic,
} from './diagnostics.js';
import { parseEpsil } from './parse-epsil.js';
import { definitionSites } from './definition-sites.js';
import { narrowToFrames, traceFrames } from './error-location.js';
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
}

export interface ExecuteEpsilResult {
  /** The value of the last executed statement (or `Nothing`). Runtime problems
   * surface here as `["Error", …]` values, never as thrown exceptions. */
  value: BoxedExpression;
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
  // The BATCH (ruling P47): everything below — the static pre-pass and the
  // evaluation loop alike — runs under one id, which the protocol registry
  // stamps on the implementations it installs so that a second implementation
  // block for one (type, protocol) pair in this program is an error while a
  // later batch replaces. Restored rather than cleared, so a nested run (a
  // host re-entering the interpreter) leaves the outer batch intact.
  const enclosingBatch = ce._epsilBatchId;
  ce._epsilBatchId = ++epsilBatchCounter;
  try {
    return executeEpsilBatch(ce, source, options);
  } finally {
    ce._epsilBatchId = enclosingBatch;
  }
}

function executeEpsilBatch(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteEpsilOptions
): ExecuteEpsilResult {
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
    });
    ast = parsed;
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
    throw e;
  }

  // Unwrap a top-level `Block` into its statement list. The parser wraps a
  // multi-statement program in `Block`; a single statement is not wrapped, and
  // an empty program is `Nothing`. A top-level `Block` node is unambiguously the
  // program wrapper: top-level `{…}` source is the collection grammar
  // (Set/Dictionary), statement blocks parse only in keyword position, and a
  // single-statement program is returned unwrapped.
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
  // suppresses evaluation). Skipped when parsing produced errors: the AST of
  // an unparseable program is a guess, and canonicalizing it sprays noise.
  //
  // Cost: the pass boxes each statement, and the loop below boxes it again.
  // The two boxings are deliberately not shared — the loop boxes a statement
  // only after the previous ones have *evaluated*, so its canonical form can
  // depend on declarations this pass cannot see. Programs are small and
  // canonicalization is cheap next to evaluation.
  if (!diagnostics.some((x) => x.severity === 'error'))
    diagnostics.push(...staticDiagnostics(ce, ast, source));

  // Parameters that shadow an engine constant — `f(Pi) = Pi + 1` declares a
  // parameter NAMED `Pi` (the uniform binding convention, shared with match
  // patterns), so the body's `Pi` is the argument, not π. Advisory; one
  // diagnostic per name per program run. Skipped on parse errors for the
  // same reason as the static pass above: the AST of an unparseable program
  // is a guess.
  if (!diagnostics.some((x) => x.severity === 'error')) {
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

  let value: BoxedExpression = ce.Nothing;
  let valueRange: [number, number] | undefined;

  // Names already surfaced as `unknown-function` — one diagnostic per unknown
  // name per program run, not per occurrence.
  const reportedUnknowns = new Set<string>();

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    // "Errors are values": a runtime problem becomes an `["Error", …]` value.
    // Most engine problems already flow back as `["Error", …]` boxed values;
    // the try/catch is the backstop for the few paths that throw (e.g.
    // reassigning a `const`, or a cap breach such as `timeLimit`/
    // `iterationLimit`/`recursionLimit`, which throw a `CancellationError`).
    let cancellation: CancellationCause | undefined;
    valueRange = statementRange(stmt, source);
    try {
      value = ce.box(stmt).evaluate();
      // An error value narrows the anchor to its breadcrumb's innermost
      // source-mapped frame, so a host that reports the error points at the
      // offending subexpression, not the whole statement.
      const errors = value.errors;
      if (errors.length > 0)
        valueRange = narrowErrorRange(ce, errors[0].json, stmt, valueRange);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      cancellation = cancellationCause(e);
      // A cancellation (cap breach) carries a machine-readable `cause` as a
      // second Error operand — additively, so the message operand (which hosts
      // may still string-match, e.g. "Operation canceled" /
      // "Recursion limit exceeded") is unchanged. Non-cancellation throws keep
      // the single-operand shape.
      value =
        cancellation !== undefined
          ? ce.box(['Error', { str: message }, { str: cancellation }])
          : ce.box(['Error', { str: message }]);
    }

    // A runtime problem in a NON-final statement would otherwise vanish —
    // only the last statement's value is returned — so surface it as a
    // diagnostic (e.g. `xs[2] = 9`, an indexed assignment the engine rejects,
    // or reassigning a `const` mid-program). A cap breach becomes a structured
    // `evaluation-canceled` diagnostic carrying the cause; other runtime
    // problems become a `runtime-error` diagnostic. The final statement's
    // problems stay in `value`, per the errors-are-values contract.
    if (i < statements.length - 1) {
      const errors = value.errors;
      if (errors.length > 0) {
        // An error that BUBBLED out of a subexpression carries a breadcrumb
        // of `(operator, operand index)` frames (engine design §2a). Rendered
        // compactly as `%1`, it recovers the context the bare error lost; the
        // statement range below supplies the source anchoring.
        const frames = errorFrameChain(errors[0].json);
        const description = describeError(errors[0].json);
        const range = narrowErrorRange(
          ce,
          errors[0].json,
          stmt,
          statementRange(stmt, source)
        );
        const diagnostic = makeDiagnostic(
          cancellation !== undefined
            ? ['evaluation-canceled', cancellation, errors[0].toString()]
            : // `%2` (the frame chain) is `''` when the error was raised in
              // place, so `%3` — the machine-readable engine error code,
              // which keys extended docs (`epsil doc <code>`) — has a
              // stable position.
              ['runtime-error', description, frames, errorCode(errors[0].json)],
          range
        );
        // A call that did not match its callee's signature gets the signature
        // and the callee's definition site as notes — the context the bare
        // "a required argument is missing" leaves the reader to hunt for.
        const notes = signatureNotes(ce, errors[0].json, {
          definitionSites: defSites,
          primaryRange: range,
          boxedError: errors[0],
        });
        if (notes.length > 0) diagnostic.notes = notes;
        diagnostics.push(diagnostic);
      }
    }

    // "Did you mean?" — calling an unknown function stays *silently* symbolic
    // (an inert `["Quartile", …]` value), so the user never learns it did not
    // run. Walk the result for function applications whose head is not a known
    // operator and whose name is close to one, and emit a `warning`. The
    // returned value is unchanged (still symbolic); this is advisory. Source
    // ranges are lost from the evaluated tree, so the *statement's* range is
    // attached.
    scanUnknownFunctions(
      ce,
      value.json,
      reportedUnknowns,
      diagnostics,
      stmt,
      source
    );
  }

  // PENDING CONFORMANCES (protocols design P3). A conformance declared without
  // an implementation block is *pending*, and the state persists across
  // batches — so the notebook pattern (declare in one cell, implement in the
  // next) works. Every batch re-reports each still-pending edge as a WARNING
  // until it is fulfilled, so the reminder cannot be lost with the cell that
  // produced it. A SEMANTIC protocol (no requirements) is complete at
  // declaration and is never pending.
  for (const protocol of Object.values(ce._protocolRegistry))
    for (const conformance of protocol.conformances)
      if (conformance.pending)
        diagnostics.push({
          severity: 'warning',
          message: [
            'protocol-implementation-pending',
            conformance.targetKey,
            protocol.name,
          ],
          range: [0, source.length],
        });

  // The final statement's error stays a VALUE (no diagnostic, by design), so
  // the notes that would have travelled on a diagnostic are returned beside
  // it — computed here because only this function has the engine, the raw AST
  // and the source together, exactly as for `valueRange`.
  const valueNotes =
    value.errors.length > 0
      ? signatureNotes(ce, value.errors[0].json, {
          definitionSites: defSites,
          primaryRange: valueRange,
          boxedError: value.errors[0],
        })
      : [];

  return {
    value,
    diagnostics,
    ...(valueRange === undefined ? {} : { valueRange }),
    ...(valueNotes.length === 0 ? {} : { valueNotes }),
  };
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
 * `s |> Map(_, _ |-> Length(Characters(s)))` and underlining the `s` inside
 * `Characters(s)`. See `narrowToFrames()` for how a frame is matched onto the
 * source.
 */
function narrowErrorRange(
  ce: ComputeEngine,
  error: MathJsonExpression,
  stmt: MathJsonExpression,
  fallback: [number, number]
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
    frameOrderOf(errorCode(error))
  );
}

/** The source range of a statement AST node, falling back to the whole
 * program when the node carries no offsets. */
function statementRange(
  stmt: MathJsonExpression,
  source: string
): [number, number] {
  return (
    (typeof stmt === 'object' && stmt !== null && !Array.isArray(stmt)
      ? (stmt as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined) ?? [0, source.length]
  );
}

/** Print-statement names from other languages: these get a dedicated hint
 * (there is no printing in Epsil) instead of a fuzzy did-you-mean, which
 * would either stay silent or suggest something misleading. */
const PRINT_LIKE = new Set(['print', 'println', 'printf', 'puts', 'echo']);

/**
 * Warn when a `Function` literal's parameter is named after an engine
 * CONSTANT: in `f(Pi) = Pi + 1` (or `Pi |-> Pi + 1`) the parameter binds a
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
      // `print(...)` deserves better than a fuzzy suggestion: there is no
      // print in Epsil — the value of the last statement is the output.
      diagnostics.push({
        severity: 'warning',
        message: ['print-not-available', head],
        range: statementRange(stmt, source),
      });
    } else {
      const suggestion = ce.suggestOperatorName(head);
      if (suggestion !== undefined) {
        diagnostics.push({
          severity: 'warning',
          message: ['unknown-function', head, suggestion],
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
    cause === 'iteration-limit-exceeded' ||
    cause === 'recursion-depth-exceeded'
  )
    return cause;
  return undefined;
}

/** Build an execution-phase diagnostic. */
function makeDiagnostic(
  message: ParsingDiagnostic['message'],
  range: [number, number]
): ParsingDiagnostic {
  return { severity: 'error', message, range };
}
