import type { MathJsonExpression } from '../math-json/types';
import { operator, operands } from '../math-json/utils';

// Type-only imports: `src/cortex` never statically imports the engine, so this
// adds no runtime dependency (and no `compute-engine` cycle — the engine never
// imports `cortex`). The engine is injected at call time, mirroring the
// `parseLatex`/`ILatexSyntax` injection pattern used elsewhere in `src/cortex`.
import type { BoxedExpression, ComputeEngine } from '../compute-engine';

import { FatalParsingError, ParsingDiagnostic } from './diagnostics';
import { parseCortex } from './parse-cortex';

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
   * host pragmas, a `#error` directive. */
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

  // Unwrap a top-level `Do` into its statement list. The parser wraps a
  // multi-statement program in `Do`; a single statement is not wrapped, and an
  // empty program is `Nothing`.
  const statements =
    operator(ast) === 'Do' ? [...operands(ast)] : [ast];

  let value: BoxedExpression = ce.Nothing;

  for (const stmt of statements) {
    // "Errors are values": a runtime problem becomes an `["Error", …]` value.
    // Most engine problems already flow back as `["Error", …]` boxed values;
    // the try/catch is the backstop for the few paths that throw (e.g.
    // reassigning a `const`).
    try {
      value = ce.box(stmt).evaluate();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      value = ce.box(['Error', { str: message }]);
    }
  }

  return { value, diagnostics };
}

/** Build an execution-phase diagnostic. */
function makeDiagnostic(
  message: ParsingDiagnostic['message'],
  range: [number, number]
): ParsingDiagnostic {
  return { severity: 'error', message, range };
}
