import type { MathJsonExpression } from '../math-json/types.js';
import { operator, operands } from '../math-json/utils.js';
import type { CancellationCause } from '../common/interruptible.js';

// Type-only imports: `src/cortex` never statically imports the engine, so this
// adds no runtime dependency (and no `compute-engine` cycle — the engine never
// imports `cortex`). The engine is injected at call time, mirroring the
// `parseLatex`/`ILatexSyntax` injection pattern used elsewhere in `src/cortex`.
import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';

import { FatalParsingError, ParsingDiagnostic } from './diagnostics.js';
import { parseCortex } from './parse-cortex.js';

export interface ExecuteCortexOptions {
  /** Source URL (for `#url`/`#filename` pragmas and diagnostic origins). */
  url?: string;
  /** Injected LaTeX parser for `$…$` islands (a structural mirror of the
   * engine's `ILatexSyntax` injection). */
  parseLatex?: (latex: string) => MathJsonExpression;
  /** Opt into the host-state pragmas `#env`/`#navigator` (default `false`). */
  allowHostPragmas?: boolean;
}

export interface ExecuteCortexResult {
  /** The value of the last executed statement (or `Nothing`). Runtime problems
   * surface here as `["Error", …]` values, never as thrown exceptions. */
  value: BoxedExpression;
  /** Parse-time (and a few execution-time) problems: unparseable syntax, gated
   * host pragmas, a `#error` directive — plus a `runtime-error` diagnostic for
   * each *non-final* statement that evaluated to an error value (its value is
   * discarded, so the problem would otherwise be invisible). */
  diagnostics: ParsingDiagnostic[];
}

/**
 * Parse and execute a Cortex program against a compute engine.
 *
 * Flow (plan §1): parse → evaluate each top-level statement **sequentially in
 * `ce`'s current scope** (so a notebook cell-chain's declarations persist — no
 * scope is pushed around the whole program; engine `Block`/`Function` still
 * scope themselves). The returned `value` is the last statement's evaluated
 * value.
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
export function executeCortex(
  ce: ComputeEngine,
  source: string,
  options?: ExecuteCortexOptions
): ExecuteCortexResult {
  const diagnostics: ParsingDiagnostic[] = [];

  let ast: MathJsonExpression;
  try {
    const [parsed, parseDiagnostics] = parseCortex(source, options?.url, {
      parseLatex: options?.parseLatex,
      allowHostPragmas: options?.allowHostPragmas ?? false,
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

  let value: BoxedExpression = ce.Nothing;

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
    try {
      value = ce.box(stmt).evaluate();
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
        diagnostics.push(
          makeDiagnostic(
            cancellation !== undefined
              ? ['evaluation-canceled', cancellation, errors[0].toString()]
              : ['runtime-error', errors[0].toString()],
            statementRange(stmt, source)
          )
        );
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

  return { value, diagnostics };
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

/**
 * Walk a result expression (in MathJSON form) for function applications whose
 * head is a symbol that is **not** a known operator (`ce.operatorInfo` is
 * `undefined` — an inert unknown call survives evaluation as itself, and
 * declared functions/params do not). For each such name, once per program run,
 * emit a `warning` diagnostic suggesting a close known operator — but only when
 * a suggestion exists (an intentionally symbolic `f(x)` with no near match is
 * never nagged).
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
    const suggestion = ce.suggestOperatorName(head);
    if (suggestion !== undefined) {
      diagnostics.push({
        severity: 'warning',
        message: ['unknown-function', head, suggestion],
        range: statementRange(stmt, source),
      });
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
